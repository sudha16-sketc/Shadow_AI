/**
 * Shadow AI Auditor — Content Script
 *
 * Detection engine is inlined so the built content script stays self-contained.
 * The interception workflow (operation tracking + submission gating) lives in
 * ./interceptionWorkflow.js and is bundled in by Vite.
 */
import {
  createInterceptionController,
  authorizeSubmission,
  shouldIntercept,
  OPERATION_STATUS,
} from "./interceptionWorkflow.js";

// ═══════════════════════════════════════════════════════════════════════════
// DETECTION ENGINE (inlined from detectionEngine.js)
// ═══════════════════════════════════════════════════════════════════════════

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
    re: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,
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

// Full-text masking used by the "Mask" editor. Only the matched sensitive
// spans are replaced; the remainder of the user's text is preserved.
function maskText(text) {
  if (!text) return "";
  let masked = text;
  for (const { re } of PATTERNS) {
    re.lastIndex = 0;
    const matches = [...text.matchAll(re)];
    matches.forEach((m) => {
      masked = masked.replace(m[0], maskToken(m[0]));
    });
  }
  return masked;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const TYPING_DEBOUNCE_MS = 1500;
const MIN_TEXT_LENGTH = 8;
const HIGH_RISK_THRESHOLD = 40;

const DOMAIN_NAMES = {
  "chat.openai.com": "ChatGPT",
  "chatgpt.com": "ChatGPT",
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

const controller = createInterceptionController();
let typingTimer = null;
let enabled = true;

// Load settings from extension storage
chrome.storage.sync.get(["enabled", "optedOut"], (result) => {
  enabled = result.enabled !== false;
  if (!result.optedOut) {
    console.log("[Shadow AI] Content script active on", currentDomain);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// INPUT HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function readInput(input) {
  if (!input) return "";
  return input.value ?? input.innerText ?? input.textContent ?? "";
}

function writeInput(input, next) {
  if (!input) return;
  if (typeof input.value === "string") {
    input.value = next;
  } else {
    input.innerText = next;
    input.textContent = next;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function findInputBox() {
  return document.querySelector(
    'div[contenteditable="true"][role="textbox"], textarea, div[contenteditable="true"]',
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CORE CHECK
// ═══════════════════════════════════════════════════════════════════════════

function recordStats(result) {
  chrome.storage.sync.get(["sessionStats"], (s) => {
    const stats = s.sessionStats ?? { total: 0, flagged: 0, high: 0 };
    stats.total++;
    if (result.severity !== "LOW") stats.flagged++;
    if (result.severity === "HIGH") stats.high++;
    chrome.storage.sync.set({ sessionStats: stats });
  });
}

function reportEvent(result, eventType) {
  if (result.score === 0) return;
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
}

// ═══════════════════════════════════════════════════════════════════════════
// SEND EVENT TO BACKEND
// ═══════════════════════════════════════════════════════════════════════════

function sendEvent(payload) {
  chrome.runtime.sendMessage({ type: "LOG_EVENT", payload: { ...payload } });
}

// ═══════════════════════════════════════════════════════════════════════════
// WARNING MODAL
// ═══════════════════════════════════════════════════════════════════════════

function showWarningModal(operation) {
  const existing = document.getElementById("shadow-ai-modal");
  if (existing) existing.remove();

  const result = operation.result ?? { score: 0, severity: "LOW", findings: [], maskedPreview: "" };
  const severityColor = result.severity === "HIGH" ? "#ef4444" : "#f59e0b";

  const overlay = document.createElement("div");
  overlay.id = "shadow-ai-modal";
  overlay.dataset.operationId = operation.id;

  overlay.innerHTML = `
    <div id="sam-backdrop" style="
      position:fixed;inset:0;z-index:2147483646;
      background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);
    "></div>
    <div id="sam-box" style="
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      z-index:2147483647;
      background:#1a1a2e;border:1px solid rgba(255,255,255,0.12);
      border-radius:16px;padding:28px;width:440px;max-width:calc(100vw - 32px);
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
        <button id="sam-mask" style="
          flex:1;padding:11px 16px;border-radius:10px;font-size:14px;font-weight:500;
          cursor:pointer;border:1px solid rgba(96,165,250,0.4);
          background:rgba(59,130,246,0.15);color:#93c5fd;font-family:inherit;
        ">
          Mask Data
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

  document.getElementById("sam-cancel").onclick = () => handleCancel(operation);
  document.getElementById("sam-mask").onclick = () => showMaskEditor(operation);
  document.getElementById("sam-proceed").onclick = () => handleProceed(operation);
  document.getElementById("sam-backdrop").onclick = () => handleCancel(operation);
  document.addEventListener("keydown", handleEsc);
}

function closeModal() {
  const el = document.getElementById("shadow-ai-modal");
  if (el) el.remove();
  document.removeEventListener("keydown", handleEsc);
}

function handleEsc(e) {
  if (e.key === "Escape") {
    const overlay = document.getElementById("shadow-ai-modal");
    const operationId = overlay?.dataset?.operationId;
    const operation = operationId ? controller.get(operationId) : null;
    if (operation) handleCancel(operation);
    else closeModal();
  }
}

function handleCancel(operation) {
  controller.markCancelled(operation.id);
  sendEvent({
    eventType: "modal_cancel",
    domain: currentDomain,
    riskScore: operation.result?.score ?? 0,
    severity: operation.result?.severity ?? "LOW",
    maskedPreview: operation.result?.maskedPreview ?? "",
  });
  // Removing the sensitive text is what prevents it being sent.
  if (operation.inputTarget) writeInput(operation.inputTarget, "");
  closeModal();
}

function handleProceed(operation) {
  controller.markApproved(operation.id);
  closeModal();
  sendEvent({
    eventType: "modal_proceed",
    domain: currentDomain,
    riskScore: operation.result?.score ?? 0,
    severity: operation.result?.severity ?? "LOW",
    maskedPreview: operation.result?.maskedPreview ?? "",
  });
  const target = operation.submitTarget;
  if (target) target.click();
}

// ═══════════════════════════════════════════════════════════════════════════
// MASK EDITOR
// ═══════════════════════════════════════════════════════════════════════════

function showMaskEditor(operation) {
  const existing = document.getElementById("shadow-ai-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "shadow-ai-modal";
  overlay.dataset.operationId = operation.id;

  overlay.innerHTML = `
    <div id="sam-backdrop" style="
      position:fixed;inset:0;z-index:2147483646;
      background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);
    "></div>
    <div id="sam-box" style="
      position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
      z-index:2147483647;
      background:#1a1a2e;border:1px solid rgba(255,255,255,0.12);
      border-radius:16px;padding:28px;width:480px;max-width:calc(100vw - 32px);
      box-shadow:0 24px 64px rgba(0,0,0,0.6);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      color:#e8e8f0;
    ">
      <h2 style="margin:0 0 4px;font-size:17px;font-weight:600;color:#fff">Mask sensitive data</h2>
      <p style="margin:0 0 14px;font-size:13px;color:#9494a8">
        Sensitive values are replaced below. Review and edit before sending.
      </p>
      <textarea id="sam-mask-text" style="
        width:100%;box-sizing:border-box;min-height:140px;resize:vertical;
        background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);
        border-radius:10px;padding:12px;color:#e8e8f0;font-family:'Courier New',monospace;
        font-size:12px;line-height:1.5;
      ">${maskText(operation.text).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</textarea>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button id="sam-mask-cancel" style="
          flex:1;padding:11px 16px;border-radius:10px;font-size:14px;font-weight:500;
          cursor:pointer;border:1px solid rgba(255,255,255,0.12);
          background:rgba(255,255,255,0.08);color:#e8e8f0;font-family:inherit;
        ">Cancel</button>
        <button id="sam-mask-apply" style="
          flex:1;padding:11px 16px;border-radius:10px;font-size:14px;font-weight:500;
          cursor:pointer;border:1px solid rgba(96,165,250,0.4);
          background:rgba(59,130,246,0.2);color:#bfdbfe;font-family:inherit;
        ">Apply & Rescan</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("sam-mask-cancel").onclick = () => handleCancel(operation);
  document.getElementById("sam-mask-apply").onclick = () => handleMaskApply(operation);
}

function handleMaskApply(operation) {
  const editor = document.getElementById("sam-mask-text");
  const edited = editor ? editor.value : "";
  const input = operation.inputTarget;
  if (input) writeInput(input, edited);

  // Mandatory rescan: the edited payload is analysed again before it can pass.
  const rescan = analyse(edited);
  controller.markMasked(operation.id, edited, rescan);
  sendEvent({
    eventType: "modal_mask",
    domain: currentDomain,
    riskScore: rescan.score,
    severity: rescan.severity,
    maskedPreview: rescan.maskedPreview,
  });

  if (shouldIntercept(rescan, HIGH_RISK_THRESHOLD)) {
    const refreshed = controller.get(operation.id);
    if (refreshed) {
      refreshed.status = OPERATION_STATUS.PENDING;
      refreshed.result = rescan;
    }
    closeModal();
    showWarningModal(controller.get(operation.id));
    return;
  }

  closeModal();
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════════════════

// Paste detection — every paste is inspected as an independent operation.
document.addEventListener(
  "paste",
  (e) => {
    if (!enabled) return;
    const text = e.clipboardData?.getData("text") ?? "";
    if (text.length < MIN_TEXT_LENGTH) return;

    const target =
      (e.target && e.target.closest
        ? e.target.closest('textarea, input, [contenteditable="true"]')
        : null) || document.activeElement;

    const result = analyse(text);
    recordStats(result);
    reportEvent(result, "paste");

    if (shouldIntercept(result, HIGH_RISK_THRESHOLD)) {
      const existing = controller.getBlockingOperation();
      if (existing) {
        existing.text = text;
        existing.result = result;
        if (target) existing.inputTarget = target;
        showWarningModal(existing);
      } else {
        const operation = controller.begin(text, result, { trigger: "paste" });
        operation.inputTarget = target;
        showWarningModal(operation);
      }
    }
  },
  true,
);

// Typing detection (debounced, metadata only).
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
      const text = readInput(el);
      console.log("[Shadow AI] Input event detected:", {
        tag: el.tagName,
        id: el.id,
        class: el.className,
        textLength: text.length,
      });
      const result = analyse(text);
      recordStats(result);
      reportEvent(result, "typing");
    }, TYPING_DEBOUNCE_MS);
  },
  true,
);

function interceptSubmit(e) {
  if (!enabled) return;
  const btn = e.target.closest(
    'button[data-testid*="send"], button[aria-label*="Send"], [data-testid="send-button"], button[aria-label="Submit"]',
  );
  if (!btn) return;

  const input = findInputBox() || document.activeElement;
  if (!input) return;

  const text = readInput(input);
  if (text.length < MIN_TEXT_LENGTH) return;

  const approval = controller.consumeApprovedForInput(text, input);
  const decision = authorizeSubmission(controller, text, {
    analyse,
    threshold: HIGH_RISK_THRESHOLD,
    trigger: "submit",
    approved: approval,
  });

  if (!decision.allowed) {
    e.stopPropagation();
    e.preventDefault();
    if (decision.reason === "high_risk" && decision.operation) {
      decision.operation.submitTarget = btn;
      decision.operation.inputTarget = input;
      showWarningModal(decision.operation);
    }
  }
}

document.addEventListener("click", interceptSubmit, true);

// Enter-to-send interception (many AI UIs submit on Enter without a click).
document.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    const el = e.target;
    const isInput =
      el &&
      (el.tagName === "TEXTAREA" ||
        el.tagName === "INPUT" ||
        el.isContentEditable ||
        el.getAttribute?.("contenteditable") === "true");
    if (!isInput) return;

    const text = readInput(el);
    if (text.length < MIN_TEXT_LENGTH) return;

    const approval = controller.consumeApprovedForInput(text, el);
    const decision = authorizeSubmission(controller, text, {
      analyse,
      threshold: HIGH_RISK_THRESHOLD,
      trigger: "submit",
      approved: approval,
    });

    if (!decision.allowed) {
      e.stopPropagation();
      e.preventDefault();
      if (decision.reason === "high_risk" && decision.operation) {
        decision.operation.inputTarget = el;
        showWarningModal(decision.operation);
      }
    }
  },
  true,
);

console.log("[Shadow AI] Content script loaded on", currentDomain);
