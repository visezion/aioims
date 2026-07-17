import json
import re
import socket
import struct
import subprocess
import time
from typing import Any
from urllib.parse import urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.secret_store import decrypt_secret
from app.models.app_config import AppConfig
from app.models.audit_log import AuditLog
from app.models.credential_profile import CredentialProfile
from app.models.device import Device
from app.models.site import Site
from app.models.user import User
from app.services.protocols import ProtocolCheckService
from app.services.snmp import SnmpClient, _value_to_text

try:
    import paramiko
except Exception:  # pragma: no cover - optional runtime dependency
    paramiko = None

router = APIRouter()

RESOURCE_NAMES = {"Sites", "Locations", "Rooms", "Components", "Racks", "VLANs", "IP Addresses", "Prefixes", "VRFs"}
RESOURCE_ALIASES = {
    "site": "Sites",
    "location": "Locations",
    "room": "Rooms",
    "component": "Components",
    "components": "Components",
    "rack": "Racks",
    "vlan": "VLANs",
    "vlans": "VLANs",
    "ip address": "IP Addresses",
    "ip addresses": "IP Addresses",
    "ip-address": "IP Addresses",
    "ip-addresses": "IP Addresses",
    "prefix": "Prefixes",
    "vrf": "VRFs",
    "vrfs": "VRFs",
}


class InfrastructureSave(BaseModel):
    records: list[dict[str, Any]] = Field(default_factory=list)


class InfrastructureDelete(BaseModel):
    ids: list[str] = Field(default_factory=list)
    keys: list[str] = Field(default_factory=list)
    records: list[dict[str, Any]] = Field(default_factory=list)


class ComponentTest(BaseModel):
    component: dict[str, Any] = Field(default_factory=dict)


