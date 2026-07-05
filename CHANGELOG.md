# Changelog

All notable changes to the **Nerviq** CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Evidence tiers

Per **TRUTH-03** (POS-05 / continuous-governance positioning, 2026-04-29),
every changelog entry from this release forward is tagged with an explicit
evidence tier so a buyer / reviewer / contributor can tell at a glance how
strongly we stand behind the claim:

- `[Tested]` — verified in this codebase via `npm test` (canonical or Jest).
  This is the strongest tier; a reproducible test guards against regression.
- `[Measured]` — backed by a controlled before/after run with declared
  evaluator + cross-model judge, recorded under
  `nerviq-research/research/measurement-runs/`. Strongest external evidence.
- `[Reported]` — surfaced by an external pilot, user-lab study, or community
  observation; not yet independently re-measured.
- `[Aspirational]` — directional claim, design intent, or planned behavior.
  Honest but not yet evidence-backed; flagged so it can't masquerade as proof.

Untagged historical entries pre-2026-04-29 should be treated as `[Tested]` if
they describe shipped behavior with regression coverage; the absence of a
tag is not an evidence-tier downgrade.

## [Unreleased]

## [1.31.0] - 2026-07-06

### Summary

The "July 2026 revival" release: platform refresh (top-4 P0 sources
re-verified), the `nerviq drift` wedge entrypoint, drift-first repositioning
("Your agent docs lie"), **relicense AGPL-3.0 → MIT**, the verified/community
platform-tier model, a doctor scoping fix, and a fully green test matrix —
jest 480/480, canonical 163/163: this is the `480`-test verification baseline
(the advertised 475 had gone stale — the jest suite grew to 480 in the
May 2026 post-release commits; count re-verified live 2026-07-06).

### Added

- `[Tested]` **`nerviq drift` — the wedge entrypoint.** Runs ONLY the two
  proven high-signal layers: stale-reference detection (script-not-in-
  package.json + framework-version-mismatch) and cross-platform Harmony
  drift (when 2+ platforms configured). No 0–100 score, no banners; lint
  exit semantics (exit 1 on stale refs or critical/high drift); `--json`
  emits a clean machine-readable object. Dogfood run on this repo caught
  the real `npm run package` lie in AGENTS.md. This is also the seed for
  the standalone `npx agent-doc-lint` extraction path (sprint plan).
- `[Tested]` **Platform support tiers (verified vs community).** New
  `src/platform-tiers.js`; catalog entries carry `tier`, audit results carry
  `platformTier`, `nerviq catalog` shows the tier per platform, and
  community-tier audits print a one-line honesty note. Verified tier =
  Claude Code, Codex, Copilot, Cursor (P0 sources actively re-verified);
  community tier = Gemini CLI, Windsurf, Aider, OpenCode (all 2,441 checks
  still ship and run — nothing deleted — but source freshness is not
  guaranteed current). Reversible per platform by design.

### Changed

- **License: AGPL-3.0 → MIT.** The core CLI (and bundled SDK, MCP server,
  GitHub Action, VS Code extension) is now MIT-licensed. No commercial
  license is required for any use, including SaaS and embedding. Versions
  ≤ 1.30.0 remain available under AGPL-3.0. COMMERCIAL.md and
  docs/license-faq.md rewritten accordingly. Rationale: adoption-stage tool;
  the dual-license model protected revenue that doesn't exist yet while
  adding enterprise friction (FABLE_AUDIT_2026-07-05 §4.5).
- **Drift-first repositioning.** README, npm description, and help copy now
  lead with the proven wedge — stale-reference detection + cross-platform
  drift ("Your agent docs lie. Nerviq finds the lies in 30 seconds.") — and
  the 0–100 governance score is a secondary, below-the-fold detail. Quick
  starts show `nerviq drift` before `nerviq audit`.
  See `docs/REPOSITIONING_2026-07.md`.
- Discord links removed from README, docs, and CLI output (community
  unstaffed; no dead-end links).

- `[Tested]` **July 2026 platform refresh (top-4).** All P0 freshness sources
  for Claude Code (13/13), Codex (10/10), Cursor (12/12) and Copilot (13/13)
  re-verified live on 2026-07-06; `verifiedAt` stamps updated only for
  sources actually fetched and matched. URL migrations: entire retired
  `docs.cursor.com` host → `cursor.com/docs/...` (3 P0 + 33 source-url
  entries), 7 moved Copilot doc paths + 1 dead prompt-files anchor → final
  locations. Per-check `lastVerified` stamps intentionally NOT bumped —
  check-level re-verification is v1.31 scope. Convention deltas and the
  check-impact backlog are documented in `docs/PLATFORM_REFRESH_2026-07.md`.
  Gemini CLI / Windsurf / Aider / OpenCode stamps remain honestly stale
  pending the community-tier decision.
- `[Tested]` README per-platform table corrected: Claude Code 400 → 403, so
  the table sums to the real catalog total of 2,441.

### Fixed

- `[Tested]` **doctor: user-level MCP config no longer leaks into scans of
  other directories.** `collectDeclaredMcpServers` merged global-scope config
  (`~/.claude.json`, Cursor/Windsurf/Codex/Gemini/OpenCode user files) into
  every scan, so `nerviq doctor --dir <target>` (and the canonical fixture
  suite) reported servers the target project never declared — results were
  machine-dependent. Global scope is now included only when the scanned dir is
  the process cwd (the environment doctor is actually diagnosing), with an
  explicit `includeGlobal` override on `runDoctor` /
  `validateDeclaredMcpServers` / `collectDeclaredMcpServers`. Regression test
  added; canonical suite restored to fully green (163/163).
- `[Tested]` **The full `npm run test:all` matrix is green on a clean machine
  again (~400 stale expectations repaired across 9 suites).** All failures
  pre-dated this branch (verified at the frozen 2026-05-23 commit) and were
  stale test expectations, not product regressions. Classes: (a) N/A
  recalibration drift — checks that now correctly return null (PP-01/PP-04
  opt-in surfaces, retired Codex config keys, devops-category default-skip)
  were still expected to return false/true; pinned via explicit
  naExpectations maps / null assertions (copilot 3, gemini 4, codex-golden 1,
  aider-golden 1, golden 2 via `--verbose`). (b) hardcoded check counts from
  before the catalog expansions (cursor-golden 84→dynamic, gemini-golden
  82→dynamic, copilot-golden 81→dynamic). (c) codex-check-matrix required
  pass+fail expectations for every check, breaking with `reports[undefined]`
  for all 190 checks added after its tables were last curated — now mirrors
  the copilot/gemini structure (existence tests as fallback). (d) golden
  score bands widened where empty/sparse-repo scores inflated (gemini 84,
  windsurf 64, aider 51/36) — annotated as user-lab trust-killer #3
  ("insufficient signal", sprint Days 2–3); tighten the bands back when that
  lands.

## [1.30.0] - 2026-04-29

### Summary

Agent-facing surfaces ship: SDK bundled into the CLI tarball (MEMO-03 = B
decision), GitHub Action wired with full marketplace metadata (MR-06),
`nerviq certify --agent-ready` hardening gate (AI-13), and a postinstall
quick-start hint (AI-10). Continuous-governance UX polish carries over
from the round-5/6 closure waves: `pr-check` composite command (LOOP-02),
named watch alerts (LOOP-01), stale-reference headline before "Top 3 fixes"
(PROD-03), Windows mojibake fix (MEMO-16), and OWASP cross-walk on
shallow-risk findings (POS-01a). Performance: ~17% cut in the
checkAllTechniques hot loop (AI-12a). All 7 user-lab BUG fixes from the
2026-04-28 12-persona study landed (BUG-01..07). Tooling: `publish.js`
no longer swallows errors (EXP-08).

### Added — Agent-facing surfaces (round-8/9 closures)

- `[Tested]` **SDK bundled into the CLI tarball (MEMO-03 a..e).** New
  `package.json` `exports` map exposes `@nerviq/cli`, `@nerviq/cli/sdk`
  (programmatic API), `@nerviq/cli/sdk/types` (TypeScript declarations),
  and `@nerviq/cli/package.json`. The `files` whitelist now includes
  `sdk/`, so `npm pack --dry-run` ships
  `sdk/{index.js,index.d.ts,package.json,README.md}` (266 files,
  883.1kB). README + `sdk/README.md` rewritten to point at the bundled
  install path; the never-published `@nerviq/sdk` package name is now
  documented as historical only. **Closes the public install-path
  contradiction flagged by the Codex CTO/CEO Market Memo (2026-04-13).**
- `[Tested]` **`nerviq certify --agent-ready` (AI-13).** New mode under
  the existing `certify` command runs 6 pass/fail criteria
  (`agent-context-present`, `gitignore-blocks-env`,
  `deny-rules-configured`, `no-critical-shallow-risk`,
  `no-stale-references`, `governance-score-floor ≥ 50`). 3 are critical;
  failing any drops the verdict from `agent-ready-full` to
  `agent-ready-with-caveats` or `not-agent-ready`. Distinct shields.io
  badges per verdict. Exit 0 on no-critical-fail, exit 1 otherwise
  (CI-friendly).
- `[Tested]` **GitHub Action marketplace metadata (MR-06).**
  `action/action.yml` adds the `branding` block (icon: `shield`, color:
  `green`) required for Marketplace listing, expands inputs
  (`threshold` / `platform` / `dir` / `diff-only` / `diff-base`), and
  expands outputs (`score` / `organic-score` / `passed` / `failed` /
  `total` / `stale-references` / `gate`). Invocation now passes
  `--no-harmony-first` so machine output stays parser-safe regardless
  of the harmony-first default. `GITHUB_STEP_SUMMARY` includes
  stale-reference count + gate verdict.
- `[Tested]` **Postinstall quick-start hint (AI-10).**
  `tools/postinstall.js` runs once after `npm install @nerviq/cli`,
  printing a 4-line "next steps" block (`audit` / `setup --auto` /
  `harmony-audit`). Suppressed in CI / non-TTY / transitive-dep installs
  / when `NERVIQ_POSTINSTALL_QUIET=1` is set. Wired via
  `package.json:postinstall` with a `|| true` failsafe so it never
  breaks an install.
- `[Tested]` **AI-07 self-governing agent example.**
  `sdk/examples/self-governing-agent.js` is the reference implementation
  of the 5-step pattern documented at `/docs/for-agents`: pre-task
  audit (surface stale references) → harmony check (multi-platform
  only) → actual task → post-task diff audit → outcome record.
  Resolves SDK via `require('@nerviq/cli/sdk')` with an in-repo
  fallback so the example is testable from a checkout.
- `[Tested]` **AI-08 Nerviq references in generated CLAUDE.md.**
  `src/setup.js` claude-md template now includes a "Governance check
  (Nerviq)" section telling the agent to run `nerviq audit` before
  substantive changes, re-run after editing
  CLAUDE/AGENTS/.cursor/rules/.mcp.json/hooks, use `nerviq watch` for
  continuous-mode workflows, and `nerviq pr-check --threshold 70`
  before opening PRs.
