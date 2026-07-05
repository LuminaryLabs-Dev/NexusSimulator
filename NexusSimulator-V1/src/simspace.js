import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, basename } from "node:path";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { createSimtime } from "./simtimes.js";
import { ensureEventShape, executeScenario, executeScenarioChunked, loadEnvRecord, loadScenarioEvents } from "./runtime.js";

const rootDir = resolve(process.cwd(), ".simspaces");
const runsDir = join(rootDir, "runs");

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function slug(value) {
  return String(value ?? "run")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "run";
}

function createRunId(envName, scenarioName, simtimeId) {
  return [
    Date.now(),
    slug(envName),
    slug(scenarioName),
    slug(simtimeId),
    randomUUID().slice(0, 8),
  ].join("-");
}

function allocatePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = net.createServer();
    server.unref();
    server.on("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (!port) {
          rejectPort(new Error("Could not allocate a port for SimSpace."));
          return;
        }
        resolvePort(port);
      });
    });
  });
}

function isLocalUrl(value) {
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}

function rewriteLocalUrl(value, port) {
  try {
    const url = new URL(value);
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return value;
    url.port = String(port);
    return url.toString();
  } catch {
    return value;
  }
}

function rewriteAbsolutePath(value, sourceRoot, stagedRoot, stagedAppPath, sourceIsFile) {
  if (typeof value !== "string" || !value) return value;
  const absolute = resolve(value);
  if (sourceIsFile) {
    return absolute === sourceRoot ? stagedAppPath : value;
  }
  if (absolute === sourceRoot) return stagedRoot;
  if (absolute.startsWith(`${sourceRoot}/`)) {
    return join(stagedRoot, relative(sourceRoot, absolute));
  }
  return value;
}

function rewriteCommandValue(value, sourceRoot, stagedRoot, stagedAppPath, sourceIsFile) {
  if (Array.isArray(value)) {
    return value.map((part) => rewriteCommandValue(part, sourceRoot, stagedRoot, stagedAppPath, sourceIsFile));
  }
  if (typeof value === "string") {
    return rewriteAbsolutePath(value, sourceRoot, stagedRoot, stagedAppPath, sourceIsFile);
  }
  return value;
}

function pathCandidatesFromEvents(env, events) {
  const candidates = [];
  if (env.app?.attachedAppPath && existsSync(env.app.attachedAppPath)) {
    candidates.push(resolve(env.app.attachedAppPath));
  }

  for (const event of events) {
    const args = event?.args ?? {};
    for (const key of ["cwd", "path", "attachedAppPath"]) {
      const value = args[key];
      if (typeof value === "string" && value && value.startsWith("/")) {
        candidates.push(resolve(value));
      }
    }
  }

  return [...new Set(candidates)];
}

function normalizeSourcePath(candidate) {
  const absolute = resolve(candidate);
  if (!existsSync(absolute)) return absolute;
  return statSync(absolute).isFile() ? dirname(absolute) : absolute;
}

function commonAncestor(paths) {
  if (!paths.length) return null;
  let base = normalizeSourcePath(paths[0]);

  for (const candidate of paths.slice(1)) {
    let current = normalizeSourcePath(candidate);
    while (true) {
      if (current === base) break;
      const withinBase = relative(base, current);
      if (withinBase && !withinBase.startsWith("..") && !withinBase.includes(":/")) break;

      const withinCurrent = relative(current, base);
      if (withinCurrent && !withinCurrent.startsWith("..") && !withinCurrent.includes(":/")) {
        base = current;
        break;
      }

      const nextBase = dirname(base);
      if (nextBase === base) break;
      base = nextBase;
    }
  }

  return base;
}

function rewriteEvent(event, context) {
  const normalized = ensureEventShape(event);
  const args = JSON.parse(JSON.stringify(normalized.args ?? {}));
  const { allocatedPort, sourceIsFile, sourceRoot, stagedAppPath, stagedRoot } = context;

  if (normalized.command === "startServer") {
    if (args.cwd) args.cwd = rewriteAbsolutePath(args.cwd, sourceRoot, stagedRoot, stagedAppPath, sourceIsFile);
    if (args.command !== undefined) {
      args.command = rewriteCommandValue(args.command, sourceRoot, stagedRoot, stagedAppPath, sourceIsFile);
    }
    args.port = allocatedPort;
    args.env = {
      ...(args.env ?? {}),
      PORT: String(allocatedPort),
    };
    if (args.url && isLocalUrl(args.url)) args.url = rewriteLocalUrl(args.url, allocatedPort);
    if (args.waitUrl && isLocalUrl(args.waitUrl)) args.waitUrl = rewriteLocalUrl(args.waitUrl, allocatedPort);
    return { command: normalized.command, args };
  }

  for (const key of ["cwd", "path", "attachedAppPath", "root"]) {
    if (args[key]) {
      args[key] = rewriteAbsolutePath(args[key], sourceRoot, stagedRoot, stagedAppPath, sourceIsFile);
    }
  }
  if (typeof args.url === "string" && isLocalUrl(args.url)) {
    args.url = rewriteLocalUrl(args.url, allocatedPort);
  }
  return { command: normalized.command, args };
}

