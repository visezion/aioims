import re
import socket
from dataclasses import dataclass
from typing import Any


SYSTEM_OIDS = {
    "description": "1.3.6.1.2.1.1.1.0",
    "object_id": "1.3.6.1.2.1.1.2.0",
    "name": "1.3.6.1.2.1.1.5.0",
}

IF_DESCR = "1.3.6.1.2.1.2.2.1.2"
IF_NAME = "1.3.6.1.2.1.31.1.1.1.1"
IF_STACK_STATUS = "1.3.6.1.2.1.31.1.2.1.3"
IF_TYPE = "1.3.6.1.2.1.2.2.1.3"
IF_MTU = "1.3.6.1.2.1.2.2.1.4"
IF_SPEED = "1.3.6.1.2.1.2.2.1.5"
IF_PHYS_ADDRESS = "1.3.6.1.2.1.2.2.1.6"
IF_ADMIN_STATUS = "1.3.6.1.2.1.2.2.1.7"
IF_OPER_STATUS = "1.3.6.1.2.1.2.2.1.8"
IP_ADDRESS_IF_INDEX = "1.3.6.1.2.1.4.20.1.2"
IP_NET_TO_MEDIA_PHYS_ADDRESS = "1.3.6.1.2.1.4.22.1.2"
IP_NET_TO_PHYSICAL_PHYS_ADDRESS = "1.3.6.1.2.1.4.35.1.4"
DOT1D_BASE_PORT_IF_INDEX = "1.3.6.1.2.1.17.1.4.1.2"
DOT1D_TP_FDB_PORT = "1.3.6.1.2.1.17.4.3.1.2"
DOT1Q_TP_FDB_PORT = "1.3.6.1.2.1.17.7.1.2.2.1.2"
DOT1Q_VLAN_STATIC_NAME = "1.3.6.1.2.1.17.7.1.4.3.1.1"
DOT1Q_VLAN_STATIC_EGRESS_PORTS = "1.3.6.1.2.1.17.7.1.4.3.1.2"
DOT1Q_VLAN_STATIC_UNTAGGED_PORTS = "1.3.6.1.2.1.17.7.1.4.3.1.4"
LLDP_LOC_PORT_ID = "1.0.8802.1.1.2.1.3.7.1.3"
LLDP_LOC_PORT_DESC = "1.0.8802.1.1.2.1.3.7.1.4"
LLDP_REM_CHASSIS_ID = "1.0.8802.1.1.2.1.4.1.1.5"
LLDP_REM_PORT_ID = "1.0.8802.1.1.2.1.4.1.1.7"
LLDP_REM_PORT_DESC = "1.0.8802.1.1.2.1.4.1.1.8"
LLDP_REM_SYSTEM_NAME = "1.0.8802.1.1.2.1.4.1.1.9"
LLDP_REM_SYSTEM_DESC = "1.0.8802.1.1.2.1.4.1.1.10"
LLDP_REM_MAN_ADDR_IF_SUBTYPE = "1.0.8802.1.1.2.1.4.2.1.3"
CDP_CACHE_ADDRESS = "1.3.6.1.4.1.9.9.23.1.2.1.1.4"
CDP_CACHE_DEVICE_ID = "1.3.6.1.4.1.9.9.23.1.2.1.1.6"
CDP_CACHE_DEVICE_PORT = "1.3.6.1.4.1.9.9.23.1.2.1.1.7"
CDP_CACHE_PLATFORM = "1.3.6.1.4.1.9.9.23.1.2.1.1.8"

IF_STATUS = {
    1: "up",
    2: "down",
    3: "testing",
    4: "unknown",
    5: "dormant",
    6: "notPresent",
    7: "lowerLayerDown",
}

IF_TYPES = {
    1: "other",
    6: "ethernet",
    24: "loopback",
    53: "propVirtual",
    71: "wifi",
    131: "tunnel",
    135: "l2vlan",
    136: "l3ipvlan",
    161: "ieee8023adLag",
}


@dataclass
class SnmpValue:
    oid: str
    tag: int
    raw: bytes
    value: Any


class SnmpError(Exception):
    pass


class SnmpTimeout(SnmpError):
    pass


