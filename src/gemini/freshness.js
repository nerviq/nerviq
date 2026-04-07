/**
 * Gemini Freshness Operationalization
 *
 * Release gates, recurring probes, propagation checklists,
 * and staleness blocking for Gemini CLI surfaces.
 */

const { version } = require('../../package.json');

/**
 * P0 sources that must be fresh before any Gemini release claim.
 * Each source has a staleness threshold in days.
 * From the watchlist: 62 sources, 18 P0 — main ones listed here.
 */
const P0_SOURCES = [
  {
    key: 'gemini-cli-docs',
    label: 'Gemini CLI Official Docs',
    url: 'https://google-gemini.github.io/gemini-cli/',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'gemini-config-reference',
    label: 'Gemini Config Reference',
    url: 'https://google-gemini.github.io/gemini-cli/docs/get-started/configuration.html',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'gemini-md-guide',
    label: 'GEMINI.md Guide',
    url: 'https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'gemini-hooks-docs',
    label: 'Gemini Hooks Documentation',
    url: 'https://google-gemini.github.io/gemini-cli/docs/hooks/',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'gemini-sandbox-docs',
    label: 'Gemini Sandbox Documentation',
    url: 'https://google-gemini.github.io/gemini-cli/docs/cli/sandbox.html',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'gemini-policy-engine-docs',
    label: 'Gemini Enterprise / Policy Guide',
    url: 'https://google-gemini.github.io/gemini-cli/docs/cli/enterprise.html',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'gemini-mcp-docs',
    label: 'Gemini MCP Documentation',
    url: 'https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'gemini-changelog',
    label: 'Gemini CLI Changelog',
    url: 'https://github.com/google-gemini/gemini-cli/releases',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'gemini-github-action-docs',
    label: 'Gemini GitHub Action',
    url: 'https://github.com/google-github-actions/run-gemini-cli',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
];

/**
 * Propagation checklist: when a Gemini source changes, these must update.
 */
const PROPAGATION_CHECKLIST = [
  {
    trigger: 'Gemini CLI release with config or sandbox changes',
    targets: [
      'src/gemini/techniques.js — update LEGACY patterns, sandbox options, policy syntax',
      'src/gemini/config-parser.js — update validation rules',
      'src/gemini/domain-packs.js — update pack projections if schema changed',
      'test/gemini-check-matrix.js — update check expectations',
    ],
  },
  {
    trigger: 'New Gemini hook event type added',
    targets: [
      'src/gemini/techniques.js — add to SUPPORTED_HOOK_EVENTS',
      'src/gemini/governance.js — add to GEMINI_HOOK_REGISTRY',
      'src/gemini/setup.js — update hooks starter template',
    ],
  },
  {
    trigger: 'New Gemini MCP transport or field',
    targets: [
      'src/gemini/mcp-packs.js — update pack JSON projections',
      'src/gemini/techniques.js — update MCP checks',
    ],
  },
  {
    trigger: 'New sandbox option or isolation mode added',
    targets: [
      'src/gemini/techniques.js — update sandbox checks',
      'src/gemini/governance.js — update governance profiles with new sandbox options',
      'src/gemini/setup.js — update sandbox starter template',
    ],
  },
  {
    trigger: 'Policy engine syntax or rule format change',
    targets: [
      'src/gemini/techniques.js — update policy validation checks',
      'src/gemini/governance.js — update policy templates and caveats',
      'src/gemini/config-parser.js — update policy parsing rules',
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
    `Gemini Freshness Gate (nerviq v${version})`,
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
