const fs = require('fs');
const path = require('path');
const os = require('os');
const { version } = require('../../package.json');
const { STACKS } = require('../techniques');
const { writeActivityArtifact, writeRollbackArtifact } = require('../activity');
const { GeminiProjectContext } = require('./context');
const { recommendGeminiMcpPacks, packToJson } = require('./mcp-packs');
const { icon } = require('../output-icons');

function detectScripts(ctx) {
  const pkg = ctx.jsonFile('package.json');
  if (!pkg || !pkg.scripts) return {};
  return pkg.scripts;
}

function detectProjectName(ctx) {
  const pkg = ctx.jsonFile('package.json');
  if (pkg && pkg.name) return pkg.name;
  return path.basename(ctx.dir);
}

function hasStack(stacks, key) {
  return stacks.some((item) => item.key === key);
}

function buildMermaid(stacks) {
  if (hasStack(stacks, 'nextjs')) {
    return [
      '```mermaid',
      'graph TD',
      '    UI[App Router / Pages] --> Logic[Server Actions or API Routes]',
      '    Logic --> Data[Data Layer]',
      '    Data --> External[External Services / DB]',
      '```',
    ].join('\n');
  }

  if (hasStack(stacks, 'fastapi') || hasStack(stacks, 'django') || hasStack(stacks, 'python')) {
    return [
      '```mermaid',
      'graph TD',
      '    API[API / CLI Entry] --> Services[Service Layer]',
      '    Services --> Models[Models / Schemas]',
      '    Models --> Data[Database or External APIs]',
      '```',
    ].join('\n');
  }

  if (hasStack(stacks, 'go')) {
    return [
      '```mermaid',
      'graph TD',
      '    Cmd[cmd/ or main package] --> Internal[internal/ packages]',
      '    Internal --> Data[Storage / APIs]',
      '```',
    ].join('\n');
  }

  if (hasStack(stacks, 'rust')) {
    return [
      '```mermaid',
      'graph TD',
      '    Bin[src/main.rs] --> Core[src/lib.rs]',
      '    Core --> Modules[domain / adapters / services]',
      '```',
    ].join('\n');
  }

  return [
    '```mermaid',
    'graph TD',
    '    Entry[Entry Point] --> Core[Core Logic]',
    '    Core --> Data[Data / External Services]',
    '```',
  ].join('\n');
}

function buildVerificationCommands(ctx) {
  const scripts = detectScripts(ctx);
  const commands = [];

  if (scripts.test) commands.push(`- Test: \`npm test\``);
  if (scripts.lint) commands.push(`- Lint: \`npm run lint\``);
  if (scripts.build) commands.push(`- Build: \`npm run build\``);

  if (commands.length === 0 && ctx.fileContent('pyproject.toml')) {
    commands.push('- Test: `python -m pytest`');
  }
  if (commands.length === 0 && ctx.fileContent('requirements.txt')) {
    commands.push('- Test: `python -m pytest`');
  }
  if (commands.length === 0 && ctx.fileContent('go.mod')) {
    commands.push('- Test: `go test ./...`');
    commands.push('- Build: `go build ./...`');
  }
  if (commands.length === 0 && ctx.fileContent('Cargo.toml')) {
    commands.push('- Test: `cargo test`');
    commands.push('- Build: `cargo build`');
  }

  if (commands.length === 0) {
    commands.push('- Test: add the repo test command');
    commands.push('- Lint: add the repo lint command');
    commands.push('- Build: add the repo build command');
  }

  return commands;
}

function buildCodingConventions(stacks) {
  const lines = [];

  if (hasStack(stacks, 'typescript')) {
    lines.push('- Keep TypeScript strict and prefer typed boundaries over implicit `any`.');
  }
  if (hasStack(stacks, 'react') || hasStack(stacks, 'nextjs')) {
    lines.push('- Prefer small, reviewable component changes and document risky UI state assumptions before refactors.');
  }
  if (hasStack(stacks, 'python') || hasStack(stacks, 'fastapi') || hasStack(stacks, 'django')) {
    lines.push('- Prefer explicit validation, typed schemas, and focused service functions over large route handlers.');
  }
  if (hasStack(stacks, 'go')) {
    lines.push('- Keep packages small, avoid cross-package cycles, and prefer table-driven tests.');
  }
  if (hasStack(stacks, 'rust')) {
    lines.push('- Prefer explicit ownership-safe refactors and small module-scoped changes over broad rewrites.');
  }
  if (hasStack(stacks, 'terraform') || hasStack(stacks, 'kubernetes')) {
    lines.push('- Treat infrastructure changes as high-risk: prefer diffs that are easy to plan, review, and roll back.');
  }

  if (lines.length === 0) {
    lines.push('- Prefer small, reviewable diffs and explicit reasoning over broad rewrites.');
  }

  return lines;
}

