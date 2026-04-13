const { getRecommendationAdjustment } = require('../activity');

const IMPACT_ORDER = { critical: 3, high: 2, medium: 1, low: 0 };
const WEIGHTS = { critical: 15, high: 10, medium: 5, low: 2 };
const SCORE_MILESTONES = [50, 70, 90, 100];
const CATEGORY_MODULES = {
  memory: 'CLAUDE.md',
  quality: 'verification',
  git: 'safety',
  workflow: 'commands-agents-skills',
  security: 'permissions',
  automation: 'hooks',
  design: 'design-rules',
  devops: 'ci-devops',
  hygiene: 'project-hygiene',
  performance: 'context-management',
  tools: 'mcp-tools',
  prompting: 'prompt-structure',
  features: 'modern-claude-features',
  'quality-deep': 'quality-deep',
  skills: 'skills',
  agents: 'subagents',
  review: 'review-workflow',
  local: 'local-environment',
};
const ACTION_RATIONALES = {
  noBypassPermissions: 'bypassPermissions skips the main safety layer. Explicit allow and deny rules create safer autonomy.',
  secretsProtection: 'Without secret protection, Claude can accidentally inspect sensitive files and leak them into outputs.',
  permissionDeny: 'Deny rules are the strongest way to prevent dangerous reads and destructive operations.',
  settingsPermissions: 'Explicit permission settings make the workflow safer, more governable, and easier to review.',
  testCommand: 'Without a test command, Claude cannot verify that its changes actually work before handoff.',
  lintCommand: 'Without a lint command, Claude will miss formatting and style regressions that teams expect to catch automatically.',
  buildCommand: 'Without a build command, compile and packaging failures stay invisible until later in the workflow.',
  ciPipeline: 'CI is what turns a local setup improvement into a repeatable team-wide standard.',
  securityReview: 'If you do not wire in security review guidance, high-risk changes are easier to ship without the right scrutiny.',
  skills: 'Skills package reusable expertise so Claude does not need the same context re-explained every session.',
  multipleAgents: 'Specialized agents unlock role-based work such as security review, implementation, and QA in parallel.',
  multipleMcpServers: 'A richer MCP surface gives Claude access to live tools and documentation instead of stale assumptions.',
  roleDefinition: 'A clear role definition calibrates how Claude thinks, explains, and validates work in this repo.',
  importSyntax: 'Imported modules keep CLAUDE.md maintainable as the workflow grows more sophisticated.',
  claudeMd: 'CLAUDE.md is the foundation of project-specific context. Without it, Claude starts every task half-blind.',
  hooks: 'Hooks enforce the rules programmatically, which is much more reliable than relying on instructions alone.',
  pathRules: 'Path-specific rules help Claude behave differently in different parts of the repo without global noise.',
  context7Mcp: 'Live documentation reduces version drift and cuts down on confident but outdated answers.',
  codexAgentsMd: 'AGENTS.md is the main Codex instruction surface. Without it, Codex starts without repo-specific guidance.',
  codexAgentsMdSubstantive: 'A thin AGENTS.md is almost as bad as no AGENTS.md because Codex still lacks the repo context it needs.',
  codexAgentsVerificationCommands: 'If AGENTS.md does not document how to verify work, Codex cannot reliably prove its own changes are safe.',
  codexAgentsArchitecture: 'A small architecture map reduces navigation drift and helps Codex change the right part of the repo first.',
  codexConfigExists: 'Without .codex/config.toml, trust and model behavior are implicit instead of explicit.',
  codexReasoningEffortExplicit: 'Reasoning depth should be intentional for cost and latency, not left to implicit defaults.',
  codexApprovalPolicyExplicit: 'Explicit approvals make Codex behavior predictable and reviewable across sessions.',
  codexNoDangerFullAccess: 'danger-full-access removes the main safety boundary and should be treated as a critical risk.',
  codexHistorySendToServerExplicit: 'History sync is a privacy and governance surface. Teams should decide it explicitly, not inherit it accidentally.',
  codexNoSecretsInAgents: 'Secrets in AGENTS.md can leak directly into agent context, outputs, and logs.',
  codexHooksWindowsCaveat: 'Windows does not support Codex hooks today, so relying on them there creates a false sense of runtime enforcement.',
  codexSkillsDirPresentWhenUsed: 'Versioned repo-local skills are the safest way to keep Codex expertise reviewable and consistent across contributors.',
  codexSkillsHaveMetadata: 'Without a usable SKILL.md, Codex cannot reliably decide when a skill should run or what it is for.',
  codexSkillNamesKebabCase: 'Consistent skill naming improves discoverability and avoids invocation drift.',
  codexSkillDescriptionsBounded: 'A bounded skill description helps Codex invoke the right skill without inflating prompt context.',
  codexSkillsNoAutoRunRisk: 'Skills should guide Codex, not silently authorize risky automation or destructive actions.',
  codexCustomAgentsRequiredFields: 'Custom agents need clear metadata and developer instructions so delegation stays predictable.',
  codexMaxThreadsExplicit: 'Explicit fanout limits make Codex delegation safer and easier to reason about.',
  codexMaxDepthExplicit: 'Nested delegation should be deliberate, not accidental.',
  codexPerAgentSandboxOverridesSafe: 'Per-agent overrides can quietly bypass the main trust model if they are not constrained.',
  codexExecUsageSafe: 'Unsafe Codex automation quickly turns small workflow mistakes into real repo damage.',
  codexGitHubActionSafeStrategy: 'CI safety posture should be visible and intentional, especially when Codex is acting in automation.',
  codexCiAuthUsesManagedKey: 'Managed secrets are the minimum trust boundary for Codex in CI.',
  codexAutomationManuallyTested: 'Manual dry-runs catch automation footguns before they become scheduled failures.',
  codexReviewWorkflowDocumented: 'A documented review path makes Codex safer to use on risky diffs and refactors.',
  codexReviewModelOverrideExplicit: 'Explicit review model selection keeps review quality and cost predictable when automation is involved.',
  codexWorkingTreeReviewExpectations: 'Codex reviews are much safer when the repo states how to treat staged, unstaged, and unrelated changes.',
  codexCostAwarenessDocumented: 'Heavy workflows should be intentional, not the invisible default.',
  codexArtifactsSharedIntentionally: 'If `.codex` is hidden from version control, the team loses a shared and reviewable Codex contract.',
  codexLifecycleScriptsPlatformSafe: 'Local setup/teardown scripts are part of the trust model and should not surprise contributors on other platforms.',
  codexActionsNotRedundant: 'Redundant automation expands the surface area without adding real value.',
  codexWorktreeLifecycleDocumented: 'Parallel worktree flows need explicit setup and cleanup expectations.',
  codexAgentsMentionModernFeatures: 'When the repo uses modern Codex surfaces, AGENTS.md should tell Codex they exist.',
  codexNoDeprecatedPatterns: 'Deprecated Codex patterns create silent drift and confusing behavior over time.',
  codexProfilesUsedWhenNeeded: 'Profiles become more important as Codex automation and delegation get more complex.',
  codexPluginConfigValid: 'Broken plugin metadata creates discoverability and tooling drift.',
  codexUndoExplicit: 'Undo is a user-facing safety feature and should be an explicit repo choice.',
};
const CODEX_HARD_FAIL_KEYS = new Set([
  'codexAgentsMd',
  'codexConfigValidToml',
  'codexNoDangerFullAccess',
  'codexApprovalPolicyExplicit',
  'codexNoSecretsInAgents',
  'codexHooksWindowsCaveat',
]);
const CODEX_EVIDENCE_CLASSES = {
  'CX-A01': 'runtime',
  'CX-A02': 'derived',
  'CX-A03': 'derived',
  'CX-A04': 'derived',
  'CX-A05': 'mixed',
  'CX-A06': 'source',
  'CX-A07': 'derived',
  'CX-A08': 'derived',
  'CX-B01': 'runtime',
  'CX-B02': 'mixed',
  'CX-B03': 'mixed',
  'CX-B04': 'source',
  'CX-B05': 'source',
  'CX-B06': 'source',
  'CX-B07': 'source',
  'CX-B08': 'source',
  'CX-B09': 'source',
  'CX-C01': 'mixed',
  'CX-C02': 'mixed',
  'CX-C03': 'mixed',
  'CX-C04': 'derived',
  'CX-C05': 'source',
  'CX-C06': 'source',
  'CX-C07': 'mixed',
  'CX-C08': 'source',
  'CX-C09': 'mixed',
  'CX-D01': 'runtime',
  'CX-D02': 'mixed',
  'CX-D03': 'source',
  'CX-D04': 'mixed',
  'CX-D05': 'mixed',
  'CX-E01': 'mixed',
  'CX-E02': 'runtime',
  'CX-E03': 'mixed',
  'CX-E04': 'mixed',
  'CX-E05': 'source',
  'CX-F01': 'mixed',
  'CX-F02': 'mixed',
  'CX-F03': 'source',
  'CX-F04': 'mixed',
  'CX-F05': 'source',
  'CX-F06': 'source',
  'CX-G01': 'mixed',
  'CX-G02': 'source',
  'CX-G03': 'source',
  'CX-G04': 'derived',
  'CX-G05': 'derived',
  'CX-H01': 'source',
  'CX-H02': 'runtime',
  'CX-H03': 'runtime',
  'CX-H04': 'source',
  'CX-I01': 'mixed',
  'CX-I02': 'mixed',
  'CX-I03': 'source',
  'CX-I04': 'source',
  'CX-J01': 'source',
  'CX-J02': 'source',
  'CX-J03': 'source',
  'CX-J04': 'source',
  'CX-K01': 'source',
  'CX-K02': 'source',
  'CX-K03': 'source',
  'CX-K04': 'source',
  'CX-L01': 'derived',
  'CX-L02': 'source',
  'CX-L03': 'derived',
  'CX-L04': 'source',
  'CX-L05': 'source',
};
const CODEX_QUICKWIN_CONFIG_KEYS = new Set([
  'codexConfigExists',
  'codexModelExplicit',
  'codexReasoningEffortExplicit',
  'codexWeakModelExplicit',
  'codexProfilesUsedAppropriately',
  'codexFullAutoErrorModeExplicit',
  'codexHistorySendToServerExplicit',
  'codexNetworkAccessExplicit',
  'codexHooksDeliberate',
  'codexMcpStartupTimeoutReasonable',
  'codexMaxThreadsExplicit',
  'codexMaxDepthExplicit',
]);
const CODEX_QUICKWIN_FILE_KEYS = new Set([
  'codexAgentsMd',
  'codexHooksJsonExistsWhenClaimed',
  'codexSkillsDirPresentWhenUsed',
]);
const CODEX_QUICKWIN_DOC_KEYS = new Set([
  'codexAgentsArchitecture',
  'codexOverrideDocumented',
  'codexNoGenericFiller',
  'codexNoInstructionContradictions',
  'codexRulesExamplesPresent',
  'codexRuleWrapperRiskDocumented',
  'codexSkillsHaveMetadata',
  'codexSkillNamesKebabCase',
  'codexSkillDescriptionsBounded',
  'codexAutomationManuallyTested',
  'codexReviewWorkflowDocumented',
  'codexWorkingTreeReviewExpectations',
  'codexCostAwarenessDocumented',
]);
const CODEX_QUICKWIN_POLICY_KEYS = new Set([
  'codexRulesSpecificPatterns',
  'codexNoBroadAllowAllRules',
  'codexMcpWhitelistsExplicit',
  'codexNoDeprecatedMcpTransport',
  'codexGitHubActionSafeStrategy',
  'codexProfilesUsedWhenNeeded',
  'codexUndoExplicit',
]);
const CODEX_QUICKWIN_AVOID_KEYS = new Set([
  'codexNoDangerFullAccess',
  'codexApprovalPolicyExplicit',
  'codexGitHubActionUnsafeJustified',
  'codexProjectScopedMcpTrusted',
  'codexMcpAuthDocumented',
  'codexHooksWindowsCaveat',
  'codexNoSecretsInAgents',
  'codexPerAgentSandboxOverridesSafe',
  'codexExecUsageSafe',
  'codexCiAuthUsesManagedKey',
  'codexLifecycleScriptsPlatformSafe',
]);

