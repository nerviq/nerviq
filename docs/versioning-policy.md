# Versioning & Support Policy

## Semver

Nerviq follows [Semantic Versioning](https://semver.org/) strictly.

- **Major** (X.0.0): Breaking changes to CLI interface, config format, or behavior.
- **Minor** (0.X.0): New features, new platform support, new checks. Backward-compatible.
- **Patch** (0.0.X): Bug fixes, documentation corrections, minor improvements.

Pre-release versions use `-beta.N` or `-rc.N` suffixes and are not considered stable.

## Breaking Changes

Breaking changes are never introduced without notice.

Process:
1. The feature or behavior is marked `deprecated: true` in at least one minor release before removal.
2. Deprecation is announced in `CHANGELOG.md` with migration instructions.
3. The deprecated item is removed in the next major version.

Examples of breaking changes:
- Removing or renaming a CLI command or flag.
- Changing config file output format in a way that breaks existing workflows.
- Dropping support for a Node.js version.

## Node.js Support

| Version | Status |
|---|---|
| Node 18 (LTS) | Supported, tested in CI |
| Node 20 (LTS) | Supported, tested in CI |
| Node 22+ | Best-effort, not yet in CI matrix |
| Node 16 and below | Not supported |

Nerviq targets the two most recent LTS releases. When a Node.js LTS version reaches end-of-life, Nerviq drops support in the next major release.

## Platform Support

Nerviq actively maintains support for 8 AI coding platforms:

| Platform | Config target |
|---|---|
| Claude Code | `CLAUDE.md`, `.claude/` |
| Cursor | `.cursorrules`, `.cursor/rules/` |
| Windsurf | `.windsurfrules` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Cline | `.clinerules` |
| Aider | `.aider.conf.yml` |
| Codex | `codex.md`, `agents.md` |
| Amazon Q | `.qdeveloper/` |

New platforms are added as minor version bumps. Existing platform support is never removed in a minor release.

## Support Channels

| Channel | Use case |
|---|---|
| [GitHub Issues](https://github.com/nicepkg/nerviq/issues) | Bug reports, feature requests, platform support questions |
| Discord | Community discussion, tips, integrations |
| business@nerviq.net | Enterprise licensing, SLA inquiries, bulk deployment |

Response time targets: GitHub Issues triaged within 72 hours. Enterprise inquiries within 1 business day.
