const fs = require('fs');
const os = require('os');
const path = require('path');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-codex-${name}-`));
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
  writeFile(base, path.join('.agents', 'skills', name, 'SKILL.md'), body);
}

function writeCustomAgent(base, fileName, body) {
  writeFile(base, path.join('.codex', 'agents', fileName), body);
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

function createTrustedHome(projectDir) {
  const homeDir = mkFixture('codex-home');
  const normalized = projectDir.replace(/\\/g, '\\\\');
  writeFile(homeDir, '.codex/config.toml', [
    `[projects."${normalized}"]`,
    'trust_level = "trusted"',
    '',
  ].join('\n'));
  return homeDir;
}

function baseAgents(extraLines = []) {
  return [
    '# Repo Agent Guide',
    '',
    '## Overview',
    '- This repo uses Codex as a non-interactive coding surface.',
    '- Keep repo changes small, explicit, and reviewable.',
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
    '- .codex/ contains runtime config for Codex.',
    '- codex/rules/ contains approval and shell safety rules.',
    '- .github/workflows/ contains CI and automation boundaries.',
    '',
    '## Safety',
    '- Never commit secrets.',
    '- Prefer narrow rules to wildcard approvals.',
    '- Wrapper caveat: avoid bash -lc style rules unless the caveat is documented.',
    '- Remote MCP auth uses documented environment variables only.',
    '- Use CI for enforcement that cannot rely on local runtime hooks.',
    '',
    ...extraLines,
  ].join('\n');
}

function basePackageJson(extra = {}) {
  return {
    name: 'codex-fixture',
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

function buildConfigToml(options = {}) {
  const lines = [];

  if (options.profile !== false && options.profile) lines.push(`profile = "${options.profile}"`);
  if (options.model !== false && options.model !== undefined) lines.push(`model = "${options.model}"`);
  if (options.reasoning !== false && options.reasoning !== undefined) {
    lines.push(`${options.legacyReasoning ? 'reasoning_effort' : 'model_reasoning_effort'} = "${options.reasoning}"`);
  }
  if (options.weakModel !== false && options.weakModel !== undefined) {
    lines.push(`${options.legacyWeakModel ? 'weak_model' : 'model_for_weak_tasks'} = "${options.weakModel}"`);
  }
  if (options.approval !== false && options.approval !== undefined) lines.push(`approval_policy = "${options.approval}"`);
  if (options.sandbox !== false && options.sandbox !== undefined) lines.push(`sandbox_mode = "${options.sandbox}"`);
  if (options.errorMode !== false && options.errorMode !== undefined) lines.push(`full_auto_error_mode = "${options.errorMode}"`);
  if (options.disableResponseStorage === true) lines.push('disable_response_storage = true');
  if (typeof options.projectDocMaxBytes === 'number') lines.push(`project_doc_max_bytes = ${options.projectDocMaxBytes}`);
  if (typeof options.rootSendToServer === 'boolean') lines.push(`send_to_server = ${options.rootSendToServer ? 'true' : 'false'}`);
  if (typeof options.rootMaxThreads === 'number') lines.push(`max_threads = ${options.rootMaxThreads}`);
  if (options.extraRootLines) lines.push(...options.extraRootLines);
  lines.push('');

  if (typeof options.hooksEnabled === 'boolean') {
    lines.push('[features]');
    lines.push(`codex_hooks = ${options.hooksEnabled ? 'true' : 'false'}`);
    if (typeof options.undoExplicit === 'boolean') {
      lines.push(`undo = ${options.undoExplicit ? 'true' : 'false'}`);
    }
    lines.push('');
  } else if (typeof options.undoExplicit === 'boolean') {
    lines.push('[features]');
    lines.push(`undo = ${options.undoExplicit ? 'true' : 'false'}`);
    lines.push('');
  }

  if (options.includeHistory !== false) {
    lines.push('[history]');
    lines.push(`send_to_server = ${options.historySendToServer === true ? 'true' : 'false'}`);
    lines.push('');
  }

  if (options.networkAccess !== undefined) {
    lines.push('[sandbox_workspace_write]');
    lines.push(`network_access = ${options.networkAccess ? 'true' : 'false'}`);
    lines.push('');
  }

  if (typeof options.maxThreads === 'number') {
    lines.push('[agents]');
    lines.push(`max_threads = ${options.maxThreads}`);
    if (typeof options.maxDepth === 'number') {
      lines.push(`max_depth = ${options.maxDepth}`);
    }
    lines.push('');
  } else if (typeof options.maxDepth === 'number') {
    lines.push('[agents]');
    lines.push(`max_depth = ${options.maxDepth}`);
    lines.push('');
  }

  if (options.profileSections) {
    for (const [name, profileLines] of Object.entries(options.profileSections)) {
      lines.push(`[profiles.${name}]`);
      lines.push(...profileLines);
      lines.push('');
    }
  }

  if (Array.isArray(options.mcpServers)) {
    for (const server of options.mcpServers) {
      lines.push(`[mcp_servers.${server.id}]`);
      lines.push(...server.lines);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function writeGoodRules(dir) {
  writeFile(dir, 'codex/rules/default.rules', [
    'prefix_rule(',
    '  pattern = ["gh", "pr", "view"],',
    '  decision = "prompt",',
    '  match = [["gh", "pr", "view", "123"]],',
    '  not_match = [["gh", "pr", "merge", "123"]],',
    ')',
    '',
    'prefix_rule(',
    '  pattern = ["rm"],',
    '  decision = "forbidden",',
    '  match = [["rm", "-rf", "/"]],',
    ')',
  ].join('\n'));
}

function writeRulesMissingRiskCoverage(dir) {
  writeFile(dir, 'codex/rules/default.rules', [
    'prefix_rule(',
    '  pattern = ["echo"],',
    '  decision = "prompt",',
    '  match = [["echo", "hello"]],',
    ')',
  ].join('\n'));
}

function writeRulesBadPatterns(dir) {
  writeFile(dir, 'codex/rules/default.rules', [
    'prefix_rule(',
    '  pattern = ["*"],',
    '  decision = "allow",',
    ')',
  ].join('\n'));
}

function writeRulesWrapperNoNote(dir) {
  writeFile(dir, 'codex/rules/default.rules', [
    'prefix_rule(',
    '  pattern = ["bash"],',
    '  decision = "prompt",',
    '  match = [["bash", "-lc", "npm test"]],',
    ')',
  ].join('\n'));
}

function writeHooksGood(dir) {
  writeFile(dir, '.codex/hooks.json', {
    SessionStart: [{ command: 'echo ready', timeout: 30 }],
    Stop: [{ command: 'echo done', timeout: 30 }],
  });
}

function writeHooksBad(dir) {
  writeFile(dir, '.codex/hooks.json', {
    SessionStart: [{ command: 'echo ready', timeout: 120 }],
    FileWrite: [{ command: 'echo unsupported', timeout: 30 }],
  });
}

function writeCodexAction(dir, runsOn) {
  writeFile(dir, '.github/workflows/codex.yml', [
    'name: codex',
    'on: [push]',
    'jobs:',
    '  run-codex:',
    `    runs-on: ${runsOn}`,
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: openai/codex-action@v1',
    '        with:',
    '          prompt: "review repo"',
    '          safety-strategy: unsafe',
  ].join('\n'));
}

function buildEmptyRepo() {
  const dir = mkFixture('empty');
  writeJson(dir, 'package.json', { name: 'empty-codex' });
  return { dir };
}

function buildRichTrustedMcpRepo() {
  const dir = mkFixture('rich-trusted');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'README.md', 'linear auth uses LINEAR_TOKEN for the remote MCP server.');
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    profile: 'safe',
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    undoExplicit: false,
    historySendToServer: false,
    networkAccess: false,
    maxThreads: 4,
    profileSections: {
      safe: [
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
      ],
    },
    mcpServers: [
      {
        id: 'linear',
        lines: [
          'url = "https://mcp.linear.app"',
          'bearer_token_env_var = "LINEAR_TOKEN"',
          'enabled_tools = ["issues", "projects"]',
          'startup_timeout_sec = 20',
        ],
      },
    ],
  }));
  writeGoodRules(dir);
  writeCodexAction(dir, 'windows-latest');
  const homeDir = createTrustedHome(dir);
  return { dir, homeDir };
}

function buildThinAgentsRepo() {
  const dir = mkFixture('thin-agents');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', [
    '# Repo',
    '',
    'Be helpful.',
    'Always use tabs.',
    'Use spaces for indentation.',
  ].join('\n'));
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    undoExplicit: true,
    historySendToServer: false,
  }));
  return { dir };
}

function buildOverrideUndocumentedRepo() {
  const dir = mkFixture('override-undocumented');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, 'AGENTS.override.md', '# extra override\n\nextra scope');
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  return { dir };
}

function buildOversizedAgentsRepo() {
  const dir = mkFixture('oversized-agents');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', `${baseAgents()}\n${'extra-line\n'.repeat(80)}`);
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
    projectDocMaxBytes: 120,
  }));
  return { dir };
}

function buildConfigMissingRepo() {
  const dir = mkFixture('config-missing');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: false,
    reasoning: false,
    weakModel: false,
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: false,
    hooksEnabled: false,
    includeHistory: false,
  }));
  return { dir };
}

function buildTrustImplicitRepo() {
  const dir = mkFixture('trust-implicit');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: false,
    sandbox: false,
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  return { dir };
}

function buildInvalidTomlRepo() {
  const dir = mkFixture('invalid-toml');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', 'model = "gpt-5.4"\n[history\nsend_to_server = false\n');
  return { dir };
}

function buildLegacyConfigRepo() {
  const dir = mkFixture('legacy-config');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    legacyReasoning: true,
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    includeHistory: false,
    rootSendToServer: false,
  }));
  return { dir };
}

function buildBadProfileRepo() {
  const dir = mkFixture('bad-profile');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    profile: 'strict',
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
    profileSections: {
      safe: ['approval_policy = "on-request"'],
    },
  }));
  return { dir };
}

function buildDangerRepo() {
  const dir = mkFixture('danger');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'never',
    sandbox: 'danger-full-access',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  return { dir };
}

function buildNeverNoJustificationRepo() {
  const dir = mkFixture('never-no-justification');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', [
    '# Repo Agent Guide',
    '',
    '## Verification',
    '- Test: `npm test`',
    '- Lint: `npm run lint`',
    '- Build: `npm run build`',
    '',
    '## Architecture',
    '- src/ contains product code.',
    '- .codex/ contains Codex config.',
  ].join('\n'));
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'never',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  return { dir };
}

function buildWorkspaceNoNetworkRepo() {
  const dir = mkFixture('workspace-no-network');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  return { dir };
}

function buildRegulatedRepo(storageExplicit) {
  const dir = mkFixture(storageExplicit ? 'regulated-good' : 'regulated-bad');
  writeJson(dir, 'package.json', basePackageJson({ name: 'fintech-codex' }));
  writeFile(dir, 'README.md', 'Fintech payments platform handling PII and compliance-sensitive data.');
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
    disableResponseStorage: storageExplicit,
  }));
  return { dir };
}

function buildActionUnsafeLinuxRepo() {
  const dir = mkFixture('action-linux');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  writeCodexAction(dir, 'ubuntu-latest');
  return { dir };
}

function buildAgentsSecretRepo() {
  const dir = mkFixture('agents-secret');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', `${baseAgents()}\n- sk-ant-123456789012345678901234`);
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  return { dir };
}

function buildRulesMissingRiskRepo() {
  const dir = mkFixture('rules-missing-risk');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  writeRulesMissingRiskCoverage(dir);
  return { dir };
}

function buildRulesBadPatternsRepo() {
  const dir = mkFixture('rules-bad-patterns');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents(['- We did not document shell wrapper caveats here.']));
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  writeRulesBadPatterns(dir);
  return { dir };
}

function buildRulesWrapperNoNoteRepo() {
  const dir = mkFixture('rules-wrapper-no-note');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents().replace('- Wrapper caveat: avoid bash -lc style rules unless the caveat is documented.\n', ''));
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  writeRulesWrapperNoNote(dir);
  return { dir };
}

function buildHooksImplicitRepo() {
  const dir = mkFixture('hooks-implicit');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', `${baseAgents()}\n- Hooks: SessionStart should run before risky work.`);
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: undefined,
    historySendToServer: false,
  }));
  return { dir };
}

function buildHooksGoodRepo() {
  const dir = mkFixture('hooks-good');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents(['- Hooks are present, but Windows users must rely on CI enforcement instead.']));
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: true,
    historySendToServer: false,
  }));
  writeHooksGood(dir);
  return { dir };
}

function buildHooksBadRepo() {
  const dir = mkFixture('hooks-bad');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', [
    '# Repo Agent Guide',
    '',
    '## Verification',
    '- Test: `npm test`',
    '- Lint: `npm run lint`',
    '',
    '## Architecture',
    '- src/, .codex/',
    '',
    '## Safety',
    '- Never commit secrets.',
    '- Hooks exist for local automation.',
  ].join('\n'));
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: true,
    historySendToServer: false,
  }));
  writeHooksBad(dir);
  return { dir };
}

function buildExternalToolsNoMcpRepo() {
  const dir = mkFixture('external-tools-no-mcp');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  return { dir };
}

function buildMcpBadRepo() {
  const dir = mkFixture('mcp-bad');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
    mcpServers: [
      {
        id: 'linear',
        lines: [
          'url = "https://mcp.linear.app"',
          'startup_timeout_sec = 45',
          'transport = "sse"',
        ],
      },
    ],
  }));
  return { dir };
}

function buildMultiPlatformRepo() {
  const base = buildRichTrustedMcpRepo();
  writeFile(base.dir, 'CLAUDE.md', '# Claude surface\n');
  writeFile(base.dir, '.claude/settings.json', { permissions: { defaultMode: 'acceptEdits' } });
  return base;
}

function buildAdvancedGoodRepo() {
  const base = buildRichTrustedMcpRepo();
  writeJson(base.dir, 'package.json', {
    ...basePackageJson(),
    scripts: {
      test: 'vitest',
      lint: 'eslint .',
      build: 'vite build',
      review: 'codex review --uncommitted -m gpt-5.4',
    },
  });
  writeSkill(base.dir, 'repo-health', [
    '# repo-health',
    '',
    'Use this skill when the user wants a quick Codex setup health check for the current repository.',
    'Summarize the most important issues first and keep recommendations specific to this repo.',
  ].join('\n'));
  writeCustomAgent(base.dir, 'reviewer.toml', [
    'name = "reviewer"',
    'description = "Review diffs and call out risk before merge."',
    'developer_instructions = "Focus on correctness, trust boundaries, and regressions."',
    'sandbox_mode = "read-only"',
    'approval_policy = "on-request"',
  ].join('\n'));
  writeJson(base.dir, '.agents/plugins/marketplace.json', [
    { name: 'repo-health', path: '.agents/plugins/repo-health' },
  ]);
  writeFile(base.dir, '.github/workflows/codex.yml', [
    'name: codex-safe',
    'on: [workflow_dispatch]',
    'jobs:',
    '  codex:',
    '    runs-on: windows-latest',
    '    env:',
    '      CODEX_API_KEY: ${{ secrets.CODEX_API_KEY }}',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: openai/codex-action@v1',
    '        with:',
    '          prompt: "review repo"',
    '          safety-strategy: unsafe',
  ].join('\n'));
  writeFile(base.dir, 'AGENTS.md', `${baseAgents([
    '- Skills live under .agents/skills and should use short descriptions.',
    '- Subagents live under .codex/agents and keep sandbox overrides narrow.',
    '- Before scheduling Codex automation, validate it manually in workflow_dispatch or a dry run.',
    '- setup.sh is cross-platform when paired with the documented pwsh fallback and worktree cleanup notes below.',
  ])}

