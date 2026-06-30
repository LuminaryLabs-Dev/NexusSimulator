const speciesDefaults = {
  algorithm: "weber-penn",
  bark: {
    base: "#5a3b24",
    crack: "#23160f",
    highlight: "#a3794f",
    roughness: 0.92,
  },
  branchFanout: 3,
  branchLevels: 4,
  crown: "oval",
  crownRadius: 2.2,
  height: 5.2,
  leaf: {
    colors: ["#5f9846", "#83b65b", "#3e743d"],
    shape: "broadleaf",
  },
  leafDensity: 1.0,
  trunkFlare: 1.0,
  trunkRadius: 0.28,
  windStiffness: 0.55,
};

export const treeSpeciesProfiles = {
  oak: {
    bark: { base: "#5a3b24", crack: "#21160f", highlight: "#9b744f", roughness: 0.96 },
    branchFanout: 4,
    branchLevels: 4,
    crown: "broad-dome",
    crownRadius: 2.8,
    height: 5.8,
    leaf: { colors: ["#5f9347", "#79a85b", "#3f6f37"], shape: "lobed" },
    leafDensity: 1.18,
    trunkFlare: 1.42,
    trunkRadius: 0.38,
    windStiffness: 0.35,
  },
  maple: {
    bark: { base: "#67452d", crack: "#2a1b13", highlight: "#b78351", roughness: 0.9 },
    branchFanout: 4,
    branchLevels: 4,
    crown: "round-layered",
    crownRadius: 2.55,
    height: 5.4,
    leaf: { colors: ["#6ea149", "#a9a34d", "#c37b3c"], shape: "maple" },
    leafDensity: 1.25,
    trunkFlare: 1.18,
    trunkRadius: 0.3,
    windStiffness: 0.42,
  },
  birch: {
    bark: { base: "#d8d4bd", crack: "#2f2a22", highlight: "#f3eed6", roughness: 0.82 },
    branchFanout: 3,
    branchLevels: 4,
    crown: "light-oval",
    crownRadius: 1.85,
    height: 6.1,
    leaf: { colors: ["#82b85a", "#a8c86b", "#5e8f46"], shape: "small-oval" },
    leafDensity: 0.92,
    trunkFlare: 0.82,
    trunkRadius: 0.2,
    windStiffness: 0.48,
  },
  pine: {
    algorithm: "l-system",
    bark: { base: "#593a24", crack: "#21140d", highlight: "#8f6038", roughness: 0.94 },
    branchFanout: 5,
    branchLevels: 5,
    crown: "conical-whorled",
    crownRadius: 2.2,
    height: 7.2,
    leaf: { colors: ["#2f6441", "#476f43", "#244f37"], shape: "needles" },
    leafDensity: 1.05,
    trunkFlare: 0.92,
    trunkRadius: 0.24,
    windStiffness: 0.72,
  },
  spruce: {
    algorithm: "l-system",
    bark: { base: "#4a3325", crack: "#20150f", highlight: "#745136", roughness: 0.97 },
    branchFanout: 6,
    branchLevels: 5,
    crown: "dense-cone",
    crownRadius: 2.45,
    height: 7.8,
    leaf: { colors: ["#28533e", "#356344", "#1e4034"], shape: "needles" },
    leafDensity: 1.22,
    trunkFlare: 0.88,
    trunkRadius: 0.27,
    windStiffness: 0.78,
  },
  cedar: {
    algorithm: "space-colonization",
    bark: { base: "#6d432a", crack: "#24160e", highlight: "#a56c3e", roughness: 0.91 },
    branchFanout: 5,
    branchLevels: 5,
    crown: "layered-cone",
    crownRadius: 2.6,
    height: 6.9,
    leaf: { colors: ["#3f7650", "#537f58", "#2e6047"], shape: "scale-spray" },
    leafDensity: 1.15,
    trunkFlare: 1.02,
    trunkRadius: 0.3,
    windStiffness: 0.67,
  },
  willow: {
    algorithm: "space-colonization",
    bark: { base: "#765634", crack: "#2d2116", highlight: "#aa8254", roughness: 0.87 },
    branchFanout: 4,
    branchLevels: 5,
    crown: "weeping",
    crownRadius: 2.75,
    height: 5.7,
    leaf: { colors: ["#7aa957", "#9dbb66", "#5d8849"], shape: "slender" },
    leafDensity: 1.35,
    trunkFlare: 1.25,
    trunkRadius: 0.31,
    windStiffness: 0.23,
  },
  poplar: {
    bark: { base: "#8c8a75", crack: "#2d2a22", highlight: "#c7c2a5", roughness: 0.8 },
    branchFanout: 3,
    branchLevels: 4,
    crown: "columnar",
    crownRadius: 1.45,
    height: 7.4,
    leaf: { colors: ["#6fa44b", "#96b75b", "#477a3e"], shape: "heart" },
    leafDensity: 0.98,
    trunkFlare: 0.75,
    trunkRadius: 0.22,
    windStiffness: 0.5,
  },
  cypress: {
    algorithm: "l-system",
    bark: { base: "#6b4930", crack: "#25180f", highlight: "#9d734d", roughness: 0.93 },
    branchFanout: 5,
    branchLevels: 5,
    crown: "narrow-spire",
    crownRadius: 1.25,
    height: 7.0,
    leaf: { colors: ["#2f6444", "#416f4f", "#244f38"], shape: "scale-spray" },
    leafDensity: 1.16,
    trunkFlare: 0.8,
    trunkRadius: 0.22,
    windStiffness: 0.76,
  },
  palm: {
    algorithm: "l-system",
    bark: { base: "#987141", crack: "#3a2918", highlight: "#c19355", roughness: 0.84 },
    branchFanout: 9,
    branchLevels: 2,
    crown: "radial-fronds",
    crownRadius: 2.4,
    height: 6.2,
    leaf: { colors: ["#4c884a", "#75a95a", "#3a7440"], shape: "frond" },
    leafDensity: 0.72,
    trunkFlare: 0.7,
    trunkRadius: 0.24,
    windStiffness: 0.38,
  },
};

