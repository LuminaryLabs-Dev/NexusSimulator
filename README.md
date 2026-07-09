# NexusSimulator

NexusSimulator is a Node CLI that gives agents a disposable environment for safely launching, testing, and inspecting applications.

```txt
target app -> SimSpace copy -> interaction tool -> evidence -> report
```

The original project stays untouched by default. NexusSimulator stages it in a SimSpace, exercises it through a focused interaction surface, captures evidence, and stops the runtime when validation ends.

## Install

```bash
npm install --global nexus-simulator@0.0.1
npx playwright install chromium
```

Node.js 18 or newer is required.

## Quick Start

Validate a static HTML, canvas, Three.js, or detected Vite application:

```bash
nexus-sim validate <path> --tool interaction.proof
```

Inspect the resulting evidence:

```bash
nexus-sim report summary <run-id>
nexus-sim report artifacts <run-id>
nexus-sim report console <run-id>
```

`interaction.proof` opens the staged application with Playwright, captures before/after screenshots, sends non-destructive input, checks responsiveness and console errors, and writes a normalized report.

## Source Install

```bash
git clone https://github.com/LuminaryLabs-Dev/NexusSimulator.git
cd NexusSimulator/NexusSimulator-V1
npm install
npx playwright install chromium
node ./src/cli.js --help
```

## Core Model

```txt
scenario = app-specific workflow
simtime = one interaction surface adapter
simspace = disposable runtime copy
tool = agent-facing validation action
orchestrator = future composition layer
```

Use `validate` or `simspace run` for safe validation. `scenario run` is an advanced direct runner that can touch an attached source path.

## Supported Surfaces

- Playwright browser validation for static HTML, Vite, canvas, Three.js, and A-Frame targets.
- Deterministic web and headless state-machine scaffolds.
- Filesystem inspection through the file simtime.
- Terminal, human-controller, AR, and specialized runtime adapters.

Current automatic path-first validation focuses on browser targets. Authentication-heavy applications, native desktop windows, mobile devices, external databases, and destructive workflows require explicit scenarios or future adapters.

## Local Data

Runtime environments, scenarios, SimSpace runs, screenshots, and reports are local data under `.nexus-simulator/` or `.simspaces/`. They are ignored by Git. Public-safe scenario examples live in [`examples/`](./examples/).

## Agent Guidance

Coding agents should read [`AGENTS.md`](./AGENTS.md), [`NexusSimulator-V1/memory.md`](./NexusSimulator-V1/memory.md), and [`.agent/start-here.md`](./.agent/start-here.md).

## CDN Use

jsDelivr can distribute repository and npm package files for documentation or agent discovery. It does not execute the Node CLI, Playwright, or SimSpace; those run on a local machine or server.

## License

MIT. See [`LICENSE`](./LICENSE).
