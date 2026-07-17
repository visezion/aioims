import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Activity, BatteryCharging, Bell, Boxes, Cable, CircleHelp, Cpu, Database, HardDrive, MapPin, MonitorCog, MoreHorizontal, Network, Phone, PlugZap, Plus, RadioTower, Router, Search, Server, Shield, ShieldCheck, Terminal as TerminalIcon, Thermometer, UserRound, Wifi, X, Zap } from 'lucide-react';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { DeviceTypeIconGlyph, DeviceTypeRecord, deviceTypeIconKeyFor, deviceTypeIconTone, deviceTypeLabel, frontPanelKindLabel, loadDeviceTypes, type DeviceTypeIconKey } from './DeviceTypesPage';
import { SearchableSelect } from './SearchableSelect';
import { EnvironmentThresholdContext, environmentThresholdTone } from './environmentThresholds';

type DeviceInterface = {
  name: string;
  ip: string;
  status: string;
  display_status?: string;
  mac?: string;
  source?: string;
  type?: string;
  admin_status?: string;
  oper_status?: string;
  speed?: number;
  mtu?: number;
  label?: string;
  enabled?: boolean;
  parent?: string;
  lag?: string;
  mode?: string;
  description?: string;
  ip_addresses?: string[];
  cable?: string;
  connection?: string;
  connection_device_id?: number | null;
  connection_device_name?: string;
};
type DeviceVlanPort = { name: string; mode?: string; bridge_port?: number; if_index?: number; source?: string };
type DeviceVlan = { id: number; name?: string; source?: string; ports?: DeviceVlanPort[] };
type CredentialProfile = { id: number; name: string; credential_type: 'snmp_v2c' | 'ssh'; username?: string };
type Device = {
  id: number;
  name: string;
  hostname: string | null;
  management_ip: string | null;
  role: string;
  status: string;
  device_type?: string | null;
  platform: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  asset_tag?: string | null;
  mac_address?: string | null;
  discovery_source?: string | null;
  description?: string | null;
  tags?: string | null;
  site_id?: number | null;
  site?: { name: string } | null;
  vlan?: number | null;
  vlans?: DeviceVlan[] | null;
  connection?: string | null;
  interfaces?: DeviceInterface[] | null;
  snmp_status?: string | null;
  snmp_last_error?: string | null;
  config_status?: string | null;
  configuration_snapshot?: string | null;
  snmp_credential_id?: number | null;
  ssh_credential_id?: number | null;
  location?: string | null;
  room?: string | null;
  rack?: string | null;
  position?: number | null;
  rack_units?: number | null;
  power_consumption_w?: number | null;
  owner?: string | null;
  tenant?: string | null;
  comments?: string | null;
  last_seen_at?: string | null;
  discovered_at?: string | null;
};
type DeviceDeletePrompt = { type: 'single'; device: Device } | { type: 'bulk' } | null;
type Site = { id: number; name: string; location?: string | null };
type PageMeta = { page: number; per_page: number; total: number; pages: number };
type ProtocolResult = { protocol: string; status: string; latency_ms: number | null; detail: string };
type StoredRoomComponent = {
  id: string;
  roomKey?: string;
  name?: string;
  category?: string;
  type?: string;
  status?: string;
  site?: string;
  location?: string;
  room?: string;
  rack?: string;
  assignedResource?: string;
  assignedRecordId?: string;
  assignedRecordName?: string;
  x?: number;
  y?: number;
  currentValue?: string;
  unit?: string;
  monitoringEnabled?: boolean;
  dataSourceType?: string;
  updatedAt?: string;
};
type ConfigBackup = {
  id: number;
  device_id: number;
  status: string;
  source: string;
  platform?: string;
  bytes: number;
  created_by?: string;
  created_at?: string;
};
type DeviceEnvironmentSensor = { index: number; metric: 'temperature' | 'power' | 'fan' | 'power_supply'; label: string; value: number; unit: string; status: string; source: string; threshold_c?: number | null; last_shutdown_c?: number | null; state_code?: number };
type DeviceEnvironment = {
  temperature_c: number | null;
  temperature_threshold_c?: number | null;
  temperature_status?: string | null;
  power_w: number | null;
  fan_status?: string | null;
  power_supply_status?: string | null;
  temperature_sensors: DeviceEnvironmentSensor[];
  power_sensors: DeviceEnvironmentSensor[];
  fan_sensors?: DeviceEnvironmentSensor[];
  power_supply_sensors?: DeviceEnvironmentSensor[];
  sensors: DeviceEnvironmentSensor[];
  source?: string;
  error?: string;
  loading?: boolean;
};
type InfrastructurePlacementRecord = {
  id?: string;
  name: string;
  site?: string;
  location?: string;
  region?: string;
  room?: string;
  rooms?: number | string | null;
  roomNames?: string[];
  status?: string;
  role?: string;
  units?: number;
  lastUpdated?: string;
};
type DeviceForm = {
  id?: number;
  name: string;
  hostname: string;
  management_ip: string;
  role: string;
  status: string;
  device_type: string;
  platform: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  asset_tag: string;
  site_id: string;
  site_name: string;
  vlan: string;
  connection: string;
  snmp_credential_id: string;
  ssh_credential_id: string;
  interfacesText: string;
  location: string;
  room: string;
  rack: string;
  position: string;
  rack_units: string;
  power_consumption_w: string;
  owner: string;
  tenant: string;
  description: string;
  tags: string;
  comments: string;
};
type BulkEditForm = {
  role: string;
  device_type: string;
  status: string;
  site_id: string;
  site_name: string;
  vlan: string;
  connection: string;
  snmp_credential_id: string;
  ssh_credential_id: string;
  platform: string;
  location: string;
  room: string;
  rack: string;
  owner: string;
  tenant: string;
  tags: string;
};

const api = 'http://127.0.0.1:8001/api/v1';
const CREATE_NEW_VALUE = '__new__';
const CLEAR_VALUE = '__clear__';
const DEVICE_RACK_UNITS_KEY = 'aims-device-rack-units';
const roles = ['Core Switch', 'Backbone', 'Distribution Switch', 'Access Switch', 'Router', 'Firewall', 'Wireless Controller', 'Access Point', 'Server', 'UPS', 'PDU', 'Storage', 'Virtual Machine', 'Discovered Device', 'Other'];
const statuses = ['Active', 'Offline', 'Planned', 'Staging', 'Failed', 'Maintenance', 'Decommissioned', 'Retired'];
const deviceTypes = ['Switch', 'Router', 'Firewall', 'Wireless', 'Server', 'Power', 'Storage', 'Virtual', 'Other'];
const emptyForm: DeviceForm = {
  name: '',
  hostname: '',
  management_ip: '',
  role: '',
  status: 'Active',
  device_type: '',
  platform: '',
  manufacturer: '',
  model: '',
  serial_number: '',
  asset_tag: '',
  site_id: '',
  site_name: '',
  vlan: '1',
  connection: 'Ethernet',
  snmp_credential_id: '',
  ssh_credential_id: '',
  interfacesText: '',
  location: '',
  room: '',
  rack: '',
  position: '',
  rack_units: '1',
  power_consumption_w: '',
  owner: '',
  tenant: '',
  description: '',
  tags: '',
  comments: '',
};
const emptyBulkForm: BulkEditForm = {
  role: '',
  device_type: '',
  status: '',
  site_id: '',
  site_name: '',
  vlan: '',
  connection: '',
  snmp_credential_id: '',
  ssh_credential_id: '',
  platform: '',
  location: '',
  room: '',
  rack: '',
  owner: '',
  tenant: '',
  tags: '',
};

