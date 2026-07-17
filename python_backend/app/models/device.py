from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    hostname = Column(String(255), default="")
    management_ip = Column(String(100), default="")
    role = Column(String(100), default="")
    status = Column(String(100), default="Active")
    device_type = Column(String(100), default="")
    platform = Column(String(100), default="")
    manufacturer = Column(String(100), default="")
    model = Column(String(100), default="")
    serial_number = Column(String(100), default="")
    asset_tag = Column(String(100), default="")
    mac_address = Column(String(100), default="")
    discovery_source = Column(String(100), default="")
    discovered_at = Column(DateTime(timezone=True), nullable=True)
    description = Column(Text, default="")
    tags = Column(Text, default="")
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    vlan = Column(Integer, default=1)
    vlans = Column(Text, default="[]")
    connection = Column(String(100), default="Ethernet")
    interfaces = Column(Text, default="[]")
    snmp_status = Column(String(100), default="Not checked")
    snmp_last_error = Column(Text, default="")
    config_status = Column(String(255), default="Not collected")
    configuration_snapshot = Column(Text, default="")
    snmp_credential_id = Column(Integer, nullable=True)
    ssh_credential_id = Column(Integer, nullable=True)
    location = Column(String(255), default="")
    room = Column(String(100), default="")
    rack = Column(String(100), default="")
    position = Column(Integer, nullable=True)
    rack_units = Column(Integer, default=1)
    power_consumption_w = Column(Float, nullable=True)
    owner = Column(String(255), default="")
    tenant = Column(String(255), default="")
    comments = Column(Text, default="")
    site = relationship("Site")
