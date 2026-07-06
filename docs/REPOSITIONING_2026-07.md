# Nerviq Repositioning — July 2026 (DRAFT, owner approval required)

Status: **draft — nothing here is deployed.** Produced as part of the 30-day
revival sprint (Wave 1), per `FABLE_AUDIT_2026-07-05.md` move #2. All
outward-facing changes (README, site, npm description) ship only after owner
sign-off.

---

## 1. The new one-liner

> **Your agent docs lie. Nerviq finds the lies in 30 seconds.**

Long form (site hero / npm description):

> Nerviq catches the lies in your AI-agent configs: docs that reference
> scripts that don't exist, framework versions that drifted, and
> CLAUDE.md / AGENTS.md / Cursor rules that contradict each other across
> platforms. Deterministic, verifiable in 30 seconds, zero dependencies.

### Why this replaces the current positioning

| | Old lead | New lead |
|---|---|---|
| Claim | "0–100 governance score, 2,441 checks, 8 platforms" | "Stale references + cross-platform drift — here are your 3 lies" |
| Evidence | User-lab skeptic persona scored the machine contract **3/10**; behavioral score returns **100/100 on an empty repo**; benchmark "after" ceiling is 49/100 | User-lab scored Harmony drift **8.5/10** ("matches market pain exactly"); stale-ref detection has near-zero FPs and caught a real lie in nerviq's own AGENTS.md during the 2026-07-05 audit |
| Verifiability | Requires trusting 2,441 checks | Every finding verifiable with `cat package.json` in 30 seconds |

The score does not disappear — it is demoted to a secondary detail ("...and a
governance score if you want the big picture"). Check-count and platform-count
move out of the first screen entirely: they are supply-side numbers, and
supply was never the problem.

**Positioning frame:** "agent-doc lint" / "drift detection", not "governance
platform". Governance vocabulary returns when there is a paying team to govern.

---

## 2. Revised README top section (DRAFT)

Replace everything from the title through the end of the current
"Cross-platform Harmony" section with:

```markdown
# Nerviq

> **Your agent docs lie. Nerviq finds the lies in 30 seconds.**
>
> CLAUDE.md says `npm test` — but the script doesn't exist. AGENTS.md says
> Next 15 — package.json says 16. Your Cursor rules and your Copilot
> instructions give the agent contradictory orders. Nerviq is a zero-dependency
> CLI that catches stale references and cross-platform drift in AI-agent
> configs — deterministically, with findings you can verify by hand.

[badges]

## The two things it does best

### 1. Stale-reference detection (the lies)

`nerviq audit` runs a deterministic scan on every invocation:

- **Scripts that don't exist.** Your `AGENTS.md` says "run `npm test`" but
  `scripts.test` isn't defined in `package.json`. Flagged.
- **Framework versions that drifted.** Your `CLAUDE.md` says "Next.js 15 app"
  but `package.json` declares `next@^16.x`. Flagged.
- Near-zero false positives. Every finding verifiable in 30 seconds:
  `cat package.json` against the agent doc.

It found a real one in this very repo's AGENTS.md. It will probably find one
in yours.

### 2. Cross-platform drift (Harmony)

Most teams run 2+ agents — Claude Code and Cursor, Copilot and Codex. Their
config files drift silently until the agents behave differently on the same
repo. When 2+ platforms are configured, `nerviq audit` leads with the Harmony
report: what contradicts what, where, and the one-line fix.

```
$ nerviq audit
Harmony: 3 drift issues across Claude Code + Cursor
  ✗ test command: CLAUDE.md says `npm test` · .cursor/rules says `pnpm vitest`
  ✗ framework: AGENTS.md says Next 15 · package.json says next@16.1.2
  ...
```

## And when you want the big picture

Nerviq also ships a full config-governance layer: a 0–100 score across
8 platforms (Claude Code, Codex, Gemini CLI, Copilot, Cursor, Windsurf,
Aider, OpenCode — 2,441 checks), safe autofix with dry-run patches,
snapshots/trend, CI gate (GitHub Action), SDK, and an MCP server. Every check
carries a source URL and a freshness date.
```

Notes on the draft:
- The empty-repo case must stop scoring 100/100 before this README ships —
  it should return "insufficient signal" (user-lab trust-killer #3; tracked
  in the sprint plan, week 2).
- The per-platform check table moves below the fold; correct Claude Code
  count is **403** (not 400) — see §3.
- Keep the AGPL/commercial note where it is; the relicense question is a
  separate owner decision (sprint plan, week 2 decision item).

---

## 3. Number-drift fix list (site + repo copy)

Ground truth verified live on 2026-07-06 against the code on this branch:
`generateCatalog()` → **2,441 checks** (claude 403, codex 272, gemini 300,
copilot 299, cursor 301, windsurf 297, aider 283, opencode 286);
Jest → **509/509**; canonical suite → **168/168** (162 pre-existing + new
regression test from the doctor scoping fix).

### Site (nerviq.net — separate repo, DO NOT deploy without owner approval)

| Location | Currently says | Correct value | Source of truth |
|---|---|---|---|
| Homepage hero | "475 tests" | **509 Jest tests** (677 incl. 168 canonical) | `npx jest` run 2026-07-06 |
| Homepage per-platform check table | Sums to 2,438 (Claude Code listed as 400) | Claude Code **403** → table sums to **2,441** | `generateCatalog()` 2026-07-06 |
| `/research` | "1,014/1,193 tested" | **1,010/1,193** | `nerviq-state.json` reconciliation 2026-04-28 (open P0 TRUTH-01) |
| `/pricing` | Team **$49**/seat/mo | **$19**/seat/mo (W1 price) | Signed POS-04 staged-pricing plan, 2026-04-28 |
| Site-wide (if repositioning approved) | Score-first hero | Drift-wedge hero (§1) | This doc |

### Repo (fixable now, done on this branch)

| Location | Was | Now |
|---|---|---|
| `README.md` platform table | Claude Code 400 (sum 2,438) | Claude Code 403 (sum 2,441) |

`release-metadata.json` (`"tests": 475`) was deliberately **left as-is**: the
`verify:release-metadata` validator pins it to matching strings in the
CHANGELOG, site repo (`src/app/page.tsx`, `src/app/mobile/page.tsx`) and
research repo (`CLAUDE.md`, micro-workplan). The 475 → 509 bump must land as
one coordinated step in the **v1.31 release ritual** (all repos at once),
otherwise the validator breaks. Tracked in the sprint plan, week 1.

### Explicitly NOT changed without owner decision

- Discord link in README (`discord.gg/nerviq`, no visible community) — decide:
  remove, or staff it for the launch window.
- License (AGPL-3.0 + commercial) — audit recommends considering MIT/Apache
  for the core CLI; owner decision, week 2.
- npm package description (goes out with the next publish only).

---

## 4. The three user-lab trust-killers gating the new story

Before any public launch post (sprint weeks 3–4), these must be fixed —
they are the exact failure modes a skeptical first user will hit:

1. `audit --fix --json` emits invalid JSON (machine contract broken).
2. Machine output formats contaminated by the Harmony banner.
3. Behavioral score returns 100/100 on an empty repo → must become
   "insufficient signal".

(The remaining 5 user-lab fixes wait for demand — see sprint plan.)
