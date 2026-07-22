import { execFile, spawn } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, join, resolve } from "node:path";

export const playwrightSupports = [
  "loadApp",
  "startServer",
  "openPage",
  "wait",
  "click",
  "type",
  "keyDown",
  "keyUp",
  "holdKey",
  "select",
  "pressKey",
  "moveMouse",
  "pointerDown",
  "pointerMove",
  "pointerUp",
  "doubleClick",
  "rightClick",
  "wheel",
  "resizeViewport",
  "waitForSelector",
  "assertText",
  "assertWindowState",
  "assertGlobalState",
  "assertGameQuality",
  "assertCanvasExists",
  "assertCanvasChanged",
  "assertFrameRendered",
  "assertSmoothFrameTelemetry",
  "assertNoConsoleErrors",
  "captureScreenshot",
  "recordTrace",
  "recordVideo",
  "getConsoleLogs",
  "stopServer",
  "playSession",
  "playDeterministicSession",
  "observe",
  "summarizeSession",
  "checkpoint",
  "assertStillResponsive",
  "advanceSimTime",
  "worldManifest",
  "worldInvoke",
  "worldObserve",
  "worldSnapshot",
  "worldRestore",
];

const contentTypes = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mjs": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function createInitialState(context) {
  const app = context.env?.app ?? {};
  return {
    artifactDir: app.artifactDir ?? (context.env?.name ? `.nexus-simulator/artifacts/${context.env.name}` : ".nexus-simulator/artifacts/playwright"),
    artifacts: [],
    attachedAppPath: app.attachedAppPath ?? null,
    browserOpen: false,
    checks: [],
    consoleErrors: [],
    consoleLogs: [],
    detectedMode: app.detectedMode ?? "unknown",
    durationMs: 0,
    events: [],
    launchMode: app.launchMode ?? "unknown",
    logs: [],
    processes: [],
    recordVideo: app.recordVideo !== false,
    pageOpened: false,
    server: null,
    sessionSummary: "",
    smoothFrameTelemetry: null,
    status: "passed",
  };
}

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(`Playwright is not installed. Install it with "npm install --save-dev playwright" before running --simtime playwright. Original error: ${error.code ?? error.message}`);
  }
}

async function waitForHttp(url, timeoutMs = 15000) {
  const start = now();
  while (now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {
      // Retry until timeout.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startStaticServer(appPath, port = 0) {
  const { root, entry } = pathForApp(appPath);
  const server = createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const relativePath = requestPath === "/" ? entry : requestPath.slice(1);
    const filePath = resolve(root, relativePath);

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
        url: `http://127.0.0.1:${address.port}/`,
      });
    });
  });
}

function safeProcessEnv(extra = {}) {
  const tempRoot = extra.NEXUS_SIM_TEMP_ROOT ?? process.env.TMPDIR ?? "/tmp";
  return {
    HOME: tempRoot,
    PATH: process.env.PATH,
    TMPDIR: tempRoot,
    ...extra,
  };
}

function signalProcessTree(child, signal) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function monitorChildMemory(child, limitMb) {
  const state = { exceeded: false, latestMb: null, limitMb: Number(limitMb) || null, peakMb: 0 };
  if (!state.limitMb || process.platform === "win32") return { snapshot: () => ({ ...state }), stop() {} };
  const sample = () => {
    execFile("ps", ["-o", "rss=", "-p", String(child.pid)], { timeout: 2000 }, (error, stdout) => {
      if (error) return;
      const rssKb = Number(String(stdout).trim());
      if (!Number.isFinite(rssKb)) return;
      state.latestMb = Number((rssKb / 1024).toFixed(2));
      state.peakMb = Math.max(state.peakMb, state.latestMb);
      if (state.latestMb > state.limitMb && !state.exceeded) {
        state.exceeded = true;
        signalProcessTree(child, "SIGTERM");
      }
    });
  };
  sample();
  const timer = setInterval(sample, 1000);
  timer.unref?.();
  return {
    snapshot: () => ({ ...state }),
    stop: () => clearInterval(timer),
  };
}

function stopChildProcess(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolveClose) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(giveUpTimer);
      resolveClose();
    };
    child.once("close", finish);
    signalProcessTree(child, "SIGTERM");
    const forceTimer = setTimeout(() => signalProcessTree(child, "SIGKILL"), 1500);
    const giveUpTimer = setTimeout(finish, 3000);
  });
}

