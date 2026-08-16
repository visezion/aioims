import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.models.audit_log import AuditLog
from app.models.device import Device
from app.models.insight import FirmwareRecord, ReportDefinition, VulnerabilityFinding
from app.models.user import User
from app.schemas.insight import FirmwareCreate, ReportCreate, VulnerabilityCreate

router = APIRouter()


def _dt(value):
    return value.isoformat() if value else None


def _firmware(row):
    return {"id": row.id, "device_id": row.device_id, "vendor": row.vendor, "platform": row.platform, "version": row.version, "recommended_version": row.recommended_version, "status": row.status, "release_date": row.release_date.isoformat() if row.release_date else None, "end_of_support_date": row.end_of_support_date.isoformat() if row.end_of_support_date else None, "source": row.source, "notes": row.notes, "updated_at": _dt(row.updated_at)}


def _vulnerability(row):
    return {"id": row.id, "device_id": row.device_id, "cve": row.cve, "title": row.title, "severity": row.severity, "status": row.status, "cvss": row.cvss, "source": row.source, "remediation": row.remediation, "detected_at": _dt(row.detected_at), "resolved_at": _dt(row.resolved_at)}


def _report(row):
    return {"id": row.id, "name": row.name, "report_type": row.report_type, "schedule": row.schedule, "enabled": row.enabled, "filters": json.loads(row.filters or "{}"), "recipients": json.loads(row.recipients or "[]"), "created_by": row.created_by, "created_at": _dt(row.created_at), "updated_at": _dt(row.updated_at)}


@router.get("/firmware", response_model=dict)
def list_firmware(db: Session = Depends(get_db), _user: User = Depends(require_permission("inventory:read"))):
    return {"message": "ok", "data": [_firmware(row) for row in db.query(FirmwareRecord).order_by(FirmwareRecord.id.desc()).limit(1000).all()]}


@router.post("/firmware", response_model=dict)
def create_firmware(payload: FirmwareCreate, db: Session = Depends(get_db), user: User = Depends(require_permission("configuration:write"))):
    if not db.query(Device).filter(Device.id == payload.device_id).first():
        raise HTTPException(status_code=404, detail="Device not found")
    row = FirmwareRecord(**payload.model_dump())
    db.add(row)
    db.flush()
    db.add(AuditLog(action="create_firmware_record", entity_type="firmware", entity_id=row.id, details=json.dumps({"user": user.email, "device_id": row.device_id})))
    db.commit()
    db.refresh(row)
    return {"message": "ok", "data": _firmware(row)}


@router.get("/vulnerabilities", response_model=dict)
def list_vulnerabilities(db: Session = Depends(get_db), _user: User = Depends(require_permission("configuration:read"))):
    return {"message": "ok", "data": [_vulnerability(row) for row in db.query(VulnerabilityFinding).order_by(VulnerabilityFinding.id.desc()).limit(2000).all()]}


@router.post("/vulnerabilities", response_model=dict)
def create_vulnerability(payload: VulnerabilityCreate, db: Session = Depends(get_db), user: User = Depends(require_permission("configuration:write"))):
    if payload.device_id and not db.query(Device).filter(Device.id == payload.device_id).first():
        raise HTTPException(status_code=404, detail="Device not found")
    row = VulnerabilityFinding(**payload.model_dump())
    db.add(row)
    db.flush()
    db.add(AuditLog(action="create_vulnerability_finding", entity_type="vulnerability", entity_id=row.id, details=json.dumps({"user": user.email, "cve": row.cve})))
    db.commit()
    db.refresh(row)
    return {"message": "ok", "data": _vulnerability(row)}


@router.post("/vulnerabilities/{finding_id}/resolve", response_model=dict)
def resolve_vulnerability(finding_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("configuration:write"))):
    row = db.query(VulnerabilityFinding).filter(VulnerabilityFinding.id == finding_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Vulnerability finding not found")
    row.status = "resolved"
    row.resolved_at = datetime.now(timezone.utc)
    db.add(AuditLog(action="resolve_vulnerability", entity_type="vulnerability", entity_id=row.id, details=user.email))
    db.commit()
    db.refresh(row)
    return {"message": "ok", "data": _vulnerability(row)}


@router.get("/reports", response_model=dict)
def list_reports(db: Session = Depends(get_db), _user: User = Depends(require_permission("configuration:read"))):
    return {"message": "ok", "data": [_report(row) for row in db.query(ReportDefinition).order_by(ReportDefinition.name.asc()).all()]}


@router.post("/reports", response_model=dict)
def create_report(payload: ReportCreate, db: Session = Depends(get_db), user: User = Depends(require_permission("configuration:write"))):
    if db.query(ReportDefinition).filter(ReportDefinition.name == payload.name).first():
        raise HTTPException(status_code=409, detail="Report name already exists")
    row = ReportDefinition(name=payload.name, report_type=payload.report_type, schedule=payload.schedule, enabled=payload.enabled, filters=json.dumps(payload.filters), recipients=json.dumps(payload.recipients), created_by=user.email)
    db.add(row)
    db.flush()
    db.add(AuditLog(action="create_report_definition", entity_type="report", entity_id=row.id, details=json.dumps({"user": user.email, "name": row.name})))
    db.commit()
    db.refresh(row)
    return {"message": "ok", "data": _report(row)}