function determineSourceRoot(env, events) {
  const candidates = pathCandidatesFromEvents(env, events);
  const sourceRoot = commonAncestor(candidates);
  if (sourceRoot) return sourceRoot;
  throw new Error(`SimSpace cannot determine a source app root for "${env.name}". Attach an app first or provide a scenario with a startServer cwd.`);
}

function stageSourceTree(sourceRoot, runAppDir, attachedAppPath) {
  const sourceStats = statSync(sourceRoot);
  ensureDir(runAppDir);

  if (sourceStats.isFile()) {
    const stagedAppPath = join(runAppDir, basename(sourceRoot));
    cpSync(sourceRoot, stagedAppPath, { force: true });
    return {
      sourceIsFile: true,
      stagedAppPath,
      stagedRoot: runAppDir,
    };
  }

  cpSync(sourceRoot, runAppDir, {
    dereference: false,
    force: true,
    preserveTimestamps: true,
    recursive: true,
    filter: (src) => {
      const rel = relative(sourceRoot, src);
      if (!rel) return true;
      const topLevel = rel.split(/[\\/]/)[0];
      if ([".git", ".nexus-simulator", ".simspaces"].includes(topLevel)) return false;
      const stats = lstatSync(src);
      return stats.isDirectory() || stats.isFile() || stats.isSymbolicLink();
    },
  });

  let stagedAppPath = runAppDir;
  if (attachedAppPath) {
    const rel = relative(sourceRoot, resolve(attachedAppPath));
    if (rel && !rel.startsWith("..")) {
      stagedAppPath = join(runAppDir, rel);
    }
  }

  return {
    sourceIsFile: false,
    stagedAppPath,
    stagedRoot: runAppDir,
  };
}

