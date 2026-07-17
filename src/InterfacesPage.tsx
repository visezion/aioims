import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Cable, RefreshCw, Save, Search, X } from 'lucide-react';

const api = 'http://127.0.0.1:8001/api/v1';

type DeviceInterface = {
  name: string;
  ip?: string | null;
  status?: string | null;
  display_status?: string | null;
  mac?: string | null;
  type?: string | null;
  speed?: number | null;
  mtu?: number | null;
  label?: string | null;
  enabled?: boolean;
  parent?: string | null;
  lag?: string | null;
  mode?: string | null;
  description?: string | null;
  ip_addresses?: string[];
  cable?: string | null;
  connection?: string | null;
  connection_device_name?: string | null;
};
type Device = {
  id: number;
  name: string;
  hostname?: string | null;
  management_ip?: string | null;
  role: string;
  status: string;
  site?: { name: string } | null;
  interfaces?: DeviceInterface[] | null;
};
type InterfaceRow = DeviceInterface & {
  id: string;
  interface_index: number;
  device_id: number;
  device_name: string;
  device_ip?: string | null;
  device_role: string;
  device_status: string;
  site?: string | null;
};
type InterfaceForm = {
  name: string;
  label: string;
  status: string;
  enabled: string;
  ip_addresses: string;
  ip: string;
  mac: string;
  type: string;
  speed: string;
  mtu: string;
  parent: string;
  lag: string;
  mode: string;
  description: string;
  cable: string;
  connection: string;
  connection_device_name: string;
};
type SortDirection = 'asc' | 'desc';
type InterfaceSortField = 'device' | 'interface' | 'state' | 'ip' | 'mode' | 'mac' | 'cable' | 'connection';

