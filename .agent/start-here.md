# Start Here

Status: active

## Purpose

Repo-local handoff for NexusSimulator agents.

## Repo

- Main package: `NexusSimulator-V1/`
- Current stable release branch: `0.0.2`
- Integration branch: `main`
- Frozen release branches: `0.0.1`, `0.0.2`
- Next development target: `0.0.3` through `feature/<goal>` branches
- Remote: `LuminaryLabs-Dev/NexusSimulator`

## Read Order

1. `README.md`
2. `AGENTS.md`
3. `NexusSimulator-V1/memory.md`
4. `.agent/workflow.md`
5. `.agent/goal.md`
6. Active goal and feedback packets

Current world/MCP implementation packet: `.agent/goal-packets/007-world-batch-mcp.md`.

## First Commands

```bash
git status --short --branch
git switch main
git pull --ff-only origin main
git switch -c feature/<goal>
cd NexusSimulator-V1
npm run check
npm run smoke
```

Do not implement directly on `main`. Merge a feature branch into `main` only after validation.

## Safety

Do not commit local runtime records, generated evidence, personal paths, or credentials.
