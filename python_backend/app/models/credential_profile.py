from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from app.db.session import Base


class CredentialProfile(Base):
    __tablename__ = "credential_profiles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, unique=True, index=True)
    credential_type = Column(String(50), nullable=False, index=True)
    username = Column(String(255), default="")
    port = Column(Integer, nullable=True)
    secret_encrypted = Column(Text, default="")
    enable_secret_encrypted = Column(Text, default="")
    notes = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True)
