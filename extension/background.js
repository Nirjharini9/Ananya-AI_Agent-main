/**
 * Ananya Privacy Vision Agent — Background Service Worker
 * 
 * This is the central coordinator of the extension:
 * 1. Manages WebSocket connection to the Ananya server (server.ts)
 * 2. Captures screenshots and coordinates with content script for redaction
 * 3. Sends sanitized data (redacted screenshot + clean DOM JSON) to server
 * 4. Receives action commands from server and dispatches to content script
 * 5. Manages the agent lifecycle (start/stop/status)
 */

// ============================================================
// STATE
// ============================================================

let ws = null;
let isAgentActive = false;
let serverUrl = "ws://localhost:3000/agent";
let lastScanResult = null;
let connectionRetries = 0;
let targetTabId = null;
const MAX_RETRIES = 5;

function isAnanyaTab(url) {
  if (!url) return false;
  return url.startsWith("http://localhost:3000") || url.startsWith("http://127.0.0.1:3000");
}

function isRestrictedPage(url) {
  if (!url) return true;
  return url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:');
}

// ============================================================
// 1. SCREENSHOT CAPTURE & FACE REDACTION
// ============================================================

/**
 * Captures the visible tab as a screenshot, applying DOM redaction masks first.
 */
async function captureRedactedScreenshot(tabId) {
  try {
    // 1. Tell content script to apply black masks over sensitive data
    await chrome.tabs.sendMessage(tabId, { type: "APPLY_REDACTION_MASKS" });
    
    // Wait for DOM to render the masks
    await new Promise(r => setTimeout(r, 100));
    
    // 2. Capture the screenshot (now with black boxes)
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: "jpeg",
      quality: 60
    });
    
    // 3. Tell content script to remove the masks so the user doesn't see them
    await chrome.tabs.sendMessage(tabId, { type: "REMOVE_REDACTION_MASKS" });
    
    return dataUrl;
  } catch (err) {
    console.error("[Ananya BG] Screenshot capture failed:", err);
    // Cleanup masks just in case
    chrome.tabs.sendMessage(tabId, { type: "REMOVE_REDACTION_MASKS" }).catch(()=>{});
    return null;
  }
}

// ============================================================
// 2. SCAN PIPELINE — DOM + Screenshot + Redaction
// ============================================================

/**
 * Full scan pipeline:
 * 1. Tell content script to extract sanitized DOM
 * 2. Capture redacted screenshot (masks applied and removed)
 * 3. Bundle everything into a privacy-safe payload
 */
async function performFullScan() {
  const startTime = Date.now();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return null;
    }

    // Do not attempt to scan restricted pages like chrome:// or extension pages
    if (isRestrictedPage(tab.url)) {
      return null;
    }

    // 2. Extract DOM (Sanitization happens on content script side)
    const domResponse = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_PAGE" }).catch(e => {
       // Silently ignore if content script isn't loaded on this page
       return null;
    });

    if (!domResponse || !domResponse.success) {
      return null; // Silently skip if DOM extraction fails (e.g. page loading)
    }

    // 3. Capture Redacted Screenshot
    const redactedImage = await captureRedactedScreenshot(tab.id);

    // 4. Assemble payload
    const domData = domResponse.data;
    const payload = {
      type: "AGENT_SCAN",
      tab: {
        id: tab.id,
        url: tab.url,
        title: tab.title
      },
      dom: {
        url: domData.url,
        title: domData.title,
        viewport: domData.viewport,
        headings: domData.headings,
        interactiveElements: domData.interactiveElements,
        sensitiveFields: domData.sensitiveFields,
        visibleTextSample: domData.visibleTextSample
      },
      screenshot: redactedImage,
      privacySummary: {
        piiDetections: domData.piiDetections || [],
        redactedTextNodeCount: domData.redactionSummary?.totalPIIFound || 0,
        maskedVisualElements: (domData.piiDetections?.length || 0) + (domData.redactionSummary?.totalSensitiveFields || 0),
        piiTypes: domData.redactionSummary?.piiTypes || [],
        fieldTypes: domData.redactionSummary?.fieldTypes || []
      },
      metrics: {
        domExtractionMs: domData.scanDurationMs || 0,
        totalLatencyMs: Date.now() - startTime
      }
    };

    lastScanResult = payload;
    console.log(`[Ananya BG] Full scan completed in ${payload.metrics.totalLatencyMs}ms`);

    return payload;

  } catch (err) {
    // Only log if it's a critical unexpected error, not just a missing tab
    if (err.message && !err.message.includes("Receiving end does not exist")) {
      console.warn("[Ananya BG] Scan pipeline skipped:", err.message);
    }
    return null;
  }
}


