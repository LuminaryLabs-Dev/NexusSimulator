import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { detectApp } from "./app-detection.js";
import { checkScenario } from "./runtime.js";
import { runEventsInSimSpace, runScenarioInSimSpace } from "./simspace.js";
import { inspectTool, listTools, toolForMedium } from "./tool-catalog.js";

function checkNames(report) {
  return report.state?.checks ?? report.output?.checks ?? [];
}

function artifacts(report) {
  return [...new Set([
    ...(report.state?.artifacts ?? []),
    ...(report.output?.artifacts ?? []),
  ])];
}

function consoleErrors(report) {
  return report.state?.consoleErrors ?? report.output?.consoleErrors ?? [];
}

function fileByName(paths, name) {
  return paths.find((path) => basename(path) === name) ?? null;
}

function filesDiffer(left, right) {
  if (!left || !right || !existsSync(left) || !existsSync(right)) return false;
  return !readFileSync(left).equals(readFileSync(right));
}

function failedStep(report) {
  if (report.error) {
    return {
      command: null,
      detail: report.error,
      name: "error",
    };
  }
  const failed = checkNames(report).find((check) => check.passed === false);
  if (!failed) return null;
  return {
    command: null,
    detail: failed.detail ?? "",
    name: failed.name ?? "failedCheck",
  };
}

function hasPassedCheck(report, name) {
  return checkNames(report).some((check) => check.name === name && check.passed !== false);
}

function buildInteractionProofEvents(detection) {
  const canvasLike = ["aframe", "canvas", "threejs"].includes(detection.detectedMode);
  return [
    {
      command: "loadApp",
      args: {
        appKind: detection.appKind,
        attachedAppPath: detection.targetPath,
        detectedMode: detection.detectedMode,
        launchMode: detection.launchMode,
        path: detection.targetPath,
      },
    },
    { command: "startServer", args: { timeoutMs: detection.launchMode === "dev-server" ? 30000 : 10000 } },
    { command: "openPage", args: {} },
    { command: "waitForSelector", args: { selector: "body", timeoutMs: 10000 } },
    { command: "assertFrameRendered", args: {} },
    ...(canvasLike ? [{ command: "assertCanvasExists", args: {} }] : []),
    { command: "captureScreenshot", args: { name: "interaction-proof-before.png" } },
    { command: "getConsoleLogs", args: {} },
    { command: "moveMouse", args: { x: 64, y: 64 } },
    { command: "wheel", args: { deltaX: 0, deltaY: 120 } },
    { command: "pressKey", args: { key: "Tab" } },
    { command: "pressKey", args: { key: "Escape" } },
    { command: "wait", args: { ms: 250 } },
    { command: "assertStillResponsive", args: {} },
    { command: "captureScreenshot", args: { name: "interaction-proof-after.png" } },
    { command: "assertNoConsoleErrors", args: {} },
    { command: "getConsoleLogs", args: {} },
    { command: "summarizeSession", args: {} },
    { command: "stopServer", args: {} },
  ];
}

function normalizeInteractionProof(result, tool, interactionMode) {
  const report = result.report;
  const reportArtifacts = artifacts(report);
  const before = fileByName(reportArtifacts, "interaction-proof-before.png");
  const after = fileByName(reportArtifacts, "interaction-proof-after.png");
  const visualChanged = filesDiffer(before, after);
  const errors = consoleErrors(report);
  const failed = failedStep(report);
  const rendered = hasPassedCheck(report, "frameRendered") && hasPassedCheck(report, "pageOpened");
  const inputDelivered = hasPassedCheck(report, "moveMouse")
    && hasPassedCheck(report, "wheel")
    && checkNames(report).filter((check) => check.name === "pressKey" && check.passed !== false).length >= 2;

  let status = "inconclusive";
  if (report.error || failed || errors.length > 0 || report.status === "failed") {
    status = "failed";
  } else if (rendered && inputDelivered && visualChanged) {
    status = "passed";
  }

  const summary = status === "passed"
    ? "Rendered, accepted safe input, changed visual state, and reported no console errors."
    : status === "failed"
      ? "Interaction proof failed; inspect failedStep, consoleErrors, and artifacts."
      : "Rendered and accepted safe input, but auto-safe mode did not prove a visual or DOM response.";

  return {
    artifacts: reportArtifacts,
    consoleErrors: errors,
    failedStep: failed,
    nextSuggestedAction: status === "inconclusive"
      ? "Run an explicit selector proof for stronger interaction validation."
      : status === "failed"
        ? "Inspect the failed step, screenshot artifacts, and console output."
        : "Run file-output validation if this app writes artifacts.",
    proof: {
      interactionMode,
      inputDelivered,
      rendered,
      visualChanged,
    },
    status,
    summary,
    tool: tool.id,
  };
}

