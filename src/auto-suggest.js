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

  const hasSuggestions = suggestedRules.length > 0 || suggestedSuppressions.length > 0 || suggestedPriorities.length > 0;
  let bootstrap = { ready: true, state: 'ready', message: null, steps: [] };

  if (totalEvents === 0 && auditSnapshots.length === 0) {
    // BUG-07 fix: when feedback was just recorded but pattern events are 0,
    // the user already ran `nerviq feedback` and got "No local usage..."
    // back. After the activity.js fix, feedback now bumps usage-patterns,
    // so this state means feedback never ran AT ALL. Be explicit about
    // what's missing so the user doesn't think the loop is broken.
    bootstrap = {
      ready: false,
      state: 'empty',
      message: 'No local usage or snapshot history exists yet. Need at least 2 snapshots and/or 2 recorded outcomes per check before suggestions surface.',
      missingSignals: ['snapshots', 'recorded-outcomes'],
      threshold: { minEventsPerCheck: MIN_EVENTS, minSnapshotsForPriority: 2 },
      steps: [
        'Run `nerviq audit --snapshot` to save the baseline.',
        'Use `nerviq fix`, `nerviq fix --all-critical`, or `nerviq feedback --key <K> --status accepted` to record recommendation outcomes.',
        'Run `nerviq audit --snapshot` again after a meaningful repo change.',
        'Re-run `nerviq suggest-rules`.',
      ],
    };
  } else if (!hasSuggestions && totalEvents === 0 && auditSnapshots.length > 0) {
    bootstrap = {
      ready: false,
      state: 'snapshots-only',
      message: `${auditSnapshots.length} audit snapshot(s) exist, but no recommendation outcomes have been recorded yet.`,
      steps: [
        'Run `nerviq fix` or `nerviq feedback` so Nerviq can learn which recommendations you accept or reject.',
        'Re-run `nerviq suggest-rules` after another fix cycle.',
      ],
    };
  } else if (!hasSuggestions && totalEvents > 0 && auditSnapshots.length === 0) {
    bootstrap = {
      ready: false,
      state: 'patterns-only',
      message: `${totalEvents} usage event(s) exist, but no audit snapshots have been saved yet.`,
      steps: [
        'Run `nerviq audit --snapshot` to save the baseline.',
        'Run it again after changes so repeated failures can be prioritized.',
        'Re-run `nerviq suggest-rules`.',
      ],
    };
  } else if (!hasSuggestions) {
    bootstrap = {
      ready: false,
      state: 'warming-up',
      message: `Nerviq has some local history (${totalEvents} pattern events, ${auditSnapshots.length} audit snapshots), but not enough repeated signals yet.`,
      steps: [
        'Keep saving snapshots with `nerviq audit --snapshot`.',
        'Keep recording outcomes with `nerviq fix` or `nerviq feedback`.',
        'Re-run `nerviq suggest-rules` after another change cycle.',
      ],
    };
  }

  return { totalEvents, auditCount: auditSnapshots.length, suggestedRules, suggestedSuppressions, suggestedPriorities, bootstrap };
}

/**
 * Format suggestions for CLI output.
 */
function formatSuggestions(suggestions) {
  const { totalEvents, auditCount, suggestedRules, suggestedSuppressions, suggestedPriorities, bootstrap } = suggestions;

  const sources = [];
  if (totalEvents > 0) sources.push(`${totalEvents} pattern events`);
  if (auditCount > 0) sources.push(`${auditCount} audit snapshots`);
  const lines = [
    sources.length > 0
      ? `  Auto-Suggested Rules (based on ${sources.join(', ')}):`
      : '  Auto-Suggested Rules:',
  ];

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

  if (suggestedRules.length === 0 && suggestedSuppressions.length === 0 && suggestedPriorities.length === 0 && bootstrap && !bootstrap.ready) {
    lines.push('', `  ${bootstrap.message}`);
    lines.push('  Bootstrap it with:');
    for (let i = 0; i < bootstrap.steps.length; i++) {
      lines.push(`  ${i + 1}. ${bootstrap.steps[i]}`);
    }
  }

  return lines.join('\n');
}

module.exports = { analyzeSuggestions, formatSuggestions };
