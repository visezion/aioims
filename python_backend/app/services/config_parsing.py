import re
from typing import Any


def parse_vlans_from_configuration(snapshot: str) -> list[dict[str, Any]]:
    vlan_map: dict[int, dict[str, Any]] = {}
    current_vlan: int | None = None
    current_interface = ""
    interface_lines: list[str] = []

    def ensure_vlan(vlan_id: int, name: str | None = None, source: str = "ssh-config") -> dict[str, Any]:
        row = vlan_map.setdefault(vlan_id, {"id": vlan_id, "name": name or f"VLAN {vlan_id}", "source": source, "ports": []})
        if name and (not row.get("name") or row["name"] == f"VLAN {vlan_id}"):
            row["name"] = name
        return row

    def add_port(vlan_id: int, port_name: str, mode: str) -> None:
        if not vlan_id or not port_name:
            return
        ports = ensure_vlan(vlan_id).setdefault("ports", [])
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
        access_match = re.search(r"^\s*switchport access vlan\s+(\d+)", joined, re.MULTILINE | re.IGNORECASE)
        voice_match = re.search(r"^\s*switchport voice vlan\s+(\d+)", joined, re.MULTILINE | re.IGNORECASE)
        native_match = re.search(r"^\s*switchport trunk native vlan\s+(\d+)", joined, re.MULTILINE | re.IGNORECASE)
        allowed_match = re.search(r"^\s*switchport trunk allowed vlan(?: add)?\s+([0-9,\- ]+)", joined, re.MULTILINE | re.IGNORECASE)
        mode_access = re.search(r"^\s*switchport mode access", joined, re.MULTILINE | re.IGNORECASE)
        mode_trunk = re.search(r"^\s*switchport mode trunk", joined, re.MULTILINE | re.IGNORECASE)

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


def parse_interfaces_from_configuration(snapshot: str) -> list[dict[str, Any]]:
    interfaces: list[dict[str, Any]] = []
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
        row: dict[str, Any] = {"name": current_interface, "source": "ssh-config", "type": interface_type(current_interface)}
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
            row.update({"admin_status": "down", "status": "down", "enabled": False})
        else:
            row.update({"admin_status": "up", "status": "unknown", "enabled": True})
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


def merge_configuration_inventory(record: dict[str, Any], snapshot: str) -> None:
    inferred_platform = infer_platform_from_configuration(snapshot)
    if inferred_platform and (not record.get("platform") or str(record.get("platform")).lower() in {"windows", "unknown"}):
        record["platform"] = inferred_platform

    hardware = infer_hardware_from_configuration(snapshot)
    for field in ["manufacturer", "model", "serial_number", "hostname"]:
        if hardware.get(field) and not record.get(field):
            record[field] = hardware[field]
    if hardware.get("hostname") and (not record.get("name") or str(record.get("name", "")).startswith("Discovered-")):
        record["name"] = hardware["hostname"]

    parsed_vlans = parse_vlans_from_configuration(snapshot or "")
    if parsed_vlans:
        record["vlans"] = _merge_vlans(record.get("vlans") or [], parsed_vlans)
        if not record.get("vlan") and record["vlans"][0].get("id"):
            record["vlan"] = record["vlans"][0]["id"]

    parsed_interfaces = parse_interfaces_from_configuration(snapshot or "")
    if parsed_interfaces:
        existing = [dict(item) for item in record.get("interfaces") or [] if isinstance(item, dict)]
        if not existing or _scan_only_interfaces(existing):
            record["interfaces"] = parsed_interfaces
        else:
            by_name = {str(item.get("name") or ""): item for item in existing}
            for parsed in parsed_interfaces:
                name = str(parsed.get("name") or "")
                if not name:
                    continue
                if name not in by_name:
                    existing.append(parsed)
                    by_name[name] = parsed
                    continue
                for key, value in parsed.items():
                    if value not in (None, "", []):
                        by_name[name].setdefault(key, value)
            record["interfaces"] = existing

    sources = set(filter(None, str(record.get("discovery_source") or "").split(",")))
    if snapshot:
        sources.add("ssh-config")
    record["discovery_source"] = ",".join(sorted(sources))


