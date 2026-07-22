import { isAbsolute, relative, resolve } from "node:path";
import { detectApp } from "./app-detection.js";
import { createNexusHeadlessAdapter } from "./nexus-headless-simtime.js";
import { createPlaywrightAdapter } from "./playwright-simtime.js";
import { isBuiltinWorldCommand } from "./world-command-registry.js";

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stagedPath(session, value, label) {
  const path = resolve(session.stagedRoot, value ?? ".");
  const rel = relative(session.stagedRoot, path);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    const error = new Error(`${label} must remain inside the staged SimSpace app.`);
    error.code = "PATH_OUTSIDE_SIMSPACE";
    throw error;
  }
  return path;
}

export function createBrowserWorldAdapter(session) {
  let playwright = null;
  let bridgeManifest = null;
  let lastDiagnostics = { consoleErrors: [], logs: [], processes: [] };
  let started = false;

  async function start() {
    if (started) return;
    const detection = detectApp(session.stagedAppPath);
    playwright = createPlaywrightAdapter({
      env: {
        app: {
          artifactDir: `${session.runDir}/artifacts`,
          attachedAppPath: session.stagedAppPath,
          detectedMode: detection.detectedMode,
          launchMode: detection.launchMode,
          recordVideo: false,
          simspace: {
            runDir: session.runDir,
            runId: session.sessionId,
            stagedAppPath: session.stagedAppPath,
            stagedRoot: session.stagedRoot,
          },
        },
        name: session.sessionId,
      },
    });
    await playwright.post({ command: "loadApp", args: {
      artifactDir: `${session.runDir}/artifacts`,
      attachedAppPath: session.stagedAppPath,
      detectedMode: detection.detectedMode,
      launchMode: detection.launchMode,
      path: session.stagedAppPath,
    } });
    const launch = session.profile?.launch;
    const baseUrl = `http://127.0.0.1:${session.allocatedPort}`;
    const allowedEnv = new Set(session.profile?.environmentAllowlist ?? []);
    const configuredEnv = Object.fromEntries(Object.entries(launch?.env ?? {}).filter(([key]) => allowedEnv.has(key)));
    const runEnv = {
      ...configuredEnv,
      NEXUS_SIM_ARTIFACT_ROOT: `${session.runDir}/artifacts`,
      NEXUS_SIM_OUTPUT_ROOT: `${session.runDir}/output`,
      NEXUS_SIM_TEMP_ROOT: `${session.runDir}/temp`,
      PORT: String(session.allocatedPort),
    };
    const startArgs = launch?.command
      ? {
          command: launch.command,
          cwd: stagedPath(session, launch.cwd, "launch.cwd"),
          env: runEnv,
          inheritEnv: false,
          memoryLimitMb: session.profile.resourceLimits.memoryMb,
          port: session.allocatedPort,
          timeoutMs: launch.timeoutMs,
          url: `${baseUrl}${launch.urlPath}`,
          waitUrl: `${baseUrl}${launch.waitPath}`,
        }
      : {
          env: runEnv,
          inheritEnv: false,
          memoryLimitMb: session.profile.resourceLimits.memoryMb,
          port: session.allocatedPort,
          timeoutMs: 30000,
        };
    await playwright.post({ command: "startServer", args: startArgs });
    await playwright.post({ command: "openPage", args: launch ? { url: `${baseUrl}${launch.urlPath}` } : {} });
    bridgeManifest = await playwright.post({ command: "worldManifest", args: { timeoutMs: 60000 } });
    started = true;
  }

  async function capabilities() {
    await start();
    const profileAllowlist = new Set(session.profile?.allowActions ?? []);
    return (bridgeManifest.actions ?? [])
      .filter((id) => !profileAllowlist.size || profileAllowlist.has(id))
      .map((id) => ({ allowlisted: true, id }));
  }

  async function execute(command) {
    await start();
    if (command.action === "world.observe") return { data: await observe(), ok: true };
    if (command.action === "world.capture") {
      return capture(command.args?.name ?? `${command.id}.png`);
    }
    return playwright.post({ command: "worldInvoke", args: { action: command.action, args: command.args ?? {} } });
  }

  async function capture(name) {
    await start();
    const captured = await playwright.post({ command: "captureScreenshot", args: { fullPage: false, name } });
    return { artifacts: [captured.artifact], data: { artifact: captured.artifact }, ok: true };
  }

  async function observe() {
    await start();
    return playwright.post({ command: "worldObserve", args: {} });
  }

  async function snapshot() {
    await start();
    return playwright.post({ command: "worldSnapshot", args: {} });
  }

  async function restore(value) {
    await start();
    return playwright.post({ command: "worldRestore", args: { snapshot: clone(value) } });
  }

  async function close() {
    if (!playwright) return;
    await playwright.dispose().catch(() => {});
    lastDiagnostics = { ...playwright.getOutput(), consoleLogs: playwright.getState().consoleLogs ?? [] };
    playwright = null;
    bridgeManifest = null;
    started = false;
  }

  async function cancel() {
    return false;
  }

  function diagnostics() {
    if (!playwright) return clone(lastDiagnostics);
    return clone({ ...playwright.getOutput(), consoleLogs: playwright.getState().consoleLogs ?? [] });
  }

  return Object.freeze({
    id: "browser-world",
    kind: "browser",
    capabilities,
    capture,
    cancel,
    close,
    diagnostics,
    execute,
    observe,
    restore,
    snapshot,
    start,
  });
}

