const fs = require('fs');
const os = require('os');
const path = require('path');
const { version } = require('../package.json');
const {
  resolveProjectStateReadPath,
  ensureProjectStateDir,
} = require('./state-paths');

/**
 * Generate a machine-level user identity for audit tracking.
 * Format: hostname:username — no PII, just machine identity.
 * @returns {string}
 */
function getUserId() {
  try {
    const hostname = os.hostname();
    const username = os.userInfo().username;
    return `${hostname}:${username}`;
  } catch {
    return 'unknown:unknown';
  }
}

let _lastTimestamp = '';
let _counter = 0;

function timestampId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  if (ts === _lastTimestamp) {
    _counter++;
    return `${ts}-${_counter}`;
  }
  _lastTimestamp = ts;
  _counter = 0;
  return ts;
}

function ensureArtifactDirs(dir) {
  const root = ensureProjectStateDir(dir);
  const activityDir = ensureProjectStateDir(dir, 'activity');
  const rollbackDir = ensureProjectStateDir(dir, 'rollbacks');
  const snapshotDir = ensureProjectStateDir(dir, 'snapshots');
  const outcomesDir = ensureProjectStateDir(dir, 'outcomes');
  return { root, activityDir, rollbackDir, snapshotDir, outcomesDir };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function writeActivityArtifact(dir, type, payload) {
  const id = timestampId();
  const { activityDir } = ensureArtifactDirs(dir);
  const filePath = path.join(activityDir, `${id}-${type}.json`);
  writeJson(filePath, {
    id,
    type,
    createdAt: new Date().toISOString(),
    userId: getUserId(),
    ...payload,
  });
  return {
    id,
    filePath,
    relativePath: path.relative(dir, filePath),
  };
}

function writeRollbackArtifact(dir, payload) {
  const id = timestampId();
  const { rollbackDir } = ensureArtifactDirs(dir);
  const filePath = path.join(rollbackDir, `${id}.json`);
  writeJson(filePath, {
    id,
    createdAt: new Date().toISOString(),
    userId: getUserId(),
    rollbackType: 'delete-created-files',
    ...payload,
  });
  return {
    id,
    filePath,
    relativePath: path.relative(dir, filePath),
  };
}

function summarizeSnapshot(snapshotKind, payload) {
  if (snapshotKind === 'audit') {
    return {
      score: payload.score,
      organicScore: payload.organicScore,
      passed: payload.passed,
      failed: payload.failed,
      checkCount: payload.checkCount,
      suggestedNextCommand: payload.suggestedNextCommand,
      topActionKeys: Array.isArray(payload.topNextActions)
        ? payload.topNextActions.slice(0, 3).map(item => item.key)
        : [],
    };
  }

  if (snapshotKind === 'augment' || snapshotKind === 'suggest-only') {
    return {
      score: payload.projectSummary?.score,
      organicScore: payload.projectSummary?.organicScore,
      maturity: payload.projectSummary?.maturity,
      domains: payload.projectSummary?.domains || [],
      topActionKeys: Array.isArray(payload.topNextActions)
        ? payload.topNextActions.slice(0, 3).map(item => item.key)
        : [],
    };
  }

  if (snapshotKind === 'benchmark') {
    return {
      beforeScore: payload.before?.score,
      afterScore: payload.after?.score,
      scoreDelta: payload.delta?.score,
      organicDelta: payload.delta?.organicScore,
      decisionGuidance: payload.executiveSummary?.decisionGuidance || null,
    };
  }

  if (snapshotKind === 'governance') {
    return {
      permissionProfiles: Array.isArray(payload.permissionProfiles) ? payload.permissionProfiles.length : 0,
      hooks: Array.isArray(payload.hookRegistry) ? payload.hookRegistry.length : 0,
      policyPacks: Array.isArray(payload.policyPacks) ? payload.policyPacks.length : 0,
      domainPacks: Array.isArray(payload.domainPacks) ? payload.domainPacks.length : 0,
      mcpPacks: Array.isArray(payload.mcpPacks) ? payload.mcpPacks.length : 0,
    };
  }

  return {};
}

function normalizeSnapshotTags(input) {
  const values = Array.isArray(input) ? input : (input ? [input] : []);
  const seen = new Set();
  const tags = [];

  for (const value of values) {
    const parts = `${value || ''}`
      .split(',')
      .map((item) => item.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    for (const part of parts) {
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(part.slice(0, 48));
      if (tags.length >= 8) {
        return tags;
      }
    }
  }

  return tags;
}

function formatSnapshotTags(tags = []) {
  const normalized = normalizeSnapshotTags(tags);
  if (normalized.length === 0) return '';
  return ` [${normalized.join(', ')}]`;
}

function updateSnapshotIndex(snapshotDir, record) {
  const indexPath = path.join(snapshotDir, 'index.json');
  let entries = [];

  if (fs.existsSync(indexPath)) {
    try {
      entries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      if (!Array.isArray(entries)) {
        entries = [];
      }
    } catch {
      entries = [];
    }
  }

  entries.push(record);
  // Prune to keep last 200 entries
  const MAX_INDEX_ENTRIES = 200;
  if (entries.length > MAX_INDEX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_INDEX_ENTRIES);
  }
  fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2), 'utf8');
}

