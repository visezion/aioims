from fastapi import APIRouter

from app.api.v1.endpoints import auth, credentials, devices, discovery, imports, infrastructure, jobs, protocols, settings, sites, topology, wireless

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

api_router = router
