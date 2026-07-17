import { ChangeEvent, FormEvent, useState } from 'react';
import { Image, Palette, RotateCcw, Save, SlidersHorizontal, Type } from 'lucide-react';

export type BrandingSettings = {
  appName: string;
  tagline: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  darkBackgroundColor: string;
  lightBackgroundColor: string;
  sideMenuBackgroundColor: string;
  logoDataUrl: string;
  compactLogo: boolean;
  borderRadius: number;
  shadowStrength: number;
};

export const BRANDING_STORAGE_KEY = 'aims-branding-settings';

export const defaultBranding: BrandingSettings = {
  appName: 'AIMS',
  tagline: 'NETWORK OPS',
  primaryColor: '#2879e7',
  secondaryColor: '#38bdf8',
  accentColor: '#a855f7',
  darkBackgroundColor: '#06111f',
  lightBackgroundColor: '#eef3f8',
  sideMenuBackgroundColor: '#ffffff',
  logoDataUrl: '',
  compactLogo: false,
  borderRadius: 8,
  shadowStrength: 28,
};

export function loadBrandingSettings(): BrandingSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(BRANDING_STORAGE_KEY) || 'null') as Partial<BrandingSettings> | null;
    return { ...defaultBranding, ...(saved || {}) };
  } catch {
    return defaultBranding;
  }
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized.padEnd(6, '0').slice(0, 6);
  const number = Number.parseInt(value, 16);
  return `${(number >> 16) & 255},${(number >> 8) & 255},${number & 255}`;
}

export function applyBrandingSettings(settings: BrandingSettings) {
  const root = document.body.style;
  const radius = Number.isFinite(settings.borderRadius) ? settings.borderRadius : defaultBranding.borderRadius;
  const shadowStrength = Number.isFinite(settings.shadowStrength) ? settings.shadowStrength : defaultBranding.shadowStrength;
  const shadowAlpha = Math.max(0, Math.min(0.55, shadowStrength / 100));
  const shadowY = Math.round(4 + shadowStrength * 0.35);
  const shadowBlur = Math.round(10 + shadowStrength * 0.9);
  root.setProperty('--brand-primary', settings.primaryColor);
  root.setProperty('--brand-secondary', settings.secondaryColor);
  root.setProperty('--brand-accent', settings.accentColor);
  root.setProperty('--brand-border', '#d8e3ef');
  root.setProperty('--brand-border-rgb', '216,227,239');
  root.setProperty('--brand-border-dark', '#1d354f');
  root.setProperty('--brand-border-dark-rgb', '29,53,79');
  root.setProperty('--brand-bg-dark', settings.darkBackgroundColor || defaultBranding.darkBackgroundColor);
  root.setProperty('--brand-bg-light', settings.lightBackgroundColor || defaultBranding.lightBackgroundColor);
  root.setProperty('--brand-sidebar-bg', settings.sideMenuBackgroundColor || defaultBranding.sideMenuBackgroundColor);
  root.setProperty('--brand-primary-rgb', hexToRgb(settings.primaryColor));
  root.setProperty('--brand-secondary-rgb', hexToRgb(settings.secondaryColor));
  root.setProperty('--brand-accent-rgb', hexToRgb(settings.accentColor));
  root.setProperty('--brand-logo-fit', settings.compactLogo ? 'contain' : 'cover');
  root.setProperty('--brand-radius', `${radius}px`);
  root.setProperty('--brand-radius-sm', `${Math.max(2, radius - 3)}px`);
  root.setProperty('--brand-radius-lg', `${radius + 4}px`);
  root.setProperty('--brand-shadow-strength', String(shadowStrength));
  root.setProperty('--brand-shadow', `0 ${shadowY}px ${shadowBlur}px rgba(2,8,18,${shadowAlpha})`);
  root.setProperty('--brand-shadow-soft', `0 ${Math.max(1, Math.round(shadowY / 2))}px ${Math.max(4, Math.round(shadowBlur / 2))}px rgba(2,8,18,${Math.max(0, shadowAlpha - 0.08)})`);
}

type BrandingSettingsPageProps = {
  value: BrandingSettings;
  onChange: (settings: BrandingSettings) => void;
};

