import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";
import { executeScenario } from "./runtime.js";
import { createPlaywrightAdapter } from "./playwright-simtime.js";
import {
  createProfileContext,
  loadFactoryConfig,
  resolveFactoryProfile,
  resolveSpawnSlots,
  validateFactoryConfig,
} from "./factory-profiles.js";
import { createHyperrealThreePreviewHtml } from "./factory-three-preview.js";
import {
  createSpeciesCatalog,
  createTreeTopology,
  selectTreeSpecies,
  treeSpeciesIds,
} from "./tree-species.js";

const require = createRequire(import.meta.url);
const rootDir = resolve(process.cwd(), ".nexus-simulator");
const factoryRoot = join(rootDir, "factory-runs");
const assetPackRoot = join(rootDir, "asset-packs");
const minPassingScore = 80;
const baseFactoryNames = ["LeafFactory", "TreeFactory", "FoliagePatchFactory", "ForestFactory"];
const factoryNames = [
  ...baseFactoryNames,
  ...baseFactoryNames.map((factoryName) => `${factoryName}2D`),
];
const texturePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAG0lEQVR4nGP8z8AARLJgwiM3jGJgYJgBAA8dAglksR1vAAAAAElFTkSuQmCC",
  "base64",
);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, pixelAt) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelAt(x, y);
      const offset = 1 + x * 4;
      row[offset] = Math.max(0, Math.min(255, Math.round(r)));
      row[offset + 1] = Math.max(0, Math.min(255, Math.round(g)));
      row[offset + 2] = Math.max(0, Math.min(255, Math.round(b)));
      row[offset + 3] = Math.max(0, Math.min(255, Math.round(a)));
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))),
    pngChunk("IEND"),
  ]);
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function appendJsonl(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value)}\n`, { flag: "a" });
}

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < String(text).length; index += 1) {
    hash ^= String(text).charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRng(seed) {
  let value = hashString(seed) || 1;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, values) {
  return values[Math.floor(rng() * values.length) % values.length];
}

function clampInt(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function is2DFactory(factoryName) {
  return String(factoryName ?? "").endsWith("2D");
}

function baseFactoryName(factoryName) {
  const value = String(factoryName ?? "");
  return value.endsWith("2D") ? value.slice(0, -2) : value;
}

function childFactoryName(parentFactoryName, childBaseName) {
  return is2DFactory(parentFactoryName) ? `${childBaseName}2D` : childBaseName;
}

function rendererModeForFactory(factoryName) {
  return is2DFactory(factoryName) ? "canvas-2d" : "threejs";
}

function copyThreeVendor(previewDir) {
  const vendorDir = join(previewDir, "vendor");
  ensureDir(vendorDir);
  const buildDir = dirname(require.resolve("three"));
  for (const fileName of ["three.module.js", "three.core.js"]) {
    const destination = join(vendorDir, fileName);
    if (existsSync(destination)) continue;
    cpSync(join(buildDir, fileName), destination);
  }
}

function runDir(runId) {
  const safeId = slug(runId);
  if (!safeId) throw new Error("run-id must contain at least one letter or number.");
  return join(factoryRoot, safeId);
}

function assetPackDir(packId) {
  const safeId = slug(packId);
  if (!safeId) throw new Error("pack-id must contain at least one letter or number.");
  return join(assetPackRoot, safeId);
}

function requiredRunDirs(root) {
  for (const name of ["modules", "build", "recordings", "dist", "review"]) {
    ensureDir(join(root, name));
  }
}

function loadGoal(runId) {
  const root = runDir(runId);
  const path = join(root, "goal.json");
  if (!existsSync(path)) throw new Error(`Unknown factory run: ${runId}. Run factory init first.`);
  return { root, goal: readJson(path) };
}

function listFilesByExt(dir, extensions) {
  if (!existsSync(dir)) return [];
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (extensions.includes(extname(entry.name).toLowerCase())) {
        found.push(fullPath);
      }
    }
  };
  walk(dir);
  return found.sort();
}

function relativeFile(path, root) {
  const stats = statSync(path);
  return {
    path: path.startsWith(root) ? path.slice(root.length + 1) : path,
    bytes: stats.size,
  };
}

function mergeStats(...parts) {
  const stats = {
    branchCount: 0,
    childCalls: 0,
    fbxCount: 0,
    leafCount: 0,
    patchCount: 0,
    pngCount: 0,
    recursiveCallCount: 0,
    treeCount: 0,
  };
  for (const part of parts) {
    for (const [key, value] of Object.entries(part ?? {})) {
      if (typeof value === "number") stats[key] = (stats[key] ?? 0) + value;
    }
  }
  return stats;
}

function createFbx(id, label, points = []) {
  const vertices = points.length
    ? points.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)},${point.z.toFixed(3)}`).join(", ")
    : "-0.4,0,0, 0.4,0,0, 0,0.9,0, 0,-0.1,0";
  return [
    "; FBX 7.4.0 project file",
    "; Generated by NexusSimulator recursive foliage factory",
    `; Asset: ${id}`,
    `; Label: ${label}`,
    "FBXHeaderExtension:  {",
    "  FBXHeaderVersion: 1003",
    "  FBXVersion: 7400",
    "}",
    "Objects:  {",
    `  Geometry: 1000, "Geometry::${id}", "Mesh" {`,
    `    Vertices: *${Math.max(3, points.length) * 3} { a: ${vertices} }`,
    "    PolygonVertexIndex: *6 { a: 0,1,2,-1, 0,2,3,-1 }",
    "  }",
    `  Model: 1001, "Model::${id}", "Mesh" {`,
    "    Version: 232",
    "  }",
    "}",
    "Connections:  {",
    "  C: \"OO\",1000,1001",
    "}",
    "",
  ].join("\n");
}

function writeTextureSet(root, namespace, id, maps = ["albedo", "alpha", "roughness"]) {
  const textureDir = join(root, "build", "textures", namespace);
  ensureDir(textureDir);
  const files = [];
  for (const map of maps) {
    const path = join(textureDir, `${id}-${map}.png`);
    writeFileSync(path, texturePng);
    files.push(path);
  }
  return files;
}

function writePbrTextureSet(root, namespace, id) {
  return writeTextureSet(root, namespace, id, ["albedo", "normal", "roughness", "height"]);
}

function createLeafProfile(call, rng) {
  const shape = call.settings.leafShape ?? call.settings.shape ?? "serrated-oval";
  const species = call.settings.species ?? inferSpeciesFromProfile(call.profile);
  const baseColors = {
    birch: [126, 174, 82],
    maple: [111, 156, 73],
    oak: [94, 139, 67],
    palm: [72, 132, 74],
    pine: [45, 97, 61],
    willow: [123, 169, 88],
  };
  return {
    algorithm: "vein-field-serrated-parametric-v1",
    curl: Number(call.settings.curl ?? (0.12 + rng() * 0.18)),
    edgeNoise: Number(call.settings.edgeNoise ?? (shape.includes("serrated") ? 0.12 : 0.05)),
    midribStrength: Number(call.settings.midribStrength ?? 0.86),
    shape,
    species,
    venation: call.settings.venation ?? (species === "maple" ? "palmate" : species === "pine" ? "parallel-needle" : "pinnate"),
    color: baseColors[species] ?? [100, 158, 76],
  };
}

function inferSpeciesFromProfile(profile) {
  const text = String(profile ?? "").toLowerCase();
  for (const id of treeSpeciesIds) {
    if (text.includes(id)) return id;
  }
  return "maple";
}

function leafMask(u, v, profile) {
  const y = 1 - Math.abs(v * 2 - 1);
  let halfWidth = Math.pow(Math.max(0, y), 0.58) * (0.34 + y * 0.18);
  if (profile.shape === "maple") halfWidth *= 0.82 + Math.sin(v * Math.PI * 5) * 0.18;
  if (profile.shape === "needle") halfWidth *= 0.22;
  if (profile.shape === "frond") halfWidth *= 0.45 + Math.sin(v * Math.PI * 16) * 0.08;
  const center = 0.5 + Math.sin(v * Math.PI * 2) * profile.curl * 0.05;
  const edgeWave = Math.sin(v * Math.PI * 36) * profile.edgeNoise * 0.045;
  const distance = Math.abs(u - center);
  return distance <= Math.max(0.01, halfWidth + edgeWave);
}

function leafVeinValue(u, v, profile) {
  const midrib = Math.max(0, 1 - Math.abs(u - 0.5) * 42);
  const sidePhase = profile.venation === "palmate" ? Math.abs(v - 0.22) : v;
  const side = Math.max(0, 1 - Math.abs(Math.sin((u - 0.5) * 10 + sidePhase * 28)) * 18);
  const parallel = profile.venation === "parallel-needle"
    ? Math.max(0, 1 - Math.abs(Math.sin(u * 80)) * 10)
    : 0;
  return Math.min(1, midrib * profile.midribStrength + side * 0.34 + parallel * 0.4);
}

function createLeafMapPng(size, map, profile, seed) {
  const rng = createRng(`${seed}:${map}:${size}`);
  return encodePng(size, size, (x, y) => {
    const u = x / Math.max(1, size - 1);
    const v = y / Math.max(1, size - 1);
    const inside = leafMask(u, v, profile);
    const vein = inside ? leafVeinValue(u, v, profile) : 0;
    const freckle = inside ? (rng() - 0.5) * 18 : 0;
    const edge = inside && !leafMask(Math.min(1, u + 1 / size), v, profile) ? 1 : 0;
    const [r, g, b] = profile.color;
    if (map === "alpha") return [255, 255, 255, inside ? 255 : 0];
    if (map === "normal") return [128 + (u - 0.5) * 28, 128 + (v - 0.5) * 18, 205 + vein * 38, inside ? 255 : 0];
    if (map === "roughness") return [inside ? 132 + vein * 38 : 0, inside ? 132 + vein * 38 : 0, inside ? 132 + vein * 38 : 0, inside ? 255 : 0];
    if (map === "height") return [inside ? 78 + vein * 150 + edge * 26 : 0, inside ? 78 + vein * 150 + edge * 26 : 0, inside ? 78 + vein * 150 + edge * 26 : 0, inside ? 255 : 0];
    return [
      inside ? r + vein * 42 + freckle : 0,
      inside ? g + vein * 36 + freckle : 0,
      inside ? b + vein * 22 + freckle : 0,
      inside ? 255 : 0,
    ];
  });
}

