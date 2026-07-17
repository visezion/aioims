import { FormEvent, PointerEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, BarChart3, Building2, Gauge, Globe2, Move, Plus, RadioTower, RefreshCw, Search, Server, Trash2, Wifi, X, ZoomIn, ZoomOut } from 'lucide-react';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { SearchableSelect } from './SearchableSelect';

const api = 'http://127.0.0.1:8001/api/v1';

type Device = {
  id: number | string;
  name: string;
  hostname?: string | null;
  management_ip?: string | null;
  role?: string | null;
  status?: string | null;
  device_type?: string | null;
  platform?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  site?: { name: string } | string | null;
  location?: string | null;
  site_id?: number | null;
  tags?: string | null;
  snmp_status?: string | null;
  last_seen_at?: string | null;
  last_connected_at?: string | null;
  status_since_at?: string | null;
  offline_since_at?: string | null;
  clients?: number | string | null;
  controller_clients?: number | string | null;
  radio_clients_24?: number | string | null;
  radio_clients_5?: number | string | null;
  radio_clients_unknown?: number | string | null;
  radio_clients_total?: number | string | null;
  radios?: number | string | null;
  cpu_util?: number | string | null;
  memory_util?: number | string | null;
  memory_used_kb?: number | string | null;
  memory_total_kb?: number | string | null;
  traffic_rx_bytes?: number | string | null;
  traffic_tx_bytes?: number | string | null;
  traffic_rx_rate?: number | string | null;
  traffic_tx_rate?: number | string | null;
  client_rx_kbytes?: number | string | null;
  client_tx_kbytes?: number | string | null;
  lan_rx_packets?: number | string | null;
  lan_tx_packets?: number | string | null;
  lan_rx_errors?: number | string | null;
  dropped_packets?: number | string | null;
  software_version?: string | null;
  serial_number?: string | null;
  hardware_version?: string | null;
  mac_address?: string | null;
  uptime?: string | number | null;
  uptime_ticks?: string | number | null;
  mesh_type?: string | null;
  connection_mode?: string | null;
  channel?: string | number | null;
  channel_width?: string | number | null;
  tx_power?: string | number | null;
  utilization?: string | number | null;
  noise?: string | number | null;
  rssi?: string | number | null;
  ssid?: string | null;
  wlan?: string | null;
  band?: string | null;
  radio_band?: string | null;
  frequency?: string | number | null;
  vlan?: string | number | null;
  security_mode?: string | null;
  broadcast_state?: string | null;
  controller_id?: string | null;
  controller_name?: string | null;
  client_type?: string | null;
  ap_name?: string | null;
  description?: string | null;
  zd_config_index?: string | number | null;
  zd_ap_index?: string | number | null;
};

type WirelessController = {
  id: string;
  name: string;
  vendor: string;
  controller_role?: string;
  monitoring_enabled?: boolean;
  host: string;
  port: number;
  protocol: string;
  username?: string;
  snmp_credential_id?: number | null;
  site_name?: string;
  verify_tls: boolean;
  enabled: boolean;
  notes?: string;
  password_configured: boolean;
  last_test?: { ok: boolean; detail: string; elapsed_ms: number; checked_at: string } | null;
  last_scan?: { ok: boolean; aps: number; controllers: number; scanned_at: string; job_id?: number } | null;
  last_live_collection?: { ok: boolean; detail: string; elapsed_ms: number; checked_at: string; aps?: number; controllers?: number; source?: string } | null;
};

type ControllerForm = {
  name: string;
  vendor: string;
  controller_role: string;
  host: string;
  port: string;
  protocol: string;
  username: string;
  password: string;
  snmp_credential_id: string;
  site_name: string;
  verify_tls: boolean;
  enabled: boolean;
  notes: string;
};

type CredentialProfile = {
  id: number;
  name: string;
  credential_type: 'snmp_v2c' | 'ssh';
  port?: number;
  has_secret: boolean;
};

type Site = { id: number; name: string; location?: string | null };
type InfrastructureSiteRecord = { name: string; status?: string };
type Setting = { key: string; configured: boolean };
type ApLocationEdit = { mode: 'single'; device: Device; site_id: string; location: string } | { mode: 'bulk'; site_id: string; location: string } | null;
type SortDirection = 'asc' | 'desc';
type WirelessApSortField = 'device' | 'role' | 'management' | 'site' | 'location' | 'platform' | 'users' | 'traffic' | 'health' | 'status' | 'collection' | 'last_seen';

const NAMED_SITE_PREFIX = 'site-name:';

type WirelessScanResult = {
  controller_id: string;
  access_points: Device[];
  controllers: Device[];
  source?: string;
  note?: string;
};

type WirelessHistoryPoint = {
  sampled_at?: string | null;
  controller_id?: string | null;
  controller_name?: string | null;
  ap_key?: string | null;
  ap_name?: string | null;
  status?: string | null;
  clients?: number | string | null;
  traffic_rx_rate?: number | string | null;
  traffic_tx_rate?: number | string | null;
  traffic_rx_bytes?: number | string | null;
  traffic_tx_bytes?: number | string | null;
  cpu_util?: number | string | null;
  memory_util?: number | string | null;
  dropped_packets?: number | string | null;
  lan_rx_errors?: number | string | null;
  critical?: number | string | null;
  major?: number | string | null;
  minor?: number | string | null;
};

type WirelessMonitoring = {
  access_points: Device[];
  history: WirelessHistoryPoint[];
  summary?: WirelessMonitoringSummary;
  updated_at?: string | null;
  source?: string;
  controllers?: WirelessController[];
  monitoring_controllers?: WirelessController[];
  refresh?: WirelessRefreshStatus;
};

type WirelessRefreshStatus = {
  requested: boolean;
  attempted: number;
  refreshed: number;
  skipped: number;
  failed: number;
  collected_ap_records: number;
  throttle_seconds: number;
  refreshed_at?: string | null;
  errors?: { controller_id?: string; name?: string; detail?: string }[];
};

type WirelessApDetail = {
  access_point: Device;
  controller?: WirelessController | null;
  config?: Record<string, string | number | null>;
  snapshot?: Record<string, string | number | null>;
  snmp?: {
    reachable: boolean;
    source?: string;
    collected_at?: string | null;
    system?: Record<string, string | number | null>;
    interfaces?: Record<string, string | number | null>[];
    ip_addresses?: Record<string, string | number | null>[];
    errors?: string[];
  };
};

type WirelessMonitoringSummary = {
  access_points: {
    total: number;
    healthy: number;
    warning: number;
    critical: number;
  };
  clients: {
    total: number;
    band_24: number;
    band_5: number;
    unknown: number;
  };
  alerts: {
    total: number;
    critical: number;
    major: number;
    minor: number;
  };
  usage: {
    total_rate: number;
    downlink: number;
    uplink: number;
  };
};

const emptyMonitoringSummary: WirelessMonitoringSummary = {
  access_points: { total: 0, healthy: 0, warning: 0, critical: 0 },
  clients: { total: 0, band_24: 0, band_5: 0, unknown: 0 },
  alerts: { total: 0, critical: 0, major: 0, minor: 0 },
  usage: { total_rate: 0, downlink: 0, uplink: 0 },
};

type WirelessDashboardStats = {
  accessPoints: number;
  active: number;
  reachable: number;
  profiles: number;
  clients: number;
  rxRate: number;
  txRate: number;
  dropped: number;
  errors: number;
  avgCpu: number;
  avgMemory: number;
  attention: Device[];
  topClients: Device[];
  topTraffic: Device[];
};

const emptyControllerForm: ControllerForm = {
  name: '',
  vendor: 'generic',
  controller_role: 'primary',
  host: '',
  port: '443',
  protocol: 'https',
  username: '',
  password: '',
  snmp_credential_id: '',
  site_name: '',
  verify_tls: true,
  enabled: true,
  notes: '',
};

const vendorOptions = [
  ['generic', 'Generic API/SNMP'],
  ['cisco-wlc', 'Cisco WLC / Catalyst'],
  ['aruba', 'Aruba Central / Mobility'],
  ['unifi', 'Ubiquiti UniFi'],
  ['ruckus-zonedirector', 'Ruckus ZoneDirector'],
  ['ruckus-smartzone', 'Ruckus SmartZone'],
  ['meraki', 'Cisco Meraki'],
];

const vendorDefaults: Record<string, Partial<ControllerForm>> = {
  'ruckus-zonedirector': {
    port: '161',
    protocol: 'snmp',
    notes: 'ZoneDirector SNMP v2c profile. Select a saved SNMP profile or the global SNMP community. SSH is also supported on port 22.',
  },
  'ruckus-smartzone': {
    port: '8443',
    protocol: 'https',
    notes: 'SmartZone profile. Use the controller cluster or node endpoint.',
  },
};

type WirelessView = 'monitoring' | 'integrations';

