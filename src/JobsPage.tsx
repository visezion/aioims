import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';

const api = 'http://127.0.0.1:8001/api/v1';

type Job = {
  id: number;
  job_type: string;
  status: string;
  progress: number;
  target: string;
  parameters: unknown;
  result: unknown;
  error: string;
  created_by: string;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};
type PageMeta = { page: number; per_page: number; total: number; pages: number };
type SortDirection = 'asc' | 'desc';
type JobSortField = 'job' | 'target' | 'status' | 'progress' | 'started' | 'finished' | 'user';

export function JobsPage() {
  const [token, setToken] = useState(localStorage.getItem('aims-api-token') || '');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Job | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [jobType, setJobType] = useState('');
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<PageMeta>({ page: 1, per_page: 25, total: 0, pages: 1 });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sortField, setSortField] = useState<JobSortField>('started');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

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

  const load = async (nextPage = page, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const auth = await ensureToken();
      const params = new URLSearchParams({
        page: String(nextPage),
        per_page: String(meta.per_page),
        q: query,
        status,
        job_type: jobType,
      });
      const response = await fetch(`${api}/jobs?${params.toString()}`, { headers: { Authorization: `Bearer ${auth}` } });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load jobs.');
      const nextJobs = json.data?.data || [];
      setJobs(nextJobs);
      setSelectedIds((current) => current.filter((id) => nextJobs.some((job: Job) => job.id === id)));
      setSelected((current) => current ? nextJobs.find((job: Job) => job.id === current.id) || current : current);
      setMeta(json.data?.meta || { page: nextPage, per_page: 25, total: 0, pages: 1 });
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load jobs.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadJob = async (jobId: number) => {
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/jobs/${jobId}`, { headers: { Authorization: `Bearer ${auth}` } });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load job.');
      const nextJob = json.data as Job;
      setSelected(nextJob);
      setJobs((current) => current.map((job) => (job.id === nextJob.id ? nextJob : job)));
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load job.');
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => load(page), 250);
    return () => window.clearTimeout(timer);
  }, [query, status, jobType, page]);

  useEffect(() => {
    const hasRunningJobs = jobs.some((job) => job.status === 'running') || selected?.status === 'running';
    const timer = window.setInterval(() => load(page, true), hasRunningJobs ? 750 : 4000);
    return () => window.clearInterval(timer);
  }, [query, status, jobType, page, meta.per_page, token, jobs, selected?.status]);

  useEffect(() => {
    if (!selected || selected.status !== 'running') return;
    const timer = window.setInterval(() => loadJob(selected.id), 750);
    return () => window.clearInterval(timer);
  }, [selected?.id, selected?.status, token]);

  const types = Array.from(new Set(jobs.map((job) => job.job_type))).sort();
  const sortedJobs = useMemo(() => sortJobs(jobs, sortField, sortDirection), [jobs, sortField, sortDirection]);
  const selectedJobs = sortedJobs.filter((job) => selectedIds.includes(job.id));
  const allPageSelected = sortedJobs.length > 0 && sortedJobs.every((job) => selectedIds.includes(job.id));

  const toggleJobSelected = (id: number) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const togglePageSelected = () => {
    const ids = sortedJobs.map((job) => job.id);
    setSelectedIds((current) => allPageSelected
      ? current.filter((id) => !ids.includes(id))
      : Array.from(new Set([...current, ...ids])));
  };

  const changeSort = (field: JobSortField) => {
    if (sortField === field) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortField(field);
    setSortDirection(field === 'started' || field === 'finished' || field === 'progress' ? 'desc' : 'asc');
  };
  const sortHeader = (field: JobSortField, text: string) => (
    <button type="button" className={`sort-header ${sortField === field ? 'active' : ''}`} onClick={() => changeSort(field)}>
      {text}{sortField === field ? ` (${sortDirection})` : ''}
    </button>
  );

  const exportSelectedJobs = () => {
    exportRowsCsv(
      'jobs-selected.csv',
      ['ID', 'Type', 'Target', 'Status', 'Progress', 'Started', 'Finished', 'User', 'Error'],
      selectedJobs.map((job) => [
        job.id,
        label(job.job_type),
        job.target || '',
        job.status,
        `${job.progress || 0}%`,
        job.started_at || job.created_at || '',
        job.finished_at || '',
        job.created_by || '',
        job.error || '',
      ]),
    );
  };

  return (
    <div className="content jobs-page">
      <div className="page-title">
        <div>
          <h1>Jobs</h1>
          <p>Track scan, protocol check, and automation operation progress and results.</p>
        </div>
        <button className="plain-button" onClick={() => load(page)}><RefreshCw size={16} /> {loading ? 'Refreshing...' : 'Refresh'}</button>
      </div>

      {message && <div className="module-notice">{message}<button onClick={() => setMessage('')}><X size={15} /></button></div>}

      <section className="card inventory advanced-card">
        {selectedIds.length > 0 && (
          <div className="bulk-toolbar">
            <b>{selectedIds.length} selected</b>
            <button className="plain-button" disabled={!selectedJobs.length} onClick={() => selectedJobs[0] && setSelected(selectedJobs[0])}>Open first</button>
            <button className="plain-button" disabled={!selectedJobs.length} onClick={exportSelectedJobs}>Export selected</button>
            <button className="plain-button" onClick={() => setSelectedIds([])}>Clear</button>
          </div>
        )}
        <div className="inventory-head">
          <div className="card-title">Job History <small>{meta.total} records</small></div>
          <div className="inventory-controls">
            <div className="table-search">
              <Search size={15} />
              <input value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Search target, user, result, error..." />
            </div>
            <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }}>
              <option value="">All statuses</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
            <select value={jobType} onChange={(event) => { setPage(1); setJobType(event.target.value); }}>
              <option value="">All types</option>
              {types.map((type) => <option key={type} value={type}>{label(type)}</option>)}
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" checked={allPageSelected} onChange={togglePageSelected} aria-label="Select all jobs on this page" /></th>
                <th>{sortHeader('job', 'JOB')}</th>
                <th>{sortHeader('target', 'TARGET')}</th>
                <th>{sortHeader('status', 'STATUS')}</th>
                <th>{sortHeader('progress', 'PROGRESS')}</th>
                <th>{sortHeader('started', 'STARTED')}</th>
                <th>{sortHeader('finished', 'FINISHED')}</th>
                <th>{sortHeader('user', 'USER')}</th>
              </tr>
            </thead>
            <tbody>
              {!jobs.length ? (
                <tr><td colSpan={8} className="empty">No jobs found.</td></tr>
              ) : sortedJobs.map((job) => (
                <tr key={job.id}>
                  <td><input type="checkbox" checked={selectedIds.includes(job.id)} onChange={() => toggleJobSelected(job.id)} aria-label={`Select job ${job.id}`} /></td>
                  <td><button className="device-link" onClick={() => setSelected(job)}>{label(job.job_type)} #{job.id}</button></td>
                  <td>{job.target || '-'}</td>
                  <td><span className={`status ${statusClass(job.status)}`}>{job.status}</span></td>
                  <td><Progress job={job} /></td>
                  <td>{job.started_at || job.created_at || '-'}</td>
                  <td>{job.finished_at || '-'}</td>
                  <td>{job.created_by || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pagination-bar">
          <span>Page {meta.page} of {Math.max(meta.pages, 1)}</span>
          <button className="plain-button" disabled={meta.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
          <button className="plain-button" disabled={meta.page >= meta.pages} onClick={() => setPage((value) => value + 1)}>Next</button>
        </div>
      </section>

      {selected && (
        <div className="modal-backdrop" onMouseDown={() => setSelected(null)}>
          <div className="device-form large detail-modal job-detail-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="form-header">
              <div>
                <h2>{label(selected.job_type)} #{selected.id}</h2>
                <p>{selected.target || 'No target'} | {selected.status} | {selected.progress}%</p>
              </div>
              <button type="button" onClick={() => setSelected(null)}><X /></button>
            </div>
            <div className="job-detail-scroll">
              <div className="detail-grid job-detail-grid">
                <p><span>Type</span>{label(selected.job_type)}</p>
                <p><span>Status</span>{selected.status}</p>
                <p><span>Progress</span>{selected.progress}% {progressDetail(selected)}</p>
                <p><span>Updated</span>{selected.updated_at || '-'}</p>
                <p><span>User</span>{selected.created_by || '-'}</p>
                <p><span>Started</span>{selected.started_at || '-'}</p>
                <p><span>Finished</span>{selected.finished_at || '-'}</p>
                <p><span>Error</span>{selected.error || '-'}</p>
              </div>
              <div className="job-detail-section">
                <h3>Parameters</h3>
                <pre className="job-json">{formatJson(selected.parameters)}</pre>
              </div>
              <div className="job-detail-section">
                <h3>Result</h3>
                <pre className="job-json">{formatJson(selected.result)}</pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Progress({ job }: { job: Job }) {
  const normalized = Math.max(0, Math.min(100, job.progress || 0));
  return (
    <div className="job-progress-wrap">
      <div className={`job-progress ${job.status === 'running' ? 'running' : ''}`}>
        <span style={{ width: `${normalized}%` }} />
        <b>{normalized}%</b>
      </div>
      <small>{progressDetail(job) || job.updated_at || ''}</small>
    </div>
  );
}

function label(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(value: string) {
  if (value === 'completed') return 'active';
  if (value === 'failed') return 'failed';
  return 'maintenance';
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

function sortJobs(rows: Job[], field: JobSortField, direction: SortDirection) {
  return [...rows].sort((a, b) => compareSortValues(jobSortValue(a, field), jobSortValue(b, field), direction));
}

function jobSortValue(job: Job, field: JobSortField) {
  if (field === 'job') return job.id;
  if (field === 'target') return job.target || '';
  if (field === 'status') return job.status || '';
  if (field === 'progress') return job.progress || 0;
  if (field === 'started') return Date.parse(job.started_at || job.created_at || '') || 0;
  if (field === 'finished') return Date.parse(job.finished_at || '') || 0;
  if (field === 'user') return job.created_by || '';
  return '';
}

function compareSortValues(a: unknown, b: unknown, direction: SortDirection) {
  const multiplier = direction === 'asc' ? 1 : -1;
  if (typeof a === 'number' || typeof b === 'number') return ((Number(a) || 0) - (Number(b) || 0)) * multiplier;
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' }) * multiplier;
}

function formatJson(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function progressDetail(job: Job) {
  const result = job.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '';
  const data = result as Record<string, unknown>;
  const phase = typeof data.phase === 'string' ? label(data.phase) : '';
  const checked = typeof data.checked === 'number' ? data.checked : typeof data.processed === 'number' ? data.processed : null;
  const total = typeof data.total === 'number' ? data.total : null;
  const current = typeof data.current_ip === 'string' ? data.current_ip : typeof data.current_node === 'string' ? data.current_node : typeof data.current_protocol === 'string' ? data.current_protocol : '';
  const count = checked !== null && total !== null ? `${checked}/${total}` : '';
  return [phase, count, current].filter(Boolean).join(' - ');
}
