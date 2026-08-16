import os
import shutil
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path


database_url = os.getenv("DATABASE_URL", "sqlite:///./aims.db")
backup_dir = Path(os.getenv("AIMS_BACKUP_DIR", "./backups"))
backup_dir.mkdir(parents=True, exist_ok=True)
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

if database_url.startswith("sqlite"):
    source = Path(database_url.removeprefix("sqlite:///"))
    destination = backup_dir / f"aims-{stamp}.db"
    with sqlite3.connect(source) as source_db, sqlite3.connect(destination) as destination_db:
        source_db.backup(destination_db)
    print(destination)
elif database_url.startswith("postgresql"):
    destination = backup_dir / f"aims-{stamp}.dump"
    subprocess.run(["pg_dump", database_url, "--format=custom", "--file", str(destination)], check=True)
    print(destination)
else:
    raise SystemExit("Unsupported DATABASE_URL backend")
