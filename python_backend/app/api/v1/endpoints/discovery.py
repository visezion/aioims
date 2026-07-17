import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.secret_store import decrypt_secret
from app.models.app_config import AppConfig
from app.models.audit_log import AuditLog
from app.models.credential_profile import CredentialProfile
from app.models.device import Device
from app.models.device_link import DeviceLink
from app.models.site import Site
from app.models.user import User
from app.services.discovery import NetworkDiscoveryService
from app.services.jobs import complete_job, fail_job, start_job, update_job_progress

router = APIRouter()


@router.post("/scan")
def scan_network(
    subnet: str = "192.168.1.0/24",
    max_hosts: int = 64,
    site_id: int | None = None,
    site_name: str = "",
    location: str = "",
    room: str = "",
    rack: str = "",
    rack_id: str = "",
    rack_key: str = "",
    snmp_credential_id: int | None = None,
    ssh_credential_id: int | None = None,
    collect_config: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    snmp_profile = _credential(db, snmp_credential_id, "snmp_v2c") if snmp_credential_id else None
    ssh_profile = _credential(db, ssh_credential_id, "ssh") if ssh_credential_id else None
    effective_collect_config = collect_config or bool(ssh_profile)
    snmp_community = decrypt_secret(snmp_profile.secret_encrypted) if snmp_profile else _setting_value(db, "snmp_community")
    snmp_port = snmp_profile.port if snmp_profile and snmp_profile.port else 161
    selected_site = _selected_site(db, site_id)
    placement = _validated_placement(db, selected_site, location, room, rack, rack_id, rack_key)
    job = start_job(db, "network_scan", subnet, current_user.email, {
        "subnet": subnet,
        "max_hosts": max_hosts,
        "site_id": site_id,
        "site_name": site_name,
        "location": placement["location"],
        "room": placement["room"],
        "rack": placement["rack"],
        "rack_id": placement["rack_id"],
        "snmp_credential_id": snmp_credential_id,
        "ssh_credential_id": ssh_credential_id,
        "collect_config": effective_collect_config,
    })

    def report_scan_progress(checked: int, total: int, current_ip: str) -> None:
        progress = 5 + int((checked / max(total, 1)) * 75)
        update_job_progress(db, job, progress, {
            "phase": "scanning",
            "checked": checked,
            "total": total,
            "current_ip": current_ip,
        })

    service = NetworkDiscoveryService(
        subnet=subnet,
        max_hosts=max_hosts,
        snmp_community=snmp_community,
        snmp_port=snmp_port,
        ssh_username=ssh_profile.username if ssh_profile else "",
        ssh_password=decrypt_secret(ssh_profile.secret_encrypted) if ssh_profile else "",
        ssh_enable_password=decrypt_secret(ssh_profile.enable_secret_encrypted) if ssh_profile else "",
        ssh_port=ssh_profile.port if ssh_profile and ssh_profile.port else 22,
        collect_config=effective_collect_config,
        progress_callback=report_scan_progress,
    )
    try:
        discovered = service.discover()
        created = 0
        updated = 0
        skipped_offline = 0
        configs_collected = 0
        total_discovered = max(len(discovered), 1)

        def report_save_progress(processed: int) -> None:
            update_job_progress(db, job, 80 + int((processed / total_discovered) * 15), {
                "phase": "saving",
                "processed": processed,
                "total": len(discovered),
                "created": created,
                "updated": updated,
                "skipped_offline": skipped_offline,
                "configs_collected": configs_collected,
            })

        for index, item in enumerate(discovered, start=1):
            if item.get("configuration_snapshot"):
                configs_collected += 1
            exists = db.query(Device).filter(Device.management_ip == item["management_ip"]).first()
            if exists:
                if selected_site:
                    exists.site_id = selected_site.id
                _apply_device_placement(exists, placement)
                exists.status = item.get("status", exists.status)
                exists.hostname = item.get("hostname", exists.hostname)
                exists.mac_address = item.get("mac_address", exists.mac_address)
                exists.discovery_source = item.get("discovery_source", exists.discovery_source)
                for field in ["name", "platform", "manufacturer", "model", "description"]:
                    if item.get(field):
                        setattr(exists, field, item[field])
                exists.vlan = item.get("vlan", exists.vlan)
                if item.get("vlans") or item.get("snmp_status") == "OK":
                    exists.vlans = json.dumps(item.get("vlans", []))
                exists.connection = item.get("connection", exists.connection)
                if item.get("interfaces") and (item.get("snmp_status") == "OK" or item.get("configuration_snapshot") or not _has_named_json_items(exists.interfaces)):
                    exists.interfaces = json.dumps(item.get("interfaces", []))
                exists.snmp_status = item.get("snmp_status", exists.snmp_status)
                exists.snmp_last_error = item.get("snmp_last_error", exists.snmp_last_error)
                exists.config_status = item.get("config_status", exists.config_status)
                exists.configuration_snapshot = item.get("configuration_snapshot", exists.configuration_snapshot)
                exists.snmp_credential_id = snmp_credential_id or exists.snmp_credential_id
                exists.ssh_credential_id = ssh_credential_id or exists.ssh_credential_id
                exists.last_seen_at = datetime.now(timezone.utc)
                exists.discovered_at = datetime.now(timezone.utc)
                updated += 1
                _upsert_device_links(db, exists, item)
                report_save_progress(index)
                continue
            if not _is_active_discovery(item):
                skipped_offline += 1
                report_save_progress(index)
                continue
            clean_site_name = site_name.strip()
            site = selected_site or (db.query(Site).filter(Site.name == clean_site_name).first() if clean_site_name else None)
            if not site and clean_site_name:
                site = Site(name=clean_site_name, location="Discovered")
                db.add(site)
                db.flush()
            device = Device(
                name=item["name"],
                hostname=item.get("hostname", ""),
                management_ip=item.get("management_ip", ""),
                role=item.get("role", "Other"),
                status=item.get("status", "Active"),
                platform=item.get("platform", ""),
                manufacturer=item.get("manufacturer", ""),
                model=item.get("model", ""),
                mac_address=item.get("mac_address", ""),
                discovery_source=item.get("discovery_source", ""),
                description=item.get("description", ""),
                tags=item.get("tags", ""),
                site_id=site.id if site else None,
                location=placement["location"],
                room=placement["room"],
                rack=placement["rack"],
                vlan=item.get("vlan", 1),
                vlans=json.dumps(item.get("vlans", [])),
                connection=item.get("connection", "Ethernet"),
                interfaces=json.dumps(item.get("interfaces", [])),
                snmp_status=item.get("snmp_status", "Not checked"),
                snmp_last_error=item.get("snmp_last_error", ""),
                config_status=item.get("config_status", "Not collected"),
                configuration_snapshot=item.get("configuration_snapshot", ""),
                snmp_credential_id=snmp_credential_id,
                ssh_credential_id=ssh_credential_id,
                last_seen_at=datetime.now(timezone.utc),
                discovered_at=datetime.now(timezone.utc),
            )
            db.add(device)
            db.flush()
            _upsert_device_links(db, device, item)
            created += 1
            report_save_progress(index)
    except Exception as exc:
        fail_job(db, job, str(exc))
        db.commit()
        raise
    db.add(AuditLog(
        action="discovery_scan",
        entity_type="device",
        entity_id=None,
        details=json.dumps({
            "user": current_user.email,
            "subnet": subnet,
            "discovered": len(discovered),
            "created": created,
            "updated": updated,
            "skipped_offline": skipped_offline,
            "site_id": site_id,
            "site_name": site_name,
            "location": placement["location"],
            "room": placement["room"],
            "rack": placement["rack"],
            "rack_id": placement["rack_id"],
            "snmp_credential_id": snmp_credential_id,
            "ssh_credential_id": ssh_credential_id,
            "collect_config": effective_collect_config,
            "configs_collected": configs_collected,
        }),
    ))
    complete_job(db, job, {
        "discovered": len(discovered),
        "created": created,
        "updated": updated,
        "skipped_offline": skipped_offline,
        "configs_collected": configs_collected,
    })
    db.commit()
    return {
        "message": "Scan complete",
        "discovered": len(discovered),
        "created": created,
        "updated": updated,
        "skipped_offline": skipped_offline,
        "configs_collected": configs_collected,
        "job_id": job.id,
    }


def _validated_placement(db: Session, site: Site | None, location: str, room: str, rack: str, rack_id: str, rack_key: str) -> dict[str, str]:
    placement = {
        "location": (location or "").strip(),
        "room": (room or "").strip(),
        "rack": "",
        "rack_id": "",
    }
    requested_rack = (rack or "").strip()
    requested_rack_id = (rack_id or "").strip()
    requested_rack_key = (rack_key or "").strip().lower()
    if not requested_rack and not requested_rack_id and not requested_rack_key:
        return placement

    selected = _matching_rack_record(db, site, placement["location"], placement["room"], requested_rack, requested_rack_id, requested_rack_key)
    if not selected:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Selected rack was not found in infrastructure. Create/select an existing rack before assigning scanned devices.")
    placement["location"] = str(selected.get("location") or placement["location"]).strip()
    placement["room"] = str(selected.get("region") or placement["room"]).strip()
    placement["rack"] = str(selected.get("name") or requested_rack).strip()
    placement["rack_id"] = str(selected.get("id") or requested_rack_id).strip()
    return placement


def _matching_rack_record(db: Session, site: Site | None, location: str, room: str, rack: str, rack_id: str, rack_key: str) -> dict | None:
    records = _infrastructure_records(db, "Racks")
    for record in records:
        if rack_id and str(record.get("id") or "").strip() == rack_id:
            return record
        if rack_key and _rack_record_key(record) == rack_key:
            return record
    for record in records:
        if rack and not _same_text(record.get("name"), rack):
            continue
        if site and not _same_text(record.get("site"), site.name):
            continue
        if location and not _same_text(record.get("location"), location):
            continue
        if room and not _same_text(record.get("region"), room):
            continue
        return record
    return None


def _infrastructure_records(db: Session, resource: str) -> list[dict]:
    row = db.query(AppConfig).filter(AppConfig.key == f"infrastructure:{resource}:records").first()
    try:
        parsed = json.loads(row.value if row else "[]")
    except (TypeError, ValueError):
        return []
    return [item for item in parsed if isinstance(item, dict)]


def _rack_record_key(record: dict) -> str:
    return "|".join(str(record.get(key) or "").strip().lower() for key in ["id", "site", "location", "region", "name"])


def _same_text(left, right) -> bool:
    return str(left or "").strip().lower() == str(right or "").strip().lower()


def _apply_device_placement(device: Device, placement: dict[str, str]) -> None:
    if placement.get("location"):
        device.location = placement["location"]
    if placement.get("room"):
        device.room = placement["room"]
    if placement.get("rack"):
        device.rack = placement["rack"]


def _selected_site(db: Session, site_id: int | None) -> Site | None:
    if site_id is None:
        return None
    site = db.query(Site).filter(Site.id == site_id).first()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selected scan site not found")
    return site


def _setting_value(db: Session, key: str) -> str:
    row = db.query(AppConfig).filter(AppConfig.key == key).first()
    return row.value if row and row.value else ""


def _credential(db: Session, credential_id: int, credential_type: str) -> CredentialProfile:
    row = db.query(CredentialProfile).filter(CredentialProfile.id == credential_id).first()
    if not row or row.credential_type != credential_type:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{credential_type} credential profile not found")
    return row


def _has_named_json_items(value: str | None) -> bool:
    if not value:
        return False
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return False
    return isinstance(parsed, list) and any(isinstance(item, dict) and item.get("name") for item in parsed)


def _is_active_discovery(item: dict) -> bool:
    return (
        item.get("status") == "Active"
        or item.get("snmp_status") == "OK"
        or bool(item.get("mac_address"))
        or bool(item.get("neighbors"))
    )


def _upsert_device_links(db: Session, device: Device, item: dict) -> None:
    now = datetime.now(timezone.utc)
    for neighbor in item.get("neighbors") or []:
        remote_name = str(neighbor.get("remote_name") or neighbor.get("remote_chassis_id") or "").strip()
        remote_ip = str(neighbor.get("remote_ip") or "").strip()
        remote_interface = str(neighbor.get("remote_interface") or "").strip()
        local_interface = str(neighbor.get("local_interface") or "").strip()
        protocol = str(neighbor.get("protocol") or "neighbor").strip().lower()
        if not remote_name and not remote_ip:
            continue

        remote_device = _find_remote_device(db, remote_name, remote_ip, device.id)
        existing = db.query(DeviceLink).filter(
            DeviceLink.local_device_id == device.id,
            DeviceLink.local_interface == local_interface,
            DeviceLink.remote_device_name == remote_name,
            DeviceLink.remote_ip == remote_ip,
            DeviceLink.remote_interface == remote_interface,
            DeviceLink.protocol == protocol,
        ).first()
        if not existing:
            existing = DeviceLink(
                local_device_id=device.id,
                discovered_at=now,
            )
            db.add(existing)

        existing.remote_device_id = remote_device.id if remote_device else None
        existing.local_device_name = device.name
        existing.local_ip = device.management_ip or ""
        existing.local_interface = local_interface
        existing.remote_device_name = remote_name
        existing.remote_ip = remote_ip
        existing.remote_interface = remote_interface
        existing.protocol = protocol
        existing.details = json.dumps(neighbor, default=str)
        existing.last_seen_at = now


def _find_remote_device(db: Session, remote_name: str, remote_ip: str, local_device_id: int | None) -> Device | None:
    filters = []
    if remote_ip:
        filters.append(Device.management_ip == remote_ip)
    if remote_name:
        filters.extend([Device.name == remote_name, Device.hostname == remote_name])
    if not filters:
        return None
    query = db.query(Device).filter(or_(*filters))
    if local_device_id:
        query = query.filter(Device.id != local_device_id)
    return query.first()
