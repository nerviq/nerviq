# July 2026 Platform Refresh — Top-4 (Claude Code, Cursor, Codex, Copilot)

Verification date: **2026-07-06** (live WebFetch/WebSearch + HTTP checks).
Scope per the 30-day revival sprint, Wave 1 (`FABLE_AUDIT_2026-07-05.md` move
#1): restore the P0-source freshness claim for the four platforms that cover
the ICP. Gemini CLI / Windsurf / Aider / OpenCode were deliberately NOT
refreshed (see §5).

Honesty rule applied throughout: `verifiedAt` was bumped **only** for sources
whose live content was actually fetched and matched on 2026-07-06. Per-check
`lastVerified` stamps on the 2,441 techniques were **not** touched — verifying
a source URL is not the same as re-verifying every check derived from it.
Check-level re-verification is v1.31 work (see follow-ups, §6).

---

## 1. Claude Code — 13/13 P0 sources VERIFIED

All 13 P0 URLs in `src/freshness.js` reachable at their recorded addresses,
content matches labels. No URL changes needed. All stamps → `2026-07-06`.
Latest CLI: v2.1.201 (2026-07-03).

Convention deltas (April → July 2026) an auditor must know — **check-impact
backlog for v1.31**, sources: code.claude.com/docs pages fetched 2026-07-06:

- **Auto memory is default-ON** (`~/.claude/projects/<p>/memory/MEMORY.md`,
  self-written, loaded every session; `autoMemoryEnabled`,
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`). New governance surface — model-written
  persistent state. No nerviq check covers it yet.
- **`.claude/rules/*.md` with `paths:` frontmatter** is the documented way to
  modularize instructions (user-level `~/.claude/rules/` too). Check coverage
  exists for `.claude/rules`; the `paths:` frontmatter gating is new.
- **Skills absorbed custom slash commands**: `.claude/commands/*.md` is now
  documented as legacy; `.claude/skills/<name>/SKILL.md` is canonical (Agent
  Skills open standard + extensions: `disable-model-invocation`,
  `disallowed-tools`, `display-name`, `default-enabled`; nested skills dirs).
- **Hooks**: 30+ event types now (incl. `ConfigChange`, `InstructionsLoaded`,
  `SubagentStart`, `Setup`); hook types beyond `command`: `http`, `mcp_tool`,
  `prompt`, `agent`; hooks in skill/agent frontmatter; matcher semantics for
  hyphenated identifiers changed to exact-match in v2.1.195 (silent behavior
  change).
- **settings.json**: large managed-enforcement surface
  (`allowManagedHooksOnly`, `strictPluginOnlyCustomization`,
  `disableSideloadFlags`, `requiredMinimumVersion`, `claudeMd` /
  `claudeMdExcludes` inline-managed memory). New permission-rule syntax
  `Tool(param:value)`, new modes `auto` / `dontAsk`; workspace trust now gates
  project `permissions.allow`.
- **AGENTS.md still NOT read natively** — documented pattern remains
  `@AGENTS.md` import or symlink (relevant to Harmony drift messaging).
- Output styles NOT deprecated (only the `/output-style` command was removed);
  new surfaces: workflows, channels, routines, sandbox settings.

Not verified: exact ship dates of individual 2.1.x versions in the window;
mid-April baseline version; per-check behavioral validity of the 403 Claude
checks (v1.31 work).

## 2. Cursor — 8 VERIFIED in place, 3 MOVED (fixed)

**Host retirement:** the entire `docs.cursor.com` host 308-redirects to
`cursor.com/docs` **losing the path** — a naive link-check reads "reachable"
while landing on the homepage. Exactly the failure mode nerviq lectures its
users about.

URL migrations applied (all replacement URLs fetched/HTTP-200 verified
2026-07-06):

| Old (`src/cursor/freshness.js`) | New |
|---|---|
| `docs.cursor.com/en/chat/agent` | `cursor.com/docs/agent/modes` |
| `docs.cursor.com/models` | `cursor.com/docs/models` |
| `docs.cursor.com/en/cli/using` | `cursor.com/docs/cli/using` |

`src/source-urls.js` cursor block (33 URLs) migrated to `cursor.com/docs/...`
equivalents (rules → `/docs/rules`, cli/mcp → `/docs/context/mcp`,
background-agents → `/docs/cloud-agent`, account → `/docs/account/pricing`,
etc. — every target HTTP-verified). Jest URL rule updated accordingly.
All 12 stamps → `2026-07-06`.

Convention deltas (check-impact backlog):

- `.cursor/rules/*.mdc` core unchanged (`description`/`globs`/`alwaysApply`);
  precedence now explicitly Team → Project → User rules.
- **`.cursorrules` removed from official docs entirely** — treat as
  unsupported (nerviq still ranks it as "legacy supported"; needs downgrade).
- **AGENTS.md first-class + nested support**; CLI also loads CLAUDE.md.
- **Skills**: `SKILL.md` under `.cursor/skills/` and `.agents/skills/`, with
  legacy-compat loading from `.claude/skills/` and `.codex/skills/`;
  `/migrate-to-skills` built-in. Slash-commands docs replaced by Skills.
- **Hooks**: `hooks.json` at project/user/enterprise level, ~20 events,
  `"version": 1` schema.
- New surfaces: `.cursor/environment.json` (cloud-agent env), `.cursor/BUGBOT.md`
  (nested), Team Marketplaces / enterprise MCP allowlist, unified
  user/team/workspace config page (v3.9).

Not verified: whether current builds still parse `.cursorrules` or
`.cursor/commands/*.md` at runtime; exact ship date of nested AGENTS.md.

## 3. OpenAI Codex — 10/10 P0 sources VERIFIED

All 10 URLs reachable at recorded addresses, no redirects. All stamps →
`2026-07-06`. Latest stable CLI 0.142.5 (2026-07-01) vs ~0.120.0 in April —
~22 minor versions of drift.

Convention deltas (check-impact backlog):

- **AGENTS.md**: override files (`AGENTS.override.md`), configurable fallback
  filenames (`project_doc_fallback_filenames`), 32 KiB default cap
  (`project_doc_max_bytes`), global `~/.codex/AGENTS.md`. Spec now stewarded
  by the Agentic AI Foundation (Linux Foundation).
- **config.toml**: new named **permission profiles** (`[permissions.<name>]`,
  `default_permissions`, built-ins `:read-only`/`:workspace`/
  `:danger-full-access`) — **mutually exclusive with legacy `sandbox_mode`**;
  a repo configuring both is a real, new misconfiguration class nerviq should
  flag. `approval_policy` gained granular per-category form. Project-scoped
  `.codex/config.toml` officially documented as an override layer.
- New surfaces: `.codex/agents/*.toml` + `~/.codex/agents/*.toml` (subagents),
  `features` toggles, `[agents]` limits, hooks/lifecycle, `apps`, `memories`,
  otel; `.codex/` committable setup scripts.

Not verified: per-release ship dates of each schema surface; field-level
`mcp_servers` diffs.

## 4. GitHub Copilot — 5 VERIFIED in place, 7 MOVED (fixed), 1 DEAD anchor (fixed)

URL migrations applied in `src/copilot/freshness.js` (+ same instruction-page
migration in `src/source-urls.js` and `src/copilot/techniques.js`; all final
URLs verified 2026-07-06):

| Old | New |
|---|---|
| `.../customizing-copilot/adding-custom-instructions-for-github-copilot` | `.../how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions` |
| same + `#creating-prompt-files` (anchor DEAD) | `.../tutorials/customization-library/prompt-files` |
| `.../concepts/agents/coding-agent/about-coding-agent` | `.../concepts/agents/cloud-agent/about-cloud-agent` (product renamed "cloud agent") |
| `.../concepts/agents/about-copilot-cli` | `.../concepts/agents/copilot-cli/about-copilot-cli` |
| `.../concepts/fallback-and-lts-models` | `.../concepts/models/fallback-and-lts-models` ("fallback" → "base" models) |
| `.../how-tos/provide-context/use-mcp` | `.../how-tos/provide-context/use-mcp-in-your-ide` |
| `code.visualstudio.com/docs/copilot/copilot-settings` | `code.visualstudio.com/docs/agents/reference/ai-settings` |
| `.../responsible-use/chat-in-your-ide` | `.../responsible-use/chat` |

All 13 stamps → `2026-07-06`.

Convention deltas (check-impact backlog):

- `.github/copilot-instructions.md` unchanged — now the only file universal
  across all surfaces.
- `.instructions.md`: new **`excludeAgent`** frontmatter keyword.
- **AGENTS.md first-class** (nearest-file precedence); CLAUDE.md/GEMINI.md
  read by cloud agent + code review — cross-platform files are now shared
  surfaces (Harmony-relevant).
- `.vscode/mcp.json`: new **`sandbox`** section (`sandboxEnabled` per server).
- Enterprise `copilot/managed-settings.json` GA (2026-07-01);
  `.github/agents/*.agent.md` + `~/.copilot/agents/` custom agents;
  org runner controls can override `copilot-setup-steps.yml`.
- Taxonomy renames to track: coding agent → **cloud agent**, fallback →
  **base** models, VS Code docs `copilot/` → `agents/` tree.

Not verified: ship dates for `excludeAgent`/Plan mode/CLAUDE.md pickup;
whether old `customizing-copilot` redirects will persist (we migrated off
them anyway).

## 5. Freshness-bot issue triage (8 open issues)

Top-4 — **root cause fixed on this branch** (sources re-verified, stamps
current, moved URLs migrated). Draft close-comments below; owner posts them
(external actions are owner-gated this sprint):

- **#42 Claude Code** — "All 13 P0 sources re-verified live 2026-07-06
  (hooks/permissions/changelog included); stamps updated in v1.31 branch.
  Closing."
- **#45 Cursor** — "All 12 P0 sources re-verified 2026-07-06. Note:
  docs.cursor.com host retired — 3 P0 URLs + 33 source-url entries migrated
  to cursor.com/docs equivalents. Closing."
- **#39 Codex** — "All 10 P0 sources re-verified 2026-07-06; latest stable
  0.142.5 noted. Closing."
- **#41 Copilot** — "All 13 P0 sources re-verified 2026-07-06; 7 moved URLs +
  1 dead anchor migrated to final paths. Closing."

Long tail — **NOT fixed, documented**: #40 (Gemini CLI), #43 (Windsurf),
#44 (OpenCode), #46 (Aider). Per the audit's move #1, these platforms are
proposed for demotion to a **community-maintained tier** (README note +
freshness-bot severity downgrade) rather than re-verification — the 8-platform
weekly treadmill is what made freezing tempting. Owner decision required;
until then their stamps remain honestly stale (2026-04-xx) and their issues
stay open.

## 6. Follow-ups this refresh creates (v1.31 scope, weeks 1–2)

1. Ship as **v1.31 "July 2026 platform refresh"** — includes the coordinated
   475→480 test-count bump across release-metadata/CHANGELOG/site/research
   (see `docs/REPOSITIONING_2026-07.md` §3).
2. Check-impact work from the deltas above, highest value first:
   Codex `[permissions]`-vs-`sandbox_mode` conflict check; Cursor
   `.cursorrules` downgrade to unsupported; AGENTS.md-is-shared-surface
   updates to Harmony (Copilot/Cursor read it natively, Claude Code doesn't);
   skills-surface checks (`.cursor/skills`, `.claude/skills` legacy-compat).
3. Freshness-bot: add redirect-target comparison (a 308 to a docs homepage
   must count as MOVED, not fresh) — the Cursor host retirement proved the
   current check is blind to this.
4. Gemini/Windsurf/Aider/OpenCode tier decision (owner).
