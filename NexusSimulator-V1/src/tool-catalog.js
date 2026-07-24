function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const toolCatalog = {
  "kit.contract-proof": {
    id: "kit.contract-proof",
    domain: "kit-contract",
    medium: "descriptor-simulation",
    purpose: "Validate atomic kit contract lifecycle semantics with reset, input, replay, snapshot, output, and renderer-isolation evidence.",
    safeByDefault: true,
    inputs: {
      input: { required: true, type: "jsonl-path" },
      output: { required: false, type: "json-path" },
      runId: { required: false, type: "slug" },
    },
    safety: {
      destructive: false,
      generatedOutputOnly: true,
      rawSourceTreeExecution: false,
    },
    outputs: ["status", "summary", "recordsTested", "accepted", "rejected", "results", "reportPath"],
  },
  "kit.runtime-proof": {
    id: "kit.runtime-proof",
    domain: "kit-runtime",
    medium: "disposable-esm-runtime",
    purpose: "Stage, import, install, replay, snapshot, reset, and test an implemented Nexus Engine domain service kit.",
    safeByDefault: true,
    inputs: {
      manifest: { required: true, type: "json-path" },
      output: { required: false, type: "json-path" },
      runId: { required: false, type: "slug" },
    },
    safety: {
      destructive: false,
      generatedOutputOnly: true,
      rawSourceTreeExecution: false,
      disposableCopy: true,
    },
    outputs: ["status", "summary", "kitId", "promotionLevel", "checks", "errors", "reportPath"],
  },
  "interaction.proof": {
    id: "interaction.proof",
    domain: "interaction",
    medium: "browser",
    purpose: "Safely prove that a browser app renders, accepts non-destructive input, and returns evidence.",
    defaultSimtime: "playwright",
    safeByDefault: true,
    defaultInteractionMode: "auto-safe",
    requiredCapabilities: [
      "loadApp",
      "startServer",
      "openPage",
      "waitForSelector",
      "assertFrameRendered",
      "moveMouse",
      "wheel",
      "pressKey",
      "assertStillResponsive",
      "captureScreenshot",
      "assertNoConsoleErrors",
      "getConsoleLogs",
      "stopServer",
    ],
    safety: {
      defaultRuntime: "simspace",
      destructive: false,
      rawSourceTreeExecution: false,
    },
    outputs: [
      "status",
      "summary",
      "runId",
      "reportPath",
      "artifacts",
      "consoleErrors",
      "failedStep",
      "nextSuggestedAction",
    ],
  },
  "scene.build-proof": {
    id: "scene.build-proof",
    domain: "scene",
    medium: "browser",
    purpose: "Generate a deterministic procedural scene, rebuild it inside SimSpace, and return explicit visual and state evidence.",
    defaultSimtime: "playwright",
    safeByDefault: true,
    inputs: {
      profile: { required: true, type: "path" },
      runId: { required: false, type: "slug" },
      viewport: { default: "1280x720", required: false, type: "dimensions" },
      fps: { default: 30, required: false, type: "integer" },
    },
    requiredCapabilities: [
      "startServer",
      "openPage",
      "resizeViewport",
      "waitForSelector",
      "assertCanvasExists",
      "assertGlobalState",
      "click",
      "advanceSimTime",
      "wait",
      "moveMouse",
      "wheel",
      "assertSmoothFrameTelemetry",
      "assertStillResponsive",
      "captureScreenshot",
      "recordVideo",
      "assertNoConsoleErrors",
      "getConsoleLogs",
      "stopServer",
    ],
    safety: {
      defaultRuntime: "simspace",
      destructive: false,
      rawSourceTreeExecution: false,
    },
    outputs: [
      "status",
      "summary",
      "factoryRunId",
      "simspaceRunId",
      "reportPath",
      "artifacts",
      "consoleErrors",
      "failedStep",
      "proof",
    ],
  },
  "scene.agent-showcase": {
    id: "scene.agent-showcase",
    domain: "scene",
    medium: "browser-video",
    purpose: "Compile a semantic world-domain plan or load a profile, create a blank Nexus Engine project, validate fresh procedural kits in isolation, compose passing kits, then render serialized 3D world commits through deterministic or realtime capture.",
    safeByDefault: true,
    inputs: {
      profile: { required: "unless prompt is supplied", type: "path" },
      prompt: { required: "unless profile is supplied", type: "string" },
      seed: { required: false, type: "string", behavior: "omitted creates a new random world; supplied reproduces a world plan" },
      agentPlan: { required: false, type: "json-path", behavior: "validated nexus.world-domain-plan.v1 used only with prompt" },
      runId: { required: false, type: "slug" },
      viewport: { default: "1920x1080", required: false, type: "dimensions" },
      fps: { default: 30, required: false, type: "integer" },
      duration: { default: "profile", required: false, type: "number" },
      captureMode: { default: "deterministic", required: false, type: "deterministic-or-realtime" },
      nexusEngineRoot: { environment: "NEXUS_ENGINE_ROOT", required: "for all runs; a sibling NexusEngine checkout is auto-discovered", type: "path" },
      nexusProtoKitsRoot: { environment: "NEXUS_PROTOKITS_ROOT", required: "when generation.nexusTerrain is present", type: "path" },
      useCodex: { default: false, required: false, type: "boolean" },
      liveLoop: { default: false, required: false, type: "boolean" },
      output: { required: false, type: "path" },
    },
    safety: {
      codexMode: "ephemeral-read-only",
      destructive: false,
      generatedOutputOnly: true,
      worldWrites: "serialized",
    },
    outputs: [
      "status",
      "summary",
      "runId",
      "reportPath",
      "webPath",
      "videoPath",
      "posterPath",
      "harness",
      "nexusProject",
      "terrainValidation",
      "consoleErrors",
    ],
  },
  "scene.editor-session": {
    id: "scene.editor-session",
    domain: "scene",
    medium: "browser-video",
    purpose: "Record a five-to-ten-minute WorldHarness session that edits, previews, validates, corrects, and commits procedural objects across profile-defined biomes and spatial world structures.",
    safeByDefault: true,
    inputs: {
      profile: { required: true, type: "path" },
      runId: { required: false, type: "slug" },
      viewport: { default: "1920x1080", required: false, type: "dimensions" },
      duration: { default: 305, required: false, type: "seconds-180-to-600" },
      fps: { default: 24, required: false, type: "integer-12-to-60" },
      captureStyle: { default: "human", required: false, type: "human-or-direct" },
      output: { required: false, type: "path" },
    },
    safety: {
      destructive: false,
      generatedOutputOnly: true,
      worldWrites: "validated-editor-commits",
    },
    outputs: ["status", "summary", "runId", "reportPath", "videoPath", "artifacts", "events", "consoleErrors"],
  },
};

export function listTools() {
  return Object.values(toolCatalog).map((tool) => clone(tool));
}

export function inspectTool(id) {
  const tool = toolCatalog[id];
  if (!tool) {
    const known = Object.keys(toolCatalog).join(", ");
    throw new Error(`Unknown tool "${id}". Known tools: ${known}.`);
  }
  return clone(tool);
}

export function toolForMedium(medium) {
  if (!medium || medium === "browser") return inspectTool("interaction.proof");
  throw new Error(`No default V2 tool for medium "${medium}" yet.`);
}
