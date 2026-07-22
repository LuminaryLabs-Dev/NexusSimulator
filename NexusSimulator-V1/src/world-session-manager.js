import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { prepareWorldSimSpace, getSimSpaceRunsDir } from "./simspace.js";
import { WORLD_LIMITS, worldSessionCreateSchema } from "./world-contracts.js";
import { createWorldAdapter } from "./world-adapters.js";
import { loadExecutionProfile } from "./execution-profiles.js";
import { appendJsonLine, cloneJson, digestJson, readJson, withTimeout, writeJson } from "./world-utils.js";

function safeId(value, fallback) {
  const id = String(value ?? fallback).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return id || `world-${randomUUID().slice(0, 8)}`;
}

function isWithin(root, candidate) {
  const canonicalRoot = existsSync(root) ? realpathSync(root) : resolve(root);
  const canonicalCandidate = existsSync(candidate) ? realpathSync(candidate) : resolve(candidate);
  const rel = relative(canonicalRoot, canonicalCandidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function sessionView(session) {
  return {
    activeBatchId: session.activeBatchId ?? null,
    adapter: session.adapter,
    blockedReason: session.blockedReason ?? null,
    capabilities: session.capabilities ?? [],
    closedAt: session.closedAt ?? null,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt,
    reportUri: `nexus-sim://runs/${session.sessionId}/report`,
    revision: session.revision,
    sessionId: session.sessionId,
    stateDigest: session.stateDigest ?? null,
    status: session.status,
  };
}

function redactStrings(value, replacements) {
  if (typeof value === "string") {
    return replacements.reduce((text, [path, label]) => path ? text.split(path).join(label) : text, value);
  }
  if (Array.isArray(value)) return value.map((entry) => redactStrings(entry, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactStrings(entry, replacements)]));
  }
  return value;
}

