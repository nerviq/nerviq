const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('../src/audit');
const { OPENCODE_TECHNIQUES } = require('../src/opencode/techniques');
const {
  withTempHome,
  buildEmptyRepo,
  buildRichOpenCodeRepo,
  buildJsoncOnlyRepo,
  buildMixedAgentRepo,
  buildPermissiveRepo,
} = require('./opencode-fixtures');

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
  const ephemeralHome = scenario.homeDir || fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-opencode-home-'));
  try {
    return await withTempHome(ephemeralHome, () => audit({ dir: scenario.dir, platform: 'opencode', silent: true }));
  } finally {
    if (!scenario.homeDir) {
      fs.rmSync(ephemeralHome, { recursive: true, force: true });
    }
  }
}

async function main() {
  console.log('\n  OpenCode Golden Matrix\n');

  const empty = buildEmptyRepo();
  const rich = buildRichOpenCodeRepo();
  const jsoncOnly = buildJsoncOnlyRepo();
  const mixed = buildMixedAgentRepo();
  const permissive = buildPermissiveRepo();

  const emptyReport = await auditScenario(empty);
  const richReport = await auditScenario(rich);
  const jsoncReport = await auditScenario(jsoncOnly);
  const mixedReport = await auditScenario(mixed);
  const permissiveReport = await auditScenario(permissive);

  test('G1: empty repo stays low and points to AGENTS plus config first', () => {
    assert.ok(emptyReport.score <= 30, `expected empty repo score <= 30, got ${emptyReport.score}`);
    const topKeys = emptyReport.topNextActions.map((item) => item.key);
    assert.ok(
      topKeys.includes('opencodeAgentsMdExists') || topKeys.includes('opencodeConfigExists'),
      `expected top actions to include opencodeAgentsMdExists or opencodeConfigExists, got: ${topKeys.slice(0, 5).join(', ')}`
    );
  });

  test('G2: rich repo lands in the expected OpenCode confidence band', () => {
    assert.ok(richReport.score >= 75, `expected rich repo score >= 75, got ${richReport.score}`);
    assert.ok(richReport.results.find((item) => item.key === 'opencodeAgentsMdExists').passed);
    assert.ok(richReport.results.find((item) => item.key === 'opencodeConfigExists').passed);
    assert.ok(richReport.results.find((item) => item.key === 'opencodePluginsValid').passed);
    assert.ok(richReport.results.find((item) => item.key === 'opencodeAgentRequiredFields').passed);
  });

  test('G3: JSONC-only repo proves fallback config loading but surfaces thinner docs', () => {
    assert.ok(jsoncReport.score >= 45 && jsoncReport.score <= 60, `expected jsonc-only score between 45 and 60, got ${jsoncReport.score}`);
    assert.ok(jsoncReport.results.find((item) => item.key === 'opencodeConfigExists').passed);
    assert.strictEqual(jsoncReport.results.find((item) => item.key === 'opencodeAgentsMdQuality').passed, false);
  });

  test('G4: mixed-agent repo keeps OpenCode guidance separated without reducing coverage', () => {
    assert.ok(mixedReport.score >= 75, `expected mixed-agent score >= 75, got ${mixedReport.score}`);
    assert.ok(mixedReport.results.find((item) => item.key === 'opencodeMixedAgentAware').passed);
    assert.ok(mixedReport.results.find((item) => item.key === 'opencodeGlobalAgentsNoConflict').passed);
  });

  test('G5: permissive repo flags the dangerous permission posture clearly', () => {
    assert.ok(permissiveReport.score >= 35 && permissiveReport.score <= 50, `expected permissive score between 35 and 50, got ${permissiveReport.score}`);
    assert.strictEqual(permissiveReport.results.find((item) => item.key === 'opencodeNoBlanketAllow').passed, false);
    assert.strictEqual(permissiveReport.results.find((item) => item.key === 'opencodeBashPermissionExplicit').passed, false);
    assert.strictEqual(
      permissiveReport.results.length,
      Object.keys(OPENCODE_TECHNIQUES).length,
      `expected ${Object.keys(OPENCODE_TECHNIQUES).length} checks in permissive audit, got ${permissiveReport.results.length}`
    );
  });

  for (const scenario of [empty, rich, jsoncOnly, mixed, permissive]) {
    fs.rmSync(scenario.dir, { recursive: true, force: true });
    if (scenario.homeDir) {
      fs.rmSync(scenario.homeDir, { recursive: true, force: true });
    }
  }

  console.log('\n  ─────────────────────────────────────');
  console.log(`  OpenCode Golden Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
