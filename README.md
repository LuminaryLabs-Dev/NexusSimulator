# NexusSimulator

NexusSimulator is a Node CLI that gives agents a disposable environment for safely launching, testing, and inspecting applications.

```txt
target app -> SimSpace copy -> interaction tool -> evidence -> report
```

The original project stays untouched by default. NexusSimulator stages it in a SimSpace, exercises it through a focused interaction surface, captures evidence, and stops the runtime when validation ends.

## Install

The public source release is live. npm publication is prepared and awaiting registry authentication; use the source install until the package appears on npm.

```bash
git clone https://github.com/LuminaryLabs-Dev/NexusSimulator.git
cd NexusSimulator/NexusSimulator-V1
npm install
npx playwright install chromium
node ./src/cli.js --help
```

Node.js 18 or newer is required.

After registry publication:

```bash
npm install --global nexus-simulator@0.0.1
```

## Quick Start

Validate a static HTML, canvas, Three.js, or detected Vite application:

```bash
node ./src/cli.js validate <path> --tool interaction.proof
```

Inspect the resulting evidence:

```bash
node ./src/cli.js report summary <run-id>
node ./src/cli.js report artifacts <run-id>
node ./src/cli.js report console <run-id>
```

`interaction.proof` opens the staged application with Playwright, captures before/after screenshots, sends non-destructive input, checks responsiveness and console errors, and writes a normalized report.

## 0.0.2 Development

The current development lane adds explicit domain proof. The first tool generates and validates a deterministic procedural Three.js scene:

```bash
node ./src/cli.js tools run scene.build-proof \
  --profile ./profiles/procedural-grove-scene.json \
  --run-id nexus-grove-002
```

The scene profile composes `SceneFactory -> TerrainFactory + ForestFactory -> FoliagePatchFactory -> TreeFactory -> LeafFactory`. The proof runs inside SimSpace and asserts terrain/tree counts, deterministic scene hash, camera response, console cleanliness, responsiveness, and unchanged generated-source digest.

This `0.0.2` work is not released or published to npm.

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
