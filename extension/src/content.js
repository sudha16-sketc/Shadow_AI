/**
 * Shadow AI Auditor — Content Script
 * Injected into monitored AI domains. Watches paste + typing events,
 * runs the detection engine, and shows warning modals.
 */

import { analyse } from './detectionEngine.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const BACKEND_URL = ''; 
const TYPING_DEBOUNCE_MS = 1500;   // Wait 1.5s after last keystroke
const MIN_TEXT_LENGTH = 20;        // Ignore very short inputs
const HIGH_RISK_THRESHOLD = 70;    // Score >= this triggers modal

// ─── Domain helpers ───────────────────────────────────────────────────────────

const DOMAIN_NAMES = {
  'chat.openai.com':         'ChatGPT',
  'claude.ai':               'Claude',
  'gemini.google.com':       'Gemini',
  'copilot.microsoft.com':   'Microsoft Copilot',
  'bard.google.com':         'Google Bard',
  'poe.com':                 'Poe',
  'character.ai':            'Character.ai',
  'perplexity.ai':           'Perplexity',
};

const currentDomain = window.location.hostname;
const aiToolName = DOMAIN_NAMES[currentDomain] || currentDomain;

// ─── State ────────────────────────────────────────────────────────────────────

let lastAnalysedText = '';
let typingTimer = null;
let modalActive = false;
let pendingSubmit = null; // callback when user chooses "Proceed"

// ─── User settings (from storage) ────────────────────────────────────────────

let userSettings = {
  userId: null,
  enabled: true,
  optedOut: false,
};

chrome.storage.sync.get(['userId', 'enabled', 'optedOut'], (result) => {
  userSettings = { ...userSettings, ...result };
});

// ─── Find prompt textareas ────────────────────────────────────────────────────

/**
 * Attempt to locate the main prompt input across different AI UIs.
 * Falls back to any visible textarea or contenteditable.
 */
function findPromptInput() {
  const selectors = [
    'textarea[data-id="root"]',            // ChatGPT
    '#prompt-textarea',                    // ChatGPT v2
    'div[contenteditable="true"]',         // Claude, Gemini
    'textarea[placeholder*="message"]',   // Generic
    'textarea[placeholder*="Ask"]',
    'textarea',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return el; // visible check
  }
  return null;
}

// ─── Extract text from element ────────────────────────────────────────────────

function extractText(el) {
  return el.value ?? el.innerText ?? el.textContent ?? '';
}

// ─── Core: analyse and maybe warn ─────────────────────────────────────────────

