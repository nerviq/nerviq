const fs = require('fs');
const os = require('os');
const path = require('path');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-gemini-${name}-`));
}

function writeFile(base, filePath, content) {
  const fullPath = path.join(base, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

function writeJson(base, filePath, payload) {
  writeFile(base, filePath, JSON.stringify(payload, null, 2));
}

function writeSkill(base, name, body) {
  writeFile(base, path.join('.gemini', 'skills', name, 'README.md'), body);
}

function writeAgent(base, name, body) {
  writeFile(base, path.join('.gemini', 'agents', name + '.md'), body);
}

function writeCommand(base, name, body) {
  writeFile(base, path.join('.gemini', 'commands', name + '.toml'), body);
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

function baseGeminiMd(extraLines = []) {
  return [
    '# Project Instructions',
    '',
    '## Overview',
    '- This repo uses Gemini CLI as the primary coding agent.',
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
    '- .gemini/ contains Gemini CLI settings.',
    '- .gemini/commands/ contains custom commands.',
    '- .github/workflows/ contains CI and automation.',
    '',
    '## Safety',
    '- Never commit secrets.',
    '- Never use --yolo in production without external sandbox containment.',
    '- Review diffs before confirming code deletions.',
    '- Remote MCP auth uses documented environment variables only.',
    '',
    ...extraLines,
  ].join('\n');
}

function basePackageJson(extra = {}) {
  return {
    name: 'gemini-fixture',
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

function buildSettingsJson(options = {}) {
  const settings = {};

  if (options.model) settings.model = options.model;
  if (options.sandbox !== undefined) settings.sandbox = options.sandbox;
  if (options.yolo === true) settings.yolo = true;
  if (options.autoEdit === true) settings.autoEdit = true;

  if (options.context) {
    settings.context = options.context;
  }

  if (options.mcpServers) {
    settings.mcpServers = options.mcpServers;
  }

  if (options.hooks) {
    settings.hooks = options.hooks;
  }

  if (options.policy) {
    settings.policy = options.policy;
  }

  if (options.env) {
    settings.env = options.env;
  }

  if (options.extra) {
    Object.assign(settings, options.extra);
  }

  return JSON.stringify(settings, null, 2);
}

function writeHooksGood(dir) {
  writeFile(dir, '.gemini/settings.json', buildSettingsJson({
    model: 'gemini-2.5-pro',
    sandbox: 'enabled',
    hooks: {
      SessionStart: [{ command: 'echo ready', timeout: 30 }],
      AfterTool: [{ command: 'echo done', timeout: 30 }],
    },
  }));
}

function buildEmptyRepo() {
  const dir = mkFixture('empty');
  writeJson(dir, 'package.json', { name: 'empty-gemini' });
  return { dir };
}

function buildRichGeminiRepo() {
  const dir = mkFixture('rich');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'README.md', 'GitHub auth uses GITHUB_PERSONAL_ACCESS_TOKEN for the remote MCP server.');
  writeFile(dir, '.env.example', 'GEMINI_API_KEY=your-key-here\nGITHUB_PERSONAL_ACCESS_TOKEN=your-token\n');
  writeFile(dir, 'GEMINI.md', baseGeminiMd([
    '## Rate Limits & Cost',
    '- Be aware of Gemini API rate limits and quota usage.',
    '- Free tier hits limits after 10-20 requests per minute. Use exponential backoff for retry.',
    '- Monitor token usage to avoid hitting context window limits.',
    '',
    '## Model Selection',
    '- Default: gemini-2.5-pro for complex reasoning tasks.',
    '- Use gemini-2.5-flash for fast, lightweight operations.',
    '- Flash vs Pro tradeoff: Flash is cheaper and faster but less capable for multi-step reasoning.',
    '',
    '## Policies & Enforcement',
    '- Policy rules under .gemini/policy/ enforce safety constraints.',
    '- Review policy files like code changes.',
    '',
    '## Modern Features',
    '- Gemini CLI supports MCP servers for external context.',
    '- Custom commands live in .gemini/commands/ as TOML files.',
    '- Skills and agents provide specialized capabilities.',
  ]));
  writeFile(dir, '.gemini/settings.json', buildSettingsJson({
    model: 'gemini-2.5-pro',
    sandbox: { mode: 'docker' },
    context: { fileName: 'GEMINI.md' },
    hooks: {
      SessionStart: [{ command: 'echo ready', timeout: 30 }],
      AfterTool: [{ command: 'echo checked', timeout: 30 }],
    },
    mcpServers: {
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp@latest'],
      },
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}' },
        excludeTools: ['create_repository', 'delete_file'],
      },
    },
    extra: {
      history: { persistence: 'save_all' },
    },
  }));
  writeCommand(dir, 'review', [
    'description = "Review the current diff for correctness and safety."',
    'command = "gemini review {{args}}"',
  ].join('\n'));
  writeAgent(dir, 'security-reviewer', [
    '---',
    'name: security-reviewer',
    'description: Reviews code for security issues.',
    'instructions: Focus on OWASP Top 10 and secret exposure.',
    '---',
  ].join('\n'));
  writeSkill(dir, 'repo-health', [
    '# repo-health',
    '',
    'Use this skill when the user wants a quick Gemini CLI setup health check for the current repository.',
    'Summarize the most important issues first and keep recommendations specific to this repo.',
  ].join('\n'));
  writeFile(dir, '.gemini/policy/baseline.toml', [
    '[rules.no-secrets]',
    'action = "deny"',
    'tool = "write_file"',
    'pattern = "secret|api_key|password"',
  ].join('\n'));
  return { dir };
}

function buildThinGeminiMdRepo() {
  const dir = mkFixture('thin');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'GEMINI.md', [
    '# Repo',
    '',
    'Be helpful.',
    'Always use tabs.',
    'Use spaces for indentation.',
  ].join('\n'));
  writeFile(dir, '.gemini/settings.json', buildSettingsJson({
    model: 'gemini-2.5-pro',
    sandbox: 'enabled',
  }));
  return { dir };
}

function buildInvalidJsonRepo() {
  const dir = mkFixture('invalid-json');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'GEMINI.md', baseGeminiMd());
  writeFile(dir, '.gemini/settings.json', '{ "model": "gemini-2.5-pro", invalid json here }');
  return { dir };
}

function buildYoloRepo() {
  const dir = mkFixture('yolo');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'GEMINI.md', baseGeminiMd());
  writeFile(dir, '.gemini/settings.json', buildSettingsJson({
    model: 'gemini-2.5-pro',
    yolo: true,
  }));
  return { dir };
}

function buildAutoEditRepo() {
  const dir = mkFixture('auto-edit');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'GEMINI.md', baseGeminiMd());
  writeFile(dir, '.gemini/settings.json', buildSettingsJson({
    model: 'gemini-2.5-pro',
    autoEdit: true,
  }));
  return { dir };
}

function buildNoSandboxRepo() {
  const dir = mkFixture('no-sandbox');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'GEMINI.md', baseGeminiMd());
  writeFile(dir, '.gemini/settings.json', buildSettingsJson({
    model: 'gemini-2.5-pro',
    sandbox: 'none',
  }));
  return { dir };
}

function buildPolicyConflictRepo() {
  const dir = mkFixture('policy-conflict');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'GEMINI.md', baseGeminiMd());
  writeFile(dir, '.gemini/settings.json', buildSettingsJson({
    model: 'gemini-2.5-pro',
    sandbox: 'enabled',
    policy: {
      tier1: { action: 'allow', pattern: 'rm -rf' },
      tier2: { action: 'block', pattern: 'rm -rf' },
    },
  }));
  writeFile(dir, '.gemini/policy/conflict.toml', [
    '[rules.allow-delete]',
    'action = "allow"',
    'pattern = "rm -rf"',
    '',
    '[rules.block-delete]',
    'action = "block"',
    'pattern = "rm -rf"',
  ].join('\n'));
  return { dir };
}

function buildMcpBadRepo() {
  const dir = mkFixture('mcp-bad');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'GEMINI.md', baseGeminiMd());
  writeFile(dir, '.gemini/settings.json', buildSettingsJson({
    model: 'gemini-2.5-pro',
    sandbox: 'enabled',
    mcpServers: {
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        transport: 'sse',
      },
    },
  }));
  return { dir };
}

function buildShellInjectionCommandRepo() {
  const dir = mkFixture('shell-injection');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'GEMINI.md', baseGeminiMd());
  writeFile(dir, '.gemini/settings.json', buildSettingsJson({
    model: 'gemini-2.5-pro',
    sandbox: 'enabled',
  }));
  writeCommand(dir, 'deploy', [
    'description = "Deploy to production"',
    'command = "!{user_input}"',
  ].join('\n'));
  return { dir };
}

function buildCiEnvBugRepo() {
  const dir = mkFixture('ci-env');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'GEMINI.md', baseGeminiMd());
  writeFile(dir, '.gemini/settings.json', buildSettingsJson({
    model: 'gemini-2.5-pro',
    sandbox: 'enabled',
    env: {
      CI: 'true',
      CI_PIPELINE_ID: '12345',
    },
  }));
  writeFile(dir, '.github/workflows/gemini.yml', [
    'name: gemini',
    'on: [push]',
    'jobs:',
    '  run:',
    '    runs-on: ubuntu-latest',
    '    env:',
    '      CI: "true"',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - run: gemini --yolo "review repo"',
  ].join('\n'));
  return { dir };
}

function buildSecretsInSettingsRepo() {
  const dir = mkFixture('secrets-in-settings');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'GEMINI.md', baseGeminiMd());
  writeFile(dir, '.gemini/settings.json', buildSettingsJson({
    model: 'gemini-2.5-pro',
    sandbox: 'enabled',
    extra: {
      apiKey: 'sk-ant-123456789012345678901234',
      geminiApiKey: 'AIzaSyA1234567890abcdefghijklmnopqrstuvwx',
    },
  }));
  return { dir };
}

function buildMultiPlatformRepo() {
  const base = buildRichGeminiRepo();
  writeFile(base.dir, 'CLAUDE.md', '# Claude surface\n');
  writeFile(base.dir, '.claude/settings.json', JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }, null, 2));
  return base;
}

module.exports = {
  mkFixture,
  writeFile,
  writeJson,
  withTempHome,
  buildEmptyRepo,
  buildRichGeminiRepo,
  buildThinGeminiMdRepo,
  buildInvalidJsonRepo,
  buildYoloRepo,
  buildAutoEditRepo,
  buildNoSandboxRepo,
  buildPolicyConflictRepo,
  buildMcpBadRepo,
  buildShellInjectionCommandRepo,
  buildCiEnvBugRepo,
  buildSecretsInSettingsRepo,
  buildMultiPlatformRepo,
};