export function AdvancedDeviceInventory() {
  const [token, setToken] = useState(localStorage.getItem('aims-api-token') || '');
  const [items, setItems] = useState<Device[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [credentials, setCredentials] = useState<CredentialProfile[]>([]);
  const [deviceTypeProfiles, setDeviceTypeProfiles] = useState<DeviceTypeRecord[]>(() => loadDeviceTypes());
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [detail, setDetail] = useState<Device | null>(null);
  const [activeListDeviceId, setActiveListDeviceId] = useState<number | null>(null);
  const [actionMenuDeviceId, setActionMenuDeviceId] = useState<number | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [form, setForm] = useState<DeviceForm>(emptyForm);
  const [bulkForm, setBulkForm] = useState<BulkEditForm>(emptyBulkForm);
  const [placementDevices, setPlacementDevices] = useState<Device[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [protocolResults, setProtocolResults] = useState<Record<number, ProtocolResult[] | string>>({});
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<PageMeta>({ page: 1, per_page: 25, total: 0, pages: 1 });
  const [sort, setSort] = useState('name');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [siteFilter, setSiteFilter] = useState('All Sites');
  const [locationFilter, setLocationFilter] = useState('All Locations');
  const [typeFilter, setTypeFilter] = useState('All Types');
  const [vendorFilter, setVendorFilter] = useState('All Vendors');
  const [statusFilter, setStatusFilter] = useState('All Statuses');
  const [statusRefreshSeconds, setStatusRefreshSeconds] = useState(60);
  const [statusRefreshDraft, setStatusRefreshDraft] = useState('60');
  const [statusRefreshNote, setStatusRefreshNote] = useState('Status auto-refresh ready.');
  const [collectingConfigId, setCollectingConfigId] = useState<number | null>(null);
  const [configBackups, setConfigBackups] = useState<ConfigBackup[]>([]);
  const [configBackupBusy, setConfigBackupBusy] = useState<number | 'backup' | null>(null);
  const [deviceEnvironment, setDeviceEnvironment] = useState<Record<number, DeviceEnvironment>>({});
  const [scanningDeviceId, setScanningDeviceId] = useState<number | null>(null);
  const [bulkAction, setBulkAction] = useState<'ingest' | 'scan' | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<DeviceDeletePrompt>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [componentAssignDevice, setComponentAssignDevice] = useState<Device | null>(null);
  const [componentAssignRows, setComponentAssignRows] = useState<StoredRoomComponent[]>([]);
  const [componentAssignQuery, setComponentAssignQuery] = useState('');
  const [componentAssignSelectedId, setComponentAssignSelectedId] = useState('');
  const [componentAssignBusy, setComponentAssignBusy] = useState(false);
  const [componentAssignError, setComponentAssignError] = useState('');
  const [terminalCommand, setTerminalCommand] = useState('show version');
  const [terminalOutput, setTerminalOutput] = useState<Record<number, string>>({});
  const [terminalRunningId, setTerminalRunningId] = useState<number | null>(null);
  const terminalSocketRef = useRef<WebSocket | null>(null);
  const terminalElementRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalBufferRef = useRef<Record<number, string>>({});
  const environmentRequestedRef = useRef<Set<number>>(new Set());
  const [liveTerminalDeviceId, setLiveTerminalDeviceId] = useState<number | null>(null);
  const [liveTerminalStatus, setLiveTerminalStatus] = useState('Disconnected');
  const [detailTab, setDetailTab] = useState<'overview' | 'front' | 'interfaces' | 'vlans' | 'configuration' | 'terminal' | 'notes'>('overview');
  const [selectedInterfaceName, setSelectedInterfaceName] = useState('');
  const [infraSites, setInfraSites] = useState<InfrastructurePlacementRecord[]>(() => loadInfrastructurePlacementRecords('Sites'));
  const [infraLocations, setInfraLocations] = useState<InfrastructurePlacementRecord[]>(() => loadInfrastructurePlacementRecords('Locations'));
  const [infraRacks, setInfraRacks] = useState<InfrastructurePlacementRecord[]>(() => loadInfrastructurePlacementRecords('Racks'));
  const [newSiteName, setNewSiteName] = useState('');
  const [formCreatePlacement, setFormCreatePlacement] = useState({ site: false, location: false, rack: false });
  const [bulkCreatePlacement, setBulkCreatePlacement] = useState({ site: false, location: false, rack: false });

  const ensureToken = async (force = false) => {
    if (token && !force) return token;
    const response = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@aims.local', password: 'ChangeMe123!' }),
    });
    const json = await response.json();
    if (!response.ok || !json.data?.token) throw new Error(json.message || 'Unable to authenticate to the API.');
    localStorage.setItem('aims-api-token', json.data.token);
    setToken(json.data.token);
    return json.data.token as string;
  };

  const loadComponentsForAssignment = async () => {
    let auth = await ensureToken();
    const loadRows = async (currentAuth: string): Promise<StoredRoomComponent[]> => {
      const response = await fetch(`${api}/infrastructure/Components`, { headers: { Authorization: `Bearer ${currentAuth}` } });
      if (response.status === 401) {
        localStorage.removeItem('aims-api-token');
        auth = await ensureToken(true);
        return loadRows(auth);
      }
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load components.');
      const rows = Array.isArray(json.data?.records) ? json.data.records : [];
      return rows.filter((row: unknown): row is StoredRoomComponent => Boolean(row && typeof row === 'object' && typeof (row as StoredRoomComponent).id === 'string'));
    };
    return loadRows(auth);
  };

  const saveComponentsForAssignment = async (rows: StoredRoomComponent[]) => {
    let auth = await ensureToken();
    const saveRows = async (currentAuth: string): Promise<void> => {
      const response = await fetch(`${api}/infrastructure/Components`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${currentAuth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: rows.map((row) => ({ ...row, _merge_key: `component:${row.roomKey || ''}:${row.id || row.name || ''}`.toLowerCase() })) }),
      });
      if (response.status === 401) {
        localStorage.removeItem('aims-api-token');
        auth = await ensureToken(true);
        return saveRows(auth);
      }
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to save component assignment.');
    };
    await saveRows(auth);
    localStorage.setItem('aims-room-components', JSON.stringify(rows));
    window.dispatchEvent(new CustomEvent('aims:room-components-changed'));
  };

  const openDeviceComponentAssign = async (device: Device) => {
    setComponentAssignDevice(device);
    setComponentAssignSelectedId('');
    setComponentAssignQuery('');
    setComponentAssignError('');
    try {
      setComponentAssignRows(await loadComponentsForAssignment());
    } catch (error) {
      setComponentAssignError(error instanceof Error ? error.message : 'Unable to load components.');
    }
  };

  const assignComponentToDevice = async () => {
    if (!componentAssignDevice || !componentAssignSelectedId) return;
    const selectedComponent = componentAssignRows.find((component) => component.id === componentAssignSelectedId);
    if (!selectedComponent) return;
    const siteName = componentAssignDevice.site?.name || '';
    const roomName = componentAssignDevice.room || '';
    const now = new Date().toISOString();
    const assigned: StoredRoomComponent = {
      ...selectedComponent,
      site: siteName,
      location: componentAssignDevice.location || '',
      room: roomName,
      rack: componentAssignDevice.rack || '',
      roomKey: roomName ? [siteName, componentAssignDevice.location || '', roomName].map((part) => String(part || '').trim().toLowerCase()).join('|') : selectedComponent.roomKey || '',
      assignedResource: 'Device',
      assignedRecordId: String(componentAssignDevice.id),
      assignedRecordName: componentAssignDevice.name,
      x: Number.isFinite(Number(selectedComponent.x)) ? selectedComponent.x : 45,
      y: Number.isFinite(Number(selectedComponent.y)) ? selectedComponent.y : 45,
      updatedAt: now,
    };
    const next = componentAssignRows.map((component) => component.id === assigned.id ? assigned : component);
    setComponentAssignBusy(true);
    setComponentAssignError('');
    try {
      await saveComponentsForAssignment(next);
      setComponentAssignRows(next);
      setComponentAssignDevice(null);
      setMessage(`${assigned.name || assigned.type || 'Component'} assigned to ${componentAssignDevice.name}.`);
    } catch (error) {
      setComponentAssignError(error instanceof Error ? error.message : 'Unable to save component assignment.');
    } finally {
      setComponentAssignBusy(false);
    }
  };

  const load = async (nextPage = page) => {
    setLoading(true);
    try {
      let auth = await ensureToken();
      const params = new URLSearchParams({
        page: String(nextPage),
        per_page: String(meta.per_page),
        q: query,
        sort,
        direction,
      });
      let [devicesResponse, sitesResponse, credentialsResponse] = await Promise.all([
        fetch(`${api}/devices?${params.toString()}`, { headers: { Authorization: `Bearer ${auth}` } }),
        fetch(`${api}/sites`, { headers: { Authorization: `Bearer ${auth}` } }),
        fetch(`${api}/credentials`, { headers: { Authorization: `Bearer ${auth}` } }),
      ]);
      if (devicesResponse.status === 401 || sitesResponse.status === 401 || credentialsResponse.status === 401) {
        localStorage.removeItem('aims-api-token');
        auth = await ensureToken(true);
        [devicesResponse, sitesResponse, credentialsResponse] = await Promise.all([
          fetch(`${api}/devices?${params.toString()}`, { headers: { Authorization: `Bearer ${auth}` } }),
          fetch(`${api}/sites`, { headers: { Authorization: `Bearer ${auth}` } }),
          fetch(`${api}/credentials`, { headers: { Authorization: `Bearer ${auth}` } }),
        ]);
      }
      const devicesJson = await devicesResponse.json();
      const sitesJson = await sitesResponse.json();
      const credentialsJson = await credentialsResponse.json();
      if (!devicesResponse.ok) throw new Error(devicesJson.message || 'Unable to load devices.');
      setItems(mergeSavedRackUnits(devicesJson.data?.data || []).map((device) => withResolvedPowerConsumption(device, deviceTypeProfiles)));
      setMeta(devicesJson.data?.meta || { page: nextPage, per_page: 25, total: 0, pages: 1 });
      setSites(sitesJson.data?.data || []);
      setCredentials(credentialsJson.data?.data || []);
      const [backendSites, backendLocations, backendRacks] = await Promise.all([
        loadBackendInfrastructurePlacementRecords(auth, 'Sites'),
        loadBackendInfrastructurePlacementRecords(auth, 'Locations'),
        loadBackendInfrastructurePlacementRecords(auth, 'Racks'),
      ]);
      if (backendSites !== 'unauthorized') {
        saveInfrastructurePlacementRecords('Sites', backendSites, false);
        setInfraSites(backendSites);
      }
      if (backendLocations !== 'unauthorized') {
        saveInfrastructurePlacementRecords('Locations', backendLocations, false);
        setInfraLocations(backendLocations);
      }
      if (backendRacks !== 'unauthorized') {
        saveInfrastructurePlacementRecords('Racks', backendRacks, false);
        setInfraRacks(backendRacks);
      }
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load inventory from the Python backend.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => load(page), 250);
    return () => window.clearTimeout(timer);
  }, [query, page, sort, direction]);

  useEffect(() => {
    loadStatusConfig();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => refreshDeviceStatuses(true), Math.max(statusRefreshSeconds, 15) * 1000);
    return () => window.clearInterval(interval);
  }, [statusRefreshSeconds, page, query, sort, direction]);

  useEffect(() => {
    const open = () => openForm();
    window.addEventListener('aims:add-device', open);
    return () => window.removeEventListener('aims:add-device', open);
  }, []);

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
    const syncPlacementRecords = () => {
      setInfraSites(loadInfrastructurePlacementRecords('Sites'));
      setInfraLocations(loadInfrastructurePlacementRecords('Locations'));
      setInfraRacks(loadInfrastructurePlacementRecords('Racks'));
    };
    window.addEventListener('aims:infrastructure-locations-changed', syncPlacementRecords);
    window.addEventListener('aims:infrastructure-racks-changed', syncPlacementRecords);
    window.addEventListener('aims:infrastructure-sites-changed', syncPlacementRecords);
    window.addEventListener('storage', syncPlacementRecords);
    return () => {
      window.removeEventListener('aims:infrastructure-locations-changed', syncPlacementRecords);
      window.removeEventListener('aims:infrastructure-racks-changed', syncPlacementRecords);
      window.removeEventListener('aims:infrastructure-sites-changed', syncPlacementRecords);
      window.removeEventListener('storage', syncPlacementRecords);
    };
  }, []);

  useEffect(() => {
    const closeActionMenu = () => {
      setActionMenuDeviceId(null);
      setActionMenuPosition(null);
    };
    window.addEventListener('click', closeActionMenu);
    window.addEventListener('resize', closeActionMenu);
    window.addEventListener('scroll', closeActionMenu, true);
    return () => {
      window.removeEventListener('click', closeActionMenu);
      window.removeEventListener('resize', closeActionMenu);
      window.removeEventListener('scroll', closeActionMenu, true);
    };
  }, []);

  useEffect(() => {
    if (!detail || detailTab !== 'configuration') return;
    loadConfigBackups(detail.id);
  }, [detail?.id, detailTab]);

  useEffect(() => {
    setSelectedInterfaceName('');
  }, [detail?.id]);

  useEffect(() => {
    if (!detail) return;
    void loadDeviceEnvironment(detail.id);
  }, [detail?.id]);

  useEffect(() => {
    items
      .filter((device) => device.management_ip)
      .filter((device) => !environmentRequestedRef.current.has(device.id))
      .slice(0, 25)
      .forEach((device) => {
        environmentRequestedRef.current.add(device.id);
        void loadDeviceEnvironment(device.id);
      });
  }, [items]);

  useEffect(() => {
    if (!items.length) {
      setActiveListDeviceId(null);
      return;
    }
    setActiveListDeviceId((current) => current && items.some((device) => device.id === current) ? current : items[0].id);
  }, [items]);

  useEffect(() => {
    if (!detail || detailTab !== 'terminal' || !terminalElementRef.current) return;
    xtermRef.current?.dispose();
    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      convertEol: true,
      scrollback: 8000,
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.18,
      theme: {
        background: '#010711',
        foreground: '#d6f8dd',
        cursor: '#5ee887',
        selectionBackground: '#275b42',
        black: '#010711',
        brightGreen: '#5ee887',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalElementRef.current);
    fitAddon.fit();
    terminal.focus();
    const existing = terminalBufferRef.current[detail.id];
    terminal.write(existing || 'Connect live SSH, then type at the blinking cursor.\r\n');
    const dataDisposable = terminal.onData((data) => sendTerminalInput(data));
    const resizeDisposable = terminal.onResize((size) => {
      terminalSocketRef.current?.send(JSON.stringify({ type: 'resize', width: size.cols, height: size.rows }));
    });
    const resize = () => fitAddon.fit();
    window.addEventListener('resize', resize);
    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;
    return () => {
      window.removeEventListener('resize', resize);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      terminal.dispose();
      if (xtermRef.current === terminal) xtermRef.current = null;
      if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
    };
  }, [detail?.id, detailTab]);

  useEffect(() => {
    return () => {
      terminalSocketRef.current?.close();
    };
  }, []);

  const openForm = (device?: Device) => {
    setMessage('');
    setForm(device ? deviceToForm(device, infraRacks) : emptyForm);
    setNewSiteName('');
    setFormCreatePlacement({ site: false, location: false, rack: false });
    setShowForm(true);
    void loadPlacementDevices();
  };

  const saveDevice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const auth = await ensureToken();
      const siteName = form.site_name === CREATE_NEW_VALUE ? newSiteName.trim() : form.site_name.trim();
      const effectiveForm = { ...form, site_name: siteName, site_id: await resolveDeviceSiteId(auth, siteName, sites, setSites) };
      ensureDevicePlacementRecords(effectiveForm, formCreatePlacement);
      setInfraSites(loadInfrastructurePlacementRecords('Sites'));
      setInfraLocations(loadInfrastructurePlacementRecords('Locations'));
      setInfraRacks(loadInfrastructurePlacementRecords('Racks'));
      const payload = formToPayload(effectiveForm, deviceTypeProfiles);
      const response = await fetch(form.id ? `${api}/devices/${form.id}` : `${api}/devices`, {
        method: form.id ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to save device.');
      const savedDevice = mergeSavedRackUnits([{ ...(json.data || {}), rack_units: payload.rack_units }])[0];
      if (savedDevice?.id) {
        saveDeviceRackUnits(savedDevice.id, payload.rack_units);
        setItems((current) => mergeSavedRackUnits(current.map((device) => device.id === savedDevice.id ? savedDevice : device)));
        setDetail((current) => current?.id === savedDevice.id ? savedDevice : current);
      }
      setShowForm(false);
      setMessage(form.id ? 'Device updated.' : (json.auto_collection?.status || json.data?.config_status || 'Device created.'));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save device.');
    }
  };

  const deleteDevice = async (device: Device) => {
    setDeleteBusy(true);
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/devices/${device.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${auth}` } });
      if (!response.ok) throw new Error('Unable to delete device.');
      setDeletePrompt(null);
      setMessage('Device deleted.');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete device.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const togglePageSelected = () => {
    const pageIds = items.map((device) => device.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? selectedIds.filter((id) => !pageIds.includes(id)) : Array.from(new Set([...selectedIds, ...pageIds])));
  };

  const fetchInventoryDevicesPage = async (nextPage: number, perPage = 100): Promise<{ data: Device[]; meta: PageMeta }> => {
    let auth = await ensureToken();
    const params = new URLSearchParams({
      page: String(nextPage),
      per_page: String(perPage),
      q: query,
      sort,
      direction,
    });
    let response = await fetch(`${api}/devices?${params.toString()}`, { headers: { Authorization: `Bearer ${auth}` } });
    if (response.status === 401) {
      localStorage.removeItem('aims-api-token');
      auth = await ensureToken(true);
      response = await fetch(`${api}/devices?${params.toString()}`, { headers: { Authorization: `Bearer ${auth}` } });
    }
    const json = await response.json();
    if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load devices.');
    return {
      data: mergeSavedRackUnits(json.data?.data || []),
      meta: json.data?.meta || { page: nextPage, per_page: perPage, total: 0, pages: 1 },
    };
  };

  const fetchAllMatchingDevices = async () => {
    const first = await fetchInventoryDevicesPage(1, 100);
    const pages = Math.max(first.meta.pages || 1, 1);
    const rows = [...first.data];
    for (let nextPage = 2; nextPage <= pages; nextPage += 1) {
      const pageRows = await fetchInventoryDevicesPage(nextPage, 100);
      rows.push(...pageRows.data);
    }
    return rows;
  };

  const loadPlacementDevices = async () => {
    try {
      let auth = await ensureToken();
      const loadPage = async (nextPage: number) => {
        const params = new URLSearchParams({ page: String(nextPage), per_page: '100', sort: 'name', direction: 'asc' });
        let response = await fetch(`${api}/devices?${params.toString()}`, { headers: { Authorization: `Bearer ${auth}` } });
        if (response.status === 401) {
          localStorage.removeItem('aims-api-token');
          auth = await ensureToken(true);
          response = await fetch(`${api}/devices?${params.toString()}`, { headers: { Authorization: `Bearer ${auth}` } });
        }
        const json = await response.json();
        if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load rack positions.');
        return {
          data: mergeSavedRackUnits(json.data?.data || []),
          meta: json.data?.meta || { pages: 1 },
        } as { data: Device[]; meta: { pages?: number } };
      };
      const first = await loadPage(1);
      const pages = Math.max(1, Number(first.meta?.pages || 1));
      const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, index) => loadPage(index + 2)));
      setPlacementDevices([first, ...rest].flatMap((pageRows) => pageRows.data));
    } catch {
      setPlacementDevices(items);
    }
  };

  const fetchSelectedDevices = async () => {
    const byId = new Map(items.filter((device) => selectedIds.includes(device.id)).map((device) => [device.id, device]));
    if (byId.size < selectedIds.length) {
      const allMatching = await fetchAllMatchingDevices();
      allMatching.forEach((device) => {
        if (selectedIds.includes(device.id)) byId.set(device.id, device);
      });
    }
    return selectedIds.map((id) => byId.get(id)).filter((device): device is Device => Boolean(device));
  };

  const selectAllMatchingDevices = async () => {
    setSelectionBusy(true);
    try {
      const rows = await fetchAllMatchingDevices();
      const ids = Array.from(new Set(rows.map((device) => device.id)));
      setSelectedIds(ids);
      setMessage(`Selected ${ids.length} matching devices.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to select all matching devices.');
    } finally {
      setSelectionBusy(false);
    }
  };

  const deleteSelected = async () => {
    if (!selectedIds.length) return;
    setDeleteBusy(true);
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/devices/bulk-delete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || 'Unable to delete selected devices.');
      setDeletePrompt(null);
      setMessage(`${json.data?.deleted || selectedIds.length} selected devices deleted.`);
      setSelectedIds([]);
      await load(page);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete selected devices.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const saveBulkEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const values = bulkFormToPayload(bulkForm, deviceTypeProfiles);
      const auth = await ensureToken();
      const siteName = bulkForm.site_name === CREATE_NEW_VALUE ? newSiteName.trim() : bulkForm.site_name.trim();
      if (bulkForm.site_name === CLEAR_VALUE) values.site_id = null;
      else if (siteName) values.site_id = await resolveDeviceSiteId(auth, siteName, sites, setSites);
      if (!Object.keys(values).length) throw new Error('Set at least one field to update.');
      ensureDevicePlacementRecords({ ...emptyForm, ...bulkForm, site_name: siteName }, bulkCreatePlacement);
      setInfraSites(loadInfrastructurePlacementRecords('Sites'));
      setInfraLocations(loadInfrastructurePlacementRecords('Locations'));
      setInfraRacks(loadInfrastructurePlacementRecords('Racks'));
      const response = await fetch(`${api}/devices/bulk`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds, values }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || 'Unable to update selected devices.');
      setShowBulkEdit(false);
      setBulkForm(emptyBulkForm);
      setMessage(`${json.data?.updated || selectedIds.length} selected devices updated.`);
      await load(page);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update selected devices.');
    }
  };

  const exportCsv = async () => {
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/devices-export`, { headers: { Authorization: `Bearer ${auth}` } });
      if (!response.ok) throw new Error('Export failed.');
      const blob = await response.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'aims-devices.csv';
      link.click();
      URL.revokeObjectURL(link.href);
      setMessage('Device CSV exported.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed.');
    }
  };

  const importCsv = async (file: File) => {
    try {
      const auth = await ensureToken();
      const data = new FormData();
      data.append('file', file);
      const response = await fetch(`${api}/devices-import`, { method: 'POST', headers: { Authorization: `Bearer ${auth}` }, body: data });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Import failed.');
      setShowImport(false);
      setMessage(`Import complete. ${json.created} created, ${json.updated} updated, ${json.skipped || 0} skipped.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed.');
    }
  };

  const loadStatusConfig = async () => {
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/settings/device_status_refresh_seconds`, { headers: { Authorization: `Bearer ${auth}` } });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || 'Unable to load status refresh setting.');
      const seconds = Number(json.data?.value || 60);
      setStatusRefreshSeconds(seconds);
      setStatusRefreshDraft(String(seconds));
    } catch (error) {
      setStatusRefreshNote(error instanceof Error ? error.message : 'Unable to load status refresh setting.');
    }
  };

  const saveStatusConfig = async () => {
    try {
      const seconds = Number(statusRefreshDraft);
      if (!Number.isInteger(seconds) || seconds < 15 || seconds > 3600) throw new Error('Use 15 to 3600 seconds.');
      const auth = await ensureToken();
      const response = await fetch(`${api}/settings/device_status_refresh_seconds`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: String(seconds) }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || 'Unable to save status refresh setting.');
      setStatusRefreshSeconds(seconds);
      window.dispatchEvent(new CustomEvent('aims:status-refresh-config-changed'));
      setStatusRefreshNote(`Automatic status refresh set to every ${seconds} seconds.`);
    } catch (error) {
      setStatusRefreshNote(error instanceof Error ? error.message : 'Unable to save status refresh setting.');
    }
  };

  const refreshDeviceStatuses = async (silent = false) => {
    try {
      if (!silent) setStatusRefreshNote('Refreshing device statuses...');
      const auth = await ensureToken();
      const response = await fetch(`${api}/devices/status-refresh`, { method: 'POST', headers: { Authorization: `Bearer ${auth}` } });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || 'Unable to refresh device statuses.');
      const data = json.data || {};
      setStatusRefreshNote(`Last status refresh: ${data.checked || 0} checked, ${data.active || 0} active, ${data.offline || 0} offline, ${data.skipped || 0} skipped.`);
      await load(page);
    } catch (error) {
      setStatusRefreshNote(error instanceof Error ? error.message : 'Unable to refresh device statuses.');
    }
  };

  const checkDeviceProtocols = async (device: Device) => {
    if (!device.management_ip) {
      setProtocolResults((current) => ({ ...current, [device.id]: 'No management IP configured.' }));
      return;
    }
    setProtocolResults((current) => ({ ...current, [device.id]: 'Checking protocols...' }));
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/protocols/device/${device.id}/check?protocols=icmp,ssh,telnet,http,https,snmp&timeout=1.2`, { headers: { Authorization: `Bearer ${auth}` } });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Protocol check failed.');
      setProtocolResults((current) => ({ ...current, [device.id]: json.data?.results || 'No protocol results.' }));
    } catch (error) {
      setProtocolResults((current) => ({ ...current, [device.id]: error instanceof Error ? error.message : 'Protocol check failed.' }));
    }
  };

  const collectDeviceConfiguration = async (device: Device) => {
    if (!device.id) return;
    setCollectingConfigId(device.id);
    setMessage(`Collecting SSH configuration from ${device.name}...`);
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/devices/${device.id}/collect-config`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}` },
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'SSH configuration collection failed.');
      const updated = json.data as Device;
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDetail(updated);
      setDetailTab('configuration');
      await loadConfigBackups(updated.id);
      setMessage(`${updated.name}: ${updated.config_status || 'Configuration collection finished.'}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'SSH configuration collection failed.');
    } finally {
      setCollectingConfigId(null);
    }
  };

  const loadConfigBackups = async (deviceId: number) => {
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/devices/${deviceId}/configuration-backups`, { headers: { Authorization: `Bearer ${auth}` } });
      const json = await response.json();
      if (response.status === 404) {
        setConfigBackups([]);
        return;
      }
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load configuration backups.');
      setConfigBackups(json.data?.data || []);
    } catch (error) {
      setConfigBackups([]);
      setMessage(error instanceof Error ? error.message : 'Unable to load configuration backups.');
    }
  };

  const loadDeviceEnvironment = async (deviceId: number) => {
    setDeviceEnvironment((current) => ({ ...current, [deviceId]: { ...(current[deviceId] || {}), loading: true, error: '' } as DeviceEnvironment }));
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/devices/${deviceId}/environment`, { headers: { Authorization: `Bearer ${auth}` } });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load device environment sensors.');
      setDeviceEnvironment((current) => ({ ...current, [deviceId]: { ...(json.data || {}), loading: false } }));
    } catch (error) {
      setDeviceEnvironment((current) => ({
        ...current,
        [deviceId]: {
          temperature_c: null,
          power_w: null,
          temperature_sensors: [],
          power_sensors: [],
          fan_sensors: [],
          power_supply_sensors: [],
          sensors: [],
          loading: false,
          error: error instanceof Error ? error.message : 'Unable to load device environment sensors.',
        },
      }));
    }
  };

  const backupDeviceConfiguration = async (device: Device) => {
    if (!device.id) return;
    setConfigBackupBusy('backup');
    setMessage(`Backing up full configuration from ${device.name}...`);
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/devices/${device.id}/configuration-backups`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}` },
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Configuration backup failed.');
      const updated = json.data?.device as Device;
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDetail(updated);
      setConfigBackups(json.data?.backups || []);
      setMessage(`${updated.name}: configuration backup saved. Latest 5 backups are retained.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Configuration backup failed.');
    } finally {
      setConfigBackupBusy(null);
    }
  };

  const restoreConfigBackup = async (device: Device, backup: ConfigBackup) => {
    if (!device.id || !backup.id) return;
    setConfigBackupBusy(backup.id);
    setMessage(`Restoring configuration backup #${backup.id} for ${device.name}...`);
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/devices/${device.id}/configuration-backups/${backup.id}/restore`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}` },
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Configuration restore failed.');
      const updated = json.data as Device;
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDetail(updated);
      setMessage(`${updated.name}: configuration restored from backup #${backup.id}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Configuration restore failed.');
    } finally {
      setConfigBackupBusy(null);
    }
  };

  const fullScanAndIngestDevice = async (device: Device) => {
    if (!device.id || !device.management_ip) {
      setMessage('Device needs a management IP before full scan + ingest.');
      return;
    }
    setScanningDeviceId(device.id);
    setMessage(`Full scanning and ingesting ${device.name}...`);
    try {
      const auth = await ensureToken();
      const params = new URLSearchParams({
        subnet: `${device.management_ip}/32`,
        max_hosts: '1',
        site_name: device.site?.name || '',
        collect_config: String(Boolean(device.ssh_credential_id)),
      });
      if (device.site_id) params.set('site_id', String(device.site_id));
      if (device.snmp_credential_id) params.set('snmp_credential_id', String(device.snmp_credential_id));
      if (device.ssh_credential_id) params.set('ssh_credential_id', String(device.ssh_credential_id));
      const response = await fetch(`${api}/discovery/scan?${params.toString()}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}` },
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Full scan + ingest failed.');
      await load(page);
      setMessage(`${device.name}: full scan complete. ${json.updated || 0} updated, ${json.created || 0} created, ${json.configs_collected || 0} SSH configs collected.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Full scan + ingest failed.');
    } finally {
      setScanningDeviceId(null);
    }
  };

  const ingestSelectedDevices = async () => {
    setBulkAction('ingest');
    let ingested = 0;
    let skipped = 0;
    let failed = 0;
    try {
      const selectedDevices = await fetchSelectedDevices();
      if (!selectedDevices.length) throw new Error('No selected devices were found.');
      setMessage(`Ingesting ${selectedDevices.length} selected devices...`);
      const auth = await ensureToken();
      for (const device of selectedDevices) {
        if (!device.management_ip || !device.ssh_credential_id) {
          skipped += 1;
          continue;
        }
        const response = await fetch(`${api}/devices/${device.id}/collect-config`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth}` },
        });
        if (response.ok) {
          ingested += 1;
        } else {
          failed += 1;
        }
      }
      await load(page);
      setSelectedIds([]);
      setMessage(`Ingest selected complete. ${ingested} ingested, ${skipped} skipped, ${failed} failed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to ingest selected devices.');
    } finally {
      setBulkAction(null);
    }
  };

  const fullScanSelectedDevices = async () => {
    setBulkAction('scan');
    let scanned = 0;
    let skipped = 0;
    let failed = 0;
    let configs = 0;
    try {
      const selectedDevices = await fetchSelectedDevices();
      if (!selectedDevices.length) throw new Error('No selected devices were found.');
      setMessage(`Full scanning ${selectedDevices.length} selected devices...`);
      const auth = await ensureToken();
      for (const device of selectedDevices) {
        if (!device.management_ip) {
          skipped += 1;
          continue;
        }
        const params = new URLSearchParams({
          subnet: `${device.management_ip}/32`,
          max_hosts: '1',
          site_name: device.site?.name || '',
          collect_config: String(Boolean(device.ssh_credential_id)),
        });
        if (device.site_id) params.set('site_id', String(device.site_id));
        if (device.snmp_credential_id) params.set('snmp_credential_id', String(device.snmp_credential_id));
        if (device.ssh_credential_id) params.set('ssh_credential_id', String(device.ssh_credential_id));
        const response = await fetch(`${api}/discovery/scan?${params.toString()}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${auth}` },
        });
        const json = await response.json();
        if (response.ok) {
          scanned += 1;
          configs += json.configs_collected || 0;
        } else {
          failed += 1;
        }
      }
      await load(page);
      setSelectedIds([]);
      setMessage(`Full scan + ingest selected complete. ${scanned} scanned, ${configs} SSH configs collected, ${skipped} skipped, ${failed} failed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to full scan selected devices.');
    } finally {
      setBulkAction(null);
    }
  };

  const runDeviceTerminal = async (device: Device, event?: FormEvent) => {
    event?.preventDefault();
    if (!device.id) return;
    const command = terminalCommand.trim();
    if (!command) {
      setMessage('Enter a terminal command first.');
      return;
    }
    if (!device.management_ip || !device.ssh_credential_id) {
      setMessage('Assign a management IP and SSH credential profile before opening a terminal session.');
      return;
    }
    setTerminalRunningId(device.id);
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/devices/${device.id}/terminal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, enable: true }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'SSH terminal command failed.');
      const output = json.data?.output || json.data?.status || 'Command finished with no output.';
      setTerminalOutput((current) => ({
        ...current,
        [device.id]: [current[device.id], `${device.name || device.management_ip}# ${command}\n${output}`].filter(Boolean).join('\n\n'),
      }));
      if (json.data?.device) {
        setDetail(json.data.device);
        setItems((current) => current.map((item) => item.id === json.data.device.id ? json.data.device : item));
      }
      setMessage(`${device.name}: ${json.data?.status || 'Terminal command finished.'}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'SSH terminal command failed.');
    } finally {
      setTerminalRunningId(null);
    }
  };

  const appendTerminalOutput = (deviceId: number, output: string) => {
    terminalBufferRef.current[deviceId] = `${terminalBufferRef.current[deviceId] || ''}${output}`.slice(-200000);
    if (detail?.id === deviceId) {
      xtermRef.current?.write(output);
    }
  };

  const connectLiveTerminal = async (device: Device) => {
    if (!device.management_ip || !device.ssh_credential_id) {
      setMessage('Assign a management IP and SSH credential profile before opening a live terminal.');
      return;
    }
    terminalSocketRef.current?.close();
    setLiveTerminalStatus('Connecting...');
    appendTerminalOutput(device.id, `\r\n[opening live SSH terminal to ${device.management_ip}]\r\n`);
    try {
      const auth = await ensureToken();
      const wsUrl = `${api.replace(/^http/, 'ws')}/devices/${device.id}/terminal-stream?token=${encodeURIComponent(auth)}&width=220&height=40`;
      const socket = new WebSocket(wsUrl);
      terminalSocketRef.current = socket;
      setLiveTerminalDeviceId(device.id);
      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'output') appendTerminalOutput(device.id, payload.data || '');
          if (payload.type === 'status') {
            setLiveTerminalStatus(payload.message || 'Connected');
            appendTerminalOutput(device.id, `\r\n[${payload.message || 'Connected'}]\r\n`);
          }
          if (payload.type === 'error') {
            setLiveTerminalStatus('Error');
            appendTerminalOutput(device.id, `\r\n[error] ${payload.message || 'Terminal failed.'}\r\n`);
          }
          if (payload.type === 'closed') {
            setLiveTerminalStatus('Disconnected');
            appendTerminalOutput(device.id, `\r\n[${payload.message || 'Terminal closed.'}]\r\n`);
          }
        } catch {
          appendTerminalOutput(device.id, String(event.data || ''));
        }
      };
      socket.onopen = () => {
        setLiveTerminalStatus('Connected');
        setTimeout(() => {
          fitAddonRef.current?.fit();
          xtermRef.current?.focus();
        }, 50);
      };
      socket.onclose = () => {
        setLiveTerminalStatus('Disconnected');
        setLiveTerminalDeviceId((current) => current === device.id ? null : current);
      };
      socket.onerror = () => {
        setLiveTerminalStatus('Connection error');
      };
    } catch (error) {
      setLiveTerminalStatus('Disconnected');
      setMessage(error instanceof Error ? error.message : 'Unable to open live terminal.');
    }
  };

  const disconnectLiveTerminal = () => {
    terminalSocketRef.current?.send(JSON.stringify({ type: 'close' }));
    terminalSocketRef.current?.close();
    terminalSocketRef.current = null;
    setLiveTerminalDeviceId(null);
    setLiveTerminalStatus('Disconnected');
  };

  const sendTerminalInput = (value: string) => {
    const socket = terminalSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'input', data: value }));
  };

  const openDetail = (device: Device) => {
    const resolved = withResolvedPowerConsumption(device, deviceTypeProfiles);
    setDetailTab('overview');
    setDetail(resolved);
    void syncResolvedDevicePower(resolved);
  };

  const syncResolvedDevicePower = async (device: Device) => {
    if (device.power_consumption_w === null || device.power_consumption_w === undefined) return;
    const original = items.find((item) => item.id === device.id);
    if (original?.power_consumption_w !== null && original?.power_consumption_w !== undefined) return;
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/devices/${device.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ power_consumption_w: device.power_consumption_w }),
      });
      if (!response.ok) return;
      setItems((current) => current.map((item) => item.id === device.id ? { ...item, power_consumption_w: device.power_consumption_w } : item));
    } catch {
      // Keep the resolved UI value even if the backend is temporarily unavailable.
    }
  };

  const openDeviceById = async (deviceId: number) => {
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/devices/${deviceId}`, { headers: { Authorization: `Bearer ${auth}` } });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to open connected device.');
      const resolved = withResolvedPowerConsumption(mergeSavedRackUnits([json.data as Device])[0], deviceTypeProfiles);
      setDetailTab('overview');
      setDetail(resolved);
      void syncResolvedDevicePower(resolved);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to open connected device.');
    }
  };

  useEffect(() => {
    const open = (event: Event) => {
      const id = Number((event as CustomEvent<{ id?: number | string }>).detail?.id);
      if (Number.isFinite(id)) {
        void openDeviceById(id);
      }
    };
    window.addEventListener('aims:open-device-detail', open);
    return () => window.removeEventListener('aims:open-device-detail', open);
  }, []);

  const updateForm = (key: keyof DeviceForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const applyDeviceTypeProfile = (value: string) => {
    const profile = deviceTypeProfileForValue(value, deviceTypeProfiles);
    if (!profile) {
      setForm((current) => ({ ...current, device_type: value, position: '' }));
      return;
    }
    setForm((current) => ({
      ...current,
      device_type: profile.slug,
      manufacturer: profile.manufacturer || current.manufacturer,
      model: profile.model || current.model,
      platform: profile.default_platform || current.platform,
      rack_units: String(profile.height_u || current.rack_units || 1),
      power_consumption_w: String(deviceTypePowerWatts(profile) || ''),
      position: '',
      description: profile.description || current.description,
      tags: mergeTagText(current.tags, profile.tags),
      owner: profile.owner || current.owner,
      comments: deviceTypeComments(profile, current.comments),
    }));
  };
  const updateFormSite = (value: string) => {
    setFormCreatePlacement((current) => ({ ...current, site: value === CREATE_NEW_VALUE, location: false, rack: false }));
    setNewSiteName('');
    setForm((current) => ({ ...current, site_name: value === CREATE_NEW_VALUE ? CREATE_NEW_VALUE : value, site_id: '', location: '', room: '', rack: '', position: '' }));
  };
  const updateFormLocation = (value: string) => {
    setFormCreatePlacement((current) => ({ ...current, location: value === CREATE_NEW_VALUE, rack: false }));
    setForm((current) => ({ ...current, location: value === CREATE_NEW_VALUE ? '' : value, room: '', rack: '', position: '' }));
  };
  const updateFormRoom = (value: string) => {
    setForm((current) => ({ ...current, room: value, rack: '', position: '' }));
  };
  const updateFormRack = (value: string) => {
    setFormCreatePlacement((current) => ({ ...current, rack: value === CREATE_NEW_VALUE }));
    setForm((current) => ({ ...current, rack: value === CREATE_NEW_VALUE ? '' : value, position: '' }));
  };
  const updateBulkForm = (key: keyof BulkEditForm, value: string) => setBulkForm((current) => ({ ...current, [key]: value }));
  const updateBulkSite = (value: string) => {
    setBulkCreatePlacement((current) => ({ ...current, site: value === CREATE_NEW_VALUE, location: false, rack: false }));
    setNewSiteName('');
    setBulkForm((current) => ({ ...current, site_name: value === CREATE_NEW_VALUE ? CREATE_NEW_VALUE : value, site_id: '', location: '', room: '', rack: '' }));
  };
  const updateBulkLocation = (value: string) => {
    setBulkCreatePlacement((current) => ({ ...current, location: value === CREATE_NEW_VALUE, rack: false }));
    setBulkForm((current) => ({ ...current, location: value === CREATE_NEW_VALUE ? '' : value, room: '', rack: '' }));
  };
  const updateBulkRoom = (value: string) => {
    setBulkForm((current) => ({ ...current, room: value, rack: '' }));
  };
  const updateBulkRack = (value: string) => {
    setBulkCreatePlacement((current) => ({ ...current, rack: value === CREATE_NEW_VALUE }));
    setBulkForm((current) => ({ ...current, rack: value === CREATE_NEW_VALUE ? '' : value }));
  };
  const formSiteName = form.site_name === CREATE_NEW_VALUE ? newSiteName : form.site_name;
  const siteOptions = placementOptionsFor(infraSites, {});
  const formSiteIsCreate = formCreatePlacement.site || Boolean(form.site_name && form.site_name !== CREATE_NEW_VALUE && !siteOptions.includes(form.site_name));
  const formSiteSelectValue = formSiteIsCreate ? CREATE_NEW_VALUE : form.site_name;
  const formLocationOptions = formSiteName ? placementOptionsFor(infraLocations, { site: formSiteName }) : [];
  const formLocationRecord = findPlacementRecord(infraLocations, form.location, formSiteName);
  const formRoomOptions = roomOptionsForPlacementLocation(formLocationRecord);
  const formNeedsRoom = formRoomOptions.length > 1;
  const formRackRecords = formNeedsRoom && !form.room
    ? []
    : rackRecordsForPlacement(infraRacks, { site: formSiteName, location: form.location, room: formNeedsRoom ? form.room : '' });
  const formRackOptions = rackOptionsFromRecords(formRackRecords);
  const formLocationIsCreate = formCreatePlacement.location || Boolean(form.location && !formLocationOptions.includes(form.location));
  const formRackIsCreate = formCreatePlacement.rack || Boolean(form.rack && !(formNeedsRoom && !form.room) && !formRackOptions.some((option) => option.value === form.rack));
  const formLocationSelectValue = formLocationIsCreate ? CREATE_NEW_VALUE : form.location;
  const formRackSelectValue = formRackIsCreate ? CREATE_NEW_VALUE : form.rack;
  const formRackRecord = findPlacementRecord(infraRacks, form.rack, formSiteName, form.location, formNeedsRoom ? form.room : undefined);
  const formPositionOptions = availableRackPositionOptions(formRackRecord, placementDevices.length ? placementDevices : items, form, deviceTypeProfiles);
  const bulkSiteOptions = siteOptions;
  const bulkSiteIsCreate = bulkCreatePlacement.site || Boolean(bulkForm.site_name && ![CLEAR_VALUE, ...bulkSiteOptions].includes(bulkForm.site_name));
  const bulkSiteSelectValue = bulkSiteIsCreate ? CREATE_NEW_VALUE : bulkForm.site_name;
  const bulkSiteName = bulkForm.site_name === CREATE_NEW_VALUE ? newSiteName : bulkForm.site_name;
  const bulkLocationOptions = bulkSiteName ? placementOptionsFor(infraLocations, { site: bulkSiteName }) : [];
  const bulkLocationRecord = findPlacementRecord(infraLocations, bulkForm.location, bulkSiteName);
  const bulkRoomOptions = roomOptionsForPlacementLocation(bulkLocationRecord);
  const bulkNeedsRoom = bulkRoomOptions.length > 1;
  const bulkRackRecords = bulkNeedsRoom && !bulkForm.room
    ? []
    : rackRecordsForPlacement(infraRacks, { site: bulkSiteName, location: bulkForm.location, room: bulkNeedsRoom ? bulkForm.room : '' });
  const bulkRackOptions = rackOptionsFromRecords(bulkRackRecords);
  const bulkLocationIsCreate = bulkCreatePlacement.location || Boolean(bulkForm.location && ![CLEAR_VALUE, ...bulkLocationOptions].includes(bulkForm.location));
  const bulkRackIsCreate = bulkCreatePlacement.rack || Boolean(bulkForm.rack && !(bulkNeedsRoom && !bulkForm.room) && ![CLEAR_VALUE, ...bulkRackOptions.map((option) => option.value)].includes(bulkForm.rack));
  const bulkLocationSelectValue = bulkLocationIsCreate ? CREATE_NEW_VALUE : bulkForm.location;
  const bulkRackSelectValue = bulkRackIsCreate ? CREATE_NEW_VALUE : bulkForm.rack;
  const changeSort = (field: string) => {
    setPage(1);
    if (sort === field) {
      setDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSort(field);
    setDirection('asc');
  };
  const sortHeader = (field: string, label: string) => (
    <button type="button" className={`sort-header ${sort === field ? 'active' : ''}`} onClick={() => changeSort(field)}>
      {label}{sort === field ? ` (${direction})` : ''}
    </button>
  );
  const allPageSelected = items.length > 0 && items.every((device) => selectedIds.includes(device.id));
  const allMatchingSelected = meta.total > 0 && selectedIds.length === meta.total;
  const snmpProfiles = credentials.filter((profile) => profile.credential_type === 'snmp_v2c');
  const sshProfiles = credentials.filter((profile) => profile.credential_type === 'ssh');
  const selectedDeviceNames = items.filter((device) => selectedIds.includes(device.id)).map((device) => device.name);
  const listSiteOptions = ['All Sites', ...uniqueDeviceValues(items.map((device) => device.site?.name))];
  const listLocationOptions = ['All Locations', ...uniqueDeviceValues(items.map((device) => device.location))];
  const listTypeOptions = ['All Types', ...uniqueDeviceValues(items.map((device) => device.device_type || device.role))];
  const listVendorOptions = ['All Vendors', ...uniqueDeviceValues(items.map((device) => device.manufacturer))];
  const listStatusOptions = ['All Statuses', ...uniqueDeviceValues(items.map((device) => device.status))];
  const filteredItems = items.filter((device) => {
    if (siteFilter !== 'All Sites' && device.site?.name !== siteFilter) return false;
    if (locationFilter !== 'All Locations' && device.location !== locationFilter) return false;
    if (typeFilter !== 'All Types' && (device.device_type || device.role) !== typeFilter) return false;
    if (vendorFilter !== 'All Vendors' && device.manufacturer !== vendorFilter) return false;
    if (statusFilter !== 'All Statuses' && device.status !== statusFilter) return false;
    return true;
  });
  const activeListDevice = filteredItems.find((device) => device.id === activeListDeviceId) || filteredItems[0] || items[0] || null;
  const pageActiveCount = items.filter((item) => String(item.status || '').toLowerCase() === 'active').length;
  const pageCriticalCount = items.filter((item) => deviceHasIssue(item, deviceEnvironment[item.id])).length;
  const pageAvailability = items.length ? `${Math.round((pageActiveCount / items.length) * 10000) / 100}%` : '-';
  const pageOnlineAps = items.filter((item) => isWirelessInventoryDevice(item) && String(item.status || '').toLowerCase() === 'active').length;
  const latestSeen = latestDeviceTimestamp(items);
  const detailPhysicalInterfaces = (detail?.interfaces || []).filter(isPhysicalFrontInterface);
  const selectedInterface = selectedInterfaceName
    ? detailPhysicalInterfaces.find((item) => sameTextValue(item.name, selectedInterfaceName))
    : undefined;
  const openInterfaceFromPanel = (interfaceName: string) => {
    setSelectedInterfaceName(interfaceName);
    setDetailTab('interfaces');
  };
  const detailEnvironment = detail ? deviceEnvironment[detail.id] : undefined;
  const detailEnvironmentFailed = Boolean(detailEnvironment?.error);
  const detailTypicalPower = detail ? formatDeviceTypePowerValue(detail, deviceTypeProfiles) : null;
  const detailStoredPower = detail ? formatDeviceStoredPowerValue(detail, deviceTypeProfiles) : null;
  const detailLivePowerConsumption = detailEnvironment?.power_w !== null && detailEnvironment?.power_w !== undefined
    ? formatWattsValue(detailEnvironment.power_w)
    : null;
  const detailTemperature = detailEnvironment?.loading
    ? 'Loading...'
    : detailEnvironmentFailed
      ? 'Polling failed'
    : detailEnvironment?.temperature_c !== null && detailEnvironment?.temperature_c !== undefined
      ? `${detailEnvironment.temperature_c} C`
      : 'Not reported';
  const detailTemperatureThreshold = detailEnvironment?.temperature_threshold_c !== null && detailEnvironment?.temperature_threshold_c !== undefined
    ? `${detailEnvironment.temperature_threshold_c} C`
    : 'Not reported';
  const detailTemperatureStatus = detailEnvironment?.temperature_status ? titleCase(detailEnvironment.temperature_status) : 'Not reported';
  const detailFan = detailEnvironment?.fan_status ? titleCase(detailEnvironment.fan_status) : 'Not reported';
  const detailPowerSupply = detailEnvironment?.power_supply_status ? titleCase(detailEnvironment.power_supply_status) : 'Not reported';
  const detailPowerConsumption = detailLivePowerConsumption || detailStoredPower || 'Not exposed';
  const detailPower = detailEnvironment?.loading
    ? 'Loading...'
    : detailEnvironmentFailed
      ? 'Polling failed'
    : detailPowerConsumption !== 'Not exposed'
        ? detailPowerConsumption
        : detailEnvironment?.power_supply_status
          ? `PSU ${detailPowerSupply}`
          : 'Not reported';
  const detailStatusTone = deviceStatusTone(detail?.status);
  const detailTemperatureTone = environmentTemperatureTone(detailEnvironment, detail || undefined);
  const detailPowerTone = detailEnvironmentFailed
    ? 'danger'
    : detailEnvironment?.loading
      ? 'info'
      : detailPowerConsumption !== 'Not exposed'
        ? environmentPowerTone(detailEnvironment, detail || undefined, detail ? deviceTypeProfiles : [])
        : ['normal', 'ok'].includes(String(detailEnvironment?.power_supply_status || '').toLowerCase())
          ? 'ok'
          : 'muted';
  const detailSnmpTone = String(detail?.snmp_status || '').toLowerCase() === 'ok' ? 'ok' : detail?.snmp_status ? 'warning' : 'muted';
  const deleteDialog = deletePrompt?.type === 'single'
    ? {
        title: 'Delete device',
        itemName: deletePrompt.device.name,
        message: 'This removes the device from inventory and clears related learned operational data.',
        details: [
          deletePrompt.device.management_ip ? `Management IP: ${deletePrompt.device.management_ip}` : 'No management IP recorded',
          `Role: ${deletePrompt.device.role || 'Unassigned'}`,
          `Status: ${deletePrompt.device.status || 'Unknown'}`,
          'Related topology, interface, VLAN, and discovery data may also be removed by the backend.',
        ],
        confirmLabel: 'Delete device',
        onConfirm: () => deleteDevice(deletePrompt.device),
      }
    : deletePrompt?.type === 'bulk'
      ? {
          title: 'Delete selected devices',
          itemName: `${selectedIds.length} selected devices`,
          message: 'This removes every selected inventory record in one operation.',
          details: [
            selectedDeviceNames.length ? `On this page: ${selectedDeviceNames.slice(0, 4).join(', ')}${selectedDeviceNames.length > 4 ? '...' : ''}` : 'Selection may include devices from another page.',
            'Bulk delete also removes related learned operational data for those devices.',
            'This action cannot be undone from the UI.',
          ],
          confirmLabel: `Delete ${selectedIds.length} devices`,
          onConfirm: deleteSelected,
      }
    : null;
  const actionMenuDevice = actionMenuDeviceId
    ? items.find((device) => device.id === actionMenuDeviceId) || filteredItems.find((device) => device.id === actionMenuDeviceId) || null
    : null;

  return (
    <div className="content devices-page advanced-device-page">
      <div className="page-title">
        <div>
          <h1>Device Inventory</h1>
          <p>Production inventory with manual entry, CSV exchange, and network discovery.</p>
        </div>
        <div className="device-actions">
          <button className="plain-button" onClick={() => load(page)}>{loading ? 'Refreshing...' : 'Refresh'}</button>
          <button className="plain-button" onClick={() => setShowImport(true)}>Import CSV</button>
          <button className="plain-button" onClick={exportCsv}>Export CSV</button>
          <button className="add" onClick={() => openForm()}><Plus size={17} /> Add manually</button>
        </div>
      </div>

      {message && <div className="module-notice inventory-notice">{message}<button onClick={() => setMessage('')}><X size={15} /></button></div>}

      <div className="device-list-workspace">
        <div className="device-list-kpis">
          <DeviceListKpi icon={<Server size={18} />} tone="blue" label="Total Devices" value={meta.total} sub={`${items.length} loaded on this page`} />
          <DeviceListKpi icon={<ShieldCheck size={18} />} tone="green" label="Active Devices" value={pageActiveCount} sub="Current page" />
          <DeviceListKpi icon={<Activity size={18} />} tone="red" label="Device Issues" value={pageCriticalCount} sub="Offline, failed, SNMP, or sensor errors" />
          <DeviceListKpi icon={<Activity size={18} />} tone="cyan" label="Availability" value={pageAvailability} sub="Current page active ratio" />
          <DeviceListKpi icon={<Cable size={18} />} tone="purple" label="Online APs" value={pageOnlineAps} sub="Wireless devices on this page" />
          <DeviceListKpi icon={<Activity size={18} />} tone="orange" label="Latest Seen" value={latestSeen ? relativeTime(latestSeen) : '-'} sub={latestSeen ? formatDateTime(latestSeen) : 'No timestamp recorded'} />
        </div>

        <section className="card device-list-filters">
          <label>Site<select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>{listSiteOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Location<select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>{listLocationOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Device Type<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>{listTypeOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Vendor<select value={vendorFilter} onChange={(event) => setVendorFilter(event.target.value)}>{listVendorOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>{listStatusOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
          <div className="table-search device-list-search">
            <Search size={15} />
            <input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search hostname, IP, serial, MAC..." />
          </div>
          <button className="plain-button" onClick={() => { setSiteFilter('All Sites'); setLocationFilter('All Locations'); setTypeFilter('All Types'); setVendorFilter('All Vendors'); setStatusFilter('All Statuses'); }}>Clear filters</button>
        </section>

        <div className="device-list-layout">
          <section className="card inventory device-list-table-card">
            {selectedIds.length > 0 && (
              <div className="bulk-toolbar">
                <b>{selectedIds.length} selected</b>
                {allPageSelected && meta.total > items.length && !allMatchingSelected && (
                  <button className="plain-button" disabled={selectionBusy || Boolean(bulkAction)} onClick={selectAllMatchingDevices}>
                    {selectionBusy ? 'Selecting...' : `Select all ${meta.total} matching devices`}
                  </button>
                )}
                <button className="plain-button" disabled={selectionBusy || Boolean(bulkAction)} onClick={ingestSelectedDevices}>{bulkAction === 'ingest' ? 'Ingesting...' : 'Ingest selected'}</button>
                <button className="plain-button" disabled={selectionBusy || Boolean(bulkAction)} onClick={fullScanSelectedDevices}>{bulkAction === 'scan' ? 'Scanning...' : 'Full scan + ingest selected'}</button>
                <button className="plain-button" disabled={selectionBusy || Boolean(bulkAction)} onClick={() => { setBulkCreatePlacement({ site: false, location: false, rack: false }); setNewSiteName(''); setShowBulkEdit(true); }}>Edit selected</button>
                <button className="plain-button danger-button" disabled={selectionBusy || Boolean(bulkAction)} onClick={() => setDeletePrompt({ type: 'bulk' })}>Delete selected</button>
                <button className="plain-button" onClick={() => setSelectedIds([])}>Clear</button>
              </div>
            )}
            <div className="device-list-table-head">
              <div>
                <h2>Devices</h2>
                <p>Showing {filteredItems.length} of {items.length} loaded records</p>
              </div>
              <div>
                <select value={sort} onChange={(event) => { setPage(1); setSort(event.target.value); }}>
                  <option value="name">Name</option>
                  <option value="management_ip">Management IP</option>
                  <option value="role">Role</option>
                  <option value="status">Status</option>
                  <option value="last_seen_at">Last seen</option>
                </select>
                <select value={direction} onChange={(event) => { setPage(1); setDirection(event.target.value as 'asc' | 'desc'); }}>
                  <option value="asc">Asc</option>
                  <option value="desc">Desc</option>
                </select>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th><input type="checkbox" checked={allPageSelected} onChange={togglePageSelected} aria-label="Select all devices on this page" /></th>
                    <th>{sortHeader('name', 'Device / Hostname')}</th>
                    <th>{sortHeader('management_ip', 'Management IP')}</th>
                    <th>Vendor / Model</th>
                    <th>OS / Version</th>
                    <th>Interfaces</th>
                    <th>Temperature</th>
                    <th>Power</th>
                    <th>{sortHeader('status', 'Status')}</th>
                    <th>Last Seen</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {!items.length ? (
                    <tr><td colSpan={11} className="empty">No devices found. Add a device manually, import CSV, or use the Auto Scan page.</td></tr>
                  ) : filteredItems.map((device) => {
                    const environment = deviceEnvironment[device.id];
                    const active = activeListDevice?.id === device.id;
                    return (
                      <tr key={device.id} className={active ? 'active' : ''} onClick={() => setActiveListDeviceId(device.id)}>
                        <td><input type="checkbox" checked={selectedIds.includes(device.id)} onChange={(event) => { event.stopPropagation(); toggleSelected(device.id); }} aria-label={`Select ${device.name}`} /></td>
                        <td>
                          <div className="device-list-name">
                            <span className={`device-list-avatar ${deviceTypeTone(device, deviceTypeProfiles)}`}>{deviceTypeIcon(device, deviceTypeProfiles, 15)}</span>
                            <button className="device-link" onClick={(event) => { event.stopPropagation(); openDetail(device); }}>{device.name}</button>
                            <small>{device.hostname || device.serial_number || 'No hostname or serial'}</small>
                          </div>
                        </td>
                        <td>{device.management_ip || '-'}</td>
                        <td><b>{device.manufacturer || '-'}</b><small>{device.model || device.device_type || '-'}</small></td>
                      <td>{device.platform || '-'}</td>
                      <td>{(device.interfaces || []).length || '-'}</td>
                        <td><DeviceTemperatureCell environment={environment} device={device} /></td>
                        <td><DevicePowerCell environment={environment} device={device} deviceTypes={deviceTypeProfiles} /></td>
                        <td><span className={`status ${String(device.status || '').toLowerCase()}`}>{device.status || '-'}</span></td>
                        <td>{device.last_seen_at ? relativeTime(device.last_seen_at) : '-'}</td>
                        <td className="device-list-actions">
                          <button
                            className="device-action-menu-button"
                            type="button"
                            aria-label={`Actions for ${device.name}`}
                            aria-expanded={actionMenuDeviceId === device.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              if (actionMenuDeviceId === device.id) {
                                setActionMenuDeviceId(null);
                                setActionMenuPosition(null);
                                return;
                              }
                              const rect = event.currentTarget.getBoundingClientRect();
                              const boundary = event.currentTarget.closest('.device-list-table-card')?.getBoundingClientRect();
                              const boundaryLeft = boundary ? boundary.left + 8 : 8;
                              const boundaryRight = boundary ? boundary.right - 8 : window.innerWidth - 8;
                              const menuWidth = 132;
                              const menuHeight = 112;
                              const gap = 6;
                              const left = Math.max(boundaryLeft, Math.min(boundaryRight - menuWidth, rect.right - menuWidth));
                              const openDownTop = rect.bottom + gap;
                              const top = openDownTop + menuHeight > window.innerHeight - 8
                                ? Math.max(8, rect.top - menuHeight - gap)
                                : openDownTop;
                              setActionMenuPosition({ left, top });
                              setActionMenuDeviceId(device.id);
                            }}
                          >
                            <MoreHorizontal size={17} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {items.length > 0 && !filteredItems.length && <tr><td colSpan={11} className="empty">No devices match these filters on the loaded page.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="pagination-bar">
              <span>Showing {filteredItems.length ? 1 : 0} to {filteredItems.length} of {meta.total} results</span>
              <button className="plain-button" disabled={meta.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
              <b>{meta.page}</b>
              <button className="plain-button" disabled={meta.page >= meta.pages} onClick={() => setPage((value) => value + 1)}>Next</button>
              <span>{meta.per_page} / page</span>
            </div>
          </section>

          <DeviceListSidePanel
            device={activeListDevice}
            environment={activeListDevice ? deviceEnvironment[activeListDevice.id] : undefined}
            credentials={credentials}
            deviceTypes={deviceTypeProfiles}
            onOpenDetail={openDetail}
            onClose={() => setActiveListDeviceId(null)}
          />
        </div>
      </div>

      {actionMenuDevice && actionMenuPosition && (
        <div className="device-action-menu" style={actionMenuPosition} onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { setActionMenuDeviceId(null); setActionMenuPosition(null); openDetail(actionMenuDevice); }}>Details</button>
          <button type="button" onClick={() => { setActionMenuDeviceId(null); setActionMenuPosition(null); openForm(actionMenuDevice); }}>Edit</button>
          <button type="button" className="danger" onClick={() => { setActionMenuDeviceId(null); setActionMenuPosition(null); setDeletePrompt({ type: 'single', device: actionMenuDevice }); }}>Delete</button>
        </div>
      )}

      {showImport && (
        <div className="modal-backdrop" onMouseDown={() => setShowImport(false)}>
          <div className="device-form import-form" onMouseDown={(event) => event.stopPropagation()}>
            <div className="form-header">
              <div>
                <h2>Import devices</h2>
                <p>CSV rows are created or updated by management IP, then by device name.</p>
              </div>
              <button type="button" onClick={() => setShowImport(false)}><X /></button>
            </div>
            <input type="file" accept=".csv,text/csv" onChange={(event) => event.target.files?.[0] && importCsv(event.target.files[0])} />
            <p className="field-help">Supported columns include name, hostname, management_ip, role, status, site, vlan, vlans, connection, interfaces, platform, manufacturer, model, serial_number, asset_tag, location, rack, rack_units, power_consumption_w, owner, tenant, description, tags, and comments.</p>
          </div>
        </div>
      )}

      {detail && (
        <div className="modal-backdrop" onMouseDown={() => setDetail(null)}>
          <div className="device-form large detail-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="device-detail-hero">
              <div className="device-detail-title">
                <span className={`device-detail-icon ${deviceTypeTone(detail, deviceTypeProfiles)}`}>{deviceTypeIcon(detail, deviceTypeProfiles, 22)}</span>
                <div>
                  <h2>{detail.name}</h2>
                  <p>{[detail.hostname || 'No hostname', detail.management_ip || 'No management IP', detail.site?.name || 'Unassigned'].join(' / ')}</p>
                </div>
              </div>
              <div className="device-detail-actions">
                <span className={`status ${detail.status.toLowerCase()}`}>{detail.status}</span>
                <button type="button" onClick={() => setDetail(null)}><X /></button>
              </div>
            </div>

            <div className="device-health-grid">
              <div className={`health-card ${detailStatusTone}`}><Activity size={17} /><span>Status</span><b>{detail.status}</b></div>
              <div className="health-card info"><Cpu size={17} /><span>Platform</span><b>{detail.platform || detail.device_type || '-'}</b></div>
              <div className={`health-card ${detailTemperatureTone}`}><Thermometer size={17} /><span>Temperature</span><b>{detailTemperature}</b></div>
              <div className={`health-card ${detailPowerTone}`}><Zap size={17} /><span>Power</span><b>{detailPower}</b></div>
              <div className="health-card info"><Cable size={17} /><span>Physical ports</span><b>{detailPhysicalInterfaces.length}</b></div>
              <div className="health-card violet"><Database size={17} /><span>VLANs</span><b>{detail.vlans?.length || 0}</b></div>
              <div className={`health-card ${detailSnmpTone}`}><ShieldCheck size={17} /><span>SNMP</span><b>{detail.snmp_status || 'Not checked'}</b></div>
            </div>

            <div className="device-detail-tabs">
              {[
                ['overview', 'Overview'],
                ['interfaces', 'Interfaces'],
                ['vlans', 'VLANs'],
                ['configuration', 'Configuration'],
                ['terminal', 'Terminal'],
                ['notes', 'Notes'],
              ].map(([key, label]) => (
                <button key={key} type="button" className={detailTab === key ? 'active' : ''} onClick={() => setDetailTab(key as typeof detailTab)}>{label}</button>
              ))}
            </div>

            {detailTab === 'overview' && (
              <>
                <DeviceFrontPanel device={detail} deviceTypes={deviceTypeProfiles} onOpenTerminal={() => setDetailTab('terminal')} onOpenInterfaces={() => setDetailTab('interfaces')} onOpenInterface={openInterfaceFromPanel} />
                <div className="device-detail-layout">
                  <section className="device-detail-section">
                    <h3><Server size={16} /> Identity</h3>
                    <div className="device-detail-rows">
                      <DetailRow label="Role" value={detail.role} />
                      <DetailRow label="Type" value={detail.device_type} />
                      <DetailRow label="Hostname" value={detail.hostname} />
                      <DetailRow label="Management IP" value={detail.management_ip} />
                      <DetailRow label="MAC address" value={detail.mac_address} />
                      <DetailRow label="Discovery source" value={detail.discovery_source} />
                    </div>
                  </section>
                  <section className="device-detail-section">
                    <h3><Cpu size={16} /> Hardware</h3>
                    <div className="device-detail-rows">
                      <DetailRow label="Manufacturer" value={detail.manufacturer} />
                      <DetailRow label="Model" value={detail.model} />
                      <DetailRow label="Serial number" value={detail.serial_number} />
                      <DetailRow label="Asset tag" value={detail.asset_tag} />
                      <DetailRow label="Platform" value={detail.platform} />
                      <DetailRow label="Connection" value={detail.connection || 'Ethernet'} />
                    </div>
                  </section>
                  <section className="device-detail-section">
                    <h3><MapPin size={16} /> Placement</h3>
                    <div className="device-detail-rows">
                      <DetailRow label="Site" value={detail.site?.name} />
                      <DetailRow label="Location" value={detail.location} />
                      <DetailRow label="Rack / Position" value={[detail.rack, deviceRackPositionLabel(detail.position, deviceRackUnits(detail, deviceTypeProfiles))].filter(Boolean).join(' / ')} />
                      <DetailRow label="Type U" value={deviceRackUnits(detail, deviceTypeProfiles)} />
                      <DetailRow label="Owner" value={detail.owner} />
                      <DetailRow label="Tenant" value={detail.tenant} />
                      <DetailRow label="Primary VLAN" value={detail.vlan || 1} />
                    </div>
                  </section>
                  <section className="device-detail-section">
                    <h3><ShieldCheck size={16} /> Discovery</h3>
                    <div className="device-detail-rows">
                      <DetailRow label="SNMP status" value={detail.snmp_status} />
                      <DetailRow label="SNMP profile" value={credentialName(credentials, detail.snmp_credential_id)} />
                      <DetailRow label="SSH profile" value={credentialName(credentials, detail.ssh_credential_id)} />
                      <DetailRow label="Configuration" value={detail.config_status} />
                      <DetailRow label="Last seen" value={detail.last_seen_at} />
                      <DetailRow label="Discovered at" value={detail.discovered_at} />
                    </div>
                  </section>
                  <section className="device-detail-section full">
                    <h3><Thermometer size={16} /> Environment</h3>
                    {detailEnvironment?.error ? (
                      <p className="detail-empty">{detailEnvironment.error}</p>
                    ) : (
                      <>
                        <div className="device-detail-rows">
                          <DetailRow label="Temperature" value={detailTemperature} />
                          <DetailRow label="Shutdown threshold" value={detailTemperatureThreshold} />
                          <DetailRow label="Temperature state" value={detailTemperatureStatus} />
                          <DetailRow label="Fan" value={detailFan} />
                          <DetailRow label="Power supply" value={detailPowerSupply} />
                          <DetailRow label={detailLivePowerConsumption ? 'Live power consumption' : 'Power consumption'} value={detailPowerConsumption} />
                          <DetailRow label="Device type power" value={detailTypicalPower || 'Not set'} />
                          <DetailRow label="SNMP source" value={detailEnvironment?.source || credentialName(credentials, detail.snmp_credential_id) || 'Global SNMP community'} />
                          <DetailRow label="Sensors found" value={detailEnvironment?.sensors?.length ?? (detailEnvironment?.loading ? 'Loading...' : 0)} />
                        </div>
                        {detailEnvironment?.sensors?.length ? (
                          <div className="environment-sensor-list">
                            {detailEnvironment.sensors.slice(0, 8).map((sensor) => (
                              <p key={`${sensor.metric}-${sensor.index}`}>
                                <span>{sensor.label}</span>
                                <b>{sensor.metric === 'fan' || sensor.metric === 'power_supply' ? titleCase(sensor.status) : `${sensor.value} ${sensor.unit}`}</b>
                                <em>{sensor.metric} / {sensor.status} / {sensor.source}</em>
                              </p>
                            ))}
                          </div>
                        ) : !detailEnvironment?.loading && <p className="detail-empty">No environment sensors were reported by SNMP.</p>}
                      </>
                    )}
                  </section>
                </div>
              </>
            )}

            {detailTab === 'interfaces' && (
              <section className="device-detail-section full">
                <h3><Cable size={16} /> Physical Ports</h3>
                {selectedInterface && (
                  <div className="selected-interface-card">
                    <div>
                      <span>Selected interface</span>
                      <b>{selectedInterface.name}</b>
                      <small>{selectedInterface.description || selectedInterface.label || selectedInterface.type || 'No description'}</small>
                    </div>
                    <div><span>Status</span><b>{interfaceDisplayStatus(selectedInterface)}</b></div>
                    <div><span>Mode</span><b>{selectedInterface.mode || '-'}</b></div>
                    <div><span>Connection</span><b>{selectedInterface.connection || selectedInterface.cable || '-'}</b></div>
                  </div>
                )}
                {detailPhysicalInterfaces.length ? (
                  <div className="detail-table-wrap interface-detail-table">
                    <table>
                      <thead><tr><th>Name</th><th>Label</th><th>Enabled</th><th>Status</th><th>Type</th><th>Parent</th><th>LAG</th><th>MTU</th><th>Mode</th><th>Description</th><th>IP Addresses</th><th>Cable</th><th>Connection</th></tr></thead>
                      <tbody>{detailPhysicalInterfaces.map((item) => (
                        <tr key={`${item.name}-${item.ip}-${item.mac || ''}`} className={sameTextValue(item.name, selectedInterfaceName) ? 'selected-interface-row' : undefined}>
                          <td><b>{item.name}</b></td>
                          <td>{item.label || '-'}</td>
                          <td><span className={`status ${item.enabled === false ? 'offline' : 'active'}`}>{item.enabled === false ? 'No' : 'Yes'}</span></td>
                          <td><span className={`status ${interfaceStatusClass(interfaceDisplayStatus(item))}`}>{interfaceDisplayStatus(item)}</span></td>
                          <td>{item.type || '-'}</td>
                          <td>{item.parent || '-'}</td>
                          <td>{item.lag || '-'}</td>
                          <td>{item.mtu || '-'}</td>
                          <td>{item.mode || '-'}</td>
                          <td>{item.description || '-'}</td>
                          <td><InterfaceIps item={item} /></td>
                          <td>{item.cable || '-'}</td>
                          <td><InterfaceConnection item={item} onOpen={openDeviceById} /></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                ) : <p className="detail-empty">No physical ports recorded.</p>}
              </section>
            )}

            {detailTab === 'vlans' && (
              <section className="device-detail-section full">
                <h3><Database size={16} /> VLANs</h3>
                {detail.vlans?.length ? (
                  <div className="detail-table-wrap vlan-membership-table">
                    <table>
                      <thead><tr><th>VLAN</th><th>Name</th><th>Ports</th><th>Untagged / Access</th><th>Tagged / Trunk</th><th>Source</th></tr></thead>
                      <tbody>{detail.vlans.map((item) => (
                        <tr key={`${item.id}-${item.name || ''}`}>
                          <td><b>{item.id}</b></td>
                          <td>{item.name || `VLAN ${item.id}`}</td>
                          <td>{vlanPortCount(item)}</td>
                          <td><VlanPorts ports={vlanPortsByMode(item, 'untagged')} /></td>
                          <td><VlanPorts ports={vlanPortsByMode(item, 'tagged')} /></td>
                          <td>{item.source || 'inventory'}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                ) : <p className="detail-empty">No VLAN table recorded.</p>}
              </section>
            )}

            {detailTab === 'configuration' && (
              <section className="device-detail-section full">
                <h3><TerminalIcon size={16} /> Device Configuration</h3>
                <div className="configuration-head">
                  <DetailRow label="Status" value={detail.config_status || 'Not collected'} />
                  <DetailRow label="SSH profile" value={credentialName(credentials, detail.ssh_credential_id)} />
                </div>
                <div className="config-backup-panel">
                  <div className="config-backup-head">
                    <div>
                      <b>Configuration Backups</b>
                      <span>Automatic and manual backups retain the latest 5 full snapshots. New backups replace the oldest.</span>
                    </div>
                    <button type="button" className="add" disabled={!detail.management_ip || !detail.ssh_credential_id || configBackupBusy === 'backup'} onClick={() => backupDeviceConfiguration(detail)}>
                      {configBackupBusy === 'backup' ? 'Backing up...' : 'Backup configuration'}
                    </button>
                  </div>
                  {configBackups.length ? (
                    <div className="config-backup-list">
                      {configBackups.map((backup, index) => (
                        <div key={backup.id} className="config-backup-row">
                          <div>
                            <b>{index === 0 ? 'Latest' : `Backup ${index + 1}`}</b>
                            <span>{formatDateTime(backup.created_at)} | {backup.source || 'manual'} | {formatBytes(backup.bytes)}</span>
                            <em>{backup.status || 'Configuration backup saved.'}</em>
                          </div>
                          <button type="button" className="plain-button" disabled={configBackupBusy === backup.id} onClick={() => restoreConfigBackup(detail, backup)}>
                            {configBackupBusy === backup.id ? 'Restoring...' : 'Restore'}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="detail-empty">
                      {detail.configuration_snapshot
                        ? 'Current configuration is available. Backups will appear here after the API imports the current snapshot or after the next backup run.'
                        : 'No configuration backups yet. Create one manually or enable automatic backups in Configuration settings.'}
                    </p>
                  )}
                </div>
                {detail.configuration_snapshot ? <pre className="device-config-view">{detail.configuration_snapshot}</pre> : <p className="detail-empty">{detail.config_status || 'Not collected.'}</p>}
              </section>
            )}

            {detailTab === 'terminal' && (
              <section className="device-detail-section full terminal-workspace">
                <h3><TerminalIcon size={16} /> SSH Terminal</h3>
                <div className="terminal-meta">
                  <DetailRow label="Live status" value={liveTerminalDeviceId === detail.id ? liveTerminalStatus : 'Disconnected'} />
                </div>
                <div className="live-terminal-actions">
                  <button type="button" className="add" disabled={!detail.management_ip || !detail.ssh_credential_id || liveTerminalDeviceId === detail.id} onClick={() => connectLiveTerminal(detail)}>Connect live SSH</button>
                  <button type="button" className="plain-button" disabled={liveTerminalDeviceId !== detail.id} onClick={disconnectLiveTerminal}>Disconnect</button>
                  <button type="button" className="plain-button" onClick={() => { terminalBufferRef.current[detail.id] = ''; xtermRef.current?.clear(); xtermRef.current?.focus(); }}>Clear</button>
                </div>
                <div
                  ref={terminalElementRef}
                  className={`xterm-terminal-frame ${liveTerminalDeviceId === detail.id ? 'connected' : ''}`}
                  onMouseDown={() => xtermRef.current?.focus()}
                />
              </section>
            )}

            {detailTab === 'notes' && (
              <div className="device-detail-layout">
                <section className="device-detail-section">
                  <h3><UserRound size={16} /> Ownership</h3>
                  <div className="device-detail-rows">
                    <DetailRow label="Owner" value={detail.owner} />
                    <DetailRow label="Tenant" value={detail.tenant} />
                    <DetailRow label="Tags" value={detail.tags} />
                  </div>
                </section>
                <section className="device-detail-section">
                  <h3><Activity size={16} /> Notes</h3>
                  <div className="detail-text-block"><b>Description</b><p>{detail.description || '-'}</p></div>
                  <div className="detail-text-block"><b>Comments</b><p>{detail.comments || '-'}</p></div>
                  <div className="detail-text-block"><b>SNMP detail</b><p>{detail.snmp_last_error || '-'}</p></div>
                </section>
              </div>
            )}

            <div className="form-actions">
              <button type="button" onClick={() => setDetail(null)}>Close</button>
              <button type="button" className="plain-button" onClick={() => openDeviceComponentAssign(detail)}><Boxes size={15} /> Add Component</button>
              <button type="button" className="plain-button" disabled={!detail.management_ip || !detail.ssh_credential_id || collectingConfigId === detail.id} onClick={() => collectDeviceConfiguration(detail)}>
                {collectingConfigId === detail.id ? 'Collecting SSH...' : 'Collect SSH configuration'}
              </button>
              <button type="button" className="add" onClick={() => { setDetail(null); openForm(detail); }}>Edit device</button>
            </div>
          </div>
        </div>
      )}

      {componentAssignDevice && (
        <div className="modal-backdrop" onMouseDown={() => setComponentAssignDevice(null)}>
          <form className="device-form large component-assign-form" onSubmit={(event) => { event.preventDefault(); void assignComponentToDevice(); }} onMouseDown={(event) => event.stopPropagation()}>
            <div className="form-header">
              <div>
                <h2>Add Component to Device</h2>
                <p>{componentAssignDevice.name} / {componentAssignDevice.management_ip || 'No management IP'}</p>
              </div>
              <button type="button" onClick={() => setComponentAssignDevice(null)}><X size={18} /></button>
            </div>
            <div className="form-grid">
              <label className="full">Search components<input value={componentAssignQuery} onChange={(event) => setComponentAssignQuery(event.target.value)} placeholder="Search by name, type, category, or placement" /></label>
            </div>
            <div className="component-assign-list">
              {componentAssignRows
                .filter((component) => [component.name, component.type, component.category, component.site, component.location, component.room, component.rack].filter(Boolean).join(' ').toLowerCase().includes(componentAssignQuery.toLowerCase()))
                .map((component) => (
                  <label key={component.id} className={componentAssignSelectedId === component.id ? 'selected' : ''}>
                    <input type="radio" name="componentId" checked={componentAssignSelectedId === component.id} onChange={() => setComponentAssignSelectedId(component.id)} />
                    <span><Boxes size={15} /></span>
                    <b>{component.name || component.type || 'Unnamed component'}<small>{component.type || 'Custom component'} / {component.category || 'Uncategorized'}</small></b>
                    <em>{[component.site, component.location, component.room, component.rack].filter(Boolean).join(' / ') || 'Unassigned'}</em>
                  </label>
                ))}
              {!componentAssignRows.length && <p className="empty">No components found. Create components from the Components page first.</p>}
            </div>
            {componentAssignError && <p className="error-text">{componentAssignError}</p>}
            <p className="room-component-help">This assigns the selected component to the device and saves the placement in the backend database.</p>
            <div className="form-actions">
              <button type="button" onClick={() => setComponentAssignDevice(null)}>Cancel</button>
              <button className="add" type="submit" disabled={componentAssignBusy || !componentAssignSelectedId}>{componentAssignBusy ? 'Saving...' : 'Assign Component'}</button>
            </div>
          </form>
        </div>
      )}

      {showBulkEdit && (
        <div className="modal-backdrop" onMouseDown={() => setShowBulkEdit(false)}>
          <form className="device-form bulk-edit-form" onSubmit={saveBulkEdit} onMouseDown={(event) => event.stopPropagation()}>
            <div className="form-header">
              <div>
                <h2>Edit selected devices</h2>
                <p>Only filled fields will be applied to {selectedIds.length} selected devices.</p>
              </div>
              <button type="button" onClick={() => setShowBulkEdit(false)}><X /></button>
            </div>
            <div className="form-grid">
              <label>Role
                <SearchableSelect
                  value={bulkForm.role}
                  onChange={(value) => updateBulkForm('role', value)}
                  placeholder="No change"
                  searchPlaceholder="Search roles..."
                  options={[{ value: '', label: 'No change' }, { value: CLEAR_VALUE, label: 'Clear role' }, ...roles.map((value) => ({ value, label: value }))]}
                />
              </label>
              <label>Device type
                <SearchableSelect
                  value={bulkForm.device_type}
                  onChange={(value) => updateBulkForm('device_type', value)}
                  placeholder="No change"
                  searchPlaceholder="Search device types..."
                  options={[
                    { value: '', label: 'No change' },
                    { value: CLEAR_VALUE, label: 'Clear device type' },
                    ...deviceTypeProfiles.map((profile) => ({ value: profile.slug, label: deviceTypeLabel(profile) })),
                    ...deviceTypes
                      .filter((value) => !deviceTypeProfiles.some((profile) => profile.slug === value))
                      .map((value) => ({ value, label: value })),
                  ]}
                />
              </label>
              <label>Status<select value={bulkForm.status} onChange={(event) => updateBulkForm('status', event.target.value)}><option value="">No change</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label>Site
                <SearchableSelect
                  value={bulkSiteSelectValue}
                  onChange={updateBulkSite}
                  placeholder="No change"
                  searchPlaceholder="Search sites..."
                  options={[{ value: '', label: 'No change' }, { value: CLEAR_VALUE, label: 'Unassigned' }, ...bulkSiteOptions.map((site) => ({ value: site, label: site })), { value: CREATE_NEW_VALUE, label: '+ Add new site' }]}
                />
                {bulkSiteIsCreate && <input required value={bulkForm.site_name === CREATE_NEW_VALUE ? newSiteName : bulkForm.site_name} onChange={(event) => { setNewSiteName(event.target.value); updateBulkForm('site_name', event.target.value); }} placeholder="New site name" />}
              </label>
              <label>VLAN<input type="number" min="1" value={bulkForm.vlan} onChange={(event) => updateBulkForm('vlan', event.target.value)} placeholder="No change" /></label>
              <label>Connection<input value={bulkForm.connection} onChange={(event) => updateBulkForm('connection', event.target.value)} placeholder="No change" /></label>
              <label>SNMP profile<select value={bulkForm.snmp_credential_id} onChange={(event) => updateBulkForm('snmp_credential_id', event.target.value)}><option value="">No change</option><option value={CLEAR_VALUE}>Clear SNMP profile</option>{snmpProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
              <label>SSH profile<select value={bulkForm.ssh_credential_id} onChange={(event) => updateBulkForm('ssh_credential_id', event.target.value)}><option value="">No change</option><option value={CLEAR_VALUE}>Clear SSH profile</option>{sshProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.username ? ` (${profile.username})` : ''}</option>)}</select></label>
              <label>Platform<input value={bulkForm.platform} onChange={(event) => updateBulkForm('platform', event.target.value)} placeholder="No change" /></label>
              <label>Location
                <SearchableSelect
                  value={bulkLocationSelectValue}
                  disabled={!bulkSiteName && bulkForm.site_name !== CLEAR_VALUE}
                  onChange={updateBulkLocation}
                  placeholder="No change"
                  searchPlaceholder="Search locations..."
                  options={[{ value: '', label: 'No change' }, { value: CLEAR_VALUE, label: 'Clear location' }, ...bulkLocationOptions.map((value) => ({ value, label: value })), { value: CREATE_NEW_VALUE, label: '+ Add new location' }]}
                />
                {bulkLocationIsCreate && <input value={bulkForm.location} onChange={(event) => updateBulkForm('location', event.target.value)} placeholder="New location name" />}
              </label>
              {bulkRoomOptions.length > 1 && (
                <label>Room
                  <SearchableSelect
                    value={bulkForm.room}
                    disabled={!bulkForm.location || bulkForm.location === CLEAR_VALUE}
                    onChange={updateBulkRoom}
                    placeholder="No change"
                    searchPlaceholder="Search rooms..."
                    options={[{ value: '', label: 'Select room for rack' }, ...bulkRoomOptions.map((room) => ({ value: room, label: room }))]}
                  />
                </label>
              )}
              <label>Rack
                <SearchableSelect
                  value={bulkRackSelectValue}
                  disabled={(!bulkForm.location && bulkForm.location !== CLEAR_VALUE) || (bulkNeedsRoom && !bulkForm.room)}
                  onChange={updateBulkRack}
                  placeholder="No change"
                  searchPlaceholder="Search racks..."
                  options={[{ value: '', label: bulkNeedsRoom && !bulkForm.room ? 'Select room first' : 'No change' }, { value: CLEAR_VALUE, label: 'Clear rack' }, ...bulkRackOptions, { value: CREATE_NEW_VALUE, label: '+ Add new rack' }]}
                />
                {bulkRackIsCreate && <input value={bulkForm.rack} onChange={(event) => updateBulkForm('rack', event.target.value)} placeholder="New rack name" />}
              </label>
              <label>Owner<input value={bulkForm.owner} onChange={(event) => updateBulkForm('owner', event.target.value)} placeholder="No change" /></label>
              <label>Tenant<input value={bulkForm.tenant} onChange={(event) => updateBulkForm('tenant', event.target.value)} placeholder="No change" /></label>
              <label className="full">Tags<input value={bulkForm.tags} onChange={(event) => updateBulkForm('tags', event.target.value)} placeholder="No change" /></label>
            </div>
            <div className="form-actions">
              <button type="button" onClick={() => setShowBulkEdit(false)}>Cancel</button>
              <button className="add" type="submit">Apply to selected</button>
            </div>
          </form>
        </div>
      )}

      {showForm && (
        <div className="modal-backdrop" onMouseDown={() => setShowForm(false)}>
          <form className="device-form large" onSubmit={saveDevice} onMouseDown={(event) => event.stopPropagation()}>
            <div className="form-header">
              <div>
                <h2>{form.id ? 'Edit device' : 'Add device manually'}</h2>
                <p>Enter the production inventory fields needed for operations, discovery, and reporting.</p>
              </div>
              <button type="button" onClick={() => setShowForm(false)}><X /></button>
            </div>

            <div className="form-section">
              <h3>Device</h3>
              <div className="form-grid">
                <label>Name<input required value={form.name} onChange={(event) => updateForm('name', event.target.value)} /></label>
                <label>Role<select value={form.role} onChange={(event) => updateForm('role', event.target.value)}><option value="">Unassigned</option>{roles.map((value) => <option key={value}>{value}</option>)}</select></label>
                <label>Status<select required value={form.status} onChange={(event) => updateForm('status', event.target.value)}>{statuses.map((value) => <option key={value}>{value}</option>)}</select></label>
                <label>Type
                  <SearchableSelect
                    value={form.device_type}
                    onChange={applyDeviceTypeProfile}
                    placeholder="---------"
                    searchPlaceholder="Search device types..."
                    options={[{ value: '', label: '---------' }, ...deviceTypeProfiles.map((profile) => ({ value: profile.slug, label: deviceTypeLabel(profile) })), ...deviceTypes.map((value) => ({ value, label: value }))]}
                  />
                </label>
                <label>Description<textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} /></label>
                <label>Tags<input value={form.tags} onChange={(event) => updateForm('tags', event.target.value)} placeholder="core,production" /></label>
                <DeviceTypeProfilePreview profile={deviceTypeProfileForValue(form.device_type, deviceTypeProfiles)} />
              </div>
            </div>

            <div className="form-section">
              <h3>Network</h3>
              <div className="form-grid">
                <label>Management IP<input value={form.management_ip} onChange={(event) => updateForm('management_ip', event.target.value)} placeholder="10.10.0.10" /></label>
                <label>Hostname<input value={form.hostname} onChange={(event) => updateForm('hostname', event.target.value)} /></label>
                <label>VLAN<input type="number" min="1" value={form.vlan} onChange={(event) => updateForm('vlan', event.target.value)} /></label>
                <label>Connection<input value={form.connection} onChange={(event) => updateForm('connection', event.target.value)} placeholder="Ethernet, Fiber, MPLS" /></label>
                <label>SNMP profile<select value={form.snmp_credential_id} onChange={(event) => updateForm('snmp_credential_id', event.target.value)}><option value="">Use scan/global default</option>{snmpProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
                <label>SSH profile<select value={form.ssh_credential_id} onChange={(event) => updateForm('ssh_credential_id', event.target.value)}><option value="">No SSH profile</option>{sshProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.username ? ` (${profile.username})` : ''}</option>)}</select></label>
                <label className="full">Interfaces<textarea value={form.interfacesText} onChange={(event) => updateForm('interfacesText', event.target.value)} placeholder={'Gi1/0/1,10.10.0.10,up\nGi1/0/2,,down'} /></label>
              </div>
            </div>

            <div className="form-section">
              <h3>Hardware and Location</h3>
              <div className="form-grid">
                <label>Platform<input value={form.platform} onChange={(event) => updateForm('platform', event.target.value)} /></label>
                <label>Manufacturer<input value={form.manufacturer} onChange={(event) => updateForm('manufacturer', event.target.value)} /></label>
                <label>Model<input value={form.model} onChange={(event) => updateForm('model', event.target.value)} /></label>
                <label>Power consumption (W)<input type="number" min="0" step="0.1" value={form.power_consumption_w} onChange={(event) => updateForm('power_consumption_w', event.target.value)} /></label>
                <label>Serial number<input value={form.serial_number} onChange={(event) => updateForm('serial_number', event.target.value)} /></label>
                <label>Asset tag<input value={form.asset_tag} onChange={(event) => updateForm('asset_tag', event.target.value)} /></label>
                <label>Site
                  <SearchableSelect
                    value={formSiteSelectValue}
                    onChange={updateFormSite}
                    placeholder="Unassigned"
                    searchPlaceholder="Search sites..."
                    options={[{ value: '', label: 'Unassigned' }, ...siteOptions.map((site) => ({ value: site, label: site })), { value: CREATE_NEW_VALUE, label: '+ Add new site' }]}
                  />
                  {formSiteIsCreate && <input required value={form.site_name === CREATE_NEW_VALUE ? newSiteName : form.site_name} onChange={(event) => { setNewSiteName(event.target.value); updateForm('site_name', event.target.value); }} placeholder="New site name" />}
                </label>
                <label>Location
                  <SearchableSelect
                    value={formLocationSelectValue}
                    disabled={!formSiteName}
                    onChange={updateFormLocation}
                    placeholder="Unassigned"
                    searchPlaceholder="Search locations..."
                    options={[{ value: '', label: 'Unassigned' }, ...formLocationOptions.map((value) => ({ value, label: value })), { value: CREATE_NEW_VALUE, label: '+ Add new location' }]}
                  />
                  {formLocationIsCreate && <input required value={form.location} onChange={(event) => updateForm('location', event.target.value)} placeholder="New location name" />}
                </label>
                {formRoomOptions.length > 1 && (
                  <label>Room
                    <SearchableSelect
                      value={form.room}
                      disabled={!form.location}
                      onChange={updateFormRoom}
                      placeholder="Select room"
                      searchPlaceholder="Search rooms..."
                      options={[{ value: '', label: 'Select room for rack' }, ...formRoomOptions.map((room) => ({ value: room, label: room }))]}
                    />
                  </label>
                )}
                <label>Rack
                  <SearchableSelect
                    value={formRackSelectValue}
                    disabled={!form.location || (formNeedsRoom && !form.room)}
                    onChange={updateFormRack}
                    placeholder="Unassigned"
                    searchPlaceholder="Search racks..."
                    options={[{ value: '', label: formNeedsRoom && !form.room ? 'Select room first' : 'Unassigned' }, ...formRackOptions, { value: CREATE_NEW_VALUE, label: '+ Add new rack' }]}
                  />
                  {formRackIsCreate && <input required value={form.rack} onChange={(event) => updateForm('rack', event.target.value)} placeholder="New rack name" />}
                </label>
                <label>Position<select value={form.position} disabled={!form.rack || !formPositionOptions.length} onChange={(event) => updateForm('position', event.target.value)}><option value="">{form.rack && !formPositionOptions.length ? 'No available positions' : 'Unassigned'}</option>{formPositionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              </div>
            </div>

            <div className="form-section">
              <h3>Ownership</h3>
              <div className="form-grid">
                <label>Owner<input value={form.owner} onChange={(event) => updateForm('owner', event.target.value)} /></label>
                <label>Tenant<input value={form.tenant} onChange={(event) => updateForm('tenant', event.target.value)} /></label>
                <label className="full">Comments<textarea value={form.comments} onChange={(event) => updateForm('comments', event.target.value)} /></label>
              </div>
            </div>

            <div className="form-actions">
              <button type="button" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="add" type="submit">{form.id ? 'Save changes' : 'Create device'}</button>
            </div>
          </form>
        </div>
      )}

      {deleteDialog && (
        <DeleteConfirmDialog
          open
          title={deleteDialog.title}
          itemName={deleteDialog.itemName}
          message={deleteDialog.message}
          details={deleteDialog.details}
          confirmLabel={deleteDialog.confirmLabel}
          busy={deleteBusy}
          onCancel={() => !deleteBusy && setDeletePrompt(null)}
          onConfirm={deleteDialog.onConfirm}
        />
      )}
    </div>
  );
}

function deviceToForm(device: Device, racks: InfrastructurePlacementRecord[] = []): DeviceForm {
  const inferredRoom = device.room || uniqueRackRoomForDevice(device, racks) || '';
  return {
    id: device.id,
    name: device.name || '',
    hostname: device.hostname || '',
    management_ip: device.management_ip || '',
    role: device.role || '',
    status: device.status || 'Active',
    device_type: device.device_type || '',
    platform: device.platform || '',
    manufacturer: device.manufacturer || '',
    model: device.model || '',
    serial_number: device.serial_number || '',
    asset_tag: device.asset_tag || '',
    site_id: device.site_id ? String(device.site_id) : '',
    site_name: device.site?.name || '',
    vlan: String(device.vlan || 1),
    connection: device.connection || 'Ethernet',
    snmp_credential_id: device.snmp_credential_id ? String(device.snmp_credential_id) : '',
    ssh_credential_id: device.ssh_credential_id ? String(device.ssh_credential_id) : '',
    interfacesText: (device.interfaces || []).map((item) => [item.name, item.ip, item.status].join(',')).join('\n'),
    location: device.location || '',
    room: inferredRoom,
    rack: device.rack || '',
    position: device.position ? String(device.position) : '',
    rack_units: String(device.rack_units || 1),
    power_consumption_w: device.power_consumption_w !== null && device.power_consumption_w !== undefined ? String(device.power_consumption_w) : '',
    owner: device.owner || '',
    tenant: device.tenant || '',
    description: device.description || '',
    tags: device.tags || '',
    comments: device.comments || '',
  };
}

function uniqueRackRoomForDevice(device: Device, racks: InfrastructurePlacementRecord[]) {
  const rackName = String(device.rack || '').trim().toLowerCase();
  if (!rackName) return '';
  const siteName = String(device.site?.name || '').trim().toLowerCase();
  const location = String(device.location || '').trim().toLowerCase();
  const matches = racks.filter((rack) => {
    if (String(rack.name || '').trim().toLowerCase() !== rackName) return false;
    if (siteName && String(rack.site || '').trim().toLowerCase() !== siteName) return false;
    if (location && String(rack.location || '').trim().toLowerCase() !== location) return false;
    return true;
  });
  const rooms = [...new Set(matches.map((rack) => rackRoomName(rack)).filter(Boolean))];
  return rooms.length === 1 ? rooms[0] : '';
}

function loadSavedRackUnits() {
  try {
    const value = JSON.parse(localStorage.getItem(DEVICE_RACK_UNITS_KEY) || '{}');
    return value && typeof value === 'object' ? value as Record<string, number> : {};
  } catch {
    return {};
  }
}

function saveDeviceRackUnits(deviceId: number | string, rackUnits: number) {
  const units = Math.max(1, Math.min(52, Number(rackUnits || 1) || 1));
  const saved = loadSavedRackUnits();
  saved[String(deviceId)] = units;
  localStorage.setItem(DEVICE_RACK_UNITS_KEY, JSON.stringify(saved));
}

function mergeSavedRackUnits(devices: Device[]) {
  const saved = loadSavedRackUnits();
  return devices.map((device) => {
    const savedUnits = saved[String(device.id)];
    if (!savedUnits) return device;
    if (Number(device.rack_units || 1) === savedUnits) return device;
    return { ...device, rack_units: savedUnits };
  });
}

function deviceTypeProfileForValue(value: string | null | undefined, deviceTypes: DeviceTypeRecord[]) {
  const normalized = normalizeDeviceTypeMatchValue(value);
  if (!normalized) return undefined;
  return deviceTypes.find((profile) => deviceTypeProfileKeys(profile).includes(normalized));
}

function deviceTypeProfileForDevice(device: Pick<Device, 'device_type' | 'manufacturer' | 'model'>, deviceTypes: DeviceTypeRecord[]) {
  const bySlug = deviceTypeProfileForValue(device.device_type, deviceTypes);
  if (bySlug) return bySlug;
  const manufacturer = normalizeDeviceTypeMatchValue(device.manufacturer);
  const model = normalizeDeviceTypeMatchValue(device.model);
  if (manufacturer && model) {
    const hardwareKey = normalizeDeviceTypeMatchValue(`${device.manufacturer} ${device.model}`);
    const byHardware = deviceTypes.find((profile) => deviceTypeProfileKeys(profile).includes(hardwareKey));
    if (byHardware) return byHardware;
  }
  if (model) return deviceTypes.find((profile) => deviceTypeProfileKeys(profile).includes(model));
  return undefined;
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

function rackUnitsFromTypeHeight(value: unknown) {
  const parsed = Number(value);
  return Math.max(1, Math.min(52, Math.ceil(Number.isFinite(parsed) && parsed > 0 ? parsed : 1)));
}

function deviceFormRackUnits(form: DeviceForm, deviceTypes: DeviceTypeRecord[]) {
  const profile = deviceTypeProfileForValue(form.device_type, deviceTypes);
  if (profile?.height_u) return rackUnitsFromTypeHeight(profile.height_u);
  return rackUnitsFromTypeHeight(form.rack_units);
}

function deviceFormPowerConsumptionWatts(form: DeviceForm, deviceTypes: DeviceTypeRecord[]) {
  const profile = deviceTypeProfileForValue(form.device_type, deviceTypes);
  const typeWatts = deviceTypePowerWatts(profile);
  if (typeWatts !== null) return typeWatts;
  const formWatts = Number(form.power_consumption_w);
  return Number.isFinite(formWatts) && formWatts >= 0 ? formWatts : null;
}

function deviceRackUnits(device: Pick<Device, 'device_type' | 'manufacturer' | 'model' | 'rack_units'>, deviceTypes: DeviceTypeRecord[]) {
  const profile = deviceTypeProfileForDevice(device, deviceTypes);
  if (profile?.height_u) return rackUnitsFromTypeHeight(profile.height_u);
  return rackUnitsFromTypeHeight(device.rack_units);
}

function ProtocolResultBlock({ value }: { value: ProtocolResult[] | string }) {
  if (typeof value === 'string') return <small className="protocol-result">{value}</small>;
  return (
    <div className="protocol-result">
      {value.map((item) => (
        <span key={item.protocol} className={`protocol-line ${item.status}`}>
          {item.protocol.toUpperCase()}: {item.status}{item.latency_ms !== null ? ` (${item.latency_ms} ms)` : ''}<em>{item.detail}</em>
        </span>
      ))}
    </div>
  );
}

function DiscoveryBadge({ device }: { device: Device }) {
  const state = discoveryState(device);
  return (
    <span className={`discovery-badge ${state.className}`} title={state.detail}>
      {state.label}
    </span>
  );
}

function discoveryState(device: Device) {
  const source = (device.discovery_source || '').toLowerCase();
  const tags = (device.tags || '').toLowerCase();
  const config = (device.config_status || '').toLowerCase();
  const snmp = (device.snmp_status || '').toLowerCase();
  if (tags.includes('not-fully-scanned') || (source.includes('topology-neighbor') && !source.includes('snmp') && !source.includes('ssh-config'))) {
    return { label: 'Neighbor only', className: 'neighbor', detail: 'Learned from LLDP/CDP topology only. Not fully scanned into inventory.' };
  }
  if (source.includes('ssh-config') || config.includes('configuration collected')) {
    return { label: 'SSH ingested', className: 'ingested', detail: 'Device has SSH-collected configuration and inventory details.' };
  }
  if (source.includes('snmp') || snmp === 'ok') {
    return { label: 'SNMP scanned', className: 'scanned', detail: 'Device has SNMP-discovered inventory details.' };
  }
  if (source.includes('ping') || source.includes('rdns') || tags.includes('auto-discovered')) {
    return { label: 'Discovered', className: 'discovered', detail: 'Device was discovered by network scan but may need SNMP/SSH ingest for full details.' };
  }
  return { label: 'Manual', className: 'manual', detail: 'Manual or imported inventory record.' };
}

function formToPayload(form: DeviceForm, deviceTypes: DeviceTypeRecord[] = []) {
  return {
    name: form.name.trim(),
    hostname: form.hostname.trim(),
    management_ip: form.management_ip.trim(),
    role: form.role,
    status: form.status,
    device_type: form.device_type,
    platform: form.platform.trim(),
    manufacturer: form.manufacturer.trim(),
    model: form.model.trim(),
    serial_number: form.serial_number.trim(),
    asset_tag: form.asset_tag.trim(),
    site_id: form.site_id ? Number(form.site_id) : null,
    vlan: form.vlan ? Number(form.vlan) : 1,
    connection: form.connection.trim() || 'Ethernet',
    snmp_credential_id: form.snmp_credential_id ? Number(form.snmp_credential_id) : null,
    ssh_credential_id: form.ssh_credential_id ? Number(form.ssh_credential_id) : null,
    interfaces: parseInterfaces(form.interfacesText, form.management_ip),
    location: form.location.trim(),
    room: form.room.trim(),
    rack: form.rack.trim(),
    position: form.position ? Number(form.position) : null,
    rack_units: deviceFormRackUnits(form, deviceTypes),
    power_consumption_w: deviceFormPowerConsumptionWatts(form, deviceTypes),
    owner: form.owner.trim(),
    tenant: form.tenant.trim(),
    description: form.description.trim(),
    tags: form.tags.trim(),
    comments: form.comments.trim(),
  };
}

function loadInfrastructurePlacementRecords(resource: 'Sites' | 'Locations' | 'Racks'): InfrastructurePlacementRecord[] {
  try {
    const rows = JSON.parse(localStorage.getItem(`aims-infrastructure-${resource}`) || '[]');
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => ({
        id: String(row?.id || ''),
        name: String(row?.name || '').trim(),
        site: String(row?.site || '').trim(),
        location: String(row?.location || '').trim(),
        region: String(row?.region || row?.room || '').trim(),
        room: String(row?.room || row?.region || '').trim(),
        rooms: typeof row?.rooms === 'number' || typeof row?.rooms === 'string' ? row.rooms : null,
        roomNames: Array.isArray(row?.roomNames) ? (row.roomNames as unknown[]).map((room) => String(room || '').trim()).filter(Boolean) : [],
        status: String(row?.status || '').trim(),
        role: String(row?.role || '').trim(),
        units: Number(row?.units || 0) || undefined,
        lastUpdated: String(row?.lastUpdated || '').trim(),
      }))
      .filter((row) => row.name);
  } catch {
    return [];
  }
}

function saveInfrastructurePlacementRecords(resource: 'Sites' | 'Locations' | 'Racks', rows: InfrastructurePlacementRecord[], syncBackend = true) {
  const normalized = normalizeInfrastructurePlacementRecords(resource, rows);
  localStorage.setItem(`aims-infrastructure-${resource}`, JSON.stringify(normalized));
  window.dispatchEvent(new Event(`aims:infrastructure-${resource.toLowerCase()}-changed`));
  if (syncBackend) void syncInfrastructurePlacementRecords(resource, normalized);
}

async function loadBackendInfrastructurePlacementRecords(auth: string, resource: 'Sites' | 'Locations' | 'Racks'): Promise<InfrastructurePlacementRecord[] | 'unauthorized'> {
  const response = await fetch(`${api}/infrastructure/${encodeURIComponent(resource)}`, { headers: { Authorization: `Bearer ${auth}` } });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(json.data?.records)) return loadInfrastructurePlacementRecords(resource);
  return normalizeInfrastructurePlacementRecords(resource, json.data.records as InfrastructurePlacementRecord[]);
}

function normalizeInfrastructurePlacementRecords(resource: 'Sites' | 'Locations' | 'Racks', rows: InfrastructurePlacementRecord[]) {
  if (resource !== 'Locations') return rows;
  const normalizeRooms = (row: InfrastructurePlacementRecord) => {
    const count = Math.max(1, Math.floor(Number(row.rooms || 0) || 1));
    const names = (row.roomNames || []).map((room) => String(room || '').trim()).filter(Boolean);
    return {
      ...row,
      rooms: count,
      roomNames: count > 1 ? Array.from({ length: count }, (_, index) => names[index] || `Room ${index + 1}`) : [names[0] || 'Network Room'],
    };
  };
  const byName = new Map<string, InfrastructurePlacementRecord>();
  const order: string[] = [];
  rows.forEach((row) => {
    const name = String(row.name || '').trim();
    if (!name) return;
    const key = name.toLowerCase();
    const normalized = normalizeRooms({ ...row, name });
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, normalized);
      order.push(key);
      return;
    }
    byName.set(key, normalizeRooms({
      ...normalized,
      ...existing,
      site: existing.site || normalized.site,
      status: existing.status || normalized.status,
      role: existing.role || normalized.role,
      rooms: existing.rooms || normalized.rooms,
      roomNames: existing.roomNames?.length ? existing.roomNames : normalized.roomNames,
      lastUpdated: existing.lastUpdated || normalized.lastUpdated,
    }));
  });
  return order.map((key) => byName.get(key)!).filter(Boolean);
}

async function syncInfrastructurePlacementRecords(resource: 'Sites' | 'Locations' | 'Racks', rows: InfrastructurePlacementRecord[]) {
  const auth = await ensurePlacementApiToken();
  const response = await syncInfrastructurePlacementRecordsWithAuth(auth, resource, rows);
  if (response === 'unauthorized') {
    localStorage.removeItem('aims-api-token');
    const retryAuth = await ensurePlacementApiToken(true);
    await syncInfrastructurePlacementRecordsWithAuth(retryAuth, resource, rows);
  }
}

async function syncInfrastructurePlacementRecordsWithAuth(auth: string, resource: 'Sites' | 'Locations' | 'Racks', rows: InfrastructurePlacementRecord[]) {
  const currentResponse = await fetch(`${api}/infrastructure/${encodeURIComponent(resource)}`, { headers: { Authorization: `Bearer ${auth}` } });
  if (currentResponse.status === 401) return 'unauthorized';
  const currentJson = await currentResponse.json().catch(() => ({}));
  const currentRows = currentResponse.ok && Array.isArray(currentJson.data?.records)
    ? normalizeInfrastructurePlacementRecords(resource, currentJson.data.records as InfrastructurePlacementRecord[])
    : [];
  const mergedRows = mergeInfrastructurePlacementRows(resource, currentRows, rows);
  const response = await fetch(`${api}/infrastructure/${encodeURIComponent(resource)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: mergedRows.map((row) => ({ ...row, _merge_key: infrastructurePlacementMergeKey(resource, row) })) }),
  });
  if (response.status === 401) return 'unauthorized';
  return 'saved';
}

function mergeInfrastructurePlacementRows(resource: 'Sites' | 'Locations' | 'Racks', currentRows: InfrastructurePlacementRecord[], incomingRows: InfrastructurePlacementRecord[]) {
  const byKey = new Map<string, InfrastructurePlacementRecord>();
  [...currentRows, ...incomingRows].forEach((row) => {
    const key = infrastructurePlacementMergeKey(resource, row);
    if (!key) return;
    byKey.set(key, { ...(byKey.get(key) || {}), ...row });
  });
  return normalizeInfrastructurePlacementRecords(resource, [...byKey.values()]);
}

function infrastructurePlacementMergeKey(resource: 'Sites' | 'Locations' | 'Racks', row: InfrastructurePlacementRecord) {
  const name = String(row.name || '').trim().toLowerCase();
  if (!name) return '';
  if (resource === 'Locations') return `location:${name}`;
  if (resource === 'Racks') return `rack:${String(row.site || '').trim().toLowerCase()}:${String(row.location || '').trim().toLowerCase()}:${rackRoomName(row).toLowerCase()}:${name}`;
  return `${resource.toLowerCase()}:${name}`;
}

async function ensurePlacementApiToken(force = false) {
  const stored = localStorage.getItem('aims-api-token') || '';
  if (stored && !force) return stored;
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

function placementOptionsFor(rows: InfrastructurePlacementRecord[], filters: { site?: string; location?: string; include?: string }) {
  const site = filters.site?.trim().toLowerCase();
  const location = filters.location?.trim().toLowerCase();
  const values = rows
    .filter((row) => !site || !row.site || row.site.trim().toLowerCase() === site)
    .filter((row) => !location || !row.location || row.location.trim().toLowerCase() === location)
    .map((row) => row.name)
    .filter(Boolean);
  if (filters.include?.trim()) values.push(filters.include.trim());
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function rackRecordsForPlacement(rows: InfrastructurePlacementRecord[], filters: { site?: string; location?: string; room?: string }) {
  const site = filters.site?.trim().toLowerCase();
  const location = filters.location?.trim().toLowerCase();
  const room = filters.room?.trim().toLowerCase();
  return rows
    .filter((row) => !site || String(row.site || '').trim().toLowerCase() === site)
    .filter((row) => !location || String(row.location || '').trim().toLowerCase() === location)
    .filter((row) => !room || rackRoomName(row).toLowerCase() === room)
    .sort((a, b) => rackOptionLabel(a).localeCompare(rackOptionLabel(b), undefined, { numeric: true, sensitivity: 'base' }));
}

function rackOptionsFromRecords(rows: InfrastructurePlacementRecord[]) {
  const seen = new Set<string>();
  return rows
    .map((row) => ({ value: row.name, label: rackOptionLabel(row) }))
    .filter((option) => {
      const key = `${option.value}|${option.label}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(option.value);
    });
}

function rackOptionLabel(rack: InfrastructurePlacementRecord) {
  return [rack.name, rackRoomName(rack), rack.location].filter(Boolean).join(' - ');
}

function rackRoomName(rack?: InfrastructurePlacementRecord) {
  return String(rack?.region || rack?.room || '').trim();
}

function roomOptionsForPlacementLocation(location?: InfrastructurePlacementRecord) {
  if (!location) return [];
  const namedRooms = (location.roomNames || []).map((room) => room.trim()).filter(Boolean);
  if (namedRooms.length) return namedRooms;
  const count = Math.max(0, Math.floor(Number(location.rooms || 0)));
  if (count <= 1) return ['Network Room'];
  return Array.from({ length: Math.min(count, 200) }, (_, index) => namedRooms[index] || `Room ${index + 1}`);
}

async function resolveDeviceSiteId(
  auth: string,
  siteName: string,
  sites: Site[],
  setSites: (updater: (current: Site[]) => Site[]) => void,
) {
  const name = siteName.trim();
  if (!name) return '';
  const existing = sites.find((site) => site.name.trim().toLowerCase() === name.toLowerCase());
  if (existing) return String(existing.id);
  const response = await fetch(`${api}/sites`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to create site.');
  const created = json.data as Site;
  setSites((current) => [...current.filter((site) => site.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name)));
  return String(created.id);
}

function ensureDevicePlacementRecords(form: Pick<DeviceForm, 'site_name' | 'location' | 'room' | 'rack'>, createFlags: { site?: boolean; location?: boolean; rack?: boolean } = {}) {
  const siteName = form.site_name.trim();
  const location = form.location.trim();
  const room = form.room.trim();
  const rack = form.rack.trim();
  if (createFlags.site && siteName && siteName !== CLEAR_VALUE) ensurePlacementRecord('Sites', siteName, {});
  if (createFlags.location && location && location !== CLEAR_VALUE) ensurePlacementRecord('Locations', location, { site: siteName });
  if (createFlags.rack && rack && rack !== CLEAR_VALUE) ensurePlacementRecord('Racks', rack, { site: siteName, location, region: room, room, units: 42 });
}

function ensurePlacementRecord(resource: 'Sites' | 'Locations' | 'Racks', name: string, defaults: Partial<InfrastructurePlacementRecord>) {
  const cleanName = name.trim();
  if (!cleanName) return;
  const rows = loadInfrastructurePlacementRecords(resource);
  const exists = rows.some((row) => {
    const sameName = row.name.trim().toLowerCase() === cleanName.toLowerCase();
    if (resource === 'Locations') return sameName;
    const sameSite = !defaults.site || String(row.site || '').trim().toLowerCase() === defaults.site.trim().toLowerCase();
    const sameLocation = resource !== 'Racks' || !defaults.location || String(row.location || '').trim().toLowerCase() === defaults.location.trim().toLowerCase();
    const sameRoom = resource !== 'Racks' || !defaults.region || rackRoomName(row).toLowerCase() === String(defaults.region).trim().toLowerCase();
    return sameName && sameSite && sameLocation && sameRoom;
  });
  if (exists) return;
  saveInfrastructurePlacementRecords(resource, [{
    id: `${resource.toLowerCase()}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: cleanName,
    status: 'Active',
    ...defaults,
    lastUpdated: new Date().toISOString(),
  }, ...rows]);
}

function findPlacementRecord(rows: InfrastructurePlacementRecord[], name: string, site?: string, location?: string, room?: string) {
  const cleanName = name.trim().toLowerCase();
  const cleanSite = site?.trim().toLowerCase();
  const cleanLocation = location?.trim().toLowerCase();
  const cleanRoom = room?.trim().toLowerCase();
  if (!cleanName) return undefined;
  return rows.find((row) => {
    if (row.name.trim().toLowerCase() !== cleanName) return false;
    if (cleanSite && String(row.site || '').trim().toLowerCase() !== cleanSite) return false;
    if (cleanLocation && String(row.location || '').trim().toLowerCase() !== cleanLocation) return false;
    if (cleanRoom && rackRoomName(row).toLowerCase() !== cleanRoom) return false;
    return true;
  });
}

function availableRackPositionOptions(rack: InfrastructurePlacementRecord | undefined, devices: Device[], form: DeviceForm, deviceTypes: DeviceTypeRecord[] = []) {
  const units = Math.max(1, Math.min(52, Number(rack?.units || 42) || 42));
  const requestedUnits = Math.max(1, Math.min(units, deviceFormRackUnits(form, deviceTypes)));
  const selectedSite = form.site_name.trim().toLowerCase();
  const selectedLocation = form.location.trim().toLowerCase();
  const selectedRoom = form.room.trim().toLowerCase();
  const selectedRack = form.rack.trim().toLowerCase();
  const occupied = new Map<number, string>();
  devices.forEach((device) => {
    if (form.id && device.id === form.id) return;
    if (!device.position) return;
    if (selectedSite && String(device.site?.name || '').trim().toLowerCase() !== selectedSite) return;
    if (selectedLocation && String(device.location || '').trim().toLowerCase() !== selectedLocation) return;
    if (selectedRoom) {
      const deviceRoom = String(device.room || '').trim().toLowerCase();
      if (!deviceRoom || deviceRoom !== selectedRoom) return;
    }
    if (selectedRack && String(device.rack || '').trim().toLowerCase() !== selectedRack) return;
    const start = Number(device.position);
    const deviceUnits = Math.max(1, Math.min(units - start + 1, deviceRackUnits(device, deviceTypes)));
    for (let unit = start; unit < start + deviceUnits && unit <= units; unit += 1) {
      occupied.set(unit, device.name);
    }
  });
  return Array.from({ length: Math.max(0, units - requestedUnits + 1) }, (_, index) => {
    const value = String(index + 1);
    const start = index + 1;
    const blocked = Array.from({ length: requestedUnits }, (_, offset) => occupied.get(start + offset)).find(Boolean);
    return {
      value,
      blocked,
      label: rackPositionLabel(start, requestedUnits),
    };
  }).filter((option) => !option.blocked);
}

function rackPositionLabel(position: number, rackUnits: number) {
  const height = Math.max(1, Number(rackUnits || 1) || 1);
  return height > 1 ? `U${position + height - 1}-U${position}` : `U${position}`;
}

function deviceRackPositionLabel(position?: number | null, rackUnits?: number | null) {
  if (!position) return '';
  return rackPositionLabel(Number(position), Number(rackUnits || 1) || 1);
}

function titleCase(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  const display = value === undefined || value === null || value === '' ? '-' : value;
  return <p><span>{label}</span><b>{display}</b></p>;
}

function DeviceTypeProfilePreview({ profile }: { profile?: DeviceTypeRecord }) {
  if (!profile) return null;
  return (
    <div className="device-type-profile-preview full">
      <div>
        <b>{deviceTypeLabel(profile)}</b>
        <span>{profile.slug}</span>
        <small>{[
          profile.height_u ? `${profile.height_u}U` : '',
          profile.full_depth === false ? 'Front only' : 'Full depth',
          frontPanelKindLabel(profile.front_panel_kind),
          frontPanelProfileSummary(profile),
          profile.default_platform,
          profile.default_power_w ? `${profile.default_power_w} W typical` : '',
          profile.airflow,
        ].filter(Boolean).join(' | ') || 'No chassis defaults recorded'}</small>
      </div>
      <div className="device-type-profile-images">
        {profile.front_image ? <img src={profile.front_image} alt="Front" /> : <span>Front image none</span>}
        {profile.rear_image ? <img src={profile.rear_image} alt="Rear" /> : <span>Rear image none</span>}
      </div>
    </div>
  );
}

function frontPanelProfileSummary(profile: DeviceTypeRecord) {
  return [
    profile.front_panel_ports ? `${profile.front_panel_ports} ports` : '',
    profile.front_panel_uplinks ? `${profile.front_panel_uplinks} uplinks` : '',
    profile.front_panel_power_bays ? `${profile.front_panel_power_bays} power bays` : '',
  ].filter(Boolean).join(' | ');
}

function DeviceTemperatureCell({ environment, device }: { environment?: DeviceEnvironment; device?: Device }) {
  const tone = environmentTemperatureTone(environment, device);
  if (!environment) {
    return <DeviceMetricIndicator icon={<Thermometer size={14} />} tone="muted" value="-" detail="Loading" />;
  }
  if (environment.loading) {
    return <DeviceMetricIndicator icon={<Thermometer size={14} />} tone="info" value="-" detail="Loading" />;
  }
  if (environment.error) {
    return <DeviceMetricIndicator icon={<Thermometer size={14} />} tone="danger" value="-" detail="Poll failed" />;
  }
  if (environment.temperature_c === null || environment.temperature_c === undefined) {
    return <DeviceMetricIndicator icon={<Thermometer size={14} />} tone="muted" value="-" detail="Not reported" />;
  }
  const threshold = environment.temperature_threshold_c;
  const status = environment.temperature_status ? titleCase(environment.temperature_status) : threshold ? `Limit ${threshold} C` : 'Reported';
  return <DeviceMetricIndicator icon={<Thermometer size={14} />} tone={tone} value={`${environment.temperature_c} C`} detail={status} showValue />;
}

function DevicePowerCell({ environment, device, deviceTypes }: { environment?: DeviceEnvironment; device?: Device; deviceTypes?: DeviceTypeRecord[] }) {
  const typicalPower = device && deviceTypes ? formatDeviceTypePowerValue(device, deviceTypes) : null;
  if (!environment) {
    return typicalPower
      ? <DeviceMetricIndicator icon={<Zap size={14} />} tone="info" value={typicalPower} detail="Device type" showValue />
      : <DeviceMetricIndicator icon={<Zap size={14} />} tone="muted" value="-" detail="Loading" />;
  }
  if (environment.loading) {
    return <DeviceMetricIndicator icon={<Zap size={14} />} tone="info" value={typicalPower || '-'} detail={typicalPower ? 'Device type while polling' : 'Loading'} showValue={Boolean(typicalPower)} />;
  }
  if (environment.error) {
    return <DeviceMetricIndicator icon={<Zap size={14} />} tone={typicalPower ? 'warning' : 'danger'} value={typicalPower || '-'} detail={typicalPower ? 'Device type; poll failed' : 'Poll failed'} showValue={Boolean(typicalPower)} />;
  }
  const tone = environmentPowerTone(environment, device, deviceTypes || []);
  if (environment.power_w !== null && environment.power_w !== undefined) {
    return <DeviceMetricIndicator icon={<Zap size={14} />} tone={tone} value={formatPowerValue(environment)} detail="Live consumption" showValue />;
  }
  if (typicalPower) {
    return <DeviceMetricIndicator icon={<Zap size={14} />} tone="info" value={typicalPower} detail="Device type" showValue />;
  }
  if (environment.power_supply_status) {
    return <DeviceMetricIndicator icon={<Zap size={14} />} tone={tone} value={titleCase(environment.power_supply_status)} detail="PSU" />;
  }
  return <DeviceMetricIndicator icon={<Zap size={14} />} tone="muted" value="-" detail="Not reported" />;
}

function DeviceMetricIndicator({ icon, tone, value, detail, showValue = false }: { icon: ReactNode; tone: string; value: string; detail: string; showValue?: boolean }) {
  return (
    <span className={`device-metric-indicator ${tone}`} title={`${value} - ${detail}`} aria-label={`${value} - ${detail}`}>
      <i>{icon}</i>
      {showValue && <b>{value}</b>}
    </span>
  );
}

function DeviceListKpi({ icon, tone, label, value, sub }: { icon: ReactNode; tone: string; label: string; value: string | number; sub: string }) {
  return (
    <section className={`device-list-kpi ${tone}`}>
      <span>{icon}</span>
      <p>{label}</p>
      <b>{value}</b>
      <small>{sub}</small>
    </section>
  );
}

function DeviceListSidePanel({
  device,
  environment,
  credentials,
  deviceTypes,
  onOpenDetail,
  onClose,
}: {
  device: Device | null;
  environment?: DeviceEnvironment;
  credentials: CredentialProfile[];
  deviceTypes: DeviceTypeRecord[];
  onOpenDetail: (device: Device) => void;
  onClose: () => void;
}) {
  if (!device) return <aside className="card device-list-side"><p className="empty">Select a device to inspect.</p></aside>;
  const issues = deviceIssueRows(device, environment);
  const physicalInterfaces = (device.interfaces || []).filter(isPhysicalFrontInterface);
  const temperature = formatTemperatureValue(environment);
  const power = formatDevicePowerValue(environment, device, deviceTypes);
  return (
    <aside className="card device-list-side">
      <button className="vlan-panel-close" type="button" onClick={onClose}><X size={15} /></button>
      <div className="device-list-side-head">
        <span className={`device-list-side-icon ${deviceTypeTone(device, deviceTypes)}`}>{deviceTypeIcon(device, deviceTypes, 18)}</span>
        <h2>{device.name}</h2>
        <span className={`status ${String(device.status || '').toLowerCase()}`}>{device.status || '-'}</span>
      </div>
      <section className="device-list-side-section device-list-alerts-section">
        <h3><Bell size={15} /> Alerts & Events <b>{issues.length}</b></h3>
        {issues.length ? issues.map((issue, index) => (
          <p key={`${issue.label}-${index}`} className={`device-list-alarm ${issue.tone}`}><span>{issue.label}</span><b>{issue.value}</b></p>
        )) : <p><span>No active alarms</span><b>-</b></p>}
      </section>
      <div className="device-list-side-tabs"><button className="active" type="button">Overview</button><button type="button">Interfaces</button><button type="button">Power</button><button type="button">Alarms</button></div>
      <dl className="device-list-side-kv">
        <dt>Management IP</dt><dd>{device.management_ip || '-'}</dd>
        <dt>Site</dt><dd>{device.site?.name || '-'}</dd>
        <dt>Location</dt><dd>{device.location || '-'}</dd>
        <dt>Rack</dt><dd>{device.rack || '-'}</dd>
        <dt>Role</dt><dd>{device.role || '-'}</dd>
        <dt>Vendor</dt><dd>{device.manufacturer || '-'}</dd>
        <dt>Model</dt><dd>{device.model || device.device_type || '-'}</dd>
        <dt>Serial Number</dt><dd>{device.serial_number || '-'}</dd>
        <dt>SNMP Profile</dt><dd>{credentialName(credentials, device.snmp_credential_id) || '-'}</dd>
        <dt>SSH Profile</dt><dd>{credentialName(credentials, device.ssh_credential_id) || '-'}</dd>
        <dt>Last Seen</dt><dd>{device.last_seen_at ? relativeTime(device.last_seen_at) : '-'}</dd>
      </dl>
      <section className="device-list-side-section">
        <h3>Device Health</h3>
        <p><span>Status</span><b>{device.status || '-'}</b></p>
        <p><span>Temperature</span><b>{temperature}</b></p>
        <p><span>Power</span><b>{power}</b></p>
        <p><span>Interfaces</span><b>{physicalInterfaces.length || (device.interfaces || []).length || '-'}</b></p>
        <p><span>SNMP</span><b>{device.snmp_status || '-'}</b></p>
      </section>
      <button type="button" className="device-list-details-button" onClick={() => onOpenDetail(device)}>View Full Device Details</button>
    </aside>
  );
}

function uniqueDeviceValues(values: Array<string | number | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function sameTextValue(a: unknown, b: unknown) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function isWirelessInventoryDevice(device: Device) {
  const text = [device.role, device.device_type, device.platform, device.manufacturer, device.model, device.tags].join(' ').toLowerCase();
  return text.includes('wireless') || text.includes('access point') || text.includes('ap') || text.includes('ruckus');
}

function deviceHasIssue(device: Device, environment?: DeviceEnvironment) {
  const status = String(device.status || '').toLowerCase();
  const deviceTypes = loadDeviceTypes();
  return ['offline', 'failed', 'down'].includes(status)
    || Boolean(device.snmp_last_error)
    || deviceStatusLooksBad(device.snmp_status)
    || deviceStatusLooksBad(device.config_status)
    || Boolean(environment?.error)
    || ['danger', 'warning'].includes(environmentTemperatureTone(environment, device))
    || ['danger', 'warning'].includes(environmentPowerTone(environment, device, deviceTypes))
    || environmentStateLooksBad(environment?.fan_status)
    || environmentStateLooksBad(environment?.power_supply_status);
}

function deviceIssueRows(device: Device, environment?: DeviceEnvironment) {
  const rows: { label: string; value: string; tone: string }[] = [];
  const status = String(device.status || '').toLowerCase();
  const snmpStatus = String(device.snmp_status || '').toLowerCase();
  const configStatus = String(device.config_status || '').toLowerCase();
  const deviceTypes = loadDeviceTypes();
  const tempTone = environmentTemperatureTone(environment, device);
  const powerTone = environmentPowerTone(environment, device, deviceTypes);
  if (['offline', 'failed', 'down'].includes(status)) rows.push({ label: 'Device status', value: device.status || 'Issue', tone: 'critical' });
  if (snmpStatus && snmpStatus !== 'ok' && snmpStatus !== 'not checked') rows.push({ label: 'SNMP state', value: device.snmp_status || 'Issue', tone: snmpStatus.includes('no response') || snmpStatus.includes('failed') ? 'critical' : 'warning' });
  if (device.snmp_last_error) rows.push({ label: 'SNMP', value: device.snmp_last_error, tone: 'warning' });
  if (configStatus.includes('failed') || configStatus.includes('error')) rows.push({ label: 'Configuration', value: device.config_status || 'Collection error', tone: 'warning' });
  if (environment?.error) rows.push({ label: 'Environment poll', value: environment.error, tone: 'warning' });
  if (tempTone === 'danger') rows.push({ label: 'Temperature', value: formatTemperatureValue(environment), tone: 'critical' });
  if (tempTone === 'warning') rows.push({ label: 'Temperature', value: formatTemperatureValue(environment), tone: 'warning' });
  if (powerTone === 'danger') rows.push({ label: 'Power', value: formatDevicePowerValue(environment, device, deviceTypes), tone: 'critical' });
  if (powerTone === 'warning') rows.push({ label: 'Power', value: formatDevicePowerValue(environment, device, deviceTypes), tone: 'warning' });
  const fanState = String(environment?.fan_status || '').toLowerCase();
  if (fanState && fanState !== 'normal' && fanState !== 'ok') rows.push({ label: 'Fan', value: titleCase(environment?.fan_status || 'Issue'), tone: fanState === 'warning' ? 'warning' : 'critical' });
  const psuState = String(environment?.power_supply_status || '').toLowerCase();
  if (psuState && psuState !== 'normal' && psuState !== 'ok') rows.push({ label: 'Power supply', value: titleCase(environment?.power_supply_status || 'Issue'), tone: psuState === 'warning' ? 'warning' : 'critical' });
  if (device.tags?.toLowerCase().includes('not-fully-scanned')) rows.push({ label: 'Inventory event', value: 'Not fully scanned', tone: 'warning' });
  return uniqueIssueRows(rows);
}

function deviceStatusLooksBad(value?: string | null) {
  const text = String(value || '').toLowerCase();
  return Boolean(text) && !['ok', 'normal', 'not checked', 'not collected'].includes(text) && /(fail|error|down|critical|warning|no response|timeout)/.test(text);
}

function environmentStateLooksBad(value?: string | null) {
  const text = String(value || '').toLowerCase();
  return Boolean(text) && !['ok', 'normal'].includes(text);
}

function uniqueIssueRows(rows: { label: string; value: string; tone: string }[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.label}|${row.value}|${row.tone}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function latestDeviceTimestamp(devices: Device[]) {
  return devices
    .map((device) => device.last_seen_at || device.discovered_at || '')
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || '';
}

function relativeTime(value?: string | null) {
  if (!value) return '-';
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return formatDateTime(value);
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatTemperatureValue(environment?: DeviceEnvironment) {
  if (!environment) return '-';
  if (environment.loading) return 'Loading...';
  if (environment.error) return 'Poll failed';
  return environment.temperature_c !== null && environment.temperature_c !== undefined ? `${environment.temperature_c} C` : 'Not reported';
}

function formatPowerValue(environment?: DeviceEnvironment) {
  if (!environment) return '-';
  if (environment.loading) return 'Loading...';
  if (environment.error) return 'Poll failed';
  if (environment.power_w !== null && environment.power_w !== undefined) {
    return formatWattsValue(environment.power_w);
  }
  return environment.power_supply_status ? `PSU ${titleCase(environment.power_supply_status)}` : '-';
}

function formatDevicePowerValue(environment: DeviceEnvironment | undefined, device: Device, deviceTypes: DeviceTypeRecord[]) {
  const live = formatPowerValue(environment);
  if (live && live !== '-' && live !== 'Poll failed') return live;
  const typical = formatDeviceStoredPowerValue(device, deviceTypes);
  if (typical) return typical;
  return live;
}

function formatDeviceTypePowerValue(device: Pick<Device, 'device_type' | 'manufacturer' | 'model' | 'power_consumption_w'>, deviceTypes: DeviceTypeRecord[]) {
  const watts = devicePowerConsumptionWatts(device, deviceTypes);
  return watts === null ? null : formatWattsValue(watts);
}

function formatDeviceStoredPowerValue(device: Pick<Device, 'device_type' | 'manufacturer' | 'model' | 'power_consumption_w'>, deviceTypes: DeviceTypeRecord[]) {
  const watts = devicePowerConsumptionWatts(device, deviceTypes);
  return watts === null ? null : formatWattsValue(watts);
}

function withResolvedPowerConsumption(device: Device, deviceTypes: DeviceTypeRecord[]): Device {
  if (device.power_consumption_w !== null && device.power_consumption_w !== undefined) return device;
  const watts = devicePowerConsumptionWatts(device, deviceTypes);
  return watts === null ? device : { ...device, power_consumption_w: watts };
}

function devicePowerConsumptionWatts(device: Pick<Device, 'device_type' | 'manufacturer' | 'model' | 'power_consumption_w'>, deviceTypes: DeviceTypeRecord[]) {
  if (device.power_consumption_w !== null && device.power_consumption_w !== undefined) {
    const parsed = Number(device.power_consumption_w);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return deviceTypePowerWatts(deviceTypeProfileForDevice(device, deviceTypes));
}

function formatDeviceTypeProfilePowerValue(profile?: DeviceTypeRecord) {
  const watts = deviceTypePowerWatts(profile);
  return watts === null ? null : formatWattsValue(watts);
}

function deviceTypePowerWatts(profile?: DeviceTypeRecord) {
  const raw = String(profile?.default_power_w || '').trim();
  if (!raw) return null;
  const parsed = Number(raw.replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatWattsValue(watts: number) {
  return watts >= 1000 ? `${Math.round((watts / 1000) * 100) / 100} kW` : `${Math.round(watts)} W`;
}

function deviceTypeIcon(device: Device, deviceTypes: DeviceTypeRecord[], size = 15) {
  const profile = deviceTypeProfileForDevice(device, deviceTypes);
  if (profile) return <DeviceTypeIconGlyph iconKey={deviceTypeIconKeyFor(profile)} size={size} />;
  return deviceRoleIcon(device, size);
}

function deviceTypeTone(device: Device, deviceTypes: DeviceTypeRecord[]) {
  const profile = deviceTypeProfileForDevice(device, deviceTypes);
  if (profile) return deviceTypeIconTone(deviceTypeIconKeyFor(profile));
  return deviceKindTone(device);
}

function frontPanelKindIcon(kind: FrontPanelKind, size = 15) {
  if (kind === 'firewall') return <Shield size={size} />;
  if (kind === 'router') return <Router size={size} />;
  if (kind === 'switch') return <Network size={size} />;
  if (kind === 'server') return <Server size={size} />;
  if (kind === 'storage') return <HardDrive size={size} />;
  if (kind === 'access_point') return <Wifi size={size} />;
  if (kind === 'ip_phone') return <Phone size={size} />;
  if (kind === 'workstation') return <MonitorCog size={size} />;
  if (kind === 'ups') return <BatteryCharging size={size} />;
  if (kind === 'pdu') return <PlugZap size={size} />;
  return <CircleHelp size={size} />;
}

function frontPanelKindTone(kind: FrontPanelKind) {
  if (kind === 'firewall') return 'red';
  if (kind === 'router' || kind === 'access_point') return 'cyan';
  if (kind === 'server' || kind === 'storage') return 'purple';
  if (kind === 'ups' || kind === 'pdu') return 'orange';
  if (kind === 'ip_phone' || kind === 'workstation') return 'green';
  return 'blue';
}

function deviceRoleIcon(device: Device, size = 15) {
  const text = deviceRoleText(device);
  if (text.includes('firewall') || text.includes('fortigate') || text.includes('security')) return <Shield size={size} />;
  if (text.includes('wireless controller') || text.includes('controller')) return <RadioTower size={size} />;
  if (text.includes('access point') || text.includes('wireless') || text.includes('ruckus') || /\bap\b/.test(text)) return <Wifi size={size} />;
  if (text.includes('router') || text.includes('gateway')) return <Router size={size} />;
  if (text.includes('core switch') || text.includes('distribution switch') || text.includes('access switch') || text.includes('switch') || text.includes('catalyst')) return <Network size={size} />;
  if (text.includes('server') || text.includes('virtual machine') || text.includes('vm')) return <Server size={size} />;
  if (text.includes('storage') || text.includes('nas') || text.includes('san')) return <HardDrive size={size} />;
  if (text.includes('database')) return <Database size={size} />;
  if (text.includes('ups')) return <BatteryCharging size={size} />;
  if (text.includes('pdu') || text.includes('power')) return <PlugZap size={size} />;
  if (text.includes('camera') || text.includes('cctv') || text.includes('recorder') || text.includes('nvr')) return <MonitorCog size={size} />;
  if (text.includes('chassis') || text.includes('stack')) return <Boxes size={size} />;
  if (text.includes('cpu') || text.includes('compute')) return <Cpu size={size} />;
  return <CircleHelp size={size} />;
}

function deviceRoleText(device: Device) {
  return [device.role, device.device_type, device.platform, device.manufacturer, device.model, device.name, device.tags].join(' ').toLowerCase();
}

function deviceKindTone(device: Device) {
  const text = deviceRoleText(device);
  if (text.includes('firewall')) return 'red';
  if (text.includes('wireless') || text.includes('access point') || text.includes('ruckus')) return 'green';
  if (text.includes('router')) return 'cyan';
  if (text.includes('ups') || text.includes('pdu') || text.includes('power')) return 'orange';
  if (text.includes('server') || text.includes('storage')) return 'purple';
  return 'blue';
}

function mergeTagText(existing: string, incoming: string) {
  const tags = [...existing.split(','), ...incoming.split(',')]
    .map((tag) => tag.trim())
    .filter(Boolean);
  return Array.from(new Set(tags)).join(', ');
}

function deviceTypeComments(profile: DeviceTypeRecord, existing: string) {
  const lines = [
    `Device type: ${deviceTypeLabel(profile)} (${profile.slug})`,
    profile.part_number ? `Part number: ${profile.part_number}` : '',
    `Full depth: ${profile.full_depth === false ? 'No' : 'Yes'}`,
    profile.default_power_w ? `Typical power consumption: ${profile.default_power_w} W` : '',
    `Front panel: ${frontPanelKindLabel(profile.front_panel_kind)}${frontPanelProfileSummary(profile) ? ` (${frontPanelProfileSummary(profile)})` : ''}`,
    profile.front_panel_notes ? `Front-panel notes: ${profile.front_panel_notes}` : '',
    profile.airflow ? `Airflow: ${profile.airflow}` : '',
    profile.weight ? `Weight: ${profile.weight} ${profile.weight_unit || ''}`.trim() : '',
    profile.parent_child_status ? `Parent/child status: ${profile.parent_child_status}` : '',
    profile.owner_group ? `Owner group: ${profile.owner_group}` : '',
    profile.comments ? `Type comments: ${profile.comments}` : '',
  ].filter(Boolean).join('\n');
  if (!lines) return existing;
  return existing ? `${existing}\n\n${lines}` : lines;
}

function deviceStatusTone(status?: string | null) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'online', 'up', 'ok'].includes(normalized)) return 'ok';
  if (['maintenance', 'planned', 'staging'].includes(normalized)) return 'warning';
  if (['offline', 'failed', 'down'].includes(normalized)) return 'danger';
  return 'muted';
}

function environmentTemperatureTone(environment?: DeviceEnvironment, device?: Pick<Device, 'id' | 'name' | 'location' | 'rack'> & { room?: string | null; region?: string | null }) {
  if (environment?.error) return 'danger';
  if (environment?.loading) return 'info';
  const value = environment?.temperature_c;
  if (value === null || value === undefined) return 'muted';
  const configuredTone = environmentThresholdTone('temperature', value, thresholdContextForDevice(device));
  if (configuredTone === 'danger') return 'danger';
  if (configuredTone === 'warning') return 'warning';
  if (configuredTone === 'normal') return 'ok';
  const threshold = environment?.temperature_threshold_c;
  if (threshold !== null && threshold !== undefined) {
    if (value >= threshold) return 'danger';
    if (value >= threshold - 10) return 'warning';
  }
  const state = String(environment?.temperature_status || '').toLowerCase();
  if (['critical', 'shutdown', 'not functioning'].includes(state)) return 'danger';
  if (state === 'warning') return 'warning';
  return 'ok';
}

function environmentPowerTone(environment?: DeviceEnvironment, device?: Pick<Device, 'id' | 'name' | 'location' | 'rack' | 'device_type' | 'manufacturer' | 'model' | 'power_consumption_w'> & { room?: string | null; region?: string | null }, deviceTypes: DeviceTypeRecord[] = []) {
  if (environment?.error) return 'danger';
  if (environment?.loading) return 'info';
  const powerValue = environment?.power_w !== null && environment?.power_w !== undefined
    ? environment.power_w
    : device?.power_consumption_w !== null && device?.power_consumption_w !== undefined
      ? device.power_consumption_w
      : device ? deviceTypePowerWatts(deviceTypeProfileForDevice(device, deviceTypes)) : null;
  const configuredTone = environmentThresholdTone('power', powerValue, thresholdContextForDevice(device));
  if (configuredTone === 'danger') return 'danger';
  if (configuredTone === 'warning') return 'warning';
  if (configuredTone === 'normal') return 'ok';
  const state = String(environment?.power_supply_status || '').toLowerCase();
  if (['critical', 'failed', 'failure', 'down', 'not functioning'].includes(state)) return 'danger';
  if (['warning', 'degraded', 'unknown'].includes(state)) return 'warning';
  if (['normal', 'ok', 'up', 'active'].includes(state)) return 'ok';
  if (environment?.power_w !== null && environment?.power_w !== undefined) return 'ok';
  return 'muted';
}

function thresholdContextForDevice(device?: Pick<Device, 'id' | 'name' | 'location' | 'rack'> & { room?: string | null; region?: string | null }): EnvironmentThresholdContext {
  return {
    deviceId: device?.id,
    deviceName: device?.name,
    location: device?.location,
    rack: device?.rack,
    room: device?.room || device?.region || null,
  };
}

function DeviceFrontPanel({ device, deviceTypes, onOpenTerminal, onOpenInterfaces, onOpenInterface }: { device: Device; deviceTypes: DeviceTypeRecord[]; onOpenTerminal: () => void; onOpenInterfaces: () => void; onOpenInterface: (interfaceName: string) => void }) {
  const profile = devicePanelProfile(device, deviceTypes);
  const ports = frontPanelPorts(device, profile);
  const learnedInterfaceCount = (device.interfaces || []).filter(isPhysicalFrontInterface).length;
  const layoutSource = learnedInterfaceCount ? 'Learned interfaces' : 'Device type profile';
  const accessPortCount = ports.filter((port) => port.kind !== 'sfp').length;
  const connected = ports.filter((port) => port.state === 'up').length;
  const disabled = ports.filter((port) => port.state === 'disabled').length;
  const errors = ports.filter((port) => port.state === 'error').length;
  const down = ports.filter((port) => port.state === 'down').length;
  const uplinks = ports.filter((port) => port.kind === 'sfp').length;
  const manufacturer = device.manufacturer || profile.brand || inferManufacturer(device);
  const model = device.model || device.platform || device.device_type || frontPanelKindLabel(profile.panelKind);
  const isNetworkPanel = ['switch', 'router', 'firewall', 'wireless_controller', 'generic'].includes(profile.panelKind);

  return (
    <section className="device-detail-section full device-front-section">
      <div className="device-front-head">
        <div>
          <h3><Cable size={16} /> Front Panel</h3>
          <p>{manufacturer} {model} {frontPanelKindLabel(profile.panelKind).toLowerCase()} layout using {layoutSource.toLowerCase()}.</p>
        </div>
        <div className="front-summary">
          <span>{frontPanelKindLabel(profile.panelKind)}</span>
          <span>{accessPortCount} ports</span>
          {uplinks > 0 && <span>{uplinks} uplinks</span>}
          <span>{layoutSource}</span>
          <span><i className="up" /> {connected} up</span>
          <span><i className="down" /> {down} down</span>
          {disabled > 0 && <span><i className="disabled" /> {disabled} disabled</span>}
          {errors > 0 && <span><i className="error" /> {errors} error</span>}
        </div>
      </div>

      <div className={`device-faceplate real panel-${profile.panelKind} ${deviceFaceClass(device, profile)} brand-${profile.brandClass} ports-${accessPortCount} ${uplinks ? 'has-uplinks' : 'no-uplinks'}`}>
        <div className="faceplate-ears left"><span /></div>
        <div className="faceplate-body">
          <div className="faceplate-left">
            <div className="faceplate-brand">
              <b>{manufacturer}</b>
              <span>{model}</span>
              <em>{device.hostname || device.name}</em>
              <small>{profile.label}</small>
            </div>
            <div className="faceplate-controls">
              <button className="console-port" type="button" title="Open terminal" onClick={onOpenTerminal}><span>CONSOLE</span><i /></button>
              <div className="mgmt-port"><span>MGMT</span><i /></div>
              <div className="status-leds">
                <i className={device.status === 'Active' ? 'up' : 'down'} /><span>SYS</span>
                <i className={connected ? 'up' : 'down'} /><span>LINK</span>
                <i className={errors ? 'error' : 'up'} /><span>ALM</span>
              </div>
            </div>
          </div>
          <div className="faceplate-label-strip">
            <span>{device.management_ip || 'Management IP not set'}</span>
            <b>{model}</b>
          </div>
          {isNetworkPanel
            ? <NetworkFrontPanel ports={ports} uplinks={uplinks} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />
            : <RoleFrontPanel device={device} profile={profile} ports={ports} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />}
          <div className="faceplate-power">
            {Array.from({ length: Math.max(1, profile.powerBays) }, (_, index) => (
              <div key={index}><span>{profile.panelKind === 'pdu' ? `FEED ${index + 1}` : index === 0 ? 'PSU 1' : `PSU ${index + 1}`}</span><i className={device.status === 'Active' ? 'up' : 'down'} /></div>
            ))}
          </div>
        </div>
        <div className="faceplate-ears right"><span /></div>
      </div>

      <div className="front-panel-meta">
        <div><span>Panel type</span><b>{frontPanelKindLabel(profile.panelKind)}</b></div>
        <div><span>Physical ports</span><b>{accessPortCount}</b></div>
        <div><span>Uplinks</span><b>{uplinks}</b></div>
        <div><span>Source</span><b>{layoutSource}</b></div>
      </div>
    </section>
  );
}

type FrontPort = { name: string; label: string; state: 'up' | 'down' | 'disabled' | 'error' | 'unknown'; kind: 'rj45' | 'sfp'; mode?: string; description?: string; speed?: number; source: 'interface' | 'device-type' };
type FrontPanelKind = 'switch' | 'router' | 'firewall' | 'wireless_controller' | 'server' | 'storage' | 'database' | 'compute' | 'access_point' | 'ip_phone' | 'workstation' | 'ups' | 'pdu' | 'temperature' | 'power_sensor' | 'generic';
type DevicePanelProfile = { brand: string; brandClass: string; label: string; accessPorts: number; uplinkPorts: number; powerBays: number; panelKind: FrontPanelKind; panelNotes: string };

function NetworkFrontPanel({ ports, uplinks, onOpenInterfaces, onOpenInterface }: { ports: FrontPort[]; uplinks: number; onOpenInterfaces: () => void; onOpenInterface: (interfaceName: string) => void }) {
  return (
    <div className="port-area">
      <div className="port-bank copper">
        {chunkPorts(ports.filter((port) => port.kind !== 'sfp'), 12).map((group, groupIndex) => (
          <div className="port-cluster" key={`copper-${groupIndex}`}>
            {group.map((port, index) => <FrontPanelPort key={`${port.name}-${index}`} port={port} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />)}
          </div>
        ))}
      </div>
      {uplinks > 0 && (
        <div className={`port-bank uplinks uplink-count-${uplinks}`}>
          {ports.filter((port) => port.kind === 'sfp').map((port, index) => <FrontPanelPort key={`${port.name}-${index}`} port={port} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />)}
        </div>
      )}
    </div>
  );
}

function RoleFrontPanel({ device, profile, ports, onOpenInterfaces, onOpenInterface }: { device: Device; profile: DevicePanelProfile; ports: FrontPort[]; onOpenInterfaces: () => void; onOpenInterface: (interfaceName: string) => void }) {
  if (profile.panelKind === 'server') return <BayFrontPanel title="HOT SWAP DRIVES" count={panelBayCount(profile, 8)} ports={ports} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />;
  if (profile.panelKind === 'storage') return <BayFrontPanel title="STORAGE BAYS" count={panelBayCount(profile, 12)} ports={ports} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />;
  if (profile.panelKind === 'database') return <DatabaseFrontPanel ports={ports} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />;
  if (profile.panelKind === 'compute') return <ComputeFrontPanel ports={ports} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />;
  if (profile.panelKind === 'access_point') return <AccessPointFrontPanel device={device} ports={ports} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />;
  if (profile.panelKind === 'ip_phone') return <IpPhoneFrontPanel ports={ports} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />;
  if (profile.panelKind === 'workstation') return <WorkstationFrontPanel ports={ports} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />;
  if (profile.panelKind === 'ups' || profile.panelKind === 'pdu') return <PowerFrontPanel profile={profile} ports={ports} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />;
  if (profile.panelKind === 'temperature') return <SensorFrontPanel kind="temperature" ports={ports} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />;
  if (profile.panelKind === 'power_sensor') return <SensorFrontPanel kind="power" ports={ports} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />;
  return <NetworkFrontPanel ports={ports} uplinks={ports.filter((port) => port.kind === 'sfp').length} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />;
}

function BayFrontPanel({ title, count, ports, onOpenInterfaces, onOpenInterface }: { title: string; count: number; ports: FrontPort[]; onOpenInterfaces: () => void; onOpenInterface: (interfaceName: string) => void }) {
  return (
    <div className="role-panel-module bay-panel">
      <div className="role-panel-title">{title}</div>
      <div className="bay-grid">{Array.from({ length: count }, (_, index) => <span key={index} className="drive-bay"><i />{index + 1}</span>)}</div>
      <MiniPortStrip ports={ports.slice(0, 4)} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />
    </div>
  );
}

function AccessPointFrontPanel({ device, ports, onOpenInterfaces, onOpenInterface }: { device: Device; ports: FrontPort[]; onOpenInterfaces: () => void; onOpenInterface: (interfaceName: string) => void }) {
  return (
    <div className="role-panel-module ap-panel">
      <div className="ap-dome"><Wifi size={34} /><b>{device.name}</b><span>2.4 GHz / 5 GHz</span></div>
      <MiniPortStrip ports={ports.slice(0, 2)} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />
    </div>
  );
}

function DatabaseFrontPanel({ ports, onOpenInterfaces, onOpenInterface }: { ports: FrontPort[]; onOpenInterfaces: () => void; onOpenInterface: (interfaceName: string) => void }) {
  return (
    <div className="role-panel-module database-panel">
      <div className="role-panel-title">DATABASE NODE</div>
      <div className="database-stack">{Array.from({ length: 4 }, (_, index) => <span key={index}><Database size={15} /><b>VOL {index + 1}</b><i /></span>)}</div>
      <MiniPortStrip ports={ports.slice(0, 4)} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />
    </div>
  );
}

function ComputeFrontPanel({ ports, onOpenInterfaces, onOpenInterface }: { ports: FrontPort[]; onOpenInterfaces: () => void; onOpenInterface: (interfaceName: string) => void }) {
  return (
    <div className="role-panel-module compute-panel">
      <div className="role-panel-title">COMPUTE NODE</div>
      <div className="compute-grid">{Array.from({ length: 8 }, (_, index) => <span key={index}><Cpu size={13} />CORE {index + 1}</span>)}</div>
      <MiniPortStrip ports={ports.slice(0, 4)} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />
    </div>
  );
}

function SensorFrontPanel({ kind, ports, onOpenInterfaces, onOpenInterface }: { kind: 'temperature' | 'power'; ports: FrontPort[]; onOpenInterfaces: () => void; onOpenInterface: (interfaceName: string) => void }) {
  const Icon = kind === 'temperature' ? Thermometer : Zap;
  return (
    <div className={`role-panel-module sensor-panel ${kind}`}>
      <div className="sensor-dial"><Icon size={38} /><b>{kind === 'temperature' ? 'TEMP' : 'POWER'}</b><span>{kind === 'temperature' ? 'Thermal probe' : 'Inline meter'}</span></div>
      <div className="sensor-scale">{Array.from({ length: 14 }, (_, index) => <i key={index} />)}</div>
      <MiniPortStrip ports={ports.slice(0, 2)} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />
    </div>
  );
}

function IpPhoneFrontPanel({ ports, onOpenInterfaces, onOpenInterface }: { ports: FrontPort[]; onOpenInterfaces: () => void; onOpenInterface: (interfaceName: string) => void }) {
  return (
    <div className="role-panel-module phone-panel">
      <div className="phone-handset" />
      <div className="phone-screen">IP PHONE</div>
      <div className="phone-keys">{Array.from({ length: 12 }, (_, index) => <i key={index} />)}</div>
      <MiniPortStrip ports={ports.slice(0, 2)} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />
    </div>
  );
}

function WorkstationFrontPanel({ ports, onOpenInterfaces, onOpenInterface }: { ports: FrontPort[]; onOpenInterfaces: () => void; onOpenInterface: (interfaceName: string) => void }) {
  return (
    <div className="role-panel-module workstation-panel">
      <div className="workstation-screen"><MonitorCog size={28} /><span>WORKSTATION</span></div>
      <div className="workstation-tower"><i /><i /><i /></div>
      <MiniPortStrip ports={ports.slice(0, 3)} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />
    </div>
  );
}

function PowerFrontPanel({ profile, ports, onOpenInterfaces, onOpenInterface }: { profile: DevicePanelProfile; ports: FrontPort[]; onOpenInterfaces: () => void; onOpenInterface: (interfaceName: string) => void }) {
  const outlets = profile.panelKind === 'pdu' ? Math.max(8, profile.accessPorts || 8) : Math.max(2, profile.powerBays || 2);
  return (
    <div className="role-panel-module power-panel">
      <div className="role-panel-title">{profile.panelKind === 'pdu' ? 'POWER DISTRIBUTION' : 'BATTERY / POWER'}</div>
      <div className="outlet-grid">{Array.from({ length: Math.min(outlets, 16) }, (_, index) => <span key={index}><PlugZap size={12} /></span>)}</div>
      <MiniPortStrip ports={ports.slice(0, 2)} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />
    </div>
  );
}

function MiniPortStrip({ ports, onOpenInterfaces, onOpenInterface }: { ports: FrontPort[]; onOpenInterfaces: () => void; onOpenInterface: (interfaceName: string) => void }) {
  if (!ports.length) return <div className="mini-port-strip empty">No front network ports recorded</div>;
  return <div className="mini-port-strip">{ports.map((port, index) => <FrontPanelPort key={`${port.name}-${index}`} port={port} onOpenInterfaces={onOpenInterfaces} onOpenInterface={onOpenInterface} />)}</div>;
}

function panelBayCount(profile: DevicePanelProfile, fallback: number) {
  return Math.max(2, Math.min(24, profile.accessPorts || fallback));
}

function FrontPanelPort({ port, onOpenInterfaces, onOpenInterface }: { port: FrontPort; onOpenInterfaces: () => void; onOpenInterface: (interfaceName: string) => void }) {
  return (
    <button className={`front-port ${port.kind} ${port.state} source-${port.source}`} title={['Go to interface', port.name, port.mode, port.description, port.speed ? `${port.speed} Mbps` : '', port.source === 'device-type' ? 'Device type placeholder' : 'Learned interface'].filter(Boolean).join(' | ')} type="button" onClick={() => port.source === 'interface' ? onOpenInterface(port.name) : onOpenInterfaces()}>
      <i />
      <em />
      <span>{port.label}</span>
    </button>
  );
}

function chunkPorts<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function frontPanelPorts(device: Device, profile = devicePanelProfile(device)): FrontPort[] {
  const physical = (device.interfaces || [])
    .filter(isPhysicalFrontInterface)
    .sort((a, b) => interfacePortNumber(a.name) - interfacePortNumber(b.name) || String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true }));

  if (physical.length) {
    return physical.map((item, index) => frontPortFromInterface(
      item,
      frontPortLabel(item, index),
      frontPortKind(item.name || '', item.type || ''),
    ));
  }

  const byAccessNumber = new Map<number, DeviceInterface>();
  const explicitUplinks: DeviceInterface[] = [];
  const zeroBasedAccessPorts = physical.some((item) => frontPortKind(item.name || '', item.type || '') !== 'sfp' && interfacePortNumber(item.name) === 0);
  physical.forEach((item) => {
    const portNumber = interfacePortNumber(item.name);
    const accessNumber = zeroBasedAccessPorts ? portNumber + 1 : portNumber;
    const kind = frontPortKind(item.name || '', item.type || '');
    if (kind === 'sfp' || accessNumber > profile.accessPorts) {
      explicitUplinks.push(item);
      return;
    }
    if (accessNumber >= 1 && accessNumber <= profile.accessPorts && !byAccessNumber.has(accessNumber)) {
      byAccessNumber.set(accessNumber, item);
    }
  });

  const accessPorts = Array.from({ length: profile.accessPorts }, (_, index) => {
    const portNumber = index + 1;
    const item = byAccessNumber.get(portNumber);
    if (!item) {
      return {
        name: `GigabitEthernet1/0/${portNumber}`,
        label: String(portNumber),
        state: 'unknown' as const,
        kind: 'rj45' as const,
        source: 'device-type' as const,
      };
    }
    return frontPortFromInterface(item, String(portNumber), 'rj45');
  });

  const uplinks = Array.from({ length: profile.uplinkPorts }, (_, index) => {
    const item = explicitUplinks[index];
    if (!item) {
      return {
        name: `Gigabit uplink ${index + 1}`,
        label: `G${index + 1}`,
        state: 'unknown' as const,
        kind: 'sfp' as const,
        source: 'device-type' as const,
      };
    }
    return frontPortFromInterface(item, `G${index + 1}`, 'sfp');
  });

  return [...accessPorts, ...uplinks];
}

function frontPortFromInterface(item: DeviceInterface, label: string, kind: FrontPort['kind']): FrontPort {
  return {
    name: item.name || `Port ${label}`,
    label,
    state: frontPortState(item),
    kind,
    mode: item.mode,
    description: item.description,
    speed: item.speed,
    source: 'interface',
  };
}

function frontPortLabel(item: DeviceInterface, index: number) {
  const name = String(item.name || '').trim();
  if (item.label) return String(item.label);
  const portNumber = interfacePortNumber(name);
  if (Number.isFinite(portNumber) && portNumber !== Number.MAX_SAFE_INTEGER) return String(portNumber);
  return String(index + 1);
}

function devicePanelProfile(device: Device, deviceTypes: DeviceTypeRecord[] = []): DevicePanelProfile {
  const typeProfile = deviceTypeProfileForDevice(device, deviceTypes);
  const brand = device.manufacturer || typeProfile?.manufacturer || inferManufacturer(device);
  const brandClass = brand.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'generic';
  const panelKind = (typeProfile ? frontPanelKindFromIconKey(deviceTypeIconKeyFor(typeProfile)) : '') || normalizeFrontPanelKind(typeProfile?.front_panel_kind) || inferFrontPanelKind(device);
  const inferredAccessPorts = inferredPortCount(device, panelKind);
  const accessPorts = Math.max(0, Number(typeProfile?.front_panel_ports || 0)) || inferredAccessPorts;
  const uplinkPorts = Math.max(0, Number(typeProfile?.front_panel_uplinks || 0)) || inferredUplinkCount(device, accessPorts, panelKind);
  const powerBays = Math.max(0, Number(typeProfile?.front_panel_power_bays || 0)) || defaultPowerBays(panelKind);
  return {
    brand,
    brandClass,
    accessPorts,
    uplinkPorts,
    powerBays,
    panelKind,
    panelNotes: typeProfile?.front_panel_notes || '',
    label: panelKind === 'switch' ? `${accessPorts}P${uplinkPorts ? ` + ${uplinkPorts}G` : ''}` : `${frontPanelKindLabel(panelKind)}${accessPorts ? ` / ${accessPorts} ports` : ''}`,
  };
}

function normalizeFrontPanelKind(value?: string | null): FrontPanelKind | '' {
  const normalized = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  const allowed: FrontPanelKind[] = ['switch', 'router', 'firewall', 'wireless_controller', 'server', 'storage', 'database', 'compute', 'access_point', 'ip_phone', 'workstation', 'ups', 'pdu', 'temperature', 'power_sensor', 'generic'];
  return allowed.includes(normalized as FrontPanelKind) ? normalized as FrontPanelKind : '';
}

function frontPanelKindFromIconKey(iconKey: DeviceTypeIconKey): FrontPanelKind | '' {
  if (iconKey === 'wireless_controller') return 'wireless_controller';
  if (iconKey === 'database') return 'database';
  if (iconKey === 'temperature') return 'temperature';
  if (iconKey === 'power') return 'power_sensor';
  if (iconKey === 'compute') return 'compute';
  if (iconKey === 'generic') return '';
  return normalizeFrontPanelKind(iconKey);
}

function inferFrontPanelKind(device: Device): FrontPanelKind {
  const text = deviceRoleText(device);
  if (text.includes('firewall') || text.includes('fortigate') || text.includes('security')) return 'firewall';
  if (text.includes('wireless controller') || text.includes('controller')) return 'wireless_controller';
  if (text.includes('access point') || text.includes('wireless ap') || text.includes('ruckus') || /\bap\b/.test(text)) return 'access_point';
  if (text.includes('phone') || text.includes('voip')) return 'ip_phone';
  if (text.includes('workstation') || text.includes('desktop') || text.includes('pc') || text.includes('client')) return 'workstation';
  if (text.includes('router') || text.includes('gateway')) return 'router';
  if (text.includes('database')) return 'database';
  if (text.includes('compute')) return 'compute';
  if (text.includes('temperature') || text.includes('temp')) return 'temperature';
  if (text.includes('power sensor') || text.includes('power meter')) return 'power_sensor';
  if (text.includes('server') || text.includes('virtual machine') || text.includes('vm')) return 'server';
  if (text.includes('storage') || text.includes('nas') || text.includes('san')) return 'storage';
  if (text.includes('ups')) return 'ups';
  if (text.includes('pdu') || text.includes('power distribution')) return 'pdu';
  if (text.includes('switch') || text.includes('catalyst')) return 'switch';
  return 'generic';
}

function defaultPowerBays(kind: FrontPanelKind) {
  if (kind === 'server' || kind === 'storage' || kind === 'database' || kind === 'compute') return 2;
  if (kind === 'ups' || kind === 'pdu') return 1;
  if (kind === 'temperature' || kind === 'power_sensor' || kind === 'access_point' || kind === 'ip_phone' || kind === 'workstation') return 1;
  return 2;
}

function isPhysicalFrontInterface(item: DeviceInterface) {
  const name = String(item.name || '').toLowerCase();
  const type = String(item.type || '').toLowerCase();
  if (!name) return false;
  if (/^(vlan|vl|svi|loopback|lo|null|tunnel|tu|port-channel|po|bridge|br|mgmt|management|stack|cpu|control|bdi)/i.test(name)) return false;
  if (/^(gigabitethernet|gi|ethernet|eth)0\/0(?:\b|$|[^0-9])/.test(name)) return false;
  if (['vlan', 'svi', 'loopback', 'logical', 'virtual'].some((value) => type.includes(value))) return false;
  if (/^\d+$/.test(name)) return false;
  return /^(fastethernet|gigabitethernet|tengigabitethernet|twentyfivegig|twentyfivegige|fortygigabit|hundredgig|ethernet|eth|gi|te|fa|fo|xe|sfp)/i.test(name);
}

function frontPortKind(name: string, type: string): FrontPort['kind'] {
  const normalized = `${name} ${type}`.toLowerCase();
  if (/^(te|tengigabit|twentyfive|forty|hundred|xe|fo|sfp)/i.test(name.trim()) || /\b(sfp|xfp|qsfp|uplink|transceiver|ten-gigabit|10g|25g|40g|100g)\b/.test(normalized)) return 'sfp';
  return 'rj45';
}

function frontPortState(item: DeviceInterface): FrontPort['state'] {
  const status = String(item.display_status || item.status || item.oper_status || '').toLowerCase();
  const admin = String(item.admin_status || '').toLowerCase();
  if (item.enabled === false || admin === 'down' || admin === 'disabled' || admin === '2') return 'disabled';
  if (status.includes('err') || status.includes('fail') || status.includes('dormant') || status.includes('testing')) return 'error';
  if (status.includes('not connected') || status.includes('down') || status === '2') return 'down';
  if (status.includes('connected') || status === 'up' || status === '1') return 'up';
  return 'unknown';
}

function interfaceSortKey(name = '') {
  return name.replace(/[^\d/]+/g, '').padStart(8, '0') || name;
}

function interfacePortNumber(name = '') {
  const parts = String(name).match(/\d+/g);
  if (!parts?.length) return Number.MAX_SAFE_INTEGER;
  return Number(parts[parts.length - 1]);
}

function inferredPortCount(device: Device, panelKind: FrontPanelKind = inferFrontPanelKind(device)) {
  const text = `${device.manufacturer || ''} ${device.model || ''} ${device.platform || ''} ${device.device_type || ''} ${device.role || ''}`.toLowerCase();
  const match = text.match(/(?:^|[^0-9])(8|12|16|24|48)(?:p|port|ports|ts|t|x|fp|[- ]?\d*g|$)/);
  if (match) return Number(match[1]);
  if (panelKind === 'server') return 8;
  if (panelKind === 'database') return 8;
  if (panelKind === 'compute') return 6;
  if (panelKind === 'storage') return 12;
  if (panelKind === 'ip_phone') return 2;
  if (panelKind === 'workstation') return 1;
  if (panelKind === 'temperature' || panelKind === 'power_sensor') return 1;
  if (panelKind === 'ups') return 1;
  if (panelKind === 'pdu') return 8;
  if (text.includes('firewall') || text.includes('fortigate')) return 8;
  if (text.includes('router')) return 4;
  if (text.includes('wireless controller') || text.includes('controller')) return 8;
  if (text.includes('access point') || text.includes('wireless')) return 2;
  const physicalNumbers = (device.interfaces || [])
    .filter(isPhysicalFrontInterface)
    .map((item) => interfacePortNumber(item.name))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 96);
  const maxPhysical = physicalNumbers.length ? Math.max(...physicalNumbers) : 0;
  if (maxPhysical >= 40) return 48;
  if (maxPhysical >= 20) return 24;
  if (maxPhysical >= 12) return 16;
  if (maxPhysical >= 8) return 8;
  return 24;
}

function inferredUplinkCount(device: Device, accessPorts = inferredPortCount(device), panelKind: FrontPanelKind = inferFrontPanelKind(device)) {
  const text = `${device.manufacturer || ''} ${device.model || ''} ${device.platform || ''} ${device.device_type || ''} ${device.role || ''}`.toLowerCase();
  if (!['switch', 'wireless_controller', 'generic'].includes(panelKind)) return 0;
  if (panelKind === 'wireless_controller') return 2;
  if (text.includes('access point') || text.includes('wireless')) return 0;
  if (text.includes('firewall') || text.includes('router')) return 0;
  if (/(?:^|[^0-9])4\s*(?:x\s*)?(?:g|ge|sfp|uplink)|(?:^|[^0-9])4[- ]?g(?:[^a-z]|$)|(?:24|48)[a-z-]*4g|9200l|9300/.test(text)) return 4;
  if (/(?:^|[^0-9])2\s*(?:x\s*)?(?:g|ge|sfp|uplink)|(?:^|[^0-9])2[- ]?g(?:[^a-z]|$)|(?:8|12|16)[a-z-]*2g/.test(text)) return 2;
  const sfpInterfaces = (device.interfaces || []).filter((item) => isPhysicalFrontInterface(item) && frontPortKind(item.name || '', item.type || '') === 'sfp').length;
  if (sfpInterfaces >= 4) return 4;
  if (sfpInterfaces >= 2) return 2;
  if (accessPorts >= 24) return 4;
  if (text.includes('switch') || text.includes('catalyst')) return 2;
  return 0;
}

function inferManufacturer(device: Device) {
  const text = `${device.manufacturer || ''} ${device.model || ''} ${device.platform || ''} ${device.device_type || ''}`.toLowerCase();
  if (text.includes('cisco') || text.includes('catalyst')) return 'Cisco';
  if (text.includes('ruckus')) return 'Ruckus';
  if (text.includes('forti')) return 'Fortinet';
  if (text.includes('aruba')) return 'Aruba';
  if (text.includes('juniper') || text.includes('ex-') || text.includes('srx')) return 'Juniper';
  return device.device_type || 'AIMS';
}

function deviceFaceClass(device: Device, profile?: DevicePanelProfile) {
  if (profile?.panelKind) return profile.panelKind;
  const text = `${device.role} ${device.device_type} ${device.model} ${device.platform}`.toLowerCase();
  if (text.includes('firewall')) return 'firewall';
  if (text.includes('router')) return 'router';
  if (text.includes('wireless') || text.includes('access point')) return 'wireless';
  return 'switch';
}

function InterfaceIps({ item }: { item: DeviceInterface }) {
  const values = item.ip_addresses?.length ? item.ip_addresses : (item.ip ? [item.ip] : []);
  if (!values.length) return <span className="vlan-port-empty">-</span>;
  return <div className="interface-ip-list">{values.map((value) => <span key={value}>{value}</span>)}</div>;
}

function InterfaceConnection({ item, onOpen }: { item: DeviceInterface; onOpen: (deviceId: number) => void }) {
  if (!item.connection) return <span className="vlan-port-empty">-</span>;
  if (!item.connection_device_id) return <span>{item.connection}</span>;
  return (
    <button type="button" className="interface-connection-link" onClick={() => onOpen(item.connection_device_id!)}>
      {item.connection}
    </button>
  );
}

function interfaceDisplayStatus(item: DeviceInterface) {
  const value = String(item.display_status || item.status || item.oper_status || '').trim();
  if (!value) return 'Unknown';
  const normalized = value.toLowerCase();
  if (normalized === 'not connected' || normalized === 'notconnect' || normalized === 'lowerlayerdown' || normalized === 'lower layer down') return 'Down';
  return value;
}

function interfaceStatusClass(value?: string) {
  const normalized = (value || '').toLowerCase();
  if (['connected', 'up', 'active'].includes(normalized)) return 'active';
  if (['not connected', 'down', 'disabled'].includes(normalized)) return 'offline';
  if (['error', 'unknown', 'testing', 'dormant', 'lowerlayerdown', 'lower layer down'].includes(normalized)) return 'failed';
  return 'planned';
}

function VlanPorts({ ports }: { ports: DeviceVlanPort[] }) {
  if (!ports.length) return <span className="vlan-port-empty">-</span>;
  return (
    <div className="vlan-port-list">
      {ports.map((port) => (
        <span key={`${port.name}-${port.mode || ''}-${port.bridge_port || ''}`}>{port.name}</span>
      ))}
    </div>
  );
}

function vlanPortsByMode(vlan: DeviceVlan, mode: 'tagged' | 'untagged') {
  return (vlan.ports || []).filter((port) => (port.mode || '').toLowerCase() === mode);
}

function vlanPortCount(vlan: DeviceVlan) {
  return vlan.ports?.length || 0;
}

function formatSpeed(value?: number) {
  if (!value) return '-';
  if (value >= 1000000000) return `${Math.round(value / 1000000000)} Gbps`;
  if (value >= 1000000) return `${Math.round(value / 1000000)} Mbps`;
  if (value >= 1000) return `${Math.round(value / 1000)} Kbps`;
  return `${value} bps`;
}

function formatBytes(value?: number) {
  if (!value) return '0 B';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function bulkFormToPayload(form: BulkEditForm, deviceTypes: DeviceTypeRecord[] = []) {
  const values: Record<string, string | number | null> = {};
  if (form.role) values.role = form.role === CLEAR_VALUE ? '' : form.role;
  if (form.device_type) {
    values.device_type = form.device_type === CLEAR_VALUE ? '' : form.device_type;
    values.power_consumption_w = form.device_type === CLEAR_VALUE ? null : deviceTypePowerWatts(deviceTypeProfileForValue(form.device_type, deviceTypes));
  }
  if (form.status) values.status = form.status;
  if (form.site_id) values.site_id = form.site_id === CLEAR_VALUE ? null : Number(form.site_id);
  if (form.vlan) values.vlan = Number(form.vlan);
  if (form.connection.trim()) values.connection = form.connection.trim();
  if (form.snmp_credential_id) values.snmp_credential_id = form.snmp_credential_id === CLEAR_VALUE ? null : Number(form.snmp_credential_id);
  if (form.ssh_credential_id) values.ssh_credential_id = form.ssh_credential_id === CLEAR_VALUE ? null : Number(form.ssh_credential_id);
  if (form.platform.trim()) values.platform = form.platform.trim();
  if (form.location.trim()) values.location = form.location === CLEAR_VALUE ? '' : form.location.trim();
  if (form.room.trim()) values.room = form.room.trim();
  if (form.rack.trim()) values.rack = form.rack === CLEAR_VALUE ? '' : form.rack.trim();
  if (form.owner.trim()) values.owner = form.owner.trim();
  if (form.tenant.trim()) values.tenant = form.tenant.trim();
  if (form.tags.trim()) values.tags = form.tags.trim();
  return values;
}

function credentialName(credentials: CredentialProfile[], id?: number | null) {
  if (!id) return '-';
  return credentials.find((profile) => profile.id === id)?.name || `Profile ${id}`;
}

function parseInterfaces(value: string, managementIp: string): DeviceInterface[] {
  if (!value.trim()) {
    return managementIp.trim() ? [{ name: 'mgmt0', ip: managementIp.trim(), status: 'up' }] : [];
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        name: String(item.name || 'interface'),
        ip: String(item.ip || ''),
        status: String(item.status || 'up'),
      }));
    }
  } catch {
    // Plain line format is supported below.
  }
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, ip = '', status = 'up'] = line.split(',').map((part) => part.trim());
    return { name, ip, status };
  });
}
