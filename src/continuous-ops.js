'use strict';

const fs = require('fs');
const path = require('path');
const { version } = require('../package.json');
const {
  ensureProjectStateDir,
  resolveProjectStateReadPath,
  resolveProjectStatePath,
} = require('./state-paths');

const WATCH_CLASS_DEFS = {
  'config-drift': {
    key: 'config-drift',
    label: 'Config drift',
    disposition: 'block',
    description: 'Repo instructions, config, hooks, rules, or verification surfaces drifted away from the managed baseline.',
  },
  'policy-drift': {
    key: 'policy-drift',
    label: 'Policy drift',
    disposition: 'block',
    description: 'Safety, permissions, secrets, or trust controls drifted and should be treated as blocking.',
  },
  'platform-drift': {
    key: 'platform-drift',
    label: 'Platform drift',
    disposition: 'warn',
    description: 'The active tool/platform posture changed and should be reviewed before it silently alters repo behavior.',
  },
  'maturity-opportunity': {
    key: 'maturity-opportunity',
    label: 'Maturity opportunity',
    disposition: 'suggest',
    description: 'A safe improvement is available, but it should not block delivery.',
  },
};

const CONTINUOUS_CLASS_ORDER = ['policy-drift', 'config-drift', 'platform-drift', 'maturity-opportunity'];
const CONTINUOUS_DISPOSITION_ORDER = { block: 3, warn: 2, suggest: 1 };
const IMPACT_ORDER = { critical: 4, high: 3, medium: 2, low: 1 };
const EXCEPTION_SCOPES = ['all', 'ci', 'watch', 'pr'];

const MANAGED_BASELINE_DIR = 'managed';
const EXCEPTIONS_DIR = 'exceptions';
const MANAGED_BASELINE_FILE = 'baseline.json';
const EXCEPTIONS_INDEX_FILE = 'index.json';

const POLICY_CATEGORIES = new Set(['security', 'trust']);
const CONFIG_CATEGORIES = new Set([
  'memory',
  'instructions',
  'config',
  'rules',
  'hooks',
  'workflow',
  'automation',
  'quality',
  'quality-deep',
  'git',
  'tools',
  'mcp',
  'local',
  'review',
  'hygiene',
  'devops',
]);
const PLATFORM_CATEGORIES = new Set(['features', 'freshness']);
const MATURITY_CATEGORIES = new Set(['skills', 'agents', 'design', 'performance', 'prompting']);

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function ensureManagedDir(dir) {
  return ensureProjectStateDir(dir, MANAGED_BASELINE_DIR);
}

function ensureExceptionsDir(dir) {
  return ensureProjectStateDir(dir, EXCEPTIONS_DIR);
}

function getManagedBaselinePath(dir) {
  return resolveProjectStatePath(dir, MANAGED_BASELINE_DIR, MANAGED_BASELINE_FILE);
}

function getExceptionsIndexPath(dir) {
  return resolveProjectStatePath(dir, EXCEPTIONS_DIR, EXCEPTIONS_INDEX_FILE);
}

function normalizeExceptionScope(value) {
  const normalized = `${value || 'all'}`.trim().toLowerCase();
  if (!EXCEPTION_SCOPES.includes(normalized)) {
    throw new Error(`exception scope must be one of: ${EXCEPTION_SCOPES.join(', ')}`);
  }
  return normalized;
}

function normalizeExpiry(value) {
  const raw = `${value || ''}`.trim();
  if (!raw) {
    throw new Error('exception expires value is required');
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error('exception expires must be a valid ISO date or date-time');
  }

  return date.toISOString();
}

function isExpired(record, now = new Date()) {
  if (!record || !record.expiresAt) return false;
  const expiry = new Date(record.expiresAt);
  if (Number.isNaN(expiry.getTime())) return false;
  return expiry.getTime() < now.getTime();
}

function getExceptionStatus(record, now = new Date()) {
  return isExpired(record, now) ? 'expired' : 'active';
}