@router.post("/{resource}/test", response_model=dict)
def test_component_source(
    resource: str,
    payload: ComponentTest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _normalize_resource(resource)
    if resource != "Components":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component test is only available for Components")
    result = _test_component(db, payload.component)
    db.add(AuditLog(
        action="test_component_source",
        entity_type="infrastructure",
        entity_id=None,
        details=json.dumps({"user": current_user.email, "component": payload.component.get("name"), "source": payload.component.get("dataSourceType"), "ok": result["ok"]}),
    ))
    db.commit()
    return {"message": "tested", "data": result}


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
    alias = RESOURCE_ALIASES.get(normalized.lower())
    if alias:
        return alias
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


def _test_component(db: Session, component: dict[str, Any]) -> dict[str, Any]:
    source = str(component.get("dataSourceType") or "Manual").strip().lower()
    specs = component.get("specs") if isinstance(component.get("specs"), dict) else {}
    current_value = str(component.get("currentValue") or "").strip()
    unit = str(component.get("unit") or "").strip()
    if source in {"", "manual"}:
        return {
            "ok": True,
            "source": "Manual",
            "value": current_value or None,
            "unit": unit,
            "status": component.get("status") or "Manual",
            "detail": "Manual component test returned the saved value.",
        }
    if source == "xml":
        endpoint = str(component.get("xmlEndpoint") or specs.get("xmlEndpoint") or "").strip()
        match_text = str(component.get("xmlMatchText") or specs.get("xmlMatchText") or "").strip()
        value_path = str(component.get("xmlValuePath") or specs.get("xmlValuePath") or "").strip()
        status_path = str(component.get("xmlStatusPath") or specs.get("xmlStatusPath") or "").strip()
        if not endpoint:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="XML endpoint is required to test this component")
        body = _fetch_text(endpoint)
        try:
            root = ET.fromstring(body)
        except ET.ParseError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"XML parse failed: {exc}") from exc
        context = _xml_find_context_by_text(root, match_text) if match_text else None
        detected_path = value_path or ""
        if context is not None:
            relative_value_path = value_path or "Value"
            value = _xml_path_text(context, relative_value_path)
            detected_path = f"{match_text} -> {relative_value_path}"
            status_value = _xml_path_text(context, status_path) if status_path else (_xml_path_text(context, "State") or _xml_auto_status(context))
        elif value_path:
            value = _xml_path_text(root, value_path)
            status_value = _xml_path_text(root, status_path) if status_path else _xml_auto_status(root)
        else:
            detected_path, value = _xml_auto_value(root, component, specs)
            status_value = _xml_path_text(root, status_path) if status_path else _xml_auto_status(root)
        scaled_value = _scale_value(value, specs.get("xmlScale"))
        if match_text and context is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"XML match text was not found: {match_text}")
        if value_path and value in (None, ""):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"XML value path did not match: {value_path}")
        if value in (None, ""):
            return {
                "ok": False,
                "source": "XML",
                "value": None,
                "raw_value": value or "",
                "unit": unit,
                "status": status_value or "No value",
                "detail": "Fetched XML endpoint, but no XML value path was configured and no readable value was auto-detected. Set XML value path, for example /response/sensor/value or //value.",
                "suggested_paths": _xml_suggest_paths(root),
            }
        return {
            "ok": True,
            "source": "XML",
            "value": scaled_value if scaled_value is not None else value,
            "raw_value": value,
            "unit": unit,
            "status": status_value or component.get("status") or "Read",
            "detail": f"Fetched XML endpoint and parsed {detected_path or 'auto-detected XML value'}.",
            "detected_path": detected_path,
        }
    if source == "rest api":
        endpoint = str(specs.get("restEndpoint") or "").strip()
        value_path = str(specs.get("restValuePath") or "").strip()
        status_path = str(specs.get("restStatusPath") or "").strip()
        if not endpoint:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="REST endpoint is required to test this component")
        body = _fetch_text(endpoint)
        data = json.loads(body)
        detected_path = value_path
        if value_path:
            value = _json_path_value(data, value_path)
        else:
            detected_path, value = _json_auto_value(data, component, specs)
        status_value = _json_path_value(data, status_path) if status_path else _json_auto_status(data)
        if value_path and value in (None, ""):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"REST value path did not match: {value_path}")
        if value in (None, ""):
            return {
                "ok": False,
                "source": "REST API",
                "value": None,
                "unit": unit,
                "status": status_value or "No value",
                "detail": "Fetched REST endpoint, but no JSON value path was configured and no readable value was auto-detected. Set a JSON value path such as data.sensors[0].value.",
                "suggested_paths": _json_suggest_paths(data),
            }
        return {
            "ok": True,
            "source": "REST API",
            "value": value,
            "unit": unit,
            "status": status_value or component.get("status") or "Read",
            "detail": f"Fetched REST endpoint and parsed {detected_path or 'auto-detected JSON value'}.",
            "detected_path": detected_path,
        }
    if source == "snmp":
        return _test_component_snmp(db, component, specs, unit)
    if source == "ssh":
        return _test_component_ssh(db, component, specs, unit)
    if source == "icmp":
        return _test_component_icmp(component, specs, unit)
    if source == "modbus tcp":
        return _test_component_modbus(component, specs, unit)
    if source == "bacnet":
        return _test_component_bacnet(component, specs, unit)
    if source == "mqtt":
        return _test_component_mqtt(component, specs, unit)
    if source == "prometheus text":
        return _test_component_prometheus_text(component, specs, unit)
    if source == "webhook":
        return _test_component_webhook(component, specs, unit)
    return {
        "ok": False,
        "source": component.get("dataSourceType") or "Unknown",
        "value": current_value or None,
        "unit": unit,
        "status": component.get("status") or "Not tested",
        "detail": "Unknown component source. Choose one of Manual, SNMP, REST API, XML, Prometheus Text, Modbus TCP, BACnet, MQTT, SSH, ICMP, or Webhook.",
    }


def _test_component_snmp(db: Session, component: dict[str, Any], specs: dict[str, Any], unit: str) -> dict[str, Any]:
    host = _first_text(specs, "snmpHost", "host", "ipAddress") or _first_text(component, "ipAddress", "hostname")
    oid = _first_text(specs, "snmpValueOid", "valueOid", "oid")
    status_oid = _first_text(specs, "snmpStatusOid", "statusOid")
    community, port, credential_name = _snmp_component_credentials(db, specs)
    if not host:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="SNMP host/IP is required")
    if not oid:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="SNMP value OID is required")
    if not community:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="SNMP community is required. Set global SNMP community or a SNMP credential profile.")
    client = SnmpClient(host, community, port=port, timeout=_float(specs.get("timeout"), 1.5))
    value = _value_to_text(client.get(oid))
    status_value = _value_to_text(client.get(status_oid)) if status_oid else ""
    scaled_value = _scale_value(value, specs.get("snmpScale"))
    return {
        "ok": True,
        "source": "SNMP",
        "value": scaled_value if scaled_value is not None else value,
        "raw_value": value,
        "unit": unit,
        "status": status_value or "Read",
        "detail": f"SNMP value OID {oid} read from {host}:{port}.",
        "credential": credential_name,
    }