## Review Workflow
- Use \`codex review --uncommitted\` before handoff on risky diffs.
- Keep heavy reasoning or costly automation workflows intentional and documented.

## Worktree Lifecycle
- Worktree or setup lifecycle changes must include cleanup notes before handoff.
- If setup.sh changes, keep the PowerShell fallback or another cross-platform path documented.
`);
  writeFile(base.dir, 'setup.sh', '#!/usr/bin/env bash\necho setup\n');
  writeFile(base.dir, '.codex/config.toml', buildConfigToml({
    profile: 'safe',
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    undoExplicit: true,
    historySendToServer: false,
    networkAccess: false,
    maxThreads: 4,
    maxDepth: 2,
    profileSections: {
      safe: [
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
      ],
      review: [
        'model = "gpt-5.4"',
        'approval_policy = "on-request"',
        'sandbox_mode = "read-only"',
      ],
    },
    mcpServers: [
      {
        id: 'linear',
        lines: [
          'url = "https://mcp.linear.app"',
          'bearer_token_env_var = "LINEAR_TOKEN"',
          'enabled_tools = ["issues", "projects"]',
          'startup_timeout_sec = 20',
        ],
      },
    ],
  }));
  return base;
}

function buildSkillsClaimedNoDirRepo() {
  const dir = mkFixture('skills-claimed-no-dir');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', `${baseAgents()}\n- Skills are required for this workflow and should live in the repo.\n`);
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    historySendToServer: false,
  }));
  return { dir };
}

