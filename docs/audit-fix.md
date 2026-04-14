# Audit Autofix with `nerviq audit --fix`

`nerviq audit --fix` is the safe autofix lane for deterministic governance and hygiene issues.

It is intentionally conservative:

- Dry-run is the default.
- Nerviq writes a unified diff patch to `audit-fix.patch` unless you redirect it with `--out`.
- Only deterministic, file-level fixes are planned.
- Anything that still needs repo judgment is listed as advisory-only and left untouched.

## Command surface

```bash
nerviq audit --fix
nerviq audit --fix --out custom-audit-fix.patch
nerviq audit --fix --out -
nerviq audit --fix --apply --auto
nerviq audit --fix --pr
```

- `nerviq audit --fix`
  Runs the audit, builds a deterministic autofix plan, prints a `git status --short` style summary, and writes `audit-fix.patch`.

- `nerviq audit --fix --out custom-audit-fix.patch`
  Writes the patch to a custom file path relative to the audited repo.

- `nerviq audit --fix --out -`
  Prints the unified diff to stdout instead of creating a patch file.

- `nerviq audit --fix --apply --auto`
  Applies the deterministic fixes, writes a rollback manifest under `.nerviq/rollbacks/`, and re-runs the audit.

- `nerviq audit --fix --pr`
  Applies the same deterministic fixes, creates a local branch named `nerviq/autofix-<timestamp>`, stages the changed files plus the patch, and leaves the review to the user.

## Hard safety boundaries

Audit autofix never modifies source code.

The path allowlist is intentionally narrow:

- `CLAUDE.md`
- `.claude/CLAUDE.md`
- `AGENTS.md`
- `.codex/AGENTS.md`
- `.claude/settings.json`
- `.gitignore`
- `.editorconfig`
- `CHANGELOG.md`
- `CONTRIBUTING.md`
- `LICENSE`

If a planned change falls outside that list, Nerviq skips it.

Files that contain the literal `DO NOT AUTOEDIT` marker are also skipped.

## What is considered deterministic

Examples of safe, deterministic fixes in this lane:

- create `CLAUDE.md` or `AGENTS.md` boilerplate when the instruction file is missing
- add canonical verification commands to an existing instruction file
- create `.claude/settings.json` with deny rules that protect `.env` and secret-like paths
- add `.env`, `.env.*`, and local override files to `.gitignore`
- create `.editorconfig`, `CHANGELOG.md`, `CONTRIBUTING.md`, or `LICENSE` placeholders

Examples that stay advisory-only:

- anything that changes product code
- fixes that need a repo-specific architecture decision
- hooks, commands, or permission policies that require team judgment
- content changes where Nerviq cannot prove a safe template

## Evidence model

Every proposed change is linked to file-level evidence:

- existing findings use the audit result's `file:line` evidence when available
- missing-file fixes fall back to the target file at line `1`

This keeps the autofix plan aligned with the CTO-04 file-evidence contract.

## Output contract

The dry-run summary shows one line per planned file operation:

```text
  A  CLAUDE.md            (CLAUDE.md:1)            [claudeMd, verificationLoop]
  M  .gitignore           (.gitignore:1)          [gitIgnoreEnv]
  A  .claude/settings.json (.claude/settings.json:1) [secretsProtection]
```

- `A` means a new file will be created.
- `M` means an existing file will be patched.
- The `(file:line)` segment shows the evidence or insertion anchor.
- The bracketed list shows which failed checks the operation addresses.

## Exit codes

- `0` plan generated successfully, or apply completed and the targeted deterministic checks now pass
- `1` apply attempted but at least one targeted deterministic check still failed after re-audit
- `2` no deterministic audit autofixes are available, or the flag combination is invalid

## Notes

- `--apply` requires `--auto`. The dry-run path is the safe default.
- `--pr` implies the apply path and requires a git repository.
- Audit autofix is not a substitute for a full review. It handles the obvious, localized file work and leaves judgment-heavy items as advisories.
