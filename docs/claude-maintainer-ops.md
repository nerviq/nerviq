# Claude Maintainer Ops

## Working Notes
- You are working inside the shipped product repo, not the research repo.
- Keep public contracts stable across CLI JSON, HTTP serve, MCP transport, SDK, Action, and docs.
- Favor small, test-backed refactors over broad rewrites.

## Environment & Credentials
- Credentials stay in local environment or local `.env` files and must never be copied into tracked files.
- If a task needs account-level access, use local configuration only and keep the repo baseline credential-agnostic.

## Security & Runtime
- Be careful with untrusted paths, shell commands, and generated content.
- Pin dependency versions and run `npm audit` before publish-oriented work.
- When operating on large repos, consider token/context limits and prefer cached or incremental paths when they already exist.

## Release Operations
- Leave releases publish-ready for the human; do not publish automatically.
- When public docs or messaging change, sync the site and research repos in the same cycle.
