import ipaddress
import platform
import re
import socket
import subprocess
from typing import Any, Callable, Dict, List

from app.services.config_parsing import merge_configuration_inventory
from app.services.config_collection import SshConfigurationCollector
from app.services.snmp import SnmpDiscoveryService


class NetworkDiscoveryService:
    def __init__(
        self,
        subnet: str = "192.168.1.0/24",
        max_hosts: int = 64,
        vlan: int = 1,
        connection: str = "Ethernet",
        interface_name: str = "mgmt0",
        snmp_community: str = "",
        ssh_username: str = "",
        ssh_password: str = "",
        ssh_enable_password: str = "",
        ssh_port: int = 22,
        snmp_port: int = 161,
        collect_config: bool = False,
        progress_callback: Callable[[int, int, str], None] | None = None,
    ) -> None:
        self.subnet = subnet
        self.max_hosts = max(1, min(max_hosts, 512))
        self.vlan = vlan
        self.connection = connection
        self.interface_name = interface_name
        self.snmp_community = snmp_community
        self.snmp_port = snmp_port or 161
        self._neighbor_cache: dict[str, dict[str, str]] | None = None
        self._snmp_service = SnmpDiscoveryService(snmp_community, port=self.snmp_port) if snmp_community else None
        self._config_collector = (
            SshConfigurationCollector(ssh_username, ssh_password, ssh_enable_password, ssh_port)
            if collect_config and ssh_username and ssh_password
            else None
        )
        self._collect_config = collect_config
        self._progress_callback = progress_callback

    def discover(self) -> List[Dict[str, Any]]:
        try:
            hosts = self._hosts_to_scan()
        except ValueError:
            return []

        results = []
        total_hosts = len(hosts)
        for index, host in enumerate(hosts, start=1):
            ip = str(host)
            hostname = self._hostname(ip)
            status = self._ping(ip)
            neighbor = self._neighbor(ip)
            interface_name = neighbor.get("interface") or self.interface_name
            mac_address = neighbor.get("mac", "")
            discovered = {
                "name": hostname or f"Discovered-{ip}",
                "management_ip": ip,
                "role": "Discovered Device",
                "status": status,
                "platform": "",
                "mac_address": mac_address,
                "discovery_source": "ping,rdns,arp" if mac_address else "ping,rdns",
                "description": "Auto-discovered via local network scan",
                "tags": "auto-discovered,network-scan",
                "hostname": hostname or f"host-{ip.replace('.', '-')}",
                "interfaces": [{
                    "name": interface_name,
                    "ip": ip,
                    "status": "up" if status == "Active" else "down",
                    "mac": mac_address,
                    "source": neighbor.get("source", "scan"),
                }],
                "vlan": self.vlan,
                "vlans": [],
                "neighbors": [],
                "connection": self.connection,
                "snmp_status": "Not configured" if not self.snmp_community else "Not checked",
                "snmp_last_error": "" if not self.snmp_community else "SNMP was not attempted.",
                "config_status": "SNMP community not configured. Running configuration requires SSH/Telnet/API credentials.",
                "configuration_snapshot": "",
            }
            if self._snmp_service:
                self._merge_snmp(discovered, self._snmp_service.discover_device(ip))
            if self._should_collect_configuration(discovered):
                self._collect_configuration(ip, discovered)
            results.append(discovered)
            self._report_progress(index, total_hosts, ip)
        return results

    def _report_progress(self, checked: int, total: int, ip: str) -> None:
        if not self._progress_callback:
            return
        try:
            self._progress_callback(checked, total, ip)
        except Exception:
            return

    def _should_collect_configuration(self, discovered: dict[str, Any]) -> bool:
        if not self._collect_config:
            return False
        return (
            discovered.get("status") == "Active"
            or discovered.get("snmp_status") == "OK"
            or bool(discovered.get("mac_address"))
            or bool(discovered.get("neighbors"))
        )

    def _collect_configuration(self, ip: str, discovered: dict[str, Any]) -> None:
        if not self._collect_config:
            return
        if not self._config_collector:
            discovered["config_status"] = "SSH credential not selected or incomplete."
            return
        result = self._config_collector.collect(ip, discovered.get("platform", ""))
        discovered["config_status"] = result.status if not result.error else f"{result.status} {result.error}"
        discovered["configuration_snapshot"] = result.snapshot
        merge_configuration_inventory(discovered, result.snapshot)

    def _merge_snmp(self, discovered: dict[str, Any], snmp: dict[str, Any]) -> None:
        discovered["snmp_status"] = snmp.get("snmp_status", "Not checked")
        discovered["snmp_last_error"] = snmp.get("snmp_last_error", "")
        discovered["config_status"] = snmp.get("config_status", discovered.get("config_status", "Not collected"))
        discovered["configuration_snapshot"] = snmp.get("configuration_snapshot", "")
        if snmp.get("snmp_status") != "OK":
            return

        discovered["status"] = "Active"
        if snmp.get("hostname"):
            discovered["hostname"] = snmp["hostname"]
            discovered["name"] = snmp["hostname"]
        for field in ["platform", "manufacturer", "model", "description"]:
            if snmp.get(field):
                discovered[field] = snmp[field]
        interfaces = snmp.get("interfaces") or []
        if interfaces:
            discovered["interfaces"] = interfaces
            mac = self._management_or_first_mac(discovered["management_ip"], interfaces)
            if mac:
                discovered["mac_address"] = mac
        vlans = snmp.get("vlans") or []
        if vlans:
            discovered["vlans"] = vlans
            first_vlan = vlans[0].get("id")
            if isinstance(first_vlan, int):
                discovered["vlan"] = first_vlan
        discovered["neighbors"] = snmp.get("neighbors") or []
        sources = set(filter(None, discovered.get("discovery_source", "").split(",")))
        sources.add("snmp")
        discovered["discovery_source"] = ",".join(sorted(sources))

    def _management_or_first_mac(self, management_ip: str, interfaces: list[dict[str, Any]]) -> str:
        first_mac = ""
        for item in interfaces:
            mac = item.get("mac") or ""
            if mac and not first_mac:
                first_mac = mac
            addresses = [part.strip() for part in str(item.get("ip") or "").split(",")]
            if mac and management_ip in addresses:
                return mac
        return first_mac

    def _hosts_to_scan(self) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        hosts: list[ipaddress.IPv4Address | ipaddress.IPv6Address] = []
        seen: set[str] = set()
        targets = [part.strip() for part in re.split(r"[,;]+", self.subnet) if part.strip()]
        if not targets:
            raise ValueError("Scan target is empty")

        for target in targets:
            for host in self._hosts_for_target(target):
                key = str(host)
                if key in seen:
                    continue
                seen.add(key)
                hosts.append(host)
                if len(hosts) >= self.max_hosts:
                    return hosts
        return hosts

    def _hosts_for_target(self, target: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        compact = re.sub(r"\s+", "", target)
        if "-" in compact and "/" not in compact:
            return self._hosts_for_range(compact)

        interface = ipaddress.ip_interface(compact)
        network = interface.network
        supplied_ip = interface.ip
        hosts = list(network.hosts())

        if not hosts and supplied_ip in network:
            return [supplied_ip]

        if supplied_ip in hosts and supplied_ip != hosts[0]:
            start_index = hosts.index(supplied_ip)
            return hosts[start_index:] + hosts[:start_index]
        return hosts

    def _hosts_for_range(self, target: str) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        start_text, end_text = target.split("-", 1)
        start = ipaddress.ip_address(start_text)
        if "." not in end_text and ":" not in end_text:
            if not isinstance(start, ipaddress.IPv4Address):
                raise ValueError("Short range syntax is only supported for IPv4")
            prefix = start_text.rsplit(".", 1)[0]
            end = ipaddress.ip_address(f"{prefix}.{end_text}")
        else:
            end = ipaddress.ip_address(end_text)

        if start.version != end.version:
            raise ValueError("IP range versions do not match")
        if int(end) < int(start):
            raise ValueError("IP range end must be greater than or equal to start")
        return [ipaddress.ip_address(value) for value in range(int(start), int(end) + 1)]

    def _ping(self, ip: str) -> str:
        if platform.system().lower() == "windows":
            command = ["ping", "-n", "1", "-w", "400", ip]
        else:
            command = ["ping", "-c", "1", "-W", "1", ip]
        try:
            completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5, check=False)
            return "Active" if completed.returncode == 0 else "Offline"
        except Exception:
            return "Offline"

    def _hostname(self, ip: str) -> str:
        try:
            value = socket.gethostbyaddr(ip)[0]
            return value if value != ip else ""
        except Exception:
            return ""

    def _neighbor(self, ip: str) -> dict[str, str]:
        if self._neighbor_cache is None:
            self._neighbor_cache = self._load_neighbors()
        return self._neighbor_cache.get(ip, {})

    def _load_neighbors(self) -> dict[str, dict[str, str]]:
        if platform.system().lower() == "windows":
            return self._load_windows_arp()
        return self._load_unix_neighbors()

    def _load_windows_arp(self) -> dict[str, dict[str, str]]:
        try:
            completed = subprocess.run(["arp", "-a"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5, check=False)
        except Exception:
            return {}
        neighbors: dict[str, dict[str, str]] = {}
        current_interface = ""
        for line in completed.stdout.splitlines():
            interface_match = re.search(r"Interface:\s+([0-9a-fA-F:.]+)", line)
            if interface_match:
                current_interface = interface_match.group(1)
                continue
            row_match = re.search(r"^\s*([0-9.]+)\s+([0-9a-fA-F-]{17})\s+(\w+)", line)
            if row_match:
                neighbors[row_match.group(1)] = {
                    "mac": row_match.group(2).replace("-", ":").lower(),
                    "interface": current_interface or self.interface_name,
                    "type": row_match.group(3),
                    "source": "arp",
                }
        return neighbors

    def _load_unix_neighbors(self) -> dict[str, dict[str, str]]:
        try:
            completed = subprocess.run(["ip", "neigh"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5, check=False)
        except Exception:
            return {}
        neighbors: dict[str, dict[str, str]] = {}
        for line in completed.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 5 and "lladdr" in parts:
                ip = parts[0]
                interface = parts[parts.index("dev") + 1] if "dev" in parts and parts.index("dev") + 1 < len(parts) else self.interface_name
                mac = parts[parts.index("lladdr") + 1]
                neighbors[ip] = {"mac": mac.lower(), "interface": interface, "source": "ip-neigh"}
        return neighbors
