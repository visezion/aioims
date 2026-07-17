from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models.device import Device
from app.models.audit_log import AuditLog
from app.models.site import Site
from app.models.user import User
from app.schemas.site import SiteCreate, SiteOut, SiteUpdate

router = APIRouter()


@router.get("", response_model=dict)
def list_sites(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sites = db.query(Site).order_by(Site.name.asc()).all()
    return {"message": "ok", "data": {"data": [SiteOut.model_validate(site).model_dump() for site in sites]}}


@router.get("/{site_id}", response_model=dict)
def get_site(site_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    site = db.query(Site).filter(Site.id == site_id).first()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    return {"message": "ok", "data": SiteOut.model_validate(site).model_dump()}


@router.post("", response_model=dict)
def create_site(payload: SiteCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if db.query(Site).filter(Site.name == payload.name).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Site name already exists")
    site = Site(**payload.model_dump())
    db.add(site)
    db.commit()
    db.refresh(site)
    db.add(AuditLog(action="create_site", entity_type="site", entity_id=site.id, details=f"{current_user.email}: {site.name}"))
    db.commit()
    return {"message": "created", "data": SiteOut.model_validate(site).model_dump()}


@router.patch("/{site_id}", response_model=dict)
def update_site(site_id: int, payload: SiteUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    site = db.query(Site).filter(Site.id == site_id).first()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    if payload.name and db.query(Site).filter(Site.name == payload.name, Site.id != site_id).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Site name already exists")
    changed = payload.model_dump(exclude_unset=True)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(site, field, value)
    db.add(AuditLog(action="update_site", entity_type="site", entity_id=site.id, details=f"{current_user.email}: {changed}"))
    db.commit()
    db.refresh(site)
    return {"message": "updated", "data": SiteOut.model_validate(site).model_dump()}


@router.delete("/{site_id}", response_model=dict)
def delete_site(site_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    site = db.query(Site).filter(Site.id == site_id).first()
    if not site:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    db.add(AuditLog(action="delete_site", entity_type="site", entity_id=site.id, details=f"{current_user.email}: {site.name}"))
    db.query(Device).filter(Device.site_id == site_id).update({Device.site_id: None})
    db.delete(site)
    db.commit()
    return {"message": "deleted"}