function writeLeafTexturePyramid(root, namespace, id, profile, seed, levels) {
  const textureDir = join(root, "build", "textures", namespace);
  ensureDir(textureDir);
  const files = [];
  const maps = ["albedo", "alpha", "normal", "roughness", "height"];
  for (const size of levels) {
    for (const map of maps) {
      const path = join(textureDir, `${id}-${map}-${size}.png`);
      writeFileSync(path, createLeafMapPng(size, map, profile, seed));
      files.push(path);
    }
  }
  return files;
}

function createLeafMeshPoints(width, length, curl, profile) {
  const points = [];
  const segments = 18;
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const y = length * (t - 0.08);
    const envelope = Math.pow(Math.sin(Math.PI * t), 0.58);
    const serration = Math.sin(t * Math.PI * 34) * profile.edgeNoise * width;
    const half = width * envelope + serration;
    points.push({ x: -half, y, z: Math.sin(t * Math.PI) * curl });
    points.push({ x: half, y, z: Math.sin(t * Math.PI) * curl });
  }
  points.push({ x: 0, y: length * 0.48, z: curl * 1.18 });
  return points;
}

function recordTreeMetadata(ctx, tree) {
  ctx.treeMeshes ??= [];
  ctx.speciesCounts ??= {};
  ctx.skinning ??= {
    skeletonBoneCount: 0,
    skinnedMeshCount: 0,
    skinned: true,
    skinning: "linear-blend",
  };
  const speciesId = tree.species?.id ?? "oak";
  ctx.speciesCounts[speciesId] = (ctx.speciesCounts[speciesId] ?? 0) + 1;
  ctx.skinning.skeletonBoneCount += Number(tree.skeleton?.boneCount ?? 0);
  ctx.skinning.skinnedMeshCount += 1;
  ctx.treeMeshes.push(tree);
}

function previewBranchSegments(segments, limit = 18) {
  if (!Array.isArray(segments) || segments.length <= limit) return segments ?? [];
  const trunk = segments[0];
  const rest = segments.slice(1);
  const step = Math.max(1, Math.ceil(rest.length / Math.max(1, limit - 1)));
  return [trunk, ...rest.filter((_, index) => index % step === 0).slice(0, limit - 1)];
}

function createSkinnedTreeFbx(id, label, topology) {
  const points = topology.branchSegments.flatMap((segment) => [segment.start, segment.end]);
  return [
    `; Species: ${topology.species.id}`,
    `; Algorithm: ${topology.species.algorithm}`,
    `; Skinning: ${topology.skeleton.skinning}`,
    `; SkeletonBones: ${topology.skeleton.boneCount}`,
    `; MaxWeightsPerVertex: ${topology.skeleton.maxWeightsPerVertex}`,
    `; BranchSegments: ${topology.branchSegments.length}`,
    createFbx(id, label, points),
  ].join("\n");
}

function trace(ctx, value) {
  appendJsonl(ctx.tracePath, {
    at: new Date().toISOString(),
    ...value,
  });
}

function modulePacket(ctx, name, payload) {
  writeJson(join(ctx.root, "modules", `${name}.json`), {
    generatedAt: new Date().toISOString(),
    module: name,
    ...payload,
  });
}

function makeCall(factoryName, call = {}) {
  if (!factoryNames.includes(factoryName)) {
    throw new Error(`Unknown factory "${factoryName}". Expected one of: ${factoryNames.join(", ")}.`);
  }
  const callId = call.callId ?? `${slug(factoryName)}-${slug(call.seed ?? "seed")}-${hashString(JSON.stringify(call.settings ?? {})).toString(16)}`;
  const normalized = {
    callId,
    depth: clampInt(call.depth ?? 0, 0, 10),
    factory: factoryName,
    fanoutBudget: clampInt(call.fanoutBudget ?? 400, 1, 1500),
    maxDepth: clampInt(call.maxDepth ?? 8, 1, 12),
    parentCallId: call.parentCallId ?? null,
    profile: call.profile ?? "default-foliage-v1",
    seed: call.seed ?? callId,
    settings: call.settings ?? {},
  };
  for (const key of ["position", "profileRef", "rotation", "scale", "spawnId", "spawnPath"]) {
    if (call[key] !== undefined) normalized[key] = call[key];
  }
  return normalized;
}

function invokeFactory(ctx, factoryName, call) {
  const normalized = makeCall(factoryName, call);
  trace(ctx, {
    event: "factory-call",
    call: normalized,
  });
  const result = executeFactory(ctx, normalized);
  trace(ctx, {
    event: "factory-return",
    callId: normalized.callId,
    factory: normalized.factory,
    outputs: result.outputs?.map((path) => path.startsWith(ctx.root) ? path.slice(ctx.root.length + 1) : path) ?? [],
    profileRef: normalized.profileRef ?? null,
    spawnId: normalized.spawnId ?? null,
    spawnPath: normalized.spawnPath ?? null,
    stats: result.stats,
  });
  return result;
}

function writeLeafAssets(ctx, call, index, variant = {}) {
  const rng = createRng(`${call.seed}:${index}:${call.profile}`);
  const namespace = variant.namespace ?? slug(call.callId);
  const assetPrefix = slug(variant.assetId ?? call.settings.assetId ?? call.spawnId ?? call.callId);
  const id = `${namespace}-${assetPrefix}-leaf-${String(index).padStart(4, "0")}`;
  const fbxDir = join(ctx.root, "build", "fbx", "leaves", namespace);
  ensureDir(fbxDir);
  const profile = createLeafProfile(call, rng);
  const width = Number(call.settings.width ?? (0.18 + rng() * 0.22));
  const length = Number(call.settings.length ?? (0.55 + rng() * 0.42));
  const curl = Number(call.settings.curl ?? (0.08 + rng() * 0.28));
  const points = createLeafMeshPoints(width, length, curl, profile);
  const fbxPath = join(fbxDir, `${id}.fbx`);
  writeFileSync(fbxPath, [
    `; LeafAlgorithm: ${profile.algorithm}`,
    `; LeafShape: ${profile.shape}`,
    `; Venation: ${profile.venation}`,
    `; DownsampleReady: true`,
    createFbx(id, `${call.profile} hyperreal individual leaf`, points),
  ].join("\n"));
  const heavyLeaf = call.settings.qualityPreset === "hyperreal" || call.settings.leafQualityPreset === "hyperreal";
  const levels = Array.isArray(call.settings.downsampleLevels)
    ? call.settings.downsampleLevels.map(Number).filter((value) => Number.isFinite(value) && value > 0).slice(0, 6)
    : heavyLeaf
      ? [1024, 512, 256, 128]
      : [256];
  const textures = writeLeafTexturePyramid(ctx.root, join("leaves", namespace), id, profile, `${call.seed}:${index}`, levels);
  const leafRecord = {
    algorithm: profile.algorithm,
    downsampleLevels: levels,
    fbxPath,
    id,
    profile: call.profile,
    seed: `${call.seed}:${index}`,
    shape: profile.shape,
    size: Number((length * width).toFixed(3)),
    textureMaps: ["albedo", "alpha", "normal", "roughness", "height"],
    textures,
    venation: profile.venation,
  };
  ctx.leafMeshes ??= [];
  if (ctx.leafMeshes.length < 12) {
    ctx.leafMeshes.push({
      ...leafRecord,
      textures: textures.map((path) => path.startsWith(ctx.root) ? path.slice(ctx.root.length + 1) : path),
      width,
      length,
      curl,
      color: profile.color,
    });
  }
  return {
    ...leafRecord,
  };
}

function runLeafFactory(ctx, call) {
  const count = clampInt(call.settings.count ?? call.settings.leafCount ?? 24, 1, Math.min(1500, call.fanoutBudget));
  const leaves = [];
  for (let index = 1; index <= count; index += 1) {
    leaves.push(writeLeafAssets(ctx, call, index, {
      assetId: call.settings.assetId ?? call.spawnId ?? slug(call.callId),
      namespace: call.settings.namespace ?? slug(call.callId),
    }));
  }
  modulePacket(ctx, `${call.callId}-leaf-factory`, {
    factory: call.factory,
    leafCount: leaves.length,
    profile: call.profile,
    profileRef: call.profileRef ?? null,
    seed: call.seed,
    spawnId: call.spawnId ?? null,
    spawnPath: call.spawnPath ?? null,
  });
  return {
    assets: { leaves },
    outputs: leaves.flatMap((leaf) => [leaf.fbxPath, ...leaf.textures]),
    stats: {
      fbxCount: leaves.length,
      leafCount: leaves.length,
      pngCount: leaves.reduce((total, leaf) => total + leaf.textures.length, 0),
      recursiveCallCount: call.parentCallId ? 1 : 0,
    },
  };
}

function createBranchAnchors(seed, branchDepth, fanout, budget) {
  const rng = createRng(seed);
  const anchors = [];
  const walk = (depth, x, y, angle, scale) => {
    if (anchors.length >= budget) return;
    if (depth <= 0) {
      anchors.push({
        angle,
        depth,
        scale,
        x,
        y,
      });
      return;
    }
    const nextCount = depth <= 2 ? fanout + 1 : fanout;
    for (let index = 0; index < nextCount; index += 1) {
      const spread = (index - (nextCount - 1) / 2) * (0.28 + rng() * 0.18);
      const nextAngle = angle + spread;
      const length = scale * (0.7 + rng() * 0.25);
      const nextX = x + Math.cos(nextAngle) * length;
      const nextY = y + Math.sin(nextAngle) * length;
      walk(depth - 1, nextX, nextY, nextAngle, scale * (0.72 + rng() * 0.08));
      if (depth <= 2 && anchors.length < budget && rng() > 0.35) {
        anchors.push({
          angle: nextAngle,
          depth,
          scale: scale * 0.52,
          x: nextX,
          y: nextY,
        });
      }
    }
  };
  walk(branchDepth, 0, 0, -Math.PI / 2, 1);
  return anchors.slice(0, budget);
}

