# NexusSimulator

NexusSimulator is a Node CLI for replaying app-specific scenario logs through interaction-surface adapters called simtimes.

The safe default is SimSpace: the app is staged into a disposable run folder, launched there, exercised by a simtime, and reported without touching the original app folder.

## Core Model

```txt
scenario = app-specific workflow
simtime = one interaction surface adapter
simspace = disposable runtime copy of the app
orchestrator = future fallback/composition layer
```

## Quick Start

```bash
cd NexusSimulator-V1
npm install
node ./src/cli.js --help
```

## Safe Validation Path

```bash
node ./src/cli.js app detect <path>
node ./src/cli.js app attach <env> <path>
node ./src/cli.js scenario check <env> <scenario> --simtime playwright
node ./src/cli.js simspace run <env> <scenario> --simtime playwright
```

Or use the shortcut:

```bash
node ./src/cli.js validate <env> <scenario> --simtime playwright
```

`validate` runs a capability check first, then runs the scenario inside SimSpace and prints the report path.

## Daily Commands

```bash
node ./src/cli.js app detect <path>
node ./src/cli.js app attach <env> <path>
node ./src/cli.js app smoke <env>
node ./src/cli.js scenario list <env>
node ./src/cli.js scenario show <env> <scenario>
node ./src/cli.js scenario check <env> <scenario> --simtime playwright
node ./src/cli.js simspace run <env> <scenario> --simtime playwright
node ./src/cli.js simtime list
node ./src/cli.js simtime inspect playwright
```

Use `node ./src/cli.js --help-all` for advanced factory, asset-pack, itch, chunked SimSpace, and raw scenario commands.

## Safety Rule

Prefer `simspace run` or `validate` for app validation.

`scenario run` is the raw direct runner. It can touch the attached app path and should be used only when direct source-tree execution is intentional.

## Project Layout

```txt
NexusSimulator-V1/
  src/
    cli.js                 CLI entrypoint
    runtime.js             env/scenario storage and replay
    simtimes.js            simtime registry
    playwright-simtime.js  browser surface
    file-simtime.js        filesystem surface
    human-interaction-simtime.js
    simspace.js            disposable staged run layer
  .nexus-simulator/
    envs/                  app/environment records
    scenarios/             append-only JSONL workflows
```

Generated run artifacts are ignored from Git:

```txt
NexusSimulator-V1/.simspaces/
NexusSimulator-V1/.nexus-simulator/artifacts/
NexusSimulator-V1/.nexus-simulator/factory-runs/
NexusSimulator-V1/.nexus-simulator/asset-packs/
```
