import { FormEvent, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { BatteryCharging, Boxes, CircleHelp, Cpu, Database, HardDrive, Image as ImageIcon, MonitorCog, Network, Phone, PlugZap, Plus, RadioTower, Router, Search, Server, Shield, Thermometer, Trash2, Wifi, X, Zap } from 'lucide-react';

export const DEVICE_TYPES_STORAGE_KEY = 'aims-device-types';
const DEVICE_TYPES_API = `${window.location.protocol}//${window.location.hostname}:8001/api/v1/infrastructure/Device%20Types`;
let cachedDeviceTypes: DeviceTypeRecord[] = [];

export type DeviceTypeRecord = {
  id: string;
  manufacturer: string;
  model: string;
  slug: string;
  default_platform: string;
  description: string;
  tags: string;
  height_u: number;
  part_number: string;
  full_depth: boolean;
  exclude_from_utilization: boolean;
  parent_child_status: string;
  airflow: string;
  weight: string;
  weight_unit: string;
  default_power_w: string;
  front_panel_kind: string;
  icon_key: string;
  front_panel_ports: number;
  front_panel_uplinks: number;
  front_panel_power_bays: number;
  front_panel_notes: string;
  front_image: string;
  rear_image: string;
  owner_group: string;
  owner: string;
  comments: string;
  updated_at: string;
};

type DeviceTypeForm = Omit<DeviceTypeRecord, 'id' | 'updated_at'>;
export type DeviceTypeIconKey = 'switch' | 'router' | 'firewall' | 'wireless_controller' | 'access_point' | 'server' | 'storage' | 'ip_phone' | 'workstation' | 'ups' | 'pdu' | 'database' | 'temperature' | 'power' | 'compute' | 'generic';

export const DEVICE_TYPE_ICON_OPTIONS: { key: DeviceTypeIconKey; label: string; Icon: LucideIcon; tone: string }[] = [
  { key: 'switch', label: 'Switch', Icon: Network, tone: 'blue' },
  { key: 'router', label: 'Router', Icon: Router, tone: 'cyan' },
  { key: 'firewall', label: 'Firewall', Icon: Shield, tone: 'red' },
  { key: 'wireless_controller', label: 'Wireless controller', Icon: RadioTower, tone: 'green' },
  { key: 'access_point', label: 'Access point', Icon: Wifi, tone: 'green' },
  { key: 'server', label: 'Server', Icon: Server, tone: 'purple' },
  { key: 'storage', label: 'Storage', Icon: HardDrive, tone: 'purple' },
  { key: 'ip_phone', label: 'IP phone', Icon: Phone, tone: 'green' },
  { key: 'workstation', label: 'Workstation', Icon: MonitorCog, tone: 'green' },
  { key: 'ups', label: 'UPS', Icon: BatteryCharging, tone: 'orange' },
  { key: 'pdu', label: 'PDU / power', Icon: PlugZap, tone: 'orange' },
  { key: 'database', label: 'Database', Icon: Database, tone: 'purple' },
  { key: 'temperature', label: 'Temperature', Icon: Thermometer, tone: 'orange' },
  { key: 'power', label: 'Power sensor', Icon: Zap, tone: 'orange' },
  { key: 'compute', label: 'Compute', Icon: Cpu, tone: 'purple' },
  { key: 'generic', label: 'Generic', Icon: CircleHelp, tone: 'blue' },
];

const emptyTypeForm: DeviceTypeForm = {
  manufacturer: '',
  model: '',
  slug: '',
  default_platform: '',
  description: '',
  tags: '',
  height_u: 1,
  part_number: '',
  full_depth: true,
  exclude_from_utilization: false,
  parent_child_status: '',
  airflow: '',
  weight: '',
  weight_unit: 'kg',
  default_power_w: '',
  front_panel_kind: '',
  icon_key: '',
  front_panel_ports: 0,
  front_panel_uplinks: 0,
  front_panel_power_bays: 0,
  front_panel_notes: '',
  front_image: '',
  rear_image: '',
  owner_group: '',
  owner: '',
  comments: '',
};

export function loadDeviceTypes(): DeviceTypeRecord[] {
  return cachedDeviceTypes;
}

export function saveDeviceTypes(rows: DeviceTypeRecord[]) {
  cachedDeviceTypes = rows;
  window.dispatchEvent(new Event('aims:device-types-changed'));
}

async function loadDeviceTypesFromBackend(token: string) {
  const response = await fetch(DEVICE_TYPES_API, { headers: { Authorization: `Bearer ${token}` } });
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load device types.');
  const rows = Array.isArray(json.data?.records) ? json.data.records : [];
  const normalized = rows.map((row: DeviceTypeRecord) => ({ ...row, exclude_from_utilization: Boolean(row.exclude_from_utilization), icon_key: normalizeDeviceTypeIconKey(row.icon_key) || '' }));
  saveDeviceTypes(normalized);
  return normalized;
}

async function saveDeviceTypesToBackend(token: string, rows: DeviceTypeRecord[]) {
  const response = await fetch(DEVICE_TYPES_API, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records: rows }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.detail || json.message || 'Unable to save device types.');
  saveDeviceTypes(rows);
}