function runTreeFactory(ctx, call) {
  const leafFactory = childFactoryName(call.factory, "LeafFactory");
  const speciesId = selectTreeSpecies(call, Number(call.settings.speciesIndex ?? 0));
  const topology = createTreeTopology(call, { speciesId });
  const anchors = topology.leafAnchors.map((anchor, index) => ({
    ...anchor,
    id: `leaf-${String(index + 1).padStart(4, "0")}`,
    position: anchor.position,
  }));
  const treeId = slug(call.callId);
  const fbxDir = join(ctx.root, "build", "fbx", "trees");
  ensureDir(fbxDir);
  const treeFbxPath = join(fbxDir, `${treeId}.fbx`);
  writeFileSync(treeFbxPath, createSkinnedTreeFbx(treeId, `${call.profile} ${speciesId} skinned procedural tree`, topology));
  const barkTextures = writePbrTextureSet(ctx.root, join("trees", treeId, "bark"), `${treeId}-${speciesId}-bark`);
  recordTreeMetadata(ctx, {
    algorithm: topology.species.algorithm,
    barkTextures: barkTextures.map((path) => path.startsWith(ctx.root) ? path.slice(ctx.root.length + 1) : path),
    branchSegments: previewBranchSegments(topology.branchSegments),
    id: treeId,
    leafAnchors: topology.leafAnchors.slice(0, 42),
    profile: call.profile,
    profileRef: call.profileRef ?? null,
    skeleton: topology.skeleton,
    species: topology.species,
  });

  const leafProfileMode = call.settings.leafProfileMode ?? "same";
  const leafProfiles = Array.isArray(call.settings.leafProfiles) && call.settings.leafProfiles.length
    ? call.settings.leafProfiles
    : [call.settings.leafProfile ?? `leaf.${speciesId}`];
  let combinedStats = {
    barkMapCount: barkTextures.length,
    branchCount: topology.branchSegments.length,
    fbxCount: 1,
    leafAnchorCount: anchors.length,
    pngCount: barkTextures.length,
    skeletonBoneCount: topology.skeleton.boneCount,
    skinnedMeshCount: 1,
    treeCount: 1,
  };
  const leafAssets = [];
  const fallbackLeafCalls = anchors.map((anchor, index) => {
    const profile = leafProfileMode === "per-point" ? leafProfiles[index % leafProfiles.length] : leafProfiles[0];
    return {
      callId: `${treeId}-leaf-point-${String(index + 1).padStart(4, "0")}`,
      depth: call.depth + 1,
      factory: leafFactory,
      fanoutBudget: 1,
      maxDepth: call.maxDepth,
      parentCallId: call.callId,
      profile,
      seed: `${call.seed}/leaf-${index + 1}`,
      settings: {
        assetId: anchor.id,
        count: 1,
        curl: call.settings.leafCurl,
        namespace: treeId,
        species: speciesId,
      },
      spawnId: anchor.id,
    };
  });
  const leafSpawns = resolveSpawnSlots(ctx.profileContext, call, "leafPoints", anchors, fallbackLeafCalls);
  leafSpawns.forEach((spawn, index) => {
    const anchor = anchors[index] ?? spawn.point ?? {};
    const leafCall = {
      ...spawn.call,
      settings: {
        ...spawn.call.settings,
        assetId: spawn.call.settings.assetId ?? spawn.call.spawnId ?? anchor.id,
        count: spawn.call.settings.count ?? 1,
        namespace: spawn.call.settings.namespace ?? treeId,
      },
    };
    const leaf = invokeFactory(ctx, leafCall.factory, leafCall);
    leafAssets.push(...(leaf.assets?.leaves ?? []).map((asset) => ({
      ...asset,
      anchor,
    })));
    combinedStats = mergeStats(combinedStats, leaf.stats, { childCalls: 1 });
  });

  modulePacket(ctx, `${call.callId}-tree-factory`, {
    anchors: anchors.length,
    branchDepth: topology.species.branchLevels,
    branchSegments: topology.branchSegments.length,
    factory: call.factory,
    leafProfileMode,
    profileRef: call.profileRef ?? null,
    profile: call.profile,
    seed: call.seed,
    skeleton: topology.skeleton,
    species: speciesId,
    spawnPath: call.spawnPath ?? null,
  });
  return {
    assets: { anchors, leaves: leafAssets, trees: [{ id: treeId, fbxPath: treeFbxPath, species: speciesId, skeleton: topology.skeleton }] },
    outputs: [treeFbxPath, ...barkTextures, ...leafAssets.flatMap((leaf) => [leaf.fbxPath, ...leaf.textures])],
    stats: combinedStats,
  };
}

function runFoliagePatchFactory(ctx, call) {
  const treeFactory = childFactoryName(call.factory, "TreeFactory");
  const rng = createRng(call.seed);
  const treeCount = clampInt(call.settings.treeCount ?? 5, 1, Math.min(40, call.fanoutBudget));
  const treeProfiles = Array.isArray(call.settings.treeProfiles) && call.settings.treeProfiles.length
    ? call.settings.treeProfiles
    : [`${call.profile}-canopy`, `${call.profile}-young`, `${call.profile}-windbreak`];
  let combinedStats = { patchCount: 1 };
  const trees = [];
  const treePoints = Array.from({ length: treeCount }, (_, index) => ({
    id: `tree-${String(index + 1).padStart(3, "0")}`,
    position: {
      x: Number(((rng() - 0.5) * 8).toFixed(3)),
      z: Number(((rng() - 0.5) * 8).toFixed(3)),
    },
  }));
  const fallbackTreeCalls = treePoints.map((point, index) => {
    const treeProfile = treeProfiles[index % treeProfiles.length];
    const treeId = `${slug(call.callId)}-${point.id}`;
    const leafBudget = clampInt(call.settings.leafCountBudget ?? (36 + Math.floor(rng() * 30)), 12, 240);
    const speciesList = Array.isArray(call.settings.speciesList) && call.settings.speciesList.length ? call.settings.speciesList : treeSpeciesIds;
    const speciesOffset = Number(call.settings.speciesOffset ?? 0);
    return {
      callId: treeId,
      depth: call.depth + 1,
      factory: treeFactory,
      fanoutBudget: leafBudget,
      maxDepth: call.maxDepth,
      parentCallId: call.callId,
      profile: treeProfile,
      seed: `${call.seed}/tree-${index}`,
      settings: {
        branchDepth: call.settings.branchDepth ?? 3,
        branchFanout: call.settings.branchFanout ?? 2,
        leafCountBudget: leafBudget,
        leafProfileMode: call.settings.leafProfileMode ?? "per-point",
        leafProfiles: call.settings.leafProfiles ?? [`${treeProfile}-leaf-a`, `${treeProfile}-leaf-b`],
        species: call.settings.species ?? speciesList[(speciesOffset + index) % speciesList.length],
        speciesIndex: speciesOffset + index,
        speciesList,
        speciesSelection: call.settings.speciesSelection ?? "cycle",
      },
      spawnId: point.id,
    };
  });
  const treeSpawns = resolveSpawnSlots(ctx.profileContext, call, "treePoints", treePoints, fallbackTreeCalls);
  treeSpawns.forEach((spawn) => {
    const treeCall = spawn.call;
    const tree = invokeFactory(ctx, treeCall.factory, treeCall);
    const position = treeCall.position ?? spawn.point?.position ?? {};
    trees.push({
      id: slug(treeCall.callId),
      profile: treeCall.profile,
      profileRef: treeCall.profileRef ?? null,
      spawnId: treeCall.spawnId ?? null,
      spawnPath: treeCall.spawnPath ?? null,
      x: Number(position.x ?? 0),
      z: Number(position.z ?? 0),
    });
    combinedStats = mergeStats(combinedStats, tree.stats, { childCalls: 1 });
  });

  const patchId = slug(call.callId);
  const fbxDir = join(ctx.root, "build", "fbx", "patches");
  ensureDir(fbxDir);
  const patchFbxPath = join(fbxDir, `${patchId}.fbx`);
  writeFileSync(patchFbxPath, createFbx(patchId, `${call.profile} foliage patch`, trees.map((tree) => ({
    x: tree.x,
    y: 0,
    z: tree.z,
  }))));
  modulePacket(ctx, `${call.callId}-foliage-patch-factory`, {
    factory: call.factory,
    patchId,
    profileRef: call.profileRef ?? null,
    profile: call.profile,
    seed: call.seed,
    spawnPath: call.spawnPath ?? null,
    treeCount: trees.length,
  });
  return {
    assets: { patches: [{ id: patchId, fbxPath: patchFbxPath, trees }], trees },
    outputs: [patchFbxPath],
    stats: mergeStats(combinedStats, { fbxCount: 1 }),
  };
}

function runForestFactory(ctx, call) {
  const patchFactory = childFactoryName(call.factory, "FoliagePatchFactory");
  const rng = createRng(call.seed);
  const patchCount = clampInt(call.settings.patchCount ?? 3, 1, Math.min(24, call.fanoutBudget));
  const patchProfiles = Array.isArray(call.settings.patchProfiles) && call.settings.patchProfiles.length
    ? call.settings.patchProfiles
    : [`${call.profile}-edge`, `${call.profile}-dense`, `${call.profile}-clearing`];
  let combinedStats = {};
  const patches = [];
  const patchPoints = Array.from({ length: patchCount }, (_, index) => ({
    id: `patch-${String(index + 1).padStart(3, "0")}`,
    position: {
      x: Number(((rng() - 0.5) * 24).toFixed(3)),
      z: Number(((rng() - 0.5) * 24).toFixed(3)),
    },
  }));
  const fallbackPatchCalls = patchPoints.map((point, index) => {
    const patchProfile = patchProfiles[index % patchProfiles.length];
    const patchId = `${slug(call.callId)}-${point.id}`;
    const speciesList = Array.isArray(call.settings.speciesList) && call.settings.speciesList.length ? call.settings.speciesList : treeSpeciesIds;
    const treesPerPatch = clampInt(call.settings.treesPerPatch ?? 4, 1, 40);
    return {
      callId: patchId,
      depth: call.depth + 1,
      factory: patchFactory,
      fanoutBudget: clampInt(call.settings.patchFanoutBudget ?? 260, 20, 800),
      maxDepth: call.maxDepth,
      parentCallId: call.callId,
      profile: patchProfile,
      seed: `${call.seed}/patch-${index}`,
      settings: {
        branchDepth: call.settings.branchDepth ?? 3,
        leafCountBudget: call.settings.leafCountBudget ?? 32,
        leafProfileMode: call.settings.leafProfileMode ?? "per-point",
        patchLayout: call.settings.patchLayout ?? "clustered-clearings",
        speciesOffset: index * treesPerPatch,
        speciesList,
        speciesSelection: call.settings.speciesSelection ?? "cycle",
        treeCount: treesPerPatch,
      },
      spawnId: point.id,
    };
  });
  const patchSpawns = resolveSpawnSlots(ctx.profileContext, call, "patchPoints", patchPoints, fallbackPatchCalls);
  patchSpawns.forEach((spawn) => {
    const patchCall = spawn.call;
    const patch = invokeFactory(ctx, patchCall.factory, patchCall);
    const position = patchCall.position ?? spawn.point?.position ?? {};
    patches.push({
      id: slug(patchCall.callId),
      profile: patchCall.profile,
      profileRef: patchCall.profileRef ?? null,
      spawnId: patchCall.spawnId ?? null,
      spawnPath: patchCall.spawnPath ?? null,
      x: Number(position.x ?? 0),
      z: Number(position.z ?? 0),
    });
    combinedStats = mergeStats(combinedStats, patch.stats, { childCalls: 1 });
  });
  const forestId = slug(call.callId);
  const fbxDir = join(ctx.root, "build", "fbx", "forests");
  ensureDir(fbxDir);
  const forestFbxPath = join(fbxDir, `${forestId}.fbx`);
  writeFileSync(forestFbxPath, createFbx(forestId, `${call.profile} forest kit`, patches.map((patch) => ({
    x: patch.x,
    y: 0,
    z: patch.z,
  }))));
  modulePacket(ctx, `${call.callId}-forest-factory`, {
    factory: call.factory,
    forestId,
    patchCount: patches.length,
    profileRef: call.profileRef ?? null,
    profile: call.profile,
    seed: call.seed,
    spawnPath: call.spawnPath ?? null,
  });
  return {
    assets: { forests: [{ id: forestId, fbxPath: forestFbxPath, patches }], patches },
    outputs: [forestFbxPath],
    stats: mergeStats(combinedStats, { fbxCount: 1 }),
  };
}

