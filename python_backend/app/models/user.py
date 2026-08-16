from sqlalchemy import Boolean, Column, Integer, String

from app.db.session import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    full_name = Column(String(255), default="System Admin")
    role = Column(String(50), default="administrator", nullable=False, index=True)
    token_version = Column(Integer, default=0, nullable=False)
    mfa_enabled = Column(Boolean, default=False, nullable=False)
    mfa_secret_encrypted = Column(String(512), default="", nullable=False)
