import json
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Callable

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.api.v1.endpoints.discovery import _upsert_device_links
from app.core.secret_store import decrypt_secret
from app.db.session import SessionLocal
from app.models.app_config import AppConfig
from app.models.audit_log import AuditLog
from app.models.credential_profile import CredentialProfile
from app.models.device import Device
from app.models.device_link import DeviceLink
from app.models.site import Site
from app.models.trace_snapshot import TraceSnapshot
from app.models.user import User
from app.services.discovery import NetworkDiscoveryService
from app.services.jobs import complete_job, fail_job, start_job, update_job_progress
from app.services.snmp import SnmpLayer2TraceService

router = APIRouter()
TraceProgressCallback = Callable[[str, int, str], None]
_trace_jobs: dict[str, dict] = {}
_trace_jobs_lock = threading.Lock()
_trace_inventory_write_lock = threading.Lock()


class NodeCredentialSelection(BaseModel):
    snmp_credential_id: int | None = None
    ssh_credential_id: int | None = None


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
    node_credentials: dict[str, NodeCredentialSelection] = Field(default_factory=dict)


class TraceJobRequest(BaseModel):
    query: str = ""
    refresh: bool = False


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


@router.get("/trace", response_model=dict)
def trace_connected_devices(
    query: str = "",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    saved_trace = _load_saved_trace(db, query)
    if saved_trace:
        return {"message": "ok", "data": saved_trace}
    response = _run_device_trace(query, db, current_user)
    return {"message": "ok", "data": _save_trace_snapshot(db, query, response["data"], current_user.email)}


def _run_device_trace(
    query: str,
    db: Session,
    current_user: User,
    progress: TraceProgressCallback | None = None,
):
    search = query.strip()
    if not search:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Enter an IP address or MAC address to trace")

    _report_trace_progress(progress, "topology", 8, "Checking saved topology and device inventory")
    trace = _trace_connected_devices(db, search)
    requires_live_trace = _trace_requires_live_lookup(trace, search)
    if requires_live_trace:
        try:
            live_trace = _trace_via_snmp(db, search, progress)
            if live_trace["roots"] or not trace["roots"]:
                trace = live_trace
        except OperationalError:
            db.rollback()
            trace.setdefault("live_snmp", {})["refresh_warning"] = "Topology refresh is busy. Showing the most recently verified route."
    if trace.get("live_snmp", {}).get("used"):
        try:
            # Finish trace-time link refreshes before adding a newly discovered
            # switch. This releases SQLite's transaction before a new writer runs.
            db.commit()
            discovered_neighbors: list[Device] = []
            # A MAC learned on a trunk can reveal a new CDP/LLDP neighbor. Ingest
            # that switch, then repeat the live lookup from the newly managed hop.
            for _ in range(8):
                newly_discovered = _auto_ingest_trace_neighbors(db, trace)
                if not newly_discovered:
                    break
                _report_trace_progress(progress, "neighbors", 82, f"Adding {len(newly_discovered)} discovered neighbor switch(es)")
                known_ids = {device.id for device in discovered_neighbors}
                discovered_neighbors.extend(device for device in newly_discovered if device.id not in known_ids)
                db.flush()
                try:
                    trace = _trace_via_snmp(db, search, progress)
                    db.commit()
                except OperationalError:
                    db.rollback()
                    trace.setdefault("live_snmp", {})["refresh_warning"] = "Topology refresh is busy. Newly discovered switches will be included on the next trace."
                    break
            if discovered_neighbors or trace.get("live_snmp", {}).get("neighbor_scans"):
                if discovered_neighbors:
                    trace["live_snmp"]["discovered_neighbors"] = [device.name for device in discovered_neighbors]
                db.add(AuditLog(
                    action="trace_neighbor_auto_ingest",
                    entity_type="device",
                    entity_id=discovered_neighbors[0].id if discovered_neighbors else None,
                    details=json.dumps({"user": current_user.email, "query": search, "device_ids": [device.id for device in discovered_neighbors], "neighbor_scans": trace["live_snmp"].get("neighbor_scans", [])}),
                ))
                db.commit()
        except Exception as exc:
            db.rollback()
            trace.setdefault("live_snmp", {})["neighbor_discovery_error"] = str(exc)
    if not trace["roots"]:
        detail = trace.get("live_snmp", {}).get("message") or "No device or discovered neighbor matches that IP or MAC address"
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)
    _report_trace_progress(progress, "complete", 100, "Route assembled and ready to display")
    return {"message": "ok", "data": trace}


@router.post("/trace/jobs", response_model=dict)
def start_trace_job(
    payload: TraceJobRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    query = payload.query.strip()
    if not query:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Enter an IP address or MAC address to trace")
    job_id = uuid.uuid4().hex
    with _trace_jobs_lock:
        _trace_jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "stage": "queued",
            "percent": 2,
            "detail": "Trace request queued",
            "query": query,
            "refresh": payload.refresh,
            "created_at": _dt(datetime.now(timezone.utc)),
        }
    background_tasks.add_task(_trace_job_worker, job_id, query, current_user.email, payload.refresh)
    return {"message": "ok", "data": _trace_job_snapshot(job_id)}


@router.get("/trace/jobs/{job_id}", response_model=dict)
def get_trace_job(job_id: str, current_user: User = Depends(get_current_user)):
    snapshot = _trace_job_snapshot(job_id)
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trace job not found or expired")
    return {"message": "ok", "data": snapshot}


def _trace_job_worker(job_id: str, query: str, user_email: str, refresh: bool = False) -> None:
    db = SessionLocal()
    try:
        if not refresh:
            saved_trace = _load_saved_trace(db, query)
            if saved_trace:
                _update_trace_job(job_id, status="completed", stage="complete", percent=100, detail="Loaded saved trace", result=saved_trace)
                return
        _update_trace_job(job_id, status="running", stage="starting", percent=5, detail="Starting live SNMP trace")
        response = _run_device_trace(
            query,
            db,
            User(email=user_email),
            lambda stage, percent, detail: _update_trace_job(job_id, stage=stage, percent=percent, detail=detail),
        )
        saved_trace = _save_trace_snapshot(db, query, response["data"], user_email)
        _update_trace_job(job_id, status="completed", stage="complete", percent=100, detail="Route saved", result=saved_trace)
    except HTTPException as exc:
        _update_trace_job(job_id, status="failed", stage="failed", percent=100, detail=str(exc.detail), error=str(exc.detail))
    except Exception as exc:
        db.rollback()
        _update_trace_job(job_id, status="failed", stage="failed", percent=100, detail="Trace failed", error=str(exc))
    finally:
        db.close()


