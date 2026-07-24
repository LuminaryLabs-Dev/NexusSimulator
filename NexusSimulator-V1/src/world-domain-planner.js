import { proceduralMeshProgramContract, validateProceduralMeshSettings } from "./procedural-mesh-program.js";

const DOMAIN_CARDS = Object.freeze({
  "world/natural-environment": {
    purpose: "Own the interacting natural systems that make the place coherent.",
    meaning: "The living and physical environment.",
    owns: ["environmental state", "natural composition", "system relationships"],
    receives: ["biome", "world description", "spatial constraints"],
    exposes: ["landform", "water", "ecology", "geology"],
    behaviors: ["compose natural systems", "maintain environmental compatibility"],
    doesNotOwn: ["constructed landmarks", "rendering implementation"],
  },
  "world/natural-environment/landform": {
    purpose: "Own terrain shape, traversable ground, and elevation continuity.",
    meaning: "The physical surface of the world.",
    owns: ["surface topology", "elevation", "ground material regions"],
    receives: ["biome", "world bounds", "hydrology constraints"],
    exposes: ["grounding surface", "slope", "terrain regions"],
    behaviors: ["generate terrain", "shape drainage", "ground placed objects"],
    doesNotOwn: ["free-standing geology", "water simulation"],
  },
  "world/natural-environment/hydrology": {
    purpose: "Own flowing and standing water as a connected natural system.",
    meaning: "Water presence, path, banks, and continuity.",
    owns: ["water path", "width", "banks", "flow relationships"],
    receives: ["terrain", "description", "world bounds"],
    exposes: ["water surface", "bank constraints", "crossing opportunities"],
    behaviors: ["route water", "carve terrain", "constrain nearby placement"],
    doesNotOwn: ["bridges", "riparian vegetation"],
  },
  "world/natural-environment/ecology": {
    purpose: "Own compatible living populations and their habitat relationships.",
    meaning: "Plant and organism communities in the place.",
    owns: ["population identity", "habitat", "distribution"],
    receives: ["biome", "terrain", "water availability"],
    exposes: ["vegetation", "ambient life", "habitat constraints"],
    behaviors: ["select compatible species", "distribute populations"],
    doesNotOwn: ["terrain topology", "decorative placement without habitat meaning"],
  },
  "world/natural-environment/geology": {
    purpose: "Own rock and mineral formations that express the world's substrate.",
    meaning: "Exposed geological material and formations.",
    owns: ["formation type", "material identity", "distribution"],
    receives: ["biome", "terrain", "description"],
    exposes: ["rocks", "mineral formations", "ground detail"],
    behaviors: ["form clusters", "weather surfaces", "anchor terrain detail"],
    doesNotOwn: ["terrain heightfield", "constructed masonry"],
  },
  "world/constructed-environment": {
    purpose: "Own intentionally built spaces and their relationship to use.",
    meaning: "Structures created for landmarks, movement, or guidance.",
    owns: ["constructed identity", "spatial purpose", "structural composition"],
    receives: ["world description", "terrain", "agent intent"],
    exposes: ["landmarks", "passages", "guidance structures"],
    behaviors: ["place structures", "maintain access", "compose built forms"],
    doesNotOwn: ["natural systems", "renderer details"],
  },
  "world/constructed-environment/landmarks": {
    purpose: "Own meaningful built focal points.",
    meaning: "Places that organize attention and identity.",
    owns: ["landmark identity", "focal hierarchy", "approach space"],
    receives: ["terrain", "description", "composition constraints"],
    exposes: ["focal structure", "approach target"],
    behaviors: ["establish focus", "reserve readable surroundings"],
    doesNotOwn: ["general traversal", "ambient decoration"],
  },
  "world/constructed-environment/traversal": {
    purpose: "Own built passages and crossings.",
    meaning: "Structures that support or frame movement.",
    owns: ["span", "clearance", "entry and exit"],
    receives: ["terrain", "hydrology", "route constraints"],
    exposes: ["crossing", "passage", "placement clearance"],
    behaviors: ["bridge gaps", "frame routes", "preserve access"],
    doesNotOwn: ["route planning outside the structure", "landmark narrative"],
  },
  "world/constructed-environment/guidance": {
    purpose: "Own built visual guidance and local illumination.",
    meaning: "Structures that communicate route and location.",
    owns: ["guide identity", "visibility", "local light"],
    receives: ["route", "lighting context"],
    exposes: ["wayfinding cue", "light source"],
    behaviors: ["mark paths", "support nighttime readability"],
    doesNotOwn: ["global lighting", "path topology"],
  },
  "world/ambient-life": {
    purpose: "Own non-structural populations that communicate a living place.",
    meaning: "Ambient organisms and motion fields.",
    owns: ["population", "motion", "habitat bounds"],
    receives: ["ecology", "lighting", "description"],
    exposes: ["ambient motion", "localized activity"],
    behaviors: ["populate", "drift", "react to habitat"],
    doesNotOwn: ["primary ecology", "global atmosphere"],
  },
});

