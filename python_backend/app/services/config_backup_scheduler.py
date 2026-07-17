from datetime import datetime, timedelta, timezone

from app.db.session import SessionLocal
from app.models.app_config import AppConfig
from app.models.device import Device
from app.models.user import User

_running = False


DEFAULT_BACKUP_SETTINGS = {
    "device_config_backup_enabled": "false",
    "device_config_backup_interval_hours": "24",
    "device_config_backup_interval_unit": "hours",
    "device_config_backup_time": "02:00",
    "device_config_backup_scope": "active_with_ssh",
    "device_config_backup_timeout_seconds": "8",
    "device_config_backup_last_run_at": "",
}


def run_due_auto_config_backups() -> dict:
    global _running
    if _running:
        return {"status": "already_running"}
    db = SessionLocal()
    try:
        values = _settings(db)
        if values.get("device_config_backup_enabled") != "true":
            return {"status": "disabled"}
        if not _is_due(values):
            return {"status": "not_due"}

        _running = True
        _set_setting(db, "device_config_backup_last_run_at", datetime.now(timezone.utc).isoformat())
        user = db.query(User).filter(User.is_active.is_(True)).order_by(User.id.asc()).first()
        if not user:
            return {"status": "no_active_user"}

        from app.api.v1.endpoints.devices import _collect_device_configuration

        devices = _eligible_devices(db, values.get("device_config_backup_scope", "active_with_ssh"))
        backed_up = 0
        failed = 0
        timeout = float(values.get("device_config_backup_timeout_seconds") or 8)
        for device in devices:
            if not device.management_ip or not device.ssh_credential_id:
                continue
            try:
                _collect_device_configuration(
                    db,
                    device,
                    user,
                    timeout=timeout,
                    job_type="auto_device_config_backup",
                    audit_action="auto_backup_device_config",
                    backup_source="auto_backup",
                )
                backed_up += 1
            except Exception:
                failed += 1
        db.commit()
        return {"status": "completed", "checked": len(devices), "backed_up": backed_up, "failed": failed}
    finally:
        _running = False
        db.close()


def _settings(db) -> dict[str, str]:
    changed = False
    for key, value in DEFAULT_BACKUP_SETTINGS.items():
        if not db.query(AppConfig).filter(AppConfig.key == key).first():
            db.add(AppConfig(key=key, value=value, description="Automatic device configuration backup setting."))
            changed = True
    if changed:
        db.commit()
    return {row.key: row.value for row in db.query(AppConfig).filter(AppConfig.key.in_(DEFAULT_BACKUP_SETTINGS.keys())).all()}


def _is_due(values: dict[str, str]) -> bool:
    now = datetime.now(timezone.utc)
    if not _time_reached(values.get("device_config_backup_time") or "02:00", now):
        return False
    last_raw = values.get("device_config_backup_last_run_at") or ""
    if not last_raw:
        return True
    try:
        last = datetime.fromisoformat(last_raw)
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
    except ValueError:
        return True
    return now - last >= _backup_interval_delta(values)


def _backup_interval_delta(values: dict[str, str]) -> timedelta:
    try:
        amount = int(values.get("device_config_backup_interval_hours") or 24)
    except ValueError:
        amount = 24
    unit = values.get("device_config_backup_interval_unit") or "hours"
    if unit == "weeks":
        return timedelta(weeks=amount)
    if unit == "months":
        return timedelta(days=30 * amount)
    return timedelta(hours=amount)


def _time_reached(value: str, now: datetime) -> bool:
    try:
        hour_raw, minute_raw = value.split(":", 1)
        hour = int(hour_raw)
        minute = int(minute_raw)
    except ValueError:
        return True
    return (now.hour, now.minute) >= (hour, minute)


def _eligible_devices(db, scope: str) -> list[Device]:
    query = db.query(Device).order_by(Device.name.asc())
    if scope == "active_with_ssh":
        query = query.filter(Device.status == "Active", Device.ssh_credential_id.isnot(None))
    elif scope == "with_ssh":
        query = query.filter(Device.ssh_credential_id.isnot(None))
    return query.all()


def _set_setting(db, key: str, value: str) -> None:
    row = db.query(AppConfig).filter(AppConfig.key == key).first()
    if row:
        row.value = value
    else:
        db.add(AppConfig(key=key, value=value, description="Automatic device configuration backup setting."))
    db.commit()
