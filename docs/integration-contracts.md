# Integration Contract Pack

This document centralizes Nerviq's integration surfaces so external systems can adopt one stable package instead of scraping CLI text output.

## Included contract surfaces

- `nerviq serve` live OpenAPI contract via `GET /api/openapi.json`
- `nerviq-mcp` stdio JSON-RPC 2.0 transport for MCP hosts
- Generic audit webhook event contract via `contracts/audit-webhook-event.schema.json`
- CI reference patterns for GitHub Actions, GitLab, Bitbucket, and generic shell runners
- SDK usage examples through `sdk/README.md`

## 1. Local REST contract

Start the local API server:

```bash
npx @nerviq/cli serve --port 3000
curl http://127.0.0.1:3000/api/openapi.json > nerviq-openapi.json
```

Current GET endpoints:

- `/api/openapi.json`
- `/api/health`
- `/api/audit`
- `/api/harmony`
- `/api/catalog`

The live OpenAPI document is the canonical machine-readable contract for local HTTP consumers.

## 2. MCP transport (stdio JSON-RPC 2.0)

Nerviq also ships a separate MCP server binary for hosts that speak Model Context Protocol over stdio.

Use `nerviq serve` for local HTTP/OpenAPI consumers.
Use `nerviq-mcp` when the host expects MCP over stdio.

Example host registration:

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

The runtime implementation lives in `src/mcp-server.js` and speaks JSON-RPC 2.0 over stdin/stdout.

## 3. Generic webhook event contract

When `audit` is called with `--webhook` and the URL is not a Slack or Discord webhook, Nerviq now emits a stable generic JSON event contract.

Schema:

- `contracts/audit-webhook-event.schema.json`

Example:

```json
{
  "event": "nerviq.audit.completed",
  "schemaVersion": "1.0",
  "generatedAt": "2026-04-09T12:00:00.000Z",
  "platform": "claude",
  "score": 84,
  "passed": 196,
  "failed": 34,
  "results": [],
  "data": {
    "platform": "claude",
    "platformLabel": "Claude",
    "score": 84,
    "scoreType": "live-audit-score",
    "organicScore": 68,
    "passed": 196,
    "failed": 34,
    "skipped": 28,
    "checkCount": 258,
    "topNextActions": [],
    "quickWins": [],
    "scoreCoaching": {
      "currentScore": 84,
      "nextMilestone": 90,
      "pointsNeeded": 6,
      "fixesNeeded": 2
    },
    "suggestedNextCommand": "npx nerviq fix verificationLoop"
  },
  "meta": {
    "cliVersion": "1.22.0",
    "source": "nerviq-cli",
    "webhookFormat": "generic-audit-event"
  }
}
```

Compatibility note:

- Top-level `platform`, `score`, `passed`, `failed`, and `results` remain present for older consumers
- New consumers should prefer the nested `data` + `meta` contract

## 4. CI reference patterns

See:

- `docs/ci-integration.md`
- `action/README.md`
- `docs/gitlab-ci-template.yml`
- `docs/bitbucket-pipe.yml`

Recommended patterns:

### Score gate

```bash
npx @nerviq/cli audit --threshold 60
```

### PR drift gate

```bash
npx @nerviq/cli audit --diff-only --drift-mode ci --threshold 60
```

### Fleet rollup artifact

```bash
npx @nerviq/cli org scan ./app ./api ./infra --json --out nerviq-fleet.json
```

## 5. SDK reference

See:

- `sdk/README.md`
- `docs/api-reference.md`

Recommended SDK surfaces:

- Stable: `audit`, `harmonyAudit`, `detectPlatforms`, `getCatalog`
- Experimental: `synergyReport`, `routeTask`

## Why this pack exists

- External dashboards can bind to explicit contracts instead of scraping CLI text
- CI systems can use repeatable patterns for threshold gates, drift gates, and fleet rollups
- SDK users and HTTP users now share one public integration story instead of separate ad-hoc examples

## 6. First-tier integration gate

Nerviq does not treat every external surface as equally ready on day one.

Before broader distribution surfaces such as GitHub Marketplace listings, JetBrains plugins, or similar first-tier integrations are unblocked, the release bar must be green across:

- contract stability
- public proof density
- operational reliability
- clear ownership and support posture
- category fit

See `docs/first-tier-integration-gate.md` for the explicit gate and current posture.

## 7. CI output format contracts

`nerviq audit --format=<name>` emits machine-readable output shapes for standard
CI surfaces. All six formats share the same underlying audit result object; they
differ only in rendering.

### markdown (`--format=markdown`)

GitHub-flavoured markdown suitable for a PR comment. Contract:

- first line is an `## Score: N/100` heading followed by a shields.io badge
- second block lists `**Platform:**` and `**Checks:**` summary
- `### Top next actions` section with up to 5 items rendered as a GitHub
  task-list checklist: `- [ ] **[SEVERITY] Title** (` + backtick key + `)`
  optionally suffixed with ` — ` + backtick file:line
- `<details><summary>All failed checks (N)</summary>` collapsible block
  containing a GitHub pipe-table with columns
  `key | name | category | rating | file | line`. Pipe characters inside cells
  are backslash-escaped.
- footer line `Generated by [Nerviq](https://nerviq.net) vX.Y.Z · TIMESTAMP`
- no raw HTML other than `<details>` / `<summary>`

### junit (`--format=junit`)

JUnit XML, Jenkins-compatible. Contract:

- first line is `<?xml version="1.0" encoding="UTF-8"?>`
- root element `<testsuites name="nerviq" tests="N" failures="F" skipped="S" time="0">`
- one `<testsuite>` per check category, with attributes
  `name=category`, `tests`, `failures`, `skipped`, `time`, `timestamp`,
  `package="nerviq.PLATFORM"`
- one `<testcase>` per check, with `classname=category` and `name=key`
- failed checks emit `<failure message="..." type="SEVERITY">BODY</failure>`
  where message = `fix || name`, type = severity/impact, body contains
  `name [at file:line] [(sourceUrl)]`
- skipped checks emit `<skipped/>`
- all attribute values and text nodes XML-escape `& < > " '`

### csv (`--format=csv`)

RFC 4180 CSV. Contract:

- first row = header `key,id,name,category,rating,severity,passed,file,line,sourceUrl,fix`
- one row per check result in `auditResult.results`
- fields containing comma, double-quote, CR, or LF are wrapped in double-quotes
- internal double-quotes are escaped by doubling (`""`)
- no UTF-8 BOM
- line separator = LF

These contracts are the stable consumer API for `--format=markdown|junit|csv`.
Downstream wrappers (GitHub Actions, Jenkins plugins, GitLab reporters,
dashboards) should bind to these shapes rather than scraping the text output.

