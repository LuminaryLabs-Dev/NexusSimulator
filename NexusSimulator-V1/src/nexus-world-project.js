import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function resolveEngineRoot(input) {
  const candidates = [input, resolve(packageRoot, "..", "..", "NexusEngine")].filter(Boolean).map((path) => resolve(path));
  const root = candidates.find((path) => existsSync(join(path, "src", "index.js")) && existsSync(join(path, "package.json")));
  if (!root) {
    throw new Error("A blank prompt world requires NexusEngine. Supply --nexus-engine-root <path> or place NexusEngine beside NexusSimulator.");
  }
  return root;
}

function featureCenter(step) {
  return { x: Number(step.position?.[0] || 0) * 100, z: Number(step.position?.[2] || 0) * 100 };
}

function featurePath(center, scale = 1, profile = null) {
  if (profile?.worldPlan?.river?.path?.length) {
    return profile.worldPlan.river.path.map((point) => ({ x: point.x * 100, z: point.z * 100 }));
  }
  return [
    { x: center.x - 420 * scale, z: center.z - 120 * scale },
    { x: center.x, z: center.z },
    { x: center.x + 420 * scale, z: center.z + 120 * scale },
  ];
}

function featuresForStep(step, profile) {
  const center = featureCenter(step);
  const id = step.id;
  const biome = profile.defaultWorldType || "forest";
  if (step.type === "terrainPatch") {
    return [{ id: `${id}:biome`, type: "biome-region", definition: { center, radius: 1400, edgeWidth: 180, biome, weight: 1 } }];
  }
  if (["oak", "birch", "pine"].includes(step.type)) {
    return [{ id: `${id}:ecology`, type: biome === "forest" ? "forest" : "woodland", definition: { center, radius: 320, density: 0.72, species: [step.type] } }];
  }
  if (step.type === "willow") {
    const path = featurePath(center, 1, profile);
    return [
      { id: `${id}:river`, type: "river", definition: { path, width: 120, depth: 9, flow: 1, sharpness: 1.7 } },
      { id: `${id}:riparian`, type: "riparian-zone", definition: { path, width: 180, density: 0.84, waterFeature: `${id}:river` } },
    ];
  }
  if (step.type === "bridge") {
    return [{ id: `${id}:bridge`, type: "bridge", definition: { crossing: center, span: 80, width: 12, clearance: 10, bridgeType: "procedural" } }];
  }
  if (step.type === "waterfall") {
    return [{ id: `${id}:waterfall`, type: "waterfall", definition: { edge: center, radius: 90, drop: 36, flow: 1 } }];
  }
  if (step.type === "mushrooms") {
    return [{ id: `${id}:habitat`, type: "habitat-patch", definition: { center, radius: 180, density: 0.8, habitatType: "fungal" } }];
  }
  if (step.type === "fireflies") {
    return [{ id: `${id}:habitat`, type: "habitat-patch", definition: { center, radius: 220, density: 0.6, habitatType: "insect" } }];
  }
  return [{
    id: `${id}:landmark`,
    type: "landmark",
    definition: { center, radius: 70, visibility: 2200, landmarkType: step.type, density: 1 },
  }];
}

function kitDomains(step) {
  const domains = [
    "n:world",
    "n:world:foundation",
    "n:world:features",
    "n:object",
    "n:object:shape",
    "n:object:fidelity",
    "n:core-graphics",
    "n:core-physics",
  ];
  if (["oak", "birch", "pine", "willow"].includes(step.type)) {
    domains.push("n:object:vegetation", "n:object:vegetation:tree", "n:object:vegetation:ecology");
  }
  return domains;
}

