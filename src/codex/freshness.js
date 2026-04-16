/**
 * Codex Freshness Operationalization — CP-12
 *
 * Release gates, recurring probes, propagation checklists,
 * and staleness blocking for Codex surfaces.
 */

const { version } = require('../../package.json');

/**
 * P0 sources that must be fresh before any Codex release claim.
 * Each source has a staleness threshold in days.
 */
const P0_SOURCES = [
  {
    key: 'codex-cli-docs',
    label: 'Codex CLI Official Docs',
    url: 'https://developers.openai.com/codex/cli',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'codex-config-reference',
    label: 'Codex Config Reference',
    url: 'https://developers.openai.com/codex/config-reference',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'codex-agent-approvals-security',
    label: 'Codex Agent Approvals & Security',
    url: 'https://developers.openai.com/codex/agent-approvals-security',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-10',
  },
  {
    key: 'codex-subagents',
    label: 'Codex Subagents Documentation',
    url: 'https://developers.openai.com/codex/subagents',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-10',
  },
  {
    key: 'codex-automations',
    label: 'Codex Automations / App Workflows',
    url: 'https://developers.openai.com/codex/app/automations',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-10',
  },
  {
    key: 'codex-local-environments',
    label: 'Codex Local Environments / Worktrees',
    url: 'https://developers.openai.com/codex/app/local-environments',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-10',
  },
  {
    key: 'codex-feature-maturity',
    label: 'Codex Feature Maturity',
    url: 'https://developers.openai.com/codex/feature-maturity',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-10',
  },
  {
    key: 'codex-github-action',
    label: 'Codex GitHub Action',
    url: 'https://github.com/openai/codex-action',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'codex-changelog',
    label: 'Codex CLI Changelog',
    url: 'https://github.com/openai/codex/releases',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'codex-models-docs',
    label: 'Codex Supported Models',
    url: 'https://developers.openai.com/codex/models',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-16',
  },
];

/**
 * Propagation checklist: when a Codex source changes, these must update.
 */
const PROPAGATION_CHECKLIST = [
  {
    trigger: 'Codex CLI release with config changes',
    targets: [
      'src/codex/techniques.js — update LEGACY_CONFIG_PATTERNS if keys renamed/removed',
      'src/codex/config-parser.js — update validation rules',
      'src/codex/governance.js — update caveats if behavior changes',
      'test/codex-check-matrix.js — update check expectations',
    ],
  },
  {
    trigger: 'New Codex hook event type added',
    targets: [
      'src/codex/techniques.js — add to SUPPORTED_HOOK_EVENTS',
      'src/codex/governance.js — add to CODEX_HOOK_REGISTRY',
      'src/codex/setup.js — update hooks starter template',
    ],
  },
  {
    trigger: 'New Codex MCP transport or field',
    targets: [
      'src/codex/mcp-packs.js — update pack TOML projections',
      'src/codex/techniques.js — update MCP checks',
    ],
  },
  {
    trigger: 'Codex domain pack definitions change',
    targets: [
      'src/codex/domain-packs.js — update pack registry',
      'src/codex/governance.js — governance export picks up changes',
    ],
  },
  {
    trigger: 'New check category added',
    targets: [
      'src/codex/techniques.js — add check implementations',
      'test/codex-check-matrix.js — add pass/fail scenarios',
      'test/codex-golden-matrix.js — update golden scores',
    ],
  },
  {
    trigger: 'Codex approvals/security model change (approval classes, sandboxing, unattended safety behavior)',
    targets: [
      'src/codex/governance.js — update permission profiles and caveats',
      'src/codex/techniques.js — update trust/security checks tied to approval behavior',
      'src/source-urls.js — refresh Codex trust/authentication source mappings if docs move',
    ],
  },
  {
    trigger: 'Codex subagent or local-environment change (subagents, worktrees, workspace lifecycle, handoff expectations)',
    targets: [
      'src/codex/setup.js — update subagent/worktree starter templates',
      'src/codex/techniques.js — update subagent and worktree governance checks',
      'src/codex/governance.js — update multi-agent policy guidance',
    ],
  },
  {
    trigger: 'Codex automation or feature-maturity change (automations, background workflows, capability maturity guidance)',
    targets: [
      'src/codex/techniques.js — update automation and maturity-sensitive checks',
      'src/codex/interactive.js — update automation/setup wizard copy if platform behavior changes',
      'src/source-urls.js — refresh Codex automation and maturity source mappings',
    ],
  },
];

/**
 * Release gate: check if all P0 sources are within staleness threshold.
 * Returns { ready, stale, fresh } arrays.
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

/**
 * Format the release gate results for display.
 */
function formatReleaseGate(gateResult) {
  const lines = [
    `Codex Freshness Gate (nerviq v${version})`,
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
    lines.push('');
    lines.push('Action required: verify stale/unverified sources before claiming release freshness.');
  }

  return lines.join('\n');
}

/**
 * Get the propagation checklist for a given trigger.
 */
function getPropagationTargets(triggerKeyword) {
  const keyword = triggerKeyword.toLowerCase();
  return PROPAGATION_CHECKLIST.filter(item =>
    item.trigger.toLowerCase().includes(keyword)
  );
}

module.exports = {
  P0_SOURCES,
  PROPAGATION_CHECKLIST,
  checkReleaseGate,
  formatReleaseGate,
  getPropagationTargets,
};