function buildSkillBadMetadataRepo() {
  const dir = mkFixture('skill-bad-metadata');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', `${baseAgents()}\n- Skills are part of this repo.\n`);
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    historySendToServer: false,
  }));
  writeSkill(dir, 'repo-health', '# repo-health');
  return { dir };
}

function buildSkillBadNameRepo() {
  const dir = mkFixture('skill-bad-name');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', `${baseAgents()}\n- Skills are part of this repo.\n`);
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    historySendToServer: false,
  }));
  writeSkill(dir, 'RepoHealth', [
    '# RepoHealth',
    '',
    'Use this skill for a short repo health review.',
  ].join('\n'));
  return { dir };
}

function buildSkillLongDescriptionRepo() {
  const dir = mkFixture('skill-long-description');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', `${baseAgents()}\n- Skills are part of this repo.\n`);
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    historySendToServer: false,
  }));
  writeSkill(dir, 'repo-health', [
    '# repo-health',
    '',
    'Use this skill when the user wants a very detailed and extremely exhaustive repository review that tries to cover every possible angle, every possible category, every possible file family, every possible tool boundary, and every historical nuance before deciding what to do next.',
  ].join('\n'));
  return { dir };
}

function buildSkillAutoRunRiskRepo() {
  const dir = mkFixture('skill-auto-run-risk');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', `${baseAgents()}\n- Skills are part of this repo.\n`);
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    historySendToServer: false,
  }));
  writeSkill(dir, 'auto-deploy', [
    '# auto-deploy',
    '',
    'Automatically deploy to production and git push without asking whenever tests are green.',
  ].join('\n'));
  return { dir };
}

