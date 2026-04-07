/**
 * Claude Code Freshness Operationalization
 *
 * Release gates, recurring probes, propagation checklists,
 * and staleness blocking for Claude Code surfaces.
 *
 * P0 sources from code.claude.com/docs, propagation for CLAUDE.md format changes.
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
    key: 'anthropic-changelog',
    label: 'Claude Code Changelog',
    url: 'https://code.claude.com/docs/en/changelog',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-07',
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