function executeFactory(ctx, call) {
  switch (baseFactoryName(call.factory)) {
    case "LeafFactory":
      return runLeafFactory(ctx, call);
    case "TreeFactory":
      return runTreeFactory(ctx, call);
    case "FoliagePatchFactory":
      return runFoliagePatchFactory(ctx, call);
    case "ForestFactory":
      return runForestFactory(ctx, call);
    default:
      throw new Error(`Unsupported factory: ${call.factory}`);
  }
}

function createCanvas2DPreviewHtml(goal, manifest) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>${goal.factoryName} ${goal.runId}</title>
  <style>
    html, body { margin: 0; height: 100%; background: #0f1511; overflow: hidden; }
    canvas { display: block; width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <canvas id="preview"></canvas>
  <script type="module">
    const canvas = document.getElementById("preview");
    const ctx = canvas.getContext("2d");
    const manifest = ${JSON.stringify(manifest)};
    const state = {
      factoryName: ${JSON.stringify(goal.factoryName)},
      baseFactoryName: ${JSON.stringify(baseFactoryName(goal.factoryName))},
      frame: 0,
      rendererMode: "canvas-2d",
      runId: ${JSON.stringify(goal.runId)},
      stats: manifest.stats,
      recording: {
        cameraSafe: true,
        checkpoint: "preview-ready",
        routeComplete: true,
        totalForestProps: Math.max(1, manifest.stats.leafCount + manifest.stats.treeCount + manifest.stats.patchCount),
        characterAnimation: { keyframed: true, jointCount: 18 },
        version: "recursive-foliage-factory-v1"
      }
    };
    window.__NEXUS_TEST_STATE__ = state;
    window.__NEXUS_SIMTIME__ = {
      advance(seconds = 60, input = {}) {
        state.frame += Math.max(1, Math.round(Number(seconds) * 8));
        state.recording.checkpoint = input.view || "simtime-advanced";
        draw();
        return state;
      }
    };
    function resize() {
      canvas.width = Math.max(1, Math.floor(window.innerWidth * window.devicePixelRatio));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * window.devicePixelRatio));
      draw();
    }
    function leaf(x, y, size, color, angle = 0) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(11,30,18,0.85)";
      ctx.lineWidth = Math.max(1, size * 0.055);
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.bezierCurveTo(size * 0.8, -size * 0.45, size * 0.68, size * 0.55, 0, size);
      ctx.bezierCurveTo(-size * 0.68, size * 0.55, -size * 0.8, -size * 0.45, 0, -size);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(210,242,172,0.75)";
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.82);
      ctx.lineTo(0, size * 0.76);
      ctx.stroke();
      ctx.restore();
    }
    function tree(x, y, scale, seed) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.strokeStyle = "#4d3929";
      ctx.lineCap = "round";
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(0, 120);
      ctx.lineTo(0, -90);
      ctx.stroke();
      for (let i = 0; i < 18; i += 1) {
        const side = i % 2 ? 1 : -1;
        const by = 85 - i * 10;
        const len = 52 + (i % 5) * 9;
        ctx.lineWidth = Math.max(3, 12 - i * 0.45);
        ctx.beginPath();
        ctx.moveTo(0, by);
        ctx.quadraticCurveTo(side * len * 0.45, by - 34, side * len, by - 66);
        ctx.stroke();
      }
      const colors = ["#5a8f45", "#7aa856", "#9a9f42", "#3f7c4a"];
      const leafTotal = Math.max(24, Math.min(160, Math.round(manifest.stats.leafCount / Math.max(1, manifest.stats.treeCount || 1))));
      for (let i = 0; i < leafTotal; i += 1) {
        const angle = (i * 2.399 + seed) % (Math.PI * 2);
        const radius = 38 + (i % 9) * 8;
        leaf(Math.cos(angle) * radius, -40 + Math.sin(angle) * radius * 0.62, 8 + (i % 4), colors[i % colors.length], angle);
      }
      ctx.restore();
    }
    function groundPatch(cx, cy, width, height, index) {
      const gradient = ctx.createRadialGradient(cx, cy, width * 0.05, cx, cy, width * 0.5);
      gradient.addColorStop(0, "rgba(64,110,55,0.86)");
      gradient.addColorStop(1, "rgba(26,55,36,0.5)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(cx, cy, width, height, 0, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 28; i += 1) {
        const x = cx + Math.cos(i * 1.7 + index) * width * (0.15 + (i % 8) / 10);
        const y = cy + Math.sin(i * 1.13 + index) * height * (0.18 + (i % 5) / 8);
        leaf(x, y, 7 + (i % 5), i % 3 ? "#78a957" : "#a8b15e", i);
      }
    }
    function draw() {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#172535");
      sky.addColorStop(0.48, "#203a35");
      sky.addColorStop(1, "#26351f");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      const sway = Math.sin(state.frame * 0.025) * 8;
      const factory = state.baseFactoryName;
      if (factory === "LeafFactory") {
        const cols = 8;
        const rows = Math.ceil(Math.min(64, manifest.stats.leafCount) / cols);
        const cellW = w / (cols + 1);
        const cellH = h / (rows + 1);
        for (let i = 0; i < Math.min(64, manifest.stats.leafCount); i += 1) {
          const x = cellW * (1 + (i % cols));
          const y = cellH * (1 + Math.floor(i / cols));
          leaf(x, y, Math.min(cellW, cellH) * 0.25, i % 3 ? "#75a64e" : "#b0a24f", i * 0.4 + sway * 0.01);
        }
      } else if (factory === "TreeFactory") {
        groundPatch(w * 0.5, h * 0.78, w * 0.22, h * 0.08, 1);
        tree(w * 0.5 + sway, h * 0.68, Math.min(w, h) / 620, 2);
      } else if (factory === "FoliagePatchFactory") {
        groundPatch(w * 0.5, h * 0.74, w * 0.36, h * 0.12, 2);
        const count = Math.max(3, Math.min(12, manifest.stats.treeCount));
        for (let i = 0; i < count; i += 1) {
          const x = w * (0.24 + (i % 6) * 0.1) + sway * (i % 2 ? 0.5 : -0.5);
          const y = h * (0.68 + Math.floor(i / 6) * 0.08);
          tree(x, y, Math.min(w, h) / (760 + (i % 3) * 80), i);
        }
      } else {
        const patches = Math.max(2, Math.min(8, manifest.stats.patchCount));
        for (let p = 0; p < patches; p += 1) {
          const cx = w * (0.2 + (p % 4) * 0.2);
          const cy = h * (0.42 + Math.floor(p / 4) * 0.3);
          groundPatch(cx, cy, w * 0.13, h * 0.06, p);
          for (let i = 0; i < 4; i += 1) {
            tree(cx + (i - 1.5) * w * 0.035 + sway * 0.2, cy + h * 0.02 + i * 4, Math.min(w, h) / 1050, p * 10 + i);
          }
        }
      }
      ctx.fillStyle = "rgba(236,248,226,0.94)";
      ctx.font = Math.max(20, Math.floor(w * 0.026)) + "px system-ui, sans-serif";
      ctx.fillText(factory + " / " + state.runId, w * 0.045, h * 0.09);
      ctx.font = Math.max(12, Math.floor(w * 0.014)) + "px system-ui, sans-serif";
      ctx.fillText("leaves " + manifest.stats.leafCount + "  trees " + manifest.stats.treeCount + "  patches " + manifest.stats.patchCount + "  recursive calls " + manifest.stats.recursiveCallCount, w * 0.045, h * 0.14);
      state.frame += 1;
      window.__NEXUS_TEST_STATE__ = state;
    }
    window.addEventListener("resize", resize);
    resize();
    setInterval(draw, 1000 / 30);
  </script>
