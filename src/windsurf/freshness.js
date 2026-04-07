/**
 * Windsurf Freshness Operationalization
 *
 * Release gates, recurring probes, propagation checklists,
 * and staleness blocking for Windsurf surfaces.
 *
 * P0 sources from windsurf.com docs, propagation for rule format changes.
 */

const { version } = require('../../package.json');

/**
 * P0 sources that must be fresh before any Windsurf release claim.
 */
const P0_SOURCES = [
  {
    key: 'windsurf-rules-docs',
    label: 'Windsurf Rules & Memories Documentation',
    url: 'https://docs.windsurf.com/windsurf/cascade/memories',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'windsurf-cascade-docs',
    label: 'Cascade Agent Documentation',
    url: 'https://docs.windsurf.com/windsurf/cascade',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'windsurf-mcp-docs',
    label: 'Windsurf MCP Documentation',
    url: 'https://docs.windsurf.com/plugins/cascade/mcp',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'windsurf-memories-docs',
    label: 'Memories & Rules Documentation',
    url: 'https://docs.windsurf.com/windsurf/cascade/memories',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'windsurf-workflows-docs',
    label: 'Workflows Documentation',
    url: 'https://docs.windsurf.com/windsurf/cascade/workflows',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'windsurf-steps-docs',
    label: 'Steps Documentation (via Workflows)',
    url: 'https://docs.windsurf.com/windsurf/cascade/workflows',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'windsurf-cascadeignore-docs',
    label: 'Windsurf Ignore Documentation',
    url: 'https://docs.windsurf.com/context-awareness/windsurf-ignore',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'windsurf-changelog',
    label: 'Windsurf Changelog',
    url: 'https://windsurf.com/changelog',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'windsurf-security',
    label: 'Windsurf Security Admin Guide',
    url: 'https://docs.windsurf.com/security/security-admin-guide',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
];

/**
 * Propagation checklist: when a Windsurf source changes, these must update.
 */
const PROPAGATION_CHECKLIST = [
  {
    trigger: 'Rule format change (new frontmatter fields, activation mode change)',
    targets: [
      'src/windsurf/config-parser.js — update VALID_WINDSURF_FIELDS, detectRuleType, parseSimpleYaml',
      'src/windsurf/techniques.js — update rule validation checks (WS-A01..WS-A09)',
      'src/windsurf/context.js — update windsurfRules() parsing and type detection',
      'src/windsurf/setup.js — update rule template generation',
    ],
  },
  {
    trigger: 'Cascade agent behavior change (multi-file, Steps, Skills)',
    targets: [
      'src/windsurf/techniques.js — update Cascade agent checks (WS-D01..WS-D05)',
      'src/windsurf/governance.js — update permission profiles',
      'src/windsurf/deep-review.js — update trust class detection',
    ],
  },
  {
    trigger: 'Memories format or sync behavior change',
    targets: [
      'src/windsurf/techniques.js — update memory checks (WS-H01..WS-H05)',
      'src/windsurf/context.js — update memoryContents() parsing',
      'src/windsurf/governance.js — update team-managed permission profile',
    ],
  },
  {
    trigger: 'MCP configuration format change in .windsurf/mcp.json',
    targets: [
      'src/windsurf/mcp-packs.js — update pack JSON projections and merge logic',
      'src/windsurf/techniques.js — update MCP checks (WS-E01..WS-E05)',
      'src/windsurf/context.js — update mcpConfig() parsing',
      'src/windsurf/config-parser.js — update validateMcpEnvVars',
    ],
  },
  {
    trigger: 'MCP team whitelist format change',
    targets: [
      'src/windsurf/techniques.js — update WS-B02, WS-E05 thresholds',
      'src/windsurf/governance.js — update mcp-team-whitelist caveat',
      'src/windsurf/mcp-packs.js — update recommendation logic',
    ],
  },
  {
    trigger: 'Workflow / slash command format change',
    targets: [
      'src/windsurf/techniques.js — update workflow checks (WS-G01..WS-G05)',
      'src/windsurf/context.js — update workflowFiles() parsing',
      'src/windsurf/governance.js — update workflow-trigger hook',
    ],
  },
  {
    trigger: 'Cascadeignore format or behavior change',
    targets: [
      'src/windsurf/techniques.js — update cascadeignore checks (WS-J01..WS-J02)',
      'src/windsurf/context.js — update cascadeignoreContent() parsing',
      'src/windsurf/patch.js — update patchCascadeignore',
    ],
  },
  {
    trigger: '10K char rule limit change',
    targets: [
      'src/windsurf/techniques.js — update WS-A05, WS-L05',
      'src/windsurf/context.js — update overLimit calculation',
      'src/windsurf/governance.js — update rule-char-limit caveat',
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

    return { ...source, verifiedAt: verifiedAt.toISOString(), daysStale: daysSince, status: isStale ? 'stale' : 'fresh' };
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
    `Windsurf Freshness Gate (nerviq v${version})`,
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
