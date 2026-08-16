from pydantic import BaseModel, Field


class CompliancePolicyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    framework: str = "internal"
    version: str = "1.0"
    severity: str = "major"
    enabled: bool = True
    rules: list[dict] = Field(default_factory=list)


class AutomationRequestCreate(BaseModel):
    action: str = Field(min_length=1, max_length=255)
    target: str = ""
    dry_run: bool = True
    parameters: dict = Field(default_factory=dict)