function normalizeExceptionRecord(record, now = new Date()) {
  if (!record || typeof record !== 'object') return null;
  return {
    ...record,
    scope: normalizeExceptionScope(record.scope || 'all'),
    status: getExceptionStatus(record, now),
  };
}

function readManagedBaseline(dir) {
  const filePath = resolveProjectStateReadPath(dir, MANAGED_BASELINE_DIR, MANAGED_BASELINE_FILE);
  const payload = readJsonSafe(filePath);
  return payload && typeof payload === 'object' ? payload : null;
}

function writeManagedBaseline(dir, payload) {
  ensureManagedDir(dir);
  const filePath = getManagedBaselinePath(dir);
  writeJson(filePath, payload);
  return {
    filePath,
    relativePath: path.relative(dir, filePath),
    payload,
  };
}

function listExceptions(dir, now = new Date()) {
  const filePath = resolveProjectStateReadPath(dir, EXCEPTIONS_DIR, EXCEPTIONS_INDEX_FILE);
  const entries = readJsonSafe(filePath);
  if (!Array.isArray(entries)) return [];
  return entries
    .map((record) => normalizeExceptionRecord(record, now))
    .filter(Boolean)
    .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

function writeExceptions(dir, records) {
  ensureExceptionsDir(dir);
  const filePath = getExceptionsIndexPath(dir);
  writeJson(filePath, records);
  return {
    filePath,
    relativePath: path.relative(dir, filePath),
  };
}

function addException(dir, payload, now = new Date()) {
  const key = `${payload.key || ''}`.trim();
  const watchClass = `${payload.watchClass || ''}`.trim().toLowerCase();
  if (!key && !watchClass) {
    throw new Error('exception add requires --key or --class');
  }
  if (watchClass && !WATCH_CLASS_DEFS[watchClass]) {
    throw new Error(`exception class must be one of: ${Object.keys(WATCH_CLASS_DEFS).join(', ')}`);
  }

  const owner = `${payload.owner || ''}`.trim();
  const reason = `${payload.reason || ''}`.trim();
  if (!owner) throw new Error('exception add requires --owner');
  if (!reason) throw new Error('exception add requires --reason');

  const record = {
    id: timestampId(),
    createdAt: now.toISOString(),
    createdBy: payload.createdBy || 'unknown:unknown',
    key: key || null,
    watchClass: watchClass || null,
    scope: normalizeExceptionScope(payload.scope || 'all'),
    owner,
    reason,
    expiresAt: normalizeExpiry(payload.expiresAt),
  };

  const records = listExceptions(dir, now).map((item) => ({
    id: item.id,
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    key: item.key || null,
    watchClass: item.watchClass || null,
    scope: item.scope || 'all',
    owner: item.owner,
    reason: item.reason,
    expiresAt: item.expiresAt,
  }));
  records.push(record);
  const writeResult = writeExceptions(dir, records);
  return {
    record: normalizeExceptionRecord(record, now),
    ...writeResult,
  };
}

function pruneExpiredExceptions(dir, now = new Date()) {
  const records = listExceptions(dir, now);
  const kept = records.filter((record) => record.status !== 'expired').map((item) => ({
    id: item.id,
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    key: item.key || null,
    watchClass: item.watchClass || null,
    scope: item.scope || 'all',
    owner: item.owner,
    reason: item.reason,
    expiresAt: item.expiresAt,
  }));
  const expired = records.filter((record) => record.status === 'expired');
  const writeResult = writeExceptions(dir, kept);
  return {
    removedCount: expired.length,
    keptCount: kept.length,
    removed: expired,
    ...writeResult,
  };
}

function formatExceptionTarget(record) {
  if (record.key && record.watchClass) {
    return `${record.key} + ${record.watchClass}`;
  }
  return record.key || record.watchClass || 'unknown';
}

function formatExceptionsList(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return 'No Nerviq exceptions recorded. Use `nerviq exception add --key permissionDeny --owner team --reason "migration in progress" --expires 2026-05-01`.';
  }

  const lines = [
    'Nerviq exceptions:',
    '',
  ];

  for (const record of records) {
    lines.push(`  ${record.status === 'active' ? '•' : '!' } ${formatExceptionTarget(record)} [${record.status}]`);
    lines.push(`    owner=${record.owner} | scope=${record.scope} | expires=${record.expiresAt}`);
    lines.push(`    reason=${record.reason}`);
  }

  return lines.join('\n');
}

