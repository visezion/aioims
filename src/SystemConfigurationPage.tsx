import { FormEvent, useEffect, useState } from 'react';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import {
  ENVIRONMENT_THRESHOLDS_SETTING_KEY,
  EnvironmentThresholdRule,
  emptyEnvironmentThresholdRule,
  importEnvironmentThresholdRules,
  loadEnvironmentThresholdRules,
  saveEnvironmentThresholdRules,
} from './environmentThresholds';

const api = 'http://127.0.0.1:8001/api/v1';

type Setting = { key: string; value: string; configured: boolean; description: string };
type CredentialProfile = {
  id: number;
  name: string;
  credential_type: 'snmp_v2c' | 'ssh';
  username?: string;
  port?: number;
  has_secret: boolean;
  has_enable_secret: boolean;
  notes?: string;
};
type CredentialForm = {
  id?: number;
  name: string;
  credential_type: 'snmp_v2c' | 'ssh';
  username: string;
  secret: string;
  enable_secret: string;
  port: string;
  notes: string;
};

const emptyCredentialForm: CredentialForm = {
  name: '',
  credential_type: 'ssh',
  username: '',
  secret: '',
  enable_secret: '',
  port: '22',
  notes: '',
};

export function SystemConfigurationPage() {
  const [token, setToken] = useState(localStorage.getItem('aims-api-token') || '');
  const [statusInterval, setStatusInterval] = useState('60');
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupIntervalHours, setBackupIntervalHours] = useState('24');
  const [backupIntervalUnit, setBackupIntervalUnit] = useState('hours');
  const [backupTime, setBackupTime] = useState('02:00');
  const [backupScope, setBackupScope] = useState('active_with_ssh');
  const [backupTimeout, setBackupTimeout] = useState('8');
  const [backupLastRun, setBackupLastRun] = useState('');
  const [backupRunning, setBackupRunning] = useState(false);
  const [thresholdRules, setThresholdRules] = useState<EnvironmentThresholdRule[]>(() => loadEnvironmentThresholdRules());
  const [thresholdForm, setThresholdForm] = useState<Omit<EnvironmentThresholdRule, 'id' | 'updated_at'>>(emptyEnvironmentThresholdRule);
  const [editingThresholdId, setEditingThresholdId] = useState('');
  const [credentials, setCredentials] = useState<CredentialProfile[]>([]);
  const [credentialForm, setCredentialForm] = useState<CredentialForm>(emptyCredentialForm);
  const [message, setMessage] = useState('');
  const [deleteCredentialPrompt, setDeleteCredentialPrompt] = useState<CredentialProfile | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

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

  const load = async () => {
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/settings`, { headers: { Authorization: `Bearer ${auth}` } });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load settings.');
      const settings = json.data?.data || [];
      const refresh = settings.find((item: Setting) => item.key === 'device_status_refresh_seconds');
      const configBackupEnabled = settings.find((item: Setting) => item.key === 'device_config_backup_enabled');
      const configBackupInterval = settings.find((item: Setting) => item.key === 'device_config_backup_interval_hours');
      const configBackupIntervalUnit = settings.find((item: Setting) => item.key === 'device_config_backup_interval_unit');
      const configBackupTime = settings.find((item: Setting) => item.key === 'device_config_backup_time');
      const configBackupScope = settings.find((item: Setting) => item.key === 'device_config_backup_scope');
      const configBackupTimeout = settings.find((item: Setting) => item.key === 'device_config_backup_timeout_seconds');
      const configBackupLastRun = settings.find((item: Setting) => item.key === 'device_config_backup_last_run_at');
      const environmentThresholds = settings.find((item: Setting) => item.key === ENVIRONMENT_THRESHOLDS_SETTING_KEY);
      if (environmentThresholds?.value) importEnvironmentThresholdRules(environmentThresholds.value);
      setStatusInterval(refresh?.value || '60');
      setBackupEnabled((configBackupEnabled?.value || 'false') === 'true');
      setBackupIntervalHours(configBackupInterval?.value || '24');
      setBackupIntervalUnit(configBackupIntervalUnit?.value || 'hours');
      setBackupTime(configBackupTime?.value || '02:00');
      setBackupScope(configBackupScope?.value || 'active_with_ssh');
      setBackupTimeout(configBackupTimeout?.value || '8');
      setBackupLastRun(configBackupLastRun?.value || '');
      setThresholdRules(loadEnvironmentThresholdRules());
      await loadCredentials(auth);
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load settings.');
    }
  };

  const loadCredentials = async (authToken?: string) => {
    const auth = authToken || await ensureToken();
    const response = await fetch(`${api}/credentials`, { headers: { Authorization: `Bearer ${auth}` } });
    const json = await response.json();
    if (!response.ok) throw new Error(json.detail || json.message || 'Unable to load credential profiles.');
    setCredentials(json.data?.data || []);
  };

  useEffect(() => {
    load();
  }, []);

  const saveStatusInterval = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/settings/device_status_refresh_seconds`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: statusInterval }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to save refresh interval.');
      setStatusInterval(json.data?.value || statusInterval);
      setMessage('Device status refresh interval saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save refresh interval.');
    }
  };

  const saveBackupAutomation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const auth = await ensureToken();
      const updates = [
        ['device_config_backup_enabled', backupEnabled ? 'true' : 'false'],
        ['device_config_backup_interval_hours', backupIntervalHours],
        ['device_config_backup_interval_unit', backupIntervalUnit],
        ['device_config_backup_time', backupTime],
        ['device_config_backup_scope', backupScope],
        ['device_config_backup_timeout_seconds', backupTimeout],
      ];
      for (const [key, value] of updates) {
        const response = await fetch(`${api}/settings/${key}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.detail || json.message || 'Unable to save backup automation settings.');
      }
      setMessage('Automatic configuration backup settings saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save backup automation settings.');
    }
  };

  const saveThresholdRulesToBackend = async (rows: EnvironmentThresholdRule[]) => {
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/settings/${ENVIRONMENT_THRESHOLDS_SETTING_KEY}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: JSON.stringify(rows) }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to save environment thresholds.');
      saveEnvironmentThresholdRules(rows);
      setThresholdRules(rows);
      setMessage('Environment thresholds saved.');
    } catch (error) {
      setMessage(error instanceof Error ? `${error.message} Thresholds were not saved.` : 'Unable to save environment thresholds.');
      throw error;
    }
  };

  const saveThresholdRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const now = new Date().toISOString();
    const rule: EnvironmentThresholdRule = {
      ...thresholdForm,
      target: thresholdForm.scope === 'global' ? '*' : thresholdForm.target.trim(),
      id: editingThresholdId || crypto.randomUUID(),
      updated_at: now,
    };
    if (rule.scope !== 'global' && !rule.target) {
      setMessage('Choose a target name for this threshold scope.');
      return;
    }
    const next = editingThresholdId
      ? thresholdRules.map((item) => item.id === editingThresholdId ? rule : item)
      : [rule, ...thresholdRules.filter((item) => !(item.metric === rule.metric && item.scope === rule.scope && item.target.trim().toLowerCase() === rule.target.trim().toLowerCase()))];
    await saveThresholdRulesToBackend(next);
    setThresholdForm(emptyEnvironmentThresholdRule);
    setEditingThresholdId('');
  };

  const editThresholdRule = (rule: EnvironmentThresholdRule) => {
    setEditingThresholdId(rule.id);
    setThresholdForm({
      metric: rule.metric,
      scope: rule.scope,
      target: rule.target,
      normalMin: rule.normalMin,
      normalMax: rule.normalMax,
      warningMin: rule.warningMin,
      warningMax: rule.warningMax,
      dangerMin: rule.dangerMin,
      dangerMax: rule.dangerMax,
      enabled: rule.enabled,
    });
  };

  const deleteThresholdRule = async (rule: EnvironmentThresholdRule) => {
    await saveThresholdRulesToBackend(thresholdRules.filter((item) => item.id !== rule.id));
  };

  const updateThresholdForm = (key: keyof typeof thresholdForm, value: string | boolean) => {
    setThresholdForm((current) => ({
      ...current,
      [key]: value,
      ...(key === 'scope' && value === 'global' ? { target: '*' } : {}),
    }));
  };

  const runBackupNow = async () => {
    setBackupRunning(true);
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/devices/configuration-backups/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: backupScope, timeout: Number(backupTimeout || 8) }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Configuration backup run failed.');
      const data = json.data || {};
      setMessage(`Configuration backup run finished. ${data.backed_up || 0} backed up, ${(data.failed || []).length} failed, ${(data.skipped || []).length} skipped.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Configuration backup run failed.');
    } finally {
      setBackupRunning(false);
    }
  };

  const saveCredential = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const auth = await ensureToken();
      const payload: Record<string, string | number> = {
        name: credentialForm.name.trim(),
        credential_type: credentialForm.credential_type,
        username: credentialForm.credential_type === 'ssh' ? credentialForm.username.trim() : '',
        port: Number(credentialForm.port || (credentialForm.credential_type === 'ssh' ? 22 : 161)),
        notes: credentialForm.notes.trim(),
      };
      if (credentialForm.secret) payload.secret = credentialForm.secret;
      if (credentialForm.credential_type === 'ssh' && credentialForm.enable_secret) payload.enable_secret = credentialForm.enable_secret;
      const response = await fetch(credentialForm.id ? `${api}/credentials/${credentialForm.id}` : `${api}/credentials`, {
        method: credentialForm.id ? 'PATCH' : 'POST',
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to save credential profile.');
      setCredentialForm(emptyCredentialForm);
      await loadCredentials(auth);
      setMessage(credentialForm.id ? 'Credential profile updated.' : 'Credential profile created.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save credential profile.');
    }
  };

  const editCredential = (profile: CredentialProfile) => {
    setCredentialForm({
      id: profile.id,
      name: profile.name,
      credential_type: profile.credential_type,
      username: profile.username || '',
      secret: '',
      enable_secret: '',
      port: String(profile.port || (profile.credential_type === 'ssh' ? 22 : 161)),
      notes: profile.notes || '',
    });
  };

  const deleteCredential = async (profile: CredentialProfile) => {
    setDeleteBusy(true);
    try {
      const auth = await ensureToken();
      const response = await fetch(`${api}/credentials/${profile.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${auth}` } });
      const json = await response.json();
      if (!response.ok) throw new Error(json.detail || json.message || 'Unable to delete credential profile.');
      setDeleteCredentialPrompt(null);
      await loadCredentials(auth);
      setMessage('Credential profile deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete credential profile.');
    } finally {
      setDeleteBusy(false);
    }
  };

  const updateCredentialForm = (key: keyof CredentialForm, value: string) => {
    setCredentialForm((current) => ({
      ...current,
      [key]: value,
      ...(key === 'credential_type' ? { port: value === 'ssh' ? '22' : '161', username: value === 'ssh' ? current.username : '' } : {}),
    }));
  };

  return (
    <div className="content config-page">
      <div className="page-title">
        <div>
          <h1>Configurations</h1>
          <p>Manage discovery credentials and operational automation settings.</p>
        </div>
        <button className="plain-button" onClick={load}>Refresh</button>
      </div>

      {message && <div className="module-notice">{message}<button onClick={() => setMessage('')}>x</button></div>}

      <div className="config-settings-grid">
        <section className="card config-setting-card">
          <div className="card-title">Credential Profiles</div>
          <p className="config-copy">Store reusable SNMP and SSH credentials for discovery scans. Secrets are encrypted and write-only.</p>
          <form onSubmit={saveCredential} className="settings-form">
            <div className="form-grid">
              <label>Name<input required value={credentialForm.name} onChange={(event) => updateCredentialForm('name', event.target.value)} placeholder="Core switch SSH" /></label>
              <label>Type<select value={credentialForm.credential_type} onChange={(event) => updateCredentialForm('credential_type', event.target.value as 'snmp_v2c' | 'ssh')}><option value="ssh">SSH</option><option value="snmp_v2c">SNMP v2c</option></select></label>
              {credentialForm.credential_type === 'ssh' && <label>Username<input value={credentialForm.username} onChange={(event) => updateCredentialForm('username', event.target.value)} placeholder="admin" /></label>}
              <label>{credentialForm.credential_type === 'ssh' ? 'Password' : 'Community'}<input type="password" value={credentialForm.secret} onChange={(event) => updateCredentialForm('secret', event.target.value)} placeholder={credentialForm.id ? 'Leave blank to keep saved secret' : 'Required secret'} /></label>
              {credentialForm.credential_type === 'ssh' && <label>Enable password<input type="password" value={credentialForm.enable_secret} onChange={(event) => updateCredentialForm('enable_secret', event.target.value)} placeholder="Optional enable secret" /></label>}
              <label>Port<input type="number" min="1" max="65535" value={credentialForm.port} onChange={(event) => updateCredentialForm('port', event.target.value)} /></label>
              <label className="full">Notes<input value={credentialForm.notes} onChange={(event) => updateCredentialForm('notes', event.target.value)} placeholder="Switches, routers, firewalls..." /></label>
            </div>
            <div className="form-actions">
              <button type="button" onClick={() => setCredentialForm(emptyCredentialForm)}>Clear</button>
              <button className="add" type="submit">{credentialForm.id ? 'Update profile' : 'Create profile'}</button>
            </div>
          </form>
          <div className="credential-list">
            {credentials.length ? credentials.map((profile) => (
              <div key={profile.id} className="credential-row">
                <b>{profile.name}</b>
                <span>{profile.credential_type === 'ssh' ? `SSH ${profile.username || ''}` : 'SNMP v2c'} | port {profile.port || '-'}</span>
                <em>{profile.has_secret ? 'Secret saved' : 'No secret'}{profile.has_enable_secret ? ' | enable saved' : ''}</em>
                <button className="row-action" type="button" onClick={() => editCredential(profile)}>Edit</button>
                <button className="row-action danger" type="button" onClick={() => setDeleteCredentialPrompt(profile)}>Delete</button>
              </div>
            )) : <p className="config-copy">No credential profiles saved yet.</p>}
          </div>
        </section>

        <section className="card config-setting-card">
          <div className="card-title">Device Status Refresh</div>
          <p className="config-copy">Control how often the device inventory refreshes status automatically.</p>
          <form onSubmit={saveStatusInterval} className="settings-form">
            <label>
              Interval seconds
              <input type="number" min="15" max="3600" value={statusInterval} onChange={(event) => setStatusInterval(event.target.value)} />
            </label>
            <div className="form-actions">
              <button className="add" type="submit">Save interval</button>
            </div>
          </form>
        </section>

        <section className="card config-setting-card full config-threshold-card">
          <div className="card-title">Temperature and Power Thresholds</div>
          <p className="config-copy">Create alert ranges by global default, location, room, rack, or individual device. The most specific matching rule wins: device, rack, room, location, then global.</p>
          <form onSubmit={saveThresholdRule} className="settings-form">
            <div className="form-grid threshold-form-grid">
              <label>Metric<select value={thresholdForm.metric} onChange={(event) => updateThresholdForm('metric', event.target.value)}><option value="temperature">Temperature (C)</option><option value="power">Power (W)</option></select></label>
              <label>Scope<select value={thresholdForm.scope} onChange={(event) => updateThresholdForm('scope', event.target.value)}><option value="global">Global</option><option value="location">Location</option><option value="room">Room</option><option value="rack">Rack</option><option value="device">Device</option></select></label>
              <label>Target<input disabled={thresholdForm.scope === 'global'} value={thresholdForm.target} onChange={(event) => updateThresholdForm('target', event.target.value)} placeholder={thresholdForm.scope === 'device' ? 'Device name or ID' : thresholdForm.scope === 'rack' ? 'Rack name' : thresholdForm.scope === 'room' ? 'Room name' : thresholdForm.scope === 'location' ? 'Location name' : '*'} /></label>
              <label className="toggle-row">Enabled<input type="checkbox" checked={thresholdForm.enabled} onChange={(event) => updateThresholdForm('enabled', event.target.checked)} /></label>
              <fieldset>
                <legend>Normal range</legend>
                <input type="number" step="0.1" value={thresholdForm.normalMin} onChange={(event) => updateThresholdForm('normalMin', event.target.value)} placeholder="Min" />
                <input type="number" step="0.1" value={thresholdForm.normalMax} onChange={(event) => updateThresholdForm('normalMax', event.target.value)} placeholder="Max" />
              </fieldset>
              <fieldset>
                <legend>Warning range</legend>
                <input type="number" step="0.1" value={thresholdForm.warningMin} onChange={(event) => updateThresholdForm('warningMin', event.target.value)} placeholder="Min" />
                <input type="number" step="0.1" value={thresholdForm.warningMax} onChange={(event) => updateThresholdForm('warningMax', event.target.value)} placeholder="Max" />
              </fieldset>
              <fieldset>
                <legend>Danger alert range</legend>
                <input type="number" step="0.1" value={thresholdForm.dangerMin} onChange={(event) => updateThresholdForm('dangerMin', event.target.value)} placeholder="Min" />
                <input type="number" step="0.1" value={thresholdForm.dangerMax} onChange={(event) => updateThresholdForm('dangerMax', event.target.value)} placeholder="Max" />
              </fieldset>
            </div>
            <div className="form-actions">
              <button type="button" onClick={() => { setThresholdForm(emptyEnvironmentThresholdRule); setEditingThresholdId(''); }}>Clear</button>
              <button className="add" type="submit">{editingThresholdId ? 'Update threshold' : 'Add threshold'}</button>
            </div>
          </form>
          <div className="threshold-rule-list">
            {thresholdRules.length ? thresholdRules.map((rule) => (
              <div key={rule.id} className={`threshold-rule-row ${rule.enabled ? '' : 'disabled'}`}>
                <b>{rule.metric === 'temperature' ? 'Temperature' : 'Power'} / {rule.scope}</b>
                <span>{rule.scope === 'global' ? 'All targets' : rule.target}</span>
                <em>Normal {rangeLabel(rule.normalMin, rule.normalMax)} | Warning {rangeLabel(rule.warningMin, rule.warningMax)} | Danger {rangeLabel(rule.dangerMin, rule.dangerMax)}</em>
                <button className="row-action" type="button" onClick={() => editThresholdRule(rule)}>Edit</button>
                <button className="row-action danger" type="button" onClick={() => deleteThresholdRule(rule)}>Delete</button>
              </div>
            )) : <p className="config-copy">No threshold rules saved yet.</p>}
          </div>
        </section>

        <section className="card config-setting-card">
          <div className="card-title">Automatic Configuration Backups</div>
          <p className="config-copy">Back up full running configurations for SSH-managed devices. Each device keeps the latest 5 backups; the oldest backup is replaced automatically.</p>
          <form onSubmit={saveBackupAutomation} className="settings-form">
            <label className="toggle-row">
              Enable automatic backups
              <input type="checkbox" checked={backupEnabled} onChange={(event) => setBackupEnabled(event.target.checked)} />
            </label>
            <div className="form-grid">
              <label className="backup-interval-control">Every
                <span className="backup-interval-fields">
                  <input type="number" min="1" max="720" value={backupIntervalHours} onChange={(event) => setBackupIntervalHours(event.target.value)} />
                  <select value={backupIntervalUnit} onChange={(event) => setBackupIntervalUnit(event.target.value)}>
                    <option value="hours">Hours</option>
                    <option value="weeks">Weeks</option>
                    <option value="months">Months</option>
                  </select>
                </span>
              </label>
              <label>Earliest run time<input type="time" value={backupTime} onChange={(event) => setBackupTime(event.target.value)} /></label>
              <label>Device scope<select value={backupScope} onChange={(event) => setBackupScope(event.target.value)}>
                <option value="active_with_ssh">Active devices with SSH</option>
                <option value="with_ssh">Any device with SSH</option>
                <option value="all">All devices</option>
              </select></label>
              <label>SSH timeout seconds<input type="number" min="0.2" max="30" step="0.1" value={backupTimeout} onChange={(event) => setBackupTimeout(event.target.value)} /></label>
            </div>
            <p className="config-copy">Last automatic run: {formatSettingDate(backupLastRun)}</p>
            <div className="form-actions">
              <button type="button" className="plain-button" disabled={backupRunning} onClick={runBackupNow}>{backupRunning ? 'Running...' : 'Run backup now'}</button>
              <button className="add" type="submit">Save backup settings</button>
            </div>
          </form>
        </section>
      </div>

      {deleteCredentialPrompt && (
        <DeleteConfirmDialog
          open
          title="Delete credential profile"
          itemName={deleteCredentialPrompt.name}
          message="Devices and controllers using this profile may lose SNMP or SSH collection until another credential is assigned."
          details={[
            `Type: ${deleteCredentialPrompt.credential_type === 'ssh' ? 'SSH' : 'SNMP v2c'}`,
            `Port: ${deleteCredentialPrompt.port || (deleteCredentialPrompt.credential_type === 'ssh' ? 22 : 161)}`,
            deleteCredentialPrompt.has_secret ? 'Encrypted secret is stored and will be removed.' : 'No encrypted secret is currently stored.',
            deleteCredentialPrompt.has_enable_secret ? 'Enable secret is also stored and will be removed.' : 'No enable secret stored.',
          ]}
          confirmLabel="Delete profile"
          busy={deleteBusy}
          onCancel={() => !deleteBusy && setDeleteCredentialPrompt(null)}
          onConfirm={() => deleteCredential(deleteCredentialPrompt)}
        />
      )}
    </div>
  );
}

function formatSettingDate(value: string) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function rangeLabel(min: string, max: string) {
  const left = String(min || '').trim();
  const right = String(max || '').trim();
  if (left && right) return `${left}-${right}`;
  if (left) return `>= ${left}`;
  if (right) return `<= ${right}`;
  return 'not set';
}
