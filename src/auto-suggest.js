const { loadPatterns } = require('./usage-patterns');
const { readSnapshotIndex } = require('./activity');

const MIN_EVENTS = 2;
const SUPPRESS_THRESHOLD = 3;
const RECENT_AUDITS = 10;

/**
 * Analyze usage patterns and audit history to suggest rules.
 */
function analyzeSuggestions(dir) {
  const patterns = loadPatterns(dir);
  const snapshots = readSnapshotIndex(dir);

  const keys = Object.keys(patterns);
  const totalEvents = keys.reduce((sum, k) => {
    const e = patterns[k];
    return sum + e.accepted + e.rejected + e.skipped;
  }, 0);

  // Checks always accepted -> suggest as required
  const suggestedRules = keys
    .filter(k => {
      const e = patterns[k];
      return e.accepted >= MIN_EVENTS && e.rejected === 0;
    })
    .map(k => ({ key: k, accepted: patterns[k].accepted, total: patterns[k].accepted }));

  // Checks always rejected -> suggest suppressing
  const suggestedSuppressions = keys
    .filter(k => {
      const e = patterns[k];
      return e.rejected >= SUPPRESS_THRESHOLD && e.accepted === 0;
    })
    .map(k => ({ key: k, rejected: patterns[k].rejected, total: patterns[k].rejected }));

  // From audit snapshots: checks that repeatedly appear in topActionKeys (failing)
  const auditSnapshots = snapshots
    .filter(s => s.snapshotKind === 'audit' && s.summary && Array.isArray(s.summary.topActionKeys))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, RECENT_AUDITS);

  const failCounts = {};
  for (const snap of auditSnapshots) {
    for (const key of snap.summary.topActionKeys) {
      failCounts[key] = (failCounts[key] || 0) + 1;
    }
  }

  const suggestedPriorities = Object.entries(failCounts)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, failCount: count, auditCount: auditSnapshots.length }));

  return { totalEvents, auditCount: auditSnapshots.length, suggestedRules, suggestedSuppressions, suggestedPriorities };
}

/**
 * Format suggestions for CLI output.
 */
function formatSuggestions(suggestions) {
  const { totalEvents, auditCount, suggestedRules, suggestedSuppressions, suggestedPriorities } = suggestions;

  if (totalEvents === 0 && auditCount === 0) {
    return '  No usage data yet. Run nerviq fix or nerviq audit to build pattern history.';
  }

  const sources = [];
  if (totalEvents > 0) sources.push(`${totalEvents} pattern events`);
  if (auditCount > 0) sources.push(`${auditCount} audit snapshots`);
  const lines = [`  Auto-Suggested Rules (based on ${sources.join(', ')}):`];

  if (suggestedRules.length > 0) {
    lines.push('', '  Suggested as required (always accepted):');
    for (const r of suggestedRules) {
      lines.push(`  + ${r.key.padEnd(20)} — accepted ${r.accepted}/${r.total} times, consider making mandatory`);
    }
  }

  if (suggestedSuppressions.length > 0) {
    lines.push('', '  Suggested to suppress (always rejected):');
    for (const s of suggestedSuppressions) {
      lines.push(`  - ${s.key.padEnd(20)} — rejected ${s.rejected}/${s.total} times, may not fit your workflow`);
    }
  }

  if (suggestedPriorities.length > 0) {
    lines.push('', '  Priority focus (failing repeatedly):');
    for (const p of suggestedPriorities) {
      lines.push(`  ! ${p.key.padEnd(20)} — failed in ${p.failCount}/${p.auditCount} recent audits`);
    }
  }

  if (suggestedRules.length === 0 && suggestedSuppressions.length === 0 && suggestedPriorities.length === 0) {
    lines.push('', '  No strong patterns detected yet. Keep using nerviq fix and audit to build history.');
  }

  return lines.join('\n');
}

module.exports = { analyzeSuggestions, formatSuggestions };