function buildManagedBaselineRecord({
  dir,
  platform,
  auditResult,
  analysisReport,
  snapshotArtifact,
  currentPlatforms = [],
}) {
  const operatingProfile = analysisReport?.recommendedOperatingProfile || {};
  const adoptionGuidance = analysisReport?.adoptionGuidance || {};
  return {
    schemaVersion: 1,
    artifactType: 'managed-baseline',
    generatedBy: `nerviq@${version}`,
    createdAt: new Date().toISOString(),
    directory: dir,
    platform,
    detectedPlatforms: currentPlatforms,
    projectSummary: analysisReport?.projectSummary || {
      name: path.basename(dir),
      score: auditResult?.score ?? null,
      operatingProfile: operatingProfile.label || null,
      adoptionPlan: adoptionGuidance?.summary?.label || null,
    },
    baselineAudit: {
      scoreType: 'audit-snapshot-score',
      score: auditResult?.score ?? null,
      organicScore: auditResult?.organicScore ?? null,
      passed: auditResult?.passed ?? null,
      failed: auditResult?.failed ?? null,
      checkCount: auditResult?.checkCount ?? null,
      snapshotId: snapshotArtifact?.id || null,
      snapshotPath: snapshotArtifact?.relativePath || null,
      milestone: 'baseline',
      tags: ['baseline'],
    },
    operatingProfile: {
      label: operatingProfile.label || null,
      permissionProfile: operatingProfile.permissionProfile?.key || null,
      governancePack: operatingProfile.governancePack?.key || null,
      ciShape: operatingProfile.ciShape?.key || null,
      hookKeys: Array.isArray(operatingProfile.hooks) ? operatingProfile.hooks.map((item) => item.key) : [],
      verification: operatingProfile.verification?.required || [],
    },
    adoptionPlan: adoptionGuidance?.summary?.label || null,
    repoArchetype: analysisReport?.repoArchetype?.key || analysisReport?.projectSummary?.archetype || null,
    watchContract: {
      blockingClasses: ['policy-drift', 'config-drift'],
      warningClasses: ['platform-drift'],
      suggestionClasses: ['maturity-opportunity'],
    },
  };
}

function formatManagedBaselineStatus(dir, baseline = readManagedBaseline(dir)) {
  if (!baseline) {
    return [
      'No managed Nerviq baseline exists yet.',
      '  Next:',
      '  1. Run `nerviq baseline init` to lock the first managed checkpoint.',
      '  2. Use `nerviq audit --diff-only --drift-mode ci` in PRs/CI.',
      '  3. Use `nerviq watch` locally for continuous drift monitoring.',
    ].join('\n');
  }

  const lines = [
    'Managed Nerviq baseline:',
    `  Project: ${baseline.projectSummary?.name || path.basename(dir)}`,
    `  Score: ${baseline.baselineAudit?.score ?? '?'} / 100`,
    `  Snapshot: ${baseline.baselineAudit?.snapshotPath || 'n/a'}`,
    `  Operating profile: ${baseline.operatingProfile?.label || 'n/a'}`,
    `  Adoption plan: ${baseline.adoptionPlan || 'n/a'}`,
    `  Active platforms at baseline: ${(baseline.detectedPlatforms || []).join(', ') || 'none detected'}`,
    `  Blocking classes: ${(baseline.watchContract?.blockingClasses || []).join(', ')}`,
    `  Warning classes: ${(baseline.watchContract?.warningClasses || []).join(', ')}`,
    `  Suggestion classes: ${(baseline.watchContract?.suggestionClasses || []).join(', ')}`,
  ];

  return lines.join('\n');
}

