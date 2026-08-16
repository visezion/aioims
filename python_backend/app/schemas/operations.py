from pydantic import BaseModel, Field


class AlertCreate(BaseModel):
    fingerprint: str = Field(min_length=1, max_length=255)
    title: str = Field(min_length=1, max_length=255)
    message: str = ""
    severity: str = "warning"
    source: str = "system"
    entity_type: str = ""
    entity_id: int | None = None
    details: dict = Field(default_factory=dict)


class IncidentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = ""
    severity: str = "major"
    owner: str = ""
    alert_ids: list[int] = Field(default_factory=list)


class IncidentUpdate(BaseModel):
    status: str | None = None
    severity: str | None = None
    owner: str | None = None
    description: str | None = None
    alert_ids: list[int] | None = None
