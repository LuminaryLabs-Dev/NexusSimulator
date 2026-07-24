const PRIMARY_SOURCES = Object.freeze({
  hydrology: Object.freeze({
    id: "genevaux-hydrology-terrain-2013",
    title: "Terrain Generation Using Procedural Models Based on Hydrology",
    url: "https://doi.org/10.1145/2461912.2461996",
    use: "Drainage graphs, river paths, terrain primitives, blending, and carving.",
  }),
  pbr: Object.freeze({
    id: "burley-disney-pbr-2012",
    title: "Physically-Based Shading at Disney",
    url: "https://disneyanimation.com/publications/physically-based-shading-at-disney/",
    use: "A robust principled material model with compact artistic controls.",
  }),
  trees: Object.freeze({
    id: "runions-space-colonization-2007",
    title: "Modeling Trees with a Space Colonization Algorithm",
    url: "https://algorithmicbotany.org/papers/colonization.egwnp2007.html",
    use: "Branch growth toward attraction points inside a crown envelope.",
  }),
});

const CATALOG = Object.freeze({
  terrainPatch: [
    ["hydrology-construction-tree", "Drainage graph + analytic terrain primitives + blend/carve operators", "hydrology", ["river", "desert", "alpine"]],
    ["ridged-noise", "Ridged multi-octave displacement with bounded slope remapping", "hydrology", ["alpine", "volcanic"]],
    ["cellular-shelf", "Cellular regions relaxed into erosion-aware shelves", "hydrology", ["desert", "volcanic"]],
  ],
  oak: [
    ["space-colonized", "Attraction points iteratively pull branch nodes through a crown envelope", "trees", ["forest"]],
    ["radial-branch", "Pipe-model taper over radial branching with bounded stochastic deviation", "trees", ["forest"]],
    ["crown-biased", "Directional branching weighted toward unoccupied crown volume", "trees", ["forest"]],
  ],
  birch: [
    ["space-colonized", "Attraction points iteratively pull branch nodes through narrow crown envelopes", "trees", ["forest", "alpine"]],
    ["cluster-rhythm", "Poisson-like trunk clusters with alternating branch phyllotaxis", "trees", ["forest", "alpine"]],
    ["canopy-gap", "Crown growth avoids occupied spatial cells to preserve readable gaps", "trees", ["forest"]],
  ],
  pine: [
    ["whorled-branch", "Branch whorls follow vertical growth intervals and radial phyllotaxis", "trees", ["alpine", "forest"]],
    ["space-colonized", "Attraction points are constrained to a conical crown envelope", "trees", ["alpine", "forest"]],
    ["silhouette-stack", "Tapered conical layers preserve the dominant evergreen silhouette", "trees", ["alpine"]],
  ],
  willow: [
    ["space-colonized", "Attraction points form a broad crown before gravity-biased terminal growth", "trees", ["river", "forest", "desert"]],
    ["droop-field", "Branch endpoints are displaced by a gravity field with length-dependent sag", "trees", ["river"]],
    ["bank-lean", "Growth direction combines light attraction with a riverbank avoidance normal", "trees", ["river"]],
  ],
  boulders: [
    ["voronoi-rock", "A convex low-poly shell is displaced by seeded Voronoi distance fields", "hydrology", ["desert", "alpine", "volcanic"]],
    ["erosion-cluster", "Seeded rock cells are rounded by bounded erosion and deposition passes", "hydrology", ["river", "desert"]],
    ["faceted-radial", "A radial shell uses low-frequency displacement while retaining planar facets", "hydrology", ["forest"]],
  ],
  crystals: [
    ["growth-axis", "Seeded axes grow tapered prisms under minimum-separation constraints", null, ["volcanic"]],
    ["fractured-cluster", "A parent volume is split along seeded planes into separated shards", null, ["volcanic"]],
    ["radial-spire", "Spire axes radiate from a shared base with bounded angular variance", null, []],
  ],
  shrine: [
    ["post-and-lintel", "Load paths are assembled from vertical supports and horizontal spans", null, []],
    ["radial-sanctum", "Repeated modules are placed on a radial symmetry group", null, []],
    ["stacked-frame", "Nested structural frames follow a stable base-to-roof hierarchy", null, []],
  ],
  arch: [
    ["voussoir-arc", "Wedge blocks are sampled along a semicircular compression curve", null, []],
    ["catenary-arch", "Blocks follow y = a cosh(x/a) under an inverted catenary profile", null, []],
    ["weathered-span", "An arch profile receives bounded seeded edge erosion", "hydrology", []],
  ],
  bridge: [
    ["catenary-plank", "Suspension guides follow y = a cosh(x/a) with evenly sampled deck points", null, ["river"]],
    ["beam-span", "Deck modules satisfy span, clearance, and support interval constraints", null, ["river"]],
    ["stepped-crossing", "Crossing stones follow a sampled river-normal path with clearance checks", "hydrology", ["river"]],
  ],
  waterfall: [
    ["erosion-channel", "Water follows decreasing elevation and carves a bounded channel", "hydrology", ["river"]],
    ["strata-cascade", "Flow descends through layered elevation discontinuities", "hydrology", ["river", "alpine"]],
    ["tiered-fall", "A monotonic height sequence creates stable pool-and-drop tiers", "hydrology", ["river"]],
  ],
  mushrooms: [
    ["ring-poisson", "Poisson-disk samples are projected into an annular growth region", null, ["forest"]],
    ["mycelial-band", "Cluster density follows a noisy band around a buried radial network", null, ["forest"]],
    ["radial-cluster", "Instances use bounded radial jitter and scale variation", null, ["forest"]],
  ],
  fireflies: [
    ["boid-cloud", "Local separation, alignment, and cohesion update a bounded swarm", null, ["forest"]],
    ["curl-swarm", "Particles follow a divergence-reduced curl field", null, ["forest"]],
    ["noise-drift", "Seeded smooth noise perturbs particles around fixed attractors", null, []],
  ],
  lantern: [
    ["frame-lattice", "A load-bearing frame is generated from an orthogonal lattice", null, []],
    ["wound-cage", "A low-poly cage is wound around a bounded luminous volume", null, []],
    ["cantilever-light", "A post and cantilever satisfy reach and center-of-mass constraints", null, []],
  ],
  monolith: [
    ["layered-seal", "Nested slabs preserve a stable base and readable silhouette", null, []],
    ["faceted-pillar", "A tapered prism receives bounded planar displacement", null, []],
    ["rune-slab", "A low-poly slab reserves material-space channels for surface detail", null, []],
  ],
});