/**
 * Write a normalized snapshot artifact to .nerviq/snapshots/ and update the index.
 * @param {string} dir - Project root directory.
 * @param {string} snapshotKind - Snapshot type ('audit', 'benchmark', 'governance', 'augment', 'suggest-only').
 * @param {Object} payload - Full result payload to persist.
 * @param {Object} [meta={}] - Optional metadata fields merged into the envelope.
 * @returns {Object} Artifact record with id, filePath, relativePath, indexPath, and summary.
 */
function writeSnapshotArtifact(dir, snapshotKind, payload, meta = {}) {
  const id = timestampId();
  const { snapshotDir } = ensureArtifactDirs(dir);
  const filePath = path.join(snapshotDir, `${id}-${snapshotKind}.json`);
  const summary = summarizeSnapshot(snapshotKind, payload);
  const metaTags = normalizeSnapshotTags([
    ...(Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : [])),
    ...(meta.tag ? [meta.tag] : []),
  ]);
  const { tags: _ignoredTags, tag: _ignoredTag, ...restMeta } = meta;
  const envelope = {
    schemaVersion: 1,
    artifactType: 'snapshot',
    snapshotKind,
    id,
    createdAt: new Date().toISOString(),
    userId: getUserId(),
    generatedBy: `nerviq@${version}`,
    directory: dir,
    summary,
    tags: metaTags,
    ...restMeta,
    payload,
  };

  writeJson(filePath, envelope);

  const record = {
    id,
    snapshotKind,
    createdAt: envelope.createdAt,
    relativePath: path.relative(dir, filePath),
    tags: metaTags,
    summary,
  };
  updateSnapshotIndex(snapshotDir, record);

  return {
    id,
    filePath,
    relativePath: path.relative(dir, filePath),
    indexPath: path.relative(dir, path.join(snapshotDir, 'index.json')),
    summary,
  };
}

