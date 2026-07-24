import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { runAgentShowcaseAction } from "./agent-showcase.js";

const rootDir = resolve(dirname(new URL(import.meta.url).pathname), "..");
const loopRoot = join(rootDir, ".nexus-simulator", "world-video-loop");
const statePath = join(loopRoot, "state.json");
const graphPath = join(loopRoot, "issue-graph.json");
const reviewsPath = join(loopRoot, "reviews.jsonl");
const GAMEPLAY_FPS = 24;
const HARNESS_VIEW_FPS = 4;
const HARNESS_SAMPLE_STRIDE = GAMEPLAY_FPS / HARNESS_VIEW_FPS;

const PLACE_PROMPTS = [
  "Create a desert with a river, bridge, shrine, and stone arch.",
  "Create an alpine valley with a river, waterfall, bridge, and crystals.",
  "Create a volcanic basin with crystals, a bridge, and a monolith.",
  "Create a forest with a river, mushrooms, fireflies, and a shrine.",
  "Create a desert with a shrine, stone arch, crystals, and an oasis river.",
  "Create an alpine world with pine trees, a bridge, and a waterfall.",
  "Create a volcanic world with a river, arch, crystals, and lanterns.",
  "Create a forest with ancient trees, a bridge, a waterfall, and mushrooms.",
];

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function safeSlug(value) {
  return String(value || "world-video")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "world-video";
}

function now() {
  return new Date().toISOString();
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

function appendJsonl(path, value) {
  ensureDir(dirname(path));
  appendFileSync(path, `${JSON.stringify(value)}\n`);
}

function hashText(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function initialState() {
  return {
    schemaVersion: "nexus.world-video-loop.v1",
    currentIterationId: null,
    latestAttemptIterationId: null,
    currentPrompt: null,
    currentSeed: null,
    iterationCount: 0,
    nextPlaceIndex: 0,
    activeIssueIds: [],
    updatedAt: null,
  };
}

function initialGraph() {
  return {
    schemaVersion: "nexus.world-video-issue-graph.v1",
    nodes: [],
    edges: [],
    updatedAt: null,
  };
}

function loadLoop() {
  ensureDir(loopRoot);
  const graph = readJson(graphPath, initialGraph());
  const state = readJson(statePath, initialState());
  const highestIteration = graph.nodes
    .filter((node) => node.type === "iteration")
    .map((node) => Number(String(node.id).replace(/^iteration-/, "")) || 0)
    .reduce((highest, value) => Math.max(highest, value), 0);
  state.iterationCount = Math.max(state.iterationCount, highestIteration);
  if (!state.latestAttemptIterationId && highestIteration > 0) {
    state.latestAttemptIterationId = `iteration-${String(highestIteration).padStart(4, "0")}`;
  }
  return {
    graph,
    state,
  };
}

function saveLoop(state, graph) {
  const updatedAt = now();
  state.updatedAt = updatedAt;
  graph.updatedAt = updatedAt;
  writeJson(statePath, state);
  writeJson(graphPath, graph);
}

function addNode(graph, node) {
  const index = graph.nodes.findIndex((entry) => entry.id === node.id);
  if (index === -1) graph.nodes.push(node);
  else graph.nodes[index] = { ...graph.nodes[index], ...node };
  return node;
}

function addEdge(graph, from, relationship, to, detail = null) {
  const id = `edge-${hashText(`${from}|${relationship}|${to}`).slice(0, 16)}`;
  if (!graph.edges.some((edge) => edge.id === id)) {
    graph.edges.push({ id, from, relationship, to, detail, createdAt: now() });
  }
  return id;
}

function runCommand(command, args, label) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
  return result;
}

function parseRate(value) {
  const [numerator, denominator = "1"] = String(value || "0").split("/").map(Number);
  return denominator ? numerator / denominator : 0;
}

function probeVideo(path) {
  const result = runCommand("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration,size:stream=codec_name,width,height,r_frame_rate,nb_frames",
    "-of", "json",
    path,
  ], "FFprobe");
  const parsed = JSON.parse(result.stdout);
  const video = parsed.streams?.find((stream) => Number(stream.width) > 0) || {};
  return {
    codec: video.codec_name || null,
    durationSeconds: Number(parsed.format?.duration || 0),
    fps: parseRate(video.r_frame_rate),
    frameCount: video.nb_frames == null ? null : Number(video.nb_frames),
    height: Number(video.height || 0),
    sizeBytes: Number(parsed.format?.size || 0),
    width: Number(video.width || 0),
  };
}

