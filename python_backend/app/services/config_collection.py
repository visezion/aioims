import re
import time
from dataclasses import dataclass


try:
    import paramiko
except ImportError:  # pragma: no cover - exercised when dependency is absent in deployment
    paramiko = None


@dataclass
class ConfigurationResult:
    status: str
    snapshot: str = ""
    error: str = ""


class SshConfigurationCollector:
    def __init__(
        self,
        username: str,
        password: str,
        enable_password: str = "",
        port: int = 22,
        timeout: float = 8,
    ) -> None:
        self.username = username
        self.password = password
        self.enable_password = enable_password
        self.port = port or 22
        self.timeout = timeout

    def collect(self, host: str, platform: str = "") -> ConfigurationResult:
        if paramiko is None:
            return ConfigurationResult("SSH collector unavailable: install paramiko.")
        if not self.username or not self.password:
            return ConfigurationResult("SSH credential is missing username or password.")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(
                host,
                port=self.port,
                username=self.username,
                password=self.password,
                look_for_keys=False,
                allow_agent=False,
                timeout=self.timeout,
                banner_timeout=self.timeout,
                auth_timeout=self.timeout,
            )
            channel = client.invoke_shell(width=220, height=1000)
            channel.settimeout(self.timeout)
            banner = self._read_available(channel, 1.0)
            remote_platform = self._remote_platform(platform, banner)
            if self.enable_password:
                self._send(channel, "enable")
                enable_prompt = self._read_available(channel, 0.8)
                if "password" in enable_prompt.lower():
                    self._send(channel, self.enable_password, hide=True)
                    self._read_available(channel, 0.8)
            output = [banner]
            for command in self._commands(remote_platform):
                output.append(f"\n$ {command}\n")
                self._send(channel, command)
                output.append(self._read_available(channel, self._command_wait(command)))
            snapshot = "".join(output).strip()
            if not snapshot:
                return ConfigurationResult("SSH connected but returned no configuration output.")
            return ConfigurationResult("Configuration collected over SSH.", snapshot=snapshot[:200000])
        except Exception as exc:
            return ConfigurationResult("SSH configuration collection failed.", error=str(exc))
        finally:
            client.close()

    def execute(self, host: str, commands: list[str], platform: str = "", enable: bool = True) -> ConfigurationResult:
        if paramiko is None:
            return ConfigurationResult("SSH terminal unavailable: install paramiko.")
        if not self.username or not self.password:
            return ConfigurationResult("SSH credential is missing username or password.")
        command_list = [command.strip() for command in commands if command and command.strip()]
        if not command_list:
            return ConfigurationResult("No terminal command was provided.")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(
                host,
                port=self.port,
                username=self.username,
                password=self.password,
                look_for_keys=False,
                allow_agent=False,
                timeout=self.timeout,
                banner_timeout=self.timeout,
                auth_timeout=self.timeout,
            )
            channel = client.invoke_shell(width=220, height=1000)
            channel.settimeout(self.timeout)
            banner = self._read_available(channel, 1.0)
            remote_platform = self._remote_platform(platform, banner)
            if enable and self.enable_password:
                self._send(channel, "enable")
                enable_prompt = self._read_available(channel, 0.8)
                if "password" in enable_prompt.lower():
                    self._send(channel, self.enable_password, hide=True)
                    self._read_available(channel, 0.8)
            for preamble in self._terminal_preamble(remote_platform):
                self._send(channel, preamble)
                self._read_available(channel, 0.8)
            output = [banner]
            for command in command_list:
                output.append(f"\n$ {command}\n")
                self._send(channel, command)
                output.append(self._read_available(channel, self._command_wait(command)))
            snapshot = "".join(output).strip()
            if not snapshot:
                return ConfigurationResult("SSH connected but returned no terminal output.")
            return ConfigurationResult("Terminal command executed over SSH.", snapshot=snapshot[:200000])
        except Exception as exc:
            return ConfigurationResult("SSH terminal command failed.", error=str(exc))
        finally:
            client.close()

    def open_interactive_shell(self, host: str, platform: str = "", enable: bool = True, width: int = 220, height: int = 1000):
        if paramiko is None:
            raise RuntimeError("SSH terminal unavailable: install paramiko.")
        if not self.username or not self.password:
            raise RuntimeError("SSH credential is missing username or password.")

        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            client.connect(
                host,
                port=self.port,
                username=self.username,
                password=self.password,
                look_for_keys=False,
                allow_agent=False,
                timeout=self.timeout,
                banner_timeout=self.timeout,
                auth_timeout=self.timeout,
            )
            channel = client.invoke_shell(width=width, height=height)
            channel.settimeout(0.0)
            if enable and self.enable_password:
                self._send(channel, "enable")
                time.sleep(0.2)
                if channel.recv_ready():
                    prompt = channel.recv(65535).decode("utf-8", errors="replace")
                    if "password" in prompt.lower():
                        self._send(channel, self.enable_password, hide=True)
                        time.sleep(0.2)
            for preamble in self._terminal_preamble(platform):
                self._send(channel, preamble)
            return client, channel
        except Exception:
            client.close()
            raise

    def _commands(self, platform: str) -> list[str]:
        lowered = (platform or "").lower()
        if "forti" in lowered:
            return ["config system console", "set output standard", "end", "get system status", "show full-configuration", "get router info routing-table all"]
        if "junos" in lowered or "juniper" in lowered:
            return ["set cli screen-length 0", "show version", "show chassis hardware", "show configuration", "show interfaces terse", "show vlans", "show lldp neighbors detail", "show route"]
        if "windows" in lowered:
            return ["hostname", "ipconfig /all", "route print", "netsh interface show interface", "netsh interface ipv4 show interfaces"]
        if "linux" in lowered:
            return ["hostnamectl", "ip address", "ip route", "ip link", "ss -tulpn"]
        return [
            "terminal length 0",
            "terminal width 511",
            "show version",
            "show inventory",
            "show running-config",
            "show ip interface brief",
            "show interfaces status",
            "show interfaces",
            "show vlan brief",
            "show lldp neighbors detail",
            "show cdp neighbors detail",
            "show mac address-table",
            "show arp",
            "show ip route",
        ]

    def _terminal_preamble(self, platform: str) -> list[str]:
        lowered = (platform or "").lower()
        if "junos" in lowered or "juniper" in lowered:
            return ["set cli screen-length 0"]
        if "windows" in lowered or "linux" in lowered:
            return []
        return ["terminal length 0", "terminal width 511"]

    def _remote_platform(self, platform: str, prompt_or_banner: str = "") -> str:
        lowered_platform = (platform or "").lower()
        lowered_banner = (prompt_or_banner or "").lower()
        has_network_prompt = bool(re.search(r"(?m)[A-Za-z0-9_.:/() -]{1,80}[>#]\s*$", prompt_or_banner or ""))
        has_windows_banner = any(marker in lowered_banner for marker in ("microsoft windows", "powershell", "windows powershell"))
        if "windows" in lowered_platform and has_network_prompt and not has_windows_banner:
            return "Cisco IOS"
        if not lowered_platform and has_network_prompt:
            return "Cisco IOS"
        return platform or ""

    def _command_wait(self, command: str) -> float:
        long_running = ("running-config", "full-configuration", "interfaces", "mac address-table", "route")
        return 5.0 if any(part in command for part in long_running) else 2.0

    def _send(self, channel, command: str, hide: bool = False) -> None:
        channel.send(command + "\n")
        if hide:
            time.sleep(0.3)

    def _read_available(self, channel, seconds: float) -> str:
        end = time.time() + seconds
        chunks = []
        while time.time() < end:
            while channel.recv_ready():
                chunks.append(channel.recv(65535).decode("utf-8", errors="replace"))
                end = time.time() + 0.5
            time.sleep(0.1)
        return "".join(chunks)
