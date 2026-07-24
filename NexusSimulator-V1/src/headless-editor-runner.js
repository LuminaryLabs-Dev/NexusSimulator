import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createNexusSimulatorHeadlessAdapter } from "./headless-editor-adapter.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HEADLESS_REQUEST_SCHEMA = "nexus.simulator.headless-request.v1";
const HEADLESS_RESULT_SCHEMA = "nexus.simulator.headless-result.v1";

function safeId(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "run";
}

function shortHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 10);
}

function generatedRunId(request) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `headless-${safeId(request.command?.action).slice(0, 36)}-${shortHash(request.goal)}-${timestamp}`;
}

function validateRunId(runId) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId)) {
    throw new Error("Headless request runId may contain only letters, numbers, dots, underscores, and hyphens.");
  }
  return runId;
}

function ensureEmptyWorkspace(path) {
  if (existsSync(path) && readdirSync(path).length > 0) {
    throw new Error(`Headless run workspace must be new or empty: ${path}`);
  }
  mkdirSync(path, { recursive: true });
}

function validateRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Headless request must be a JSON object.");
  }
  if (request.schemaVersion !== HEADLESS_REQUEST_SCHEMA) {
    throw new Error(`Headless request schemaVersion must be "${HEADLESS_REQUEST_SCHEMA}".`);
  }
  if (typeof request.goal !== "string" || !request.goal.trim()) {
    throw new Error("Headless request requires a human-readable goal.");
  }
  if (!request.command || typeof request.command !== "object" || Array.isArray(request.command)) {
    throw new Error("Headless request requires one command object.");
  }
  return structuredClone(request);
}

export function loadNexusSimulatorHeadlessRequest(path) {
  const requestPath = resolve(path);
  if (!existsSync(requestPath)) throw new Error(`Headless request not found: ${requestPath}`);
  return {
    path: requestPath,
    request: validateRequest(JSON.parse(readFileSync(requestPath, "utf8"))),
  };
}

export function resolveNexusEngineRoot(input = null) {
  const candidates = [
    input,
    process.env.NEXUS_ENGINE_ROOT,
    resolve(packageRoot, "..", "..", "NexusEngine"),
  ].filter(Boolean).map((path) => resolve(path));
  const root = candidates.find((path) =>
    existsSync(join(path, "src", "index.js"))
    && existsSync(join(path, "package.json")));
  if (!root) {
    throw new Error(
      "Nexus Engine was not found. Supply --nexus-engine-root, set NEXUS_ENGINE_ROOT, or place NexusEngine beside NexusSimulator.",
    );
  }
  return root;
}

async function loadNexusEngine(root) {
  const module = await import(pathToFileURL(join(root, "src", "index.js")).href);
  if (typeof module.createRealtimeGame !== "function" || typeof module.createCoreHeadlessEditorKit !== "function") {
    throw new Error("Nexus Engine does not expose createRealtimeGame and createCoreHeadlessEditorKit.");
  }
  return module;
}

function compactStages(stageResults = []) {
  return stageResults.map((entry) => ({
    stage: entry.stage,
    ok: entry.ok,
    ...(entry.error ? { error: entry.error } : {}),
  }));
}

export async function runNexusSimulatorHeadlessRequest({
  nexusEngineRoot = null,
  request,
  workspaceRoot = null,
} = {}) {
  const normalized = validateRequest(request);
  const engineRoot = resolveNexusEngineRoot(nexusEngineRoot);
  const runId = validateRunId(normalized.runId ?? generatedRunId(normalized));
  const runWorkspace = resolve(workspaceRoot ?? join(packageRoot, ".nexus-simulator", "headless-runs", runId));
  ensureEmptyWorkspace(runWorkspace);

  const {
    createCoreHeadlessEditorKit,
    createRealtimeGame,
  } = await loadNexusEngine(engineRoot);
  const engine = createRealtimeGame({
    kits: [createCoreHeadlessEditorKit()],
  });
  const adapter = createNexusSimulatorHeadlessAdapter({
    command: normalized.command,
  });
  const harness = engine.n.coreHeadlessEditor.createHarness({
    adapter,
    goal: normalized.goal.trim(),
    sessionId: runId,
    workspace: {
      kind: "file",
      root: runWorkspace,
    },
  });

  const result = await harness.run();
  const execution = adapter.getLastExecution();
  const validationPath = join(runWorkspace, "validate", "validation.json");
  const verificationPath = join(runWorkspace, "verify", "verification.json");
  const differencePath = join(runWorkspace, "observed-differences", "difference.json");
  const status = result.ok
    ? "passed"
    : existsSync(validationPath)
      ? "failed"
      : "error";

  return {
    schemaVersion: HEADLESS_RESULT_SCHEMA,
    ok: result.ok,
    status,
    runId,
    goal: normalized.goal.trim(),
    command: normalized.command,
    adapter: adapter.id,
    stages: compactStages(result.stageResults),
    execution,
    artifacts: execution?.artifacts ?? [],
    workspace: runWorkspace,
    files: {
      report: join(runWorkspace, "report.md"),
      validation: existsSync(validationPath) ? validationPath : null,
      verification: existsSync(verificationPath) ? verificationPath : null,
      differences: existsSync(differencePath) ? differencePath : null,
    },
  };
}

export const NEXUS_SIMULATOR_HEADLESS_REQUEST_SCHEMA = HEADLESS_REQUEST_SCHEMA;
export const NEXUS_SIMULATOR_HEADLESS_RESULT_SCHEMA = HEADLESS_RESULT_SCHEMA;
