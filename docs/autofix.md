# Autofix with `nerviq audit --fix`

`nerviq audit --fix` runs the normal audit, applies the fixable critical recommendations that are in scope for autofix, and then re-audits the repo.

## Command surface

```bash
nerviq audit --fix
nerviq audit --fix --auto
nerviq audit --fix --dry-run
```

- `nerviq audit --fix`
  Uses the conservative default flow. Nerviq plans the critical fixes, shows the file diff, and asks for confirmation per file before writing.

- `nerviq audit --fix --auto`
  Applies the same critical fixes without prompts. This is the intended mode for CI or scripted remediation.

- `nerviq audit --fix --dry-run`
  Shows the proposed diff and exits without writing files.

## What v1 fixes

This first pass focuses on instruction-surface remediation:

- Missing `CLAUDE.md` baseline instructions.
- Missing verification guidance for critical audit checks.
- Hygiene templates that can be created safely (`LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`) through the shared fix engine.

Autofix deliberately does **not** rewrite security, hooks, or permission-sensitive findings in this release.

## Safety model

- Dry-run stays dry: no file writes and no rollback artifacts.
- Files that contain the literal `DO NOT AUTOEDIT` marker are skipped.
- `audit --fix` only targets fixable **critical** findings in this release.
- A rollback manifest is written to `.nerviq/rollbacks/` after successful writes.
- Nerviq re-audits after applying fixes and exits with a non-zero status if the targeted checks still fail.

## Exit codes

- `0`: all targeted fixes applied and the targeted checks pass after re-audit
- `1`: a targeted fix failed, was skipped for safety, or still fails after re-audit
- `2`: bad flag combination or no fixable critical findings are available

## Examples

Preview the exact patch without touching the working tree:

```bash
nerviq audit --fix --dry-run
```

Apply fixable critical items in CI:

```bash
nerviq audit --fix --auto
```

Apply with per-file confirmation in an interactive terminal:

```bash
nerviq audit --fix
```
