# How Nerviq Verifies 2,438 Checks (~300 Governance Rules × 8 Platforms)

## Overview

Nerviq is a rule-based audit engine for AI coding agent configurations with evidence tracking. Every check we ship is traceable to primary documentation or verified experiment results. Checks are structured assertions backed by official vendor docs, runtime experiments, and continuous feedback calibration — but they are rules, not AI-generated insights.

This document explains the full lifecycle: how checks are created, verified, rated, maintained, and retired.

## Check Anatomy

Each check in the Nerviq catalog is a structured object with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier following the `{CATEGORY}-{SEQUENCE}` pattern (e.g., `CU-A01`, `SC-B14`, `AU-C03`) |
| `name` | `string` | Human-readable description of what the check detects |
| `check(ctx)` | `function` | Detection function that inspects the `ProjectContext` and returns `true`, `false`, or `null` |
| `impact` | `enum` | Severity level: `critical`, `high`, or `medium` |
| `confidence` | `number` | Score from 0.0 to 1.0 reflecting certainty that this check is accurate and current |
| `sourceUrl` | `string` | URL pointing to the official documentation backing this check |
| `category` | `string` | One of 96 categories (e.g., `memory`, `security`, `quality`, `automation`, `hooks`) |
| `fix` | `string` | Actionable remediation guidance shown when the check fails |

### Return values

The `check(ctx)` function receives a `ProjectContext` — a normalized view of the project's files, configuration, and environment. It returns:

- `true` — the practice is present (pass)
- `false` — the practice is missing (finding)
- `null` — the check is not applicable to this project (e.g., a Node.js check in a Python project)

Checks are keyed by a stable string identifier (e.g., `claudeMd`, `permissionDeny`, `codexAgentsMd`) that remains consistent across versions. This enables feedback tracking and trend analysis over time.

## Verification Levels

Every check is assigned a confidence score that maps to one of three verification levels:

### HIGH confidence (0.7–1.0)

The check is backed by official platform documentation **and** has been validated through a runtime experiment. A maintainer executed the check logic against real project fixtures and observed the expected outcome.

| Condition | Score |
|-----------|-------|
| Runtime-verified with passing experiment and test coverage | **0.9** |
| Community-confirmed (positive feedback rate > 80%) | **0.9** |
| Documented in official vendor docs, not yet runtime-tested | **0.7** |

This tier covers approximately 65% of the catalog. These checks appear as primary recommendations in audit output.

### MEDIUM confidence (0.4–0.69)

The check is backed by official documentation or established community best practice, but has not been independently verified through a runtime experiment. Common reasons: the platform feature is too new for full experiment coverage, or the check logic relies on behavioral observations that are difficult to isolate in a fixture.

| Condition | Score |
|-----------|-------|
| Disputed (negative feedback rate > 50%) | **0.5** |
| Documented but not yet experiment-verified | **0.5** |

These checks appear in audit output but are ranked below HIGH-confidence checks at the same impact level.

### HEURISTIC (0.0–0.39)

Pattern-based detection that may produce false positives. These checks infer configuration quality from indirect signals (file size, naming patterns, structural heuristics) rather than direct feature detection.

| Condition | Score |
|-----------|-------|
| Stale — not re-verified within 90 days | **0.3** |
| Pattern-based with no direct documentation backing | **0.2** |

Heuristic checks are never promoted to "recommended" status. They appear in verbose audit output and are clearly labeled.

## The 5-Layer Evidence Chain

Every check passes through five layers before reaching users:

### Layer 1 — Official Source

Each check starts with an official documentation reference. The `sourceUrl` field links directly to the platform vendor's docs (Anthropic, OpenAI, Google, GitHub, Cursor, Windsurf, Aider, OpenCode). No check exists without a traceable origin.

### Layer 2 — Research Memo

Findings from official sources are documented in structured research memos following the Anthropic-recommended research methodology: explore from multiple angles, form competing hypotheses, triangulate across independent sources, extract quotes before analyzing, identify gaps and contradictions, integrate with confidence levels, and self-critique.

**448+ research documents** feed the current check catalog.

### Layer 3 — Runtime Experiment

Claims are tested in real project environments. Each experiment runs actual check logic against controlled fixtures — real directory structures, real configuration files, real tool outputs. Nothing is marked as verified without executing it and observing the output.

**332+ experiments across 8 platforms** with real runtime evidence.

### Layer 4 — Check Implementation

The verified finding becomes a `check(ctx)` function operating on `ProjectContext`. The function is deterministic: same project state produces the same result.

### Layer 5 — Test Coverage

Every check is covered by matrix tests that verify correct behavior across project shapes. Golden matrices lock expected pass/fail outcomes so regressions are caught immediately. Platform-specific matrices ensure cross-platform correctness.

## Freshness Cycle

Stale checks are worse than missing checks — they create false confidence. Nerviq enforces a 90-day verification window.

### 90-Day Rule

Every check has a `lastVerified` date. Any check not re-verified within 90 days is marked stale. Stale checks:

- Have their confidence score reduced to **0.3** (HEURISTIC tier)
- Are flagged in audit output with a staleness warning
- Are blocked from appearing as top recommendations until re-verified

