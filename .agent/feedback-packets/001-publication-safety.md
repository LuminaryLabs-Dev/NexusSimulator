# Publication Safety

Status: addressed in 0.0.1 release candidate

## Feedback

Public releases must not include generated runtime records, machine-specific paths, real contact data, or credentials.

## Required Proof

- Scan the current tree and public branch history.
- Inspect the npm file allowlist with `npm pack --dry-run`.
- Keep the remote private until source and package validation pass.
- Preserve pre-rewrite history only in a private backup.
