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
      - uses: nerviq/nerviq@v1
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
      - uses: nerviq/nerviq@v1
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
      - uses: nerviq/nerviq@v1
        id: audit
      - run: echo "Score is ${{ steps.audit.outputs.score }}/100"
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `threshold` | Minimum passing score (0-100). The step fails if the score is below this value. | No | `50` |

## Outputs

| Output | Description |
|--------|-------------|
| `score` | Audit score (0-100) |
| `passed` | Number of passing checks |
| `total` | Total checks evaluated |

## How it works

1. Runs `npx @nerviq/cli --json` on the checked-out repository.
2. Parses the JSON output to extract `score`, `passed`, and total evaluated checks.
3. Writes `score`, `passed`, and `total` to GitHub Action outputs.
4. Fails the step when the score is below the configured threshold.
