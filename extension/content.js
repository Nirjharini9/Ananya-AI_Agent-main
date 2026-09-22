/**
 * Ananya Privacy Vision Agent — Content Script
 * 
 * This script is injected into every web page the user visits.
 * It is responsible for:
 * 1. Reading & parsing the DOM to extract a structured page representation
 * 2. Detecting and redacting PII/sensitive data in text nodes
 * 3. Detecting sensitive form fields (password, email, phone, SSN, etc.)
 * 4. Executing actions received from the server (click, scroll, type, etc.)
 * 5. Communicating with the Background Service Worker via chrome.runtime messages
 */

// ============================================================
// 1. PII DETECTION PATTERNS
// ============================================================

const PII_PATTERNS = {
  email: {
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: "[REDACTED_EMAIL]",
    label: "Email Address"
  },
  phone: {
    regex: /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,5}[-.\s]?\d{3,5}/g,
    replacement: "[REDACTED_PHONE]",
    label: "Phone Number"
  },
  aadhaar: {
    regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    replacement: "[REDACTED_AADHAAR]",
    label: "Aadhaar Number"
  },
  creditCard: {
    regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    replacement: "[REDACTED_CARD]",
    label: "Credit Card"
  },
  pan: {
    regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    replacement: "[REDACTED_PAN]",
    label: "PAN Number"
  },
  passport: {
    regex: /\b[A-Z]{1}\d{7}\b/g,
    replacement: "[REDACTED_PASSPORT]",
    label: "Passport Number"
  },
  ipAddress: {
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: "[REDACTED_IP]",
    label: "IP Address"
  },
  ssn: {
    regex: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    replacement: "[REDACTED_SSN]",
    label: "SSN"
  }
};

// Sensitive field types and attributes
const SENSITIVE_INPUT_TYPES = ["password", "email", "tel", "number"];
const SENSITIVE_AUTOCOMPLETE = [
  "cc-number", "cc-exp", "cc-csc", "cc-name", "cc-type",
  "email", "tel", "tel-national", "tel-local",
  "bday", "bday-day", "bday-month", "bday-year",
  "street-address", "address-line1", "address-line2",
  "postal-code", "country", "country-name",
  "name", "given-name", "family-name", "additional-name",
  "username", "new-password", "current-password",
  "one-time-code", "sex"
];
const SENSITIVE_NAME_KEYWORDS = [
  "password", "passwd", "pwd", "pass",
  "email", "mail", "e-mail",
  "phone", "mobile", "tel", "cell",
  "ssn", "social", "aadhaar", "aadhar",
  "pan", "passport", "license",
  "card", "credit", "debit", "cvv", "cvc", "expiry",
  "dob", "birth", "age",
  "address", "street", "city", "zip", "pincode", "postal",
  "account", "routing", "bank", "ifsc",
  "secret", "token", "key", "otp", "pin"
];


// ============================================================
// 2. DOM PARSING & SANITIZATION ENGINE
// ============================================================

/**
 * Scans all visible text content on the page and detects PII.
 * Returns a list of detected PII items with their type, original value, and DOM location.
 */
function detectTextPII(rootElement = document.body) {
  const detections = [];
  const walker = document.createTreeWalker(
    rootElement,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        // Skip script, style, and hidden elements
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName.toLowerCase();
        if (["script", "style", "noscript", "meta", "link"].includes(tag)) {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip invisible elements
        const style = window.getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.textContent && node.textContent.trim().length > 0) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
      }
    }
  );

  let textNode;
  while ((textNode = walker.nextNode())) {
    const text = textNode.textContent;
    for (const [piiType, config] of Object.entries(PII_PATTERNS)) {
      const matches = text.matchAll(new RegExp(config.regex));
      for (const match of matches) {
        detections.push({
          type: piiType,
          label: config.label,
          originalValue: match[0],
          replacement: config.replacement,
          nodeXPath: getXPath(textNode.parentElement),
          context: text.substring(Math.max(0, match.index - 20), match.index + match[0].length + 20)
        });
      }
    }
  }
  return detections;
}