export function createWorldSessionManager(options = {}) {
  const workspaceRoot = resolve(options.workspaceRoot ?? process.env.NEXUS_SIM_WORKSPACE_ROOT ?? process.cwd());
  const runsDir = getSimSpaceRunsDir(workspaceRoot);
  const allowedRoots = (options.allowedRoots ?? [workspaceRoot]).map((path) => resolve(path));
  const allowDestructive = options.allowDestructive === true;
  const keepAlive = options.keepAlive === true;
  const maxActiveSessions = options.maxActiveSessions ?? WORLD_LIMITS.maxActiveSessions;
  const idleLeaseMs = options.idleLeaseMs ?? WORLD_LIMITS.idleLeaseMs;
  const liveAdapters = new Map();
  const locks = new Map();
  const abortControllers = new Map();
  let idleTimer = null;

  function redactForEvidence(session, value) {
    const replacements = [
      [session.stagedAppPath, "<simspace-app>"],
      [session.stagedRoot, "<simspace-root>"],
      [session.runDir, "<simspace-run>"],
      [session.targetPath, "<source-target>"],
      [session.sourceRoot, "<source-root>"],
      [session.profilePath, "<execution-profile>"],
      [workspaceRoot, "<workspace-root>"],
    ].flatMap(([path, label]) => {
      if (!path) return [];
      const canonical = existsSync(path) ? realpathSync(path) : path;
      return canonical === path ? [[path, label]] : [[path, label], [canonical, label]];
    }).sort((left, right) => String(right[0] ?? "").length - String(left[0] ?? "").length);
    return redactStrings(cloneJson(value), replacements);
  }

  function assertAllowed(path, label) {
    const absolute = resolve(path);
    if (!allowedRoots.some((root) => isWithin(root, absolute))) {
      const error = new Error(`${label} is outside the configured workspace roots: ${absolute}`);
      error.code = "PATH_OUTSIDE_WORKSPACE";
      throw error;
    }
    return absolute;
  }

  function sessionDir(sessionId) {
    return join(runsDir, safeId(sessionId, "invalid"));
  }

  function sessionPath(sessionId) {
    return join(sessionDir(sessionId), "session.json");
  }

  function cancellationPath(session) {
    return join(session.runDir, "cancel-request.json");
  }

  function loadSession(sessionId) {
    const path = sessionPath(sessionId);
    if (!existsSync(path)) {
      const error = new Error(`Unknown world session "${sessionId}".`);
      error.code = "SESSION_NOT_FOUND";
      throw error;
    }
    return readJson(path);
  }

  function saveSession(session) {
    session.lastActiveAt = new Date().toISOString();
    writeJson(sessionPath(session.sessionId), session);
    return session;
  }

  function event(session, type, detail = {}) {
    appendJsonLine(join(session.runDir, "events.jsonl"), {
      at: new Date().toISOString(),
      revision: session.revision,
      sessionId: session.sessionId,
      type,
      ...redactForEvidence(session, detail),
    });
  }

  function readState(session) {
    const path = join(session.runDir, "world-state.json");
    return existsSync(path) ? readJson(path) : null;
  }

  function saveState(session, snapshot) {
    const value = cloneJson(snapshot);
    session.stateDigest = digestJson(value);
    writeJson(join(session.runDir, "world-state.json"), value);
    saveSession(session);
    return value;
  }

  function saveAdapterEvidence(session, adapter, active) {
    const diagnostics = redactForEvidence(session, adapter.diagnostics?.() ?? {});
    const processes = (diagnostics.processes ?? []).map((entry) => ({
      ...entry,
      status: active && entry.status !== "stopped" ? "running" : "stopped",
    }));
    writeJson(join(session.runDir, "processes.json"), processes);
    writeJson(join(session.runDir, "logs", "runtime.json"), { logs: diagnostics.logs ?? [] });
    writeJson(join(session.runDir, "logs", "console.json"), {
      errors: diagnostics.consoleErrors ?? [],
      logs: diagnostics.consoleLogs ?? [],
    });
  }

  async function cleanupIdleAdapters(now = Date.now()) {
    for (const [sessionId, entry] of liveAdapters.entries()) {
      if (now - entry.lastUsedAt < idleLeaseMs || abortControllers.has(sessionId)) continue;
      await withTimeout(entry.adapter.close(), WORLD_LIMITS.runtimeCloseTimeoutMs, "World adapter close").catch(() => {});
      liveAdapters.delete(sessionId);
      if (existsSync(sessionPath(sessionId))) {
        const session = loadSession(sessionId);
        saveAdapterEvidence(session, entry.adapter, false);
        event(session, "session.runtime_released", { reason: "idle-lease" });
      }
    }
  }

  async function openAdapter(session, { restore = true } = {}) {
    const live = liveAdapters.get(session.sessionId);
    if (keepAlive && live) {
      live.lastUsedAt = Date.now();
      return live.adapter;
    }
    if (keepAlive) {
      await cleanupIdleAdapters();
      if (liveAdapters.size >= maxActiveSessions) {
        const error = new Error(`Active world session limit reached (${maxActiveSessions}). Close a session or wait for its idle lease.`);
        error.code = "SESSION_LIMIT_REACHED";
        throw error;
      }
    }
    const adapter = createWorldAdapter(session);
    try {
      await withTimeout(adapter.start(), WORLD_LIMITS.runtimeStartupTimeoutMs, "World adapter startup");
      const snapshot = readState(session);
      if (restore && snapshot) {
        await withTimeout(adapter.restore(snapshot), WORLD_LIMITS.runtimeControlTimeoutMs, "World state restore");
        const restored = await withTimeout(adapter.snapshot(), WORLD_LIMITS.runtimeControlTimeoutMs, "World state verification");
        if (digestJson(restored) !== session.stateDigest) {
          const error = new Error("Restored world state did not match the persisted session digest.");
          error.code = "SESSION_RESTORE_DIGEST_MISMATCH";
          session.status = "blocked";
          session.blockedReason = error.message;
          saveSession(session);
          event(session, "session.blocked", { code: error.code, message: error.message });
          throw error;
        }
      }
      if (keepAlive) liveAdapters.set(session.sessionId, { adapter, lastUsedAt: Date.now() });
      saveAdapterEvidence(session, adapter, keepAlive);
      return adapter;
    } catch (error) {
      await withTimeout(adapter.close(), WORLD_LIMITS.runtimeCloseTimeoutMs, "World adapter close").catch(() => {});
      throw error;
    }
  }

  async function releaseAdapter(session, adapter) {
    const live = liveAdapters.get(session.sessionId);
    if (keepAlive && live?.adapter === adapter) {
      live.lastUsedAt = Date.now();
      saveAdapterEvidence(session, adapter, true);
      return;
    }
    await withTimeout(adapter.close(), WORLD_LIMITS.runtimeCloseTimeoutMs, "World adapter close").catch(() => {});
    saveAdapterEvidence(session, adapter, false);
  }

  async function withAdapter(session, callback, options = {}) {
    const adapter = await openAdapter(session, options);
    try {
      return await callback(adapter);
    } finally {
      await releaseAdapter(session, adapter);
    }
  }

  async function createSession(input) {
    const parsed = worldSessionCreateSchema.parse(input);
    const targetPath = assertAllowed(parsed.targetPath, "World target");
    const profilePath = parsed.profilePath ? assertAllowed(parsed.profilePath, "Execution profile") : null;
    const profile = loadExecutionProfile(profilePath, parsed.adapter);
    if (profile.allowedWorkspaceRoots.length) {
      const profileRoots = profile.allowedWorkspaceRoots.map((path) => resolve(workspaceRoot, path));
      if (!profileRoots.some((root) => isWithin(root, targetPath))) {
        const error = new Error("World target is outside the execution profile workspace roots.");
        error.code = "PROFILE_WORKSPACE_DENIED";
        throw error;
      }
    }
    if (profile.resourceLimits.memory === "hard") {
      const error = new Error("The local SimSpace backend cannot guarantee a hard memory boundary. Use a future container backend or best-effort memory mode.");
      error.code = "HARD_MEMORY_BOUNDARY_UNAVAILABLE";
      throw error;
    }
    if (keepAlive) {
      await cleanupIdleAdapters();
      if (liveAdapters.size >= maxActiveSessions) {
        const error = new Error(`Active world session limit reached (${maxActiveSessions}).`);
        error.code = "SESSION_LIMIT_REACHED";
        throw error;
      }
    }
    const stageRoot = profile.stageRoot
      ? assertAllowed(resolve(workspaceRoot, profile.stageRoot), "Execution profile stageRoot")
      : targetPath;
    if (!isWithin(stageRoot, targetPath)) throw new Error("World target must be inside the execution profile stageRoot.");
    const sessionId = safeId(parsed.sessionId, `world-${Date.now()}-${randomUUID().slice(0, 8)}`);
    const staged = await prepareWorldSimSpace({ sessionId, sourceRoot: stageRoot, targetPath, workspaceRoot });
    const session = {
      adapter: parsed.adapter,
      allocatedPort: staged.allocatedPort,
      blockedReason: null,
      capabilities: [],
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      profile,
      profilePath,
      revision: 0,
      runDir: staged.runDir,
      sessionId,
      sourceRoot: staged.manifest.sourceRoot,
      stagedAppPath: staged.stagedAppPath,
      stagedRoot: staged.stagedRoot,
      stateDigest: null,
      status: "starting",
      targetPath,
    };
    saveSession(session);
    event(session, "session.created", { adapter: session.adapter });

    try {
      await withAdapter(session, async (adapter) => {
        session.capabilities = await withTimeout(adapter.capabilities(), WORLD_LIMITS.runtimeControlTimeoutMs, "World capability discovery");
        const snapshot = await withTimeout(adapter.snapshot(), WORLD_LIMITS.runtimeControlTimeoutMs, "Initial world snapshot");
        saveState(session, snapshot);
      }, { restore: false });
      session.status = "ready";
      saveSession(session);
      event(session, "session.ready", { capabilities: session.capabilities.map((entry) => entry.id) });
      writeJson(join(session.runDir, "report.json"), {
        adapter: session.adapter,
        createdAt: session.createdAt,
        revision: session.revision,
        runId: session.sessionId,
        sessionId: session.sessionId,
        status: "ready",
        summary: "World session staged and ready for batch commands.",
      });
      return sessionView(session);
    } catch (error) {
      session.status = "failed";
      session.blockedReason = error.message;
      saveSession(session);
      event(session, "session.failed", { code: error.code ?? "SESSION_START_FAILED", message: error.message });
      writeJson(join(session.runDir, "report.json"), redactForEvidence(session, {
        adapter: session.adapter,
        completedAt: new Date().toISOString(),
        error: { code: error.code ?? "SESSION_START_FAILED", message: error.message },
        failedStep: "world.session_create",
        runId: session.sessionId,
        sessionId: session.sessionId,
        status: "failed",
        summary: "World session failed during staged runtime startup.",
      }));
      throw error;
    }
  }

  async function observe(sessionId) {
    const session = loadSession(sessionId);
    if (!["ready", "blocked"].includes(session.status)) throw new Error(`Session ${sessionId} is ${session.status}.`);
    const state = await withAdapter(session, (adapter) => withTimeout(adapter.observe(), WORLD_LIMITS.runtimeControlTimeoutMs, "World observation"));
    return { revision: session.revision, sessionId, state, stateDigest: digestJson(state) };
  }

  async function closeSession(sessionId) {
    const session = loadSession(sessionId);
    const entry = liveAdapters.get(sessionId);
    if (entry) {
      await withTimeout(entry.adapter.close(), WORLD_LIMITS.runtimeCloseTimeoutMs, "World adapter close").catch(() => {});
      saveAdapterEvidence(session, entry.adapter, false);
      liveAdapters.delete(sessionId);
    }
    session.status = "closed";
    session.closedAt = new Date().toISOString();
    session.activeBatchId = null;
    saveSession(session);
    event(session, "session.closed");
    const reportPath = join(session.runDir, "report.json");
    const priorReport = existsSync(reportPath) ? readJson(reportPath) : {};
    writeJson(reportPath, redactForEvidence(session, {
      ...priorReport,
      closedAt: session.closedAt,
      sessionStatus: "closed",
    }));
    return sessionView(session);
  }

  function cancelSession(sessionId) {
    const session = loadSession(sessionId);
    if (!session.activeBatchId) return { cancelled: false, sessionId };
    writeJson(cancellationPath(session), {
      batchId: session.activeBatchId,
      requestedAt: new Date().toISOString(),
      sessionId,
    });
    abortControllers.get(sessionId)?.controller.abort();
    event(session, "batch.cancel_requested", { batchId: session.activeBatchId });
    return { batchId: session.activeBatchId, cancelled: true, sessionId };
  }

  async function withLock(sessionId, callback) {
    const prior = locks.get(sessionId) ?? Promise.resolve();
    let release;
    const current = new Promise((resolveRelease) => { release = resolveRelease; });
    const queued = prior.then(() => current);
    locks.set(sessionId, queued);
    await prior;
    try {
      return await callback();
    } finally {
      release();
      if (locks.get(sessionId) === queued) locks.delete(sessionId);
    }
  }

  function beginBatch(sessionId, batchId) {
    const controller = new AbortController();
    const session = loadSession(sessionId);
    rmSync(cancellationPath(session), { force: true });
    const poll = setInterval(() => {
      if (!existsSync(cancellationPath(session))) return;
      const request = readJson(cancellationPath(session));
      if (request.batchId === batchId) controller.abort();
    }, 50);
    poll.unref?.();
    abortControllers.set(sessionId, { controller, poll });
    session.activeBatchId = batchId;
    saveSession(session);
    return controller;
  }

  function endBatch(sessionId) {
    const session = loadSession(sessionId);
    const active = abortControllers.get(sessionId);
    if (active) clearInterval(active.poll);
    abortControllers.delete(sessionId);
    rmSync(cancellationPath(session), { force: true });
    session.activeBatchId = null;
    saveSession(session);
  }

  async function shutdown() {
    if (idleTimer) clearInterval(idleTimer);
    for (const [sessionId, entry] of liveAdapters.entries()) {
      await withTimeout(entry.adapter.close(), WORLD_LIMITS.runtimeCloseTimeoutMs, "World adapter close").catch(() => {});
      if (existsSync(sessionPath(sessionId))) saveAdapterEvidence(loadSession(sessionId), entry.adapter, false);
    }
    liveAdapters.clear();
  }

  if (keepAlive) {
    idleTimer = setInterval(() => cleanupIdleAdapters().catch(() => {}), Math.min(idleLeaseMs, 60000));
    idleTimer.unref?.();
  }

  return Object.freeze({
    allowDestructive,
    beginBatch,
    cancelSession,
    cleanupIdleAdapters,
    closeSession,
    createSession,
    endBatch,
    event,
    loadSession,
    observe,
    readState,
    redactForEvidence,
    runsDir,
    saveSession,
    saveState,
    sessionDir,
    sessionView,
    shutdown,
    withAdapter,
    withLock,
    workspaceRoot,
  });
}