def _report_trace_progress(progress: TraceProgressCallback | None, stage: str, percent: int, detail: str) -> None:
    if progress:
        progress(stage, percent, detail)


def _update_trace_job(job_id: str, **values) -> None:
    with _trace_jobs_lock:
        if job_id in _trace_jobs:
            _trace_jobs[job_id].update(values)
            _trace_jobs[job_id]["updated_at"] = _dt(datetime.now(timezone.utc))


def _trace_job_snapshot(job_id: str) -> dict | None:
    with _trace_jobs_lock:
        job = _trace_jobs.get(job_id)
        return dict(job) if job else None


def _trace_snapshot_key(query: str) -> str:
    search = query.strip()
    normalized_mac = _normalize_mac(search)
    if len(normalized_mac) == 12:
        return f"mac:{normalized_mac}"
    if _is_ipv4_address(search):
        return f"ip:{search}"
    return f"query:{search.casefold()}" if search else ""


def _load_saved_trace(db: Session, query: str) -> dict | None:
    key = _trace_snapshot_key(query)
    if not key:
        return None
    snapshot = db.query(TraceSnapshot).filter(TraceSnapshot.query_key == key).first()
    if not snapshot:
        return None
    try:
        trace = json.loads(snapshot.trace_data)
    except (TypeError, ValueError):
        return None
    if not isinstance(trace, dict) or not trace.get("nodes"):
        return None
    trace["query"] = query.strip() or snapshot.query
    trace["saved_trace"] = {
        "saved": True,
        "last_traced_at": _dt(snapshot.last_traced_at or snapshot.updated_at or snapshot.created_at),
    }
    return trace


def _save_trace_snapshot(db: Session, query: str, trace: dict, user_email: str) -> dict:
    key = _trace_snapshot_key(query)
    if not key:
        return trace
    snapshot_trace = dict(trace)
    snapshot_trace.pop("saved_trace", None)
    payload = json.dumps(snapshot_trace)
    for attempt in range(4):
        try:
            with _trace_inventory_write_lock:
                snapshot = db.query(TraceSnapshot).filter(TraceSnapshot.query_key == key).first()
                if not snapshot:
                    snapshot = TraceSnapshot(query_key=key, created_by=user_email)
                    db.add(snapshot)
                snapshot.query = query.strip()
                snapshot.trace_data = payload
                snapshot.last_traced_at = datetime.now(timezone.utc)
                db.commit()
                trace["saved_trace"] = {
                    "saved": True,
                    "last_traced_at": _dt(snapshot.last_traced_at),
                }
                return trace
        except OperationalError as exc:
            db.rollback()
            if "database is locked" not in str(exc).lower() or attempt == 3:
                break
            time.sleep(0.5 * (attempt + 1))
    trace["saved_trace"] = {
        "saved": False,
        "last_traced_at": None,
        "save_warning": "The route was verified, but the snapshot could not be saved because the inventory database is busy.",
    }
    return trace


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
        "node_credentials": {node_id: selection.model_dump() for node_id, selection in payload.node_credentials.items()},
    })
    created = 0
    updated = 0
    scanned = 0
    configs_collected = 0
    skipped = 0
    neighbors_detected = 0
    neighbors_created = 0
    neighbors_updated = 0
    neighbors_scanned = 0
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
                "neighbors_detected": neighbors_detected,
                "neighbors_created": neighbors_created,
            })

        for index, node_id in enumerate(node_ids, start=1):
            candidate = _neighbor_candidate_for_node(db, node_id)
            if not candidate:
                skipped += 1
                results.append({"node_id": node_id, "status": "skipped", "reason": "Neighbor was not found or is already ingested"})
                report_ingest_progress(index, "ingesting", node_id)
                continue

            snmp_credential_id, ssh_credential_id = _credential_ids_for_node(payload, node_id)
            item = None
            if payload.full_scan and candidate.get("management_ip"):
                report_ingest_progress(max(index - 1, 0), "scanning_neighbor", node_id)
                scanned += 1
                item = _scan_single_neighbor(db, candidate["management_ip"], snmp_credential_id, ssh_credential_id)
                if item and item.get("configuration_snapshot"):
                    configs_collected += 1
            if not item:
                item = candidate
                item["snmp_credential_id"] = snmp_credential_id
                item["ssh_credential_id"] = ssh_credential_id

            device, was_created = _upsert_ingested_device(db, item, selected_site, placement)
            # A full scan is also topology discovery. Save all CDP/LLDP records
            # from the selected switch before attempting its unmanaged neighbors.
            if payload.full_scan:
                _upsert_device_links(db, device, item)
            _attach_neighbor_links(db, candidate, device)
            created += 1 if was_created else 0
            updated += 0 if was_created else 1
            result = {
                "node_id": node_id,
                "status": "created" if was_created else "updated",
                "device_id": device.id,
                "device_name": device.name,
                "management_ip": device.management_ip,
                "snmp_credential_id": snmp_credential_id,
                "ssh_credential_id": ssh_credential_id,
            }
            if payload.full_scan:
                report_ingest_progress(max(index - 1, 0), "scanning_discovered_neighbors", device.name)
                expansion = _scan_full_scan_neighbors(
                    db,
                    device,
                    item,
                    snmp_credential_id,
                    ssh_credential_id,
                    selected_site,
                    placement,
                )
                neighbors_detected += expansion["detected"]
                neighbors_created += expansion["created"]
                neighbors_updated += expansion["updated"]
                neighbors_scanned += expansion["scanned"]
                scanned += expansion["scanned"]
                configs_collected += expansion["configs_collected"]
                skipped += expansion["skipped"]
                result["neighbor_scan"] = expansion
            results.append(result)
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
            "neighbors_detected": neighbors_detected,
            "neighbors_created": neighbors_created,
            "neighbors_updated": neighbors_updated,
            "neighbors_scanned": neighbors_scanned,
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
        "neighbors_detected": neighbors_detected,
        "neighbors_created": neighbors_created,
        "neighbors_updated": neighbors_updated,
        "neighbors_scanned": neighbors_scanned,
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
            "neighbors_detected": neighbors_detected,
            "neighbors_created": neighbors_created,
            "neighbors_updated": neighbors_updated,
            "neighbors_scanned": neighbors_scanned,
            "results": results,
        },
        "job_id": job.id,
    }


