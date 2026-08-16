from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.db.session import Base


class CompliancePolicy(Base):
    __tablename__ = "compliance_policies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False)
    framework = Column(String(100), default="internal")
    version = Column(String(50), default="1.0")
    severity = Column(String(50), default="major")
    enabled = Column(Boolean, default=True, nullable=False)
    rules = Column(Text, default="[]")
    created_by = Column(String(255), default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)


class AutomationRequest(Base):
    __tablename__ = "automation_requests"

    id = Column(Integer, primary_key=True, index=True)
    number = Column(String(50), unique=True, nullable=False)
    action = Column(String(255), nullable=False)
    target = Column(String(255), default="")
    status = Column(String(50), default="pending", index=True)
    dry_run = Column(Boolean, default=True, nullable=False)
    parameters = Column(Text, default="{}")
    requested_by = Column(String(255), default="")
    approved_by = Column(String(255), default="")
    rejected_reason = Column(Text, default="")
    job_id = Column(Integer, nullable=True)
    requested_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