export function createNexusHeadlessWorldAdapter(session) {
  let simtime = null;
  let manifest = null;
  let lastDiagnostics = { logs: [], processes: [] };
  let started = false;

  async function start() {
    if (started) return;
    simtime = createNexusHeadlessAdapter({
      env: {
        app: { simspace: { stagedRoot: session.stagedRoot } },
        name: session.sessionId,
        worldProfile: session.profile,
      },
    });
    await simtime.post({ command: "loadHeadlessRuntime", args: {
      profile: session.profile,
      sessionId: session.sessionId,
      stagedRoot: session.stagedRoot,
    } });
    manifest = await simtime.post({ command: "worldManifest", args: {} });
    started = true;
  }

  async function capabilities() {
    await start();
    return clone((manifest.actions ?? []).filter((entry) => isBuiltinWorldCommand(entry.id) || entry.inputSchema));
  }

  async function execute(command, context = {}) {
    await start();
    if (command.action === "world.observe") return { data: await observe(), ok: true };
    return simtime.post({
      command: "worldInvoke",
      args: { ...command, signal: context.signal, stopOnFailure: context.onError !== "continue" },
    });
  }

  async function observe() {
    await start();
    return simtime.post({ command: "worldObserve", args: {} });
  }

  async function snapshot() {
    await start();
    return simtime.post({ command: "worldSnapshot", args: {} });
  }

  async function restore(value) {
    await start();
    return simtime.post({ command: "worldRestore", args: { snapshot: clone(value) } });
  }

  async function close() {
    if (!simtime) return;
    lastDiagnostics = simtime.getOutput();
    await simtime.dispose().catch(() => {});
    simtime = null;
    started = false;
    manifest = null;
  }

  async function cancel() {
    if (!simtime) return false;
    return simtime.post({ command: "worldCancel", args: {} });
  }

  function diagnostics() {
    return clone(simtime?.getOutput() ?? lastDiagnostics);
  }

  return Object.freeze({
    id: "nexus-headless-world",
    kind: "nexus-headless",
    capabilities,
    cancel,
    close,
    diagnostics,
    execute,
    observe,
    restore,
    snapshot,
    start,
  });
}

export function createWorldAdapter(session) {
  if (session.adapter === "browser") return createBrowserWorldAdapter(session);
  if (session.adapter === "nexus-headless") return createNexusHeadlessWorldAdapter(session);
  throw new Error(`Unknown world adapter "${session.adapter}".`);
}