export const treeSpeciesIds = Object.keys(treeSpeciesProfiles);

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

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export function getTreeSpeciesProfile(speciesId = "oak") {
  const id = treeSpeciesIds.includes(speciesId) ? speciesId : "oak";
  return {
    ...speciesDefaults,
    ...treeSpeciesProfiles[id],
    bark: {
      ...speciesDefaults.bark,
      ...treeSpeciesProfiles[id].bark,
    },
    id,
    leaf: {
      ...speciesDefaults.leaf,
      ...treeSpeciesProfiles[id].leaf,
    },
  };
}

export function inferSpeciesId(profile = "") {
  const normalized = String(profile).toLowerCase();
  return treeSpeciesIds.find((id) => normalized.includes(id)) ?? null;
}

export function selectTreeSpecies(call, index = 0) {
  const settings = call.settings ?? {};
  const explicit = settings.species ?? settings.treeSpecies ?? inferSpeciesId(call.profile);
  if (explicit && treeSpeciesIds.includes(explicit)) return explicit;
  const list = Array.isArray(settings.speciesList) && settings.speciesList.length
    ? settings.speciesList.filter((id) => treeSpeciesIds.includes(id))
    : treeSpeciesIds;
  if (!list.length) return "oak";
  const mode = settings.speciesSelection ?? "cycle";
  if (mode === "weighted") {
    const rng = createRng(`${call.seed}:species:${index}`);
    return list[Math.floor(rng() * list.length) % list.length];
  }
  if (mode === "same") return list[0];
  return list[index % list.length];
}

function crownSpread(species, level, angle, random) {
  const radius = species.crownRadius * (0.35 + level * 0.18);
  if (species.crown === "columnar" || species.crown === "narrow-spire") return radius * 0.45;
  if (species.crown.includes("cone")) return radius * (1.25 - level * 0.12);
  if (species.crown === "weeping") return radius * (0.75 + random() * 0.45);
  if (species.crown === "radial-fronds") return radius * 1.15;
  return radius * (0.8 + Math.sin(angle * 1.7) * 0.12 + random() * 0.2);
}

function point(x, y, z) {
  return {
    x: Number(x.toFixed(3)),
    y: Number(y.toFixed(3)),
    z: Number(z.toFixed(3)),
  };
}

