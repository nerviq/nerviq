# Shallow Risk Mode (experimental)

`nerviq audit --shallow-risk` surfaces obvious problems at the
intersection of your AI agent configuration and your codebase.
It is opt-in, experimental, and deliberately narrow.

## When to turn this on

**You want this when:** your team runs one or more AI coding agents
(Claude Code, Cursor, Codex, Copilot, Gemini, Windsurf, Aider,
OpenCode) against a real repository and you want to catch the
"silent mismatch" class of problems where your agent's declared
context diverges from your actual code.

**You don't want this when:** your goal is general-purpose code
security. For that, pair NERVIQ with a dedicated tool (Semgrep,
CodeQL, gitleaks, Dependabot). NERVIQ is not a SAST tool and has
never claimed to be.

## What it catches - by example

### 1. Your agent config points at a file that doesn't exist

```markdown
<!-- CLAUDE.md -->
## Security model

See [docs/SECURITY.md](./docs/SECURITY.md) for how we handle
secrets and compliance.
```

But `docs/SECURITY.md` doesn't exist. Claude Code follows the link,
finds nothing, and quietly works with incomplete context. Every
session.

NERVIQ flags: `agent-config-missing-file: CLAUDE.md references
docs/SECURITY.md but the file is missing. Agent guidance is
incomplete.`

### 2. Your agent config contradicts your actual codebase

```markdown
<!-- CLAUDE.md -->
This is a Go microservice. Run `go test ./...` before committing.
```

The repo is actually Python. There is no `go.mod`. Claude
recommends Go tooling forever.

NERVIQ flags: `agent-config-stack-contradiction: CLAUDE.md declares
primary stack as "Go" but the repo contains Python signals
(pyproject.toml, 47 .py files) and no Go signals.`

### 3. Two agents get contradictory instructions

- `.cursor/rules/main.mdc`: "Use TypeScript strict mode."
- `CLAUDE.md`: "This is a pure JavaScript project."

Each agent does something slightly different. Teams hit drift
they can't explain.

NERVIQ flags: `agent-config-cross-platform-drift: CLAUDE.md and
.cursor/rules/main.mdc disagree on primary language.`

### 4. Your MCP server has no permission boundary

```json
// .claude/settings.json
{
  "mcpServers": {
    "shell": {
      "command": "node",
      "args": ["./scripts/shell-mcp.js"],
      "permissions": []
    }
  }
}
```

`permissions: []` is empty. The MCP server can run anything.

NERVIQ flags: `mcp-server-no-allowlist: MCP server "shell" in
.claude/settings.json has empty permissions - full access, no
allowlist. Review and add an allow-list.`

### 5. Your hook script is referenced but missing

```json
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [{
      "hooks": [{
        "type": "command",
        "command": ".claude/hooks/pre-commit.sh"
      }]
    }]
  }
}
```

The file `.claude/hooks/pre-commit.sh` doesn't exist. Every pre-tool
hook silently fails and Claude proceeds anyway.

NERVIQ flags: `hook-script-missing: .claude/settings.json declares a
PreToolUse hook at .claude/hooks/pre-commit.sh, but the file is
missing. Hook is silently skipped.`

### 6. A secret ended up in an agent-config file

```markdown
<!-- CLAUDE.md -->
## Testing

For local smoke tests, use this Stripe test key:
sk_live_<redacted-example>
```

That key made it into Git history inside `CLAUDE.md` specifically.
NERVIQ catches secrets inside agent-config files because that's
where we uniquely see them - not as a general secret scanner,
which you should already be running.

NERVIQ flags: `agent-config-secret-literal: CLAUDE.md contains a
Stripe-live-key shape on line 42. Rotate the key and remove from
history.`

### 7. Your config uses keys the platform removed

```yaml
# .aider.conf.yml
auto-commit: true
weak-model: gpt-3.5-turbo
```

Aider 0.60 removed `auto-commit`. It is silently ignored. You
believe your repo has auto-commit, but it does not.

NERVIQ flags: `agent-config-deprecated-keys: .aider.conf.yml uses
"auto-commit" (removed in Aider 0.60+). Config key is silently
ignored.`

### 8. Auto-approval on a destructive pattern

```json
// .claude/settings.json
{
  "permissions": {
    "allow": [
      "Bash(npm test *)",
      "Bash(rm -rf *)"
    ]
  }
}
```

`rm -rf *` is pre-approved. An agent loop deciding to "clean up"
can now do so without asking.

NERVIQ flags: `agent-config-dangerous-autoapprove: .claude/settings.json
allow-list contains "Bash(rm -rf *)". This pattern is pre-approved
and cannot be revoked per-invocation.`

### 9. Your agent doc names a task the repo runner doesn't have

```makefile
# Makefile
.PHONY: test
test:
	pytest -q
```

```markdown
<!-- CLAUDE.md -->
Run `make test`, then `make coverage` before opening a PR.
```

`make coverage` does not exist. The agent runs it, gets
`No rule to make target 'coverage'`, and improvises.

NERVIQ flags: `agent-config-task-not-in-runner: CLAUDE.md tells the
agent to run a task that does not exist: `make coverage` is not a
target in Makefile.`

Runners covered: `Makefile` (incl. `.PHONY`), `justfile`, `Taskfile.yml`,
`composer.json` scripts, `Rakefile` + `lib/tasks/*.rake`, `tox.ini`
environments, and `Makefile.toml` (cargo-make). Prose-prone verbs are only
read as invocations inside backticks, so "make sure the tests pass" is
never a finding.

### 10. Your agent doc pins a toolchain version the manifest contradicts

```toml
# pyproject.toml
[project]
requires-python = ">=3.12"
dependencies = ["django>=5.1"]
```

