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

function createRandom(seed) {
  let state = hashNumber(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random, minimum, maximum) {
  return minimum + random() * (maximum - minimum);
}

function rounded(value, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function distance(left, right) {
  return Math.hypot(left[0] - right[0], left[2] - right[2]);
}

function riverXAt(river, z) {
  if (!river) return 0;
  return river.offset
    + Math.sin(z * river.frequency + river.phase) * river.amplitude
    + Math.sin(z * river.secondaryFrequency + river.secondaryPhase) * river.secondaryAmplitude;
}

function riverYawAt(river, z) {
  const delta = 0.05;
  const dx = riverXAt(river, z + delta) - riverXAt(river, z - delta);
  return Math.atan2(dx, delta * 2);
}

function placementRecord(step, position, yaw, scale, role) {
  return {
    id: step.id,
    position: position.map((value) => rounded(value)),
    yaw: rounded(yaw),
    scale: rounded(scale),
    role,
  };
}

function sampleOpenPosition({ bounds, minimumClearance, occupied, random, river, y }) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const candidate = [between(random, bounds.minX, bounds.maxX), y, between(random, bounds.minZ, bounds.maxZ)];
    const riverClearance = river ? Math.abs(candidate[0] - riverXAt(river, candidate[2])) : Infinity;
    if (riverClearance < (river?.width || 0) * 0.5 + 0.9) continue;
    if (occupied.every((entry) => distance(candidate, entry) >= minimumClearance)) return candidate;
  }
  throw new Error("World planner could not find a clear placement inside the generated bounds.");
}

function sampleRelatedPosition({ bounds, minimumClearance, occupied, random, river, target, y }) {
  for (let attempt = 0; attempt < 96; attempt += 1) {
    const angle = between(random, -Math.PI, Math.PI);
    const radius = between(random, 2.75, 3.55);
    const candidate = [target[0] + Math.sin(angle) * radius, y, target[2] + Math.cos(angle) * radius];
    if (candidate[0] < bounds.minX || candidate[0] > bounds.maxX || candidate[2] < bounds.minZ || candidate[2] > bounds.maxZ) continue;
    const riverClearance = river ? Math.abs(candidate[0] - riverXAt(river, candidate[2])) : Infinity;
    if (riverClearance < (river?.width || 0) * 0.5 + 0.9) continue;
    if (occupied.every((entry) => distance(candidate, entry) >= minimumClearance)) return candidate;
  }
  return null;
}

function validatePlan(plan, stepIds) {
  const failures = [];
  const placementIds = new Set(plan.placements.map((placement) => placement.id));
  for (const id of stepIds) if (!placementIds.has(id)) failures.push(`missing-placement:${id}`);
  for (const placement of plan.placements) {
    if (!placement.position.every(Number.isFinite)) failures.push(`non-finite-placement:${placement.id}`);
    const [x, , z] = placement.position;
    if (placement.id !== "terrain-patch" && (x < plan.bounds.minX || x > plan.bounds.maxX || z < plan.bounds.minZ || z > plan.bounds.maxZ)) {
      failures.push(`out-of-bounds:${placement.id}`);
    }
  }
  const occupied = plan.placements.filter((placement) => placement.id !== "terrain-patch");
  for (let left = 0; left < occupied.length; left += 1) {
    for (let right = left + 1; right < occupied.length; right += 1) {
      if (distance(occupied[left].position, occupied[right].position) < 0.8) {
        failures.push(`placement-overlap:${occupied[left].id}:${occupied[right].id}`);
      }
    }
  }
  if (plan.river && plan.river.path.length < 8) failures.push("river-path-too-short");
  return { passed: failures.length === 0, failures };
}