function detectSegments(path, filter, marker) {
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-nostats", "-loglevel", "info",
    "-i", path,
    "-vf", filter,
    "-an", "-f", "null", "-",
  ], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`FFmpeg media analysis failed: ${result.error?.message || result.stderr}`);
  }
  return (result.stderr || "").split("\n").filter((line) => line.includes(marker));
}

function createContactSheet(videoPath, outputPath) {
  ensureDir(dirname(outputPath));
  runCommand("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", videoPath,
    "-vf", "fps=1/3,scale=240:-2,tile=5x1:padding=8:margin=8:color=0x08110d",
    "-frames:v", "1",
    outputPath,
  ], "Contact-sheet render");
}

function createHarnessView(videoPath, outputPath) {
  ensureDir(dirname(outputPath));
  runCommand("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", videoPath,
    "-vf", `fps=${HARNESS_VIEW_FPS}`,
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ], "Harness-view render");
}

function technicalReview({ contactSheetPath, harnessViewPath, report, videoPath, viewport }) {
  const probe = probeVideo(videoPath);
  const [expectedWidth, expectedHeight] = viewport.split("x").map(Number);
  const blackSegments = detectSegments(videoPath, "blackdetect=d=0.5:pix_th=0.10", "black_start");
  const freezeSegments = detectSegments(videoPath, "freezedetect=n=-60dB:d=4.5", "freeze_start");
  createHarnessView(videoPath, harnessViewPath);
  const harnessViewProbe = probeVideo(harnessViewPath);
  createContactSheet(harnessViewPath, contactSheetPath);
  const expectedGameplayFrames = Math.round(report.durationSeconds * GAMEPLAY_FPS);
  const expectedHarnessFrames = Math.round(report.durationSeconds * HARNESS_VIEW_FPS);
  const checks = [
    { id: "showcase-proof", passed: report.status === "passed", detail: report.summary },
    { id: "browser-console", passed: (report.consoleErrors || []).length === 0, detail: `${(report.consoleErrors || []).length} errors` },
    { id: "duration", passed: probe.durationSeconds >= 14.8 && probe.durationSeconds <= 15.2, detail: `${probe.durationSeconds.toFixed(3)} seconds` },
    { id: "vertical-canvas", passed: probe.width === expectedWidth && probe.height === expectedHeight, detail: `${probe.width}x${probe.height}` },
    { id: "h264-video", passed: probe.codec === "h264", detail: probe.codec || "unknown" },
    { id: "gameplay-frame-rate", passed: Math.abs(probe.fps - GAMEPLAY_FPS) < 0.1, detail: `${probe.fps.toFixed(3)} FPS` },
    {
      id: "native-capture-cadence",
      passed: report.captureFps === GAMEPLAY_FPS && report.fps === GAMEPLAY_FPS && report.cadenceMode === "native",
      detail: `capture=${report.captureFps} output=${report.fps} mode=${report.cadenceMode || "unknown"}`,
    },
    {
      id: "gameplay-frame-count",
      passed: probe.frameCount === expectedGameplayFrames,
      detail: `${probe.frameCount ?? "unknown"} of ${expectedGameplayFrames} frames`,
    },
    {
      id: "harness-view-frame-rate",
      passed: Math.abs(harnessViewProbe.fps - HARNESS_VIEW_FPS) < 0.1,
      detail: `${harnessViewProbe.fps.toFixed(3)} FPS`,
    },
    {
      id: "harness-view-frame-count",
      passed: harnessViewProbe.frameCount === expectedHarnessFrames,
      detail: `${harnessViewProbe.frameCount ?? "unknown"} of ${expectedHarnessFrames} frames`,
    },
    { id: "blank-frame", passed: blackSegments.length === 0, detail: blackSegments.length ? blackSegments.join(" | ") : "none" },
    { id: "long-freeze", passed: freezeSegments.length === 0, detail: freezeSegments.length ? freezeSegments.join(" | ") : "none" },
  ];
  const passed = checks.every((check) => check.passed);
  return {
    schemaVersion: "nexus.world-video-review.v1",
    reviewType: "technical",
    decision: passed ? "ready_for_human_review" : "technical_failure",
    passed,
    checks,
    probe,
    harnessView: {
      fps: HARNESS_VIEW_FPS,
      sampleEveryNFrames: HARNESS_SAMPLE_STRIDE,
      probe: harnessViewProbe,
    },
    reviewedAt: now(),
  };
}

