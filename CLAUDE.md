# NERVIQ CLI — Flagship Repo Instructions

## Role
You are maintaining the Nerviq CLI: an AI agent governance / configuration intelligence product that audits, aligns, and amplifies 8 platforms with 2,441 checks. Protect correctness, backward compatibility, and trust in public product surfaces.

## Product Boundary
- Nerviq is governance/config intelligence for AI coding workflows. It is not a full SAST or code-security scanner replacement.
- Treat the CLI, SDK, local HTTP API, MCP transport, GitHub Action, VS Code extension, contracts, and docs as one product surface.
- Prefer consolidation over expansion when drift, ambiguity, or maintenance cost is rising.

## Core Working Agreement
- Keep changes scoped to the requested task.
- Prefer extending existing modules over creating parallel abstractions.
- Preserve existing architecture and naming patterns unless the task requires a deliberate change.
- Never commit secrets, API keys, or `.env` files.
- When release-facing numbers, wording, or examples change, sync every affected surface before calling the task complete.
- Ask before changing product boundary, release semantics, or destructive workflows.

## Language
- Code and technical artifacts: English
- User communication: Hebrew

<!-- nerviq:build-test:start -->
## Build & Verify
```bash
npm start            # node bin/cli.js
npm run build        # npm pack --dry-run
npm test             # node test/run.js
```
<!-- nerviq:build-test:end -->

## Release Readiness
- If a task bumps the CLI version, leave this repo fully ready for the human to run `npm publish`.
- Sync version-facing docs and product surfaces before calling release work complete.
- Run tests plus `npm run build` / `npm pack --dry-run`.
- If release work changes public messaging, update the owning site and research repos too.
- Do not run `npm publish` unless the human explicitly asks for it.

<!-- nerviq:verification:start -->
<verification>
Before completing any task, confirm:
1. All existing tests still pass
2. New code or new contracts have regression coverage where appropriate
3. Changes match the requested scope (no gold-plating)
</verification>
<!-- nerviq:verification:end -->

<!-- nerviq:security-workflow:start -->
## Security Workflow
- Run `/security-review` when touching authentication, permissions, secrets, or customer data.
- Treat secret access, shell commands, and risky file operations as review-worthy changes.
<!-- nerviq:security-workflow:end -->

## Instruction Layout
- Keep this file concise and repo-wide.
- Use `@import ./docs/...` for focused maintainer guidance instead of expanding the main baseline.
- Use `.claude/rules/` only for path-specific or tool-specific rules.

@import ./docs/claude-code-style.md
@import ./docs/claude-maintainer-ops.md