/**
 * Detects sensitive form fields by checking type, name, autocomplete, and placeholder attributes.
 */
function detectSensitiveFields() {
  const fields = [];
  const inputs = document.querySelectorAll("input, textarea, select");

  inputs.forEach((el) => {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    const name = (el.getAttribute("name") || "").toLowerCase();
    const id = (el.getAttribute("id") || "").toLowerCase();
    const autocomplete = (el.getAttribute("autocomplete") || "").toLowerCase();
    const placeholder = (el.getAttribute("placeholder") || "").toLowerCase();
    const ariaLabel = (el.getAttribute("aria-label") || "").toLowerCase();
    const label = getAssociatedLabel(el);

    let isSensitive = false;
    let sensitiveReason = "";

    // Check input type
    if (SENSITIVE_INPUT_TYPES.includes(type)) {
      isSensitive = true;
      sensitiveReason = `Input type="${type}"`;
    }

    // Check autocomplete attribute
    if (!isSensitive && SENSITIVE_AUTOCOMPLETE.includes(autocomplete)) {
      isSensitive = true;
      sensitiveReason = `autocomplete="${autocomplete}"`;
    }

    // Check name/id/placeholder for sensitive keywords
    if (!isSensitive) {
      const combined = `${name} ${id} ${placeholder} ${ariaLabel} ${label}`;
      for (const keyword of SENSITIVE_NAME_KEYWORDS) {
        if (combined.includes(keyword)) {
          isSensitive = true;
          sensitiveReason = `Field attribute contains "${keyword}"`;
          break;
        }
      }
    }

    const rect = el.getBoundingClientRect();

    fields.push({
      tag: el.tagName.toLowerCase(),
      type,
      name: el.getAttribute("name") || "",
      id: el.getAttribute("id") || "",
      placeholder: el.getAttribute("placeholder") || "",
      label,
      isSensitive,
      sensitiveReason,
      value: isSensitive ? "********" : (el.value || ""),
      xpath: getXPath(el),
      boundingBox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      isVisible: rect.width > 0 && rect.height > 0
    });
  });

  return fields;
}

/**
 * Extracts a clean, structured representation of the visible page.
 * All PII is replaced with [REDACTED] tokens.
 */
function extractSanitizedDOM() {
  const textDetections = detectTextPII();
  const sensitiveFields = detectSensitiveFields();

  // Extract key interactive elements
  const interactiveElements = [];
  const selectors = "a, button, input, textarea, select, [role='button'], [role='link'], [role='tab'], [onclick]";
  const elements = document.querySelectorAll(selectors);

  elements.forEach((el, index) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return; // Skip invisible

    let text = el.textContent?.trim().substring(0, 100) || "";
    // Sanitize any PII in the text
    for (const [_, config] of Object.entries(PII_PATTERNS)) {
      text = text.replace(config.regex, config.replacement);
    }

    interactiveElements.push({
      index,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || "",
      role: el.getAttribute("role") || "",
      text,
      ariaLabel: el.getAttribute("aria-label") || "",
      href: el.tagName === "A" ? el.getAttribute("href") : undefined,
      id: el.getAttribute("id") || "",
      className: (el.getAttribute("class") || "").substring(0, 50),
      xpath: getXPath(el),
      boundingBox: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    });
  });

  // Extract page headings for context
  const headings = [];
  document.querySelectorAll("h1, h2, h3").forEach((h) => {
    let text = h.textContent?.trim().substring(0, 150) || "";
    for (const [_, config] of Object.entries(PII_PATTERNS)) {
      text = text.replace(config.regex, config.replacement);
    }
    headings.push({ level: h.tagName, text });
  });

  // Extract visible paragraph text (sanitized)
  const visibleText = [];
  document.querySelectorAll("p, li, span, td, th, label, div").forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    if (el.children.length > 2) return; // Skip container divs
    let text = el.textContent?.trim().substring(0, 200) || "";
    if (text.length < 3) return;
    for (const [_, config] of Object.entries(PII_PATTERNS)) {
      text = text.replace(config.regex, config.replacement);
    }
    visibleText.push(text);
  });

  return {
    url: window.location.href,
    title: document.title,
    timestamp: new Date().toISOString(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      totalHeight: document.documentElement.scrollHeight
    },
    headings,
    interactiveElements,
    sensitiveFields,
    piiDetections: textDetections.map(d => ({
      type: d.type,
      label: d.label,
      replacement: d.replacement,
      // NEVER send the original value to server
      location: d.nodeXPath
    })),
    redactionSummary: {
      totalPIIFound: textDetections.length,
      totalSensitiveFields: sensitiveFields.filter(f => f.isSensitive).length,
      piiTypes: [...new Set(textDetections.map(d => d.label))],
      fieldTypes: [...new Set(sensitiveFields.filter(f => f.isSensitive).map(f => f.sensitiveReason))]
    },
    visibleTextSample: visibleText.slice(0, 20) // First 20 text blocks, sanitized
  };
}


