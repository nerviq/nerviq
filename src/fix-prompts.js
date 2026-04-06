/**
 * AI-generated fix prompts for checks without template auto-fixes.
 * Each key maps to a check key from techniques.js.
 * These prompts are designed to be copy-pasted into an AI coding agent.
 */

const FIX_PROMPTS = {
  importSyntax:
    'Refactor CLAUDE.md to use @path imports for modularity. Split large sections into separate files (e.g. @docs/coding-style.md, @docs/architecture.md) and reference them with @path syntax. Also consider using .claude/rules/ for path-specific rules.',

  underlines200:
    'Refactor CLAUDE.md to be under 200 lines. Move detailed sections into separate files using @import or .claude/rules/ for path-specific rules. Keep only essential project overview, build commands, and key conventions in the main file.',

  verificationLoop:
    'Add a verification section to CLAUDE.md with commands Claude should run after making changes. Include test, lint, and build commands. Example:\n\n## Verification\nAfter every change, run:\n- `npm test` to verify tests pass\n- `npm run lint` to check code style\n- `npm run build` to verify compilation',

  testCommand:
    'Add an explicit test command to CLAUDE.md. Example: "Run `npm test` before committing." or "Run `pytest` to verify changes." Place it in a ## Commands or ## Verification section.',

  lintCommand:
    'Add a lint command to CLAUDE.md so the AI agent auto-checks code style. Example: "Run `npm run lint` or `eslint .` before committing." Place it in a ## Commands section.',

  buildCommand:
    'Add a build command to CLAUDE.md so the AI agent can verify compilation. Example: "Run `npm run build` or `tsc` to verify the project compiles." Place it in a ## Commands section.',

  settingsPermissions:
    'Create or update .claude/settings.json with permission configuration. Add "permissions": { "allow": ["Read", "Write src/**"], "deny": ["Write .env", "Write **/secrets/**"] } to control which tools and paths the AI agent can access.',

  permissionDeny:
    'Add deny rules to .claude/settings.json under permissions.deny to block dangerous operations. Example entries: "rm -rf /", "DROP TABLE", "Write .env", "Write **/*.pem", "Write **/secrets/**".',

  noBypassPermissions:
    'Remove bypassPermissions from your .claude/settings.json defaultMode. Instead, use explicit allow rules in permissions.allow to grant only the access needed.',

  secretsProtection:
    'Add permissions.deny rules in .claude/settings.json to block reading sensitive files. Add entries like: ".env", ".env.*", "**/.env", "**/*.pem", "**/secrets/**" to the deny array.',

  securityReview:
    'Add a /security-review command or mention security review in CLAUDE.md. Create .claude/commands/security-review.md with: "Review the codebase for OWASP Top 10 vulnerabilities. Check for: SQL injection, XSS, CSRF, insecure dependencies, hardcoded secrets, and misconfigured permissions."',

  preToolUseHook:
    'Add a PreToolUse hook in .claude/settings.json to validate tool calls before execution. Example: add a hook that blocks writes to protected files or validates file paths. See hooks documentation for the event schema.',

  postToolUseHook:
    'Add a PostToolUse hook in .claude/settings.json for automated actions after tool calls. Example: auto-run linting after file writes, or validate output format after code generation.',

  sessionStartHook:
    'Add a SessionStart hook in .claude/settings.json for initialization tasks. Example: load project state, rotate logs, or display a welcome message with project status at the start of each session.',

  deployCommand:
    'Create .claude/commands/deploy.md with deployment instructions. Include: pre-deploy checks (tests, lint, build), deployment steps for your platform (Vercel, AWS, etc.), and post-deploy verification.',

  reviewCommand:
    'Create .claude/commands/review.md with code review instructions. Include: check for security issues, verify test coverage, review naming conventions, check for code duplication, and validate error handling.',

  compactionAwareness:
    'Add compaction guidance to CLAUDE.md. Add a line like: "Run /compact when context gets heavy or before large operations." This helps the AI agent manage its context window effectively.',

  contextManagement:
    'Add context management tips to CLAUDE.md. Include: "Use /compact proactively at 70% capacity. Prefer targeted file reads over broad searches. Keep conversation focused on one task at a time."',

  mcpServers:
    'Create .mcp.json at the project root to configure MCP servers. Example:\n{\n  "mcpServers": {\n    "memory": { "command": "npx", "args": ["-y", "@anthropic/mcp-memory"] }\n  }\n}\nUse `claude mcp add <name>` to add servers interactively.',

  context7Mcp:
    'Add the Context7 MCP server for real-time documentation lookup. Add to .mcp.json:\n"context7": { "command": "npx", "args": ["-y", "@anthropic/context7-mcp"] }\nThis provides always-up-to-date library documentation.',

  xmlTags:
    'Add XML-tagged sections to CLAUDE.md for structured rules. Wrap critical rules in tags like <constraints>, <validation>, or <rules>. Example:\n<constraints>\n- Never modify package-lock.json manually\n- Always run tests before committing\n</constraints>',

  fewShotExamples:
    'Add code examples to CLAUDE.md showing preferred patterns. Include 2-3 examples of your coding style: naming conventions, error handling patterns, file structure. Use fenced code blocks with the appropriate language tag.',

  roleDefinition:
    'Add a role definition to the top of CLAUDE.md. Example: "You are a senior backend engineer working on a Node.js microservices platform. Prioritize type safety, comprehensive error handling, and test coverage."',

  constraintBlocks:
    'Add XML constraint blocks to CLAUDE.md for critical rules. Wrap must-follow rules in <constraints> tags for ~40% better adherence. Example:\n<constraints>\n- Never delete database migrations\n- Always use parameterized queries\n- Run the full test suite before committing\n</constraints>',

  readme:
    'Create a README.md with: project name and description, installation/setup instructions, usage examples, configuration options, and contribution guidelines.',

  changelog:
    'Create a CHANGELOG.md following Keep a Changelog format. Include sections: Added, Changed, Deprecated, Removed, Fixed, Security. Start with your current version.',

  contributing:
    'Create a CONTRIBUTING.md with: how to set up the dev environment, coding standards and style guide, pull request process, issue reporting guidelines, and code of conduct reference.',

  editorconfig:
    'Create a .editorconfig file at the project root with consistent formatting rules:\n[*]\nindent_style = space\nindent_size = 2\nend_of_line = lf\ncharset = utf-8\ntrim_trailing_whitespace = true\ninsert_final_newline = true',

  ciPipeline:
    'Add a CI pipeline for automated testing. For GitHub Actions, create .github/workflows/ci.yml with steps: checkout, setup Node/Python, install dependencies, run lint, run tests, run build.',

  dockerfile:
    'Create a Dockerfile for the project. Use a multi-stage build: stage 1 installs dependencies and builds, stage 2 copies only production artifacts. Use a slim base image and set a non-root user.',

  noSecretsInClaude:
    'Remove any API keys, tokens, or secrets from CLAUDE.md. Replace them with environment variable references (e.g. $API_KEY or process.env.API_KEY). Store actual values in .env files that are gitignored.',
};

/**
 * Format a fix prompt for display in the terminal.
 */
function formatFixPrompt(key, prompt) {
  const divider = '\u2500'.repeat(38);
  const lines = [
    '',
    `  No auto-fix for '${key}'. Here's a prompt for your AI agent:`,
    '',
    `  ${divider}`,
  ];
  for (const line of prompt.split('\n')) {
    lines.push(`  ${line}`);
  }
  lines.push(`  ${divider}`);
  lines.push('');
  lines.push('  Copy and paste this into Claude Code, Cursor, or your preferred AI agent.');
  return lines.join('\n');
}

module.exports = { FIX_PROMPTS, formatFixPrompt };
