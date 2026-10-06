// shadow-extension/src/popup.js
document.addEventListener("DOMContentLoaded", () => {
  const BASE_URL = import.meta.env.VITE_DASHBOARD_URL || "http://localhost:5173";
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

  chrome.storage.sync.get(["enabled", "sessionStats"], (data) => {
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

  chrome.storage.local.get(["deviceId"], ({ deviceId }) => {
    const status = document.getElementById('device-status');
    if (status) status.textContent = deviceId ? `Connected · ${deviceId.slice(0, 8)}` : 'Not connected';
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
    } catch {
      /* URL parsing is best-effort; the popup still renders */
    }
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

  document.getElementById('connect-device')?.addEventListener('click', () => {
    const input = document.getElementById('pairing-code');
    const status = document.getElementById('device-status');
    const button = document.getElementById('connect-device');
    if (!input?.value || !status || !button) return;

    button.disabled = true;
    status.textContent = 'Connecting…';
    chrome.runtime.sendMessage({ type: 'REGISTER_DEVICE', code: input.value.trim() }, result => {
      button.disabled = false;
      input.value = '';
      if (chrome.runtime.lastError || !result?.ok) {
        status.textContent = result?.error ?? 'Enrollment failed.';
        return;
      }
      status.textContent = `Connected · ${result.deviceId.slice(0, 8)}`;
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
