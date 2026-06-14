importScripts("/src/shared/detector-core.js");

const DEBUGGER_VERSION = "1.3";
const SETTINGS_DEFAULTS = {
  globalEnabled: true,
  siteRules: {}
};
const MODE_LABELS = {
  auto: "Auto",
  native: "Native",
  force: "Force",
  off: "Off"
};

const attachedTabs = new Map();
const tabStates = new Map();
const scheduledChecks = new Map();
const inFlightChecks = new Set();
const pendingChecks = new Map();
const tabGenerations = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function now() {
  return Date.now();
}

function isSupportedUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function getHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_error) {
    return null;
  }
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error || "Unknown error");
}

function makeTabStateError(code, message, tab = null) {
  const error = new Error(message);
  error.name = "TabStateChangedError";
  error.code = code;
  error.tab = tab;
  return error;
}

function isTabStateChangedError(error) {
  return error && error.name === "TabStateChangedError";
}

function getTabGeneration(tabId) {
  return tabGenerations.get(tabId) || 0;
}

function bumpTabGeneration(tabId) {
  tabGenerations.set(tabId, getTabGeneration(tabId) + 1);
}

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_DEFAULTS);
  return {
    globalEnabled: stored.globalEnabled !== false,
    siteRules: stored.siteRules && typeof stored.siteRules === "object" ? stored.siteRules : {}
  };
}

async function setGlobalEnabled(enabled) {
  await chrome.storage.local.set({ globalEnabled: Boolean(enabled) });
}

async function setSiteRule(hostname, rule) {
  if (!hostname) {
    return;
  }

  const settings = await getSettings();
  const siteRules = { ...settings.siteRules };
  const normalized = AutoDarkDetector.normalizeRule(rule);
  const normalizedHost = hostname.toLowerCase();

  if (normalized === "auto") {
    delete siteRules[normalizedHost];
  } else {
    siteRules[normalizedHost] = normalized;
  }

  await chrome.storage.local.set({ siteRules });
}

function setTabState(tabId, state) {
  const current = tabStates.get(tabId) || {};
  const next = {
    ...current,
    ...state,
    updatedAt: now()
  };
  tabStates.set(tabId, next);
  return next;
}

function getTabState(tabId) {
  return tabStates.get(tabId) || {
    status: "unknown",
    label: "Checking",
    detail: "This tab has not been checked yet.",
    debuggerAttached: false,
    updatedAt: now()
  };
}

async function getTab(tabId) {
  try {
    return await chrome.tabs.get(tabId);
  } catch (_error) {
    return null;
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs.length ? tabs[0] : null;
}

async function getEvaluableTab(tabId, target = null) {
  const tab = await getTab(tabId);
  if (!tab) {
    return {
      ok: false,
      code: "missing-tab",
      tab: null,
      message: "The tab is no longer available."
    };
  }

  if (!isSupportedUrl(tab.url)) {
    return {
      ok: false,
      code: "unsupported-url",
      tab,
      message: "This extension only runs on normal http and https pages."
    };
  }

  const activeTab = await getActiveTab();
  if (!activeTab || activeTab.id !== tabId) {
    return {
      ok: false,
      code: "inactive-tab",
      tab,
      message: "Automatic dark mode only runs on the active tab in the current window."
    };
  }

  if (target && target.url !== tab.url) {
    return {
      ok: false,
      code: "changed-url",
      tab,
      message: "The tab URL changed before the dark-mode check finished."
    };
  }

  if (target && target.generation !== getTabGeneration(tabId)) {
    return {
      ok: false,
      code: "changed-tab",
      tab,
      message: "The tab changed before the dark-mode check finished."
    };
  }

  return { ok: true, tab };
}

async function requireEvaluableTab(tabId, target = null) {
  const result = await getEvaluableTab(tabId, target);
  if (result.ok) {
    return result.tab;
  }

  throw makeTabStateError(result.code, result.message, result.tab);
}

async function ensureDebugger(tabId, target = null) {
  await requireEvaluableTab(tabId, target);

  const existing = attachedTabs.get(tabId);
  if (existing && existing.attached) {
    return true;
  }

  try {
    await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION);
    await requireEvaluableTab(tabId, target);
    attachedTabs.set(tabId, { attached: true, mode: "attached" });
    setTabState(tabId, { debuggerAttached: true });
    return true;
  } catch (error) {
    if (isTabStateChangedError(error)) {
      await clearDarkMode(tabId);
      throw error;
    }

    const detail = errorMessage(error);
    setTabState(tabId, {
      status: "blocked",
      label: "Blocked",
      detail,
      debuggerAttached: false
    });
    return false;
  }
}

