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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fade(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function lerp(left, right, amount) {
  return left + (right - left) * amount;
}

function latticeValue(seed, x, z) {
  return (hashString(`${seed}:${x}:${z}`) / 4294967295) * 2 - 1;
}

function valueNoise(seed, x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const tz = fade(z - z0);
  const top = lerp(latticeValue(seed, x0, z0), latticeValue(seed, x0 + 1, z0), tx);
  const bottom = lerp(latticeValue(seed, x0, z0 + 1), latticeValue(seed, x0 + 1, z0 + 1), tx);
  return lerp(top, bottom, tz);
}

function fractalNoise(seed, x, z, octaves) {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise(`${seed}:${octave}`, x * frequency, z * frequency) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return weight > 0 ? total / weight : 0;
}

function heightIndex(terrain, x, z) {
  return z * (terrain.resolution + 1) + x;
}

export function generateTerrainData(seed, settings = {}) {
  const resolution = clamp(Math.round(Number(settings.terrainResolution ?? 48)), 8, 96);
  const size = clamp(Number(settings.terrainSize ?? 28), 8, 80);
  const maxHeight = clamp(Number(settings.terrainMaxHeight ?? 3.2), 0.5, 12);
  const octaves = clamp(Math.round(Number(settings.terrainOctaves ?? 4)), 1, 8);
  const raw = [];

  for (let z = 0; z <= resolution; z += 1) {
    for (let x = 0; x <= resolution; x += 1) {
      const nx = (x / resolution - 0.5) * 2;
      const nz = (z / resolution - 0.5) * 2;
      const broad = fractalNoise(seed, nx * 1.35 + 4.1, nz * 1.35 - 2.7, octaves);
      const detail = fractalNoise(`${seed}:detail`, nx * 3.8, nz * 3.8, Math.max(2, octaves - 1));
      const ridge = 1 - Math.abs(fractalNoise(`${seed}:ridge`, nx * 2.2, nz * 2.2, 3));
      const edgeFalloff = Math.pow(Math.max(Math.abs(nx), Math.abs(nz)), 2) * 0.28;
      const valley = Math.exp(-((nx + 0.18) ** 2 * 7 + (nz - 0.08) ** 2 * 2.2)) * 0.28;
      raw.push(broad * 0.58 + detail * 0.18 + ridge * 0.24 - edgeFalloff - valley);
    }
  }

  const low = Math.min(...raw);
  const high = Math.max(...raw);
  const range = Math.max(0.0001, high - low);
  const heights = raw.map((value) => Number((((value - low) / range - 0.34) * maxHeight).toFixed(4)));

  return {
    heights,
    maxHeight,
    octaves,
    resolution,
    seed,
    size,
    triangleCount: resolution * resolution * 2,
    vertexCount: (resolution + 1) * (resolution + 1),
  };
}

export function sampleTerrainHeight(terrain, worldX, worldZ) {
  const normalizedX = clamp(worldX / terrain.size + 0.5, 0, 1) * terrain.resolution;
  const normalizedZ = clamp(worldZ / terrain.size + 0.5, 0, 1) * terrain.resolution;
  const x0 = Math.floor(normalizedX);
  const z0 = Math.floor(normalizedZ);
  const x1 = Math.min(terrain.resolution, x0 + 1);
  const z1 = Math.min(terrain.resolution, z0 + 1);
  const tx = normalizedX - x0;
  const tz = normalizedZ - z0;
  const top = lerp(terrain.heights[heightIndex(terrain, x0, z0)], terrain.heights[heightIndex(terrain, x1, z0)], tx);
  const bottom = lerp(terrain.heights[heightIndex(terrain, x0, z1)], terrain.heights[heightIndex(terrain, x1, z1)], tx);
  return lerp(top, bottom, tz);
}

function terrainSlope(terrain, worldX, worldZ) {
  const step = terrain.size / terrain.resolution;
  const dx = sampleTerrainHeight(terrain, worldX + step, worldZ) - sampleTerrainHeight(terrain, worldX - step, worldZ);
  const dz = sampleTerrainHeight(terrain, worldX, worldZ + step) - sampleTerrainHeight(terrain, worldX, worldZ - step);
  return Math.sqrt(dx * dx + dz * dz) / Math.max(step * 2, 0.001);
}

export function generateTreePlacements(seed, terrain, settings = {}) {
  const treeCount = clamp(Math.round(Number(settings.treeCount ?? 18)), 1, 80);
  const patchCount = clamp(Math.round(Number(settings.patchCount ?? 3)), 1, 12);
  const minSpacing = clamp(Number(settings.treeMinSpacing ?? 1.65), 0.5, 8);
  const maxSlope = clamp(Number(settings.treeMaxSlope ?? 0.62), 0.1, 2);
  const species = Array.isArray(settings.speciesList) && settings.speciesList.length
    ? settings.speciesList.map(String)
    : ["oak", "birch", "pine", "willow"];
  const rng = createRng(`${seed}:placements`);
  const radius = terrain.size * 0.22;
  const patchCenters = Array.from({ length: patchCount }, (_, index) => {
    const angle = (index / patchCount) * Math.PI * 2 + 0.35;
    return {
      x: Math.cos(angle) * terrain.size * 0.25,
      z: Math.sin(angle) * terrain.size * 0.18,
    };
  });
  const placements = [];

  for (let index = 0; index < treeCount; index += 1) {
    const patch = index % patchCount;
    const center = patchCenters[patch];
    let accepted = null;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const angle = rng() * Math.PI * 2;
      const distance = Math.sqrt(rng()) * radius;
      const x = clamp(center.x + Math.cos(angle) * distance, -terrain.size * 0.43, terrain.size * 0.43);
      const z = clamp(center.z + Math.sin(angle) * distance, -terrain.size * 0.43, terrain.size * 0.43);
      const slope = terrainSlope(terrain, x, z);
      const separated = placements.every((tree) => Math.hypot(tree.x - x, tree.z - z) >= minSpacing);
      if (slope <= maxSlope && separated) {
        accepted = { slope, x, z };
        break;
      }
    }
    if (!accepted) {
      const angle = (index / treeCount) * Math.PI * 2;
      accepted = {
        slope: terrainSlope(terrain, Math.cos(angle) * terrain.size * 0.3, Math.sin(angle) * terrain.size * 0.3),
        x: Math.cos(angle) * terrain.size * 0.3,
        z: Math.sin(angle) * terrain.size * 0.3,
      };
    }
    placements.push({
      id: `tree-${String(index + 1).padStart(3, "0")}`,
      patch,
      scale: Number((0.78 + rng() * 0.42).toFixed(4)),
      slope: Number(accepted.slope.toFixed(4)),
      species: species[index % species.length],
      x: Number(accepted.x.toFixed(4)),
      y: Number(sampleTerrainHeight(terrain, accepted.x, accepted.z).toFixed(4)),
      yaw: Number((rng() * Math.PI * 2).toFixed(4)),
      z: Number(accepted.z.toFixed(4)),
    });
  }

  return placements;
}

export function createSceneData(seed, terrain, settings = {}) {
  const trees = generateTreePlacements(seed, terrain, settings);
  const normalized = {
    seed,
    terrain: {
      heights: terrain.heights,
      maxHeight: terrain.maxHeight,
      octaves: terrain.octaves,
      resolution: terrain.resolution,
      size: terrain.size,
    },
    trees: trees.map(({ id, patch, scale, species, x, y, yaw, z }) => ({ id, patch, scale, species, x, y, yaw, z })),
  };
  const expectedHash = hashString(JSON.stringify(normalized)).toString(16).padStart(8, "0");
  return {
    buildDurationSeconds: clamp(Number(settings.buildDurationSeconds ?? 4), 1, 12),
    expectedHash,
    seed,
    species: [...new Set(trees.map((tree) => tree.species))],
    treeCount: trees.length,
    trees,
  };
}