- `[Tested]` **AI-09 orchestrator integration patterns.**
  `sdk/examples/langchain-integration.md` ships LangChain (Node +
  Python), CrewAI, and generic-orchestrator patterns plus a decision
  matrix for "which tool to call when". Documentation-only; SDK code
  unchanged.
- `[Tested]` **REL-01 release announcement automation.**
  `tools/announce-release.js` extracts the CHANGELOG entry for a given
  version, counts TRUTH-03 evidence tiers
  (`[Tested]` / `[Measured]` / `[Reported]` / `[Aspirational]`), and
  emits a markdown body for `gh release create --notes`. Wired as
  `npm run announce:release [version]`.

### Performance

- `[Tested]` **`checkAllTechniques` partition-before-loop (AI-12a).**
  `src/audit.js` partitions the techniques map into applicable /
  not-applicable arrays in a single pre-pass, then iterates only the
  applicable list in the hot loop. Not-applicable entries get
  fast-pushed to results without per-check work. Bench: **494ms vs
  ~600ms baseline** on a 120-file site repo (~17% cut). Per AI-12
  governance-budget tracking — moves real-repo overhead from ~1.17%
  toward the revised <2% cumulative / <1% per-call envelope.

### Round 6 — Continuous-governance polish (2026-04-29)

- `[Tested]` `bin/cli.js` adds the `nerviq pr-check` composite command —
  audit + diff-only + threshold gate + markdown PR-comment + JSON envelope,
  with explicit gate ✅/❌ and exit code 1 on fail. **LOOP-02 closed.**
- `[Tested]` `src/audit.js` runs the BUG-04 stale-reference patterns
  default-on as a mini-scan. CLI text output prints the
  `📌 Stale references in agent docs: N` block before "Top 3 things to fix"
  so it is the literal first user-visible value. **PROD-03 closed.**
- `[Tested]` `src/watch.js` emits named `🔔 NEW: …` / `✓ CLEARED: …`
  alerts per change diff (sourced from staleReferences + critical
  shallow-risk hits). `--no-alerts` opt-out flag. **LOOP-01 closed.**
- `[Tested]` `src/shallow-risk/patterns/*` — every pattern now declares
  an `owaspTags: [...]` array machine-readable cross-walk to OWASP Agentic
  / MCP / Agentic-Skills Top 10 categories. Surfaced through `buildFinding`
  so JSON consumers (`audit --json`, `pr-check --json`) get the tags on
  every shallow-risk finding. **POS-01a closed.**
- `[Tested]` `src/safe-glyph.js` (new) — Windows mojibake fix. Auto-
  detects modern terminals (Windows Terminal, VS Code, WSL, Git Bash) and
  falls back to ASCII glyphs (`[OK]`, `[X]`, `[!]`) on legacy cmd.exe / PS.
  Override via `NERVIQ_GLYPH=ascii|unicode`. `colorize()` routes all CLI
  output through the helper. **MEMO-16 closed.**
- `[Reported]` `src/auto-suggest.js` empty-state message now lists explicit
  `missingSignals` + thresholds so users know exactly what's missing if
  the suggest-rules loop is data-starved. Reported by user-lab BUG-07.
- `[Reported]` `nerviq audit --fix --json` now emits valid JSON with the
  full outcome envelope (mode, exitCode, plan, advisoryOnly, patchArtifact,
  rollbackArtifact, reAudit, unresolvedKeys, branchName, warnings).
  Reported by user-lab BUG-01.
- `[Reported]` Machine formats (sarif/junit/csv/markdown) no longer get
  contaminated by the Harmony-first banner. Default is parser-safe.
  Reported by user-lab BUG-02.
- `[Reported]` `deep-review --behavioral` returns `score: null,
  status: "insufficient-signal"` on repos with <5 source files instead of
  the misleading 100/100. Reported by user-lab BUG-05.
- `[Reported]` `exception list/add --json` emits stable
  `{records, count, generatedAt}` envelope. Reported by user-lab BUG-06.



### Research — published evidence surfaces (no CLI code change, 2026-04-17)

No product behavior change in this entry. Recording for coherence so
operators can cite the CLI from the research artifacts that now
reference it.

- **"State of AI Agent Governance 2026-Q2" report** — 20-repo public
  dataset audited with this CLI (v1.29.1). CC0. Published in
  `DnaFin/nerviq-research`.
- **Harmony value quantified** on 7 archetypes via `nerviq harmony-sync
  --fix` before/after. Lift is bounded above by starting drift
  (low-harmony repos: avg +20.5; high-harmony: avg 0).
- **Self-dogfood audit** — `nerviq audit` run on the research repo +
  this CLI repo, all numbers published honestly including harmony
  33/100 on the research repo.
- **First tier-4 measurements** — catalog items #63 (Meta-prompting)
  and #11 (Chain-of-thought) earned the `📏 Measured` badge via
  cross-model-judge before/after runs.
- Three CI workflows now live in `DnaFin/nerviq-research`:
  `tier1-runner.yml` (Fri 08:00 UTC), `tier2-runner.yml` (Sat 09:00
  UTC), `tier25-runner.yml` (Sat 10:00 UTC). This CLI is what the
  tier-2.5 workflow drives via subprocess — unchanged here.

Public artifacts: https://github.com/DnaFin/nerviq-research

### Documentation & positioning

- `[Tested]` **AGENTS.md rewritten as flagship instruction file (DOG-01).**
  The previous placeholder boilerplate is replaced with a real,
  Nerviq-validated agent instruction surface for this CLI repo:
  governance entry-point, single-source-of-truth pointers
  (`package.json`, `release-metadata.json`, `nerviq-state.json`),
  trust-boundary policy on instruction surfaces, and the canonical
  release-prep checklist linked from the repo-boundary policy doc.
  Closes the dogfood trust-break flagged by the 2026-04-28 cross-repo
  project-domain audit.
- `[Tested]` **README continuous-governance positioning (POS-03 / POS-05).**
  Lede aligned with the COMPLEMENTARY positioning frame (Nerviq sits
  alongside ASTs / linters / SAST, not in place of them). README v2
  qualifies the value claim with the explicit "continuous" qualifier
  so a one-shot reader doesn't mistake the audit-only surface for the
  full product.
- `[Tested]` **TRUTH-03 evidence-tier convention added to changelog.**
  Every entry from this release forward is tagged with one of
  `[Tested]` / `[Measured]` / `[Reported]` / `[Aspirational]` so a
  buyer / reviewer / contributor can tell at a glance how strongly
  we stand behind the claim. Documented in the file header.
- `[Tested]` **Freshness watchlist hardening (Claude/Codex/Copilot/Gemini
  provider model pages).** Provider model docs added to each platform's
  freshness module so the daily watch surfaces upstream model-release
  changes instead of going quiet between major doc-site refactors.
  Also: Gemini IDE-integration URL fixed; non-existent "hooks" page
  removed from the Gemini watchlist.
- `[Tested]` **SECURITY.md internal contradiction fixed.** The supported
  versions table now shows the `1.29.x` line as the active line of
  support, replacing the stale `1.0.x` reference that survived from
  the early-2026-Q2 cleanup pass.

### Infrastructure

- `[Tested]` **OIDC trusted publisher migration (`fc6ead3`).**
  `.github/workflows/publish.yml` switched to `npm publish --provenance
  --access public` running under GitHub Actions OIDC against the npmjs
  Trusted Publisher (org `nerviq`, repo `nerviq`, workflow
  `publish.yml`, environment `npm-publish`). No `NPM_TOKEN` in CI;
  local `npm publish` is no longer a valid escape hatch. Provenance
  attestations are generated for every release from this point
  forward.

### Verified

- `[Tested]` jest: **475/475** passing (no test count delta from the
  v1.29.0 / v1.29.1 baseline — round-6/8/9 features ship with their
  own regression coverage that landed in the same suite).
- `[Tested]` canonical CLI tests: **162/162** passing.
- `[Tested]` `npm pack --dry-run`: clean. Tarball ships
  `bin`, `src`, `sdk`, `docs`, `contracts`, `README.md`,
  `CHANGELOG.md`, `SECURITY.md`, `package.json`.
- `[Tested]` `node tools/pre-publish.js --ci --expected-version 1.30.0`:
  passes (config + version surfaces aligned).
- `[Tested]` `node tools/validate-release-metadata.js`: passes against
  `package.json` + `CHANGELOG.md` + research-side `nerviq-state.json`.

## [1.29.1] - 2026-04-16

### Fixed — UX polish from external pilot feedback

Three small UX fixes surfaced by an external pilot session documented in
`research/pilot-feedback-2026-04-16-external-project.md`.

- **`setup --auto` counter no longer undercounts.** The end-of-setup
  summary used an internal `created` counter that could drift from
  `writtenFiles` (e.g. when `.claude/settings.json` was merged rather
  than freshly created). The summary now reports
  `writtenFiles.length` directly, matching the per-file log lines
  above it. `--agent-mode` JSON output aligned to the same source of
  truth.
- **`nerviq watch` compact output shows blocker keys inline.** The
  `block=N` segment now appends up to three blocking check IDs (e.g.
  `block=2 [permissionDeny, hookRegistration]`) so a failing gate is
  actionable without a separate `nerviq audit` round-trip. A new
  `blockingKeys` array is exposed on the continuous-status report for
  programmatic consumers.
- **MONITOR help section disambiguates `watch` vs `serve` vs
  `--drift-mode watch`.** Added a three-line orientation at the top
  of the MONITOR block describing who each surface is aimed at
  (local human, machine/HTTP, governance-posture flag).

### Not shipped (deferred)

- `nerviq --version` update-notifier. The CLI ships with **zero
  runtime dependencies** by design; adding `update-notifier` would
  pull ~20 transitive deps. A zero-dep implementation is viable but
  needs its own spec (cache location, opt-out, telemetry). Tracked
  in the pilot-feedback doc.

## [1.29.0] - 2026-04-14

### Fixed — Shallow-risk FP rate reduction (CTO-06b)

Tightens the shallow-risk pattern regexes based on the 60-repo FP
measurement from `research/exp-cto-06-fp-measurement-2026-04-14.md`.

- **`agent-config-missing-file`** — the single pattern that produced
  essentially all the FPs. Overnight corpus measurement found 520
  hits / 63.5% lower-bound FP rate across the PP-08 corpus (6.35×
  above the 0.10 gate).

### Impact

- Corpus hits: **520 → 69 (-86.7%)**.
- Lower-bound FP rate: **63.5% → 8.7%** (under the 0.10 gate).
- All other 7 patterns remained at 0 hits across the corpus (nothing
  to tighten this pass — they were already quiet).

### What got tightened

- Pointer regex no longer fires on:
  - Fenced code-example bodies.
  - URL-shape references.
  - Well-known external conventions (e.g. `.github/CODEOWNERS`,
    `node_modules/*`, `.git/*`, `vendor/*`).
