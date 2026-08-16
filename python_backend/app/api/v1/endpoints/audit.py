from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.models.audit_log import AuditLog
from app.models.user import User

router = APIRouter()

@router.get("", response_model=dict)
def list_audit_logs(db: Session = Depends(get_db), _user: User = Depends(require_permission("audit:read"))):
    rows = db.query(AuditLog).order_by(AuditLog.id.desc()).limit(500).all()
    return {"message": "ok", "data": [{"id": row.id, "action": row.action, "entity_type": row.entity_type, "entity_id": row.entity_id, "details": row.details, "created_at": row.created_at.isoformat() if row.created_at else None} for row in rows]}
