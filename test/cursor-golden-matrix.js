const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('../src/audit');
const {
  withTempHome,
  buildEmptyRepo,
  buildRichCursorRepo,
  buildLegacyCursorrules,
  buildBackgroundAgentRepo,
  buildMultiPlatformRepo,
} = require('./cursor-fixtures');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2705 ${name}`);
  } catch (error) {
    failed++;
    console.error(`  \u274C ${name}: ${error.message}`);
  }
}

async function auditScenario(scenario) {
  const ephemeralHome = scenario.homeDir || fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-cursor-home-'));
  try {
    return await withTempHome(ephemeralHome, () => audit({ dir: scenario.dir, platform: 'cursor', silent: true }));
  } finally {
    if (!scenario.homeDir) {
      fs.rmSync(ephemeralHome, { recursive: true, force: true });
    }
  }
}

async function main() {
  console.log('\n  Cursor Golden Matrix\n');

  const empty = buildEmptyRepo();
  const rich = buildRichCursorRepo();
  const legacy = buildLegacyCursorrules();
  const bgAgent = buildBackgroundAgentRepo();
  const multiPlatform = buildMultiPlatformRepo();

  const emptyReport = await auditScenario(empty);
  const richReport = await auditScenario(rich);
  const legacyReport = await auditScenario(legacy);
  const bgAgentReport = await auditScenario(bgAgent);
  const multiPlatformReport = await auditScenario(multiPlatform);

  // ─── G1: empty repo ──────────────────────────────────────────────────

  test('G1: empty Cursor repo stays low-scoring and points to rules/MCP first', () => {
    assert.ok(emptyReport.score <= 80, `expected empty repo score <= 80, got ${emptyReport.score}`);
    const topKeys = emptyReport.topNextActions.map(item => item.key);
    assert.ok(
      topKeys.includes('cursorRulesExist') || topKeys.includes('cursorMcpJsonExists'),
      `expected top actions to include cursorRulesExist or cursorMcpJsonExists, got: ${topKeys.slice(0, 5).join(', ')}`
    );
  });

  // ─── G2: rich repo ──────────────────────────────────────────────────

  test('G2: rich Cursor repo lands in a high-confidence band', () => {
    assert.ok(richReport.score >= 60, `expected rich repo score >= 60, got ${richReport.score}`);
    assert.ok(richReport.results.find(item => item.key === 'cursorRulesExist').passed);
    assert.ok(richReport.results.find(item => item.key === 'cursorAlwaysApplyExists').passed);
    assert.ok(richReport.results.find(item => item.key === 'cursorMcpJsonExists').passed);
    assert.ok(richReport.results.find(item => item.key === 'cursorMcpValidJson').passed);
    assert.ok(richReport.results.find(item => item.key === 'cursorEnvironmentJsonExists').passed);
  });

  // ─── G3: legacy-only ───��──────────────────────────────────────────────

  test('G3: legacy-only repo flags .cursorrules as critical and scores low', () => {
    const legacyCheck = legacyReport.results.find(item => item.key === 'cursorNoLegacyCursorrules');
    assert.strictEqual(legacyCheck.passed, false, 'cursorNoLegacyCursorrules should fail');
    assert.ok(
      legacyReport.topNextActions.some(item => item.key === 'cursorNoLegacyCursorrules' || item.key === 'cursorRulesExist'),
      'expected legacy migration or rules creation in top actions'
    );
  });

  // ─── G4: background-agent ────────────────────────────────────────────

  test('G4: background-agent repo detects environment.json and automation surfaces', () => {
    assert.ok(bgAgentReport.score > 0, `expected bg-agent repo to have a score, got ${bgAgentReport.score}`);
    assert.ok(bgAgentReport.results.find(item => item.key === 'cursorRulesExist').passed);
    assert.ok(bgAgentReport.results.find(item => item.key === 'cursorEnvironmentJsonExists').passed);
    assert.ok(bgAgentReport.results.find(item => item.key === 'cursorMcpJsonExists').passed);
  });

  // ─── G5: multi-platform ───────��────────────────────────────────────

  test('G5: multi-platform repo detects Cursor surfaces alongside Claude, Gemini, and Copilot', () => {
    assert.ok(multiPlatformReport.results.find(item => item.key === 'cursorRulesExist').passed);
    assert.ok(multiPlatformReport.results.find(item => item.key === 'cursorMcpJsonExists').passed);
    assert.ok(multiPlatformReport.score >= 60, `expected multi-platform score >= 60, got ${multiPlatformReport.score}`);
    // Verify the Cursor platform audit covers the full Cursor check surface
    // regardless of other platform presence. Compare against the empty-repo
    // Cursor audit instead of a hardcoded count — the hardcoded "84" went
    // stale when the Cursor catalog grew to 301 checks and would break again
    // on the next expansion.
    assert.strictEqual(
      multiPlatformReport.results.length,
      emptyReport.results.length,
      `expected multi-platform Cursor audit to cover the same ${emptyReport.results.length} checks as a single-platform audit, got ${multiPlatformReport.results.length}`
    );
  });

  for (const scenario of [empty, rich, legacy, bgAgent, multiPlatform]) {
    fs.rmSync(scenario.dir, { recursive: true, force: true });
    if (scenario.homeDir) {
      fs.rmSync(scenario.homeDir, { recursive: true, force: true });
    }
  }

  console.log('\n  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log(`  Cursor Golden Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
