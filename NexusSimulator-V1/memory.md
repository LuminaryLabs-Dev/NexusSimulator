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
- `src/report-service.js` reads normalized run evidence without requiring callers to know artifact paths.

## Durable Conventions

- `scenario` is an app-specific workflow.
- `simtime` is one interaction-surface adapter.
- `simspace` is a disposable runtime copy.
- `tool` is a user/agent-facing validation action.
- Future fallback and composition belong in an orchestrator, not inside simtimes.
- Prefer `validate` or `simspace run`; raw `scenario run` is intentional direct execution.
- Keep safe browser proofs non-destructive by default.
- Keep runtime environments, scenarios, artifacts, and SimSpace runs local and untracked.
- Never commit personal paths, credentials, real project records, or generated evidence.

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
- `0.0.2` is reserved for multi-environment execution and RPC/agent access.
- Update this file only when durable architecture or workflow decisions change.
