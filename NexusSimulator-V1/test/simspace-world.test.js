import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareWorldSimSpace } from "../src/simspace.js";
import { createWorldActionSurface } from "../src/world-actions.js";

test("world SimSpace creates the durable run shape inside the configured workspace", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "nexus-world-space-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const app = join(root, "app");
  mkdirSync(app);
  writeFileSync(join(app, "index.html"), "<!doctype html><title>world</title>");
  const staged = await prepareWorldSimSpace({ sessionId: "shape", sourceRoot: app, targetPath: app, workspaceRoot: root });
  for (const path of [
    "app",
    "artifacts",
    "batches",
    "checkpoints",
    "logs",
    "output",
    "temp",
    "manifest.json",
    "ports.json",
    "processes.json",
  ]) assert.equal(existsSync(join(staged.runDir, path)), true, path);
  assert.equal(staged.runDir.startsWith(join(root, ".simspaces", "runs")), true);
});

test("world SimSpace rejects symlinks that escape the staged source", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "nexus-world-symlink-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const app = join(root, "app");
  mkdirSync(app);
  writeFileSync(join(app, "index.html"), "<!doctype html>");
  symlinkSync(tmpdir(), join(app, "escape"));
  await assert.rejects(
    prepareWorldSimSpace({ sessionId: "unsafe", sourceRoot: app, targetPath: app, workspaceRoot: root }),
    (error) => error.code === "SIMSPACE_SYMLINK_ESCAPE",
  );
});

test("world sessions enforce active leases and reject unsupported hard memory claims", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "nexus-world-leases-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const app = join(root, "app");
  mkdirSync(app);
  writeFileSync(join(app, "runtime.mjs"), `
export function createHeadlessEditorRuntime() {
  let state = { ready: true };
  return {
    listCapabilities() { return [{ id: "world.validate" }]; },
    runScript() { return { ok: true, results: [{ ok: true }] }; },
    getState() { return state; },
    snapshot() { return JSON.parse(JSON.stringify(state)); },
    loadSnapshot(value) { state = JSON.parse(JSON.stringify(value)); return state; }
  };
}
`);
  const profile = {
    adapter: "nexus-headless",
    allowActions: ["world.validate"],
    modulePath: "runtime.mjs",
    schemaVersion: "nexus.execution-profile.v1",
    stageRoot: "app",
  };
  const profilePath = join(root, "profile.json");
  writeFileSync(profilePath, JSON.stringify(profile));
  const hardProfilePath = join(root, "hard-profile.json");
  writeFileSync(hardProfilePath, JSON.stringify({ ...profile, resourceLimits: { memory: "hard", memoryMb: 128 } }));
  const restrictedProfilePath = join(root, "restricted-profile.json");
  writeFileSync(restrictedProfilePath, JSON.stringify({ ...profile, allowedWorkspaceRoots: ["other-apps"] }));

  const surface = createWorldActionSurface({
    allowedRoots: [root],
    idleLeaseMs: 1000,
    keepAlive: true,
    maxActiveSessions: 1,
    workspaceRoot: root,
  });
  t.after(() => surface.shutdown());
  await surface.dispatch("world.session_create", {
    adapter: "nexus-headless",
    profilePath,
    sessionId: "lease-one",
    targetPath: app,
  });
  await assert.rejects(surface.dispatch("world.session_create", {
    adapter: "nexus-headless",
    profilePath,
    sessionId: "lease-two",
    targetPath: app,
  }), (error) => error.code === "SESSION_LIMIT_REACHED");
  await surface.manager.cleanupIdleAdapters(Date.now() + 5000);
  const second = await surface.dispatch("world.session_create", {
    adapter: "nexus-headless",
    profilePath,
    sessionId: "lease-two",
    targetPath: app,
  });
  assert.equal(second.status, "ready");
  await assert.rejects(surface.dispatch("world.session_create", {
    adapter: "nexus-headless",
    profilePath: hardProfilePath,
    sessionId: "hard-memory",
    targetPath: app,
  }), (error) => error.code === "HARD_MEMORY_BOUNDARY_UNAVAILABLE");
  await assert.rejects(surface.dispatch("world.session_create", {
    adapter: "nexus-headless",
    profilePath: restrictedProfilePath,
    sessionId: "restricted",
    targetPath: app,
  }), (error) => error.code === "PROFILE_WORKSPACE_DENIED");

  const packageRoot = join(app, "node_modules", "demo-headless");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ exports: "./runtime.mjs", name: "demo-headless", type: "module", version: "1.0.0" }));
  writeFileSync(join(packageRoot, "runtime.mjs"), `
export function createHeadlessEditorRuntime() {
  let state = { packageRuntime: true };
  return {
    listCapabilities() { return [{ id: "world.validate" }]; },
    runScript() { return { ok: true, results: [{ ok: true }] }; },
    getState() { return state; }, snapshot() { return state; },
    loadSnapshot(value) { state = value; return state; }
  };
}
`);
  const specifierProfilePath = join(root, "specifier-profile.json");
  writeFileSync(specifierProfilePath, JSON.stringify({
    adapter: "nexus-headless",
    allowActions: ["world.validate"],
    moduleSpecifier: "demo-headless",
    schemaVersion: "nexus.execution-profile.v1",
    stageRoot: "app",
  }));
  const specifierSurface = createWorldActionSurface({ allowedRoots: [root], workspaceRoot: root });
  t.after(() => specifierSurface.shutdown());
  const packageSession = await specifierSurface.dispatch("world.session_create", {
    adapter: "nexus-headless",
    profilePath: specifierProfilePath,
    sessionId: "package-runtime",
    targetPath: app,
  });
  assert.equal(packageSession.status, "ready");
});
