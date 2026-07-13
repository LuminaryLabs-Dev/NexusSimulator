# Goal

Status: active

## Purpose

Build NexusSimulator `0.0.2` around explicit domain proof while preserving the frozen `0.0.1` release line.

## Current Success Criteria

- `SceneFactory` composes deterministic terrain with the recursive forest/tree/leaf graph.
- `scene.build-proof` generates, stages, rebuilds, interacts with, and explicitly validates the scene through SimSpace.
- Passing and failing proof runs both retain normalized evidence.
- The original generated preview remains byte-identical across simulation.
- Existing `interaction.proof` and CLI checks remain passing.
- `WorldFactory-Harness` staggers Sol, Terra, and Luna Codex planning while serializing validated world-object commits.
- `scene.agent-showcase` retains a reproducible web scene and produces a smooth deterministic 1080p capture without debug UI.
- The forest showcase proves 15 build-view-validate loops, then reuses all 15 procedural factories to assemble a complete world in one 30-second capture.
- The same profile supports Forest, Desert, Alpine, and Volcanic worlds through data-driven runtime presets.
- Biome appearance is independent from world structure; Infinite, Patched, Bounded, Spherical, Full Spatial, Toroidal, and Layered matrices must validate through profile data rather than topology-name branches.
- The WorldHarness editor supports seeded regeneration, procedural controls, three preview modes, explicit validation, and add-after-pass world commits.
- `scene.editor-session` records five to ten minutes of real editor activity and returns a timestamped event ledger, source video, screenshots, and console proof.
- The 0.0.2 feature stays off the public release line until approved.

## Next Goal

Extend the shared action registry into multi-environment execution profiles and local-first RPC/agent access.

## Release State

- GitHub source and the `0.0.1` jsDelivr branch URL are public.
- npm metadata and package proof pass.
- npm publication is waiting for registry authentication on the release machine.
- Branch `0.0.1` remains frozen; the scene proof is local development on `feature/0.0.2-scene-build-proof`.
