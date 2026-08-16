import os
import secrets

from app.db.session import SessionLocal
from app.models.app_config import AppConfig
from app.models.device import Device
from app.models.site import Site
from app.models.user import User
from app.core.security import get_password_hash


def seed_data() -> None:
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            bootstrap_password = os.getenv("AIMS_BOOTSTRAP_ADMIN_PASSWORD", "").strip() or secrets.token_urlsafe(18)
            if not os.getenv("AIMS_BOOTSTRAP_ADMIN_PASSWORD"):
                print("AIMS created the initial admin account. Set AIMS_BOOTSTRAP_ADMIN_PASSWORD before first start to choose its password.")
                print(f"Initial admin password: {bootstrap_password}")
            db.add(User(email='admin@aims.local', password_hash=get_password_hash(bootstrap_password), full_name='System Admin'))
        seed_demo_data = os.getenv("AIMS_SEED_DEMO_DATA", "").strip().lower() in {"1", "true", "yes", "on"}
        if seed_demo_data and db.query(Site).count() == 0:
            db.add_all([
                Site(name='Headquarters', location='Beirut', latitude='33.8938', longitude='35.5018'),
                Site(name='New York', location='New York', latitude='40.7128', longitude='-74.0060'),
            ])
        if seed_demo_data and db.query(Device).count() == 0:
            db.add_all([
                Device(name='Core-SW-01', hostname='core-sw-01.aims.local', management_ip='10.10.0.10', role='Core Switch', status='Active', platform='Cisco IOS', description='Primary distribution switch', tags='core,production', site_id=1, vlan=1, connection='Ethernet', interfaces='[{"name":"Gi1/0/1","ip":"10.10.0.10","status":"up"}]'),
                Device(name='FW-Headquarters', hostname='fw-hq.aims.local', management_ip='10.10.0.1', role='Firewall', status='Active', platform='FortiGate', description='Edge firewall', tags='security,production', site_id=1, vlan=100, connection='Fiber', interfaces='[{"name":"port1","ip":"10.10.0.1","status":"up"}]'),
                Device(name='Edge-Router-NY', hostname='edge-ny.aims.local', management_ip='10.20.0.1', role='Router', status='Offline', platform='Cisco IOS XE', description='Remote edge router', tags='wan,remote', site_id=2, vlan=200, connection='MPLS', interfaces='[{"name":"Gi0/0","ip":"10.20.0.1","status":"down"}]'),
            ])
        if not db.query(AppConfig).filter(AppConfig.key == 'device_status_refresh_seconds').first():
            db.add(AppConfig(
                key='device_status_refresh_seconds',
                value='60',
                description='How often the device inventory page refreshes operational status, in seconds.',
            ))
        if not db.query(AppConfig).filter(AppConfig.key == 'snmp_community').first():
            db.add(AppConfig(
                key='snmp_community',
                value='',
                description='SNMP v2c read-only community used by discovery and inventory polling.',
            ))
        db.commit()
    finally:
        db.close()
