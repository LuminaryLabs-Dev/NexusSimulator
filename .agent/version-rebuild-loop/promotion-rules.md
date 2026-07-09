# Promotion Rules

Status: active

## Required Evidence

- Existing scenario validation still works.
- `validate <path> --tool interaction.proof` uses SimSpace by default.
- Original target folder remains untouched.
- Every validation writes a report.
- Report commands can retrieve summary, artifacts, console output, logs, and failed step.
- Failed or inconclusive validation is explicit, not hidden as passed.
- Default CLI help stays simple.
- Advanced scenario/simtime commands remain available.

## Rejection Conditions

- Tool validation bypasses SimSpace.
- Simtimes call other simtimes.
- Playwright verifies files.
- Report artifacts are written into the source app tree.
- Raw scenario execution becomes the default validation path.