function riskFromImpact(impact) {
  if (impact === 'critical') return 'high';
  if (impact === 'high') return 'medium';
  return 'low';
}

function confidenceFromImpact(impact) {
  return impact === 'critical' || impact === 'high' ? 'high' : 'medium';
}

function confidenceLabel(confidence) {
  if (confidence >= 0.6) return 'HIGH';
  if (confidence >= 0.3) return 'MEDIUM';
  return 'HEURISTIC';
}

function getPrioritizedFailed(failed) {
  const prioritized = failed.filter((item) => !(item.category === 'hygiene' && item.impact === 'low'));
  return prioritized.length > 0 ? prioritized : failed;
}

function codexEvidenceClass(item) {
  return CODEX_EVIDENCE_CLASSES[item.id] || 'derived';
}

function codexCategoryBonus(category) {
  if (category === 'trust' || category === 'config') return 12;
  if (category === 'rules' || category === 'hooks' || category === 'mcp') return 8;
  if (category === 'instructions') return 4;
  return 0;
}

function codexEvidenceBonus(item) {
  const evidenceClass = codexEvidenceClass(item);
  if (evidenceClass === 'runtime') return 8;
  if (evidenceClass === 'mixed') return 6;
  if (evidenceClass === 'source') return 3;
  return 0;
}

