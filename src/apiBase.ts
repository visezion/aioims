export const apiBase = (() => {
  const configured = (import.meta.env.VITE_API_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window === 'undefined') return 'http://127.0.0.1:8001/api/v1';
  return `${window.location.protocol}//${window.location.hostname}:8001/api/v1`;
})();

export function apiError(error: unknown, fallback = 'The AIMS API is unavailable. Check that the server is running on port 8001.') {
  if (error instanceof TypeError && /fetch/i.test(error.message)) return fallback;
  return error instanceof Error ? error.message : fallback;
}
