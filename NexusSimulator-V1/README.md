# NexusSimulator 0.0.2 Development

Safe application validation through disposable SimSpace runs and focused interaction surfaces.

```bash
git clone https://github.com/LuminaryLabs-Dev/NexusSimulator.git
cd NexusSimulator/NexusSimulator-V1
npm install
npx playwright install chromium
node ./src/cli.js validate <path> --tool interaction.proof
```

Validate KitUniverse-style JSONL contracts without staging an application:

```bash
node ./src/cli.js tools run kit.contract-proof \
  --input /path/to/candidates.jsonl \
  --output /path/to/simulator-report.json \
  --run-id kit-batch-001
```

`kit.contract-proof` emits 17 deterministic checks per record covering atomic
ownership, namespaced interfaces, input/output alignment, replay idempotency,
snapshot/reset lifecycle coverage, renderer isolation, and contract tests. It
accepts arbitrary JSONL input and writes evidence beside the requested report,
so external batch harnesses can gate each kit without importing simulator code.

Runtime-prove a selected implementation in disposable SimSpace:

```bash
node ./src/cli.js tools run kit.runtime-proof \
  --manifest /path/to/runtime-proof-manifest.json \
  --output /path/to/runtime-proof-report.json
```

`kit.runtime-proof` stages the kit and Nexus Engine, validates the real
`defineDomainServiceKit()` descriptor, imports and installs both ESM modules,
feeds declared inputs through the kit proof adapter, verifies output/state
transitions and duplicate replay, exercises snapshot/load/reset, and runs
syntax, public-import, package, and manifest-declared test commands. A passing
implementation advances from `proof-only` to `runtime-proven`; the immutable
report does not integrate the kit into Nexus Engine.

Build and prove the included deterministic procedural scene:

```bash
node ./src/cli.js tools run scene.build-proof \
  --profile ./profiles/procedural-grove-scene.json \
  --run-id nexus-grove-002
```

`scene.build-proof` generates terrain and a recursive forest graph, stages the preview inside SimSpace, performs two deterministic builds, checks camera input and scene state, and returns screenshots, video, console evidence, source digests, and a normalized report.

Run the WorldFactory-Harness showcase with three read-only Codex planning lanes:

```bash
node ./src/cli.js tools run scene.agent-showcase \
  --profile ./profiles/world-factory-harness.json \
  --run-id worldfactory-harness \
  --viewport 1920x1080 \
  --fps 30 \
  --duration 15 \
  --use-codex
```

Sol, Terra, and Luna plan concurrently, Luna performs a cross-world critique, and each owner receives a second Codex call for bounded revision. WorldFactory-Harness then searches profile-declared algorithms and seeds, rejects candidates through the failure-filter matrix, promotes only candidates above the confidence threshold, and records every outcome in the durable lesson ledger.

The 30-second forest profile adds a two-act proof: build, view, and validate 15 procedural assets in the object lab, then commit the same asset factories into a complete forest world.

```bash
node ./src/cli.js tools run scene.agent-showcase \
  --profile ./profiles/world-factory-forest.json \
  --run-id worldfactory-forest \
  --viewport 1920x1080 \
  --fps 30 \
  --nexus-engine-root /path/to/NexusEngine \
  --nexus-protokits-root /path/to/NexusEngine-ProtoKits
```

Record the real-time library and massive-world proof as one uninterrupted minute:

```bash
node ./src/cli.js tools run scene.agent-showcase \
  --profile ./profiles/world-factory-forest.json \
  --run-id worldfactory-library-flight \
  --viewport 1920x1080 \
  --duration 60 \
  --fps 24 \
  --nexus-engine-root /path/to/NexusEngine \
  --nexus-protokits-root /path/to/NexusEngine-ProtoKits \
  --use-codex \
  --live-loop \
  --output ./worldfactory-library-flight.mp4
```

The first half inspects rejected and promoted candidates one asset at a time. Before any browser or recording starts, the harness loads TerrainKit from NexusEngine and the banded-terrain, object-import-profile, and object-grounding-profile contracts from NexusEngine-ProtoKits. It rejects missing streaming coverage, shared-edge height or normal discontinuities, invalid snapped-origin behavior, and invalid grounding. The second half renders only those validated chunks, places approved assets only inside their bounds, and follows the validated flight path. Asset meshes use custom indexed wound-triangle `BufferGeometry`; the runtime also rejects inverted normals, degenerate triangles, weak material lighting, unsafe placement, unreadable silhouettes, and geometry outside the performance budget. Runtime output preserves terrain lineage, seam evidence, grounding profiles, the library manifest, failed-candidate JSONL, final validation, Codex decisions, and cross-run lessons.

The forest profile defines Forest, Desert, Alpine, and Volcanic biome types independently from its world structures. Infinite, Patched, Bounded, Spherical, Full Spatial, Toroidal, and Layered structures each declare their coordinate model, visible guide, parameters, and validation requirements. Open the generated web scene with `?editor=1` to use the right-side procedural editor, or record a complete five-to-ten-minute editing session:

```bash
node ./src/cli.js tools run scene.editor-session \
  --profile ./profiles/world-factory-forest.json \
  --run-id worldharness-editor \
  --viewport 1920x1080 \
  --duration 305 \
  --fps 24 \
  --capture-style human \
  --output ./worldharness-editor.mp4
```

Each object can be regenerated from a variant seed, scaled, rotated, material-tuned, detail-budgeted, previewed as a turntable/wireframe/collision view, validated, and added to the active biome and world structure only after both object and structure checks pass. Human capture is the default: it records a visible pointer, typed seed changes, gradual range drags, continuous turntable motion, and staged detail/scale assembly. Recording uses real browser time, preserves an eight-second final-world hold, and normalizes the final H.264 output to 24 FPS; it does not advance the simulation through deterministic capture ticks. The session report preserves every edit and outcome with timestamps.

The public npm `0.0.1` package remains prepared and awaiting registry authentication. Version `0.0.2` is active development and is not published.

Use `node ./src/cli.js report summary <run-id>` to inspect the result. The default validation path stages the target before Playwright or another simtime touches it.

See the [project repository](https://github.com/LuminaryLabs-Dev/NexusSimulator) for architecture, source installation, examples, limitations, and agent guidance.

MIT licensed.
