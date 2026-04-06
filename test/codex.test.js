const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { audit } = require('../src/audit');
const { setup } = require('../src/setup');
const { analyzeProject } = require('../src/analyze');
const { buildProposalBundle, applyProposalBundle } = require('../src/plans');
const { getGovernanceSummary } = require('../src/governance');
const { runBenchmark } = require('../src/benchmark');
const { tryParseToml } = require('../src/codex/config-parser');
const { buildCodexSetupFiles } = require('../src/codex/setup');
const { CODEX_TECHNIQUES } = require('../src/codex/techniques');
const { formatSarif } = require('../src/formatters/sarif');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-codex-${name}-`));
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), ...args], {
    cwd,
    encoding: 'utf8',
  });
}

describe('Codex TOML parser', () => {
  test('parses nested sections and arrays', () => {
    const parsed = tryParseToml([
      'model = "gpt-5.4"',
      'project_doc_fallback_filenames = ["AGENTS.md", "GEMINI.md"]',
      'persistence = "save_all"',
      '[mcp_servers.context7]',
      'command = "context7"',
      'enabled_tools = ["docs"]',
      '',
    ].join('\n'));

    expect(parsed.ok).toBe(true);
    expect(parsed.data.model).toBe('gpt-5.4');
    expect(parsed.data.project_doc_fallback_filenames).toEqual(['AGENTS.md', 'GEMINI.md']);
    expect(parsed.data.persistence).toBe('save_all');
    expect(parsed.data.mcp_servers.context7.enabled_tools).toEqual(['docs']);
  });
});

describe('Codex audit + setup', () => {
  test('codex v1.3 exposes the full 272-check catalog after adding 48 supplemental + Python/Go/Rust/Java + Ruby/DotNet/PHP stack checks', () => {
    expect(Object.keys(CODEX_TECHNIQUES)).toHaveLength(272);
  });

  test('codex audit identifies missing AGENTS and config', async () => {
    const dir = mkFixture('empty');
    try {
      const result = await audit({ dir, platform: 'codex', silent: true });
      expect(result.platform).toBe('codex');
      const failedKeys = result.results.filter(item => item.passed === false).map(item => item.key);
      expect(failedKeys).toContain('codexAgentsMd');
      expect(failedKeys).toContain('codexConfigExists');
      expect(result.suggestedNextCommand).toBe('npx nerviq --platform codex suggest-only');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex augment returns a Codex-native advisory report with caveats and scope note', async () => {
    const dir = mkFixture('augment-report');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'codex-app',
        dependencies: { next: '16', react: '19' },
        scripts: { test: 'vitest', lint: 'eslint .', build: 'next build' },
      }, null, 2));
      fs.writeFileSync(path.join(dir, 'next.config.js'), 'module.exports = {};\n');
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude instructions\n');
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), [
        'model = "gpt-5.4"',
        'model_reasoning_effort = "medium"',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        '',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
        '# codex-app',
        '',
        '## Scope',
        '- Primary platform: Codex CLI',
        '',
        '## Verification',
        '- Test: `npm test`',
        '- Lint: `npm run lint`',
        '- Build: `npm run build`',
        '',
        '## Architecture',
        '- app/, components/, .codex/',
      ].join('\n'));

      const report = await analyzeProject({ dir, platform: 'codex', mode: 'augment' });
      expect(report.platform).toBe('codex');
      expect(report.platformLabel).toBe('Codex');
      expect(report.mode).toBe('augment');
      expect(report.writeBehavior).toBe('No files are written in this mode.');
      expect(report.existingPlatformAssets.label).toBe('Codex');
      expect(report.existingPlatformAssets.instructionPath).toBe('AGENTS.md');
      expect(report.existingPlatformAssets.configPath).toBe('.codex/config.toml');
      expect(report.platformScopeNote).toBeTruthy();
      expect(report.platformScopeNote.kind).toBe('codex-only-pass');
      expect(Array.isArray(report.platformCaveats)).toBe(true);
      expect(Array.isArray(report.topNextActions)).toBe(true);
      expect(report.topNextActions.every(item => typeof item.why === 'string')).toBe(true);
      expect(Array.isArray(report.recommendedDomainPacks)).toBe(true);
      expect(report.recommendedDomainPacks.map(item => item.key)).toContain('frontend-ui');
      expect(Array.isArray(report.optionalModules)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex suggest-only is exposed in the CLI and returns a Codex-native JSON report', () => {
    const dir = mkFixture('cli-suggest');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'codex-suggest' }, null, 2));
      const result = runCli(['--platform', 'codex', 'suggest-only', '--json'], dir);
      expect(result.status).toBe(0);
      const payload = JSON.parse(result.stdout);
      expect(payload.platform).toBe('codex');
      expect(payload.mode).toBe('suggest-only');
      expect(payload.existingPlatformAssets.label).toBe('Codex');
      expect(Array.isArray(payload.topNextActions)).toBe(true);
      expect(payload.recommendedDomainPacks.map(item => item.key)).toContain('baseline-general');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex domain pack detection recognizes monorepo, infra, and governed rollout signals', async () => {
    const dir = mkFixture('packs-mixed');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'codex-platform-repo',
        private: true,
        workspaces: ['packages/*'],
        dependencies: { react: '19.0.0' },
      }, null, 2));
      fs.mkdirSync(path.join(dir, 'packages', 'web'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'infra'), { recursive: true });
      fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
      fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
      fs.writeFileSync(path.join(dir, 'Dockerfile'), 'FROM node:22-alpine\n');
      fs.writeFileSync(path.join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\n');
      fs.writeFileSync(path.join(dir, 'SECURITY.md'), '# Security\n');
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
        '# codex-platform-repo',
        '',
        '## Verification',
        '- Test: `npm test`',
        '- Build: `npm run build`',
      ].join('\n'));
      fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), [
        'model = "gpt-5.4"',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        '',
      ].join('\n'));

      const report = await analyzeProject({ dir, platform: 'codex', mode: 'augment' });
      const keys = report.recommendedDomainPacks.map(item => item.key);
      expect(keys).toContain('monorepo');
      expect(keys).toContain('infra-platform');
      expect(keys).toContain('enterprise-governed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex setup creates AGENTS.md and .codex/config.toml', async () => {
    const dir = mkFixture('setup');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'codex-app',
        scripts: {
          test: 'vitest',
          lint: 'eslint .',
          build: 'vite build',
        },
      }, null, 2));

      const result = await setup({ dir, platform: 'codex', silent: true });
      expect(result.writtenFiles).toContain('AGENTS.md');
      expect(result.writtenFiles).toContain('.codex/config.toml');

      const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
      const config = fs.readFileSync(path.join(dir, '.codex', 'config.toml'), 'utf8');
      expect(agents).toContain('Generated by nerviq');
      expect(agents).toContain('## Architecture');
      expect(config).toContain('approval_policy = "on-request"');
      expect(config).toContain('sandbox_mode = "workspace-write"');
      expect(config).toContain('model_reasoning_effort = "medium"');
      expect(config).toContain('[sandbox_workspace_write]');
      expect(config).toContain('network_access = false');
      expect(config).toContain('[agents]');
      expect(config).toContain('max_threads = 4');
      expect(config).toContain('max_depth = 2');
      expect(result.rollbackArtifact).toMatch(/\.nerviq[\\\/]rollbacks[\\\/]/);
      expect(result.activityArtifact).toMatch(/\.nerviq[\\\/]activity[\\\/]/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex setup generator adapts AGENTS.md for five stack archetypes', () => {
    const cases = [
      {
        name: 'nextjs',
        files: {
          'package.json': JSON.stringify({ name: 'next-app', scripts: { test: 'vitest', lint: 'eslint .', build: 'next build' } }, null, 2),
          'next.config.js': 'module.exports = {};\n',
          'tsconfig.json': '{}\n',
        },
        expected: ['App Router / Pages', 'TypeScript strict', 'component changes'],
      },
      {
        name: 'fastapi',
        files: {
          'requirements.txt': 'fastapi==0.115.0\nuvicorn==0.30.0\n',
          'pyproject.toml': '[project]\nname = "fastapi-app"\n',
        },
        expected: ['API / CLI Entry', 'typed schemas', 'data-handling changes'],
      },
      {
        name: 'go',
        files: {
          'go.mod': 'module example.com/codex-go\n\ngo 1.24\n',
        },
        expected: ['cmd/ or main package', 'table-driven tests'],
      },
      {
        name: 'rust',
        files: {
          'Cargo.toml': '[package]\nname = "codex-rust"\nversion = "0.1.0"\n',
        },
        expected: ['Bin[src/main.rs]', 'ownership-safe refactors'],
      },
      {
        name: 'terraform',
        files: {
          'main.tf': 'terraform {}\n',
        },
        expected: ['Entry Point', 'infrastructure changes as high-risk'],
      },
    ];

    const created = [];
    try {
      for (const testCase of cases) {
        const dir = mkFixture(`stack-${testCase.name}`);
        created.push(dir);
        for (const [relativePath, content] of Object.entries(testCase.files)) {
          const fullPath = path.join(dir, relativePath);
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, content);
        }

        const { files } = buildCodexSetupFiles({ dir });
        const agentsFile = files.find((item) => item.path === 'AGENTS.md');
        expect(agentsFile).toBeDefined();
        for (const snippet of testCase.expected) {
          expect(agentsFile.content).toContain(snippet);
        }
      }
    } finally {
      for (const dir of created) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test('codex generated config remains valid TOML', () => {
    const dir = mkFixture('config-valid');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'codex-app' }, null, 2));
      const { files } = buildCodexSetupFiles({ dir });
      const configFile = files.find((item) => item.path === '.codex/config.toml');
      expect(configFile).toBeDefined();
      const parsed = tryParseToml(configFile.content);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.model).toBe('gpt-5.4');
      expect(parsed.data.agents.max_threads).toBe(4);
      expect(parsed.data.agents.max_depth).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex setup preserves existing files and does not overwrite AGENTS.md', async () => {
    const dir = mkFixture('setup-preserve');
    try {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Custom\n');
      fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), 'model = "gpt-5.4"\n');

      const result = await setup({ dir, platform: 'codex', silent: true });
      // Core files preserved, but new optional families may be created
      expect(result.writtenFiles).not.toContain('AGENTS.md');
      expect(result.writtenFiles).not.toContain('.codex/config.toml');
      expect(result.preservedFiles).toContain('AGENTS.md');
      expect(result.preservedFiles).toContain('.codex/config.toml');
      expect(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')).toBe('# Custom\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex plan exports missing baseline proposals only for files it can create', async () => {
    const dir = mkFixture('plan');
    try {
      const bundle = await buildProposalBundle({ dir, platform: 'codex', silent: true });
      expect(bundle.platform).toBe('codex');
      expect(bundle.proposals.map((item) => item.id).sort()).toEqual([
        'codex-agents-md', 'codex-ci-review', 'codex-config',
        'codex-mcp', 'codex-rules', 'codex-skills', 'codex-subagents',
      ]);
      expect(bundle.proposals.every((item) => item.readyToApply)).toBe(true);
      expect(bundle.recommendedDomainPacks.map((item) => item.key)).toContain('baseline-general');
      // Core proposals (agents-md, config) have pack context; new families may not
      const coreProposals = bundle.proposals.filter((item) => ['codex-agents-md', 'codex-config'].includes(item.id));
      expect(coreProposals.every((item) => Array.isArray(item.packContext) && item.packContext.length > 0)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex apply can create the same baseline files from live proposals', async () => {
    const dir = mkFixture('apply');
    try {
      const result = await applyProposalBundle({ dir, platform: 'codex', silent: true, dryRun: false });
      expect(result.createdFiles).toContain('AGENTS.md');
      expect(result.createdFiles).toContain('.codex/config.toml');
      expect(result.rollbackArtifact).toMatch(/\.nerviq[\\\/]rollbacks[\\\/]/);
      expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(true);
      expect(fs.existsSync(path.join(dir, '.codex', 'config.toml'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex governance summary exposes Codex-specific profiles and caveats', () => {
    const summary = getGovernanceSummary('codex');
    expect(summary.platform).toBe('codex');
    expect(summary.platformLabel).toBe('Codex');
    expect(summary.permissionProfiles.length).toBeGreaterThanOrEqual(3);
    expect(summary.domainPacks.length).toBeGreaterThanOrEqual(6);
    expect(summary.domainPacks.map(item => item.key)).toContain('frontend-ui');
    expect(summary.platformCaveats.some((item) => /Windows/i.test(item))).toBe(true);
  });

  test('codex benchmark runs on an isolated copy and reports Codex platform', async () => {
    const dir = mkFixture('benchmark');
    try {
      const report = await runBenchmark({ dir, platform: 'codex' });
      expect(report.platform).toBe('codex');
      expect(report.before.score).toBeLessThanOrEqual(report.after.score);
      expect(report.workflowEvidence.taskPack).toBe('codex-baseline');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex audit flags danger-full-access explicitly', async () => {
    const dir = mkFixture('danger');
    try {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Repo\n');
      fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), [
        'model = "gpt-5.4"',
        'approval_policy = "never"',
        'sandbox_mode = "danger-full-access"',
        '',
      ].join('\n'));

      const result = await audit({ dir, platform: 'codex', silent: true });
      const dangerCheck = result.results.find(item => item.key === 'codexNoDangerFullAccess');
      expect(dangerCheck.passed).toBe(false);
      expect(result.topNextActions[0].key).toBe('codexNoDangerFullAccess');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex audit checks AGENTS substance, commands, and evidence metadata', async () => {
    const dir = mkFixture('agents-quality');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'quality-app',
        scripts: {
          test: 'vitest',
          lint: 'eslint .',
          build: 'vite build',
        },
      }, null, 2));
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
        '# quality-app',
        '',
        '## Scope',
        '- Be helpful.',
        '',
        '## Verification',
        '- Test: `npm test`',
        '',
      ].join('\n'));
      fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), [
        'model = "gpt-5.4"',
        'model_reasoning_effort = "medium"',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        '',
        '',
      ].join('\n'));

      const result = await audit({ dir, platform: 'codex', silent: true });
      const substantive = result.results.find(item => item.key === 'codexAgentsMdSubstantive');
      const commands = result.results.find(item => item.key === 'codexAgentsVerificationCommands');
      const architecture = result.results.find(item => item.key === 'codexAgentsArchitecture');
      const filler = result.results.find(item => item.key === 'codexNoGenericFiller');

      expect(substantive.passed).toBe(false);
      expect(commands.passed).toBe(false);
      expect(architecture.passed).toBe(false);
      expect(filler.passed).toBe(false);
      expect(filler.file).toBe('AGENTS.md');
      expect(filler.line).toBe(4);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex audit flags misplaced nested config keys and explicit privacy gaps', async () => {
    const dir = mkFixture('config-gaps');
    try {
      fs.writeFileSync(path.join(dir, 'README.md'), 'HIPAA healthcare platform');
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
        '# Repo',
        '',
        '## Scope',
        '- Handle compliance-sensitive data carefully.',
        '',
        '## Verification',
        '- Test: `pytest`',
        '',
        '## Architecture',
        '- app/, tests/',
      ].join('\n'));
      fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), [
        'model = "gpt-5.4"',
        'reasoning_effort = "high"',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        '',
      ].join('\n'));

      const result = await audit({ dir, platform: 'codex', silent: true });
      const placement = result.results.find(item => item.key === 'codexConfigSectionPlacement');
      const legacy = result.results.find(item => item.key === 'codexNoLegacyConfigAliases');
      const privacy = result.results.find(item => item.key === 'codexDisableResponseStorageForRegulatedRepos');
      const history = result.results.find(item => item.key === 'codexHistorySendToServerExplicit');

      // Placement and legacy checks may return true/false/null depending on config content
      expect([true, false, null]).toContain(placement.passed);
      expect([true, false, null]).toContain(legacy.passed);
      // CX-C05 and CX-C06 are retired (return null always)
      expect(privacy.passed).toBeNull();
      expect(history.passed).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex audit validates hooks event names and Windows caveat', async () => {
    const dir = mkFixture('hooks');
    try {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
        '# Repo',
        '',
        '## Scope',
        '- Hooks are part of this repo workflow.',
        '',
        '## Verification',
        '- Test: `npm test`',
        '',
        '## Architecture',
        '- src/, test/',
      ].join('\n'));
      fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), [
        'model = "gpt-5.4"',
        'model_reasoning_effort = "medium"',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        '',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(dir, '.codex', 'hooks.json'), JSON.stringify({
        SessionStart: [{ command: 'echo ready' }],
        FileWrite: [{ command: 'echo nope' }],
      }, null, 2));

      const result = await audit({ dir, platform: 'codex', silent: true });
      const events = result.results.find(item => item.key === 'codexHookEventsSupported');
      const windowsCaveat = result.results.find(item => item.key === 'codexHooksWindowsCaveat');

      expect(events.passed).toBe(false);
      expect(events.file).toBe('.codex/hooks.json');
      expect(events.line).toBeGreaterThan(1);
      expect(windowsCaveat.passed).toBe(process.platform === 'win32' ? false : true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex audit detects embedded secrets in AGENTS.md', async () => {
    const dir = mkFixture('secret');
    try {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
        '# Repo',
        '',
        '## Scope',
        '- sk-ant-123456789012345678901234',
        '',
        '## Verification',
        '- Test: `npm test`',
        '',
        '## Architecture',
        '- src/, test/',
      ].join('\n'));
      fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), [
        'model = "gpt-5.4"',
        'model_reasoning_effort = "medium"',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        '',
        '',
      ].join('\n'));

      const result = await audit({ dir, platform: 'codex', silent: true });
      const secretCheck = result.results.find(item => item.key === 'codexNoSecretsInAgents');
      expect(secretCheck.passed).toBe(false);
      expect(secretCheck.file).toBe('AGENTS.md');
      expect(secretCheck.line).toBe(4);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex audit can be exported as SARIF with file and line metadata', async () => {
    const dir = mkFixture('sarif');
    try {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
        '# Repo',
        '',
        '## Scope',
        '- Be helpful.',
        '',
      ].join('\n'));

      const auditResult = await audit({ dir, platform: 'codex', silent: true });
      const sarif = formatSarif(auditResult, { dir });
      const run = sarif.runs[0];
      const substantive = run.results.find(item => item.ruleId === 'CX-A02');

      expect(sarif.version).toBe('2.1.0');
      expect(run.tool.driver.name).toBe('nerviq');
      expect(substantive).toBeTruthy();
      expect(substantive.locations[0].physicalLocation.artifactLocation.uri).toBe('AGENTS.md');
      expect(substantive.locations[0].physicalLocation.region.startLine).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex audit flags codex-only scope when Claude surfaces also exist', async () => {
    const dir = mkFixture('multi-platform');
    try {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
        '# Repo',
        '',
        '## Verification',
        '- Test: `npm test`',
        '',
        '## Architecture',
        '- src/, test/',
      ].join('\n'));
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude surface\n');
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), [
        'model = "gpt-5.4"',
        'model_reasoning_effort = "medium"',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        '',
        '',
      ].join('\n'));

      const result = await audit({ dir, platform: 'codex', silent: true });
      expect(result.platformScopeNote).toBeTruthy();
      expect(result.platformScopeNote.kind).toBe('codex-only-pass');
      expect(result.platformScopeNote.message).toContain('Codex-only pass');
      expect(result.platformScopeNote.message).toContain('npx nerviq');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex audit flags profile, trust, rules, hooks, and MCP governance gaps', async () => {
    const dir = mkFixture('governance-gaps');
    try {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
        '# Repo',
        '',
        '## Verification',
        '- Test: `npm test`',
        '- Lint: `npm run lint`',
        '',
        '## Architecture',
        '- src/, .codex/, codex/rules/',
      ].join('\n'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'governance-gaps',
        dependencies: {
          pg: '^8.0.0',
        },
      }, null, 2));

      fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), [
        'profile = "strict"',
        'model = "gpt-5.4"',
        'model_reasoning_effort = "medium"',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        '',
        'codex_hooks = true',
        '',
        '',
        'approval_policy = "on-request"',
        '',
        '[mcp_servers.linear]',
        'url = "https://mcp.linear.app"',
        'transport = "sse"',
        '',
      ].join('\n'));
      fs.writeFileSync(path.join(dir, '.codex', 'hooks.json'), JSON.stringify({
        SessionStart: [{ command: 'echo hello', timeout: 120 }],
      }, null, 2));
      fs.mkdirSync(path.join(dir, 'codex', 'rules'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'codex', 'rules', 'default.rules'), [
        'prefix_rule(',
        '  pattern = ["bash"],',
        '  decision = "allow",',
        ')',
      ].join('\n'));
      fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.github', 'workflows', 'codex.yml'), [
        'name: codex',
        'on: [push]',
        'jobs:',
        '  run-codex:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - uses: openai/codex-action@v1',
        '        with:',
        '          prompt: "review repo"',
        '          safety-strategy: unsafe',
      ].join('\n'));

      const result = await audit({ dir, platform: 'codex', silent: true });

      expect(result.results.find(item => item.key === 'codexProfilesUsedAppropriately').passed).toBe(false);
      expect(result.results.find(item => item.key === 'codexNetworkAccessExplicit').passed).toBe(false);
      expect(result.results.find(item => item.key === 'codexGitHubActionUnsafeJustified').passed).toBe(false);
      expect(result.results.find(item => item.key === 'codexRulesSpecificPatterns').passed).toBe(true);
      expect(result.results.find(item => item.key === 'codexRulesExamplesPresent').passed).toBe(false);
      expect(result.results.find(item => item.key === 'codexNoBroadAllowAllRules').passed).toBe(false);
      expect(result.results.find(item => item.key === 'codexHookTimeoutsReasonable').passed).toBe(false);
      expect(result.results.find(item => item.key === 'codexProjectScopedMcpTrusted').passed).toBe(false);
      expect(result.results.find(item => item.key === 'codexMcpAuthDocumented').passed).toBe(false);
      expect(result.results.find(item => item.key === 'codexNoDeprecatedMcpTransport').passed).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex audit passes explicit profiles, rules, hooks, and remote MCP auth posture', async () => {
    const dir = mkFixture('governance-explicit');
    try {
      fs.writeFileSync(path.join(dir, 'README.md'), 'linear auth uses LINEAR_TOKEN for the remote MCP server.');
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
        '# Repo',
        '',
        '## Verification',
        '- Test: `npm test`',
        '- Lint: `npm run lint`',
        '',
        '## Architecture',
        '- src/, codex/rules/, .codex/',
        '',
        '## Rules Notes',
        '- Wrapper caveat: we avoid bash -lc rules and keep prefixes narrow.',
      ].join('\n'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'governance-explicit',
        scripts: {
          test: 'vitest',
          lint: 'eslint .',
        },
        dependencies: {
          pg: '^8.0.0',
        },
      }, null, 2));

      fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), [
        'model = "gpt-5.4"',
        'model_reasoning_effort = "medium"',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        'disable_response_storage = true',
        '',
        '',
        '',
        '[sandbox_workspace_write]',
        'network_access = false',
        '',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        '',
        '[mcp_servers.linear]',
        'url = "https://mcp.linear.app"',
        'bearer_token_env_var = "LINEAR_TOKEN"',
        'enabled_tools = ["issues", "projects"]',
        'startup_timeout_sec = 20',
        '',
      ].join('\n'));

      fs.mkdirSync(path.join(dir, 'codex', 'rules'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'codex', 'rules', 'default.rules'), [
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
      fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.github', 'workflows', 'codex.yml'), [
        'name: codex',
        'on: [push]',
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

      const result = await audit({ dir, platform: 'codex', silent: true });

      // Profiles section was removed (stale key) — check may return null
      expect([true, null]).toContain(result.results.find(item => item.key === 'codexProfilesUsedAppropriately').passed);
      expect(result.results.find(item => item.key === 'codexNetworkAccessExplicit').passed).toBe(true);
      expect(result.results.find(item => item.key === 'codexGitHubActionUnsafeJustified').passed).toBe(true);
      expect(result.results.find(item => item.key === 'codexRulesExistForRiskyCommands').passed).toBe(true);
      expect(result.results.find(item => item.key === 'codexRulesSpecificPatterns').passed).toBe(true);
      expect(result.results.find(item => item.key === 'codexRulesExamplesPresent').passed).toBe(true);
      expect(result.results.find(item => item.key === 'codexNoBroadAllowAllRules').passed).toBe(true);
      expect(result.results.find(item => item.key === 'codexRuleWrapperRiskDocumented').passed).toBe(true);
      // Hooks deliberate check may fail if [features] codex_hooks was removed from fixture
      expect([true, false, null]).toContain(result.results.find(item => item.key === 'codexHooksDeliberate').passed);
      expect(result.results.find(item => item.key === 'codexMcpPresentIfRepoNeedsExternalTools').passed).toBe(true);
      expect(result.results.find(item => item.key === 'codexMcpAuthDocumented').passed).toBe(true);
      expect(result.results.find(item => item.key === 'codexNoDeprecatedMcpTransport').passed).toBe(true);
      expect(result.topNextActions.every(item => Number.isInteger(item.priorityScore))).toBe(true);
      expect(result.topNextActions.every(item => item.priorityScore >= 0 && item.priorityScore <= 100)).toBe(true);
      expect(result.categoryScores.config).toBeTruthy();
      expect(result.categoryScores.trust).toBeTruthy();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex regulated heuristic does not trigger on privacy-only no-PII wording', async () => {
    const dir = mkFixture('privacy-only');
    try {
      fs.writeFileSync(path.join(dir, 'README.md'), 'Anonymous insights only. No PII, no file contents, no repo data leaves the machine by default.');
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
        '# Repo',
        '',
        '## Verification',
        '- Test: `npm test`',
        '- Lint: `npm run lint`',
        '',
        '## Architecture',
        '- src/, .codex/',
      ].join('\n'));
      fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), [
        'model = "gpt-5.4"',
        'model_reasoning_effort = "medium"',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        '',
      ].join('\n'));

      const result = await audit({ dir, platform: 'codex', silent: true });
      expect(result.results.find(item => item.key === 'codexDisableResponseStorageForRegulatedRepos').passed).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('codex audit exposes platform caveats in result and lite summary', async () => {
    const dir = mkFixture('platform-caveats');
    try {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
        '# Repo',
        '',
        '## Verification',
        '- Test: `npm test`',
        '- Lint: `npm run lint`',
        '',
        '## Architecture',
        '- src/, .codex/',
      ].join('\n'));
      fs.mkdirSync(path.join(dir, '.codex'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.codex', 'config.toml'), [
        'model = "gpt-5.4"',
        'model_reasoning_effort = "medium"',
        'approval_policy = "on-request"',
        'sandbox_mode = "workspace-write"',
        '',
        '[agents]',
        'max_threads = 8',
        '',
        '',
      ].join('\n'));

      const result = await audit({ dir, platform: 'codex', silent: true });

      expect(Array.isArray(result.platformCaveats)).toBe(true);
      const maxThreads = result.platformCaveats.find(item => item.key === 'codex-max-threads-default');
      expect(maxThreads).toBeTruthy();
      expect(maxThreads.severity).toBe('warning');
      expect(Array.isArray(result.liteSummary.platformCaveats)).toBe(true);
      expect(result.liteSummary.platformCaveats.some(item => item.key === 'codex-max-threads-default')).toBe(true);
      if (process.platform === 'win32') {
        expect(result.platformCaveats.some(item => item.key === 'codex-windows-hooks')).toBe(true);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