function compactReport(report) {
  const domainPlan = report.harness?.worldDomainPlan || null;
  return {
    schemaVersion: "nexus.world-video-proof.v1",
    status: report.status,
    summary: report.summary,
    runId: report.runId,
    prompt: report.prompt,
    captureMode: report.captureMode,
    browserName: report.browserName ?? "chromium",
    captureFps: report.captureFps ?? report.fps,
    capturedFrameCount: report.capturedFrameCount ?? report.frameCount,
    cadenceMode: report.cadenceMode ?? null,
    playbackOffsetSeconds: report.playbackOffsetSeconds ?? null,
    durationSeconds: report.durationSeconds,
    fps: report.fps,
    viewport: report.viewport,
    frameCount: report.frameCount,
    objectCount: report.objectCount,
    consoleErrors: report.consoleErrors,
    proof: {
      complete: report.proof?.complete ?? false,
      test: report.proof?.test ?? null,
      world: report.proof?.world ?? null,
      libraryPassed: report.proof?.library?.passed ?? null,
    },
    harness: {
      status: report.harness?.status ?? null,
      promotedAssets: report.harness?.library?.assets?.length ?? 0,
    },
    domainPlan: domainPlan ? {
      digest: domainPlan.digest,
      plannerMode: domainPlan.plannerMode,
      coverageStatus: domainPlan.coverageLedger?.status ?? "unknown",
      requirementCount: domainPlan.requirements?.length ?? 0,
      requirements: (domainPlan.requirements || []).map((requirement) => ({
        id: requirement.id,
        domainPath: requirement.domainPath,
        capabilityId: requirement.capabilityId,
        factoryType: requirement.factoryType,
        nativeCapability: requirement.nativeCapability,
        source: requirement.source,
      })),
      compositionSignature: domainPlan.saturationState?.compositionSignature ?? null,
      saturationEligibility: domainPlan.saturationState?.eligibility ?? null,
    } : null,
    nexusProject: {
      status: report.nexusProject?.status ?? null,
      kitCount: report.nexusProject?.kits?.length ?? report.nexusProject?.kitCount ?? null,
    },
  };
}

function recordDomainPlanGraph(graph, iterationId, plan) {
  if (!plan?.digest) return null;
  const planId = `domain-plan-${plan.digest}`;
  addNode(graph, {
    id: planId,
    type: "world-domain-plan",
    digest: plan.digest,
    plannerMode: plan.plannerMode,
    coverageStatus: plan.coverageLedger?.status || "unknown",
    compositionSignature: plan.saturationState?.compositionSignature || null,
    ambiguities: plan.ambiguities || [],
    gaps: plan.gaps || [],
    createdAt: now(),
  });
  addEdge(graph, iterationId, "planned_by", planId);
  const requirementNodeIds = new Map();
  for (const domain of plan.domainTree || []) {
    const domainId = `domain-${hashText(domain.path).slice(0, 16)}`;
    addNode(graph, {
      id: domainId,
      type: "semantic-domain",
      path: domain.path,
      purpose: domain.purpose,
      createdAt: now(),
    });
    addEdge(graph, planId, "covers_domain", domainId);
  }
  for (const requirement of plan.requirements || []) {
    const requirementId = `domain-requirement-${hashText(`${plan.digest}|${requirement.id}`).slice(0, 16)}`;
    const capabilityId = `factory-capability-${safeSlug(requirement.capabilityId)}`;
    requirementNodeIds.set(requirement.id, requirementId);
    addNode(graph, {
      id: requirementId,
      type: "domain-requirement",
      requirementId: requirement.id,
      concept: requirement.concept,
      domainPath: requirement.domainPath,
      source: requirement.source,
      reviewCriteria: requirement.reviewCriteria,
      createdAt: now(),
    });
    addNode(graph, {
      id: capabilityId,
      type: "factory-capability",
      capabilityId: requirement.capabilityId,
      factoryType: requirement.factoryType,
      nativeCapability: requirement.nativeCapability,
      status: "available",
      createdAt: now(),
    });
    addEdge(graph, planId, "requires", requirementId);
    addEdge(graph, requirementId, "fulfilled_by", capabilityId);
    const domainId = `domain-${hashText(requirement.domainPath).slice(0, 16)}`;
    addEdge(graph, domainId, "owns_requirement", requirementId);
  }
  for (const edge of plan.compositionEdges || []) {
    const from = requirementNodeIds.get(edge.from);
    const to = requirementNodeIds.get(edge.to);
    if (from && to) addEdge(graph, from, edge.relationship, to);
  }
  const saturationId = `domain-saturation-${iterationId}`;
  addNode(graph, {
    id: saturationId,
    type: "domain-saturation-experiment",
    iterationId,
    planId,
    compositionSignature: plan.saturationState?.compositionSignature || null,
    eligibility: "pending-visual-validation",
    zeroDiscoveryStreak: "held",
    acceptedAtomIds: [],
    createdAt: now(),
  });
  addEdge(graph, iterationId, "awaits_domain_saturation_review", saturationId);
  return { planId, saturationId };
}

