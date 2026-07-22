import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cli = resolve("src/cli.js");

function invoke(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
}

test("CLI world commands share normalized batch status and exit codes", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "nexus-cli-world-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const app = join(root, "app");
  mkdirSync(app);
  writeFileSync(join(app, "runtime.mjs"), `
export function createHeadlessEditorRuntime() {
  let state = { value: 0 };
  return {
    listCapabilities() { return [{ id: "world.settings.update" }, { id: "test.fail", inputSchema: { type: "object", additionalProperties: false } }]; },
    getState() { return state; },
    snapshot() { return JSON.parse(JSON.stringify(state)); },
    loadSnapshot(value) { state = JSON.parse(JSON.stringify(value)); return state; },
    runScript(script) {
      const step = script.steps[0];
      if (step.action === "test.fail") return { ok: false, results: [{ ok: false, errors: [{ code: "EXPECTED", message: "expected" }] }] };
      state.value += 1;
      return { ok: true, results: [{ ok: true, data: state }] };
    }
  };
}
`);
  const profilePath = join(root, "profile.json");
  writeFileSync(profilePath, JSON.stringify({
    actionPolicy: { "test.fail": { mutatesWorld: true, replayable: true, rollback: "snapshot" } },
    actionSchemas: { "test.fail": { type: "object", additionalProperties: false } },
    adapter: "nexus-headless",
    allowActions: ["world.settings.update", "test.fail"],
    modulePath: "runtime.mjs",
    schemaVersion: "nexus.execution-profile.v1",
    stageRoot: "app",
  }));
  const common = ["--workspace-root", root, "--allowed-root", root];
  const created = invoke([
    "world", "session", "create", "--target", app, "--adapter", "nexus-headless", "--profile", profilePath,
    "--session-id", "cli-world", ...common,
  ]);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).status, "ready");
  assert.equal(created.stdout.includes(root), false);

  function runBatch(name, value) {
    const path = join(root, `${name}.json`);
    writeFileSync(path, JSON.stringify(value));
    return invoke(["world", "batch", "--file", path, ...common]);
  }

  const passed = runBatch("passed", {
    baseRevision: 0,
    batchId: "passed",
    commands: [{ action: "world.settings.update", args: { worldType: "forest" }, id: "update" }],
    sessionId: "cli-world",
  });
  assert.equal(passed.status, 0, passed.stderr);
  const passedResult = JSON.parse(passed.stdout);
  assert.equal(passedResult.status, "passed");
  assert.equal(passedResult.revisionAfter, 1);

  const partial = runBatch("partial", {
    baseRevision: 1,
    batchId: "partial",
    commands: [
      { action: "world.settings.update", args: { worldType: "desert" }, id: "update" },
      { action: "test.fail", args: {}, id: "fail" },
    ],
    policy: { onError: "continue" },
    sessionId: "cli-world",
  });
  assert.equal(partial.status, 2, partial.stderr);
  assert.equal(JSON.parse(partial.stdout).status, "partial");

  const rolledBack = runBatch("rolled-back", {
    baseRevision: 2,
    batchId: "rolled-back",
    commands: [
      { action: "world.settings.update", args: { worldType: "ocean" }, id: "update" },
      { action: "test.fail", args: {}, id: "fail" },
    ],
    policy: { onError: "rollback" },
    sessionId: "cli-world",
  });
  assert.equal(rolledBack.status, 3, rolledBack.stderr);
  assert.equal(JSON.parse(rolledBack.stdout).status, "rolled_back");

  const stale = runBatch("stale", {
    baseRevision: 0,
    batchId: "stale",
    commands: [{ action: "world.settings.update", args: { worldType: "stale" }, id: "update" }],
    sessionId: "cli-world",
  });
  assert.equal(stale.status, 1, stale.stderr);
  assert.equal(JSON.parse(stale.stdout).errors[0].code, "REVISION_CONFLICT");

  const status = invoke(["world", "batch", "status", "cli-world", "passed", ...common]);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).requestHash, passedResult.requestHash);
});
