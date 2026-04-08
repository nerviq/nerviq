/**
 * Audit engine - evaluates project against NERVIQ technique database.
 */

const path = require('path');
const { TECHNIQUES: CLAUDE_TECHNIQUES, STACKS, STACK_CATEGORY_DETECTORS } = require('./techniques');
const { ProjectContext } = require('./context');
const { CODEX_TECHNIQUES } = require('./codex/techniques');
const { detectCodexDomainPacks } = require('./codex/domain-packs');
const { CodexProjectContext, detectCodexVersion } = require('./codex/context');
const { GEMINI_TECHNIQUES } = require('./gemini/techniques');
const { detectGeminiDomainPacks } = require('./gemini/domain-packs');
const { GeminiProjectContext, detectGeminiVersion } = require('./gemini/context');
const { COPILOT_TECHNIQUES } = require('./copilot/techniques');
const { detectCopilotDomainPacks } = require('./copilot/domain-packs');
const { CopilotProjectContext } = require('./copilot/context');
const { CURSOR_TECHNIQUES } = require('./cursor/techniques');
const { detectCursorDomainPacks } = require('./cursor/domain-packs');
const { CursorProjectContext } = require('./cursor/context');
const { WINDSURF_TECHNIQUES } = require('./windsurf/techniques');
const { WindsurfProjectContext } = require('./windsurf/context');
const { AIDER_TECHNIQUES } = require('./aider/techniques');
const { AiderProjectContext } = require('./aider/context');
const { OPENCODE_TECHNIQUES } = require('./opencode/techniques');
const { OpenCodeProjectContext } = require('./opencode/context');
const { getBadgeMarkdown } = require('./badge');
const { sendInsights, getLocalInsights } = require('./insights');
const { getRecommendationOutcomeSummary, getRecommendationAdjustment } = require('./activity');
const { getFeedbackSummary } = require('./feedback');
const { formatSarif } = require('./formatters/sarif');
const { formatOtelMetrics } = require('./formatters/otel');
const { loadPlugins, mergePluginChecks } = require('./plugins');
const { hasWorkspaceConfig, detectWorkspaceGlobs, detectWorkspaces } = require('./workspace');
const { detectDeprecationWarnings } = require('./deprecation');
const { version: packageVersion } = require('../package.json');
const { t } = require('./i18n');

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  magenta: '\x1b[35m',
};

