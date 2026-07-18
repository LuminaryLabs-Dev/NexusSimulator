# Workflow

Status: active

## Operating Flow

1. Read `.agent/start-here.md` and the active goal.
2. Confirm the worktree is clean and update local `main` from `origin/main`.
3. Create one focused `feature/<goal>` branch from `main`.
4. Work on one goal packet or coherent task at a time.
5. Validate with repo-native CLI commands and safe SimSpace runs.
6. Commit and push the feature branch, then merge the validated feature into `main` and push `main`.
7. Update durable memory and append `.agent/change-log.md` when decisions change.

## Branch Model

```txt
0.0.1, 0.0.2       frozen stable release branches
main               integrated source of truth for the next release
feature/<goal>     all implementation and coordination work
```

- Never develop directly on `main`.
- Keep feature branches narrow enough to validate and review independently.
- Merge only passing feature branches into `main`.
- Create the next numbered release branch only after the user approves enough validated progress.
- Do not continue development on a numbered release branch after it is frozen.

## Current Work Order

1. Preserve `0.0.1` and `0.0.2` as frozen stable branches.
2. Build `0.0.3` incrementally through focused feature branches merged into `main`.
3. Create `0.0.3` only after its integrated progress is validated and approved.

## Boundaries

- Prefer `validate` and `simspace run`.
- Treat raw `scenario run` as direct execution.
- Keep each simtime limited to one interaction surface.
- Keep local runtime data out of Git and npm packages.