function qualifyDomainSaturation(graph, iteration, reviewId) {
  const planId = graph.edges.find((edge) => edge.from === iteration.id && edge.relationship === "planned_by")?.to;
  const experiment = graph.nodes.find((node) => node.type === "domain-saturation-experiment" && node.iterationId === iteration.id);
  const plan = graph.nodes.find((node) => node.id === planId && node.type === "world-domain-plan");
  if (!plan || !experiment) return null;
  const priorExperiments = graph.nodes.filter((node) => node.type === "domain-saturation-experiment"
    && node.iterationId !== iteration.id
    && node.eligibility === "eligible");
  const repeated = priorExperiments.some((node) => node.compositionSignature === experiment.compositionSignature);
  const requirementIds = graph.edges.filter((edge) => edge.from === planId && edge.relationship === "requires").map((edge) => edge.to);
  const capabilityNodes = requirementIds.flatMap((requirementId) => graph.edges
    .filter((edge) => edge.from === requirementId && edge.relationship === "fulfilled_by")
    .map((edge) => graph.nodes.find((node) => node.id === edge.to && node.type === "factory-capability")))
    .filter(Boolean);
  const newAtomIds = repeated ? [] : capabilityNodes.filter((node) => !node.acceptedAt).map((node) => node.capabilityId);
  const current = graph.nodes.find((node) => node.id === "domain-saturation-state") || {
    id: "domain-saturation-state",
    type: "domain-saturation-state",
    zeroDiscoveryStreak: 0,
    verdict: "continue",
  };
  if (!repeated) {
    for (const capability of capabilityNodes) {
      if (!capability.acceptedAt) {
        capability.acceptedAt = now();
        capability.acceptedBy = iteration.id;
        capability.status = "accepted";
      }
    }
    current.zeroDiscoveryStreak = newAtomIds.length ? 0 : Number(current.zeroDiscoveryStreak || 0) + 1;
    current.verdict = current.zeroDiscoveryStreak >= 5 ? "saturated" : "continue";
  }
  current.updatedAt = now();
  addNode(graph, current);
  experiment.eligibility = repeated ? "excluded-repeated-composition" : "eligible";
  experiment.acceptedAtomIds = newAtomIds;
  experiment.zeroDiscoveryStreak = current.zeroDiscoveryStreak;
  experiment.reviewId = reviewId;
  experiment.reviewedAt = now();
  addEdge(graph, reviewId, repeated ? "excluded_from" : "qualifies", experiment.id);
  addEdge(graph, experiment.id, "updates", current.id);
  return {
    eligibility: experiment.eligibility,
    acceptedAtomIds: newAtomIds,
    zeroDiscoveryStreak: current.zeroDiscoveryStreak,
    verdict: current.verdict,
  };
}

function createIssue(graph, state, { area, detail, iterationId, severity = "medium", source = "human" }) {
  const issueId = `issue-${String(graph.nodes.filter((node) => node.type === "issue").length + 1).padStart(4, "0")}`;
  addNode(graph, {
    id: issueId,
    type: "issue",
    area,
    detail,
    severity,
    source,
    status: "open",
    createdAt: now(),
  });
  addEdge(graph, iterationId, "revealed", issueId);
  state.activeIssueIds = [...new Set([...state.activeIssueIds, issueId])];
  return issueId;
}

function relativeArtifact(path) {
  return relative(loopRoot, path).split("\\").join("/");
}

function summarizeIteration(node) {
  if (!node) return null;
  if (!node.error) return node;
  return {
    ...node,
    error: String(node.error).replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0],
    errorDetailStoredInGraph: true,
  };
}

function summarizeIssue(node) {
  if (!node?.detail) return node;
  const detail = String(node.detail).replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0];
  return detail === node.detail ? node : { ...node, detail, detailStoredInGraph: true };
}