export function deviceTypeLabel(type: DeviceTypeRecord) {
  return [type.manufacturer, type.model].filter(Boolean).join(' ') || type.slug || 'Unnamed type';
}

export function slugifyDeviceType(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function normalizeDeviceTypeIconKey(value: unknown): DeviceTypeIconKey | '' {
  const normalized = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  return DEVICE_TYPE_ICON_OPTIONS.some((option) => option.key === normalized) ? normalized as DeviceTypeIconKey : '';
}

export function deviceTypeIconKeyFor(type: Partial<DeviceTypeRecord>): DeviceTypeIconKey {
  const explicit = normalizeDeviceTypeIconKey(type.icon_key);
  if (explicit) return explicit;
  const frontPanelKind = String(type.front_panel_kind || '').trim().toLowerCase();
  if (frontPanelKind === 'switch') return 'switch';
  if (frontPanelKind === 'router') return 'router';
  if (frontPanelKind === 'firewall') return 'firewall';
  if (frontPanelKind === 'server') return 'server';
  if (frontPanelKind === 'storage') return 'storage';
  if (frontPanelKind === 'access_point') return 'access_point';
  if (frontPanelKind === 'ip_phone') return 'ip_phone';
  if (frontPanelKind === 'workstation') return 'workstation';
  if (frontPanelKind === 'ups') return 'ups';
  if (frontPanelKind === 'pdu') return 'pdu';
  const text = [type.manufacturer, type.model, type.slug, type.default_platform, type.description, type.tags, type.front_panel_notes].join(' ').toLowerCase();
  if (text.includes('firewall') || text.includes('fortigate') || text.includes('security')) return 'firewall';
  if (text.includes('wireless controller') || text.includes('controller')) return 'wireless_controller';
  if (text.includes('access point') || text.includes('wifi') || text.includes('wireless') || text.includes('ruckus') || /\bap\b/.test(text)) return 'access_point';
  if (text.includes('router') || text.includes('gateway')) return 'router';
  if (text.includes('switch') || text.includes('catalyst')) return 'switch';
  if (text.includes('database')) return 'database';
  if (text.includes('server') || text.includes('virtual machine') || text.includes(' vm ') || text.includes('compute')) return 'server';
  if (text.includes('storage') || text.includes('nas') || text.includes('san')) return 'storage';
  if (text.includes('phone') || text.includes('voice')) return 'ip_phone';
  if (text.includes('workstation') || text.includes('pc') || text.includes('desktop')) return 'workstation';
  if (text.includes('temperature') || text.includes('temp')) return 'temperature';
  if (text.includes('ups')) return 'ups';
  if (text.includes('pdu') || text.includes('power')) return 'pdu';
  return 'generic';
}

export function deviceTypeIconLabel(iconKey: string) {
  return DEVICE_TYPE_ICON_OPTIONS.find((option) => option.key === normalizeDeviceTypeIconKey(iconKey))?.label || 'Generic';
}

export function deviceTypeIconTone(iconKey: string) {
  return DEVICE_TYPE_ICON_OPTIONS.find((option) => option.key === normalizeDeviceTypeIconKey(iconKey))?.tone || 'blue';
}

export function DeviceTypeIconGlyph({ iconKey, size = 15 }: { iconKey: string; size?: number }) {
  const Icon = DEVICE_TYPE_ICON_OPTIONS.find((option) => option.key === normalizeDeviceTypeIconKey(iconKey))?.Icon || CircleHelp;
  return <Icon size={size} />;
}

export function DeviceTypeCover({ iconKey, label, compact = false }: { iconKey: string; label?: string; compact?: boolean }) {
  const normalized = normalizeDeviceTypeIconKey(iconKey) || 'generic';
  const display = label || deviceTypeIconLabel(normalized);
  return (
    <div className={`device-type-cover cover-${normalized}${compact ? ' compact' : ''}`}>
      <div className="cover-shell">
        <div className="cover-brand"><DeviceTypeIconGlyph iconKey={normalized} size={compact ? 15 : 20} /><b>{display}</b></div>
        <div className="cover-visual">
          <span /><span /><span /><span /><span /><span /><span /><span />
        </div>
        <div className="cover-leds"><i /><i /><i /></div>
      </div>
    </div>
  );
}

export function DeviceTypesPage() {
  const [rows, setRows] = useState<DeviceTypeRecord[]>(() => loadDeviceTypes());
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<DeviceTypeRecord | null>(null);
  const [form, setForm] = useState<DeviceTypeForm>(emptyTypeForm);
  const [showForm, setShowForm] = useState(false);
  const [commentMode, setCommentMode] = useState<'write' | 'preview'>('write');
  const [message, setMessage] = useState('');
  const token = localStorage.getItem('aims-api-token') || '';

  useEffect(() => {
    if (!token) return;
    loadDeviceTypesFromBackend(token).then(setRows).catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load device types.'));
  }, [token]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(needle));
  }, [query, rows]);

  const openForm = (row?: DeviceTypeRecord) => {
    setEditing(row || null);
    setForm(row ? {
      manufacturer: row.manufacturer,
      model: row.model,
      slug: row.slug,
      default_platform: row.default_platform,
      description: row.description,
      tags: row.tags,
      height_u: row.height_u || 1,
      part_number: row.part_number,
      full_depth: row.full_depth !== false,
      exclude_from_utilization: Boolean(row.exclude_from_utilization),
      parent_child_status: row.parent_child_status,
      airflow: row.airflow,
      weight: row.weight,
      weight_unit: row.weight_unit || 'kg',
      default_power_w: row.default_power_w,
      front_panel_kind: row.front_panel_kind || '',
      icon_key: normalizeDeviceTypeIconKey(row.icon_key) || '',
      front_panel_ports: Number(row.front_panel_ports || 0),
      front_panel_uplinks: Number(row.front_panel_uplinks || 0),
      front_panel_power_bays: Number(row.front_panel_power_bays || 0),
      front_panel_notes: row.front_panel_notes || '',
      front_image: row.front_image,
      rear_image: row.rear_image,
      owner_group: row.owner_group,
      owner: row.owner,
      comments: row.comments,
    } : emptyTypeForm);
    setCommentMode('write');
    setShowForm(true);
  };

  const updateForm = (field: keyof DeviceTypeForm, value: string | number | boolean) => {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if ((field === 'manufacturer' || field === 'model') && !current.slug) {
        next.slug = slugifyDeviceType(`${field === 'manufacturer' ? value : current.manufacturer} ${field === 'model' ? value : current.model}`);
      }
      return next;
    });
  };

  const updateImage = (field: 'front_image' | 'rear_image', file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateForm(field, String(reader.result || ''));
    reader.readAsDataURL(file);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const slug = slugifyDeviceType(form.slug || `${form.manufacturer} ${form.model}`);
    if (!slug) return;
    const record: DeviceTypeRecord = {
      ...form,
      slug,
      height_u: Math.max(0.5, Number(form.height_u || 1)),
      full_depth: form.full_depth !== false,
      exclude_from_utilization: Boolean(form.exclude_from_utilization),
      icon_key: normalizeDeviceTypeIconKey(form.icon_key) || '',
      front_panel_ports: Math.max(0, Number(form.front_panel_ports || 0)),
      front_panel_uplinks: Math.max(0, Number(form.front_panel_uplinks || 0)),
      front_panel_power_bays: Math.max(0, Number(form.front_panel_power_bays || 0)),
      id: editing?.id || crypto.randomUUID(),
      updated_at: new Date().toISOString(),
    };
    const next = editing
      ? rows.map((row) => row.id === editing.id ? record : row)
      : [record, ...rows.filter((row) => row.slug !== slug)];
    try {
      if (!token) throw new Error('Sign in before saving device types.');
      await saveDeviceTypesToBackend(token, next);
      setRows(next);
      setMessage('Device type saved.');
      setShowForm(false);
      setEditing(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save device type.');
    }
  };

  const remove = async (row: DeviceTypeRecord) => {
    const next = rows.filter((item) => item.id !== row.id);
    try {
      if (!token) throw new Error('Sign in before deleting device types.');
      await saveDeviceTypesToBackend(token, next);
      setRows(next);
      setMessage('Device type deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete device type.');
    }
  };
  const activeIconKey = deviceTypeIconKeyFor(form);

  return (
    <div className="content device-types-page">
      <div className="page-title">
        <div>
          <h1>Device Types</h1>
          <p>Reusable hardware profiles for devices that share the same chassis, images, airflow, power, and ownership defaults.</p>
        </div>
        <button className="add" onClick={() => openForm()}><Plus size={17} /> Add type</button>
      </div>
      {message && <div className="module-notice">{message}</div>}

      <div className="device-type-summary">
        <div><Boxes size={18} /><p>Total types</p><b>{rows.length}</b></div>
        <div><ImageIcon size={18} /><p>With images</p><b>{rows.filter((row) => row.front_image || row.rear_image).length}</b></div>
        <div><Boxes size={18} /><p>Manufacturers</p><b>{new Set(rows.map((row) => row.manufacturer).filter(Boolean)).size}</b></div>
      </div>

      <section className="card inventory device-type-table">
        <div className="inventory-head">
          <div className="card-title">Device type library <small>{visible.length} shown</small></div>
          <div className="table-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search manufacturer, model, slug..." /></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Icon</th><th>Chassis</th><th>Front panel</th><th>Depth</th><th>Platform</th><th>Power</th><th>Ownership</th><th>Images</th><th>Actions</th></tr></thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td><button className="device-link" onClick={() => openForm(row)}>{deviceTypeLabel(row)}</button><small>{row.slug}</small><small>{row.description || 'No description'}</small></td>
                  <td><DeviceTypeCover iconKey={deviceTypeIconKeyFor(row)} label={deviceTypeIconLabel(deviceTypeIconKeyFor(row))} compact /><small>{row.icon_key ? deviceTypeIconLabel(row.icon_key) : `Auto: ${deviceTypeIconLabel(deviceTypeIconKeyFor(row))}`}</small></td>
                  <td><b>{row.height_u || 1}U</b><small>{row.part_number || 'No part number'} | {row.airflow || 'Airflow unset'}</small></td>
                  <td><b>{frontPanelKindLabel(row.front_panel_kind)}</b><small>{frontPanelSummary(row)}</small></td>
                  <td>{row.full_depth === false ? <span className="status planned">No</span> : <span className="status active">Yes</span>}</td>
                  <td>{row.default_platform || '-'}</td>
                  <td>{row.default_power_w ? `${row.default_power_w} W` : '-'}</td>
                  <td>{[row.owner_group, row.owner].filter(Boolean).join(' / ') || '-'}</td>
                  <td>{row.front_image || row.rear_image ? <span className="status active">Assigned</span> : <span className="status planned">None</span>}</td>
                  <td><button className="row-action" onClick={() => openForm(row)}>Edit</button><button className="row-action danger" onClick={() => remove(row)}><Trash2 size={12} /> Delete</button></td>
                </tr>
              ))}
              {!visible.length && <tr><td colSpan={10} className="empty">No device types yet. Add a type to reuse it during device creation.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {showForm && (
        <div className="modal-backdrop" onMouseDown={() => setShowForm(false)}>
          <form className="device-form large device-type-form" onSubmit={save} onMouseDown={(event) => event.stopPropagation()}>
            <div className="form-header">
              <div>
                <h2>{editing ? 'Edit device type' : 'Add device type'}</h2>
                <p>These defaults are applied when a matching type is selected on a device.</p>
              </div>
              <button type="button" onClick={() => setShowForm(false)}><X /></button>
            </div>

            <div className="form-section">
              <h3>Identity</h3>
              <div className="form-grid">
                <label>Manufacturer<input required value={form.manufacturer} onChange={(event) => updateForm('manufacturer', event.target.value)} /></label>
                <label>Model<input required value={form.model} onChange={(event) => updateForm('model', event.target.value)} /></label>
                <label>Slug<small>URL-friendly unique shorthand</small><input required value={form.slug} onChange={(event) => updateForm('slug', slugifyDeviceType(event.target.value))} /></label>
                <label>Default platform<input value={form.default_platform} onChange={(event) => updateForm('default_platform', event.target.value)} /></label>
                <label className="full">Description<textarea value={form.description} onChange={(event) => updateForm('description', event.target.value)} /></label>
                <label className="full">Tags<input value={form.tags} onChange={(event) => updateForm('tags', event.target.value)} placeholder="switch,campus,poe" /></label>
              </div>
            </div>

            <div className="form-section">
              <h3>Chassis</h3>
              <div className="form-grid">
                <label>Height (U)<input type="number" min="0.5" step="0.5" value={form.height_u} onChange={(event) => updateForm('height_u', Number(event.target.value))} /></label>
                <label>Part number<small>Discrete part number (optional)</small><input value={form.part_number} onChange={(event) => updateForm('part_number', event.target.value)} /></label>
                <label>Full depth<select value={form.full_depth === false ? 'No' : 'Yes'} onChange={(event) => updateForm('full_depth', event.target.value === 'Yes')}><option>Yes</option><option>No</option></select><small>Only full-depth devices appear in the rack back view.</small></label>
                <label>Parent/child status<select value={form.parent_child_status} onChange={(event) => updateForm('parent_child_status', event.target.value)}><option value="">---------</option><option>Parent</option><option>Child</option><option>Neither</option></select><small>Parent devices house child devices in device bays. Leave blank if this device type is neither a parent nor a child.</small></label>
                <label>Airflow<select value={form.airflow} onChange={(event) => updateForm('airflow', event.target.value)}><option value="">---------</option><option>Front to rear</option><option>Rear to front</option><option>Side to side</option><option>Passive</option><option>Mixed</option></select></label>
                <label>Weight<input value={form.weight} onChange={(event) => updateForm('weight', event.target.value)} /></label>
                <label>Weight unit<select value={form.weight_unit} onChange={(event) => updateForm('weight_unit', event.target.value)}><option>kg</option><option>lb</option></select></label>
                <label>Manual power consumption (W)<input type="number" min="0" value={form.default_power_w} onChange={(event) => updateForm('default_power_w', event.target.value)} /></label>
                <label className="toggle-row device-type-toggle full"><span><b>Exclude from utilization</b><small>Devices of this type are excluded when calculating rack utilization.</small></span><input type="checkbox" checked={form.exclude_from_utilization} onChange={(event) => updateForm('exclude_from_utilization', event.target.checked)} /></label>
              </div>
            </div>

            <div className="form-section">
              <h3>Front Panel</h3>
              <p className="field-help">These answers let AIMS draw the correct device faceplate when a real front image has not been uploaded.</p>
              <div className="form-grid">
                <label>Front panel role<select value={form.front_panel_kind} onChange={(event) => updateForm('front_panel_kind', event.target.value)}><option value="">Auto detect from role/model</option><option value="switch">Switch</option><option value="router">Router</option><option value="firewall">Firewall</option><option value="server">Server</option><option value="access_point">Wireless AP</option><option value="ip_phone">IP phone</option><option value="workstation">PC / workstation</option><option value="ups">UPS</option><option value="pdu">PDU</option><option value="storage">Storage</option><option value="generic">Generic appliance</option></select></label>
                <label>Device icon<select value={form.icon_key} onChange={(event) => updateForm('icon_key', event.target.value)}><option value="">Auto: {deviceTypeIconLabel(activeIconKey)}</option>{DEVICE_TYPE_ICON_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select><small>Used anywhere this device type appears.</small></label>
                <div className="device-type-icon-picker full">
                  {DEVICE_TYPE_ICON_OPTIONS.map((option) => (
                    <button type="button" key={option.key} className={activeIconKey === option.key ? 'active' : ''} onClick={() => updateForm('icon_key', option.key)} title={option.label}>
                      <option.Icon size={17} />
                      <span>{option.label}</span>
                    </button>
                  ))}
                  {form.icon_key && <button type="button" onClick={() => updateForm('icon_key', '')}><CircleHelp size={17} /><span>Auto</span></button>}
                </div>
                <div className="device-type-cover-preview full">
                  <DeviceTypeCover iconKey={activeIconKey} label={deviceTypeIconLabel(activeIconKey)} />
                  <div>
                    <b>{deviceTypeIconLabel(activeIconKey)} cover</b>
                    <span>{form.icon_key ? 'Manual icon selection' : 'Auto suggested from this device type profile'}</span>
                    <small>Devices using this type inherit this visual identity automatically.</small>
                  </div>
                </div>
                <label>Network ports<input type="number" min="0" value={form.front_panel_ports} onChange={(event) => updateForm('front_panel_ports', Number(event.target.value))} /><small>Use 0 to infer from model/interfaces.</small></label>
                <label>Uplink / SFP ports<input type="number" min="0" value={form.front_panel_uplinks} onChange={(event) => updateForm('front_panel_uplinks', Number(event.target.value))} /><small>Switches and modular routers only.</small></label>
                <label>Power / PSU bays<input type="number" min="0" value={form.front_panel_power_bays} onChange={(event) => updateForm('front_panel_power_bays', Number(event.target.value))} /></label>
                <label className="full">Front-panel notes<input value={form.front_panel_notes} onChange={(event) => updateForm('front_panel_notes', event.target.value)} placeholder="Example: 24 copper ports, 4 SFP uplinks, dual PSU" /></label>
              </div>
            </div>

            <div className="form-section">
              <h3>Images</h3>
              <div className="device-type-image-grid">
                <ImageInput label="Front image" value={form.front_image} onChange={(file) => updateImage('front_image', file)} onClear={() => updateForm('front_image', '')} />
                <ImageInput label="Rear image" value={form.rear_image} onChange={(file) => updateImage('rear_image', file)} onClear={() => updateForm('rear_image', '')} />
              </div>
            </div>

            <div className="form-section">
              <h3>Ownership</h3>
              <div className="form-grid">
                <label>Owner group<input value={form.owner_group} onChange={(event) => updateForm('owner_group', event.target.value)} /></label>
                <label>Owner<input value={form.owner} onChange={(event) => updateForm('owner', event.target.value)} /></label>
              </div>
            </div>

            <div className="form-section">
              <h3>Comments</h3>
              <div className="device-type-tabs"><button type="button" className={commentMode === 'write' ? 'active' : ''} onClick={() => setCommentMode('write')}>Write</button><button type="button" className={commentMode === 'preview' ? 'active' : ''} onClick={() => setCommentMode('preview')}>Preview</button></div>
              {commentMode === 'write'
                ? <textarea value={form.comments} onChange={(event) => updateForm('comments', event.target.value)} placeholder="Write comments..." />
                : <div className="device-type-preview">{form.comments || 'Nothing to preview.'}</div>}
            </div>

            <div className="form-actions">
              <button type="button" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="add" type="submit">{editing ? 'Save type' : 'Create type'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function frontPanelKindLabel(kind?: string | null) {
  const labels: Record<string, string> = {
    switch: 'Switch',
    router: 'Router',
    firewall: 'Firewall',
    server: 'Server',
    access_point: 'Wireless AP',
    wireless_controller: 'Wireless controller',
    ip_phone: 'IP phone',
    workstation: 'PC / workstation',
    ups: 'UPS',
    pdu: 'PDU',
    storage: 'Storage',
    database: 'Database',
    temperature: 'Temperature sensor',
    power_sensor: 'Power sensor',
    compute: 'Compute',
    generic: 'Generic appliance',
  };
  return labels[String(kind || '')] || 'Auto';
}

function frontPanelSummary(row: DeviceTypeRecord) {
  return [
    row.front_panel_ports ? `${row.front_panel_ports} ports` : '',
    row.front_panel_uplinks ? `${row.front_panel_uplinks} uplinks` : '',
    row.front_panel_power_bays ? `${row.front_panel_power_bays} PSU/power` : '',
  ].filter(Boolean).join(' | ') || 'Inferred from role/model';
}

function ImageInput({ label, value, onChange, onClear }: { label: string; value: string; onChange: (file?: File) => void; onClear: () => void }) {
  return (
    <div className="device-type-image">
      <b>{label}</b>
      {value ? <img src={value} alt={label} /> : <span>None assigned</span>}
      <input type="file" accept="image/*" onChange={(event) => onChange(event.target.files?.[0])} />
      {value && <button type="button" className="row-action danger" onClick={onClear}>Clear image</button>}
    </div>
  );
}
