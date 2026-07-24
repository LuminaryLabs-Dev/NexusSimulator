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

Create a world from a constrained natural-language request without preparing a profile first:

```bash
node ./src/cli.js tools run scene.agent-showcase \
  --prompt "Create a desert with a river" \
  --run-id desert-river-001 \
  --viewport 1920x1080 \
  --fps 30
```

Inspect the live capability inventory and derive a plan without generating a world:

```bash
node ./src/cli.js world-domain capabilities
node ./src/cli.js world-domain plan \
  --prompt "Create a desert with a shrine, stone arch, crystals, and an oasis river." \
  --seed desert-review-001
```

The prompt compiler does not select from a preset scene recipe. It decomposes the description into semantic domains and requirements, matches each requirement to a factory or native world capability, records composition edges, and fails closed when any prompt signal remains unsupported or ambiguous. The capability response includes semantic terms, biome affinity, review criteria, and typed setting ranges so an external agent can prepare a plan without reading source. The resulting coverage ledger separates explicit requests, inferred necessities, and gaps. An agent may supply the same independently validated `nexus.world-domain-plan.v1` contract with `--agent-plan <path>`; otherwise a deterministic domain fallback creates it. Forest, Desert, Alpine, and Volcanic biomes and the existing world structures remain the currently proven environmental boundaries.

Each selected factory executes a seeded typed mesh program; the planner decides what belongs, the factory decides how that capability is generated, and the reviewing agent changes settings or placement through an in-world preview. Supply `--seed <value>` to reproduce a plan while repairing it. Without a seed, a new plan varies terrain math, water paths, object transforms, and factory settings. The run profile retains the description, domain-plan and world-plan digests, requirement ownership, selected capabilities, coverage state, and resolved steps.

Every run starts from a new run-local blank Nexus Engine project. A reused non-empty `--run-id` is rejected. Prompt worlds disable the profile's repeated massive-world sectors so the generated composition is not surrounded by cloned layouts. WorldFactory ranks source-backed natural-math candidates without consuming prior-run lessons, generates a fresh low-poly shape and procedural PBR skin contract for each step, and validates each kit alone against the Core World, Object, Graphics, and Physics domains. Only individually passing kits are installed into a second fresh engine for the final composition. The default visual policy caps each generated asset at 5,000 triangles, moves fine detail into base-color, normal, packed-surface, and height channels, targets a 2048 material atlas, and uses a generated 512-pixel browser fallback. A prompt can explicitly request high-poly or flat/untextured output to override those defaults.

`NexusEngine` is required and is auto-discovered when it is beside `NexusSimulator`; otherwise supply `--nexus-engine-root`. Without both terrain roots, prompt runs use the local showcase terrain while retaining the blank Core-domain project gate. Supplying both roots additionally preserves the full TerrainKit and ProtoKit validation gate. Add `--use-codex` only when live read-only owner planning is wanted.

Generate and iteratively review 15-second vertical WorldFactory footage:

```bash
node ./src/cli.js world-video make
node ./src/cli.js world-video status
node ./src/cli.js world-video review \
  --decision revise \
  --area opening-hook \
  --severity high \
  --issue "Show the completed place within the first three seconds."
```

`world-video make` rotates through supported place prompts unless a prompt is supplied, creates a fresh seeded world, records a deterministic 720x1280 H.264 draft from native 24 FPS frames, and derives a separate 4 FPS harness-view proxy by selecting every sixth gameplay frame without interpolation. Technical review rejects mismatched native cadence or frame counts, probes duration and motion, and builds a five-frame contact sheet from the harness view. The short-form procedural view shows typed settings changing on the selected object inside the composed world, then rebuilds that same candidate immediately. Repairs reuse the same prompt and seed with `--addresses <issue-id> --change <text>` so one factory change can be compared directly. The ignored `.nexus-simulator/world-video-loop/` workspace keeps append-only reviews and an issue/change/evidence graph, domain coverage and saturation experiments, compact evidence for every iteration, and only one full `current/video.mp4` plus its compact `current/harness-view.mp4`; failed attempts never replace that retained review video. Saturation advances only after structural and human visual approval. These are local review drafts with no upload or publication permission.

## Nexus Engine Headless Editor integration

Nexus Engine can use NexusSimulator as an insertable execution adapter without hosting another server:

```text
human or agent
  -> Nexus Engine Core Headless Editor
    -> NexusSimulator adapter
      -> Simulator action
        -> disposable SimSpace
          -> selected Simtime
            -> target application
```

The Headless Editor owns the finite `read -> capture -> plan -> validate -> submit -> observe -> verify -> capture -> differences` control loop. NexusSimulator validates and executes exactly one caller-authored command per run. The adapter does not choose creative changes, mutate the original target, start an HTTP control plane, or run an autonomous review loop.

Create a request:

```json
{
  "schemaVersion": "nexus.simulator.headless-request.v1",
  "goal": "Validate the smoke scenario in disposable space.",
  "command": {
    "action": "simspace.run",
    "input": {
      "envName": "example",
      "scenarioName": "smoke",
      "simtime": "playwright"
    }
  }
}
```

Run it against a sibling Nexus Engine checkout or provide the root explicitly:

```bash
node ./src/cli.js headless run \
  --request ./request.json \
  --nexus-engine-root /path/to/NexusEngine
```

Results and all nine stage ledgers are written under the ignored `.nexus-simulator/headless-runs/<run-id>/` workspace. Source SHA-256 digests are captured before and after execution and must match. Unsupported actions or Simtime events fail during validation before a SimSpace is created.

WorldFactory uses the same request envelope with three actions:

```text
world.candidate.generate  -> prompt + explicit seed + portrait viewport
world.candidate.review    -> current iteration + pass, revise, or blocked
world.candidate.revise    -> current iteration + active issue IDs + one change + typed settings patch
```

Generation first performs semantic domain planning and requires complete coverage. A revision automatically reuses the current candidate's prompt, seed, and viewport, then validates `settingsPatch` against the selected procedural object's controls. Review and revision are separate Headless Editor runs so an agent or human must inspect the native 24 FPS video, 4 FPS harness view, poster, and contact sheet before deciding what happens next. A failed or unchanged revision retains the prior reviewable candidate, and no result receives upload or publication permission.

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
