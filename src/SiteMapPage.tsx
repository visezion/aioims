import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { Activity, Building2, Cable, ChevronRight, CircleAlert, GitBranch, Layers, MapPin, Maximize2, Network, RefreshCw, Search, Server, ShieldCheck, Wifi } from 'lucide-react';
import './site-map.css';

const api = `${window.location.protocol}//${window.location.hostname}:8001/api/v1`;

type SiteRecord = {
  id?: number | string;
  name: string;
  location?: string | null;
  latitude?: string | null;
  longitude?: string | null;
};
type DeviceInterface = {
  name?: string | null;
  ip?: string | null;
  ip_addresses?: string[] | null;
  connection?: string | null;
  connection_device_id?: number | null;
  connection_device_name?: string | null;
};
type DeviceRecord = {
  id: number;
  name: string;
  hostname?: string | null;
  management_ip?: string | null;
  role?: string | null;
  status?: string | null;
  device_type?: string | null;
  platform?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  site?: { name: string } | null;
  location?: string | null;
  rack?: string | null;
  interfaces?: DeviceInterface[] | null;
};
type LocationRecord = {
  id?: string;
  name?: string;
  site?: string;
  location?: string;
  room?: string;
  status?: string;
};
type TopologyNode = {
  id: string;
  name: string;
  ip?: string | null;
  status?: string | null;
  role?: string | null;
  site?: string | null;
  managed?: boolean;
};
type TopologyLink = {
  id: number;
  source?: string | null;
  target?: string | null;
  local_device_id?: number | null;
  remote_device_id?: number | null;
  local_device_name?: string | null;
  local_ip?: string | null;
  remote_device_name?: string | null;
  remote_ip?: string | null;
  local_interface?: string | null;
  remote_interface?: string | null;
  protocol?: string | null;
  last_seen_at?: string | null;
};
type RealTopologyLink = TopologyLink & {
  localDevice: DeviceRecord;
  remoteDevice: DeviceRecord;
};
type TopologyData = {
  nodes: TopologyNode[];
  links: TopologyLink[];
  summary?: { devices?: number; nodes?: number; links?: number };
};
type DevicePageResponse = {
  data?: {
    data?: DeviceRecord[];
    meta?: {
      page?: number;
      per_page?: number;
      total?: number;
      pages?: number;
    };
  };
};
type SiteMapState = {
  sites: SiteRecord[];
  devices: DeviceRecord[];
  locations: LocationRecord[];
  topology: TopologyData;
};
type SiteView = SiteRecord & {
  key: string;
  deviceCount: number;
  onlineCount: number;
  downCount: number;
  warningCount: number;
  linkCount: number;
  locationCount: number;
  rackCount: number;
  x: number;
  y: number;
  health: number;
};
type DeviceLayout = {
  device: DeviceRecord;
  x: number;
  y: number;
  kind: 'core' | 'distribution' | 'access' | 'endpoint';
  icon: 'network' | 'layers' | 'server';
  external?: boolean;
};

function isDown(status?: string | null) {
  return /down|offline|failed|unreachable|critical/i.test(status || '');
}

function isWarning(status?: string | null) {
  return /warning|maintenance|degraded|staging|planned/i.test(status || '');
}

function isInternetEdgeRole(role?: string | null) {
  return /\b(core\s*(sw|switch)?|backbone)\b/i.test(role || '');
}

function isDistributionRole(role?: string | null) {
  return /\b(distribution|dist\s*(sw|switch)?|aggregation)\b/i.test(role || '');
}

function isAccessSwitchRole(role?: string | null) {
  return /\baccess\s*(sw|switch)?\b/i.test(role || '');
}

function isSwitchLikeDevice(device: DeviceRecord) {
  const text = [
    device.role,
    device.device_type,
    device.platform,
    device.manufacturer,
    device.model,
    device.name,
    device.hostname,
  ].filter(Boolean).join(' ');
  return /\b(switch|sw|catalyst|nexus|procurve|aruba|comware|cisco\s*c\d+|c9[2356]00|c92\d{2}|c93\d{2}|c95\d{2}|hpe\s*19\d{2}|2960|3560|3650|3750|3850|9200|9300|9500)\b/i.test(text);
}

function deviceRoleGroup(device: DeviceRecord): DeviceLayout['kind'] {
  if (isInternetEdgeRole(device.role)) return 'core';
  if (isDistributionRole(device.role)) return 'distribution';
  if (isAccessSwitchRole(device.role)) return 'access';
  return 'endpoint';
}

