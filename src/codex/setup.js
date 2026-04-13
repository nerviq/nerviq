const fs = require('fs');
const path = require('path');
const os = require('os');
const { version } = require('../../package.json');
const { STACKS } = require('../techniques');
const { writeActivityArtifact, writeRollbackArtifact } = require('../activity');
const { CodexProjectContext } = require('./context');
const { recommendCodexMcpPacks, packsToToml } = require('./mcp-packs');
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

function buildAgentsMd(ctx, stacks) {
  const stackLabels = stacks.map((item) => item.label).join(', ') || 'General repo';
  const verificationCommands = buildVerificationCommands(ctx);
  const codingConventions = buildCodingConventions(stacks);
  const securityNotes = buildSecurityNotes(stacks);

  return [
    `# ${detectProjectName(ctx)}`,
    '',
    '## Scope',
    '- Primary platform: Codex CLI',
    `- Detected stack: ${stackLabels}`,
    '- Keep this file focused on Codex-specific guidance when the repo also uses Claude or other agents.',
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
    '- Use `codex review --uncommitted` before handoff on risky diffs or broad refactors.',
    '- Explain which verification commands ran successfully and which were skipped.',
    '- Keep working-tree expectations explicit: do not silently mix unrelated edits into the same handoff.',
    '',
    '## Security',
    ...securityNotes,
    '',
    '## Cost & Automation',
    '- Reserve heavy reasoning or long automation chains for tasks that actually need them.',
    '- Test Codex automation manually or in workflow_dispatch before turning it into a scheduled workflow.',
    '',
    '## Notes',
    '- If this repo also uses Claude, keep Claude-specific instructions in `CLAUDE.md` and use AGENTS.md for Codex-native behavior.',
    '- If you add repo-local skills, place them under `.agents/skills/<skill-name>/SKILL.md` and keep names kebab-case.',
    '- If you add custom agents, keep them under `.codex/agents/*.toml` with narrow sandbox overrides.',
    '',
    `_Generated by nerviq v${version} for Codex. Customize this file before relying on it in production flows._`,
    '',
  ].join('\n');
}

function buildConfigToml() {
  // Updated 2026-04-05: removed stale keys (model_for_weak_tasks, full_auto_error_mode,
  // history.send_to_server) that no longer exist in official Codex config schema
  return [
    'model = "gpt-5.4"',
    'model_reasoning_effort = "medium"',
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    'project_doc_fallback_filenames = ["AGENTS.md"]',
    '',
    '[sandbox_workspace_write]',
    'network_access = false',
    '',
    '[agents]',
    'max_threads = 4',
    'max_depth = 2',
    '',
  ].join('\n');
}

