# Nerviq — AI Agent Config Auditor

Score, audit, and fix your AI coding agent configuration directly in VS Code.

## Features

- **Status bar score** — instantly see your config health (green ≥ 70, yellow ≥ 40, red < 40)
- **Nerviq: Audit** — run a full audit for the current workspace and view findings in the Output panel
- **Nerviq: Harmony Audit** — cross-platform alignment check across all AI tools you have configured
- **Auto-re-audit** — automatically re-runs when `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, `.gemini/`, or other platform files change
- **Multi-platform** — supports Claude Code, Codex, Cursor, GitHub Copilot, Gemini CLI, Windsurf, Aider, OpenCode

## Quick Start

1. Install the extension from the VS Code Marketplace
2. Open any project that has AI agent config files
3. The extension activates automatically and shows your score in the status bar
4. Click the status bar item or run **Nerviq: Audit** from the Command Palette

## Commands

| Command | Description |
|---------|-------------|
| `Nerviq: Audit` | Run a full platform audit and display results |
| `Nerviq: Harmony Audit` | Cross-platform alignment audit |
| `Nerviq: Show Last Results` | Re-display the most recent audit output |
| `Nerviq: Open Docs` | Open nerviq.net documentation |

## Status Bar

| Color | Meaning |
|-------|---------|
| 🟢 Green | Score ≥ 70 — well configured |
| 🟡 Yellow | Score 40–69 — some gaps to address |
| 🔴 Red | Score < 40 — critical issues |

Click the status bar item to view the full audit results.

## Requirements

The extension runs `nerviq` via:
1. A local `node_modules/.bin/nerviq` installation (recommended)
2. A custom path set in settings (`nerviq.cliPath`)
3. `npx @nerviq/cli` (fallback — requires internet on first run)

**Recommended:** Add `@nerviq/cli` to your project's devDependencies:
```bash
npm install --save-dev @nerviq/cli
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `nerviq.autoAudit` | `true` | Re-audit when AI config files change |
| `nerviq.autoAuditDebounceMs` | `2000` | Debounce delay in ms before auto-re-audit |
| `nerviq.platform` | `auto` | Platform to audit (auto-detects by default) |
| `nerviq.cliPath` | `""` | Override path to the nerviq CLI binary |
| `nerviq.showStatusBar` | `true` | Show score in status bar |

## Platform Detection (auto mode)

The extension detects your platform from these files:

| Platform | Detection Signal |
|----------|-----------------|
| Claude Code | `CLAUDE.md`, `.claude/` |
| Codex | `AGENTS.md`, `.codex/` |
| Cursor | `.cursor/rules/`, `.cursorrules` |
| Copilot | `.github/copilot-instructions.md` |
| Gemini CLI | `GEMINI.md`, `.gemini/` |
| Windsurf | `.windsurf/`, `.windsurfrules` |
| Aider | `.aider.conf.yml` |
| OpenCode | `opencode.json`, `.opencode/` |

## Watched Files (auto-audit triggers)

- `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
- `.cursor/rules/**/*.mdc`
- `.gemini/settings.json`
- `.windsurf/rules/**/*.md`
- `.aider.conf.yml`, `.codex/config.toml`, `opencode.json`

## License

MIT — see [nerviq.net](https://nerviq.net)