async function sendCommand(tabId, method, params, target = null) {
  await requireEvaluableTab(tabId, target);
  const attached = await ensureDebugger(tabId, target);
  if (!attached) {
    throw new Error("Debugger is not available for this tab.");
  }

  await requireEvaluableTab(tabId, target);
  const result = await chrome.debugger.sendCommand({ tabId }, method, params);
  await requireEvaluableTab(tabId, target);
  return result;
}

async function setNativeDark(tabId, enabled, target = null) {
  const params = enabled
    ? { features: [{ name: "prefers-color-scheme", value: "dark" }] }
    : { features: [] };
  await sendCommand(tabId, "Emulation.setEmulatedMedia", params, target);
}

async function setAutoDark(tabId, enabled, target = null) {
  await sendCommand(tabId, "Emulation.setAutoDarkModeOverride", { enabled }, target);
}

async function clearDarkMode(tabId) {
  const tracked = attachedTabs.get(tabId);
  if (!tracked || !tracked.attached) {
    return;
  }

  try {
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setAutoDarkModeOverride", { enabled: false });
  } catch (_error) {
    // Best-effort cleanup; detach below still releases the session.
  }

  try {
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", { features: [] });
  } catch (_error) {
    // Best-effort cleanup; detach below still releases the session.
  }

  try {
    await chrome.debugger.detach({ tabId });
  } catch (_error) {
    // The tab may already be closed or detached by Chrome.
  }

  attachedTabs.delete(tabId);
  setTabState(tabId, { debuggerAttached: false });
}

async function clearOtherAttachedTabs(activeTabId) {
  const tabIds = Array.from(attachedTabs.keys()).filter((tabId) => tabId !== activeTabId);
  for (const tabId of tabIds) {
    await clearDarkMode(tabId);
  }
}

async function probeTab(tabId, target) {
  await requireEvaluableTab(tabId, target);

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "ADM_PROBE" });
    await requireEvaluableTab(tabId, target);
    if (response && response.ok && response.probe) {
      return response.probe;
    }
  } catch (error) {
    if (isTabStateChangedError(error)) {
      throw error;
    }
    // Fall back to direct injection for pages that loaded before install.
  }

  await requireEvaluableTab(tabId, target);
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["src/shared/detector-core.js"]
  });

  await requireEvaluableTab(tabId, target);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => globalThis.AutoDarkDetector ? globalThis.AutoDarkDetector.probePage() : null
  });

  await requireEvaluableTab(tabId, target);
  return result ? result.result : null;
}

async function applyNativeOnly(tabId, beforeProbe, target) {
  await setAutoDark(tabId, false, target);
  await setNativeDark(tabId, true, target);
  await delay(240);

  const afterProbe = await probeTab(tabId, target);
  const beforeScore = beforeProbe ? beforeProbe.score : null;
  const afterScore = afterProbe ? afterProbe.score : null;
  const worked = AutoDarkDetector.hasMeaningfulDarkening(beforeScore, afterScore) || Boolean(afterScore && afterScore.isDark);

  await requireEvaluableTab(tabId, target);
  if (worked) {
    setTabState(tabId, {
      status: "native-dark",
      label: "Native dark",
      detail: "Using the site's own prefers-color-scheme dark styles.",
      debuggerAttached: true,
      probe: afterScore
    });
  } else {
    setTabState(tabId, {
      status: "unsupported",
      label: "Unsupported",
      detail: "Native dark mode was requested, but this page stayed light.",
      debuggerAttached: true,
      probe: afterScore
    });
  }
}

async function applyForceAuto(tabId, beforeProbe, target) {
  await setNativeDark(tabId, false, target);
  await setAutoDark(tabId, true, target);
  await requireEvaluableTab(tabId, target);
  attachedTabs.set(tabId, { attached: true, mode: "auto" });
  setTabState(tabId, {
    status: "auto-dark",
    label: "Auto dark",
    detail: "Chrome Auto Dark Mode is active for this page.",
    debuggerAttached: true,
    probe: beforeProbe ? beforeProbe.score : null
  });
}