function reconcileTechnicalResolutions(state, graph) {
  let changed = false;
  const passingIterations = graph.nodes.filter((node) => node.type === "iteration" && node.status === "awaiting_human_review");
  for (const iteration of passingIterations) {
    const changeIds = graph.edges
      .filter((edge) => edge.from === iteration.id && edge.relationship === "tests")
      .map((edge) => edge.to);
    for (const changeId of changeIds) {
      const issueIds = graph.edges
        .filter((edge) => edge.from === changeId && edge.relationship === "addresses")
        .map((edge) => edge.to);
      for (const issueId of issueIds) {
        const issue = graph.nodes.find((node) => node.id === issueId && node.type === "issue");
        if (!issue || issue.source !== "technical" || issue.status === "resolved") continue;
        issue.status = "resolved";
        issue.resolvedAt = iteration.completedAt || now();
        issue.resolvedBy = iteration.id;
        state.activeIssueIds = state.activeIssueIds.filter((id) => id !== issue.id);
        addEdge(graph, iteration.id, "verified_resolution_of", issue.id);
        changed = true;
      }
    }
  }
  return changed;
}

function reconcileHumanReviewStatuses(graph) {
  let changed = false;
  const statuses = {
    pass: "human_review_passed",
    revise: "revision_requested",
    blocked: "human_review_blocked",
  };
  for (const iteration of graph.nodes.filter((node) => node.type === "iteration" && node.humanDecision)) {
    const status = statuses[iteration.humanDecision];
    if (status && iteration.status !== status) {
      iteration.status = status;
      changed = true;
    }
  }
  return changed;
}

export function listWorldVideoPlaces() {
  return PLACE_PROMPTS.map((prompt, index) => ({ index, prompt }));
}

export function worldVideoStatus() {
  const { graph, state } = loadLoop();
  const technicalChanged = reconcileTechnicalResolutions(state, graph);
  const reviewChanged = reconcileHumanReviewStatuses(graph);
  if (technicalChanged || reviewChanged) saveLoop(state, graph);
  const current = state.currentIterationId
    ? graph.nodes.find((node) => node.id === state.currentIterationId) || null
    : null;
  const latestAttempt = state.latestAttemptIterationId
    ? graph.nodes.find((node) => node.id === state.latestAttemptIterationId) || null
    : null;
  const activeIssues = state.activeIssueIds
    .map((id) => graph.nodes.find((node) => node.id === id))
    .filter(Boolean)
    .map(summarizeIssue);
  const currentPlanId = current
    ? graph.edges.find((edge) => edge.from === current.id && edge.relationship === "planned_by")?.to
    : null;
  const currentPlan = graph.nodes.find((node) => node.id === currentPlanId && node.type === "world-domain-plan") || null;
  const saturation = graph.nodes.find((node) => node.id === "domain-saturation-state") || null;
  return {
    schemaVersion: state.schemaVersion,
    current: summarizeIteration(current),
    currentReviewable: Boolean(current && (
      current.decision === "ready_for_human_review"
      || ["human_review_passed", "revision_requested", "human_review_blocked"].includes(current.status)
    )),
    latestAttempt: summarizeIteration(latestAttempt),
    activeIssues,
    domainPlan: currentPlan ? {
      id: currentPlan.id,
      digest: currentPlan.digest,
      plannerMode: currentPlan.plannerMode,
      coverageStatus: currentPlan.coverageStatus,
      compositionSignature: currentPlan.compositionSignature,
    } : null,
    domainSaturation: saturation ? {
      zeroDiscoveryStreak: saturation.zeroDiscoveryStreak,
      verdict: saturation.verdict,
    } : null,
    iterationCount: state.iterationCount,
    nextPlace: PLACE_PROMPTS[state.nextPlaceIndex % PLACE_PROMPTS.length],
    currentArtifacts: current ? {
      video: "current/video.mp4",
      harnessView: "current/harness-view.mp4",
      poster: "current/poster.png",
      contactSheet: "current/contact-sheet.jpg",
      manifest: "current/manifest.json",
    } : null,
  };
}