def _credential_ids_for_node(payload: TopologyIngestRequest, node_id: str) -> tuple[int | None, int | None]:
    selection = payload.node_credentials.get(node_id)
    if not selection:
        return payload.snmp_credential_id, payload.ssh_credential_id
    return (
        selection.snmp_credential_id if selection.snmp_credential_id is not None else payload.snmp_credential_id,
        selection.ssh_credential_id if selection.ssh_credential_id is not None else payload.ssh_credential_id,
    )


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


def _trace_connected_devices(db: Session, query: str) -> dict:
    devices = db.query(Device).order_by(Device.name.asc()).all()
    devices_by_id = {device.id: device for device in devices}
    links = [
        link for link in db.query(DeviceLink).order_by(DeviceLink.last_seen_at.desc(), DeviceLink.id.desc()).all()
        if not _link_has_stale_device_reference(link, devices_by_id)
    ]

    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    for device in devices:
        node = _trace_device_node(device)
        nodes[node["id"]] = node
    for link in links:
        source = _trace_link_endpoint(link, "local", devices_by_id)
        target = _trace_link_endpoint(link, "remote", devices_by_id)
        nodes.setdefault(source["id"], source)
        nodes.setdefault(target["id"], target)
        edges.append({
            "id": link.id,
            "source": source["id"],
            "target": target["id"],
            "source_port": link.local_interface or "",
            "target_port": link.remote_interface or "",
            "protocol": link.protocol or "neighbor",
            "last_seen_at": _dt(link.last_seen_at),
        })

    roots = {
        node_id for node_id, node in nodes.items()
        if _trace_node_matches(node, query)
    }
    roots.update(
        _node_id(device.management_ip, device.name, device.id)
        for device in devices
        if _device_matches_trace_query(device, query)
    )
    if not roots:
        return {"query": query, "roots": [], "nodes": [], "links": [], "truncated": False}

    target_paths = []
    for node_id in roots:
        device_id = nodes[node_id].get("device_id")
        if not device_id:
            continue
        path = _backbone_path(links, devices_by_id, device_id)
        if path:
            target_paths.append(path)

    if not target_paths:
        # Keep the matched inventory record so the caller can fall back to live SNMP.
        root_nodes = [nodes[node_id] for node_id in sorted(roots)]
        for node in root_nodes:
            node["depth"] = 0
            node["via"] = None
        return {"query": query, "roots": root_nodes, "nodes": root_nodes, "links": [], "truncated": False}

    # A matching IP can occur on more than one interface. Prefer the closest valid
    # backbone route so the output remains a single, readable hop-by-hop trace.
    path = min(target_paths, key=lambda item: (len(item), item))
    trace_nodes = []
    trace_links = []
    for depth, device_id in enumerate(path):
        node = _trace_device_node(devices_by_id[device_id])
        node["depth"] = depth
        node["via"] = None
        if depth:
            previous = trace_nodes[-1]
            link = _link_between_devices(links, path[depth - 1], device_id)
            if link:
                previous_is_local = link.local_device_id == path[depth - 1]
                previous_port = link.local_interface if previous_is_local else link.remote_interface
                current_port = link.remote_interface if previous_is_local else link.local_interface
                node["via"] = {
                    "device_id": previous["id"],
                    "device_name": previous["name"],
                    "device_port": previous_port or "",
                    "port": current_port or "",
                    "protocol": link.protocol or "neighbor",
                }
                trace_links.append({
                    "id": link.id,
                    "source": previous["id"],
                    "target": node["id"],
                    "source_port": previous_port or "",
                    "target_port": current_port or "",
                    "protocol": link.protocol or "neighbor",
                    "last_seen_at": _dt(link.last_seen_at),
                })
        trace_nodes.append(node)
    return {
        "query": query,
        "roots": [trace_nodes[0]],
        "nodes": trace_nodes,
        "links": trace_links,
        "truncated": False,
    }


def _trace_requires_live_lookup(trace: dict, query: str) -> bool:
    # An IP trace is an active ARP -> MAC -> neighbor verification, not just a
    # read of previously saved topology. This prevents stale FDB data from ending
    # a route early when a device has moved to another access switch.
    if _is_ipv4_address(query):
        return True
    if not trace.get("roots") or not any(root.get("managed") for root in trace["roots"]):
        return True
    links = trace.get("links") or []
    if not links:
        return True
    # ARP/FDB endpoint links prove that the routed device saw the endpoint, but they
    # are not physical switch-to-switch topology. Refresh them with MAC-table lookup
    # so a later-discovered access switch can extend the route upstream.
    return _is_ipv4_address(query) and all(
        str(link.get("protocol") or "").lower() in {"snmp-arp", "snmp-fdb"}
        for link in links
    )


