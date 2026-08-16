import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_administrator, require_permission
from app.models.audit_log import AuditLog
from app.models.governance import AutomationRequest, CompliancePolicy
from app.models.user import User
from app.schemas.governance import AutomationRequestCreate, CompliancePolicyCreate

router = APIRouter()


def _dt(value):
    return value.isoformat() if value else None


def _policy(row: CompliancePolicy) -> dict:
    return {"id": row.id, "name": row.name, "framework": row.framework, "version": row.version, "severity": row.severity, "enabled": row.enabled, "rules": json.loads(row.rules or "[]"), "created_by": row.created_by, "created_at": _dt(row.created_at), "updated_at": _dt(row.updated_at)}


def _request(row: AutomationRequest) -> dict:
    return {"id": row.id, "number": row.number, "action": row.action, "target": row.target, "status": row.status, "dry_run": row.dry_run, "parameters": json.loads(row.parameters or "{}"), "requested_by": row.requested_by, "approved_by": row.approved_by, "rejected_reason": row.rejected_reason, "job_id": row.job_id, "requested_at": _dt(row.requested_at), "decided_at": _dt(row.decided_at), "completed_at": _dt(row.completed_at)}


@router.get("/compliance/policies", response_model=dict)
def list_policies(db: Session = Depends(get_db), _user: User = Depends(require_permission("configuration:read"))):
    return {"message": "ok", "data": [_policy(row) for row in db.query(CompliancePolicy).order_by(CompliancePolicy.name.asc()).all()]}


@router.post("/compliance/policies", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_policy(payload: CompliancePolicyCreate, db: Session = Depends(get_db), user: User = Depends(require_administrator)):
    if db.query(CompliancePolicy).filter(CompliancePolicy.name == payload.name).first():
        raise HTTPException(status_code=409, detail="Policy name already exists")
    row = CompliancePolicy(name=payload.name, framework=payload.framework, version=payload.version, severity=payload.severity, enabled=payload.enabled, rules=json.dumps(payload.rules), created_by=user.email)
    db.add(row)
    db.flush()
    db.add(AuditLog(action="create_compliance_policy", entity_type="compliance_policy", entity_id=row.id, details=json.dumps({"user": user.email, "name": row.name})))
    db.commit()
    db.refresh(row)
    return {"message": "ok", "data": _policy(row)}


@router.get("/automation/requests", response_model=dict)
def list_automation_requests(db: Session = Depends(get_db), _user: User = Depends(require_permission("configuration:read"))):
    return {"message": "ok", "data": [_request(row) for row in db.query(AutomationRequest).order_by(AutomationRequest.id.desc()).limit(500).all()]}


@router.post("/automation/requests", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_automation_request(payload: AutomationRequestCreate, db: Session = Depends(get_db), user: User = Depends(require_permission("configuration:write"))):
    row = AutomationRequest(number="PENDING", action=payload.action, target=payload.target, dry_run=payload.dry_run, parameters=json.dumps(payload.parameters), requested_by=user.email)
    db.add(row)
    db.flush()
    row.number = f"CHG-{datetime.now(timezone.utc):%Y%m%d}-{row.id:05d}"
    db.add(AuditLog(action="request_automation", entity_type="automation_request", entity_id=row.id, details=json.dumps({"user": user.email, "number": row.number})))
    db.commit()
    db.refresh(row)
    return {"message": "ok", "data": _request(row)}


@router.post("/automation/requests/{request_id}/approve", response_model=dict)
def approve_automation_request(request_id: int, db: Session = Depends(get_db), user: User = Depends(require_administrator)):
    row = db.query(AutomationRequest).filter(AutomationRequest.id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Automation request not found")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail="Only pending requests can be approved")
    row.status = "approved"
    row.approved_by = user.email
    row.decided_at = datetime.now(timezone.utc)
    db.add(AuditLog(action="approve_automation", entity_type="automation_request", entity_id=row.id, details=json.dumps({"user": user.email})))
    db.commit()
    db.refresh(row)
    return {"message": "approved", "data": _request(row)}


@router.post("/automation/requests/{request_id}/reject", response_model=dict)
def reject_automation_request(request_id: int, reason: str = "Rejected by administrator", db: Session = Depends(get_db), user: User = Depends(require_administrator)):
    row = db.query(AutomationRequest).filter(AutomationRequest.id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Automation request not found")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail="Only pending requests can be rejected")
    row.status = "rejected"
    row.rejected_reason = reason[:2000]
    row.approved_by = user.email
    row.decided_at = datetime.now(timezone.utc)
    db.add(AuditLog(action="reject_automation", entity_type="automation_request", entity_id=row.id, details=json.dumps({"user": user.email, "reason": row.rejected_reason})))
    db.commit()
    db.refresh(row)
    return {"message": "rejected", "data": _request(row)}
