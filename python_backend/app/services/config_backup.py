import hashlib
from datetime import datetime

from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.device_config_backup import DeviceConfigBackup

MAX_CONFIG_BACKUPS_PER_DEVICE = 5


def serialize_config_backup(backup: DeviceConfigBackup) -> dict:
    return {
        "id": backup.id,
        "device_id": backup.device_id,
        "snapshot": backup.snapshot,
        "status": backup.status,
        "source": backup.source,
        "platform": backup.platform,
        "config_hash": backup.config_hash,
        "bytes": backup.bytes,
        "ssh_credential_id": backup.ssh_credential_id,
        "job_id": backup.job_id,
        "created_by": backup.created_by,
        "created_at": _datetime_to_string(backup.created_at),
    }


def list_config_backups(db: Session, device_id: int) -> list[DeviceConfigBackup]:
    return (
        db.query(DeviceConfigBackup)
        .filter(DeviceConfigBackup.device_id == device_id)
        .order_by(DeviceConfigBackup.created_at.desc(), DeviceConfigBackup.id.desc())
        .all()
    )


def create_config_backup(
    db: Session,
    device: Device,
    snapshot: str,
    status: str = "",
    source: str = "manual",
    created_by: str = "",
    ssh_credential_id: int | None = None,
    job_id: int | None = None,
) -> DeviceConfigBackup | None:
    if not snapshot:
        return None
    digest = hashlib.sha256(snapshot.encode("utf-8", errors="replace")).hexdigest()
    latest = (
        db.query(DeviceConfigBackup)
        .filter(DeviceConfigBackup.device_id == device.id)
        .order_by(DeviceConfigBackup.created_at.desc(), DeviceConfigBackup.id.desc())
        .first()
    )
    if latest and latest.config_hash == digest:
        latest.status = status or latest.status
        latest.source = source or latest.source
        latest.created_by = created_by or latest.created_by
        latest.ssh_credential_id = ssh_credential_id or latest.ssh_credential_id
        latest.job_id = job_id or latest.job_id
        db.add(latest)
        return latest

    backup = DeviceConfigBackup(
        device_id=device.id,
        snapshot=snapshot,
        status=status or device.config_status or "Configuration backup saved.",
        source=source,
        platform=device.platform or "",
        config_hash=digest,
        bytes=len(snapshot.encode("utf-8", errors="replace")),
        ssh_credential_id=ssh_credential_id,
        job_id=job_id,
        created_by=created_by,
    )
    db.add(backup)
    db.flush()
    prune_config_backups(db, device.id)
    return backup


def prune_config_backups(db: Session, device_id: int, keep: int = MAX_CONFIG_BACKUPS_PER_DEVICE) -> int:
    backups = list_config_backups(db, device_id)
    removed = 0
    for backup in backups[keep:]:
        db.delete(backup)
        removed += 1
    return removed


def restore_config_backup(db: Session, device: Device, backup: DeviceConfigBackup, restored_by: str = "") -> None:
    device.configuration_snapshot = backup.snapshot or ""
    device.config_status = f"Configuration restored from backup #{backup.id}."
    if backup.platform and (not device.platform or device.platform.lower() in {"unknown", "windows"}):
        device.platform = backup.platform
    db.add(device)


def _datetime_to_string(value: datetime | None) -> str | None:
    if not value:
        return None
    return value.isoformat()
