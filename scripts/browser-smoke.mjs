import { createServer } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import net from "node:net";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Users/openclaw/.cache/codex-browsers/chrome/mac_arm-149.0.7827.54/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].filter(Boolean);
const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));
const profileDir = mkdtempSync(join(tmpdir(), "auto-dark-mode-chrome-"));

if (!chromePath) {
  throw new Error("No Chrome executable was found.");
}

const pages = {
  "/light.html": `<!doctype html>
    <html><head><title>Light fixture</title><style>
      body { margin: 0; background: #fff; color: #111827; font: 32px system-ui; }
      main { max-width: 820px; margin: 80px auto; padding: 48px; background: #f8fafc; }
    </style></head><body><main><h1>Light fixture</h1><p>No native dark mode support.</p></main></body></html>`,
  "/native.html": `<!doctype html>
    <html><head><title>Native fixture</title><style>
      body { margin: 0; background: #fff; color: #111827; font: 32px system-ui; }
      main { max-width: 820px; margin: 80px auto; padding: 48px; background: #f8fafc; }
      @media (prefers-color-scheme: dark) {
        body { background: #0f172a; color: #f8fafc; }
        main { background: #111827; }
      }
    </style></head><body><main><h1>Native fixture</h1><p>Supports prefers-color-scheme.</p></main></body></html>`,
  "/dark.html": `<!doctype html>
    <html><head><title>Dark fixture</title><style>
      body { margin: 0; background: #09090b; color: #f4f4f5; font: 32px system-ui; }
      main { max-width: 820px; margin: 80px auto; padding: 48px; background: #18181b; }
    </style></head><body><main><h1>Dark fixture</h1><p>Already dark.</p></main></body></html>`
};

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const body = pages[request.url] || pages["/light.html"];
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(body);
    });

    server.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpConnection {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });

    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) {
          reject(new Error(message.error.message));
        } else {
          resolve(message.result);
        }
        return;
      }

      this.events.push(message);
    });
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 20000) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = { id, method, params };
    if (sessionId) {
      payload.sessionId = sessionId;
    }

    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  close() {
    this.ws.close();
  }
}

async function waitForChrome(port) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        return response.json();
      }
    } catch (_error) {
      await wait(100);
    }
  }

  throw new Error("Chrome did not expose a debugging endpoint.");
}

async function waitForServiceWorker(cdp) {
  let lastTargets = [];
  const inspectedWorkers = [];
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const targets = await cdp.send("Target.getTargets");
    lastTargets = targets.targetInfos;
    const workers = targets.targetInfos.filter((target) =>
      target.type === "service_worker" &&
      target.url.startsWith("chrome-extension://")
    );

    for (const worker of workers) {
      const sessionId = await attach(cdp, worker.targetId);
      const manifestName = await evaluate(cdp, sessionId, "chrome.runtime.getManifest().name");
      inspectedWorkers.push(`${manifestName}: ${worker.url}`);

      if (manifestName === "Auto Dark Mode Switch") {
        return { target: worker, sessionId };
      }

      await cdp.send("Target.detachFromTarget", { sessionId });
    }

    await wait(250);
  }

  const targetSummary = lastTargets.map((target) => `${target.type}: ${target.url || target.title || "(blank)"}`).join("\n");
  throw new Error(`Extension service worker was not found. Workers:\n${inspectedWorkers.join("\n")}\nTargets:\n${targetSummary}`);
}

async function attach(cdp, targetId) {
  const result = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true
  });
  await cdp.send("Runtime.enable", {}, result.sessionId);
  return result.sessionId;
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
  }

  return result.result ? result.result.value : undefined;
}

async function openTarget(cdp, url) {
  const { targetId } = await cdp.send("Target.createTarget", {
    url,
    newWindow: false
  });
  await cdp.send("Target.activateTarget", { targetId });
  return targetId;
}

async function evaluateActiveTab(cdp, serviceWorkerSession) {
  return evaluate(cdp, serviceWorkerSession, `(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && typeof tab.id === "number") {
      await evaluateTab(tab.id, "smoke-test");
    }
    return getPopupContext();
  })()`);
}

async function waitForStatus(cdp, serviceWorkerSession, expected, label) {
  let last;
  console.error(`Checking ${label}...`);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    last = await evaluateActiveTab(cdp, serviceWorkerSession);
    if (expected.includes(last.state.status)) {
      return last;
    }
    await wait(300);
  }

  throw new Error(`${label} expected ${expected.join(", ")} but got ${last && last.state ? last.state.status : "unknown"}`);
}

async function main() {
  const fixtureServer = await startFixtureServer();
  const fixturePort = fixtureServer.address().port;
  const cdpPort = await freePort();
  const chrome = spawn(chromePath, [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${cdpPort}`,
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,900",
    "about:blank"
  ], {
    stdio: "ignore"
  });

  let cdp;
  try {
    const version = await waitForChrome(cdpPort);
    cdp = new CdpConnection(version.webSocketDebuggerUrl);
    await cdp.open();

    await openTarget(cdp, `http://127.0.0.1:${fixturePort}/light.html`);
    const { target: worker, sessionId: workerSession } = await waitForServiceWorker(cdp);

    const results = [];

    results.push({
      name: "light fixture",
      context: await waitForStatus(cdp, workerSession, ["auto-dark"], "light fixture")
    });

    results.push({
      name: "native fixture",
      targetId: await openTarget(cdp, `http://127.0.0.1:${fixturePort}/native.html`)
    });
    results[results.length - 1].context = await waitForStatus(cdp, workerSession, ["native-dark", "not-needed"], "native fixture");

    results.push({
      name: "dark fixture",
      targetId: await openTarget(cdp, `http://127.0.0.1:${fixturePort}/dark.html`)
    });
    results[results.length - 1].context = await waitForStatus(cdp, workerSession, ["not-needed"], "dark fixture");

    results.push({
      name: "example.com",
      targetId: await openTarget(cdp, "https://example.com")
    });
    results[results.length - 1].context = await waitForStatus(cdp, workerSession, ["auto-dark", "native-dark"], "example.com");

    results.push({
      name: "musinsa techblog",
      targetId: await openTarget(cdp, "https://techblog.musinsa.com/the-philosophy-ai-native-hiring-c002c2775b3a")
    });
    results[results.length - 1].context = await waitForStatus(cdp, workerSession, ["auto-dark", "native-dark", "not-needed"], "musinsa techblog");

    results.push({
      name: "chrome internal page",
      targetId: await openTarget(cdp, "chrome://version")
    });
    results[results.length - 1].context = await waitForStatus(cdp, workerSession, ["unsupported"], "chrome internal page");

    console.log(JSON.stringify({
      ok: true,
      extensionServiceWorker: worker.url,
      results: results.map((result) => ({
        name: result.name,
        status: result.context.state.status,
        label: result.context.state.label,
        detail: result.context.state.detail,
        host: result.context.host
      }))
    }, null, 2));
  } finally {
    if (cdp) {
      cdp.close();
    }
    fixtureServer.close();
    chrome.kill("SIGTERM");
    await wait(500);
    rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