def _test_component_ssh(db: Session, component: dict[str, Any], specs: dict[str, Any], unit: str) -> dict[str, Any]:
    host = _first_text(specs, "sshHost", "host") or _first_text(component, "ipAddress", "hostname")
    command = _first_text(specs, "sshCommand") or "echo AIMS_COMPONENT_TEST"
    parser = _first_text(specs, "sshParser")
    profile_name = _first_text(specs, "sshCredential", "credential")
    if not host:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="SSH host is required")
    if paramiko is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="SSH test unavailable because paramiko is not installed")
    profile = _credential_by_name(db, profile_name, "ssh")
    if not profile or not profile.username or not profile.secret_encrypted:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="SSH credential profile with username/password is required")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            hostname=host,
            port=profile.port or 22,
            username=profile.username,
            password=decrypt_secret(profile.secret_encrypted),
            look_for_keys=False,
            allow_agent=False,
            timeout=_float(specs.get("timeout"), 8),
            banner_timeout=_float(specs.get("timeout"), 8),
            auth_timeout=_float(specs.get("timeout"), 8),
        )
        _, stdout, stderr = client.exec_command(command, timeout=_float(specs.get("timeout"), 8))
        output = stdout.read().decode("utf-8", errors="replace")
        error = stderr.read().decode("utf-8", errors="replace")
    finally:
        client.close()
    parsed = _regex_first(output, parser) if parser else output.strip().splitlines()[0] if output.strip() else ""
    return {
        "ok": True,
        "source": "SSH",
        "value": parsed or None,
        "unit": unit,
        "status": "Read" if parsed or output else "Connected",
        "detail": f"SSH command ran on {host}.",
        "raw_output": (output or error)[:4000],
        "credential": profile.name,
    }


def _test_component_icmp(component: dict[str, Any], specs: dict[str, Any], unit: str) -> dict[str, Any]:
    host = _first_text(specs, "icmpHost", "host") or _first_text(component, "ipAddress", "hostname")
    if not host:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="ICMP host/IP is required")
    result = ProtocolCheckService(timeout=_duration_seconds(specs.get("icmpTimeout"), 1.5)).check(host, "icmp").to_dict()
    return {
        "ok": result["status"] == "up",
        "source": "ICMP",
        "value": result["latency_ms"],
        "unit": unit or "ms",
        "status": result["status"],
        "detail": result["detail"],
        "protocol": result,
    }


def _test_component_modbus(component: dict[str, Any], specs: dict[str, Any], unit: str) -> dict[str, Any]:
    host = _first_text(specs, "modbusHost", "host")
    port = _int(specs.get("modbusPort"), 502)
    register = _int(specs.get("modbusRegister"), 0)
    unit_id = _int(specs.get("modbusUnitId"), 1)
    function_code = 4 if "4" in str(specs.get("modbusFunction") or "") else 3
    if not host:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Modbus TCP host/gateway is required")
    with socket.create_connection((host, port), timeout=_float(specs.get("timeout"), 3)) as sock:
        sock.settimeout(_float(specs.get("timeout"), 3))
        if register <= 0:
            return {"ok": True, "source": "Modbus TCP", "value": None, "unit": unit, "status": "Reachable", "detail": f"TCP {host}:{port} is reachable. Configure a register to read a value."}
        address = register - 40001 if register >= 40001 else register
        transaction_id = int(time.time() * 1000) % 65535
        pdu = struct.pack(">BHH", function_code, max(0, address), 1)
        packet = struct.pack(">HHHB", transaction_id, 0, len(pdu) + 1, unit_id) + pdu
        sock.sendall(packet)
        response = sock.recv(260)
    if len(response) < 11:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Modbus response was too short")
    byte_count = response[8]
    raw_value = response[9:9 + byte_count]
    data_type = str(specs.get("modbusDataType") or "").strip().lower()
    value = int.from_bytes(raw_value[:2] or b"\x00\x00", "big", signed=data_type.startswith("int"))
    return {"ok": True, "source": "Modbus TCP", "value": value, "unit": unit, "status": "Read", "detail": f"Read register {register} from {host}:{port}.", "raw_hex": raw_value.hex()}