function buildCodexSetupFiles(options = {}) {
  const ctx = new CodexProjectContext(options.dir);
  const stacks = ctx.detectStacks(STACKS);
  const files = [];

  const agentsPath = path.join(options.dir, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    files.push({
      path: 'AGENTS.md',
      action: 'create',
      content: buildAgentsMd(ctx, stacks),
      currentState: 'AGENTS.md is missing',
      proposedState: 'create a Codex-native AGENTS.md baseline with verification, architecture, review, and trust guidance',
    });
  }

  const configPath = path.join(options.dir, '.codex', 'config.toml');
  if (!fs.existsSync(configPath)) {
    files.push({
      path: '.codex/config.toml',
      action: 'create',
      content: buildConfigToml(),
      currentState: '.codex/config.toml is missing',
      proposedState: 'create a safe Codex baseline config with explicit approvals, sandbox, history, network, and agents settings',
    });
  }

  // --- CP-04: Optional setup families ---
  const modules = options.modules || 'all';
  const wantModule = (name) => modules === 'all' || (Array.isArray(modules) && modules.includes(name));

  // Rules starter
  if (wantModule('rules')) {
    const rulesDir = path.join(options.dir, '.codex', 'rules');
    const rulesReadme = path.join(rulesDir, 'README.md');
    if (!fs.existsSync(rulesReadme)) {
      files.push({
        path: '.codex/rules/README.md',
        action: 'create',
        family: 'codex-rules',
        content: buildRulesStarter(),
        currentState: '.codex/rules/ directory is missing or empty',
        proposedState: 'create a Codex rules starter with guidance on writing sandbox-escape rules',
      });
    }
  }

  // Hooks scaffold (skip on Windows)
  if (wantModule('hooks') && os.platform() !== 'win32') {
    const hooksPath = path.join(options.dir, '.codex', 'hooks.json');
    if (!fs.existsSync(hooksPath)) {
      files.push({
        path: '.codex/hooks.json',
        action: 'create',
        family: 'codex-hooks',
        content: buildHooksStarter(),
        currentState: '.codex/hooks.json is missing',
        proposedState: 'create a Codex hooks scaffold with SessionStart example',
      });
    }
  }

  // Skills starter
  if (wantModule('skills')) {
    const skillsDir = path.join(options.dir, '.agents', 'skills');
    const skillsReadme = path.join(skillsDir, 'README.md');
    if (!fs.existsSync(skillsReadme) && !fs.existsSync(skillsDir)) {
      files.push({
        path: '.agents/skills/README.md',
        action: 'create',
        family: 'codex-skills',
        content: buildSkillsStarter(),
        currentState: '.agents/skills/ directory is missing',
        proposedState: 'create a Codex skills starter with SKILL.md conventions and kebab-case naming guidance',
      });
    }
  }

  // Subagents starter
  if (wantModule('subagents')) {
    const agentsDir = path.join(options.dir, '.codex', 'agents');
    if (!fs.existsSync(agentsDir)) {
      files.push({
        path: '.codex/agents/README.md',
        action: 'create',
        family: 'codex-subagents',
        content: buildSubagentsStarter(),
        currentState: '.codex/agents/ directory is missing',
        proposedState: 'create a Codex custom agents starter with TOML conventions',
      });
    }
  }

  // MCP starter
  if (wantModule('mcp')) {
    const configContent = ctx.configContent ? ctx.configContent() : '';
    const hasMcpSection = configContent && /\[mcp_servers\./i.test(configContent);
    if (!hasMcpSection) {
      const domainPacks = options.domainPacks || [];
      const mcpRecs = recommendCodexMcpPacks(stacks, domainPacks, { ctx });
      if (mcpRecs.length > 0) {
        const mcpToml = packsToToml(mcpRecs.map(p => p.key));
        files.push({
          path: '.codex/config.toml (MCP append)',
          action: 'append',
          family: 'codex-mcp',
          content: mcpToml,
          currentState: 'No MCP servers configured in .codex/config.toml',
          proposedState: `add ${mcpRecs.length} recommended MCP packs: ${mcpRecs.map(p => p.label).join(', ')}`,
        });
      }
    }
  }

  // CI / Review workflow starter
  if (wantModule('ci')) {
    const workflowDir = path.join(options.dir, '.github', 'workflows');
    const codexWorkflow = path.join(workflowDir, 'codex-review.yml');
    if (!fs.existsSync(codexWorkflow)) {
      files.push({
        path: '.github/workflows/codex-review.yml',
        action: 'create',
        family: 'codex-ci-review',
        content: buildCiReviewStarter(),
        currentState: 'No Codex CI review workflow exists',
        proposedState: 'create a GitHub Actions workflow for Codex-based PR review',
      });
    }
  }

  return { ctx, stacks, files };
}

// --- New starter builders for CP-04 ---

function buildRulesStarter() {
  return [
    '# Codex Rules',
    '',
    'Place rule files in this directory to control Codex sandbox-escape behavior.',
    '',
    '## Rule format',
    '',
    'Each rule file should be a `.md` file with:',
    '- A clear description of what commands the rule allows',
    '- `match` examples showing commands that should be allowed',
    '- `not_match` examples showing commands that should be blocked',
    '',
    '## Example rule',
    '',
    '```markdown',
    '# Allow npm commands',
    '',
    'Allow npm and npx commands for package management.',
    '',
    '- match: `npm install`',
    '- match: `npx jest`',
    '- not_match: `npm publish` (requires manual approval)',
    '```',
    '',
    '## Best practices',
    '',
    '- Use specific patterns, not wildcards',
    '- Document the reason for each allowed command class',
    '- Review rules when adding new workflow surfaces',
    '',
    `_Generated by nerviq v${version}_`,
    '',
  ].join('\n');
}

function buildHooksStarter() {
  return JSON.stringify({
    "$schema": "https://docs.codex.ai/hooks-schema.json",
    "hooks": [
      {
        "event": "SessionStart",
        "command": "echo 'Codex session started'",
        "description": "Example SessionStart hook — customize or remove",
        "timeout_ms": 5000,
      }
    ]
  }, null, 2) + '\n';
}

function buildSkillsStarter() {
  return [
    '# Codex Skills',
    '',
    'Place skill directories here. Each skill needs a `SKILL.md` file.',
    '',
    '## Directory structure',
    '',
    '```',
    '.agents/skills/',
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
    'description: Short description for implicit invocation',
    '---',
    '',
    '# My Skill',
    '',
    'Instructions for Codex when this skill is invoked.',
    '```',
    '',
    '## Critical naming rules',
    '',
    '- Use **kebab-case** for skill directory names (e.g., `code-review`, not `CodeReview`)',
    '- PascalCase names have 0% implicit invocation success rate',
    '- Keep descriptions short for bounded context cost',
    '',
    `_Generated by nerviq v${version}_`,
    '',
  ].join('\n');
}

function buildSubagentsStarter() {
  return [
    '# Codex Custom Agents',
    '',
    'Place custom agent TOML files here.',
    '',
    '## Format',
    '',
    '```toml',
    'name = "my-agent"',
    'description = "What this agent does"',
    'developer_instructions = "Detailed instructions for the agent"',
    '',
    '[sandbox]',
    'mode = "workspace-write"',
    '```',
    '',
    '## Configuration notes',
    '',
    '- `max_threads` is hardcoded at 6 (system ceiling)',
    '- `max_depth` defaults to 1 — increase only with justification',
    '- Per-agent sandbox overrides should be as narrow as possible',
    '- Cloud tasks run in a different trust class than local CLI',
    '',
    `_Generated by nerviq v${version}_`,
    '',
  ].join('\n');
}

function buildCiReviewStarter() {
  return [
    'name: Codex Review',
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
    '  codex-review:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - name: Codex Review',
    '        uses: openai/codex-action@v1',
    '        with:',
    '          safety-strategy: review-only',
    '        env:',
    '          CODEX_API_KEY: ${{ secrets.CODEX_API_KEY }}',
  ].join('\n') + '\n';
}

async function setupCodex(options) {
  const silent = options.silent === true;
  const { ctx, stacks, files } = buildCodexSetupFiles(options);
  const writtenFiles = [];
  const preservedFiles = [];

  function log(message = '') {
    if (!silent) {
      console.log(message);
    }
  }

  log('');
  log('\x1b[1m  nerviq codex setup\x1b[0m');
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
  if (!skippedSet.has('AGENTS.md') && fs.existsSync(path.join(options.dir, 'AGENTS.md')) && !writtenFiles.includes('AGENTS.md')) {
    preservedFiles.push('AGENTS.md');
  }
  if (!skippedSet.has('.codex/config.toml') && fs.existsSync(path.join(options.dir, '.codex', 'config.toml')) && !writtenFiles.includes('.codex/config.toml')) {
    preservedFiles.push('.codex/config.toml');
  }

  let rollbackArtifact = null;
  let activityArtifact = null;
  if (writtenFiles.length > 0) {
    rollbackArtifact = writeRollbackArtifact(options.dir, {
      sourcePlan: 'codex-setup',
      createdFiles: writtenFiles,
      patchedFiles: [],
      rollbackInstructions: writtenFiles.map((file) => `Delete ${file}`),
    });
    activityArtifact = writeActivityArtifact(options.dir, 'codex-setup', {
      platform: 'codex',
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
  log('  Run \x1b[1mnpx nerviq --platform codex\x1b[0m to audit your Codex setup.');
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
  buildAgentsMd,
  buildConfigToml,
  buildCodexSetupFiles,
  setupCodex,
};
