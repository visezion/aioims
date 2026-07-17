from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class DeviceBase(BaseModel):
    name: str
    hostname: Optional[str] = None
    management_ip: Optional[str] = None
    role: str = ""
    status: str = "Active"
    device_type: Optional[str] = None
    platform: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    asset_tag: Optional[str] = None
    mac_address: Optional[str] = None
    discovery_source: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[str] = None
    site_id: Optional[int] = None
    vlan: Optional[int] = None
    vlans: Optional[list[dict]] = None
    connection: Optional[str] = None
    interfaces: Optional[list[dict]] = None
    snmp_status: Optional[str] = None
    snmp_last_error: Optional[str] = None
    config_status: Optional[str] = None
    configuration_snapshot: Optional[str] = None
    snmp_credential_id: Optional[int] = None
    ssh_credential_id: Optional[int] = None
    location: Optional[str] = None
    room: Optional[str] = None
    rack: Optional[str] = None
    position: Optional[int] = None
    rack_units: int = Field(default=1, ge=1, le=52)
    power_consumption_w: Optional[float] = None
    owner: Optional[str] = None
    tenant: Optional[str] = None
    comments: Optional[str] = None


class DeviceCreate(DeviceBase):
    pass


class DeviceUpdate(DeviceBase):
    name: Optional[str] = None


class DeviceBulkUpdate(BaseModel):
    ids: list[int]
    values: DeviceUpdate


class DeviceBulkDelete(BaseModel):
    ids: list[int]


class DeviceOut(DeviceBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    site: Optional[dict] = None
    last_seen_at: Optional[str] = None
    discovered_at: Optional[str] = None
