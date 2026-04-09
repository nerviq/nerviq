# Claude Code Style

## Output Style
- Use camelCase for variables and functions, PascalCase for classes, and UPPER_SNAKE for constants.
- Prefer `const`; never use `var`.
- Write JSDoc for public functions and exported helpers when the contract is not obvious.
- Keep functions small when practical, but prioritize readability over an arbitrary line limit.
- Use descriptive test names that state the expected behavior.

## Repo Shape
```text
bin/                CLI entry point
src/                Core runtime, platform adapters, HTTP API, MCP transport
sdk/                Public SDK with TypeScript types
test/               Custom suite + Jest coverage
tools/              Build, validation, and maintenance scripts
docs/               Public and maintainer-facing documentation
action/             GitHub Action
vscode-extension/   VS Code surface
```

## Naming Notes
- Use kebab-case for CLI commands and doc file names.
- Follow the existing platform folder layout under `src/` instead of inventing new top-level shapes.
