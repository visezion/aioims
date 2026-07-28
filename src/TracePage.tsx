import { FormEvent, useState } from 'react';
import { Activity, ArrowDown, CheckCircle2, CircleAlert, Cpu, EthernetPort, GitBranch, Link2, MapPinned, RadioTower, Route, ScanSearch, Search, Waypoints } from 'lucide-react';

const api = 'http://127.0.0.1:8001/api/v1';

type TraceVia = {
  device_id: string;
  device_name: string;
  device_port: string;
  port: string;
  protocol: string;
};
type TraceNode = {
  id: string;
  device_id?: number | null;
  name: string;
  ip?: string | null;
  mac_address?: string | null;
  role?: string | null;
  status?: string | null;
  site?: string | null;
  managed?: boolean;
  depth?: number;
  via?: TraceVia | null;
};
type TraceResult = {
  query: string;
  roots: TraceNode[];
  nodes: TraceNode[];
  links: unknown[];
  truncated: boolean;
  live_snmp?: {
    used: boolean;
    partial?: boolean;
    attempted: number;
    target_mac?: string;
    fdb_matches?: number;
    access_switch?: string;
    access_port?: string;
    arp_device?: string;
    arp_interface?: string;
    method?: string;
    fdb_lookup?: string;
    fdb_vlan?: number | null;
    bridge_port?: number | null;
    verified_fdb_hops?: number;
    message?: string;
    errors?: string[];
    auto_ingested?: boolean;
    auto_ingest_created?: boolean;
    auto_ingest_profile?: string;
    auto_ingest_detail?: string;
    auto_ingest_error?: string;
    discovered_neighbors?: string[];
    neighbor_discovery_detail?: string;
    neighbor_discovery_error?: string;
  };
  saved_trace?: {
    saved: boolean;
    last_traced_at?: string | null;
    save_warning?: string;
  };
};

type TraceProgress = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage: string;
  percent: number;
  detail: string;
  query: string;
  result?: TraceResult;
  error?: string;
};

const traceStages = [
  { id: 'topology', label: 'Inventory' },
  { id: 'arp', label: 'ARP lookup' },
  { id: 'mac', label: 'MAC tables' },
  { id: 'neighbors', label: 'Neighbors' },
  { id: 'route', label: 'Route' },
];

