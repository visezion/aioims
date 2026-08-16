from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.models.app_config import AppConfig
from app.models.audit_log import AuditLog
from app.models.credential_profile import CredentialProfile
from app.models.user import User

router = APIRouter()


class SettingUpdate(BaseModel):
    value: str


DEFAULT_SETTINGS = {
    "device_status_refresh_seconds": {
        "value": "60",
        "description": "How often the device inventory page refreshes operational status, in seconds.",
    },
    "snmp_community": {
        "value": "",
        "description": "SNMP v2c read-only community used by discovery and inventory polling.",
    },
    "trace_default_snmp_credential_id": {
        "value": "",
        "description": "Saved SNMP v2c profile assigned when Device Trace automatically ingests an unknown endpoint.",
    },
    "device_config_backup_enabled": {
        "value": "false",
        "description": "Enable automatic full device configuration backups.",
    },
    "device_config_backup_interval_hours": {
        "value": "24",
        "description": "How often automatic configuration backups run, using the selected interval unit.",
    },
    "device_config_backup_interval_unit": {
        "value": "hours",
        "description": "Interval unit for automatic configuration backups: hours, weeks, or months.",
    },
    "device_config_backup_time": {
        "value": "02:00",
        "description": "Earliest local time for the next automatic configuration backup run.",
    },
    "device_config_backup_scope": {
        "value": "active_with_ssh",
        "description": "Which devices are included in automatic configuration backups.",
    },
    "device_config_backup_timeout_seconds": {
        "value": "8",
        "description": "SSH timeout for each automatic configuration backup, in seconds.",
    },
    "device_config_backup_last_run_at": {
        "value": "",
        "description": "Last automatic configuration backup run timestamp.",
    },
    "environment_threshold_rules": {
        "value": "[]",
        "description": "JSON rules for environmental, power, and component alert thresholds by site, location, room, rack, device, component, component type, component category, or global scope.",
    },
}
SENSITIVE_SETTINGS = {"snmp_community"}


@router.get("", response_model=dict)
def list_settings(db: Session = Depends(get_db), current_user: User = Depends(require_permission("configuration:read"))):
    _ensure_defaults(db)
    rows = db.query(AppConfig).order_by(AppConfig.key.asc()).all()
    return {"message": "ok", "data": {"data": [_serialize(row) for row in rows]}}


@router.get("/{key}", response_model=dict)
def get_setting(key: str, db: Session = Depends(get_db), current_user: User = Depends(require_permission("configuration:read"))):
    _ensure_defaults(db)
    row = db.query(AppConfig).filter(AppConfig.key == key).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Setting not found")
    return {"message": "ok", "data": _serialize(row)}


@router.patch("/{key}", response_model=dict)
def update_setting(key: str, payload: SettingUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_permission("configuration:write"))):
    _ensure_defaults(db)
    row = db.query(AppConfig).filter(AppConfig.key == key).first()
    if not row:
        defaults = DEFAULT_SETTINGS.get(key)
        if not defaults:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Setting not found")
        row = AppConfig(key=key, value=defaults["value"], description=defaults["description"])
        db.add(row)
        db.flush()
    value = _validate_value(db, key, payload.value)
    row.value = value
    audit_value = "***configured***" if key in SENSITIVE_SETTINGS and value else "***cleared***" if key in SENSITIVE_SETTINGS else value
    db.add(AuditLog(action="update_setting", entity_type="setting", entity_id=row.id, details=f"{current_user.email}: {key}={audit_value}"))
    db.commit()
    db.refresh(row)
    return {"message": "updated", "data": _serialize(row)}


def _serialize(row: AppConfig) -> dict:
    if row.key in SENSITIVE_SETTINGS:
        return {
            "key": row.key,
            "value": "",
            "configured": bool(row.value),
            "description": row.description,
        }
    return {"key": row.key, "value": row.value, "configured": bool(row.value), "description": row.description}


def _ensure_defaults(db: Session) -> None:
    changed = False
    for key, defaults in DEFAULT_SETTINGS.items():
        if not db.query(AppConfig).filter(AppConfig.key == key).first():
            db.add(AppConfig(key=key, value=defaults["value"], description=defaults["description"]))
            changed = True
    if changed:
        db.commit()


def _validate_value(db: Session, key: str, value: str) -> str:
    if key == "device_status_refresh_seconds":
        try:
            seconds = int(value)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Refresh interval must be a number") from exc
        if seconds < 15 or seconds > 3600:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Refresh interval must be between 15 and 3600 seconds")
        return str(seconds)
    if key == "snmp_community":
        stripped = value.strip()
        if len(stripped) > 128:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="SNMP community must be 128 characters or fewer")
        return stripped
    if key == "trace_default_snmp_credential_id":
        stripped = value.strip()
        if not stripped:
            return ""
        try:
            credential_id = int(stripped)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Trace default SNMP profile must be a valid profile ID") from exc
        profile = db.query(CredentialProfile).filter(CredentialProfile.id == credential_id, CredentialProfile.credential_type == "snmp_v2c").first()
        if not profile:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Select an existing SNMP v2c profile for trace auto-ingest")
        return str(credential_id)
    if key == "device_config_backup_enabled":
        lowered = value.strip().lower()
        if lowered not in {"true", "false"}:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Backup enabled must be true or false")
        return lowered
    if key == "device_config_backup_interval_hours":
        try:
            hours = int(value)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Backup interval must be a number") from exc
        if hours < 1 or hours > 720:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Backup interval must be between 1 and 720")
        return str(hours)
    if key == "device_config_backup_interval_unit":
        stripped = value.strip().lower()
        if stripped not in {"hours", "weeks", "months"}:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Backup interval unit must be hours, weeks, or months")
        return stripped
    if key == "device_config_backup_time":
        stripped = value.strip()
        parts = stripped.split(":")
        if len(parts) != 2:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Backup time must use HH:MM format")
        try:
            hour = int(parts[0])
            minute = int(parts[1])
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Backup time must use HH:MM format") from exc
        if hour < 0 or hour > 23 or minute < 0 or minute > 59:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Backup time must be a valid 24-hour time")
        return f"{hour:02d}:{minute:02d}"
    if key == "device_config_backup_scope":
        stripped = value.strip()
        if stripped not in {"active_with_ssh", "with_ssh", "all"}:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Backup scope must be active_with_ssh, with_ssh, or all")
        return stripped
    if key == "device_config_backup_timeout_seconds":
        try:
            seconds = float(value)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Backup timeout must be a number") from exc
        if seconds < 0.2 or seconds > 30:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Backup timeout must be between 0.2 and 30 seconds")
        return str(seconds).rstrip("0").rstrip(".")
    if key == "device_config_backup_last_run_at":
        return value.strip()
    if key == "environment_threshold_rules":
        stripped = value.strip()
        if len(stripped) > 50000:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Threshold rules payload is too large")
        return stripped or "[]"
    return value
