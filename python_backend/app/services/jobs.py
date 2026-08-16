import json
import os
import socket
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
        attempts=1,
        max_attempts=3,
        worker_id=f"{socket.gethostname()}:{os.getpid()}",
        heartbeat_at=datetime.now(timezone.utc),
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
    if job.status != "running" or job.cancel_requested:
        return job
    job.progress = max(0, min(99, int(progress)))
    job.heartbeat_at = datetime.now(timezone.utc)
    if result is not None:
        job.result = result if isinstance(result, str) else json.dumps(result, default=str)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def complete_job(db: Session, job: Job, result: dict[str, Any] | list[Any] | str | None = None) -> Job:
    if job.cancel_requested:
        return fail_job(db, job, "Job cancellation requested")
    job.status = "completed"
    job.progress = 100
    job.result = result if isinstance(result, str) else json.dumps(result or {}, default=str)
    job.error = ""
    job.finished_at = datetime.now(timezone.utc)
    job.heartbeat_at = datetime.now(timezone.utc)
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
    job.heartbeat_at = datetime.now(timezone.utc)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def request_job_cancellation(db: Session, job: Job) -> Job:
    if job.status in {"running", "queued", "retrying"}:
        job.cancel_requested = 1
        if job.status == "queued":
            job.status = "cancelled"
            job.finished_at = datetime.now(timezone.utc)
        db.add(job)
        db.commit()
        db.refresh(job)
    return job


def retry_job(db: Session, job: Job) -> Job:
    if job.status not in {"failed", "cancelled"}:
        return job
    if job.attempts >= job.max_attempts:
        raise ValueError("Maximum retry attempts reached")
    job.status = "queued"
    job.progress = 0
    job.error = ""
    job.cancel_requested = 0
    job.worker_id = ""
    job.locked_at = None
    job.heartbeat_at = None
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def recover_stale_jobs(db: Session, stale_after_seconds: int = 300) -> int:
    now = datetime.now(timezone.utc)
    stale = db.query(Job).filter(Job.status == "running", Job.heartbeat_at.is_not(None)).all()
    recovered = 0
    for job in stale:
        heartbeat = job.heartbeat_at
        if heartbeat and heartbeat.tzinfo is None:
            heartbeat = heartbeat.replace(tzinfo=timezone.utc)
        if heartbeat and (now - heartbeat).total_seconds() > stale_after_seconds:
            if job.attempts < job.max_attempts and not job.cancel_requested:
                job.status = "retrying"
                job.error = "Worker heartbeat expired; retry requested"
                job.worker_id = ""
                job.locked_at = None
                job.heartbeat_at = now
            else:
                job.status = "failed"
                job.progress = 100
                job.error = "Worker heartbeat expired"
                job.finished_at = now
            recovered += 1
    if recovered:
        db.commit()
    return recovered
