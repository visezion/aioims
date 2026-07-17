import socket
import threading
import unittest

from app.services.discovery import NetworkDiscoveryService
from app.services.protocols import ProtocolCheckService
from app.services.snmp import _integer, _length, _octet_string, _oid, _sequence


class SnmpProtocolTests(unittest.TestCase):
    def test_protocol_check_uses_configured_snmp_port(self):
        port = _start_single_response_agent(b"Test SNMP Agent")

        result = ProtocolCheckService(snmp_community="public", snmp_port=port, timeout=1).check("127.0.0.1", "snmp")

        self.assertEqual(result.status, "up")
        self.assertEqual(result.port, port)
        self.assertIn("Test SNMP Agent", result.detail)

    def test_discovery_service_passes_snmp_port_to_collector(self):
        service = NetworkDiscoveryService(subnet="127.0.0.1/32", snmp_community="public", snmp_port=1161)

        self.assertIsNotNone(service._snmp_service)
        self.assertEqual(service._snmp_service.port, 1161)


def _start_single_response_agent(sys_descr: bytes) -> int:
    server = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    server.bind(("127.0.0.1", 0))
    port = server.getsockname()[1]

    def serve_once() -> None:
        try:
            _, address = server.recvfrom(65535)
            server.sendto(_snmp_response(sys_descr), address)
        finally:
            server.close()

    threading.Thread(target=serve_once, daemon=True).start()
    return port


def _snmp_response(sys_descr: bytes) -> bytes:
    varbind = _sequence(_oid("1.3.6.1.2.1.1.1.0") + _octet_string(sys_descr))
    pdu = bytes([0xA2]) + _length(
        _integer(1001)
        + _integer(0)
        + _integer(0)
        + _sequence(varbind)
    )
    return _sequence(_integer(1) + _octet_string(b"public") + pdu)


if __name__ == "__main__":
    unittest.main()