function writeRunArtifacts(runDir, payload) {
  ensureDir(join(runDir, "artifacts"));
  ensureDir(join(runDir, "screenshots"));
  ensureDir(join(runDir, "logs"));
  ensureDir(join(runDir, "output"));
  ensureDir(join(runDir, "temp"));
  writeJson(join(runDir, "manifest.json"), payload.manifest);
  writeJson(join(runDir, "ports.json"), payload.ports);
  writeJson(join(runDir, "processes.json"), payload.processes);
  writeFileSync(join(runDir, "logs", "scenario-events.jsonl"), `${payload.events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

function readScenarioEventsFromRun(runDir) {
  const path = join(runDir, "logs", "scenario-events.jsonl");
  const text = readFileSync(path, "utf8").trim();
  if (!text) return [];
  return text.split("\n").filter(Boolean).map((line) => ensureEventShape(JSON.parse(line)));
}

function latestCheckpoint(runDir) {
  const checkpointsDir = join(runDir, "checkpoints");
  if (!existsSync(checkpointsDir)) return null;
  const names = readdirSync(checkpointsDir)
    .filter((name) => /^chunk-\d+$/.test(name))
    .sort();
  if (!names.length) return null;
  const checkpointDir = join(checkpointsDir, names[names.length - 1]);
  const checkpointPath = join(checkpointDir, "checkpoint.json");
  if (!existsSync(checkpointPath)) return null;
  return readJson(checkpointPath);
}

function readAgentDecision(checkpoint) {
  const decisionPath = join(checkpoint.checkpoint_dir, "agent-decision.json");
  if (!existsSync(decisionPath)) return null;
  const decision = readJson(decisionPath);
  return {
    decision: decision.decision,
    reason: decision.reason ?? "",
  };
}

async function writeCheckpointArtifact(runDir, runId, payload) {
  const chunkIndex = payload.chunkIndex;
  const checkpointDir = join(runDir, "checkpoints", `chunk-${String(chunkIndex).padStart(3, "0")}`);
  ensureDir(checkpointDir);

  if (payload.adapter.captureCheckpointArtifacts) {
    await payload.adapter.captureCheckpointArtifacts(checkpointDir);
  }

  const state = payload.adapter.getState?.() ?? {};
  const output = payload.adapter.getOutput?.() ?? {};
  const checkpoint = {
    run_id: runId,
    checkpoint_dir: checkpointDir,
    chunk_index: chunkIndex,
    event_start: payload.eventStart,
    event_end: payload.eventEnd,
    commands: payload.commands.map((event) => event.command),
    status: payload.status,
    agent_decision: null,
    recommended_next_command: payload.nextEventIndex,
    goal_progress: {
      checks: state.checks?.length ?? output.checks?.length ?? 0,
      console_errors: state.consoleErrors?.length ?? output.consoleErrors?.length ?? 0,
      page_opened: state.pageOpened ?? output.pageOpened ?? false,
      artifacts: state.artifacts ?? output.artifacts ?? [],
    },
    blocking_findings: payload.error ? [payload.error] : [],
  };

  writeJson(join(checkpointDir, "state.json"), state);
  writeJson(join(checkpointDir, "output.json"), output);
  if (!existsSync(join(checkpointDir, "console.json"))) {
    writeJson(join(checkpointDir, "console.json"), {
      errors: state.consoleErrors ?? output.consoleErrors ?? [],
      logs: state.consoleLogs ?? output.consoleLogs ?? [],
    });
  }
  writeJson(join(checkpointDir, "checkpoint.json"), checkpoint);
  return checkpoint;
}

export async function runEventsInSimSpace(env, events, options = {}) {
  const normalizedEvents = events.map(ensureEventShape);
  const envName = options.envName ?? env.name ?? "target";
  const scenarioName = options.scenarioName ?? "generated";
  const simtimeId = options.simtimeId ?? env.simtime ?? "headless";
  const sourceRoot = determineSourceRoot(env, normalizedEvents);
  const runId = createRunId(envName, scenarioName, simtimeId);
  const runDir = join(runsDir, runId);
  ensureDir(runDir);

  const allocatedPort = await allocatePort();
  const { sourceIsFile, stagedAppPath, stagedRoot } = stageSourceTree(
    sourceRoot,
    join(runDir, "app"),
    env.app?.attachedAppPath,
  );

  const derivedEnv = JSON.parse(JSON.stringify(env));
  derivedEnv.app = {
    ...(derivedEnv.app ?? {}),
    attachedAppPath: stagedAppPath,
    artifactDir: join(runDir, "artifacts"),
    simspace: {
      runDir,
      runId,
      sourceRoot,
      stagedAppPath,
      stagedRoot,
    },
  };

  const transformedEvents = normalizedEvents.map((event) =>
    rewriteEvent(event, {
      allocatedPort,
      sourceIsFile,
      sourceRoot,
      stagedAppPath,
      stagedRoot,
    }),
  );

  const adapter = createSimtime(simtimeId, { env: derivedEnv });
  const manifest = {
    allocatedPort,
    envName,
    runId,
    scenarioName,
    simtimeId,
    ...(options.manifest ?? {}),
    cleanupPolicy: "archive",
    createdAt: new Date().toISOString(),
    runDir,
    sourceRoot,
    stagedAppPath,
    stagedRoot,
  };

  writeRunArtifacts(runDir, {
    events: transformedEvents,
    manifest,
    ports: {
      allocatedPort,
      baseUrl: `http://127.0.0.1:${allocatedPort}/`,
    },
    processes: [],
  });

  let result = null;
  let failure = null;

  try {
    result = await executeScenario(adapter, derivedEnv, transformedEvents);
  } catch (error) {
    failure = error;
  } finally {
    if (adapter.dispose) {
      await adapter.dispose().catch(() => {});
    }
  }

  const state = result?.state ?? adapter.getState?.() ?? {};
  const output = result?.output ?? adapter.getOutput?.() ?? {};
  const processes = state.processes ?? output.processes ?? [];
  const status = failure ? "failed" : output.status ?? state.status ?? "passed";
  const report = {
    ...manifest,
    completedAt: new Date().toISOString(),
    durationMs: result?.state?.durationMs ?? output.durationMs ?? 0,
    error: failure ? failure.message : null,
    events: transformedEvents.length,
    output,
    processes,
    state,
    status,
  };

  writeJson(join(runDir, "report.json"), report);
  writeJson(join(runDir, "processes.json"), processes);
  writeJson(join(runDir, "ports.json"), {
    allocatedPort,
    baseUrl: `http://127.0.0.1:${allocatedPort}/`,
  });

  if (failure && options.throwOnFailure !== false) {
    throw failure;
  }

  return {
    failure,
    report,
    runDir,
    manifest,
    output,
    state,
  };
}

export async function runScenarioInSimSpace(envName, scenarioName, simtimeOverride) {
  const env = loadEnvRecord(envName);
  const events = loadScenarioEvents(envName, scenarioName).map(ensureEventShape);
  const simtimeId = simtimeOverride ?? env.simtime ?? "headless";
  return runEventsInSimSpace(env, events, {
    envName,
    scenarioName,
    simtimeId,
    throwOnFailure: true,
  });
}

