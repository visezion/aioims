from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


class DeviceConfigBackup(Base):
    __tablename__ = "device_config_backups"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False, index=True)
    snapshot = Column(Text, default="")
    status = Column(String(255), default="")
    source = Column(String(100), default="manual")
    platform = Column(String(100), default="")
    config_hash = Column(String(64), default="", index=True)
    bytes = Column(Integer, default=0)
    ssh_credential_id = Column(Integer, nullable=True)
    job_id = Column(Integer, nullable=True)
    created_by = Column(String(255), default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True, index=True)

    device = relationship("Device")
