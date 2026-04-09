/**
 * Project scanner + recommendation layer for augment and suggest-only modes.
 * Produces a structured repo-aware analysis without writing files.
 */

const path = require('path');
const { audit } = require('./audit');
const { ProjectContext } = require('./context');
const { CodexProjectContext } = require('./codex/context');
const { STACKS } = require('./techniques');
const { detectDomainPacks } = require('./domain-packs');
const { detectCodexDomainPacks } = require('./codex/domain-packs');
const { recommendMcpPacks } = require('./mcp-packs');
const { collectClaudeDenyRules } = require('./permission-rules');
const { buildRepoArchetypeProfile } = require('./repo-archetype');
const { buildOperatingProfile } = require('./operating-profile');

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

function c(text, color) {
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractTomlSection(content, sectionName) {
  const pattern = new RegExp(`\\[${escapeRegex(sectionName)}\\]([\\s\\S]*?)(?:\\n\\s*\\[|$)`);
  const match = content.match(pattern);
  return match ? match[1] : null;
}

function extractTomlValue(sectionContent, key) {
  if (!sectionContent) return null;
  const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*["']([^"']+)["']`, 'm');
  const match = sectionContent.match(pattern);
  return match ? match[1].trim() : null;
}

function detectProjectMetadata(ctx) {
  const pkg = ctx.jsonFile('package.json');
  if (pkg && (pkg.name || pkg.description)) {
    return {
      name: pkg.name || path.basename(ctx.dir),
      description: pkg.description || '',
    };
  }

  const pyproject = ctx.fileContent('pyproject.toml') || '';
  if (pyproject) {
    const projectSection = extractTomlSection(pyproject, 'project');
    const poetrySection = extractTomlSection(pyproject, 'tool.poetry');
    const name = extractTomlValue(projectSection, 'name') ||
      extractTomlValue(poetrySection, 'name');
    const description = extractTomlValue(projectSection, 'description') ||
      extractTomlValue(poetrySection, 'description');

    if (name || description) {
      return {
        name: name || path.basename(ctx.dir),
        description: description || '',
      };
    }
  }

  return {
    name: path.basename(ctx.dir),
    description: '',
  };
}

function detectMainDirs(ctx) {
  const candidates = [
    'src', 'lib', 'app', 'pages', 'components', 'api', 'routes', 'utils', 'helpers',
    'services', 'models', 'controllers', 'views', 'public', 'assets', 'config', 'tests',
    'test', '__tests__', 'spec', 'scripts', 'prisma', 'db', 'middleware', 'hooks',
    'agents', 'chains', 'workers', 'jobs', 'dags', 'macros', 'migrations',
    'src/components', 'src/app', 'src/pages', 'src/api', 'src/lib', 'src/hooks',
    'src/utils', 'src/services', 'src/models', 'src/middleware', 'src/agents',
    'src/chains', 'src/workers', 'src/jobs', 'src/app/api', 'app/api',
    'models/staging', 'models/marts'
  ];

  const dirs = [];
  for (const dir of candidates) {
    if (ctx.hasDir(dir)) {
      dirs.push(dir);
    }
  }
  return dirs;
}

function collectClaudeAssets(ctx) {
  const sharedSettings = ctx.jsonFile('.claude/settings.json');
  const localSettings = ctx.jsonFile('.claude/settings.local.json');
  const settings = sharedSettings || localSettings || null;
  const denyRules = collectClaudeDenyRules(ctx);

  const assetFiles = {
    claudeMd: ctx.fileContent('CLAUDE.md') ? 'CLAUDE.md' : (ctx.fileContent('.claude/CLAUDE.md') ? '.claude/CLAUDE.md' : null),
    settings: sharedSettings ? '.claude/settings.json' : (localSettings ? '.claude/settings.local.json' : null),
    commands: ctx.hasDir('.claude/commands') ? ctx.dirFiles('.claude/commands') : [],
    rules: ctx.hasDir('.claude/rules') ? ctx.dirFiles('.claude/rules') : [],
    hooks: ctx.hasDir('.claude/hooks') ? ctx.dirFiles('.claude/hooks') : [],
    agents: ctx.hasDir('.claude/agents') ? ctx.dirFiles('.claude/agents') : [],
    skills: ctx.hasDir('.claude/skills') ? ctx.dirFiles('.claude/skills') : [],
  };

  return {
    label: 'Claude',
    instructionLabel: 'CLAUDE.md',
    configLabel: 'Settings',
    instructionPath: assetFiles.claudeMd,
    configPath: assetFiles.settings,
    files: assetFiles,
    counts: {
      commands: assetFiles.commands.length,
      rules: assetFiles.rules.length,
      hooks: assetFiles.hooks.length,
      agents: assetFiles.agents.length,
      skills: assetFiles.skills.length,
      mcpServers: settings && settings.mcpServers ? Object.keys(settings.mcpServers).length : 0,
    },
    permissions: settings && settings.permissions ? {
      defaultMode: settings.permissions.defaultMode || null,
      hasDenyRules: denyRules.length > 0,
    } : null,
    settingsSource: assetFiles.settings,
    summaryLine: `Commands: ${assetFiles.commands.length} | Rules: ${assetFiles.rules.length} | Hooks: ${assetFiles.hooks.length} | Agents: ${assetFiles.agents.length} | Skills: ${assetFiles.skills.length} | MCP servers: ${settings && settings.mcpServers ? Object.keys(settings.mcpServers).length : 0}`,
  };
}

function collectCodexAssets(ctx) {
  const agentsMd = ctx.agentsMdPath ? ctx.agentsMdPath() : null;
  const configPath = ctx.fileContent('.codex/config.toml') ? '.codex/config.toml' : null;
  const hooksJson = ctx.hooksJsonContent ? ctx.hooksJsonContent() : null;
  const rules = ctx.ruleFiles ? ctx.ruleFiles() : [];
  const skills = ctx.skillDirs ? ctx.skillDirs().map((name) => `.agents/skills/${name}`) : [];
  const agents = ctx.customAgentFiles ? ctx.customAgentFiles().map((file) => `.codex/agents/${file}`) : [];
  const workflows = ctx.workflowFiles ? ctx.workflowFiles() : [];
  const mcpServers = ctx.mcpServers ? Object.keys(ctx.mcpServers() || {}).length : 0;

  return {
    label: 'Codex',
    instructionLabel: 'AGENTS.md',
    configLabel: 'Config',
    instructionPath: agentsMd,
    configPath,
    files: {
      agentsMd,
      config: configPath,
      rules,
      hooks: hooksJson ? ['.codex/hooks.json'] : [],
      skills,
      agents,
      workflows,
    },
    counts: {
      rules: rules.length,
      hooks: hooksJson ? 1 : 0,
      skills: skills.length,
      agents: agents.length,
      workflows: workflows.length,
      mcpServers,
    },
    trust: {
      approvalPolicy: ctx.configValue ? (ctx.configValue('approval_policy') || null) : null,
      sandboxMode: ctx.configValue ? (ctx.configValue('sandbox_mode') || null) : null,
      isTrustedProject: ctx.isProjectTrusted ? ctx.isProjectTrusted() : false,
    },
    summaryLine: `Rules: ${rules.length} | Hooks: ${hooksJson ? 1 : 0} | Skills: ${skills.length} | Subagents: ${agents.length} | Workflows: ${workflows.length} | MCP servers: ${mcpServers}`,
  };
}

function detectMaturity(platform, assets) {
  if (platform === 'codex') {
    let score = 0;
    if (assets.instructionPath) score += 2;
    if (assets.configPath) score += 2;
    if (assets.counts.rules > 0) score += 1;
    if (assets.counts.hooks > 0) score += 1;
    if (assets.counts.skills > 0) score += 1;
    if (assets.counts.agents > 0) score += 1;
    if (assets.counts.workflows > 0) score += 1;
    if (assets.counts.mcpServers > 0) score += 1;

    if (score === 0) return 'none';
    if (score <= 2) return 'starter';
    if (score <= 5) return 'developing';
    return 'mature';
  }

  let score = 0;
  if (assets.files.claudeMd) score += 2;
  if (assets.files.settings) score += 1;
  if (assets.counts.rules > 0) score += 1;
  if (assets.counts.commands > 0) score += 1;
  if (assets.counts.hooks > 0) score += 1;
  if (assets.counts.agents > 0) score += 1;
  if (assets.counts.skills > 0) score += 1;

  if (score === 0) return 'none';
  if (score <= 2) return 'starter';
  if (score <= 5) return 'developing';
  return 'mature';
}

function riskFromImpact(impact) {
  if (impact === 'critical') return 'high';
  if (impact === 'high') return 'medium';
  return 'low';
}

function moduleFromCategory(category) {
  const map = {
    memory: 'CLAUDE.md',
    instructions: 'AGENTS.md / instructions',
    config: 'config.toml',
    trust: 'trust-and-safety',
    rules: 'rules',
    hooks: 'hooks',
    mcp: 'mcp',
    skills: 'skills',
    agents: 'subagents',
    review: 'review',
    automation: 'automation',
    local: 'local-environments',
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
  };
  return map[category] || category;
}

const STRENGTH_REASONS = {
  claudeMd: 'Foundation of Claude workflow. Every session benefits from this.',
  mermaidArchitecture: 'Architecture diagram saves 73% tokens vs prose — high-value asset.',
  verificationLoop: 'Claude can self-verify, catching errors before human review.',
  hooks: 'Automated enforcement (100% vs 80% from instructions alone).',
  hooksInSettings: 'Hook registration in settings ensures consistent automation.',
  preToolUseHook: 'Pre-execution validation adds a safety layer.',
  postToolUseHook: 'Post-execution automation catches issues immediately.',
  sessionStartHook: 'Session initialization ensures consistent starting state.',
  customCommands: 'Reusable workflows encoded as one-liner commands.',
  settingsPermissions: 'Explicit permissions prevent accidental dangerous operations.',
  permissionDeny: 'Deny rules block risky operations at the system level.',
  pathRules: 'Scoped rules ensure different code areas get appropriate guidance.',
  fewShotExamples: 'Code examples guide Claude to match your conventions.',
  constraintBlocks: 'XML constraint blocks improve rule adherence by 40%.',
  xmlTags: 'Structured prompt sections improve consistency.',
  context7Mcp: 'Real-time docs eliminate version-mismatch hallucinations.',
  mcpServers: 'External tool integration extends Claude capabilities.',
  compactionAwareness: 'Context management keeps sessions efficient.',
  agents: 'Specialized agents delegate complex tasks effectively.',
  noSecretsInClaude: 'No secrets in config — good security hygiene.',
  gitIgnoreEnv: 'Environment files are properly excluded from git.',
  codexAgentsMd: 'Codex has a repo-native instruction surface instead of starting cold.',
  codexAgentsMdSubstantive: 'A substantive AGENTS.md reduces drift and gives Codex a stable repo contract.',
  codexAgentsVerificationCommands: 'Codex can verify its changes because the repo states how to test and build.',
  codexAgentsArchitecture: 'Codex has a repo map to orient itself before editing.',
  codexConfigExists: 'Codex runtime posture is reviewable because the project config is versioned.',
  codexModelExplicit: 'The primary Codex model is explicit instead of silently inheriting defaults.',
  codexReasoningEffortExplicit: 'Reasoning depth is explicit and reviewable.',
  codexWeakTaskModelExplicit: 'Delegation for weaker tasks is explicit and cost-aware.',
  codexApprovalPolicyExplicit: 'Approval behavior is explicit, predictable, and reviewable.',
  codexSandboxExplicit: 'Sandbox posture is explicit instead of accidental.',
  codexHistorySendToServerExplicit: 'History sync posture is reviewable in version control.',
  codexRulesForRiskyCommands: 'Risky command classes are governed by Codex-native rules.',
  codexHooksFeatureExplicit: 'Hook posture is explicit instead of implied.',
  codexMcpExternalToolsConfigured: 'Codex has live MCP context instead of relying only on static repo files.',
  codexSkillsDirPresentWhenUsed: 'Repo-local skills keep specialization versioned and reviewable.',
  codexSkillsHaveMetadata: 'Skill metadata is explicit enough for reliable invocation.',
  codexCustomAgentsRequiredFields: 'Custom subagents are structured and reviewable.',
  codexExecUsageSafe: 'Codex automation posture is documented and safer to operate.',
  codexGitHubActionSafeStrategy: 'CI posture is explicit and safer for Codex in automation.',
  codexReviewWorkflowDocumented: 'A documented review path makes risky Codex changes easier to control.',
  codexArtifactsSharedIntentionally: 'Codex repo artifacts are shared intentionally instead of being hidden from the team.',
  codexAgentsMentionModernFeatures: 'AGENTS.md acknowledges the modern Codex surfaces the repo actually uses.',
};

function toStrengths(results) {
  return results
    .filter(r => r.passed === true && (r.impact === 'critical' || r.impact === 'high' || r.impact === 'medium'))
    .sort((a, b) => {
      const order = { critical: 3, high: 2, medium: 1, low: 0 };
      return (order[b.impact] || 0) - (order[a.impact] || 0);
    })
    .slice(0, 10)
    .map(r => ({
      key: r.key,
      name: r.name,
      impact: r.impact,
      category: r.category,
      why: STRENGTH_REASONS[r.key] || `Already configured and working: ${r.name}.`,
    }));
}

const GAP_REASONS = {
  noBypassPermissions: 'bypassPermissions skips all safety checks. Use explicit allow rules for control without risk.',
  secretsProtection: 'Without deny rules for .env, Claude can read secrets and potentially expose them in outputs.',
  testCommand: 'Without a test command, Claude cannot verify its changes work before you review them.',
  lintCommand: 'Without a lint command, Claude may produce inconsistently formatted code.',
  buildCommand: 'Without a build command, Claude cannot catch compilation errors early.',
  ciPipeline: 'CI ensures every change is automatically tested. Without it, bugs reach main branch faster.',
  securityReview: 'Claude Code has built-in OWASP Top 10 scanning. Not using it leaves vulnerabilities undetected.',
  skills: 'Skills encode domain expertise as reusable components. Without them, you repeat context every session.',
  multipleAgents: 'Multiple agents enable parallel specialized work (security review + code writing simultaneously).',
  multipleMcpServers: 'More MCP servers give Claude access to more external context (docs, databases, APIs).',
  roleDefinition: 'A role definition helps Claude calibrate response depth and technical level.',
  importSyntax: '@import keeps CLAUDE.md lean while still providing deep instructions in focused modules.',
};

function toGaps(results) {
  return results
    .filter(r => r.passed === false)
    .sort((a, b) => {
      const order = { critical: 3, high: 2, medium: 1, low: 0 };
      return (order[b.impact] || 0) - (order[a.impact] || 0);
    })
    .slice(0, 8)
    .map(r => ({
      key: r.key,
      name: r.name,
      impact: r.impact,
      category: r.category,
      fix: r.fix,
      why: GAP_REASONS[r.key] || r.fix,
    }));
}

function toRecommendations(auditResult) {
  const failed = auditResult.results.filter(r => r.passed === false);
  const topActionOrder = new Map((auditResult.topNextActions || []).map((item, index) => [item.key, index]));
  failed.sort((a, b) => {
    const rankedA = topActionOrder.has(a.key) ? topActionOrder.get(a.key) : Number.MAX_SAFE_INTEGER;
    const rankedB = topActionOrder.has(b.key) ? topActionOrder.get(b.key) : Number.MAX_SAFE_INTEGER;
    if (rankedA !== rankedB) return rankedA - rankedB;
    const order = { critical: 3, high: 2, medium: 1, low: 0 };
    return (order[b.impact] || 0) - (order[a.impact] || 0);
  });

  return failed.slice(0, 10).map((r, index) => ({
    priority: index + 1,
    key: r.key,
    name: r.name,
    impact: r.impact,
    module: moduleFromCategory(r.category),
    risk: riskFromImpact(r.impact),
    why: r.fix,
    evidenceClass: (auditResult.topNextActions || []).find(item => item.key === r.key)?.evidenceClass || 'estimated',
    rankingAdjustment: (auditResult.topNextActions || []).find(item => item.key === r.key)?.rankingAdjustment || 0,
  }));
}

function buildOptionalModules(platform, stacks, assets, recommendedDomainPacks = []) {
  if (platform === 'codex') {
    const modules = [];

    if (!assets.instructionPath) modules.push('AGENTS.md baseline');
    if (!assets.configPath) modules.push('Codex config baseline');
    if (assets.counts.rules === 0) modules.push('Codex rules baseline');
    if (assets.counts.hooks === 0) modules.push('Hooks scaffold');
    if (assets.counts.skills === 0) modules.push('Repo-local skills starter');
    if (assets.counts.agents === 0) modules.push('Subagents starter');
    if (assets.counts.mcpServers === 0) modules.push('MCP baseline');
    if (assets.counts.workflows === 0) modules.push('CI / review workflow starter');
    for (const pack of recommendedDomainPacks) {
      for (const moduleName of pack.recommendedModules || []) {
        modules.push(moduleName);
      }
    }

    return [...new Set(modules)].slice(0, 8);
  }

  const stackKeys = stacks.map(s => s.key);
  const modules = [];

  if (!assets.files.claudeMd) modules.push('CLAUDE.md baseline');
  if (assets.counts.commands === 0) modules.push('Slash commands');
  if (assets.counts.hooks === 0) modules.push('Hooks automation');
  if (!assets.permissions || !assets.permissions.hasDenyRules) modules.push('Permission safety profile');
  if (assets.counts.rules === 0) modules.push('Path-specific rules');
  if (stackKeys.some(k => ['react', 'nextjs', 'vue', 'angular', 'svelte'].includes(k))) modules.push('Frontend pack');
  if (stackKeys.some(k => ['node', 'python', 'django', 'fastapi', 'go', 'rust', 'java'].includes(k))) modules.push('Backend pack');
  if (stackKeys.some(k => ['docker', 'terraform', 'kubernetes'].includes(k))) modules.push('DevOps pack');
  if (assets.counts.agents === 0) modules.push('Specialized agents');

  return [...new Set(modules)].slice(0, 8);
}

function buildRiskNotes(platform, auditResult, assets, maturity) {
  if (platform === 'codex') {
    const notes = [];
    if (!assets.instructionPath) notes.push('No AGENTS.md exists yet, so Codex starts without repo-specific instructions.');
    if (!assets.configPath) notes.push('No .codex/config.toml exists yet, so approval, sandbox, and history posture are implicit.');
    if (assets.trust && assets.trust.approvalPolicy === 'never') {
      notes.push('approval_policy is set to `never`; make sure that autonomy level is truly intended for this repo.');
    }
    if (assets.trust && assets.trust.sandboxMode === 'danger-full-access') {
      notes.push('sandbox_mode is `danger-full-access`, which removes Codex runtime guardrails and should stay exceptional.');
    }
    if (assets.counts.mcpServers > 0 && assets.trust && !assets.trust.isTrustedProject) {
      notes.push('This repo appears to rely on project-scoped MCP, but the project trust path is not clearly established.');
    }
    if (maturity === 'mature') {
      notes.push('This repo already has meaningful Codex assets, so advisory mode should preserve and extend them instead of flattening them.');
    }
    for (const caveat of auditResult.platformCaveats || []) {
      if (caveat && caveat.message) {
        notes.push(caveat.message);
      }
    }
    return [...new Set(notes)].slice(0, 5);
  }

  const notes = [];
  if (!assets.files.claudeMd) notes.push('No CLAUDE.md exists yet, so Claude has no persistent project-specific guidance.');
  if (assets.permissions && assets.permissions.defaultMode === 'bypassPermissions') {
    notes.push('Current settings use bypassPermissions, which is risky for broader team adoption.');
  }
  if (!assets.permissions || !assets.permissions.hasDenyRules) {
    notes.push('Permissions lack deny rules, so secret access and destructive commands are not strongly guarded.');
  }
  if (maturity === 'mature') {
    notes.push('This repo already has meaningful Claude assets, so augment mode should preserve existing structure instead of overwriting it.');
  }
  if (auditResult.results.some(r => r.key === 'ciPipeline' && r.passed === false)) {
    notes.push('Without CI enforcement, readiness can drift after setup.');
  }
  return notes.slice(0, 5);
}

function buildRolloutOrder(report) {
  if (report.platform === 'codex') {
    const steps = [];
    if (!report.existingPlatformAssets.instructionPath) steps.push('Create a project-specific AGENTS.md baseline');
    if (!report.existingPlatformAssets.configPath) steps.push('Create a safe `.codex/config.toml` baseline with explicit trust settings');
    if (report.recommendedDomainPacks.length > 0) {
      steps.push(`Start from the ${report.recommendedDomainPacks.map((pack) => pack.label).join(' + ')} pack guidance before adding optional Codex surfaces`);
    }
    if (report.gapsIdentified.some(g => g.category === 'trust' || g.category === 'config')) steps.push('Make approval, sandbox, history, and network posture explicit');
    if (report.gapsIdentified.some(g => g.category === 'rules')) steps.push('Add Codex rules for risky command classes before expanding automation');
    if (report.gapsIdentified.some(g => g.category === 'mcp')) steps.push('Add MCP only where the repo really needs live external context and the trust boundary is clear');
    if (report.gapsIdentified.some(g => g.category === 'skills' || g.category === 'agents')) steps.push('Add skills and subagents only after the baseline contract is stable');
    if (report.gapsIdentified.some(g => g.category === 'review' || g.category === 'automation')) steps.push('Add review and CI automation after local verification is explicit');
    return steps.length > 0 ? steps : ['Preserve the current Codex baseline and tighten remaining quality-deep items'];
  }

  const steps = [];
  if (!report.existingClaudeAssets.claudeMd) steps.push('Create a project-specific CLAUDE.md baseline');
  if (report.gapsIdentified.some(g => g.category === 'security')) steps.push('Add safe settings and deny rules');
  if (report.gapsIdentified.some(g => g.category === 'automation')) steps.push('Add hooks and automate verification');
  if (report.gapsIdentified.some(g => g.category === 'workflow')) steps.push('Add commands, rules, and specialization modules');
  if (report.gapsIdentified.some(g => g.category === 'devops')) steps.push('Connect CI threshold enforcement');
  if (steps.length === 0) steps.push('Tighten quality-deep items and preserve the current setup');
  return steps;
}

/**
 * Analyze a project's Claude Code setup and produce a structured recommendation report.
 * @param {Object} options - Analysis options.
 * @param {string} options.dir - Project directory to analyze.
 * @param {string} [options.mode='augment'] - Analysis mode ('augment' or 'suggest-only').
 * @returns {Promise<Object>} Structured report with project summary, gaps, strengths, and recommendations.
 */
async function analyzeProject(options) {
  const mode = options.mode || 'augment';
  const platform = options.platform === 'codex' ? 'codex' : 'claude';
  const platformLabel = platform === 'codex' ? 'Codex' : 'Claude';
  const ContextClass = platform === 'codex' ? CodexProjectContext : ProjectContext;
  const ctx = new ContextClass(options.dir);
  const stacks = ctx.detectStacks(STACKS);
  const auditResult = await audit({ ...options, silent: true, platform });
  const assets = platform === 'codex' ? collectCodexAssets(ctx) : collectClaudeAssets(ctx);
  const metadata = detectProjectMetadata(ctx);
  const maturity = detectMaturity(platform, assets);
  const mainDirs = detectMainDirs(ctx);
  const recommendedDomainPacks = platform === 'codex'
    ? detectCodexDomainPacks(ctx, stacks, assets)
    : detectDomainPacks(ctx, stacks, assets);
  const recommendedMcpPacks = platform === 'claude' ? recommendMcpPacks(stacks, recommendedDomainPacks, { ctx, assets }) : [];
  const repoArchetype = buildRepoArchetypeProfile({
    ctx,
    platform,
    stacks,
    assets,
    recommendedDomainPacks,
    recommendedMcpPacks,
    maturity,
  });
  const recommendedOperatingProfile = buildOperatingProfile({
    dir: options.dir,
    platform,
    repoArchetype,
    recommendedDomainPacks,
    recommendedMcpPacks,
  });

  const report = {
    platform,
    platformLabel,
    mode,
    writeBehavior: 'No files are written in this mode.',
    projectSummary: {
      name: metadata.name,
      description: metadata.description,
      directory: options.dir,
      stacks: stacks.map(s => s.label),
      domains: recommendedDomainPacks.map(pack => pack.label),
      maturity,
      archetype: repoArchetype.label,
      workflow: repoArchetype.primaryWorkflow.label,
      riskLevel: repoArchetype.riskProfile.label,
      operatingProfile: recommendedOperatingProfile.label,
      score: auditResult.score,
      organicScore: auditResult.organicScore,
      checkCount: auditResult.checkCount,
    },
    platformScopeNote: auditResult.platformScopeNote || null,
    platformCaveats: auditResult.platformCaveats || [],
    repoArchetype,
    recommendedOperatingProfile,
    detectedArchitecture: {
      repoType: stacks.length > 0 ? 'stack-detected repo' : 'generic repo',
      mainDirectories: mainDirs,
      stackSignals: stacks.map(s => s.key),
      stackFamily: repoArchetype.stackFamily.label,
      topology: repoArchetype.topology.label,
      workflow: repoArchetype.primaryWorkflow.label,
      riskLevel: repoArchetype.riskProfile.label,
    },
    existingPlatformAssets: assets,
    strengthsPreserved: toStrengths(auditResult.results),
    gapsIdentified: toGaps(auditResult.results),
    topNextActions: auditResult.topNextActions || auditResult.quickWins,
    recommendedImprovements: toRecommendations(auditResult),
    recommendedDomainPacks,
    recommendedMcpPacks,
    riskNotes: buildRiskNotes(platform, auditResult, assets, maturity),
    optionalModules: buildOptionalModules(platform, stacks, assets, recommendedDomainPacks),
  };

  if (platform === 'claude') {
    report.existingClaudeAssets = {
      claudeMd: assets.files.claudeMd,
      settings: assets.settingsSource,
      commands: assets.files.commands,
      rules: assets.files.rules,
      hooks: assets.files.hooks,
      agents: assets.files.agents,
      skills: assets.files.skills,
      mcpServers: assets.counts.mcpServers,
    };
  } else {
    report.existingCodexAssets = {
      agentsMd: assets.instructionPath,
      config: assets.configPath,
      rules: assets.files.rules,
      hooks: assets.files.hooks,
      skills: assets.files.skills,
      agents: assets.files.agents,
      workflows: assets.files.workflows,
      mcpServers: assets.counts.mcpServers,
    };
  }

  report.suggestedRolloutOrder = buildRolloutOrder(report);
  return report;
}

function printAnalysis(report, options = {}) {
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const modeLabel = report.mode === 'suggest-only' ? 'suggest-only' : report.mode;
  console.log('');
  console.log(c(`  nerviq ${report.platform === 'codex' ? 'codex ' : ''}${modeLabel}`, 'bold'));
  console.log(c('  ═══════════════════════════════════════', 'dim'));
  console.log(c(`  ${report.writeBehavior}`, 'dim'));
  if (report.platformScopeNote) {
    console.log(c(`  ${report.platformScopeNote.message}`, 'dim'));
  }
  console.log('');

  console.log(c('  Project Summary', 'blue'));
  console.log(`  ${report.projectSummary.name}${report.projectSummary.description ? ` — ${report.projectSummary.description}` : ''}`);
  console.log(c(`  Stack: ${report.projectSummary.stacks.join(', ') || 'Unknown'}`, 'dim'));
  if (report.platform === 'claude') {
    console.log(c(`  Domain packs: ${report.projectSummary.domains.join(', ') || 'Baseline General'}`, 'dim'));
  } else {
    console.log(c(`  Platform: ${report.platformLabel}`, 'dim'));
  }
  console.log(c(`  Archetype: ${report.repoArchetype.label} | Workflow: ${report.repoArchetype.primaryWorkflow.label} | Risk: ${report.repoArchetype.riskProfile.label}`, 'dim'));
  console.log(c(`  Maturity: ${report.projectSummary.maturity} | Score: ${report.projectSummary.score}/100 | Organic: ${report.projectSummary.organicScore}/100`, 'dim'));
  console.log('');

  console.log(c('  Detected Architecture', 'blue'));
  console.log(c(`  Stack family: ${report.repoArchetype.stackFamily.label} | Topology: ${report.repoArchetype.topology.label} | Confidence: ${report.repoArchetype.confidence}`, 'dim'));
  console.log(c(`  Main directories: ${report.detectedArchitecture.mainDirectories.join(', ') || 'No strong structure detected yet'}`, 'dim'));
  console.log(c(`  Signals: ${report.repoArchetype.signals.join(' | ') || 'No strong archetype signals yet'}`, 'dim'));
  console.log('');

  console.log(c(`  Existing ${report.existingPlatformAssets.label} Assets`, 'blue'));
  console.log(c(`  ${report.existingPlatformAssets.instructionLabel}: ${report.existingPlatformAssets.instructionPath || 'missing'}`, 'dim'));
  console.log(c(`  ${report.existingPlatformAssets.configLabel}: ${report.existingPlatformAssets.configPath || 'missing'}`, 'dim'));
  console.log(c(`  ${report.existingPlatformAssets.summaryLine}`, 'dim'));
  if (report.platform === 'codex' && report.existingPlatformAssets.trust) {
    const trustBits = [
      `Approval: ${report.existingPlatformAssets.trust.approvalPolicy || 'implicit'}`,
      `Sandbox: ${report.existingPlatformAssets.trust.sandboxMode || 'implicit'}`,
      `Trusted path: ${report.existingPlatformAssets.trust.isTrustedProject ? 'yes' : 'no'}`,
    ];
    console.log(c(`  ${trustBits.join(' | ')}`, 'dim'));
  }
  console.log('');

  if (report.strengthsPreserved.length > 0) {
    console.log(c(`  ${'\u2705'} Strengths Preserved (don't change these)`, 'green'));
    for (const item of report.strengthsPreserved) {
      const impactLabel = item.impact ? ` (${item.impact})` : '';
      console.log(`     ${c('\u2022', 'green')} ${item.name}${c(impactLabel, 'dim')}`);
    }
    console.log('');
  }

  if (report.gapsIdentified.length > 0) {
    console.log(c('  Gaps Identified', 'yellow'));
    for (const item of report.gapsIdentified.slice(0, 5)) {
      console.log(`  - [${item.impact}] ${item.name}`);
      console.log(c(`    ${item.fix}`, 'dim'));
    }
    console.log('');
  }

  if (report.topNextActions.length > 0) {
    console.log(c('  Top 5 Next Actions', 'magenta'));
    report.topNextActions.slice(0, 5).forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.name}`);
      console.log(c(`     Why: ${item.why || item.fix}`, 'dim'));
      if (Array.isArray(item.signals) && item.signals.length > 0) {
        console.log(c(`     Trace: ${item.signals.join(' | ')}`, 'dim'));
      }
      if (item.risk || item.confidence) {
        console.log(c(`     Risk: ${item.risk || 'low'} | Confidence: ${item.confidence || 'medium'}`, 'dim'));
      }
      if (item.fix && item.fix !== item.why) {
        console.log(c(`     Fix: ${item.fix}`, 'dim'));
      }
    });
    console.log('');
  }

  if (report.recommendedDomainPacks.length > 0) {
    console.log(c('  Recommended Domain Packs', 'blue'));
    for (const pack of report.recommendedDomainPacks) {
      console.log(`  - ${pack.label}`);
      console.log(c(`    ${pack.useWhen}`, 'dim'));
    }
    console.log('');
  }

  if (report.recommendedMcpPacks.length > 0) {
    console.log(c('  Recommended MCP Packs', 'blue'));
    for (const pack of report.recommendedMcpPacks) {
      console.log(`  - ${pack.label}`);
      console.log(c(`    ${pack.adoption}`, 'dim'));
    }
    console.log('');
  }

  if (report.platformCaveats && report.platformCaveats.length > 0) {
    console.log(c('  Platform Caveats', 'yellow'));
    for (const item of report.platformCaveats) {
      console.log(`  - ${item.title}`);
      console.log(c(`    ${item.message}`, 'dim'));
    }
    console.log('');
  }

  if (report.riskNotes.length > 0) {
    console.log(c('  Risk Notes', 'red'));
    for (const note of report.riskNotes) {
      console.log(`  - ${note}`);
    }
    console.log('');
  }

  if (report.optionalModules.length > 0) {
    console.log(c('  Optional Modules', 'blue'));
    console.log(c(`  ${report.optionalModules.join(' | ')}`, 'dim'));
    console.log('');
  }

  if (report.recommendedOperatingProfile) {
    console.log(c('  Recommended Operating Profile', 'blue'));
    console.log(`  ${report.recommendedOperatingProfile.label}`);
    console.log(c(`  Permission: ${report.recommendedOperatingProfile.permissionProfile.label} | Governance pack: ${report.recommendedOperatingProfile.governancePack.label}`, 'dim'));
    console.log(c(`  CI shape: ${report.recommendedOperatingProfile.ciShape.label} | Platforms: ${(report.recommendedOperatingProfile.platformSupport.recommended || []).join(', ') || report.platformLabel}`, 'dim'));
    console.log(c(`  Hooks: ${report.recommendedOperatingProfile.hooks.map((hook) => hook.key).join(', ')}`, 'dim'));
    console.log(c(`  Verification: ${report.recommendedOperatingProfile.verification.required.join(', ')}`, 'dim'));
    console.log('');
  }

  if (report.suggestedRolloutOrder.length > 0) {
    console.log(c('  Suggested Rollout Order', 'blue'));
    report.suggestedRolloutOrder.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item}`);
    });
    console.log('');
  }
}

