from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    try:
        claims = decode_access_token(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid bearer token") from exc
    user = db.query(User).filter(User.email == claims["subject"]).first()
    if not user or not user.is_active or user.token_version != claims["token_version"]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or unknown user")
    return user


ROLE_PERMISSIONS = {
    "administrator": {"*"},
    "network_engineer": {"inventory:read", "inventory:write", "network:read", "network:operate", "configuration:read", "configuration:write"},
    "operator": {"inventory:read", "network:read", "network:operate", "configuration:read"},
    "auditor": {"inventory:read", "network:read", "configuration:read", "audit:read"},
    "read_only": {"inventory:read", "network:read", "configuration:read"},
}


def require_permission(permission: str):
    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if "*" not in ROLE_PERMISSIONS.get(current_user.role, set()) and permission not in ROLE_PERMISSIONS.get(current_user.role, set()):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user
    return dependency


def require_administrator(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "administrator":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator role required")
    return current_user
