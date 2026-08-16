from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.db.session import Base


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    fingerprint = Column(String(255), unique=True, index=True, nullable=False)
    title = Column(String(255), nullable=False)
    message = Column(Text, default="")
    severity = Column(String(50), default="warning", index=True)
    status = Column(String(50), default="open", index=True)
    source = Column(String(100), default="system", index=True)
    entity_type = Column(String(100), default="")
    entity_id = Column(Integer, nullable=True, index=True)
    details = Column(Text, default="{}")
    first_seen_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    acknowledged_by = Column(String(255), default="")
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(String(255), default="")
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)
