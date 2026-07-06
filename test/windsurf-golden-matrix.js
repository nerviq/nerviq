const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('../src/audit');
const { WINDSURF_TECHNIQUES } = require('../src/windsurf/techniques');
const {
  withTempHome,
  buildEmptyRepo,
  buildRichWindsurfRepo,
  buildLegacyWindsurfrules,
  buildCascadeFocusedRepo,
  buildMultiPlatformRepo,
} = require('./windsurf-fixtures');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ❌ ${name}: ${error.message}`);
  }
}

async function auditScenario(scenario) {
  const ephemeralHome = scenario.homeDir || fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-windsurf-home-'));
  try {
    return await withTempHome(ephemeralHome, () => audit({ dir: scenario.dir, platform: 'windsurf', silent: true }));
  } finally {
    if (!scenario.homeDir) {
      fs.rmSync(ephemeralHome, { recursive: true, force: true });
    }
  }
}

async function main() {
  console.log('\n  Windsurf Golden Matrix\n');

  const empty = buildEmptyRepo();
  const rich = buildRichWindsurfRepo();
  const legacy = buildLegacyWindsurfrules();
  const cascade = buildCascadeFocusedRepo();
  const multi = buildMultiPlatformRepo();

  const emptyReport = await auditScenario(empty);
  const richReport = await auditScenario(rich);
  const legacyReport = await auditScenario(legacy);
  const cascadeReport = await auditScenario(cascade);
  const multiReport = await auditScenario(multi);

  test('G1: empty repo stays low-scoring and points to rules or MCP first', () => {
    // Trust-killer #3 fix landed: no Windsurf surface → insufficient signal,
    // score 0 (the band had been widened to <= 75 around an inflated 64/100).
    assert.strictEqual(emptyReport.signal, 'insufficient', `expected insufficient signal on an empty repo, got ${emptyReport.signal}`);
    assert.ok(emptyReport.score <= 10, `expected empty repo score <= 10, got ${emptyReport.score}`);
    const topKeys = emptyReport.topNextActions.map((item) => item.key);
    assert.ok(
      topKeys.includes('windsurfRulesExist') || topKeys.includes('windsurfMcpJsonExists'),
      `expected top actions to include windsurfRulesExist or windsurfMcpJsonExists, got: ${topKeys.slice(0, 5).join(', ')}`
    );
  });

  test('G2: rich repo lands in a strong Windsurf confidence band', () => {
    assert.ok(richReport.score >= 60, `expected rich repo score >= 60, got ${richReport.score}`);
    assert.ok(richReport.results.find((item) => item.key === 'windsurfRulesExist').passed);
    assert.ok(richReport.results.find((item) => item.key === 'windsurfWorkflowsExist').passed);
    assert.ok(richReport.results.find((item) => item.key === 'windsurfMemoriesConfigured').passed);
    assert.ok(richReport.results.find((item) => item.key === 'windsurfMcpJsonExists').passed);
  });

  test('G3: legacy repo flags .windsurfrules migration and missing modern surfaces', () => {
    assert.strictEqual(
      legacyReport.results.find((item) => item.key === 'windsurfNoLegacyWindsurfrules').passed,
      false,
      'windsurfNoLegacyWindsurfrules should fail'
    );
    assert.ok(
      legacyReport.topNextActions.some((item) => item.key === 'windsurfNoLegacyWindsurfrules' || item.key === 'windsurfRulesExist'),
      'expected legacy migration or modern rules creation in top actions'
    );
  });

  test('G4: cascade-focused repo keeps workflow and multi-file cascade signals green', () => {
    assert.ok(cascadeReport.score >= 60, `expected cascade repo score >= 60, got ${cascadeReport.score}`);
    assert.ok(cascadeReport.results.find((item) => item.key === 'windsurfCascadeMultiFile').passed);
    assert.ok(cascadeReport.results.find((item) => item.key === 'windsurfCascadeStepsAwareness').passed);
    assert.ok(cascadeReport.results.find((item) => item.key === 'windsurfWorkflowsExist').passed);
  });

  test('G5: multi-platform repo still audits the full Windsurf catalog cleanly', () => {
    assert.ok(multiReport.score >= 55, `expected multi-platform score >= 55, got ${multiReport.score}`);
    assert.ok(multiReport.results.find((item) => item.key === 'windsurfRulesExist').passed);
    assert.ok(multiReport.results.find((item) => item.key === 'windsurfRulesConsistentSurfaces').passed);
    assert.strictEqual(
      multiReport.results.length,
      Object.keys(WINDSURF_TECHNIQUES).length,
      `expected ${Object.keys(WINDSURF_TECHNIQUES).length} checks in multi-platform audit, got ${multiReport.results.length}`
    );
  });

  for (const scenario of [empty, rich, legacy, cascade, multi]) {
    fs.rmSync(scenario.dir, { recursive: true, force: true });
    if (scenario.homeDir) {
      fs.rmSync(scenario.homeDir, { recursive: true, force: true });
    }
  }

  console.log('\n  ─────────────────────────────────────');
  console.log(`  Windsurf Golden Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