class SnmpClient:
    def __init__(self, host: str, community: str, port: int = 161, timeout: float = 0.8, retries: int = 0) -> None:
        self.host = host
        self.community = community
        self.port = port
        self.timeout = timeout
        self.retries = retries
        self._request_id = 1000

    def get(self, oid: str) -> SnmpValue | None:
        values = self._request(0xA0, oid)
        return values[0] if values else None

    def get_next(self, oid: str) -> SnmpValue | None:
        values = self._request(0xA1, oid)
        return values[0] if values else None

    def walk(self, base_oid: str, limit: int = 200) -> list[SnmpValue]:
        rows: list[SnmpValue] = []
        current = base_oid
        prefix = _oid_tuple(base_oid)
        for _ in range(limit):
            try:
                value = self.get_next(current)
            except SnmpTimeout:
                break
            if not value:
                break
            value_oid = _oid_tuple(value.oid)
            if value_oid[: len(prefix)] != prefix or value_oid == prefix:
                break
            rows.append(value)
            current = value.oid
        return rows

    def _request(self, pdu_type: int, oid: str) -> list[SnmpValue]:
        self._request_id += 1
        packet = _sequence(
            _integer(1)
            + _octet_string(self.community.encode("utf-8"))
            + bytes([pdu_type])
            + _length(
                _integer(self._request_id)
                + _integer(0)
                + _integer(0)
                + _sequence(_sequence(_oid(oid) + _null()))
            )
        )
        last_error: OSError | None = None
        for _ in range(self.retries + 1):
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
                    client.settimeout(self.timeout)
                    client.sendto(packet, (self.host, self.port))
                    data, _ = client.recvfrom(65535)
                    return _parse_response(data)
            except socket.timeout as exc:
                last_error = exc
            except OSError as exc:
                if getattr(exc, "winerror", None) == 10054 or isinstance(exc, ConnectionResetError):
                    last_error = SnmpTimeout("UDP/161 was rejected by the target or network. Check SNMP service, ACL, firewall, and source IP.")
                    break
                last_error = exc
                break
        if last_error:
            raise SnmpTimeout(str(last_error))
        raise SnmpTimeout("SNMP request timed out")


