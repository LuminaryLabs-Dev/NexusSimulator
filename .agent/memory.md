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
- `validate` and `simspace run` are safe defaults.
- Local runtime data is ignored by Git and excluded from npm.
- Native runtime paths must come from configuration or `NEXUS_ENGINE_*` environment variables.
- `0.0.2` owns future multi-environment profiles and local-first RPC.
