import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from sqlalchemy import or_

from app.api.v1.endpoints.devices import _apply_configuration_result, _collect_cisco_fan_environment, _collect_cisco_power_supply_environment, _collect_cisco_temperature_environment, _delete_topology_links_for_devices, _parse_interfaces_from_configuration, _parse_vlans_from_configuration, _serialize_device, _summarize_environment
from app.api.v1.endpoints.discovery import _is_active_discovery, _upsert_device_links
from app.api.v1.endpoints.topology import TopologyIngestRequest, _attach_neighbor_links, _auto_ingest_trace_endpoint, _credential_ids_for_node, _neighbor_candidate_for_node, _node_id, _trace_connected_devices, _trace_via_snmp, _upsert_ingested_device, get_topology, trace_connected_devices
from app.db.session import SessionLocal, init_db
from app.models.app_config import AppConfig
from app.models.credential_profile import CredentialProfile
from app.models.device import Device
from app.models.device_config_backup import DeviceConfigBackup
from app.models.device_link import DeviceLink
from app.models.job import Job
from app.models.site import Site
from app.models.user import User
from app.services.config_collection import ConfigurationResult, SshConfigurationCollector
from app.services.config_backup import create_config_backup, list_config_backups
from app.services.discovery import NetworkDiscoveryService
from app.services.jobs import complete_job, start_job, update_job_progress
from app.services.snmp import SnmpValue, _decode_port_bitmap


class _StaticSnmpClient:
    def __init__(self, rows_by_oid):
        self.rows_by_oid = rows_by_oid

    def walk(self, oid, limit=512):
        return self.rows_by_oid.get(oid, [])


class _FakeLayer2TraceService:
    def __init__(self, community, port):
        self.community = community
        self.port = port

    def resolve_ip_mac(self, host, target_ip):
        return "00:11:22:33:44:55"

    def find_mac_port(self, host, mac_address, vlan=None, vlan_ids=None, cisco_vlan_context=False):
        if host == "198.51.100.20":
            return [{"interface": "Po1", "member_interfaces": ["Te1/1/1"], "bridge_port": 1, "if_index": 1, "vlan": 20}]
        if host == "198.51.100.21":
            return [{"interface": "Gi1/0/12", "bridge_port": 12, "if_index": 12, "vlan": 20}]
        return []


