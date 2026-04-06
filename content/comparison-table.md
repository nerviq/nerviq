# Nerviq vs Manual Config Management vs No Governance

## Full Comparison

| Capability | No Governance | Manual Management | Nerviq |
|---|---|---|---|
| **Time to audit all platforms** | N/A | 2-4 hours | 30 seconds |
| **Drift detection** | None | Periodic manual review | Automatic (Harmony) |
| **Cross-platform sync** | N/A | Copy-paste between files | `nerviq harmony-sync` |
| **Security gap detection** | None | Manual checklist | 2,431 automated checks |
| **Rollback on mistake** | Hope for git stash | Manual git revert | `nerviq rollback` |
| **CI enforcement** | None | Custom scripts | One-line GitHub Action |
| **Score trending** | None | Spreadsheet | `nerviq history` |
| **Onboarding new devs** | Tribal knowledge | Wiki page (maybe) | Run `nerviq audit`, see score |
| **Multi-platform support** | N/A | 1 at a time | 8 platforms simultaneously |
| **Cost** | Free (but expensive in bugs) | Free (expensive in time) | Free CLI, Pro from $19/mo |

## When to Use What

- **No governance:** Solo project, single agent, prototype stage. You are experimenting and config churn is expected. Overhead of any system would slow you down.

- **Manual management:** Small team, single platform, stable config. You have a senior dev who owns the config and reviews changes. A wiki page or shared doc covers your needs.

- **Nerviq:** Multiple agents, team of 3+, CI/CD pipeline, compliance needs. Config drift across platforms is a real risk, and you need audit trails, automated checks, and fast onboarding.

---

## Compact Version (for README / website embed)

| Capability | No Governance | Manual | Nerviq |
|---|---|---|---|
| **Audit time** | N/A | 2-4 hours | 30 seconds |
| **Drift detection** | None | Manual review | Automatic |
| **Security checks** | None | Checklist | 2,431 automated |
| **Onboarding** | Tribal knowledge | Wiki page | `nerviq audit` |
| **Platform support** | N/A | 1 at a time | 8 simultaneously |
