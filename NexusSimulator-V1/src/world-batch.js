import { existsSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { parseBatchRequest, WORLD_LIMITS } from "./world-contracts.js";
import { resolveWorldCommand } from "./world-command-registry.js";
import { cloneJson, digestJson, jsonPatchDiff, readJson, toErrorRecord, withTimeout, writeJson } from "./world-utils.js";

function batchDir(session, batchId) {
  return join(session.runDir, "batches", batchId);
}

function batchResultPath(session, batchId) {
  return join(batchDir(session, batchId), "result.json");
}

function runRelativeUri(session, path) {
  const rel = relative(session.runDir, resolve(path));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return `nexus-sim://runs/${session.sessionId}/${rel.split("\\").join("/")}`;
}

function normalizeArtifact(session, artifact) {
  if (typeof artifact === "string") {
    const uri = runRelativeUri(session, artifact);
    return uri ? { name: basename(artifact), uri } : { name: basename(artifact), unavailable: true };
  }
  const value = cloneJson(artifact ?? {});
  if (value.path) {
    const uri = runRelativeUri(session, value.path);
    delete value.path;
    if (uri) value.uri = uri;
    else value.unavailable = true;
  }
  return value;
}

function baseResult(request, requestHash, revision) {
  return {
    artifacts: [],
    batchId: request.batchId,
    checkpointId: null,
    cancellation: { adapterInterrupted: null, limitation: null, requested: false },
    completedAt: null,
    dryRun: request.policy.dryRun,
    durationMs: 0,
    errors: [],
    reportUri: `nexus-sim://runs/${request.sessionId}/report`,
    requestHash,
    results: [],
    revisionAfter: revision,
    revisionBefore: revision,
    rollback: { attempted: false, succeeded: false },
    sessionId: request.sessionId,
    startedAt: new Date().toISOString(),
    stateDiff: { format: "json-patch", operations: [], truncated: false },
    stateDigestAfter: null,
    stateDigestBefore: null,
    status: "failed",
    warnings: [],
  };
}

async function captureEvidence(adapter, session, result, name) {
  if (!adapter.capture) return;
  try {
    const capture = await withTimeout(adapter.capture(name), WORLD_LIMITS.runtimeControlTimeoutMs, "World evidence capture");
    result.artifacts.push(...(capture.artifacts ?? []).map((artifact) => normalizeArtifact(session, artifact)));
  } catch (error) {
    result.warnings.push(toErrorRecord(error, { category: "evidence-capture" }));
  }
}

function persistResult(manager, session, request, result, fullOutput = null) {
  const directory = batchDir(session, request.batchId);
  writeJson(join(directory, "request.json"), request);
  if (fullOutput) writeJson(join(directory, "output.json"), fullOutput);
  writeJson(join(directory, "result.json"), result);
  writeJson(join(session.runDir, "report.json"), {
    adapter: session.adapter,
    artifacts: result.artifacts,
    batchId: result.batchId,
    completedAt: result.completedAt,
    errors: result.errors,
    failedStep: result.results.find((entry) => entry.status === "failed") ?? null,
    reportUri: result.reportUri,
    revision: result.revisionAfter,
    runId: session.sessionId,
    sessionId: session.sessionId,
    status: result.status,
    summary: result.status === "passed"
      ? `Batch ${result.batchId} completed successfully.`
      : result.status === "rolled_back"
        ? `Batch ${result.batchId} failed and restored its checkpoint.`
        : `Batch ${result.batchId} completed with status ${result.status}.`,
  });
  manager.event(session, "batch.completed", {
    batchId: result.batchId,
    revisionAfter: result.revisionAfter,
    status: result.status,
  });
}

function compactResult(manager, session, request, result) {
  const bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes <= WORLD_LIMITS.inlineOutputBytes) return result;
  const fullOutput = cloneJson(result.results);
  const outputPath = join(batchDir(session, request.batchId), "output.json");
  result.results = result.results.map((entry) => ({
    action: entry.action,
    durationMs: entry.durationMs,
    error: entry.error ?? null,
    id: entry.id,
    status: entry.status,
  }));
  result.artifacts.push({ name: "output.json", uri: runRelativeUri(session, outputPath) });
  result.outputTruncated = true;
  persistResult(manager, session, request, result, fullOutput);
  return result;
}

