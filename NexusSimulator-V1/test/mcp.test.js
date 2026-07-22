import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { startMcpHttpServer } from "../src/mcp-server.js";

function createHeadlessFixture(workspace) {
  const app = join(workspace, "app");
  mkdirSync(app);
  writeFileSync(join(app, "runtime.mjs"), `
export function createHeadlessEditorRuntime() {
  let state = { objects: { tree: { id: "tree", position: [0, 0, 0] } } };
  return {
    listCapabilities() { return [{ id: "world.object.update" }, { id: "world.validate" }, { id: "test.large", inputSchema: { type: "object", additionalProperties: false, properties: { bytes: { type: "number" } }, required: ["bytes"] } }]; },
    getState() { return JSON.parse(JSON.stringify(state)); },
    snapshot() { return JSON.parse(JSON.stringify(state)); },
    loadSnapshot(value) { state = JSON.parse(JSON.stringify(value)); return state; },
    runScript(script) {
      const step = script.steps[0];
      if (step.action === "test.large") return { ok: true, results: [{ ok: true, data: { text: "x".repeat(step.args.bytes) } }] };
      if (step.action === "world.object.update") state.objects[step.args.id] = { ...state.objects[step.args.id], ...step.args };
      return { ok: true, results: [{ ok: true, data: state }] };
    }
  };
}
`);
  const profilePath = join(workspace, "profile.json");
  writeFileSync(profilePath, JSON.stringify({
    adapter: "nexus-headless",
    actionPolicy: { "test.large": { mutatesWorld: false, readOnly: true, replayable: true, rollback: "snapshot" } },
    actionSchemas: { "test.large": { type: "object", additionalProperties: false, properties: { bytes: { type: "number", minimum: 1 } }, required: ["bytes"] } },
    allowActions: ["world.object.update", "world.validate", "test.large"],
    modulePath: "runtime.mjs",
    schemaVersion: "nexus.execution-profile.v1",
    stageRoot: "app",
  }));
  return { app, profilePath };
}

async function runMcpWorld(client, fixture, sessionId) {
  const session = await client.callTool({
    arguments: { adapter: "nexus-headless", profilePath: fixture.profilePath, sessionId, targetPath: fixture.app },
    name: "world.session_create",
  });
  assert.equal(session.structuredContent.status, "ready");
  const result = await client.callTool({
    arguments: {
      baseRevision: 0,
      batchId: "mcp-batch",
      commands: [{ action: "world.object.update", args: { id: "tree", position: [3, 0, 2] }, id: "move" }],
      sessionId,
    },
    name: "world.batch_command",
  });
  assert.equal(result.structuredContent.status, "passed");
  assert.equal(result.structuredContent.revisionAfter, 1);
  return result.structuredContent;
}

test("stdio MCP exposes the world batch manifest without protocol noise", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "nexus-mcp-stdio-"));
  t.after(() => rmSync(workspace, { force: true, recursive: true }));
  const fixture = createHeadlessFixture(workspace);
  const client = new Client({ name: "nexus-test", version: "1" });
  const transport = new StdioClientTransport({
    args: [resolve("src/cli.js"), "mcp", "serve", "--transport", "stdio", "--workspace-root", workspace],
    command: process.execPath,
    stderr: "pipe",
  });
  t.after(async () => client.close().catch(() => {}));
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "world.batch_command"));
  assert.equal(tools.tools.some((tool) => tool.name === "world.object.update"), false);
  const result = await client.callTool({ arguments: {}, name: "harness.manifest" });
  assert.equal(result.structuredContent.batchCommand, "world.batch_command");
  await runMcpWorld(client, fixture, "stdio-world");
  const large = await client.callTool({
    arguments: {
      baseRevision: 1,
      batchId: "large-output",
      commands: [{ action: "test.large", args: { bytes: 300000 }, id: "large" }],
      sessionId: "stdio-world",
    },
    name: "world.batch_command",
  });
  assert.equal(large.structuredContent.outputTruncated, true);
  assert.equal(large.content.some((entry) => entry.type === "resource_link" && entry.uri.endsWith("output.json")), true);
  const report = await client.callTool({ arguments: { runId: "stdio-world" }, name: "report.get" });
  assert.equal(report.structuredContent.status, "passed");
});

test("Streamable HTTP MCP exposes the same action contract", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "nexus-mcp-http-"));
  t.after(() => rmSync(workspace, { force: true, recursive: true }));
  const fixture = createHeadlessFixture(workspace);
  const handle = await startMcpHttpServer({ allowedRoots: [workspace], host: "127.0.0.1", port: 0, workspaceRoot: workspace });
  t.after(() => handle.close());
  const address = handle.address;
  const client = new Client({ name: "nexus-http-test", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`));
  t.after(async () => client.close().catch(() => {}));
  await client.connect(transport);
  const result = await client.callTool({ arguments: {}, name: "harness.manifest" });
  assert.equal(result.structuredContent.transports.includes("streamable-http"), true);
  const batch = await runMcpWorld(client, fixture, "http-world");
  await client.close();

  const reconnectClient = new Client({ name: "nexus-http-reconnect", version: "1" });
  const reconnectTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`));
  t.after(async () => reconnectClient.close().catch(() => {}));
  await reconnectClient.connect(reconnectTransport);
  const persisted = await reconnectClient.callTool({
    arguments: { batchId: "mcp-batch", sessionId: "http-world" },
    name: "world.batch_status",
  });
  assert.equal(persisted.structuredContent.requestHash, batch.requestHash);
  assert.equal(persisted.structuredContent.revisionAfter, 1);
});

test("LAN MCP fails closed without token and host allowlist", async () => {
  await assert.rejects(
    () => startMcpHttpServer({ host: "0.0.0.0", port: 0 }),
    /requires NEXUS_SIM_MCP_TOKEN/,
  );
  await assert.rejects(
    () => startMcpHttpServer({ host: "0.0.0.0", port: 0, token: "x".repeat(32) }),
    /requires at least one --allowed-host/,
  );
  await assert.rejects(
    () => startMcpHttpServer({ allowedHosts: ["*"], host: "0.0.0.0", port: 0, token: "x".repeat(32) }),
    (error) => error.code === "MCP_UNSAFE_HOST_ALLOWLIST",
  );
});

test("LAN MCP requires bearer authentication and validates Host", async (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "nexus-mcp-lan-"));
  t.after(() => rmSync(workspace, { force: true, recursive: true }));
  const token = "t".repeat(32);
  const handle = await startMcpHttpServer({
    allowedHosts: ["127.0.0.1"],
    allowedRoots: [workspace],
    host: "0.0.0.0",
    port: 0,
    token,
    workspaceRoot: workspace,
  });
  t.after(() => handle.close());
  const url = `http://127.0.0.1:${handle.address.port}/mcp`;
  const missing = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(missing.status, 401);
  const invalid = await fetch(url, {
    method: "POST",
    headers: { authorization: "Bearer invalid", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(invalid.status, 401);
  const disallowedHost = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", host: "evil.example" },
    body: "{}",
  });
  assert.notEqual(disallowedHost.status, 200);
  assert.notEqual(disallowedHost.status, 401);
});
