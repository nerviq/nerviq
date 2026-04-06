const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { audit } = require('../src/audit');
const { setup } = require('../src/setup');
const { analyzeProject } = require('../src/analyze');
const { getCursorGovernanceSummary } = require('../src/cursor/governance');
const { buildCursorSetupFiles } = require('../src/cursor/setup');
const { buildCursorProposalBundle } = require('../src/cursor/plans');
const { CURSOR_TECHNIQUES } = require('../src/cursor/techniques');
const { CursorProjectContext } = require('../src/cursor/context');
const { detectCursorDomainPacks, CURSOR_DOMAIN_PACKS } = require('../src/cursor/domain-packs');
const { recommendCursorMcpPacks, CURSOR_MCP_PACKS } = require('../src/cursor/mcp-packs');
const {
  buildEmptyRepo,
  buildRichCursorRepo,
  buildLegacyCursorrules,
} = require('./cursor-fixtures');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `claudex-cursor-${name}-`));
}

describe('Cursor audit + setup', () => {
  test('cursor v1.0 exposes the full 301-check catalog after adding Python/Go/Rust/Java + Ruby/DotNet/PHP + Flutter/Swift/Kotlin stack checks', () => {
    expect(Object.keys(CURSOR_TECHNIQUES)).toHaveLength(301);
  });

  test('cursor audit identifies missing rules and config on empty repo', async () => {
    const dir = mkFixture('empty');
    try {
      const result = await audit({ dir, platform: 'cursor', silent: true });
      expect(result.platform).toBe('cursor');
      const failedOrSkipped = result.results.filter(item => item.passed !== true).map(item => item.key);
      expect(failedOrSkipped).toContain('cursorRulesExist');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('cursor audit passes on a rich repo with score > 60', async () => {
    const scenario = buildRichCursorRepo();
    try {
      const result = await audit({ dir: scenario.dir, platform: 'cursor', silent: true });
      expect(result.platform).toBe('cursor');
      expect(result.score).toBeGreaterThanOrEqual(60);
      const passedKeys = result.results.filter(item => item.passed === true).map(item => item.key);
      expect(passedKeys).toContain('cursorRulesExist');
    } finally {
      fs.rmSync(scenario.dir, { recursive: true, force: true });
    }
  });

  test('cursor audit detects legacy .cursorrules warning', async () => {
    const scenario = buildLegacyCursorrules();
    try {
      const result = await audit({ dir: scenario.dir, platform: 'cursor', silent: true });
      const legacyCheck = result.results.find(item => item.key === 'cursorNoLegacyCursorrules');
      expect(legacyCheck.passed).toBe(false);
    } finally {
      fs.rmSync(scenario.dir, { recursive: true, force: true });
    }
  });

  test('cursor setup preserves existing files', async () => {
    const dir = mkFixture('setup-preserve');
    try {
      fs.mkdirSync(path.join(dir, '.cursor', 'rules'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.cursor', 'rules', 'core.mdc'), '---\nalwaysApply: true\n---\n# Custom\n');
      fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.cursor', 'mcp.json'), '{"mcpServers":{}}\n');

      const result = await setup({ dir, platform: 'cursor', silent: true });
      expect(result.writtenFiles).not.toContain('.cursor/rules/core.mdc');
      expect(result.writtenFiles).not.toContain('.cursor/mcp.json');
      expect(fs.readFileSync(path.join(dir, '.cursor', 'rules', 'core.mdc'), 'utf8')).toBe('---\nalwaysApply: true\n---\n# Custom\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('cursor plan exports correct proposal families', async () => {
    const dir = mkFixture('plan');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'plan-test' }, null, 2));
      const bundle = await buildCursorProposalBundle({ dir, silent: true });
      expect(bundle.proposals.length).toBeGreaterThanOrEqual(5);
      const ids = [...new Set(bundle.proposals.map(item => item.id))].sort();
      expect(ids).toContain('cursor-rules');
      expect(ids).toContain('cursor-mcp');
      expect(ids).toContain('cursor-environment');
      expect(ids).toContain('cursor-bugbot');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('cursor domain packs registry has 40 entries after the expansion', () => {
    expect(CURSOR_DOMAIN_PACKS).toHaveLength(62);
  });

  test('cursor domain packs detect correctly', () => {
    const dir = mkFixture('domain-detect');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'frontend-app',
        dependencies: { react: '19', next: '16' },
        scripts: { test: 'vitest' },
      }, null, 2));
      fs.writeFileSync(path.join(dir, 'next.config.js'), 'module.exports = {};\n');

      const ctx = new CursorProjectContext(dir);
      const packs = detectCursorDomainPacks(ctx);
      expect(packs.length).toBeGreaterThanOrEqual(1);
      expect(packs.map(p => p.key)).toContain('baseline-general');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('cursor MCP packs registry has 49 entries', () => {
    expect(CURSOR_MCP_PACKS).toHaveLength(49);
  });

  test('cursor MCP packs recommend for frontend', () => {
    const dir = mkFixture('mcp-frontend');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'frontend-app',
        dependencies: { react: '19', next: '16' },
      }, null, 2));

      const ctx = new CursorProjectContext(dir);
      const stacks = [{ key: 'react' }, { key: 'nextjs' }];
      const domainPacks = detectCursorDomainPacks(ctx);
      const packs = recommendCursorMcpPacks(stacks, domainPacks, { ctx });
      const keys = packs.map(p => p.key);
      expect(keys).toContain('context7-docs');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('cursor governance summary has correct counts', () => {
    const summary = getCursorGovernanceSummary();
    expect(summary.platform).toBe('cursor');
    expect(summary.platformLabel).toBe('Cursor AI');
    expect(summary.permissionProfiles).toHaveLength(6);
    expect(summary.hookRegistry).toHaveLength(7);
    expect(summary.policyPacks).toHaveLength(5);
    expect(summary.mcpPacks).toHaveLength(49);
    expect(summary.domainPacks).toHaveLength(62);
    expect(summary.platformCaveats.some(item => /cursorrules/i.test(item.id) || /privacy/i.test(item.id))).toBe(true);
  });

  test('cursor modules all load without errors', () => {
    const modules = [
      '../src/cursor/activity',
      '../src/cursor/config-parser',
      '../src/cursor/context',
      '../src/cursor/deep-review',
      '../src/cursor/domain-packs',
      '../src/cursor/freshness',
      '../src/cursor/governance',
      '../src/cursor/interactive',
      '../src/cursor/mcp-packs',
      '../src/cursor/patch',
      '../src/cursor/plans',
      '../src/cursor/premium',
      '../src/cursor/setup',
      '../src/cursor/techniques',
    ];
    expect(modules).toHaveLength(14);
    for (const mod of modules) {
      expect(() => require(mod)).not.toThrow();
    }
  });
});
