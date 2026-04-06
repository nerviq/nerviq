# Privacy Policy

**Nerviq** is designed with privacy as a core principle. This document describes exactly what data Nerviq collects, stores, and transmits.

## Local-Only by Default

Nerviq runs **100% locally** on your machine. No data leaves your computer during normal operation. All audit checks, scoring, config analysis, and report generation happen entirely on your local filesystem.

- **No PII collected** — ever, under any circumstances.
- **No cookies, no tracking, no analytics** by default.
- **No telemetry** unless explicitly opted in.
- **Plugin checks run locally** — all rule evaluation happens on-device.
- **REST API server is local-only** — the `nerviq serve` command binds exclusively to `localhost` (127.0.0.1).

## Opt-In Features

### Deep Review (`nerviq deep-review`)

Deep review is **opt-in** and requires an explicit API key to activate. When used:

- Only **selected configuration snippets** are sent to the AI provider for analysis.
- Snippets are **redacted** before transmission — secrets, tokens, and credentials are stripped.
- No data is stored remotely by Nerviq. Refer to the AI provider's own privacy policy for their data handling.

### Community Insights (`nerviq insights`)

Community insights are **opt-in only**, activated by setting the environment variable `NERVIQ_INSIGHTS=1`.

- When enabled, only **anonymous aggregate statistics** (score, check counts, detected stack) are shared.
- No project names, file contents, paths, or identifying information are transmitted.
- Data is sent to `nerviq-insights.nerviq.workers.dev` over HTTPS.

## Dependency Transparency

An **SBOM (Software Bill of Materials)** is published with every release (`sbom.cdx.json` in the repository root) so you can audit exactly which dependencies are included.

Nerviq has **zero runtime dependencies** — only Node.js (>=18) is required. Development dependencies are audited monthly.

## Audit Artifacts

Nerviq stores audit snapshots, activity logs, and rollback artifacts under `.nerviq/` in your project directory. These files:

- Never leave your machine.
- Contain only scores, check results, and timestamps.
- Include a `userId` field (`hostname:username`) for team audit tracking — this is your local machine identity only and is never transmitted.

## Contact

For privacy-related questions or concerns, email: **privacy@nerviq.net**
