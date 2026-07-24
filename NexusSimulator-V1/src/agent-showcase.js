import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { runWorldFactoryHarness } from "./world-factory-harness.js";
import { createForestShowcaseHtml } from "./forest-showcase.js";
import { validateNexusTerrainStreaming } from "./nexus-terrain-streaming-adapter.js";
import { compileWorldPrompt } from "./world-prompt-compiler.js";
import { applyNaturalGenerationPolicy } from "./natural-generation-policy.js";
import { initializeBlankNexusProject, materializeAndValidateNexusProject } from "./nexus-world-project.js";
import {
  createProceduralMeshProgram,
  proceduralMeshSources,
  validateProceduralMeshSettings,
} from "./procedural-mesh-program.js";
import { worldFactoryCapabilityCatalog } from "./world-domain-planner.js";

const rootDir = resolve(dirname(new URL(import.meta.url).pathname), "..");

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function safeSlug(value) {
  return String(value || "agent-showcase")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agent-showcase";
}

function summarizeTerrainValidation(validation) {
  if (!validation) return null;
  return {
    status: validation.status,
    source: validation.source,
    coverage: {
      passed: validation.coverage.passed,
      expectedVisiblePerStep: validation.coverage.expectedVisiblePerStep,
      stepCount: validation.coverage.steps.length,
    },
    seams: validation.seams,
    banded: { passed: validation.banded.passed, failures: validation.banded.failures },
    grounding: { passed: validation.grounding.passed, profileCount: validation.grounding.profiles.length },
    chunkCount: validation.chunks.length,
    flightPath: validation.flightPath,
    validatedBounds: validation.validatedBounds,
    reportPath: validation.reportPath,
  };
}

function parseViewport(value) {
  const match = /^(\d+)x(\d+)$/.exec(String(value || ""));
  if (!match) throw new Error(`Invalid viewport "${value}". Expected WIDTHxHEIGHT.`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 640 || height < 360) throw new Error("Showcase viewport must be at least 640x360.");
  return { width, height };
}

function scaleTimeline(timeline, sourceDuration, targetDuration) {
  if (!timeline || sourceDuration === targetDuration) return timeline;
  const ratio = targetDuration / sourceDuration;
  return Object.fromEntries(Object.entries(timeline).map(([key, value]) => [
    key,
    Number.isFinite(Number(value)) ? Number((Number(value) * ratio).toFixed(4)) : value,
  ]));
}

function loadProfile(profilePath, prompt, seed, domainPlanPath = null) {
  if (!profilePath && !prompt) throw new Error("scene.agent-showcase requires --profile or --prompt.");
  if (seed != null && !prompt) throw new Error("--seed is available only with --prompt.");
  if (domainPlanPath && !prompt) throw new Error("--agent-plan is available only with --prompt.");
  const path = resolve(profilePath || join(rootDir, "profiles", "world-factory-forest.json"));
  if (!existsSync(path)) throw new Error(`Showcase profile not found: ${path}`);
  const template = JSON.parse(readFileSync(path, "utf8"));
  const domainPlan = domainPlanPath ? JSON.parse(readFileSync(resolve(domainPlanPath), "utf8")) : null;
  let profile = prompt ? compileWorldPrompt(template, prompt, { domainPlan, seed }) : template;
  if (!["nexus.agent-showcase.v1", "nexus.forest-showcase.v1"].includes(profile.schemaVersion)) {
    throw new Error(`Unsupported showcase schema: ${profile.schemaVersion || "missing"}`);
  }
  if (!Array.isArray(profile.steps) || profile.steps.length < 1) {
    throw new Error("Agent showcase requires at least one ordered build step.");
  }
  if (!Array.isArray(profile.agents) || profile.agents.length !== 3) {
    throw new Error("WorldFactory-Harness showcase requires exactly three agents.");
  }
  const ids = new Set();
  for (const step of profile.steps) {
    if (!step.id || !step.type || !step.instruction || !Array.isArray(step.position) || step.position.length !== 3) {
      throw new Error("Each showcase step requires id, type, instruction, and a three-value position.");
    }
    if (ids.has(step.id)) throw new Error(`Duplicate showcase step id: ${step.id}`);
    ids.add(step.id);
  }
  if (profile.schemaVersion === "nexus.forest-showcase.v1") {
    if (!profile.defaultWorldStructure || !profile.worldStructures?.[profile.defaultWorldStructure]) {
      throw new Error("Forest showcase profiles require a valid defaultWorldStructure.");
    }
    const supportedOperators = new Set(["equals", "min", "matches"]);
    for (const [id, structure] of Object.entries(profile.worldStructures)) {
      if (!structure.label || !structure.coordinateModel || !structure.guide?.kind) {
        throw new Error(`World structure ${id} requires label, coordinateModel, and guide.kind.`);
      }
      if (!Array.isArray(structure.requirements) || structure.requirements.length === 0) {
        throw new Error(`World structure ${id} requires at least one validation requirement.`);
      }
      for (const requirement of structure.requirements) {
        if (!requirement.path || !requirement.label || !supportedOperators.has(requirement.operator)) {
          throw new Error(`World structure ${id} contains an invalid validation requirement.`);
        }
      }
    }
    if (profile.generation?.nexusTerrain) {
      const camera = profile.generation.nexusTerrain.camera;
      for (const field of ["trailDistance", "lateralOffset", "height", "lookAhead"]) {
        if (!camera || !Number.isFinite(Number(camera[field]))) {
          throw new Error(`Forest Nexus terrain profile requires numeric camera.${field}.`);
        }
      }
    }
  }
  profile = applyNaturalGenerationPolicy(profile, prompt);
  return { path, profile, prompt: prompt || null };
}

