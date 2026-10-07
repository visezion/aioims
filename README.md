# AIMS - All-in-One Network Infrastructure Management System

AIMS is a local network operations dashboard with a React/Vite frontend and a FastAPI backend.

## What Works

- JWT login through the application sign-in screen
- Device inventory CRUD
- Manual device add/edit/delete
- CSV device import and export
- Network discovery scan with IP, VLAN, connection, interface, and site metadata
- Site listing and creation API
- Protocol checks for ICMP, SSH, Telnet, HTTP, HTTPS, and SNMP reachability
- SQLite persistence for local development
- PostgreSQL persistence with Alembic migration support for production



## Run Locally

### Windows app shortcut

With the dependencies below installed, run `npm.cmd run app:install` once.
This builds the UI and creates **AIMS** shortcuts on your Desktop and Start menu.
Opening either shortcut automatically starts the local API and UI, waits for the
database to be ready, and opens an Edge/Chrome app window (or your default browser).
No terminal commands are needed for subsequent launches. It does not start at Windows sign-in.

The local app uses `http://127.0.0.1:4173` and API port `8001`, bound to this PC.
It uses the project-root `aims.db`, like `npm run api`, and preserves existing data.
Closing the window leaves the services running until Windows shuts down; reopening
the shortcut reuses them. Keep this project folder and its virtual environment in place.
After changing frontend code, rerun `npm.cmd run app:install` to rebuild.
Startup errors and the first-run generated admin password are in `.local-app/api.log`;
launcher errors are in `.local-app/launcher.log`. Delete the shortcuts to remove them.

Install frontend dependencies:

```powershell
npm install
```

Install backend dependencies in the existing project virtualenv:

```powershell
.\.venv\Scripts\python.exe -m pip install -r python_backend\requirements.txt
```

Start the API:

```powershell
npm run api
```

Start the frontend in another terminal:

```powershell
npm run dev
```

Open:

```text
http://127.0.0.1:4173
```

The API is available on the same server at:

```text
http://<server-ip>:8001/api/v1

The frontend automatically uses the hostname from which it was opened, so the same build works on different servers. Set `CORS_ORIGINS` to restrict allowed frontend origins in production.
```

## Running Tests

Test the wireless plugin system:

```powershell
cd python_backend
pytest tests/test_wireless_plugins.py -v
```

Test all backend components:

```powershell
pytest tests/ -v
```


## First Administrator

Before the first API start, set an administrator password in the terminal that starts the backend:

```powershell
$env:AIMS_BOOTSTRAP_ADMIN_PASSWORD='use-a-long-unique-password'
npm run api
```

The initial account is `admin@aims.local`. If no bootstrap password is supplied, the API generates a one-time password and prints it to its local console.

## Deployment Settings

- `SECRET_KEY`: optional explicit JWT and credential-encryption key. When omitted, AIMS generates and persists a local `.aims_secret_key` file.
- `CORS_ORIGINS`: comma-separated permitted frontend origins. Defaults to the local Vite origins only.
- `AIMS_BOOTSTRAP_ADMIN_PASSWORD`: password used only when creating the first administrator account.
- `AIMS_SCHEMA_MODE`: `auto` for local development or `migrations` for deployments that require `alembic upgrade head` before startup.

For PostgreSQL, set `DATABASE_URL` to a SQLAlchemy URL such as `postgresql+psycopg://aims:password@localhost:5432/aims`, run `alembic upgrade head`, then start the API with `AIMS_SCHEMA_MODE=migrations`.

## Useful Commands

```powershell
npm run build
npm run test:api
npm run test:backend
npm run db:migrate
npm run backup:db
```

## Production containers

Copy the required secrets into a `.env` file, then run `docker compose up --build`. The API waits for PostgreSQL, applies migrations, exposes `/ready` for readiness checks, and exposes Prometheus-compatible counters at `/metrics`. Use `scripts/backup_database.py` on a schedule and copy the generated backup files to durable external storage.

## Protocol API

Check a target directly:

```http
POST /api/v1/protocols/check
```

Check a saved inventory device:

```http
GET /api/v1/protocols/device/{device_id}/check
```
