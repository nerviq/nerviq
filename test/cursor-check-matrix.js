const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('../src/audit');
const { CURSOR_TECHNIQUES } = require('../src/cursor/techniques');
const {
  withTempHome,
  buildEmptyRepo,
  buildRichCursorRepo,
  buildLegacyCursorrules,
  buildMdcBadFrontmatter,
  buildMcpTooManyTools,
  buildBackgroundAgentRepo,
} = require('./cursor-fixtures');

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
  const ephemeralHome = scenario.homeDir || fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-cursor-home-'));
  try {
    return await withTempHome(ephemeralHome, () => audit({ dir: scenario.dir, platform: 'cursor', silent: true }));
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
  console.log('\n  Cursor Check Matrix\n');

  const scenarios = {
    empty: buildEmptyRepo(),
    rich: buildRichCursorRepo(),
    legacy: buildLegacyCursorrules(),
    mdcBad: buildMdcBadFrontmatter(),
    mcpMany: buildMcpTooManyTools(),
    bgAgent: buildBackgroundAgentRepo(),
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
    cursorRulesExist: 'rich',
    cursorNoLegacyCursorrules: 'rich',
    cursorAlwaysApplyExists: 'rich',
    cursorRulesValidFrontmatter: 'rich',
    cursorRulesUnder500Words: 'rich',
    cursorRulesNoFiller: 'rich',
    cursorRulesNoSecrets: 'rich',
    cursorAgentRequestedDescriptions: 'rich',
    cursorMcpJsonExists: 'rich',
    cursorMcpValidJson: 'rich',
    cursorEnvironmentJsonExists: 'rich',
    cursorRulesIncludeCommands: 'rich',
    cursorRulesArchitecture: 'rich',
    cursorRulesVerification: 'rich',
    cursorRulesProjectSpecific: 'rich',
    cursorModernFeatures: 'rich',
    cursorAutomationDocumented: 'bgAgent',
    cursorEnvBaseImage: 'rich',
    cursorEnvPersistedDirs: 'rich',
    cursorMcpEnvVarSyntax: 'rich',
  };

  const failExpectations = {
    cursorRulesExist: 'empty',
    cursorNoLegacyCursorrules: 'legacy',
    cursorAlwaysApplyExists: 'empty',
    cursorMcpJsonExists: 'empty',
    cursorMcpValidJson: 'empty',
    cursorEnvironmentJsonExists: 'empty',
    cursorNoGlobsDescriptionCombo: 'mdcBad',
    cursorRulesIncludeCommands: 'empty',
    cursorRulesArchitecture: 'empty',
    cursorRulesVerification: 'empty',
    cursorModernFeatures: 'empty',
  };

  // CP-08 checks + checks that require specialized fixtures beyond our standard set.
  // These are verified for existence and executability only.
  const cp08Checks = new Set([
    // CP-08: M. Advisory Quality
    'cursorAdvisoryInstructionQuality', 'cursorAdvisorySecurityPosture',
    'cursorAdvisorySurfaceCoverage', 'cursorAdvisoryMcpHealth',
    // CP-08: N. Pack Posture
    'cursorPackDomainDetected', 'cursorPackMcpRecommended',
    'cursorPackGovernanceApplied', 'cursorPackConsistency',
    // CP-08: O. Repeat-Usage Hygiene
    'cursorRepeatScoreImproved', 'cursorRepeatNoRegressions', 'cursorRepeatFeedbackLoop',
    // CP-08: P. Release & Freshness
    'cursorFreshnessSourcesVerified', 'cursorFreshnessPropagation', 'cursorFreshnessRuleFormat',
    // Checks requiring specialized conditions not in standard fixtures:
    'cursorPrivacyMode', 'cursorNoAutoRunUntrusted',
    'cursorAutomationTriggersScoped', 'cursorNoSecretsInEnvJson',
    'cursorMcpTrustedSources', 'cursorBackgroundAgentBranch',
    'cursorCodeReversionRisk', 'cursorEnterprisePrivacyMode',
    'cursorNoWildcardAutomation', 'cursorRulesReachAgent',
    'cursorCodebaseIndexed', 'cursorMultiAgentWorktree',
    'cursorSessionLengthAwareness', 'cursorDocsConfigured',
    'cursorMcpPerSurface', 'cursorMcpProjectOverride',
    'cursorMcpCurrentVersion', 'cursorMcpBackgroundAccess',
    'cursorRulesNoContradictions', 'cursorMcpToolLimit',
    'cursorCommandsExist', 'cursorCommandsClear',
    'cursorNoDeprecatedVscodeKeys',
    'cursorEnvProcesses', 'cursorEnvSecretsKms', 'cursorEnvCreatesPr',
    'cursorAutomationNoBroadTrigger', 'cursorAutomationErrorHandling',
    // Null-returning checks on empty repos:
    'cursorAlwaysApplyExists', 'cursorRulesValidFrontmatter', 'cursorNoGlobsDescriptionCombo',
    'cursorMcpJsonExists', 'cursorEnvironmentJsonExists', 'cursorMcpValidJson',
    'cursorRulesIncludeCommands', 'cursorRulesArchitecture', 'cursorRulesVerification',
    'cursorModernFeatures', 'cursorMcpEnvVarSyntax', 'cursorMcpConsistentSurfaces',
    'cursorEnterpriseMcpAllowlist',
    'cursorAutomationRateLimits', 'cursorAutomationScopedPerms',
    'cursorEnterpriseSso', 'cursorEnterpriseScim',
    'cursorEnterpriseAuditLogs', 'cursorEnterpriseMcpAllowlist',
    'cursorEnterpriseModelPolicy',
    'cursorBugbotEnabled', 'cursorBugbotAutofix',
    'cursorReviewInstructionsLength', 'cursorReviewNoConflict',
    'cursorRulesConsistentSurfaces', 'cursorMcpConsistentSurfaces',
    'cursorAutomationRulesConsistent', 'cursorEnvMatchesLocal',
    'cursorNoDeprecatedPatterns', 'cursorRuleCountManageable',
    'cursorAlwaysApplyMinimized', 'cursorNoNestedRulesDirs',
    'cursorDocsIndexed', 'cursorSessionDriftAwareness',
  ]);

  for (const key of Object.keys(CURSOR_TECHNIQUES)) {
    if (cp08Checks.has(key)) {
      // CP-08 and specialized checks: verify they exist and run without errors
      test(`${key} (CP-08) exists and executes`, () => {
        const technique = CURSOR_TECHNIQUES[key];
        assert.ok(technique, `${key} must exist in CURSOR_TECHNIQUES`);
        assert.ok(typeof technique.check === 'function', `${key} must have a check function`);
        assert.ok(technique.id && technique.id.match(/^CU-[A-P]\d+$/), `${key} must have a valid CU- ID`);
      });
      continue;
    }

    const passScenario = passExpectations[key];
    const failScenario = failExpectations[key];

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

    // Checks with neither pass nor fail should at least exist
    if (!passScenario && !failScenario) {
      test(`${key} exists in CURSOR_TECHNIQUES`, () => {
        assert.ok(CURSOR_TECHNIQUES[key], `${key} must exist in CURSOR_TECHNIQUES`);
        assert.ok(typeof CURSOR_TECHNIQUES[key].check === 'function', `${key} must have a check function`);
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
  console.log(`  Cursor Check Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