function formatTraceDate(value?: string | null) {
  if (!value) return 'just now';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function TracePage() {
  const [token, setToken] = useState(localStorage.getItem('aims-api-token') || '');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<TraceResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<TraceProgress | null>(null);

  const ensureToken = async () => {
    if (token) return token;
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

  const runTrace = async (search: string, refresh = false) => {
    if (!search) {
      setError('Enter a device IP address or MAC address.');
      return;
    }
    setLoading(true);
    setError('');
    if (!refresh) setResult(null);
    setProgress({ id: '', status: 'queued', stage: 'queued', percent: 2, detail: refresh ? 'Queueing live SNMP update' : 'Checking saved trace', query: search });
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/topology/trace/jobs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: search, refresh }),
      });
      const json = await response.json();
      if (!response.ok || !json.data?.id) throw new Error(json.detail || json.message || 'Unable to start the trace.');
      let traceJob = json.data as TraceProgress;
      setProgress(traceJob);

      while (traceJob.status === 'queued' || traceJob.status === 'running') {
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        const statusResponse = await fetch(`${api}/topology/trace/jobs/${traceJob.id}`, {
          headers: { Authorization: `Bearer ${auth}` },
        });
        const statusJson = await statusResponse.json();
        if (!statusResponse.ok || !statusJson.data) throw new Error(statusJson.detail || statusJson.message || 'Unable to read trace progress.');
        traceJob = statusJson.data as TraceProgress;
        setProgress(traceJob);
      }
      if (traceJob.status === 'failed') throw new Error(traceJob.error || traceJob.detail || 'Unable to trace that device.');
      if (!traceJob.result) throw new Error('Trace completed without a route result.');
      setResult(traceJob.result);
    } catch (requestError) {
      setResult(null);
      setError(requestError instanceof Error ? requestError.message : 'Unable to trace that device.');
    } finally {
      setLoading(false);
    }
  };

  const traceDevice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await runTrace(query.trim());
  };

  const updateTrace = async () => {
    await runTrace(result?.query || query.trim(), true);
  };

  const root = result?.roots[0];
  const target = result?.nodes[result.nodes.length - 1];
  const routeNodes = result?.nodes || [];
  const liveTrace = result?.live_snmp;

  return (
    <div className="content trace-page">
      <div className="page-title">
        <div>
          <h1>Device Trace</h1>
          <p>Find a device by IP or MAC address and trace its discovered network connections, ports, and identities.</p>
        </div>
      </div>

      <section className="card trace-search-card">
        <form className="trace-search-form" onSubmit={traceDevice}>
          <label>
            Device IP or MAC address
            <div className="trace-input">
              <Search size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="10.10.0.25 or 00:11:22:33:44:55" autoFocus />
            </div>
          </label>
          <button className="add" type="submit" disabled={loading}><Route size={16} /> {loading ? 'Tracing...' : 'Trace device'}</button>
        </form>
        <p>Trace resolves the IP to a MAC from backbone ARP, locates that MAC in switch forwarding tables, then follows CDP/LLDP topology upstream from the access switch to the backbone.</p>
      </section>

      {loading && (
        <section className="card trace-progress-card" aria-live="polite">
          <div className="trace-progress-head">
            <div><small>LIVE TRACE ACTIVITY</small><h2>{progress?.detail || 'Preparing trace'}</h2><p>Tracking {progress?.query || query.trim()} through routed ARP, switch MAC tables, and CDP/LLDP neighbors.</p></div>
            <b>{Math.min(progress?.percent ?? 2, 100)}%</b>
          </div>
          <div className="trace-progress-track"><i style={{ width: `${Math.min(progress?.percent ?? 2, 100)}%` }} /></div>
          <div className="trace-progress-stages">
            {traceStages.map((stage) => {
              const active = progress?.stage === stage.id;
              const done = (progress?.percent ?? 0) >= (traceStages.findIndex((item) => item.id === stage.id) + 1) * 18 && !active;
              return <div className={`trace-progress-stage ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}`} key={stage.id}><i />{stage.label}</div>;
            })}
          </div>
          <small className="trace-progress-note">If an SNMP request fails or is blocked by an ACL, the trace records it here and continues with the remaining devices.</small>
        </section>
      )}

      {error && <div className="module-notice trace-error"><CircleAlert size={17} />{error}<button onClick={() => setError('')}>x</button></div>}

      {result?.saved_trace && (
        <section className="card trace-saved-bar">
          <div><small>{result.saved_trace.saved ? 'SAVED TRACE' : 'TRACE SAVE WARNING'}</small><b>{result.saved_trace.saved ? `Last traced ${formatTraceDate(result.saved_trace.last_traced_at)}` : result.saved_trace.save_warning}</b></div>
          <button className="trace-update-button" type="button" onClick={updateTrace} disabled={loading}><Route size={15} /> Update Trace</button>
        </section>
      )}

      {result && root && (
        <>
          <section className="trace-summary">
            <div className="trace-root-card">
              <span>{result.live_snmp?.used ? 'SNMP BACKBONE TRACE' : 'BACKBONE ROUTE'}</span>
              <h2>{root.name || root.ip || 'Matched device'}</h2>
              <p>{root.role || 'Device'} {root.managed ? '· Managed inventory' : '· Discovered neighbor'}</p>
            </div>
            <div><p>Backbone IP</p><b>{root.ip || '-'}</b></div>
            <div><p>Located Device</p><b>{target?.name || target?.ip || result.query}</b></div>
            <div><p>Devices Between</p><b>{Math.max(result.nodes.length - 2, 0)}</b></div>
            <div><p>Route Links</p><b>{result.links.length}</b></div>
          </section>

          <section className="trace-result-hero">
            <div className="trace-hero-orbit orbit-one" /><div className="trace-hero-orbit orbit-two" />
            <div className="trace-hero-copy">
              <div className="trace-hero-eyebrow"><ScanSearch size={15} /> {liveTrace?.used ? 'LIVE SNMP PATH VERIFICATION' : 'INVENTORY TOPOLOGY ROUTE'}</div>
              <h2>Route to <span>{target?.ip || result.query}</span></h2>
              <p>Each hop includes the observed switch interface and matching neighbor port.</p>
            </div>
            <div className="trace-hero-status"><CheckCircle2 size={16} /><span>{liveTrace?.used ? 'Verified live' : 'Topology route'}</span></div>
            <div className="trace-hero-endpoints">
              <div className="trace-endpoint backbone"><RadioTower size={19} /><div><small>BACKBONE START</small><b>{root.name || root.ip || 'Backbone'}</b><span>{root.ip || 'No management IP'}</span></div></div>
              <div className="trace-hero-line"><span /><Waypoints size={18} /><span /></div>
              <div className="trace-endpoint target"><MapPinned size={19} /><div><small>LOCATED ENDPOINT</small><b>{target?.name || target?.ip || result.query}</b><span>{target?.mac_address || target?.ip || 'MAC not reported'}</span></div></div>
            </div>
            <div className="trace-hero-metrics">
              <div><small>Managed hops</small><b>{Math.max(routeNodes.length - 2, 0)}</b></div>
              <div><small>Verified links</small><b>{result.links.length}</b></div>
              <div><small>MAC observations</small><b>{liveTrace?.fdb_matches ?? '-'}</b></div>
              <div><small>Trace method</small><b>{liveTrace?.used ? 'ARP + FDB' : 'Topology'}</b></div>
            </div>
          </section>

          <section className="trace-route-layout">
            <div className="card trace-route-card">
              <div className="trace-card-heading"><div><small>VERIFIED PATH</small><h3>Backbone to endpoint</h3></div><span><Activity size={14} /> {routeNodes.length} devices</span></div>
              <div className="trace-journey" aria-label="Verified device route">
                {routeNodes.map((node, index) => {
                  const isRoot = index === 0;
                  const isTarget = index === routeNodes.length - 1;
                  return (
                    <div className="trace-journey-item" key={node.id}>
                      {!isRoot && <div className="trace-journey-connector"><div className="trace-port-chip outgoing"><EthernetPort size={12} />{node.via?.device_port || 'Unknown port'}</div><ArrowDown size={17} /><div className="trace-port-chip incoming">{node.via?.port || 'Unknown port'}</div><span>{(node.via?.protocol || 'neighbor').toUpperCase()}</span></div>}
                      <article className={`trace-device-card ${isRoot ? 'is-backbone' : ''} ${isTarget ? 'is-target' : ''}`}>
                        <div className="trace-device-icon">{isTarget ? <MapPinned size={20} /> : isRoot ? <RadioTower size={20} /> : <Cpu size={20} />}</div>
                        <div className="trace-device-copy"><small>{isRoot ? 'BACKBONE' : isTarget ? 'ENDPOINT' : `HOP ${index}`}</small><b>{node.name || node.ip || 'Discovered device'}</b><span>{node.ip || node.mac_address || 'No address reported'}</span></div>
                        <i className={`trace-state ${isTarget ? 'located' : 'verified'}`} title={node.status || 'Verified'} />
                      </article>
                    </div>
                  );
                })}
              </div>
              <div className="trace-connection-table-wrap">
                <div className="trace-connection-table-heading"><div><span>CONNECTION MATRIX</span><b>Port-level route view</b></div><small><Link2 size={13} />{Math.max(routeNodes.length - 1, 0)} verified connections</small></div>
                <div className="trace-connection-table-scroll">
                  <table className="trace-connection-table">
                    <thead><tr><th>Hop</th><th>Source device</th><th>Egress</th><th>Link</th><th>Ingress</th><th>Connected device</th></tr></thead>
                    <tbody>{routeNodes.slice(1).map((node, index) => <tr key={node.id}>
                      <td><span>{String(index + 1).padStart(2, '0')}</span></td>
                      <td className="trace-table-device"><i><Cpu size={14} /></i><div><b>{node.via?.device_name || '-'}</b><small>Source switch</small></div></td>
                      <td><code>{node.via?.device_port || '-'}</code></td>
                      <td><em>{(node.via?.protocol || 'neighbor').toUpperCase()}</em></td>
                      <td><code>{node.via?.port || '-'}</code></td>
                      <td className="trace-table-device destination"><i>{index === routeNodes.length - 2 ? <MapPinned size={14} /> : <Cpu size={14} />}</i><div><b>{node.name || node.ip || 'Located endpoint'}</b><small>{node.ip || node.mac_address || ''}</small></div></td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </div>
            </div>
          </section>

          {result.live_snmp?.used && (
            <div className="module-notice trace-live-notice">
              <GitBranch size={17} />
              {result.live_snmp.message} {result.live_snmp.partial ? `Resolved through ${result.live_snmp.access_switch} interface ${result.live_snmp.access_port}.` : `MAC learned on ${result.live_snmp.access_switch} port ${result.live_snmp.access_port}.`}
              {result.live_snmp.fdb_lookup === 'cisco-vlan-community' ? <small>Cisco VLAN lookup: VLAN {result.live_snmp.fdb_vlan}, bridge port {result.live_snmp.bridge_port}, context @{result.live_snmp.fdb_vlan}.</small> : null}
              {result.live_snmp.verified_fdb_hops ? <small>Verified MAC forwarding hops: {result.live_snmp.verified_fdb_hops}.</small> : null}
              {result.live_snmp.discovered_neighbors?.length ? <small>Added discovered neighbor switches: {result.live_snmp.discovered_neighbors.join(', ')}.</small> : null}
              {result.live_snmp.neighbor_discovery_detail ? <small>{result.live_snmp.neighbor_discovery_detail}</small> : null}
              {result.live_snmp.neighbor_discovery_error ? <small>Neighbor discovery failed: {result.live_snmp.neighbor_discovery_error}</small> : null}
              {result.live_snmp.errors?.length ? <small>{result.live_snmp.errors.length} SNMP device{result.live_snmp.errors.length === 1 ? '' : 's'} did not respond.</small> : null}
            </div>
          )}

          {result.truncated && <div className="module-notice trace-error"><CircleAlert size={17} />The trace was limited to 250 connected devices.</div>}

          <section className="card inventory advanced-card trace-results-card">
            <div className="inventory-head">
              <div className="card-title">Backbone To Device Route <small>{result.nodes.length} devices on the route to {target?.ip || result.query}</small></div>
              <div className="trace-legend"><span><i className="trace-start" /> Backbone</span><span><i className="trace-hop" /> Route hop</span></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>HOP</th><th>DEVICE</th><th>MAC ADDRESS</th><th>IP ADDRESS</th><th>CONNECTED FROM</th><th>LOCAL PORT</th><th>REMOTE PORT</th><th>PROTOCOL</th><th>STATUS</th></tr>
                </thead>
                <tbody>
                  {result.nodes.map((node) => {
                    const isRoot = (node.depth || 0) === 0;
                    return (
                      <tr key={node.id} className={isRoot ? 'trace-root-row' : ''}>
                        <td><span className={isRoot ? 'trace-hop-badge start' : 'trace-hop-badge'}>{isRoot ? 'START' : `HOP ${node.depth}`}</span></td>
                        <td><b>{node.name || node.ip || 'Discovered device'}</b><small>{node.role || (node.managed ? 'Managed device' : 'Discovered neighbor')}</small></td>
                        <td>{node.mac_address || '-'}</td>
                        <td>{node.ip || '-'}</td>
                        <td>{isRoot ? '-' : node.via?.device_name || '-'}</td>
                        <td>{isRoot ? '-' : node.via?.device_port || '-'}</td>
                        <td>{isRoot ? '-' : node.via?.port || '-'}</td>
                        <td>{isRoot ? '-' : (node.via?.protocol || '-').toUpperCase()}</td>
                        <td><span className={`status ${String(node.status || '').toLowerCase()}`}>{node.status || 'Unknown'}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {!result && !error && !loading && <section className="card trace-empty"><GitBranch size={30} /><h2>Start a device trace</h2><p>Enter a management IP or MAC address to view every connected device recorded in the topology.</p></section>}
    </div>
  );
}
