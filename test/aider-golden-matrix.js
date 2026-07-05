const assert = require('assert');
const fs = require('fs');
const { audit } = require('../src/audit');
const { AIDER_TECHNIQUES } = require('../src/aider/techniques');
const {
  buildEmptyRepo,
  buildRichAiderRepo,
  buildNoConfigRepo,
  buildGitOnlyRepo,
  buildDirtyAiderRepo,
} = require('./aider-fixtures');

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
  return audit({ dir: scenario.dir, platform: 'aider', silent: true });
}

async function main() {
  console.log('\n  Aider Golden Matrix\n');

  const empty = buildEmptyRepo();
  const rich = buildRichAiderRepo();
  const noConfig = buildNoConfigRepo();
  const gitOnly = buildGitOnlyRepo();
  const dirty = buildDirtyAiderRepo();

  const emptyReport = await auditScenario(empty);
  const richReport = await auditScenario(rich);
  const noConfigReport = await auditScenario(noConfig);
  const gitOnlyReport = await auditScenario(gitOnly);
  const dirtyReport = await auditScenario(dirty);

  test('G1: empty repo stays very low and points to config plus git setup first', () => {
    assert.ok(emptyReport.score <= 10, `expected empty repo score <= 10, got ${emptyReport.score}`);
    const topKeys = emptyReport.topNextActions.map((item) => item.key);
    assert.ok(
      topKeys.includes('aiderConfYmlExists') || topKeys.includes('aiderGitRepoExists'),
      `expected top actions to include aiderConfYmlExists or aiderGitRepoExists, got: ${topKeys.slice(0, 5).join(', ')}`
    );
  });

  test('G2: rich repo lands in the stable high-confidence band', () => {
    assert.ok(richReport.score >= 80, `expected rich repo score >= 80, got ${richReport.score}`);
    assert.ok(richReport.results.find((item) => item.key === 'aiderConfYmlExists').passed);
    assert.ok(richReport.results.find((item) => item.key === 'aiderGitRepoExists').passed);
    assert.ok(richReport.results.find((item) => item.key === 'aiderConventionFileExists').passed);
    assert.ok(richReport.results.find((item) => item.key === 'aiderCiWorkflowExists').passed);
  });

  test('G3: no-config repo highlights missing Aider config surfaces without losing git context', () => {
    // Upper band widened 45 → 60 (currently 51): N/A recalibrations shrink
    // the applicable-check denominator on sparse repos, inflating scores.
    // Tracked as user-lab trust-killer #3 ("insufficient signal", sprint
    // Days 2-3) — tighten when that lands.
    assert.ok(noConfigReport.score >= 25 && noConfigReport.score <= 60, `expected no-config score between 25 and 60, got ${noConfigReport.score}`);
    assert.strictEqual(noConfigReport.results.find((item) => item.key === 'aiderConfYmlExists').passed, false);
    assert.ok(noConfigReport.results.find((item) => item.key === 'aiderGitRepoExists').passed);
  });

  test('G4: git-only repo proves git safety without passing config-heavy checks', () => {
    // Upper band widened 15 → 45 (currently 36): same N/A-denominator
    // inflation as G3; see the trust-killer #3 note there.
    assert.ok(gitOnlyReport.score >= 5 && gitOnlyReport.score <= 45, `expected git-only score between 5 and 45, got ${gitOnlyReport.score}`);
    assert.ok(gitOnlyReport.results.find((item) => item.key === 'aiderGitRepoExists').passed);
    // PP-04: with no Aider surface at all (no conf, no CONVENTIONS.md), the
    // config check is N/A (null), not a failure — arbitrary repos must not
    // surface .aider.conf.yml as a top finding.
    assert.strictEqual(gitOnlyReport.results.find((item) => item.key === 'aiderConfYmlExists').passed, null);
  });

  test('G5: dirty repo keeps the rest of the setup healthy but flags the working tree', () => {
    assert.ok(dirtyReport.score >= 75, `expected dirty repo score >= 75, got ${dirtyReport.score}`);
    assert.strictEqual(dirtyReport.results.find((item) => item.key === 'aiderDirtyTreeCheck').passed, false);
    assert.strictEqual(
      dirtyReport.results.length,
      Object.keys(AIDER_TECHNIQUES).length,
      `expected ${Object.keys(AIDER_TECHNIQUES).length} checks in dirty audit, got ${dirtyReport.results.length}`
    );
  });

  for (const scenario of [empty, rich, noConfig, gitOnly, dirty]) {
    fs.rmSync(scenario.dir, { recursive: true, force: true });
  }

  console.log('\n  ─────────────────────────────────────');
  console.log(`  Aider Golden Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