def _trace_via_snmp(
    db: Session,
    query: str,
    progress: TraceProgressCallback | None = None,
) -> dict:
    devices = db.query(Device).order_by(Device.name.asc()).all()
    links = db.query(DeviceLink).order_by(DeviceLink.last_seen_at.desc(), DeviceLink.id.desc()).all()
    devices_by_id = {device.id: device for device in devices}
    links = [link for link in links if not _link_has_stale_device_reference(link, devices_by_id)]
    candidates = _snmp_trace_candidates(db, devices)
    target_ip = query.strip() if _is_ipv4_address(query) else ""
    normalized_query_mac = _normalize_mac(query)
    target_mac = normalized_query_mac if len(normalized_query_mac) == 12 else ""
    errors: list[str] = []
    attempted = 0
    arp_resolution: dict | None = None
    candidate_total = max(len(candidates), 1)

    if not target_mac and target_ip:
        _report_trace_progress(progress, "arp", 15, "Resolving the target IP to a MAC address from router ARP tables")
        for index, candidate in enumerate(candidates, start=1):
            attempted += 1
            device_name = candidate["device"].name
            _report_trace_progress(
                progress,
                "arp",
                15 + int((index - 1) / candidate_total * 13),
                f"Checking ARP table on {device_name}",
            )
            try:
                service = SnmpLayer2TraceService(candidate["community"], candidate["port"])
                target_mac = _normalize_mac(service.resolve_ip_mac(candidate["device"].management_ip, target_ip))
                if target_mac:
                    arp_resolution = {
                        "device": candidate["device"],
                        "if_index": getattr(service, "last_arp_if_index", None),
                        "interface": getattr(service, "last_arp_interface", ""),
                    }
            except Exception as exc:
                errors.append(f"{candidate['device'].name}: {exc}")
                _report_trace_progress(progress, "arp", 28, f"SNMP warning on {device_name}: {exc}. Continuing with other devices")
            if target_mac:
                _report_trace_progress(progress, "arp", 30, f"Resolved {target_ip} to MAC {format_mac(target_mac)} on {device_name}")
                break
    elif target_mac:
        _report_trace_progress(progress, "arp", 30, f"Using supplied MAC address {format_mac(target_mac)}")

    if len(target_mac) != 12:
        _report_trace_progress(progress, "route", 96, "No routed device resolved the target IP to a MAC address")
        return _empty_live_trace(query, attempted, "SNMP could not resolve the entered IP to a MAC address. Check that a routed backbone device has an ARP entry and SNMP is allowed by its ACL.", errors)

    target_vlan = _vlan_from_interface(arp_resolution.get("interface", "")) if arp_resolution else None
    findings = []
    _report_trace_progress(progress, "mac", 32, "Searching switch forwarding tables for the resolved MAC address")
    for index, candidate in enumerate(candidates, start=1):
        attempted += 1
        device_name = candidate["device"].name
        _report_trace_progress(
            progress,
            "mac",
            32 + int((index - 1) / candidate_total * 38),
            f"Checking MAC table on {device_name}",
        )
        try:
            service = SnmpLayer2TraceService(candidate["community"], candidate["port"])
            vlan_ids = _device_vlan_ids(candidate["device"])
            if target_vlan:
                vlan_ids = sorted(set(vlan_ids + [target_vlan]))
            elif _is_cisco_device(candidate["device"]) and not vlan_ids:
                _report_trace_progress(progress, "mac", 52, f"Discovering active VLANs on {device_name} for Cisco VLAN-context lookup")
                vlan_ids = service.discover_vlan_ids(candidate["device"].management_ip)
            ports = service.find_mac_port(
                candidate["device"].management_ip,
                target_mac,
                target_vlan,
                vlan_ids,
                _is_cisco_device(candidate["device"]),
            )
        except Exception as exc:
            errors.append(f"{candidate['device'].name}: {exc}")
            _report_trace_progress(progress, "mac", 70, f"SNMP warning on {device_name}: {exc}. Continuing with other switches")
            continue
        for port in ports:
            findings.append({"device": candidate["device"], **port})
        if ports:
            _report_trace_progress(progress, "mac", 72, f"MAC found on {device_name}; verifying whether the learned port leads to another switch")

    if not findings:
        _report_trace_progress(progress, "route", 96, "The MAC was resolved but no switch forwarding table exposed it")
        if arp_resolution:
            return _partial_arp_trace(query, target_ip, target_mac, arp_resolution, attempted, errors)
        return _empty_live_trace(query, attempted, "SNMP resolved the target MAC but no configured switch reported it in its forwarding table. Check VLAN reachability, switch SNMP access, and MAC-table permissions.", errors, target_mac)

    _report_trace_progress(progress, "neighbors", 75, "Refreshing CDP/LLDP neighbors on switches that learned the MAC")
    neighbor_scans = _refresh_trace_switch_neighbors(db, findings, progress)
    if neighbor_scans:
        devices = db.query(Device).order_by(Device.name.asc()).all()
        devices_by_id = {device.id: device for device in devices}
        links = [link for link in db.query(DeviceLink).order_by(DeviceLink.last_seen_at.desc(), DeviceLink.id.desc()).all() if not _link_has_stale_device_reference(link, devices_by_id)]

    # Verify each forwarding hop instead of selecting a switch by role. Starting at
    # the ARP-owning backbone, the MAC must be learned on a port whose CDP/LLDP
    # neighbor also learns that same MAC before the trace continues downstream.
    _report_trace_progress(progress, "route", 92, "Building the verified backbone-to-endpoint path")
    verified = _verified_mac_forwarding_path(
        links,
        arp_resolution["device"].id if arp_resolution else None,
        findings,
    )
    if verified and (len(verified[0]) > 1 or len({finding["device"].id for finding in findings}) == 1):
        path, terminal = verified
    else:
        # MAC-only searches have no ARP starting point. Use the known topology path,
        # while retaining the most downstream switch that reported the target MAC.
        terminal = min(findings, key=lambda finding: _live_finding_rank(finding, links))
        upstream_path = _upstream_path_to_backbone(links, devices_by_id, terminal["device"].id)
        path = list(reversed(upstream_path)) if upstream_path else [terminal["device"].id]

    path_nodes = []
    path_links = []
    for depth, device_id in enumerate(path):
        node = _trace_device_node(devices_by_id[device_id])
        node["depth"] = depth
        node["via"] = None
        if depth:
            link = _link_between_devices(links, path[depth - 1], device_id)
            previous = path_nodes[-1]
            if link:
                previous_is_local = link.local_device_id == path[depth - 1]
                previous_port = link.local_interface if previous_is_local else link.remote_interface
                current_port = link.remote_interface if previous_is_local else link.local_interface
                node["via"] = {
                    "device_id": previous["id"],
                    "device_name": previous["name"],
                    "device_port": previous_port or "",
                    "port": current_port or "",
                    "protocol": link.protocol or "neighbor",
                }
                path_links.append({
                    "id": link.id,
                    "source": previous["id"],
                    "target": node["id"],
                    "source_port": previous_port or "",
                    "target_port": current_port or "",
                    "protocol": link.protocol or "neighbor",
                    "last_seen_at": _dt(link.last_seen_at),
                })
        path_nodes.append(node)

    terminal_node = path_nodes[-1]
    target_node = {
        "id": f"live:{target_ip or target_mac}",
        "device_id": None,
        "name": target_ip or f"MAC {format_mac(target_mac)}",
        "ip": target_ip,
        "mac_address": format_mac(target_mac),
        "role": "SNMP located endpoint",
        "status": "Located",
        "site": "",
        "managed": False,
        "depth": len(path_nodes),
        "via": {
            "device_id": terminal_node["id"],
            "device_name": terminal_node["name"],
            "device_port": terminal["interface"],
            "port": "Learned MAC",
            "protocol": "snmp fdb",
        },
    }
    path_nodes.append(target_node)
    path_links.append({
        "id": f"snmp-fdb:{terminal['device'].id}:{terminal['interface']}",
        "source": terminal_node["id"],
        "target": target_node["id"],
        "source_port": terminal["interface"],
        "target_port": "Learned MAC",
        "protocol": "snmp fdb",
        "last_seen_at": None,
    })
    _report_trace_progress(progress, "route", 97, f"Verified {len(path)} managed hop(s) to {terminal['device'].name} {terminal['interface']}")
    return {
        "query": query,
        "roots": [path_nodes[0]],
        "nodes": path_nodes,
        "links": path_links,
        "truncated": False,
        "live_snmp": {
            "used": True,
            "attempted": attempted,
            "target_mac": format_mac(target_mac),
            "fdb_matches": len(findings),
            "verified_fdb_hops": len(path),
            "fdb_lookup": terminal.get("lookup", "standard-fdb"),
            "fdb_vlan": terminal.get("vlan"),
            "bridge_port": terminal.get("bridge_port"),
            "access_switch": terminal["device"].name,
            "access_port": terminal["interface"],
            "arp_device": arp_resolution["device"].name if arp_resolution else "",
            "arp_interface": arp_resolution.get("interface", "") if arp_resolution else "",
            "method": "arp-mac-upstream",
            "neighbor_scans": neighbor_scans,
            "message": "IP was resolved to a MAC from backbone ARP, located in switch MAC tables, then traced upstream through collected CDP/LLDP topology.",
            "errors": errors[:8],
        },
    }