class SnmpDiscoveryService:
    def __init__(self, community: str, port: int = 161, timeout: float = 0.8) -> None:
        self.community = community.strip()
        self.port = port or 161
        self.timeout = timeout

    def discover_device(self, host: str) -> dict[str, Any]:
        if not self.community:
            return {
                "snmp_status": "Not configured",
                "snmp_last_error": "Set the SNMP community in Configuration before scanning.",
                "config_status": "Not collected",
            }

        client = SnmpClient(host, self.community, port=self.port, timeout=self.timeout)
        try:
            first = client.get(SYSTEM_OIDS["description"])
        except SnmpTimeout as exc:
            return {
                "snmp_status": "No response",
                "snmp_last_error": f"SNMP timeout or blocked on UDP/{self.port}: {exc}",
                "config_status": "Not collected",
            }
        except Exception as exc:
            return {
                "snmp_status": "Error",
                "snmp_last_error": str(exc),
                "config_status": "Not collected",
            }

        system = {"description": _value_to_text(first)}
        for key, oid in SYSTEM_OIDS.items():
            if key == "description":
                continue
            try:
                system[key] = _value_to_text(client.get(oid))
            except SnmpError:
                system[key] = ""

        interfaces = self._collect_interfaces(client)
        if_names = {item["index"]: item["name"] for item in interfaces if "index" in item and item.get("name")}
        vlans = self._collect_vlans(client, if_names)
        neighbors = self._collect_lldp_neighbors(client) + self._collect_cdp_neighbors(client, if_names)
        object_id = system.get("object_id", "")
        description = system.get("description", "")
        manufacturer = _vendor_from_oid(object_id)
        platform_name = _platform_from_description(description)
        model_name = _model_from_description(description)

        return {
            "snmp_status": "OK",
            "snmp_last_error": "",
            "snmp_system": system,
            "hostname": system.get("name", ""),
            "platform": platform_name or description[:100],
            "manufacturer": manufacturer,
            "model": model_name,
            "description": description,
            "interfaces": interfaces,
            "vlans": vlans,
            "neighbors": neighbors,
            "config_status": "SNMP collected inventory. Running configuration requires SSH/Telnet/API credentials.",
            "configuration_snapshot": "",
        }

    def _collect_interfaces(self, client: SnmpClient) -> list[dict[str, Any]]:
        tables = {
            "name": _walk_by_index(client, IF_DESCR),
            "type": _walk_by_index(client, IF_TYPE),
            "mtu": _walk_by_index(client, IF_MTU),
            "speed": _walk_by_index(client, IF_SPEED),
            "mac": _walk_by_index(client, IF_PHYS_ADDRESS),
            "admin_status": _walk_by_index(client, IF_ADMIN_STATUS),
            "oper_status": _walk_by_index(client, IF_OPER_STATUS),
        }
        ips_by_index: dict[int, list[str]] = {}
        for item in client.walk(IP_ADDRESS_IF_INDEX, limit=512):
            parts = _oid_tuple(item.oid)
            base_len = len(_oid_tuple(IP_ADDRESS_IF_INDEX))
            if len(parts) < base_len + 4 or not isinstance(item.value, int):
                continue
            ip = ".".join(str(part) for part in parts[base_len:base_len + 4])
            ips_by_index.setdefault(item.value, []).append(ip)

        indexes = sorted({index for table in tables.values() for index in table.keys()})
        interfaces = []
        for index in indexes:
            name = _as_string(tables["name"].get(index)) or f"if{index}"
            oper_status = _status_name(tables["oper_status"].get(index))
            admin_status = _status_name(tables["admin_status"].get(index))
            if_type = _type_name(tables["type"].get(index))
            item = {
                "index": index,
                "name": name,
                "ip": ", ".join(ips_by_index.get(index, [])),
                "status": oper_status or admin_status or "unknown",
                "admin_status": admin_status,
                "oper_status": oper_status,
                "mac": _mac_text(tables["mac"].get(index)),
                "type": if_type,
                "mtu": tables["mtu"].get(index).value if tables["mtu"].get(index) else None,
                "speed": tables["speed"].get(index).value if tables["speed"].get(index) else None,
                "source": "snmp",
            }
            interfaces.append({key: value for key, value in item.items() if value not in (None, "")})
        return interfaces

    def _collect_vlans(self, client: SnmpClient, if_names: dict[int, str] | None = None) -> list[dict[str, Any]]:
        if_names = if_names or {}
        bridge_to_if = _bridge_port_if_indexes(client)
        egress_ports = _walk_by_index(client, DOT1Q_VLAN_STATIC_EGRESS_PORTS)
        untagged_ports = _walk_by_index(client, DOT1Q_VLAN_STATIC_UNTAGGED_PORTS)
        rows = []
        for item in client.walk(DOT1Q_VLAN_STATIC_NAME, limit=512):
            vlan_id = _oid_tuple(item.oid)[-1]
            egress_bridge_ports = _decode_port_bitmap(egress_ports.get(vlan_id))
            untagged_bridge_ports = set(_decode_port_bitmap(untagged_ports.get(vlan_id)))
            ports = []
            for bridge_port in egress_bridge_ports:
                if_index = bridge_to_if.get(bridge_port)
                name = if_names.get(if_index or 0) or f"bridge-port-{bridge_port}"
                ports.append({
                    "name": name,
                    "mode": "untagged" if bridge_port in untagged_bridge_ports else "tagged",
                    "bridge_port": bridge_port,
                    "if_index": if_index,
                    "source": "snmp",
                })
            row = {"id": vlan_id, "name": _as_string(item) or f"VLAN {vlan_id}", "source": "snmp"}
            if ports:
                row["ports"] = ports
            rows.append(row)
        return rows

    def _collect_lldp_neighbors(self, client: SnmpClient) -> list[dict[str, Any]]:
        local_ports = _walk_by_index(client, LLDP_LOC_PORT_DESC)
        if not local_ports:
            local_ports = _walk_by_index(client, LLDP_LOC_PORT_ID)
        chassis = _walk_by_suffix(client, LLDP_REM_CHASSIS_ID)
        names = _walk_by_suffix(client, LLDP_REM_SYSTEM_NAME)
        port_ids = _walk_by_suffix(client, LLDP_REM_PORT_ID)
        port_descriptions = _walk_by_suffix(client, LLDP_REM_PORT_DESC)
        descriptions = _walk_by_suffix(client, LLDP_REM_SYSTEM_DESC)
        management_addresses = self._collect_lldp_management_addresses(client)

        neighbors = []
        for suffix, chassis_value in chassis.items():
            if len(suffix) < 3:
                continue
            local_port_num = suffix[1]
            remote_name = _as_string(names.get(suffix)) or _as_string(chassis_value)
            remote_interface = _as_string(port_descriptions.get(suffix)) or _as_string(port_ids.get(suffix))
            item = {
                "protocol": "lldp",
                "local_interface": _as_string(local_ports.get(local_port_num)) or f"port-{local_port_num}",
                "remote_name": remote_name,
                "remote_interface": remote_interface,
                "remote_chassis_id": _as_string(chassis_value),
                "remote_ip": management_addresses.get(suffix, ""),
                "remote_description": _as_string(descriptions.get(suffix)),
            }
            neighbors.append({key: value for key, value in item.items() if value not in (None, "")})
        return neighbors

    def _collect_lldp_management_addresses(self, client: SnmpClient) -> dict[tuple[int, ...], str]:
        addresses: dict[tuple[int, ...], str] = {}
        base_len = len(_oid_tuple(LLDP_REM_MAN_ADDR_IF_SUBTYPE))
        for item in client.walk(LLDP_REM_MAN_ADDR_IF_SUBTYPE, limit=512):
            suffix = _oid_tuple(item.oid)[base_len:]
            if len(suffix) < 6:
                continue
            neighbor_key = suffix[:3]
            subtype = suffix[3]
            address_length = suffix[4]
            raw_address = suffix[5:5 + address_length]
            if subtype == 1 and address_length == 4:
                addresses[neighbor_key] = ".".join(str(part) for part in raw_address)
            elif subtype == 2 and address_length == 16:
                groups = [raw_address[index] * 256 + raw_address[index + 1] for index in range(0, 16, 2)]
                addresses[neighbor_key] = ":".join(f"{group:x}" for group in groups)
        return addresses

    def _collect_cdp_neighbors(self, client: SnmpClient, if_names: dict[int, str]) -> list[dict[str, Any]]:
        names = _walk_by_suffix(client, CDP_CACHE_DEVICE_ID)
        ports = _walk_by_suffix(client, CDP_CACHE_DEVICE_PORT)
        platforms = _walk_by_suffix(client, CDP_CACHE_PLATFORM)
        addresses = _walk_by_suffix(client, CDP_CACHE_ADDRESS)

        neighbors = []
        for suffix, name_value in names.items():
            if len(suffix) < 2:
                continue
            if_index = suffix[0]
            item = {
                "protocol": "cdp",
                "local_interface": if_names.get(if_index, f"if{if_index}"),
                "remote_name": _as_string(name_value),
                "remote_interface": _as_string(ports.get(suffix)),
                "remote_ip": _ip_text(addresses.get(suffix)),
                "remote_description": _as_string(platforms.get(suffix)),
            }
            neighbors.append({key: value for key, value in item.items() if value not in (None, "")})
        return neighbors


