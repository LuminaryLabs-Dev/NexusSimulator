function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const toolCatalog = {
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
