import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, resolve } from "node:path";

export const nexusRealtimeSupports = [
  "startServer",
  "openPage",
  "wait",
  "waitForSelector",
  "waitForGameHost",
  "assertCanvasExists",
  "observeNexusRealtime",
  "actNexusRealtime",
  "advanceNexusRealtime",
  "assertNexusRealtimeState",
  "assertFrameAdvanced",
  "assertNoConsoleErrors",
  "captureScreenshot",
  "summarizeSession",
  "stopServer"
];

const contentTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function now() {
  return Date.now();
}

function pathForApp(appPath) {
  if (!appPath) return { root: process.cwd(), entry: "index.html" };
  const absolute = resolve(appPath);
  const stats = statSync(absolute);
  if (stats.isFile()) return { root: dirname(absolute), entry: basename(absolute) };
  return { root: absolute, entry: "index.html" };
}

function startStaticServer(appPath, port = 0) {
  const { root, entry } = pathForApp(appPath);
  const server = createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const relativePath = requestPath === "/" ? entry : requestPath.slice(1);
    let filePath = resolve(root, relativePath);
    if (filePath.startsWith(root) && existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = resolve(filePath, "index.html");
    }

    if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  });

  return new Promise((resolveServer) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      resolveServer({
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
        root,
        url: `http://127.0.0.1:${address.port}/`
      });
    });
  });
}

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(`Playwright is not installed. Install it before running --simtime nexusrealtime. Original error: ${error.code ?? error.message}`);
  }
}

function resolvePath(source, path = "") {
  return String(path)
    .split(".")
    .filter(Boolean)
    .reduce((value, part) => value?.[part], source);
}

function compare(actual, operator, expected) {
  switch (operator ?? "===") {
    case "===": return actual === expected;
    case "!==": return actual !== expected;
    case ">": return Number(actual) > Number(expected);
    case ">=": return Number(actual) >= Number(expected);
    case "<": return Number(actual) < Number(expected);
    case "<=": return Number(actual) <= Number(expected);
    case "includes": return Array.isArray(actual) ? actual.includes(expected) : String(actual ?? "").includes(String(expected));
    default: throw new Error(`Unsupported assertion operator: ${operator}`);
  }
}

function createInitialState(context) {
  const app = context.env?.app ?? {};
  return {
    artifactDir: app.artifactDir ?? (context.env?.name ? `.nexus-simulator/artifacts/${context.env.name}` : ".nexus-simulator/artifacts/nexusrealtime"),
    artifacts: [],
    browserOpen: false,
    checks: [],
    consoleErrors: [],
    consoleLogs: [],
    durationMs: 0,
    events: [],
    lastFrameBeforeAdvance: 0,
    lastObservation: null,
    liveDecisions: [],
    logs: [],
    pageOpened: false,
    server: null,
    sessionSummary: "",
    status: "passed"
  };
}

function compactObservation(observation) {
  if (!observation) return null;
  return {
    id: observation.id,
    title: observation.title,
    frame: observation.frame,
    elapsed: observation.elapsed,
    input: clone(observation.input),
    body: {
      position: clone(observation.body?.position),
      velocity: clone(observation.body?.velocity),
      rotation: clone(observation.body?.rotation),
      speed: observation.body?.speed,
      onGround: observation.body?.onGround,
      altitude: observation.body?.altitude,
      clearance: observation.body?.clearance,
      groundHeight: observation.body?.groundHeight
    },
    terrain: {
      patchSize: observation.terrain?.patchSize,
      patchCount: observation.terrain?.patchCount,
      nearSegments: observation.terrain?.nearSegments,
      farSegments: observation.terrain?.farSegments
    },
    camera: clone(observation.camera),
    validation: clone(observation.validation)
  };
}