const SKINS = Object.freeze({
  alpine: { baseColor: "#9ca8a2", accent: "#d9e3de", roughness: 0.82, metalness: 0.02 },
  desert: { baseColor: "#c49a62", accent: "#dfbd82", roughness: 0.88, metalness: 0.01 },
  forest: { baseColor: "#496b4d", accent: "#769c62", roughness: 0.86, metalness: 0.01 },
  volcanic: { baseColor: "#343934", accent: "#8d4d39", roughness: 0.78, metalness: 0.08 },
});

function promptOverrides(prompt) {
  const text = String(prompt || "").toLowerCase();
  const highPoly = /\bhigh[ -]?poly\b|\bdense geometry\b/.test(text);
  const flat = /\bflat[ -]?shaded\b|\buntextured\b|\bno textures?\b/.test(text);
  return {
    geometryDetail: highPoly ? "high-poly" : "low-poly",
    materialMode: flat ? "flat-material" : "procedural-pbr",
  };
}

function researchAlgorithms(step, profile) {
  const worldType = profile.defaultWorldType || "forest";
  const semanticTags = new Set((profile.worldDomainPlan?.requirements || []).flatMap((requirement) => [
    ...String(requirement.capabilityId || "").split(/[.-]/),
    ...String(requirement.domainPath || "").split("/"),
  ]));
  const catalog = CATALOG[step.type] || [];
  const candidates = catalog.length
    ? catalog
    : (profile.generation?.algorithms?.[step.type] || []).map((id) => [id, "Profile-declared seeded procedural construction", null, []]);
  return candidates.map(([id, math, sourceId, tags], index) => {
    const tagScore = tags.reduce((score, tag) => score + (tag === worldType || semanticTags.has(tag) ? 8 : 0), 0);
    return {
      id,
      math,
      score: 100 - index * 5 + tagScore,
      source: sourceId ? PRIMARY_SOURCES[sourceId] : null,
      tags,
    };
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
}

export function applyNaturalGenerationPolicy(inputProfile, prompt = null) {
  const profile = structuredClone(inputProfile);
  const overrides = promptOverrides(prompt || profile.promptCompilation?.prompt || "");
  const skin = SKINS[profile.defaultWorldType] || SKINS.forest;
  const research = profile.steps.map((step) => ({
    objectId: step.id,
    objectType: step.type,
    query: `${profile.defaultWorldType} ${step.type} natural procedural geometry math`,
    candidates: researchAlgorithms(step, profile),
  }));
  const byType = Object.fromEntries(research.map((entry) => [entry.objectType, entry.candidates.map((candidate) => candidate.id)]));

  profile.generation = {
    ...(profile.generation || {}),
    algorithms: { ...(profile.generation?.algorithms || {}), ...byType },
  };
  profile.generationPolicy = {
    schemaVersion: "nexus.natural-generation-policy.v1",
    scratch: {
      projectTemplate: "blank-nexus-engine-project",
      reusePriorProject: false,
      reusePriorWorldState: false,
      reusePriorGeometry: false,
      reusePriorTextures: false,
      reusePriorGenerationLessons: false,
    },
    algorithmSearch: {
      mode: "ranked-primary-source-catalog",
      missingAlgorithm: "fail",
      sources: Object.values(PRIMARY_SOURCES),
      research,
    },
    geometry: {
      mode: "fresh-procedural-math",
      detail: overrides.geometryDetail,
      topology: overrides.geometryDetail === "low-poly" ? "custom-low-poly-triangles" : "custom-dense-triangles",
      maximumTrianglesPerAsset: overrides.geometryDetail === "low-poly" ? 5000 : 50000,
      highDetailRule: overrides.geometryDetail === "low-poly" ? "move-detail-to-materials" : "geometry-allowed",
    },
    appearance: {
      mode: overrides.materialMode,
      stage: "reskin-after-geometry",
      materialModel: overrides.materialMode === "procedural-pbr" ? "principled-pbr" : "flat",
      textureChannels: overrides.materialMode === "procedural-pbr" ? ["baseColor", "normal", "packedSurface", "height"] : [],
      targetTextureResolution: overrides.materialMode === "procedural-pbr" ? 2048 : 0,
      runtimeFallbackResolution: overrides.materialMode === "procedural-pbr" ? 512 : 0,
      compression: overrides.materialMode === "procedural-pbr" ? "ktx2-basis-preferred" : "none",
      mapping: "triplanar",
      skin: { id: `${profile.defaultWorldType}-pbr-skin`, ...skin },
      source: PRIMARY_SOURCES.pbr,
    },
    composition: {
      isolateEachKit: true,
      requireIndividualPass: true,
      composePassingKitsOnly: true,
      finalEngine: "fresh-instance",
    },
  };
  profile.steps = profile.steps.map((step) => {
    const entry = research.find((item) => item.objectId === step.id);
    return {
      ...step,
      generationRecipe: {
        schemaVersion: "nexus.world-generation-recipe.v1",
        geometry: profile.generationPolicy.geometry,
        algorithmCandidates: entry.candidates,
        skin: profile.generationPolicy.appearance,
      },
    };
  });
  return profile;
}

export function naturalGenerationSources() {
  return Object.values(PRIMARY_SOURCES).map((source) => ({ ...source }));
}