def _test_component_bacnet(component: dict[str, Any], specs: dict[str, Any], unit: str) -> dict[str, Any]:
    host = _first_text(specs, "bacnetHost", "host", "bacnetNetwork")
    port = _int(specs.get("bacnetPort"), 47808)
    if not host:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="BACnet host/IP is required for test")
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.settimeout(_float(specs.get("timeout"), 2))
        sock.sendto(b"\x81\x0b\x00\x0c\x01\x20\xff\xff\x00\xff\x10\x08", (host, port))
        try:
            data, _ = sock.recvfrom(1024)
            return {"ok": True, "source": "BACnet", "value": len(data), "unit": unit or "bytes", "status": "Responded", "detail": f"BACnet device responded on UDP/{port}.", "raw_hex": data[:80].hex()}
        except socket.timeout:
            return {"ok": False, "source": "BACnet", "value": None, "unit": unit, "status": "No response", "detail": f"No BACnet response from {host}:{port}. Check UDP routing/firewall and device ID."}


def _test_component_mqtt(component: dict[str, Any], specs: dict[str, Any], unit: str) -> dict[str, Any]:
    broker = _first_text(specs, "mqttBroker", "broker")
    topic = _first_text(specs, "mqttTopic", "topic")
    if not broker:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="MQTT broker URL is required")
    parsed = urlparse(broker if "://" in broker else f"mqtt://{broker}")
    host = parsed.hostname
    port = parsed.port or (8883 if parsed.scheme == "mqtts" else 1883)
    if not host:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="MQTT broker host is invalid")
    with socket.create_connection((host, port), timeout=_float(specs.get("timeout"), 3)):
        pass
    return {"ok": True, "source": "MQTT", "value": topic or None, "unit": unit, "status": "Broker reachable", "detail": f"MQTT broker {host}:{port} is reachable. Topic parsing requires a running subscriber/poller."}


def _test_component_prometheus_text(component: dict[str, Any], specs: dict[str, Any], unit: str) -> dict[str, Any]:
    endpoint = _first_text(specs, "prometheusEndpoint", "metricsEndpoint")
    metric = _first_text(specs, "prometheusMetric", "metric")
    selector = _first_text(specs, "prometheusLabelSelector", "labelSelector")
    if not endpoint:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Prometheus metrics endpoint is required")
    if not metric:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Prometheus metric name is required")
    body = _fetch_text(endpoint)
    expected_labels = _parse_prometheus_labels(selector)
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        match = re.match(r"^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)", line)
        if not match:
            continue
        name, label_text, raw_value = match.groups()
        if name != metric:
            continue
        labels = _parse_prometheus_labels(label_text or "")
        if any(labels.get(key) != value for key, value in expected_labels.items()):
            continue
        scaled_value = _scale_value(raw_value, specs.get("prometheusScale"))
        return {
            "ok": True,
            "source": "Prometheus Text",
            "value": scaled_value if scaled_value is not None else raw_value,
            "raw_value": raw_value,
            "unit": unit,
            "status": component.get("status") or "Read",
            "detail": f"Read {metric}{' {' + selector + '}' if selector else ''} from Prometheus text metrics.",
            "labels": labels,
        }
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Prometheus metric was not found: {metric}{' {' + selector + '}' if selector else ''}")


def _test_component_webhook(component: dict[str, Any], specs: dict[str, Any], unit: str) -> dict[str, Any]:
    webhook_url = _first_text(specs, "webhookUrl")
    secret = _first_text(specs, "webhookSecret")
    if not webhook_url:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Webhook URL is required")
    return {
        "ok": True,
        "source": "Webhook",
        "value": component.get("currentValue") or None,
        "unit": unit,
        "status": "Configured",
        "detail": f"Webhook endpoint is configured. {'Shared secret configured.' if secret else 'No shared secret configured.'} Incoming webhook receiver can update this component value.",
        "webhook_url": webhook_url,
    }


