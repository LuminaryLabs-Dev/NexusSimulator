#!/usr/bin/env node
import { join } from "node:path";
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

function usage() {
  console.log([
    "nexus-sim",
    "",
    "Safe app validation through append-only scenarios and disposable SimSpace runs.",
    "",
    "Usage:",
    "  nexus-sim validate <env> <scenario> [--simtime <id>]",
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
    "  attach app -> choose scenario -> check -> simspace run",
    "",
    "Notes:",
    "  simspace run stages a disposable app copy before running.",
    "  scenario run touches the attached app path directly; see --help-all.",
    "  nexus-sim --help-all shows advanced factory, asset-pack, itch, and raw scenario commands.",
  ].join("\n"));
}

function usageAll() {
  console.log([
    "nexus-sim",
    "",
    "Usage:",
    "  nexus-sim validate <env> <scenario> [--simtime <id>]",
    "  nexus-sim env create <name> [--simtime <id>]",
    "  nexus-sim env list",
    "  nexus-sim app detect <path>",
    "  nexus-sim app attach <env> <path>",
    "  nexus-sim app smoke <env> [--replace] [--name <scenario>]",
    "  nexus-sim simtime list",
    "  nexus-sim simtime inspect <id>",
    "  nexus-sim simspace run <env> <scenario> [--simtime <id>]",
    "  nexus-sim simspace run-chunked <env> <scenario> [--chunk-size 5] [--resume <run-id>] [--stop-after-checkpoint] [--simtime <id>]",
    "  nexus-sim scenario append <env> <scenario> <command> [args-json]",
    "  nexus-sim scenario list <env>",
    "  nexus-sim scenario show <env> <scenario>",
    "  nexus-sim scenario check <env> <scenario> [--simtime <id>]",
    "  nexus-sim scenario run <env> <scenario> [--simtime <id>]",
    "  nexus-sim factory list",
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
    const { envName, scenarioName, simtime } = parseScenarioTarget([verb, ...rest]);
    if (!envName || !scenarioName) throw new Error("Usage: nexus-sim validate <env> <scenario> [--simtime <id>]");
    const check = checkScenario(envName, scenarioName, simtime);
    const unsupported = check.results.filter((entry) => !entry.supported);
    if (unsupported.length) {
      console.error(`Scenario "${scenarioName}" is not compatible with simtime "${check.adapter.id}".`);
      unsupported.forEach((entry) => console.error(`Unsupported: ${entry.index + 1}. ${entry.command}`));
      process.exitCode = 1;
      return;
    }
    console.log(`Check passed: ${scenarioName} is compatible with ${check.adapter.id}.`);
    const result = await runScenarioInSimSpace(envName, scenarioName, simtime);
    printValue({
      artifacts: result.report.output?.artifacts ?? result.report.state?.artifacts ?? [],
      consoleErrors: result.report.state?.consoleErrors?.length ?? result.report.output?.consoleErrors?.length ?? 0,
      events: result.report.events,
      reportPath: join(result.runDir, "report.json"),
      runDir: result.runDir,
      simtime: result.report.simtimeId,
      status: result.report.status,
    });
    return;
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
