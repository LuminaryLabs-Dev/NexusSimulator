import { createFileAdapter } from "./file-simtime.js";
import { createHumanInteractionAdapter } from "./human-interaction-simtime.js";
import { createNexusEngineRuntimeAdapter } from "./nexusengine-runtime-simtime.js";
import { createNexusRealtimeAdapter } from "./nexusrealtime-simtime.js";
import { createPlaywrightAdapter } from "./playwright-simtime.js";
import { createARAdapter } from "./ar-simtime.js";
import { createNexusHeadlessAdapter } from "./nexus-headless-simtime.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatStateSummary(state) {
  const objectCount = Object.keys(state.objects).length;
  const camera = state.camera ? JSON.stringify(state.camera) : "null";
  return [
    `time=${state.time}ms`,
    `objects=${objectCount}`,
    `camera=${camera}`,
  ].join(" ");
}

const commonSupports = ["spawnObject", "moveObject", "wait", "setCamera", "log", "validate"];
const webAppSupports = [
  "loadApp",
  "startServer",
  "openPage",
  "wait",
  "click",
  "type",
  "pressKey",
  "moveMouse",
  "waitForSelector",
  "assertText",
  "assertCanvasExists",
  "assertCanvasChanged",
  "assertFrameRendered",
  "assertNoConsoleErrors",
  "captureScreenshot",
  "getConsoleLogs",
  "stopServer",
];

function createEventAdapter({ id, label, outputLabel, surface, type }) {
  const supports = commonSupports;
  let state;

  function reset() {
    state = {
      camera: null,
      events: [],
      logs: [],
      objects: {},
      time: 0,
    };
  }

  function log(message) {
    state.logs.push(message);
  }

  function requireObject(objectId, command) {
    const object = state.objects[objectId];
    if (!object) {
      throw new Error(`${label} cannot run "${command}" because object "${objectId}" does not exist.`);
    }
    return object;
  }

  function post(event) {
    state.events.push(clone(event));

    switch (event.command) {
      case "spawnObject": {
        const id = event.args?.id;
        if (!id) throw new Error(`${label} requires args.id for spawnObject.`);
        state.objects[id] = {
          id,
          ...clone(event.args),
        };
        log(`spawned ${id}`);
        return;
      }
      case "moveObject": {
        const id = event.args?.id;
        if (!id) throw new Error(`${label} requires args.id for moveObject.`);
        const object = requireObject(id, "moveObject");
        if (event.args.position) {
          object.position = clone(event.args.position);
        }
        log(`moved ${id}`);
        return;
      }
      case "wait": {
        const ms = Number(event.args?.ms ?? 0);
        state.time += Number.isFinite(ms) ? ms : 0;
        log(`waited ${ms}ms`);
        return;
      }
      case "setCamera": {
        state.camera = clone(event.args ?? {});
        log("set camera");
        return;
      }
      case "log": {
        const message = event.args?.message ?? event.args?.text ?? JSON.stringify(event.args ?? {});
        log(String(message));
        return;
      }
      case "validate": {
        const objectId = event.args?.objectId;
        if (objectId) {
          requireObject(objectId, "validate");
          log(`validated ${objectId}`);
          return;
        }
        log(`validated ${JSON.stringify(event.args ?? {})}`);
        return;
      }
      default:
        throw new Error(`${label} does not know how to post command "${event.command}".`);
    }
  }

  function getState() {
    return clone(state);
  }

  function getOutput() {
    return [
      `${outputLabel} output`,
      `- ${formatStateSummary(state)}`,
      "- logs:",
      ...state.logs.map((entry) => `  - ${entry}`),
    ].join("\n");
  }

  reset();

  return {
    id,
    type,
    surface,
    label,
    supports,
    post,
    getOutput,
    getState,
    reset,
  };
}

