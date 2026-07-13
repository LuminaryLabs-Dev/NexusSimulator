# NexusSimulator Memory

## Purpose

NexusSimulator is a Node CLI for safely validating applications through replayable scenarios, focused interaction-surface adapters, disposable SimSpace runs, and normalized evidence reports.

## Architecture

- `src/cli.js` is the terminal entrypoint.
- `src/actions.js` is the shared agent-facing action layer.
- `src/runtime.js` owns local environments, append-only JSONL scenarios, capability checks, and direct replay.
- `src/simspace.js` stages disposable application copies before safe validation.
- `src/simtimes.js` registers adapters with `id`, `type`, `surface`, and `supports` metadata.
- `src/playwright-simtime.js`, `src/file-simtime.js`, and `src/human-interaction-simtime.js` keep browser, filesystem, and controller responsibilities separate.
- `src/tool-catalog.js` exposes domain tools such as `interaction.proof`.
- `interaction.proof` retains before/after screenshots, a Playwright trace, and
  a WebM session recording so external harnesses receive complete browser proof.
- `kit.contract-proof` is the external JSONL kit-contract gate. It runs 17 deterministic checks per record and writes a report plus per-record evidence without importing caller code or requiring a SimSpace application stage.
- `kit.runtime-proof` is the selected-implementation gate. It stages a kit plus Nexus Engine in disposable space, validates and installs real ESM modules, exercises declared inputs, replay, snapshot/load/reset, and declared commands, and emits an immutable report. Only a fully passing implementation becomes `runtime-proven`; integration remains external and approval-gated.
- `TerrainFactory` and `SceneFactory` are 3D-only factory roots; `SceneFactory` composes terrain generation with the existing forest/tree/leaf graph.
- `scene.build-proof` is the first build-and-prove orchestrator. It generates local factory output, stages only the generated preview in SimSpace, drives one Playwright simtime, and normalizes explicit state plus visual evidence.
- `scene.agent-showcase` runs `WorldFactory-Harness` through owner planning, Luna cross-world critique, owner revision, algorithm/seed candidate search, confidence gating, and serialized promotion. Terrain profiles must pass the configured NexusEngine TerrainKit and NexusEngine-ProtoKits banded-origin/import/grounding gate before browser output is created. `--live-loop` records a real-time library inspection followed by a flight constrained to validated streamed chunks.
- `nexus.forest-showcase.v1` profiles use a two-act build contract: every procedural asset must pass build, view, and validate in the object lab before the same factory may commit into the forest world.
- `src/forest-showcase.js` owns the procedural forest presentation, including 15 asset factories, terrain, river, instanced detail, test-lab inspection, world assembly, and cinematic camera movement.
- Forest showcase profiles define world-type palettes as data. The editor and capture runtime switch among Forest, Desert, Alpine, and Volcanic without branching the object factory graph.
- World structure is independent from biome appearance. Infinite, Patched, Bounded, Spherical, Full Spatial, Toroidal, and Layered structures use profile-declared coordinate models, parameters, guide descriptors, and requirement matrices.
- Structure validation uses generic `equals`, `min`, and regex `matches` operators over dotted data paths. Object commits remain disabled until both the selected structure and object pass.
- `scene.editor-session` records real right-side editor interactions for five to ten minutes. Objects must move through preview and validation before `Add` commits them to the active world, and reports preserve the interaction event ledger.
- Long-form editor capture uses real browser time and elapsed-time motion, then normalizes H.264 output to 24 FPS. Human capture is the default and uses a visible in-page pointer, typed input, gradual range drags, and staged detail/scale assembly. Deterministic `renderAt(time)` remains exclusive to the cinematic proof tool.
- `src/world-factory-harness.js` separates parallel planning and revision from promotion. Terra owns terrain and biomes, Sol owns lighting and atmosphere, Luna owns integration review, and every generated candidate passes profile-declared failure filters before entering the asset library. Candidate outcomes append to `.nexus-simulator/lessons/world-factory-lessons.jsonl` so later runs can bias confidence from prior evidence.
- `src/nexus-terrain-streaming-adapter.js` is the proof boundary between NexusSimulator, promoted NexusEngine TerrainKit, and experimental NexusEngine-ProtoKits contracts. It accepts repo roots from CLI flags or environment variables, records exact source lineage, and blocks capture unless chunk coverage, height seams, normal seams, snapped-origin behavior, import profiles, and grounding profiles all pass.
- Forest asset geometry uses custom indexed wound-triangle `BufferGeometry`, not built-in Three.js primitive geometries. Browser validation measures topology coverage, winding/normal consistency, degenerate triangles, lighting readability, placement clearance, silhouette readability, and performance before library promotion.
- `src/report-service.js` reads normalized run evidence without requiring callers to know artifact paths.

## Durable Conventions

- `scenario` is an app-specific workflow.
- `simtime` is one interaction-surface adapter.
- `simspace` is a disposable runtime copy.
- `tool` is a user/agent-facing validation action.
- Future fallback and composition belong in an orchestrator, not inside simtimes.
- Deterministic scene previews expose proof state through `window.__NEXUS_TEST_STATE__` and deterministic advancement through `window.__NEXUS_SIMTIME__`.
- Cinematic showcase pages expose `window.__NEXUS_SHOWCASE__.renderAt(time)` so capture renders every requested frame directly instead of accelerating checkpoint footage.
- WorldFactory agents may plan concurrently, but only the validated head commit may change the shared 3D world.
- Procedural editor validation accepts all Three.js renderable geometry categories used by the factories, including meshes, points, and lines.
- Prefer `validate` or `simspace run`; raw `scenario run` is intentional direct execution.
- Keep safe browser proofs non-destructive by default.
- Keep runtime environments, scenarios, artifacts, and SimSpace runs local and untracked.
- Never commit personal paths, credentials, real project records, or generated evidence.
- External harnesses must locate the simulator executable through their own flag, environment, or `PATH`; NexusSimulator does not encode caller checkout paths.

## Native Runtime Configuration

The optional NexusEngine runtime adapter has no machine-specific defaults. Configure paths through scenario/environment metadata or:

- `NEXUS_ENGINE_RUNTIME_EXECUTABLE`
- `NEXUS_ENGINE_PROJECT_ROOT`
- `NEXUS_ENGINE_CODEX_TOOL`
- `NEXUS_ENGINE_SESSION_PROOF_COMMAND`
- `NEXUS_ENGINE_SWING_PROOF_COMMAND`
- `NEXUS_ENGINE_WALLRUN_PROOF_COMMAND`

## Release Convention

- `main` is the source of truth.
- `0.0.1` is the frozen first public release branch; no `v0.0.1` tag is used.
- `0.0.2` starts with explicit scene build proof and remains the development lane for multi-environment execution and RPC/agent access.
- Update this file only when durable architecture or workflow decisions change.
