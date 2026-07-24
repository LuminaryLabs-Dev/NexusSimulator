const SOURCES = Object.freeze({
  bufferGeometry: Object.freeze({
    id: "three-buffer-geometry",
    title: "Three.js BufferGeometry",
    url: "https://threejs.org/docs/pages/BufferGeometry.html",
  }),
  catenary: Object.freeze({
    id: "asce-catenary-arches-2020",
    title: "Catenary Solutions for Arches and Vaults",
    url: "https://doi.org/10.1061/(ASCE)AE.1943-5568.0000402",
  }),
  generalizedCylinder: Object.freeze({
    id: "generalized-cylinder-direction-map-2005",
    title: "Modeling generalized cylinders using direction map representation",
    url: "https://doi.org/10.1016/j.cad.2004.11.003",
  }),
  noise: Object.freeze({
    id: "perlin-improving-noise-2002",
    title: "Improving Noise",
    url: "https://doi.org/10.1145/566570.566636",
  }),
  trees: Object.freeze({
    id: "runions-space-colonization-2007",
    title: "Modeling Trees with a Space Colonization Algorithm",
    url: "https://algorithmicbotany.org/papers/colonization.egwnp2007.html",
  }),
});

const TREE_DEFINITION = Object.freeze({
  method: "space-colonized-generalized-cylinders",
  sources: ["trees", "generalizedCylinder", "bufferGeometry"],
  operators: ["seed-attractors", "grow-skeleton", "sweep-tapered-rings", "wave-bend", "recompute-normals"],
  parameters: {
    height: [3.2, 5.2],
    trunkRadius: [0.12, 0.25],
    branchCount: [5, 10, "integer"],
    branchSpread: [0.72, 1.5],
    crownCount: [5, 10, "integer"],
    crownRadius: [0.68, 1.35],
    droop: [0.02, 0.48],
    waveAmplitude: [0.015, 0.11],
    waveFrequency: [1.2, 3.4],
  },
  controls: ["height", "branchSpread", "droop"],
  tune: { height: 1.16, branchSpread: 1.18, droop: 1.22 },
});