function deviceRoleY(kind: DeviceLayout['kind']) {
  if (kind === 'core') return 145;
  if (kind === 'distribution') return 255;
  if (kind === 'access') return 375;
  return 520;
}

function deviceRoleIcon(kind: DeviceLayout['kind']): DeviceLayout['icon'] {
  if (kind === 'core') return 'network';
  if (kind === 'distribution') return 'layers';
  return 'server';
}

function deviceLocationKey(device: DeviceRecord) {
  return (device.location || 'Unassigned location').trim() || 'Unassigned location';
}

function shortLabel(value?: string | null, max = 18) {
  const text = (value || 'Unnamed').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function spreadX(count: number, min: number, max: number) {
  if (count <= 1) return [(min + max) / 2];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => min + index * step);
}

function healthLabel(site: SiteView) {
  if (site.downCount > 0) return 'Critical';
  if (site.warningCount > 0) return 'Warning';
  if (!site.deviceCount) return 'Empty';
  return 'Healthy';
}

function siteKey(name?: string | null) {
  return (name || 'Unassigned').trim().toLowerCase();
}

function topologyNodeLocationKey(node: TopologyNode | undefined, devices: DeviceRecord[]) {
  if (!node) return '';
  const nodeId = String(node.id || '').trim().toLowerCase();
  const nodeName = String(node.name || '').trim().toLowerCase();
  const nodeIp = String(node.ip || '').trim().toLowerCase();
  const match = devices.find((device) => (
    String(device.id || '').trim().toLowerCase() === nodeId
    || String(device.name || '').trim().toLowerCase() === nodeName
    || String(device.hostname || '').trim().toLowerCase() === nodeName
    || String(device.management_ip || '').trim().toLowerCase() === nodeIp
  ));
  return match ? siteKey(deviceLocationKey(match)) : '';
}