def _snmp_component_credentials(db: Session, specs: dict[str, Any]) -> tuple[str, int, str]:
    profile_name = _first_text(specs, "snmpProfile", "credential")
    profile = _credential_by_name(db, profile_name, "snmp_v2c")
    if profile:
        return decrypt_secret(profile.secret_encrypted), profile.port or 161, profile.name
    row = _get_config(db, "snmp_community")
    return (row.value if row else ""), _int(specs.get("snmpPort"), 161), "Global SNMP community"


def _credential_by_name(db: Session, name: str, credential_type: str) -> CredentialProfile | None:
    query = db.query(CredentialProfile).filter(CredentialProfile.credential_type == credential_type)
    if name:
        return query.filter(CredentialProfile.name == name).first()
    return query.order_by(CredentialProfile.name.asc()).first()


def _first_text(source: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = source.get(key)
        if value not in (None, ""):
            return str(value).strip()
    return ""


def _int(value: Any, default: int) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def _float(value: Any, default: float) -> float:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return default


def _duration_seconds(value: Any, default: float) -> float:
    text = str(value or "").strip().lower()
    if not text:
        return default
    try:
        if text.endswith("ms"):
            return max(0.2, float(text[:-2]) / 1000)
        if text.endswith("s"):
            return max(0.2, float(text[:-1]))
        return max(0.2, float(text))
    except ValueError:
        return default


def _regex_first(output: str, pattern: str) -> str:
    try:
        match = re.search(pattern, output, flags=re.MULTILINE)
    except re.error:
        return ""
    if not match:
        return ""
    if match.groups():
        return next((group for group in match.groups() if group is not None), "")
    return match.group(0)


def _fetch_text(url: str) -> str:
    if not re.match(r"^https?://", url, re.IGNORECASE):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Only http:// and https:// component test endpoints are supported")
    request = Request(url, headers={"User-Agent": "AIMS component tester"})
    try:
        with urlopen(request, timeout=8) as response:
            raw = response.read(1_000_000)
            return raw.decode(response.headers.get_content_charset() or "utf-8", errors="replace")
    except HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Component endpoint returned HTTP {exc.code}") from exc
    except URLError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Unable to reach component endpoint: {exc.reason}") from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Component endpoint timed out") from exc


def _xml_path_text(root: ET.Element, path: str) -> str | None:
    cleaned = path.strip()
    if not cleaned:
        return None
    if cleaned.startswith("@"):
        return (root.attrib.get(cleaned[1:]) or "").strip()
    if "/@" in cleaned:
        node_path, attribute = cleaned.rsplit("/@", 1)
        node = _xml_find_path(root, node_path)
        return (node.attrib.get(attribute) or "").strip() if node is not None else None
    node = _xml_find_path(root, cleaned)
    if node is None:
        return None
    return (node.text or "").strip()


def _xml_find_context_by_text(root: ET.Element, match_text: str) -> ET.Element | None:
    needle = match_text.strip().lower()
    if not needle:
        return None

    def visit(node: ET.Element) -> ET.Element | None:
        for child in list(node):
            child_text = (child.text or "").strip().lower()
            if child_text == needle or needle in child_text:
                return node
            found = visit(child)
            if found is not None:
                return found
        return None

    return visit(root)