function codexPriorityScore(item, outcomeSummaryByKey = {}) {
  const impactBase = item.impact === 'critical'
    ? 60
    : item.impact === 'high'
      ? 40
      : item.impact === 'medium'
        ? 20
        : 8;
  const feedbackAdjustment = getRecommendationAdjustment(outcomeSummaryByKey, item.key) * 10;
  const hardFailBonus = CODEX_HARD_FAIL_KEYS.has(item.key) ? 12 : 0;
  return Math.max(0, Math.min(100, impactBase + codexCategoryBonus(item.category) + codexEvidenceBonus(item) + hardFailBonus + feedbackAdjustment));
}

function codexQuickWinScore(item) {
  if (CODEX_QUICKWIN_AVOID_KEYS.has(item.key)) return -100;

  let score = 0;
  if (CODEX_QUICKWIN_CONFIG_KEYS.has(item.key)) {
    score += 40;
  } else if (CODEX_QUICKWIN_FILE_KEYS.has(item.key)) {
    score += 34;
  } else if (CODEX_QUICKWIN_DOC_KEYS.has(item.key)) {
    score += 26;
  } else if (CODEX_QUICKWIN_POLICY_KEYS.has(item.key)) {
    score += 20;
  }

  score += item.impact === 'low' ? 8 : item.impact === 'medium' ? 6 : item.impact === 'high' ? 4 : 0;
  score -= Math.min((item.fix || '').length, 240) / 24;
  return score;
}