function colorize(text, color) {
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

function progressBar(score, max = 100, width = 20) {
  const filled = Math.round((score / max) * width);
  const empty = width - filled;
  const color = score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'red';
  return colorize('█'.repeat(filled), color) + colorize('░'.repeat(empty), 'dim');
}

function formatLocation(file, line) {
  if (!file) return null;
  return line ? `${file}:${line}` : file;
}

const IMPACT_ORDER = { critical: 3, high: 2, medium: 1, low: 0 };
const WEIGHTS = { critical: 15, high: 10, medium: 5, low: 2 };
const LARGE_INSTRUCTION_WARN_BYTES = 50 * 1024;
const LARGE_INSTRUCTION_SKIP_BYTES = 1024 * 1024;
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

function getAuditSpec(platform = 'claude') {
  if (platform === 'codex') {
    return {
      platform: 'codex',
      platformLabel: 'Codex',
      techniques: CODEX_TECHNIQUES,
      ContextClass: CodexProjectContext,
      platformVersion: detectCodexVersion(),
    };
  }

  if (platform === 'gemini') {
    return {
      platform: 'gemini',
      platformLabel: 'Gemini CLI',
      techniques: GEMINI_TECHNIQUES,
      ContextClass: GeminiProjectContext,
      platformVersion: detectGeminiVersion(),
    };
  }

  if (platform === 'copilot') {
    return {
      platform: 'copilot',
      platformLabel: 'GitHub Copilot',
      techniques: COPILOT_TECHNIQUES,
      ContextClass: CopilotProjectContext,
      platformVersion: null,
    };
  }

  if (platform === 'cursor') {
    return {
      platform: 'cursor',
      platformLabel: 'Cursor',
      techniques: CURSOR_TECHNIQUES,
      ContextClass: CursorProjectContext,
      platformVersion: null,
    };
  }

  if (platform === 'windsurf') {
    return {
      platform: 'windsurf',
      platformLabel: 'Windsurf',
      techniques: WINDSURF_TECHNIQUES,
      ContextClass: WindsurfProjectContext,
      platformVersion: null,
    };
  }

  if (platform === 'aider') {
    return {
      platform: 'aider',
      platformLabel: 'Aider',
      techniques: AIDER_TECHNIQUES,
      ContextClass: AiderProjectContext,
      platformVersion: null,
    };
  }

  if (platform === 'opencode') {
    return {
      platform: 'opencode',
      platformLabel: 'OpenCode',
      techniques: OPENCODE_TECHNIQUES,
      ContextClass: OpenCodeProjectContext,
      platformVersion: null,
    };
  }

  return {
    platform: 'claude',
    platformLabel: 'Claude',
    techniques: CLAUDE_TECHNIQUES,
    ContextClass: ProjectContext,
    platformVersion: null,
  };
}

function normalizeRelativePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function addPath(target, filePath) {
  if (!filePath || typeof filePath !== 'string') return;
  target.add(normalizeRelativePath(filePath));
}

function addDirFiles(ctx, target, dirPath, filter) {
  if (typeof ctx.dirFiles !== 'function') return;
  for (const file of ctx.dirFiles(dirPath)) {
    if (filter && !filter.test(file)) continue;
    addPath(target, path.join(dirPath, file));
  }
}

function instructionFileCandidates(spec, ctx) {
  const candidates = new Set();

  if (spec.platform === 'claude') {
    addPath(candidates, 'CLAUDE.md');
    addPath(candidates, '.claude/CLAUDE.md');
    addDirFiles(ctx, candidates, '.claude/rules', /\.md$/i);
    addDirFiles(ctx, candidates, '.claude/commands', /\.md$/i);
    addDirFiles(ctx, candidates, '.claude/agents', /\.md$/i);
    if (typeof ctx.dirFiles === 'function') {
      for (const skillDir of ctx.dirFiles('.claude/skills')) {
        addPath(candidates, path.join('.claude', 'skills', skillDir, 'SKILL.md'));
      }
    }
  }

  if (spec.platform === 'codex') {
    addPath(candidates, 'AGENTS.md');
    addPath(candidates, 'AGENTS.override.md');
    addPath(candidates, typeof ctx.agentsMdPath === 'function' ? ctx.agentsMdPath() : null);
    addDirFiles(ctx, candidates, 'codex/rules');
    addDirFiles(ctx, candidates, '.codex/rules');
    if (typeof ctx.skillDirs === 'function') {
      for (const skillDir of ctx.skillDirs()) {
        addPath(candidates, path.join('.agents', 'skills', skillDir, 'SKILL.md'));
      }
    }
  }

  if (spec.platform === 'gemini') {
    addPath(candidates, 'GEMINI.md');
    addPath(candidates, '.gemini/GEMINI.md');
    addDirFiles(ctx, candidates, '.gemini/agents', /\.md$/i);
    if (typeof ctx.skillDirs === 'function') {
      for (const skillDir of ctx.skillDirs()) {
        addPath(candidates, path.join('.gemini', 'skills', skillDir, 'SKILL.md'));
      }
    }
  }

  if (spec.platform === 'copilot') {
    addPath(candidates, '.github/copilot-instructions.md');
    addDirFiles(ctx, candidates, '.github/instructions', /\.instructions\.md$/i);
    addDirFiles(ctx, candidates, '.github/prompts', /\.prompt\.md$/i);
  }

  if (spec.platform === 'cursor') {
    addPath(candidates, '.cursorrules');
    addDirFiles(ctx, candidates, '.cursor/rules', /\.mdc$/i);
    addDirFiles(ctx, candidates, '.cursor/commands', /\.md$/i);
  }

  if (spec.platform === 'windsurf') {
    addPath(candidates, '.windsurfrules');
    addDirFiles(ctx, candidates, '.windsurf/rules', /\.md$/i);
    addDirFiles(ctx, candidates, '.windsurf/workflows', /\.md$/i);
    addDirFiles(ctx, candidates, '.windsurf/memories', /\.(md|json)$/i);
  }

  if (spec.platform === 'aider' && typeof ctx.conventionFiles === 'function') {
    for (const file of ctx.conventionFiles()) {
      addPath(candidates, file);
    }
  }

  if (spec.platform === 'opencode') {
    addPath(candidates, 'AGENTS.md');
    addPath(candidates, 'CLAUDE.md');
    addDirFiles(ctx, candidates, '.opencode/commands', /\.(md|markdown|ya?ml)$/i);
    if (typeof ctx.skillDirs === 'function') {
      for (const skillDir of ctx.skillDirs()) {
        addPath(candidates, path.join('.opencode', 'commands', skillDir, 'SKILL.md'));
      }
    }
  }

  return [...candidates];
}

function inspectInstructionFiles(spec, ctx) {
  const warnings = [];

  for (const filePath of instructionFileCandidates(spec, ctx)) {
    const byteCount = typeof ctx.fileSizeBytes === 'function' ? ctx.fileSizeBytes(filePath) : null;
    if (!Number.isFinite(byteCount) || byteCount <= LARGE_INSTRUCTION_WARN_BYTES) continue;

    const content = typeof ctx.fileContent === 'function' ? ctx.fileContent(filePath) : null;
    warnings.push({
      file: normalizeRelativePath(filePath),
      byteCount,
      lineCount: typeof content === 'string' ? content.split(/\r?\n/).length : null,
      skipped: byteCount > LARGE_INSTRUCTION_SKIP_BYTES,
      severity: byteCount > LARGE_INSTRUCTION_SKIP_BYTES ? 'critical' : 'warning',
      message: byteCount > LARGE_INSTRUCTION_SKIP_BYTES
        ? 'Instruction file exceeds 1MB and will be skipped during audit.'
        : 'Instruction file exceeds 50KB. Audit will continue, but this file may reduce runtime clarity.',
    });
  }

  return warnings;
}

function guardSkippedInstructionFiles(ctx, warnings) {
  const skippedFiles = new Set(
    warnings.filter((item) => item.skipped).map((item) => normalizeRelativePath(item.file))
  );

  if (skippedFiles.size === 0) return;

  const originalFileContent = typeof ctx.fileContent === 'function' ? ctx.fileContent.bind(ctx) : null;
  const originalLineNumber = typeof ctx.lineNumber === 'function' ? ctx.lineNumber.bind(ctx) : null;

  if (originalFileContent) {
    ctx.fileContent = (filePath) => {
      if (skippedFiles.has(normalizeRelativePath(filePath))) return null;
      return originalFileContent(filePath);
    };
  }

  if (originalLineNumber) {
    ctx.lineNumber = (filePath, matcher) => {
      if (skippedFiles.has(normalizeRelativePath(filePath))) return null;
      return originalLineNumber(filePath, matcher);
    };
  }
}

function buildWorkspaceHint(dir) {
  if (!hasWorkspaceConfig(dir)) {
    return null;
  }

  const patterns = detectWorkspaceGlobs(dir);
  const workspaces = detectWorkspaces(dir);
  if (patterns.length === 0 && workspaces.length === 0) {
    return null;
  }

  return {
    detected: true,
    patterns,
    workspaces,
    suggestedCommand: patterns.length > 0
      ? `npx nerviq audit --workspace ${patterns.join(',')}`
      : `npx nerviq audit --workspace ${workspaces.join(',')}`,
  };
}

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
  const prioritized = failed.filter(r => !(r.category === 'hygiene' && r.impact === 'low'));
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
  if (CODEX_QUICKWIN_AVOID_KEYS.has(item.key)) {
    return -100;
  }

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

  // QuickWins prioritize short fixes (easy to implement) first, then impact
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

/**
 * Compute a multiplier based on FP (helpful/not-helpful) feedback for a check key.
 * - >50% "not helpful" feedback: lower priority by 30% (multiplier 0.7)
 * - >80% "helpful" feedback: boost priority by 20% (multiplier 1.2)
 * - Otherwise: no change (multiplier 1.0)
 * @param {Object} fpFeedbackByKey - Keyed feedback summary from getFeedbackSummary().byKey
 * @param {string} key - The check key to look up
 * @returns {number} Multiplier to apply to priority score
 */
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
    .map(({ key, id, name, impact, fix, category, sourceUrl }) => {
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

      return ({
      key,
      id,
      name,
      impact,
      category,
      sourceUrl,
      module: CATEGORY_MODULES[category] || category,
      fix,
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
    });
    });
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
    if (result.failed === 0) {
      return 'npx nerviq --platform codex augment';
    }

    const actionKeys = new Set((result.topNextActions || []).map(item => item.key));
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

  const actionKeys = new Set((result.topNextActions || []).map(item => item.key));
  const platFlag = result.platform && result.platform !== 'claude' ? ` --platform ${result.platform}` : '';

  if (result.failed === 0) {
    return `npx nerviq${platFlag} augment`;
  }

  if (
    result.score < 50 ||
    actionKeys.has('claudeMd') ||
    actionKeys.has('hooks') ||
    actionKeys.has('settingsPermissions') ||
    actionKeys.has('permissionDeny')
  ) {
    return `npx nerviq${platFlag} setup`;
  }

  if (result.score < 80) {
    return `npx nerviq${platFlag} suggest-only`;
  }

  return `npx nerviq${platFlag} augment`;
}

