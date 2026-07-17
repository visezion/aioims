from typing import Optional

from pydantic import BaseModel, Field


class CredentialProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    credential_type: str
    username: Optional[str] = ""
    secret: Optional[str] = ""
    enable_secret: Optional[str] = ""
    port: Optional[int] = None
    notes: Optional[str] = ""


class CredentialProfileUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    credential_type: Optional[str] = None
    username: Optional[str] = None
    secret: Optional[str] = None
    enable_secret: Optional[str] = None
    port: Optional[int] = None
    notes: Optional[str] = None