function readSnapshotIndex(dir) {
  const indexPath = resolveProjectStateReadPath(dir, 'snapshots', 'index.json');
  if (!fs.existsSync(indexPath)) return [];
  try {
    const entries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/**
 * Get the audit score history from saved snapshots, most recent first.
 * @param {string} dir - Project root directory.
 * @param {number} [limit=20] - Maximum number of entries to return.
 * @returns {Object[]} Array of snapshot index entries for audit snapshots.
 */
function getHistory(dir, limit = 20) {
  const entries = readSnapshotIndex(dir);
  return entries
    .filter(e => e.snapshotKind === 'audit')
    .sort((a, b) => {
      const dateDiff = new Date(b.createdAt) - new Date(a.createdAt);
      if (dateDiff !== 0) return dateDiff;
      return (b.id || '').localeCompare(a.id || '');
    })
    .slice(0, limit);
}

function buildCheckDiffDetail(previousResult, currentResult) {
  const source = currentResult || previousResult || {};
  const previousState = previousResult ? previousResult.passed : undefined;
  const currentState = currentResult ? currentResult.passed : undefined;
  return {
    key: source.key,
    name: source.name || source.key,
    impact: source.impact || null,
    category: source.category || null,
    previousState,
    currentState,
  };
}

function collectCheckDiff(previousResults = [], currentResults = []) {
  const prevMap = new Map();
  const currMap = new Map();

  for (const result of previousResults) {
    if (result && result.key) prevMap.set(result.key, result);
  }
  for (const result of currentResults) {
    if (result && result.key) currMap.set(result.key, result);
  }

  const regressions = [];
  const improvements = [];
  const newlyApplicable = [];
  const noLongerApplicable = [];
  const newChecks = [];
  const removedChecks = [];

  const allKeys = [...new Set([...prevMap.keys(), ...currMap.keys()])].sort();
  for (const key of allKeys) {
    const previousResult = prevMap.get(key);
    const currentResult = currMap.get(key);
    const previousState = previousResult ? previousResult.passed : undefined;
    const currentState = currentResult ? currentResult.passed : undefined;
    const detail = buildCheckDiffDetail(previousResult, currentResult);

    if (!previousResult) {
      if (currentState !== undefined) {
        newChecks.push(detail);
      }
      continue;
    }

    if (!currentResult) {
      removedChecks.push(detail);
      continue;
    }

    if (previousState === true && currentState === false) {
      regressions.push(detail);
    } else if (previousState === false && currentState === true) {
      improvements.push(detail);
    } else if ((previousState === null || previousState === undefined) && (currentState === true || currentState === false)) {
      newlyApplicable.push(detail);
    } else if ((currentState === null || currentState === undefined) && (previousState === true || previousState === false)) {
      noLongerApplicable.push(detail);
    }
  }

  return {
    regressions,
    improvements,
    newlyApplicable,
    noLongerApplicable,
    newChecks,
    removedChecks,
  };
}

/**
 * Compare the two most recent audit snapshots and return the delta.
 * @param {string} dir - Project root directory.
 * @returns {Object|null} Comparison with current/previous scores, delta, regressions, improvements, and trend. Null if fewer than 2 snapshots.
 */
function compareLatest(dir) {
  const audits = getHistory(dir, 2);
  if (audits.length < 2) return null;

  const current = audits[0];
  const previous = audits[1];
  const currentPayload = loadSnapshotPayload(dir, current);
  const previousPayload = loadSnapshotPayload(dir, previous);

  const delta = {
    score: (current.summary?.score || 0) - (previous.summary?.score || 0),
    organic: (current.summary?.organicScore || 0) - (previous.summary?.organicScore || 0),
    passed: (current.summary?.passed || 0) - (previous.summary?.passed || 0),
  };

  let regressionDetails = [];
  let improvementDetails = [];
  let newlyApplicableDetails = [];
  let noLongerApplicableDetails = [];
  let newChecks = [];
  let removedChecks = [];
  let regressions = [];
  let improvements = [];
  let detailedDiffAvailable = false;

  if (currentPayload && previousPayload && Array.isArray(currentPayload.results) && Array.isArray(previousPayload.results)) {
    const diff = collectCheckDiff(previousPayload.results, currentPayload.results);
    regressionDetails = diff.regressions;
    improvementDetails = diff.improvements;
    newlyApplicableDetails = diff.newlyApplicable;
    noLongerApplicableDetails = diff.noLongerApplicable;
    newChecks = diff.newChecks;
    removedChecks = diff.removedChecks;
    regressions = regressionDetails.map((item) => item.key);
    improvements = improvementDetails.map((item) => item.key);
    detailedDiffAvailable = true;
  } else {
    const prevKeys = new Set(previous.summary?.topActionKeys || []);
    const currKeys = new Set(current.summary?.topActionKeys || []);
    for (const key of currKeys) {
      if (!prevKeys.has(key)) regressions.push(key);
    }
    for (const key of prevKeys) {
      if (!currKeys.has(key)) improvements.push(key);
    }
  }

  return {
    scoreType: 'audit-snapshot-score',
    current: {
      date: current.createdAt,
      score: current.summary?.score,
      passed: current.summary?.passed,
      tags: current.tags || [],
      scoreType: 'audit-snapshot-score',
    },
    previous: {
      date: previous.createdAt,
      score: previous.summary?.score,
      passed: previous.summary?.passed,
      tags: previous.tags || [],
      scoreType: 'audit-snapshot-score',
    },
    delta,
    regressions,
    improvements,
    regressionDetails,
    improvementDetails,
    newlyApplicableDetails,
    noLongerApplicableDetails,
    newChecks,
    removedChecks,
    detailedDiffAvailable,
    trend: delta.score > 0 ? 'improving' : delta.score < 0 ? 'regressing' : 'stable',
  };
}

function formatSnapshotBootstrap(dir, goal = 'history') {
  const snapshotCount = getHistory(dir, 50).length;
  const lines = [];
  const snapshotLabel = snapshotCount === 1
    ? '1 saved audit snapshot'
    : `${snapshotCount} saved audit snapshots`;

  if (goal === 'compare') {
    lines.push(snapshotCount === 0
      ? 'Compare needs 2 audit snapshots.'
      : 'Compare needs one more audit snapshot.');
  } else if (goal === 'trend') {
    lines.push(snapshotCount === 0
      ? 'Trend needs 2 audit snapshots to start.'
      : 'Trend needs one more audit snapshot to become meaningful.');
  } else {
    lines.push(snapshotCount === 0
      ? 'No audit snapshots found yet.'
      : 'History is initialized, but compare/trend still need one more snapshot.');
  }

  lines.push(`  Current state: ${snapshotLabel}.`);

  if (snapshotCount === 0) {
    lines.push('  Bootstrap it with:');
    lines.push('  1. Run `nerviq audit --snapshot --tag "baseline"` to save the baseline.');
    lines.push('  2. Make a meaningful repo change (`nerviq setup --auto` or `nerviq fix --all-critical --auto`).');
    lines.push('  3. Run `nerviq audit --snapshot --tag "after-change"` to capture the next state.');
  } else {
    lines.push('  Next:');
    lines.push('  1. Make a meaningful repo change (`nerviq setup --auto` or `nerviq fix --all-critical --auto`).');
    lines.push('  2. Run `nerviq audit --snapshot --tag "after-change"` again.');
  }

  if (goal === 'compare') {
    lines.push('  Then rerun `nerviq compare`.');
  } else if (goal === 'trend') {
    lines.push('  Then rerun `nerviq trend`.');
  } else {
    lines.push('  Then rerun `nerviq history`, `nerviq compare`, or `nerviq trend`.');
  }

  return lines.join('\n');
}

function formatHistory(dir) {
  const history = getHistory(dir, 10);
  if (history.length === 0) return formatSnapshotBootstrap(dir, 'history');

  const lines = [
    'Audit snapshot history (most recent first):',
    '  Score type: saved audit snapshot scores only (not live audits or benchmark projections).',
    '',
  ];
  for (const entry of history) {
    const dateStr = entry.createdAt || 'unknown';
    const date = dateStr.split('T')[0] || 'unknown';
    const time = dateStr.includes('T') ? dateStr.split('T')[1]?.substring(0, 5) || '' : '';
    const dateDisplay = time ? `${date} ${time}` : date;
    const score = entry.summary?.score ?? '?';
    const passed = entry.summary?.passed ?? '?';
    const total = entry.summary?.checkCount ?? '?';
    lines.push(`  ${dateDisplay}  snapshot${formatSnapshotTags(entry.tags)} ${score}/100  (${passed}/${total} checks passing)`);
  }

  const comparison = compareLatest(dir);
  if (comparison) {
    lines.push('');
    const sign = comparison.delta.score >= 0 ? '+' : '';
    lines.push(`  Latest snapshot trend: ${comparison.trend} (${sign}${comparison.delta.score} since previous snapshot)`);
    if ((comparison.previous.tags || []).length > 0 || (comparison.current.tags || []).length > 0) {
      lines.push(`  Snapshot tags: previous${formatSnapshotTags(comparison.previous.tags)} -> current${formatSnapshotTags(comparison.current.tags)}`);
    }
    if (comparison.improvements.length > 0) {
      lines.push(`  Fixed: ${comparison.improvements.join(', ')}`);
    }
    if (comparison.regressions.length > 0) {
      lines.push(`  New gaps: ${comparison.regressions.join(', ')}`);
    }
  }

  if (history.length === 1) {
    lines.push('');
    lines.push(formatSnapshotBootstrap(dir, 'history'));
  }

  return lines.join('\n');
}

function exportTrendReport(dir) {
  const history = getHistory(dir, 50);
  if (history.length === 0) return null;

  const comparison = compareLatest(dir);
  const lines = [
    '# Nerviq Audit Snapshot Trend Report',
    '',
    `**Project:** ${path.basename(dir)}`,
    `**Generated:** ${new Date().toISOString().split('T')[0]}`,
    `**Audit snapshots:** ${history.length}`,
    '',
    '## Audit Snapshot History',
    '',
    '| Date | Tags | Score | Passed | Checks |',
    '|------|------|-------|--------|--------|',
  ];

  for (const entry of history) {
    const date = entry.createdAt?.split('T')[0] || '?';
    const tags = (entry.tags || []).length > 0 ? entry.tags.join(', ') : '-';
    lines.push(`| ${date} | ${tags} | ${entry.summary?.score ?? '?'}/100 | ${entry.summary?.passed ?? '?'} | ${entry.summary?.checkCount ?? '?'} |`);
  }

  if (comparison) {
    lines.push('');
    lines.push('## Latest Comparison');
    lines.push('');
    lines.push(`- **Previous snapshot score:** ${comparison.previous.score}/100 (${comparison.previous.date?.split('T')[0]})${formatSnapshotTags(comparison.previous.tags)}`);
    lines.push(`- **Current snapshot score:** ${comparison.current.score}/100 (${comparison.current.date?.split('T')[0]})${formatSnapshotTags(comparison.current.tags)}`);
    lines.push(`- **Snapshot delta:** ${comparison.delta.score >= 0 ? '+' : ''}${comparison.delta.score} points`);
    lines.push(`- **Trend:** ${comparison.trend}`);
    if (comparison.improvements.length > 0) lines.push(`- **Fixed:** ${comparison.improvements.join(', ')}`);
    if (comparison.regressions.length > 0) lines.push(`- **New gaps:** ${comparison.regressions.join(', ')}`);
  }

  lines.push('');
  lines.push(`---`);
  lines.push(`*Generated by nerviq v${version}*`);
  return lines.join('\n');
}

function readOutcomeIndex(dir) {
  const indexPath = resolveProjectStateReadPath(dir, 'outcomes', 'index.json');
  if (!fs.existsSync(indexPath)) return [];
  try {
    const entries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

function updateOutcomeIndex(outcomesDir, record) {
  const indexPath = path.join(outcomesDir, 'index.json');
  let entries = [];

  if (fs.existsSync(indexPath)) {
    try {
      entries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      if (!Array.isArray(entries)) entries = [];
    } catch {
      entries = [];
    }
  }

  entries.push(record);
  const MAX_INDEX_ENTRIES = 500;
  if (entries.length > MAX_INDEX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_INDEX_ENTRIES);
  }
  fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2), 'utf8');
}

function normalizeOutcomeStatus(value) {
  const normalized = `${value || ''}`.trim().toLowerCase();
  if (!['accepted', 'rejected', 'deferred'].includes(normalized)) {
    throw new Error('feedback status must be one of: accepted, rejected, deferred');
  }
  return normalized;
}

function normalizeOutcomeEffect(value) {
  const normalized = `${value || ''}`.trim().toLowerCase();
  if (!['positive', 'neutral', 'negative'].includes(normalized)) {
    throw new Error('feedback effect must be one of: positive, neutral, negative');
  }
  return normalized;
}

function recordRecommendationOutcome(dir, payload) {
  const key = `${payload.key || ''}`.trim();
  if (!key) {
    throw new Error('feedback requires a recommendation key');
  }

  const status = normalizeOutcomeStatus(payload.status);
  const effect = normalizeOutcomeEffect(payload.effect || 'neutral');
  const scoreDelta = Number.isFinite(payload.scoreDelta) ? payload.scoreDelta : (
    payload.scoreDelta === null || payload.scoreDelta === undefined || payload.scoreDelta === ''
      ? null
      : Number(payload.scoreDelta)
  );

  if (scoreDelta !== null && !Number.isFinite(scoreDelta)) {
    throw new Error('feedback scoreDelta must be a number when provided');
  }

  const id = timestampId();
  const { outcomesDir } = ensureArtifactDirs(dir);
  const filePath = path.join(outcomesDir, `${id}.json`);
  const record = {
    id,
    createdAt: new Date().toISOString(),
    key,
    status,
    effect,
    source: `${payload.source || 'manual-cli'}`.trim() || 'manual-cli',
    notes: `${payload.notes || ''}`.trim(),
    scoreDelta,
  };

  writeJson(filePath, record);
  updateOutcomeIndex(outcomesDir, {
    ...record,
    relativePath: path.relative(dir, filePath),
  });

  return {
    id,
    filePath,
    relativePath: path.relative(dir, filePath),
    record,
  };
}

function summarizeOutcomeEntries(entries = []) {
  const byKey = {};

  for (const entry of entries) {
    if (!entry || !entry.key) continue;
    const bucket = byKey[entry.key] || {
      key: entry.key,
      total: 0,
      accepted: 0,
      rejected: 0,
      deferred: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      scoreDeltaTotal: 0,
      scoreDeltaCount: 0,
      latestAt: null,
    };

    bucket.total += 1;
    if (bucket[entry.status] !== undefined) bucket[entry.status] += 1;
    if (bucket[entry.effect] !== undefined) bucket[entry.effect] += 1;
    if (Number.isFinite(entry.scoreDelta)) {
      bucket.scoreDeltaTotal += entry.scoreDelta;
      bucket.scoreDeltaCount += 1;
    }
    if (!bucket.latestAt || new Date(entry.createdAt) > new Date(bucket.latestAt)) {
      bucket.latestAt = entry.createdAt;
    }

    byKey[entry.key] = bucket;
  }

  for (const bucket of Object.values(byKey)) {
    bucket.avgScoreDelta = bucket.scoreDeltaCount > 0
      ? Number((bucket.scoreDeltaTotal / bucket.scoreDeltaCount).toFixed(2))
      : null;
    bucket.evidenceClass = bucket.total > 0 ? 'measured' : 'estimated';
  }

  return {
    totalEntries: entries.length,
    byKey,
    keys: Object.keys(byKey).sort(),
  };
}

function getRecommendationOutcomeSummary(dir) {
  return summarizeOutcomeEntries(readOutcomeIndex(dir));
}

function getRecommendationAdjustment(summaryByKey, key) {
  const bucket = summaryByKey && summaryByKey[key];
  if (!bucket) return 0;

  let adjustment = 0;
  adjustment += bucket.accepted * 2;
  adjustment += bucket.positive * 3;
  adjustment -= bucket.rejected * 3;
  adjustment -= bucket.negative * 4;

  if (Number.isFinite(bucket.avgScoreDelta)) {
    if (bucket.avgScoreDelta > 0) adjustment += Math.min(4, Math.round(bucket.avgScoreDelta / 4));
    if (bucket.avgScoreDelta < 0) adjustment -= Math.min(4, Math.round(Math.abs(bucket.avgScoreDelta) / 4));
  }

  if (adjustment > 8) return 8;
  if (adjustment < -8) return -8;
  return adjustment;
}

function formatRecommendationOutcomeSummary(dir) {
  const summary = getRecommendationOutcomeSummary(dir);
  if (summary.totalEntries === 0) {
    return 'No recommendation outcomes recorded yet. Use `npx nerviq feedback --key permissionDeny --status accepted --effect positive` after a real run.';
  }

  const lines = [
    'Recommendation outcome summary:',
    '',
  ];

  for (const key of summary.keys) {
    const bucket = summary.byKey[key];
    const avg = Number.isFinite(bucket.avgScoreDelta) ? ` | avg score delta ${bucket.avgScoreDelta >= 0 ? '+' : ''}${bucket.avgScoreDelta}` : '';
    const adjustment = getRecommendationAdjustment(summary.byKey, key);
    lines.push(`  ${key}: total ${bucket.total} | accepted ${bucket.accepted} | rejected ${bucket.rejected} | deferred ${bucket.deferred} | positive ${bucket.positive} | negative ${bucket.negative}${avg} | ranking ${adjustment >= 0 ? '+' : ''}${adjustment}`);
  }

  return lines.join('\n');
}

/**
 * Load the full payload of a snapshot by its index entry.
 * @param {string} dir - Project root directory.
 * @param {Object} indexEntry - Snapshot index entry with relativePath.
 * @returns {Object|null} Full snapshot envelope, or null if unreadable.
 */
function loadSnapshotPayload(dir, indexEntry) {
  if (!indexEntry || !indexEntry.relativePath) return null;
  const filePath = path.join(dir, indexEntry.relativePath);
  try {
    const envelope = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return envelope.payload || null;
  } catch {
    return null;
  }
}

/**
 * Analyze check health by comparing the two most recent audit snapshots.
 * Detects checks that regressed (passed → failed), improved (failed → passed),
 * and flags sudden drops that may indicate platform format changes.
 * When more than 2 snapshots exist, also computes per-check pass rates.
 *
 * @param {string} dir - Project root directory.
 * @returns {Object|null} Health report, or null if fewer than 2 audit snapshots exist.
 */
function checkHealth(dir) {
  const history = getHistory(dir, 20);
  if (history.length < 2) return null;

  const currentPayload = loadSnapshotPayload(dir, history[0]);
  const previousPayload = loadSnapshotPayload(dir, history[1]);
  if (!currentPayload || !previousPayload) return null;

  const currentResults = currentPayload.results || [];
  const previousResults = previousPayload.results || [];
  const diff = collectCheckDiff(previousResults, currentResults);
  const regressions = diff.regressions;
  const improvements = diff.improvements;
  const newChecks = diff.newChecks;
  const removedChecks = diff.removedChecks;

  // Detect potential platform format changes:
  // If 3+ checks in the same category regressed, flag it
  const regressionsByCategory = {};
  for (const r of regressions) {
    if (!regressionsByCategory[r.category]) regressionsByCategory[r.category] = [];
    regressionsByCategory[r.category].push(r);
  }
  const platformAlerts = [];
  for (const [cat, items] of Object.entries(regressionsByCategory)) {
    if (items.length >= 3) {
      platformAlerts.push({
        category: cat,
        regressionCount: items.length,
        message: `${items.length} checks in '${cat}' regressed — possible platform format change`,
        checks: items.map(i => i.key),
      });
    }
  }

  // Per-check pass rates across all snapshots
  const passRates = computePassRates(dir, history);

  return {
    currentDate: history[0].createdAt,
    previousDate: history[1].createdAt,
    snapshotsAnalyzed: history.length,
    scoreDelta: (currentPayload.score || 0) - (previousPayload.score || 0),
    regressions,
    improvements,
    newChecks,
    removedChecks,
    platformAlerts,
    passRates,
    summary: {
      regressionsCount: regressions.length,
      improvementsCount: improvements.length,
      newChecksCount: newChecks.length,
      removedChecksCount: removedChecks.length,
      alertsCount: platformAlerts.length,
    },
  };
}

/**
 * Compute per-check pass rates across all snapshots.
 * Returns { declining, consistentlyFailing, consistentlyPassing, overallHealth }.
 */
function computePassRates(dir, history) {
  // key → { passes, total, recentResults: [bool...] (newest first) }
  const stats = {};
  for (const entry of history) {
    const payload = loadSnapshotPayload(dir, entry);
    if (!payload || !payload.results) continue;
    for (const r of payload.results) {
      if (!r.key || r.passed === null || r.passed === undefined) continue;
      if (!stats[r.key]) stats[r.key] = { name: r.name, passes: 0, total: 0, recentResults: [] };
      stats[r.key].total++;
      if (r.passed) stats[r.key].passes++;
      stats[r.key].recentResults.push(!!r.passed);
    }
  }

  const declining = [];
  const consistentlyFailing = [];
  let consistentlyPassingCount = 0;
  let totalChecks = 0;
  let totalPasses = 0;
  let totalAppearances = 0;

  for (const [key, s] of Object.entries(stats)) {
    const rate = s.total > 0 ? s.passes / s.total : 0;
    totalChecks++;
    totalPasses += s.passes;
    totalAppearances += s.total;

    if (s.total >= 2 && rate === 0) {
      consistentlyFailing.push({ key, name: s.name, runs: s.total });
    } else if (rate === 1) {
      consistentlyPassingCount++;
    } else if (s.total >= 2) {
      // Check if declining: earlier results passed, recent ones failed
      const half = Math.ceil(s.recentResults.length / 2);
      const recentHalf = s.recentResults.slice(0, half);
      const olderHalf = s.recentResults.slice(half);
      const recentRate = recentHalf.filter(Boolean).length / recentHalf.length;
      const olderRate = olderHalf.length > 0 ? olderHalf.filter(Boolean).length / olderHalf.length : recentRate;
      if (olderRate > recentRate) {
        const failStreak = s.recentResults.findIndex(v => v === true);
        declining.push({
          key, name: s.name,
          oldRate: Math.round(olderRate * 100),
          newRate: Math.round(recentRate * 100),
          failingRuns: failStreak === -1 ? s.recentResults.length : failStreak,
        });
      }
    }
  }

  const overallHealth = totalAppearances > 0 ? Math.round((totalPasses / totalAppearances) * 100) : 100;

  return { declining, consistentlyFailing, consistentlyPassingCount, overallHealth };
}

/**
 * Format check-health report for CLI display.
 */
function formatCheckHealth(healthReport) {
  if (!healthReport) return 'Need at least 2 audit snapshots. Run `nerviq audit --snapshot` twice.';

  const lines = [];
  const { scoreDelta, regressions, improvements, platformAlerts, newChecks, passRates } = healthReport;
  const sign = scoreDelta >= 0 ? '+' : '';

  lines.push(`  Check Health Report`);
  lines.push(`  ═══════════════════════════════════════`);
  lines.push(`  Snapshots analyzed: ${healthReport.snapshotsAnalyzed}`);
  lines.push(`  Period: ${healthReport.previousDate?.split('T')[0]} → ${healthReport.currentDate?.split('T')[0]}`);
  lines.push(`  Score delta: ${sign}${scoreDelta}`);
  lines.push('');

  if (platformAlerts.length > 0) {
    lines.push(`  ⚠️  PLATFORM ALERTS (${platformAlerts.length})`);
    for (const alert of platformAlerts) {
      lines.push(`     ${alert.message}`);
      lines.push(`     Checks: ${alert.checks.join(', ')}`);
    }
    lines.push('');
  }

  if (passRates && passRates.declining.length > 0) {
    lines.push(`  Checks with declining pass rate:`);
    for (const d of passRates.declining) {
      const detail = d.failingRuns > 0 ? `(failing in last ${d.failingRuns} runs)` : '';
      lines.push(`  ⚠ ${d.key.padEnd(22)} ${d.oldRate}% → ${d.newRate}%  ${detail}`);
    }
    lines.push('');
  }

  if (passRates && passRates.consistentlyFailing.length > 0) {
    lines.push(`  Consistently failing (0% pass rate):`);
    for (const f of passRates.consistentlyFailing) {
      lines.push(`  ✗ ${f.key.padEnd(22)} 0/${f.runs} runs`);
    }
    lines.push('');
  }

  if (regressions.length > 0) {
    lines.push(`  🔴 Regressions (${regressions.length} checks now failing)`);
    for (const r of regressions) {
      lines.push(`     ${r.name} [${r.impact}]`);
    }
    lines.push('');
  }

  if (improvements.length > 0) {
    lines.push(`  ✅ Improvements (${improvements.length} checks now passing)`);
    for (const r of improvements) {
      lines.push(`     ${r.name}`);
    }
    lines.push('');
  }

  if (newChecks.length > 0) {
    lines.push(`  🆕 New checks (${newChecks.length})`);
    lines.push('');
  }

  if (passRates && passRates.consistentlyPassingCount > 0) {
    lines.push(`  Consistently passing (100%):`);
    lines.push(`  ✓ ${passRates.consistentlyPassingCount} checks at 100% pass rate`);
    lines.push('');
  }

  if (regressions.length === 0 && platformAlerts.length === 0) {
    lines.push(`  ✅ All checks stable. No regressions detected.`);
    lines.push('');
  }

  if (passRates) {
    lines.push(`  Overall health: ${passRates.overallHealth}%`);
  }

  return lines.join('\n');
}

module.exports = {
  getUserId,
  ensureArtifactDirs,
  writeActivityArtifact,
  writeRollbackArtifact,
  writeSnapshotArtifact,
  normalizeSnapshotTags,
  formatSnapshotTags,
  readSnapshotIndex,
  getHistory,
  compareLatest,
  formatSnapshotBootstrap,
  formatHistory,
  exportTrendReport,
  readOutcomeIndex,
  recordRecommendationOutcome,
  summarizeOutcomeEntries,
  getRecommendationOutcomeSummary,
  getRecommendationAdjustment,
  formatRecommendationOutcomeSummary,
  checkHealth,
  formatCheckHealth,
  loadSnapshotPayload,
};
