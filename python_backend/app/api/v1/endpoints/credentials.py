import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.secret_store import encrypt_secret
from app.models.app_config import AppConfig
from app.models.audit_log import AuditLog
from app.models.credential_profile import CredentialProfile
from app.models.user import User
from app.schemas.credential import CredentialProfileCreate, CredentialProfileUpdate

router = APIRouter()

VALID_TYPES = {"snmp_v2c", "ssh"}


@router.get("", response_model=dict)
def list_credentials(
    credential_type: str = Query(default="", alias="type"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(CredentialProfile)
    if credential_type:
        query = query.filter(CredentialProfile.credential_type == credential_type)
    rows = query.order_by(CredentialProfile.credential_type.asc(), CredentialProfile.name.asc()).all()
    return {"message": "ok", "data": {"data": [_serialize(row) for row in rows]}}


@router.post("", response_model=dict)
def create_credential(
    payload: CredentialProfileCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    values = _validated_values(payload.model_dump(exclude_unset=True), creating=True)
    _validate_unique_name(db, values["name"])
    row = CredentialProfile(**values)
    db.add(row)
    db.flush()
    _audit(db, current_user, "create_credential", row.id, {"name": row.name, "type": row.credential_type})
    db.commit()
    db.refresh(row)
    return {"message": "created", "data": _serialize(row)}


@router.patch("/{credential_id}", response_model=dict)
def update_credential(
    credential_id: int,
    payload: CredentialProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(CredentialProfile).filter(CredentialProfile.id == credential_id).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credential profile not found")
    values = _validated_values(payload.model_dump(exclude_unset=True), creating=False)
    if "name" in values and values["name"] != row.name:
        _validate_unique_name(db, values["name"], credential_id)
    changed = {}
    for field, value in values.items():
        setattr(row, field, value)
        changed[field] = "***secret***" if field.endswith("_encrypted") else value
    row.updated_at = datetime.now(timezone.utc)
    _audit(db, current_user, "update_credential", row.id, changed)
    db.commit()
    db.refresh(row)
    return {"message": "updated", "data": _serialize(row)}


@router.delete("/{credential_id}", response_model=dict)
def delete_credential(
    credential_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(CredentialProfile).filter(CredentialProfile.id == credential_id).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credential profile not found")
    details = {"name": row.name, "type": row.credential_type}
    trace_default = db.query(AppConfig).filter(AppConfig.key == "trace_default_snmp_credential_id").first()
    if trace_default and trace_default.value == str(credential_id):
        trace_default.value = ""
        details["trace_auto_ingest_default_cleared"] = True
    db.delete(row)
    _audit(db, current_user, "delete_credential", credential_id, details)
    db.commit()
    return {"message": "deleted", "data": {"id": credential_id}}


def _validated_values(values: dict, creating: bool) -> dict:
    if "credential_type" in values:
        values["credential_type"] = values["credential_type"].strip()
        if values["credential_type"] not in VALID_TYPES:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Credential type must be snmp_v2c or ssh")
    elif creating:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Credential type is required")

    if "name" in values:
        values["name"] = values["name"].strip()
        if not values["name"]:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Credential name is required")
    elif creating:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Credential name is required")

    if "port" in values and values["port"] is not None and (values["port"] < 1 or values["port"] > 65535):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Port must be between 1 and 65535")
    if values.get("credential_type") == "snmp_v2c" and "port" not in values:
        values["port"] = 161
    if values.get("credential_type") == "ssh" and "port" not in values:
        values["port"] = 22

    if "secret" in values:
        values["secret_encrypted"] = encrypt_secret(values.pop("secret"))
    if "enable_secret" in values:
        values["enable_secret_encrypted"] = encrypt_secret(values.pop("enable_secret"))
    if "username" in values and values["username"] is not None:
        values["username"] = values["username"].strip()
    if "notes" in values and values["notes"] is not None:
        values["notes"] = values["notes"].strip()
    return values


def _validate_unique_name(db: Session, name: str, credential_id: int | None = None) -> None:
    query = db.query(CredentialProfile).filter(CredentialProfile.name == name)
    if credential_id is not None:
        query = query.filter(CredentialProfile.id != credential_id)
    if query.first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Credential profile name already exists")


def _serialize(row: CredentialProfile) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "credential_type": row.credential_type,
        "username": row.username,
        "port": row.port,
        "has_secret": bool(row.secret_encrypted),
        "has_enable_secret": bool(row.enable_secret_encrypted),
        "notes": row.notes,
        "created_at": _dt(row.created_at),
        "updated_at": _dt(row.updated_at),
    }


def _dt(value) -> str | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _audit(db: Session, user: User, action: str, entity_id: int | None, details: dict) -> None:
    db.add(AuditLog(action=action, entity_type="credential_profile", entity_id=entity_id, details=f"{user.email}: {json.dumps(details, default=str)}"))