function classifyContinuousItem(item) {
  const key = `${item?.key || ''}`.toLowerCase();
  const category = `${item?.category || ''}`.toLowerCase();
  const name = `${item?.name || ''}`.toLowerCase();
  const fix = `${item?.fix || ''}`.toLowerCase();

  if (
    POLICY_CATEGORIES.has(category) ||
    /\b(permission|deny|secret|trust|sandbox|approval|security|protect)\b/.test(key) ||
    /\b(secret|permission|deny|trust|approval|security)\b/.test(name) ||
    /\b(secret|permission|deny|trust|approval|security)\b/.test(fix)
  ) {
    return 'policy-drift';
  }

  if (
    PLATFORM_CATEGORIES.has(category) ||
    /\b(freshness|deprecated|legacy|migration|platform)\b/.test(key) ||
    /\b(freshness|deprecated|legacy|migration|platform)\b/.test(name)
  ) {
    return 'platform-drift';
  }

  if (
    MATURITY_CATEGORIES.has(category) ||
    /\b(skill|agent|subagent|fewshot|mermaid|role|context|compaction|design)\b/.test(key) ||
    /\b(skill|agent|subagent|architecture diagram|context management|design)\b/.test(name)
  ) {
    return 'maturity-opportunity';
  }

  if (CONFIG_CATEGORIES.has(category)) {
    return 'config-drift';
  }

  return item?.impact === 'low' ? 'maturity-opportunity' : 'config-drift';
}

function getContinuousSourceItems(auditResult) {
  if (Array.isArray(auditResult?.topNextActions) && auditResult.topNextActions.length > 0) {
    return auditResult.topNextActions.map((item) => ({
      key: item.key,
      name: item.name,
      impact: item.impact,
      category: item.category,
      fix: item.fix,
      source: 'top-next-action',
    }));
  }

  return (auditResult?.results || [])
    .filter((item) => item && item.passed === false)
    .sort((a, b) => (IMPACT_ORDER[b.impact] || 0) - (IMPACT_ORDER[a.impact] || 0))
    .slice(0, 10)
    .map((item) => ({
      key: item.key,
      name: item.name,
      impact: item.impact,
      category: item.category,
      fix: item.fix,
      source: 'failed-check',
    }));
}

function buildPlatformDriftItems(baseline, currentPlatforms = []) {
  if (!baseline) return [];
  const previous = new Set(baseline.detectedPlatforms || []);
  const current = new Set(currentPlatforms || []);
  const added = [...current].filter((item) => !previous.has(item));
  const removed = [...previous].filter((item) => !current.has(item));
  if (added.length === 0 && removed.length === 0) return [];

  return [{
    key: 'platformSetChanged',
    name: 'Active platform set changed since the managed baseline',
    impact: 'medium',
    category: 'freshness',
    fix: `Baseline platforms: ${(baseline.detectedPlatforms || []).join(', ') || 'none'}; current: ${currentPlatforms.join(', ') || 'none'}. Review Harmony and refresh the managed baseline if this is intentional.`,
    source: 'managed-baseline',
    watchClass: 'platform-drift',
  }];
}

function buildBaselineMissingItem() {
  return {
    key: 'managedBaselineMissing',
    name: 'Managed Nerviq baseline has not been initialized yet',
    impact: 'medium',
    category: 'workflow',
    fix: 'Run `nerviq baseline init` so CI/PR drift mode has a stable operational reference.',
    source: 'continuous-ops',
    watchClass: 'maturity-opportunity',
  };
}

function matchesException(record, item, mode) {
  if (!record || record.status !== 'active') return false;
  if (record.scope !== 'all' && record.scope !== mode) return false;
  if (record.key && record.key === item.key) return true;
  if (record.watchClass && record.watchClass === item.watchClass) return true;
  return false;
}

