# CI Integration

NERVIQ integrates with any CI system that can run Node.js. The audit command exits with a non-zero code when the project score falls below the configured threshold, so it plugs directly into your pipeline's pass/fail logic. Below are ready-to-use snippets for the most common providers.

## GitHub Actions

```yaml
# .github/workflows/nerviq.yml
name: NERVIQ Audit
on: [push, pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: nerviq/nerviq@v1
        with:
          threshold: 60
```

## GitLab CI

See the full template at [`gitlab-ci-template.yml`](./gitlab-ci-template.yml). Copy it to your project root as `.gitlab-ci.yml` or include it via:

```yaml
include:
  - local: 'path/to/gitlab-ci-template.yml'
```

## Bitbucket Pipelines

See the full template at [`bitbucket-pipe.yml`](./bitbucket-pipe.yml). It includes three pipeline triggers:

| Pipeline | Trigger | Purpose |
|---|---|---|
| `default` | Every push | Audit on all branches |
| `pull-requests` | PR opened/updated | Gate PRs on score threshold |
| `custom / harmony-audit` | Manual (UI) | Run Harmony multi-config audit |

Quick inline example:

```yaml
# bitbucket-pipelines.yml
image: node:20-slim

pipelines:
  default:
    - step:
        name: Nerviq Audit
        script:
          - npm install -g @nerviq/cli
          - nerviq audit --json --threshold ${NERVIQ_THRESHOLD:-60}
        artifacts:
          - nerviq-report.json
  pull-requests:
    '**':
      - step:
          name: Nerviq PR Audit
          script:
            - npm install -g @nerviq/cli
            - nerviq audit --json --threshold ${NERVIQ_THRESHOLD:-60} --out nerviq-report.json
          artifacts:
            - nerviq-report.json
```

Set `NERVIQ_THRESHOLD` in **Repository Settings > Pipelines > Variables** to override the default score of 60.

## Pre-commit

Use the [pre-commit](https://pre-commit.com) framework to run Nerviq automatically on every commit or push. Add to your `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/nerviq/nerviq
    rev: v1.8.0
    hooks:
      - id: nerviq-audit
        args: ['60']
```

See the full guide at [`pre-commit.md`](./pre-commit.md).

## Generic CI (any provider)

If your CI can run `npx`, no global install is needed:

```bash
npx @nerviq/cli audit --threshold 60
```

For faster repeat runs, install globally in a setup step:

```bash
npm install -g @nerviq/cli
nerviq audit --json --threshold 60
```