function stateDiffForResult(session, request, before, after, result) {
  const fullDiff = jsonPatchDiff(before, after, Number.MAX_SAFE_INTEGER);
  if (Buffer.byteLength(JSON.stringify(fullDiff)) <= WORLD_LIMITS.inlineOutputBytes) return fullDiff;
  const path = join(batchDir(session, request.batchId), "state-diff.json");
  writeJson(path, fullDiff);
  const artifact = { name: "state-diff.json", uri: runRelativeUri(session, path) };
  result.artifacts.push(artifact);
  return {
    format: fullDiff.format,
    operations: fullDiff.operations.slice(0, 100).map(({ op, path: operationPath }) => ({ op, path: operationPath })),
    resource: artifact,
    truncated: true,
  };
}

function existingBatch(session, request, requestHash) {
  const path = batchResultPath(session, request.batchId);
  if (!existsSync(path)) return null;
  const existing = readJson(path);
  if (existing.requestHash === requestHash) return existing;
  const error = new Error(`Batch id "${request.batchId}" was already used with different content.`);
  error.code = "BATCH_ID_CONFLICT";
  throw error;
}

function validateCommands(request, capabilities, manager, session) {
  return request.commands.map((command) => {
    const descriptor = resolveWorldCommand(command.action, capabilities);
    let args;
    try {
      args = descriptor.argsSchema.parse(command.args ?? {});
    } catch (cause) {
      const error = new Error(`Invalid arguments for "${command.action}" in command "${command.id}".`);
      error.code = "INVALID_ACTION_ARGS";
      error.cause = cause;
      throw error;
    }
    if (descriptor.safety.destructive && (!request.policy.allowDestructive || !manager.allowDestructive || !session.profile.allowDestructive)) {
      const error = new Error(`Destructive action "${command.action}" requires profile, server, and batch approval.`);
      error.code = "DESTRUCTIVE_ACTION_DENIED";
      throw error;
    }
    if (request.policy.onError === "rollback" && descriptor.safety.mutatesWorld && descriptor.safety.rollback === "none") {
      const error = new Error(`Action "${command.action}" does not support rollback.`);
      error.code = "ROLLBACK_UNSUPPORTED";
      throw error;
    }
    return { ...command, args, descriptor };
  });
}

function finalizeTimes(result) {
  result.completedAt = new Date().toISOString();
  result.durationMs = Date.parse(result.completedAt) - Date.parse(result.startedAt);
  return result;
}

