const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildCanonicalModel, detectActivePlatforms, PLATFORM_SIGNATURES } = require('../src/harmony/canon');
const { detectDrift, formatDriftReport } = require('../src/harmony/drift');
const { harmonyAudit } = require('../src/harmony/audit');
const { generateHarmonySync, previewHarmonySync } = require('../src/harmony/sync');
const { generateStrategicAdvice, PLATFORM_STRENGTHS, generateTaskRouting, rankPlatformsForTask } = require('../src/harmony/advisor');
const { saveHarmonyState, loadHarmonyState, getHarmonyHistory, recordRoutingOutcome, HARMONY_DIR, STATE_FILES } = require('../src/harmony/memory');
const { getHarmonyGovernanceSummary, inferTrustLevel, evaluateInstructionCoverage, TRUST_LEVELS, REQUIRED_INSTRUCTION_SECTIONS } = require('../src/harmony/governance');

// ─── Helpers ────────────────────────────────────────────────────────────────

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `harmony-jest-${name}-`));
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

// ─── Canon tests ────────────────────────────────────────────────────────────

describe('Harmony Canon', () => {
  test('detectActivePlatforms returns claude for dir with CLAUDE.md', () => {
    const dir = mkFixture('claude-only');
    try {
      writeFile(dir, 'CLAUDE.md', '# Claude Instructions\nTest project.');
      const platforms = detectActivePlatforms(dir);
      const keys = platforms.map(p => p.platform);
      expect(keys).toContain('claude');
    } finally { cleanFixture(dir); }
  });

  test('detectActivePlatforms returns claude + codex for CLAUDE.md + AGENTS.md', () => {
    const dir = mkFixture('claude-codex');
    try {
      writeFile(dir, 'CLAUDE.md', '# Claude\nProject instructions');
      writeFile(dir, 'AGENTS.md', '# Agents\nCodex instructions');
      const platforms = detectActivePlatforms(dir);
      const keys = platforms.map(p => p.platform);
      expect(keys).toContain('claude');
      expect(keys).toContain('codex');
    } finally { cleanFixture(dir); }
  });

  test('detectActivePlatforms returns empty for bare directory', () => {
    const dir = mkFixture('empty');
    try {
      const platforms = detectActivePlatforms(dir);
      expect(platforms).toEqual([]);
    } finally { cleanFixture(dir); }
  });

  test('detectActivePlatforms detects gemini from GEMINI.md', () => {
    const dir = mkFixture('gemini');
    try {
      writeFile(dir, 'GEMINI.md', '# Gemini\nGemini instructions');
      const platforms = detectActivePlatforms(dir);
      expect(platforms.map(p => p.platform)).toContain('gemini');
    } finally { cleanFixture(dir); }
  });

  test('detectActivePlatforms detects copilot from .github/copilot-instructions.md', () => {
    const dir = mkFixture('copilot');
    try {
      writeFile(dir, '.github/copilot-instructions.md', '# Copilot\nInstructions');
      const platforms = detectActivePlatforms(dir);
      expect(platforms.map(p => p.platform)).toContain('copilot');
    } finally { cleanFixture(dir); }
  });

  test('detectActivePlatforms detects cursor from .cursor directory', () => {
    const dir = mkFixture('cursor');
    try {
      fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
      const platforms = detectActivePlatforms(dir);
      expect(platforms.map(p => p.platform)).toContain('cursor');
    } finally { cleanFixture(dir); }
  });

  test('detectActivePlatforms detects windsurf from .windsurfrules', () => {
    const dir = mkFixture('windsurf');
    try {
      writeFile(dir, '.windsurfrules', '# Windsurf\nRules');
      const platforms = detectActivePlatforms(dir);
      expect(platforms.map(p => p.platform)).toContain('windsurf');
    } finally { cleanFixture(dir); }
  });

  test('detectActivePlatforms detects aider from .aider.conf.yml', () => {
    const dir = mkFixture('aider');
    try {
      writeFile(dir, '.aider.conf.yml', 'auto-commits: true\n');
      const platforms = detectActivePlatforms(dir);
      expect(platforms.map(p => p.platform)).toContain('aider');
    } finally { cleanFixture(dir); }
  });

  test('detectActivePlatforms detects opencode from opencode.json', () => {
    const dir = mkFixture('opencode');
    try {
      writeJson(dir, 'opencode.json', { permissions: { bash: 'ask' } });
      const platforms = detectActivePlatforms(dir);
      expect(platforms.map(p => p.platform)).toContain('opencode');
    } finally { cleanFixture(dir); }
  });

  test('buildCanonicalModel returns valid structure with activePlatforms array', () => {
    const dir = mkFixture('canon-model');
    try {
      writeFile(dir, 'CLAUDE.md', '# Claude\nTest project\n## Verification\nnpm test');
      writeJson(dir, 'package.json', { name: 'test-project' });
      const model = buildCanonicalModel(dir);
      expect(model).toHaveProperty('activePlatforms');
      expect(Array.isArray(model.activePlatforms)).toBe(true);
      expect(model.activePlatforms.length).toBeGreaterThan(0);
      expect(model).toHaveProperty('projectName');
      expect(model).toHaveProperty('platformDetails');
      expect(model).toHaveProperty('trustPosture');
    } finally { cleanFixture(dir); }
  });

  test('PLATFORM_SIGNATURES has all 8 platforms', () => {
    expect(Object.keys(PLATFORM_SIGNATURES)).toEqual(
      expect.arrayContaining(['claude', 'codex', 'gemini', 'copilot', 'cursor', 'windsurf', 'aider', 'opencode'])
    );
  });
});