def _empty_live_trace(query: str, attempted: int, message: str, errors: list[str], target_mac: str = "") -> dict:
    return {
        "query": query,
        "roots": [],
        "nodes": [],
        "links": [],
        "truncated": False,
        "live_snmp": {"used": False, "attempted": attempted, "target_mac": format_mac(target_mac), "message": message, "errors": errors[:8]},
    }


def _partial_arp_trace(query: str, target_ip: str, target_mac: str, arp_resolution: dict, attempted: int, errors: list[str]) -> dict:
    backbone = _trace_device_node(arp_resolution["device"])
    backbone["depth"] = 0
    backbone["via"] = None
    interface = arp_resolution.get("interface") or (f"if{arp_resolution['if_index']}" if arp_resolution.get("if_index") else "ARP interface")
    target = {
        "id": f"live:{target_ip or target_mac}",
        "device_id": None,
        "name": target_ip or f"MAC {format_mac(target_mac)}",
        "ip": target_ip,
        "mac_address": format_mac(target_mac),
        "role": "SNMP located endpoint",
        "status": "Located",
        "site": "",
        "managed": False,
        "depth": 1,
        "via": {
            "device_id": backbone["id"],
            "device_name": backbone["name"],
            "device_port": interface,
            "port": "ARP neighbor",
            "protocol": "snmp arp",
        },
    }
    return {
        "query": query,
        "roots": [backbone],
        "nodes": [backbone, target],
        "links": [{
            "id": f"snmp-arp:{arp_resolution['device'].id}:{target_ip or target_mac}",
            "source": backbone["id"],
            "target": target["id"],
            "source_port": interface,
            "target_port": "ARP neighbor",
            "protocol": "snmp arp",
            "last_seen_at": None,
        }],
        "truncated": False,
        "live_snmp": {
            "used": True,
            "partial": True,
            "attempted": attempted,
            "target_mac": format_mac(target_mac),
            "fdb_matches": 0,
            "access_switch": arp_resolution["device"].name,
            "access_port": interface,
            "arp_device": arp_resolution["device"].name,
            "arp_interface": interface,
            "method": "arp-mac-upstream",
            "message": "The backbone ARP table resolved the target. No configured downstream switch currently exposes this MAC in its forwarding table, so the trace ends at the routed VLAN interface.",
            "errors": errors[:8],
        },
    }


def _auto_ingest_trace_endpoint(db: Session, trace: dict) -> tuple[Device, bool] | None:
    # The searched IP/MAC is evidence of an endpoint, not a managed device that
    # should silently enter inventory. Only verified neighboring switches are added.
    live = trace.get("live_snmp") or {}
    live["auto_ingest"] = "skipped"
    live["auto_ingest_detail"] = "The searched endpoint is not automatically added to Device Inventory."
    return None


def _auto_ingest_trace_neighbors(db: Session, trace: dict) -> list[Device]:
    live = trace.get("live_snmp") or {}
    default_profile = _trace_default_snmp_profile(db)
    if not default_profile:
        live["neighbor_discovery_detail"] = "Set a default SNMP profile in Configurations to add newly discovered neighboring switches."
        return []
    target = next((node for node in trace.get("nodes") or [] if str(node.get("id") or "").startswith("live:")), None)
    if not target or not isinstance(target.get("via"), dict):
        return []
    via = target["via"]
    source_node = next((node for node in trace.get("nodes") or [] if node.get("id") == via.get("device_id")), None)
    source_device_id = source_node.get("device_id") if source_node else None
    if not source_device_id:
        return []

    discovered = []
    processed_ips = set()
    target_ip = str(target.get("ip") or "").strip()
    links = db.query(DeviceLink).filter(
        DeviceLink.local_device_id == source_device_id,
        DeviceLink.remote_device_id.is_(None),
    ).all()
    for link in links:
        if not _interfaces_match(link.local_interface, via.get("device_port")) or not link.remote_ip or link.remote_ip == target_ip or link.remote_ip in processed_ips:
            continue
        processed_ips.add(link.remote_ip)
        scanned = _scan_single_neighbor(db, link.remote_ip, default_profile.id)
        if not scanned:
            continue
        neighbor_candidate = _neighbor_candidate_from_link(
            link,
            "remote",
            link.remote_device_name,
            link.remote_ip,
            "",
            link.remote_interface,
        )
        device_id = _save_trace_neighbor_with_retry(scanned, neighbor_candidate)
        if not device_id:
            live["neighbor_discovery_detail"] = "A neighboring switch was found, but inventory is temporarily busy. The verified route remains available and the switch will be retried on the next trace."
            continue
        db.expire_all()
        device = db.query(Device).filter(Device.id == device_id).first()
        if not device:
            continue
        discovered.append(device)
    return discovered


