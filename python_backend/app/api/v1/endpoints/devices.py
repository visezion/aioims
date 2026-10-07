import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.core.secret_store import decrypt_secret
from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.models.app_config import AppConfig
from app.models.alert import Alert
from app.models.audit_log import AuditLog
from app.models.credential_profile import CredentialProfile
from app.models.device import Device
from app.models.device_config_backup import DeviceConfigBackup
from app.models.device_link import DeviceLink
from app.models.site import Site
from app.models.user import User
from app.schemas.device import DeviceBulkDelete, DeviceBulkUpdate, DeviceCreate, DeviceUpdate
from app.services.config_backup import create_config_backup, list_config_backups, restore_config_backup, serialize_config_backup
from app.services.config_parsing import infer_platform_from_configuration, merge_configuration_inventory
from app.services.config_collection import SshConfigurationCollector
from app.services.jobs import complete_job, fail_job, start_job, update_job_progress
from app.services.protocols import ProtocolCheckService
from app.services.snmp import SnmpClient, SnmpTimeout, _as_string, _oid_tuple

router = APIRouter()
MANUAL_STATUSES = {"Maintenance", "Planned", "Staging", "Decommissioned", "Retired"}
NULLABLE_UPDATE_FIELDS = {"site_id", "position", "power_consumption_w", "snmp_credential_id", "ssh_credential_id"}
BULK_EDIT_FIELDS = {
    "role",
    "status",
    "device_type",
    "platform",
    "manufacturer",
    "model",
    "description",
    "tags",
    "site_id",
    "vlan",
    "connection",
    "location",
    "room",
    "rack",
    "position",
    "rack_units",
    "power_consumption_w",
    "owner",
    "tenant",
    "comments",
    "snmp_credential_id",
    "ssh_credential_id",
}


class DeviceTerminalRequest(BaseModel):
    command: str = ""
    commands: list[str] = Field(default_factory=list)
    enable: bool = True


class DeviceConfigBackupRunRequest(BaseModel):
    device_ids: list[int] = Field(default_factory=list)
    scope: str = "active_with_ssh"
    timeout: float = Field(default=8.0, ge=0.2, le=30.0)


ENTITY_SENSOR_TYPE = "1.3.6.1.2.1.99.1.1.1.1"
ENTITY_SENSOR_TYPE_OID = f"{ENTITY_SENSOR_TYPE}.1"
ENTITY_SENSOR_SCALE_OID = f"{ENTITY_SENSOR_TYPE}.2"
ENTITY_SENSOR_PRECISION_OID = f"{ENTITY_SENSOR_TYPE}.3"
ENTITY_SENSOR_VALUE_OID = f"{ENTITY_SENSOR_TYPE}.4"
ENTITY_SENSOR_OPER_STATUS_OID = f"{ENTITY_SENSOR_TYPE}.5"
ENTITY_SENSOR_UNITS_OID = f"{ENTITY_SENSOR_TYPE}.6"
ENTITY_PHYSICAL_DESCR_OID = "1.3.6.1.2.1.47.1.1.1.1.2"
ENTITY_PHYSICAL_NAME_OID = "1.3.6.1.2.1.47.1.1.1.1.7"
CISCO_TEMPERATURE_DESCR_OID = "1.3.6.1.4.1.9.9.13.1.3.1.2"
CISCO_TEMPERATURE_VALUE_OID = "1.3.6.1.4.1.9.9.13.1.3.1.3"
CISCO_TEMPERATURE_THRESHOLD_OID = "1.3.6.1.4.1.9.9.13.1.3.1.4"
CISCO_TEMPERATURE_LAST_SHUTDOWN_OID = "1.3.6.1.4.1.9.9.13.1.3.1.5"
CISCO_TEMPERATURE_STATE_OID = "1.3.6.1.4.1.9.9.13.1.3.1.6"
CISCO_FAN_DESCR_OID = "1.3.6.1.4.1.9.9.13.1.4.1.2"
CISCO_FAN_STATE_OID = "1.3.6.1.4.1.9.9.13.1.4.1.3"
CISCO_POWER_SUPPLY_DESCR_OID = "1.3.6.1.4.1.9.9.13.1.5.1.2"
CISCO_POWER_SUPPLY_STATE_OID = "1.3.6.1.4.1.9.9.13.1.5.1.3"
SENSOR_TYPES = {6: "power", 8: "temperature"}
SENSOR_UNITS = {6: "W", 8: "C"}
SENSOR_SCALE_EXPONENT = {
    1: -24,
    2: -21,
    3: -18,
    4: -15,
    5: -12,
    6: -9,
    7: -6,
    8: -3,
    9: 0,
    10: 3,
    11: 6,
    12: 9,
    13: 12,
    14: 15,
    15: 18,
    16: 21,
    17: 24,
}
SENSOR_STATUS = {1: "ok", 2: "unavailable", 3: "nonoperational"}
CISCO_ENVMON_STATE = {1: "normal", 2: "warning", 3: "critical", 4: "shutdown", 5: "not present", 6: "not functioning"}


def _serialize_device(device: Device, db: Session | None = None) -> dict:
    raw_interfaces = []
    if device.interfaces:
        try:
            raw_interfaces = json.loads(device.interfaces)
        except (TypeError, ValueError):
            raw_interfaces = []
    vlans = _device_vlans(device)
    interfaces = _device_interfaces(device, raw_interfaces, vlans, db)

    last_seen_at = _datetime_to_string(device.last_seen_at)
    discovered_at = _datetime_to_string(device.discovered_at)

    return {
        "id": device.id,
        "name": device.name,
        "hostname": device.hostname,
        "management_ip": device.management_ip,
        "role": device.role,
        "status": device.status,
        "device_type": device.device_type,
        "platform": device.platform,
        "manufacturer": device.manufacturer,
        "model": device.model,
        "serial_number": device.serial_number,
        "asset_tag": device.asset_tag,
        "mac_address": device.mac_address,
        "discovery_source": device.discovery_source,
        "description": device.description,
        "tags": device.tags,
        "site_id": device.site_id,
        "vlan": device.vlan,
        "vlans": vlans,
        "connection": device.connection,
        "interfaces": interfaces,
        "snmp_status": device.snmp_status,
        "snmp_last_error": device.snmp_last_error,
        "config_status": device.config_status,
        "configuration_snapshot": device.configuration_snapshot,
        "snmp_credential_id": device.snmp_credential_id,
        "ssh_credential_id": device.ssh_credential_id,
        "location": device.location,
        "room": device.room,
        "rack": device.rack,
        "position": device.position,
        "rack_units": device.rack_units,
        "power_consumption_w": device.power_consumption_w,
        "owner": device.owner,
        "tenant": device.tenant,
        "comments": device.comments,
        "site": {"name": device.site.name} if device.site else None,
        "last_seen_at": last_seen_at,
        "discovered_at": discovered_at,
    }