function getPlatformScopeNote(spec, ctx) {
  if (spec.platform !== 'codex') {
    return null;
  }

  const hasClaudeSurface = Boolean(
    (typeof ctx.fileContent === 'function' && ctx.fileContent('CLAUDE.md')) ||
    (typeof ctx.hasDir === 'function' && ctx.hasDir('.claude'))
  );

  if (!hasClaudeSurface) {
    return null;
  }

  return {
    kind: 'codex-only-pass',
    message: 'This is a Codex-only pass. Claude Code surfaces were also detected and should be audited separately with `npx nerviq`.',
  };
}

function getPlatformCaveats(spec, ctx) {
  if (spec.platform !== 'codex') {
    return [];
  }

  const caveats = [];
  const hooksJson = typeof ctx.hooksJsonContent === 'function' ? (ctx.hooksJsonContent() || '') : '';
  const agentsContent = typeof ctx.agentsMdContent === 'function' ? (ctx.agentsMdContent() || '') : '';
  const hooksClaimed = Boolean(
    hooksJson ||
    (typeof ctx.hasDir === 'function' && ctx.hasDir('.codex/hooks')) ||
    /\bhooks?\b|\bSessionStart\b|\bPreToolUse\b|\bPostToolUse\b|\bUserPromptSubmit\b|\bStop\b/i.test(agentsContent)
  );

  if (process.platform === 'win32') {
    caveats.push({
      key: 'codex-windows-hooks',
      severity: hooksClaimed ? 'critical' : 'info',
      title: 'Codex hooks are not available on Windows',
      message: hooksClaimed
        ? 'This repo claims Codex hooks, but native Windows sessions do not execute them. Keep enforcement in rules, CI, or another documented fallback.'
        : 'Native Windows sessions do not execute Codex hooks. If you add hooks later, treat them as non-enforcing on Windows and keep critical enforcement in rules or CI.',
      file: hooksJson ? '.codex/hooks.json' : null,
      line: hooksJson ? 1 : null,
    });
  }

  const maxThreads = typeof ctx.configValue === 'function' ? ctx.configValue('agents.max_threads') : undefined;
  caveats.push({
    key: 'codex-max-threads-default',
    severity: typeof maxThreads === 'number' && maxThreads > 6 ? 'warning' : 'info',
    title: 'Codex agent thread concurrency defaults to 6 when unset',
    message: typeof maxThreads === 'number'
      ? `This repo sets agents.max_threads = ${maxThreads}. Codex defaults to 6 when unset, so any higher concurrency assumption should be validated in the runtime you actually use.`
      : 'Codex defaults agents.max_threads to 6 when unset. If your workflow depends on heavy parallel subagent usage, set it intentionally and validate the behavior in your real runtime.',
    file: typeof ctx.fileContent === 'function' && ctx.fileContent('.codex/config.toml') ? '.codex/config.toml' : null,
    line: typeof ctx.lineNumber === 'function' ? (ctx.lineNumber('.codex/config.toml', /\bagents\.max_threads\b|\bmax_threads\b/i) || null) : null,
  });

  return caveats;
}

