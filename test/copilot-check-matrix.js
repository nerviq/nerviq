const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('../src/audit');
const { COPILOT_TECHNIQUES } = require('../src/copilot/techniques');
const {
  withTempHome,
  buildEmptyRepo,
  buildRichCopilotRepo,
  buildNoInstructionsRepo,
  buildDeprecatedSettingsRepo,
  buildCloudAgentRepo,
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

function resultByKey(report) {
  return Object.fromEntries(report.results.map(item => [item.key, item.passed]));
}

async function main() {
  console.log('\n  Copilot Check Matrix\n');

  const scenarios = {
    empty: buildEmptyRepo(),
    rich: buildRichCopilotRepo(),
    noInstructions: buildNoInstructionsRepo(),
    deprecated: buildDeprecatedSettingsRepo(),
    cloudAgent: buildCloudAgentRepo(),
    contentExclusion: buildContentExclusionRepo(),
  };

  const reports = {};
  for (const [name, scenario] of Object.entries(scenarios)) {
    reports[name] = resultByKey(await auditScenario(scenario));
  }

  // ─── Pass/Fail expectations ─────────────────────────────────────────
  //
  // For each technique key: which scenario MUST return true (pass) and
  // which scenario MUST return false (fail). Only checks with clear
  // true/false coverage from existing fixtures are listed here.

  const passExpectations = {
    copilotInstructionsExists: 'rich',
    copilotInstructionsSubstantive: 'rich',
    copilotInstructionsCommands: 'rich',
    copilotInstructionsNoFiller: 'rich',
    copilotInstructionsNoSecrets: 'rich',
    copilotVscodeSettingsExists: 'rich',
    copilotVscodeSettingsValidJson: 'rich',
    copilotTerminalSandboxEnabled: 'rich',
    copilotMcpConfigured: 'rich',
    copilotContentExclusions: 'rich',
    copilotModernFeatures: 'rich',
    copilotAgentModeEnabled: 'rich',
  };

  const failExpectations = {
    copilotInstructionsExists: 'empty',
  };

  // Checks that intentionally return N/A (null) on the empty repo since the
  // PP-01 real-world calibration (fdee641): a repo with no .vscode/settings.json
  // is "not VS Code-configured", not failing, and a repo with no MCP surface at
  // all is not penalised for missing .vscode/mcp.json. These used to be listed
  // in failExpectations, which broke once the checks' documented N/A semantics
  // landed ("expected false on empty but got null"). Pin the N/A contract here
  // instead so a regression back to false/true is still caught.
  const naExpectations = {
    copilotVscodeSettingsExists: 'empty',
    copilotTerminalSandboxEnabled: 'empty',
    copilotMcpConfigured: 'empty',
  };

  // CP-08 checks + checks that require specialized fixtures beyond our standard set.
  // These are verified for existence and executability only.
  const cp08Checks = new Set([
    // CP-08: N. Advisory Quality
    'copilotAdvisoryInstructionQuality', 'copilotAdvisorySecurityPosture',
    'copilotAdvisorySurfaceCoverage', 'copilotAdvisoryMcpHealth',
    // CP-08: O. Pack Posture
    'copilotPackDomainDetected', 'copilotPackMcpRecommended',
    'copilotPackGovernanceApplied', 'copilotPackConsistency',
    // CP-08: P. Repeat-Usage Hygiene
    'copilotRepeatScoreImproved', 'copilotRepeatNoRegressions', 'copilotRepeatFeedbackLoop',
    // Checks requiring specialized conditions not in standard fixtures:
    'copilotScopedInstructionsFrontmatter', 'copilotNoOrgContradiction',
    'copilotNoDeprecatedCodeGenInstructions', 'copilotCloudAgentSetup',
    'copilotPromptFilesValid', 'copilotCloudContentExclusionGap',
    'copilotNoWindowsSandbox', 'copilotAutoApprovalSpecific',
    'copilotCloudAgentPRReview', 'copilotDataUsageOptOut',
    'copilotNoSecretsInCloudSetup', 'copilotMcpOrgAllowlist',
    'copilotMcpCloudNoOAuth', 'copilotMcpToolRestrictions',
    'copilotMcpConsistentAcrossSurfaces', 'copilotMcpAuthDocumented',
    'copilotCloudDependencyInstall', 'copilotCloudTestConfigured',
    'copilotCloudSignedCommits', 'copilotCloudNoUnsafeEnvVars',
    'copilotCloudImplementationPlan',
    'copilotOrgPoliciesConfigured', 'copilotThirdPartyAgentPolicy',
    'copilotAuditLogsEnabled', 'copilotModelAccessPolicy',
    'copilotContentExclusionPropagation',
    'copilotPromptDirExists', 'copilotPromptFilesValidFrontmatter',
    'copilotPromptParameterization', 'copilotNoDuplicatePromptNames',
    'copilotAgentsMdEnabled', 'copilotSpacesIndexed',
    'copilotWorkingSetAppropriate', 'copilotChatParticipants',
    'copilotActiveInstructions', 'copilotDevContainerSupport',
    'copilotCliInstalled', 'copilotCliMcp', 'copilotCliAliases',
    'copilotCliAuthToken',
    'copilotCrossSurfaceInstructions', 'copilotCrossSurfaceMcp',
    'copilotCrossSurfaceModel', 'copilotCrossSurfaceSecurity',
    'copilotCrossSurfaceExclusions',
    'copilotBYOKConfigured', 'copilotFineTunedModelScoped',
    'copilotAuditRetention', 'copilotMcpRegistryAllowlist',
    'copilotThirdPartyAgentGoverned',
    'copilotNoDeprecatedReferences', 'copilotColdBootAwareness',
    'copilotBillingAwareness', 'copilotReviewCharLimit',
    'copilotInstructionDuplication',
    'copilotNoDeprecatedSettings',
    // Checks requiring specific instruction content patterns:
    'copilotModelExplicit', 'copilotExtensionsMode',
  ]);

  for (const key of Object.keys(COPILOT_TECHNIQUES)) {
    if (cp08Checks.has(key)) {
      // CP-08 and specialized checks: verify they exist and run without errors
      test(`${key} (CP-08) exists and executes`, () => {
        const technique = COPILOT_TECHNIQUES[key];
        assert.ok(technique, `${key} must exist in COPILOT_TECHNIQUES`);
        assert.ok(typeof technique.check === 'function', `${key} must have a check function`);
        assert.ok(technique.id && technique.id.match(/^CP-[A-P]\d+$/), `${key} must have a valid CP- ID`);
      });
      continue;
    }

    const passScenario = passExpectations[key];
    const failScenario = failExpectations[key];
    const naScenario = naExpectations[key];

    // Every non-CP-08 check must have a pass expectation
    if (passScenario) {
      test(`${key} passes on ${passScenario}`, () => {
        assert.strictEqual(reports[passScenario][key], true, `${key} expected true on ${passScenario} but got ${reports[passScenario][key]}`);
      });
    }

    // Checks with a fail expectation must fail (return false) on that scenario
    if (failScenario) {
      test(`${key} fails on ${failScenario}`, () => {
        assert.strictEqual(reports[failScenario][key], false, `${key} expected false on ${failScenario} but got ${reports[failScenario][key]}`);
      });
    }

    // Checks with an N/A expectation must return null (not-applicable) there
    if (naScenario) {
      test(`${key} is N/A on ${naScenario}`, () => {
        assert.strictEqual(reports[naScenario][key], null, `${key} expected null (N/A) on ${naScenario} but got ${reports[naScenario][key]}`);
      });
    }

    // Checks with neither pass nor fail should at least exist
    if (!passScenario && !failScenario) {
      test(`${key} exists in COPILOT_TECHNIQUES`, () => {
        assert.ok(COPILOT_TECHNIQUES[key], `${key} must exist in COPILOT_TECHNIQUES`);
        assert.ok(typeof COPILOT_TECHNIQUES[key].check === 'function', `${key} must have a check function`);
      });
    }
  }

  for (const scenario of Object.values(scenarios)) {
    fs.rmSync(scenario.dir, { recursive: true, force: true });
    if (scenario.homeDir) {
      fs.rmSync(scenario.homeDir, { recursive: true, force: true });
    }
  }

  console.log('\n  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log(`  Copilot Check Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