async function evaluateTab(tabId, reason) {
  if (inFlightChecks.has(tabId)) {
    pendingChecks.set(tabId, reason || "pending");
    return;
  }

  inFlightChecks.add(tabId);
  setTabState(tabId, {
    status: "checking",
    label: "Checking",
    detail: "Checking page colors and dark-mode support.",
    reason
  });

  try {
    const eligibility = await getEvaluableTab(tabId);
    if (!eligibility.ok) {
      await clearDarkMode(tabId);
      setTabState(tabId, {
        status: "unsupported",
        label: "Unsupported",
        detail: eligibility.message,
        url: eligibility.tab ? eligibility.tab.url : "",
        host: null
      });
      return;
    }

    const tab = eligibility.tab;
    const target = {
      url: tab.url,
      generation: getTabGeneration(tabId)
    };
    const settings = await getSettings();
    const host = getHostname(tab.url);
    const rule = AutoDarkDetector.resolveSiteRule(settings.siteRules, host);

    setTabState(tabId, {
      url: tab.url,
      host,
      rule,
      ruleLabel: MODE_LABELS[rule] || MODE_LABELS.auto
    });

    if (!settings.globalEnabled) {
      await clearDarkMode(tabId);
      setTabState(tabId, {
        status: "off",
        label: "Off",
        detail: "Global automatic dark mode is disabled."
      });
      return;
    }

    if (rule === "off") {
      await clearDarkMode(tabId);
      setTabState(tabId, {
        status: "off",
        label: "Off",
        detail: "This site is disabled."
      });
      return;
    }

    await requireEvaluableTab(tabId, target);
    const beforeProbe = await probeTab(tabId, target);
    const beforeScore = beforeProbe ? beforeProbe.score : null;
    await requireEvaluableTab(tabId, target);

    if (!beforeScore) {
      setTabState(tabId, {
        status: "unsupported",
        label: "Unsupported",
        detail: "The page could not be sampled.",
        debuggerAttached: attachedTabs.has(tabId)
      });
      return;
    }

    if (rule === "force") {
      await applyForceAuto(tabId, beforeProbe, target);
      return;
    }

    if (beforeScore.isDark) {
      await requireEvaluableTab(tabId, target);
      await clearDarkMode(tabId);
      setTabState(tabId, {
        status: "not-needed",
        label: "Not needed",
        detail: "This page already appears dark.",
        probe: beforeScore
      });
      return;
    }

    await applyNativeOnly(tabId, beforeProbe, target);
    const stateAfterNative = getTabState(tabId);

    if (rule === "native" || stateAfterNative.status === "native-dark") {
      return;
    }

    await applyForceAuto(tabId, beforeProbe, target);
  } catch (error) {
    if (isTabStateChangedError(error)) {
      await clearDarkMode(tabId);

      if (error.code === "inactive-tab" || error.code === "unsupported-url" || error.code === "missing-tab") {
        setTabState(tabId, {
          status: "unsupported",
          label: "Unsupported",
          detail: error.message,
          url: error.tab ? error.tab.url : "",
          host: error.tab ? getHostname(error.tab.url) : null,
          debuggerAttached: attachedTabs.has(tabId)
        });
      } else {
        pendingChecks.set(tabId, "tab-changed");
        setTabState(tabId, {
          status: "checking",
          label: "Checking",
          detail: "The tab changed before the check finished; checking the current page.",
          url: error.tab ? error.tab.url : "",
          host: error.tab ? getHostname(error.tab.url) : null,
          debuggerAttached: attachedTabs.has(tabId)
        });
      }
      return;
    }

    const detail = errorMessage(error);
    const unsupported = /wasn't found|unknown command|not supported/i.test(detail);
    setTabState(tabId, {
      status: unsupported ? "unsupported" : "blocked",
      label: unsupported ? "Unsupported" : "Blocked",
      detail,
      debuggerAttached: attachedTabs.has(tabId)
    });
  } finally {
    inFlightChecks.delete(tabId);
    const pendingReason = pendingChecks.get(tabId);
    if (pendingReason) {
      pendingChecks.delete(tabId);
      scheduleEvaluate(tabId, pendingReason, 50);
    }
  }
}