const CAPABILITIES = Object.freeze([
  {
    id: "landform.generated-surface",
    factoryType: "terrainPatch",
    nativeCapability: "generated-terrain-system",
    domainPath: "world/natural-environment/landform",
    terms: ["terrain", "ground", "landscape", "landform"],
    foundational: true,
    labels: { desert: "Desert Terrain", alpine: "Alpine Terrain", volcanic: "Volcanic Terrain", forest: "Forest Terrain" },
    review: ["continuous ground", "readable elevation", "valid placement surface"],
  },
  {
    id: "hydrology.river-system",
    nativeCapability: "generated-river-system",
    domainPath: "world/natural-environment/hydrology",
    terms: ["river", "rivers", "stream", "streams", "waterway", "oasis"],
    labels: { default: "River System" },
    review: ["continuous water path", "terrain-carved banks", "coherent source and exit"],
  },
  {
    id: "ecology.oak-population",
    factoryType: "oak",
    domainPath: "world/natural-environment/ecology",
    terms: ["oak", "oaks", "ancient trees"],
    genericTerms: ["tree", "trees", "forest", "woodland", "grove"],
    biomeAffinity: ["forest"],
    labels: { default: "Oak Grove" },
    review: ["rooted trunks", "canopy variation", "habitat-compatible placement"],
  },
  {
    id: "ecology.birch-population",
    factoryType: "birch",
    domainPath: "world/natural-environment/ecology",
    terms: ["birch", "birches"],
    genericTerms: ["tree", "trees", "forest", "woodland", "grove"],
    biomeAffinity: ["forest", "alpine"],
    labels: { default: "Birch Stand" },
    review: ["species silhouette", "cluster rhythm", "rooted placement"],
  },
  {
    id: "ecology.pine-population",
    factoryType: "pine",
    domainPath: "world/natural-environment/ecology",
    terms: ["pine", "pines", "conifer", "conifers"],
    genericTerms: ["tree", "trees", "forest", "woodland"],
    biomeAffinity: ["alpine", "forest"],
    labels: { default: "Pine Stand" },
    review: ["conifer silhouette", "height variation", "terrain grounding"],
  },
  {
    id: "ecology.riparian-willow",
    factoryType: "willow",
    domainPath: "world/natural-environment/ecology",
    terms: ["willow", "willows", "oasis", "riparian"],
    genericTerms: ["tree", "trees"],
    biomeAffinity: ["desert"],
    labels: { desert: "Oasis Willow Grove", default: "River Willow Grove" },
    review: ["bank relationship", "drooping silhouette", "rooted placement"],
  },
  {
    id: "geology.boulder-formation",
    factoryType: "boulders",
    domainPath: "world/natural-environment/geology",
    terms: ["boulder", "boulders", "rock", "rocks", "outcrop", "outcrops"],
    labels: { desert: "Sandstone Outcrop", volcanic: "Basalt Outcrop", default: "Boulder Formation" },
    review: ["terrain contact", "scale variation", "material continuity"],
  },
  {
    id: "geology.crystal-formation",
    factoryType: "crystals",
    domainPath: "world/natural-environment/geology",
    terms: ["crystal", "crystals", "crystalline", "mineral", "minerals"],
    labels: { desert: "Desert Crystal Formation", volcanic: "Magma Crystal Formation", default: "Crystal Formation" },
    review: ["cluster hierarchy", "embedded roots", "material response"],
  },
  {
    id: "landmark.shrine",
    factoryType: "shrine",
    domainPath: "world/constructed-environment/landmarks",
    terms: ["shrine", "shrines", "temple", "temples", "sanctuary"],
    labels: { desert: "Desert Shrine", alpine: "Mountain Shrine", default: "World Shrine" },
    review: ["focal hierarchy", "readable entrance", "grounded foundation"],
  },
  {
    id: "traversal.arch",
    factoryType: "arch",
    domainPath: "world/constructed-environment/traversal",
    terms: ["arch", "arches", "gateway", "gateways"],
    labels: { desert: "Sandstone Arch", alpine: "Stone Pass", volcanic: "Basalt Arch", default: "Stone Arch" },
    review: ["clear opening", "structural silhouette", "integrated footings"],
  },
  {
    id: "traversal.bridge",
    factoryType: "bridge",
    domainPath: "world/constructed-environment/traversal",
    terms: ["bridge", "bridges", "crossing", "crossings"],
    labels: { desert: "Oasis Crossing", alpine: "Valley Crossing", default: "River Crossing" },
    review: ["connected banks", "walkable span", "clear entry and exit"],
  },
  {
    id: "hydrology.waterfall",
    factoryType: "waterfall",
    domainPath: "world/natural-environment/hydrology",
    terms: ["waterfall", "waterfalls", "cascade", "cascades"],
    labels: { alpine: "Mountain Cascade", desert: "Oasis Source", default: "Waterfall" },
    review: ["water continuity", "terrain source", "readable fall"],
  },
  {
    id: "ecology.mushroom-population",
    factoryType: "mushrooms",
    domainPath: "world/natural-environment/ecology",
    terms: ["mushroom", "mushrooms", "fungus", "fungi", "fungal"],
    labels: { default: "Mushroom Colony" },
    review: ["habitat grouping", "scale variation", "ground contact"],
  },
  {
    id: "ambient.firefly-population",
    factoryType: "fireflies",
    domainPath: "world/ambient-life",
    terms: ["firefly", "fireflies", "glowing insects"],
    labels: { default: "Firefly Population" },
    review: ["bounded swarm", "visible motion", "habitat relationship"],
  },
  {
    id: "guidance.lantern",
    factoryType: "lantern",
    domainPath: "world/constructed-environment/guidance",
    terms: ["lantern", "lanterns", "wayfinder", "wayfinders", "path light", "path lights"],
    labels: { desert: "Oasis Wayfinder", default: "Wayfinder Lantern" },
    review: ["readable light", "route relationship", "grounded support"],
  },
  {
    id: "landmark.monolith",
    factoryType: "monolith",
    domainPath: "world/constructed-environment/landmarks",
    terms: ["monolith", "monoliths", "obelisk", "obelisks"],
    labels: { default: "Monolith" },
    review: ["focal hierarchy", "material scale", "grounded base"],
  },
]);