function createWebAppAdapter(context = {}) {
  const id = "web-app";
  const type = "app";
  const surface = "deterministic-web";
  const supports = webAppSupports;
  let state;

  function reset() {
    const app = context.env?.app ?? {};
    state = {
      appPath: app.attachedAppPath ?? null,
      artifactDir: app.artifactDir ?? (context.env?.name ? `.nexus-simulator/artifacts/${context.env.name}` : ".nexus-simulator/artifacts/web-app"),
      artifacts: [],
      attachedAppPath: app.attachedAppPath ?? null,
      checks: [],
      consoleErrors: [],
      detectedMode: app.detectedMode ?? "unknown",
      events: [],
      launchMode: app.launchMode ?? "unknown",
      logs: [],
      pageOpened: false,
      serverStarted: false,
      status: "passed",
      time: 0,
    };
  }

  function log(message) {
    state.logs.push(message);
  }

  function check(name, passed, detail = "") {
    state.checks.push({ name, passed, detail });
    if (!passed) state.status = "failed";
  }

  function configureApp(args = {}) {
    state.appPath = args.path ?? state.appPath;
    state.attachedAppPath = args.attachedAppPath ?? args.path ?? state.attachedAppPath;
    state.detectedMode = args.detectedMode ?? args.appKind ?? state.detectedMode;
    state.launchMode = args.launchMode ?? state.launchMode;
    state.artifactDir = args.artifactDir ?? state.artifactDir ?? ".nexus-simulator/artifacts/web-app";
  }

  function post(event) {
    state.events.push(clone(event));
    const args = event.args ?? {};

    switch (event.command) {
      case "loadApp":
        configureApp(args);
        log(`loaded app ${state.attachedAppPath ?? "unknown"}`);
        check("appLoaded", Boolean(state.attachedAppPath), "app metadata available");
        return;
      case "startServer":
        state.serverStarted = true;
        log(`server start planned for ${state.launchMode}`);
        check("serverStarted", true, "deterministic scaffold");
        return;
      case "openPage":
        state.pageOpened = true;
        log(`opened ${args.url ?? "attached app page"}`);
        check("pageOpened", true, "deterministic scaffold");
        return;
      case "wait": {
        const ms = Number(args.ms ?? 0);
        state.time += Number.isFinite(ms) ? ms : 0;
        log(`waited ${ms}ms`);
        return;
      }
      case "click":
      case "type":
      case "pressKey":
      case "moveMouse":
      case "waitForSelector":
      case "assertText":
        log(`${event.command} ${JSON.stringify(args)}`);
        check(event.command, true, "deterministic scaffold");
        return;
      case "assertCanvasExists":
        check("canvasExists", ["canvas", "threejs", "aframe"].includes(state.detectedMode), state.detectedMode);
        log("checked canvas exists");
        return;
      case "assertCanvasChanged":
        check("canvasChanged", ["canvas", "threejs", "aframe"].includes(state.detectedMode), `sampleMs=${args.sampleMs ?? 0}`);
        log("checked canvas changed");
        return;
      case "assertFrameRendered":
        check("frameRendered", true, "deterministic scaffold");
        log("checked frame rendered");
        return;
      case "assertNoConsoleErrors":
        check("consoleClean", state.consoleErrors.length === 0, `${state.consoleErrors.length} console errors`);
        log("checked console errors");
        return;
      case "captureScreenshot": {
        const name = args.name ?? "screenshot.png";
        const artifactDir = state.artifactDir ?? ".nexus-simulator/artifacts/web-app";
        const artifactPath = `${artifactDir}/${name}`;
        state.artifacts.push(artifactPath);
        check("screenshotCaptured", true, artifactPath);
        log(`captured screenshot artifact ${artifactPath}`);
        return;
      }
      case "getConsoleLogs":
        check("consoleLogsRead", true, `${state.consoleErrors.length} errors`);
        log("read console logs");
        return;
      case "stopServer":
        state.serverStarted = false;
        check("serverStopped", true, "deterministic scaffold");
        log("server stopped");
        return;
      default:
        throw new Error(`web-app-simtime does not know how to post command "${event.command}".`);
    }
  }

  function getState() {
    return clone(state);
  }

  function getOutput() {
    return clone({
      artifactDir: state.artifactDir,
      artifacts: state.artifacts,
      attachedAppPath: state.attachedAppPath,
      checks: state.checks,
      consoleErrors: state.consoleErrors,
      detectedMode: state.detectedMode,
      launchMode: state.launchMode,
      logs: state.logs,
      simtime: id,
      status: state.status,
    });
  }

  reset();

  return {
    id,
    type,
    surface,
    label: "web-app-simtime",
    supports,
    post,
    getOutput,
    getState,
    reset,
  };
}

export const simtimeFactories = {
  headless: () =>
    createEventAdapter({
      id: "headless",
      type: "headless",
      surface: "state-machine",
      label: "headless-simtime",
      outputLabel: "Headless",
    }),
  terminal: () =>
    createEventAdapter({
      id: "terminal",
      type: "terminal",
      surface: "text-terminal",
      label: "terminal-simtime",
      outputLabel: "Terminal",
    }),
  threejs: () =>
    createEventAdapter({
      id: "threejs",
      type: "world",
      surface: "world-scene",
      label: "threejs-simtime",
      outputLabel: "Three.js",
    }),
  file: () => createFileAdapter(),
  "human-interaction": () => createHumanInteractionAdapter(),
  "ar-simtime": (context) => createARAdapter(context),
  "nexusengine-runtime": (context) => createNexusEngineRuntimeAdapter(context),
  "nexus-headless": (context) => createNexusHeadlessAdapter(context),
  nexusrealtime: (context) => createNexusRealtimeAdapter(context),
  "web-app": (context) => createWebAppAdapter(context),
  playwright: (context) => createPlaywrightAdapter(context),
};

export function createSimtime(id, context = {}) {
  const factory = simtimeFactories[id];
  if (!factory) {
    const known = Object.keys(simtimeFactories).join(", ");
    throw new Error(`Unknown simtime "${id}". Known simtimes: ${known}.`);
  }
  return factory(context);
}

export function listSimtimes() {
  return Object.keys(simtimeFactories);
}

export function inspectSimtime(id) {
  const simtime = createSimtime(id);
  return {
    id: simtime.id,
    type: simtime.type,
    surface: simtime.surface,
    supports: [...simtime.supports],
  };
}

export function listSimtimeManifests() {
  return listSimtimes().map((id) => inspectSimtime(id));
}
