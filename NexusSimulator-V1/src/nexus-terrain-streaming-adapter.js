import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function moduleUrl(path) {
  if (!existsSync(path)) throw new Error(`Required Nexus source does not exist: ${path}`);
  return pathToFileURL(path).href;
}

function edgeSamples(chunk, edge) {
  const size = chunk.resolution + 1;
  const values = [];
  for (let index = 0; index < size; index += 1) {
    const sample = edge === "west" ? index * size
      : edge === "east" ? index * size + chunk.resolution
        : edge === "north" ? index
          : chunk.resolution * size + index;
    values.push({
      height: chunk.heightField[sample],
      normal: [chunk.normalField[sample * 3], chunk.normalField[sample * 3 + 1], chunk.normalField[sample * 3 + 2]],
    });
  }
  return values;
}

function seamDelta(left, right) {
  let height = 0;
  let normal = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    height = Math.max(height, Math.abs(left[index].height - right[index].height));
    normal = Math.max(normal, Math.hypot(
      left[index].normal[0] - right[index].normal[0],
      left[index].normal[1] - right[index].normal[1],
      left[index].normal[2] - right[index].normal[2]
    ));
  }
  return { height, normal };
}

function validateSeams(chunks, { heightEpsilon, normalEpsilon }) {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  const seams = [];
  for (const chunk of chunks) {
    const east = byId.get(`${chunk.cx + 1},${chunk.cz}`);
    const south = byId.get(`${chunk.cx},${chunk.cz + 1}`);
    if (east && east.resolution === chunk.resolution) seams.push({ a: chunk.id, b: east.id, ...seamDelta(edgeSamples(chunk, "east"), edgeSamples(east, "west")) });
    if (south && south.resolution === chunk.resolution) seams.push({ a: chunk.id, b: south.id, ...seamDelta(edgeSamples(chunk, "south"), edgeSamples(south, "north")) });
  }
  const failures = seams.filter((seam) => seam.height > heightEpsilon || seam.normal > normalEpsilon);
  return {
    passed: seams.length > 0 && failures.length === 0,
    seamCount: seams.length,
    maxHeightDelta: Math.max(0, ...seams.map((seam) => seam.height)),
    maxNormalDelta: Math.max(0, ...seams.map((seam) => seam.normal)),
    failures,
  };
}

function serializeChunk(chunk) {
  return {
    id: chunk.id,
    cx: chunk.cx,
    cz: chunk.cz,
    size: chunk.size,
    bounds: chunk.bounds,
    resolution: chunk.resolution,
    heightField: Array.from(chunk.heightField),
    normalField: Array.from(chunk.normalField),
    materialField: Array.from(chunk.materialField),
    materialPalette: chunk.materialPalette,
    materialColors: chunk.materialColors,
    signature: chunk.signature,
    version: chunk.version,
  };
}

function boundsForChunks(chunks) {
  return chunks.reduce((bounds, chunk) => ({
    minX: Math.min(bounds.minX, chunk.bounds.minX),
    minZ: Math.min(bounds.minZ, chunk.bounds.minZ),
    maxX: Math.max(bounds.maxX, chunk.bounds.maxX),
    maxZ: Math.max(bounds.maxZ, chunk.bounds.maxZ),
  }), { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity });
}

