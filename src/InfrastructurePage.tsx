import { DragEvent, FormEvent, MouseEvent, ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  ArrowLeft,
  Bell,
  Box,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cctv,
  Database,
  DoorOpen,
  Droplets,
  Download,
  Edit3,
  Layers,
  LockKeyhole,
  MapPin,
  MoreHorizontal,
  Network,
  Plug,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Snowflake,
  Tags,
  Thermometer,
  Trash2,
  Warehouse,
  Wifi,
  Zap,
  X,
} from 'lucide-react';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { DeviceTypeRecord, deviceTypeLabel, loadDeviceTypes } from './DeviceTypesPage';
import { EnvironmentMetric, EnvironmentThresholdContext, environmentThresholdTone } from './environmentThresholds';
import { SearchableSelect } from './SearchableSelect';

const api = 'http://127.0.0.1:8001/api/v1';
const DEVICE_RACK_UNITS_KEY = 'aims-device-rack-units';
const DEFAULT_ROOM_NAME = 'Network Room';
export const INFRASTRUCTURE_RESOURCES = ['Sites', 'Locations', 'Rooms', 'Racks', 'VLANs', 'IP Addresses', 'Prefixes', 'VRFs'] as const;
export type InfrastructureResourceName = typeof INFRASTRUCTURE_RESOURCES[number];

type InfraStatus = 'Active' | 'Planned' | 'Reserved' | 'Deprecated' | 'Offline' | 'Maintenance';
type FieldType = 'text' | 'number' | 'textarea' | 'select' | 'image';

type InfraRecord = {
  id: string;
  name: string;
  status: InfraStatus;
  source?: 'manual' | 'device' | 'wireless';
  relatedDeviceIds?: number[];
  relatedWirelessKeys?: string[];
  role?: string;
  site?: string;
  location?: string;
  rack?: string;
  region?: string;
  room?: string;
  tenant?: string;
  vlanId?: string;
  prefix?: string;
  address?: string;
  gateway?: string;
  vrf?: string;
  image?: string;
  buildings?: number;
  rooms?: number;
  roomNames?: string[];
  units?: number;
  usedUnits?: number;
  devices?: number;
  utilization?: number;
  description?: string;
  tags?: string;
  lastUpdated: string;
};

type DeviceVlan = { id: number; name?: string; source?: string; ports?: { name: string; mode?: string }[] };
type DeviceInterface = { name?: string; ip?: string; ip_addresses?: string[]; status?: string; mode?: string };
type InventoryDevice = {
  id: number;
  name: string;
  hostname?: string | null;
  management_ip?: string | null;
  device_type?: string | null;
  manufacturer?: string | null;
  role?: string | null;
  status?: string | null;
  site_id?: number | null;
  site?: { name: string } | null;
  vlan?: number | null;
  vlans?: DeviceVlan[] | null;
  interfaces?: DeviceInterface[] | null;
  location?: string | null;
  room?: string | null;
  rack?: string | null;
  position?: number | null;
  rack_units?: number | null;
  power_consumption_w?: number | null;
  tenant?: string | null;
  owner?: string | null;
  platform?: string | null;
  model?: string | null;
  snmp_status?: string | null;
  snmp_last_error?: string | null;
  config_status?: string | null;
  last_seen_at?: string | null;
};

type RackDeviceEnvironment = {
  temperature_c: number | null;
  temperature_threshold_c?: number | null;
  temperature_status?: string | null;
  fan_status?: string | null;
  power_supply_status?: string | null;
  source?: string;
  loading?: boolean;
  error?: string;
};

type RackTemperatureHistoryPoint = {
  timestamp: number;
  hottest: number;
  average: number | null;
};

type WirelessAp = {
  id?: number | string;
  name?: string | null;
  ap_name?: string | null;
  hostname?: string | null;
  management_ip?: string | null;
  mac_address?: string | null;
  status?: string | null;
  site?: { name: string } | string | null;
  location?: string | null;
  controller_name?: string | null;
  clients?: number | string | null;
  last_seen_at?: string | null;
};

type LocationRelatedTab = 'devices' | 'aps' | 'ips' | 'vlans' | 'racks' | 'prefixes';
type SortDirection = 'asc' | 'desc';
type InfraSortField = 'primary' | 'scope' | 'role' | 'status' | 'utilization' | 'updated';
type InfrastructureOpenTarget = { resource?: InfrastructureResourceName; id?: string; name?: string };
type LocationRelatedData = {
  devices: InventoryDevice[];
  aps: WirelessAp[];
  ips: InfraRecord[];
  vlans: InfraRecord[];
  racks: InfraRecord[];
  prefixes: InfraRecord[];
};
const RACK_UNIT_MM = 44.45;
const RACK_WIDTH_INCHES = 19;
const CREATE_NEW_VALUE = '__new__';

type FieldConfig = {
  key: keyof InfraRecord;
  label: string;
  type?: FieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
};

type ResourceConfig = {
  singular: string;
  icon: typeof Building2;
  subtitle: string;
  primaryLabel: string;
  scopeLabel: string;
  detailTitle: string;
  fields: FieldConfig[];
};

const statuses: InfraStatus[] = ['Active', 'Planned', 'Reserved', 'Maintenance', 'Deprecated', 'Offline'];
const roles = ['Campus', 'Building', 'Academic', 'Data Center', 'Facility', 'Research', 'Floor', 'Room', 'IDF', 'MDF', 'Production', 'Management', 'Wireless', 'Voice', 'Guest', 'Server', 'Transit', 'Loopback'];

const resourceConfigs: Record<InfrastructureResourceName, ResourceConfig> = {
  Sites: {
    singular: 'Site',
    icon: Building2,
    subtitle: 'Manage campuses, branches, data centers, and high-level operational domains.',
    primaryLabel: 'Site',
    scopeLabel: 'Region',
    detailTitle: 'Site Details',
    fields: [
      { key: 'name', label: 'Site name', required: true },
      { key: 'status', label: 'Status', type: 'select', options: statuses, required: true },
      { key: 'role', label: 'Role', type: 'select', options: roles },
      { key: 'region', label: 'Region' },
      { key: 'tenant', label: 'Tenant' },
      { key: 'devices', label: 'Device count', type: 'number' },
      { key: 'utilization', label: 'Utilization %', type: 'number' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'tags', label: 'Tags' },
    ],
  },
  Locations: {
    singular: 'Location',
    icon: MapPin,
    subtitle: 'Track buildings, floors, rooms, and physical areas inside each site.',
    primaryLabel: 'Location',
    scopeLabel: 'Site',
    detailTitle: 'Location Details',
    fields: [
      { key: 'name', label: 'Location name', required: true },
      { key: 'status', label: 'Status', type: 'select', options: statuses, required: true },
      { key: 'site', label: 'Site', required: true },
      { key: 'role', label: 'Role', type: 'select', options: roles },
      { key: 'address', label: 'Address', type: 'textarea', placeholder: 'Street, city, country' },
      { key: 'buildings', label: 'Buildings', type: 'number' },
      { key: 'rooms', label: 'Rooms', type: 'number' },
      { key: 'devices', label: 'Device count', type: 'number' },
      { key: 'image', label: 'Location image', type: 'image' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'tags', label: 'Tags' },
      { key: 'lastUpdated', label: 'Last updated', placeholder: 'Auto-filled when blank' },
    ],
  },
  Racks: {
    singular: 'Rack',
    icon: Server,
    subtitle: 'Manage rack inventory, capacity, occupancy, and assignment.',
    primaryLabel: 'Rack',
    scopeLabel: 'Site / Location',
    detailTitle: 'Rack Details',
    fields: [
      { key: 'name', label: 'Rack name', required: true },
      { key: 'status', label: 'Status', type: 'select', options: statuses, required: true },
      { key: 'site', label: 'Site', required: true },
      { key: 'location', label: 'Location', required: true },
      { key: 'region', label: 'Room', required: true },
      { key: 'role', label: 'Role', type: 'select', options: roles },
      { key: 'units', label: 'Rack units', type: 'number' },
      { key: 'usedUnits', label: 'Used units', type: 'number' },
      { key: 'devices', label: 'Device count', type: 'number' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'tags', label: 'Tags' },
    ],
  },
  Rooms: {
    singular: 'Room',
    icon: DoorOpen,
    subtitle: 'Review rooms defined under each location and their rack/device relationships.',
    primaryLabel: 'Room',
    scopeLabel: 'Location / Site',
    detailTitle: 'Room Details',
    fields: [
      { key: 'name', label: 'Room name', required: true },
      { key: 'status', label: 'Status', type: 'select', options: statuses, required: true },
      { key: 'site', label: 'Site', required: true },
      { key: 'location', label: 'Location', required: true },
      { key: 'devices', label: 'Device count', type: 'number' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'tags', label: 'Tags' },
    ],
  },
  VLANs: {
    singular: 'VLAN',
    icon: Network,
    subtitle: 'Document VLAN IDs, purpose, site scope, prefixes, and VRF assignment.',
    primaryLabel: 'VLAN',
    scopeLabel: 'Site / VRF',
    detailTitle: 'VLAN Details',
    fields: [
      { key: 'name', label: 'VLAN name', required: true },
      { key: 'vlanId', label: 'VLAN ID', type: 'number', required: true },
      { key: 'status', label: 'Status', type: 'select', options: statuses, required: true },
      { key: 'site', label: 'Site' },
      { key: 'vrf', label: 'VRF' },
      { key: 'prefix', label: 'Primary prefix' },
      { key: 'gateway', label: 'Gateway' },
      { key: 'role', label: 'Role', type: 'select', options: roles },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'tags', label: 'Tags' },
    ],
  },
  'IP Addresses': {
    singular: 'IP Address',
    icon: Database,
    subtitle: 'Manage assigned, reserved, and available management or service IP addresses.',
    primaryLabel: 'Address',
    scopeLabel: 'Prefix / Site',
    detailTitle: 'IP Address Details',
    fields: [
      { key: 'address', label: 'IP address', required: true, placeholder: '172.16.32.10/24' },
      { key: 'name', label: 'DNS / label', required: true },
      { key: 'status', label: 'Status', type: 'select', options: statuses, required: true },
      { key: 'prefix', label: 'Prefix' },
      { key: 'site', label: 'Site' },
      { key: 'role', label: 'Role', type: 'select', options: roles },
      { key: 'tenant', label: 'Tenant' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'tags', label: 'Tags' },
    ],
  },
  Prefixes: {
    singular: 'Prefix',
    icon: Layers,
    subtitle: 'Plan routed networks, utilization, gateways, VLAN attachment, and ownership.',
    primaryLabel: 'Prefix',
    scopeLabel: 'Site / VLAN',
    detailTitle: 'Prefix Details',
    fields: [
      { key: 'prefix', label: 'Prefix', required: true, placeholder: '172.16.32.0/24' },
      { key: 'name', label: 'Name', required: true },
      { key: 'status', label: 'Status', type: 'select', options: statuses, required: true },
      { key: 'site', label: 'Site' },
      { key: 'vlanId', label: 'VLAN ID', type: 'number' },
      { key: 'vrf', label: 'VRF' },
      { key: 'gateway', label: 'Gateway' },
      { key: 'utilization', label: 'Utilization %', type: 'number' },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'tags', label: 'Tags' },
    ],
  },
  VRFs: {
    singular: 'VRF',
    icon: Network,
    subtitle: 'Track routing domains, tenant separation, route targets, and assigned prefixes.',
    primaryLabel: 'VRF',
    scopeLabel: 'Site / Tenant',
    detailTitle: 'VRF Details',
    fields: [
      { key: 'name', label: 'VRF name', required: true },
      { key: 'status', label: 'Status', type: 'select', options: statuses, required: true },
      { key: 'site', label: 'Site' },
      { key: 'tenant', label: 'Tenant' },
      { key: 'role', label: 'Role', type: 'select', options: roles },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'tags', label: 'Tags' },
    ],
  },
};

const seedData: Record<InfrastructureResourceName, InfraRecord[]> = {
  Sites: [
    { id: 'site-ciu', name: 'CIU Campus', status: 'Active', role: 'Campus', region: 'Nicosia', tenant: 'AIMS', devices: 306, utilization: 71, description: 'Primary campus network operations site.', tags: 'campus,production', lastUpdated: '2026-07-13T09:40:00+03:00' },
    { id: 'site-dr', name: 'Disaster Recovery', status: 'Planned', role: 'Data center', region: 'Nicosia', tenant: 'AIMS', devices: 24, utilization: 18, description: 'Secondary services and backup infrastructure.', tags: 'backup', lastUpdated: '2026-07-12T16:20:00+03:00' },
  ],
  Locations: [
    { id: 'loc-st', name: 'ST Building', status: 'Active', site: 'CIU Campus', role: 'Building', devices: 42, description: 'Student technology building network area.', tags: 'wireless,switching', lastUpdated: '2026-07-13T09:35:00+03:00' },
    { id: 'loc-eh', name: 'EH Building', status: 'Active', site: 'CIU Campus', role: 'Building', devices: 31, description: 'Engineering hall access network.', tags: 'wireless', lastUpdated: '2026-07-13T09:18:00+03:00' },
  ],
  Racks: [
    { id: 'rack-mdf-01', name: 'MDF-01', status: 'Active', site: 'CIU Campus', location: 'ST Building', role: 'MDF', units: 42, usedUnits: 31, devices: 18, description: 'Core switching and campus distribution rack.', tags: 'core,ups', lastUpdated: '2026-07-13T08:50:00+03:00' },
    { id: 'rack-idf-eh-02', name: 'EH-IDF-02', status: 'Active', site: 'CIU Campus', location: 'EH Building', role: 'IDF', units: 24, usedUnits: 15, devices: 9, description: 'Engineering hall access switch rack.', tags: 'access', lastUpdated: '2026-07-13T08:42:00+03:00' },
  ],
  Rooms: [],
  VLANs: [
    { id: 'vlan-10', name: 'Management', status: 'Active', site: 'CIU Campus', vlanId: '10', vrf: 'default', prefix: '172.16.32.0/24', role: 'Management', description: 'Network device management VLAN.', tags: 'management', lastUpdated: '2026-07-13T09:05:00+03:00' },
    { id: 'vlan-20', name: 'Wireless Clients', status: 'Active', site: 'CIU Campus', vlanId: '20', vrf: 'default', prefix: '172.16.40.0/22', role: 'Wireless', description: 'Campus wireless client VLAN.', tags: 'wireless,clients', lastUpdated: '2026-07-13T09:02:00+03:00' },
  ],
  'IP Addresses': [
    { id: 'ip-zd-primary', name: 'Ruckus Controller Primary', status: 'Active', address: '172.16.32.2/24', prefix: '172.16.32.0/24', site: 'CIU Campus', role: 'Wireless', tenant: 'AIMS', description: 'Primary ZoneDirector management address.', tags: 'controller,snmp', lastUpdated: '2026-07-13T09:55:00+03:00' },
    { id: 'ip-zd-backup', name: 'Ruckus Controller Backup', status: 'Active', address: '172.16.32.3/24', prefix: '172.16.32.0/24', site: 'CIU Campus', role: 'Wireless', tenant: 'AIMS', description: 'Backup ZoneDirector management address.', tags: 'controller,backup', lastUpdated: '2026-07-13T09:49:00+03:00' },
  ],
  Prefixes: [
    { id: 'prefix-mgmt', name: 'Management subnet', status: 'Active', prefix: '172.16.32.0/24', site: 'CIU Campus', vlanId: '10', vrf: 'default', gateway: '172.16.32.1', utilization: 62, description: 'Management subnet for controllers, switches, and access points.', tags: 'management', lastUpdated: '2026-07-13T09:31:00+03:00' },
    { id: 'prefix-wireless', name: 'Wireless clients', status: 'Active', prefix: '172.16.40.0/22', site: 'CIU Campus', vlanId: '20', vrf: 'default', gateway: '172.16.40.1', utilization: 48, description: 'Wireless client address space.', tags: 'wireless,dhcp', lastUpdated: '2026-07-13T09:27:00+03:00' },
  ],
  VRFs: [],
};

function storageKey(resource: InfrastructureResourceName) {
  return `aims-infrastructure-${resource}`;
}

function hiddenRecordsKey(resource: InfrastructureResourceName) {
  return `${storageKey(resource)}-hidden`;
}

function makeId(resource: InfrastructureResourceName) {
  return `${resource.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadRecords(resource: InfrastructureResourceName): InfraRecord[] {
  try {
    const saved = localStorage.getItem(storageKey(resource));
    const rows = saved ? JSON.parse(saved) : seedData[resource];
    const cleaned = resource === 'VRFs' ? removeDemoVrfSeeds(rows) : rows;
    return resource === 'Locations' ? normalizeRecordsForResource(resource, cleaned) : cleaned;
  } catch {
    const rows = seedData[resource];
    return resource === 'Locations' ? normalizeRecordsForResource(resource, rows) : rows;
  }
}

function removeDemoVrfSeeds(records: InfraRecord[]) {
  const demoIds = new Set(['vrf-default', 'vrf-guest']);
  return records.filter((record) => !demoIds.has(record.id));
}

function normalizeRecordsForResource(resource: InfrastructureResourceName, records: InfraRecord[]) {
  if (resource !== 'Locations') return records;
  const byName = new Map<string, InfraRecord>();
  const order: string[] = [];
  records.forEach((record) => {
    const name = String(record.name || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    const normalized = normalizeLocationRoomRecord({ ...record, name });
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, normalized);
      order.push(key);
      return;
    }
    byName.set(key, mergeLocationRecords(existing, normalized));
  });
  return order.map((key) => byName.get(key)!).filter(Boolean);
}

function normalizeLocationRoomRecord(record: InfraRecord) {
  const rooms = Math.max(1, Math.floor(numeric(record.rooms) || 1));
  const names = (record.roomNames || []).map((room) => String(room || '').trim()).filter(Boolean);
  return {
    ...record,
    rooms,
    roomNames: rooms > 1
      ? Array.from({ length: rooms }, (_, index) => names[index] || `Room ${index + 1}`)
      : [names[0] || DEFAULT_ROOM_NAME],
  };
}

function mergeLocationRecords(existing: InfraRecord, incoming: InfraRecord): InfraRecord {
  return {
    ...incoming,
    ...existing,
    site: existing.site || incoming.site,
    role: existing.role || incoming.role,
    status: existing.status || incoming.status,
    description: existing.description || incoming.description,
    rooms: existing.rooms || incoming.rooms,
    roomNames: existing.roomNames?.length ? existing.roomNames : incoming.roomNames,
    relatedDeviceIds: [...new Set([...(existing.relatedDeviceIds || []), ...(incoming.relatedDeviceIds || [])])],
    relatedWirelessKeys: [...new Set([...(existing.relatedWirelessKeys || []), ...(incoming.relatedWirelessKeys || [])])],
    devices: Math.max(numeric(existing.devices), numeric(incoming.devices)),
    lastUpdated: existing.lastUpdated || incoming.lastUpdated,
  };
}

function saveRecords(resource: InfrastructureResourceName, records: InfraRecord[]) {
  localStorage.setItem(storageKey(resource), JSON.stringify(normalizeRecordsForResource(resource, records)));
  window.dispatchEvent(new Event(`aims:infrastructure-${resource.toLowerCase().replace(/\s+/g, '-')}-changed`));
  if (resource === 'Locations') window.dispatchEvent(new Event('aims:infrastructure-locations-changed'));
  if (resource === 'Racks') window.dispatchEvent(new Event('aims:infrastructure-racks-changed'));
  if (resource === 'Sites') window.dispatchEvent(new Event('aims:infrastructure-sites-changed'));
}

function loadHiddenRecordKeys(resource: InfrastructureResourceName): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(hiddenRecordsKey(resource)) || '[]');
    return Array.isArray(saved) ? saved.filter((key) => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function saveHiddenRecordKeys(resource: InfrastructureResourceName, keys: string[]) {
  localStorage.setItem(hiddenRecordsKey(resource), JSON.stringify([...new Set(keys)]));
}

async function loadBackendInfrastructure(resource: InfrastructureResourceName) {
  const auth = await ensureApiToken();
  const response = await fetch(`${api}/infrastructure/${encodeURIComponent(resource)}`, { headers: { Authorization: `Bearer ${auth}` } });
  const json = await response.json();
  if (response.status === 404) return { configured: false, records: [] as InfraRecord[], hiddenKeys: loadHiddenRecordKeys(resource), unavailable: true };
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load infrastructure records from backend.');
  return {
    configured: Boolean(json.data?.configured),
    records: Array.isArray(json.data?.records) ? json.data.records as InfraRecord[] : [],
    hiddenKeys: Array.isArray(json.data?.hidden_keys) ? json.data.hidden_keys.filter((key: unknown) => typeof key === 'string') as string[] : [],
    unavailable: false,
  };
}

async function saveBackendInfrastructure(resource: InfrastructureResourceName, records: InfraRecord[]) {
  const auth = await ensureApiToken();
  const normalizedRecords = normalizeRecordsForResource(resource, records);
  const response = await fetch(`${api}/infrastructure/${encodeURIComponent(resource)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: normalizedRecords.map((record) => ({ ...record, _merge_key: recordMergeKey(resource, record) })) }),
  });
  const json = await response.json();
  if (response.status === 404) return 'unavailable';
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to save infrastructure records to backend.');
  return 'saved';
}

async function deleteBackendInfrastructureRecords(resource: InfrastructureResourceName, records: InfraRecord[], keys: string[], ids: string[]) {
  const auth = await ensureApiToken();
  const response = await fetch(`${api}/infrastructure/${encodeURIComponent(resource)}/bulk-delete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ids,
      keys,
      records: records.map((record) => ({ ...record, _merge_key: recordMergeKey(resource, record) })),
    }),
  });
  const json = await response.json();
  if (response.status === 404) return 'unavailable';
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to delete infrastructure records from backend.');
  return json.data || {};
}

function ensureLinkedInfrastructureRecord(resource: 'Sites' | 'Locations' | 'Racks', record: Partial<InfraRecord> & { name: string }) {
  const cleanName = record.name.trim();
  if (!cleanName) return;
  const rows = loadRecords(resource);
  const exists = rows.some((row) => {
    const sameName = row.name.trim().toLowerCase() === cleanName.toLowerCase();
    if (resource === 'Locations') return sameName;
    const sameSite = !record.site || !row.site || row.site.trim().toLowerCase() === record.site.trim().toLowerCase();
    const sameLocation = resource !== 'Racks' || !record.location || !row.location || row.location.trim().toLowerCase() === record.location.trim().toLowerCase();
    const sameRoom = resource !== 'Racks' || !record.region || !row.region || row.region.trim().toLowerCase() === record.region.trim().toLowerCase();
    return sameName && sameSite && sameLocation && sameRoom;
  });
  if (exists) return;
  saveRecords(resource, [{
    id: makeId(resource),
    status: 'Active',
    source: 'manual',
    lastUpdated: new Date().toISOString(),
    ...record,
    name: cleanName,
  } as InfraRecord, ...rows]);
}

async function ensureApiToken(force = false) {
  const saved = localStorage.getItem('aims-api-token');
  if (saved && !force) return saved;
  const response = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@aims.local', password: 'ChangeMe123!' }),
  });
  const json = await response.json();
  if (!response.ok || !json.data?.token) throw new Error(json.message || 'Unable to authenticate to the API.');
  localStorage.setItem('aims-api-token', json.data.token);
  return json.data.token as string;
}

async function fetchAllDevices(): Promise<InventoryDevice[]> {
  let token = await ensureApiToken();
  const loadPage = async (page: number, auth: string) => {
    const response = await fetch(`${api}/devices?page=${page}&per_page=100&sort=name&direction=asc`, {
      headers: { Authorization: `Bearer ${auth}` },
    });
    if (response.status === 401) {
      localStorage.removeItem('aims-api-token');
      token = await ensureApiToken(true);
      return loadPage(page, token);
    }
    const json = await response.json();
    if (!response.ok) throw new Error(json.message || 'Unable to load device inventory.');
    return json.data as { data: InventoryDevice[]; meta?: { pages?: number } };
  };

  const first = await loadPage(1, token);
  const pages = Math.max(1, Number(first.meta?.pages || 1));
  const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) => loadPage(index + 2, token)));
  return mergeSavedRackUnits([first, ...rest].flatMap((page) => page.data || []));
}

async function fetchDeviceEnvironment(deviceId: number): Promise<RackDeviceEnvironment> {
  let token = await ensureApiToken();
  const load = async (auth: string): Promise<RackDeviceEnvironment> => {
    const response = await fetch(`${api}/devices/${deviceId}/environment`, {
      headers: { Authorization: `Bearer ${auth}` },
    });
    if (response.status === 401) {
      localStorage.removeItem('aims-api-token');
      token = await ensureApiToken(true);
      return load(token);
    }
    const json = await response.json();
    if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load device environment.');
    return json.data || { temperature_c: null };
  };
  return load(token);
}

async function patchDeviceAndReload(deviceId: number, payload: Record<string, unknown>): Promise<InventoryDevice> {
  let token = await ensureApiToken();
  const patch = async (auth: string) => {
    const response = await fetch(`${api}/devices/${deviceId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.status === 401) {
      localStorage.removeItem('aims-api-token');
      token = await ensureApiToken(true);
      return patch(token);
    }
    const json = await response.json();
    if (!response.ok) throw new Error(json.detail || json.message || 'Unable to update device.');
  };
  const reload = async (auth: string): Promise<InventoryDevice> => {
    const response = await fetch(`${api}/devices/${deviceId}`, {
      headers: { Authorization: `Bearer ${auth}` },
    });
    if (response.status === 401) {
      localStorage.removeItem('aims-api-token');
      token = await ensureApiToken(true);
      return reload(token);
    }
    const json = await response.json();
    if (!response.ok) throw new Error(json.detail || json.message || 'Unable to verify saved device.');
    return json.data as InventoryDevice;
  };
  await patch(token);
  return reload(token);
}

function loadSavedRackUnits() {
  try {
    const value = JSON.parse(localStorage.getItem(DEVICE_RACK_UNITS_KEY) || '{}');
    return value && typeof value === 'object' ? value as Record<string, number> : {};
  } catch {
    return {};
  }
}

function mergeSavedRackUnits(devices: InventoryDevice[]) {
  const saved = loadSavedRackUnits();
  return devices.map((device) => {
    const savedUnits = saved[String(device.id)];
    if (!savedUnits) return device;
    if (Number(device.rack_units || 1) === savedUnits) return device;
    return { ...device, rack_units: savedUnits };
  });
}

async function fetchWirelessAps(): Promise<WirelessAp[]> {
  let token = await ensureApiToken();
  const load = async (auth: string): Promise<WirelessAp[]> => {
    const response = await fetch(`${api}/wireless/monitoring?refresh=0&fast=1`, {
      headers: { Authorization: `Bearer ${auth}` },
    });
    if (response.status === 401) {
      localStorage.removeItem('aims-api-token');
      token = await ensureApiToken(true);
      return load(token);
    }
    const json = await response.json();
    if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load wireless locations.');
    return json.data?.access_points || [];
  };
  return load(token);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '-';
  return date.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function siteOf(device: InventoryDevice) {
  return String(device.site?.name || '').trim();
}

function deviceMatchesRecordSite(device: InventoryDevice, record: InfraRecord) {
  if (!record.site) return true;
  const siteName = siteOf(device);
  if (!siteName) return true;
  return sameText(siteName, record.site);
}

async function resolveRackSiteId(auth: string, rackSite: string | undefined, device: InventoryDevice) {
  const siteName = String(rackSite || '').trim();
  if (!siteName) return device.site_id || null;
  if (device.site_id && sameText(siteOf(device), siteName)) return device.site_id;
  try {
    const response = await fetch(`${api}/sites`, { headers: { Authorization: `Bearer ${auth}` } });
    const json = await response.json();
    if (!response.ok) return null;
    const rows = Array.isArray(json.data?.data) ? json.data.data : [];
    const match = rows.find((site: { id?: number | string; name?: string }) => sameText(site.name, siteName));
    const parsed = numeric(match?.id);
    if (parsed) return parsed;
    const createResponse = await fetch(`${api}/sites`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: siteName }),
    });
    const createJson = await createResponse.json();
    if (!createResponse.ok) return null;
    return numeric(createJson.data?.id) || null;
  } catch {
    return null;
  }
}

function wirelessSiteOf(ap: WirelessAp) {
  if (!ap.site) return '';
  return typeof ap.site === 'string' ? ap.site : ap.site.name;
}

function wirelessApName(ap: WirelessAp) {
  return String(ap.ap_name || ap.name || ap.hostname || ap.mac_address || ap.management_ip || 'Wireless AP').trim();
}

function wirelessApKey(ap: WirelessAp) {
  return String(ap.id || ap.mac_address || ap.management_ip || wirelessApName(ap)).trim();
}

function deviceUpdatedAt(device: InventoryDevice) {
  return device.last_seen_at || new Date().toISOString();
}

function deviceRecordStatus(devices: InventoryDevice[]): InfraStatus {
  return devices.some((device) => String(device.status || '').toLowerCase() === 'active') ? 'Active' : 'Planned';
}

function ipv4Prefix(value: string) {
  const clean = value.trim();
  const [ip, mask] = clean.split('/');
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(Number(part)))) return '';
  if (mask && Number(mask) >= 24) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  if (mask) return `${ip}/${mask}`;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

function deviceIps(device: InventoryDevice) {
  const rows: { address: string; name: string; role: string }[] = [];
  if (device.management_ip) rows.push({ address: device.management_ip, name: device.name, role: 'Management' });
  (device.interfaces || []).forEach((item) => {
    const values = item.ip_addresses?.length ? item.ip_addresses : item.ip ? [item.ip] : [];
    values.forEach((address) => rows.push({ address, name: `${device.name} ${item.name || 'interface'}`.trim(), role: 'Interface' }));
  });
  return rows.filter((row) => row.address && row.address !== '-');
}

function recordMergeKey(resource: InfrastructureResourceName, record: InfraRecord) {
  if (resource === 'Sites') return `site:${record.name}`.toLowerCase();
  if (resource === 'Locations') return `location:${record.name}`.toLowerCase();
  if (resource === 'Rooms') return `room:${record.site || ''}:${record.location || ''}:${record.name}`.toLowerCase();
  if (resource === 'Racks') return `rack:${record.site || ''}:${record.location || ''}:${record.region || ''}:${record.name}`.toLowerCase();
  if (resource === 'VLANs') return `vlan:${record.site || ''}:${record.vlanId || record.name}`.toLowerCase();
  if (resource === 'IP Addresses') return `ip:${ipOnly(record.address || record.name)}`.toLowerCase();
  if (resource === 'Prefixes') return `prefix:${record.site || ''}:${record.prefix || record.name}`.toLowerCase();
  if (resource === 'VRFs') return `vrf:${record.site || ''}:${record.name}`.toLowerCase();
  return record.id;
}

function mergeManualAndDerived(resource: InfrastructureResourceName, manual: InfraRecord[], derived: InfraRecord[]) {
  const result = new Map<string, InfraRecord>();
  derived.forEach((record) => {
    const key = recordMergeKey(resource, record);
    const existing = result.get(key);
    result.set(key, existing ? {
      ...existing,
      ...record,
      source: existing.source === 'device' && record.source === 'wireless' ? 'device' : record.source,
      relatedDeviceIds: [...new Set([...(existing.relatedDeviceIds || []), ...(record.relatedDeviceIds || [])])],
      relatedWirelessKeys: [...new Set([...(existing.relatedWirelessKeys || []), ...(record.relatedWirelessKeys || [])])],
      devices: Math.max(numeric(existing.devices), numeric(record.devices)),
      description: [existing.description, record.description].filter(Boolean).join(' '),
    } : record);
  });
  manual.forEach((record) => {
    const key = recordMergeKey(resource, record);
    const derivedMatch = result.get(key);
    result.set(key, {
      ...derivedMatch,
      ...record,
      source: 'manual',
      relatedDeviceIds: record.relatedDeviceIds?.length ? record.relatedDeviceIds : derivedMatch?.relatedDeviceIds,
      relatedWirelessKeys: record.relatedWirelessKeys?.length ? record.relatedWirelessKeys : derivedMatch?.relatedWirelessKeys,
      devices: record.devices || derivedMatch?.devices,
    });
  });
  return [...result.values()];
}

function roomNamesForLocation(location?: InfraRecord | null) {
  if (!location) return [];
  const namedRooms = (location.roomNames || []).map((room) => String(room || '').trim()).filter(Boolean);
  if (namedRooms.length) return namedRooms;
  const count = Math.max(0, Math.floor(numeric(location.rooms)));
  if (count <= 1) return [DEFAULT_ROOM_NAME];
  return Array.from({ length: Math.min(count, 200) }, (_, index) => `Room ${index + 1}`);
}

function findLocationRecordForPlacement(locations: InfraRecord[], site: string, locationName: string) {
  return locations.find((record) => sameText(record.name, locationName) && (!site || !record.site || sameText(record.site, site)));
}

function addRoomToLocationRows(locations: InfraRecord[], site: string, locationName: string, roomName: string) {
  const cleanRoom = roomName.trim();
  if (!cleanRoom) return locations;
  let updated = false;
  const nextRows = locations.map((record) => {
    if (!sameText(record.name, locationName) || (site && record.site && !sameText(record.site, site))) return record;
    updated = true;
    const existingNames = roomNamesForLocation(record);
    const roomNames = existingNames.some((name) => sameText(name, cleanRoom)) ? existingNames : [...existingNames, cleanRoom];
    return normalizeLocationRoomRecord({
      ...record,
      site: record.site || site,
      rooms: roomNames.length,
      roomNames,
      lastUpdated: new Date().toISOString(),
    });
  });
  if (updated) return nextRows;
  return [normalizeLocationRoomRecord({
    id: makeId('Locations'),
    name: locationName,
    site,
    status: 'Active',
    source: 'manual',
    rooms: 1,
    roomNames: [cleanRoom],
    lastUpdated: new Date().toISOString(),
  }), ...locations];
}

function deriveRoomRecords(locations: InfraRecord[], devices: InventoryDevice[]) {
  const now = new Date().toISOString();
  return locations.flatMap((location) => {
    const roomNames = roomNamesForLocation(location);
    return roomNames.map((roomName) => {
      const relatedDevices = devices.filter((device) => {
        const deviceRoom = String(device.room || '').trim() || DEFAULT_ROOM_NAME;
        return sameText(device.location, location.name)
          && (!location.site || deviceMatchesRecordSite(device, location))
          && sameText(deviceRoom, roomName);
      });
      return {
        id: `room:${location.site || ''}:${location.name}:${roomName}`.toLowerCase(),
        name: roomName,
        status: location.status || 'Active',
        source: location.source || 'manual',
        site: location.site || '',
        location: location.name,
        role: 'Room',
        devices: relatedDevices.length,
        relatedDeviceIds: relatedDevices.map((device) => device.id),
        description: `Room "${roomName}" in ${location.name}.`,
        tags: location.tags,
        lastUpdated: location.lastUpdated || now,
      } as InfraRecord;
    });
  });
}

function deriveRecords(resource: InfrastructureResourceName, devices: InventoryDevice[]): InfraRecord[] {
  const now = new Date().toISOString();
  const map = new Map<string, InfraRecord>();

  devices.forEach((device) => {
    const site = siteOf(device);
    const location = String(device.location || '').trim();
    const room = String(device.room || '').trim();
    const rack = String(device.rack || '').trim();
    const updated = deviceUpdatedAt(device);

    if (resource === 'Sites' && site) {
      const key = `device-site:${site.toLowerCase()}`;
      const existing = map.get(key);
      const relatedDeviceIds = [...new Set([...(existing?.relatedDeviceIds || []), device.id])];
      map.set(key, {
        id: key,
        name: site,
        status: deviceRecordStatus(devices.filter((item) => siteOf(item) === site)),
        source: 'device',
        relatedDeviceIds,
        role: 'Site',
        region: 'From device inventory',
        devices: relatedDeviceIds.length,
        utilization: Math.min(100, relatedDeviceIds.length),
        description: `Auto-built from ${relatedDeviceIds.length} device records assigned to this site.`,
        lastUpdated: updated,
      });
    }

    if (resource === 'Locations' && location) {
      const key = `device-location:${site}:${location}`.toLowerCase();
      const relatedDeviceIds = [...new Set([...(map.get(key)?.relatedDeviceIds || []), device.id])];
      map.set(key, {
        id: key,
        name: location,
        status: deviceRecordStatus(devices.filter((item) => siteOf(item) === site && String(item.location || '').trim() === location)),
        source: 'device',
        relatedDeviceIds,
        site,
        role: 'Location',
        devices: relatedDeviceIds.length,
        description: `Auto-built from devices with location "${location}".`,
        lastUpdated: updated,
      });
    }

    if (resource === 'Racks' && rack) {
      const key = `device-rack:${site}:${location}:${room}:${rack}`.toLowerCase();
      const relatedDeviceIds = [...new Set([...(map.get(key)?.relatedDeviceIds || []), device.id])];
      map.set(key, {
        id: key,
        name: rack,
        status: deviceRecordStatus(devices.filter((item) => siteOf(item) === site && String(item.location || '').trim() === location && String(item.room || '').trim() === room && String(item.rack || '').trim() === rack)),
        source: 'device',
        relatedDeviceIds,
        site,
        location,
        region: room,
        room,
        role: 'Rack',
        units: 42,
        usedUnits: relatedDeviceIds.length,
        devices: relatedDeviceIds.length,
        description: `Auto-built from devices assigned to rack "${rack}".`,
        lastUpdated: updated,
      });
    }

    if (resource === 'VLANs') {
      const vlans = device.vlans?.length ? device.vlans : device.vlan ? [{ id: device.vlan, name: `VLAN ${device.vlan}`, source: 'inventory' }] : [];
      vlans.forEach((vlan) => {
        const vlanId = String(vlan.id || '').trim();
        if (!vlanId) return;
        const key = `device-vlan:${site || 'global'}:${vlanId}`.toLowerCase();
        const relatedDeviceIds = [...new Set([...(map.get(key)?.relatedDeviceIds || []), device.id])];
        const portCount = (vlan.ports || []).length;
        map.set(key, {
          id: key,
          name: vlan.name || `VLAN ${vlanId}`,
          status: 'Active',
          source: 'device',
          relatedDeviceIds,
          site,
          vlanId,
          role: vlan.source || 'Device VLAN',
          devices: relatedDeviceIds.length,
          utilization: Math.min(100, portCount),
          description: `${portCount} learned port memberships across ${relatedDeviceIds.length} device records.`,
          tags: vlan.source,
          lastUpdated: updated,
        });
      });
    }

    if (resource === 'IP Addresses') {
      deviceIps(device).forEach((row) => {
        const key = `device-ip:${row.address}`.toLowerCase();
        map.set(key, {
          id: key,
          name: row.name,
          status: 'Active',
          source: 'device',
          relatedDeviceIds: [device.id],
          address: row.address,
          prefix: ipv4Prefix(row.address),
          site,
          location,
          rack,
          role: row.role,
          tenant: device.tenant || device.owner || '',
          description: `Auto-built from ${row.role.toLowerCase()} address on ${device.name}.`,
          lastUpdated: updated,
        });
      });
    }

  if (resource === 'Prefixes') {
      deviceIps(device).forEach((row) => {
        const prefix = ipv4Prefix(row.address);
        if (!prefix) return;
        const key = `device-prefix:${site || 'global'}:${prefix}`.toLowerCase();
        const relatedDeviceIds = [...new Set([...(map.get(key)?.relatedDeviceIds || []), device.id])];
        map.set(key, {
          id: key,
          name: `${site || 'Global'} ${prefix}`,
          status: 'Active',
          source: 'device',
          relatedDeviceIds,
          prefix,
          site,
          role: 'Device addressing',
          devices: relatedDeviceIds.length,
          utilization: Math.min(100, Math.round((relatedDeviceIds.length / 254) * 100)),
          description: `Auto-built from ${relatedDeviceIds.length} device IP address records.`,
          lastUpdated: updated,
        });
      });
    }

    if (resource === 'VRFs') {
      const vrfNames = new Set<string>();
      (device.vlans || []).forEach((vlan) => {
        const candidate = String((vlan as DeviceVlan & { vrf?: string }).vrf || '').trim();
        if (candidate) vrfNames.add(candidate);
      });
      vrfNames.forEach((vrfName) => {
        const key = `device-vrf:${site || 'global'}:${vrfName}`.toLowerCase();
        const relatedDeviceIds = [...new Set([...(map.get(key)?.relatedDeviceIds || []), device.id])];
        map.set(key, {
          id: key,
          name: vrfName,
          status: 'Active',
          source: 'device',
          relatedDeviceIds,
          site,
          role: 'Routing domain',
          devices: relatedDeviceIds.length,
          utilization: Math.min(100, relatedDeviceIds.length),
          description: `Auto-built from ${relatedDeviceIds.length} device records using VRF "${vrfName}".`,
          lastUpdated: updated,
        });
      });
    }
  });

  return [...map.values()].map((record) => ({ ...record, lastUpdated: record.lastUpdated || now }));
}

function deriveWirelessRecords(resource: InfrastructureResourceName, aps: WirelessAp[]): InfraRecord[] {
  if (resource !== 'Locations' && resource !== 'Sites') return [];
  const map = new Map<string, InfraRecord>();
  aps.forEach((ap) => {
    const site = wirelessSiteOf(ap) || String(ap.controller_name || '').trim();
    const location = String(ap.location || '').trim();
    const updated = ap.last_seen_at || new Date().toISOString();

    if (resource === 'Sites' && site) {
      const key = `wireless-site:${site}`.toLowerCase();
      const existing = map.get(key);
      const relatedWirelessKeys = [...new Set([...(existing?.relatedWirelessKeys || []), wirelessApKey(ap)])];
      map.set(key, {
        id: key,
        name: site,
        status: 'Active',
        source: 'wireless',
        relatedWirelessKeys,
        role: 'Wireless site',
        region: 'From wireless controller',
        devices: relatedWirelessKeys.length,
        utilization: Math.min(100, relatedWirelessKeys.length),
        description: `Auto-built from ${relatedWirelessKeys.length} wireless AP records.`,
        lastUpdated: updated,
      });
    }

    if (resource === 'Locations' && location) {
      const key = `wireless-location:${location}`.toLowerCase();
      const existing = map.get(key);
      const relatedWirelessKeys = [...new Set([...(existing?.relatedWirelessKeys || []), wirelessApKey(ap)])];
      map.set(key, {
        ...existing,
        id: key,
        name: location,
        status: 'Active',
        source: 'wireless',
        relatedWirelessKeys,
        site: existing?.site || site,
        role: 'Wireless location',
        devices: relatedWirelessKeys.length,
        utilization: Math.min(100, relatedWirelessKeys.length),
        description: `Auto-built from wireless AP location "${location}".`,
        lastUpdated: updated,
      });
    }
  });
  return [...map.values()];
}

function resourceDisplayValue(resource: InfrastructureResourceName, record: InfraRecord) {
  if (resource === 'IP Addresses') return record.address || record.name;
  if (resource === 'Prefixes') return record.prefix || record.name;
  if (resource === 'VLANs') return record.vlanId ? `${record.vlanId} - ${record.name}` : record.name;
  return record.name;
}

function scopeValue(resource: InfrastructureResourceName, record: InfraRecord) {
  if (resource === 'Sites') return record.region || '-';
  if (resource === 'Rooms') return [record.location, record.site].filter(Boolean).join(' / ') || '-';
  if (resource === 'Racks') return [record.site, record.location, record.region].filter(Boolean).join(' / ') || '-';
  if (resource === 'VLANs') return [record.site, record.vrf].filter(Boolean).join(' / ') || '-';
  if (resource === 'IP Addresses') return [record.prefix, record.site].filter(Boolean).join(' / ') || '-';
  if (resource === 'Prefixes') return [record.site, record.vlanId ? `VLAN ${record.vlanId}` : ''].filter(Boolean).join(' / ') || '-';
  if (resource === 'VRFs') return [record.site, record.tenant].filter(Boolean).join(' / ') || '-';
  return record.site || '-';
}

function capacityFor(resource: InfrastructureResourceName, record: InfraRecord) {
  if (resource === 'Racks') {
    const units = numeric(record.units);
    return units ? Math.round((numeric(record.usedUnits) / units) * 100) : 0;
  }
  return numeric(record.utilization);
}

function allStoredRecords() {
  return Object.fromEntries(INFRASTRUCTURE_RESOURCES.map((resource) => [resource, loadRecords(resource)])) as Record<InfrastructureResourceName, InfraRecord[]>;
}

function relatedCounts(record: InfraRecord) {
  const all = allStoredRecords();
  const sameSite = (item: InfraRecord) => record.site && item.site === record.site;
  const sameLocation = (item: InfraRecord) => record.location && item.location === record.location;
  const samePrefix = (item: InfraRecord) => record.prefix && item.prefix === record.prefix;
  return [
    ['Locations', all.Locations.filter((item) => item.site === record.name || sameSite(item)).length],
    ['Racks', all.Racks.filter((item) => item.site === record.name || sameSite(item) || sameLocation(item)).length],
    ['VLANs', all.VLANs.filter((item) => item.site === record.name || sameSite(item)).length],
    ['IP Addresses', all['IP Addresses'].filter((item) => item.site === record.name || sameSite(item) || samePrefix(item)).length],
    ['Prefixes', all.Prefixes.filter((item) => item.site === record.name || sameSite(item)).length],
    ['VRFs', all.VRFs.filter((item) => item.site === record.name || sameSite(item)).length],
  ].filter(([, count]) => Number(count) > 0);
}

function sameText(a: unknown, b: unknown) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function ipOnly(value: string) {
  return String(value || '').split('/')[0].trim();
}

function relatedDevicesFor(resource: InfrastructureResourceName, record: InfraRecord, devices: InventoryDevice[]) {
  const relatedIds = new Set(record.relatedDeviceIds || []);
  return devices.filter((device) => {
    const site = siteOf(device);
    const location = String(device.location || '').trim();
    const room = String(device.room || '').trim();
    const rack = String(device.rack || '').trim();
    const explicitlyRelated = relatedIds.has(device.id);
    if (resource === 'Sites') return sameText(site, record.name);
    if (resource === 'Locations') return sameText(location, record.name) && deviceMatchesRecordSite(device, record);
    if (resource === 'Rooms') return sameText(room || DEFAULT_ROOM_NAME, record.name)
      && (!record.location || sameText(location, record.location))
      && deviceMatchesRecordSite(device, record);
    if (resource === 'Racks') return sameText(rack, record.name)
      && deviceMatchesRecordSite(device, record)
      && (!record.location || sameText(location, record.location))
      && (!record.region || sameText(room, record.region));
    if (resource === 'VLANs') {
      const vlanId = String(record.vlanId || '').trim();
      if (!vlanId) return false;
      return explicitlyRelated || String(device.vlan || '') === vlanId || Boolean((device.vlans || []).some((vlan) => String(vlan.id) === vlanId));
    }
    if (resource === 'IP Addresses') {
      const target = ipOnly(record.address || '');
      return explicitlyRelated || Boolean(target && deviceIps(device).some((row) => ipOnly(row.address) === target));
    }
    if (resource === 'Prefixes') {
      const target = String(record.prefix || '').trim();
      return explicitlyRelated || Boolean(target && deviceIps(device).some((row) => ipv4Prefix(row.address) === target));
    }
    if (resource === 'VRFs') {
      return explicitlyRelated || Boolean((device.vlans || []).some((vlan) => sameText((vlan as DeviceVlan & { vrf?: string }).vrf, record.name)));
    }
    return explicitlyRelated;
  });
}

function relatedWirelessFor(resource: InfrastructureResourceName, record: InfraRecord, aps: WirelessAp[]) {
  if (record.relatedWirelessKeys?.length) return aps.filter((ap) => record.relatedWirelessKeys?.includes(wirelessApKey(ap)));
  return aps.filter((ap) => {
    const site = wirelessSiteOf(ap) || String(ap.controller_name || '').trim();
    const location = String(ap.location || '').trim();
    if (resource === 'Sites') return sameText(site, record.name);
    if (resource === 'Locations') return sameText(location, record.name) && (!record.site || sameText(site, record.site));
    return false;
  });
}

function relatedRecordsForLocation(target: InfraRecord, resource: InfrastructureResourceName, matchedDevices: InventoryDevice[], wirelessAps: WirelessAp[] = []) {
  const derived = resource === 'Sites' || resource === 'Locations'
    ? [...deriveRecords(resource, matchedDevices), ...deriveWirelessRecords(resource, wirelessAps)]
    : deriveRecords(resource, matchedDevices);
  const merged = mergeManualAndDerived(resource, loadRecords(resource), derived);
  return merged.filter((record) => {
    if (resource === 'Racks') return sameText(record.location, target.name) && (!target.site || sameText(record.site, target.site));
    if (resource === 'IP Addresses') return relatedDevicesFor(resource, record, matchedDevices).length > 0 || sameText(record.location, target.name);
    if (resource === 'VLANs') return relatedDevicesFor(resource, record, matchedDevices).length > 0 || (Boolean(target.site) && sameText(record.site, target.site));
    if (resource === 'Prefixes') return relatedDevicesFor(resource, record, matchedDevices).length > 0 || (Boolean(target.site) && sameText(record.site, target.site));
    return false;
  });
}

function buildLocationRelatedData(target: InfraRecord, matchedDevices: InventoryDevice[], matchedWirelessAps: WirelessAp[]): LocationRelatedData {
  return {
    devices: matchedDevices,
    aps: matchedWirelessAps,
    ips: relatedRecordsForLocation(target, 'IP Addresses', matchedDevices),
    vlans: relatedRecordsForLocation(target, 'VLANs', matchedDevices),
    racks: relatedRecordsForLocation(target, 'Racks', matchedDevices),
    prefixes: relatedRecordsForLocation(target, 'Prefixes', matchedDevices),
  };
}

function searchMatch(value: unknown, query: string) {
  if (!query.trim()) return true;
  return JSON.stringify(value).toLowerCase().includes(query.trim().toLowerCase());
}

function exportRowsCsv(filename: string, headers: string[], rows: unknown[][]) {
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function inputValue(record: InfraRecord | null, key: keyof InfraRecord) {
  const value = record?.[key];
  return value === undefined || value === null ? '' : String(value);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Unable to read selected image.'));
    reader.readAsDataURL(file);
  });
}

function sortInfraRecords(rows: InfraRecord[], resource: InfrastructureResourceName, field: InfraSortField, direction: SortDirection) {
  return [...rows].sort((a, b) => compareSortValues(
    infraSortValue(resource, a, field),
    infraSortValue(resource, b, field),
    direction,
  ));
}

function infraSortValue(resource: InfrastructureResourceName, record: InfraRecord, field: InfraSortField) {
  if (field === 'primary') return resourceDisplayValue(resource, record);
  if (field === 'scope') return scopeValue(resource, record);
  if (field === 'role') return record.role || '';
  if (field === 'status') return record.status || '';
  if (field === 'utilization') return capacityFor(resource, record);
  if (field === 'updated') return Date.parse(record.lastUpdated || '') || 0;
  return '';
}

function compareSortValues(a: unknown, b: unknown, direction: SortDirection) {
  const multiplier = direction === 'asc' ? 1 : -1;
  if (typeof a === 'number' || typeof b === 'number') return ((Number(a) || 0) - (Number(b) || 0)) * multiplier;
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' }) * multiplier;
}

export function InfrastructurePage({ resource }: { resource: InfrastructureResourceName }) {
  const config = resourceConfigs[resource];
  const Icon = config.icon;
  const autosaveReadyResourceRef = useRef<InfrastructureResourceName | null>(resource);
  const [records, setRecords] = useState<InfraRecord[]>(() => loadRecords(resource));
  const [placementRecords, setPlacementRecords] = useState<Record<InfrastructureResourceName, InfraRecord[]>>(() => allStoredRecords());
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<InfraRecord | null>(null);
  const [editing, setEditing] = useState<InfraRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InfraRecord | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkLocationEditOpen, setBulkLocationEditOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hiddenRecordKeys, setHiddenRecordKeys] = useState<string[]>(() => loadHiddenRecordKeys(resource));
  const [backendReady, setBackendReady] = useState(false);
  const [backendAvailable, setBackendAvailable] = useState(true);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [devices, setDevices] = useState<InventoryDevice[]>([]);
  const [wirelessAps, setWirelessAps] = useState<WirelessAp[]>([]);
  const [deviceTypeProfiles, setDeviceTypeProfiles] = useState<DeviceTypeRecord[]>(() => loadDeviceTypes());
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [deviceError, setDeviceError] = useState('');
  const [wirelessError, setWirelessError] = useState('');
  const [detailTab, setDetailTab] = useState<LocationRelatedTab>('devices');
  const [detailSearch, setDetailSearch] = useState('');
  const [sortField, setSortField] = useState<InfraSortField>('updated');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [createPlacementFields, setCreatePlacementFields] = useState<Record<string, boolean>>({});
  const [rackFormSite, setRackFormSite] = useState('');
  const [rackFormLocation, setRackFormLocation] = useState('');
  const [locationFormRooms, setLocationFormRooms] = useState('');
  const [rackEnvironments, setRackEnvironments] = useState<Record<number, RackDeviceEnvironment>>({});
  const [rackTemperatureHistory, setRackTemperatureHistory] = useState<Record<string, RackTemperatureHistoryPoint[]>>({});
  const [pendingOpenTarget, setPendingOpenTarget] = useState<InfrastructureOpenTarget | null>(null);
  const [componentAssignTarget, setComponentAssignTarget] = useState<ComponentAssignTarget | null>(null);

  useEffect(() => {
    autosaveReadyResourceRef.current = null;
    setRecords(loadRecords(resource));
    setQuery('');
    setSelected(null);
    setEditing(null);
    setShowForm(false);
    setDeleteTarget(null);
    setBulkDeleteOpen(false);
    setBulkLocationEditOpen(false);
    setSelectedIds([]);
    setHiddenRecordKeys(loadHiddenRecordKeys(resource));
    setBackendReady(false);
    setBackendAvailable(true);
    setDeleteBusy(false);
    setSortField('updated');
    setSortDirection('desc');
    setCreatePlacementFields({});
    setRackFormSite('');
    setRackFormLocation('');
    setLocationFormRooms('');
    setComponentAssignTarget(null);
    setPlacementRecords((current) => ({ ...current, [resource]: loadRecords(resource) }));
  }, [resource]);

  useEffect(() => {
    let alive = true;
    loadBackendInfrastructure(resource)
      .then((snapshot) => {
        if (!alive) return;
        if (snapshot.configured) {
          const backendRows = resource === 'VRFs' ? removeDemoVrfSeeds(snapshot.records) : snapshot.records;
          const backendRecords = resource === 'Locations' ? normalizeRecordsForResource('Locations', backendRows) : backendRows;
          localStorage.setItem(storageKey(resource), JSON.stringify(backendRecords));
          setRecords(backendRecords);
          setPlacementRecords((current) => ({ ...current, [resource]: backendRecords }));
        }
        localStorage.setItem(hiddenRecordsKey(resource), JSON.stringify(snapshot.hiddenKeys));
        setHiddenRecordKeys(snapshot.hiddenKeys);
        setBackendAvailable(!snapshot.unavailable);
        setBackendReady(true);
        autosaveReadyResourceRef.current = resource;
        setDeviceError('');
      })
      .catch((error) => {
        if (!alive) return;
        setBackendReady(true);
        setBackendAvailable(false);
        autosaveReadyResourceRef.current = resource;
        setDeviceError('');
      });
    return () => {
      alive = false;
    };
  }, [resource]);

  useEffect(() => {
    let alive = true;
    Promise.allSettled(['Sites', 'Locations', 'Racks'].map(async (item) => {
      const resourceName = item as InfrastructureResourceName;
      const snapshot = await loadBackendInfrastructure(resourceName);
      return { resourceName, snapshot };
    }))
      .then((rows) => {
        if (!alive) return;
        setPlacementRecords((current) => {
          const next = { ...current };
          rows.forEach((result) => {
            if (result.status !== 'fulfilled') return;
            const { resourceName, snapshot } = result.value;
            if (!snapshot.configured) return;
            const backendRows = resourceName === 'VRFs' ? removeDemoVrfSeeds(snapshot.records) : snapshot.records;
            const backendRecords = resourceName === 'Locations' ? normalizeRecordsForResource('Locations', backendRows) : backendRows;
            localStorage.setItem(storageKey(resourceName), JSON.stringify(backendRecords));
            next[resourceName] = backendRecords;
          });
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (autosaveReadyResourceRef.current !== resource) return;
    saveRecords(resource, records);
    setPlacementRecords((current) => current[resource] === records ? current : { ...current, [resource]: records });
    if (backendReady && backendAvailable) {
      saveBackendInfrastructure(resource, records).then((result) => {
        if (result === 'unavailable') setBackendAvailable(false);
      }).catch((error) => {
        setDeviceError(error instanceof Error ? error.message : 'Unable to save infrastructure records to backend.');
      });
    }
  }, [backendAvailable, backendReady, records, resource]);

  useEffect(() => {
    const syncDeviceTypes = () => setDeviceTypeProfiles(loadDeviceTypes());
    window.addEventListener('aims:device-types-changed', syncDeviceTypes);
    window.addEventListener('storage', syncDeviceTypes);
    return () => {
      window.removeEventListener('aims:device-types-changed', syncDeviceTypes);
      window.removeEventListener('storage', syncDeviceTypes);
    };
  }, []);

  useEffect(() => {
    setDetailTab('devices');
    setDetailSearch('');
  }, [resource, selected?.id]);

  useEffect(() => {
    let alive = true;
    setLoadingDevices(true);
    Promise.allSettled([fetchAllDevices(), fetchWirelessAps()])
      .then(([deviceResult, wirelessResult]) => {
        if (!alive) return;
        if (deviceResult.status === 'fulfilled') {
          setDevices(deviceResult.value);
          setDeviceError('');
        } else {
          setDeviceError(deviceResult.reason instanceof Error ? deviceResult.reason.message : 'Unable to load related devices.');
        }
        if (wirelessResult.status === 'fulfilled') {
          setWirelessAps(wirelessResult.value);
          setWirelessError('');
        } else {
          setWirelessError(wirelessResult.reason instanceof Error ? wirelessResult.reason.message : 'Unable to load wireless locations.');
        }
      })
      .finally(() => {
        if (alive) setLoadingDevices(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (resource !== 'Racks' && resource !== 'Rooms') {
      setRackEnvironments({});
      return;
    }
    const environmentDevices = (selected
      ? relatedDevicesFor(resource, selected, devices)
      : devices.filter((device) => String(device.rack || '').trim()))
      .filter((device) => device.management_ip);
    const ids = environmentDevices.map((device) => device.id);
    if (!ids.length) {
      setRackEnvironments({});
      return;
    }
    let alive = true;
    const loadRackEnvironments = () => {
      setRackEnvironments((current) => Object.fromEntries(ids.map((id) => [id, { ...(current[id] || { temperature_c: null }), loading: true, error: '' }])));
      Promise.all(environmentDevices.map(async (device) => {
        try {
          return [device.id, { ...(await fetchDeviceEnvironment(device.id)), loading: false, error: '' }] as const;
        } catch (error) {
          return [device.id, { temperature_c: null, loading: false, error: error instanceof Error ? error.message : 'Unable to load environment.' }] as const;
        }
      })).then((rows) => {
        if (!alive) return;
        setRackEnvironments(Object.fromEntries(rows));
      });
    };
    loadRackEnvironments();
    const timer = window.setInterval(loadRackEnvironments, 60000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [resource, selected?.id, devices]);

  useEffect(() => {
    if (resource !== 'Racks' || !selected) return;
    const rackDevices = relatedDevicesFor('Racks', selected, devices);
    if (!rackDevices.length) return;
    if (rackDevices.some((device) => rackEnvironments[device.id]?.loading)) return;
    const temperature = rackTemperatureSummary(rackDevices, rackEnvironments, selected);
    if (temperature.value === null) return;
    const point: RackTemperatureHistoryPoint = {
      timestamp: Date.now(),
      hottest: temperature.value,
      average: temperature.average,
    };
    setRackTemperatureHistory((current) => {
      const key = selected.id;
      const rows = current[key] || [];
      const last = rows[rows.length - 1];
      if (last && point.timestamp - last.timestamp < 10000 && last.hottest === point.hottest && last.average === point.average) return current;
      return { ...current, [key]: [...rows, point].slice(-96) };
    });
  }, [resource, selected?.id, devices, rackEnvironments]);

  const derivedRecords = useMemo(() => {
    if (resource !== 'Rooms') return [...deriveRecords(resource, devices), ...deriveWirelessRecords(resource, wirelessAps)];
    const locationRows = mergeManualAndDerived('Locations', placementRecords.Locations || loadRecords('Locations'), [
      ...deriveRecords('Locations', devices),
      ...deriveWirelessRecords('Locations', wirelessAps),
    ]);
    return deriveRoomRecords(locationRows, devices);
  }, [resource, devices, wirelessAps, placementRecords.Locations]);
  const displayedRecords = useMemo(() => {
    const hidden = new Set(hiddenRecordKeys);
    return mergeManualAndDerived(resource, records, derivedRecords).filter((record) => record.source === 'manual' || !hidden.has(recordMergeKey(resource, record)));
  }, [resource, records, derivedRecords, hiddenRecordKeys]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = !needle ? displayedRecords : displayedRecords.filter((record) => Object.values(record).map(String).join(' ').toLowerCase().includes(needle));
    return sortInfraRecords(rows, resource, sortField, sortDirection);
  }, [query, displayedRecords, resource, sortField, sortDirection]);

  useEffect(() => {
    const openRecord = (event: Event) => {
      const detail = (event as CustomEvent<InfrastructureOpenTarget>).detail || {};
      if (detail.resource === resource) setPendingOpenTarget(detail);
    };
    window.addEventListener('aims:open-infrastructure-detail', openRecord);
    return () => window.removeEventListener('aims:open-infrastructure-detail', openRecord);
  }, [resource]);

  useEffect(() => {
    if (!pendingOpenTarget || pendingOpenTarget.resource !== resource) return;
    const match = displayedRecords.find((record) => infrastructureRecordMatchesTarget(resource, record, pendingOpenTarget));
    if (!match) return;
    setSelected(match);
    setPendingOpenTarget(null);
  }, [displayedRecords, pendingOpenTarget, resource]);
  const visibleIds = visible.map((record) => record.id);
  const selectedRecords = visible.filter((record) => selectedIds.includes(record.id));
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const bulkLocationSiteOptions = resource === 'Locations'
    ? uniqueRackValues([
      ...displayedRecords.map((record) => record.site),
      ...loadRecords('Sites').map((record) => record.name),
      ...deriveRecords('Sites', devices).map((record) => record.name),
      ...deriveWirelessRecords('Sites', wirelessAps).map((record) => record.name),
    ])
    : [];

  const activeCount = displayedRecords.filter((record) => record.status === 'Active').length;
  const reservedCount = displayedRecords.filter((record) => record.status === 'Reserved' || record.status === 'Planned').length;
  const avgUtilization = displayedRecords.length ? Math.round(displayedRecords.reduce((sum, record) => sum + capacityFor(resource, record), 0) / displayedRecords.length) : 0;

  const openCreate = () => {
    setEditing(null);
    setCreatePlacementFields({});
    setRackFormSite('');
    setRackFormLocation('');
    setLocationFormRooms(resource === 'Locations' ? '1' : '');
    setShowForm(true);
  };

  const openEdit = (record: InfraRecord) => {
    setEditing(record);
    setCreatePlacementFields({});
    setRackFormSite(resource === 'Racks' || resource === 'Rooms' || resource === 'Locations' ? record.site || '' : '');
    setRackFormLocation(resource === 'Racks' || resource === 'Rooms' ? record.location || '' : '');
    setLocationFormRooms(resource === 'Locations' ? String(record.rooms || '') : '');
    setShowForm(true);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const editingExistingManual = Boolean(editing && records.some((item) => item.id === editing.id));
    const next: InfraRecord = {
      ...(editing || {}),
      id: editingExistingManual ? editing!.id : makeId(resource),
      name: '',
      source: 'manual',
      relatedDeviceIds: editingExistingManual ? editing?.relatedDeviceIds : undefined,
      status: 'Active',
      lastUpdated: new Date().toISOString(),
    };

    config.fields.forEach((field) => {
      if (field.type === 'image') return;
      const raw = String(form.get(String(field.key)) || '').trim();
      if (field.type === 'number') {
        (next as Record<string, unknown>)[field.key] = raw === '' ? undefined : Number(raw);
      } else if (field.key === 'lastUpdated') {
        next.lastUpdated = raw || new Date().toISOString();
      } else {
        (next as Record<string, unknown>)[field.key] = raw;
      }
    });
    for (const field of config.fields) {
      if (field.type !== 'image') continue;
      const file = form.get(String(field.key));
      if (file instanceof File && file.size) {
        (next as Record<string, unknown>)[field.key] = await fileToDataUrl(file);
      } else if (editing?.[field.key]) {
        (next as Record<string, unknown>)[field.key] = editing[field.key];
      }
    }
    if (resource === 'Locations') {
      const roomValue = String(form.get('rooms') || '').trim();
      const roomCount = Math.max(0, Math.floor(Number(roomValue) || 0));
      const roomNames = form.getAll('roomNames').map((value) => String(value || '').trim()).filter(Boolean);
      next.rooms = Math.max(1, roomCount || 1);
      if (roomCount > 1) {
        next.roomNames = Array.from({ length: roomCount }, (_, index) => roomNames[index] || `Room ${index + 1}`);
      } else {
        next.roomNames = [roomNames[0] || DEFAULT_ROOM_NAME];
      }
    }

    next.name = next.name || next.address || next.prefix || `${config.singular} ${records.length + 1}`;
    next.status = (next.status || 'Active') as InfraStatus;
    next.lastUpdated = next.lastUpdated || new Date().toISOString();
    const placementLocations = mergeManualAndDerived('Locations', placementRecords.Locations || loadRecords('Locations'), [
      ...deriveRecords('Locations', devices),
      ...deriveWirelessRecords('Locations', wirelessAps),
    ]);
    if (resource === 'Locations') {
      if (!next.site) {
        setDeviceError('Select a site before creating a location.');
        return;
      }
      const duplicate = records.find((record) => record.id !== next.id && sameText(record.name, next.name));
      if (duplicate) {
        setDeviceError(`Location "${next.name}" already exists.`);
        return;
      }
    }
    if (resource === 'Rooms') {
      if (!next.site) {
        setDeviceError('Select a site before creating a room.');
        return;
      }
      if (!next.location) {
        setDeviceError('Select a location before creating a room.');
        return;
      }
      const location = findLocationRecordForPlacement(placementLocations, next.site, next.location);
      if (!location) {
        setDeviceError(`Location "${next.location}" was not found for site "${next.site}". Create or select the location first.`);
        return;
      }
      const editingKey = editing ? recordMergeKey('Rooms', editing) : '';
      const duplicate = displayedRecords.find((record) => {
        const key = recordMergeKey('Rooms', record);
        return key !== editingKey && sameText(record.name, next.name) && sameText(record.location, next.location) && sameText(record.site, next.site);
      });
      if (duplicate) {
        setDeviceError(`Room "${next.name}" already exists in ${next.location}.`);
        return;
      }
      const locationRows = placementRecords.Locations || loadRecords('Locations');
      const updatedLocations = addRoomToLocationRows(locationRows, next.site, next.location, next.name);
      saveRecords('Locations', updatedLocations);
      setPlacementRecords((current) => ({ ...current, Locations: updatedLocations }));
      if (backendReady && backendAvailable) {
        const result = await saveBackendInfrastructure('Locations', updatedLocations);
        if (result === 'unavailable') setBackendAvailable(false);
      }
    }
    if (resource === 'Racks') {
      if (!next.site) {
        setDeviceError('Select a site before creating a rack.');
        return;
      }
      if (!next.location) {
        setDeviceError('Select a location before creating a rack.');
        return;
      }
      const location = findLocationRecordForPlacement(placementLocations, next.site, next.location);
      if (!location) {
        setDeviceError(`Location "${next.location}" was not found for site "${next.site}". Create or select the location first.`);
        return;
      }
      const rooms = roomNamesForLocation(location);
      if (!next.region && rooms.length === 1) next.region = rooms[0];
      if (!next.region) {
        setDeviceError('Select a room before creating a rack.');
        return;
      }
      if (rooms.length && !rooms.some((room) => sameText(room, next.region))) {
        setDeviceError(`Room "${next.region}" was not found in ${next.location}. Create or select the room first.`);
        return;
      }
      next.room = next.region;
    }
    const visibleKeys = [recordMergeKey(resource, next), editing ? recordMergeKey(resource, editing) : ''].filter(Boolean);
    setHiddenRecordKeys((current) => {
      const nextHidden = current.filter((key) => !visibleKeys.includes(key));
      if (nextHidden.length === current.length) return current;
      saveHiddenRecordKeys(resource, nextHidden);
      return nextHidden;
    });

    if (resource !== 'Sites' && next.site) {
      ensureLinkedInfrastructureRecord('Sites', { name: next.site });
    }

    setRecords((current) => editingExistingManual ? current.map((item) => item.id === editing!.id ? next : item) : [next, ...current]);
    setShowForm(false);
    setEditing(null);
    setSelected(next);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const deleteKey = recordMergeKey(resource, deleteTarget);
    setDeleteBusy(true);
    if (backendAvailable) {
      try {
        const result = await deleteBackendInfrastructureRecords(resource, [deleteTarget], [deleteKey], [deleteTarget.id]);
        if (result === 'unavailable') setBackendAvailable(false);
        if (resource === 'Racks' && result !== 'unavailable') {
          setDevices(await fetchAllDevices());
        }
      } catch (error) {
        setDeviceError(error instanceof Error ? error.message : 'Unable to delete infrastructure record from backend.');
        setDeleteBusy(false);
        return;
      }
    }
    setHiddenRecordKeys((current) => {
      const nextHidden = [...new Set([...current, deleteKey])];
      saveHiddenRecordKeys(resource, nextHidden);
      return nextHidden;
    });
    setRecords((current) => current.filter((record) => record.id !== deleteTarget.id && recordMergeKey(resource, record) !== deleteKey));
    if (selected?.id === deleteTarget.id) setSelected(null);
    setDeleteTarget(null);
    setDeviceError('');
    setDeleteBusy(false);
  };

  const toggleRecordSelected = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const toggleVisibleSelected = () => {
    setSelectedIds((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : Array.from(new Set([...current, ...visibleIds])));
  };

  const confirmBulkDelete = async () => {
    const selectedSet = new Set(selectedIds);
    const selectedKeys = new Set(selectedRecords.map((record) => recordMergeKey(resource, record)));
    setDeleteBusy(true);
    if (backendAvailable) {
      try {
        const result = await deleteBackendInfrastructureRecords(resource, selectedRecords, [...selectedKeys], [...selectedSet]);
        if (result === 'unavailable') setBackendAvailable(false);
        if (resource === 'Racks' && result !== 'unavailable') {
          setDevices(await fetchAllDevices());
        }
      } catch (error) {
        setDeviceError(error instanceof Error ? error.message : 'Unable to delete selected infrastructure records from backend.');
        setDeleteBusy(false);
        return;
      }
    }
    setHiddenRecordKeys((current) => {
      const nextHidden = [...new Set([...current, ...selectedKeys])];
      saveHiddenRecordKeys(resource, nextHidden);
      return nextHidden;
    });
    setRecords((current) => current.filter((record) => !selectedSet.has(record.id) && !selectedKeys.has(recordMergeKey(resource, record))));
    if (selected && (selectedSet.has(selected.id) || selectedKeys.has(recordMergeKey(resource, selected)))) setSelected(null);
    setSelectedIds([]);
    setBulkDeleteOpen(false);
    setDeviceError('');
    setDeleteBusy(false);
  };

  const saveBulkLocationEdit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedSet = new Set(selectedIds);
    const name = String(form.get('name') || '').trim();
    const role = String(form.get('role') || '').trim();
    const site = String(form.get('site') || '').trim();
    const status = String(form.get('status') || '').trim() as InfraStatus | '';
    const tags = String(form.get('tags') || '').trim();
    const updatedAt = new Date().toISOString();
    if (site) ensureLinkedInfrastructureRecord('Sites', { name: site });

    const selectedByKey = new Map(selectedRecords.map((record) => [recordMergeKey('Locations', record), record]));
    const selectedManualIds = new Set(records.filter((record) => selectedSet.has(record.id)).map((record) => record.id));
    const selectedManualKeys = new Set(records.filter((record) => selectedSet.has(record.id)).map((record) => recordMergeKey('Locations', record)));
    const applyChanges = (record: InfraRecord): InfraRecord => ({
      ...record,
      ...(name ? { name } : {}),
      ...(role ? { role } : {}),
      ...(site ? { site } : {}),
      ...(status ? { status } : {}),
      ...(tags ? { tags } : {}),
      source: 'manual',
      lastUpdated: updatedAt,
    });
    const materialized = selectedRecords
      .filter((record) => !selectedManualIds.has(record.id) && !selectedManualKeys.has(recordMergeKey('Locations', record)))
      .map((record) => applyChanges({
        ...record,
        id: makeId('Locations'),
        source: 'manual',
        relatedDeviceIds: record.relatedDeviceIds,
        relatedWirelessKeys: record.relatedWirelessKeys,
      }));

    setRecords((current) => [
      ...materialized,
      ...current.map((record) => {
        const selectedRecord = selectedByKey.get(recordMergeKey('Locations', record));
        if (!selectedSet.has(record.id) && !selectedRecord) return record;
        return applyChanges(record);
      }),
    ]);
    setHiddenRecordKeys((current) => {
      const nextHidden = current.filter((key) => !selectedRecords.some((record) => recordMergeKey('Locations', record) === key));
      if (nextHidden.length === current.length) return current;
      saveHiddenRecordKeys(resource, nextHidden);
      return nextHidden;
    });
    setBulkLocationEditOpen(false);
    setDeviceError('');
    setSelectedIds([]);
  };

  const exportSelectedRecords = () => {
    exportRowsCsv(
      `${resource.toLowerCase().replace(/\s+/g, '-')}-selected.csv`,
      [config.primaryLabel, config.scopeLabel, 'Role', 'Status', 'Utilization', 'Updated'],
      selectedRecords.map((record) => [
        resourceDisplayValue(resource, record),
        scopeValue(resource, record),
        record.role || '',
        record.status,
        `${capacityFor(resource, record)}%`,
        formatDate(record.lastUpdated),
      ]),
    );
  };

  const changeSort = (field: InfraSortField) => {
    if (sortField === field) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortField(field);
    setSortDirection(field === 'updated' || field === 'utilization' ? 'desc' : 'asc');
  };
  const sortHeader = (field: InfraSortField, label: string) => (
    <button type="button" className={`sort-header ${sortField === field ? 'active' : ''}`} onClick={() => changeSort(field)}>
      {label}{sortField === field ? ` (${sortDirection})` : ''}
    </button>
  );

  const updateRackDevicePosition = async (device: InventoryDevice, rack: InfraRecord, position: number) => {
    const rackUnits = rackDeviceRequestedUnits(device, deviceTypeProfiles);
    const previousDevices = devices;
    try {
      const auth = await ensureApiToken();
      const siteId = await resolveRackSiteId(auth, rack.site, device);
      const payload = {
        position,
        rack: rack.name,
        location: rack.location || '',
        room: rack.region || '',
        rack_units: rackUnits,
        ...(siteId ? { site_id: siteId } : {}),
      };
      const optimistic = mergeSavedRackUnits([{ ...device, ...payload, site_id: siteId || device.site_id, site: rack.site ? { name: rack.site } : device.site }])[0];
      setDevices((current) => current.map((item) => item.id === device.id ? optimistic : item));
      const saved = await patchDeviceAndReload(device.id, payload);
      const updated = mergeSavedRackUnits([{ ...saved, ...payload }])[0];
      setDevices((current) => current.map((item) => item.id === device.id ? updated : item));
      fetchAllDevices()
        .then((fresh) => setDevices(fresh))
        .catch(() => undefined);
      setDeviceError('');
    } catch (error) {
      setDevices(previousDevices);
      const message = error instanceof Error ? error.message : 'Unable to update rack position.';
      setDeviceError(message);
      throw new Error(message);
    }
  };

  const placementOptionsForField = (key: keyof InfraRecord) => {
    const current = inputValue(editing, key);
    const sourceResource = key === 'site' ? 'Sites' : key === 'location' ? 'Locations' : key === 'rack' ? 'Racks' : null;
    if (!sourceResource) return [];
    const manualRows = sourceResource === resource ? records : placementRecords[sourceResource] || loadRecords(sourceResource);
    const selectedSite = resource === 'Racks' || resource === 'Rooms' || resource === 'Locations' ? rackFormSite.trim() : inputValue(editing, 'site').trim();
    const selectedLocation = resource === 'Racks' || resource === 'Rooms' ? rackFormLocation.trim() : inputValue(editing, 'location').trim();
    const rows = sourceResource === 'Locations'
      ? mergeManualAndDerived('Locations', manualRows, [
        ...deriveRecords('Locations', devices),
        ...deriveWirelessRecords('Locations', wirelessAps),
      ])
      : sourceResource === 'Sites'
        ? mergeManualAndDerived('Sites', manualRows, [
          ...deriveRecords('Sites', devices),
          ...deriveWirelessRecords('Sites', wirelessAps),
        ])
        : manualRows;
    const rackNames = resource === 'Racks' && key === 'location'
      ? new Set((placementRecords.Racks || loadRecords('Racks')).map((row) => String(row.name || '').trim().toLowerCase()).filter(Boolean))
      : new Set<string>();
    const values = rows
      .filter((row) => key !== 'location' || !selectedSite || !row.site || sameText(row.site, selectedSite))
      .filter((row) => key !== 'rack' || !selectedLocation || !row.location || sameText(row.location, selectedLocation))
      .map((row) => row.name)
      .filter((value): value is string => Boolean(value && String(value).trim()))
      .filter((value) => key !== 'location' || !rackNames.has(value.trim().toLowerCase()) || sameText(value, current));
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  };

  const rackRoomOptions = () => {
    if (resource !== 'Racks' || !rackFormLocation.trim()) return [];
    const site = rackFormSite.trim().toLowerCase();
    const locationName = rackFormLocation.trim().toLowerCase();
    const location = mergeManualAndDerived('Locations', placementRecords.Locations || loadRecords('Locations'), [
      ...deriveRecords('Locations', devices),
      ...deriveWirelessRecords('Locations', wirelessAps),
    ])
      .find((record) => sameText(record.name, locationName) && (!site || !record.site || sameText(record.site, site)));
    const savedRoomNames = roomNamesForLocation(location);
    const current = inputValue(editing, 'region');
    if (savedRoomNames.length) return current && !savedRoomNames.includes(current) ? [current, ...savedRoomNames] : savedRoomNames;
    return [];
  };

  const locationRoomNameCount = () => {
    if (resource !== 'Locations') return 0;
    const raw = locationFormRooms.trim();
    const count = Math.max(0, Math.floor(Number(raw) || 0));
    return Math.min(Math.max(1, count || 1), 200);
  };

  const renderField = (field: FieldConfig) => {
    const name = String(field.key);
    const commonProps = {
      name,
      required: field.required,
      defaultValue: inputValue(editing, field.key),
      placeholder: field.placeholder,
    };
    if (field.type === 'textarea') {
      return (
        <label className="infra-full-field" key={name}>
          {field.label}
          <textarea {...commonProps} />
        </label>
      );
    }
    if (field.type === 'image') {
      const current = inputValue(editing, field.key);
      return (
        <label className="infra-full-field infra-image-field" key={name}>
          {field.label}
          {current ? <img src={current} alt={`${resourceDisplayValue(resource, editing!)} preview`} /> : <span>No image assigned</span>}
          <input name={name} type="file" accept="image/*" />
        </label>
      );
    }
    if (resource === 'Locations' && field.key === 'rooms') {
      const count = locationRoomNameCount();
      const savedNames = editing?.roomNames || [];
      return (
        <label className={count ? 'infra-full-field location-room-name-field' : undefined} key={name}>
          {field.label}
          <input
            name={name}
            type="number"
            min="0"
            defaultValue={inputValue(editing, field.key) || '1'}
            placeholder={field.placeholder}
            onChange={(event) => setLocationFormRooms(event.target.value)}
          />
          {count > 0 && (
            <span className="location-room-name-grid">
              {Array.from({ length: count }, (_, index) => (
                <span key={index}>
                  <small>{count === 1 ? 'Room name' : `Room ${index + 1} name`}</small>
                  <input name="roomNames" required defaultValue={savedNames[index] || (count === 1 ? DEFAULT_ROOM_NAME : '')} placeholder={count === 1 ? DEFAULT_ROOM_NAME : `Room ${index + 1}`} />
                </span>
              ))}
            </span>
          )}
        </label>
      );
    }
    if (resource === 'Racks' && field.key === 'region') {
      const rooms = rackRoomOptions();
      const current = inputValue(editing, field.key);
      if (rooms.length <= 1) return <input key={name} type="hidden" name={name} value={rooms[0] || ''} readOnly />;
      return (
        <label key={name}>
          {field.label}
          <SearchableSelect
            key={`${name}-${rackFormLocation}`}
            name={name}
            required
            defaultValue={current && rooms.includes(current) ? current : ''}
            placeholder="Select room"
            searchPlaceholder="Search rooms..."
            options={[{ value: '', label: 'Select room', disabled: true }, ...rooms.map((room) => ({ value: room, label: room }))]}
          />
        </label>
      );
    }
    if (field.key === 'site' || field.key === 'location' || field.key === 'rack') {
      const baseOptions = placementOptionsForField(field.key);
      const current = inputValue(editing, field.key);
      const hierarchyParentField = (resource === 'Locations' && field.key === 'site')
        || ((resource === 'Rooms' || resource === 'Racks') && (field.key === 'site' || field.key === 'location'));
      const options = current && !baseOptions.includes(current) ? [current, ...baseOptions] : baseOptions;
      const isCreate = !hierarchyParentField && (createPlacementFields[name] || Boolean(current && !options.includes(current)));
      const selectKey = (resource === 'Racks' || resource === 'Rooms') && field.key === 'location'
        ? `${name}-${rackFormSite}-${isCreate ? 'new' : 'existing'}`
        : `${name}-${isCreate ? 'new' : 'existing'}`;
      const disabled = (resource === 'Rooms' || resource === 'Racks') && field.key === 'location' && !rackFormSite.trim();
      const emptyLabel = disabled ? 'Select site first' : 'Unassigned';
      return (
        <label key={name}>
          {field.label}
          <SearchableSelect
            key={selectKey}
            name={isCreate ? undefined : name}
            required={field.required && !isCreate}
            disabled={disabled}
            defaultValue={isCreate ? CREATE_NEW_VALUE : current}
            placeholder={emptyLabel}
            searchPlaceholder={`Search ${field.label.toLowerCase()}...`}
            options={[
              { value: '', label: emptyLabel, disabled: Boolean(field.required) || disabled },
              ...options.map((option) => ({ value: option, label: option })),
              ...(!hierarchyParentField ? [{ value: CREATE_NEW_VALUE, label: `+ Add new ${field.label.toLowerCase()}` }] : []),
            ]}
            onChange={(value) => {
              setCreatePlacementFields((fields) => ({ ...fields, [name]: value === CREATE_NEW_VALUE }));
              if ((resource === 'Racks' || resource === 'Rooms' || resource === 'Locations') && field.key === 'site') {
                setRackFormSite(value === CREATE_NEW_VALUE ? '' : value);
                setRackFormLocation('');
              }
              if ((resource === 'Racks' || resource === 'Rooms') && field.key === 'location') setRackFormLocation(value === CREATE_NEW_VALUE ? '' : value);
            }}
          />
          {isCreate && <input name={name} required={field.required} defaultValue={current} placeholder={`New ${field.label.toLowerCase()}`} />}
        </label>
      );
    }
    if (field.type === 'select') {
      return (
        <label key={name}>
          {field.label}
          <select name={name} required={field.required} defaultValue={field.key === 'role' ? inputValue(editing, field.key) : inputValue(editing, field.key) || field.options?.[0] || ''}>
            {field.key === 'role' && <option value="">Unassigned</option>}
            {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      );
    }
    return (
      <label key={name}>
        {field.label}
        <input {...commonProps} type={field.type === 'number' ? 'number' : 'text'} />
      </label>
    );
  };

  if (selected) {
    const relationRows = relatedCounts(selected);
    const matchedDevices = relatedDevicesFor(resource, selected, devices);
    const matchedWirelessAps = relatedWirelessFor(resource, selected, wirelessAps);
    const locationRelated = resource === 'Locations' ? buildLocationRelatedData(selected, matchedDevices, matchedWirelessAps) : null;
    const roomRacks = resource === 'Rooms'
      ? mergeManualAndDerived('Racks', placementRecords.Racks || loadRecords('Racks'), deriveRecords('Racks', devices))
        .filter((rack) => roomRecordMatchesRack(selected, rack))
      : [];
    const rackOccupancy = resource === 'Racks' ? rackOccupancyFor(selected, matchedDevices, deviceTypeProfiles) : null;
    const rackDeviceSignature = resource === 'Racks'
      ? matchedDevices
        .map((device) => `${device.id}:${device.rack || ''}:${device.position || ''}:${rackDeviceRequestedUnits(device, deviceTypeProfiles)}`)
        .sort()
        .join('|')
      : '';
    const detailStats = [
      ['Status', selected.status],
      ['Role', selected.role || '-'],
      ['Scope', scopeValue(resource, selected)],
      ['Related', `${matchedDevices.length} devices / ${matchedWirelessAps.length} APs`],
    ];

    const isVlanDetail = resource === 'VLANs';
    const isIpDetail = resource === 'IP Addresses';
    const isPrefixDetail = resource === 'Prefixes';
    const isVrfDetail = resource === 'VRFs';

    return (
      <div className={`content infra-page infra-detail-page${isVlanDetail ? ' vlan-detail-page' : ''}${isIpDetail || isPrefixDetail || isVrfDetail ? ' ip-detail-page' : ''}`}>
        {resource !== 'Rooms' && <div className={`page-title${isVlanDetail || isIpDetail || isPrefixDetail || isVrfDetail ? ' vlan-detail-title' : ''}`}>
          <div>
            {isPrefixDetail ? (
              <>
                <button className="back-link vlan-breadcrumb" onClick={() => setSelected(null)}>IPAM / Prefixes / {selected.prefix || selected.name}</button>
                <h1>{selected.prefix || selected.name} <span className={`infra-status ${selected.status.toLowerCase()}`}>{selected.status}</span></h1>
                <p>{selected.description || selected.name || 'Prefix details'} <span className="prefix-title-chip">{selected.tags || 'Primary'}</span></p>
              </>
            ) : isIpDetail ? (
              <>
                <button className="back-link vlan-breadcrumb" onClick={() => setSelected(null)}>IPAM / IP Addresses / {ipOnly(selected.address || selected.name)}</button>
                <h1>IP Address Details <span className={`infra-status ${selected.status.toLowerCase()}`}>{selected.status}</span></h1>
              </>
            ) : isVlanDetail ? (
              <>
                <button className="back-link vlan-breadcrumb" onClick={() => setSelected(null)}>Infrastructure / VLANs / {selected.name}</button>
                <h1>VLAN Details</h1>
                <p>Manage VLAN identity, scope, prefixes, linked devices, and network relationships.</p>
              </>
            ) : isVrfDetail ? (
              <>
                <button className="back-link vlan-breadcrumb" onClick={() => setSelected(null)}>IPAM / VRFs / {selected.name}</button>
                <h1>VRF Details <span className={`infra-status ${selected.status.toLowerCase()}`}>{selected.status}</span></h1>
                <p>Manage routing domain scope, linked networks, devices, and route target records.</p>
              </>
            ) : (
              <>
                <button className="back-link" onClick={() => setSelected(null)}><ArrowLeft size={14} /> Back to {resource}</button>
                <h1>{config.detailTitle}</h1>
                <p>{resourceDisplayValue(resource, selected)}</p>
              </>
            )}
          </div>
          <div className="device-actions">
            <button className="plain-button" onClick={() => openEdit(selected)}><Edit3 size={15} /> Edit</button>
            {['Sites', 'Locations', 'Racks'].includes(resource) && <button className="plain-button" onClick={() => setComponentAssignTarget({ resource, record: selected })}><Box size={15} /> Add Component</button>}
            {(isIpDetail || isPrefixDetail) && <button className="plain-button"><ArrowLeft size={15} /> Move</button>}
            {isVrfDetail && <button className="plain-button"><Database size={15} /> Export</button>}
            <button className="plain-button danger-button" onClick={() => setDeleteTarget(selected)}><Trash2 size={15} /> Delete</button>
            {(isIpDetail || isPrefixDetail) && <button className="plain-button"><Database size={15} /> Export</button>}
          </div>
        </div>}

        {resource !== 'Sites' && resource !== 'Rooms' && resource !== 'Racks' && resource !== 'Locations' && resource !== 'VLANs' && resource !== 'IP Addresses' && resource !== 'Prefixes' && resource !== 'VRFs' && (
          <>
            <section className="infra-hero card">
              <div className="infra-hero-icon"><Icon size={34} /></div>
              <div>
                <span>{config.singular}</span>
                <h2>{resourceDisplayValue(resource, selected)}</h2>
                <p>{selected.description || config.subtitle}</p>
              </div>
              <span className={`infra-status ${selected.status.toLowerCase()}`}>{selected.status}</span>
            </section>

            <div className="infra-detail-stats">
              {detailStats.map(([label, value]) => (
                <div key={label}>
                  <p>{label}</p>
                  <b>{value}</b>
                </div>
              ))}
            </div>

            <div className="infra-detail-grid">
              <section className="card infra-detail-card">
                <div className="card-title">Identity</div>
                <div className="infra-kv">
                  <p><span>Name</span>{selected.name || '-'}</p>
                  <p><span>Address / Prefix</span>{selected.address || selected.prefix || '-'}</p>
                  <p><span>VLAN ID</span>{selected.vlanId || '-'}</p>
                  <p><span>VRF</span>{selected.vrf || '-'}</p>
                  <p><span>Tenant</span>{selected.tenant || '-'}</p>
                  <p><span>Tags</span>{selected.tags || '-'}</p>
                </div>
              </section>

              <section className="card infra-detail-card">
                <div className="card-title">Placement</div>
                <div className="infra-kv">
                  <p><span>Site</span>{selected.site || (resource === 'Sites' ? selected.name : '-')}</p>
                  <p><span>Location</span>{selected.location || '-'}</p>
                  <p><span>Rack</span>{selected.rack || '-'}</p>
                  <p><span>Region</span>{selected.region || '-'}</p>
                  <p><span>Gateway</span>{selected.gateway || '-'}</p>
                  <p><span>Device count</span>{selected.devices ?? '-'}</p>
                </div>
              </section>

              <section className="card infra-detail-card">
                <div className="card-title">Capacity</div>
                <div className="infra-capacity">
                  <strong>{capacityFor(resource, selected)}%</strong>
                  <div><i style={{ width: `${Math.min(100, capacityFor(resource, selected))}%` }} /></div>
                  <p>Recorded utilization</p>
                </div>
              </section>

              <section className="card infra-detail-card">
                <div className="card-title">Related Records</div>
                <div className="infra-related">
                  {relationRows.length ? relationRows.map(([label, count]) => (
                    <p key={label}><span>{label}</span><b>{count}</b></p>
                  )) : <p className="empty">No related records found yet.</p>}
                </div>
              </section>
            </div>

            <section className="card infra-detail-card">
              <div className="card-title">Operational Notes</div>
              <p className="infra-notes">{selected.description || 'No description has been recorded for this object yet.'}</p>
            </section>
          </>
        )}

        {resource === 'Prefixes' ? (
          <PrefixDetailOverview prefix={selected} records={displayedRecords} devices={devices} />
        ) : resource === 'IP Addresses' ? (
          <IpAddressDetailOverview ip={selected} records={displayedRecords} devices={devices} />
        ) : resource === 'VRFs' ? (
          <VrfDetailOverview vrf={selected} devices={devices} />
        ) : resource === 'VLANs' ? (
          <VlanDetailOverview vlan={selected} devices={matchedDevices} />
        ) : resource === 'Racks' && rackOccupancy ? (
          <RackDetailDashboard key={`${selected.id}-${rackDeviceSignature}`} rack={selected} devices={matchedDevices} allDevices={devices} occupancy={rackOccupancy} environments={rackEnvironments} temperatureHistory={rackTemperatureHistory[selected.id] || []} deviceTypes={deviceTypeProfiles} onMoveDevice={updateRackDevicePosition} />
        ) : resource === 'Rooms' ? (
          <RoomDetailOverview
            room={selected}
            racks={roomRacks}
            allDevices={devices}
            environments={rackEnvironments}
            deviceTypes={deviceTypeProfiles}
            onBack={() => setSelected(null)}
            onEdit={() => openEdit(selected)}
            onDelete={() => setDeleteTarget(selected)}
            onAddComponent={() => setComponentAssignTarget({ resource: 'Rooms', record: selected })}
            onAddRack={() => {
              setSelected(null);
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent('aims:navigate-infrastructure-detail', { detail: { resource: 'Racks' } }));
              }, 0);
            }}
            onOpenRack={(rack) => openInfrastructureDetail('Racks', rack)}
          />
        ) : resource === 'Sites' ? (
          <SiteDetailOverview
            site={selected}
            devices={matchedDevices}
            aps={matchedWirelessAps}
            placementRecords={placementRecords}
            allDevices={devices}
            wirelessAps={wirelessAps}
            deviceTypes={deviceTypeProfiles}
          />
        ) : resource === 'Locations' && locationRelated ? (
          <>
            <LocationDetailOverview location={selected} data={locationRelated} />
            <LocationRelatedWorkspace
              data={locationRelated}
              activeTab={detailTab}
              search={detailSearch}
              deviceTypes={deviceTypeProfiles}
              onTabChange={setDetailTab}
              onSearchChange={setDetailSearch}
            />
          </>
        ) : (
          <>
            <section className="card infra-related-devices">
              <div className="card-title">Related Devices <small>{matchedDevices.length} matched from inventory</small></div>
              <RelatedDevicesTable rows={matchedDevices.slice(0, 25)} />
            </section>
          </>
        )}

        {showForm && (
          <InfrastructureForm
            title={editing ? `Edit ${config.singular}` : `Add ${config.singular}`}
            fields={config.fields}
            editing={editing}
            renderField={renderField}
            onCancel={() => { setShowForm(false); setEditing(null); }}
            onSubmit={handleSave}
          />
        )}

        {componentAssignTarget && (
          <ComponentAssignmentDialog
            target={componentAssignTarget}
            onCancel={() => setComponentAssignTarget(null)}
            onAssigned={() => setComponentAssignTarget(null)}
          />
        )}

        <DeleteConfirmDialog
          open={Boolean(deleteTarget)}
          title={`Delete ${config.singular}`}
          itemName={deleteTarget ? resourceDisplayValue(resource, deleteTarget) : ''}
          message={`This will remove the ${config.singular.toLowerCase()} from this workspace.`}
          details={['Related records are not deleted automatically.', 'This action only affects the current infrastructure inventory data.']}
          onCancel={() => setDeleteTarget(null)}
          busy={deleteBusy}
          onConfirm={confirmDelete}
        />
      </div>
    );
  }

  return (
    <div className="content infra-page">
      <div className="page-title">
        <div>
          <h1>{resource}</h1>
          <p>{config.subtitle}</p>
          {deviceError || wirelessError ? <small className="infra-source-note error-text">{[deviceError, wirelessError].filter(Boolean).join(' ')}</small> : <small className="infra-source-note">{loadingDevices ? 'Loading related inventory...' : `${devices.length} devices and ${wirelessAps.length} wireless APs linked`}</small>}
        </div>
        <div className="device-actions">
          {resource !== 'Rooms' && resource !== 'Sites' && <button className="add" onClick={openCreate}><Plus size={17} /> Add {config.singular}</button>}
        </div>
      </div>

      {resource === 'Locations' ? (
        <LocationListWorkspace
          records={displayedRecords}
          devices={devices}
          wirelessAps={wirelessAps}
          query={query}
          selectedIds={selectedIds}
          onQueryChange={setQuery}
          onToggleLocation={toggleRecordSelected}
          onSelectIds={setSelectedIds}
          onOpenLocation={setSelected}
          onEditLocation={openEdit}
          onDeleteLocation={setDeleteTarget}
          onBulkEditSelected={() => setBulkLocationEditOpen(true)}
          onDeleteSelected={() => setBulkDeleteOpen(true)}
          onExportSelected={exportSelectedRecords}
        />
      ) : resource === 'Sites' ? (
        <SiteListWorkspace
          records={displayedRecords}
          devices={devices}
          wirelessAps={wirelessAps}
          placementRecords={placementRecords}
          deviceTypes={deviceTypeProfiles}
          selectedIds={selectedIds}
          query={query}
          onQueryChange={setQuery}
          onToggleRecord={toggleRecordSelected}
          onSelectIds={setSelectedIds}
          onOpenSite={setSelected}
          onEditSite={openEdit}
          onDeleteSite={setDeleteTarget}
          onCreateSite={openCreate}
          onDeleteSelected={() => setBulkDeleteOpen(true)}
          onExportSelected={exportSelectedRecords}
        />
      ) : resource === 'VLANs' ? (
        <VlanListWorkspace
          records={displayedRecords}
          devices={devices}
          query={query}
          onQueryChange={setQuery}
          onOpenVlan={setSelected}
          onEditVlan={openEdit}
          onDeleteVlan={setDeleteTarget}
        />
      ) : resource === 'IP Addresses' ? (
        <IpAddressListWorkspace
          records={displayedRecords}
          devices={devices}
          query={query}
          onQueryChange={setQuery}
          onOpenIp={setSelected}
          onEditIp={openEdit}
          onDeleteIp={setDeleteTarget}
        />
      ) : resource === 'Prefixes' ? (
        <PrefixListWorkspace
          records={displayedRecords}
          devices={devices}
          query={query}
          onQueryChange={setQuery}
          onOpenPrefix={setSelected}
          onEditPrefix={openEdit}
          onDeletePrefix={setDeleteTarget}
        />
      ) : resource === 'VRFs' ? (
        <VrfListWorkspace
          records={displayedRecords}
          devices={devices}
          query={query}
          onQueryChange={setQuery}
          onOpenVrf={setSelected}
          onEditVrf={openEdit}
          onDeleteVrf={setDeleteTarget}
        />
      ) : resource === 'Racks' ? (
        <RackListWorkspace
          records={displayedRecords}
          devices={devices}
          deviceTypes={deviceTypeProfiles}
          environments={rackEnvironments}
          selectedIds={selectedIds}
          query={query}
          onQueryChange={setQuery}
          onToggleRecord={toggleRecordSelected}
          onSelectIds={setSelectedIds}
          onOpenRack={setSelected}
          onEditRack={openEdit}
          onDeleteRack={setDeleteTarget}
          onDeleteSelected={() => setBulkDeleteOpen(true)}
          onExportSelected={exportSelectedRecords}
        />
      ) : resource === 'Rooms' ? (
        <RoomListWorkspace
          records={displayedRecords}
          devices={devices}
          racks={placementRecords.Racks || []}
          deviceTypes={deviceTypeProfiles}
          environments={rackEnvironments}
          selectedIds={selectedIds}
          query={query}
          onQueryChange={setQuery}
          onToggleRecord={toggleRecordSelected}
          onSelectIds={setSelectedIds}
          onOpenRoom={setSelected}
          onEditRoom={openEdit}
          onDeleteRoom={setDeleteTarget}
          onCreateRoom={openCreate}
          onImportRooms={(importedRooms) => {
            setRecords((current) => {
              const next = [...current];
              importedRooms.forEach((room) => {
                const key = recordMergeKey('Rooms', room);
                const index = next.findIndex((record) => recordMergeKey('Rooms', record) === key);
                if (index >= 0) next[index] = { ...next[index], ...room, id: next[index].id, lastUpdated: new Date().toISOString() };
                else next.unshift(room);
              });
              return next;
            });
          }}
          onDeleteSelected={() => setBulkDeleteOpen(true)}
          onExportSelected={exportSelectedRecords}
        />
      ) : (
        <>
          <div className="infra-summary">
            <div><Icon /><p>Total {String(resource).toLowerCase()}</p><b>{displayedRecords.length}</b></div>
            <div><Activity /><p>Active</p><b>{activeCount}</b></div>
            <div><Tags /><p>Planned / reserved</p><b>{reservedCount}</b></div>
            <div><Layers /><p>Average utilization</p><b>{avgUtilization}%</b></div>
          </div>

          <section className="card inventory infra-inventory">
            {selectedIds.length > 0 && (
              <div className="bulk-toolbar">
                <b>{selectedIds.length} selected</b>
                <button className="plain-button" disabled={!selectedRecords.length} onClick={() => selectedRecords[0] && setSelected(selectedRecords[0])}>Open first</button>
                <button className="plain-button" disabled={!selectedRecords.length} onClick={exportSelectedRecords}>Export selected</button>
                <button className="plain-button danger-button" onClick={() => setBulkDeleteOpen(true)}>Delete selected</button>
                <button className="plain-button" onClick={() => setSelectedIds([])}>Clear</button>
              </div>
            )}
            <div className="inventory-head">
              <div className="card-title">{resource} <small>{visible.length} shown</small></div>
              <div className="table-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${String(resource).toLowerCase()}...`} /></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleSelected} aria-label={`Select all visible ${resource}`} /></th>
                    <th>{sortHeader('primary', config.primaryLabel.toUpperCase())}</th>
                    <th>{sortHeader('scope', config.scopeLabel.toUpperCase())}</th>
                    <th>{sortHeader('role', 'ROLE')}</th>
                    <th>{sortHeader('status', 'STATUS')}</th>
                    <th>{sortHeader('utilization', 'UTILIZATION')}</th>
                    <th>{sortHeader('updated', 'UPDATED')}</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {(visible as InfraRecord[]).map((record) => (
                    <tr key={record.id}>
                      <td><input type="checkbox" checked={selectedIds.includes(record.id)} onChange={() => toggleRecordSelected(record.id)} aria-label={`Select ${resourceDisplayValue(resource, record)}`} /></td>
                      <td>
                        <button className="device-link infra-record-link" onClick={() => setSelected(record)}>{resourceDisplayValue(resource, record)}</button>
                        <small>{record.description || `${config.singular} record`}</small>
                        <small className={`infra-source ${record.source === 'device' ? 'device' : record.source === 'wireless' ? 'wireless' : 'manual'}`}>{record.source === 'device' ? 'From device inventory' : record.source === 'wireless' ? 'From wireless controller' : 'Manual record'}</small>
                      </td>
                      <td>{scopeValue(resource, record)}</td>
                      <td>{record.role || '-'}</td>
                      <td><span className={`infra-status ${String(record.status).toLowerCase()}`}>{record.status}</span></td>
                      <td>
                        <div className="infra-table-meter"><i style={{ width: `${Math.min(100, capacityFor(resource, record))}%` }} /></div>
                        <small>{capacityFor(resource, record)}%</small>
                      </td>
                      <td>{formatDate(record.lastUpdated)}</td>
                      <td className="infra-row-actions">
                        <button className="row-action" onClick={() => setSelected(record)}>Details</button>
                        <button className="row-action" onClick={() => openEdit(record)}>Edit</button>
                        <button className="row-action danger" onClick={() => setDeleteTarget(record)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                  {!visible.length && <tr><td colSpan={8} className="empty">No {String(resource).toLowerCase()} found.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {showForm && (
        <InfrastructureForm
          title={editing ? `Edit ${config.singular}` : `Add ${config.singular}`}
          fields={config.fields}
          editing={editing}
          renderField={renderField}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          onSubmit={handleSave}
        />
      )}

      {resource === 'Locations' && bulkLocationEditOpen && (
        <div className="modal-backdrop" onMouseDown={() => setBulkLocationEditOpen(false)}>
          <form className="device-form large infra-form location-bulk-edit-form" onSubmit={saveBulkLocationEdit} onMouseDown={(event) => event.stopPropagation()}>
            <div className="form-header">
              <div>
                <h2>Edit selected locations</h2>
                <p>Apply common location fields to {selectedIds.length} selected record{selectedIds.length === 1 ? '' : 's'}. Leave fields blank to keep existing values.</p>
              </div>
              <button type="button" onClick={() => setBulkLocationEditOpen(false)}><X size={18} /></button>
            </div>
            <div className="form-grid">
              <label>Location<input name="name" placeholder="Keep current location name" /></label>
              <label>Site
                <SearchableSelect
                  name="site"
                  defaultValue=""
                  placeholder="Keep current site"
                  searchPlaceholder="Search sites..."
                  options={[
                    { value: '', label: 'Keep current site' },
                    ...bulkLocationSiteOptions.map((site) => ({ value: site, label: site })),
                  ]}
                />
              </label>
              <label>Type / Role<input name="role" placeholder="Keep current" /></label>
              <label>Status
                <select name="status" defaultValue="">
                  <option value="">Keep current</option>
                  {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </label>
              <label>Tags<input name="tags" placeholder="Keep current" /></label>
            </div>
            <div className="form-actions">
              <button type="button" onClick={() => setBulkLocationEditOpen(false)}>Cancel</button>
              <button className="add" type="submit">Apply changes</button>
            </div>
          </form>
        </div>
      )}

      {componentAssignTarget && (
        <ComponentAssignmentDialog
          target={componentAssignTarget}
          onCancel={() => setComponentAssignTarget(null)}
          onAssigned={() => setComponentAssignTarget(null)}
        />
      )}

      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        title={`Delete ${config.singular}`}
        itemName={deleteTarget ? resourceDisplayValue(resource, deleteTarget) : ''}
        message={`This will remove the ${config.singular.toLowerCase()} from this workspace.`}
        details={[
          `Status: ${deleteTarget?.status || '-'}`,
          `Scope: ${deleteTarget ? scopeValue(resource, deleteTarget) : '-'}`,
          'Confirm only if this record should no longer appear in infrastructure inventory.',
        ]}
        onCancel={() => setDeleteTarget(null)}
        busy={deleteBusy}
        onConfirm={confirmDelete}
      />

      <DeleteConfirmDialog
        open={bulkDeleteOpen}
        title={`Delete selected ${resource.toLowerCase()}`}
        itemName={`${selectedIds.length} selected records`}
        message={`This removes selected manual ${resource.toLowerCase()} records from this workspace.`}
        details={[
          'Auto-derived records from device inventory or wireless controllers will be hidden from this inventory view.',
          'Related records are not deleted automatically.',
        ]}
        confirmLabel={`Delete ${selectedIds.length} records`}
        onCancel={() => setBulkDeleteOpen(false)}
        busy={deleteBusy}
        onConfirm={confirmBulkDelete}
      />
    </div>
  );
}

function SiteListWorkspace({
  records,
  devices,
  wirelessAps,
  placementRecords,
  deviceTypes,
  selectedIds,
  query,
  onQueryChange,
  onToggleRecord,
  onSelectIds,
  onOpenSite,
  onEditSite,
  onDeleteSite,
  onCreateSite,
  onDeleteSelected,
  onExportSelected,
}: {
  records: InfraRecord[];
  devices: InventoryDevice[];
  wirelessAps: WirelessAp[];
  placementRecords: Record<InfrastructureResourceName, InfraRecord[]>;
  deviceTypes: DeviceTypeRecord[];
  selectedIds: string[];
  query: string;
  onQueryChange: (value: string) => void;
  onToggleRecord: (id: string) => void;
  onSelectIds: (ids: string[]) => void;
  onOpenSite: (site: InfraRecord) => void;
  onEditSite: (site: InfraRecord) => void;
  onDeleteSite: (site: InfraRecord) => void;
  onCreateSite: () => void;
  onDeleteSelected: () => void;
  onExportSelected: () => void;
}) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [healthFilter, setHealthFilter] = useState('all');

  const enriched = useMemo(() => records.map((record) => siteRowMetrics(record, devices, wirelessAps, placementRecords, deviceTypes)), [records, devices, wirelessAps, placementRecords, deviceTypes]);
  const roleOptions = uniqueRackValues(enriched.map((row) => row.record.role || row.type));
  const regionOptions = uniqueRackValues(enriched.map((row) => row.region));
  const visible = enriched.filter((row) => {
    const search = query.trim().toLowerCase();
    const matchesSearch = !search || [
      row.record.name,
      row.record.description,
      row.record.role,
      row.region,
      row.type,
      row.record.tags,
    ].join(' ').toLowerCase().includes(search);
    const matchesStatus = statusFilter === 'all' || row.record.status === statusFilter;
    const matchesRole = roleFilter === 'all' || row.record.role === roleFilter || row.type === roleFilter;
    const matchesRegion = regionFilter === 'all' || row.region === regionFilter;
    const matchesHealth = healthFilter === 'all'
      || (healthFilter === 'healthy' && row.health >= 90)
      || (healthFilter === 'warning' && row.health >= 60 && row.health < 90)
      || (healthFilter === 'critical' && row.health < 60);
    return matchesSearch && matchesStatus && matchesRole && matchesRegion && matchesHealth;
  }).sort((a, b) => a.record.name.localeCompare(b.record.name, undefined, { numeric: true, sensitivity: 'base' }));
  const visibleIds = visible.map((row) => row.record.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const selectedRows = enriched.filter((row) => selectedIds.includes(row.record.id));
  const activeFilterCount = [statusFilter, roleFilter, regionFilter, healthFilter].filter((value) => value !== 'all').length;

  const toggleVisible = () => {
    if (allVisibleSelected) {
      const visibleSet = new Set(visibleIds);
      onSelectIds(selectedIds.filter((id) => !visibleSet.has(id)));
      return;
    }
    onSelectIds([...new Set([...selectedIds, ...visibleIds])]);
  };

  const clearFilters = () => {
    onQueryChange('');
    setStatusFilter('all');
    setRoleFilter('all');
    setRegionFilter('all');
    setHealthFilter('all');
  };

  const exportSites = () => {
    exportRowsCsv(
      'sites.csv',
      ['Site', 'Role', 'Region', 'Status', 'Locations', 'Rooms', 'Racks', 'Devices', 'APs', 'Health', 'Power', 'Updated'],
      visible.map((row) => [
        row.record.name,
        row.record.role || '',
        row.region,
        row.record.status,
        row.locations,
        row.rooms,
        row.racks,
        row.devices,
        row.aps,
        `${row.health}%`,
        formatRackPowerValue(row.power, ''),
        formatDate(row.record.lastUpdated),
      ]),
    );
  };

  const totals = enriched.reduce((sum, row) => ({
    sites: sum.sites + 1,
    active: sum.active + (row.record.status === 'Active' ? 1 : 0),
    locations: sum.locations + row.locations,
    rooms: sum.rooms + row.rooms,
    racks: sum.racks + row.racks,
    devices: sum.devices + row.devices,
    aps: sum.aps + row.aps,
    critical: sum.critical + (row.health < 60 ? 1 : 0),
    powerWatts: sum.powerWatts + (row.power.watts || 0),
  }), { sites: 0, active: 0, locations: 0, rooms: 0, racks: 0, devices: 0, aps: 0, critical: 0, powerWatts: 0 });
  const averageHealth = enriched.length ? Math.round(enriched.reduce((sum, row) => sum + row.health, 0) / enriched.length) : 100;

  return (
    <div className="location-list-workspace site-list-workspace">
      <div className="location-list-kpis site-list-kpis">
        <SiteListKpi icon={<Building2 size={19} />} label="Total Sites" value={totals.sites} sub={`${totals.active} active`} tone="blue" />
        <SiteListKpi icon={<MapPin size={19} />} label="Locations" value={totals.locations} sub={`${totals.rooms} rooms`} tone="green" />
        <SiteListKpi icon={<Warehouse size={19} />} label="Racks" value={totals.racks} sub="Across all sites" tone="purple" />
        <SiteListKpi icon={<Server size={19} />} label="Devices" value={totals.devices} sub={`${totals.aps} wireless APs`} tone={averageHealth < 80 ? 'red' : 'cyan'} />
      </div>

      <section className="card location-table-card site-list-table-card">
        {selectedIds.length > 0 && (
          <div className="bulk-toolbar location-bulk-toolbar">
            <b>{selectedIds.length} selected</b>
            <button className="plain-button" disabled={!selectedRows.length} onClick={() => selectedRows[0] && onOpenSite(selectedRows[0].record)}>Open first</button>
            <button className="plain-button" disabled={!selectedRows.length} onClick={() => selectedRows[0] && onEditSite(selectedRows[0].record)}>Edit first</button>
            <button className="plain-button" onClick={onExportSelected}>Export selected</button>
            <button className="plain-button danger-button" onClick={onDeleteSelected}>Delete selected</button>
            <button className="plain-button" onClick={() => onSelectIds([])}>Clear</button>
          </div>
        )}

        <div className="location-table-head site-list-head">
          <div>
            <h2>Sites</h2>
            <p>{visible.length} of {records.length} site{records.length === 1 ? '' : 's'} shown</p>
          </div>
          <div className="location-table-tools site-list-tools">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All Statuses</option>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
              <option value="all">All Roles</option>
              {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
            <select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>
              <option value="all">All Regions</option>
              {regionOptions.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
            <select value={healthFilter} onChange={(event) => setHealthFilter(event.target.value)}>
              <option value="all">All Health</option>
              <option value="healthy">Healthy</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
            <div className="location-search site-list-search"><Search size={15} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search sites, regions, roles..." /></div>
            <button type="button" className="plain-button" disabled={!activeFilterCount && !query.trim()} onClick={clearFilters}>Clear</button>
            <button type="button" className="plain-button" onClick={exportSites}><Download size={15} /> Export</button>
            <button type="button" className="plain-button" aria-label="More site actions"><MoreHorizontal size={16} /></button>
            <button type="button" className="add" onClick={onCreateSite}><Plus size={17} /> Add Site</button>
          </div>
        </div>

        <div className="location-table-wrap site-list-table-wrap">
          <table className="site-list-table">
            <thead>
              <tr>
                <th className="location-select-col"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="Select all visible sites" /></th>
                <th>Site</th>
                <th>Role</th>
                <th>Region</th>
                <th>Status</th>
                <th>Locations</th>
                <th>Rooms</th>
                <th>Racks</th>
                <th>Devices</th>
                <th>Power</th>
                <th>Health</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const selected = selectedIds.includes(row.record.id);
                return (
                <tr key={row.record.id} className={selected ? 'selected' : ''} onClick={() => onOpenSite(row.record)}>
                  <td className="location-select-col">
                    <input
                      type="checkbox"
                      checked={selected}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => onToggleRecord(row.record.id)}
                      aria-label={`Select ${row.record.name}`}
                    />
                  </td>
                  <td>
                    <div className="site-name-cell">
                      <span className={`site-icon-badge ${siteHealthClass(row.health)}`}><Building2 size={21} /></span>
                      <span>
                        <button type="button" onClick={(event) => { event.stopPropagation(); onOpenSite(row.record); }}>{row.record.name}</button>
                        <small>{row.record.description || row.type}</small>
                      </span>
                    </div>
                  </td>
                  <td><span className="site-role-badge">{row.record.role || row.type}</span></td>
                  <td><b>{row.region}</b><small>{row.record.tenant || 'No tenant'}</small></td>
                  <td><span className={`infra-status ${row.record.status.toLowerCase()}`}>{row.record.status}</span></td>
                  <td>{row.locations}</td>
                  <td>{row.rooms}</td>
                  <td>{row.racks}</td>
                  <td><b>{row.devices}</b><small>{row.aps} APs</small></td>
                  <td>{formatRackPowerValue(row.power, '-')}</td>
                  <td><SiteHealthMeter value={row.health} /></td>
                  <td>{formatDate(row.record.lastUpdated)}</td>
                  <td className="infra-row-actions">
                    <button className="row-action" type="button" onClick={(event) => { event.stopPropagation(); onOpenSite(row.record); }}>Details</button>
                    <button className="row-action" type="button" onClick={(event) => { event.stopPropagation(); onEditSite(row.record); }}>Edit</button>
                    <button className="row-action danger" type="button" onClick={(event) => { event.stopPropagation(); onDeleteSite(row.record); }}>Delete</button>
                  </td>
                </tr>
                );
              })}
              {!visible.length && <tr><td colSpan={13} className="empty">No sites matched the current filters.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="location-table-footer">Showing {visible.length ? 1 : 0} to {visible.length} of {records.length} sites</div>
      </section>
    </div>
  );
}

function SiteListKpi({ icon, label, value, sub, tone, progress }: { icon: ReactElement; label: string; value: string | number; sub: string; tone: 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'cyan'; progress?: number }) {
  return (
    <section className={`location-kpi site-location-kpi ${tone}`}>
      <span>{icon}</span>
      <p>{label}</p>
      <b>{value}</b>
      <small>{sub}</small>
      {typeof progress === 'number' && <i><em style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></i>}
    </section>
  );
}

function SiteHealthMeter({ value }: { value: number }) {
  return (
    <div className={`site-health-meter ${siteHealthClass(value)}`}>
      <span>{value}%</span>
      <i><em style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>
    </div>
  );
}

function siteHealthClass(value: number) {
  if (value < 60) return 'critical';
  if (value < 90) return 'warning';
  return 'healthy';
}

function siteRowMetrics(site: InfraRecord, devices: InventoryDevice[], wirelessAps: WirelessAp[], placementRecords: Record<InfrastructureResourceName, InfraRecord[]>, deviceTypes: DeviceTypeRecord[]) {
  const siteDevices = relatedDevicesFor('Sites', site, devices);
  const siteAps = relatedWirelessFor('Sites', site, wirelessAps);
  const locations = siteRecordsFor('Locations', site, placementRecords, devices, wirelessAps);
  const rooms = siteRecordsFor('Rooms', site, placementRecords, devices, wirelessAps);
  const racks = siteRecordsFor('Racks', site, placementRecords, devices, wirelessAps);
  const rackDevices = uniqueDevices(racks.flatMap((rack) => relatedDevicesFor('Racks', rack, devices)));
  const power = rackPowerSummary(rackDevices.length ? rackDevices : siteDevices, deviceTypes, site);
  const activeDevices = siteDevices.filter((device) => rackDeviceIsActive(device)).length;
  const activeAps = siteAps.filter((ap) => !/down|offline|disconnected|failed/i.test(String(ap.status || ''))).length;
  const totalEndpoints = siteDevices.length + siteAps.length;
  const activeEndpoints = activeDevices + activeAps;
  const health = totalEndpoints ? Math.round((activeEndpoints / totalEndpoints) * 100) : site.status === 'Active' ? 100 : 0;
  const region = site.region || site.location || 'Unassigned';
  return {
    record: site,
    type: site.role || 'Operational Site',
    region,
    locations: locations.length,
    rooms: rooms.length,
    racks: racks.length,
    devices: siteDevices.length,
    aps: siteAps.length,
    health,
    power,
  };
}

function RoomListWorkspace({
  records,
  devices,
  racks,
  deviceTypes,
  environments,
  selectedIds,
  query,
  onQueryChange,
  onToggleRecord,
  onSelectIds,
  onOpenRoom,
  onEditRoom,
  onDeleteRoom,
  onCreateRoom,
  onImportRooms,
  onDeleteSelected,
  onExportSelected,
}: {
  records: InfraRecord[];
  devices: InventoryDevice[];
  racks: InfraRecord[];
  deviceTypes: DeviceTypeRecord[];
  environments: Record<number, RackDeviceEnvironment>;
  selectedIds: string[];
  query: string;
  onQueryChange: (value: string) => void;
  onToggleRecord: (id: string) => void;
  onSelectIds: (ids: string[]) => void;
  onOpenRoom: (room: InfraRecord) => void;
  onEditRoom: (room: InfraRecord) => void;
  onDeleteRoom: (room: InfraRecord) => void;
  onCreateRoom: () => void;
  onImportRooms: (rooms: InfraRecord[]) => void;
  onDeleteSelected: () => void;
  onExportSelected: () => void;
}) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importMessage, setImportMessage] = useState('');
  const [activeRoomId, setActiveRoomId] = useState('');
  const [locationFilter, setLocationFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [environmentFilter, setEnvironmentFilter] = useState('all');
  const [floorFilter, setFloorFilter] = useState('all');
  const [capacityFilter, setCapacityFilter] = useState('all');

  const enriched = useMemo(() => records.map((record) => roomRowMetrics(record, devices, racks, deviceTypes, environments)), [records, devices, racks, deviceTypes, environments]);
  const locationOptions = uniqueRackValues(enriched.map((row) => row.locationLabel));
  const typeOptions = uniqueRackValues(enriched.map((row) => row.type));
  const floorOptions = uniqueRackValues(enriched.map((row) => row.floor));
  const visible = enriched.filter((row) => {
    const search = query.trim().toLowerCase();
    const matchesSearch = !search || [
      row.record.name,
      row.record.description,
      row.record.site,
      row.record.location,
      row.type,
      row.floor,
      row.statusLabel,
    ].join(' ').toLowerCase().includes(search);
    const matchesLocation = locationFilter === 'all' || row.locationLabel === locationFilter;
    const matchesType = typeFilter === 'all' || row.type === typeFilter;
    const matchesStatus = statusFilter === 'all' || row.record.status === statusFilter || row.statusLabel === statusFilter;
    const matchesEnvironment = environmentFilter === 'all' || row.environmentTone === environmentFilter;
    const matchesFloor = floorFilter === 'all' || row.floor === floorFilter;
    const matchesCapacity = capacityFilter === 'all'
      || (capacityFilter === 'low' && row.utilization < 40)
      || (capacityFilter === 'medium' && row.utilization >= 40 && row.utilization < 75)
      || (capacityFilter === 'high' && row.utilization >= 75);
    return matchesSearch && matchesLocation && matchesType && matchesStatus && matchesEnvironment && matchesFloor && matchesCapacity;
  }).sort((a, b) => a.record.name.localeCompare(b.record.name, undefined, { numeric: true, sensitivity: 'base' }));
  const visibleIds = visible.map((row) => row.record.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const selectedRows = enriched.filter((row) => selectedIds.includes(row.record.id));
  const activeFilterCount = [locationFilter, typeFilter, statusFilter, environmentFilter, floorFilter, capacityFilter].filter((value) => value !== 'all').length;

  useEffect(() => {
    if (!visible.length) {
      setActiveRoomId('');
      return;
    }
    if (!visible.some((row) => row.record.id === activeRoomId)) setActiveRoomId(visible[0].record.id);
  }, [activeRoomId, visible]);

  const toggleVisible = () => {
    if (allVisibleSelected) {
      const visibleSet = new Set(visibleIds);
      onSelectIds(selectedIds.filter((id) => !visibleSet.has(id)));
      return;
    }
    onSelectIds([...new Set([...selectedIds, ...visibleIds])]);
  };

  const clearFilters = () => {
    onQueryChange('');
    setLocationFilter('all');
    setTypeFilter('all');
    setStatusFilter('all');
    setEnvironmentFilter('all');
    setFloorFilter('all');
    setCapacityFilter('all');
  };

  const exportRooms = () => {
    exportRowsCsv(
      'rooms.csv',
      ['Room Name', 'Location', 'Site', 'Type', 'Floor', 'Temperature', 'Power', 'Utilization', 'Devices', 'Racks', 'Status', 'Updated'],
      visible.map((row) => [
        row.record.name,
        row.record.location || '',
        row.record.site || '',
        row.type,
        row.floor,
        row.temperature.value === null ? '' : `${row.temperature.value} C`,
        formatRackPowerValue(row.power, ''),
        `${row.utilization}%`,
        row.deviceCount,
        row.rackCount,
        row.statusLabel,
        formatDate(row.record.lastUpdated),
      ]),
    );
  };
  const importRooms = async (file?: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parseCsvObjects(text);
      const imported = rows.map((row) => {
        const name = String(row['room name'] || row.room || row.name || '').trim();
        if (!name) return null;
        const status = normalizeInfraStatus(row.status);
        const type = String(row.type || row.role || '').trim();
        return {
          id: makeId('Rooms'),
          name,
          status,
          source: 'manual',
          site: String(row.site || '').trim(),
          location: String(row.location || '').trim(),
          role: type || 'Room',
          devices: numeric(row.devices),
          utilization: numeric(row.utilization),
          description: String(row.description || '').trim(),
          tags: String(row.tags || '').trim(),
          lastUpdated: new Date().toISOString(),
        } as InfraRecord;
      }).filter((row): row is InfraRecord => row !== null);
      if (!imported.length) {
        setImportMessage('No rooms found in CSV.');
        return;
      }
      onImportRooms(imported);
      setImportMessage(`${imported.length} room${imported.length === 1 ? '' : 's'} imported.`);
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : 'Unable to import rooms.');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const totals = enriched.reduce((sum, row) => ({
    rooms: sum.rooms + 1,
    locations: sum.locations.add(`${row.record.site || ''}|${row.record.location || row.record.name}`.toLowerCase()),
    server: sum.server + (row.type === 'Server Room' ? 1 : 0),
    network: sum.network + (row.type === 'Network Room' ? 1 : 0),
    idfMdf: sum.idfMdf + (row.type === 'IDF Room' || row.type === 'MDF Room' ? 1 : 0),
    other: sum.other + (row.type === 'Other' ? 1 : 0),
    online: sum.online + (row.statusLabel === 'Online' ? 1 : 0),
    critical: sum.critical + row.criticalAlerts,
  }), { rooms: 0, locations: new Set<string>(), server: 0, network: 0, idfMdf: 0, other: 0, online: 0, critical: 0 });
  const onlinePercent = totals.rooms ? Math.round((totals.online / totals.rooms) * 1000) / 10 : 0;
  const activeRoom = visible.find((row) => row.record.id === activeRoomId) || visible[0] || enriched[0] || null;
  const totalRackCount = enriched.reduce((sum, row) => sum + row.rackCount, 0);
  const totalDeviceCount = enriched.reduce((sum, row) => sum + row.deviceCount, 0);
  const averageUtilization = enriched.length ? Math.round(enriched.reduce((sum, row) => sum + row.utilization, 0) / enriched.length) : 0;
  const hottestSample = enriched
    .map((row) => row.temperature.value)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => b - a)[0] ?? null;
  const listKpis = [
    { icon: <DoorOpen size={18} />, tone: 'blue', label: 'Total rooms', value: totals.rooms, sub: `${totals.locations.size} location${totals.locations.size === 1 ? '' : 's'}` },
    { icon: <Activity size={18} />, tone: 'green', label: 'Online rooms', value: totals.online, sub: `${onlinePercent}% of total` },
    { icon: <Layers size={18} />, tone: 'purple', label: 'Capacity used', value: `${averageUtilization}%`, sub: `${totalRackCount} rack${totalRackCount === 1 ? '' : 's'} tracked` },
    { icon: <Database size={18} />, tone: 'blue', label: 'Devices installed', value: totalDeviceCount, sub: hottestSample === null ? 'No temp samples' : `Hottest ${hottestSample} C` },
    { icon: <Bell size={18} />, tone: totals.critical ? 'orange' : 'green', label: 'Room alerts', value: totals.critical, sub: `${enriched.filter((row) => row.criticalAlerts > 0).length} room${enriched.filter((row) => row.criticalAlerts > 0).length === 1 ? '' : 's'} affected` },
  ];

  return (
    <div className="rack-list-workspace rooms-rack-style">
      <input ref={importInputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => importRooms(event.target.files?.[0])} />
      {importMessage && <div className="module-notice rooms-import-notice"><CheckCircle2 size={17} />{importMessage}<button type="button" onClick={() => setImportMessage('')}><X size={15} /></button></div>}

      <div className="rack-list-kpis">
        {listKpis.map((kpi) => <RackListKpi key={kpi.label} {...kpi} />)}
      </div>

      <div className="rack-list-layout">
        <section className="card rack-list-table-card room-list-table-card">
          {selectedIds.length > 0 && (
            <div className="bulk-toolbar">
              <b>{selectedIds.length} selected</b>
              <button className="plain-button" disabled={!selectedRows.length} onClick={() => selectedRows[0] && onOpenRoom(selectedRows[0].record)}>Open first</button>
              <button className="plain-button" onClick={onExportSelected}>Export selected</button>
              <button className="plain-button danger-button" onClick={onDeleteSelected}>Delete selected</button>
              <button className="plain-button" onClick={() => onSelectIds([])}>Clear</button>
            </div>
          )}

          <div className="location-table-head room-list-head">
            <div>
              <h2>Rooms</h2>
              <p>{visible.length} of {records.length} room{records.length === 1 ? '' : 's'} shown</p>
            </div>
            <div className="location-table-tools room-list-tools">
              <button type="button" className="plain-button" onClick={() => importInputRef.current?.click()}><Download size={15} /> Import</button>
              <button type="button" className="plain-button" onClick={exportRooms}><Download size={15} /> Export</button>
              <button type="button" className="plain-button" aria-label="More room actions"><MoreHorizontal size={16} /></button>
              <button type="button" className="add" onClick={onCreateRoom}><Plus size={17} /> Add Room</button>
            </div>
          </div>

          <div className="rack-list-filters room-list-filters">
            <label>Location<select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="all">All Locations</option>{locationOptions.map((location) => <option key={location} value={location}>{location}</option>)}</select></label>
            <label>Room type<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All Types</option>{typeOptions.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All Statuses</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
            <label>Environment<select value={environmentFilter} onChange={(event) => setEnvironmentFilter(event.target.value)}><option value="all">All</option><option value="green">Normal</option><option value="orange">Warning</option><option value="red">Critical</option><option value="yellow">Unknown</option></select></label>
            <div className="rack-list-search"><Search size={15} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search by room name, location, site..." /></div>
            <button type="button" className="plain-button" disabled={!activeFilterCount} onClick={clearFilters}>Clear</button>
          </div>

          <div className="rack-list-table-wrap">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="Select all visible rooms" /></th>
                  <th>Room</th>
                  <th>Location</th>
                  <th>Site</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Racks</th>
                  <th>Devices</th>
                  <th>Utilization</th>
                  <th>Temperature</th>
                  <th>Power</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const selected = selectedIds.includes(row.record.id);
                  const active = activeRoom?.record.id === row.record.id;
                  return (
                    <tr
                      key={row.record.id}
                      className={`${selected ? 'selected' : ''}${active ? ' active' : ''}`}
                      onClick={() => {
                        setActiveRoomId(row.record.id);
                        onOpenRoom(row.record);
                      }}
                    >
                      <td><input type="checkbox" checked={selected} onClick={(event) => event.stopPropagation()} onChange={() => onToggleRecord(row.record.id)} aria-label={`Select ${row.record.name}`} /></td>
                      <td><button className="device-link infra-record-link" onClick={(event) => { event.stopPropagation(); onOpenRoom(row.record); }}>{row.record.name}</button><small>{row.record.description || row.description}</small></td>
                      <td>{row.locationLabel}</td>
                      <td>{row.record.site || '-'}</td>
                      <td><span className={`room-type-badge ${roomTypeClass(row.type)}`}>{row.type}</span></td>
                      <td><span className={`infra-status ${row.record.status.toLowerCase()}`}>{row.record.status}</span></td>
                      <td>{row.rackCount}</td>
                      <td>{row.deviceCount}</td>
                      <td><RackListMeter value={row.utilization} label={`${row.utilization}%`} /></td>
                      <td><RackListTemperature temperature={row.temperature} /></td>
                      <td><RackListPower power={row.power} /></td>
                      <td className="infra-row-actions">
                        <button className="row-action" onClick={(event) => { event.stopPropagation(); onOpenRoom(row.record); }}>Details</button>
                        <button className="row-action" onClick={(event) => { event.stopPropagation(); onEditRoom(row.record); }}>Edit</button>
                        <button className="row-action danger" onClick={(event) => { event.stopPropagation(); onDeleteRoom(row.record); }}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
                {!visible.length && <tr><td colSpan={12} className="empty">No rooms match the current filters.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="rack-list-footer">
            <span>Showing {visible.length ? 1 : 0} to {visible.length} of {records.length} rooms</span>
            <span>Rows per page: {visible.length || 0}</span>
          </div>
        </section>

        <RoomListSidePanel
          room={activeRoom}
          allRows={enriched}
          devices={devices}
          racks={racks}
          deviceTypes={deviceTypes}
          environments={environments}
          onOpenRoom={onOpenRoom}
          onOpenRack={(rack) => openInfrastructureDetail('Racks', rack)}
        />
      </div>
    </div>
  );
}

function RoomListSidePanel({
  room,
  devices,
  racks,
  deviceTypes,
  environments,
  onOpenRoom,
  onOpenRack,
}: {
  room: ReturnType<typeof roomRowMetrics> | null;
  allRows: ReturnType<typeof roomRowMetrics>[];
  devices: InventoryDevice[];
  racks: InfraRecord[];
  deviceTypes: DeviceTypeRecord[];
  environments: Record<number, RackDeviceEnvironment>;
  onOpenRoom: (room: InfraRecord) => void;
  onOpenRack: (rack: InfraRecord) => void;
}) {
  if (!room) return <aside className="rack-list-side card"><p className="empty">Select a room to inspect.</p></aside>;
  const record = room.record;
  const roomRacks = uniqueInfraRecords(racks.filter((rack) => roomRecordMatchesRack(record, rack)));
  const roomDevices = uniqueDevices([
    ...relatedDevicesFor('Rooms', record, devices),
    ...roomRacks.flatMap((rack) => relatedDevicesFor('Racks', rack, devices)),
  ]);
  const issues = rackDeviceIssues(roomDevices, environments, { ...record, region: record.name }, deviceTypes);
  const rackRows = roomRacks.map((rack) => {
    const rackDevices = relatedDevicesFor('Racks', rack, devices);
    const occupancy = rackOccupancyFor(rack, rackDevices, deviceTypes);
    return { rack, rackDevices, occupancy };
  }).sort((a, b) => a.rack.name.localeCompare(b.rack.name, undefined, { numeric: true, sensitivity: 'base' }));
  const units = rackRows.reduce((sum, row) => sum + row.occupancy.units, 0);
  const used = rackRows.reduce((sum, row) => sum + row.occupancy.usedUnits, 0);
  const activeDevices = roomDevices.filter((device) => rackDeviceIsActive(device)).length;

  return (
    <aside className="rack-list-side room-list-side">
      <section className="rack-list-side-head card">
        <span className={`infra-status ${record.status.toLowerCase()}`}>{record.status}</span>
        <button className="row-action" type="button" onClick={() => onOpenRoom(record)}>Details</button>
        <h2>{record.name}</h2>
        <p>{record.site || 'Unassigned site'} / {record.location || 'Unassigned location'}</p>
        <p>{room.type} / {room.floor === '-' ? 'No floor recorded' : `Floor ${room.floor}`}</p>
      </section>

      <section className="rack-list-side-section rack-list-alerts-section card">
        <div className="rack-panel-title"><Bell size={16} /> Alerts & Events <b>{issues.length}</b></div>
        {issues.length ? issues.slice(0, 4).map((issue, index) => (
          <p key={`${issue.device.id}-${issue.kind}-${index}`} className={`rack-alert-${issue.severity}`}>
            <span>{issue.severity}</span>{issue.device.name}: {issue.message}
          </p>
        )) : <p className="rack-list-mini-row"><span>Normal</span><b>No active room alarms</b></p>}
        {issues.length > 4 && <p className="rack-alert-warning"><span>Warning</span>{issues.length - 4} more issue{issues.length - 4 === 1 ? '' : 's'}</p>}
      </section>

      <section className="rack-list-side-section card">
        <div className="rack-panel-title"><DoorOpen size={16} /> Room Overview</div>
        <div className="rack-list-overview">
          <div>
            <p><span>Racks</span><b>{room.rackCount}</b></p>
            <p><span>Devices</span><b>{room.deviceCount}</b></p>
            <p><span>Used U</span><b>{used}U / {units}U</b></p>
            <p><span>Utilization</span><b>{room.utilization}%</b></p>
            <p><span>Power</span><b>{formatRackPowerValue(room.power, '-')}</b></p>
            <p><span>Temperature</span><b>{room.temperature.value === null ? '-' : `${room.temperature.value} C`}</b></p>
            <p><span>Online devices</span><b>{activeDevices} / {roomDevices.length}</b></p>
          </div>
          <span className="rack-list-graphic room-list-graphic" style={{ ['--rack-units' as string]: Math.max(8, Math.min(24, room.rackCount || 8)) }}>
            {Array.from({ length: Math.max(8, Math.min(24, room.rackCount || 8)) }, (_, index) => {
              const rackRow = rackRows[index];
              const tone = rackRow ? rackCapacityState(rackRow.occupancy.utilization).tone : '';
              return <i key={index} className={tone === 'red' ? 'security' : tone === 'orange' || tone === 'yellow' ? 'router' : rackRow ? 'switch' : ''} />;
            })}
          </span>
        </div>
      </section>

      <section className="rack-list-side-section card">
        <div className="rack-panel-title"><Warehouse size={16} /> Racks In Room</div>
        {rackRows.slice(0, 6).map((row) => (
          <button key={row.rack.id} type="button" className="rack-list-mini-row room-rack-mini-row" onClick={() => onOpenRack(row.rack)}>
            <span>{row.rack.name}</span>
            <b>{row.occupancy.usedUnits}U / {row.occupancy.units}U</b>
          </button>
        ))}
        {!rackRows.length && <p className="rack-list-mini-row"><span>No racks</span><b>-</b></p>}
      </section>

      <section className="rack-list-side-charts">
        <RackTrendCard icon={<Thermometer size={15} />} title="Room temperature" value={room.temperature.value === null ? 'No data' : `${room.temperature.value} C`} sub={room.temperature.label} points={room.temperature.points} />
        <RackTrendCard icon={<Zap size={15} />} title="Room power usage" value={formatRackPowerValue(room.power, 'No data')} sub={room.power.label} points={room.power.points} />
      </section>
    </aside>
  );
}

function RoomListKpi({ icon, label, value, sub, tone, progress }: { icon: ReactElement; label: string; value: number; sub: string; tone: 'blue' | 'green' | 'purple' | 'orange' | 'yellow' | 'red'; progress?: number }) {
  return (
    <section className={`rooms-kpi ${tone}`}>
      <span>{icon}</span>
      <p>{label}</p>
      <b>{value}</b>
      <small>{sub}</small>
      {typeof progress === 'number' && <i><em style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></i>}
    </section>
  );
}

function RoomFilterSelect({ label, value, onChange, options, allLabel, labels = {} }: { label: string; value: string; onChange: (value: string) => void; options: string[]; allLabel: string; labels?: Record<string, string> }) {
  return (
    <label className="room-filter-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{option === 'all' ? allLabel : labels[option] || option}</option>)}
      </select>
    </label>
  );
}

function RoomThumbnail({ type }: { type: string }) {
  return (
    <span className={`room-thumb ${roomTypeClass(type)}`}>
      <i />
      <em />
      <b />
    </span>
  );
}

function RoomEnvironmentCell({ temperature, power }: { temperature: RackTemperatureSummary; power: RackPowerSummary }) {
  return (
    <div className="room-env-cell">
      <span className={`temp ${temperature.tone}`}><Thermometer size={13} />{temperature.value === null ? '-' : `${temperature.value} C`}</span>
      <span className={`power ${power.tone}`}><Zap size={13} />{formatRackPowerValue(power, '-')}</span>
    </div>
  );
}

function RoomUtilization({ value }: { value: number }) {
  const tone = value >= 85 ? 'red' : value >= 65 ? 'orange' : 'green';
  return (
    <div className={`room-util ${tone}`}>
      <span>{value}%</span>
      <i><em style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>
    </div>
  );
}

function roomRowMetrics(record: InfraRecord, devices: InventoryDevice[], racks: InfraRecord[], deviceTypes: DeviceTypeRecord[], environments: Record<number, RackDeviceEnvironment>) {
  const roomContext = { ...record, region: record.name };
  const roomRacks = uniqueInfraRecords(racks.filter((rack) => roomRecordMatchesRack(record, rack)));
  const roomDevices = uniqueDevices([
    ...relatedDevicesFor('Rooms', record, devices),
    ...roomRacks.flatMap((rack) => relatedDevicesFor('Racks', rack, devices)),
  ]);
  const rackOccupancies = roomRacks.map((rack) => rackOccupancyFor(rack, relatedDevicesFor('Racks', rack, devices), deviceTypes));
  const units = rackOccupancies.reduce((sum, occupancy) => sum + occupancy.units, 0);
  const usedUnits = rackOccupancies.reduce((sum, occupancy) => sum + occupancy.usedUnits, 0);
  const utilization = units ? Math.round((usedUnits / units) * 100) : Math.min(100, numeric(record.utilization));
  const temperature = rackTemperatureSummary(roomDevices, environments, roomContext);
  const power = rackPowerSummary(roomDevices, deviceTypes, roomContext);
  const issues = rackDeviceIssues(roomDevices, environments, roomContext, deviceTypes);
  const criticalAlerts = issues.filter((issue) => issue.severity === 'critical').length;
  const statusLabel = record.status === 'Offline'
    ? 'Offline'
    : record.status === 'Maintenance'
      ? 'Maintenance'
      : criticalAlerts
        ? 'Maintenance'
        : 'Online';
  const type = roomTypeForRecord(record);
  const floor = roomFloorLabel(record);
  return {
    record,
    type,
    floor,
    locationLabel: record.location || record.site || 'Unassigned',
    description: type === 'IDF Room' ? 'Intermediate Distribution Frame' : type === 'MDF Room' ? 'Main Distribution Frame' : type,
    rackCount: roomRacks.length,
    deviceCount: roomDevices.length,
    utilization,
    temperature,
    power,
    criticalAlerts,
    statusLabel,
    environmentTone: criticalAlerts ? 'red' : temperature.tone === 'red' || power.tone === 'red' ? 'red' : temperature.tone === 'orange' || power.tone === 'orange' ? 'orange' : temperature.value === null && power.watts === null ? 'yellow' : 'green',
  };
}

function roomTypeForRecord(record: InfraRecord) {
  const text = [record.role, record.name, record.description, record.tags].join(' ').toLowerCase();
  if (/\b(server|compute|data center|dc)\b/.test(text)) return 'Server Room';
  if (/\bmdf|main distribution\b/.test(text)) return 'MDF Room';
  if (/\bidf|intermediate distribution\b/.test(text)) return 'IDF Room';
  if (/\b(network|wireless|telecom|switch|ops)\b/.test(text)) return 'Network Room';
  return 'Other';
}

function roomTypeClass(type: string) {
  return type.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'other';
}

function roomFloorLabel(record: InfraRecord) {
  const text = [record.tags, record.description, record.role].join(' ');
  const explicit = text.match(/\b(?:floor|fl|level)\s*[:#-]?\s*([A-Za-z0-9-]+)/i);
  if (explicit?.[1]) return explicit[1].toUpperCase();
  const roomNumber = String(record.name || '').match(/(?:^|[-_\s])([BGL]?\d{1,2})(?:[-_\s]|$)/i);
  if (roomNumber?.[1]) return roomNumber[1].toUpperCase();
  return '-';
}

function roomPercent(value: number, total: number) {
  return total ? Math.round((value / total) * 1000) / 10 : 0;
}

function normalizeInfraStatus(value: unknown): InfraStatus {
  const text = String(value || '').trim().toLowerCase();
  return statuses.find((status) => status.toLowerCase() === text) || 'Active';
}

function parseCsvObjects(text: string) {
  const rows = parseCsvRows(text).filter((row) => row.some((cell) => cell.trim()));
  const headers = (rows.shift() || []).map((header) => header.trim().toLowerCase());
  if (!headers.length) return [];
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])));
}

function parseCsvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  rows.push(row);
  return rows;
}

function LocationListWorkspace({
  records,
  devices,
  wirelessAps,
  query,
  selectedIds,
  onQueryChange,
  onToggleLocation,
  onSelectIds,
  onOpenLocation,
  onEditLocation,
  onDeleteLocation,
  onBulkEditSelected,
  onDeleteSelected,
  onExportSelected,
}: {
  records: InfraRecord[];
  devices: InventoryDevice[];
  wirelessAps: WirelessAp[];
  query: string;
  selectedIds: string[];
  onQueryChange: (value: string) => void;
  onToggleLocation: (id: string) => void;
  onSelectIds: (ids: string[]) => void;
  onOpenLocation: (location: InfraRecord) => void;
  onEditLocation: (location: InfraRecord) => void;
  onDeleteLocation: (location: InfraRecord) => void;
  onBulkEditSelected: () => void;
  onDeleteSelected: () => void;
  onExportSelected: () => void;
}) {
  const [siteFilter, setSiteFilter] = useState('all');
  const sites = uniqueRackValues(records.map((record) => record.site));
  const rows = records.filter((record) => {
    const haystack = [record.name, record.site, record.role, record.status, record.address, record.tags, record.description].join(' ').toLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLowerCase())) && (siteFilter === 'all' || record.site === siteFilter);
  }).sort((a, b) => resourceDisplayValue('Locations', a).localeCompare(resourceDisplayValue('Locations', b), undefined, { numeric: true, sensitivity: 'base' }));
  const enriched = rows.map((record) => locationRowMetrics(record, devices, wirelessAps));
  const totals = records.reduce((sum, record) => {
    const metrics = locationRowMetrics(record, devices, wirelessAps);
    return {
      buildings: sum.buildings + metrics.buildings,
      rooms: sum.rooms + metrics.rooms,
      racks: sum.racks + metrics.racks,
    };
  }, { buildings: 0, rooms: 0, racks: 0 });
  const active = records.filter((record) => record.status === 'Active').length;
  const rowIds = rows.map((record) => record.id);
  const selectedRows = rows.filter((record) => selectedIds.includes(record.id));
  const allRowsSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.includes(id));

  const toggleAllRows = () => {
    if (allRowsSelected) {
      const visibleSet = new Set(rowIds);
      onSelectIds(selectedIds.filter((id) => !visibleSet.has(id)));
      return;
    }
    onSelectIds([...new Set([...selectedIds, ...rowIds])]);
  };

  const exportLocations = () => {
    exportRowsCsv(
      'locations.csv',
      ['Location', 'Site', 'Type', 'Status', 'Rooms', 'Racks', 'Address', 'Last Updated'],
      enriched.map(({ record, buildings, rooms, racks }) => [
        record.name,
        record.site || '',
        record.role || '',
        record.status,
        rooms,
        racks,
        record.address || '',
        formatDate(record.lastUpdated),
      ]),
    );
  };

  return (
    <div className="location-list-workspace">
      <div className="location-list-kpis">
        <LocationKpi icon={<Network size={18} />} label="Total locations" value={records.length} sub="Across all sites" tone="blue" />
        <LocationKpi icon={<CheckCircle2 size={18} />} label="Active locations" value={active} sub={`${records.length ? Math.round((active / records.length) * 100) : 0}% of total`} tone="green" />
        <LocationKpi icon={<DoorOpen size={18} />} label="Total rooms" value={totals.rooms} sub="Across all locations" tone="orange" />
        <LocationKpi icon={<Server size={18} />} label="Total racks" value={totals.racks} sub="Across all rooms" tone="cyan" />
      </div>
      <section className="card location-table-card">
        {selectedIds.length > 0 && (
          <div className="bulk-toolbar location-bulk-toolbar">
            <b>{selectedIds.length} selected</b>
            <button className="plain-button" disabled={!selectedRows.length} onClick={() => selectedRows[0] && onOpenLocation(selectedRows[0])}>Open first</button>
            <button className="plain-button" onClick={onBulkEditSelected}>Edit selected</button>
            <button className="plain-button" onClick={onExportSelected}>Export selected</button>
            <button className="plain-button danger-button" onClick={onDeleteSelected}>Delete selected</button>
            <button className="plain-button" onClick={() => onSelectIds([])}>Clear</button>
          </div>
        )}
        <div className="location-table-head">
          <div>
            <h2>Locations & Buildings</h2>
            <p>{rows.length} of {records.length} location{records.length === 1 ? '' : 's'} shown</p>
          </div>
          <div className="location-table-tools">
            <select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>
              <option value="all">All Sites</option>
              {sites.map((site) => <option key={site} value={site}>{site}</option>)}
            </select>
            <div className="location-search"><Search size={15} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search locations, buildings..." /></div>
            <button type="button" className="plain-button" onClick={exportLocations}>Export</button>
          </div>
        </div>
        <div className="location-table-wrap">
          <table>
            <thead>
              <tr>
                <th className="location-select-col"><input type="checkbox" checked={allRowsSelected} onChange={toggleAllRows} aria-label="Select all visible locations" /></th>
                <th>Location / Building</th>
                <th>Site</th>
                <th>Type</th>
                <th>Status</th>
                <th>Rooms</th>
                <th>Racks</th>
                <th>Address</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map(({ record, rooms, racks }) => {
                const selected = selectedIds.includes(record.id);
                return (
                  <tr key={record.id} className={selected ? 'selected' : ''} onClick={() => onOpenLocation(record)}>
                    <td className="location-select-col">
                      <input
                        type="checkbox"
                        checked={selected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => onToggleLocation(record.id)}
                        aria-label={`Select ${record.name}`}
                      />
                    </td>
                    <td>
                      <button className="location-name-cell" type="button" onClick={(event) => { event.stopPropagation(); onOpenLocation(record); }}>
                        <LocationThumb record={record} />
                        <span><b>{record.name}</b><small>{record.description || record.tags || 'Location record'}</small></span>
                      </button>
                    </td>
                    <td>{record.site || '-'}</td>
                    <td><span className={`location-type ${locationTypeClass(record.role)}`}>{record.role || 'Location'}</span></td>
                    <td><span className={`infra-status ${record.status.toLowerCase()}`}>{record.status}</span></td>
                    <td>{rooms}</td>
                    <td>{racks}</td>
                    <td><span className="location-address">{record.address || '-'}</span></td>
                    <td>{formatDate(record.lastUpdated)}</td>
                    <td className="infra-row-actions">
                      <button className="row-action" onClick={(event) => { event.stopPropagation(); onOpenLocation(record); }}>Details</button>
                      <button className="row-action" onClick={(event) => { event.stopPropagation(); onEditLocation(record); }}>Edit</button>
                      <button className="row-action danger" onClick={(event) => { event.stopPropagation(); onDeleteLocation(record); }}>Delete</button>
                    </td>
                  </tr>
                );
              })}
              {!enriched.length && <tr><td colSpan={10} className="empty">No locations match the current filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="location-table-footer">Showing {enriched.length ? 1 : 0} to {enriched.length} of {records.length} locations</div>
      </section>
    </div>
  );
}

function LocationKpi({ icon, label, value, sub, tone }: { icon: ReactElement; label: string; value: number; sub: string; tone: string }) {
  return (
    <section className={`location-kpi ${tone}`}>
      <span>{icon}</span>
      <p>{label}</p>
      <b>{value}</b>
      <small>{sub}</small>
    </section>
  );
}

function LocationThumb({ record }: { record: InfraRecord }) {
  if (record.image) return <img className="location-thumb" src={record.image} alt={record.name} />;
  const initials = record.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'L';
  return <span className="location-thumb placeholder">{initials}</span>;
}

function locationRowMetrics(record: InfraRecord, devices: InventoryDevice[], wirelessAps: WirelessAp[]) {
  const matchedDevices = relatedDevicesFor('Locations', record, devices);
  const matchedWireless = relatedWirelessFor('Locations', record, wirelessAps);
  const related = buildLocationRelatedData(record, matchedDevices, matchedWireless);
  const role = String(record.role || '').toLowerCase();
  const buildings = numeric(record.buildings) || (role.includes('building') || role.includes('campus') || role.includes('data center') || role.includes('facility') ? 1 : 0);
  const rooms = numeric(record.rooms) || Math.max(0, related.racks.length || new Set(matchedDevices.map((device) => String(device.rack || '').trim()).filter(Boolean)).size);
  return {
    record,
    buildings,
    rooms,
    racks: related.racks.length,
  };
}

function locationTypeClass(value?: string) {
  const text = String(value || '').toLowerCase();
  if (text.includes('data')) return 'data-center';
  if (text.includes('campus')) return 'campus';
  if (text.includes('research')) return 'research';
  if (text.includes('building') || text.includes('academic')) return 'academic';
  if (text.includes('facility')) return 'facility';
  return 'generic';
}

function siteRecordsFor(resource: InfrastructureResourceName, site: InfraRecord, placementRecords: Record<InfrastructureResourceName, InfraRecord[]>, devices: InventoryDevice[], aps: WirelessAp[]) {
  const derived = resource === 'Sites' || resource === 'Locations'
    ? [...deriveRecords(resource, devices), ...deriveWirelessRecords(resource, aps)]
    : resource === 'Rooms'
      ? deriveRoomRecords(mergeManualAndDerived('Locations', placementRecords.Locations || loadRecords('Locations'), [
        ...deriveRecords('Locations', devices),
        ...deriveWirelessRecords('Locations', aps),
      ]), devices)
      : deriveRecords(resource, devices);
  const manual = placementRecords[resource] || loadRecords(resource);
  return mergeManualAndDerived(resource, manual, derived).filter((record) => {
    if (resource === 'Locations') return sameText(record.site, site.name);
    if (resource === 'Rooms') return sameText(record.site, site.name);
    if (resource === 'Racks') return sameText(record.site, site.name);
    if (resource === 'VLANs' || resource === 'Prefixes' || resource === 'VRFs') return sameText(record.site, site.name);
    if (resource === 'IP Addresses') return sameText(record.site, site.name) || relatedDevicesFor(resource, record, devices).some((device) => sameText(siteOf(device), site.name));
    return false;
  });
}

function SiteDetailOverview({
  site,
  devices,
  aps,
  placementRecords,
  allDevices,
  wirelessAps,
  deviceTypes,
}: {
  site: InfraRecord;
  devices: InventoryDevice[];
  aps: WirelessAp[];
  placementRecords: Record<InfrastructureResourceName, InfraRecord[]>;
  allDevices: InventoryDevice[];
  wirelessAps: WirelessAp[];
  deviceTypes: DeviceTypeRecord[];
}) {
  const locations = siteRecordsFor('Locations', site, placementRecords, allDevices, wirelessAps);
  const rooms = siteRecordsFor('Rooms', site, placementRecords, allDevices, wirelessAps);
  const racks = siteRecordsFor('Racks', site, placementRecords, allDevices, wirelessAps);
  const vlans = siteRecordsFor('VLANs', site, placementRecords, allDevices, wirelessAps);
  const prefixes = siteRecordsFor('Prefixes', site, placementRecords, allDevices, wirelessAps);
  const ips = siteRecordsFor('IP Addresses', site, placementRecords, allDevices, wirelessAps);
  const activeDevices = devices.filter((device) => rackDeviceIsActive(device)).length;
  const offlineDevices = devices.length - activeDevices;
  const rackDevices = uniqueDevices(racks.flatMap((rack) => relatedDevicesFor('Racks', rack, allDevices)));
  const power = rackPowerSummary(rackDevices.length ? rackDevices : devices, deviceTypes);
  const totalUnits = racks.reduce((sum, rack) => sum + (numeric(rack.units) || 42), 0);
  const usedUnits = racks.reduce((sum, rack) => sum + rackOccupancyFor(rack, relatedDevicesFor('Racks', rack, allDevices), deviceTypes).usedUnits, 0);
  const utilization = totalUnits ? Math.round((usedUnits / totalUnits) * 100) : capacityFor('Sites', site);
  const health = devices.length ? Math.round((activeDevices / devices.length) * 100) : 100;
  const sortedLocations = [...locations].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const sortedRacks = [...racks].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  return (
    <div className="site-detail-workspace">
      <section className="card site-hero-panel">
        <div className="site-hero-mark"><Building2 size={34} /></div>
        <div>
          <span>Site</span>
          <h2>{site.name}</h2>
          <p>{site.description || 'Campus, branch, data center, and network operations domain.'}</p>
          <div className="site-hero-tags">
            <span>{site.status}</span>
            <span>{site.role || 'Operational domain'}</span>
            <span>{site.region || site.location || 'No region recorded'}</span>
          </div>
        </div>
      </section>

      <div className="site-kpi-grid">
        <SiteKpi icon={<Server size={18} />} label="Devices" value={devices.length} sub={`${activeDevices} active / ${offlineDevices} inactive`} tone={offlineDevices ? 'orange' : 'green'} />
        <SiteKpi icon={<RadioTowerIcon />} label="Wireless APs" value={aps.length} sub="Controller snapshots" tone="cyan" />
        <SiteKpi icon={<MapPin size={18} />} label="Locations" value={locations.length} sub={`${rooms.length} room${rooms.length === 1 ? '' : 's'}`} tone="blue" />
        <SiteKpi icon={<Warehouse size={18} />} label="Racks" value={racks.length} sub={`${usedUnits}U used of ${totalUnits || 0}U`} tone="purple" />
        <SiteKpi icon={<Network size={18} />} label="Networks" value={vlans.length + prefixes.length} sub={`${vlans.length} VLANs / ${prefixes.length} prefixes`} tone="yellow" />
        <SiteKpi icon={<ShieldCheck size={18} />} label="Health" value={`${health}%`} sub="Inventory availability" tone={health < 90 ? 'orange' : 'green'} />
      </div>

      <div className="site-main-grid">
        <section className="card site-map-card">
          <div className="rack-panel-title"><MapPin size={16} /> Site Layout <small>{sortedLocations.length} location{sortedLocations.length === 1 ? '' : 's'}</small></div>
          <div className="site-layout-canvas">
            {sortedLocations.map((location, index) => {
              const locationRooms = rooms.filter((room) => sameText(room.location, location.name));
              const locationRacks = racks.filter((rack) => sameText(rack.location, location.name));
              const locationDevices = devices.filter((device) => sameText(device.location, location.name));
              return (
                <button
                  type="button"
                  key={recordMergeKey('Locations', location)}
                  className={`site-location-node node-${index % 6}`}
                  onClick={() => openInfrastructureDetail('Locations', location)}
                >
                  <Building2 size={22} />
                  <b>{location.name}</b>
                  <span>{locationRooms.length} rooms / {locationRacks.length} racks / {locationDevices.length} devices</span>
                </button>
              );
            })}
            {!sortedLocations.length && <div className="site-empty-layout"><MapPin size={34} /><b>No locations yet</b><span>Create a location and assign it to this site.</span></div>}
          </div>
        </section>

        <aside className="site-side-stack">
          <section className="card site-overview-card">
            <div className="rack-panel-title"><Database size={16} /> Site Overview</div>
            <p><span>Name</span><b>{site.name}</b></p>
            <p><span>Role</span><b>{site.role || '-'}</b></p>
            <p><span>Region</span><b>{site.region || site.location || '-'}</b></p>
            <p><span>Tenant</span><b>{site.tenant || '-'}</b></p>
            <p><span>Tags</span><b>{site.tags || '-'}</b></p>
            <p><span>Power Load</span><b>{formatRackPowerValue(power, '-')}</b></p>
          </section>

          <section className="card site-ops-card">
            <div className="rack-panel-title"><Activity size={16} /> Operations</div>
            <div className="site-ops-meter">
              <span>Rack utilization</span>
              <b>{utilization}%</b>
              <i><em style={{ width: `${Math.min(100, utilization)}%` }} /></i>
            </div>
            <div className="site-ops-meter">
              <span>Availability</span>
              <b>{health}%</b>
              <i><em style={{ width: `${Math.min(100, health)}%` }} /></i>
            </div>
            <p><span>IP addresses</span><b>{ips.length}</b></p>
            <p><span>Last updated</span><b>{formatDate(site.lastUpdated)}</b></p>
          </section>
        </aside>
      </div>

      <div className="site-bottom-grid">
        <section className="card site-table-card">
          <div className="rack-panel-title"><MapPin size={16} /> Locations & Rooms</div>
          <div className="rack-assets-table">
            <table>
              <thead><tr><th>Location</th><th>Role</th><th>Rooms</th><th>Racks</th><th>Devices</th><th>Status</th></tr></thead>
              <tbody>
                {sortedLocations.map((location) => {
                  const locationRooms = rooms.filter((room) => sameText(room.location, location.name));
                  const locationRacks = racks.filter((rack) => sameText(rack.location, location.name));
                  const locationDevices = devices.filter((device) => sameText(device.location, location.name));
                  return (
                    <tr key={recordMergeKey('Locations', location)}>
                      <td><button type="button" onClick={() => openInfrastructureDetail('Locations', location)}>{location.name}</button></td>
                      <td>{location.role || '-'}</td>
                      <td>{locationRooms.length}</td>
                      <td>{locationRacks.length}</td>
                      <td>{locationDevices.length}</td>
                      <td><span className={`infra-status ${location.status.toLowerCase()}`}>{location.status}</span></td>
                    </tr>
                  );
                })}
                {!sortedLocations.length && <tr><td colSpan={6} className="empty">No locations assigned to this site.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card site-table-card">
          <div className="rack-panel-title"><Warehouse size={16} /> Racks</div>
          <div className="site-rack-strip">
            {sortedRacks.slice(0, 8).map((rack) => {
              const rackDevices = relatedDevicesFor('Racks', rack, allDevices);
              return <RackMiniElevation key={recordMergeKey('Racks', rack)} rack={rack} devices={rackDevices} deviceTypes={deviceTypes} onOpen={() => openInfrastructureDetail('Racks', rack)} />;
            })}
            {!sortedRacks.length && <div className="site-empty-layout compact"><Warehouse size={28} /><b>No racks yet</b></div>}
          </div>
        </section>
      </div>

      <section className="card site-table-card">
        <div className="rack-panel-title"><Network size={16} /> Network Scope</div>
        <div className="site-network-scope">
          <span><b>{vlans.length}</b><small>VLANs</small></span>
          <span><b>{prefixes.length}</b><small>Prefixes</small></span>
          <span><b>{ips.length}</b><small>IP addresses</small></span>
          <span><b>{aps.length}</b><small>Wireless APs</small></span>
        </div>
      </section>
    </div>
  );
}

function RadioTowerIcon() {
  return <Wifi size={18} />;
}

function SiteKpi({ icon, label, value, sub, tone }: { icon: ReactElement; label: string; value: string | number; sub: string; tone: string }) {
  return (
    <section className={`site-kpi ${tone}`}>
      <span>{icon}</span>
      <p>{label}</p>
      <b>{value}</b>
      <small>{sub}</small>
    </section>
  );
}

function roomRecordMatchesRack(room: InfraRecord, rack: InfraRecord) {
  const rackRoom = String(rack.region || rack.room || '').trim() || DEFAULT_ROOM_NAME;
  return sameText(rackRoom, room.name)
    && (!room.location || sameText(rack.location, room.location))
    && (!room.site || !rack.site || sameText(rack.site, room.site));
}

function roomRackVisualClass(value?: string) {
  const text = String(value || '').toLowerCase();
  if (text.includes('server')) return 'server';
  if (text.includes('storage')) return 'storage';
  if (text.includes('patch')) return 'patch';
  if (text.includes('firewall') || text.includes('security')) return 'security';
  if (text.includes('pdu') || text.includes('power')) return 'pdu';
  if (text.includes('core')) return 'core';
  return 'network';
}

const ROOM_COMPONENTS_KEY = 'aims-room-components';

type RoomComponent = {
  id: string;
  roomKey: string;
  category: string;
  type: string;
  name: string;
  role?: string;
  status: InfraStatus | 'Normal' | 'Warning' | 'Critical' | 'Offline' | 'Unknown';
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  assetTag?: string;
  description?: string;
  site?: string;
  location?: string;
  room?: string;
  zone?: string;
  rack?: string;
  rackPosition?: string;
  side?: string;
  parentComponent?: string;
  x: number;
  y: number;
  orientation?: string;
  dataSourceType?: string;
  dataSourceDetail?: string;
  monitoringEnabled?: boolean;
  ipAddress?: string;
  hostname?: string;
  protocol?: string;
  pollingInterval?: string;
  xmlEndpoint?: string;
  xmlValuePath?: string;
  xmlStatusPath?: string;
  lastUpdate?: string;
  currentValue?: string;
  unit?: string;
  notes?: string;
  assignedResource?: InfrastructureResourceName | 'Device';
  assignedRecordId?: string;
  assignedRecordName?: string;
  specs: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

type ComponentAssignTarget = {
  resource: InfrastructureResourceName;
  record: InfraRecord;
};

const roomComponentCatalog: Record<string, string[]> = {
  'Environmental Monitoring': ['Temperature sensor', 'Humidity sensor', 'Smoke detector', 'Water-leak sensor', 'Airflow sensor', 'Dust / air-quality sensor', 'Room pressure sensor', 'Noise sensor'],
  'Power Infrastructure': ['UPS', 'PDU', 'Intelligent PDU', 'Power meter', 'Circuit breaker', 'Distribution panel', 'Automatic Transfer Switch', 'Generator', 'Battery bank', 'Power feed', 'Surge protector'],
  'Cooling Infrastructure': ['CRAC unit', 'In-row cooling unit', 'Split air conditioner', 'Precision cooling unit', 'Cooling fan', 'Exhaust fan', 'Chiller connection', 'Cooling sensor'],
  'Security and Access': ['CCTV camera', 'Access-control reader', 'Door sensor', 'Motion detector', 'Biometric reader', 'Electronic lock', 'Alarm system'],
  'Safety Equipment': ['Fire extinguisher', 'Fire-suppression system', 'Emergency light', 'Smoke alarm', 'Gas detector', 'Emergency shutdown switch'],
  'Room Infrastructure': ['Rack', 'Cabinet', 'Raised-floor panel', 'Cable tray', 'Patch panel', 'Fiber enclosure', 'Grounding bar', 'Wall-mounted enclosure', 'Workbench', 'Custom component'],
};

const roomComponentTypeFields: Record<string, string[]> = {
  UPS: ['Rated power', 'Rated apparent power', 'Input voltage', 'Output voltage', 'Current load', 'Load percentage', 'Battery charge', 'Estimated runtime', 'Bypass status'],
  PDU: ['PDU type', 'Rated voltage', 'Maximum current', 'Maximum power', 'Current load', 'Load percentage', 'Number of outlets', 'Power feed', 'Breaker rating'],
  'Intelligent PDU': ['PDU type', 'Rated voltage', 'Maximum current', 'Maximum power', 'Current load', 'Load percentage', 'Number of outlets', 'Power feed', 'Breaker rating'],
  'Temperature sensor': ['Current temperature', 'Unit of measurement', 'Minimum acceptable value', 'Warning threshold', 'Critical threshold', 'Recovery threshold', 'Polling interval', 'Sensor accuracy'],
  'Humidity sensor': ['Current humidity', 'Unit of measurement', 'Minimum acceptable value', 'Warning threshold', 'Critical threshold', 'Recovery threshold', 'Polling interval', 'Sensor accuracy'],
  'CRAC unit': ['Cooling capacity', 'Supply temperature', 'Return temperature', 'Fan status', 'Compressor status', 'Operating mode', 'Setpoint', 'Current power consumption', 'Airflow rate', 'Filter status'],
  'CCTV camera': ['IP address', 'Camera type', 'Resolution', 'Recording status', 'Field of view', 'Retention period', 'Connectivity status', 'Last heartbeat'],
  'Circuit breaker': ['Rated current', 'Rated voltage', 'Number of poles', 'Breaker status', 'Protected circuit', 'Connected PDU', 'Trip status', 'Last test date'],
};

function roomKey(room: InfraRecord) {
  return [room.site, room.location, room.name].map((part) => String(part || '').trim().toLowerCase()).join('|');
}

function loadAllRoomComponents(): RoomComponent[] {
  try {
    const rows = JSON.parse(localStorage.getItem(ROOM_COMPONENTS_KEY) || '[]');
    return sanitizeRoomComponents(rows);
  } catch {
    return [];
  }
}

function saveAllRoomComponents(rows: RoomComponent[]) {
  localStorage.setItem(ROOM_COMPONENTS_KEY, JSON.stringify(sanitizeRoomComponents(rows)));
  window.dispatchEvent(new CustomEvent('aims:room-components-changed'));
}

function loadRoomComponents(room: InfraRecord) {
  const key = roomKey(room);
  return loadAllRoomComponents().filter((component) => component.roomKey === key);
}

function saveRoomComponents(room: InfraRecord, rows: RoomComponent[]) {
  const key = roomKey(room);
  const other = loadAllRoomComponents().filter((component) => component.roomKey !== key);
  const next = sanitizeRoomComponents([...other, ...rows]);
  saveAllRoomComponents(next);
  return next;
}

function sanitizeRoomComponents(value: unknown): RoomComponent[] {
  return Array.isArray(value)
    ? value.filter((row): row is RoomComponent => Boolean(row && typeof row === 'object' && typeof (row as RoomComponent).id === 'string'))
    : [];
}

async function loadBackendRoomComponents(): Promise<{ configured: boolean; records: RoomComponent[]; unavailable: boolean }> {
  const auth = await ensureApiToken();
  const response = await fetch(`${api}/infrastructure/Components`, { headers: { Authorization: `Bearer ${auth}` } });
  const json = await response.json();
  if (response.status === 404) return { configured: false, records: [], unavailable: true };
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load room components from backend.');
  return {
    configured: Boolean(json.data?.configured),
    records: sanitizeRoomComponents(json.data?.records),
    unavailable: false,
  };
}

async function saveBackendRoomComponents(rows: RoomComponent[]) {
  const auth = await ensureApiToken();
  const records = sanitizeRoomComponents(rows).map((component) => ({
    ...component,
    _merge_key: `component:${component.roomKey || ''}:${component.id || component.name || ''}`.toLowerCase(),
  }));
  const response = await fetch(`${api}/infrastructure/Components`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  const json = await response.json();
  if (response.status === 404) return 'unavailable';
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to save room components to backend.');
  return 'saved';
}

function roomComponentTone(component: RoomComponent) {
  const metric = roomComponentMetric(component);
  const value = roomComponentNumericValue(component, metric);
  if (metric !== null && value !== null) {
    const configuredTone = environmentThresholdTone(metric, value, thresholdContextForComponent(component));
    if (configuredTone === 'danger') return 'red';
    if (configuredTone === 'warning') return 'yellow';
    if (configuredTone === 'normal') return 'green';
  }
  const status = String(component.status || '').toLowerCase();
  if (status.includes('critical')) return 'red';
  if (status.includes('warning')) return 'yellow';
  if (status.includes('offline') || status.includes('unknown')) return 'gray';
  if (status.includes('maintenance')) return 'purple';
  if (status.includes('active') || status.includes('normal')) return 'green';
  return 'blue';
}

function roomComponentMetric(component: RoomComponent): EnvironmentMetric | null {
  const configured = String(component.specs?.thresholdMetric || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const allowed: EnvironmentMetric[] = ['temperature', 'power', 'humidity', 'airflow', 'voltage', 'current', 'frequency', 'battery', 'runtime', 'capacity', 'utilization', 'pressure', 'noise', 'water', 'smoke'];
  if (allowed.includes(configured as EnvironmentMetric)) return configured as EnvironmentMetric;
  const text = `${component.category || ''} ${component.type || ''} ${component.name || ''} ${component.unit || ''}`.toLowerCase();
  if (/(temp|°c|\bc\b|celsius)/.test(text)) return 'temperature';
  if (/(humidity|humid|\brh\b)/.test(text)) return 'humidity';
  if (/(power|pdu|ups|watt|\bkw\b|\bw\b|load)/.test(text)) return 'power';
  if (/(volt|\bv\b)/.test(text)) return 'voltage';
  if (/(current|amp|\ba\b)/.test(text)) return 'current';
  if (/(frequency|hz)/.test(text)) return 'frequency';
  if (/(battery|charge)/.test(text)) return 'battery';
  if (/(runtime|run time)/.test(text)) return 'runtime';
  if (/(capacity|free|used)/.test(text)) return 'capacity';
  if (/(utilization|utilisation|usage|percent|%)/.test(text)) return 'utilization';
  if (/(airflow|cfm|fan)/.test(text)) return 'airflow';
  if (/(pressure|pascal|\bpa\b)/.test(text)) return 'pressure';
  if (/(noise|sound|db)/.test(text)) return 'noise';
  if (/(water|leak|flood)/.test(text)) return 'water';
  if (/(smoke|gas|air quality)/.test(text)) return 'smoke';
  return null;
}

function roomComponentNumericValue(component: RoomComponent, metric: EnvironmentMetric | null): number | null {
  if (!metric) return null;
  const raw = String(component.currentValue || component.specs?.currentValue || '').trim();
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  let value = Number(match[0]);
  if (!Number.isFinite(value)) return null;
  const unit = String(component.unit || raw).toLowerCase();
  if (metric === 'power' && /\bkw\b/.test(unit)) value *= 1000;
  if (metric === 'power' && /\bmw\b/.test(unit)) value *= 1000000;
  return value;
}

function thresholdContextForComponent(component: RoomComponent): EnvironmentThresholdContext {
  return {
    site: component.site || null,
    location: component.location || null,
    room: component.room || null,
    rack: component.rack || null,
    componentId: component.id,
    componentName: component.name,
    componentType: component.type,
    componentCategory: component.category,
    deviceId: component.assignedResource === 'Device' ? component.assignedRecordId : null,
    deviceName: component.assignedResource === 'Device' ? component.assignedRecordName : null,
  };
}

function roomComponentIcon(component: Pick<RoomComponent, 'category' | 'type'>) {
  const text = `${component.category} ${component.type}`.toLowerCase();
  if (text.includes('temperature')) return <Thermometer size={15} />;
  if (text.includes('humidity') || text.includes('water')) return <Droplets size={15} />;
  if (text.includes('smoke') || text.includes('fire') || text.includes('gas')) return <Bell size={15} />;
  if (text.includes('ups') || text.includes('pdu') || text.includes('power') || text.includes('breaker')) return <Zap size={15} />;
  if (text.includes('cool') || text.includes('crac') || text.includes('fan')) return <Snowflake size={15} />;
  if (text.includes('camera') || text.includes('cctv')) return <Cctv size={15} />;
  if (text.includes('door') || text.includes('lock') || text.includes('access')) return <LockKeyhole size={15} />;
  if (text.includes('rack') || text.includes('cabinet')) return <Server size={15} />;
  return <Box size={15} />;
}

function roomComponentVisualClass(component: Pick<RoomComponent, 'category' | 'type' | 'name'>) {
  const text = `${component.category || ''} ${component.type || ''} ${component.name || ''}`.toLowerCase();
  if (text.includes('camera') || text.includes('cctv')) return 'visual-camera';
  if (text.includes('door') || text.includes('lock') || text.includes('access') || text.includes('reader')) return 'visual-access';
  if (text.includes('ups') || text.includes('battery')) return 'visual-ups';
  if (text.includes('pdu')) return 'visual-pdu';
  if (text.includes('crac') || text.includes('cool') || text.includes('fan') || text.includes('air conditioner')) return 'visual-cooling';
  if (text.includes('temperature') || text.includes('humidity') || text.includes('smoke') || text.includes('water') || text.includes('airflow') || text.includes('sensor')) return 'visual-sensor';
  if (text.includes('fire') || text.includes('gas') || text.includes('suppression') || text.includes('emergency')) return 'visual-safety';
  if (text.includes('rack') || text.includes('cabinet') || text.includes('patch') || text.includes('fiber')) return 'visual-infra';
  if (text.includes('power') || text.includes('breaker') || text.includes('meter') || text.includes('generator') || text.includes('ats')) return 'visual-power';
  return 'visual-generic';
}

function roomComponentMonitoringDetail(component: RoomComponent) {
  if (!component.monitoringEnabled) return 'Manual entry. Values are stored from the form until monitoring is enabled.';
  if (String(component.dataSourceType || '').toLowerCase() === 'xml') {
    const endpoint = component.xmlEndpoint || component.ipAddress || component.hostname || 'configured XML endpoint';
    const valuePath = component.xmlValuePath || 'configured XML value path';
    const statusPath = component.xmlStatusPath || 'optional XML status path';
    return `XML polling fetches ${endpoint}, parses ${valuePath} for the measured value, reads ${statusPath}, then updates value/status for thresholds and alerts.`;
  }
  return `${component.dataSourceType || 'Monitoring'} polling uses the configured host/protocol and interval, then stores the latest value and status on this component record.`;
}

function roomComponentValueLabel(component: Pick<RoomComponent, 'currentValue' | 'unit' | 'status' | 'monitoringEnabled'>) {
  const value = String(component.currentValue || '').trim();
  if (value) return `${value}${component.unit ? ` ${component.unit}` : ''}`;
  return component.monitoringEnabled ? 'No value yet' : component.status || 'Not recorded';
}

function roomComponentDefaultPosition(type: string, index: number) {
  const text = type.toLowerCase();
  if (text.includes('camera') || text.includes('cctv')) return { x: 88, y: 12 };
  if (text.includes('temperature')) return { x: 18, y: 17 };
  if (text.includes('humidity')) return { x: 38, y: 17 };
  if (text.includes('smoke')) return { x: 70, y: 17 };
  if (text.includes('door') || text.includes('access')) return { x: 6, y: 58 };
  if (text.includes('ups')) return { x: 16, y: 45 };
  if (text.includes('crac') || text.includes('cool')) return { x: 16, y: 68 };
  if (text.includes('pdu')) return { x: 88, y: 55 + (index % 2) * 16 };
  return { x: Math.min(82, 28 + (index % 6) * 9), y: 36 + Math.floor(index / 6) * 12 };
}

function assignRoomComponentToTarget(component: RoomComponent, target: ComponentAssignTarget, index = 0): RoomComponent {
  const record = target.record;
  const now = new Date().toISOString();
  const position = roomComponentDefaultPosition(component.type || component.name || 'Component', index);
  const next: RoomComponent = {
    ...component,
    assignedResource: target.resource,
    assignedRecordId: record.id,
    assignedRecordName: resourceDisplayValue(target.resource, record),
    updatedAt: now,
    x: Number.isFinite(Number(component.x)) ? component.x : position.x,
    y: Number.isFinite(Number(component.y)) ? component.y : position.y,
  };
  if (target.resource === 'Sites') {
    next.site = record.name;
    next.location = '';
    next.room = '';
    next.rack = '';
    next.roomKey = '';
  } else if (target.resource === 'Locations') {
    next.site = record.site || '';
    next.location = record.name;
    next.room = '';
    next.rack = '';
    next.roomKey = '';
  } else if (target.resource === 'Rooms') {
    next.site = record.site || '';
    next.location = record.location || '';
    next.room = record.name || DEFAULT_ROOM_NAME;
    next.rack = '';
    next.roomKey = roomKey(record);
  } else if (target.resource === 'Racks') {
    const rackRoom = String(record.region || record.room || '').trim() || DEFAULT_ROOM_NAME;
    next.site = record.site || '';
    next.location = record.location || '';
    next.room = rackRoom;
    next.rack = record.name;
    next.roomKey = [next.site, next.location, rackRoom].map((part) => String(part || '').trim().toLowerCase()).join('|');
  }
  return next;
}

function ComponentAssignmentDialog({ target, onCancel, onAssigned }: { target: ComponentAssignTarget; onCancel: () => void; onAssigned: () => void }) {
  const [components, setComponents] = useState<RoomComponent[]>(() => loadAllRoomComponents());
  const [query, setQuery] = useState('');
  const [componentId, setComponentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadBackendRoomComponents()
      .then((result) => {
        if (cancelled || result.unavailable) return;
        saveAllRoomComponents(result.records);
        setComponents(result.records);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = components.filter((component) => [component.name, component.type, component.category, component.site, component.location, component.room, component.rack].filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase()));
  const targetLabel = `${target.resource} / ${resourceDisplayValue(target.resource, target.record)}`;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = components.find((component) => component.id === componentId);
    if (!selected) {
      setError('Select a component to assign.');
      return;
    }
    const assigned = assignRoomComponentToTarget(selected, target, components.length);
    const next = components.map((component) => component.id === selected.id ? assigned : component);
    setBusy(true);
    setError('');
    saveAllRoomComponents(next);
    saveBackendRoomComponents(next)
      .then(() => onAssigned())
      .catch((saveError) => {
        setBusy(false);
        setError(saveError instanceof Error ? saveError.message : 'Unable to save component assignment to database.');
      });
  };

  return createPortal(
    <div className="room-component-modal" role="dialog" aria-modal="true">
      <form className="room-component-form component-assign-form" onSubmit={submit}>
        <div className="room-component-form-head">
          <div>
            <span>Assign Component</span>
            <h2>Add Existing Component</h2>
            <p>{targetLabel}</p>
          </div>
          <button type="button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="room-component-step">
          <b>Choose component</b>
          <div className="room-component-form-grid">
            <label className="full">Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, type, category, or current placement" /></label>
          </div>
          <div className="component-assign-list">
            {visible.map((component) => (
              <label key={component.id} className={componentId === component.id ? 'selected' : ''}>
                <input type="radio" name="componentId" value={component.id} checked={componentId === component.id} onChange={() => setComponentId(component.id)} />
                <span>{roomComponentIcon(component)}</span>
                <b>{component.name}<small>{component.type} / {component.category}</small></b>
                <em>{[component.site, component.location, component.room, component.rack].filter(Boolean).join(' / ') || 'Unassigned'}</em>
              </label>
            ))}
            {!visible.length && <p className="empty">No components found. Create components from the Components page first.</p>}
          </div>
          <p className="room-component-help">This assigns the selected component to {targetLabel} and saves the placement in the backend database.</p>
          {error && <p className="error-text">{error}</p>}
        </div>
        <div className="room-component-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={busy || !componentId}>{busy ? 'Saving...' : 'Assign Component'}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function RoomDetailOverview({
  room,
  racks,
  allDevices,
  environments,
  deviceTypes,
  onBack,
  onEdit,
  onDelete,
  onAddComponent,
  onAddRack,
  onOpenRack,
}: {
  room: InfraRecord;
  racks: InfraRecord[];
  allDevices: InventoryDevice[];
  environments: Record<number, RackDeviceEnvironment>;
  deviceTypes: DeviceTypeRecord[];
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddComponent: () => void;
  onAddRack: () => void;
  onOpenRack: (rack: InfraRecord) => void;
}) {
  const roomContext = { ...room, location: room.location, region: room.name, rack: undefined };
  const directRoomDevices = relatedDevicesFor('Rooms', room, allDevices);
  const rackRows = racks.map((rack) => {
    const rackDevices = relatedDevicesFor('Racks', rack, allDevices);
    const occupancy = rackOccupancyFor(rack, rackDevices, deviceTypes);
    const rackPower = rackPowerSummary(rackDevices, deviceTypes, rack);
    const rackTemp = rackTemperatureSummary(rackDevices, environments, rack);
    return { rack, devices: rackDevices, occupancy, power: rackPower, temperature: rackTemp };
  }).sort((a, b) => a.rack.name.localeCompare(b.rack.name, undefined, { numeric: true, sensitivity: 'base' }));
  const rackAssignedDevices = rackRows.flatMap((row) => row.devices);
  const roomDevices = uniqueDevices([...directRoomDevices, ...rackAssignedDevices]);
  const temperature = rackTemperatureSummary(roomDevices, environments, roomContext);
  const power = rackPowerSummary(roomDevices, deviceTypes, roomContext);
  const issues = rackDeviceIssues(roomDevices, environments, roomContext, deviceTypes);
  const totalUnits = rackRows.reduce((sum, row) => sum + row.occupancy.units, 0);
  const usedUnits = rackRows.reduce((sum, row) => sum + row.occupancy.usedUnits, 0);
  const utilization = totalUnits ? Math.round((usedUnits / totalUnits) * 100) : 0;
  const activeDevices = roomDevices.filter((device) => rackDeviceIsActive(device)).length;
  const offlineDevices = roomDevices.length - activeDevices;
  const availability = roomDevices.length ? Math.max(0, Math.round((activeDevices / roomDevices.length) * 10000) / 100) : null;
  const roomExtras = room as InfraRecord & Record<string, unknown>;
  const powerCapacityRaw = numeric(roomExtras.powerCapacityW) || (numeric(roomExtras.powerCapacityKw) ? numeric(roomExtras.powerCapacityKw) * 1000 : 0);
  const powerCapacityKw = powerCapacityRaw ? Math.round((powerCapacityRaw / 1000) * 10) / 10 : null;
  const powerPercent = power.watts && powerCapacityRaw ? Math.min(100, Math.round((power.watts / powerCapacityRaw) * 100)) : null;
  const avgTemp = temperature.value === null ? 'No data' : `${temperature.value} C`;
  const humidityValue = numeric(roomExtras.humidity);
  const humidityLabel = humidityValue ? `${humidityValue}%` : 'Not recorded';
  const powerFeed = String(roomExtras.powerFeed || roomExtras.power_feed || '').trim() || 'Not recorded';
  const accessStatus = String(roomExtras.accessStatus || roomExtras.access_status || '').trim() || 'Not recorded';
  const cctvStatus = String(roomExtras.cctvStatus || roomExtras.cctv_status || '').trim() || 'Not recorded';
  const lastAccess = String(roomExtras.lastAccess || roomExtras.last_badge_scan || '').trim() || 'Not recorded';
  const authorizedPersonnel = String(roomExtras.authorizedPersonnel || roomExtras.authorized_personnel || '').trim() || 'Not recorded';
  const coolingStatus = temperature.value === null ? 'No sensor data' : temperature.tone === 'green' ? 'Normal' : temperature.label;
  const recentAlerts = issues.slice(0, 4);
  const criticalAlerts = issues.filter((issue) => issue.severity === 'critical').length;
  const warningAlerts = issues.length - criticalAlerts;
  const roomLabel = room.name || DEFAULT_ROOM_NAME;
  const locationLabel = [room.site, room.location].filter(Boolean).join(' / ') || 'Unassigned location';
  const sortedDevices = [...roomDevices].sort((a, b) => {
    const rackCompare = String(a.rack || '').localeCompare(String(b.rack || ''), undefined, { numeric: true, sensitivity: 'base' });
    if (rackCompare) return rackCompare;
    return (Number(b.position || 0) - Number(a.position || 0)) || a.name.localeCompare(b.name);
  });
  const topDevices = sortedDevices.slice(0, 5);
  const [roomComponents, setRoomComponents] = useState<RoomComponent[]>(() => loadRoomComponents(room));
  const [componentDialogOpen, setComponentDialogOpen] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState<RoomComponent | null>(null);
  const [removeComponentTarget, setRemoveComponentTarget] = useState<RoomComponent | null>(null);
  const [dragComponentId, setDragComponentId] = useState('');
  const [componentSaveState, setComponentSaveState] = useState<'local' | 'saving' | 'saved' | 'error'>('local');
  const componentCounts = roomComponents.reduce((counts, component) => {
    const category = component.category.toLowerCase();
    if (category.includes('environment')) counts.sensors += 1;
    if (category.includes('power')) counts.power += 1;
    if (category.includes('cooling')) counts.cooling += 1;
    if (category.includes('security')) counts.security += 1;
    if (roomComponentTone(component) === 'red') counts.critical += 1;
    if (roomComponentTone(component) === 'yellow') counts.warning += 1;
    if (roomComponentTone(component) === 'gray') counts.offline += 1;
    return counts;
  }, { sensors: 0, power: 0, cooling: 0, security: 0, critical: 0, warning: 0, offline: 0 });
  const monitoredComponents = roomComponents.filter((component) => component.monitoringEnabled);
  const onlineMonitoredComponents = monitoredComponents.filter((component) => !['gray', 'red'].includes(roomComponentTone(component))).length;
  const componentAvailability = monitoredComponents.length ? Math.round((onlineMonitoredComponents / monitoredComponents.length) * 100) : null;

  useEffect(() => {
    const sync = () => setRoomComponents(loadRoomComponents(room));
    window.addEventListener('aims:room-components-changed', sync);
    return () => window.removeEventListener('aims:room-components-changed', sync);
  }, [room.id, room.name, room.site, room.location]);

  useEffect(() => {
    let cancelled = false;
    const localRows = loadRoomComponents(room);
    setRoomComponents(localRows);
    setSelectedComponent(null);
    setComponentSaveState('local');
    loadBackendRoomComponents()
      .then((result) => {
        if (cancelled || result.unavailable) return;
        const allLocalRows = loadAllRoomComponents();
        if (!result.configured && allLocalRows.length) {
          setComponentSaveState('saving');
          saveBackendRoomComponents(allLocalRows)
            .then((status) => !cancelled && setComponentSaveState(status === 'saved' ? 'saved' : 'local'))
            .catch(() => !cancelled && setComponentSaveState('error'));
          return;
        }
        saveAllRoomComponents(result.records);
        if (!cancelled) setRoomComponents(result.records.filter((component) => component.roomKey === roomKey(room)));
        if (!cancelled) setComponentSaveState('saved');
      })
      .catch(() => {
        if (!cancelled) setComponentSaveState('error');
      });
    setSelectedComponent(null);
    return () => {
      cancelled = true;
    };
  }, [room.id, room.name, room.site, room.location]);

  const persistRoomComponents = (next: RoomComponent[]) => {
    setRoomComponents(next);
    const allRows = saveRoomComponents(room, next);
    setComponentSaveState('saving');
    saveBackendRoomComponents(allRows)
      .then((status) => setComponentSaveState(status === 'saved' ? 'saved' : 'local'))
      .catch(() => setComponentSaveState('error'));
  };

  const addRoomComponent = (component: RoomComponent) => {
    const next = [...roomComponents, component];
    persistRoomComponents(next);
    setSelectedComponent(component);
    setComponentDialogOpen(false);
  };

  const removeRoomComponent = (component: RoomComponent) => {
    const unassigned: RoomComponent = {
      ...component,
      roomKey: '',
      room: '',
      rack: '',
      zone: '',
      side: '',
      assignedResource: undefined,
      assignedRecordId: '',
      assignedRecordName: '',
      updatedAt: new Date().toISOString(),
    };
    const nextRoomRows = roomComponents.filter((item) => item.id !== component.id);
    setRoomComponents(nextRoomRows);
    setSelectedComponent(null);
    setRemoveComponentTarget(null);
    const existingRows = loadAllRoomComponents();
    const found = existingRows.some((item) => item.id === component.id);
    const allRows = found
      ? existingRows.map((item) => item.id === component.id ? unassigned : item)
      : [...existingRows, unassigned];
    saveAllRoomComponents(allRows);
    setComponentSaveState('saving');
    saveBackendRoomComponents(allRows)
      .then((status) => setComponentSaveState(status === 'saved' ? 'saved' : 'local'))
      .catch(() => setComponentSaveState('error'));
  };

  const moveRoomComponent = (event: DragEvent<HTMLDivElement>) => {
    if (!dragComponentId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(4, Math.min(96, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.max(8, Math.min(88, ((event.clientY - bounds.top) / bounds.height) * 100));
    const next = roomComponents.map((component) => component.id === dragComponentId ? { ...component, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, updatedAt: new Date().toISOString() } : component);
    persistRoomComponents(next);
    setSelectedComponent(next.find((component) => component.id === dragComponentId) || null);
    setDragComponentId('');
  };

  return (
    <div className="room-detail-workspace room-ops-redesign">
      <section className="room-command-bar">
        <div>
          <button type="button" className="room-back-link" onClick={onBack}><ArrowLeft size={14} /> Back to Rooms</button>
          <span>Infrastructure <ChevronRight size={12} /> Network Rooms <ChevronRight size={12} /> {room.location || room.site || 'Unassigned'}</span>
          <h2>{roomLabel} <em>{room.status === 'Active' ? 'Operational' : room.status}</em></h2>
          <p><MapPin size={13} /> {room.site || 'Unassigned site'} <i /> Ground Floor <i /> Network Operations <i /> {room.location || 'No location recorded'}</p>
        </div>
        <div>
          <button type="button" onClick={onEdit}><Edit3 size={15} /> Edit</button>
          <button type="button"><Box size={15} /> Open Digital Twin</button>
          <button type="button"><Download size={15} /> Export <ChevronDown size={13} /></button>
          <button type="button" onClick={onAddComponent}><Plus size={15} /> Add Component</button>
          <button type="button" className="primary" onClick={onAddRack}><Plus size={15} /> Add Rack</button>
        </div>
      </section>

      <div className="room-metric-grid">
        <RoomMetricCard icon={<Warehouse size={18} />} label="Total Racks" value={racks.length} sub={racks.length ? `${usedUnits}U used of ${totalUnits}U` : 'No racks installed'} tone="blue" />
        <RoomMetricCard icon={<Server size={18} />} label="Installed Devices" value={roomDevices.length} sub={`${activeDevices} online / ${offlineDevices} inactive`} tone={offlineDevices ? 'orange' : 'green'} />
        <RoomMetricCard icon={<Zap size={18} />} label="Power Load" value={formatRackPowerValue(power, '0 W')} sub={powerCapacityKw ? `of ${powerCapacityKw} kW (${powerPercent}%)` : `${power.knownDevices} devices with power values`} tone="purple" points={power.points} />
        <RoomMetricCard icon={<Snowflake size={18} />} label="Cooling / Temperature" value={avgTemp} sub={temperature.value === null ? 'No sensor samples' : 'Avg. temperature'} tone="cyan" points={temperature.points} />
        <RoomMetricCard icon={<ShieldCheck size={18} />} label="Availability" value={availability === null ? 'No data' : `${availability}%`} sub={roomDevices.length ? 'From device status' : 'No devices installed'} tone="blue" />
        <RoomMetricCard icon={<Bell size={18} />} label="Active Alerts" value={issues.length} sub={issues.length ? `${criticalAlerts} critical / ${warningAlerts} warning` : 'No active alerts'} tone={criticalAlerts ? 'red' : warningAlerts ? 'orange' : 'green'} />
        <RoomMetricCard icon={<Box size={18} />} label="Room Components" value={roomComponents.length} sub={`${componentCounts.sensors} sensors / ${componentCounts.power} power / ${componentSaveState === 'saved' ? 'DB saved' : componentSaveState === 'saving' ? 'saving...' : componentSaveState === 'error' ? 'DB sync issue' : 'local fallback'}`} tone={componentSaveState === 'error' ? 'orange' : 'cyan'} />
      </div>

      <div className="room-main-grid">
        <div className="room-left-stack">
          <section className="card room-digital-twin-card">
            <div className="room-section-title">
              <b>Room Digital Twin</b>
              <span><i /> Live</span>
              <select defaultValue="front"><option value="front">Front Elevation</option><option value="top">Top Down</option></select>
          </div>
          <div className="room-twin-status-strip">
            <span><Warehouse size={14} /><b>{racks.length}</b> racks</span>
            <span><Server size={14} /><b>{roomDevices.length}</b> devices</span>
            <span><Activity size={14} /><b>{utilization}%</b> capacity</span>
            <span><Zap size={14} /><b>{formatRackPowerValue(power, '0 W')}</b> load</span>
            <span><Thermometer size={14} /><b>{avgTemp}</b> cooling</span>
          </div>
          <div className="room-twin-body">
            <div
              className="room-front-elevation"
              onDragOver={(event) => event.preventDefault()}
              onDrop={moveRoomComponent}
            >
              <div className="room-ceiling-raceway" />
              <div className="room-door left" tabIndex={0}><DoorOpen size={18} /><b>ROOM DOOR</b><span>Base object</span><small className="room-twin-tooltip align-left"><b>Room Door</b><span>Add an Access reader, Door contact, Electronic lock, or CCTV component to monitor this door.</span><span>Components can be dragged beside the door.</span></small></div>
              {roomComponents.map((component) => (
                <button
                  key={component.id}
                  type="button"
                  draggable
                  className={`room-component-node ${roomComponentVisualClass(component)} ${roomComponentTone(component)}${selectedComponent?.id === component.id ? ' selected' : ''}`}
                  style={{ left: `${component.x}%`, top: `${component.y}%` }}
                  onClick={() => setSelectedComponent(component)}
                  onDragStart={(event) => {
                    setDragComponentId(component.id);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDragComponentId('')}
                >
                  {roomComponentIcon(component)}
                  <b>{component.name}</b>
                  <span>{roomComponentValueLabel(component)}</span>
                  <small className="room-twin-tooltip">
                    <b>{component.name}</b>
                    <span>Type: {component.type}</span>
                    <span>Status: {component.status}</span>
                    <span>Value: {roomComponentValueLabel(component)}</span>
                    <span>Source: {component.monitoringEnabled ? component.dataSourceType || 'Monitoring enabled' : 'Manual entry'}</span>
                    <span>Drag to reposition</span>
                  </small>
                </button>
              ))}
              {!roomComponents.length && <div className="room-component-empty-note">Use Add Component to place access control, UPS, PDU, cooling, cameras, and sensors.</div>}
              <div className="room-front-racks">
                {rackRows.slice(0, 12).map((row) => (
                  <button
                    key={recordMergeKey('Racks', row.rack)}
                    type="button"
                    className={`room-front-rack ${roomRackVisualClass(row.rack.role)}`}
                    style={{
                      ['--rack-fill' as string]: `${Math.max(8, row.occupancy.utilization)}%`,
                      ['--rack-height' as string]: `${Math.max(56, Math.min(100, (row.occupancy.units / 42) * 100))}%`,
                    }}
                    onClick={() => onOpenRack(row.rack)}
                  >
                    <b>{row.rack.name}</b>
                    <span>{row.occupancy.usedUnits}U / {row.occupancy.units}U</span>
                    <em className="room-rack-face side" aria-hidden="true" />
                    <small className="room-twin-tooltip">
                      <b>{row.rack.name}</b>
                      <span>Type: {row.rack.role || 'Network rack'}</span>
                      <span>Devices: {row.devices.length}</span>
                      <span>Capacity: {row.occupancy.usedUnits}U / {row.occupancy.units}U ({row.occupancy.utilization}%)</span>
                      <span>Power: {formatRackPowerValue(row.power, 'No power data')}</span>
                      <span>Temp: {row.temperature.value === null ? 'No sensor data' : `${row.temperature.value} C`}</span>
                    </small>
                    <i style={{ height: `${Math.max(8, row.occupancy.utilization)}%` }} />
                  </button>
                ))}
                {!rackRows.length && <div className="room-front-empty">No racks assigned to this room.</div>}
              </div>
            </div>
            <div className="room-front-legend">
              <span><i className="network" /> Network Switch</span>
              <span><i className="patch" /> Patch Panel</span>
              <span><i className="server" /> Server</span>
              <span><i className="storage" /> Storage</span>
              <span><i className="pdu" /> PDU</span>
              <span><i className="blank" /> Blank Panel</span>
            </div>
          </div>
        </section>

          <section className="card room-summary-card">
            <div className="rack-panel-title"><Warehouse size={16} /> Rack & Asset Summary</div>
            <div className="rack-assets-table">
              <table>
                <thead><tr><th>Rack</th><th>Type</th><th>Devices</th><th>Used U</th><th>Power</th><th>Temp</th><th>Utilization</th><th>Status</th></tr></thead>
                <tbody>
                  {rackRows.map((row) => (
                    <tr key={recordMergeKey('Racks', row.rack)}>
                      <td><button type="button" onClick={() => onOpenRack(row.rack)}>{row.rack.name}</button></td>
                      <td>{row.rack.role || 'Network rack'}</td>
                      <td>{row.devices.length}</td>
                      <td>{row.occupancy.usedUnits} / {row.occupancy.units}</td>
                      <td>{formatRackPowerValue(row.power, '-')}</td>
                      <td>{row.temperature.value === null ? '-' : `${row.temperature.value} C`}</td>
                      <td><RackListMeter value={row.occupancy.utilization} label={`${row.occupancy.utilization}%`} /></td>
                      <td><span className={`infra-status ${row.rack.status.toLowerCase()}`}>{row.rack.status}</span></td>
                    </tr>
                  ))}
                  {!rackRows.length && <tr><td colSpan={8} className="empty">No racks are assigned to this room.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card room-environment-card">
            <div className="room-section-title"><b>Environment <small>(24 Hours)</small></b><span><i /> Live</span></div>
            <div className="room-env-grid">
              <RoomEnvTile label="Temperature" value={avgTemp} points={temperature.points.length ? temperature.points : [22, 21, 22, 23, 22, 21, 22, 22]} />
              <RoomEnvTile label="Humidity" value={humidityLabel} points={humidityValue ? [humidityValue - 1, humidityValue, humidityValue + 1, humidityValue, humidityValue - 1, humidityValue] : [0, 0]} />
              <RoomEnvTile label="Power Usage" value={formatRackPowerValue(power, '0 W')} points={power.points.length ? power.points : [15, 16, 16, 15, 17, 16, 18, 17]} />
              <RoomEnvTile label="Cooling Status" value={coolingStatus} points={temperature.points.length ? temperature.points : [0, 0]} />
              <RoomEnvTile label="Water Leak" value={roomComponents.find((component) => component.type.toLowerCase().includes('water'))?.currentValue || 'Not recorded'} points={[0, 0]} />
              <RoomEnvTile label="Smoke Status" value={roomComponents.find((component) => component.type.toLowerCase().includes('smoke'))?.currentValue || (temperature.tone === 'red' ? 'Check' : 'Normal')} points={[0, 0]} />
              <RoomEnvTile label="Door Status" value={roomComponents.find((component) => component.type.toLowerCase().includes('door'))?.currentValue || accessStatus} points={[0, 0]} />
              <RoomEnvTile label="Airflow" value={roomComponents.find((component) => component.type.toLowerCase().includes('airflow'))?.currentValue || 'Not recorded'} points={[0, 0]} />
            </div>
            <p className="room-normal-note"><CheckCircle2 size={15} /> {issues.length ? `${issues.length} room issue${issues.length === 1 ? '' : 's'} detected` : 'No active environment alerts from recorded sensors'}</p>
          </section>
        </div>

        <aside className="room-side-stack">
          <section className={`card room-alert-card ${issues.length ? 'has-alerts' : 'normal'}`}>
            <div className="room-alert-head">
              <span><Bell size={18} /></span>
              <div>
                <b>Active Alerts</b>
                <small>{issues.length ? 'Requires attention' : 'Room is currently normal'}</small>
              </div>
              <strong>{issues.length}</strong>
            </div>
            <div className="room-alert-summary">
              <span className="critical">{criticalAlerts} critical</span>
              <span className="warning">{warningAlerts} warning</span>
            </div>
            {recentAlerts.length ? recentAlerts.map((issue, index) => (
              <p key={`${issue.device.id}-${issue.kind}-${index}`} className={`rack-alert-${issue.severity}`}>
                <span>{issue.severity === 'critical' ? 'Critical' : 'Warning'}</span> {issue.device.name}: {issue.message}<small>{index + 2} min ago</small>
              </p>
            )) : <p><span>Normal</span> No active room alerts<small>Live</small></p>}
          </section>

          <section className="card room-component-detail-card">
            <div className="rack-panel-title"><Box size={16} /> {selectedComponent ? 'Selected Component' : 'Room Components'} <b>{roomComponents.length}</b></div>
            {selectedComponent ? (
              <div className="room-component-detail">
                <span className={`room-component-detail-icon ${roomComponentTone(selectedComponent)}`}>{roomComponentIcon(selectedComponent)}</span>
                <h3>{selectedComponent.name}</h3>
                <p>{selectedComponent.type} / {selectedComponent.category}</p>
                <dl>
                  <dt>Status</dt><dd>{selectedComponent.status}</dd>
                  <dt>Value</dt><dd>{selectedComponent.currentValue || 'Not recorded'} {selectedComponent.unit || ''}</dd>
                  <dt>Placement</dt><dd>{[selectedComponent.zone, selectedComponent.rack, selectedComponent.side].filter(Boolean).join(' / ') || 'Room level'}</dd>
                  <dt>Data source</dt><dd>{selectedComponent.monitoringEnabled ? selectedComponent.dataSourceType || 'Monitoring enabled' : 'Manual entry'}</dd>
                  <dt>Source details</dt><dd>{roomComponentMonitoringDetail(selectedComponent)}</dd>
                  {selectedComponent.dataSourceDetail && <><dt>Source notes</dt><dd>{selectedComponent.dataSourceDetail}</dd></>}
                  {selectedComponent.xmlEndpoint && <><dt>XML endpoint</dt><dd>{selectedComponent.xmlEndpoint}</dd></>}
                  {selectedComponent.xmlValuePath && <><dt>XML value path</dt><dd>{selectedComponent.xmlValuePath}</dd></>}
                  <dt>Last update</dt><dd>{formatDate(selectedComponent.updatedAt)}</dd>
                </dl>
                <div className="room-component-detail-actions">
                  <button type="button" onClick={onAddComponent}><Edit3 size={14} /> Add another component</button>
                  <button type="button" className="danger" onClick={() => setRemoveComponentTarget(selectedComponent)}><Trash2 size={14} /> Remove from room</button>
                </div>
              </div>
            ) : (
              <div className="room-component-summary">
                <span><b>{componentCounts.sensors}</b><small>Sensors</small></span>
                <span><b>{componentCounts.power}</b><small>Power</small></span>
                <span><b>{componentCounts.cooling}</b><small>Cooling</small></span>
                <span><b>{componentCounts.security}</b><small>Security</small></span>
                <p>{componentAvailability === null ? 'No monitored components configured.' : `${componentAvailability}% monitored component availability.`}</p>
              </div>
            )}
          </section>

          <section className="card room-overview-card">
            <nav><button className="active">Overview</button><button>Assets</button><button>Environment</button><button>Security</button></nav>
            <div className="room-overview-columns">
              <div>
                <p><Building2 size={14} /><span>Site</span><b>{room.site || '-'}</b></p>
                <p><DoorOpen size={14} /><span>Room Name</span><b>{roomLabel}</b></p>
                <p><Layers size={14} /><span>Location</span><b>{room.location || '-'}</b></p>
                <p><Tags size={14} /><span>Purpose</span><b>{room.description || room.role || 'Not recorded'}</b></p>
              </div>
              <div>
                <p><Server size={14} /><span>Device Count</span><b>{roomDevices.length}</b></p>
                <p><Warehouse size={14} /><span>Racks</span><b>{racks.length}</b></p>
                <p><Zap size={14} /><span>Power Feed</span><b>{powerFeed}</b></p>
                <p><Thermometer size={14} /><span>Humidity</span><b>{humidityLabel}</b></p>
                <p><LockKeyhole size={14} /><span>Access Status</span><b>{accessStatus}</b></p>
              </div>
            </div>
            <div className="room-tags">{[room.role, room.status, room.tags].filter(Boolean).join(',').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 6).map((tag) => <span key={tag}>{tag}</span>)}</div>
            <div className="room-key-assets">
              <b>Key Assets</b>
              {topDevices.length ? topDevices.map((device) => (
                <button type="button" key={device.id}>
                  <Server size={14} />
                  <span>{device.name}<small>{[device.rack, device.management_ip].filter(Boolean).join(' / ') || 'No rack assignment'}</small></span>
                  <em className={rackDeviceIsActive(device) ? 'active' : 'inactive'}>{device.status || 'Unknown'}</em>
                </button>
              )) : <p>No devices assigned to this room.</p>}
            </div>
          </section>

          <section className="card room-access-card room-events-card">
            <div className="rack-panel-title"><Activity size={16} /> Recent Events <b><i /> Live</b></div>
            <p><Thermometer size={16} /><span>Environment</span><b>{coolingStatus}</b></p>
            <p><Zap size={16} /><span>Power</span><b>{formatRackPowerValue(power, 'No power data')}</b></p>
            <p><LockKeyhole size={16} /><span>Access</span><b>{accessStatus}</b></p>
            <p><ShieldCheck size={16} /><span>Last Inspection</span><b>{formatDate(room.lastUpdated)}</b></p>
          </section>

          <section className="card room-quick-actions">
            <div className="rack-panel-title"><Activity size={16} /> Quick Actions</div>
            <div>
              <button type="button" onClick={onAddComponent}><Box size={18} /> Add Component</button>
              <button><Plus size={18} /> Add Rack</button>
              <button><Search size={18} /> Discover Devices</button>
              <button><ShieldCheck size={18} /> Run Audit</button>
              <button><Download size={18} /> Environmental Report</button>
              <button><LockKeyhole size={18} /> Access Logs</button>
            </div>
          </section>
        </aside>
      </div>
      {componentDialogOpen && (
        <RoomComponentDialog
          room={room}
          racks={racks}
          components={roomComponents}
          onCancel={() => setComponentDialogOpen(false)}
          onSave={addRoomComponent}
        />
      )}
      {removeComponentTarget && (
        <RoomComponentRemoveDialog
          component={removeComponentTarget}
          onCancel={() => setRemoveComponentTarget(null)}
          onConfirm={() => removeRoomComponent(removeComponentTarget)}
        />
      )}
    </div>
  );
}

function RoomComponentRemoveDialog({
  component,
  onCancel,
  onConfirm,
}: {
  component: RoomComponent;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return createPortal(
    <div className="room-component-modal" role="dialog" aria-modal="true" onMouseDown={onCancel}>
      <section className="room-component-form component-remove-form" onMouseDown={(event) => event.stopPropagation()}>
        <div className="room-component-form-head">
          <div>
            <span>Room component assignment</span>
            <h2><Trash2 size={20} /> Remove from room</h2>
            <p>This keeps the component in the backend component database.</p>
          </div>
          <button type="button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="component-remove-summary">
          <b>{component.name || component.type || 'Component'}</b>
          <span>{component.type || 'Component'} / {component.category || 'Uncategorized'}</span>
          <small>{[component.site, component.location, component.room].filter(Boolean).join(' / ') || 'Room assignment'}</small>
        </div>
        <div className="room-component-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" className="danger" onClick={onConfirm}><Trash2 size={14} /> Remove from room</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function RoomMetricCard({ icon, label, value, sub, tone, points = [] }: { icon: ReactElement; label: string; value: string | number; sub: string; tone: string; points?: number[] }) {
  const hasTrend = points.length > 2 && new Set(points.map((point) => Math.round(point * 1000) / 1000)).size > 1;
  return (
    <section className={`room-kpi room-metric-card ${tone}`}>
      <span>{icon}</span>
      <p>{label}</p>
      <b>{value}</b>
      <small>{sub}</small>
      {hasTrend && <RoomMiniSparkline points={points} />}
    </section>
  );
}

function RoomMiniSparkline({ points }: { points: number[] }) {
  const values = points.length > 1 ? points : [0, 0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const path = values.map((point, index) => {
    const x = (index / Math.max(1, values.length - 1)) * 100;
    const y = 26 - ((point - min) / Math.max(1, max - min)) * 22;
    return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return <svg className="room-mini-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none"><path d={path} /></svg>;
}

function RoomEnvTile({ label, value, points }: { label: string; value: string; points: number[] }) {
  return (
    <div className="room-env-tile">
      <p>{label}</p>
      <b>{value}</b>
      <RoomMiniSparkline points={points} />
    </div>
  );
}

function RoomComponentDialog({
  room,
  racks,
  components,
  onCancel,
  onSave,
}: {
  room: InfraRecord;
  racks: InfraRecord[];
  components: RoomComponent[];
  onCancel: () => void;
  onSave: (component: RoomComponent) => void;
}) {
  const categories = Object.keys(roomComponentCatalog);
  const [category, setCategory] = useState(categories[0]);
  const [type, setType] = useState(roomComponentCatalog[categories[0]][0]);
  const selectedTypes = roomComponentCatalog[category] || [];
  const specFields = roomComponentTypeFields[type] || ['Rated capacity', 'Current value', 'Maximum value', 'Maintenance interval', 'Last inspection date'];
  const isCustom = type === 'Custom component';

  useEffect(() => {
    const firstType = roomComponentCatalog[category]?.[0] || 'Custom component';
    setType(firstType);
  }, [category]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const resolvedType = isCustom ? String(form.get('customType') || '').trim() || 'Custom component' : type;
    const position = roomComponentDefaultPosition(resolvedType, components.length);
    const specs = specFields.reduce<Record<string, string>>((values, field) => {
      const value = String(form.get(`spec:${field}`) || '').trim();
      if (value) values[field] = value;
      return values;
    }, {});
    const now = new Date().toISOString();
    onSave({
      id: `room-component-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      roomKey: roomKey(room),
      category,
      type: resolvedType,
      name: String(form.get('name') || '').trim() || resolvedType,
      role: String(form.get('role') || '').trim(),
      status: (String(form.get('status') || 'Normal') as RoomComponent['status']),
      manufacturer: String(form.get('manufacturer') || '').trim(),
      model: String(form.get('model') || '').trim(),
      serialNumber: String(form.get('serialNumber') || '').trim(),
      assetTag: String(form.get('assetTag') || '').trim(),
      description: String(form.get('description') || '').trim(),
      site: room.site || '',
      location: room.location || '',
      room: room.name || DEFAULT_ROOM_NAME,
      zone: String(form.get('zone') || '').trim(),
      rack: String(form.get('rack') || '').trim(),
      rackPosition: String(form.get('rackPosition') || '').trim(),
      side: String(form.get('side') || '').trim(),
      parentComponent: String(form.get('parentComponent') || '').trim(),
      x: position.x,
      y: position.y,
      orientation: String(form.get('orientation') || '').trim(),
      monitoringEnabled: form.get('monitoringEnabled') === 'on',
      dataSourceType: String(form.get('dataSourceType') || '').trim(),
      dataSourceDetail: String(form.get('dataSourceDetail') || '').trim(),
      ipAddress: String(form.get('ipAddress') || '').trim(),
      hostname: String(form.get('hostname') || '').trim(),
      protocol: String(form.get('protocol') || '').trim(),
      pollingInterval: String(form.get('pollingInterval') || '').trim(),
      xmlEndpoint: String(form.get('xmlEndpoint') || '').trim(),
      xmlValuePath: String(form.get('xmlValuePath') || '').trim(),
      xmlStatusPath: String(form.get('xmlStatusPath') || '').trim(),
      currentValue: String(form.get('currentValue') || '').trim(),
      unit: String(form.get('unit') || '').trim(),
      notes: String(form.get('notes') || '').trim(),
      specs,
      createdAt: now,
      updatedAt: now,
    });
  };

  return createPortal(
    <div className="room-component-modal" role="dialog" aria-modal="true">
      <form className="room-component-form" onSubmit={submit}>
        <div className="room-component-form-head">
          <div>
            <span>System Room / Add Component</span>
            <h2>Add Room Component</h2>
            <p>{room.site || 'Unassigned site'} / {room.location || 'No location'} / {room.name || DEFAULT_ROOM_NAME}</p>
          </div>
          <button type="button" onClick={onCancel}><X size={18} /></button>
        </div>

        <div className="room-component-step">
          <b>1. Component Type</b>
          <div className="room-component-form-grid">
            <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Component type<select value={type} onChange={(event) => setType(event.target.value)}>{selectedTypes.map((item) => <option key={item}>{item}</option>)}</select></label>
            {isCustom && <label>Custom type<input name="customType" placeholder="Component type name" /></label>}
          </div>
        </div>

        <div className="room-component-step">
          <b>2. Identity</b>
          <div className="room-component-form-grid">
            <label>Name<input name="name" required placeholder={`${type}-01`} /></label>
            <label>Role<input name="role" placeholder="Primary, backup, monitoring..." /></label>
            <label>Status<select name="status" defaultValue="Normal"><option>Normal</option><option>Warning</option><option>Critical</option><option>Offline</option><option>Maintenance</option><option>Unknown</option></select></label>
            <label>Asset tag<input name="assetTag" /></label>
            <label>Manufacturer<input name="manufacturer" /></label>
            <label>Model<input name="model" /></label>
            <label>Serial number<input name="serialNumber" /></label>
            <label>Description<textarea name="description" rows={2} /></label>
          </div>
        </div>

        <div className="room-component-step">
          <b>3. Placement</b>
          <div className="room-component-form-grid">
            <label>Site<input value={room.site || ''} readOnly /></label>
            <label>Location<input value={room.location || ''} readOnly /></label>
            <label>Room<input value={room.name || DEFAULT_ROOM_NAME} readOnly /></label>
            <label>Room zone<input name="zone" placeholder="Front, rear, ceiling, floor..." /></label>
            <label>Rack<select name="rack" defaultValue=""><option value="">Room level</option>{racks.map((rack) => <option key={recordMergeKey('Racks', rack)} value={rack.name}>{rack.name}</option>)}</select></label>
            <label>Rack position<input name="rackPosition" placeholder="U42, rear upper, rack front..." /></label>
            <label>Side<select name="side" defaultValue=""><option value="">Not specified</option><option>Front</option><option>Rear</option><option>Left</option><option>Right</option><option>Ceiling</option><option>Floor</option></select></label>
            <label>Parent component<select name="parentComponent" defaultValue=""><option value="">None</option>{components.map((component) => <option key={component.id} value={component.name}>{component.name}</option>)}</select></label>
            <label>Orientation<input name="orientation" placeholder="North, rear-facing, wall-mounted..." /></label>
          </div>
        </div>

        <div className="room-component-step">
          <b>4. Specifications</b>
          <div className="room-component-form-grid">
            <label>Current value<input name="currentValue" placeholder="22.8, OK, 60..." /></label>
            <label>Unit<input name="unit" placeholder="C, %, kW, V..." /></label>
            {specFields.map((field) => <label key={field}>{field}<input name={`spec:${field}`} /></label>)}
          </div>
        </div>

        <div className="room-component-step">
          <b>5. Monitoring</b>
          <div className="room-component-form-grid">
            <label className="room-component-check"><input type="checkbox" name="monitoringEnabled" /> Monitoring enabled</label>
            <label>Data source<select name="dataSourceType" defaultValue="Manual"><option>Manual</option><option>SNMP</option><option>REST API</option><option>XML</option><option>Modbus TCP</option><option>BACnet</option><option>MQTT</option><option>SSH</option><option>ICMP</option><option>Webhook</option></select></label>
            <label>IP address<input name="ipAddress" /></label>
            <label>Hostname<input name="hostname" /></label>
            <label>Protocol<input name="protocol" placeholder="SNMP v2c, HTTPS, MQTT..." /></label>
            <label>Polling interval<input name="pollingInterval" placeholder="60s" /></label>
            <label>XML endpoint / file<input name="xmlEndpoint" placeholder="https://pdu.local/status.xml or /sensors.xml" /></label>
            <label>XML value path<input name="xmlValuePath" placeholder="/response/sensor/value or sensor.temperature" /></label>
            <label>XML status path<input name="xmlStatusPath" placeholder="/response/sensor/status (optional)" /></label>
            <label>Data source detail<textarea name="dataSourceDetail" rows={2} placeholder="How to read this source, auth notes, expected XML tags, units, or fallback behavior." /></label>
            <label>Notes<textarea name="notes" rows={2} placeholder="Manual value, verification status, maintenance notes..." /></label>
          </div>
          <p className="room-component-help">XML source: the backend stores the endpoint and XML paths with this component. A poller can fetch the XML, extract the value path, map the optional status path, then update this component value and alert state.</p>
        </div>

        <div className="room-component-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit">Add Component</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function LocationDetailOverview({ location, data }: { location: InfraRecord; data: LocationRelatedData }) {
  const capacity = capacityFor('Locations', location);
  const rooms = numeric(location.rooms) || Math.max(0, data.racks.length);
  const relatedTiles = [
    { label: 'Locations', value: rooms || 1, icon: <Network size={17} />, tone: 'blue' },
    { label: 'Racks', value: data.racks.length, icon: <Server size={17} />, tone: 'purple' },
    { label: 'Devices', value: data.devices.length, icon: <Database size={17} />, tone: 'green' },
    { label: 'APs', value: data.aps.length, icon: <Zap size={17} />, tone: 'cyan' },
    { label: 'IP Addresses', value: data.ips.length, icon: <MapPin size={17} />, tone: 'cyan' },
    { label: 'VLANs', value: data.vlans.length, icon: <Network size={17} />, tone: 'orange' },
    { label: 'Prefixes', value: data.prefixes.length, icon: <Layers size={17} />, tone: 'teal' },
  ];
  return (
    <div className="location-detail-shell">
      <div className="location-detail-kpis">
        <LocationDetailKpi icon={<MapPin size={18} />} label="Location" value={location.name} />
        <LocationDetailKpi icon={<CheckCircle2 size={18} />} label="Status" value={location.status} status />
        <LocationDetailKpi icon={<Tags size={18} />} label="Role" value={location.role || '-'} />
        <LocationDetailKpi icon={<Building2 size={18} />} label="Scope" value={location.site || '-'} />
        <LocationDetailKpi icon={<Network size={18} />} label="Related" value={`${data.devices.length} devices / ${data.aps.length} APs`} />
        <LocationDetailKpi icon={<Server size={18} />} label="Device count" value={String(location.devices || data.devices.length)} />
        <LocationDetailKpi icon={<Activity size={18} />} label="Capacity" value={`${capacity}%`} sub="Recorded utilization" />
      </div>

      <div className="location-detail-grid">
        <section className="card location-detail-card">
          <div className="rack-panel-title"><Database size={16} /> Identity</div>
          <div className="location-detail-kv">
            <p><span>Name</span><b>{location.name || '-'}</b></p>
            <p><span>Address</span><b>{location.address || '-'}</b></p>
            <p><span>Type</span><b>{location.role || '-'}</b></p>
            <p><span>Tenant</span><b>{location.tenant || '-'}</b></p>
            <p><span>Tags</span><b>{location.tags || '-'}</b></p>
            <p><span>Last updated</span><b>{formatDate(location.lastUpdated)}</b></p>
          </div>
        </section>

        <section className="card location-detail-card">
          <div className="rack-panel-title"><Network size={16} /> Placement</div>
          <div className="location-detail-kv">
            <p><span>Site</span><b>{location.site || '-'}</b></p>
            <p><span>Rooms</span><b>{rooms}</b></p>
            <p><span>Racks</span><b>{data.racks.length}</b></p>
            <p><span>Device count</span><b>{location.devices || data.devices.length}</b></p>
            <p><span>Wireless APs</span><b>{data.aps.length}</b></p>
          </div>
        </section>

        <section className="card location-detail-card location-related-summary">
          <div className="rack-panel-title"><Layers size={16} /> Related Records</div>
          <div>
            {relatedTiles.map((tile) => (
              <span key={tile.label} className={`location-related-tile ${tile.tone}`}>
                {tile.icon}
                <small>{tile.label}</small>
                <b>{tile.value}</b>
              </span>
            ))}
          </div>
        </section>

        <section className="card location-detail-card location-notes-card">
          <div className="rack-panel-title"><Bell size={16} /> Operational Notes</div>
          <div>
            {location.image ? <img src={location.image} alt={location.name} /> : <Database size={34} />}
            <p>{location.description || 'No description has been recorded for this object yet.'}</p>
          </div>
        </section>
      </div>
    </div>
  );
}

function LocationDetailKpi({ icon, label, value, sub, status = false }: { icon: ReactElement; label: string; value: string; sub?: string; status?: boolean }) {
  return (
    <section className="location-detail-kpi">
      <span>{icon}</span>
      <p>{label}</p>
      {status ? <b className="good-dot">{value}</b> : <b>{value}</b>}
      {sub && <small>{sub}</small>}
    </section>
  );
}

type VlanDetailRelationTab = 'devices' | 'ips' | 'prefixes' | 'racks';

function VlanDetailOverview({ vlan, devices }: { vlan: InfraRecord; devices: InventoryDevice[] }) {
  const [activeTab, setActiveTab] = useState<VlanDetailRelationTab>('devices');
  const [query, setQuery] = useState('');
  const metrics = vlanRowMetrics(vlan, devices);
  const utilization = vlanUtilization(metrics.devices.length, metrics.prefix);
  const ipRecords = uniqueInfraRecords(mergeManualAndDerived('IP Addresses', loadRecords('IP Addresses'), deriveRecords('IP Addresses', devices)).filter((record) => {
    if (record.relatedDeviceIds?.some((id) => devices.some((device) => device.id === id))) return true;
    return Boolean(metrics.prefix && record.address && ipv4Prefix(record.address) === metrics.prefix);
  }));
  const rackRecords = uniqueInfraRecords(mergeManualAndDerived('Racks', loadRecords('Racks'), deriveRecords('Racks', devices)).filter((record) => (
    devices.some((device) => sameText(device.rack, record.name) && (!record.site || sameText(siteOf(device), record.site)))
  )));
  const siteRecords = uniqueInfraRecords(mergeManualAndDerived('Sites', loadRecords('Sites'), deriveRecords('Sites', devices)).filter((record) => (
    devices.some((device) => sameText(siteOf(device), record.name)) || sameText(vlan.site, record.name)
  )));
  const locationRecords = uniqueInfraRecords(mergeManualAndDerived('Locations', loadRecords('Locations'), deriveRecords('Locations', devices)).filter((record) => (
    devices.some((device) => sameText(device.location, record.name) && (!record.site || sameText(siteOf(device), record.site)))
  )));
  const broadcast = ipv4Broadcast(metrics.prefix);
  const tabCounts: Record<VlanDetailRelationTab, number> = {
    devices: metrics.devices.length,
    ips: ipRecords.length,
    prefixes: metrics.prefixes.length,
    racks: rackRecords.length,
  };

  return (
    <div className="vlan-detail-shell">
      <div className="vlan-detail-kpis">
        <VlanDetailKpi icon={<Network size={18} />} label="VLAN ID" value={vlan.vlanId || '-'} />
        <VlanDetailKpi icon={<Database size={18} />} label="VLAN Name" value={vlan.name || '-'} wide />
        <VlanDetailKpi icon={<CheckCircle2 size={18} />} label="Status" value={vlan.status} status />
        <VlanDetailKpi icon={<Layers size={18} />} label="Scope" value={vlanScope(vlan)} />
        <VlanDetailKpi icon={<Building2 size={18} />} label="Site" value={vlan.site || '-'} wide />
        <VlanDetailKpi icon={<Server size={18} />} label="Devices" value={String(metrics.devices.length)} />
        <VlanDetailKpi icon={<Tags size={18} />} label="Prefixes" value={String(metrics.prefixes.length)} />
        <VlanDetailKpi icon={<Activity size={18} />} label="Utilization" value={utilization.percentLabel} />
      </div>

      <div className="vlan-detail-grid">
        <section className="card vlan-detail-card">
          <div className="rack-panel-title"><Database size={16} /> Identity</div>
          <div className="vlan-detail-kv">
            <p><span>Name</span><b>{vlan.name || '-'}</b></p>
            <p><span>VLAN ID</span><b>{vlan.vlanId || '-'}</b></p>
            <p><span>Status</span><b><span className={`infra-status ${vlan.status.toLowerCase()}`}>{vlan.status}</span></b></p>
            <p><span>Scope</span><b>{vlanScope(vlan)}</b></p>
            <p><span>Site</span><b>{vlan.site || '-'}</b></p>
            <p><span>Tenant</span><b>{vlan.tenant || '-'}</b></p>
            <p><span>Tags</span><b>{vlan.tags || '-'}</b></p>
          </div>
        </section>

        <section className="card vlan-detail-card">
          <div className="rack-panel-title"><Network size={16} /> Network Configuration</div>
          <div className="vlan-detail-kv">
            <p><span>Prefix / Subnet</span><b>{metrics.prefix}</b></p>
            <p><span>Gateway</span><b>{vlan.gateway || '-'}</b></p>
            <p><span>VRF</span><b>{vlan.vrf || '-'}</b></p>
            <p><span>DHCP</span><b><span className="vlan-config-badge">{vlan.tags?.toLowerCase().includes('dhcp') ? 'Recorded' : 'Not recorded'}</span></b></p>
            <p><span>DNS</span><b>{vlan.tags?.toLowerCase().includes('dns') ? 'Recorded' : '-'}</b></p>
            <p><span>Broadcast</span><b>{broadcast || '-'}</b></p>
            <p><span>Usable IPs</span><b>{utilization.usableLabel}</b></p>
          </div>
        </section>

        <section className="card vlan-detail-card vlan-related-card">
          <div className="rack-panel-title"><Network size={16} /> Related Records</div>
          <div>
            <VlanRelatedTile icon={<Database size={18} />} label="Devices" value={metrics.devices.length} onClick={() => metrics.devices[0] && openInventoryDeviceDetail(metrics.devices[0])} />
            <VlanRelatedTile icon={<Tags size={18} />} label="Prefixes" value={metrics.prefixes.length} onClick={() => metrics.prefixes[0] && openInfrastructureDetail('Prefixes', metrics.prefixes[0])} />
            <VlanRelatedTile icon={<Server size={18} />} label="Racks" value={rackRecords.length} onClick={() => rackRecords[0] && openInfrastructureDetail('Racks', rackRecords[0])} />
            <VlanRelatedTile icon={<Layers size={18} />} label="IP Addresses" value={ipRecords.length} onClick={() => ipRecords[0] && openInfrastructureDetail('IP Addresses', ipRecords[0])} />
            <VlanRelatedTile icon={<Building2 size={18} />} label="Sites" value={siteRecords.length} onClick={() => siteRecords[0] && openInfrastructureDetail('Sites', siteRecords[0])} />
            <VlanRelatedTile icon={<MapPin size={18} />} label="Locations" value={locationRecords.length} onClick={() => locationRecords[0] && openInfrastructureDetail('Locations', locationRecords[0])} />
          </div>
        </section>

        <div className="vlan-detail-side">
          <section className="card vlan-detail-card vlan-notes-card">
            <div className="rack-panel-title"><Tags size={16} /> Operational Notes</div>
            <p>{vlan.description || 'No description has been recorded for this VLAN yet.'}</p>
          </section>
          <section className="card vlan-detail-card vlan-util-overview">
            <div className="rack-panel-title"><Activity size={16} /> Utilization Overview</div>
            <p>{metrics.devices.length} device{metrics.devices.length === 1 ? '' : 's'} of {utilization.usableLabel} usable IPs <b>{utilization.percentLabel}</b></p>
            <i><em style={{ width: `${utilization.percent}%` }} /></i>
            <svg viewBox="0 0 280 82" aria-hidden="true">
              <polyline points={vlanUtilizationLine(utilization.percent)} />
            </svg>
          </section>
        </div>
      </div>

      <section className="card vlan-relationships-card">
        <div className="vlan-relationships-head">
          <h2><Network size={17} /> VLAN Relationships</h2>
          <div className="table-search infra-global-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search devices, IPs, prefixes, racks, names, MACs, ports, and status in this VLAN..." />
          </div>
        </div>
        <div className="infra-related-tabs vlan-detail-tabs">
          {([
            ['devices', 'Devices'],
            ['ips', 'IP Addresses'],
            ['prefixes', 'Prefixes'],
            ['racks', 'Racks'],
          ] as const).map(([key, label]) => (
            <button type="button" key={key} className={activeTab === key ? 'active' : ''} onClick={() => setActiveTab(key)}>
              {label}<b>{tabCounts[key]}</b>
            </button>
          ))}
        </div>
        <VlanRelationshipTable tab={activeTab} query={query} devices={metrics.devices} ips={ipRecords} prefixes={metrics.prefixes} racks={rackRecords} />
      </section>
    </div>
  );
}

function VlanDetailKpi({ icon, label, value, wide = false, status = false }: { icon: ReactElement; label: string; value: string; wide?: boolean; status?: boolean }) {
  return (
    <section className={`vlan-detail-kpi${wide ? ' wide' : ''}`}>
      <span>{icon}</span>
      <p>{label}</p>
      <b className={status ? 'good-dot' : ''}>{value}</b>
    </section>
  );
}

function VlanRelatedTile({ icon, label, value, onClick }: { icon: ReactElement; label: string; value: number; onClick: () => void }) {
  return (
    <button type="button" className="vlan-related-tile" onClick={onClick} disabled={!value}>
      {icon}
      <span>{label}</span>
      <b>{value}</b>
    </button>
  );
}

function VlanRelationshipTable({ tab, query, devices, ips, prefixes, racks }: { tab: VlanDetailRelationTab; query: string; devices: InventoryDevice[]; ips: InfraRecord[]; prefixes: InfraRecord[]; racks: InfraRecord[] }) {
  if (tab === 'devices') {
    const rows = devices.filter((row) => searchMatch(row, query));
    return (
      <div className="table-wrap vlan-detail-table">
        <table>
          <thead><tr><th>Device</th><th>Role</th><th>Management IP</th><th>Site</th><th>Location</th><th>Rack</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((device) => (
              <tr key={device.id}>
                <td><button type="button" className="relationship-link" onClick={() => openInventoryDeviceDetail(device)}>{device.name}</button></td>
                <td>{device.role || device.platform || '-'}</td>
                <td>{device.management_ip || '-'}</td>
                <td>{siteOf(device) || '-'}</td>
                <td>{device.location || '-'}</td>
                <td>{device.rack || '-'}</td>
                <td><span className={`infra-status ${String(device.status || 'planned').toLowerCase()}`}>{device.status || 'Unknown'}</span></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="empty">No linked devices matched.</td></tr>}
          </tbody>
        </table>
      </div>
    );
  }

  const resource: InfrastructureResourceName = tab === 'ips' ? 'IP Addresses' : tab === 'prefixes' ? 'Prefixes' : 'Racks';
  const rows = (tab === 'ips' ? ips : tab === 'prefixes' ? prefixes : racks).filter((row) => searchMatch(row, query));
  return (
    <div className="table-wrap vlan-detail-table">
      <table>
        <thead><tr><th>{resource}</th><th>Site</th><th>Scope</th><th>Status</th><th>Related Devices</th><th>Last Updated</th></tr></thead>
        <tbody>
          {rows.map((record) => (
            <tr key={record.id}>
              <td><button type="button" className="relationship-link" onClick={() => openInfrastructureDetail(resource, record)}>{resourceDisplayValue(resource, record)}</button><small>{record.description || `${resource} record`}</small></td>
              <td>{record.site || '-'}</td>
              <td>{scopeValue(resource, record)}</td>
              <td><span className={`infra-status ${record.status.toLowerCase()}`}>{record.status}</span></td>
              <td>{record.relatedDeviceIds?.length || record.devices || '-'}</td>
              <td>{formatDate(record.lastUpdated)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="empty">No related {resource.toLowerCase()} matched.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function IpAddressDetailOverview({ ip, records, devices }: { ip: InfraRecord; records: InfraRecord[]; devices: InventoryDevice[] }) {
  const prefixes = useMemo(() => uniqueInfraRecords(mergeManualAndDerived('Prefixes', loadRecords('Prefixes'), deriveRecords('Prefixes', devices))), [devices]);
  const vlans = useMemo(() => uniqueInfraRecords(mergeManualAndDerived('VLANs', loadRecords('VLANs'), deriveRecords('VLANs', devices))), [devices]);
  const metrics = ipAddressMetrics(ip, devices, prefixes, vlans);
  const samePrefixIps = records.filter((record) => metrics.prefix && ipAddressMetrics(record, devices, prefixes, vlans).prefix === metrics.prefix);
  const usable = ipv4UsableHosts(metrics.prefix || '') || 0;
  const utilization = usable ? Math.min(100, Math.round((samePrefixIps.length / usable) * 100)) : 0;
  const address = ipOnly(ip.address || ip.name);
  const ipVersion = address.includes(':') ? 'IPv6' : 'IPv4';
  const broadcast = ipv4Broadcast(metrics.prefix || '');
  const netmask = ipv4Netmask(metrics.prefix || '');
  const vlanLabel = metrics.vlan ? `${metrics.vlan}${metrics.vlanRecord?.name ? ` (${metrics.vlanRecord.name})` : ''}` : '-';
  const linkedLocation = ip.location || metrics.device?.location || '-';
  const linkedRack = ip.rack || metrics.device?.rack || '-';
  const mac = String((metrics.device as InventoryDevice & { mac_address?: string | null })?.mac_address || '-');
  const linkedInterfaces = metrics.device ? deviceIps(metrics.device).filter((row) => ipOnly(row.address) === address) : [];
  const assignment = ip.status === 'Reserved' ? 'Reserved' : ip.source === 'device' ? 'Inventory learned' : 'Static';
  const monitored = Boolean(metrics.device?.snmp_status || metrics.device?.last_seen_at);
  const recentRows = [
    [formatDate(ip.lastUpdated), ip.source === 'device' ? 'IP address discovered' : 'IP address updated', ip.source === 'device' ? 'inventory' : 'system', ip.source === 'device' ? `Learned from ${metrics.device?.name || 'device inventory'}` : `IP address status is ${ip.status}`],
    ...(metrics.device ? [[formatDate(metrics.device.last_seen_at || ip.lastUpdated), 'Device association', 'inventory', `Linked to ${metrics.device.name}`]] : []),
  ];

  return (
    <div className="ipam-detail-layout">
      <aside className="card ipam-detail-rail">
        <h2>{address}</h2>
        <p>{metrics.device?.name || ip.name || '-'}</p>
        <div className="ip-detail-badges"><span className={`infra-status ${ip.status.toLowerCase()}`}>{ip.status}</span><span>{assignment}</span></div>
        <IpRailItem icon={<Database size={15} />} label="IP Version" value={ipVersion} />
        <IpRailItem icon={<Network size={15} />} label="Type" value="Single IP" />
        <IpRailItem icon={<Server size={15} />} label="Role" value={ip.role || '-'} />
        <IpRailItem icon={<Server size={15} />} label="Assigned To" value={metrics.device?.name || ip.name || '-'} sub={metrics.device?.role || metrics.device?.platform || ''} />
        <IpRailItem icon={<MapPin size={15} />} label="Location" value={linkedLocation} sub={linkedRack !== '-' ? linkedRack : ''} />
        <IpRailItem icon={<Building2 size={15} />} label="Site" value={ip.site || '-'} />
        <IpRailItem icon={<Network size={15} />} label="VLAN" value={vlanLabel} />
        <IpRailItem icon={<Layers size={15} />} label="Prefix" value={metrics.prefix || '-'} />
        <IpRailItem icon={<Database size={15} />} label="Gateway" value={metrics.prefixRecord?.gateway || '-'} />
        <IpRailItem icon={<Database size={15} />} label="DNS" value="-" />
        <IpRailItem icon={<Tags size={15} />} label="MAC Address" value={mac} />
        <IpRailItem icon={<Activity size={15} />} label="Last Seen" value={formatDate(ip.lastUpdated)} />
        <IpRailItem icon={<CheckCircle2 size={15} />} label="Monitoring" value={monitored ? 'Inventory monitored' : 'Not monitored'} good={monitored} />
      </aside>

      <div className="ipam-detail-main">
            <div className="ip-detail-overview-grid">
              <section className="card ip-info-card">
                <h3>IP Address Information</h3>
                <div>
                  <p><span>Address</span><b>{address}</b></p>
                  <p><span>IP Version</span><b>{ipVersion}</b></p>
                  <p><span>Prefix</span><b>{metrics.prefix || '-'}</b></p>
                  <p><span>Type</span><b>Single IP</b></p>
                  <p><span>Netmask</span><b>{netmask || '-'}</b></p>
                  <p><span>Assignment</span><b>{assignment}</b></p>
                  <p><span>Broadcast</span><b>{broadcast || '-'}</b></p>
                  <p><span>Role</span><b>{ip.role || '-'}</b></p>
                  <p><span>Gateway</span><b>{metrics.prefixRecord?.gateway || '-'}</b></p>
                  <p><span>Status</span><b><span className={`infra-status ${ip.status.toLowerCase()}`}>{ip.status}</span></b></p>
                  <p><span>DNS Servers</span><b>-</b></p>
                  <p><span>Tags</span><b>{ip.tags || '-'}</b></p>
                  <p><span>VRF</span><b>{metrics.vrf || '-'}</b></p>
                  <p><span>Tenant</span><b>{ip.tenant || '-'}</b></p>
                </div>
              </section>

              <section className="card ip-address-util-card">
                <h3>Address Utilization</h3>
                <div className="ip-donut" style={{ ['--ip-util' as string]: `${utilization * 3.6}deg` }}><b>{utilization}%</b><span>Used</span></div>
                <strong>{samePrefixIps.length} / {usable || '-'}</strong>
                <p>Usable Addresses</p>
                <small>Last updated: {formatDate(ip.lastUpdated)}</small>
              </section>
            </div>

            <div className="ip-detail-lower-grid">
              <section className="card ip-related-objects">
                <h3>Related Objects</h3>
                <IpRelatedRow icon={<Server size={15} />} label="Device" value={metrics.device?.name || '-'} sub={metrics.device?.role || metrics.device?.platform || ''} onClick={() => metrics.device && openInventoryDeviceDetail(metrics.device)} />
                <IpRelatedRow icon={<MapPin size={15} />} label="Location" value={linkedLocation} onClick={() => openInfrastructureByName('Locations', linkedLocation)} />
                <IpRelatedRow icon={<Database size={15} />} label="Rack" value={linkedRack} onClick={() => openInfrastructureByName('Racks', linkedRack)} />
                <IpRelatedRow icon={<Network size={15} />} label="VLAN" value={vlanLabel} onClick={() => metrics.vlanRecord && openInfrastructureDetail('VLANs', metrics.vlanRecord)} />
                <IpRelatedRow icon={<Layers size={15} />} label="Prefix" value={metrics.prefix || '-'} onClick={() => metrics.prefixRecord && openInfrastructureDetail('Prefixes', metrics.prefixRecord)} />
                <IpRelatedRow icon={<Building2 size={15} />} label="Site" value={ip.site || '-'} onClick={() => openInfrastructureByName('Sites', ip.site || '')} />
              </section>

              <section className="card ip-usage-card">
                <h3>Usage & Associations</h3>
                <IpUsageRow icon={<Network size={15} />} label="Interfaces" value={String(linkedInterfaces.length)} sub={linkedInterfaces.length ? linkedInterfaces.map((row) => row.name).join(', ') : 'No connected interface found'} />
                <IpUsageRow icon={<Tags size={15} />} label="NAT Entries" value="-" sub="No NAT inventory data" />
                <IpUsageRow icon={<Trash2 size={15} />} label="Firewall Rules" value="-" sub="No firewall rule inventory data" />
                <IpUsageRow icon={<Database size={15} />} label="Services" value="-" sub="No service inventory data" />
                <IpUsageRow icon={<CheckCircle2 size={15} />} label="Monitored" value={monitored ? 'Yes' : 'No'} sub={monitored ? 'Seen in inventory monitoring data' : 'No monitoring data recorded'} good={monitored} />
              </section>

              <section className="card ip-reach-card">
                <h3>Ping & Reachability</h3>
                <div className="ip-reach-kv">
                  <p><span>Status</span><b>{monitored ? 'Inventory seen' : 'No ping data'}</b></p>
                  <p><span>Response Time</span><b>-</b></p>
                  <p><span>Packet Loss</span><b>-</b></p>
                  <p><span>Uptime (24h)</span><b>-</b></p>
                </div>
                <div className="ip-no-ping-data">No ping history has been collected for this IP address.</div>
                <footer><span>Last checked: -</span><button type="button" className="plain-button" disabled>Run Ping Test</button></footer>
              </section>
            </div>

            <section className="card ip-activity-card">
              <div><h3>Recent Activity</h3><button type="button" className="plain-button">View Full History</button></div>
              <table>
                <thead><tr><th>Time</th><th>Activity</th><th>User</th><th>Details</th></tr></thead>
                <tbody>{recentRows.map((row) => <tr key={row.join(':')}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody>
              </table>
            </section>
      </div>
    </div>
  );
}

function IpRailItem({ icon, label, value, sub, good = false }: { icon: ReactElement; label: string; value: string; sub?: string; good?: boolean }) {
  return <div className="ip-rail-item"><span>{icon}</span><p>{label}<b className={good ? 'good-dot' : ''}>{value}</b>{sub && <small>{sub}</small>}</p></div>;
}

function IpRelatedRow({ icon, label, value, sub, onClick }: { icon: ReactElement; label: string; value: string; sub?: string; onClick: () => void }) {
  return <button type="button" className="ip-related-row" disabled={!value || value === '-'} onClick={onClick}><span>{icon}</span><p>{label}<b>{value}</b>{sub && <small>{sub}</small>}</p><ArrowLeft size={14} /></button>;
}

function IpUsageRow({ icon, label, value, sub, good = false }: { icon: ReactElement; label: string; value: string; sub: string; good?: boolean }) {
  return <div className="ip-usage-row"><span>{icon}</span><p>{label}<b className={good ? 'good-dot' : ''}>{value}</b><small>{sub}</small></p></div>;
}

function openInfrastructureByName(resource: InfrastructureResourceName, name: string) {
  if (!name || name === '-') return;
  const record = mergeManualAndDerived(resource, loadRecords(resource), deriveRecords(resource, [])).find((item) => sameText(resourceDisplayValue(resource, item), name) || sameText(item.name, name));
  if (record) openInfrastructureDetail(resource, record);
}

function PrefixDetailOverview({ prefix, records, devices }: { prefix: InfraRecord; records: InfraRecord[]; devices: InventoryDevice[] }) {
  const metrics = prefixMetrics(prefix, devices);
  const allIps = uniqueInfraRecords(mergeManualAndDerived('IP Addresses', loadRecords('IP Addresses'), deriveRecords('IP Addresses', devices)));
  const vlans = uniqueInfraRecords(mergeManualAndDerived('VLANs', loadRecords('VLANs'), deriveRecords('VLANs', devices)));
  const racks = uniqueInfraRecords(mergeManualAndDerived('Racks', loadRecords('Racks'), deriveRecords('Racks', devices)));
  const prefixIps = allIps.filter((ip) => ipAddressMetrics(ip, devices, [prefix], vlans).prefix === (prefix.prefix || prefix.name));
  const vlan = vlans.find((record) => sameText(record.vlanId, prefix.vlanId) || sameText(record.prefix, prefix.prefix));
  const relatedRacks = racks.filter((rack) => metrics.related.some((device) => sameText(device.rack, rack.name)));
  const free = Math.max(0, metrics.usable - metrics.used);
  const overlapCount = prefixOverlapCount(prefix, records);
  const allocation = [
    ['Assigned IPs', metrics.used, <Database size={18} />],
    ['Devices', metrics.related.length, <Server size={18} />],
    ['IP Pools', 0, <Layers size={18} />],
    ['Reserved IPs', prefixIps.filter((ip) => ip.status === 'Reserved' || ip.status === 'Planned').length, <Tags size={18} />],
  ];

  return (
    <div className="prefix-detail-shell">
      <section className="card prefix-overview-card">
        <h3>Prefix Overview</h3>
        <dl>
          <dt>Network</dt><dd>{String(prefix.prefix || prefix.name).split('/')[0]}</dd>
          <dt>Prefix Length</dt><dd>/{String(prefix.prefix || '').split('/')[1] || '-'} ({ipv4Netmask(prefix.prefix || '') || 'IPv6'})</dd>
          <dt>Usable IP Range</dt><dd>{metrics.range}</dd>
          <dt>Usable IPs</dt><dd>{metrics.usable.toLocaleString()}</dd>
          <dt>Used IPs</dt><dd>{metrics.used} <small>{free} free</small></dd>
          <dt>Utilization</dt><dd><span className="prefix-overview-meter"><i style={{ width: `${metrics.utilization}%` }} /></span><b>{metrics.utilization}%</b></dd>
          <dt>Status</dt><dd><span className={`infra-status ${prefix.status.toLowerCase()}`}>{prefix.status}</span></dd>
          <dt>Type</dt><dd>{prefix.tags ? <span className="prefix-title-chip">{prefix.tags}</span> : '-'}</dd>
          <dt>VRF</dt><dd><span className="prefix-vrf">{prefix.vrf || 'default'}</span></dd>
          <dt>IP Version</dt><dd>{metrics.version}</dd>
          <dt>Description</dt><dd>{prefix.description || prefix.name || '-'}</dd>
        </dl>
      </section>

      <div className="prefix-detail-main">
        <section className="card prefix-assignment-card">
          <h3>Details & Assignment</h3>
          <div className="prefix-assignment-grid">
            <div className="prefix-assignment-list">
              <PrefixAssignmentRow icon={<Building2 size={16} />} label="Site" value={prefix.site || '-'} onClick={() => openInfrastructureByName('Sites', prefix.site || '')} />
              <PrefixAssignmentRow icon={<MapPin size={16} />} label="Location" value={metrics.location || '-'} onClick={() => openInfrastructureByName('Locations', metrics.location)} />
              <PrefixAssignmentRow icon={<Network size={16} />} label="VLAN" value={vlan ? `${vlan.vlanId} (${vlan.name})` : prefix.vlanId || '-'} onClick={() => vlan && openInfrastructureDetail('VLANs', vlan)} />
              <PrefixAssignmentRow icon={<Database size={16} />} label="VRF" value={prefix.vrf || 'default'} onClick={() => openInfrastructureByName('VRFs', prefix.vrf || 'default')} />
              <PrefixAssignmentRow icon={<Tags size={16} />} label="Role" value={prefix.role || prefix.description || '-'} onClick={() => undefined} />
              <PrefixAssignmentRow icon={<Database size={16} />} label="Gateway" value={prefix.gateway || '-'} onClick={() => undefined} />
              <PrefixAssignmentRow icon={<Database size={16} />} label="DNS Servers" value={prefix.gateway || '-'} onClick={() => undefined} />
              <PrefixAssignmentRow icon={<Tags size={16} />} label="Tags" value={prefix.tags || '-'} onClick={() => undefined} />
            </div>
            <div className="prefix-detail-side-grid">
              <section className="prefix-util-card">
                <h3>Prefix Utilization</h3>
                <div className="ip-donut" style={{ ['--ip-util' as string]: `${metrics.utilization * 3.6}deg` }}><b>{metrics.utilization}%</b><span>Used</span></div>
                <p><span>Used IPs</span><b>{metrics.used}</b></p>
                <p><span>Free IPs</span><b>{free}</b></p>
                <p><span>Total IPs</span><b>{metrics.usable}</b></p>
              </section>
              <section className="prefix-allocation-card">
                <h3>Allocation Summary</h3>
                <div>{allocation.map(([label, value, icon]) => <span key={label as string}>{icon as ReactElement}<b>{value as number}</b><small>{label as string}</small></span>)}</div>
              </section>
            </div>
          </div>
        </section>

        <section className="card prefix-tabs-card">
          <nav className="ip-detail-tabs">
            {['IP Addresses', 'Subnets', 'IP Pools', 'Reservations', 'VRF Details', 'Change Log', 'Notes', 'Attachments'].map((tab, index) => <button key={tab} className={index === 0 ? 'active' : ''}>{tab}</button>)}
          </nav>
          <div className="prefix-ip-table-head">
            <h3>IP Addresses ({prefixIps.length})</h3>
            <div className="ip-search"><Search size={15} /><input placeholder="Search IP addresses..." readOnly /></div>
          </div>
          <div className="prefix-table-wrap">
            <table>
              <thead><tr><th>IP Address</th><th>Status</th><th>Assigned To</th><th>Device / Interface</th><th>MAC Address</th><th>Type</th><th>Last Seen</th><th>Actions</th></tr></thead>
              <tbody>
                {prefixIps.slice(0, 5).map((ip) => {
                  const ipMetrics = ipAddressMetrics(ip, devices, [prefix], vlans);
                  return (
                    <tr key={ip.id}>
                      <td>{ipOnly(ip.address || ip.name)}</td>
                      <td><span className={`infra-status ${ip.status.toLowerCase()}`}>{ip.status}</span></td>
                      <td>{ipMetrics.device?.name || ip.name || '-'}</td>
                      <td>{ipMetrics.device?.name || '-'}<small>{prefix.vlanId ? `Vlan${prefix.vlanId}` : ''}</small></td>
                      <td>{String((ipMetrics.device as InventoryDevice & { mac_address?: string | null })?.mac_address || '-')}</td>
                      <td>{ip.status === 'Reserved' ? 'Reserved' : 'Static'}</td>
                      <td>{formatDate(ip.lastUpdated)}</td>
                      <td className="infra-row-actions"><button className="row-action" onClick={() => openInfrastructureDetail('IP Addresses', ip)}>Details</button></td>
                    </tr>
                  );
                })}
                {!prefixIps.length && <tr><td colSpan={8} className="empty">No real IP address records are linked to this prefix.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="vlan-table-footer"><span>Showing {prefixIps.length ? 1 : 0} to {Math.min(5, prefixIps.length)} of {prefixIps.length} IP addresses</span><span>5 / page</span></div>
        </section>
      </div>

      <aside className="prefix-right-rail">
        <section className="card prefix-health-detail">
          <h3>Prefix Health</h3>
          <p><CheckCircle2 size={16} /><span>{prefix.status}<small>Updated {formatDate(prefix.lastUpdated)}</small></span></p>
          <p><CheckCircle2 size={16} /><span>{overlapCount ? 'Overlaps detected' : 'No Conflicts'}<small>{overlapCount ? `${overlapCount} overlapping prefix${overlapCount === 1 ? '' : 'es'}` : 'No overlaps detected'}</small></span></p>
          <p><Activity size={16} /><span>Inventory linked<small>{metrics.related.length} related device{metrics.related.length === 1 ? '' : 's'}</small></span></p>
        </section>
        <section className="card prefix-related-detail">
          <h3>Related Records</h3>
          <p><span>IP Addresses</span><b>{metrics.used}</b></p>
          <p><span>Devices</span><b>{metrics.related.length}</b></p>
          <p><span>VLANs</span><b>{vlan ? 1 : 0}</b></p>
          <p><span>Racks</span><b>{relatedRacks.length}</b></p>
          <p><span>IP Pools</span><b>0</b></p>
          <p><span>Reservations</span><b>{prefixIps.filter((ip) => ip.status === 'Reserved' || ip.status === 'Planned').length}</b></p>
        </section>
        <section className="card prefix-quick-actions">
          <h3>Quick Actions</h3>
          <button type="button"><Plus size={15} /> Add IP Address</button>
          <button type="button"><Search size={15} /> Scan for IPs</button>
        </section>
      </aside>
    </div>
  );
}

function PrefixAssignmentRow({ icon, label, value, onClick }: { icon: ReactElement; label: string; value: string; onClick: () => void }) {
  return <button type="button" className="prefix-assignment-row" disabled={!value || value === '-'} onClick={onClick}>{icon}<span>{label}<b>{value}</b></span><ArrowLeft size={14} /></button>;
}

function VrfDetailOverview({ vrf, devices }: { vrf: InfraRecord; devices: InventoryDevice[] }) {
  const prefixes = uniqueInfraRecords(mergeManualAndDerived('Prefixes', loadRecords('Prefixes'), deriveRecords('Prefixes', devices)));
  const vlans = uniqueInfraRecords(mergeManualAndDerived('VLANs', loadRecords('VLANs'), deriveRecords('VLANs', devices)));
  const ips = uniqueInfraRecords(mergeManualAndDerived('IP Addresses', loadRecords('IP Addresses'), deriveRecords('IP Addresses', devices)));
  const metrics = vrfMetrics(vrf, devices, prefixes, vlans, ips);
  const utilization = metrics.usableIps ? Math.round((metrics.usedIps / metrics.usableIps) * 100) : 0;
  const routeTargets = [
    ...metrics.rtImport.map((target) => ({ target, direction: 'Import' })),
    ...metrics.rtExport.map((target) => ({ target, direction: 'Export' })),
  ];
  const addressFamilies = [
    ['IPv4', metrics.ipv4Routes],
    ['IPv6', metrics.ipv6Routes],
  ] as const;
  const interfaceCount = metrics.relatedDevices.reduce((sum, device) => sum + (device.interfaces?.length || 0), 0);
  const typeLabel = addressFamilies.filter(([, count]) => count > 0).map(([label]) => label).join(' & ') || '-';

  return (
    <div className="vrf-detail-shell">
      <aside className="card vrf-profile-card">
        <div className={`vrf-profile-icon ${metrics.tone}`}><Network size={25} /></div>
        <h2>{metrics.name}</h2>
        <span className={`infra-status ${vrf.status.toLowerCase()}`}>{vrf.status}</span>
        <p>{vrf.description || 'No description has been recorded for this VRF.'}</p>
        <dl>
          <dt>RD (Route Distinguisher)</dt><dd>{metrics.routeDistinguisher || '-'}</dd>
          <dt>Type</dt><dd>{typeLabel}</dd>
          <dt>Site</dt><dd>{vrf.site || '-'}</dd>
          <dt>Tenant</dt><dd>{vrf.tenant || '-'}</dd>
          <dt>Last Updated</dt><dd>{formatDate(vrf.lastUpdated)}</dd>
          <dt>Tags</dt><dd>{vrf.tags || '-'}</dd>
        </dl>
      </aside>

      <div className="vrf-detail-main">
        <div className="vrf-detail-kpis">
          <VrfDetailKpi label="IPv4 Networks" value={metrics.ipv4Routes} sub={`${metrics.relatedPrefixes.filter((prefix) => !String(prefix.prefix || prefix.name).includes(':')).length} linked prefixes`} tone="blue" />
          <VrfDetailKpi label="IPv6 Networks" value={metrics.ipv6Routes} sub={`${metrics.relatedPrefixes.filter((prefix) => String(prefix.prefix || prefix.name).includes(':')).length} linked prefixes`} tone="purple" />
          <VrfDetailKpi label="Connected Networks" value={metrics.prefixCount} sub="Linked prefixes" tone="green" />
          <VrfDetailKpi label="Associated Devices" value={metrics.deviceCount} sub="Using this VRF" tone="orange" />
          <section className="card vrf-detail-util-mini">
            <div className="ip-donut" style={{ ['--ip-util' as string]: `${utilization * 3.6}deg` }}><b>{utilization}%</b><span>Used</span></div>
            <p>Utilization</p>
            <small>{metrics.usableIps ? `${metrics.usedIps.toLocaleString()} / ${metrics.usableIps.toLocaleString()} linked IPs` : 'No linked prefix capacity'}</small>
          </section>
        </div>

        <section className="card vrf-info-card">
          <div className="vrf-info-grid">
            <div>
              <h3>VRF Information</h3>
              <VrfDetailRow label="VRF Name" value={metrics.name} />
              <VrfDetailRow label="Status" value={<span className={`infra-status ${vrf.status.toLowerCase()}`}>{vrf.status}</span>} />
              <VrfDetailRow label="Type" value={typeLabel} />
              <VrfDetailRow label="RD (Route Distinguisher)" value={metrics.routeDistinguisher || '-'} />
              <VrfDetailRow label="Description" value={vrf.description || '-'} />
              <VrfDetailRow label="Site" value={vrf.site || '-'} />
              <VrfDetailRow label="Tenant" value={vrf.tenant || '-'} />
            </div>
            <div>
              <h3>Route Policy</h3>
              <VrfDetailRow label="Import Targets" value={metrics.rtImport.length || '-'} />
              <VrfDetailRow label="Export Targets" value={metrics.rtExport.length || '-'} />
              <VrfDetailRow label="RT Import" value={metrics.rtImport.length ? 'Recorded' : 'Not recorded'} />
              <VrfDetailRow label="RT Export" value={metrics.rtExport.length ? 'Recorded' : 'Not recorded'} />
              <VrfDetailRow label="IPv4 Address Family" value={<span className={`infra-status ${metrics.ipv4Routes ? 'active' : 'planned'}`}>{metrics.ipv4Routes ? 'Active' : 'Not recorded'}</span>} />
              <VrfDetailRow label="IPv6 Address Family" value={<span className={`infra-status ${metrics.ipv6Routes ? 'active' : 'planned'}`}>{metrics.ipv6Routes ? 'Active' : 'Not recorded'}</span>} />
            </div>
          </div>
        </section>

        <div className="vrf-detail-lower">
          <section className="card vrf-targets-card">
            <h3>Route Targets Summary</h3>
            <table>
              <thead><tr><th>Target</th><th>Direction</th><th>Status</th><th>Source</th></tr></thead>
              <tbody>
                {routeTargets.map((target) => (
                  <tr key={`${target.direction}-${target.target}`}>
                    <td>{target.target}</td>
                    <td>{target.direction}</td>
                    <td><span className={`infra-status ${vrf.status.toLowerCase()}`}>{vrf.status}</span></td>
                    <td>{vrf.source || 'manual'}</td>
                  </tr>
                ))}
                {!routeTargets.length && <tr><td colSpan={4} className="empty">No route targets have been recorded for this VRF.</td></tr>}
              </tbody>
            </table>
          </section>

          <section className="card vrf-activity-card">
            <h3>Record Metadata</h3>
            <table>
              <thead><tr><th>Field</th><th>Value</th><th>Source</th></tr></thead>
              <tbody>
                <tr><td>Last updated</td><td>{formatDate(vrf.lastUpdated)}</td><td>{vrf.source || 'manual'}</td></tr>
                <tr><td>Linked records</td><td>{metrics.prefixCount} prefixes / {metrics.relatedIps.length} IPs / {metrics.deviceCount} devices</td><td>Calculated</td></tr>
              </tbody>
            </table>
          </section>
        </div>
      </div>

      <aside className="vrf-detail-rail">
        <section className="card">
          <h3>Route Distinguisher</h3>
          <b>{metrics.routeDistinguisher || '-'}</b>
          <p>{metrics.routeDistinguisher ? 'Uniquely identifies routes for this VRF.' : 'No route distinguisher is recorded in this VRF record.'}</p>
          <small>Format: ASN:Number</small>
        </section>
        <section className="card">
          <h3>Address Families</h3>
          {addressFamilies.map(([label, count]) => (
            <p key={label}><span>{label}</span><b className={count ? 'good-dot' : ''}>{count ? 'Active' : 'Not recorded'}</b></p>
          ))}
        </section>
        <section className="card">
          <h3>VRF Scope</h3>
          <p><span>Site Scope</span><b>{vrf.site || '-'}</b></p>
          <p><span>Route Import</span><b>{metrics.rtImport.length ? 'Recorded' : 'Not recorded'}</b></p>
          <p><span>Route Export</span><b>{metrics.rtExport.length ? 'Recorded' : 'Not recorded'}</b></p>
        </section>
        <section className="card">
          <h3>Related Records</h3>
          <button type="button" onClick={() => metrics.relatedPrefixes[0] && openInfrastructureDetail('Prefixes', metrics.relatedPrefixes[0])}><Layers size={15} /><span>Prefixes</span><b>{metrics.prefixCount}</b></button>
          <button type="button" onClick={() => metrics.relatedIps[0] && openInfrastructureDetail('IP Addresses', metrics.relatedIps[0])}><Database size={15} /><span>IP Addresses</span><b>{metrics.relatedIps.length}</b></button>
          <button type="button" onClick={() => metrics.relatedVlans[0] && openInfrastructureDetail('VLANs', metrics.relatedVlans[0])}><Network size={15} /><span>VLANs</span><b>{metrics.vlanCount}</b></button>
          <button type="button" onClick={() => metrics.relatedDevices[0] && openInventoryDeviceDetail(metrics.relatedDevices[0])}><Server size={15} /><span>Devices</span><b>{metrics.deviceCount}</b></button>
          <p><span>Interfaces</span><b>{interfaceCount}</b></p>
        </section>
      </aside>
    </div>
  );
}

function VrfDetailKpi({ label, value, sub, tone }: { label: string; value: string | number; sub: string; tone: string }) {
  return (
    <section className={`card vrf-detail-kpi ${tone}`}>
      <p>{label}</p>
      <b>{value}</b>
      <small>{sub}</small>
      <i><em style={{ width: `${Math.min(100, numeric(value))}%` }} /></i>
    </section>
  );
}

function VrfDetailRow({ label, value }: { label: string; value: ReactElement | string | number }) {
  return <p><span>{label}</span><b>{value}</b></p>;
}

function VrfListWorkspace({
  records,
  devices,
  query,
  onQueryChange,
  onOpenVrf,
  onEditVrf,
  onDeleteVrf,
}: {
  records: InfraRecord[];
  devices: InventoryDevice[];
  query: string;
  onQueryChange: (value: string) => void;
  onOpenVrf: (record: InfraRecord) => void;
  onEditVrf: (record: InfraRecord) => void;
  onDeleteVrf: (record: InfraRecord) => void;
}) {
  const [statusFilter, setStatusFilter] = useState('All Statuses');
  const [siteFilter, setSiteFilter] = useState('All Sites');
  const prefixes = useMemo(() => uniqueInfraRecords(mergeManualAndDerived('Prefixes', loadRecords('Prefixes'), deriveRecords('Prefixes', devices))), [devices]);
  const vlans = useMemo(() => uniqueInfraRecords(mergeManualAndDerived('VLANs', loadRecords('VLANs'), deriveRecords('VLANs', devices))), [devices]);
  const ips = useMemo(() => uniqueInfraRecords(mergeManualAndDerived('IP Addresses', loadRecords('IP Addresses'), deriveRecords('IP Addresses', devices))), [devices]);

  const rows = records.map((record) => vrfMetrics(record, devices, prefixes, vlans, ips));
  const sites = ['All Sites', ...uniqueRackValues(records.map((record) => record.site))];
  const statuses = ['All Statuses', ...Array.from(new Set(records.map((record) => record.status))).sort()];
  const filteredRows = rows.filter((row) => {
    const haystack = [
      row.name,
      row.record.status,
      row.record.site,
      row.record.tenant,
      row.record.role,
      row.record.description,
      row.record.tags,
      row.routeDistinguisher,
      row.rtImport.join(' '),
      row.rtExport.join(' '),
    ].join(' ').toLowerCase();
    if (query.trim() && !haystack.includes(query.trim().toLowerCase())) return false;
    if (statusFilter !== 'All Statuses' && row.record.status !== statusFilter) return false;
    if (siteFilter !== 'All Sites' && row.record.site !== siteFilter) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  const activeCount = rows.filter((row) => row.record.status === 'Active').length;
  const routeDistinguishers = new Set(rows.map((row) => row.routeDistinguisher).filter(Boolean));
  const routeTargets = new Set(rows.flatMap((row) => [...row.rtImport, ...row.rtExport]).filter(Boolean));
  const totalUsed = rows.reduce((sum, row) => sum + row.usedIps, 0);
  const totalUsable = rows.reduce((sum, row) => sum + row.usableIps, 0);
  const utilization = totalUsable ? Math.round((totalUsed / totalUsable) * 100) : 0;
  const totalIpv4Routes = rows.reduce((sum, row) => sum + row.ipv4Routes, 0);
  const totalIpv6Routes = rows.reduce((sum, row) => sum + row.ipv6Routes, 0);

  return (
    <div className="vrf-workspace">
      <div className="vrf-kpis">
        <IpKpi icon={<Network size={18} />} tone="blue" label="Total VRFs" value={records.length} sub="Recorded routing domains" />
        <IpKpi icon={<CheckCircle2 size={18} />} tone="green" label="Active VRFs" value={activeCount} sub={`${records.length ? Math.round((activeCount / records.length) * 100) : 0}% of total`} />
        <IpKpi icon={<Layers size={18} />} tone="purple" label="Route Distinguishers" value={routeDistinguishers.size} sub="Recorded RDs" />
        <IpKpi icon={<Tags size={18} />} tone="orange" label="Route Targets" value={routeTargets.size} sub="Recorded import / export RTs" />
        <IpKpi icon={<Activity size={18} />} tone="cyan" label="VRF Utilization" value={`${utilization}%`} sub={totalUsable ? `${totalUsed.toLocaleString()} / ${totalUsable.toLocaleString()} linked IPs` : 'No linked prefix capacity'} />
      </div>

      <section className="card vrf-table-card">
        <div className="vrf-table-head">
          <div>
            <h2>VRFs ({filteredRows.length})</h2>
            <p>{totalIpv4Routes.toLocaleString()} IPv4 networks / {totalIpv6Routes.toLocaleString()} IPv6 networks from linked prefixes</p>
          </div>
          <div className="vrf-toolbar">
            <div className="ip-search"><Search size={15} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search VRFs..." /></div>
            <select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>{sites.map((site) => <option key={site}>{site}</option>)}</select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select>
          </div>
        </div>
        <div className="vrf-table-wrap">
          <table>
            <thead>
              <tr>
                <th>VRF Name</th>
                <th>Status</th>
                <th>RD (Route Distinguisher)</th>
                <th>RT Import</th>
                <th>RT Export</th>
                <th>IPv4 Networks</th>
                <th>IPv6 Networks</th>
                <th>Description</th>
                <th>Last Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.record.id}>
                  <td>
                    <div className="vrf-name-cell">
                      <span className={`vrf-avatar ${row.tone}`}><Network size={18} /></span>
                      <div>
                        <button type="button" className="relationship-link" onClick={() => onOpenVrf(row.record)}>{row.name}</button>
                        {row.label && <small className={`vrf-tag ${row.tone}`}>{row.label}</small>}
                      </div>
                    </div>
                  </td>
                  <td><span className={`infra-status ${row.record.status.toLowerCase()}`}>{row.record.status}</span></td>
                  <td>{row.routeDistinguisher || '-'}</td>
                  <td>{row.rtImport.length ? row.rtImport.join(', ') : '-'}</td>
                  <td>{row.rtExport.length ? row.rtExport.join(', ') : '-'}</td>
                  <td>{row.ipv4Routes.toLocaleString()}</td>
                  <td>{row.ipv6Routes.toLocaleString()}</td>
                  <td><span className="vrf-description">{row.record.description || '-'}</span><small>{row.deviceCount} devices / {row.prefixCount} prefixes / {row.vlanCount} VLANs</small></td>
                  <td>{formatDate(row.record.lastUpdated)}</td>
                  <td className="infra-row-actions">
                    <button className="row-action" onClick={() => onOpenVrf(row.record)}>Details</button>
                    <button className="row-action" onClick={() => onEditVrf(row.record)}>Edit</button>
                    <button className="row-action danger" onClick={() => onDeleteVrf(row.record)}>Delete</button>
                  </td>
                </tr>
              ))}
              {!filteredRows.length && <tr><td colSpan={10} className="empty">No VRFs matched.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="vlan-table-footer"><span>Showing {filteredRows.length ? 1 : 0} to {filteredRows.length} of {records.length} VRFs</span><span>10 / page</span></div>
      </section>
    </div>
  );
}

function vrfMetrics(record: InfraRecord, devices: InventoryDevice[], prefixes: InfraRecord[], vlans: InfraRecord[], ips: InfraRecord[]) {
  const name = vrfName(record);
  const sameVrf = (value: unknown) => vrfMatches(name, value);
  const sameSite = (item: InfraRecord | InventoryDevice) => {
    const itemSite = 'site' in item && typeof item.site === 'object' ? item.site?.name : (item as InfraRecord).site || siteOf(item as InventoryDevice);
    return !record.site || !itemSite || sameText(record.site, itemSite);
  };
  const relatedPrefixes = uniqueInfraRecords(prefixes.filter((prefix) => sameVrf(prefix.vrf || 'default') && sameSite(prefix)));
  const relatedVlans = uniqueInfraRecords(vlans.filter((vlan) => sameVrf(vlan.vrf || 'default') && sameSite(vlan)));
  const relatedIps = uniqueInfraRecords(ips.filter((ip) => {
    const metrics = ipAddressMetrics(ip, devices, prefixes, vlans);
    return sameVrf(metrics.vrf || 'default') && sameSite(ip);
  }));
  const relatedDevices = uniqueDevices([
    ...relatedDevicesFor('VRFs', record, devices),
    ...relatedPrefixes.flatMap((prefix) => relatedDevicesFor('Prefixes', prefix, devices)),
    ...relatedVlans.flatMap((vlan) => relatedDevicesFor('VLANs', vlan, devices)),
    ...relatedIps.flatMap((ip) => relatedDevicesFor('IP Addresses', ip, devices)),
  ]).filter((device) => sameSite(device));
  const usableIps = relatedPrefixes.reduce((sum, prefix) => sum + prefixMetrics(prefix, devices).usable, 0);
  const usedIps = relatedIps.length || relatedPrefixes.reduce((sum, prefix) => sum + prefixMetrics(prefix, devices).used, 0);
  const routeDistinguisher = vrfRouteDistinguisher(record);
  const rtImport = vrfRouteTargets(record, 'import');
  const rtExport = vrfRouteTargets(record, 'export');
  const label = record.tags?.split(',').map((tag) => tag.trim()).find(Boolean) || record.role || record.tenant || '';
  const tone = vrfTone(name, label);
  return {
    record,
    name,
    label,
    tone,
    routeDistinguisher,
    rtImport,
    rtExport,
    ipv4Routes: relatedPrefixes.filter((prefix) => !String(prefix.prefix || prefix.name).includes(':')).length,
    ipv6Routes: relatedPrefixes.filter((prefix) => String(prefix.prefix || prefix.name).includes(':')).length,
    usableIps,
    usedIps,
    deviceCount: relatedDevices.length,
    prefixCount: relatedPrefixes.length,
    vlanCount: relatedVlans.length,
    relatedDevices,
    relatedPrefixes,
    relatedVlans,
    relatedIps,
  };
}

function vrfName(record: InfraRecord) {
  return String(record.name || record.vrf || 'default').trim() || 'default';
}

function vrfMatches(vrfNameValue: string, value: unknown) {
  const candidate = String(value || '').trim() || 'default';
  return sameText(candidate, vrfNameValue);
}

function vrfRouteDistinguisher(record: InfraRecord) {
  const text = vrfSearchText(record);
  return text.match(/\brd\s*[:=]\s*([0-9]+:[0-9]+)\b/i)?.[1] || '';
}

function vrfRouteTargets(record: InfraRecord, mode: 'import' | 'export') {
  const text = vrfSearchText(record);
  const patterns = mode === 'import'
    ? [/\brt[-_\s]?import\s*[:=]\s*([0-9]+:[0-9]+)/gi, /\bimport\s*[:=]\s*([0-9]+:[0-9]+)/gi]
    : [/\brt[-_\s]?export\s*[:=]\s*([0-9]+:[0-9]+)/gi, /\bexport\s*[:=]\s*([0-9]+:[0-9]+)/gi];
  const values = patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1]));
  return [...new Set(values)];
}

function vrfSearchText(record: InfraRecord) {
  return [record.description, record.tags, record.role, record.tenant].filter(Boolean).join(' ');
}

function vrfTone(name: string, label: string) {
  const text = `${name} ${label}`.toLowerCase();
  if (text.includes('guest')) return 'orange';
  if (text.includes('mgmt') || text.includes('management')) return 'purple';
  if (text.includes('voice')) return 'cyan';
  if (text.includes('default')) return 'blue';
  return 'green';
}

function PrefixListWorkspace({
  records,
  devices,
  query,
  onQueryChange,
  onOpenPrefix,
  onEditPrefix,
  onDeletePrefix,
}: {
  records: InfraRecord[];
  devices: InventoryDevice[];
  query: string;
  onQueryChange: (value: string) => void;
  onOpenPrefix: (record: InfraRecord) => void;
  onEditPrefix: (record: InfraRecord) => void;
  onDeletePrefix: (record: InfraRecord) => void;
}) {
  const [statusFilter, setStatusFilter] = useState('All Statuses');
  const rows = records.filter((record) => {
    const metrics = prefixMetrics(record, devices);
    const haystack = [record.prefix, record.name, record.description, record.vrf, record.site, metrics.location, record.status].join(' ').toLowerCase();
    if (query.trim() && !haystack.includes(query.trim().toLowerCase())) return false;
    if (statusFilter !== 'All Statuses' && record.status !== statusFilter) return false;
    return true;
  }).sort((a, b) => (a.prefix || a.name).localeCompare(b.prefix || b.name, undefined, { numeric: true }));
  const totalUsable = records.reduce((sum, record) => sum + prefixMetrics(record, devices).usable, 0);
  const totalUsed = records.reduce((sum, record) => sum + prefixMetrics(record, devices).used, 0);
  const utilization = totalUsable ? Math.round((totalUsed / totalUsable) * 100) : 0;
  const vrfs = Array.from(new Set(records.map((record) => record.vrf || 'default'))).filter(Boolean);
  const overlappingPairs = prefixOverlapPairs(records);
  const health = {
    active: records.filter((record) => record.status === 'Active').length,
    deprecated: records.filter((record) => record.status === 'Deprecated').length,
    inactive: records.filter((record) => record.status === 'Offline' || record.status === 'Planned').length,
    overlapping: overlappingPairs.length,
  };
  const topUtilized = [...records].sort((a, b) => prefixMetrics(b, devices).utilization - prefixMetrics(a, devices).utilization).slice(0, 3);

  return (
    <div className="prefix-workspace">
      <div className="prefix-kpis">
        <IpKpi icon={<Layers size={18} />} tone="blue" label="Total Prefixes" value={records.length} sub="Across all VRFs" />
        <IpKpi icon={<CheckCircle2 size={18} />} tone="green" label="Total IP Addresses" value={totalUsable.toLocaleString()} sub="Usable addresses" />
        <IpKpi icon={<Network size={18} />} tone="purple" label="IP Utilization" value={`${utilization}%`} sub={`${totalUsed.toLocaleString()} / ${totalUsable.toLocaleString()} used`} />
        <IpKpi icon={<Tags size={18} />} tone="orange" label="VRFs" value={vrfs.length} sub="Virtual routing tables" />
        <IpKpi icon={<CheckCircle2 size={18} />} tone="cyan" label="Overlapping" value={health.overlapping} sub={health.overlapping ? `${health.overlapping} overlap${health.overlapping === 1 ? '' : 's'} detected` : 'No conflicts detected'} />
      </div>

      <section className="card prefix-table-card">
        <div className="prefix-table-head">
          <h2>Prefixes ({rows.length})</h2>
          <div>
            <div className="ip-search"><Search size={15} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search prefixes..." /></div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {['All Statuses', ...Array.from(new Set(records.map((record) => record.status))).sort()].map((status) => <option key={status}>{status}</option>)}
            </select>
          </div>
        </div>
        <div className="prefix-table-wrap">
          <table>
            <thead><tr><th>Prefix / Mask</th><th>Description</th><th>VRF</th><th>Site</th><th>Location</th><th>IP Version</th><th>Usable IPs</th><th>Used IPs</th><th>Utilization</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {rows.map((record, index) => {
                const metrics = prefixMetrics(record, devices);
                return (
                  <tr key={record.id}>
                    <td>
                      <div className="prefix-main-cell"><span>{index + 1}</span><button type="button" className="relationship-link" onClick={() => onOpenPrefix(record)}>{record.prefix || record.name}</button></div>
                      <small>{metrics.range}</small>
                      {record.tags && <em>{record.tags}</em>}
                    </td>
                    <td>{record.description || record.name || '-'}</td>
                    <td><span className="prefix-vrf">{record.vrf || 'default'}</span></td>
                    <td>{record.site || '-'}</td>
                    <td>{metrics.location || '-'}</td>
                    <td>{metrics.version}</td>
                    <td>{metrics.usable.toLocaleString()}<small>{metrics.usableRangeLabel}</small></td>
                    <td>{metrics.used}<small>IPs</small></td>
                    <td><div className="prefix-meter"><b>{metrics.utilization}%</b><i><span style={{ width: `${metrics.utilization}%` }} /></i></div></td>
                    <td><span className={`infra-status ${record.status.toLowerCase()}`}>{record.status}</span></td>
                    <td className="infra-row-actions">
                      <button className="row-action" onClick={() => onOpenPrefix(record)}>Details</button>
                      <button className="row-action" onClick={() => onEditPrefix(record)}>Edit</button>
                      <button className="row-action danger" onClick={() => onDeletePrefix(record)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={11} className="empty">No prefixes matched.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="vlan-table-footer"><span>Showing {rows.length ? 1 : 0} to {rows.length} of {records.length} prefixes</span><span>10 / page</span></div>
      </section>

      <div className="prefix-insights">
        <section className="card prefix-insight-card">
          <h3>Top Prefixes by Utilization</h3>
          {topUtilized.map((record) => {
            const metrics = prefixMetrics(record, devices);
            return (
              <p key={record.id}><span>{record.prefix || record.name}</span><b>{metrics.utilization}%</b><small>{metrics.used} / {metrics.usable.toLocaleString()} IPs</small><i><em style={{ width: `${metrics.utilization}%` }} /></i></p>
            );
          })}
          <button type="button">View all utilization details <ArrowLeft size={14} /></button>
        </section>
        <section className="card prefix-insight-card prefix-vrf-card">
          <h3>VRF Distribution</h3>
          <div className="prefix-donut"><b>{records.length}</b><span>Prefixes</span></div>
          <div>{vrfs.map((vrf) => {
            const count = records.filter((record) => (record.vrf || 'default') === vrf).length;
            return <p key={vrf}><span>{vrf}</span><b>{count} ({records.length ? Math.round((count / records.length) * 100) : 0}%)</b></p>;
          })}</div>
          <button type="button">View VRF details <ArrowLeft size={14} /></button>
        </section>
        <section className="card prefix-insight-card prefix-health-card">
          <h3>Prefix Health</h3>
          {[
            ['Active', health.active, 'green'],
            ['Deprecated', health.deprecated, 'orange'],
            ['Inactive', health.inactive, 'red'],
            ['Overlapping', health.overlapping, 'purple'],
          ].map(([label, count, tone]) => (
            <p key={label as string}><span><i className={tone as string} />{label}</span><b>{count}</b><small>{records.length ? Math.round((Number(count) / records.length) * 100) : 0}%</small></p>
          ))}
          <button type="button">View health report <ArrowLeft size={14} /></button>
        </section>
      </div>
    </div>
  );
}

function prefixMetrics(record: InfraRecord, devices: InventoryDevice[]) {
  const prefix = record.prefix || record.name || '';
  const version = prefix.includes(':') ? 'IPv6' : 'IPv4';
  const related = relatedDevicesFor('Prefixes', record, devices);
  const usedIps = new Set<string>();
  related.forEach((device) => deviceIps(device).forEach((row) => {
    if (version === 'IPv4' && ipv4Prefix(row.address) === prefix) usedIps.add(ipOnly(row.address));
  }));
  const usable = prefixUsableIps(prefix);
  const used = usedIps.size;
  const utilization = usable ? Math.min(100, Math.round((used / usable) * 100)) : Math.min(100, numeric(record.utilization));
  const location = related.find((device) => device.location)?.location || record.location || '';
  const network = prefix.split('/')[0];
  const usableRange = version === 'IPv4' ? ipv4UsableRange(prefix) : '';
  const range = version === 'IPv4' ? (usableRange || `${network} - ${ipv4Broadcast(prefix) || network}`) : `${network} - ${prefix}`;
  const usableRangeLabel = version === 'IPv4' ? (usableRange || '-') : '/64 subnets';
  return { version, related, used, usable, utilization, location, range, usableRangeLabel };
}

function prefixUsableIps(prefix: string) {
  if (prefix.includes(':')) {
    const cidr = Number(prefix.split('/')[1]);
    if (!Number.isFinite(cidr)) return 0;
    if (cidr <= 48) return 65536;
    if (cidr <= 64) return Math.max(1, Math.pow(2, 64 - cidr));
    return 1;
  }
  return ipv4UsableHosts(prefix) || 0;
}

function IpAddressListWorkspace({
  records,
  devices,
  query,
  onQueryChange,
  onOpenIp,
  onEditIp,
  onDeleteIp,
}: {
  records: InfraRecord[];
  devices: InventoryDevice[];
  query: string;
  onQueryChange: (value: string) => void;
  onOpenIp: (record: InfraRecord) => void;
  onEditIp: (record: InfraRecord) => void;
  onDeleteIp: (record: InfraRecord) => void;
}) {
  const [siteFilter, setSiteFilter] = useState('All Sites');
  const [statusFilter, setStatusFilter] = useState('All Statuses');
  const [vrfFilter, setVrfFilter] = useState('All VRFs');
  const [vlanFilter, setVlanFilter] = useState('All VLANs');
  const [activeIpId, setActiveIpId] = useState('');
  const prefixes = useMemo(() => uniqueInfraRecords(mergeManualAndDerived('Prefixes', loadRecords('Prefixes'), deriveRecords('Prefixes', devices))), [devices]);
  const vlans = useMemo(() => uniqueInfraRecords(mergeManualAndDerived('VLANs', loadRecords('VLANs'), deriveRecords('VLANs', devices))), [devices]);
  const sites = ['All Sites', ...Array.from(new Set(records.map((record) => record.site).filter(Boolean) as string[])).sort()];
  const statuses = ['All Statuses', ...Array.from(new Set(records.map((record) => record.status))).sort()];
  const vrfs = ['All VRFs', ...Array.from(new Set(records.map((record) => ipAddressMetrics(record, devices, prefixes, vlans).vrf).filter(Boolean))).sort()];
  const vlanIds = ['All VLANs', ...Array.from(new Set(records.map((record) => ipAddressMetrics(record, devices, prefixes, vlans).vlan).filter(Boolean))).sort((a, b) => Number(a) - Number(b))];
  const rows = records.filter((record) => {
    const metrics = ipAddressMetrics(record, devices, prefixes, vlans);
    const haystack = [record.address, record.name, record.site, record.location, record.rack, record.role, record.status, metrics.device?.name, metrics.vlan, metrics.vrf, metrics.prefix].join(' ').toLowerCase();
    if (query.trim() && !haystack.includes(query.trim().toLowerCase())) return false;
    if (siteFilter !== 'All Sites' && record.site !== siteFilter) return false;
    if (statusFilter !== 'All Statuses' && record.status !== statusFilter) return false;
    if (vrfFilter !== 'All VRFs' && metrics.vrf !== vrfFilter) return false;
    if (vlanFilter !== 'All VLANs' && metrics.vlan !== vlanFilter) return false;
    return true;
  }).sort((a, b) => ipOnly(a.address || a.name).localeCompare(ipOnly(b.address || b.name), undefined, { numeric: true }));

  useEffect(() => {
    if (!rows.length) {
      setActiveIpId('');
      return;
    }
    if (!rows.some((record) => record.id === activeIpId)) setActiveIpId(rows[0].id);
  }, [activeIpId, rows]);

  const activeIp = rows.find((record) => record.id === activeIpId) || rows[0] || records[0] || null;
  const activeCount = records.filter((record) => record.status === 'Active').length;
  const reservedCount = records.filter((record) => record.status === 'Reserved' || record.status === 'Planned').length;
  const linkedDeviceCount = new Set(records.flatMap((record) => record.relatedDeviceIds || [])).size;
  const uniquePrefixes = uniqueInfraRecords(prefixes.filter((prefix) => records.some((record) => ipAddressMetrics(record, devices, prefixes, vlans).prefix === prefix.prefix)));
  const totalUsable = uniquePrefixes.reduce((sum, prefix) => sum + (ipv4UsableHosts(prefix.prefix || '') || 0), 0);
  const availableIps = Math.max(0, totalUsable - records.length);

  return (
    <div className="ip-workspace">
      <div className="ip-kpis">
        <IpKpi icon={<Database size={18} />} tone="blue" label="Total IPs" value={records.length} sub="All discovered and assigned" />
        <IpKpi icon={<Activity size={18} />} tone="green" label="Active IPs" value={activeCount} sub="Reachable or assigned" />
        <IpKpi icon={<Tags size={18} />} tone="purple" label="Reserved IPs" value={reservedCount} sub="Reserved / planned" />
        <IpKpi icon={<CheckCircle2 size={18} />} tone="cyan" label="Available IPs" value={availableIps} sub="Calculated from prefixes" />
        <IpKpi icon={<Server size={18} />} tone="orange" label="Linked Devices" value={linkedDeviceCount} sub="Inventory device links" />
        <IpKpi icon={<Layers size={18} />} tone="purple" label="Prefixes Covered" value={uniquePrefixes.length} sub={`across ${vrfs.length - 1 || 0} VRFs`} />
      </div>

      <section className="card ip-filter-card">
        <label>Site<select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>{sites.map((site) => <option key={site}>{site}</option>)}</select></label>
        <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{statuses.map((status) => <option key={status}>{status}</option>)}</select></label>
        <label>VRF<select value={vrfFilter} onChange={(event) => setVrfFilter(event.target.value)}>{vrfs.map((vrf) => <option key={vrf}>{vrf}</option>)}</select></label>
        <label>VLAN<select value={vlanFilter} onChange={(event) => setVlanFilter(event.target.value)}>{vlanIds.map((vlan) => <option key={vlan}>{vlan}</option>)}</select></label>
        <div className="ip-search"><Search size={15} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search IP, hostname, device, MAC..." /></div>
      </section>

      <div className="ip-main-grid">
        <section className="card ip-table-card">
          <div className="ip-table-wrap">
            <table>
              <thead><tr><th>IP Address</th><th>Hostname / Device</th><th>Site</th><th>Location</th><th>VLAN</th><th>Prefix</th><th>VRF</th><th>Status</th><th>Last Updated</th><th>Actions</th></tr></thead>
              <tbody>
                {rows.map((record) => {
                  const metrics = ipAddressMetrics(record, devices, prefixes, vlans);
                  const active = activeIp?.id === record.id;
                  return (
                    <tr key={record.id} className={active ? 'active' : ''} onClick={() => setActiveIpId(record.id)}>
                      <td><span className="ip-dot" />{ipOnly(record.address || record.name)}</td>
                      <td><button type="button" className="relationship-link" onClick={(event) => { event.stopPropagation(); metrics.device ? openInventoryDeviceDetail(metrics.device) : onOpenIp(record); }}>{metrics.device?.name || record.name || '-'}</button></td>
                      <td>{record.site || '-'}</td>
                      <td>{record.location || '-'}</td>
                      <td>{metrics.vlan || '-'}</td>
                      <td>{metrics.prefix || '-'}</td>
                      <td>{metrics.vrf || '-'}</td>
                      <td><span className={`infra-status ${record.status.toLowerCase()}`}>{record.status}</span></td>
                      <td>{formatDate(record.lastUpdated)}</td>
                      <td className="infra-row-actions">
                        <button className="row-action" onClick={(event) => { event.stopPropagation(); onOpenIp(record); }}>Details</button>
                        <button className="row-action" onClick={(event) => { event.stopPropagation(); onEditIp(record); }}>Edit</button>
                        <button className="row-action danger" onClick={(event) => { event.stopPropagation(); onDeleteIp(record); }}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={10} className="empty">No IP addresses matched.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="vlan-table-footer"><span>Showing {rows.length ? 1 : 0} to {rows.length} of {records.length} results</span><span>Rows per page: {rows.length || 0}</span></div>
        </section>
        <IpAddressSidePanel ip={activeIp} records={records} devices={devices} prefixes={prefixes} vlans={vlans} onOpenIp={onOpenIp} onClose={() => setActiveIpId('')} />
      </div>
    </div>
  );
}

function IpKpi({ icon, tone, label, value, sub }: { icon: ReactElement; tone: string; label: string; value: string | number; sub: string }) {
  return (
    <section className={`ip-kpi ${tone}`}>
      <span>{icon}</span>
      <p>{label}</p>
      <b>{value}</b>
      <small>{sub}</small>
    </section>
  );
}

function IpAddressSidePanel({ ip, records, devices, prefixes, vlans, onOpenIp, onClose }: { ip: InfraRecord | null; records: InfraRecord[]; devices: InventoryDevice[]; prefixes: InfraRecord[]; vlans: InfraRecord[]; onOpenIp: (record: InfraRecord) => void; onClose: () => void }) {
  if (!ip) return <aside className="card ip-side-panel"><p className="empty">Select an IP address to inspect.</p></aside>;
  const metrics = ipAddressMetrics(ip, devices, prefixes, vlans);
  const samePrefixIps = records.filter((record) => metrics.prefix && ipAddressMetrics(record, devices, prefixes, vlans).prefix === metrics.prefix);
  const usable = ipv4UsableHosts(metrics.prefix || '') || 0;
  const utilization = usable ? Math.min(100, Math.round((samePrefixIps.length / usable) * 100)) : 0;
  return (
    <aside className="card ip-side-panel">
      <button className="vlan-panel-close" type="button" onClick={onClose}><X size={15} /></button>
      <span className={`infra-status ${ip.status.toLowerCase()}`}>{ip.status}</span>
      <h2>{ipOnly(ip.address || ip.name)}</h2>
      <button type="button" className="vlan-detail-button" onClick={() => onOpenIp(ip)}>IP details</button>
      <dl>
        <dt>Hostname</dt><dd>{metrics.device?.name || ip.name || '-'}</dd>
        <dt>Site</dt><dd>{ip.site || '-'}</dd>
        <dt>Location</dt><dd>{ip.location || '-'}</dd>
        <dt>VLAN</dt><dd>{metrics.vlan || '-'}</dd>
        <dt>Prefix</dt><dd>{metrics.prefix || '-'}</dd>
        <dt>Gateway</dt><dd>{metrics.prefixRecord?.gateway || '-'}</dd>
        <dt>Role</dt><dd>{ip.role || '-'}</dd>
        <dt>Device Type</dt><dd>{metrics.device?.role || metrics.device?.platform || '-'}</dd>
        <dt>Rack</dt><dd>{ip.rack || metrics.device?.rack || '-'}</dd>
        <dt>VRF</dt><dd>{metrics.vrf || '-'}</dd>
        <dt>Last Seen</dt><dd>{formatDate(ip.lastUpdated)}</dd>
      </dl>
      <section className="ip-util-card">
        <h3>IP Utilization</h3>
        <i><em style={{ width: `${utilization}%` }} /></i>
        <p><span>{utilization}% used ({samePrefixIps.length} of {usable || '-'} usable IPs)</span><b>{usable || '-'} total</b></p>
      </section>
      <div className="ip-linked-grid">
        <button type="button" disabled={!metrics.device} onClick={() => metrics.device && openInventoryDeviceDetail(metrics.device)}>
          <Server size={17} />
          <span>Linked Device</span>
          <b>{metrics.device?.name || '-'}</b>
          <small>{metrics.device?.role || metrics.device?.platform || '-'}</small>
        </button>
        <button type="button" disabled={!metrics.prefixRecord} onClick={() => metrics.prefixRecord && openInfrastructureDetail('Prefixes', metrics.prefixRecord)}>
          <Layers size={17} />
          <span>Prefix</span>
          <b>{metrics.prefix || '-'}</b>
          <small>{samePrefixIps.length} addresses</small>
        </button>
      </div>
    </aside>
  );
}

function ipAddressMetrics(record: InfraRecord, devices: InventoryDevice[], prefixes: InfraRecord[], vlans: InfraRecord[]) {
  const address = ipOnly(record.address || record.name);
  const linkedDevice = relatedDevicesFor('IP Addresses', record, devices)[0] || devices.find((device) => device.management_ip && ipOnly(device.management_ip) === address);
  const prefix = record.prefix || ipv4Prefix(record.address || record.name);
  const prefixRecord = prefixes.find((item) => sameText(item.prefix, prefix));
  const vlan = record.vlanId || prefixRecord?.vlanId || linkedDevice?.vlan ? String(record.vlanId || prefixRecord?.vlanId || linkedDevice?.vlan || '') : '';
  const vlanRecord = vlans.find((item) => (vlan && sameText(item.vlanId, vlan)) || (prefix && sameText(item.prefix, prefix)));
  return {
    device: linkedDevice,
    prefix,
    prefixRecord,
    vlan: vlan || vlanRecord?.vlanId || '',
    vlanRecord,
    vrf: record.vrf || prefixRecord?.vrf || vlanRecord?.vrf || '',
  };
}

function VlanListWorkspace({
  records,
  devices,
  query,
  onQueryChange,
  onOpenVlan,
  onEditVlan,
  onDeleteVlan,
}: {
  records: InfraRecord[];
  devices: InventoryDevice[];
  query: string;
  onQueryChange: (value: string) => void;
  onOpenVlan: (vlan: InfraRecord) => void;
  onEditVlan: (vlan: InfraRecord) => void;
  onDeleteVlan: (vlan: InfraRecord) => void;
}) {
  const [siteFilter, setSiteFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [scopeFilter, setScopeFilter] = useState('all');
  const [vrfFilter, setVrfFilter] = useState('all');
  const [activeVlanId, setActiveVlanId] = useState('');
  const sites = uniqueRackValues(records.map((record) => record.site));
  const scopes = uniqueRackValues(records.map((record) => record.role || record.tags));
  const vrfs = uniqueRackValues(records.map((record) => record.vrf));
  const rows = records.filter((record) => {
    const haystack = [record.vlanId, record.name, record.site, record.role, record.vrf, record.prefix, record.gateway, record.description].join(' ').toLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLowerCase()))
      && (siteFilter === 'all' || record.site === siteFilter)
      && (statusFilter === 'all' || record.status === statusFilter)
      && (scopeFilter === 'all' || record.role === scopeFilter || record.tags === scopeFilter)
      && (vrfFilter === 'all' || record.vrf === vrfFilter);
  }).sort((a, b) => (numeric(a.vlanId) - numeric(b.vlanId)) || a.name.localeCompare(b.name));
  useEffect(() => {
    if (!rows.length) {
      setActiveVlanId('');
      return;
    }
    if (!rows.some((record) => record.id === activeVlanId)) setActiveVlanId(rows[0].id);
  }, [activeVlanId, rows]);
  const activeVlan = rows.find((record) => record.id === activeVlanId) || rows[0] || records[0] || null;
  const allAssignedDevices = uniqueDevices(records.flatMap((record) => relatedDevicesFor('VLANs', record, devices)));
  const allPrefixes = uniqueInfraRecords(records.flatMap((record) => vlanLinkedPrefixes(record, devices)));
  const activeCount = records.filter((record) => record.status === 'Active').length;
  const reservedCount = records.filter((record) => record.status === 'Reserved').length;
  const sitesCovered = uniqueRackValues(records.map((record) => record.site)).length;

  const exportVlans = () => {
    exportRowsCsv(
      'vlans.csv',
      ['VLAN ID', 'Name', 'Site', 'Scope', 'VRF', 'Prefix / Subnet', 'Devices', 'Racks', 'Status', 'Last Updated'],
      rows.map((record) => {
        const metrics = vlanRowMetrics(record, devices);
        return [
          record.vlanId || '',
          record.name,
          record.site || '',
          vlanScope(record),
          record.vrf || '',
          metrics.prefix,
          metrics.devices.length,
          metrics.racks,
          record.status,
          formatDate(record.lastUpdated),
        ];
      }),
    );
  };

  return (
    <div className="vlan-workspace">
      <div className="vlan-kpis">
        <VlanKpi icon={<Network size={18} />} tone="blue" label="Total VLANs" value={records.length} sub="All configured VLANs" />
        <VlanKpi icon={<CheckCircle2 size={18} />} tone="green" label="Active VLANs" value={activeCount} sub={`${records.length ? Math.round((activeCount / records.length) * 1000) / 10 : 0}% of total`} />
        <VlanKpi icon={<Tags size={18} />} tone="orange" label="Reserved VLANs" value={reservedCount} sub={`${records.length ? Math.round((reservedCount / records.length) * 1000) / 10 : 0}% of total`} />
        <VlanKpi icon={<Building2 size={18} />} tone="purple" label="Sites Covered" value={sitesCovered} sub="Unique sites" />
        <VlanKpi icon={<Database size={18} />} tone="cyan" label="Assigned Devices" value={allAssignedDevices.length} sub="Across all VLANs" />
        <VlanKpi icon={<Layers size={18} />} tone="blue" label="Prefixes Linked" value={allPrefixes.length} sub="IPv4 prefixes" />
      </div>
      <section className="card vlan-filter-card">
        <label>Site<select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option value="all">All Sites</option>{sites.map((site) => <option key={site} value={site}>{site}</option>)}</select></label>
        <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All Statuses</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
        <label>Scope<select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)}><option value="all">All Scopes</option>{scopes.map((scope) => <option key={scope} value={scope}>{scope}</option>)}</select></label>
        <label>VRF<select value={vrfFilter} onChange={(event) => setVrfFilter(event.target.value)}><option value="all">All VRFs</option>{vrfs.map((vrf) => <option key={vrf} value={vrf}>{vrf}</option>)}</select></label>
        <div className="vlan-search"><Search size={15} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search VLAN ID or name..." /></div>
        <button type="button" className="plain-button" onClick={exportVlans}>Export</button>
      </section>
      <div className="vlan-main-grid">
        <section className="card vlan-table-card">
          <div className="vlan-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>VLAN ID</th>
                  <th>Name</th>
                  <th>Site</th>
                  <th>Scope</th>
                  <th>Prefix / Subnet</th>
                  <th>Devices</th>
                  <th>Racks</th>
                  <th>Status</th>
                  <th>Last Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((record) => {
                  const metrics = vlanRowMetrics(record, devices);
                  const active = activeVlan?.id === record.id;
                  return (
                    <tr key={record.id} className={active ? 'active' : ''} onClick={() => setActiveVlanId(record.id)}>
                      <td>{record.vlanId || '-'}</td>
                      <td><button type="button" onClick={(event) => { event.stopPropagation(); setActiveVlanId(record.id); }} className="relationship-link">{record.name}</button></td>
                      <td>{record.site || '-'}</td>
                      <td>{vlanScope(record)}</td>
                      <td>{metrics.prefix}</td>
                      <td>{metrics.devices.length}</td>
                      <td>{metrics.racks}</td>
                      <td><span className={`infra-status ${record.status.toLowerCase()}`}>{record.status}</span></td>
                      <td>{formatDate(record.lastUpdated)}</td>
                      <td className="infra-row-actions">
                        <button className="row-action" onClick={(event) => { event.stopPropagation(); onOpenVlan(record); }}>Details</button>
                        <button className="row-action" onClick={(event) => { event.stopPropagation(); onEditVlan(record); }}>Edit</button>
                        <button className="row-action danger" onClick={(event) => { event.stopPropagation(); onDeleteVlan(record); }}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={10} className="empty">No VLANs match the current filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="vlan-table-footer">
            <span>Rows per page: {rows.length || 0}</span>
            <span>Showing {rows.length ? 1 : 0} to {rows.length} of {records.length} results</span>
          </div>
        </section>
        <VlanSidePanel vlan={activeVlan} devices={devices} onOpenVlan={onOpenVlan} onClose={() => setActiveVlanId('')} />
      </div>
    </div>
  );
}

function VlanKpi({ icon, tone, label, value, sub }: { icon: ReactElement; tone: string; label: string; value: string | number; sub: string }) {
  return (
    <section className={`vlan-kpi ${tone}`}>
      <span>{icon}</span>
      <p>{label}</p>
      <b>{value}</b>
      <small>{sub}</small>
    </section>
  );
}

function VlanSidePanel({ vlan, devices, onOpenVlan, onClose }: { vlan: InfraRecord | null; devices: InventoryDevice[]; onOpenVlan: (vlan: InfraRecord) => void; onClose: () => void }) {
  if (!vlan) return <aside className="card vlan-side-panel"><p className="empty">Select a VLAN to inspect.</p></aside>;
  const metrics = vlanRowMetrics(vlan, devices);
  const utilization = vlanUtilization(metrics.devices.length, metrics.prefix);
  return (
    <aside className="card vlan-side-panel">
      <button className="vlan-panel-close" type="button" onClick={onClose}><X size={15} /></button>
      <span className={`infra-status ${vlan.status.toLowerCase()}`}>{vlan.status}</span>
      <p>VLAN {vlan.vlanId || '-'}</p>
      <h2>{vlan.name}</h2>
      <button type="button" className="vlan-detail-button" onClick={() => onOpenVlan(vlan)}>VLAN details</button>
      <dl>
        <dt>VLAN ID</dt><dd>{vlan.vlanId || '-'}</dd>
        <dt>Name</dt><dd>{vlan.name || '-'}</dd>
        <dt>Site</dt><dd>{vlan.site || '-'}</dd>
        <dt>Scope</dt><dd>{vlanScope(vlan)}</dd>
        <dt>Prefix / Subnet</dt><dd>{metrics.prefix}</dd>
        <dt>Status</dt><dd><span className={`infra-status ${vlan.status.toLowerCase()}`}>{vlan.status}</span></dd>
        <dt>Devices</dt><dd>{metrics.devices.length}</dd>
        <dt>Racks</dt><dd>{metrics.racks}</dd>
        <dt>VRF</dt><dd>{vlan.vrf || '-'}</dd>
        <dt>Gateway</dt><dd>{vlan.gateway || '-'}</dd>
        <dt>Notes</dt><dd>{vlan.description || '-'}</dd>
      </dl>
      <section className="vlan-util-card">
        <p><span>Utilization overview</span><b>{utilization.percentLabel}</b></p>
        <small>{metrics.devices.length} device{metrics.devices.length === 1 ? '' : 's'} / {utilization.usableLabel} usable IPs</small>
        <i><em style={{ width: `${utilization.percent}%` }} /></i>
      </section>
      <div className="vlan-linked-grid">
        <button type="button" onClick={() => metrics.devices[0] && openInventoryDeviceDetail(metrics.devices[0])}>
          <Database size={17} />
          <span>Linked Devices</span>
          <b>{metrics.devices.length}</b>
          <small>View devices {'->'}</small>
        </button>
        <button type="button" onClick={() => metrics.prefixes[0] && openInfrastructureDetail('Prefixes', metrics.prefixes[0])}>
          <Layers size={17} />
          <span>Linked Prefixes</span>
          <b>{metrics.prefixes.length}</b>
          <small>View prefixes {'->'}</small>
        </button>
      </div>
      <footer>
        <span>Last updated <b>{formatDate(vlan.lastUpdated)}</b></span>
        <span>Updated by <b>Inventory</b></span>
      </footer>
    </aside>
  );
}

function vlanRowMetrics(vlan: InfraRecord, devices: InventoryDevice[]) {
  const vlanDevices = relatedDevicesFor('VLANs', vlan, devices);
  const prefixes = vlanLinkedPrefixes(vlan, devices);
  const prefix = vlan.prefix || prefixes[0]?.prefix || '-';
  const racks = new Set(vlanDevices.map((device) => String(device.rack || '').trim()).filter(Boolean)).size;
  return { devices: vlanDevices, prefixes, prefix, racks };
}

function vlanLinkedPrefixes(vlan: InfraRecord, devices: InventoryDevice[]) {
  const vlanDevices = relatedDevicesFor('VLANs', vlan, devices);
  const derived = deriveRecords('Prefixes', vlanDevices);
  const merged = mergeManualAndDerived('Prefixes', loadRecords('Prefixes'), derived);
  return uniqueInfraRecords(merged.filter((prefix) => {
    if (vlan.prefix && sameText(prefix.prefix, vlan.prefix)) return true;
    if (vlan.vlanId && sameText(prefix.vlanId, vlan.vlanId)) return true;
    return relatedDevicesFor('Prefixes', prefix, vlanDevices).length > 0;
  }));
}

function uniqueInfraRecords(records: InfraRecord[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = [record.id, record.name, record.prefix, record.vlanId].filter(Boolean).join(':').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function vlanScope(vlan: InfraRecord) {
  return vlan.role || vlan.tags || (vlan.site ? 'Site' : 'Global');
}

function vlanUtilization(deviceCount: number, prefix: string) {
  const usable = ipv4UsableHosts(prefix);
  if (!usable) return { percent: 0, percentLabel: '-', usableLabel: '-' };
  const percent = Math.min(100, Math.round((deviceCount / usable) * 1000) / 10);
  return { percent, percentLabel: `${percent}%`, usableLabel: String(usable) };
}

function ipv4UsableHosts(prefix: string) {
  const match = String(prefix || '').match(/\/(\d{1,2})$/);
  if (!match) return null;
  const cidr = Number(match[1]);
  if (!Number.isFinite(cidr) || cidr < 0 || cidr > 32) return null;
  if (cidr === 32) return 1;
  if (cidr === 31) return 2;
  return Math.max(0, Math.pow(2, 32 - cidr) - 2);
}

function ipv4Broadcast(prefix: string) {
  const [ip, maskValue] = String(prefix || '').split('/');
  const cidr = Number(maskValue);
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255) || !Number.isFinite(cidr) || cidr < 0 || cidr > 32) return '';
  const ipNumber = parts.reduce((value, part) => ((value << 8) + part) >>> 0, 0);
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  const broadcast = (ipNumber | (~mask >>> 0)) >>> 0;
  return [24, 16, 8, 0].map((shift) => (broadcast >>> shift) & 255).join('.');
}

function ipv4ToNumber(value: string) {
  const parts = String(value || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((total, part) => ((total << 8) + part) >>> 0, 0);
}

function ipv4NumberToString(value: number) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function ipv4NetworkRange(prefix: string) {
  const [ip, maskValue] = String(prefix || '').split('/');
  const cidr = Number(maskValue);
  const ipNumber = ipv4ToNumber(ip);
  if (ipNumber === null || !Number.isFinite(cidr) || cidr < 0 || cidr > 32) return null;
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  const start = (ipNumber & mask) >>> 0;
  const end = (start | (~mask >>> 0)) >>> 0;
  return { start, end, cidr };
}

function ipv4UsableRange(prefix: string) {
  const range = ipv4NetworkRange(prefix);
  if (!range) return '';
  if (range.cidr === 32) return ipv4NumberToString(range.start);
  if (range.cidr === 31) return `${ipv4NumberToString(range.start)} - ${ipv4NumberToString(range.end)}`;
  if (range.end <= range.start + 1) return '';
  return `${ipv4NumberToString(range.start + 1)} - ${ipv4NumberToString(range.end - 1)}`;
}

function prefixOverlapPairs(records: InfraRecord[]) {
  const ranges = records
    .map((record) => ({ record, range: ipv4NetworkRange(record.prefix || record.name || '') }))
    .filter((item): item is { record: InfraRecord; range: { start: number; end: number; cidr: number } } => Boolean(item.range));
  const pairs: [InfraRecord, InfraRecord][] = [];
  for (let index = 0; index < ranges.length; index += 1) {
    for (let compare = index + 1; compare < ranges.length; compare += 1) {
      const left = ranges[index];
      const right = ranges[compare];
      if (left.range.start <= right.range.end && right.range.start <= left.range.end) pairs.push([left.record, right.record]);
    }
  }
  return pairs;
}

function prefixOverlapCount(prefix: InfraRecord, records: InfraRecord[]) {
  return prefixOverlapPairs(records).filter(([left, right]) => left.id === prefix.id || right.id === prefix.id).length;
}

function ipv4Netmask(prefix: string) {
  const cidr = Number(String(prefix || '').split('/')[1]);
  if (!Number.isFinite(cidr) || cidr < 0 || cidr > 32) return '';
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  return [24, 16, 8, 0].map((shift) => (mask >>> shift) & 255).join('.');
}

function vlanUtilizationLine(percent: number) {
  const base = Math.max(22, Math.min(58, 58 - percent / 2));
  const points = [
    [0, base + 4],
    [42, base + 6],
    [82, base - 7],
    [122, base - 2],
    [164, base - 11],
    [204, base - 3],
    [244, base + 1],
    [280, base - 8],
  ];
  return points.map(([x, y]) => `${x},${Math.max(12, Math.min(68, y))}`).join(' ');
}

function RackListWorkspace({
  records,
  devices,
  deviceTypes,
  environments,
  selectedIds,
  query,
  onQueryChange,
  onToggleRecord,
  onSelectIds,
  onOpenRack,
  onEditRack,
  onDeleteRack,
  onDeleteSelected,
  onExportSelected,
}: {
  records: InfraRecord[];
  devices: InventoryDevice[];
  deviceTypes: DeviceTypeRecord[];
  environments: Record<number, RackDeviceEnvironment>;
  selectedIds: string[];
  query: string;
  onQueryChange: (value: string) => void;
  onToggleRecord: (id: string) => void;
  onSelectIds: (ids: string[]) => void;
  onOpenRack: (rack: InfraRecord) => void;
  onEditRack: (rack: InfraRecord) => void;
  onDeleteRack: (rack: InfraRecord) => void;
  onDeleteSelected: () => void;
  onExportSelected: () => void;
}) {
  const [activeRackId, setActiveRackId] = useState('');
  const [siteFilter, setSiteFilter] = useState('all');
  const [roomFilter, setRoomFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const sites = uniqueRackValues(records.map((rack) => rack.site));
  const rooms = uniqueRackValues(records.map((rack) => rack.region || rack.location));
  const filteredRows = records.filter((rack) => {
    const haystack = [rack.name, rack.site, rack.location, rack.region, rack.role, rack.status, rack.tags, rack.description].join(' ').toLowerCase();
    const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase());
    const matchesSite = siteFilter === 'all' || rack.site === siteFilter;
    const matchesRoom = roomFilter === 'all' || (rack.region || rack.location) === roomFilter;
    const matchesStatus = statusFilter === 'all' || rack.status === statusFilter;
    return matchesQuery && matchesSite && matchesRoom && matchesStatus;
  }).sort((a, b) => resourceDisplayValue('Racks', a).localeCompare(resourceDisplayValue('Racks', b), undefined, { numeric: true, sensitivity: 'base' }));
  useEffect(() => {
    if (!filteredRows.length) {
      setActiveRackId('');
      return;
    }
    if (!filteredRows.some((rack) => rack.id === activeRackId)) setActiveRackId(filteredRows[0].id);
  }, [activeRackId, filteredRows]);
  const previewRack = filteredRows.find((rack) => rack.id === activeRackId) || filteredRows[0] || records[0] || null;
  const previewDevices = previewRack ? relatedDevicesFor('Racks', previewRack, devices) : [];
  const filteredIds = filteredRows.map((rack) => rack.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const allRackDevices = uniqueDevices(records.flatMap((rack) => relatedDevicesFor('Racks', rack, devices)));
  const activeRacks = records.filter((rack) => rack.status === 'Active').length;
  const capacity = records.reduce((sum, rack) => {
    const occupancy = rackOccupancyFor(rack, relatedDevicesFor('Racks', rack, devices), deviceTypes);
    return { units: sum.units + occupancy.units, used: sum.used + occupancy.usedUnits };
  }, { units: 0, used: 0 });
  const totalPower = rackPowerSummary(allRackDevices, deviceTypes);
  const tempSamples = allRackDevices
    .map((device) => environments[device.id]?.temperature_c)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const averageTemp = tempSamples.length ? Math.round((tempSamples.reduce((sum, value) => sum + value, 0) / tempSamples.length) * 10) / 10 : null;
  const listKpis = [
    { icon: <Server size={18} />, tone: 'blue', label: 'Total racks', value: records.length, sub: `${sites.length || 1} site${sites.length === 1 ? '' : 's'}` },
    { icon: <Activity size={18} />, tone: 'green', label: 'Active racks', value: activeRacks, sub: `${records.length ? Math.round((activeRacks / records.length) * 100) : 0}% of total` },
    { icon: <Layers size={18} />, tone: 'purple', label: 'Capacity used', value: `${capacity.units ? Math.round((capacity.used / capacity.units) * 1000) / 10 : 0}%`, sub: `${capacity.used}U of ${capacity.units}U` },
    { icon: <Zap size={18} />, tone: 'orange', label: 'Power usage', value: formatRackPowerValue(totalPower), sub: totalPower.label },
    { icon: <Database size={18} />, tone: 'blue', label: 'Devices installed', value: allRackDevices.length, sub: `${averageTemp === null ? 'No temp samples' : `Avg ${averageTemp} C`}` },
  ];

  const toggleFiltered = () => {
    if (allFilteredSelected) {
      const remove = new Set(filteredIds);
      onSelectIds(selectedIds.filter((id) => !remove.has(id)));
      return;
    }
    onSelectIds([...new Set([...selectedIds, ...filteredIds])]);
  };

  return (
    <div className="rack-list-workspace">
      <div className="rack-list-kpis">
        {listKpis.map((kpi) => <RackListKpi key={kpi.label} {...kpi} />)}
      </div>
      <div className="rack-list-layout">
        <section className="card rack-list-table-card">
          {selectedIds.length > 0 && (
            <div className="bulk-toolbar">
              <b>{selectedIds.length} selected</b>
              <button className="plain-button" onClick={onExportSelected}>Export selected</button>
              <button className="plain-button danger-button" onClick={onDeleteSelected}>Delete selected</button>
              <button className="plain-button" onClick={() => onSelectIds([])}>Clear</button>
            </div>
          )}
          <div className="rack-list-filters">
            <label>Site<select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option value="all">All Sites</option>{sites.map((site) => <option key={site} value={site}>{site}</option>)}</select></label>
            <label>Room<select value={roomFilter} onChange={(event) => setRoomFilter(event.target.value)}><option value="all">All Rooms</option>{rooms.map((room) => <option key={room} value={room}>{room}</option>)}</select></label>
            <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All Statuses</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
            <div className="rack-list-search"><Search size={15} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search by rack ID or name..." /></div>
          </div>
          <div className="rack-list-table-wrap">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" checked={allFilteredSelected} onChange={toggleFiltered} aria-label="Select all visible racks" /></th>
                  <th>Rack ID</th>
                  <th>Location</th>
                  <th>Room</th>
                  <th>Status</th>
                  <th>Height</th>
                  <th>Used U</th>
                  <th>Free U</th>
                  <th>Temperature</th>
                  <th>Power</th>
                  <th>Devices</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((rack) => {
                  const rackDevices = relatedDevicesFor('Racks', rack, devices);
                  const occupancy = rackOccupancyFor(rack, rackDevices, deviceTypes);
                  const temperature = rackTemperatureSummary(rackDevices, environments, rack);
                  const power = rackPowerSummary(rackDevices, deviceTypes, rack);
                  const selected = selectedIds.includes(rack.id);
                  const active = previewRack?.id === rack.id;
                  return (
                    <tr
                      key={rack.id}
                      className={`${selected ? 'selected' : ''}${active ? ' active' : ''}`}
                      onClick={() => onOpenRack(rack)}
                    >
                      <td><input type="checkbox" checked={selected} onClick={(event) => event.stopPropagation()} onChange={() => onToggleRecord(rack.id)} aria-label={`Select ${rack.name}`} /></td>
                      <td><button className="device-link infra-record-link" onClick={(event) => { event.stopPropagation(); onOpenRack(rack); }}>{rack.name}</button></td>
                      <td>{rack.location || '-'}</td>
                      <td>{rack.region || '-'}</td>
                      <td><span className={`infra-status ${rack.status.toLowerCase()}`}>{rack.status}</span></td>
                      <td>{occupancy.units}U</td>
                      <td><RackListMeter value={occupancy.utilization} label={`${occupancy.usedUnits}U`} /></td>
                      <td>{occupancy.freeUnits}U</td>
                      <td><RackListTemperature temperature={temperature} /></td>
                      <td><RackListPower power={power} /></td>
                      <td>{rackDevices.length}</td>
                      <td className="infra-row-actions">
                        <button className="row-action" onClick={(event) => { event.stopPropagation(); onOpenRack(rack); }}>Details</button>
                        <button className="row-action" onClick={(event) => { event.stopPropagation(); onEditRack(rack); }}>Edit</button>
                        <button className="row-action danger" onClick={(event) => { event.stopPropagation(); onDeleteRack(rack); }}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
                {!filteredRows.length && <tr><td colSpan={12} className="empty">No racks match the current filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="rack-list-footer">
            <span>Showing {filteredRows.length ? 1 : 0} to {filteredRows.length} of {records.length} racks</span>
            <span>Rows per page: {filteredRows.length || 0}</span>
          </div>
        </section>
        <RackListSidePanel rack={previewRack} devices={previewDevices} deviceTypes={deviceTypes} environments={environments} onOpenRack={onOpenRack} />
      </div>
    </div>
  );
}

function RackListKpi({ icon, tone, label, value, sub }: { icon: ReactElement; tone: string; label: string; value: string | number; sub: string }) {
  return (
    <section className={`rack-list-kpi ${tone}`}>
      <span>{icon}</span>
      <p>{label}</p>
      <b>{value}</b>
      <small>{sub}</small>
    </section>
  );
}

function RackListMeter({ value, label }: { value: number; label: string }) {
  return (
    <span className="rack-list-meter">
      <b>{label}</b>
      <i><em style={{ width: `${Math.min(100, value)}%` }} /></i>
      <small>{value}%</small>
    </span>
  );
}

function RackListTemperature({ temperature }: { temperature: RackTemperatureSummary }) {
  if (temperature.value === null) return <span className="rack-list-temp muted">-</span>;
  return <span className={`rack-list-temp ${temperature.tone}`}><Thermometer size={14} />{temperature.value} C</span>;
}

function RackListPower({ power }: { power: RackPowerSummary }) {
  if (power.watts === null) return <span className="rack-list-power muted">-</span>;
  return (
    <span className={`rack-list-power ${power.tone}`} title={power.label}>
      <Zap size={14} />
      <b>{formatRackPowerValue(power)}</b>
      <small>{power.knownDevices} typed</small>
    </span>
  );
}

function RackDevicePowerCell({ device, deviceTypes }: { device: InventoryDevice; deviceTypes: DeviceTypeRecord[] }) {
  const profile = deviceTypeForRackDevice(device, deviceTypes);
  const hasDevicePower = device.power_consumption_w !== null && device.power_consumption_w !== undefined;
  const watts = rackDevicePowerWatts(device, deviceTypes);
  if (watts === null) return <span className="rack-device-power muted">No type power</span>;
  return (
    <span className="rack-device-power" title={hasDevicePower ? 'Stored on device' : profile ? `Device Type: ${deviceTypeLabel(profile)}` : 'Device Type power'}>
      <b>{formatWattsValue(watts)}</b>
      <small>{hasDevicePower ? 'Device power usage' : profile ? deviceTypeLabel(profile) : 'Device Type'}</small>
    </span>
  );
}

function RackDeviceTemperatureCell({ device, environment, rack }: { device: InventoryDevice; environment?: RackDeviceEnvironment; rack: InfraRecord }) {
  if (environment?.loading) return <span className="temperature-cell muted"><b>-</b><small>Loading</small></span>;
  const value = environment?.temperature_c;
  if (typeof value !== 'number' || !Number.isFinite(value)) return <span className="temperature-cell muted"><b>-</b><small>No SNMP temp</small></span>;
  const state = String(environment?.temperature_status || '').toLowerCase();
  const configuredTone = environmentThresholdTone('temperature', value, thresholdContextForRackDevice(device, rack));
  const threshold = typeof environment?.temperature_threshold_c === 'number' ? Number(environment.temperature_threshold_c) : null;
  const tone = configuredTone === 'danger' || ['critical', 'shutdown', 'not functioning'].includes(state) || (threshold !== null && value >= threshold)
    ? 'danger'
    : configuredTone === 'warning' || state === 'warning' || (threshold !== null && value >= threshold - 10)
      ? 'warning'
      : 'ok';
  const label = state ? rackStatusTitle(state) : threshold !== null ? `Limit ${threshold} C` : 'Reported';
  return <span className={`temperature-cell ${tone}`}><b>{value} C</b><small>{label}</small></span>;
}

function rackStatusTitle(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function RackListSidePanel({ rack, devices, deviceTypes, environments, onOpenRack }: { rack: InfraRecord | null; devices: InventoryDevice[]; deviceTypes: DeviceTypeRecord[]; environments: Record<number, RackDeviceEnvironment>; onOpenRack: (rack: InfraRecord) => void }) {
  if (!rack) return <aside className="rack-list-side card"><p className="empty">Select a rack to inspect.</p></aside>;
  const occupancy = rackOccupancyFor(rack, devices, deviceTypes);
  const temperature = rackTemperatureSummary(devices, environments, rack);
  const power = rackPowerSummary(devices, deviceTypes, rack);
  const issues = rackDeviceIssues(devices, environments, rack, deviceTypes);
  const switches = devices.filter((device) => rackDeviceTone(device) === 'switch');
  const tempTrend = rackTemperatureTrend(temperature, []);
  return (
    <aside className="rack-list-side">
      <section className="rack-list-side-head card">
        <h2>{rack.name}</h2>
        <span className={`infra-status ${rack.status.toLowerCase()}`}>{rack.status}</span>
        <p>{[rack.site, rack.location, rack.region].filter(Boolean).join(' / ') || 'Unassigned'}</p>
        <button type="button" className="rack-detail-button" onClick={() => onOpenRack(rack)}>Rack detail</button>
      </section>
      <section className="rack-list-side-section rack-list-alerts-section card">
        <div className="rack-panel-title"><Bell size={15} /> Alerts & Events <b>{issues.length}</b></div>
        {issues.length ? issues.map((issue, index) => (
          <p key={`${issue.device.id}-${issue.kind}-${index}`} className={`rack-alert-${issue.severity}`}><span>{issue.severity}</span>{issue.device.name}: {issue.message}</p>
        )) : <p className="rack-list-mini-row"><span>Normal</span><b>No active rack alarms</b></p>}
      </section>
      <section className="rack-list-side-section card">
        <div className="rack-panel-title">Rack overview</div>
        <div className="rack-list-overview">
          <div>
            <p><span>Height</span><b>{occupancy.units}U</b></p>
            <p><span>Used U</span><b>{occupancy.usedUnits}U ({occupancy.utilization}%)</b></p>
            <p><span>Free U</span><b>{occupancy.freeUnits}U</b></p>
            <p><span>Temperature</span><b>{temperature.value === null ? '-' : `${temperature.value} C`}</b></p>
            <p><span>Power</span><b>{formatRackPowerValue(power)}</b></p>
            <p><span>Devices</span><b>{devices.length}</b></p>
          </div>
          <RackListGraphic rack={rack} devices={devices} deviceTypes={deviceTypes} />
        </div>
      </section>
      <section className="rack-list-side-section card">
        <div className="rack-panel-title"><Network size={15} /> Network connectivity</div>
        <p className="rack-list-mini-row"><span>Primary switch</span><b>{switches[0]?.name || '-'}</b></p>
        <p className="rack-list-mini-row"><span>Backup switch</span><b>{switches[1]?.name || '-'}</b></p>
      </section>
      <section className="rack-list-side-charts">
        <RackTrendCard icon={<Thermometer size={15} />} title="Temperature profile" value={temperature.value === null ? 'No data' : `${temperature.value} C`} sub={tempTrend.label} points={tempTrend.points} />
        <RackTrendCard icon={<Zap size={15} />} title="Power usage profile" value={formatRackPowerValue(power, 'No data')} sub={power.label} points={power.points} />
      </section>
    </aside>
  );
}

function RackListGraphic({ rack, devices, deviceTypes }: { rack: InfraRecord; devices: InventoryDevice[]; deviceTypes: DeviceTypeRecord[] }) {
  const units = Math.max(1, Math.min(52, numeric(rack.units) || 42));
  const positioned = devices
    .map((device) => {
      const position = rackDevicePosition(device, units);
      return position === null ? null : { device, position, height: rackDeviceUnitHeight(device, units, position, deviceTypes) };
    })
    .filter((row): row is { device: InventoryDevice; position: number; height: number } => row !== null);
  const unitTone = new Map<number, string>();
  positioned.forEach((row) => {
    for (let unit = row.position; unit < row.position + row.height && unit <= units; unit += 1) unitTone.set(unit, rackDeviceTone(row.device));
  });
  return (
    <span className="rack-list-graphic" style={{ ['--rack-units' as string]: units }}>
      {Array.from({ length: units }, (_, index) => {
        const unit = units - index;
        return <i key={unit} className={unitTone.get(unit) || ''} title={`U${unit}`} />;
      })}
    </span>
  );
}

function uniqueRackValues(values: Array<string | undefined | null>) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function uniqueDevices(devices: InventoryDevice[]) {
  const seen = new Set<number>();
  return devices.filter((device) => {
    if (seen.has(device.id)) return false;
    seen.add(device.id);
    return true;
  });
}

function InfrastructureForm({
  title,
  fields,
  renderField,
  onCancel,
  onSubmit,
}: {
  title: string;
  fields: FieldConfig[];
  editing: InfraRecord | null;
  renderField: (field: FieldConfig) => ReactElement;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form className="device-form large infra-form" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="form-header">
          <div>
            <h2>{title}</h2>
            <p>Record the operational, physical, and addressing details needed by the infrastructure inventory.</p>
          </div>
          <button type="button" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="form-grid">
          {fields.map(renderField)}
        </div>
        <div className="form-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button className="add" type="submit">Save record</button>
        </div>
      </form>
    </div>
  );
}

function openInventoryDeviceDetail(device: InventoryDevice) {
  window.dispatchEvent(new CustomEvent('aims:navigate-device-detail', { detail: { id: device.id } }));
}

function openInfrastructureDetail(resource: InfrastructureResourceName, record: InfraRecord) {
  window.dispatchEvent(new CustomEvent('aims:navigate-infrastructure-detail', { detail: { resource, id: record.id, name: resourceDisplayValue(resource, record) } }));
}

function openWirelessDetail(ap?: WirelessAp) {
  window.dispatchEvent(new CustomEvent('aims:navigate-wireless-detail', { detail: { key: ap ? wirelessApKey(ap) : undefined } }));
}

function infrastructureRecordMatchesTarget(resource: InfrastructureResourceName, record: InfraRecord, target: InfrastructureOpenTarget) {
  if (target.id && record.id === target.id) return true;
  if (!target.name) return false;
  return sameText(resourceDisplayValue(resource, record), target.name)
    || sameText(record.name, target.name)
    || (resource === 'IP Addresses' && sameText(record.address, target.name))
    || (resource === 'Prefixes' && sameText(record.prefix, target.name));
}

type RackIssue = { device: InventoryDevice; severity: 'critical' | 'warning'; kind: string; message: string };
type RackTemperatureSummary = { value: number | null; average: number | null; sampleCount: number; label: string; tone: 'green' | 'yellow' | 'orange' | 'red'; points: number[]; progress: number };
type RackPowerSummary = { watts: number | null; kw: number | null; knownDevices: number; unknownDevices: number; label: string; tone: 'green' | 'yellow' | 'orange' | 'red'; points: number[]; progress: number };

function rackTemperatureSummary(devices: InventoryDevice[], environments: Record<number, RackDeviceEnvironment>, rack?: InfraRecord): RackTemperatureSummary {
  const samples = devices
    .map((device) => ({ device, environment: environments[device.id] }))
    .filter((row) => typeof row.environment?.temperature_c === 'number' && Number.isFinite(row.environment.temperature_c))
    .map((row) => ({
      device: row.device,
      value: Number(row.environment.temperature_c),
      threshold: typeof row.environment.temperature_threshold_c === 'number' ? Number(row.environment.temperature_threshold_c) : null,
      state: String(row.environment.temperature_status || '').toLowerCase(),
      thresholdTone: environmentThresholdTone('temperature', Number(row.environment.temperature_c), thresholdContextForRackDevice(row.device, rack)),
    }));
  if (!samples.length) {
    const loading = devices.some((device) => environments[device.id]?.loading);
    return { value: null, average: null, sampleCount: 0, label: loading ? 'Polling device sensors...' : 'No device SNMP temperature samples', tone: 'yellow', points: [], progress: 0 };
  }
  const hottest = samples.reduce((max, sample) => sample.value > max.value ? sample : max, samples[0]);
  const average = Math.round((samples.reduce((sum, sample) => sum + sample.value, 0) / samples.length) * 10) / 10;
  const threshold = hottest.threshold;
  const tone = hottest.thresholdTone === 'danger'
    ? 'red'
    : hottest.thresholdTone === 'warning'
      ? 'orange'
      : hottest.thresholdTone === 'normal'
        ? 'green'
        : threshold !== null && hottest.value >= threshold
          ? 'red'
          : threshold !== null && hottest.value >= threshold - 10
            ? 'orange'
            : ['critical', 'shutdown', 'not functioning'].includes(hottest.state)
              ? 'red'
              : hottest.state === 'warning'
                ? 'orange'
                : 'green';
  const points = samples.map((sample) => sample.value).sort((a, b) => a - b);
  return {
    value: Math.round(hottest.value * 10) / 10,
    average,
    sampleCount: samples.length,
    label: `Hottest: ${hottest.device.name} / Avg ${average} C / ${samples.length} sample${samples.length === 1 ? '' : 's'}`,
    tone,
    points,
    progress: threshold ? Math.min(100, Math.round((hottest.value / threshold) * 100)) : Math.min(100, Math.round((hottest.value / 80) * 100)),
  };
}

function rackTemperatureTrend(summary: RackTemperatureSummary, history: RackTemperatureHistoryPoint[]) {
  if (history.length >= 2) {
    const latest = history[history.length - 1];
    const first = history[0];
    const delta = Math.round((latest.hottest - first.hottest) * 10) / 10;
    const deltaLabel = delta > 0 ? `+${delta} C` : `${delta} C`;
    const newestAverage = latest.average === null ? '-' : `${latest.average} C`;
    return {
      points: history.map((point) => point.hottest),
      label: `${history.length} readings / ${deltaLabel} trend / Avg ${newestAverage}`,
    };
  }
  if (history.length === 1) {
    return {
      points: [history[0].hottest],
      label: '1 reading collected; trend updates every 60s',
    };
  }
  return {
    points: summary.points,
    label: summary.value === null ? summary.label : 'Collecting temperature history...',
  };
}

function rackPowerSummary(devices: InventoryDevice[], deviceTypes: DeviceTypeRecord[], rack?: InfraRecord): RackPowerSummary {
  const samples = devices
    .map((device) => ({ device, watts: rackDevicePowerWatts(device, deviceTypes) }))
    .filter((row): row is { device: InventoryDevice; watts: number } => typeof row.watts === 'number' && Number.isFinite(row.watts) && row.watts > 0);
  const unknownDevices = Math.max(0, devices.length - samples.length);
  if (!samples.length) {
    return {
      watts: null,
      kw: null,
      knownDevices: 0,
      unknownDevices,
      label: devices.length ? `No Device Type power values for ${devices.length} device${devices.length === 1 ? '' : 's'}` : 'No devices installed',
      tone: 'yellow',
      points: [],
      progress: 0,
    };
  }
  const watts = samples.reduce((sum, sample) => sum + sample.watts, 0);
  const kw = Math.round((watts / 1000) * 100) / 100;
  const capacityWatts = 12000;
  const progress = Math.min(100, Math.round((watts / capacityWatts) * 100));
  const thresholdTone = environmentThresholdTone('power', watts, thresholdContextForRack(rack));
  const tone = thresholdTone === 'danger'
    ? 'red'
    : thresholdTone === 'warning'
      ? 'orange'
      : thresholdTone === 'normal'
        ? 'green'
        : progress >= 90 ? 'red' : progress >= 75 ? 'orange' : progress >= 60 ? 'yellow' : 'green';
  const points = samples.map((sample) => Math.round((sample.watts / 1000) * 100) / 100);
  return {
    watts,
    kw,
    knownDevices: samples.length,
    unknownDevices,
    label: `From Device Type power: ${samples.length} device${samples.length === 1 ? '' : 's'}${unknownDevices ? ` / ${unknownDevices} missing power` : ''}`,
    tone,
    points,
    progress,
  };
}

function formatRackPowerValue(power: RackPowerSummary, emptyValue = '-') {
  if (power.watts === null) return emptyValue;
  return formatWattsValue(power.watts);
}

function formatRackDevicePowerValue(device: InventoryDevice, deviceTypes: DeviceTypeRecord[]) {
  const watts = rackDevicePowerWatts(device, deviceTypes);
  return watts === null ? '-' : formatWattsValue(watts);
}

function rackDevicePowerWatts(device: InventoryDevice, deviceTypes: DeviceTypeRecord[]) {
  if (device.power_consumption_w !== null && device.power_consumption_w !== undefined) {
    const parsed = Number(device.power_consumption_w);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return deviceTypePowerWatts(deviceTypeForRackDevice(device, deviceTypes));
}

function formatWattsValue(watts: number) {
  return watts >= 1000 ? `${Math.round((watts / 1000) * 100) / 100} kW` : `${Math.round(watts)} W`;
}

function thresholdContextForRack(rack?: InfraRecord): EnvironmentThresholdContext {
  return {
    location: rack?.location,
    room: rack?.region,
    rack: rack?.name,
  };
}

function thresholdContextForRackDevice(device: InventoryDevice, rack?: InfraRecord): EnvironmentThresholdContext {
  return {
    deviceId: device.id,
    deviceName: device.name,
    location: device.location || rack?.location,
    room: (device as InventoryDevice & { room?: string | null; region?: string | null }).room || (device as InventoryDevice & { room?: string | null; region?: string | null }).region || rack?.region,
    rack: device.rack || rack?.name,
  };
}

function rackDeviceIssues(devices: InventoryDevice[], environments: Record<number, RackDeviceEnvironment>, rack?: InfraRecord, deviceTypes: DeviceTypeRecord[] = []): RackIssue[] {
  const issues: RackIssue[] = [];
  devices.forEach((device) => {
    const status = String(device.status || '').toLowerCase();
    const snmpStatus = String(device.snmp_status || '').toLowerCase();
    const configStatus = String(device.config_status || '').toLowerCase();
    const environment = environments[device.id];

    if (['offline', 'failed', 'down'].includes(status)) {
      issues.push({ device, severity: 'critical', kind: 'offline', message: `device status is ${device.status || 'offline'}` });
    }
    if (snmpStatus && snmpStatus !== 'ok' && snmpStatus !== 'not checked') {
      issues.push({ device, severity: snmpStatus.includes('no response') ? 'critical' : 'warning', kind: 'snmp', message: device.snmp_last_error || `SNMP status is ${device.snmp_status}` });
    }
    if (configStatus.includes('failed') || configStatus.includes('error')) {
      issues.push({ device, severity: 'warning', kind: 'config', message: device.config_status || 'configuration collection error' });
    }
    if (environment?.error) {
      issues.push({ device, severity: 'warning', kind: 'environment', message: environment.error });
    }
    if (typeof environment?.temperature_c === 'number') {
      const configuredTone = environmentThresholdTone('temperature', environment.temperature_c, thresholdContextForRackDevice(device, rack));
      const threshold = typeof environment.temperature_threshold_c === 'number' ? environment.temperature_threshold_c : null;
      if (configuredTone === 'danger') {
        issues.push({ device, severity: 'critical', kind: 'temperature', message: `temperature ${environment.temperature_c} C is in the configured danger range` });
      } else if (configuredTone === 'warning') {
        issues.push({ device, severity: 'warning', kind: 'temperature', message: `temperature ${environment.temperature_c} C is in the configured warning range` });
      } else if (threshold !== null && environment.temperature_c >= threshold) {
        issues.push({ device, severity: 'critical', kind: 'temperature', message: `temperature ${environment.temperature_c} C is at/above ${threshold} C threshold` });
      } else if (threshold !== null && environment.temperature_c >= threshold - 10) {
        issues.push({ device, severity: 'warning', kind: 'temperature', message: `temperature ${environment.temperature_c} C is within 10 C of ${threshold} C threshold` });
      }
    }
    const watts = rackDevicePowerWatts(device, deviceTypes);
    if (watts !== null) {
      const powerTone = environmentThresholdTone('power', watts, thresholdContextForRackDevice(device, rack));
      if (powerTone === 'danger') {
        issues.push({ device, severity: 'critical', kind: 'power-usage', message: `power usage ${formatWattsValue(watts)} is in the configured danger range` });
      } else if (powerTone === 'warning') {
        issues.push({ device, severity: 'warning', kind: 'power-usage', message: `power usage ${formatWattsValue(watts)} is in the configured warning range` });
      }
    }
    const tempState = String(environment?.temperature_status || '').toLowerCase();
    if (['critical', 'shutdown', 'not functioning'].includes(tempState)) issues.push({ device, severity: 'critical', kind: 'temperature-state', message: `temperature state is ${environment?.temperature_status}` });
    if (tempState === 'warning') issues.push({ device, severity: 'warning', kind: 'temperature-state', message: 'temperature state is warning' });
    const fanState = String(environment?.fan_status || '').toLowerCase();
    if (fanState && fanState !== 'normal') issues.push({ device, severity: fanState === 'warning' ? 'warning' : 'critical', kind: 'fan', message: `fan state is ${environment?.fan_status}` });
    const psuState = String(environment?.power_supply_status || '').toLowerCase();
    if (psuState && psuState !== 'normal') issues.push({ device, severity: psuState === 'warning' ? 'warning' : 'critical', kind: 'power', message: `power supply state is ${environment?.power_supply_status}` });
  });
  return uniqueRackIssues(issues);
}

function uniqueRackIssues(issues: RackIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.device.id}|${issue.kind}|${issue.message}|${issue.severity}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function RackDetailDashboard({
  rack,
  devices,
  allDevices,
  occupancy,
  environments,
  temperatureHistory,
  deviceTypes,
  onMoveDevice,
}: {
  rack: InfraRecord;
  devices: InventoryDevice[];
  allDevices: InventoryDevice[];
  occupancy: ReturnType<typeof rackOccupancyFor>;
  environments: Record<number, RackDeviceEnvironment>;
  temperatureHistory: RackTemperatureHistoryPoint[];
  deviceTypes: DeviceTypeRecord[];
  onMoveDevice: (device: InventoryDevice, rack: InfraRecord, position: number) => Promise<void>;
}) {
  const issues = rackDeviceIssues(devices, environments, rack, deviceTypes);
  const offlineDevices = issues.filter((issue) => issue.kind === 'offline').length;
  const temperature = rackTemperatureSummary(devices, environments, rack);
  const temperatureTrend = rackTemperatureTrend(temperature, temperatureHistory);
  const power = rackPowerSummary(devices, deviceTypes, rack);
  const firstSwitch = devices.find((device) => rackDeviceTone(device) === 'switch') || devices[0];
  const secondSwitch = devices.find((device) => device.id !== firstSwitch?.id && rackDeviceTone(device) === 'switch');
  const sortedDevices = devices
    .map((device) => {
      const position = rackDevicePosition(device, occupancy.units);
      const height = position === null ? rackDeviceRequestedUnits(device, deviceTypes) : rackDeviceUnitHeight(device, occupancy.units, position, deviceTypes);
      return { device, position, height };
    })
    .sort((a, b) => (b.position || 0) - (a.position || 0) || a.device.name.localeCompare(b.device.name));

  return (
    <div className="rack-dashboard">
      <aside className="rack-dashboard-left">
        <RackElevation rack={rack} devices={devices} allDevices={allDevices} deviceTypes={deviceTypes} onMoveDevice={onMoveDevice} compact />
      </aside>
      <div className="rack-dashboard-main">
        <RackInfoGrid rack={rack} />
        <RackMonitoringPanel rack={rack} devices={devices} occupancy={occupancy} temperature={temperature} power={power} issues={issues} />
        <div className="rack-insight-grid">
          <section className="rack-connect-card">
            <div className="rack-panel-title"><Network size={16} /> Network connectivity</div>
            <h3>{issues.length ? 'Attention needed' : 'Redundant'}</h3>
            <p>{Math.max(1, Math.min(2, devices.length))} uplink{devices.length === 1 ? '' : 's'} / 20Gbps</p>
            <div>
              <span><small>Primary switch</small><b>{firstSwitch?.name || 'Not assigned'}</b></span>
              <span><small>Backup switch</small><b>{secondSwitch?.name || 'Not assigned'}</b></span>
              <em className={issues.length ? 'warn' : 'ok'}>{issues.length ? 'Check' : 'OK'}</em>
            </div>
          </section>
          <section className="rack-alert-card">
            <div className="rack-panel-title"><Bell size={16} /> Recent alarms <b>{issues.length}</b></div>
            {issues.length ? (
              issues.slice(0, 4).map((issue, index) => (
                <p key={`${issue.device.id}-${issue.kind}-${index}`} className={`rack-alert-${issue.severity}`}>
                  <span>{issue.severity === 'critical' ? 'Critical' : 'Warning'}</span> {issue.device.name}: {issue.message}
                </p>
              ))
            ) : (
              <p><span>Normal</span> No active rack alarms</p>
            )}
            {issues.length > 4 && <p className="rack-alert-warning"><span>Warning</span> {issues.length - 4} more device issue{issues.length - 4 === 1 ? '' : 's'}</p>}
            <p className="rack-alert-info"><span>Info</span> {occupancy.freeUnits}U available for installation</p>
          </section>
        </div>
        <div className="rack-assets-grid">
          <section className="rack-assets-card">
            <div className="rack-tabs"><button className="active">Assets</button><button>Ports</button><button>Power</button><button>Maintenance</button></div>
            <div className="rack-panel-title">Installed devices <small>({devices.length})</small></div>
            <div className="rack-assets-table">
              <table>
                <thead><tr><th>U position</th><th>Device</th><th>IP address</th><th>Status</th><th>Role</th><th>Temperature</th></tr></thead>
                <tbody>
                  {sortedDevices.map(({ device, position, height }) => (
                    <tr key={`${device.id}-${position || 'open'}-${height}`}>
                      <td>{position ? rackUnitRange(position, height) : '-'}</td>
                      <td><button type="button" onClick={() => openInventoryDeviceDetail(device)}>{device.name}</button></td>
                      <td>{device.management_ip || '-'}</td>
                      <td><span className={`status ${String(device.status || 'active').toLowerCase()}`}>{device.status || 'Active'}</span></td>
                      <td>{device.role || device.platform || '-'}</td>
                      <td><RackDeviceTemperatureCell device={device} environment={environments[device.id]} rack={rack} /></td>
                    </tr>
                  ))}
                  {!sortedDevices.length && <tr><td colSpan={6} className="empty">No devices assigned to this rack.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
          <section className="rack-trends">
            <RackTrendCard icon={<Thermometer size={15} />} title="Device temperature over time" value={temperature.value === null ? 'No data' : `${temperature.value} C`} sub={temperatureTrend.label} points={temperatureTrend.points} />
            <RackTrendCard icon={<Zap size={15} />} title="Power usage profile" value={formatRackPowerValue(power, 'No data')} sub={power.label} points={power.points} />
          </section>
        </div>
      </div>
    </div>
  );
}

function RackInfoGrid({ rack }: { rack: InfraRecord }) {
  const room = rack.region || rack.location || 'Unassigned';
  const cabinet = rack.name || 'Unassigned';
  return (
    <div className="rack-info-grid">
      <div><Database size={17} /><p>Rack ID / Name</p><b>{rack.name}</b><span>{rack.description || 'Production rack'}</span></div>
      <div><MapPin size={17} /><p>Location</p><b>{rack.site || 'Unassigned'}</b><span>{rack.location || 'Site assignment'}</span></div>
      <div><Building2 size={17} /><p>Room</p><b>{room}</b><span>Network operations</span></div>
      <div><Layers size={17} /><p>Row / Cabinet</p><b>{cabinet}</b><span>{rack.tags || 'Cabinet assignment'}</span></div>
    </div>
  );
}

function RackTrendCard({ icon, title, value, sub, points }: { icon: ReactElement; title: string; value: string; sub: string; points: number[] }) {
  const graphPoints = points.length > 1 ? points : points.length === 1 ? [points[0], points[0]] : [0, 0];
  const min = Math.min(...graphPoints);
  const max = Math.max(...graphPoints);
  const path = graphPoints.map((point, index) => {
    const x = (index / Math.max(1, graphPoints.length - 1)) * 140;
    const y = 44 - ((point - min) / Math.max(1, max - min)) * 32;
    return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <div className="rack-trend-card">
      <div className="rack-panel-title">{icon} {title}</div>
      <svg viewBox="0 0 140 52" preserveAspectRatio="none">
        <path d="M0 44H140" />
        <path d="M0 28H140" />
        <path d="M0 12H140" />
        <path className="trend-line" d={path} />
      </svg>
      <div><b>{value}</b><span>{sub}</span></div>
    </div>
  );
}

function RackMonitoringPanel({ rack, devices, occupancy, temperature, power, issues }: { rack: InfraRecord; devices: InventoryDevice[]; occupancy: ReturnType<typeof rackOccupancyFor>; temperature: RackTemperatureSummary; power: RackPowerSummary; issues: RackIssue[] }) {
  const activeDevices = devices.filter((device) => String(device.status || '').toLowerCase() === 'active').length;
  const offlineDevices = issues.filter((issue) => issue.kind === 'offline').length;
  const deviceState = rackDeviceHealthState(devices.length, activeDevices, offlineDevices);
  const statusTone = rack.status === 'Active' ? 'green' : rack.status === 'Offline' ? 'red' : 'yellow';
  const availablePercent = occupancy.units ? Math.round((occupancy.freeUnits / occupancy.units) * 100) : 0;

  return (
    <section className="rack-ops-panel">
      <div className="rack-ops-grid">
        <div className={`rack-ops-card metric-status status-${statusTone}`}>
          <p><Activity size={15} /> Status</p>
          <b>{rack.status}</b>
          <span>{offlineDevices ? `${offlineDevices} device issue${offlineDevices === 1 ? '' : 's'}` : 'All systems normal'}</span>
          <i><em style={{ width: rack.status === 'Active' ? '100%' : '45%' }} /></i>
        </div>
        <div className={`rack-ops-card metric-temperature status-${temperature.tone}`}>
          <p><Thermometer size={15} /> Temperature</p>
          <b>{temperature.value === null ? '-' : temperature.value}<small>{temperature.value === null ? '' : ' C'}</small></b>
          <span>{temperature.label}</span>
          <i><em style={{ width: `${temperature.progress}%` }} /></i>
        </div>
        <div className={`rack-ops-card metric-power status-${power.tone}`}>
          <p><Zap size={15} /> Power usage</p>
          <b>{formatRackPowerValue(power)}</b>
          <span>{power.label}</span>
          <i><em style={{ width: `${power.progress}%` }} /></i>
        </div>
        <div className={`rack-ops-card metric-devices status-${deviceState.tone}`}>
          <p><Server size={15} /> Devices</p>
          <b>{devices.length}</b>
          <span>Total installed</span>
          <i><em style={{ width: `${devices.length ? Math.round((activeDevices / devices.length) * 100) : 0}%` }} /></i>
        </div>
        <div className="rack-ops-card metric-size status-green">
          <p><Layers size={15} /> Available U space</p>
          <b>{occupancy.freeUnits}<small> U</small></b>
          <span>{availablePercent}% free</span>
          <i><em style={{ width: `${availablePercent}%` }} /></i>
        </div>
      </div>
    </section>
  );
}

function rackCapacityState(utilization: number) {
  if (utilization >= 90) return { tone: 'red', label: 'Critical' };
  if (utilization >= 75) return { tone: 'orange', label: 'High' };
  if (utilization >= 60) return { tone: 'yellow', label: 'Watch' };
  return { tone: 'green', label: 'Good' };
}

function rackDeviceHealthState(total: number, active: number, offline: number) {
  if (!total) return { tone: 'green', label: 'Empty' };
  if (offline >= Math.max(1, Math.ceil(total / 2))) return { tone: 'red', label: 'Critical' };
  if (offline > 0) return { tone: 'orange', label: 'Check' };
  if (active < total) return { tone: 'yellow', label: 'Watch' };
  return { tone: 'green', label: 'Good' };
}

function RackElevation({
  rack,
  devices,
  allDevices = devices,
  deviceTypes = [],
  onMoveDevice,
  compact = false,
}: {
  rack: InfraRecord;
  devices: InventoryDevice[];
  allDevices?: InventoryDevice[];
  deviceTypes?: DeviceTypeRecord[];
  onMoveDevice: (device: InventoryDevice, rack: InfraRecord, position: number) => Promise<void>;
  compact?: boolean;
}) {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragHoverUnit, setDragHoverUnit] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [placementMessage, setPlacementMessage] = useState('');
  const [assignTargetUnit, setAssignTargetUnit] = useState<number | null>(null);
  const [assignQuery, setAssignQuery] = useState('');
  const [rackFace, setRackFace] = useState<'front' | 'back'>('front');
  const [visualMode, setVisualMode] = useState<'drawn' | 'uploaded'>('drawn');
  const elevationRef = useRef<HTMLDivElement | null>(null);
  const [rackUnitPx, setRackUnitPx] = useState<number | null>(null);
  const units = Math.max(1, Math.min(52, numeric(rack.units) || 42));
  const occupancy = rackOccupancyFor(rack, devices, deviceTypes);
  const positioned = devices
    .map((device) => {
      const position = rackDevicePosition(device, units);
      return { device, position, height: position === null ? 1 : rackDeviceUnitHeight(device, units, position, deviceTypes) };
    })
    .filter((row): row is { device: InventoryDevice; position: number; height: number } => row.position !== null)
    .sort((a, b) => b.position - a.position || a.device.name.localeCompare(b.device.name));
  const visiblePositioned = rackFace === 'back'
    ? positioned.filter((row) => rackDeviceIsFullDepth(row.device, deviceTypes))
    : positioned;
  const unpositioned = devices
    .filter((device) => rackDevicePosition(device, units) === null)
    .sort((a, b) => a.name.localeCompare(b.name));
  const grouped = visiblePositioned.reduce((map, row) => {
    const existing = map.get(row.position) || { devices: [], height: 1 };
    existing.devices.push(row.device);
    existing.height = Math.max(existing.height, row.height);
    map.set(row.position, existing);
    return map;
  }, new Map<number, { devices: InventoryDevice[]; height: number }>());
  const usedPositions = occupiedRackUnitsFor(units, visiblePositioned);
  const blockedPositions = occupiedRackUnitsFor(units, positioned);
  const draggingDevice = draggingId === null ? null : devices.find((device) => device.id === draggingId) || null;
  const placedRackDeviceIds = new Set(positioned.map((row) => row.device.id));
  const uploadedImageCount = visiblePositioned.reduce((count, row) => {
    const profile = deviceTypeForRackDevice(row.device, deviceTypes);
    const image = rackFace === 'front' ? profile?.front_image : profile?.rear_image;
    return count + (image ? 1 : 0);
  }, 0);
  const showUploadedImages = visualMode === 'uploaded';
  useEffect(() => {
    const element = elevationRef.current;
    if (!element) return;
    const rackWidthMm = RACK_WIDTH_INCHES * 25.4;
    const minimumUHeight = showUploadedImages ? (compact ? 24 : 30) : (compact ? 20 : 26);
    const rackCabinetWidth = (outerWidth: number) => {
      const style = window.getComputedStyle(element);
      const labelWidth = Number.parseFloat(style.getPropertyValue('--rack-label-width')) || 46;
      const padX = Number.parseFloat(style.getPropertyValue('--rack-pad-x')) || 14;
      return Math.max(220, outerWidth - (labelWidth * 2) - (padX * 2));
    };
    const updateUnitHeight = (outerWidth: number) => {
      const physicalUHeight = (rackCabinetWidth(outerWidth) / rackWidthMm) * RACK_UNIT_MM;
      const next = Math.round(Math.max(minimumUHeight, Math.min(56, physicalUHeight)) * 10) / 10;
      setRackUnitPx((current) => (current === next ? current : next));
    };
    updateUnitHeight(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width || element.getBoundingClientRect().width;
      updateUnitHeight(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [compact, showUploadedImages, units]);
  const occupiedByOtherDevices = (deviceId: number) => {
    const occupied = new Set<number>();
    devices.forEach((device) => {
      if (device.id === deviceId) return;
      const position = rackDevicePosition(device, units);
      if (position === null) return;
      const height = rackDeviceUnitHeight(device, units, position, deviceTypes);
      for (let unit = position; unit < position + height && unit <= units; unit += 1) {
        occupied.add(unit);
      }
    });
    return occupied;
  };
  const canPlaceDeviceAt = (device: InventoryDevice, position: number) => {
    const height = rackDeviceRequestedUnits(device, deviceTypes);
    if (position < 1 || position + height - 1 > units) return false;
    const occupied = occupiedByOtherDevices(device.id);
    for (let unit = position; unit < position + height; unit += 1) {
      if (occupied.has(unit)) return false;
    }
    return true;
  };
  const positionFromSelectedTopUnit = (device: InventoryDevice, topUnit: number) => {
    const height = rackDeviceRequestedUnits(device, deviceTypes);
    return topUnit - height + 1;
  };
  const canPlaceDeviceDownFrom = (device: InventoryDevice, topUnit: number) => {
    return canPlaceDeviceAt(device, positionFromSelectedTopUnit(device, topUnit));
  };
  const dragPreviewPosition = draggingDevice && dragHoverUnit !== null ? positionFromSelectedTopUnit(draggingDevice, dragHoverUnit) : null;
  const dragPreviewHeight = draggingDevice ? rackDeviceRequestedUnits(draggingDevice, deviceTypes) : 1;
  const dragPreviewCanDrop = draggingDevice && dragHoverUnit !== null ? canPlaceDeviceDownFrom(draggingDevice, dragHoverUnit) : false;
  const candidateDevices = useMemo(() => {
    const query = assignQuery.trim().toLowerCase();
    const unique = new Map<number, InventoryDevice>();
    allDevices.forEach((device) => {
      if (!device?.id || placedRackDeviceIds.has(device.id)) return;
      const text = [
        device.name,
        device.hostname,
        device.management_ip,
        device.device_type,
        device.model,
        device.role,
        device.location,
        device.room,
        device.rack,
        siteOf(device),
      ].join(' ').toLowerCase();
      if (query && !text.includes(query)) return;
      unique.set(device.id, device);
    });
    return [...unique.values()].sort((a, b) => {
      const aSameLocation = sameText(a.location, rack.location) ? 0 : 1;
      const bSameLocation = sameText(b.location, rack.location) ? 0 : 1;
      return aSameLocation - bSameLocation || a.name.localeCompare(b.name);
    });
  }, [allDevices, assignQuery, placedRackDeviceIds, rack.location]);
  const openAssignPicker = (position: number) => {
    if (blockedPositions.has(position)) return;
    setAssignTargetUnit(position);
    setAssignQuery('');
    setPlacementMessage('');
  };
  const openAssignPickerFromCabinetClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('.rack-device-block')) return;
    openAssignPicker(unitFromCabinetPointer(event.currentTarget, event.clientY));
  };
  const unitFromCabinetPointer = (element: HTMLElement, clientY: number) => {
    const bounds = element.getBoundingClientRect();
    const rowHeight = bounds.height / units;
    const indexFromTop = Math.max(0, Math.min(units - 1, Math.floor((clientY - bounds.top) / rowHeight)));
    return units - indexFromTop;
  };
  const assignDeviceToUnit = async (device: InventoryDevice) => {
    if (assignTargetUnit === null) return;
    const height = rackDeviceRequestedUnits(device, deviceTypes);
    const position = positionFromSelectedTopUnit(device, assignTargetUnit);
    if (!canPlaceDeviceAt(device, position)) {
      setPlacementMessage(`${device.name} cannot fit from U${assignTargetUnit} down.`);
      return;
    }
    setSavingId(device.id);
    try {
      await onMoveDevice(device, rack, position);
      setPlacementMessage(`${device.name} added to ${rack.name} at ${rackUnitRange(position, height)}.`);
      setAssignTargetUnit(null);
      setAssignQuery('');
    } catch (error) {
      setPlacementMessage(error instanceof Error ? error.message : 'Unable to assign device to rack.');
    } finally {
      setSavingId(null);
    }
  };
  const beginDrag = (event: DragEvent<HTMLElement>, device: InventoryDevice) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-aims-device-id', String(device.id));
    setDraggingId(device.id);
    setDragHoverUnit(null);
    setPlacementMessage('');
  };
  const dropDevice = async (event: DragEvent<HTMLElement>, topUnit: number) => {
    event.preventDefault();
    const id = Number(event.dataTransfer.getData('application/x-aims-device-id') || draggingId);
    const device = devices.find((item) => item.id === id);
    if (!device) return;
    const height = rackDeviceRequestedUnits(device, deviceTypes);
    const position = positionFromSelectedTopUnit(device, topUnit);
    if (!canPlaceDeviceAt(device, position)) {
      setPlacementMessage(`${device.name} cannot fit from U${topUnit} down.`);
      return;
    }
    setSavingId(device.id);
    try {
      await onMoveDevice(device, rack, position);
      setPlacementMessage(`${device.name} moved to ${rackUnitRange(position, height)}.`);
    } catch (error) {
      setPlacementMessage(error instanceof Error ? error.message : 'Unable to update rack position.');
    } finally {
      setSavingId(null);
      setDraggingId(null);
      setDragHoverUnit(null);
    }
  };
  const handleCabinetDragOver = (event: DragEvent<HTMLDivElement>) => {
    const id = Number(event.dataTransfer.getData('application/x-aims-device-id') || draggingId);
    const device = draggingDevice || devices.find((item) => item.id === id) || null;
    if (!device) return;
    const topUnit = unitFromCabinetPointer(event.currentTarget, event.clientY);
    setDragHoverUnit(topUnit);
    event.dataTransfer.dropEffect = canPlaceDeviceDownFrom(device, topUnit) ? 'move' : 'none';
    event.preventDefault();
  };
  const handleCabinetDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dropDevice(event, unitFromCabinetPointer(event.currentTarget, event.clientY));
  };
  const renderDeviceRow = (device: InventoryDevice, position: number | null, height: number) => (
    <p
      key={`${device.id}-${position || 'open'}`}
      draggable={savingId !== device.id}
      onDragStart={(event) => beginDrag(event, device)}
      onDragEnd={() => {
        setDraggingId(null);
        setDragHoverUnit(null);
      }}
      className={savingId === device.id ? 'saving' : ''}
    >
      <span>{position ? rackUnitRange(position, height) : '-'}</span>
      <strong>{device.name}</strong>
      <em>{device.management_ip || device.role || 'No management IP'}</em>
    </p>
  );
  const assignPicker = assignTargetUnit !== null ? (
    <div className="rack-assign-popover" role="dialog" aria-modal="true" aria-label={`Add device at U${assignTargetUnit}`} onMouseDown={() => setAssignTargetUnit(null)}>
      <div className="rack-assign-card" onMouseDown={(event) => event.stopPropagation()}>
        <div className="rack-assign-head">
          <div>
            <b>Add device to {rackUnitRange(assignTargetUnit, 1)}</b>
            <span>{rack.name} | {rack.location || 'No location'}{rack.region ? ` | ${rack.region}` : ''}</span>
          </div>
          <button type="button" onClick={() => setAssignTargetUnit(null)} aria-label="Close device picker"><X size={16} /></button>
        </div>
        <label className="rack-assign-search">
          <Search size={15} />
          <input autoFocus value={assignQuery} onChange={(event) => setAssignQuery(event.target.value)} placeholder="Search device name, IP, type..." />
        </label>
        <div className="rack-assign-list">
          {candidateDevices.slice(0, 80).map((device) => {
            const height = rackDeviceRequestedUnits(device, deviceTypes);
            const position = positionFromSelectedTopUnit(device, assignTargetUnit);
            const canFit = canPlaceDeviceDownFrom(device, assignTargetUnit);
            return (
              <button key={device.id} type="button" disabled={!canFit || savingId === device.id} onClick={() => assignDeviceToUnit(device)}>
                <span>
                  <b>{device.name}</b>
                  <small>{device.management_ip || device.model || device.role || 'No management IP'}</small>
                </span>
                <em>{canFit ? rackUnitRange(position, height) : `${height}U`}</em>
                <small>{deviceRackLocationLabel(device)}</small>
              </button>
            );
          })}
          {!candidateDevices.length && <p>No available devices match this search.</p>}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <section className={`card rack-view-card${compact ? ' rack-view-card-compact' : ''}`}>
      <div className="card-title rack-view-title">
        <span>{rackFace === 'front' ? 'Front View' : 'Back View'} <small>{usedPositions.size}U visible / {units}U | {visiblePositioned.length} shown / {positioned.length} positioned</small></span>
        <span className="rack-view-controls">
          <span className="rack-segmented">
            <button type="button" className={rackFace === 'front' ? 'active' : ''} onClick={() => setRackFace('front')}>Front</button>
            <button type="button" className={rackFace === 'back' ? 'active' : ''} onClick={() => setRackFace('back')}>Back</button>
          </span>
          <span className="rack-segmented">
            <button type="button" className={visualMode === 'drawn' ? 'active' : ''} onClick={() => setVisualMode('drawn')}>Drawn</button>
            <button type="button" className={visualMode === 'uploaded' ? 'active' : ''} onClick={() => setVisualMode('uploaded')}>Uploaded image</button>
          </span>
        </span>
      </div>
      {showUploadedImages && !uploadedImageCount && <div className="rack-placement-message">No {rackFace === 'front' ? 'front' : 'rear'} device type images are assigned for positioned devices in this rack.</div>}
      {placementMessage && <div className="rack-placement-message">{placementMessage}</div>}
      <div className="rack-view-layout">
        <div className="rack-physical-wrap">
          {!compact && <div className="rack-spec-strip">
            <span>{RACK_WIDTH_INCHES} in EIA rack</span>
            <span>{units}U</span>
            <span>1U = {RACK_UNIT_MM} mm</span>
            <span>{Math.round((units * RACK_UNIT_MM) / 10)} cm rail height</span>
          </div>}
          <div ref={elevationRef} className={`rack-elevation rack-face-${rackFace}${showUploadedImages ? ' rack-elevation-uploaded' : ''}`} style={{ ['--rack-units' as string]: units, ...(rackUnitPx ? { ['--rack-u-height' as string]: `${rackUnitPx}px` } : {}) }}>
            <div className="rack-top-cap" />
            <div className="rack-rail left">
              {Array.from({ length: units }, (_, index) => units - index).map((unit) => <span key={unit}>U{unit}</span>)}
            </div>
            <div className="rack-cabinet" onClick={openAssignPickerFromCabinetClick} onDragOver={handleCabinetDragOver} onDrop={handleCabinetDrop} onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragHoverUnit(null);
            }}>
              {Array.from({ length: units }, (_, index) => {
                const unit = units - index;
                const canDrop = Boolean(draggingDevice && canPlaceDeviceDownFrom(draggingDevice, unit));
                const isBlocked = blockedPositions.has(unit);
                return (
                  <div
                    key={unit}
                    className={`rack-unit-row${usedPositions.has(unit) ? ' occupied' : ''}${draggingDevice ? ' drop-zone' : ''}${canDrop ? ' can-drop' : ''}`}
                    role={isBlocked ? undefined : 'button'}
                    tabIndex={isBlocked ? undefined : 0}
                    title={isBlocked ? undefined : `Add device at U${unit}`}
                    onDragOver={(event) => {
                      if (draggingDevice) setDragHoverUnit(unit);
                      if (canDrop) event.preventDefault();
                    }}
                    onDragEnter={() => {
                      if (draggingDevice) setDragHoverUnit(unit);
                    }}
                    onClick={() => openAssignPicker(unit)}
                    onKeyDown={(event) => {
                      if (isBlocked) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openAssignPicker(unit);
                      }
                    }}
                  />
                );
              })}
              {dragPreviewPosition !== null && (
                <div
                  className={`rack-drop-preview${dragPreviewCanDrop ? ' can-drop' : ' blocked'}`}
                  style={{ gridRow: `${rackGridStart(units, Math.max(1, dragPreviewPosition), dragPreviewHeight)} / span ${Math.min(dragPreviewHeight, units)}` }}
                >
                  {dragPreviewCanDrop ? rackUnitRange(dragPreviewPosition, dragPreviewHeight) : 'No fit'}
                </div>
              )}
              {[...grouped.entries()].map(([position, row]) => (
                <RackDeviceBlock
                  key={position}
                  row={row}
                  position={position}
                  units={units}
                  savingId={savingId}
                  rackFace={rackFace}
                  showUploadedImages={showUploadedImages}
                  deviceTypes={deviceTypes}
                  onBeginDrag={beginDrag}
                  onEndDrag={() => {
                    setDraggingId(null);
                    setDragHoverUnit(null);
                  }}
                />
              ))}
              <div className="rack-cable-lanes" aria-hidden="true">
                <i className="network" />
                <i className="compute" />
                <i className="power" />
              </div>
            </div>
            <div className="rack-rail right">
              {Array.from({ length: units }, (_, index) => units - index).map((unit) => <span key={unit}>U{unit}</span>)}
            </div>
            <div className="rack-bottom-base"><i /><i /></div>
          </div>
        </div>
        {!compact && <div className="rack-device-list">
          <div className="rack-capacity-panel">
            <b>Rack space</b>
            <p><span>{occupancy.usedUnits}U</span><strong>Occupied</strong><em>{occupancy.freeUnits}U free | {occupancy.utilization}% used</em></p>
          </div>
          <div>
            <b>Positioned devices</b>
            {positioned.length ? positioned.map(({ device, position, height }) => renderDeviceRow(device, position, height)) : <p className="rack-empty-note">No device positions recorded.</p>}
          </div>
          <div>
            <b>Unpositioned</b>
            {unpositioned.length ? unpositioned.map((device) => renderDeviceRow(device, null, rackDeviceRequestedUnits(device, deviceTypes))) : <p className="rack-empty-note">All matched devices have a rack position.</p>}
          </div>
        </div>}
      </div>
      {assignPicker && createPortal(assignPicker, document.body)}
      {compact && <div className="rack-legend"><span><i className="switch" /> Network</span><span><i className="server" /> Compute</span><span><i className="security" /> Security</span><span><i /> Other</span></div>}
    </section>
  );
}

function RackDeviceBlock({
  row,
  position,
  units,
  savingId,
  rackFace,
  showUploadedImages,
  deviceTypes,
  onBeginDrag,
  onEndDrag,
}: {
  row: { devices: InventoryDevice[]; height: number };
  position: number;
  units: number;
  savingId: number | null;
  rackFace: 'front' | 'back';
  showUploadedImages: boolean;
  deviceTypes: DeviceTypeRecord[];
  onBeginDrag: (event: DragEvent<HTMLElement>, device: InventoryDevice) => void;
  onEndDrag: () => void;
}) {
  const primary = row.devices[0];
  const profile = deviceTypeForRackDevice(primary, deviceTypes);
  const uploadedImage = rackFace === 'front' ? profile?.front_image : profile?.rear_image;
  const title = row.devices.map((device) => {
    const type = deviceTypeForRackDevice(device, deviceTypes);
    return `${device.name} | ${device.management_ip || 'No IP'} | ${rackUnitRange(position, row.height)}${type ? ` | ${deviceTypeLabel(type)}` : ''}`;
  }).join('\n');

  return (
    <div
      role="listitem"
      tabIndex={0}
      draggable={savingId !== primary.id}
      className={`rack-device-block ${rackDeviceTone(primary)}${showUploadedImages ? ' rack-device-upload-slot' : ''}${showUploadedImages && !uploadedImage ? ' no-upload-image' : ''}`}
      style={{ gridRow: `${rackGridStart(units, position, row.height)} / span ${row.height}`, ['--rack-device-u' as string]: row.height }}
      title={title}
      data-label={primary.name}
      onDragStart={(event) => onBeginDrag(event, primary)}
      onDragEnd={onEndDrag}
    >
      {showUploadedImages ? (
        uploadedImage ? (
          <>
            <span className="rack-device-image-frame">
              <img className="rack-device-upload-image" src={uploadedImage} alt={`${deviceTypeLabel(profile!)} ${rackFace}`} loading="lazy" decoding="async" />
            </span>
            <span className="rack-upload-label">{primary.name}</span>
          </>
        ) : (
          <>
            <b>{row.devices.length === 1 ? primary.name : `${row.devices.length} devices`}</b>
            <span>No {rackFace === 'front' ? 'front' : 'rear'} image on device type</span>
          </>
        )
      ) : (
        <>
          <b>{row.devices.length === 1 ? primary.name : `${row.devices.length} devices`}</b>
          <span>{rackUnitRange(position, row.height)} | {row.devices.map((device) => device.management_ip || device.role || 'Device').join(', ')}</span>
        </>
      )}
    </div>
  );
}

function RackElevationGallery({ racks, devices, deviceTypes, onOpenRack }: { racks: InfraRecord[]; devices: InventoryDevice[]; deviceTypes: DeviceTypeRecord[]; onOpenRack: (rack: InfraRecord) => void }) {
  return (
    <section className="card rack-gallery-card">
      <div className="card-title">Rack Elevation View <small>{racks.length} rack{racks.length === 1 ? '' : 's'} shown</small></div>
      <div className="rack-gallery-grid">
        {racks.map((rack) => (
          <RackMiniElevation
            key={rack.id}
            rack={rack}
            devices={relatedDevicesFor('Racks', rack, devices)}
            deviceTypes={deviceTypes}
            onOpen={() => onOpenRack(rack)}
          />
        ))}
        {!racks.length && <p className="rack-empty-note">No racks match the current filter.</p>}
      </div>
    </section>
  );
}

function RackMiniElevation({ rack, devices, deviceTypes, onOpen }: { rack: InfraRecord; devices: InventoryDevice[]; deviceTypes: DeviceTypeRecord[]; onOpen: () => void }) {
  const units = Math.max(1, Math.min(52, numeric(rack.units) || 42));
  const occupancy = rackOccupancyFor(rack, devices, deviceTypes);
  const positioned = devices
    .map((device) => {
      const position = rackDevicePosition(device, units);
      return { device, position, height: position === null ? 1 : rackDeviceUnitHeight(device, units, position, deviceTypes) };
    })
    .filter((row): row is { device: InventoryDevice; position: number; height: number } => row.position !== null);
  const grouped = positioned.reduce((map, row) => {
    for (let unit = row.position; unit < row.position + row.height && unit <= units; unit += 1) {
      const list = map.get(unit) || [];
      list.push(row.device);
      map.set(unit, list);
    }
    return map;
  }, new Map<number, InventoryDevice[]>());

  return (
    <button type="button" className="rack-mini-card" onClick={onOpen}>
      <span className="rack-mini-title">
        <b>{rack.name}</b>
        <em>{[rack.site, rack.location].filter(Boolean).join(' / ') || 'Unassigned'}</em>
      </span>
      <span className="rack-mini-elevation" style={{ ['--rack-units' as string]: units }}>
        {Array.from({ length: units }, (_, index) => {
          const unit = units - index;
          const rows = grouped.get(unit) || [];
          return (
            <i
              key={unit}
              className={rows.length ? rackDeviceTone(rows[0]) : ''}
              title={rows.length ? `U${unit}: ${rows.map((device) => device.name).join(', ')}` : `U${unit}`}
            >
              {rows.length ? <b>{rows.length > 1 ? rows.length : ''}</b> : null}
            </i>
          );
        })}
      </span>
      <span className="rack-mini-meta">
        <strong>{occupancy.utilization}%</strong> used
        <small>{occupancy.usedUnits}U occupied / {occupancy.freeUnits}U free</small>
      </span>
    </button>
  );
}

function rackDevicePosition(device: InventoryDevice, units: number) {
  const position = numeric(device.position);
  if (!position || position < 1 || position > units) return null;
  return position;
}

function rackDeviceRequestedUnits(device: InventoryDevice, deviceTypes: DeviceTypeRecord[] = []) {
  const profile = deviceTypeForRackDevice(device, deviceTypes);
  const raw = numeric(profile?.height_u)
    || numeric((device as InventoryDevice & { rack_units?: number; u_height?: number; height_units?: number }).rack_units)
    || numeric((device as InventoryDevice & { rack_units?: number; u_height?: number; height_units?: number }).u_height)
    || numeric((device as InventoryDevice & { rack_units?: number; u_height?: number; height_units?: number }).height_units)
    || 1;
  return Math.max(1, Math.min(52, Math.ceil(raw)));
}

function rackDeviceUnitHeight(device: InventoryDevice, units: number, position = 1, deviceTypes: DeviceTypeRecord[] = []) {
  const maxHeightAtPosition = Math.max(1, units - position + 1);
  return Math.max(1, Math.min(maxHeightAtPosition, rackDeviceRequestedUnits(device, deviceTypes)));
}

function occupiedRackUnitsFor(units: number, rows: { device: InventoryDevice; position: number; height: number }[]) {
  const occupiedUnits = new Set<number>();
  rows.forEach((row) => {
    const height = Math.max(1, Math.min(units - row.position + 1, row.height));
    for (let unit = row.position; unit < row.position + height && unit <= units; unit += 1) {
      occupiedUnits.add(unit);
    }
  });
  return occupiedUnits;
}

function rackOccupancyFor(rack: InfraRecord, devices: InventoryDevice[], deviceTypes: DeviceTypeRecord[] = []) {
  const units = Math.max(1, Math.min(52, numeric(rack.units) || 42));
  const positioned = devices.map((device) => {
    const position = rackDevicePosition(device, units);
    return position === null ? null : { device, position, height: rackDeviceUnitHeight(device, units, position, deviceTypes) };
  }).filter((row): row is { device: InventoryDevice; position: number; height: number } => row !== null);
  const utilizationRows = positioned.filter((row) => !rackDeviceExcludedFromUtilization(row.device, deviceTypes));
  const occupiedUnits = occupiedRackUnitsFor(units, utilizationRows);
  const usedUnits = occupiedUnits.size;
  return {
    units,
    usedUnits,
    freeUnits: Math.max(0, units - usedUnits),
    utilization: Math.round((usedUnits / units) * 100),
    occupiedUnits,
  };
}

function rackDeviceExcludedFromUtilization(device: InventoryDevice, deviceTypes: DeviceTypeRecord[] = []) {
  return Boolean(deviceTypeForRackDevice(device, deviceTypes)?.exclude_from_utilization);
}

function rackGridStart(units: number, position: number, height: number) {
  return Math.max(1, units - position - height + 2);
}

function rackUnitRange(position: number, height: number) {
  return height > 1 ? `U${position + height - 1}-U${position}` : `U${position}`;
}

function rackDeviceTone(device: InventoryDevice) {
  if (!rackDeviceIsActive(device)) return 'inactive';
  const text = [device.role, device.platform, device.model].join(' ').toLowerCase();
  if (text.includes('firewall')) return 'security';
  if (text.includes('router')) return 'router';
  if (text.includes('server')) return 'server';
  if (text.includes('switch')) return 'switch';
  return 'generic';
}

function rackDeviceIsActive(device: InventoryDevice) {
  const status = String(device.status || '').trim().toLowerCase();
  return ['active', 'up', 'online', 'reachable', 'ok'].includes(status);
}

function deviceRackLocationLabel(device: InventoryDevice) {
  const parts = [siteOf(device), device.location, device.room, device.rack].map((part) => String(part || '').trim()).filter(Boolean);
  return parts.length ? parts.join(' / ') : 'Unassigned';
}

function deviceTypeForRackDevice(device: InventoryDevice, deviceTypes: DeviceTypeRecord[]) {
  const normalize = normalizeDeviceTypeMatchValue;
  const deviceType = normalize(device.device_type);
  if (deviceType) {
    const byDeviceType = deviceTypes.find((type) => deviceTypeProfileKeys(type).includes(deviceType));
    if (byDeviceType) return byDeviceType;
  }
  const manufacturer = normalize(device.manufacturer);
  const model = normalize(device.model);
  if (manufacturer && model) {
    const hardwareKey = normalize(`${device.manufacturer} ${device.model}`);
    const byHardware = deviceTypes.find((type) => deviceTypeProfileKeys(type).includes(hardwareKey));
    if (byHardware) return byHardware;
  }
  if (model) {
    const byModel = deviceTypes.find((type) => deviceTypeProfileKeys(type).includes(model));
    if (byModel) return byModel;
  }
  return undefined;
}

function deviceTypePowerWatts(profile?: DeviceTypeRecord) {
  const raw = String(profile?.default_power_w || '').trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDeviceTypeMatchValue(value?: string | null) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function deviceTypeProfileKeys(profile: DeviceTypeRecord) {
  return [
    profile.slug,
    deviceTypeLabel(profile),
    profile.model,
    profile.manufacturer && profile.model ? `${profile.manufacturer} ${profile.model}` : '',
    profile.part_number,
  ]
    .map((value) => normalizeDeviceTypeMatchValue(value))
    .filter(Boolean);
}

function rackDeviceIsFullDepth(device: InventoryDevice, deviceTypes: DeviceTypeRecord[]) {
  const profile = deviceTypeForRackDevice(device, deviceTypes);
  return profile?.full_depth !== false;
}

function LocationRelatedWorkspace({
  data,
  activeTab,
  search,
  deviceTypes,
  onTabChange,
  onSearchChange,
}: {
  data: LocationRelatedData;
  activeTab: LocationRelatedTab;
  search: string;
  deviceTypes: DeviceTypeRecord[];
  onTabChange: (tab: LocationRelatedTab) => void;
  onSearchChange: (value: string) => void;
}) {
  const tabs: { key: LocationRelatedTab; label: string; count: number }[] = [
    { key: 'devices', label: 'Devices', count: data.devices.length },
    { key: 'aps', label: 'APs', count: data.aps.length },
    { key: 'ips', label: 'IP Addresses', count: data.ips.length },
    { key: 'vlans', label: 'VLANs', count: data.vlans.length },
    { key: 'racks', label: 'Racks', count: data.racks.length },
    { key: 'prefixes', label: 'Prefixes', count: data.prefixes.length },
  ];
  const filteredDevices = data.devices.filter((row) => searchMatch(row, search));
  const filteredAps = data.aps.filter((row) => searchMatch(row, search));
  const filteredIps = data.ips.filter((row) => searchMatch(row, search));
  const filteredVlans = data.vlans.filter((row) => searchMatch(row, search));
  const filteredRacks = data.racks.filter((row) => searchMatch(row, search));
  const filteredPrefixes = data.prefixes.filter((row) => searchMatch(row, search));
  const visibleCount = activeTab === 'devices' ? filteredDevices.length
    : activeTab === 'aps' ? filteredAps.length
    : activeTab === 'ips' ? filteredIps.length
    : activeTab === 'vlans' ? filteredVlans.length
    : activeTab === 'racks' ? filteredRacks.length
    : filteredPrefixes.length;

  return (
    <section className="card infra-related-workspace">
      <div className="infra-related-toolbar">
        <div>
          <h2>Location Relationships</h2>
          <p>Search devices, APs, IPs, VLANs, racks, prefixes, names, MACs, ports, and status in this location.</p>
        </div>
        <div className="table-search infra-global-search">
          <Search size={15} />
          <input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search anything related to this location..." />
        </div>
      </div>
      <div className="infra-related-tabs">
        {tabs.map((tab) => (
          <button type="button" key={tab.key} className={activeTab === tab.key ? 'active' : ''} onClick={() => onTabChange(tab.key)}>
            {tab.label}<b>{tab.count}</b>
          </button>
        ))}
      </div>
      <div className="infra-related-result-count">{visibleCount} result{visibleCount === 1 ? '' : 's'} shown</div>
      <div className={`infra-tab-panel ${activeTab}`}>
        {activeTab === 'devices' && <RelatedDevicesTable rows={filteredDevices} />}
        {activeTab === 'aps' && <RelatedWirelessTable rows={filteredAps} />}
        {activeTab === 'ips' && <InfraRecordsTable resource="IP Addresses" rows={filteredIps} />}
        {activeTab === 'vlans' && <InfraRecordsTable resource="VLANs" rows={filteredVlans} />}
        {activeTab === 'racks' && <InfraRecordsTable resource="Racks" rows={filteredRacks} devices={data.devices} deviceTypes={deviceTypes} />}
        {activeTab === 'prefixes' && <InfraRecordsTable resource="Prefixes" rows={filteredPrefixes} />}
      </div>
    </section>
  );
}

function RelatedDevicesTable({ rows }: { rows: InventoryDevice[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>DEVICE</th><th>MANAGEMENT IP</th><th>SITE</th><th>LOCATION</th><th>RACK</th><th>VLAN</th><th>STATUS</th></tr></thead>
        <tbody>
          {rows.map((device) => (
            <tr key={device.id}>
              <td><button type="button" className="relationship-link" onClick={() => openInventoryDeviceDetail(device)}>{device.name}</button><small>{device.role || device.platform || 'Inventory device'}</small></td>
              <td>{device.management_ip || '-'}</td>
              <td>{siteOf(device) || '-'}</td>
              <td>{device.location || '-'}</td>
              <td>{device.rack || '-'}</td>
              <td>{device.vlan || device.vlans?.map((vlan) => vlan.id).join(', ') || '-'}</td>
              <td><span className={`infra-status ${String(device.status || 'planned').toLowerCase()}`}>{device.status || 'Unknown'}</span></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7} className="empty">No related device records matched.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function RelatedWirelessTable({ rows }: { rows: WirelessAp[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>AP</th><th>IP Address</th><th>MAC</th><th>Site</th><th>Location</th><th>Clients</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((ap) => (
            <tr key={wirelessApKey(ap)}>
              <td><button type="button" className="relationship-link" onClick={() => openWirelessDetail(ap)}>{wirelessApName(ap)}</button><small>{ap.controller_name || 'Wireless controller'}</small></td>
              <td>{ap.management_ip || '-'}</td>
              <td>{ap.mac_address || '-'}</td>
              <td>{wirelessSiteOf(ap) || ap.controller_name || '-'}</td>
              <td>{ap.location || '-'}</td>
              <td>{ap.clients || 0}</td>
              <td><span className={`infra-status ${String(ap.status || 'planned').toLowerCase().replace(/\s+/g, '-')}`}>{ap.status || 'Unknown'}</span></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={7} className="empty">No wireless APs matched.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function InfraRecordsTable({ resource, rows, devices = [], deviceTypes = [] }: { resource: InfrastructureResourceName; rows: InfraRecord[]; devices?: InventoryDevice[]; deviceTypes?: DeviceTypeRecord[] }) {
  if (resource === 'Racks') {
    return (
      <div className="table-wrap">
        <table>
          <thead><tr><th>Rack</th><th>Location</th><th>Room</th><th>Status</th><th>Devices</th><th>Used U</th><th>Power usage</th><th>Power calculation</th><th>Updated</th></tr></thead>
          <tbody>
            {rows.map((record) => {
              const rackDevices = relatedDevicesFor('Racks', record, devices);
              const occupancy = rackOccupancyFor(record, rackDevices, deviceTypes);
              const power = rackPowerSummary(rackDevices, deviceTypes, record);
              return (
                <tr key={record.id}>
                  <td><button type="button" className="relationship-link" onClick={() => openInfrastructureDetail(resource, record)}>{resourceDisplayValue(resource, record)}</button><small>{record.description || 'Rack record'}</small></td>
                  <td>{record.location || '-'}</td>
                  <td>{record.region || '-'}</td>
                  <td><span className={`infra-status ${record.status.toLowerCase()}`}>{record.status}</span></td>
                  <td>{rackDevices.length}</td>
                  <td>{occupancy.usedUnits}U / {occupancy.units}U</td>
                  <td><RackListPower power={power} /></td>
                  <td>{power.watts === null ? 'No device type power values' : `${power.knownDevices} device${power.knownDevices === 1 ? '' : 's'} from Device Type${power.unknownDevices ? ` / ${power.unknownDevices} missing` : ''}`}</td>
                  <td>{formatDate(record.lastUpdated)}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={9} className="empty">No racks matched.</td></tr>}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>{resource}</th><th>SCOPE</th><th>ROLE</th><th>STATUS</th><th>UTILIZATION</th><th>UPDATED</th></tr></thead>
        <tbody>
          {rows.map((record) => (
            <tr key={record.id}>
              <td><button type="button" className="relationship-link" onClick={() => openInfrastructureDetail(resource, record)}>{resourceDisplayValue(resource, record)}</button><small>{record.description || `${resource} record`}</small></td>
              <td>{scopeValue(resource, record)}</td>
              <td>{record.role || '-'}</td>
              <td><span className={`infra-status ${record.status.toLowerCase()}`}>{record.status}</span></td>
              <td>{capacityFor(resource, record)}%</td>
              <td>{formatDate(record.lastUpdated)}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={6} className="empty">No {resource.toLowerCase()} matched.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
