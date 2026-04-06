const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { audit } = require('../src/audit');
const { setup } = require('../src/setup');
const { analyzeProject } = require('../src/analyze');
const { getGeminiGovernanceSummary } = require('../src/gemini/governance');
const { buildGeminiSetupFiles } = require('../src/gemini/setup');
const { buildGeminiProposalBundle } = require('../src/gemini/plans');
const { GEMINI_TECHNIQUES } = require('../src/gemini/techniques');
const { GeminiProjectContext } = require('../src/gemini/context');
const { detectGeminiDomainPacks, GEMINI_DOMAIN_PACKS } = require('../src/gemini/domain-packs');
const { recommendGeminiMcpPacks, GEMINI_MCP_PACKS } = require('../src/gemini/mcp-packs');
const {
  buildEmptyRepo,
  buildRichGeminiRepo,
  buildThinGeminiMdRepo,
  buildYoloRepo,
  buildAutoEditRepo,
} = require('./gemini-fixtures');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-gemini-${name}-`));
}

describe('Gemini audit + setup', () => {
  test('gemini v1.2 exposes the full 300-check catalog after adding Python/Go/Rust/Java + Ruby/DotNet/PHP + Flutter/Swift/Kotlin stack checks', () => {
    expect(Object.keys(GEMINI_TECHNIQUES)).toHaveLength(300);
  });

  test('gemini audit identifies missing GEMINI.md and settings', async () => {
    const dir = mkFixture('empty');
    try {
      const result = await audit({ dir, platform: 'gemini', silent: true });
      expect(result.platform).toBe('gemini');
      const failedKeys = result.results.filter(item => item.passed === false).map(item => item.key);
      expect(failedKeys).toContain('geminiMdExists');
      expect(failedKeys).toContain('geminiSettingsExists');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('gemini audit passes on a rich repo', async () => {
    const scenario = buildRichGeminiRepo();
    try {
      const result = await audit({ dir: scenario.dir, platform: 'gemini', silent: true });
      expect(result.platform).toBe('gemini');
      expect(result.score).toBeGreaterThan(60);
      const passedKeys = result.results.filter(item => item.passed === true).map(item => item.key);
      expect(passedKeys).toContain('geminiMdExists');
      expect(passedKeys).toContain('geminiSettingsExists');
      expect(passedKeys).toContain('geminiSettingsValidJson');
      expect(passedKeys).toContain('geminiNoYolo');
      expect(passedKeys).toContain('geminiMcpConfigured');
      expect(passedKeys).toContain('geminiMcpExcludeTools');
    } finally {
      fs.rmSync(scenario.dir, { recursive: true, force: true });
    }
  });

  test('gemini audit detects --yolo as critical risk', async () => {
    const scenario = buildYoloRepo();
    try {
      const result = await audit({ dir: scenario.dir, platform: 'gemini', silent: true });
      const yoloCheck = result.results.find(item => item.key === 'geminiNoYolo');
      expect(yoloCheck.passed).toBe(false);
    } finally {
      fs.rmSync(scenario.dir, { recursive: true, force: true });
    }
  });

  test('gemini audit detects code deletion risk on auto_edit', async () => {
    const scenario = buildAutoEditRepo();
    try {
      const result = await audit({ dir: scenario.dir, platform: 'gemini', silent: true });
      const autoEditCheck = result.results.find(item => item.key === 'geminiAutoEditCodeDeletionRisk');
      expect(autoEditCheck.passed).toBe(false);
    } finally {
      fs.rmSync(scenario.dir, { recursive: true, force: true });
    }
  });

  test('gemini setup preserves existing files', async () => {
    const dir = mkFixture('setup-preserve');
    try {
      fs.writeFileSync(path.join(dir, 'GEMINI.md'), '# Custom\n');
      fs.mkdirSync(path.join(dir, '.gemini'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.gemini', 'settings.json'), '{"model":"gemini-2.5-pro"}\n');

      const result = await setup({ dir, platform: 'gemini', silent: true });
      expect(result.writtenFiles).not.toContain('GEMINI.md');
      expect(result.writtenFiles).not.toContain('.gemini/settings.json');
      expect(fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8')).toBe('# Custom\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('gemini plan exports correct proposal families', async () => {
    const dir = mkFixture('plan');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'plan-test' }, null, 2));
      const bundle = await buildGeminiProposalBundle({ dir, silent: true });
      expect(bundle.proposals.length).toBe(9);
      const ids = bundle.proposals.map(item => item.id).sort();
      expect(ids).toEqual([
        'gemini-agents', 'gemini-ci-review', 'gemini-commands',
        'gemini-hooks', 'gemini-mcp', 'gemini-md',
        'gemini-policy', 'gemini-settings', 'gemini-skills',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('gemini domain packs detect correctly', () => {
    const dir = mkFixture('domain-detect');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'frontend-app',
        dependencies: { react: '19', next: '16' },
        scripts: { test: 'vitest' },
      }, null, 2));
      fs.writeFileSync(path.join(dir, 'next.config.js'), 'module.exports = {};\n');

      const ctx = new GeminiProjectContext(dir);
      const packs = detectGeminiDomainPacks(ctx);
      expect(packs.length).toBeGreaterThanOrEqual(1);
      expect(packs.map(p => p.key)).toContain('baseline-general');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('gemini MCP packs recommend for frontend', () => {
    const dir = mkFixture('mcp-frontend');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'frontend-app',
        dependencies: { react: '19', next: '16' },
      }, null, 2));

      const ctx = new GeminiProjectContext(dir);
      const stacks = [{ key: 'react' }, { key: 'nextjs' }];
      const domainPacks = detectGeminiDomainPacks(ctx);
      const packs = recommendGeminiMcpPacks(stacks, domainPacks, { ctx });
      const keys = packs.map(p => p.key);
      expect(keys).toContain('context7-docs');
      expect(keys).toContain('playwright-mcp');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('gemini governance summary has correct counts', () => {
    const summary = getGeminiGovernanceSummary();
    expect(summary.platform).toBe('gemini');
    expect(summary.platformLabel).toBe('Gemini CLI');
    expect(summary.permissionProfiles).toHaveLength(6);
    expect(summary.hookRegistry).toHaveLength(7);
    expect(summary.policyPacks).toHaveLength(5);
    expect(summary.mcpPacks).toHaveLength(49);
    expect(summary.domainPacks).toHaveLength(62);
    expect(summary.platformCaveats.some(item => /yolo/i.test(item))).toBe(true);
  });

  test('gemini modules all load without errors', () => {
    const modules = [
      '../src/gemini/activity',
      '../src/gemini/config-parser',
      '../src/gemini/context',
      '../src/gemini/deep-review',
      '../src/gemini/domain-packs',
      '../src/gemini/freshness',
      '../src/gemini/governance',
      '../src/gemini/interactive',
      '../src/gemini/mcp-packs',
      '../src/gemini/patch',
      '../src/gemini/plans',
      '../src/gemini/premium',
      '../src/gemini/setup',
      '../src/gemini/techniques',
    ];
    expect(modules).toHaveLength(14);
    for (const mod of modules) {
      expect(() => require(mod)).not.toThrow();
    }
  });
});
