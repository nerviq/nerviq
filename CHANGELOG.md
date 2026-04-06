# Changelog

All notable changes to the **Nerviq** CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.8.7] - 2026-04-06

### Changed
- **Complete CLAUDEX → NERVIQ rebrand**: all internal references, env vars (`NERVIQ_NO_INSIGHTS`), JSON keys (`_nerviq_managed`), and property names updated
- **Restored audit-repo skill template**: Claude-native skill for running `npx @nerviq/cli --json` from within Claude Code
- **Updated .gitignore**: fixed legacy `claudex-setup` reference

## [1.8.6] - 2026-04-06

### Changed
- **Confidence calibration**: 5-tier system (0.3/0.6/0.7/0.8/0.9) based on actual evidence quality — stack checks=0.6, default=0.7, with-template=0.8, runtime-verified=0.9
- **SDK dogfooding**: CLI now imports `audit`, `detectPlatforms`, `getCatalog` from public SDK API instead of internal modules
- Updated test count badge: 293 tests

## [1.8.5] - 2026-04-06

### Changed — Honesty & Maturity Overhaul (Stream 23)
- **Check count messaging**: All surfaces now show "2,431 checks (8 platforms × ~300 governance rules)" instead of inflated raw number
- **Synergy → [EXPERIMENTAL]**: Synergy dashboard, CLI output, and site docs now carry experimental label with disclaimer about static routing rules
- **Feature maturity labels**: Introduced GA/Beta/Experimental system — Harmony=GA, Plugins=GA, SDK=Beta, Synergy=Experimental
- **"evidence-based" → accurate**: Changed to "rule-based audit engine with evidence tracking" in methodology docs
- **Positioning**: Added "Best for teams going from 0→governed" and "Not designed for deeply customized setups" to README and site
- **sourceUrl audit**: Verified 100% coverage (2,306/2,306 checks), identified 78 unique URLs for future specificity improvement

### Fixed
- Fixed 15 failing tests with stale check counts (2,306→2,431, domain packs 40→62)
- Jest version verified: ^30.3.0 valid (30.2.0 installed)

### Added
- 14 new Harmony integration tests (full pipeline, drift scenarios, add platform, state persistence, governance, advisor)
- Total test count: 293 passing across 28 suites
- MaturityBadge component on nerviq.net docs pages

## [1.7.1] - 2026-04-07

### Changed
- README synced: added 8 missing commands (rollback, check-health, anti-patterns, freshness, rules-export, org scan), 4 missing options (--full, --config-only, --only, --workspace), fixed NERVIQ→NERVIQ branding

## [1.7.0] - 2026-04-07

### Added — Final P2 batch
- **UAT-11: `nerviq rollback`** — Undo the most recent apply by deleting all created files. Supports `--list` (show rollback points), `--dry-run` (preview), and auto-cleanup of rollback artifacts after use.
- **UAT-18**: `apply --only hooks,commands` already worked (verified)
- **UAT-19**: Benchmark messaging improved for post-setup runs

## [1.6.5] - 2026-04-07

### Added — More P2 UX from UAT
- **UAT-14**: Governance shows top 5 domain/MCP packs by default, `--verbose` for all
- **UAT-20**: Frontend.md rule no longer generated for backend-only projects (Express, NestJS)
- **UAT-23**: `rules-export` shows human-readable summary by default, `--json` for full output
- **UAT-24**: `history --prune N` to clean old snapshots (keeps last N)
- **UAT-21**: Harmony task routing already dynamic (via UAT-04 phantom platform fix)

## [1.6.4] - 2026-04-07

### Added — P2 UX improvements from UAT
- **UAT-12**: Setup now lists every file created (`+ CLAUDE.md`, `+ .claude/settings.json`, ...)
- **UAT-13**: Lite mode shows pass/fail count: `Score: 78/100  (62/86 checks passing)`
- **UAT-15**: Audit header shows detected config files: `Found: CLAUDE.md, AGENTS.md, .cursorrules`
- **UAT-17**: Suggested next command includes `--platform` for non-Claude platforms
- **UAT-22**: History shows HH:MM timestamps when multiple snapshots share same date

## [1.6.3] - 2026-04-07

### Fixed — P1 from UAT
- **UAT-04**: Harmony only audits platforms with detected config files (was always 8/8)
- **UAT-05**: `apply --rollback` now shows clear error instead of silently re-applying
- **UAT-06**: Harmony drift now auto-recorded — compares scores to previous audit, records deltas ≥5 points
- **UAT-07**: Migrate error message includes usage example
- **UAT-08**: Doctor aider freshness gate no longer crashes (null safety)
- **UAT-09**: `nerviq fix` now auto-fixes `gitIgnoreEnv` (.env to .gitignore) and `secretsProtection` (deny rules in settings.json) — the two most common critical findings
- **UAT-10**: Rails/Laravel/.NET false positives in `fix` output eliminated (was caused by same null-inclusion bug as UAT-02)