const IGNORED_WORLD_WORDS = new Set([
  "world", "place", "scene", "area", "basin", "valley", "land", "environment",
  "desert", "forest", "alpine", "volcanic", "bounded", "infinite", "patched",
  "spherical", "toroidal", "layered", "spatial",
]);

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function safeId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function includesTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped.replace(/\\ /g, "\\s+")}\\b`, "i").test(text);
}

function promptPhrases(prompt) {
  const cleaned = String(prompt)
    .toLowerCase()
    .replace(/^(create|build|generate|make)\s+(an|a|the)?\s*/i, "")
    .replace(/[.!?;:]+/g, ",");
  return cleaned
    .split(/\s+with\s+|\s*,\s*|\s+and\s+/)
    .map((phrase) => phrase.replace(/^(and\s+)?(an|a|the)\s+/, "").trim())
    .filter(Boolean);
}

function labelFor(capability, worldType) {
  return capability.labels?.[worldType] || capability.labels?.default || capability.id;
}

function capabilityScore(capability, phrase, worldType) {
  const explicit = (capability.terms || []).some((term) => includesTerm(phrase, term));
  if (explicit) return 100 + (capability.biomeAffinity?.includes(worldType) ? 5 : 0);
  const generic = (capability.genericTerms || []).some((term) => includesTerm(phrase, term));
  if (!generic) return 0;
  return 20 + (capability.biomeAffinity?.includes(worldType) ? 10 : 0);
}

function isBiomeOrStructurePhrase(phrase) {
  const words = phrase.split(/\s+/).filter((word) => !["a", "an", "the"].includes(word));
  return words.length > 0 && words.every((word) => IGNORED_WORLD_WORDS.has(word));
}

function selectedDomainCards(requirements) {
  const paths = new Set();
  for (const requirement of requirements) {
    const parts = requirement.domainPath.split("/");
    for (let depth = 2; depth <= parts.length; depth += 1) {
      const path = parts.slice(0, depth).join("/");
      if (DOMAIN_CARDS[path]) paths.add(path);
    }
  }
  return [...paths].sort().map((path) => ({
    path,
    ...DOMAIN_CARDS[path],
    children: [...paths].filter((candidate) => candidate.startsWith(`${path}/`) && candidate.split("/").length === path.split("/").length + 1),
    evidence: [{ source: "world description and capability registry", confidence: "inferred" }],
  }));
}

function validateAgentRequirements(agentPlan, capabilityById, worldStructure, worldType) {
  if (agentPlan?.schemaVersion !== "nexus.world-domain-plan.v1" || !Array.isArray(agentPlan.requirements)) {
    throw new Error("Agent-authored domain plan must use nexus.world-domain-plan.v1 and contain requirements.");
  }
  if (agentPlan.worldType && agentPlan.worldType !== worldType) {
    throw new Error(`Agent domain plan worldType ${agentPlan.worldType} does not match compiled worldType ${worldType}.`);
  }
  if (agentPlan.worldStructure && agentPlan.worldStructure !== worldStructure) {
    throw new Error(`Agent domain plan worldStructure ${agentPlan.worldStructure} does not match compiled worldStructure ${worldStructure}.`);
  }
  const seen = new Set();
  const seenIds = new Set();
  return agentPlan.requirements.map((requirement, index) => {
    const capability = capabilityById.get(requirement.capabilityId);
    if (!capability) throw new Error(`Agent domain requirement ${index + 1} references unknown capability ${requirement.capabilityId}.`);
    if (seen.has(capability.id)) throw new Error(`Agent domain plan repeats capability ${capability.id}.`);
    seen.add(capability.id);
    const id = requirement.id || `requirement-${safeId(capability.id)}`;
    if (seenIds.has(id)) throw new Error(`Agent domain plan repeats requirement id ${id}.`);
    seenIds.add(id);
    if (requirement.settings != null && (!capability.factoryType || typeof requirement.settings !== "object" || Array.isArray(requirement.settings))) {
      throw new Error(`Agent domain requirement ${id} may provide settings only as an object for a factory capability.`);
    }
    return {
      id,
      concept: requirement.concept || labelFor(capability, worldType),
      domainPath: capability.domainPath,
      capabilityId: capability.id,
      factoryType: capability.factoryType || null,
      nativeCapability: capability.nativeCapability || null,
      source: "agent",
      promptSignal: requirement.promptSignal || null,
      reason: requirement.reason || "Selected by the agent-authored domain plan.",
      reviewCriteria: capability.review,
      settingsContract: capability.settingsContract,
      factorySettings: requirement.settings ? validateProceduralMeshSettings(capability.factoryType, requirement.settings) : null,
    };
  });
}

function promptCoverageForRequirements(prompt, requirements, capabilityById, worldType) {
  const requirementByCapability = new Map(requirements.map((requirement) => [requirement.capabilityId, requirement]));
  const signals = [];
  const ambiguities = [];
  for (const phrase of promptPhrases(prompt)) {
    if (isBiomeOrStructurePhrase(phrase)) {
      signals.push({ signal: phrase, source: "prompt", disposition: "world-context", status: "covered" });
      continue;
    }
    const scored = [...requirementByCapability.keys()]
      .map((capabilityId) => ({ capabilityId, score: capabilityScore(capabilityById.get(capabilityId), phrase, worldType) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);
    const explicit = scored.filter((entry) => entry.score >= 100);
    const matches = explicit.length ? explicit : scored.length ? [scored[0]] : [];
    if (!matches.length) {
      ambiguities.push({ signal: phrase, reason: "The agent-authored requirements do not cover this prompt signal." });
      signals.push({ signal: phrase, source: "prompt", disposition: "ambiguity", status: "open" });
      continue;
    }
    signals.push({
      signal: phrase,
      source: "prompt",
      disposition: "domain-requirement",
      requirementIds: matches.map(({ capabilityId }) => requirementByCapability.get(capabilityId).id),
      status: "covered",
    });
  }
  return { ambiguities, signals };
}

export function worldFactoryCapabilityCatalog(baseProfile) {
  const availableTypes = new Set((baseProfile.steps || []).map((step) => step.type));
  return CAPABILITIES.map((capability) => {
    const meshContract = capability.factoryType ? proceduralMeshProgramContract(capability.factoryType) : null;
    return {
      ...capability,
      settingsContract: capability.factoryType
        ? { mode: "typed-factory-parameters", agentMutable: true, schema: meshContract }
        : { mode: "native-world-system", agentMutable: false },
      available: Boolean(capability.nativeCapability || (availableTypes.has(capability.factoryType) && meshContract)),
    };
  });
}

export function createWorldDomainPlan({ agentPlan = null, baseProfile, prompt, seed, worldStructure, worldType }) {
  const catalog = worldFactoryCapabilityCatalog(baseProfile);
  const capabilityById = new Map(catalog.map((capability) => [capability.id, capability]));
  let requirements;
  let coverageSignals;
  let ambiguities = [];

  if (agentPlan) {
    requirements = validateAgentRequirements(agentPlan, capabilityById, worldStructure, worldType);
    coverageSignals = [];
  } else {
    const selected = new Map();
    const foundation = catalog.find((capability) => capability.foundational);
    selected.set(foundation.id, { capability: foundation, source: "inferred", phrase: worldType, reason: "Every physical world requires a grounding surface." });
    coverageSignals = [];
    for (const phrase of promptPhrases(prompt)) {
      const scored = catalog
        .map((capability) => ({ capability, score: capabilityScore(capability, phrase, worldType) }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score);
      const explicit = scored.filter((entry) => entry.score >= 100);
      const matches = explicit.length ? explicit : scored.length ? [scored[0]] : [];
      if (!matches.length && isBiomeOrStructurePhrase(phrase)) {
        coverageSignals.push({ signal: phrase, source: "prompt", disposition: "world-context", status: "covered" });
        continue;
      }
      if (!matches.length) {
        const ambiguity = { signal: phrase, reason: "No registered semantic capability owns this intent." };
        ambiguities.push(ambiguity);
        coverageSignals.push({ signal: phrase, source: "prompt", disposition: "ambiguity", status: "open" });
        continue;
      }
      for (const { capability } of matches) {
        selected.set(capability.id, {
          capability,
          source: "prompt",
          phrase,
          reason: `The description explicitly requests ${phrase}.`,
        });
      }
      coverageSignals.push({
        signal: phrase,
        source: "prompt",
        disposition: "domain-requirement",
        requirementIds: matches.map(({ capability }) => `requirement-${safeId(capability.id)}`),
        status: "covered",
      });
    }
    const ensureDependency = (capabilityId, reason) => {
      if (selected.has(capabilityId)) return;
      const capability = capabilityById.get(capabilityId);
      selected.set(capabilityId, {
        capability,
        source: "inferred",
        phrase: null,
        reason,
      });
    };
    if (selected.has("hydrology.waterfall")) {
      ensureDependency("hydrology.river-system", "A waterfall requires a continuous water system and terrain-carved flow path.");
    }
    if (selected.has("traversal.bridge")) {
      ensureDependency("hydrology.river-system", "The current bridge capability requires a generated crossing system; a different span requires another registered traversal provider.");
    }
    requirements = [...selected.values()].map(({ capability, phrase, reason, source }) => ({
      id: `requirement-${safeId(capability.id)}`,
      concept: labelFor(capability, worldType),
      domainPath: capability.domainPath,
      capabilityId: capability.id,
      factoryType: capability.factoryType || null,
      nativeCapability: capability.nativeCapability || null,
      source,
      promptSignal: phrase,
      reason,
      reviewCriteria: capability.review,
      settingsContract: capability.settingsContract,
      factorySettings: null,
    }));
  }

  const addInferredRequirement = (capabilityId, reason) => {
    if (requirements.some((requirement) => requirement.capabilityId === capabilityId)) return;
    const capability = capabilityById.get(capabilityId);
    requirements.push({
      id: `requirement-${safeId(capability.id)}`,
      concept: labelFor(capability, worldType),
      domainPath: capability.domainPath,
      capabilityId: capability.id,
      factoryType: capability.factoryType || null,
      nativeCapability: capability.nativeCapability || null,
      source: "inferred",
      promptSignal: null,
      reason,
      reviewCriteria: capability.review,
      settingsContract: capability.settingsContract,
      factorySettings: null,
    });
  };
  addInferredRequirement("landform.generated-surface", "Every physical world requires a grounding surface.");
  if (requirements.some((requirement) => requirement.capabilityId === "hydrology.waterfall")) {
    addInferredRequirement("hydrology.river-system", "A waterfall requires a continuous water system and terrain-carved flow path.");
  }
  if (requirements.some((requirement) => requirement.capabilityId === "traversal.bridge")) {
    addInferredRequirement("hydrology.river-system", "The current bridge capability requires a generated crossing system; a different span requires another registered traversal provider.");
  }
  if (agentPlan) {
    const coverage = promptCoverageForRequirements(prompt, requirements, capabilityById, worldType);
    coverageSignals = coverage.signals;
    ambiguities = coverage.ambiguities;
  }

  const unavailable = requirements.filter((requirement) => capabilityById.get(requirement.capabilityId)?.available !== true);
  const gaps = unavailable.map((requirement) => ({
    requirementId: requirement.id,
    capabilityId: requirement.capabilityId,
    reason: "The semantic requirement has no executable factory or native provider in this runtime.",
  }));
  const compositionEdges = [];
  const requirementByCapability = new Map(requirements.map((requirement) => [requirement.capabilityId, requirement]));
  const terrain = requirementByCapability.get("landform.generated-surface");
  for (const requirement of requirements) {
    if (terrain && requirement.id !== terrain.id) compositionEdges.push({ from: terrain.id, relationship: "grounds", to: requirement.id });
  }
  const river = requirementByCapability.get("hydrology.river-system");
  for (const id of ["ecology.riparian-willow", "traversal.bridge", "hydrology.waterfall"]) {
    const requirement = requirementByCapability.get(id);
    if (river && requirement) compositionEdges.push({ from: river.id, relationship: id.includes("bridge") ? "is-crossed-by" : "supports", to: requirement.id });
  }
  const shrine = requirementByCapability.get("landmark.shrine");
  const arch = requirementByCapability.get("traversal.arch");
  if (shrine && arch) compositionEdges.push({ from: arch.id, relationship: "frames-approach-to", to: shrine.id });
  if (agentPlan?.compositionEdges) {
    if (!Array.isArray(agentPlan.compositionEdges)) throw new Error("Agent domain plan compositionEdges must be an array.");
    const requirementIds = new Set(requirements.map((requirement) => requirement.id));
    for (const edge of agentPlan.compositionEdges) {
      if (!requirementIds.has(edge.from) || !requirementIds.has(edge.to) || typeof edge.relationship !== "string" || !edge.relationship.trim()) {
        throw new Error("Agent domain plan composition edges must reference known requirement ids and name a relationship.");
      }
      const normalized = { from: edge.from, relationship: edge.relationship.trim(), to: edge.to };
      if (!compositionEdges.some((existing) => existing.from === normalized.from && existing.relationship === normalized.relationship && existing.to === normalized.to)) {
        compositionEdges.push(normalized);
      }
    }
  }

  const coverageComplete = ambiguities.length === 0 && gaps.length === 0 && coverageSignals.every((signal) => signal.status === "covered");
  const plan = {
    schemaVersion: "nexus.world-domain-plan.v1",
    plannerMode: agentPlan ? "agent-authored" : "deterministic-domain-fallback",
    prompt,
    seed,
    worldType,
    worldStructure,
    root: {
      path: "world",
      purpose: "Compose a coherent place from covered semantic requirements.",
      evidence: [{ source: "prompt", confidence: "observed" }],
    },
    domainTree: selectedDomainCards(requirements),
    requirements,
    compositionEdges,
    supportingPlanes: [
      { path: "support/generation", serves: requirements.filter((requirement) => requirement.factoryType).map((requirement) => requirement.id) },
      { path: "support/assurance", serves: requirements.map((requirement) => requirement.id) },
      { path: "support/presentation", serves: requirements.map((requirement) => requirement.id) },
    ],
    coverageLedger: {
      status: coverageComplete ? "complete" : "incomplete",
      signals: coverageSignals,
      coveredCount: coverageSignals.filter((signal) => signal.status === "covered").length,
      openCount: coverageSignals.filter((signal) => signal.status !== "covered").length + gaps.length,
    },
    ambiguities,
    gaps,
    saturationState: {
      schemaVersion: "nexus.domain-saturation-state.v1",
      eligibility: "pending-visual-validation",
      zeroDiscoveryStreak: "held",
      acceptedAtomIds: [],
      candidateAtomIds: gaps.map((gap) => gap.capabilityId),
      compositionSignature: stableHash(JSON.stringify({
        capabilities: requirements.map((requirement) => requirement.capabilityId).sort(),
        edges: compositionEdges.map((edge) => `${edge.from}:${edge.relationship}:${edge.to}`).sort(),
      })),
      reason: "Domain saturation changes only after structural validation, human review, and promotion.",
    },
  };
  plan.digest = stableHash(JSON.stringify(plan));
  return plan;
}

export function materializeDomainPlanSteps({ baseProfile, plan }) {
  if (plan.coverageLedger.status !== "complete") {
    const uncovered = [...plan.ambiguities.map((entry) => entry.signal), ...plan.gaps.map((entry) => entry.capabilityId)];
    throw new Error(`World domain coverage is incomplete: ${uncovered.join(", ")}. Supply an agent-authored plan or register the missing capability.`);
  }
  const templatesByType = new Map(baseProfile.steps.map((step) => [step.type, step]));
  return plan.requirements.filter((requirement) => requirement.factoryType).map((requirement, index) => {
    const template = templatesByType.get(requirement.factoryType);
    if (!template) throw new Error(`No factory template exists for ${requirement.factoryType}.`);
    return {
      ...template,
      id: `planned-${safeId(requirement.capabilityId)}-${String(index + 1).padStart(2, "0")}`,
      label: requirement.concept,
      instruction: `Build ${requirement.concept.toLowerCase()} for ${requirement.domainPath}; satisfy ${requirement.reviewCriteria.join(", ")}.`,
      domainRequirementId: requirement.id,
      domainPath: requirement.domainPath,
      capabilityId: requirement.capabilityId,
      reviewCriteria: requirement.reviewCriteria,
      factorySettings: requirement.factorySettings || null,
    };
  });
}
