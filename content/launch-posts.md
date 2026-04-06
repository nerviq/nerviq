# Nerviq Launch Posts — NERVIQ-branded, 8 Platforms

**Status:** Ready for publishing
**Date:** 2026-04-06
**CLI Version:** 1.7.0
**Checks:** 2,431 across 8 platforms, 10 languages, 62 domain packs

## Key Links

- GitHub: https://github.com/nerviq/nerviq
- npm: https://www.npmjs.com/package/@nerviq/cli
- Website: https://nerviq.net
- Releases: https://github.com/nerviq/nerviq/releases

---

## Post 1: Reddit r/ClaudeAI

**Title:** I built a CLI that audits your AI coding agent setup — 2,431 checks across 8 platforms

**Body:**

I built Nerviq, a zero-dependency CLI that scores how well your repo is set up for AI coding agents.

It audits **8 platforms**: Claude Code, Codex, Gemini CLI, Copilot, Cursor, Windsurf, Aider, and OpenCode.

**2,431 checks** across instructions, hooks, commands, permissions, MCP config, verification loops, and more.

```bash
npx @nerviq/cli audit
```

```
  Score: 78/100

  🔴 3 critical  🟡 12 high  🔵 8 recommended

  Top 3 things to fix right now:
  1. 🔴 Add verification commands to CLAUDE.md
  2. 🟡 Configure deny rules for dangerous operations
  3. 🟡 Add path-specific rules

  See all 23 failed checks: nerviq audit --full
```

New in v1.7: `nerviq fix <check>` auto-fixes what it can and shows the score impact:

```
  ✅ Fixed: CLAUDE.md project instructions
  Score: 4 → 16 (+12)
```

It works trust-first:
- audit first (reads only, writes nothing)
- suggest-only / plan before any writes
- apply only what you approve
- rollback artifacts for every change

Cross-platform? `nerviq harmony-audit` detects drift between your platforms and helps sync them.

Zero dependencies. No API keys. Runs local. AGPL-3.0.

GitHub: https://github.com/nerviq/nerviq

Would love feedback — especially from people using multiple AI coding tools.

---

## Post 2: Reddit r/ChatGPTCoding

**Title:** Most AI coding agent setups are broken — not the model, the config around it

**Body:**

The real problem with Claude Code / Codex / Cursor isn't "can the model write code?". It's "is the repo actually configured so the agent can work safely and predictably?".

I built `nerviq` to audit exactly that surface. It checks **2,431 things** across **8 platforms** (Claude, Codex, Gemini, Copilot, Cursor, Windsurf, Aider, OpenCode).

```bash
npx @nerviq/cli audit
```

