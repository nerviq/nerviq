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

```yaml
# bitbucket-pipelines.yml
image: node:20-slim

pipelines:
  default:
    - step:
        name: NERVIQ Audit
        script:
          - npm install -g @nerviq/cli
          - nerviq audit --json --threshold 60
        artifacts:
          - nerviq-report.json
  pull-requests:
    '**':
      - step:
          name: NERVIQ Audit
          script:
            - npm install -g @nerviq/cli
            - nerviq audit --json --threshold 60
```

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
