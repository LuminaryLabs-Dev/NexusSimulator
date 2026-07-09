# NexusSimulator 0.0.1

Safe application validation through disposable SimSpace runs and focused interaction surfaces.

```bash
git clone https://github.com/LuminaryLabs-Dev/NexusSimulator.git
cd NexusSimulator/NexusSimulator-V1
npm install
npx playwright install chromium
node ./src/cli.js validate <path> --tool interaction.proof
```

The npm package is prepared and awaiting registry authentication. Once published, install it with `npm install --global nexus-simulator@0.0.1`.

Use `node ./src/cli.js report summary <run-id>` to inspect the result. The default validation path stages the target before Playwright or another simtime touches it.

See the [project repository](https://github.com/LuminaryLabs-Dev/NexusSimulator) for architecture, source installation, examples, limitations, and agent guidance.

MIT licensed.
