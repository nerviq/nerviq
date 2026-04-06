const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('../src/audit');
const {
  withTempHome,
  buildEmptyRepo,
  buildRichTrustedMcpRepo,
  buildRegulatedRepo,
  buildActionUnsafeLinuxRepo,
  buildMultiPlatformRepo,
} = require('./codex-fixtures');

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
  const ephemeralHome = scenario.homeDir || fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-codex-home-'));
  try {
    return await withTempHome(ephemeralHome, () => audit({ dir: scenario.dir, platform: 'codex', silent: true }));
  } finally {
    if (!scenario.homeDir) {
      fs.rmSync(ephemeralHome, { recursive: true, force: true });
    }
  }
}

async function main() {
  console.log('\n  Codex Golden Matrix\n');

  const empty = buildEmptyRepo();
  const mature = buildRichTrustedMcpRepo();
  const regulated = buildRegulatedRepo(true);
  const ciHeavy = buildActionUnsafeLinuxRepo();
  const multiPlatform = buildMultiPlatformRepo();

  const emptyReport = await auditScenario(empty);
  const matureReport = await auditScenario(mature);
  const regulatedReport = await auditScenario(regulated);
  const ciHeavyReport = await auditScenario(ciHeavy);
  const multiPlatformReport = await auditScenario(multiPlatform);

  test('G1: empty Codex repo stays low-scoring and points to AGENTS/config first', () => {
    assert.ok(emptyReport.score <= 40, `expected empty repo score <= 40, got ${emptyReport.score}`);
    assert.ok(
      ['codexApprovalPolicyExplicit', 'codexAgentsMd', 'codexConfigExists'].includes(emptyReport.topNextActions[0].key),
      `unexpected first top action: ${emptyReport.topNextActions[0].key}`
    );
    assert.ok(emptyReport.topNextActions.some(item => item.key === 'codexConfigExists'));
  });

  test('G2: mature trusted Codex repo lands in a high-confidence band', () => {
    assert.ok(matureReport.score >= 80, `expected mature repo score >= 80, got ${matureReport.score}`);
    assert.ok(matureReport.results.find(item => item.key === 'codexProfilesUsedAppropriately').passed);
    assert.ok(matureReport.results.find(item => item.key === 'codexProjectScopedMcpTrusted').passed);
    assert.ok(matureReport.categoryScores.mcp.score >= 70, `expected mcp category >= 70, got ${matureReport.categoryScores.mcp.score}`);
  });

  test('G3: regulated repo surfaces privacy posture explicitly', () => {
    assert.ok(regulatedReport.score >= 45, `expected regulated repo score >= 45, got ${regulatedReport.score}`);
    assert.strictEqual(regulatedReport.results.find(item => item.key === 'codexDisableResponseStorageForRegulatedRepos').passed, true);
    assert.ok(regulatedReport.topNextActions.every(item => item.key !== 'codexDisableResponseStorageForRegulatedRepos'));
  });

  test('G4: CI-heavy repo flags unsafe Codex Action posture near the top', () => {
    assert.strictEqual(ciHeavyReport.results.find(item => item.key === 'codexGitHubActionUnsafeJustified').passed, false);
    assert.ok(ciHeavyReport.topNextActions.some(item => item.key === 'codexGitHubActionUnsafeJustified'));
    assert.ok(ciHeavyReport.categoryScores.trust.score < matureReport.categoryScores.trust.score);
  });

  test('G5: multi-platform repo emits a Codex-only scope note', () => {
    assert.ok(multiPlatformReport.platformScopeNote, 'expected platform scope note');
    assert.strictEqual(multiPlatformReport.platformScopeNote.kind, 'codex-only-pass');
    assert.ok(multiPlatformReport.platformScopeNote.message.includes('Codex-only pass'));
  });

  for (const scenario of [empty, mature, regulated, ciHeavy, multiPlatform]) {
    fs.rmSync(scenario.dir, { recursive: true, force: true });
    if (scenario.homeDir) {
      fs.rmSync(scenario.homeDir, { recursive: true, force: true });
    }
  }

  console.log('\n  ─────────────────────────────────────');
  console.log(`  Codex Golden Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