function startDevServer(appPath, port, args = {}) {
  const cwd = pathForApp(appPath).root;
  const child = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)], {
    cwd,
    detached: process.platform !== "win32",
    env: args.inheritEnv === false ? safeProcessEnv({ ...(args.env ?? {}), PORT: String(port) }) : { ...process.env, ...(args.env ?? {}) },
    shell: false,
  });
  const memoryMonitor = monitorChildMemory(child, args.memoryLimitMb);
  return {
    close: async () => {
      memoryMonitor.stop();
      await stopChildProcess(child);
    },
    memoryMonitor,
    process: child,
    root: cwd,
    url: `http://127.0.0.1:${port}/`,
  };
}

function startCommandServer(args, appPath) {
  const commandParts = Array.isArray(args.command)
    ? args.command.map(String)
    : String(args.command ?? "").split(" ").filter(Boolean);
  const [command, ...commandArgs] = commandParts;
  if (!command) throw new Error("startServer args.command must be a non-empty string or array.");

  const cwd = resolve(args.cwd ?? pathForApp(appPath).root);
  const env = args.inheritEnv === false
    ? safeProcessEnv(args.env ?? {})
    : { ...process.env, ...(args.env ?? {}) };
  const child = spawn(command, commandArgs, {
    cwd,
    detached: process.platform !== "win32",
    env,
    shell: false,
  });
  const memoryMonitor = monitorChildMemory(child, args.memoryLimitMb);
  const url = args.url ?? `http://127.0.0.1:${Number(args.port ?? env.PORT ?? 3011)}/`;

  return {
    close: async () => {
      memoryMonitor.stop();
      await stopChildProcess(child);
    },
    memoryMonitor,
    process: child,
    root: cwd,
    url,
  };
}

async function canvasSample(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    try {
      return canvas.toDataURL();
    } catch {
      return {
        height: canvas.height,
        rendered: true,
        width: canvas.width,
      };
    }
  });
}

async function pointFor(page, args) {
  const x = Number(args.x ?? 0);
  const y = Number(args.y ?? 0);
  if (!args.selector) return { x, y };
  const box = await page.locator(args.selector).boundingBox();
  if (!box) throw new Error(`Selector has no bounding box: ${args.selector}`);
  return {
    x: box.x + x,
    y: box.y + y,
  };
}

function compareValue(actual, operator, expected) {
  switch (operator) {
    case ">":
      return actual > expected;
    case ">=":
      return actual >= expected;
    case "<":
      return actual < expected;
    case "<=":
      return actual <= expected;
    case "!=":
    case "!==":
      return actual !== expected;
    case "includes":
      return String(actual).includes(String(expected));
    case "=":
    case "==":
    case "===":
    default:
      return actual === expected;
  }
}

