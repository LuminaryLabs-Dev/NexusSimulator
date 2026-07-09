# Agent Hooks

Status: active

## Purpose

Expose NexusSimulator in a way that any agent can discover, validate, inspect, and resume work without knowing internal scenario or simtime details.

## Hook Groups

- Discovery: `manifest`, `capabilities`, `simtimes`, `examples`.
- Validation: `validate`, `validateScenario`, `checkScenario`.
- Browser: `browser.open`, `browser.click`, `browser.type`, `browser.screenshot`, `browser.console`, `browser.assertVisible`, `browser.assertText`, `browser.assertNoConsoleErrors`.
- File: `file.list`, `file.read`, `file.assertExists`, `file.assertContains`, `file.diff`.
- Terminal: `terminal.run`, `terminal.assertExitCode`, `terminal.assertStdout`, `terminal.assertStderr`.
- Scenario: `scenario.create`, `scenario.append`, `scenario.show`, `scenario.check`, `scenario.runSafe`, `scenario.runRaw`, `scenario.generateSmoke`.
- SimSpace: `simspace.create`, `simspace.stage`, `simspace.run`, `simspace.cleanup`, `simspace.archive`, `simspace.status`.
- Report: `report.get`, `report.summary`, `report.artifacts`, `report.logs`, `report.console`, `report.failedStep`.
- Human: `human.observe`, `human.detectInteractions`, `human.chooseNext`, `human.checkpoint`, `human.escape`, `human.summarize`.
- Safety: `safety.scanRepo`, `safety.scanBranch`, `safety.assertNoSecrets`, `safety.assertNoAbsolutePaths`, `safety.assertNoRawScenarioRun`.
- Session: `session.start`, `session.resume`, `session.status`, `session.cancel`, `session.events`.

## Safety Rule

Browser hooks should compile into scenario events or execute inside SimSpace by default. They should not bypass safety just because an agent calls them directly.
