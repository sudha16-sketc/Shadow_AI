// backend/src/services/metrics.js
/**
 * Lightweight in-process operational metrics.
 *
 * Keeps a bounded ring buffer of recent server errors as safe operational
 * metadata (method, path, status, category, time). No stack traces, request
 * bodies, or secrets are retained. Intended for the platform health view.
 */
const MAX_RECENT_ERRORS = 50;
const recentErrors = [];

export function recordServerError({ method, path, status, category } = {}) {
  recentErrors.push({
    at: new Date().toISOString(),
    method: String(method ?? '').slice(0, 10),
    path: String(path ?? '').split('?')[0].slice(0, 200),
    status: Number.isInteger(status) ? status : 500,
    category: String(category ?? 'server_error').slice(0, 40),
  });
  if (recentErrors.length > MAX_RECENT_ERRORS) recentErrors.splice(0, recentErrors.length - MAX_RECENT_ERRORS);
}

export function getRecentErrors() {
  return recentErrors.slice().reverse();
}

export function clearRecentErrors() {
  recentErrors.length = 0;
}
