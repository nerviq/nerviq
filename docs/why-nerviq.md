# Why Nerviq

> Vendors govern their own agent. Nerviq governs ALL your agents.

Nerviq is AI agent governance and configuration intelligence for repositories using modern coding agents. It does **not** replace SAST, secret scanning, or deep application code review.

---

## The Problem

Your team uses Claude Code, Cursor, and Copilot in the same repo. Each has its own config format, its own rules syntax, and its own way of handling permissions. Without governance:

- **Config drift** — CLAUDE.md says "never modify tests", .cursorrules says nothing about it
- **Security gaps** — Copilot has deny rules, but your Gemini setup doesn't
- **Invisible standards** — New team members don't know which agent is configured for what
- **No audit trail** — Nobody knows when configs changed or why scores dropped

## Why Not Just Manage It Manually?

| | Manual | Nerviq |
|---|---|---|
| Time to audit 8 platforms | Hours | 30 seconds |
| Drift detection | None | Automatic |
| Cross-platform sync | Copy-paste | `nerviq harmony-sync` |
| Rollback on mistake | Hope you have git stash | `nerviq rollback` |
| CI enforcement | Custom scripts | One-line GitHub Action |
| Score trending | Spreadsheet | `nerviq history` |

## Why Not Use Platform-Native Tools?

GitHub governs Copilot. Anthropic governs Claude. Google governs Gemini.

**None of them will govern their competitor's agent.**

Nerviq is the only tool that sits above all 8 platforms and provides:
- Unified scoring (0-100) across every platform
- Cross-platform drift detection (Harmony)
- Multi-agent synergy analysis (Synergy)
- One config standard, 8 platform outputs

## Why Not Semgrep / Snyk / Security Scanners?

Different category entirely. Semgrep scans **code** for vulnerabilities. Nerviq scans **agent configurations** for governance gaps.

Semgrep won't tell you that your CLAUDE.md is missing verification commands, or that your .cursorrules conflict with your AGENTS.md, or that your Copilot setup lacks deny rules.

## Three Use Cases

### Solo Developer
```bash
npx @nerviq/cli audit        # See your score
npx @nerviq/cli augment      # Get improvement plan
npx @nerviq/cli benchmark    # Measure the difference
```
**Result:** Better-configured AI agents → better code output → fewer mistakes.

### Team Lead / DevEx
```bash
npx @nerviq/cli governance   # Set team policies
npx @nerviq/cli audit --json # Pipe to CI
```
**Result:** Consistent agent behavior across the team. No more "works on my machine" for AI configs.

### Enterprise / Platform Engineering
```bash
npx @nerviq/cli harmony-audit      # Cross-platform health
npx @nerviq/cli harmony-drift      # Detect drift
npx @nerviq/cli harmony-governance # Unified policies
```
**Result:** Governance, compliance, and audit trails for AI agent operations at scale.

## The Numbers

- **2,441 checks** across 8 platforms (~300 unique governance rules adapted per platform) and 10 languages
- **Every check** has a source URL, confidence score, and freshness date
- **90-day freshness cycle** — stale checks are re-verified or removed
- **Zero dependencies** — nothing to audit in the supply chain
- **Runs locally** — your code never leaves your machine

---

[Get started](https://github.com/nerviq/nerviq) | [Documentation](https://nerviq.net) | [Discord](https://discord.gg/nerviq)
