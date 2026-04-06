const { DOMAIN_PACKS } = require('./domain-packs');
const { MCP_PACKS, mergeMcpServers, normalizeMcpPackKeys } = require('./mcp-packs');
const { getCodexGovernanceSummary } = require('./codex/governance');

const PERMISSION_PROFILES = [
  {
    key: 'read-only',
    label: 'Read-Only',
    risk: 'low',
    defaultMode: 'plan',
    useWhen: 'Security review, discovery, and first contact with a mature repo.',
    behavior: 'No file writes. Safe for audits, workshops, and approval flows.',
    deny: ['Write(**)', 'Edit(**)', 'MultiEdit(**)', 'Bash(rm -rf *)', 'Bash(git reset --hard *)'],
  },
  {
    key: 'suggest-only',
    label: 'Suggest-Only',
    risk: 'low',
    defaultMode: 'acceptEdits',
    useWhen: 'Teams want structured proposals and exported plans without automatic apply.',
    behavior: 'Generates plans and proposal bundles, but no source changes are applied.',
    deny: ['Bash(rm -rf *)', 'Bash(git reset --hard *)', 'Bash(git clean *)', 'Read(./.env*)'],
  },
  {
    key: 'safe-write',
    label: 'Safe-Write',
    risk: 'medium',
    defaultMode: 'acceptEdits',
    useWhen: 'Starter repos or tightly scoped apply flows with visible rollback.',
    behavior: 'Allows creation of missing Claude artifacts while preserving existing files.',
    deny: ['Read(./.env*)', 'Read(./secrets/**)', 'Bash(rm -rf *)', 'Bash(git push --force *)'],
  },
  {
    key: 'power-user',
    label: 'Power-User',
    risk: 'medium',
    defaultMode: 'acceptEdits',
    useWhen: 'Experienced maintainers who understand the repo and want faster iteration.',
    behavior: 'Broader local automation with fewer prompts, still without bypass defaults.',
    deny: ['Read(./.env*)', 'Bash(rm -rf *)'],
  },
  {
    key: 'internal-research',
    label: 'Internal-Research',
    risk: 'high',
    defaultMode: 'bypassPermissions',
    useWhen: 'Internal experiments only, never as a product-facing default.',
    behavior: 'Maximum autonomy for research workflows, suitable only with explicit human oversight.',
    deny: [],
  },
];

