import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

export const nexusEngineRuntimeSupports = [
  "startRuntime",
  "runSessionProof",
  "runSwingProof",
  "runWallrunClimbRecoveryProof",
  "assertSessionDuration",
  "assertSwingAttached",
  "assertWallrunClimbRecovery",
  "assertProgressAdvanced",
  "assertNoSoftlock",
  "captureSessionFrame",
  "summarizeSession",
  "stopRuntime",
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonIfExists(path) {
  if (!path || !existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function requireConfiguredPath(value, label, envName) {
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(
    `NexusEngine ${label} is not configured. Provide it in the scenario/environment or set ${envName}.`,
  );
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runtimeUrlPort(baseUrl) {
  try {
    return new URL(baseUrl).port || "17000";
  } catch {
    return "17000";
  }
}

function curlJson(url, timeoutSeconds = 2) {
  const proc = spawnSync("curl", ["--http2-prior-knowledge", "-fsS", "--max-time", String(timeoutSeconds), url], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (proc.status !== 0) {
    return { ok: false, stderr: proc.stderr?.trim() ?? "", stdout: proc.stdout?.trim() ?? "" };
  }
  try {
    return { ok: true, body: JSON.parse(proc.stdout) };
  } catch (err) {
    return { ok: false, stderr: `invalid json: ${err}`, stdout: proc.stdout?.trim() ?? "" };
  }
}

function stopSpawnedRuntime(runtime) {
  if (!runtime?.pid) return;
  try {
    process.kill(-runtime.pid, "SIGTERM");
  } catch {
    try {
      runtime.kill("SIGTERM");
    } catch {
      // Ignore teardown errors; readiness checks catch stale processes on the next run.
    }
  }
}

export function createNexusEngineRuntimeAdapter(context = {}) {
  const id = "nexusengine-runtime";
  const type = "native-runtime";
  const surface = "nexusengine";
  let state;

  function reset() {
    const env = context.env ?? {};
    state = {
      artifacts: [],
      baseUrl: env.baseUrl ?? "http://127.0.0.1:17000",
      checks: [],
      codexTool: env.codexTool ?? process.env.NEXUS_ENGINE_CODEX_TOOL ?? null,
      events: [],
      lastProof: null,
      logs: [],
      projectRoot: env.projectRoot ?? process.env.NEXUS_ENGINE_PROJECT_ROOT ?? null,
      proofRoot: env.proofRoot ?? ".nexus-simulator/artifacts/nexusengine-runtime/session-proof",
      runtimeExecutable: env.runtimeExecutable ?? process.env.NEXUS_ENGINE_RUNTIME_EXECUTABLE ?? null,
      runtimeProcess: null,
      runtimeProcessStartedByAdapter: false,
      runtimeStarted: false,
      sessionLabel: env.sessionLabel ?? process.env.NEXUS_ENGINE_SESSION_LABEL ?? "nexusengine-session",
      sessionProofCommand: env.sessionProofCommand ?? process.env.NEXUS_ENGINE_SESSION_PROOF_COMMAND ?? null,
      status: "passed",
      swingProofCommand: env.swingProofCommand ?? process.env.NEXUS_ENGINE_SWING_PROOF_COMMAND ?? null,
      wallrunProofCommand: env.wallrunProofCommand ?? process.env.NEXUS_ENGINE_WALLRUN_PROOF_COMMAND ?? null,
    };
  }

  function log(message) {
    state.logs.push(message);
  }

  function check(name, passed, detail = "") {
    state.checks.push({ name, passed, detail });
    if (!passed) state.status = "failed";
  }

  function runCodex(args, cwd) {
    const codexTool = requireConfiguredPath(
      state.codexTool,
      "Codex tool path",
      "NEXUS_ENGINE_CODEX_TOOL",
    );
    const proc = spawnSync("python3", [codexTool, ...args], {
      cwd: cwd ?? dirname(dirname(codexTool)),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    let stdoutJson = null;
    if (proc.stdout && proc.stdout.trim()) {
      try {
        stdoutJson = JSON.parse(proc.stdout);
      } catch {
        stdoutJson = null;
      }
    }
    return {
      args,
      ok: proc.status === 0 && (!stdoutJson || stdoutJson.ok !== false),
      status: proc.status,
      stdout: proc.stdout,
      stderr: proc.stderr,
      stdoutJson,
    };
  }

  function post(event) {
    state.events.push(clone(event));
    const args = event.args ?? {};

    switch (event.command) {
      case "startRuntime": {
        state.baseUrl = args.baseUrl ?? state.baseUrl;
        state.codexTool = args.codexTool ?? state.codexTool;
        state.projectRoot = args.projectRoot ?? state.projectRoot;
        state.proofRoot = args.proofRoot ?? state.proofRoot;
        state.runtimeExecutable = args.runtimeExecutable ?? state.runtimeExecutable;
        const readyUrl = `${state.baseUrl.replace(/\/$/, "")}/runtime/state`;
        const existing = curlJson(readyUrl, 1);
        if (existing.ok && existing.body?.ready === true) {
          state.runtimeStarted = true;
          state.runtimeProcessStartedByAdapter = false;
          log(`runtime already reachable at ${state.baseUrl}`);
          check("runtimeReachable", true, state.baseUrl);
          return;
        }

        const runtimeExecutable = requireConfiguredPath(
          state.runtimeExecutable,
          "runtime executable",
          "NEXUS_ENGINE_RUNTIME_EXECUTABLE",
        );
        const configuredProjectRoot = requireConfiguredPath(
          state.projectRoot,
          "project root",
          "NEXUS_ENGINE_PROJECT_ROOT",
        );
        if (!existsSync(runtimeExecutable)) {
          check("runtimeExecutableExists", false, runtimeExecutable);
          throw new Error(`NexusEngine runtime executable missing: ${runtimeExecutable}`);
        }

        const proofRoot = resolve(state.proofRoot);
        const projectRoot = resolve(configuredProjectRoot);
        const capturePath = resolve(args.capturePath ?? `${proofRoot}/frame-captures`);
        ensureDir(capturePath);
        const runtimeArgs = [
          "--headless",
          "--project-root",
          projectRoot,
          "--runtime-bundle",
          resolve(projectRoot, "Assets/Library/runtime.bundle.json"),
          "--scene-package",
          resolve(projectRoot, "Assets/Library/scene.nxq1"),
          "--scene",
          resolve(projectRoot, "Assets/Scenes/default.xml"),
          "--http-port",
          runtimeUrlPort(state.baseUrl),
          "--capture-path",
          capturePath,
          "--quality-tier",
          args.qualityTier ?? "shipping",
          "--perf-profile",
          args.perfProfile ?? "proof",
        ];
        const logPath = resolve(args.runtimeLogPath ?? `${proofRoot}/runtime-host.log`);
        ensureDir(dirname(logPath));
        const logFd = openSync(logPath, "a");
        const runtimeEnv = {
          ...process.env,
          NEXUS_HTTP_PORT: runtimeUrlPort(state.baseUrl),
          NEXUS_CAPTURE_DIR: capturePath,
          NEXUS_LOG_DIR: dirname(logPath),
        };
        if (args.maxFrames !== undefined) {
          runtimeEnv.NEXUS_HOST_MAX_FRAMES = String(args.maxFrames);
        }
        const runtime = spawn(runtimeExecutable, runtimeArgs, {
          cwd: dirname(runtimeExecutable),
          detached: true,
          stdio: ["ignore", logFd, logFd],
          env: runtimeEnv,
        });
        runtime.unref();
        state.runtimeProcess = runtime;
        state.runtimeProcessStartedByAdapter = true;
        state.runtimeStarted = true;
        state.artifacts.push(logPath);
        log(`spawned runtime pid=${runtime.pid ?? "unknown"} ${runtimeExecutable}`);

        const timeoutMs = Number(args.readyTimeoutMs ?? 45000);
        const startedAt = Date.now();
        let lastReady = null;
        while (Date.now() - startedAt < timeoutMs) {
          lastReady = curlJson(readyUrl, 2);
          if (lastReady.ok && lastReady.body?.ready === true) {
            check("runtimeReachable", true, state.baseUrl);
            check("runtimeExecutableExists", true, runtimeExecutable);
            log(`runtime ready at ${state.baseUrl}`);
            return;
          }
          if (runtime.exitCode !== null) break;
          sleepMs(250);
        }
        stopSpawnedRuntime(runtime);
        state.runtimeProcess = null;
        state.runtimeProcessStartedByAdapter = false;
        state.runtimeStarted = false;
        check("runtimeReachable", false, JSON.stringify(lastReady ?? { ok: false }));
        throw new Error(`NexusEngine runtime did not become ready at ${state.baseUrl}.`);
      }
      case "runSessionProof": {
        const proofRoot = resolve(args.proofRoot ?? state.proofRoot);
        state.proofRoot = proofRoot;
        const proofCommand = requireConfiguredPath(
          args.command ?? state.sessionProofCommand,
          "session proof command",
          "NEXUS_ENGINE_SESSION_PROOF_COMMAND",
        );
        const command = [
          proofCommand,
          "--duration-seconds",
          String(args.durationSeconds ?? 60),
          "--target-input-hz",
          String(args.targetInputHz ?? 5),
          "--sample-every-seconds",
          String(args.sampleEverySeconds ?? 15),
          "--base-url",
          args.baseUrl ?? state.baseUrl,
          "--proof-root",
          proofRoot,
        ];
        if (args.expectRouteProgress ?? true) command.push("--expect-route-progress");
        if (args.expectMinAct) command.push("--expect-min-act", String(args.expectMinAct));
        if (args.captureFrames ?? true) command.push("--capture-frames");
        command.push("--session-label", args.sessionLabel ?? state.sessionLabel);
        for (const field of args.requireStateField ?? []) {
          command.push("--require-state-field", String(field));
        }
        const result = runCodex(command, args.cwd);
        state.lastProof = result.stdoutJson;
        state.artifacts.push(`${proofRoot}/session-proof.json`);
        state.artifacts.push(`${proofRoot}/session-proof.md`);
        check(
          "sessionProofCommand",
          result.ok,
          result.ok
            ? proofRoot
            : JSON.stringify({
                status: result.status,
                stderr: result.stderr?.trim() ?? "",
                stdout: result.stdout?.trim()?.slice(0, 1000) ?? "",
              }),
        );
        log(`session proof ${result.ok ? "passed" : "failed"} at ${proofRoot}`);
        if (!result.ok) {
          throw new Error(`NexusEngine runtime session proof failed. See ${proofRoot}/session-proof.json`);
        }
        return;
      }
      case "runSwingProof": {
        const proofRoot = resolve(args.proofRoot ?? state.proofRoot);
        state.proofRoot = proofRoot;
        const proofCommand = requireConfiguredPath(
          args.command ?? state.swingProofCommand,
          "swing proof command",
          "NEXUS_ENGINE_SWING_PROOF_COMMAND",
        );
        const command = [
          proofCommand,
          "--base-url",
          args.baseUrl ?? state.baseUrl,
          "--proof-root",
          proofRoot,
          "--fire-hold-frames",
          String(args.fireHoldFrames ?? 6000),
          "--sample-count",
          String(args.sampleCount ?? 5),
          "--sample-delay-seconds",
          String(args.sampleDelaySeconds ?? 0.1),
        ];
        const result = runCodex(command, args.cwd);
        state.lastProof = result.stdoutJson;
        state.artifacts.push(`${proofRoot}/swing-proof.json`);
        state.artifacts.push(`${proofRoot}/swing-proof.md`);
        check(
          "swingProofCommand",
          result.ok,
          result.ok
            ? proofRoot
            : JSON.stringify({
                status: result.status,
                stderr: result.stderr?.trim() ?? "",
                stdout: result.stdout?.trim()?.slice(0, 1000) ?? "",
              }),
        );
        log(`swing proof ${result.ok ? "passed" : "failed"} at ${proofRoot}`);
        if (!result.ok) {
          throw new Error(`NexusEngine runtime swing proof failed. See ${proofRoot}/swing-proof.json`);
        }
        return;
      }
      case "runWallrunClimbRecoveryProof": {
        const proofRoot = resolve(args.proofRoot ?? state.proofRoot);
        state.proofRoot = proofRoot;
        const proofCommand = requireConfiguredPath(
          args.command ?? state.wallrunProofCommand,
          "wallrun proof command",
          "NEXUS_ENGINE_WALLRUN_PROOF_COMMAND",
        );
        const command = [
          proofCommand,
          "--base-url",
          args.baseUrl ?? state.baseUrl,
          "--proof-root",
          proofRoot,
          "--traversal-hold-frames",
          String(args.traversalHoldFrames ?? 1200),
          "--spawn-distance-tolerance",
          String(args.spawnDistanceTolerance ?? 8),
        ];
        const result = runCodex(command, args.cwd);
        state.lastProof = result.stdoutJson;
        state.artifacts.push(`${proofRoot}/wallrun-climb-recovery-proof.json`);
        state.artifacts.push(`${proofRoot}/wallrun-climb-recovery-proof.md`);
        check(
          "wallrunClimbRecoveryProofCommand",
          result.ok,
          result.ok
            ? proofRoot
            : JSON.stringify({
                status: result.status,
                stderr: result.stderr?.trim() ?? "",
                stdout: result.stdout?.trim()?.slice(0, 1000) ?? "",
              }),
        );
        log(`wallrun/climb/recovery proof ${result.ok ? "passed" : "failed"} at ${proofRoot}`);
        if (!result.ok) {
          throw new Error(
            `NexusEngine runtime wallrun/climb/recovery proof failed. See ${proofRoot}/wallrun-climb-recovery-proof.json`,
          );
        }
        return;
      }
      case "assertSessionDuration": {
        const proof = state.lastProof ?? readJsonIfExists(resolve(args.proofPath ?? `${state.proofRoot}/session-proof.json`));
        const expected = Number(args.durationSeconds ?? args.minSeconds ?? 60);
        const observed = Number(proof?.elapsed_simulated_seconds ?? 0);
        const passed = observed >= expected;
        check("sessionDuration", passed, `${observed}/${expected}`);
        if (!passed) throw new Error(`Expected ${expected}s session proof, observed ${observed}s.`);
        return;
      }
      case "assertSwingAttached": {
        const proof = state.lastProof ?? readJsonIfExists(resolve(args.proofPath ?? `${state.proofRoot}/swing-proof.json`));
        const passed = Boolean(proof?.ok) && proof?.result_class === "pass";
        check("swingAttached", passed, proof?.result_class ?? "missing");
        if (!passed) throw new Error(`Expected passing swing proof, observed ${proof?.result_class ?? "missing"}.`);
        return;
      }
      case "assertWallrunClimbRecovery": {
        const proof = state.lastProof ?? readJsonIfExists(resolve(args.proofPath ?? `${state.proofRoot}/wallrun-climb-recovery-proof.json`));
        const passed = Boolean(proof?.ok) && proof?.result_class === "pass";
        check("wallrunClimbRecovery", passed, proof?.result_class ?? "missing");
        if (!passed) {
          throw new Error(`Expected passing wallrun/climb/recovery proof, observed ${proof?.result_class ?? "missing"}.`);
        }
        return;
      }
      case "assertProgressAdvanced": {
        const proof = state.lastProof ?? readJsonIfExists(resolve(args.proofPath ?? `${state.proofRoot}/session-proof.json`));
        const delta = Number(proof?.movement_delta ?? 0);
        const passed = delta > Number(args.minMovementDelta ?? 0.001);
        check("progressAdvanced", passed, `movement_delta=${delta}`);
        if (!passed) throw new Error(`Expected proof-visible movement, observed delta ${delta}.`);
        return;
      }
      case "assertNoSoftlock": {
        const proof = state.lastProof ?? readJsonIfExists(resolve(args.proofPath ?? `${state.proofRoot}/session-proof.json`));
        const resultClass = proof?.result_class ?? "unknown";
        const passed = !["runtime_blocked", "simulator_blocked"].includes(resultClass);
        check("noSoftlock", passed, resultClass);
        if (!passed) throw new Error(`Session proof reported ${resultClass}.`);
        return;
      }
      case "captureSessionFrame": {
        state.artifacts.push(`${state.proofRoot}/frame-captures`);
        check("frameCapturePath", true, `${state.proofRoot}/frame-captures`);
        log("recorded frame capture path");
        return;
      }
      case "summarizeSession": {
        const summaryPath = resolve(args.path ?? `${state.proofRoot}/simtime-summary.json`);
        writeJson(summaryPath, {
          artifacts: state.artifacts,
          checks: state.checks,
          lastProof: state.lastProof,
          status: state.status,
        });
        state.artifacts.push(summaryPath);
        check("summaryWritten", true, summaryPath);
        log(`wrote ${summaryPath}`);
        return;
      }
      case "stopRuntime": {
        if (state.runtimeProcessStartedByAdapter && state.runtimeProcess?.pid) {
          stopSpawnedRuntime(state.runtimeProcess);
          sleepMs(500);
        }
        state.runtimeProcess = null;
        state.runtimeProcessStartedByAdapter = false;
        state.runtimeStarted = false;
        check("runtimeStopped", true, "adapter stop command completed");
        log("runtime target released");
        return;
      }
      default:
        throw new Error(`nexusengine-runtime-simtime does not know how to post command "${event.command}".`);
    }
  }

  function getState() {
    return clone(state);
  }

  function getOutput() {
    return clone({
      artifacts: state.artifacts,
      baseUrl: state.baseUrl,
      checks: state.checks,
      logs: state.logs,
      proofRoot: state.proofRoot,
      simtime: id,
      status: state.status,
    });
  }

  reset();

  return {
    id,
    type,
    surface,
    label: "nexusengine-runtime-simtime",
    supports: nexusEngineRuntimeSupports,
    post,
    getOutput,
    getState,
    reset,
  };
}
