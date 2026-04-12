/**
 * Audit engine - evaluates project against NERVIQ technique database.
 */

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
const { getRecommendationOutcomeSummary } = require('./activity');
const { getFeedbackSummary } = require('./feedback');
const { formatSarif } = require('./formatters/sarif');
const { formatOtelMetrics } = require('./formatters/otel');
const { collectAuditTerminology, formatTerminologyLines } = require('./terminology');
const { loadPlugins, mergePluginChecks } = require('./plugins');
const { detectDeprecationWarnings } = require('./deprecation');
const { buildWorkspaceHint, formatCount, guardSkippedInstructionFiles, inspectInstructionFiles } = require('./audit/instruction-files');
const {
  WEIGHTS,
  buildScoreCoaching,
  buildTopNextActions,
  confidenceLabel,
  computeCategoryScores,
  getFpFeedbackMultiplier,
  getQuickWins,
  getRecommendationPriorityScore,
  inferSuggestedNextCommand,
} = require('./audit/recommendations');
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
  if (result.scoreCoaching) {
    console.log(colorize(`  Milestone: ${result.scoreCoaching.summary}`, 'magenta'));
  }
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
      console.log(colorize(`  Large file: ${item.file} (~${formatCount(item.tokenCount)} tokens)`, 'yellow'));
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
  const liteTerminology = formatTerminologyLines(collectAuditTerminology(result));
  if (liteTerminology.length > 0) {
    liteTerminology.forEach((line) => {
      const color = line.startsWith('  Terms used here:') ? 'blue' : 'dim';
      console.log(colorize(line, color));
    });
    console.log('');
  }
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
    'monitoring', 'dependency-management', 'cost-optimization', 'devops',
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
      fix: 'Split oversized instruction files so they stay under ~12,000 tokens, and keep any single instruction file below ~240,000 tokens.',
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
      tokenCount: item.tokenCount,
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

  // FB-05: framework-aware fix rewriting — don't recommend `npm test` on a
  // Python/Go/Rust-only repo. Only rewrites when Node/JS stacks are absent.
  const stackKeys = new Set(stacks.map(s => s.key));
  const hasNodeStack = stackKeys.has('node') || stackKeys.has('react') || stackKeys.has('vue') ||
    stackKeys.has('nextjs') || stackKeys.has('angular') || stackKeys.has('svelte') ||
    stackKeys.has('nestjs') || stackKeys.has('remix') || stackKeys.has('astro') ||
    stackKeys.has('typescript') || stackKeys.has('deno') || stackKeys.has('bun');
  if (!hasNodeStack) {
    let preferredTest = null;
    let preferredInstall = null;
    if (stackKeys.has('python') || stackKeys.has('django') || stackKeys.has('fastapi')) {
      preferredTest = 'pytest'; preferredInstall = 'pip install -r requirements.txt';
    } else if (stackKeys.has('go')) {
      preferredTest = 'go test ./...'; preferredInstall = 'go mod download';
    } else if (stackKeys.has('rust')) {
      preferredTest = 'cargo test'; preferredInstall = 'cargo fetch';
    } else if (stackKeys.has('ruby')) {
      preferredTest = 'bundle exec rspec'; preferredInstall = 'bundle install';
    } else if (stackKeys.has('java') || stackKeys.has('kotlin')) {
      preferredTest = './gradlew test'; preferredInstall = './gradlew build';
    } else if (stackKeys.has('elixir')) {
      preferredTest = 'mix test'; preferredInstall = 'mix deps.get';
    } else if (stackKeys.has('dotnet')) {
      preferredTest = 'dotnet test'; preferredInstall = 'dotnet restore';
    }
    if (preferredTest) {
      for (const r of results) {
        if (typeof r.fix !== 'string') continue;
        if (/\bnpm\s+test\b/i.test(r.fix)) r.fix = r.fix.replace(/`npm\s+test`/gi, '`' + preferredTest + '`').replace(/\bnpm\s+test\b/gi, preferredTest);
        if (/\bnpm\s+ci\b/i.test(r.fix) && preferredInstall) r.fix = r.fix.replace(/`npm\s+ci`/gi, '`' + preferredInstall + '`').replace(/\bnpm\s+ci\b/gi, preferredInstall);
        if (/\bnpm\s+install\b/i.test(r.fix) && preferredInstall) r.fix = r.fix.replace(/`npm\s+install`/gi, '`' + preferredInstall + '`').replace(/\bnpm\s+install\b/gi, preferredInstall);
      }
    }
  }

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
    scoreCoaching: buildScoreCoaching({
      score,
      earnedPoints: earnedScore,
      maxPoints: maxScore,
      failed,
      outcomeSummaryByKey: outcomeSummary.byKey,
      platform: spec.platform,
      fpFeedbackByKey: fpFeedback.byKey,
    }),
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
    scoreCoaching: result.scoreCoaching,
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
      const sizeKb = Number.isFinite(item.byteCount) ? Math.round(item.byteCount / 1024) : '?';
      console.log(colorize(`     ${item.file} (~${formatCount(item.tokenCount)} tokens, ${item.lineCount || '?'} lines, ${sizeKb}KB)`, 'bold'));
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
  if (result.scoreCoaching) {
    const fastestPath = result.scoreCoaching.recommendedNames.slice(0, 3).join(', ');
    console.log(colorize(`  Milestone: ${result.scoreCoaching.summary}`, 'magenta'));
    if (fastestPath) {
      console.log(colorize(`  Fastest path: ${fastestPath}`, 'dim'));
    }
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

  const terminology = formatTerminologyLines(collectAuditTerminology(result));
  if (terminology.length > 0) {
    terminology.forEach((line) => {
      const color = line.startsWith('  Terms used here:') ? 'blue' : 'dim';
      console.log(colorize(line, color));
    });
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
