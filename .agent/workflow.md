# Workflow

Status: active

## Operating Flow

1. Read `.agent/start-here.md` and the active goal.
2. Confirm the worktree and target branch.
3. Work on one goal packet at a time.
4. Validate with repo-native CLI commands and safe SimSpace runs.
5. Update durable memory and append `.agent/change-log.md` when decisions change.

## Current Work Order

1. Publish and freeze release branch `0.0.1` from validated `main`.
2. Build `0.0.2` multi-environment execution profiles.
3. Add local-first RPC and agent discovery through the shared action registry.

## Boundaries

- Prefer `validate` and `simspace run`.
- Treat raw `scenario run` as direct execution.
- Keep each simtime limited to one interaction surface.
- Keep local runtime data out of Git and npm packages.
