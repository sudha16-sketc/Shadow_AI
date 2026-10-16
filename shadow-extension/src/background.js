/**
 * Shadow AI Auditor — Background Service Worker
 * Manages user session, sends batched events, handles alarms.
 */

// shadow-extension/src/background.js

const BACKEND_URL = import.meta.env.VITE_API_URL;
const AI_DOMAINS = [
  'chat.openai.com', 'claude.ai', 'gemini.google.com',
  'copilot.microsoft.com', 'bard.google.com', 'poe.com',
  'character.ai', 'perplexity.ai',
];

// Event queue for batching
let eventQueue = [];

// ─── Install / Startup ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  chrome.storage.sync.get(['enabled', 'optedOut'], (settings) => {
    chrome.storage.sync.set({ enabled: settings.enabled !== false, optedOut: settings.optedOut === true });
  });

  // Alarm for periodic event flush
  chrome.alarms.create('flushEvents', { periodInMinutes: 1 });
});

// ─── Tab monitoring ───────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  try {
    const hostname = new URL(tab.url).hostname;
    if (AI_DOMAINS.some(d => hostname.includes(d))) {
      // Badge the extension icon
      chrome.action.setBadgeText({ text: '!', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId });
    } else {
      chrome.action.setBadgeText({ text: '', tabId });
    }
  } catch { /* invalid URL */ }
});

// ─── Message handling from content scripts ────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'LOG_EVENT') {
    if (!sender.tab?.url || !msg.payload || typeof msg.payload !== 'object') return;
    let hostname;
    try { hostname = new URL(sender.tab.url).hostname; } catch { return; }
    if (!AI_DOMAINS.includes(hostname)) return;

    const { domain, eventType, riskScore, severity, maskedPreview, findingLabels } = msg.payload;
    if (domain !== hostname || !['paste', 'typing', 'modal_cancel', 'modal_proceed', 'modal_mask'].includes(eventType)) return;
    if (!Number.isFinite(riskScore) || !['LOW', 'MEDIUM', 'HIGH'].includes(severity)) return;
    eventQueue.push({
      idempotencyKey: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      domain: hostname,
      eventType,
      riskScore,
      severity,
      maskedPreview: typeof maskedPreview === 'string' ? maskedPreview.slice(0, 200) : '',
      findingLabels: Array.isArray(findingLabels) ? findingLabels.filter(label => typeof label === 'string').slice(0, 20) : [],
    });
    // Flush immediately for HIGH risk
    if (severity === 'HIGH') flushEvents();
  }
  if (msg.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(['enabled', 'optedOut'], sendResponse);
    return true; // async
  }
  if (msg.type === 'REGISTER_DEVICE') {
    registerDevice(msg.code).then(sendResponse);
    return true;
  }
});

// ─── Event flushing ───────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flushEvents') flushEvents();
});

async function flushEvents() {
  if (eventQueue.length === 0) return;
  const { deviceToken } = await chrome.storage.local.get('deviceToken');
  if (!deviceToken) return;

  const batch = eventQueue.splice(0, eventQueue.length);

  try {
    const response = await fetch(`${BACKEND_URL}/api/events/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deviceToken}` },
      body: JSON.stringify({ events: batch }),
    });
    if (response.status === 401) {
      await chrome.storage.local.remove(['deviceToken', 'deviceId']);
      return;
    }
    if (!response.ok) throw new Error('Event batch rejected');
  } catch {
    // Re-queue on failure (up to 50 items to prevent memory bloat)
    eventQueue = [...batch.slice(-50), ...eventQueue];
  }
}

async function registerDevice(code) {
  if (typeof code !== 'string' || code.length < 32 || code.length > 128) {
    return { ok: false, error: 'Enter a valid pairing code.' };
  }

  try {
    const response = await fetch(`${BACKEND_URL}/api/auth/device/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await response.json();
    if (!response.ok) return { ok: false, error: data.error ?? 'Device enrollment failed.' };

    await chrome.storage.local.set({ deviceToken: data.token, deviceId: data.deviceId });
    return { ok: true, deviceId: data.deviceId };
  } catch {
    return { ok: false, error: 'Backend is unavailable.' };
  }
}