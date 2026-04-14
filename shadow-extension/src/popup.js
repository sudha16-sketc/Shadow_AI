// shadow-extension/src/popup.js
document.addEventListener("DOMContentLoaded", () => {
  const BASE_URL = "http://localhost:5173";
  const monitoredSites = [
    "chat.openai.com",
    "claude.ai",
    "gemini.google.com",
    "copilot.microsoft.com",
    "poe.com",
    "character.ai",
    "perplexity.ai",
    "bard.google.com",
  ];

  chrome.storage.sync.get(["userId", "enabled", "sessionStats"], (data) => {
    let userId = data.userId;

    if (!userId) {
      userId = "user_" + Math.random().toString(36).slice(2, 10);
      chrome.storage.sync.set({ userId });
    }

    const el = document.getElementById("user-id");
    if (el) el.textContent = userId;

    const enabled = data.enabled !== false;

    const toggle = document.getElementById("monitoring-toggle");
    if (toggle) toggle.checked = enabled;

    updateStatus(enabled);

    const stats = data.sessionStats ?? { total: 0, flagged: 0, high: 0 };

    const statTotal = document.getElementById("stat-total");
    if (statTotal) statTotal.textContent = stats.total;

    const statFlagged = document.getElementById("stat-flagged");
    if (statFlagged) statFlagged.textContent = stats.flagged;

    const statHigh = document.getElementById("stat-high");
    if (statHigh) statHigh.textContent = stats.high;
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs[0]?.url ?? "";

    try {
      const hostname = new URL(url).hostname;
      const el = document.getElementById("current-site");

      const isMonitored = monitoredSites.some((site) =>
        hostname.includes(site),
      );

      if (el) {
        el.textContent = hostname || "—";
        el.className =
          "site-name " + (isMonitored ? "site-monitored" : "site-safe");
      }
    } catch {}
  });

  document
    .getElementById("monitoring-toggle")
    ?.addEventListener("change", (e) => {
      const enabled = e.target.checked;
      chrome.storage.sync.set({ enabled });
      updateStatus(enabled);
    });

  function updateStatus(enabled) {
    const dot = document.getElementById("status-dot");
    if (dot) {
      dot.className = "dot " + (enabled ? "dot-green" : "dot-gray");
    }

    const text = document.getElementById("status-text");
    if (text) {
      text.textContent = enabled ? "Active" : "Paused";
    }
  }

  document.getElementById("copy-btn")?.addEventListener("click", () => {
    const userId = document.getElementById("user-id")?.textContent;
    if (!userId) return;

    navigator.clipboard.writeText(userId).then(() => {
      const btn = document.getElementById("copy-btn");
      if (!btn) return;

      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    });
  });

  document.getElementById("btn-dashboard")?.addEventListener("click", () => {
    chrome.tabs.create({ url: BASE_URL });
  });

  document.getElementById("btn-clear")?.addEventListener("click", () => {
    chrome.storage.sync.set({
      sessionStats: { total: 0, flagged: 0, high: 0 },
    });

    const statTotal = document.getElementById("stat-total");
    if (statTotal) statTotal.textContent = "0";

    const statFlagged = document.getElementById("stat-flagged");
    if (statFlagged) statFlagged.textContent = "0";

    const statHigh = document.getElementById("stat-high");
    if (statHigh) statHigh.textContent = "0";
  });
});