function getQuickWins(failed, options = {}) {
  const pool = getPrioritizedFailed(failed);

  if (options.platform === 'codex') {
    const codexPool = pool.filter((item) => !CODEX_QUICKWIN_AVOID_KEYS.has(item.key));
    const rankedPool = (codexPool.length > 0 ? codexPool : pool)
      .slice()
      .sort((a, b) => codexQuickWinScore(b) - codexQuickWinScore(a));
    return rankedPool.slice(0, 3);
  }

  return [...pool]
    .sort((a, b) => {
      const fixLenA = (a.fix || '').length;
      const fixLenB = (b.fix || '').length;
      if (fixLenA !== fixLenB) return fixLenA - fixLenB;
      const impactA = IMPACT_ORDER[a.impact] ?? 0;
      const impactB = IMPACT_ORDER[b.impact] ?? 0;
      return impactB - impactA;
    })
    .slice(0, 3);
}

function getFpFeedbackMultiplier(fpFeedbackByKey, key) {
  if (!fpFeedbackByKey) return 1.0;
  const bucket = fpFeedbackByKey[key];
  if (!bucket || bucket.total === 0) return 1.0;

  const unhelpfulRate = bucket.unhelpful / bucket.total;
  const helpfulRate = bucket.helpful / bucket.total;

  if (unhelpfulRate > 0.5) return 0.7;
  if (helpfulRate > 0.8) return 1.2;
  return 1.0;
}

