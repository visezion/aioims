import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.app_config import AppConfig
from app.models.audit_log import AuditLog
from app.models.device import Device
from app.models.site import Site
from app.models.user import User

router = APIRouter()

RESOURCE_NAMES = {"Sites", "Locations", "Rooms", "Racks", "VLANs", "IP Addresses", "Prefixes", "VRFs"}


class InfrastructureSave(BaseModel):
    records: list[dict[str, Any]] = Field(default_factory=list)


class InfrastructureDelete(BaseModel):
    ids: list[str] = Field(default_factory=list)
    keys: list[str] = Field(default_factory=list)
    records: list[dict[str, Any]] = Field(default_factory=list)


@router.get("/{resource}", response_model=dict)
def get_infrastructure(resource: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    resource = _normalize_resource(resource)
    records_row = _get_config(db, _records_key(resource))
    hidden_row = _get_config(db, _hidden_key(resource))
    return {
        "message": "ok",
        "data": {
            "resource": resource,
            "configured": records_row is not None,
            "records": _json_list(records_row.value if records_row else "[]"),
            "hidden_keys": _json_list(hidden_row.value if hidden_row else "[]"),
        },
    }


@router.put("/{resource}", response_model=dict)
def save_infrastructure(
    resource: str,
    payload: InfrastructureSave,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _normalize_resource(resource)
    records = [_clean_record(record) for record in payload.records if isinstance(record, dict)]
    records = _dedupe_records(resource, records)
    _set_config(db, _records_key(resource), records, f"Manual infrastructure records for {resource}.")
    saved_keys = {str(record.get("_merge_key") or "") for record in records}
    saved_keys.discard("")
    hidden_removed = 0
    if saved_keys:
        hidden_row = _get_config(db, _hidden_key(resource))
        hidden = {str(item) for item in _json_list(hidden_row.value if hidden_row else "[]") if str(item)}
        next_hidden = hidden.difference(saved_keys)
        hidden_removed = len(hidden) - len(next_hidden)
        if hidden_removed or hidden_row is not None:
            _set_config(db, _hidden_key(resource), sorted(next_hidden), f"Hidden derived infrastructure records for {resource}.")
    db.add(AuditLog(
        action="save_infrastructure_records",
        entity_type="infrastructure",
        entity_id=None,
        details=json.dumps({"user": current_user.email, "resource": resource, "records": len(records), "hidden_removed": hidden_removed}),
    ))
    db.commit()
    return {"message": "saved", "data": {"resource": resource, "records": len(records), "hidden_removed": hidden_removed}}


@router.post("/{resource}/bulk-delete", response_model=dict)
def delete_infrastructure_records(
    resource: str,
    payload: InfrastructureDelete,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _normalize_resource(resource)
    ids = {str(item) for item in payload.ids if str(item)}
    keys = {str(item) for item in payload.keys if str(item)}
    requested_records = [_clean_record(record) for record in payload.records if isinstance(record, dict)]
    keys.update(str(record.get("_merge_key") or "") for record in requested_records)
    keys.discard("")

    records_row = _get_config(db, _records_key(resource))
    records = _json_list(records_row.value if records_row else "[]")
    kept = []
    deleted = []
    for record in records:
        record_id = str(record.get("id") or "")
        record_key = str(record.get("_merge_key") or "")
        if record_id in ids or (record_key and record_key in keys):
            deleted.append(record)
        else:
            kept.append(record)
    _set_config(db, _records_key(resource), kept, f"Manual infrastructure records for {resource}.")

    hidden_row = _get_config(db, _hidden_key(resource))
    hidden = {str(item) for item in _json_list(hidden_row.value if hidden_row else "[]") if str(item)}
    hidden.update(keys)
    _set_config(db, _hidden_key(resource), sorted(hidden), f"Hidden derived infrastructure records for {resource}.")

    affected_records = requested_records + deleted
    deleted_sites = _delete_matching_sites(db, affected_records, current_user) if resource == "Sites" else 0
    cleared_rack_devices = _clear_matching_rack_assignments(db, affected_records) if resource == "Racks" else 0
    db.add(AuditLog(
        action="delete_infrastructure_records",
        entity_type="infrastructure",
        entity_id=None,
        details=json.dumps({
            "user": current_user.email,
            "resource": resource,
            "ids": sorted(ids),
            "keys": sorted(keys),
            "stored_records_deleted": len(deleted),
            "sites_deleted": deleted_sites,
            "rack_device_assignments_cleared": cleared_rack_devices,
        }),
    ))
    db.commit()
    return {
        "message": "deleted",
        "data": {
            "resource": resource,
            "deleted": len(deleted),
            "hidden": len(keys),
            "sites_deleted": deleted_sites,
            "rack_device_assignments_cleared": cleared_rack_devices,
        },
    }


def _normalize_resource(resource: str) -> str:
    normalized = resource.replace("-", " ").strip()
    for allowed in RESOURCE_NAMES:
        if allowed.lower() == normalized.lower():
            return allowed
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Infrastructure resource not found")


def _records_key(resource: str) -> str:
    return f"infrastructure:{resource}:records"


def _hidden_key(resource: str) -> str:
    return f"infrastructure:{resource}:hidden"


def _get_config(db: Session, key: str) -> AppConfig | None:
    return db.query(AppConfig).filter(AppConfig.key == key).first()


def _set_config(db: Session, key: str, value: Any, description: str) -> AppConfig:
    row = _get_config(db, key)
    encoded = json.dumps(value)
    if not row:
        row = AppConfig(key=key, value=encoded, description=description)
        db.add(row)
    else:
        row.value = encoded
        row.description = description
    return row


def _json_list(value: str) -> list[Any]:
    try:
        parsed = json.loads(value or "[]")
        return parsed if isinstance(parsed, list) else []
    except (TypeError, ValueError):
        return []


def _clean_record(record: dict[str, Any]) -> dict[str, Any]:
    clean: dict[str, Any] = {}
    for key, value in record.items():
        if isinstance(value, (str, int, float, bool)) or value is None:
            clean[key] = value
        elif isinstance(value, (list, dict)):
            clean[key] = value
    return clean


def _dedupe_records(resource: str, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if resource != "Locations":
        return records
    by_name: dict[str, dict[str, Any]] = {}
    ordered_keys: list[str] = []
    for record in records:
        name = str(record.get("name") or "").strip()
        if not name:
            continue
        key = name.lower()
        normalized = {**record, "name": name}
        existing = by_name.get(key)
        if not existing:
            by_name[key] = normalized
            ordered_keys.append(key)
            continue
        by_name[key] = _merge_location_records(existing, normalized)
    return [by_name[key] for key in ordered_keys]


def _merge_location_records(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = {**existing}
    for key, value in incoming.items():
        if key in {"id", "name", "source", "_merge_key"}:
            continue
        if value in (None, "", []):
            continue
        current = merged.get(key)
        if current in (None, "", []):
            merged[key] = value
        elif key in {"relatedDeviceIds", "relatedWirelessKeys"} and isinstance(current, list) and isinstance(value, list):
            merged[key] = list(dict.fromkeys([*current, *value]))
        elif key == "devices":
            try:
                merged[key] = max(int(current or 0), int(value or 0))
            except (TypeError, ValueError):
                pass
    return merged


def _clear_matching_rack_assignments(db: Session, records: list[dict[str, Any]]) -> int:
    cleared = 0
    cleared_ids: set[int] = set()
    for record in records:
        related_ids = _int_list(record.get("relatedDeviceIds"))
        if related_ids:
            devices = db.query(Device).filter(Device.id.in_(related_ids)).all()
        else:
            rack_name = str(record.get("name") or "").strip()
            if not rack_name:
                continue
            devices = db.query(Device).all()
            location = str(record.get("location") or "").strip()
            site_name = str(record.get("site") or "").strip()
            devices = [
                device for device in devices
                if _same_text(device.rack, rack_name)
                and (not location or _same_text(device.location, location))
                and (not site_name or not device.site or _same_text(device.site.name, site_name))
            ]
        for device in devices:
            if device.id in cleared_ids:
                continue
            device.rack = ""
            device.position = None
            cleared_ids.add(device.id)
            cleared += 1
    return cleared


def _int_list(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    ids = []
    for item in value:
        try:
            ids.append(int(item))
        except (TypeError, ValueError):
            continue
    return ids


def _same_text(a: Any, b: Any) -> bool:
    return str(a or "").strip().lower() == str(b or "").strip().lower()


def _delete_matching_sites(db: Session, records: list[dict[str, Any]], current_user: User) -> int:
    names = {str(record.get("name") or "").strip() for record in records}
    names.update(str(record.get("site") or "").strip() for record in records)
    names.discard("")
    if not names:
        return 0
    sites = db.query(Site).filter(Site.name.in_(names)).all()
    for site in sites:
        db.add(AuditLog(action="delete_site", entity_type="site", entity_id=site.id, details=f"{current_user.email}: {site.name}"))
        db.query(Device).filter(Device.site_id == site.id).update({Device.site_id: None})
        db.delete(site)
    return len(sites)