function buildCustomAgentMissingFieldsRepo() {
  const dir = mkFixture('custom-agent-missing-fields');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', `${baseAgents()}\n- Subagents are part of this repo.\n`);
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    historySendToServer: false,
  }));
  writeCustomAgent(dir, 'reviewer.toml', [
    'name = "reviewer"',
    'description = "Review diffs."',
  ].join('\n'));
  return { dir };
}

function buildCustomAgentUnsafeRepo() {
  const dir = mkFixture('custom-agent-unsafe');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', `${baseAgents()}\n- Subagents are part of this repo.\n`);
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    historySendToServer: false,
    maxThreads: 4,
    maxDepth: 2,
  }));
  writeCustomAgent(dir, 'danger.toml', [
    'name = "danger"',
    'description = "Do risky work fast."',
    'developer_instructions = "Run commands directly."',
    'sandbox_mode = "danger-full-access"',
    'approval_policy = "never"',
  ].join('\n'));
  return { dir };
}

function buildExecUnsafeRepo() {
  const dir = mkFixture('exec-unsafe');
  writeJson(dir, 'package.json', {
    ...basePackageJson(),
    scripts: {
      exec: 'codex exec --full-auto \"fix repo\"',
    },
  });
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    historySendToServer: false,
  }));
  return { dir };
}

