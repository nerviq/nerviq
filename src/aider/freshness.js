/**
 * Aider Freshness Operationalization
 *
 * Release gates, recurring probes, propagation checklists,
 * and staleness blocking for Aider surfaces.
 */

const { version } = require('../../package.json');

/**
 * P0 sources that must be fresh before any Aider release claim.
 */
const P0_SOURCES = [
  {
    key: 'aider-docs',
    label: 'Aider Official Docs',
    url: 'https://aider.chat',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-08',
  },
  {
    key: 'aider-config-reference',
    label: 'Aider Config Reference',
    url: 'https://aider.chat/docs/config/aider_conf.html',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-08',
  },
  {
    key: 'aider-github-releases',
    label: 'Aider GitHub Releases',
    url: 'https://github.com/Aider-AI/aider/releases',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-08',
  },
  {
    key: 'aider-model-docs',
    label: 'Aider Model Documentation',
    url: 'https://aider.chat/docs/llms.html',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-08',
  },
  {
    key: 'aider-chat-modes',
    label: 'Aider Chat Modes',
    url: 'https://aider.chat/docs/usage/modes.html',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-10',
  },
  {
    key: 'aider-git-integration',
    label: 'Aider Git Integration',
    url: 'https://aider.chat/docs/git.html',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-10',
  },
  {
    key: 'aider-conventions',
    label: 'Aider Coding Conventions',
    url: 'https://aider.chat/docs/usage/conventions.html',
    stalenessThresholdDays: 30,
    verifiedAt: '2026-04-10',
  },
  {
    key: 'aider-pypi',
    label: 'Aider PyPI Package',
    url: 'https://pypi.org/project/aider-chat/',
    stalenessThresholdDays: 14,
    verifiedAt: '2026-04-08',
  },
];

/**
 * Propagation checklist: when an Aider source changes, these must update.
 */
const PROPAGATION_CHECKLIST = [
  {
    trigger: 'Aider release with new config keys',
    targets: [
      'src/aider/techniques.js — update checks for new keys',
      'src/aider/config-parser.js — update if YAML handling changes',
      'src/aider/setup.js — update generated .aider.conf.yml template',
    ],
  },
  {
    trigger: 'New Aider model support or role changes',
    targets: [
      'src/aider/techniques.js — update model config checks',
      'src/aider/context.js — update modelRoles()',
      'src/aider/governance.js — update policy packs if needed',
    ],
  },
  {
    trigger: 'New Aider edit format or architect changes',
    targets: [
      'src/aider/techniques.js — update edit format checks',
      'src/aider/setup.js — update template comments',
    ],
  },
  {
    trigger: 'Aider CLI flag changes (renamed/removed)',
    targets: [
      'src/aider/techniques.js — update flag pattern matching',
      'src/aider/setup.js — update generated config',
      'src/aider/interactive.js — update wizard options',
    ],
  },
  {
    trigger: 'Aider domain pack definitions change',
    targets: [
      'src/aider/domain-packs.js — update pack registry',
      'src/aider/governance.js — governance export picks up changes',
    ],
  },
  {
    trigger: 'Aider chat-mode or architect/editor behavior change',
    targets: [
      'src/aider/techniques.js — update mode/architect checks',
      'src/aider/interactive.js — update mode-selection guidance',
      'src/source-urls.js — refresh Aider mode source mappings',
    ],
  },
  {
    trigger: 'Aider git integration / undo / commit behavior change',
    targets: [
      'src/aider/techniques.js — update git-safety and undo assumptions',
      'src/aider/setup.js — update git-related starter guidance',
      'src/source-urls.js — refresh Aider git source mappings',
    ],
  },
  {
    trigger: 'Aider conventions loading or persistent guidance behavior change',
    targets: [
      'src/aider/techniques.js — update conventions and always-read guidance checks',
      'src/aider/setup.js — update conventions starter comments',
      'src/source-urls.js — refresh Aider conventions source mappings',
    ],
  },
];

/**
 * Check release gate — are all P0 sources fresh?
 */
function checkReleaseGate(overrides = {}) {
  const now = new Date();
  const results = P0_SOURCES.map(source => {
    const verifiedAt = overrides[source.key] || source.verifiedAt;
    if (!verifiedAt) {
      return { ...source, status: 'unverified', daysStale: null };
    }

    const verifiedDate = new Date(verifiedAt);
    const daysSince = Math.floor((now - verifiedDate) / (1000 * 60 * 60 * 24));

    return {
      ...source,
      verifiedAt,
      status: daysSince <= source.stalenessThresholdDays ? 'fresh' : 'stale',
      daysStale: daysSince,
    };
  });

  const stale = results.filter((result) => result.status === 'stale' || result.status === 'unverified');
  const fresh = results.filter((result) => result.status === 'fresh');
  const allFresh = stale.length === 0;

  return {
    ready: allFresh,
    stale,
    fresh,
    results,
    nerviqVersion: version,
    checkedAt: now.toISOString(),
  };
}

/**
 * Format release gate for display.
 */
function formatReleaseGate(gateResult) {
  const lines = [
    `Aider Release Freshness Gate (nerviq v${version})`,
    `Status: ${gateResult.ready ? 'READY' : 'NOT READY'}`,
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
 * Get propagation targets for a given trigger.
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