const DEFINITIONS = Object.freeze({
  terrainPatch: {
    method: "noise-displaced-radial-patch",
    sources: ["noise", "bufferGeometry"],
    operators: ["wind-radial-rings", "multi-frequency-wave", "terrace", "recompute-normals"],
    parameters: { radius: [4, 5.4], depth: [0.32, 0.58], segments: [24, 40, "integer"], waveAmplitude: [0.05, 0.2], waveFrequency: [1.4, 3.6] },
    controls: ["radius", "waveAmplitude", "waveFrequency"],
    tune: { radius: 1.08, waveAmplitude: 1.4, waveFrequency: 1.12 },
  },
  oak: TREE_DEFINITION,
  birch: TREE_DEFINITION,
  pine: TREE_DEFINITION,
  willow: TREE_DEFINITION,
  boulders: {
    method: "faceted-radial-noise-shell",
    sources: ["noise", "bufferGeometry"],
    operators: ["wind-radial-shell", "wave-displace", "anisotropic-scale", "recompute-normals"],
    parameters: { count: [5, 10, "integer"], radius: [0.48, 0.92], spread: [2.5, 5.2], flatten: [0.56, 0.9], waveAmplitude: [0.04, 0.18], waveFrequency: [1.4, 4] },
    controls: ["radius", "flatten", "waveAmplitude"],
    tune: { radius: 1.14, flatten: 0.88, waveAmplitude: 1.45 },
  },
  crystals: {
    method: "seeded-axis-spire-growth",
    sources: ["generalizedCylinder", "bufferGeometry"],
    operators: ["sample-separated-axes", "wind-tapered-prisms", "wave-lean", "recompute-normals"],
    parameters: { count: [6, 13, "integer"], radius: [0.22, 0.44], height: [2.1, 4.5], spread: [1.5, 2.9], tilt: [0.04, 0.38], waveAmplitude: [0.01, 0.08], waveFrequency: [1.2, 3.2] },
    controls: ["height", "spread", "tilt"],
    tune: { height: 1.24, spread: 1.12, tilt: 1.3 },
  },
  shrine: {
    method: "parametric-radial-sanctum",
    sources: ["generalizedCylinder", "bufferGeometry"],
    operators: ["wind-base", "repeat-supports", "wind-roof", "wave-weather", "recompute-normals"],
    parameters: { baseRadius: [1.1, 1.75], pillarSpread: [0.68, 1.18], pillarHeight: [2.2, 3.5], roofRadius: [1.35, 2.1], roofHeight: [0.48, 0.98], waveAmplitude: [0.005, 0.055], waveFrequency: [1.2, 3.2] },
    controls: ["pillarSpread", "pillarHeight", "roofRadius"],
    tune: { pillarSpread: 1.16, pillarHeight: 1.12, roofRadius: 1.18 },
  },
  arch: {
    method: "inverted-catenary-voussoir-sweep",
    sources: ["catenary", "generalizedCylinder", "bufferGeometry"],
    operators: ["solve-catenary-profile", "sample-voussoirs", "wind-blocks", "wave-weather", "recompute-normals"],
    parameters: { span: [3.1, 4.8], rise: [2.25, 3.8], blockCount: [9, 15, "odd"], blockWidth: [0.46, 0.76], blockDepth: [0.65, 1.08], waveAmplitude: [0.008, 0.1], waveFrequency: [1.4, 3.8] },
    controls: ["span", "rise", "waveAmplitude"],
    tune: { span: 1.1, rise: 1.24, waveAmplitude: 1.55 },
  },
  bridge: {
    method: "catenary-deck-sweep",
    sources: ["catenary", "generalizedCylinder", "bufferGeometry"],
    operators: ["solve-catenary-guides", "sample-deck", "wind-ropes", "wave-wear", "recompute-normals"],
    parameters: { span: [3.4, 5.6], width: [2, 3.1], plankCount: [9, 17, "odd"], sag: [0.12, 0.5], waveAmplitude: [0.005, 0.06], waveFrequency: [1.1, 3.2] },
    controls: ["span", "plankCount", "sag"],
    tune: { span: 1.12, plankCount: 1.2, sag: 1.3 },
  },
  waterfall: {
    method: "erosion-tier-flow",
    sources: ["noise", "bufferGeometry"],
    operators: ["stack-eroded-tiers", "wind-water-strip", "wave-flow", "recompute-normals"],
    parameters: { tiers: [5, 9, "integer"], width: [1.05, 1.8], height: [2.7, 4.4], spread: [1.6, 2.8], waveAmplitude: [0.02, 0.12], waveFrequency: [1.4, 4.2] },
    controls: ["tiers", "width", "height"],
    tune: { tiers: 1.2, width: 1.14, height: 1.18 },
  },
  mushrooms: {
    method: "annular-growth-field",
    sources: ["noise", "bufferGeometry"],
    operators: ["sample-annulus", "wind-stems", "wind-caps", "wave-scale", "recompute-normals"],
    parameters: { count: [9, 19, "integer"], ringRadius: [1.1, 2.2], stemHeight: [0.36, 0.72], capRadius: [0.18, 0.38], waveAmplitude: [0.01, 0.09], waveFrequency: [1.2, 4] },
    controls: ["count", "ringRadius", "capRadius"],
    tune: { count: 1.18, ringRadius: 1.14, capRadius: 1.2 },
  },
  fireflies: {
    method: "seeded-curl-swarm",
    sources: ["noise", "bufferGeometry"],
    operators: ["seed-attractors", "sample-curl-field", "instance-points", "wave-drift"],
    parameters: { count: [80, 240, "integer"], radius: [2.2, 5.8], height: [2.8, 5.4], drift: [0.08, 0.42], waveAmplitude: [0.05, 0.3], waveFrequency: [0.8, 2.8] },
    controls: ["count", "radius", "drift"],
    tune: { count: 1.2, radius: 1.12, drift: 1.35 },
  },
  lantern: {
    method: "cantilever-cage-lattice",
    sources: ["generalizedCylinder", "bufferGeometry"],
    operators: ["wind-post", "wind-cantilever", "repeat-cage-bars", "recompute-normals"],
    parameters: { postHeight: [2.3, 3.5], armReach: [0.55, 1.05], cageSize: [0.36, 0.7], cageHeight: [0.55, 0.95], waveAmplitude: [0.004, 0.035], waveFrequency: [1.2, 3.4] },
    controls: ["postHeight", "armReach", "cageSize"],
    tune: { postHeight: 1.12, armReach: 1.2, cageSize: 1.18 },
  },
  monolith: {
    method: "wave-deformed-faceted-pillar",
    sources: ["noise", "bufferGeometry"],
    operators: ["wind-prism", "taper", "wave-displace", "reserve-rune-bands", "recompute-normals"],
    parameters: { width: [1, 1.55], height: [3.2, 4.8], depth: [0.58, 0.92], taper: [0.02, 0.18], waveAmplitude: [0.01, 0.09], waveFrequency: [1.1, 3.8] },
    controls: ["width", "height", "waveAmplitude"],
    tune: { width: 1.12, height: 1.18, waveAmplitude: 1.5 },
  },
});