function buildActionMissingAuthRepo() {
  const dir = mkFixture('action-missing-auth');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    historySendToServer: false,
  }));
  writeFile(dir, '.github/workflows/codex.yml', [
    'name: codex',
    'on: [workflow_dispatch]',
    'jobs:',
    '  run-codex:',
    '    runs-on: windows-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: openai/codex-action@v1',
    '        with:',
    '          prompt: "review repo"',
    '          safety-strategy: unsafe',
  ].join('\n'));
  return { dir };
}

function buildAutomationUndocumentedRepo() {
  const dir = mkFixture('automation-undocumented');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    historySendToServer: false,
  }));
  writeFile(dir, '.github/workflows/codex.yml', [
    'name: codex',
    'on: [schedule]',
    'jobs:',
    '  run-codex:',
    '    runs-on: windows-latest',
    '    env:',
    '      CODEX_API_KEY: ${{ secrets.CODEX_API_KEY }}',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: openai/codex-action@v1',
    '        with:',
    '          prompt: "review repo"',
    '          safety-strategy: unsafe',
  ].join('\n'));
  return { dir };
}

function buildReviewAutomationNoModelRepo() {
  const dir = mkFixture('review-no-model');
  writeJson(dir, 'package.json', {
    ...basePackageJson(),
    scripts: {
      review: 'codex review --uncommitted',
    },
  });
  writeFile(dir, 'AGENTS.md', `${baseAgents()}\n- Use codex review for risky diffs.\n`);
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  return { dir };
}