function getCodexDomainPackSignals(ctx) {
  return {
    instructionPath: typeof ctx.agentsMdPath === 'function' ? ctx.agentsMdPath() : null,
    trust: {
      approvalPolicy: typeof ctx.configValue === 'function' ? (ctx.configValue('approval_policy') || null) : null,
      sandboxMode: typeof ctx.configValue === 'function' ? (ctx.configValue('sandbox_mode') || null) : null,
      isTrustedProject: typeof ctx.isProjectTrusted === 'function' ? ctx.isProjectTrusted() : false,
    },
    counts: {
      rules: typeof ctx.ruleFiles === 'function' ? ctx.ruleFiles().length : 0,
      workflows: typeof ctx.workflowFiles === 'function' ? ctx.workflowFiles().length : 0,
      mcpServers: typeof ctx.mcpServers === 'function' ? Object.keys(ctx.mcpServers() || {}).length : 0,
    },
  };
}

function printLiteAudit(result, dir) {
  console.log('');
  const productLabel = result.platform === 'codex' ? t('audit.codexQuickScan') : t('audit.quickScan');
  console.log(colorize(`  ${productLabel}`, 'bold'));
  console.log(colorize('  ═══════════════════════════════════════', 'dim'));
  console.log(colorize(`  ${t('audit.scanning', { dir })}`, 'dim'));
  console.log('');
  if (result.detectedConfigFiles && result.detectedConfigFiles.length > 0) {
    console.log(colorize(`  Found: ${result.detectedConfigFiles.join(', ')}`, 'dim'));
  }
  console.log('');
  console.log(`  ${t('audit.score', { score: colorize(`${result.score}/100`, 'bold'), passed: result.passed, total: result.passed + result.failed })}`);

  // Score explanation line (lite mode only)
  const _critCount = (result.results || []).filter(r => r.passed === false && r.impact === 'critical').length;
  const _highCount = (result.results || []).filter(r => r.passed === false && r.impact === 'high').length;
  let scoreExplanation;
  if (result.score >= 90) {
    scoreExplanation = t('audit.excellent');
  } else if (result.score >= 70) {
    scoreExplanation = t('audit.strong', { count: _critCount });
  } else if (result.score >= 50) {
    scoreExplanation = t('audit.good', { count: _critCount + _highCount });
  } else if (result.score >= 30) {
    // Find weakest category (most failures)
    const catFailures = {};
    (result.results || []).filter(r => r.passed === false).forEach(r => {
      const cat = r.category || 'unknown';
      catFailures[cat] = (catFailures[cat] || 0) + 1;
    });
    const weakestCategory = Object.keys(catFailures).sort((a, b) => catFailures[b] - catFailures[a])[0] || 'config';
    scoreExplanation = t('audit.basic', { category: weakestCategory });
  } else {
    scoreExplanation = t('audit.early');
  }
  console.log(colorize(`  ${scoreExplanation}`, 'dim'));
  console.log(colorize('  Score type: live repo audit (current files only, not snapshot history or benchmark projection).', 'dim'));

  if (result.platformScopeNote) {
    console.log(colorize(`  Scope: ${result.platformScopeNote.message}`, 'dim'));
  }
  if (result.workspaceHint && result.workspaceHint.workspaces.length > 0) {
    console.log(colorize(`  Workspaces: ${result.workspaceHint.workspaces.join(', ')}`, 'dim'));
  }
  if (result.platformCaveats && result.platformCaveats.length > 0) {
    console.log(colorize('  Platform caveats:', 'yellow'));
    result.platformCaveats.slice(0, 2).forEach((item) => {
      console.log(colorize(`     - ${item.title}: ${item.message}`, 'dim'));
    });
  }
  if (result.largeInstructionFiles && result.largeInstructionFiles.length > 0) {
    result.largeInstructionFiles.slice(0, 2).forEach((item) => {
      console.log(colorize(`  Large file: ${item.file} (${Math.round(item.byteCount / 1024)}KB)`, 'yellow'));
    });
  }
  console.log('');

  if (result.failed === 0) {
    const platformLabel = result.platform === 'codex' ? 'Codex' : 'Claude';
    console.log(colorize(`  Your ${platformLabel} setup looks solid.`, 'green'));
    console.log(`  Next: ${colorize(result.suggestedNextCommand, 'bold')}`);
    if (result.platform === 'codex') {
      console.log(colorize('  Note: Codex now supports no-write advisory flows via augment and suggest-only before setup/apply.', 'dim'));
    }
    console.log(colorize('  Star: github.com/nerviq/nerviq  |  Discord: discord.gg/nerviq', 'dim'));
    console.log('');
    return;
  }

  // Urgency summary line (only count actual failures, not skipped/null)
  const criticalCount = (result.results || []).filter(r => r.passed === false && r.impact === 'critical').length;
  const highCount = (result.results || []).filter(r => r.passed === false && r.impact === 'high').length;
  const mediumCount = result.failed - criticalCount - highCount;
  const urgencyParts = [];
  if (criticalCount > 0) urgencyParts.push(colorize(`🔴 ${criticalCount} critical`, 'red'));
  if (highCount > 0) urgencyParts.push(colorize(`🟡 ${highCount} high`, 'yellow'));
  if (mediumCount > 0) urgencyParts.push(colorize(`🔵 ${mediumCount} recommended`, 'blue'));
  if (urgencyParts.length > 0) {
    console.log(`  ${urgencyParts.join('  ')}`);
    console.log('');
  }

  console.log(colorize('  Top 3 things to fix right now:', 'magenta'));
  console.log('');
  let usagePatterns;
  try { usagePatterns = require('./usage-patterns'); } catch { usagePatterns = null; }
  result.liteSummary.topNextActions.forEach((item, index) => {
    const tier = item.impact === 'critical' ? '🔴' : item.impact === 'high' ? '🟡' : '🔵';
    const suppressed = usagePatterns && usagePatterns.getPriorityAdjustment(dir, item.key) === 'suppress';
    const suffix = suppressed ? colorize(' (suppressed)', 'dim') : '';
    console.log(`  ${index + 1}. ${tier} ${colorize(item.name, 'bold')}${suffix}`);
    console.log(colorize(`     ${item.fix}`, 'dim'));
  });
  console.log('');
  console.log(`  Ready? Run: ${colorize(result.suggestedNextCommand, 'bold')}`);
  if (result.platform === 'codex') {
    console.log(colorize('  Note: Codex now supports no-write advisory flows via augment and suggest-only before setup/apply.', 'dim'));
  }
  console.log(colorize(`  See all ${result.failed} failed checks: ${colorize('nerviq audit --full', 'bold')}`, 'dim'));
  console.log(colorize('  Star: github.com/nerviq/nerviq  |  Discord: discord.gg/nerviq', 'dim'));
  console.log('');
}