// ============================================================
// 3. ACTION EXECUTION ENGINE
// ============================================================

/**
 * Executes a server-issued action on the current page.
 */
async function executeAction(action) {
  const { type, selector, value, description } = action;
  console.log(`[Content] Executing: ${type} ${selector || value || ''}`, action);

  try {
    switch (type) {
      case "click": {
        const el = await waitForElement(selector);
        if (!el) throw new Error(`Element not found: ${selector}`);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(300);
        el.click();
        return { success: true, message: `Clicked: ${description || selector}` };
      }

      case "type": {
        const el = await waitForElement(selector);
        if (!el) throw new Error(`Element not found: ${selector}`);
        el.focus();
        el.value = "";
        // Simulate natural typing
        for (const char of value) {
          el.value += char;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          await sleep(30 + Math.random() * 50);
        }
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true, message: `Typed into: ${description || selector}` };
      }

      case "scroll": {
        const amount = value || 400;
        const direction = action.direction || "down";
        window.scrollBy({
          top: direction === "up" ? -amount : amount,
          behavior: "smooth"
        });
        return { success: true, message: `Scrolled ${direction} by ${amount}px` };
      }

      case "navigate": {
        window.location.href = value;
        return { success: true, message: `Navigating to: ${value}` };
      }

      case "select": {
        const el = await waitForElement(selector);
        if (!el) throw new Error(`Element not found: ${selector}`);
        el.value = value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true, message: `Selected value in: ${description || selector}` };
      }

      case "hover": {
        const el = await waitForElement(selector);
        if (!el) throw new Error(`Element not found: ${selector}`);
        el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        return { success: true, message: `Hovered over: ${description || selector}` };
      }

      case "wait": {
        await sleep(value || 1000);
        return { success: true, message: `Waited ${value || 1000}ms` };
      }

      case "extractText": {
        const el = await waitForElement(selector);
        if (!el) throw new Error(`Element not found: ${selector}`);
        let text = el.textContent?.trim() || "";
        // Sanitize before returning
        for (const [_, config] of Object.entries(PII_PATTERNS)) {
          text = text.replace(config.regex, config.replacement);
        }
        return { success: true, message: text };
      }

      default:
        return { success: false, message: `Unknown action type: ${type}` };
    }
  } catch (err) {
    return { success: false, message: `Action failed: ${err.message}` };
  }
}


// ============================================================
// 4. UTILITY FUNCTIONS
// ============================================================