function buildSecurityNotes(stacks) {
  const lines = [
    '- Never commit secrets, tokens, or `.env` values into tracked files.',
    '- Prefer the repo verification commands before handoff, and explain any command you could not run.',
  ];

  if (hasStack(stacks, 'python') || hasStack(stacks, 'fastapi') || hasStack(stacks, 'django')) {
    lines.push('- Validate auth, permissions, and data-handling changes carefully before touching production-sensitive paths.');
  }
  if (hasStack(stacks, 'terraform') || hasStack(stacks, 'kubernetes')) {
    lines.push('- Review blast radius before changing infra, deployment, or cluster configuration.');
  }

  return lines;
}

function buildGeminiMd(ctx, stacks) {
  const stackLabels = stacks.map((item) => item.label).join(', ') || 'General repo';
  const verificationCommands = buildVerificationCommands(ctx);
  const codingConventions = buildCodingConventions(stacks);
  const securityNotes = buildSecurityNotes(stacks);

  return [
    `# ${detectProjectName(ctx)}`,
    '',
    '## Scope',
    '- Primary platform: Gemini CLI',
    `- Detected stack: ${stackLabels}`,
    '- Keep this file focused on Gemini CLI-specific guidance when the repo also uses Claude or other agents.',
    '',
    '## Architecture',
    buildMermaid(stacks),
    '- Replace the default diagram and bullets with the real entry points, boundaries, and high-risk subsystems for this repo.',
    '',
    '## Verification',
    ...verificationCommands,
    '',
    '## Coding Conventions',
    ...codingConventions,
    '',
    '## Review Workflow',
    '- Use `gemini review` before handoff on risky diffs or broad refactors.',
    '- Explain which verification commands ran successfully and which were skipped.',
    '- Keep working-tree expectations explicit: do not silently mix unrelated edits into the same handoff.',
    '',
    '## Security',
    ...securityNotes,
    '',
    '## Cost & Automation',
    '- Reserve heavy reasoning or long automation chains for tasks that actually need them.',
    '- Test Gemini CLI automation manually or in workflow_dispatch before turning it into a scheduled workflow.',
    '- Be aware of `--yolo` mode risks: it bypasses all confirmation prompts and should only be used in externally sandboxed environments.',
    '',
    '## Notes',
    '- If this repo also uses Claude, keep Claude-specific instructions in `CLAUDE.md` and use GEMINI.md for Gemini CLI-native behavior.',
    '- If you add repo-local commands, place them under `.gemini/commands/` as TOML files with kebab-case names.',
    '- If you add custom agents, keep them under `.gemini/agents/` as markdown files.',
    '- Policy files go under `.gemini/policy/` as TOML files for Gemini-specific governance rules.',
    '',
    `_Generated by nerviq v${version} for Gemini CLI. Customize this file before relying on it in production flows._`,
    '',
  ].join('\n');
}

function buildSettingsJson() {
  return JSON.stringify({
    "$schema": "https://gemini.google.com/settings-schema.json",
    "theme": "system",
    "model": "gemini-2.5-pro",
    "sandbox": true,
    "codeExecution": false,
    "checkpointFrequency": "auto",
    "yolo": false,
    "context": {
      "fileName": "GEMINI.md",
      "maxDepth": 3,
    },
    "hooks": {},
    "mcpServers": {},
  }, null, 2) + '\n';
}