def _device_interfaces(device: Device, interfaces: list[dict], vlans: list[dict], db: Session | None = None) -> list[dict]:
    rows = [dict(item) for item in interfaces if isinstance(item, dict)]
    rows_by_name = {str(item.get("name") or ""): item for item in rows if item.get("name")}
    for vlan in vlans:
        for port in vlan.get("ports") or []:
            name = str(port.get("name") or "").strip()
            if not name:
                continue
            item = rows_by_name.get(name)
            if not item:
                item = {"name": name, "status": "unknown", "source": "vlan-membership"}
                rows.append(item)
                rows_by_name[name] = item
            item.setdefault("mode", "access" if port.get("mode") == "untagged" else "tagged")

    link_map = _interface_link_map(device, db)
    for item in rows:
        name = str(item.get("name") or "")
        link = link_map.get(name)
        item["label"] = item.get("label") or _interface_label(name)
        item["enabled"] = _interface_enabled(item)
        item["display_status"] = _interface_display_status(item)
        item["parent"] = item.get("parent") or _interface_parent(name)
        item["lag"] = item.get("lag") or item.get("channel_group") or ""
        item["mode"] = item.get("mode") or _interface_mode(name, vlans)
        item["description"] = item.get("description") or item.get("alias") or ""
        item["ip_addresses"] = _interface_ip_addresses(item)
        item["cable"] = _interface_cable_text(link)
        item["connection"] = _interface_connection_text(link, item)
        item["connection_device_id"] = _interface_connection_device_id(link, item)
        item["connection_device_name"] = _interface_connection_device_name(link, item)
    return rows


def _interface_link_map(device: Device, db: Session | None) -> dict[str, DeviceLink]:
    if db is None or not device.id:
        return {}
    links = db.query(DeviceLink).filter(or_(DeviceLink.local_device_id == device.id, DeviceLink.remote_device_id == device.id)).all()
    result = {}
    for link in links:
        if link.local_device_id == device.id and link.local_interface:
            result[link.local_interface] = link
        if link.remote_device_id == device.id and link.remote_interface:
            result[link.remote_interface] = link
    return result


def _interface_label(name: str) -> str:
    short = _short_interface_name(name)
    return "" if short == name else short


def _short_interface_name(name: str) -> str:
    return (
        name.replace("TenGigabitEthernet", "Te")
        .replace("GigabitEthernet", "Gi")
        .replace("FastEthernet", "Fa")
        .replace("Ethernet", "Eth")
        .replace("Port-channel", "Po")
    )


def _interface_enabled(item: dict) -> bool:
    admin = str(item.get("admin_status") or item.get("admin") or "").lower()
    status_value = str(item.get("status") or item.get("oper_status") or "").lower()
    if admin:
        return admin not in {"down", "disabled", "2"}
    return status_value not in {"administratively down", "disabled"}


def _interface_display_status(item: dict) -> str:
    admin = str(item.get("admin_status") or "").lower()
    oper = str(item.get("oper_status") or item.get("status") or "").lower()
    if admin in {"down", "disabled", "2"}:
        return "Disabled"
    if oper in {"up", "1"}:
        return "Connected"
    if oper in {"down", "2", "notpresent", "not present"}:
        return "Not connected"
    if oper in {"lowerlayerdown", "lower layer down", "dormant", "testing", "unknown"}:
        return "Error"
    return item.get("status") or "Unknown"


def _interface_parent(name: str) -> str:
    lowered = name.lower()
    if "." in name:
        return name.split(".", 1)[0]
    if lowered.startswith("vlan"):
        return "SVI"
    return ""


def _interface_mode(name: str, vlans: list[dict]) -> str:
    tagged = False
    untagged = False
    for vlan in vlans:
        for port in vlan.get("ports") or []:
            if port.get("name") != name:
                continue
            if port.get("mode") == "tagged":
                tagged = True
            if port.get("mode") == "untagged":
                untagged = True
    if tagged and untagged:
        return "trunk"
    if tagged:
        return "tagged"
    if untagged:
        return "access"
    return ""


def _interface_ip_addresses(item: dict) -> list[str]:
    value = item.get("ip") or item.get("ip_addresses") or ""
    if isinstance(value, list):
        return [str(part) for part in value if part]
    return [part.strip() for part in str(value).replace(";", ",").split(",") if part.strip()]


def _interface_cable_text(link: DeviceLink | None) -> str:
    if not link:
        return ""
    return f"{link.local_interface or '-'} to {link.remote_interface or '-'}"


def _interface_connection_text(link: DeviceLink | None, item: dict) -> str:
    if link:
        remote_name = _interface_connection_device_name(link, item)
        protocol = (link.protocol or "neighbor").upper()
        return f"{remote_name or 'Neighbor'} ({protocol})"
    return item.get("connection") or ""


def _interface_connection_device_id(link: DeviceLink | None, item: dict) -> int | None:
    if not link:
        return None
    return link.remote_device_id if link.local_interface == item.get("name") else link.local_device_id


def _interface_connection_device_name(link: DeviceLink | None, item: dict) -> str:
    if not link:
        return ""
    return link.remote_device_name if link.local_interface == item.get("name") else link.local_device_name


def _device_vlans(device: Device) -> list[dict]:
    vlans = _device_vlans_from_json(device.vlans)
    if not vlans and device.configuration_snapshot:
        vlans = _parse_vlans_from_configuration(device.configuration_snapshot)
    if not vlans and device.vlan:
        vlans = [{"id": device.vlan, "name": f"VLAN {device.vlan}", "source": "inventory"}]
    return vlans


def _device_vlans_from_json(value: str | None) -> list[dict]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []


