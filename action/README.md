# nerviq GitHub Action

Audit AI coding agent setups in CI and fail the workflow when the Nerviq score drops below your threshold.

## Usage

### Basic (score only, no threshold)

```yaml
name: Nerviq Audit
on: [pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: nerviq/nerviq/action@v1
```

### With threshold (fail if score is too low)

```yaml
name: Nerviq Audit
on: [pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: nerviq/nerviq/action@v1
        with:
          threshold: '50'
```

### Using outputs in subsequent steps

```yaml
name: Nerviq Audit
on: [pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: nerviq/nerviq/action@v1
        id: audit
      - run: echo "Score is ${{ steps.audit.outputs.score }}/100"
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `platform` | Platform to audit. One of `claude`, `codex`, `gemini`, `copilot`, `cursor`, `windsurf`, `aider`, `opencode`. | No | `claude` |
| `threshold` | Minimum passing score (0-100). The step fails if the score is below this value. Use `0` to disable threshold failure. | No | `0` |
| `harmony` | Run `harmony-audit` instead of a single-platform audit. | No | `false` |
| `comment` | Post or update a PR comment with the score summary. | No | `true` |
| `format` | Output format for the audit step. One of `text`, `json`, `sarif`. | No | `text` |

## Outputs

| Output | Description |
|--------|-------------|
| `score` | Audit score (0-100) |
| `passed` | Number of passing checks |
| `check_count` | Number of applicable checks evaluated |
| `platform` | Platform audited, or `harmony` when harmony mode is enabled |
| `harmony_score` | Harmony score when `harmony: true` is used |

## How it works

1. Runs `npx @nerviq/cli@latest audit --json` or `harmony-audit --json` on the checked-out repository.
2. Normalizes the JSON output into stable action outputs using `action/extract-audit-fields.js`.
3. Writes `score`, `passed`, `check_count`, `platform`, and `harmony_score` (when relevant) to GitHub Action outputs.
4. Fails the step when the score is below the configured threshold.
