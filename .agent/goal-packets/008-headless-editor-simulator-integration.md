# Headless Editor to NexusSimulator Integration

Status: complete

Mission: Let Nexus Engine control one bounded NexusSimulator operation through its Core Headless Editor while preserving disposable execution, explicit human review, and independent repositories.

## Completed

- Added a direct adapter for one typed `simspace.run` or WorldFactory command.
- Added a file-backed runner and `headless run` CLI entrypoint with Nexus Engine discovery.
- Mapped all nine Headless Editor lifecycle stages to Simulator inspection, validation, execution, evidence, and verification.
- Proved a temporary Playwright application runs in SimSpace without changing its source.
- Proved unsupported events and invalid procedural settings fail during validation without execution.
- Proved WorldFactory generate, review, and revise remain separate runs.
- Proved revision preserves prompt and seed, changes typed terrain settings, and produces a different native 24 FPS artifact hash.
- Kept final human review separate; the revised visual remained blocked rather than receiving a false pass.

## Validation

- `npm run check`
- `npm run smoke`
- `node src/cli.js tools`
- `node src/cli.js simtime list`
- Nexus Engine Core Headless Editor kit, runtime, and guided-development smoke tests
- Playwright screenshot inspection and WorldFactory contact-sheet Human View

## Boundary

Nexus Engine is the control plane. NexusSimulator remains an insertable, independently usable execution and evidence service. MCP remains deferred until this direct runner is accepted.