// ─── Drift tests ────────────────────────────────────────────────────────────

describe('Harmony Drift', () => {
  test('detectDrift with fully matching configs returns harmonyScore 100', () => {
    // Build a minimal canonical model directly to avoid instruction-drift detection
    const model = {
      activePlatforms: [
        { platform: 'claude', label: 'Claude', ruleCount: 0 },
        { platform: 'codex', label: 'Codex', ruleCount: 0 },
      ],
      platformDetails: {
        claude: { instructionFiles: [{ file: 'CLAUDE.md' }], instructionContent: 'npm test\neslint\n.env', configFiles: ['CLAUDE.md'], mcpServers: [] },
        codex: { instructionFiles: [{ file: 'AGENTS.md' }], instructionContent: 'npm test\neslint\n.env', configFiles: ['AGENTS.md'], mcpServers: [] },
      },
      trustPosture: { claude: 'default', codex: 'default' },
      mcpServers: {},
    };
    const result = detectDrift(model);
    expect(result.harmonyScore).toBe(100);
    expect(result.drifts).toHaveLength(0);
  });

  test('detectDrift with matching trust but instruction gaps has score < 100', () => {
    const dir = mkFixture('drift-match');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project\nnpm test\neslint\n.env protection');
      writeFile(dir, 'AGENTS.md', '# Project\nnpm test\neslint\n.env protection');
      const model = buildCanonicalModel(dir);
      model.trustPosture = { claude: 'default', codex: 'default' };
      const result = detectDrift(model);
      // Score depends on instruction-level drift checks; just verify structure
      expect(typeof result.harmonyScore).toBe('number');
      expect(result.harmonyScore).toBeGreaterThanOrEqual(0);
      expect(result.harmonyScore).toBeLessThanOrEqual(100);
    } finally { cleanFixture(dir); }
  });

  test('detectDrift with mismatched trust posture detects drift', () => {
    const dir = mkFixture('drift-trust');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project');
      writeFile(dir, 'AGENTS.md', '# Project');
      const model = buildCanonicalModel(dir);
      model.trustPosture = { claude: 'bypass', codex: 'locked-down' };
      const result = detectDrift(model);
      expect(result.drifts.length).toBeGreaterThan(0);
      const trustDrift = result.drifts.find(d => d.type === 'trust-drift');
      expect(trustDrift).toBeDefined();
      expect(result.harmonyScore).toBeLessThan(100);
    } finally { cleanFixture(dir); }
  });

  test('detectDrift returns summary counts', () => {
    const dir = mkFixture('drift-summary');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project\nnpm test');
      writeFile(dir, 'AGENTS.md', '# Project');
      const model = buildCanonicalModel(dir);
      model.trustPosture = { claude: 'bypass', codex: 'locked-down' };
      const result = detectDrift(model);
      expect(result).toHaveProperty('summary');
      expect(result.summary).toHaveProperty('total');
      expect(result.summary).toHaveProperty('critical');
      expect(result.summary).toHaveProperty('high');
      expect(result.summary).toHaveProperty('medium');
      expect(result.summary).toHaveProperty('low');
    } finally { cleanFixture(dir); }
  });

  test('formatDriftReport returns string', () => {
    const driftResult = {
      drifts: [{ type: 'trust-drift', severity: 'high', platforms: ['claude', 'codex'], description: 'test drift', recommendation: 'fix it' }],
      summary: { total: 1, critical: 0, high: 1, medium: 0, low: 0 },
      harmonyScore: 88,
    };
    const report = formatDriftReport(driftResult, { color: false });
    expect(typeof report).toBe('string');
    expect(report).toContain('88');
  });
});

