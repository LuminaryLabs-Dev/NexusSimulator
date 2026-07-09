# Validation Matrix

Status: active

## Purpose

Large validation checklist for public cleanup and V2 agent-ready work.

## Public Cleanup

- No tracked `.env`.
- No obvious API keys, tokens, or private keys.
- No tracked machine-specific home-directory paths on public branch.
- No real emails in public examples.
- No private/client repo names in public examples.
- `.nexus-simulator/artifacts/` ignored.
- `.simspaces/` ignored.
- Real envs and scenarios are local/private by default.

## CLI

- `node ./src/cli.js --help` shows simple path.
- `node ./src/cli.js --help-all` shows advanced path.
- `validate` checks capabilities before execution.
- `validate` defaults to SimSpace.
- `scenario run` remains available and marked raw/direct.
- `simtime list` shows id, type, and surface.
- `simtime inspect` returns stable manifest JSON.

## SimSpace

- Creates unique run folders.
- Stages app before running.
- Uses isolated port per run.
- Writes `manifest.json`.
- Writes `report.json`.
- Writes logs and artifacts.
- Stops processes on success.
- Stops processes on failure.
- Failure still writes report.
- Source tree is not mutated by default.

## Mediums

- Browser static app validates.
- Browser Vite app validates.
- Browser screenshot captured.
- Browser console errors reported.
- File list/read/assert validates output.
- Terminal command runs in staged copy.
- Terminal stdout/stderr captured.
- Game/canvas validates canvas presence.
- Game/canvas detects render progress.
- Human-interaction suggests actions without executing browser APIs.

## RPC

- `/health` works.
- `/manifest` lists methods.
- `/rpc` validates known methods.
- Unknown method returns structured error.
- RPC validate matches CLI validate behavior.
- Local-only binding is default.
- LAN binding requires token auth.
- Request/response schemas are documented.
- Reports and artifacts are retrievable by run id.

## Agent Usability

- Agent can discover capabilities without reading source.
- Agent can validate a target with one call.
- Agent receives status, run id, report path, artifacts, console errors, failed step, and next suggested action.
- Agent can resume or inspect long-running validation.
- Agent does not need to know ports, simtime internals, or artifact folders.
