from pydantic import BaseModel


class LoginRequest(BaseModel):
    email: str
    password: str
    mfa_code: str | None = None


class MfaCodeRequest(BaseModel):
    code: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