const HOOK_REGISTRY = [
  {
    key: 'protect-secrets',
    file: '.claude/hooks/protect-secrets.sh',
    triggerPoint: 'PreToolUse',
    matcher: 'Read|Write|Edit',
    purpose: 'Blocks direct access to secret or credential files before a tool runs.',
    filesTouched: [],
    sideEffects: ['Stops the action and returns a block decision when a secret path is targeted.'],
    risk: 'low',
    riskLevel: 'high',
    dryRunExample: 'Attempt to read `.env` and confirm the hook blocks the request.',
    rollbackPath: 'Remove the PreToolUse registration from settings.json.',
  },
  {
    key: 'on-edit-lint',
    file: '.claude/hooks/on-edit-lint.sh',
    triggerPoint: 'PostToolUse',
    matcher: 'Write|Edit',
    purpose: 'Runs the repo linter or formatter after file edits when tooling is available.',
    filesTouched: ['Working tree files targeted by eslint/ruff fixes'],
    sideEffects: ['May auto-fix formatting or lint issues.', 'Can modify the same files that were just edited.'],
    risk: 'medium',
    riskLevel: 'medium',
    dryRunExample: 'Edit a JS or Python file and inspect whether eslint or ruff would run.',
    rollbackPath: 'Remove the PostToolUse hook entry or delete the script.',
  },
  {
    key: 'log-changes',
    file: '.claude/hooks/log-changes.sh',
    triggerPoint: 'PostToolUse',
    matcher: 'Write|Edit',
    purpose: 'Appends a durable file-change log under `.claude/logs/` for later review.',
    filesTouched: ['.claude/logs/file-changes.log'],
    sideEffects: ['Creates the logs directory on first use.', 'Adds a timestamped audit line per file change.'],
    risk: 'low',
    riskLevel: 'low',
    dryRunExample: 'Edit one file and verify the log entry is appended.',
    rollbackPath: 'Remove the PostToolUse hook entry and delete the log file if desired.',
  },
  {
    key: 'duplicate-id-check',
    file: '.claude/hooks/check-duplicate-ids.sh',
    triggerPoint: 'PostToolUse',
    matcher: 'Write|Edit',
    purpose: 'Detects duplicate IDs in catalog or structured data files after edits.',
    filesTouched: [],
    sideEffects: ['Returns a systemMessage warning if duplicates are found.'],
    risk: 'low',
    riskLevel: 'low',
    dryRunExample: 'Edit a catalog file and verify duplicate check runs without blocking.',
    rollbackPath: 'Remove the PostToolUse hook entry from settings.',
  },
  {
    key: 'injection-defense',
    file: '.claude/hooks/injection-defense.sh',
    triggerPoint: 'PostToolUse',
    matcher: 'WebFetch|WebSearch',
    purpose: 'Scans web tool outputs for common prompt injection patterns.',
    filesTouched: ['tools/failure-log.txt'],
    sideEffects: ['Logs alerts to failure log.', 'Returns a systemMessage warning if patterns detected.'],
    risk: 'low',
    riskLevel: 'low',
    dryRunExample: 'Run a WebFetch and verify output is scanned for injection patterns.',
    rollbackPath: 'Remove the PostToolUse hook entry from settings.',
  },
  {
    key: 'trust-drift-check',
    file: '.claude/hooks/trust-drift-check.sh',
    triggerPoint: 'PostToolUse',
    matcher: 'Write|Edit',
    purpose: 'Runs trust drift validation after file changes to catch metric/docs inconsistencies.',
    filesTouched: [],
    sideEffects: ['Returns a systemMessage warning if drift is detected.'],
    risk: 'low',
    riskLevel: 'low',
    dryRunExample: 'Edit a product-facing file and verify drift check runs.',
    rollbackPath: 'Remove the PostToolUse hook entry from settings.',
  },
  {
    key: 'session-init',
    file: '.claude/hooks/session-start.sh',
    triggerPoint: 'SessionStart',
    matcher: null,
    purpose: 'Rotates large log files and loads workspace context at session start.',
    filesTouched: ['tools/change-log.txt', 'tools/failure-log.txt'],
    sideEffects: ['Archives logs over 500KB.', 'Returns a systemMessage with workspace info.'],
    risk: 'low',
    riskLevel: 'low',
    dryRunExample: 'Start a new session and verify log rotation runs.',
    rollbackPath: 'Remove the SessionStart hook entry from settings.',
  },
];

/**
 * Classify the risk level of a hook based on its event type and characteristics.
 * - high: PreToolUse hooks that can block operations (exit 2)
 * - medium: PostToolUse hooks that modify files or warn (exit 1 or write-only)
 * - low: Informational hooks (PostToolUse notification/logging, SessionStart)
 * @param {Object} hook - A hook entry from HOOK_REGISTRY or a custom hook.
 * @returns {string} Risk level: 'high', 'medium', or 'low'.
 */
function classifyHookRiskLevel(hook) {
  // PreToolUse hooks can block operations (exit code 2 blocks the tool call)
  if (hook.triggerPoint === 'PreToolUse') {
    return 'high';
  }

  // SessionStart hooks are informational — they run once at session init
  if (hook.triggerPoint === 'SessionStart') {
    return 'low';
  }

  // PostToolUse hooks that touch files are medium risk (they can modify working tree)
  if (hook.triggerPoint === 'PostToolUse') {
    if (Array.isArray(hook.filesTouched) && hook.filesTouched.length > 0) {
      // Hooks that only write to log files are low risk
      const onlyLogs = hook.filesTouched.every(f =>
        /\blog|\.log\b/i.test(f) || f.includes('logs/')
      );
      if (onlyLogs) return 'low';
      return 'medium';
    }
    return 'low';
  }

  // Default: unknown trigger points get medium risk
  return 'medium';
}

