const fs = require('fs');
const os = require('os');
const path = require('path');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-copilot-${name}-`));
}

function writeFile(base, filePath, content) {
  const fullPath = path.join(base, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

function writeJson(base, filePath, payload) {
  writeFile(base, filePath, JSON.stringify(payload, null, 2));
}

function withTempHome(homeDir, fn) {
  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    HOMEDRIVE: process.env.HOMEDRIVE,
    HOMEPATH: process.env.HOMEPATH,
  };

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  const parsed = path.parse(homeDir);
  process.env.HOMEDRIVE = parsed.root.replace(/[\\/]+$/, '');
  process.env.HOMEPATH = homeDir.slice(parsed.root.length - (parsed.root.endsWith('\\') || parsed.root.endsWith('/') ? 1 : 0));

  const restore = () => {
    process.env.HOME = previous.HOME;
    process.env.USERPROFILE = previous.USERPROFILE;
    process.env.HOMEDRIVE = previous.HOMEDRIVE;
    process.env.HOMEPATH = previous.HOMEPATH;
  };

  try {
    return fn();
  } finally {
    restore();
  }
}

function baseCopilotInstructions(extraLines = []) {
  return [
    '# Project Instructions',
    '',
    '## Overview',
    '- This repo uses GitHub Copilot as the primary coding assistant.',
    '- Keep changes small, explicit, and reviewable.',
    '- Prefer focused edits over broad rewrites.',
    '- Use the repo scripts below before handoff.',
    '',
    '## Verification',
    '- Test: `npm test`',
    '- Lint: `npm run lint`',
    '- Build: `npm run build`',
    '- Re-run the narrowest relevant command after edits.',
    '',
    '## Architecture',
    '- src/ contains product code.',
    '- .github/ contains Copilot instructions and workflows.',
    '- .vscode/ contains VS Code and Copilot settings.',
    '- prompt-files/ contains reusable prompt templates.',
    '',
    '## Safety',
    '- Never commit secrets.',
    '- Review diffs before confirming code deletions.',
    '- MCP auth uses documented environment variables only.',
    '- Content exclusions protect sensitive files from Copilot indexing.',
    '',
    ...extraLines,
  ].join('\n');
}

function basePackageJson(extra = {}) {
  return {
    name: 'copilot-fixture',
    scripts: {
      test: 'vitest',
      lint: 'eslint .',
      build: 'vite build',
    },
    dependencies: {
      pg: '^8.0.0',
    },
    ...extra,
  };
}

function buildVscodeSettings(options = {}) {
  const settings = {};

  if (options.copilotModel) {
    settings['github.copilot.chat.languageModel'] = options.copilotModel;
  }
  if (options.copilotEnable !== undefined) {
    settings['github.copilot.enable'] = options.copilotEnable;
  }
  if (options.terminalSandbox !== undefined) {
    // The check navigates dotted path: chat.tools.terminal.sandbox.enabled
    if (!settings.chat) settings.chat = {};
    if (!settings.chat.tools) settings.chat.tools = {};
    if (!settings.chat.tools.terminal) settings.chat.tools.terminal = {};
    if (!settings.chat.tools.terminal.sandbox) settings.chat.tools.terminal.sandbox = {};
    settings.chat.tools.terminal.sandbox.enabled = options.terminalSandbox;
  }
  if (options.extensionsMode) {
    settings['github.copilot.chat.agent.extensionsMode'] = options.extensionsMode;
  }
  if (options.agentMode !== undefined) {
    settings['github.copilot.chat.agent.enabled'] = options.agentMode;
  }
  if (options.contentExclusions) {
    // getValueByPath navigates by splitting on '.' so we need nested structure
    if (!settings.github) settings.github = {};
    if (!settings.github.copilot) settings.github.copilot = {};
    if (!settings.github.copilot.advanced) settings.github.copilot.advanced = {};
    settings.github.copilot.advanced.contentExclusion = options.contentExclusions;
  }
  if (options.autoApproval) {
    settings['github.copilot.chat.agent.autoApproval'] = options.autoApproval;
  }
  if (options.deprecated) {
    Object.assign(settings, options.deprecated);
  }
  if (options.extra) {
    Object.assign(settings, options.extra);
  }

  return JSON.stringify(settings, null, 2);
}

function buildEmptyRepo() {
  const dir = mkFixture('empty');
  writeJson(dir, 'package.json', { name: 'empty-copilot' });
  return { dir };
}

function buildRichCopilotRepo() {
  const dir = mkFixture('rich');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'README.md', 'GitHub auth uses GITHUB_TOKEN for the MCP server.');
  writeFile(dir, '.env.example', 'GITHUB_TOKEN=your-token-here\n');

  // copilot-instructions.md
  writeFile(dir, '.github/copilot-instructions.md', baseCopilotInstructions([
    '## Modern Features',
    '- Copilot supports MCP servers for external context.',
    '- Prompt files in .github/prompts/ provide reusable templates.',
    '- Scoped instructions in .github/instructions/ target specific file patterns.',
    '- Cloud agents run in sandboxed environments for CI-style automation.',
    '',
    '## Cost & Billing',
    '- Be aware of Copilot seat costs and premium model usage.',
    '- Cloud agent sessions consume compute credits.',
    '- Review character limits apply to large PRs.',
    '',
    '## Content Exclusions',
    '- Sensitive files excluded via content exclusion settings.',
    '- .env and credential files must not be indexed by Copilot.',
  ]));

  // .vscode/settings.json
  writeFile(dir, '.vscode/settings.json', buildVscodeSettings({
    copilotModel: 'claude-sonnet-4',
    terminalSandbox: true,
    extensionsMode: 'allowed',
    agentMode: true,
    contentExclusions: {
      '**/.env': true,
      '**/secrets/**': true,
    },
  }));

  // MCP configuration
  writeJson(dir, '.vscode/mcp.json', {
    servers: {
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp@latest'],
      },
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
      },
    },
  });

  // Cloud agent setup
  writeJson(dir, '.github/copilot/agents.json', {
    agents: [{
      name: 'review-agent',
      model: 'claude-sonnet-4',
      instructions: 'Review PRs for correctness and security.',
      tools: ['github'],
    }],
  });

  // Scoped instructions
  writeFile(dir, '.github/instructions/testing.instructions.md', [
    '---',
    'applyTo: "**/*.test.{js,ts}"',
    '---',
    '',
    'Use Vitest for all test files. Prefer describe/test blocks.',
    'Always include edge cases and error scenarios.',
  ].join('\n'));

  // Prompt files
  writeFile(dir, '.github/prompts/review.prompt.md', [
    '---',
    'name: review',
    'description: Review the current diff for correctness and safety.',
    '---',
    '',
    'Review the following code changes for:',
    '1. Correctness',
    '2. Security vulnerabilities',
    '3. Performance issues',
  ].join('\n'));

  return { dir };
}

function buildNoInstructionsRepo() {
  const dir = mkFixture('no-instructions');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, '.vscode/settings.json', buildVscodeSettings({
    copilotModel: 'claude-sonnet-4',
    terminalSandbox: true,
  }));
  return { dir };
}

function buildDeprecatedSettingsRepo() {
  const dir = mkFixture('deprecated');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, '.github/copilot-instructions.md', baseCopilotInstructions());
  writeFile(dir, '.vscode/settings.json', buildVscodeSettings({
    deprecated: {
      'github.copilot.inlineSuggest.enable': true,
      'github.copilot.editor.enableAutoCompletions': true,
    },
  }));
  return { dir };
}

function buildCloudAgentRepo() {
  const dir = mkFixture('cloud-agent');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, '.github/copilot-instructions.md', baseCopilotInstructions([
    '## Cloud Agents',
    '- Cloud agents handle automated reviews and CI tasks.',
    '- Signed commits are required for cloud agent PRs.',
    '- Implementation plans must be approved before execution.',
  ]));
  writeFile(dir, '.vscode/settings.json', buildVscodeSettings({
    copilotModel: 'claude-sonnet-4',
    terminalSandbox: true,
    agentMode: true,
  }));
  writeJson(dir, '.github/copilot/agents.json', {
    agents: [{
      name: 'ci-reviewer',
      model: 'claude-sonnet-4',
      instructions: 'Review and test all PRs.',
      tools: ['github', 'terminal'],
      signedCommits: true,
    }],
  });
  writeFile(dir, '.github/copilot/setup-steps.json', JSON.stringify({
    steps: [
      { name: 'install', command: 'npm ci' },
      { name: 'test', command: 'npm test' },
    ],
  }, null, 2));
  writeFile(dir, '.github/instructions/security.instructions.md', [
    '---',
    'applyTo: "**/*.{js,ts}"',
    '---',
    '',
    'Check for OWASP Top 10 vulnerabilities.',
    'Never expose secrets in logs or output.',
  ].join('\n'));
  return { dir };
}

function buildContentExclusionRepo() {
  const dir = mkFixture('content-exclusion');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, '.github/copilot-instructions.md', baseCopilotInstructions());
  writeFile(dir, '.vscode/settings.json', buildVscodeSettings({
    copilotModel: 'claude-sonnet-4',
    contentExclusions: {
      '**/.env': true,
      '**/.env.*': true,
      '**/secrets/**': true,
      '**/credentials/**': true,
    },
  }));
  writeFile(dir, '.env', 'SECRET_KEY=abc123\n');
  writeFile(dir, '.env.production', 'DB_PASSWORD=prod-secret\n');
  return { dir };
}

function buildMultiPlatformRepo() {
  const base = buildRichCopilotRepo();
  writeFile(base.dir, 'CLAUDE.md', '# Claude surface\n');
  writeFile(base.dir, '.claude/settings.json', JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }, null, 2));
  writeFile(base.dir, 'GEMINI.md', '# Gemini surface\n');
  writeFile(base.dir, '.gemini/settings.json', JSON.stringify({ model: 'gemini-2.5-pro' }, null, 2));
  return base;
}

module.exports = {
  mkFixture,
  writeFile,
  writeJson,
  withTempHome,
  buildEmptyRepo,
  buildRichCopilotRepo,
  buildNoInstructionsRepo,
  buildDeprecatedSettingsRepo,
  buildCloudAgentRepo,
  buildContentExclusionRepo,
  buildMultiPlatformRepo,
};