function applySettingsPatches(profile, settingsPatches) {
  if (settingsPatches == null) return profile;
  if (typeof settingsPatches !== "object" || Array.isArray(settingsPatches)) {
    throw new Error("World settings patches must be an object keyed by step or capability ID.");
  }
  const normalized = {};
  const steps = profile.steps.map((step) => {
    const raw = settingsPatches[step.id] ?? settingsPatches[step.capabilityId];
    if (raw == null) return step;
    const patch = validateProceduralMeshSettings(step.type, raw);
    normalized[step.id] = patch;
    return {
      ...step,
      factorySettings: {
        ...(step.factorySettings ?? {}),
        ...patch,
      },
    };
  });
  const knownKeys = new Set(profile.steps.flatMap((step) => [step.id, step.capabilityId]).filter(Boolean));
  const unknown = Object.keys(settingsPatches).filter((key) => !knownKeys.has(key));
  if (unknown.length) throw new Error(`World settings patches reference unknown steps or capabilities: ${unknown.join(", ")}.`);
  if (Object.keys(normalized).length === 0) throw new Error("World settings patches did not change any selected step.");
  return {
    ...profile,
    steps,
    promptCompilation: {
      ...profile.promptCompilation,
      settingsPatches: normalized,
    },
  };
}

export function listWorldFactoryCapabilitiesAction({ profilePath = null } = {}) {
  const path = resolve(profilePath || join(rootDir, "profiles", "world-factory-forest.json"));
  if (!existsSync(path)) throw new Error(`Showcase profile not found: ${path}`);
  const profile = JSON.parse(readFileSync(path, "utf8"));
  return {
    schemaVersion: "nexus.world-factory-capability-catalog.v1",
    profilePath: path,
    capabilities: worldFactoryCapabilityCatalog(profile).map((capability) => ({
      id: capability.id,
      domainPath: capability.domainPath,
      factoryType: capability.factoryType || null,
      nativeCapability: capability.nativeCapability || null,
      available: capability.available,
      terms: capability.terms,
      genericTerms: capability.genericTerms || [],
      biomeAffinity: capability.biomeAffinity || [],
      review: capability.review,
      settingsContract: capability.settingsContract,
    })),
  };
}

export function planWorldPromptAction({ agentPlanPath = null, profilePath = null, prompt, seed = null } = {}) {
  if (!String(prompt || "").trim()) throw new Error("world-domain plan requires --prompt.");
  const loaded = loadProfile(profilePath, String(prompt).trim(), seed, agentPlanPath);
  return {
    schemaVersion: "nexus.world-domain-plan-result.v1",
    profilePath: loaded.path,
    prompt: loaded.prompt,
    seed: loaded.profile.seed,
    domainPlan: loaded.profile.worldDomainPlan,
    selectedObjects: loaded.profile.steps.map((step) => ({
      id: step.id,
      label: step.label,
      type: step.type,
      capabilityId: step.capabilityId,
      domainPath: step.domainPath,
    })),
  };
}

function mimeType(path) {
  const extension = extname(path);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function createStaticServer(directory) {
  const server = createServer((request, response) => {
    const requestPath = decodeURIComponent((request.url || "/").split("?")[0]);
    const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
    const path = resolve(directory, relative);
    if (!path.startsWith(resolve(directory)) || !existsSync(path)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": mimeType(path), "Cache-Control": "no-store" });
    response.end(readFileSync(path));
  });
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolveServer({ server, url: `http://127.0.0.1:${address.port}/` });
    });
  });
}

function copyThreeVendor(outputDir) {
  const vendorDir = join(outputDir, "vendor");
  ensureDir(vendorDir);
  const sourceDir = join(rootDir, "node_modules", "three", "build");
  for (const name of ["three.module.js", "three.core.js"]) {
    const source = join(sourceDir, name);
    if (!existsSync(source)) throw new Error(`Missing Three.js runtime: ${source}`);
    copyFileSync(source, join(vendorDir, name));
  }
}