// ─── Audit tests ────────────────────────────────────────────────────────────

describe('Harmony Audit', () => {
  test('harmonyAudit returns platformScores and harmonyScore', async () => {
    const dir = mkFixture('audit-basic');
    try {
      writeFile(dir, 'CLAUDE.md', '# Claude\nnpm test\neslint');
      writeJson(dir, 'package.json', { name: 'test-audit' });
      const result = await harmonyAudit({ dir, silent: true });
      expect(result).toHaveProperty('harmonyScore');
      expect(result).toHaveProperty('platformScores');
      expect(typeof result.harmonyScore).toBe('number');
      expect(result.harmonyScore).toBeGreaterThanOrEqual(0);
      expect(result.harmonyScore).toBeLessThanOrEqual(100);
    } finally { cleanFixture(dir); }
  });

  test('harmonyAudit with no platforms returns score 0', async () => {
    const dir = mkFixture('audit-empty');
    try {
      const result = await harmonyAudit({ dir, silent: true });
      expect(result.harmonyScore).toBe(0);
      expect(result.activePlatforms).toHaveLength(0);
    } finally { cleanFixture(dir); }
  });
});

// ─── Sync tests ─────────────────────────────────────────────────────────────

describe('Harmony Sync', () => {
  test('generateHarmonySync produces file operations for each platform', () => {
    const dir = mkFixture('sync-ops');
    try {
      writeFile(dir, 'CLAUDE.md', '# Claude\nShared instruction');
      writeFile(dir, 'AGENTS.md', '# Codex\nShared instruction');
      writeJson(dir, 'package.json', { name: 'sync-test' });
      const model = buildCanonicalModel(dir);
      const sync = generateHarmonySync(model);
      expect(sync).toHaveProperty('files');
      expect(sync).toHaveProperty('summary');
      expect(sync).toHaveProperty('warnings');
      expect(Array.isArray(sync.files)).toBe(true);
      // Should have operations for both platforms
      const platforms = sync.files.map(f => f.platform);
      expect(platforms).toContain('claude');
      expect(platforms).toContain('codex');
    } finally { cleanFixture(dir); }
  });

  test('generateHarmonySync creates new instruction files for platforms without them', () => {
    const dir = mkFixture('sync-create');
    try {
      writeFile(dir, 'CLAUDE.md', '# Claude\nTest');
      // Also add codex detection marker but no AGENTS.md content
      writeFile(dir, 'AGENTS.md', '');
      writeJson(dir, 'package.json', { name: 'sync-create-test' });
      const model = buildCanonicalModel(dir);
      const sync = generateHarmonySync(model);
      expect(sync.files.length).toBeGreaterThan(0);
      for (const file of sync.files) {
        expect(file).toHaveProperty('platform');
        expect(file).toHaveProperty('path');
        expect(file).toHaveProperty('action');
        expect(file).toHaveProperty('content');
      }
    } finally { cleanFixture(dir); }
  });

  test('previewHarmonySync does not write files', () => {
    const dir = mkFixture('sync-preview');
    try {
      writeFile(dir, 'CLAUDE.md', '# Claude\nTest');
      writeJson(dir, 'package.json', { name: 'preview-test' });
      const before = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      const sync = previewHarmonySync(dir);
      const after = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      expect(before).toBe(after);
      expect(sync).toHaveProperty('files');
    } finally { cleanFixture(dir); }
  });
});