function scheduleEvaluate(tabId, reason, waitMs = 350) {
  const existing = scheduledChecks.get(tabId);
  if (existing) {
    clearTimeout(existing);
  }

  scheduledChecks.set(tabId, setTimeout(() => {
    scheduledChecks.delete(tabId);
    evaluateTab(tabId, reason);
  }, waitMs));
}

async function getPopupContext() {
  const tab = await getActiveTab();
  const settings = await getSettings();

  if (!tab) {
    return {
      tab: null,
      settings,
      state: {
        status: "unsupported",
        label: "Unsupported",
        detail: "No active tab."
      },
      rule: "auto",
      host: null
    };
  }

  const host = getHostname(tab.url);
  const rule = AutoDarkDetector.resolveSiteRule(settings.siteRules, host);
  return {
    tab: {
      id: tab.id,
      url: tab.url,
      title: tab.title
    },
    host,
    rule,
    settings,
    state: {
      ...getTabState(tab.id),
      rule
    }
  };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(SETTINGS_DEFAULTS).then((settings) => {
    chrome.storage.local.set({
      globalEnabled: settings.globalEnabled !== false,
      siteRules: settings.siteRules && typeof settings.siteRules === "object" ? settings.siteRules : {}
    });
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "loading" || changeInfo.status === "complete") {
    bumpTabGeneration(tabId);
  }

  if (changeInfo.status === "loading" && tab.active && tab.url && isSupportedUrl(tab.url)) {
    setTabState(tabId, {
      status: "checking",
      label: "Checking",
      detail: "Waiting for page load.",
      url: tab.url,
      host: getHostname(tab.url)
    });
  }

  if (changeInfo.status === "complete" && tab.active) {
    scheduleEvaluate(tabId, "navigation");
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  clearOtherAttachedTabs(activeInfo.tabId).finally(() => {
    scheduleEvaluate(activeInfo.tabId, "activated", 150);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  tabStates.delete(tabId);
  pendingChecks.delete(tabId);
  tabGenerations.delete(tabId);
  const scheduled = scheduledChecks.get(tabId);
  if (scheduled) {
    clearTimeout(scheduled);
    scheduledChecks.delete(tabId);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || (!changes.globalEnabled && !changes.siteRules)) {
    return;
  }

  getActiveTab().then((tab) => {
    if (tab && typeof tab.id === "number") {
      scheduleEvaluate(tab.id, "settings", 100);
    }
  });
});

chrome.debugger.onDetach.addListener((debuggee, reason) => {
  if (!debuggee || typeof debuggee.tabId !== "number") {
    return;
  }

  attachedTabs.delete(debuggee.tabId);

  if (reason !== "target_closed") {
    setTabState(debuggee.tabId, {
      status: "blocked",
      label: "Blocked",
      detail: "Chrome released debugger control, usually because DevTools opened or another debugger attached.",
      debuggerAttached: false
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (!message || !message.type) {
      sendResponse({ ok: false, error: "Unknown message." });
      return;
    }

    if (message.type === "ADM_GET_CONTEXT") {
      sendResponse({ ok: true, context: await getPopupContext() });
      return;
    }

    if (message.type === "ADM_SET_GLOBAL") {
      await setGlobalEnabled(message.enabled);
      const tab = await getActiveTab();
      if (tab && typeof tab.id === "number") {
        scheduleEvaluate(tab.id, "global-toggle", 50);
      }
      sendResponse({ ok: true, context: await getPopupContext() });
      return;
    }

    if (message.type === "ADM_SET_SITE_RULE") {
      const tab = await getActiveTab();
      const host = tab ? getHostname(tab.url) : null;
      await setSiteRule(host, message.rule);
      if (tab && typeof tab.id === "number") {
        scheduleEvaluate(tab.id, "site-rule", 50);
      }
      sendResponse({ ok: true, context: await getPopupContext() });
      return;
    }

    if (message.type === "ADM_REFRESH") {
      const tab = await getActiveTab();
      if (tab && typeof tab.id === "number") {
        await evaluateTab(tab.id, "manual-refresh");
      }
      sendResponse({ ok: true, context: await getPopupContext() });
      return;
    }

    sendResponse({ ok: false, error: "Unknown message." });
  })().catch((error) => {
    sendResponse({ ok: false, error: errorMessage(error) });
  });

  return true;
});
