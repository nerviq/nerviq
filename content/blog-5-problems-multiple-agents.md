---
title: "5 Real Problems When Running Multiple AI Agents in One Repo"
date: 2026-04-06
author: NERVIQ Team
tags: [multi-agent, problems, real-world, developer-experience]
---

# 5 Real Problems When Running Multiple AI Agents in One Repo

Your team uses Claude Code. One dev prefers Cursor. Someone just added Copilot. Another is testing Codex. Six months later, nobody knows which config file actually matters. Here are five problems we have seen repeatedly in real projects, with concrete examples and fixes.

## 1. Conflicting Rules

**The scenario.** Your team standardized on test-driven development. The lead engineer wrote it into `CLAUDE.md`. Meanwhile, a frontend dev set up `.cursorrules` for rapid prototyping with tests explicitly skipped.

**What goes wrong.** Both files live in the repo root, and they directly contradict each other:

```yaml
# CLAUDE.md
## Dev Rules
- Always write tests before implementation
- No PR without test coverage > 80%
```

```yaml
# .cursorrules
rules:
  - Skip tests for prototypes and UI components
  - Focus on speed, not coverage
```

A dev using Claude Code writes tests first. The same dev switches to Cursor for a quick UI fix and gets code with zero tests. The PR gets merged because reviewers only check the code, not which agent generated it.

**The fix.** Establish a single source of truth for dev rules and generate agent-specific configs from it. One canonical policy file, multiple outputs. Tooling like `npx @nerviq/cli sync` can detect contradictions across config files automatically.

## 2. Orphaned Configs

**The scenario.** The team migrated from Cursor to Claude Code three months ago. The migration was smooth, everyone is productive, and nobody thought to clean up.

**What goes wrong.** The repo root now looks like this:

```
$ ls -la .*rules* .*claude* CLAUDE.md AGENTS.md
-rw-r--r--  .cursorrules          # Last modified: Jan 2026
-rw-r--r--  .cursorignore          # Last modified: Jan 2026
-rw-r--r--  CLAUDE.md              # Last modified: Apr 2026
-rw-r--r--  .claude/settings.json  # Last modified: Apr 2026
-rw-r--r--  AGENTS.md              # Last modified: Nov 2025 (!)
```

A new dev joins, tries Cursor on the repo, picks up three-month-old rules, and wonders why their output looks nothing like the rest of the team's. Two hours of debugging later, someone notices the stale `.cursorrules`.

**The fix.** Audit your repo for agent config files regularly. Any file that belongs to a tool the team no longer uses should be removed or explicitly marked deprecated. A quick `npx @nerviq/cli audit` flags orphaned configs in seconds.

## 3. Security Drift

**The scenario.** Your DevOps lead configured Copilot with strict deny rules. Nobody applied the same rules to Claude Code or Codex. The team assumes "all agents are equally safe."

**What goes wrong.** Security coverage is inconsistent across agents:

| Security Feature         | Copilot         | Claude Code     | Codex           |
|--------------------------|-----------------|-----------------|-----------------|
| Deny dangerous commands  | `rm -rf`, `DROP TABLE`, `chmod 777` | Not configured | Not configured |
| Secret detection         | Built-in filter | Not configured  | Not configured  |
| File write restrictions  | Read-only mode  | Full access     | Sandbox only    |
| Network access           | Blocked         | Allowed         | Blocked         |

A dev using Claude Code runs a cleanup script that includes `rm -rf dist/` in a generated shell command. Copilot would have blocked it. Claude Code does not, because nobody added deny rules to `.claude/settings.json`.

**The fix.** Define security policies once, then enforce them across every agent config. Your `settings.json` should include explicit deny patterns, and those patterns should match what other agents already enforce. Drift detection tooling catches gaps before they become incidents.

## 4. Version/Format Drift

**The scenario.** You wrote `AGENTS.md` when Codex launched, following the v1 documentation format. Two months later, Codex updated how it parses the file. Nobody on the team noticed.

**What goes wrong.** The original format used flat headers:

```markdown
# AGENTS.md (old format - v1)
## Agent: backend
- Role: Handle API routes
- Rules: Use Express, write JSDoc
```

The new format expects structured sections:

```markdown
# AGENTS.md (new format - v2)
## backend
### prompt
Handle API routes using Express. Write JSDoc for all exports.
### files
- src/api/**
- src/middleware/**
```

Codex silently ignores the old format. The `backend` agent definition does nothing. The dev thinks Codex is broken; it is actually just reading an empty config.

**The fix.** Pin the format version in your config files and validate on CI. When an agent platform updates its schema, your pipeline should catch the mismatch. `npx @nerviq/cli audit` checks known format versions against what is in your repo.

## 5. Team Confusion

**The scenario.** Five developers, three different agents, no shared standard. Each dev configured their preferred agent independently. Nobody reviews config file changes in PRs.

**What goes wrong.** The git log tells the story:

```
$ git log --oneline -- .cursorrules .claude/ CLAUDE.md AGENTS.md .github/copilot*
a]3f291 alice: update CLAUDE.md - add "use tabs"
b72c4e0 bob: update .cursorrules - add "use spaces"
c91d3a1 carol: update AGENTS.md - add "use 4-space indent"
d04e5b2 dave: update CLAUDE.md - revert to spaces
e58f1c3 alice: update .cursorrules - "always use semicolons"
f62a7d4 carol: update CLAUDE.md - "never use semicolons"
```

Six commits, three files, zero consistency. The agents produce different formatting depending on which dev last touched which config. Code style arguments now happen in config files instead of code reviews.

**The fix.** Treat agent configs like infrastructure code. Add a CODEOWNERS rule that requires review from a designated maintainer. Better yet, generate all agent configs from a single policy definition so individual edits cannot create drift.

---

## The Pattern

All five problems share one root cause: there is no governance layer above the individual agents. Each tool has its own config format, its own rules, its own security model. Without something sitting above them to enforce consistency, drift is inevitable.

This is not a tooling failure. Claude Code, Cursor, Copilot, and Codex each work fine in isolation. The problem appears the moment you have two or more of them in the same repo, or the moment one dev's config diverges from another's.

Governance does not mean bureaucracy. It means: one source of truth, validated automatically, generating per-agent configs as needed.

## One Command to Start

You do not need to solve all five problems at once. Start with a diagnostic:

```bash
npx @nerviq/cli audit
```

This scans your repo for agent config files, flags contradictions, detects orphaned configs, checks format versions, and reports security coverage gaps. Five minutes to run, and you will know exactly where you stand.

From there, fix the highest-risk issue first. Usually that is security drift (Problem 3) or conflicting rules (Problem 1). The rest can wait until your next sprint planning.
