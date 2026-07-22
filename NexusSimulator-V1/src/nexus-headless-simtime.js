import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const nexusHeadlessSupports = [
  "loadHeadlessRuntime",
  "worldManifest",
  "worldInvoke",
  "worldObserve",
  "worldSnapshot",
  "worldRestore",
  "worldCancel",
  "stopRuntime",
];

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function inside(root, path) {
  const canonicalRoot = existsSync(root) ? realpathSync(root) : resolve(root);
  const canonicalPath = existsSync(path) ? realpathSync(path) : resolve(path);
  const rel = relative(canonicalRoot, canonicalPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function stagedModule(stagedRoot, value, label) {
  const path = resolve(stagedRoot, value);
  if (!inside(stagedRoot, path) || !existsSync(path)) {
    const error = new Error(`${label} must resolve inside the staged SimSpace app: ${value}`);
    error.code = "HEADLESS_MODULE_OUTSIDE_SIMSPACE";
    throw error;
  }
  return path;
}

function stagedModuleSpecifier(stagedRoot, specifier, label) {
  let path;
  try {
    path = createRequire(resolve(stagedRoot, "package.json")).resolve(specifier);
  } catch (cause) {
    const error = new Error(`${label} could not resolve staged module specifier: ${specifier}`);
    error.code = "HEADLESS_MODULE_NOT_FOUND";
    error.cause = cause;
    throw error;
  }
  if (!inside(stagedRoot, path)) {
    const error = new Error(`${label} module specifier resolved outside staged SimSpace: ${specifier}`);
    error.code = "HEADLESS_MODULE_OUTSIDE_SIMSPACE";
    throw error;
  }
  return path;
}

function resolveRuntimeModule(stagedRoot, path, specifier, label) {
  if (path) return stagedModule(stagedRoot, path, label);
  if (specifier) return stagedModuleSpecifier(stagedRoot, specifier, label);
  const error = new Error(`${label} requires a staged module path or package specifier.`);
  error.code = "HEADLESS_PROFILE_REQUIRED";
  throw error;
}

export function createNexusHeadlessAdapter(context = {}) {
  const id = "nexus-headless";
  const type = "headless";
  const surface = "headless-world";
  let runtime = null;
  let profile = clone(context.env?.worldProfile ?? {});
  let stagedRoot = context.env?.app?.simspace?.stagedRoot ?? null;
  let sessionId = context.env?.name ?? "world-session";
  let allowedCapabilities = [];
  let state;

  function resetState() {
    state = {
      capabilities: [],
      events: [],
      logs: [],
      runtimeLoaded: false,
      sessionId,
      status: "passed",
    };
  }

  async function loadRuntime(args = {}) {
    profile = clone(args.profile ?? profile);
    stagedRoot = args.stagedRoot ?? stagedRoot;
    sessionId = args.sessionId ?? sessionId;
    if ((!profile.modulePath && !profile.moduleSpecifier) || !stagedRoot) {
      const error = new Error("nexus-headless requires a staged runtime module and SimSpace root.");
      error.code = "HEADLESS_PROFILE_REQUIRED";
      throw error;
    }
    const runtimeModule = await import(pathToFileURL(resolveRuntimeModule(stagedRoot, profile.modulePath, profile.moduleSpecifier, "Runtime module")).href);
    const runtimeFactory = runtimeModule[profile.runtimeExport ?? "createHeadlessEditorRuntime"];
    if (typeof runtimeFactory !== "function") {
      throw new Error(`Headless runtime export not found: ${profile.runtimeExport ?? "createHeadlessEditorRuntime"}`);
    }
    let environment;
    if (profile.environmentModulePath || profile.environmentModuleSpecifier) {
      const environmentModule = await import(pathToFileURL(resolveRuntimeModule(stagedRoot, profile.environmentModulePath, profile.environmentModuleSpecifier, "Environment module")).href);
      const environmentFactory = environmentModule[profile.environmentExport ?? "createEnvironment"];
      if (typeof environmentFactory !== "function") {
        throw new Error(`Headless environment export not found: ${profile.environmentExport ?? "createEnvironment"}`);
      }
      environment = await environmentFactory({ profile: clone(profile), stagedRoot });
    }
    runtime = await runtimeFactory({ ...(profile.runtimeOptions ?? {}), environment });
    for (const method of ["listCapabilities", "runScript", "snapshot", "loadSnapshot"]) {
      if (typeof runtime?.[method] !== "function") throw new Error(`Headless runtime is missing ${method}().`);
    }
    runtime.startSession?.({ id: sessionId, environmentId: profile.environmentId });
    const allowActions = new Set(profile.allowActions ?? []);
    allowedCapabilities = runtime.listCapabilities()
      .filter((entry) => allowActions.has(entry.id))
      .map((entry) => ({
        allowlisted: true,
        id: entry.id,
        inputSchema: profile.actionSchemas?.[entry.id] ?? null,
        title: entry.description || entry.id,
        safety: {
          destructive: profile.actionPolicy?.[entry.id]?.destructive === true,
          mutatesWorld: profile.actionPolicy?.[entry.id]?.mutatesWorld !== false,
          readOnly: profile.actionPolicy?.[entry.id]?.readOnly === true,
          replayable: profile.actionPolicy?.[entry.id]?.replayable === true,
          rollback: profile.actionPolicy?.[entry.id]?.rollback ?? "snapshot",
        },
      }));
    allowedCapabilities.unshift({
      allowlisted: true,
      id: "world.observe",
      safety: { destructive: false, mutatesWorld: false, readOnly: true, replayable: true, rollback: "snapshot" },
    });
    state.capabilities = clone(allowedCapabilities);
    state.runtimeLoaded = true;
    state.logs.push(`loaded headless runtime with ${allowedCapabilities.length} capabilities`);
  }

  async function post(event) {
    state.events.push(clone(event));
    const args = event.args ?? {};
    switch (event.command) {
      case "loadHeadlessRuntime":
        await loadRuntime(args);
        return;
      case "worldManifest":
        if (!runtime) throw new Error("Headless runtime is not loaded.");
        return { actions: clone(allowedCapabilities), version: "1" };
      case "worldInvoke": {
        if (!runtime) throw new Error("Headless runtime is not loaded.");
        const script = await runtime.runScript({
          id: args.id,
          steps: [{ action: args.action, args: args.args ?? {}, id: args.id, metadata: args.metadata ?? {} }],
        }, {
          signal: args.signal,
          source: "nexus-simulator",
          stopOnFailure: args.stopOnFailure !== false,
        });
        const result = script.results?.[0];
        if (!result?.ok) {
          const error = new Error(result?.errors?.[0]?.message ?? `Headless command failed: ${args.action}`);
          error.code = result?.errors?.[0]?.code ?? "HEADLESS_COMMAND_FAILED";
          throw error;
        }
        return { artifacts: result.artifacts ?? [], data: result.data ?? null, observations: result.observations ?? [], ok: true };
      }
      case "worldObserve":
        if (!runtime) throw new Error("Headless runtime is not loaded.");
        return clone(runtime.getState?.() ?? runtime.snapshot());
      case "worldSnapshot":
        if (!runtime) throw new Error("Headless runtime is not loaded.");
        return clone(runtime.snapshot());
      case "worldRestore":
        if (!runtime) throw new Error("Headless runtime is not loaded.");
        return clone(runtime.loadSnapshot(clone(args.snapshot)));
      case "worldCancel":
        return typeof runtime?.cancel === "function" ? Boolean(await runtime.cancel()) : false;
      case "stopRuntime":
        runtime?.endSession?.(sessionId);
        runtime = null;
        state.runtimeLoaded = false;
        return;
      default:
        throw new Error(`nexus-headless-simtime does not know how to post command "${event.command}".`);
    }
  }

  async function reset() {
    runtime?.endSession?.(sessionId);
    runtime = null;
    allowedCapabilities = [];
    resetState();
  }

  function getState() {
    return clone(state);
  }

  function getOutput() {
    return clone({ ...state, simtime: id });
  }

  resetState();
  return {
    dispose: reset,
    getOutput,
    getState,
    id,
    label: "nexus-headless-simtime",
    post,
    reset,
    supports: nexusHeadlessSupports,
    surface,
    type,
  };
}
