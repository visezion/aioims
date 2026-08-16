import argparse
import asyncio
import logging
import os
import sys
import time
import uuid
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.api import api_router
from app.core.config import settings
from app.db.seed import seed_data
from app.db.session import init_db
from app.db.session import engine
from app.services.config_backup_scheduler import run_due_auto_config_backups
from app.services.jobs import recover_stale_jobs
from app.db.session import SessionLocal

load_dotenv()
logger = logging.getLogger("aims.api")
_request_metrics = {"requests_total": 0, "responses_4xx_total": 0, "responses_5xx_total": 0}


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_data()
    backup_task = asyncio.create_task(_configuration_backup_scheduler())
    try:
        yield
    finally:
        backup_task.cancel()
        try:
            await backup_task
        except asyncio.CancelledError:
            pass


async def _configuration_backup_scheduler() -> None:
    while True:
        await asyncio.sleep(60)
        await asyncio.to_thread(run_due_auto_config_backups)
        await asyncio.to_thread(_recover_stale_jobs)


def _recover_stale_jobs() -> int:
    db = SessionLocal()
    try:
        return recover_stale_jobs(db)
    finally:
        db.close()


app = FastAPI(
    title="AIMS API",
    version="1.0.0",
    description="Production-ready backend for the AIMS network operations platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_observability(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    started = time.perf_counter()
    _request_metrics["requests_total"] += 1
    try:
        response = await call_next(request)
    except Exception:
        _request_metrics["responses_5xx_total"] += 1
        logger.exception("request_failed request_id=%s method=%s path=%s", request_id, request.method, request.url.path)
        raise
    elapsed_ms = (time.perf_counter() - started) * 1000
    if response.status_code >= 500:
        _request_metrics["responses_5xx_total"] += 1
    elif response.status_code >= 400:
        _request_metrics["responses_4xx_total"] += 1
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    logger.info("request_complete request_id=%s method=%s path=%s status=%s duration_ms=%.2f", request_id, request.method, request.url.path, response.status_code, elapsed_ms)
    return response

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "aims-python-backend"}


@app.get("/ready")
def readiness_check():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database is not ready") from exc
    return {"status": "ready", "service": "aims-python-backend", "database": "ok"}


@app.get("/metrics", response_class=PlainTextResponse)
def metrics():
    lines = ["# HELP aims_requests_total Total HTTP requests handled by this process.", "# TYPE aims_requests_total counter"]
    lines.append(f"aims_requests_total {_request_metrics['requests_total']}")
    lines.append(f"aims_responses_4xx_total {_request_metrics['responses_4xx_total']}")
    lines.append(f"aims_responses_5xx_total {_request_metrics['responses_5xx_total']}")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=settings.host, help="Host to bind")
    parser.add_argument("--port", type=int, default=settings.port, help="Port to bind")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
    args = parser.parse_args()
    uvicorn.run("server:app", host=args.host, port=args.port, reload=args.reload)
