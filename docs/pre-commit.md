# Pre-commit Hook Integration

[pre-commit](https://pre-commit.com) is a framework for managing and running git hooks across projects using a shared configuration file.

## Setup

Install pre-commit if you haven't already:

```bash
pip install pre-commit
```

Add Nerviq to your `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: https://github.com/nerviq/nerviq
    rev: v1.8.0
    hooks:
      - id: nerviq-audit
        args: ['60']  # minimum score threshold
```

Then install the hooks:

```bash
pre-commit install
```

## Customization

**Change the threshold** by editing the `args` value. The audit fails if the project score is below this number (0-100):

```yaml
args: ['80']  # stricter threshold
```

**Use pre-push instead of pre-commit** for a full audit that runs only when pushing:

```yaml
repos:
  - repo: https://github.com/nerviq/nerviq
    rev: v1.8.0
    hooks:
      - id: nerviq-audit-full
        args: ['40']
```

Then install the push hook:

```bash
pre-commit install --hook-type pre-push
```

## Requirements

- Node.js 18+
- `npx` available on PATH (included with Node.js)