def _xml_auto_value(root: ET.Element, component: dict[str, Any], specs: dict[str, Any]) -> tuple[str, str | None]:
    hint_words = _component_hint_words(component, specs) + [word for word in re.split(r"[^a-z0-9]+", str(specs.get("xmlNamespace") or "").lower()) if len(word) > 2]
    preferred_tags = {
        "value",
        "reading",
        "presentvalue",
        "actualvalue",
        "measuredvalue",
        "temperature",
        "temp",
        "humidity",
        "hum",
        "power",
        "watts",
        "watt",
        "voltage",
        "volt",
        "current",
        "amps",
        "amp",
        "load",
        "capacity",
        "state",
        "status",
    }
    candidates: list[tuple[int, str, str]] = []

    def score_candidate(path: str, value: str) -> int:
        clean_value = value.strip()
        if not clean_value:
            return -100
        lowered_path = path.lower()
        tag = lowered_path.rsplit("/", 1)[-1].lstrip("@")
        score = 0
        if re.fullmatch(r"[-+]?\d+(?:\.\d+)?", clean_value):
            score += 80
        elif re.search(r"[-+]?\d+(?:\.\d+)?", clean_value):
            score += 45
        if tag in preferred_tags:
            score += 30
        if any(word and word in lowered_path for word in hint_words):
            score += 25
        if any(keyword in lowered_path for keyword in ("temp", "hum", "power", "watt", "volt", "amp", "load", "reading", "value")):
            score += 15
        if tag in {"unit", "name", "id", "model", "serial", "description"}:
            score -= 35
        if clean_value.lower() in {"ok", "normal", "healthy", "up", "down", "online", "offline", "true", "false"}:
            score -= 20
        return score

    def visit(node: ET.Element, path: str) -> None:
        children = list(node)
        text = (node.text or "").strip()
        if text and not children:
            candidates.append((score_candidate(path, text), path, text))
        for attribute, attribute_value in node.attrib.items():
            text_value = str(attribute_value or "").strip()
            if text_value:
                attribute_path = f"{path}/@{attribute}"
                candidates.append((score_candidate(attribute_path, text_value), attribute_path, text_value))
        for child in children:
            visit(child, f"{path}/{_strip_namespace(child.tag)}")

    visit(root, f"/{_strip_namespace(root.tag)}")
    if not candidates:
        return "", None
    candidates.sort(key=lambda item: item[0], reverse=True)
    best = candidates[0]
    return best[1], best[2]


def _xml_auto_status(root: ET.Element) -> str | None:
    for path in ("//status", "//state", "//health", "//alarm"):
        value = _xml_path_text(root, path)
        if value not in (None, ""):
            return value
    return None


def _xml_suggest_paths(root: ET.Element) -> list[str]:
    paths: list[str] = []

    def visit(node: ET.Element, path: str) -> None:
        children = list(node)
        text = (node.text or "").strip()
        if text and not children:
            paths.append(path)
        for attribute, attribute_value in node.attrib.items():
            if str(attribute_value or "").strip():
                paths.append(f"{path}/@{attribute}")
        for child in children[:20]:
            visit(child, f"{path}/{_strip_namespace(child.tag)}")

    visit(root, f"/{_strip_namespace(root.tag)}")
    return paths[:20]


def _xml_find_path(root: ET.Element, path: str) -> ET.Element | None:
    cleaned = path.strip()
    if cleaned in {"", ".", "/"}:
        return root
    deep_search = cleaned.startswith("//")
    parts = [part for part in cleaned.strip("/").split("/") if part]
    if parts and _strip_namespace(root.tag).lower() == _xml_part_name(parts[0]).lower():
        parts = parts[1:]
    candidates = list(root.iter()) if deep_search and parts else [root]
    for start in candidates:
        node = start
        matched = True
        for part in parts:
            name, attribute_name, attribute_value = _xml_part_selector(part)
            found = None
            for child in list(node):
                if _strip_namespace(child.tag).lower() != name.lower():
                    continue
                if attribute_name and str(child.attrib.get(attribute_name, "")) != attribute_value:
                    continue
                found = child
                break
            if found is None:
                matched = False
                break
            node = found
        if matched:
            return node
    return None


def _xml_part_name(part: str) -> str:
    return part.split("[", 1)[0]


def _xml_part_selector(part: str) -> tuple[str, str, str]:
    name = _xml_part_name(part)
    match = re.search(r"\[@([^=\]]+)=['\"]?([^'\"]+)['\"]?\]", part)
    if not match:
        return name, "", ""
    return name, match.group(1), match.group(2)