async function checkContent(text, eventType) {
  if (!userSettings.enabled || userSettings.optedOut) return;
  if (text.length < MIN_TEXT_LENGTH) return;
  if (text === lastAnalysedText) return;

  lastAnalysedText = text;
  const result = analyse(text);

  if (result.score === 0) return;

  // Always log events above LOW
  if (result.severity !== 'LOW') {
    sendEvent({
      eventType,
      domain: currentDomain,
      riskScore: result.score,
      severity: result.severity,
      maskedPreview: result.maskedPreview,
      findingLabels: result.findings.map(f => f.label),
    });
  }

  // Only show modal for HIGH risk
  if (result.score >= HIGH_RISK_THRESHOLD && !modalActive) {
    showWarningModal(result);
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────────

async function sendEvent(payload) {
  try {
    await fetch(`${BACKEND_URL}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userSettings.userId,
        timestamp: new Date().toISOString(),
        ...payload,
      }),
    });
  } catch {
    // Fail silently — don't disrupt the user's workflow
  }
}

// ─── Warning Modal ────────────────────────────────────────────────────────────

function showWarningModal(result) {
  if (document.getElementById('shadow-ai-modal')) return;
  modalActive = true;

  const overlay = document.createElement('div');
  overlay.id = 'shadow-ai-modal';
  overlay.innerHTML = `
    <div class="sam-backdrop"></div>
    <div class="sam-modal" role="dialog" aria-modal="true" aria-labelledby="sam-title">
      <div class="sam-header">
        <div class="sam-icon">⚠️</div>
        <div>
          <h2 id="sam-title" class="sam-title">Sensitive Data Detected</h2>
          <p class="sam-subtitle">You're about to share potentially sensitive information with ${aiToolName}</p>
        </div>
      </div>
      
      <div class="sam-risk-bar">
        <div class="sam-risk-label">
          <span>Risk Score</span>
          <span class="sam-score sam-score-${result.severity.toLowerCase()}">${result.score}/100 · ${result.severity}</span>
        </div>
        <div class="sam-bar-track">
          <div class="sam-bar-fill sam-bar-${result.severity.toLowerCase()}" style="width: ${result.score}%"></div>
        </div>
      </div>

      <div class="sam-findings">
        <p class="sam-findings-title">Detected patterns:</p>
        <ul class="sam-findings-list">
          ${result.findings.slice(0, 5).map(f => `<li>${f.label}${f.count > 1 ? ` (×${f.count})` : ''}</li>`).join('')}
        </ul>
      </div>

      ${result.maskedPreview ? `
        <div class="sam-preview">
          <p class="sam-preview-label">Preview (masked):</p>
          <code class="sam-preview-text">${escapeHtml(result.maskedPreview)}</code>
        </div>` : ''}

      <div class="sam-actions">
        <button id="sam-cancel" class="sam-btn sam-btn-cancel">Cancel — Don't Send</button>
        <button id="sam-proceed" class="sam-btn sam-btn-proceed">Proceed Anyway</button>
      </div>

      <p class="sam-footer">This warning is managed by your company's AI security policy.</p>
    </div>
  `;

  document.body.appendChild(overlay);

  // Button handlers
  document.getElementById('sam-cancel').addEventListener('click', () => {
    sendEvent({ eventType: 'modal_cancel', domain: currentDomain, riskScore: result.score, severity: result.severity, maskedPreview: result.maskedPreview });
    closeModal();
  });

  document.getElementById('sam-proceed').addEventListener('click', () => {
    sendEvent({ eventType: 'modal_proceed', domain: currentDomain, riskScore: result.score, severity: result.severity, maskedPreview: result.maskedPreview });
    closeModal();
    if (pendingSubmit) { pendingSubmit(); pendingSubmit = null; }
  });

  // ESC to close
  document.addEventListener('keydown', handleEsc);
}

function closeModal() {
  const el = document.getElementById('shadow-ai-modal');
  if (el) el.remove();
  modalActive = false;
  document.removeEventListener('keydown', handleEsc);
}

function handleEsc(e) {
  if (e.key === 'Escape') closeModal();
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

// Paste detection (most important)
document.addEventListener('paste', async (e) => {
  const pastedText = e.clipboardData?.getData('text') ?? '';
  if (pastedText.length >= MIN_TEXT_LENGTH) {
    await checkContent(pastedText, 'paste');
  }
}, true);

// Typing detection (debounced)
document.addEventListener('input', (e) => {
  const el = e.target;
  const isTextInput = el.tagName === 'TEXTAREA' ||
    el.tagName === 'INPUT' ||
    el.getAttribute('contenteditable') === 'true';

  if (!isTextInput) return;

  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    const text = extractText(el);
    checkContent(text, 'typing');
  }, TYPING_DEBOUNCE_MS);
}, true);

// Form submit interception (for ChatGPT button click)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-testid*="send"], button[aria-label*="Send"], button[type="submit"]');
  if (!btn) return;

  const input = findPromptInput();
  if (!input) return;

  const text = extractText(input);
  if (text.length < MIN_TEXT_LENGTH) return;

  const result = analyse(text);
  if (result.score >= HIGH_RISK_THRESHOLD && !modalActive) {
    e.stopPropagation();
    e.preventDefault();
    pendingSubmit = () => btn.click();
    showWarningModal(result);
  }
}, true);

// ─── Observe DOM changes (SPAs) ───────────────────────────────────────────────
// Re-attach listeners if the input is replaced by SPA navigation
const observer = new MutationObserver(() => {
  // No-op: event listeners on document already capture everything via bubbling
});
observer.observe(document.body, { childList: true, subtree: true });