/** Find an element by CSS selector, XPath, text content, or index */
function findElement(selector) {
  if (!selector) return null;

  // Try CSS selector first
  try {
    const el = document.querySelector(selector);
    if (el) return el;
  } catch (e) {}

  // Try XPath
  try {
    const result = document.evaluate(selector, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    if (result.singleNodeValue) return result.singleNodeValue;
  } catch (e) {}

  const lowerSelector = selector.toLowerCase().trim();

  // Try input/textarea by placeholder, name, id
  const inputs = document.querySelectorAll("input, textarea, select");
  for (const el of inputs) {
    if (el.getAttribute("placeholder")?.toLowerCase().includes(lowerSelector) ||
        el.getAttribute("name")?.toLowerCase() === lowerSelector ||
        el.getAttribute("id")?.toLowerCase() === lowerSelector ||
        el.getAttribute("aria-label")?.toLowerCase().includes(lowerSelector)) {
      return el;
    }
  }

  // Try text content match (exact)
  const interactiveElements = document.querySelectorAll("a, button, input[type='button'], input[type='submit'], [role='button'], label, [role='link'], [role='tab'], li");
  for (const el of interactiveElements) {
    if (el.textContent?.trim().toLowerCase() === lowerSelector) {
      return el;
    }
  }

  // Try text content match (partial)
  for (const el of interactiveElements) {
    if (el.textContent?.trim().toLowerCase().includes(lowerSelector)) {
      return el;
    }
  }

  // Try by aria-label broadly
  const ariaEl = document.querySelector(`[aria-label*="${selector}" i]`);
  if (ariaEl) return ariaEl;

  return null;
}

/** Wait for an element to appear in the DOM */
async function waitForElement(selector, timeoutMs = 10000) {
  console.log(`[Content] Finding element: ${selector}`);
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const el = findElement(selector);
    if (el) {
      console.log(`[Content] Element found: ${selector}`);
      return el;
    }
    await sleep(200);
  }
  return null;
}

/** Get XPath for an element */
function getXPath(element) {
  if (!element) return "";
  if (element.id) return `//*[@id="${element.id}"]`;

  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index++;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
    current = current.parentElement;
  }
  return "/" + parts.join("/");
}

/** Get the label text associated with a form element */
function getAssociatedLabel(element) {
  // Check for explicit <label for="...">
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) return label.textContent?.trim() || "";
  }
  // Check for wrapping <label>
  const parentLabel = element.closest("label");
  if (parentLabel) return parentLabel.textContent?.trim() || "";
  // Check for aria-label
  return element.getAttribute("aria-label") || "";
}

/** Sleep utility */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ============================================================
// 5. MESSAGE HANDLER — Communication with Background Worker
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[Ananya Content] Received message:", message.type);

  switch (message.type) {
    case "SCAN_PAGE": {
      // Extract sanitized DOM structure
      const startTime = performance.now();
      const sanitizedDOM = extractSanitizedDOM();
      const duration = Math.round(performance.now() - startTime);
      sanitizedDOM.scanDurationMs = duration;
      console.log(`[Ananya Content] DOM scan completed in ${duration}ms. Found ${sanitizedDOM.redactionSummary.totalPIIFound} PII items.`);
      sendResponse({ success: true, data: sanitizedDOM });
      break;
    }

    case "EXECUTE_ACTION": {
      console.log("[Content] ACTION received", message.action);
      executeAction(message.action).then(result => {
        console.log("[Content] ACTION_RESULT:", result);
        sendResponse(result);
      });
      return true; // Keep channel open for async response
    }

    case "GET_FIELD_VALUES": {
      // Return only non-sensitive field values (for server context)
      const fields = detectSensitiveFields();
      const safeFields = fields.map(f => ({
        ...f,
        value: f.isSensitive ? "********" : f.value
      }));
      sendResponse({ success: true, fields: safeFields });
      break;
    }

    case "HIGHLIGHT_PII": {
      // Visual debug: highlight detected PII on the page
      const detections = detectTextPII();
      highlightPIIOnPage(detections);
      sendResponse({ success: true, count: detections.length });
      break;
    }

    case "APPLY_REDACTION_MASKS": {
      applyRedactionMasks();
      sendResponse({ success: true });
      break;
    }

    case "REMOVE_REDACTION_MASKS": {
      removeRedactionMasks();
      sendResponse({ success: true });
      break;
    }

    case "PING": {
      sendResponse({ alive: true, url: window.location.href });
      break;
    }

    default:
      sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
  }
});