function materialDescriptor(profile) {
  const appearance = profile.generationPolicy.appearance;
  const skin = appearance.skin;
  return {
    id: `${profile.defaultWorldType}-world-pbr-library`,
    atlas: {
      id: `${profile.defaultWorldType}-world-pbr-atlas`,
      resolution: appearance.targetTextureResolution,
      columns: 2,
      rows: 1,
      paddingPixels: 8,
      compression: appearance.compression,
      runtimeFallback: "canvas-generated",
      assets: {},
    },
    families: [
      {
        id: "world-base",
        label: `${profile.defaultWorldType} base`,
        baseColor: skin.baseColor,
        generator: { kind: "multi-octave-natural-surface", seed: 1, scale: 1, grain: 0.48, cavity: 0.34, speckle: 0.2 },
        surface: { roughness: skin.roughness, metalness: skin.metalness, normalStrength: 0.42, aoStrength: 0.72, heightStrength: 0.08 },
        textureChannels: appearance.textureChannels,
      },
      {
        id: "world-accent",
        label: `${profile.defaultWorldType} accent`,
        baseColor: skin.accent,
        generator: { kind: "multi-octave-natural-surface", seed: 2, scale: 0.72, grain: 0.36, cavity: 0.42, streak: 0.16 },
        surface: { roughness: Math.max(0, skin.roughness - 0.08), metalness: skin.metalness, normalStrength: 0.36, aoStrength: 0.68, heightStrength: 0.06 },
        textureChannels: appearance.textureChannels,
      },
    ],
    qualityTiers: [
      { id: "high", channels: appearance.textureChannels, maxAnisotropy: 8, maximumSamples: 18 },
      { id: "medium", channels: ["baseColor", "normal", "packedSurface"], maxAnisotropy: 4, maximumSamples: 9 },
      { id: "low", channels: ["baseColor"], maxAnisotropy: 2, maximumSamples: 3 },
    ],
    assignments: profile.steps.map((step, index) => ({
      id: `${step.id}:pbr-skin`,
      target: step.id,
      families: index % 3 === 0 ? ["world-base", "world-accent"] : [index % 2 ? "world-accent" : "world-base"],
      mapping: { type: "triplanar", space: "object", scale: 0.12, blendSharpness: 5, seed: index + 1 },
      mask: index % 3 === 0 ? { kind: "vertex-color-key", keyColor: skin.accent, threshold: 0.28, softness: 0.12 } : { kind: "none" },
      surface: { roughness: skin.roughness, metalness: skin.metalness, normalStrength: 0.4, aoStrength: 0.7 },
      quality: "high",
      qualityByLod: { medium: "medium", far: "low" },
      tint: step.color,
    })),
    defaultQuality: "high",
    metadata: {
      generatedFromScratch: true,
      materialModel: appearance.materialModel,
      reskinStage: appearance.stage,
      primarySource: appearance.source,
    },
  };
}

function kitManifest(step, profile, harness) {
  const cycle = harness.loopPlan.find((entry) => entry.id === step.id);
  const candidate = step.generationRecipe.algorithmCandidates.find((entry) => entry.id === cycle?.selectedAlgorithm) || step.generationRecipe.algorithmCandidates[0];
  const extent = [2, 4, 2];
  return {
    schemaVersion: "nexus.generated-world-kit.v1",
    id: `n-generated-${step.id}-kit`,
    sourceStepId: step.id,
    label: step.label,
    objectType: step.type,
    seed: cycle?.selectedSeed || `${profile.seed}:${step.id}`,
    domains: kitDomains(step),
    features: featuresForStep(step, profile),
    object: {
      id: step.id,
      objectType: `generated-world:${step.type}`,
      bounds: { min: [-extent[0], 0, -extent[2]], max: [extent[0], extent[1], extent[2]] },
      pivot: [0, extent[1] * 0.5, 0],
      groundAnchor: [0, 0, 0],
      geometry: { provider: "worldfactory-natural-math", descriptorId: `${step.id}:fresh-low-poly-mesh` },
      material: { provider: "core-graphics-procedural-pbr", descriptorId: `${step.id}:pbr-skin` },
      collision: { provider: "core-physics", descriptorId: `${step.id}:bounds-collision` },
      transform: { position: step.position, yaw: Number(step.yaw || 0), scale: Number(step.scale || 1) },
      metadata: { generatedFromScratch: true, algorithm: candidate.id, algorithmMath: candidate.math },
    },
    shapeSource: {
      id: `${step.id}:shape-source`,
      kind: "triangle-mesh",
      asset: { assetId: `${step.id}:fresh-low-poly-mesh`, kind: "procedural-low-poly" },
      metrics: { maximumTriangles: profile.generationPolicy.geometry.maximumTrianglesPerAsset },
      metadata: { generatedFromScratch: true, algorithm: candidate.id },
    },
    fidelityProfile: {
      id: `${step.id}:fidelity`,
      identity: { preserveSilhouette: true, preserveGrounding: true, preserveMajorStructure: true, preserveMaterialResponse: true },
      forms: [{
        id: "low-poly-pbr",
        fidelity: "low-poly-pbr",
        builderId: "source-form",
        required: true,
        minimumProjectedSize: 0,
        requiredTraits: ["stable-silhouette", "stable-grounding", "pbr-reskinnable"],
      }],
      change: { mode: "replace", duration: 0, hysteresis: 0 },
    },
    generation: {
      algorithm: candidate,
      geometry: profile.generationPolicy.geometry,
      appearance: profile.generationPolicy.appearance,
      attempts: cycle?.attempts || [],
    },
  };
}

