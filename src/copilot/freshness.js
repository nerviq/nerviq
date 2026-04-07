/**
 * Copilot Freshness Operationalization
 *
 * Release gates, recurring probes, propagation checklists,
 * and staleness blocking for Copilot surfaces.
 *
 * P0 sources from Copilot docs, propagation checklist.
 */

const { version } = require('../../package.json');

/**
 * P0 sources that must be fresh before any Copilot release claim.
 */
const P0_SOURCES = [
  {
    key: 'copilot-instructions-docs',
    label: 'Copilot Instructions Documentation',
    url: 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'copilot-agent-mode-docs',
    label: 'Copilot Agent Mode (IDE Chat)',
    url: 'https://docs.github.com/en/copilot/how-tos/chat-with-copilot/chat-in-ide',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'copilot-cloud-agent-docs',
    label: 'Copilot Coding Agent',
    url: 'https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'copilot-prompt-files-docs',
    label: 'Copilot Prompt Files Documentation',
    url: 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot#creating-prompt-files',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'copilot-mcp-docs',
    label: 'Copilot MCP Documentation',
    url: 'https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'copilot-content-exclusions-docs',
    label: 'Copilot Content Exclusions Documentation',
    url: 'https://docs.github.com/en/copilot/how-tos/configure-content-exclusion/exclude-content-from-copilot',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'copilot-vscode-settings-docs',
    label: 'VS Code Copilot Settings Reference',
    url: 'https://code.visualstudio.com/docs/copilot/copilot-settings',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'copilot-changelog',
    label: 'GitHub Copilot Changelog',
    url: 'https://github.blog/changelog/label/copilot/',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-07',
  },
  {
    key: 'copilot-trust-security-docs',
    label: 'Copilot Responsible Use Documentation',
    url: 'https://docs.github.com/en/copilot/responsible-use/chat-in-your-ide',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-07',
  },
];

/**
 * Propagation checklist: when a Copilot source changes, these must update.
 */
const PROPAGATION_CHECKLIST = [
  {
    trigger: 'New Copilot VS Code settings key added or deprecated',
    targets: [
      'src/copilot/techniques.js — update config checks and deprecated patterns',
      'src/copilot/config-parser.js — update KNOWN_COPILOT_SETTINGS_KEYS and DEPRECATED_COPILOT_KEYS',
      'src/copilot/setup.js — update settings template',
      'src/copilot/governance.js — update hook registry if new auto-approval pattern',
    ],
  },
  {
    trigger: 'Cloud agent behavior change (setup-steps format, signed commits, etc.)',
    targets: [
      'src/copilot/techniques.js — update cloud agent checks (CP-E01..CP-E05)',
      'src/copilot/setup.js — update copilot-setup-steps.yml template',
      'src/copilot/governance.js — update cloud-agent permission profile',
    ],
  },
  {
    trigger: 'New instruction file format or frontmatter field',
    targets: [
      'src/copilot/config-parser.js — update frontmatter validation',
      'src/copilot/techniques.js — update instruction checks (CP-A06, CP-B05)',
      'src/copilot/context.js — update scopedInstructions() or promptFiles() parsing',
    ],
  },
  {
    trigger: 'MCP configuration format change in .vscode/mcp.json',
    targets: [
      'src/copilot/mcp-packs.js — update pack JSON projections and merge logic',
      'src/copilot/techniques.js — update MCP checks (CP-D01..CP-D05)',
      'src/copilot/context.js — update mcpConfig() parsing',
    ],
  },
  {
    trigger: 'Content exclusion enforcement change (especially cloud agent)',
    targets: [
      'src/copilot/techniques.js — update CP-C01, CP-C02 checks',
      'src/copilot/governance.js — update caveats and policy packs',
      'src/copilot/setup.js — update content exclusions guide',
    ],
  },
  {
    trigger: 'Organization policy change or new policy type',
    targets: [
      'src/copilot/techniques.js — update organization checks (CP-F01..CP-F05)',
      'src/copilot/governance.js — update enterprise-managed profile',
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
    `Copilot Freshness Gate (nerviq v${version})`,
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
