export type EnvironmentMetric = 'temperature' | 'power';
export type EnvironmentThresholdScope = 'global' | 'location' | 'room' | 'rack' | 'device';
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
  location?: string | null;
  room?: string | null;
  rack?: string | null;
};

export const ENVIRONMENT_THRESHOLDS_STORAGE_KEY = 'aims-environment-threshold-rules';
export const ENVIRONMENT_THRESHOLDS_SETTING_KEY = 'environment_threshold_rules';

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
  const metric = value.metric === 'power' ? 'power' : 'temperature';
  const allowedScopes: EnvironmentThresholdScope[] = ['global', 'location', 'room', 'rack', 'device'];
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
  if (rule.scope === 'device') return [context.deviceName, context.deviceId].some((value) => normalize(value) === target);
  if (rule.scope === 'rack') return normalize(context.rack) === target;
  if (rule.scope === 'room') return normalize(context.room) === target;
  if (rule.scope === 'location') return normalize(context.location) === target;
  return false;
}

function thresholdScopeRank(scope: EnvironmentThresholdScope) {
  if (scope === 'device') return 5;
  if (scope === 'rack') return 4;
  if (scope === 'room') return 3;
  if (scope === 'location') return 2;
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