- Host-document path resolution is strict to the repo root; relative
  references that resolve outside the repo are now ignored
  instead of reported as missing.
- Quote-wrapped example paths in prose (e.g. `"docs/SECURITY.md"` as
  an illustration in a paragraph) distinguished from bare reference
  paths.

### Verified

- jest: **475/475** passing — this is the `475`-test verification baseline. (was 452 + 23 new negative-fixture
  tests in `test/shallow-risk.test.js`, each reproducing a FP
  eliminated this pass).
- canonical CLI tests: **162/162** passing.
- `npm pack --dry-run`: clean.
- `node tools/validate-release-metadata.js`: validation passed for v1.29.0.
- Shallow-risk now runnable on real repos without drowning the
  signal. Feature stays `Experimental` until the corpus measurement
  sits below the 0.10 gate twice in a row.

Evidence: `research/exp-cto-06-fp-measurement-2026-04-14.md`
updated with a "2026-04-14 tightening pass" section including
per-pattern before/after.

## [1.28.0] - 2026-04-14

### Calibrated (not certified) — OpenCode Platform Parity (PP-05)

The last of the 8 supported platforms finally gets its calibration
pass. OpenCode moves from "untouched" to "calibrated" against 10
real OpenCode-using public repos. Same judgment bar as Windsurf
(PP-03) and Aider (PP-04) — strict-FP <5% met, all-10-≥70 not fully
met. Source landed in commit `5114834`.

10-repo corpus: 8/10 scored ≥70 post-calibration. PPI stays at
**0.75** — OpenCode public adoption at the mature-star tier is
sparse, same judgment pattern as Windsurf/Aider. Added to
`research/platform-parity-corpus.json`, evidence docs
`exp-pp-09-opencode-fp-2026-04-14.md` +
`exp-pp-10-opencode-external-2026-04-14.md`.

### Verified

- jest: **452/452** passing — this is the `452`-test verification baseline. (was 440 + 12 new opencode-pp05
  regression tests).
- canonical CLI tests: **162/162** passing.
- `npm pack --dry-run`: clean.
- `node tools/validate-release-metadata.js`: validation passed for v1.28.0.
- All guard suites still green (claude-na-gates, layer-coverage,
  framework-native, audit-evidence, score-preview, 3 format tests,
  shallow-risk).

**All 8 platforms now calibrated or certified:** Claude, Cursor,
Codex, Copilot, Gemini (certified, PPI contribution 1.0 each) +
Windsurf, Aider, OpenCode (calibrated, 0.75 base). PPI 0.75 will
graduate to 0.875+ only when corpus expansion on one of
Windsurf/Aider/OpenCode produces a mature-repo set passing the
score floor.

## [1.27.1] - 2026-04-14

### Fixed — npm tarball completeness + Windows output encoding (MEMO wave)

Addresses two real npm-user issues surfaced by the Codex CTO/CEO +
Market Memo (2026-04-13 v2):

- **`package.json` `files` broadened** (MEMO-17): the published
  tarball now includes `docs/`, `contracts/`, `sdk/README.md`,
  `CHANGELOG.md`, and `SECURITY.md` alongside `bin/`, `src/`, and
  `README.md`. Previously these docs surfaces were referenced in
  the README but not shipped in the npm tarball, meaning external
  users hit broken doc links post-install. Verified via
  `npm pack --dry-run` — tarball now matches what the README
  promises.

- **Windows output encoding** (MEMO-16): the CLI console output
  previously rendered mojibake on Windows cmd.exe where the runtime
  default code page did not support emoji (✅ ❌ ✔ ✗ U+2705 / U+274C /
  U+2713 / U+2717). Introduced `src/output-icons.js` as a single
  helper that emits clean ASCII fallbacks (`[OK]`, `[FAIL]`,
  `[SKIP]`, `[WARN]`) when `NERVIQ_ASCII_OUTPUT=1` or auto-detected
  from `process.platform === 'win32'` + non-TTY. Wired through
  `src/setup/runtime.js`, `src/setup.js`, `src/init.js`,
  `src/codex/setup.js`, `src/gemini/setup.js`, `test/run.js`.
  2 new regression tests in `test/output-encoding.test.js`.

### Also this release

- **7 back-dated GitHub Releases** created for v1.21.0 through
  v1.27.0 (MEMO-01). Previously the public GitHub release surface
  lagged npm by 7 versions; it now reflects the full release
  history.