class SnmpLayer2TraceService:
    """Resolves an IP through ARP and finds a MAC in a switch forwarding table."""

    def __init__(self, community: str, port: int = 161, timeout: float = 0.4) -> None:
        self.community = community.strip()
        self.port = port or 161
        self.timeout = timeout
        self.last_arp_if_index: int | None = None
        self.last_arp_interface = ""

    def resolve_ip_mac(self, host: str, target_ip: str) -> str:
        if not self.community:
            return ""
        client = SnmpClient(host, self.community, port=self.port, timeout=self.timeout)
        target_parts = tuple(int(part) for part in target_ip.split(".")) if _is_ipv4(target_ip) else ()
        if not target_parts:
            return ""
        for oid in [IP_NET_TO_PHYSICAL_PHYS_ADDRESS, IP_NET_TO_MEDIA_PHYS_ADDRESS]:
            try:
                # ARP tables on backbone routers often exceed the normal inventory walk cap.
                for item in client.walk(oid, limit=4096):
                    suffix = _oid_tuple(item.oid)[len(_oid_tuple(oid)):]
                    if suffix[-4:] != target_parts:
                        continue
                    mac = _mac_text(item)
                    if _normalize_mac(mac):
                        self.last_arp_if_index = suffix[-5] if oid == IP_NET_TO_MEDIA_PHYS_ADDRESS and len(suffix) >= 5 else (suffix[0] if suffix else None)
                        if self.last_arp_if_index:
                            try:
                                interface = client.get(f"{IF_DESCR}.{self.last_arp_if_index}")
                                self.last_arp_interface = _as_string(interface) or f"if{self.last_arp_if_index}"
                            except SnmpError:
                                self.last_arp_interface = f"if{self.last_arp_if_index}"
                        return mac
            except SnmpError:
                continue
        return ""

    def discover_vlan_ids(self, host: str) -> list[int]:
        """Return configured VLAN IDs from Q-BRIDGE when the device exposes them."""
        if not self.community:
            return []
        client = SnmpClient(host, self.community, port=self.port, timeout=self.timeout)
        vlan_ids: set[int] = set()
        try:
            for item in client.walk(DOT1Q_VLAN_STATIC_NAME, limit=1024):
                vlan_id = _oid_tuple(item.oid)[-1]
                if 1 <= vlan_id <= 4094:
                    vlan_ids.add(vlan_id)
        except SnmpError:
            pass
        return sorted(vlan_ids)

    def find_mac_port(
        self,
        host: str,
        mac_address: str,
        vlan: int | None = None,
        vlan_ids: list[int] | None = None,
        cisco_vlan_context: bool = False,
    ) -> list[dict[str, Any]]:
        if not self.community:
            return []
        target_mac = _normalize_mac(mac_address)
        if len(target_mac) != 12:
            return []
        client = SnmpClient(host, self.community, port=self.port, timeout=self.timeout)
        try:
            if_names = {index: _as_string(value) or f"if{index}" for index, value in _walk_by_index(client, IF_DESCR).items()}
            bridge_to_if = _bridge_port_if_indexes(client)
        except SnmpError:
            return []

        matches: list[dict[str, Any]] = []
        seen: set[tuple[int, int | None]] = set()
        target_suffix = ".".join(str(int(target_mac[index:index + 2], 16)) for index in range(0, 12, 2))
        try:
            direct_port = client.get(f"{DOT1D_TP_FDB_PORT}.{target_suffix}")
            if direct_port and isinstance(direct_port.value, int):
                bridge_port = direct_port.value
                if_index = bridge_to_if.get(bridge_port)
                seen.add((bridge_port, None))
                matches.append({
                    "bridge_port": bridge_port,
                    "if_index": if_index,
                    "interface": if_names.get(if_index or 0) or f"bridge-port-{bridge_port}",
                    "vlan": None,
                })
        except SnmpError:
            pass

        # A routed ARP lookup often identifies the VLAN. Query that exact Q-BRIDGE
        # entry first instead of relying on a bounded walk of a large MAC table.
        if vlan and vlan > 0:
            try:
                vlan_port = client.get(f"{DOT1Q_TP_FDB_PORT}.{vlan}.{target_suffix}")
                if vlan_port and isinstance(vlan_port.value, int):
                    bridge_port = vlan_port.value
                    if_index = bridge_to_if.get(bridge_port)
                    identity = (bridge_port, vlan)
                    if identity not in seen:
                        seen.add(identity)
                        matches.append({
                            "bridge_port": bridge_port,
                            "if_index": if_index,
                            "interface": if_names.get(if_index or 0) or f"bridge-port-{bridge_port}",
                            "vlan": vlan,
                        })
            except SnmpError:
                pass

        if not matches and cisco_vlan_context:
            contexts = {item for item in (vlan_ids or []) if 1 <= item <= 4094}
            if vlan and vlan > 0:
                contexts.add(vlan)
            for vlan_id in sorted(contexts):
                match = self._find_cisco_vlan_context_mac_port(host, target_suffix, vlan_id)
                if match:
                    matches.append(match)

        # Non-Cisco devices may only expose a walkable Q-BRIDGE table. Cisco IOS
        # devices with VLAN contexts are intentionally not walked here: the exact
        # community@VLAN lookup above is faster and avoids huge base FDB tables.
        if not matches and not cisco_vlan_context:
            for oid, has_vlan_index in [(DOT1Q_TP_FDB_PORT, True), (DOT1D_TP_FDB_PORT, False)]:
                try:
                    rows = client.walk(oid, limit=8192)
                except SnmpError:
                    continue
                prefix_length = len(_oid_tuple(oid))
                for item in rows:
                    suffix = _oid_tuple(item.oid)[prefix_length:]
                    if len(suffix) < 6 or _oid_mac(suffix[-6:]) != target_mac or not isinstance(item.value, int):
                        continue
                    found_vlan = suffix[-7] if has_vlan_index and len(suffix) >= 7 else None
                    bridge_port = item.value
                    if_index = bridge_to_if.get(bridge_port)
                    identity = (bridge_port, found_vlan)
                    if identity in seen:
                        continue
                    seen.add(identity)
                    matches.append({
                        "bridge_port": bridge_port,
                        "if_index": if_index,
                        "interface": if_names.get(if_index or 0) or f"bridge-port-{bridge_port}",
                        "vlan": found_vlan,
                    })
        for match in matches:
            if match.get("if_index") and _is_lag_interface(match.get("interface")):
                match["member_interfaces"] = _lag_member_interface_names(client, match["if_index"], if_names)
        return matches

    def _find_cisco_vlan_context_mac_port(self, host: str, target_suffix: str, vlan_id: int) -> dict[str, Any] | None:
        # Cisco IOS may expose BRIDGE-MIB only through community@VLAN contexts.
        base_community = self.community.split("@", 1)[0]
        client = SnmpClient(host, f"{base_community}@{vlan_id}", port=self.port, timeout=self.timeout)
        try:
            port_value = client.get(f"{DOT1D_TP_FDB_PORT}.{target_suffix}")
            if not port_value or not isinstance(port_value.value, int):
                return None
            bridge_port = port_value.value
            bridge_to_if = _bridge_port_if_indexes(client)
            if_names = {index: _as_string(value) or f"if{index}" for index, value in _walk_by_index(client, IF_NAME).items()}
            if not if_names:
                if_names = {index: _as_string(value) or f"if{index}" for index, value in _walk_by_index(client, IF_DESCR).items()}
        except SnmpError:
            return None
        if_index = bridge_to_if.get(bridge_port)
        return {
            "bridge_port": bridge_port,
            "if_index": if_index,
            "interface": if_names.get(if_index or 0) or f"bridge-port-{bridge_port}",
            "vlan": vlan_id,
            "lookup": "cisco-vlan-community",
            "community_context": f"@{vlan_id}",
            "member_interfaces": _lag_member_interface_names(client, if_index, if_names),
        }