## [1.6.2] - 2026-04-07

### Fixed — P0 from UAT (ship-stoppers)
- **UAT-01 BLOCKER**: `npx @nerviq/cli audit` now works — added `@nerviq/cli` bin alias
- **UAT-02**: `nerviq fix` was showing 375 failed checks (including skipped) vs audit's 77. Fixed: now filters `r.passed === false` only, matching audit count exactly
- **UAT-03**: Confidence label `[MEDIUM]` was shown on critical items (confusing). Changed threshold: 0.7 confidence now shows `[HIGH]` instead of `[MEDIUM]`

## [1.6.1] - 2026-04-07

### Added
- **F3-01: `nerviq check-health`** — Detects regressions between audit snapshots. Compares per-check pass/fail state and flags checks that went from passing to failing. When 3+ checks in the same category regress, alerts as "potential platform format change."
- **F3-03: Regression tests** — 3 new tests for check-health: no-snapshots, stable state, and regression detection
- Supports `--json` for CI integration

## [1.6.0] - 2026-04-07

### Changed — ACCURACY OVERHAUL
- **Stack detection accuracy**: Checks for Python, Go, Rust, Java, Ruby, PHP, .NET, Flutter, Swift, Kotlin now skip when the stack is only present in `examples/`, `docs/`, `test/`, `vendor/` directories — not at project root. Previously these fired false positives on monorepos and repos with example code.
- **Generic quality checks scoped**: 132 checks (observability, caching, i18n, rate-limiting, etc.) are now skipped by default — they measure general software quality, not AI agent configuration. Use `--verbose` to include them.
- **Urgency count fix**: Skipped (not-applicable) checks were incorrectly counted as critical/high in the lite output summary. Now only actual failures are counted.

### Impact
- supabase/supabase: Failed 120 → 55 (65 false positives eliminated)
- Nerviq's own repo: Fake "🔴 3 critical" → accurate "🔵 19 recommended"
- All failed checks are now relevant to AI agent configuration

## [1.5.3] - 2026-04-07

### Added
- **T4-01:** Confidence labels (`[HIGH]` / `[MEDIUM]` / `[HEURISTIC]`) on every failed check in full audit
- **T4-02:** Safety modes documented in README: read-only, suggest-only, dry-run, config-only, safe-write, power-user
- **T4-02:** `--config-only` flag added — restricts writes to config files only
- **B4:** Suggest-only markdown export verified working (`nerviq suggest-only --out report.md`)

### Fixed
- Report header rebranded from "Nerviq" to "Nerviq" in markdown export

## [1.5.2] - 2026-04-07

### Added
- **F1-01: Lite-by-default** — `nerviq audit` now shows quick scan (score + top 3 actions). Use `--full` for complete output.
- **F1-02: Urgency tiers** — Lite output shows `🔴 critical / 🟡 high / 🔵 recommended` summary and per-item tier icons
- **F2-01: `nerviq fix` command** — Auto-fix checks with templates, show manual guidance for others, display score impact
  - `nerviq fix` — List fixable and manual-fix checks
  - `nerviq fix <key>` — Fix a specific check with before/after score
  - `nerviq fix --all-critical` — Fix all critical issues at once
  - `nerviq fix --dry-run` — Preview without writing

### Changed
- Default `nerviq audit` is now lite mode (previously showed full output)
- `--full` flag added to restore previous full-output behavior
- `--verbose` still shows full output plus medium-priority recommendations
- Lite output streamlined: single fix line per item instead of redundant Why/Fix

## [1.5.1] - 2026-04-06

### Added
- "Get Started by Role" section in README (solo dev / team lead / enterprise paths)
- "What Nerviq Is — and Isn't" section in README (honest limitations, confidence levels)
- CHANGELOG entries for v1.2.5 through v1.5.0 (previously undocumented)

### Changed
- Check counts synced across all surfaces (README, package.json, badge): 2,431 total
- Removed stale "v1.0" reference from README
- Tagline sharpened: "Standardize and govern your AI coding agent setup"
- Platform check counts updated to match actual catalog
- Removed self-certification badge

## [1.5.0] - 2026-04-05

