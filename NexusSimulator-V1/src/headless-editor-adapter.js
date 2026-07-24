import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
} from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { planWorldPromptAction } from "./agent-showcase.js";
import {
  reportConsole,
  reportFailedStep,
  reportLogs,
  reportSummary,
} from "./report-service.js";
import {
  checkScenario,
  ensureEventShape,
  loadEnvRecord,
  loadScenarioEvents,
} from "./runtime.js";
import {
  runEventsInSimSpace,
  runScenarioInSimSpace,
} from "./simspace.js";
import { inspectSimtime } from "./simtimes.js";
import { validateProceduralMeshSettings } from "./procedural-mesh-program.js";
import {
  makeWorldVideo,
  recordWorldVideoReview,
  worldVideoStatus,
} from "./world-video-loop.js";

const SUPPORTED_ACTIONS = new Set([
  "simspace.run",
  "world.candidate.generate",
  "world.candidate.review",
  "world.candidate.revise",
]);

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function issue(code, message, path = null) {
  return {
    severity: "error",
    code,
    message,
    ...(path ? { path } : {}),
  };
}

function compactError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
  };
}

function commandsFromConfig(config) {
  if (Array.isArray(config.commands)) return clone(config.commands);
  if (config.command !== undefined) return [clone(config.command)];
  return [];
}

function artifactPathsFromReport(report = {}) {
  return [...new Set([
    ...(report.artifacts ?? []),
    ...(report.state?.artifacts ?? []),
    ...(report.output?.artifacts ?? []),
  ].filter(Boolean))];
}

function sourceDescriptor(env = {}, events = []) {
  const loadEvent = events.find((event) => event?.command === "loadApp");
  return {
    attachedAppPath: env.app?.attachedAppPath ?? loadEvent?.args?.attachedAppPath ?? loadEvent?.args?.path ?? null,
    appKind: env.app?.appKind ?? loadEvent?.args?.appKind ?? null,
    detectedMode: env.app?.detectedMode ?? loadEvent?.args?.detectedMode ?? null,
    launchMode: env.app?.launchMode ?? loadEvent?.args?.launchMode ?? null,
  };
}

function digestSourcePath(path) {
  if (!path || !existsSync(path)) return null;
  const root = resolve(path);
  const rootStats = lstatSync(root);
  const hash = createHash("sha256");
  const excludedRoots = new Set([".git", ".nexus-simulator", ".simspaces", "node_modules"]);

  const visit = (entry) => {
    const stats = lstatSync(entry);
    const entryRelative = relative(root, entry) || basename(entry);
    if (stats.isSymbolicLink()) {
      hash.update(`link:${entryRelative}\0${readlinkSync(entry)}\0`);
      return;
    }
    if (stats.isDirectory()) {
      for (const name of readdirSync(entry).sort()) {
        const childRelative = relative(root, join(entry, name));
        if (excludedRoots.has(childRelative.split(/[\\/]/)[0])) continue;
        visit(join(entry, name));
      }
      return;
    }
    if (stats.isFile()) {
      hash.update(`file:${entryRelative}\0`);
      hash.update(readFileSync(entry));
      hash.update("\0");
    }
  };

  if (rootStats.isFile() || rootStats.isSymbolicLink()) visit(root);
  else visit(root);
  return hash.digest("hex");
}

function sourceEvidence(source) {
  if (!source) return null;
  return {
    ...clone(source),
    sha256: digestSourcePath(source.attachedAppPath),
  };
}

function captureList(artifacts = [], prefix = "artifact") {
  return artifacts.filter(Boolean).map((path, index) => ({
    id: `${prefix}-${String(index + 1).padStart(2, "0")}`,
    path,
  }));
}

