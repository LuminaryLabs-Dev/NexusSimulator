import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const arSupports = [
  "loadApp",
  "listExperiences",
  "loadExperience",
  "startSession",
  "detectSurface",
  "placeScene",
  "performAction",
  "runExperience",
  "runAllExperiences",
  "assertExperienceComplete",
  "assertAllExperiencesComplete",
  "assertMinContentSeconds",
  "writeReport",
  "summarizeSession",
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fileUrl(path) {
  return `${pathToFileURL(path).href}?simtime=${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function checkStatePassed(checks) {
  return checks.every((check) => check.passed);
}

function defaultRegistryPath(appPath) {
  return resolve(appPath, "src/ar/registry/experiences.js");
}

function defaultRuntimePath(appPath) {
  return resolve(appPath, "src/ar/runtime/session.js");
}

function actionPlanForExperience(experience) {
  const steps = experience.level?.objectiveDataset?.steps ?? [];
  return steps.flatMap((step) => {
    const count = Math.max(1, Number(step.target ?? 1));
    return Array.from({ length: count }, () => ({
      action: step.requiredAction ?? step.action ?? "next",
      stepId: step.id,
    }));
  });
}

function summarizeExperience(experience) {
  return {
    slug: experience.slug,
    number: experience.number,
    title: experience.title,
    durationSeconds: Number(experience.level?.objectiveDataset?.durationSeconds ?? 0),
    objectCount: experience.level?.sceneRecipe?.objects?.length ?? 0,
    stepCount: experience.level?.objectiveDataset?.steps?.length ?? 0,
    kits: experience.level?.kits ?? [],
  };
}

export function createARAdapter(context = {}) {
  const id = "ar-simtime";
  const type = "ar";
  const surface = "nexusrealtime-ar";
  let state;
  let registryModule = null;
  let runtimeModule = null;
  let activeRuntime = null;
  let activeExperience = null;

  function reset() {
    registryModule = null;
    runtimeModule = null;
    activeRuntime = null;
    activeExperience = null;
    const app = context.env?.app ?? {};
    state = {
      appPath: app.attachedAppPath ?? null,
      artifactDir: app.artifactDir ?? (context.env?.name ? `.nexus-simulator/artifacts/${context.env.name}` : ".nexus-simulator/artifacts/ar-simtime"),
      artifacts: [],
      checks: [],
      currentSlug: null,
      events: [],
      experiences: [],
      logs: [],
      report: null,
      results: [],
      status: "passed",
      totalAuthoredSeconds: 0,
      virtualTimeMs: 0,
    };
  }

  function log(message) {
    state.logs.push(message);
  }

  function check(name, passed, detail = "") {
    const entry = { name, passed, detail };
    state.checks.push(entry);
    if (!passed) state.status = "failed";
    return entry;
  }

  async function loadApp(args = {}) {
    const appPath = resolve(args.path ?? state.appPath ?? ".");
    const registryPath = resolve(args.registryPath ?? defaultRegistryPath(appPath));
    const runtimePath = resolve(args.runtimePath ?? defaultRuntimePath(appPath));

    if (!existsSync(registryPath)) {
      check("registryExists", false, registryPath);
      throw new Error(`ar-simtime cannot find registry: ${registryPath}`);
    }
    if (!existsSync(runtimePath)) {
      check("runtimeExists", false, runtimePath);
      throw new Error(`ar-simtime cannot find runtime: ${runtimePath}`);
    }

    registryModule = await import(fileUrl(registryPath));
    runtimeModule = await import(fileUrl(runtimePath));
    const experiences = registryModule.experiences;
    if (!Array.isArray(experiences) || !experiences.length) {
      check("experiencesExported", false, "Expected named export experiences[]");
      throw new Error("ar-simtime requires the registry module to export a non-empty experiences array.");
    }
    if (typeof runtimeModule.createLostPagesRuntime !== "function") {
      check("runtimeFactoryExported", false, "Expected createLostPagesRuntime()");
      throw new Error("ar-simtime requires the runtime module to export createLostPagesRuntime().");
    }

    state.appPath = appPath;
    state.registryPath = registryPath;
    state.runtimePath = runtimePath;
    state.experiences = experiences.map(summarizeExperience);
    state.totalAuthoredSeconds = state.experiences.reduce((sum, experience) => sum + experience.durationSeconds, 0);
    check("appLoaded", true, appPath);
    check("experienceCount", experiences.length > 0, `${experiences.length} experiences`);
    log(`loaded ${experiences.length} AR experiences from ${registryPath}`);
    return experiences;
  }

  function requireLoaded() {
    if (!registryModule || !runtimeModule) {
      throw new Error("ar-simtime has no loaded app. Run loadApp first.");
    }
  }

  function findExperience(slug) {
    requireLoaded();
    const experiences = registryModule.experiences;
    const experience = slug ? experiences.find((entry) => entry.slug === slug) : experiences[0];
    if (!experience) {
      throw new Error(`Unknown AR experience: ${slug}`);
    }
    return experience;
  }

  async function loadExperience(args = {}) {
    const experience = findExperience(args.slug);
    activeExperience = experience;
    activeRuntime = await runtimeModule.createLostPagesRuntime({
      root: null,
      experience,
      renderExperience: () => "",
    });
    state.currentSlug = experience.slug;
    check("experienceLoaded", true, experience.slug);
    log(`loaded experience ${experience.slug}`);
    return activeRuntime;
  }

  function requireRuntime() {
    if (!activeRuntime || !activeExperience) {
      throw new Error("ar-simtime has no active experience. Run loadExperience first.");
    }
  }

  function durationFor(experience) {
    return Number(experience.level?.objectiveDataset?.durationSeconds ?? 0);
  }

  function recordResult(experience, runtime, actionCount) {
    const snapshot = runtime.getState();
    const objective = snapshot.objective ?? snapshot.experience;
    const result = {
      actionCount,
      authoredSeconds: durationFor(experience),
      completed: objective?.completed === true,
      currentStepIndex: objective?.currentStepIndex ?? null,
      rewardIds: snapshot.collectibles?.collected ?? [],
      slug: experience.slug,
      status: objective?.status ?? "unknown",
      stepCount: objective?.steps?.length ?? 0,
      title: experience.title,
      virtualTimeMs: durationFor(experience) * 1000,
    };

    const index = state.results.findIndex((entry) => entry.slug === result.slug);
    if (index >= 0) state.results[index] = result;
    else state.results.push(result);
    state.virtualTimeMs = state.results.reduce((sum, entry) => sum + entry.virtualTimeMs, 0);
    return result;
  }

  async function runExperience(args = {}) {
    const experience = findExperience(args.slug);
    const runtime = await loadExperience({ slug: experience.slug });
    runtime.startSession();
    runtime.findSurface();
    runtime.placeOnPlane();

    let actionCount = 1;
    for (const plan of actionPlanForExperience(experience).slice(1)) {
      runtime.action(plan.action, { stepId: plan.stepId, simulated: true });
      actionCount += 1;
    }

    const result = recordResult(experience, runtime, actionCount);
    check(`complete:${experience.slug}`, result.completed, result.status);
    if (args.minContentSeconds !== undefined) {
      const passed = result.authoredSeconds >= Number(args.minContentSeconds);
      check(`minContent:${experience.slug}`, passed, `${result.authoredSeconds}s >= ${args.minContentSeconds}s`);
    }
    log(`ran ${experience.slug}: ${result.status}, ${result.authoredSeconds}s authored`);
    return result;
  }

  async function post(event) {
    state.events.push(clone(event));
    const args = event.args ?? {};

    switch (event.command) {
      case "loadApp":
        await loadApp(args);
        return;
      case "listExperiences":
        requireLoaded();
        log(`listed ${registryModule.experiences.length} experiences`);
        return;
      case "loadExperience":
        await loadExperience(args);
        return;
      case "startSession":
        requireRuntime();
        activeRuntime.startSession();
        log(`started session ${activeExperience.slug}`);
        return;
      case "detectSurface":
        requireRuntime();
        activeRuntime.findSurface();
        log(`detected surface ${activeExperience.slug}`);
        return;
      case "placeScene":
        requireRuntime();
        activeRuntime.placeOnPlane();
        log(`placed scene ${activeExperience.slug}`);
        return;
      case "performAction":
        requireRuntime();
        activeRuntime.action(args.action ?? "tap", args.payload ?? {});
        log(`performed ${args.action ?? "tap"} on ${activeExperience.slug}`);
        return;
      case "runExperience":
        await runExperience(args);
        return;
      case "runAllExperiences": {
        requireLoaded();
        for (const experience of registryModule.experiences) {
          await runExperience({ slug: experience.slug, minContentSeconds: args.minContentSeconds });
        }
        check("allExperiencesRan", state.results.length === registryModule.experiences.length, `${state.results.length}/${registryModule.experiences.length}`);
        return;
      }
      case "assertExperienceComplete": {
        const slug = args.slug ?? state.currentSlug;
        const result = state.results.find((entry) => entry.slug === slug);
        const passed = result?.completed === true;
        check(`assertComplete:${slug}`, passed, result?.status ?? "missing result");
        if (!passed) throw new Error(`Expected AR experience to complete: ${slug}`);
        return;
      }
      case "assertAllExperiencesComplete": {
        requireLoaded();
        const missing = registryModule.experiences
          .map((experience) => experience.slug)
          .filter((slug) => state.results.find((result) => result.slug === slug)?.completed !== true);
        const passed = missing.length === 0;
        check("assertAllComplete", passed, missing.length ? missing.join(", ") : "all complete");
        if (!passed) throw new Error(`Expected all AR experiences to complete. Missing: ${missing.join(", ")}`);
        return;
      }
      case "assertMinContentSeconds": {
        const min = Number(args.seconds ?? args.minContentSeconds ?? 300);
        const target = args.slug
          ? state.experiences.filter((experience) => experience.slug === args.slug)
          : state.experiences;
        const failing = target.filter((experience) => experience.durationSeconds < min);
        const passed = failing.length === 0;
        check("assertMinContentSeconds", passed, failing.length ? failing.map((entry) => `${entry.slug}:${entry.durationSeconds}s`).join(", ") : `${target.length} experiences >= ${min}s`);
        if (!passed) throw new Error(`AR content duration below ${min}s: ${failing.map((entry) => entry.slug).join(", ")}`);
        return;
      }
      case "writeReport": {
        const path = resolve(args.path ?? `${state.artifactDir}/ar-simtime-report.json`);
        ensureDir(dirname(path));
        const report = buildReport();
        writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
        state.report = report;
        state.artifacts.push(path);
        check("reportWritten", true, path);
        log(`wrote ${path}`);
        return;
      }
      case "summarizeSession":
        state.report = buildReport();
        log("summarized AR simtime session");
        return;
      default:
        throw new Error(`ar-simtime does not know how to post command "${event.command}".`);
    }
  }

  function buildReport() {
    return {
      appPath: state.appPath,
      artifacts: state.artifacts,
      checks: state.checks,
      experienceCount: state.experiences.length,
      experiences: state.experiences,
      results: state.results,
      simtime: id,
      status: checkStatePassed(state.checks) ? "passed" : "failed",
      totalAuthoredSeconds: state.totalAuthoredSeconds,
      virtualTimeMs: state.virtualTimeMs,
    };
  }

  function getState() {
    return clone(state);
  }

  function getOutput() {
    return clone(state.report ?? buildReport());
  }

  reset();

  return {
    id,
    type,
    surface,
    label: "ar-simtime",
    supports: arSupports,
    post,
    getOutput,
    getState,
    reset,
  };
}