```markdown
<!-- CLAUDE.md -->
A Python 3.10 project built on Django 4.
```

Two lies in one sentence. The agent writes code for the wrong
Python and the wrong Django.

NERVIQ flags: `agent-config-toolchain-version-mismatch: CLAUDE.md
references Python 3.10, but pyproject.toml declares >=3.12.`

Manifests read: `go.mod`, `Cargo.toml` (edition + rust-version),
`pyproject.toml`, `requirements.txt`, `.python-version`, `composer.json`,
`Gemfile`, `.nvmrc`, and `package.json` `engines.node`. Migration notes
("we upgraded from Go 1.19") and supported-version lists are not findings.

### 11. Your config exists, and the platform never loads it

```markdown
<!-- AGENTS.md -->
# Build with `make release`. Never commit to main.
```

```markdown
<!-- CLAUDE.md -->
# Project notes
...
```

Claude Code reads `CLAUDE.md`, **not** `AGENTS.md`. Without an
`@AGENTS.md` import or a symlink, Codex / Copilot / Cursor follow those
instructions and Claude never sees them.

NERVIQ flags: `agent-config-silently-ignored: Both AGENTS.md and CLAUDE.md
exist, but CLAUDE.md never imports AGENTS.md.`

The same detector covers the rest of the "declared but never loaded" family:

| Shape | Why it is silent |
|---|---|
| Plain `.md` inside `.cursor/rules/`, or `.mdc` without frontmatter | Cursor loads neither; no warning |
| `.cursorrules` in a repo that already uses `.cursor/rules/` | No longer a documented format |
| `paths:` / `globs:` frontmatter matching no file in the repo | A scoped rule that never fires never appears in `/context` either |
| Hooks under an event the platform does not define | The JSON parses; the hook runs never |
| Instruction file in UTF-16, or with NUL bytes | Toolchains read UTF-8; the file arrives as mojibake |

Calibration matters more here than anywhere else, so the detector stays
silent on a deliberate per-platform split (an AGENTS.md that declares itself
the companion to CLAUDE.md), on a marker-only AGENTS.md, and on a rule where
at least one glob is live.

## What this mode explicitly does not catch

For each of these, use the right tool. NERVIQ deliberately does
not try to be "everything."

| You need this | Use this, not NERVIQ |
|---|---|
| Find SQL injection, XSS, SSRF, open redirects in source | Semgrep, CodeQL |
| Language-level code smells, style, complexity | ESLint, Bandit, rubocop, etc. |
| Full secret scanning across repo + git history | gitleaks, truffleHog |
| Dependency CVEs | Dependabot, Snyk, OSV |
| Compliance (SOC 2 / PCI / HIPAA / ISO 27001) | a compliance platform |
| Runtime exploitation / DAST | a DAST tool |

NERVIQ's job is the agent-configuration <-> codebase bridge. That's
what we uniquely see. The 13 patterns above reflect the real trust
breaks we've observed in the 2026-04-08 UAT evaluations and across
the 61-repo PP-08 corpus, plus the 2026-07-29 extension of the wedge
beyond the npm ecosystem (patterns 9-10) and the promotion of the
permission/exposure patterns into `nerviq drift` by default.

## How to run it

```bash
# Full audit + shallow risk (recommended)
npx @nerviq/cli audit --shallow-risk

# Shallow risk only (fast precommit hook)
npx @nerviq/cli audit --shallow-risk-only

# Skip it entirely (default; no flag needed)
npx @nerviq/cli audit

# Emergency disable (overrides any flag):
NERVIQ_SHALLOW_RISK=off npx @nerviq/cli audit --shallow-risk
```

### In CI, as a PR comment

```yaml
- run: npx @nerviq/cli audit --shallow-risk --format=markdown --out audit.md
- uses: marocchino/sticky-pull-request-comment@v2
  with:
    path: audit.md
```

Shallow-risk findings are rendered in their own `### Shallow Risk`
section with the experimental banner - clearly distinguished from
the governance audit output so reviewers know what they're looking
at.

## Status: Experimental

The 2026-04-14 initial release shipped 8 patterns. 2026-07-29 added
patterns 9-10 (non-npm task runners and toolchain versions), taking the
set to 12 including the two npm stale-reference patterns that already
ran default-on.

Four of these patterns - `agent-config-secret-literal`,
`agent-config-dangerous-autoapprove`, `mcp-server-no-allowlist`, and
`hook-script-missing` - are no longer gated behind this flag: they run
by default inside `nerviq drift` under "Permission & exposure". They are
as deterministic as the stale-reference patterns, and hiding the
highest-stakes findings behind an experimental flag was the wrong
default.

The feature graduates:
- **Experimental -> Beta**: after 30 days of usage telemetry with
  zero critical corpus-level false positives reported, and at
  least one external user reporting that a pattern caught a real
  issue.
- **Beta -> GA**: after 50+ weekly active audits across 5 or more
  distinct repos by real users.

## Feedback

Run `nerviq feedback` to send us a short note if a shallow-risk
finding was wrong (false positive) or if we missed something
obvious we should catch. We read every one. The initial pattern
set was picked from real UAT evaluations; the reserved slots are
explicitly waiting for real-user signal to fill.

## Why "shallow"?

Because the patterns are deliberately simple - file existence,
key presence, regex match against agent-config files. No
dataflow, no control-flow, no runtime. If the patterns were
deep, we'd be Semgrep or CodeQL, and we're not.

NERVIQ is sharp on the agent-governance lane. Shallow-risk is
the opt-in extension that catches the obvious mismatches at the
edge of that lane - the places users have told us trust breaks
first.
