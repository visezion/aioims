# AIMS - All-in-One Network Infrastructure Management System

AIMS is a local network operations dashboard with a React/Vite frontend and a FastAPI backend.

## What Works

- JWT login with the seeded development account
- Device inventory CRUD
- Manual device add/edit/delete
- CSV device import and export
- Network discovery scan with IP, VLAN, connection, interface, and site metadata
- Site listing and creation API
- Protocol checks for ICMP, SSH, Telnet, HTTP, HTTPS, and SNMP reachability
- SQLite persistence for local development



## Run Locally

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

The API is available at:

```text
http://127.0.0.1:8001/api/v1
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


## Development Account

```text
admin@aims.local
ChangeMe123!
```

## Useful Commands

```powershell
npm run build
npm run test:api
npm run test:backend
```

## Protocol API

Check a target directly:

```http
POST /api/v1/protocols/check
```

Check a saved inventory device:

```http
GET /api/v1/protocols/device/{device_id}/check
```
