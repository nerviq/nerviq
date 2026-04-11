# Nerviq

> Standardize and govern your AI coding agent setup — score, fix, and align across 8 platforms.

[![npm version](https://img.shields.io/npm/v/@nerviq/cli)](https://www.npmjs.com/package/@nerviq/cli)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Checks: 2441](https://img.shields.io/badge/checks-2441-brightgreen)](https://github.com/nerviq/nerviq)

---

### 8 Platforms Supported

Nerviq audits, sets up, and governs AI coding agent configurations for **8 platforms**:

| Platform | Checks | Status |
|----------|--------|--------|
| Claude Code | 400 | Full |
| Codex (OpenAI) | 272 | Full |
| Gemini CLI (Google) | 300 | Full |
| GitHub Copilot | 299 | Full |
| Cursor | 301 | Full |
| Windsurf | 297 | Full |
| Aider | 283 | Full |
| OpenCode | 286 | Full |

### 10 Stack-Specific Languages

| Language | Checks | Key Areas |
|----------|--------|-----------|
| Python | 26 | pyproject, typing, pytest, linting, async, security |
| Go | 21 | go.mod, vet, fmt, error wrapping, interfaces |
| Rust | 21 | Cargo, clippy, unsafe docs, editions, cross-compile |
| Java/Spring | 21 | Maven/Gradle, JUnit, Spring Boot, migrations |
| Ruby | 16 | Gemfile, RSpec, Rubocop, Rails |
| PHP | 16 | Composer, PHPUnit, Laravel, PSR |
| .NET | 16 | csproj, NuGet, xUnit, EF Core |
| Flutter | 15 | pubspec, analysis, state management, l10n |
| Swift | 10 | SPM, SwiftLint, async/await, doc comments |
| Kotlin | 10 | Gradle, ktlint, coroutines, Compose, KMP |

---

## What Nerviq Does

Nerviq scores your AI coding agent setup from 0 to 100, finds what's missing, and fixes it — with rollback for every change.

```
  nerviq audit
  ═══════════════════════════════════════
  Detected: React, TypeScript, Docker

  ████████████████░░░░ 78/100

  ✅ CLAUDE.md with architecture diagram
  ✅ Hooks (PreToolUse + PostToolUse)
  ✅ Custom skills (3 skills)
  ✅ MCP servers configured

  ⚡ Top 3 Next Actions
     1. Add verification commands to CLAUDE.md
     2. Configure deny rules for dangerous operations
     3. Add path-specific rules in .claude/rules/

  Next: nerviq setup
```

## Quick Start

```bash
npx @nerviq/cli --beginner         # Show only the 5 starter commands
npx @nerviq/cli audit              # Quick scan: score + top 3 actions
npx @nerviq/cli audit --full       # Full audit with all checks + badge
npx @nerviq/cli audit --snapshot --tag "pre-refactor"  # Save a named snapshot for history/compare/trend
npx @nerviq/cli audit --diff-only  # PR/working-tree audit: changed files + linked governance/config surfaces only
npx @nerviq/cli compare            # Detailed per-check diff between latest 2 audit snapshots
npx @nerviq/cli audit --webhook https://hooks.slack.com/services/...  # Push audit results to Slack/Discord/generic HTTP
npx @nerviq/cli audit --workspace packages/*  # Monorepo: root governance + stack-specific workspace profiles
npx @nerviq/cli setup              # Generate starter-safe baseline
npx @nerviq/cli augment            # Improvement plan, no writes
npx @nerviq/cli governance         # Permission profiles + policy packs
npx @nerviq/cli benchmark          # Baseline vs projected score in isolated copy
```

No install required. Zero dependencies.

Text-mode CLI output explains terms like `MCP`, `hooks`, `deny rules`, and `governance` inline when they appear, so a first audit is easier to read.

If you want the shortest possible command list inside the terminal, start with:

```bash
npx @nerviq/cli --beginner
```

## Get Started by Role

| You are a... | Start here | Then |
|--------------|------------|------|
| **Solo developer** | `nerviq audit` → `nerviq augment` | `nerviq benchmark` |
| **Team lead / DevEx** | `nerviq governance` → `nerviq audit --json` | CI threshold + `nerviq watch` |
| **Enterprise / Platform** | `nerviq harmony-audit` → `nerviq harmony-drift` | Policy packs + `nerviq certify` |

## 2,441 Checks Across 96 Categories (8 Platforms × ~300 Governance Rules)

| Category Group | Checks | Examples |
|----------------|--------|---------|
| Stack-Specific (10 languages) | 172 | Python, Go, Rust, Java, Ruby, PHP, .NET, Flutter, Swift, Kotlin |
| Platform Config & Instructions | ~150 | CLAUDE.md, AGENTS.md, rules, managed blocks |
| Security & Trust | ~80 | permissions, deny rules, secrets, trust posture |
| Quality & Testing | ~70 | verification loops, lint/test/build, coverage |
| Automation & Hooks | ~60 | PreToolUse, PostToolUse, notification hooks |
| Workflow & Commands | ~50 | skills, commands, agents, snapshots |
| Git & Hygiene | ~40 | .gitignore, env protection, changelog |
| Tools & MCP | ~40 | .mcp.json, multi-server, Context7 |
| Governance & Compliance | ~30 | permission profiles, audit trails |
| DevOps & Infrastructure | ~30 | Docker, CI, Terraform, monitoring |
| Cross-Platform Intelligence | ~25 | harmony, synergy, drift detection |
| Enterprise & Freshness | ~20 | freshness tracking, deprecation, SBOM |
| Memory & Context | ~15 | context management, compaction, @path |
| Prompting & Design | ~10 | XML tags, constraints, frontend patterns |

## Harmony — Cross-Platform Alignment `GA`

Harmony detects drift between your AI coding platforms and keeps them in sync.

```bash
npx @nerviq/cli harmony-audit      # Cross-platform DX audit (0-100 harmony score)
npx @nerviq/cli harmony-sync       # Sync shared config across platforms
npx @nerviq/cli harmony-drift      # Detect drift between platform configs
npx @nerviq/cli harmony-advise     # Cross-platform improvement advice
npx @nerviq/cli harmony-watch      # Live monitoring for config drift
npx @nerviq/cli harmony-governance # Unified governance across platforms
npx @nerviq/cli harmony-add <platform>  # Add a new platform to your project
```

## Synergy — Multi-Agent Amplification `EXPERIMENTAL`

Synergy analyzes how your platforms work together and finds amplification opportunities. Currently uses static routing rules — learned routing is planned for v2.0.

```bash
npx @nerviq/cli synergy-report     # Multi-agent synergy analysis
```

Synergy evaluates compound audit results, discovers compensation patterns (where one platform covers another's gaps), and ranks recommendations by cross-platform impact.

## SDK — `@nerviq/sdk` `BETA`

Programmatic access to all Nerviq capabilities:

```js
const { audit, harmonyAudit, detectPlatforms } = require('@nerviq/sdk');

async function main() {
  try {
    const result = await audit('.', 'claude');
    console.log(`Score: ${result.score}/100`);

    const platforms = detectPlatforms('.');
    console.log(`Active platforms: ${platforms.join(', ') || 'none detected'}`);

    const harmony = await harmonyAudit('.');
    console.log(`Harmony score: ${harmony.harmonyScore}/100`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unknown SDK error');
    process.exitCode = 1;
  }
}

main();
```

Stable SDK surfaces: `audit`, `harmonyAudit`, `detectPlatforms`, `getCatalog`  
Experimental SDK surfaces: `synergyReport`, `routeTask`

See [sdk/README.md](sdk/README.md) for full JavaScript examples, error handling guidance, and TypeScript usage.

## Integration Contract Pack

Nerviq publishes a compact integration pack so external systems do not need to scrape CLI text:

- OpenAPI 3.1 contract from `nerviq serve` via `GET /api/openapi.json`
- Separate `nerviq-mcp` stdio JSON-RPC 2.0 transport for MCP hosts
- Generic audit webhook schema at [`contracts/audit-webhook-event.schema.json`](contracts/audit-webhook-event.schema.json)
- CI reference patterns in [`docs/ci-integration.md`](docs/ci-integration.md)
- SDK usage guide in [`sdk/README.md`](sdk/README.md)
- First-tier release gate in [`docs/first-tier-integration-gate.md`](docs/first-tier-integration-gate.md)

See [`docs/integration-contracts.md`](docs/integration-contracts.md) for the full pack.

## Category Definition Kit

Nerviq is positioned as the control plane for AI-enabled development:

- a repo-native governance layer for AI coding agents
- a cross-platform drift detector and operating model
- not a full SAST scanner, prompt library, or single-vendor IDE plugin

See [`docs/category-definition-kit.md`](docs/category-definition-kit.md) for the category language, comparison matrix, operating model, and adoption playbook.

## HTTP API — `nerviq serve`

Nerviq ships with a built-in local HTTP API for dashboards, wrappers, scripts, and language-neutral integrations:

```bash
npx @nerviq/cli serve --port 3000
```

Endpoints:
- `GET /api/openapi.json` — Live OpenAPI 3.1 contract for this `serve` instance
- `GET /api/health` — Server health check
- `GET /api/catalog` — Full check catalog
- `GET /api/audit` — Run audit on a directory and platform via query params
- `GET /api/harmony` — Cross-platform harmony data

All successful operational responses are wrapped in a JSON envelope:

```json
{
  "data": {},
  "meta": {
    "version": "1.14.0",
    "timestamp": "2026-04-11T12:00:00.000Z"
  }
}
```

Pull the contract directly into Swagger UI, Postman, or internal tooling:

```bash
curl http://127.0.0.1:3000/api/openapi.json > nerviq-openapi.json
```

This HTTP surface is separate from the MCP transport. If your host expects Model Context Protocol over stdio, register the `nerviq-mcp` binary instead of pointing it at `nerviq serve`:

```json
{
  "mcpServers": {
    "nerviq": {
      "command": "npx",
      "args": ["-y", "-p", "@nerviq/cli", "nerviq-mcp"]
    }
  }
}
```

## Plugin System — `nerviq.config.js`

Extend Nerviq with custom checks via a config file in your project root:

```js
// nerviq.config.js
module.exports = {
  plugins: [
    {
      name: 'my-company-checks',
      checks: {
        internalDocs: {
          id: 'internalDocs',
          name: 'Internal docs present',
          check: (dir) => require('fs').existsSync(`${dir}/docs/internal.md`),
          impact: 'medium',
          category: 'Quality',
          fix: 'Add docs/internal.md with team-specific guidelines',
        },
      },
    },
  ],
};
```

See [docs/plugins.md](docs/plugins.md) for full plugin API reference.

## GitHub Action

Add Nerviq to your CI pipeline:

```yaml
# .github/workflows/nerviq.yml
name: Nerviq Audit
on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: nerviq/nerviq@v1
        with:
          threshold: 60
```

The action outputs `score`, `passed`, and `total` for use in downstream steps. Fails the workflow if the score is below the configured threshold.

## Certification

Earn a Nerviq certification badge for your project:

```bash
npx @nerviq/cli certify            # Run certification and display badge
```

Levels:
- **Gold** — Harmony score >= 80, all platforms >= 70
- **Silver** — Harmony score >= 60, all platforms >= 50
- **Bronze** — Any platform >= 40

## All Commands

| Command | What it does |
|---------|-------------|
| `nerviq audit` | Score 0-100 — quick scan with top 3 actions and milestone coaching (default) |
| `nerviq audit --full` | Full audit with all checks, weakest areas, confidence labels, and milestone coaching |
| `nerviq audit --diff-only` | Analyze only changed files plus linked governance/config surfaces from git diff / working tree |
| `nerviq fix <key>` | Auto-fix a specific check (shows score impact) |
| `nerviq fix --all-critical` | Fix all critical issues at once |
| `nerviq rollback` | Undo the most recent apply (delete created files) |
| `nerviq rollback --list` | Show available rollback points |
| `nerviq setup` | Generate starter-safe CLAUDE.md + hooks + commands |
| `nerviq augment` | Repo-aware improvement plan with archetype profiling, operating profile, and adopt/defer/ignore guidance (no writes) |
| `nerviq suggest-only` | Structured report for sharing, including repo archetype, operating profile, and adopt/defer/ignore guidance |
| `nerviq plan` | Export proposal bundles with previews |
| `nerviq apply` | Apply proposals with rollback |
| `nerviq governance` | Permission profiles, hooks, policy packs |
| `nerviq benchmark` | Baseline vs projected score in isolated temp copy |
| `nerviq check-health` | Detect regressions between audit snapshots |
| `nerviq deep-review` | AI-powered config review (opt-in) |
| `nerviq deep-review --behavioral` | Local behavioral drift review with outcome-layer heuristics |
| `nerviq interactive` | Step-by-step guided wizard |
| `nerviq watch` | Live monitoring with score delta |
| `nerviq history` | Audit snapshot history from saved snapshots |
| `nerviq compare` | Compare latest vs previous audit snapshot |
| `nerviq trend` | Export audit snapshot trend report |
| `nerviq feedback` | Record recommendation outcomes |
| `nerviq anti-patterns` | Detect anti-patterns in current project |
| `nerviq freshness` | Show verification freshness for all checks |
| `nerviq rules-export` | Export recommendation rules (human summary or --json) |
| `nerviq badge` | shields.io badge for README |
| `nerviq certify` | Certification level + badge |
| `nerviq scan dir1 dir2` | Compare multiple repos |
| `nerviq org scan dir1 dir2` | Aggregate multiple repos into one score table |
| `nerviq org policy` | Inspect resolved org/team/repo policy layers |
| `nerviq harmony-audit` | Cross-platform DX audit |
| `nerviq harmony-score` | Standalone Harmony Score (0-100) with badge + CI gate |
| `nerviq harmony-demo` | Zero-setup demo — see Harmony in action instantly |
| `nerviq harmony-sync` | Sync config across platforms |
| `nerviq harmony-drift` | Detect platform drift |
| `nerviq harmony-advise` | Cross-platform advice |
| `nerviq harmony-watch` | Live drift monitoring |
| `nerviq harmony-governance` | Unified platform governance |
| `nerviq harmony-add <platform>` | Add a new platform to your project |
| `nerviq synergy-report` | Multi-agent synergy analysis |
| `nerviq catalog` | Show check catalog for all 8 platforms |
| `nerviq doctor` | Self-diagnostics for install health, freshness, platform detection, declared MCP servers, and hook runtime |
| `nerviq convert` | Convert config between platforms |
| `nerviq migrate` | Migrate platform config versions |
| `nerviq serve` | Start local HTTP API + OpenAPI contract |

## Options

| Flag | Effect |
|------|--------|
| `--full` | Full audit output (all checks, weakest areas, confidence labels, milestone coaching) |
| `--verbose` | Full audit + medium-priority recommendations |
| `--threshold N` | Exit 1 if score < N (for CI) |
| `--json` | Machine-readable JSON output |
| `--out FILE` | Write output to file |
| `--webhook URL` | POST audit results to Slack, Discord, or a generic JSON endpoint |
| `--webhook-header NAME:VALUE` | Add a custom webhook header; repeat the flag for multiple headers |
| `--webhook-retries N` | Retry transient webhook failures (`429`, `5xx`, timeouts) up to `N` extra times |
| `--snapshot` | Save audit snapshot for trending |
| `--tag LABEL` | Label a saved snapshot (repeat the flag for multiple tags) |
| `--behavioral` | Run the opt-in local behavioral drift review via `deep-review` |
| `--history` | With `deep-review --behavioral`, show behavioral snapshot history |
| `--compare` | With `deep-review --behavioral`, compare the latest two behavioral snapshots |
| `--diff-only` | Run a changed-file audit instead of a full repo audit |
| `--diff-base SHA` | Base SHA for `--diff-only` PR comparisons (defaults to CI env vars when present) |
| `--diff-head SHA` | Head SHA for `--diff-only` PR comparisons (defaults to `GITHUB_SHA` or `HEAD`) |
| `--dry-run` | Preview changes without writing files |
| `--config-only` | Only write config files, never source code |
| `--auto` | Apply without prompts |
| `--only A,B` | Limit apply to selected proposal IDs |
| `--format sarif` | SARIF output for code scanning |
| `--platform NAME` | Target platform (claude, codex, gemini, copilot, cursor, windsurf, aider, opencode) |
| `--workspace GLOB` | Audit workspaces separately as package-level live audits with summary-only JSON rows (e.g. packages/*) |
| `--external PATH` | Benchmark an external repo |

Webhook delivery automatically retries transient failures twice by default. For authenticated internal endpoints, you can add custom headers such as:

```bash
npx @nerviq/cli audit \
  --webhook https://ops.example.com/nerviq/audit \
  --webhook-header "Authorization: Bearer $NERVIQ_WEBHOOK_TOKEN" \
  --webhook-header "X-Nerviq-Environment: production" \
  --webhook-retries 4
```

Generic webhook endpoints now receive a stable `nerviq.audit.completed` event envelope with:

- backward-compatible top-level `platform`, `score`, `passed`, `failed`, and `results`
- nested `data` and `meta` blocks for new consumers
- schema versioning through `schemaVersion`

For PR-focused audits, you can scope Nerviq to the working tree or an explicit base/head range:

```bash
npx @nerviq/cli audit --diff-only
npx @nerviq/cli audit --diff-only --diff-base origin/main --diff-head HEAD
```

`--diff-only` is intentionally a scoped review surface. It reports a `diff-only changed-file audit` score, lists the changed files it considered, and reminds you to run a full `nerviq audit` for the complete repo posture. Because diff-only scores are not directly comparable to full audit history, Nerviq blocks `--diff-only --snapshot`.

For multi-repo governance, Nerviq also supports inherited policy layers:

- `.nerviq/org-policy.json` in an ancestor directory for org defaults
- `.nerviq/team-policy.json` in the repo for team overrides
- `.nerviq/repo-policy.json` in the repo for repo-specific overrides

Inspect the resolved contract with:

```bash
npx @nerviq/cli org policy
npx @nerviq/cli org scan ./app ./api ./infra --json
```

For opt-in outcome-layer inspection, Nerviq can also run a local behavioral drift review:

```bash
npx @nerviq/cli deep-review --behavioral
npx @nerviq/cli deep-review --behavioral --snapshot --milestone baseline --tag "behavioral-baseline"
npx @nerviq/cli deep-review --behavioral --history
npx @nerviq/cli deep-review --behavioral --compare
```

Behavioral drift mode is intentionally guarded:

- It analyzes repository structure and instruction-vs-outcome mismatch heuristics
- It does not claim agent attribution without explicit evidence
- It is not marketed as SAST, semantic code review, or runtime analysis

`nerviq setup` now seeds a trust-boundary section in `CLAUDE.md` and an `injection-defense` starter hook for `WebFetch`, `WebSearch`, `Read`, `Grep`, `Glob`, and MCP-backed external-content flows. `nerviq doctor` validates that the declared starter hook still runs and logs suspicious prompt-injection patterns correctly.

## Backed by Research

Nerviq is built on the NERVIQ knowledge engine — the largest verified catalog of AI coding agent techniques:

- **540+ research documents** covering all 8 platforms
- **400+ experiments** with tested, rated results
- **2,441 checks** across 8 platforms (~300 unique governance rules × 8 platform adaptations), each with `sourceUrl` and `confidence` level (0.0-1.0)
- Every check is traceable to primary documentation or verified experiment
- **Freshness:** daily changelog scanning across all 8 platforms, weekly liveness sweep (6 automated checks), monthly quality review, quarterly cross-validation — items older than 90 days are confidence-weighted

## Safety Modes

Nerviq provides explicit safety controls so you decide what it can touch:

| Mode | Flag | What it does |
|------|------|-------------|
| **Read-only** | `nerviq audit` | Reads files, writes nothing. Default command. |
| **Suggest-only** | `nerviq suggest-only` | Generates markdown report, no file writes. |
| **Dry-run** | `--dry-run` | Previews setup/fix/apply changes without writing. |
| **Config-only** | `--config-only` | Only writes config files (.claude/, rules, hooks). Never touches source code. |
| **Safe-write** | `--profile safe-write` | Default write profile. Creates new files, never overwrites existing ones. |
| **Power-user** | `--profile power-user` | Overwrites existing files (use with `--snapshot` for rollback). |

Every write command supports `--snapshot` for automatic backup before changes.

## Privacy

- **Zero dependencies** — nothing to audit
- **Runs locally** — audit, setup, plan, apply, governance, benchmark all run on your machine
- **Deep review is opt-in** — `deep-review` sends selected config for AI analysis, while `deep-review --behavioral` stays local and uses heuristic outcome-layer analysis only
- **AGPL-3.0 Licensed** — open source

## Links

- **npm**: [@nerviq/cli](https://www.npmjs.com/package/@nerviq/cli)
- **GitHub**: [github.com/nerviq/nerviq](https://github.com/nerviq/nerviq)
- **Website**: [nerviq.net](https://nerviq.net)
- **Discord**: [Join the community](https://discord.gg/nerviq)

---

If Nerviq helped you, consider giving it a ⭐ on [GitHub](https://github.com/nerviq/nerviq) — it helps others discover the project.

## What Nerviq Is — and Isn't

**Best for:** Teams going from zero governance to a strong baseline — fast. If you're starting with AI coding agents or have a few platforms running without consistent configuration, Nerviq gets you to a governed setup quickly.

**Not designed for:** Deeply customized setups with 20+ skills, agent teams, and bespoke MCP integrations. If you've already built advanced agent workflows, you may not need this.

**Strongest at:** AI agent governance, configuration intelligence, workflow policy hygiene, cross-platform alignment, and setup standardization.

**Not a replacement for:** Deep architectural review of business logic, runtime performance profiling, full SAST coverage, secret scanning, or security penetration testing. Nerviq focuses on how your AI coding agents are configured and governed — not on what your application code does.

**Confidence levels:** Every check includes a `confidence` score (0.0–1.0) and a `sourceUrl` linking to primary documentation. Checks marked `heuristic` are pattern-based and may produce false positives on non-standard project structures.

**Feature maturity:**

| Label | Meaning |
|-------|---------|
| `GA` | Stable, tested on real repos, safe for production use |
| `BETA` | Works but has limited real-world testing. API may change |
| `EXPERIMENTAL` | Early stage, static rules, results may vary |

