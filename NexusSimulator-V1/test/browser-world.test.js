import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createForestShowcaseHtml } from "../src/forest-showcase.js";
import { createWorldActionSurface } from "../src/world-actions.js";

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("browser world batch updates the staged forest and leaves source unchanged", { timeout: 240000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "nexus-browser-world-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const app = join(root, "app");
  const vendor = join(app, "vendor");
  mkdirSync(vendor, { recursive: true });
  const profile = JSON.parse(readFileSync(resolve("profiles/world-factory-forest.json"), "utf8"));
  const indexPath = join(app, "index.html");
  writeFileSync(indexPath, createForestShowcaseHtml(profile));
  for (const name of ["three.module.js", "three.core.js"]) {
    copyFileSync(resolve("node_modules/three/build", name), join(vendor, name));
  }
  const executionProfilePath = join(root, "browser-profile.json");
  writeFileSync(executionProfilePath, JSON.stringify({
    adapter: "browser",
    launch: { timeoutMs: 30000, urlPath: "/?editor=1", waitPath: "/" },
    schemaVersion: "nexus.execution-profile.v1",
    stageRoot: "app",
  }));
  const sourceDigest = digest(indexPath);
  const surface = createWorldActionSurface({ allowedRoots: [root], workspaceRoot: root, keepAlive: true });
  t.after(() => surface.shutdown());

  const session = await surface.dispatch("world.session_create", {
    adapter: "browser",
    profilePath: executionProfilePath,
    sessionId: "browser-world",
    targetPath: app,
  });
  assert.equal(session.revision, 0);
  const result = await surface.dispatch("world.batch_command", {
    baseRevision: 0,
    batchId: "browser-pass",
    commands: [
      { action: "world.object.select", args: { id: "terrain-patch" }, id: "select" },
      { action: "world.object.update", args: { id: "terrain-patch", position: [2, 0, 3] }, id: "move" },
      { action: "world.validate", args: { id: "terrain-patch" }, id: "validate" },
      { action: "world.capture", args: { name: "browser-world.png" }, id: "capture" },
    ],
    policy: { checkpointBefore: true, dryRun: false, onError: "stop" },
    sessionId: "browser-world",
  });
  assert.equal(result.status, "passed");
  assert.equal(result.revisionAfter, 1);
  assert.equal(result.artifacts.some((artifact) => artifact.uri?.endsWith("browser-world.png")), true);
  const runDir = join(root, ".simspaces", "runs", "browser-world");
  const beforeScreenshot = join(runDir, "artifacts", "browser-pass-before.png");
  const afterScreenshot = join(runDir, "artifacts", "browser-pass-after.png");
  assert.equal(existsSync(beforeScreenshot), true);
  assert.equal(existsSync(afterScreenshot), true);
  assert.notEqual(digest(beforeScreenshot), digest(afterScreenshot));
  const consoleEvidence = JSON.parse(readFileSync(join(runDir, "logs", "console.json"), "utf8"));
  assert.deepEqual(consoleEvidence.errors, []);
  const observation = await surface.dispatch("world.observe", { sessionId: "browser-world" });
  const terrain = observation.state.overrides.find((_, index) => profile.steps[index].id === "terrain-patch");
  assert.deepEqual(terrain.position, [2, 0, 3]);
  assert.equal(digest(indexPath), sourceDigest);

  const rollback = await surface.dispatch("world.batch_command", {
    baseRevision: 1,
    batchId: "browser-rollback",
    commands: [
      { action: "world.object.update", args: { id: "terrain-patch", position: [8, 0, 8] }, id: "move-again" },
      { action: "world.object.update", args: { id: "terrain-patch", scale: [1, 2, 1] }, id: "bad-scale" },
    ],
    policy: { checkpointBefore: true, dryRun: false, onError: "rollback" },
    sessionId: "browser-world",
  });
  assert.equal(rollback.status, "rolled_back");
  assert.equal(rollback.revisionAfter, 1);
  assert.equal(result.artifacts.some((artifact) => artifact.uri?.endsWith("browser-pass-before.png")), true);
  assert.equal(result.artifacts.some((artifact) => artifact.uri?.endsWith("browser-pass-after.png")), true);
});

test("browser world command server is isolated, logged, and stopped with the session", { timeout: 240000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "nexus-browser-process-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const app = join(root, "app");
  const vendor = join(app, "vendor");
  mkdirSync(vendor, { recursive: true });
  const showcaseProfile = JSON.parse(readFileSync(resolve("profiles/world-factory-forest.json"), "utf8"));
  writeFileSync(join(app, "index.html"), createForestShowcaseHtml(showcaseProfile));
  for (const name of ["three.module.js", "three.core.js"]) {
    copyFileSync(resolve("node_modules/three/build", name), join(vendor, name));
  }
  writeFileSync(join(app, "server.mjs"), `
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
const types = { ".html": "text/html", ".js": "text/javascript" };
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const path = pathname === "/" ? "index.html" : pathname.slice(1);
  response.setHeader("content-type", types[extname(path)] || "application/octet-stream");
  createReadStream(join(process.cwd(), path)).on("error", () => { response.statusCode = 404; response.end(); }).pipe(response);
});
server.listen(Number(process.env.PORT), "127.0.0.1", () => console.log("world server ready"));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`);
  const profilePath = join(root, "browser-profile.json");
  writeFileSync(profilePath, JSON.stringify({
    adapter: "browser",
    launch: { command: ["node", "server.mjs"], cwd: ".", timeoutMs: 30000, urlPath: "/?editor=1", waitPath: "/" },
    resourceLimits: { memory: "best-effort", memoryMb: 512 },
    schemaVersion: "nexus.execution-profile.v1",
    stageRoot: "app",
  }));
  const surface = createWorldActionSurface({ allowedRoots: [root], keepAlive: true, workspaceRoot: root });
  t.after(() => surface.shutdown());
  await surface.dispatch("world.session_create", {
    adapter: "browser",
    profilePath,
    sessionId: "browser-process",
    targetPath: app,
  });
  const runDir = join(root, ".simspaces", "runs", "browser-process");
  const running = JSON.parse(readFileSync(join(runDir, "processes.json"), "utf8"));
  assert.equal(running.length, 1);
  assert.equal(running[0].status, "running");
  assert.equal(running[0].memory.limitMb, 512);
  const pid = running[0].pid;
  process.kill(pid, 0);
  await surface.dispatch("world.session_close", { sessionId: "browser-process" });
  const stopped = JSON.parse(readFileSync(join(runDir, "processes.json"), "utf8"));
  assert.equal(stopped[0].status, "stopped");
  assert.throws(() => process.kill(pid, 0), (error) => error.code === "ESRCH");
  assert.equal(existsSync(join(runDir, "logs", "runtime.json")), true);
  assert.equal(existsSync(join(runDir, "logs", "console.json")), true);
  assert.equal(readFileSync(join(runDir, "report.json"), "utf8").includes(root), false);
});
