from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

engine = create_engine(settings.database_url, connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def init_db() -> None:
    from app.models import app_config, credential_profile, device, device_config_backup, device_link, job, site, audit_log, user, wireless_snapshot  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _add_missing_sqlite_columns()


def _add_missing_sqlite_columns() -> None:
    if not settings.database_url.startswith("sqlite"):
        return

    inspector = inspect(engine)
    if "devices" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("devices")}
    required = {
        "device_type": "VARCHAR(100) DEFAULT ''",
        "serial_number": "VARCHAR(100) DEFAULT ''",
        "asset_tag": "VARCHAR(100) DEFAULT ''",
        "mac_address": "VARCHAR(100) DEFAULT ''",
        "discovery_source": "VARCHAR(100) DEFAULT ''",
        "discovered_at": "DATETIME",
        "location": "VARCHAR(255) DEFAULT ''",
        "room": "VARCHAR(100) DEFAULT ''",
        "rack": "VARCHAR(100) DEFAULT ''",
        "position": "INTEGER",
        "rack_units": "INTEGER DEFAULT 1",
        "power_consumption_w": "REAL",
        "owner": "VARCHAR(255) DEFAULT ''",
        "tenant": "VARCHAR(255) DEFAULT ''",
        "comments": "TEXT DEFAULT ''",
        "vlans": "TEXT DEFAULT '[]'",
        "snmp_status": "VARCHAR(100) DEFAULT 'Not checked'",
        "snmp_last_error": "TEXT DEFAULT ''",
        "config_status": "VARCHAR(255) DEFAULT 'Not collected'",
        "configuration_snapshot": "TEXT DEFAULT ''",
        "snmp_credential_id": "INTEGER",
        "ssh_credential_id": "INTEGER",
    }
    with engine.begin() as connection:
        for name, definition in required.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE devices ADD COLUMN {name} {definition}"))