def _save_trace_neighbor_with_retry(scanned: dict, neighbor_candidate: dict) -> int | None:
    """Persist one neighbor in a short transaction without holding the trace session open."""
    for attempt in range(4):
        write_db = SessionLocal()
        try:
            # Multiple traces can discover the same switch at once. Serialize only
            # this small write window rather than the long-running SNMP collection.
            with _trace_inventory_write_lock:
                device, _ = _upsert_ingested_device(write_db, scanned, None)
                _upsert_device_links(write_db, device, scanned)
                _attach_neighbor_links(write_db, neighbor_candidate, device)
                write_db.commit()
                return device.id
        except OperationalError as exc:
            write_db.rollback()
            if "database is locked" not in str(exc).lower() or attempt == 3:
                return None
            time.sleep(0.5 * (attempt + 1))
        finally:
            write_db.close()
    return None


def _refresh_trace_switch_neighbors(
    db: Session,
    findings: list[dict],
    progress: TraceProgressCallback | None = None,
) -> list[str]:
    default_profile = _trace_default_snmp_profile(db)
    refreshed = []
    devices = sorted({finding["device"] for finding in findings}, key=lambda device: device.name.lower())
    total = max(len(devices), 1)
    for index, device in enumerate(devices, start=1):
        credential_id = device.snmp_credential_id or (default_profile.id if default_profile else None)
        if not credential_id or not device.management_ip:
            continue
        _report_trace_progress(
            progress,
            "neighbors",
            75 + int((index - 1) / total * 13),
            f"Scanning CDP/LLDP neighbors on {device.name}",
        )
        try:
            scanned = _scan_single_neighbor(db, device.management_ip, credential_id)
        except Exception as exc:
            _report_trace_progress(progress, "neighbors", 89, f"Neighbor scan warning on {device.name}: {exc}. Continuing")
            continue
        if not scanned:
            _report_trace_progress(progress, "neighbors", 89, f"No additional managed neighbor discovered from {device.name}")
            continue
        # This is a trace-time neighbor refresh. Updating the existing device's
        # timestamps causes avoidable SQLite write contention during live traces.
        _upsert_device_links(db, device, scanned)
        refreshed.append(device.name)
    if refreshed:
        try:
            db.flush()
        except OperationalError:
            db.rollback()
            return []
    return sorted(set(refreshed))


def _trace_default_snmp_profile(db: Session) -> CredentialProfile | None:
    try:
        credential_id = int(_setting_value(db, "trace_default_snmp_credential_id"))
    except (TypeError, ValueError):
        return None
    return db.query(CredentialProfile).filter(CredentialProfile.id == credential_id, CredentialProfile.credential_type == "snmp_v2c").first()


def _mark_trace_endpoint_ingested(trace: dict, device: Device, created: bool) -> None:
    target = next((node for node in trace.get("nodes") or [] if str(node.get("id") or "").startswith("live:")), None)
    if not target:
        return
    old_id = target["id"]
    new_id = _node_id(device.management_ip, device.name, device.id)
    target.update(_trace_device_node(device))
    target["id"] = new_id
    for link in trace.get("links") or []:
        if link.get("source") == old_id:
            link["source"] = new_id
        if link.get("target") == old_id:
            link["target"] = new_id
    live = trace.setdefault("live_snmp", {})
    live["inventory_device_id"] = device.id
    live["inventory_status"] = "created" if created else "updated"


def _save_trace_connection(db: Session, trace: dict, target_device: Device) -> None:
    target = next((node for node in trace.get("nodes") or [] if str(node.get("id") or "").startswith("live:")), None)
    if not target or not isinstance(target.get("via"), dict):
        return
    via = target["via"]
    source_node = next((node for node in trace.get("nodes") or [] if node.get("id") == via.get("device_id")), None)
    source_device_id = source_node.get("device_id") if source_node else None
    if not source_device_id:
        return
    source_device = db.query(Device).filter(Device.id == source_device_id).first()
    if not source_device:
        return
    protocol = str(via.get("protocol") or "snmp arp").replace(" ", "-").lower()
    local_interface = str(via.get("device_port") or "")
    remote_interface = str(via.get("port") or "ARP neighbor")
    link = db.query(DeviceLink).filter(
        DeviceLink.local_device_id == source_device.id,
        DeviceLink.remote_device_id == target_device.id,
        DeviceLink.local_interface == local_interface,
        DeviceLink.remote_interface == remote_interface,
        DeviceLink.protocol == protocol,
    ).first()
    if not link:
        link = DeviceLink(local_device_id=source_device.id, remote_device_id=target_device.id, discovered_at=datetime.now(timezone.utc))
        db.add(link)
    link.local_device_name = source_device.name
    link.local_ip = source_device.management_ip or ""
    link.local_interface = local_interface
    link.remote_device_name = target_device.name
    link.remote_ip = target_device.management_ip or ""
    link.remote_interface = remote_interface
    link.protocol = protocol
    link.details = json.dumps({"source": "snmp-trace", "target_mac": target_device.mac_address or ""})
    link.last_seen_at = datetime.now(timezone.utc)


def _snmp_trace_candidates(db: Session, devices: list[Device]) -> list[dict]:
    global_community = _setting_value(db, "snmp_community")
    profiles = {profile.id: profile for profile in db.query(CredentialProfile).filter(CredentialProfile.credential_type == "snmp_v2c").all()}
    candidates = []
    for device in devices:
        if not device.management_ip:
            continue
        profile = profiles.get(device.snmp_credential_id or 0)
        community = decrypt_secret(profile.secret_encrypted) if profile else global_community
        if not community:
            continue
        candidates.append({"device": device, "community": community, "port": profile.port if profile and profile.port else 161})
    candidates.sort(key=lambda item: (_trace_device_rank(item["device"]), item["device"].name.lower()))
    return candidates


def _trace_device_rank(device: Device) -> int:
    role = f"{device.role} {device.device_type} {device.tags}".lower()
    if any(word in role for word in ["core", "backbone", "aggregation"]):
        return 0
    if any(word in role for word in ["distribution", "router"]):
        return 1
    if any(word in role for word in ["access", "switch"]):
        return 2
    return 3


