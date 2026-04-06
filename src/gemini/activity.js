/**
 * Gemini Repeat-Usage Surfaces
 *
 * Adapts the shared activity/snapshot backend for Gemini CLI platform.
 * Provides: history, compare, trend, feedback, insights.
 *
 * Gemini snapshots are stored alongside Claude snapshots in
 * .nerviq/snapshots/ (legacy: .claude/nerviq-cli/snapshots/) but filtered by platform='gemini'.
 */

const path = require('path');
const {
  readSnapshotIndex,
  recordRecommendationOutcome,
  readOutcomeIndex,
  summarizeOutcomeEntries,
} = require('../activity');
const { version } = require('../../package.json');

// --- History ---

/**
 * Get Gemini audit history from snapshots.
 * Filters to platform='gemini' snapshots only.
 */
function getGeminiHistory(dir, limit = 20) {
  const entries = readSnapshotIndex(dir);
  return entries
    .filter(e => e.snapshotKind === 'audit' && (e.platform === 'gemini' || e.summary?.platform === 'gemini'))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

function formatGeminiHistory(dir) {
  const history = getGeminiHistory(dir, 10);
  if (history.length === 0) {
    return 'No Gemini snapshots found. Run `npx nerviq --platform gemini --snapshot` to save one.';
  }

  const lines = ['Gemini Score History (most recent first):', ''];
  for (const entry of history) {
    const date = entry.createdAt?.split('T')[0] || 'unknown';
    const score = entry.summary?.score ?? '?';
    const passed = entry.summary?.passed ?? '?';
    const total = entry.summary?.checkCount ?? '?';
    lines.push(`  ${date}  ${score}/100  (${passed}/${total} passing)`);
  }

  const comparison = compareGeminiLatest(dir);
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

/**
 * Compare the two most recent Gemini audit snapshots.
 */
function compareGeminiLatest(dir) {
  const audits = getGeminiHistory(dir, 2);
  if (audits.length < 2) return null;

  const current = audits[0];
  const previous = audits[1];

  const delta = {
    score: (current.summary?.score || 0) - (previous.summary?.score || 0),
    organic: (current.summary?.organicScore || 0) - (previous.summary?.organicScore || 0),
    passed: (current.summary?.passed || 0) - (previous.summary?.passed || 0),
  };

  const regressions = [];
  const improvements = [];

  const prevKeys = new Set(previous.summary?.topActionKeys || []);
  const currKeys = new Set(current.summary?.topActionKeys || []);

  for (const key of currKeys) {
    if (!prevKeys.has(key)) regressions.push(key);
  }
  for (const key of prevKeys) {
    if (!currKeys.has(key)) improvements.push(key);
  }

  return {
    platform: 'gemini',
    current: { date: current.createdAt, score: current.summary?.score, passed: current.summary?.passed },
    previous: { date: previous.createdAt, score: previous.summary?.score, passed: previous.summary?.passed },
    delta,
    regressions,
    improvements,
    trend: delta.score > 0 ? 'improving' : delta.score < 0 ? 'regressing' : 'stable',
  };
}

// --- Trend ---

/**
 * Export Gemini trend report as markdown.
 */
function exportGeminiTrendReport(dir) {
  const history = getGeminiHistory(dir, 50);
  if (history.length === 0) return null;

  const comparison = compareGeminiLatest(dir);
  const lines = [
    '# Gemini CLI Setup Trend Report',
    '',
    `**Project:** ${path.basename(dir)}`,
    `**Platform:** Gemini CLI`,
    `**Generated:** ${new Date().toISOString().split('T')[0]}`,
    `**Snapshots:** ${history.length}`,
    '',
    '## Score History',
    '',
    '| Date | Score | Passed | Checks |',
    '|------|-------|--------|--------|',
  ];

  for (const entry of history) {
    const date = entry.createdAt?.split('T')[0] || '?';
    lines.push(`| ${date} | ${entry.summary?.score ?? '?'}/100 | ${entry.summary?.passed ?? '?'} | ${entry.summary?.checkCount ?? '?'} |`);
  }

  if (comparison) {
    lines.push('');
    lines.push('## Latest Comparison');
    lines.push('');
    lines.push(`- **Previous:** ${comparison.previous.score}/100 (${comparison.previous.date?.split('T')[0]})`);
    lines.push(`- **Current:** ${comparison.current.score}/100 (${comparison.current.date?.split('T')[0]})`);
    lines.push(`- **Delta:** ${comparison.delta.score >= 0 ? '+' : ''}${comparison.delta.score} points`);
    lines.push(`- **Trend:** ${comparison.trend}`);
    if (comparison.improvements.length > 0) lines.push(`- **Fixed:** ${comparison.improvements.join(', ')}`);
    if (comparison.regressions.length > 0) lines.push(`- **New gaps:** ${comparison.regressions.join(', ')}`);
  }

  // ASCII trend chart
  if (history.length >= 3) {
    lines.push('');
    lines.push('## Trend Chart');
    lines.push('');
    lines.push('```');
    const scores = history.slice().reverse().map(e => e.summary?.score ?? 0);
    const max = Math.max(...scores, 100);
    const chartHeight = 10;
    for (let row = chartHeight; row >= 0; row--) {
      const threshold = (row / chartHeight) * max;
      const rowLabel = String(Math.round(threshold)).padStart(3);
      const bar = scores.map(s => s >= threshold ? '#' : ' ').join('');
      lines.push(`${rowLabel} |${bar}`);
    }
    lines.push(`    +${'─'.repeat(scores.length)}`);
    lines.push('```');
  }

  lines.push('');
  lines.push(`---`);
  lines.push(`*Generated by nerviq v${version} for Gemini CLI*`);
  return lines.join('\n');
}

// --- Feedback ---

/**
 * Record feedback on a Gemini recommendation.
 */
function recordGeminiFeedback(dir, payload) {
  return recordRecommendationOutcome(dir, {
    ...payload,
    source: payload.source || 'gemini-cli',
    platform: 'gemini',
  });
}

/**
 * Get Gemini feedback summary.
 */
function getGeminiFeedbackSummary(dir) {
  const entries = readOutcomeIndex(dir)
    .filter(e => e.source === 'gemini-cli' || e.platform === 'gemini');
  return summarizeOutcomeEntries(entries);
}

function formatGeminiFeedback(dir) {
  const summary = getGeminiFeedbackSummary(dir);
  if (!summary || Object.keys(summary).length === 0) {
    return 'No Gemini feedback recorded yet. Use `npx nerviq --platform gemini feedback` to rate recommendations.';
  }

  const lines = ['Gemini Recommendation Feedback:', ''];
  const entries = Array.isArray(summary) ? summary : Object.values(summary);
  for (const entry of entries) {
    const key = entry.key || 'unknown';
    const accepted = entry.accepted || 0;
    const rejected = entry.rejected || 0;
    const total = entry.total || 0;
    lines.push(`  ${key}: ${accepted} accepted, ${rejected} rejected (${total} total)`);
  }
  return lines.join('\n');
}

// --- Insights ---

/**
 * Generate Gemini-specific insights from audit history and feedback.
 * Includes Gemini-unique patterns: sandbox-drift, policy-complexity,
 * caveat-persistence, trust-class-stagnation.
 */
function generateGeminiInsights(dir) {
  const history = getGeminiHistory(dir, 50);
  const feedback = getGeminiFeedbackSummary(dir);
  const insights = [];

  // Pattern 1: Persistent failures
  if (history.length >= 3) {
    const recentFailKeys = new Map();
    for (const entry of history.slice(0, 5)) {
      for (const key of (entry.summary?.topActionKeys || [])) {
        recentFailKeys.set(key, (recentFailKeys.get(key) || 0) + 1);
      }
    }
    for (const [key, count] of recentFailKeys) {
      if (count >= 3) {
        insights.push({
          type: 'persistent-failure',
          severity: 'high',
          key,
          message: `Check ${key} has failed in ${count} of the last ${Math.min(history.length, 5)} audits. Consider addressing it or marking it as intentionally skipped.`,
        });
      }
    }
  }

  // Pattern 2: Score regression
  if (history.length >= 2) {
    const scores = history.map(e => e.summary?.score ?? 0);
    if (scores[0] < scores[1]) {
      insights.push({
        type: 'regression-pattern',
        severity: 'medium',
        message: `Score dropped from ${scores[1]} to ${scores[0]} in the most recent audit. Review recent changes.`,
        delta: scores[0] - scores[1],
      });
    }
  }

  // Pattern 3: Improvement velocity stall
  if (history.length >= 5) {
    const recentScores = history.slice(0, 5).map(e => e.summary?.score ?? 0);
    const range = Math.max(...recentScores) - Math.min(...recentScores);
    if (range <= 2) {
      insights.push({
        type: 'velocity-stall',
        severity: 'low',
        message: `Score has been flat (range: ${range} points) over the last 5 audits. Consider addressing lower-priority checks.`,
      });
    }
  }

  // Pattern 4: Feedback signals
  const feedbackEntries = Array.isArray(feedback) ? feedback : Object.values(feedback || {});
  for (const entry of feedbackEntries) {
    if (entry.rejected > entry.accepted && entry.total >= 2) {
      insights.push({
        type: 'feedback-signal',
        severity: 'medium',
        key: entry.key,
        message: `Recommendation ${entry.key} has been rejected more than accepted (${entry.rejected}/${entry.total}). Consider adjusting or removing this recommendation.`,
      });
    }
  }

  // Gemini-specific Pattern 5: Sandbox drift
  if (history.length >= 3) {
    const sandboxKeys = [];
    for (const entry of history.slice(0, 5)) {
      for (const key of (entry.summary?.topActionKeys || [])) {
        if (key.includes('sandbox') || key.includes('isolation')) {
          sandboxKeys.push(key);
        }
      }
    }
    if (sandboxKeys.length >= 2) {
      insights.push({
        type: 'sandbox-drift',
        severity: 'high',
        message: `Sandbox-related checks have appeared in ${sandboxKeys.length} recent audits. Gemini sandbox configuration may be drifting from recommended posture.`,
        keys: [...new Set(sandboxKeys)],
      });
    }
  }

  // Gemini-specific Pattern 6: Policy complexity
  if (history.length >= 2) {
    const latest = history[0];
    const policyKeys = (latest.summary?.topActionKeys || []).filter(
      k => k.includes('policy') || k.includes('governance') || k.includes('rule')
    );
    if (policyKeys.length >= 3) {
      insights.push({
        type: 'policy-complexity',
        severity: 'medium',
        message: `${policyKeys.length} policy/governance checks are failing simultaneously. Gemini policy configuration may be overly complex or misconfigured.`,
        keys: policyKeys,
      });
    }
  }

  // Gemini-specific Pattern 7: Caveat persistence
  if (history.length >= 3) {
    const caveatKeys = new Map();
    for (const entry of history.slice(0, 5)) {
      for (const key of (entry.summary?.topActionKeys || [])) {
        if (key.includes('caveat') || key.includes('warning') || key.includes('limitation')) {
          caveatKeys.set(key, (caveatKeys.get(key) || 0) + 1);
        }
      }
    }
    for (const [key, count] of caveatKeys) {
      if (count >= 3) {
        insights.push({
          type: 'caveat-persistence',
          severity: 'medium',
          key,
          message: `Caveat/limitation ${key} has persisted across ${count} audits. This may indicate a Gemini CLI limitation that should be documented or worked around.`,
        });
      }
    }
  }

  // Gemini-specific Pattern 8: Trust class stagnation
  if (history.length >= 5) {
    const trustKeys = new Map();
    for (const entry of history.slice(0, 5)) {
      for (const key of (entry.summary?.topActionKeys || [])) {
        if (key.includes('trust') || key.includes('approval') || key.includes('permission')) {
          trustKeys.set(key, (trustKeys.get(key) || 0) + 1);
        }
      }
    }
    for (const [key, count] of trustKeys) {
      if (count >= 4) {
        insights.push({
          type: 'trust-class-stagnation',
          severity: 'medium',
          key,
          message: `Trust/permission check ${key} has been failing in ${count} of the last 5 audits. Gemini trust classification may need elevation or explicit override.`,
        });
      }
    }
  }

  return {
    platform: 'gemini',
    generatedAt: new Date().toISOString(),
    snapshotCount: history.length,
    feedbackCount: feedbackEntries.length,
    insights,
    summary: insights.length === 0
      ? 'No actionable insights detected. Keep running audits to build pattern data.'
      : `${insights.length} insight(s) detected across ${history.length} snapshots.`,
  };
}

function formatGeminiInsights(dir) {
  const result = generateGeminiInsights(dir);
  if (result.insights.length === 0) {
    return result.summary;
  }

  const lines = ['Gemini Insights:', ''];
  for (const insight of result.insights) {
    const severity = insight.severity.toUpperCase();
    lines.push(`  [${severity}] ${insight.message}`);
  }
  lines.push('');
  lines.push(result.summary);
  return lines.join('\n');
}

module.exports = {
  getGeminiHistory,
  formatGeminiHistory,
  compareGeminiLatest,
  exportGeminiTrendReport,
  recordGeminiFeedback,
  getGeminiFeedbackSummary,
  formatGeminiFeedback,
  generateGeminiInsights,
  formatGeminiInsights,
};
