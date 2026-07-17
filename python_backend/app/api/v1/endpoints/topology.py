import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
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


class TopologyIngestRequest(BaseModel):
    node_ids: list[str] = Field(default_factory=list)
    full_scan: bool = False
    site_id: int | None = None
    site_name: str = ""
    location: str = ""
    room: str = ""
    rack: str = ""
    rack_id: str = ""
    rack_key: str = ""
    snmp_credential_id: int | None = None
    ssh_credential_id: int | None = None


@router.get("", response_model=dict)
def get_topology(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    devices = db.query(Device).order_by(Device.name.asc()).all()
    links = db.query(DeviceLink).order_by(DeviceLink.last_seen_at.desc(), DeviceLink.id.desc()).all()

    nodes = {}
    device_node_ids: dict[int, str] = {}
    devices_by_id = {device.id: device for device in devices}
    for device in devices:
        node_id = _node_id(device.management_ip, device.name, device.id)
        device_node_ids[device.id] = node_id
        _merge_node(nodes, node_id, {
            "id": node_id,
            "device_id": device.id,
            "name": device.name,
            "ip": device.management_ip,
            "status": device.status,
            "role": device.role,
            "site": device.site.name if device.site else "",
            "managed": True,
            "ingest_status": "Ingested",
        })

    serialized_links_by_key = {}
    for link in links:
        if _link_has_stale_device_reference(link, devices_by_id):
            continue
        local_device = devices_by_id.get(link.local_device_id or 0)
        remote_device = devices_by_id.get(link.remote_device_id or 0)
        local_is_managed = local_device is not None
        remote_is_managed = remote_device is not None
        source_id = (
            _node_id(link.local_ip, link.local_device_name, link.local_device_id)
            if link.local_ip or link.local_device_name
            else device_node_ids.get(link.local_device_id or 0, f"device:{link.local_device_id}")
        )
        target_id = (
            _node_id(link.remote_ip, link.remote_device_name, link.remote_device_id)
            if link.remote_ip or link.remote_device_name
            else device_node_ids.get(link.remote_device_id or 0, f"device:{link.remote_device_id}")
        )
        if link.local_device_id and link.local_device_id in device_node_ids:
            source_id = device_node_ids[link.local_device_id]
        if link.remote_device_id and link.remote_device_id in device_node_ids:
            target_id = device_node_ids[link.remote_device_id]

        _merge_node(nodes, source_id, {
                "id": source_id,
                "device_id": local_device.id if local_device else None,
                "name": local_device.name if local_device else (link.local_device_name or link.local_ip),
                "ip": local_device.management_ip if local_device else link.local_ip,
                "status": local_device.status if local_device else "Not ingested",
                "role": local_device.role if local_device else "Discovered Device",
                "site": local_device.site.name if local_device and local_device.site else "",
                "managed": local_is_managed,
                "ingest_status": "Ingested" if local_is_managed else "Not ingested",
        })
        _merge_node(nodes, target_id, {
                "id": target_id,
                "device_id": remote_device.id if remote_device else None,
                "name": remote_device.name if remote_device else (link.remote_device_name or link.remote_ip),
                "ip": remote_device.management_ip if remote_device else link.remote_ip,
                "status": remote_device.status if remote_device else "Not ingested",
                "role": remote_device.role if remote_device else "Neighbor",
                "site": remote_device.site.name if remote_device and remote_device.site else "",
                "managed": remote_is_managed,
                "ingest_status": "Ingested" if remote_is_managed else "Not ingested",
        })

        link_key = _physical_link_key(source_id, link.local_interface, target_id, link.remote_interface)
        serialized = _serialize_link(link, source_id, target_id, local_device, remote_device)
        if link_key in serialized_links_by_key:
            _merge_link(serialized_links_by_key[link_key], serialized)
            continue
        serialized_links_by_key[link_key] = serialized

    serialized_links = list(serialized_links_by_key.values())

    return {
        "message": "ok",
        "data": {
            "nodes": list(nodes.values()),
            "links": serialized_links,
            "summary": {"devices": len(devices), "nodes": len(nodes), "links": len(serialized_links)},
        },
    }


@router.get("/links", response_model=dict)
def list_links(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    links = db.query(DeviceLink).order_by(DeviceLink.last_seen_at.desc(), DeviceLink.id.desc()).all()
    devices_by_id = {device.id: device for device in db.query(Device).all()}
    return {
        "message": "ok",
        "data": {"data": [_serialize_link(link) for link in links if not _link_has_stale_device_reference(link, devices_by_id)]},
    }


@router.post("/ingest-neighbors", response_model=dict)
def ingest_neighbors(
    payload: TopologyIngestRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    node_ids = list(dict.fromkeys([node_id.strip() for node_id in payload.node_ids if node_id.strip()]))
    if not node_ids:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Select at least one discovered neighbor")

    selected_site = _selected_site(db, payload.site_id, payload.site_name)
    placement = _validated_placement(db, selected_site, payload.location, payload.room, payload.rack, payload.rack_id, payload.rack_key)
    job = start_job(db, "topology_neighbor_ingest", ",".join(node_ids[:5]), current_user.email, {
        "node_ids": node_ids,
        "full_scan": payload.full_scan,
        "site_id": selected_site.id if selected_site else None,
        "site_name": payload.site_name,
        "location": placement["location"],
        "room": placement["room"],
        "rack": placement["rack"],
        "rack_id": placement["rack_id"],
        "snmp_credential_id": payload.snmp_credential_id,
        "ssh_credential_id": payload.ssh_credential_id,
    })
    created = 0
    updated = 0
    scanned = 0
    configs_collected = 0
    skipped = 0
    results = []
    try:
        total_nodes = max(len(node_ids), 1)

        def report_ingest_progress(processed: int, phase: str, node_id: str) -> None:
            update_job_progress(db, job, 5 + int((processed / total_nodes) * 90), {
                "phase": phase,
                "processed": processed,
                "total": len(node_ids),
                "current_node": node_id,
                "created": created,
                "updated": updated,
                "scanned": scanned,
                "configs_collected": configs_collected,
                "skipped": skipped,
            })

        for index, node_id in enumerate(node_ids, start=1):
            candidate = _neighbor_candidate_for_node(db, node_id)
            if not candidate:
                skipped += 1
                results.append({"node_id": node_id, "status": "skipped", "reason": "Neighbor was not found or is already ingested"})
                report_ingest_progress(index, "ingesting", node_id)
                continue

            item = None
            if payload.full_scan and candidate.get("management_ip"):
                report_ingest_progress(max(index - 1, 0), "scanning_neighbor", node_id)
                scanned += 1
                item = _scan_single_neighbor(db, candidate["management_ip"], payload.snmp_credential_id, payload.ssh_credential_id)
                if item and item.get("configuration_snapshot"):
                    configs_collected += 1
            if not item:
                item = candidate

            device, was_created = _upsert_ingested_device(db, item, selected_site, placement)
            _attach_neighbor_links(db, candidate, device)
            created += 1 if was_created else 0
            updated += 0 if was_created else 1
            results.append({
                "node_id": node_id,
                "status": "created" if was_created else "updated",
                "device_id": device.id,
                "device_name": device.name,
                "management_ip": device.management_ip,
            })
            report_ingest_progress(index, "ingesting", node_id)
    except Exception as exc:
        fail_job(db, job, str(exc))
        db.commit()
        raise

    db.add(AuditLog(
        action="topology_neighbor_ingest",
        entity_type="device",
        entity_id=None,
        details=json.dumps({
            "user": current_user.email,
            "node_ids": node_ids,
            "full_scan": payload.full_scan,
            "created": created,
            "updated": updated,
            "scanned": scanned,
            "configs_collected": configs_collected,
            "skipped": skipped,
            "location": placement["location"],
            "room": placement["room"],
            "rack": placement["rack"],
            "rack_id": placement["rack_id"],
        }, default=str),
    ))
    complete_job(db, job, {
        "created": created,
        "updated": updated,
        "scanned": scanned,
        "configs_collected": configs_collected,
        "skipped": skipped,
        "results": results,
    })
    db.commit()
    return {
        "message": "Ingest complete",
        "data": {
            "created": created,
            "updated": updated,
            "scanned": scanned,
            "configs_collected": configs_collected,
            "skipped": skipped,
            "results": results,
        },
        "job_id": job.id,
    }


def _serialize_link(
    link: DeviceLink,
    source_id: str | None = None,
    target_id: str | None = None,
    local_device: Device | None = None,
    remote_device: Device | None = None,
) -> dict:
    return {
        "id": link.id,
        "source": source_id,
        "target": target_id,
        "local_device_id": local_device.id if local_device else None,
        "remote_device_id": remote_device.id if remote_device else None,
        "local_device_name": local_device.name if local_device else link.local_device_name,
        "local_ip": local_device.management_ip if local_device else link.local_ip,
        "local_interface": link.local_interface,
        "remote_device_name": remote_device.name if remote_device else link.remote_device_name,
        "remote_ip": remote_device.management_ip if remote_device else link.remote_ip,
        "remote_interface": link.remote_interface,
        "protocol": link.protocol,
        "details": _json_value(link.details),
        "discovered_at": _dt(link.discovered_at),
        "last_seen_at": _dt(link.last_seen_at),
    }


def _link_has_stale_device_reference(link: DeviceLink, devices_by_id: dict[int, Device]) -> bool:
    return bool(
        (link.local_device_id and link.local_device_id not in devices_by_id)
        or (link.remote_device_id and link.remote_device_id not in devices_by_id)
    )


def _physical_link_key(source_id: str, source_interface: str | None, target_id: str, target_interface: str | None) -> tuple[str, str]:
    endpoints = [
        f"{source_id}|{(source_interface or '').strip().lower()}",
        f"{target_id}|{(target_interface or '').strip().lower()}",
    ]
    return tuple(sorted(endpoints))


def _merge_link(existing: dict, candidate: dict) -> None:
    protocols = {part.strip().lower() for part in str(existing.get("protocol") or "").split("/") if part.strip()}
    protocols.update(part.strip().lower() for part in str(candidate.get("protocol") or "").split("/") if part.strip())
    existing["protocol"] = "/".join(sorted(protocols)) or existing.get("protocol") or candidate.get("protocol")
    if not existing.get("last_seen_at") and candidate.get("last_seen_at"):
        existing["last_seen_at"] = candidate["last_seen_at"]


def _node_id(ip: str | None, name: str | None = None, device_id: int | None = None) -> str:
    normalized_ip = (ip or "").strip().lower()
    if normalized_ip:
        return f"ip:{normalized_ip}"
    if device_id:
        return f"device:{device_id}"
    normalized_name = (name or "").strip().lower()
    return f"name:{normalized_name}" if normalized_name else "unknown"


def _merge_node(nodes: dict[str, dict], node_id: str, candidate: dict) -> None:
    existing = nodes.get(node_id)
    if not existing:
        nodes[node_id] = candidate
        return
    for key in ["device_id", "name", "ip", "status", "role", "site", "ingest_status"]:
        if not existing.get(key) and candidate.get(key):
            existing[key] = candidate[key]
    existing["managed"] = bool(existing.get("managed") or candidate.get("managed"))
    if existing["managed"]:
        existing["ingest_status"] = "Ingested"
        if existing.get("status") == "Not ingested":
            existing["status"] = candidate.get("status") or "Discovered"


def _json_value(value: str | None):
    if not value:
        return {}
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return value


def _dt(value) -> str | None:
    if not value:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc).isoformat()
        return value.isoformat()
    return str(value)


def _selected_site(db: Session, site_id: int | None, site_name: str) -> Site | None:
    if site_id is not None:
        site = db.query(Site).filter(Site.id == site_id).first()
        if not site:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Selected ingest site not found")
        return site
    site_name = site_name.strip()
    if not site_name:
        return None
    site = db.query(Site).filter(Site.name == site_name).first()
    if site:
        return site
    site = Site(name=site_name, location="Discovered")
    db.add(site)
    db.flush()
    return site


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


def _neighbor_candidate_for_node(db: Session, node_id: str) -> dict | None:
    links = db.query(DeviceLink).filter(DeviceLink.remote_device_id.is_(None)).order_by(DeviceLink.last_seen_at.desc()).all()
    for link in links:
        candidate_id = _node_id(link.remote_ip, link.remote_device_name, None)
        if candidate_id != node_id:
            continue
        name = (link.remote_device_name or "").strip() or (f"Discovered-{link.remote_ip}" if link.remote_ip else f"Discovered-neighbor-{link.id}")
        return _neighbor_candidate_from_link(link, "remote", name, link.remote_ip, link.remote_device_name, link.remote_interface)

    links = db.query(DeviceLink).filter(DeviceLink.local_device_id.is_(None)).order_by(DeviceLink.last_seen_at.desc()).all()
    for link in links:
        candidate_id = _node_id(link.local_ip, link.local_device_name, None)
        if candidate_id != node_id:
            continue
        name = (link.local_device_name or "").strip() or (f"Discovered-{link.local_ip}" if link.local_ip else f"Discovered-neighbor-{link.id}")
        return _neighbor_candidate_from_link(link, "local", name, link.local_ip, link.local_device_name, link.local_interface)
    return None


def _neighbor_candidate_from_link(link: DeviceLink, side: str, name: str, ip: str | None, hostname: str | None, interface: str | None) -> dict:
    return {
        "name": name,
        "hostname": hostname or "",
        "management_ip": ip or "",
        "role": "Neighbor Device",
        "status": "Active",
        "device_type": "Network Device",
        "discovery_source": "topology-neighbor",
        "description": "Ingested from LLDP/CDP topology neighbor table",
        "tags": "topology-neighbor,not-fully-scanned",
        "connection": "Ethernet",
        "interfaces": [{
            "name": interface or "uplink0",
            "ip": ip or "",
            "status": "up",
            "source": "topology-neighbor",
        }],
        "vlans": [],
        "vlan": 1,
        "snmp_status": "Not checked",
        "snmp_last_error": "",
        "config_status": "Not collected",
        "configuration_snapshot": "",
        "source_link_id": link.id,
        "source_link_side": side,
    }


def _scan_single_neighbor(db: Session, ip: str, snmp_credential_id: int | None = None, ssh_credential_id: int | None = None) -> dict | None:
    snmp_profile = _credential(db, snmp_credential_id, "snmp_v2c") if snmp_credential_id else None
    ssh_profile = _credential(db, ssh_credential_id, "ssh") if ssh_credential_id else None
    community = decrypt_secret(snmp_profile.secret_encrypted) if snmp_profile else _setting_value(db, "snmp_community")
    service = NetworkDiscoveryService(
        subnet=f"{ip}/32",
        max_hosts=1,
        snmp_community=community,
        snmp_port=snmp_profile.port if snmp_profile and snmp_profile.port else 161,
        ssh_username=ssh_profile.username if ssh_profile else "",
        ssh_password=decrypt_secret(ssh_profile.secret_encrypted) if ssh_profile else "",
        ssh_enable_password=decrypt_secret(ssh_profile.enable_secret_encrypted) if ssh_profile else "",
        ssh_port=ssh_profile.port if ssh_profile and ssh_profile.port else 22,
        collect_config=bool(ssh_profile),
    )
    discovered = service.discover()
    for item in discovered:
        if item.get("management_ip") == ip and _is_active_discovery(item):
            item["tags"] = ",".join(sorted(set(filter(None, str(item.get("tags") or "").split(",") + ["topology-neighbor", "full-scan-ingested"]))))
            item["snmp_credential_id"] = snmp_credential_id
            item["ssh_credential_id"] = ssh_credential_id
            return item
    return None


def _upsert_ingested_device(db: Session, item: dict, site: Site | None, placement: dict[str, str] | None = None) -> tuple[Device, bool]:
    device = _find_existing_device(db, item.get("name", ""), item.get("hostname", ""), item.get("management_ip", ""))
    created = device is None
    if device is None:
        device = Device(name=_unique_device_name(db, item.get("name") or item.get("hostname") or item.get("management_ip") or "Discovered Neighbor"))
        db.add(device)
        db.flush()

    for field in [
        "hostname",
        "management_ip",
        "role",
        "status",
        "device_type",
        "platform",
        "manufacturer",
        "model",
        "mac_address",
        "discovery_source",
        "description",
        "tags",
        "connection",
        "snmp_status",
        "snmp_last_error",
        "config_status",
        "configuration_snapshot",
        "snmp_credential_id",
        "ssh_credential_id",
    ]:
        value = item.get(field)
        if value not in (None, ""):
            setattr(device, field, value)
    device.site_id = site.id if site else device.site_id
    if placement:
        if placement.get("location"):
            device.location = placement["location"]
        if placement.get("room"):
            device.room = placement["room"]
        if placement.get("rack"):
            device.rack = placement["rack"]
    device.vlan = item.get("vlan") or device.vlan or 1
    if item.get("vlans") is not None:
        device.vlans = json.dumps(item.get("vlans") or [])
    if item.get("interfaces") is not None:
        device.interfaces = json.dumps(item.get("interfaces") or [])
    device.last_seen_at = datetime.now(timezone.utc)
    device.discovered_at = datetime.now(timezone.utc)
    return device, created


def _attach_neighbor_links(db: Session, candidate: dict, device: Device) -> None:
    filters = []
    side = candidate.get("source_link_side")
    if candidate.get("management_ip"):
        filters.append(DeviceLink.local_ip == candidate["management_ip"] if side == "local" else DeviceLink.remote_ip == candidate["management_ip"])
    if candidate.get("hostname") or candidate.get("name"):
        names = [value for value in [candidate.get("hostname"), candidate.get("name")] if value]
        filters.append(DeviceLink.local_device_name.in_(names) if side == "local" else DeviceLink.remote_device_name.in_(names))
    if not filters:
        return
    id_field = DeviceLink.local_device_id if side == "local" else DeviceLink.remote_device_id
    links = db.query(DeviceLink).filter(id_field.is_(None), or_(*filters)).all()
    for link in links:
        if side == "local":
            link.local_device_id = device.id
            link.local_device_name = device.name
            if device.management_ip:
                link.local_ip = device.management_ip
        else:
            link.remote_device_id = device.id
            link.remote_device_name = device.name
            if device.management_ip:
                link.remote_ip = device.management_ip
        link.last_seen_at = datetime.now(timezone.utc)


def _find_existing_device(db: Session, name: str, hostname: str, ip: str) -> Device | None:
    filters = []
    if ip:
        filters.append(Device.management_ip == ip)
    for value in {name, hostname}:
        if value:
            filters.extend([Device.name == value, Device.hostname == value])
    if not filters:
        return None
    return db.query(Device).filter(or_(*filters)).first()


def _unique_device_name(db: Session, base_name: str) -> str:
    name = base_name.strip() or "Discovered Neighbor"
    if not db.query(Device).filter(Device.name == name).first():
        return name
    suffix = 2
    while db.query(Device).filter(Device.name == f"{name}-{suffix}").first():
        suffix += 1
    return f"{name}-{suffix}"


def _setting_value(db: Session, key: str) -> str:
    row = db.query(AppConfig).filter(AppConfig.key == key).first()
    return row.value if row and row.value else ""


def _credential(db: Session, credential_id: int, credential_type: str) -> CredentialProfile:
    row = db.query(CredentialProfile).filter(CredentialProfile.id == credential_id).first()
    if not row or row.credential_type != credential_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{credential_type} credential profile not found")
    return row


def _is_active_discovery(item: dict) -> bool:
    return (
        item.get("status") == "Active"
        or item.get("snmp_status") == "OK"
        or bool(item.get("mac_address"))
        or bool(item.get("neighbors"))
    )