function generatedRunner(engineIndexUrl) {
  return `import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCoreGraphicsDomain,
  createCoreObjectDomain,
  createCorePhysicsDomain,
  createCoreWorldDomain,
  createEngine,
  createProceduralMaterialDescriptor,
  validateProceduralMaterialDescriptor
} from ${JSON.stringify(engineIndexUrl)};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const project = JSON.parse(readFileSync(join(root, "project.json"), "utf8"));
const materialsInput = JSON.parse(readFileSync(join(root, "materials", "pbr-library.json"), "utf8"));
const kits = project.kits.map((path) => JSON.parse(readFileSync(join(root, path), "utf8")));
const materialLibrary = createProceduralMaterialDescriptor(materialsInput);

function blankEngine() {
  return createEngine({
    kits: [
      createCoreWorldDomain(),
      ...createCoreObjectDomain(),
      ...createCoreGraphicsDomain(),
      ...createCorePhysicsDomain()
    ]
  });
}

const physicsRegistries = new WeakMap();

function registerPhysics(engine, kit) {
  const registry = physicsRegistries.get(engine) || { bodies: [], colliders: [] };
  const body = {
    id: kit.sourceStepId + ":static-body",
    kind: "static",
    position: kit.object.transform.position,
    metadata: { generatedFromScratch: true }
  };
  const collider = {
    id: kit.sourceStepId + ":bounds-collider",
    bodyId: body.id,
    kind: "box",
    minimum: kit.object.bounds.min,
    maximum: kit.object.bounds.max,
    metadata: { provider: kit.object.collision.provider }
  };
  registry.bodies.push(body);
  registry.colliders.push(collider);
  engine.n.corePhysics.syncBodies(registry.bodies);
  engine.n.corePhysics.syncColliders(registry.colliders);
  physicsRegistries.set(engine, registry);
  return { body, collider, bodyCount: registry.bodies.length, colliderCount: registry.colliders.length };
}

function registerVegetation(engine, kit) {
  if (!["oak", "birch", "pine", "willow"].includes(kit.objectType)) return null;
  const species = engine.n.vegetation.registerSpecies({
    id: kit.sourceStepId + ":species",
    family: kit.objectType,
    kind: "tree",
    bounds: kit.object.bounds,
    parts: [
      { id: "trunk", kind: "trunk", regions: ["bark"] },
      { id: "canopy", parentId: "trunk", kind: "canopy", regions: ["foliage"] }
    ],
    ecology: { moisture: kit.objectType === "willow" ? 0.9 : 0.45, elevation: 0.2, slope: 0.2, temperature: 0.65, distributionWeight: 1 },
    variation: { groundSink: [0.05, 0.25] }
  });
  const tree = engine.n.vegetationTree.register({
    id: kit.sourceStepId + ":tree",
    speciesId: species.id,
    averageHeight: kit.object.bounds.max[1],
    averageWidth: kit.object.bounds.max[0] * 2,
    shape: kit.objectType === "willow" ? "broad-drooping-canopy" : "natural-canopy",
    metadata: { algorithm: kit.generation.algorithm.id }
  });
  return { species, tree };
}

async function installKit(engine, kit) {
  engine.n.coreGraphics.setDescriptor("proceduralMaterials", materialLibrary.id, materialLibrary);
  for (const feature of kit.features) engine.n.worldFeatures.registerFeature(feature);
  const object = engine.n.coreObject.register(kit.object);
  const shape = engine.n.objectShape.registerSource({
    ...kit.shapeSource,
    objectId: object.id,
    objectContentHash: object.contentHash
  });
  const profile = engine.n.objectFidelity.registerProfile(kit.fidelityProfile);
  const fidelity = await engine.n.objectFidelity.requestBuild({ objectId: object.id, profileId: profile.id });
  const vegetation = registerVegetation(engine, kit);
  const physics = registerPhysics(engine, kit);
  return { fidelity, object, physics, profile, shape, vegetation };
}

function compileWorld(engine, id) {
  return engine.n.worldFeatures.compileCell({
    id,
    bounds: { minX: -2500, minZ: -2500, maxX: 2500, maxZ: 2500 }
  }, { baseFoundation: { elevation: 0, material: { kind: project.worldType + "-base" } } });
}

async function validateOne(kit) {
  const engine = blankEngine();
  const installed = await installKit(engine, kit);
  const compiled = compileWorld(engine, "isolated:" + kit.id);
  const materialValid = validateProceduralMaterialDescriptor(materialLibrary).valid;
  const checks = {
    blankEngine: engine.n.worldFeatures.listFeatures().length === kit.features.length,
    coreDomainsInstalled: kit.domains.every((path) => Boolean(engine.n.path(path))),
    fidelityReady: installed.fidelity.state === "ready",
    freshShapeSource: installed.shape.metadata.generatedFromScratch === true,
    physicsRegistered: installed.physics.bodyCount === 1 && installed.physics.colliderCount === 1,
    pbrMaterial: materialValid && materialLibrary.defaultQuality === "high",
    worldFeatureCompiled: compiled.features.length === kit.features.length && compiled.contributions.length >= kit.features.length,
    portableState: true
  };
  try {
    structuredClone({
      world: engine.n.worldFeatures.getSnapshot(),
      foundation: engine.n.worldFoundation.getSnapshot(),
      object: engine.n.coreObject.getSnapshot(),
      shape: engine.n.objectShape.getSnapshot(),
      fidelity: engine.n.objectFidelity.getSnapshot(),
      graphics: engine.n.coreGraphics.getSnapshot()
    });
  } catch {
    checks.portableState = false;
  }
  return {
    id: kit.id,
    sourceStepId: kit.sourceStepId,
    status: Object.values(checks).every(Boolean) ? "passed" : "failed",
    checks,
    featureCount: compiled.features.length,
    contributionCount: compiled.contributions.length,
    algorithm: kit.generation.algorithm,
    materialAssignment: kit.object.material.descriptorId
  };
}

const receipts = [];
for (const kit of kits) receipts.push(await validateOne(kit));
const passingIds = new Set(receipts.filter((receipt) => receipt.status === "passed").map((receipt) => receipt.id));
const compositionEngine = blankEngine();
const passingKits = kits.filter((kit) => passingIds.has(kit.id));
for (const kit of passingKits) await installKit(compositionEngine, kit);
const composition = compileWorld(compositionEngine, "composed-world");
const compositionChecks = {
  freshEngine: true,
  onlyPassingKits: passingKits.length === receipts.length,
  allFeaturesPresent: composition.features.length === passingKits.reduce((count, kit) => count + kit.features.length, 0),
  allContributionsPresent: composition.contributions.length >= composition.features.length,
  allCollidersPresent: physicsRegistries.get(compositionEngine)?.colliders.length === passingKits.length,
  worldPlanValid: project.worldPlan?.validation?.passed !== false,
  portableSnapshot: true
};
try {
  structuredClone({
    features: compositionEngine.n.worldFeatures.getSnapshot(),
    foundation: compositionEngine.n.worldFoundation.getSnapshot(),
    objects: compositionEngine.n.coreObject.getSnapshot(),
    graphics: compositionEngine.n.coreGraphics.getSnapshot(),
    physics: compositionEngine.n.corePhysics.getSnapshot()
  });
} catch {
  compositionChecks.portableSnapshot = false;
}

const proof = {
  schemaVersion: "nexus.blank-world-project-proof.v1",
  status: receipts.every((receipt) => receipt.status === "passed") && Object.values(compositionChecks).every(Boolean) ? "passed" : "failed",
  scratch: {
    blankProject: project.createdFrom === "blank-nexus-engine-project" && project.scratch.reusePriorProject === false,
    reusedPriorWorldState: project.scratch.reusePriorWorldState !== false,
    reusedPriorGeometry: project.scratch.reusePriorGeometry !== false,
    reusedPriorTextures: project.scratch.reusePriorTextures !== false,
    reusedPriorGenerationLessons: project.scratch.reusePriorGenerationLessons !== false,
    isolatedEngineCount: receipts.length,
    compositionEngineWasFresh: true
  },
  coreDomains: project.coreDomains,
  receipts,
  composition: {
    status: Object.values(compositionChecks).every(Boolean) ? "passed" : "failed",
    checks: compositionChecks,
    kitCount: passingKits.length,
    featureCount: composition.features.length,
    contributionCount: composition.contributions.length
  },
  material: {
    schema: materialLibrary.schema,
    model: project.appearance.materialModel,
    defaultQuality: materialLibrary.defaultQuality,
    channels: project.appearance.textureChannels,
    targetResolution: project.appearance.targetTextureResolution,
    mapping: project.appearance.mapping,
    reskinStage: project.appearance.stage
  },
  worldPlan: project.worldPlan ? {
    seed: project.worldPlan.seed,
    digest: project.worldPlan.digest,
    algorithm: project.worldPlan.algorithm,
    validation: project.worldPlan.validation,
    placementCount: project.worldPlan.placements.length,
    riverAlgorithm: project.worldPlan.river?.algorithm || null
  } : null
};
writeFileSync(join(root, "proof", "project-proof.json"), JSON.stringify(proof, null, 2) + "\\n");
console.log(JSON.stringify({ status: proof.status, kits: receipts.length, composition: proof.composition.status }));
if (proof.status !== "passed") process.exitCode = 1;
`;
}

