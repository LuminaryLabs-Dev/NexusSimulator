# 0.0.2 Scene Build Proof

Status: implemented locally

## Goal

Replace the toy visual-change fixture with a deterministic procedural 3D scene that NexusSimulator can generate, rebuild inside SimSpace, interact with, and validate through explicit assertions.

## Success Criteria

- `SceneFactory` composes terrain, forest, patch, tree, and leaf factories.
- The committed profile produces 2,401 terrain vertices, 4,608 triangles, 18 trees, and four species.
- `scene.build-proof` verifies two matching scene hashes, camera response, responsiveness, console cleanliness, and an unchanged source digest.
- An impossible tree threshold returns a failed report and nonzero exit while retaining evidence.
- Desktop and mobile human-view captures remain readable.
- The 28-second social proof video uses only retained run evidence.

## Validation

- Positive run: `1783636730764-scene-nexus-grove-002-video-proo-scene-build-proof-playwright-6034685e`
- Negative run: `1783635570747-scene-nexus-grove-002-proof-nega-scene-build-proof-playwright-3eb57d88`
- Mobile run: `1783635660173-scene-mobile-proof-scene-mobile-human-view-playwright-3371b173`

Generated run records remain local and untracked.