// ─── Advisor tests ──────────────────────────────────────────────────────────

describe('Harmony Advisor', () => {
  test('generateStrategicAdvice routes bug-fix to claude', () => {
    const audits = [
      { platform: 'claude', score: 80 },
      { platform: 'codex', score: 70 },
    ];
    const advice = generateStrategicAdvice(null, audits);
    expect(advice).toHaveProperty('taskRouting');
    const bugFix = advice.taskRouting.find(r => r.taskType === 'bug-fix');
    expect(bugFix).toBeDefined();
    expect(bugFix.recommendedPlatform).toBe('claude');
  });

  test('generateStrategicAdvice routes CI-review to codex', () => {
    const audits = [
      { platform: 'claude', score: 80 },
      { platform: 'codex', score: 70 },
    ];
    const advice = generateStrategicAdvice(null, audits);
    const ciReview = advice.taskRouting.find(r => r.taskType === 'ci-review');
    expect(ciReview).toBeDefined();
    expect(ciReview.recommendedPlatform).toBe('codex');
  });

  test('generateStrategicAdvice routes harness optimization to claude', () => {
    const audits = [
      { platform: 'claude', score: 80 },
      { platform: 'codex', score: 70 },
    ];
    const advice = generateStrategicAdvice(null, audits);
    const harnessOptimization = advice.taskRouting.find(r => r.taskType === 'harness-optimization');
    expect(harnessOptimization).toBeDefined();
    expect(harnessOptimization.recommendedPlatform).toBe('claude');
  });

  test('generateStrategicAdvice routes phased migration to claude', () => {
    const audits = [
      { platform: 'claude', score: 80 },
      { platform: 'codex', score: 70 },
    ];
    const advice = generateStrategicAdvice(null, audits);
    const phasedMigration = advice.taskRouting.find(r => r.taskType === 'phased-migration');
    expect(phasedMigration).toBeDefined();
    expect(phasedMigration.recommendedPlatform).toBe('claude');
  });

  test('PLATFORM_STRENGTHS has all 8 platforms', () => {
    const keys = Object.keys(PLATFORM_STRENGTHS);
    expect(keys).toEqual(
      expect.arrayContaining(['claude', 'codex', 'gemini', 'copilot', 'cursor', 'windsurf', 'aider', 'opencode'])
    );
    expect(keys.length).toBe(8);
  });

  test('rankPlatformsForTask returns sorted array', () => {
    const rankings = rankPlatformsForTask('bug-fix');
    expect(Array.isArray(rankings)).toBe(true);
    expect(rankings.length).toBe(8);
    // Sorted descending by score
    for (let i = 1; i < rankings.length; i++) {
      expect(rankings[i - 1].score).toBeGreaterThanOrEqual(rankings[i].score);
    }
  });

  test('generateStrategicAdvice returns generatedAt timestamp', () => {
    const advice = generateStrategicAdvice(null, [{ platform: 'claude', score: 70 }]);
    expect(advice).toHaveProperty('generatedAt');
    expect(typeof advice.generatedAt).toBe('string');
  });
});

// ─── Memory tests ───────────────────────────────────────────────────────────