### Added
- Stream 8 Self-Dependent Execution — intelligence hardening
- New CLI commands: `nerviq rules-export`, `nerviq anti-patterns`, `nerviq freshness`
- A2: Recommendation rules export to JSON
- A3: Shared contract schemas (technique + pack)
- A6: 22 anti-pattern definitions with detection
- A7: Last-verified date tracking for 123 checks
- B5: External benchmark path (`nerviq benchmark --external /path`)
- B8: Governance hook risk level classification (high/medium/low)

### Changed
- B3: Augment now preserves and displays top 10 strengths

## [1.4.1] - 2026-04-05

### Fixed
- npm README display alignment

## [1.4.0] - 2026-04-05

### Added
- Stream 13: 84 new coverage checks across 15 directions
- MC-A (HIGH): Observability, Accessibility, GDPR, Error Tracking, Supply Chain — 31 checks
- MC-B (MED): i18n, API Versioning, Caching, Rate Limiting, Feature Flags, Docs, Monorepo, Performance — 43 checks
- MC-C (LOW): WebSocket/Real-time, GraphQL — 10 checks
- Total reached 2,039 checks across 96 categories

## [1.3.2] - 2026-04-05

### Changed
- README fully updated: badge, platform table, category table, stack languages table
- package.json description synced to 1,955 checks
- Added `harmony-add` command to docs

## [1.3.1] - 2026-04-05

### Added
- Stream 5D: 35 mobile stack checks (Flutter 15, Swift 10, Kotlin 10)
- Stream 4 Batch 2: 22 new domain packs (healthcare to energy)
- Stream 5 complete: 172 stack checks across 10 languages

## [1.3.0] - 2026-04-05

### Added
- Stream 5: Stack-specific checks for 7 languages (137 new checks)
- Python (26), Go (21), Rust (21), Java/Spring (21), Ruby (16), PHP (16), .NET (16)
- QP-D02: API reference documentation (`docs/api-reference.md`)

## [1.2.7] - 2026-04-05

### Changed
- Version bump for npm publish alignment

## [1.2.6] - 2026-04-05

### Added
- EC1-EC8: All 6 new ECC-inspired checks + 2 advisor task types

### Fixed
- Flaky `compareLatest` test (timestamp tiebreaker sort)

## [1.2.5] - 2026-04-05

### Added
- 3 ECC-inspired checks: `llms.txt`, MCP budget warning, hook exit code docs

### Changed
- Complete NERVIQ → NERVIQ rebrand across docs, content, action, landing page
- CHANGELOG rewritten to Keep a Changelog format with full version history

## [1.2.4] - 2026-04-05

### Added
- H8: Unified platform capability matrices into a single source of truth
- Windsurf, Aider, and OpenCode intelligence added to Harmony module
- Codex platform additions synced to metadata

### Changed
- MG5-MG11: Complete NERVIQ to NERVIQ migration in CLI codebase
- Hardcoded `.claude/nerviq-cli/` paths migrated to `.nerviq/` with fallback

## [1.2.3] - 2026-04-05

### Added
- Batch Q1: check-matrix and golden-matrix tests for Windsurf, Aider, OpenCode
- Quality Perfection Q1: Gold certification, harmony+synergy proof
- SDK/server tests and plugin dogfood validation

### Changed
- Self-audit score improved from 80 to 90
- CI self-audit integrated into pipeline

## [1.2.1] - 2026-04-05

### Fixed
- Skip API/DB/Auth/Monitoring checks on irrelevant projects (false positive reduction)
- Self-dogfood: added `.mcp.json` to own project
- LICENSE updated to AGPL-3.0 full text
- CI test assertions updated for new error messages and .npmignore changes

## [1.2.0] - 2026-04-05

### Added
- Massive expansion: 673 to 2,306 checks (+1,633)
- Batch 4: 25 case studies (10 single-platform + 10 harmony/synergy + 5 existing) with INDEX
- Batch 3: +104 experiments (228 to 332) and +133 research docs (315 to 448)
- 27 cross-platform research documents

## [1.1.1] - 2026-04-05

### Added
- Batch 2: +24 domain packs (16 to 40) and +23 MCP packs (26 to 49) across all 8 platforms

## [1.1.0] - 2026-04-05

### Added
- Batch 1: +383 checks (673 to 1,056) across 8 new categories for all 8 platforms

## [1.0.2] - 2026-04-05

### Fixed
- Scorecard: 15 dimensions improved (privacy, security, monorepo, org, integrations, telemetry, OTel, SLSA, versioning, errors, audit log, deprecation, large files, relevance decay, case studies)

### Added
- Methodology documentation, FP ranking, SBOM, CI experiments
- Improved `.npmignore` and `test:all` script

## [1.0.1] - 2026-03-31

