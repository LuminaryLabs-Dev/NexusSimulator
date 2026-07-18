# Intention

Status: active

## Purpose

Make NexusSimulator a fast, reliable, open-source validation runtime that agents can use without risking the original application workspace.

## Product Direction

```txt
target -> detect -> SimSpace -> tool -> simtime -> evidence -> report
```

## Durable Constraints

- SimSpace is the safe default.
- Interaction surfaces remain separate.
- CLI and future RPC use the same action layer.
- Public releases contain no local runtime records, personal paths, credentials, or private examples.
- Default help shows the common safe path; advanced surfaces remain available separately.
- All changes flow through focused feature branches into `main`; numbered release branches are frozen milestones.
