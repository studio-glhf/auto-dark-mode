(function initAutoDarkProbe() {
  if (globalThis.__autoDarkProbeReady) {
    return;
  }

  globalThis.__autoDarkProbeReady = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "ADM_PROBE") {
      return false;
    }

    try {
      sendResponse({
        ok: true,
        probe: globalThis.AutoDarkDetector.probePage()
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    }

    return false;
  });
})();