class DeviceSerializationTests(unittest.TestCase):
    def test_trace_does_not_auto_ingest_searched_endpoint(self):
        init_db()
        db = SessionLocal()
        profile_id = None
        setting = None
        previous_setting_value = None
        target_ip = "203.0.113.188"
        try:
            profile = CredentialProfile(name="Trace Auto-Ingest SNMP Test", credential_type="snmp_v2c", port=161, secret_encrypted="test")
            db.add(profile)
            db.flush()
            profile_id = profile.id
            setting = db.query(AppConfig).filter(AppConfig.key == "trace_default_snmp_credential_id").first()
            if setting:
                previous_setting_value = setting.value
            else:
                setting = AppConfig(key="trace_default_snmp_credential_id", description="Test trace default")
                db.add(setting)
            setting.value = str(profile.id)
            db.commit()
            trace = {
                "nodes": [{"id": f"live:{target_ip}", "ip": target_ip, "mac_address": "00:11:22:33:44:99"}],
                "links": [],
                "live_snmp": {"used": True},
            }

            result = _auto_ingest_trace_endpoint(db, trace)

            self.assertIsNone(result)
            self.assertEqual(trace["live_snmp"]["auto_ingest"], "skipped")
            self.assertIsNone(db.query(Device).filter(Device.management_ip == target_ip).first())
        finally:
            db.query(Device).filter(Device.management_ip == target_ip).delete(synchronize_session=False)
            if profile_id:
                db.query(CredentialProfile).filter(CredentialProfile.id == profile_id).delete(synchronize_session=False)
            if setting:
                if previous_setting_value is None:
                    db.delete(setting)
                else:
                    setting.value = previous_setting_value
            db.commit()
            db.close()

    def test_trace_uses_live_snmp_for_unmanaged_ip(self):
        init_db()
        db = SessionLocal()
        device_ids = []
        link_ids = []
        try:
            core = Device(name="SNMP Trace Core", management_ip="198.51.100.20", role="Core Switch", status="Active")
            access = Device(name="SNMP Trace Access", management_ip="198.51.100.21", role="Access Switch", status="Active")
            db.add_all([core, access])
            db.flush()
            device_ids = [core.id, access.id]
            link = DeviceLink(local_device_id=core.id, remote_device_id=access.id, local_interface="Te1/1/1", remote_interface="Gi1/0/48", protocol="lldp")
            db.add(link)
            db.commit()
            link_ids = [link.id]
            discovered_target = DeviceLink(
                local_device_id=access.id,
                local_device_name=access.name,
                local_ip=access.management_ip,
                local_interface="Gi1/0/12",
                remote_device_name="Unmanaged Trace Target",
                remote_ip="198.51.100.250",
                remote_interface="eth0",
                protocol="lldp",
            )
            db.add(discovered_target)
            db.commit()
            link_ids.append(discovered_target.id)
            candidates = [
                {"device": core, "community": "public", "port": 161},
                {"device": access, "community": "public", "port": 161},
            ]

            with patch("app.api.v1.endpoints.topology._snmp_trace_candidates", return_value=candidates), patch("app.api.v1.endpoints.topology.SnmpLayer2TraceService", _FakeLayer2TraceService), patch("app.api.v1.endpoints.topology._scan_single_neighbor", return_value=None):
                trace = _trace_via_snmp(db, "198.51.100.250")

            self.assertTrue(trace["live_snmp"]["used"])
            self.assertEqual([node["name"] for node in trace["nodes"]], ["SNMP Trace Core", "SNMP Trace Access", "198.51.100.250"])
            self.assertEqual(trace["nodes"][-1]["via"]["device_port"], "Gi1/0/12")
            self.assertEqual(trace["nodes"][-1]["mac_address"], "00:11:22:33:44:55")

            with patch("app.api.v1.endpoints.topology._snmp_trace_candidates", return_value=candidates), patch("app.api.v1.endpoints.topology.SnmpLayer2TraceService", _FakeLayer2TraceService), patch("app.api.v1.endpoints.topology._scan_single_neighbor", return_value=None):
                response = trace_connected_devices(query="198.51.100.250", db=db, current_user=User(email="unit@test.local"))

            self.assertTrue(response["data"]["live_snmp"]["used"])
            self.assertEqual(response["data"]["roots"][0]["name"], "SNMP Trace Core")
        finally:
            if link_ids:
                db.query(DeviceLink).filter(DeviceLink.id.in_(link_ids)).delete(synchronize_session=False)
            if device_ids:
                db.query(Device).filter(Device.id.in_(device_ids)).delete(synchronize_session=False)
            db.commit()
            db.close()

    def test_trace_finds_device_by_mac_and_returns_backbone_route(self):
        init_db()
        db = SessionLocal()
        device_ids = []
        link_ids = []
        try:
            core = Device(name="Trace Core", management_ip="198.51.100.10", mac_address="00:11:22:33:44:55", role="Core Switch", status="Active")
            access = Device(name="Trace Access", management_ip="198.51.100.11", mac_address="00:11:22:33:44:66", role="Access Switch", status="Active")
            endpoint = Device(name="Trace Endpoint", management_ip="198.51.100.12", mac_address="00:11:22:33:44:77", role="Server", status="Active", interfaces='[{"name":"eth0","ip":"198.51.100.120","mac":"00:11:22:33:44:88"}]')
            unrelated = Device(name="Trace Unrelated Branch", management_ip="198.51.100.13", role="Access Switch", status="Active")
            db.add_all([core, access, endpoint, unrelated])
            db.flush()
            device_ids = [core.id, access.id, endpoint.id, unrelated.id]
            db.add_all([
                DeviceLink(local_device_id=core.id, remote_device_id=access.id, local_interface="Te1/1/1", remote_interface="Gi1/0/48", protocol="lldp"),
                DeviceLink(local_device_id=access.id, remote_device_id=endpoint.id, local_interface="Gi1/0/12", remote_interface="eth0", protocol="lldp"),
                DeviceLink(local_device_id=core.id, remote_device_id=unrelated.id, local_interface="Te1/1/2", remote_interface="Gi1/0/48", protocol="lldp"),
                DeviceLink(local_device_id=core.id, remote_device_id=endpoint.id, local_interface="Vlan120", remote_interface="ARP neighbor", protocol="snmp-arp"),
            ])
            db.commit()
            link_ids = [link.id for link in db.query(DeviceLink).filter(DeviceLink.local_device_id.in_(device_ids)).all()]

            trace = _trace_connected_devices(db, "00:11:22:33:44:88")

            self.assertEqual(trace["roots"][0]["name"], "Trace Core")
            self.assertEqual([node["name"] for node in trace["nodes"]], ["Trace Core", "Trace Access", "Trace Endpoint"])
            self.assertNotIn("Trace Unrelated Branch", [node["name"] for node in trace["nodes"]])
            access_node = next(node for node in trace["nodes"] if node["name"] == "Trace Access")
            self.assertEqual(access_node["via"]["device_port"], "Te1/1/1")
            self.assertEqual(access_node["via"]["port"], "Gi1/0/48")
            endpoint_trace = _trace_connected_devices(db, "00:11:22:33:44:88")
            self.assertEqual(endpoint_trace["roots"][0]["name"], "Trace Core")
            self.assertEqual(endpoint_trace["nodes"][-1]["name"], "Trace Endpoint")
        finally:
            if link_ids:
                db.query(DeviceLink).filter(DeviceLink.id.in_(link_ids)).delete(synchronize_session=False)
            if device_ids:
                db.query(Device).filter(Device.id.in_(device_ids)).delete(synchronize_session=False)
            db.commit()
            db.close()

    def test_topology_ingest_uses_per_node_credential_profiles(self):
        payload = TopologyIngestRequest.model_validate({
            "node_ids": ["ip:192.0.2.10", "ip:192.0.2.11"],
            "snmp_credential_id": 10,
            "ssh_credential_id": 20,
            "node_credentials": {
                "ip:192.0.2.10": {"snmp_credential_id": 11, "ssh_credential_id": 21},
                "ip:192.0.2.11": {"snmp_credential_id": 12},
            },
        })

        self.assertEqual(_credential_ids_for_node(payload, "ip:192.0.2.10"), (11, 21))
        self.assertEqual(_credential_ids_for_node(payload, "ip:192.0.2.11"), (12, 20))
        self.assertEqual(_credential_ids_for_node(payload, "ip:192.0.2.12"), (10, 20))

    def test_cisco_envmon_temperature_fan_and_power_supply_are_summarized(self):
        client = _StaticSnmpClient({
            "1.3.6.1.4.1.9.9.13.1.3.1.2": [SnmpValue("1.3.6.1.4.1.9.9.13.1.3.1.2.1005", 4, b"", b"SW#1, Sensor#1, GREEN")],
            "1.3.6.1.4.1.9.9.13.1.3.1.3": [SnmpValue("1.3.6.1.4.1.9.9.13.1.3.1.3.1005", 2, b"", 50)],
            "1.3.6.1.4.1.9.9.13.1.3.1.4": [SnmpValue("1.3.6.1.4.1.9.9.13.1.3.1.4.1005", 2, b"", 65)],
            "1.3.6.1.4.1.9.9.13.1.3.1.5": [SnmpValue("1.3.6.1.4.1.9.9.13.1.3.1.5.1005", 2, b"", 0)],
            "1.3.6.1.4.1.9.9.13.1.3.1.6": [SnmpValue("1.3.6.1.4.1.9.9.13.1.3.1.6.1005", 2, b"", 1)],
            "1.3.6.1.4.1.9.9.13.1.4.1.2": [SnmpValue("1.3.6.1.4.1.9.9.13.1.4.1.2.1004", 4, b"", b"Switch#1, Fan#1")],
            "1.3.6.1.4.1.9.9.13.1.4.1.3": [SnmpValue("1.3.6.1.4.1.9.9.13.1.4.1.3.1004", 2, b"", 1)],
            "1.3.6.1.4.1.9.9.13.1.5.1.2": [SnmpValue("1.3.6.1.4.1.9.9.13.1.5.1.2.1003", 4, b"", b"Sw1, PS1 Normal, RPS NotExist")],
            "1.3.6.1.4.1.9.9.13.1.5.1.3": [SnmpValue("1.3.6.1.4.1.9.9.13.1.5.1.3.1003", 2, b"", 1)],
        })

        sensors = []
        sensors.extend(_collect_cisco_temperature_environment(client))
        sensors.extend(_collect_cisco_fan_environment(client))
        sensors.extend(_collect_cisco_power_supply_environment(client))
        summary = _summarize_environment(sensors)

        self.assertEqual(summary["temperature_c"], 50)
        self.assertEqual(summary["temperature_threshold_c"], 65)
        self.assertEqual(summary["temperature_status"], "normal")
        self.assertEqual(summary["fan_status"], "normal")
        self.assertEqual(summary["power_supply_status"], "normal")
        self.assertIsNone(summary["power_w"])
        self.assertEqual(summary["temperature_sensors"][0]["label"], "SW#1, Sensor#1, GREEN")
        self.assertEqual(summary["power_supply_sensors"][0]["label"], "Sw1, PS1 Normal, RPS NotExist")

    def test_configuration_backups_keep_latest_five(self):
        init_db()
        db = SessionLocal()
        device = Device(name="Backup-Retention-Test", management_ip="192.0.2.10", role="Switch", status="Active")
        try:
            db.add(device)
            db.commit()
            db.refresh(device)
            for index in range(6):
                create_config_backup(db, device, f"version {index}", status="ok", source="test", created_by="test")
                db.commit()

            backups = list_config_backups(db, device.id)

            self.assertEqual(len(backups), 5)
            self.assertEqual(backups[0].snapshot, "version 5")
            self.assertEqual(backups[-1].snapshot, "version 1")
        finally:
            if device.id:
                db.query(DeviceConfigBackup).filter(DeviceConfigBackup.device_id == device.id).delete()
                db.query(Device).filter(Device.id == device.id).delete()
                db.commit()
            db.close()

    def test_serialize_device_handles_json_strings_and_datetime_values(self):
        site = Site(id=1, name="HQ")
        device = Device(
            id=1,
            name="Core-SW-01",
            hostname="core-sw-01",
            management_ip="10.0.0.10",
            role="Core Switch",
            status="Active",
            platform="Cisco",
            manufacturer="Cisco",
            model="Catalyst 9300",
            description="Core switch",
            tags="production",
            site_id=1,
            vlan=10,
            vlans='[{"id": 10, "name": "Users", "source": "snmp"}]',
            connection="Ethernet",
            interfaces='[{"name": "Gi1/0/1", "ip": "10.0.0.2", "status": "up"}]',
            snmp_status="OK",
            config_status="SNMP collected inventory. Running configuration requires SSH/Telnet/API credentials.",
            last_seen_at=datetime(2026, 7, 11, 21, 27, 12, tzinfo=timezone.utc),
        )
        device.site = site

        payload = _serialize_device(device)

        self.assertEqual(payload["name"], "Core-SW-01")
        self.assertEqual(payload["site"], {"name": "HQ"})
        self.assertEqual(payload["interfaces"][0]["name"], "Gi1/0/1")
        self.assertEqual(payload["interfaces"][0]["ip_addresses"], ["10.0.0.2"])
        self.assertTrue(payload["interfaces"][0]["enabled"])
        self.assertEqual(payload["interfaces"][0]["display_status"], "Connected")
        self.assertEqual(payload["interfaces"][0]["label"], "")
        self.assertEqual(payload["vlans"], [{"id": 10, "name": "Users", "source": "snmp"}])
        self.assertEqual(payload["snmp_status"], "OK")
        self.assertEqual(payload["last_seen_at"], "2026-07-11T21:27:12+00:00")

    def test_serialize_device_parses_vlans_from_configuration_snapshot(self):
        device = Device(
            id=2,
            name="Access-SW",
            management_ip="10.0.0.2",
            role="Access Switch",
            status="Active",
            vlan=1,
            vlans="[]",
            configuration_snapshot="""
vlan 78
 name PoE_VLAN
!
vlan 91
 name A1
!
vlan 160
 name VoIP
!
interface FastEthernet0/1
 switchport access vlan 91
 switchport mode access
 switchport voice vlan 160
!
interface GigabitEthernet0/1
 switchport trunk native vlan 1
 switchport trunk allowed vlan 78,91,160
 switchport mode trunk
!
""",
        )

        payload = _serialize_device(device)
        vlans = {item["id"]: item for item in payload["vlans"]}

        self.assertEqual(vlans[78]["name"], "PoE_VLAN")
        self.assertEqual(vlans[91]["name"], "A1")
        self.assertIn({"name": "FastEthernet0/1", "mode": "untagged", "source": "ssh-config"}, vlans[91]["ports"])
        self.assertIn({"name": "FastEthernet0/1", "mode": "tagged", "source": "ssh-config"}, vlans[160]["ports"])
        self.assertIn({"name": "GigabitEthernet0/1", "mode": "tagged", "source": "ssh-config"}, vlans[78]["ports"])

    def test_vlan_parser_handles_empty_snapshot(self):
        self.assertEqual(_parse_vlans_from_configuration(""), [])

    def test_interface_parser_extracts_port_detail_from_configuration_snapshot(self):
        interfaces = _parse_interfaces_from_configuration("""
interface FastEthernet0/1
 description User access port
 switchport access vlan 91
 switchport mode access
!
interface GigabitEthernet0/1
 description Core uplink
 switchport trunk native vlan 1
 switchport trunk allowed vlan 78,91,160
 switchport mode trunk
 channel-group 7 mode active
 mtu 9000
!
interface Vlan99
 ip address 192.168.253.11 255.255.255.0
!
interface FastEthernet0/2
 shutdown
!
""")
        rows = {item["name"]: item for item in interfaces}

        self.assertEqual(rows["FastEthernet0/1"]["description"], "User access port")
        self.assertEqual(rows["FastEthernet0/1"]["mode"], "access")
        self.assertTrue(rows["FastEthernet0/1"]["enabled"])
        self.assertEqual(rows["GigabitEthernet0/1"]["mode"], "trunk")
        self.assertEqual(rows["GigabitEthernet0/1"]["lag"], "Port-channel7")
        self.assertEqual(rows["GigabitEthernet0/1"]["mtu"], 9000)
        self.assertEqual(rows["Vlan99"]["ip_addresses"], ["192.168.253.11"])
        self.assertEqual(rows["Vlan99"]["type"], "svi")
        self.assertFalse(rows["FastEthernet0/2"]["enabled"])

    def test_configuration_result_populates_vlans_and_interfaces_when_missing(self):
        device = Device(name="Apply Config", management_ip="10.0.0.20", role="Switch", status="Active", platform="Windows", vlans="[]", interfaces="[]")
        result = ConfigurationResult("Configuration collected over SSH.", snapshot="""
Cisco IOS XE Software, Version 17.09
!
vlan 91
 name Users
!
interface FastEthernet0/1
 description User access
 switchport access vlan 91
 switchport mode access
!
""")

        _apply_configuration_result(device, result, credential_id=12)
        vlans = _parse_vlans_from_configuration(device.configuration_snapshot)
        interfaces = _parse_interfaces_from_configuration(device.configuration_snapshot)

        self.assertEqual(device.config_status, "Configuration collected over SSH.")
        self.assertEqual(device.ssh_credential_id, 12)
        self.assertEqual(device.platform, "Cisco IOS")
        self.assertEqual(vlans[0]["id"], 91)
        self.assertEqual(interfaces[0]["name"], "FastEthernet0/1")
        self.assertIn('"id": 91', device.vlans)
        self.assertIn('"name": "FastEthernet0/1"', device.interfaces)

    def test_serialize_device_enriches_interface_table_with_link_data(self):
        init_db()
        db = SessionLocal()
        local_id = None
        remote_id = None
        link_id = None
        try:
            local = Device(
                name="Interface Local",
                management_ip="10.91.0.1",
                role="Switch",
                status="Active",
                interfaces='[{"name":"GigabitEthernet0/1","ip":"10.91.0.1","status":"up","type":"ethernet","mtu":1500}]',
            )
            remote = Device(name="Interface Remote", management_ip="10.91.0.2", role="Switch", status="Active")
            db.add_all([local, remote])
            db.flush()
            local_id = local.id
            remote_id = remote.id
            link = DeviceLink(
                local_device_id=local.id,
                remote_device_id=remote.id,
                local_device_name=local.name,
                remote_device_name=remote.name,
                local_interface="GigabitEthernet0/1",
                remote_interface="GigabitEthernet0/24",
                protocol="lldp",
            )
            db.add(link)
            db.commit()
            link_id = link.id

            payload = _serialize_device(local, db)
            interface = payload["interfaces"][0]
            self.assertEqual(interface["label"], "Gi0/1")
            self.assertEqual(interface["mtu"], 1500)
            self.assertEqual(interface["cable"], "GigabitEthernet0/1 to GigabitEthernet0/24")
            self.assertEqual(interface["connection"], "Interface Remote (LLDP)")
            self.assertEqual(interface["connection_device_id"], remote.id)
            self.assertEqual(interface["connection_device_name"], "Interface Remote")
        finally:
            for model, row_id in [(DeviceLink, link_id), (Device, local_id), (Device, remote_id)]:
                if row_id:
                    row = db.query(model).filter(model.id == row_id).first()
                    if row:
                        db.delete(row)
            db.commit()
            db.close()

    def test_discovery_host_cidr_starts_at_supplied_host(self):
        service = NetworkDiscoveryService(subnet="192.168.220.135/24", max_hosts=3)
        hosts = [str(host) for host in service._hosts_to_scan()]

        self.assertEqual(hosts, ["192.168.220.135", "192.168.220.136", "192.168.220.137"])

    def test_windows_arp_parser_extracts_mac_and_interface(self):
        sample = """
Interface: 192.168.220.1 --- 0x12
  Internet Address      Physical Address      Type
  192.168.220.135       00-11-22-33-44-55     dynamic
"""
        service = NetworkDiscoveryService(subnet="192.168.220.135/24", max_hosts=1)
        original = __import__("subprocess").run

        class Completed:
            stdout = sample

        try:
            __import__("subprocess").run = lambda *args, **kwargs: Completed()
            neighbors = service._load_windows_arp()
        finally:
            __import__("subprocess").run = original

        self.assertEqual(neighbors["192.168.220.135"]["mac"], "00:11:22:33:44:55")
        self.assertEqual(neighbors["192.168.220.135"]["interface"], "192.168.220.1")

    def test_discovery_merges_snmp_interfaces_vlans_and_identity(self):
        service = NetworkDiscoveryService(subnet="192.168.220.135/24", max_hosts=1)
        discovered = {
            "name": "Discovered-192.168.220.135",
            "hostname": "host-192-168-220-135",
            "management_ip": "192.168.220.135",
            "platform": "Windows",
            "mac_address": "",
            "discovery_source": "ping,rdns",
            "description": "Auto-discovered via local network scan",
            "interfaces": [{"name": "mgmt0", "ip": "192.168.220.135", "status": "up"}],
            "vlan": 1,
        }

        service._merge_snmp(discovered, {
            "snmp_status": "OK",
            "snmp_last_error": "",
            "hostname": "core-sw-01",
            "platform": "Cisco IOS",
            "manufacturer": "Cisco",
            "model": "1.3.6.1.4.1.9.1.1745",
            "description": "Cisco IOS Software",
            "interfaces": [
                {"name": "Gi1/0/1", "ip": "192.168.220.135", "status": "up", "mac": "00:11:22:33:44:55", "source": "snmp"}
            ],
            "vlans": [{"id": 10, "name": "Users", "source": "snmp", "ports": [{"name": "Gi1/0/1", "mode": "untagged"}]}],
            "neighbors": [{
                "protocol": "lldp",
                "local_interface": "Gi1/0/1",
                "remote_name": "access-sw-01",
                "remote_interface": "Gi1/0/48",
                "remote_ip": "192.168.220.136",
            }],
            "config_status": "SNMP collected inventory. Running configuration requires SSH/Telnet/API credentials.",
        })

        self.assertEqual(discovered["name"], "core-sw-01")
        self.assertEqual(discovered["manufacturer"], "Cisco")
        self.assertEqual(discovered["mac_address"], "00:11:22:33:44:55")
        self.assertEqual(discovered["interfaces"][0]["name"], "Gi1/0/1")
        self.assertEqual(discovered["vlans"][0]["id"], 10)
        self.assertEqual(discovered["vlans"][0]["ports"][0]["name"], "Gi1/0/1")
        self.assertEqual(discovered["vlan"], 10)
        self.assertEqual(discovered["neighbors"][0]["remote_name"], "access-sw-01")
        self.assertIn("snmp", discovered["discovery_source"])

    def test_snmp_vlan_port_bitmap_is_decoded_to_bridge_ports(self):
        value = SnmpValue("1.3.6.1.2.1.17.7.1.4.3.1.2.10", 4, b"\xa0\x01", b"\xa0\x01")

        self.assertEqual(_decode_port_bitmap(value), [1, 3, 16])

    def test_offline_discovery_items_are_not_new_inventory_candidates(self):
        self.assertFalse(_is_active_discovery({"status": "Offline", "snmp_status": "No response"}))
        self.assertTrue(_is_active_discovery({"status": "Active"}))
        self.assertTrue(_is_active_discovery({"status": "Offline", "snmp_status": "OK"}))
        self.assertTrue(_is_active_discovery({"status": "Offline", "mac_address": "00:11:22:33:44:55"}))

    def test_ssh_collector_uses_platform_specific_detail_commands(self):
        collector = SshConfigurationCollector("admin", "password")

        cisco_commands = collector._commands("Cisco IOS")
        windows_commands = collector._commands("Windows")
        corrected_commands = collector._commands(collector._remote_platform("Windows", "9200L-NEW>"))
        real_windows_commands = collector._commands(collector._remote_platform("Windows", "Microsoft Windows [Version 10.0]\nC:\\>"))

        self.assertIn("show running-config", cisco_commands)
        self.assertIn("show cdp neighbors detail", cisco_commands)
        self.assertIn("show lldp neighbors detail", cisco_commands)
        self.assertIn("ipconfig /all", windows_commands)
        self.assertNotIn("show running-config", windows_commands)
        self.assertIn("show running-config", corrected_commands)
        self.assertNotIn("ipconfig /all", corrected_commands)
        self.assertIn("ipconfig /all", real_windows_commands)

    def test_discovery_neighbor_links_are_persisted(self):
        init_db()
        db = SessionLocal()
        local_id = None
        remote_id = None
        link_id = None
        try:
            local = Device(name="Unit Local", management_ip="10.77.0.1", role="Switch", status="Active")
            remote = Device(name="Unit Remote", hostname="unit-remote", management_ip="10.77.0.2", role="Switch", status="Active")
            db.add_all([local, remote])
            db.commit()
            local_id = local.id
            remote_id = remote.id

            _upsert_device_links(db, local, {
                "neighbors": [{
                    "protocol": "lldp",
                    "local_interface": "Gi1/0/1",
                    "remote_name": "Unit Remote",
                    "remote_ip": "10.77.0.2",
                    "remote_interface": "Gi1/0/48",
                }]
            })
            db.commit()

            link = db.query(DeviceLink).filter(DeviceLink.local_device_id == local.id).first()
            self.assertIsNotNone(link)
            link_id = link.id
            self.assertEqual(link.remote_device_id, remote.id)
            self.assertEqual(link.local_interface, "Gi1/0/1")
            self.assertEqual(link.remote_interface, "Gi1/0/48")
            self.assertEqual(link.protocol, "lldp")
        finally:
            for model, row_id in [(DeviceLink, link_id), (Device, local_id), (Device, remote_id)]:
                if row_id:
                    row = db.query(model).filter(model.id == row_id).first()
                    if row:
                        db.delete(row)
            db.commit()
            db.close()

    def test_device_delete_helper_removes_topology_links_for_deleted_device(self):
        init_db()
        db = SessionLocal()
        local_id = None
        remote_id = None
        unrelated_id = None
        try:
            local = Device(name="Delete Link Local", management_ip="10.66.0.1", role="Switch", status="Active")
            remote = Device(name="Delete Link Remote", management_ip="10.66.0.2", role="Switch", status="Active")
            unrelated = Device(name="Delete Link Other", management_ip="10.66.0.3", role="Switch", status="Active")
            db.add_all([local, remote, unrelated])
            db.flush()
            local_id = local.id
            remote_id = remote.id
            unrelated_id = unrelated.id
            db.add_all([
                DeviceLink(local_device_id=local.id, remote_device_id=remote.id, local_interface="Gi0/1", remote_interface="Gi0/2", protocol="lldp"),
                DeviceLink(local_device_id=unrelated.id, remote_device_id=remote.id, local_interface="Gi0/3", remote_interface="Gi0/4", protocol="cdp"),
            ])
            db.commit()

            removed = _delete_topology_links_for_devices(db, [local.id])
            db.commit()

            self.assertEqual(removed, 1)
            self.assertEqual(db.query(DeviceLink).filter(or_(DeviceLink.local_device_id == local.id, DeviceLink.remote_device_id == local.id)).count(), 0)
            self.assertEqual(db.query(DeviceLink).filter(or_(DeviceLink.local_device_id == remote.id, DeviceLink.remote_device_id == remote.id)).count(), 1)
        finally:
            for model, row_id in [(Device, local_id), (Device, remote_id), (Device, unrelated_id)]:
                if row_id:
                    row = db.query(model).filter(model.id == row_id).first()
                    if row:
                        db.delete(row)
            db.query(DeviceLink).filter(DeviceLink.local_device_id.in_([local_id or 0, remote_id or 0, unrelated_id or 0])).delete(synchronize_session=False)
            db.query(DeviceLink).filter(DeviceLink.remote_device_id.in_([local_id or 0, remote_id or 0, unrelated_id or 0])).delete(synchronize_session=False)
            db.commit()
            db.close()

    def test_topology_neighbor_can_be_ingested_into_inventory(self):
        init_db()
        db = SessionLocal()
        local_id = None
        device_id = None
        link_id = None
        site_id = None
        try:
            local = Device(name="Unit Ingest Local", management_ip="10.88.0.1", role="Switch", status="Active")
            site = Site(name="Unit Ingest Site", location="Lab")
            db.add_all([local, site])
            db.flush()
            local_id = local.id
            site_id = site.id
            link = DeviceLink(
                local_device_id=local.id,
                local_device_name=local.name,
                local_ip=local.management_ip,
                local_interface="Gi1/0/1",
                remote_device_name="Unit Neighbor Pending",
                remote_ip="10.88.0.2",
                remote_interface="Gi0/24",
                protocol="lldp",
            )
            db.add(link)
            db.commit()
            link_id = link.id

            candidate = _neighbor_candidate_for_node(db, _node_id("10.88.0.2", "Unit Neighbor Pending", None))
            self.assertIsNotNone(candidate)
            self.assertEqual(candidate["name"], "Unit Neighbor Pending")
            self.assertEqual(candidate["management_ip"], "10.88.0.2")

            device, created = _upsert_ingested_device(db, candidate, site)
            device_id = device.id
            _attach_neighbor_links(db, candidate, device)
            db.commit()

            refreshed_link = db.query(DeviceLink).filter(DeviceLink.id == link_id).first()
            self.assertTrue(created)
            self.assertEqual(device.name, "Unit Neighbor Pending")
            self.assertEqual(device.discovery_source, "topology-neighbor")
            self.assertEqual(refreshed_link.remote_device_id, device.id)
        finally:
            for model, row_id in [(DeviceLink, link_id), (Device, device_id), (Device, local_id), (Site, site_id)]:
                if row_id:
                    row = db.query(model).filter(model.id == row_id).first()
                    if row:
                        db.delete(row)
            db.commit()
            db.close()

    def test_topology_omits_stale_link_device_ids(self):
        init_db()
        db = SessionLocal()
        link_id = None
        try:
            link = DeviceLink(
                local_device_id=987654,
                local_device_name="Deleted Local",
                local_ip="10.99.0.1",
                local_interface="Gi0/1",
                remote_device_name="Pending Neighbor",
                remote_ip="10.99.0.2",
                remote_interface="Gi0/2",
                protocol="lldp",
            )
            db.add(link)
            db.commit()
            link_id = link.id

            payload = get_topology(db=db, current_user=User(email="unit@test.local"))

            self.assertFalse(any(node["id"] == "ip:10.99.0.1" for node in payload["data"]["nodes"]))
            self.assertFalse(any(item["id"] == link.id for item in payload["data"]["links"]))
        finally:
            if link_id:
                row = db.query(DeviceLink).filter(DeviceLink.id == link_id).first()
                if row:
                    db.delete(row)
            db.commit()
            db.close()

    def test_topology_link_uses_real_devices_and_correct_ports(self):
        init_db()
        db = SessionLocal()
        local_id = None
        remote_id = None
        link_id = None
        try:
            local = Device(name="Topo Local", management_ip="10.55.0.1", role="Switch", status="Active")
            remote = Device(name="Topo Remote", management_ip="10.55.0.2", role="Switch", status="Active")
            db.add_all([local, remote])
            db.flush()
            local_id = local.id
            remote_id = remote.id
            link = DeviceLink(
                local_device_id=local.id,
                remote_device_id=remote.id,
                local_device_name="Old Local Name",
                local_ip="192.0.2.10",
                local_interface="GigabitEthernet1/0/24",
                remote_device_name="Old Remote Name",
                remote_ip="192.0.2.20",
                remote_interface="GigabitEthernet0/1",
                protocol="lldp",
            )
            db.add(link)
            db.commit()
            link_id = link.id

            payload = get_topology(db=db, current_user=User(email="unit@test.local"))
            serialized = next(item for item in payload["data"]["links"] if item["id"] == link.id)

            self.assertEqual(serialized["source"], f"ip:{local.management_ip}")
            self.assertEqual(serialized["target"], f"ip:{remote.management_ip}")
            self.assertEqual(serialized["local_device_id"], local.id)
            self.assertEqual(serialized["remote_device_id"], remote.id)
            self.assertEqual(serialized["local_device_name"], local.name)
            self.assertEqual(serialized["remote_device_name"], remote.name)
            self.assertEqual(serialized["local_ip"], local.management_ip)
            self.assertEqual(serialized["remote_ip"], remote.management_ip)
            self.assertEqual(serialized["local_interface"], "GigabitEthernet1/0/24")
            self.assertEqual(serialized["remote_interface"], "GigabitEthernet0/1")
        finally:
            for model, row_id in [(DeviceLink, link_id), (Device, local_id), (Device, remote_id)]:
                if row_id:
                    row = db.query(model).filter(model.id == row_id).first()
                    if row:
                        db.delete(row)
            db.commit()
            db.close()

    def test_start_job_is_visible_to_other_sessions_while_running(self):
        init_db()
        writer = SessionLocal()
        reader = SessionLocal()
        job_id = None
        try:
            job = start_job(writer, "test_running_visibility", "unit-test", "tester", {"phase": "start"})
            job_id = job.id

            visible = reader.query(Job).filter(Job.id == job.id).first()
            self.assertIsNotNone(visible)
            self.assertEqual(visible.status, "running")
            self.assertEqual(visible.progress, 5)

            update_job_progress(writer, job, 42, {"phase": "unit-test", "checked": 1, "total": 2})
            reader.expire_all()
            updated = reader.query(Job).filter(Job.id == job.id).first()
            self.assertEqual(updated.status, "running")
            self.assertEqual(updated.progress, 42)
            self.assertIn("unit-test", updated.result)

            complete_job(writer, job, {"ok": True})
            writer.commit()
            reader.expire_all()
            completed = reader.query(Job).filter(Job.id == job.id).first()
            self.assertEqual(completed.status, "completed")
            self.assertEqual(completed.progress, 100)
        finally:
            if job_id:
                cleanup = SessionLocal()
                try:
                    row = cleanup.query(Job).filter(Job.id == job_id).first()
                    if row:
                        cleanup.delete(row)
                        cleanup.commit()
                finally:
                    cleanup.close()
            writer.close()
            reader.close()


if __name__ == "__main__":
    unittest.main()
