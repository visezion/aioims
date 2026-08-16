from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_administrator
from app.core.security import get_password_hash
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate

router = APIRouter()
VALID_ROLES = {"administrator", "network_engineer", "operator", "auditor", "read_only"}


def _serialize(row: User) -> dict:
    return {"id": row.id, "email": row.email, "name": row.full_name, "role": row.role, "is_active": row.is_active, "mfa_enabled": row.mfa_enabled}


@router.get("", response_model=dict)
def list_users(db: Session = Depends(get_db), _admin: User = Depends(require_administrator)):
    return {"message": "ok", "data": [_serialize(row) for row in db.query(User).order_by(User.id.asc()).all()]}


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db), admin: User = Depends(require_administrator)):
    email = payload.email.lower()
    if payload.role not in VALID_ROLES:
        raise HTTPException(status_code=422, detail="Invalid role")
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=409, detail="A user with this email already exists")
    row = User(email=email, password_hash=get_password_hash(payload.password), full_name=payload.full_name or email, role=payload.role)
    db.add(row)
    db.flush()
    db.add(AuditLog(action="create_user", entity_type="user", entity_id=row.id, details=f"{admin.email}: {row.email}"))
    db.commit()
    return {"message": "ok", "data": _serialize(row)}


@router.patch("/{user_id}", response_model=dict)
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_administrator)):
    row = db.query(User).filter(User.id == user_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.role is not None:
        if payload.role not in VALID_ROLES:
            raise HTTPException(status_code=422, detail="Invalid role")
        row.role = payload.role
    if payload.full_name is not None:
        row.full_name = payload.full_name
    if payload.is_active is not None:
        if row.id == admin.id and not payload.is_active:
            raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
        row.is_active = payload.is_active
    if payload.password is not None:
        row.password_hash = get_password_hash(payload.password)
    row.token_version += 1
    db.add(AuditLog(action="update_user", entity_type="user", entity_id=row.id, details=f"{admin.email}: user updated"))
    db.commit()
    return {"message": "ok", "data": _serialize(row)}
