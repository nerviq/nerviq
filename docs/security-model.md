# Security Model & Data Flow

## Data Flow

### What Nerviq Reads

- **Config files**: `CLAUDE.md`, `.cursorrules`, `AGENTS.md`, `.windsurfrules`, `.github/copilot-instructions.md`, `rules/`, and other platform-specific configs.
- **Project metadata**: `package.json`, `.gitignore`, directory structure (top-level only).
- **Snapshot input**: existing config state when `--snapshot` is used.

### What Nerviq Writes

- **Config files**: created or updated during `nerviq setup` and `nerviq apply`. Only writes to known config paths for detected platforms.
- **Snapshot JSON**: `nerviq --snapshot` produces a point-in-time JSON export of your config state. Stored locally.
- **Dashboard HTML**: `nerviq serve` generates a local HTML dashboard from snapshot data.

### What Nerviq Sends Externally

**Nothing, by default.** Nerviq performs no network requests during normal operation.

Exception: `nerviq deep-review` sends selected config content to an AI provider for analysis. This is opt-in and requires explicit invocation. The user controls which files are included.

## Telemetry

Telemetry is **opt-in only**. Disabled by default.

Enable with: `NERVIQ_TELEMETRY=1`

When enabled, Nerviq collects:
- Anonymous usage counts (commands run, platforms detected).
- CLI version.

Nerviq never collects:
- File contents or snippets.
- Repository names or paths.
- Code, configs, or any project-specific data.

## Supply Chain

Nerviq has **zero npm dependencies**. The entire CLI is self-contained.

- Nothing to audit in `node_modules`.
- No transitive dependency risk.
- SBOM available at `sbom.cdx.json` (CycloneDX format).

## Attack Surface

| Vector | Status |
|---|---|
| File system access | User-level permissions only. Reads/writes config files in the working directory. |
| Network | No outbound requests by default. No daemon. No background process. |
| Network listener | Only `nerviq serve` opens a local port. Explicit, user-initiated. |
| MCP server | Opt-in. Must be explicitly configured in the platform's MCP settings. |
| Elevated privileges | Never required. Runs as the current user. |
| Environment variables | Reads `NERVIQ_TELEMETRY`, `NERVIQ_LICENSE_KEY`, and platform-standard vars only. |

## License Implications

Nerviq is licensed under MIT (relicensed from AGPL-3.0 in v1.31.0). There are no distribution or network-use restrictions, and the projects Nerviq configures are unaffected either way — generated config files are not derivative works.

For full details see:
- [COMMERCIAL.md](../COMMERCIAL.md) -- licensing overview.
- [license-faq.md](license-faq.md) -- common questions about the MIT license and Nerviq.
