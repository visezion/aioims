from datetime import date
from pydantic import BaseModel, Field


class FirmwareCreate(BaseModel):
    device_id: int
    vendor: str = ""
    platform: str = ""
    version: str = ""
    recommended_version: str = ""
    status: str = "unknown"
    release_date: date | None = None
    end_of_support_date: date | None = None
    source: str = "manual"
    notes: str = ""


class VulnerabilityCreate(BaseModel):
    device_id: int | None = None
    cve: str = Field(min_length=4, max_length=50)
    title: str = ""
    severity: str = "medium"
    cvss: str = ""
    source: str = "manual"
    remediation: str = ""


class ReportCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    report_type: str = "inventory"
    schedule: str = "manual"
    enabled: bool = True
    filters: dict = Field(default_factory=dict)
    recipients: list[str] = Field(default_factory=list)