export function createNexusRealtimeAdapter(context = {}) {
  const id = "nexusrealtime";
  const type = "app";
  const surface = "live-browser-gamehost";
  const startedAt = now();
  let state = createInitialState(context);
  let playwright = null;
  let browser = null;
  let page = null;
  let serverHandle = null;

  function log(message) {
    state.logs.push(String(message));
  }

  function check(name, passed, detail = "") {
    state.checks.push({ name, passed, detail });
    if (!passed) state.status = "failed";
  }

  async function ensureBrowser() {
    if (page) return page;
    playwright ??= await importPlaywright();
    browser = await playwright.chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("console", (message) => {
      const entry = { type: message.type(), text: message.text() };
      state.consoleLogs.push(entry);
      if (message.type() === "error") state.consoleErrors.push(entry);
    });
    page.on("pageerror", (error) => {
      state.consoleErrors.push({ type: "pageerror", text: error.message });
    });
    state.browserOpen = true;
    return page;
  }

  async function readGameHost() {
    await ensureBrowser();
    return page.evaluate(() => {
      const host = window.GameHost;
      if (!host || typeof host.getState !== "function") return { ok: false, reason: "missing-gamehost" };
      return {
        ok: true,
        state: host.getState(),
        validation: typeof host.getValidationState === "function" ? host.getValidationState() : null
      };
    });
  }

  async function waitForGameHost(timeoutMs = 15000) {
    await ensureBrowser();
    await page.waitForFunction(() => Boolean(window.GameHost && typeof window.GameHost.getState === "function"), null, { timeout: timeoutMs });
  }

  async function closeRuntime() {
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
      page = null;
      state.browserOpen = false;
    }
    if (serverHandle) {
      await serverHandle.close().catch(() => {});
      serverHandle = null;
    }
  }

  async function post(event) {
    state.events.push(clone(event));
    const args = event.args ?? {};

    switch (event.command) {
      case "startServer": {
        const appPath = args.path ?? context.env?.app?.attachedAppPath ?? process.cwd();
        serverHandle = await startStaticServer(appPath, Number(args.port ?? 0));
        state.server = { root: serverHandle.root, url: serverHandle.url };
        check("serverStarted", true, serverHandle.url);
        log(`started static server ${serverHandle.url}`);
        return;
      }
      case "openPage": {
        await ensureBrowser();
        const url = args.url
          ? String(args.url)
          : serverHandle?.url ?? context.env?.baseUrl;
        if (!url) throw new Error("openPage requires args.url or a started server.");
        await page.goto(url, { waitUntil: args.waitUntil ?? "domcontentloaded", timeout: Number(args.timeoutMs ?? 30000) });
        state.pageOpened = true;
        check("pageOpened", true, url);
        log(`opened ${url}`);
        return;
      }
      case "wait":
        await ensureBrowser();
        await page.waitForTimeout(Number(args.ms ?? 250));
        return;
      case "waitForSelector":
        await ensureBrowser();
        await page.waitForSelector(args.selector, { timeout: Number(args.timeoutMs ?? 10000) });
        check("selectorFound", true, args.selector);
        return;
      case "waitForGameHost":
        await waitForGameHost(Number(args.timeoutMs ?? 15000));
        check("gameHostReady", true, "window.GameHost available");
        return;
      case "assertCanvasExists": {
        await ensureBrowser();
        const count = await page.locator("canvas").count();
        check("canvasExists", count > 0, `canvas count=${count}`);
        return;
      }
      case "observeNexusRealtime": {
        const result = await readGameHost();
        check("gameHostObserved", result.ok === true, result.ok ? `frame=${result.state?.frame}` : result.reason);
        if (result.ok) state.lastObservation = result.state;
        state.sessionSummary += `observe frame=${result.state?.frame ?? "?"}\n`;
        return;
      }
      case "actNexusRealtime": {
        await waitForGameHost(Number(args.timeoutMs ?? 15000));
        const result = await page.evaluate(({ input, delta }) => {
          const host = window.GameHost;
          if (!host) return { ok: false, reason: "missing-gamehost" };
          host.stop?.();
          host.setInput?.(input ?? {});
          const state = host.tick?.(delta ?? 1 / 60, input ?? {});
          host.render?.();
          return { ok: true, state };
        }, { input: args.input ?? {}, delta: Number(args.delta ?? 1 / 60) });
        check("nexusRealtimeActed", result.ok === true, result.ok ? `frame=${result.state?.frame}` : result.reason);
        if (result.ok) state.lastObservation = result.state;
        return;
      }
      case "advanceNexusRealtime": {
        await waitForGameHost(Number(args.timeoutMs ?? 15000));
        const before = await readGameHost();
        state.lastFrameBeforeAdvance = Number(before.state?.frame ?? 0);
        const result = await page.evaluate(({ seconds, fixedDt, input, autopilot, renderEvery }) => {
          const host = window.GameHost;
          if (!host) return { ok: false, reason: "missing-gamehost" };
          host.stop?.();
          const dt = Math.max(1 / 240, Math.min(1 / 15, Number(fixedDt) || 1 / 60));
          const steps = Math.max(1, Math.min(36000, Math.round((Number(seconds) || 1) / dt)));
          const samples = [];
          const decisions = [];

          function choose(state, index) {
            if (input && Object.keys(input).length) return input;
            if (autopilot !== false && typeof host.heuristicInput === "function") return host.heuristicInput();
            const clearance = Number(state?.body?.clearance ?? 120);
            const speed = Number(state?.body?.speed ?? 0);
            const bankLeft = Math.floor(index / 180) % 2 === 0;
            return {
              pitchUp: clearance < 90,
              pitchDown: clearance > 190 && speed < 90,
              bankLeft: clearance >= 90 && bankLeft,
              bankRight: clearance >= 90 && !bankLeft,
              boost: speed < 58 && clearance > 70
            };
          }

          let current = host.getState?.();
          for (let index = 0; index < steps; index += 1) {
            const decision = choose(current, index);
            host.setInput?.(decision);
            current = host.tick?.(dt, decision) ?? host.getState?.();
            if (renderEvery && index % renderEvery === 0) host.render?.();
            if (index % 60 === 0 || index === steps - 1) {
              samples.push({
                frame: current?.frame,
                speed: current?.body?.speed,
                clearance: current?.body?.clearance,
                patchCount: current?.terrain?.patchCount
              });
              decisions.push({ frame: current?.frame, input: decision });
            }
          }
          host.render?.();
          return { ok: true, state: host.getState?.(), steps, samples, decisions };
        }, {
          seconds: Number(args.seconds ?? 1),
          fixedDt: Number(args.fixedDt ?? 1 / 60),
          input: args.input ?? null,
          autopilot: args.autopilot ?? true,
          renderEvery: Number(args.renderEvery ?? 6)
        });
        check("nexusRealtimeAdvanced", result.ok === true, result.ok ? `steps=${result.steps} frame=${result.state?.frame}` : result.reason);
        if (result.ok) {
          state.lastObservation = result.state;
          state.liveDecisions.push(...result.decisions.slice(-24));
          state.sessionSummary += `advance seconds=${args.seconds ?? 1} frame=${result.state?.frame} patches=${result.state?.terrain?.patchCount}\n`;
        }
        return;
      }
      case "assertNexusRealtimeState": {
        const result = await readGameHost();
        if (!result.ok) {
          check("nexusRealtimeState", false, result.reason);
          return;
        }
        const actual = resolvePath(result.state, args.path);
        const passed = compare(actual, args.operator ?? "===", args.value);
        check("nexusRealtimeState", passed, `${args.path} ${args.operator ?? "==="} ${args.value}; actual=${actual}`);
        state.lastObservation = result.state;
        return;
      }
      case "assertFrameAdvanced": {
        const result = await readGameHost();
        const frame = Number(result.state?.frame ?? 0);
        const minFrame = Number(args.minFrame ?? state.lastFrameBeforeAdvance + 1);
        check("frameAdvanced", frame >= minFrame, `frame=${frame} min=${minFrame}`);
        state.lastObservation = result.state;
        return;
      }
      case "assertNoConsoleErrors":
        check("noConsoleErrors", state.consoleErrors.length === 0, `${state.consoleErrors.length} console errors`);
        return;
      case "captureScreenshot": {
        await ensureBrowser();
        const artifactDir = resolve(args.artifactDir ?? state.artifactDir);
        mkdirSync(artifactDir, { recursive: true });
        const fileName = args.name ?? `nexusrealtime-${Date.now()}.png`;
        const path = resolve(artifactDir, fileName);
        await page.screenshot({ path, fullPage: Boolean(args.fullPage) });
        state.artifacts.push(path);
        check("screenshotCaptured", true, path);
        return;
      }
      case "summarizeSession":
        state.durationMs = now() - startedAt;
        state.sessionSummary += `durationMs=${state.durationMs} checks=${state.checks.length} errors=${state.consoleErrors.length}\n`;
        check("sessionSummarized", true, `${state.durationMs}ms`);
        return;
      case "stopServer":
        await closeRuntime();
        check("runtimeStopped", true, "browser/server closed");
        return;
      default:
        throw new Error(`nexusrealtime-simtime does not know how to post command "${event.command}".`);
    }
  }

  function getState() {
    state.durationMs = now() - startedAt;
    const output = clone(state);
    output.lastObservation = compactObservation(state.lastObservation);
    return output;
  }

  function getOutput() {
    return clone({
      artifactDir: state.artifactDir,
      artifacts: state.artifacts,
      checks: state.checks,
      consoleErrors: state.consoleErrors,
      durationMs: state.durationMs,
      lastObservation: compactObservation(state.lastObservation),
      liveDecisions: state.liveDecisions.slice(-12),
      logs: state.logs,
      sessionSummary: state.sessionSummary,
      simtime: id,
      status: state.status
    });
  }

  function reset() {
    state = createInitialState(context);
  }

  return {
    id,
    type,
    surface,
    label: "nexusrealtime-simtime",
    supports: nexusRealtimeSupports,
    post,
    getOutput,
    getState,
    reset,
    dispose: closeRuntime
  };
}
