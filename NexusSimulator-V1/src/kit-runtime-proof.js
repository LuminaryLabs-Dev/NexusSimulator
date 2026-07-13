import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

function check(name, passed, detail) {
  return { detail, name, passed: Boolean(passed) };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function descriptor(value) {
  if (typeof value === "function") return "[function]";
  if (Array.isArray(value)) return value.map(descriptor);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, descriptor(item)]));
  }
  return value;
}

function readManifest(path) {
  if (!path || !existsSync(path)) throw new Error(`Runtime proof manifest does not exist: ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (parsed.schemaVersion !== "kit.runtime-proof.v1") throw new Error("Runtime proof requires schemaVersion kit.runtime-proof.v1.");
  return parsed;
}

function copyPackage(source, target) {
  cpSync(source, target, {
    recursive: true,
    filter(path) {
      const name = basename(path);
      return ![".git", "node_modules", "output", "runs"].includes(name);
    },
  });
}

function runCommand(command, cwd) {
  if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string")) {
    return { command, ok: false, error: "commands must be non-empty string arrays" };
  }
  const result = spawnSync(command[0], command.slice(1), { cwd, encoding: "utf8", shell: false, timeout: 120000 });
  return {
    command,
    ok: !result.error && result.status === 0,
    status: result.status,
    stdoutTail: String(result.stdout ?? "").slice(-2000),
    stderrTail: String(result.stderr ?? result.error?.message ?? "").slice(-2000),
  };
}

function flattenedOutput(value) {
  if (Array.isArray(value)) return value.flatMap(flattenedOutput);
  if (value && typeof value === "object") return Object.values(value).flatMap(flattenedOutput);
  return [String(value)];
}

export async function runKitRuntimeProof({ manifestPath, outputPath = null, runId = null }) {
  const resolvedManifest = resolve(manifestPath);
  const manifest = readManifest(resolvedManifest);
  const packageRoot = resolve(dirname(resolvedManifest), manifest.packageRoot ?? ".");
  const configuredEngineRoot = manifest.engineRoot ?? process.env.NEXUS_ENGINE_PROJECT_ROOT;
  const engineRoot = resolve(dirname(resolvedManifest), configuredEngineRoot ?? "");
  if (!existsSync(packageRoot)) throw new Error(`Kit package root does not exist: ${packageRoot}`);
  if (!configuredEngineRoot || !existsSync(engineRoot)) throw new Error("Runtime proof requires engineRoot or NEXUS_ENGINE_PROJECT_ROOT.");

  const stageRoot = mkdtempSync(join(tmpdir(), "nexus-kit-runtime-proof-"));
  const stagedPackage = join(stageRoot, "kit");
  const stagedEngine = join(stageRoot, "engine");
  mkdirSync(stagedPackage, { recursive: true });
  mkdirSync(stagedEngine, { recursive: true });
  copyPackage(packageRoot, stagedPackage);
  cpSync(join(engineRoot, "src"), join(stagedEngine, "src"), { recursive: true });
  if (existsSync(join(engineRoot, "package.json"))) cpSync(join(engineRoot, "package.json"), join(stagedEngine, "package.json"));

  const modulePath = resolve(stagedPackage, manifest.module);
  const engineModulePath = resolve(stagedEngine, manifest.engineModule ?? "src/index.js");
  const checks = [];
  const commandResults = [];
  let kit = null;
  let engine = null;
  let adapter = null;
  let initialSnapshot = null;
  let afterSnapshot = null;
  let resetSnapshot = null;
  let restoredSnapshot = null;
  let firstOutputs = [];
  let replayOutputs = [];

  try {
    checks.push(check("moduleExists", existsSync(modulePath), modulePath));
    const syntax = runCommand([process.execPath, "--check", modulePath], stagedPackage);
    commandResults.push(syntax);
    checks.push(check("syntax", syntax.ok, syntax));

    const source = existsSync(modulePath) ? readFileSync(modulePath, "utf8") : "";
    const forbidden = (manifest.forbiddenImports ?? ["document.", "window.", "canvas", "three", "browser-host-lifecycle"])
      .filter((term) => source.toLowerCase().includes(String(term).toLowerCase()));
    checks.push(check("rendererIsolation", forbidden.length === 0, { forbidden }));

    const kitModule = await import(`${pathToFileURL(modulePath).href}?proof=${Date.now()}`);
    const engineModule = await import(`${pathToFileURL(engineModulePath).href}?proof=${Date.now()}`);
    const factory = kitModule[manifest.exportName ?? "createKit"] ?? kitModule.default;
    checks.push(check("factoryExport", typeof factory === "function", manifest.exportName ?? "createKit"));
    if (typeof factory === "function") kit = await factory(manifest.factoryOptions ?? {});
    checks.push(check("kitObject", Boolean(kit && typeof kit === "object"), kit?.id ?? null));
    checks.push(check("stableId", Boolean(kit?.id && (!manifest.kitId || kit.id === manifest.kitId)), { expected: manifest.kitId, actual: kit?.id }));
    checks.push(check("domainServiceId", /^n-[a-z0-9-]+-kit$/.test(String(kit?.id ?? "")) || manifest.allowLegacyId === true, kit?.id));
    checks.push(check("namespacedProvides", Array.isArray(kit?.provides) && kit.provides.length > 0 && kit.provides.every((item) => String(item).includes(":")), kit?.provides));
    checks.push(check("namespacedRequires", Array.isArray(kit?.requires) && kit.requires.every((item) => String(item).includes(":")), kit?.requires));
    checks.push(check("versionMetadata", Boolean(kit?.metadata?.version), kit?.metadata?.version));
    checks.push(check("stabilityMetadata", Boolean(kit?.metadata?.stability), kit?.metadata?.stability));
    checks.push(check("resetPolicy", Boolean(kit?.metadata?.resetPolicy), kit?.metadata?.resetPolicy));
    checks.push(check("snapshotPolicy", Boolean(kit?.metadata?.snapshotPolicy), kit?.metadata?.snapshotPolicy));

    const secondKit = typeof factory === "function" ? await factory(manifest.factoryOptions ?? {}) : null;
    checks.push(check("deterministicDescriptor", JSON.stringify(descriptor(kit)) === JSON.stringify(descriptor(secondKit)), null));

    if (kit && typeof engineModule.createEngine === "function") {
      engine = engineModule.createEngine({ renderer: engineModule.createHeadlessRenderer?.() });
      engine.installKit(kit, manifest.installOptions ?? {});
    }
    checks.push(check("engineInstall", Boolean(engine?.kits?.includes(kit)), { installed: engine?.kits?.map((entry) => entry.id) ?? [] }));

    const adapterFactory = kitModule[manifest.proofAdapterExport ?? "createProofAdapter"];
    checks.push(check("proofAdapterExport", typeof adapterFactory === "function", manifest.proofAdapterExport ?? "createProofAdapter"));
    if (typeof adapterFactory === "function") adapter = await adapterFactory({ engine, kit, manifest });
    const lifecycleMethods = ["handle", "snapshot", "loadSnapshot", "reset"];
    checks.push(check("proofAdapterLifecycle", lifecycleMethods.every((name) => typeof adapter?.[name] === "function"), lifecycleMethods));
    if (adapter && lifecycleMethods.every((name) => typeof adapter[name] === "function")) {
      initialSnapshot = clone(await adapter.snapshot());
      for (const input of manifest.inputs ?? []) firstOutputs.push(await adapter.handle(clone(input)));
      afterSnapshot = clone(await adapter.snapshot());
      for (const input of manifest.inputs ?? []) replayOutputs.push(await adapter.handle(clone(input)));
      const expectedOutputs = (manifest.expectedOutputs ?? []).map(String);
      const observed = flattenedOutput(firstOutputs);
      checks.push(check("declaredOutputs", expectedOutputs.every((item) => observed.some((value) => value.includes(item))), { expectedOutputs, observed }));
      checks.push(check("duplicateReplay", JSON.stringify(descriptor(firstOutputs)) === JSON.stringify(descriptor(replayOutputs)) || replayOutputs.every((item) => item?.duplicateIgnored === true), replayOutputs));
      await adapter.reset();
      resetSnapshot = clone(await adapter.snapshot());
      checks.push(check("reset", JSON.stringify(resetSnapshot) === JSON.stringify(initialSnapshot), { initialSnapshot, resetSnapshot }));
      await adapter.loadSnapshot(clone(afterSnapshot));
      restoredSnapshot = clone(await adapter.snapshot());
      checks.push(check("snapshotRoundTrip", JSON.stringify(restoredSnapshot) === JSON.stringify(afterSnapshot), { afterSnapshot, restoredSnapshot }));
    }

    const publicImportPath = manifest.publicImport ? resolve(stagedPackage, manifest.publicImport) : modulePath;
    try {
      await import(`${pathToFileURL(publicImportPath).href}?publicProof=${Date.now()}`);
      checks.push(check("publicImport", true, publicImportPath));
    } catch (error) {
      checks.push(check("publicImport", false, error.message));
    }
    for (const command of manifest.testCommands ?? []) {
      const result = runCommand(command, stagedPackage);
      commandResults.push(result);
      checks.push(check(`testCommand:${command.join(" ")}`, result.ok, result));
    }
  } catch (error) {
    checks.push(check("runtimeException", false, error.stack ?? error.message));
  }

  const errors = checks.filter((entry) => !entry.passed).map((entry) => entry.name);
  const report = {
    checks,
    commandResults,
    errors,
    kitId: kit?.id ?? manifest.kitId ?? null,
    manifestPath: resolvedManifest,
    outputs: { first: descriptor(firstOutputs), replay: descriptor(replayOutputs) },
    promotionLevel: errors.length === 0 ? "runtime-proven" : "proof-only",
    runId,
    simulator: "NexusSimulator-V1/kit-runtime-proof",
    snapshots: { initial: initialSnapshot, after: afterSnapshot, reset: resetSnapshot, restored: restoredSnapshot },
    status: errors.length === 0 ? "passed" : "failed",
    summary: errors.length === 0 ? "Kit implementation passed runtime proof." : `Kit implementation failed ${errors.length} runtime checks.`,
    tool: "kit.runtime-proof",
  };
  const resolvedOutput = resolve(outputPath ?? `${resolvedManifest}.nexus-runtime-proof.json`);
  mkdirSync(dirname(resolvedOutput), { recursive: true });
  writeFileSync(resolvedOutput, `${JSON.stringify(report, null, 2)}\n`);
  rmSync(stageRoot, { force: true, recursive: true });
  return { ...report, reportPath: resolvedOutput };
}
