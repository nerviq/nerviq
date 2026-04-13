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

async function asyncTest(name, fn) {
  try {
    await fn();
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

function resultByKey(report) {
  return Object.fromEntries(report.results.map((item) => [item.key, item.passed]));
}

function isCoreTechnique(technique) {
  return /^WS-[A-P]\d+$/.test(technique.id);
}

async function main() {
  console.log('\n  Windsurf Check Matrix\n');

  const scenarios = {
    empty: buildEmptyRepo(),
    rich: buildRichWindsurfRepo(),
    legacy: buildLegacyWindsurfrules(),
    cascade: buildCascadeFocusedRepo(),
    multi: buildMultiPlatformRepo(),
  };

  const reports = {};
  for (const [name, scenario] of Object.entries(scenarios)) {
    reports[name] = resultByKey(await auditScenario(scenario));
  }

  const richNullables = new Set([
    'windsurfMcpTeamWhitelist',
    'windsurfNoDeprecatedPatterns',
    'windsurfAlwaysRulesMinimized',
    'windsurfRepeatScoreImproved',
    'windsurfRepeatNoRegressions',
    'windsurfRepeatFeedbackLoop',
    'windsurfFreshnessSourcesVerified',
    'windsurfFreshnessPropagation',
  ]);

  // PP-03 calibration: these checks are N/A when the relevant subsystem
  // is not opted in (see exp-pp-04-windsurf-fp-2026-04-14). They can
  // legitimately pass, fail, or be N/A depending on the scenario, so
  // we only assert their existence here.
  const pp03NullableByScenario = new Set([
    'windsurfWorkflowsExist',     // N/A when no .windsurf/workflows/
    'windsurfMemoriesConfigured', // N/A when no .windsurf/memories/
    'windsurfAdvisoryMcpHealth',  // N/A when no Windows/WSL docs
    'windsurfPackMcpRecommended', // N/A when no MCP signals
  ]);

  const nullableChecks = new Set([
    ...richNullables,
    ...pp03NullableByScenario,
    ...Object.entries(WINDSURF_TECHNIQUES)
      .filter(([, technique]) => !isCoreTechnique(technique))
      .map(([key]) => key),
  ]);

  const corePassExpectations = Object.fromEntries(
    Object.entries(WINDSURF_TECHNIQUES)
      .filter(([, technique]) => isCoreTechnique(technique))
      .map(([key]) => key)
      .filter((key) => !nullableChecks.has(key))
      .map((key) => [key, 'rich'])
  );

  const failExpectations = {
    windsurfRulesExist: 'empty',
    windsurfNoLegacyWindsurfrules: 'legacy',
    windsurfRulesReachCascade: 'legacy',
    windsurfNoDeprecatedPatterns: 'legacy',
  };

  for (const [key, technique] of Object.entries(WINDSURF_TECHNIQUES)) {
    if (nullableChecks.has(key)) {
      test(`${key} exists and executes`, () => {
        assert.ok(technique, `${key} must exist in WINDSURF_TECHNIQUES`);
        assert.ok(typeof technique.check === 'function', `${key} must have a check function`);
        assert.ok(typeof technique.id === 'string' && technique.id.startsWith('WS-'), `${key} must have a valid WS- ID`);
      });

      if (richNullables.has(key)) {
        test(`${key} is currently nullable on rich`, () => {
          assert.strictEqual(reports.rich[key], null, `${key} expected null on rich but got ${reports.rich[key]}`);
        });
      }

      continue;
    }

    const passScenario = corePassExpectations[key];
    const failScenario = failExpectations[key];

    if (passScenario) {
      test(`${key} passes on ${passScenario}`, () => {
        assert.strictEqual(reports[passScenario][key], true, `${key} expected true on ${passScenario} but got ${reports[passScenario][key]}`);
      });
    }

    if (failScenario) {
      test(`${key} fails on ${failScenario}`, () => {
        assert.strictEqual(reports[failScenario][key], false, `${key} expected false on ${failScenario} but got ${reports[failScenario][key]}`);
      });
    }

    if (!passScenario && !failScenario) {
      test(`${key} exists in WINDSURF_TECHNIQUES`, () => {
        assert.ok(technique, `${key} must exist in WINDSURF_TECHNIQUES`);
        assert.ok(typeof technique.check === 'function', `${key} must have a check function`);
      });
    }
  }

  for (const scenario of Object.values(scenarios)) {
    fs.rmSync(scenario.dir, { recursive: true, force: true });
    if (scenario.homeDir) {
      fs.rmSync(scenario.homeDir, { recursive: true, force: true });
    }
  }

  // ─── PP-03 regression: pointer .windsurfrules + .windsurfrules/ dir ───

  await asyncTest('PP-03: pointer .windsurfrules expands to the referenced file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-windsurf-pp03-pointer-'));
    try {
      // Pointer file — one line naming the real instruction surface.
      fs.writeFileSync(path.join(dir, '.windsurfrules'), '.ai/instructions.md\n');
      fs.mkdirSync(path.join(dir, '.ai'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.ai/instructions.md'),
        '# Real instructions\n\n- Run `npm test` before completing work.\n- Architecture section below.\n\n## Architecture\n\nAll code lives in src/.\n');
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'pp03-pointer', scripts: { test: 'jest' },
      }));
      const report = await auditScenario({ dir });
      const byKey = resultByKey(report);
      assert.strictEqual(byKey.windsurfRulesExist, true,
        'windsurfRulesExist should pass when .windsurfrules is a pointer to a real instruction surface');
      assert.notStrictEqual(byKey.windsurfNoDeprecatedPatterns, false,
        'pointer .windsurfrules is not the deprecated raw single-file form');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await asyncTest('PP-03: .windsurfrules directory form is a first-class rules surface', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-windsurf-pp03-dir-'));
    try {
      fs.mkdirSync(path.join(dir, '.windsurfrules'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.windsurfrules/building.mdc'),
        '# Build and run\n\nUse `npm run build`.\n');
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'pp03-dir', scripts: { build: 'tsc' },
      }));
      const report = await auditScenario({ dir });
      const byKey = resultByKey(report);
      assert.strictEqual(byKey.windsurfRulesExist, true,
        'windsurfRulesExist should pass when .windsurfrules is a directory of rule files');
      assert.notStrictEqual(byKey.windsurfNoDeprecatedPatterns, false,
        '.windsurfrules/ directory convention is not the deprecated raw single-file form');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await asyncTest('PP-03: windsurfAdvisoryMcpHealth is N/A when repo does not use Windows/WSL', async () => {
    // Re-use the empty fixture — it has only package.json, no Windows/WSL mention.
    const empty = buildEmptyRepo();
    try {
      const report = await auditScenario(empty);
      const byKey = resultByKey(report);
      assert.strictEqual(byKey.windsurfAdvisoryMcpHealth, null,
        'windsurfAdvisoryMcpHealth should be N/A (not a systematic fail) when the target repo does not document Windows/WSL use');
    } finally {
      fs.rmSync(empty.dir, { recursive: true, force: true });
    }
  });

  console.log('\n  ─────────────────────────────────────');
  console.log(`  Windsurf Check Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