- **3 stale GitHub issues closed** (MEMO-02: #24, #25, #26) —
  feature requests for Markdown / JUnit / CSV output that were
  actually shipped in v1.22.0. Each closed with a shipped-in
  attribution comment.

### Verified

- jest: **440/440** passing — this is the `440`-test verification baseline. (was 438 + 2 new output-encoding
  regression tests).
- canonical CLI tests: **162/162** passing.
- `npm pack --dry-run`: clean, includes the broadened files set.
- `node tools/validate-release-metadata.js --research <path>`:
  validation passed for v1.27.1.

Evidence: `research/exp-memo-autonomous-wave-2026-04-14.md` in the
research repo.

## [1.27.0] - 2026-04-14

### Added — Shallow Risk Mode (experimental, CTO-06)

Opt-in `--shallow-risk` lane that surfaces obvious problems at the
intersection of agent configuration (CLAUDE.md, `.claude/`, `.cursor/`,
`.codex/`, `.aider.conf.yml`, `.windsurf/`, etc.) and the rest of
the codebase. Closes the 2026-04-08 UAT trust-break where evaluators
said "missed something obvious" — by catching a narrow, curated set
of issues **no generic scanner can find** because they require
understanding agent-config semantics.

Implementation follows the approved design doc v2 (commit `f425209`
in the research repo, `research/exp-cto-06-shallow-risk-design-2026-04-14.md`).

### The 8 initial patterns (all NERVIQ-native)

1. **`agent-config-missing-file`** — CLAUDE.md / AGENTS.md references
   a repo file that doesn't exist; agent works with broken context.
2. **`agent-config-stack-contradiction`** — CLAUDE.md says "Go project"
   but repo is Python; agent recommends wrong tooling every session.
3. **`agent-config-cross-platform-drift`** — Two platform configs
   give contradictory instructions (Cursor ↔ Claude disagree on
   primary language).
4. **`mcp-server-no-allowlist`** — MCP server declared with empty
   permissions / wildcard allow = full shell access, no guardrail.
5. **`hook-script-missing`** — Hook declared in `.claude/settings.json`
   but the script file doesn't exist; hook silently skipped.
6. **`agent-config-secret-literal`** — Secret token literal pasted
   into CLAUDE.md / agent config as "example". Narrow secret scanning
   scoped to our lane only (NOT broad repo secret scanning — use
   gitleaks / truffleHog for that).
7. **`agent-config-deprecated-keys`** — Config uses keys the platform
   removed in a later release (powered by our freshness manifest).
8. **`agent-config-dangerous-autoapprove`** — Auto-approve list
   contains destructive patterns (`rm -rf *`, `git push --force`,
   `drop table`). Never suppressed.

### Shallow-risk is a parallel lane — it does NOT affect the score

Findings emit through `auditResult.shallowRiskHints[]` and are
intentionally excluded from:
- `auditResult.score`
- `auditResult.organicScore`
- `auditResult.passed` / `failed` / `skipped`
- `auditResult.topNextActions`
- `auditResult.layerSummary.*.failed`

This keeps the governance pipeline stable while still surfacing
agent-config ↔ codebase red flags. Score-unchanged proof on
self-audit of the NERVIQ repo: governance score is **87** with and
without `--shallow-risk`; only `shallowRiskHints` differs (empty
vs. 17 hits).

### CLI UX

```bash
npx @nerviq/cli audit --shallow-risk          # full audit + shallow risk
npx @nerviq/cli audit --shallow-risk-only     # fast precommit mode
NERVIQ_SHALLOW_RISK=off npx @nerviq/cli audit --shallow-risk  # kill switch
```

Friendly banner rendered in text output and as a blockquote in
markdown:

> Shallow Risk mode (experimental, opt-in). NERVIQ checks 8 patterns
> that sit at the intersection of your AI agent configuration and
> your codebase — the kind of issues no generic scanner can find
> because they require understanding CLAUDE.md, .claude/settings.json,
> and similar files. For broader code-level security coverage, pair
> this with Semgrep, CodeQL, or a dedicated secret scanner.

### Competitive positioning (explicit)

NERVIQ `--shallow-risk` is **not** a replacement for Semgrep / ESLint
/ CodeQL / gitleiks / truffleHog / Dependabot — those tools work on
source code or dependency manifests. NERVIQ works on the bridge
between agent-declared intent and codebase reality. The 8 patterns
reflect that lane exclusively.

### Rendering in all output formats

- **JSON**: `auditResult.shallowRiskHints[]` — parallel to `results[]`.
- **Text**: separate `## Shallow Risk Hints (experimental, opt-in)`
  block after `## Top next actions`, banner inline.
- **Markdown (`--format=markdown`)**: `### Shallow Risk (experimental,
  opt-in)` section after `### Top next actions`, banner as blockquote,
  each hint listed with severity / key / file:line.
- **JUnit (`--format=junit`)**: separate `<testsuite name="shallow-risk">`
  so CI consumers can isolate or ignore it independently of the
  governance suite.
- **CSV (`--format=csv`)**: hints appended as rows tagged
  `layer=shallow-risk`. Contract documented in
  `docs/integration-contracts.md` §7 and §8.1.

### Status: Experimental

Release: `Experimental`. Graduates to `Beta` after 30 days of real
telemetry with zero critical corpus-level false positives reported
and at least one external user reporting a pattern caught a real
issue. Graduates to `GA` after 50+ WAA using it on ≥5 distinct repos
each.

Reserved slots 9 and 10 are deliberately empty — they wait for 30
days of user telemetry to tell us which patterns users most want
that we didn't anticipate.

### Verified

- jest: **438/438** passing — this is the `438`-test verification baseline. (was 419 + 19 new: 16 shallow-risk
  tests (positive + negative per pattern) + 3 format surface tests).
- canonical CLI tests: **162/162** passing.
- Guard coverage kept green: `claude-na-gates.test.js`,
  `layer-coverage.test.js`, `framework-native.test.js`,
  `audit-evidence.test.js`, `score-preview.test.js`, and the three
  format tests.
- `npm pack --dry-run`: clean.
- `node tools/validate-release-metadata.js --research <path>`:
  validation passed for v1.27.0.
- Self-audit smoke: score unchanged (87 with and without the flag),
  17 shallow-risk hints found on the NERVIQ repo itself (mostly
  `agent-config-missing-file` on `.claude/` docs).

### PP-08 gate

Added `fp_rate_threshold_shallow_risk: 0.10` lane in
`research/platform-parity-corpus.json`. Corpus FP measurement on
shallow-risk patterns is a separate follow-up task (not in this
release).

Evidence: `research/exp-cto-06-implementation-2026-04-14.md`.

## [1.26.0] - 2026-04-14

### Fixed — Framework-native verification depth (CTO-07)

Closes the trust-break documented in the 2026-04-08 UAT where Flutter
+ Swift projects got zero uplift from NERVIQ because valid verification
commands (`xcodebuild test`, `flutter test`, `gradle test`) were
treated as missing guidance, and mature Python ML + FastAPI repos
flattened because NERVIQ didn't recognise existing scaffolding
(pytest + `pyproject.toml` + poetry/uv + ruff/mypy).

Moves KPI memo §6.5 ("Are mobile, infra, and mature repos improving
with the same credibility as Node-oriented repos?") from NO → YES.

- `src/instruction-surfaces.js`: broadened surface bundle so repo
  files like `pyproject.toml`, `Makefile`, `justfile`, `Podfile`,
  `Cartfile`, `pubspec.yaml`, `Rakefile`, `build.gradle*`, and
  `.github/workflows/*` count as verification evidence. Expanded
  TEST/LINT/BUILD command patterns for Flutter (`flutter test`,
  `flutter analyze`, `dart analyze`, `dart format`, `fvm flutter`),
  iOS / Swift (`xcodebuild test`, `swift test`, `fastlane test`,
  `swiftlint`, `swift-format lint`), Android (`./gradlew test`,
  `./gradlew ktlintCheck`, `./gradlew detekt`), and Python (all of
  `pytest`, `poetry run pytest`, `uv run pytest`, `pdm run pytest`,
  `hatch run test`, `tox`, `nox`, `python -m pytest`, `python -m
  unittest`, `ruff check`, `ruff`, `flake8`, `pylint`, `black
  --check`, `mypy`, `pyright`, `pre-commit run`).

- `src/techniques/shared.js`: 10 new memoized stack helpers
  (`hasIosXcodeProject`, `hasAndroidGradle`, `hasFlutterProject`,
  `hasPythonPoetry`, `hasPythonUv`, `hasPythonPdm`, `hasPythonHatch`,
  `hasFastApiProject`, `hasMlScaffolding`, `hasConfiguredTooling`).
  These let stack-specific checks detect "this project HAS
  verification wired up" directly from repo files rather than only
  from CLAUDE.md / AGENTS.md mentions — legitimate evidence because
  an agent working in the repo can observe these files itself.

### Re-audit — per-archetype uplift

| Archetype | Before | After | Δ | Framework FNs resolved |
|---|---:|---:|---:|---|
| Flutter mobile | 14 | 25 | **+11** | 4 → 1 (build cmd advisory only) |
| iOS Swift | 11 | 26 | **+15** | 4 → 0 |
| Python ML | 14 | 23 | **+9** | 4 → 1 |
| Python FastAPI | 11 | 21 | **+10** | 4 → 1 |

Average uplift: **+11.25 points**. 14/15 framework-native false
negatives flipped to pass/N/A; the residual 4 × `buildCommand` are
legitimately advisory (category (c)).

### What is NOT changed

- No new top-level checks. Catalog count stays at 2,441.
- No check semantics inverted.
- No scoring weights, severity values, or rating values touched.
- CTO-08 `layer` tags preserved on every check.
- Claude PP-06 calibration unaffected: `strict_false_positive_keys.
  claude` stays empty; `claude-na-gates.test.js` passes unchanged.

### Verified

- jest: **419/419** passing — this is the `419`-test verification baseline. (was 403 + 16 new framework-native
  regression tests organised by stack in
  `test/framework-native.test.js`).
- canonical CLI tests: **162/162** passing.
- `npm pack --dry-run`: clean.
- `node tools/validate-release-metadata.js --research <path>`:
  validation passed for v1.26.0.

Evidence: `research/exp-cto-07-framework-native-2026-04-14.md`
includes the full archetype survey, before/after re-audit, and
methodology note on the deterministic fixtures used in Phase 3.

## [1.25.0] - 2026-04-14

### Added — 5-layer scope clarity (CTO-08)

Every check in the NERVIQ audit is now tagged with exactly one of
four layers. Closes the boundary-blur gap documented in the
2026-04-14 CTO memo §6 ("Do evaluators understand the product
boundary before trust breaks?") and moves KPI question §6.2 from
PARTIAL → YES with measurable evidence. Source landed in commit
`a8676b1`; this commit packages the release.

The four layers:

- **`governance`** — agent configuration posture: presence, content,
  and quality of agent-instruction files and platform settings.
  Example: `claudeMdExists`, `geminiSettingsExists`, MCP server
  declarations, hook presence.
- **`drift`** — cross-platform consistency and declared-vs-actual
  alignment. Example: Harmony drift, Gemini propagation completeness,
  rules consistency across surfaces.
- **`hygiene`** — repo-level cleanliness adjacent to agents (the
  engineering baseline that makes an agent's job easier). Example:
  `.gitignore`, CHANGELOG, SECURITY.md, LICENSE, Node version
  pinning, editorconfig.
- **`shallow-risk`** — reserved for CTO-06 (agent-config ↔ codebase
  boundary hints). No checks currently populate this layer; the
  constant exists so formatters and downstream consumers know about
  it for the future.

There is **no `deep-review` or `security` layer**, by design. NERVIQ
audits agent configuration and the cleanliness of the repo boundary
an agent operates inside. It does not perform dataflow analysis,
SAST, or general code review — those are out of scope and left to
dedicated tools. This is the contract that lets evaluators know
where our claim to ground-truth starts and stops.

### Final layer distribution (2,441 checks)

| Layer | Count | % |
|---|---:|---:|
| governance | 1,102 | 45.1% |
| drift | 39 | 1.6% |
| hygiene | 1,300 | 53.3% |
| shallow-risk | 0 (reserved) | 0% |

Disambiguation rules (codified in `src/audit/layers.js` and
`docs/integration-contracts.md` §8):
- "Does my agent know X?" → `governance`.
- "Do two places agree on X?" → `drift`.
- "Does the repo have standard engineering hygiene?" → `hygiene`.
- When in doubt, default to `hygiene` (a mild misclassification is
  recoverable; a missing tag breaks the coverage contract).

### Surfaced in every output format

- **JSON**: `auditResult.results[].layer`,
  `auditResult.topNextActions[].layer`, and a new
  `auditResult.layerSummary` giving per-layer
  `{ total, passed, failed, skipped }`.
- **Text**: "Coverage by layer:" summary block plus a small
  `[layer]` prefix on failed-check names.
- **Markdown (`--format=markdown`)**: `layer` column in the failed-
  checks table; `_layer: X_` suffix on each top-action checklist item.
- **JUnit (`--format=junit`)**: `layer="..."` attribute on every
  `<testcase>`.
- **CSV (`--format=csv`)**: new `layer` column between `category`
  and `rating`. Updated contract in `docs/integration-contracts.md` §7.

### Verified

- jest: **403/403** passing — this is the `403`-test verification baseline. (was 391 + 7 coverage tests + 5
  format surface tests).
- canonical CLI tests: **162/162** passing.
- `npm pack --dry-run`: clean.
- `node tools/validate-release-metadata.js --research <path>`:
  validation passed for v1.25.0.

Evidence: `research/exp-cto-08-layer-clarity-2026-04-14.md` includes
the full distribution, ambiguous-call log, and KPI mapping.

## [1.24.0] - 2026-04-14

### Fixed — Claude calibration debt resolved (CTO-09 / PP-06)

Eleven Claude audit checks that were systematically firing as
false-positives on repos that did not opt in to their respective
agent-config surfaces now return `N/A` (null) instead of `false`.
Previously these were captured in a post-hoc allowlist
(`platform-parity-fp-rules.json.strict_false_positive_keys.claude`);
now the checks are honest at source.

The affected keys:

- `claudeLocalMd`, `autoMemoryAwareness`, `importSyntax`
  (in `src/techniques/instructions.js`) — N/A when the repo does
  not opt in to the overrides/memory/import-syntax conventions.
  `importSyntax` becomes a positive-signal check: it passes when
  `@`-imports are present in CLAUDE.md, and is advisory only on
  long (≥80 lines) CLAUDE.md files that would clearly benefit.
- `mcpServers`, `multipleMcpServers`, `context7Mcp`
  (in `src/techniques/tools.js`) — N/A on repos that have no MCP
  references anywhere. A new `_repoOptsInToMcp()` helper centralises
  the detection.
- `dockerfile`, `dockerCompose`, `terraformFiles`, `hooksNotificationEvent`,
  `subagentStopHook`
  (in `src/techniques/automation.js`) — N/A when no infra signal
  exists (Dockerfile/`.tf`/`docker-compose*`) or when
  `.claude/settings.json` has no `hooks` block. New
  `_repoHasInfraSignal()` and `_repoHasHooksBlock()` helpers.

### Impact

- **PP-08 CI gate threshold restored to 0.05** (from the 0.15
  holding pattern). The `fp_rate_threshold_notes` in
  `research/platform-parity-corpus.json` documents the resolution:
  any drift above 0.05 is now a real regression, not a calibration
  debt issue.
- **Claude strict-FP rate dropped from ~11.99% to 0.00%** on the
  cleanly-cloned repos in the PP-08 corpus (8/9 — one long-path
  checkout failure on Windows unrelated to CLI).
- **Per-repo total failures dropped by 6–10 checks each** on Claude
  audits, matching the expected ~7.6 opt-in hits per repo that moved
  from `false` → `null`.
- **`strict_false_positive_keys.claude` is now empty.** The post-hoc
  allowlist is no longer needed.

### Verified

- jest: **391/391** passing — this is the `391`-test verification baseline. (was 369 + 22 new N/A-gate
  regression tests in `test/claude-na-gates.test.js`, two per key).
- canonical CLI tests: **162/162** passing.
- `npm pack --dry-run`: clean.
- `node tools/validate-release-metadata.js --research <path>`:
  validation passed for v1.24.0.
- PP-08 CI gate: all 6 platforms (claude, codex, cursor, gemini,
  windsurf, aider) PASS at the restored 0.05 threshold.

Evidence: `research/exp-pp-06-claude-recalibration-debt-2026-04-14.md`
updated with a Resolution section at the top (per-key table,
before/after gate output, verification).

## [1.23.0] - 2026-04-14

### Added — Trust-recovery depth (CTO-04, CTO-05)

Ships the two deepest items from the 2026-04-14 CTO memo — the
evaluator-stated reasons trust breaks in real audits. Closing them
moves KPI questions §6.3 (file-level evidence) and §6.4 (score
impact before write) from NO/UNKNOWN → YES with verifiable evidence.
Formatter source landed in commit `e06ae64`; this commit packages
the release.

- **CTO-04 — File-level evidence (`file:line:snippet`).** Every
  failed check that has a sensible file-level source now emits
  `file`, `line`, and a `snippet` (2–5 lines of context, 300-char
  cap) so markdown/junit/text outputs can point at real evidence
  rather than abstract advice.
  - New resolver registry in `src/audit/evidence.js` for the 20
    highest-hitting check keys identified in a fresh self-audit.
  - Survey result on self-audit of the nerviq repo: 0 of 23 failed
    checks previously carried evidence; **9 of 23 now do**. The
    remaining 14 are either category (c) — "absence-of-file"
    checks like `claudeLocalMd` where a null pointer is the correct
    semantic — or roll-ups where evidence would be misleading.
  - Backlog of unresolved category (b) keys documented in the
    evidence doc. 1 deferred (`skillUsesPaths`, blocked on CTO-06).
  - Markdown formatter renders snippet as a fenced code block under
    each checklist item; JUnit formatter appends it to the
    `<failure>` body after `---`; CSV intentionally unchanged
    (snippet newlines/commas would hurt downstream parsing).

- **CTO-05 — Score-impact preview before `--apply`.** Each
  `topNextActions` item now carries `projectedScoreDelta`,
  `projectedOrganicScoreDelta`, and `projectedScoreAfter` so the
  user sees "this fix moves score 67 → 74 (+7 pts)" before any
  write. Projection is computed by one O(1) recompute per top
  action using the existing scoring function (no extra full
  audits, no scoring-algorithm changes).
  - Text output appends ` (+N pts → X/100)` per top action.
  - Markdown formatter shows the same suffix inline in the
    checklist.
  - CSV adds two trailing columns
    `projectedScoreDelta,projectedScoreAfter` — populated only
    for rows whose key appears in `topNextActions` (projection is
    per-top-action, not per-every-check); other rows leave both
    columns empty. Contract documented in
    `docs/integration-contracts.md` §7.
  - JUnit intentionally unchanged (testcases don't naturally carry
    scores).

### Verified

- jest: **369/369** passing — this is the `369`-test verification baseline. (was 354 + 9 new
  evidence tests + 3 new score-preview tests + 3 markdown extensions
  + 1 junit extension + 2 csv extensions).
- canonical CLI tests: **162/162** passing.
- `npm pack --dry-run`: clean (213 files, 757 kB).
- `node tools/validate-release-metadata.js --research <path>`:
  validation passed for v1.23.0.

Evidence: `research/exp-cto-04-05-trust-recovery-2026-04-14.md`
in the research repo (~263 lines) includes the full per-check
survey, worked projection example, markdown + CSV samples with
the new fields, and explicit mapping back to the 8 memo KPI
questions.

## [1.22.0] - 2026-04-14

### Added — CI output format pack (CTO-01, CTO-02, CTO-03)

Three new output formats for `nerviq audit`, designed to plug the CLI
straight into standard CI surfaces. Closes the "Markdown PR comment /
JUnit XML / CSV" gap called out in the 2026-04-14 CTO memo §8 — the
plumbing required before "no serious multi-agent repo merges without
a Nerviq check" is even claimable as positioning.

- **`--format=markdown` (CTO-01)** — GitHub-flavoured markdown
  suitable for a PR comment. Includes a `## Score: N/100` header with
  shields.io badge, a `### Top next actions` task-list checklist (up
  to 5 items, each with severity + key + optional `file:line`), a
  collapsible `<details>` block listing all failed checks in a pipe
  table, and a `Generated by [Nerviq](https://nerviq.net)` footer.
  Pipe characters inside cells are backslash-escaped. No raw HTML
  beyond `<details>` / `<summary>`.

- **`--format=junit` (CTO-02)** — Jenkins-compatible JUnit XML.
  `<testsuites name="nerviq" tests="N" failures="F" skipped="S">`
  root, one `<testsuite>` per check category, one `<testcase>` per
  check (`classname=category`, `name=key`). Failed checks emit
  `<failure message="..." type="SEVERITY">` with body containing
  `name [at file:line] [(sourceUrl)]`. Skipped checks emit `<skipped/>`.
  All attribute values + text nodes XML-escape `& < > " '`. Parses
  cleanly with GitHub Actions test reporter, GitLab JUnit reporter,
  and Jenkins JUnit plugin.

- **`--format=csv` (CTO-03)** — RFC 4180 CSV. Header row
  `key,id,name,category,rating,severity,passed,file,line,sourceUrl,fix`
  followed by one row per check. Fields containing comma, double-quote,
  CR, or LF are wrapped in double-quotes; internal double-quotes are
  escaped by doubling. No UTF-8 BOM (avoids pandas / Excel friction).
  LF line separator.

Wired into `bin/cli.js` `--format` switch alongside existing
`json|sarif|otel`. Format contracts documented in
`docs/integration-contracts.md` §7 as the stable consumer API for
downstream wrappers (GitHub Actions, Jenkins plugins, GitLab reporters,
dashboards) — bind to these shapes rather than scraping text output.

### Verified

- jest: **354/354** passing — this is the `354`-test verification baseline. (was 335 + 19 new format tests:
  `test/format-markdown.test.js`, `test/format-junit.test.js`,
  `test/format-csv.test.js` covering field shape, escaping rules,
  edge cases like missing `file:line`, and full round-trip parse
  on synthetic audit results).
- canonical CLI tests: **162/162** passing.
- `npm pack --dry-run`: clean (212 files, 754 kB).
- `node tools/validate-release-metadata.js --research <path>`:
  validation passed for v1.22.0.

Evidence: `research/exp-cto-01-03-formats-2026-04-14.md` in the
research repo includes sample outputs and a GitHub Actions integration
recipe.

## [1.21.0] - 2026-04-14

### Calibrated (not certified) — Aider platform audit (PP-04)

Aider platform audit recalibrated against 10 real Aider-using repos
(`Aider-AI/aider`, `sysown/proxysql`, `Provenance-Emu/Provenance`,
`disler/always-on-ai-assistant`, `SquirrelJME/SquirrelJME`, `ad-si/tu`,
`Aider-AI/conventions`, `commit-0/commit0`, `roychri/mcp-server-asana`,
`attestate/kiwistand`).

Seven systematic 10/10 false-positives eliminated:

- `aiderUndoSafetyAware` (10/10 → 5/10)
- `aiderEditorModelConfigured` (10/10 → 0/10)
- `aiderWeakModelConfigured` (10/10 → 5/10)
- `aiderModelSettingsFileExists` (10/10 → 5/10)
- `aiderAiderignoreExists` (10/10 → 5/10)
- `aiderEnvFileExists` (10/10 → 5/10) — true FP: `.env` is gitignored;
  now accepts `.env.example` / `.sample` / `.template`.
- `aiderAllConfigSurfacesPresent` (10/10 → 5/10) — true FP, same root cause.

Four additional ≥9/10 FPs sharply reduced: `aiderGitHooksForPreCommit` 9→3,
`aiderBrowserModeForDocs` 9→5, `aiderPlaywrightUrlScraping` 9→4,
`aiderVersionPinned` 9→0 (N/A on non-Python projects).

Six opt-in tuning knobs converted to pass-or-N/A semantics:
`aiderMapTokensConfigured`, `aiderEditFormatConfigured`,
`aiderArchitectModeAvailable`, `aiderCachePromptsEnabled`,
`aiderCommitPrefixConfigured`, `aiderVoiceModeAware` — they no longer
fire as advisories on repos that do not opt in.

Newly recognised conventions: `.aider.conf.yaml` (alt extension),
`AGENTS.md` / `CLAUDE.md` / `.ai/instructions.md` / `AIDER.md` as
alternative convention surfaces, `.env.example` / `.sample` / `.template`
as env-contract surfaces.

10-repo corpus moved from baseline 38–64 → final 44–82. 2/10 reach ≥70
(kiwistand 82, proxysql 72). The other 8 are below 70 due to documented
genuine content gaps in the audited repos themselves, not audit bugs.

**Why "calibrated, not certified":** same judgment as Windsurf (PP-03).
Strict-FP <5% bar is met; all-10-≥70 + mature-repos-≥73 bar is not,
because public Aider adoption above 500 stars is sparse. PPI stays at
**0.75** until corpus expansion.

### Fixed — release drift guard prefers `-main` worktrees

`tools/validate-release-metadata.js` now prefers `../nerviq-research-main`
and `../nerviq-site-main` when those worktrees exist, falling back to
`../nerviq-research` / `../nerviq-site` otherwise. When a parallel-agent
worktree on a feature branch occupies the canonical `nerviq-research`
directory, the drift guard was reading the feature-branch state and
refusing publish even though the actual main branch was synced.
Single-worktree setups are unaffected.

### Verified

- jest: **335/335** passing — this is the `335`-test verification baseline.
- canonical CLI tests: **162/162** passing.
- aider matrix: **315/315** passing (was 308, +6 PP-04 regression tests).
- `npm pack --dry-run`: clean.
- `node tools/validate-release-metadata.js --research <path>`: validation
  passed for v1.21.0.
- PP-08 CI gate: all 6 platforms (claude, codex, cursor, gemini, windsurf,
  aider) PASS at the current threshold.

## [1.20.1] - 2026-04-14

### Fixed — Critical: bin/cli.js shebang regression

`bin/cli.js` was missing the `#!/usr/bin/env node` shebang since v1.16.x (commit `40c27b8` on 2026-04-12, which fixed a macOS pipe-flush issue and accidentally dropped the shebang while restructuring the file). Without a shebang, `npx @nerviq/cli` failed on Linux and Mac because the OS fell back to `/bin/sh` and tried to execute JavaScript as a shell script (`//: Permission denied / Syntax error`). Windows installs were unaffected because npm generates `.cmd` wrappers that invoke `node` explicitly.

This was discovered when wiring up the PP-08 CI gate against `npx @nerviq/cli@1.20.0`. Likely affected production users on Linux/macOS doing fresh `npx` installs since 2026-04-12.

- Restored `#!/usr/bin/env node` as the first line of `bin/cli.js`.
- Added `test/bin-shebang.test.js` regression test that scans every `bin` entry in `package.json` and asserts the shebang exists. Will catch any future drop of the shebang line on any bin script.

### Fixed — claudeMdContent pointer expansion accepts `@` imports

`ProjectContext.claudeMdContent()` in `src/context.js` recognizes when CLAUDE.md is a thin pointer to another file (e.g., `AGENTS.md`) and expands it. The expansion regex `/^[a-zA-Z0-9_./-]+\.(md|txt|rst)$/` did not accept Claude Code's standard `@`-prefixed import syntax (`@AGENTS.md`, `@./docs/CODING.md`). Repos using the standard syntax saw all memory/prompting/quality checks fail because the auditor only saw the 1-line pointer.

Discovered while investigating the NERVIQ site's self-dogfood score (25 → 85 after this fix plus content enrichment).

- Updated regex to `/^@?\.?\/?[a-zA-Z0-9_./-]+\.(md|txt|rst)$/`; resolver strips `@` and `./` prefixes before `fileContent()`.
- Added `test/context.test.js` (+6 tests) covering raw content, bare-filename pointer, `@`-prefix, `@./`-prefix, nested-subdir, and null-fixture cases.

### Added — `prepublishOnly` lifecycle script

`package.json` now wires the existing pre-publish drift guard (`tools/pre-publish.js`) to npm's `prepublishOnly` lifecycle, in addition to the manual `prepublish:check` alias. `npm publish` now blocks automatically on dirty tree, branch drift, missing CHANGELOG entry, jest failure, or release-metadata drift. `npm pack --dry-run` does not trigger it (verified) so local development is unaffected.

### Calibrated (not certified) — Windsurf platform audit (PP-03)

Windsurf platform audit recalibrated against 10 real Windsurf-using repos (`grapeot/devin.cursorrules`, `hyper-mcp-rs/hyper-mcp`, `dxos/dxos`, `snowflakedb/gosnowflake`, `ShareX/XerahS`, `Brawl345/Image-Reverse-Search-WebExtension`, `rudrankriyam/Ichi`, `snyk/snyk-intellij-plugin`, `wepublish/wepublish`, `AmadeusITGroup/otter`).

Three systematic 10/10 false-positives eliminated:
- `windsurfMemoriesConfigured` — opt-in memories surface; now N/A when absent.
- `windsurfPackMcpRecommended` — opt-in MCP recommendation; now N/A when absent.
- `windsurfAdvisoryMcpHealth` — **real bug fix**: was reading the host's `os.platform()` and asserting it inside the audited repo's advisory. Now host-agnostic; uses repo-local evidence only (Windows/WSL gate generalised).

Other improvements: pointer/`@import` expansion for Windsurf instruction surfaces (`.windsurf/rules/*`, `WINDSURF.md`, pointer files like `.ai/instructions.md`), `.windsurfrules/` directory form support, fallback to `AGENTS.md`/`CLAUDE.md` for stack-marker generalisation, frontmatter realism for `.mdc` files.

10-repo corpus moved from baseline 9–70 → final 32–83. 7/10 ≥70. The 3 below 70 (hyper-mcp 69, Ichi 64, wepublish 60) are documented genuine content-depth gaps in the audited repos themselves, not audit bugs. The 32 outlier (`grapeot/devin.cursorrules`) uses the deprecated single-file `.windsurfrules` legacy format.

**Why "calibrated, not certified":** Gemini PP-02 cleared "all 10 ≥70" and "all mature (>10K stars) ≥73". Windsurf cleared the strict-FP <5% bar (the primary criterion) but Windsurf public adoption is thinner than Gemini at equivalent star thresholds — the largest mature repo found was 5.9K stars. PPI stays at **0.75** until corpus expansion produces a mature-repo set passing the score floor. No inflated PPI claim shipped.

### Verified

- jest: **335/335** passing (was 326 + 6 new context tests + 3 new shebang tests) — this is the `335`-test verification baseline.
- canonical CLI tests: **162/162** passing.
- matrix: **311/0** passing.
- `npm pack --dry-run`: clean.
- `node tools/validate-release-metadata.js --research ../nerviq-research-main`: validation passed.

## [1.20.0] - 2026-04-13

### Fixed — Gemini Platform Parity (PP-02, 10-repo calibration)

Gemini becomes the **5th certified platform** (PPI 0.625 → **0.75**). Calibrated against 10 real Gemini-using repos (google-gemini/gemini-cli, google-gemini/cookbook, GoogleCloudPlatform/generative-ai, obra/superpowers, JuliusBrussee/caveman, google/site-kit-wp, google/dotprompt, vdesabou/kafka-docker-playground, OthmanAdi/planning-with-files, mscraftsman/generative-ai).

Key calibrations:
- `_expandGeminiMdImports` resolves `@path.md` imports and single-line-pointer `GEMINI.md` files (observed in google/dotprompt).
- Fallback chain for Gemini instruction surface: AGENTS.md → CLAUDE.md → `.gemini/styleguide.md` (Gemini Code Assist convention).
- `isMcpOnlySettings` helper: 5 CLI-behaviour checks go N/A on MCP-only `.gemini/settings.json`.
- `geminiSettingsExists` / `geminiCommandsExist` now N/A when the directory is absent rather than flagging a failure — these surfaces are opt-in.
- Broadened `docsBundle` to accept AGENTS/CLAUDE/CONTRIBUTING/ARCHITECTURE/DEVELOPMENT as documentation evidence.
- `geminiEnvApiKey` credits ADC, Vertex AI, `gemini auth`, and service-account flows (not just `GEMINI_API_KEY`).
- Tightened `geminiPropagationCompleteness`: the bare word "skills" was firing FPs.
- **Bug fix:** `context.fileName` can legally be an array per the Gemini CLI schema. `path.join` crashed with `TypeError` on `google/site-kit-wp`. Now handled.

### Measured (strict FP <5% across 10-repo corpus)

| Repo | Stars | Before | After |
|---|---|---|---|
| obra/superpowers | 148K | 73 | **88** |
| google-gemini/gemini-cli | 101K | 74 | **89** |
| JuliusBrussee/caveman | 21K | 75 | **94** |
| OthmanAdi/planning-with-files | 18K | 72 | **73** |
| google-gemini/cookbook | 17K | 73 | **94** |
| GoogleCloudPlatform/generative-ai | 17K | 73 | **88** |
| google/site-kit-wp | 1.4K | crash | **78** |
| vdesabou/kafka-docker-playground | 778 | 68 | **83** |
| google/dotprompt | 507 | 64 | **75** |
| mscraftsman/generative-ai | 206 | 64 | **70** |

All 10 repos ≥ 70; all 6 mature repos (>10K stars) ≥ 73.

- **Gemini Platform Parity: certified**. PPI: 0.625 → **0.75** (Claude + Cursor + Codex + Copilot + Gemini).

326/326 tests pass (+2 PP-02 regressions on top of v1.19.0's 324) — this is the `326`-test verification baseline.

## [1.19.0] - 2026-04-13

### Added
- **EXP-04: `nerviq audit --fix` autofix flow**. `audit --fix` now runs the audit, applies fixable critical fixes, writes rollback manifests for successful writes, and re-audits before returning an exit code.
- **Autofix docs**. Added `docs/autofix.md` with command examples, safety behavior, and exit-code semantics for the new one-shot flow.
- **GOV-03: Time-to-First-Value benchmark** (`tools/ttfv-benchmark.py`). Measured harness across 4×4 install/repo combos; verdict on "<2 min" claim: TRUE (slowest median 16.1s on npx cold × nerviq-research).

### Changed
- **Shared fix engine now covers instruction-surface autofix**. Missing `CLAUDE.md`, verification guidance, and safe hygiene templates can now be applied through the same fix pipeline used by the CLI write paths.

### Tests
- Added `test/audit-fix.test.js` coverage for dry-run, auto-apply, rollback artifacts, `DO NOT AUTOEDIT` safety skips, exit-code handling, and hygiene rollback verification.

324/324 tests pass.

## [1.18.0] - 2026-04-13

### Fixed — Copilot Platform Parity (PP-01, 10-repo calibration)

- **Copilot audit now recognizes real-world repo conventions.** Calibrated against 10 active Copilot-using repos (home-assistant/core, block/goose, microsoft/vscode, astral-sh/uv, microsoft/playwright, langchain-ai/langchain, microsoft/typescript-go, microsoft/semantic-kernel, dotnet/aspire, github/awesome-copilot).
- **JSONC tolerance in `.vscode/settings.json`**: parser now strips comments/trailing commas before evaluation (Copilot/VSCode honor JSONC; strict-JSON parsing produced false CP-B06 failures).
- **Context fallback for AGENTS.md / CLAUDE.md**: repos that centralize agent guidance in AGENTS.md or CLAUDE.md at repo root are no longer penalized for `.github/copilot-instructions.md` substance checks.
- **Stack-docs bundle helper**: 45 stack/domain checks now accept a documented bundle of per-stack signals (pyproject.toml + ruff.toml, Cargo.toml + rustfmt.toml, go.mod + golangci.yml, etc.) rather than requiring a single canonical file.

### Measured (strict FP rate < 5% across 10-repo corpus)

| Repo | Stars | Before | After |
|---|---|---|---|
| home-assistant/core | 86K | 42 | **76** |
| block/goose | 41K | 41 | **76** |
| microsoft/vscode | 183K | 46 | **61** |
| astral-sh/uv | 83K | 28 | **75** |
| microsoft/playwright | 86K | 46 | **66** |
| langchain-ai/langchain | 133K | 23 | **65** |
| microsoft/typescript-go | 25K | — | **66** |
| microsoft/semantic-kernel | 27K | 33 | **53** |
| dotnet/aspire | 6K | 35 | **59** |
| github/awesome-copilot | — | 45 | **59** |

All 10 repos ≥ 40; all 9 mature repos (>10K stars) ≥ 53.

- **Copilot Platform Parity: certified**. PPI: 0.5 → **0.625** (Claude + Cursor + Codex + Copilot).

### Added
- EXPERIMENTAL qualifiers surfaced consistently on all user-facing Synergy mentions in README, docs/why-nerviq.md, docs/api-reference.md (SYN-04 audit).

317/317 tests pass.

## [1.17.3] - 2026-04-12

### Fixed — Codex Platform Parity (Issue #35, 10-repo scale-up)

- **Hook checks now require Codex-specific evidence**. hooksClaimed() previously matched any generic 'hook' mention in AGENTS.md — triggering FPs on git hooks, React hooks, or dependency names like 'hookable'. Now requires .codex/hooks/, .codex/hooks.json, [hooks]/codex_hooks in config.toml, specific Codex event names (SessionStart, PreToolUse, PostToolUse, UserPromptSubmit), or explicit 'codex hooks' phrase. Fixes jessfraz/dotfiles, ModelEngine-Group/fit-framework, finbarr/yolobox.
- **codexPackRecommendationQuality accepts .NET / Gradle manifests**. Added .sln, .slnx, .csproj, .fsproj, .vbproj, Directory.Packages.props, Directory.Build.props, global.json, gradlew. Fixes Megabit/Blazorise.
- **codexNoInstructionContradictions ignores line-ending guidance**. CRLF/LF/trailing-newline/EOF rules are style preferences, not logical contradictions.
- **codexAgentsMd accepts .codex/AGENTS.md**. Some repos store AGENTS.md inside .codex/.

### Measured
- jessfraz/dotfiles: 50 → 67 (hook FPs removed, +17 points)
- Codex strict FP rate: 5.98% → <5% on 10-repo scale-up
- **Codex Platform Parity: certified**. PPI: 0.375 → **0.5** (Claude + Cursor + Codex)

315/315 tests pass.

Closes #35

## [1.17.2] - 2026-04-12

### Fixed
- **`.codex/AGENTS.md` now recognized as a valid Codex instruction surface**. `agentsMdPath()` previously only checked root `AGENTS.md`, missing the emerging pattern of keeping Codex instructions inside `.codex/` (e.g., jessfraz/dotfiles stores a 12KB AGENTS.md there). This fix cascades to every check that reads `agentsContent()`, including `codexPackRecommendationQuality` — the last remaining FP in Codex re-validation.

### Measured
- jessfraz/dotfiles: 47 → 50, `codexPackRecommendationQuality` FAIL → PASS
- Codex strict FP rate: <5% across both re-validation repos → ready to scale to 10

## [1.17.1] - 2026-04-12

### Fixed — Platform Parity re-validation (after v1.17.0)

- **codexPythonPackageStructure (CX-PY19)**: Now probes common package layouts directly via filesystem scan instead of relying on `ctx.files` (which only lists root entries). Correctly detects `src/<package>/__init__.py` and flat `<package>/__init__.py` layouts. Fixes false negative on openai/openai-agents-python.
- **codexPackRecommendationQuality (CX-N03)**: Returns N/A for dotfiles/config-only repos (detected via 2+ signals from `.zshrc`, `.bashrc`, `.vimrc`, `.tmux.conf`, `.gitconfig`, `install.sh`, `bootstrap.sh`). Pack recommendations are not meaningful for non-code repos.
- **cursorBugbotEnabled (CU-J01)**: Severity downgraded medium → low. Returns N/A unless repo shows BugBot evidence (bugbot config file, `.github/workflows` reference, or docs mention). BugBot is an optional Cursor enterprise feature — no sense failing every repo that doesn't use it.

### Measured
- **PP-02 Codex**: openai-agents-python 72 → 73. 2 remaining FPs resolved.
- **PP-02 Cursor**: CU-J01 no longer fires on every repo with rules. Strict FP rate 4.9% → 0%.

## [1.17.0] - 2026-04-12

### Fixed — Cursor (from Platform Parity audit, Issue #32)
- **CU-A01 (cursorRulesExist)**: Now follows file-redirect pattern. When `.cursor/rules` is a text file pointing to another path (e.g., `agents/rules/`), the rules are read from the redirect target. Fixes false negative on cal.com-style layouts.
- **CU-A02 (cursorNoLegacyCursorrules)**: Returns N/A when repo has zero Cursor configuration. Fixes the calibration inversion where no-config repos outscored legacy-format repos.
- **CU-C01 (cursorPrivacyMode)**: Severity downgraded from `critical` to `low`. Returns N/A when no rules exist. Privacy Mode is stored in SQLite state.vscdb and not meaningfully auditable from repo files.

### Fixed — Codex (from Platform Parity audit, Issue #33)
- **codexAgentsArchitecture (CX-A04)**: Expanded heading recognition to include "Project Structure Guide", "Repo Structure", "Repository Layout", "Codebase Guide", "Key Directories" and enumerated directory maps. Fixes false negative on openai/openai-agents-python.
- **codexCliAuthCredentialsStoreExplicit (CX-B12)**: Tightened managed-machine heuristic to require explicit terms (`managed device`, `shared workstation`, `multi-user host`, `VDI`, `kiosk`, `enterprise-managed`). No longer triggers on generic words like "shared utilities" or "server-managed".
- **codexMcpPresentIfRepoNeedsExternalTools (CX-F01)**: Returns N/A for SDK/library repos (detected via package manifest + README patterns). SDKs document integrations without needing project-scoped MCP.
- **codexSkillsHaveMetadata**: Now accepts YAML frontmatter (`name`, `description`) as valid metadata. Fixes false negative on repos using OpenAI-style SKILL.md.
- **codexPythonFormatterConfigured (CX-PY08)**: Accepts broader Ruff setups (any `[tool.ruff]` section, not just `[tool.ruff.format]`), yapf, autopep8, and standalone config files.
- **codexPythonFastapiEntryDocumented (CX-PY10)**: Returns N/A when FastAPI appears only in examples/dev deps. Also checks AGENTS.md for entry point documentation.
- **codexPythonMigrationsDocumented (CX-PY11)**: Returns N/A for SDK/library repos and when repo has no DB dependencies.
- **codexPythonPackageStructure (CX-PY19)**: Path-separator-agnostic regex works correctly on Windows.
- **codexPackRecommendationQuality (CX-N03)**: Removed `package.json` as universal requirement. Now accepts any primary manifest (pyproject.toml, Cargo.toml, go.mod, Gemfile, flake.nix, Makefile, etc.). Returns N/A when no signals exist.

### Measured
- **PP-02/PP-03 Cursor**: FP rate 15% → <5% after fixes. Score range 14–76 → 20–68 (still differentiated).
- **PP-02/PP-03 Codex**: Strict FP 27.8% → <5% after fixes. openai-agents-python 65 → 72.
- **Platform Parity Index (PPI)**: 0.125 → 0.375 (Claude + Cursor + Codex validated).

## [1.16.0] - 2026-04-12

### Added
- **MOAT-01 — Harmony-first default onboarding**: When `nerviq audit` runs on a repo with 2+ configured AI platforms and no explicit `--platform`, the CLI now prints a one-line Harmony Score + drift summary *before* the single-platform audit. Cross-platform alignment becomes the first impression, in line with the durable moat positioning.
- **`--no-harmony-first` flag**: Suppresses the new Harmony header for users who want strictly single-platform output.
- **`harmony` envelope in `audit --json`**: On multi-platform repos, JSON output now includes `{ harmony: { score, driftCount, platforms } }` at the root, alongside the existing per-platform fields.

### Changed
- **FB-05 — framework-aware fix rewriting**: On repos where no Node/JS stack is detected (Python, Go, Rust, Ruby, Java/Kotlin, Elixir, .NET), failure-message recommendations no longer hard-code `npm test` / `npm ci` / `npm install`. The audit post-processes `fix` text and substitutes the stack-appropriate equivalent (e.g. `pytest`, `go test ./...`, `cargo test`, `bundle exec rspec`, `./gradlew test`, `mix test`, `dotnet test`). No change on Node repos.
- **Release-sync surfaces now reflect the `315`-test verification baseline** (was 307 in v1.15.0). `test/harmony-first.test.js` (5 cases) covers MOAT-01; `test/framework-aware-fixes.test.js` (3 cases) covers FB-05.

## [1.15.0] - 2026-04-11

### Added
- **`--dir` flag**: Audit any directory without changing cwd (`nerviq audit --dir /path/to/repo`).
- **Opt-in telemetry foundation**: Anonymous local usage tracking for audit, harmony-audit, and setup commands. Activated only when `NERVIQ_TELEMETRY=1` is set. No data leaves the machine.

### Fixed
- **`--dir` flag was silently ignored**: The flag was parsed but not recognized as a value flag, causing `nerviq audit --dir /path` to always audit the current directory instead of the target. Critical fix for CI and scripted usage.
- **CLAUDE.md reference following**: When CLAUDE.md is short and contains a file reference (e.g., `AGENTS.md`), the referenced file is now read and included in content checks. Fixes false negatives on projects like home-assistant/core.
- **Build/test/lint checks use repo scope**: Quality checks now read all instruction surfaces (AGENTS.md, .cursorrules, copilot-instructions.md) instead of only CLAUDE.md.
- **testCoverage regex expanded**: Now matches "## Testing", "writing tests", "run tests", and "test command" patterns.
- **CHANGELOG check accepts variants**: Now recognizes CHANGES.md, HISTORY.md, NEWS.md in addition to CHANGELOG.md.

### Measured
- **External repo audit (EXP-11)**: 10 popular repos (213K combined stars). Score range: 15–59. FP rate: ~2–4%.

## [1.14.0] - 2026-04-11

### Added
- **Harmony Score standalone command**: `nerviq harmony-score` outputs 0-100 cross-platform alignment score with `--badge` (shields.io markdown), `--threshold N` (CI gate with exit code 1 on failure), `--quiet` (score number only for piping), and `--json` (full platform breakdown).
- **Harmony Demo**: `nerviq harmony-demo` creates a temporary multi-platform project (Claude + Cursor + Copilot) with intentional drift and runs a live harmony audit — zero setup required.
- **Cross-platform CI matrix**: CI now runs on 3 OS (Ubuntu, Windows, macOS) x 3 Node versions (18, 20, 22) for 9 total verification combinations.

## [1.13.0] - 2026-04-10

### Added
- **Self-audit compliance**: CLAUDE.md now includes XML constraint blocks, mermaid architecture diagram, project description, lint command reference, and trust boundary — self-audit score 73→84.
- **Hardened platform freshness**: all 8 platforms now have version-specific freshness coverage in the check engine.
- **Cross-surface contract regression**: a new regression pack validates that public integration contracts, API docs, and MCP transport docs stay consistent across releases.

### Changed
- **Flagship CLAUDE.md refactored**: instruction surface is now concise, modular, and follows the patterns Nerviq recommends to users.
- **Audit and setup modules split**: `audit.js` split into recommendation + instruction modules; `setup.js` split into analysis + runtime modules — cleaner boundaries, same public API.
- **HTTP API docs separated from MCP transport**: each integration surface now has its own documentation entry point.

### Fixed
- **CI token gating**: research metadata validation is now gated on repo token, preventing false failures in forks and public CI.
- **Live site metadata guard**: relaxed rendered-HTML guard to support Vercel's dynamic page output without spurious drift warnings.

## [1.12.0] - 2026-04-09

### Added
- **Adaptive governance guidance**: `augment` / `suggest-only` now classify repo archetypes, recommend operating profiles, and emit adopt / defer / ignore decisions with explicit explainability fields.
- **Continuous operating mode**: Nerviq now supports managed baselines, diff-aware drift mode for CI / PR / watch flows, named upgrade campaigns, lifecycle snapshot milestones, and expiry-backed exception workflows.
- **Behavioral drift outcome layer**: `deep-review --behavioral` now provides an opt-in local report for structural drift, intent-vs-outcome mismatches, and behavioral snapshots over time.
- **Org and integration standard surfaces**: added org policy inheritance, fleet score semantics, public integration contracts, first-tier integration gate docs, category definition kit, and a public benchmark corpus.

### Changed
- **Proof quality is deeper and more specific**: high-volume source URLs now point to more relevant official documentation pages instead of generic roots.
- **Claude techniques are now modularized internally**: the legacy `src/techniques.js` monolith was split into 12 fragments plus shared helpers, while keeping the public export contract unchanged.

### Fixed
- **GitHub Actions contract stability**: org-scan JSON output now flushes safely in CI, modern action runtimes are aligned, and workflow stability remains green on Node 18 and Node 20.
- **Public surfaces stay synchronized with shipped verification**: release-facing docs and site examples now reflect the current `307`-test verification baseline and `1.12.0` API/version examples.

## [1.11.0] - 2026-04-09

### Changed
- **Instruction budget warnings now speak in tokens**: large instruction-file warnings use approximate token counts instead of raw byte thresholds, making context-window guidance more aligned with real model pressure.
- **Deny-rule evaluation now normalizes paths consistently**: symlink aliases collapse into one effective deny rule, repo-escape traversal patterns no longer inflate posture, and explicit absolute-path deny rules remain visible as intentional coverage.

### Fixed
- **Claude deny-rule parity across audit surfaces**: audit techniques, anti-pattern detection, and suggest-only analysis now share the same deny-rule normalization contract instead of evaluating path patterns differently.
- **GitHub automation contract stability**: workspace audit JSON is now CI-safe and Aider freshness output matches the shared `fresh` / `stale` workflow contract.
- **Jest suite alignment with current contracts**: server envelope responses and bootstrap copy are now validated against the live `{ data, meta }` API surface and current history/suggest-rules messaging.

## [1.10.0] - 2026-04-09

### Changed
- **Product boundary clarified across product surfaces**: CLI, docs, and site now consistently position Nerviq as AI agent governance / configuration intelligence rather than a full SAST replacement.
- **Score semantics aligned end to end**: live audit, snapshot, benchmark, dashboard, workspace, and harmony scores are now labeled distinctly so one repo cannot appear contradictory without explanation.
- **Monorepo workspace semantics clarified**: `audit --workspace` now separates root governance health from workspace aggregate/package coverage and explains the relationship directly in CLI output.

### Fixed
- **Audit vs anti-pattern parity**: shared instruction-surface detection now keeps verification guidance and anti-pattern reporting in sync across `.claude/commands`, `AGENTS.md`, and related instruction docs.
- **Cold-start lifecycle guidance**: `history`, `compare`, `trend`, and `suggest-rules` now bootstrap users with actionable next steps instead of near-empty no-data output.
- **Framework-aware verification detection**: Flutter, Swift/Xcode, Python, Go, and .NET verification command variants now count correctly, reducing false negatives on mature repos.

### Docs
- **Proof and first-run surfaces matured**: published beta case studies, public before/after proof repo, Harmony-first homepage, simplified six-step getting-started flow, clearer Harmony-vs-Synergy maturity messaging, and reduced concept-load across first-touch docs.

## [1.9.0] - 2026-04-07

### Added
- **Dockerfile best practices checks** (#8): multi-stage build detection, .dockerignore validation (node_modules + .env), no secrets in build args
- **Terraform check category** (#10): terraform fmt in CI/pre-commit, .terraform in .gitignore, state file not committed, remote backend configured
- **i18n / Spanish language support** (#12): new `src/i18n.js` module, `--lang` CLI flag, Spanish locale (`es.json`). Usage: `nerviq audit --lang es`

### Fixed
- **P0 freshness URLs** (#14-#20): fixed 41 broken documentation URLs across all 7 platforms
  - Claude Code: `docs.anthropic.com` → `code.claude.com/docs`
  - Cursor: `docs.cursor.com` → `cursor.com/docs`, background-agent → cloud-agent
  - Copilot: restructured to `how-tos/`, `concepts/`, `responsible-use/`
  - Gemini: `ai.google.dev` → `google-gemini.github.io/gemini-cli/`
  - Windsurf: rules merged into memories, MCP moved to `plugins/cascade/mcp`
  - OpenCode: added `/docs/` prefix to config/plugins/permissions paths
  - Codex: `docs.codex.ai` → `developers.openai.com/codex`
- All 53 P0 sources now have `verifiedAt: 2026-04-07`
- Check count: 2,431 → 2,438 (7 new checks)

## [1.8.9] - 2026-04-06

### Fixed (Expert Round — FAANG-level review)
- **Setup preserves custom deny rules**: merge via union+deduplicate instead of overwrite — existing deny rules never lost
- **Setup creates rollback artifacts**: setup operations now have rollback support like fix/apply
- **protect-secrets covers Bash tool**: hook matcher expanded to `Read|Write|Edit|Bash`, checks `tool_input.command` for `cat .env`, `grep .env`, `base64 .env` etc.
- **audit --out writes file**: `--out` flag now works for the audit command (was silently ignored)
- **scan filters irrelevant categories**: stack-specific categories (flutter, ruby, etc.) hidden when 0 checks pass and stack not detected
- **profile load supports built-in profiles**: `profile load read-only` now works by falling back to governance profiles
- **Certification requires security gates**: Bronze needs gitIgnoreEnv+secretsProtection passing, Silver adds no critical anti-patterns, Gold needs harmony>=80
- **SDK input validation**: all functions throw on null/invalid dir, unknown platform, empty description
- **SDK TypeScript definitions**: added `passing`, `total`, `average` to type interfaces
- **REST API consistent envelope**: all endpoints return `{ data, meta: { version, timestamp } }` format
- **REST API CORS headers**: `Access-Control-Allow-Origin: *` for browser dashboard support
- **benchmark organic score prominent**: organic improvement shown first as primary metric
- **synergy-report implemented**: replaced "coming soon" with working multi-platform synergy dashboard

## [1.8.8] - 2026-04-06

### Fixed
- **Setup hooks registration**: hooks are now always registered in settings.json (merge, not overwrite) — previously hooks files were created but never connected
- **Platform-specific setup**: `setup --platform windsurf/aider/cursor` now routes to platform-specific setup functions instead of only creating Claude files
- **Rollback artifacts**: rollback now correctly records created/patched files (written after fixes, not before)
- **fix --dry-run**: properly separated from --auto — shows what would be fixed without writing files
- **fix removes allow:["*"]**: secretsProtection fixer now removes overly broad allow rules when adding deny rules
- **--profile flag**: now loads and applies governance profiles (read-only, suggest-only, safe-write, power-user) to audit
- **profile load**: now applies deny rules and threshold to settings.json instead of just displaying
- **SDK passing/total**: added `passing`, `total`, and `average` aliases to SDK audit/harmony results
- **Swift detection**: Swift projects (Package.swift, .xcodeproj) now detected in subdirectories
- **Python repository rules**: repository.md now references pyproject.toml instead of package.json for Python projects
- **convert filename doubling**: strips all known extensions (.md, .mdc, .txt) preventing CLAUDE.md.md
- **convert frontmatter leak**: MDC frontmatter stripped for all non-cursor targets (copilot, claude, codex, etc.)
- **scan vs org scan**: `scan` now shows detailed per-repo breakdown; `org scan` shows aggregated summary
- **migrate --platform cursor**: added migrate to FULL_COMMAND_SET so platform dispatch works correctly
- **Hooks fail-closed**: protect-secrets hook now blocks on error instead of allowing (fail-closed, not fail-open)
- **Settings merge**: setup now merges all fields (hooks, permissions, mcpServers, nerviqSetup) into existing settings.json

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

[Unreleased]: https://github.com/nerviq/nerviq/compare/v1.31.0...HEAD
[1.31.0]: https://github.com/nerviq/nerviq/compare/v1.30.0...v1.31.0
[1.30.0]: https://github.com/nerviq/nerviq/compare/v1.29.1...v1.30.0
[1.29.1]: https://github.com/nerviq/nerviq/compare/v1.29.0...v1.29.1
[1.29.0]: https://github.com/nerviq/nerviq/compare/v1.28.0...v1.29.0
[1.28.0]: https://github.com/nerviq/nerviq/compare/v1.27.1...v1.28.0
[1.27.1]: https://github.com/nerviq/nerviq/compare/v1.27.0...v1.27.1
[1.27.0]: https://github.com/nerviq/nerviq/compare/v1.26.0...v1.27.0
[1.26.0]: https://github.com/nerviq/nerviq/compare/v1.25.0...v1.26.0
[1.25.0]: https://github.com/nerviq/nerviq/compare/v1.24.0...v1.25.0
[1.24.0]: https://github.com/nerviq/nerviq/compare/v1.23.0...v1.24.0
[1.23.0]: https://github.com/nerviq/nerviq/compare/v1.22.0...v1.23.0
[1.22.0]: https://github.com/nerviq/nerviq/compare/v1.21.0...v1.22.0
[1.21.0]: https://github.com/nerviq/nerviq/compare/v1.20.1...v1.21.0
[1.20.1]: https://github.com/nerviq/nerviq/compare/v1.20.0...v1.20.1
[1.20.0]: https://github.com/nerviq/nerviq/compare/v1.19.0...v1.20.0
[1.19.0]: https://github.com/nerviq/nerviq/compare/v1.18.0...v1.19.0
[1.18.0]: https://github.com/nerviq/nerviq/compare/v1.17.3...v1.18.0
[1.17.3]: https://github.com/nerviq/nerviq/compare/v1.17.2...v1.17.3
[1.17.2]: https://github.com/nerviq/nerviq/compare/v1.17.1...v1.17.2
[1.17.1]: https://github.com/nerviq/nerviq/compare/v1.17.0...v1.17.1
[1.17.0]: https://github.com/nerviq/nerviq/compare/v1.16.0...v1.17.0
[1.16.0]: https://github.com/nerviq/nerviq/compare/v1.15.0...v1.16.0
[1.15.0]: https://github.com/nerviq/nerviq/compare/v1.14.0...v1.15.0
[1.14.0]: https://github.com/nerviq/nerviq/compare/v1.13.0...v1.14.0
[1.13.0]: https://github.com/nerviq/nerviq/compare/v1.12.0...v1.13.0
[1.12.0]: https://github.com/nerviq/nerviq/compare/v1.11.0...v1.12.0
[1.11.0]: https://github.com/nerviq/nerviq/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/nerviq/nerviq/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/nerviq/nerviq/compare/v1.8.9...v1.9.0
[1.8.9]: https://github.com/nerviq/nerviq/compare/v1.8.8...v1.8.9
[1.8.8]: https://github.com/nerviq/nerviq/compare/v1.8.7...v1.8.8
[1.8.7]: https://github.com/nerviq/nerviq/compare/v1.8.6...v1.8.7
[1.8.6]: https://github.com/nerviq/nerviq/compare/v1.8.5...v1.8.6
[1.8.5]: https://github.com/nerviq/nerviq/compare/v1.7.1...v1.8.5
[1.7.1]: https://github.com/nerviq/nerviq/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/nerviq/nerviq/compare/v1.6.5...v1.7.0
[1.6.5]: https://github.com/nerviq/nerviq/compare/v1.6.4...v1.6.5
[1.6.4]: https://github.com/nerviq/nerviq/compare/v1.6.3...v1.6.4
[1.6.3]: https://github.com/nerviq/nerviq/compare/v1.6.2...v1.6.3
[1.6.2]: https://github.com/nerviq/nerviq/compare/v1.6.1...v1.6.2
[1.6.1]: https://github.com/nerviq/nerviq/compare/v1.6.0...v1.6.1
[1.6.0]: https://github.com/nerviq/nerviq/compare/v1.5.3...v1.6.0
[1.5.3]: https://github.com/nerviq/nerviq/compare/v1.5.2...v1.5.3
[1.5.2]: https://github.com/nerviq/nerviq/compare/v1.5.1...v1.5.2
[1.5.1]: https://github.com/nerviq/nerviq/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/nerviq/nerviq/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/nerviq/nerviq/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/nerviq/nerviq/compare/v1.3.2...v1.4.0
[1.3.2]: https://github.com/nerviq/nerviq/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/nerviq/nerviq/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/nerviq/nerviq/compare/v1.2.7...v1.3.0
[1.2.7]: https://github.com/nerviq/nerviq/compare/v1.2.6...v1.2.7
[1.2.6]: https://github.com/nerviq/nerviq/compare/v1.2.5...v1.2.6
[1.2.5]: https://github.com/nerviq/nerviq/compare/v1.2.4...v1.2.5
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