function hashNumber(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableHash(value) {
  return hashNumber(value).toString(16).padStart(8, "0");
}

function rounded(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function sample(seed, name, [minimum, maximum, kind]) {
  const unit = hashNumber(`${seed}:${name}`) / 4294967295;
  let value = minimum + unit * (maximum - minimum);
  if (kind === "integer") value = Math.round(value);
  if (kind === "odd") {
    value = Math.round(value);
    if (value % 2 === 0) value += value < maximum ? 1 : -1;
  }
  return rounded(value);
}

function tunedValue(value, factor, range) {
  const [minimum, maximum, kind] = range;
  let result = Math.max(minimum, Math.min(maximum, value * factor));
  if (kind === "integer") result = Math.round(result);
  if (kind === "odd") {
    result = Math.round(result);
    if (result % 2 === 0) result += result < maximum ? 1 : -1;
  }
  return rounded(result);
}

function controlLabel(value) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase());
}

function validateInitialSettings(type, definition, settings) {
  if (settings == null) return {};
  if (typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`Initial procedural settings for ${type} must be an object.`);
  }
  const validated = {};
  for (const [name, rawValue] of Object.entries(settings)) {
    const range = definition.parameters[name];
    if (!range) throw new Error(`Unknown procedural setting ${type}.${name}.`);
    const value = Number(rawValue);
    const [minimum, maximum, kind] = range;
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new Error(`Procedural setting ${type}.${name} must be between ${minimum} and ${maximum}.`);
    }
    if (kind === "integer" && !Number.isInteger(value)) {
      throw new Error(`Procedural setting ${type}.${name} must be an integer.`);
    }
    if (kind === "odd" && (!Number.isInteger(value) || value % 2 === 0)) {
      throw new Error(`Procedural setting ${type}.${name} must be an odd integer.`);
    }
    validated[name] = rounded(value);
  }
  return validated;
}

export function proceduralMeshProgramContract(type) {
  const definition = DEFINITIONS[type];
  if (!definition) return null;
  return {
    schemaVersion: "nexus.procedural-mesh-settings.v1",
    method: definition.method,
    parameters: Object.fromEntries(Object.entries(definition.parameters).map(([name, [minimum, maximum, kind]]) => [name, {
      minimum,
      maximum,
      kind: kind || "number",
    }])),
    previewControls: [...definition.controls],
  };
}

export function validateProceduralMeshSettings(type, settings) {
  const definition = DEFINITIONS[type];
  if (!definition) throw new Error(`No procedural mesh program is registered for ${type}.`);
  return validateInitialSettings(type, definition, settings);
}

export function createProceduralMeshProgram(step) {
  const definition = DEFINITIONS[step.type];
  if (!definition) throw new Error(`No procedural mesh program is registered for ${step.type}.`);
  const programSeed = `${step.seed}:${step.algorithm}:${step.id}`;
  const baseSettings = Object.fromEntries(Object.entries(definition.parameters).map(([name, range]) => [name, sample(programSeed, name, range)]));
  Object.assign(baseSettings, validateProceduralMeshSettings(step.type, step.factorySettings));
  const tunedSettings = { ...baseSettings };
  for (const [name, factor] of Object.entries(definition.tune)) {
    tunedSettings[name] = tunedValue(baseSettings[name], factor, definition.parameters[name]);
  }
  const controls = definition.controls.map((name) => ({
    id: name,
    label: controlLabel(name),
    minimum: definition.parameters[name][0],
    maximum: definition.parameters[name][1],
    initial: baseSettings[name],
    tuned: tunedSettings[name],
  }));
  const program = {
    schemaVersion: "nexus.procedural-mesh-program.v1",
    programId: `${step.id}-${stableHash(programSeed)}`,
    objectId: step.id,
    objectType: step.type,
    algorithm: step.algorithm,
    seed: step.seed,
    method: definition.method,
    topology: "indexed-custom-wound-triangles",
    operators: definition.operators.map((operator, index) => ({ order: index + 1, operator })),
    settings: tunedSettings,
    preview: { controls, initialSettings: baseSettings, tunedSettings },
    sources: definition.sources.map((id) => SOURCES[id]),
  };
  program.digest = stableHash(JSON.stringify(program));
  return program;
}

export function proceduralMeshSources() {
  return Object.values(SOURCES).map((source) => ({ ...source }));
}
