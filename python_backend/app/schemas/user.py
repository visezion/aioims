from pydantic import BaseModel, Field, field_validator


class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=12)
    full_name: str = Field(default="", max_length=255)
    role: str = "operator"

    @field_validator("email")
    @classmethod
    def validate_email_shape(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized.count("@") != 1 or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("A valid email address is required")
        return normalized


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=255)
    role: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=12)