def _strip_namespace(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _json_path_value(data: Any, path: str) -> Any:
    current = data
    if not path:
        return current
    for part in re.findall(r"[^.\[\]]+|\[\d+\]", path):
        try:
            if part.startswith("["):
                index = int(part.strip("[]"))
                current = current[index]
            elif isinstance(current, dict):
                current = current.get(part)
            else:
                return None
        except (IndexError, KeyError, TypeError, ValueError):
            return None
    return current


def _parse_prometheus_labels(label_text: str) -> dict[str, str]:
    labels: dict[str, str] = {}
    for match in re.finditer(r'([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"((?:\\.|[^"])*)"', label_text or ""):
        labels[match.group(1)] = match.group(2).replace(r"\"", '"').replace(r"\\", "\\")
    return labels


def _json_auto_value(data: Any, component: dict[str, Any], specs: dict[str, Any]) -> tuple[str, Any]:
    hints = _component_hint_words(component, specs)
    candidates: list[tuple[int, str, Any]] = []

    def visit(value: Any, path: str) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                visit(child, f"{path}.{key}" if path else str(key))
            return
        if isinstance(value, list):
            for index, child in enumerate(value[:50]):
                visit(child, f"{path}[{index}]" if path else f"[{index}]")
            return
        if value in (None, ""):
            return
        candidates.append((_score_component_value(path, str(value), hints), path, value))

    visit(data, "")
    if not candidates:
        return "", None
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1], candidates[0][2]


def _json_auto_status(data: Any) -> Any:
    for path in ("status", "state", "health", "data.status", "data.state", "data.health", "result.status", "sensor.status"):
        value = _json_path_value(data, path)
        if value not in (None, ""):
            return value
    return None


def _json_suggest_paths(data: Any) -> list[str]:
    paths: list[str] = []

    def visit(value: Any, path: str) -> None:
        if len(paths) >= 30:
            return
        if isinstance(value, dict):
            for key, child in value.items():
                visit(child, f"{path}.{key}" if path else str(key))
            return
        if isinstance(value, list):
            for index, child in enumerate(value[:10]):
                visit(child, f"{path}[{index}]" if path else f"[{index}]")
            return
        if value not in (None, ""):
            paths.append(path)

    visit(data, "")
    return paths


def _component_hint_words(component: dict[str, Any], specs: dict[str, Any]) -> list[str]:
    hints = " ".join(
        str(value or "")
        for value in (
            component.get("name"),
            component.get("type"),
            component.get("category"),
            component.get("unit"),
            component.get("dataSourceType"),
            component.get("dataSourceDetail"),
            specs.get("manufacturer"),
            specs.get("model"),
            specs.get("vendorPreset"),
            specs.get("vendorProductLine"),
            specs.get("vendorMetric"),
            specs.get("thresholdMetric"),
        )
    ).lower()
    return [word for word in re.split(r"[^a-z0-9]+", hints) if len(word) > 2]


def _score_component_value(path: str, value: str, hints: list[str]) -> int:
    clean_value = value.strip()
    if not clean_value:
        return -100
    lowered_path = path.lower()
    tag = lowered_path.rsplit(".", 1)[-1].rsplit("/", 1)[-1].lstrip("@")
    preferred_tags = {
        "value",
        "reading",
        "presentvalue",
        "actualvalue",
        "measuredvalue",
        "temperature",
        "temp",
        "humidity",
        "hum",
        "power",
        "watts",
        "watt",
        "voltage",
        "volt",
        "current",
        "amps",
        "amp",
        "load",
        "capacity",
        "runtime",
        "battery",
        "state",
        "status",
    }
    score = 0
    if re.fullmatch(r"[-+]?\d+(?:\.\d+)?", clean_value):
        score += 80
    elif re.search(r"[-+]?\d+(?:\.\d+)?", clean_value):
        score += 45
    if tag in preferred_tags:
        score += 30
    if any(word and word in lowered_path for word in hints):
        score += 25
    if any(keyword in lowered_path for keyword in preferred_tags):
        score += 15
    if tag in {"unit", "name", "id", "model", "serial", "description", "vendor", "manufacturer"}:
        score -= 35
    if clean_value.lower() in {"ok", "normal", "healthy", "up", "down", "online", "offline", "true", "false"}:
        score -= 20
    return score


def _scale_value(value: Any, scale: Any) -> float | None:
    try:
        number = float(str(value).strip())
        multiplier = float(str(scale or "1").strip())
        return number * multiplier
    except (TypeError, ValueError):
        return None
