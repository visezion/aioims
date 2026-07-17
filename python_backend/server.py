import argparse
import asyncio
import os
import sys
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.api import api_router
from app.core.config import settings
from app.db.seed import seed_data
from app.db.session import init_db
from app.services.config_backup_scheduler import run_due_auto_config_backups

load_dotenv()


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


app = FastAPI(
    title="AIMS API",
    version="1.0.0",
    description="Production-ready backend for the AIMS network operations platform",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "aims-python-backend"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=settings.host, help="Host to bind")
    parser.add_argument("--port", type=int, default=settings.port, help="Port to bind")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
    args = parser.parse_args()
    uvicorn.run("server:app", host=args.host, port=args.port, reload=args.reload)