### Daily Changelog Watch

A CI cron job monitors platform changelogs and release notes. When a platform ships a breaking change or deprecation, affected checks are flagged for immediate review — they do not wait for the 90-day window.

### Staleness Blocking

Stale checks cannot graduate to "recommended" status. They remain in the catalog for completeness but are deprioritized in all ranking algorithms until a maintainer re-verifies them against current platform behavior.

## False Positive Management

False positives erode trust. Nerviq has a structured feedback loop to catch and suppress them.

### Reporting

Users report whether a finding was helpful or not via the CLI:

```
npx nerviq feedback --key <checkKey> --status rejected --effect negative
```

Feedback is stored locally in `.nerviq/outcomes/` and aggregated per check key.

### Confidence Calibration

Feedback data flows directly into confidence scoring:

- Checks with **>80% positive feedback** receive a confidence boost (up to +0.1)
- Checks with **>50% negative feedback** receive a confidence reduction (down to 0.5)
- Checks exceeding **30% "not helpful" rate** are deprioritized in recommendations

### Feedback-Aware Ranking

The `getRecommendationAdjustment` function computes a bounded adjustment (plus or minus 8 points) based on:

- Accepted vs. rejected outcomes
- Positive vs. negative effect ratings
- Average score delta from before/after measurements

This adjustment feeds into `topNextActions` and `quickWins` ranking, so recommendations improve with use.

## Platform Coverage

Nerviq covers 8 AI coding agent platforms:

| Platform | Config Detection | Check Count |
|----------|-----------------|-------------|
| Claude Code | `CLAUDE.md`, `.claude/` | ~500 |
| GitHub Copilot | `.github/copilot-instructions.md` | ~350 |
| Cursor | `.cursor/rules/`, `.cursorrules` | ~350 |
| Windsurf | `.windsurfrules`, `.windsurf/` | ~300 |
| OpenAI Codex | `agents.md`, `AGENTS.md` | ~280 |
| Google Gemini | `.gemini/` | ~250 |
| Aider | `.aider.conf.yml`, `.aiderignore` | ~200 |
| OpenCode | `opencode.json` | ~200 |

Each platform has a dedicated context class that reads the correct config files and normalizes them into the shared `ProjectContext` interface. Platform-specific checks target a single platform. Cross-platform checks run through the **Harmony module**, which identifies practices that apply regardless of which agent a team uses (e.g., having a project instructions file, ignoring secrets, defining coding standards).

## How Checks Are Added

New checks follow a strict pipeline from research to production:

```
Research → Hypothesis → Experiment → Verify → Catalog → Implement
```

### Step-by-step

1. **Research** — A platform changelog, documentation update, or community report identifies a potential new check. The finding is documented in a research memo with source URLs.

2. **Hypothesis** — The researcher formulates what the check should detect and what impact level it warrants. At least 3 competing hypotheses are considered before committing to an approach.

3. **Experiment** — The check logic is implemented as a standalone experiment and run against real project fixtures. The experiment must produce observable output.

4. **Verify** — Results are reviewed. If the experiment passes, the check is marked as runtime-verified. If it fails or produces ambiguous results, it returns to research.

5. **Catalog** — The verified check is added to the internal catalog with all required fields: `id`, `name`, `check`, `impact`, `confidence`, `sourceUrl`, `category`, `fix`.

6. **Implement** — The cataloged check is implemented in the CLI audit engine and covered by matrix tests.

### Minimum requirements for a new check

- `sourceUrl` pointing to official documentation or a verifiable primary source
- Minimum confidence score of **0.5** (no HEURISTIC-tier checks ship by default)
- At least one passing fixture test
- Assigned `impact` level with written justification
- `fix` text that gives the user a concrete next step

## Plugin Extension

The check catalog is extensible. Any project can add custom checks by placing plugin modules in a configured directory. Plugins:

1. Export an object of technique definitions matching the standard check structure
2. Are loaded at audit time via `loadPlugins()` and merged into the active technique set
3. Follow the same scoring, ranking, and feedback rules as built-in checks
4. Can target any platform or be platform-agnostic

This allows organizations to enforce internal standards using the same rule-based audit infrastructure with evidence tracking.

## Transparency

Every check has a `sourceUrl` pointing to official vendor documentation. This means:

- Users can verify any finding by clicking through to the source
- Disputed checks can be resolved by comparing the check logic against current docs
- The audit is not a black box — it is a structured interpretation of documented best practices

## Summary

| Metric | Value |
|--------|-------|
| Total checks | **2,438** (~300 unique rules × 8 platforms) |
| Platforms covered | **8** |
| Categories | **96** |
| Stack-specific languages | **10** |
| Research documents | **448+** |
| Runtime experiments | **332+** |
| Domain packs | **62** |
| Impact levels | 3 (critical, high, medium) |
| Confidence range | 0.0–1.0 |
| Freshness window | 90 days |
| Feedback tracking | Per-check, per-project, with trend analysis |

---

*This methodology is maintained as part of the Nerviq project. For implementation details, see the source code in `src/audit.js`, `src/activity.js`, `src/feedback.js`, and `src/freshness.js`.*