function deviceIdentityValues(device: DeviceRecord) {
  return [
    device.id,
    device.name,
    device.hostname,
    device.management_ip,
    ...(device.interfaces || []).flatMap((item) => [item.ip, ...(item.ip_addresses || [])]),
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
}

function normalizeIp(value?: string | null) {
  return String(value || '').split('/')[0].trim().toLowerCase();
}

function resolveInterfaceTarget(device: DeviceRecord, item: DeviceInterface, devices: DeviceRecord[]) {
  if (item.connection_device_id) {
    const byId = devices.find((candidate) => Number(candidate.id) === Number(item.connection_device_id));
    if (byId && byId.id !== device.id) return byId;
  }
  const candidates = [
    item.connection_device_name,
    item.connection,
    item.ip,
    ...(item.ip_addresses || []),
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  if (!candidates.length) return null;
  return devices.find((candidate) => candidate.id !== device.id && deviceIdentityValues(candidate).some((identity) => (
    candidates.includes(identity)
    || candidates.some((candidateText) => (
      (identity.length >= 4 && candidateText.length >= 4 && (candidateText.includes(identity) || identity.includes(candidateText)))
      || normalizeIp(candidateText) === normalizeIp(identity)
    ))
  ))) || null;
}

function resolveLinkedDevice(link: TopologyLink, side: 'local' | 'remote', devices: DeviceRecord[]) {
  const id = side === 'local' ? link.local_device_id : link.remote_device_id;
  if (id) {
    const byId = devices.find((device) => Number(device.id) === Number(id));
    if (byId) return byId;
  }
  const candidates = [
    side === 'local' ? link.local_device_name : link.remote_device_name,
    side === 'local' ? link.local_ip : link.remote_ip,
    side === 'local' ? link.source : link.target,
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
  return devices.find((device) => deviceIdentityValues(device).some((value) => candidates.includes(value))) || null;
}

function realTopologyLinks(links: TopologyLink[], devices: DeviceRecord[]): RealTopologyLink[] {
  const rows = [
    ...links,
    ...interfaceRelationshipLinks(devices),
  ]
    .map((link) => {
      const localDevice = resolveLinkedDevice(link, 'local', devices);
      const remoteDevice = resolveLinkedDevice(link, 'remote', devices);
      if (!localDevice || !remoteDevice || localDevice.id === remoteDevice.id) return null;
      return { ...link, localDevice, remoteDevice };
    })
    .filter(Boolean) as RealTopologyLink[];
  const seen = new Set<string>();
  return rows.filter((link) => {
    const endpoints = [
      `${link.localDevice.id}:${String(link.local_interface || '').trim().toLowerCase()}`,
      `${link.remoteDevice.id}:${String(link.remote_interface || '').trim().toLowerCase()}`,
    ].sort();
    const key = endpoints.join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function interfaceRelationshipLinks(devices: DeviceRecord[]): TopologyLink[] {
  const links: TopologyLink[] = [];
  devices.forEach((device) => {
    (device.interfaces || []).forEach((item, index) => {
      const remote = resolveInterfaceTarget(device, item, devices);
      if (!remote) return;
      links.push({
        id: -Number(`${device.id}${index + 1}`),
        local_device_id: device.id,
        remote_device_id: remote.id,
        local_device_name: device.name,
        remote_device_name: remote.name,
        local_ip: device.management_ip,
        remote_ip: remote.management_ip,
        local_interface: item.name || '',
        remote_interface: item.connection || item.connection_device_name || remote.name,
        protocol: 'interface',
      });
    });
  });
  return links;
}

function parseCoordinate(value?: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function generatedPosition(index: number, total: number) {
  if (total <= 1) return { x: 570, y: 310 };
  const angle = (-90 + (360 / total) * index) * (Math.PI / 180);
  return {
    x: 570 + Math.cos(angle) * 285,
    y: 330 + Math.sin(angle) * 190,
  };
}

function geoPosition(site: SiteRecord, index: number, total: number) {
  const lat = parseCoordinate(site.latitude);
  const lon = parseCoordinate(site.longitude);
  if (lat === null || lon === null) return generatedPosition(index, total);
  return {
    x: 110 + ((lon + 180) / 360) * 920,
    y: 95 + ((90 - lat) / 180) * 460,
  };
}

function normalizeList<T>(json: unknown): T[] {
  const data = (json as { data?: unknown })?.data;
  if (Array.isArray(data)) return data as T[];
  const nested = data as { data?: unknown; records?: unknown } | undefined;
  if (Array.isArray(nested?.data)) return nested.data as T[];
  if (Array.isArray(nested?.records)) return nested.records as T[];
  return [];
}

function normalizeTopology(json: unknown): TopologyData {
  const data = ((json as { data?: unknown })?.data || {}) as Partial<TopologyData>;
  return {
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    links: Array.isArray(data.links) ? data.links : [],
    summary: data.summary || {},
  };
}

function errorText(value: unknown, fallback: string): string {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((item) => errorText(item, fallback)).join(' ');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.msg === 'string') return record.msg;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.detail === 'string') return record.detail;
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return String(value);
}

async function ensureToken(force = false) {
  const cached = localStorage.getItem('aims-api-token') || '';
  if (cached && !force) return cached;
  const response = await fetch(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '', password: '' }),
  });
  const json = await response.json();
  if (!response.ok || !json.data?.token) throw new Error(json.message || 'Unable to authenticate.');
  localStorage.setItem('aims-api-token', json.data.token);
  return json.data.token as string;
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${api}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401) throw new Error('Unauthorized');
  const json = await response.json();
  if (!response.ok) throw new Error(errorText(json.detail || json.message, `Unable to load ${path}.`));
  return json as T;
}

async function loadAllDevices(token: string) {
  const first = await apiGet<DevicePageResponse>('/devices?page=1&per_page=100&sort=name&direction=asc', token);
  const records = [...(first.data?.data || [])];
  const pages = Math.max(1, Number(first.data?.meta?.pages || 1));
  if (pages <= 1) return records;
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, index) => apiGet<DevicePageResponse>(`/devices?page=${index + 2}&per_page=100&sort=name&direction=asc`, token)),
  );
  rest.forEach((page) => records.push(...(page.data?.data || [])));
  return records;
}