def _parse_vlans_from_configuration(snapshot: str) -> list[dict]:
    vlan_map: dict[int, dict] = {}
    current_vlan: int | None = None
    current_interface = ""
    interface_lines: list[str] = []

    def ensure_vlan(vlan_id: int, name: str | None = None, source: str = "ssh-config") -> dict:
        row = vlan_map.setdefault(vlan_id, {"id": vlan_id, "name": name or f"VLAN {vlan_id}", "source": source, "ports": []})
        if name and (not row.get("name") or row["name"] == f"VLAN {vlan_id}"):
            row["name"] = name
        return row

    def add_port(vlan_id: int, port_name: str, mode: str) -> None:
        if not vlan_id or not port_name:
            return
        row = ensure_vlan(vlan_id)
        ports = row.setdefault("ports", [])
        if not any(port.get("name") == port_name and port.get("mode") == mode for port in ports):
            ports.append({"name": port_name, "mode": mode, "source": "ssh-config"})

    def parse_vlan_values(value: str) -> list[int]:
        ids: list[int] = []
        for part in re.split(r"[, ]+", value.strip()):
            if not part:
                continue
            if "-" in part:
                start, end = part.split("-", 1)
                if start.isdigit() and end.isdigit():
                    ids.extend(range(int(start), int(end) + 1))
            elif part.isdigit():
                ids.append(int(part))
        return ids

    def flush_interface() -> None:
        if not current_interface:
            return
        joined = "\n".join(interface_lines)
        access_match = re.search(r"^\s*switchport access vlan\s+(\d+)", joined, re.MULTILINE)
        voice_match = re.search(r"^\s*switchport voice vlan\s+(\d+)", joined, re.MULTILINE)
        native_match = re.search(r"^\s*switchport trunk native vlan\s+(\d+)", joined, re.MULTILINE)
        allowed_match = re.search(r"^\s*switchport trunk allowed vlan(?: add)?\s+([0-9,\- ]+)", joined, re.MULTILINE)
        mode_access = re.search(r"^\s*switchport mode access", joined, re.MULTILINE)
        mode_trunk = re.search(r"^\s*switchport mode trunk", joined, re.MULTILINE)

        if access_match:
            add_port(int(access_match.group(1)), current_interface, "untagged")
        elif mode_access:
            add_port(1, current_interface, "untagged")
        if voice_match:
            add_port(int(voice_match.group(1)), current_interface, "tagged")
        if native_match:
            add_port(int(native_match.group(1)), current_interface, "untagged")
        if allowed_match:
            for vlan_id in parse_vlan_values(allowed_match.group(1)):
                add_port(vlan_id, current_interface, "tagged")
        elif mode_trunk:
            add_port(1, current_interface, "untagged")

    for raw_line in snapshot.splitlines():
        line = raw_line.rstrip()
        vlan_match = re.match(r"^vlan\s+(\d+)\s*$", line.strip(), re.IGNORECASE)
        inline_vlan_match = re.match(r"^vlan\s+(\d+)\s+name\s+(.+)$", line.strip(), re.IGNORECASE)
        interface_match = re.match(r"^interface\s+(.+)$", line.strip(), re.IGNORECASE)

        if interface_match:
            flush_interface()
            current_vlan = None
            current_interface = interface_match.group(1).strip()
            interface_lines = []
            continue
        if line.strip() == "!":
            flush_interface()
            current_interface = ""
            interface_lines = []
            current_vlan = None
            continue
        if current_interface:
            interface_lines.append(line)
            continue
        if inline_vlan_match:
            vlan_id = int(inline_vlan_match.group(1))
            ensure_vlan(vlan_id, inline_vlan_match.group(2).strip())
            current_vlan = vlan_id
            continue
        if vlan_match:
            current_vlan = int(vlan_match.group(1))
            ensure_vlan(current_vlan)
            continue
        name_match = re.match(r"^\s*name\s+(.+)$", line, re.IGNORECASE)
        if current_vlan and name_match:
            ensure_vlan(current_vlan, name_match.group(1).strip())

    flush_interface()
    return sorted(vlan_map.values(), key=lambda item: item["id"])


def _interfaces_from_json(value: str | None) -> list[dict]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return []
    return [item for item in parsed if isinstance(item, dict)] if isinstance(parsed, list) else []


def _parse_interfaces_from_configuration(snapshot: str) -> list[dict]:
    interfaces: list[dict] = []
    current_interface = ""
    interface_lines: list[str] = []

    def interface_type(name: str) -> str:
        lowered = name.lower()
        if lowered.startswith("vlan"):
            return "svi"
        if lowered.startswith("port-channel"):
            return "lag"
        if lowered.startswith(("gigabitethernet", "fastethernet", "tengigabitethernet", "ethernet")):
            return "ethernet"
        if lowered.startswith("loopback"):
            return "loopback"
        if lowered.startswith("tunnel"):
            return "tunnel"
        return ""

    def flush_interface() -> None:
        if not current_interface:
            return
        joined = "\n".join(interface_lines)
        row: dict = {"name": current_interface, "source": "ssh-config", "type": interface_type(current_interface)}

        description_match = re.search(r"^\s*description\s+(.+)$", joined, re.MULTILINE | re.IGNORECASE)
        if description_match:
            row["description"] = description_match.group(1).strip()

        mtu_match = re.search(r"^\s*(?:mtu|ip mtu)\s+(\d+)", joined, re.MULTILINE | re.IGNORECASE)
        if mtu_match:
            row["mtu"] = int(mtu_match.group(1))

        ip_matches = re.findall(r"^\s*ip address\s+(\d+\.\d+\.\d+\.\d+)(?:\s+\d+\.\d+\.\d+\.\d+)?", joined, re.MULTILINE | re.IGNORECASE)
        if ip_matches:
            row["ip_addresses"] = ip_matches
            row["ip"] = ", ".join(ip_matches)

        channel_match = re.search(r"^\s*channel-group\s+(\d+)", joined, re.MULTILINE | re.IGNORECASE)
        if channel_match:
            row["lag"] = f"Port-channel{channel_match.group(1)}"

        if re.search(r"^\s*switchport mode trunk", joined, re.MULTILINE | re.IGNORECASE):
            row["mode"] = "trunk"
        elif re.search(r"^\s*switchport mode access", joined, re.MULTILINE | re.IGNORECASE):
            row["mode"] = "access"
        elif re.search(r"^\s*switchport access vlan\s+\d+", joined, re.MULTILINE | re.IGNORECASE):
            row["mode"] = "access"

        if re.search(r"^\s*shutdown\s*$", joined, re.MULTILINE | re.IGNORECASE):
            row["admin_status"] = "down"
            row["status"] = "down"
            row["enabled"] = False
        else:
            row["admin_status"] = "up"
            row["status"] = "unknown"
            row["enabled"] = True

        interfaces.append(row)

    for raw_line in snapshot.splitlines():
        line = raw_line.rstrip()
        interface_match = re.match(r"^interface\s+(.+)$", line.strip(), re.IGNORECASE)
        if interface_match:
            flush_interface()
            current_interface = interface_match.group(1).strip()
            interface_lines = []
            continue
        if line.strip() == "!":
            flush_interface()
            current_interface = ""
            interface_lines = []
            continue
        if current_interface:
            interface_lines.append(line)

    flush_interface()
    return interfaces


def _datetime_to_string(value) -> str | None:
    if not value:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc).isoformat()
        return value.isoformat()
    return str(value)


def _device_values(payload: DeviceCreate | DeviceUpdate) -> dict:
    values = payload.model_dump(exclude_unset=True)
    if "interfaces" in values and values["interfaces"] is not None:
        values["interfaces"] = json.dumps(values["interfaces"])
    if "vlans" in values and values["vlans"] is not None:
        values["vlans"] = json.dumps(values["vlans"])
    if "rack_units" in values:
        values["rack_units"] = max(1, min(52, int(values["rack_units"] or 1)))
    if "power_consumption_w" in values and values["power_consumption_w"] is not None:
        try:
            values["power_consumption_w"] = max(0, float(values["power_consumption_w"]))
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Power consumption must be a number") from exc
    return values


def _audit(db: Session, user: User, action: str, entity_id: int | None, details: dict | str) -> None:
    payload = details if isinstance(details, str) else json.dumps(details, default=str)
    db.add(AuditLog(action=action, entity_type="device", entity_id=entity_id, details=f"{user.email}: {payload}"))