// ============================================================
// 3. WEBSOCKET CONNECTION TO SERVER
// ============================================================

function connectToServer() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("[Ananya BG] Already connected.");
    return;
  }

  console.log(`[Ananya BG] Connecting to server: ${serverUrl}`);

  try {
    ws = new WebSocket(serverUrl);

    ws.onopen = () => {
      console.log("[Ananya BG] Connected to Ananya server!");
      connectionRetries = 0;
      broadcastStatus("connected");

      // Send initial scan
      performFullScan().then(payload => {
        if (payload && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(payload));
        }
      });
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log("[Ananya BG] Server message:", message.type, message);

        switch (message.type) {
          case "ACTION": {
            // Check if we have a target tab
            if (!targetTabId) {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (tab && tab.id && !isAnanyaTab(tab.url) && !isRestrictedPage(tab.url)) {
                targetTabId = tab.id;
                console.log("[Ananya BG] Auto-selected target tab:", targetTabId, tab.url);
              } else if (message.action.type === "open") {
                // If there's no suitable active tab, but the user wants to navigate, create a new tab!
                const newTab = await chrome.tabs.create({ url: message.action.url });
                targetTabId = newTab.id;
                console.log("[Ananya BG] Created new tab for navigation:", targetTabId);
                
                await sleep(1500);
                ws.send(JSON.stringify({
                  type: "ACTION_RESULT",
                  actionId: message.actionId,
                  result: { success: true, message: `Opened new tab and navigated to ${message.action.url}` }
                }));
                break;
              } else {
                ws.send(JSON.stringify({
                  type: "ACTION_RESULT",
                  actionId: message.actionId,
                  result: { success: false, message: "Target Chrome tab is unavailable. Please select a target tab in the extension popup." }
                }));
                break;
              }
            }

            // Verify tab still exists
            try {
              const tab = await chrome.tabs.get(targetTabId);
              if (!tab) throw new Error();
              
              // Handle open (navigation) directly from background to avoid content script limitations
              if (message.action.type === "open") {
                await chrome.tabs.update(targetTabId, { url: message.action.url });
                
                // Allow some time for navigation to initiate so content script drops and re-injects
                await sleep(1500);

                ws.send(JSON.stringify({
                  type: "ACTION_RESULT",
                  actionId: message.actionId,
                  result: { success: true, message: `Navigated target tab to ${message.action.url}` }
                }));
                break;
              }

              // Normal content script actions
              console.log("[Extension] ACTION received, sending to tab", targetTabId);
              const result = await chrome.tabs.sendMessage(targetTabId, {
                type: "EXECUTE_ACTION",
                action: message.action
              }).catch(err => {
                return { success: false, message: `Content script unavailable in target tab: ${err.message}` };
              });

              ws.send(JSON.stringify({
                type: "ACTION_RESULT",
                actionId: message.actionId,
                result: result || { success: false, message: "No response from content script." }
              }));
            } catch (err) {
              if (message.action.type === "open") {
                const newTab = await chrome.tabs.create({ url: message.action.url });
                targetTabId = newTab.id;
                console.log("[Ananya BG] Created new tab because previous target died:", targetTabId);
                await sleep(1500);
                ws.send(JSON.stringify({
                  type: "ACTION_RESULT",
                  actionId: message.actionId,
                  result: { success: true, message: `Navigated target tab to ${message.action.url}` }
                }));
              } else {
                ws.send(JSON.stringify({
                  type: "ACTION_RESULT",
                  actionId: message.actionId,
                  result: { success: false, message: "Target Chrome tab no longer exists." }
                }));
              }
            }

            // After action, do a fresh scan
            await sleep(500);
            const newScan = await performFullScan();
            if (newScan && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(newScan));
            }
            break;
          }

          case "REQUEST_SCAN": {
            // Server is requesting a fresh scan
            const scan = await performFullScan();
            if (scan && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(scan));
            }
            break;
          }

          case "PING": {
            ws.send(JSON.stringify({ type: "PONG" }));
            break;
          }

          default:
            console.warn("[Ananya BG] Unknown server message type:", message.type);
        }
      } catch (err) {
        console.error("[Ananya BG] Failed to process server message:", err);
      }
    };

    ws.onclose = () => {
      console.log("[Ananya BG] WebSocket disconnected.");
      broadcastStatus("disconnected");
      ws = null;

      // Auto-reconnect with backoff
      if (isAgentActive) {
        connectionRetries++;
        const delay = Math.min(1000 * Math.pow(2, connectionRetries), 30000);
        console.log(`[Ananya BG] Reconnecting in ${delay}ms (attempt ${connectionRetries})...`);
        setTimeout(connectToServer, delay);
      }
    };

    ws.onerror = (err) => {
      console.error("[Ananya BG] WebSocket error:", err);
    };

  } catch (err) {
    console.error("[Ananya BG] Connection failed:", err);
    broadcastStatus("error");
  }
}