def infer_platform_from_configuration(snapshot: str) -> str:
    lowered = (snapshot or "").lower()
    if "cisco ios xe software" in lowered or "cisco ios software" in lowered or "ios-xe" in lowered:
        return "Cisco IOS"
    if "junos" in lowered or "juniper networks" in lowered:
        return "Juniper Junos"
    if "fortios" in lowered or "fortigate" in lowered:
        return "Fortinet FortiOS"
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


def infer_hardware_from_configuration(snapshot: str) -> dict[str, str]:
    text = snapshot or ""
    lowered = text.lower()
    result: dict[str, str] = {}

    if "cisco" in lowered or "ios xe" in lowered or "cat9k" in lowered:
        result["manufacturer"] = "Cisco"
    elif "juniper" in lowered or "junos" in lowered:
        result["manufacturer"] = "Juniper"
    elif "fortinet" in lowered or "fortigate" in lowered or "fortios" in lowered:
        result["manufacturer"] = "Fortinet"

    hostname = re.search(r"(?im)^\s*hostname\s+([A-Za-z0-9_.-]+)", text)
    if not hostname:
        hostname = re.search(r"(?im)^Hostname:\s*([A-Za-z0-9_.-]+)", text)
    if hostname:
        result["hostname"] = hostname.group(1).strip()

    model_patterns = [
        r"(?im)^\s*[-*]?\s*\d+\s+\d+\s+([A-Z0-9][A-Z0-9._-]+)\s+\S+\s+\S+\s+\S+",
        r"(?i)\b(cisco\s+)?((?:WS-)?C[0-9][A-Z0-9._-]{3,}|ISR[0-9][A-Z0-9._-]+|ASR[0-9][A-Z0-9._-]+|N[0-9]K-[A-Z0-9._-]+)\b",
        r"(?im)^\s*Model\s+(?:Number|number|num|name)\s*:?\s*([A-Z0-9][A-Z0-9._/-]{3,})",
        r"(?im)^\s*Model:\s*([A-Z0-9][A-Z0-9._/-]{3,})",
        r"(?im)^\s*PID\s*:?\s*([A-Z0-9][A-Z0-9._/-]{3,})",
        r"(?im)^\s*Product\s+Model\s*:?\s*([A-Z0-9][A-Z0-9._/-]{3,})",
    ]
    for pattern in model_patterns:
        match = re.search(pattern, text)
        if match:
            candidate = next((group for group in reversed(match.groups()) if group), "")
            model = _normalize_hardware_model(candidate)
            if model:
                result["model"] = model
                break

    serial_patterns = [
        r"(?im)^\s*System\s+serial\s+number\s*:?\s*([A-Z0-9-]+)",
        r"(?im)^\s*Processor\s+board\s+ID\s+([A-Z0-9-]+)",
        r"(?im)^\s*Serial\s+(?:Number|number)?\s*:?\s*([A-Z0-9-]+)",
        r"(?im)\bSN\b\s*:?\s*([A-Z0-9-]+)",
    ]
    for pattern in serial_patterns:
        match = re.search(pattern, text)
        if match:
            result["serial_number"] = match.group(1).strip()
            break

    return result


def _merge_vlans(existing: list[dict[str, Any]], parsed: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = [dict(item) for item in existing if isinstance(item, dict)]
    by_id = {item.get("id"): item for item in rows if item.get("id") is not None}
    for vlan in parsed:
        vlan_id = vlan.get("id")
        if vlan_id not in by_id:
            rows.append(vlan)
            by_id[vlan_id] = vlan
            continue
        target = by_id[vlan_id]
        if vlan.get("name") and (not target.get("name") or str(target.get("name")).startswith("VLAN ")):
            target["name"] = vlan["name"]
        ports = target.setdefault("ports", [])
        for port in vlan.get("ports") or []:
            if not any(item.get("name") == port.get("name") and item.get("mode") == port.get("mode") for item in ports):
                ports.append(port)
    return sorted(rows, key=lambda item: int(item.get("id") or 0))


def _scan_only_interfaces(interfaces: list[dict[str, Any]]) -> bool:
    return all(str(item.get("source") or "") in {"scan", "arp", "ip-neigh"} or str(item.get("name") or "").startswith("mgmt") for item in interfaces)