def _validate_unique(db: Session, values: dict, device_id: int | None = None) -> None:
    checks = [
        ("name", "Device name already exists"),
        ("management_ip", "Management IP already exists"),
        ("serial_number", "Serial number already exists"),
        ("asset_tag", "Asset tag already exists"),
    ]
    for field, message in checks:
        value = values.get(field)
        if value in (None, ""):
            continue
        query = db.query(Device).filter(getattr(Device, field) == value)
        if device_id is not None:
            query = query.filter(Device.id != device_id)
        if query.first():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=message)


def _get_devices_by_ids(db: Session, ids: list[int]) -> list[Device]:
    unique_ids = list(dict.fromkeys(ids))
    if not unique_ids:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Select at least one device")
    devices = db.query(Device).filter(Device.id.in_(unique_ids)).all()
    if len(devices) != len(unique_ids):
        found = {device.id for device in devices}
        missing = [device_id for device_id in unique_ids if device_id not in found]
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Devices not found: {missing}")
    return devices


def _global_snmp_community(db: Session) -> str:
    row = db.query(AppConfig).filter(AppConfig.key == "snmp_community").first()
    return row.value if row and row.value else ""


def _device_snmp_config(db: Session, device: Device) -> tuple[str, int, str]:
    if device.snmp_credential_id:
        profile = db.query(CredentialProfile).filter(CredentialProfile.id == device.snmp_credential_id).first()
        if profile and profile.credential_type == "snmp_v2c":
            return decrypt_secret(profile.secret_encrypted), profile.port or 161, profile.name
    return _global_snmp_community(db), 161, "Global SNMP community"


def _walk_by_last_index(client: SnmpClient, oid: str, limit: int = 512) -> dict[int, object]:
    rows = {}
    for item in client.walk(oid, limit=limit):
        parts = _oid_tuple(item.oid)
        if parts:
            rows[parts[-1]] = item
    return rows


def _sensor_number(value) -> int | None:
    return value.value if value is not None and isinstance(value.value, int) else None


def _sensor_actual_value(raw_value: int | float, scale_value: int = 9, precision_value: int = 0) -> float:
    scale = SENSOR_SCALE_EXPONENT.get(int(scale_value or 9), 0)
    precision = int(precision_value or 0)
    return float(raw_value) * (10 ** scale) / (10 ** precision)


def _collect_entity_environment(client: SnmpClient) -> list[dict]:
    types = _walk_by_last_index(client, ENTITY_SENSOR_TYPE_OID)
    if not types:
        return []
    scales = _walk_by_last_index(client, ENTITY_SENSOR_SCALE_OID)
    precisions = _walk_by_last_index(client, ENTITY_SENSOR_PRECISION_OID)
    values = _walk_by_last_index(client, ENTITY_SENSOR_VALUE_OID)
    statuses = _walk_by_last_index(client, ENTITY_SENSOR_OPER_STATUS_OID)
    unit_labels = _walk_by_last_index(client, ENTITY_SENSOR_UNITS_OID)
    names = _walk_by_last_index(client, ENTITY_PHYSICAL_NAME_OID)
    descriptions = _walk_by_last_index(client, ENTITY_PHYSICAL_DESCR_OID)
    sensors = []
    for index, type_value in types.items():
        sensor_type_id = _sensor_number(type_value)
        metric = SENSOR_TYPES.get(sensor_type_id or 0)
        raw = _sensor_number(values.get(index))
        if not metric or raw is None or raw <= -1000000000:
            continue
        actual = _sensor_actual_value(raw, _sensor_number(scales.get(index)) or 9, _sensor_number(precisions.get(index)) or 0)
        if abs(actual) > 100000:
            continue
        sensors.append({
            "index": index,
            "metric": metric,
            "label": _as_string(names.get(index)) or _as_string(descriptions.get(index)) or f"Sensor {index}",
            "value": round(actual, 2),
            "unit": _as_string(unit_labels.get(index)) or SENSOR_UNITS.get(sensor_type_id or 0, ""),
            "status": SENSOR_STATUS.get(_sensor_number(statuses.get(index)) or 0, "unknown"),
            "source": "ENTITY-SENSOR-MIB",
        })
    return sensors


def _collect_cisco_temperature_environment(client: SnmpClient) -> list[dict]:
    values = _walk_by_last_index(client, CISCO_TEMPERATURE_VALUE_OID)
    if not values:
        return []
    descriptions = _walk_by_last_index(client, CISCO_TEMPERATURE_DESCR_OID)
    thresholds = _walk_by_last_index(client, CISCO_TEMPERATURE_THRESHOLD_OID)
    last_shutdowns = _walk_by_last_index(client, CISCO_TEMPERATURE_LAST_SHUTDOWN_OID)
    states = _walk_by_last_index(client, CISCO_TEMPERATURE_STATE_OID)
    sensors = []
    for index, value in values.items():
        raw = _sensor_number(value)
        if raw is None:
            continue
        state_code = _sensor_number(states.get(index)) or 1
        sensors.append({
            "index": index,
            "metric": "temperature",
            "label": _as_string(descriptions.get(index)) or f"Temperature {index}",
            "value": raw,
            "unit": "C",
            "threshold_c": _sensor_number(thresholds.get(index)),
            "last_shutdown_c": _sensor_number(last_shutdowns.get(index)),
            "state_code": state_code,
            "status": CISCO_ENVMON_STATE.get(state_code, "unknown"),
            "source": "CISCO-ENVMON-MIB",
        })
    return sensors


def _collect_cisco_fan_environment(client: SnmpClient) -> list[dict]:
    states = _walk_by_last_index(client, CISCO_FAN_STATE_OID)
    descriptions = _walk_by_last_index(client, CISCO_FAN_DESCR_OID)
    sensors = []
    for index, state in states.items():
        state_code = _sensor_number(state)
        if state_code is None:
            continue
        sensors.append({
            "index": index,
            "metric": "fan",
            "label": _as_string(descriptions.get(index)) or f"Fan {index}",
            "value": state_code,
            "unit": "",
            "state_code": state_code,
            "status": CISCO_ENVMON_STATE.get(state_code, "unknown"),
            "source": "CISCO-ENVMON-MIB",
        })
    return sensors


def _collect_cisco_power_supply_environment(client: SnmpClient) -> list[dict]:
    states = _walk_by_last_index(client, CISCO_POWER_SUPPLY_STATE_OID)
    descriptions = _walk_by_last_index(client, CISCO_POWER_SUPPLY_DESCR_OID)
    sensors = []
    for index, state in states.items():
        state_code = _sensor_number(state)
        if state_code is None:
            continue
        sensors.append({
            "index": index,
            "metric": "power_supply",
            "label": _as_string(descriptions.get(index)) or f"Power supply {index}",
            "value": state_code,
            "unit": "",
            "state_code": state_code,
            "status": CISCO_ENVMON_STATE.get(state_code, "unknown"),
            "source": "CISCO-ENVMON-MIB",
        })
    return sensors


