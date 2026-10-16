// backend/src/utils/telemetry.js
/**
 * Authentication telemetry helpers.
 *
 * Records authentication outcomes as minimal, non-sensitive telemetry so the
 * platform console can surface failures and suspicious activity. The email is
 * masked before persistence; passwords, tokens, and full identifiers are never
 * stored here. Writes are best-effort and must never affect the auth result.
 */
import { AuthEvent } from '../models/index.js';

export function maskEmail(email) {
  const value = String(email ?? '').trim().toLowerCase();
  const at = value.indexOf('@');
  if (at <= 0) return value ? '***' : '';
  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

export function recordAuthEvent({ outcome, scope, email, ip, reason } = {}) {
  if (outcome !== 'success' && outcome !== 'failure') return;
  if (scope !== 'tenant' && scope !== 'platform') return;
  Promise.resolve()
    .then(() => AuthEvent.create({
      outcome,
      scope,
      emailMasked: maskEmail(email),
      ip: typeof ip === 'string' ? ip.slice(0, 100) : undefined,
      reason: typeof reason === 'string' ? reason.slice(0, 100) : undefined,
      at: new Date(),
    }))
    .catch(() => {});
}