def _is_cisco_device(device: Device) -> bool:
    return "cisco" in f"{device.manufacturer} {device.platform} {device.model} {device.description}".lower()


def _device_vlan_ids(device: Device) -> list[int]:
    try:
        rows = json.loads(device.vlans or "[]")
    except (TypeError, ValueError):
        return []
    vlan_ids = set()
    for row in rows if isinstance(rows, list) else []:
        value = row.get("id") if isinstance(row, dict) else row
        try:
            vlan_id = int(value)
        except (TypeError, ValueError):
            continue
        if 1 <= vlan_id <= 4094:
            vlan_ids.add(vlan_id)
    return sorted(vlan_ids)


def _live_finding_rank(finding: dict, links: list[DeviceLink]) -> tuple[int, int, str]:
    device = finding["device"]
    linked = any(
        (link.local_device_id == device.id and link.local_interface == finding["interface"])
        or (link.remote_device_id == device.id and link.remote_interface == finding["interface"])
        for link in links
    )
    return (1 if linked else 0, -_trace_device_rank(device), device.name.lower())


def _verified_mac_forwarding_path(
    links: list[DeviceLink],
    backbone_device_id: int | None,
    findings: list[dict],
) -> tuple[list[int], dict] | None:
    if not backbone_device_id:
        return None
    findings_by_device: dict[int, list[dict]] = {}
    for finding in findings:
        device_id = finding["device"].id
        findings_by_device.setdefault(device_id, []).append(finding)
    if backbone_device_id not in findings_by_device:
        return None

    terminals: list[tuple[list[int], dict]] = []
    queue: list[tuple[int, list[int]]] = [(backbone_device_id, [backbone_device_id])]
    while queue:
        device_id, path = queue.pop(0)
        next_hops = []
        for finding in findings_by_device.get(device_id, []):
            for neighbor_id in _managed_neighbors_on_interface(
                links,
                device_id,
                [finding["interface"], *(finding.get("member_interfaces") or [])],
            ):
                if neighbor_id in path or neighbor_id not in findings_by_device:
                    continue
                next_hops.append(neighbor_id)
        if not next_hops:
            terminals.extend((path, finding) for finding in findings_by_device[device_id])
            continue
        for neighbor_id in sorted(set(next_hops)):
            queue.append((neighbor_id, path + [neighbor_id]))

    if not terminals:
        return None
    return max(
        terminals,
        key=lambda item: (len(item[0]), _trace_device_rank(item[1]["device"]), item[1]["device"].name.lower()),
    )


def _managed_neighbors_on_interface(links: list[DeviceLink], device_id: int, interfaces: list[str]) -> list[int]:
    neighbors = []
    for link in links:
        if link.local_device_id == device_id and link.remote_device_id and any(_interfaces_match(link.local_interface, interface) for interface in interfaces):
            neighbors.append(link.remote_device_id)
        elif link.remote_device_id == device_id and link.local_device_id and any(_interfaces_match(link.remote_interface, interface) for interface in interfaces):
            neighbors.append(link.local_device_id)
    return neighbors


def _interfaces_match(first: str | None, second: str | None) -> bool:
    def normalize(value: str | None) -> str:
        text = str(value or "").strip().lower()
        text = re.sub(r"^tengigabitethernet", "te", text)
        text = re.sub(r"^gigabitethernet", "gi", text)
        text = re.sub(r"^fastethernet", "fa", text)
        text = re.sub(r"^port-channel", "po", text)
        return re.sub(r"[^a-z0-9]", "", text)
    return bool(first and second and normalize(first) == normalize(second))


def _backbone_path(links: list[DeviceLink], devices_by_id: dict[int, Device], target_id: int) -> list[int]:
    backbone_sources = [device_id for device_id, device in devices_by_id.items() if _trace_device_rank(device) == 0]
    sources = backbone_sources or [device_id for device_id, device in devices_by_id.items() if _trace_device_rank(device) <= 1]
    if target_id in sources:
        return [target_id]
    # ARP proves L3 reachability but not the physical L2 route. Prefer a path made
    # from CDP/LLDP and FDB evidence when one exists; retain ARP only as a fallback.
    preferred_links = [link for link in links if str(link.protocol or "").lower() != "snmp-arp"]
    preferred_path = _device_path_from_sources(preferred_links, sources, target_id)
    return preferred_path or _device_path_from_sources(links, sources, target_id)


def _device_path_from_sources(links: list[DeviceLink], sources: list[int], target_id: int) -> list[int]:
    adjacency: dict[int, set[int]] = {}
    for link in links:
        if not link.local_device_id or not link.remote_device_id:
            continue
        adjacency.setdefault(link.local_device_id, set()).add(link.remote_device_id)
        adjacency.setdefault(link.remote_device_id, set()).add(link.local_device_id)
    queue = list(sources)
    previous = {source: None for source in sources}
    for current in queue:
        if current == target_id:
            break
        for neighbor in adjacency.get(current, set()):
            if neighbor in previous:
                continue
            previous[neighbor] = current
            queue.append(neighbor)
    if target_id not in previous:
        return []
    path = []
    current: int | None = target_id
    while current is not None:
        path.append(current)
        current = previous[current]
    return list(reversed(path))


def _upstream_path_to_backbone(links: list[DeviceLink], devices_by_id: dict[int, Device], access_device_id: int) -> list[int]:
    """Return access switch to backbone; callers reverse it for display."""
    backbone_path = _backbone_path(links, devices_by_id, access_device_id)
    return list(reversed(backbone_path)) if backbone_path else []


def _link_between_devices(links: list[DeviceLink], first_id: int, second_id: int) -> DeviceLink | None:
    for link in links:
        if {link.local_device_id, link.remote_device_id} == {first_id, second_id}:
            return link
    return None


def _is_ipv4_address(value: str) -> bool:
    parts = value.strip().split(".")
    try:
        return len(parts) == 4 and all(0 <= int(part) <= 255 for part in parts)
    except ValueError:
        return False


def _vlan_from_interface(value: str) -> int | None:
    match = re.search(r"(?:vlan|vlanif|svi)[ -]?(\d+)", str(value or ""), flags=re.IGNORECASE)
    return int(match.group(1)) if match else None


def format_mac(value: str) -> str:
    normalized = _normalize_mac(value)
    return ":".join(normalized[index:index + 2] for index in range(0, len(normalized), 2)) if len(normalized) == 12 else ""