def _summarize_environment(sensors: list[dict]) -> dict:
    temperatures = [sensor for sensor in sensors if sensor.get("metric") == "temperature"]
    power = [sensor for sensor in sensors if sensor.get("metric") == "power"]
    fans = [sensor for sensor in sensors if sensor.get("metric") == "fan"]
    power_supplies = [sensor for sensor in sensors if sensor.get("metric") == "power_supply"]
    temperature_thresholds = [sensor.get("threshold_c") for sensor in temperatures if sensor.get("threshold_c") is not None]
    return {
        "temperature_c": max((float(sensor["value"]) for sensor in temperatures), default=None),
        "temperature_threshold_c": min(temperature_thresholds) if temperature_thresholds else None,
        "temperature_status": next((sensor.get("status") for sensor in temperatures if sensor.get("status")), None),
        "power_w": sum(float(sensor["value"]) for sensor in power) if power else None,
        "fan_status": next((sensor.get("status") for sensor in fans if sensor.get("status") != "normal"), None) or ("normal" if fans else None),
        "power_supply_status": next((sensor.get("status") for sensor in power_supplies if sensor.get("status") != "normal"), None) or ("normal" if power_supplies else None),
        "temperature_sensors": temperatures,
        "power_sensors": power,
        "fan_sensors": fans,
        "power_supply_sensors": power_supplies,
        "sensors": sensors,
    }


def _delete_topology_links_for_devices(db: Session, device_ids: list[int]) -> int:
    ids = [device_id for device_id in dict.fromkeys(device_ids) if device_id]
    if not ids:
        return 0
    links = db.query(DeviceLink).filter(or_(DeviceLink.local_device_id.in_(ids), DeviceLink.remote_device_id.in_(ids))).all()
    count = len(links)
    for link in links:
        db.delete(link)
    return count


def _terminal_commands(payload: DeviceTerminalRequest) -> list[str]:
    commands = [command.strip() for command in payload.commands if command and command.strip()]
    commands.extend(command.strip() for command in payload.command.splitlines() if command.strip())
    commands = commands[:20]
    if not commands:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Enter at least one terminal command")
    too_long = next((command for command in commands if len(command) > 500), None)
    if too_long:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Terminal commands must be 500 characters or less")
    return commands


def _apply_configuration_result(device: Device, result, credential_id: int) -> None:
    device.config_status = result.status if not result.error else f"{result.status} {result.error}"
    device.configuration_snapshot = result.snapshot
    record = {
        "name": device.name,
        "hostname": device.hostname,
        "platform": device.platform,
        "manufacturer": device.manufacturer,
        "model": device.model,
        "serial_number": device.serial_number,
        "vlan": device.vlan,
        "vlans": _device_vlans_from_json(device.vlans),
        "interfaces": _interfaces_from_json(device.interfaces),
        "discovery_source": device.discovery_source,
    }
    merge_configuration_inventory(record, result.snapshot or "")
    for field in ["name", "hostname", "platform", "manufacturer", "model", "serial_number", "discovery_source"]:
        value = record.get(field)
        if value not in (None, "", []):
            setattr(device, field, value)
    if record.get("vlans"):
        device.vlans = json.dumps(record["vlans"])
        if record.get("vlan"):
            device.vlan = record["vlan"]
    if record.get("interfaces"):
        device.interfaces = json.dumps(record["interfaces"])

    device.ssh_credential_id = credential_id
    device.discovered_at = datetime.now(timezone.utc)
    if result.snapshot:
        device.last_seen_at = datetime.now(timezone.utc)


def _collect_device_configuration(
    db: Session,
    device: Device,
    current_user: User,
    credential_id: int | None = None,
    timeout: float = 8.0,
    job_type: str = "device_config_collection",
    audit_action: str = "collect_device_config",
    backup_source: str = "manual_collect",
):
    if not device.management_ip:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Device has no management IP")

    selected_credential_id = credential_id or device.ssh_credential_id
    if not selected_credential_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Select an SSH credential profile for this device first")
    profile = db.query(CredentialProfile).filter(CredentialProfile.id == selected_credential_id).first()
    if not profile or profile.credential_type != "ssh":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SSH credential profile not found")
    if not profile.username or not profile.secret_encrypted:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="SSH credential profile requires username and password")

    job = start_job(db, job_type, device.management_ip, current_user.email, {
        "device_id": device.id,
        "device_name": device.name,
        "ssh_credential_id": selected_credential_id,
        "timeout": timeout,
    })
    collector = SshConfigurationCollector(
        username=profile.username,
        password=decrypt_secret(profile.secret_encrypted),
        enable_password=decrypt_secret(profile.enable_secret_encrypted),
        port=profile.port or 22,
        timeout=timeout,
    )
    try:
        update_job_progress(db, job, 25, {"phase": "connecting", "device_id": device.id, "device_name": device.name})
        result = collector.collect(device.management_ip, device.platform or "")
        update_job_progress(db, job, 80, {
            "phase": "applying_inventory",
            "device_id": device.id,
            "device_name": device.name,
            "status": result.status,
            "bytes": len(result.snapshot or ""),
        })
    except Exception as exc:
        fail_job(db, job, str(exc))
        db.commit()
        raise

    _apply_configuration_result(device, result, selected_credential_id)
    backup = create_config_backup(
        db,
        device,
        result.snapshot or "",
        status=device.config_status,
        source=backup_source,
        created_by=current_user.email,
        ssh_credential_id=selected_credential_id,
        job_id=job.id,
    )
    _audit(db, current_user, audit_action, device.id, {
        "device": device.name,
        "management_ip": device.management_ip,
        "ssh_credential_id": selected_credential_id,
        "status": device.config_status,
        "bytes": len(result.snapshot or ""),
        "backup_id": backup.id if backup else None,
    })
    complete_job(db, job, {
        "device_id": device.id,
        "device_name": device.name,
        "status": device.config_status,
        "bytes": len(result.snapshot or ""),
        "backup_id": backup.id if backup else None,
        "vlans": len(_device_vlans_from_json(device.vlans)),
        "interfaces": len(_interfaces_from_json(device.interfaces)),
    })
    return job


def _websocket_user(db: Session, token: str) -> User | None:
    if not token:
        return None
    try:
        claims = decode_access_token(token)
    except ValueError:
        return None
    user = db.query(User).filter(User.email == claims["subject"], User.is_active.is_(True)).first()
    if not user or user.token_version != claims["token_version"]:
        return None
    return user