function dedupeItems(items) {
  const seen = new Set();
  const ordered = [];
  for (const item of items) {
    const key = `${item.watchClass}:${item.key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(item);
  }
  return ordered;
}

function groupContinuousItems(items) {
  const groups = CONTINUOUS_CLASS_ORDER.map((key) => ({
    ...WATCH_CLASS_DEFS[key],
    count: 0,
    effectiveCount: 0,
    exceptedCount: 0,
    items: [],
  }));
  const byKey = new Map(groups.map((group) => [group.key, group]));

  for (const item of items) {
    const group = byKey.get(item.watchClass || 'config-drift');
    if (!group) continue;
    group.count += 1;
    if (item.exception) {
      group.exceptedCount += 1;
    } else {
      group.effectiveCount += 1;
    }
    group.items.push(item);
  }

  for (const group of groups) {
    group.items.sort((a, b) => {
      if ((a.exception ? 1 : 0) !== (b.exception ? 1 : 0)) {
        return (a.exception ? 1 : 0) - (b.exception ? 1 : 0);
      }
      return (IMPACT_ORDER[b.impact] || 0) - (IMPACT_ORDER[a.impact] || 0);
    });
  }

  return groups.filter((group) => group.count > 0);
}

function selectSuggestedCampaigns(campaigns = [], groups = []) {
  const activeFocus = new Set(
    groups
      .filter((group) => group.effectiveCount > 0)
      .map((group) => group.key),
  );

  if (activeFocus.size === 0) return [];

  return campaigns.filter((campaign) => {
    const focusAreas = Array.isArray(campaign.focusAreas) ? campaign.focusAreas : [];
    return focusAreas.some((key) => activeFocus.has(key));
  });
}

function buildContinuousStatus({
  dir,
  auditResult,
  mode = 'watch',
  baseline = readManagedBaseline(dir),
  exceptions = listExceptions(dir),
  currentPlatforms = [],
  campaigns = [],
}) {
  const normalizedMode = ['ci', 'pr', 'watch'].includes(mode) ? mode : 'watch';
  const activeExceptions = exceptions.filter((record) => record.status === 'active');
  const expiredExceptions = exceptions.filter((record) => record.status === 'expired');

  const sourceItems = getContinuousSourceItems(auditResult).map((item) => ({
    ...item,
    watchClass: classifyContinuousItem(item),
  }));
  const platformItems = buildPlatformDriftItems(baseline, currentPlatforms);
  const items = baseline
    ? [...sourceItems, ...platformItems]
    : [buildBaselineMissingItem(), ...sourceItems, ...platformItems];

  const withExceptions = dedupeItems(items).map((item) => {
    const exception = activeExceptions.find((record) => matchesException(record, item, normalizedMode));
    return exception ? { ...item, exception } : item;
  });

  const groups = groupContinuousItems(withExceptions);
  const suggestedCampaigns = selectSuggestedCampaigns(campaigns, groups);
  const blockingCount = groups
    .filter((group) => group.disposition === 'block')
    .reduce((sum, group) => sum + group.effectiveCount, 0);
  const blockingKeys = groups
    .filter((group) => group.disposition === 'block')
    .flatMap((group) => group.items
      .filter((item) => !item.exception)
      .map((item) => item.key))
    .filter(Boolean);
  const warningCount = groups
    .filter((group) => group.disposition === 'warn')
    .reduce((sum, group) => sum + group.effectiveCount, 0);
  const suggestionCount = groups
    .filter((group) => group.disposition === 'suggest')
    .reduce((sum, group) => sum + group.effectiveCount, 0);

  let gate = 'pass';
  if (blockingCount > 0 || expiredExceptions.length > 0) {
    gate = 'fail';
  } else if (warningCount > 0 || !baseline) {
    gate = 'warn';
  }

  const gateLabel = gate === 'fail'
    ? 'blocking drift detected'
    : gate === 'warn'
      ? 'review recommended'
      : 'managed posture stable';

  return {
    mode: normalizedMode,
    gate,
    gateLabel,
    baselinePresent: Boolean(baseline),
    baseline: baseline ? {
      createdAt: baseline.createdAt,
      score: baseline.baselineAudit?.score ?? null,
      snapshotPath: baseline.baselineAudit?.snapshotPath || null,
      operatingProfile: baseline.operatingProfile?.label || null,
    } : null,
    blockingCount,
    blockingKeys,
    warningCount,
    suggestionCount,
    appliedExceptionCount: withExceptions.filter((item) => item.exception).length,
    expiredExceptionCount: expiredExceptions.length,
    expiredExceptions,
    classes: groups,
    suggestedCampaigns: suggestedCampaigns.map((campaign) => ({
      key: campaign.key,
      label: campaign.label,
      summary: campaign.summary,
      proposalIds: campaign.proposalIds,
    })),
    nextSteps: [
      !baseline ? 'Run `nerviq baseline init` to create the first managed checkpoint.' : null,
      gate === 'fail' ? 'Run `nerviq plan --campaign governance-hardening --campaign verification-closure` or review the blocking drift items manually.' : null,
      gate !== 'fail' && suggestedCampaigns.length > 0 ? `Consider \`${suggestedCampaigns.slice(0, 2).map((campaign) => `nerviq plan --campaign ${campaign.key}`).join('` and `')}\`.` : null,
      expiredExceptions.length > 0 ? 'Run `nerviq exception prune` or renew the expired exception with a fresh owner/reason/expiry.' : null,
    ].filter(Boolean),
  };
}