### Fixed
- Mermaid diagram rendering in README
- macOS `grep` compatibility issue
- Version stamp display

## [1.0.0] - 2026-04-05

### Changed
- **Renamed from nerviq-cli to Nerviq** — "The intelligent nervous system for AI coding agents"
- Full rebrand across CLI, docs, and package metadata

## [0.9.6] - 2026-04-05

### Added
- SDK for programmatic access
- REST API server with Express
- Plugin system for extensibility
- SLSA provenance for supply chain security
- CONTRIBUTING.md for open-source contributors

## [0.9.5] - 2026-04-05

### Added
- VS Code extension
- `catalog` command for browsing checks
- Performance baselines and benchmarks
- Feedback loop for community contributions

### Changed
- All 673 checks now include `sourceUrl` and `confidence` metadata

## [0.9.4] - 2026-04-05

### Added
- GitHub Action for CI/CD integration
- MCP server for tool integration
- `doctor`, `convert`, and `migrate` commands
- Freshness pipeline for check staleness detection
- 3 case studies with real project data
- Harmony, Synergy, and E2E test suites (187 total tests)

## [0.9.3] - 2026-04-05

### Fixed
- Checks updated from experiment findings: Gemini +5, Copilot +5, Cursor +4, Aider +3, Windsurf/OpenCode fixes
- Stale checks cleaned and new checks added
- CI: added `npm ci` step for dependency install

### Changed
- README updated with beta notice and coming-soon platform list

## [0.9.x] - 2026-04-04

### Changed
- README updated with nerviq-cli to Nerviq migration notice

## [0.5.1] - 2026-03-31

### Changed
- Deep-review auto-detects Claude Code presence (no API key needed)
- Landing page and help text updated

## [0.5.0] - 2026-03-31

### Added
- AI-powered `deep-review` command using Claude API
- Intelligent analysis beyond static checks

## [0.4.0] - 2026-03-31

### Added
- 9 quality-deep checks for veteran Claude Code users
- Deeper analysis for experienced workflows

### Changed
- Community feedback addressed: improved honesty, no-overwrite behavior, less dogmatic tone

## [0.3.2] - 2026-03-31

### Changed
- README v2: all commands documented, smart gen showcase, 54 checks table, GitHub Action, privacy section

## [0.3.1] - 2026-03-31

### Added
- Anonymous insights collection
- Weakest areas analysis
- Community statistics dashboard

### Fixed
- Insights endpoint corrected to `nerviq.workers.dev`

## [0.3.0] - 2026-03-31

### Added
- Interactive wizard for guided setup
- Watch mode for continuous monitoring
- Landing page with FAQ, trust signals, badges

## [0.2.1] - 2026-03-31

### Added
- Smart `CLAUDE.md` generator based on project analysis
- `badge` command for README status badges
- GitHub Action for automated auditing
- Quick wins recommendations

## [0.2.0] - 2026-03-31

### Added
- Expanded to 54 checks across 18 technology stacks
- Improved CLAUDE.md templates

### Fixed
- Security: removed hardcoded Dev.to API key from CLAUDE.md
- Security: made NERVIQ catalog links private

## [0.1.0] - 2026-03-30

### Added
- Initial release of nerviq-cli (later renamed to Nerviq)
- Project audit and optimization for Claude Code workflows
- Landing page (GitHub Pages ready)
- Launch content and community posts

[Unreleased]: https://github.com/nerviq/nerviq/compare/v1.2.4...HEAD
[1.2.4]: https://github.com/nerviq/nerviq/compare/v1.2.3...v1.2.4
[1.2.3]: https://github.com/nerviq/nerviq/compare/v1.2.1...v1.2.3
[1.2.1]: https://github.com/nerviq/nerviq/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/nerviq/nerviq/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/nerviq/nerviq/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/nerviq/nerviq/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/nerviq/nerviq/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/nerviq/nerviq/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/nerviq/nerviq/compare/v0.9.6...v1.0.0
[0.9.6]: https://github.com/nerviq/nerviq/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/nerviq/nerviq/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/nerviq/nerviq/compare/v0.9.3...v0.9.4
[0.9.3]: https://github.com/nerviq/nerviq/compare/v0.9.x...v0.9.3
[0.9.x]: https://github.com/nerviq/nerviq/compare/v0.5.1...v0.9.x
[0.5.1]: https://github.com/nerviq/nerviq/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/nerviq/nerviq/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/nerviq/nerviq/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/nerviq/nerviq/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/nerviq/nerviq/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/nerviq/nerviq/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/nerviq/nerviq/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/nerviq/nerviq/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nerviq/nerviq/releases/tag/v0.1.0
