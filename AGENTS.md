# Agent Instructions

## Read First

1. `README.md`
2. `NexusSimulator-V1/memory.md`
3. `.agent/start-here.md`
4. `.agent/goal.md`

## Working Rules

- Preserve the boundary: tool -> SimSpace -> simtime -> evidence.
- Prefer `validate` and `simspace run`; raw `scenario run` is intentional direct execution.
- Keep simtimes focused on one interaction surface and do not make them call each other.
- Never commit `.nexus-simulator/`, `.simspaces/`, secrets, personal paths, or real project records.
- Keep default CLI help focused on the safe common path; advanced commands belong under `--help-all`.
- Update project memory only for durable architecture or workflow decisions.

## Validation

Run from `NexusSimulator-V1/`:

```bash
npm run check
npm run smoke
node ./src/cli.js tools
node ./src/cli.js simtime list
```
