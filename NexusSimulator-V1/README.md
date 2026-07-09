# NexusSimulator 0.0.1

Safe application validation through disposable SimSpace runs and focused interaction surfaces.

```bash
npm install --global nexus-simulator@0.0.1
npx playwright install chromium
nexus-sim validate <path> --tool interaction.proof
```

Use `nexus-sim report summary <run-id>` to inspect the result. The default validation path stages the target before Playwright or another simtime touches it.

See the [project repository](https://github.com/LuminaryLabs-Dev/NexusSimulator) for architecture, source installation, examples, limitations, and agent guidance.

MIT licensed.
