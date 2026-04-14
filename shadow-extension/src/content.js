/**
 * Shadow AI Auditor — Content Script (self-contained, no ES module imports)
 * Detection engine is inlined so Chrome MV3 content scripts work correctly.
 */

// ═══════════════════════════════════════════════════════════════════════════
// DETECTION ENGINE (inlined from detectionEngine.js)
// ═══════════════════════════════════════════════════════════════════════════

// shadow-extension/src/content.js

const PATTERNS = [
  { re: /\bAKIA[0-9A-Z]{16}\b/g, score: 90, label: "AWS Access Key" },
  {
    re: /\bsk_(live|test)_[0-9a-zA-Z]{24,}\b/g,
    score: 95,
    label: "Stripe Secret Key",
  },
  {
    re: /\bpk_(live|test)_[0-9a-zA-Z]{24,}\b/g,
    score: 60,
    label: "Stripe Publishable Key",
  },
  { re: /\bghp_[0-9a-zA-Z]{36}\b/g, score: 90, label: "GitHub Personal Token" },
  { re: /\bgho_[0-9a-zA-Z]{36}\b/g, score: 90, label: "GitHub OAuth Token" },
  { re: /\bnpm_[0-9a-zA-Z]{36}\b/g, score: 85, label: "NPM Token" },
  {
    re: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    score: 70,
    label: "JWT Token",
  },
  {
    re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    score: 99,
    label: "Private Key",
  },
  {
    re: /(mongodb|postgres|mysql|redis):\/\/[^\s"']{8,}/gi,
    score: 85,
    label: "Database Connection String",
  },
  { re: /\b\d{3}-\d{2}-\d{4}\b/g, score: 95, label: "Social Security Number" },
  {
    re: /\b4[0-9]{12}(?:[0-9]{3})?\b|\b5[1-5][0-9]{14}\b/g,
    score: 98,
    label: "Credit Card Number",
  },
  {
    re: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
    score: 40,
    label: "Email Address",
  },
  {
    re: /(password|passwd|secret|api_key)\s*[:=]\s*["']?[^\s"',;]{6,}/gi,
    score: 65,
    label: "Password/Secret",
  },
];

const KEYWORDS = [
  { word: "confidential", score: 40 },
  { word: "internal only", score: 50 },
  { word: "do not share", score: 60 },
  { word: "not for distribution", score: 55 },
  { word: "trade secret", score: 70 },
  { word: "attorney-client", score: 80 },
  { word: "private key", score: 85 },
  { word: "access token", score: 65 },
  { word: "bearer token", score: 65 },
  { word: "classified", score: 75 },
];

function maskToken(str) {
  if (str.length <= 8) return "****";
  return str.slice(0, 4) + "****" + str.slice(-4);
}

function analyse(text) {
  if (!text || text.trim().length < 10) {
    return { score: 0, severity: "LOW", findings: [], maskedPreview: "" };
  }

  const findings = [];
  let maxScore = 0;
  let maskedText = text;

  for (const { re, score, label } of PATTERNS) {
    re.lastIndex = 0;
    const matches = [...text.matchAll(re)];
    if (matches.length > 0) {
      findings.push({ label, count: matches.length, score });
      matches.forEach((m) => {
        maskedText = maskedText.replace(m[0], maskToken(m[0]));
      });
      if (score > maxScore) maxScore = score;
    }
  }

  const lower = text.toLowerCase();
  for (const { word, score } of KEYWORDS) {
    if (lower.includes(word)) {
      findings.push({ label: word, score });
      if (score > maxScore) maxScore = score;
    }
  }

  const severity = maxScore >= 70 ? "HIGH" : maxScore >= 40 ? "MEDIUM" : "LOW";
  const maskedPreview = maskedText.slice(0, 150).replace(/\n/g, " ");

  return { score: maxScore, severity, findings, maskedPreview };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const BACKEND_URL = "http://localhost:3001";
const TYPING_DEBOUNCE_MS = 1500;
const MIN_TEXT_LENGTH = 8;
const HIGH_RISK_THRESHOLD = 70;

const DOMAIN_NAMES = {
  "chat.openai.com": "ChatGPT",
  "claude.ai": "Claude",
  "gemini.google.com": "Gemini",
  "copilot.microsoft.com": "Microsoft Copilot",
  "perplexity.ai": "Perplexity",
  "poe.com": "Poe",
  "character.ai": "Character.ai",
};

const currentDomain = window.location.hostname;
const aiToolName = DOMAIN_NAMES[currentDomain] || currentDomain;

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

let lastAnalysedText = "";
let typingTimer = null;
let modalActive = false;
let pendingSubmit = null;
let userId = null;
let enabled = true;

// Load settings from extension storage
chrome.storage.sync.get(["userId", "enabled", "optedOut"], (result) => {
  userId = result.userId ?? null;
  enabled = result.enabled !== false;
  if (!result.optedOut) {
    console.log(
      "[Shadow AI] Content script active on",
      currentDomain,
      "| user:",
      userId,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CORE CHECK
// ═══════════════════════════════════════════════════════════════════════════

function checkContent(text, eventType) {
  if (!enabled) return;
  if (!text || text.length < MIN_TEXT_LENGTH) return;
  if (text === lastAnalysedText) return;
  lastAnalysedText = text;

  const result = analyse(text);
  if (result.score === 0) return;

  console.log(
    "[Shadow AI] Detected:",
    result.severity,
    result.score,
    result.findings.map((f) => f.label),
  );

  // Update session stats in popup
  chrome.storage.sync.get(["sessionStats"], (s) => {
    const stats = s.sessionStats ?? { total: 0, flagged: 0, high: 0 };
    stats.total++;
    if (result.severity !== "LOW") stats.flagged++;
    if (result.severity === "HIGH") stats.high++;
    chrome.storage.sync.set({ sessionStats: stats });
  });

  // Send event to backend
  if (result.severity !== "LOW") {
    sendEvent({
      eventType,
      domain: currentDomain,
      riskScore: result.score,
      severity: result.severity,
      maskedPreview: result.maskedPreview,
      findingLabels: result.findings.map((f) => f.label),
    });
  }

  // Show modal for HIGH risk
  if (result.score >= HIGH_RISK_THRESHOLD && !modalActive) {
    showWarningModal(result);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SEND EVENT TO BACKEND
// ═══════════════════════════════════════════════════════════════════════════

function sendEvent(payload) {
  fetch(`${BACKEND_URL}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: userId ?? "unknown",
      timestamp: new Date().toISOString(),
      ...payload,
    }),
  })
    .then((r) => console.log("[Shadow AI] Event sent, status:", r.status))
    .catch((e) => console.warn("[Shadow AI] Failed to send event:", e.message));
}

// ═══════════════════════════════════════════════════════════════════════════
// WARNING MODAL
// ═══════════════════════════════════════════════════════════════════════════

function showWarningModal(result) {
  if (document.getElementById("shadow-ai-modal")) return;
  modalActive = true;

  const overlay = document.createElement("div");
  overlay.id = "shadow-ai-modal";

  const severityColor = result.severity === "HIGH" ? "#ef4444" : "#f59e0b";

  overlay.innerHTML = `
    <div id="sam-backdrop" style="
      position:fixed;inset:0;z-index:2147483646;
      background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);
    "></div>
    <div id="sam-box" style="
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      z-index:2147483647;
      background:#1a1a2e;border:1px solid rgba(255,255,255,0.12);
      border-radius:16px;padding:28px;width:420px;max-width:calc(100vw - 32px);
      box-shadow:0 24px 64px rgba(0,0,0,0.6);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      color:#e8e8f0;
    ">
      <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:18px">
        <div style="font-size:32px;flex-shrink:0;line-height:1">⚠️</div>
        <div>
          <h2 style="margin:0 0 4px;font-size:17px;font-weight:600;color:#fff">
            Sensitive Data Detected
          </h2>
          <p style="margin:0;font-size:13px;color:#9494a8">
            You are about to share sensitive data with <strong style="color:#e2e2f0">${aiToolName}</strong>
          </p>
        </div>
      </div>

      <div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#9494a8;margin-bottom:6px">
          <span>Risk Score</span>
          <span style="font-weight:600;color:${severityColor}">${result.score}/100 · ${result.severity}</span>
        </div>
        <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${result.score}%;background:${severityColor};border-radius:99px;transition:width 0.4s"></div>
        </div>
      </div>

      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px;margin-bottom:16px">
        <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9494a8;font-weight:600">
          Detected patterns
        </p>
        <ul style="margin:0;padding:0;list-style:none">
          ${result.findings
            .slice(0, 5)
            .map(
              (f) => `
            <li style="font-size:13px;color:#f87171;padding:3px 0;display:flex;align-items:center;gap:6px">
              <span style="color:#ef4444">•</span> ${f.label}${f.count > 1 ? ` (×${f.count})` : ""}
            </li>
          `,
            )
            .join("")}
        </ul>
      </div>

      ${
        result.maskedPreview
          ? `
        <div style="margin-bottom:16px">
          <p style="margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#9494a8;font-weight:600">
            Preview (masked)
          </p>
          <code style="display:block;font-family:'Courier New',monospace;font-size:11px;color:#b4b4c8;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:10px 12px;word-break:break-all;white-space:pre-wrap">
            ${result.maskedPreview.replace(/</g, "&lt;").replace(/>/g, "&gt;")}
          </code>
        </div>
      `
          : ""
      }

      <div style="display:flex;gap:10px;margin-bottom:12px">
        <button id="sam-cancel" style="
          flex:1;padding:11px 16px;border-radius:10px;font-size:14px;font-weight:500;
          cursor:pointer;border:1px solid rgba(255,255,255,0.12);
          background:rgba(255,255,255,0.08);color:#e8e8f0;font-family:inherit;
        ">
          Cancel — Don't Send
        </button>
        <button id="sam-proceed" style="
          flex:1;padding:11px 16px;border-radius:10px;font-size:14px;font-weight:500;
          cursor:pointer;border:1px solid rgba(239,68,68,0.3);
          background:rgba(239,68,68,0.15);color:#f87171;font-family:inherit;
        ">
          Proceed Anyway
        </button>
      </div>

      <p style="margin:0;text-align:center;font-size:11px;color:#555568">
        Managed by your company's AI security policy
      </p>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("sam-cancel").onclick = () => {
    sendEvent({
      eventType: "modal_cancel",
      domain: currentDomain,
      riskScore: result.score,
      severity: result.severity,
      maskedPreview: result.maskedPreview,
    });
    closeModal();
  };

  document.getElementById("sam-proceed").onclick = () => {
    sendEvent({
      eventType: "modal_proceed",
      domain: currentDomain,
      riskScore: result.score,
      severity: result.severity,
      maskedPreview: result.maskedPreview,
    });
    closeModal();
    const cb = pendingSubmit;
    pendingSubmit = null;
    if (cb) cb();
  };

  document.getElementById("sam-backdrop").onclick = closeModal;
  document.addEventListener("keydown", handleEsc);
}

function closeModal() {
  const el = document.getElementById("shadow-ai-modal");
  if (el) el.remove();
  modalActive = false;
  document.removeEventListener("keydown", handleEsc);
}

function handleEsc(e) {
  if (e.key === "Escape") closeModal();
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════════════════

// Enhanced paste detection — robust for all AI chat UIs
document.addEventListener(
  "paste",
  (e) => {
    let text = e.clipboardData?.getData("text") ?? "";
    let target = e.target;
    console.log("[Shadow AI] Paste event:", {
      length: text.length,
      tag: target.tagName,
      id: target.id,
      class: target.className,
    });
    // Try to get value from input/textarea/contenteditable
    if (
      target &&
      (target.tagName === "TEXTAREA" ||
        target.tagName === "INPUT" ||
        target.isContentEditable)
    ) {
      text = target.value ?? target.innerText ?? target.textContent ?? text;
    }
    if (text.length >= MIN_TEXT_LENGTH) {
      checkContent(text, "paste");
    }
  },
  true,
);

// Typing detection (debounced, robust)
document.addEventListener(
  "input",
  (e) => {
    const el = e.target;
    const isInput =
      el.tagName === "TEXTAREA" ||
      el.tagName === "INPUT" ||
      el.isContentEditable ||
      el.getAttribute("contenteditable") === "true";
    if (!isInput) return;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      const text = el.value ?? el.innerText ?? el.textContent ?? "";
      console.log("[Shadow AI] Input event detected:", {
        tag: el.tagName,
        id: el.id,
        class: el.className,
        textLength: text.length,
      });
      checkContent(text, "typing");
    }, TYPING_DEBOUNCE_MS);
  },
  true,
);

// Submit button interception (robust for multiple AI UIs)
document.addEventListener(
  "click",
  (e) => {
    // Try to match send buttons for various AI chat UIs
    const btn = e.target.closest(
      'button[data-testid*="send"], button[aria-label*="Send"], [data-testid="send-button"], button[aria-label="Submit"]',
    );
    if (!btn) return;

    // Try to find the nearest input/textarea/contenteditable ancestor
    function getInputBox() {
      return document.querySelector(
        'div[contenteditable="true"][role="textbox"], div[contenteditable="true"]',
      );
    }
    if (!input) {
      // Fallback: look for focused element
      input = document.activeElement;
    }
    if (!input) return;

    const text = input.value ?? input.innerText ?? input.textContent ?? "";
    console.log("[Shadow AI] Submit event detected:", {
      textLength: text.length,
      tag: input.tagName,
      id: input.id,
      class: input.className,
    });
    if (text.length < MIN_TEXT_LENGTH) return;

    const result = analyse(text);
    if (result.score >= HIGH_RISK_THRESHOLD && !modalActive) {
      e.stopPropagation();
      e.preventDefault();
      pendingSubmit = () => btn.click();
      showWarningModal(result);
    }
  },
  true,
);

console.log("[Shadow AI] Content script loaded on", currentDomain);
