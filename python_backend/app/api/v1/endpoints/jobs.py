import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_permission
from app.models.job import Job
from app.models.user import User
from app.services.jobs import request_job_cancellation, retry_job

router = APIRouter()


@router.get("", response_model=dict)
def list_jobs(
    q: str = "",
    job_type: str = "",
    status_filter: str = Query(default="", alias="status"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("network:read")),
):
    query = db.query(Job)
    if q:
        pattern = f"%{q}%"
        query = query.filter(or_(
            Job.job_type.ilike(pattern),
            Job.target.ilike(pattern),
            Job.created_by.ilike(pattern),
            Job.parameters.ilike(pattern),
            Job.result.ilike(pattern),
            Job.error.ilike(pattern),
        ))
    if job_type:
        query = query.filter(Job.job_type == job_type)
    if status_filter:
        query = query.filter(Job.status == status_filter)

    total = query.count()
    jobs = query.order_by(Job.created_at.desc(), Job.id.desc()).offset((page - 1) * per_page).limit(per_page).all()
    return {
        "message": "ok",
        "data": {
            "data": [_serialize_job(job) for job in jobs],
            "meta": {"page": page, "per_page": per_page, "total": total, "pages": (total + per_page - 1) // per_page},
        },
    }


@router.get("/{job_id}", response_model=dict)
def get_job(job_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_permission("network:read"))):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return {"message": "ok", "data": _serialize_job(job)}


@router.post("/{job_id}/cancel", response_model=dict)
def cancel_job(job_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_permission("network:operate"))):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    request_job_cancellation(db, job)
    return {"message": "ok", "data": _serialize_job(job)}


@router.post("/{job_id}/retry", response_model=dict)
def retry_existing_job(job_id: int, db: Session = Depends(get_db), current_user: User = Depends(require_permission("network:operate"))):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    try:
        retry_job(db, job)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"message": "ok", "data": _serialize_job(job)}


def _serialize_job(job: Job) -> dict:
    return {
        "id": job.id,
        "job_type": job.job_type,
        "status": job.status,
        "progress": job.progress,
        "target": job.target,
        "parameters": _json_value(job.parameters),
        "result": _json_value(job.result),
        "error": job.error,
        "created_by": job.created_by,
        "started_at": _dt(job.started_at),
        "finished_at": _dt(job.finished_at),
        "created_at": _dt(job.created_at),
        "updated_at": _dt(job.updated_at),
        "attempts": job.attempts,
        "max_attempts": job.max_attempts,
        "worker_id": job.worker_id,
        "heartbeat_at": _dt(job.heartbeat_at),
        "cancel_requested": bool(job.cancel_requested),
    }


def _json_value(value: str | None):
    if not value:
        return {}
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return value


def _dt(value) -> str | None:
    if not value:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc).isoformat()
        return value.isoformat()
    return str(value)
