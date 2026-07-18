# Goal

Status: active

## Purpose

Develop NexusSimulator toward `0.0.3` through small validated feature branches while preserving `0.0.1` and `0.0.2` as frozen release lines.

## Current Success Criteria

- Every task is developed on one focused `feature/<goal>` branch from updated `main`.
- Feature branches pass relevant checks before they merge into `main`.
- `main` remains the integrated source of truth for `0.0.3` development.
- `0.0.1` and `0.0.2` remain unchanged as stable release branches.
- A `0.0.3` branch is created only after the user approves a validated release point.
- The technical scope for `0.0.3` is tracked through separate goal packets instead of one oversized migration.

## Next Goal

Define the first focused `0.0.3` feature goal before implementation.

## Release State

- GitHub source and stable branches are public.
- npm metadata and package proof pass.
- npm publication is waiting for registry authentication on the release machine.
- Branches `0.0.1` and `0.0.2` are frozen.
- `main` points at the `0.0.2` release commit and is ready to receive validated `0.0.3` feature work.
