import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod/v4";
import { createActionRegistry } from "../src/action-registry.js";
import { parseBatchRequest, WORLD_LIMITS, worldBatchSchema } from "../src/world-contracts.js";
import { createWorldActionSurface } from "../src/world-actions.js";

const empty = z.object({}).strict();

test("action registry rejects duplicate, malformed, and unknown actions", async () => {
  const registry = createActionRegistry();
  registry.register({ id: "test.read", inputSchema: empty, outputSchema: empty, handler: async () => ({}) });
  assert.throws(
    () => registry.register({ id: "test.read", inputSchema: empty, outputSchema: empty, handler: async () => ({}) }),
    /Duplicate action id/,
  );
  assert.throws(
    () => registry.register({ id: "test.invalid", inputSchema: {}, outputSchema: empty, handler: async () => ({}) }),
    /requires Zod input and output schemas/,
  );
  await assert.rejects(registry.dispatch("test.unknown", {}), (error) => error.code === "UNKNOWN_ACTION");
});

test("harness manifest exposes schemas, adapters, limits, and safety", async (t) => {
  const surface = createWorldActionSurface();
  t.after(() => surface.shutdown());
  const manifest = await surface.dispatch("harness.manifest", {});
  const batch = manifest.actions.find((action) => action.id === "world.batch_command");
  assert.equal(manifest.batchCommand, "world.batch_command");
  assert.deepEqual(manifest.adapters, ["browser", "nexus-headless"]);
  assert.equal(manifest.limits.maxCommands, 50);
  assert.equal(batch.inputSchema.type, "object");
  assert.equal(batch.outputSchema.type, "object");
  assert.equal(batch.safety.destructive, true);
  assert.equal(manifest.safety.rawShellAllowed, false);
  assert.equal(manifest.worldCommands.some((command) => command.id === "world.object.update" && command.inputSchema.type === "object"), true);
});

test("batch contracts enforce identifiers, command count, request size, and timeouts", () => {
  const base = {
    baseRevision: 0,
    batchId: "contract",
    commands: [{ action: "world.observe", args: {}, id: "observe" }],
    sessionId: "world",
  };
  assert.equal(parseBatchRequest(base).policy.timeoutMs, WORLD_LIMITS.batchTimeoutMs);
  assert.throws(
    () => parseBatchRequest({ ...base, commands: [base.commands[0], base.commands[0]] }),
    (error) => error.code === "DUPLICATE_COMMAND_ID",
  );
  assert.throws(() => worldBatchSchema.parse({
    ...base,
    commands: Array.from({ length: WORLD_LIMITS.maxCommands + 1 }, (_, index) => ({ action: "world.observe", args: {}, id: `c-${index}` })),
  }));
  assert.throws(() => worldBatchSchema.parse({ ...base, policy: { timeoutMs: WORLD_LIMITS.maxBatchTimeoutMs + 1 } }));
  assert.throws(() => worldBatchSchema.parse({
    ...base,
    commands: [{ ...base.commands[0], timeoutMs: WORLD_LIMITS.maxCommandTimeoutMs + 1 }],
  }));
  assert.throws(
    () => parseBatchRequest({ ...base, metadata: { payload: "x".repeat(WORLD_LIMITS.maxRequestBytes + 1) } }),
    (error) => error.code === "REQUEST_TOO_LARGE",
  );
});