const POLICY_PACKS = [
  {
    key: 'baseline-engineering',
    label: 'Baseline Engineering',
    modules: ['CLAUDE.md baseline', 'commands', 'rules', 'safe-write profile'],
    useWhen: 'General product teams that want a pragmatic default.',
  },
  {
    key: 'security-sensitive',
    label: 'Security-Sensitive',
    modules: ['read-only profile', 'suggest-only mode', 'protect-secrets hook', 'approval checklist'],
    useWhen: 'Auth, payments, customer data, or regulated surfaces.',
  },
  {
    key: 'oss-friendly',
    label: 'OSS-Friendly',
    modules: ['suggest-only profile', 'minimal commands', 'light rules', 'manual merge expectations'],
    useWhen: 'Open-source repos with many external contributors.',
  },
  {
    key: 'regulated-lite',
    label: 'Regulated-Lite',
    modules: ['suggest-only or safe-write profile', 'activity artifacts', 'rollback manifests', 'benchmark evidence'],
    useWhen: 'Teams that need auditable change paths before broader adoption.',
  },
];

const PILOT_ROLLOUT_KIT = {
  recommendedScope: [
    'Pick 1-2 repos with active maintainers and low blast radius.',
    'Run discover and suggest-only first; avoid direct writes on mature repos.',
    'Choose one permission profile before any pilot starts.',
    'Define success metrics before the first benchmark run.',
  ],
  approvals: [
    'Engineering owner approves scope and rollback expectations.',
    'Security owner approves the selected permission profile and hooks.',
    'Pilot owner records the benchmark baseline and acceptance criteria.',
  ],
  successMetrics: [
    'Score delta and organic score delta',
    'Number of recommendations accepted',
    'Time to first useful Claude workflow',
    'Rollback-free apply rate',
  ],
  rollbackExpectations: [
    'Every apply batch must emit a rollback artifact.',
    'If a created artifact is rejected, delete the files listed in the rollback manifest.',
    'Record the rollback event in the activity log for auditability.',
  ],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeUnique(existing = [], additions = []) {
  return [...new Set([...(Array.isArray(existing) ? existing : []), ...additions])];
}

function mergeHooks(existingHooks = {}, nextHooks = {}) {
  const merged = clone(existingHooks || {});

  for (const [stage, blocks] of Object.entries(nextHooks)) {
    const targetBlocks = Array.isArray(merged[stage]) ? clone(merged[stage]) : [];
    for (const incoming of blocks) {
      const index = targetBlocks.findIndex(block => block.matcher === incoming.matcher);
      if (index === -1) {
        targetBlocks.push(clone(incoming));
        continue;
      }

      const current = targetBlocks[index];
      const existingCommands = new Set((current.hooks || []).map(hook => `${hook.type}:${hook.command}:${hook.timeout || ''}`));
      const mergedHooks = [...(current.hooks || [])];
      for (const hook of incoming.hooks || []) {
        const signature = `${hook.type}:${hook.command}:${hook.timeout || ''}`;
        if (!existingCommands.has(signature)) {
          mergedHooks.push(clone(hook));
          existingCommands.add(signature);
        }
      }
      targetBlocks[index] = { ...current, hooks: mergedHooks };
    }
    merged[stage] = targetBlocks;
  }

  return merged;
}

function getPermissionProfile(key = 'safe-write') {
  return PERMISSION_PROFILES.find(profile => profile.key === key) ||
    PERMISSION_PROFILES.find(profile => profile.key === 'safe-write');
}

function isWritableProfile(key = 'safe-write') {
  return ['safe-write', 'power-user', 'internal-research'].includes(getPermissionProfile(key).key);
}

function ensureWritableProfile(key = 'safe-write', commandName = 'apply', dryRun = false) {
  const profile = getPermissionProfile(key);
  if (!dryRun && !isWritableProfile(profile.key)) {
    throw new Error(`${commandName} requires a writable profile. Use --profile safe-write or --dry-run.`);
  }
  return profile;
}

function buildHookConfig(hookFiles, profileKey) {
  const profile = getPermissionProfile(profileKey);
  if (!isWritableProfile(profile.key)) {
    return {};
  }

  const uniqueFiles = [...new Set(hookFiles)].sort();
  if (uniqueFiles.length === 0) {
    return {};
  }

  // Detect hook runtime: .js files use node, .sh files use bash
  const hookCommand = (file) => {
    if (file.endsWith('.js')) return `node .claude/hooks/${file}`;
    return `bash .claude/hooks/${file}`;
  };
  const isSecrets = (f) => f === 'protect-secrets.sh' || f === 'protect-secrets.js';
  const isSession = (f) => f === 'session-start.sh' || f === 'session-start.js';

  const hookConfig = {
    PostToolUse: [{
      matcher: 'Write|Edit',
      hooks: uniqueFiles
        .filter(file => !isSecrets(file) && !isSession(file))
        .map(file => ({
          type: 'command',
          command: hookCommand(file),
          timeout: 10,
        })),
    }],
  };

  const secretsFile = uniqueFiles.find(isSecrets);
  if (secretsFile) {
    hookConfig.PreToolUse = [{
      matcher: 'Read|Write|Edit',
      hooks: [{
        type: 'command',
        command: hookCommand(secretsFile),
        timeout: 5,
      }],
    }];
  }

  const sessionFile = uniqueFiles.find(isSession);
  if (sessionFile) {
    hookConfig.SessionStart = [{
      matcher: '*',
      hooks: [{
        type: 'command',
        command: hookCommand(sessionFile),
        timeout: 5,
      }],
    }];
  }

  if ((hookConfig.PostToolUse[0].hooks || []).length === 0) {
    delete hookConfig.PostToolUse;
  }

  return hookConfig;
}

function buildSettingsForProfile({ profileKey = 'safe-write', hookFiles = [], existingSettings = null, mcpPackKeys = [] } = {}) {
  const profile = getPermissionProfile(profileKey);
  const base = existingSettings ? clone(existingSettings) : {};
  const selectedMcpPacks = normalizeMcpPackKeys(mcpPackKeys);
  base.permissions = base.permissions || {};
  base.permissions.defaultMode = profile.defaultMode;
  base.permissions.deny = mergeUnique(base.permissions.deny, profile.deny);

  const hookConfig = buildHookConfig(hookFiles, profile.key);
  if (Object.keys(hookConfig).length > 0) {
    base.hooks = mergeHooks(base.hooks, hookConfig);
  }

  if (selectedMcpPacks.length > 0) {
    base.mcpServers = mergeMcpServers(base.mcpServers, selectedMcpPacks);
  }

  base.nerviqSetup = {
    ...(base.nerviqSetup || {}),
    profile: profile.key,
    mcpPacks: selectedMcpPacks,
  };

  return base;
}

/**
 * Return the full governance surface: permission profiles, hooks, policy packs, and pilot kit.
 * @returns {Object} Summary containing permissionProfiles, hookRegistry, policyPacks, domainPacks, mcpPacks, and pilotRolloutKit.
 */
function getGovernanceSummary(platform = 'claude') {
  if (platform === 'codex') {
    return getCodexGovernanceSummary();
  }

  return {
    platform: 'claude',
    platformLabel: 'Claude',
    permissionProfiles: PERMISSION_PROFILES,
    hookRegistry: HOOK_REGISTRY,
    policyPacks: POLICY_PACKS,
    domainPacks: DOMAIN_PACKS,
    mcpPacks: MCP_PACKS,
    pilotRolloutKit: PILOT_ROLLOUT_KIT,
  };
}

function printGovernanceSummary(summary, options = {}) {
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('');
  console.log(`  nerviq ${summary.platformLabel.toLowerCase()} governance`);
  console.log('  ═══════════════════════════════════════');
  console.log(`  Safe defaults, hook transparency, and pilot guidance for ${summary.platformLabel}.`);
  console.log('');

  console.log('  Permission Profiles');
  for (const profile of summary.permissionProfiles) {
    console.log(`  - ${profile.label} [${profile.risk}]`);
    console.log(`    ${profile.useWhen}`);
    console.log(`    defaultMode=${profile.defaultMode}`);
  }
  console.log('');

  console.log('  Hook Registry');
  for (const hook of summary.hookRegistry) {
    const riskColor = hook.risk === 'low' ? '\x1b[32m' : hook.risk === 'medium' ? '\x1b[33m' : '\x1b[31m';
    const rl = hook.riskLevel || classifyHookRiskLevel(hook);
    const rlColor = rl === 'low' ? '\x1b[32m' : rl === 'medium' ? '\x1b[33m' : '\x1b[31m';
    console.log(`  - ${hook.file} ${riskColor}[${hook.risk} risk]\x1b[0m ${rlColor}[${rl} riskLevel]\x1b[0m`);
    console.log(`    ${hook.triggerPoint}${hook.matcher ? ` ${hook.matcher}` : ''} -> ${hook.purpose}`);
  }
  console.log('');

  console.log('  Policy Packs');
  for (const pack of summary.policyPacks) {
    console.log(`  - ${pack.label}: ${pack.modules.join(', ')}`);
  }
  console.log('');

  const domainPacks = summary.domainPacks || [];
  const mcpPacks = summary.mcpPacks || [];
  const compact = !options.verbose;
  const COMPACT_LIMIT = 5;

  console.log(`  Domain Packs (${domainPacks.length})`);
  if (domainPacks.length === 0) {
    console.log('  - none shipped yet for this platform');
  }
  const domainShow = compact ? domainPacks.slice(0, COMPACT_LIMIT) : domainPacks;
  for (const pack of domainShow) {
    console.log(`  - ${pack.label}: ${pack.useWhen}`);
  }
  if (compact && domainPacks.length > COMPACT_LIMIT) {
    console.log(`  ... and ${domainPacks.length - COMPACT_LIMIT} more (use --verbose to see all)`);
  }
  console.log('');

  console.log(`  MCP Packs (${mcpPacks.length})`);
  if (mcpPacks.length === 0) {
    console.log('  - none shipped yet for this platform');
  }
  const mcpShow = compact ? mcpPacks.slice(0, COMPACT_LIMIT) : mcpPacks;
  for (const pack of mcpShow) {
    console.log(`  - ${pack.label}: ${Object.keys(pack.servers).join(', ')}`);
  }
  if (compact && mcpPacks.length > COMPACT_LIMIT) {
    console.log(`  ... and ${mcpPacks.length - COMPACT_LIMIT} more (use --verbose to see all)`);
  }
  console.log('');

  if (Array.isArray(summary.platformCaveats) && summary.platformCaveats.length > 0) {
    console.log('  Platform Caveats');
    for (const item of summary.platformCaveats) {
      console.log(`  - ${item}`);
    }
    console.log('');
  }

  console.log('  Pilot Rollout Kit');
  for (const item of summary.pilotRolloutKit.recommendedScope) {
    console.log(`  - ${item}`);
  }
  console.log('');
}

/**
 * Render a governance summary as a formatted markdown string.
 * @param {Object} summary - The summary object returned by getGovernanceSummary().
 * @returns {string} Markdown-formatted governance report.
 */
function renderGovernanceMarkdown(summary) {
  const lines = [
    '# NERVIQ CLI Governance Report',
    '',
    `Platform: ${summary.platformLabel}`,
    '',
    `This report summarizes the shipped governance surface for ${summary.platformLabel} rollout, review, and pilot approval.`,
    '',
    '## Permission Profiles',
  ];

  for (const profile of summary.permissionProfiles) {
    lines.push(`- **${profile.label}** \`${profile.key}\` | risk: \`${profile.risk}\` | defaultMode: \`${profile.defaultMode}\``);
    lines.push(`  - Use when: ${profile.useWhen}`);
    lines.push(`  - Behavior: ${profile.behavior}`);
    if (Array.isArray(profile.deny) && profile.deny.length > 0) {
      lines.push(`  - Deny rules: ${profile.deny.join(', ')}`);
    }
  }

  lines.push('', '## Hook Registry');
  for (const hook of summary.hookRegistry) {
    const rl = hook.riskLevel || classifyHookRiskLevel(hook);
    lines.push(`- **${hook.key}** \`${hook.triggerPoint}${hook.matcher ? ` ${hook.matcher}` : ''}\` | risk: \`${hook.risk}\` | riskLevel: \`${rl}\``);
    lines.push(`  - File: ${hook.file}`);
    lines.push(`  - Purpose: ${hook.purpose}`);
    lines.push(`  - Dry run: ${hook.dryRunExample}`);
    lines.push(`  - Rollback: ${hook.rollbackPath}`);
  }

  lines.push('', '## Policy Packs');
  for (const pack of summary.policyPacks) {
    lines.push(`- **${pack.label}**`);
    lines.push(`  - Use when: ${pack.useWhen}`);
    lines.push(`  - Modules: ${pack.modules.join(', ')}`);
  }

  lines.push('', `## Domain Packs (${(summary.domainPacks || []).length})`);
  for (const pack of summary.domainPacks || []) {
    lines.push(`- **${pack.label}**: ${pack.useWhen}`);
  }
  if ((summary.domainPacks || []).length === 0) {
    lines.push('- None shipped yet for this platform.');
  }

  lines.push('', `## MCP Packs (${(summary.mcpPacks || []).length})`);
  for (const pack of summary.mcpPacks || []) {
    lines.push(`- **${pack.label}**: ${Object.keys(pack.servers).join(', ')}`);
  }
  if ((summary.mcpPacks || []).length === 0) {
    lines.push('- None shipped yet for this platform.');
  }

  if (Array.isArray(summary.platformCaveats) && summary.platformCaveats.length > 0) {
    lines.push('', '## Platform Caveats');
    for (const item of summary.platformCaveats) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('', '## Pilot Rollout Kit', '### Recommended Scope');
  for (const item of summary.pilotRolloutKit.recommendedScope) {
    lines.push(`- ${item}`);
  }

  lines.push('', '### Approvals');
  for (const item of summary.pilotRolloutKit.approvals) {
    lines.push(`- ${item}`);
  }

  lines.push('', '### Success Metrics');
  for (const item of summary.pilotRolloutKit.successMetrics) {
    lines.push(`- ${item}`);
  }

  lines.push('', '### Rollback Expectations');
  for (const item of summary.pilotRolloutKit.rollbackExpectations) {
    lines.push(`- ${item}`);
  }

  lines.push('');
  lines.push('---');
  lines.push(`*Generated by nerviq v${require('../package.json').version} on ${new Date().toISOString().split('T')[0]}*`);
  return lines.join('\n');
}

module.exports = {
  PERMISSION_PROFILES,
  getPermissionProfile,
  isWritableProfile,
  ensureWritableProfile,
  buildSettingsForProfile,
  getGovernanceSummary,
  printGovernanceSummary,
  renderGovernanceMarkdown,
  classifyHookRiskLevel,
};