export function createTreeTopology(call, options = {}) {
  const speciesId = options.speciesId ?? selectTreeSpecies(call);
  const species = getTreeSpeciesProfile(speciesId);
  const random = createRng(`${call.seed}:${speciesId}:topology`);
  const branchLevels = Math.round(clampNumber(call.settings?.branchDepth, species.branchLevels, 1, 7));
  const fanout = Math.round(clampNumber(call.settings?.branchFanout, species.branchFanout, 1, 7));
  const leafBudget = Math.round(clampNumber(call.settings?.leafCountBudget ?? call.settings?.leafCount, 80 * species.leafDensity, 8, 1500));
  const height = clampNumber(call.settings?.height, species.height, 2.8, 10.5);
  const trunkRadius = clampNumber(call.settings?.trunkRadius, species.trunkRadius, 0.08, 0.75);
  const segments = [];
  const leafAnchors = [];
  const pushSegment = (start, end, radiusStart, radiusEnd, level, parentId, kind = "branch") => {
    const id = `${kind}-${String(segments.length + 1).padStart(4, "0")}`;
    segments.push({
      algorithm: species.algorithm,
      end,
      id,
      level,
      parentId,
      radiusEnd: Number(radiusEnd.toFixed(4)),
      radiusStart: Number(radiusStart.toFixed(4)),
      species: species.id,
      start,
    });
    return id;
  };

  const trunkId = pushSegment(
    point(0, 0, 0),
    point(0, height, 0),
    trunkRadius * species.trunkFlare,
    trunkRadius * 0.42,
    0,
    null,
    "trunk",
  );

  if (species.id === "palm") {
    const crownY = height * 0.94;
    for (let index = 0; index < fanout * 2; index += 1) {
      const angle = (index / (fanout * 2)) * Math.PI * 2 + random() * 0.18;
      const length = species.crownRadius * (0.8 + random() * 0.32);
      const start = point(0, crownY, 0);
      const end = point(Math.cos(angle) * length, crownY + 0.2 + random() * 0.35, Math.sin(angle) * length);
      const id = pushSegment(start, end, trunkRadius * 0.16, trunkRadius * 0.035, 1, trunkId, "frond-rib");
      leafAnchors.push({
        angle,
        branchId: id,
        id: `leaf-${String(leafAnchors.length + 1).padStart(4, "0")}`,
        position: end,
        scale: 1.45,
        species: species.id,
      });
    }
  } else {
    const levelCount = Math.max(2, branchLevels);
    for (let level = 1; level <= levelCount; level += 1) {
      const levelRatio = level / (levelCount + 1);
      const branchesAtLevel = Math.max(2, Math.round(fanout + level * 0.7));
      const baseY = height * (0.18 + levelRatio * 0.7);
      for (let index = 0; index < branchesAtLevel; index += 1) {
        const angle = (index / branchesAtLevel) * Math.PI * 2 + random() * 0.42 + level * 0.37;
        const spread = crownSpread(species, level, angle, random);
        const droop = species.crown === "weeping" ? -0.75 - random() * 0.45 : species.crown.includes("cone") ? -0.12 * level : 0.22 + random() * 0.44;
        const start = point((random() - 0.5) * trunkRadius * 0.3, baseY, (random() - 0.5) * trunkRadius * 0.3);
        const end = point(Math.cos(angle) * spread, baseY + droop + random() * 0.42, Math.sin(angle) * spread);
        const radius = trunkRadius * (0.33 - levelRatio * 0.18);
        const branchId = pushSegment(start, end, radius, Math.max(0.018, radius * 0.36), level, trunkId);
        const twigCount = Math.max(1, Math.round((species.leafDensity * 2.5) + random() * 2.0));
        for (let twig = 0; twig < twigCount; twig += 1) {
          const t = (twig + 1) / (twigCount + 1);
          const mid = point(
            start.x + (end.x - start.x) * t,
            start.y + (end.y - start.y) * t,
            start.z + (end.z - start.z) * t,
          );
          const twigAngle = angle + (random() - 0.5) * 0.95;
          const twigLength = 0.35 + random() * 0.45;
          const tip = point(
            mid.x + Math.cos(twigAngle) * twigLength,
            mid.y + (species.crown === "weeping" ? -0.28 : 0.18 + random() * 0.18),
            mid.z + Math.sin(twigAngle) * twigLength,
          );
          const twigId = pushSegment(mid, tip, Math.max(0.018, radius * 0.35), 0.01, level + 1, branchId, "twig");
          leafAnchors.push({
            angle: twigAngle,
            branchId: twigId,
            id: `leaf-${String(leafAnchors.length + 1).padStart(4, "0")}`,
            position: tip,
            scale: Number((0.72 + random() * 0.52).toFixed(3)),
            species: species.id,
          });
        }
      }
    }
  }

  while (leafAnchors.length < leafBudget) {
    const source = leafAnchors[leafAnchors.length % Math.max(1, leafAnchors.length)] ?? {
      angle: random() * Math.PI * 2,
      branchId: trunkId,
      position: point(0, height * 0.8, 0),
      scale: 1,
    };
    const jitter = 0.18 + random() * 0.42;
    leafAnchors.push({
      ...source,
      id: `leaf-${String(leafAnchors.length + 1).padStart(4, "0")}`,
      position: point(
        source.position.x + (random() - 0.5) * jitter,
        source.position.y + (random() - 0.5) * jitter,
        source.position.z + (random() - 0.5) * jitter,
      ),
    });
  }

  const leaves = leafAnchors.slice(0, leafBudget);
  return {
    branchSegments: segments,
    leafAnchors: leaves,
    skeleton: {
      algorithm: species.algorithm,
      bindMode: "attached",
      boneCount: segments.length + 1,
      maxWeightsPerVertex: 4,
      skinned: true,
      skinning: "linear-blend",
    },
    species,
    stats: {
      barkMapCount: 4,
      branchCount: segments.length,
      leafAnchorCount: leaves.length,
      skeletonBoneCount: segments.length + 1,
      skinnedMeshCount: 1,
    },
  };
}

export function createSpeciesCatalog(speciesIds = treeSpeciesIds) {
  const unique = [...new Set(speciesIds.filter((id) => treeSpeciesIds.includes(id)))];
  return unique.map((id) => getTreeSpeciesProfile(id));
}
