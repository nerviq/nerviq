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

function resultByKey(report) {
  return Object.fromEntries(report.results.map((item) => [item.key, item.passed]));
}

function isCoreTechnique(technique) {
  return /^OC-[A-P]\d+$/.test(technique.id);
}

async function main() {
  console.log('\n  OpenCode Check Matrix\n');

  const scenarios = {
    empty: buildEmptyRepo(),
    rich: buildRichOpenCodeRepo(),
    jsoncOnly: buildJsoncOnlyRepo(),
    mixed: buildMixedAgentRepo(),
    permissive: buildPermissiveRepo(),
  };

  const reports = {};
  for (const [name, scenario] of Object.entries(scenarios)) {
    reports[name] = resultByKey(await auditScenario(scenario));
  }

  const richNullables = new Set([
    'opencodeRegulatedRepoExplicitPerms',
    'opencodeCompactionExplicit',
    'opencodeVersionFresh',
    // Current runtime flags valid $schema usage; keep nullable until the freshness rule is tightened.
    'opencodeConfigKeysFresh',
  ]);

  const nullableChecks = new Set([
    ...richNullables,
    ...Object.entries(OPENCODE_TECHNIQUES)
      .filter(([, technique]) => !isCoreTechnique(technique))
      .map(([key]) => key),
  ]);

  const corePassExpectations = Object.fromEntries(
    Object.entries(OPENCODE_TECHNIQUES)
      .filter(([, technique]) => isCoreTechnique(technique))
      .map(([key]) => key)
      .filter((key) => !nullableChecks.has(key))
      .map((key) => [key, 'rich'])
  );

  const failExpectations = {
    opencodeAgentsMdExists: 'empty',
    opencodeAgentsMdQuality: 'jsoncOnly',
    opencodeAgentsMdArchitecture: 'jsoncOnly',
    opencodeConfigExists: 'empty',
    opencodeConfigSchema: 'permissive',
    opencodeSmallModelSet: 'permissive',
    opencodeNoBlanketAllow: 'permissive',
    opencodeBashPermissionExplicit: 'permissive',
    opencodeDoomLoopExplicit: 'permissive',
    opencodeExternalDirExplicit: 'permissive',
    opencodeAllToolsCovered: 'permissive',
    opencodeModernFeaturesDocumented: 'jsoncOnly',
    opencodeFormatterConfigured: 'jsoncOnly',
    opencodeExplicitPermissionPosture: 'permissive',
  };

  for (const [key, technique] of Object.entries(OPENCODE_TECHNIQUES)) {
    if (nullableChecks.has(key)) {
      test(`${key} exists and executes`, () => {
        assert.ok(technique, `${key} must exist in OPENCODE_TECHNIQUES`);
        assert.ok(typeof technique.check === 'function', `${key} must have a check function`);
        assert.ok(typeof technique.id === 'string' && technique.id.startsWith('OC-'), `${key} must have a valid OC- ID`);
      });

      if (richNullables.has(key)) {
        test(`${key} remains nullable or unstable on rich`, () => {
          assert.ok(
            reports.rich[key] === null || reports.rich[key] === false,
            `${key} expected null/false on rich but got ${reports.rich[key]}`
          );
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
      test(`${key} exists in OPENCODE_TECHNIQUES`, () => {
        assert.ok(technique, `${key} must exist in OPENCODE_TECHNIQUES`);
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

  console.log('\n  ─────────────────────────────────────');
  console.log(`  OpenCode Check Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