export function BrandingSettingsPage({ value, onChange }: BrandingSettingsPageProps) {
  const [draft, setDraft] = useState<BrandingSettings>(value);
  const [message, setMessage] = useState('');

  const update = (patch: Partial<BrandingSettings>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onChange(next);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    localStorage.setItem(BRANDING_STORAGE_KEY, JSON.stringify(draft));
    onChange(draft);
    setMessage('Branding settings saved.');
  };

  const reset = () => {
    localStorage.removeItem(BRANDING_STORAGE_KEY);
    setDraft(defaultBranding);
    onChange(defaultBranding);
    setMessage('Branding reset to default.');
  };

  const uploadLogo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update({ logoDataUrl: String(reader.result || '') });
    reader.readAsDataURL(file);
  };

  return (
    <div className="content branding-page">
      <div className="page-title">
        <div>
          <h1>Branding Settings</h1>
          <p>Control the application name, colors, logo, and brand presentation.</p>
        </div>
        <button className="plain-button" type="button" onClick={reset}>
          <RotateCcw size={16} /> Reset
        </button>
      </div>

      {message && (
        <div className="module-notice branding-notice">
          {message}
          <button type="button" onClick={() => setMessage('')}>x</button>
        </div>
      )}

      <div className="branding-layout">
        <form className="card branding-form" onSubmit={save}>
          <div className="card-title">Brand Controls</div>

          <section>
            <h3><Type size={16} /> Identity</h3>
            <div className="form-grid">
              <label>
                App name
                <input value={draft.appName} onChange={(event) => update({ appName: event.target.value })} placeholder="AIMS" />
              </label>
              <label>
                Tagline
                <input value={draft.tagline} onChange={(event) => update({ tagline: event.target.value })} placeholder="NETWORK OPS" />
              </label>
            </div>
          </section>

          <section>
            <h3><Palette size={16} /> Colors</h3>
            <div className="brand-color-grid">
              <label>
                Primary
                <span><input type="color" value={draft.primaryColor} onChange={(event) => update({ primaryColor: event.target.value })} /><input value={draft.primaryColor} onChange={(event) => update({ primaryColor: event.target.value })} /></span>
              </label>
              <label>
                Secondary
                <span><input type="color" value={draft.secondaryColor} onChange={(event) => update({ secondaryColor: event.target.value })} /><input value={draft.secondaryColor} onChange={(event) => update({ secondaryColor: event.target.value })} /></span>
              </label>
              <label>
                Accent
                <span><input type="color" value={draft.accentColor} onChange={(event) => update({ accentColor: event.target.value })} /><input value={draft.accentColor} onChange={(event) => update({ accentColor: event.target.value })} /></span>
              </label>
              <label>
                Dark background
                <span><input type="color" value={draft.darkBackgroundColor} onChange={(event) => update({ darkBackgroundColor: event.target.value })} /><input value={draft.darkBackgroundColor} onChange={(event) => update({ darkBackgroundColor: event.target.value })} /></span>
              </label>
              <label>
                Light background
                <span><input type="color" value={draft.lightBackgroundColor} onChange={(event) => update({ lightBackgroundColor: event.target.value })} /><input value={draft.lightBackgroundColor} onChange={(event) => update({ lightBackgroundColor: event.target.value })} /></span>
              </label>
              <label>
                Side menu background
                <span><input type="color" value={draft.sideMenuBackgroundColor} onChange={(event) => update({ sideMenuBackgroundColor: event.target.value })} /><input value={draft.sideMenuBackgroundColor} onChange={(event) => update({ sideMenuBackgroundColor: event.target.value })} /></span>
              </label>
            </div>
          </section>

          <section>
            <h3><Image size={16} /> Logo</h3>
            <div className="brand-logo-tools">
              <label className="brand-upload">
                Upload logo
                <input type="file" accept="image/*" onChange={uploadLogo} />
              </label>
              <label className="toggle-row">
                Keep full logo visible
                <input type="checkbox" checked={draft.compactLogo} onChange={(event) => update({ compactLogo: event.target.checked })} />
              </label>
              {draft.logoDataUrl && <button type="button" className="plain-button" onClick={() => update({ logoDataUrl: '' })}>Remove logo</button>}
            </div>
          </section>

          <section>
            <h3><SlidersHorizontal size={16} /> Shape & Shadows</h3>
            <div className="brand-range-grid">
              <label>
                Border radius
                <span>{draft.borderRadius}px</span>
                <input type="range" min="0" max="24" value={draft.borderRadius} onChange={(event) => update({ borderRadius: Number(event.target.value) })} />
              </label>
              <label>
                Shadow strength
                <span>{draft.shadowStrength}%</span>
                <input type="range" min="0" max="80" value={draft.shadowStrength} onChange={(event) => update({ shadowStrength: Number(event.target.value) })} />
              </label>
            </div>
          </section>

          <div className="form-actions">
            <button type="button" onClick={reset}>Reset</button>
            <button className="add" type="submit"><Save size={16} /> Save branding</button>
          </div>
        </form>

        <section className="card brand-preview-card">
          <div className="card-title">Live Preview</div>
          <div className="brand-preview-shell">
            <div className="brand-preview-sidebar">
              <div className="brand-preview-lockup">
                <span className="brandmark brand-preview-mark">
                  {draft.logoDataUrl ? <img src={draft.logoDataUrl} alt="" /> : <Palette size={20} />}
                </span>
                <span>{draft.appName || 'AIMS'}<small>{draft.tagline || 'NETWORK OPS'}</small></span>
              </div>
              <button className="active">Dashboard</button>
              <button>Devices</button>
              <button>Settings</button>
            </div>
            <div className="brand-preview-main">
              <div className="brand-preview-header">
                <span />
                <button className="add">Primary action</button>
              </div>
              <div className="brand-preview-cardlet">
                <i />
                <b>{draft.appName || 'AIMS'} Operations</b>
                <p>Colors, shadows, radius, and logo settings are applied across the shell.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
