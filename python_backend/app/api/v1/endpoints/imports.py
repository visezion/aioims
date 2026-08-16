import csv
import io
import json

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.models.audit_log import AuditLog
from app.models.device import Device
from app.models.site import Site
from app.models.user import User

router = APIRouter()


@router.post("/devices-import")
def import_devices(file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(require_permission("inventory:write"))):
    contents = file.file.read().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(contents))
    created = 0
    updated = 0
    skipped = 0
    errors = []
    for row in reader:
        if not row.get("name"):
            skipped += 1
            continue
        row_number = reader.line_num
        site_name = (row.get("site") or "").strip()
        site = None
        if site_name:
            site = db.query(Site).filter(Site.name == site_name).first()
            if not site:
                site = Site(name=site_name)
                db.add(site)
                db.flush()

        management_ip = (row.get("management_ip") or "").strip()
        device = None
        if management_ip:
            device = db.query(Device).filter(Device.management_ip == management_ip).first()
        if not device:
            device = db.query(Device).filter(Device.name == row["name"]).first()

        duplicate = _find_duplicate_identity(db, row, device.id if device else None)
        if duplicate:
            skipped += 1
            errors.append({"row": row_number, "message": duplicate})
            continue

        if not device:
            device = Device(name=row.get("name") or "Unnamed")
            db.add(device)
            created += 1
        else:
            updated += 1

        for field in [
            "name",
            "hostname",
            "management_ip",
            "role",
            "status",
            "device_type",
            "platform",
            "manufacturer",
            "model",
            "serial_number",
            "asset_tag",
            "description",
            "tags",
            "connection",
            "location",
            "room",
            "rack",
            "owner",
            "tenant",
            "comments",
        ]:
            if row.get(field) is not None:
                setattr(device, field, row.get(field) or "")
        device.vlan = _int_or_default(row.get("vlan"), device.vlan or 1)
        if row.get("vlans") is not None:
            device.vlans = _json_list_or_default(row.get("vlans"), device.vlans or "[]")
        device.snmp_credential_id = _int_or_default(row.get("snmp_credential_id"), device.snmp_credential_id)
        device.ssh_credential_id = _int_or_default(row.get("ssh_credential_id"), device.ssh_credential_id)
        device.position = _int_or_default(row.get("position"), device.position)
        device.rack_units = max(1, _int_or_default(row.get("rack_units"), device.rack_units or 1) or 1)
        if row.get("power_consumption_w") is not None:
            device.power_consumption_w = _float_or_default(row.get("power_consumption_w"), device.power_consumption_w)
        device.interfaces = _interfaces_to_json(row.get("interfaces"), row.get("interface"), device.management_ip)
        if site:
            device.site_id = site.id
    db.add(AuditLog(
        action="import_devices",
        entity_type="device",
        entity_id=None,
        details=json.dumps({"user": current_user.email, "created": created, "updated": updated, "skipped": skipped}),
    ))
    db.commit()
    return {"message": "Import complete", "created": created, "updated": updated, "skipped": skipped, "errors": errors}


@router.get("/devices-export")
def export_devices(db: Session = Depends(get_db), current_user: User = Depends(require_permission("inventory:read"))):
    devices = db.query(Device).all()
    output = io.StringIO()
    writer = csv.writer(output)
    fields = [
        "name",
        "hostname",
        "management_ip",
        "role",
        "status",
        "device_type",
        "platform",
        "manufacturer",
        "model",
        "serial_number",
        "asset_tag",
        "site",
        "vlan",
        "vlans",
        "connection",
        "interfaces",
        "snmp_status",
        "snmp_last_error",
        "config_status",
        "configuration_snapshot",
        "snmp_credential_id",
        "ssh_credential_id",
        "location",
        "room",
        "rack",
        "position",
        "rack_units",
        "power_consumption_w",
        "owner",
        "tenant",
        "description",
        "tags",
        "comments",
    ]
    writer.writerow(fields)
    for device in devices:
        writer.writerow([
            device.name,
            device.hostname,
            device.management_ip,
            device.role,
            device.status,
            device.device_type,
            device.platform,
            device.manufacturer,
            device.model,
            device.serial_number,
            device.asset_tag,
            device.site.name if device.site else "",
            device.vlan,
            device.vlans,
            device.connection,
            device.interfaces,
            device.snmp_status,
            device.snmp_last_error,
            device.config_status,
            device.configuration_snapshot,
            device.snmp_credential_id or "",
            device.ssh_credential_id or "",
            device.location,
            device.room,
            device.rack,
            device.position or "",
            device.rack_units or 1,
            device.power_consumption_w if device.power_consumption_w is not None else "",
            device.owner,
            device.tenant,
            device.description,
            device.tags,
            device.comments,
        ])
    db.add(AuditLog(action="export_devices", entity_type="device", entity_id=None, details=current_user.email))
    db.commit()
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=aims-devices.csv"},
    )


def _find_duplicate_identity(db: Session, row: dict, device_id: int | None) -> str:
    for field, label in [
        ("management_ip", "Management IP"),
        ("serial_number", "Serial number"),
        ("asset_tag", "Asset tag"),
    ]:
        value = (row.get(field) or "").strip()
        if not value:
            continue
        query = db.query(Device).filter(getattr(Device, field) == value)
        if device_id is not None:
            query = query.filter(Device.id != device_id)
        existing = query.first()
        if existing:
            return f"{label} already belongs to {existing.name}"
    return ""


def _int_or_default(value, default):
    try:
        return int(value) if value not in (None, "") else default
    except (TypeError, ValueError):
        return default


def _float_or_default(value, default):
    try:
        return float(value) if value not in (None, "") else default
    except (TypeError, ValueError):
        return default


def _json_list_or_default(value, default):
    try:
        parsed = json.loads(value)
        if isinstance(parsed, list):
            return json.dumps(parsed)
    except (TypeError, ValueError):
        pass
    return default


def _interfaces_to_json(interfaces, fallback_name, fallback_ip):
    if interfaces:
        try:
            parsed = json.loads(interfaces)
            if isinstance(parsed, list):
                return json.dumps(parsed)
        except (TypeError, ValueError):
            pass
        rows = []
        for line in str(interfaces).splitlines():
            parts = [part.strip() for part in line.split(",")]
            if parts and parts[0]:
                rows.append({
                    "name": parts[0],
                    "ip": parts[1] if len(parts) > 1 else "",
                    "status": parts[2] if len(parts) > 2 else "up",
                })
        if rows:
            return json.dumps(rows)
    if fallback_name or fallback_ip:
        return json.dumps([{"name": fallback_name or "mgmt0", "ip": fallback_ip or "", "status": "up"}])
    return "[]"