function buildGeminiSetupFiles(options = {}) {
  const ctx = new GeminiProjectContext(options.dir);
  const stacks = ctx.detectStacks(STACKS);
  const files = [];

  // 1. GEMINI.md
  const geminiMdPath = path.join(options.dir, 'GEMINI.md');
  if (!fs.existsSync(geminiMdPath)) {
    files.push({
      path: 'GEMINI.md',
      action: 'create',
      content: buildGeminiMd(ctx, stacks),
      currentState: 'GEMINI.md is missing',
      proposedState: 'create a Gemini CLI-native GEMINI.md baseline with verification, architecture, review, and trust guidance',
    });
  }

  // 2. .gemini/settings.json
  const settingsPath = path.join(options.dir, '.gemini', 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    files.push({
      path: '.gemini/settings.json',
      action: 'create',
      content: buildSettingsJson(),
      currentState: '.gemini/settings.json is missing',
      proposedState: 'create a safe Gemini CLI baseline settings.json with explicit sandbox, model, context, and hooks settings',
    });
  }

  // --- Optional setup families ---
  const modules = options.modules || 'all';
  const wantModule = (name) => modules === 'all' || (Array.isArray(modules) && modules.includes(name));

  // 3. Hooks config in settings.json (scaffold)
  if (wantModule('hooks')) {
    const hooksInSettings = ctx.hooksConfig();
    if (!hooksInSettings || Object.keys(hooksInSettings).length === 0) {
      files.push({
        path: '.gemini/settings.json (hooks append)',
        action: 'patch',
        family: 'gemini-hooks',
        content: buildHooksStarter(),
        currentState: 'No hooks configured in .gemini/settings.json',
        proposedState: 'add BeforeTool/AfterTool hook starters to settings.json',
      });
    }
  }

  // 4. Commands starter
  if (wantModule('commands')) {
    const commandsDir = path.join(options.dir, '.gemini', 'commands');
    const commandsReadme = path.join(commandsDir, 'README.md');
    if (!fs.existsSync(commandsReadme) && !fs.existsSync(commandsDir)) {
      files.push({
        path: '.gemini/commands/README.md',
        action: 'create',
        family: 'gemini-commands',
        content: buildCommandsStarter(),
        currentState: '.gemini/commands/ directory is missing',
        proposedState: 'create a Gemini CLI commands starter with TOML conventions and usage guidance',
      });
    }
  }

  // 5. Agents starter
  if (wantModule('agents')) {
    const agentsDir = path.join(options.dir, '.gemini', 'agents');
    if (!fs.existsSync(agentsDir)) {
      files.push({
        path: '.gemini/agents/README.md',
        action: 'create',
        family: 'gemini-agents',
        content: buildAgentsStarter(),
        currentState: '.gemini/agents/ directory is missing',
        proposedState: 'create a Gemini CLI agents starter with markdown conventions',
      });
    }
  }

  // 6. Skills starter
  if (wantModule('skills')) {
    const skillsDir = path.join(options.dir, '.gemini', 'skills');
    const skillsReadme = path.join(skillsDir, 'README.md');
    if (!fs.existsSync(skillsReadme) && !fs.existsSync(skillsDir)) {
      files.push({
        path: '.gemini/skills/README.md',
        action: 'create',
        family: 'gemini-skills',
        content: buildSkillsStarter(),
        currentState: '.gemini/skills/ directory is missing',
        proposedState: 'create a Gemini CLI skills starter with naming conventions and structure guidance',
      });
    }
  }

  // 7. Policy starter (Gemini-unique!)
  if (wantModule('policy')) {
    const policyDir = path.join(options.dir, '.gemini', 'policy');
    if (!fs.existsSync(policyDir)) {
      files.push({
        path: '.gemini/policy/README.md',
        action: 'create',
        family: 'gemini-policy',
        content: buildPolicyStarter(),
        currentState: '.gemini/policy/ directory is missing',
        proposedState: 'create a Gemini CLI policy TOML starter with governance and enforcement guidance',
      });
    }
  }

  // 8. MCP packs
  if (wantModule('mcp')) {
    const mcpServers = ctx.mcpServers();
    const hasMcpSection = mcpServers && Object.keys(mcpServers).length > 0;
    if (!hasMcpSection) {
      const domainPacks = options.domainPacks || [];
      const mcpRecs = recommendGeminiMcpPacks(stacks, domainPacks, { ctx });
      if (mcpRecs.length > 0) {
        const mcpJson = JSON.stringify(
          Object.assign({}, ...mcpRecs.map(p => packToJson(p))),
          null, 2
        );
        files.push({
          path: '.gemini/settings.json (MCP append)',
          action: 'append',
          family: 'gemini-mcp',
          content: mcpJson,
          currentState: 'No MCP servers configured in .gemini/settings.json',
          proposedState: `add ${mcpRecs.length} recommended MCP packs: ${mcpRecs.map(p => p.label).join(', ')}`,
        });
      }
    }
  }

  // 9. CI / Review workflow starter
  if (wantModule('ci')) {
    const workflowDir = path.join(options.dir, '.github', 'workflows');
    const geminiWorkflow = path.join(workflowDir, 'gemini-review.yml');
    if (!fs.existsSync(geminiWorkflow)) {
      files.push({
        path: '.github/workflows/gemini-review.yml',
        action: 'create',
        family: 'gemini-ci-review',
        content: buildCiReviewStarter(),
        currentState: 'No Gemini CLI CI review workflow exists',
        proposedState: 'create a GitHub Actions workflow for Gemini CLI-based PR review',
      });
    }
  }

  return { ctx, stacks, files };
}

