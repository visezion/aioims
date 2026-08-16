from fastapi import APIRouter

from app.api.v1.endpoints import audit, auth, credentials, devices, discovery, governance, imports, infrastructure, insights, jobs, operations, protocols, settings, sites, topology, users, wireless

router = APIRouter()
router.include_router(auth.router, prefix="/auth", tags=["auth"])
router.include_router(devices.router, prefix="/devices", tags=["devices"])
router.include_router(sites.router, prefix="/sites", tags=["sites"])
router.include_router(settings.router, prefix="/settings", tags=["settings"])
router.include_router(credentials.router, prefix="/credentials", tags=["credentials"])
router.include_router(imports.router, tags=["imports"])
router.include_router(infrastructure.router, prefix="/infrastructure", tags=["infrastructure"])
router.include_router(discovery.router, prefix="/discovery", tags=["discovery"])
router.include_router(protocols.router, prefix="/protocols", tags=["protocols"])
router.include_router(jobs.router, prefix="/jobs", tags=["jobs"])
router.include_router(topology.router, prefix="/topology", tags=["topology"])
router.include_router(wireless.router, prefix="/wireless", tags=["wireless"])
router.include_router(users.router, prefix="/users", tags=["users"])
router.include_router(audit.router, prefix="/audit", tags=["audit"])
router.include_router(operations.router, prefix="/operations", tags=["operations"])
router.include_router(governance.router, prefix="/governance", tags=["governance"])
router.include_router(insights.router, prefix="/insights", tags=["insights"])

api_router = router