export async function runScenarioInSimSpaceChunked(envName, scenarioName, simtimeOverride, options = {}) {
  let env = null;
  let events = null;
  let simtimeId = null;
  let runId = options.resumeRunId ?? null;
  let runDir = runId ? join(runsDir, runId) : null;
  let manifest = null;
  let startIndex = 0;

  if (runId) {
    if (!existsSync(join(runDir, "manifest.json"))) {
      throw new Error(`Cannot resume unknown SimSpace run: ${runId}`);
    }
    manifest = readJson(join(runDir, "manifest.json"));
    env = loadEnvRecord(manifest.envName);
    events = readScenarioEventsFromRun(runDir);
    simtimeId = simtimeOverride ?? manifest.simtimeId ?? env.simtime ?? "headless";
    startIndex = latestCheckpoint(runDir)?.recommended_next_command ?? 0;
  } else {
    env = loadEnvRecord(envName);
    events = loadScenarioEvents(envName, scenarioName).map(ensureEventShape);
    simtimeId = simtimeOverride ?? env.simtime ?? "headless";
    const sourceRoot = determineSourceRoot(env, events);
    runId = createRunId(envName, scenarioName, simtimeId);
    runDir = join(runsDir, runId);
    ensureDir(runDir);

    const allocatedPort = await allocatePort();
    const { sourceIsFile, stagedAppPath, stagedRoot } = stageSourceTree(
      sourceRoot,
      join(runDir, "app"),
      env.app?.attachedAppPath,
    );

    const transformedEvents = events.map((event) =>
      rewriteEvent(event, {
        allocatedPort,
        sourceIsFile,
        sourceRoot,
        stagedAppPath,
        stagedRoot,
      }),
    );

    manifest = {
      allocatedPort,
      chunked: true,
      chunkSize: Math.max(1, Number(options.chunkSize ?? 5)),
      envName,
      runId,
      scenarioName,
      simtimeId,
      cleanupPolicy: "archive",
      createdAt: new Date().toISOString(),
      runDir,
      sourceRoot,
      stagedAppPath,
      stagedRoot,
    };

    writeRunArtifacts(runDir, {
      events: transformedEvents,
      manifest,
      ports: {
        allocatedPort,
        baseUrl: `http://127.0.0.1:${allocatedPort}/`,
      },
      processes: [],
    });
    events = transformedEvents;
  }

  const derivedEnv = JSON.parse(JSON.stringify(env));
  derivedEnv.app = {
    ...(derivedEnv.app ?? {}),
    attachedAppPath: manifest.stagedAppPath,
    artifactDir: join(runDir, "artifacts"),
    simspace: {
      runDir,
      runId,
      sourceRoot: manifest.sourceRoot,
      stagedAppPath: manifest.stagedAppPath,
      stagedRoot: manifest.stagedRoot,
    },
  };

  const adapter = createSimtime(simtimeId, { env: derivedEnv });
  const chunkState = {
    index: latestCheckpoint(runDir)?.chunk_index ?? 0,
  };

  let result = null;
  let failure = null;

  try {
    if (startIndex > 0) {
      await adapter.reset();
      for (const event of events.slice(0, startIndex)) {
        await adapter.post(event);
      }
    }
    result = await executeScenarioChunked(adapter, derivedEnv, events, {
      chunkSize: options.chunkSize,
      readAgentDecision,
      reset: startIndex === 0,
      startIndex,
      stopAfterCheckpoint: options.stopAfterCheckpoint,
      writeCheckpoint: (payload) => {
        chunkState.index += 1;
        return writeCheckpointArtifact(runDir, runId, {
          ...payload,
          chunkIndex: chunkState.index,
        });
      },
    });
  } catch (error) {
    failure = error;
  } finally {
    if (adapter.dispose) {
      await adapter.dispose().catch(() => {});
    }
  }

  const state = result?.state ?? adapter.getState?.() ?? {};
  const output = result?.output ?? adapter.getOutput?.() ?? {};
  const processes = state.processes ?? output.processes ?? [];
  const status = failure ? "failed" : result?.complete ? output.status ?? state.status ?? "passed" : result?.stoppedReason ?? "waiting_for_agent";
  const report = {
    ...manifest,
    chunked: true,
    checkpoints: result?.checkpoints ?? [],
    completedAt: new Date().toISOString(),
    durationMs: result?.state?.durationMs ?? output.durationMs ?? 0,
    error: failure ? failure.message : null,
    events: events.length,
    nextEventIndex: result?.nextEventIndex ?? startIndex,
    output,
    processes,
    state,
    status,
    stoppedReason: result?.stoppedReason ?? null,
  };

  writeJson(join(runDir, "report.json"), report);
  writeJson(join(runDir, "processes.json"), processes);
  writeJson(join(runDir, "ports.json"), {
    allocatedPort: manifest.allocatedPort,
    baseUrl: `http://127.0.0.1:${manifest.allocatedPort}/`,
  });

  if (failure) {
    throw failure;
  }

  return {
    report,
    runDir,
    manifest,
    output,
    state,
  };
}
