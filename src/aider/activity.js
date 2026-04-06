/**
 * Aider Repeat-Usage Surfaces — 6 activity surfaces
 *
 * Adapts the shared activity/snapshot backend for Aider platform.
 * Provides: history, compare, trend, watch, feedback, insights.
 *
 * Aider snapshots stored in .nerviq/snapshots/ (legacy: .claude/nerviq-cli/snapshots/) filtered by platform='aider'.
 */

const path = require('path');
const {
  getHistory: getSharedHistory,
  compareLatest: sharedCompareLatest,
  readSnapshotIndex,
  writeSnapshotArtifact,
  exportTrendReport: sharedExportTrendReport,
  recordRecommendationOutcome,
  readOutcomeIndex,
  summarizeOutcomeEntries,
} = require('../activity');
const { version } = require('../../package.json');

// --- History ---

function getAiderHistory(dir, limit = 20) {
  const entries = readSnapshotIndex(dir);
  return entries
    .filter(e => e.snapshotKind === 'audit' && (e.platform === 'aider' || e.summary?.platform === 'aider'))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

function formatAiderHistory(dir) {
  const history = getAiderHistory(dir, 10);
  if (history.length === 0) {
    return 'No Aider snapshots found. Run `npx nerviq --platform aider --snapshot` to save one.';
  }

  const lines = ['Aider Score History (most recent first):', ''];
  for (const entry of history) {
    const date = entry.createdAt?.split('T')[0] || 'unknown';
    const score = entry.summary?.score ?? '?';
    const passed = entry.summary?.passed ?? '?';
    const total = entry.summary?.checkCount ?? '?';
    lines.push(`  ${date}  ${score}/100  (${passed}/${total} passing)`);
  }

  const comparison = compareAiderLatest(dir);
  if (comparison) {
    lines.push('');
    const sign = comparison.delta.score >= 0 ? '+' : '';
    lines.push(`  Trend: ${comparison.trend} (${sign}${comparison.delta.score} since previous)`);
    if (comparison.improvements.length > 0) {
      lines.push(`  Fixed: ${comparison.improvements.join(', ')}`);
    }
    if (comparison.regressions.length > 0) {
      lines.push(`  New gaps: ${comparison.regressions.join(', ')}`);
    }
  }

  return lines.join('\n');
}

// --- Compare ---

function compareAiderLatest(dir) {
  const audits = getAiderHistory(dir, 2);
  if (audits.length < 2) return null;

  const current = audits[0];
  const previous = audits[1];

  const currentPassed = new Set(current.summary?.passedIds || []);
  const previousPassed = new Set(previous.summary?.passedIds || []);

  const improvements = [];
  const regressions = [];

  for (const id of currentPassed) {
    if (!previousPassed.has(id)) improvements.push(id);
  }
  for (const id of previousPassed) {
    if (!currentPassed.has(id)) regressions.push(id);
  }

  const scoreDelta = (current.summary?.score ?? 0) - (previous.summary?.score ?? 0);

  return {
    trend: scoreDelta > 0 ? 'improving' : scoreDelta < 0 ? 'regressing' : 'stable',
    delta: { score: scoreDelta },
    improvements,
    regressions,
    currentSnapshot: current,
    previousSnapshot: previous,
  };
}

// --- Trend Export ---

function exportAiderTrendReport(dir) {
  const history = getAiderHistory(dir, 50);
  if (history.length === 0) return null;

  return {
    platform: 'aider',
    generatedAt: new Date().toISOString(),
    nerviqVersion: version,
    snapshotCount: history.length,
    dataPoints: history.map(entry => ({
      date: entry.createdAt,
      score: entry.summary?.score ?? null,
      passed: entry.summary?.passed ?? null,
      checkCount: entry.summary?.checkCount ?? null,
    })),
  };
}

// --- Feedback ---

function recordAiderFeedback(dir, recommendationId, outcome, notes = '') {
  return recordRecommendationOutcome(dir, {
    platform: 'aider',
    recommendationId,
    outcome,
    notes,
  });
}

function getAiderFeedbackSummary(dir) {
  const entries = readOutcomeIndex(dir);
  const aiderEntries = entries.filter(e => e.platform === 'aider');
  return summarizeOutcomeEntries(aiderEntries);
}

function formatAiderFeedback(dir) {
  const summary = getAiderFeedbackSummary(dir);
  if (summary.total === 0) {
    return 'No Aider recommendation feedback recorded yet.';
  }

  const lines = [
    'Aider Recommendation Feedback:',
    '',
    `  Total: ${summary.total}`,
    `  Accepted: ${summary.accepted}`,
    `  Rejected: ${summary.rejected}`,
    `  Deferred: ${summary.deferred}`,
  ];

  if (summary.acceptanceRate !== null) {
    lines.push(`  Acceptance rate: ${(summary.acceptanceRate * 100).toFixed(0)}%`);
  }

  return lines.join('\n');
}

// --- Insights ---

function generateAiderInsights(dir) {
  const history = getAiderHistory(dir, 10);
  const feedback = getAiderFeedbackSummary(dir);
  const insights = [];

  if (history.length >= 3) {
    const recent = history.slice(0, 3);
    const avgScore = recent.reduce((sum, e) => sum + (e.summary?.score ?? 0), 0) / recent.length;

    if (avgScore < 40) {
      insights.push({
        severity: 'high',
        message: 'Aider setup score consistently low — prioritize .aider.conf.yml and CONVENTIONS.md.',
      });
    }

    const comparison = compareAiderLatest(dir);
    if (comparison && comparison.regressions.length > 2) {
      insights.push({
        severity: 'medium',
        message: `${comparison.regressions.length} checks regressed since last snapshot.`,
      });
    }
  }

  if (feedback.total > 5 && feedback.acceptanceRate !== null && feedback.acceptanceRate < 0.5) {
    insights.push({
      severity: 'medium',
      message: 'Low recommendation acceptance rate — review convention file relevance.',
    });
  }

  return {
    platform: 'aider',
    insights,
    summary: insights.length === 0
      ? 'No actionable Aider insights at this time.'
      : `${insights.length} Aider insight(s) found.`,
  };
}

function formatAiderInsights(dir) {
  const result = generateAiderInsights(dir);
  if (result.insights.length === 0) {
    return result.summary;
  }

  const lines = ['Aider Insights:', ''];
  for (const insight of result.insights) {
    const severity = insight.severity.toUpperCase();
    lines.push(`  [${severity}] ${insight.message}`);
  }
  lines.push('');
  lines.push(result.summary);
  return lines.join('\n');
}

module.exports = {
  getAiderHistory,
  formatAiderHistory,
  compareAiderLatest,
  exportAiderTrendReport,
  recordAiderFeedback,
  getAiderFeedbackSummary,
  formatAiderFeedback,
  generateAiderInsights,
  formatAiderInsights,
};