function buildCodexIgnoredRepo() {
  const dir = mkFixture('codex-ignored');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, '.gitignore', '.codex/\n');
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  return { dir };
}

function buildLifecycleScriptRepo() {
  const dir = mkFixture('lifecycle-script');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  writeFile(dir, 'setup.sh', '#!/usr/bin/env bash\necho setup\n');
  return { dir };
}

function buildRedundantWorkflowsRepo() {
  const dir = mkFixture('redundant-workflows');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', `${baseAgents()}\n- Before scheduling Codex automation, validate it manually in workflow_dispatch.\n`);
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    profile: 'safe',
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  const workflow = [
    'name: codex-safe',
    'on: [workflow_dispatch]',
    'jobs:',
    '  codex:',
    '    runs-on: windows-latest',
    '    env:',
    '      CODEX_API_KEY: ${{ secrets.CODEX_API_KEY }}',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: openai/codex-action@v1',
    '        with:',
    '          prompt: "review repo"',
    '          safety-strategy: unsafe',
  ].join('\n');
  writeFile(dir, '.github/workflows/codex-a.yml', workflow);
  writeFile(dir, '.github/workflows/codex-b.yml', workflow);
  return { dir };
}

function buildWorktreeUndocumentedRepo() {
  const dir = mkFixture('worktree-undocumented');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', `${baseAgents()}\n- This repo uses worktrees for parallel work.\n`);
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  return { dir };
}

