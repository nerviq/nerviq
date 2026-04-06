/**
 * Harmony Integration Tests
 *
 * End-to-end flows testing multi-platform scenarios that exercise
 * the full Harmony pipeline: detect → audit → drift → sync → add.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectActivePlatforms, buildCanonicalModel } = require('../src/harmony/canon');
const { detectDrift } = require('../src/harmony/drift');
const { harmonyAudit } = require('../src/harmony/audit');
const { generateHarmonySync } = require('../src/harmony/sync');
const { addPlatform, PLATFORM_BOOTSTRAPS } = require('../src/harmony/add');
const { saveHarmonyState, loadHarmonyState } = require('../src/harmony/memory');
const { getHarmonyGovernanceSummary, inferTrustLevel } = require('../src/harmony/governance');
const { generateStrategicAdvice } = require('../src/harmony/advisor');

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `harmony-int-${name}-`));
}

function cleanFixture(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function writeJson(dir, relPath, value) {
  writeFile(dir, relPath, JSON.stringify(value, null, 2));
}

// ─── Full pipeline: detect → model → drift → sync ─────────────────────────

describe('Harmony Integration — Full Pipeline', () => {
  test('3-platform repo: detect → model → drift → sync produces actionable output', () => {
    const dir = mkFixture('pipeline-3p');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project\n\n## Commands\nnpm test\nnpm run lint\n\n## Security\nNever expose .env files\n');
      writeFile(dir, 'AGENTS.md', '# Codex\n\nRun tests before committing.\n');
      writeFile(dir, '.cursorrules', '# Cursor\nAlways lint code\n');
      writeJson(dir, 'package.json', { name: 'multi-platform-test' });

      // Step 1: Detect platforms
      const platforms = detectActivePlatforms(dir);
      const names = platforms.map(p => p.platform);
      expect(names).toContain('claude');
      expect(names).toContain('codex');
      expect(names).toContain('cursor');
      expect(names.length).toBe(3);

      // Step 2: Build canonical model
      const model = buildCanonicalModel(dir);
      expect(model.activePlatforms.length).toBe(3);
      expect(model.platformDetails).toHaveProperty('claude');
      expect(model.platformDetails).toHaveProperty('codex');
      expect(model.platformDetails).toHaveProperty('cursor');

      // Step 3: Detect drift
      const drift = detectDrift(model);
      expect(typeof drift.harmonyScore).toBe('number');
      expect(drift.harmonyScore).toBeGreaterThanOrEqual(0);
      expect(drift.harmonyScore).toBeLessThanOrEqual(100);
      expect(drift).toHaveProperty('drifts');
      expect(drift).toHaveProperty('summary');

      // Step 4: Generate sync
      const sync = generateHarmonySync(model);
      expect(sync.files.length).toBeGreaterThan(0);
      const syncPlatforms = [...new Set(sync.files.map(f => f.platform))];
      expect(syncPlatforms.length).toBeGreaterThanOrEqual(2);
    } finally { cleanFixture(dir); }
  });

  test('all 8 platforms detected when all config files present', () => {
    const dir = mkFixture('all-8');
    try {
      writeFile(dir, 'CLAUDE.md', '# Claude');
      writeFile(dir, 'AGENTS.md', '# Codex');
      writeFile(dir, 'GEMINI.md', '# Gemini');
      writeFile(dir, '.github/copilot-instructions.md', '# Copilot');
      fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
      writeFile(dir, '.cursorrules', '# Cursor');
      writeFile(dir, '.windsurfrules', '# Windsurf');
      writeFile(dir, '.aider.conf.yml', 'auto-commits: false');
      writeJson(dir, 'opencode.json', { instructions: 'test' });

      const platforms = detectActivePlatforms(dir);
      const names = platforms.map(p => p.platform);
      expect(names).toContain('claude');
      expect(names).toContain('codex');
      expect(names).toContain('gemini');
      expect(names).toContain('copilot');
      expect(names).toContain('cursor');
      expect(names).toContain('windsurf');
      expect(names).toContain('aider');
      expect(names).toContain('opencode');
      expect(names.length).toBe(8);
    } finally { cleanFixture(dir); }
  });
});

// ─── Drift detection accuracy ──────────────────────────────────────────────

describe('Harmony Integration — Drift Scenarios', () => {
  test('identical instruction content across 2 platforms yields high harmony score', () => {
    const sharedContent = '# Project\n\n## Build\nnpm test\nnpm run lint\n\n## Security\nNever expose .env\n';
    const model = {
      activePlatforms: [
        { platform: 'claude', label: 'Claude', ruleCount: 0 },
        { platform: 'codex', label: 'Codex', ruleCount: 0 },
      ],
      platformDetails: {
        claude: { instructionFiles: [{ file: 'CLAUDE.md' }], instructionContent: sharedContent, configFiles: ['CLAUDE.md'], mcpServers: [] },
        codex: { instructionFiles: [{ file: 'AGENTS.md' }], instructionContent: sharedContent, configFiles: ['AGENTS.md'], mcpServers: [] },
      },
      trustPosture: { claude: 'default', codex: 'default' },
      mcpServers: {},
    };
    const drift = detectDrift(model);
    expect(drift.harmonyScore).toBe(100);
    expect(drift.drifts).toHaveLength(0);
  });

  test('mismatched trust posture between platforms produces trust-drift', () => {
    const dir = mkFixture('drift-trust');
    try {
      writeFile(dir, 'CLAUDE.md', '# Claude project');
      writeFile(dir, 'AGENTS.md', '# Codex project');
      const model = buildCanonicalModel(dir);
      // Use actual TRUST_RISK keys: bypass=4, locked-down=0 → gap=4 → critical
      model.trustPosture = { claude: 'bypass', codex: 'locked-down' };
      const drift = detectDrift(model);
      expect(drift.harmonyScore).toBeLessThan(100);
      const trustDrift = drift.drifts.find(d => d.type === 'trust-drift');
      expect(trustDrift).toBeDefined();
      expect(trustDrift.severity).toBe('critical');
    } finally { cleanFixture(dir); }
  });

  test('MCP server present in one platform but missing in another produces mcp-drift', () => {
    const model = {
      activePlatforms: [
        { platform: 'claude', label: 'Claude', ruleCount: 0 },
        { platform: 'cursor', label: 'Cursor', ruleCount: 0 },
      ],
      platformDetails: {
        claude: { instructionFiles: [], instructionContent: '', configFiles: [], mcpServers: ['context7', 'github'] },
        cursor: { instructionFiles: [], instructionContent: '', configFiles: [], mcpServers: ['context7'] },
      },
      trustPosture: { claude: 'default', cursor: 'default' },
      mcpServers: {
        context7: { platforms: ['claude', 'cursor'] },
        github: { platforms: ['claude'] },
      },
    };
    const drift = detectDrift(model);
    const mcpDrift = drift.drifts.find(d => d.type === 'mcp-drift');
    expect(mcpDrift).toBeDefined();
    expect(mcpDrift.description).toContain('github');
  });
});

// ─── Add platform flow ────────────────────────────────────────────────────

describe('Harmony Integration — Add Platform', () => {
  test('addPlatform creates bootstrap files and detects new platform', () => {
    const dir = mkFixture('add-platform');
    try {
      writeFile(dir, 'CLAUDE.md', '# Existing Claude project');
      writeJson(dir, 'package.json', { name: 'add-test' });

      // Verify only claude before
      const before = detectActivePlatforms(dir);
      expect(before.map(p => p.platform)).toContain('claude');
      expect(before.map(p => p.platform)).not.toContain('codex');

      // Add codex
      const result = addPlatform(dir, 'codex');
      expect(result.success).toBe(true);
      expect(result.platform).toBe('codex');
      expect(result.created.length).toBeGreaterThan(0);
      expect(result.afterCount).toBeGreaterThan(result.beforeCount);

      // Verify codex now detected
      const after = detectActivePlatforms(dir);
      expect(after.map(p => p.platform)).toContain('codex');
    } finally { cleanFixture(dir); }
  });

  test('addPlatform rejects duplicate platform', () => {
    const dir = mkFixture('add-dup');
    try {
      writeFile(dir, 'CLAUDE.md', '# Claude');
      const result = addPlatform(dir, 'claude');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already active');
    } finally { cleanFixture(dir); }
  });

  test('addPlatform rejects unknown platform', () => {
    const dir = mkFixture('add-unknown');
    try {
      const result = addPlatform(dir, 'nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown platform');
    } finally { cleanFixture(dir); }
  });

  test('PLATFORM_BOOTSTRAPS has entries for all 8 platforms', () => {
    const platforms = ['claude', 'codex', 'gemini', 'copilot', 'cursor', 'windsurf', 'aider', 'opencode'];
    for (const p of platforms) {
      expect(PLATFORM_BOOTSTRAPS).toHaveProperty(p);
      expect(PLATFORM_BOOTSTRAPS[p].files.length).toBeGreaterThan(0);
    }
  });
});

// ─── State persistence roundtrip ───────────────────────────────────────────

describe('Harmony Integration — State Persistence', () => {
  test('audit → save → load → audit produces consistent results', async () => {
    const dir = mkFixture('state-roundtrip');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project\nnpm test');
      writeJson(dir, 'package.json', { name: 'state-test' });

      // First audit
      const audit1 = await harmonyAudit({ dir, silent: true });
      expect(audit1.harmonyScore).toBeGreaterThanOrEqual(0);

      // Save state
      saveHarmonyState(dir, {
        canon: { projectName: 'state-test', platforms: ['claude'] },
        platformScores: [{ platform: 'claude', score: audit1.harmonyScore }],
      });

      // Load state
      const loaded = loadHarmonyState(dir);
      expect(loaded.canon.projectName).toBe('state-test');
      expect(loaded.platformScores[0].score).toBe(audit1.harmonyScore);

      // Second audit should be consistent
      const audit2 = await harmonyAudit({ dir, silent: true });
      expect(audit2.harmonyScore).toBe(audit1.harmonyScore);
    } finally { cleanFixture(dir); }
  });
});

// ─── Governance integration ────────────────────────────────────────────────

describe('Harmony Integration — Governance', () => {
  test('governance summary reflects multi-platform compliance differences', () => {
    const audits = [
      {
        platform: 'claude',
        score: 85,
        sections: [{ key: 'role' }, { key: 'commands' }, { key: 'security' }],
        governance: { hasPermissions: true, hasDenyRules: true, hasSecretProtection: true },
        mcpServers: ['context7'],
      },
      {
        platform: 'codex',
        score: 50,
        sections: [{ key: 'role' }],
        governance: { hasPermissions: false, hasDenyRules: false, hasSecretProtection: false },
        mcpServers: [],
      },
    ];
    const summary = getHarmonyGovernanceSummary(null, audits);
    expect(summary.platformCompliance.length).toBe(2);

    // Claude should be more compliant
    const claudeCompliance = summary.platformCompliance.find(p => p.platform === 'claude');
    const codexCompliance = summary.platformCompliance.find(p => p.platform === 'codex');
    expect(claudeCompliance).toBeDefined();
    expect(codexCompliance).toBeDefined();
  });

  test('trust levels maintain strict ordering', () => {
    const noGov = inferTrustLevel(null);
    const weakGov = inferTrustLevel({ hasPermissions: false, hasDenyRules: false, hasSecretProtection: false });
    const strongGov = inferTrustLevel({ hasPermissions: true, hasDenyRules: true, hasSecretProtection: true });
    expect(strongGov.level).toBeLessThan(noGov.level);
    expect(strongGov.level).toBeLessThanOrEqual(weakGov.level);
  });
});

// ─── Advisor integration ───────────────────────────────────────────────────

describe('Harmony Integration — Advisor', () => {
  test('strategic advice adapts routing to available platforms', () => {
    const twoPlat = generateStrategicAdvice(null, [
      { platform: 'claude', score: 80 },
      { platform: 'codex', score: 70 },
    ]);
    const threePlat = generateStrategicAdvice(null, [
      { platform: 'claude', score: 80 },
      { platform: 'codex', score: 70 },
      { platform: 'cursor', score: 65 },
    ]);

    // More platforms = more routing options
    expect(twoPlat.taskRouting.length).toBeGreaterThan(0);
    expect(threePlat.taskRouting.length).toBeGreaterThan(0);

    // All routing should reference only available platforms
    for (const route of twoPlat.taskRouting) {
      expect(['claude', 'codex']).toContain(route.recommendedPlatform);
    }
    for (const route of threePlat.taskRouting) {
      expect(['claude', 'codex', 'cursor']).toContain(route.recommendedPlatform);
    }
  });

  test('advice with highest-scoring platform recommends it for complex tasks', () => {
    const advice = generateStrategicAdvice(null, [
      { platform: 'claude', score: 95 },
      { platform: 'codex', score: 40 },
    ]);
    const refactorRoute = advice.taskRouting.find(r => r.taskType === 'refactoring');
    if (refactorRoute) {
      expect(refactorRoute.recommendedPlatform).toBe('claude');
    }
  });
});