function formatContinuousStatus(report, options = {}) {
  if (!report) return '';
  if (options.compact) {
    const blockLabel = report.blockingCount > 0 && Array.isArray(report.blockingKeys) && report.blockingKeys.length > 0
      ? `block=${report.blockingCount} [${report.blockingKeys.slice(0, 3).join(', ')}${report.blockingKeys.length > 3 ? ', ...' : ''}]`
      : `block=${report.blockingCount}`;
    const parts = [
      `gate=${report.gate}`,
      blockLabel,
      `warn=${report.warningCount}`,
      `suggest=${report.suggestionCount}`,
    ];
    if (report.appliedExceptionCount > 0) {
      parts.push(`excepted=${report.appliedExceptionCount}`);
    }
    if (report.expiredExceptionCount > 0) {
      parts.push(`expired-exceptions=${report.expiredExceptionCount}`);
    }
    return `  Continuous status (${report.mode}): ${parts.join(' | ')}`;
  }

  const lines = [
    `  Continuous operating mode (${report.mode})`,
    '  ─────────────────────────────────────',
    `  Gate: ${report.gate.toUpperCase()} — ${report.gateLabel}`,
    report.baselinePresent
      ? `  Managed baseline: ${report.baseline.score ?? '?'} / 100 (${report.baseline.snapshotPath || 'snapshot unavailable'})`
      : '  Managed baseline: missing',
  ];

  for (const group of report.classes) {
    lines.push(`  ${group.label}: ${group.effectiveCount}/${group.count} active (${group.disposition})`);
    for (const item of group.items.slice(0, 4)) {
      const suffix = item.exception
        ? ` [excepted by ${item.exception.owner} until ${item.exception.expiresAt.split('T')[0]}]`
        : '';
      lines.push(`    - ${item.key} [${item.impact || 'n/a'}]${suffix}`);
    }
  }

  if (report.expiredExceptionCount > 0) {
    lines.push(`  Expired exceptions: ${report.expiredExceptionCount}`);
  }

  if (Array.isArray(report.suggestedCampaigns) && report.suggestedCampaigns.length > 0) {
    lines.push('  Suggested campaigns:');
    for (const campaign of report.suggestedCampaigns.slice(0, 3)) {
      lines.push(`    - ${campaign.key}: ${campaign.summary}`);
    }
  }

  if (report.nextSteps.length > 0) {
    lines.push('  Next:');
    for (const step of report.nextSteps) {
      lines.push(`    - ${step}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  WATCH_CLASS_DEFS,
  CONTINUOUS_CLASS_ORDER,
  buildManagedBaselineRecord,
  readManagedBaseline,
  writeManagedBaseline,
  formatManagedBaselineStatus,
  listExceptions,
  addException,
  pruneExpiredExceptions,
  formatExceptionsList,
  buildContinuousStatus,
  formatContinuousStatus,
  normalizeExceptionScope,
};
