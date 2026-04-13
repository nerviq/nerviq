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
what we uniquely see. The 8 patterns above reflect the real trust
breaks we've observed in the 2026-04-08 UAT evaluations and across
the 61-repo PP-08 corpus.

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

The 2026-04-14 initial release ships with 8 patterns. We are
deliberately holding 2 of the 10 reserved slots empty until 30
days of real user telemetry tells us which patterns users most
wanted that we didn't anticipate.

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
