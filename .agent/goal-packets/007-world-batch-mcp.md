# Revisioned World Batch MCP

Status: implemented on feature branch; promotion pending

## Goal

Make `world.batch_command` the primary connected world-write interface shared by CLI and MCP.

## Contract

```txt
CLI / MCP -> action registry -> session manager -> batch executor
                                              -> browser WorldAdapter
                                              -> nexus-headless WorldAdapter
```

- Stage every target in SimSpace.
- Validate all typed commands before execution.
- Require `baseRevision` and unique command IDs.
- Execute in order under one session lock.
- Persist requests, results, checkpoints, events, reports, logs, processes, and safe artifact links.
- Support stop, continue, verified rollback, dry-run, timeout, and cross-process cancellation.
- Never expose unrestricted shell, JavaScript, filesystem browsing, or individual MCP mutation tools.

## Promotion Gates

- `npm run check`, `npm test`, and `npm run smoke` pass.
- Browser and staged headless batches pass.
- Official MCP clients complete stdio and Streamable HTTP batches.
- The pinned pre-release MCP SDK is revalidated or replaced by the current stable release at promotion time.
- LAN mode rejects missing/invalid bearer tokens and invalid Host values.
- Source hashes remain unchanged and escaping symlinks are rejected.
- Reports contain no source paths or tokens.
- No `0.0.3` release branch or package bump occurs without user approval.