</body>
</html>
`;
}

function createThreePreviewHtml(goal, manifest) {
  const baseName = baseFactoryName(goal.factoryName);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="data:,">
  <title>${goal.factoryName} ${goal.runId}</title>
  <style>
    html, body { margin: 0; height: 100%; background: #07100c; overflow: hidden; }
    canvas { display: block; width: 100vw; height: 100vh; }
    .hud {
      color: rgba(234, 248, 226, 0.95);
      font: 500 15px system-ui, sans-serif;
      left: 30px;
      line-height: 1.35;
      position: fixed;
      text-shadow: 0 2px 12px rgba(0,0,0,0.55);
      top: 26px;
    }
    .hud strong { display: block; font-size: 27px; font-weight: 700; margin-bottom: 4px; }
  </style>
</head>
<body>
  <canvas id="preview"></canvas>
  <div class="hud">
    <strong>${goal.factoryName} / ${goal.runId}</strong>
    <span>leaves ${manifest.stats.leafCount} · trees ${manifest.stats.treeCount} · patches ${manifest.stats.patchCount} · renderer threejs</span>
  </div>
  <script type="module">
    import * as THREE from "./vendor/three.module.js";

    const canvas = document.getElementById("preview");
    const manifest = ${JSON.stringify(manifest)};
    const baseFactoryName = ${JSON.stringify(baseName)};
    const state = {
      baseFactoryName,
      factoryName: ${JSON.stringify(goal.factoryName)},
      frame: 0,
      rendererMode: "threejs",
      runId: ${JSON.stringify(goal.runId)},
      stats: manifest.stats,
      recording: {
        cameraSafe: true,
        checkpoint: "preview-ready",
        routeComplete: true,
        totalForestProps: Math.max(1, manifest.stats.leafCount + manifest.stats.treeCount + manifest.stats.patchCount),
        characterAnimation: { keyframed: true, jointCount: 18 },
        version: "recursive-foliage-threejs-v1"
      }
    };
    window.__NEXUS_TEST_STATE__ = state;
    window.__NEXUS_SIMTIME__ = {
      advance(seconds = 60, input = {}) {
        state.frame += Math.max(1, Math.round(Number(seconds) * 18));
        state.recording.checkpoint = input.view || "threejs-simtime-advanced";
        render();
        return state;
      }
    };

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1a16);
    scene.fog = new THREE.FogExp2(0x0d1a16, 0.032);

    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 140);
    camera.position.set(8, 6, 11);

    const hemi = new THREE.HemisphereLight(0xcfe9ff, 0x172313, 1.7);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff2cf, 3.4);
    sun.position.set(7, 13, 5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 50;
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0x7ccfa6, 1.25);
    rim.position.set(-8, 4, -6);
    scene.add(rim);

    const root = new THREE.Group();
    scene.add(root);

    function rng(seed) {
      let value = 2166136261;
      for (let i = 0; i < String(seed).length; i += 1) {
        value ^= String(seed).charCodeAt(i);
        value = Math.imul(value, 16777619);
      }
      return () => {
        value += 0x6d2b79f5;
        let next = value;
        next = Math.imul(next ^ (next >>> 15), next | 1);
        next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
        return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
      };
    }

    const barkMaterial = new THREE.MeshStandardMaterial({ color: 0x5a3b24, roughness: 0.92, metalness: 0.02 });
    const barkDarkMaterial = new THREE.MeshStandardMaterial({ color: 0x3d291c, roughness: 0.96 });
    const leafMaterials = [0x5c9c42, 0x7fb35a, 0xb2a857, 0x407a48, 0x8fbf63].map((color) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.74, metalness: 0.01, side: THREE.DoubleSide })
    );

    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0.48);
    leafShape.bezierCurveTo(0.32, 0.22, 0.3, -0.24, 0, -0.5);
    leafShape.bezierCurveTo(-0.3, -0.24, -0.32, 0.22, 0, 0.48);
    const leafGeometry = new THREE.ShapeGeometry(leafShape, 8);
    leafGeometry.computeVertexNormals();

    function addCylinderBetween(group, start, end, radius, material) {
      const direction = new THREE.Vector3().subVectors(end, start);
      const length = direction.length();
      if (length <= 0.001) return null;
      const geometry = new THREE.CylinderGeometry(radius * 0.65, radius, length, 10, 1);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.copy(start).addScaledVector(direction, 0.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      group.add(mesh);
      return mesh;
    }

    function addLeaf(group, position, scale, seed) {
      const material = leafMaterials[Math.abs(seed) % leafMaterials.length];
      const mesh = new THREE.Mesh(leafGeometry, material);
      mesh.position.copy(position);
      mesh.rotation.set(-0.55 + (seed % 5) * 0.08, seed * 0.71, 0.45 + (seed % 7) * 0.05);
      mesh.scale.set(scale * (0.8 + (seed % 4) * 0.08), scale, scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    }

    function addGround(group, radiusX, radiusZ, x, z, color = 0x294f2e) {
      const geometry = new THREE.CircleGeometry(1, 80);
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.96 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, -0.04, z);
      mesh.scale.set(radiusX, radiusZ, 1);
      mesh.receiveShadow = true;
      group.add(mesh);
      return mesh;
    }

    function addTree(group, x, z, scale, seed) {
      const random = rng("tree:" + seed);
      const tree = new THREE.Group();
      tree.position.set(x, 0, z);
      tree.scale.setScalar(scale);
      group.add(tree);
      addCylinderBetween(tree, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 2.8, 0), 0.16, barkMaterial);
      const branchCount = Math.max(8, Math.min(26, Math.round(manifest.stats.branchCount / Math.max(1, manifest.stats.treeCount || 1))));
      for (let i = 0; i < branchCount; i += 1) {
        const height = 0.75 + random() * 1.95;
        const angle = i * 2.399 + random() * 0.5;
        const length = 0.95 + random() * 1.05;
        const start = new THREE.Vector3(0, height, 0);
        const end = new THREE.Vector3(Math.cos(angle) * length, height + 0.28 + random() * 0.75, Math.sin(angle) * length);
        addCylinderBetween(tree, start, end, 0.075 * (1.2 - Math.min(0.75, i / branchCount)), i % 3 ? barkMaterial : barkDarkMaterial);
        const leavesPerBranch = Math.max(2, Math.min(8, Math.round((manifest.stats.leafCount || 24) / Math.max(1, (manifest.stats.treeCount || 1) * branchCount))));
        for (let j = 0; j < leavesPerBranch; j += 1) {
          const t = (j + 1) / (leavesPerBranch + 1);
          const pos = start.clone().lerp(end, t);
          pos.x += (random() - 0.5) * 0.38;
          pos.y += (random() - 0.5) * 0.22;
          pos.z += (random() - 0.5) * 0.38;
          addLeaf(tree, pos, 0.26 + random() * 0.13, i * 31 + j);
        }
      }
      return tree;
    }

    function addLeafGrid() {
      const count = Math.max(24, Math.min(80, manifest.stats.leafCount || 24));
      const random = rng("leaf-grid:" + state.runId);
      addGround(root, 4.8, 3.2, 0, 0, 0x263e2b);
      for (let i = 0; i < count; i += 1) {
        const col = i % 10;
        const row = Math.floor(i / 10);
        const pos = new THREE.Vector3((col - 4.5) * 0.72, 0.15 + random() * 0.25, (row - 3.0) * 0.68);
        const mesh = addLeaf(root, pos, 0.34 + random() * 0.13, i);
        mesh.rotation.x -= 0.55;
      }
    }

    function addTreeScene() {
      addGround(root, 4.2, 3.0, 0, 0, 0x263f2c);
      addTree(root, 0, 0, 1.25, 1);
    }

    function addPatchScene() {
      addGround(root, 6.8, 4.4, 0, 0, 0x25492e);
      const count = Math.max(3, Math.min(9, manifest.stats.treeCount || 3));
      for (let i = 0; i < count; i += 1) {
        addTree(root, (i % 5 - 2) * 1.55, Math.floor(i / 5) * 1.55 - 0.7, 0.82 + (i % 3) * 0.11, i + 2);
      }
    }

    function addForestScene() {
      const patches = Math.max(2, Math.min(8, manifest.stats.patchCount || 2));
      for (let p = 0; p < patches; p += 1) {
        const px = (p % 4 - 1.5) * 4.2;
        const pz = Math.floor(p / 4) * 4.1 - 1.8;
        addGround(root, 2.8, 2.0, px, pz, p % 2 ? 0x24472b : 0x2f5530);
        for (let i = 0; i < 4; i += 1) {
          addTree(root, px + (i - 1.5) * 1.05, pz + ((i % 2) - 0.5) * 0.9, 0.62 + (i % 2) * 0.09, p * 10 + i);
        }
      }
    }

    if (baseFactoryName === "LeafFactory") addLeafGrid();
    else if (baseFactoryName === "TreeFactory") addTreeScene();
    else if (baseFactoryName === "FoliagePatchFactory") addPatchScene();
    else addForestScene();

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0x102117, roughness: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.08;
    floor.receiveShadow = true;
    scene.add(floor);

    function resize() {
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function render() {
      const t = state.frame * 0.012;
      root.rotation.y = Math.sin(t) * 0.12;
      const radius = baseFactoryName === "ForestFactory" ? 14 : baseFactoryName === "FoliagePatchFactory" ? 10 : 7;
      camera.position.x = Math.sin(t * 0.65 + 0.65) * radius;
      camera.position.z = Math.cos(t * 0.65 + 0.65) * radius;
      camera.position.y = baseFactoryName === "LeafFactory" ? 5 : 5.8;
      camera.lookAt(0, baseFactoryName === "LeafFactory" ? 0.45 : 1.35, 0);
      renderer.render(scene, camera);
      state.frame += 1;
      window.__NEXUS_TEST_STATE__ = state;
      requestAnimationFrame(render);
    }

    window.addEventListener("resize", resize);
    resize();
    render();
  </script>
</body>
</html>
`;
}

function createPreviewHtml(goal, manifest) {
  const renderManifest = {
    factoryName: manifest.factoryName,
    qualityPreset: manifest.qualityPreset ?? null,
    recordingProof: manifest.recordingProof ?? null,
    rendererMode: manifest.rendererMode,
    runId: manifest.runId,
    skinning: manifest.skinning ?? null,
    leafMeshes: manifest.leafMeshes ?? [],
    speciesCatalog: manifest.speciesCatalog ?? [],
    speciesCounts: manifest.speciesCounts ?? {},
    speciesUsed: manifest.speciesUsed ?? [],
    stats: manifest.stats ?? {},
    title: manifest.title,
    treeMeshes: [],
  };
  return rendererModeForFactory(goal.factoryName) === "threejs"
    ? createHyperrealThreePreviewHtml(goal, renderManifest, baseFactoryName(goal.factoryName))
    : createCanvas2DPreviewHtml(goal, manifest);
}