export async function executeWorldBatch(manager, input, options = {}) {
  const request = parseBatchRequest(input);
  const requestHash = digestJson(request);
  return manager.withLock(request.sessionId, async () => {
    let session = manager.loadSession(request.sessionId);
    const repeated = existingBatch(session, request, requestHash);
    if (repeated) return repeated;

    let result = baseResult(request, requestHash, session.revision);
    if (session.status === "blocked") {
      result.errors.push({ code: "SESSION_BLOCKED", message: session.blockedReason ?? "Session requires recovery.", retryable: false });
      finalizeTimes(result);
      result = manager.redactForEvidence(session, result);
      persistResult(manager, session, request, result);
      return result;
    }
    if (session.status !== "ready") {
      result.errors.push({ code: "SESSION_NOT_READY", message: `Session is ${session.status}.`, retryable: false });
      finalizeTimes(result);
      result = manager.redactForEvidence(session, result);
      persistResult(manager, session, request, result);
      return result;
    }
    if (request.baseRevision !== session.revision) {
      result.errors.push({
        code: "REVISION_CONFLICT",
        expectedRevision: session.revision,
        message: `Expected baseRevision ${session.revision}, received ${request.baseRevision}.`,
        retryable: true,
      });
      finalizeTimes(result);
      result = manager.redactForEvidence(session, result);
      persistResult(manager, session, request, result);
      return result;
    }

    let commands;
    try {
      commands = validateCommands(request, session.capabilities, manager, session);
    } catch (error) {
      result.errors.push(toErrorRecord(error, { category: "preflight" }));
      result.results = request.commands.map((command) => ({ action: command.action, id: command.id, status: "skipped" }));
      finalizeTimes(result);
      result = manager.redactForEvidence(session, result);
      persistResult(manager, session, request, result);
      return result;
    }

    const persistedBefore = manager.readState(session);
    result.stateDigestBefore = digestJson(persistedBefore);
    result.stateDigestAfter = result.stateDigestBefore;
    const mutating = commands.some((command) => command.descriptor.safety.mutatesWorld);
    if (request.policy.dryRun) {
      result.results = commands.map((command) => ({ action: command.action, dryRun: true, id: command.id, status: "passed" }));
      result.status = "passed";
      result.validation = { capabilities: session.capabilities.map((entry) => entry.id), mutating };
      finalizeTimes(result);
      result = manager.redactForEvidence(session, result);
      persistResult(manager, session, request, result);
      return result;
    }

    const controller = manager.beginBatch(session.sessionId, request.batchId);
    const cancelFromCaller = () => controller.abort();
    if (options.signal?.aborted) cancelFromCaller();
    else options.signal?.addEventListener("abort", cancelFromCaller, { once: true });
    manager.event(session, "batch.accepted", { batchId: request.batchId, requestHash });
    try {
      result = await manager.withAdapter(session, async (adapter) => {
        let adapterCancellation = null;
        const cancelAdapter = () => {
          result.cancellation.requested = true;
          adapterCancellation ??= Promise.resolve(adapter.cancel?.() ?? false).then((interrupted) => {
            result.cancellation.adapterInterrupted = Boolean(interrupted);
            if (!interrupted) result.cancellation.limitation = "The adapter could not interrupt its current operation; cancellation applies before the next command.";
          }).catch((error) => {
            result.cancellation.adapterInterrupted = false;
            result.cancellation.limitation = `Adapter cancellation failed; cancellation applies before the next command. ${error.message}`;
          });
        };
        controller.signal.addEventListener("abort", cancelAdapter, { once: true });
        if (controller.signal.aborted) cancelAdapter();
        try {
        const capabilities = await withTimeout(adapter.capabilities(), WORLD_LIMITS.runtimeControlTimeoutMs, "World capability verification", controller.signal);
        const available = new Set(capabilities.map((entry) => entry.id));
        const missing = commands.find((command) => !available.has(command.action));
        if (missing) {
          const error = new Error(`World adapter capability changed after session creation: ${missing.action}`);
          error.code = "CAPABILITY_DRIFT";
          throw error;
        }

        const before = await withTimeout(adapter.snapshot(), WORLD_LIMITS.runtimeControlTimeoutMs, "Pre-batch world snapshot", controller.signal);
        result.stateDigestBefore = digestJson(before);
        result.stateDigestAfter = result.stateDigestBefore;
        if (session.stateDigest && result.stateDigestBefore !== session.stateDigest) {
          const error = new Error("Live world state drifted from the persisted session digest.");
          error.code = "WORLD_STATE_DRIFT";
          session.status = "blocked";
          session.blockedReason = error.message;
          manager.saveSession(session);
          throw error;
        }
        if (mutating) await captureEvidence(adapter, session, result, `${request.batchId}-before.png`);

        if (mutating && (request.policy.checkpointBefore || request.policy.onError === "rollback")) {
          result.checkpointId = `checkpoint-${session.revision}-${request.batchId}`;
          writeJson(join(session.runDir, "checkpoints", result.checkpointId, "snapshot.json"), before);
          writeJson(join(session.runDir, "checkpoints", result.checkpointId, "metadata.json"), {
            batchId: request.batchId,
            createdAt: new Date().toISOString(),
            revision: session.revision,
            stateDigest: result.stateDigestBefore,
          });
          manager.event(session, "batch.checkpoint", { batchId: request.batchId, checkpointId: result.checkpointId });
        }

        const batchDeadline = Date.now() + request.policy.timeoutMs;
        let stopped = false;
        for (const [index, command] of commands.entries()) {
          if (stopped) {
            result.results.push({ action: command.action, id: command.id, status: "skipped" });
            continue;
          }
          const commandStartedAt = Date.now();
          const commandController = new AbortController();
          const forwardBatchAbort = () => commandController.abort(controller.signal.reason);
          if (controller.signal.aborted) forwardBatchAbort();
          else controller.signal.addEventListener("abort", forwardBatchAbort, { once: true });
          manager.event(session, "command.started", { action: command.action, batchId: request.batchId, commandId: command.id, index });
          try {
            const remaining = batchDeadline - Date.now();
            if (remaining <= 0) {
              const timeout = new Error(`Batch timed out after ${request.policy.timeoutMs}ms.`);
              timeout.code = "TIMEOUT";
              throw timeout;
            }
            const timeoutMs = Math.min(command.timeoutMs ?? WORLD_LIMITS.commandTimeoutMs, remaining);
            const output = await withTimeout(adapter.execute({
              action: command.action,
              args: command.args,
              id: command.id,
              metadata: command.metadata ?? {},
            }, {
              onError: request.policy.onError,
              signal: commandController.signal,
            }), timeoutMs, `Command ${command.id}`, controller.signal);
            const artifacts = (output?.artifacts ?? []).map((artifact) => normalizeArtifact(session, artifact));
            result.artifacts.push(...artifacts);
            result.results.push({
              action: command.action,
              artifacts,
              data: cloneJson(output?.data ?? output?.snapshot ?? null),
              durationMs: Date.now() - commandStartedAt,
              id: command.id,
              observations: cloneJson(output?.observations ?? []),
              status: "passed",
            });
            manager.event(session, "command.completed", { batchId: request.batchId, commandId: command.id, status: "passed" });
          } catch (error) {
            if (error.code === "TIMEOUT") commandController.abort(error);
            const errorRecord = toErrorRecord(error, { action: command.action, commandId: command.id, index });
            result.errors.push(errorRecord);
            result.results.push({
              action: command.action,
              durationMs: Date.now() - commandStartedAt,
              error: errorRecord,
              id: command.id,
              status: "failed",
            });
            manager.event(session, "command.completed", { batchId: request.batchId, commandId: command.id, error: errorRecord, status: "failed" });
            if (request.policy.onError !== "continue") stopped = true;
          } finally {
            controller.signal.removeEventListener("abort", forwardBatchAbort);
          }
        }

        let after = await withTimeout(adapter.snapshot(), WORLD_LIMITS.runtimeControlTimeoutMs, "Post-batch world snapshot", controller.signal);
        let afterDigest = digestJson(after);
        const changed = afterDigest !== result.stateDigestBefore;
        if (result.errors.length && request.policy.onError === "rollback") {
          result.rollback = { attempted: true, checkpointId: result.checkpointId, succeeded: false };
          try {
            await withTimeout(adapter.restore(before), WORLD_LIMITS.runtimeControlTimeoutMs, "World rollback restore", controller.signal);
            after = await withTimeout(adapter.snapshot(), WORLD_LIMITS.runtimeControlTimeoutMs, "World rollback verification", controller.signal);
            afterDigest = digestJson(after);
            if (afterDigest !== result.stateDigestBefore) {
              const error = new Error("Rollback state digest did not match the checkpoint.");
              error.code = "ROLLBACK_DIGEST_MISMATCH";
              throw error;
            }
            result.rollback.succeeded = true;
            result.status = "rolled_back";
            result.results = result.results.map((entry) => entry.status === "passed" ? { ...entry, status: "rolled_back" } : entry);
            manager.event(session, "batch.rolled_back", { batchId: request.batchId, checkpointId: result.checkpointId });
          } catch (error) {
            const rollbackError = toErrorRecord(error, { category: "rollback" });
            result.errors.push(rollbackError);
            result.rollback.error = rollbackError;
            result.status = "failed";
            session.status = "blocked";
            session.blockedReason = rollbackError.message;
            if (changed || afterDigest !== result.stateDigestBefore) session.revision += 1;
          }
        } else if (result.errors.length) {
          result.status = result.results.some((entry) => entry.status === "passed") ? "partial" : "failed";
          if (changed) session.revision += 1;
        } else {
          result.status = "passed";
          if (changed) session.revision += 1;
        }

        result.revisionAfter = session.revision;
        result.stateDigestAfter = afterDigest;
        result.stateDiff = stateDiffForResult(session, request, before, after, result);
        if (mutating) await captureEvidence(adapter, session, result, `${request.batchId}-after.png`);
        manager.saveState(session, after);
        manager.saveSession(session);
        if (adapterCancellation) await adapterCancellation;
        return finalizeTimes(result);
        } finally {
          controller.signal.removeEventListener("abort", cancelAdapter);
        }
      });
    } catch (error) {
      session = manager.loadSession(request.sessionId);
      result.errors.push(toErrorRecord(error, { category: "execution" }));
      result.status = "failed";
      if (mutating) {
        if (session.revision === request.baseRevision) session.revision += 1;
        session.status = "blocked";
        session.blockedReason = "Runtime state could not be verified after an execution failure.";
        manager.saveSession(session);
        manager.event(session, "session.blocked", { code: error.code ?? "EXECUTION_STATE_UNVERIFIED" });
      }
      result.revisionAfter = session.revision;
      finalizeTimes(result);
    } finally {
      options.signal?.removeEventListener("abort", cancelFromCaller);
      manager.endBatch(request.sessionId);
    }

    session = manager.loadSession(request.sessionId);
    result = manager.redactForEvidence(session, result);
    const compacted = compactResult(manager, session, request, result);
    if (!compacted.outputTruncated) persistResult(manager, session, request, compacted);
    return compacted;
  });
}

export function loadWorldBatchResult(manager, sessionId, batchId) {
  const session = manager.loadSession(sessionId);
  const path = batchResultPath(session, batchId);
  if (!existsSync(path)) {
    const error = new Error(`Unknown batch "${batchId}" for session "${sessionId}".`);
    error.code = "BATCH_NOT_FOUND";
    throw error;
  }
  return readJson(path);
}
