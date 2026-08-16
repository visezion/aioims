import { useEffect, useState } from 'react';
import { apiBase, apiError } from './apiBase';

const api = apiBase;
type AlertRow = { id: number; title: string; message: string; severity: string; status: string; source: string; last_seen_at?: string | null };
type IncidentRow = { id: number; number: string; title: string; severity: string; status: string; owner: string };

export function OperationsPage({ view = 'alerts' }: { view?: 'alerts' | 'incidents' }) {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [incidents, setIncidents] = useState<IncidentRow[]>([]);
  const [message, setMessage] = useState('');
  const token = localStorage.getItem('aims-api-token') || '';
  const load = async () => {
    const response = await fetch(`${api}/operations/${view}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await response.json();
    if (!response.ok) throw new Error(json.detail || json.message || `Unable to load ${view}.`);
    if (view === 'alerts') setAlerts(json.data || []); else setIncidents(json.data || []);
  };
  useEffect(() => { load().catch((error) => setMessage(apiError(error))); }, [view]);
  const action = async (path: string) => {
    const response = await fetch(`${api}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const json = await response.json();
    if (!response.ok) throw new Error(json.detail || json.message || 'Operation failed.');
    await load();
  };
  return <div className="content module-page"><div className="page-title"><div><h1>{view === 'alerts' ? 'Alerts' : 'Incidents'}</h1><p>Backend-backed operational records with acknowledgement, resolution, and ownership.</p></div><button className="plain-button" onClick={() => load().catch((error) => setMessage(error instanceof Error ? error.message : 'Refresh failed.'))}>Refresh</button></div>{message && <div className="module-notice">{message}</div>}<section className="card inventory"><div className="table-wrap"><table><thead>{view === 'alerts' ? <tr><th>TITLE</th><th>SEVERITY</th><th>STATUS</th><th>SOURCE</th><th>LAST SEEN</th><th>ACTIONS</th></tr> : <tr><th>NUMBER</th><th>TITLE</th><th>SEVERITY</th><th>STATUS</th><th>OWNER</th><th>ACTIONS</th></tr>}</thead><tbody>{view === 'alerts' ? alerts.map((row) => <tr key={row.id}><td><b>{row.title}</b><small>{row.message}</small></td><td><span className={`status ${row.severity}`}>{row.severity}</span></td><td>{row.status}</td><td>{row.source}</td><td>{row.last_seen_at ? new Date(row.last_seen_at).toLocaleString() : '-'}</td><td>{row.status !== 'acknowledged' && row.status !== 'resolved' && <button className="row-action" onClick={() => action(`/operations/alerts/${row.id}/acknowledge`)}>Acknowledge</button>}{row.status !== 'resolved' && <button className="row-action" onClick={() => action(`/operations/alerts/${row.id}/resolve`)}>Resolve</button>}</td></tr>) : incidents.map((row) => <tr key={row.id}><td><b>{row.number}</b></td><td>{row.title}</td><td><span className={`status ${row.severity}`}>{row.severity}</span></td><td>{row.status}</td><td>{row.owner || '-'}</td><td>{row.status === 'resolved' ? 'Closed' : 'Use API workflow'}</td></tr>)}{!((view === 'alerts' ? alerts : incidents).length) && <tr><td colSpan={6} className="empty">No {view} found.</td></tr>}</tbody></table></div></section></div>;
}