export function WirelessPage({ initialView = 'monitoring' }: { initialView?: WirelessView }) {
  const [token, setToken] = useState(localStorage.getItem('aims-api-token') || '');
  const [devices, setDevices] = useState<Device[]>([]);
  const [controllers, setControllers] = useState<WirelessController[]>([]);
  const [snmpProfiles, setSnmpProfiles] = useState<CredentialProfile[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [globalSnmpConfigured, setGlobalSnmpConfigured] = useState(false);
  const [controllerForm, setControllerForm] = useState<ControllerForm>(emptyControllerForm);
  const [editingControllerId, setEditingControllerId] = useState('');
  const [scanResult, setScanResult] = useState<WirelessScanResult | null>(null);
  const [monitoringHistory, setMonitoringHistory] = useState<WirelessHistoryPoint[]>([]);
  const [monitoringSummary, setMonitoringSummary] = useState<WirelessMonitoringSummary>(emptyMonitoringSummary);
  const [monitoringUpdatedAt, setMonitoringUpdatedAt] = useState<string | null>(null);
  const [monitoringRefresh, setMonitoringRefresh] = useState<WirelessRefreshStatus | null>(null);
  const [infrastructureSites, setInfrastructureSites] = useState<InfrastructureSiteRecord[]>(() => loadInfrastructureSites());
  const [infrastructureLocations, setInfrastructureLocations] = useState<InfrastructureLocationRecord[]>(() => loadInfrastructureLocations());
  const [apDetail, setApDetail] = useState<WirelessApDetail | null>(null);
  const [apDetailTarget, setApDetailTarget] = useState<Device | null>(null);
  const [apDetailLoading, setApDetailLoading] = useState(false);
  const [apDetailError, setApDetailError] = useState('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [controllerAction, setControllerAction] = useState('');
  const [deleteControllerPrompt, setDeleteControllerPrompt] = useState<WirelessController | null>(null);
  const [selectedApKeys, setSelectedApKeys] = useState<string[]>([]);
  const [apLocationEdit, setApLocationEdit] = useState<ApLocationEdit>(null);
  const [apLocationSaving, setApLocationSaving] = useState(false);
  const [apSortField, setApSortField] = useState<WirelessApSortField>('last_seen');
  const [apSortDirection, setApSortDirection] = useState<SortDirection>('desc');
  const [view, setView] = useState<WirelessView>(initialView);
  const pollingRef = useRef(false);
  const controllerDeleteInProgressRef = useRef(false);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const ensureToken = async (force = false) => {
    const storedToken = token || localStorage.getItem('aims-api-token') || '';
    if (storedToken && !force) return storedToken;
    const response = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@aims.local', password: 'ChangeMe123!' }),
    });
    const json = await response.json();
    if (!response.ok || !json.data?.token) throw new Error(json.message || 'Unable to authenticate.');
    localStorage.setItem('aims-api-token', json.data.token);
    setToken(json.data.token);
    return json.data.token as string;
  };

  const authenticated = async <T,>(request: (auth: string) => Promise<T | 'unauthorized'>) => {
    let auth = await ensureToken();
    let response = await request(auth);
    if (response === 'unauthorized') {
      localStorage.removeItem('aims-api-token');
      auth = await ensureToken(true);
      response = await request(auth);
    }
    if (response === 'unauthorized') throw new Error('Unable to authenticate.');
    return response;
  };

  const load = async (silent = false, refreshLive = false) => {
    if (silent && pollingRef.current) return;
    if (silent && controllerDeleteInProgressRef.current) return;
    if (silent) pollingRef.current = true;
    if (!silent) setLoading(true);
    try {
      const [controllerRows, credentialRows, siteRows, hasGlobalSnmp, monitoring, locationRows] = await authenticated((auth) => loadWirelessData(auth, !silent, refreshLive, !silent && !refreshLive));
      setDevices(monitoring.access_points);
      setControllers(controllerRows);
      setInfrastructureLocations(mergeInfrastructureLocations(locationRows, loadInfrastructureLocations()));
      if (!silent) {
        setSnmpProfiles(credentialRows.filter((profile) => profile.credential_type === 'snmp_v2c'));
        setSites(siteRows);
        setGlobalSnmpConfigured(hasGlobalSnmp);
      }
      setMonitoringHistory(monitoring.history || []);
      setMonitoringSummary(monitoring.summary || emptyMonitoringSummary);
      setMonitoringUpdatedAt(monitoring.updated_at || null);
      setMonitoringRefresh(monitoring.refresh || null);
      setMessage('');
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : 'Unable to load wireless setup.');
    } finally {
      if (silent) pollingRef.current = false;
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load(false, false);
    const firstRefresh = window.setTimeout(() => load(true, true), 250);
    const refresh = window.setInterval(() => load(true, true), 4000);
    return () => {
      window.clearTimeout(firstRefresh);
      window.clearInterval(refresh);
    };
  }, []);

  useEffect(() => {
    const syncInfrastructurePlacement = () => {
      setInfrastructureSites(loadInfrastructureSites());
      setInfrastructureLocations(loadInfrastructureLocations());
    };
    window.addEventListener('storage', syncInfrastructurePlacement);
    window.addEventListener('aims:infrastructure-sites-changed', syncInfrastructurePlacement);
    window.addEventListener('aims:infrastructure-locations-changed', syncInfrastructurePlacement);
    return () => {
      window.removeEventListener('storage', syncInfrastructurePlacement);
      window.removeEventListener('aims:infrastructure-sites-changed', syncInfrastructurePlacement);
      window.removeEventListener('aims:infrastructure-locations-changed', syncInfrastructurePlacement);
    };
  }, []);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return devices;
    return devices.filter((device) => [
      device.name,
      device.hostname,
      device.management_ip,
      device.role,
      device.device_type,
      device.platform,
      device.manufacturer,
      device.model,
      siteName(device),
      device.location,
      device.tags,
    ].join(' ').toLowerCase().includes(value));
  }, [devices, query]);

  const liveAps = useMemo(() => devices.filter((device) => !isWirelessController(device)), [devices]);
  const scanResultAps = useMemo(() => {
    if (!scanResult?.access_points.length) return [];
    return repairScanResultApNames(scanResult.access_points, liveAps);
  }, [scanResult, liveAps]);
  const baseShownAps = scanResultAps.length ? scanResultAps : filtered;
  const shownAps = useMemo(() => sortWirelessAps(baseShownAps, apSortField, apSortDirection), [baseShownAps, apSortField, apSortDirection]);
  const shownApKeys = shownAps.map(apRowKey);
  const selectedAps = shownAps.filter((device) => selectedApKeys.includes(apRowKey(device)));
  const allShownApsSelected = shownApKeys.length > 0 && shownApKeys.every((key) => selectedApKeys.includes(key));
  const dashboardAps = useMemo(() => {
    if (liveAps.length) return liveAps;
    return shownAps.filter((device) => !isWirelessController(device));
  }, [liveAps, shownAps]);
  const monitoringControllers = useMemo(() => controllers.filter(isMonitoringController), [controllers]);

  useEffect(() => {
    setSelectedApKeys((current) => current.filter((key) => shownApKeys.includes(key)));
  }, [shownApKeys.join('|')]);

  const stats = useMemo(() => {
    const controllerDevices = devices.filter(isWirelessController).length;
    const accessPoints = dashboardAps;
    const active = accessPoints.filter((device) => isHealthyAp(device)).length;
    const reachable = monitoringControllers.filter((controller) => controller.last_test?.ok).length;
    const clients = sum(accessPoints, clientCount);
    const rxRate = sum(accessPoints, (device) => numeric(device.traffic_rx_rate));
    const txRate = sum(accessPoints, (device) => numeric(device.traffic_tx_rate));
    const rxBytes = sum(accessPoints, (device) => numeric(device.traffic_rx_bytes) || numeric(device.client_rx_kbytes) * 1024);
    const txBytes = sum(accessPoints, (device) => numeric(device.traffic_tx_bytes) || numeric(device.client_tx_kbytes) * 1024);
    const dropped = sum(accessPoints, (device) => numeric(device.dropped_packets));
    const errors = sum(accessPoints, (device) => numeric(device.lan_rx_errors));
    const cpuValues = accessPoints.map((device) => numeric(device.cpu_util)).filter((value) => value > 0);
    const memoryValues = accessPoints.map((device) => numeric(device.memory_util)).filter((value) => value > 0);
    const avgCpu = cpuValues.length ? Math.round(sumNumbers(cpuValues) / cpuValues.length) : 0;
    const avgMemory = memoryValues.length ? Math.round(sumNumbers(memoryValues) / memoryValues.length) : 0;
    const attention = accessPoints.filter(needsAttention);
    const topClients = sortApsByClients(accessPoints).slice(0, 5);
    const topTraffic = [...accessPoints].sort((a, b) => totalTrafficRate(b) - totalTrafficRate(a)).slice(0, 5);
    return {
      total: devices.length,
      controllerDevices,
      accessPoints: accessPoints.length,
      active,
      reachable,
      profiles: monitoringControllers.length,
      clients,
      rxRate,
      txRate,
      rxBytes,
      txBytes,
      dropped,
      errors,
      avgCpu,
      avgMemory,
      attention,
      topClients,
      topTraffic,
    };
  }, [devices, monitoringControllers, dashboardAps]);

  const saveController = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const controllerIdBeingEdited = editingControllerId;
      const saved = await authenticated((auth) => saveControllerApi(auth, {
        ...controllerForm,
        port: Number(controllerForm.port || 443),
        snmp_credential_id: controllerForm.snmp_credential_id === '' ? null : Number(controllerForm.snmp_credential_id),
      }, controllerIdBeingEdited));
      setControllers((current) => controllerIdBeingEdited ? current.map((item) => item.id === saved.id ? saved : item) : [saved, ...current]);
      setControllerForm(emptyControllerForm);
      setEditingControllerId('');
      if (controllerIdBeingEdited) {
        setMessage(`Controller ${saved.name} updated.`);
        await load(true);
        return;
      }
      if (saved.enabled && isMonitoringController(saved)) {
        setControllerAction(`${saved.id}:scan`);
        const tested = await authenticated((auth) => testControllerApi(auth, saved.id));
        setControllers((current) => current.map((item) => item.id === saved.id ? tested : item));
        if (tested.last_test?.ok) {
          const result = await authenticated((auth) => scanControllerApi(auth, saved.id));
          setScanResult(result.data);
          await load(true);
          setMessage(`Controller ${saved.name} saved, tested, and scanned. ${result.data.access_points.length} APs stored for monitoring.`);
        } else {
          setMessage(`Controller ${saved.name} saved, but connection test failed: ${tested.last_test?.detail || 'No response'}`);
        }
      } else {
        setMessage(isMonitoringController(saved) ? `Controller ${saved.name} saved.` : `Backup controller ${saved.name} saved and excluded from the monitoring dashboard.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save controller.');
    } finally {
      setControllerAction('');
      setSaving(false);
    }
  };

  const testController = async (controller: WirelessController) => {
    setControllerAction(`${controller.id}:test`);
    try {
      const updated = await authenticated((auth) => testControllerApi(auth, controller.id));
      setControllers((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(updated.last_test?.ok ? `Connection to ${updated.name} succeeded.` : `Connection to ${updated.name} failed: ${updated.last_test?.detail || 'No response'}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to test controller.');
    } finally {
      setControllerAction('');
    }
  };

  const scanController = async (controller: WirelessController) => {
    setControllerAction(`${controller.id}:scan`);
    try {
      const result = await authenticated((auth) => scanControllerApi(auth, controller.id));
      setScanResult(result.data);
      await load();
      setMessage(`Scan complete for ${controller.name}: ${result.data.access_points.length} APs found.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to scan controller.');
    } finally {
      setControllerAction('');
    }
  };

  const deleteController = async (controller: WirelessController) => {
    setControllerAction(`${controller.id}:delete`);
    controllerDeleteInProgressRef.current = true;
    try {
      const deleted = await authenticated((auth) => deleteControllerApi(auth, controller.id));
      setControllers((current) => current.filter((item) => item.id !== controller.id));
      if (scanResult?.controller_id === controller.id) setScanResult(null);
      setDevices((current) => current.filter((device) => String(device.controller_id || '') !== controller.id));
      setDeleteControllerPrompt(null);
      setMessage(`Controller ${controller.name} deleted. Removed ${deleted.deleted_snapshots || 0} wireless samples.`);
      await load(false, false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete controller.');
    } finally {
      controllerDeleteInProgressRef.current = false;
      setControllerAction('');
    }
  };

  const editController = (controller: WirelessController) => {
    setEditingControllerId(controller.id);
    setControllerForm({
      name: controller.name || '',
      vendor: controller.vendor || 'generic',
      controller_role: controllerRole(controller),
      host: controller.host || '',
      port: String(controller.port || 443),
      protocol: controller.protocol || 'https',
      username: controller.username || '',
      password: '',
      snmp_credential_id: controller.snmp_credential_id == null ? '' : String(controller.snmp_credential_id),
      site_name: controller.site_name || '',
      verify_tls: controller.verify_tls !== false,
      enabled: controller.enabled !== false,
      notes: controller.notes || '',
    });
    setView('integrations');
    setMessage(`Editing ${controller.name}. Leave Password / Token blank to keep the saved secret.`);
  };

  const cancelControllerEdit = () => {
    setEditingControllerId('');
    setControllerForm(emptyControllerForm);
    setMessage('');
  };

  const updateForm = (field: keyof ControllerForm, value: string | boolean) => {
    setControllerForm((current) => ({ ...current, [field]: value }));
  };

  const updateVendor = (value: string) => {
    const defaults = vendorDefaults[value] || {};
    setControllerForm((current) => ({
      ...current,
      vendor: value,
      port: defaults.port || current.port,
      protocol: defaults.protocol || current.protocol,
      notes: current.notes || defaults.notes || '',
    }));
  };

  const updateSnmpCredential = (value: string) => {
    const selected = snmpProfiles.find((profile) => String(profile.id) === value);
    setControllerForm((current) => ({
      ...current,
      snmp_credential_id: value,
      port: selected?.port ? String(selected.port) : current.port || '161',
    }));
  };
  const controllerSiteOptions = Array.from(new Set(
    infrastructureSites
      .filter((site) => String(site.status || 'Active').toLowerCase() !== 'offline')
      .map((site) => site.name.trim())
      .filter(Boolean),
  )).sort((a, b) => a.localeCompare(b));
  const controllerSiteMissing = Boolean(controllerForm.site_name && !controllerSiteOptions.includes(controllerForm.site_name));
  const apSiteOptions = buildApSiteOptions(sites, infrastructureSites, infrastructureLocations);
  const apLocationSiteName = apLocationEdit ? siteNameFromApSiteValue(apLocationEdit.site_id, sites) : '';
  const apLocationOptions = Array.from(new Set(
    infrastructureLocations
      .filter((location) => String(location.status || 'Active').toLowerCase() !== 'offline')
      .filter((location) => {
        if (!apLocationSiteName) return false;
        const locationSite = String(location.site || '').trim().toLowerCase();
        return !locationSite || locationSite === apLocationSiteName.trim().toLowerCase();
      })
      .map((location) => location.name.trim())
      .filter(Boolean),
  )).sort((a, b) => a.localeCompare(b));
  const apLocationSelectOptions = [
    { value: '', label: apLocationSiteName ? 'No location' : 'Select site first' },
    ...apLocationOptions.map((location) => ({ value: location, label: location })),
    ...(apLocationEdit?.location && !apLocationOptions.some((location) => location.toLowerCase() === apLocationEdit.location.toLowerCase())
      ? [{ value: apLocationEdit.location, label: `${apLocationEdit.location} (current)` }]
      : []),
  ];

  const openApDetail = async (device: Device) => {
    setApDetailTarget(device);
    setApDetail(null);
    setApDetailError('');
    setApDetailLoading(true);
    try {
      const detail = await authenticated((auth) => loadApDetailApi(auth, device));
      setApDetail(detail);
      setApDetailError('');
    } catch (error) {
      setApDetailError(error instanceof Error ? error.message : 'Unable to load AP details.');
    } finally {
      setApDetailLoading(false);
    }
  };

  const toggleApSelected = (key: string) => {
    setSelectedApKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  const toggleShownApsSelected = () => {
    setSelectedApKeys((current) => allShownApsSelected
      ? current.filter((key) => !shownApKeys.includes(key))
      : Array.from(new Set([...current, ...shownApKeys])));
  };

  const exportSelectedAps = () => {
    exportRowsCsv(
      'wireless-inventory-selected.csv',
      ['AP', 'Role', 'Management IP', 'MAC', 'Site', 'Location', 'Platform', 'Clients', 'Status', 'Controller', 'Last Seen'],
      selectedAps.map((device) => [
        apDisplayName(device),
        device.role || device.device_type || '',
        device.management_ip || '',
        device.mac_address || '',
        siteName(device) || '',
        apLocationValue(device),
        device.platform || device.device_type || '',
        clientCount(device),
        device.status || '',
        device.controller_name || '',
        device.last_seen_at || '',
      ]),
    );
  };

  const changeApSort = (field: WirelessApSortField) => {
    if (apSortField === field) {
      setApSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setApSortField(field);
    setApSortDirection(['users', 'traffic', 'health', 'last_seen'].includes(field) ? 'desc' : 'asc');
  };
  const apSortHeader = (field: WirelessApSortField, label: string) => (
    <button type="button" className={`sort-header ${apSortField === field ? 'active' : ''}`} onClick={() => changeApSort(field)}>
      {label}{apSortField === field ? ` (${apSortDirection})` : ''}
    </button>
  );

  const openSingleApLocationEdit = (device: Device) => {
    const location = matchInfrastructureLocation(device, infrastructureLocations) || apLocationValue(device);
    const locationSite = siteForInfrastructureLocation(location, infrastructureLocations);
    setApLocationEdit({
      mode: 'single',
      device,
      site_id: apSiteValueForDevice(device, sites, locationSite),
      location,
    });
  };

  const openBulkApLocationEdit = () => {
    const first = selectedAps[0];
    const location = first ? matchInfrastructureLocation(first, infrastructureLocations) || apLocationValue(first) : '';
    const locationSite = siteForInfrastructureLocation(location, infrastructureLocations);
    setApLocationEdit({
      mode: 'bulk',
      site_id: first ? apSiteValueForDevice(first, sites, locationSite) : '',
      location,
    });
  };

  const updateApLocationEdit = (field: 'site_id' | 'location', value: string) => {
    setApLocationEdit((current) => current ? { ...current, [field]: value } : current);
  };

  const updateApLocationSite = (value: string) => {
    setApLocationEdit((current) => current ? { ...current, site_id: value, location: '' } : current);
  };

  const saveApLocationEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!apLocationEdit) return;
    const editableDevices = apLocationEdit.mode === 'single' ? [apLocationEdit.device] : selectedAps;
    const ids = editableDevices.map((device) => Number(device.id)).filter((id) => Number.isFinite(id));
    if (!ids.length) {
      setMessage('Selected APs do not have editable inventory records.');
      return;
    }
    setApLocationSaving(true);
    try {
      if (apLocationEdit.mode === 'single') {
        const updated = await authenticated(async (auth) => {
          const siteId = await resolveApSiteId(auth, apLocationEdit.site_id, sites, setSites);
          if (siteId === 'unauthorized') return 'unauthorized';
          const locationRows = await ensureSharedInfrastructureLocation(auth, apLocationEdit.location, siteNameFromApSiteValue(apLocationEdit.site_id, sites));
          if (locationRows === 'unauthorized') return 'unauthorized';
          setInfrastructureLocations(locationRows);
          return updateApInventoryDevice(auth, ids[0], {
            location: apLocationEdit.location.trim(),
            site_id: siteId,
          });
        });
        setDevices((current) => current.map((device) => Number(device.id) === ids[0] ? { ...device, ...updated } : device));
        setApDetailTarget((current) => current && Number(current.id) === ids[0] ? { ...current, ...updated } : current);
        if (apDetail?.access_point && Number(apDetail.access_point.id) === ids[0]) {
          setApDetail({ ...apDetail, access_point: { ...apDetail.access_point, ...updated } });
        }
        setMessage(`${apDisplayName(updated)} site and location updated.`);
      } else {
        await authenticated(async (auth) => {
          const siteId = await resolveApSiteId(auth, apLocationEdit.site_id, sites, setSites);
          if (siteId === 'unauthorized') return 'unauthorized';
          const locationRows = await ensureSharedInfrastructureLocation(auth, apLocationEdit.location, siteNameFromApSiteValue(apLocationEdit.site_id, sites));
          if (locationRows === 'unauthorized') return 'unauthorized';
          setInfrastructureLocations(locationRows);
          return updateBulkApInventoryDevices(auth, ids, {
            location: apLocationEdit.location.trim(),
            site_id: siteId,
          });
        });
        setSelectedApKeys([]);
        setMessage(`${ids.length} selected APs updated.`);
        await load(false, false);
      }
      setApLocationEdit(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update AP site and location.');
    } finally {
      setApLocationSaving(false);
    }
  };

  const refreshApDetail = async () => {
    const target = apDetail?.access_point || apDetailTarget;
    if (target) await openApDetail(target);
  };

  return (
    <div className="content wireless-page">
      <div className="page-title">
        <div>
          <h1>{view === 'integrations' ? 'Wireless Integrations' : 'Wireless Monitoring'}</h1>
          <p>{view === 'integrations' ? 'Connect controllers and manage wireless data collection sources.' : 'Monitor wireless health, users, traffic, controllers, and access points.'}</p>
        </div>
        <button className="plain-button" onClick={() => load(false, true)}><RefreshCw size={16} /> {loading ? 'Refreshing...' : 'Refresh'}</button>
      </div>

      {message && <div className="module-notice inventory-notice">{message}<button onClick={() => setMessage('')}><X size={15} /></button></div>}

      <div className="wireless-subnav">
        <button className={view === 'monitoring' ? 'active' : ''} onClick={() => setView('monitoring')}>Monitoring</button>
        <button className={view === 'integrations' ? 'active' : ''} onClick={() => setView('integrations')}>Integrations</button>
      </div>

      {view === 'monitoring' && (apDetail || apDetailTarget || apDetailLoading || apDetailError) ? (
        <WirelessApDetailView
          detail={apDetail}
          target={apDetailTarget}
          loading={apDetailLoading}
          error={apDetailError}
          onBack={() => { setApDetail(null); setApDetailTarget(null); setApDetailError(''); }}
          onRefresh={refreshApDetail}
          onEditLocation={openSingleApLocationEdit}
        />
      ) : view === 'integrations' ? (
        <>
          <section className="card wireless-setup-card">
            <div>
              <h2>{editingControllerId ? 'Edit Controller Connection' : 'Controller Connection'}</h2>
              <p>{editingControllerId ? 'Update the controller endpoint and collection role.' : 'Add the controller endpoint used to collect AP, SSID, radio, and client data.'}</p>
            </div>
            <form onSubmit={saveController} className="wireless-controller-form">
              <label>Name<input required value={controllerForm.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="Main WLC" /></label>
              <label>Vendor<select value={controllerForm.vendor} onChange={(event) => updateVendor(event.target.value)}>{vendorOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Controller role
                <select value={controllerForm.controller_role} onChange={(event) => updateForm('controller_role', event.target.value)}>
                  <option value="primary">Primary - populate dashboard</option>
                  <option value="backup">Backup - exclude from dashboard</option>
                </select>
              </label>
              <label>Host / IP<input required value={controllerForm.host} onChange={(event) => updateForm('host', event.target.value)} placeholder="10.10.10.20" /></label>
              <label>Port<input required type="number" min="1" max="65535" value={controllerForm.port} onChange={(event) => updateForm('port', event.target.value)} /></label>
              <label>Protocol<select value={controllerForm.protocol} onChange={(event) => updateForm('protocol', event.target.value)}><option value="https">HTTPS</option><option value="http">HTTP</option><option value="snmp">SNMP</option><option value="ssh">SSH</option><option value="api">Vendor API</option></select></label>
              <label>Username<input value={controllerForm.username} onChange={(event) => updateForm('username', event.target.value)} placeholder="readonly-api" /></label>
              {controllerForm.protocol === 'snmp' && (
                <label>SNMP community source
                  <select value={controllerForm.snmp_credential_id} onChange={(event) => updateSnmpCredential(event.target.value)}>
                    <option value="">Password / Token field</option>
                    <option value="0" disabled={!globalSnmpConfigured}>Global SNMP community{globalSnmpConfigured ? '' : ' (not configured)'}</option>
                    {snmpProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.port ? ` | UDP ${profile.port}` : ''}</option>)}
                  </select>
                </label>
              )}
              <label>Password / Token<input type="password" value={controllerForm.password} onChange={(event) => updateForm('password', event.target.value)} placeholder={editingControllerId ? 'Leave blank to keep saved secret' : 'Encrypted on save'} /></label>
              <label>Site
                <SearchableSelect
                  value={controllerForm.site_name}
                  onChange={(value) => updateForm('site_name', value)}
                  placeholder="Unassigned"
                  searchPlaceholder="Search sites..."
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...controllerSiteOptions.map((site) => ({ value: site, label: site })),
                    ...(controllerSiteMissing ? [{ value: controllerForm.site_name, label: `${controllerForm.site_name} (not in Infrastructure Sites)` }] : []),
                  ]}
                />
              </label>
              <label className="toggle-row"><input type="checkbox" checked={controllerForm.verify_tls} onChange={(event) => updateForm('verify_tls', event.target.checked)} /> Verify TLS</label>
              <label className="toggle-row"><input type="checkbox" checked={controllerForm.enabled} onChange={(event) => updateForm('enabled', event.target.checked)} /> Enabled</label>
              <label className="wireless-notes">Notes<textarea value={controllerForm.notes} onChange={(event) => updateForm('notes', event.target.value)} placeholder="Auth type, API path, tenant, or collection notes" /></label>
              <div className="wireless-form-actions">
                {editingControllerId && <button className="plain-button" type="button" onClick={cancelControllerEdit}>Cancel edit</button>}
                <button className="add" type="submit" disabled={saving}><Plus size={16} /> {saving ? 'Saving...' : editingControllerId ? 'Save changes' : 'Save controller'}</button>
              </div>
            </form>
          </section>

          <WirelessControllersTable
            controllers={controllers}
            snmpProfiles={snmpProfiles}
            controllerAction={controllerAction}
            onEdit={editController}
            onTest={testController}
            onScan={scanController}
            onDelete={setDeleteControllerPrompt}
          />
        </>
      ) : (
        <>

          <WirelessDashboard
            stats={stats}
            controllers={monitoringControllers}
            mapControllers={controllers}
            accessPoints={dashboardAps}
            infrastructureLocations={infrastructureLocations}
            history={monitoringHistory}
            summary={monitoringSummary}
            updatedAt={monitoringUpdatedAt}
            refreshStatus={monitoringRefresh}
            onOpenIntegrations={() => setView('integrations')}
            onOpenApDetail={openApDetail}
          />

      <section className="card inventory advanced-card wireless-card">
        {selectedApKeys.length > 0 && (
          <div className="bulk-toolbar">
            <b>{selectedApKeys.length} selected</b>
            <button className="plain-button" disabled={!selectedAps.length} onClick={() => selectedAps[0] && openApDetail(selectedAps[0])}>Open first</button>
            <button className="plain-button" disabled={!selectedAps.length} onClick={openBulkApLocationEdit}>Edit site/location</button>
            <button className="plain-button" disabled={!selectedAps.length} onClick={exportSelectedAps}>Export selected</button>
            <button className="plain-button" onClick={() => setSelectedApKeys([])}>Clear</button>
          </div>
        )}
        <div className="inventory-head">
          <div className="card-title">{scanResult ? 'AP Scan Results' : 'Wireless Inventory'} <small>{shownAps.length} shown | {dashboardAps.length} counted APs</small></div>
          <div className="inventory-controls">
            {scanResult && <button className="plain-button" onClick={() => setScanResult(null)}>Show inventory</button>}
            <div className="table-search">
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search AP, controller, IP, site..." />
            </div>
          </div>
        </div>
        {scanResult?.note && <div className="wireless-scan-note">{scanResult.note}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" checked={allShownApsSelected} onChange={toggleShownApsSelected} aria-label="Select all visible wireless inventory rows" /></th>
                <th>{apSortHeader('device', 'DEVICE')}</th>
                <th>{apSortHeader('role', 'ROLE')}</th>
                <th>{apSortHeader('management', 'MANAGEMENT')}</th>
                <th>{apSortHeader('site', 'SITE')}</th>
                <th>{apSortHeader('location', 'LOCATION')}</th>
                <th>{apSortHeader('platform', 'PLATFORM')}</th>
                <th>{apSortHeader('users', 'USERS')}</th>
                <th>{apSortHeader('traffic', 'TRAFFIC')}</th>
                <th>{apSortHeader('health', 'HEALTH')}</th>
                <th>{apSortHeader('status', 'STATUS')}</th>
                <th>{apSortHeader('collection', 'COLLECTION')}</th>
                <th>{apSortHeader('last_seen', 'LAST SEEN')}</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {!shownAps.length ? (
                <tr><td colSpan={14} className="empty">No AP devices found yet. Add wireless devices to inventory or scan a controller.</td></tr>
              ) : shownAps.map((device) => (
                <tr key={apRowKey(device)} className="clickable-row" onClick={() => openApDetail(device)}>
                  <td><input type="checkbox" checked={selectedApKeys.includes(apRowKey(device))} onClick={(event) => event.stopPropagation()} onChange={() => toggleApSelected(apRowKey(device))} aria-label={`Select ${apDisplayName(device)}`} /></td>
                  <td><b>{apDisplayName(device)}</b><small>{apSecondaryIdentity(device)}</small></td>
                  <td>{device.role || device.device_type || '-'}</td>
                  <td><b>{device.management_ip || '-'}</b><small>{device.mac_address || device.tags || '-'}</small></td>
                  <td>{siteName(device) || 'Unassigned'}</td>
                  <td><b>{apLocationValue(device)}</b><small>{device.location ? 'Saved location' : siteName(device) ? 'From site value' : '-'}</small></td>
                  <td><b>{device.platform || device.device_type || '-'}</b><small>{[device.manufacturer, device.model, device.software_version].filter(Boolean).join(' | ') || '-'}</small></td>
                  <td><b>{clientCount(device)}</b><small>{numeric(device.radios) ? `${numeric(device.radios)} radios` : '-'}</small></td>
                  <td><b>{formatRate(totalTrafficRate(device))}</b><small>{formatBytes(totalTrafficBytes(device))}</small></td>
                  <td><b>{healthLabel(device)}</b><small>{healthDetail(device)}</small></td>
                  <td><span className={`status ${(device.status || 'planned').toLowerCase()}`}>{device.status || 'Unknown'}</span></td>
                  <td>{device.snmp_status || 'Not checked'}</td>
                  <td>{device.last_seen_at || '-'}</td>
                  <td><button className="row-action" onClick={(event) => { event.stopPropagation(); openSingleApLocationEdit(device); }}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

        </>
      )}

      {apLocationEdit && (
        <div className="modal-backdrop" onMouseDown={() => !apLocationSaving && setApLocationEdit(null)}>
          <form className="device-form wireless-location-form" onSubmit={saveApLocationEdit} onMouseDown={(event) => event.stopPropagation()}>
            <div className="form-header">
              <div>
                <h2>{apLocationEdit.mode === 'single' ? 'Edit AP Site / Location' : 'Edit Selected APs'}</h2>
                <p>{apLocationEdit.mode === 'single' ? apDisplayName(apLocationEdit.device) : `${selectedAps.length} selected APs`}</p>
              </div>
              <button type="button" onClick={() => !apLocationSaving && setApLocationEdit(null)}><X /></button>
            </div>
            <div className="form-grid">
              <label>Site
                <SearchableSelect
                  value={apLocationEdit.site_id}
                  onChange={updateApLocationSite}
                  placeholder="Unassigned"
                  searchPlaceholder="Search sites..."
                  options={[{ value: '', label: 'Unassigned' }, ...apSiteOptions]}
                />
              </label>
              <label>Location
                <SearchableSelect
                  value={apLocationEdit.location}
                  onChange={(value) => updateApLocationEdit('location', value)}
                  placeholder={apLocationSiteName ? 'Select location' : 'Select site first'}
                  searchPlaceholder="Search locations..."
                  disabled={!apLocationSiteName}
                  options={apLocationSelectOptions}
                />
              </label>
            </div>
            <p className="field-help">Sites come from the backend Sites table. Locations come from backend Infrastructure Locations and are filtered by the selected site.</p>
            <div className="form-actions">
              <button type="button" onClick={() => setApLocationEdit(null)} disabled={apLocationSaving}>Cancel</button>
              <button className="add" type="submit" disabled={apLocationSaving}>{apLocationSaving ? 'Saving...' : 'Save changes'}</button>
            </div>
          </form>
        </div>
      )}

      {deleteControllerPrompt && (
        <DeleteConfirmDialog
          open
          title="Delete wireless controller"
          itemName={deleteControllerPrompt.name}
          message="This removes the controller profile and all wireless monitoring data collected from it."
          details={[
            `Endpoint: ${deleteControllerPrompt.protocol.toUpperCase()} ${deleteControllerPrompt.host}:${deleteControllerPrompt.port}`,
            `Role: ${controllerRole(deleteControllerPrompt) === 'backup' ? 'Backup / excluded from dashboard' : 'Primary / populates dashboard'}`,
            `Last scan: ${deleteControllerPrompt.last_scan ? `${deleteControllerPrompt.last_scan.aps} APs at ${deleteControllerPrompt.last_scan.scanned_at}` : 'No completed scan recorded'}`,
            'Collected AP snapshots, trend history, and current dashboard rows for this controller will be deleted.',
          ]}
          confirmLabel="Delete controller"
          busy={controllerAction === `${deleteControllerPrompt.id}:delete`}
          onCancel={() => controllerAction ? undefined : setDeleteControllerPrompt(null)}
          onConfirm={() => deleteController(deleteControllerPrompt)}
        />
      )}
    </div>
  );
}

function WirelessDashboard({
  stats,
  controllers,
  mapControllers,
  accessPoints,
  infrastructureLocations,
  history,
  summary,
  updatedAt,
  refreshStatus,
  onOpenIntegrations,
  onOpenApDetail,
}: {
  stats: WirelessDashboardStats;
  controllers: WirelessController[];
  mapControllers: WirelessController[];
  accessPoints: Device[];
  infrastructureLocations: InfrastructureLocationRecord[];
  history: WirelessHistoryPoint[];
  summary: WirelessMonitoringSummary;
  updatedAt: string | null;
  refreshStatus: WirelessRefreshStatus | null;
  onOpenIntegrations: () => void;
  onOpenApDetail: (device: Device) => void;
}) {
  const liveSummary = buildLiveWirelessSummary(accessPoints, summary);
  const apHealthCounts = countApHealth(accessPoints);
  const apCount = liveSummary.access_points.total;
  const healthyAps = apHealthCounts.total ? apHealthCounts.online : liveSummary.access_points.healthy;
  const warningApCount = apHealthCounts.total ? apHealthCounts.warning : liveSummary.access_points.warning;
  const criticalApCount = apHealthCounts.total ? apHealthCounts.critical : liveSummary.access_points.critical;
  const clientTotal = liveSummary.clients.total;
  const rxRate = liveSummary.usage.downlink;
  const txRate = liveSummary.usage.uplink;
  const topClients = sortApsByClients(accessPoints).slice(0, 5);
  const controllerCritical = controllers.filter((controller) => controller.enabled && controllerHealthState(controller) === false).length;
  const controllerWarning = controllers.filter((controller) => controller.enabled && controllerHealthState(controller) === null).length;
  const controllerHealthy = controllers.filter((controller) => controller.enabled && controllerHealthState(controller) === true).length;
  const alertCritical = criticalApCount + controllerCritical;
  const alertMajor = warningApCount;
  const alertMinor = controllerWarning;
  const alertTotal = alertCritical + alertMajor + alertMinor;
  const healthMetrics = buildHealthMetrics({ controllers, controllerHealthy, accessPoints, healthyAps, apCount });
  const availableHealthValues = healthMetrics.map((item) => item.value).filter((value): value is number => value !== null);
  const healthScore = availableHealthValues.length ? Math.round(sumNumbers(availableHealthValues) / availableHealthValues.length) : null;
  const totalRate = liveSummary.usage.total_rate;
  const historyBuckets = buildWirelessHistory(history);
  const historyLabels = buildChartAxisLabels(historyBuckets.map((point) => point.sampledAt));
  const historyWindow = historyWindowLabel(historyBuckets.map((point) => point.sampledAt));
  const downlinkSeries = historyBuckets.map((point) => point.rxRate);
  const uplinkSeries = historyBuckets.map((point) => point.txRate);
  const criticalSeries = historyBuckets.map((point) => point.critical);
  const majorSeries = historyBuckets.map((point) => point.major);
  const minorSeries = historyBuckets.map((point) => point.minor);
  const bandClients = liveSummary.clients;
  const alertRows = buildWirelessAlerts({ controllers, accessPoints }).slice(0, 5);
  const activityRows = buildWirelessActivity({ controllers, accessPoints, updatedAt }).slice(0, 5);
  const modelDistribution = buildModelDistribution(accessPoints);
  const siteGroups = buildWirelessSiteGroups(accessPoints, infrastructureLocations);
  const topTraffic = [...accessPoints].sort((a, b) => totalTrafficRate(b) - totalTrafficRate(a)).slice(0, 5);
  const recentAps = [...accessPoints].sort((a, b) => Date.parse(String(b.last_seen_at || '')) - Date.parse(String(a.last_seen_at || ''))).slice(0, 8);
  const systemHealthValue = healthScore ?? 0;
  const liveState = wirelessLiveState(updatedAt, refreshStatus);

  return (
    <section className="wireless-dashboard wireless-console">
      <div className="wireless-console-layout">
        <div className="wireless-console-main">
          <div className="console-kpi-grid">
            <ConsoleKpiCard title="System Health" value={`${formatNumber(systemHealthValue)}%`} subtitle={healthScore === null ? 'No data' : healthScore >= 90 ? 'Excellent' : healthScore >= 75 ? 'Good' : healthScore >= 50 ? 'Warning' : 'Critical'} tone={healthScore !== null && healthScore >= 75 ? 'green' : 'orange'}>
              <MiniSparkline values={historyBuckets.map((point) => point.major + point.critical)} color="#55d646" invert />
            </ConsoleKpiCard>
            <ConsoleKpiCard title="Access Points" value={formatNumber(apCount)} subtitle="Controller collected" tone="blue">
              <MiniDonut total={apCount} segments={[{ label: 'Online', value: healthyAps, color: '#55d646' }, { label: 'Warning', value: warningApCount, color: '#f6b73c' }, { label: 'Critical', value: criticalApCount, color: '#ff4d37' }]} />
              <ConsoleLegend rows={[['Online', healthyAps, '#55d646'], ['Warning', warningApCount, '#f6b73c'], ['Critical', criticalApCount, '#ff4d37']]} />
            </ConsoleKpiCard>
            <ConsoleKpiCard title="Clients" value={formatNumber(clientTotal)} subtitle="Total" tone="cyan">
              <MiniSparkline values={historyBuckets.map((point) => point.major + point.minor)} color="#3d8cff" />
              <ConsoleLegend rows={[['2.4 GHz', bandClients.band_24, '#55d646'], ['5 GHz', bandClients.band_5, '#3d8cff'], ['Unknown', bandClients.unknown, '#8da3ff']]} />
            </ConsoleKpiCard>
            <ConsoleKpiCard title="Throughput" value={formatRate(totalRate)} subtitle="Total" tone="purple">
              <MiniSparkline values={downlinkSeries} color="#3d8cff" />
              <ConsoleLegend rows={[['Downlink', rxRate, '#3d8cff', formatRate(rxRate)], ['Uplink', txRate, '#a855f7', formatRate(txRate)]]} />
            </ConsoleKpiCard>
            <ConsoleKpiCard title="Alerts" value={formatNumber(alertTotal)} subtitle="Current" tone={alertTotal ? 'red' : 'green'}>
              <ConsoleLegend rows={[['Critical', alertCritical, '#ff4d37'], ['Major', alertMajor, '#f97316'], ['Minor', alertMinor, '#f6c443']]} />
            </ConsoleKpiCard>
          </div>

          <div className="console-grid upper">
            <div className="wireless-panel console-card">
              <div className="wireless-panel-title">Client Connections</div>
              <div className="console-donut-row">
                <WirelessDonut total={clientTotal} segments={[{ label: '2.4 GHz', value: bandClients.band_24, color: '#55d646' }, { label: '5 GHz', value: bandClients.band_5, color: '#3d8cff' }, { label: 'Unknown', value: bandClients.unknown, color: '#8da3ff' }]} center={formatNumber(clientTotal)} />
                <ConsoleLegend rows={[['2.4 GHz', bandClients.band_24, '#55d646'], ['5 GHz', bandClients.band_5, '#3d8cff'], ['Unknown', bandClients.unknown, '#8da3ff']]} />
              </div>
              <TopApsDashboardTable devices={topClients} onOpenApDetail={onOpenApDetail} />
            </div>

            <div className="wireless-panel console-card network-map-card expanded">
              <div className="wireless-panel-title">Network Map</div>
              <WirelessMiniMap
                controllers={mapControllers}
                siteGroups={siteGroups}
                onOpenApDetail={onOpenApDetail}
              />
            </div>
          </div>

          <div className="console-grid lower">
            <div className="wireless-panel console-card">
              <div className="wireless-panel-title">Access Points By Model</div>
              {modelDistribution.length ? (
                <div className="console-donut-row">
                  <WirelessDonut total={apCount} segments={modelDistribution.map((item) => ({ label: item.label, value: item.value, color: item.color }))} center={formatNumber(apCount)} />
                  <ConsoleLegend rows={modelDistribution.map((item) => [item.label, item.value, item.color])} />
                </div>
              ) : <EmptyWirelessFunction text="No AP model information collected yet." />}
            </div>

            <div className="wireless-panel console-card">
              <div className="wireless-panel-head"><span>Top APs By Throughput</span><button className="dashboard-link" onClick={onOpenIntegrations}>Collectors</button></div>
              <RankedBarList devices={topTraffic} onOpenApDetail={onOpenApDetail} />
            </div>

            <div className="wireless-panel console-card">
              <div className="wireless-panel-head"><span>Throughput Trend</span><em className="chart-window-label">{historyWindow}</em></div>
              <WirelessLineChart
                series={[
                  { label: 'Downlink', color: '#3d8cff', values: downlinkSeries },
                  { label: 'Uplink', color: '#a855f7', values: uplinkSeries },
                ]}
                labels={historyLabels}
                unit="bps"
              />
            </div>
          </div>

          <div className="wireless-panel console-card recent-clients-card">
            <div className="wireless-panel-title">Recent AP Samples</div>
            <RecentApTable devices={recentAps} onOpenApDetail={onOpenApDetail} />
          </div>
        </div>

        <aside className="wireless-console-side">
          <div className="wireless-panel console-card">
            <div className="wireless-panel-head"><span>Active Alerts ({formatNumber(summary.alerts.total)})</span><button className="dashboard-link" onClick={onOpenIntegrations}>View All</button></div>
            <AlertList rows={alertRows} />
          </div>
          <div className="wireless-panel console-card">
            <div className="wireless-panel-title">Recent Activity</div>
            <ActivityList rows={activityRows} />
          </div>
          <div className="wireless-panel console-card system-info-card">
            <div className="wireless-panel-title">System Information</div>
            <SystemInfo controllers={mapControllers} accessPoints={accessPoints} updatedAt={updatedAt} />
          </div>
        </aside>
      </div>

      <WirelessOperations
        controllers={controllers}
        accessPoints={accessPoints}
        onOpenIntegrations={onOpenIntegrations}
      />
      <div className="wireless-live-stamp">{liveState.detail}</div>
    </section>
  );
}

function WirelessApDetailView({
  detail,
  target,
  loading,
  error,
  onBack,
  onRefresh,
  onEditLocation,
}: {
  detail: WirelessApDetail | null;
  target: Device | null;
  loading: boolean;
  error: string;
  onBack: () => void;
  onRefresh: () => void;
  onEditLocation: (device: Device) => void;
}) {
  const ap = detail?.access_point || target;
  const snmp = detail?.snmp;
  const system = snmp?.system || {};
  const uptime = String(system.sys_uptime || system.hr_system_uptime || ap?.uptime || '-');
  const controllerName = detail?.controller?.name || ap?.controller_name || '-';
  const showError = Boolean(error && !ap);
  return (
    <section className="wireless-ap-detail">
      <div className="wireless-detail-toolbar">
        <button className="plain-button" onClick={onBack}>Back to monitoring</button>
        {ap && <button className="plain-button" onClick={() => onEditLocation(ap)}>Edit site/location</button>}
        <button className="plain-button" onClick={onRefresh} disabled={loading}><RefreshCw size={15} /> {loading ? 'Loading...' : 'Refresh AP detail'}</button>
      </div>
      <div className="wireless-ap-hero console-card">
        <div>
          <span>Wireless access point</span>
          <h2>{ap ? apDisplayName(ap) : 'Loading AP'}</h2>
          <p>{[ap?.management_ip, ap?.mac_address, detail?.controller?.name].filter(Boolean).join(' / ') || 'Resolving access point details'}</p>
        </div>
        <div className="wireless-ap-hero-side">
          <div className="wireless-ap-icon"><RadioTower size={34} /></div>
        </div>
      </div>
      {showError && <div className="module-notice inventory-notice">{error}<button onClick={onBack}><X size={15} /></button></div>}
      {loading && !detail ? <EmptyWirelessFunction text="Loading AP SNMP details..." /> : null}
      {ap && (
        <>
          <div className="wireless-ap-kpis">
            <div><span>Status</span><b>{ap.status || '-'}</b></div>
            <div><span>Clients</span><b>{formatNumber(clientCount(ap))}</b></div>
            <div><span>Throughput</span><b>{formatRate(totalTrafficRate(ap))}</b></div>
            <div><span>CPU</span><b>{formatNumber(numeric(ap.cpu_util))}%</b></div>
            <div><span>Memory</span><b>{formatNumber(numeric(ap.memory_util))}%</b></div>
            <div><span>Uptime</span><b>{uptime}</b></div>
          </div>

          <div className="wireless-ap-grid">
            <section className="wireless-panel console-card">
              <div className="wireless-panel-title">Identity</div>
              <div className="detail-grid compact">
                <ApDetailRow label="AP name" value={apDisplayName(ap)} />
                <ApDetailRow label="Hostname" value={ap.hostname} />
                <ApDetailRow label="Management IP" value={ap.management_ip} />
                <ApDetailRow label="MAC address" value={ap.mac_address} />
                <ApDetailRow label="Model" value={ap.model} />
                <ApDetailRow label="Serial number" value={ap.serial_number} />
                <ApDetailRow label="Software" value={ap.software_version} />
                <ApDetailRow label="Hardware" value={ap.hardware_version} />
                <ApDetailRow label="Controller" value={detail?.controller?.name || ap.controller_name} />
                <ApDetailRow label="Site" value={siteName(ap)} />
                <ApDetailRow label="ZoneDirector AP index" value={ap.zd_ap_index || ap.zd_config_index} />
                <ApDetailRow label="Controller memory total" value={ap.memory_total_kb ? `${formatNumber(numeric(ap.memory_total_kb))} KB` : '-'} />
                <ApDetailRow label="Location" value={apLocationValue(ap)} />
              </div>
            </section>
            <section className="wireless-panel console-card">
              <div className="wireless-panel-title">Controller Information</div>
              <div className="wireless-ap-info-box">
                <div><span>Controller</span><b>{controllerName}</b></div>
                <div><span>Collection</span><b>{ap.snmp_status || 'Controller collected'}</b></div>
                <div><span>AP status</span><b>{ap.status || '-'}</b></div>
                <div><span>Uptime</span><b>{uptime}</b></div>
                <div><span>Traffic rates</span><b>{formatRate(numeric(ap.traffic_rx_rate))} down / {formatRate(numeric(ap.traffic_tx_rate))} up</b></div>
                <div><span>LAN counters</span><b>{formatBytes(numeric(ap.traffic_rx_bytes))} in / {formatBytes(numeric(ap.traffic_tx_bytes))} out</b></div>
                <div><span>Client traffic</span><b>{formatBytes(numeric(ap.client_rx_kbytes) * 1024)} in / {formatBytes(numeric(ap.client_tx_kbytes) * 1024)} out</b></div>
                <div><span>Memory</span><b>{formatNumber(numeric(ap.memory_util))}%{ap.memory_used_kb ? ` (${formatNumber(numeric(ap.memory_used_kb))} KB used)` : ''}</b></div>
                <div><span>Errors / drops</span><b>{formatNumber(numeric(ap.lan_rx_errors))} errors / {formatNumber(numeric(ap.dropped_packets))} drops</b></div>
                <div><span>Last sample</span><b>{ap.last_seen_at || detail?.snapshot?.sampled_at || '-'}</b></div>
              </div>
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function ApDetailRow({ label, value }: { label: string; value: unknown }) {
  const display = value === null || value === undefined || value === '' ? '-' : String(value);
  return <p><span>{label}</span>{display}</p>;
}

function WirelessKpiCard({ icon, title, value, tone, details }: { icon: ReactNode; title: string; value: string | number; tone: string; details: string[] }) {
  return (
    <div className="wireless-kpi-card">
      <div className={`kpi-icon ${tone}`}>{icon}</div>
      <span>{title}</span>
      <b>{value}</b>
      <div>{details.map((detail, index) => <small key={detail} className={index === 0 ? 'good' : index === 1 ? 'warn' : 'bad'}>{detail}</small>)}</div>
    </div>
  );
}

function ConsoleKpiCard({ title, value, subtitle, tone, children }: { title: string; value: string; subtitle: string; tone: string; children?: ReactNode }) {
  return (
    <div className={`console-kpi ${tone}`}>
      <span>{title}</span>
      <b>{value}</b>
      <small>{subtitle}</small>
      {children && <div className="console-kpi-body">{children}</div>}
    </div>
  );
}

function ConsoleLegend({ rows }: { rows: Array<[string, number, string, string?]> }) {
  return (
    <div className="console-legend">
      {rows.map(([label, value, color, display]) => (
        <div key={label}><i style={{ background: color }} /><span>{label}</span><b>{display || formatNumber(value)}</b></div>
      ))}
    </div>
  );
}

function MiniSparkline({ values, color, invert = false }: { values: number[]; color: string; invert?: boolean }) {
  const max = Math.max(...values, 1);
  const points = values.length ? values : [0];
  const path = points.map((value, index) => {
    const x = points.length > 1 ? (index / (points.length - 1)) * 130 : 0;
    const normalized = Math.max(0, value) / max;
    const y = invert ? 42 - (1 - normalized) * 36 : 42 - normalized * 36;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="mini-sparkline" viewBox="0 0 130 46" preserveAspectRatio="none">
      <path d={path} stroke={color} />
    </svg>
  );
}

function MiniDonut({ total, segments }: { total: number; segments: { label: string; value: number; color: string }[] }) {
  return <WirelessDonut total={total} segments={segments} center={formatNumber(total)} />;
}

function WirelessMiniMap({
  controllers,
  siteGroups,
  onOpenApDetail,
}: {
  controllers: WirelessController[];
  siteGroups: WirelessSiteGroup[];
  onOpenApDetail: (device: Device) => void;
}) {
  const [selected, setSelected] = useState<WirelessSiteGroup | null>(null);
  const [zoom, setZoom] = useState(0.86);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const groups = siteGroups.length ? siteGroups : [];
  const columns = Math.max(6, Math.ceil(Math.sqrt(Math.max(groups.length, 1) * 2)));
  const siteGapX = 116;
  const siteGapY = 94;
  const configuredControllers = [...controllers].sort((a, b) => (
    controllerSortWeight(a) - controllerSortWeight(b)
    || Number(b.enabled) - Number(a.enabled)
    || a.name.localeCompare(b.name)
  ));
  const controllerCount = Math.max(configuredControllers.length, 1);
  const canvasWidth = Math.max(760, 100 + (columns - 1) * siteGapX + 120, 180 + controllerCount * 190);
  const rows = Math.max(1, Math.ceil(groups.length / columns));
  const canvasHeight = Math.max(360, 190 + rows * siteGapY);
  const controllerY = 86;
  const siteY = 206;
  const controllerGap = Math.min(230, Math.max(176, (canvasWidth - 210) / Math.max(controllerCount - 1, 1)));
  const controllerStartX = canvasWidth / 2 - ((controllerCount - 1) * controllerGap) / 2;
  const controllerNodes: WirelessMapControllerNode[] = configuredControllers.length
    ? configuredControllers.map((controller, index) => ({
      key: controller.id || `${controller.host}-${index}`,
      controller,
      role: controllerRole(controller),
      label: controllerRoleLabel(controller),
      x: controllerStartX + index * controllerGap,
      y: controllerY,
    }))
    : [{
      key: 'no-controller',
      controller: null as WirelessController | null,
      role: 'primary',
      label: 'Primary',
      x: canvasWidth / 2,
      y: controllerY,
    }];
  const primaryNode = controllerNodes.find((node) => node.controller && isMonitoringController(node.controller))
    || controllerNodes.find((node) => node.role === 'primary')
    || controllerNodes[0];
  const controllerNodeById = new Map(controllerNodes
    .filter((node) => node.controller)
    .map((node) => [String(node.controller?.id || '').trim(), node]));
  const controllerNodeByName = new Map(controllerNodes
    .filter((node) => node.controller)
    .map((node) => [normalizeControllerIdentity(node.controller?.name), node]));
  const controllerBusY = controllerY - 30;
  const firstControllerX = Math.min(...controllerNodes.map((node) => node.x));
  const lastControllerX = Math.max(...controllerNodes.map((node) => node.x));
  const siteNodes = groups.map((site, index) => ({
    site,
    x: 70 + (index % columns) * siteGapX,
    y: siteY + Math.floor(index / columns) * siteGapY,
    links: controllerLinksForSite(site, controllerNodeById, controllerNodeByName, primaryNode),
  }));

  useEffect(() => {
    if (selected && !groups.some((group) => group.name === selected.name)) {
      setSelected(null);
    }
  }, [groups, selected]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button,.map-site-node,.map-building-panel')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y });
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({ x: drag.panX + event.clientX - drag.x, y: drag.panY + event.clientY - drag.y });
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag?.pointerId === event.pointerId) setDrag(null);
  };

  return (
    <div
      className={`wireless-mini-map interactive${drag ? ' dragging' : ''}`}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="map-tools">
        <button type="button" title="Move map"><Move size={14} /></button>
        <button type="button" title="Zoom in" onClick={() => setZoom((value) => Math.min(2.2, Number((value + 0.14).toFixed(2))))}><ZoomIn size={14} /></button>
        <button type="button" title="Zoom out" onClick={() => setZoom((value) => Math.max(0.45, Number((value - 0.14).toFixed(2))))}><ZoomOut size={14} /></button>
        <button type="button" title="Reset map" onClick={() => { setZoom(0.86); setPan({ x: 0, y: 0 }); setSelected(null); }}>Reset</button>
      </div>
      {groups.length ? (
        <div className="map-viewport">
          <div
            className="map-world"
            style={{ width: canvasWidth, height: canvasHeight, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
          >
            <svg className="map-links" viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} preserveAspectRatio="none">
              <line x1={canvasWidth / 2} y1={42} x2={canvasWidth / 2} y2={controllerBusY} />
              <line x1={firstControllerX} y1={controllerBusY} x2={lastControllerX} y2={controllerBusY} className="standby-link" />
              {controllerNodes.map((node) => (
                <line key={`controller-${node.key}`} x1={node.x} y1={controllerBusY} x2={node.x} y2={node.y - 40} />
              ))}
              {siteNodes.flatMap(({ site, x, y, links }, siteIndex) => links.map((link) => (
                <line
                  key={`${site.name}-${siteIndex}-${link.node.key}`}
                  className={link.node.role === 'backup' ? 'standby-link' : undefined}
                  x1={link.node.x + link.offset}
                  y1={controllerY + 46}
                  x2={x + link.offset}
                  y2={y - 30}
                />
              )))}
            </svg>
            <div className="map-internet-node" style={{ left: canvasWidth / 2, top: 30 }}>
              <Globe2 size={20} /><span>Internet</span>
            </div>
            {controllerNodes.map((node) => {
              const controller = node.controller;
              const isPrimary = node.role === 'primary';
              const isBackup = node.role === 'backup';
              return (
                <div
                  key={node.key}
                  className={`map-controller-node ${isPrimary ? 'primary' : 'standby'}${isBackup ? ' present' : ''}${controller?.enabled === false ? ' disabled' : ''}`}
                  style={{ left: node.x, top: node.y }}
                  title={controller ? `${controller.name} | ${controller.protocol}://${controller.host}:${controller.port}` : 'No controller configured'}
                >
                  <Server size={26} />
                  <b>{controller?.name || 'Wireless controller'}</b>
                  <span>{controller?.host || 'No IP'}</span>
                  <em>{controller ? node.label : 'No controller'}</em>
                </div>
              );
            })}
            {siteNodes.map(({ site, x, y }) => (
              <button
                type="button"
                key={site.name}
                className={`map-site-node${selected?.name === site.name ? ' active' : ''}`}
                style={{ left: x, top: y }}
                onClick={() => setSelected(site)}
                title={`${site.name}: ${formatNumber(site.aps)} APs, ${formatNumber(site.clients)} clients`}
              >
                <Building2 size={28} />
                <b>{site.name}</b>
                <span>{formatNumber(site.aps)} APs</span>
                <small>{formatNumber(site.clients)} clients</small>
              </button>
            ))}
          </div>
        </div>
      ) : <EmptyWirelessFunction text="No AP building grouping collected yet." />}
      {selected ? (
        <div className="map-building-panel">
          <div className="map-building-head">
            <div><b>{selected.name}</b><span>{formatNumber(selected.aps)} APs | {formatNumber(selected.clients)} clients</span></div>
            <button type="button" title="Close building list" onClick={() => setSelected(null)}><X size={14} /></button>
          </div>
          <div className="map-building-list">
            {selected.devices
              .slice()
              .sort((a, b) => clientCount(b) - clientCount(a) || apDisplayName(a).localeCompare(apDisplayName(b)))
              .map((device) => (
                <button type="button" key={device.id || device.management_ip || device.mac_address || apDisplayName(device)} onClick={() => onOpenApDetail(device)}>
                  <span><b>{apDisplayName(device)}</b><small>{device.management_ip || device.mac_address || 'No management identity'}</small></span>
                  <em>{formatNumber(clientCount(device))} clients</em>
                  <strong>{formatRate(totalTrafficRate(device))}</strong>
                </button>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RankedBarList({ devices, onOpenApDetail }: { devices: Device[]; onOpenApDetail: (device: Device) => void }) {
  const max = Math.max(...devices.map(totalTrafficRate), 1);
  if (!devices.length) return <EmptyWirelessFunction text="No AP throughput records collected yet." />;
  return (
    <div className="ranked-bars">
      {devices.map((device) => {
        const value = totalTrafficRate(device);
        const name = apDisplayName(device);
        return (
          <div key={device.id || device.management_ip || device.name} className="clickable-row" onClick={() => onOpenApDetail(device)}>
            <span><b>{name}</b><em>{formatRate(value)}</em></span>
            <i><strong style={{ width: `${percent(value, max)}%` }} /></i>
          </div>
        );
      })}
    </div>
  );
}

function RecentApTable({ devices, onOpenApDetail }: { devices: Device[]; onOpenApDetail: (device: Device) => void }) {
  if (!devices.length) return <EmptyWirelessFunction text="No AP samples collected yet." />;
  return (
    <div className="dashboard-table recent-ap-table">
      <table>
        <thead><tr><th>AP Name</th><th>IP Address</th><th>MAC Address</th><th>Model</th><th>Clients</th><th>Usage</th><th>Status</th></tr></thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.id || device.management_ip || device.name} className="clickable-row" onClick={() => onOpenApDetail(device)}>
              <td>{apDisplayName(device)}</td>
              <td>{device.management_ip || '-'}</td>
              <td>{device.mac_address || '-'}</td>
              <td>{device.model || '-'}</td>
              <td>{formatNumber(clientCount(device))}</td>
              <td>{formatRate(totalTrafficRate(device))}</td>
              <td><span className={`ap-sample-status dot-text ${needsAttention(device) ? 'warning' : 'healthy'}`}>{device.status || 'Unknown'}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertList({ rows }: { rows: WirelessAlertRow[] }) {
  if (!rows.length) return <EmptyWirelessFunction text="No active wireless alerts from the latest controller snapshot." />;
  return (
    <div className="console-alert-list">
      {rows.map((row) => (
        <div key={`${row.severity}-${row.title}-${row.detail}`}>
          <i className={row.severity} />
          <span>
            <b>{row.title}</b>
            <small>{row.detail}</small>
            {row.meta?.length ? <em className="alert-meta">{row.meta.map((item) => <strong key={item}>{item}</strong>)}</em> : null}
          </span>
          <em>{row.age}</em>
        </div>
      ))}
    </div>
  );
}

function ActivityList({ rows }: { rows: WirelessActivityRow[] }) {
  if (!rows.length) return <EmptyWirelessFunction text="No controller activity recorded yet." />;
  return (
    <div className="console-activity-list">
      {rows.map((row) => (
        <div key={`${row.kind}-${row.title}-${row.time}-${row.sortTime}`}>
          <ActivityIcon kind={row.kind} ok={row.ok} />
          <span>
            <b>{row.title}</b>
            <small>{row.detail}</small>
            {row.meta?.length ? <em className="activity-meta">{row.meta.map((item) => <strong key={item}>{item}</strong>)}</em> : null}
          </span>
          <em className="activity-time" title={row.timestamp ? formatExactTimestamp(row.timestamp) : row.time}>{row.timestamp ? relativeAgeLabel(row.timestamp) : row.time}</em>
        </div>
      ))}
    </div>
  );
}

function ActivityIcon({ kind, ok }: { kind: WirelessActivityKind; ok: boolean }) {
  const Icon = kind === 'snapshot' ? RefreshCw : kind === 'scan' ? Wifi : kind === 'controller' ? Gauge : Activity;
  return (
    <i className={`${ok ? 'ok' : 'warn'} ${kind}`}>
      <Icon size={13} strokeWidth={2.5} />
    </i>
  );
}

function SystemInfo({ controllers, accessPoints, updatedAt }: { controllers: WirelessController[]; accessPoints: Device[]; updatedAt: string | null }) {
  const versions = [...new Set(accessPoints.map((device) => String(device.software_version || '').trim()).filter(Boolean))];
  const models = [...new Set(accessPoints.map((device) => String(device.model || '').trim()).filter(Boolean))];
  return (
    <div className="system-info-list">
      <div><span>Controllers</span><b>{controllers.length}</b></div>
      <div><span>Access points</span><b>{formatNumber(accessPoints.length)}</b></div>
      <div><span>AP models</span><b>{models.length ? formatNumber(models.length) : 'N/A'}</b></div>
      <div><span>AP software</span><b>{versions[0] || 'N/A'}</b></div>
      <div><span>Latest sample</span><b>{updatedAt ? relativeAgeLabel(updatedAt) : 'N/A'}</b></div>
    </div>
  );
}

function UnavailableMetric({ label }: { label: string }) {
  return (
    <div className="wireless-metric-bar unavailable">
      <span>{label}<b>N/A</b></span>
      <div><i style={{ width: '0%' }} /></div>
    </div>
  );
}

function ControllerSummaryTable({ controllers, accessPoints }: { controllers: WirelessController[]; accessPoints: Device[] }) {
  if (!controllers.length) return <p className="wireless-empty-mini">No wireless controllers configured yet.</p>;
  return (
    <div className="dashboard-table">
      <table>
        <thead><tr><th>Name</th><th>Status</th><th>Managed APs</th><th>Clients</th><th>Uptime</th></tr></thead>
        <tbody>
          {controllers.slice(0, 5).map((controller) => {
            const controllerAps = accessPoints.filter((device) => String(device.controller_id || '') === controller.id);
            const managedAps = controllerAps.length || controller.last_scan?.aps || 0;
            const clients = sum(controllerAps, clientCount);
            const health = controllerHealthState(controller);
            const status = health === true ? 'Healthy' : health === false ? 'Critical' : 'Warning';
            const checkedAt = controller.last_live_collection?.checked_at || controller.last_test?.checked_at;
            return (
              <tr key={controller.id}>
                <td>{controller.name}</td>
                <td><span className={`dot-text ${status.toLowerCase()}`}>{status}</span></td>
                <td>{formatNumber(managedAps)}</td>
                <td>{formatNumber(clients)}</td>
                <td>{checkedAt ? relativeAgeLabel(checkedAt) : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TopApsDashboardTable({ devices, onOpenApDetail }: { devices: Device[]; onOpenApDetail: (device: Device) => void }) {
  if (!devices.length) return <p className="wireless-empty-mini">No AP client data collected yet.</p>;
  return (
    <div className="dashboard-table top-client-table">
      <table>
        <thead><tr><th>AP Name</th><th>Clients</th><th>Usage</th></tr></thead>
        <tbody>
          {devices.slice(0, 5).map((device) => (
            <tr key={device.id || device.management_ip || device.name} className="clickable-row" onClick={() => onOpenApDetail(device)}>
              <td>{apDisplayName(device)}</td>
              <td>{formatNumber(clientCount(device))}</td>
              <td>{formatRate(totalTrafficRate(device))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WirelessDonut({ total, segments, center }: { total: number; segments: { label: string; value: number; color: string }[]; center: string }) {
  const realTotal = Math.max(0, total || 0);
  if (realTotal <= 0 || sumNumbers(segments.map((segment) => segment.value)) <= 0) {
    return <div className="wireless-donut empty"><div><b>{center}</b><span>Total</span></div></div>;
  }
  let cursor = 0;
  const stops = segments.map((segment) => {
    const start = cursor;
    const end = cursor + (Math.max(0, segment.value) / realTotal) * 360;
    cursor = end;
    return `${segment.color} ${start}deg ${end}deg`;
  }).join(',');
  return <div className="wireless-donut" style={{ background: `conic-gradient(${stops || '#20364f 0deg 360deg'})` }}><div><b>{center}</b><span>Total</span></div></div>;
}

function WirelessLineChart({ series, labels, unit }: { series: { label: string; color: string; values: number[] }[]; labels: string[]; unit: string }) {
  const allValues = series.flatMap((item) => item.values);
  const hasData = allValues.some((value) => value > 0);
  const max = niceChartMax(Math.max(...allValues, 1));
  const yTicks = [max, max * 0.75, max * 0.5, max * 0.25, 0];
  return (
    <div className={`wireless-line-chart ${hasData ? '' : 'empty'}`}>
      <svg viewBox="0 0 560 190" preserveAspectRatio="none" aria-hidden="true">
        {yTicks.map((tick, index) => {
          const y = 24 + index * 35;
          return (
            <g key={tick}>
              <text className="y-label" x="6" y={y + 3}>{formatAxisValue(tick, unit)}</text>
              <line className={index === yTicks.length - 1 ? 'baseline' : 'grid-line'} x1="34" x2="528" y1={y} y2={y} />
            </g>
          );
        })}
        {series.map((item) => (
          <path key={item.label} className="chart-line" d={linePath(item.values, max)} stroke={item.color} />
        ))}
      </svg>
      <div className="chart-axis">{labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
      <div className="chart-legend">{series.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>)}{unit && <em>{unit}</em>}</div>
      {!hasData && <div className="chart-empty-state">No alert changes collected in this period.</div>}
    </div>
  );
}

function WirelessOperations({
  controllers,
  accessPoints,
  onOpenIntegrations,
}: {
  controllers: WirelessController[];
  accessPoints: Device[];
  onOpenIntegrations: () => void;
}) {
  const ssids = buildSsidRows(accessPoints);
  const radios = accessPoints.filter(hasRadioData).slice(0, 5);
  const clientAps = [...accessPoints].filter((device) => clientCount(device) > 0).sort((a, b) => clientCount(b) - clientCount(a)).slice(0, 5);
  const relationships = accessPoints.slice(0, 5);
  const healthRows = [...accessPoints].sort((a, b) => Number(needsAttention(b)) - Number(needsAttention(a))).slice(0, 5);
  const supportedCollectors = ['Cisco WLC', 'Aruba', 'UniFi', 'Ruckus ZoneDirector', 'Ruckus SmartZone', 'Meraki'];

  return (
    <section className="wireless-functions">
      <div className="wireless-function-card">
        <div className="card-title">Vendor collectors <small>{controllers.length} configured</small></div>
        <p>Add controller API adapters for Cisco WLC, Aruba, UniFi, Ruckus ZoneDirector, Ruckus SmartZone, Meraki, or your active platform.</p>
        <div className="collector-pills">
          {supportedCollectors.map((collector) => (
            <span key={collector} className={collectorConfigured(collector, controllers) ? 'ready' : ''}>{collector}</span>
          ))}
        </div>
        <button className="plain-button wireless-panel-action" onClick={onOpenIntegrations}>Manage integrations</button>
      </div>

      <div className="wireless-function-card">
        <div className="card-title">SSIDs / WLANs <small>{ssids.length} seen</small></div>
        <p>SSID name, VLAN, security mode, broadcast state, controller/profile mapping.</p>
        {ssids.length ? (
          <div className="wireless-mini-table">
            {ssids.slice(0, 5).map((ssid) => (
              <div key={`${ssid.name}-${ssid.vlan}`}>
                <b>{ssid.name}</b>
                <span>VLAN {ssid.vlan} | {ssid.security} | {ssid.broadcast}</span>
              </div>
            ))}
          </div>
        ) : <EmptyWirelessFunction text="No SSID/WLAN records collected yet. Use a vendor collector that exposes WLAN profile data." />}
      </div>

      <div className="wireless-function-card">
        <div className="card-title">Radio details <small>{radios.length} APs</small></div>
        <p>2.4/5/6 GHz radio state, channel, channel width, TX power, utilization, noise, and interference.</p>
        {radios.length ? (
          <div className="wireless-mini-table">
            {radios.map((device) => (
              <div key={device.id || device.management_ip || device.name}>
                <b>{device.name}</b>
                <span>{fieldValue(device.radios, '0')} radios | channel {fieldValue(device.channel)} | TX {fieldValue(device.tx_power)}</span>
              </div>
            ))}
          </div>
        ) : <EmptyWirelessFunction text="No radio channel or RF detail collected yet." />}
      </div>

      <div className="wireless-function-card">
        <div className="card-title">Client sessions <small>{formatNumber(sum(accessPoints, clientCount))} clients</small></div>
        <p>Client MAC, username/hostname, AP, SSID, RSSI/SNR, IP address, VLAN, and session time.</p>
        {clientAps.length ? (
          <div className="wireless-mini-table">
            {clientAps.map((device) => (
              <div key={device.id || device.management_ip || device.name}>
                <b>{device.name}</b>
                <span>{clientCount(device)} clients | RSSI {fieldValue(device.rssi)} | VLAN {fieldValue(device.vlan)}</span>
              </div>
            ))}
          </div>
        ) : <EmptyWirelessFunction text="No per-client session records collected yet." />}
      </div>

      <div className="wireless-function-card">
        <div className="card-title">AP relationships <small>{accessPoints.length} APs</small></div>
        <p>Controller, site/floor/room, uplink switchport, mesh/uplink mode, and adoption/adoption state.</p>
        {relationships.length ? (
          <div className="wireless-mini-table">
            {relationships.map((device) => (
              <div key={device.id || device.management_ip || device.name}>
                <b>{device.name}</b>
                <span>{siteName(device) || 'Unassigned'} | {fieldValue(device.mesh_type || device.connection_mode)} | {device.status || 'Unknown'}</span>
              </div>
            ))}
          </div>
        ) : <EmptyWirelessFunction text="No AP relationship data collected yet." />}
      </div>

      <div className="wireless-function-card">
        <div className="card-title">Health history <small>{healthRows.filter(needsAttention).length} alerts</small></div>
        <p>Retry rate, packet loss, roaming events, channel changes, client count, alarms, and scan timestamps.</p>
        {healthRows.length ? (
          <div className="wireless-mini-table">
            {healthRows.map((device) => (
              <div key={device.id || device.management_ip || device.name}>
                <b>{device.name}</b>
                <span>{healthLabel(device)} | {healthDetail(device)} | {device.last_seen_at || 'No timestamp'}</span>
              </div>
            ))}
          </div>
        ) : <EmptyWirelessFunction text="No wireless health history collected yet." />}
      </div>
    </section>
  );
}

function EmptyWirelessFunction({ text }: { text: string }) {
  return <div className="wireless-function-empty">{text}</div>;
}

function WirelessControllersTable({
  controllers,
  snmpProfiles,
  controllerAction,
  onEdit,
  onTest,
  onScan,
  onDelete,
}: {
  controllers: WirelessController[];
  snmpProfiles: CredentialProfile[];
  controllerAction: string;
  onEdit: (controller: WirelessController) => void;
  onTest: (controller: WirelessController) => void;
  onScan: (controller: WirelessController) => void;
  onDelete: (controller: WirelessController) => void;
}) {
  return (
    <section className="card inventory advanced-card wireless-card">
      <div className="inventory-head">
        <div className="card-title">Wireless Controllers <small>{controllers.length} profiles</small></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>CONTROLLER</th>
              <th>ROLE</th>
              <th>ENDPOINT</th>
              <th>SITE</th>
              <th>STATUS</th>
              <th>LAST TEST</th>
              <th>LAST SCAN</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {!controllers.length ? (
              <tr><td colSpan={8} className="empty">No wireless controllers configured yet.</td></tr>
            ) : controllers.map((controller) => (
              <tr key={controller.id}>
                <td><b>{controller.name}</b><small>{vendorLabel(controller.vendor)}</small></td>
                <td>
                  <span className={`status ${isMonitoringController(controller) ? 'active' : 'maintenance'}`}>{controllerRoleLabel(controller)}</span>
                  <small>{isMonitoringController(controller) ? 'Populates dashboard' : 'Excluded from dashboard'}</small>
                </td>
                <td><b>{controller.protocol}://{controller.host}:{controller.port}</b><small>{controller.username || controllerSnmpSource(controller, snmpProfiles)}</small></td>
                <td>{controller.site_name || 'Unassigned'}<small>{controller.notes || '-'}</small></td>
                <td><span className={`status ${controller.enabled ? 'active' : 'maintenance'}`}>{controller.enabled ? 'Enabled' : 'Disabled'}</span></td>
                <td>
                  {controller.last_test ? <b className={controller.last_test.ok ? 'good-text' : 'bad-text'}>{controller.last_test.ok ? 'Reachable' : 'Failed'}</b> : '-'}
                  <small>{controller.last_test?.detail || 'Not tested'}</small>
                </td>
                <td>
                  <b>{controller.last_scan ? `${controller.last_scan.aps} APs` : '-'}</b>
                  <small>{controller.last_scan?.scanned_at || 'Not scanned'}</small>
                </td>
                <td className="wireless-actions">
                  <button className="row-action" onClick={() => onEdit(controller)}>
                    Edit
                  </button>
                  <button className="row-action" disabled={controllerAction === `${controller.id}:test`} onClick={() => onTest(controller)}>
                    {controllerAction === `${controller.id}:test` ? 'Testing...' : 'Test'}
                  </button>
                  <button className="row-action" disabled={controllerAction === `${controller.id}:scan`} onClick={() => onScan(controller)}>
                    {controllerAction === `${controller.id}:scan` ? 'Scanning...' : 'Scan APs'}
                  </button>
                  <button className="row-action danger" disabled={controllerAction === `${controller.id}:delete`} onClick={() => onDelete(controller)}>
                    <Trash2 size={14} /> Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MetricBar({ label, value, warnAt = 101 }: { label: string; value: number; warnAt?: number }) {
  const bounded = Math.max(0, Math.min(100, value || 0));
  const className = value >= warnAt ? 'warn' : 'ok';
  return (
    <div className="wireless-metric-bar">
      <span>{label}<b>{bounded}%</b></span>
      <div><i className={className} style={{ width: `${bounded}%` }} /></div>
    </div>
  );
}

function WirelessRankList({ devices, mode }: { devices: Device[]; mode: 'clients' | 'traffic' }) {
  if (!devices.length) return <p className="wireless-empty-mini">No AP data collected yet.</p>;
  return (
    <div className="wireless-rank-list">
      {devices.map((device) => (
        <div key={device.id || device.management_ip || device.name}>
          <span><b>{apDisplayName(device)}</b><small>{device.management_ip || device.model || '-'}</small></span>
          <strong>{mode === 'clients' ? clientCount(device) : formatRate(totalTrafficRate(device))}</strong>
        </div>
      ))}
    </div>
  );
}

async function loadWirelessData(auth: string, includeStatic = true, refreshLive = true, fast = false): Promise<[WirelessController[], CredentialProfile[], Site[], boolean, WirelessMonitoring, InfrastructureLocationRecord[]] | 'unauthorized'> {
  const monitoring = await loadMonitoring(auth, refreshLive, fast);
  if (monitoring === 'unauthorized') return 'unauthorized';
  let controllers = monitoring.controllers || [];
  if (!controllers.length) {
    const loadedControllers = await loadControllers(auth);
    if (loadedControllers === 'unauthorized') return 'unauthorized';
    controllers = loadedControllers;
  }
  if (!includeStatic) return [controllers, [], [], false, monitoring, []];

  const [credentials, sites, settings, locations] = await Promise.all([loadCredentials(auth), loadSites(auth), loadSettings(auth), loadInfrastructureLocationsApi(auth)]);
  if (credentials === 'unauthorized' || sites === 'unauthorized' || settings === 'unauthorized' || locations === 'unauthorized') return 'unauthorized';
  const globalSnmp = settings.some((setting) => setting.key === 'snmp_community' && setting.configured);
  return [controllers, credentials, sites, globalSnmp, monitoring, locations];
}

async function loadAllDevices(auth: string): Promise<Device[] | 'unauthorized'> {
  const first = await fetchDevicesPage(auth, 1);
  if (first === 'unauthorized') return first;
  const pages = Math.max(first.meta.pages || 1, 1);
  const devices = [...first.data];
  for (let page = 2; page <= pages; page += 1) {
    const next = await fetchDevicesPage(auth, page);
    if (next === 'unauthorized') return next;
    devices.push(...next.data);
  }
  return devices;
}

async function fetchDevicesPage(auth: string, page: number): Promise<{ data: Device[]; meta: { pages: number } } | 'unauthorized'> {
  const params = new URLSearchParams({ page: String(page), per_page: '100', sort: 'name', direction: 'asc' });
  const response = await fetch(`${api}/devices?${params.toString()}`, { headers: { Authorization: `Bearer ${auth}` } });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load devices.');
  return {
    data: json.data?.data || [],
    meta: json.data?.meta || { pages: 1 },
  };
}

async function loadControllers(auth: string): Promise<WirelessController[] | 'unauthorized'> {
  const response = await fetch(`${api}/wireless/controllers`, { headers: { Authorization: `Bearer ${auth}` } });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load wireless controllers.');
  return json.data?.data || [];
}

async function loadCredentials(auth: string): Promise<CredentialProfile[] | 'unauthorized'> {
  const response = await fetch(`${api}/credentials`, { headers: { Authorization: `Bearer ${auth}` } });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load credential profiles.');
  return json.data?.data || [];
}

async function loadSites(auth: string): Promise<Site[] | 'unauthorized'> {
  const response = await fetch(`${api}/sites`, { headers: { Authorization: `Bearer ${auth}` } });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load sites.');
  return json.data?.data || [];
}

async function createSite(auth: string, name: string): Promise<Site | 'unauthorized'> {
  const response = await fetch(`${api}/sites`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, location: 'Wireless' }),
  });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to create site.');
  return json.data;
}

async function loadInfrastructureLocationsApi(auth: string): Promise<InfrastructureLocationRecord[] | 'unauthorized'> {
  const response = await fetch(`${api}/infrastructure/Locations`, { headers: { Authorization: `Bearer ${auth}` } });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load infrastructure locations.');
  const rows = json.data?.records || [];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      name: String(row?.name || '').trim(),
      site: String(row?.site || '').trim(),
      status: String(row?.status || '').trim(),
      source: 'backend',
    }))
    .filter((row) => row.name);
}

async function saveInfrastructureLocationsApi(auth: string, rows: InfrastructureLocationRecord[]): Promise<'saved' | 'unauthorized'> {
  const response = await fetch(`${api}/infrastructure/Locations`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: rows.map((row) => ({ ...row, _merge_key: `location:${row.name}`.toLowerCase() })) }),
  });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to save infrastructure locations.');
  return 'saved';
}

async function loadSettings(auth: string): Promise<Setting[] | 'unauthorized'> {
  const response = await fetch(`${api}/settings`, { headers: { Authorization: `Bearer ${auth}` } });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load settings.');
  return json.data?.data || [];
}

async function updateApInventoryDevice(auth: string, id: number, values: Record<string, string | number | null>): Promise<Device | 'unauthorized'> {
  const response = await fetch(`${api}/devices/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to update AP inventory record.');
  return json.data;
}

async function updateBulkApInventoryDevices(auth: string, ids: number[], values: Record<string, string | number | null>): Promise<{ updated: number } | 'unauthorized'> {
  const response = await fetch(`${api}/devices/bulk`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, values }),
  });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to update selected AP inventory records.');
  return json.data;
}

async function loadMonitoring(auth: string, refreshLive = true, fast = false): Promise<WirelessMonitoring | 'unauthorized'> {
  const response = await fetch(`${api}/wireless/monitoring?refresh=${refreshLive ? '1' : '0'}&fast=${fast ? '1' : '0'}`, { headers: { Authorization: `Bearer ${auth}` } });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load wireless monitoring.');
  return {
    access_points: json.data?.access_points || [],
    history: json.data?.history || [],
    summary: normalizeMonitoringSummary(json.data?.summary),
    updated_at: json.data?.updated_at || null,
    source: json.data?.source || '',
    controllers: json.data?.controllers || [],
    monitoring_controllers: json.data?.monitoring_controllers || [],
    refresh: normalizeRefreshStatus(json.data?.refresh),
  };
}

async function loadApDetailApi(auth: string, device: Device): Promise<WirelessApDetail | 'unauthorized'> {
  const apKey = String(device.mac_address || device.management_ip || '').trim() || String(device.id || device.name || '');
  const params = new URLSearchParams({
    ap_key: apKey,
    controller_id: String(device.controller_id || ''),
    refresh: '1',
  });
  const response = await fetch(`${api}/wireless/access-points/detail?${params.toString()}`, { headers: { Authorization: `Bearer ${auth}` } });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load AP details.');
  return json.data;
}

function normalizeRefreshStatus(value: Partial<WirelessRefreshStatus> | undefined): WirelessRefreshStatus {
  return {
    requested: Boolean(value?.requested),
    attempted: numeric(value?.attempted),
    refreshed: numeric(value?.refreshed),
    skipped: numeric(value?.skipped),
    failed: numeric(value?.failed),
    collected_ap_records: numeric(value?.collected_ap_records),
    throttle_seconds: numeric(value?.throttle_seconds) || 3,
    refreshed_at: value?.refreshed_at || null,
    errors: Array.isArray(value?.errors) ? value.errors : [],
  };
}

function normalizeMonitoringSummary(value: Partial<WirelessMonitoringSummary> | undefined): WirelessMonitoringSummary {
  return {
    access_points: {
      total: numeric(value?.access_points?.total),
      healthy: numeric(value?.access_points?.healthy),
      warning: numeric(value?.access_points?.warning),
      critical: numeric(value?.access_points?.critical),
    },
    clients: {
      total: numeric(value?.clients?.total),
      band_24: numeric(value?.clients?.band_24),
      band_5: numeric(value?.clients?.band_5),
      unknown: numeric(value?.clients?.unknown),
    },
    alerts: {
      total: numeric(value?.alerts?.total),
      critical: numeric(value?.alerts?.critical),
      major: numeric(value?.alerts?.major),
      minor: numeric(value?.alerts?.minor),
    },
    usage: {
      total_rate: numeric(value?.usage?.total_rate),
      downlink: numeric(value?.usage?.downlink),
      uplink: numeric(value?.usage?.uplink),
    },
  };
}

async function saveControllerApi(auth: string, payload: Omit<ControllerForm, 'port' | 'snmp_credential_id'> & { port: number; snmp_credential_id: number | null }, controllerId = ''): Promise<WirelessController | 'unauthorized'> {
  const response = await fetch(controllerId ? `${api}/wireless/controllers/${controllerId}` : `${api}/wireless/controllers`, {
    method: controllerId ? 'PUT' : 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to save wireless controller.');
  return json.data;
}

async function testControllerApi(auth: string, id: string): Promise<WirelessController | 'unauthorized'> {
  const response = await fetch(`${api}/wireless/controllers/${id}/test`, { method: 'POST', headers: { Authorization: `Bearer ${auth}` } });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to test wireless controller.');
  return json.data;
}

async function scanControllerApi(auth: string, id: string): Promise<{ data: WirelessScanResult; job_id: number } | 'unauthorized'> {
  const response = await fetch(`${api}/wireless/controllers/${id}/scan`, { method: 'POST', headers: { Authorization: `Bearer ${auth}` } });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to scan wireless controller.');
  return { data: json.data, job_id: json.job_id };
}

async function deleteControllerApi(auth: string, id: string): Promise<{ id: string; deleted_snapshots: number } | 'unauthorized'> {
  let response = await fetch(`${api}/wireless/controllers/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${auth}` } });
  if (response.status === 405 || response.status === 404) {
    response = await fetch(`${api}/wireless/controllers/${id}/delete`, { method: 'POST', headers: { Authorization: `Bearer ${auth}` } });
  }
  if (response.status === 401) return 'unauthorized';
  const text = await response.text();
  const json = text ? JSON.parse(text) : { data: { id, deleted_snapshots: 0 } };
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to delete wireless controller.');
  return json.data || { id, deleted_snapshots: 0 };
}

function isWirelessDevice(device: Device) {
  const text = [device.name, device.hostname, device.role, device.device_type, device.platform, device.manufacturer, device.model, device.tags].join(' ').toLowerCase();
  return (
    text.includes('wireless')
    || text.includes('access point')
    || text.includes('wlan')
    || text.includes('wifi')
    || text.includes('wi-fi')
    || text.includes('wlc')
    || text.includes('aironet')
    || text.includes('aruba')
    || text.includes('unifi')
    || text.includes('ruckus')
    || text.includes('zoneflex')
    || /\bap[-_\s]/.test(text)
  );
}

function isWirelessController(device: Device) {
  const roleText = [device.role, device.device_type].join(' ').toLowerCase();
  if (roleText.includes('access point') || /\bap\b/.test(roleText)) return false;

  const identityText = [device.name, device.hostname, device.role, device.device_type, device.tags].join(' ').toLowerCase();
  return (
    identityText.includes('controller')
    || identityText.includes('wlc')
    || identityText.includes('zonedirector')
    || identityText.includes('zone director')
    || identityText.includes('smartzone')
    || /\bzd[-_\s]?\d+/.test(identityText)
  );
}

function vendorLabel(value: string) {
  if (value === 'ruckus') return 'Ruckus SmartZone';
  return vendorOptions.find(([key]) => key === value)?.[1] || value || 'Generic';
}

function controllerRole(controller: Pick<WirelessController, 'controller_role' | 'name'>) {
  const role = String(controller.controller_role || '').trim().toLowerCase();
  const name = String(controller.name || '').trim().toLowerCase();
  if (role === 'backup' || role === 'standby' || role === 'secondary') return 'backup';
  if (!role && (name.includes('backup') || name.includes('standby'))) return 'backup';
  return 'primary';
}

function controllerSortWeight(controller: Pick<WirelessController, 'controller_role' | 'name' | 'monitoring_enabled'>) {
  if (isMonitoringController(controller)) return 0;
  return controllerRole(controller) === 'backup' ? 1 : 2;
}

function isMonitoringController(controller: Pick<WirelessController, 'controller_role' | 'name' | 'monitoring_enabled'>) {
  if (controller.monitoring_enabled === false) return false;
  return controllerRole(controller) === 'primary';
}

function controllerRoleLabel(controller: Pick<WirelessController, 'controller_role' | 'name'>) {
  return controllerRole(controller) === 'backup' ? 'Backup' : 'Primary';
}

function controllerSnmpSource(controller: WirelessController, profiles: CredentialProfile[]) {
  if (controller.protocol !== 'snmp') return controller.password_configured ? 'credential saved' : 'no credential';
  if (controller.snmp_credential_id === 0) return 'global SNMP';
  if (controller.snmp_credential_id) {
    return profiles.find((profile) => profile.id === controller.snmp_credential_id)?.name || `SNMP profile ${controller.snmp_credential_id}`;
  }
  return controller.password_configured ? 'password/token SNMP' : 'no SNMP community';
}

function percent(value: number, total: number) {
  return Math.max(0, Math.min(100, Math.round((value / Math.max(total, 1)) * 100)));
}

function isCriticalAp(device: Device) {
  const status = String(device.status || '').toLowerCase();
  return status.includes('down') || status.includes('disconnect') || numeric(device.cpu_util) >= 95 || numeric(device.memory_util) >= 95;
}

function buildLiveWirelessSummary(accessPoints: Device[], fallback: WirelessMonitoringSummary): WirelessMonitoringSummary {
  if (!accessPoints.length) return fallback;
  const health = countApHealth(accessPoints);
  const clients = accessPoints.reduce((totals, device) => {
    const count = clientCount(device);
    const radio24 = numeric(device.radio_clients_24);
    const radio5 = numeric(device.radio_clients_5);
    const radioUnknown = numeric(device.radio_clients_unknown);
    if (radio24 || radio5 || radioUnknown) {
      totals.hasRadio = 1;
      totals.total += radio24 + radio5 + radioUnknown;
      totals.band_24 += radio24;
      totals.band_5 += radio5;
      totals.unknown += radioUnknown;
    } else {
      totals.total += count;
      const band = apClientBand(device);
      if (band === '2.4') totals.band_24 += count;
      else if (band === '5') totals.band_5 += count;
      else totals.unknown += count;
    }
    return totals;
  }, { total: 0, band_24: 0, band_5: 0, unknown: 0, hasRadio: 0 });
  const downlink = sum(accessPoints, (device) => numeric(device.traffic_rx_rate));
  const uplink = sum(accessPoints, (device) => numeric(device.traffic_tx_rate));
  return {
    access_points: {
      total: health.total,
      healthy: health.online,
      warning: health.warning,
      critical: health.critical,
    },
    clients: { total: clients.total, band_24: clients.band_24, band_5: clients.band_5, unknown: clients.unknown },
    alerts: {
      total: health.warning + health.critical,
      critical: health.critical,
      major: health.warning,
      minor: 0,
    },
    usage: {
      total_rate: downlink + uplink,
      downlink,
      uplink,
    },
  };
}

function apClientBand(device: Device) {
  const band = String(device.band || device.radio_band || device.frequency || '').toLowerCase();
  if (band.includes('2.4') || band.includes('2400')) return '2.4';
  if (band.includes('5') || band.includes('5000')) return '5';
  const channel = numeric(device.channel);
  if (channel >= 1 && channel <= 14) return '2.4';
  if (channel > 14) return '5';
  return 'unknown';
}

function buildHealthMetrics({
  controllers,
  controllerHealthy,
  accessPoints,
  healthyAps,
  apCount,
}: {
  controllers: WirelessController[];
  controllerHealthy: number;
  accessPoints: Device[];
  healthyAps: number;
  apCount: number;
}) {
  const enabledControllers = controllers.filter((controller) => controller.enabled).length;
  const cpuMemoryDevices = accessPoints.filter((device) => numeric(device.cpu_util) > 0 || numeric(device.memory_util) > 0);
  const resourceHealthy = cpuMemoryDevices.filter((device) => numeric(device.cpu_util) < 85 && numeric(device.memory_util) < 90).length;
  const ssidRows = buildSsidRows(accessPoints);
  return [
    { label: 'Controllers', value: enabledControllers ? percent(controllerHealthy, enabledControllers) : null },
    { label: 'Access Points', value: apCount ? percent(healthyAps, apCount) : null },
    { label: 'AP Resources', value: cpuMemoryDevices.length ? percent(resourceHealthy, cpuMemoryDevices.length) : null },
    { label: 'Security', value: ssidRows.length ? percent(ssidRows.filter((ssid) => ssid.security !== '-').length, ssidRows.length) : null },
    { label: 'Network Services', value: enabledControllers ? percent(controllerHealthy, enabledControllers) : null },
  ];
}

function linePath(values: number[], max: number) {
  const points = chartPoints(values, max);
  if (!points.length) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
}

function chartPoints(values: number[], max: number) {
  const left = 34;
  const width = 494;
  const height = 140;
  const top = 24;
  const paddedValues = values.length ? values : [0];
  const step = paddedValues.length > 1 ? width / (paddedValues.length - 1) : width;
  return paddedValues.map((value, index) => {
    const x = left + index * step;
    const y = top + height - (Math.max(0, value) / Math.max(max, 1)) * height;
    return { x, y };
  });
}

function niceChartMax(value: number) {
  if (value <= 10) return 10;
  if (value <= 20) return 20;
  if (value <= 50) return 50;
  if (value <= 100) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function formatAxisValue(value: number, unit: string) {
  if (unit === 'bps') return formatBytes(value).replace(' ', '');
  return String(Math.round(value));
}

type WirelessHistoryBucket = { sampledAt: string; rxRate: number; txRate: number; critical: number; major: number; minor: number };

function buildWirelessHistory(history: WirelessHistoryPoint[]): WirelessHistoryBucket[] {
  const buckets = new Map<string, { sampledAt: string; rxRate: number; txRate: number; critical: number; major: number; minor: number }>();
  history.forEach((point) => {
    if (!point.sampled_at) return;
    const date = new Date(point.sampled_at);
    if (Number.isNaN(date.getTime())) return;
    date.setSeconds(Math.floor(date.getSeconds() / 10) * 10, 0);
    const key = date.toISOString();
    const bucket = buckets.get(key) || { sampledAt: key, rxRate: 0, txRate: 0, critical: 0, major: 0, minor: 0 };
    bucket.rxRate += numeric(point.traffic_rx_rate);
    bucket.txRate += numeric(point.traffic_tx_rate);
    if (point.critical != null || point.major != null || point.minor != null) {
      bucket.critical += numeric(point.critical);
      bucket.major += numeric(point.major);
      bucket.minor += numeric(point.minor);
    } else if (historyPointCritical(point)) bucket.critical += 1;
    else if (historyPointWarning(point)) bucket.major += 1;
    else if (numeric(point.clients) > 0) bucket.minor += 0;
    buckets.set(key, bucket);
  });
  return [...buckets.values()].sort((a, b) => a.sampledAt.localeCompare(b.sampledAt)).slice(-60);
}

function buildChartAxisLabels(sampledAtValues: string[]) {
  if (!sampledAtValues.length) return ['Now'];
  const targetLabels = 8;
  const indexes = new Set<number>();
  const lastIndex = sampledAtValues.length - 1;
  const labelCount = Math.min(targetLabels, sampledAtValues.length);
  for (let index = 0; index < labelCount; index += 1) {
    indexes.add(Math.round((index * lastIndex) / Math.max(labelCount - 1, 1)));
  }
  return [...indexes].sort((a, b) => a - b).map((index) => formatChartTime(sampledAtValues[index]));
}

function historyWindowLabel(sampledAtValues: string[]) {
  if (sampledAtValues.length < 2) return 'Live';
  const first = Date.parse(sampledAtValues[0]);
  const last = Date.parse(sampledAtValues[sampledAtValues.length - 1]);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return 'Live';
  const minutes = Math.max(1, Math.round((last - first) / 60000));
  if (minutes < 60) return `Last ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `Last ${hours} hr`;
}

function formatChartTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function historyPointCritical(point: WirelessHistoryPoint) {
  const status = String(point.status || '').toLowerCase();
  return status.includes('down') || status.includes('disconnect') || numeric(point.cpu_util) >= 95 || numeric(point.memory_util) >= 95;
}

function historyPointWarning(point: WirelessHistoryPoint) {
  const status = String(point.status || '').toLowerCase();
  return status.includes('pending') || status.includes('provision') || status.includes('upgrade') || status.includes('reboot') || numeric(point.cpu_util) >= 85 || numeric(point.memory_util) >= 90;
}

type WirelessSiteGroup = { name: string; aps: number; clients: number; devices: Device[] };
type WirelessMapControllerNode = {
  key: string;
  controller: WirelessController | null;
  role: string;
  label: string;
  x: number;
  y: number;
};
type WirelessMapSiteLink = { node: WirelessMapControllerNode; count: number; offset: number };
type InfrastructureLocationRecord = { name: string; site?: string; status?: string; source?: string };
type WirelessAlertRow = { severity: 'critical' | 'major' | 'minor'; title: string; detail: string; age: string; meta?: string[] };
type WirelessActivityKind = 'snapshot' | 'scan' | 'controller' | 'warning';
type WirelessActivityRow = { title: string; detail: string; time: string; timestamp?: string; ok: boolean; kind: WirelessActivityKind; sortTime: number; meta?: string[] };

function controllerLinksForSite(
  site: WirelessSiteGroup,
  controllerNodeById: Map<string, WirelessMapControllerNode>,
  controllerNodeByName: Map<string, WirelessMapControllerNode>,
  fallback: WirelessMapControllerNode,
): WirelessMapSiteLink[] {
  const counts = new Map<string, { node: WirelessMapControllerNode; count: number }>();
  site.devices.forEach((device) => {
    const node = controllerNodeForAp(device, controllerNodeById, controllerNodeByName, fallback);
    const row = counts.get(node.key) || { node, count: 0 };
    row.count += 1;
    counts.set(node.key, row);
  });
  const links = [...counts.values()].sort((a, b) => b.count - a.count || a.node.x - b.node.x);
  const rows = links.length ? links : [{ node: fallback, count: Math.max(site.aps, 1) }];
  return rows.map((row, index) => ({
    ...row,
    offset: (index - (rows.length - 1) / 2) * 8,
  }));
}

function controllerNodeForAp(
  device: Device,
  controllerNodeById: Map<string, WirelessMapControllerNode>,
  controllerNodeByName: Map<string, WirelessMapControllerNode>,
  fallback: WirelessMapControllerNode,
) {
  const controllerId = String(device.controller_id || '').trim();
  if (controllerId) {
    const byId = controllerNodeById.get(controllerId);
    if (byId) return byId;
  }

  const controllerName = normalizeControllerIdentity(device.controller_name);
  if (controllerName) {
    const byName = controllerNodeByName.get(controllerName);
    if (byName) return byName;
  }

  return fallback;
}

function normalizeControllerIdentity(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function buildWirelessAlerts({ controllers, accessPoints }: { controllers: WirelessController[]; accessPoints: Device[] }): WirelessAlertRow[] {
  const rows: WirelessAlertRow[] = [];
  controllers.forEach((controller) => {
    const health = controllerHealthState(controller);
    const event = controller.last_live_collection || controller.last_test;
    if (controller.enabled && health === false && event) {
      rows.push({
        severity: 'critical',
        title: 'Controller unreachable',
        detail: `${controller.name}: ${event.detail || 'Last check failed'}`,
        age: relativeAgeLabel(event.checked_at),
        meta: [`Host ${controller.host}:${controller.port}`, `Protocol ${controller.protocol.toUpperCase()}`],
      });
    } else if (controller.enabled && health === null) {
      rows.push({
        severity: 'minor',
        title: 'Controller not tested',
        detail: controller.name,
        age: '-',
        meta: [`Host ${controller.host}:${controller.port}`],
      });
    }
  });
  accessPoints.forEach((device) => {
    const status = String(device.status || '').toLowerCase();
    if (isCriticalAp(device)) {
      rows.push({
        severity: 'critical',
        title: status.includes('down') || status.includes('disconnect') ? 'AP offline' : 'AP critical utilization',
        detail: apDisplayName(device),
        age: wirelessAlertAge(device),
        meta: wirelessAlertMeta(device),
      });
    } else if (needsAttention(device)) {
      rows.push({
        severity: 'major',
        title: isUnknownApStatus(device) ? 'AP status unverified' : 'AP requires attention',
        detail: apDisplayName(device),
        age: wirelessAlertAge(device),
        meta: wirelessAlertMeta(device),
      });
    }
  });
  return rows.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
}

function buildWirelessActivity({ controllers, accessPoints, updatedAt }: { controllers: WirelessController[]; accessPoints: Device[]; updatedAt: string | null }): WirelessActivityRow[] {
  const rows: WirelessActivityRow[] = [];
  if (updatedAt) {
    rows.push({
      title: 'Controller snapshot collected',
      detail: `${formatNumber(accessPoints.length)} access points in the latest live sample`,
      time: relativeAgeLabel(updatedAt),
      timestamp: updatedAt,
      ok: true,
      kind: 'snapshot',
      sortTime: eventSortTime(updatedAt),
      meta: ['Wireless monitoring refresh', '4 sec polling'],
    });
  }
  controllers.forEach((controller) => {
    if (controller.last_scan?.job_id) {
      rows.push({
        title: controller.last_scan.ok ? 'AP scan completed' : 'AP scan failed',
        detail: `${controller.name}: ${formatNumber(controller.last_scan.aps)} APs`,
        time: relativeAgeLabel(controller.last_scan.scanned_at),
        timestamp: controller.last_scan.scanned_at,
        ok: controller.last_scan.ok,
        kind: controller.last_scan.ok ? 'scan' : 'warning',
        sortTime: eventSortTime(controller.last_scan.scanned_at),
        meta: [`${formatNumber(controller.last_scan.controllers)} controller records`, `Job ${controller.last_scan.job_id || 'latest'}`],
      });
    }
    if (controller.last_live_collection) {
      rows.push({
        title: controller.last_live_collection.ok ? 'Controller live collection' : 'Controller live collection failed',
        detail: `${controller.name} at ${controller.host}:${controller.port}`,
        time: relativeAgeLabel(controller.last_live_collection.checked_at),
        timestamp: controller.last_live_collection.checked_at,
        ok: controller.last_live_collection.ok,
        kind: controller.last_live_collection.ok ? 'controller' : 'warning',
        sortTime: eventSortTime(controller.last_live_collection.checked_at),
        meta: [
          `${controller.protocol.toUpperCase()} ${Math.round(controller.last_live_collection.elapsed_ms || 0)} ms`,
          `${formatNumber(controller.last_live_collection.aps || 0)} APs collected`,
          controller.last_live_collection.detail,
        ].filter(Boolean),
      });
    }
    if (controller.last_test && !String(controller.last_test.detail || '').toLowerCase().includes('live collection')) {
      rows.push({
        title: controller.last_test.ok ? 'Controller test succeeded' : 'Controller test failed',
        detail: `${controller.name} at ${controller.host}:${controller.port}`,
        time: relativeAgeLabel(controller.last_test.checked_at),
        timestamp: controller.last_test.checked_at,
        ok: controller.last_test.ok,
        kind: controller.last_test.ok ? 'controller' : 'warning',
        sortTime: eventSortTime(controller.last_test.checked_at),
        meta: [`${controller.protocol.toUpperCase()} ${Math.round(controller.last_test.elapsed_ms || 0)} ms`, controller.last_test.detail].filter(Boolean),
      });
    }
  });
  return rows.sort((a, b) => b.sortTime - a.sortTime);
}

function controllerHealthState(controller: WirelessController): boolean | null {
  if (controller.last_live_collection) return Boolean(controller.last_live_collection.ok);
  if (controller.last_test) return Boolean(controller.last_test.ok);
  return null;
}

function buildModelDistribution(devices: Device[]) {
  const colors = ['#55d646', '#3d8cff', '#f6c443', '#f97316', '#8db6d9', '#a855f7'];
  const totals = new Map<string, number>();
  devices.forEach((device) => {
    const model = String(device.model || 'Unknown model').trim() || 'Unknown model';
    totals.set(model, (totals.get(model) || 0) + 1);
  });
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value], index) => ({ label, value, color: colors[index % colors.length] }));
}

function buildWirelessSiteGroups(devices: Device[], infrastructureLocations: InfrastructureLocationRecord[] = []): WirelessSiteGroup[] {
  const totals = new Map<string, WirelessSiteGroup>();
  devices.forEach((device) => {
    const name = wirelessBuildingName(device, infrastructureLocations);
    const row = totals.get(name) || { name, aps: 0, clients: 0, devices: [] };
    row.aps += 1;
    row.clients += clientCount(device);
    row.devices.push(device);
    totals.set(name, row);
  });
  return [...totals.values()].sort((a, b) => b.aps - a.aps || a.name.localeCompare(b.name));
}

function wirelessBuildingName(device: Device, infrastructureLocations: InfrastructureLocationRecord[] = []) {
  const controllerName = String(device.controller_name || '').trim();
  const configuredSite = siteName(device);
  const manualLocation = matchInfrastructureLocation(device, infrastructureLocations);
  if (manualLocation) return manualLocation;
  if (usefulBuildingText(configuredSite) && configuredSite !== controllerName) return normalizeBuildingLabel(configuredSite);

  const candidates = [device.location, apDisplayName(device), device.hostname, device.description]
    .map((value) => String(value || '').trim())
    .filter((value) => usefulBuildingText(value) && value !== controllerName);

  for (const candidate of candidates) {
    const label = parseBuildingLabel(candidate);
    if (label) return label;
  }
  return 'Unassigned';
}

function matchInfrastructureLocation(device: Device, locations: InfrastructureLocationRecord[]) {
  if (!locations.length) return '';
  const controllerName = String(device.controller_name || '').trim();
  const configuredSite = siteName(device);
  const candidates = [device.location, siteName(device), apDisplayName(device), device.hostname, device.description]
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter((value) => usefulBuildingText(value) && value !== controllerName);
  const activeLocations = locations
    .map((location) => ({ ...location, name: String(location.name || '').replace(/\s+/g, ' ').trim() }))
    .filter((location) => usefulBuildingText(location.name) && String(location.status || 'Active').toLowerCase() !== 'offline')
    .sort((a, b) => b.name.length - a.name.length);
  for (const location of activeLocations) {
    const locationName = location.name.toLowerCase();
    if (location.site && configuredSiteMismatch(location.site, configuredSite, controllerName)) continue;
    if (candidates.some((candidate) => {
      const text = candidate.toLowerCase();
      const parsed = parseBuildingLabel(candidate).toLowerCase();
      return text === locationName || text.includes(locationName) || locationName.includes(text) || parsed === locationName || locationName.includes(parsed);
    })) {
      return location.name;
    }
  }
  return '';
}

function configuredSiteMismatch(locationSite: string, deviceSite: string, controllerName: string) {
  const expected = locationSite.trim().toLowerCase();
  const actual = String(deviceSite || '').trim().toLowerCase();
  if (!expected || !actual || actual === controllerName.trim().toLowerCase()) return false;
  return expected !== actual;
}

function usefulBuildingText(value: unknown) {
  const text = String(value || '').trim();
  return Boolean(text && text !== '-' && text.toLowerCase() !== 'unnamed ap' && !isMacAddressText(text) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(text));
}

function parseBuildingLabel(value: string) {
  const text = value.replace(/\s+/g, ' ').trim();
  const spacedParts = text.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (spacedParts.length > 1) {
    const usefulPart = spacedParts.find((part) => /[a-z]/i.test(part) && !/^[a-z]$/i.test(part) && !isMacAddressText(part));
    if (usefulPart) return normalizeBuildingLabel(usefulPart);
  }

  const known = [
    'Ogrenci Mrk',
    'Rektorluk',
    'HAZIRLIK',
    'Gocmenkoy',
    'MD_Ofisler',
    'KIRLI-LAB',
    'Dentistry',
    'Kitchen',
    'ARENA',
    'LEMAR',
    'Soli',
    'BIM',
    'OHB',
    'EH',
    'ST',
    'CU',
    'GE',
    'EC',
  ];
  const lower = text.toLowerCase();
  const knownMatch = known.find((item) => lower.startsWith(item.toLowerCase()));
  if (knownMatch) return knownMatch;

  const hyphenParts = text.split('-').map((part) => part.trim()).filter(Boolean);
  if (hyphenParts.length > 1 && /[a-z]/i.test(hyphenParts[0])) {
    if (hyphenParts[0].length <= 2 && hyphenParts[1] && /[a-z]/i.test(hyphenParts[1])) {
      return normalizeBuildingLabel(`${hyphenParts[0]}-${hyphenParts[1]}`);
    }
    return normalizeBuildingLabel(hyphenParts[0]);
  }
  return normalizeBuildingLabel(text);
}

function normalizeBuildingLabel(value: string) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 28 ? `${text.slice(0, 25)}...` : text;
}

function severityWeight(value: WirelessAlertRow['severity']) {
  return value === 'critical' ? 3 : value === 'major' ? 2 : 1;
}

function wirelessAlertMeta(device: Device) {
  const status = String(device.status || '').toLowerCase();
  const statusIsPresenceIssue = status.includes('not connected') || status.includes('unknown') || status.includes('down') || status.includes('disconnect');
  return [
    device.management_ip ? `IP ${device.management_ip}` : '',
    device.mac_address ? `MAC ${device.mac_address}` : '',
    device.controller_name ? `Controller ${device.controller_name}` : '',
    device.status != null ? `Status ${device.status}` : '',
    `Clients ${formatNumber(clientCount(device))}`,
    `CPU ${formatNumber(numeric(device.cpu_util))}%`,
    `Mem ${formatNumber(numeric(device.memory_util))}%`,
    statusIsPresenceIssue && device.offline_since_at ? `Offline since ${relativeAgeLabel(device.offline_since_at)}` : '',
    statusIsPresenceIssue && device.last_connected_at ? `Last online ${relativeAgeLabel(device.last_connected_at)}` : '',
    device.last_seen_at ? `${statusIsPresenceIssue ? 'Sampled' : 'Seen'} ${relativeAgeLabel(device.last_seen_at)}` : '',
  ].filter(Boolean);
}

function wirelessAlertAge(device: Device) {
  const status = String(device.status || '').toLowerCase();
  if (status.includes('not connected') || status.includes('unknown')) {
    if (device.offline_since_at) return `offline ${relativeAgeLabel(device.offline_since_at)}`;
    if (device.last_connected_at) return `last online ${relativeAgeLabel(device.last_connected_at)}`;
    return 'reported';
  }
  return device.last_seen_at ? relativeAgeLabel(device.last_seen_at) : '-';
}

function eventSortTime(value: string) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function wirelessLiveState(updatedAt: string | null, refreshStatus: WirelessRefreshStatus | null) {
  const sampleTime = updatedAt ? Date.parse(updatedAt) : NaN;
  const ageSeconds = Number.isFinite(sampleTime) ? Math.max(0, Math.round((Date.now() - sampleTime) / 1000)) : null;
  const refreshAge = refreshStatus?.refreshed_at ? relativeAgeLabel(refreshStatus.refreshed_at) : '';
  if (ageSeconds !== null && ageSeconds <= 20) {
    return {
      tone: 'live',
      label: `Live ${ageSeconds < 60 ? `${ageSeconds}s` : relativeAgeLabel(updatedAt || '')}`,
      detail: `Live controller snapshots are updating every 4 seconds. Latest AP sample ${relativeAgeLabel(updatedAt || '')}; ${formatNumber(refreshStatus?.collected_ap_records || 0)} AP records collected in the last refresh.`,
    };
  }
  if (refreshStatus?.attempted && refreshStatus.failed === 0) {
    return {
      tone: 'refreshing',
      label: refreshAge ? `Refreshing ${refreshAge}` : 'Refreshing',
      detail: `Controller refresh is running, but no newer AP sample is stored yet. Last refresh ${refreshAge || 'just now'}; ${formatNumber(refreshStatus.refreshed)} controller(s) responded.`,
    };
  }
  if (refreshStatus?.failed) {
    const firstError = refreshStatus.errors?.[0]?.detail || 'Check the controller connection and credentials.';
    return {
      tone: 'warn',
      label: 'Refresh issue',
      detail: `Live refresh failed for ${formatNumber(refreshStatus.failed)} controller(s). ${firstError}`,
    };
  }
  if (ageSeconds !== null) {
    return {
      tone: ageSeconds <= 120 ? 'delayed' : 'stale',
      label: ageSeconds <= 120 ? `Delayed ${relativeAgeLabel(updatedAt || '')}` : `Stale ${relativeAgeLabel(updatedAt || '')}`,
      detail: `Dashboard is showing the latest stored controller sample from ${relativeAgeLabel(updatedAt || '')}. No newer live sample has been collected yet.`,
    };
  }
  return {
    tone: 'stale',
    label: 'No live sample',
    detail: 'No live wireless controller sample has been stored yet. Run a controller scan or check the controller integration.',
  };
}

function heatColor(value: number) {
  if (value >= 80) return '#ef4444';
  if (value >= 60) return '#f97316';
  if (value >= 35) return '#f6c443';
  if (value > 0) return '#55d646';
  return '#243b54';
}

function preferredBand(device: Device) {
  const channel = Number(device.channel || 0);
  if (channel > 0 && channel <= 14) return '2.4 GHz';
  if (channel >= 1) return '5 GHz';
  return numeric(device.radios) > 1 ? '5 GHz' : '-';
}

function relativeAgeLabel(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatExactTimestamp(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleString();
}

function collectorConfigured(name: string, controllers: WirelessController[]) {
  const target = normalizeVendor(name);
  return controllers.some((controller) => {
    const vendor = normalizeVendor(vendorLabel(controller.vendor));
    return vendor.includes(target) || target.includes(vendor);
  });
}

function normalizeVendor(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildSsidRows(devices: Device[]): { name: string; vlan: string; security: string; broadcast: string }[] {
  const rows = new Map<string, { name: string; vlan: string; security: string; broadcast: string }>();
  devices.forEach((device) => {
    const name = String(device.ssid || device.wlan || '').trim();
    if (!name) return;
    const vlan = fieldValue(device.vlan);
    const security = fieldValue(device.security_mode);
    const broadcast = fieldValue(device.broadcast_state, 'Broadcast unknown');
    const key = `${name}:${vlan}:${security}:${broadcast}`;
    rows.set(key, { name, vlan, security, broadcast });
  });
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function hasRadioData(device: Device) {
  return Boolean(
    numeric(device.radios)
    || device.channel
    || device.channel_width
    || device.tx_power
    || device.utilization
    || device.noise
  );
}

function fieldValue(value: unknown, fallback = '-') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function numeric(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function sum(items: Device[], getter: (device: Device) => number) {
  return items.reduce((total, item) => total + getter(item), 0);
}

function sumNumbers(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function clientCount(device: Device) {
  return numeric(device.clients || device.controller_clients);
}

function totalTrafficRate(device: Device) {
  return numeric(device.traffic_rx_rate) + numeric(device.traffic_tx_rate);
}

function totalTrafficBytes(device: Device) {
  const lanBytes = numeric(device.traffic_rx_bytes) + numeric(device.traffic_tx_bytes);
  const clientBytes = (numeric(device.client_rx_kbytes) + numeric(device.client_tx_kbytes)) * 1024;
  return lanBytes || clientBytes;
}

function sortApsByClients(devices: Device[]) {
  return [...devices].sort((a, b) => (
    clientCount(b) - clientCount(a)
    || totalTrafficRate(b) - totalTrafficRate(a)
    || apDisplayName(a).localeCompare(apDisplayName(b))
  ));
}

function repairScanResultApNames(scanRows: Device[], liveRows: Device[]) {
  const liveLookup = buildApNameLookup(liveRows);
  if (!liveLookup.size) return scanRows;
  return scanRows.map((device) => {
    const live = apLookupKeys(device).map((key) => liveLookup.get(key)).find(Boolean);
    if (!live) return device;
    const liveName = apDisplayName(live);
    if (!liveName || liveName === 'Unnamed AP') return device;
    const currentName = apDisplayName(device);
    if (currentName !== 'Unnamed AP' && currentName === liveName) return device;
    return {
      ...device,
      name: liveName,
      ap_name: liveName,
      hostname: liveName,
      description: usefulText(device.description) ? device.description : live.description,
      location: usefulText(device.location) ? device.location : live.location,
    };
  });
}

function buildApNameLookup(devices: Device[]) {
  const lookup = new Map<string, Device>();
  devices.forEach((device) => {
    if (apDisplayName(device) === 'Unnamed AP') return;
    apLookupKeys(device).forEach((key) => {
      if (!lookup.has(key)) lookup.set(key, device);
    });
  });
  return lookup;
}

function apLookupKeys(device: Device) {
  const values = [
    device.mac_address,
    normalizeMacText(device.mac_address),
    device.management_ip,
    device.serial_number,
    device.zd_config_index,
    device.zd_ap_index,
  ];
  return [...new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
}

function apRowKey(device: Device) {
  return [
    device.id,
    device.management_ip,
    normalizeMacText(device.mac_address),
    device.mac_address,
    device.serial_number,
    device.zd_config_index,
    device.zd_ap_index,
    apDisplayName(device),
  ].map((value) => String(value || '').trim()).find(Boolean) || 'wireless-ap';
}

function apLocationValue(device: Device) {
  return String(device.location || '').trim() || siteName(device) || 'Unassigned';
}

function siteIdFromName(sites: Site[], name: string) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return '';
  return String(sites.find((site) => site.name.trim().toLowerCase() === normalized)?.id || '');
}

function siteOptionValueForName(sites: Site[], name: string) {
  const trimmed = name.trim();
  if (!trimmed) return '';
  return siteIdFromName(sites, trimmed) || `${NAMED_SITE_PREFIX}${encodeURIComponent(trimmed)}`;
}

function siteNameFromApSiteValue(value: string, sites: Site[]) {
  if (!value) return '';
  if (value.startsWith(NAMED_SITE_PREFIX)) {
    try {
      return decodeURIComponent(value.slice(NAMED_SITE_PREFIX.length));
    } catch {
      return value.slice(NAMED_SITE_PREFIX.length);
    }
  }
  return sites.find((site) => String(site.id) === value)?.name || '';
}

function buildApSiteOptions(sites: Site[], infrastructureSites: InfrastructureSiteRecord[], infrastructureLocations: InfrastructureLocationRecord[]) {
  const byName = new Map<string, { value: string; label: string }>();
  const add = (name: string, label?: string) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (byName.has(key)) return;
    byName.set(key, { value: siteOptionValueForName(sites, trimmed), label: label || trimmed });
  };

  sites.forEach((site) => add(site.name));
  infrastructureSites
    .filter((site) => String(site.status || 'Active').toLowerCase() !== 'offline')
    .forEach((site) => add(site.name));
  infrastructureLocations
    .filter((location) => String(location.status || 'Active').toLowerCase() !== 'offline')
    .forEach((location) => add(String(location.site || '')));

  return [...byName.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function apSiteValueForDevice(device: Device, sites: Site[], fallbackSiteName = '') {
  if (device.site_id) return String(device.site_id);
  const name = siteName(device) || fallbackSiteName;
  return siteOptionValueForName(sites, name);
}

function siteForInfrastructureLocation(locationName: string, locations: InfrastructureLocationRecord[]) {
  const normalized = String(locationName || '').trim().toLowerCase();
  if (!normalized) return '';
  return String(locations.find((location) => location.name.trim().toLowerCase() === normalized)?.site || '').trim();
}

async function ensureSharedInfrastructureLocation(auth: string, locationName: string, siteNameValue: string): Promise<InfrastructureLocationRecord[] | 'unauthorized'> {
  const name = locationName.trim();
  if (!name) return mergeInfrastructureLocations([], loadInfrastructureLocations());
  const loaded = await loadInfrastructureLocationsApi(auth);
  if (loaded === 'unauthorized') return 'unauthorized';
  const current = mergeInfrastructureLocations(loaded, loadInfrastructureLocations());
  const existing = current.find((location) => location.name.trim().toLowerCase() === name.toLowerCase());
  const next = existing
    ? current.map((location) => location.name.trim().toLowerCase() === name.toLowerCase()
      ? { ...location, site: location.site || siteNameValue.trim(), status: location.status || 'Active' }
      : location)
    : [{
      id: `locations-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      site: siteNameValue.trim(),
      status: 'Active',
      source: 'wireless',
      role: 'Wireless location',
      lastUpdated: new Date().toISOString(),
    } as InfrastructureLocationRecord, ...current];
  localStorage.setItem('aims-infrastructure-Locations', JSON.stringify(next));
  window.dispatchEvent(new Event('aims:infrastructure-locations-changed'));
  const saved = await saveInfrastructureLocationsApi(auth, next);
  if (saved === 'unauthorized') return 'unauthorized';
  return next;
}

async function resolveApSiteId(auth: string, value: string, currentSites: Site[], updateSites: (sites: Site[]) => void): Promise<number | null | 'unauthorized'> {
  if (!value) return null;
  if (!value.startsWith(NAMED_SITE_PREFIX)) {
    const siteId = Number(value);
    return Number.isFinite(siteId) && siteId > 0 ? siteId : null;
  }

  const siteNameValue = siteNameFromApSiteValue(value, currentSites).trim();
  if (!siteNameValue) return null;
  const existing = currentSites.find((site) => site.name.trim().toLowerCase() === siteNameValue.toLowerCase());
  if (existing) return existing.id;

  try {
    const created = await createSite(auth, siteNameValue);
    if (created === 'unauthorized') return 'unauthorized';
    updateSites([...currentSites, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created.id;
  } catch (error) {
    const detail = error instanceof Error ? error.message.toLowerCase() : '';
    if (!detail.includes('exists')) throw error;
    const refreshed = await loadSites(auth);
    if (refreshed === 'unauthorized') return 'unauthorized';
    updateSites(refreshed);
    return refreshed.find((site) => site.name.trim().toLowerCase() === siteNameValue.toLowerCase())?.id || null;
  }
}

function sortWirelessAps(rows: Device[], field: WirelessApSortField, direction: SortDirection) {
  return [...rows].sort((a, b) => compareSortValues(wirelessApSortValue(a, field), wirelessApSortValue(b, field), direction));
}

function wirelessApSortValue(device: Device, field: WirelessApSortField) {
  if (field === 'device') return apDisplayName(device);
  if (field === 'role') return device.role || device.device_type || '';
  if (field === 'management') return device.management_ip || device.mac_address || '';
  if (field === 'site') return siteName(device) || '';
  if (field === 'location') return apLocationValue(device);
  if (field === 'platform') return [device.platform, device.device_type, device.manufacturer, device.model].filter(Boolean).join(' ');
  if (field === 'users') return clientCount(device);
  if (field === 'traffic') return totalTrafficRate(device);
  if (field === 'health') return wirelessHealthSortWeight(device);
  if (field === 'status') return device.status || '';
  if (field === 'collection') return device.snmp_status || '';
  if (field === 'last_seen') return Date.parse(String(device.last_seen_at || '')) || 0;
  return '';
}

function wirelessHealthSortWeight(device: Device) {
  const label = healthLabel(device).toLowerCase();
  if (label.includes('critical')) return 3;
  if (label.includes('warning')) return 2;
  if (label.includes('healthy') || label.includes('online')) return 1;
  return 0;
}

function compareSortValues(a: unknown, b: unknown, direction: SortDirection) {
  const multiplier = direction === 'asc' ? 1 : -1;
  if (typeof a === 'number' || typeof b === 'number') return ((Number(a) || 0) - (Number(b) || 0)) * multiplier;
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' }) * multiplier;
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

function apSecondaryIdentity(device: Device) {
  const display = apDisplayName(device);
  const candidates = [
    device.hostname,
    device.controller_name,
    device.management_ip,
    device.mac_address,
    device.model,
  ];
  return candidates.map((item) => String(item || '').trim()).find((item) => (
    item
    && item !== display
    && item.toLowerCase() !== 'unnamed ap'
    && !/^ap \d{6,}$/i.test(item)
  )) || 'No secondary identity';
}

function apDisplayName(device: Device) {
  const candidates = [
    device.ap_name,
    device.name,
    device.hostname,
    device.description,
    device.location,
  ];
  const ip = String(device.management_ip || '').trim();
  const serial = String(device.serial_number || '').trim();
  const model = String(device.model || '').trim();
  const value = candidates.map((item) => String(item || '').trim()).find((item) => (
    item
    && item.toLowerCase() !== 'unnamed ap'
    && !isMacAddressText(item)
    && item !== ip
    && item !== `AP ${ip}`
    && !(serial && item === `AP ${serial}`)
    && !/^ruckus ap \d+$/i.test(item)
    && !/^ap \d{6,}$/i.test(item)
    && !(model && (item === `${model} AP` || new RegExp(`^${escapeRegExp(model)} AP \\d+$`).test(item)))
  ));
  return value || 'Unnamed AP';
}

function usefulText(value: unknown) {
  const text = String(value || '').trim();
  return Boolean(text && text !== '-' && text.toLowerCase() !== 'unnamed ap' && !isMacAddressText(text));
}

function normalizeMacText(value: unknown) {
  const compact = String(value || '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (!/^[0-9a-f]{12}$/.test(compact)) return '';
  return compact.replace(/(..)(?=.)/g, '$1:');
}

function isMacAddressText(value: string) {
  return /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(value.trim());
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isHealthyAp(device: Device) {
  return apHealthBucket(device) === 'online';
}

function needsAttention(device: Device) {
  return apHealthBucket(device) !== 'online';
}

function countApHealth(devices: Device[]) {
  return devices.reduce((totals, device) => {
    totals.total += 1;
    const bucket = apHealthBucket(device);
    totals[bucket] += 1;
    return totals;
  }, { total: 0, online: 0, warning: 0, critical: 0 });
}

function apHealthBucket(device: Device): 'online' | 'warning' | 'critical' {
  const status = String(device.status || '').toLowerCase();
  const cpu = numeric(device.cpu_util);
  const memory = numeric(device.memory_util);
  if (status.includes('down') || status.includes('disconnect') || cpu >= 95 || memory >= 95) return 'critical';
  if (status.includes('not connected') || status.includes('unknown')) return 'warning';
  if (status.includes('pending') || status.includes('provision') || status.includes('upgrade') || status.includes('reboot') || cpu >= 85 || memory >= 90) return 'warning';
  if (isKnownHealthyApStatus(status)) return 'online';
  return status ? 'warning' : 'online';
}

function isKnownHealthyApStatus(status: string) {
  if (status.includes('not connected')) return false;
  return ['connected', 'active', 'approved', 'discovered', 'up', 'online'].some((term) => status.includes(term));
}

function isUnknownApStatus(device: Device) {
  const status = String(device.status || '').toLowerCase();
  return Boolean(status && !isKnownHealthyApStatus(status) && !status.includes('down') && !status.includes('disconnect') && !status.includes('pending') && !status.includes('provision') && !status.includes('upgrade') && !status.includes('reboot'));
}

function healthLabel(device: Device) {
  const bucket = apHealthBucket(device);
  if (bucket === 'critical') return 'Critical';
  if (bucket === 'warning') return 'Warning';
  if (numeric(device.cpu_util) || numeric(device.memory_util)) return 'Healthy';
  return 'Unknown';
}

function healthDetail(device: Device) {
  const parts = [];
  if (isUnknownApStatus(device)) parts.push(`Controller status ${device.status}`);
  if (numeric(device.cpu_util)) parts.push(`CPU ${numeric(device.cpu_util)}%`);
  if (numeric(device.memory_util)) parts.push(`Mem ${numeric(device.memory_util)}%`);
  if (numeric(device.dropped_packets)) parts.push(`${formatNumber(numeric(device.dropped_packets))} drops`);
  if (numeric(device.lan_rx_errors)) parts.push(`${formatNumber(numeric(device.lan_rx_errors))} errors`);
  return parts.join(' | ') || String(device.mesh_type || '-');
}

function attentionReason(device: Device) {
  const reasons = [];
  const status = String(device.status || '');
  if (isUnknownApStatus(device)) reasons.push(`Controller reported status ${status}`);
  else if (status) reasons.push(status);
  if (numeric(device.cpu_util) >= 85) reasons.push(`CPU ${numeric(device.cpu_util)}%`);
  if (numeric(device.memory_util) >= 90) reasons.push(`Memory ${numeric(device.memory_util)}%`);
  if (numeric(device.dropped_packets)) reasons.push(`${formatNumber(numeric(device.dropped_packets))} drops`);
  if (numeric(device.lan_rx_errors)) reasons.push(`${formatNumber(numeric(device.lan_rx_errors))} errors`);
  return reasons.length ? reasons.join(' | ') : 'Review AP details';
}

function formatNumber(value: number) {
  return Math.round(value || 0).toLocaleString();
}

function formatBytes(value: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Math.max(0, value || 0);
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

function formatRate(value: number) {
  return `${formatBytes(value)}/s`;
}

function siteName(device: Device) {
  if (!device.site) return '';
  return typeof device.site === 'string' ? device.site : device.site.name;
}

function loadInfrastructureSites(): InfrastructureSiteRecord[] {
  try {
    const rows = JSON.parse(localStorage.getItem('aims-infrastructure-Sites') || '[]');
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => ({
        name: String(row?.name || '').trim(),
        status: String(row?.status || '').trim(),
      }))
      .filter((row) => row.name);
  } catch {
    return [];
  }
}

function loadInfrastructureLocations(): InfrastructureLocationRecord[] {
  try {
    const rows = JSON.parse(localStorage.getItem('aims-infrastructure-Locations') || '[]');
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => ({
        name: String(row?.name || '').trim(),
        site: String(row?.site || '').trim(),
        status: String(row?.status || '').trim(),
        source: 'local',
      }))
      .filter((row) => row.name);
  } catch {
    return [];
  }
}

function mergeInfrastructureLocations(primary: InfrastructureLocationRecord[], fallback: InfrastructureLocationRecord[]) {
  const byKey = new Map<string, InfrastructureLocationRecord>();
  [...fallback, ...primary].forEach((location) => {
    const key = `${location.site || ''}|${location.name}`.trim().toLowerCase();
    if (!key) return;
    byKey.set(key, location);
  });
  return [...byKey.values()].sort((a, b) => [a.site, a.name].join(' ').localeCompare([b.site, b.name].join(' ')));
}
