# V2 Speed Reliability Usability

Status: active

## Purpose

Turn NexusSimulator from a correct architecture into a practical multi-medium validation tool.

## V2 Definition

```txt
app or artifact
  -> auto-detect surfaces
  -> choose safe SimSpace run
  -> validate with the right simtime
  -> produce one clear report
```

## Success Criteria

- Fewer manual commands for common validation.
- `validate <target>` works for safe starter targets.
- SimSpace remains the default for app validation.
- Unsupported commands fail before execution.
- Every run produces a report, including failures.
- Reports include status, simtime, run folder, artifacts, console errors, failed step, and next suggested action.
- Heavy browser/video validation is optional.
- Repeated validation avoids unnecessary large copies when safe.

## Mediums

- Browser app via Playwright.
- Filesystem output via file simtime.
- Terminal/CLI tool via terminal simtime.
- Game/canvas via Playwright plus canvas checks.
- AR/runtime via specialized runtime simtimes.
- Human review loop via human-interaction simtime.
- API service via future API simtime.
