import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const factoryProfileSchemaVersion = "nexus.factory-profile.v1";

const baseFactoryNames = ["LeafFactory", "TreeFactory", "FoliagePatchFactory", "ForestFactory"];
const threeOnlyFactoryNames = ["TerrainFactory", "SceneFactory"];
const factoryNames = [
  ...baseFactoryNames,
  ...baseFactoryNames.map((factoryName) => `${factoryName}2D`),
  ...threeOnlyFactoryNames,
];
const spawnSlotNames = new Set(["terrainRoot", "forestRoot", "patchPoints", "treePoints", "groundLeafPoints", "leafPoints"]);
const allowedSelectionModes = new Set(["same", "cycle", "weighted"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function is2DFactory(factoryName) {
  return String(factoryName ?? "").endsWith("2D");
}

function baseFactoryName(factoryName) {
  const value = String(factoryName ?? "");
  return value.endsWith("2D") ? value.slice(0, -2) : value;
}

function alignFactoryToParent(parentFactoryName, childFactoryName) {
  const baseName = baseFactoryName(childFactoryName);
  if (threeOnlyFactoryNames.includes(baseName)) return baseName;
  if (!baseFactoryNames.includes(baseName)) return childFactoryName;
  return is2DFactory(parentFactoryName) ? `${baseName}2D` : baseName;
}

function profileEntryId(entry) {
  return typeof entry === "string" ? entry : entry?.profile;
}

function profileEntryWeight(entry) {
  const weight = typeof entry === "string" ? 1 : Number(entry?.weight ?? 1);
  return Number.isFinite(weight) && weight > 0 ? weight : 1;
}

function selectedProfileRef(slot, index, seed) {
  const profiles = Array.isArray(slot?.profiles) ? slot.profiles : [];
  if (!profiles.length) return null;
  const selection = slot.selection ?? "same";
  if (selection === "cycle") {
    return profileEntryId(profiles[index % profiles.length]);
  }
  if (selection === "weighted") {
    const total = profiles.reduce((sum, entry) => sum + profileEntryWeight(entry), 0);
    let cursor = createRng(`${seed}:${index}`)() * total;
    for (const entry of profiles) {
      cursor -= profileEntryWeight(entry);
      if (cursor <= 0) return profileEntryId(entry);
    }
    return profileEntryId(profiles[profiles.length - 1]);
  }
  return profileEntryId(profiles[0]);
}

function mergeSettings(...parts) {
  return parts.reduce((merged, part) => {
    if (!isObject(part)) return merged;
    return { ...merged, ...part };
  }, {});
}

function normalizePoint(point, index, fallbackPrefix) {
  const source = isObject(point) ? point : {};
  const id = slug(source.id ?? `${fallbackPrefix}-${String(index + 1).padStart(3, "0")}`);
  return {
    ...source,
    id,
    position: isObject(source.position) ? source.position : source.position ?? null,
    rotation: isObject(source.rotation) ? source.rotation : source.rotation ?? null,
    scale: source.scale ?? null,
    settings: isObject(source.settings) ? source.settings : {},
  };
}

function summarizeConfig(config) {
  if (!config) {
    return {
      enabled: false,
      profileCount: 0,
      rootSpawnSlots: [],
    };
  }
  return {
    enabled: true,
    factory: config.factory ?? null,
    profile: config.profile ?? null,
    profileCount: Object.keys(config.profiles ?? {}).length,
    rootSpawnSlots: Object.keys(config.spawnSlots ?? {}),
    schemaVersion: config.schemaVersion ?? null,
  };
}

function validateSpawnSlot(errors, warnings, slot, path, profiles) {
  if (!isObject(slot)) {
    errors.push(`${path} must be an object.`);
    return;
  }
  if (slot.factory !== undefined && !factoryNames.includes(slot.factory) && !baseFactoryNames.includes(baseFactoryName(slot.factory))) {
    errors.push(`${path}.factory must be a known factory name.`);
  }
  const selection = slot.selection ?? "same";
  if (!allowedSelectionModes.has(selection)) {
    errors.push(`${path}.selection must be one of: ${Array.from(allowedSelectionModes).join(", ")}.`);
  }
  if (slot.profiles !== undefined && !Array.isArray(slot.profiles)) {
    errors.push(`${path}.profiles must be an array when present.`);
  }
  for (const [index, entry] of (slot.profiles ?? []).entries()) {
    const id = profileEntryId(entry);
    if (!id) errors.push(`${path}.profiles[${index}] must be a profile id or { profile, weight } object.`);
    if (id && !profiles[id]) errors.push(`${path}.profiles[${index}] references missing profile "${id}".`);
  }
  if (slot.points !== undefined && !Array.isArray(slot.points)) {
    errors.push(`${path}.points must be an array when present.`);
  }
  if (slot.count !== undefined) {
    const count = Number(slot.count);
    if (!Number.isInteger(count) || count <= 0) errors.push(`${path}.count must be a positive integer.`);
  }
  if (slot.factory?.endsWith("2D")) {
    warnings.push(`${path}.factory explicitly requests a 2D child; parent renderer suffix will still be enforced at runtime.`);
  }
}

export function validateFactoryConfig(config) {
  const errors = [];
  const warnings = [];
  if (!isObject(config)) {
    return {
      errors: ["Config must be a JSON object."],
      summary: summarizeConfig(null),
      valid: false,
      warnings,
    };
  }
  if (config.schemaVersion !== factoryProfileSchemaVersion) {
    errors.push(`schemaVersion must be "${factoryProfileSchemaVersion}".`);
  }
  if (config.factory !== undefined && !factoryNames.includes(config.factory)) {
    errors.push(`factory must be one of: ${factoryNames.join(", ")}.`);
  }
  if (config.settings !== undefined && !isObject(config.settings)) {
    errors.push("settings must be an object when present.");
  }
  if (config.profiles !== undefined && !isObject(config.profiles)) {
    errors.push("profiles must be an object when present.");
  }
  const profiles = isObject(config.profiles) ? config.profiles : {};
  for (const [profileId, profile] of Object.entries(profiles)) {
    if (!isObject(profile)) {
      errors.push(`profiles.${profileId} must be an object.`);
      continue;
    }
    if (profile.factory !== undefined && !factoryNames.includes(profile.factory) && !baseFactoryNames.includes(baseFactoryName(profile.factory))) {
      errors.push(`profiles.${profileId}.factory must be a known factory name.`);
    }
    if (profile.settings !== undefined && !isObject(profile.settings)) {
      errors.push(`profiles.${profileId}.settings must be an object when present.`);
    }
    if (profile.spawnSlots !== undefined && !isObject(profile.spawnSlots)) {
      errors.push(`profiles.${profileId}.spawnSlots must be an object when present.`);
    }
    for (const [slotName, slot] of Object.entries(profile.spawnSlots ?? {})) {
      if (!spawnSlotNames.has(slotName)) warnings.push(`profiles.${profileId}.spawnSlots.${slotName} is not a standard foliage slot.`);
      validateSpawnSlot(errors, warnings, slot, `profiles.${profileId}.spawnSlots.${slotName}`, profiles);
    }
  }
  if (config.spawnSlots !== undefined && !isObject(config.spawnSlots)) {
    errors.push("spawnSlots must be an object when present.");
  }
  for (const [slotName, slot] of Object.entries(config.spawnSlots ?? {})) {
    if (!spawnSlotNames.has(slotName)) warnings.push(`spawnSlots.${slotName} is not a standard foliage slot.`);
    validateSpawnSlot(errors, warnings, slot, `spawnSlots.${slotName}`, profiles);
  }
  const maxDepth = Number(config.settings?.maxDepth ?? 8);
  if (!Number.isFinite(maxDepth) || maxDepth < 1 || maxDepth > 12) {
    errors.push("settings.maxDepth must be between 1 and 12 when present.");
  }
  const fanoutBudget = Number(config.settings?.fanoutBudget ?? 400);
  if (!Number.isFinite(fanoutBudget) || fanoutBudget < 1 || fanoutBudget > 1500) {
    errors.push("settings.fanoutBudget must be between 1 and 1500 when present.");
  }
  return {
    errors,
    summary: summarizeConfig(config),
    valid: errors.length === 0,
    warnings,
  };
}

export function loadFactoryConfig(path) {
  const sourcePath = resolve(path);
  let config;
  try {
    config = JSON.parse(readFileSync(sourcePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read factory config ${sourcePath}: ${error.message}`);
  }
  const validation = validateFactoryConfig(config);
  if (!validation.valid) {
    throw new Error(`Invalid factory config ${sourcePath}: ${validation.errors.join("; ")}`);
  }
  return {
    config,
    sourcePath,
    validation,
  };
}

export function createProfileContext(config = null, rootCallId = null) {
  const validation = config ? validateFactoryConfig(config) : {
    errors: [],
    summary: summarizeConfig(null),
    valid: true,
    warnings: [],
  };
  if (!validation.valid) {
    throw new Error(`Invalid factory config: ${validation.errors.join("; ")}`);
  }
  return {
    config,
    profileGraph: {
      rootProfile: config?.profile ?? null,
      profiles: Object.entries(config?.profiles ?? {}).map(([id, profile]) => ({
        factory: profile.factory ?? null,
        id,
        spawnSlots: Object.keys(profile.spawnSlots ?? {}),
      })),
      rootSpawnSlots: Object.keys(config?.spawnSlots ?? {}),
      schemaVersion: config?.schemaVersion ?? null,
    },
    profiles: config?.profiles ?? {},
    rootCallId,
    spawnPlan: [],
    summary: validation.summary,
    validation,
  };
}

export function resolveFactoryProfile(config, rootCall) {
  const context = createProfileContext(config, rootCall.callId);
  const profileRecord = context.profiles[rootCall.profile] ?? null;
  const call = {
    ...rootCall,
    profileRef: profileRecord ? rootCall.profile : rootCall.profileRef ?? null,
    settings: mergeSettings(profileRecord?.settings, rootCall.settings),
  };
  return {
    call,
    context,
    profileGraph: context.profileGraph,
    summary: context.summary,
  };
}

function slotForCall(context, call, slotName) {
  if (!context?.config) return null;
  if (call.callId === context.rootCallId && context.config.spawnSlots?.[slotName]) {
    return context.config.spawnSlots[slotName];
  }
  if (call.settings?.spawnSlots?.[slotName]) {
    return call.settings.spawnSlots[slotName];
  }
  const profileRef = call.profileRef ?? (context.profiles[call.profile] ? call.profile : null);
  return profileRef ? context.profiles[profileRef]?.spawnSlots?.[slotName] ?? null : null;
}

export function resolveSpawnSlots(context, call, slotName, generatedAnchors = [], fallbackCalls = []) {
  const slot = slotForCall(context, call, slotName);
  if (!slot) {
    const fallback = fallbackCalls.map((fallbackCall, index) => {
      const point = normalizePoint(generatedAnchors[index] ?? {}, index, slotName);
      const spawnId = fallbackCall.spawnId ?? point.id;
      const spawnPath = fallbackCall.spawnPath ?? [call.spawnPath, slotName, spawnId].filter(Boolean).join("/");
      return {
        call: {
          ...fallbackCall,
          spawnId,
          spawnPath,
          position: fallbackCall.position ?? point.position ?? null,
          rotation: fallbackCall.rotation ?? point.rotation ?? null,
          scale: fallbackCall.scale ?? point.scale ?? null,
        },
        point,
        profileRef: fallbackCall.profileRef ?? null,
        slotName,
      };
    });
    context?.spawnPlan?.push({
      mode: "fallback",
      parentCallId: call.callId,
      slotName,
      spawns: fallback.map((spawn) => ({
        callId: spawn.call.callId,
        factory: spawn.call.factory,
        profile: spawn.call.profile,
        profileRef: spawn.call.profileRef ?? null,
        spawnId: spawn.call.spawnId,
        spawnPath: spawn.call.spawnPath,
      })),
    });
    return fallback;
  }

  const sourcePoints = Array.isArray(slot.points) && slot.points.length
    ? slot.points
    : generatedAnchors;
  const count = slot.count ? Math.min(Number(slot.count), sourcePoints.length) : sourcePoints.length;
  const points = sourcePoints.slice(0, count).map((point, index) => normalizePoint(point, index, slotName));
  const spawns = points.map((point, index) => {
    const fallbackCall = fallbackCalls[index] ?? {};
    const explicitProfile = point.profile ?? null;
    const profileRef = explicitProfile ?? selectedProfileRef(slot, index, `${call.seed}:${slotName}`);
    const profileRecord = profileRef ? context.profiles[profileRef] ?? null : null;
    const baseChildFactory = point.factory ?? profileRecord?.factory ?? slot.factory ?? fallbackCall.factory;
    const childFactory = alignFactoryToParent(call.factory, baseChildFactory);
    const spawnId = point.id;
    const spawnPath = [call.spawnPath, slotName, spawnId].filter(Boolean).join("/");
    const seed = point.seed ?? `${call.seed}/${slotName}-${spawnId}`;
    const settings = mergeSettings(
      fallbackCall.settings,
      profileRecord?.settings,
      slot.settings,
      point.settings,
    );
    return {
      call: {
        ...fallbackCall,
        callId: fallbackCall.callId ?? `${slug(call.callId)}-${slug(spawnId)}`,
        depth: fallbackCall.depth ?? call.depth + 1,
        factory: childFactory,
        fanoutBudget: fallbackCall.fanoutBudget,
        maxDepth: fallbackCall.maxDepth ?? call.maxDepth,
        parentCallId: call.callId,
        position: point.position,
        profile: profileRef ?? fallbackCall.profile ?? `${call.profile}-${slotName}`,
        profileRef,
        rotation: point.rotation,
        scale: point.scale,
        seed,
        settings,
        spawnId,
        spawnPath,
      },
      point,
      profileRef,
      slotName,
    };
  });
  context?.spawnPlan?.push({
    mode: "configured",
    parentCallId: call.callId,
    parentProfileRef: call.profileRef ?? null,
    slotName,
    spawns: spawns.map((spawn) => ({
      callId: spawn.call.callId,
      factory: spawn.call.factory,
      profile: spawn.call.profile,
      profileRef: spawn.call.profileRef,
      seed: spawn.call.seed,
      spawnId: spawn.call.spawnId,
      spawnPath: spawn.call.spawnPath,
    })),
  });
  return spawns;
}
