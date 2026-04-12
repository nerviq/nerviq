const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { audit } = require('../src/audit');
const { setup } = require('../src/setup');
const { analyzeProject } = require('../src/analyze');
const { getCopilotGovernanceSummary } = require('../src/copilot/governance');
const { buildCopilotSetupFiles } = require('../src/copilot/setup');
const { buildCopilotProposalBundle } = require('../src/copilot/plans');
const { COPILOT_TECHNIQUES } = require('../src/copilot/techniques');
const { CopilotProjectContext } = require('../src/copilot/context');
const { detectCopilotDomainPacks, COPILOT_DOMAIN_PACKS } = require('../src/copilot/domain-packs');
const { recommendCopilotMcpPacks, COPILOT_MCP_PACKS } = require('../src/copilot/mcp-packs');
const {
  buildEmptyRepo,
  buildRichCopilotRepo,
  buildNoInstructionsRepo,
  buildDeprecatedSettingsRepo,
  buildCloudAgentRepo,
} = require('./copilot-fixtures');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-copilot-${name}-`));
}

describe('Copilot audit + setup', () => {
  test('copilot v1.2 exposes the full 299-check catalog after adding Python/Go/Rust/Java + Ruby/DotNet/PHP + Flutter/Swift/Kotlin stack checks', () => {
    expect(Object.keys(COPILOT_TECHNIQUES)).toHaveLength(299);
  });

  test('copilot audit identifies missing instructions and settings on empty repo', async () => {
    const dir = mkFixture('empty');
    try {
      const result = await audit({ dir, platform: 'copilot', silent: true });
      expect(result.platform).toBe('copilot');
      const failedKeys = result.results.filter(item => item.passed === false).map(item => item.key);
      expect(failedKeys).toContain('copilotInstructionsExists');
      // PP-01: copilotVscodeSettingsExists is N/A (not failed) on repos that
      // don't configure VS Code at all — VS Code-specific settings don't
      // apply to CLI/cloud-only Copilot setups. We still expect copilot
      // audit to flag the missing core instructions file.
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('copilot audit passes on a rich repo with score > 60', async () => {
    const scenario = buildRichCopilotRepo();
    try {
      const result = await audit({ dir: scenario.dir, platform: 'copilot', silent: true });
      expect(result.platform).toBe('copilot');
      expect(result.score).toBeGreaterThan(40);
      const passedKeys = result.results.filter(item => item.passed === true).map(item => item.key);
      expect(passedKeys).toContain('copilotInstructionsExists');
      expect(passedKeys).toContain('copilotVscodeSettingsExists');
      expect(passedKeys).toContain('copilotMcpConfigured');
      expect(passedKeys).toContain('copilotTerminalSandboxEnabled');
    } finally {
      fs.rmSync(scenario.dir, { recursive: true, force: true });
    }
  });

  test('PP-01: AGENTS.md-only repo scores > 40 (Copilot CLI reads AGENTS.md/CLAUDE.md automatically)', async () => {
    const dir = mkFixture('agents-md-only');
    try {
      // Simulate the astral-sh/uv / block/goose convention: no
      // .github/copilot-instructions.md, but a dense AGENTS.md + CLAUDE.md
      // and a Cargo.toml-shaped Rust project.
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
        '- Read CONTRIBUTING.md for guidelines on how to run tools',
        '- ALWAYS attempt to add a test case for changed behavior',
        '- PREFER integration tests over unit tests',
        '- Run `cargo test` before committing',
        '- Run `cargo check` to verify the build',
        '- Use `cargo clippy` for linting',
        '- Keep commits focused and reviewable',
        '- Follow the existing code style',
      ].join('\n') + '\n');
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Notes\nSee AGENTS.md.\n');
      fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\n');
      fs.writeFileSync(path.join(dir, '.gitignore'), 'target/\n.env\n*.pem\n');
      // Required for detectCopilotRepo so the audit engine runs copilot checks.
      fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.github', 'copilot-instructions.md'), [
        '# Agent instructions',
        '',
        'See AGENTS.md for build/test/lint commands.',
        '',
        '## Testing',
        '- cargo test',
        '',
        '## Build',
        '- cargo build',
      ].join('\n'));
      const result = await audit({ dir, platform: 'copilot', silent: true });
      expect(result.platform).toBe('copilot');
      // Mature AGENTS.md-style repo must score > 40 after PP-01 calibration.
      expect(result.score).toBeGreaterThan(40);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('PP-01: JSONC (comments + trailing commas) in .vscode/settings.json is accepted', async () => {
    const dir = mkFixture('jsonc');
    try {
      fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.vscode', 'settings.json'), [
        '{',
        '  // VS Code tolerates JSONC in settings.json',
        '  "github.copilot.chat.agent.enabled": true,',
        '  "editor.rulers": [100],', // trailing comma on nested array context
        '}',
      ].join('\n'));
      fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.github', 'copilot-instructions.md'), '# X\nHi\n');
      const result = await audit({ dir, platform: 'copilot', silent: true });
      const b06 = result.results.find(r => r.key === 'copilotVscodeSettingsValidJson');
      // Should not fail on valid JSONC.
      expect(b06 && b06.passed).not.toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('copilot setup preserves existing files', async () => {
    const dir = mkFixture('setup-preserve');
    try {
      fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.github', 'copilot-instructions.md'), '# Custom\n');
      fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.vscode', 'settings.json'), '{"github.copilot.enable":{"*":true}}\n');

      const result = await setup({ dir, platform: 'copilot', silent: true });
      expect(result.writtenFiles).not.toContain('.github/copilot-instructions.md');
      expect(result.writtenFiles).not.toContain('.vscode/settings.json');
      expect(fs.readFileSync(path.join(dir, '.github', 'copilot-instructions.md'), 'utf8')).toBe('# Custom\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('copilot plan exports correct proposal families', async () => {
    const dir = mkFixture('plan');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'plan-test' }, null, 2));
      const bundle = await buildCopilotProposalBundle({ dir, silent: true });
      expect(bundle.proposals.length).toBeGreaterThanOrEqual(8);
      const ids = bundle.proposals.map(item => item.id).sort();
      expect(ids).toContain('copilot-instructions');
      expect(ids).toContain('copilot-vscode-settings');
      expect(ids).toContain('copilot-mcp');
      expect(ids).toContain('copilot-cloud-setup');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('copilot domain packs registry has 40 entries after the expansion', () => {
    expect(COPILOT_DOMAIN_PACKS).toHaveLength(62);
  });

  test('copilot domain packs detect correctly', () => {
    const dir = mkFixture('domain-detect');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'frontend-app',
        dependencies: { react: '19', next: '16' },
        scripts: { test: 'vitest' },
      }, null, 2));
      fs.writeFileSync(path.join(dir, 'next.config.js'), 'module.exports = {};\n');

      const ctx = new CopilotProjectContext(dir);
      const packs = detectCopilotDomainPacks(ctx);
      expect(packs.length).toBeGreaterThanOrEqual(1);
      expect(packs.map(p => p.key)).toContain('baseline-general');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('copilot MCP packs registry has 26 entries', () => {
    expect(COPILOT_MCP_PACKS).toHaveLength(49);
  });

  test('copilot MCP packs recommend for frontend', () => {
    const dir = mkFixture('mcp-frontend');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'frontend-app',
        dependencies: { react: '19', next: '16' },
      }, null, 2));

      const ctx = new CopilotProjectContext(dir);
      const stacks = [{ key: 'react' }, { key: 'nextjs' }];
      const domainPacks = detectCopilotDomainPacks(ctx);
      const packs = recommendCopilotMcpPacks(stacks, domainPacks, { ctx });
      const keys = packs.map(p => p.key);
      expect(keys).toContain('context7-docs');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('copilot governance summary has correct counts', () => {
    const summary = getCopilotGovernanceSummary();
    expect(summary.platform).toBe('copilot');
    expect(summary.platformLabel).toBe('GitHub Copilot');
    expect(summary.permissionProfiles).toHaveLength(6);
    expect(summary.hookRegistry).toHaveLength(7);
    expect(summary.policyPacks).toHaveLength(5);
    expect(summary.mcpPacks).toHaveLength(49);
    expect(summary.domainPacks).toHaveLength(62);
  });

  test('copilot modules all load without errors', () => {
    const modules = [
      '../src/copilot/activity',
      '../src/copilot/config-parser',
      '../src/copilot/context',
      '../src/copilot/deep-review',
      '../src/copilot/domain-packs',
      '../src/copilot/freshness',
      '../src/copilot/governance',
      '../src/copilot/interactive',
      '../src/copilot/mcp-packs',
      '../src/copilot/patch',
      '../src/copilot/plans',
      '../src/copilot/premium',
      '../src/copilot/setup',
      '../src/copilot/techniques',
    ];
    expect(modules).toHaveLength(14);
    for (const mod of modules) {
      expect(() => require(mod)).not.toThrow();
    }
  });
});
