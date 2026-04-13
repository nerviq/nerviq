const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

function resultByKey(report) {
  return Object.fromEntries(report.results.map((item) => [item.key, item.passed]));
}

function isCoreTechnique(technique) {
  return /^AD-[A-P]\d+$/.test(technique.id);
}

async function main() {
  console.log('\n  Aider Check Matrix\n');

  const scenarios = {
    empty: buildEmptyRepo(),
    rich: buildRichAiderRepo(),
    noConfig: buildNoConfigRepo(),
    gitOnly: buildGitOnlyRepo(),
    dirty: buildDirtyAiderRepo(),
  };

  const reports = {};
  for (const [name, scenario] of Object.entries(scenarios)) {
    reports[name] = resultByKey(await auditScenario(scenario));
  }

  const richNullables = new Set([
    'aiderSubtreeUsedForLargeRepos',
    'aiderRegulatedRepoHasGuardrails',
    'aiderCiExitCodeUnreliable',
    // PP-04: Dark mode is a developer preference, never a project requirement.
    'aiderDarkModeConfigured',
  ]);

  // PP-04: scenario-specific N/A — these checks are intentionally N/A on
  // scenarios that previously expected an explicit false. The previous
  // `false` was an audit FP (the fixture has no Aider surface or no
  // .aider.conf.yml, so the check's preconditions are not met).
  const pp04NullableByScenario = {
    aiderConfYmlExists: 'empty',
    aiderUndoSafetyAware: 'noConfig',
    aiderEditorModelConfigured: 'noConfig',
    aiderWeakModelConfigured: 'noConfig',
    aiderModelSettingsFileExists: 'noConfig',
    aiderConventionFileExists: 'empty',
    aiderAiderignoreExists: 'noConfig',
    aiderEnvInGitignore: 'gitOnly',
    aiderEnvFileExists: 'noConfig',
    aiderBrowserModeForDocs: 'noConfig',
    aiderPlaywrightUrlScraping: 'noConfig',
    aiderVersionPinned: 'noConfig',
    aiderAllConfigSurfacesPresent: 'noConfig',
    aiderDocumentedWorkflow: 'gitOnly',
  };

  const nullableChecks = new Set([
    ...richNullables,
    ...Object.entries(AIDER_TECHNIQUES)
      .filter(([, technique]) => !isCoreTechnique(technique))
      .map(([key]) => key),
  ]);

  const corePassExpectations = Object.fromEntries(
    Object.entries(AIDER_TECHNIQUES)
      .filter(([, technique]) => isCoreTechnique(technique))
      .map(([key]) => key)
      .filter((key) => !nullableChecks.has(key))
      .map((key) => [key, 'rich'])
  );

  // PP-04: Removed entries are now intentionally N/A on the listed scenario
  // (see pp04NullableByScenario above) — those are corrections to prior
  // false-positive expectations on fixtures missing the Aider preconditions.
  const failExpectations = {
    aiderGitRepoExists: 'empty',
    aiderGitignoreCoversArtifacts: 'gitOnly',
    aiderDirtyTreeCheck: 'dirty',
    aiderChatHistoryExcluded: 'gitOnly',
    aiderCiWorkflowExists: 'noConfig',
    aiderGitHooksForPreCommit: 'noConfig',
    aiderInputHistoryExcluded: 'gitOnly',
    aiderGitBranchStrategy: 'noConfig',
  };

  for (const [key, technique] of Object.entries(AIDER_TECHNIQUES)) {
    if (nullableChecks.has(key)) {
      test(`${key} exists and executes`, () => {
        assert.ok(technique, `${key} must exist in AIDER_TECHNIQUES`);
        assert.ok(typeof technique.check === 'function', `${key} must have a check function`);
        assert.ok(typeof technique.id === 'string' && technique.id.startsWith('AD-'), `${key} must have a valid AD- ID`);
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

    // PP-04: scenario-specific N/A expectation
    const naScenario = pp04NullableByScenario[key];
    if (naScenario) {
      test(`${key} is N/A on ${naScenario} (PP-04)`, () => {
        assert.strictEqual(reports[naScenario][key], null, `${key} expected null on ${naScenario} but got ${reports[naScenario][key]}`);
      });
    }

    if (!passScenario && !failScenario && !naScenario) {
      test(`${key} exists in AIDER_TECHNIQUES`, () => {
        assert.ok(technique, `${key} must exist in AIDER_TECHNIQUES`);
        assert.ok(typeof technique.check === 'function', `${key} must have a check function`);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // PP-04 regression tests — verifies behaviours newly added during the
  // PP-04 Aider Platform Parity calibration.
  // ---------------------------------------------------------------------------

  // (1) .aider.conf.yaml (alt extension) is recognised as a valid Aider config.
  const yamlExtRepo = (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-aider-pp04-yaml-'));
    fs.writeFileSync(path.join(dir, '.aider.conf.yaml'), 'model: gpt-4o\nauto-commits: true\n');
    fs.writeFileSync(path.join(dir, 'README.md'), '# yaml ext aider\nUses aider with .aider.conf.yaml.\n');
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n.aider*\n');
    require('child_process').spawnSync('git', ['init'], { cwd: dir });
    return { dir };
  })();
  const yamlExtReport = resultByKey(await auditScenario(yamlExtRepo));
  test('PP-04: .aider.conf.yaml is recognised (aiderConfYmlExists passes)', () => {
    assert.strictEqual(yamlExtReport.aiderConfYmlExists, true);
  });

  // (2) AGENTS.md / CLAUDE.md count as valid convention surfaces when no
  // CONVENTIONS.md exists.
  const agentsAsConvRepo = (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-aider-pp04-agents-'));
    fs.writeFileSync(path.join(dir, '.aider.conf.yml'), 'model: gpt-4o\n');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Agents\nThis project uses Aider.\n');
    fs.writeFileSync(path.join(dir, 'README.md'), 'aider workflow\n');
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n');
    require('child_process').spawnSync('git', ['init'], { cwd: dir });
    return { dir };
  })();
  const agentsReport = resultByKey(await auditScenario(agentsAsConvRepo));
  test('PP-04: AGENTS.md counts as a convention surface (aiderConventionFileExists passes)', () => {
    assert.strictEqual(agentsReport.aiderConventionFileExists, true);
  });

  // (3) .env.example satisfies aiderEnvFileExists when no committed .env.
  const envExampleRepo = (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-aider-pp04-envex-'));
    fs.writeFileSync(path.join(dir, '.aider.conf.yml'), 'model: gpt-4o\n');
    fs.writeFileSync(path.join(dir, '.env.example'), 'OPENAI_API_KEY=sk-...\n');
    fs.writeFileSync(path.join(dir, 'README.md'), '# aider repo\n');
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n');
    require('child_process').spawnSync('git', ['init'], { cwd: dir });
    return { dir };
  })();
  const envReport = resultByKey(await auditScenario(envExampleRepo));
  test('PP-04: .env.example satisfies aiderEnvFileExists', () => {
    assert.strictEqual(envReport.aiderEnvFileExists, true);
  });
  test('PP-04: .env.example satisfies aiderAllConfigSurfacesPresent', () => {
    assert.strictEqual(envReport.aiderAllConfigSurfacesPresent, true);
  });

  // (4) Repos with no Aider surface at all → aiderConfYmlExists is N/A
  // (was a 5/10 FP on the baseline external corpus).
  const noAiderRepo = (() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-aider-pp04-noaider-'));
    fs.writeFileSync(path.join(dir, 'README.md'), '# Just a regular repo\nNo AI tooling here.\n');
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"plain"}\n');
    fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n');
    require('child_process').spawnSync('git', ['init'], { cwd: dir });
    return { dir };
  })();
  const noAiderReport = resultByKey(await auditScenario(noAiderRepo));
  test('PP-04: aiderConfYmlExists is N/A on a repo with no Aider surface', () => {
    assert.strictEqual(noAiderReport.aiderConfYmlExists, null);
  });
  test('PP-04: aiderConventionFileExists is N/A on a repo with no Aider surface', () => {
    assert.strictEqual(noAiderReport.aiderConventionFileExists, null);
  });

  // Cleanup PP-04 fixtures
  for (const fx of [yamlExtRepo, agentsAsConvRepo, envExampleRepo, noAiderRepo]) {
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }

  for (const scenario of Object.values(scenarios)) {
    fs.rmSync(scenario.dir, { recursive: true, force: true });
  }

  console.log('\n  ─────────────────────────────────────');
  console.log(`  Aider Check Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