def _walk_by_index(client: SnmpClient, base_oid: str) -> dict[int, SnmpValue]:
    values = {}
    for item in client.walk(base_oid, limit=512):
        values[_oid_tuple(item.oid)[-1]] = item
    return values


def _is_ipv4(value: str) -> bool:
    parts = value.split(".")
    try:
        return len(parts) == 4 and all(0 <= int(part) <= 255 for part in parts)
    except ValueError:
        return False


def _normalize_mac(value: str) -> str:
    return "".join(character for character in str(value).lower() if character in "0123456789abcdef")


def _oid_mac(parts: tuple[int, ...]) -> str:
    return "".join(f"{part:02x}" for part in parts)


def _bridge_port_if_indexes(client: SnmpClient) -> dict[int, int]:
    mapping: dict[int, int] = {}
    for item in client.walk(DOT1D_BASE_PORT_IF_INDEX, limit=1024):
        bridge_port = _oid_tuple(item.oid)[-1]
        if isinstance(item.value, int):
            mapping[bridge_port] = item.value
    return mapping


def _lag_member_interface_names(client: SnmpClient, if_index: int | None, if_names: dict[int, str]) -> list[str]:
    if not if_index:
        return []
    members = []
    try:
        base_length = len(_oid_tuple(IF_STACK_STATUS))
        for item in client.walk(IF_STACK_STATUS, limit=2048):
            suffix = _oid_tuple(item.oid)[base_length:]
            if len(suffix) != 2:
                continue
            higher_index, lower_index = suffix
            if higher_index == if_index and lower_index > 0:
                members.append(if_names.get(lower_index, f"if{lower_index}"))
    except SnmpError:
        return []
    return members


