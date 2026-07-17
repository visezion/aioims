export type EnvironmentMetric = 'temperature' | 'power' | 'humidity' | 'airflow' | 'voltage' | 'current' | 'frequency' | 'battery' | 'runtime' | 'capacity' | 'utilization' | 'pressure' | 'noise' | 'water' | 'smoke';
export type EnvironmentThresholdScope = 'global' | 'site' | 'location' | 'room' | 'rack' | 'device' | 'component' | 'component_type' | 'component_category';
export type EnvironmentThresholdSeverity = 'normal' | 'warning' | 'danger';

export type EnvironmentThresholdRule = {
  id: string;
  metric: EnvironmentMetric;
  scope: EnvironmentThresholdScope;
  target: string;
  normalMin: string;
  normalMax: string;
  warningMin: string;
  warningMax: string;
  dangerMin: string;
  dangerMax: string;
  enabled: boolean;
  updated_at: string;
};

export type EnvironmentThresholdContext = {
  deviceId?: number | string | null;
  deviceName?: string | null;
  site?: string | null;
  location?: string | null;
  room?: string | null;
  rack?: string | null;
  componentId?: string | null;
  componentName?: string | null;
  componentType?: string | null;
  componentCategory?: string | null;
};

export const ENVIRONMENT_THRESHOLDS_STORAGE_KEY = 'aims-environment-threshold-rules';
export const ENVIRONMENT_THRESHOLDS_SETTING_KEY = 'environment_threshold_rules';
export const ENVIRONMENT_METRIC_OPTIONS: { value: EnvironmentMetric; label: string; unitHint: string }[] = [
  { value: 'temperature', label: 'Temperature', unitHint: 'C' },
  { value: 'power', label: 'Power load', unitHint: 'W' },
  { value: 'humidity', label: 'Humidity', unitHint: '%' },
  { value: 'airflow', label: 'Airflow', unitHint: 'CFM' },
  { value: 'voltage', label: 'Voltage', unitHint: 'V' },
  { value: 'current', label: 'Current', unitHint: 'A' },
  { value: 'frequency', label: 'Frequency', unitHint: 'Hz' },
  { value: 'battery', label: 'Battery charge', unitHint: '%' },
  { value: 'runtime', label: 'Runtime remaining', unitHint: 'minutes' },
  { value: 'capacity', label: 'Capacity', unitHint: '%' },
  { value: 'utilization', label: 'Utilization', unitHint: '%' },
  { value: 'pressure', label: 'Room pressure', unitHint: 'Pa' },
  { value: 'noise', label: 'Noise', unitHint: 'dB' },
  { value: 'water', label: 'Water / leak value', unitHint: 'numeric' },
  { value: 'smoke', label: 'Smoke / air safety value', unitHint: 'numeric' },
];
export const ENVIRONMENT_THRESHOLD_SCOPE_OPTIONS: { value: EnvironmentThresholdScope; label: string; targetHint: string }[] = [
  { value: 'global', label: 'Global default', targetHint: '*' },
  { value: 'site', label: 'Site', targetHint: 'Site name' },
  { value: 'location', label: 'Location', targetHint: 'Location name' },
  { value: 'room', label: 'Room', targetHint: 'Room name' },
  { value: 'rack', label: 'Rack', targetHint: 'Rack name' },
  { value: 'device', label: 'Device', targetHint: 'Device name or ID' },
  { value: 'component', label: 'Component', targetHint: 'Component name or ID' },
  { value: 'component_type', label: 'Component type', targetHint: 'Temperature sensor, UPS, PDU...' },
  { value: 'component_category', label: 'Component category', targetHint: 'Power Infrastructure, Cooling Infrastructure...' },
];

export const emptyEnvironmentThresholdRule: Omit<EnvironmentThresholdRule, 'id' | 'updated_at'> = {
  metric: 'temperature',
  scope: 'global',
  target: '*',
  normalMin: '0',
  normalMax: '60',
  warningMin: '61',
  warningMax: '74',
  dangerMin: '75',
  dangerMax: '999',
  enabled: true,
};

const defaultRules: EnvironmentThresholdRule[] = [
  {
    id: 'default-temperature-global',
    metric: 'temperature',
    scope: 'global',
    target: '*',
    normalMin: '0',
    normalMax: '60',
    warningMin: '61',
    warningMax: '74',
    dangerMin: '75',
    dangerMax: '999',
    enabled: true,
    updated_at: 'default',
  },
  {
    id: 'default-power-global',
    metric: 'power',
    scope: 'global',
    target: '*',
    normalMin: '0',
    normalMax: '8000',
    warningMin: '8001',
    warningMax: '11000',
    dangerMin: '11001',
    dangerMax: '999999',
    enabled: true,
    updated_at: 'default',
  },
];

export function loadEnvironmentThresholdRules(): EnvironmentThresholdRule[] {
  try {
    const rows = JSON.parse(localStorage.getItem(ENVIRONMENT_THRESHOLDS_STORAGE_KEY) || '[]');
    if (!Array.isArray(rows) || !rows.length) return defaultRules;
    return rows.map(normalizeRule).filter(Boolean) as EnvironmentThresholdRule[];
  } catch {
    return defaultRules;
  }
}

