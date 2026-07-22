# World Batch and MCP

## Model

```txt
world.batch_command = ordered orchestration
WorldAdapter         = normalized world control
simtime              = one interaction surface
SimSpace             = disposable staged runtime
DSK                  = domain behavior
report               = durable evidence
```

MCP transport sessions carry protocol traffic. World sessions are separate persisted SimSpace runs and survive transport reconnects or server restart.

## Agent Sequence

1. Call `harness.manifest` to discover adapters, schemas, limits, and safety.
2. Call `world.session_create` with an allowed target and adapter.
3. Read revision `0` from `world.session_status` or `world.observe`.
4. Submit a `dryRun` batch for unfamiliar commands.
5. Submit the real `world.batch_command` with the current `baseRevision`.
6. Read `report.get`, `report.artifacts`, or `world.batch_status`.
7. Call `world.session_close` when finished.

```json
{
  "sessionId": "world-123",
  "batchId": "terrain-pass-4",
  "baseRevision": 18,
  "policy": {
    "onError": "rollback",
    "checkpointBefore": true,
    "dryRun": false,
    "allowDestructive": false,
    "timeoutMs": 120000
  },
  "metadata": {
    "goal": "Improve the terrain composition",
    "actorId": "agent-7"
  },
  "commands": [
    {
      "id": "move-tree",
      "action": "world.object.update",
      "args": { "id": "tree-7", "position": [12, 0, 4] },
      "metadata": { "reason": "Clear the player route" }
    },
    {
      "id": "validate",
      "action": "world.validate",
      "args": {}
    }
  ]
}
```

Supplied goals, actor IDs, and reasons are audit metadata. NexusSimulator does not request, infer, or persist private model chain-of-thought.

## CLI

```bash
nexus-sim world session create \
  --target ./apps/world \
  --adapter browser \
  --session-id world-123 \
  --workspace-root .

nexus-sim world batch --file ./commands.json --workspace-root .
nexus-sim world observe world-123 --workspace-root .
nexus-sim world session close world-123 --workspace-root .
```

Batch exit codes are `0` passed, `1` failed, `2` partial, and `3` rolled back. Cancellation uses a run-local marker, so another terminal can call `world session cancel` while a CLI batch is active.

## MCP

Local stdio configuration:

```json
{
  "mcpServers": {
    "nexus-simulator": {
      "command": "nexus-sim",
      "args": ["mcp", "serve", "--transport", "stdio", "--workspace-root", "/path/to/workspace"]
    }
  }
}
```

Local HTTP:

```bash
nexus-sim mcp serve --transport http --host 127.0.0.1 --port 8765 --workspace-root .
```

LAN mode is explicit and authenticated:

```bash
export NEXUS_SIM_MCP_TOKEN='<at-least-32-random-characters>'
nexus-sim mcp serve \
  --transport http \
  --host 0.0.0.0 \
  --port 8765 \
  --allowed-host simulator.lan \
  --workspace-root .
```

HTTP uses stateful Streamable HTTP at `/mcp`. LAN binding rejects missing/short tokens, wildcard Host allowlists, and requests without the bearer token. Tokens are environment-only, never CLI arguments.

The `0.0.3` development branch pins the official split-package MCP v2 SDK at `2.0.0-beta.5`. Revalidate the SDK version and rerun both official-client transport suites before promoting a stable `0.0.3` branch. See the [official server guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md).

## Adapters

Browser targets must expose this fixed bridge:

```js
window.__NEXUS_WORLD_COMMANDS__ = {
  version: "1",
  manifest(),
  execute({ action, args }),
  observe(),
  snapshot(),
  restore(snapshot)
};
```

The bridge is the only page-evaluation path for world actions. `world.capture` remains browser-only evidence.

`nexus-headless` profiles identify a relative module path or package specifier that must resolve inside the staged SimSpace. The exported runtime must provide `listCapabilities`, `runScript`, `snapshot`, and `loadSnapshot`. A dynamic DSK action is callable only when both its ID and JSON input schema are allowlisted by the profile.

## Revisions and Recovery

- Reusing an exact `batchId` and request returns its persisted result.
- Reusing the ID with different content returns `BATCH_ID_CONFLICT`.
- `REVISION_CONFLICT` means another accepted mutation advanced the world. Observe again, reconsider the change, and submit a new batch ID with the new revision.
- Read-only and dry-run batches do not advance revisions.
- Preserved mutations advance exactly once per batch.
- Verified rollback leaves the revision unchanged.
- Unverifiable recovery blocks the session and invalidates stale writers. Close and recreate the session after inspecting its report.

Rollback is only claimed for snapshot-safe world state. Network calls and external side effects must declare `rollback: "none"` and are rejected in rollback batches.

## Limits and Safety

- 50 commands per batch.
- 1 MiB request body.
- 30-second default command timeout; 120-second maximum.
- 120-second default batch timeout; 600-second maximum.
- 256 KiB inline combined output; larger output and state diffs become `nexus-sim://` resource links.
- Four warm sessions and one active batch per session.
- 30-minute idle runtime lease; persisted sessions can rehydrate from verified snapshots.
- Destructive actions require profile `allowDestructive: true`, server `--allow-destructive`, and batch `allowDestructive: true`.
- Targets and profile paths must remain inside configured workspace roots.
- SimSpace rejects escaping symlinks and never launches from the source tree.
- The local backend offers best-effort monitoring, not a hard memory boundary. Profiles requiring hard memory isolation fail closed; container enforcement is future work.

Local SimSpace is a staging and output-isolation boundary for trusted applications, not an OS security sandbox. A browser launch command or headless runtime module selected by an execution profile is trusted code and could deliberately access host resources. Use a container-backed execution backend when validating untrusted native or Node code.