export async function makeWorldVideo({
  addresses = null,
  change = null,
  prompt = null,
  requiredDifferentFromHash = null,
  seed = null,
  settingsPatches = null,
  viewport = "720x1280",
} = {}) {
  if (!/^\d+x\d+$/.test(viewport)) throw new Error("World video viewport must use WIDTHxHEIGHT.");
  const [width, height] = viewport.split("x").map(Number);
  if (width < 720 || height < 1280 || width >= height) {
    throw new Error("World video viewport must be portrait and at least 720x1280.");
  }
  const { graph, state } = loadLoop();
  const addressIds = String(addresses || "").split(",").map((id) => id.trim()).filter(Boolean);
  const unknownIssueIds = addressIds.filter((id) => !state.activeIssueIds.includes(id));
  if (unknownIssueIds.length) {
    throw new Error(`Cannot address unknown or inactive issues: ${unknownIssueIds.join(", ")}.`);
  }
  if (addressIds.length && !String(change || "").trim()) {
    throw new Error("--change is required when --addresses is used.");
  }
  const usingQueue = !String(prompt || "").trim();
  const selectedPrompt = usingQueue
    ? PLACE_PROMPTS[state.nextPlaceIndex % PLACE_PROMPTS.length]
    : String(prompt).trim();
  const iterationNumber = state.iterationCount + 1;
  const selectedSeed = String(seed || `${safeSlug(selectedPrompt).slice(0, 32)}-${Date.now().toString(36)}-${iterationNumber}`);
  const iterationId = `iteration-${String(iterationNumber).padStart(4, "0")}`;
  const runId = `world-video-${String(iterationNumber).padStart(4, "0")}-${safeSlug(selectedPrompt).slice(0, 28)}-${hashText(selectedSeed).slice(0, 8)}`;
  const iterationDir = join(loopRoot, "iterations", iterationId);
  const stagingDir = join(loopRoot, "staging");
  const candidateVideoPath = join(stagingDir, `${iterationId}.mp4`);
  const showcaseRunDir = join(rootDir, ".nexus-simulator", "showcases", runId);
  ensureDir(iterationDir);
  ensureDir(stagingDir);

  addNode(graph, {
    id: iterationId,
    type: "iteration",
    status: "rendering",
    prompt: selectedPrompt,
    seed: selectedSeed,
    viewport,
    durationSeconds: 15,
    createdAt: now(),
  });
  if (state.currentIterationId) addEdge(graph, iterationId, "follows", state.currentIterationId);
  let changeId = null;
  if (change) {
    changeId = `change-${String(graph.nodes.filter((node) => node.type === "change").length + 1).padStart(4, "0")}`;
    addNode(graph, {
      id: changeId,
      type: "change",
      detail: String(change).trim(),
      settingsPatches,
      status: "applied_for_review",
      createdAt: now(),
    });
    addEdge(graph, changeId, "produced", iterationId);
    for (const issueId of addressIds) addEdge(graph, changeId, "addresses", issueId);
  }
  state.iterationCount = iterationNumber;
  state.latestAttemptIterationId = iterationId;
  saveLoop(state, graph);

  let report;
  try {
    report = await runAgentShowcaseAction({
      browserHeadless: true,
      captureMode: "deterministic",
      captureFps: GAMEPLAY_FPS,
      duration: 15,
      fps: GAMEPLAY_FPS,
      liveLoop: false,
      outputPath: candidateVideoPath,
      presentationMode: "procedural-editor",
      prompt: selectedPrompt,
      runId,
      seed: selectedSeed,
      settingsPatches,
      useCodex: false,
      viewport,
    });
  } catch (error) {
    addNode(graph, {
      id: iterationId,
      status: "render_failed",
      error: error.message,
      completedAt: now(),
    });
    createIssue(graph, state, {
      area: "render",
      detail: error.message,
      iterationId,
      severity: "high",
      source: "technical",
    });
    saveLoop(state, graph);
    rmSync(candidateVideoPath, { force: true });
    rmSync(showcaseRunDir, { recursive: true, force: true });
    rmSync(iterationDir, { recursive: true, force: true });
    throw error;
  }

  const posterPath = join(iterationDir, "poster.png");
  const profilePath = join(iterationDir, "profile.json");
  const reportPath = join(iterationDir, "report.json");
  const contactSheetPath = join(iterationDir, "contact-sheet.jpg");
  const harnessViewPath = join(iterationDir, "harness-view.mp4");
  let technical;
  try {
    if (existsSync(report.posterPath)) copyFileSync(report.posterPath, posterPath);
    if (existsSync(report.profilePath)) copyFileSync(report.profilePath, profilePath);
    writeJson(reportPath, compactReport(report));
    technical = technicalReview({
      contactSheetPath,
      harnessViewPath,
      report,
      videoPath: candidateVideoPath,
      viewport,
    });
    writeJson(join(iterationDir, "technical-review.json"), technical);
  } catch (error) {
    addNode(graph, {
      id: iterationId,
      status: "evidence_failed",
      error: error.message,
      completedAt: now(),
    });
    createIssue(graph, state, {
      area: "media-analysis",
      detail: error.message,
      iterationId,
      severity: "high",
      source: "technical",
    });
    saveLoop(state, graph);
    rmSync(candidateVideoPath, { force: true });
    rmSync(showcaseRunDir, { recursive: true, force: true });
    rmSync(iterationDir, { recursive: true, force: true });
    throw error;
  }

  const failedChecks = technical.checks.filter((check) => !check.passed);
  const issueIds = failedChecks.map((check) => createIssue(graph, state, {
    area: check.id,
    detail: check.detail,
    iterationId,
    severity: "high",
    source: "technical",
  }));
  const videoHash = hashFile(candidateVideoPath);
  const artifactChanged = !requiredDifferentFromHash || videoHash !== requiredDifferentFromHash;
  if (technical.passed && !artifactChanged) {
    issueIds.push(createIssue(graph, state, {
      area: "revision-output",
      detail: "The revised candidate produced the same video hash as the retained candidate.",
      iterationId,
      severity: "high",
      source: "technical",
    }));
  }
  const candidatePassed = technical.passed && artifactChanged;
  const decision = candidatePassed ? technical.decision : (
    technical.passed ? "revision_unchanged" : technical.decision
  );
  const manifest = {
    schemaVersion: "nexus.world-video-manifest.v1",
    iterationId,
    prompt: selectedPrompt,
    seed: selectedSeed,
    change: change ? String(change).trim() : null,
    settingsPatches,
    addresses: addressIds,
    decision,
    durationSeconds: 15,
    viewport,
    videoSha256: videoHash,
    revisionEvidence: requiredDifferentFromHash ? {
      artifactChanged,
      priorVideoSha256: requiredDifferentFromHash,
    } : null,
    cadence: {
      gameplayFps: GAMEPLAY_FPS,
      harnessViewFps: HARNESS_VIEW_FPS,
      harnessSampleEveryNFrames: HARNESS_SAMPLE_STRIDE,
      interpolation: "none",
    },
    technicalReview: technical,
    domainPlan: report.harness?.worldDomainPlan ? {
      digest: report.harness.worldDomainPlan.digest,
      plannerMode: report.harness.worldDomainPlan.plannerMode,
      coverageLedger: report.harness.worldDomainPlan.coverageLedger,
      requirements: report.harness.worldDomainPlan.requirements,
      compositionEdges: report.harness.worldDomainPlan.compositionEdges,
      saturationState: report.harness.worldDomainPlan.saturationState,
    } : null,
    publicationReady: false,
    uploadAllowed: false,
    createdAt: now(),
  };
  writeJson(join(iterationDir, "manifest.json"), manifest);

  if (candidatePassed) {
    const nextCurrent = join(stagingDir, `${iterationId}-current`);
    rmSync(nextCurrent, { recursive: true, force: true });
    ensureDir(nextCurrent);
    copyFileSync(candidateVideoPath, join(nextCurrent, "video.mp4"));
    if (existsSync(posterPath)) copyFileSync(posterPath, join(nextCurrent, "poster.png"));
    copyFileSync(contactSheetPath, join(nextCurrent, "contact-sheet.jpg"));
    copyFileSync(harnessViewPath, join(nextCurrent, "harness-view.mp4"));
    writeJson(join(nextCurrent, "manifest.json"), manifest);
    const currentDir = join(loopRoot, "current");
    rmSync(currentDir, { recursive: true, force: true });
    renameSync(nextCurrent, currentDir);
  }

  const previousIterationId = state.currentIterationId;
  addNode(graph, {
    id: iterationId,
    status: candidatePassed ? "awaiting_human_review" : (
      technical.passed ? "revision_unchanged" : "technical_failure"
    ),
    decision,
    videoSha256: videoHash,
    settingsPatches,
    issueIds,
    domainPlanDigest: report.harness?.worldDomainPlan?.digest || null,
    domainCoverageStatus: report.harness?.worldDomainPlan?.coverageLedger?.status || null,
    artifacts: {
      contactSheet: relativeArtifact(contactSheetPath),
      harnessView: relativeArtifact(harnessViewPath),
      manifest: relativeArtifact(join(iterationDir, "manifest.json")),
      poster: relativeArtifact(posterPath),
      report: relativeArtifact(reportPath),
    },
    completedAt: now(),
  });
  if (previousIterationId && candidatePassed) addEdge(graph, iterationId, "supersedes_video_for", previousIterationId);
  addNode(graph, {
    id: `evidence-${iterationId}`,
    type: "evidence",
    videoSha256: videoHash,
    contactSheet: relativeArtifact(contactSheetPath),
    harnessView: relativeArtifact(harnessViewPath),
    poster: relativeArtifact(posterPath),
    createdAt: now(),
  });
  addEdge(graph, iterationId, "produced", `evidence-${iterationId}`);
  recordDomainPlanGraph(graph, iterationId, report.harness?.worldDomainPlan || null);
  if (changeId) addEdge(graph, iterationId, "tests", changeId);

  reconcileTechnicalResolutions(state, graph);

  if (candidatePassed) {
    state.currentIterationId = iterationId;
    state.currentPrompt = selectedPrompt;
    state.currentSeed = selectedSeed;
  }
  if (usingQueue) state.nextPlaceIndex = (state.nextPlaceIndex + 1) % PLACE_PROMPTS.length;
  saveLoop(state, graph);

  rmSync(candidateVideoPath, { force: true });
  rmSync(showcaseRunDir, { recursive: true, force: true });

  return {
    status: decision,
    iterationId,
    prompt: selectedPrompt,
    seed: selectedSeed,
    settingsPatches,
    artifactChanged,
    videoSha256: videoHash,
    domainPlan: report.harness?.worldDomainPlan ?? null,
    nexusProject: report.nexusProject ?? null,
    currentVideo: candidatePassed ? join(loopRoot, "current", "video.mp4") : null,
    harnessView: candidatePassed ? join(loopRoot, "current", "harness-view.mp4") : harnessViewPath,
    contactSheet: candidatePassed ? join(loopRoot, "current", "contact-sheet.jpg") : contactSheetPath,
    poster: candidatePassed ? join(loopRoot, "current", "poster.png") : posterPath,
    manifestPath: join(iterationDir, "manifest.json"),
    reportPath,
    issueIds,
    technicalReview: technical,
    nextAction: candidatePassed
      ? "Inspect the 4 FPS harness view, the native 24 FPS video around transitions, and the contact sheet, then record one human review decision."
      : artifactChanged
        ? "Fix the highest-impact technical issue before generating another iteration."
        : "Change at least one validated procedural setting before attempting this revision again.",
  };
}