function getRecommendationPriorityScore(item, outcomeSummaryByKey = {}, fpFeedbackByKey = null) {
  const impactScore = (IMPACT_ORDER[item.impact] ?? 0) * 100;
  const feedbackAdjustment = getRecommendationAdjustment(outcomeSummaryByKey, item.key);
  const brevityPenalty = Math.min((item.fix || '').length, 240) / 20;
  const raw = impactScore + (feedbackAdjustment * 10) - brevityPenalty;
  return raw * getFpFeedbackMultiplier(fpFeedbackByKey, item.key);
}

function buildTopNextActions(failed, limit = 5, outcomeSummaryByKey = {}, options = {}) {
  const pool = getPrioritizedFailed(failed);
  const fpByKey = options.fpFeedbackByKey || null;

  return [...pool]
    .sort((a, b) => {
      const scoreB = options.platform === 'codex'
        ? codexPriorityScore(b, outcomeSummaryByKey)
        : getRecommendationPriorityScore(b, outcomeSummaryByKey, fpByKey);
      const scoreA = options.platform === 'codex'
        ? codexPriorityScore(a, outcomeSummaryByKey)
        : getRecommendationPriorityScore(a, outcomeSummaryByKey, fpByKey);
      return scoreB - scoreA;
    })
    .slice(0, limit)
    .map(({ key, id, name, impact, fix, category, sourceUrl, layer }) => {
      const feedback = outcomeSummaryByKey[key] || null;
      const rankingAdjustment = getRecommendationAdjustment(outcomeSummaryByKey, key);
      const signals = [
        `failed-check:${key}`,
        `impact:${impact}`,
        `category:${category}`,
      ];
      if (feedback) {
        signals.push(`feedback:${feedback.total}`);
        signals.push(`ranking-adjustment:${rankingAdjustment >= 0 ? '+' : ''}${rankingAdjustment}`);
      }

      const fullItem = pool.find((item) => item.key === key) || { key, id, name, impact, fix, category };
      const evidenceClass = options.platform === 'codex' ? codexEvidenceClass(fullItem) : (feedback ? 'measured' : 'estimated');
      const priorityScore = options.platform === 'codex'
        ? codexPriorityScore(fullItem, outcomeSummaryByKey)
        : Math.max(0, Math.min(100, Math.round(getRecommendationPriorityScore(fullItem, outcomeSummaryByKey, fpByKey) / 3)));

      signals.push(`evidence:${evidenceClass}`);
      if (options.platform === 'codex' && CODEX_HARD_FAIL_KEYS.has(key)) {
        signals.push('hard-fail:true');
      }

      return {
        key,
        id,
        name,
        impact,
        category,
        layer, // CTO-08: surface scope layer on every next-action
        sourceUrl,
        module: CATEGORY_MODULES[category] || category,
        fix,
        remediation_command: getRemediationCommand(key, category, options.platform),
        priorityScore,
        why: ACTION_RATIONALES[key] || fix,
        risk: riskFromImpact(impact),
        confidence: confidenceFromImpact(impact),
        signals,
        evidenceClass,
        rankingAdjustment,
        feedback: feedback ? {
          total: feedback.total,
          accepted: feedback.accepted,
          rejected: feedback.rejected,
          deferred: feedback.deferred,
          positive: feedback.positive,
          negative: feedback.negative,
          avgScoreDelta: feedback.avgScoreDelta,
        } : null,
      };
    });
}