function buildModernFeaturesUndocumentedRepo() {
  const dir = mkFixture('modern-features-undocumented');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents().replace('- Hooks are required for this workflow and should live in the repo.\n', ''));
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: true,
    historySendToServer: false,
  }));
  writeHooksGood(dir);
  writeSkill(dir, 'repo-health', [
    '# repo-health',
    '',
    'Use this skill for a short repo health review.',
  ].join('\n'));
  return { dir };
}

function buildDeprecatedPatternRepo() {
  const dir = mkFixture('deprecated-pattern');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', `${baseAgents()}\n- Old note: on-failure approvals are fine here.\n`);
  writeFile(dir, '.codex/config.toml', [
    'model = "gpt-5.4"',
    'model_reasoning_effort = "medium"',
    'model_for_weak_tasks = "gpt-5.4-mini"',
    'approval_policy = "on-failure"',
    'sandbox_mode = "workspace-write"',
    'full_auto_error_mode = "ask-user"',
    '',
    '[history]',
    'send_to_server = false',
    '',
  ].join('\n'));
  return { dir };
}

function buildPluginInvalidRepo() {
  const dir = mkFixture('plugin-invalid');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', baseAgents());
  writeFile(dir, '.codex/config.toml', buildConfigToml({
    model: 'gpt-5.4',
    reasoning: 'medium',
    weakModel: 'gpt-5.4-mini',
    approval: 'on-request',
    sandbox: 'workspace-write',
    errorMode: 'ask-user',
    hooksEnabled: false,
    historySendToServer: false,
  }));
  writeFile(dir, '.agents/plugins/marketplace.json', '{ invalid json');
  return { dir };
}

module.exports = {
  mkFixture,
  writeFile,
  writeJson,
  withTempHome,
  buildEmptyRepo,
  buildRichTrustedMcpRepo,
  buildThinAgentsRepo,
  buildOverrideUndocumentedRepo,
  buildOversizedAgentsRepo,
  buildConfigMissingRepo,
  buildTrustImplicitRepo,
  buildInvalidTomlRepo,
  buildLegacyConfigRepo,
  buildBadProfileRepo,
  buildDangerRepo,
  buildNeverNoJustificationRepo,
  buildWorkspaceNoNetworkRepo,
  buildRegulatedRepo,
  buildActionUnsafeLinuxRepo,
  buildAgentsSecretRepo,
  buildRulesMissingRiskRepo,
  buildRulesBadPatternsRepo,
  buildRulesWrapperNoNoteRepo,
  buildHooksImplicitRepo,
  buildHooksGoodRepo,
  buildHooksBadRepo,
  buildExternalToolsNoMcpRepo,
  buildMcpBadRepo,
  buildMultiPlatformRepo,
  buildAdvancedGoodRepo,
  buildSkillsClaimedNoDirRepo,
  buildSkillBadMetadataRepo,
  buildSkillBadNameRepo,
  buildSkillLongDescriptionRepo,
  buildSkillAutoRunRiskRepo,
  buildCustomAgentMissingFieldsRepo,
  buildCustomAgentUnsafeRepo,
  buildExecUnsafeRepo,
  buildActionMissingAuthRepo,
  buildAutomationUndocumentedRepo,
  buildReviewAutomationNoModelRepo,
  buildCodexIgnoredRepo,
  buildLifecycleScriptRepo,
  buildRedundantWorkflowsRepo,
  buildWorktreeUndocumentedRepo,
  buildModernFeaturesUndocumentedRepo,
  buildDeprecatedPatternRepo,
  buildPluginInvalidRepo,
};
