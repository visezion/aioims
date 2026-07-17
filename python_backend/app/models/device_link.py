from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.db.session import Base


class DeviceLink(Base):
    __tablename__ = "device_links"

    id = Column(Integer, primary_key=True, index=True)
    local_device_id = Column(Integer, nullable=True, index=True)
    remote_device_id = Column(Integer, nullable=True, index=True)
    local_device_name = Column(String(255), default="")
    local_ip = Column(String(100), default="")
    local_interface = Column(String(255), default="")
    remote_device_name = Column(String(255), default="")
    remote_ip = Column(String(100), default="")
    remote_interface = Column(String(255), default="")
    protocol = Column(String(50), default="")
    details = Column(Text, default="{}")
    discovered_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)
