#!/usr/bin/env node
import { readFileSync } from "node:fs";
import {
  appendScenarioEvent,
  attachApp,
  checkScenario,
  createEnvironment,
  createSmokeScenario,
  createScenario,
  detectAppPath,
  getSimtimeManifest,
  listEnvironments,
  listSimtimes,
  listScenarios,
  runScenario,
  showScenario,
} from "./runtime.js";
import {
  initAssetPack,
  improveAssetPack,
  packageAssetPack,
  recordAssetPack,
  runAssetPack,
  statusAssetPack,
} from "./asset-pack.js";
import {
  factoryGraph,
  initFactoryRun,
  improveFactoryRun,
  listFactoryNames,
  packageFactoryRun,
  recordFactoryRun,
  runFactory,
  statusFactoryRun,
} from "./factory.js";
import {
  createItchDraft,
  itchAuthLogin,
  itchAuthStatus,
  uploadItchDraft,
  verifyItchDraft,
} from "./itch-playwright.js";
import { loadFactoryConfig } from "./factory-profiles.js";
import { runScenarioInSimSpace } from "./simspace.js";
import { runScenarioInSimSpaceChunked } from "./simspace.js";
import {
  inspectToolAction,
  listToolActions,
  runAgentShowcaseAction,
  runWorldEditorSessionAction,
  runKitContractProofAction,
  runKitRuntimeProofAction,
  runSceneBuildProofAction,
  validateScenarioAction,
  validateTargetAction,
  createWorldActionSurface,
} from "./actions.js";
import {
  loadReport,
  listReports,
  reportArtifacts,
  reportConsole,
  reportFailedStep,
  reportLogs,
  reportSummary,
} from "./report-service.js";

function usage() {
  console.log([
    "nexus-sim",
    "",
    "Safe app validation through append-only scenarios and disposable SimSpace runs.",
    "",
    "Usage:",
    "  nexus-sim validate <path> [--tool interaction.proof]",
    "  nexus-sim validate <env> <scenario> [--simtime <id>]",
    "  nexus-sim tools",
    "  nexus-sim tools inspect <id>",
    "  nexus-sim report summary <run-id>",
    "  nexus-sim app detect <path>",
    "  nexus-sim app attach <env> <path>",
    "  nexus-sim app smoke <env> [--replace] [--name <scenario>]",
    "  nexus-sim scenario list <env>",
    "  nexus-sim scenario show <env> <scenario>",
    "  nexus-sim scenario check <env> <scenario> [--simtime <id>]",
    "  nexus-sim simspace run <env> <scenario> [--simtime <id>]",
    "  nexus-sim simtime list",
    "  nexus-sim simtime inspect <id>",
    "",
    "Default path:",
    "  validate path -> inspect report",
    "",
    "Notes:",
    "  validate <path> and simspace run stage a disposable app copy before running.",
    "  scenario run touches the attached app path directly; see --help-all.",
    "  nexus-sim --help-all shows advanced factory, asset-pack, itch, and raw scenario commands.",
  ].join("\n"));
}

