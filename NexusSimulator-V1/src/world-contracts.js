import * as z from "zod/v4";

export const WORLD_LIMITS = Object.freeze({
  batchTimeoutMs: 120000,
  commandTimeoutMs: 30000,
  inlineOutputBytes: 256 * 1024,
  maxBatchTimeoutMs: 600000,
  maxCommandTimeoutMs: 120000,
  maxCommands: 50,
  maxRequestBytes: 1024 * 1024,
  maxActiveSessions: 4,
  idleLeaseMs: 30 * 60 * 1000,
  runtimeCloseTimeoutMs: 30000,
  runtimeControlTimeoutMs: 60000,
  runtimeStartupTimeoutMs: 120000,
});

const safeId = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const actionId = z.string().min(1).max(128).regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const metadataSchema = z.record(z.string(), z.unknown()).default({});

export const worldCommandSchema = z.object({
  id: safeId,
  action: actionId,
  args: z.record(z.string(), z.unknown()).default({}),
  metadata: metadataSchema.optional(),
  timeoutMs: z.number().int().positive().max(WORLD_LIMITS.maxCommandTimeoutMs).optional(),
}).strict();

export const worldBatchSchema = z.object({
  sessionId: safeId,
  batchId: safeId,
  baseRevision: z.number().int().nonnegative(),
  policy: z.object({
    allowDestructive: z.boolean().default(false),
    checkpointBefore: z.boolean().default(true),
    dryRun: z.boolean().default(false),
    onError: z.enum(["stop", "continue", "rollback"]).default("stop"),
    timeoutMs: z.number().int().positive().max(WORLD_LIMITS.maxBatchTimeoutMs).default(WORLD_LIMITS.batchTimeoutMs),
  }).prefault({}),
  metadata: metadataSchema.optional(),
  commands: z.array(worldCommandSchema).min(1).max(WORLD_LIMITS.maxCommands),
}).strict();

export const worldSessionCreateSchema = z.object({
  adapter: z.enum(["browser", "nexus-headless"]).default("browser"),
  profilePath: z.string().min(1).optional(),
  sessionId: safeId.optional(),
  targetPath: z.string().min(1),
}).strict();

export const worldSessionIdSchema = z.object({ sessionId: safeId }).strict();
export const worldBatchStatusSchema = z.object({ sessionId: safeId, batchId: safeId }).strict();

export const worldBatchResultSchema = z.object({
  status: z.enum(["passed", "partial", "failed", "rolled_back"]),
  sessionId: safeId,
  batchId: safeId,
  requestHash: z.string(),
  dryRun: z.boolean(),
  revisionBefore: z.number().int().nonnegative(),
  revisionAfter: z.number().int().nonnegative(),
  results: z.array(z.record(z.string(), z.unknown())),
  stateDiff: z.record(z.string(), z.unknown()),
  artifacts: z.array(z.unknown()),
  errors: z.array(z.record(z.string(), z.unknown())),
  checkpointId: z.string().nullable(),
  rollback: z.record(z.string(), z.unknown()),
}).loose();

export function parseBatchRequest(value) {
  const bytes = Buffer.byteLength(JSON.stringify(value ?? null));
  if (bytes > WORLD_LIMITS.maxRequestBytes) {
    const error = new Error(`Batch request exceeds ${WORLD_LIMITS.maxRequestBytes} bytes.`);
    error.code = "REQUEST_TOO_LARGE";
    throw error;
  }
  const parsed = worldBatchSchema.parse(value);
  const ids = new Set();
  for (const command of parsed.commands) {
    if (ids.has(command.id)) {
      const error = new Error(`Duplicate command id "${command.id}".`);
      error.code = "DUPLICATE_COMMAND_ID";
      throw error;
    }
    ids.add(command.id);
  }
  return parsed;
}
