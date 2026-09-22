/**
 * Ananya Privacy Vision Agent — Popup Controller
 * Controls the agent lifecycle and displays privacy metrics.
 */

document.addEventListener("DOMContentLoaded", () => {

  // ============================================================
  // UI REFERENCES
  // ============================================================

  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const btnStart = document.getElementById("btnStart");
  const btnStop = document.getElementById("btnStop");
  const btnScan = document.getElementById("btnScan");
  const piiCount = document.getElementById("piiCount");
  const fieldCount = document.getElementById("fieldCount");
  const redactedCount = document.getElementById("redactedCount");
  const scanTime = document.getElementById("scanTime");
  const piiTags = document.getElementById("piiTags");
  const serverUrlInput = document.getElementById("serverUrlInput");
  const btnTargetTab = document.getElementById("btnTargetTab");
  const targetTabDisplay = document.getElementById("targetTabDisplay");

  // ============================================================
  // AGENT CONTROLS
  // ============================================================

  function startAgent() {
    chrome.runtime.sendMessage({ type: "START_AGENT" }, (response) => {
      if (response?.status === "started") {
        updateUI("active");
      }
    });
  }

  function stopAgent() {
    chrome.runtime.sendMessage({ type: "STOP_AGENT" }, (response) => {
      if (response?.status === "stopped") {
        updateUI("disconnected");
      }
    });
  }

  function manualScan() {
    btnScan.disabled = true;
    btnScan.textContent = "⏳ Scanning...";

    chrome.runtime.sendMessage({ type: "MANUAL_SCAN" }, (response) => {
      btnScan.disabled = false;
      btnScan.textContent = "🔍 Scan";

      if (response?.success && response.data) {
        displayScanResults(response.data);
      }
    });
  }

  function updateServerUrl() {
    const url = serverUrlInput.value.trim();
    if (url) {
      chrome.runtime.sendMessage({ type: "SET_SERVER_URL", url });
    }
  }

  function setTargetTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const tab = tabs[0];
        chrome.runtime.sendMessage({ type: "SET_TARGET_TAB", tabId: tab.id }, (response) => {
          if (response?.success) {
            targetTabDisplay.textContent = `Target: ${tab.title}`;
          }
        });
      }
    });
  }

  // ============================================================
  // EVENT LISTENERS (replaces inline onclick/onchange)
  // ============================================================

  if (btnStart) btnStart.addEventListener("click", startAgent);
  if (btnStop) btnStop.addEventListener("click", stopAgent);
  if (btnScan) btnScan.addEventListener("click", manualScan);
  if (serverUrlInput) serverUrlInput.addEventListener("change", updateServerUrl);
  if (btnTargetTab) btnTargetTab.addEventListener("click", setTargetTab);

  // ============================================================
  // DISPLAY
  // ============================================================

  function updateUI(status) {
    statusDot.className = "status-dot";

    switch (status) {
      case "active":
      case "connected":
        statusDot.classList.add("active");
        statusText.textContent = "CONNECTED (WebSocket)";
        btnStart.disabled = true;
        btnStop.disabled = false;
        break;
      case "connecting":
        statusDot.classList.add("connecting");
        statusText.textContent = "CONNECTING...";
        btnStart.disabled = true;
        btnStop.disabled = false;
        break;
      case "disconnected":
        statusText.textContent = "DISCONNECTED";
        btnStart.disabled = false;
        btnStop.disabled = true;
        break;
      case "error":
        statusDot.classList.add("error");
        statusText.textContent = "ERROR";
        btnStart.disabled = false;
        btnStop.disabled = true;
        break;
    }
  }

  function displayScanResults(scanData) {
    if (!scanData) return;

    const summary = scanData.privacySummary || {};
    const metrics = scanData.metrics || {};
    const piiDetections = summary.piiDetections || [];
    const totalPII = piiDetections.length;
    const totalMasked = summary.maskedVisualElements || 0;
    const textNodesRedacted = summary.redactedTextNodeCount || 0;

    // Update metrics
    piiCount.textContent = totalPII;
    piiCount.className = "metric-value" + (totalPII > 0 ? " warning" : " safe");

    fieldCount.textContent = textNodesRedacted;
    fieldCount.className = "metric-value" + (textNodesRedacted > 0 ? " warning" : " safe");

    redactedCount.textContent = totalPII + totalMasked;
    redactedCount.className = "metric-value safe";

    scanTime.textContent = (metrics.totalLatencyMs || 0) + "ms";

    // Update PII tags
    const piiTypes = [...new Set(piiDetections.map(d => d.label || d.type))];

    if (piiTypes.length === 0) {
      piiTags.innerHTML = '<span class="tag tag-safe">✅ No PII Detected — Page is Clean</span>';
    } else {
      piiTags.innerHTML = piiTypes.map(t =>
        `<span class="tag tag-pii">🔴 ${t}</span>`
      ).join("");
    }
  }

  // ============================================================
  // INIT — Load current status on popup open
  // ============================================================

  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
    if (response) {
      if (response.isActive && response.isConnected) {
        updateUI("connected");
      } else if (response.isActive) {
        updateUI("connecting");
      } else {
        updateUI("disconnected");
      }

      if (response.lastScan) {
        piiCount.textContent = response.lastScan.piiCount || 0;
        fieldCount.textContent = response.lastScan.fieldCount || 0;
      }
    }
  });

  chrome.runtime.sendMessage({ type: "GET_TARGET_TAB" }, (response) => {
    if (response?.targetTabId) {
      chrome.tabs.get(response.targetTabId, (tab) => {
        if (!chrome.runtime.lastError && tab) {
          targetTabDisplay.textContent = `Target: ${tab.title}`;
        }
      });
    }
  });

  // Listen for status updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "STATUS_UPDATE") {
      updateUI(message.status);
    }
  });

  // Load saved server URL
  chrome.storage.local.get(["serverUrl"], (result) => {
    if (result.serverUrl) {
      serverUrlInput.value = result.serverUrl;
    }
  });

}); // end DOMContentLoaded