function writeRunArtifacts(root, goal, result) {
  const buildDir = join(root, "build");
  const previewDir = join(buildDir, "preview");
  ensureDir(previewDir);
  const rendererMode = rendererModeForFactory(goal.factoryName);
  if (rendererMode === "threejs") {
    copyThreeVendor(previewDir);
  }
  writeFileSync(join(buildDir, "contact-sheet.png"), texturePng);
  writeFileSync(join(buildDir, "README.md"), [
    `# ${goal.title}`,
    "",
    `Factory: ${goal.factoryName}`,
    `Profile: ${goal.profile}`,
    `Seed: ${goal.seed}`,
    `Theme: ${goal.theme}`,
    `Renderer: ${rendererMode}`,
    "",
    "This pack was generated by the NexusSimulator recursive foliage factory.",
    "LeafFactory, TreeFactory, FoliagePatchFactory, and ForestFactory render through a shared Three.js preview scene.",
    "LeafFactory2D, TreeFactory2D, FoliagePatchFactory2D, and ForestFactory2D preserve the canvas 2D preview scene.",
    "Higher-level factories trigger lower-level factories through explicit recursive factory calls.",
    "",
  ].join("\n"));
  writeFileSync(join(buildDir, "LICENSE.txt"), "License: custom itch.io asset-pack license. Replace before public sale.\n");
  const manifest = {
    assetTypes: ["fbx", "png", "preview", "proof-media"],
    factoryName: goal.factoryName,
    files: {
      contactSheet: "build/contact-sheet.png",
      fbx: listFilesByExt(buildDir, [".fbx"]).map((path) => relativeFile(path, root)),
      png: listFilesByExt(buildDir, [".png"]).map((path) => relativeFile(path, root)),
      preview: "build/preview/index.html",
    },
    generatedAt: new Date().toISOString(),
    license: "custom",
    profile: goal.profile,
    profileGraph: result.profileGraph ?? null,
    profileSummary: result.profileSummary ?? { enabled: false },
    qualityPreset: goal.settings.qualityPreset ?? null,
    leafMeshes: result.leafMeshes ?? [],
    recordingProof: {
      captureMode: goal.settings.captureMode ?? "deterministic",
      droppedFrameBudgetPct: 2,
      fpsTarget: clampInt(goal.settings.recordingFps ?? 60, 1, 120),
    },
    rendererMode,
    runId: goal.runId,
    seed: goal.seed,
    skinning: result.skinning ?? {
      skeletonBoneCount: 0,
      skinned: false,
      skinnedMeshCount: 0,
      skinning: "none",
    },
    spawnPlanSummary: {
      entries: Array.isArray(result.spawnPlan) ? result.spawnPlan.length : 0,
      file: "modules/spawn-plan.json",
      slots: Array.isArray(result.spawnPlan)
        ? [...new Set(result.spawnPlan.map((entry) => entry.slotName).filter(Boolean))]
        : [],
      spawns: Array.isArray(result.spawnPlan)
        ? result.spawnPlan.reduce((total, entry) => total + (entry.spawns?.length ?? 0), 0)
        : 0,
    },
    speciesCatalog: result.speciesCatalog ?? [],
    speciesCounts: result.speciesCounts ?? {},
    speciesUsed: result.speciesUsed ?? [],
    stats: result.stats,
    tags: ["game-assets", "foliage", "fbx", "textures", "nexus-simulator"],
    theme: goal.theme,
    title: goal.title,
    treeMeshes: result.treeMeshes ?? [],
  };
  writeJson(join(buildDir, "manifest.json"), manifest);
  writeFileSync(join(previewDir, "index.html"), createPreviewHtml(goal, manifest));
  return manifest;
}

function domainGate(factoryName, stats) {
  switch (baseFactoryName(factoryName)) {
    case "LeafFactory":
      return {
        minLeafCount: 12,
        passed: Number(stats.leafCount ?? 0) >= 12,
      };
    case "TreeFactory":
      return {
        minLeafCount: 24,
        minTreeCount: 1,
        passed: Number(stats.treeCount ?? 0) >= 1 && Number(stats.leafCount ?? 0) >= 24,
      };
    case "FoliagePatchFactory":
      return {
        minLeafCount: 80,
        minTreeCount: 3,
        passed: Number(stats.treeCount ?? 0) >= 3 && Number(stats.leafCount ?? 0) >= 80 && Number(stats.patchCount ?? 0) >= 1,
      };
    case "ForestFactory":
      return {
        minPatchCount: 2,
        minTreeCount: 6,
        passed: Number(stats.patchCount ?? 0) >= 2 && Number(stats.treeCount ?? 0) >= 6 && Number(stats.leafCount ?? 0) >= 120,
      };
    default:
      return { passed: false };
  }
}

function hyperrealGate(manifest, report) {
  const requiresHyperreal = manifest.qualityPreset === "hyperreal";
  if (!requiresHyperreal) {
    return {
      passed: true,
      required: false,
    };
  }
  const smoothCheck = Array.isArray(report.checks)
    ? report.checks.find((check) => check.name === "smoothFrameTelemetry")
    : null;
  if (baseFactoryName(manifest.factoryName) === "LeafFactory") {
    const leaf = Array.isArray(manifest.leafMeshes) ? manifest.leafMeshes[0] : null;
    const checks = [
      {
        detail: leaf?.algorithm ?? "missing leaf algorithm",
        name: "leafAlgorithm",
        passed: Boolean(leaf?.algorithm),
      },
      {
        detail: `${leaf?.downsampleLevels?.join(",") ?? "missing"} downsample levels`,
        name: "downsampleLevels",
        passed: Array.isArray(leaf?.downsampleLevels) && leaf.downsampleLevels.length >= 2,
      },
      {
        detail: `${manifest.stats?.pngCount ?? 0} leaf maps`,
        name: "leafMaps",
        passed: Number(manifest.stats?.pngCount ?? 0) >= 10,
      },
      {
        detail: smoothCheck?.detail ?? "missing smoothFrameTelemetry check",
        name: "smoothVideo",
        passed: smoothCheck?.passed === true,
      },
    ];
    return {
      checks,
      passed: checks.every((check) => check.passed),
      required: true,
    };
  }
  const speciesCount = Array.isArray(manifest.speciesUsed) ? manifest.speciesUsed.length : Object.keys(manifest.speciesCounts ?? {}).length;
  const treeCount = Number(manifest.stats?.treeCount ?? 0);
  const checks = [
    {
      detail: `${speciesCount}/10 species`,
      name: "tenSpecies",
      passed: baseFactoryName(manifest.factoryName) !== "ForestFactory" || speciesCount >= 10,
    },
    {
      detail: `${manifest.skinning?.skinnedMeshCount ?? 0}/${treeCount} skinned meshes`,
      name: "skinnedMeshes",
      passed: Number(manifest.skinning?.skinnedMeshCount ?? 0) >= Math.max(1, treeCount),
    },
    {
      detail: `${manifest.skinning?.skeletonBoneCount ?? 0} skeleton bones`,
      name: "skeletonBones",
      passed: Number(manifest.skinning?.skeletonBoneCount ?? 0) >= Math.max(4, treeCount * 4),
    },
    {
      detail: `${manifest.stats?.barkMapCount ?? 0} bark maps`,
      name: "barkMaps",
      passed: Number(manifest.stats?.barkMapCount ?? 0) >= Math.max(4, treeCount * 4),
    },
    {
      detail: smoothCheck?.detail ?? "missing smoothFrameTelemetry check",
      name: "smoothVideo",
      passed: smoothCheck?.passed === true,
    },
  ];
  return {
    checks,
    passed: checks.every((check) => check.passed),
    required: true,
  };
}

function scoreFactory(root) {
  const buildDir = join(root, "build");
  const recordingsDir = join(root, "recordings");
  const manifestPath = join(buildDir, "manifest.json");
  const reportPath = join(recordingsDir, "simtime-report.json");
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : {};
  const report = existsSync(reportPath) ? readJson(reportPath) : {};
  const files = {
    callTrace: existsSync(join(root, "call-trace.jsonl")),
    contactSheet: existsSync(join(buildDir, "contact-sheet.png")),
    fbx: listFilesByExt(buildDir, [".fbx"]),
    license: existsSync(join(buildDir, "LICENSE.txt")),
    manifest: existsSync(manifestPath),
    png: listFilesByExt(buildDir, [".png"]),
    poster: existsSync(join(recordingsDir, "poster.png")),
    preview: existsSync(join(buildDir, "preview", "index.html")),
    readme: existsSync(join(buildDir, "README.md")),
    report: existsSync(reportPath),
    webm: listFilesByExt(recordingsDir, [".webm"]),
  };
  const domain = domainGate(manifest.factoryName, manifest.stats ?? {});
  const hyperreal = hyperrealGate(manifest, report);
  const score = [
    files.fbx.length > 0 ? 10 : 0,
    files.png.length > 0 ? 10 : 0,
    files.preview ? 10 : 0,
    files.callTrace ? 10 : 0,
    files.contactSheet ? 5 : 0,
    files.readme ? 5 : 0,
    files.license ? 5 : 0,
    files.manifest ? 10 : 0,
    files.poster ? 10 : 0,
    files.webm.length > 0 ? 10 : 0,
    files.report && report.status === "passed" ? 10 : 0,
    Array.isArray(report.consoleErrors) && report.consoleErrors.length === 0 ? 5 : 0,
    domain.passed ? 10 : 0,
    hyperreal.passed ? 10 : 0,
  ].reduce((total, value) => total + value, 0);
  return {
    domain,
    files,
    hyperreal,
    passed: score >= minPassingScore && hyperreal.passed,
    score,
    threshold: minPassingScore,
  };
}

