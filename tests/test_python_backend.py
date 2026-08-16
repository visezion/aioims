import json
import os
import subprocess
import sys
import time
import uuid
import unittest
import urllib.parse
import urllib.request
import urllib.error


ROOT = os.path.dirname(os.path.dirname(__file__))
SERVER = os.path.join(ROOT, 'python_backend', 'server.py')
BASE_URL = 'http://127.0.0.1:8007'
PYTHON_BACKEND = os.path.join(ROOT, 'python_backend')
if PYTHON_BACKEND not in sys.path:
    sys.path.insert(0, PYTHON_BACKEND)


class PythonBackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.process = subprocess.Popen(
            [sys.executable, SERVER, '--port', '8007'],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
        )
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f'{BASE_URL}/health', timeout=1) as response:
                    if response.status == 200:
                        return
            except Exception:
                time.sleep(0.2)
        raise AssertionError('Python backend did not start in time')

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=5)

    def test_login_and_devices(self):
        token = self._login()
        payload = self._json_request('/api/v1/devices', headers={'Authorization': f'Bearer {token}'})

        self.assertIsInstance(payload['data']['data'], list)
        self.assertIn('meta', payload['data'])

    def test_inventory_requires_authentication(self):
        self._expect_status('/api/v1/devices', 401)
        self._expect_status('/api/v1/sites', 401)
        self._expect_status('/api/v1/devices-export', 401)
        self._expect_status('/api/v1/settings/device_status_refresh_seconds', 401)
        self._expect_status('/api/v1/settings/snmp_community', 401)
        self._expect_status('/api/v1/credentials', 401)
        self._expect_status('/api/v1/jobs', 401)
        self._expect_status('/api/v1/topology', 401)
        self._expect_status('/api/v1/wireless/controllers', 401)
        self._expect_status('/api/v1/topology/ingest-neighbors', 401, method='POST', payload={'node_ids': ['ip:10.0.0.2']})
        self._expect_status('/api/v1/devices/status-refresh', 401, method='POST')
        self._expect_status('/api/v1/devices/1/collect-config', 401, method='POST')
        self._expect_status('/api/v1/devices/1/terminal', 401, method='POST', payload={'command': 'show version'})
        self._expect_status('/api/v1/protocols/check', 401, method='POST', payload={'target': '127.0.0.1'})

    def test_identity_profile_user_roles_and_token_revocation(self):
        token = self._login()
        headers = {'Authorization': f'Bearer {token}'}
        profile = self._json_request('/api/v1/auth/me', headers=headers)['data']
        self.assertEqual(profile['email'], 'admin@aims.local')
        self.assertEqual(profile['role'], 'administrator')

        suffix = uuid.uuid4().hex[:8]
        email = f'role-test-{suffix}@aims.local'
        created = self._json_request('/api/v1/users', method='POST', headers=headers, payload={
            'email': email,
            'password': 'RoleTestPassword123!',
            'full_name': 'Role Test User',
            'role': 'read_only',
        })['data']
        self.assertEqual(created['role'], 'read_only')
        listed = self._json_request('/api/v1/users', headers=headers)['data']
        self.assertTrue(any(row['email'] == email and row['role'] == 'read_only' for row in listed))
        updated = self._json_request(f"/api/v1/users/{created['id']}", method='PATCH', headers=headers, payload={'role': 'auditor'})['data']
        self.assertEqual(updated['role'], 'auditor')
        auditor_login = self._json_request('/api/v1/auth/login', method='POST', payload={'email': email, 'password': 'RoleTestPassword123!'})
        auditor_headers = {'Authorization': f"Bearer {auditor_login['data']['token']}"}
        self._expect_status('/api/v1/credentials', 403, method='POST', headers=auditor_headers, payload={'name': f'Forbidden {suffix}', 'credential_type': 'ssh', 'username': 'readonly', 'secret': 'not-created'})
        self._json_request(f"/api/v1/users/{created['id']}", method='PATCH', headers=headers, payload={'is_active': False})

        self._json_request('/api/v1/auth/logout', method='POST', headers=headers)
        self._expect_status('/api/v1/auth/me', 401, headers=headers)

    def test_totp_mfa_setup_confirm_and_login(self):
        import pyotp

        token = self._login()
        headers = {'Authorization': f'Bearer {token}'}
        setup = self._json_request('/api/v1/auth/mfa/setup', method='POST', headers=headers)['data']
        secret = setup['secret']
        self.assertFalse(setup['enabled'])
        code = pyotp.TOTP(secret).now()
        self._json_request('/api/v1/auth/mfa/confirm', method='POST', headers=headers, payload={'code': code})
        self._expect_status('/api/v1/auth/me', 401, headers=headers)
        self._expect_status('/api/v1/auth/login', 401, method='POST', payload={'email': 'admin@aims.local', 'password': 'ChangeMe123!'})
        login = self._json_request('/api/v1/auth/login', method='POST', payload={'email': 'admin@aims.local', 'password': 'ChangeMe123!', 'mfa_code': pyotp.TOTP(secret).now()})
        new_headers = {'Authorization': f"Bearer {login['data']['token']}"}
        self.assertTrue(self._json_request('/api/v1/auth/me', headers=new_headers)['data']['mfa_enabled'])
        self._json_request('/api/v1/auth/mfa/disable', method='POST', headers=new_headers)

    def test_alert_and_incident_lifecycle(self):
        from app.db.session import SessionLocal
        from app.models.alert import Alert
        from app.models.incident import Incident

        token = self._login()
        headers = {'Authorization': f'Bearer {token}'}
        fingerprint = f'api-test-{uuid.uuid4().hex}'
        alert_id = None
        incident_id = None
        try:
            alert = self._json_request('/api/v1/operations/alerts', method='POST', headers=headers, payload={
                'fingerprint': fingerprint,
                'title': 'API lifecycle test alert',
                'message': 'Synthetic test alert',
                'severity': 'warning',
                'source': 'test',
            })['data']
            alert_id = alert['id']
            self.assertEqual(alert['status'], 'open')
            acknowledged = self._json_request(f'/api/v1/operations/alerts/{alert_id}/acknowledge', method='POST', headers=headers)['data']
            self.assertEqual(acknowledged['status'], 'acknowledged')
            resolved = self._json_request(f'/api/v1/operations/alerts/{alert_id}/resolve', method='POST', headers=headers)['data']
            self.assertEqual(resolved['status'], 'resolved')
            incident = self._json_request('/api/v1/operations/incidents', method='POST', headers=headers, payload={
                'title': 'Synthetic incident',
                'description': 'Lifecycle test',
                'severity': 'minor',
                'alert_ids': [alert_id],
            })['data']
            incident_id = incident['id']
            self.assertTrue(incident['number'].startswith('INC-'))
            updated = self._json_request(f'/api/v1/operations/incidents/{incident_id}', method='PATCH', headers=headers, payload={'status': 'resolved'})['data']
            self.assertEqual(updated['status'], 'resolved')
        finally:
            db = SessionLocal()
            try:
                if incident_id:
                    db.query(Incident).filter(Incident.id == incident_id).delete(synchronize_session=False)
                if alert_id:
                    db.query(Alert).filter(Alert.id == alert_id).delete(synchronize_session=False)
                db.commit()
            finally:
                db.close()

    def test_compliance_policy_and_automation_approval_workflow(self):
        from app.db.session import SessionLocal
        from app.models.governance import AutomationRequest, CompliancePolicy

        token = self._login()
        headers = {'Authorization': f'Bearer {token}'}
        policy_name = f'API Policy {uuid.uuid4().hex[:8]}'
        policy_id = None
        request_id = None
        try:
            policy = self._json_request('/api/v1/governance/compliance/policies', method='POST', headers=headers, payload={
                'name': policy_name,
                'framework': 'CIS',
                'rules': [{'field': 'snmp_status', 'operator': 'equals', 'value': 'OK'}],
            })['data']
            policy_id = policy['id']
            self.assertEqual(policy['framework'], 'CIS')
            request = self._json_request('/api/v1/governance/automation/requests', method='POST', headers=headers, payload={
                'action': 'collect_configuration',
                'target': 'test-device',
                'dry_run': True,
            })['data']
            request_id = request['id']
            self.assertEqual(request['status'], 'pending')
            approved = self._json_request(f"/api/v1/governance/automation/requests/{request_id}/approve", method='POST', headers=headers)['data']
            self.assertEqual(approved['status'], 'approved')
        finally:
            db = SessionLocal()
            try:
                if request_id:
                    db.query(AutomationRequest).filter(AutomationRequest.id == request_id).delete(synchronize_session=False)
                if policy_id:
                    db.query(CompliancePolicy).filter(CompliancePolicy.id == policy_id).delete(synchronize_session=False)
                db.commit()
            finally:
                db.close()

    def test_insight_records_for_firmware_vulnerability_and_reports(self):
        from app.db.session import SessionLocal
        from app.models.insight import FirmwareRecord, ReportDefinition, VulnerabilityFinding

        token = self._login()
        headers = {'Authorization': f'Bearer {token}'}
        devices = self._json_request('/api/v1/devices?page=1&per_page=1', headers=headers)['data']['data']
        self.assertTrue(devices)
        device_id = devices[0]['id']
        firmware_id = vulnerability_id = report_id = None
        report_name = f'API Report {uuid.uuid4().hex[:8]}'
        try:
            firmware = self._json_request('/api/v1/insights/firmware', method='POST', headers=headers, payload={'device_id': device_id, 'vendor': 'TestVendor', 'version': '1.0', 'recommended_version': '1.1', 'status': 'upgrade_available'})['data']
            firmware_id = firmware['id']
            self.assertEqual(firmware['status'], 'upgrade_available')
            finding = self._json_request('/api/v1/insights/vulnerabilities', method='POST', headers=headers, payload={'device_id': device_id, 'cve': 'CVE-2026-0001', 'severity': 'high', 'title': 'Synthetic finding'})['data']
            vulnerability_id = finding['id']
            resolved = self._json_request(f"/api/v1/insights/vulnerabilities/{vulnerability_id}/resolve", method='POST', headers=headers)['data']
            self.assertEqual(resolved['status'], 'resolved')
            report = self._json_request('/api/v1/insights/reports', method='POST', headers=headers, payload={'name': report_name, 'report_type': 'vulnerability', 'schedule': 'weekly'})['data']
            report_id = report['id']
            self.assertEqual(report['schedule'], 'weekly')
        finally:
            db = SessionLocal()
            try:
                if firmware_id:
                    db.query(FirmwareRecord).filter(FirmwareRecord.id == firmware_id).delete(synchronize_session=False)
                if vulnerability_id:
                    db.query(VulnerabilityFinding).filter(VulnerabilityFinding.id == vulnerability_id).delete(synchronize_session=False)
                if report_id:
                    db.query(ReportDefinition).filter(ReportDefinition.id == report_id).delete(synchronize_session=False)
                db.commit()
            finally:
                db.close()

    def test_wireless_controller_profile_lifecycle(self):
        token = self._login()
        headers = {'Authorization': f'Bearer {token}'}
        self._cleanup_wireless_test_artifacts(headers)
        suffix = uuid.uuid4().hex[:8]
        controller_id = None
        snmp_id = None

        try:
            snmp = self._json_request(
                '/api/v1/credentials',
                method='POST',
                headers=headers,
                payload={
                    'name': f'Wireless SNMP {suffix}',
                    'credential_type': 'snmp_v2c',
                    'secret': 'private-community',
                    'port': 161,
                },
            )
            snmp_id = snmp['data']['id']
            created = self._json_request('/api/v1/wireless/controllers', method='POST', headers=headers, payload={
                'name': f'Test-WLC-{suffix}',
                'vendor': 'ruckus-zonedirector',
                'host': '127.0.0.1',
                'port': 8007,
                'protocol': 'https',
                'username': 'readonly',
                'password': 'secret',
                'snmp_credential_id': snmp_id,
                'site_name': 'Test Wireless Site',
                'verify_tls': False,
                'enabled': True,
                'notes': 'Regression test controller',
            })
            controller = created['data']
            controller_id = controller['id']
            self.assertEqual(controller['vendor'], 'ruckus-zonedirector')
            self.assertEqual(controller['snmp_credential_id'], snmp_id)
            self.assertTrue(controller['password_configured'])
            self.assertNotIn('password_encrypted', controller)

            listed = self._json_request('/api/v1/wireless/controllers', headers=headers)['data']['data']
            self.assertTrue(any(item['id'] == controller_id for item in listed))

            tested = self._json_request(f'/api/v1/wireless/controllers/{controller_id}/test', method='POST', headers=headers)['data']
            self.assertTrue(tested['last_test']['ok'])
        finally:
            if controller_id:
                self._json_request(f'/api/v1/wireless/controllers/{controller_id}', method='DELETE', headers=headers)
            if snmp_id:
                self._json_request(f'/api/v1/credentials/{snmp_id}', method='DELETE', headers=headers)
            self._cleanup_wireless_test_artifacts(headers)

    def test_zonedirector_ap_parser(self):
        from app.api.v1.endpoints.wireless import _parse_zonedirector_ap_all

        output = """
ruckus# show ap all
AP:
 ID:
 1:
  MAC Address= 70:3a:0e:11:22:33
  Device Name= AP-Lobby
  IP Address= 10.10.20.11
  Model= R710
  Status= Connected
 2:
  MAC Address= 70:3a:0e:44:55:66
  Device Name= AP-Meeting
  IP Address= 10.10.20.12
  Model= R510
  Status= Disconnected
ruckus#
"""
        aps = _parse_zonedirector_ap_all(output)
        self.assertEqual(len(aps), 2)
        self.assertEqual(aps[0]['name'], 'AP-Lobby')
        self.assertEqual(aps[0]['management_ip'], '10.10.20.11')
        self.assertEqual(aps[0]['manufacturer'], 'Ruckus')
        self.assertEqual(aps[1]['status'], 'Disconnected')

        approved_only = """
ruckus# show ap all
AP:
ID:
1:
MAC Address= 04:4f:aa:0c:b1:00
Model= zf7962
Approved= Yes
Device Name= 7962 - MAP
Description= 7962 MAP (Living Room)
ruckus#
"""
        approved_aps = _parse_zonedirector_ap_all(approved_only)
        self.assertEqual(len(approved_aps), 1)
        self.assertEqual(approved_aps[0]['name'], '7962 - MAP')
        self.assertEqual(approved_aps[0]['status'], 'Approved')

    def test_inventory_create_export_import_and_scan(self):
        token = self._login()
        suffix = uuid.uuid4().hex[:8]
        created_name = f'Test-Core-{suffix}'
        imported_name = f'Imported-Access-{suffix}'
        created_ip = f'10.250.{int(suffix[:2], 16)}.{int(suffix[2:4], 16)}'
        created_mac = f'02:AA:{suffix[:2]}:{suffix[2:4]}:{suffix[4:6]}:{suffix[6:8]}'.upper()
        imported_ip = f'10.251.{int(suffix[4:6], 16)}.{int(suffix[6:8], 16)}'
        imported_site_name = f'Import Site {suffix}'
        scan_site_name = f'Test Scan {suffix}'
        headers = {'Authorization': f'Bearer {token}'}
        created_id = None
        imported_id = None
        scanned_ids = []

        try:
            create_payload = {
                'name': created_name,
                'hostname': f'{created_name.lower()}.aims.local',
                'management_ip': created_ip,
                'role': 'Core Switch',
                'status': 'Active',
                'device_type': 'Switch',
                'platform': 'TestOS',
                'manufacturer': 'TestVendor',
                'model': 'T-9000',
                'serial_number': f'SN-{suffix}',
                'asset_tag': f'AT-{suffix}',
                'mac_address': created_mac,
                'vlan': 77,
                'connection': 'Fiber',
                'interfaces': [{'name': 'Gi1/0/1', 'ip': created_ip, 'status': 'up'}],
                'location': 'Lab',
                'rack': 'R1',
                'position': 10,
                'rack_units': 2,
                'owner': 'Network Team',
                'tenant': 'Production',
                'description': 'Created by integration test',
                'tags': 'test,inventory',
                'comments': 'Temporary test record',
            }
            created = self._json_request('/api/v1/devices', method='POST', payload=create_payload, headers=headers)
            created_id = created['data']['id']
            self.assertEqual(created['data']['vlan'], 77)
            self.assertEqual(created['data']['rack_units'], 2)
            self.assertEqual(created['data']['interfaces'][0]['name'], 'Gi1/0/1')
            edited = self._json_request(
                f'/api/v1/devices/{created_id}',
                method='PATCH',
                payload={**create_payload, 'model': 'T-9000-EDIT', 'position': 12, 'rack_units': 3},
                headers=headers,
            )
            self.assertEqual(edited['data']['model'], 'T-9000-EDIT')
            self.assertEqual(edited['data']['position'], 12)
            self.assertEqual(edited['data']['rack_units'], 3)
            duplicate = self._expect_status('/api/v1/devices', 409, method='POST', payload=create_payload, headers=headers)
            self.assertIn('already exists', duplicate)

            searched = self._json_request(f'/api/v1/devices?q={created_name}&page=1&per_page=5&sort=name&direction=asc', headers=headers)
            self.assertEqual(searched['data']['meta']['total'], 1)
            searched_by_mac = self._json_request(f'/api/v1/devices?q={urllib.parse.quote(created_mac)}&page=1&per_page=5&sort=name&direction=asc', headers=headers)
            self.assertEqual(searched_by_mac['data']['meta']['total'], 1)
            self.assertEqual(searched_by_mac['data']['data'][0]['mac_address'], created_mac)

            protocol_check = self._json_request(
                '/api/v1/protocols/check',
                method='POST',
                payload={'target': '127.0.0.1', 'protocols': ['icmp', 'ssh'], 'timeout': 0.5},
                headers=headers,
            )
            self.assertEqual(protocol_check['data']['target'], '127.0.0.1')
            self.assertEqual([item['protocol'] for item in protocol_check['data']['results']], ['icmp', 'ssh'])
            self.assertIsInstance(protocol_check['data']['job_id'], int)

            device_protocols = self._json_request(
                f'/api/v1/protocols/device/{created_id}/check?protocols=icmp,ssh&timeout=0.5',
                headers=headers,
            )
            self.assertEqual(device_protocols['data']['device']['id'], created_id)
            self.assertEqual(len(device_protocols['data']['results']), 2)
            self.assertIsInstance(device_protocols['data']['job_id'], int)

            export_text = self._text_request('/api/v1/devices-export', headers=headers)
            self.assertIn(created_name, export_text)
            self.assertIn('interfaces', export_text.splitlines()[0])
            self.assertIn('rack_units', export_text.splitlines()[0])

            csv_body = (
                'name,hostname,management_ip,role,status,site,vlan,connection,interfaces,platform,manufacturer,model,serial_number,asset_tag,location,rack,position,rack_units,owner,tenant,description,tags,comments\n'
                f'{imported_name},{imported_name.lower()}.aims.local,{imported_ip},Access Switch,Active,{imported_site_name},88,Ethernet,"Te1/0/1,{imported_ip},up",ImportOS,ImportVendor,ImportModel,SN-I-{suffix},AT-I-{suffix},Closet,R2,4,2,Ops,Corp,Imported row,"import,test",Imported comment\n'
            )
            imported = self._multipart_request('/api/v1/devices-import', csv_body, headers=headers)
            self.assertGreaterEqual(imported['created'], 1)

            devices = self._json_request(f'/api/v1/devices?q={imported_ip}&per_page=5', headers=headers)['data']['data']
            imported_device = next(device for device in devices if device['management_ip'] == imported_ip)
            imported_id = imported_device['id']
            self.assertEqual(imported_device['vlan'], 88)
            self.assertEqual(imported_device['rack_units'], 2)
            self.assertEqual(imported_device['interfaces'][0]['name'], 'Te1/0/1')

            selected_scan_site = self._json_request(
                '/api/v1/sites',
                method='POST',
                payload={'name': scan_site_name, 'location': 'Scan Lab'},
                headers=headers,
            )['data']
            for stale in self._json_request('/api/v1/devices?q=198.51.100&per_page=10', headers=headers)['data']['data']:
                if stale['management_ip'] in {'198.51.100.1', '198.51.100.2'}:
                    self._json_request(f"/api/v1/devices/{stale['id']}", method='DELETE', headers=headers)

            scan = self._json_request(
                f"/api/v1/discovery/scan?subnet=198.51.100.0/30&max_hosts=2&site_id={selected_scan_site['id']}",
                method='POST',
                headers=headers,
            )
            self.assertEqual(scan['discovered'], 2)
            self.assertIsInstance(scan['job_id'], int)
            self.assertEqual(scan['created'], 0)
            self.assertEqual(scan['updated'], 0)
            self.assertEqual(scan['skipped_offline'], 2)
            devices = self._json_request('/api/v1/devices?q=198.51.100&per_page=10', headers=headers)['data']['data']
            scanned_ids = [device['id'] for device in devices if device['management_ip'] in {'198.51.100.1', '198.51.100.2'}]
            self.assertEqual(scanned_ids, [])

            jobs = self._json_request('/api/v1/jobs?q=198.51.100&per_page=10', headers=headers)['data']['data']
            scan_job = next(job for job in jobs if job['id'] == scan['job_id'])
            self.assertEqual(scan_job['job_type'], 'network_scan')
            self.assertEqual(scan_job['status'], 'completed')
            self.assertEqual(scan_job['progress'], 100)
            self.assertEqual(scan_job['result']['skipped_offline'], 2)
            topology = self._json_request('/api/v1/topology', headers=headers)['data']
            self.assertIn('nodes', topology)
            self.assertIn('links', topology)
        finally:
            for device_id in [created_id, imported_id, *scanned_ids]:
                if device_id:
                    try:
                        self._json_request(f'/api/v1/devices/{device_id}', method='DELETE', headers=headers)
                    except Exception:
                        pass
            try:
                sites = self._json_request('/api/v1/sites', headers=headers)['data']['data']
                for site in sites:
                    if site['name'] in {imported_site_name, scan_site_name}:
                        self._json_request(f"/api/v1/sites/{site['id']}", method='DELETE', headers=headers)
            except Exception:
                pass

    def test_configured_status_refresh(self):
        token = self._login()
        headers = {'Authorization': f'Bearer {token}'}
        suffix = uuid.uuid4().hex[:8]
        device_id = None
        original_setting = self._json_request('/api/v1/settings/device_status_refresh_seconds', headers=headers)['data']['value']
        try:
            updated_setting = self._json_request(
                '/api/v1/settings/device_status_refresh_seconds',
                method='PATCH',
                payload={'value': '15'},
                headers=headers,
            )
            self.assertEqual(updated_setting['data']['value'], '15')

            create_payload = {
                'name': f'Status-Test-{suffix}',
                'management_ip': f'198.51.100.{int(suffix[:2], 16) % 200 + 1}',
                'role': 'Router',
                'status': 'Active',
            }
            created = self._json_request('/api/v1/devices', method='POST', payload=create_payload, headers=headers)
            device_id = created['data']['id']
            refreshed = self._json_request(f'/api/v1/devices/status-refresh?device_id={device_id}&timeout=0.2', method='POST', headers=headers)
            self.assertEqual(refreshed['data']['checked'], 1)
            device = self._json_request(f'/api/v1/devices/{device_id}', headers=headers)['data']
            self.assertEqual(device['status'], 'Offline')
        finally:
            try:
                self._json_request(
                    '/api/v1/settings/device_status_refresh_seconds',
                    method='PATCH',
                    payload={'value': original_setting},
                    headers=headers,
                )
            except Exception:
                pass
            if device_id:
                try:
                    self._json_request(f'/api/v1/devices/{device_id}', method='DELETE', headers=headers)
                except Exception:
                    pass

    def test_snmp_community_is_write_only_setting(self):
        token = self._login()
        headers = {'Authorization': f'Bearer {token}'}
        try:
            saved = self._json_request(
                '/api/v1/settings/snmp_community',
                method='PATCH',
                payload={'value': 'private-community'},
                headers=headers,
            )
            self.assertTrue(saved['data']['configured'])
            self.assertEqual(saved['data']['value'], '')

            loaded = self._json_request('/api/v1/settings/snmp_community', headers=headers)
            self.assertTrue(loaded['data']['configured'])
            self.assertEqual(loaded['data']['value'], '')
            self.assertNotIn('private-community', json.dumps(loaded))
        finally:
            self._json_request(
                '/api/v1/settings/snmp_community',
                method='PATCH',
                payload={'value': ''},
                headers=headers,
            )

    def test_credential_profiles_are_write_only_and_usable_for_scan(self):
        token = self._login()
        headers = {'Authorization': f'Bearer {token}'}
        suffix = uuid.uuid4().hex[:8]
        snmp_id = None
        ssh_id = None
        scan_device_id = None
        scanned_ids = []
        scan_site_name = f'Credential Scan {suffix}'
        scan_ip = f'203.0.113.{int(suffix[:2], 16) % 200 + 1}'
        try:
            snmp = self._json_request(
                '/api/v1/credentials',
                method='POST',
                payload={
                    'name': f'Test SNMP {suffix}',
                    'credential_type': 'snmp_v2c',
                    'secret': 'private-community',
                    'port': 161,
                },
                headers=headers,
            )
            snmp_id = snmp['data']['id']
            self.assertTrue(snmp['data']['has_secret'])
            self.assertNotIn('private-community', json.dumps(snmp))

            ssh = self._json_request(
                '/api/v1/credentials',
                method='POST',
                payload={
                    'name': f'Test SSH {suffix}',
                    'credential_type': 'ssh',
                    'username': 'admin',
                    'secret': 'ssh-password',
                    'enable_secret': 'enable-password',
                    'port': 22,
                },
                headers=headers,
            )
            ssh_id = ssh['data']['id']
            self.assertTrue(ssh['data']['has_secret'])
            self.assertTrue(ssh['data']['has_enable_secret'])
            self.assertNotIn('ssh-password', json.dumps(ssh))
            self.assertNotIn('enable-password', json.dumps(ssh))

            loaded = self._json_request('/api/v1/credentials', headers=headers)
            self.assertTrue(any(item['id'] == snmp_id for item in loaded['data']['data']))

            scan_device = self._json_request(
                '/api/v1/devices',
                method='POST',
                payload={
                    'name': f'Credential-Target-{suffix}',
                    'management_ip': scan_ip,
                    'role': 'Router',
                    'status': 'Active',
                    'ssh_credential_id': ssh_id,
                },
                headers=headers,
            )
            scan_device_id = scan_device['data']['id']

            scan = self._json_request(
                f'/api/v1/discovery/scan?subnet={scan_ip}/32&max_hosts=1&site_name={urllib.parse.quote(scan_site_name)}&snmp_credential_id={snmp_id}&ssh_credential_id={ssh_id}&collect_config=false',
                method='POST',
                headers=headers,
            )
            self.assertEqual(scan['discovered'], 1)
            self.assertEqual(scan['created'], 0)
            self.assertGreaterEqual(scan['updated'], 1)
            devices = self._json_request(f'/api/v1/devices?q={scan_ip}&per_page=10', headers=headers)['data']['data']
            scanned_ids = [device['id'] for device in devices if device['id'] != scan_device_id]
            self.assertTrue(any(device['snmp_credential_id'] == snmp_id and device['ssh_credential_id'] == ssh_id for device in devices))
            collected = self._json_request(
                f'/api/v1/devices/{scan_device_id}/collect-config?timeout=0.2',
                method='POST',
                headers=headers,
            )
            self.assertIsInstance(collected['job_id'], int)
            self.assertIn('SSH configuration collection failed', collected['data']['config_status'])
            terminal = self._json_request(
                f'/api/v1/devices/{scan_device_id}/terminal?timeout=0.2',
                method='POST',
                payload={'command': 'show version', 'enable': False},
                headers=headers,
            )
            self.assertIsInstance(terminal['job_id'], int)
            self.assertIn('SSH terminal command failed', terminal['data']['status'])
        finally:
            for device_id in [scan_device_id, *scanned_ids]:
                try:
                    if device_id:
                        self._json_request(f'/api/v1/devices/{device_id}', method='DELETE', headers=headers)
                except Exception:
                    pass
            for credential_id in [snmp_id, ssh_id]:
                if credential_id:
                    try:
                        self._json_request(f'/api/v1/credentials/{credential_id}', method='DELETE', headers=headers)
                    except Exception:
                        pass
            try:
                sites = self._json_request('/api/v1/sites', headers=headers)['data']['data']
                for site in sites:
                    if site['name'] == scan_site_name:
                        self._json_request(f"/api/v1/sites/{site['id']}", method='DELETE', headers=headers)
            except Exception:
                pass

    def test_bulk_update_and_delete_devices(self):
        token = self._login()
        headers = {'Authorization': f'Bearer {token}'}
        suffix = uuid.uuid4().hex[:8]
        ids = []
        try:
            for index in range(2):
                created = self._json_request(
                    '/api/v1/devices',
                    method='POST',
                    payload={
                        'name': f'Bulk-Test-{suffix}-{index}',
                        'management_ip': f'10.252.{int(suffix[:2], 16)}.{index + 10}',
                        'role': 'Router',
                        'status': 'Active',
                    },
                    headers=headers,
                )
                ids.append(created['data']['id'])

            updated = self._json_request(
                '/api/v1/devices/bulk',
                method='PATCH',
                payload={'ids': ids, 'values': {'status': 'Maintenance', 'role': 'Firewall', 'vlan': 333}},
                headers=headers,
            )
            self.assertEqual(updated['data']['updated'], 2)
            for device_id in ids:
                device = self._json_request(f'/api/v1/devices/{device_id}', headers=headers)['data']
                self.assertEqual(device['status'], 'Maintenance')
                self.assertEqual(device['role'], 'Firewall')
                self.assertEqual(device['vlan'], 333)

            deleted = self._json_request('/api/v1/devices/bulk-delete', method='POST', payload={'ids': ids}, headers=headers)
            self.assertEqual(deleted['data']['deleted'], 2)
            self.assertIn('topology_links_deleted', deleted['data'])
            ids = []
        finally:
            for device_id in ids:
                try:
                    self._json_request(f'/api/v1/devices/{device_id}', method='DELETE', headers=headers)
                except Exception:
                    pass

    def test_hierarchy_deletes_do_not_delete_parent_records(self):
        token = self._login()
        headers = {'Authorization': f'Bearer {token}'}
        suffix = uuid.uuid4().hex[:8]
        location_name = f'Parent Location {suffix}'
        room_name = f'Parent Room {suffix}'
        rack_name = f'Parent Rack {suffix}'
        device_id = None
        resources = ('Locations', 'Rooms', 'Racks')
        original_records = {}

        try:
            for resource in resources:
                original_records[resource] = self._json_request(f'/api/v1/infrastructure/{resource}', headers=headers)['data']['records']

            location = {
                'id': f'test-location-{suffix}',
                'name': location_name,
                'site': 'Hierarchy Test Site',
                'status': 'Active',
                'source': 'manual',
                'rooms': 1,
                'roomNames': [room_name],
            }
            room = {
                'id': f'test-room-{suffix}',
                'name': room_name,
                'site': 'Hierarchy Test Site',
                'location': location_name,
                'status': 'Active',
                'source': 'manual',
            }
            rack = {
                'id': f'test-rack-{suffix}',
                'name': rack_name,
                'site': 'Hierarchy Test Site',
                'location': location_name,
                'region': room_name,
                'room': room_name,
                'status': 'Active',
                'source': 'manual',
            }

            self._json_request('/api/v1/infrastructure/Locations', method='PUT', payload={'records': [location, *original_records['Locations']]}, headers=headers)
            self._json_request('/api/v1/infrastructure/Rooms', method='PUT', payload={'records': [room, *original_records['Rooms']]}, headers=headers)
            self._json_request('/api/v1/infrastructure/Racks', method='PUT', payload={'records': [rack, *original_records['Racks']]}, headers=headers)

            created = self._json_request(
                '/api/v1/devices',
                method='POST',
                payload={
                    'name': f'Hierarchy Device {suffix}',
                    'management_ip': f'10.253.{int(suffix[:2], 16)}.10',
                    'role': 'Switch',
                    'status': 'Active',
                    'location': location_name,
                    'room': room_name,
                    'rack': rack_name,
                    'position': 10,
                },
                headers=headers,
            )
            device_id = created['data']['id']

            self._json_request(f'/api/v1/devices/{device_id}', method='DELETE', headers=headers)
            device_id = None
            racks_after_device_delete = self._json_request('/api/v1/infrastructure/Racks', headers=headers)['data']['records']
            self.assertTrue(any(item.get('id') == rack['id'] for item in racks_after_device_delete))

            self._json_request('/api/v1/infrastructure/Racks/bulk-delete', method='POST', payload={'ids': [rack['id']], 'keys': [], 'records': [rack]}, headers=headers)
            rooms_after_rack_delete = self._json_request('/api/v1/infrastructure/Rooms', headers=headers)['data']['records']
            locations_after_rack_delete = self._json_request('/api/v1/infrastructure/Locations', headers=headers)['data']['records']
            self.assertTrue(any(item.get('id') == room['id'] for item in rooms_after_rack_delete))
            self.assertTrue(any(item.get('id') == location['id'] for item in locations_after_rack_delete))

            self._json_request('/api/v1/infrastructure/Rooms/bulk-delete', method='POST', payload={'ids': [room['id']], 'keys': [], 'records': [room]}, headers=headers)
            locations_after_room_delete = self._json_request('/api/v1/infrastructure/Locations', headers=headers)['data']['records']
            self.assertTrue(any(item.get('id') == location['id'] for item in locations_after_room_delete))
        finally:
            if device_id:
                try:
                    self._json_request(f'/api/v1/devices/{device_id}', method='DELETE', headers=headers)
                except Exception:
                    pass
            for resource, records in original_records.items():
                try:
                    self._json_request(f'/api/v1/infrastructure/{resource}', method='PUT', payload={'records': records}, headers=headers)
                except Exception:
                    pass

    def test_recreated_site_is_removed_from_hidden_keys(self):
        token = self._login()
        headers = {'Authorization': f'Bearer {token}'}
        suffix = uuid.uuid4().hex[:8]
        site_name = f'Recreated Site {suffix}'
        site_key = f'site:{site_name}'.lower()
        original_sites = self._json_request('/api/v1/infrastructure/Sites', headers=headers)['data']['records']
        site = {
            'id': f'recreated-site-{suffix}',
            'name': site_name,
            'status': 'Active',
            'source': 'manual',
            '_merge_key': site_key,
        }

        try:
            self._json_request('/api/v1/infrastructure/Sites', method='PUT', payload={'records': [site, *original_sites]}, headers=headers)
            self._json_request('/api/v1/infrastructure/Sites/bulk-delete', method='POST', payload={'ids': [site['id']], 'keys': [site_key], 'records': [site]}, headers=headers)
            hidden_after_delete = self._json_request('/api/v1/infrastructure/Sites', headers=headers)['data']['hidden_keys']
            self.assertIn(site_key, hidden_after_delete)

            saved = self._json_request('/api/v1/infrastructure/Sites', method='PUT', payload={'records': [site, *original_sites]}, headers=headers)
            self.assertGreaterEqual(saved['data']['hidden_removed'], 1)
            hidden_after_recreate = self._json_request('/api/v1/infrastructure/Sites', headers=headers)['data']['hidden_keys']
            self.assertNotIn(site_key, hidden_after_recreate)
        finally:
            try:
                self._json_request('/api/v1/infrastructure/Sites', method='PUT', payload={'records': original_sites}, headers=headers)
            except Exception:
                pass

    def _login(self):
        login_req = urllib.request.Request(
            f'{BASE_URL}/api/v1/auth/login',
            data=json.dumps({'email': 'admin@aims.local', 'password': 'ChangeMe123!'}).encode(),
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(login_req, timeout=5) as response:
            payload = json.loads(response.read().decode())

        self.assertEqual(response.status, 200)
        self.assertIn('token', payload['data'])
        return payload['data']['token']

    def _json_request(self, path, method='GET', payload=None, headers=None):
        request_headers = {'Content-Type': 'application/json'}
        request_headers.update(headers or {})
        data = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(f'{BASE_URL}{path}', data=data, headers=request_headers, method=method)
        with urllib.request.urlopen(request, timeout=20) as response:
            self.assertLess(response.status, 400)
            return json.loads(response.read().decode())

    def _text_request(self, path, headers=None):
        request = urllib.request.Request(f'{BASE_URL}{path}', headers=headers or {}, method='GET')
        with urllib.request.urlopen(request, timeout=20) as response:
            self.assertLess(response.status, 400)
            return response.read().decode()

    def _cleanup_wireless_test_artifacts(self, headers):
        try:
            controllers = self._json_request('/api/v1/wireless/controllers', headers=headers)['data']['data']
            for controller in controllers:
                if (
                    str(controller.get('name', '')).startswith('Test-WLC-')
                    or controller.get('host') == '127.0.0.1'
                    or controller.get('notes') == 'Regression test controller'
                ):
                    self._json_request(f"/api/v1/wireless/controllers/{controller['id']}", method='DELETE', headers=headers)
        except Exception:
            pass

        try:
            credentials = self._json_request('/api/v1/credentials', headers=headers)['data']['data']
            for credential in credentials:
                if str(credential.get('name', '')).startswith('Wireless SNMP '):
                    self._json_request(f"/api/v1/credentials/{credential['id']}", method='DELETE', headers=headers)
        except Exception:
            pass

    def _multipart_request(self, path, file_text, headers=None):
        boundary = f'----AimsBoundary{uuid.uuid4().hex}'
        body = (
            f'--{boundary}\r\n'
            'Content-Disposition: form-data; name="file"; filename="devices.csv"\r\n'
            'Content-Type: text/csv\r\n\r\n'
            f'{file_text}\r\n'
            f'--{boundary}--\r\n'
        ).encode()
        request_headers = {'Content-Type': f'multipart/form-data; boundary={boundary}'}
        request_headers.update(headers or {})
        request = urllib.request.Request(f'{BASE_URL}{path}', data=body, headers=request_headers, method='POST')
        with urllib.request.urlopen(request, timeout=20) as response:
            self.assertLess(response.status, 400)
            return json.loads(response.read().decode())

    def _expect_status(self, path, expected_status, method='GET', payload=None, headers=None):
        request_headers = {'Content-Type': 'application/json'}
        request_headers.update(headers or {})
        data = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(f'{BASE_URL}{path}', data=data, headers=request_headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                body = response.read().decode()
                self.fail(f'Expected {expected_status}, got {response.status}: {body}')
        except urllib.error.HTTPError as exc:
            body = exc.read().decode()
            self.assertEqual(exc.code, expected_status)
            return body


if __name__ == '__main__':
    unittest.main()
