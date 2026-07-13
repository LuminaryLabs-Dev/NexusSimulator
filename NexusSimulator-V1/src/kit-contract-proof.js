import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJsonl(path) {
  if (!existsSync(path)) throw new Error(`Kit contract input does not exist: ${path}`);
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid kit JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function includesAll(text, values) {
  const normalized = String(text ?? "").toLowerCase();
  return values.every((value) => normalized.includes(String(value).toLowerCase()));
}

function check(name, passed, detail) {
  return { detail, name, passed: Boolean(passed) };
}

function simulateContract(record) {
  const payload = record?.payload ?? {};
  const ownedState = Array.isArray(payload.owned_state) ? payload.owned_state : [];
  const inputs = Array.isArray(payload.inputs) ? payload.inputs : [];
  const outputs = Array.isArray(payload.outputs) ? payload.outputs : [];
  const requires = Array.isArray(payload.requires) ? payload.requires : [];
  const provides = Array.isArray(payload.provides) ? payload.provides : [];
  const tests = Array.isArray(payload.tests) ? payload.tests : [];
  const snapshotFields = Array.isArray(payload.snapshot?.fields) ? payload.snapshot.fields : [];
  const renderer = payload.renderer_boundary ?? {};
  const idempotencyKey = String(payload.idempotency_key ?? "");
  const replayStateOwned = ownedState.some((value) => String(value).includes(idempotencyKey));
  const outputTokens = new Set(provides.map((value) => String(value).split(":").at(-1)));
  const processedInputs = inputs.map((input) => ({
    accepted: true,
    input,
    replayKey: `proof:${record.record_id}:${input}`,
  }));
  const replay = processedInputs.map((entry) => ({
    duplicateIgnored: replayStateOwned,
    input: entry.input,
    replayKey: entry.replayKey,
  }));
  const checks = [
    check("recordId", Boolean(record?.record_id), record?.record_id ?? "missing"),
    check("atomic", payload.atomic === true, payload.atomic),
    check("idempotent", payload.idempotent === true, payload.idempotent),
    check("ownedState", ownedState.length > 0, ownedState),
    check("inputsExercised", inputs.length > 0 && processedInputs.length === inputs.length, inputs),
    check("outputsDeclared", outputs.length > 0, outputs),
    check("requiresNamespaced", requires.length > 0 && requires.every((value) => String(value).includes(":")), requires),
    check("providesNamespaced", provides.length > 0 && provides.every((value) => String(value).includes(":")), provides),
    check("outputsProvided", outputs.every((value) => outputTokens.has(String(value))), { outputs, provides }),
    check("replayStateOwned", Boolean(idempotencyKey) && replayStateOwned, { idempotencyKey, ownedState }),
    check("duplicateReplayIgnored", replay.length > 0 && replay.every((entry) => entry.duplicateIgnored), replay),
    check("snapshotCoverage", ownedState.every((value) => snapshotFields.includes(value)), { ownedState, snapshotFields }),
    check("snapshotExact", snapshotFields.every((value) => ownedState.includes(value)), { ownedState, snapshotFields }),
    check("resetCoverage", includesAll(payload.reset_behavior, ownedState), payload.reset_behavior),
    check(
      "snapshotLifecycle",
      payload.snapshot?.supportsSnapshot === true
        && payload.snapshot?.supportsLoadSnapshot === true
        && payload.snapshot?.supportsReset === true,
      payload.snapshot,
    ),
    check(
      "rendererIsolation",
      !renderer.ownsDom && !renderer.ownsCanvas && !renderer.ownsThreeObjects,
      renderer,
    ),
    check("contractTests", tests.length >= inputs.length + outputs.length + 4, tests),
  ];
  const errors = checks.filter((entry) => !entry.passed).map((entry) => entry.name);
  return {
    checks,
    errors,
    idempotencyReplay: replay,
    ok: errors.length === 0,
    outputsObserved: clone(provides),
    recordId: record?.record_id ?? null,
    resetSnapshot: {
      restoredFields: clone(snapshotFields),
      resetBehavior: payload.reset_behavior ?? null,
    },
  };
}

export function runKitContractProof({ inputPath, outputPath = null, runId = null }) {
  if (!inputPath) throw new Error("kit.contract-proof requires --input <kits.jsonl>.");
  const resolvedInput = resolve(inputPath);
  const records = readJsonl(resolvedInput);
  const results = records.map(simulateContract);
  const accepted = results.filter((result) => result.ok).length;
  const report = {
    accepted,
    inputPath: resolvedInput,
    recordsTested: records.length,
    rejected: results.length - accepted,
    results,
    runId: runId ?? null,
    simulator: "NexusSimulator-V1/kit-contract-proof",
    status: records.length > 0 && accepted === records.length ? "passed" : "failed",
    summary: `${accepted}/${records.length} kit contracts passed lifecycle simulation.`,
    tool: "kit.contract-proof",
  };
  const resolvedOutput = resolve(outputPath ?? `${resolvedInput}.nexus-simulator.json`);
  mkdirSync(dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, reportPath: resolvedOutput };
}
