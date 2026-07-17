from typing import Optional
import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.secret_store import decrypt_secret
from app.models.app_config import AppConfig
from app.models.audit_log import AuditLog
from app.models.credential_profile import CredentialProfile
from app.models.device import Device
from app.models.user import User
from app.services.jobs import complete_job, fail_job, start_job, update_job_progress
from app.services.protocols import DEFAULT_PROTOCOLS, ProtocolCheckService

router = APIRouter()


class ProtocolCheckRequest(BaseModel):
    target: str
    protocols: Optional[list[str]] = None
    timeout: float = 1.5
    snmp_port: int = Field(default=161, ge=1, le=65535)

@router.post("/check", response_model=dict)
def check_target(payload: ProtocolCheckRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not payload.target.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Target is required")
    protocols = payload.protocols or list(DEFAULT_PROTOCOLS)
    job = start_job(db, "protocol_check", payload.target, current_user.email, {"target": payload.target, "protocols": protocols, "timeout": payload.timeout})
    service = ProtocolCheckService(timeout=payload.timeout, snmp_community=_global_snmp_community(db), snmp_port=payload.snmp_port)
    try:
        results = service.check_many(
            payload.target,
            protocols,
            lambda checked, total, protocol: update_job_progress(db, job, 5 + int((checked / max(total, 1)) * 90), {
                "phase": "checking",
                "checked": checked,
                "total": total,
                "current_protocol": protocol,
            }),
        )
    except Exception as exc:
        fail_job(db, job, str(exc))
        db.commit()
        raise
    db.add(AuditLog(
        action="protocol_check",
        entity_type="target",
        entity_id=None,
        details=json.dumps({"user": current_user.email, "target": payload.target, "protocols": protocols}),
    ))
    complete_job(db, job, {"target": payload.target, "results": results})
    db.commit()
    return {
        "message": "ok",
        "data": {
            "target": payload.target,
            "results": results,
            "job_id": job.id,
        },
    }


@router.get("/device/{device_id}/check", response_model=dict)
def check_device(
    device_id: int,
    protocols: str = Query(default=",".join(DEFAULT_PROTOCOLS)),
    timeout: float = 1.5,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    if not device.management_ip:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Device has no management IP")

    requested = [item.strip() for item in protocols.split(",") if item.strip()]
    selected_protocols = requested or list(DEFAULT_PROTOCOLS)
    job = start_job(db, "device_protocol_check", device.management_ip, current_user.email, {
        "device_id": device.id,
        "device_name": device.name,
        "protocols": selected_protocols,
        "timeout": timeout,
    })
    snmp_community, snmp_port = _device_snmp_config(db, device)
    service = ProtocolCheckService(timeout=timeout, snmp_community=snmp_community, snmp_port=snmp_port)
    try:
        results = service.check_many(
            device.management_ip,
            selected_protocols,
            lambda checked, total, protocol: update_job_progress(db, job, 5 + int((checked / max(total, 1)) * 90), {
                "phase": "checking",
                "checked": checked,
                "total": total,
                "current_protocol": protocol,
                "device_id": device.id,
                "device_name": device.name,
            }),
        )
    except Exception as exc:
        fail_job(db, job, str(exc))
        db.commit()
        raise
    db.add(AuditLog(
        action="protocol_check_device",
        entity_type="device",
        entity_id=device.id,
        details=json.dumps({"user": current_user.email, "protocols": selected_protocols}),
    ))
    complete_job(db, job, {"device": {"id": device.id, "name": device.name, "management_ip": device.management_ip}, "results": results})
    db.commit()
    return {
        "message": "ok",
        "data": {
            "device": {"id": device.id, "name": device.name, "management_ip": device.management_ip},
            "results": results,
            "job_id": job.id,
        },
    }


def _global_snmp_community(db: Session) -> str:
    row = db.query(AppConfig).filter(AppConfig.key == "snmp_community").first()
    return row.value if row and row.value else ""


def _device_snmp_config(db: Session, device: Device) -> tuple[str, int]:
    if device.snmp_credential_id:
        profile = db.query(CredentialProfile).filter(CredentialProfile.id == device.snmp_credential_id).first()
        if profile and profile.credential_type == "snmp_v2c":
            return decrypt_secret(profile.secret_encrypted), profile.port or 161
    return _global_snmp_community(db), 161
