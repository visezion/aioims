# AIMS Python Backend

This service provides a production-ready API for the AIMS frontend.

## Features
- JWT-based authentication
- Device inventory CRUD and import/export endpoints
- Site management and audit logging
- Network discovery scanning
- Protocol checks for ICMP, SSH, Telnet, HTTP, HTTPS, and SNMP reachability
- SQLite persistence by default for development and local deployments
- Environment-based configuration

## Run locally
```bash
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r python_backend/requirements.txt
python python_backend/server.py --reload
```

## API base URL
The frontend automatically connects to `http://<server-ip>:8001/api/v1` using the hostname from which the UI was opened.

## First start security

Set `AIMS_BOOTSTRAP_ADMIN_PASSWORD` before the first start to create the initial `admin@aims.local` account. If it is not set, the API generates a one-time password and prints it to the local server console. Set `CORS_ORIGINS` for deployed frontend origins and optionally set `SECRET_KEY`; otherwise AIMS persists a generated local key in `.aims_secret_key`.

## Main endpoints
- `POST /api/v1/auth/login`
- `GET|POST /api/v1/sites`
- `GET|PATCH|DELETE /api/v1/sites/{site_id}`
- `GET|POST /api/v1/devices`
- `PATCH /api/v1/devices/bulk`
- `POST /api/v1/devices/bulk-delete`
- `POST /api/v1/devices/status-refresh`
- `PATCH|DELETE /api/v1/devices/{device_id}`
- `POST /api/v1/devices-import`
- `GET /api/v1/devices-export`
- `POST /api/v1/discovery/scan`
- `POST /api/v1/protocols/check`
- `GET /api/v1/protocols/device/{device_id}/check`
- `GET|PATCH /api/v1/settings/device_status_refresh_seconds`
- `GET|PATCH /api/v1/settings/snmp_community`
