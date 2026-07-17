import platform
import socket
import subprocess
import time
import urllib.request
from dataclasses import dataclass
from typing import Callable, Iterable

from app.services.snmp import SnmpClient


DEFAULT_PROTOCOLS = ("icmp", "ssh", "telnet", "http", "https", "snmp")
TCP_PORTS = {"ssh": 22, "telnet": 23, "http": 80, "https": 443}


@dataclass
class ProtocolResult:
    protocol: str
    target: str
    port: int | None
    status: str
    latency_ms: int | None
    detail: str

    def to_dict(self) -> dict:
        return {
            "protocol": self.protocol,
            "target": self.target,
            "port": self.port,
            "status": self.status,
            "latency_ms": self.latency_ms,
            "detail": self.detail,
        }


class ProtocolCheckService:
    def __init__(self, timeout: float = 1.5, snmp_community: str = "", snmp_port: int = 161) -> None:
        self.timeout = max(0.2, min(timeout, 10.0))
        self.snmp_community = snmp_community.strip()
        self.snmp_port = snmp_port or 161

    def check_many(
        self,
        target: str,
        protocols: Iterable[str] = DEFAULT_PROTOCOLS,
        progress_callback: Callable[[int, int, str], None] | None = None,
    ) -> list[dict]:
        normalized = [item.strip().lower() for item in protocols if item and item.strip()]
        results = []
        total = len(normalized)
        for index, protocol in enumerate(normalized, start=1):
            results.append(self.check(target, protocol).to_dict())
            if progress_callback:
                try:
                    progress_callback(index, total, protocol)
                except Exception:
                    pass
        return results

    def check(self, target: str, protocol: str) -> ProtocolResult:
        protocol = protocol.lower()
        if protocol == "icmp":
            return self._check_icmp(target)
        if protocol in TCP_PORTS:
            return self._check_tcp(target, protocol, TCP_PORTS[protocol])
        if protocol == "snmp":
            return self._check_snmp(target)
        return ProtocolResult(protocol, target, None, "unsupported", None, "Protocol is not configured.")

    def _check_icmp(self, target: str) -> ProtocolResult:
        if platform.system().lower() == "windows":
            command = ["ping", "-n", "1", "-w", str(int(self.timeout * 1000)), target]
        else:
            command = ["ping", "-c", "1", "-W", str(max(1, int(self.timeout))), target]
        started = time.perf_counter()
        try:
            completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=self.timeout + 1, check=False)
            latency = int((time.perf_counter() - started) * 1000)
            status = "up" if completed.returncode == 0 else "down"
            return ProtocolResult("icmp", target, None, status, latency, "Ping completed." if status == "up" else "No ICMP response.")
        except Exception as exc:
            return ProtocolResult("icmp", target, None, "error", None, str(exc))

    def _check_tcp(self, target: str, protocol: str, port: int) -> ProtocolResult:
        started = time.perf_counter()
        try:
            with socket.create_connection((target, port), timeout=self.timeout) as sock:
                latency = int((time.perf_counter() - started) * 1000)
                if protocol in {"ssh", "telnet"}:
                    sock.settimeout(0.25)
                    try:
                        banner = sock.recv(80).decode("utf-8", errors="ignore").strip()
                    except Exception:
                        banner = ""
                    detail = banner or f"TCP port {port} is reachable."
                elif protocol in {"http", "https"}:
                    detail = self._http_detail(target, protocol)
                else:
                    detail = f"TCP port {port} is reachable."
                return ProtocolResult(protocol, target, port, "up", latency, detail)
        except Exception as exc:
            return ProtocolResult(protocol, target, port, "down", None, str(exc))

    def _http_detail(self, target: str, protocol: str) -> str:
        try:
            with urllib.request.urlopen(f"{protocol}://{target}", timeout=self.timeout) as response:
                return f"HTTP status {response.status}"
        except Exception:
            return f"TCP port {TCP_PORTS[protocol]} is reachable."

    def _check_snmp(self, target: str) -> ProtocolResult:
        if not self.snmp_community:
            return ProtocolResult("snmp", target, self.snmp_port, "down", None, "SNMP community/profile is not configured for this check.")
        started = time.perf_counter()
        try:
            value = SnmpClient(target, self.snmp_community, port=self.snmp_port, timeout=self.timeout).get("1.3.6.1.2.1.1.1.0")
            latency = int((time.perf_counter() - started) * 1000)
            detail = "SNMP sysDescr response received."
            if value and isinstance(value.value, bytes):
                detail = value.value.decode("utf-8", errors="replace").strip()[:160] or detail
            return ProtocolResult("snmp", target, self.snmp_port, "up", latency, detail)
        except Exception as exc:
            return ProtocolResult("snmp", target, self.snmp_port, "down", None, str(exc))