def _trace_device_node(device: Device) -> dict:
    return {
        "id": _node_id(device.management_ip, device.name, device.id),
        "device_id": device.id,
        "name": device.name,
        "ip": device.management_ip or "",
        "mac_address": _device_primary_mac(device),
        "role": device.role or "Device",
        "status": device.status or "Unknown",
        "site": device.site.name if device.site else "",
        "managed": True,
    }


def _trace_link_endpoint(link: DeviceLink, side: str, devices_by_id: dict[int, Device]) -> dict:
    is_local = side == "local"
    device = devices_by_id.get(link.local_device_id if is_local else link.remote_device_id)
    if device:
        return _trace_device_node(device)
    name = (link.local_device_name if is_local else link.remote_device_name) or "Discovered neighbor"
    ip = (link.local_ip if is_local else link.remote_ip) or ""
    return {
        "id": _node_id(ip, name, None),
        "device_id": None,
        "name": name,
        "ip": ip,
        "mac_address": _trace_link_mac(link, side),
        "role": "Discovered neighbor",
        "status": "Discovered",
        "site": "",
        "managed": False,
    }


def _trace_node_matches(node: dict, query: str) -> bool:
    normalized_query = query.strip().lower()
    if normalized_query and normalized_query == str(node.get("ip") or "").strip().lower():
        return True
    query_mac = _normalize_mac(query)
    return bool(query_mac and query_mac == _normalize_mac(node.get("mac_address") or ""))


def _device_matches_trace_query(device: Device, query: str) -> bool:
    normalized_query = query.strip().lower()
    if normalized_query and normalized_query == str(device.management_ip or "").strip().lower():
        return True
    query_mac = _normalize_mac(query)
    for item in _device_interface_rows(device):
        interface_ips = str(item.get("ip") or item.get("ip_addresses") or "").replace(";", ",").split(",")
        if normalized_query and any(normalized_query == value.strip().lower() for value in interface_ips):
            return True
        if query_mac and any(query_mac == _normalize_mac(item.get(key) or "") for key in ["mac", "mac_address", "phys_address"]):
            return True
    return bool(query_mac and query_mac == _normalize_mac(device.mac_address or ""))


def _device_primary_mac(device: Device) -> str:
    if device.mac_address:
        return str(device.mac_address).strip()
    for item in _device_interface_rows(device):
        for key in ["mac", "mac_address", "phys_address"]:
            if item.get(key):
                return str(item[key]).strip()
    return ""


def _device_interface_rows(device: Device) -> list[dict]:
    try:
        items = json.loads(device.interfaces or "[]")
    except (TypeError, ValueError):
        return []
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def _trace_link_mac(link: DeviceLink, side: str) -> str:
    if side != "remote":
        return ""
    details = _json_value(link.details)
    if not isinstance(details, dict):
        return ""
    for key in ["remote_mac", "remote_chassis_id", "mac_address"]:
        value = str(details.get(key) or "").strip()
        if _normalize_mac(value):
            return value
    return ""


def _normalize_mac(value: str) -> str:
    return "".join(character for character in str(value).lower() if character in "0123456789abcdef")


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


def _scan_full_scan_neighbors(
    db: Session,
    parent: Device,
    item: dict,
    snmp_credential_id: int | None,
    ssh_credential_id: int | None,
    site: Site | None,
    placement: dict[str, str] | None,
) -> dict:
    """Scan only the selected switch's direct CDP/LLDP neighbors.

    The limit prevents a selected device from turning a UI action into an
    uncontrolled recursive network crawl. Newly learned links still expose any
    nonresponsive devices as discovered nodes for a later targeted scan.
    """
    summary = {
        "detected": 0,
        "created": 0,
        "updated": 0,
        "scanned": 0,
        "configs_collected": 0,
        "skipped": 0,
        "results": [],
    }
    seen_neighbors = set()
    for neighbor in (item.get("neighbors") or [])[:32]:
        remote_name = str(neighbor.get("remote_name") or neighbor.get("remote_chassis_id") or "").strip()
        remote_ip = str(neighbor.get("remote_ip") or "").strip()
        remote_key = f"{remote_ip.casefold()}|{remote_name.casefold()}"
        if not remote_key.strip("|") or remote_key in seen_neighbors:
            continue
        seen_neighbors.add(remote_key)
        if remote_ip and remote_ip == parent.management_ip:
            continue
        if remote_name and (_same_text(remote_name, parent.name) or _same_text(remote_name, parent.hostname)):
            continue

        summary["detected"] += 1
        existing = _find_existing_device(db, remote_name, remote_name, remote_ip)
        if existing:
            summary["skipped"] += 1
            summary["results"].append({
                "name": existing.name,
                "management_ip": existing.management_ip,
                "status": "already_in_inventory",
            })
            continue
        if not remote_ip:
            summary["skipped"] += 1
            summary["results"].append({
                "name": remote_name or "Unnamed neighbor",
                "management_ip": "",
                "status": "detected_without_management_ip",
            })
            continue

        summary["scanned"] += 1
        scanned = _scan_single_neighbor(db, remote_ip, snmp_credential_id, ssh_credential_id)
        if not scanned:
            summary["skipped"] += 1
            summary["results"].append({
                "name": remote_name or f"Discovered-{remote_ip}",
                "management_ip": remote_ip,
                "status": "detected_no_response",
            })
            continue

        scanned["snmp_credential_id"] = snmp_credential_id
        scanned["ssh_credential_id"] = ssh_credential_id
        scanned["tags"] = ",".join(sorted(set(filter(None, str(scanned.get("tags") or "").split(",") + ["topology-neighbor", "full-scan-neighbor"]))))
        child, was_created = _upsert_ingested_device(db, scanned, site, placement)
        _upsert_device_links(db, child, scanned)
        if was_created:
            summary["created"] += 1
        else:
            summary["updated"] += 1
        if scanned.get("configuration_snapshot"):
            summary["configs_collected"] += 1
        summary["results"].append({
            "name": child.name,
            "management_ip": child.management_ip,
            "device_id": child.id,
            "status": "created" if was_created else "updated",
        })

    # Re-resolve the selected device's links after new direct neighbors exist so
    # each CDP/LLDP edge points to the managed inventory device.
    _upsert_device_links(db, parent, item)
    return summary


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