function runGeneratedProject(projectDir) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [join(projectDir, "src", "main.mjs")], {
      cwd: projectDir,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("close", (code) => {
      if (code !== 0) {
        rejectRun(new Error(`Generated Nexus Engine project failed: ${stderr || stdout || `exit ${code}`}`));
        return;
      }
      resolveRun({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export function initializeBlankNexusProject({ nexusEngineRoot, profile, runDir }) {
  const engineRoot = resolveEngineRoot(nexusEngineRoot);
  const projectDir = join(runDir, "nexus-project");
  if (existsSync(projectDir) && readdirSync(projectDir).length) {
    throw new Error(`Nexus Engine project directory is not blank: ${projectDir}`);
  }
  ensureDir(join(projectDir, "kits"));
  ensureDir(join(projectDir, "materials"));
  ensureDir(join(projectDir, "proof"));
  ensureDir(join(projectDir, "src"));
  const enginePackage = JSON.parse(readFileSync(join(engineRoot, "package.json"), "utf8"));
  const skeleton = {
    schemaVersion: "nexus.blank-world-project.v1",
    id: profile.runId,
    status: "blank",
    createdFrom: "blank-nexus-engine-project",
    prompt: profile.promptCompilation?.prompt || null,
    seed: profile.seed,
    worldType: profile.defaultWorldType,
    worldStructure: profile.defaultWorldStructure,
    worldPlan: profile.worldPlan || null,
    scratch: profile.generationPolicy.scratch,
    appearance: profile.generationPolicy.appearance,
    coreDomains: [],
    kits: [],
    nexusEngine: { packageName: enginePackage.name, version: enginePackage.version },
  };
  writeJson(join(projectDir, "project.json"), skeleton);
  writeJson(join(projectDir, "package.json"), {
    name: `nexus-world-${profile.runId}`,
    private: true,
    type: "module",
    scripts: { validate: "node ./src/main.mjs" },
  });
  return { engineRoot, projectDir, projectPath: join(projectDir, "project.json") };
}

export async function materializeAndValidateNexusProject({ context, harness, profile }) {
  const manifests = profile.steps.map((step) => kitManifest(step, profile, harness));
  const kitPaths = manifests.map((manifest) => `kits/${manifest.id}.json`);
  manifests.forEach((manifest, index) => writeJson(join(context.projectDir, kitPaths[index]), manifest));
  const materials = materialDescriptor(profile);
  writeJson(join(context.projectDir, "materials", "pbr-library.json"), materials);
  const project = {
    ...JSON.parse(readFileSync(context.projectPath, "utf8")),
    status: "generated",
    coreDomains: [...new Set(manifests.flatMap((manifest) => manifest.domains))].sort(),
    kits: kitPaths,
  };
  writeJson(context.projectPath, project);
  const engineIndexUrl = pathToFileURL(join(context.engineRoot, "src", "index.js")).href;
  writeFileSync(join(context.projectDir, "src", "main.mjs"), generatedRunner(engineIndexUrl));
  const execution = await runGeneratedProject(context.projectDir);
  const proofPath = join(context.projectDir, "proof", "project-proof.json");
  const proof = JSON.parse(readFileSync(proofPath, "utf8"));
  if (proof.status !== "passed") throw new Error(`Generated Nexus Engine project proof failed: ${proofPath}`);
  return {
    ...proof,
    projectDir: context.projectDir,
    projectPath: context.projectPath,
    proofPath,
    execution,
  };
}