/** Debug utility: visually highlight PII on the page with colored overlays */
function highlightPIIOnPage(detections) {
  // Remove previous highlights
  document.querySelectorAll(".ananya-pii-highlight").forEach(el => el.remove());

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let textNode;
  while ((textNode = walker.nextNode())) {
    const text = textNode.textContent;
    for (const detection of detections) {
      if (text.includes(detection.originalValue)) {
        const parent = textNode.parentElement;
        if (!parent) continue;
        const rect = parent.getBoundingClientRect();
        const overlay = document.createElement("div");
        overlay.className = "ananya-pii-highlight";
        overlay.style.cssText = `
          position: fixed;
          left: ${rect.left}px;
          top: ${rect.top}px;
          width: ${rect.width}px;
          height: ${rect.height}px;
          background: rgba(255, 0, 0, 0.25);
          border: 2px solid red;
          pointer-events: none;
          z-index: 999999;
          border-radius: 3px;
        `;
        overlay.title = `PII Detected: ${detection.label}`;
        document.body.appendChild(overlay);
        break;
      }
    }
  }
}

/** Visual redaction: draw solid black boxes over sensitive fields and PII */
function applyRedactionMasks() {
  removeRedactionMasks(); // Clean up existing

  const sensitiveFields = detectSensitiveFields().filter(f => f.isSensitive);
  const piiDetections = detectTextPII();

  const masks = [];

  // Mask form fields
  for (const field of sensitiveFields) {
    const el = findElement(field.xpath);
    if (el) {
      const rect = el.getBoundingClientRect();
      masks.push(rect);
    }
  }

  // Mask text nodes
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let textNode;
  while ((textNode = walker.nextNode())) {
    const text = textNode.textContent;
    for (const detection of piiDetections) {
      if (text.includes(detection.originalValue)) {
        const parent = textNode.parentElement;
        if (parent) masks.push(parent.getBoundingClientRect());
        break;
      }
    }
  }

  // Draw masks
  for (const rect of masks) {
    if (rect.width === 0 || rect.height === 0) continue;
    const overlay = document.createElement("div");
    overlay.className = "ananya-redaction-mask";
    overlay.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      background: #000 !important;
      color: #000 !important;
      pointer-events: none;
      z-index: 2147483647; /* Max z-index */
    `;
    document.body.appendChild(overlay);
  }
}

function removeRedactionMasks() {
  document.querySelectorAll(".ananya-redaction-mask").forEach(el => el.remove());
}

// ============================================================
// 6. LOCAL PRIVACY LIFECYCLE
// ============================================================

let localRedactionInterval = null;
let heartbeatInterval = null;
let isPrivacyEnabledLocally = false;

function enableLocalPrivacy() {
  if (isPrivacyEnabledLocally) return;
  isPrivacyEnabledLocally = true;
  
  applyRedactionMasks();
  localRedactionInterval = setInterval(() => {
    applyRedactionMasks();
  }, 1000); // 1-second masking loop to handle scrolling/dynamic rendering

  heartbeatInterval = setInterval(() => {
    try {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ type: "HEARTBEAT_SCAN" }).catch(() => {});
      } else {
        disableLocalPrivacy(); // Extension was reloaded
      }
    } catch (e) {
      if (e.message.includes("Extension context invalidated")) {
        disableLocalPrivacy();
      }
    }
  }, 5000); // 5-second heartbeat to wake up background service worker
  
  console.log("[Content] Privacy protection enabled locally.");
}

function disableLocalPrivacy() {
  isPrivacyEnabledLocally = false;
  if (localRedactionInterval) clearInterval(localRedactionInterval);
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  localRedactionInterval = null;
  heartbeatInterval = null;
  removeRedactionMasks();
  console.log("[Content] Privacy protection disabled locally.");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ENABLE_PRIVACY") {
    enableLocalPrivacy();
    sendResponse({ success: true });
  } else if (message.type === "DISABLE_PRIVACY") {
    disableLocalPrivacy();
    sendResponse({ success: true });
  }
});

// Check status on initial injection
chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
  if (response && response.isActive) {
    enableLocalPrivacy();
  }
});

// Announce readiness
console.log("[Ananya Privacy Vision Agent] Content script loaded and ready.");
