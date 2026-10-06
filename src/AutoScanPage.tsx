import { FormEvent, useEffect, useState } from 'react';
import { Network, Play, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import type { DeviceTypeRecord } from './DeviceTypesPage';
import { loadDeviceTypes, saveDeviceTypes, slugifyDeviceType } from './DeviceTypesPage';
import { SearchableSelect } from './SearchableSelect';

const api = `${window.location.protocol}//${window.location.hostname}:8001/api/v1`;

type CredentialProfile = {
  id: number;
  name: string;
  credential_type: 'snmp_v2c' | 'ssh';
  username?: string;
  port?: number;
  has_secret: boolean;
  has_enable_secret: boolean;
};

type ScanResult = {
  message: string;
  discovered: number;
  created: number;
  updated: number;
  skipped_offline?: number;
  configs_collected?: number;
};
type Site = { id: number; name: string; location?: string | null };
type SiteOption = { value: string; id?: number; name: string; location?: string; source: 'db' | 'infrastructure' };
type InfraRecord = {
  id?: string;
  name: string;
  site?: string;
  location?: string;
  region?: string;
  room?: string;
  rooms?: number | string | null;
  roomNames?: string[];
};
type TopologyNode = {
  id: string;
  device_id?: number | null;
  name: string;
  ip?: string | null;
  status?: string | null;
  role?: string | null;
  site?: string | null;
  managed?: boolean;
  ingest_status?: string | null;
};
type TopologyLink = {
  id: number;
  local_device_id?: number | null;
  remote_device_id?: number | null;
  local_device_name: string;
  local_ip: string;
  local_interface: string;
  remote_device_name: string;
  remote_ip: string;
  remote_interface: string;
  protocol: string;
  last_seen_at?: string | null;
};
type NodeCredentialSelection = {
  snmp_credential_id?: number | null;
  ssh_credential_id?: number | null;
};
type InventoryDevice = {
  id: number;
  name?: string | null;
  hostname?: string | null;
  role?: string | null;
  device_type?: string | null;
  platform?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  description?: string | null;
  configuration_snapshot?: string | null;
  interfaces?: Array<{ name?: string | null; type?: string | null }>;
};

export function AutoScanPage() {
  const [token, setToken] = useState(localStorage.getItem('aims-api-token') || '');
  const [credentials, setCredentials] = useState<CredentialProfile[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [infrastructureSites, setInfrastructureSites] = useState<InfraRecord[]>([]);
  const [locations, setLocations] = useState<InfraRecord[]>([]);
  const [racks, setRacks] = useState<InfraRecord[]>([]);
  const [form, setForm] = useState({
    subnet: '192.168.220.135/24',
    max_hosts: '90000',
    site_id: '',
    location: '',
    room: '',
    rack: '',
    snmp_credential_id: '',
    ssh_credential_id: '',
    collect_config: false,
  });
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [running, setRunning] = useState(false);
  const [topologyLinks, setTopologyLinks] = useState<TopologyLink[]>([]);
  const [topologyNodes, setTopologyNodes] = useState<TopologyNode[]>([]);
  const [selectedDiscoveredNodeIds, setSelectedDiscoveredNodeIds] = useState<string[]>([]);
  const [nodeCredentialSelections, setNodeCredentialSelections] = useState<Record<string, NodeCredentialSelection>>({});
  const [topologyLoading, setTopologyLoading] = useState(false);
  const [topologyError, setTopologyError] = useState('');
  const [ingesting, setIngesting] = useState(false);

  const ensureToken = async () => {
    if (token) return token;
    const response = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '', password: '' }),
    });
    const json = await response.json();
    if (!response.ok || !json.data?.token) throw new Error(json.message || 'Unable to authenticate.');
    localStorage.setItem('aims-api-token', json.data.token);
    setToken(json.data.token);
    return json.data.token as string;
  };

  const loadOptions = async () => {
    try {
      const auth = await ensureToken();
      const [credentialsResponse, sitesResponse] = await Promise.all([
        fetch(`${api}/credentials`, { headers: { Authorization: `Bearer ${auth}` } }),
        fetch(`${api}/sites`, { headers: { Authorization: `Bearer ${auth}` } }),
      ]);
      const credentialsJson = await credentialsResponse.json();
      const sitesJson = await sitesResponse.json();
      if (!credentialsResponse.ok) throw new Error(credentialsJson.detail || credentialsJson.message || 'Unable to load credentials.');
      if (!sitesResponse.ok) throw new Error(sitesJson.detail || sitesJson.message || 'Unable to load sites.');
      setCredentials(credentialsJson.data?.data || []);
      setSites(sitesJson.data?.data || []);
      const [siteRecords, locationRecords, rackRecords, wirelessResponse] = await Promise.all([
        loadInfrastructureRecords(auth, 'Sites'),
        loadInfrastructureRecords(auth, 'Locations'),
        loadInfrastructureRecords(auth, 'Racks'),
        fetch(`${api}/wireless/monitoring?refresh=0&fast=1`, { headers: { Authorization: `Bearer ${auth}` } }),
      ]);
      const wirelessJson = wirelessResponse.ok ? await wirelessResponse.json() : {};
      const wirelessLocations: InfraRecord[] = (Array.isArray(wirelessJson.data?.access_points) ? wirelessJson.data.access_points : [])
        .map((ap: { location?: string | null; site?: { name?: string } | string | null; site_name?: string | null; controller_name?: string | null }) => ({
          name: String(ap.location || '').trim(),
          site: typeof ap.site === 'object' ? String(ap.site?.name || '') : String(ap.site || ap.site_name || ap.controller_name || ''),
        }))
        .filter((record: InfraRecord) => Boolean(record.name));
      setInfrastructureSites(siteRecords);
      setLocations([...locationRecords, ...wirelessLocations]);
      setRacks(rackRecords);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load scan options.');
    }
  };

  const loadDiscoveredConnections = async () => {
    setTopologyLoading(true);
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/topology`, { headers: { Authorization: `Bearer ${auth}` } });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load discovered connections.');
      const nodes = json.data?.nodes || [];
      setTopologyNodes(nodes);
      setTopologyLinks(json.data?.links || []);
      setSelectedDiscoveredNodeIds((current) => {
        const selectable = new Set(nodes.filter((node: TopologyNode) => !node.managed).map((node: TopologyNode) => node.id));
        return current.filter((nodeId) => selectable.has(nodeId));
      });
      setNodeCredentialSelections((current) => {
        const selectable = new Set(nodes.filter((node: TopologyNode) => !node.managed).map((node: TopologyNode) => node.id));
        return Object.fromEntries(Object.entries(current).filter(([nodeId]) => selectable.has(nodeId)));
      });
      setTopologyError('');
    } catch (error) {
      setTopologyError(error instanceof Error ? error.message : 'Unable to load discovered connections.');
    } finally {
      setTopologyLoading(false);
    }
  };

  useEffect(() => {
    loadOptions();
    loadDiscoveredConnections();
  }, []);

  const runScan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRunning(true);
    setMessage('Scanning network...');
    setResult(null);
    try {
      const auth = await ensureToken();
      const placement = scanPlacement(form, rackOptions);
      const selectedSite = siteOptions.find((site) => site.value === form.site_id);
      if (!selectedSite) throw new Error('Select a site before starting Auto Scan.');
      const params = new URLSearchParams({
        subnet: form.subnet,
        max_hosts: form.max_hosts,
        site_name: selectedSite.name,
        collect_config: String(form.collect_config),
      });
      if (selectedSite.id) params.set('site_id', String(selectedSite.id));
      if (placement.location) params.set('location', placement.location);
      if (placement.room) params.set('room', placement.room);
      if (placement.rack) params.set('rack', placement.rack);
      if (placement.rack_id) params.set('rack_id', placement.rack_id);
      if (placement.rack_key) params.set('rack_key', placement.rack_key);
      if (form.snmp_credential_id) params.set('snmp_credential_id', form.snmp_credential_id);
      if (form.ssh_credential_id) params.set('ssh_credential_id', form.ssh_credential_id);
      const response = await fetch(`${api}/discovery/scan?${params.toString()}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}` },
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Scan failed.');
      setResult(json);
      const typeSummary = await syncDeviceTypesFromInventory(auth);
      setMessage(`Scan complete. ${json.discovered} checked, ${json.created} created, ${json.updated} updated, ${json.skipped_offline || 0} offline skipped, ${json.configs_collected || 0} SSH configs collected.${deviceTypeSyncMessage(typeSummary)}`);
      await loadDiscoveredConnections();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Scan failed.');
    } finally {
      setRunning(false);
    }
  };

  const update = (key: keyof typeof form, value: string | boolean) => setForm((current) => {
    const next = { ...current, [key]: value };
    if (key === 'site_id') {
      next.location = '';
      next.room = '';
      next.rack = '';
    }
    if (key === 'location') {
      next.room = '';
      next.rack = '';
    }
    if (key === 'room') {
      next.rack = '';
    }
    if (key === 'ssh_credential_id' && value) next.collect_config = true;
    return next;
  });

  const toggleDiscoveredNode = (nodeId: string, checked: boolean) => {
    setSelectedDiscoveredNodeIds((current) => {
      if (checked) return Array.from(new Set([...current, nodeId]));
      return current.filter((id) => id !== nodeId);
    });
  };

  const toggleDiscoveredRow = (nodeId: string) => {
    setSelectedDiscoveredNodeIds((current) => current.includes(nodeId)
      ? current.filter((id) => id !== nodeId)
      : Array.from(new Set([...current, nodeId])));
  };

  const updateNodeCredentialSelection = (
    nodeId: string,
    field: keyof NodeCredentialSelection,
    value: string,
  ) => {
    setNodeCredentialSelections((current) => ({
      ...current,
      [nodeId]: { ...current[nodeId], [field]: value ? Number(value) : null },
    }));
    setSelectedDiscoveredNodeIds((current) => current.includes(nodeId) ? current : [...current, nodeId]);
  };

  const assignCredentialToSelectedNodes = (field: keyof NodeCredentialSelection, value: string) => {
    const selectedNodeIds = selectedDiscoveredNodeIds.filter((nodeId) => topologyNodes.some((node) => node.id === nodeId && !node.managed));
    if (!selectedNodeIds.length) return;
    const credentialId = value === 'default' ? null : Number(value);
    setNodeCredentialSelections((current) => ({
      ...current,
      ...Object.fromEntries(selectedNodeIds.map((nodeId) => [
        nodeId,
        { ...current[nodeId], [field]: credentialId },
      ])),
    }));
    setTopologyError('');
    setMessage(`${field === 'snmp_credential_id' ? 'SNMP' : 'SSH'} profile assigned to ${selectedNodeIds.length} selected device${selectedNodeIds.length === 1 ? '' : 's'}.`);
  };

  const ingestDiscoveredDevices = async (fullScan: boolean, explicitNodeIds: string[] = []) => {
    const discoveredIds = new Set(topologyNodes.filter((node) => !node.managed).map((node) => node.id));
    const requestedNodeIds = explicitNodeIds.length ? explicitNodeIds : selectedDiscoveredNodeIds;
    const nodeIds = requestedNodeIds.filter((nodeId) => discoveredIds.has(nodeId));
    if (!nodeIds.length) {
      setTopologyError('Select at least one discovered device first.');
      return;
    }
    setIngesting(true);
    setTopologyError('');
    setMessage(fullScan ? 'Full scanning selected devices and detecting their direct neighbors...' : 'Ingesting discovered device...');
    try {
      const auth = await ensureToken();
      const placement = scanPlacement(form, rackOptions);
      const selectedSite = siteOptions.find((site) => site.value === form.site_id);
      const response = await fetch(`${api}/topology/ingest-neighbors`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node_ids: nodeIds,
          full_scan: fullScan,
          site_id: selectedSite?.id || null,
          site_name: selectedSite?.name || '',
          location: placement.location,
          room: placement.room,
          rack: placement.rack,
          rack_id: placement.rack_id,
          rack_key: placement.rack_key,
          snmp_credential_id: form.snmp_credential_id ? Number(form.snmp_credential_id) : null,
          ssh_credential_id: form.ssh_credential_id ? Number(form.ssh_credential_id) : null,
          node_credentials: Object.fromEntries(nodeIds.map((nodeId) => [nodeId, nodeCredentialSelections[nodeId] || {}])),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Neighbor ingest failed.');
      const summary = json.data || {};
      const typeSummary = await syncDeviceTypesFromInventory(auth);
      setMessage(`Ingest complete. ${summary.created || 0} selected devices created, ${summary.updated || 0} updated, ${summary.neighbors_detected || 0} direct neighbors detected, ${summary.neighbors_created || 0} new neighbors added, ${summary.neighbors_scanned || 0} neighbors scanned, ${summary.configs_collected || 0} SSH configs collected, ${summary.skipped || 0} skipped.${deviceTypeSyncMessage(typeSummary)}`);
      setSelectedDiscoveredNodeIds((current) => explicitNodeIds.length ? current.filter((nodeId) => !nodeIds.includes(nodeId)) : []);
      await loadDiscoveredConnections();
    } catch (error) {
      setTopologyError(error instanceof Error ? error.message : 'Neighbor ingest failed.');
    } finally {
      setIngesting(false);
    }
  };

  const snmpProfiles = credentials.filter((item) => item.credential_type === 'snmp_v2c');
  const sshProfiles = credentials.filter((item) => item.credential_type === 'ssh');
  const discoveredNodes = topologyNodes.filter((node) => !node.managed);
  const discoveredNodeIds = new Set(discoveredNodes.map((node) => node.id));
  const selectedDiscoveredCount = selectedDiscoveredNodeIds.filter((nodeId) => discoveredNodeIds.has(nodeId)).length;
  const allDiscoveredSelected = discoveredNodes.length > 0 && selectedDiscoveredCount === discoveredNodes.length;
  const siteOptions = mergedSiteOptions(sites, infrastructureSites);
  const selectedSiteName = siteOptions.find((site) => site.value === form.site_id)?.name || '';
  const allLocationOptions = uniqueByName(locations);
  const matchedLocationOptions = uniqueByName(locations.filter((location) => !selectedSiteName || !location.site || sameText(location.site, selectedSiteName)));
  const locationOptions = allLocationOptions;
  const selectedLocation = locationOptions.find((location) => sameText(location.name, form.location));
  const roomOptions = roomOptionsForLocation(selectedLocation);
  const rackContextOptions = uniqueByName(racks.filter((rack) => {
    if (selectedSiteName && rack.site && !sameText(rack.site, selectedSiteName)) return false;
    if (form.location && rack.location && !sameText(rack.location, form.location)) return false;
    return form.location ? sameText(rack.location, form.location) || !rack.location : true;
  }));
  const roomRackOptions = form.room
    ? uniqueByName(rackContextOptions.filter((rack) => sameText(rackRoomName(rack), form.room)))
    : rackContextOptions;
  const rackOptions = roomOptions.length > 1
    ? (form.room ? roomRackOptions : [])
    : rackContextOptions;

  return (
    <div className="content auto-scan-page">
      <div className="page-title">
        <div>
          <h1>Auto Scan</h1>
          <p>Discover network devices with ICMP, DNS, ARP, SNMP inventory, and optional SSH configuration collection.</p>
        </div>
        <button className="plain-button" onClick={() => { loadOptions(); loadDiscoveredConnections(); }}><RefreshCw size={16} /> Refresh options</button>
      </div>

      {message && <div className="module-notice">{message}<button onClick={() => setMessage('')}>x</button></div>}

      <div className="config-settings-grid scan-workspace">
        <section className="card config-setting-card">
          <div className="card-title">Scan Target</div>
          <form className="settings-form" onSubmit={runScan}>
            <div className="form-grid">
              <label>Subnet, host, range, or IP list
                <input required value={form.subnet} onChange={(event) => update('subnet', event.target.value)} placeholder="192.168.100.20-25 or 192.168.100.56,192.168.100.63" />
                <small>Supports CIDR, single IP, short ranges, full IP ranges, and comma-separated targets.</small>
              </label>
              <label>Max hosts<input type="number" min="1" max="90000" value={form.max_hosts} onChange={(event) => update('max_hosts', event.target.value)} /></label>
              <label>Site
                <SearchableSelect
                  required
                  value={form.site_id}
                  onChange={(value) => update('site_id', value)}
                  placeholder="Select site"
                  searchPlaceholder="Search sites..."
                  options={[
                    { value: '', label: 'Select site', disabled: true },
                    ...siteOptions.map((site) => ({
                      value: site.value,
                      label: `${site.name}${site.location ? ` - ${site.location}` : ''}${site.source === 'infrastructure' ? ' (Infrastructure)' : ''}`,
                    })),
                  ]}
                />
              </label>
              <label>Location
                <SearchableSelect
                  value={form.location}
                  disabled={!locationOptions.length}
                  onChange={(value) => update('location', value)}
                  placeholder="Optional location"
                  searchPlaceholder="Search locations..."
                  options={[
                    { value: '', label: 'Optional location' },
                    ...locationOptions.map((location) => ({
                      value: location.name,
                      label: `${location.name}${location.site ? ` - ${location.site}` : ''}`,
                    })),
                  ]}
                />
              </label>
              {roomOptions.length > 1 && (
                <label>Room
                  <select value={form.room} onChange={(event) => update('room', event.target.value)}>
                    <option value="">Optional room</option>
                    {roomOptions.map((room) => <option key={room} value={room}>{room}</option>)}
                  </select>
                </label>
              )}
              <label>Rack
                <SearchableSelect
                  value={form.rack}
                  disabled={!rackOptions.length}
                  onChange={(value) => update('rack', value)}
                  placeholder="Optional rack"
                  searchPlaceholder="Search racks..."
                  options={[
                    { value: '', label: 'Optional rack' },
                    ...rackOptions.map((rack) => ({
                      value: rackRecordKey(rack),
                      label: [rack.name, rack.region, rack.location].filter(Boolean).join(' - '),
                    })),
                  ]}
                />
              </label>
            </div>

            <div className="form-section compact-section">
              <h3>Credentials</h3>
              <div className="form-grid">
                <label>SNMP profile
                  <select value={form.snmp_credential_id} onChange={(event) => update('snmp_credential_id', event.target.value)}>
                    <option value="">Use global SNMP community</option>
                    {snmpProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select>
                </label>
                <label>SSH profile
                  <select value={form.ssh_credential_id} onChange={(event) => update('ssh_credential_id', event.target.value)}>
                    <option value="">No SSH profile</option>
                    {sshProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} {profile.username ? `(${profile.username})` : ''}</option>)}
                  </select>
                </label>
                <label className="toggle scan-toggle">
                  Collect device configuration
                  <input type="checkbox" checked={form.collect_config} onChange={(event) => update('collect_config', event.target.checked)} />
                  <i />
                </label>
              </div>
            </div>

            <div className="scan-protocols">
              <span><Network size={15} /> ICMP</span>
              <span>DNS</span>
              <span>ARP</span>
              <span>SNMP</span>
              <span>SSH</span>
              <span><ShieldCheck size={15} /> Inventory update</span>
            </div>

            <div className="form-actions">
              <button className="add" type="submit" disabled={running}><Play size={16} /> {running ? 'Scanning...' : 'Start scan'}</button>
            </div>
          </form>
        </section>

        <section className="card config-setting-card">
          <div className="card-title">Scan Result</div>
          {result ? (
            <div className="config-metrics scan-result">
              <div><p>Checked</p><b>{result.discovered}</b></div>
              <div><p>Created</p><b>{result.created}</b></div>
              <div><p>Updated</p><b>{result.updated}</b></div>
              <div><p>Offline skipped</p><b>{result.skipped_offline || 0}</b></div>
              <div><p>SSH configs</p><b>{result.configs_collected || 0}</b></div>
            </div>
          ) : (
            <p className="config-copy">Select the credential profiles and run a scan. Device details will be saved into Device Inventory.</p>
          )}
          <div className="credential-list">
            <h3>Available Profiles</h3>
            {credentials.length ? credentials.map((profile) => (
              <div key={profile.id} className="credential-row">
                <b>{profile.name}</b>
                <span>{profile.credential_type === 'snmp_v2c' ? 'SNMP v2c' : `SSH ${profile.username || ''}`}</span>
                <em>{profile.has_secret ? 'Secret saved' : 'No secret'}</em>
              </div>
            )) : <p>No credential profiles saved. Add them in Configurations.</p>}
          </div>
        </section>
      </div>

      <section className="card inventory advanced-card scan-discovered-card">
        <div className="inventory-head scan-discovered-head">
          <div className="card-title">Discovered Devices <small>{discoveredNodes.length} not ingested. Set profiles per device or assign one profile to the selected group.</small></div>
          <div className="scan-bulk-actions">
            <span>{selectedDiscoveredCount} selected</span>
            <button className="plain-button" onClick={() => setSelectedDiscoveredNodeIds(discoveredNodes.map((node) => node.id))} disabled={!discoveredNodes.length || allDiscoveredSelected}>Select all</button>
            <button className="plain-button" onClick={() => setSelectedDiscoveredNodeIds([])} disabled={!selectedDiscoveredCount}>Clear</button>
            <select
              className="scan-bulk-profile"
              aria-label="Assign SNMP profile to selected devices"
              value=""
              disabled={ingesting || !selectedDiscoveredCount}
              onChange={(event) => assignCredentialToSelectedNodes('snmp_credential_id', event.target.value)}
            >
              <option value="" disabled>Assign SNMP profile</option>
              <option value="default">Use scan default</option>
              {snmpProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
            <select
              className="scan-bulk-profile"
              aria-label="Assign SSH profile to selected devices"
              value=""
              disabled={ingesting || !selectedDiscoveredCount}
              onChange={(event) => assignCredentialToSelectedNodes('ssh_credential_id', event.target.value)}
            >
              <option value="" disabled>Assign SSH profile</option>
              <option value="default">Use scan default</option>
              {sshProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.username ? ` (${profile.username})` : ''}</option>)}
            </select>
            <button className="plain-button" onClick={() => ingestDiscoveredDevices(false)} disabled={ingesting || !selectedDiscoveredCount}>
              <Plus size={14} /> {ingesting ? 'Working...' : 'Ingest'}
            </button>
            <button className="plain-button" onClick={() => ingestDiscoveredDevices(true)} disabled={ingesting || !selectedDiscoveredCount}>
              <RefreshCw size={14} /> Full scan + neighbors
            </button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="scan-select-col">
                  <input
                    type="checkbox"
                    aria-label="Select all discovered devices"
                    checked={allDiscoveredSelected}
                    disabled={!discoveredNodes.length}
                    onChange={(event) => setSelectedDiscoveredNodeIds(event.target.checked ? discoveredNodes.map((node) => node.id) : [])}
                  />
                </th>
                <th>DEVICE</th>
                <th>MANAGEMENT IP</th>
                <th>ROLE</th>
                <th>STATUS</th>
                <th>SITE</th>
                <th>MAP IDENTITY</th>
                <th>SNMP PROFILE</th>
                <th>SSH PROFILE</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {!discoveredNodes.length ? (
                <tr><td colSpan={10} className="empty">{topologyLoading ? 'Loading discovered devices...' : 'No not-ingested devices found. Run Auto Scan with SNMP neighbor discovery enabled.'}</td></tr>
              ) : discoveredNodes.map((node) => {
                const selected = selectedDiscoveredNodeIds.includes(node.id);
                return (
                  <tr
                    key={node.id}
                    className={selected ? 'selected clickable-row' : 'clickable-row'}
                    onClick={() => toggleDiscoveredRow(node.id)}
                  >
                    <td className="scan-select-col">
                      <input
                        type="checkbox"
                        aria-label={`Select ${node.name || node.ip || node.id}`}
                        checked={selected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => toggleDiscoveredNode(node.id, event.target.checked)}
                      />
                    </td>
                    <td><b>{node.name || node.ip || 'Discovered device'}</b><small>{node.id}</small></td>
                    <td>{node.ip || '-'}</td>
                    <td>{node.role || '-'}</td>
                    <td><span className="status planned">{node.ingest_status || node.status || 'Not ingested'}</span></td>
                    <td>{node.site || '-'}</td>
                    <td>{node.id}</td>
                    <td className="scan-profile-cell" onClick={(event) => event.stopPropagation()}>
                      <select
                        aria-label={`SNMP profile for ${node.name || node.ip || node.id}`}
                        value={nodeCredentialSelections[node.id]?.snmp_credential_id || ''}
                        onChange={(event) => updateNodeCredentialSelection(node.id, 'snmp_credential_id', event.target.value)}
                      >
                        <option value="">Use scan default</option>
                        {snmpProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                      </select>
                    </td>
                    <td className="scan-profile-cell" onClick={(event) => event.stopPropagation()}>
                      <select
                        aria-label={`SSH profile for ${node.name || node.ip || node.id}`}
                        value={nodeCredentialSelections[node.id]?.ssh_credential_id || ''}
                        onChange={(event) => updateNodeCredentialSelection(node.id, 'ssh_credential_id', event.target.value)}
                      >
                        <option value="">Use scan default</option>
                        {sshProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.username ? ` (${profile.username})` : ''}</option>)}
                      </select>
                    </td>
                    <td className="scan-row-actions">
                      <button
                        type="button"
                        className="row-action"
                        disabled={ingesting}
                        onClick={(event) => {
                          event.stopPropagation();
                          ingestDiscoveredDevices(false, [node.id]);
                        }}
                      >
                        Ingest
                      </button>
                      <button
                        type="button"
                        className="row-action"
                        disabled={ingesting || !node.ip}
                        title={node.ip ? 'Full scan this device, then detect and scan its direct CDP/LLDP neighbors' : 'Full scan requires a management IP'}
                        onClick={(event) => {
                          event.stopPropagation();
                          ingestDiscoveredDevices(true, [node.id]);
                        }}
                      >
                        Full scan + neighbors
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card inventory advanced-card scan-connections-card">
        <div className="inventory-head">
          <div className="card-title">Discovered Connections <small>{topologyLinks.length} links</small></div>
          <button className="plain-button" onClick={loadDiscoveredConnections} disabled={topologyLoading}>
            <RefreshCw size={14} /> {topologyLoading ? 'Refreshing...' : 'Refresh links'}
          </button>
        </div>
        {topologyError && <div className="module-notice scan-table-notice">{topologyError}<button onClick={() => setTopologyError('')}>x</button></div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>LOCAL DEVICE</th>
                <th>LOCAL PORT</th>
                <th>REMOTE DEVICE</th>
                <th>REMOTE PORT</th>
                <th>PROTOCOL</th>
                <th>LAST SEEN</th>
              </tr>
            </thead>
            <tbody>
              {!topologyLinks.length ? (
                <tr><td colSpan={6} className="empty">{topologyLoading ? 'Loading discovered connections...' : 'No topology links found. Run Auto Scan with SNMP neighbor discovery enabled.'}</td></tr>
              ) : topologyLinks.map((link) => (
                <tr key={link.id}>
                  <td><b>{link.local_device_name || link.local_ip || '-'}</b><small>{connectionIdentity(link.local_device_id, link.local_ip)}</small></td>
                  <td>{link.local_interface || '-'}</td>
                  <td><b>{link.remote_device_name || link.remote_ip || '-'}</b><small>{connectionIdentity(link.remote_device_id, link.remote_ip)}</small></td>
                  <td>{link.remote_interface || '-'}</td>
                  <td><span className="status active">{(link.protocol || 'neighbor').toUpperCase()}</span></td>
                  <td>{link.last_seen_at || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function connectionIdentity(deviceId?: number | null, ip?: string | null) {
  return [deviceId ? `ID #${deviceId}` : '', ip || ''].filter(Boolean).join(' - ') || '-';
}

