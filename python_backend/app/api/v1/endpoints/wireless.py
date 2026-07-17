import json
import re
import socket
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.secret_store import decrypt_secret, encrypt_secret
from app.models.app_config import AppConfig
from app.models.audit_log import AuditLog
from app.models.credential_profile import CredentialProfile
from app.models.device import Device
from app.models.user import User
from app.models.wireless_snapshot import WirelessSnapshot
from app.services.jobs import complete_job, fail_job, start_job, update_job_progress
from app.services.snmp import SnmpClient, _as_string, _ip_text, _mac_text, _value_to_text

try:
    import paramiko
except ImportError:  # pragma: no cover - deployment without optional SSH dependency
    paramiko = None

router = APIRouter()

WIRELESS_CONTROLLERS_KEY = "wireless_controllers"
WIRELESS_DELETED_CONTROLLERS_KEY = "wireless_deleted_controller_ids"
WIRELESS_AP_NAMES_KEY = "wireless_ap_name_map"
AP_NAME_CACHE_TTL_SECONDS = 3600
AP_NAME_CACHE: dict[str, tuple[str, datetime]] = {}
ZD_AP_TABLE_COLUMNS = {
    "mac_address": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.1",
    "description": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.2",
    "status": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.3",
    "model": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.4",
    "serial_number": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.5",
    "uptime_ticks": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.6",
    "software_version": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.7",
    "hardware_version": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.8",
    "management_ip": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.10",
    "radios": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.13",
    "clients": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.15",
    "connection_mode": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.17",
    "mesh_type": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.20",
    "lan_rx_bytes": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.21",
    "lan_rx_packets": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.22",
    "lan_rx_errors": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.23",
    "lan_tx_bytes": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.25",
    "lan_tx_packets": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.26",
    "memory_util": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.27",
    "memory_total_kb": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.28",
    "cpu_util": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.29",
    "dropped_packets": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.53",
    "sta_tx_kbytes": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.61",
    "sta_rx_kbytes": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.62",
    "total_users": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.110",
    "lan_rx_byte_rate": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.111",
    "lan_tx_byte_rate": "1.3.6.1.4.1.25053.1.2.2.1.1.2.1.1.112",
}
ZD_AP_CONFIG_TABLE_COLUMNS = {
    "mac_address": "1.3.6.1.4.1.25053.1.2.2.4.1.1.1.1.2",
    "model": "1.3.6.1.4.1.25053.1.2.2.4.1.1.1.1.4",
    "device_name": "1.3.6.1.4.1.25053.1.2.2.4.1.1.1.1.5",
    "description": "1.3.6.1.4.1.25053.1.2.2.4.1.1.1.1.6",
    "location": "1.3.6.1.4.1.25053.1.2.2.4.1.1.1.1.7",
    "management_ip": "1.3.6.1.4.1.25053.1.2.2.4.1.1.1.1.16",
}
ZD_AP_RADIO_TABLE_COLUMNS = {
    "radio_type": "1.3.6.1.4.1.25053.1.2.2.1.1.2.2.1.3",
    "channel": "1.3.6.1.4.1.25053.1.2.2.1.1.2.2.1.4",
    "clients": "1.3.6.1.4.1.25053.1.2.2.1.1.2.2.1.8",
}
AP_SYSTEM_OIDS = {
    "sys_descr": "1.3.6.1.2.1.1.1.0",
    "sys_object_id": "1.3.6.1.2.1.1.2.0",
    "sys_uptime_ticks": "1.3.6.1.2.1.1.3.0",
    "sys_contact": "1.3.6.1.2.1.1.4.0",
    "sys_name": "1.3.6.1.2.1.1.5.0",
    "sys_location": "1.3.6.1.2.1.1.6.0",
    "sys_services": "1.3.6.1.2.1.1.7.0",
    "hr_system_uptime_ticks": "1.3.6.1.2.1.25.1.1.0",
    "hr_memory_size_kb": "1.3.6.1.2.1.25.2.2.0",
}
AP_INTERFACE_TABLE_COLUMNS = {
    "index": "1.3.6.1.2.1.2.2.1.1",
    "descr": "1.3.6.1.2.1.2.2.1.2",
    "type": "1.3.6.1.2.1.2.2.1.3",
    "mtu": "1.3.6.1.2.1.2.2.1.4",
    "speed": "1.3.6.1.2.1.2.2.1.5",
    "phys_address": "1.3.6.1.2.1.2.2.1.6",
    "admin_status": "1.3.6.1.2.1.2.2.1.7",
    "oper_status": "1.3.6.1.2.1.2.2.1.8",
    "last_change": "1.3.6.1.2.1.2.2.1.9",
    "in_octets": "1.3.6.1.2.1.2.2.1.10",
    "in_ucast_pkts": "1.3.6.1.2.1.2.2.1.11",
    "in_errors": "1.3.6.1.2.1.2.2.1.14",
    "out_octets": "1.3.6.1.2.1.2.2.1.16",
    "out_ucast_pkts": "1.3.6.1.2.1.2.2.1.17",
    "out_errors": "1.3.6.1.2.1.2.2.1.20",
    "name": "1.3.6.1.2.1.31.1.1.1.1",
    "hc_in_octets": "1.3.6.1.2.1.31.1.1.1.6",
    "hc_out_octets": "1.3.6.1.2.1.31.1.1.1.10",
    "alias": "1.3.6.1.2.1.31.1.1.1.18",
}
AP_IP_ADDRESS_TABLE_COLUMNS = {
    "ip_address": "1.3.6.1.2.1.4.20.1.1",
    "if_index": "1.3.6.1.2.1.4.20.1.2",
    "netmask": "1.3.6.1.2.1.4.20.1.3",
    "broadcast": "1.3.6.1.2.1.4.20.1.4",
}
ZD_SYSTEM_STATS = {
    "ap_count": "1.3.6.1.4.1.25053.1.2.1.1.1.15.1.0",
    "client_count": "1.3.6.1.4.1.25053.1.2.1.1.1.15.2.0",
    "registered_ap_count": "1.3.6.1.4.1.25053.1.2.1.1.1.15.15.0",
    "all_client_count": "1.3.6.1.4.1.25053.1.2.1.1.1.15.30.0",
}


class WirelessControllerPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    vendor: str = Field(default="generic", max_length=80)
    controller_role: str = Field(default="primary", max_length=40)
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(default=443, ge=1, le=65535)
    protocol: str = Field(default="https", max_length=40)
    username: str = Field(default="", max_length=120)
    password: str = Field(default="", max_length=255)
    snmp_credential_id: int | None = None
    site_name: str = Field(default="", max_length=120)
    verify_tls: bool = True
    enabled: bool = True
    notes: str = Field(default="", max_length=1000)


