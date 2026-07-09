# Action Registry CLI RPC

Status: active

## Purpose

Create one core action layer used by both terminal CLI and RPC/LAN access.

## Principle

Do not duplicate logic between CLI and RPC.

```txt
core actions
  -> CLI adapter
  -> RPC adapter
```

## Initial Actions

- `detect`
- `attach`
- `validate`
- `scenario.check`
- `scenario.show`
- `scenario.runSafe`
- `simspace.run`
- `report.get`
- `artifact.list`
- `simtime.list`
- `simtime.inspect`

## CLI Shape

```bash
nexus-sim validate <path>
nexus-sim validate <path> --medium browser
nexus-sim validate <path> --medium file
nexus-sim validate <path> --medium terminal
nexus-sim report <run-id>
nexus-sim artifacts <run-id>
nexus-sim serve --host 127.0.0.1 --port 8765
```

## RPC Shape

```txt
GET  /health
GET  /manifest
POST /rpc
GET  /runs/<run-id>/report
GET  /runs/<run-id>/artifacts
```

LAN mode must require explicit `--host 0.0.0.0` and token auth.