export function saveEnvironmentThresholdRules(rows: EnvironmentThresholdRule[]) {
  localStorage.setItem(ENVIRONMENT_THRESHOLDS_STORAGE_KEY, JSON.stringify(rows.map(normalizeRule).filter(Boolean)));
  window.dispatchEvent(new Event('aims:environment-thresholds-changed'));
}

export function importEnvironmentThresholdRules(value: string | null | undefined) {
  if (!value) return;
  try {
    const rows = JSON.parse(value);
    if (Array.isArray(rows)) saveEnvironmentThresholdRules(rows.map(normalizeRule).filter(Boolean) as EnvironmentThresholdRule[]);
  } catch {
    // Keep local rules when the backend setting has not been initialized or contains invalid JSON.
  }
}

export function environmentThresholdTone(metric: EnvironmentMetric, value: number | null | undefined, context: EnvironmentThresholdContext = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const rule = resolveEnvironmentThresholdRule(metric, context);
  if (!rule) return null;
  if (valueInRuleRange(value, rule.dangerMin, rule.dangerMax)) return 'danger' as const;
  if (valueInRuleRange(value, rule.warningMin, rule.warningMax)) return 'warning' as const;
  if (valueInRuleRange(value, rule.normalMin, rule.normalMax)) return 'normal' as const;
  const dangerMin = numeric(rule.dangerMin);
  const warningMax = numeric(rule.warningMax);
  const normalMin = numeric(rule.normalMin);
  if (dangerMin !== null && value >= dangerMin) return 'danger' as const;
  if (warningMax !== null && value > warningMax) return 'danger' as const;
  if (normalMin !== null && value < normalMin) return 'normal' as const;
  return null;
}

export function resolveEnvironmentThresholdRule(metric: EnvironmentMetric, context: EnvironmentThresholdContext = {}) {
  const candidates = loadEnvironmentThresholdRules()
    .filter((rule) => rule.enabled !== false && rule.metric === metric && thresholdRuleMatches(rule, context))
    .sort((a, b) => thresholdScopeRank(b.scope) - thresholdScopeRank(a.scope));
  return candidates[0];
}

function normalizeRule(value: Partial<EnvironmentThresholdRule> | null | undefined): EnvironmentThresholdRule | null {
  if (!value) return null;
  const allowedMetrics = ENVIRONMENT_METRIC_OPTIONS.map((item) => item.value);
  const metric = allowedMetrics.includes(value.metric as EnvironmentMetric) ? value.metric as EnvironmentMetric : 'temperature';
  const allowedScopes = ENVIRONMENT_THRESHOLD_SCOPE_OPTIONS.map((item) => item.value);
  const scope = allowedScopes.includes(value.scope as EnvironmentThresholdScope) ? value.scope as EnvironmentThresholdScope : 'global';
  return {
    id: String(value.id || crypto.randomUUID()),
    metric,
    scope,
    target: String(value.target || (scope === 'global' ? '*' : '')).trim() || '*',
    normalMin: String(value.normalMin ?? ''),
    normalMax: String(value.normalMax ?? ''),
    warningMin: String(value.warningMin ?? ''),
    warningMax: String(value.warningMax ?? ''),
    dangerMin: String(value.dangerMin ?? ''),
    dangerMax: String(value.dangerMax ?? ''),
    enabled: value.enabled !== false,
    updated_at: String(value.updated_at || new Date().toISOString()),
  };
}

function thresholdRuleMatches(rule: EnvironmentThresholdRule, context: EnvironmentThresholdContext) {
  const target = normalize(rule.target);
  if (rule.scope === 'global' || target === '*' || target === 'all') return true;
  if (rule.scope === 'component') return [context.componentName, context.componentId].some((value) => normalize(value) === target);
  if (rule.scope === 'device') return [context.deviceName, context.deviceId].some((value) => normalize(value) === target);
  if (rule.scope === 'rack') return normalize(context.rack) === target;
  if (rule.scope === 'room') return normalize(context.room) === target;
  if (rule.scope === 'location') return normalize(context.location) === target;
  if (rule.scope === 'site') return normalize(context.site) === target;
  if (rule.scope === 'component_type') return normalize(context.componentType) === target;
  if (rule.scope === 'component_category') return normalize(context.componentCategory) === target;
  return false;
}

function thresholdScopeRank(scope: EnvironmentThresholdScope) {
  if (scope === 'component') return 9;
  if (scope === 'device') return 8;
  if (scope === 'rack') return 7;
  if (scope === 'room') return 6;
  if (scope === 'location') return 5;
  if (scope === 'site') return 4;
  if (scope === 'component_type') return 3;
  if (scope === 'component_category') return 2;
  return 1;
}

function valueInRuleRange(value: number, minValue: string, maxValue: string) {
  const min = numeric(minValue);
  const max = numeric(maxValue);
  if (min === null && max === null) return false;
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

function numeric(value: string) {
  const parsed = Number(String(value || '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}
