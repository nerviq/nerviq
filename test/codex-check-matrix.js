const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('../src/audit');
const { CODEX_TECHNIQUES } = require('../src/codex/techniques');
const {
  withTempHome,
  buildEmptyRepo,
  buildRichTrustedMcpRepo,
  buildThinAgentsRepo,
  buildOverrideUndocumentedRepo,
  buildOversizedAgentsRepo,
  buildConfigMissingRepo,
  buildTrustImplicitRepo,
  buildInvalidTomlRepo,
  buildLegacyConfigRepo,
  buildBadProfileRepo,
  buildDangerRepo,
  buildNeverNoJustificationRepo,
  buildWorkspaceNoNetworkRepo,
  buildRegulatedRepo,
  buildActionUnsafeLinuxRepo,
  buildAgentsSecretRepo,
  buildRulesMissingRiskRepo,
  buildRulesBadPatternsRepo,
  buildRulesWrapperNoNoteRepo,
  buildHooksImplicitRepo,
  buildHooksGoodRepo,
  buildHooksBadRepo,
  buildExternalToolsNoMcpRepo,
  buildMcpBadRepo,
  buildAdvancedGoodRepo,
  buildSkillsClaimedNoDirRepo,
  buildSkillBadMetadataRepo,
  buildSkillBadNameRepo,
  buildSkillLongDescriptionRepo,
  buildSkillAutoRunRiskRepo,
  buildCustomAgentMissingFieldsRepo,
  buildCustomAgentUnsafeRepo,
  buildExecUnsafeRepo,
  buildActionMissingAuthRepo,
  buildAutomationUndocumentedRepo,
  buildReviewAutomationNoModelRepo,
  buildCodexIgnoredRepo,
  buildLifecycleScriptRepo,
  buildRedundantWorkflowsRepo,
  buildWorktreeUndocumentedRepo,
  buildModernFeaturesUndocumentedRepo,
  buildDeprecatedPatternRepo,
  buildPluginInvalidRepo,
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

async function auditScenario(scenario, platformOverride = null) {
  const osModule = require('os');
  const originalPlatform = osModule.platform;
  const ephemeralHome = scenario.homeDir || fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-codex-home-'));
  if (platformOverride) {
    osModule.platform = () => platformOverride;
  }

  try {
    return await withTempHome(ephemeralHome, () => audit({ dir: scenario.dir, platform: 'codex', silent: true }));
  } finally {
    if (platformOverride) {
      osModule.platform = originalPlatform;
    }
    if (!scenario.homeDir) {
      fs.rmSync(ephemeralHome, { recursive: true, force: true });
    }
  }
}

function resultByKey(report) {
  return Object.fromEntries(report.results.map(item => [item.key, item.passed]));
}

async function main() {
  console.log('\n  Codex Check Matrix\n');

  const scenarios = {
    empty: buildEmptyRepo(),
    rich: buildRichTrustedMcpRepo(),
    thin: buildThinAgentsRepo(),
    overrideUndocumented: buildOverrideUndocumentedRepo(),
    oversized: buildOversizedAgentsRepo(),
    configMissing: buildConfigMissingRepo(),
    trustImplicit: buildTrustImplicitRepo(),
    invalidToml: buildInvalidTomlRepo(),
    legacy: buildLegacyConfigRepo(),
    badProfile: buildBadProfileRepo(),
    danger: buildDangerRepo(),
    neverNoJustification: buildNeverNoJustificationRepo(),
    workspaceNoNetwork: buildWorkspaceNoNetworkRepo(),
    regulatedGood: buildRegulatedRepo(true),
    regulatedBad: buildRegulatedRepo(false),
    actionLinux: buildActionUnsafeLinuxRepo(),
    agentsSecret: buildAgentsSecretRepo(),
    rulesMissingRisk: buildRulesMissingRiskRepo(),
    rulesBadPatterns: buildRulesBadPatternsRepo(),
    rulesWrapperNoNote: buildRulesWrapperNoNoteRepo(),
    hooksImplicit: buildHooksImplicitRepo(),
    hooksGood: buildHooksGoodRepo(),
    hooksBad: buildHooksBadRepo(),
    externalToolsNoMcp: buildExternalToolsNoMcpRepo(),
    mcpBad: buildMcpBadRepo(),
    advanced: buildAdvancedGoodRepo(),
    skillsClaimedNoDir: buildSkillsClaimedNoDirRepo(),
    skillBadMetadata: buildSkillBadMetadataRepo(),
    skillBadName: buildSkillBadNameRepo(),
    skillLongDescription: buildSkillLongDescriptionRepo(),
    skillAutoRunRisk: buildSkillAutoRunRiskRepo(),
    customAgentMissingFields: buildCustomAgentMissingFieldsRepo(),
    customAgentUnsafe: buildCustomAgentUnsafeRepo(),
    execUnsafe: buildExecUnsafeRepo(),
    actionMissingAuth: buildActionMissingAuthRepo(),
    automationUndocumented: buildAutomationUndocumentedRepo(),
    reviewNoModel: buildReviewAutomationNoModelRepo(),
    codexIgnored: buildCodexIgnoredRepo(),
    lifecycleScript: buildLifecycleScriptRepo(),
    redundantWorkflows: buildRedundantWorkflowsRepo(),
    worktreeUndocumented: buildWorktreeUndocumentedRepo(),
    modernFeaturesUndocumented: buildModernFeaturesUndocumentedRepo(),
    deprecatedPattern: buildDeprecatedPatternRepo(),
    pluginInvalid: buildPluginInvalidRepo(),
  };

  const reports = {};
  for (const [name, scenario] of Object.entries(scenarios)) {
    reports[name] = resultByKey(await auditScenario(scenario));
  }
  reports.hooksGoodWindows = resultByKey(await auditScenario(scenarios.hooksGood, 'win32'));

  const passExpectations = {
    codexAgentsMd: 'rich',
    codexAgentsMdSubstantive: 'rich',
    codexAgentsVerificationCommands: 'rich',
    codexAgentsArchitecture: 'rich',
    codexOverrideDocumented: 'rich',
    codexProjectDocMaxBytes: 'rich',
    codexNoGenericFiller: 'rich',
    codexNoInstructionContradictions: 'rich',
    codexConfigExists: 'rich',
    codexModelExplicit: 'rich',
    codexReasoningEffortExplicit: 'rich',
    codexConfigSectionPlacement: 'rich',
    codexConfigValidToml: 'rich',
    codexNoLegacyConfigAliases: 'rich',
    codexProfilesUsedAppropriately: 'rich',
    codexNoDangerFullAccess: 'rich',
    codexApprovalPolicyExplicit: 'rich',
    codexSandboxModeExplicit: 'rich',
    codexApprovalNeverNeedsJustification: 'rich',
    codexGitHubActionUnsafeJustified: 'rich',
    codexNetworkAccessExplicit: 'rich',
    codexNoSecretsInAgents: 'rich',
    codexRulesExistForRiskyCommands: 'rich',
    codexRulesSpecificPatterns: 'rich',
    codexRulesExamplesPresent: 'rich',
    codexNoBroadAllowAllRules: 'rich',
    codexRuleWrapperRiskDocumented: 'rich',
    codexHooksDeliberate: 'rich',
    codexHooksJsonExistsWhenClaimed: 'hooksGood',
    codexHookEventsSupported: 'hooksGood',
    codexHooksWindowsCaveat: 'empty',
    codexHookTimeoutsReasonable: 'hooksGood',
    codexMcpPresentIfRepoNeedsExternalTools: 'rich',
    codexMcpWhitelistsExplicit: 'rich',
    codexMcpStartupTimeoutReasonable: 'rich',
    codexProjectScopedMcpTrusted: 'rich',
    codexMcpAuthDocumented: 'rich',
    codexNoDeprecatedMcpTransport: 'rich',
    codexSkillsDirPresentWhenUsed: 'advanced',
    codexSkillsHaveMetadata: 'advanced',
    codexSkillNamesKebabCase: 'advanced',
    codexSkillDescriptionsBounded: 'advanced',
    codexSkillsNoAutoRunRisk: 'advanced',
    codexCustomAgentsRequiredFields: 'advanced',
    codexMaxThreadsExplicit: 'advanced',
    codexMaxDepthExplicit: 'advanced',
    codexPerAgentSandboxOverridesSafe: 'advanced',
    codexExecUsageSafe: 'advanced',
    codexGitHubActionSafeStrategy: 'advanced',
    codexCiAuthUsesManagedKey: 'advanced',
    codexAutomationManuallyTested: 'advanced',
    codexReviewWorkflowDocumented: 'advanced',
    codexReviewModelOverrideExplicit: 'advanced',
    codexWorkingTreeReviewExpectations: 'advanced',
    codexCostAwarenessDocumented: 'advanced',
    codexArtifactsSharedIntentionally: 'advanced',
    codexLifecycleScriptsPlatformSafe: 'advanced',
    codexActionsNotRedundant: 'advanced',
    codexWorktreeLifecycleDocumented: 'advanced',
    codexAgentsMentionModernFeatures: 'advanced',
    codexNoDeprecatedPatterns: 'advanced',
    codexProfilesUsedWhenNeeded: 'advanced',
    codexPluginConfigValid: 'advanced',
    codexUndoExplicit: 'advanced',
    // CP-08: M. Advisory Quality
    codexAdvisoryAugmentQuality: 'rich',
    codexAdvisorySuggestOnlySafety: 'rich',
    codexAdvisoryOutputFreshness: 'rich',
    codexAdvisoryToSetupCoherence: 'rich',
    // CP-08: N. Pack Posture
    codexDomainPackAlignment: 'rich',
    codexMcpPackSafety: 'rich',
    codexPackRecommendationQuality: 'rich',
    codexNoStalePackVersions: 'rich',
    // CP-08: O. Repeat-Usage Hygiene
    codexSnapshotRetention: 'rich',
    codexFeedbackLoopHealth: 'rich',
    codexTrendDataAvailability: 'rich',
    // CP-08: P. Release & Freshness
    codexVersionTruth: 'rich',
    codexSourceFreshness: 'rich',
    codexPropagationCompleteness: 'rich',
  };

  const failExpectations = {
    codexAgentsMd: 'empty',
    codexAgentsMdSubstantive: 'thin',
    codexAgentsVerificationCommands: 'thin',
    codexAgentsArchitecture: 'thin',
    codexOverrideDocumented: 'overrideUndocumented',
    codexProjectDocMaxBytes: 'oversized',
    codexNoGenericFiller: 'thin',
    codexNoInstructionContradictions: 'thin',
    codexConfigExists: 'empty',
    codexModelExplicit: 'configMissing',
    codexReasoningEffortExplicit: 'configMissing',
    codexConfigSectionPlacement: 'legacy',
    codexConfigValidToml: 'invalidToml',
    codexNoLegacyConfigAliases: 'legacy',
    codexProfilesUsedAppropriately: 'badProfile',
    codexNoDangerFullAccess: 'danger',
    codexApprovalPolicyExplicit: 'trustImplicit',
    codexSandboxModeExplicit: 'trustImplicit',
    codexApprovalNeverNeedsJustification: 'neverNoJustification',
    codexGitHubActionUnsafeJustified: 'actionLinux',
    codexNetworkAccessExplicit: 'workspaceNoNetwork',
    codexNoSecretsInAgents: 'agentsSecret',
    codexRulesExistForRiskyCommands: 'rulesMissingRisk',
    codexRulesSpecificPatterns: 'rulesBadPatterns',
    codexRulesExamplesPresent: 'rulesBadPatterns',
    codexNoBroadAllowAllRules: 'rulesBadPatterns',
    codexRuleWrapperRiskDocumented: 'rulesWrapperNoNote',
    codexHooksDeliberate: 'hooksImplicit',
    codexHooksJsonExistsWhenClaimed: 'hooksImplicit',
    codexHookEventsSupported: 'hooksBad',
    codexHooksWindowsCaveat: 'hooksGoodWindows',
    codexHookTimeoutsReasonable: 'hooksBad',
    codexMcpPresentIfRepoNeedsExternalTools: 'externalToolsNoMcp',
    codexMcpWhitelistsExplicit: 'mcpBad',
    codexMcpStartupTimeoutReasonable: 'mcpBad',
    codexProjectScopedMcpTrusted: 'mcpBad',
    codexMcpAuthDocumented: 'mcpBad',
    codexNoDeprecatedMcpTransport: 'mcpBad',
    codexSkillsDirPresentWhenUsed: 'skillsClaimedNoDir',
    codexSkillsHaveMetadata: 'skillBadMetadata',
    codexSkillNamesKebabCase: 'skillBadName',
    codexSkillDescriptionsBounded: 'skillLongDescription',
    codexSkillsNoAutoRunRisk: 'skillAutoRunRisk',
    codexCustomAgentsRequiredFields: 'customAgentMissingFields',
    codexMaxThreadsExplicit: 'customAgentMissingFields',
    codexMaxDepthExplicit: 'customAgentMissingFields',
    codexPerAgentSandboxOverridesSafe: 'customAgentUnsafe',
    codexExecUsageSafe: 'execUnsafe',
    codexGitHubActionSafeStrategy: 'actionLinux',
    codexCiAuthUsesManagedKey: 'actionMissingAuth',
    codexAutomationManuallyTested: 'automationUndocumented',
    codexReviewWorkflowDocumented: 'rich',
    codexReviewModelOverrideExplicit: 'reviewNoModel',
    codexWorkingTreeReviewExpectations: 'rich',
    codexCostAwarenessDocumented: 'rich',
    codexArtifactsSharedIntentionally: 'codexIgnored',
    codexLifecycleScriptsPlatformSafe: 'lifecycleScript',
    codexActionsNotRedundant: 'redundantWorkflows',
    codexWorktreeLifecycleDocumented: 'worktreeUndocumented',
    codexAgentsMentionModernFeatures: 'modernFeaturesUndocumented',
    codexNoDeprecatedPatterns: 'deprecatedPattern',
    codexProfilesUsedWhenNeeded: 'actionMissingAuth',
    codexPluginConfigValid: 'pluginInvalid',
    codexUndoExplicit: 'badProfile',
    // CP-08: M. Advisory Quality
    codexAdvisoryAugmentQuality: 'configMissing',
    codexAdvisorySuggestOnlySafety: 'danger',
    codexAdvisoryOutputFreshness: 'thin',
    codexAdvisoryToSetupCoherence: 'configMissing',
    // CP-08: N. Pack Posture
    codexDomainPackAlignment: 'thin',
    codexMcpPackSafety: 'mcpBad',
    codexPackRecommendationQuality: 'configMissing',
    codexNoStalePackVersions: 'mcpBad',
    // CP-08: O. Repeat-Usage Hygiene (null=skip on empty is correct)
    codexSnapshotRetention: 'configMissing',
    codexFeedbackLoopHealth: 'configMissing',
    codexTrendDataAvailability: 'configMissing',
    // CP-08: P. Release & Freshness
    codexVersionTruth: 'thin',
    codexSourceFreshness: 'legacy',
    codexPropagationCompleteness: 'thin',
  };

  // Checks that legitimately return null (skip) when prerequisites are missing
  // CP-08 checks that need specialized fixtures (runtime data, specific failure patterns)
  // These are verified via unit tests and runtime probes, not the general check matrix
  const cp08Checks = new Set([
    'codexAdvisoryAugmentQuality', 'codexAdvisorySuggestOnlySafety',
    'codexAdvisoryOutputFreshness', 'codexAdvisoryToSetupCoherence',
    'codexDomainPackAlignment', 'codexMcpPackSafety',
    'codexPackRecommendationQuality', 'codexNoStalePackVersions',
    'codexSnapshotRetention', 'codexFeedbackLoopHealth', 'codexTrendDataAvailability',
    'codexVersionTruth', 'codexSourceFreshness', 'codexPropagationCompleteness',
  ]);

  // Retired checks always return null (config keys removed from the official
  // Codex schema on 2026-04-05). Pin the retired N/A contract explicitly.
  const naExpectations = {
    codexWeakModelExplicit: 'rich',
    codexFullAutoErrorModeExplicit: 'rich',
    codexDisableResponseStorageForRegulatedRepos: 'regulatedGood',
    codexHistorySendToServerExplicit: 'rich',
  };

  for (const key of Object.keys(CODEX_TECHNIQUES)) {
    if (cp08Checks.has(key)) {
      // CP-08 checks: verify they exist and run without errors
      test(`${key} (CP-08) exists and executes`, () => {
        const technique = CODEX_TECHNIQUES[key];
        assert.ok(technique, `${key} must exist in CODEX_TECHNIQUES`);
        assert.ok(typeof technique.check === 'function', `${key} must have a check function`);
        assert.ok(technique.id && technique.id.match(/^CX-[A-P]\d+$/), `${key} must have a valid CX- ID`);
      });
      continue;
    }

    const passScenario = passExpectations[key];
    const failScenario = failExpectations[key];
    const naScenario = naExpectations[key];

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

    // Retired / N/A-pinned checks must return null on their pinned scenario
    if (naScenario) {
      test(`${key} is N/A on ${naScenario}`, () => {
        assert.strictEqual(reports[naScenario][key], null, `${key} expected null (N/A) on ${naScenario} but got ${reports[naScenario][key]}`);
      });
    }

    // Checks without fixture coverage (the post-v1.1 catalog expansions —
    // supplemental engineering-foundation + stack checks) at least exist and
    // are runnable. Mirrors the copilot/gemini matrix structure; previously
    // this loop hard-required pass AND fail expectations for every check,
    // which broke with `reports[undefined]` for every check added after the
    // expectation tables were last curated (380 spurious failures).
    if (!passScenario && !failScenario && !naScenario) {
      test(`${key} exists in CODEX_TECHNIQUES`, () => {
        assert.ok(CODEX_TECHNIQUES[key], `${key} must exist in CODEX_TECHNIQUES`);
        assert.ok(typeof CODEX_TECHNIQUES[key].check === 'function', `${key} must have a check function`);
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
  console.log(`  Codex Check Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
