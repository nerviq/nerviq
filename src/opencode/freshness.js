/**
 * OpenCode Freshness Operationalization
 *
 * Release gates, recurring probes, propagation checklists,
 * and staleness blocking for OpenCode surfaces.
 */

const { version } = require('../../package.json');

const P0_SOURCES = [
  {
    key: 'opencode-docs',
    label: 'OpenCode Official Docs',
    url: 'https://opencode.ai/docs',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'opencode-config-reference',
    label: 'OpenCode Config Reference',
    url: 'https://opencode.ai/docs/config/',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'opencode-github-releases',
    label: 'OpenCode GitHub Releases',
    url: 'https://github.com/sst/opencode/releases',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'opencode-plugin-api',
    label: 'OpenCode Plugin API',
    url: 'https://opencode.ai/docs/plugins/',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'opencode-permissions-docs',
    label: 'OpenCode Permissions Documentation',
    url: 'https://opencode.ai/docs/permissions/',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
];

const PROPAGATION_CHECKLIST = [
  {
    trigger: 'OpenCode release with config changes',
    targets: [
      'src/opencode/techniques.js — update DEPRECATED_CONFIG_KEYS if keys renamed/removed',
      'src/opencode/config-parser.js — update JSONC validation',
      'src/opencode/governance.js — update caveats if behavior changes',
      'test/opencode-check-matrix.js — update check expectations',
    ],
  },
  {
    trigger: 'New OpenCode plugin event type added',
    targets: [
      'src/opencode/techniques.js — add to VALID_PLUGIN_EVENTS',
      'src/opencode/governance.js — add to OPENCODE_PLUGIN_GOVERNANCE',
      'src/opencode/setup.js — update plugins starter template',
    ],
  },
  {
    trigger: 'New OpenCode permission tool added',
    targets: [
      'src/opencode/techniques.js — add to PERMISSIONED_TOOLS',
      'src/opencode/governance.js — update permission profiles',
      'src/opencode/setup.js — update default permission config',
    ],
  },
  {
    trigger: 'OpenCode MCP schema change',
    targets: [
      'src/opencode/mcp-packs.js — update JSONC projections',
      'src/opencode/techniques.js — update MCP checks',
    ],
  },
  {
    trigger: 'Known security bug fixed or new bug reported',
    targets: [
      'src/opencode/techniques.js — update security checks (E02, E03, D05)',
      'src/opencode/governance.js — update platformCaveats',
      'src/opencode/freshness.js — verify against latest release',
    ],
  },
];

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
    `OpenCode Freshness Gate (nerviq v${version})`,
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
