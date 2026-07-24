import { randomBytes } from "node:crypto";
import { generateWorldPlan } from "./world-plan-generator.js";
import { createWorldDomainPlan, materializeDomainPlanSteps } from "./world-domain-planner.js";

const WORLD_TYPES = [
  { id: "desert", terms: ["desert", "dunes", "arid", "oasis"] },
  { id: "alpine", terms: ["alpine", "mountain", "mountains", "snowy", "snow"] },
  { id: "volcanic", terms: ["volcanic", "volcano", "lava", "magma"] },
  { id: "forest", terms: ["forest", "woodland", "woods", "grove"] },
];

const WORLD_STRUCTURES = [
  { id: "infinite", terms: ["infinite", "endless"] },
  { id: "patched", terms: ["patched", "chunked", "tiled"] },
  { id: "spherical", terms: ["spherical", "globe", "planet"] },
  { id: "full-spatial", terms: ["full spatial", "free spatial", "zero gravity"] },
  { id: "toroidal", terms: ["toroidal", "wrapped", "looping world"] },
  { id: "layered", terms: ["layered", "stacked world", "multiple layers"] },
  { id: "bounded", terms: ["bounded", "contained", "enclosed"] },
];

function includesTerm(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped.replace(/\\ /g, "\\s+")}\\b`, "i").test(text);
}

function matchingIds(text, definitions) {
  return definitions
    .filter((definition) => definition.terms.some((term) => includesTerm(text, term)))
    .map((definition) => definition.id);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function titleCase(value) {
  return value.replace(/(^|[-\s])\w/g, (match) => match.toUpperCase()).replaceAll("-", " ");
}

export function compileWorldPrompt(baseProfile, rawPrompt, options = {}) {
  const prompt = String(rawPrompt || "").trim();
  if (!prompt) throw new Error("World prompt cannot be empty.");
  if (prompt.length > 500) throw new Error("World prompt must be 500 characters or fewer.");

  const worldTypeMatches = matchingIds(prompt, WORLD_TYPES);
  if (worldTypeMatches.length === 0) {
    throw new Error("World prompt must name one supported biome: forest, desert, alpine, or volcanic.");
  }
  if (worldTypeMatches.length > 1) {
    throw new Error(`World prompt is ambiguous across supported biomes: ${worldTypeMatches.join(", ")}.`);
  }

  const worldType = worldTypeMatches[0];
  if (!baseProfile.worldTypes?.[worldType]) throw new Error(`Template profile does not define world type ${worldType}.`);

  const structureMatches = matchingIds(prompt, WORLD_STRUCTURES);
  if (structureMatches.length > 1) {
    throw new Error(`World prompt is ambiguous across world structures: ${structureMatches.join(", ")}.`);
  }
  const worldStructure = structureMatches[0] || "bounded";
  if (!baseProfile.worldStructures?.[worldStructure]) throw new Error(`Template profile does not define world structure ${worldStructure}.`);

  const requestedSeed = options.seed == null ? null : String(options.seed).trim();
  if (options.seed != null && !requestedSeed) throw new Error("World seed cannot be empty.");
  if (requestedSeed && requestedSeed.length > 128) throw new Error("World seed must be 128 characters or fewer.");
  const entropy = requestedSeed || randomBytes(12).toString("hex");
  const seed = `prompt-${worldType}-${stableHash(`${prompt.toLowerCase()}|${entropy}`)}`;
  const worldDomainPlan = createWorldDomainPlan({
    agentPlan: options.domainPlan || null,
    baseProfile,
    prompt,
    seed,
    worldStructure,
    worldType,
  });
  let steps = materializeDomainPlanSteps({ baseProfile, plan: worldDomainPlan });
  const requestedRequirementIds = new Set(worldDomainPlan.requirements
    .filter((requirement) => ["prompt", "agent"].includes(requirement.source))
    .map((requirement) => requirement.id));
  const requestedStepIds = steps
    .filter((step) => requestedRequirementIds.has(step.domainRequirementId))
    .map((step) => step.id);
  const river = worldDomainPlan.requirements.some((requirement) => requirement.capabilityId === "hydrology.river-system");
  const projectName = `${titleCase(worldType)}${river ? " River" : " World"}`;
  const worldPlan = generateWorldPlan({
    compositionEdges: worldDomainPlan.compositionEdges,
    hasRiver: river,
    priorityStepIds: requestedStepIds,
    seed,
    steps,
    worldStructure,
    worldType,
  });
  const placements = new Map(worldPlan.placements.map((placement) => [placement.id, placement]));
  steps = steps.map((step) => {
    const placement = placements.get(step.id);
    return {
      ...step,
      position: placement.position,
      yaw: placement.yaw,
      scale: placement.scale,
      worldRole: placement.role,
    };
  });
  const generation = { ...(baseProfile.generation || {}) };
  delete generation.massiveWorld;

  return {
    ...baseProfile,
    seed,
    projectName,
    subtitle: "Prompt World / WorldFactory-Harness",
    defaultWorldType: worldType,
    defaultWorldStructure: worldStructure,
    worldDomainPlan,
    worldPlan,
    generation,
    environment: {
      ...(baseProfile.environment || {}),
      river,
    },
    guidance: {
      source: "World prompt compiler",
      instruction: `${prompt} Build, view, and validate every selected asset before committing it to the world.`,
      credit: "Compiled from a constrained natural-language request and validated by WorldFactory-Harness.",
    },
    promptCompilation: {
      schemaVersion: "nexus.world-prompt.v1",
      prompt,
      worldType,
      worldStructure,
      capabilities: worldDomainPlan.requirements.map((requirement) => requirement.capabilityId),
      domainPlanDigest: worldDomainPlan.digest,
      domainCoverage: worldDomainPlan.coverageLedger.status,
      generationMode: requestedSeed ? "reproducible-seed" : "randomized",
      requestedSeed,
      requestedStepIds,
      worldSeed: seed,
      worldPlanDigest: worldPlan.digest,
      sectorReplication: "disabled",
      selectedStepIds: steps.map((step) => step.id),
    },
    steps,
  };
}

export function worldPromptVocabulary() {
  return {
    structures: WORLD_STRUCTURES.map((structure) => structure.id),
    worldTypes: WORLD_TYPES.map((worldType) => worldType.id),
  };
}