/**
 * Map check keys/categories to a shell command an agent can run to fix the issue.
 * Returns null when no automated fix is available.
 */
function getRemediationCommand(key, category, platform) {
  const plat = platform || 'claude';

  // Key-specific remediation commands
  const KEY_COMMANDS = {
    claudeMd: 'npx @nerviq/cli setup',
    agentsMd: 'npx @nerviq/cli setup --platform codex',
    geminiMd: 'npx @nerviq/cli setup --platform gemini',
    copilotInstructions: 'npx @nerviq/cli setup --platform copilot',
    cursorRules: 'npx @nerviq/cli setup --platform cursor',
    windsurfRules: 'npx @nerviq/cli setup --platform windsurf',
    aiderConfig: 'npx @nerviq/cli setup --platform aider',
    opencodeConfig: 'npx @nerviq/cli setup --platform opencode',
    settingsPermissions: 'npx @nerviq/cli plan --only permissions',
    permissionDeny: 'npx @nerviq/cli plan --only permissions',
    noBypassPermissions: 'npx @nerviq/cli plan --only permissions',
    secretsProtection: 'npx @nerviq/cli plan --only permissions',
    verificationLoop: `npx @nerviq/cli augment --platform ${plat}`,
    lintCommand: `npx @nerviq/cli augment --platform ${plat}`,
    testCommand: `npx @nerviq/cli augment --platform ${plat}`,
    buildCommand: `npx @nerviq/cli augment --platform ${plat}`,
    hookExists: 'npx @nerviq/cli plan --only hooks',
    preCommitHook: 'npx @nerviq/cli plan --only hooks',
    commandsExist: 'npx @nerviq/cli plan --only commands',
    mcpServers: 'npx @nerviq/cli plan --mcp-pack context7',
  };

  if (KEY_COMMANDS[key]) return KEY_COMMANDS[key];

  // Category-level fallback
  const CATEGORY_COMMANDS = {
    memory: `npx @nerviq/cli setup --platform ${plat}`,
    security: `npx @nerviq/cli plan --only permissions --platform ${plat}`,
    automation: `npx @nerviq/cli plan --only hooks --platform ${plat}`,
    workflow: `npx @nerviq/cli plan --only commands --platform ${plat}`,
    tools: `npx @nerviq/cli plan --mcp-pack context7 --platform ${plat}`,
  };

  return CATEGORY_COMMANDS[category] || `npx @nerviq/cli augment --platform ${plat}`;
}

function getNextScoreMilestone(score) {
  return SCORE_MILESTONES.find((milestone) => score < milestone) || null;
}

