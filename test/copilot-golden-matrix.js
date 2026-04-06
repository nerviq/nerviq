const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('../src/audit');
const {
  withTempHome,
  buildEmptyRepo,
  buildRichCopilotRepo,
  buildCloudAgentRepo,
  buildMultiPlatformRepo,
  buildContentExclusionRepo,
} = require('./copilot-fixtures');

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
  const ephemeralHome = scenario.homeDir || fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-copilot-home-'));
  try {
    return await withTempHome(ephemeralHome, () => audit({ dir: scenario.dir, platform: 'copilot', silent: true }));
  } finally {
    if (!scenario.homeDir) {
      fs.rmSync(ephemeralHome, { recursive: true, force: true });
    }
  }
}

async function main() {
  console.log('\n  Copilot Golden Matrix\n');

  const empty = buildEmptyRepo();
  const rich = buildRichCopilotRepo();
  const cloudAgent = buildCloudAgentRepo();
  const multiPlatform = buildMultiPlatformRepo();
  const enterprise = buildContentExclusionRepo();

  const emptyReport = await auditScenario(empty);
  const richReport = await auditScenario(rich);
  const cloudAgentReport = await auditScenario(cloudAgent);
  const multiPlatformReport = await auditScenario(multiPlatform);
  const enterpriseReport = await auditScenario(enterprise);

  // ─── G1: empty repo ──────────────────────────────────────────────────

  test('G1: empty Copilot repo stays low-scoring and points to instructions/settings first', () => {
    assert.ok(emptyReport.score <= 80, `expected empty repo score <= 80, got ${emptyReport.score}`);
    const topKeys = emptyReport.topNextActions.map(item => item.key);
    assert.ok(
      topKeys.includes('copilotInstructionsExists') || topKeys.includes('copilotVscodeSettingsExists'),
      `expected top actions to include copilotInstructionsExists or copilotVscodeSettingsExists, got: ${topKeys.slice(0, 5).join(', ')}`
    );
  });

  // ─── G2: rich repo ──────────────────────────────────────────────────

  test('G2: rich Copilot repo lands in a high-confidence band', () => {
    assert.ok(richReport.score >= 60, `expected rich repo score >= 60, got ${richReport.score}`);
    assert.ok(richReport.results.find(item => item.key === 'copilotInstructionsExists').passed);
    assert.ok(richReport.results.find(item => item.key === 'copilotVscodeSettingsExists').passed);
    assert.ok(richReport.results.find(item => item.key === 'copilotMcpConfigured').passed);
    assert.ok(richReport.results.find(item => item.key === 'copilotTerminalSandboxEnabled').passed);
  });

  // ─── G3: cloud-agent ───────────────────────────────────────────────

  test('G3: cloud-agent repo detects agent setup and CI surfaces', () => {
    assert.ok(cloudAgentReport.score > 0, `expected cloud-agent repo to have a score, got ${cloudAgentReport.score}`);
    assert.ok(cloudAgentReport.results.find(item => item.key === 'copilotInstructionsExists').passed);
    assert.ok(cloudAgentReport.results.find(item => item.key === 'copilotAgentModeEnabled').passed);
  });

  // ─── G4: multi-platform ────────────────────────────────────────────

  test('G4: multi-platform repo detects Copilot surfaces alongside Claude and Gemini', () => {
    assert.ok(multiPlatformReport.results.find(item => item.key === 'copilotInstructionsExists').passed);
    assert.ok(multiPlatformReport.results.find(item => item.key === 'copilotVscodeSettingsExists').passed);
    assert.ok(multiPlatformReport.score >= 60, `expected multi-platform score >= 60, got ${multiPlatformReport.score}`);
    // Verify the Copilot platform audit covers all 81 checks regardless of other platform presence
    assert.strictEqual(multiPlatformReport.results.length, 81, `expected 81 checks in multi-platform audit, got ${multiPlatformReport.results.length}`);
  });

  // ─── G5: enterprise (content exclusions) ────────────────────────────

  test('G5: enterprise repo validates content exclusions and security posture', () => {
    assert.ok(enterpriseReport.score > 0, `expected enterprise repo to have a score, got ${enterpriseReport.score}`);
    assert.ok(enterpriseReport.results.find(item => item.key === 'copilotContentExclusions').passed);
    assert.ok(enterpriseReport.results.find(item => item.key === 'copilotInstructionsExists').passed);
  });

  for (const scenario of [empty, rich, cloudAgent, multiPlatform, enterprise]) {
    fs.rmSync(scenario.dir, { recursive: true, force: true });
    if (scenario.homeDir) {
      fs.rmSync(scenario.homeDir, { recursive: true, force: true });
    }
  }

  console.log('\n  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log(`  Copilot Golden Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