function usageAll() {
  console.log([
    "nexus-sim",
    "",
    "Usage:",
    "  nexus-sim validate <path> [--tool interaction.proof] [--medium browser] [--interaction auto-safe]",
    "  nexus-sim validate <env> <scenario> [--simtime <id>]",
    "  nexus-sim tools",
    "  nexus-sim tools inspect <id>",
    "  nexus-sim report get <run-id>",
    "  nexus-sim report list",
    "  nexus-sim report summary <run-id>",
    "  nexus-sim report artifacts <run-id>",
    "  nexus-sim report console <run-id>",
    "  nexus-sim report logs <run-id>",
    "  nexus-sim report failed-step <run-id>",
    "  nexus-sim env create <name> [--simtime <id>]",
    "  nexus-sim env list",
    "  nexus-sim app detect <path>",
    "  nexus-sim app attach <env> <path>",
    "  nexus-sim app smoke <env> [--replace] [--name <scenario>]",
    "  nexus-sim simtime list",
    "  nexus-sim simtime inspect <id>",
    "  nexus-sim simspace run <env> <scenario> [--simtime <id>]",
    "  nexus-sim simspace run-chunked <env> <scenario> [--chunk-size 5] [--resume <run-id>] [--stop-after-checkpoint] [--simtime <id>]",
    "  nexus-sim world session create --target <path> [--adapter browser|nexus-headless] [--profile <path>] [--session-id <id>] [--workspace-root <path>]",
    "  nexus-sim world session status <session-id> [--workspace-root <path>]",
    "  nexus-sim world observe <session-id> [--workspace-root <path>]",
    "  nexus-sim world batch --file <batch.json> [--workspace-root <path>] [--allow-destructive]",
    "  nexus-sim world batch status <session-id> <batch-id> [--workspace-root <path>]",
    "  nexus-sim world session cancel <session-id> [--workspace-root <path>]",
    "  nexus-sim world session close <session-id> [--workspace-root <path>]",
    "  nexus-sim mcp serve --transport stdio [--workspace-root <path>] [--allow-destructive]",
    "  nexus-sim mcp serve --transport http [--host 127.0.0.1] [--port 8765] [--allowed-host <host>] [--workspace-root <path>] [--allow-destructive]",
    "  nexus-sim scenario append <env> <scenario> <command> [args-json]",
    "  nexus-sim scenario list <env>",
    "  nexus-sim scenario show <env> <scenario>",
    "  nexus-sim scenario check <env> <scenario> [--simtime <id>]",
    "  nexus-sim scenario run <env> <scenario> [--simtime <id>]",
    "  nexus-sim factory list",
    "  nexus-sim tools run scene.build-proof --profile <path> [--run-id <id>] [--viewport 1280x720] [--fps 30]",
    "  nexus-sim tools run scene.agent-showcase --profile <path> [--run-id <id>] [--viewport 1920x1080] [--fps 30] [--duration <seconds>] [--nexus-engine-root <path>] [--nexus-protokits-root <path>] [--use-codex] [--live-loop] [--output <path>]",
    "  nexus-sim tools run scene.editor-session --profile <path> [--run-id <id>] [--viewport 1920x1080] [--duration 305] [--fps 24] [--capture-style human|direct] [--output <path>]",
    "  nexus-sim factory config validate <path>",
    "  nexus-sim factory init <run-id> --factory <FactoryName> --seed <seed> --profile <profile> [--theme <text>] [--settings <json>] [--config <path>]",
    "  nexus-sim factory run <run-id>",
    "  nexus-sim factory record <run-id> [--seconds 10] [--viewport 1280x720] [--fps 60] [--capture-mode deterministic|realtime]",
    "  nexus-sim factory improve <run-id> [--attempts 3] [--seconds 10] [--viewport 1280x720] [--fps 60] [--capture-mode deterministic|realtime] [--quality-preset hyperreal]",
    "  nexus-sim factory package <run-id> --pack-id <pack-id>",
    "  nexus-sim factory status <run-id>",
    "  nexus-sim factory graph <run-id>",
    "  nexus-sim asset-pack init <pack-id> --reference <path> --theme <text>",
    "  nexus-sim asset-pack run <pack-id> [--iterations 5] [--simtime playwright]",
    "  nexus-sim asset-pack record <pack-id> [--seconds 60] [--viewport 1280x720]",
    "  nexus-sim asset-pack improve <pack-id> [--attempts 3] [--seconds 10] [--viewport 1280x720]",
    "  nexus-sim asset-pack package <pack-id>",
    "  nexus-sim asset-pack status <pack-id>",
    "  nexus-sim itch auth login --headed",
    "  nexus-sim itch auth status",
    "  nexus-sim itch draft create <pack-id> --project <slug> --approved",
    "  nexus-sim itch draft upload <pack-id> --zip <path> --approved",
    "  nexus-sim itch draft verify <pack-id>",
    "",
    "Scenario files are append-only JSONL logs stored in .nexus-simulator/scenarios/.",
    "Prefer simspace run or validate for safe app validation.",
    "World mutations are allowlisted subcommands inside world.batch_command.",
    "LAN MCP requires NEXUS_SIM_MCP_TOKEN (32+ characters) and explicit --allowed-host values.",
  ].join("\n"));
}

function parseSimtimeOverride(args) {
  const index = args.indexOf("--simtime");
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value) throw new Error("Missing value after --simtime.");
  return value;
}

function stripOption(args, option) {
  const index = args.indexOf(option);
  if (index === -1) return args;
  const next = args[index + 1];
  if (!next) throw new Error(`Missing value after ${option}.`);
  return [...args.slice(0, index), ...args.slice(index + 2)];
}