function buildScoreCoaching({ score, earnedPoints, maxPoints, failed, outcomeSummaryByKey = {}, platform, fpFeedbackByKey = null }) {
  if (!Array.isArray(failed) || failed.length === 0 || !Number.isFinite(maxPoints) || maxPoints <= 0) {
    return null;
  }

  const nextMilestone = getNextScoreMilestone(score);
  if (!nextMilestone) return null;

  const targetEarnedPoints = Math.ceil((nextMilestone / 100) * maxPoints);
  const pointsNeeded = Math.max(0, targetEarnedPoints - earnedPoints);
  if (pointsNeeded <= 0) return null;

  const rankedActions = buildTopNextActions(failed, failed.length, outcomeSummaryByKey, { platform, fpFeedbackByKey });
  if (rankedActions.length === 0) return null;

  const failedByKey = new Map(failed.map((item) => [item.key, item]));
  const selected = [];
  let recoveredPoints = 0;

  for (const action of rankedActions) {
    const source = failedByKey.get(action.key);
    if (!source) continue;
    selected.push({
      key: source.key,
      name: source.name,
      impact: source.impact,
      weight: WEIGHTS[source.impact] || 0,
    });
    recoveredPoints += WEIGHTS[source.impact] || 0;
    if (recoveredPoints >= pointsNeeded) break;
  }

  if (selected.length === 0) return null;

  const fixesNeeded = selected.length;
  const projectedScore = Math.round(((earnedPoints + recoveredPoints) / maxPoints) * 100);
  const summary = `You're ${fixesNeeded} ${fixesNeeded === 1 ? 'fix' : 'fixes'} away from ${nextMilestone}/100.`;

  return {
    currentScore: score,
    nextMilestone,
    pointsNeeded,
    fixesNeeded,
    projectedScore: Math.min(100, projectedScore),
    summary,
    recommendedKeys: selected.map((item) => item.key),
    recommendedNames: selected.map((item) => item.name),
  };
}

function computeCategoryScores(applicable, passed) {
  const grouped = {};

  for (const item of applicable) {
    const category = item.category || 'unknown';
    if (!grouped[category]) {
      grouped[category] = { passed: 0, total: 0, earnedPoints: 0, maxPoints: 0 };
    }
    grouped[category].total += 1;
    grouped[category].maxPoints += WEIGHTS[item.impact] || 5;
  }

  for (const item of passed) {
    const category = item.category || 'unknown';
    if (!grouped[category]) continue;
    grouped[category].passed += 1;
    grouped[category].earnedPoints += WEIGHTS[item.impact] || 5;
  }

  const result = {};
  for (const [category, summary] of Object.entries(grouped)) {
    result[category] = {
      ...summary,
      score: summary.maxPoints > 0 ? Math.round((summary.earnedPoints / summary.maxPoints) * 100) : 0,
    };
  }

  return result;
}

function inferSuggestedNextCommand(result) {
  if (result.platform === 'codex') {
    if (result.failed === 0) return 'npx nerviq --platform codex augment';

    const actionKeys = new Set((result.topNextActions || []).map((item) => item.key));
    if (
      result.score < 50 ||
      actionKeys.has('codexAgentsMd') ||
      actionKeys.has('codexConfigExists') ||
      actionKeys.has('codexNoDangerFullAccess') ||
      actionKeys.has('codexApprovalPolicyExplicit')
    ) {
      return 'npx nerviq --platform codex suggest-only';
    }

    return 'npx nerviq --platform codex augment';
  }

  const actionKeys = new Set((result.topNextActions || []).map((item) => item.key));
  const platFlag = result.platform && result.platform !== 'claude' ? ` --platform ${result.platform}` : '';

  if (result.failed === 0) return `npx nerviq${platFlag} augment`;
  if (
    result.score < 50 ||
    actionKeys.has('claudeMd') ||
    actionKeys.has('hooks') ||
    actionKeys.has('settingsPermissions') ||
    actionKeys.has('permissionDeny')
  ) {
    return `npx nerviq${platFlag} setup`;
  }
  if (result.score < 80) return `npx nerviq${platFlag} suggest-only`;
  return `npx nerviq${platFlag} augment`;
}

module.exports = {
  WEIGHTS,
  buildScoreCoaching,
  buildTopNextActions,
  confidenceLabel,
  computeCategoryScores,
  getFpFeedbackMultiplier,
  getQuickWins,
  getRecommendationPriorityScore,
  inferSuggestedNextCommand,
};
