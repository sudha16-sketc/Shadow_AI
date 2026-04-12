/**
 * Shadow AI Auditor — Background Service Worker
 * Manages user session, sends batched events, handles alarms.
 */

const BACKEND_URL = 'https://your-api.shadow-auditor.com';
const AI_DOMAINS = [
  'chat.openai.com', 'claude.ai', 'gemini.google.com',
  'copilot.microsoft.com', 'bard.google.com', 'poe.com',
  'character.ai', 'perplexity.ai',
];

// Event queue for batching
let eventQueue = [];

// ─── Install / Startup ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // Generate a device/session ID if not set
  chrome.storage.sync.get(['userId'], ({ userId }) => {
    if (!userId) {
      const id = 'user_' + Math.random().toString(36).slice(2, 10);
      chrome.storage.sync.set({ userId: id, enabled: true, optedOut: false });
    }
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
    eventQueue.push({ ...msg.payload, tabId: sender.tab?.id });
    // Flush immediately for HIGH risk
    if (msg.payload.severity === 'HIGH') flushEvents();
  }
  if (msg.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(['userId', 'enabled', 'optedOut'], sendResponse);
    return true; // async
  }
});

// ─── Event flushing ───────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flushEvents') flushEvents();
});

async function flushEvents() {
  if (eventQueue.length === 0) return;
  const batch = eventQueue.splice(0, eventQueue.length);

  try {
    await fetch(`${BACKEND_URL}/api/events/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    // Re-queue on failure (up to 50 items to prevent memory bloat)
    eventQueue = [...batch.slice(-50), ...eventQueue];
  }
}