export async function validateNexusTerrainStreaming({ engineRoot, profile, protoKitsRoot, runDir }) {
  const engine = await import(moduleUrl(join(resolve(engineRoot), "src", "index.js")));
  const banded = await import(moduleUrl(join(resolve(protoKitsRoot), "protokits", "banded-infinite-terrain-kit", "index.js")));
  const imports = await import(moduleUrl(join(resolve(protoKitsRoot), "protokits", "object-import-profile-kit", "index.js")));
  const grounding = await import(moduleUrl(join(resolve(protoKitsRoot), "protokits", "object-grounding-profile-kit", "index.js")));
  const config = profile.generation?.nexusTerrain;
  if (!config) throw new Error("Profile is missing generation.nexusTerrain configuration.");

  const terrain = engine.createTerrainKit({
    id: config.id,
    infinite: true,
    chunks: {
      size: config.chunkSize,
      viewRadius: config.activeRadius,
      activeRadius: config.activeRadius,
      preloadRadius: config.preloadRadius,
      unloadRadius: config.unloadRadius,
      lod: [{ distance: Number.MAX_SAFE_INTEGER, resolution: config.resolution }],
    },
    smoothing: config.smoothing,
    materialColors: config.materialColors,
    layers: [
      engine.terrainLayers.baseNoise({ id: "everglen-base", amplitude: config.amplitude, frequency: config.frequency, seed: profile.seed }),
      engine.terrainLayers.erosion({ id: "everglen-soften", iterations: config.erosionIterations, strength: config.erosionStrength, preserveRidges: true }),
      engine.terrainLayers.materials({ id: "everglen-materials", rules: [
        { material: "grass", belowSlope: 0.62 },
        { material: "rock", aboveSlope: 0.62 },
      ] }),
    ],
  });
  const runtime = engine.createEngine({ kits: [terrain] });
  const focusResource = terrain.definitions.resources.TerrainFocusState;
  const flightPath = config.flightPath.map((point) => ({ x: Number(point.x), z: Number(point.z) }));
  const chunks = new Map();
  const streamingSteps = [];
  for (const focus of flightPath) {
    runtime.world.setResource(focusResource, focus);
    runtime.tick(1 / 60);
    const snapshot = runtime.world.getResource(terrain.definitions.resources.TerrainSnapshot);
    snapshot.visibleChunks.forEach((chunk) => chunks.set(chunk.id, chunk));
    streamingSteps.push({ focus, visible: snapshot.visibleChunks.map((chunk) => chunk.id), cacheStats: snapshot.cacheStats });
  }
  const activeExpected = Math.pow(config.activeRadius * 2 + 1, 2);
  const coveragePassed = streamingSteps.every((step) => step.visible.length === activeExpected);
  const streamedChunks = Array.from(chunks.values());
  const seams = validateSeams(streamedChunks, config.seamValidation);
  const query = engine.createTerrainQuery(runtime.world, terrain);

  let bandedState = banded.createBandedTerrainState({
    camera: flightPath[0],
    snapSize: config.snapSize,
    maxRadius: config.horizonRadius,
    rings: config.rings,
    segments: config.segments,
  });
  for (const point of flightPath.slice(1)) bandedState = banded.advanceBandedTerrainState(bandedState, { camera: point, dt: 1 / 60 });
  const bandedContract = banded.createBandedTerrainRenderContract(bandedState);
  const bandedValidation = banded.validateBandedTerrainContract(bandedContract);

  const importState = imports.createObjectImportProfileState({ profiles: config.objectProfiles });
  const groundingState = grounding.createObjectGroundingProfileState(config.groundingProfiles);
  const objectProfiles = profile.steps.map((step) => {
    const kind = config.kindByType[step.type] ?? "object";
    const importProfile = importState.profiles[`${kind}-default`] ?? importState.profiles[kind] ?? importState.profiles.generic;
    const normal = query.normalAt(step.position[0], step.position[2]);
    const groundingProfile = grounding.describeObjectGroundingProfile({ kind }, { kind }, { normal }, groundingState);
    return { id: step.id, kind, importProfile, groundingProfile };
  });
  const groundingPassed = objectProfiles.every((entry) => entry.groundingProfile.valid);
  const passed = coveragePassed && seams.passed && bandedValidation.passed && groundingPassed;
  const report = {
    status: passed ? "passed" : "failed",
    source: {
      engineRoot: resolve(engineRoot),
      protoKitsRoot: resolve(protoKitsRoot),
      terrainKit: "NexusEngine/src/terrain-kit.js",
      bandedTerrainKit: "NexusEngine-ProtoKits/protokits/banded-infinite-terrain-kit",
      objectImportProfileKit: "NexusEngine-ProtoKits/protokits/object-import-profile-kit",
      objectGroundingProfileKit: "NexusEngine-ProtoKits/protokits/object-grounding-profile-kit",
    },
    coverage: { passed: coveragePassed, expectedVisiblePerStep: activeExpected, steps: streamingSteps },
    seams,
    banded: { passed: bandedValidation.passed, failures: bandedValidation.failures, contract: bandedContract },
    grounding: { passed: groundingPassed, profiles: objectProfiles },
    flightPath,
    validatedBounds: boundsForChunks(streamedChunks),
    chunks: streamedChunks.map(serializeChunk),
  };
  mkdirSync(runDir, { recursive: true });
  const reportPath = join(runDir, "nexus-terrain-validation.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { ...report, reportPath };
}