async function loadInfrastructureRecords(token: string, resource: 'Sites' | 'Locations' | 'Racks'): Promise<InfraRecord[]> {
  try {
    const response = await fetch(`${api}/infrastructure/${encodeURIComponent(resource)}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await response.json();
    if (response.ok && Array.isArray(json.data?.records)) return normalizeInfraRecords(json.data.records);
  } catch {
    return [];
  }
  return [];
}

function normalizeInfraRecords(value: unknown): InfraRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map((row) => {
      const roomCount = Math.max(1, Math.floor(Number(row.rooms || 0) || 1));
      const roomNames = Array.isArray(row.roomNames) ? row.roomNames.map((room) => String(room || '').trim()).filter(Boolean) : [];
      return {
        id: typeof row.id === 'string' ? row.id : undefined,
        name: String(row.name || '').trim(),
        site: String(row.site || '').trim(),
        location: String(row.location || '').trim(),
        region: String(row.region || row.room || '').trim(),
        room: String(row.room || row.region || '').trim(),
        rooms: roomCount,
        roomNames: roomCount > 1 ? Array.from({ length: roomCount }, (_, index) => roomNames[index] || `Room ${index + 1}`) : [roomNames[0] || 'Network Room'],
      };
    })
    .filter((row) => row.name);
}

function uniqueByName(records: InfraRecord[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = rackRecordKey(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function mergedSiteOptions(dbSites: Site[], infraSites: InfraRecord[]): SiteOption[] {
  const options: SiteOption[] = [];
  const seenNames = new Set<string>();
  dbSites.forEach((site) => {
    const name = String(site.name || '').trim();
    if (!name) return;
    seenNames.add(name.toLowerCase());
    options.push({
      value: `db:${site.id}`,
      id: site.id,
      name,
      location: String(site.location || '').trim(),
      source: 'db',
    });
  });
  infraSites.forEach((site) => {
    const name = String(site.name || '').trim();
    if (!name || seenNames.has(name.toLowerCase())) return;
    seenNames.add(name.toLowerCase());
    options.push({
      value: `infra:${rackRecordKey(site)}`,
      name,
      location: String(site.location || site.region || '').trim(),
      source: 'infrastructure',
    });
  });
  return options.sort((a, b) => a.name.localeCompare(b.name));
}

function rackRecordKey(record: InfraRecord) {
  return [
    record.id || '',
    record.site || '',
    record.location || '',
    record.region || '',
    record.name || '',
  ].map((value) => String(value).trim().toLowerCase()).join('|');
}

function scanPlacement(form: { location: string; room: string; rack: string }, rackOptions: InfraRecord[]) {
  const selectedRack = rackOptions.find((rack) => rackRecordKey(rack) === form.rack);
  if (!selectedRack) {
    return {
      location: form.location.trim(),
      room: form.room.trim(),
      rack: '',
      rack_id: '',
      rack_key: '',
    };
  }
  return {
    location: (selectedRack.location || form.location).trim(),
    room: (selectedRack.region || form.room).trim(),
    rack: selectedRack.name.trim(),
    rack_id: String(selectedRack.id || '').trim(),
    rack_key: rackRecordKey(selectedRack),
  };
}

function roomOptionsForLocation(location?: InfraRecord) {
  if (!location) return [];
  const namedRooms = (location.roomNames || []).map((room) => room.trim()).filter(Boolean);
  if (namedRooms.length) return namedRooms;
  const count = Math.max(0, Math.floor(Number(location.rooms || 0)));
  if (count <= 1) return ['Network Room'];
  return Array.from({ length: Math.min(count, 200) }, (_, index) => `Room ${index + 1}`);
}

function rackRoomName(rack: InfraRecord) {
  return String(rack.region || rack.room || '').trim();
}

function sameText(a: unknown, b: unknown) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

type DeviceTypeDraft = Omit<DeviceTypeRecord, 'id' | 'updated_at'>;
type CiscoStackProfile = {
  model: string;
  totalPorts?: number;
  swVersion?: string;
  swImage?: string;
  mode?: string;
};

async function syncDeviceTypesFromInventory(auth: string) {
  try {
    const devices = await loadInventoryDevices(auth);
    const existing = loadDeviceTypes();
    const existingKeys = new Set<string>();
    existing.forEach((type) => {
      existingKeys.add(type.slug.toLowerCase());
      existingKeys.add(deviceTypeIdentity(type.manufacturer, type.model));
    });

    const created: DeviceTypeRecord[] = [];
    devices.forEach((device) => {
      const draft = inferDeviceTypeFromInventoryDevice(device);
      if (!draft) return;
      const slug = draft.slug || slugifyDeviceType(`${draft.manufacturer} ${draft.model}`);
      const identity = deviceTypeIdentity(draft.manufacturer, draft.model);
      if (!slug || existingKeys.has(slug.toLowerCase()) || existingKeys.has(identity)) return;
      existingKeys.add(slug.toLowerCase());
      existingKeys.add(identity);
      created.push({
        ...draft,
        slug,
        id: nextLocalId(),
        updated_at: new Date().toISOString(),
      });
    });

    if (created.length) saveDeviceTypes([...created, ...existing]);
    return { created: created.length, models: created.map((type) => `${type.manufacturer} ${type.model}`.trim()) };
  } catch (error) {
    console.warn('Device type sync failed', error);
    return { created: 0, models: [], error: error instanceof Error ? error.message : 'Device type sync failed.' };
  }
}

async function loadInventoryDevices(auth: string) {
  const devices: InventoryDevice[] = [];
  let page = 1;
  let pages = 1;
  do {
    const response = await fetch(`${api}/devices?page=${page}&per_page=100`, { headers: { Authorization: `Bearer ${auth}` } });
    const json = await response.json();
    if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load devices for type sync.');
    const rows = json.data?.data;
    if (Array.isArray(rows)) devices.push(...rows);
    pages = Math.max(1, Number(json.data?.meta?.pages || 1));
    page += 1;
  } while (page <= pages);
  return devices;
}

function inferDeviceTypeFromInventoryDevice(device: InventoryDevice): DeviceTypeDraft | null {
  const snapshot = device.configuration_snapshot || '';
  const stackProfile = parseCiscoStackProfile(snapshot);
  const rawText = [
    device.manufacturer,
    device.model,
    device.platform,
    device.device_type,
    device.role,
    device.description,
    snapshot.slice(0, 8000),
  ].filter(Boolean).join(' ');
  const model = stackProfile?.model || parseModelFromText(rawText) || normalizeModel(device.model);
  if (!model) return null;

  const manufacturer = inferManufacturer(device.manufacturer, rawText, model);
  if (!manufacturer) return null;
  const category = inferDeviceCategory(model, rawText);
  const portProfile = inferCiscoPortProfile(model, stackProfile?.totalPorts, device.interfaces?.length || 0);
  const defaultPlatform = stackProfile?.swVersion
    ? `Cisco IOS XE ${stackProfile.swVersion}`
    : String(device.platform || '').trim();
  const stackNotes = [
    stackProfile?.totalPorts ? `${stackProfile.totalPorts} total ports` : '',
    stackProfile?.swVersion ? `SW ${stackProfile.swVersion}` : '',
    stackProfile?.swImage || '',
    stackProfile?.mode || '',
  ].filter(Boolean).join(', ');

  return {
    manufacturer,
    model,
    slug: slugifyDeviceType(`${manufacturer} ${model}`),
    default_platform: defaultPlatform,
    description: stackProfile
      ? `Auto-created from Cisco Auto Scan data for ${model}.`
      : `Auto-created from Auto Scan inventory for ${model}.`,
    tags: ['auto-scan', manufacturer.toLowerCase(), category].filter(Boolean).join(', '),
    height_u: category === 'access_point' || category === 'ip_phone' ? 0 : 1,
    part_number: model,
    full_depth: category !== 'access_point' && category !== 'ip_phone',
    exclude_from_utilization: category === 'temperature' || category === 'power',
    parent_child_status: '',
    airflow: category === 'switch' || category === 'router' || category === 'firewall' ? 'Front to rear' : '',
    weight: '',
    weight_unit: 'kg',
    default_power_w: '',
    front_panel_kind: category,
    icon_key: category,
    front_panel_ports: portProfile.accessPorts,
    front_panel_uplinks: portProfile.uplinks,
    front_panel_power_bays: category === 'switch' || category === 'router' || category === 'firewall' ? 2 : 0,
    front_panel_notes: stackNotes || 'Detected from Auto Scan inventory.',
    front_image: '',
    rear_image: '',
    owner_group: '',
    owner: '',
    comments: '',
  };
}

function parseCiscoStackProfile(snapshot: string): CiscoStackProfile | null {
  const lines = snapshot.split(/\r?\n/);
  for (const line of lines) {
    const stackMatch = line.match(/^\s*[-*]?\s*\d+\s+(\d+)\s+([A-Z0-9][A-Z0-9._-]+)\s+(\S+)\s+(\S+)\s+(\S+)/i);
    if (!stackMatch) continue;
    const model = normalizeModel(stackMatch[2]);
    if (!model || !isLikelyCiscoModel(model)) continue;
    return {
      totalPorts: Number(stackMatch[1]) || undefined,
      model,
      swVersion: stackMatch[3],
      swImage: stackMatch[4],
      mode: stackMatch[5],
    };
  }

  const model = parseModelFromText(snapshot);
  if (!model || !isLikelyCiscoModel(model)) return null;
  const swVersion = snapshot.match(/\b(?:Cisco IOS XE Software,\s*)?Version\s+([0-9][\w.()/-]*)/i)?.[1];
  const swImage = snapshot.match(/\b(CAT[0-9A-Z_./-]*IOSXE|IOSXE|UNIVERSALK9[0-9A-Z_./-]*)\b/i)?.[1];
  return { model, swVersion, swImage };
}

function parseModelFromText(value: string) {
  const stackModel = value.match(/^\s*[-*]?\s*\d+\s+\d+\s+([A-Z0-9][A-Z0-9._-]+)\s+\S+\s+\S+\s+\S+/im)?.[1];
  const ciscoModel = value.match(/\b(C(?:at(?:alyst)?)?\s*9[123456789]\d{2}[A-Z0-9._-]*|C[123456789]\d{3}[A-Z0-9._-]*)\b/i)?.[1];
  const modelNumber = value.match(/\bModel\s+(?:Number|number|num|name)\s*:?\s*([A-Z0-9][A-Z0-9._-]{3,})/i)?.[1]
    || value.match(/\bModel\s*:\s*([A-Z0-9][A-Z0-9._-]{3,})/i)?.[1];
  const pid = value.match(/\bPID\s*:?\s*([A-Z0-9][A-Z0-9._-]{3,})/i)?.[1];
  return normalizeModel(stackModel || ciscoModel || modelNumber || pid || '');
}

function normalizeModel(value?: string | null) {
  const model = String(value || '')
    .trim()
    .replace(/^Cisco\s+/i, '')
    .replace(/^Catalyst\s+/i, 'C')
    .toUpperCase();
  return isInvalidModelValue(model) ? '' : model;
}

function isInvalidModelValue(value: string) {
  const model = String(value || '').trim().toUpperCase();
  if (!model || model.length < 4) return true;
  if (/^\d+(?:\.\d+){3,}$/.test(model)) return true;
  if (/^(REVISION|VERSION|UNKNOWN|UNSPECIFIED|N\/A|NA|NONE|NULL|MODEL|NUMBER|SERIAL|SN|PID|VID|OID)$/i.test(model)) return true;
  return false;
}

function inferManufacturer(manufacturer: string | null | undefined, rawText: string, model: string) {
  const explicit = String(manufacturer || '').trim();
  if (explicit) return explicit;
  if (/cisco|catalyst|iosxe|ios xe|cat9k|^c9\d{3}/i.test(`${rawText} ${model}`)) return 'Cisco';
  return '';
}

function inferDeviceCategory(model: string, rawText: string) {
  const value = `${model} ${rawText}`.toLowerCase();
  if (/firewall|asa|ftd|secure firewall/.test(value)) return 'firewall';
  if (/wireless controller|wlc|c9800|9800-l|9800-cl/.test(value)) return 'wireless_controller';
  if (/access point|\bap\b|aironet|c91\d{2}/.test(value)) return 'access_point';
  if (/router|\bisr\b|\basr\b|\bcsr\b/.test(value)) return 'router';
  if (/temperature|temp sensor/.test(value)) return 'temperature';
  if (/power sensor/.test(value)) return 'power';
  if (/ups/.test(value)) return 'ups';
  if (/\bpdu\b|power distribution/.test(value)) return 'pdu';
  if (/server|ucs/.test(value)) return 'server';
  if (/storage/.test(value)) return 'storage';
  if (/database/.test(value)) return 'database';
  if (/phone/.test(value)) return 'ip_phone';
  if (/workstation|desktop|laptop/.test(value)) return 'workstation';
  if (/compute/.test(value)) return 'compute';
  return 'switch';
}

function inferCiscoPortProfile(model: string, totalPorts = 0, interfaceCount = 0) {
  const accessMatch = model.match(/-(\d{2})(?:P|T|X|U|UX|UXG|H)?(?:-|$)/i);
  const uplinkMatch = model.match(/-(\d+)(?:G|X|Y|SFP)\b/i);
  const accessPorts = Number(accessMatch?.[1] || 0);
  const uplinks = Number(uplinkMatch?.[1] || 0);
  if (accessPorts || uplinks) {
    return {
      accessPorts: accessPorts || Math.max(0, totalPorts - uplinks),
      uplinks,
    };
  }
  if (totalPorts) return { accessPorts: Math.max(totalPorts - uplinks, 0), uplinks };
  return { accessPorts: Math.max(interfaceCount, 0), uplinks: 0 };
}

function isLikelyCiscoModel(model: string) {
  const normalized = normalizeModel(model);
  return Boolean(normalized) && /^(C\d{4}|CAT|WS-C|ISR|ASR|N\d|CISCO)/i.test(normalized);
}

function deviceTypeIdentity(manufacturer: string, model: string) {
  return `${manufacturer.trim().toLowerCase()}|${model.trim().toLowerCase()}`;
}

function nextLocalId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `type-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function deviceTypeSyncMessage(summary: { created: number; models: string[]; error?: string }) {
  if (summary.created > 0) {
    const preview = summary.models.slice(0, 3).join(', ');
    const extra = summary.models.length > 3 ? ` and ${summary.models.length - 3} more` : '';
    return ` ${summary.created} device type${summary.created === 1 ? '' : 's'} created${preview ? ` (${preview}${extra})` : ''}.`;
  }
  if (summary.error) return ` Device type sync skipped: ${summary.error}`;
  return '';
}