/**
 * Export an analysis report as a formatted markdown string.
 * @param {Object} report - The report object returned by analyzeProject().
 * @returns {string} Markdown-formatted report content.
 */
function exportMarkdown(report) {
  const lines = [];
  lines.push(`# Nerviq Analysis Report`);
  lines.push(`## ${report.platformLabel} ${report.mode === 'suggest-only' ? 'Suggest-Only' : 'Augment'} Mode`);
  lines.push('');
  lines.push(`**Project:** ${report.projectSummary.name}${report.projectSummary.description ? ` — ${report.projectSummary.description}` : ''}`);
  lines.push(`**Date:** ${new Date().toISOString().split('T')[0]}`);
  lines.push(`**Platform:** ${report.platformLabel}`);
  lines.push(`**Score:** ${report.projectSummary.score}/100 | **Organic:** ${report.projectSummary.organicScore}/100`);
  lines.push(`**Stacks:** ${report.projectSummary.stacks.join(', ') || 'None detected'}`);
  if (report.platform === 'claude') {
    lines.push(`**Domain Packs:** ${report.projectSummary.domains.join(', ') || 'Baseline General'}`);
  }
  lines.push(`**Archetype:** ${report.repoArchetype.label}`);
  lines.push(`**Workflow:** ${report.repoArchetype.primaryWorkflow.label}`);
  lines.push(`**Risk posture:** ${report.repoArchetype.riskProfile.label}`);
  lines.push(`**Operating profile:** ${report.recommendedOperatingProfile.label}`);
  lines.push(`**Maturity:** ${report.projectSummary.maturity}`);
  lines.push('');

  if (report.platformScopeNote) {
    lines.push(`> ${report.platformScopeNote.message}`);
    lines.push('');
  }

  lines.push(`## Existing ${report.existingPlatformAssets.label} Assets`);
  lines.push('');
  lines.push(`- **${report.existingPlatformAssets.instructionLabel}:** ${report.existingPlatformAssets.instructionPath || 'missing'}`);
  lines.push(`- **${report.existingPlatformAssets.configLabel}:** ${report.existingPlatformAssets.configPath || 'missing'}`);
  lines.push(`- **Summary:** ${report.existingPlatformAssets.summaryLine}`);
  if (report.platform === 'codex' && report.existingPlatformAssets.trust) {
    lines.push(`- **Approval policy:** ${report.existingPlatformAssets.trust.approvalPolicy || 'implicit'}`);
    lines.push(`- **Sandbox mode:** ${report.existingPlatformAssets.trust.sandboxMode || 'implicit'}`);
    lines.push(`- **Trusted project path:** ${report.existingPlatformAssets.trust.isTrustedProject ? 'yes' : 'no'}`);
  }
  lines.push('');

  lines.push('## Repo Archetype');
  lines.push('');
  lines.push(`- **Label:** ${report.repoArchetype.label}`);
  lines.push(`- **Summary:** ${report.repoArchetype.summary}`);
  lines.push(`- **Stack family:** ${report.repoArchetype.stackFamily.label}`);
  lines.push(`- **Topology:** ${report.repoArchetype.topology.label}`);
  lines.push(`- **Primary workflow:** ${report.repoArchetype.primaryWorkflow.label}`);
  lines.push(`- **Risk posture:** ${report.repoArchetype.riskProfile.label}`);
  lines.push(`- **Confidence:** ${report.repoArchetype.confidence}`);
  if (report.repoArchetype.signals.length > 0) {
    lines.push(`- **Signals:** ${report.repoArchetype.signals.join(', ')}`);
  }
  lines.push('');

  lines.push('## Recommended Operating Profile');
  lines.push('');
  lines.push(`- **Label:** ${report.recommendedOperatingProfile.label}`);
  lines.push(`- **Summary:** ${report.recommendedOperatingProfile.summary}`);
  lines.push(`- **Permission profile:** ${report.recommendedOperatingProfile.permissionProfile.label}`);
  lines.push(`- **Governance pack:** ${report.recommendedOperatingProfile.governancePack.label}`);
  lines.push(`- **Platform support:** ${(report.recommendedOperatingProfile.platformSupport.recommended || []).join(', ') || report.platformLabel}`);
  if (report.recommendedOperatingProfile.platformSupport.optionalExpansion) {
    lines.push(`- **Optional expansion:** ${report.recommendedOperatingProfile.platformSupport.optionalExpansion}`);
  }
  lines.push(`- **CI shape:** ${report.recommendedOperatingProfile.ciShape.label}`);
  lines.push(`- **Verification:** ${report.recommendedOperatingProfile.verification.required.join(', ')}`);
  lines.push(`- **Hooks:** ${report.recommendedOperatingProfile.hooks.map((hook) => hook.key).join(', ')}`);
  lines.push('');

  if (report.strengthsPreserved.length > 0) {
    lines.push('## Strengths Preserved (don\'t change these)');
    lines.push('');
    for (const item of report.strengthsPreserved) {
      const impactLabel = item.impact ? ` (${item.impact})` : '';
      lines.push(`- **${item.name}**${impactLabel} — ${item.why || 'Already configured.'}`);
    }
    lines.push('');
  }

  if (report.gapsIdentified.length > 0) {
    lines.push('## Gaps Identified');
    lines.push('');
    lines.push('| Gap | Impact | Fix |');
    lines.push('|-----|--------|-----|');
    for (const item of report.gapsIdentified) {
      lines.push(`| ${item.name} | ${item.impact} | ${item.fix} |`);
    }
    lines.push('');
  }

  if (report.topNextActions.length > 0) {
    lines.push('## Top Next Actions');
    lines.push('');
    report.topNextActions.slice(0, 5).forEach((item, index) => {
      lines.push(`${index + 1}. **${item.name}**`);
      lines.push(`   - Why: ${item.why || item.fix}`);
      if (Array.isArray(item.signals) && item.signals.length > 0) {
        lines.push(`   - Trace: ${item.signals.join(' | ')}`);
      }
      if (item.risk || item.confidence) {
        lines.push(`   - Risk / Confidence: ${item.risk || 'low'} / ${item.confidence || 'medium'}`);
      }
      if (item.fix && item.fix !== item.why) {
        lines.push(`   - Fix: ${item.fix}`);
      }
    });
    lines.push('');
  }

  if (report.recommendedDomainPacks.length > 0) {
    lines.push('## Recommended Domain Packs');
    lines.push('');
    for (const pack of report.recommendedDomainPacks) {
      lines.push(`- **${pack.label}**: ${pack.useWhen}`);
    }
    lines.push('');
  }

  if (report.recommendedMcpPacks.length > 0) {
    lines.push('## Recommended MCP Packs');
    lines.push('');
    for (const pack of report.recommendedMcpPacks) {
      lines.push(`- **${pack.label}**: ${pack.useWhen}`);
    }
    lines.push('');
  }

  if (report.platformCaveats && report.platformCaveats.length > 0) {
    lines.push('## Platform Caveats');
    lines.push('');
    for (const item of report.platformCaveats) {
      lines.push(`- **${item.title}**: ${item.message}`);
    }
    lines.push('');
  }

  if (report.riskNotes.length > 0) {
    lines.push('## Risk Notes');
    lines.push('');
    for (const note of report.riskNotes) {
      lines.push(`- ⚠️ ${note}`);
    }
    lines.push('');
  }

  if (report.suggestedRolloutOrder.length > 0) {
    lines.push('## Suggested Rollout Order');
    lines.push('');
    report.suggestedRolloutOrder.forEach((item, index) => {
      lines.push(`${index + 1}. ${item}`);
    });
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated by nerviq v${require('../package.json').version}*`);
  return lines.join('\n');
}

module.exports = { analyzeProject, printAnalysis, exportMarkdown };
