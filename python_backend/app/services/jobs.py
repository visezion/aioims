import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.job import Job


def start_job(db: Session, job_type: str, target: str, created_by: str, parameters: dict[str, Any] | None = None) -> Job:
    job = Job(
        job_type=job_type,
        status="running",
        progress=5,
        target=target,
        created_by=created_by,
        parameters=json.dumps(parameters or {}, default=str),
        started_at=datetime.now(timezone.utc),
    )
    db.add(job)
    db.flush()
    db.commit()
    db.refresh(job)
    return job


def update_job_progress(
    db: Session,
    job: Job,
    progress: int,
    result: dict[str, Any] | list[Any] | str | None = None,
) -> Job:
    if job.status != "running":
        return job
    job.progress = max(0, min(99, int(progress)))
    if result is not None:
        job.result = result if isinstance(result, str) else json.dumps(result, default=str)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def complete_job(db: Session, job: Job, result: dict[str, Any] | list[Any] | str | None = None) -> Job:
    job.status = "completed"
    job.progress = 100
    job.result = result if isinstance(result, str) else json.dumps(result or {}, default=str)
    job.error = ""
    job.finished_at = datetime.now(timezone.utc)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def fail_job(db: Session, job: Job, error: str, result: dict[str, Any] | None = None) -> Job:
    job.status = "failed"
    job.progress = 100
    job.error = error
    job.result = json.dumps(result or {}, default=str)
    job.finished_at = datetime.now(timezone.utc)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job
