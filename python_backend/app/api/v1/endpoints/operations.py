import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.models.alert import Alert
from app.models.audit_log import AuditLog
from app.models.incident import Incident
from app.models.user import User
from app.schemas.operations import AlertCreate, IncidentCreate, IncidentUpdate

router = APIRouter()
VALID_SEVERITIES = {"info", "warning", "minor", "major", "critical"}
VALID_ALERT_STATUSES = {"open", "acknowledged", "resolved"}
VALID_INCIDENT_STATUSES = {"open", "investigating", "mitigated", "resolved", "closed"}


def _dt(value):
    return value.isoformat() if value else None


def _alert(row: Alert) -> dict:
    try:
        details = json.loads(row.details or "{}")
    except ValueError:
        details = {}
    return {"id": row.id, "fingerprint": row.fingerprint, "title": row.title, "message": row.message, "severity": row.severity, "status": row.status, "source": row.source, "entity_type": row.entity_type, "entity_id": row.entity_id, "details": details, "first_seen_at": _dt(row.first_seen_at), "last_seen_at": _dt(row.last_seen_at), "acknowledged_by": row.acknowledged_by, "acknowledged_at": _dt(row.acknowledged_at), "resolved_by": row.resolved_by, "resolved_at": _dt(row.resolved_at)}


def _incident(row: Incident) -> dict:
    try:
        alert_ids = json.loads(row.alert_ids or "[]")
    except ValueError:
        alert_ids = []
    return {"id": row.id, "number": row.number, "title": row.title, "description": row.description, "severity": row.severity, "status": row.status, "owner": row.owner, "created_by": row.created_by, "alert_ids": alert_ids, "created_at": _dt(row.created_at), "updated_at": _dt(row.updated_at), "resolved_at": _dt(row.resolved_at)}


@router.get("/alerts", response_model=dict)
def list_alerts(status_filter: str = Query(default="", alias="status"), db: Session = Depends(get_db), _user: User = Depends(require_permission("network:read"))):
    query = db.query(Alert)
    if status_filter:
        query = query.filter(Alert.status == status_filter)
    rows = query.order_by(Alert.last_seen_at.desc(), Alert.id.desc()).limit(500).all()
    return {"message": "ok", "data": [_alert(row) for row in rows]}


@router.post("/alerts", response_model=dict)
def upsert_alert(payload: AlertCreate, db: Session = Depends(get_db), user: User = Depends(require_permission("network:operate"))):
    if payload.severity not in VALID_SEVERITIES:
        raise HTTPException(status_code=422, detail="Invalid alert severity")
    row = db.query(Alert).filter(Alert.fingerprint == payload.fingerprint).first()
    now = datetime.now(timezone.utc)
    if row:
        row.title = payload.title
        row.message = payload.message
        row.severity = payload.severity
        row.source = payload.source
        row.entity_type = payload.entity_type
        row.entity_id = payload.entity_id
        row.details = json.dumps(payload.details, default=str)
        row.last_seen_at = now
        if row.status == "resolved":
            row.status = "open"
            row.resolved_by = ""
            row.resolved_at = None
    else:
        row = Alert(fingerprint=payload.fingerprint, title=payload.title, message=payload.message, severity=payload.severity, source=payload.source, entity_type=payload.entity_type, entity_id=payload.entity_id, details=json.dumps(payload.details, default=str), first_seen_at=now, last_seen_at=now)
        db.add(row)
    db.flush()
    db.add(AuditLog(action="upsert_alert", entity_type="alert", entity_id=row.id, details=json.dumps({"user": user.email, "fingerprint": row.fingerprint})))
    db.commit()
    db.refresh(row)
    return {"message": "ok", "data": _alert(row)}


@router.post("/alerts/{alert_id}/acknowledge", response_model=dict)
def acknowledge_alert(alert_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("network:operate"))):
    row = db.query(Alert).filter(Alert.id == alert_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Alert not found")
    row.status = "acknowledged"
    row.acknowledged_by = user.email
    row.acknowledged_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return {"message": "ok", "data": _alert(row)}


@router.post("/alerts/{alert_id}/resolve", response_model=dict)
def resolve_alert(alert_id: int, db: Session = Depends(get_db), user: User = Depends(require_permission("network:operate"))):
    row = db.query(Alert).filter(Alert.id == alert_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Alert not found")
    row.status = "resolved"
    row.resolved_by = user.email
    row.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return {"message": "ok", "data": _alert(row)}


@router.get("/incidents", response_model=dict)
def list_incidents(status_filter: str = Query(default="", alias="status"), db: Session = Depends(get_db), _user: User = Depends(require_permission("network:read"))):
    query = db.query(Incident)
    if status_filter:
        query = query.filter(Incident.status == status_filter)
    return {"message": "ok", "data": [_incident(row) for row in query.order_by(Incident.id.desc()).limit(500).all()]}


@router.post("/incidents", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_incident(payload: IncidentCreate, db: Session = Depends(get_db), user: User = Depends(require_permission("network:operate"))):
    if payload.severity not in VALID_SEVERITIES:
        raise HTTPException(status_code=422, detail="Invalid incident severity")
    row = Incident(number="PENDING", title=payload.title, description=payload.description, severity=payload.severity, owner=payload.owner, created_by=user.email, alert_ids=json.dumps(payload.alert_ids))
    db.add(row)
    db.flush()
    row.number = f"INC-{datetime.now(timezone.utc):%Y%m%d}-{row.id:05d}"
    db.add(AuditLog(action="create_incident", entity_type="incident", entity_id=row.id, details=json.dumps({"user": user.email, "number": row.number})))
    db.commit()
    db.refresh(row)
    return {"message": "ok", "data": _incident(row)}


@router.patch("/incidents/{incident_id}", response_model=dict)
def update_incident(incident_id: int, payload: IncidentUpdate, db: Session = Depends(get_db), user: User = Depends(require_permission("network:operate"))):
    row = db.query(Incident).filter(Incident.id == incident_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Incident not found")
    if payload.status is not None:
        if payload.status not in VALID_INCIDENT_STATUSES:
            raise HTTPException(status_code=422, detail="Invalid incident status")
        row.status = payload.status
        if payload.status in {"resolved", "closed"}:
            row.resolved_at = datetime.now(timezone.utc)
    if payload.severity is not None:
        if payload.severity not in VALID_SEVERITIES:
            raise HTTPException(status_code=422, detail="Invalid incident severity")
        row.severity = payload.severity
    if payload.owner is not None:
        row.owner = payload.owner
    if payload.description is not None:
        row.description = payload.description
    if payload.alert_ids is not None:
        row.alert_ids = json.dumps(payload.alert_ids)
    db.add(AuditLog(action="update_incident", entity_type="incident", entity_id=row.id, details=json.dumps({"user": user.email})))
    db.commit()
    db.refresh(row)
    return {"message": "ok", "data": _incident(row)}
