const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('../src/audit');
const {
  withTempHome,
  buildEmptyRepo,
  buildRichGeminiRepo,
  buildYoloRepo,
  buildCiEnvBugRepo,
  buildMultiPlatformRepo,
} = require('./gemini-fixtures');

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
  const ephemeralHome = scenario.homeDir || fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-gemini-home-'));
  try {
    return await withTempHome(ephemeralHome, () => audit({ dir: scenario.dir, platform: 'gemini', silent: true }));
  } finally {
    if (!scenario.homeDir) {
      fs.rmSync(ephemeralHome, { recursive: true, force: true });
    }
  }
}

async function main() {
  console.log('\n  Gemini Golden Matrix\n');

  const empty = buildEmptyRepo();
  const rich = buildRichGeminiRepo();
  const yoloDanger = buildYoloRepo();
  const ciHeavy = buildCiEnvBugRepo();
  const multiPlatform = buildMultiPlatformRepo();

  const emptyReport = await auditScenario(empty);
  const richReport = await auditScenario(rich);
  const yoloDangerReport = await auditScenario(yoloDanger);
  const ciHeavyReport = await auditScenario(ciHeavy);
  const multiPlatformReport = await auditScenario(multiPlatform);

  // ─── G1: empty repo ──────────────────────────────────────────────────

  test('G1: empty Gemini repo stays low-scoring and points to GEMINI.md/settings first', () => {
    // Trust-killer #3 fix landed: no Gemini surface → insufficient signal,
    // score 0 (the band had been widened to <= 90 around an inflated 84/100).
    assert.strictEqual(emptyReport.signal, 'insufficient', `expected insufficient signal on an empty repo, got ${emptyReport.signal}`);
    assert.ok(emptyReport.score <= 10, `expected empty repo score <= 10, got ${emptyReport.score}`);
    const topKeys = emptyReport.topNextActions.map(item => item.key);
    assert.ok(
      topKeys.includes('geminiMdExists') || topKeys.includes('geminiSettingsExists'),
      `expected top actions to include geminiMdExists or geminiSettingsExists, got: ${topKeys.slice(0, 5).join(', ')}`
    );
  });

  // ─── G2: rich repo ──────────────────────────────────────────────────

  test('G2: rich Gemini repo lands in a high-confidence band', () => {
    assert.ok(richReport.score >= 60, `expected rich repo score >= 60, got ${richReport.score}`);
    assert.ok(richReport.results.find(item => item.key === 'geminiMdExists').passed);
    assert.ok(richReport.results.find(item => item.key === 'geminiSettingsValidJson').passed);
    assert.ok(richReport.results.find(item => item.key === 'geminiMcpExcludeTools').passed);
    assert.ok(richReport.results.find(item => item.key === 'geminiNoYolo').passed);
    assert.ok(richReport.results.find(item => item.key === 'geminiSandboxModeExplicit').passed);
  });

  // ─── G3: yolo-danger ────────────────────────────────────────────────

  test('G3: yolo-danger repo flags critical safety checks', () => {
    const yoloCheck = yoloDangerReport.results.find(item => item.key === 'geminiNoYolo');
    assert.strictEqual(yoloCheck.passed, false, 'geminiNoYolo should fail');
    const sandboxCheck = yoloDangerReport.results.find(item => item.key === 'geminiSandboxExplicit');
    assert.strictEqual(sandboxCheck.passed, false, 'geminiSandboxExplicit should fail');
    assert.ok(
      yoloDangerReport.topNextActions.some(item => item.key === 'geminiNoYolo'),
      'expected geminiNoYolo in top actions'
    );
  });

  // ─── G4: ci-heavy ──────────────────────────────────────────────────

  test('G4: CI-heavy repo flags environment variable and automation concerns', () => {
    assert.ok(ciHeavyReport.score > 0, `expected CI repo to have a score, got ${ciHeavyReport.score}`);
    // CI repos should detect missing sandbox mode and rate limit awareness
    const sandboxCheck = ciHeavyReport.results.find(item => item.key === 'geminiSandboxModeExplicit');
    assert.strictEqual(sandboxCheck.passed, false, 'geminiSandboxModeExplicit should fail on CI repo');
    const rateCheck = ciHeavyReport.results.find(item => item.key === 'geminiRateLimitAwareness');
    assert.strictEqual(rateCheck.passed, false, 'geminiRateLimitAwareness should fail on CI repo');
  });

  // ─── G5: multi-platform ────────────────────────────────────────────

  test('G5: multi-platform repo detects both Gemini and Claude surfaces exist', () => {
    // Gemini audit runs Gemini-specific checks even when Claude surfaces coexist
    assert.ok(multiPlatformReport.results.find(item => item.key === 'geminiMdExists').passed);
    assert.ok(multiPlatformReport.results.find(item => item.key === 'geminiSettingsValidJson').passed);
    assert.ok(multiPlatformReport.score >= 60, `expected multi-platform score >= 60, got ${multiPlatformReport.score}`);
    // Verify the Gemini platform audit covers the full Gemini check surface
    // regardless of Claude presence. Compare against the empty-repo Gemini
    // audit instead of a hardcoded count — the hardcoded "82" went stale when
    // the Gemini catalog grew to 300 checks.
    assert.strictEqual(
      multiPlatformReport.results.length,
      emptyReport.results.length,
      `expected multi-platform Gemini audit to cover the same ${emptyReport.results.length} checks as a single-platform audit, got ${multiPlatformReport.results.length}`
    );
  });

  for (const scenario of [empty, rich, yoloDanger, ciHeavy, multiPlatform]) {
    fs.rmSync(scenario.dir, { recursive: true, force: true });
    if (scenario.homeDir) {
      fs.rmSync(scenario.homeDir, { recursive: true, force: true });
    }
  }

  console.log('\n  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log(`  Gemini Golden Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