function writeEnhancedReport(runDir, report) {
  const path = join(runDir, "report.json");
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

export function listToolActions() {
  return listTools();
}

export function inspectToolAction(id) {
  return inspectTool(id);
}

export async function validateScenarioAction({ envName, scenarioName, simtime }) {
  const check = checkScenario(envName, scenarioName, simtime);
  const unsupported = check.results.filter((entry) => !entry.supported);
  if (unsupported.length) {
    return {
      adapter: check.adapter,
      check,
      supported: false,
      unsupported,
    };
  }

  const result = await runScenarioInSimSpace(envName, scenarioName, simtime);
  return {
    adapter: check.adapter,
    check,
    report: result.report,
    reportPath: join(result.runDir, "report.json"),
    runDir: result.runDir,
    supported: true,
  };
}

export async function validateTargetAction({ interactionMode = "auto-safe", medium = null, targetPath, toolId = null }) {
  const tool = toolId ? inspectTool(toolId) : toolForMedium(medium);
  if (tool.id !== "interaction.proof") {
    throw new Error(`Unsupported V2 validation tool "${tool.id}".`);
  }
  if (interactionMode !== "auto-safe") {
    throw new Error(`Unsupported interaction mode "${interactionMode}". V2 currently supports auto-safe only.`);
  }

  const detection = detectApp(targetPath);
  if (!["dev-server", "static"].includes(detection.launchMode)) {
    throw new Error(`interaction.proof requires a static HTML or dev-server web app. Detected launchMode=${detection.launchMode}.`);
  }

  const events = buildInteractionProofEvents(detection);
  const env = {
    app: {
      appKind: detection.appKind,
      attachedAppPath: detection.targetPath,
      confidence: detection.confidence,
      detectedMode: detection.detectedMode,
      launchMode: detection.launchMode,
      selectedSimtime: tool.defaultSimtime,
    },
    createdAt: new Date().toISOString(),
    name: `target-${basename(detection.targetPath).replace(/[^a-zA-Z0-9]+/g, "-") || "app"}`,
    simtime: tool.defaultSimtime,
  };

  const result = await runEventsInSimSpace(env, events, {
    manifest: {
      interactionMode,
      medium: tool.medium,
      tool: tool.id,
    },
    scenarioName: "interaction-proof",
    simtimeId: tool.defaultSimtime,
    throwOnFailure: false,
  });

  const normalized = normalizeInteractionProof(result, tool, interactionMode);
  const enhancedReport = {
    ...result.report,
    artifacts: normalized.artifacts,
    consoleErrors: normalized.consoleErrors,
    failedStep: normalized.failedStep,
    interactionMode,
    medium: tool.medium,
    nextSuggestedAction: normalized.nextSuggestedAction,
    proof: normalized.proof,
    reportPath: join(result.runDir, "report.json"),
    status: normalized.status,
    summary: normalized.summary,
    tool: tool.id,
  };
  const reportPath = writeEnhancedReport(result.runDir, enhancedReport);

  return {
    artifacts: normalized.artifacts,
    consoleErrors: normalized.consoleErrors,
    failedStep: normalized.failedStep,
    nextSuggestedAction: normalized.nextSuggestedAction,
    reportPath,
    runDir: result.runDir,
    runId: basename(result.runDir),
    status: normalized.status,
    summary: normalized.summary,
    tool: tool.id,
  };
}