export function generateWorldPlan({ compositionEdges = [], hasRiver, priorityStepIds = [], seed, steps, worldStructure, worldType }) {
  const random = createRandom(`${seed}:${worldType}:${worldStructure}`);
  const bounds = { minX: -8.4, maxX: 8.4, minZ: -7.2, maxZ: 7.2 };
  const focusBounds = { minX: -4.8, maxX: 4.8, minZ: -4.6, maxZ: 4.6 };
  const priorityIds = new Set(priorityStepIds);
  const terrain = {
    algorithm: "seeded-multi-frequency-heightfield",
    amplitudeX: rounded(between(random, 0.28, 0.62)),
    amplitudeZ: rounded(between(random, 0.24, 0.58)),
    diagonalAmplitude: rounded(between(random, 0.1, 0.3)),
    frequencyX: rounded(between(random, 0.21, 0.48)),
    frequencyZ: rounded(between(random, 0.23, 0.51)),
    diagonalFrequency: rounded(between(random, 0.48, 0.92)),
    phaseX: rounded(between(random, 0, Math.PI * 2)),
    phaseZ: rounded(between(random, 0, Math.PI * 2)),
    diagonalPhase: rounded(between(random, 0, Math.PI * 2)),
    riverValleyDepth: rounded(between(random, 0.58, 0.94)),
  };
  const river = hasRiver ? {
    algorithm: "seeded-meandering-centerline",
    offset: rounded(between(random, -1.5, 1.5)),
    amplitude: rounded(between(random, 1.1, 2.55)),
    frequency: rounded(between(random, 0.2, 0.39)),
    phase: rounded(between(random, 0, Math.PI * 2)),
    secondaryAmplitude: rounded(between(random, 0.18, 0.58)),
    secondaryFrequency: rounded(between(random, 0.48, 0.82)),
    secondaryPhase: rounded(between(random, 0, Math.PI * 2)),
    width: rounded(between(random, 1.45, 2.35)),
  } : null;
  if (river) {
    river.path = Array.from({ length: 21 }, (_, index) => {
      const z = bounds.minZ - 1.8 + index / 20 * (bounds.maxZ - bounds.minZ + 3.6);
      return { x: rounded(riverXAt(river, z)), z: rounded(z) };
    });
  }
  const trail = {
    algorithm: "seeded-curved-route",
    offset: rounded(between(random, -2.1, 2.1)),
    amplitude: rounded(between(random, 0.65, 1.75)),
    frequency: rounded(between(random, 0.22, 0.46)),
    phase: rounded(between(random, 0, Math.PI * 2)),
  };

  const placements = new Map();
  const occupied = [];
  const byType = (type) => steps.find((step) => step.type === type);
  const byRequirement = (id) => steps.find((step) => step.domainRequirementId === id);
  const add = (step, position, yaw, scale, role) => {
    if (!step || placements.has(step.id)) return;
    const placement = placementRecord(step, position, yaw, scale, role);
    placements.set(step.id, placement);
    if (step.type !== "terrainPatch") occupied.push(placement.position);
  };

  add(byType("terrainPatch"), [0, 0, 0], 0, 1, "world-foundation");
  if (river) {
    const bridge = byType("bridge");
    const bridgeZ = between(random, 0.5, 3.8);
    add(bridge, [riverXAt(river, bridgeZ), bridge?.position?.[1] || 0.35, bridgeZ], riverYawAt(river, bridgeZ) + Math.PI / 2, between(random, 0.88, 1.16), "river-crossing");

    const waterfall = byType("waterfall");
    const waterfallZ = between(random, bounds.minZ + 0.2, bounds.minZ + 1.35);
    add(waterfall, [riverXAt(river, waterfallZ), waterfall?.position?.[1] || 0.2, waterfallZ], riverYawAt(river, waterfallZ), between(random, 0.88, 1.15), "river-source");

    const willow = byType("willow");
    const willowZ = between(random, -3.6, -0.8);
    const bankSide = random() < 0.5 ? -1 : 1;
    add(willow, [riverXAt(river, willowZ) + bankSide * (river.width * 0.5 + 2.25), willow?.position?.[1] || 0.05, willowZ], between(random, 0, Math.PI * 2), between(random, 0.82, 1.2), "riparian-bank");

    const boulders = byType("boulders");
    const boulderZ = between(random, 3.9, 6.1);
    const boulderSide = random() < 0.5 ? -1 : 1;
    add(boulders, [riverXAt(river, boulderZ) + boulderSide * (river.width * 0.5 + 1.65), boulders?.position?.[1] || 0.2, boulderZ], between(random, 0, Math.PI * 2), between(random, 0.82, 1.18), "riverbank-detail");
  }

  for (const edge of compositionEdges.filter((entry) => entry.relationship === "frames-approach-to")) {
    const frame = byRequirement(edge.from);
    const target = byRequirement(edge.to);
    if (!frame || !target) continue;
    if (!placements.has(target.id)) {
      const targetPosition = sampleOpenPosition({
        bounds: focusBounds,
        minimumClearance: 2.3,
        occupied,
        random,
        river,
        y: Number(target.position?.[1] || 0),
      });
      add(target, targetPosition, between(random, -Math.PI, Math.PI), between(random, 0.92, 1.12), "composed-landmark-focus");
    }
    if (!placements.has(frame.id)) {
      const targetPosition = placements.get(target.id).position;
      const framePosition = sampleRelatedPosition({
        bounds: focusBounds,
        minimumClearance: 2.25,
        occupied,
        random,
        river,
        target: targetPosition,
        y: Number(frame.position?.[1] || 0),
      });
      if (framePosition) {
        const yaw = Math.atan2(targetPosition[0] - framePosition[0], targetPosition[2] - framePosition[2]);
        add(frame, framePosition, yaw, between(random, 0.94, 1.12), "frames-landmark-approach");
      }
    }
  }

  const openSteps = steps
    .filter((step) => !placements.has(step.id))
    .sort((left, right) => Number(priorityIds.has(right.id)) - Number(priorityIds.has(left.id)));
  for (const step of openSteps) {
    if (placements.has(step.id)) continue;
    const y = Number(step.position?.[1] || 0);
    const isPriority = priorityIds.has(step.id);
    const position = sampleOpenPosition({
      bounds: isPriority ? focusBounds : bounds,
      minimumClearance: isPriority ? 2.3 : 2.05,
      occupied,
      random,
      river,
      y,
    });
    add(
      step,
      position,
      between(random, -Math.PI, Math.PI),
      between(random, 0.82, 1.2),
      isPriority ? "requested-feature-focus" : "generated-open-placement",
    );
  }

  const orderedPlacements = steps.map((step) => placements.get(step.id));
  const plan = {
    schemaVersion: "nexus.generated-world-plan.v1",
    seed,
    algorithm: "seeded-description-constrained-layout",
    worldType,
    worldStructure,
    bounds,
    focusBounds,
    priorityStepIds: [...priorityIds],
    compositionEdges,
    terrain,
    river,
    trail,
    placements: orderedPlacements,
  };
  plan.digest = stableHash(JSON.stringify(plan));
  plan.validation = validatePlan(plan, steps.map((step) => step.id));
  if (!plan.validation.passed) throw new Error(`Generated world plan failed: ${plan.validation.failures.join(", ")}`);
  return plan;
}
