from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.db.session import Base


class TraceSnapshot(Base):
    __tablename__ = "trace_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    query_key = Column(String(255), nullable=False, unique=True, index=True)
    query = Column(String(255), nullable=False, default="")
    trace_data = Column(Text, nullable=False, default="{}")
    last_traced_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    created_by = Column(String(255), default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)