function parseArgsJson(raw) {
  if (raw === undefined) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid args JSON: ${error.message}`);
  }
}

function parseSettingsOption(args) {
  const raw = parseNamedOption(args, "--settings");
  return raw === null ? {} : parseArgsJson(raw);
}

function stripOptions(args, options) {
  return options.reduce((current, option) => stripOption(current, option), args);
}

function printScenarioEvents(events) {
  if (!events.length) {
    console.log("No events yet.");
    return;
  }
  events.forEach((event, index) => {
    console.log(`${index + 1}. ${event.command} ${JSON.stringify(event.args ?? {})}`);
  });
}

function parseScenarioTarget(args) {
  const simtime = parseSimtimeOverride(args);
  const cleaned = stripOption(args, "--simtime");
  const [envName, scenarioName] = cleaned;
  return { envName, scenarioName, simtime };
}

function parseNamedOption(args, option) {
  const index = args.indexOf(option);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value) throw new Error(`Missing value after ${option}.`);
  return value;
}

function parseRepeatedOption(args, option) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== option) continue;
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value after ${option}.`);
    values.push(value);
  }
  return values;
}

function worldSurfaceOptions(args, keepAlive = false) {
  const workspaceRoot = parseNamedOption(args, "--workspace-root") ?? process.cwd();
  const configuredRoots = parseRepeatedOption(args, "--allowed-root");
  return {
    allowDestructive: args.includes("--allow-destructive"),
    allowedRoots: configuredRoots.length ? configuredRoots : [workspaceRoot],
    keepAlive,
    workspaceRoot,
  };
}

function setBatchExitCode(status) {
  if (status === "partial") process.exitCode = 2;
  else if (status === "rolled_back") process.exitCode = 3;
  else if (status === "failed") process.exitCode = 1;
}