The most common misses across repos I've tested:
- No deny rules (agents can read .env files)
- No verification commands (agent can't self-check)
- Hooks in files but not registered in settings
- No architecture diagram (agent wastes tokens guessing structure)
- Multiple AI platforms with conflicting configs

What's different about Nerviq:
- Every check has a `confidence` level and links to source documentation
- `nerviq fix <check>` auto-fixes with before/after score
- `nerviq harmony-audit` catches drift between your platforms
- Zero dependencies, runs locally, no API keys

If you use 2+ AI coding tools, the cross-platform drift detection alone is worth trying.

GitHub: https://github.com/nerviq/nerviq

---

## Post 3: Dev.to Article

**Title:** Your AI coding agent scores 10/100. Here's what it's missing.

**Tags:** ai, productivity, devtools, claudecode

**Body:**

After testing **2,431 checks** across **8 AI coding platforms** on real repos, I found a clear pattern: most projects use barely 10% of what's available.

I built Nerviq — a zero-dependency CLI that audits your AI coding agent setup and scores it 0-100.

```bash
npx @nerviq/cli audit
```

Most projects score **10-20 out of 100**. After running setup, they jump to **60-80+**.

## The Top 10 Things You're Probably Missing

### 1. Instructions file (Critical)

Every AI coding platform has one: `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `GEMINI.md`. Without it, the agent doesn't know your build commands, code style, or project rules.

### 2. Architecture diagrams (73% token savings)

A Mermaid diagram gives your agent the project structure in a fraction of the tokens that prose requires.

### 3. Hooks > instructions (100% vs 80% compliance)

Written instructions are advisory (~80% compliance). Hooks are deterministic (100%). Auto-lint after every edit. Every time.

### 4. Verification commands

> *This is the single highest-leverage thing you can do.* — Anthropic Best Practices

Agents perform dramatically better when they can verify their own work.

### 5. Deny rules

Your AI agent loads `.env` files automatically. Without deny rules, it can read secrets. This is the most common critical finding.

### 6. Custom commands

Stop typing the same prompts. Create `/test`, `/deploy`, `/review` as reusable commands.

### 7. Cross-platform drift

If you use Claude + Cursor + Copilot, their configs probably conflict. `nerviq harmony-audit` catches this automatically.

### 8. Permission profiles

Most setups either allow everything or block everything. There are better profiles: `read-only`, `suggest-only`, `safe-write`, `power-user`.

### 9. MCP configuration

MCP servers extend what your agent can do, but >10 servers or >80 tools degrades performance.

### 10. Stack-specific checks

Python, Go, Rust, Java, Ruby, PHP, .NET, Flutter, Swift, Kotlin — each has specific agent configuration needs.

## New: Auto-fix

```bash
nerviq fix                    # Show what's fixable
nerviq fix claudeMd           # Fix a specific check
nerviq fix --all-critical     # Fix all critical issues
```

Every fix shows the score impact: `Score: 4 → 16 (+12)`.

## Safety first

- `nerviq audit` — reads only, writes nothing (default)
- `nerviq suggest-only` — markdown report, no file writes
- `--dry-run` — preview changes
- `--config-only` — only touches config files, never source code
- Every write creates rollback artifacts

## Try it

```bash
npx @nerviq/cli audit              # Quick scan: score + top 3
npx @nerviq/cli audit --full       # All checks + confidence levels
npx @nerviq/cli suggest-only       # Share results with your team
npx @nerviq/cli harmony-audit      # Cross-platform alignment
```

Zero dependencies. No API keys. Runs locally. AGPL-3.0.

**GitHub:** [github.com/nerviq/nerviq](https://github.com/nerviq/nerviq)
**npm:** [npmjs.com/package/@nerviq/cli](https://www.npmjs.com/package/@nerviq/cli)
**Website:** [nerviq.net](https://nerviq.net)

---

## Post 4: Twitter/X Thread

**Tweet 1:**
I built a CLI that audits AI coding agent setups across 8 platforms and 2,431 checks.

```
npx @nerviq/cli audit

Score: 78/100
🔴 3 critical  🟡 12 high  🔵 8 recommended
```

Claude, Codex, Gemini, Copilot, Cursor, Windsurf, Aider, OpenCode.

Zero deps. Runs local. Free.

github.com/nerviq/nerviq

**Tweet 2:**
The most common misses are boring and important:

- No deny rules (agent can read .env)
- No verification commands (agent can't self-check)
- Hooks in files but not registered
- No architecture diagram (wasting tokens)
- Multiple AI tools with conflicting configs

**Tweet 3:**
New in v1.7:

`nerviq fix claudeMd` — auto-fix a check, see the score impact:

```
✅ Fixed: CLAUDE.md project instructions
Score: 4 → 16 (+12)
```

`nerviq fix --all-critical` for batch fixes.

Every recommendation shows its confidence level.

**Tweet 4:**
Using 2+ AI coding tools? Configs probably conflict.

`nerviq harmony-audit` detects drift between platforms and helps sync them.

It catches things like: Cursor allows file writes but Claude denies them, or Copilot sees your CLAUDE.md but ignores its own instructions.

**Tweet 5:**
Trust-first design:

- audit = read-only (default)
- suggest-only = markdown report
- --dry-run = preview changes
- --config-only = never touches source
- Every write has rollback

2,431 checks, each with source URL and confidence level.

github.com/nerviq/nerviq

---

## Post 5: Hacker News (Show HN)

**Title:** Show HN: Nerviq — Audit and govern AI coding agent setups across 8 platforms (2,431 checks)

**Body:**

Nerviq is a zero-dependency CLI that scores how well a repo is configured for AI coding agents.

It supports 8 platforms: Claude Code, Codex (OpenAI), Gemini CLI, GitHub Copilot, Cursor, Windsurf, Aider, and OpenCode.

What it checks (2,431 checks across 96 categories):
- Instructions files (CLAUDE.md, AGENTS.md, .cursorrules, GEMINI.md)
- Hooks, commands, agents, skills
- Permission profiles and deny rules
- MCP server configuration
- Verification loops
- Cross-platform drift (when using 2+ tools)
- Stack-specific: Python, Go, Rust, Java, Ruby, PHP, .NET, Flutter, Swift, Kotlin

```bash
npx @nerviq/cli audit              # Quick scan (default)
npx @nerviq/cli audit --full       # All checks with confidence levels
npx @nerviq/cli fix --all-critical # Auto-fix critical issues
npx @nerviq/cli harmony-audit      # Cross-platform alignment
```

Design decisions:
- Zero dependencies (nothing to audit)
- Local-only by default (no network calls except opt-in deep-review)
- Audit is read-only (writes nothing)
- Every write command has --dry-run and creates rollback artifacts
- Every check has a sourceUrl and confidence score (0.0-1.0)
- AGPL-3.0

What it doesn't do: It doesn't review your application code. It reviews how your AI coding agents are configured and governed. Think of it as a linter for agent workflow setup, not for source code.

GitHub: https://github.com/nerviq/nerviq
npm: https://www.npmjs.com/package/@nerviq/cli

Happy to answer questions about the design, the research behind the checks, or cross-platform drift detection.