function createShowcaseHtml(profile) {
  if (profile.schemaVersion === "nexus.forest-showcase.v1") {
    return createForestShowcaseHtml(profile);
  }
  const serialized = JSON.stringify(profile).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>${profile.title} - ${profile.projectName}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #121918; color: #fff; font-family: Avenir Next, Avenir, Helvetica, Arial, sans-serif; }
    canvas { display: block; width: 100vw; height: 100vh; }
    .vignette { position: fixed; inset: 0; pointer-events: none; background: radial-gradient(circle at 52% 45%, transparent 45%, rgba(5, 9, 8, .28) 100%); }
    .intro, .guidance, .completion { position: fixed; z-index: 2; pointer-events: none; text-shadow: 0 3px 22px rgba(0, 0, 0, .62); opacity: 0; }
    .intro { left: 64px; top: 58px; }
    .intro h1 { margin: 0; font-size: 56px; line-height: 1; letter-spacing: 0; }
    .intro p { margin: 14px 0 0; color: rgba(255,255,255,.82); font-size: 24px; letter-spacing: 0; }
    .intro .credit { margin-top: 10px; color: rgba(255,255,255,.56); font-size: 15px; }
    .guidance { left: 64px; bottom: 58px; max-width: 760px; padding-left: 18px; border-left: 3px solid #61d69a; }
    .guidance .source { margin: 0 0 7px; color: #8be7b4; font-size: 14px; font-weight: 800; text-transform: uppercase; letter-spacing: 0; }
    .guidance .instruction { margin: 0; font-size: 28px; font-weight: 650; line-height: 1.2; letter-spacing: 0; }
    .guidance .status { margin: 9px 0 0; color: rgba(255,255,255,.68); font: 600 14px/1.2 Menlo, Monaco, Consolas, monospace; letter-spacing: 0; }
    .completion { left: 64px; bottom: 58px; }
    .completion h2 { margin: 0; font-size: 38px; line-height: 1.05; letter-spacing: 0; }
    .completion p { margin: 12px 0 0; color: rgba(255,255,255,.78); font-size: 18px; letter-spacing: 0; }
  </style>
</head>
<body>
  <canvas id="showcase" aria-label="An agent building a verified 3D pavilion one object at a time"></canvas>
  <div class="vignette"></div>
  <header class="intro">
    <h1>${profile.title}</h1>
    <p>${profile.subtitle}</p>
    <p class="credit">${profile.guidance.credit}</p>
  </header>
  <section class="guidance" aria-live="polite">
    <p class="source"></p>
    <p class="instruction"></p>
    <p class="status"></p>
  </section>
  <section class="completion">
    <h2>Built. Simulated. Validated.</h2>
    <p>${profile.harness.name} / ${profile.steps.length} serialized world commits</p>
  </section>
  <script type="module">
    import * as THREE from "./vendor/three.module.js";

    const profile = ${serialized};
    const canvas = document.getElementById("showcase");
    const intro = document.querySelector(".intro");
    const guidance = document.querySelector(".guidance");
    const source = document.querySelector(".source");
    const instruction = document.querySelector(".instruction");
    const status = document.querySelector(".status");
    const completion = document.querySelector(".completion");
    const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
    const smooth = (value) => { const x = clamp(value); return x * x * (3 - 2 * x); };
    const easeOutBack = (value) => { const x = clamp(value) - 1; return 1 + 2.2 * x * x * x + 1.2 * x * x; };
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121918);
    scene.fog = new THREE.FogExp2(0x121918, 0.022);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    const world = new THREE.Group();
    scene.add(world);

    const hemi = new THREE.HemisphereLight(0xddece5, 0x1a2520, 1.55);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffe2b2, 4.2);
    key.position.set(-7, 12, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 12;
    key.shadow.camera.bottom = -12;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x59c4d7, 3.2);
    rim.position.set(10, 7, -9);
    scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(16, 96),
      new THREE.MeshStandardMaterial({ color: 0x202b27, roughness: 0.82, metalness: 0.1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.03;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(28, 28, 0x446c5c, 0x2c3b35);
    grid.position.y = 0.01;
    grid.material.transparent = true;
    grid.material.opacity = 0.42;
    scene.add(grid);

    function material(color, options = {}) {
      return new THREE.MeshPhysicalMaterial({
        color,
        roughness: options.roughness ?? 0.28,
        metalness: options.metalness ?? 0.58,
        transparent: Boolean(options.transparent),
        opacity: options.opacity ?? 1,
        transmission: options.transmission ?? 0,
        thickness: options.thickness ?? 0,
        emissive: options.emissive ?? 0x000000,
        emissiveIntensity: options.emissiveIntensity ?? 0,
        clearcoat: options.clearcoat ?? 0.45,
        clearcoatRoughness: 0.2,
      });
    }

    function mesh(geometry, surface) {
      const item = new THREE.Mesh(geometry, surface);
      item.castShadow = true;
      item.receiveShadow = true;
      return item;
    }

    function foundation(step) {
      const group = new THREE.Group();
      const slab = mesh(new THREE.CylinderGeometry(5.8, 6.15, 0.42, 64), material(0x263530, { roughness: 0.4, metalness: 0.72 }));
      group.add(slab);
      const inset = mesh(new THREE.CylinderGeometry(5.25, 5.25, 0.08, 64), material(step.color, { roughness: 0.25, metalness: 0.35, emissive: step.color, emissiveIntensity: 0.22 }));
      inset.position.y = 0.24;
      group.add(inset);
      return group;
    }

    function core(step) {
      const group = new THREE.Group();
      const shell = mesh(new THREE.CylinderGeometry(1.15, 1.35, 2.8, 12), material(0xb8e8e8, { transparent: true, opacity: 0.42, transmission: 0.36, roughness: 0.12, metalness: 0.08, thickness: 0.65 }));
      group.add(shell);
      const inner = mesh(new THREE.IcosahedronGeometry(0.72, 2), material(step.color, { emissive: step.color, emissiveIntensity: 1.8, roughness: 0.18, metalness: 0.18 }));
      group.add(inner);
      return group;
    }

    function solar(step) {
      const group = new THREE.Group();
      const sun = mesh(new THREE.IcosahedronGeometry(0.72, 3), material(step.color, { emissive: step.color, emissiveIntensity: 2.6, roughness: 0.12, metalness: 0.08 }));
      group.add(sun);
      const ring = mesh(new THREE.TorusGeometry(1.08, 0.045, 10, 64), material(0xe9eee8, { emissive: step.color, emissiveIntensity: 1.1, roughness: 0.2, metalness: 0.38 }));
      ring.rotation.x = 0.86;
      group.add(ring);
      const light = new THREE.PointLight(step.color, 35, 18, 2);
      group.add(light);
      return group;
    }

    function portal(step) {
      const group = new THREE.Group();
      const pillar = mesh(new THREE.BoxGeometry(0.62, 3.6, 0.82, 3, 12, 3), material(0x33423c, { roughness: 0.32, metalness: 0.74 }));
      group.add(pillar);
      const inlay = mesh(new THREE.BoxGeometry(0.12, 2.75, 0.88), material(step.color, { emissive: step.color, emissiveIntensity: 1.2, roughness: 0.22, metalness: 0.25 }));
      inlay.position.x = step.position[0] < 0 ? 0.36 : -0.36;
      group.add(inlay);
      const cap = mesh(new THREE.SphereGeometry(0.48, 24, 16), material(0xdfe7e2, { roughness: 0.18, metalness: 0.68 }));
      cap.position.y = 2.02;
      group.add(cap);
      return group;
    }

    function mountains(step) {
      const group = new THREE.Group();
      const heights = [2.5, 3.4, 2.1, 2.8, 1.8];
      const positions = [[0, 0, 0], [1.2, 0, 0.25], [-1.1, 0, 0.55], [0.45, 0, -1.05], [-0.8, 0, -0.9]];
      heights.forEach((height, index) => {
        const peak = mesh(new THREE.ConeGeometry(0.72 + index * 0.06, height, 7), material(index % 2 ? 0x617067 : step.color, { roughness: 0.88, metalness: 0.06 }));
        peak.position.set(positions[index][0], height * 0.5, positions[index][2]);
        peak.rotation.y = index * 0.47;
        group.add(peak);
      });
      return group;
    }

    function canopy(step) {
      const group = new THREE.Group();
      const ring = mesh(new THREE.TorusGeometry(3.35, 0.18, 16, 72), material(step.color, { roughness: 0.16, metalness: 0.8, emissive: 0x61d69a, emissiveIntensity: 0.3 }));
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
      for (let index = 0; index < 6; index += 1) {
        const blade = mesh(new THREE.BoxGeometry(0.16, 0.55, 3.1), material(index % 2 ? 0x59c4d7 : 0xe7a84d, { roughness: 0.24, metalness: 0.66 }));
        blade.rotation.y = index * Math.PI / 3;
        blade.position.y = -0.28;
        group.add(blade);
      }
      return group;
    }

    function atmosphere(step) {
      const group = new THREE.Group();
      for (let index = 0; index < 3; index += 1) {
        const arc = mesh(new THREE.TorusGeometry(5.8 + index * 0.5, 0.035, 8, 96, Math.PI * 1.18), material(index === 1 ? 0x59c4d7 : step.color, { transparent: true, opacity: 0.48, emissive: index === 1 ? 0x59c4d7 : step.color, emissiveIntensity: 0.8, roughness: 0.2, metalness: 0.15 }));
        arc.rotation.set(Math.PI / 2.3, index * 0.62, -0.6);
        group.add(arc);
      }
      return group;
    }

    function consoleObject(step) {
      const group = new THREE.Group();
      const base = mesh(new THREE.CylinderGeometry(0.58, 0.84, 1.5, 8), material(0x2c3a35, { roughness: 0.4, metalness: 0.7 }));
      group.add(base);
      const screen = mesh(new THREE.BoxGeometry(1.45, 0.86, 0.1), material(step.color, { transparent: true, opacity: 0.74, transmission: 0.18, emissive: step.color, emissiveIntensity: 0.75, roughness: 0.1, metalness: 0.15 }));
      screen.position.set(0, 0.82, -0.12);
      screen.rotation.x = -0.28;
      group.add(screen);
      return group;
    }

    function beacon(step) {
      const group = new THREE.Group();
      const stem = mesh(new THREE.CylinderGeometry(0.11, 0.3, 2.35, 12), material(0x394741, { roughness: 0.3, metalness: 0.72 }));
      group.add(stem);
      const crystal = mesh(new THREE.OctahedronGeometry(0.58, 1), material(step.color, { emissive: step.color, emissiveIntensity: 1.5, roughness: 0.12, metalness: 0.28 }));
      crystal.position.y = 1.45;
      group.add(crystal);
      return group;
    }

    function grove(step) {
      const group = new THREE.Group();
      const placements = [[0, 0, 0], [0.9, 0, 0.45], [-0.7, 0, 0.55], [0.42, 0, -0.72], [-0.8, 0, -0.6]];
      placements.forEach((position, index) => {
        const tree = new THREE.Group();
        const trunkHeight = 0.75 + index * 0.08;
        const trunk = mesh(new THREE.CylinderGeometry(0.07, 0.12, trunkHeight, 7), material(0x73523a, { roughness: 0.94, metalness: 0 }));
        trunk.position.y = trunkHeight * 0.5;
        tree.add(trunk);
        const crown = mesh(new THREE.IcosahedronGeometry(0.42 + index * 0.035, 1), material(index % 2 ? 0x4f8b5b : step.color, { roughness: 0.86, metalness: 0, emissive: 0x183c25, emissiveIntensity: 0.18 }));
        crown.position.y = trunkHeight + 0.28;
        tree.add(crown);
        tree.position.set(...position);
        tree.rotation.y = index * 0.8;
        group.add(tree);
      });
      return group;
    }

    function boundary(step) {
      const group = new THREE.Group();
      const ring = mesh(new THREE.TorusGeometry(7.25, 0.075, 12, 128), material(step.color, { emissive: step.color, emissiveIntensity: 2.2, roughness: 0.15, metalness: 0.2 }));
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
      return group;
    }

    const factories = { foundation, core, solar, portal, mountains, canopy, atmosphere, console: consoleObject, beacon, grove, boundary };
    const objects = profile.steps.map((step) => {
      if (!factories[step.type]) throw new Error("Unknown world object type: " + step.type);
      const object = factories[step.type](step);
      object.position.fromArray(step.position);
      object.userData.target = object.position.clone();
      object.userData.step = step;
      world.add(object);
      return object;
    });

    const agentMarkers = new Map(profile.agents.map((agent) => {
      const marker = mesh(new THREE.SphereGeometry(0.17, 24, 16), material(0xffffff, { emissive: agent.color, emissiveIntensity: 3.4, roughness: 0.08, metalness: 0.05 }));
      const markerLight = new THREE.PointLight(agent.color, 18, 5, 2);
      marker.add(markerLight);
      scene.add(marker);
      return [agent.id, marker];
    }));
    const targetRing = mesh(new THREE.RingGeometry(0.48, 0.57, 48), new THREE.MeshBasicMaterial({ color: 0x61d69a, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    targetRing.rotation.x = -Math.PI / 2;
    scene.add(targetRing);

    const introEnd = 2.25;
    const buildStart = 2.65;
    const buildEnd = 11.85;
    const stepSpan = (buildEnd - buildStart) / profile.steps.length;
    const completionStart = 12.15;
    const state = { time: 0, currentStep: -1, objectsBuilt: 0, validated: 0, complete: false, consoleErrors: [] };
    window.__NEXUS_SHOWCASE_STATE__ = state;

    function opacityWindow(time, start, fadeIn, end, fadeOut) {
      return Math.min(smooth((time - start) / fadeIn), smooth((end - time) / fadeOut));
    }

    function renderAt(time) {
      const t = clamp(Number(time) || 0, 0, profile.durationSeconds);
      state.time = t;
      intro.style.opacity = String(opacityWindow(t, 0.1, 0.55, introEnd, 0.4));
      completion.style.opacity = String(opacityWindow(t, completionStart, 0.55, profile.durationSeconds, 0.5));

      const normalizedBuild = clamp((t - buildStart) / (buildEnd - buildStart));
      const stepFloat = normalizedBuild * profile.steps.length;
      const activeIndex = t < buildStart || t >= buildEnd ? -1 : Math.min(profile.steps.length - 1, Math.floor(stepFloat));
      const localProgress = activeIndex < 0 ? 0 : stepFloat - activeIndex;
      state.currentStep = activeIndex;
      state.objectsBuilt = t >= buildEnd ? profile.steps.length : Math.max(0, activeIndex + (localProgress > 0.88 ? 1 : 0));
      state.validated = t >= buildEnd ? profile.steps.length : Math.max(0, activeIndex);
      state.complete = t >= completionStart;

      objects.forEach((object, index) => {
        const objectStart = buildStart + index * stepSpan;
        const progress = smooth((t - objectStart) / (stepSpan * 0.78));
        const scale = progress <= 0 ? 0.0001 : easeOutBack(progress);
        object.visible = progress > 0;
        object.scale.setScalar(scale);
        object.position.copy(object.userData.target);
        object.position.y -= (1 - progress) * 0.85;
        object.rotation.y = (1 - progress) * -0.28;
      });

      if (activeIndex >= 0) {
        const current = profile.steps[activeIndex];
        const activeAgent = profile.agents.find((agent) => agent.id === current.agent);
        const previous = activeIndex > 0 ? profile.steps[activeIndex - 1].position : [-6.5, 2.4, 5.5];
        const travel = smooth(localProgress / 0.32);
        profile.agents.forEach((agent, agentIndex) => {
          const marker = agentMarkers.get(agent.id);
          marker.visible = t >= agent.startsAt;
          if (agent.id === current.agent) {
            marker.position.lerpVectors(new THREE.Vector3(...previous), new THREE.Vector3(...current.position).add(new THREE.Vector3(0, 1.1, 0)), travel);
          } else {
            const idleAngle = t * (0.28 + agentIndex * 0.04) + agentIndex * Math.PI * 0.66;
            marker.position.set(Math.cos(idleAngle) * (6.6 + agentIndex * 0.25), 1.65 + agentIndex * 0.45, Math.sin(idleAngle) * (6.6 + agentIndex * 0.25));
          }
        });
        targetRing.position.set(current.position[0], 0.035, current.position[2]);
        targetRing.scale.setScalar(0.8 + Math.sin(t * 8) * 0.12);
        targetRing.material.color.set(current.color);
        source.textContent = profile.guidance.source + " / " + profile.harness.name + " / " + activeAgent.name;
        instruction.textContent = current.instruction;
        status.textContent = localProgress < 0.72
          ? "PROPOSE  " + String(activeIndex + 1).padStart(2, "0") + "/" + String(profile.steps.length).padStart(2, "0")
          : localProgress < 0.9
            ? "WORLDFACTORY  validating visible object"
            : "COMMIT  passed / shared world updated";
        guidance.style.opacity = String(Math.min(smooth((t - buildStart) / 0.35), 1));
      } else {
        agentMarkers.forEach((marker) => { marker.visible = false; });
        targetRing.visible = false;
        guidance.style.opacity = "0";
      }
      if (activeIndex >= 0) targetRing.visible = true;

      const orbit = -0.72 + t * 0.115;
      const distance = 16.4 - smooth((t - buildStart) / (buildEnd - buildStart)) * 1.6;
      const height = 8.7 + smooth((t - completionStart) / 2.1) * 1.1;
      camera.position.set(Math.sin(orbit) * distance, height, Math.cos(orbit) * distance);
      camera.lookAt(0, 1.55, 0);
      objects[1].rotation.y += t * 0.22;
      if (objects[6]?.children[1]) objects[6].children[1].rotation.y = t * 0.85;
      renderer.render(scene, camera);
      window.__NEXUS_SHOWCASE_STATE__ = { ...state };
      return window.__NEXUS_SHOWCASE_STATE__;
    }

    function resize() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderAt(state.time);
    }
    window.addEventListener("resize", resize);
    window.__NEXUS_SHOWCASE__ = { renderAt };
    resize();
    document.body.dataset.ready = "true";
    if (new URLSearchParams(window.location.search).get("capture") !== "1") {
      const playbackStartedAt = performance.now();
      function play(now) {
        renderAt(((now - playbackStartedAt) / 1000) % profile.durationSeconds);
        requestAnimationFrame(play);
      }
      requestAnimationFrame(play);
    }
  </script>
</body>
</html>`;
}

async function runRealtimeLiveLoop({ dimensions, harness, id, loaded, nexusProject, outputPath, profile, runDir, webDir }) {
  const videoDir = join(runDir, "video-source");
  ensureDir(videoDir);
  const errors = [];
  const { server, url } = await createStaticServer(webDir);
  const browser = await chromium.launch({ channel: "chrome", headless: false, args: ["--use-angle=metal", "--disable-background-timer-throttling"] });
  const context = await browser.newContext({ recordVideo: { dir: videoDir, size: dimensions }, viewport: dimensions });
  const videoStartedAt = Date.now();
  const page = await context.newPage();
  const video = page.video();
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  let finalState = null;
  let playbackOffsetSeconds = 0;
  const posterPath = join(runDir, "poster.png");
  try {
    await page.goto(`${url}?capture=1&live-loop=1`, { waitUntil: "networkidle" });
    await page.waitForSelector("body[data-ready='true']");
    playbackOffsetSeconds = (Date.now() - videoStartedAt) / 1000;
    await page.evaluate(() => window.__NEXUS_SHOWCASE__.startRealtime());
    await page.waitForTimeout(profile.durationSeconds * 1000);
    finalState = await page.evaluate(() => window.__NEXUS_SHOWCASE_STATE__);
    await page.screenshot({ path: posterPath });
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }

  const sourceVideo = await video.path();
  const rawVideoPath = join(runDir, `${id}-source.webm`);
  copyFileSync(sourceVideo, rawVideoPath);
  const target = resolve(outputPath || join(runDir, `${id}.mp4`));
  ensureDir(dirname(target));
  const frameCount = Math.round(profile.durationSeconds * profile.fps);
  const ffmpeg = spawnSync("ffmpeg", [
    "-y", "-i", rawVideoPath,
    "-ss", playbackOffsetSeconds.toFixed(3),
    "-t", String(profile.durationSeconds),
    "-vf", `fps=${profile.fps}`,
    "-frames:v", String(frameCount),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    target,
  ], { encoding: "utf8" });
  if (ffmpeg.status !== 0) throw new Error(`FFmpeg live-loop encode failed: ${ffmpeg.stderr}`);

  const proofPassed = finalState?.test?.validated === profile.steps.length
    && finalState?.world?.committed === profile.steps.length
    && finalState?.complete === true
    && finalState?.library?.passed === true
    && (!profile.nexusTerrain || finalState?.terrain?.status === "passed");
  const libraryValidationPath = join(runDir, "library-validation.json");
  writeFileSync(libraryValidationPath, `${JSON.stringify(finalState?.library || null, null, 2)}\n`);
  if (harness.library?.manifestPath && existsSync(harness.library.manifestPath)) {
    const manifest = JSON.parse(readFileSync(harness.library.manifestPath, "utf8"));
    writeFileSync(harness.library.manifestPath, `${JSON.stringify({ ...manifest, status: proofPassed ? "promoted" : "rejected", runtimeValidation: finalState?.library || null }, null, 2)}\n`);
  }
  const report = {
    status: errors.length || !proofPassed ? "failed" : "passed",
    summary: errors.length || !proofPassed
      ? "The live iterative world build did not complete with clean browser proof."
      : finalState.terrain
        ? `Validated ${profile.steps.length} generated library assets and flew through ${finalState.terrain.streamedChunkCount} validated streamed chunks in one continuous take.`
        : `Validated ${profile.steps.length} generated library assets and flew through a preassembled ${finalState.library.massiveSectorCount}-sector world in one continuous take.`,
    runId: id,
    profilePath: loaded.compiledPath || loaded.path,
    templateProfilePath: loaded.compiledPath ? loaded.path : null,
    prompt: loaded.prompt,
    webPath: join(webDir, "index.html"),
    videoPath: target,
    sourceVideoPath: rawVideoPath,
    posterPath,
    frameCount,
    objectCount: profile.steps.length,
    viewport: dimensions,
    fps: profile.fps,
    durationSeconds: profile.durationSeconds,
    captureMode: "realtime-live-loop",
    playbackOffsetSeconds,
    consoleErrors: errors,
    harness,
    nexusProject,
    terrainValidation: summarizeTerrainValidation(profile.nexusTerrain),
    libraryValidationPath,
    proof: finalState,
  };
  const reportPath = join(runDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, reportPath };
}

async function runRealtimeCapture({ browserHeadless, dimensions, harness, id, loaded, nexusProject, outputPath, profile, runDir, webDir }) {
  const videoDir = join(runDir, "video-source");
  ensureDir(videoDir);
  const errors = [];
  const { server, url } = await createStaticServer(webDir);
  let browser = null;
  let context = null;
  let page = null;
  let video = null;
  let videoStartedAt = 0;
  let finalState = null;
  let playbackOffsetSeconds = 0;
  const posterPath = join(runDir, "poster.png");
  try {
    browser = await chromium.launch({ headless: browserHeadless });
    context = await browser.newContext({
      recordVideo: { dir: videoDir, size: dimensions },
      viewport: dimensions,
    });
    page = await context.newPage();
    video = page.video();
    videoStartedAt = Date.now();
    page.setDefaultTimeout(180_000);
    page.setDefaultNavigationTimeout(180_000);
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}?capture=1`, { waitUntil: "networkidle" });
    try {
      await page.waitForSelector("body[data-ready='true']");
    } catch (error) {
      const startupState = await page.evaluate(() => ({
        bodyReady: document.body?.dataset?.ready || null,
        documentReady: document.readyState,
        hasShowcaseApi: Boolean(window.__NEXUS_SHOWCASE__),
      })).catch(() => null);
      throw new Error(`Showcase startup failed: ${error.message}; state=${JSON.stringify(startupState)}; browserErrors=${JSON.stringify(errors.slice(-8))}`);
    }
    playbackOffsetSeconds = (Date.now() - videoStartedAt) / 1000;
    const finalTime = Math.max(0, profile.durationSeconds - (1 / profile.fps));
    await page.evaluate(() => window.__NEXUS_SHOWCASE__.startRealtime());
    await page.waitForTimeout(finalTime * 1000);
    finalState = await page.evaluate((time) => window.__NEXUS_SHOWCASE__.renderAt(time), finalTime);
    await page.screenshot({ path: posterPath });
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolveClose) => server.close(resolveClose));
  }

  const sourceVideo = await video.path();
  const rawVideoPath = join(runDir, `${id}-source.webm`);
  copyFileSync(sourceVideo, rawVideoPath);
  const target = resolve(outputPath || join(runDir, `${id}.mp4`));
  ensureDir(dirname(target));
  const frameCount = Math.round(profile.durationSeconds * profile.fps);
  const ffmpeg = spawnSync("ffmpeg", [
    "-y",
    "-i", rawVideoPath,
    "-ss", playbackOffsetSeconds.toFixed(3),
    "-vf", `fps=${profile.fps},tpad=stop_mode=clone:stop_duration=1,setpts=PTS-STARTPTS`,
    "-t", String(profile.durationSeconds),
    "-frames:v", String(frameCount),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-an",
    target,
  ], { encoding: "utf8" });
  if (ffmpeg.status !== 0) throw new Error(`FFmpeg realtime encode failed: ${ffmpeg.stderr}`);
  const encodedProbe = spawnSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name",
    "-of", "default=noprint_wrappers=1:nokey=1",
    target,
  ], { encoding: "utf8" });
  if (encodedProbe.status !== 0 || !encodedProbe.stdout.trim()) {
    throw new Error(`Realtime capture produced no video stream: ${encodedProbe.stderr || target}`);
  }

  const expectedObjects = profile.steps.length;
  const proceduralEditorProof = profile.presentation?.mode !== "procedural-editor"
    || (finalState?.meshProgram?.settingsApplied === true
      && finalState?.meshProgram?.previewRebuilt === true
      && finalState?.meshProgram?.libraryProgramCount === expectedObjects
      && Boolean(finalState?.meshProgram?.digest));
  const proofPassed = profile.schemaVersion !== "nexus.forest-showcase.v1"
    || (finalState?.test?.validated === expectedObjects
      && finalState?.world?.committed === expectedObjects
      && finalState?.complete === true
      && proceduralEditorProof
      && (!profile.nexusTerrain || finalState?.terrain?.status === "passed"));
  const report = {
    status: errors.length || !proofPassed ? "failed" : "passed",
    summary: errors.length || !proofPassed
      ? errors.length
        ? "The realtime agent showcase rendered with browser errors."
        : "The realtime agent showcase ended before its validation and world-commit proof completed."
      : `Rendered ${profile.steps.length} agent-guided objects across ${profile.durationSeconds} seconds at ${profile.fps} FPS.`,
    runId: id,
    profilePath: loaded.compiledPath || loaded.path,
    templateProfilePath: loaded.compiledPath ? loaded.path : null,
    prompt: loaded.prompt,
    webPath: join(webDir, "index.html"),
    videoPath: target,
    sourceVideoPath: rawVideoPath,
    posterPath,
    frameCount,
    objectCount: profile.steps.length,
    viewport: dimensions,
    fps: profile.fps,
    durationSeconds: profile.durationSeconds,
    captureMode: browserHeadless ? "realtime-headless" : "realtime-headed",
    playbackOffsetSeconds,
    consoleErrors: errors,
    harness,
    nexusProject,
    terrainValidation: summarizeTerrainValidation(profile.nexusTerrain),
    proof: finalState,
  };
  const reportPath = join(runDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, reportPath };
}

