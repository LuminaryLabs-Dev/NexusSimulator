import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { factoryRunExists, factoryRunPath, initFactoryRun, runFactory } from "./factory.js";
import { loadFactoryConfig } from "./factory-profiles.js";
import { runEventsInSimSpace } from "./simspace.js";

function slug(value) {
  return String(value ?? "scene-proof")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "scene-proof";
}

function defaultRunId() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `scene-proof-${timestamp}`;
}

function filesUnder(root) {
  const entries = [];
  const visit = (path) => {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name);
      if (statSync(child).isDirectory()) visit(child);
      else entries.push(child);
    }
  };
  visit(root);
  return entries;
}

function digestDirectory(root) {
  const hash = createHash("sha256");
  for (const path of filesUnder(root)) {
    hash.update(relative(root, path));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function reportChecks(report) {
  return report.state?.checks ?? report.output?.checks ?? [];
}

function reportArtifacts(report) {
  return [...new Set([
    ...(report.state?.artifacts ?? []),
    ...(report.output?.artifacts ?? []),
  ])];
}

function reportErrors(report) {
  return report.state?.consoleErrors ?? report.output?.consoleErrors ?? [];
}

function failedStep(report) {
  if (report.error) return { command: null, detail: report.error, name: "error" };
  const failed = reportChecks(report).find((check) => check.passed === false);
  return failed ? { command: null, detail: failed.detail ?? "", name: failed.name ?? "failedCheck" } : null;
}

function parseViewport(viewport) {
  const [widthRaw, heightRaw] = String(viewport ?? "1280x720").split("x");
  const width = Math.max(320, Math.round(Number(widthRaw) || 1280));
  const height = Math.max(320, Math.round(Number(heightRaw) || 720));
  return { height, width };
}

function buildEvents({ buildDurationSeconds, expectedHash, fps, minTerrainVertices, minTreeCount, viewport }) {
  const buildDurationMs = Math.ceil((buildDurationSeconds + 0.2) * 1000);
  const buildSteps = 8;
  const stepSeconds = buildDurationSeconds / buildSteps;
  const visibleBuild = (label) => Array.from({ length: buildSteps }, (_, index) => [
    { command: "advanceSimTime", args: { seconds: stepSeconds, input: { captureMode: "deterministic", fps, view: `${label}-${index + 1}` } } },
    { command: "wait", args: { ms: Math.round(stepSeconds * 1000) } },
  ]).flat();
  return [
    { command: "startServer", args: { timeoutMs: 10000 } },
    { command: "openPage", args: { waitUntil: "domcontentloaded" } },
    { command: "resizeViewport", args: viewport },
    { command: "waitForSelector", args: { selector: "[data-action='build-scene']", timeoutMs: 10000 } },
    { command: "assertCanvasExists", args: {} },
    { command: "assertGlobalState", args: { path: "build.phase", operator: "===", value: "idle" } },
    { command: "captureScreenshot", args: { name: "scene-proof-idle.png", fullPage: false } },
    { command: "recordVideo", args: { captureMode: "deterministic", fps, name: "scene-build-proof.webm", durationMs: buildDurationMs * 2 + 2400 } },
    { command: "click", args: { selector: "[data-action='build-scene']" } },
    ...visibleBuild("initial-build"),
    { command: "assertGlobalState", args: { path: "build.phase", operator: "===", value: "complete" } },
    { command: "assertGlobalState", args: { path: "terrain.vertexCount", operator: ">=", value: minTerrainVertices } },
    { command: "assertGlobalState", args: { path: "forest.treeCount", operator: ">=", value: minTreeCount } },
    { command: "assertGlobalState", args: { path: "scene.actualHash", operator: "===", value: expectedHash } },
    { command: "captureScreenshot", args: { name: "scene-proof-built.png", fullPage: false } },
    { command: "moveMouse", args: { x: Math.round(viewport.width * 0.7), y: Math.round(viewport.height * 0.52) } },
    { command: "wheel", args: { deltaX: 0, deltaY: -320 } },
    { command: "assertGlobalState", args: { path: "camera.zoomEvents", operator: ">=", value: 1 } },
    { command: "assertGlobalState", args: { path: "camera.distance", operator: "<", value: 19 } },
    { command: "captureScreenshot", args: { name: "scene-proof-zoomed.png", fullPage: false } },
    { command: "click", args: { selector: "[data-action='build-scene']" } },
    ...visibleBuild("rebuild"),
    { command: "assertGlobalState", args: { path: "build.rebuildCount", operator: "===", value: 1 } },
    { command: "assertGlobalState", args: { path: "scene.actualHash", operator: "===", value: expectedHash } },
    { command: "captureScreenshot", args: { name: "scene-proof-rebuilt.png", fullPage: false } },
    { command: "advanceSimTime", args: { seconds: 1.2, input: { captureMode: "deterministic", fps, view: "final-showcase" } } },
    { command: "wait", args: { ms: 1200 } },
    { command: "assertSmoothFrameTelemetry", args: { maxDroppedFrames: 0, minFps: Math.max(24, Math.floor(fps * 0.8)), minFrames: Math.floor(buildDurationSeconds * fps * 2) } },
    { command: "assertStillResponsive", args: {} },
    { command: "assertNoConsoleErrors", args: {} },
    { command: "getConsoleLogs", args: {} },
    { command: "summarizeSession", args: {} },
    { command: "stopServer", args: {} },
  ];
}

export async function runSceneBuildProofAction(options = {}) {
  if (!options.profilePath) throw new Error("scene.build-proof requires --profile <path>.");
  const profilePath = resolve(options.profilePath);
  const loaded = loadFactoryConfig(profilePath);
  if (loaded.config.factory !== "SceneFactory") {
    throw new Error(`scene.build-proof requires a SceneFactory profile. Received ${loaded.config.factory ?? "unknown"}.`);
  }

  const runId = slug(options.runId ?? defaultRunId());
  const fps = Math.max(1, Math.min(60, Math.round(Number(options.fps ?? 30))));
  const viewport = parseViewport(options.viewport);
  if (factoryRunExists(runId)) {
    const existingGoal = JSON.parse(readFileSync(join(factoryRunPath(runId), "goal.json"), "utf8"));
    if (JSON.stringify(existingGoal.factoryConfig ?? null) !== JSON.stringify(loaded.config)) {
      throw new Error(`Factory run "${runId}" already exists with a different profile. Choose a new --run-id.`);
    }
  } else {
    initFactoryRun(runId, { configPath: profilePath });
  }
  const generated = runFactory(runId);
  const manifest = generated.manifest;
  const previewDir = join(generated.root, "build", "preview");
  if (!existsSync(join(previewDir, "index.html"))) {
    throw new Error(`SceneFactory did not produce a preview at ${previewDir}.`);
  }

  const sourceDigestBefore = digestDirectory(previewDir);
  const minTerrainVertices = Number(loaded.config.settings?.proofMinTerrainVertices ?? manifest.terrain?.vertexCount ?? 1);
  const minTreeCount = Number(loaded.config.settings?.proofMinTreeCount ?? manifest.scene?.treeCount ?? 1);
  const buildDurationSeconds = Number(manifest.scene?.buildDurationSeconds ?? 4);
  const expectedHash = manifest.scene?.expectedHash;
  const events = buildEvents({
    buildDurationSeconds,
    expectedHash,
    fps,
    minTerrainVertices,
    minTreeCount,
    viewport,
  });
  const env = {
    app: {
      appKind: "threejs",
      attachedAppPath: previewDir,
      confidence: 1,
      detectedMode: "threejs",
      launchMode: "static",
      selectedSimtime: "playwright",
    },
    createdAt: new Date().toISOString(),
    name: `scene-${runId}`,
    simtime: "playwright",
  };
  const result = await runEventsInSimSpace(env, events, {
    manifest: {
      factoryRunId: runId,
      medium: "browser",
      profilePath,
      tool: "scene.build-proof",
    },
    scenarioName: "scene-build-proof",
    simtimeId: "playwright",
    throwOnFailure: false,
  });
  const sourceDigestAfter = digestDirectory(previewDir);
  const sourceUntouched = sourceDigestBefore === sourceDigestAfter;
  const checks = reportChecks(result.report);
  const consoleErrors = reportErrors(result.report);
  const simtimePassed = result.report.status === "passed" && checks.every((check) => check.passed !== false);
  const status = simtimePassed && sourceUntouched ? "passed" : "failed";
  const hashChecks = checks.filter((check) => check.name === "assertGlobalState" && String(check.detail).startsWith("scene.actualHash"));
  const proof = {
    buildCompleted: checks.some((check) => check.name === "assertGlobalState" && String(check.detail).startsWith("build.phase") && check.passed),
    cameraResponded: checks.some((check) => check.name === "assertGlobalState" && String(check.detail).startsWith("camera.zoomEvents") && check.passed),
    deterministicHash: hashChecks.length >= 2 && hashChecks.every((check) => check.passed),
    expectedHash,
    sourceDigestAfter,
    sourceDigestBefore,
    sourceUntouched,
    terrainVertices: manifest.terrain?.vertexCount ?? 0,
    treeCount: manifest.scene?.treeCount ?? 0,
  };
  const enhancedReport = {
    ...result.report,
    artifacts: reportArtifacts(result.report),
    consoleErrors,
    failedStep: failedStep(result.report) ?? (sourceUntouched ? null : { command: null, detail: "Generated preview changed during SimSpace execution.", name: "sourceUntouched" }),
    factoryRunId: runId,
    medium: "browser",
    nextSuggestedAction: status === "passed" ? "Inspect the proof video and screenshots." : "Inspect failedStep, consoleErrors, and proof artifacts.",
    proof,
    reportPath: join(result.runDir, "report.json"),
    runId: basename(result.runDir),
    status,
    summary: status === "passed"
      ? `Built ${proof.terrainVertices} terrain vertices and ${proof.treeCount} trees, reproduced hash ${expectedHash}, and left the generated source preview unchanged.`
      : "Scene build proof failed; inspect failedStep and retained evidence.",
    tool: "scene.build-proof",
  };
  const reportPath = join(result.runDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(enhancedReport, null, 2)}\n`);

  return {
    artifacts: enhancedReport.artifacts,
    consoleErrors,
    factoryRunId: runId,
    failedStep: enhancedReport.failedStep,
    proof,
    reportPath,
    runDir: result.runDir,
    simspaceRunId: basename(result.runDir),
    status,
    summary: enhancedReport.summary,
    tool: "scene.build-proof",
  };
}