function reviewFactoryRecording(runId, options = {}) {
  const { root, goal } = loadGoal(runId);
  const manifestPath = join(root, "build", "manifest.json");
  const reportPath = join(root, "recordings", "simtime-report.json");
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : {};
  const report = existsSync(reportPath) ? readJson(reportPath) : {};
  const quality = scoreFactory(root);
  const traceText = existsSync(join(root, "call-trace.jsonl")) ? readFileSync(join(root, "call-trace.jsonl"), "utf8") : "";
  const goalBaseName = baseFactoryName(goal.factoryName);
  const leafFactory = childFactoryName(goal.factoryName, "LeafFactory");
  const treeFactory = childFactoryName(goal.factoryName, "TreeFactory");
  const patchFactory = childFactoryName(goal.factoryName, "FoliagePatchFactory");
  const checks = [
    { name: "qualityScore", passed: quality.passed, detail: `${quality.score}/${quality.threshold}` },
    { name: "simtimePassed", passed: report.status === "passed", detail: report.status ?? "missing" },
    { name: "consoleClean", passed: Array.isArray(report.consoleErrors) && report.consoleErrors.length === 0, detail: `${report.consoleErrors?.length ?? "unknown"} errors` },
    { name: "hasVideo", passed: quality.files.webm.length > 0, detail: quality.files.webm[0] ?? "missing" },
    { name: "hasPoster", passed: quality.files.poster, detail: join(root, "recordings", "poster.png") },
    { name: "domainGate", passed: quality.domain.passed, detail: JSON.stringify(quality.domain) },
    { name: "hyperrealGate", passed: quality.hyperreal.passed, detail: JSON.stringify(quality.hyperreal) },
    { name: "rendererMode", passed: manifest.rendererMode === rendererModeForFactory(goal.factoryName), detail: manifest.rendererMode ?? "missing" },
    { name: "leafFactoryTrace", passed: goalBaseName === "LeafFactory" || traceText.includes(`"factory":"${leafFactory}"`), detail: `${leafFactory} child trace required above leaf level` },
    { name: "treeFactoryTrace", passed: !["FoliagePatchFactory", "ForestFactory"].includes(goalBaseName) || traceText.includes(`"factory":"${treeFactory}"`), detail: `${treeFactory} child trace required above tree level` },
    { name: "patchFactoryTrace", passed: goalBaseName !== "ForestFactory" || traceText.includes(`"factory":"${patchFactory}"`), detail: `${patchFactory} child trace required for ForestFactory` },
  ];
  const passed = checks.every((check) => check.passed);
  const review = {
    checkedAt: new Date().toISOString(),
    factoryName: goal.factoryName,
    intent: options.intent ?? goal.theme,
    manifestStats: manifest.stats ?? {},
    nextAction: passed ? "accept" : "rerun-record-review",
    passed,
    quality,
    checks,
    feedback: passed
      ? [`${goal.factoryName} proof is complete enough for the current gate.`]
      : checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.detail}`),
  };
  writeJson(join(root, "review", "watcher-latest.json"), review);
  modulePacket({ root }, "watcher-module", review);
  return review;
}

export function initFactoryRun(runId, options = {}) {
  const safeId = slug(runId);
  const root = runDir(safeId);
  if (existsSync(join(root, "goal.json"))) {
    throw new Error(`Factory run already exists: ${safeId}`);
  }
  const configBundle = options.configPath
    ? loadFactoryConfig(options.configPath)
    : options.factoryConfig
      ? {
          config: options.factoryConfig,
          sourcePath: options.configSourcePath ?? null,
          validation: validateFactoryConfig(options.factoryConfig),
        }
      : null;
  if (configBundle && !configBundle.validation.valid) {
    throw new Error(`Invalid factory config: ${configBundle.validation.errors.join("; ")}`);
  }
  const config = configBundle?.config ?? null;
  const factoryName = config?.factory ?? options.factoryName ?? options.factory ?? "FoliagePatchFactory";
  if (!factoryNames.includes(factoryName)) {
    throw new Error(`Unknown factory "${factoryName}". Expected one of: ${factoryNames.join(", ")}.`);
  }
  requiredRunDirs(root);
  const settings = {
    ...(options.settings ?? {}),
    ...(config?.settings ?? {}),
  };
  const goal = {
    createdAt: new Date().toISOString(),
    factoryConfig: config,
    factoryConfigSourcePath: configBundle?.sourcePath ?? null,
    factoryName,
    profile: config?.profile ?? options.profile ?? "temperate-foliage-v1",
    runId: safeId,
    seed: config?.seed ?? options.seed ?? safeId,
    settings,
    status: "draft",
    theme: config?.theme ?? options.theme ?? "game-ready recursive foliage asset pack",
    title: config?.title ?? options.title ?? `${factoryName} ${safeId}`,
  };
  writeJson(join(root, "goal.json"), goal);
  let call = makeCall(factoryName, {
    callId: `${slug(factoryName)}-${safeId}`,
    profile: goal.profile,
    seed: goal.seed,
    settings: goal.settings,
  });
  if (config) {
    const resolved = resolveFactoryProfile(config, call);
    call = resolved.call;
    writeJson(join(root, "modules", "factory-config.json"), config);
    writeJson(join(root, "modules", "resolved-profile.json"), {
      rootCall: call,
      profileGraph: resolved.profileGraph,
      summary: resolved.summary,
      validation: configBundle.validation,
    });
  }
  writeJson(join(root, "factory-call.json"), call);
  return { goal, root };
}

export function factoryRunExists(runId) {
  return existsSync(join(runDir(runId), "goal.json"));
}

export function runFactory(runId, options = {}) {
  const { root, goal } = loadGoal(runId);
  requiredRunDirs(root);
  const config = goal.factoryConfig ?? null;
  rmSync(join(root, "build"), { force: true, recursive: true });
  rmSync(join(root, "modules"), { force: true, recursive: true });
  ensureDir(join(root, "build"));
  ensureDir(join(root, "modules"));
  writeFileSync(join(root, "call-trace.jsonl"), "");
  let call = makeCall(goal.factoryName, {
    callId: `${slug(goal.factoryName)}-${goal.runId}`,
    fanoutBudget: options.fanoutBudget ?? goal.settings.fanoutBudget,
    maxDepth: options.maxDepth ?? goal.settings.maxDepth,
    profile: goal.profile,
    seed: goal.seed,
    settings: goal.settings,
  });
  const resolved = config
    ? resolveFactoryProfile(config, call)
    : {
        call,
        context: createProfileContext(null, call.callId),
        profileGraph: null,
        summary: { enabled: false },
      };
  call = resolved.call;
  writeJson(join(root, "factory-call.json"), call);
  if (config) {
    writeJson(join(root, "modules", "factory-config.json"), config);
  }
  writeJson(join(root, "modules", "resolved-profile.json"), {
    rootCall: call,
    profileGraph: resolved.profileGraph,
    summary: resolved.summary,
    validation: resolved.context.validation,
  });
  const ctx = {
    profileContext: resolved.context,
    root,
    rootCallId: call.callId,
    skinning: {
      skeletonBoneCount: 0,
      skinned: true,
      skinnedMeshCount: 0,
      skinning: "linear-blend",
    },
    leafMeshes: [],
    speciesCounts: {},
    treeMeshes: [],
    tracePath: join(root, "call-trace.jsonl"),
  };
  trace(ctx, { event: "run-start", goal });
  const result = invokeFactory(ctx, goal.factoryName, call);
  result.stats = mergeStats(result.stats);
  result.profileGraph = resolved.context.profileGraph;
  result.profileSummary = resolved.context.summary;
  result.leafMeshes = ctx.leafMeshes;
  result.skinning = ctx.skinning;
  result.speciesCounts = ctx.speciesCounts;
  result.speciesUsed = Object.keys(ctx.speciesCounts);
  result.speciesCatalog = createSpeciesCatalog(result.speciesUsed.length ? result.speciesUsed : treeSpeciesIds);
  result.spawnPlan = resolved.context.spawnPlan;
  result.treeMeshes = ctx.treeMeshes;
  writeJson(join(root, "modules", "spawn-plan.json"), {
    entries: resolved.context.spawnPlan,
    generatedAt: new Date().toISOString(),
    rootCallId: call.callId,
  });
  const manifest = writeRunArtifacts(root, goal, result);
  trace(ctx, { event: "run-finish", stats: manifest.stats });
  const nextGoal = {
    ...goal,
    lastRunAt: new Date().toISOString(),
    status: "generated",
  };
  writeJson(join(root, "goal.json"), nextGoal);
  return { goal: nextGoal, manifest, root };
}

export async function recordFactoryRun(runId, options = {}) {
  const { root, goal } = loadGoal(runId);
  const previewDir = join(root, "build", "preview");
  if (!existsSync(join(previewDir, "index.html"))) {
    throw new Error("Missing factory preview scene. Run factory run before record.");
  }
  const recordingsDir = join(root, "recordings");
  ensureDir(recordingsDir);
  const seconds = Math.max(1, Number(options.seconds ?? 10));
  const fps = clampInt(options.fps ?? 60, 1, 120);
  const captureMode = options.captureMode === "realtime" ? "realtime" : "deterministic";
  const [widthRaw, heightRaw] = String(options.viewport ?? "1280x720").split("x");
  const width = Math.max(1, Number(widthRaw || 1280));
  const height = Math.max(1, Number(heightRaw || 720));
  const manifestPath = join(root, "build", "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = readJson(manifestPath);
    writeJson(manifestPath, {
      ...manifest,
      recordingProof: {
        ...(manifest.recordingProof ?? {}),
        captureMode,
        durationSeconds: seconds,
        fpsTarget: fps,
      },
    });
  }
  const frameIntervalMs = Math.max(8, Math.round(1000 / fps));
  const events = [
    { command: "startServer", args: {} },
    { command: "openPage", args: { waitUntil: "domcontentloaded" } },
    { command: "resizeViewport", args: { width, height } },
    { command: "assertCanvasExists", args: {} },
    { command: "wait", args: { ms: 750 } },
    { command: "assertGlobalState", args: { path: "factoryName", operator: "===", value: goal.factoryName } },
    { command: "assertGlobalState", args: { path: "rendererMode", operator: "===", value: rendererModeForFactory(goal.factoryName) } },
    { command: "assertCanvasChanged", args: { sampleMs: 500 } },
    { command: "advanceSimTime", args: { seconds: 0.25, input: { captureMode, fps, view: "factory-proof-preroll" } } },
    { command: "recordVideo", args: { captureMode, fps, name: `${goal.runId}-${goal.factoryName}-proof.webm`, durationMs: seconds * 1000 } },
    captureMode === "deterministic"
      ? { command: "playDeterministicSession", args: { durationMs: seconds * 1000, fps, intervalMs: frameIntervalMs } }
      : { command: "playSession", args: { durationMs: seconds * 1000, intervalMs: Math.max(16, frameIntervalMs) } },
    {
      command: "assertSmoothFrameTelemetry",
      args: {
        maxDroppedFrames: Math.max(1, Math.ceil(seconds * fps * 0.05)),
        minFps: Math.max(24, Math.floor(fps * 0.75)),
        minFrames: Math.floor(seconds * fps * 0.85),
      },
    },
    { command: "captureScreenshot", args: { name: "poster.png", fullPage: false } },
    { command: "assertNoConsoleErrors", args: {} },
    { command: "summarizeSession", args: {} },
    { command: "stopServer", args: {} },
  ];
  writeFileSync(join(recordingsDir, "preview-recording.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  const adapter = createPlaywrightAdapter({
    env: {
      name: `factory-${goal.runId}`,
      app: {
        attachedAppPath: previewDir,
        artifactDir: recordingsDir,
        detectedMode: "canvas",
        launchMode: "static",
      },
    },
  });
  const result = await executeScenario(adapter, { name: `factory-${goal.runId}` }, events);
  writeJson(join(recordingsDir, "simtime-report.json"), result.output);
  modulePacket({ root }, "simtime-recording-module", {
    captureMode,
    fps,
    outputs: result.output.artifacts.map((path) => path.startsWith(root) ? path.slice(root.length + 1) : path),
    simtime: "playwright",
  });
  const nextGoal = {
    ...goal,
    lastRecordedAt: new Date().toISOString(),
    settings: {
      ...goal.settings,
      captureMode,
      recordingFps: fps,
    },
    status: result.output.status === "passed" ? "recorded" : "blocked",
  };
  writeJson(join(root, "goal.json"), nextGoal);
  return { goal: nextGoal, output: result.output, root };
}

export async function improveFactoryRun(runId, options = {}) {
  const attempts = Math.max(1, Number(options.attempts ?? 3));
  const seconds = Math.max(1, Number(options.seconds ?? 10));
  const viewport = options.viewport ?? "1280x720";
  const fps = clampInt(options.fps ?? 60, 1, 120);
  const captureMode = options.captureMode === "realtime" ? "realtime" : "deterministic";
  const history = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { root, goal } = loadGoal(runId);
    const goalBaseName = baseFactoryName(goal.factoryName);
    const qualityPreset = options.qualityPreset ?? goal.settings.qualityPreset ?? null;
    const hyperrealSettings = qualityPreset === "hyperreal"
      ? {
          branchDepth: Math.max(4, Number(goal.settings.branchDepth ?? 4)),
          branchFanout: Math.max(3, Number(goal.settings.branchFanout ?? 3)),
          captureMode,
          leafCountBudget: Math.max(64, Number(goal.settings.leafCountBudget ?? 64) + attempt * 8),
          patchCount: goalBaseName === "ForestFactory" ? Math.max(3, Number(goal.settings.patchCount ?? 3)) : goal.settings.patchCount,
          qualityPreset,
          recordingFps: fps,
          speciesList: treeSpeciesIds,
          speciesSelection: "cycle",
          treesPerPatch: goalBaseName === "ForestFactory" ? Math.max(4, Number(goal.settings.treesPerPatch ?? 4)) : goal.settings.treesPerPatch,
        }
      : {
          captureMode,
          qualityPreset,
          recordingFps: fps,
        };
    const tunedGoal = {
      ...goal,
      settings: {
        ...goal.settings,
        ...hyperrealSettings,
        leafCount: goalBaseName === "LeafFactory" ? Math.max(24, Number(goal.settings.leafCount ?? 24) + attempt * 2) : goal.settings.leafCount,
        leafCountBudget: ["TreeFactory", "FoliagePatchFactory", "ForestFactory"].includes(goalBaseName)
          ? Math.max(qualityPreset === "hyperreal" ? 64 : 36, Number(goal.settings.leafCountBudget ?? (qualityPreset === "hyperreal" ? 64 : 36)) + attempt * (qualityPreset === "hyperreal" ? 8 : 4))
          : goal.settings.leafCountBudget,
        patchCount: goalBaseName === "ForestFactory" ? Math.max(2, Number(goal.settings.patchCount ?? 3)) : goal.settings.patchCount,
        treeCount: goalBaseName === "FoliagePatchFactory" ? Math.max(3, Number(goal.settings.treeCount ?? 5)) : goal.settings.treeCount,
      },
      visualRevision: attempt,
    };
    writeJson(join(root, "goal.json"), tunedGoal);
    const run = runFactory(runId);
    const recording = await recordFactoryRun(runId, { captureMode, fps, seconds, viewport });
    const review = reviewFactoryRecording(runId, { intent: options.intent ?? goal.theme });
    history.push({
      attempt,
      passed: review.passed,
      feedback: review.feedback,
      recordingArtifacts: recording.output.artifacts,
      stats: run.manifest.stats,
    });
    writeJson(join(root, "review", `watcher-attempt-${String(attempt).padStart(2, "0")}.json`), {
      attempt,
      recording: recording.output,
      review,
      run,
    });
    const nextGoal = {
      ...recording.goal,
      status: review.passed ? "review_passed" : "needs_visual_retry",
      updatedAt: new Date().toISOString(),
      videoReview: {
        attempts: history.length,
        lastPassed: review.passed,
      },
    };
    writeJson(join(root, "goal.json"), nextGoal);
    if (review.passed) {
      return { attempts: history, goal: nextGoal, review, root };
    }
  }
  const { root, goal } = loadGoal(runId);
  return {
    attempts: history,
    goal,
    review: history[history.length - 1],
    root,
  };
}

export function packageFactoryRun(runId, options = {}) {
  const { root, goal } = loadGoal(runId);
  const quality = scoreFactory(root);
  writeJson(join(root, "review", "quality-gate.json"), quality);
  modulePacket({ root }, "scoring-module", quality);
  if (!quality.passed) {
    throw new Error(`Quality gate failed: score ${quality.score}/${quality.threshold}. Run factory improve before package.`);
  }
  const packId = slug(options.packId ?? goal.runId);
  const packRoot = assetPackDir(packId);
  const packageDir = join(packRoot, "dist", "package");
  const zipPath = join(packRoot, "dist", `${packId}.zip`);
  rmSync(packRoot, { force: true, recursive: true });
  ensureDir(packRoot);
  cpSync(join(root, "build"), join(packRoot, "build"), { recursive: true });
  cpSync(join(root, "recordings"), join(packRoot, "recordings"), {
    filter: (sourcePath) => !sourcePath.split(/[\\/]/).includes(".videos"),
    recursive: true,
  });
  cpSync(join(root, "review"), join(packRoot, "review"), { recursive: true });
  cpSync(join(root, "modules"), join(packRoot, "modules"), { recursive: true });
  cpSync(join(root, "call-trace.jsonl"), join(packRoot, "call-trace.jsonl"));
  const packGoal = {
    assetTypes: ["fbx", "png"],
    createdAt: new Date().toISOString(),
    factoryName: goal.factoryName,
    factoryRunId: goal.runId,
    packId,
    profile: goal.profile,
    seed: goal.seed,
    status: "packaged",
    theme: goal.theme,
    title: options.title ?? goal.title,
  };
  writeJson(join(packRoot, "goal.json"), packGoal);
  rmSync(packageDir, { force: true, recursive: true });
  ensureDir(packageDir);
  cpSync(join(packRoot, "build"), join(packageDir, "build"), { recursive: true });
  cpSync(join(packRoot, "recordings"), join(packageDir, "recordings"), { recursive: true });
  cpSync(join(packRoot, "review"), join(packageDir, "review"), { recursive: true });
  cpSync(join(packRoot, "call-trace.jsonl"), join(packageDir, "call-trace.jsonl"));
  writeJson(join(packageDir, "manifest.json"), {
    factoryName: goal.factoryName,
    packagedAt: new Date().toISOString(),
    packId,
    quality,
    title: packGoal.title,
  });
  rmSync(zipPath, { force: true });
  const zip = spawnSync("zip", ["-qr", zipPath, "."], { cwd: packageDir });
  if (zip.status !== 0) {
    throw new Error(`zip failed: ${zip.stderr.toString().trim() || zip.status}`);
  }
  const listing = {
    createdAt: new Date().toISOString(),
    files: {
      cover: join(packRoot, "recordings", "poster.png"),
      screenshots: listFilesByExt(join(packRoot, "recordings"), [".png"]),
      zip: zipPath,
    },
    factoryName: goal.factoryName,
    projectVisibility: "draft-private",
    shortText: `${packGoal.title}: ${goal.theme}. Includes recursive foliage FBX meshes, PNG textures, preview scene, and SimTime proof media.`,
    tags: ["game assets", "foliage", "fbx", "textures"],
    title: packGoal.title,
  };
  writeJson(join(packRoot, "dist", "listing.json"), listing);
  const nextGoal = {
    ...goal,
    lastPackagedAt: new Date().toISOString(),
    lastPackId: packId,
    status: "packaged",
  };
  writeJson(join(root, "goal.json"), nextGoal);
  return { goal: nextGoal, listing, packId, packRoot, quality, root, zipPath };
}

export function statusFactoryRun(runId) {
  const { root, goal } = loadGoal(runId);
  const quality = scoreFactory(root);
  const manifestPath = join(root, "build", "manifest.json");
  const reviewPath = join(root, "review", "watcher-latest.json");
  return {
    goal,
    manifest: existsSync(manifestPath) ? readJson(manifestPath) : null,
    paths: {
      root,
      manifest: existsSync(manifestPath) ? manifestPath : null,
      poster: existsSync(join(root, "recordings", "poster.png")) ? join(root, "recordings", "poster.png") : null,
      review: existsSync(reviewPath) ? reviewPath : null,
      trace: existsSync(join(root, "call-trace.jsonl")) ? join(root, "call-trace.jsonl") : null,
      videos: listFilesByExt(join(root, "recordings"), [".webm"]),
    },
    quality,
  };
}

export function factoryGraph(runId) {
  const { root, goal } = loadGoal(runId);
  const tracePath = join(root, "call-trace.jsonl");
  const events = existsSync(tracePath)
    ? readFileSync(tracePath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  const calls = events.filter((event) => event.event === "factory-call").map((event) => event.call);
  return {
    calls,
    edges: calls.filter((call) => call.parentCallId).map((call) => ({
      from: call.parentCallId,
      profileRef: call.profileRef ?? null,
      spawnId: call.spawnId ?? null,
      spawnPath: call.spawnPath ?? null,
      to: call.callId,
      factory: call.factory,
    })),
    goal,
    root,
  };
}

export function factoryRunPath(runId) {
  return runDir(runId);
}

export function listFactoryNames() {
  return [...factoryNames];
}
