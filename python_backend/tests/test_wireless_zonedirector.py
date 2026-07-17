import unittest

from app.api.v1.endpoints.wireless import ZD_AP_TABLE_COLUMNS, _test_controller_connectivity, _zonedirector_snmp_aps
from app.services.snmp import SnmpValue
from test_snmp_protocols import _start_single_response_agent


class ZoneDirectorSnmpTests(unittest.TestCase):
    def test_zonedirector_snmp_ap_table_rows_are_normalized(self):
        client = FakeSnmpClient({
            "mac_address": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['mac_address']}.1", 0x04, b"", bytes.fromhex("703a0e112233"))],
            "description": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['description']}.1", 0x04, b"", b"AP-Lobby")],
            "status": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['status']}.1", 0x02, b"", 1)],
            "model": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['model']}.1", 0x04, b"", b"R710")],
            "serial_number": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['serial_number']}.1", 0x04, b"", b"SN123")],
            "software_version": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['software_version']}.1", 0x04, b"", b"10.5.1")],
            "management_ip": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['management_ip']}.1", 0x40, b"", "10.20.30.40")],
            "clients": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['clients']}.1", 0x02, b"", 14)],
            "total_users": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['total_users']}.1", 0x02, b"", 11)],
            "radios": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['radios']}.1", 0x02, b"", 2)],
            "lan_rx_bytes": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['lan_rx_bytes']}.1", 0x41, b"", 123456)],
            "lan_tx_bytes": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['lan_tx_bytes']}.1", 0x41, b"", 654321)],
            "lan_rx_byte_rate": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['lan_rx_byte_rate']}.1", 0x41, b"", 3000)],
            "lan_tx_byte_rate": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['lan_tx_byte_rate']}.1", 0x41, b"", 7000)],
            "cpu_util": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['cpu_util']}.1", 0x02, b"", 17)],
            "memory_util": [SnmpValue(f"{ZD_AP_TABLE_COLUMNS['memory_util']}.1", 0x02, b"", 42)],
        })

        aps = _zonedirector_snmp_aps(client)

        self.assertEqual(len(aps), 1)
        self.assertEqual(aps[0]["name"], "AP-Lobby")
        self.assertEqual(aps[0]["mac_address"], "70:3a:0e:11:22:33")
        self.assertEqual(aps[0]["management_ip"], "10.20.30.40")
        self.assertEqual(aps[0]["status"], "Connected")
        self.assertEqual(aps[0]["clients"], 11)
        self.assertEqual(aps[0]["controller_clients"], 14)
        self.assertEqual(aps[0]["traffic_rx_bytes"], 123456)
        self.assertEqual(aps[0]["traffic_tx_rate"], 7000)
        self.assertEqual(aps[0]["cpu_util"], 17)

    def test_wireless_controller_test_uses_snmp_udp(self):
        port = _start_single_response_agent(b"ZoneDirector SNMP OK")

        ok, detail = _test_controller_connectivity(None, {
            "protocol": "snmp",
            "host": "127.0.0.1",
            "port": port,
            "password_encrypted": "",
            "community": "public",
        })

        self.assertTrue(ok)
        self.assertIn(f"SNMP UDP/{port} succeeded", detail)
        self.assertIn("ZoneDirector SNMP OK", detail)


class FakeSnmpClient:
    def __init__(self, rows_by_field):
        self.rows_by_oid = {ZD_AP_TABLE_COLUMNS[field]: rows for field, rows in rows_by_field.items()}

    def walk(self, oid, limit=1024):
        return self.rows_by_oid.get(oid, [])


if __name__ == "__main__":
    unittest.main()
