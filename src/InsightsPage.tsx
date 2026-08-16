import { useEffect, useState } from 'react';
import { apiBase, apiError } from './apiBase';

type View = 'firmware' | 'vulnerabilities' | 'reports';
type Row = Record<string, unknown>;

const api = apiBase;

export function InsightsPage({ view }: { view: View }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [message, setMessage] = useState('');

  const load = async () => {
    const token = localStorage.getItem('aims-api-token') || '';
    const endpoint = view === 'firmware' ? 'insights/firmware' : view === 'vulnerabilities' ? 'insights/vulnerabilities' : 'insights/reports';
    const response = await fetch(`${api}/${endpoint}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await response.json();
    if (!response.ok) throw new Error(json.detail || 'Unable to load insight data.');
    setRows(Array.isArray(json.data) ? json.data : []);
  };

  useEffect(() => { load().catch((error) => setMessage(apiError(error))); }, [view]);

  const title = view === 'firmware' ? 'Firmware' : view === 'vulnerabilities' ? 'Vulnerabilities' : 'Reports';
  const columns = view === 'firmware' ? ['device_id', 'vendor', 'platform', 'version', 'recommended_version', 'status'] : view === 'vulnerabilities' ? ['cve', 'title', 'severity', 'cvss', 'status', 'device_id'] : ['name', 'report_type', 'schedule', 'enabled', 'recipients'];
  return <div className="content module-page"><div className="page-title"><div><h1>{title}</h1><p>Backend-backed enterprise insight records with controlled access and audit history.</p></div><button className="plain-button" onClick={() => load().catch((error) => setMessage(error instanceof Error ? error.message : 'Refresh failed.'))}>Refresh</button></div>{message && <div className="module-notice">{message}</div>}<section className="card inventory"><div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column.split('_').join(' ').toUpperCase()}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id || index)}>{columns.map((column) => <td key={column}>{typeof row[column] === 'object' ? JSON.stringify(row[column]) : String(row[column] ?? '-')}</td>)}</tr>)}{!rows.length && <tr><td colSpan={columns.length} className="empty">No {title.toLowerCase()} records found.</td></tr>}</tbody></table></div></section></div>;
}