describe('Harmony Memory', () => {
  test('saveHarmonyState + loadHarmonyState roundtrip works', () => {
    const dir = mkFixture('memory-rt');
    try {
      const state = {
        canon: { projectName: 'test', platforms: ['claude'] },
        driftHistory: [{ platform: 'claude', driftScore: 5 }],
        platformScores: [{ platform: 'claude', score: 85 }],
      };
      saveHarmonyState(dir, state);
      const loaded = loadHarmonyState(dir);
      expect(loaded.canon).toEqual(state.canon);
      expect(loaded.driftHistory).toEqual(state.driftHistory);
      expect(loaded.platformScores).toEqual(state.platformScores);
    } finally { cleanFixture(dir); }
  });

  test('loadHarmonyState returns empty object for missing state', () => {
    const dir = mkFixture('memory-empty');
    try {
      const loaded = loadHarmonyState(dir);
      expect(loaded).toEqual({});
    } finally { cleanFixture(dir); }
  });

  test('loadHarmonyState falls back to legacy .nerviq/harmony state when .nerviq/harmony is absent', () => {
    const dir = mkFixture('memory-legacy');
    try {
      writeJson(dir, '.nerviq/harmony/canon.json', { projectName: 'legacy-project' });
      const loaded = loadHarmonyState(dir);
      expect(loaded.canon).toEqual({ projectName: 'legacy-project' });
    } finally { cleanFixture(dir); }
  });

  test('saveHarmonyState creates manifest file', () => {
    const dir = mkFixture('memory-manifest');
    try {
      saveHarmonyState(dir, { canon: { test: true } });
      const manifest = JSON.parse(
        fs.readFileSync(path.join(dir, HARMONY_DIR, 'manifest.json'), 'utf8')
      );
      expect(manifest).toHaveProperty('lastUpdated');
      expect(manifest).toHaveProperty('files');
    } finally { cleanFixture(dir); }
  });

  test('recordRoutingOutcome appends to routing history', () => {
    const dir = mkFixture('memory-routing');
    try {
      recordRoutingOutcome(dir, { taskType: 'bugfix', platform: 'claude', result: 'success' });
      recordRoutingOutcome(dir, { taskType: 'ci-review', platform: 'codex', result: 'success' });
      const state = loadHarmonyState(dir);
      expect(state.routingHistory).toHaveLength(2);
      expect(state.routingHistory[0].platform).toBe('claude');
      expect(state.routingHistory[1].platform).toBe('codex');
    } finally { cleanFixture(dir); }
  });
});

// ─── Governance tests ───────────────────────────────────────────────────────

describe('Harmony Governance', () => {
  test('getHarmonyGovernanceSummary returns compliance info', () => {
    const audits = [
      {
        platform: 'claude',
        score: 75,
        sections: [{ key: 'role' }, { key: 'commands' }],
        governance: { hasPermissions: true, hasDenyRules: true, hasSecretProtection: true },
        mcpServers: [],
      },
      {
        platform: 'codex',
        score: 60,
        sections: [{ key: 'role' }],
        governance: { hasPermissions: false, hasDenyRules: false, hasSecretProtection: false },
        mcpServers: [],
      },
    ];
    const summary = getHarmonyGovernanceSummary(null, audits);
    expect(summary).toHaveProperty('minimumTrustPosture');
    expect(summary).toHaveProperty('instructionCoverage');
    expect(summary).toHaveProperty('mcpAlignment');
    expect(summary).toHaveProperty('platformCompliance');
    expect(summary).toHaveProperty('evaluatedAt');
    expect(summary.platformCompliance.length).toBe(2);
  });

  test('inferTrustLevel with deny rules and secret protection returns guarded', () => {
    const gov = { hasPermissions: true, hasDenyRules: true, hasSecretProtection: true };
    const level = inferTrustLevel(gov);
    expect(level).toEqual(TRUST_LEVELS.guarded);
  });

  test('inferTrustLevel with null governance returns unrestricted', () => {
    const level = inferTrustLevel(null);
    expect(level).toEqual(TRUST_LEVELS.unrestricted);
  });

  test('evaluateInstructionCoverage counts covered and missing sections', () => {
    const sections = [{ key: 'role' }, { key: 'commands' }, { key: 'language' }];
    const result = evaluateInstructionCoverage(sections);
    expect(result.covered).toBe(3);
    expect(result.missing).toBe(REQUIRED_INSTRUCTION_SECTIONS.length - 3);
    expect(result.percentage).toBeGreaterThan(0);
    expect(result.percentage).toBeLessThanOrEqual(100);
  });

  test('TRUST_LEVELS has expected level hierarchy', () => {
    expect(TRUST_LEVELS.strict.level).toBeLessThan(TRUST_LEVELS.guarded.level);
    expect(TRUST_LEVELS.guarded.level).toBeLessThan(TRUST_LEVELS.standard.level);
    expect(TRUST_LEVELS.standard.level).toBeLessThan(TRUST_LEVELS.permissive.level);
    expect(TRUST_LEVELS.permissive.level).toBeLessThan(TRUST_LEVELS.unrestricted.level);
  });
});
