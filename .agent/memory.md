# Agent Memory

Status: active

## Architecture

- `tool` is the agent-facing action.
- `simspace` is the disposable runtime copy.
- `simtime` is one interaction surface.
- `scenario` is replayable workflow data.
- Future orchestration composes these layers without merging them.

## Current Decisions

- `main` is the source of truth.
- `0.0.1` is the frozen public release branch; no version tag is used.
- `interaction.proof` is the first public domain tool.
- `scene.build-proof` is the first 0.0.2 build-and-prove tool and must preserve `tool -> SimSpace -> one simtime -> evidence`.
- `SceneFactory` composes the 3D-only `TerrainFactory` with the existing recursive foliage factories; generated terrain and scene state are seed-hashed.
- `WorldFactory-Harness` uses staggered Sol, Terra, and Luna Codex planning lanes, but serializes validated writes to the shared 3D world.
- `scene.agent-showcase` captures deterministic browser frames through `renderAt(time)` and encodes them as H.264 instead of retiming checkpoint video.
- Forest showcase profiles separate object-lab validation from world assembly; asset factories are reused across both phases rather than replaced with unrelated presentation geometry.
- World types are profile-driven palette presets shared by the cinematic showcase and editor; adding a world type must not fork the factory graph.
- World structure is a separate profile matrix. Infinite, Patched, Bounded, Spherical, Full Spatial, Toroidal, and Layered structures are validated through generic dotted-path rules and rendered through guide descriptors.
- A world object can commit only when its object checks and the active structure requirements both pass.
- `scene.editor-session` is the long-form proof surface for seeded regeneration, procedural controls, preview modes, failed-check correction, validation, and serialized world commits.
- `scene.editor-session` uses elapsed real browser time, outputs exact 24 FPS H.264, and preserves an eight-second finished-world hold; deterministic `renderAt(time)` remains exclusive to cinematic proof capture.
- Editor validation treats meshes, points, and lines as renderable geometry so non-mesh procedural effects remain validatable.
- `validate` and `simspace run` are safe defaults.
- Local runtime data is ignored by Git and excluded from npm.
- Native runtime paths must come from configuration or `NEXUS_ENGINE_*` environment variables.
- `0.0.2` owns explicit domain proof, future multi-environment profiles, and local-first RPC.