def _is_lag_interface(name: Any) -> bool:
    value = str(name or "").strip().lower()
    return value.startswith(("po", "port-channel", "portchannel", "bundle-ether"))


def _decode_port_bitmap(value: SnmpValue | None) -> list[int]:
    if not value or not isinstance(value.value, bytes):
        return []
    ports = []
    for byte_index, byte in enumerate(value.value):
        for bit_index in range(8):
            if byte & (1 << (7 - bit_index)):
                ports.append(byte_index * 8 + bit_index + 1)
    return ports


def _walk_by_suffix(client: SnmpClient, base_oid: str) -> dict[tuple[int, ...], SnmpValue]:
    values = {}
    base_len = len(_oid_tuple(base_oid))
    for item in client.walk(base_oid, limit=512):
        values[_oid_tuple(item.oid)[base_len:]] = item
    return values


def _parse_response(data: bytes) -> list[SnmpValue]:
    tag, body, offset = _read_tlv(data, 0)
    if tag != 0x30 or offset != len(data):
        raise SnmpError("Invalid SNMP response")
    reader = BerReader(body)
    reader.read_tlv()
    reader.read_tlv()
    pdu_tag, pdu = reader.read_tlv()
    if pdu_tag not in (0xA2, 0xA5):
        raise SnmpError("Unexpected SNMP PDU")
    pdu_reader = BerReader(pdu)
    pdu_reader.read_tlv()
    _, error_status_raw = pdu_reader.read_tlv()
    _, error_index_raw = pdu_reader.read_tlv()
    error_status = _decode_integer(error_status_raw)
    error_index = _decode_integer(error_index_raw)
    if error_status:
        raise SnmpError(f"SNMP agent returned error {error_status} at index {error_index}")
    _, varbind_list = pdu_reader.read_tlv()
    varbinds = BerReader(varbind_list)
    values = []
    while not varbinds.eof:
        _, varbind = varbinds.read_tlv()
        item_reader = BerReader(varbind)
        _, oid_raw = item_reader.read_tlv()
        value_tag, value_raw = item_reader.read_tlv()
        if value_tag in (0x80, 0x81, 0x82):
            continue
        values.append(SnmpValue(_decode_oid(oid_raw), value_tag, value_raw, _decode_value(value_tag, value_raw)))
    return values