@router.get("", response_model=dict)
def list_devices(
    q: str = "",
    status_filter: str = Query(default="", alias="status"),
    role: str = "",
    site_id: int | None = None,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=10000),
    sort: str = "name",
    direction: str = Query(default="asc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Device).join(Site, Device.site_id == Site.id, isouter=True)
    if q:
        pattern = f"%{q}%"
        query = query.filter(or_(
            Device.name.ilike(pattern),
            Device.hostname.ilike(pattern),
            Device.management_ip.ilike(pattern),
            Device.mac_address.ilike(pattern),
            Device.role.ilike(pattern),
            Device.platform.ilike(pattern),
            Device.tags.ilike(pattern),
            Site.name.ilike(pattern),
        ))
    if status_filter:
        query = query.filter(Device.status == status_filter)
    if role:
        query = query.filter(Device.role == role)
    if site_id is not None:
        query = query.filter(Device.site_id == site_id)

    sortable = {
        "name": Device.name,
        "management_ip": Device.management_ip,
        "role": Device.role,
        "status": Device.status,
        "last_seen_at": Device.last_seen_at,
        "vlan": Device.vlan,
    }
    sort_column = sortable.get(sort, Device.name)
    query = query.order_by(sort_column.desc() if direction == "desc" else sort_column.asc())
    total = query.count()
    summary_devices = query.all()
    active_count = sum(1 for device in summary_devices if str(device.status or "").lower() == "active")
    issue_count = total - active_count
    wireless_count = sum(1 for device in summary_devices if any(value in " ".join(str(item or "") for item in (device.role, device.device_type, device.platform, device.manufacturer, device.model, device.tags)).lower() for value in ("wireless", "access point", "ruckus")) and str(device.status or "").lower() == "active")
    latest_seen = max((device.last_seen_at for device in summary_devices if device.last_seen_at), default=None)
    devices = query.offset((page - 1) * per_page).limit(per_page).all()
    return {
        "message": "ok",
        "data": {
            "data": [_serialize_device(device, db) for device in devices],
            "meta": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "pages": (total + per_page - 1) // per_page,
                "summary": {
                    "total": total,
                    "active": active_count,
                    "issues": issue_count,
                    "availability": round((active_count / total) * 100, 2) if total else 0,
                    "online_aps": wireless_count,
                    "latest_seen_at": _datetime_to_string(latest_seen),
                },
            },
        },
    }


@router.post("/status-refresh", response_model=dict)
def refresh_device_statuses(
    device_id: int | None = None,
    timeout: float = Query(default=0.8, ge=0.2, le=10),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Device)
    if device_id is not None:
        query = query.filter(Device.id == device_id)
    devices = query.order_by(Device.name.asc()).all()
    service = ProtocolCheckService(timeout=timeout)
    checked = 0
    active = 0
    offline = 0
    skipped = 0
    changed = []

    eligible_devices = [device for device in devices if device.management_ip and device.status not in MANUAL_STATUSES]
    skipped = len(devices) - len(eligible_devices)
    check_results = []
    if eligible_devices:
        worker_count = min(32, len(eligible_devices))
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            check_results = list(executor.map(lambda item: service.check(item.management_ip, "icmp").to_dict(), eligible_devices))

    for device, result in zip(eligible_devices, check_results):
        checked += 1
        next_status = "Active" if result["status"] == "up" else "Offline"
        now = datetime.now(timezone.utc)
        alert_fingerprint = f"device-status:{device.id}"
        status_alert = db.query(Alert).filter(Alert.fingerprint == alert_fingerprint).first()
        if next_status == "Active":
            active += 1
            device.last_seen_at = now
            if status_alert and status_alert.status != "resolved":
                status_alert.status = "resolved"
                status_alert.resolved_by = "status-monitor"
                status_alert.resolved_at = now
                status_alert.last_seen_at = now
        else:
            offline += 1
            alert_details = json.dumps({"device_id": device.id, "device_name": device.name, "management_ip": device.management_ip, "checked_at": now.isoformat(), "check": result}, default=str)
            if status_alert:
                status_alert.title = "Device offline"
                status_alert.message = f"{device.name} did not respond to the ICMP status check."
                status_alert.severity = "critical"
                status_alert.status = "open" if status_alert.status == "resolved" else status_alert.status
                status_alert.details = alert_details
                status_alert.last_seen_at = now
                status_alert.resolved_by = ""
                status_alert.resolved_at = None
            else:
                db.add(Alert(fingerprint=alert_fingerprint, title="Device offline", message=f"{device.name} did not respond to the ICMP status check.", severity="critical", source="device-status-monitor", entity_type="device", entity_id=device.id, details=alert_details, first_seen_at=now, last_seen_at=now))
        if device.status != next_status:
            changed.append({"id": device.id, "name": device.name, "from": device.status, "to": next_status})
            device.status = next_status

    _audit(db, current_user, "refresh_device_status", None, {
        "device_id": device_id,
        "checked": checked,
        "active": active,
        "offline": offline,
        "skipped": skipped,
        "changed": changed,
    })
    db.commit()
    return {
        "message": "updated",
        "data": {
            "checked": checked,
            "active": active,
            "offline": offline,
            "skipped": skipped,
            "changed": changed,
        },
    }


