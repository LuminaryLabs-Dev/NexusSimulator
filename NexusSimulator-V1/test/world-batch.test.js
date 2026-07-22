import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorldActionSurface } from "../src/world-actions.js";

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "nexus-world-batch-"));
  const app = join(root, "app");
  mkdirSync(app);
  const runtimePath = join(app, "runtime.mjs");
  writeFileSync(runtimePath, `
export function createHeadlessEditorRuntime() {
  let state = { commits: [], objects: { "tree-7": { id: "tree-7", position: [0, 0, 0] } }, terrain: { seed: 1 } };
  const capabilities = [
    "world.object.update",
    "world.object.commit",
    "world.terrain.rebuild",
    "world.validate",
    "test.break-restore",
    "test.delay",
    "test.fail",
    "test.large",
    "test.large-state",
    "test.no-rollback",
    "test.schema-only"
  ].map((id) => ({ id, description: id, inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: id === "test.delay" ? { ms: { type: "number" } } : ["test.large", "test.large-state"].includes(id) ? { bytes: { type: "number" } } : {}
  } }));
  return {
    startSession() {},
    endSession() {},
    listCapabilities() { return capabilities; },
    getState() { return JSON.parse(JSON.stringify(state)); },
    snapshot() { return JSON.parse(JSON.stringify(state)); },
    loadSnapshot(value) {
      if (state.breakRestore) state = { ...JSON.parse(JSON.stringify(value)), restoreBroken: true };
      else state = JSON.parse(JSON.stringify(value));
      return this.snapshot();
    },
    async runScript(script) {
      const step = script.steps[0];
      const args = step.args || {};
      if (step.action === "test.fail") return { ok: false, results: [{ ok: false, errors: [{ code: "FIXTURE_FAILURE", message: "fixture failure" }] }] };
      if (step.action === "test.delay") await new Promise((resolve) => setTimeout(resolve, args.ms));
      if (step.action === "test.large") return { ok: true, results: [{ ok: true, data: { text: "x".repeat(args.bytes) } }] };
      if (step.action === "test.large-state") state.large = "x".repeat(args.bytes);
      if (step.action === "test.break-restore") state.breakRestore = true;
      if (step.action === "test.no-rollback") state.noRollback = true;
      if (step.action === "world.object.update") state.objects[args.id] = { ...(state.objects[args.id] || { id: args.id }), ...args };
      if (step.action === "world.terrain.rebuild") state.terrain = { seed: args.seed, parameters: args.parameters || {} };
      if (step.action === "world.object.commit") state.commits.push(args.id);
      return { ok: true, results: [{ ok: true, data: JSON.parse(JSON.stringify(state)) }] };
    }
  };
}
`);
  const profilePath = join(root, "profile.json");
  writeFileSync(profilePath, `${JSON.stringify({
    actionPolicy: {
      "test.fail": { mutatesWorld: true, replayable: true, rollback: "snapshot" },
      "test.break-restore": { mutatesWorld: true, replayable: true, rollback: "snapshot" },
      "test.delay": { mutatesWorld: false, readOnly: true, replayable: true, rollback: "snapshot" },
      "test.large": { mutatesWorld: false, readOnly: true, replayable: true, rollback: "snapshot" },
      "test.large-state": { mutatesWorld: true, replayable: true, rollback: "snapshot" },
      "test.no-rollback": { mutatesWorld: true, replayable: false, rollback: "none" },
    },
    actionSchemas: {
      "test.fail": { type: "object", additionalProperties: false },
      "test.break-restore": { type: "object", additionalProperties: false },
      "test.delay": { type: "object", additionalProperties: false, properties: { ms: { type: "number", minimum: 1 } }, required: ["ms"] },
      "test.large": { type: "object", additionalProperties: false, properties: { bytes: { type: "number", minimum: 1 } }, required: ["bytes"] },
      "test.large-state": { type: "object", additionalProperties: false, properties: { bytes: { type: "number", minimum: 1 } }, required: ["bytes"] },
      "test.no-rollback": { type: "object", additionalProperties: false },
    },
    adapter: "nexus-headless",
    allowActions: ["world.object.update", "world.object.commit", "world.terrain.rebuild", "world.validate", "test.break-restore", "test.delay", "test.fail", "test.large", "test.large-state", "test.no-rollback", "test.schema-only"],
    modulePath: "runtime.mjs",
    schemaVersion: "nexus.execution-profile.v1",
    stageRoot: "app",
  }, null, 2)}\n`);
  return { app, profilePath, root, runtimePath };
}