class BerReader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.offset = 0

    @property
    def eof(self) -> bool:
        return self.offset >= len(self.data)

    def read_tlv(self) -> tuple[int, bytes]:
        tag, value, offset = _read_tlv(self.data, self.offset)
        self.offset = offset
        return tag, value


def _read_tlv(data: bytes, offset: int) -> tuple[int, bytes, int]:
    if offset >= len(data):
        raise SnmpError("Unexpected end of BER data")
    tag = data[offset]
    offset += 1
    if offset >= len(data):
        raise SnmpError("Missing BER length")
    first_length = data[offset]
    offset += 1
    if first_length & 0x80:
        length_size = first_length & 0x7F
        if length_size == 0 or offset + length_size > len(data):
            raise SnmpError("Invalid BER length")
        length = int.from_bytes(data[offset:offset + length_size], "big")
        offset += length_size
    else:
        length = first_length
    end = offset + length
    if end > len(data):
        raise SnmpError("BER value exceeds packet length")
    return tag, data[offset:end], end


def _sequence(value: bytes) -> bytes:
    return b"\x30" + _length(value)


def _integer(value: int) -> bytes:
    if value == 0:
        raw = b"\x00"
    else:
        raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
        if raw[0] & 0x80:
            raw = b"\x00" + raw
    return b"\x02" + _length(raw)


def _octet_string(value: bytes) -> bytes:
    return b"\x04" + _length(value)


def _null() -> bytes:
    return b"\x05\x00"


def _oid(value: str) -> bytes:
    parts = _oid_tuple(value)
    if len(parts) < 2:
        raise SnmpError("OID must contain at least two numbers")
    raw = bytes([parts[0] * 40 + parts[1]])
    for part in parts[2:]:
        raw += _base128(part)
    return b"\x06" + _length(raw)


def _length(value: bytes) -> bytes:
    length = len(value)
    if length < 0x80:
        return bytes([length]) + value
    raw = length.to_bytes((length.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(raw)]) + raw + value


def _base128(value: int) -> bytes:
    encoded = [value & 0x7F]
    value >>= 7
    while value:
        encoded.insert(0, 0x80 | (value & 0x7F))
        value >>= 7
    return bytes(encoded)


def _decode_integer(raw: bytes, signed: bool = True) -> int:
    return int.from_bytes(raw or b"\x00", "big", signed=signed)