export function SiteMapPage() {
  const [state, setState] = useState<SiteMapState>({ sites: [], devices: [], locations: [], topology: { nodes: [], links: [] } });
  const [selectedKey, setSelectedKey] = useState('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      let token = await ensureToken();
      let payloads: [unknown, DeviceRecord[], unknown, unknown];
      try {
        payloads = await Promise.all([
          apiGet('/sites', token),
          loadAllDevices(token),
          apiGet('/infrastructure/Locations', token),
          apiGet('/topology', token),
        ]);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'Unauthorized') throw error;
        token = await ensureToken(true);
        payloads = await Promise.all([
          apiGet('/sites', token),
          loadAllDevices(token),
          apiGet('/infrastructure/Locations', token),
          apiGet('/topology', token),
        ]);
      }
      setState({
        sites: normalizeList<SiteRecord>(payloads[0]),
        devices: payloads[1],
        locations: normalizeList<LocationRecord>(payloads[2]),
        topology: normalizeTopology(payloads[3]),
      });
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load site map.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const realLinks = useMemo(() => realTopologyLinks(state.topology.links, state.devices), [state.topology.links, state.devices]);

  const siteViews = useMemo(() => {
    const locationMap = new Map<string, SiteRecord>();
    state.locations.forEach((location) => {
      const name = String(location.name || location.location || '').trim();
      if (name) locationMap.set(siteKey(name), { name, location: location.site || 'Infrastructure location' });
    });
    state.devices.forEach((device) => {
      const name = deviceLocationKey(device);
      if (!locationMap.has(siteKey(name))) locationMap.set(siteKey(name), { name, location: device.site?.name || 'No assigned site' });
    });

    const nodeById = new Map(state.topology.nodes.map((node) => [node.id, node]));
    const linkCountBySite = new Map<string, number>();
    realLinks.forEach((link) => {
      const sourceSite = siteKey(deviceLocationKey(link.localDevice)) || topologyNodeLocationKey(nodeById.get(link.source || ''), state.devices);
      const targetSite = siteKey(deviceLocationKey(link.remoteDevice)) || topologyNodeLocationKey(nodeById.get(link.target || ''), state.devices);
      if (sourceSite) linkCountBySite.set(sourceSite, (linkCountBySite.get(sourceSite) || 0) + 1);
      if (targetSite && targetSite !== sourceSite) linkCountBySite.set(targetSite, (linkCountBySite.get(targetSite) || 0) + 1);
    });

    return Array.from(locationMap.values()).map((site, index, all) => {
      const key = siteKey(site.name);
      const devices = state.devices.filter((device) => siteKey(deviceLocationKey(device)) === key);
      const locations = state.locations.filter((location) => siteKey(location.name || location.location) === key);
      const downCount = devices.filter((device) => isDown(device.status)).length;
      const warningCount = devices.filter((device) => isWarning(device.status)).length;
      const onlineCount = Math.max(0, devices.length - downCount - warningCount);
      const position = geoPosition(site, index, all.length);
      return {
        ...site,
        key,
        deviceCount: devices.length,
        onlineCount,
        downCount,
        warningCount,
        linkCount: linkCountBySite.get(key) || 0,
        locationCount: locations.length,
        rackCount: new Set(devices.map((device) => device.rack).filter(Boolean)).size,
        x: position.x,
        y: position.y,
        health: devices.length ? Math.round((onlineCount / devices.length) * 100) : 0,
      };
    }).sort((a, b) => b.deviceCount - a.deviceCount || a.name.localeCompare(b.name));
  }, [realLinks, state]);

  useEffect(() => {
    if (!selectedKey && siteViews.length) setSelectedKey(siteViews[0].key);
    if (selectedKey && siteViews.length && !siteViews.some((site) => site.key === selectedKey)) setSelectedKey(siteViews[0].key);
  }, [selectedKey, siteViews]);

  const selectedSite = siteViews.find((site) => site.key === selectedKey) || siteViews[0] || null;
  const filteredSites = siteViews.filter((site) => [site.name, site.location, healthLabel(site)].join(' ').toLowerCase().includes(query.toLowerCase()));
  const selectedDevices = selectedSite ? state.devices.filter((device) => siteKey(deviceLocationKey(device)) === selectedSite.key) : [];
  const selectedInternetEdgeDevices = selectedDevices.filter((device) => isInternetEdgeRole(device.role));
  const selectedDistributionDevices = selectedDevices.filter((device) => isDistributionRole(device.role));
  const selectedAccessDevices = selectedDevices.filter((device) => isAccessSwitchRole(device.role));
  const selectedEndpointDevices = selectedDevices.filter((device) => !isInternetEdgeRole(device.role) && !isDistributionRole(device.role) && !isAccessSwitchRole(device.role));
  const selectedNeighborLinks = useMemo(() => {
    if (!selectedSite) return [];
    return realLinks.filter((link) => siteKey(deviceLocationKey(link.localDevice)) === selectedSite.key || siteKey(deviceLocationKey(link.remoteDevice)) === selectedSite.key);
  }, [realLinks, selectedSite]);
  const switchNeighborLinks = useMemo(() => realLinks.filter((link) => (
    isSwitchLikeDevice(link.localDevice) && isSwitchLikeDevice(link.remoteDevice)
  )), [realLinks]);
  const switchTopologyDevices = useMemo(() => {
    const byId = new Map<number, DeviceRecord>();
    switchNeighborLinks.forEach((link) => {
      byId.set(link.localDevice.id, link.localDevice);
      byId.set(link.remoteDevice.id, link.remoteDevice);
    });
    return [...byId.values()];
  }, [switchNeighborLinks]);
  const externalConnectedDevices = useMemo(() => {
    if (!selectedSite) return [];
    const byId = new Map<number, DeviceRecord>();
    selectedNeighborLinks.forEach((link) => {
      const localInSelected = siteKey(deviceLocationKey(link.localDevice)) === selectedSite.key;
      const remoteInSelected = siteKey(deviceLocationKey(link.remoteDevice)) === selectedSite.key;
      if (localInSelected && !remoteInSelected) byId.set(link.remoteDevice.id, link.remoteDevice);
      if (remoteInSelected && !localInSelected) byId.set(link.localDevice.id, link.localDevice);
    });
    return [...byId.values()];
  }, [selectedNeighborLinks, selectedSite]);
  const selectedDeviceLayouts = useMemo(() => {
    const externalIds = new Set(switchTopologyDevices.filter((device) => selectedSite && siteKey(deviceLocationKey(device)) !== selectedSite.key).map((device) => device.id));
    const layoutDevices = switchTopologyDevices.length ? switchTopologyDevices : [...selectedDevices, ...externalConnectedDevices];
    const groups: Record<DeviceLayout['kind'], DeviceRecord[]> = {
      core: layoutDevices.filter((device) => deviceRoleGroup(device) === 'core'),
      distribution: layoutDevices.filter((device) => deviceRoleGroup(device) === 'distribution'),
      access: layoutDevices.filter((device) => deviceRoleGroup(device) === 'access'),
      endpoint: layoutDevices.filter((device) => deviceRoleGroup(device) === 'endpoint'),
    };
    return (Object.entries(groups) as [DeviceLayout['kind'], DeviceRecord[]][])
      .flatMap(([kind, devices]) => {
        const xs = spreadX(devices.length, kind === 'endpoint' ? 140 : 250, kind === 'endpoint' ? 1000 : 890);
        return devices.map((device, index) => ({
          device,
          x: xs[index],
          y: deviceRoleY(kind),
          kind,
          icon: deviceRoleIcon(kind),
          external: externalIds.has(device.id),
        }));
      });
  }, [externalConnectedDevices, selectedDevices, selectedSite, switchTopologyDevices]);
  const selectedLayoutByDeviceId = useMemo(() => new Map(selectedDeviceLayouts.map((layout) => [layout.device.id, layout])), [selectedDeviceLayouts]);
  const networkHealth = state.devices.length ? Math.round((state.devices.filter((device) => !isDown(device.status)).length / state.devices.length) * 100) : 0;
  const downDevices = state.devices.filter((device) => isDown(device.status)).length;
  const totalLinks = realLinks.length;
  const internetEdgeSites = useMemo(() => {
    const sitesWithCoreOrBackbone = new Map<string, { site: SiteView; devices: DeviceRecord[] }>();
    state.devices.forEach((device) => {
      if (!isInternetEdgeRole(device.role)) return;
      const site = siteViews.find((item) => item.key === siteKey(deviceLocationKey(device)));
      if (!site) return;
      const existing = sitesWithCoreOrBackbone.get(site.key) || { site, devices: [] };
      existing.devices.push(device);
      sitesWithCoreOrBackbone.set(site.key, existing);
    });
    return Array.from(sitesWithCoreOrBackbone.values());
  }, [state.devices, siteViews]);
  const interSiteLinks = useMemo(() => {
    const nodeById = new Map(state.topology.nodes.map((node) => [node.id, node]));
    const pairs = new Map<string, { source: SiteView; target: SiteView; count: number }>();
    realLinks.forEach((link) => {
      const source = siteViews.find((site) => site.key === siteKey(deviceLocationKey(link.localDevice)) || site.key === topologyNodeLocationKey(nodeById.get(link.source || ''), state.devices));
      const target = siteViews.find((site) => site.key === siteKey(deviceLocationKey(link.remoteDevice)) || site.key === topologyNodeLocationKey(nodeById.get(link.target || ''), state.devices));
      if (!source || !target || source.key === target.key) return;
      const key = [source.key, target.key].sort().join('|');
      const existing = pairs.get(key);
      if (existing) existing.count += 1;
      else pairs.set(key, { source, target, count: 1 });
    });
    return Array.from(pairs.values());
  }, [realLinks, state.topology.nodes, siteViews, state.devices]);
  const selectedCanvasLinks = useMemo(() => switchNeighborLinks.filter((link) => (
    selectedLayoutByDeviceId.has(link.localDevice.id) && selectedLayoutByDeviceId.has(link.remoteDevice.id)
  )), [selectedLayoutByDeviceId, switchNeighborLinks]);
  const connectedInternetEdgeDevices = useMemo(() => {
    const byId = new Map<number, DeviceRecord>();
    switchNeighborLinks.forEach((link) => {
      [link.localDevice, link.remoteDevice].forEach((device) => {
        if (isInternetEdgeRole(device.role)) byId.set(device.id, device);
      });
    });
    return [...byId.values()];
  }, [switchNeighborLinks]);

  return (
    <div className="content site-map-page">
      <div className="page-title site-map-title">
        <div>
          <p className="site-map-breadcrumb">Monitoring <ChevronRight size={13} /> Location Map</p>
          <h1>Location Map <span className="topology-live-badge"><i /> Real-time</span></h1>
          <p>Visualize location health, device placement, and discovered inter-location connectivity.</p>
        </div>
        <div className="site-map-actions">
          <button className="plain-button" onClick={load} disabled={loading}><RefreshCw size={15} /> {loading ? 'Refreshing' : 'Refresh'}</button>
          <button className="plain-button"><Layers size={15} /> Layers</button>
          <button className="plain-button"><Maximize2 size={15} /> Fit</button>
        </div>
      </div>

      {message && <div className="module-notice site-map-notice"><CircleAlert size={17} />{message}</div>}

      <div className="site-map-summary">
        <div className="sites"><Building2 /><p>Locations</p><b>{siteViews.length}</b><span>{state.locations.length} location records</span></div>
        <div className="devices"><Server /><p>Inventory Devices</p><b>{state.devices.length}</b><span>{downDevices} down or unreachable</span></div>
        <div className="layers"><Layers /><p>Active Location</p><b>{selectedSite?.deviceCount || 0}</b><span>{selectedSite?.name || 'No location selected'}</span></div>
        <div className="links"><GitBranch /><p>Real Links</p><b>{totalLinks}</b><span>{interSiteLinks.length} inter-location paths</span></div>
        <div className="health"><ShieldCheck /><p>Network Health</p><b>{networkHealth}%</b><span>{networkHealth >= 90 ? 'Healthy' : networkHealth >= 70 ? 'Needs review' : 'Critical'}</span></div>
      </div>

      <div className="site-map-workspace">
        <aside className="site-map-rail">
          <div className="site-map-tabs"><button className="active">Locations</button><button>Layers</button></div>
          <label className="site-map-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search locations..." /></label>
          <div className="site-tree">
            {filteredSites.map((site) => (
              <button key={site.key} className={site.key === selectedSite?.key ? 'active' : ''} onClick={() => setSelectedKey(site.key)}>
                <span className={`site-status ${healthLabel(site).toLowerCase()}`} />
                <b>{site.name}</b>
                <small>{site.location || 'No site'} | {site.deviceCount} devices</small>
                <em>{site.linkCount}</em>
              </button>
            ))}
            {!filteredSites.length && <p className="site-map-empty">No matching locations.</p>}
          </div>
        </aside>

        <section className="site-map-canvas-card">
          <div className="site-map-toolbar">
            <label className="site-map-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search map..." /></label>
            <div className="segmented-control"><button className="active">Physical</button><button>Logical</button><button>Hybrid</button></div>
          </div>
          <div className="site-map-canvas-shell">
            <svg className="site-map-canvas" viewBox="0 0 1140 650" role="img" aria-label="Site map">
              <defs>
                <pattern id="site-grid" width="26" height="26" patternUnits="userSpaceOnUse">
                  <path d="M 26 0 L 0 0 0 26" fill="none" stroke="currentColor" strokeWidth=".7" />
                </pattern>
                <radialGradient id="site-node-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="currentColor" stopOpacity=".3" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
                </radialGradient>
                <linearGradient id="neighbor-link-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#38bdf8" />
                  <stop offset="50%" stopColor="#22c55e" />
                  <stop offset="100%" stopColor="#a78bfa" />
                </linearGradient>
                <filter id="neighbor-link-soft-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="0" stdDeviation="2.4" floodColor="#22c55e" floodOpacity=".38" />
                </filter>
                <marker id="neighbor-link-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M1 1 L7 4 L1 7 Z" />
                </marker>
              </defs>
              <rect className="site-map-grid" width="1140" height="650" />
              <text className="site-hierarchy-title" x="44" y="42">Switch connectivity</text>
              <text className="site-hierarchy-subtitle" x="44" y="62">{'Switches are found from Device Inventory and connected by CDP/LLDP, interface relationships, or IP/name matches.'}</text>
              {(['Core / Backbone', 'Distribution', 'Access', 'Other devices'] as const).map((label, index) => (
                <g className="site-role-band" key={label} transform={`translate(44 ${deviceRoleY((['core', 'distribution', 'access', 'endpoint'] as DeviceLayout['kind'][])[index]) - 8})`}>
                  <text>{label}</text>
                  <path d="M128 0h960" />
                </g>
              ))}
              {selectedCanvasLinks.map((link) => {
                const source = selectedLayoutByDeviceId.get(link.localDevice.id);
                const target = selectedLayoutByDeviceId.get(link.remoteDevice.id);
                if (!source || !target) return null;
                const sourceY = source.y + 26;
                const targetY = target.y + 26;
                const sameRow = Math.abs(source.y - target.y) < 12;
                const midY = sameRow ? sourceY - 46 : (sourceY + targetY) / 2;
                const path = sameRow
                  ? `M${source.x} ${sourceY} C${source.x} ${midY} ${target.x} ${midY} ${target.x} ${targetY}`
                  : `M${source.x} ${sourceY} C${source.x} ${midY} ${target.x} ${midY} ${target.x} ${targetY}`;
                return (
                  <g key={`real-link-${link.id}`} className="real-neighbor-link">
                    <path className="neighbor-link-shadow" d={path} />
                    <path className="neighbor-link-line" d={path} markerEnd="url(#neighbor-link-arrow)" />
                    <circle className="neighbor-link-dot source" cx={source.x} cy={sourceY} r="4.5" />
                    <circle className="neighbor-link-dot target" cx={target.x} cy={targetY} r="4.5" />
                  </g>
                );
              })}
              {selectedDeviceLayouts.map((layout) => (
                <g key={`device-layout-${layout.device.id}`} className={`hierarchy-device ${layout.kind} ${layout.external ? 'external' : ''}`} transform={`translate(${layout.x - 64} ${layout.y})`}>
                  <rect width="128" height="52" rx="9" />
                  {layout.icon === 'network' ? <Network size={17} x={11} y={11} /> : layout.icon === 'layers' ? <Layers size={17} x={11} y={11} /> : <Server size={17} x={11} y={11} />}
                  <text x="38" y="20">{shortLabel(layout.device.name)}</text>
                  <text className="muted" x="38" y="36">{shortLabel(`${deviceLocationKey(layout.device)}${layout.device.role ? ` / ${layout.device.role}` : ''}`, 22)}</text>
                </g>
              ))}
              {!selectedDeviceLayouts.length && (
                <g className="hierarchy-placeholder" transform="translate(458 300)">
                  <rect width="224" height="52" rx="9" />
                  <text x="112" y="23">No switch links found</text>
                  <text className="muted" x="112" y="39">Run CDP/LLDP discovery or ingest neighbors</text>
                </g>
              )}
              {selectedDeviceLayouts.length > 0 && !selectedCanvasLinks.length && (
                <g className="hierarchy-placeholder" transform="translate(430 585)">
                  <rect width="280" height="42" rx="9" />
                  <text x="140" y="19">No switch-to-switch CDP/LLDP links found</text>
                  <text className="muted" x="140" y="33">Only inventory switch endpoints are drawn</text>
                </g>
              )}
              <g className="site-map-legend" transform="translate(244 612)">
                <path className="access" d="M0 0h28" /><text x="36" y="4">Real CDP/LLDP neighbor link</text>
                <path className="distribution" d="M230 0h28" /><text x="266" y="4">Role grouping only</text>
                <path className="endpoint" d="M420 0h28" /><text x="456" y="4">Inventory devices only</text>
              </g>
            </svg>
          </div>
        </section>

        <aside className="site-map-inspector">
          <div className="site-inspector-head">
            <span><Building2 size={24} /></span>
            <div>
              <h2>{selectedSite?.name || 'No location'}</h2>
              <p>{selectedSite ? healthLabel(selectedSite) : 'No data'}</p>
            </div>
          </div>
          <dl>
            <dt>Site</dt><dd>{selectedSite?.location || 'Not recorded'}</dd>
            <dt>Devices</dt><dd>{selectedSite?.deviceCount || 0} total | {selectedSite?.onlineCount || 0} online</dd>
            <dt>Rooms / racks</dt><dd>{selectedSite?.locationCount || 0} records | {selectedSite?.rackCount || 0} racks</dd>
            <dt>Switch links</dt><dd>{switchNeighborLinks.length} topology/interface links</dd>
            <dt>Internet edge</dt><dd>{connectedInternetEdgeDevices.length ? connectedInternetEdgeDevices.map((device) => `${device.name} (${deviceLocationKey(device)})`).join(', ') : 'No CDP/LLDP link to Core SW or Backbone'}</dd>
            <dt>Health</dt><dd>{selectedSite?.health || 0}%</dd>
          </dl>
          <div className="site-health-ring" style={{ '--site-health': `${selectedSite?.health || 0}%` } as CSSProperties}>
            <div>
              <b>{selectedSite?.health || 0}%</b>
              <span>Location health</span>
            </div>
          </div>
          <div className="quick-actions">
            <button><Server size={17} /> Devices</button>
            <button><Cable size={17} /> Links</button>
            <button><Wifi size={17} /> Wireless</button>
            <button><Activity size={17} /> Health</button>
          </div>
        </aside>
      </div>

      <section className="card site-device-table">
        <div className="inventory-head">
          <div className="card-title">Switch Neighbor Connections <small>{switchNeighborLinks.length} switch links from CDP/LLDP, interface relationships, or IP matches</small></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Local Device</th><th>Local Port</th><th>Remote Device</th><th>Remote Port</th><th>Protocol</th><th>Last Seen</th></tr></thead>
            <tbody>
              {switchNeighborLinks.map((link) => {
                const localDevice = link.localDevice;
                const remoteDevice = link.remoteDevice;
                const localPort = link.local_interface;
                const remotePort = link.remote_interface;
                return (
                  <tr key={link.id}>
                    <td><b>{localDevice.name}</b><small>{deviceLocationKey(localDevice)}</small></td>
                    <td>{localPort || '-'}</td>
                    <td><b>{remoteDevice.name}</b><small>{deviceLocationKey(remoteDevice)}</small></td>
                    <td>{remotePort || '-'}</td>
                    <td>{link.protocol || '-'}</td>
                    <td>{link.last_seen_at || '-'}</td>
                  </tr>
                );
              })}
              {!switchNeighborLinks.length && <tr><td colSpan={6} className="empty">No switch-to-switch links found. Links are shown only when both endpoints exist in Device Inventory and can be matched by CDP/LLDP, interface relationship, or IP/name.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card site-device-table">
        <div className="inventory-head">
          <div className="card-title">Device Status <small>{selectedDevices.length} devices at {selectedSite?.name || 'selected location'}</small></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Device</th><th>IP Address</th><th>Role</th><th>Location</th><th>Rack</th><th>Status</th></tr></thead>
            <tbody>
              {selectedDevices.map((device) => (
                <tr key={device.id}>
                  <td><b>{device.name}</b><small>{device.platform || device.hostname || 'No platform recorded'}</small></td>
                  <td>{device.management_ip || '-'}</td>
                  <td>{device.role || '-'}</td>
                  <td>{device.location || '-'}</td>
                  <td>{device.rack || '-'}</td>
                  <td><span className={`status ${(device.status || '').toLowerCase()}`}>{device.status || 'Unknown'}</span></td>
                </tr>
              ))}
              {!selectedDevices.length && <tr><td colSpan={6} className="empty">No devices assigned to this location.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
