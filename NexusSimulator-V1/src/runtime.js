import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { detectApp } from "./app-detection.js";
import { createSimtime, inspectSimtime, listSimtimeManifests } from "./simtimes.js";

const rootDir = resolve(process.cwd(), ".nexus-simulator");
const envDir = join(rootDir, "envs");
const scenarioDir = join(rootDir, "scenarios");

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function encodeName(name) {
  return encodeURIComponent(name);
}

function decodeName(name) {
  return decodeURIComponent(name);
}

function envFilePath(name) {
  return join(envDir, `${encodeName(name)}.json`);
}

function scenarioFilePath(envName, scenarioName) {
  return join(scenarioDir, encodeName(envName), `${encodeName(scenarioName)}.jsonl`);
}

function artifactDirPath(envName) {
  return join(rootDir, "artifacts", encodeName(envName));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function loadEnvRecord(name) {
  const path = envFilePath(name);
  if (!existsSync(path)) {
    throw new Error(`Unknown environment: ${name}`);
  }
  const env = readJson(path);
  if (env.name !== name) {
    throw new Error(`Environment file mismatch for ${name}.`);
  }
  return env;
}

function listEnvFiles() {
  if (!existsSync(envDir)) return [];
  return readdirSync(envDir).filter((file) => file.endsWith(".json"));
}

function listScenarioFiles(envName) {
  const dir = join(scenarioDir, encodeName(envName));
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((file) => file.endsWith(".jsonl"));
}

function readScenarioEvents(envName, scenarioName) {
  const path = scenarioFilePath(envName, scenarioName);
  if (!existsSync(path)) {
    throw new Error(`Unknown scenario "${scenarioName}" for environment "${envName}".`);
  }
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];
  return text
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON event in ${scenarioName} at line ${index + 1}: ${error.message}`);
      }
    });
}

export function loadScenarioEvents(envName, scenarioName) {
  return readScenarioEvents(envName, scenarioName);
}

export function ensureEventShape(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("Event must be an object.");
  }
  if (typeof event.command !== "string" || !event.command.trim()) {
    throw new Error("Event.command must be a non-empty string.");
  }
  if (event.args !== undefined && (typeof event.args !== "object" || Array.isArray(event.args) || event.args === null)) {
    throw new Error("Event.args must be an object when provided.");
  }
  return {
    command: event.command,
    args: event.args ?? {},
  };
}

function loadScenarioContext(envName, scenarioName, simtimeOverride) {
  const env = loadEnvRecord(envName);
  const simtimeId = simtimeOverride ?? env.simtime ?? "headless";
  const adapter = createSimtime(simtimeId, { env });
  const events = readScenarioEvents(envName, scenarioName);
  return { adapter, env, events };
}

export async function executeScenario(adapter, env, events) {
  for (const event of events) {
    if (!adapter.supports.includes(event.command)) {
      throw new Error(`Simtime "${adapter.id}" does not support command "${event.command}". Supported commands: ${adapter.supports.join(", ")}.`);
    }
  }

  await adapter.reset();

  try {
    for (const event of events) {
      await adapter.post(event);
    }
  } catch (error) {
    if (adapter.dispose) await adapter.dispose();
    throw error;
  }

  return {
    adapter,
    env,
    events,
    output: adapter.getOutput(),
    state: adapter.getState(),
  };
}

export async function executeScenarioChunked(adapter, env, events, options = {}) {
  for (const event of events) {
    if (!adapter.supports.includes(event.command)) {
      throw new Error(`Simtime "${adapter.id}" does not support command "${event.command}". Supported commands: ${adapter.supports.join(", ")}.`);
    }
  }

  const chunkSize = Math.max(1, Number(options.chunkSize ?? 5));
  let nextEventIndex = Math.max(0, Number(options.startIndex ?? 0));
  const checkpoints = [];

  if (options.reset !== false) {
    await adapter.reset();
  }

  try {
    while (nextEventIndex < events.length) {
      const eventStart = nextEventIndex;
      const eventEnd = Math.min(events.length, eventStart + chunkSize) - 1;
      let failure = null;

      for (; nextEventIndex <= eventEnd; nextEventIndex += 1) {
        try {
          await adapter.post(events[nextEventIndex]);
        } catch (error) {
          failure = error;
          break;
        }
      }

      const complete = nextEventIndex >= events.length;
      const checkpointPayload = {
        adapter,
        commands: events.slice(eventStart, eventEnd + 1),
        env,
        error: failure ? failure.message : null,
        eventEnd,
        eventStart,
        nextEventIndex,
        status: failure ? "failed" : complete ? "passed" : "waiting_for_agent",
      };
      const checkpoint = options.writeCheckpoint
        ? await options.writeCheckpoint(checkpointPayload)
        : checkpointPayload;
      checkpoints.push(checkpoint);

      if (failure) {
        throw failure;
      }

      if (complete) {
        break;
      }

      if (options.stopAfterCheckpoint) {
        return {
          adapter,
          checkpoints,
          complete: false,
          env,
          events,
          nextEventIndex,
          output: adapter.getOutput(),
          state: adapter.getState(),
          stoppedReason: "stop_after_checkpoint",
        };
      }

      const decision = options.readAgentDecision
        ? await options.readAgentDecision(checkpoint)
        : null;
      const action = decision?.decision ?? null;

      if (!action) {
        return {
          adapter,
          checkpoints,
          complete: false,
          env,
          events,
          nextEventIndex,
          output: adapter.getOutput(),
          state: adapter.getState(),
          stoppedReason: "waiting_for_agent",
        };
      }

      if (action === "continue") {
        continue;
      }

      if (["revise", "rerun", "stop"].includes(action)) {
        return {
          adapter,
          checkpoints,
          complete: false,
          env,
          events,
          nextEventIndex,
          output: adapter.getOutput(),
          state: adapter.getState(),
          stoppedReason: action,
        };
      }

      throw new Error(`Unsupported agent checkpoint decision "${action}". Expected continue, revise, rerun, or stop.`);
    }
  } catch (error) {
    if (adapter.dispose) await adapter.dispose();
    throw error;
  }

  return {
    adapter,
    checkpoints,
    complete: true,
    env,
    events,
    nextEventIndex,
    output: adapter.getOutput(),
    state: adapter.getState(),
    stoppedReason: null,
  };
}

export function createEnvironment(name, simtime = "headless") {
  if (existsSync(envFilePath(name))) {
    throw new Error(`Environment already exists: ${name}`);
  }
  const env = {
    createdAt: new Date().toISOString(),
    name,
    simtime,
  };
  writeJson(envFilePath(name), env);
  return env;
}

export function listEnvironments() {
  return listEnvFiles().map((file) => readJson(join(envDir, file)));
}

export function listSimtimes() {
  return listSimtimeManifests();
}

export function getSimtimeManifest(id) {
  return inspectSimtime(id);
}

export function detectAppPath(targetPath) {
  return detectApp(targetPath);
}

export function attachApp(envName, targetPath) {
  const env = loadEnvRecord(envName);
  const detection = detectApp(targetPath);
  env.app = {
    appKind: detection.appKind,
    attachedAppPath: detection.targetPath,
    attachedAt: new Date().toISOString(),
    artifactDir: artifactDirPath(envName),
    confidence: detection.confidence,
    detectedMode: detection.detectedMode,
    launchMode: detection.launchMode,
    notes: detection.notes,
    selectedSimtime: detection.suggestedSimtime,
  };
  env.simtime = detection.suggestedSimtime;
  writeJson(envFilePath(envName), env);
  return env.app;
}

export function createScenario(envName, scenarioName) {
  loadEnvRecord(envName);
  const path = scenarioFilePath(envName, scenarioName);
  if (existsSync(path)) {
    return path;
  }
  ensureDir(dirname(path));
  writeFileSync(path, "");
  return path;
}

export function scenarioExists(envName, scenarioName) {
  loadEnvRecord(envName);
  return existsSync(scenarioFilePath(envName, scenarioName));
}

function writeScenarioEvents(envName, scenarioName, events) {
  loadEnvRecord(envName);
  const path = scenarioFilePath(envName, scenarioName);
  ensureDir(dirname(path));
  const normalized = events.map(ensureEventShape);
  writeFileSync(path, normalized.map((event) => JSON.stringify(event)).join("\n") + "\n");
  return normalized;
}

export function appendScenarioEvent(envName, scenarioName, event) {
  loadEnvRecord(envName);
  const path = scenarioFilePath(envName, scenarioName);
  ensureDir(dirname(path));
  const normalized = ensureEventShape(event);
  writeFileSync(path, `${JSON.stringify(normalized)}\n`, { flag: "a" });
  return normalized;
}

export function listScenarios(envName) {
  loadEnvRecord(envName);
  return listScenarioFiles(envName).map((file) => decodeName(file.replace(/\.jsonl$/, "")));
}

export function showScenario(envName, scenarioName) {
  return readScenarioEvents(envName, scenarioName);
}

function smokeEventsForApp(app) {
  const events = [
    { command: "startServer", args: {} },
    { command: "openPage", args: {} },
    { command: "wait", args: { ms: 1000 } },
  ];

  if (["canvas", "threejs", "aframe"].includes(app.detectedMode)) {
    events.push(
      { command: "assertCanvasExists", args: {} },
      { command: "assertCanvasChanged", args: { sampleMs: 1000 } },
    );
  }

  events.push(
    { command: "assertNoConsoleErrors", args: {} },
    { command: "captureScreenshot", args: { name: "smoke.png" } },
    { command: "stopServer", args: {} },
  );

  return events;
}

export function createSmokeScenario(envName, options = {}) {
  const env = loadEnvRecord(envName);
  if (!env.app) {
    throw new Error(`Environment "${envName}" has no attached app. Run app attach first.`);
  }
  const scenarioName = options.name ?? "smoke";
  const exists = existsSync(scenarioFilePath(envName, scenarioName));
  if (exists && !options.replace) {
    return {
      created: false,
      events: readScenarioEvents(envName, scenarioName),
      path: scenarioFilePath(envName, scenarioName),
      scenarioName,
      skipped: true,
    };
  }
  const events = writeScenarioEvents(envName, scenarioName, smokeEventsForApp(env.app));
  return {
    created: true,
    events,
    path: scenarioFilePath(envName, scenarioName),
    replaced: exists && options.replace,
    scenarioName,
    skipped: false,
  };
}

export function checkScenario(envName, scenarioName, simtimeOverride) {
  const { adapter, env, events } = loadScenarioContext(envName, scenarioName, simtimeOverride);
  const results = events.map((event, index) => {
    const supported = adapter.supports.includes(event.command);
    return {
      command: event.command,
      index,
      supported,
    };
  });
  return {
    adapter,
    env,
    events,
    results,
    supported: results.every((result) => result.supported),
  };
}

export async function runScenario(envName, scenarioName, simtimeOverride) {
  const { adapter, env, events } = loadScenarioContext(envName, scenarioName, simtimeOverride);
  return executeScenario(adapter, env, events);
}
