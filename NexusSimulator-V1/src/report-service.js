import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const runsDir = resolve(process.cwd(), ".simspaces", "runs");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function reportPathForRun(runId) {
  const path = resolve(runId);
  if (existsSync(path) && path.endsWith(".json")) return path;
  return join(runsDir, runId, "report.json");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function checksFromReport(report) {
  return report.state?.checks ?? report.output?.checks ?? [];
}

function artifactsFromReport(report) {
  return unique([
    ...(report.artifacts ?? []),
    ...(report.state?.artifacts ?? []),
    ...(report.output?.artifacts ?? []),
  ]);
}

function consoleErrorsFromReport(report) {
  return report.consoleErrors ?? report.state?.consoleErrors ?? report.output?.consoleErrors ?? [];
}

function consoleLogsFromReport(report) {
  return report.state?.consoleLogs ?? report.output?.consoleLogs ?? [];
}

function failedStepFromReport(report) {
  if (report.failedStep) return report.failedStep;
  if (report.error) return { command: null, detail: report.error, name: "error" };
  const failedCheck = checksFromReport(report).find((check) => check.passed === false);
  if (!failedCheck) return null;
  return {
    command: null,
    detail: failedCheck.detail ?? "",
    name: failedCheck.name ?? "failedCheck",
  };
}

export function loadReport(runId) {
  const path = reportPathForRun(runId);
  if (!existsSync(path)) {
    throw new Error(`Unknown report for run "${runId}". Expected ${path}`);
  }
  return {
    path,
    report: readJson(path),
  };
}

export function listReports() {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .filter((runId) => existsSync(join(runsDir, runId, "report.json")))
    .sort();
}

export function reportSummary(runId) {
  const { path, report } = loadReport(runId);
  const artifacts = artifactsFromReport(report);
  const consoleErrors = consoleErrorsFromReport(report);
  return {
    artifacts,
    artifactCount: artifacts.length,
    completedAt: report.completedAt ?? null,
    consoleErrors: consoleErrors.length,
    failedStep: failedStepFromReport(report),
    nextSuggestedAction: report.nextSuggestedAction ?? null,
    reportPath: path,
    runDir: report.runDir ?? null,
    runId: report.runId ?? report.run_id ?? (report.runDir ? basename(report.runDir) : runId),
    simtime: report.simtimeId ?? report.output?.simtime ?? null,
    status: report.status ?? "unknown",
    summary: report.summary ?? null,
    tool: report.tool ?? null,
  };
}

export function reportArtifacts(runId) {
  return artifactsFromReport(loadReport(runId).report);
}

export function reportConsole(runId) {
  const { report } = loadReport(runId);
  return {
    errors: consoleErrorsFromReport(report),
    logs: consoleLogsFromReport(report),
  };
}

export function reportLogs(runId) {
  const { report } = loadReport(runId);
  return {
    logs: report.state?.logs ?? report.output?.logs ?? [],
    sessionSummary: report.state?.sessionSummary ?? report.output?.sessionSummary ?? "",
  };
}

export function reportFailedStep(runId) {
  return failedStepFromReport(loadReport(runId).report);
}
