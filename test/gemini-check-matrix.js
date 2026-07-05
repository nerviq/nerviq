const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('../src/audit');
const { GEMINI_TECHNIQUES } = require('../src/gemini/techniques');
const {
  withTempHome,
  buildEmptyRepo,
  buildRichGeminiRepo,
  buildThinGeminiMdRepo,
  buildInvalidJsonRepo,
  buildYoloRepo,
  buildAutoEditRepo,
  buildNoSandboxRepo,
  buildPolicyConflictRepo,
  buildMcpBadRepo,
  buildShellInjectionCommandRepo,
  buildCiEnvBugRepo,
  buildSecretsInSettingsRepo,
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

function resultByKey(report) {
  return Object.fromEntries(report.results.map(item => [item.key, item.passed]));
}

async function main() {
  console.log('\n  Gemini Check Matrix\n');

  const scenarios = {
    empty: buildEmptyRepo(),
    rich: buildRichGeminiRepo(),
    thin: buildThinGeminiMdRepo(),
    invalidJson: buildInvalidJsonRepo(),
    yolo: buildYoloRepo(),
    autoEdit: buildAutoEditRepo(),
    noSandbox: buildNoSandboxRepo(),
    policyConflict: buildPolicyConflictRepo(),
    mcpBad: buildMcpBadRepo(),
    shellInject: buildShellInjectionCommandRepo(),
    ciEnv: buildCiEnvBugRepo(),
    secrets: buildSecretsInSettingsRepo(),
  };

  const reports = {};
  for (const [name, scenario] of Object.entries(scenarios)) {
    reports[name] = resultByKey(await auditScenario(scenario));
  }

  // ─── Pass/Fail expectations ───────────────────────────────────────────���
  //
  // For each technique key: which scenario MUST return true (pass) and
  // which scenario MUST return false (fail). Only checks with clear
  // true/false coverage from existing fixtures are listed here.

  const passExpectations = {
    geminiMdExists: 'rich',
    geminiMdSubstantive: 'rich',
    geminiMdVerificationCommands: 'rich',
    geminiMdArchitecture: 'rich',
    geminiMdNoFiller: 'rich',
    geminiMdImportsValid: 'rich',
    geminiMdNoSecrets: 'rich',
    geminiSettingsExists: 'rich',
    geminiSettingsValidJson: 'rich',
    geminiModelExplicit: 'rich',
    geminiExplicitSettings: 'rich',
    geminiNoDeprecatedKeys: 'rich',
    geminiContextFileNameStandard: 'rich',
    geminiEnvApiKey: 'rich',
    geminiNoYolo: 'rich',
    geminiSandboxExplicit: 'rich',
    geminiTrustedFoldersIntentional: 'rich',
    geminiAutoEditCodeDeletionRisk: 'rich',
    geminiNoSecretsInSettings: 'rich',
    geminiNoYoloInCI: 'rich',
    geminiHooksConfigured: 'rich',
    geminiHookMatchersSpecific: 'rich',
    geminiAfterToolScrubbing: 'rich',
    geminiHookTimeoutReasonable: 'rich',
    geminiMcpConfigured: 'rich',
    geminiMcpExcludeTools: 'rich',
    geminiMcpTransportAppropriate: 'rich',
    geminiMcpExcludeOverInclude: 'rich',
    geminiMcpAuthDocumented: 'rich',
    geminiMcpNoDeprecatedTransport: 'rich',
    geminiSandboxModeExplicit: 'rich',
    geminiPolicyEngineConfigured: 'rich',
    geminiPolicyTiersValid: 'rich',
    geminiSandboxNotNone: 'rich',
    geminiPolicyDocumentation: 'rich',
    geminiAgentsFrontmatter: 'rich',
    geminiAgentNamesDescriptive: 'rich',
    geminiAgentInstructionsScoped: 'rich',
    geminiNoDuplicateAgentNames: 'rich',
    geminiSkillsDescribed: 'rich',
    geminiCiAuthEnvVar: 'empty',
    geminiCiNoYolo: 'empty',
    geminiCiEnvVarConflict: 'empty',
    geminiSkillNamingConvention: 'rich',
    geminiNoOrphanedSkillRefs: 'rich',
    geminiRateLimitAwareness: 'rich',
    geminiSessionPersistence: 'rich',
    geminiMdModernFeatures: 'rich',
    geminiNoDeprecatedPatterns: 'rich',
    geminiFlashVsProDocumented: 'rich',
    geminiTokenUsageAwareness: 'rich',
    geminiCommandsExist: 'rich',
    geminiCommandsHaveDescription: 'rich',
    geminiCommandsNoUnsafeShellInjection: 'rich',
    geminiCommandsUseArgs: 'rich',
    geminiCommandTomlValid: 'rich',
  };

  const failExpectations = {
    geminiMdExists: 'empty',
    geminiMdSubstantive: 'thin',
    geminiMdVerificationCommands: 'thin',
    geminiMdArchitecture: 'thin',
    geminiMdNoFiller: 'thin',
    geminiSettingsValidJson: 'invalidJson',
    geminiExplicitSettings: 'yolo',
    geminiEnvApiKey: 'thin',
    geminiNoYolo: 'yolo',
    geminiSandboxExplicit: 'yolo',
    geminiAutoEditCodeDeletionRisk: 'autoEdit',
    geminiNoSecretsInSettings: 'secrets',
    geminiMcpConfigured: 'thin',
    geminiMcpExcludeTools: 'mcpBad',
    geminiMcpTransportAppropriate: 'mcpBad',
    geminiSandboxModeExplicit: 'thin',
    geminiPolicyDocumentation: 'policyConflict',
    geminiCommandsNoUnsafeShellInjection: 'shellInject',
    geminiCommandsUseArgs: 'shellInject',
    geminiAdvisoryAugmentQuality: 'empty',
  };

  // Checks that intentionally return N/A (null) on the empty repo per their
  // documented opt-in semantics: no .gemini/ dir → settings.json is not an
  // expected surface (GM-B01), no docs at all → nothing to scan for rate-limit
  // awareness (GM-J01), no .gemini/commands/ dir → commands are opt-in
  // (GM-L01). These used to sit in failExpectations, which broke when the
  // N/A semantics landed ("expected false on empty but got null"). Pin the
  // N/A contract explicitly so a regression to true/false is still caught.
  const naExpectations = {
    geminiSettingsExists: 'empty',
    geminiRateLimitAwareness: 'empty',
    geminiCommandsExist: 'empty',
  };

  // CP-08 checks + checks that require specialized fixtures beyond our standard set.
  // These are verified for existence and executability only.
  const cp08Checks = new Set([
    // CP-08: M. Advisory Quality
    'geminiAdvisoryAugmentQuality', 'geminiAdvisorySuggestOnlySafety',
    'geminiAdvisoryOutputFreshness', 'geminiAdvisoryToSetupCoherence',
    // CP-08: N. Pack Posture
    'geminiDomainPackAlignment', 'geminiMcpPackSafety',
    'geminiPackRecommendationQuality', 'geminiNoStalePackVersions',
    // CP-08: O. Repeat-Usage Hygiene
    'geminiSnapshotRetention', 'geminiFeedbackLoopHealth', 'geminiTrendDataAvailability',
    // CP-08: P. Release & Freshness
    'geminiVersionTruth', 'geminiSourceFreshness', 'geminiPropagationCompleteness',
    // Checks requiring specialized conditions not in standard fixtures:
    // - Require specific risk signals, regulated repos, or monorepo structure
    'geminiPolicyRulesForRiskyRepos', 'geminiNoPolicyContradictions',
    'geminiCodeDeletionBugAwareness', 'geminiSandboxPermissionsRestricted',
    'geminiPolicyTiersDontConflict', 'geminiComponentMdForMonorepo',
    // - Require CI workflows, extensions, or memory files
    'geminiCiJsonOutput', 'geminiExtensionsTrusted', 'geminiExtensionMcpSafe',
    'geminiMemoryContentIntentional', 'geminiNoSensitiveMemory',
    // - Requires rate limit mention to activate
    'geminiRetryStrategy',
  ]);

  for (const key of Object.keys(GEMINI_TECHNIQUES)) {
    if (cp08Checks.has(key)) {
      // CP-08 and specialized checks: verify they exist and run without errors
      test(`${key} (CP-08) exists and executes`, () => {
        const technique = GEMINI_TECHNIQUES[key];
        assert.ok(technique, `${key} must exist in GEMINI_TECHNIQUES`);
        assert.ok(typeof technique.check === 'function', `${key} must have a check function`);
        assert.ok(technique.id && technique.id.match(/^GM-[A-P]\d+$/), `${key} must have a valid GM- ID`);
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
      test(`${key} exists in GEMINI_TECHNIQUES`, () => {
        assert.ok(GEMINI_TECHNIQUES[key], `${key} must exist in GEMINI_TECHNIQUES`);
        assert.ok(typeof GEMINI_TECHNIQUES[key].check === 'function', `${key} must have a check function`);
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
  console.log(`  Gemini Check Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
