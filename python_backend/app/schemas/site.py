from typing import Optional
from pydantic import BaseModel, ConfigDict


class SiteBase(BaseModel):
    name: str
    location: Optional[str] = None
    latitude: Optional[str] = None
    longitude: Optional[str] = None


class SiteCreate(SiteBase):
    pass


class SiteUpdate(SiteBase):
    name: Optional[str] = None


class SiteOut(SiteBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