export function InterfacesPage() {
  const [token, setToken] = useState(localStorage.getItem('aims-api-token') || '');
  const [devices, setDevices] = useState<Device[]>([]);
  const [rows, setRows] = useState<InterfaceRow[]>([]);
  const [editing, setEditing] = useState<InterfaceRow | null>(null);
  const [form, setForm] = useState<InterfaceForm>(() => emptyInterfaceForm());
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [sortField, setSortField] = useState<InterfaceSortField>('device');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const ensureToken = async (force = false) => {
    if (token && !force) return token;
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

  const load = async () => {
    setLoading(true);
    try {
      let auth = await ensureToken();
      let devices = await loadAllDevices(auth);
      if (devices === 'unauthorized') {
        localStorage.removeItem('aims-api-token');
        auth = await ensureToken(true);
        devices = await loadAllDevices(auth);
      }
      if (devices === 'unauthorized') throw new Error('Unable to authenticate.');
      const nextRows = flattenInterfaces(devices);
      setDevices(devices);
      setRows(nextRows);
      setSelectedIds((current) => current.filter((id) => nextRows.some((row) => row.id === id)));
      setEditing((current) => current ? nextRows.find((row) => row.id === current.id) || current : current);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load interfaces.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    const visibleRows = rows.filter((row) => {
      const matchesQuery = !value || [
        row.device_name,
        row.device_ip,
        row.device_role,
        row.site,
        row.name,
        row.label,
        row.status,
        row.display_status,
        row.mac,
        row.mode,
        row.description,
        row.connection,
        row.connection_device_name,
        ...(row.ip_addresses || []),
      ].join(' ').toLowerCase().includes(value);
      const state = interfaceState(row);
      const matchesStatus = !status || state === status;
      return matchesQuery && matchesStatus;
    });
    return sortInterfaceRows(visibleRows, sortField, sortDirection);
  }, [rows, query, status, sortField, sortDirection]);

  const stats = useMemo(() => {
    const up = rows.filter((row) => interfaceState(row) === 'up').length;
    const down = rows.filter((row) => interfaceState(row) === 'down').length;
    const connected = rows.filter((row) => row.connection || row.connection_device_name).length;
    return { total: rows.length, up, down, connected };
  }, [rows]);

  const openEdit = (row: InterfaceRow) => {
    setEditing(row);
    setForm(rowToForm(row));
    setMessage('');
  };

  const selectedRows = filtered.filter((row) => selectedIds.includes(row.id));
  const allFilteredSelected = filtered.length > 0 && filtered.every((row) => selectedIds.includes(row.id));

  const toggleInterfaceSelected = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const toggleFilteredSelected = () => {
    const ids = filtered.map((row) => row.id);
    setSelectedIds((current) => allFilteredSelected
      ? current.filter((id) => !ids.includes(id))
      : Array.from(new Set([...current, ...ids])));
  };

  const exportSelectedInterfaces = () => {
    exportRowsCsv(
      'interfaces-selected.csv',
      ['Device', 'Interface', 'State', 'IP Addresses', 'Mode', 'MAC', 'Cable', 'Connection'],
      selectedRows.map((row) => [
        row.device_name,
        row.name,
        row.display_status || row.status || '',
        (row.ip_addresses || []).join(' '),
        row.mode || '',
        row.mac || '',
        row.cable || '',
        row.connection_device_name || row.connection || '',
      ]),
    );
  };

  const bulkSetInterfaceStatus = async (nextStatus: 'up' | 'down' | 'disabled') => {
    if (!selectedRows.length) return;
    setBulkSaving(true);
    try {
      let auth = await ensureToken();
      const selectedByDevice = new Map<number, InterfaceRow[]>();
      selectedRows.forEach((row) => selectedByDevice.set(row.device_id, [...(selectedByDevice.get(row.device_id) || []), row]));
      for (const [deviceId, rowsForDevice] of selectedByDevice.entries()) {
        const device = devices.find((item) => item.id === deviceId);
        if (!device) continue;
        const interfaces = [...(device.interfaces || [])];
        rowsForDevice.forEach((row) => {
          if (!interfaces[row.interface_index]) return;
          interfaces[row.interface_index] = {
            ...interfaces[row.interface_index],
            status: nextStatus,
            display_status: nextStatus === 'up' ? 'Connected' : nextStatus === 'disabled' ? 'Disabled' : 'Not connected',
            enabled: nextStatus !== 'disabled',
          };
        });
        let response = await patchDeviceInterfaces(auth, deviceId, interfaces);
        if (response === 'unauthorized') {
          localStorage.removeItem('aims-api-token');
          auth = await ensureToken(true);
          response = await patchDeviceInterfaces(auth, deviceId, interfaces);
        }
        if (response === 'unauthorized') throw new Error('Unable to authenticate.');
      }
      await load();
      setSelectedIds([]);
      setMessage(`${selectedRows.length} selected interfaces updated.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update selected interfaces.');
    } finally {
      setBulkSaving(false);
    }
  };
  const changeSort = (field: InterfaceSortField) => {
    if (sortField === field) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortField(field);
    setSortDirection('asc');
  };
  const sortHeader = (field: InterfaceSortField, label: string) => (
    <button type="button" className={`sort-header ${sortField === field ? 'active' : ''}`} onClick={() => changeSort(field)}>
      {label}{sortField === field ? ` (${sortDirection})` : ''}
    </button>
  );

  const updateForm = (field: keyof InterfaceForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const saveInterface = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const device = devices.find((item) => item.id === editing.device_id);
    if (!device) {
      setMessage('Parent device was not found. Refresh interfaces and try again.');
      return;
    }
    const interfaces = [...(device.interfaces || [])];
    if (!interfaces[editing.interface_index]) {
      setMessage('Interface was not found on the parent device. Refresh interfaces and try again.');
      return;
    }
    interfaces[editing.interface_index] = interfaceFormToPayload(form);
    setSaving(true);
    try {
      let auth = await ensureToken();
      let response = await patchDeviceInterfaces(auth, device.id, interfaces);
      if (response === 'unauthorized') {
        localStorage.removeItem('aims-api-token');
        auth = await ensureToken(true);
        response = await patchDeviceInterfaces(auth, device.id, interfaces);
      }
      if (response === 'unauthorized') throw new Error('Unable to authenticate.');
      await load();
      setEditing(null);
      setMessage(`Interface ${form.name.trim() || editing.name} updated.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update interface.');
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="content interfaces-page">
        <div className="page-title">
          <div>
            <button className="back-link" onClick={() => setEditing(null)}><ArrowLeft size={14} /> Interfaces</button>
            <h1>Edit Interface</h1>
            <p>{editing.device_name} / {editing.name}</p>
          </div>
          <button className="plain-button" onClick={load}><RefreshCw size={16} /> Refresh</button>
        </div>

        {message && <div className="module-notice inventory-notice">{message}<button onClick={() => setMessage('')}><X size={15} /></button></div>}

        <form className="card interface-edit-card" onSubmit={saveInterface}>
          <div className="form-header">
            <div>
              <h2>{editing.name}</h2>
              <p>{editing.device_name} | {editing.device_ip || 'No management IP'} | {editing.site || 'Unassigned'}</p>
            </div>
          </div>

          <div className="form-section">
            <h3>Interface</h3>
            <div className="form-grid">
              <label>Name<input value={form.name} onChange={(event) => updateForm('name', event.target.value)} required /></label>
              <label>Label<input value={form.label} onChange={(event) => updateForm('label', event.target.value)} /></label>
              <label>Status
                <select value={form.status} onChange={(event) => updateForm('status', event.target.value)}>
                  <option value="up">Up</option>
                  <option value="down">Down</option>
                  <option value="disabled">Disabled</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <label>Enabled
                <select value={form.enabled} onChange={(event) => updateForm('enabled', event.target.value)}>
                  <option value="">Auto</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
              <label>Mode<input value={form.mode} onChange={(event) => updateForm('mode', event.target.value)} placeholder="access, trunk, routed" /></label>
              <label>Type<input value={form.type} onChange={(event) => updateForm('type', event.target.value)} /></label>
              <label>Parent<input value={form.parent} onChange={(event) => updateForm('parent', event.target.value)} /></label>
              <label>LAG<input value={form.lag} onChange={(event) => updateForm('lag', event.target.value)} /></label>
            </div>
          </div>

          <div className="form-section">
            <h3>Addressing and Hardware</h3>
            <div className="form-grid">
              <label>Primary IP<input value={form.ip} onChange={(event) => updateForm('ip', event.target.value)} /></label>
              <label>IP addresses<input value={form.ip_addresses} onChange={(event) => updateForm('ip_addresses', event.target.value)} placeholder="Comma separated" /></label>
              <label>MAC address<input value={form.mac} onChange={(event) => updateForm('mac', event.target.value)} /></label>
              <label>Speed Mbps<input type="number" min="0" value={form.speed} onChange={(event) => updateForm('speed', event.target.value)} /></label>
              <label>MTU<input type="number" min="0" value={form.mtu} onChange={(event) => updateForm('mtu', event.target.value)} /></label>
            </div>
          </div>

          <div className="form-section">
            <h3>Connection</h3>
            <div className="form-grid">
              <label>Cable<input value={form.cable} onChange={(event) => updateForm('cable', event.target.value)} /></label>
              <label>Connection<input value={form.connection} onChange={(event) => updateForm('connection', event.target.value)} /></label>
              <label>Connected device<input value={form.connection_device_name} onChange={(event) => updateForm('connection_device_name', event.target.value)} /></label>
              <label className="full">Description<textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} /></label>
            </div>
          </div>

          <div className="form-actions">
            <button type="button" onClick={() => setEditing(null)}>Cancel</button>
            <button className="add" type="submit" disabled={saving}><Save size={15} /> {saving ? 'Saving...' : 'Save interface'}</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="content interfaces-page">
      <div className="page-title">
        <div>
          <h1>Interfaces</h1>
          <p>Search and review interface status, addressing, VLAN mode, cabling, and discovered connections.</p>
        </div>
        <button className="plain-button" onClick={load}><RefreshCw size={16} /> {loading ? 'Refreshing...' : 'Refresh'}</button>
      </div>

      {message && <div className="module-notice inventory-notice">{message}<button onClick={() => setMessage('')}><X size={15} /></button></div>}

      <div className="interface-summary">
        <div><Cable size={18} /><p>Total interfaces</p><b>{stats.total}</b></div>
        <div><Cable size={18} /><p>Up / connected</p><b>{stats.up}</b></div>
        <div><Cable size={18} /><p>Down / disabled</p><b>{stats.down}</b></div>
        <div><Cable size={18} /><p>Cabled links</p><b>{stats.connected}</b></div>
      </div>

      <section className="card inventory advanced-card interfaces-card">
        {selectedIds.length > 0 && (
          <div className="bulk-toolbar">
            <b>{selectedIds.length} selected</b>
            <button className="plain-button" disabled={bulkSaving || !selectedRows.length} onClick={() => selectedRows[0] && openEdit(selectedRows[0])}>Edit first</button>
            <button className="plain-button" disabled={bulkSaving || !selectedRows.length} onClick={exportSelectedInterfaces}>Export selected</button>
            <button className="plain-button" disabled={bulkSaving || !selectedRows.length} onClick={() => bulkSetInterfaceStatus('up')}>Mark up</button>
            <button className="plain-button" disabled={bulkSaving || !selectedRows.length} onClick={() => bulkSetInterfaceStatus('down')}>Mark down</button>
            <button className="plain-button danger-button" disabled={bulkSaving || !selectedRows.length} onClick={() => bulkSetInterfaceStatus('disabled')}>Disable selected</button>
            <button className="plain-button" disabled={bulkSaving} onClick={() => setSelectedIds([])}>Clear</button>
          </div>
        )}
        <div className="inventory-head">
          <div className="card-title">Interface Inventory <small>{filtered.length} shown</small></div>
          <div className="inventory-controls">
            <div className="table-search">
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search interface, device, IP, MAC, cable..." />
            </div>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All states</option>
              <option value="up">Up</option>
              <option value="down">Down</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" checked={allFilteredSelected} onChange={toggleFilteredSelected} aria-label="Select all visible interfaces" /></th>
                <th>{sortHeader('device', 'DEVICE')}</th>
                <th>{sortHeader('interface', 'INTERFACE')}</th>
                <th>{sortHeader('state', 'STATE')}</th>
                <th>{sortHeader('ip', 'IP ADDRESSES')}</th>
                <th>{sortHeader('mode', 'MODE')}</th>
                <th>{sortHeader('mac', 'MAC / TYPE')}</th>
                <th>{sortHeader('cable', 'CABLE')}</th>
                <th>{sortHeader('connection', 'CONNECTION')}</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {!filtered.length ? (
                <tr><td colSpan={10} className="empty">No interfaces found. Run Auto Scan or ingest device configuration to populate interface details.</td></tr>
              ) : filtered.map((row) => (
                <tr key={row.id}>
                  <td><input type="checkbox" checked={selectedIds.includes(row.id)} onChange={() => toggleInterfaceSelected(row.id)} aria-label={`Select ${row.device_name} ${row.name}`} /></td>
                  <td><b>{row.device_name}</b><small>{row.device_ip || '-'} | {row.site || 'Unassigned'}</small></td>
                  <td><b>{row.name}</b><small>{row.label || row.description || '-'}</small></td>
                  <td><span className={`status ${interfaceState(row) === 'up' ? 'active' : interfaceState(row) === 'down' ? 'offline' : 'maintenance'}`}>{row.display_status || row.status || 'Unknown'}</span></td>
                  <td><InterfaceIps row={row} /></td>
                  <td><b>{row.mode || '-'}</b><small>{row.parent ? `Parent ${row.parent}` : row.lag ? `LAG ${row.lag}` : '-'}</small></td>
                  <td><b>{row.mac || '-'}</b><small>{[row.type, row.speed ? `${row.speed} Mbps` : '', row.mtu ? `MTU ${row.mtu}` : ''].filter(Boolean).join(' | ') || '-'}</small></td>
                  <td>{row.cable || '-'}</td>
                  <td><b>{row.connection_device_name || '-'}</b><small>{row.connection || '-'}</small></td>
                  <td><button className="row-action" onClick={() => openEdit(row)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
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

function sortInterfaceRows(rows: InterfaceRow[], field: InterfaceSortField, direction: SortDirection) {
  return [...rows].sort((a, b) => compareSortValues(interfaceSortValue(a, field), interfaceSortValue(b, field), direction));
}

function interfaceSortValue(row: InterfaceRow, field: InterfaceSortField) {
  if (field === 'device') return row.device_name;
  if (field === 'interface') return row.name;
  if (field === 'state') return row.display_status || row.status || interfaceState(row);
  if (field === 'ip') return [...(row.ip_addresses || []), row.ip || ''].filter(Boolean).join(' ');
  if (field === 'mode') return row.mode || '';
  if (field === 'mac') return [row.mac, row.type, row.speed].filter(Boolean).join(' ');
  if (field === 'cable') return row.cable || '';
  if (field === 'connection') return [row.connection_device_name, row.connection].filter(Boolean).join(' ');
  return '';
}

function compareSortValues(a: unknown, b: unknown, direction: SortDirection) {
  const multiplier = direction === 'asc' ? 1 : -1;
  if (typeof a === 'number' || typeof b === 'number') return ((Number(a) || 0) - (Number(b) || 0)) * multiplier;
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' }) * multiplier;
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

async function patchDeviceInterfaces(auth: string, deviceId: number, interfaces: DeviceInterface[]): Promise<Device | 'unauthorized'> {
  const response = await fetch(`${api}/devices/${deviceId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ interfaces }),
  });
  if (response.status === 401) return 'unauthorized';
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to update interface.');
  return json.data as Device;
}

function flattenInterfaces(devices: Device[]): InterfaceRow[] {
  return devices.flatMap((device) => (device.interfaces || [])
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !isVlanInterface(item))
    .map(({ item, index }) => ({
      ...item,
      id: `${device.id}:${index}:${item.name || 'interface'}`,
      interface_index: index,
      device_id: device.id,
      device_name: device.name,
      device_ip: device.management_ip,
      device_role: device.role,
      device_status: device.status,
      site: device.site?.name || '',
    })));
}

function interfaceState(row: DeviceInterface) {
  const value = String(row.display_status || row.status || '').toLowerCase();
  if (row.enabled === false || value.includes('down') || value.includes('disabled')) return 'down';
  if (value.includes('up') || value.includes('connected')) return 'up';
  return 'unknown';
}

function isVlanInterface(item: DeviceInterface) {
  const name = String(item.name || '').trim().toLowerCase();
  const type = String(item.type || '').trim().toLowerCase();
  return /^vlan\s*\d+/.test(name) || type === 'vlan' || type === 'svi';
}

function emptyInterfaceForm(): InterfaceForm {
  return {
    name: '',
    label: '',
    status: 'up',
    enabled: '',
    ip_addresses: '',
    ip: '',
    mac: '',
    type: '',
    speed: '',
    mtu: '',
    parent: '',
    lag: '',
    mode: '',
    description: '',
    cable: '',
    connection: '',
    connection_device_name: '',
  };
}

function rowToForm(row: InterfaceRow): InterfaceForm {
  return {
    name: row.name || '',
    label: row.label || '',
    status: row.status || row.display_status || 'up',
    enabled: row.enabled === undefined ? '' : String(Boolean(row.enabled)),
    ip_addresses: (row.ip_addresses || []).join(', '),
    ip: row.ip || '',
    mac: row.mac || '',
    type: row.type || '',
    speed: row.speed ? String(row.speed) : '',
    mtu: row.mtu ? String(row.mtu) : '',
    parent: row.parent || '',
    lag: row.lag || '',
    mode: row.mode || '',
    description: row.description || '',
    cable: row.cable || '',
    connection: row.connection || '',
    connection_device_name: row.connection_device_name || '',
  };
}

function interfaceFormToPayload(form: InterfaceForm): DeviceInterface {
  const payload: DeviceInterface = {
    name: form.name.trim(),
    status: form.status,
    ip: form.ip.trim(),
    label: form.label.trim(),
    mac: form.mac.trim(),
    type: form.type.trim(),
    parent: form.parent.trim(),
    lag: form.lag.trim(),
    mode: form.mode.trim(),
    description: form.description.trim(),
    cable: form.cable.trim(),
    connection: form.connection.trim(),
    connection_device_name: form.connection_device_name.trim(),
    ip_addresses: splitCsv(form.ip_addresses),
  };
  if (form.enabled) payload.enabled = form.enabled === 'true';
  if (form.speed) payload.speed = Number(form.speed);
  if (form.mtu) payload.mtu = Number(form.mtu);
  return payload;
}

function splitCsv(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function InterfaceIps({ row }: { row: DeviceInterface }) {
  const values = row.ip_addresses?.length ? row.ip_addresses : row.ip ? [row.ip] : [];
  if (!values.length) return <span>-</span>;
  return <div className="interface-ip-list">{values.map((value) => <span key={value}>{value}</span>)}</div>;
}