// --- Starter builders ---

function buildHooksStarter() {
  return JSON.stringify({
    "hooks": {
      "BeforeTool": [
        {
          "command": "echo 'Gemini tool about to execute'",
          "description": "Example BeforeTool hook — customize or remove",
          "timeout_ms": 5000,
        }
      ],
      "AfterTool": [
        {
          "command": "echo 'Gemini tool completed'",
          "description": "Example AfterTool hook — customize or remove",
          "timeout_ms": 5000,
        }
      ],
    }
  }, null, 2) + '\n';
}

function buildCommandsStarter() {
  return [
    '# Gemini CLI Commands',
    '',
    'Place TOML command files in this directory to extend Gemini CLI.',
    '',
    '## Command format',
    '',
    '```toml',
    'name = "my-command"',
    'description = "What this command does"',
    'prompt = "The prompt template for this command"',
    '```',
    '',
    '## Example command',
    '',
    '```toml',
    'name = "review"',
    'description = "Review the current diff for issues"',
    'prompt = """',
    'Review the current git diff for bugs, security issues, and style problems.',
    'Focus on correctness first, then readability.',
    '"""',
    '```',
    '',
    '## Best practices',
    '',
    '- Use kebab-case for command file names (e.g., `code-review.toml`)',
    '- Keep prompts focused and actionable',
    '- Document expected inputs and outputs in the description',
    '',
    `_Generated by nerviq v${version}_`,
    '',
  ].join('\n');
}

function buildAgentsStarter() {
  return [
    '# Gemini CLI Agents',
    '',
    'Place agent markdown files here to define specialized Gemini CLI agents.',
    '',
    '## Format',
    '',
    'Each agent file should be a `.md` file with:',
    '- A clear title and purpose',
    '- Specific instructions for the agent role',
    '- Constraints and boundaries',
    '',
    '## Example agent',
    '',
    '```markdown',
    '# Security Reviewer',
    '',
    'You are a security-focused code reviewer. Check for:',
    '- SQL injection vulnerabilities',
    '- XSS attack vectors',
    '- Hardcoded secrets or credentials',
    '- Insecure dependencies',
    '',
    'Report findings with severity levels: critical, high, medium, low.',
    '```',
    '',
    '## Best practices',
    '',
    '- Keep agent instructions focused on a single responsibility',
    '- Use markdown files with clear headings',
    '- Document the agent scope and limitations',
    '',
    `_Generated by nerviq v${version}_`,
    '',
  ].join('\n');
}

function buildSkillsStarter() {
  return [
    '# Gemini CLI Skills',
    '',
    'Place skill directories here. Each skill needs a definition file.',
    '',
    '## Directory structure',
    '',
    '```',
    '.gemini/skills/',
    '  my-skill/',
    '    SKILL.md     # Required: name, description, instructions',
    '    helpers.js   # Optional: supporting files',
    '```',
    '',
    '## SKILL.md format',
    '',
    '```markdown',
    '---',
    'name: my-skill',
    'description: Short description for invocation',
    '---',
    '',
    '# My Skill',
    '',
    'Instructions for Gemini CLI when this skill is invoked.',
    '```',
    '',
    '## Critical naming rules',
    '',
    '- Use **kebab-case** for skill directory names (e.g., `code-review`, not `CodeReview`)',
    '- Keep descriptions short for bounded context cost',
    '',
    `_Generated by nerviq v${version}_`,
    '',
  ].join('\n');
}

function buildPolicyStarter() {
  return [
    '# Gemini CLI Policy',
    '',
    'Place TOML policy files here to govern Gemini CLI behavior in this repo.',
    '',
    'Gemini CLI policy files are a **Gemini-unique feature** for declarative governance.',
    '',
    '## Policy format',
    '',
    '```toml',
    '[policy]',
    'name = "baseline-safe"',
    'description = "Safe baseline policy for this repo"',
    '',
    '[rules]',
    'allow_file_write = true',
    'allow_file_delete = false',
    'allow_network = false',
    'allow_shell_exec = "prompt"',
    'max_file_size_kb = 1024',
    '',
    '[sandbox]',
    'mode = "restricted"',
    'allowed_paths = ["src/", "tests/", "docs/"]',
    'blocked_paths = [".env", "secrets/", "credentials/"]',
    '```',
    '',
    '## Example policies',
    '',
    '### Locked-down (read-only review)',
    '',
    '```toml',
    '[policy]',
    'name = "review-only"',
    '',
    '[rules]',
    'allow_file_write = false',
    'allow_file_delete = false',
    'allow_shell_exec = false',
    '```',
    '',
    '### Automation (CI context)',
    '',
    '```toml',
    '[policy]',
    'name = "ci-automation"',
    '',
    '[rules]',
    'allow_file_write = true',
    'allow_shell_exec = true',
    'require_confirmation = false',
    '```',
    '',
    '## Best practices',
    '',
    '- Start with restrictive policies and relax as needed',
    '- Use `blocked_paths` to protect sensitive files',
    '- Review policy changes in PRs like code changes',
    '- Separate CI policies from local development policies',
    '',
    `_Generated by nerviq v${version}_`,
    '',
  ].join('\n');
}