async function waitForShutdown(close) {
  await new Promise((resolveShutdown) => {
    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      await close().catch(() => {});
      resolveShutdown();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

function parseNumberOption(args, option, fallback) {
  const value = parseNamedOption(args, option);
  if (value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${option} must be a positive number.`);
  }
  return number;
}

function stripFlag(args, flag) {
  return args.filter((arg) => arg !== flag);
}

function printValue(value) {
  if (typeof value === "string") {
    console.log(value);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

async function main(argv) {
  const [scope, verb, ...rest] = argv;

  if (!scope || scope === "--help" || scope === "-h") {
    usage();
    return;
  }

  if (scope === "--help-all" || (scope === "help" && ["all", "advanced"].includes(verb))) {
    usageAll();
    return;
  }

  if (scope === "validate") {
    const raw = [verb, ...rest].filter((value) => value !== undefined);
    const tool = parseNamedOption(raw, "--tool");
    const medium = parseNamedOption(raw, "--medium");
    const interactionMode = parseNamedOption(raw, "--interaction") ?? "auto-safe";
    const cleaned = stripOptions(raw, ["--tool", "--medium", "--interaction", "--simtime"]);

    if (tool || medium || cleaned.length === 1) {
      const [targetPath] = cleaned;
      if (!targetPath) throw new Error("Usage: nexus-sim validate <path> [--tool interaction.proof]");
      printValue(await validateTargetAction({
        interactionMode,
        medium,
        targetPath,
        toolId: tool,
      }));
      return;
    }

    const simtime = parseSimtimeOverride(raw);
    const [envName, scenarioName] = cleaned;
    if (!envName || !scenarioName) throw new Error("Usage: nexus-sim validate <env> <scenario> [--simtime <id>]");
    const result = await validateScenarioAction({ envName, scenarioName, simtime });
    if (!result.supported) {
      console.error(`Scenario "${scenarioName}" is not compatible with simtime "${result.adapter.id}".`);
      result.unsupported.forEach((entry) => console.error(`Unsupported: ${entry.index + 1}. ${entry.command}`));
      process.exitCode = 1;
      return;
    }
    console.log(`Check passed: ${scenarioName} is compatible with ${result.adapter.id}.`);
    printValue({
      artifacts: result.report.output?.artifacts ?? result.report.state?.artifacts ?? [],
      consoleErrors: result.report.state?.consoleErrors?.length ?? result.report.output?.consoleErrors?.length ?? 0,
      events: result.report.events,
      reportPath: result.reportPath,
      runDir: result.runDir,
      simtime: result.report.simtimeId,
      status: result.report.status,
    });
    return;
  }

  if (scope === "world") {
    const surface = createWorldActionSurface(worldSurfaceOptions(rest));
    try {
      if (verb === "session") {
        const [action, ...sessionArgs] = rest;
        if (action === "create") {
          const targetPath = parseNamedOption(sessionArgs, "--target");
          const adapter = parseNamedOption(sessionArgs, "--adapter") ?? "browser";
          const profilePath = parseNamedOption(sessionArgs, "--profile");
          const sessionId = parseNamedOption(sessionArgs, "--session-id");
          if (!targetPath) throw new Error("Usage: nexus-sim world session create --target <path> [--adapter browser|nexus-headless]");
          printValue(await surface.dispatch("world.session_create", { adapter, profilePath: profilePath ?? undefined, sessionId: sessionId ?? undefined, targetPath }));
          return;
        }
        const [sessionId] = sessionArgs.filter((value) => !value.startsWith("--"));
        if (!sessionId) throw new Error("Usage: nexus-sim world session <status|cancel|close> <session-id>");
        if (action === "status") printValue(await surface.dispatch("world.session_status", { sessionId }));
        else if (action === "cancel") printValue(await surface.dispatch("world.session_cancel", { sessionId }));
        else if (action === "close") printValue(await surface.dispatch("world.session_close", { sessionId }));
        else throw new Error("Usage: nexus-sim world session <create|status|cancel|close> [...options]");
        return;
      }
      if (verb === "observe") {
        const [sessionId] = rest;
        if (!sessionId) throw new Error("Usage: nexus-sim world observe <session-id>");
        printValue(await surface.dispatch("world.observe", { sessionId }));
        return;
      }
      if (verb === "batch") {
        if (rest[0] === "status") {
          const [sessionId, batchId] = rest.slice(1);
          if (!sessionId || !batchId) throw new Error("Usage: nexus-sim world batch status <session-id> <batch-id>");
          const result = await surface.dispatch("world.batch_status", { batchId, sessionId });
          printValue(result);
          setBatchExitCode(result.status);
          return;
        }
        const file = parseNamedOption(rest, "--file");
        if (!file) throw new Error("Usage: nexus-sim world batch --file <batch.json>");
        const request = JSON.parse(readFileSync(file, "utf8"));
        const result = await surface.dispatch("world.batch_command", request);
        printValue(result);
        setBatchExitCode(result.status);
        return;
      }
      throw new Error("Usage: nexus-sim world <session|observe|batch> [...options]");
    } finally {
      await surface.shutdown();
    }
  }

  if (scope === "mcp" && verb === "serve") {
    const { startMcpHttpServer, startMcpStdioServer } = await import("./mcp-server.js");
    const transport = parseNamedOption(rest, "--transport") ?? "stdio";
    const options = worldSurfaceOptions(rest, true);
    if (transport === "stdio") {
      const handle = await startMcpStdioServer(options);
      await waitForShutdown(handle.close);
      return;
    }
    if (transport === "http") {
      const host = parseNamedOption(rest, "--host") ?? "127.0.0.1";
      const port = parseNumberOption(rest, "--port", 8765);
      const allowedHosts = parseRepeatedOption(rest, "--allowed-host");
      const handle = await startMcpHttpServer({ ...options, allowedHosts, host, port });
      const address = handle.address;
      console.error(`NexusSimulator MCP listening on http://${host}:${address.port}/mcp`);
      await waitForShutdown(handle.close);
      return;
    }
    throw new Error("--transport must be stdio or http.");
  }

  if (scope === "tools" && (!verb || verb === "list")) {
    for (const tool of listToolActions()) {
      console.log(`${tool.id} ${tool.domain} ${tool.medium}`);
    }
    return;
  }

  if (scope === "tools" && verb === "inspect") {
    const [id] = rest;
    if (!id) throw new Error("Usage: nexus-sim tools inspect <id>");
    printValue(inspectToolAction(id));
    return;
  }

  if (scope === "tools" && verb === "run") {
    const [toolId, ...toolArgs] = rest;
    if (toolId === "kit.contract-proof") {
      const inputPath = parseNamedOption(toolArgs, "--input");
      const outputPath = parseNamedOption(toolArgs, "--output");
      const runId = parseNamedOption(toolArgs, "--run-id");
      const result = runKitContractProofAction({ inputPath, outputPath, runId });
      printValue(result);
      if (result.status !== "passed") process.exitCode = 1;
      return;
    }
    if (toolId === "kit.runtime-proof") {
      const manifestPath = parseNamedOption(toolArgs, "--manifest");
      const outputPath = parseNamedOption(toolArgs, "--output");
      const runId = parseNamedOption(toolArgs, "--run-id");
      const result = await runKitRuntimeProofAction({ manifestPath, outputPath, runId });
      printValue(result);
      if (result.status !== "passed") process.exitCode = 1;
      return;
    }
    if (toolId === "scene.agent-showcase") {
      const profilePath = parseNamedOption(toolArgs, "--profile");
      const runId = parseNamedOption(toolArgs, "--run-id");
      const viewport = parseNamedOption(toolArgs, "--viewport") ?? "1920x1080";
      const fps = parseNumberOption(toolArgs, "--fps", 30);
      const duration = parseNumberOption(toolArgs, "--duration", null);
      const outputPath = parseNamedOption(toolArgs, "--output");
      const nexusEngineRoot = parseNamedOption(toolArgs, "--nexus-engine-root") ?? process.env.NEXUS_ENGINE_ROOT;
      const nexusProtoKitsRoot = parseNamedOption(toolArgs, "--nexus-protokits-root") ?? process.env.NEXUS_PROTOKITS_ROOT;
      const useCodex = toolArgs.includes("--use-codex");
      const liveLoop = toolArgs.includes("--live-loop");
      const result = await runAgentShowcaseAction({ duration, fps, liveLoop, nexusEngineRoot, nexusProtoKitsRoot, outputPath, profilePath, runId, useCodex, viewport });
      printValue(result);
      if (result.status !== "passed") process.exitCode = 1;
      return;
    }
    if (toolId === "scene.editor-session") {
      const profilePath = parseNamedOption(toolArgs, "--profile");
      const runId = parseNamedOption(toolArgs, "--run-id");
      const viewport = parseNamedOption(toolArgs, "--viewport") ?? "1920x1080";
      const duration = parseNumberOption(toolArgs, "--duration", 305);
      const fps = parseNumberOption(toolArgs, "--fps", 24);
      const captureStyle = parseNamedOption(toolArgs, "--capture-style") ?? "human";
      const outputPath = parseNamedOption(toolArgs, "--output");
      const result = await runWorldEditorSessionAction({ captureStyle, duration, fps, outputPath, profilePath, runId, viewport });
      printValue(result);
      if (result.status !== "passed") process.exitCode = 1;
      return;
    }
    if (toolId !== "scene.build-proof") {
      throw new Error("Usage: nexus-sim tools run <kit.contract-proof|kit.runtime-proof|scene.build-proof|scene.agent-showcase|scene.editor-session> [...options]");
    }
    const profilePath = parseNamedOption(toolArgs, "--profile");
    const runId = parseNamedOption(toolArgs, "--run-id");
    const viewport = parseNamedOption(toolArgs, "--viewport") ?? "1280x720";
    const fps = parseNumberOption(toolArgs, "--fps", 30);
    const result = await runSceneBuildProofAction({ fps, profilePath, runId, viewport });
    printValue(result);
    if (result.status !== "passed") process.exitCode = 1;
    return;
  }

  if (scope === "report") {
    const action = verb;
    const [runId] = rest;
    if (action === "list") {
      printValue({ runs: listReports() });
      return;
    }
    if (!runId) throw new Error("Usage: nexus-sim report <get|summary|artifacts|console|logs|failed-step> <run-id>");
    if (action === "get") {
      printValue(loadReport(runId).report);
      return;
    }
    if (action === "summary") {
      printValue(reportSummary(runId));
      return;
    }
    if (action === "artifacts") {
      printValue({ artifacts: reportArtifacts(runId) });
      return;
    }
    if (action === "console") {
      printValue(reportConsole(runId));
      return;
    }
    if (action === "logs") {
      printValue(reportLogs(runId));
      return;
    }
    if (action === "failed-step") {
      printValue(reportFailedStep(runId));
      return;
    }
    throw new Error("Usage: nexus-sim report <get|list|summary|artifacts|console|logs|failed-step> [run-id]");
  }

  if (scope === "factory" && verb === "list") {
    printValue({ factories: listFactoryNames() });
    return;
  }

  if (scope === "factory" && verb === "config") {
    const [action, path] = rest;
    if (action !== "validate" || !path) throw new Error("Usage: nexus-sim factory config validate <path>");
    const loaded = loadFactoryConfig(path);
    printValue({
      path: loaded.sourcePath,
      summary: loaded.validation.summary,
      valid: loaded.validation.valid,
      warnings: loaded.validation.warnings,
    });
    return;
  }

  if (scope === "factory" && verb === "init") {
    const configPath = parseNamedOption(rest, "--config");
    const factoryName = parseNamedOption(rest, "--factory");
    const seed = parseNamedOption(rest, "--seed");
    const profile = parseNamedOption(rest, "--profile");
    const theme = parseNamedOption(rest, "--theme");
    const title = parseNamedOption(rest, "--title");
    const settings = parseSettingsOption(rest);
    const cleaned = stripOptions(rest, ["--config", "--factory", "--seed", "--profile", "--theme", "--title", "--settings"]);
    const [runId] = cleaned;
    if (!runId) throw new Error("Usage: nexus-sim factory init <run-id> --factory <FactoryName> --seed <seed> --profile <profile> [--theme <text>] [--settings <json>] [--config <path>]");
    printValue(initFactoryRun(runId, { configPath, factoryName, seed, profile, theme, title, settings }));
    return;
  }

  if (scope === "factory" && verb === "run") {
    const [runId] = rest;
    if (!runId) throw new Error("Usage: nexus-sim factory run <run-id>");
    printValue(runFactory(runId));
    return;
  }

  if (scope === "factory" && verb === "record") {
    const seconds = parseNumberOption(rest, "--seconds", 10);
    const viewport = parseNamedOption(rest, "--viewport") ?? "1280x720";
    const fps = parseNumberOption(rest, "--fps", 60);
    const captureMode = parseNamedOption(rest, "--capture-mode") ?? "deterministic";
    const cleaned = stripOptions(rest, ["--seconds", "--viewport", "--fps", "--capture-mode"]);
    const [runId] = cleaned;
    if (!runId) throw new Error("Usage: nexus-sim factory record <run-id> [--seconds 10] [--viewport 1280x720] [--fps 60] [--capture-mode deterministic|realtime]");
    printValue(await recordFactoryRun(runId, { captureMode, fps, seconds, viewport }));
    return;
  }

  if (scope === "factory" && verb === "improve") {
    const attempts = parseNumberOption(rest, "--attempts", 3);
    const seconds = parseNumberOption(rest, "--seconds", 10);
    const viewport = parseNamedOption(rest, "--viewport") ?? "1280x720";
    const fps = parseNumberOption(rest, "--fps", 60);
    const captureMode = parseNamedOption(rest, "--capture-mode") ?? "deterministic";
    const intent = parseNamedOption(rest, "--intent");
    const qualityPreset = parseNamedOption(rest, "--quality-preset");
    const cleaned = stripOptions(rest, ["--attempts", "--seconds", "--viewport", "--fps", "--capture-mode", "--intent", "--quality-preset"]);
    const [runId] = cleaned;
    if (!runId) throw new Error("Usage: nexus-sim factory improve <run-id> [--attempts 3] [--seconds 10] [--viewport 1280x720] [--fps 60] [--capture-mode deterministic|realtime] [--quality-preset hyperreal]");
    printValue(await improveFactoryRun(runId, { attempts, captureMode, fps, intent, qualityPreset, seconds, viewport }));
    return;
  }

  if (scope === "factory" && verb === "package") {
    const packId = parseNamedOption(rest, "--pack-id");
    const title = parseNamedOption(rest, "--title");
    const cleaned = stripOptions(rest, ["--pack-id", "--title"]);
    const [runId] = cleaned;
    if (!runId || !packId) throw new Error("Usage: nexus-sim factory package <run-id> --pack-id <pack-id>");
    printValue(packageFactoryRun(runId, { packId, title }));
    return;
  }

  if (scope === "factory" && verb === "status") {
    const [runId] = rest;
    if (!runId) throw new Error("Usage: nexus-sim factory status <run-id>");
    printValue(statusFactoryRun(runId));
    return;
  }

  if (scope === "factory" && verb === "graph") {
    const [runId] = rest;
    if (!runId) throw new Error("Usage: nexus-sim factory graph <run-id>");
    printValue(factoryGraph(runId));
    return;
  }

  if (scope === "asset-pack" && verb === "init") {
    const reference = parseNamedOption(rest, "--reference");
    const theme = parseNamedOption(rest, "--theme");
    const title = parseNamedOption(rest, "--title");
    const cleaned = stripOption(stripOption(stripOption(rest, "--reference"), "--theme"), "--title");
    const [packId] = cleaned;
    if (!packId) throw new Error("Usage: nexus-sim asset-pack init <pack-id> --reference <path> --theme <text>");
    printValue(initAssetPack(packId, { reference, theme, title }));
    return;
  }

  if (scope === "asset-pack" && verb === "run") {
    const iterations = parseNumberOption(rest, "--iterations", 5);
    const simtime = parseSimtimeOverride(rest) ?? "playwright";
    const cleaned = stripOption(stripOption(rest, "--iterations"), "--simtime");
    const [packId] = cleaned;
    if (!packId) throw new Error("Usage: nexus-sim asset-pack run <pack-id> [--iterations 5] [--simtime playwright]");
    if (simtime !== "playwright") {
      throw new Error("asset-pack run currently supports only --simtime playwright.");
    }
    printValue(runAssetPack(packId, { iterations, simtime }));
    return;
  }

  if (scope === "asset-pack" && verb === "record") {
    const seconds = parseNumberOption(rest, "--seconds", 60);
    const viewport = parseNamedOption(rest, "--viewport") ?? "1280x720";
    const cleaned = stripOption(stripOption(rest, "--seconds"), "--viewport");
    const [packId] = cleaned;
    if (!packId) throw new Error("Usage: nexus-sim asset-pack record <pack-id> [--seconds 60] [--viewport 1280x720]");
    printValue(await recordAssetPack(packId, { seconds, viewport }));
    return;
  }

  if (scope === "asset-pack" && verb === "improve") {
    const attempts = parseNumberOption(rest, "--attempts", 3);
    const seconds = parseNumberOption(rest, "--seconds", 10);
    const viewport = parseNamedOption(rest, "--viewport") ?? "1280x720";
    const intent = parseNamedOption(rest, "--intent");
    const cleaned = stripOption(stripOption(stripOption(stripOption(rest, "--attempts"), "--seconds"), "--viewport"), "--intent");
    const [packId] = cleaned;
    if (!packId) throw new Error("Usage: nexus-sim asset-pack improve <pack-id> [--attempts 3] [--seconds 10] [--viewport 1280x720]");
    printValue(await improveAssetPack(packId, { attempts, seconds, viewport, intent }));
    return;
  }

  if (scope === "asset-pack" && verb === "package") {
    const [packId] = rest;
    if (!packId) throw new Error("Usage: nexus-sim asset-pack package <pack-id>");
    printValue(packageAssetPack(packId));
    return;
  }

  if (scope === "asset-pack" && verb === "status") {
    const [packId] = rest;
    if (!packId) throw new Error("Usage: nexus-sim asset-pack status <pack-id>");
    printValue(statusAssetPack(packId));
    return;
  }

  if (scope === "itch" && verb === "auth") {
    const [action] = rest;
    if (action === "login") {
      printValue(await itchAuthLogin({ headed: rest.includes("--headed"), timeoutMs: parseNumberOption(rest, "--timeout-ms", 180000) }));
      return;
    }
    if (action === "status") {
      printValue(itchAuthStatus());
      return;
    }
    throw new Error("Usage: nexus-sim itch auth login --headed | nexus-sim itch auth status");
  }

  if (scope === "itch" && verb === "draft") {
    const [action, packId] = rest;
    if (!action || !packId) {
      throw new Error("Usage: nexus-sim itch draft <create|upload|verify> <pack-id>");
    }
    const approved = rest.includes("--approved");
    const headed = rest.includes("--headed");
    if (action === "create") {
      const project = parseNamedOption(rest, "--project");
      printValue(await createItchDraft(packId, { approved, headed, project }));
      return;
    }
    if (action === "upload") {
      const zip = parseNamedOption(rest, "--zip");
      printValue(await uploadItchDraft(packId, { approved, headed, zip }));
      return;
    }
    if (action === "verify") {
      printValue(await verifyItchDraft(packId, { headed }));
      return;
    }
    throw new Error("Usage: nexus-sim itch draft <create|upload|verify> <pack-id>");
  }

  if (scope === "env" && verb === "create") {
    const simtime = parseSimtimeOverride(rest) ?? "headless";
    const args = stripOption(rest, "--simtime");
    const [name] = args;
    if (!name) throw new Error("Missing environment name.");
    const env = createEnvironment(name, simtime);
    console.log(`Created environment: ${env.name} (simtime: ${env.simtime})`);
    return;
  }

  if (scope === "env" && verb === "list") {
    const envs = listEnvironments();
    if (!envs.length) {
      console.log("No environments yet.");
      return;
    }
    for (const env of envs) console.log(env.name);
    return;
  }

  if (scope === "app" && verb === "detect") {
    const [targetPath] = rest;
    if (!targetPath) throw new Error("Usage: nexus-sim app detect <path>");
    printValue(detectAppPath(targetPath));
    return;
  }

  if (scope === "app" && verb === "attach") {
    const [envName, targetPath] = rest;
    if (!envName || !targetPath) throw new Error("Usage: nexus-sim app attach <env> <path>");
    printValue(attachApp(envName, targetPath));
    return;
  }

  if (scope === "app" && verb === "smoke") {
    const replace = rest.includes("--replace");
    const name = parseNamedOption(rest, "--name") ?? "smoke";
    const cleaned = stripOption(stripFlag(rest, "--replace"), "--name");
    const [envName] = cleaned;
    if (!envName) throw new Error("Usage: nexus-sim app smoke <env> [--replace] [--name <scenario>]");
    const result = createSmokeScenario(envName, { name, replace });
    if (result.skipped) {
      console.log(`Scenario "${result.scenarioName}" already exists. Use --replace to recreate it.`);
      return;
    }
    const action = result.replaced ? "Recreated" : "Created";
    console.log(`${action} smoke scenario "${result.scenarioName}" with ${result.events.length} events.`);
    return;
  }

  if (scope === "simtime" && verb === "list") {
    const simtimes = listSimtimes();
    for (const simtime of simtimes) {
      console.log(`${simtime.id} ${simtime.type} ${simtime.surface}`);
    }
    return;
  }

  if (scope === "simtime" && verb === "inspect") {
    const [id] = rest;
    if (!id) throw new Error("Missing simtime id.");
    const manifest = getSimtimeManifest(id);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (scope === "simspace" && verb === "run") {
    const { envName, scenarioName, simtime } = parseScenarioTarget(rest);
    if (!envName || !scenarioName) throw new Error("Usage: nexus-sim simspace run <env> <scenario> [--simtime <id>]");
    const result = await runScenarioInSimSpace(envName, scenarioName, simtime);
    printValue(result.report);
    return;
  }

  if (scope === "simspace" && verb === "run-chunked") {
    const simtime = parseSimtimeOverride(rest);
    const resumeRunId = parseNamedOption(rest, "--resume");
    const chunkSize = parseNumberOption(rest, "--chunk-size", 5);
    const stopAfterCheckpoint = rest.includes("--stop-after-checkpoint");
    const cleaned = stripOption(stripOption(stripOption(stripFlag(rest, "--stop-after-checkpoint"), "--simtime"), "--resume"), "--chunk-size");
    const [envName, scenarioName] = cleaned;
    if ((!envName || !scenarioName) && !resumeRunId) {
      throw new Error("Usage: nexus-sim simspace run-chunked <env> <scenario> [--chunk-size 5] [--resume <run-id>] [--stop-after-checkpoint] [--simtime <id>]");
    }
    const result = await runScenarioInSimSpaceChunked(envName, scenarioName, simtime, {
      chunkSize,
      resumeRunId,
      stopAfterCheckpoint,
    });
    printValue(result.report);
    return;
  }

  if (scope === "scenario" && verb === "append") {
    const [envName, scenarioName, command, ...argParts] = rest;
    if (!envName || !scenarioName || !command) {
      throw new Error("Usage: nexus-sim scenario append <env> <scenario> <command> [args-json]");
    }
    createScenario(envName, scenarioName);
    const argsJson = parseArgsJson(argParts.length ? argParts.join(" ") : undefined);
    const event = appendScenarioEvent(envName, scenarioName, { command, args: argsJson });
    console.log(`Appended event to ${envName}/${scenarioName}: ${event.command}`);
    return;
  }

  if (scope === "scenario" && verb === "check") {
    const { envName, scenarioName, simtime } = parseScenarioTarget(rest);
    if (!envName || !scenarioName) {
      throw new Error("Usage: nexus-sim scenario check <env> <scenario> [--simtime <id>]");
    }
    const result = checkScenario(envName, scenarioName, simtime);
    result.results.forEach((entry, index) => {
      const prefix = entry.supported ? "✓" : "✗";
      console.log(`${prefix} ${index + 1}. ${entry.command}`);
    });
    if (result.supported) {
      console.log(`Scenario "${scenarioName}" is compatible with simtime "${result.adapter.id}".`);
      return;
    }
    console.error(`Scenario "${scenarioName}" has unsupported commands for simtime "${result.adapter.id}".`);
    process.exitCode = 1;
    return;
  }

  if (scope === "scenario" && verb === "list") {
    const [envName] = rest;
    if (!envName) throw new Error("Missing environment name.");
    const scenarios = listScenarios(envName);
    if (!scenarios.length) {
      console.log(`No scenarios in ${envName}.`);
      return;
    }
    for (const scenario of scenarios) console.log(scenario);
    return;
  }

  if (scope === "scenario" && verb === "show") {
    const [envName, scenarioName] = rest;
    if (!envName || !scenarioName) throw new Error("Usage: nexus-sim scenario show <env> <scenario>");
    const events = showScenario(envName, scenarioName);
    printScenarioEvents(events);
    return;
  }

  if (scope === "scenario" && verb === "run") {
    const { envName, scenarioName, simtime } = parseScenarioTarget(rest);
    if (!envName || !scenarioName) throw new Error("Usage: nexus-sim scenario run <env> <scenario> [--simtime <id>]");
    const result = await runScenario(envName, scenarioName, simtime);
    printValue(result.output);
    console.log("");
    console.log("State:");
    console.log(JSON.stringify(result.state, null, 2));
    return;
  }

  usage();
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
