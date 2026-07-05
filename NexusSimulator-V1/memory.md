# NexusSimulator Memory

## Purpose
NexusSimulator is a Node-based simulation translation CLI that defines ordered command-event scenarios and replays them through simtime adapters for harness-neutral validation workflows.

## Current Architecture
- `src/cli.js` is the command entrypoint.
- `src/runtime.js` owns environment/scenario storage and replay orchestration.
- `src/actions.js` owns the shared CLI/RPC-ready action registry for user-facing validation flows.
- `src/tool-catalog.js` defines domain tool manifests such as `interaction.proof`.
- `src/report-service.js` reads normalized SimSpace run reports for agents and CLI users.
- `src/simtimes.js` defines the simtime adapter registry and the shared adapter contract.
- `src/app-detection.js` provides read-only app detection for web-app validation targets.
- `src/playwright-simtime.js` provides real browser-backed app validation through Playwright.
- `src/file-simtime.js` provides file-surface inspection only.
- `src/human-interaction-simtime.js` provides a human-like decision loop only; it does not execute browser or file actions.
- `src/ar-simtime.js` provides headless NexusRealtime AR app validation by importing an app experience registry/runtime, running placement/action flows, checking authored duration budgets, and producing reports.
- `src/simspace.js` provides the disposable runtime layer that stages apps into isolated run folders before existing simtimes touch them.
- Simtime manifests carry `id`, `type`, `surface`, and `supports`.
- Environments are stored as JSON files in `.nexus-simulator/envs/`.
- Scenario files are append-only JSONL logs in `.nexus-simulator/scenarios/<env>/`.
- Attached app metadata is stored on the environment record and does not start or validate the app by itself.

## Conventions
- Keep the CLI small and direct.
- Prefer append-only scenario logs over hidden internal scenario state.
- Keep adapter capability checks simple and explicit.
- Treat `type` as a category label for simtime families, not as an execution contract.
- Keep app detection read-only, app attachment metadata-only, and smoke generation idempotent by default.
- Keep `web-app` deterministic; use `playwright` when real browser evidence is required.
- Playwright simtime supports rich browser interaction events including select, pointer gestures, wheel, viewport resize, window assertions, and `window.__NEXUS_TEST_STATE__` assertions.
- Playwright simtime supports `advanceSimTime` for browser apps that expose `window.__NEXUS_SIMTIME__.advance(seconds, input)`, allowing scenario JSONL to fast-forward app-defined simulation time before global-state assertions.
- Playwright simtime supports `recordVideo` for short-form proof capture; it records through the Playwright browser context and saves the requested WebM into the active artifact directory when the runtime closes.
- Playwright simtime supports `assertGameQuality` for game-facing proof gates that read `window.__NEXUS_TEST_STATE__.recording` and block on camera safety, visible canvas readiness, frame progress, keyframed character telemetry, skeleton joint count, and minimum world-dressing counts.
- Keep simtime boundaries strict: `playwright` owns browser behavior, `file` owns filesystem inspection, and `human-interaction` owns interaction choice/summarization.
- `nexusrealtime` SimTime is the private live NexusRealtime app adapter. It drives browser apps through `window.GameHost`, not public `window.__NEXUS_SIMTIME__`, and uses heuristic action loops plus state assertions for The Open Above-style runtime proof.
- Multi-surface validation should be coordinated by separate scenario runs rather than hidden inside one simtime.
- Treat a simtime as an interaction surface adapter and a scenario as an app-specific workflow.
- Treat a tool as the user/agent-facing action abstraction above simtimes; tools choose safe SimSpace execution and focused simtimes internally.
- `interaction.proof` is the first V2 domain tool. It proves browser render and safe input delivery through Playwright inside SimSpace, then reports passed, failed, or inconclusive evidence.
- AR SimTime proves authored AR objective/reward logic and content-duration budgets; it does not prove physical camera permission, WebXR tracking stability, or real surface anchoring.
- Treat SimSpace as the disposable runtime copy of an app; never launch a validation run from the source app tree when isolation is required.
- Keep the public CLI path simple: default help shows common validation commands, `--help-all` shows advanced surfaces, and `validate` means scenario compatibility check plus SimSpace run.
- Future fallback/composition belongs in an orchestrator layer, not inside individual simtimes.
- Safe browser proof should be non-destructive by default; packet-creating or otherwise destructive scenarios must be explicitly named.
- Asset-pack production is a NexusSimulator CLI surface under `asset-pack`; it generates local FBX/PNG asset packs, records preview proof through Playwright SimTime, packages only after local quality gates pass, and stores run artifacts under `.nexus-simulator/asset-packs/`.
- Asset-pack previews must pass recursive video review before being presented as sellable: use `asset-pack improve` to rebuild, rerecord, and re-review until the watcher module confirms theme coverage, asset density, SimTime pass, and no console errors.
- Recursive foliage factories live under the `factory` CLI surface. Factory names must use `<Thing>Factory`: `LeafFactory`, `TreeFactory`, `FoliagePatchFactory`, and `ForestFactory`.
- The suffixed factories `LeafFactory2D`, `TreeFactory2D`, `FoliagePatchFactory2D`, and `ForestFactory2D` preserve the original canvas 2D preview path; unsuffixed foliage factories render proof scenes through a shared local Three.js preview runtime.
- Foliage factories are independently runnable but may recursively trigger each other through explicit factory calls recorded in `call-trace.jsonl`; higher factories do not consume opaque pipeline outputs.
- `LeafFactory` exports individual leaf FBX/PNG assets, `TreeFactory` recursively reaches leaf points and calls `LeafFactory`, `FoliagePatchFactory` calls multiple `TreeFactory` runs to build a sellable patch, and `ForestFactory` calls multiple `FoliagePatchFactory` runs.
- The factory preview workspace follows the NexusFactory pipe-workspace idea: stable renderer environment plus per-run scene data/proof artifacts, so Playwright SimTime can record without a new bespoke Three.js app per run.
- Factory runs may be initialized from `nexus.factory-profile.v1` JSON configs. Configs resolve reusable named profiles plus nested `spawnSlots` into explicit traced factory calls with `profileRef`, `spawnId`, and `spawnPath`; the saved run copy under `modules/` is the durable source for replay.
- Hyperreal 3D forest factory runs use `qualityPreset: "hyperreal"` with deterministic Playwright SimTime capture, `recordingFps`, 10 built-in tree species profiles, branch/trunk skinning metadata, bark PBR map outputs, and stricter quality gates for species coverage, skinned mesh evidence, skeleton bones, bark maps, and smooth-frame telemetry.
- Factory runs store proof under `.nexus-simulator/factory-runs/<run-id>/`; packaging copies passing factory outputs into `.nexus-simulator/asset-packs/<pack-id>/` so the existing Playwright-only itch draft adapter can remain asset-pack compatible.
- Itch draft automation is Playwright-only in this repo. Do not add Butler fallback behavior; authenticated draft create/upload commands require explicit approval and must stop before public publish or payment-setting changes.
- Add durable architecture notes here only when the repo shape or long-term conventions change.