/**
 * Run a full audit of a project's Claude Code setup against the NERVIQ technique database.
 * @param {Object} options - Audit options.
 * @param {string} options.dir - Project directory to audit.
 * @param {boolean} [options.silent] - Skip all console output, return result only.
 * @param {boolean} [options.json] - Output result as JSON.
 * @param {boolean} [options.lite] - Show short top-3 quick scan.
 * @param {boolean} [options.verbose] - Show all recommendations including medium-impact.
 * @param {boolean} [options.showDeprecated] - Include deprecated checks in output.
 * @returns {Promise<Object>} Audit result with score, passed/failed counts, quickWins, and topNextActions.
 */
async function audit(options) {
  const spec = getAuditSpec(options.platform || 'claude');
  const silent = options.silent || false;
  const ctx = new spec.ContextClass(options.dir);
  const largeInstructionFiles = inspectInstructionFiles(spec, ctx);
  guardSkippedInstructionFiles(ctx, largeInstructionFiles);
  const stacks = ctx.detectStacks(STACKS);
  const results = [];
  const outcomeSummary = getRecommendationOutcomeSummary(options.dir);
  const fpFeedback = getFeedbackSummary(options.dir);
  const workspaceHint = buildWorkspaceHint(options.dir);

  // Load and merge plugin checks
  const plugins = loadPlugins(options.dir);
  const techniques = plugins.length > 0
    ? mergePluginChecks(spec.techniques, plugins)
    : spec.techniques;

  // Pre-compute which stack categories are active for this project
  const activeStackCategories = new Set();
  for (const [category, detector] of Object.entries(STACK_CATEGORY_DETECTORS)) {
    if (detector(ctx)) activeStackCategories.add(category);
  }

  // Generic quality categories that are NOT about AI agent configuration.
  // These are only included with --verbose or --full --verbose (deep quality mode).
  const GENERIC_QUALITY_CATEGORIES = new Set([
    'observability', 'accessibility', 'i18n', 'privacy', 'error-tracking',
    'supply-chain', 'api-versioning', 'caching', 'rate-limiting', 'feature-flags',
    'docs-quality', 'monorepo', 'performance-budget', 'realtime', 'graphql',
    'testing-strategy', 'code-quality', 'api-design', 'database', 'authentication',
    'monitoring', 'dependency-management', 'cost-optimization',
  ]);
  const includeGenericQuality = options.verbose;

  // Run all technique checks
  for (const [key, technique] of Object.entries(techniques)) {
    // Skip entire stack category if the stack is not detected at a core location
    // Skip generic quality categories unless --verbose is set
    const cat = technique.category;
    if ((!includeGenericQuality && GENERIC_QUALITY_CATEGORIES.has(cat)) ||
        (STACK_CATEGORY_DETECTORS[cat] && !activeStackCategories.has(cat))) {
      results.push({
        key,
        ...technique,
        file: null,
        line: null,
        passed: null, // not applicable
      });
      continue;
    }

    const passed = technique.check(ctx);
    const file = typeof technique.file === 'function' ? (technique.file(ctx) ?? null) : (technique.file ?? null);
    const line = typeof technique.line === 'function' ? (technique.line(ctx) ?? null) : (technique.line ?? null);
    results.push({
      key,
      ...technique,
      file,
      line: Number.isFinite(line) ? line : null,
      passed,
    });
  }

  if (largeInstructionFiles.length > 0) {
    results.push({
      key: 'largeInstructionFile',
      id: null,
      name: 'Large instruction file warning',
      category: 'performance',
      impact: 'medium',
      rating: null,
      fix: 'Split oversized instruction files so they stay under 50KB, and keep any single instruction file below 1MB.',
      sourceUrl: null,
      confidence: 'high',
      file: largeInstructionFiles[0].file,
      line: null,
      passed: null,
      details: largeInstructionFiles,
    });
  }

  // Separate deprecated checks from active checks.
  // Deprecated checks are excluded from scoring but preserved for display.
  const deprecated = results.filter(r => r.deprecated === true);
  const activeResults = results.filter(r => r.deprecated !== true);

  // null = not applicable (skip), true = pass, false = fail
  const applicable = activeResults.filter(r => r.passed !== null);
  const skipped = activeResults.filter(r => r.passed === null);
  const passed = applicable.filter(r => r.passed);
  const failed = applicable.filter(r => !r.passed);
  const critical = failed.filter(r => r.impact === 'critical');
  const high = failed.filter(r => r.impact === 'high');
  const medium = failed.filter(r => r.impact === 'medium');

  // Calculate score only from applicable checks
  const maxScore = applicable.reduce((sum, r) => sum + (WEIGHTS[r.impact] || 5), 0);
  const earnedScore = passed.reduce((sum, r) => sum + (WEIGHTS[r.impact] || 5), 0);
  const score = maxScore > 0 ? Math.round((earnedScore / maxScore) * 100) : 0;

  // Detect scaffolded vs organic: if CLAUDE.md contains our version stamp, some checks
  // are passing because WE generated them, not the user
  const instructionSource = spec.platform === 'codex'
    ? (ctx.agentsMdContent ? (ctx.agentsMdContent() || '') : '')
    : (ctx.claudeMdContent() || '');
  const isScaffolded = instructionSource.includes('Generated by nerviq') ||
    instructionSource.includes('nerviq');
  // Scaffolded checks: things our setup creates (CLAUDE.md / AGENTS.md, hooks, commands, agents, rules, skills)
  const scaffoldedKeys = spec.platform === 'codex'
    ? new Set([
      'codexAgentsMd',
      'codexAgentsMdSubstantive',
      'codexAgentsVerificationCommands',
      'codexAgentsArchitecture',
      'codexConfigExists',
      'codexModelExplicit',
      'codexReasoningEffortExplicit',
      'codexWeakModelExplicit',
      'codexSandboxModeExplicit',
      'codexApprovalPolicyExplicit',
      'codexFullAutoErrorModeExplicit',
      'codexHistorySendToServerExplicit',
    ])
    : new Set(['claudeMd', 'mermaidArchitecture', 'verificationLoop',
      'hooks', 'customCommands', 'multipleCommands', 'agents', 'pathRules', 'multipleRules',
      'skills', 'hooksConfigured', 'preToolUseHook', 'postToolUseHook', 'fewShotExamples',
      'constraintBlocks', 'xmlTags']);
  const organicPassed = passed.filter(r => !scaffoldedKeys.has(r.key));
  const scaffoldedPassed = passed.filter(r => scaffoldedKeys.has(r.key));
  const organicEarned = organicPassed.reduce((sum, r) => sum + (WEIGHTS[r.impact] || 5), 0);
  const organicScore = maxScore > 0 ? Math.round((organicEarned / maxScore) * 100) : 0;
  const quickWins = getQuickWins(failed, { platform: spec.platform });
  const topNextActions = buildTopNextActions(failed, 5, outcomeSummary.byKey, { platform: spec.platform, fpFeedbackByKey: fpFeedback.byKey });
  const categoryScores = computeCategoryScores(applicable, passed);
  const platformScopeNote = getPlatformScopeNote(spec, ctx);
  const platformCaveats = getPlatformCaveats(spec, ctx);
  const deprecationWarnings = detectDeprecationWarnings(failed, packageVersion);
  const warnings = [
    ...largeInstructionFiles.map((item) => ({
      kind: 'large-instruction-file',
      severity: item.severity,
      message: item.message,
      file: item.file,
      lineCount: item.lineCount,
      byteCount: item.byteCount,
      skipped: item.skipped,
    })),
    ...deprecationWarnings.map((item) => ({
      kind: 'deprecated-feature',
      severity: 'warning',
      ...item,
    })),
  ];
  const recommendedDomainPacks = spec.platform === 'codex'
    ? detectCodexDomainPacks(ctx, stacks, getCodexDomainPackSignals(ctx))
    : [];
  const result = {
    platform: spec.platform,
    platformLabel: spec.platformLabel,
    platformVersion: spec.platformVersion,
    score,
    organicScore,
    earnedPoints: earnedScore,
    maxPoints: maxScore,
    isScaffolded,
    passed: passed.length,
    failed: failed.length,
    skipped: skipped.length,
    deprecated: deprecated.length,
    checkCount: applicable.length,
    stacks,
    results,
    deprecatedChecks: deprecated.map(r => ({
      key: r.key,
      name: r.name,
      category: r.category,
      deprecatedReason: r.deprecatedReason || null,
      sunsetDate: r.sunsetDate || null,
    })),
    categoryScores,
    quickWins: quickWins.map(({ key, name, impact, fix, category, sourceUrl }) => ({ key, name, impact, category, fix, sourceUrl })),
    topNextActions,
    recommendationOutcomes: {
      totalEntries: outcomeSummary.totalEntries,
      keysTracked: outcomeSummary.keys,
    },
    largeInstructionFiles,
    deprecationWarnings,
    warnings,
    workspaceHint,
    platformScopeNote,
    platformCaveats,
    recommendedDomainPacks,
  };
  // Detect which AI config files are present
  const configFiles = [];
  const configChecks = [
    ['CLAUDE.md', 'CLAUDE.md'], ['.claude/settings.json', '.claude/settings.json'],
    ['AGENTS.md', 'AGENTS.md'], ['.cursorrules', '.cursorrules'],
    ['.cursor/rules', '.cursor/rules/'], ['GEMINI.md', 'GEMINI.md'],
    ['.windsurfrules', '.windsurfrules'], ['.aider.conf.yml', '.aider.conf.yml'],
    ['opencode.json', 'opencode.json'], ['.mcp.json', '.mcp.json'],
  ];
  for (const [file, label] of configChecks) {
    try {
      if (require('fs').existsSync(require('path').join(options.dir, file))) configFiles.push(label);
    } catch {}
  }
  result.detectedConfigFiles = configFiles;

  result.suggestedNextCommand = inferSuggestedNextCommand(result);
  result.liteSummary = {
    topNextActions: topNextActions.slice(0, 3),
    nextCommand: result.suggestedNextCommand,
    platformCaveats: platformCaveats.slice(0, 2),
  };

  // Silent mode: skip all output, just return result
  if (silent) {
    return result;
  }

  if (options.json) {
    console.log(JSON.stringify({
      version: packageVersion,
      timestamp: new Date().toISOString(),
      ...result
    }, null, 2));
    return result;
  }

  if (options.format === 'sarif') {
    console.log(JSON.stringify(formatSarif(result, { dir: options.dir }), null, 2));
    return result;
  }

  if (options.format === 'otel') {
    console.log(JSON.stringify(formatOtelMetrics(result), null, 2));
    return result;
  }

  if (options.lite) {
    printLiteAudit(result, options.dir);
    sendInsights(result);
    return result;
  }

  // Display results
  console.log('');
  const auditTitle = spec.platform === 'codex' ? t('audit.codexTitle') : t('audit.title');
  console.log(colorize(`  ${auditTitle}`, 'bold'));
  console.log(colorize('  ═══════════════════════════════════════', 'dim'));
  console.log(colorize(`  ${t('audit.scanning', { dir: options.dir })}`, 'dim'));
  if (spec.platformVersion) {
    console.log(colorize(`  Platform: ${spec.platformLabel} (${spec.platformVersion})`, 'blue'));
  }
  if (spec.platform === 'codex' && recommendedDomainPacks.length > 0) {
    console.log(colorize(`  Domain packs: ${recommendedDomainPacks.map((pack) => pack.label).join(', ')}`, 'dim'));
  }
  if (platformScopeNote) {
    console.log(colorize(`  Scope: ${platformScopeNote.message}`, 'dim'));
  }
  if (platformCaveats.length > 0) {
    console.log(colorize('  Platform caveats', 'yellow'));
    for (const caveat of platformCaveats) {
      console.log(colorize(`     ${caveat.title}`, 'bold'));
      console.log(colorize(`     → ${caveat.message}`, 'dim'));
      if (caveat.file) {
        console.log(colorize(`     at ${formatLocation(caveat.file, caveat.line)}`, 'dim'));
      }
    }
    console.log('');
  }

  if (largeInstructionFiles.length > 0) {
    console.log(colorize('  Large instruction files', 'yellow'));
    for (const item of largeInstructionFiles) {
      const sizeKb = Math.round(item.byteCount / 1024);
      console.log(colorize(`     ${item.file} (${sizeKb}KB, ${item.lineCount || '?'} lines)`, 'bold'));
      console.log(colorize(`     → ${item.message}`, 'dim'));
    }
    console.log('');
  }

  if (deprecationWarnings.length > 0) {
    console.log(colorize('  Deprecated feature warnings', 'yellow'));
    for (const item of deprecationWarnings) {
      console.log(colorize(`     ${item.feature}`, 'bold'));
      console.log(colorize(`     → ${item.message}`, 'dim'));
      console.log(colorize(`     Alternative: ${item.alternative}`, 'dim'));
    }
    console.log('');
  }

  if (workspaceHint && !options.workspace) {
    console.log(colorize('  Monorepo detected', 'blue'));
    if (workspaceHint.workspaces.length > 0) {
      console.log(colorize(`     Workspaces: ${workspaceHint.workspaces.join(', ')}`, 'dim'));
    }
    console.log(colorize(`     Tip: ${workspaceHint.suggestedCommand}`, 'dim'));
    console.log('');
  }

  if (stacks.length > 0) {
    console.log(colorize(`  Detected: ${stacks.map(s => s.label).join(', ')}`, 'blue'));
  }

  console.log('');

  // Score
  console.log(`  ${progressBar(score)} ${colorize(`${score}/100`, 'bold')}`);
  if (isScaffolded && scaffoldedPassed.length > 0) {
    console.log(colorize(`  Organic: ${organicScore}/100 (without nerviq generated files)`, 'dim'));
  }
  console.log('');

  // Passed
  if (passed.length > 0) {
    console.log(colorize('  ✅ Passing', 'green'));
    for (const r of passed) {
      console.log(colorize(`     ${r.name}`, 'dim'));
    }
    console.log('');
  }

  // Deprecated checks (shown with --show-deprecated or --full)
  if (deprecated.length > 0 && (options.showDeprecated || options.full)) {
    console.log(colorize(`  ⏳ Deprecated (${deprecated.length} checks excluded from scoring)`, 'dim'));
    for (const r of deprecated) {
      const reason = r.deprecatedReason ? ` — ${r.deprecatedReason}` : '';
      const sunset = r.sunsetDate ? ` (sunset: ${r.sunsetDate})` : '';
      console.log(colorize(`     [DEPRECATED] ${r.name}${reason}${sunset}`, 'dim'));
    }
    console.log('');
  }

  // Failed - by priority
  if (critical.length > 0) {
    console.log(colorize('  🔴 Critical (fix immediately)', 'red'));
    for (const r of critical) {
      const conf = r.confidence ? ` [${confidenceLabel(r.confidence)}]` : '';
      console.log(`     ${colorize(r.name, 'bold')}${colorize(conf, 'dim')}`);
      if (r.file) {
        console.log(colorize(`     at ${formatLocation(r.file, r.line)}`, 'dim'));
      }
      console.log(colorize(`     → ${r.fix}`, 'dim'));
    }
    console.log('');
  }

  if (high.length > 0) {
    console.log(colorize('  🟡 High Impact', 'yellow'));
    for (const r of high) {
      const conf = r.confidence ? ` [${confidenceLabel(r.confidence)}]` : '';
      console.log(`     ${colorize(r.name, 'bold')}${colorize(conf, 'dim')}`);
      if (r.file) {
        console.log(colorize(`     at ${formatLocation(r.file, r.line)}`, 'dim'));
      }
      console.log(colorize(`     → ${r.fix}`, 'dim'));
    }
    console.log('');
  }

  if (medium.length > 0 && options.verbose) {
    console.log(colorize('  🔵 Recommended', 'blue'));
    for (const r of medium) {
      const conf = r.confidence ? ` [${confidenceLabel(r.confidence)}]` : '';
      console.log(`     ${colorize(r.name, 'bold')}${colorize(conf, 'dim')}`);
      if (r.file) {
        console.log(colorize(`     at ${formatLocation(r.file, r.line)}`, 'dim'));
      }
      console.log(colorize(`     → ${r.fix}`, 'dim'));
    }
    console.log('');
  } else if (medium.length > 0) {
    console.log(colorize(`  🔵 ${medium.length} more recommendations (use --verbose)`, 'blue'));
    console.log('');
  }

  // Top next actions
  if (topNextActions.length > 0) {
    console.log(colorize('  ⚡ Top 5 Next Actions', 'magenta'));
    for (let i = 0; i < topNextActions.length; i++) {
      const item = topNextActions[i];
      console.log(`     ${i + 1}. ${colorize(item.name, 'bold')}`);
      console.log(colorize(`        Why: ${item.why}`, 'dim'));
      console.log(colorize(`        Trace: ${item.signals.join(' | ')}`, 'dim'));
      console.log(colorize(`        Risk: ${item.risk} | Confidence: ${item.confidence}`, 'dim'));
      const sourceResult = result.results.find(r => r.key === item.key);
      if (sourceResult && sourceResult.file) {
        console.log(colorize(`        Evidence: ${formatLocation(sourceResult.file, sourceResult.line)}`, 'dim'));
      }
      if (item.feedback) {
        const avgDelta = Number.isFinite(item.feedback.avgScoreDelta) ? ` | Avg score delta: ${item.feedback.avgScoreDelta >= 0 ? '+' : ''}${item.feedback.avgScoreDelta}` : '';
        console.log(colorize(`        Feedback: accepted ${item.feedback.accepted}, rejected ${item.feedback.rejected}, positive ${item.feedback.positive}, negative ${item.feedback.negative}${avgDelta}`, 'dim'));
      }
      console.log(colorize(`        Fix: ${item.fix}`, 'dim'));
    }
    console.log('');
  }

  // Summary
  console.log(colorize('  ─────────────────────────────────────', 'dim'));
  const deprecatedNote = deprecated.length > 0 ? colorize(`, ${deprecated.length} deprecated`, 'dim') : '';
  console.log(`  ${colorize(`${passed.length}/${applicable.length}`, 'bold')} checks passing${skipped.length > 0 ? colorize(` (${skipped.length} not applicable${deprecatedNote})`, 'dim') : (deprecatedNote ? colorize(` (${deprecatedNote})`, 'dim') : '')}`);

  if (failed.length > 0) {
    console.log(`  Next command: ${colorize(result.suggestedNextCommand, 'bold')}`);
    if (result.platform === 'codex') {
      console.log(colorize('  Codex now supports advisory no-write flows through augment and suggest-only before setup/apply.', 'dim'));
    }
  }

  console.log('');
  console.log(`  Add to README: ${getBadgeMarkdown(score)}`);
  console.log('');

  // Weakest categories insight
  const insights = getLocalInsights({ score, results });
  if (insights.weakest.length > 0) {
    console.log(colorize('  Weakest areas:', 'dim'));
    for (const w of insights.weakest) {
      const bar = w.score === 0 ? colorize('none', 'red') : `${w.score}%`;
      console.log(colorize(`     ${w.name}: ${bar} (${w.passed}/${w.total})`, 'dim'));
    }
    console.log('');
  }

  // Cross-platform synergy hint
  try {
    const { detectActivePlatforms } = require('./harmony/canon');
    const { analyzeCompensation } = require('./synergy/compensation');
    const { calculateSynergyScore } = require('./synergy/ranking');
    const detected = detectActivePlatforms(options.dir);
    const activePlatforms = (detected || []).filter(p => p.detected).map(p => p.platform);
    if (activePlatforms.length >= 2) {
      const comp = analyzeCompensation(activePlatforms);
      const synergyScore = calculateSynergyScore(activePlatforms);
      console.log(colorize(`  Cross-platform synergy [EXPERIMENTAL]: ${activePlatforms.length} platforms detected`, 'blue'));
      console.log(colorize(`     Platforms: ${activePlatforms.join(', ')}`, 'dim'));
      console.log(colorize(`     Compensations: ${comp.compensations.length} | Gaps: ${comp.uncoveredGaps.length}`, 'dim'));
      console.log(colorize(`     Run: npx nerviq harmony-audit for full cross-platform analysis`, 'dim'));
      console.log('');
    }
  } catch { /* synergy display is optional */ }

  console.log(colorize(`  Backed by NERVIQ research and evidence for ${spec.platformLabel}`, 'dim'));
  console.log(colorize('  https://github.com/nerviq/nerviq', 'dim'));
  console.log('');

  // Send anonymous insights (opt-in, privacy-first, fire-and-forget)
  sendInsights(result);

  return result;
}

module.exports = { audit, buildTopNextActions, getFpFeedbackMultiplier, getRecommendationPriorityScore };
