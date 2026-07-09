# V2 Agent Usability

Status: active

## Feedback

V2 should make NexusSimulator usable by agents across terminal and LAN/RPC without requiring them to know internal ports, simtimes, scenarios, or artifact paths.

## Desired Experience

```json
{
  "method": "validate",
  "params": {
    "target": "/path/to/app",
    "medium": "browser"
  }
}
```

The agent should receive one clear report with status, summary, run id, report path, artifacts, console errors, failed step, and next suggested action.

## Required Boundary

Agent hooks should use the same safe core action layer as the CLI. They should not bypass SimSpace by default.
