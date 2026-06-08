const hostEl = document.getElementById("host");
const globalToggle = document.getElementById("global-toggle");
const statusPanel = document.querySelector(".status-panel");
const statusLabel = document.getElementById("status-label");
const statusDetail = document.getElementById("status-detail");
const debuggerNote = document.getElementById("debugger-note");
const refreshButton = document.getElementById("refresh");
const modeButtons = Array.from(document.querySelectorAll(".mode-button"));

let context = null;

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function ruleForContext() {
  return context && context.rule ? context.rule : "auto";
}

function setBusy(isBusy) {
  refreshButton.disabled = isBusy;
  modeButtons.forEach((button) => {
    button.disabled = isBusy;
  });
}

function render(nextContext) {
  context = nextContext;
  const state = context.state || {};
  const host = context.host || "Unsupported page";

  hostEl.textContent = host;
  hostEl.title = host;
  globalToggle.checked = Boolean(context.settings && context.settings.globalEnabled);

  statusPanel.dataset.status = state.status || "unknown";
  statusLabel.textContent = state.label || "Checking";
  statusDetail.textContent = state.detail || "This tab has not been checked yet.";

  const rule = ruleForContext();
  modeButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.rule === rule));
  });

  if (state.status === "blocked") {
    debuggerNote.textContent = "Debugger unavailable. Close DevTools or other debuggers.";
  } else if (state.debuggerAttached) {
    debuggerNote.textContent = "Chrome debugger is active for this tab.";
  } else {
    debuggerNote.textContent = "Local only. No browsing data is sent.";
  }
}

async function refresh() {
  setBusy(true);
  try {
    const response = await sendMessage({ type: "ADM_REFRESH" });
    if (response && response.ok) {
      render(response.context);
    }
  } finally {
    setBusy(false);
  }
}

async function load() {
  const response = await sendMessage({ type: "ADM_GET_CONTEXT" });
  if (response && response.ok) {
    render(response.context);
  }
}

globalToggle.addEventListener("change", async () => {
  setBusy(true);
  try {
    const response = await sendMessage({
      type: "ADM_SET_GLOBAL",
      enabled: globalToggle.checked
    });
    if (response && response.ok) {
      render(response.context);
    }
  } finally {
    setBusy(false);
  }
});

modeButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const host = context ? context.host : null;
    setBusy(true);
    try {
      const response = await sendMessage({
        type: "ADM_SET_SITE_RULE",
        host,
        rule: button.dataset.rule
      });
      if (response && response.ok) {
        render(response.context);
      }
    } finally {
      setBusy(false);
    }
  });
});

refreshButton.addEventListener("click", refresh);

load();

