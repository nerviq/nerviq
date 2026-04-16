/**
 * Claude Code Freshness Operationalization
 *
 * Release gates, recurring probes, propagation checklists,
 * and staleness blocking for Claude Code surfaces.
 *
 * P0 sources from code.claude.com/docs and official Anthropic launch posts,
 * with propagation for CLAUDE.md, output style, and agent harness changes.
 */

const { version } = require('../package.json');

/**
 * P0 sources that must be fresh before any Claude Code release claim.
 */
const P0_SOURCES = [
  {
    key: 'claude-code-docs',
    label: 'Claude Code Official Docs',
    url: 'https://code.claude.com/docs',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'claude-md-format',
    label: 'CLAUDE.md / Memory Documentation',
    url: 'https://code.claude.com/docs/en/memory',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'claude-mcp-docs',
    label: 'Claude Code MCP Documentation',
    url: 'https://code.claude.com/docs/en/mcp',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'claude-hooks-docs',
    label: 'Claude Code Hooks Documentation',
    url: 'https://code.claude.com/docs/en/hooks',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'claude-security-docs',
    label: 'Claude Code Security Documentation',
    url: 'https://code.claude.com/docs/en/security',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'claude-permissions-docs',
    label: 'Claude Code Permissions Documentation',
    url: 'https://code.claude.com/docs/en/permissions',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'claude-settings-docs',
    label: 'Claude Code Settings Documentation',
    url: 'https://code.claude.com/docs/en/settings',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'claude-output-styles-docs',
    label: 'Claude Code Output Styles / Insights',
    url: 'https://code.claude.com/docs/en/output-styles',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-10',
  },
  {
    key: 'claude-best-practices-docs',
    label: 'Claude Code Best Practices / Auto Mode',
    url: 'https://code.claude.com/docs/en/best-practices',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-10',
  },
  {
    key: 'claude-agent-sdk-docs',
    label: 'Claude Agent SDK Overview',
    url: 'https://code.claude.com/docs/en/agent-sdk/overview',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-10',
  },
  {
    key: 'claude-xcode-agent-sdk',
    label: 'Anthropic Xcode Agent SDK Launch',
    url: 'https://www.anthropic.com/news/apple-xcode-claude-agent-sdk',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-10',
  },
  {
    key: 'anthropic-changelog',
    label: 'Claude Code Changelog',
    url: 'https://code.claude.com/docs/en/changelog',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'anthropic-models-overview',
    label: 'Anthropic Claude Models Overview',
    url: 'https://platform.claude.com/docs/en/docs/about-claude/models',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-16',
  },
];

/**
 * Propagation checklist: when a Claude Code source changes, these must update.
 */
const PROPAGATION_CHECKLIST = [
  {
    trigger: 'CLAUDE.md format change (new fields, import syntax, hierarchy change)',
    targets: [
      'src/context.js — update ProjectContext parsing',
      'src/techniques.js — update memory/context checks',
      'src/setup.js — update CLAUDE.md template generation',
    ],
  },
  {
    trigger: 'Hooks system change (event types, exit codes, schema)',
    targets: [
      'src/governance.js — update hookRegistry',
      'src/techniques.js — update hooks checks',
    ],
  },
  {
    trigger: 'MCP configuration format change',
    targets: [
      'src/techniques.js — update MCP checks',
      'src/mcp-packs.js — update pack projections',
      'src/context.js — update mcpConfig parsing',
    ],
  },
  {
    trigger: 'Permissions model change (allow/deny lists, operator/user split)',
    targets: [
      'src/governance.js — update permissionProfiles',
      'src/techniques.js — update permission checks',
    ],
  },
  {
    trigger: 'Output style / Insights change (system prompt layering, outputStyle storage, learning mode behavior)',
    targets: [
      'src/techniques.js — update Claude settings and instruction-surface checks that depend on system-prompt-adjacent behavior',
      'src/setup.js — update Claude settings starter templates if outputStyle guidance changes',
      'src/source-urls.js — refresh Claude feature source mappings when output style docs move or split',
    ],
  },
  {
    trigger: 'Best-practices or auto mode change (permission classifier, unattended mode, safety fallback behavior)',
    targets: [
      'src/governance.js — update permission mode caveats and policy guidance',
      'src/techniques.js — update Claude trust/verification checks tied to auto mode or unattended workflows',
      'src/source-urls.js — refresh Claude best-practice source mappings if guidance moves',
    ],
  },
  {
    trigger: 'Agent SDK / harness or native integration change (SDK surfaces, subagents, background tasks, Xcode bridge)',
    targets: [
      'src/techniques.js — update Claude modern-capability checks and cross-surface expectations',
      'src/mcp-packs.js — revisit pack assumptions when native integrations change MCP usage',
      'src/source-urls.js — refresh Claude source mappings for SDK and integration surfaces',
    ],
  },
];

/**
 * Release gate: check if all P0 sources are within staleness threshold.
 */
function checkReleaseGate(sourceVerifications = {}) {
  const now = new Date();
  const results = P0_SOURCES.map(source => {
    const verifiedAt = sourceVerifications[source.key]
      ? new Date(sourceVerifications[source.key])
      : source.verifiedAt ? new Date(source.verifiedAt) : null;

    if (!verifiedAt) {
      return { ...source, status: 'unverified', daysStale: null };
    }

    const daysSince = Math.floor((now - verifiedAt) / (1000 * 60 * 60 * 24));
    const isStale = daysSince > source.stalenessThresholdDays;

    return {
      ...source,
      verifiedAt: verifiedAt.toISOString(),
      daysStale: daysSince,
      status: isStale ? 'stale' : 'fresh',
    };
  });

  return {
    ready: results.every(r => r.status === 'fresh'),
    stale: results.filter(r => r.status === 'stale' || r.status === 'unverified'),
    fresh: results.filter(r => r.status === 'fresh'),
    results,
  };
}

function formatReleaseGate(gateResult) {
  const lines = [
    `Claude Code Freshness Gate (nerviq v${version})`,
    '═══════════════════════════════════════',
    '',
    `Status: ${gateResult.ready ? 'READY' : 'BLOCKED'}`,
    `Fresh: ${gateResult.fresh.length}/${gateResult.results.length}`,
    '',
  ];

  for (const result of gateResult.results) {
    const icon = result.status === 'fresh' ? '✓' : result.status === 'stale' ? '✗' : '?';
    const age = result.daysStale !== null ? ` (${result.daysStale}d ago)` : ' (unverified)';
    lines.push(`  ${icon} ${result.label}${age} — threshold: ${result.stalenessThresholdDays}d`);
  }

  if (!gateResult.ready) {
    lines.push('', 'Action required: verify stale/unverified sources before claiming release freshness.');
  }

  return lines.join('\n');
}

function getPropagationTargets(triggerKeyword) {
  const keyword = triggerKeyword.toLowerCase();
  return PROPAGATION_CHECKLIST.filter(item => item.trigger.toLowerCase().includes(keyword));
}

module.exports = {
  P0_SOURCES,
  PROPAGATION_CHECKLIST,
  checkReleaseGate,
  formatReleaseGate,
  getPropagationTargets,
};