function parseViewport(viewport) {
  const match = /^(\d+)x(\d+)$/.exec(String(viewport ?? ""));
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function validateBaseCommand(commands) {
  const issues = [];
  if (commands.length !== 1) {
    issues.push(issue(
      "exactly-one-command-required",
      `A Headless Editor run requires exactly one command; received ${commands.length}.`,
      "commands",
    ));
    return issues;
  }
  const command = commands[0];
  if (!isObject(command)) {
    issues.push(issue("command-not-object", "The command must be an object.", "command"));
    return issues;
  }
  if (!SUPPORTED_ACTIONS.has(command.action)) {
    issues.push(issue(
      "unsupported-action",
      `Unsupported Headless Editor action "${command.action ?? "(missing)"}".`,
      "command.action",
    ));
  }
  if (!isObject(command.input)) {
    issues.push(issue("input-not-object", "The command input must be an object.", "command.input"));
  }
  return issues;
}

function inspectInlineSimSpace(input, issues) {
  if (!isObject(input.env)) issues.push(issue("missing-inline-env", "Inline SimSpace input requires env.", "command.input.env"));
  if (!Array.isArray(input.events) || input.events.length === 0) {
    issues.push(issue("missing-inline-events", "Inline SimSpace input requires at least one event.", "command.input.events"));
  }
  if (issues.length) return null;

  let events;
  let simtime;
  try {
    events = input.events.map(ensureEventShape);
  } catch (error) {
    issues.push(issue("invalid-inline-event", error.message, "command.input.events"));
    return null;
  }
  try {
    simtime = inspectSimtime(input.simtime ?? input.env.simtime ?? "headless");
  } catch (error) {
    issues.push(issue("unknown-simtime", error.message, "command.input.simtime"));
    return null;
  }
  const unsupported = events
    .map((event, index) => ({ command: event.command, index, supported: simtime.supports.includes(event.command) }))
    .filter((entry) => !entry.supported);
  for (const entry of unsupported) {
    issues.push(issue(
      "unsupported-event",
      `Simtime "${simtime.id}" does not support event ${entry.index + 1}: ${entry.command}.`,
      `command.input.events.${entry.index}`,
    ));
  }
  return {
    mode: "inline",
    env: clone(input.env),
    events,
    simtime,
    source: sourceDescriptor(input.env, events),
    unsupported,
  };
}

function inspectNamedSimSpace(input, issues) {
  if (typeof input.envName !== "string" || !input.envName.trim()) {
    issues.push(issue("missing-env-name", "Named SimSpace input requires envName.", "command.input.envName"));
  }
  if (typeof input.scenarioName !== "string" || !input.scenarioName.trim()) {
    issues.push(issue("missing-scenario-name", "Named SimSpace input requires scenarioName.", "command.input.scenarioName"));
  }
  if (issues.length) return null;

  try {
    const check = checkScenario(input.envName, input.scenarioName, input.simtime);
    const unsupported = check.results.filter((entry) => !entry.supported);
    for (const entry of unsupported) {
      issues.push(issue(
        "unsupported-event",
        `Simtime "${check.adapter.id}" does not support event ${entry.index + 1}: ${entry.command}.`,
        `scenario.events.${entry.index}`,
      ));
    }
    return {
      mode: "named",
      env: clone(check.env),
      events: clone(check.events),
      simtime: {
        id: check.adapter.id,
        type: check.adapter.type,
        surface: check.adapter.surface,
        supports: [...check.adapter.supports],
      },
      source: sourceDescriptor(check.env, check.events),
      unsupported,
    };
  } catch (error) {
    issues.push(issue("scenario-inspection-failed", error.message, "command.input"));
    return null;
  }
}

function inspectSimSpaceCommand(input, issues) {
  const hasNamedFields = input.envName !== undefined;
  const hasInlineFields = input.env !== undefined || input.events !== undefined;
  if (hasNamedFields && hasInlineFields) {
    issues.push(issue(
      "mixed-simspace-input",
      "Use either envName/scenarioName or inline env/events, not both.",
      "command.input",
    ));
    return null;
  }
  if (!hasNamedFields && !hasInlineFields) {
    issues.push(issue(
      "missing-simspace-input",
      "SimSpace input requires envName/scenarioName or inline env/events.",
      "command.input",
    ));
    return null;
  }
  return hasInlineFields
    ? inspectInlineSimSpace(input, issues)
    : inspectNamedSimSpace(input, issues);
}

function validateWorldGenerate(input, issues) {
  if (typeof input.prompt !== "string" || !input.prompt.trim()) {
    issues.push(issue("missing-world-prompt", "World generation requires a prompt.", "command.input.prompt"));
  }
  if (typeof input.seed !== "string" || !input.seed.trim()) {
    issues.push(issue("missing-world-seed", "World generation requires an explicit seed.", "command.input.seed"));
  }
  const viewport = parseViewport(input.viewport);
  if (!viewport || viewport.width < 720 || viewport.height < 1280 || viewport.width >= viewport.height) {
    issues.push(issue(
      "invalid-world-viewport",
      "World generation requires a portrait WIDTHxHEIGHT viewport of at least 720x1280.",
      "command.input.viewport",
    ));
  }
  if (issues.length) return null;

  try {
    const plan = planWorldPromptAction({
      prompt: input.prompt.trim(),
      seed: input.seed.trim(),
    });
    if (plan.domainPlan?.coverageLedger?.status !== "complete") {
      issues.push(issue(
        "incomplete-world-domain-coverage",
        "World domain coverage must be complete before rendering.",
        "command.input.prompt",
      ));
    }
    return { plan, viewport };
  } catch (error) {
    issues.push(issue("world-plan-failed", error.message, "command.input.prompt"));
    return null;
  }
}

function validateWorldReview(input, status, issues) {
  if (!status.current) {
    issues.push(issue("missing-current-world", "There is no current WorldFactory candidate to review.", "command.input.iterationId"));
    return null;
  }
  if (input.iterationId !== status.current.id) {
    issues.push(issue(
      "stale-world-iteration",
      `Review must target the current iteration "${status.current.id}".`,
      "command.input.iterationId",
    ));
  }
  if (!["pass", "revise", "blocked"].includes(input.decision)) {
    issues.push(issue(
      "invalid-review-decision",
      "Review decision must be pass, revise, or blocked.",
      "command.input.decision",
    ));
  }
  if (input.decision !== "pass" && (typeof input.issue !== "string" || !input.issue.trim())) {
    issues.push(issue(
      "missing-review-issue",
      "Revise and blocked decisions require a concrete issue.",
      "command.input.issue",
    ));
  }
  if (input.severity !== undefined && !["low", "medium", "high"].includes(input.severity)) {
    issues.push(issue(
      "invalid-review-severity",
      "Review severity must be low, medium, or high.",
      "command.input.severity",
    ));
  }
  return status.current;
}

function validateWorldRevision(input, status, issues) {
  if (!status.current) {
    issues.push(issue("missing-current-world", "There is no current WorldFactory candidate to revise.", "command.input.iterationId"));
    return null;
  }
  if (input.iterationId !== status.current.id) {
    issues.push(issue(
      "stale-world-iteration",
      `Revision must target the current iteration "${status.current.id}".`,
      "command.input.iterationId",
    ));
  }
  if (!Array.isArray(input.issueIds) || input.issueIds.length === 0) {
    issues.push(issue(
      "missing-revision-issues",
      "World revision requires at least one issue ID.",
      "command.input.issueIds",
    ));
  } else {
    const activeIds = new Set(status.activeIssues.map((entry) => entry.id));
    for (const [index, issueId] of input.issueIds.entries()) {
      if (!activeIds.has(issueId)) {
        issues.push(issue(
          "unknown-revision-issue",
          `World revision cannot address inactive or unknown issue "${issueId}".`,
          `command.input.issueIds.${index}`,
        ));
      }
    }
  }
  if (typeof input.change !== "string" || !input.change.trim()) {
    issues.push(issue(
      "missing-revision-change",
      "World revision requires one focused change description.",
      "command.input.change",
    ));
  }
  if (!isObject(input.settingsPatch) || Object.keys(input.settingsPatch).length === 0) {
    issues.push(issue(
      "missing-revision-settings",
      "World revision requires a non-empty settingsPatch keyed by selected object or capability ID.",
      "command.input.settingsPatch",
    ));
    return { current: status.current, plan: null, settingsPatches: null };
  }

  let plan;
  try {
    plan = planWorldPromptAction({
      prompt: status.current.prompt,
      seed: status.current.seed,
    });
    if (plan.domainPlan?.coverageLedger?.status !== "complete") {
      issues.push(issue(
        "incomplete-world-domain-coverage",
        "World domain coverage must remain complete before revision rendering.",
        "command.input.iterationId",
      ));
    }
  } catch (error) {
    issues.push(issue("world-revision-plan-failed", error.message, "command.input.iterationId"));
    return { current: status.current, plan: null, settingsPatches: null };
  }

  const selectedByKey = new Map();
  for (const selected of plan.selectedObjects) {
    selectedByKey.set(selected.id, selected);
    if (selected.capabilityId) selectedByKey.set(selected.capabilityId, selected);
  }
  const settingsPatches = {};
  for (const [key, rawPatch] of Object.entries(input.settingsPatch)) {
    const selected = selectedByKey.get(key);
    if (!selected) {
      issues.push(issue(
        "unknown-revision-object",
        `World revision cannot patch unselected object or capability "${key}".`,
        `command.input.settingsPatch.${key}`,
      ));
      continue;
    }
    if (!isObject(rawPatch) || Object.keys(rawPatch).length === 0) {
      issues.push(issue(
        "empty-revision-settings",
        `World revision settings for "${key}" must be a non-empty object.`,
        `command.input.settingsPatch.${key}`,
      ));
      continue;
    }
    try {
      settingsPatches[selected.id] = validateProceduralMeshSettings(selected.type, rawPatch);
    } catch (error) {
      issues.push(issue(
        "invalid-revision-settings",
        error.message,
        `command.input.settingsPatch.${key}`,
      ));
    }
  }
  return { current: status.current, plan, settingsPatches };
}

function inspectCommand(command, { preflight = false } = {}) {
  const commands = command === undefined ? [] : [command];
  const issues = validateBaseCommand(commands);
  if (issues.length) return { command, issues, details: null };

  const input = command.input;
  let details = null;
  if (command.action === "simspace.run") {
    details = inspectSimSpaceCommand(input, issues);
  } else {
    const status = worldVideoStatus();
    if (command.action === "world.candidate.generate") {
      details = preflight ? validateWorldGenerate(input, issues) : { status };
    } else if (command.action === "world.candidate.review") {
      details = { current: validateWorldReview(input, status, issues), status };
    } else if (command.action === "world.candidate.revise") {
      details = { ...validateWorldRevision(input, status, issues), status };
    }
  }
  return { command, issues, details };
}

function compactWorldStatus(status) {
  return {
    current: status.current,
    currentReviewable: status.currentReviewable,
    activeIssues: status.activeIssues,
    currentArtifacts: status.currentArtifacts,
    domainPlan: status.domainPlan,
    domainSaturation: status.domainSaturation,
  };
}

function compactExecution(execution) {
  if (!execution) return null;
  return {
    action: execution.action,
    artifacts: clone(execution.artifacts),
    ok: execution.ok,
    readAfter: clone(execution.readAfter),
    runId: execution.runId,
    status: execution.status,
    summary: clone(execution.summary),
  };
}

function verificationForExecution(execution) {
  if (!execution) {
    return {
      ok: false,
      checks: [{ id: "execution-exists", ok: false, detail: "No operation was submitted." }],
      readAfter: null,
    };
  }

  if (execution.action === "simspace.run") {
    const summary = execution.summary;
    const checks = [
      { id: "simspace-status", ok: summary.status === "passed", detail: summary.status },
      { id: "simspace-failed-step", ok: !summary.failedStep, detail: summary.failedStep ?? null },
      { id: "simspace-console-errors", ok: summary.consoleErrors === 0, detail: summary.consoleErrors },
      { id: "simspace-report", ok: Boolean(summary.reportPath && existsSync(summary.reportPath)), detail: summary.reportPath },
      {
        id: "simspace-source-unchanged",
        ok: Boolean(execution.sourceBefore?.sha256)
          && execution.sourceBefore.sha256 === execution.sourceAfter?.sha256,
        detail: {
          before: execution.sourceBefore?.sha256 ?? null,
          after: execution.sourceAfter?.sha256 ?? null,
        },
      },
    ];
    return {
      ok: checks.every((check) => check.ok),
      checks,
      readAfter: execution.readAfter,
    };
  }

  if (["world.candidate.generate", "world.candidate.revise"].includes(execution.action)) {
    const result = execution.raw;
    const checks = [
      {
        id: "world-domain-coverage",
        ok: result.domainPlan?.coverageLedger?.status === "complete",
        detail: result.domainPlan?.coverageLedger?.status ?? "missing",
      },
      {
        id: "blank-nexus-project",
        ok: result.nexusProject?.status === "passed",
        detail: result.nexusProject?.status ?? "missing",
      },
      {
        id: "world-technical-review",
        ok: result.technicalReview?.passed === true,
        detail: result.technicalReview?.decision ?? result.status,
      },
      {
        id: "world-native-cadence",
        ok: result.technicalReview?.checks?.some((check) => check.id === "native-capture-cadence" && check.passed) === true,
        detail: result.technicalReview?.checks?.find((check) => check.id === "native-capture-cadence")?.detail ?? "missing",
      },
    ];
    if (execution.action === "world.candidate.revise") {
      checks.push(
        {
          id: "world-revision-context-preserved",
          ok: result.prompt === result.sourceIteration?.prompt && result.seed === result.sourceIteration?.seed,
          detail: {
            promptPreserved: result.prompt === result.sourceIteration?.prompt,
            seedPreserved: result.seed === result.sourceIteration?.seed,
          },
        },
        {
          id: "world-revision-artifact-changed",
          ok: result.artifactChanged === true && result.videoSha256 !== result.sourceIteration?.videoSha256,
          detail: {
            before: result.sourceIteration?.videoSha256 ?? null,
            after: result.videoSha256 ?? null,
          },
        },
      );
    }
    return {
      ok: checks.every((check) => check.ok),
      checks,
      readAfter: execution.readAfter,
    };
  }

  return {
    ok: execution.ok,
    checks: [{ id: "world-review-recorded", ok: execution.ok, detail: execution.status }],
    readAfter: execution.readAfter,
  };
}

async function executeSimSpace(details, input, sourceBefore = null) {
  const result = details.mode === "named"
    ? await runScenarioInSimSpace(input.envName, input.scenarioName, input.simtime, { throwOnFailure: false })
    : await runEventsInSimSpace(details.env, details.events, {
      envName: details.env.name ?? "headless-inline",
      manifest: { source: "nexus-headless-editor-adapter" },
      scenarioName: input.scenarioName ?? "headless-inline",
      simtimeId: details.simtime.id,
      throwOnFailure: false,
    });
  const runId = result.manifest?.runId ?? basename(result.runDir);
  const summary = reportSummary(runId);
  const logs = reportLogs(runId);
  const console = reportConsole(runId);
  const sourceAfter = sourceEvidence(details.source);
  const sourceUnchanged = Boolean(sourceBefore?.sha256)
    && sourceBefore.sha256 === sourceAfter?.sha256;
  return {
    action: "simspace.run",
    artifacts: summary.artifacts,
    ok: summary.status === "passed" && summary.consoleErrors === 0 && !summary.failedStep && sourceUnchanged,
    raw: result,
    readAfter: {
      report: summary,
      source: sourceAfter,
    },
    runId,
    sourceAfter,
    sourceBefore,
    status: summary.status,
    summary: {
      ...summary,
      console: {
        errorCount: console.errors.length,
        logCount: console.logs.length,
      },
      logs: {
        count: logs.logs.length,
        sessionSummary: logs.sessionSummary,
      },
      source: {
        beforeSha256: sourceBefore?.sha256 ?? null,
        afterSha256: sourceAfter?.sha256 ?? null,
        unchanged: sourceUnchanged,
      },
    },
  };
}

async function executeWorldCommand(command, details = null) {
  const input = command.input;
  if (command.action === "world.candidate.generate") {
    const result = await makeWorldVideo({
      prompt: input.prompt.trim(),
      seed: input.seed.trim(),
      viewport: input.viewport,
    });
    const status = worldVideoStatus();
    return {
      action: command.action,
      artifacts: [result.currentVideo, result.harnessView, result.contactSheet, result.poster, result.manifestPath, result.reportPath].filter(Boolean),
      ok: result.technicalReview?.passed === true,
      raw: result,
      readAfter: compactWorldStatus(status),
      runId: result.iterationId,
      status: result.status,
      summary: {
        iterationId: result.iterationId,
        issueIds: result.issueIds,
        nextAction: result.nextAction,
        prompt: result.prompt,
        seed: result.seed,
        status: result.status,
      },
    };
  }
  if (command.action === "world.candidate.review") {
    const result = recordWorldVideoReview({
      area: input.area ?? "visual-quality",
      decision: input.decision,
      issue: input.issue ?? null,
      iterationId: input.iterationId,
      note: input.note ?? null,
      severity: input.severity ?? "medium",
    });
    return {
      action: command.action,
      artifacts: [],
      ok: true,
      raw: result,
      readAfter: compactWorldStatus(worldVideoStatus()),
      runId: result.reviewId,
      status: result.decision,
      summary: result,
    };
  }

  const statusBefore = worldVideoStatus();
  const current = statusBefore.current;
  const generated = await makeWorldVideo({
    addresses: input.issueIds.join(","),
    change: input.change.trim(),
    prompt: current.prompt,
    requiredDifferentFromHash: current.videoSha256,
    seed: current.seed,
    settingsPatches: details?.settingsPatches,
    viewport: current.viewport,
  });
  const result = {
    ...generated,
    sourceIteration: {
      id: current.id,
      prompt: current.prompt,
      seed: current.seed,
      videoSha256: current.videoSha256,
    },
  };
  const statusAfter = worldVideoStatus();
  return {
    action: command.action,
    artifacts: [result.currentVideo, result.harnessView, result.contactSheet, result.poster, result.manifestPath, result.reportPath].filter(Boolean),
    ok: result.technicalReview?.passed === true && result.artifactChanged === true,
    raw: result,
    readAfter: compactWorldStatus(statusAfter),
    runId: result.iterationId,
    status: result.status,
    summary: {
      addressedIssueIds: [...input.issueIds],
      change: input.change.trim(),
      iterationId: result.iterationId,
      nextAction: result.nextAction,
      prompt: result.prompt,
      seed: result.seed,
      settingsPatches: result.settingsPatches,
      sourceIterationId: current.id,
      status: result.status,
    },
  };
}

export function createNexusSimulatorHeadlessAdapter(config = {}) {
  const commands = commandsFromConfig(config);
  let beforeCapture = null;
  let execution = null;

  return {
    id: config.id ?? "nexus-simulator-headless-adapter",
    kind: "nexus-simulator",

    async read() {
      const command = commands[0];
      const inspected = inspectCommand(command);
      if (command?.action === "simspace.run") {
        const details = inspected.details;
        return {
          ok: true,
          adapter: "nexus-simulator",
          scene: details ? {
            kind: "simspace-scenario",
            mode: details.mode,
            name: command.input.scenarioName ?? details.env?.name ?? "headless-inline",
          } : null,
          hierarchy: null,
          assets: [],
          runtime: {
            action: command?.action ?? null,
            eventCount: details?.events?.length ?? 0,
            inspectionIssues: inspected.issues,
            simtime: details?.simtime ?? null,
            source: details?.source ?? null,
          },
        };
      }
      const status = worldVideoStatus();
      return {
        ok: true,
        adapter: "nexus-simulator",
        scene: status.current,
        hierarchy: status.domainPlan,
        assets: Object.values(status.currentArtifacts ?? {}).filter(Boolean),
        runtime: {
          action: command?.action ?? null,
          inspectionIssues: inspected.issues,
          world: compactWorldStatus(status),
        },
      };
    },

    async capture({ phase = "before" } = {}) {
      if (phase === "before") {
        const command = commands[0];
        if (command?.action === "simspace.run") {
          const inspected = inspectCommand(command);
          beforeCapture = {
            action: command.action,
            source: sourceEvidence(inspected.details?.source),
            artifacts: [],
          };
        } else {
          const status = worldVideoStatus();
          const artifacts = Object.values(status.currentArtifacts ?? {}).filter(Boolean);
          beforeCapture = {
            action: command?.action ?? null,
            current: status.current,
            artifacts,
          };
        }
        return {
          ok: true,
          adapter: "nexus-simulator",
          phase,
          captures: captureList(beforeCapture.artifacts, "before"),
          descriptor: clone(beforeCapture),
        };
      }

      const artifacts = execution?.artifacts ?? [];
      return {
        ok: Boolean(execution),
        adapter: "nexus-simulator",
        phase,
        captures: captureList(artifacts, "after"),
        descriptor: compactExecution(execution),
      };
    },

    async plan({ goal = "" } = {}) {
      return {
        ok: true,
        adapter: "nexus-simulator",
        goal,
        commands: clone(commands),
        notes: ["The adapter executes only the caller-provided command and does not make creative decisions."],
      };
    },

    async validate({ plan } = {}) {
      const planCommands = Array.isArray(plan?.commands) ? plan.commands : [];
      const issues = validateBaseCommand(planCommands);
      let inspected = null;
      if (issues.length === 0) {
        inspected = inspectCommand(planCommands[0], { preflight: true });
        issues.push(...inspected.issues);
      }
      return {
        ok: issues.length === 0,
        adapter: "nexus-simulator",
        planId: plan?.id ?? null,
        action: planCommands[0]?.action ?? null,
        issues,
        preflight: inspected?.details ? clone(inspected.details) : null,
      };
    },

    async submit({ plan } = {}) {
      const command = plan?.commands?.[0];
      const inspected = inspectCommand(command, { preflight: true });
      if (inspected.issues.length) {
        return {
          ok: false,
          submitted: false,
          runId: null,
          planId: plan?.id ?? null,
          issues: inspected.issues,
        };
      }
      execution = command.action === "simspace.run"
        ? await executeSimSpace(inspected.details, command.input, beforeCapture?.source)
        : await executeWorldCommand(command, inspected.details);
      return {
        ok: true,
        submitted: true,
        runId: execution.runId,
        planId: plan?.id ?? null,
        action: command.action,
      };
    },

    async observe({ submit } = {}) {
      if (!execution) {
        return {
          ok: false,
          adapter: "nexus-simulator",
          status: submit?.skipped ? "not-submitted" : "missing-execution",
          runId: null,
        };
      }
      return {
        ok: true,
        adapter: "nexus-simulator",
        action: execution.action,
        artifacts: clone(execution.artifacts),
        runId: execution.runId,
        status: execution.status,
        summary: clone(execution.summary),
      };
    },

    async verify() {
      const verification = verificationForExecution(execution);
      return {
        ...verification,
        adapter: "nexus-simulator",
        runId: execution?.runId ?? null,
      };
    },

    async observedDifferences({ readBefore, readAfter, captureBefore, captureAfter } = {}) {
      const beforeStatus = captureBefore?.descriptor?.current?.status ?? readBefore?.scene?.status ?? null;
      const afterStatus = readAfter?.current?.status ?? readAfter?.report?.status ?? execution?.status ?? null;
      const beforeArtifacts = captureBefore?.descriptor?.artifacts ?? [];
      const afterArtifacts = captureAfter?.descriptor?.artifacts ?? execution?.artifacts ?? [];
      const verification = verificationForExecution(execution);
      const structured = beforeStatus === afterStatus
        ? []
        : [{ key: "status", before: beforeStatus, after: afterStatus }];
      const sourceBefore = captureBefore?.descriptor?.source?.sha256 ?? null;
      const sourceAfter = readAfter?.source?.sha256 ?? execution?.sourceAfter?.sha256 ?? null;
      if (sourceBefore && sourceBefore !== sourceAfter) {
        structured.push({ key: "sourceSha256", before: sourceBefore, after: sourceAfter });
      }
      return {
        ok: verification.ok,
        adapter: "nexus-simulator",
        structured,
        visual: JSON.stringify(beforeArtifacts) === JSON.stringify(afterArtifacts)
          ? []
          : [{ key: "artifacts", before: beforeArtifacts, after: afterArtifacts }],
        validation: verification.checks,
        regressions: verification.checks.filter((check) => !check.ok),
        unverifiedClaims: [],
      };
    },

    getLastExecution() {
      return compactExecution(execution);
    },
  };
}

export function inspectNexusSimulatorHeadlessCommand(command, options = {}) {
  const inspected = inspectCommand(clone(command), options);
  return {
    ok: inspected.issues.length === 0,
    issues: clone(inspected.issues),
    details: clone(inspected.details),
  };
}
