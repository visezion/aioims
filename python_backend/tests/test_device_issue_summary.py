import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.api.v1.endpoints.devices import list_devices


class DeviceIssueSummaryTests(unittest.TestCase):
    def test_only_non_active_devices_count_even_beyond_current_page(self):
        statuses = ['Active', 'active', 'Offline', 'Failed', 'Maintenance', 'Planned']
        devices = [SimpleNamespace(
            status=status, snmp_last_error='SNMP timeout' if index < 2 else None,
            role='', device_type='', platform='', manufacturer='', model='', tags='',
            last_seen_at=None,
        ) for index, status in enumerate(statuses)]
        db = MagicMock()
        query = db.query.return_value.join.return_value
        query = query.order_by.return_value
        query.count.return_value = len(devices)
        query.all.return_value = devices
        query.offset.return_value.limit.return_value.all.return_value = devices[:1]
        with patch('app.api.v1.endpoints.devices._serialize_device', return_value={}):
            result = list_devices(status_filter='', page=1, per_page=1,
                                  direction='asc', db=db, current_user=MagicMock())
        summary = result['data']['meta']['summary']
        self.assertEqual(summary['active'], 2)
        self.assertEqual(summary['issues'], 4)
        self.assertEqual(len(result['data']['data']), 1)


if __name__ == '__main__':
    unittest.main()