def _decode_oid(raw: bytes) -> str:
    if not raw:
        return ""
    first = raw[0]
    parts = [first // 40, first % 40]
    value = 0
    for byte in raw[1:]:
        value = (value << 7) | (byte & 0x7F)
        if not byte & 0x80:
            parts.append(value)
            value = 0
    return ".".join(str(part) for part in parts)


def _decode_value(tag: int, raw: bytes) -> Any:
    if tag == 0x02:
        return _decode_integer(raw)
    if tag == 0x04:
        return raw
    if tag == 0x05:
        return None
    if tag == 0x06:
        return _decode_oid(raw)
    if tag == 0x40:
        return ".".join(str(part) for part in raw)
    if tag in (0x41, 0x42, 0x43, 0x46):
        return int.from_bytes(raw or b"\x00", "big", signed=False)
    return raw


def _oid_tuple(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.strip(".").split(".") if part != "")


def _value_to_text(value: SnmpValue | None) -> str:
    if not value:
        return ""
    if isinstance(value.value, bytes):
        return _bytes_to_text(value.value)
    return str(value.value or "")


def _as_string(value: SnmpValue | None) -> str:
    return _value_to_text(value).strip()


def _bytes_to_text(value: bytes) -> str:
    if not value:
        return ""
    try:
        text = value.decode("utf-8").strip("\x00").strip()
        if text and all((char.isprintable() or char.isspace()) for char in text):
            return text
    except UnicodeDecodeError:
        pass
    return ":".join(f"{byte:02x}" for byte in value)


def _mac_text(value: SnmpValue | None) -> str:
    if not value or not isinstance(value.value, bytes):
        return ""
    if len(value.value) == 6:
        return ":".join(f"{byte:02x}" for byte in value.value)
    return _bytes_to_text(value.value)


def _ip_text(value: SnmpValue | None) -> str:
    if not value:
        return ""
    if value.tag == 0x40 and isinstance(value.value, str):
        return value.value
    if isinstance(value.value, bytes):
        raw = value.value
        if len(raw) == 4:
            return ".".join(str(part) for part in raw)
        if len(raw) > 4 and raw[-4:] != raw:
            return ".".join(str(part) for part in raw[-4:])
    return _as_string(value)


def _status_name(value: SnmpValue | None) -> str:
    if not value or not isinstance(value.value, int):
        return ""
    return IF_STATUS.get(value.value, str(value.value))


def _type_name(value: SnmpValue | None) -> str:
    if not value or not isinstance(value.value, int):
        return ""
    return IF_TYPES.get(value.value, str(value.value))


def _vendor_from_oid(object_id: str) -> str:
    enterprise = {
        "1.3.6.1.4.1.9": "Cisco",
        "1.3.6.1.4.1.11": "HPE",
        "1.3.6.1.4.1.43": "3Com",
        "1.3.6.1.4.1.2636": "Juniper",
        "1.3.6.1.4.1.2011": "Huawei",
        "1.3.6.1.4.1.674": "Dell",
        "1.3.6.1.4.1.8072": "Net-SNMP",
        "1.3.6.1.4.1.311": "Microsoft",
    }
    for prefix, vendor in enterprise.items():
        if object_id.startswith(prefix):
            return vendor
    return ""


def _model_from_description(description: str) -> str:
    patterns = [
        r"(?im)^\s*[-*]?\s*\d+\s+\d+\s+([A-Z0-9][A-Z0-9._-]+)\s+\S+\s+\S+\s+\S+",
        r"(?i)\b(cisco\s+)?((?:WS-)?C[0-9][A-Z0-9._-]{3,}|ISR[0-9][A-Z0-9._-]+|ASR[0-9][A-Z0-9._-]+|N[0-9]K-[A-Z0-9._-]+)\b",
        r"(?im)^\s*Model\s+(?:Number|number|num|name)\s*:?\s*([A-Z0-9][A-Z0-9._/-]{3,})",
        r"(?im)^\s*Model:\s*([A-Z0-9][A-Z0-9._/-]{3,})",
        r"(?im)^\s*PID\s*:?\s*([A-Z0-9][A-Z0-9._/-]{3,})",
        r"(?im)^\s*Product\s+Model\s*:?\s*([A-Z0-9][A-Z0-9._/-]{3,})",
    ]
    for pattern in patterns:
        match = re.search(pattern, description or "")
        if not match:
            continue
        candidate = next((group for group in reversed(match.groups()) if group), "")
        model = _normalize_hardware_model(candidate)
        if model:
            return model
    return ""


def _normalize_hardware_model(value: str) -> str:
    model = (value or "").strip()
    model = re.sub(r"^Cisco\s+", "", model, flags=re.IGNORECASE)
    model = re.sub(r"^Catalyst\s+", "C", model, flags=re.IGNORECASE)
    model = model.strip().upper()
    if not model or len(model) < 4:
        return ""
    if re.fullmatch(r"\d+(?:\.\d+){3,}", model):
        return ""
    if re.fullmatch(r"REVISION|VERSION|UNKNOWN|UNSPECIFIED|N/A|NA|NONE|NULL|MODEL|NUMBER|SERIAL|SN|PID|VID|OID", model):
        return ""
    return model


def _platform_from_description(description: str) -> str:
    lowered = description.lower()
    if "windows" in lowered:
        return "Windows"
    if "cisco" in lowered:
        return "Cisco IOS"
    if "junos" in lowered:
        return "Juniper Junos"
    if "linux" in lowered:
        return "Linux"
    return ""
