from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.db.session import Base


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True)
    number = Column(String(50), unique=True, index=True, nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, default="")
    severity = Column(String(50), default="major", index=True)
    status = Column(String(50), default="open", index=True)
    owner = Column(String(255), default="")
    created_by = Column(String(255), default="")
    alert_ids = Column(Text, default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
