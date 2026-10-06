import { createHash } from 'node:crypto';

export const EVENT_REPLAY_WINDOW_MS = 2 * 60_000;

export function createEventFingerprint(context, data) {
  const canonicalEvent = {
    domain: data.domain.trim().toLowerCase(),
    eventType: data.eventType,
    riskScore: data.riskScore,
    severity: data.severity,
    maskedPreview: (data.maskedPreview ?? '').normalize('NFC'),
    findingLabels: (data.findingLabels ?? []).map(label => label.trim().normalize('NFC')).sort(),
  };
  const canonicalRequest = {
    orgId: String(context.orgId),
    deviceId: String(context.deviceId),
    event: canonicalEvent,
  };

  return createHash('sha256').update(JSON.stringify(canonicalRequest)).digest('hex');
}
