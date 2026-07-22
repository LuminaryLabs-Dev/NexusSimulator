import { existsSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod/v4";
import { createActionRegistry } from "./action-registry.js";
import { executeWorldBatch, loadWorldBatchResult } from "./world-batch.js";
import {
  worldBatchResultSchema,
  worldBatchSchema,
  worldBatchStatusSchema,
  WORLD_LIMITS,
  worldSessionCreateSchema,
  worldSessionIdSchema,
} from "./world-contracts.js";
import { listWorldCommands } from "./world-command-registry.js";
import { createWorldSessionManager } from "./world-session-manager.js";
import { readJson } from "./world-utils.js";

const anyOutput = z.object({}).loose();
const safeRunId = z.object({ runId: z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/) }).strict();

function descriptor(id, title, description, inputSchema, outputSchema, safety, handler) {
  return { description, handler, id, inputSchema, outputSchema, safety, title };
}

export function createWorldActionSurface(options = {}) {
  const registry = createActionRegistry();
  const manager = options.manager ?? createWorldSessionManager(options);

  function readSessionReport(runId) {
    const session = manager.loadSession(runId);
    const path = join(session.runDir, "report.json");
    if (!existsSync(path)) {
      const error = new Error(`Report is not available for world session "${runId}".`);
      error.code = "REPORT_NOT_FOUND";
      throw error;
    }
    return { report: manager.redactForEvidence(session, readJson(path)), session };
  }

  registry.register(descriptor(
    "harness.manifest",
    "Inspect NexusSimulator harness",
    "Discover world tools, command schemas, adapters, limits, and safety defaults.",
    z.object({}).strict(),
    anyOutput,
    { destructive: false, mutatesWorld: false, readOnly: true, replayable: true, rollback: "snapshot" },
    async () => ({
      actions: registry.manifests(),
      adapters: ["browser", "nexus-headless"],
      batchCommand: "world.batch_command",
      limits: WORLD_LIMITS,
      safety: {
        destructiveRequiresProfileBatchAndServerApproval: true,
        rawShellAllowed: false,
        sourceMutationAllowed: false,
      },
      transports: ["stdio", "streamable-http"],
      version: "0.0.3-development",
      worldCommands: listWorldCommands(),
    }),
  ));

  registry.register(descriptor(
    "world.session_create",
    "Create world session",
    "Stage a target into SimSpace and initialize a revisioned world session.",
    worldSessionCreateSchema,
    anyOutput,
    { destructive: false, mutatesWorld: true, readOnly: false, replayable: false, rollback: "none" },
    (input) => manager.createSession(input),
  ));

  registry.register(descriptor(
    "world.session_status",
    "Read world session status",
    "Return the current session status and revision.",
    worldSessionIdSchema,
    anyOutput,
    { destructive: false, mutatesWorld: false, readOnly: true, replayable: true, rollback: "snapshot" },
    async ({ sessionId }) => manager.sessionView(manager.loadSession(sessionId)),
  ));

  registry.register(descriptor(
    "world.observe",
    "Observe world",
    "Read normalized world state without changing the session revision.",
    worldSessionIdSchema,
    anyOutput,
    { destructive: false, mutatesWorld: false, readOnly: true, replayable: true, rollback: "snapshot" },
    ({ sessionId }) => manager.observe(sessionId),
  ));

  registry.register(descriptor(
    "world.batch_command",
    "Run world command batch",
    "Validate and execute an ordered, revision-checked sequence of allowlisted world commands.",
    worldBatchSchema,
    worldBatchResultSchema,
    { destructive: true, mutatesWorld: true, readOnly: false, replayable: true, rollback: "snapshot" },
    (input, context) => executeWorldBatch(manager, input, { signal: context.signal }),
  ));

  registry.register(descriptor(
    "world.batch_status",
    "Read world batch result",
    "Return a previously persisted batch result.",
    worldBatchStatusSchema,
    worldBatchResultSchema,
    { destructive: false, mutatesWorld: false, readOnly: true, replayable: true, rollback: "snapshot" },
    ({ batchId, sessionId }) => loadWorldBatchResult(manager, sessionId, batchId),
  ));

  registry.register(descriptor(
    "world.session_cancel",
    "Cancel active world batch",
    "Request cooperative cancellation of the active command batch.",
    worldSessionIdSchema,
    anyOutput,
    { destructive: false, mutatesWorld: true, readOnly: false, replayable: false, rollback: "none" },
    async ({ sessionId }) => manager.cancelSession(sessionId),
  ));

  registry.register(descriptor(
    "world.session_close",
    "Close world session",
    "Stop live runtime resources and mark the SimSpace session closed.",
    worldSessionIdSchema,
    anyOutput,
    { destructive: false, mutatesWorld: true, readOnly: false, replayable: false, rollback: "none" },
    ({ sessionId }) => manager.closeSession(sessionId),
  ));

  registry.register(descriptor(
    "report.get",
    "Read report",
    "Read a normalized report by safe run id.",
    safeRunId,
    anyOutput,
    { destructive: false, mutatesWorld: false, readOnly: true, replayable: true, rollback: "snapshot" },
    async ({ runId }) => readSessionReport(runId).report,
  ));

  registry.register(descriptor(
    "report.artifacts",
    "List report artifacts",
    "List report artifacts by safe run id.",
    safeRunId,
    anyOutput,
    { destructive: false, mutatesWorld: false, readOnly: true, replayable: true, rollback: "snapshot" },
    async ({ runId }) => {
      const { report } = readSessionReport(runId);
      return {
        artifacts: (report.artifacts ?? []).filter((artifact) =>
          artifact && typeof artifact === "object" && (artifact.unavailable || String(artifact.uri ?? "").startsWith("nexus-sim://"))),
      };
    },
  ));

  return Object.freeze({
    dispatch: registry.dispatch,
    manager,
    manifests: registry.manifests,
    registry,
    shutdown: () => manager.shutdown(),
  });
}
