from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.db.session import Base


class Job(Base):
    __tablename__ = "jobs"

    id = Column(Integer, primary_key=True, index=True)
    job_type = Column(String(100), nullable=False, index=True)
    status = Column(String(50), default="running", index=True)
    progress = Column(Integer, default=0)
    target = Column(String(255), default="")
    parameters = Column(Text, default="{}")
    result = Column(Text, default="")
    error = Column(Text, default="")
    created_by = Column(String(255), default="")
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)
    attempts = Column(Integer, default=0, nullable=False)
    max_attempts = Column(Integer, default=3, nullable=False)
    worker_id = Column(String(255), default="")
    locked_at = Column(DateTime(timezone=True), nullable=True)
    heartbeat_at = Column(DateTime(timezone=True), nullable=True)
    cancel_requested = Column(Integer, default=0, nullable=False)
