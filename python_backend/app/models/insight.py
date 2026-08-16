from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from app.db.session import Base


class FirmwareRecord(Base):
    __tablename__ = "firmware_records"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=False, index=True)
    vendor = Column(String(100), default="")
    platform = Column(String(100), default="")
    version = Column(String(100), default="")
    recommended_version = Column(String(100), default="")
    status = Column(String(50), default="unknown", index=True)
    release_date = Column(Date, nullable=True)
    end_of_support_date = Column(Date, nullable=True)
    source = Column(String(100), default="manual")
    notes = Column(Text, default="")
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)


class VulnerabilityFinding(Base):
    __tablename__ = "vulnerability_findings"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("devices.id"), nullable=True, index=True)
    cve = Column(String(50), index=True, nullable=False)
    title = Column(String(255), default="")
    severity = Column(String(50), default="medium", index=True)
    status = Column(String(50), default="open", index=True)
    cvss = Column(String(20), default="")
    source = Column(String(100), default="manual")
    remediation = Column(Text, default="")
    detected_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)


class ReportDefinition(Base):
    __tablename__ = "report_definitions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False)
    report_type = Column(String(100), default="inventory")
    schedule = Column(String(100), default="manual")
    enabled = Column(Boolean, default=True, nullable=False)
    filters = Column(Text, default="{}")
    recipients = Column(Text, default="[]")
    created_by = Column(String(255), default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)