function buildCiReviewStarter() {
  return [
    'name: Gemini Review',
    '',
    'on:',
    '  pull_request:',
    '    types: [opened, synchronize]',
    '',
    'permissions:',
    '  contents: read',
    '  pull-requests: write',
    '',
    'jobs:',
    '  gemini-review:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - name: Gemini Review',
    '        uses: google/gemini-code-review-action@v1',
    '        with:',
    '          safety-strategy: review-only',
    '        env:',
    '          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}',
  ].join('\n') + '\n';
}

async function setupGemini(options) {
  const silent = options.silent === true;
  const { ctx, stacks, files } = buildGeminiSetupFiles(options);
  const writtenFiles = [];
  const preservedFiles = [];

  function log(message = '') {
    if (!silent) {
      console.log(message);
    }
  }

  log('');
  log('\x1b[1m  nerviq gemini setup\x1b[0m');
  log('\x1b[2m  ═══════════════════════════════════════\x1b[0m');
  if (stacks.length > 0) {
    log(`\x1b[36m  Detected: ${stacks.map((s) => s.label).join(', ')}\x1b[0m`);
  }
  log('');

  for (const file of files) {
    const fullPath = path.join(options.dir, file.path);
    if (fs.existsSync(fullPath)) {
      preservedFiles.push(file.path);
      log(`  \x1b[2m${icon('skip')} Skipped ${file.path} (already exists - your version is kept)\x1b[0m`);
      continue;
    }

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, file.content, 'utf8');
    writtenFiles.push(file.path);
    log(`  \x1b[32m${icon('ok')}\x1b[0m Created ${file.path}`);
  }

  const skippedSet = new Set(preservedFiles);
  if (!skippedSet.has('GEMINI.md') && fs.existsSync(path.join(options.dir, 'GEMINI.md')) && !writtenFiles.includes('GEMINI.md')) {
    preservedFiles.push('GEMINI.md');
  }
  if (!skippedSet.has('.gemini/settings.json') && fs.existsSync(path.join(options.dir, '.gemini', 'settings.json')) && !writtenFiles.includes('.gemini/settings.json')) {
    preservedFiles.push('.gemini/settings.json');
  }

  let rollbackArtifact = null;
  let activityArtifact = null;
  if (writtenFiles.length > 0) {
    rollbackArtifact = writeRollbackArtifact(options.dir, {
      sourcePlan: 'gemini-setup',
      createdFiles: writtenFiles,
      patchedFiles: [],
      rollbackInstructions: writtenFiles.map((file) => `Delete ${file}`),
    });
    activityArtifact = writeActivityArtifact(options.dir, 'gemini-setup', {
      platform: 'gemini',
      createdFiles: writtenFiles,
      preservedFiles,
      stackLabels: stacks.map((item) => item.label),
      rollbackArtifact: rollbackArtifact.relativePath,
    });
  }

  log('');
  log(`  \x1b[1m${writtenFiles.length} files created.\x1b[0m`);
  if (preservedFiles.length > 0) {
    log(`  \x1b[2m${preservedFiles.length} existing files preserved (not overwritten).\x1b[0m`);
  }
  if (rollbackArtifact) {
    log(`  Rollback: \x1b[1m${rollbackArtifact.relativePath}\x1b[0m`);
  }
  if (activityArtifact) {
    log(`  Activity log: \x1b[1m${activityArtifact.relativePath}\x1b[0m`);
  }
  log('');
  log('  Run \x1b[1mnpx nerviq --platform gemini\x1b[0m to audit your Gemini CLI setup.');
  log('');

  return {
    created: writtenFiles.length,
    skipped: preservedFiles.length,
    writtenFiles,
    preservedFiles,
    stacks,
    rollbackArtifact: rollbackArtifact ? rollbackArtifact.relativePath : null,
    activityArtifact: activityArtifact ? activityArtifact.relativePath : null,
  };
}

module.exports = {
  buildGeminiMd,
  buildSettingsJson,
  buildGeminiSetupFiles,
  setupGemini,
};
