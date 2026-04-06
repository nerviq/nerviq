const fs = require('fs');
const path = require('path');
const { ensureProjectStateDir, resolveProjectStateReadPath } = require('./state-paths');

const PATTERNS_FILE = 'patterns.json';
const SUPPRESS_THRESHOLD = 3;

function patternsPath(dir, writable) {
  if (writable) {
    const feedbackDir = ensureProjectStateDir(dir, 'feedback');
    return path.join(feedbackDir, PATTERNS_FILE);
  }
  const feedbackDir = resolveProjectStateReadPath(dir, 'feedback');
  return path.join(feedbackDir, PATTERNS_FILE);
}

function loadPatterns(dir) {
  const filePath = patternsPath(dir, false);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function savePatterns(dir, patterns) {
  const filePath = patternsPath(dir, true);
  fs.writeFileSync(filePath, JSON.stringify(patterns, null, 2), 'utf8');
}

function recordPattern(dir, checkKey, action) {
  if (!['accepted', 'rejected', 'skipped'].includes(action)) return;
  const patterns = loadPatterns(dir);
  if (!patterns[checkKey]) {
    patterns[checkKey] = { accepted: 0, rejected: 0, skipped: 0, lastAction: null, lastDate: null };
  }
  patterns[checkKey][action] += 1;
  patterns[checkKey].lastAction = action;
  patterns[checkKey].lastDate = new Date().toISOString();
  savePatterns(dir, patterns);
}

function getPriorityAdjustment(dir, checkKey) {
  const patterns = loadPatterns(dir);
  const entry = patterns[checkKey];
  if (!entry) return null;
  const total = entry.accepted + entry.rejected;
  if (total < 2) return null;
  if (entry.accepted > 0 && entry.rejected === 0) return 'boost';
  if (entry.rejected >= SUPPRESS_THRESHOLD && entry.accepted === 0) return 'suppress';
  return null;
}

function getUsageSummary(dir) {
  const patterns = loadPatterns(dir);
  const keys = Object.keys(patterns);
  const totalEvents = keys.reduce((sum, k) => {
    const e = patterns[k];
    return sum + e.accepted + e.rejected + e.skipped;
  }, 0);

  const withRates = keys
    .filter(k => (patterns[k].accepted + patterns[k].rejected) > 0)
    .map(k => {
      const e = patterns[k];
      const total = e.accepted + e.rejected;
      return { key: k, accepted: e.accepted, rejected: e.rejected, total, rate: total > 0 ? e.accepted / total : 0 };
    });

  withRates.sort((a, b) => b.rate - a.rate || b.total - a.total);
  const topAccepted = withRates.filter(e => e.rate > 0).slice(0, 5);
  const topRejected = withRates.filter(e => e.rate < 1).sort((a, b) => a.rate - b.rate || b.total - a.total).slice(0, 5);

  return { totalEvents, topAccepted, topRejected, patterns };
}

function formatUsageSummary(dir) {
  const summary = getUsageSummary(dir);
  if (summary.totalEvents === 0) return '  No usage patterns recorded yet.\n  Patterns are tracked when you run nerviq fix.';

  const lines = [`  Usage Patterns (${summary.totalEvents} events recorded):`];
  if (summary.topAccepted.length > 0) {
    lines.push('', '  Most accepted:');
    summary.topAccepted.forEach((e, i) => {
      lines.push(`  ${i + 1}. ${e.key.padEnd(20)} ${e.accepted}/${e.total} (${Math.round(e.rate * 100)}%)`);
    });
  }
  if (summary.topRejected.length > 0) {
    lines.push('', '  Most rejected:');
    summary.topRejected.forEach((e, i) => {
      const hint = e.rate === 0 && e.total >= SUPPRESS_THRESHOLD ? ' -- consider suppressing' : '';
      lines.push(`  ${i + 1}. ${e.key.padEnd(20)} ${e.accepted}/${e.total} (${Math.round(e.rate * 100)}%)${hint}`);
    });
  }
  return lines.join('\n');
}

module.exports = { loadPatterns, recordPattern, getPriorityAdjustment, getUsageSummary, formatUsageSummary };