function disconnectFromServer() {
  if (ws) {
    ws.close();
    ws = null;
  }
  broadcastStatus("disconnected");
}


// ============================================================
// 4. AGENT LIFECYCLE
// ============================================================

function startAgent() {
  if (isAgentActive) return;
  isAgentActive = true;
  chrome.storage.local.set({ isAgentActive: true });
  connectionRetries = 0;
  connectToServer();

  // Enable privacy on current tab immediately
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0] && !isRestrictedPage(tabs[0].url) && !isAnanyaTab(tabs[0].url)) {
      targetTabId = tabs[0].id;
      chrome.tabs.sendMessage(targetTabId, { type: "ENABLE_PRIVACY" }).catch(() => {});
    }
  });

  broadcastStatus("active");
  console.log("[Ananya BG] Agent started.");
}

function stopAgent() {
  isAgentActive = false;
  chrome.storage.local.set({ isAgentActive: false });
  disconnectFromServer();
  
  if (targetTabId) {
     chrome.tabs.sendMessage(targetTabId, { type: "DISABLE_PRIVACY" }).catch(() => {});
  }
  
  console.log("[Ananya BG] Agent stopped.");
}


// ============================================================
// 5. MESSAGE HANDLER — Communication with Popup & Content Script
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case "START_AGENT":
      startAgent();
      sendResponse({ status: "started" });
      break;

    case "STOP_AGENT":
      stopAgent();
      sendResponse({ status: "stopped" });
      break;

    case "GET_STATUS":
      sendResponse({
        isActive: isAgentActive,
        isConnected: ws?.readyState === WebSocket.OPEN,
        lastScan: lastScanResult ? {
          timestamp: lastScanResult.metrics?.totalLatencyMs,
          piiCount: lastScanResult.privacySummary?.piiDetections?.length || 0,
          fieldCount: lastScanResult.privacySummary?.redactedTextNodeCount || 0
        } : null
      });
      break;

    case "MANUAL_SCAN":
      performFullScan().then(result => {
        sendResponse({ success: true, data: result });
      });
      return true; // async

    case "SET_SERVER_URL":
      serverUrl = message.url;
      chrome.storage.local.set({ serverUrl: message.url });
      sendResponse({ success: true });
      break;

    case "SET_TARGET_TAB":
      targetTabId = message.tabId;
      sendResponse({ success: true });
      break;

    case "GET_TARGET_TAB":
      sendResponse({ targetTabId });
      break;

    case "HEARTBEAT_SCAN":
      if (isAgentActive) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          performFullScan().then(scan => {
            if (scan && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(scan));
            }
          });
        } else {
          // Attempt to wake up / reconnect the server connection if needed
          connectToServer();
        }
      }
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ error: "Unknown message type" });
  }
});

// Load saved settings on startup
chrome.storage.local.get(["serverUrl", "isAgentActive", "autoStart"], (result) => {
  if (result.serverUrl) serverUrl = result.serverUrl;
  
  if (result.isAgentActive === true || (result.isAgentActive === undefined && result.autoStart !== false)) {
    startAgent();
  }
});

// ============================================================
// TAB NAVIGATION EVENTS
// ============================================================

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isAgentActive) {
    if (tabId === targetTabId || !targetTabId) {
      if (!isAnanyaTab(tab.url) && !isRestrictedPage(tab.url)) {
        targetTabId = tabId;
        // Inject privacy state into the new page instance
        chrome.tabs.sendMessage(tabId, { type: "ENABLE_PRIVACY" }).catch(() => {});
      }
    }
  }
});

chrome.tabs.onActivated.addListener(activeInfo => {
  if (isAgentActive) {
    chrome.tabs.get(activeInfo.tabId, tab => {
      if (tab && !isAnanyaTab(tab.url) && !isRestrictedPage(tab.url)) {
        targetTabId = activeInfo.tabId;
        chrome.tabs.sendMessage(activeInfo.tabId, { type: "ENABLE_PRIVACY" }).catch(() => {});
      }
    });
  }
});


// ============================================================
// UTILITIES
// ============================================================

function broadcastStatus(status) {
  chrome.runtime.sendMessage({ type: "STATUS_UPDATE", status }).catch(() => {});
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log("[Ananya Privacy Vision Agent] Background service worker loaded.");