export async function runAgentShowcaseAction({
  browserHeadless = true,
  captureMode = "deterministic",
  captureFps = null,
  duration,
  domainPlanPath,
  fps,
  liveLoop = false,
  nexusEngineRoot,
  nexusProtoKitsRoot,
  outputPath,
  presentationMode = null,
  profilePath,
  prompt,
  runId,
  seed,
  settingsPatches = null,
  useCodex = false,
  viewport = "1920x1080",
}) {
  const loaded = loadProfile(profilePath, prompt, seed, domainPlanPath);
  const sourceDuration = Number(loaded.profile.durationSeconds || 15);
  const targetDuration = Number(duration || sourceDuration);
  const outputFps = Number(fps || loaded.profile.fps || 30);
  const resolvedCaptureFps = Number(captureFps || outputFps);
  if (!Number.isFinite(targetDuration) || targetDuration <= 0) throw new Error("Showcase duration must be a positive number.");
  if (!Number.isFinite(outputFps) || outputFps <= 0) {
    throw new Error("Showcase FPS must be a positive number.");
  }
  if (!Number.isFinite(resolvedCaptureFps) || resolvedCaptureFps <= 0 || resolvedCaptureFps > outputFps) {
    throw new Error("Showcase capture FPS must be positive and no greater than the output FPS.");
  }
  if (!["deterministic", "realtime"].includes(captureMode)) {
    throw new Error('Showcase capture mode must be "deterministic" or "realtime".');
  }
  let profile = {
    ...loaded.profile,
    durationSeconds: targetDuration,
    fps: outputFps,
    presentation: presentationMode ? { mode: presentationMode } : loaded.profile.presentation,
    timeline: scaleTimeline(loaded.profile.timeline, sourceDuration, targetDuration),
  };
  profile = applySettingsPatches(profile, settingsPatches);
  if (prompt && profile.generation?.nexusTerrain && !nexusEngineRoot && !nexusProtoKitsRoot) {
    const { nexusTerrain: _nexusTerrain, ...generation } = profile.generation;
    profile = {
      ...profile,
      generation,
      promptCompilation: {
        ...profile.promptCompilation,
        terrainMode: "local-showcase",
      },
    };
  } else if (prompt) {
    profile.promptCompilation = {
      ...profile.promptCompilation,
      terrainMode: "validated-nexus-terrain",
    };
  }
  const dimensions = parseViewport(viewport);
  const id = safeSlug(runId || `${profile.seed}-${Date.now()}`);
  profile.runId = id;
  const runDir = join(rootDir, ".nexus-simulator", "showcases", id);
  if (existsSync(runDir) && readdirSync(runDir).length > 0) {
    throw new Error(`Showcase run directory already exists. Use a new --run-id so world generation starts from scratch: ${runDir}`);
  }
  const webDir = join(runDir, "web");
  const framesDir = join(runDir, "frames");
  ensureDir(webDir);
  ensureDir(framesDir);
  if (prompt) {
    loaded.compiledPath = join(runDir, "prompt-profile.json");
  }
  const nexusProjectContext = initializeBlankNexusProject({ nexusEngineRoot, profile, runDir });
  const harness = await runWorldFactoryHarness(profile, runDir, { useCodex });
  if (harness.status !== "passed") {
    throw new Error(`WorldFactory-Harness Codex run failed: ${JSON.stringify({ agents: harness.agents, review: harness.review, revisions: harness.revisions })}`);
  }
  profile.loopPlan = harness.loopPlan;
  const librarySelections = new Map((harness.library?.assets || []).map((asset) => [asset.id, asset.selected]));
  profile.steps = profile.steps.map((step) => {
    const selected = librarySelections.get(step.id);
    const selectedStep = selected ? { ...step, algorithm: selected.algorithm, seed: selected.seed, confidence: selected.confidence } : step;
    return { ...selectedStep, meshProgram: createProceduralMeshProgram(selectedStep) };
  });
  profile.meshPrograms = {
    schemaVersion: "nexus.procedural-mesh-program-library.v1",
    execution: "typed-runtime-interpreter",
    sources: proceduralMeshSources(),
    programs: profile.steps.map((step) => step.meshProgram),
  };
  const nexusProject = await materializeAndValidateNexusProject({
    context: nexusProjectContext,
    harness,
    profile,
  });
  if (profile.generation?.nexusTerrain) {
    if (!nexusEngineRoot || !nexusProtoKitsRoot) {
      throw new Error("Nexus terrain showcases require --nexus-engine-root and --nexus-protokits-root (or their environment variables). No recording was started.");
    }
    const terrainValidation = await validateNexusTerrainStreaming({
      engineRoot: nexusEngineRoot,
      profile,
      protoKitsRoot: nexusProtoKitsRoot,
      runDir,
    });
    if (terrainValidation.status !== "passed") {
      throw new Error(`Nexus terrain validation failed before recording: ${terrainValidation.reportPath}`);
    }
    profile.nexusTerrain = terrainValidation;
  }
  copyThreeVendor(webDir);
  writeFileSync(join(webDir, "index.html"), createShowcaseHtml(profile));
  writeFileSync(join(runDir, "profile.json"), `${JSON.stringify(profile, null, 2)}\n`);
  if (loaded.compiledPath) writeFileSync(loaded.compiledPath, `${JSON.stringify(profile, null, 2)}\n`);

  if (liveLoop) {
    return runRealtimeLiveLoop({ dimensions, harness, id, loaded, nexusProject, outputPath, profile, runDir, webDir });
  }

  if (captureMode === "realtime") {
    return runRealtimeCapture({ browserHeadless, dimensions, harness, id, loaded, nexusProject, outputPath, profile, runDir, webDir });
  }

  const errors = [];
  let finalState = null;
  const { server, url } = await createStaticServer(webDir);
  let browser = null;
  let page = null;

  try {
    browser = await chromium.launch({ headless: browserHeadless });
    page = await browser.newPage({ viewport: dimensions, deviceScaleFactor: 1 });
    page.setDefaultTimeout(120_000);
    page.setDefaultNavigationTimeout(120_000);
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${url}?capture=1`, { waitUntil: "networkidle" });
    await page.waitForSelector("body[data-ready='true']");
    const frameCount = Math.round(profile.durationSeconds * resolvedCaptureFps);
    const digits = String(frameCount).length;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const frameTime = frame / resolvedCaptureFps;
      const framePath = join(framesDir, `frame-${String(frame).padStart(digits, "0")}.jpg`);
      let captured = false;
      let captureError = null;
      for (let attempt = 1; attempt <= 2 && !captured; attempt += 1) {
        try {
          await page.evaluate((time) => window.__NEXUS_SHOWCASE__.renderAt(time), frameTime);
          await page.screenshot({ path: framePath, type: "jpeg", quality: 90, timeout: 90_000 });
          captured = true;
        } catch (error) {
          captureError = error;
          if (attempt < 2) await page.waitForTimeout(250);
        }
      }
      if (!captured) {
        throw new Error(`Deterministic capture failed at frame ${frame + 1}/${frameCount} (${frameTime.toFixed(2)}s): ${captureError?.message || "unknown screenshot error"}`);
      }
    }
    await page.evaluate((time) => window.__NEXUS_SHOWCASE__.renderAt(time), profile.durationSeconds - 1 / profile.fps);
    finalState = await page.evaluate(() => window.__NEXUS_SHOWCASE_STATE__);
    await page.screenshot({ path: join(runDir, "poster.png") });
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolveClose) => server.close(resolveClose));
  }

  const target = resolve(outputPath || join(runDir, `${id}.mp4`));
  ensureDir(dirname(target));
  const capturedFrameCount = Math.round(profile.durationSeconds * resolvedCaptureFps);
  const patternDigits = String(capturedFrameCount).length;
  const cadenceFilter = resolvedCaptureFps === profile.fps
    ? null
    : `tpad=stop_mode=clone:stop_duration=1,fps=fps=${profile.fps}:round=near,trim=duration=${profile.durationSeconds},setpts=PTS-STARTPTS`;
  const ffmpeg = spawnSync("ffmpeg", [
    "-y",
    "-framerate", String(resolvedCaptureFps),
    "-i", join(framesDir, `frame-%0${patternDigits}d.jpg`),
    ...(cadenceFilter ? ["-vf", cadenceFilter] : []),
    "-t", String(profile.durationSeconds),
    "-frames:v", String(Math.round(profile.durationSeconds * profile.fps)),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "16",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    target,
  ], { encoding: "utf8" });
  if (ffmpeg.status !== 0) throw new Error(`FFmpeg showcase encode failed: ${ffmpeg.stderr}`);

  const expectedObjects = profile.steps.length;
  const proofPassed = profile.schemaVersion !== "nexus.forest-showcase.v1"
    || (finalState?.test?.validated === expectedObjects
      && finalState?.world?.committed === expectedObjects
      && finalState?.complete === true
      && (!profile.nexusTerrain || finalState?.terrain?.status === "passed"));
  const report = {
    status: errors.length || !proofPassed ? "failed" : "passed",
    summary: errors.length || !proofPassed
      ? errors.length
        ? "The agent showcase rendered with browser errors."
        : "The agent showcase rendered, but its final build, view, validate, or world-commit proof was incomplete."
      : `Rendered ${profile.steps.length} agent-guided objects across ${profile.durationSeconds} seconds at ${profile.fps} FPS.`,
    runId: id,
    profilePath: loaded.compiledPath || loaded.path,
    templateProfilePath: loaded.compiledPath ? loaded.path : null,
    prompt: loaded.prompt,
    webPath: join(webDir, "index.html"),
    videoPath: target,
    posterPath: join(runDir, "poster.png"),
    frameCount: Math.round(profile.durationSeconds * profile.fps),
    objectCount: profile.steps.length,
    viewport: dimensions,
    fps: profile.fps,
    captureFps: resolvedCaptureFps,
    capturedFrameCount,
    cadenceMode: resolvedCaptureFps === profile.fps ? "native" : "frame-hold",
    durationSeconds: profile.durationSeconds,
    captureMode: "deterministic-frames",
    consoleErrors: errors,
    harness,
    nexusProject,
    terrainValidation: summarizeTerrainValidation(profile.nexusTerrain),
    proof: finalState,
  };
  const reportPath = join(runDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, reportPath };
}