export function createPlaywrightAdapter(context = {}) {
  const id = "playwright";
  const type = "app";
  const surface = "browser";
  let state = createInitialState(context);
  let playwright = null;
  let browser = null;
  let browserContext = null;
  let page = null;
  let pendingTraceArtifact = null;
  let pendingVideoArtifact = null;
  let serverHandle = null;
  let startedAt = now();

  function log(message) {
    state.logs.push(message);
  }

  function check(name, passed, detail = "") {
    state.checks.push({ name, passed, detail });
    if (!passed) state.status = "failed";
  }

  async function ensureBrowser() {
    if (page) return;
    playwright ??= await importPlaywright();
    browser = await playwright.chromium.launch({ headless: true });
    const artifactDir = resolve(state.artifactDir);
    const videoDir = join(artifactDir, ".videos");
    mkdirSync(videoDir, { recursive: true });
    browserContext = await browser.newContext({
      ...(state.recordVideo || pendingVideoArtifact ? {
        recordVideo: {
          dir: videoDir,
          size: { width: 1280, height: 720 },
        },
      } : {}),
      viewport: { width: 1280, height: 720 },
    });
    page = await browserContext.newPage();
    state.browserOpen = true;
    page.on("console", (message) => {
      const entry = `${message.type()}: ${message.text()}`;
      state.consoleLogs.push(entry);
      if (message.type() === "error") state.consoleErrors.push(entry);
    });
    page.on("pageerror", (error) => {
      const entry = `pageerror: ${error.message}`;
      state.consoleErrors.push(entry);
      state.consoleLogs.push(entry);
    });
  }

  async function closeRuntime() {
    let video = null;
    let traceError = null;
    if (pendingTraceArtifact && browserContext) {
      const artifactDir = resolve(state.artifactDir);
      mkdirSync(artifactDir, { recursive: true });
      const destination = join(artifactDir, pendingTraceArtifact.name);
      try {
        await browserContext.tracing.stop({ path: destination });
        state.artifacts.push(destination);
        check("traceRecorded", existsSync(destination), destination);
      } catch (error) {
        traceError = error;
      }
      pendingTraceArtifact = null;
    }
    if (page) {
      video = page.video?.() ?? null;
      await page.close().catch(() => {});
      page = null;
    }
    if (browserContext) {
      await browserContext.close().catch(() => {});
      browserContext = null;
    }
    if (pendingVideoArtifact && video) {
      const artifactDir = resolve(state.artifactDir);
      mkdirSync(artifactDir, { recursive: true });
      const destination = join(artifactDir, pendingVideoArtifact.name);
      const source = await video.path();
      copyFileSync(source, destination);
      state.artifacts.push(destination);
      check("videoRecorded", existsSync(destination), destination);
      pendingVideoArtifact = null;
    }
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
    }
    if (serverHandle) {
      syncProcessMetrics();
      await serverHandle.close().catch(() => {});
      serverHandle = null;
    }
    for (const processEntry of state.processes) {
      if (!processEntry.exitedAt) {
        processEntry.exitedAt = new Date().toISOString();
        processEntry.status = "stopped";
      }
    }
    state.browserOpen = false;
    state.server = null;
    if (traceError) throw traceError;
  }

  function syncProcessMetrics() {
    const processId = serverHandle?.process?.pid;
    const metrics = serverHandle?.memoryMonitor?.snapshot();
    if (!processId || !metrics) return;
    const entry = state.processes.find((processEntry) => processEntry.pid === processId);
    if (entry) entry.memory = metrics;
  }

  async function reset() {
    await closeRuntime();
    state = createInitialState(context);
    startedAt = now();
  }

  async function post(event) {
    state.events.push(clone(event));
    const args = event.args ?? {};

    switch (event.command) {
      case "loadApp":
        state.attachedAppPath = args.path ?? args.attachedAppPath ?? state.attachedAppPath;
        state.detectedMode = args.detectedMode ?? args.appKind ?? state.detectedMode;
        state.launchMode = args.launchMode ?? state.launchMode;
        state.artifactDir = args.artifactDir ?? state.artifactDir;
        check("appLoaded", Boolean(state.attachedAppPath), "app metadata available");
        log(`loaded app ${state.attachedAppPath ?? "unknown"}`);
        return;
      case "startServer": {
        const requestedPort = args.port !== undefined ? Number(args.port) : undefined;
        const port = Number(requestedPort ?? 5173);
        if (args.command) {
          serverHandle = startCommandServer(args, state.attachedAppPath);
          if (serverHandle.process?.pid) {
            state.processes.push({
              kind: "command",
              pid: serverHandle.process.pid,
              status: "running",
              url: serverHandle.url,
            });
          }
          serverHandle.process.stdout.on("data", (data) => log(`command stdout: ${data.toString().trim()}`));
          serverHandle.process.stderr.on("data", (data) => log(`command stderr: ${data.toString().trim()}`));
          await waitForHttp(args.waitUrl ?? serverHandle.url, Number(args.timeoutMs ?? 20000));
        } else if (state.launchMode === "dev-server") {
          serverHandle = startDevServer(state.attachedAppPath, port, args);
          if (serverHandle.process?.pid) {
            state.processes.push({
              kind: "dev-server",
              pid: serverHandle.process.pid,
              status: "running",
              url: serverHandle.url,
            });
          }
          serverHandle.process.stdout.on("data", (data) => log(`dev stdout: ${data.toString().trim()}`));
          serverHandle.process.stderr.on("data", (data) => log(`dev stderr: ${data.toString().trim()}`));
          await waitForHttp(serverHandle.url, Number(args.timeoutMs ?? 20000));
        } else {
          serverHandle = requestedPort !== undefined
            ? await startStaticServer(state.attachedAppPath, port)
            : await startStaticServer(state.attachedAppPath);
          await waitForHttp(serverHandle.url, Number(args.timeoutMs ?? 5000));
        }
        state.server = { root: serverHandle.root, url: serverHandle.url };
        check("serverStarted", true, serverHandle.url);
        log(`server started ${serverHandle.url}`);
        return;
      }
      case "openPage": {
        await ensureBrowser();
        const url = args.url ?? state.server?.url;
        if (!url) throw new Error("openPage requires args.url or a started server.");
        await page.goto(url, { waitUntil: args.waitUntil ?? "networkidle" });
        state.pageOpened = true;
        check("pageOpened", true, url);
        log(`opened ${url}`);
        return;
      }
      case "wait": {
        const ms = Number(args.ms ?? 0);
        await ensureBrowser();
        await page.waitForTimeout(ms);
        log(`waited ${ms}ms`);
        return;
      }
      case "click":
        await ensureBrowser();
        await page.click(args.selector);
        check("click", true, args.selector);
        return;
      case "type":
        await ensureBrowser();
        await page.fill(args.selector, args.text ?? "");
        check("type", true, args.selector);
        return;
      case "select":
        await ensureBrowser();
        await page.selectOption(args.selector, args.value);
        check("select", true, `${args.selector}=${args.value}`);
        return;
      case "pressKey":
        await ensureBrowser();
        await page.keyboard.press(args.key);
        check("pressKey", true, args.key);
        return;
      case "keyDown":
        await ensureBrowser();
        await page.keyboard.down(args.key);
        check("keyDown", true, args.key);
        return;
      case "keyUp":
        await ensureBrowser();
        await page.keyboard.up(args.key);
        check("keyUp", true, args.key);
        return;
      case "holdKey": {
        await ensureBrowser();
        const key = args.key;
        const durationMs = Number(args.durationMs ?? 0);
        await page.keyboard.down(key);
        await page.waitForTimeout(Math.max(0, durationMs));
        await page.keyboard.up(key);
        check("holdKey", true, `${key} ${durationMs}ms`);
        return;
      }
      case "moveMouse":
        await ensureBrowser();
        await page.mouse.move(Number(args.x ?? 0), Number(args.y ?? 0));
        check("moveMouse", true, `${args.x ?? 0},${args.y ?? 0}`);
        return;
      case "pointerDown": {
        await ensureBrowser();
        const point = await pointFor(page, args);
        await page.mouse.move(point.x, point.y);
        await page.mouse.down({ button: args.button ?? "left" });
        check("pointerDown", true, `${point.x},${point.y}`);
        return;
      }
      case "pointerMove": {
        await ensureBrowser();
        const point = await pointFor(page, args);
        await page.mouse.move(point.x, point.y);
        check("pointerMove", true, `${point.x},${point.y}`);
        return;
      }
      case "pointerUp": {
        await ensureBrowser();
        const point = await pointFor(page, args);
        await page.mouse.move(point.x, point.y);
        await page.mouse.up({ button: args.button ?? "left" });
        check("pointerUp", true, `${point.x},${point.y}`);
        return;
      }
      case "doubleClick":
        await ensureBrowser();
        await page.dblclick(args.selector, {
          position: args.x !== undefined || args.y !== undefined ? { x: Number(args.x ?? 0), y: Number(args.y ?? 0) } : undefined,
        });
        check("doubleClick", true, args.selector);
        return;
      case "rightClick":
        await ensureBrowser();
        await page.click(args.selector, {
          button: "right",
          position: args.x !== undefined || args.y !== undefined ? { x: Number(args.x ?? 0), y: Number(args.y ?? 0) } : undefined,
        });
        check("rightClick", true, args.selector);
        return;
      case "wheel":
        await ensureBrowser();
        await page.mouse.wheel(Number(args.deltaX ?? 0), Number(args.deltaY ?? 0));
        check("wheel", true, `${args.deltaX ?? 0},${args.deltaY ?? 0}`);
        return;
      case "resizeViewport":
        await ensureBrowser();
        await page.setViewportSize({
          width: Number(args.width ?? 1024),
          height: Number(args.height ?? 768),
        });
        check("resizeViewport", true, `${args.width ?? 1024}x${args.height ?? 768}`);
        return;
      case "waitForSelector":
        await ensureBrowser();
        await page.waitForSelector(args.selector, {
          state: args.state ?? "visible",
          timeout: Number(args.timeoutMs ?? 5000),
        });
        check("waitForSelector", true, `${args.selector} state=${args.state ?? "visible"}`);
        return;
      case "assertText": {
        await ensureBrowser();
        const text = await page.textContent(args.selector ?? "body");
        const expected = args.text ?? "";
        const passed = text?.includes(expected) ?? false;
        check("assertText", passed, expected);
        return;
      }
      case "assertWindowState": {
        await ensureBrowser();
        const actual = await page.evaluate((path) => {
          const source = {
            devicePixelRatio: window.devicePixelRatio,
            height: window.innerHeight,
            href: window.location.href,
            title: document.title,
            width: window.innerWidth,
          };
          return path.split(".").filter(Boolean).reduce((current, part) => current?.[part], source);
        }, args.path ?? "title");
        const passed = compareValue(actual, args.operator ?? "===", args.value);
        check("assertWindowState", passed, `${args.path ?? "title"} ${args.operator ?? "==="} ${args.value}; actual=${actual}`);
        return;
      }
      case "assertGlobalState": {
        await ensureBrowser();
        const actual = await page.evaluate((path) => {
          const root = window.__NEXUS_TEST_STATE__;
          return path.split(".").filter(Boolean).reduce((current, part) => {
            if (current === undefined || current === null) return undefined;
            if (part === "length") return current.length;
            return current[part];
          }, root);
        }, args.path ?? "");
        const passed = compareValue(actual, args.operator ?? "===", args.value);
        check("assertGlobalState", passed, `${args.path ?? ""} ${args.operator ?? "==="} ${args.value}; actual=${actual}`);
        return;
      }
      case "assertGameQuality": {
        await ensureBrowser();
        const result = await page.evaluate((options) => {
          const canvas = document.querySelector("canvas");
          const rect = canvas?.getBoundingClientRect();
          const state = window.__NEXUS_TEST_STATE__ ?? {};
          const recording = state.recording ?? {};
          const visibleOverlaySelectors = [".hud", ".hud-top", ".hud-bottom", ".panel", ".hud-debug", "[data-field]", "[data-control]"];
          const visibleOverlayCount = visibleOverlaySelectors.reduce((count, selector) => {
            return count + Array.from(document.querySelectorAll(selector)).filter((element) => {
              const style = window.getComputedStyle(element);
              const box = element.getBoundingClientRect();
              return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0 && box.width > 0 && box.height > 0;
            }).length;
          }, 0);
          const bodyText = (document.body?.innerText ?? "").trim();
          return {
            cameraSafe: recording.cameraSafe !== false,
            canvasReady: Boolean(rect?.width && rect?.height),
            keyframedCharacter: recording.characterAnimation?.keyframed === true,
            skeletonJoints: Number(recording.characterAnimation?.jointCount ?? 0),
            checkpoint: recording.checkpoint ?? "unknown",
            frame: Number(state.frame ?? 0),
            minFramePassed: Number(state.frame ?? 0) >= Number(options.minFrame ?? 2),
            noVisibleOverlay: visibleOverlayCount === 0 && bodyText.length === 0,
            overlayTextLength: bodyText.length,
            overlayCount: visibleOverlayCount,
            props: Number(recording.totalForestProps ?? 0),
            propsPassed: Number(recording.totalForestProps ?? 0) >= Number(options.minForestProps ?? 0),
            routeComplete: Boolean(recording.routeComplete),
            skeletonPassed: Number(recording.characterAnimation?.jointCount ?? 0) >= Number(options.minSkeletonJoints ?? 0),
            version: recording.version ?? state.recordingVersion ?? null
          };
        }, {
          minForestProps: args.minForestProps ?? 0,
          minFrame: args.minFrame ?? 2,
          minSkeletonJoints: args.minSkeletonJoints ?? 0,
          requireNoOverlay: args.requireNoOverlay === true
        });
        const overlayPassed = args.requireNoOverlay === true ? result.noVisibleOverlay : true;
        const passed = result.canvasReady && result.minFramePassed && result.cameraSafe && result.propsPassed && result.skeletonPassed && overlayPassed && (Number(args.minSkeletonJoints ?? 0) <= 0 || result.keyframedCharacter);
        check("gameQuality", passed, JSON.stringify(result));
        return;
      }
      case "assertCanvasExists": {
        await ensureBrowser();
        const passed = await page.evaluate(() => {
          const canvas = document.querySelector("canvas");
          if (!canvas) return false;
          const rect = canvas.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        check("canvasExists", passed, state.detectedMode);
        return;
      }
      case "assertCanvasChanged": {
        await ensureBrowser();
        const before = await canvasSample(page);
        await page.waitForTimeout(Number(args.sampleMs ?? 1000));
        const after = await canvasSample(page);
        const passed = before !== null && after !== null && JSON.stringify(before) !== JSON.stringify(after);
        check("canvasChanged", passed, `sampleMs=${args.sampleMs ?? 1000}`);
        return;
      }
      case "assertFrameRendered": {
        await ensureBrowser();
        const passed = await page.evaluate(() => Boolean(document.body?.innerText?.trim() || document.querySelector("canvas,img,svg,video")));
        check("frameRendered", passed, "visible page content");
        return;
      }
      case "assertNoConsoleErrors":
        check("consoleClean", state.consoleErrors.length === 0, `${state.consoleErrors.length} console errors`);
        return;
      case "captureScreenshot": {
        await ensureBrowser();
        const artifactDir = resolve(state.artifactDir);
        mkdirSync(artifactDir, { recursive: true });
        const path = join(artifactDir, args.name ?? "screenshot.png");
        await page.screenshot({ fullPage: args.fullPage !== false, path });
        state.artifacts.push(path);
        check("screenshotCaptured", existsSync(path), path);
        return { artifact: path };
      }
      case "recordVideo": {
        await ensureBrowser();
        pendingVideoArtifact = {
          durationMs: Number(args.durationMs ?? 15000),
          name: args.name ?? "asset-recording.webm",
        };
        state.sessionSummary += `recordVideo name=${pendingVideoArtifact.name} durationMs=${pendingVideoArtifact.durationMs} fps=${args.fps ?? "default"} captureMode=${args.captureMode ?? "realtime"}\n`;
        check("videoRecordingArmed", true, `${pendingVideoArtifact.name} durationMs=${pendingVideoArtifact.durationMs}`);
        return;
      }
      case "recordTrace": {
        await ensureBrowser();
        if (pendingTraceArtifact) throw new Error("Playwright trace recording is already active.");
        pendingTraceArtifact = { name: args.name ?? "playwright-trace.zip" };
        await browserContext.tracing.start({
          screenshots: args.screenshots !== false,
          snapshots: args.snapshots !== false,
          sources: args.sources !== false,
        });
        state.sessionSummary += `recordTrace name=${pendingTraceArtifact.name}\n`;
        check("traceRecordingArmed", true, pendingTraceArtifact.name);
        return;
      }
      case "getConsoleLogs":
        check("consoleLogsRead", true, `${state.consoleLogs.length} entries`);
        return;
      case "checkpoint":
        state.sessionSummary += `${args.name ?? `checkpoint-${state.checks.length}`}: ${args.note ?? ""}\n`;
        check("checkpoint", true, args.name ?? "");
        return;
      case "observe": {
        await ensureBrowser();
        const title = await page.title();
        const url = page.url();
        const text = await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
        const summary = `observe title="${title}" url="${url}" textLength=${text.length}`;
        state.sessionSummary += `${summary}\n`;
        log(summary);
        return;
      }
      case "assertStillResponsive": {
        await ensureBrowser();
        const passed = await page.evaluate(() => document.readyState !== "loading").catch(() => false);
        check("stillResponsive", passed, page.url());
        return;
      }
      case "playSession": {
        await ensureBrowser();
        const durationMs = Number(args.durationMs ?? 600000);
        const intervalMs = Number(args.intervalMs ?? 30000);
        const end = now() + durationMs;
        let steps = 0;
        while (now() < end) {
          await page.waitForTimeout(Math.min(intervalMs, Math.max(0, end - now())));
          const responsive = await page.evaluate(() => document.readyState !== "loading").catch(() => false);
          check("sessionResponsive", responsive, `step=${steps}`);
          steps += 1;
        }
        state.sessionSummary += `playSession durationMs=${durationMs} steps=${steps}\n`;
        log(`played session for ${durationMs}ms`);
        return;
      }
      case "playDeterministicSession": {
        await ensureBrowser();
        const durationMs = Number(args.durationMs ?? 15000);
        const fps = Math.max(1, Number(args.fps ?? 60));
        const intervalMs = Math.max(1, Number(args.intervalMs ?? Math.round(1000 / fps)));
        const frames = Math.max(1, Math.round((durationMs / 1000) * fps));
        let failedFrames = 0;
        for (let frame = 0; frame < frames; frame += 1) {
          const result = await page.evaluate(({ deltaSeconds, frameIndex, fpsValue }) => {
            if (!window.__NEXUS_SIMTIME__) return { ok: false, reason: "missing-window-simtime" };
            if (typeof window.__NEXUS_SIMTIME__.advanceFrame === "function") {
              return {
                ok: true,
                state: window.__NEXUS_SIMTIME__.advanceFrame({
                  deltaSeconds,
                  fps: fpsValue,
                  frameIndex,
                  view: "deterministic-recording"
                })
              };
            }
            if (typeof window.__NEXUS_SIMTIME__.advance === "function") {
              return {
                ok: true,
                state: window.__NEXUS_SIMTIME__.advance(deltaSeconds, {
                  captureMode: "deterministic",
                  fps: fpsValue,
                  frameIndex,
                  view: "deterministic-recording"
                })
              };
            }
            return { ok: false, reason: "missing-advance-frame" };
          }, {
            deltaSeconds: 1 / fps,
            fpsValue: fps,
            frameIndex: frame,
          });
          if (!result.ok) failedFrames += 1;
          await page.waitForTimeout(intervalMs);
        }
        check("deterministicFramesAdvanced", failedFrames === 0, `frames=${frames} failed=${failedFrames} fps=${fps}`);
        state.sessionSummary += `playDeterministicSession durationMs=${durationMs} frames=${frames} fps=${fps} failed=${failedFrames}\n`;
        log(`played deterministic session for ${durationMs}ms at ${fps}fps`);
        return;
      }
      case "assertSmoothFrameTelemetry": {
        await ensureBrowser();
        const telemetry = await page.evaluate(() => window.__NEXUS_TEST_STATE__?.recording?.smoothness ?? null).catch(() => null);
        state.smoothFrameTelemetry = telemetry;
        const minFrames = Number(args.minFrames ?? 1);
        const minFps = Number(args.minFps ?? 24);
        const maxDroppedFrames = Number(args.maxDroppedFrames ?? 3);
        const passed = Boolean(telemetry)
          && Number(telemetry.renderedFrames ?? 0) >= minFrames
          && Number(telemetry.measuredFps ?? 0) >= minFps
          && Number(telemetry.droppedFrames ?? 0) <= maxDroppedFrames;
        check(
          "smoothFrameTelemetry",
          passed,
          telemetry
            ? `frames=${telemetry.renderedFrames} measuredFps=${telemetry.measuredFps} dropped=${telemetry.droppedFrames}/${maxDroppedFrames}`
            : "missing smoothness telemetry",
        );
        state.sessionSummary += `smoothFrameTelemetry ${JSON.stringify(telemetry)}\n`;
        return;
      }
      case "advanceSimTime": {
        await ensureBrowser();
        const result = await page.evaluate(({ seconds, input }) => {
          if (!window.__NEXUS_SIMTIME__ || typeof window.__NEXUS_SIMTIME__.advance !== "function") {
            return { ok: false, reason: "missing-window-simtime" };
          }
          return {
            ok: true,
            state: window.__NEXUS_SIMTIME__.advance(seconds, input)
          };
        }, {
          seconds: Number(args.seconds ?? 60),
          input: args.input ?? { autopilot: true }
        });
        check("advanceSimTime", result.ok === true, result.ok ? `seconds=${args.seconds ?? 60}` : result.reason);
        state.sessionSummary += `advanceSimTime seconds=${args.seconds ?? 60} ok=${result.ok === true}\n`;
        return;
      }
      case "worldManifest": {
        await ensureBrowser();
        await page.waitForFunction(() => typeof window.__NEXUS_WORLD_COMMANDS__?.manifest === "function", null, {
          timeout: Number(args.timeoutMs ?? 10000),
        }).catch(() => null);
        const manifest = await page.evaluate(() => {
          const bridge = window.__NEXUS_WORLD_COMMANDS__;
          if (!bridge || typeof bridge.manifest !== "function") return null;
          return bridge.manifest();
        });
        if (!manifest) {
          const error = new Error("Page does not expose window.__NEXUS_WORLD_COMMANDS__.manifest().");
          error.code = "WORLD_BRIDGE_UNAVAILABLE";
          throw error;
        }
        check("worldManifest", true, manifest.version ?? "unknown");
        return manifest;
      }
      case "worldInvoke": {
        await ensureBrowser();
        const result = await page.evaluate(async ({ action, commandArgs }) => {
          const bridge = window.__NEXUS_WORLD_COMMANDS__;
          if (!bridge || typeof bridge.execute !== "function") {
            return { ok: false, error: { code: "WORLD_BRIDGE_UNAVAILABLE", message: "World command bridge is unavailable." } };
          }
          try {
            return await bridge.execute({ action, args: commandArgs });
          } catch (error) {
            return { ok: false, error: { code: error?.code ?? "WORLD_BRIDGE_ERROR", message: error?.message ?? String(error) } };
          }
        }, { action: args.action, commandArgs: args.args ?? {} });
        if (result?.ok === false) {
          const error = new Error(result.error?.message ?? `World action failed: ${args.action}`);
          error.code = result.error?.code ?? "WORLD_ACTION_FAILED";
          throw error;
        }
        check("worldInvoke", true, args.action);
        return result;
      }
      case "worldObserve": {
        await ensureBrowser();
        const result = await page.evaluate(() => {
          const bridge = window.__NEXUS_WORLD_COMMANDS__;
          if (!bridge || typeof bridge.observe !== "function") return null;
          return bridge.observe();
        });
        if (!result) {
          const error = new Error("World command bridge cannot observe state.");
          error.code = "WORLD_BRIDGE_UNAVAILABLE";
          throw error;
        }
        return result;
      }
      case "worldSnapshot": {
        await ensureBrowser();
        const result = await page.evaluate(() => {
          const bridge = window.__NEXUS_WORLD_COMMANDS__;
          if (!bridge || typeof bridge.snapshot !== "function") return null;
          return bridge.snapshot();
        });
        if (!result) {
          const error = new Error("World command bridge cannot capture snapshots.");
          error.code = "WORLD_BRIDGE_UNAVAILABLE";
          throw error;
        }
        return result;
      }
      case "worldRestore": {
        await ensureBrowser();
        const result = await page.evaluate(async (snapshot) => {
          const bridge = window.__NEXUS_WORLD_COMMANDS__;
          if (!bridge || typeof bridge.restore !== "function") return null;
          return bridge.restore(snapshot);
        }, args.snapshot);
        if (!result) {
          const error = new Error("World command bridge could not restore the supplied snapshot.");
          error.code = "WORLD_RESTORE_FAILED";
          throw error;
        }
        check("worldRestore", true, "snapshot restored");
        return result;
      }
      case "summarizeSession":
        state.durationMs = now() - startedAt;
        state.sessionSummary += `durationMs=${state.durationMs} checks=${state.checks.length} errors=${state.consoleErrors.length}\n`;
        check("sessionSummarized", true, `${state.durationMs}ms`);
        return;
      case "stopServer":
        await closeRuntime();
        check("serverStopped", true, "runtime closed");
        log("runtime stopped");
        return;
      default:
        throw new Error(`playwright-simtime does not know how to post command "${event.command}".`);
    }
  }

  function getState() {
    syncProcessMetrics();
    state.durationMs = now() - startedAt;
    return clone(state);
  }

  function getOutput() {
    syncProcessMetrics();
    state.durationMs = now() - startedAt;
    return clone({
      artifactDir: state.artifactDir,
      artifacts: state.artifacts,
      attachedAppPath: state.attachedAppPath,
      checks: state.checks,
      consoleErrors: state.consoleErrors,
      detectedMode: state.detectedMode,
      durationMs: state.durationMs,
      launchMode: state.launchMode,
      logs: state.logs,
      processes: state.processes,
      sessionSummary: state.sessionSummary.trim(),
      simtime: id,
      smoothFrameTelemetry: state.smoothFrameTelemetry,
      status: state.status,
    });
  }

  async function captureCheckpointArtifacts(checkpointDir) {
    mkdirSync(checkpointDir, { recursive: true });
    if (page && !page.isClosed()) {
      const screenshotPath = join(checkpointDir, "screenshot.png");
      await page.screenshot({ fullPage: false, path: screenshotPath }).catch(() => null);
    }
    writeFileSync(join(checkpointDir, "console.json"), `${JSON.stringify({
      errors: state.consoleErrors,
      logs: state.consoleLogs,
    }, null, 2)}\n`);
    return {
      screenshot: existsSync(join(checkpointDir, "screenshot.png")) ? join(checkpointDir, "screenshot.png") : null,
      console: join(checkpointDir, "console.json"),
    };
  }

  return {
    id,
    type,
    surface,
    label: "playwright-simtime",
    supports: playwrightSupports,
    post,
    getOutput,
    getState,
    reset,
    captureCheckpointArtifacts,
    dispose: closeRuntime,
  };
}