@router.patch("/bulk", response_model=dict)
def bulk_update_devices(payload: DeviceBulkUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    devices = _get_devices_by_ids(db, payload.ids)
    values = _device_values(payload.values)
    values = {key: value for key, value in values.items() if key in BULK_EDIT_FIELDS and (value is not None or key in NULLABLE_UPDATE_FIELDS)}
    if not values:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No supported bulk-edit fields were provided")
    for device in devices:
        for field, value in values.items():
            setattr(device, field, value)
    _audit(db, current_user, "bulk_update_devices", None, {"ids": [device.id for device in devices], "values": values})
    db.commit()
    return {
        "message": "updated",
        "data": {"updated": len(devices), "ids": [device.id for device in devices], "values": values},
    }


@router.post("/bulk-delete", response_model=dict)
def bulk_delete_devices(payload: DeviceBulkDelete, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    devices = _get_devices_by_ids(db, payload.ids)
    details = [{"id": device.id, "name": device.name, "management_ip": device.management_ip} for device in devices]
    removed_topology_links = _delete_topology_links_for_devices(db, [device.id for device in devices])
    for device in devices:
        for backup in db.query(DeviceConfigBackup).filter(DeviceConfigBackup.device_id == device.id).all():
            db.delete(backup)
        db.delete(device)
    _audit(db, current_user, "bulk_delete_devices", None, {"devices": details, "topology_links_deleted": removed_topology_links})
    db.commit()
    return {"message": "deleted", "data": {"deleted": len(devices), "ids": [item["id"] for item in details], "topology_links_deleted": removed_topology_links}}


@router.post("/configuration-backups/run", response_model=dict)
def run_configuration_backups(
    payload: DeviceConfigBackupRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Device).order_by(Device.name.asc())
    if payload.device_ids:
        query = query.filter(Device.id.in_(payload.device_ids))
    elif payload.scope == "active_with_ssh":
        query = query.filter(Device.status == "Active", Device.ssh_credential_id.isnot(None))
    elif payload.scope == "with_ssh":
        query = query.filter(Device.ssh_credential_id.isnot(None))
    elif payload.scope == "all":
        pass
    else:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unsupported backup scope")

    devices = query.all()
    backed_up = 0
    failed = []
    skipped = []
    for device in devices:
        if not device.management_ip or not device.ssh_credential_id:
            skipped.append({"id": device.id, "name": device.name, "reason": "Missing management IP or SSH credential"})
            continue
        try:
            _collect_device_configuration(
                db,
                device,
                current_user,
                timeout=payload.timeout,
                job_type="device_config_backup",
                audit_action="backup_device_config",
                backup_source="bulk_backup",
            )
            backed_up += 1
        except HTTPException as exc:
            failed.append({"id": device.id, "name": device.name, "error": exc.detail})
        except Exception as exc:
            failed.append({"id": device.id, "name": device.name, "error": str(exc)})
    db.commit()
    return {
        "message": "backup run finished",
        "data": {
            "checked": len(devices),
            "backed_up": backed_up,
            "skipped": skipped,
            "failed": failed,
        },
    }


@router.get("/{device_id}/configuration-backups", response_model=dict)
def get_configuration_backups(
    device_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    backups = list_config_backups(db, device.id)
    if not backups and device.configuration_snapshot:
        create_config_backup(
            db,
            device,
            device.configuration_snapshot,
            status=device.config_status or "Existing configuration snapshot imported as backup.",
            source="current_snapshot",
            created_by=current_user.email,
            ssh_credential_id=device.ssh_credential_id,
        )
        db.commit()
        backups = list_config_backups(db, device.id)
    return {"message": "ok", "data": {"data": [serialize_config_backup(backup) for backup in backups], "limit": 5}}


@router.post("/{device_id}/configuration-backups", response_model=dict)
def backup_device_configuration(
    device_id: int,
    ssh_credential_id: int | None = None,
    timeout: float = Query(default=8.0, ge=0.2, le=30.0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    job = _collect_device_configuration(
        db,
        device,
        current_user,
        credential_id=ssh_credential_id,
        timeout=timeout,
        job_type="device_config_backup",
        audit_action="backup_device_config",
        backup_source="manual_backup",
    )
    db.commit()
    db.refresh(device)
    backups = list_config_backups(db, device.id)
    return {
        "message": "backed up",
        "data": {
            "device": _serialize_device(device, db),
            "backups": [serialize_config_backup(backup) for backup in backups],
            "limit": 5,
        },
        "job_id": job.id,
    }


@router.post("/{device_id}/configuration-backups/{backup_id}/restore", response_model=dict)
def restore_device_configuration_backup(
    device_id: int,
    backup_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    backup = db.query(DeviceConfigBackup).filter(DeviceConfigBackup.id == backup_id, DeviceConfigBackup.device_id == device_id).first()
    if not backup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Configuration backup not found")
    restore_config_backup(db, device, backup, restored_by=current_user.email)
    _audit(db, current_user, "restore_device_config_backup", device.id, {
        "device": device.name,
        "backup_id": backup.id,
        "backup_created_at": _datetime_to_string(backup.created_at),
    })
    db.commit()
    db.refresh(device)
    return {"message": "restored", "data": _serialize_device(device, db)}


@router.post("/{device_id}/collect-config", response_model=dict)
def collect_device_configuration(
    device_id: int,
    ssh_credential_id: int | None = None,
    timeout: float = Query(default=8.0, ge=0.2, le=30.0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    job = _collect_device_configuration(db, device, current_user, credential_id=ssh_credential_id, timeout=timeout)
    db.commit()
    db.refresh(device)
    return {"message": "collected", "data": _serialize_device(device, db), "job_id": job.id}


@router.post("/{device_id}/terminal", response_model=dict)
def run_device_terminal_command(
    device_id: int,
    payload: DeviceTerminalRequest,
    ssh_credential_id: int | None = None,
    timeout: float = Query(default=8.0, ge=0.2, le=30.0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    if not device.management_ip:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Device has no management IP")

    commands = _terminal_commands(payload)
    credential_id = ssh_credential_id or device.ssh_credential_id
    if not credential_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Select an SSH credential profile for this device first")
    profile = db.query(CredentialProfile).filter(CredentialProfile.id == credential_id).first()
    if not profile or profile.credential_type != "ssh":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SSH credential profile not found")
    if not profile.username or not profile.secret_encrypted:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="SSH credential profile requires username and password")

    job = start_job(db, "device_terminal_command", device.management_ip, current_user.email, {
        "device_id": device.id,
        "device_name": device.name,
        "ssh_credential_id": credential_id,
        "timeout": timeout,
        "command_count": len(commands),
    })
    collector = SshConfigurationCollector(
        username=profile.username,
        password=decrypt_secret(profile.secret_encrypted),
        enable_password=decrypt_secret(profile.enable_secret_encrypted),
        port=profile.port or 22,
        timeout=timeout,
    )
    try:
        result = collector.execute(device.management_ip, commands, device.platform or "", enable=payload.enable)
    except Exception as exc:
        fail_job(db, job, str(exc))
        db.commit()
        raise

    status_text = result.status if not result.error else f"{result.status} {result.error}"
    if result.error:
        fail_job(db, job, status_text, {
            "device_id": device.id,
            "device_name": device.name,
            "status": status_text,
            "bytes": len(result.snapshot or ""),
        })
    else:
        complete_job(db, job, {
            "device_id": device.id,
            "device_name": device.name,
            "status": status_text,
            "bytes": len(result.snapshot or ""),
        })
        device.last_seen_at = datetime.now(timezone.utc)
    _audit(db, current_user, "device_terminal_command", device.id, {
        "device": device.name,
        "management_ip": device.management_ip,
        "ssh_credential_id": credential_id,
        "command_count": len(commands),
        "status": status_text,
        "bytes": len(result.snapshot or ""),
        "job_id": job.id,
    })
    db.commit()
    db.refresh(device)
    return {
        "message": "executed",
        "data": {
            "device": _serialize_device(device, db),
            "output": result.snapshot,
            "status": status_text,
            "job_id": job.id,
        },
        "job_id": job.id,
    }


@router.websocket("/{device_id}/terminal-stream")
async def stream_device_terminal(
    websocket: WebSocket,
    device_id: int,
    token: str = "",
    width: int = 220,
    height: int = 40,
):
    await websocket.accept()
    db = SessionLocal()
    client = None
    channel = None
    job = None
    disconnected = False
    try:
        current_user = _websocket_user(db, token)
        if not current_user:
            await websocket.send_text(json.dumps({"type": "error", "message": "Invalid or expired terminal token."}))
            await websocket.close(code=1008)
            return

        device = db.query(Device).filter(Device.id == device_id).first()
        if not device:
            await websocket.send_text(json.dumps({"type": "error", "message": "Device not found."}))
            await websocket.close(code=1008)
            return
        if not device.management_ip:
            await websocket.send_text(json.dumps({"type": "error", "message": "Device has no management IP."}))
            await websocket.close(code=1008)
            return
        if not device.ssh_credential_id:
            await websocket.send_text(json.dumps({"type": "error", "message": "Select an SSH credential profile for this device first."}))
            await websocket.close(code=1008)
            return

        profile = db.query(CredentialProfile).filter(CredentialProfile.id == device.ssh_credential_id).first()
        if not profile or profile.credential_type != "ssh" or not profile.username or not profile.secret_encrypted:
            await websocket.send_text(json.dumps({"type": "error", "message": "Valid SSH credential profile not found."}))
            await websocket.close(code=1008)
            return

        job = start_job(db, "device_live_terminal", device.management_ip, current_user.email, {
            "device_id": device.id,
            "device_name": device.name,
            "ssh_credential_id": device.ssh_credential_id,
        })
        collector = SshConfigurationCollector(
            username=profile.username,
            password=decrypt_secret(profile.secret_encrypted),
            enable_password=decrypt_secret(profile.enable_secret_encrypted),
            port=profile.port or 22,
            timeout=8,
        )
        try:
            client, channel = collector.open_interactive_shell(device.management_ip, device.platform or "", enable=True, width=width, height=height)
        except Exception as exc:
            fail_job(db, job, str(exc))
            db.commit()
            await websocket.send_text(json.dumps({"type": "error", "message": f"SSH connection failed: {exc}"}))
            await websocket.close(code=1011)
            return

        await websocket.send_text(json.dumps({"type": "status", "message": f"Connected to {device.name} ({device.management_ip})."}))
        device.last_seen_at = datetime.now(timezone.utc)
        db.commit()

        stop_event = asyncio.Event()

        async def ssh_reader() -> None:
            while not stop_event.is_set():
                if channel.exit_status_ready() or channel.closed:
                    stop_event.set()
                    break
                chunks = []
                while channel.recv_ready():
                    chunks.append(channel.recv(65535).decode("utf-8", errors="replace"))
                if chunks:
                    await websocket.send_text(json.dumps({"type": "output", "data": "".join(chunks)}))
                    await asyncio.sleep(0)
                    continue
                await asyncio.sleep(0.001)

        async def websocket_reader() -> None:
            nonlocal disconnected
            while not stop_event.is_set():
                try:
                    incoming = await websocket.receive_text()
                except WebSocketDisconnect:
                    disconnected = True
                    stop_event.set()
                    break
                try:
                    payload = json.loads(incoming)
                except ValueError:
                    payload = {"type": "input", "data": incoming}

                if payload.get("type") == "input":
                    data = str(payload.get("data", ""))
                    if data:
                        channel.send(data)
                elif payload.get("type") == "resize":
                    channel.resize_pty(width=int(payload.get("width") or width), height=int(payload.get("height") or height))
                elif payload.get("type") == "close":
                    stop_event.set()
                    break

        reader_task = asyncio.create_task(ssh_reader())
        input_task = asyncio.create_task(websocket_reader())
        done, pending = await asyncio.wait({reader_task, input_task}, return_when=asyncio.FIRST_COMPLETED)
        stop_event.set()
        for task in pending:
            task.cancel()
        for task in done:
            task.result()

        if job:
            complete_job(db, job, {"device_id": device_id, "status": "Live terminal closed"})
        _audit(db, current_user, "device_live_terminal", device_id, {"device": device.name, "management_ip": device.management_ip, "status": "closed"})
        db.commit()
        if not disconnected:
            await websocket.send_text(json.dumps({"type": "closed", "message": "Terminal session closed."}))
            await websocket.close(code=1000)
    except Exception as exc:
        if job:
            fail_job(db, job, str(exc))
            db.commit()
        if not disconnected:
            try:
                await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))
                await websocket.close(code=1011)
            except Exception:
                pass
    finally:
        try:
            if channel:
                channel.close()
        except Exception:
            pass
        try:
            if client:
                client.close()
        except Exception:
            pass
        db.close()


@router.get("/{device_id}/environment", response_model=dict)
def get_device_environment(device_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    if not device.management_ip:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Device management IP is required for SNMP environment polling")
    community, port, source = _device_snmp_config(db, device)
    if not community:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="SNMP community/profile is not configured for this device")
    client = SnmpClient(device.management_ip, community, port=port, timeout=1.2)
    try:
        sensors = _collect_entity_environment(client)
        cisco_temperature = _collect_cisco_temperature_environment(client)
        if cisco_temperature:
            sensors = [sensor for sensor in sensors if sensor.get("metric") != "temperature"]
            sensors.extend(cisco_temperature)
        sensors.extend(_collect_cisco_fan_environment(client))
        sensors.extend(_collect_cisco_power_supply_environment(client))
    except SnmpTimeout as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=f"SNMP environment polling timed out: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"SNMP environment polling failed: {exc}") from exc
    summary = _summarize_environment(sensors)
    return {
        "message": "ok",
        "data": {
            "device_id": device.id,
            "source": source,
            "snmp_port": port,
            **summary,
        },
    }


@router.get("/{device_id}", response_model=dict)
def get_device(device_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return {"message": "ok", "data": _serialize_device(device, db)}


@router.post("", response_model=dict)
def create_device(payload: DeviceCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    values = _device_values(payload)
    _validate_unique(db, values)
    device = Device(**values)
    db.add(device)
    db.commit()
    db.refresh(device)
    _audit(db, current_user, "create_device", device.id, {"name": device.name, "management_ip": device.management_ip})
    auto_collection = None
    if device.management_ip and device.ssh_credential_id:
        try:
            job = _collect_device_configuration(
                db,
                device,
                current_user,
                credential_id=device.ssh_credential_id,
                timeout=8.0,
                job_type="device_initial_config_collection",
                audit_action="auto_collect_device_config",
            )
            auto_collection = {"job_id": job.id, "status": device.config_status}
        except HTTPException as exc:
            device.config_status = f"Automatic SSH collection skipped: {exc.detail}"
            auto_collection = {"status": device.config_status}
        except Exception as exc:
            device.config_status = f"Automatic SSH collection failed: {exc}"
            auto_collection = {"status": device.config_status}
    db.commit()
    db.refresh(device)
    response = {"message": "created", "data": _serialize_device(device, db)}
    if auto_collection:
        response["auto_collection"] = auto_collection
    return response


@router.patch("/{device_id}", response_model=dict)
def update_device(device_id: int, payload: DeviceUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    values = _device_values(payload)
    _validate_unique(db, values, device_id=device_id)
    changed = {}
    for field, value in values.items():
        if value is not None or field in NULLABLE_UPDATE_FIELDS:
            changed[field] = value
            setattr(device, field, value)
    _audit(db, current_user, "update_device", device.id, changed)
    db.commit()
    db.refresh(device)
    return {"message": "updated", "data": _serialize_device(device, db)}


@router.delete("/{device_id}", response_model=dict)
def delete_device(device_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    removed_topology_links = _delete_topology_links_for_devices(db, [device.id])
    _audit(db, current_user, "delete_device", device.id, {
        "name": device.name,
        "management_ip": device.management_ip,
        "topology_links_deleted": removed_topology_links,
    })
    db.delete(device)
    db.commit()
    return {"message": "deleted", "data": {"id": device_id, "topology_links_deleted": removed_topology_links}}