function batch(sessionId, batchId, baseRevision, commands, policy = {}) {
  return {
    baseRevision,
    batchId,
    commands,
    policy: { checkpointBefore: true, dryRun: false, onError: "stop", ...policy },
    sessionId,
  };
}

test("world batches enforce ordering, revision, idempotency, rollback, and source isolation", async (t) => {
  const fixture = createFixture();
  t.after(() => rmSync(fixture.root, { force: true, recursive: true }));
  const sourceHash = hash(fixture.runtimePath);
  const surface = createWorldActionSurface({ allowDestructive: true, allowedRoots: [fixture.root], workspaceRoot: fixture.root });
  t.after(() => surface.shutdown());

  const session = await surface.dispatch("world.session_create", {
    adapter: "nexus-headless",
    profilePath: fixture.profilePath,
    sessionId: "world-test",
    targetPath: fixture.app,
  });
  assert.equal(session.revision, 0);

  const firstRequest = batch("world-test", "first", 0, [
    { action: "world.object.update", args: { id: "tree-7", position: [12, 0, 4] }, id: "move-tree" },
    { action: "world.terrain.rebuild", args: { seed: 42 }, id: "terrain" },
    { action: "world.validate", args: {}, id: "validate" },
  ]);
  const first = await surface.dispatch("world.batch_command", firstRequest);
  assert.equal(first.status, "passed");
  assert.equal(first.revisionAfter, 1);
  assert.deepEqual(first.results.map((entry) => entry.id), ["move-tree", "terrain", "validate"]);

  const repeated = await surface.dispatch("world.batch_command", firstRequest);
  assert.equal(repeated.requestHash, first.requestHash);
  assert.equal(repeated.revisionAfter, 1);

  const stale = await surface.dispatch("world.batch_command", batch("world-test", "stale", 0, [
    { action: "world.terrain.rebuild", args: { seed: 9 }, id: "stale-terrain" },
  ]));
  assert.equal(stale.status, "failed");
  assert.equal(stale.errors[0].code, "REVISION_CONFLICT");

  const rolledBack = await surface.dispatch("world.batch_command", batch("world-test", "rollback", 1, [
    { action: "world.object.update", args: { id: "tree-7", position: [99, 0, 99] }, id: "move-far" },
    { action: "test.fail", args: {}, id: "fail" },
  ], { onError: "rollback" }));
  assert.equal(rolledBack.status, "rolled_back");
  assert.equal(rolledBack.revisionAfter, 1);
  assert.equal(rolledBack.stateDigestAfter, rolledBack.stateDigestBefore);

  const partial = await surface.dispatch("world.batch_command", batch("world-test", "partial", 1, [
    { action: "world.object.update", args: { id: "tree-7", position: [5, 0, 5] }, id: "move-five" },
    { action: "test.fail", args: {}, id: "fail-again" },
    { action: "world.terrain.rebuild", args: { seed: 77 }, id: "skipped" },
  ]));
  assert.equal(partial.status, "partial");
  assert.equal(partial.revisionAfter, 2);
  assert.equal(partial.results[2].status, "skipped");

  const continued = await surface.dispatch("world.batch_command", batch("world-test", "continued", 2, [
    { action: "world.object.update", args: { id: "tree-7", position: [6, 0, 6] }, id: "move-six" },
    { action: "test.fail", args: {}, id: "continue-failure" },
    { action: "world.terrain.rebuild", args: { seed: 88 }, id: "continued-terrain" },
  ], { onError: "continue" }));
  assert.equal(continued.status, "partial");
  assert.equal(continued.revisionAfter, 3);
  assert.equal(continued.results[2].status, "passed");

  const dryRun = await surface.dispatch("world.batch_command", batch("world-test", "dry-run", 3, [
    { action: "world.terrain.rebuild", args: { seed: 100 }, id: "dry-terrain" },
  ], { dryRun: true }));
  assert.equal(dryRun.status, "passed");
  assert.equal(dryRun.revisionAfter, 3);

  const denied = await surface.dispatch("world.batch_command", batch("world-test", "denied", 3, [
    { action: "world.object.commit", args: { id: "tree-7" }, id: "commit" },
  ], { allowDestructive: true }));
  assert.equal(denied.status, "failed");
  assert.equal(denied.errors[0].code, "DESTRUCTIVE_ACTION_DENIED");

  const destructiveProfilePath = join(fixture.root, "destructive-profile.json");
  writeFileSync(destructiveProfilePath, JSON.stringify({
    ...JSON.parse(readFileSync(fixture.profilePath, "utf8")),
    allowDestructive: true,
  }));
  await surface.dispatch("world.session_create", {
    adapter: "nexus-headless",
    profilePath: destructiveProfilePath,
    sessionId: "destructive-world",
    targetPath: fixture.app,
  });
  const approvedDestructive = await surface.dispatch("world.batch_command", batch("destructive-world", "commit", 0, [
    { action: "world.object.commit", args: { id: "tree-7" }, id: "commit" },
  ], { allowDestructive: true }));
  assert.equal(approvedDestructive.status, "passed");

  const readOnly = await surface.dispatch("world.batch_command", batch("world-test", "read-only", 3, [
    { action: "world.observe", args: {}, id: "observe" },
  ]));
  assert.equal(readOnly.status, "passed");
  assert.equal(readOnly.revisionAfter, 3);

  await assert.rejects(
    surface.dispatch("world.batch_command", { ...firstRequest, commands: firstRequest.commands.slice(0, 1) }),
    (error) => error.code === "BATCH_ID_CONFLICT",
  );

  const concurrent = await Promise.all([
    surface.dispatch("world.batch_command", batch("world-test", "concurrent-a", 3, [
      { action: "world.terrain.rebuild", args: { seed: 101 }, id: "terrain-a" },
    ])),
    surface.dispatch("world.batch_command", batch("world-test", "concurrent-b", 3, [
      { action: "world.terrain.rebuild", args: { seed: 102 }, id: "terrain-b" },
    ])),
  ]);
  assert.equal(concurrent.filter((entry) => entry.status === "passed").length, 1);
  assert.equal(concurrent.filter((entry) => entry.errors.some((error) => error.code === "REVISION_CONFLICT")).length, 1);

  const timeout = await surface.dispatch("world.batch_command", batch("world-test", "timeout", 4, [
    { action: "test.delay", args: { ms: 50 }, id: "slow", timeoutMs: 10 },
    { action: "world.observe", args: {}, id: "timeout-skipped" },
  ]));
  assert.equal(timeout.status, "failed");
  assert.equal(timeout.errors[0].code, "TIMEOUT");
  assert.equal(timeout.results[1].status, "skipped");

  const cancellationPromise = surface.dispatch("world.batch_command", batch("world-test", "cancelled", 4, [
    { action: "test.delay", args: { ms: 100 }, id: "wait" },
    { action: "world.observe", args: {}, id: "cancel-skipped" },
  ]));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const cancellationSurface = createWorldActionSurface({ allowedRoots: [fixture.root], workspaceRoot: fixture.root });
  t.after(() => cancellationSurface.shutdown());
  assert.equal((await cancellationSurface.dispatch("world.session_cancel", { sessionId: "world-test" })).cancelled, true);
  const cancelled = await cancellationPromise;
  assert.equal(cancelled.status, "failed");
  assert.equal(cancelled.errors[0].code, "CANCELLED");
  assert.equal(cancelled.cancellation.requested, true);
  assert.equal(cancelled.cancellation.adapterInterrupted, false);
  assert.match(cancelled.cancellation.limitation, /before the next command/);

  const large = await surface.dispatch("world.batch_command", batch("world-test", "large-output", 4, [
    { action: "test.large", args: { bytes: 300000 }, id: "large" },
  ]));
  assert.equal(large.status, "passed");
  assert.equal(large.revisionAfter, 4);
  assert.equal(large.outputTruncated, true);
  assert.equal(large.artifacts.some((artifact) => artifact.uri?.endsWith("output.json")), true);
  const largeState = await surface.dispatch("world.batch_command", batch("world-test", "large-state", 4, [
    { action: "test.large-state", args: { bytes: 300000 }, id: "large-state" },
  ]));
  assert.equal(largeState.status, "passed");
  assert.equal(largeState.revisionAfter, 5);
  assert.equal(largeState.stateDiff.truncated, true);
  assert.equal(largeState.artifacts.some((artifact) => artifact.uri?.endsWith("state-diff.json")), true);
  const report = await surface.dispatch("report.get", { runId: "world-test" });
  assert.equal(JSON.stringify(report).includes(fixture.root), false);
  const reportEvidence = await surface.dispatch("report.artifacts", { runId: "world-test" });
  assert.equal(reportEvidence.artifacts.every((artifact) => artifact.uri.startsWith("nexus-sim://")), true);
  const runDir = join(fixture.root, ".simspaces", "runs", "world-test");
  for (const path of ["session.json", "manifest.json", "processes.json", "ports.json", "world-state.json", "events.jsonl", "report.json"]) {
    assert.equal(existsSync(join(runDir, path)), true, path);
  }
  assert.equal(readFileSync(join(runDir, "report.json"), "utf8").includes(fixture.root), false);
  assert.equal(readFileSync(join(runDir, "events.jsonl"), "utf8").includes(fixture.root), false);

  const rollbackRejected = await surface.dispatch("world.batch_command", batch("world-test", "rollback-rejected", 5, [
    { action: "test.no-rollback", args: {}, id: "unsafe-rollback" },
  ], { onError: "rollback" }));
  assert.equal(rollbackRejected.status, "failed");
  assert.equal(rollbackRejected.errors[0].code, "ROLLBACK_UNSUPPORTED");

  const nonAllowlisted = await surface.dispatch("world.batch_command", batch("world-test", "not-allowlisted", 5, [
    { action: "test.unlisted", args: {}, id: "unknown" },
  ]));
  assert.equal(nonAllowlisted.status, "failed");
  assert.equal(nonAllowlisted.errors[0].code, "UNKNOWN_WORLD_ACTION");

  const schemaNotApproved = await surface.dispatch("world.batch_command", batch("world-test", "schema-not-approved", 5, [
    { action: "test.schema-only", args: {}, id: "schema-only" },
  ]));
  assert.equal(schemaNotApproved.status, "failed");
  assert.equal(schemaNotApproved.errors[0].code, "UNKNOWN_WORLD_ACTION");

  const invalidArgs = await surface.dispatch("world.batch_command", batch("world-test", "invalid-args", 5, [
    { action: "test.delay", args: { ms: "slow" }, id: "bad-args" },
  ]));
  assert.equal(invalidArgs.status, "failed");
  assert.equal(invalidArgs.errors[0].code, "INVALID_ACTION_ARGS");

  const observation = await surface.dispatch("world.observe", { sessionId: "world-test" });
  assert.equal(observation.revision, 5);
  assert.equal(hash(fixture.runtimePath), sourceHash);

  await surface.shutdown();
  const recoveredSurface = createWorldActionSurface({ allowedRoots: [fixture.root], workspaceRoot: fixture.root });
  t.after(() => recoveredSurface.shutdown());
  const recovered = await recoveredSurface.dispatch("world.observe", { sessionId: "world-test" });
  assert.equal(recovered.revision, 5);
  assert.deepEqual(recovered.state.terrain.seed, observation.state.terrain.seed);

  const rollbackFailure = await recoveredSurface.dispatch("world.batch_command", batch("world-test", "rollback-failure", 5, [
    { action: "test.break-restore", args: {}, id: "break-restore" },
    { action: "test.fail", args: {}, id: "force-failure" },
  ], { onError: "rollback" }));
  assert.equal(rollbackFailure.status, "failed");
  assert.equal(rollbackFailure.revisionAfter, 6);
  assert.equal(rollbackFailure.rollback.attempted, true);
  assert.equal(rollbackFailure.rollback.succeeded, false);
  const blocked = await recoveredSurface.dispatch("world.session_status", { sessionId: "world-test" });
  assert.equal(blocked.status, "blocked");
});
