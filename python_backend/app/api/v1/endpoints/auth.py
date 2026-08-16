from collections import defaultdict, deque
from datetime import timedelta
from threading import Lock
from time import monotonic

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
import pyotp
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token, get_password_hash, verify_password
from app.core.secret_store import decrypt_secret, encrypt_secret
from app.api.deps import get_current_user
from app.db.session import SessionLocal
from app.models.user import User
from app.schemas.auth import LoginRequest, MfaCodeRequest, TokenResponse

router = APIRouter()
_LOGIN_WINDOW_SECONDS = 15 * 60
_LOGIN_MAX_FAILURES = 8
_login_failures: dict[str, deque[float]] = defaultdict(deque)
_login_lock = Lock()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _login_key(request: Request, username: str) -> str:
    client = request.client.host if request.client else "unknown"
    return f"{client}:{username.strip().lower()}"


def _check_login_rate_limit(key: str) -> None:
    now = monotonic()
    with _login_lock:
        attempts = _login_failures[key]
        while attempts and now - attempts[0] > _LOGIN_WINDOW_SECONDS:
            attempts.popleft()
        if len(attempts) >= _LOGIN_MAX_FAILURES:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many failed login attempts. Try again later.")


def _record_login_failure(key: str) -> None:
    with _login_lock:
        _login_failures[key].append(monotonic())


def _clear_login_failures(key: str) -> None:
    with _login_lock:
        _login_failures.pop(key, None)


def _authenticate(email: str, password: str, request: Request, db: Session) -> User:
    key = _login_key(request, email)
    _check_login_rate_limit(key)
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(password, user.password_hash):
        _record_login_failure(key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    _clear_login_failures(key)
    return user


@router.post("/login", response_model=dict)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = _authenticate(payload.email, payload.password, request, db)
    if user.mfa_enabled:
        if not payload.mfa_code or not pyotp.TOTP(decrypt_secret(user.mfa_secret_encrypted)).verify(payload.mfa_code, valid_window=1):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="MFA code required or invalid")
    token = create_access_token(user.email, timedelta(minutes=settings.access_token_expire_minutes), user.token_version, user.role)
    return {"message": "ok", "data": {"token": token, "user": {"email": user.email, "name": user.full_name, "role": user.role}}}


@router.post("/token", response_model=dict)
def login_form(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = _authenticate(form_data.username, form_data.password, request, db)
    if user.mfa_enabled:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="MFA-enabled accounts must use the JSON login endpoint")
    token = create_access_token(user.email, timedelta(minutes=settings.access_token_expire_minutes), user.token_version, user.role)
    return {"message": "ok", "data": {"token": token}}


@router.post("/mfa/setup", response_model=dict)
def setup_mfa(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    secret = pyotp.random_base32()
    current = db.query(User).filter(User.id == current_user.id).first()
    current.mfa_secret_encrypted = encrypt_secret(secret)
    current.mfa_enabled = False
    db.commit()
    uri = pyotp.TOTP(secret).provisioning_uri(name=current.email, issuer_name=settings.app_name)
    return {"message": "ok", "data": {"secret": secret, "otpauth_uri": uri, "enabled": False}}


@router.post("/mfa/confirm", response_model=dict)
def confirm_mfa(payload: MfaCodeRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    current = db.query(User).filter(User.id == current_user.id).first()
    secret = decrypt_secret(current.mfa_secret_encrypted)
    if not secret or not pyotp.TOTP(secret).verify(payload.code, valid_window=1):
        raise HTTPException(status_code=400, detail="Invalid MFA code")
    current.mfa_enabled = True
    current.token_version += 1
    db.commit()
    return {"message": "ok", "data": {"enabled": True}}


@router.post("/mfa/disable", response_model=dict)
def disable_mfa(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    current = db.query(User).filter(User.id == current_user.id).first()
    current.mfa_enabled = False
    current.mfa_secret_encrypted = ""
    current.token_version += 1
    db.commit()
    return {"message": "ok", "data": {"enabled": False}}


@router.get("/me", response_model=dict)
def current_user_profile(current_user: User = Depends(get_current_user)):
    return {"message": "ok", "data": {"id": current_user.id, "email": current_user.email, "name": current_user.full_name, "role": current_user.role, "is_active": current_user.is_active, "mfa_enabled": current_user.mfa_enabled}}


@router.post("/logout", response_model=dict)
def logout(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == current_user.id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown user")
    user.token_version += 1
    db.commit()
    return {"message": "ok", "data": {"logged_out": True}}
