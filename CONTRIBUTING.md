# Contributing to NERVIQ

Thank you for your interest in contributing to NERVIQ — the intelligent audit engine for AI coding agent configuration. We welcome bug reports, feature suggestions, and code contributions.

## Quick Start

```bash
# 1. Fork the repo on GitHub, then:
git clone https://github.com/<your-username>/nerviq.git
cd nerviq
npm install

# 2. Run the tests
npm test
```

All tests should pass in under 10 seconds. If something fails, please open an issue.

## How to Add a New Check

Checks live in platform-specific technique files under `src/`. The main Claude Code checks are in `src/techniques.js`; other platforms follow the same pattern in `src/{platform}/techniques.js`.

Each check is a plain object with `id`, `name`, `check(ctx)`, `impact`, `rating`, `category`, and `fix`. The `check` function receives a project context and returns `true` (pass), `false` (fail), or `null` (not applicable).

```js
{
  id: 'CU-A10',
  name: 'Short description of the check',
  check: (ctx) => {
    const content = ctx.fileContent('some-file');
    if (!content) return null;
    return /expected-pattern/.test(content);
  },
  impact: 'high',
  rating: 4,
  category: 'rules',
  fix: 'Actionable one-sentence fix instruction.',
}
```

After adding a check, update the count assertion in the corresponding `test/{platform}.test.js` file. See the existing checks in `src/techniques.js` for the full pattern.

## How to Report Bugs

Open a [GitHub Issue](https://github.com/nerviq/nerviq/issues) and include:

- **NERVIQ version** (`nerviq --version`)
- **Platform** being audited (e.g., Cursor, Codex, Claude Code)
- **OS** and Node.js version
- **Steps to reproduce** (minimal project structure if possible)
- **Expected vs. actual behavior**

## How to Suggest Features

Open a [GitHub Issue](https://github.com/nerviq/nerviq/issues) with the **enhancement** label. Describe the use case and why it matters. We prioritize features that benefit multiple platforms.

## Code Style

- **Zero production dependencies** — only Node.js built-ins. Do not add npm packages.
- **CommonJS only** — `require()` / `module.exports`. No ESM, no TypeScript, no build step.
- **Check functions must be synchronous and pure** — use `ctx` methods, not raw `fs`.
- **Return values** — `true | false | null` only. Never throw, never return `undefined`.
- **No linter enforced yet** — follow existing patterns and keep things consistent.

## Pull Request Process

1. Keep PRs small and focused — one feature or fix per PR.
2. Describe **what** you changed and **why** in the PR description.
3. Ensure `npm test` and `npx jest` both pass before submitting.
4. If adding checks: update test count assertions and exercise both pass/fail paths.
5. Do not add new entries to `dependencies` in `package.json`.

### PR description template

```
## What
One paragraph describing the change.

## Why
Link to issue, community signal, or rationale.

## Platform(s) affected
claude / codex / cursor / copilot / gemini / windsurf / aider / opencode
```

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you agree to uphold a welcoming, inclusive, and respectful environment for everyone.

## Questions?

If something is unclear, open an issue or start a discussion. We are happy to help you get started.