export function recordWorldVideoReview({
  area = "visual-quality",
  decision,
  issue = null,
  iterationId = null,
  note = null,
  severity = "medium",
} = {}) {
  if (!["pass", "revise", "blocked"].includes(decision)) {
    throw new Error("World video review decision must be pass, revise, or blocked.");
  }
  if (decision !== "pass" && !String(issue || "").trim()) {
    throw new Error("A concrete issue is required for revise or blocked reviews.");
  }
  const { graph, state } = loadLoop();
  const targetId = iterationId || state.currentIterationId;
  const iteration = graph.nodes.find((node) => node.id === targetId && node.type === "iteration");
  if (!iteration) throw new Error(`Unknown world video iteration ${targetId || "(none)"}.`);
  const reviewId = `review-${String(graph.nodes.filter((node) => node.type === "review").length + 1).padStart(4, "0")}`;
  const review = {
    id: reviewId,
    type: "review",
    iterationId: targetId,
    decision,
    area,
    issue: issue ? String(issue).trim() : null,
    note: note ? String(note).trim() : null,
    severity,
    createdAt: now(),
  };
  addNode(graph, review);
  addEdge(graph, reviewId, "reviews", targetId);
  let issueId = null;
  let domainSaturation = null;
  if (review.issue) {
    issueId = createIssue(graph, state, {
      area,
      detail: review.issue,
      iterationId: targetId,
      severity,
      source: "human",
    });
    addEdge(graph, reviewId, "reported", issueId);
  }
  if (decision === "pass") {
    const testedChanges = graph.edges.filter((edge) => edge.from === targetId && edge.relationship === "tests").map((edge) => edge.to);
    for (const changeId of testedChanges) {
      for (const edge of graph.edges.filter((entry) => entry.from === changeId && entry.relationship === "addresses")) {
        const resolved = graph.nodes.find((node) => node.id === edge.to && node.type === "issue");
        if (resolved) {
          resolved.status = "resolved";
          resolved.resolvedAt = now();
          resolved.resolvedBy = reviewId;
          state.activeIssueIds = state.activeIssueIds.filter((id) => id !== resolved.id);
          addEdge(graph, reviewId, "verified_resolution_of", resolved.id);
        }
      }
    }
    domainSaturation = qualifyDomainSaturation(graph, iteration, reviewId);
  }
  iteration.humanDecision = decision;
  iteration.status = decision === "pass"
    ? "human_review_passed"
    : decision === "revise"
      ? "revision_requested"
      : "human_review_blocked";
  iteration.reviewedAt = now();
  appendJsonl(reviewsPath, review);
  saveLoop(state, graph);
  return {
    reviewId,
    iterationId: targetId,
    decision,
    issueId,
    activeIssueIds: state.activeIssueIds,
    domainSaturation,
    nextAction: decision === "pass"
      ? "Advance to the next place or test one deliberate variation."
      : `Address ${issueId} with one focused WorldFactory change, then regenerate the same prompt and seed.`,
  };
}