@router.get("/controllers", response_model=dict)
def list_controllers(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return {"message": "ok", "data": {"data": [_public_controller(item) for item in _controllers(db)]}}


@router.get("/monitoring", response_model=dict)
def wireless_monitoring(refresh: bool = False, fast: bool = False, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _load_persisted_ap_name_map(db)
    controllers = _controllers(db)
    monitoring_controllers = [controller for controller in controllers if _is_monitoring_controller(controller)]
    controller_ids = [str(controller.get("id")) for controller in monitoring_controllers if controller.get("id")]
    refresh_status = {
        "requested": refresh,
        "attempted": 0,
        "refreshed": 0,
        "skipped": 0,
        "failed": 0,
        "collected_ap_records": 0,
        "throttle_seconds": 3,
        "refreshed_at": None,
        "errors": [],
    }
    if refresh:
        refresh_status = _refresh_enabled_controllers(db, controllers)
        _save_controllers(db, controllers)
        db.commit()

    if controller_ids and fast and not refresh:
        latest_sampled_at = (
            db.query(func.max(WirelessSnapshot.sampled_at))
            .filter(WirelessSnapshot.controller_id.in_(controller_ids))
            .scalar()
        )
        snapshots = (
            db.query(WirelessSnapshot)
            .filter(WirelessSnapshot.controller_id.in_(controller_ids), WirelessSnapshot.sampled_at == latest_sampled_at)
            .order_by(WirelessSnapshot.id.desc())
            .all()
            if latest_sampled_at
            else []
        )
    elif controller_ids:
        snapshot_limit = 1600 if fast and not refresh else 12000
        snapshots = (
            db.query(WirelessSnapshot)
            .filter(WirelessSnapshot.controller_id.in_(controller_ids))
            .order_by(WirelessSnapshot.sampled_at.desc(), WirelessSnapshot.id.desc())
            .limit(snapshot_limit)
            .all()
        )
    else:
        snapshots = []
    latest_by_ap: dict[str, WirelessSnapshot] = {}
    for snapshot in snapshots:
        key = f"{snapshot.controller_id}:{snapshot.ap_key}"
        if key not in latest_by_ap:
            latest_by_ap[key] = snapshot

    latest = [_snapshot_payload(row) for row in latest_by_ap.values()]
    _enrich_wireless_ap_inventory(db, latest)
    _enrich_latest_ap_status_times(latest, snapshots, latest_by_ap)
    history = [] if fast and not refresh else _snapshot_history_buckets(snapshots)
    updated_at = max((row.sampled_at for row in latest_by_ap.values() if row.sampled_at), default=None)
    return {
        "message": "ok",
        "data": {
            "access_points": latest,
            "history": history,
            "summary": _monitoring_summary(latest, monitoring_controllers),
            "updated_at": _utc_iso(updated_at),
            "source": "wireless_snapshots" if snapshots else "empty",
            "fast": fast,
            "controllers": [_public_controller(item) for item in controllers],
            "monitoring_controllers": [_public_controller(item) for item in monitoring_controllers],
            "refresh": refresh_status,
        },
    }


@router.get("/access-points/detail", response_model=dict)
def wireless_access_point_detail(
    controller_id: str = "",
    ap_key: str = "",
    refresh: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _load_persisted_ap_name_map(db)
    controllers = _controllers(db)
    controller_ids = [str(controller.get("id")) for controller in controllers if controller.get("id")]
    snapshot = _find_wireless_ap_snapshot(db, controller_ids, controller_id, ap_key)
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wireless AP snapshot not found")

    ap = _snapshot_payload(snapshot)
    controller = next((item for item in controllers if str(item.get("id") or "") == str(ap.get("controller_id") or snapshot.controller_id)), None)
    refreshed_from_controller = False
    controller_refresh_error = ""
    if controller and refresh:
        try:
            current_ap = _refresh_single_ap_from_controller(db, controller, ap)
            if current_ap:
                ap.update(current_ap)
                refreshed_from_controller = True
        except Exception as exc:
            controller_refresh_error = f"Controller AP refresh failed: {exc}"
    config_row: dict[str, Any] = {}
    snmp_detail: dict[str, Any] = {
        "reachable": False,
        "system": {},
        "interfaces": [],
        "ip_addresses": [],
        "errors": [],
        "collected_at": None,
    }
    if controller:
        community, source_label = _controller_snmp_community(db, controller)
        if community:
            if str(controller.get("vendor") or "").lower() == "ruckus-zonedirector" and str(controller.get("protocol") or "").lower() in {"snmp", "snmp_v2c", "snmpv2c"}:
                try:
                    zd_client = SnmpClient(str(controller.get("host") or ""), community, port=int(controller.get("port") or 161), timeout=2.0, retries=1)
                    config_row = _matching_zonedirector_ap_config(zd_client, ap) or {}
                    if config_row:
                        _merge_zonedirector_ap_config([ap], [config_row], overwrite_name=False)
                except Exception as exc:
                    snmp_detail["errors"].append(f"ZoneDirector AP config lookup failed: {exc}")
            snmp_detail = _collect_ap_snmp_detail(ap, community, source_label) if refresh else snmp_detail
        else:
            snmp_detail["errors"].append("No SNMP community is available for this controller.")
    if controller_refresh_error:
        snmp_detail["errors"].append(controller_refresh_error)
    _enrich_wireless_ap_inventory(db, [ap])
    config_row = _ap_detail_config_row(config_row, ap, refreshed_from_controller)
    _apply_controller_snapshot_fallback_to_snmp_detail(snmp_detail, ap)
    if refreshed_from_controller:
        db.commit()

    return {
        "message": "ok",
        "data": {
            "access_point": ap,
            "controller": _public_controller(controller) if controller else None,
            "config": config_row,
            "snmp": snmp_detail,
            "snapshot": _ap_detail_snapshot_row(snapshot, ap, refreshed_from_controller),
        },
    }


@router.post("/controllers", response_model=dict)
def save_controller(
    payload: WirelessControllerPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    controllers = _controllers(db)
    now = _now()
    controller = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip(),
        "vendor": payload.vendor.strip() or "generic",
        "controller_role": _controller_role(payload.controller_role),
        "host": payload.host.strip(),
        "port": payload.port,
        "protocol": payload.protocol.strip() or "https",
        "username": payload.username.strip(),
        "password_encrypted": encrypt_secret(payload.password),
        "password_configured": bool(payload.password),
        "snmp_credential_id": payload.snmp_credential_id,
        "site_name": payload.site_name.strip(),
        "verify_tls": payload.verify_tls,
        "enabled": payload.enabled,
        "notes": payload.notes.strip(),
        "last_test": None,
        "last_scan": None,
        "last_live_collection": None,
        "created_at": now,
        "updated_at": now,
    }
    controllers.append(controller)
    _save_controllers(db, controllers)
    db.add(AuditLog(
        action="wireless_controller_save",
        entity_type="wireless_controller",
        entity_id=None,
        details=json.dumps({"user": current_user.email, "controller_id": controller["id"], "host": controller["host"]}),
    ))
    db.commit()
    return {"message": "saved", "data": _public_controller(controller)}


@router.put("/controllers/{controller_id}", response_model=dict)
def update_controller(
    controller_id: str,
    payload: WirelessControllerPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    controllers = _controllers(db)
    controller = _controller_or_404(controllers, controller_id)
    previous_host = controller.get("host")
    controller.update({
        "name": payload.name.strip(),
        "vendor": payload.vendor.strip() or "generic",
        "controller_role": _controller_role(payload.controller_role),
        "host": payload.host.strip(),
        "port": payload.port,
        "protocol": payload.protocol.strip() or "https",
        "username": payload.username.strip(),
        "snmp_credential_id": payload.snmp_credential_id,
        "site_name": payload.site_name.strip(),
        "verify_tls": payload.verify_tls,
        "enabled": payload.enabled,
        "notes": payload.notes.strip(),
        "updated_at": _now(),
    })
    if payload.password:
        controller["password_encrypted"] = encrypt_secret(payload.password)
        controller["password_configured"] = True
    _save_controllers(db, controllers)
    db.add(AuditLog(
        action="wireless_controller_update",
        entity_type="wireless_controller",
        entity_id=None,
        details=json.dumps({"user": current_user.email, "controller_id": controller_id, "previous_host": previous_host, "host": controller["host"]}),
    ))
    db.commit()
    return {"message": "updated", "data": _public_controller(controller)}


@router.delete("/controllers/{controller_id}", response_model=dict)
def delete_controller(controller_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _delete_controller_record(controller_id, db, current_user)


@router.post("/controllers/{controller_id}/delete", response_model=dict)
def delete_controller_fallback(controller_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _delete_controller_record(controller_id, db, current_user)


def _delete_controller_record(controller_id: str, db: Session, current_user: User):
    controllers = _controllers(db)
    controller_id = str(controller_id)
    next_controllers = [item for item in controllers if str(item.get("id") or "") != controller_id]
    if len(next_controllers) == len(controllers):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wireless controller not found")
    deleted_snapshots = db.query(WirelessSnapshot).filter(WirelessSnapshot.controller_id == controller_id).delete(synchronize_session=False)
    _remember_deleted_controller_id(db, controller_id)
    _save_controllers(db, next_controllers)
    db.add(AuditLog(
        action="wireless_controller_delete",
        entity_type="wireless_controller",
        entity_id=None,
        details=json.dumps({"user": current_user.email, "controller_id": controller_id, "deleted_snapshots": deleted_snapshots}),
    ))
    db.commit()
    return {"message": "deleted", "data": {"id": controller_id, "deleted_snapshots": deleted_snapshots}}


@router.post("/controllers/{controller_id}/test", response_model=dict)
def test_controller(controller_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    controllers = _controllers(db)
    controller = _controller_or_404(controllers, controller_id)
    started = datetime.now(timezone.utc)
    ok, detail = _test_controller_connectivity(db, controller)
    elapsed_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    controller["last_test"] = {"ok": ok, "detail": detail, "elapsed_ms": elapsed_ms, "checked_at": _now()}
    controller["updated_at"] = _now()
    _save_controllers(db, controllers)
    db.commit()
    return {"message": "ok" if ok else "failed", "data": _public_controller(controller) | {"test": controller["last_test"]}}


@router.post("/controllers/{controller_id}/scan", response_model=dict)
def scan_controller(controller_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    controllers = _controllers(db)
    controller = _controller_or_404(controllers, controller_id)
    job = start_job(db, "wireless_controller_scan", controller["host"], current_user.email, {
        "controller_id": controller_id,
        "name": controller.get("name"),
        "vendor": controller.get("vendor"),
        "host": controller.get("host"),
        "protocol": controller.get("protocol"),
    })
    try:
        update_job_progress(db, job, 20, {"phase": "connecting", "controller_id": controller_id})
        collected = _collect_from_controller(db, controller)
        update_job_progress(db, job, 70, {"phase": "reading_controller", "controller_id": controller_id, "source": collected.get("source")})
        aps = collected.get("access_points") or []
        controllers_found = collected.get("controllers") or []
        note = collected.get("note", "")
        source = collected.get("source", "device_inventory")
        if not aps:
            note = note or "Controller scan returned no AP records. No inventory fallback was used because wireless monitoring only shows controller-collected data."
        _persist_wireless_snapshots(db, controller, aps, source)
        result = {
            "controller_id": controller_id,
            "controller": _public_controller(controller),
            "access_points": aps,
            "controllers": controllers_found,
            "source": source,
            "note": note,
        }
        controller["last_scan"] = {"ok": True, "aps": len(aps), "controllers": len(controllers_found), "scanned_at": _now(), "job_id": job.id}
        controller["updated_at"] = _now()
        _save_controllers(db, controllers)
        complete_job(db, job, result)
        return {"message": "scan complete", "data": result, "job_id": job.id}
    except Exception as exc:
        fail_job(db, job, str(exc))
        raise


def _controllers(db: Session) -> list[dict[str, Any]]:
    row = db.query(AppConfig).filter(AppConfig.key == WIRELESS_CONTROLLERS_KEY).first()
    if not row or not row.value:
        return []
    try:
        parsed = json.loads(row.value)
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []
    deleted_ids = _deleted_controller_ids(db)
    return [controller for controller in parsed if str(controller.get("id") or "") not in deleted_ids]


def _save_controllers(db: Session, controllers: list[dict[str, Any]]) -> None:
    deleted_ids = _deleted_controller_ids(db)
    controllers = [controller for controller in controllers if str(controller.get("id") or "") not in deleted_ids]
    row = db.query(AppConfig).filter(AppConfig.key == WIRELESS_CONTROLLERS_KEY).first()
    if not controllers:
        if row:
            db.delete(row)
        return
    value = json.dumps(controllers, default=str)
    if row:
        row.value = value
        row.description = "Wireless controller connection profiles."
    else:
        db.add(AppConfig(key=WIRELESS_CONTROLLERS_KEY, value=value, description="Wireless controller connection profiles."))


def _deleted_controller_ids(db: Session) -> set[str]:
    row = db.query(AppConfig).filter(AppConfig.key == WIRELESS_DELETED_CONTROLLERS_KEY).first()
    if not row or not row.value:
        return set()
    try:
        parsed = json.loads(row.value)
    except (TypeError, ValueError):
        return set()
    if not isinstance(parsed, list):
        return set()
    return {str(item) for item in parsed if str(item)}


def _remember_deleted_controller_id(db: Session, controller_id: str) -> None:
    deleted_ids = _deleted_controller_ids(db)
    deleted_ids.add(str(controller_id))
    value = json.dumps(sorted(deleted_ids))
    row = db.query(AppConfig).filter(AppConfig.key == WIRELESS_DELETED_CONTROLLERS_KEY).first()
    if row:
        row.value = value
        row.description = "Wireless controller IDs deleted by users; prevents in-flight refresh from restoring stale profiles."
    else:
        db.add(AppConfig(
            key=WIRELESS_DELETED_CONTROLLERS_KEY,
            value=value,
            description="Wireless controller IDs deleted by users; prevents in-flight refresh from restoring stale profiles.",
        ))


def _load_persisted_ap_name_map(db: Session) -> dict[str, str]:
    row = db.query(AppConfig).filter(AppConfig.key == WIRELESS_AP_NAMES_KEY).first()
    if not row or not row.value:
        return {}
    try:
        parsed = json.loads(row.value)
    except ValueError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    now = datetime.now(timezone.utc)
    names: dict[str, str] = {}
    for key, value in parsed.items():
        name = str(value or "").strip()
        cache_key = str(key or "").strip()
        if not cache_key or not name:
            continue
        names[cache_key] = name
        AP_NAME_CACHE[cache_key] = (name, now)
    return names


def _save_persisted_ap_name_map(db: Session, names: dict[str, str]) -> None:
    clean = {str(key): str(value).strip() for key, value in names.items() if str(key).strip() and str(value).strip()}
    row = db.query(AppConfig).filter(AppConfig.key == WIRELESS_AP_NAMES_KEY).first()
    value = json.dumps(clean, ensure_ascii=False, sort_keys=True)
    if row:
        row.value = value
        row.description = "Wireless AP name lookup map from controller configuration tables."
    else:
        db.add(AppConfig(key=WIRELESS_AP_NAMES_KEY, value=value, description="Wireless AP name lookup map from controller configuration tables."))
    db.flush()


def _remember_zonedirector_config_names(db: Session, config_rows: list[dict[str, Any]]) -> None:
    if not config_rows:
        return
    names = _load_persisted_ap_name_map(db)
    changed = False
    now = datetime.now(timezone.utc)
    for row in config_rows:
        name = str(row.get("device_name") or "").strip()
        if not _valid_zonedirector_config_name(name, row):
            continue
        for key in _ap_name_cache_keys(row):
            if names.get(key) != name:
                names[key] = name
                changed = True
            AP_NAME_CACHE[key] = (name, now)
    if changed:
        _save_persisted_ap_name_map(db, names)


def _controller_or_404(controllers: list[dict[str, Any]], controller_id: str) -> dict[str, Any]:
    for controller in controllers:
        if controller.get("id") == controller_id:
            return controller
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wireless controller not found")


def _public_controller(controller: dict[str, Any]) -> dict[str, Any]:
    controller_role = _controller_role(controller)
    return {
        key: value
        for key, value in controller.items()
        if key != "password_encrypted"
    } | {
        "controller_role": controller_role,
        "monitoring_enabled": controller_role == "primary",
        "password_configured": bool(controller.get("password_configured") or controller.get("password_encrypted")),
    }


def _controller_role(controller: dict[str, Any] | str | None) -> str:
    if isinstance(controller, dict):
        raw_role = str(controller.get("controller_role") or controller.get("role") or "").strip().lower()
        name = str(controller.get("name") or "").strip().lower()
    else:
        raw_role = str(controller or "").strip().lower()
        name = ""
    if raw_role in {"backup", "standby", "secondary"}:
        return "backup"
    if not raw_role and ("backup" in name or "standby" in name):
        return "backup"
    return "primary"


def _is_monitoring_controller(controller: dict[str, Any]) -> bool:
    return _controller_role(controller) == "primary"


def _refresh_enabled_controllers(db: Session, controllers: list[dict[str, Any]]) -> dict[str, Any]:
    refresh_status: dict[str, Any] = {
        "requested": True,
        "attempted": 0,
        "refreshed": 0,
        "skipped": 0,
        "failed": 0,
        "collected_ap_records": 0,
        "throttle_seconds": 3,
        "refreshed_at": None,
        "errors": [],
    }
    for controller in controllers:
        if not _is_monitoring_controller(controller):
            refresh_status["skipped"] += 1
            continue
        if not controller.get("enabled", True):
            refresh_status["skipped"] += 1
            continue
        last_refresh = _parse_time(controller.get("last_live_refresh_at"))
        if last_refresh and (datetime.now(timezone.utc) - last_refresh).total_seconds() < 3:
            refresh_status["skipped"] += 1
            continue
        started = datetime.now(timezone.utc)
        now = _now()
        refresh_status["attempted"] += 1
        try:
            collected = _collect_from_controller(db, controller)
        except Exception as exc:
            elapsed_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
            detail = f"Live collection failed: {exc}"
            controller["last_live_collection"] = {"ok": False, "detail": detail, "elapsed_ms": elapsed_ms, "checked_at": now, "aps": 0, "controllers": 0}
            controller["last_live_refresh_at"] = now
            controller["updated_at"] = now
            refresh_status["failed"] += 1
            refresh_status["errors"].append({"controller_id": controller.get("id"), "name": controller.get("name"), "detail": detail})
            continue
        elapsed_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
        aps = collected.get("access_points") or []
        source = collected.get("source", "controller")
        note = str(collected.get("note") or "")
        if aps:
            _persist_wireless_snapshots(db, controller, aps, source)
            controller["last_live_collection"] = {"ok": True, "detail": f"Live collection succeeded from {source}.", "elapsed_ms": elapsed_ms, "checked_at": now, "aps": len(aps), "controllers": len(collected.get("controllers") or []), "source": source}
            refresh_status["refreshed"] += 1
            refresh_status["collected_ap_records"] += len(aps)
        else:
            ok = bool(collected.get("controllers") or [])
            detail = note or "Controller returned no AP records."
            controller["last_live_collection"] = {"ok": ok, "detail": detail, "elapsed_ms": elapsed_ms, "checked_at": now, "aps": 0, "controllers": len(collected.get("controllers") or [])}
            if ok:
                refresh_status["refreshed"] += 1
            else:
                refresh_status["failed"] += 1
                refresh_status["errors"].append({"controller_id": controller.get("id"), "name": controller.get("name"), "detail": detail})
        controller["last_live_refresh_at"] = now
        controller["updated_at"] = now
    refresh_status["refreshed_at"] = _now()
    return refresh_status


def _parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        text = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _serialize_ap(device: Device) -> dict[str, Any]:
    return {
        "id": device.id,
        "name": device.name,
        "hostname": device.hostname,
        "management_ip": device.management_ip,
        "role": device.role,
        "status": device.status,
        "platform": device.platform,
        "manufacturer": device.manufacturer,
        "model": device.model,
        "site_id": device.site_id,
        "site": device.site.name if device.site else "",
        "location": device.location,
        "snmp_status": device.snmp_status,
        "last_seen_at": str(device.last_seen_at) if device.last_seen_at else None,
    }


def _persist_wireless_snapshots(db: Session, controller: dict[str, Any], aps: list[dict[str, Any]], source: str) -> None:
    sampled_at = datetime.now(timezone.utc)
    for ap in aps:
        ap_key = _ap_key(ap)
        payload = dict(ap)
        payload["controller_id"] = controller.get("id")
        payload["controller_name"] = controller.get("name")
        payload["sampled_at"] = sampled_at.isoformat()
        db.add(WirelessSnapshot(
            controller_id=str(controller.get("id") or ""),
            controller_name=str(controller.get("name") or ""),
            source=source,
            ap_key=ap_key,
            ap_name=str(ap.get("name") or ap_key),
            status=str(ap.get("status") or ""),
            clients=_int_value(ap.get("clients") if ap.get("clients") is not None else ap.get("controller_clients")),
            radios=_int_value(ap.get("radios")),
            cpu_util=_int_value(ap.get("cpu_util")),
            memory_util=_int_value(ap.get("memory_util")),
            traffic_rx_rate=_int_value(ap.get("traffic_rx_rate")),
            traffic_tx_rate=_int_value(ap.get("traffic_tx_rate")),
            traffic_rx_bytes=_int_value(ap.get("traffic_rx_bytes")),
            traffic_tx_bytes=_int_value(ap.get("traffic_tx_bytes")),
            dropped_packets=_int_value(ap.get("dropped_packets")),
            lan_rx_errors=_int_value(ap.get("lan_rx_errors")),
            payload=json.dumps(payload, default=str),
            sampled_at=sampled_at,
        ))
    cutoff = sampled_at - timedelta(days=30)
    db.query(WirelessSnapshot).filter(WirelessSnapshot.sampled_at < cutoff).delete(synchronize_session=False)


def _refresh_single_ap_from_controller(db: Session, controller: dict[str, Any], ap: dict[str, Any]) -> dict[str, Any] | None:
    if not controller.get("enabled", True):
        return None
    collected = _collect_from_controller(db, controller)
    access_points = collected.get("access_points") or []
    if not access_points:
        return None
    target_keys = _payload_lookup_keys(ap)
    current_ap = next((candidate for candidate in access_points if target_keys & _payload_lookup_keys(candidate)), None)
    if not current_ap:
        return None
    current_ap["controller_id"] = controller.get("id")
    current_ap["controller_name"] = controller.get("name")
    current_ap["sampled_at"] = _now()
    _persist_wireless_snapshots(db, controller, [current_ap], str(collected.get("source") or "controller"))
    return current_ap


def _ap_detail_config_row(config_row: dict[str, Any], ap: dict[str, Any], refreshed_from_controller: bool) -> dict[str, Any]:
    row = dict(config_row or {})
    for target, source in (
        ("device_name", "name"),
        ("description", "description"),
        ("location", "location"),
        ("management_ip", "management_ip"),
        ("mac_address", "mac_address"),
        ("model", "model"),
        ("serial_number", "serial_number"),
        ("software_version", "software_version"),
        ("hardware_version", "hardware_version"),
        ("uptime", "uptime"),
        ("uptime_ticks", "uptime_ticks"),
        ("status", "status"),
        ("clients", "clients"),
        ("cpu_util", "cpu_util"),
        ("memory_util", "memory_util"),
        ("memory_used_kb", "memory_used_kb"),
        ("memory_total_kb", "memory_total_kb"),
        ("traffic_rx_rate", "traffic_rx_rate"),
        ("traffic_tx_rate", "traffic_tx_rate"),
        ("traffic_rx_bytes", "traffic_rx_bytes"),
        ("traffic_tx_bytes", "traffic_tx_bytes"),
        ("lan_rx_packets", "lan_rx_packets"),
        ("lan_tx_packets", "lan_tx_packets"),
        ("lan_rx_errors", "lan_rx_errors"),
        ("dropped_packets", "dropped_packets"),
        ("zd_config_index", "zd_config_index"),
        ("zd_ap_index", "zd_ap_index"),
        ("sampled_at", "sampled_at"),
    ):
        value = ap.get(source)
        if value not in (None, "") and not row.get(target):
            row[target] = value
    row["source"] = "ZoneDirector config SNMP + latest controller snapshot" if config_row else "Latest controller snapshot"
    row["fresh"] = refreshed_from_controller
    return row


def _ap_detail_snapshot_row(snapshot: WirelessSnapshot, ap: dict[str, Any], refreshed_from_controller: bool) -> dict[str, Any]:
    row = _snapshot_history(snapshot)
    for key in (
        "sampled_at",
        "controller_id",
        "controller_name",
        "id",
        "name",
        "hostname",
        "management_ip",
        "mac_address",
        "model",
        "serial_number",
        "software_version",
        "hardware_version",
        "uptime",
        "uptime_ticks",
        "status",
        "clients",
        "radios",
        "cpu_util",
        "memory_util",
        "memory_used_kb",
        "memory_total_kb",
        "traffic_rx_rate",
        "traffic_tx_rate",
        "traffic_rx_bytes",
        "traffic_tx_bytes",
        "client_rx_kbytes",
        "client_tx_kbytes",
        "lan_rx_packets",
        "lan_tx_packets",
        "lan_rx_errors",
        "dropped_packets",
        "zd_config_index",
        "zd_ap_index",
        "last_seen_at",
        "snmp_status",
    ):
        value = ap.get(key)
        if value not in (None, ""):
            row[key] = value
    row["fresh"] = refreshed_from_controller
    row["source"] = "latest_controller_refresh" if refreshed_from_controller else "stored_wireless_snapshot"
    return row


def _apply_controller_snapshot_fallback_to_snmp_detail(snmp_detail: dict[str, Any], ap: dict[str, Any]) -> None:
    if snmp_detail.get("reachable"):
        return
    system = snmp_detail.setdefault("system", {})
    name = str(ap.get("name") or ap.get("hostname") or ap.get("ap_name") or "").strip()
    model = str(ap.get("model") or "").strip()
    software = str(ap.get("software_version") or "").strip()
    manufacturer = str(ap.get("manufacturer") or "Ruckus").strip()
    if name:
        system.setdefault("sys_name", name)
    if model or software:
        system.setdefault("sys_descr", " ".join(part for part in (manufacturer, model, f"software {software}" if software else "") if part))
    if ap.get("location"):
        system.setdefault("sys_location", ap.get("location"))
    if ap.get("memory_total_kb"):
        system.setdefault("hr_memory_size_kb", ap.get("memory_total_kb"))
    if ap.get("uptime"):
        system.setdefault("sys_uptime", ap.get("uptime"))
    elif ap.get("uptime_ticks"):
        system.setdefault("sys_uptime", _format_zonedirector_uptime(ap.get("uptime_ticks")))
    if ap.get("sampled_at"):
        snmp_detail["collected_at"] = ap.get("sampled_at")
    if not snmp_detail.get("interfaces") and (ap.get("management_ip") or ap.get("mac_address")):
        connected = str(ap.get("status") or "").lower() in {"connected", "up", "online", "active"}
        snmp_detail["interfaces"] = [{
            "index": "controller-lan",
            "name": "Controller LAN",
            "descr": "Controller-reported AP uplink counters",
            "admin_status_label": "up" if connected else "unknown",
            "oper_status_label": "up" if connected else "unknown",
            "speed": 0,
            "phys_address": ap.get("mac_address") or "",
            "hc_in_octets": ap.get("traffic_rx_bytes") or 0,
            "hc_out_octets": ap.get("traffic_tx_bytes") or 0,
            "in_errors": ap.get("lan_rx_errors") or 0,
            "out_errors": ap.get("dropped_packets") or 0,
            "source": "controller_snapshot",
        }]
    if not snmp_detail.get("ip_addresses") and ap.get("management_ip"):
        snmp_detail["ip_addresses"] = [{
            "ip_address": ap.get("management_ip"),
            "if_index": "controller-lan",
            "netmask": "",
            "broadcast": "",
            "source": "controller_snapshot",
        }]
    errors = snmp_detail.setdefault("errors", [])
    if not any("latest ZoneDirector controller snapshot" in str(item) for item in errors):
        errors.append("Direct AP SNMP is unavailable; AP system, interface, and IP fallback rows use the latest ZoneDirector controller snapshot.")


def _snapshot_payload(snapshot: WirelessSnapshot) -> dict[str, Any]:
    try:
        payload = json.loads(snapshot.payload or "{}")
    except (TypeError, ValueError):
        payload = {}
    cached_name = _cached_ap_name_for_payload(payload)
    current_name = str(payload.get("name") or snapshot.ap_name or "").strip()
    if cached_name and _needs_display_name_replacement(current_name, payload):
        payload["name"] = cached_name
        payload["hostname"] = cached_name
        payload["ap_name"] = cached_name
    elif cached_name and _should_use_zonedirector_config_name(current_name, payload):
        payload["name"] = cached_name
        payload["hostname"] = cached_name
        payload["ap_name"] = cached_name
    payload.update({
        "id": payload.get("id") or f"wireless-snapshot:{snapshot.controller_id}:{snapshot.ap_key}",
        "name": payload.get("name") or snapshot.ap_name,
        "hostname": payload.get("hostname") or payload.get("name") or snapshot.ap_name,
        "ap_name": payload.get("ap_name") or payload.get("name") or snapshot.ap_name,
        "status": payload.get("status") or snapshot.status,
        "clients": snapshot.clients,
        "radios": snapshot.radios,
        "cpu_util": snapshot.cpu_util,
        "memory_util": snapshot.memory_util,
        "traffic_rx_rate": snapshot.traffic_rx_rate,
        "traffic_tx_rate": snapshot.traffic_tx_rate,
        "traffic_rx_bytes": snapshot.traffic_rx_bytes,
        "traffic_tx_bytes": snapshot.traffic_tx_bytes,
        "dropped_packets": snapshot.dropped_packets,
        "lan_rx_errors": snapshot.lan_rx_errors,
        "controller_id": snapshot.controller_id,
        "controller_name": snapshot.controller_name,
        "snmp_status": payload.get("snmp_status") or "Collected",
        "last_seen_at": _utc_iso(snapshot.sampled_at),
    })
    return payload


def _enrich_wireless_ap_inventory(db: Session, access_points: list[dict[str, Any]]) -> None:
    if not access_points:
        return

    ids: set[int] = set()
    lookup_keys: set[str] = set()
    for ap in access_points:
        ap_id = str(ap.get("id") or "").strip()
        if ap_id.isdigit():
            ids.add(int(ap_id))
        lookup_keys.update(_payload_lookup_keys(ap))

    filters = []
    if ids:
        filters.append(Device.id.in_(ids))
    if lookup_keys:
        filters.extend([
            func.lower(Device.name).in_(lookup_keys),
            func.lower(Device.hostname).in_(lookup_keys),
            func.lower(Device.management_ip).in_(lookup_keys),
            func.lower(Device.mac_address).in_(lookup_keys),
            func.lower(Device.serial_number).in_(lookup_keys),
        ])
    if not filters:
        return

    devices = db.query(Device).filter(or_(*filters)).all()
    devices_by_id = {device.id: device for device in devices}
    devices_by_key: dict[str, Device] = {}
    for device in devices:
        for key in _device_inventory_lookup_keys(device):
            devices_by_key.setdefault(key, device)

    for ap in access_points:
        device = None
        ap_id = str(ap.get("id") or "").strip()
        if ap_id.isdigit():
            device = devices_by_id.get(int(ap_id))
        if device is None:
            device = next((devices_by_key.get(key) for key in _payload_lookup_keys(ap) if devices_by_key.get(key)), None)
        if device is not None:
            _apply_inventory_device_to_wireless_ap(ap, device)


def _device_inventory_lookup_keys(device: Device) -> set[str]:
    values = {
        device.name,
        device.hostname,
        device.management_ip,
        device.mac_address,
        device.serial_number,
    }
    keys = {str(value or "").strip().lower() for value in values if str(value or "").strip()}
    if device.mac_address:
        keys.update(_lookup_key_variants(str(device.mac_address)))
        keys.update(_lookup_key_variants(f"zd-snmp:{device.mac_address}"))
    return keys


def _apply_inventory_device_to_wireless_ap(ap: dict[str, Any], device: Device) -> None:
    ap.update({
        "id": device.id,
        "site_id": device.site_id,
        "site": device.site.name if device.site else "",
        "location": device.location or "",
        "rack": device.rack or "",
        "position": device.position,
        "role": device.role or ap.get("role") or "",
        "device_type": device.device_type or ap.get("device_type") or "",
        "platform": device.platform or ap.get("platform") or "",
        "manufacturer": device.manufacturer or ap.get("manufacturer") or "",
        "model": device.model or ap.get("model") or "",
        "serial_number": device.serial_number or ap.get("serial_number") or "",
        "mac_address": device.mac_address or ap.get("mac_address") or "",
        "management_ip": device.management_ip or ap.get("management_ip") or "",
    })


def _snapshot_history_buckets(snapshots: list[WirelessSnapshot]) -> list[dict[str, Any]]:
    buckets: dict[str, dict[str, WirelessSnapshot]] = {}
    ordered = sorted(snapshots, key=lambda row: (row.sampled_at or datetime.min.replace(tzinfo=timezone.utc), row.id or 0))
    for snapshot in ordered:
        if not snapshot.sampled_at:
            continue
        sampled_at = snapshot.sampled_at
        if sampled_at.tzinfo is None:
            sampled_at = sampled_at.replace(tzinfo=timezone.utc)
        sampled_at = sampled_at.astimezone(timezone.utc)
        sampled_at = sampled_at.replace(second=(sampled_at.second // 10) * 10, microsecond=0)
        bucket_key = sampled_at.isoformat()
        ap_key = f"{snapshot.controller_id}:{snapshot.ap_key}"
        buckets.setdefault(bucket_key, {})[ap_key] = snapshot

    history: list[dict[str, Any]] = []
    for sampled_at, rows in sorted(buckets.items()):
        values = list(rows.values())
        critical = warning = minor = 0
        for snapshot in values:
            bucket = _ap_health_bucket({
                "status": snapshot.status,
                "cpu_util": snapshot.cpu_util,
                "memory_util": snapshot.memory_util,
                "dropped_packets": snapshot.dropped_packets,
                "lan_rx_errors": snapshot.lan_rx_errors,
            })
            if bucket == "critical":
                critical += 1
            elif bucket == "warning":
                warning += 1
        history.append({
            "sampled_at": sampled_at,
            "traffic_rx_rate": sum(_int_value(row.traffic_rx_rate) for row in values),
            "traffic_tx_rate": sum(_int_value(row.traffic_tx_rate) for row in values),
            "critical": critical,
            "major": warning,
            "minor": minor,
        })
    return history[-120:]


def _snapshot_history(snapshot: WirelessSnapshot) -> dict[str, Any]:
    return {
        "sampled_at": _utc_iso(snapshot.sampled_at),
        "controller_id": snapshot.controller_id,
        "controller_name": snapshot.controller_name,
        "ap_key": snapshot.ap_key,
        "ap_name": snapshot.ap_name,
        "status": snapshot.status,
        "clients": snapshot.clients,
        "traffic_rx_rate": snapshot.traffic_rx_rate,
        "traffic_tx_rate": snapshot.traffic_tx_rate,
        "traffic_rx_bytes": snapshot.traffic_rx_bytes,
        "traffic_tx_bytes": snapshot.traffic_tx_bytes,
        "cpu_util": snapshot.cpu_util,
        "memory_util": snapshot.memory_util,
        "dropped_packets": snapshot.dropped_packets,
        "lan_rx_errors": snapshot.lan_rx_errors,
    }


def _enrich_latest_ap_status_times(
    latest: list[dict[str, Any]],
    snapshots: list[WirelessSnapshot],
    latest_by_ap: dict[str, WirelessSnapshot],
) -> None:
    if not latest or not snapshots:
        return
    history_by_key: dict[str, list[WirelessSnapshot]] = {}
    for snapshot in snapshots:
        history_by_key.setdefault(f"{snapshot.controller_id}:{snapshot.ap_key}", []).append(snapshot)

    for ap in latest:
        controller_id = str(ap.get("controller_id") or "")
        key = f"{controller_id}:{_ap_key(ap)}"
        latest_snapshot = latest_by_ap.get(key)
        rows = sorted(
            history_by_key.get(key) or [],
            key=lambda row: (row.sampled_at or datetime.min.replace(tzinfo=timezone.utc), row.id or 0),
            reverse=True,
        )
        current_connected = _wireless_status_is_connected(ap.get("status"))
        last_connected = next((row for row in rows if _wireless_status_is_connected(row.status)), None)
        first_current_status = latest_snapshot
        if latest_snapshot:
            latest_status = str(latest_snapshot.status or "")
            for row in rows:
                if str(row.status or "") == latest_status:
                    first_current_status = row
                else:
                    break
        if last_connected and last_connected.sampled_at:
            ap["last_connected_at"] = _utc_iso(last_connected.sampled_at)
        if not current_connected and first_current_status and first_current_status.sampled_at:
            ap["status_since_at"] = _utc_iso(first_current_status.sampled_at)
            ap["offline_since_at"] = _utc_iso(first_current_status.sampled_at)


def _wireless_status_is_connected(value: Any) -> bool:
    status = str(value or "").strip().lower()
    if not status:
        return False
    if "not connected" in status or "disconnect" in status or "down" in status or "unknown" in status:
        return False
    return any(term in status for term in ("connected", "active", "online", "up", "approved", "discovered"))


def _find_wireless_ap_snapshot(db: Session, controller_ids: list[str], controller_id: str, ap_key: str) -> WirelessSnapshot | None:
    targets = _lookup_key_variants(ap_key)
    if not targets:
        return None

    def search_snapshots(preferred_controller_id: str = "") -> WirelessSnapshot | None:
        query = db.query(WirelessSnapshot)
        if preferred_controller_id:
            query = query.filter(WirelessSnapshot.controller_id == preferred_controller_id)
        elif controller_ids:
            query = query.filter(WirelessSnapshot.controller_id.in_(controller_ids))
        snapshots = query.order_by(WirelessSnapshot.sampled_at.desc(), WirelessSnapshot.id.desc()).limit(5000).all()
        for snapshot in snapshots:
            if targets & _snapshot_lookup_keys(snapshot):
                return snapshot
        return None

    snapshot = search_snapshots(controller_id)
    if snapshot:
        return snapshot
    if controller_id:
        return search_snapshots("")
    return None


def _lookup_key_variants(value: Any) -> set[str]:
    text = str(value or "").strip().lower()
    if not text:
        return set()
    variants = {text}
    compact = re.sub(r"[^0-9a-f]", "", text)
    if compact:
        variants.add(compact)
    if text.startswith("zd-snmp:"):
        suffix = text.removeprefix("zd-snmp:")
        variants.add(suffix)
        compact_suffix = re.sub(r"[^0-9a-f]", "", suffix)
        if compact_suffix:
            variants.add(compact_suffix)
    if re.fullmatch(r"[0-9a-f]{12}", compact):
        colon_mac = ":".join(compact[index:index + 2] for index in range(0, 12, 2))
        variants.add(colon_mac)
        variants.add(f"zd-snmp:{colon_mac}")
    return variants


def _snapshot_lookup_keys(snapshot: WirelessSnapshot) -> set[str]:
    try:
        payload = json.loads(snapshot.payload or "{}")
    except (TypeError, ValueError):
        payload = {}
    keys = _payload_lookup_keys(payload)
    keys.update(str(value or "").strip().lower() for value in (snapshot.ap_key, snapshot.ap_name) if str(value or "").strip())
    return keys


def _payload_lookup_keys(payload: dict[str, Any] | set[Any]) -> set[str]:
    if isinstance(payload, set):
        values = set(payload)
    else:
        values = {
            payload.get("id"),
            payload.get("name"),
            payload.get("hostname"),
            payload.get("ap_name"),
            payload.get("device_name"),
            payload.get("management_ip"),
            payload.get("mac_address"),
            payload.get("serial_number"),
            payload.get("zd_config_index"),
        }
    keys = {str(value or "").strip().lower() for value in values if str(value or "").strip()}
    if not isinstance(payload, set) and payload.get("mac_address"):
        mac = str(payload.get("mac_address")).strip().lower()
        keys.update(_lookup_key_variants(mac))
        keys.update(_lookup_key_variants(f"zd-snmp:{mac}"))
    return keys


def _ap_key(ap: dict[str, Any]) -> str:
    return str(ap.get("mac_address") or ap.get("management_ip") or ap.get("id") or ap.get("name") or uuid.uuid4()).lower()


def _ap_display_name(name: Any, ip: Any, serial: Any, model: Any, index: int) -> str:
    for value in (name,):
        text = str(value or "").strip()
        if text and not _looks_like_mac(text):
            return text
    serial_text = str(serial or "").strip()
    if serial_text:
        return f"AP {serial_text}"
    model_text = str(model or "").strip()
    if model_text:
        return f"{model_text} AP {index}"
    return f"Ruckus AP {index}"


def _looks_like_mac(value: str) -> bool:
    return bool(re.fullmatch(r"([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}", value.strip()))


def _int_value(value: Any) -> int:
    try:
        return int(float(value or 0))
    except (TypeError, ValueError):
        return 0


def _controller_health_state(controller: dict[str, Any]) -> bool | None:
    live_collection = controller.get("last_live_collection")
    if isinstance(live_collection, dict):
        return bool(live_collection.get("ok"))
    last_test = controller.get("last_test")
    if isinstance(last_test, dict):
        return bool(last_test.get("ok"))
    return None


def _monitoring_summary(access_points: list[dict[str, Any]], controllers: list[dict[str, Any]]) -> dict[str, Any]:
    healthy = warning = critical = 0
    band_24 = band_5 = unknown_band = 0
    clients_total = rx_rate = tx_rate = 0
    radio_clients_total = 0
    has_radio_clients = False

    for ap in access_points:
        state = _ap_health_bucket(ap)
        if state == "critical":
            critical += 1
        elif state == "warning":
            warning += 1
        else:
            healthy += 1

        clients = _int_value(ap.get("clients") if ap.get("clients") is not None else ap.get("controller_clients"))
        radio_24 = _int_value(ap.get("radio_clients_24"))
        radio_5 = _int_value(ap.get("radio_clients_5"))
        radio_unknown = _int_value(ap.get("radio_clients_unknown"))
        if radio_24 or radio_5 or radio_unknown:
            has_radio_clients = True
            band_24 += radio_24
            band_5 += radio_5
            unknown_band += radio_unknown
            radio_clients_total += radio_24 + radio_5 + radio_unknown
        else:
            clients_total += clients
            band = _ap_band(ap)
            if band == "2.4":
                band_24 += clients
            elif band == "5":
                band_5 += clients
            else:
                unknown_band += clients

        rx_rate += _int_value(ap.get("traffic_rx_rate"))
        tx_rate += _int_value(ap.get("traffic_tx_rate"))

    if has_radio_clients:
        clients_total += radio_clients_total

    controller_critical = sum(1 for controller in controllers if controller.get("enabled", True) and _controller_health_state(controller) is False)
    controller_warning = sum(1 for controller in controllers if controller.get("enabled", True) and _controller_health_state(controller) is None)
    major = warning
    minor = controller_warning
    critical_alerts = critical + controller_critical

    return {
        "access_points": {
            "total": len(access_points),
            "healthy": healthy,
            "warning": warning,
            "critical": critical,
        },
        "clients": {
            "total": clients_total,
            "band_24": band_24,
            "band_5": band_5,
            "unknown": unknown_band,
        },
        "alerts": {
            "total": critical_alerts + major + minor,
            "critical": critical_alerts,
            "major": major,
            "minor": minor,
        },
        "usage": {
            "total_rate": rx_rate + tx_rate,
            "downlink": rx_rate,
            "uplink": tx_rate,
        },
    }


def _ap_health_bucket(ap: dict[str, Any]) -> str:
    status = str(ap.get("status") or "").lower()
    cpu = _int_value(ap.get("cpu_util"))
    memory = _int_value(ap.get("memory_util"))
    if "down" in status or "disconnect" in status or cpu >= 95 or memory >= 95:
        return "critical"
    if "not connected" in status or "unknown" in status:
        return "warning"
    if any(term in status for term in ("pending", "provision", "upgrade", "reboot")) or cpu >= 85 or memory >= 90:
        return "warning"
    if any(term in status for term in ("connected", "active", "approved", "discovered", "up", "online")):
        return "healthy"
    return "warning" if status else "healthy"


def _ap_band(ap: dict[str, Any]) -> str:
    band = str(ap.get("band") or ap.get("radio_band") or ap.get("frequency") or "").lower()
    if "2.4" in band or "2400" in band:
        return "2.4"
    if "5" in band or "5000" in band:
        return "5"
    channel = _int_value(ap.get("channel"))
    if 1 <= channel <= 14:
        return "2.4"
    if channel > 14:
        return "5"
    return "unknown"


def _test_controller_connectivity(db: Session, controller: dict[str, Any]) -> tuple[bool, str]:
    protocol = str(controller.get("protocol") or "").lower()
    host = str(controller.get("host") or "").strip()
    port = int(controller.get("port") or (161 if protocol in {"snmp", "snmp_v2c", "snmpv2c"} else 443))
    if protocol in {"snmp", "snmp_v2c", "snmpv2c"}:
        community, source_label = _controller_snmp_community(db, controller)
        if not community:
            return False, "SNMP community is missing. Select a saved SNMP profile, select global SNMP, or enter it in Password / Token."
        try:
            value = SnmpClient(host, community, port=port, timeout=2.0, retries=1).get("1.3.6.1.2.1.1.1.0")
            detail = _value_to_text(value)[:180] or "SNMP sysDescr response received."
            return True, f"SNMP UDP/{port} succeeded using {source_label}: {detail}"
        except Exception as exc:
            return False, f"SNMP UDP/{port} failed using {source_label}: {exc}"
    try:
        with socket.create_connection((host, port), timeout=3):
            return True, f"TCP port {port} is reachable"
    except OSError as exc:
        return False, str(exc)


def _collect_from_controller(db: Session, controller: dict[str, Any]) -> dict[str, Any]:
    vendor = str(controller.get("vendor") or "").lower()
    if vendor == "ruckus-zonedirector":
        return _collect_ruckus_zonedirector(db, controller)
    return {
        "source": "device_inventory",
        "access_points": [],
        "controllers": [],
        "note": f"No direct collector is available yet for vendor '{controller.get('vendor') or 'generic'}'; showing current wireless inventory records.",
    }


def _collect_ruckus_zonedirector_snmp(db: Session, controller: dict[str, Any]) -> dict[str, Any]:
    community, source_label = _controller_snmp_community(db, controller)
    if not community:
        return {
            "source": "ruckus_zonedirector_snmp",
            "access_points": [],
            "controllers": [],
            "note": "ZoneDirector SNMP community is missing. Select a saved SNMP profile, select the global SNMP community, or put the community in Password / Token.",
        }

    host = str(controller.get("host") or "").strip()
    port = int(controller.get("port") or 161)
    client = SnmpClient(host, community, port=port, timeout=2.0, retries=1)
    try:
        sys_descr = _value_to_text(client.get("1.3.6.1.2.1.1.1.0"))
        sys_name = _value_to_text(client.get("1.3.6.1.2.1.1.5.0"))
        stats = _zonedirector_snmp_stats(client)
        aps = _zonedirector_snmp_aps(client)
        config_rows = _zonedirector_snmp_ap_config(client)
        _remember_zonedirector_config_names(db, config_rows)
        _merge_zonedirector_ap_config(aps, config_rows)
        _enrich_ap_names_from_snmp(aps, community)
        _remember_resolved_ap_names(db, aps)
        controller_row = _public_controller(controller) | {
            "snmp_status": "OK",
            "system_name": sys_name,
            "description": sys_descr,
            "ap_count": stats.get("ap_count"),
            "registered_ap_count": stats.get("registered_ap_count"),
            "client_count": stats.get("all_client_count") or stats.get("client_count"),
            "snmp_source": source_label,
        }
        note = ""
        if not aps:
            ap_count = stats.get("registered_ap_count") or stats.get("ap_count")
            note = (
                f"ZoneDirector SNMP responded on UDP/{port}, but the WLAN AP table returned no rows."
                + (f" Controller reports {ap_count} APs in system stats." if ap_count is not None else "")
            )
        return {
            "source": "ruckus_zonedirector_snmp",
            "access_points": aps,
            "controllers": [controller_row],
            "note": note,
        }
    except Exception as exc:
        return {
            "source": "ruckus_zonedirector_snmp",
            "access_points": [],
            "controllers": [],
            "note": f"ZoneDirector SNMP collection failed on UDP/{port}: {exc}",
        }


def _zonedirector_snmp_stats(client: SnmpClient) -> dict[str, int]:
    stats: dict[str, int] = {}
    for key, oid in ZD_SYSTEM_STATS.items():
        try:
            value = client.get(oid)
        except Exception:
            continue
        if value and isinstance(value.value, int):
            stats[key] = value.value
    return stats


def _zonedirector_snmp_aps(client: SnmpClient) -> list[dict[str, Any]]:
    rows: dict[tuple[int, ...], dict[str, Any]] = {}
    for field, oid in ZD_AP_TABLE_COLUMNS.items():
        for value in client.walk(oid, limit=1024):
            suffix = _oid_suffix(value.oid, oid)
            if suffix:
                rows.setdefault(suffix, {})[field] = _snmp_field_value(field, value)

    radio_clients = _zonedirector_snmp_radio_clients(client)
    aps: list[dict[str, Any]] = []
    seen: set[str] = set()
    for suffix, row in sorted(rows.items()):
        row_index = ".".join(str(part) for part in suffix)
        mac = str(row.get("mac_address") or _mac_from_oid_suffix(suffix) or "").lower()
        ip = str(row.get("management_ip") or "")
        if not mac and not ip:
            continue
        name = _ap_display_name(row.get("description"), ip, row.get("serial_number"), row.get("model"), len(aps) + 1)
        unique = (mac or ip or name).lower()
        if unique in seen:
            continue
        seen.add(unique)
        aps.append({
            "id": f"zd-snmp:{unique}",
            "name": name,
            "hostname": name,
            "zd_ap_index": row_index,
            "management_ip": ip,
            "role": "Access Point",
            "status": _zonedirector_snmp_status(row.get("status")),
            "platform": "Ruckus ZoneDirector SNMP",
            "manufacturer": "Ruckus",
            "model": row.get("model") or "",
            "site": "",
            "location": row.get("description") or "",
            "snmp_status": "Controller collected",
            "last_seen_at": _now(),
            "mac_address": mac,
            "serial_number": row.get("serial_number") or "",
            "uptime_ticks": row.get("uptime_ticks"),
            "uptime": _format_zonedirector_uptime(row.get("uptime_ticks")),
            "software_version": row.get("software_version") or "",
            "hardware_version": row.get("hardware_version") or "",
            "clients": _zonedirector_client_count(row.get("clients"), row.get("total_users")),
            "controller_clients": row.get("clients"),
            "radio_clients_24": radio_clients.get(mac, {}).get("2.4", 0),
            "radio_clients_5": radio_clients.get(mac, {}).get("5", 0),
            "radio_clients_unknown": radio_clients.get(mac, {}).get("unknown", 0),
            "radio_clients_total": sum(radio_clients.get(mac, {}).values()) if mac in radio_clients else 0,
            "radios": row.get("radios"),
            "connection_mode": row.get("connection_mode"),
            "cpu_util": row.get("cpu_util"),
            "memory_util": _zonedirector_memory_percent(row.get("memory_util"), row.get("memory_total_kb")),
            "memory_used_kb": row.get("memory_util"),
            "memory_total_kb": row.get("memory_total_kb"),
            "mesh_type": _zonedirector_mesh_type(row.get("mesh_type")),
            "traffic_rx_bytes": row.get("lan_rx_bytes"),
            "traffic_tx_bytes": row.get("lan_tx_bytes"),
            "traffic_rx_rate": row.get("lan_rx_byte_rate"),
            "traffic_tx_rate": row.get("lan_tx_byte_rate"),
            "client_rx_kbytes": row.get("sta_rx_kbytes"),
            "client_tx_kbytes": row.get("sta_tx_kbytes"),
            "lan_rx_packets": row.get("lan_rx_packets"),
            "lan_tx_packets": row.get("lan_tx_packets"),
            "lan_rx_errors": row.get("lan_rx_errors"),
            "dropped_packets": row.get("dropped_packets"),
        })
    return aps


def _zonedirector_snmp_ap_config(client: SnmpClient) -> list[dict[str, Any]]:
    rows: dict[tuple[int, ...], dict[str, Any]] = {}
    for field, oid in ZD_AP_CONFIG_TABLE_COLUMNS.items():
        try:
            values = client.walk(oid, limit=2048)
        except Exception:
            continue
        for value in values:
            suffix = _oid_suffix(value.oid, oid)
            if suffix:
                rows.setdefault(suffix, {"config_index": ".".join(str(part) for part in suffix)})[field] = _snmp_field_value(field, value)
    return [rows[key] for key in sorted(rows)]


def _zonedirector_snmp_radio_clients(client: SnmpClient) -> dict[str, dict[str, int]]:
    rows: dict[tuple[int, ...], dict[str, Any]] = {}
    for field, oid in ZD_AP_RADIO_TABLE_COLUMNS.items():
        try:
            values = client.walk(oid, limit=2048)
        except Exception:
            continue
        for value in values:
            suffix = _oid_suffix(value.oid, oid)
            if suffix:
                rows.setdefault(suffix, {})[field] = _snmp_field_value(field, value)

    totals: dict[str, dict[str, int]] = {}
    for suffix, row in rows.items():
        mac = _radio_ap_mac_from_suffix(suffix)
        if not mac:
            continue
        band = _zonedirector_radio_band(row.get("radio_type"), row.get("channel"))
        clients = _int_value(row.get("clients"))
        bucket = totals.setdefault(mac, {"2.4": 0, "5": 0, "unknown": 0})
        bucket[band] += clients
    return totals


def _radio_ap_mac_from_suffix(suffix: tuple[int, ...]) -> str:
    if len(suffix) < 6:
        return ""
    parts = suffix[-7:-1] if len(suffix) >= 7 else suffix[-6:]
    if len(parts) == 6 and all(0 <= part <= 255 for part in parts):
        return ":".join(f"{part:02x}" for part in parts)
    return _mac_from_oid_suffix(suffix)


def _zonedirector_radio_band(radio_type: Any, channel: Any) -> str:
    channel_value = _int_value(channel)
    if 1 <= channel_value <= 14:
        return "2.4"
    if channel_value >= 36:
        return "5"
    radio_type_value = _int_value(radio_type)
    if radio_type_value in {0, 7}:
        return "2.4"
    if radio_type_value in {1, 3, 4, 6}:
        return "5"
    return "unknown"


def _merge_zonedirector_ap_config(aps: list[dict[str, Any]], config_rows: list[dict[str, Any]], overwrite_name: bool = True) -> None:
    if not aps or not config_rows:
        return

    by_mac = {str(row.get("mac_address") or "").lower(): row for row in config_rows if row.get("mac_address")}
    by_ip = {str(row.get("management_ip") or ""): row for row in config_rows if row.get("management_ip")}
    by_index = {str(row.get("config_index") or ""): row for row in config_rows if row.get("config_index")}
    allow_order_fallback = _can_use_ordered_zonedirector_config_names(aps, config_rows)
    for index, ap in enumerate(aps, start=1):
        config = (
            by_mac.get(str(ap.get("mac_address") or "").lower())
            or by_ip.get(str(ap.get("management_ip") or ""))
            or by_index.get(str(index))
        )
        if not config and allow_order_fallback and index <= len(config_rows):
            config = config_rows[index - 1]
        if not config:
            continue
        name = str(config.get("device_name") or "").strip()
        current_name = str(ap.get("name") or "").strip()
        if overwrite_name and name and not _looks_like_mac(name) and _should_use_zonedirector_config_name(current_name, ap):
            _remember_ap_name_for_payload(config, name)
            _remember_ap_name_for_payload(ap, name)
            _set_ap_device_name(ap, name)
        for target, source in (
            ("location", "location"),
            ("description", "description"),
            ("model", "model"),
            ("management_ip", "management_ip"),
            ("mac_address", "mac_address"),
        ):
            value = config.get(source)
            if value and not ap.get(target):
                ap[target] = value
        if config.get("config_index"):
            ap["zd_config_index"] = config["config_index"]


def _can_use_ordered_zonedirector_config_names(aps: list[dict[str, Any]], config_rows: list[dict[str, Any]]) -> bool:
    if not aps or len(config_rows) < len(aps):
        return False
    named_rows = [row for row in config_rows if _valid_zonedirector_config_name(row.get("device_name"), row)]
    if len(named_rows) < len(aps):
        return False
    matched = 0
    for ap in aps:
        ap_mac = str(ap.get("mac_address") or "").lower()
        ap_ip = str(ap.get("management_ip") or "")
        if ap_mac and any(ap_mac == str(row.get("mac_address") or "").lower() for row in config_rows):
            matched += 1
            continue
        if ap_ip and any(ap_ip == str(row.get("management_ip") or "") for row in config_rows):
            matched += 1
    return matched < max(3, len(aps) // 4)


def _valid_zonedirector_config_name(name: Any, row: dict[str, Any] | None = None) -> bool:
    text = str(name or "").strip()
    return bool(text and not _looks_like_mac(text) and not _is_generated_ap_name(text, row or {}))


def _remember_resolved_ap_names(db: Session, aps: list[dict[str, Any]]) -> None:
    if not aps:
        return
    names = _load_persisted_ap_name_map(db)
    changed = False
    now = datetime.now(timezone.utc)
    for ap in aps:
        name = str(ap.get("name") or ap.get("ap_name") or "").strip()
        if not _valid_zonedirector_config_name(name, ap):
            continue
        for key in _ap_name_cache_keys(ap):
            if names.get(key) != name:
                names[key] = name
                changed = True
            AP_NAME_CACHE[key] = (name, now)
    if changed:
        _save_persisted_ap_name_map(db, names)


def _should_use_zonedirector_config_name(current_name: str, ap: dict[str, Any]) -> bool:
    if not current_name:
        return True
    if _needs_display_name_replacement(current_name, ap):
        return True
    if _is_generated_ap_name(current_name, ap):
        return True
    return _looks_like_mac(current_name)


def _is_generated_ap_name(name: str, ap: dict[str, Any] | None = None) -> bool:
    text = str(name or "").strip()
    if not text:
        return True
    lowered = text.lower()
    ap = ap or {}
    serial = str(ap.get("serial_number") or "").strip()
    if serial and lowered == f"ap {serial}".lower():
        return True
    if lowered == "unnamed ap":
        return True
    if lowered.startswith("ruckus ap "):
        return True
    if re.fullmatch(r"ap\s+\d{6,}", text, flags=re.IGNORECASE):
        return True
    model = str(ap.get("model") or "").strip()
    if model and re.fullmatch(rf"{re.escape(model)} AP \d+", text, flags=re.IGNORECASE):
        return True
    return _looks_like_mac(text)


def _matching_zonedirector_ap_config(client: SnmpClient, ap: dict[str, Any]) -> dict[str, Any] | None:
    config_rows = _zonedirector_snmp_ap_config(client)
    by_mac = {str(row.get("mac_address") or "").lower(): row for row in config_rows if row.get("mac_address")}
    by_ip = {str(row.get("management_ip") or ""): row for row in config_rows if row.get("management_ip")}
    by_index = {str(row.get("config_index") or ""): row for row in config_rows if row.get("config_index")}
    return (
        by_mac.get(str(ap.get("mac_address") or "").lower())
        or by_ip.get(str(ap.get("management_ip") or ""))
        or by_index.get(str(ap.get("zd_config_index") or ""))
    )


def _collect_ap_snmp_detail(ap: dict[str, Any], community: str, source_label: str) -> dict[str, Any]:
    ip = str(ap.get("management_ip") or "").strip()
    detail: dict[str, Any] = {
        "reachable": False,
        "source": source_label,
        "system": {},
        "interfaces": [],
        "ip_addresses": [],
        "errors": [],
        "collected_at": _now(),
    }
    if not ip:
        detail["errors"].append("AP management IP is missing.")
        return detail
    client = SnmpClient(ip, community, port=161, timeout=1.2, retries=0)
    try:
        sys_descr = client.get(AP_SYSTEM_OIDS["sys_descr"])
    except Exception as exc:
        detail["errors"].append(f"AP SNMP is not reachable on {ip}: {exc}")
        return detail

    detail["reachable"] = True
    detail["system"]["sys_descr"] = _value_to_text(sys_descr)
    for key, oid in AP_SYSTEM_OIDS.items():
        if key == "sys_descr":
            continue
        try:
            value = client.get(oid)
            detail["system"][key] = _snmp_scalar_value(key, value)
        except Exception as exc:
            detail["errors"].append(f"{key} unavailable: {exc}")
    sys_uptime_ticks = _int_value(detail["system"].get("sys_uptime_ticks"))
    if sys_uptime_ticks > 0:
        detail["system"]["sys_uptime"] = _format_timeticks(sys_uptime_ticks)
    hr_uptime_ticks = _int_value(detail["system"].get("hr_system_uptime_ticks"))
    if hr_uptime_ticks > 0:
        detail["system"]["hr_system_uptime"] = _format_timeticks(hr_uptime_ticks)
    detail["interfaces"] = _snmp_interface_table(client)
    detail["ip_addresses"] = _snmp_ip_address_table(client)
    return detail


def _snmp_interface_table(client: SnmpClient) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    errors: list[str] = []
    for field, oid in AP_INTERFACE_TABLE_COLUMNS.items():
        try:
            values = client.walk(oid, limit=128)
        except Exception as exc:
            errors.append(f"{field}: {exc}")
            continue
        for value in values:
            suffix = ".".join(str(part) for part in _oid_suffix(value.oid, oid))
            if not suffix:
                continue
            rows.setdefault(suffix, {"index": suffix})[field] = _snmp_table_value(field, value)
    interfaces = list(rows.values())
    for row in interfaces:
        row["admin_status_label"] = _if_status_label(row.get("admin_status"))
        row["oper_status_label"] = _if_status_label(row.get("oper_status"))
        if row.get("last_change") is not None:
            row["last_change_label"] = _format_timeticks(_int_value(row.get("last_change")))
    return sorted(interfaces, key=lambda item: _int_value(item.get("index")))


def _snmp_ip_address_table(client: SnmpClient) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for field, oid in AP_IP_ADDRESS_TABLE_COLUMNS.items():
        try:
            values = client.walk(oid, limit=64)
        except Exception:
            continue
        for value in values:
            suffix = ".".join(str(part) for part in _oid_suffix(value.oid, oid))
            if not suffix:
                continue
            rows.setdefault(suffix, {})[field] = _snmp_table_value(field, value)
    return sorted(rows.values(), key=lambda item: str(item.get("ip_address") or ""))


def _enrich_ap_names_from_snmp(aps: list[dict[str, Any]], community: str) -> None:
    pending: list[dict[str, Any]] = []
    for ap in aps:
        ip = str(ap.get("management_ip") or "").strip()
        if not _needs_ap_name_lookup(ap):
            continue
        cached = _cached_ap_name_for_payload(ap)
        if cached:
            _set_ap_device_name(ap, cached)
        elif ip:
            pending.append(ap)

    if not pending:
        return

    max_workers = min(16, max(1, len(pending)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_read_ap_sys_name, str(ap.get("management_ip") or "").strip(), community): ap for ap in pending}
        for future in as_completed(futures):
            name = future.result()
            if name:
                ap = futures[future]
                _remember_ap_name_for_payload(ap, name)
                _set_ap_device_name(ap, name)


def _needs_ap_name_lookup(ap: dict[str, Any]) -> bool:
    name = str(ap.get("name") or "").strip()
    return _needs_display_name_replacement(name, ap)


def _needs_display_name_replacement(name: str, ap: dict[str, Any]) -> bool:
    ip = str(ap.get("management_ip") or "").strip()
    serial = str(ap.get("serial_number") or "").strip()
    model = str(ap.get("model") or "").strip()
    if not name:
        return True
    if _is_generated_ap_name(name, ap):
        return True
    return (
        _looks_like_mac(name)
        or name == ip
        or name == f"AP {ip}"
        or bool(serial and name == f"AP {serial}")
        or bool(model and name == f"{model} AP")
        or bool(model and re.fullmatch(rf"{re.escape(model)} AP \d+", name))
        or name.lower() == "unnamed ap"
        or name.lower().startswith("ruckus ap ")
    )


def _read_ap_sys_name(ip: str, community: str) -> str:
    try:
        value = SnmpClient(ip, community, port=161, timeout=1.0, retries=0).get("1.3.6.1.2.1.1.5.0")
        name = _value_to_text(value).strip()
        return name if name and not _looks_like_mac(name) and name != ip else ""
    except Exception:
        return ""


def _cached_ap_name_for_payload(ap: dict[str, Any]) -> str:
    for key in _ap_name_cache_keys(ap):
        cached = AP_NAME_CACHE.get(key)
        if not cached:
            continue
        name, cached_at = cached
        if (datetime.now(timezone.utc) - cached_at).total_seconds() > AP_NAME_CACHE_TTL_SECONDS:
            AP_NAME_CACHE.pop(key, None)
            continue
        return name
    return ""


def _remember_ap_name_for_payload(ap: dict[str, Any], name: str) -> None:
    if not name:
        return
    now = datetime.now(timezone.utc)
    for key in _ap_name_cache_keys(ap):
        AP_NAME_CACHE[key] = (name, now)


def _ap_name_cache_keys(ap: dict[str, Any]) -> list[str]:
    values = {
        "ip": str(ap.get("management_ip") or "").strip(),
        "mac": str(ap.get("mac_address") or "").strip().lower(),
        "serial": str(ap.get("serial_number") or "").strip(),
    }
    return [f"{prefix}:{value}" for prefix, value in values.items() if value]


def _set_ap_device_name(ap: dict[str, Any], name: str) -> None:
    ap["name"] = name
    ap["hostname"] = name
    ap["ap_name"] = name


def _controller_snmp_community(db: Session, controller: dict[str, Any]) -> tuple[str, str]:
    credential_id = controller.get("snmp_credential_id")
    try:
        credential_id = int(credential_id) if credential_id is not None else None
    except (TypeError, ValueError):
        credential_id = None
    if credential_id and credential_id > 0:
        profile = db.query(CredentialProfile).filter(CredentialProfile.id == credential_id).first()
        if profile and profile.credential_type == "snmp_v2c":
            return decrypt_secret(profile.secret_encrypted), f"SNMP profile: {profile.name}"
        return "", f"SNMP profile {credential_id} not found"
    if credential_id == 0:
        row = db.query(AppConfig).filter(AppConfig.key == "snmp_community").first()
        return (row.value if row and row.value else ""), "Global SNMP community"
    community = decrypt_secret(controller.get("password_encrypted")) or str(controller.get("community") or "").strip()
    return community, "Password / Token"


def _collect_ruckus_zonedirector(db: Session, controller: dict[str, Any]) -> dict[str, Any]:
    protocol = str(controller.get("protocol") or "").lower()
    if protocol in {"snmp", "snmp_v2c", "snmpv2c"}:
        return _collect_ruckus_zonedirector_snmp(db, controller)
    if protocol not in {"ssh", "cli"}:
        return {
            "source": "ruckus_zonedirector_cli",
            "access_points": [],
            "controllers": [],
            "note": "Ruckus ZoneDirector collection supports SNMP or SSH. Set Protocol to SNMP on port 161 or SSH on port 22.",
        }
    if paramiko is None:
        return {
            "source": "ruckus_zonedirector_cli",
            "access_points": [],
            "controllers": [],
            "note": "SSH collector unavailable because paramiko is not installed.",
        }

    username = str(controller.get("username") or "").strip()
    password = decrypt_secret(controller.get("password_encrypted"))
    if not username or not password:
        return {
            "source": "ruckus_zonedirector_cli",
            "access_points": [],
            "controllers": [],
            "note": "ZoneDirector SSH username or password is missing.",
        }

    host = str(controller.get("host") or "").strip()
    port = int(controller.get("port") or 22)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            host,
            port=port,
            username=username,
            password=password,
            look_for_keys=False,
            allow_agent=False,
            timeout=8,
            banner_timeout=8,
            auth_timeout=8,
        )
        output = _run_zonedirector_show_command(client, "show ap all", password)
        aps = _parse_zonedirector_ap_all(output)
        return {
            "source": "ruckus_zonedirector_cli",
            "access_points": aps,
            "controllers": [_public_controller(controller)],
            "note": "" if aps else "Connected to ZoneDirector over SSH, but `show ap all` returned no parseable AP records. Confirm the account can run the command and that APs are approved.",
        }
    except Exception as exc:
        return {
            "source": "ruckus_zonedirector_cli",
            "access_points": [],
            "controllers": [],
            "note": f"ZoneDirector SSH collection failed: {exc}",
        }
    finally:
        client.close()


def _run_zonedirector_show_command(client, command: str, password: str = "") -> str:
    channel = client.invoke_shell(width=240, height=2000)
    channel.settimeout(0.0)
    output = _read_ssh_until_idle(channel, idle_seconds=0.8, max_seconds=4.0)
    _send_ssh(channel, command)
    output += _read_ssh_until_prompt(channel, command, max_seconds=18.0)
    if _looks_like_zonedirector_output(output):
        return output

    # Some firmware/accounts require privileged mode for show commands.
    _send_ssh(channel, "enable")
    enable_output = _read_ssh_until_idle(channel, idle_seconds=0.8, max_seconds=4.0)
    if "password" in enable_output.lower() and password:
        _send_ssh(channel, password)
        enable_output += _read_ssh_until_idle(channel, idle_seconds=0.8, max_seconds=4.0)
    _send_ssh(channel, command)
    retry_output = enable_output + _read_ssh_until_prompt(channel, command, max_seconds=18.0)
    return output + retry_output


def _parse_zonedirector_ap_all(output: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, str]] = []
    current: dict[str, str] = {}
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or line.lower().startswith(("ruckus", "$", "show ap all", "ap:", "id:")):
            continue
        if re.match(r"^\d+:\s*$", line):
            if current:
                blocks.append(current)
            current = {}
            continue
        if "=" in line:
            key, value = line.split("=", 1)
            current[_normalize_zd_key(key)] = value.strip()
    if current:
        blocks.append(current)

    aps: list[dict[str, Any]] = []
    seen: set[str] = set()
    for block in blocks:
        mac = _first_value(block, "mac_address", "mac", "ap_mac", "ethernet_mac")
        ip = _first_value(block, "ip_address", "ip", "ipv4_address")
        name = _ap_display_name(
            _first_value(block, "device_name", "name", "ap_name", "description"),
            ip,
            _first_value(block, "serial_number", "serial"),
            _first_value(block, "model", "model_name", "ap_model"),
            len(aps) + 1,
        )
        unique = (mac or ip or name).lower()
        if unique in seen:
            continue
        seen.add(unique)
        aps.append({
            "id": f"zd:{unique}",
            "name": name,
            "hostname": name,
            "management_ip": ip,
            "role": "Access Point",
            "status": _zonedirector_ap_status(block),
            "platform": "Ruckus ZoneDirector",
            "manufacturer": "Ruckus",
            "model": _first_value(block, "model", "model_name", "ap_model"),
            "site": "",
            "location": _first_value(block, "location", "description"),
            "snmp_status": "Controller collected",
            "last_seen_at": _now(),
            "mac_address": mac,
            "serial_number": _first_value(block, "serial_number", "serial"),
            "channel": _first_value(block, "channel"),
            "clients": _first_value(block, "clients", "num_clients", "client_count"),
        })
    return aps


def _read_ssh_until_idle(channel, idle_seconds: float = 0.8, max_seconds: float = 8.0) -> str:
    import time

    deadline = time.time() + max_seconds
    idle_deadline = time.time() + idle_seconds
    chunks: list[str] = []
    while time.time() < deadline:
        if channel.recv_ready():
            text = channel.recv(65535).decode("utf-8", errors="replace")
            chunks.append(text)
            if _needs_more_paging(text):
                _send_ssh_raw(channel, " ")
            idle_deadline = time.time() + idle_seconds
        else:
            if time.time() >= idle_deadline:
                break
            time.sleep(0.1)
    return "".join(chunks)


def _read_ssh_until_prompt(channel, command: str, max_seconds: float = 18.0) -> str:
    import time

    deadline = time.time() + max_seconds
    output: list[str] = []
    while time.time() < deadline:
        if channel.recv_ready():
            text = channel.recv(65535).decode("utf-8", errors="replace")
            output.append(text)
            joined = "".join(output)
            if _needs_more_paging(text):
                _send_ssh_raw(channel, " ")
                continue
            if _command_returned_to_prompt(joined, command):
                break
        else:
            time.sleep(0.1)
    return "".join(output)


def _send_ssh(channel, command: str) -> None:
    channel.send(command + "\n")


def _send_ssh_raw(channel, value: str) -> None:
    channel.send(value)


def _needs_more_paging(text: str) -> bool:
    lowered = text.lower()
    return "--more--" in lowered or "more:" in lowered or "press any key" in lowered


def _command_returned_to_prompt(output: str, command: str) -> bool:
    lines = [line.strip() for line in output.splitlines() if line.strip()]
    if not lines:
        return False
    last = lines[-1]
    if last.endswith(("#", ">")) and command not in last.lower():
        return True
    return bool(re.search(r"(?m)^[A-Za-z0-9_.:@()/-]+(?:\(config[^)]*\))?[#>]\s*$", output))


def _looks_like_zonedirector_output(output: str) -> bool:
    lowered = output.lower()
    return "ap:" in lowered and ("mac address" in lowered or "device name" in lowered or "approved" in lowered)


def _normalize_zd_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def _first_value(values: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = values.get(key)
        if value:
            return value
    return ""


def _oid_suffix(oid: str, base_oid: str) -> tuple[int, ...]:
    oid_parts = _oid_parts(oid)
    base_parts = _oid_parts(base_oid)
    if oid_parts[: len(base_parts)] != base_parts or len(oid_parts) <= len(base_parts):
        return ()
    return oid_parts[len(base_parts):]


def _oid_parts(oid: str) -> tuple[int, ...]:
    return tuple(int(part) for part in oid.strip(".").split(".") if part)


def _snmp_field_value(field: str, value) -> Any:
    if field == "mac_address":
        return _mac_text(value)
    if field == "management_ip":
        return _ip_text(value)
    if isinstance(value.value, int):
        return value.value
    return _clean_zonedirector_text(_as_string(value))


def _clean_zonedirector_text(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    hex_text = re.sub(r"\s+", " ", text).strip()
    if re.fullmatch(r"(?:[0-9A-Fa-f]{2}\s+){2,}[0-9A-Fa-f]{2}", hex_text):
        try:
            return bytes(int(part, 16) for part in hex_text.split()).decode("utf-8").strip("\x00").strip()
        except (ValueError, UnicodeDecodeError):
            return text
    return text


def _snmp_scalar_value(field: str, value) -> Any:
    if value is None:
        return ""
    if field.endswith("_ticks") and isinstance(value.value, int):
        return value.value
    if isinstance(value.value, int):
        return value.value
    return _value_to_text(value)


def _snmp_table_value(field: str, value) -> Any:
    if field == "phys_address":
        return _mac_text(value)
    if field in {"ip_address", "netmask"}:
        return _ip_text(value)
    if isinstance(value.value, int):
        return value.value
    return _value_to_text(value)


def _if_status_label(value: Any) -> str:
    return {
        1: "up",
        2: "down",
        3: "testing",
        4: "unknown",
        5: "dormant",
        6: "notPresent",
        7: "lowerLayerDown",
    }.get(_int_value(value), str(value or "unknown"))


def _format_timeticks(value: int) -> str:
    seconds = max(0, int(value or 0) // 100)
    days, seconds = divmod(seconds, 86400)
    hours, seconds = divmod(seconds, 3600)
    minutes, seconds = divmod(seconds, 60)
    parts = []
    if days:
        parts.append(f"{days}d")
    if hours or parts:
        parts.append(f"{hours}h")
    if minutes or parts:
        parts.append(f"{minutes}m")
    parts.append(f"{seconds}s")
    return " ".join(parts)


def _mac_from_oid_suffix(suffix: tuple[int, ...]) -> str:
    if len(suffix) >= 6 and all(0 <= part <= 255 for part in suffix[-6:]):
        return ":".join(f"{part:02x}" for part in suffix[-6:])
    return ""


def _zonedirector_snmp_status(value: Any) -> str:
    if isinstance(value, int):
        return {
            0: "Not connected",
            1: "Connected",
            2: "Disconnected",
            3: "Approval Pending",
            4: "Upgrading",
            5: "Provisioning",
        }.get(value, str(value))
    text = str(value or "").strip()
    return text or "Discovered"


def _zonedirector_mesh_type(value: Any) -> str:
    if isinstance(value, int):
        return {
            0: "Unknown",
            1: "Root",
            2: "Mesh",
            3: "Forming",
        }.get(value, str(value))
    return str(value or "")


def _zonedirector_client_count(clients: Any, total_users: Any) -> int:
    client_count = _int_value(clients)
    total_count = _int_value(total_users)
    if total_count in {512, 1024} and client_count == 0:
        return 0
    if total_count > 0 and (client_count == 0 or total_count < client_count):
        return total_count
    return client_count


def _zonedirector_memory_percent(memory_value: Any, memory_total: Any) -> int:
    value = _int_value(memory_value)
    total = _int_value(memory_total)
    if value <= 100:
        return value
    if total > 0:
        return max(0, min(100, round((value / total) * 100)))
    return 0


def _format_zonedirector_uptime(value: Any) -> str:
    uptime = _int_value(value)
    if uptime <= 0:
        return ""
    # ZoneDirector AP table firmware commonly reports AP uptime in seconds.
    # Very large values are often SNMP TimeTicks, so format those as centiseconds.
    if uptime > 315360000:
        return _format_timeticks(uptime)
    days, seconds = divmod(uptime, 86400)
    hours, seconds = divmod(seconds, 3600)
    minutes, seconds = divmod(seconds, 60)
    parts = []
    if days:
        parts.append(f"{days}d")
    if hours or parts:
        parts.append(f"{hours}h")
    if minutes or parts:
        parts.append(f"{minutes}m")
    parts.append(f"{seconds}s")
    return " ".join(parts)


def _zonedirector_ap_status(values: dict[str, str]) -> str:
    status = _first_value(values, "status", "connection_status", "state")
    if status:
        return status
    approved = _first_value(values, "approved")
    if approved.lower() in {"yes", "true", "enabled", "approved"}:
        return "Approved"
    if approved:
        return "Pending"
    return "Discovered"


def _is_wireless_ap(device: Device) -> bool:
    text = " ".join(str(value or "") for value in [
        device.name,
        device.hostname,
        device.role,
        device.device_type,
        device.platform,
        device.manufacturer,
        device.model,
        device.tags,
    ]).lower()
    return (
        "access point" in text
        or "wireless" in text
        or "aironet" in text
        or "unifi" in text
        or "aruba" in text
        or "ruckus" in text
        or "zoneflex" in text
        or "wifi" in text
        or "wi-fi" in text
        or "wlan" in text
        or " ap-" in f" {text}"
    ) and not _is_wireless_controller(device)


def _is_wireless_controller(device: Device) -> bool:
    text = " ".join(str(value or "") for value in [device.name, device.role, device.device_type, device.platform, device.tags]).lower()
    return (
        "controller" in text
        or "wlc" in text
        or "zonedirector" in text
        or "zone director" in text
        or "smartzone" in text
        or "ruckus zd" in text
        or text.startswith("zd-")
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _utc_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()
