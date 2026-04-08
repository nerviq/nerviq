/**
 * S7. Synergy Dashboard / Report
 *
 * Formats synergy analysis as CLI output showing amplification,
 * per-platform contribution, active and untapped synergies, and trends.
 */

const { compoundAudit, calculateAmplification } = require('./evidence');
const { analyzeCompensation } = require('./compensation');
const { discoverPatterns } = require('./patterns');
const { rankRecommendations } = require('./ranking');

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
};

function c(text, color) {
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

function progressBar(score, max = 100, width = 20) {
  const clamped = Math.min(max, Math.max(0, score));
  const filled = Math.round((clamped / max) * width);
  const empty = width - filled;
  const color = score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'red';
  return c('\u2588'.repeat(filled), color) + c('\u2591'.repeat(empty), 'dim');
}

/**
 * Format the synergy report for CLI output.
 *
 * @param {Object} options
 * @param {Object} options.platformAudits - Audit results per platform
 * @param {string[]} options.activePlatforms - Active platform names
 * @param {Object[]} [options.harmonyHistory] - Historical harmony data
 * @param {Object[]} [options.recommendations] - Aggregated recommendations
 * @returns {string} Formatted CLI report
 */
function formatSynergyReport(options) {
  const { platformAudits, activePlatforms, harmonyHistory, recommendations } = options;
  const lines = [];

  // Header
  lines.push('');
  lines.push(c('  ╔══════════════════════════════════════════════════╗', 'blue'));
  lines.push(c('  ║     SYNERGY DASHBOARD [EXPERIMENTAL]             ║', 'blue'));
  lines.push(c('  ╚══════════════════════════════════════════════════╝', 'blue'));
  lines.push(c('  Static routing rules. Learned routing planned for v2.0.', 'dim'));
  lines.push(c('  Harmony is the GA cross-platform surface. Treat Synergy as advisory research output.', 'dim'));
  lines.push('');

  // Compound audit
  const compound = compoundAudit(platformAudits || {});
  const amplification = calculateAmplification(platformAudits || {});

  const ampColor = compound.amplification > 10 ? 'green'
    : compound.amplification > 0 ? 'yellow' : 'red';

  lines.push(c('  Synergy Score', 'bold'));
  lines.push(`  ${progressBar(compound.compoundScore, 150, 30)} ${c(compound.compoundScore + '/100', 'bold')}` +
    (compound.amplification > 0
      ? ` ${c(`(+${compound.amplification} amplification)`, ampColor)}`
      : ''));
  lines.push(`  Best single platform: ${compound.bestSingleScore}/100`);
  lines.push(`  Cross-validated findings: ${compound.crossValidated.length}`);
  lines.push(`  Total unique findings: ${compound.totalFindings}`);
  lines.push('');

  // Per-platform contribution
  lines.push(c('  Per-Platform Contribution', 'bold'));
  for (const platform of (activePlatforms || [])) {
    const audit = (platformAudits || {})[platform];
    const score = audit ? audit.score : 0;
    const coverage = compound.coverageMap[platform] || { found: 0, unique: 0, shared: 0 };
    lines.push(`  ${c(platform.padEnd(10), 'blue')} ${progressBar(score, 100, 15)} ${score}/100  ` +
      `${c(`unique: ${coverage.unique}`, 'dim')}  ${c(`shared: ${coverage.shared}`, 'dim')}`);
  }
  lines.push('');

  // Active synergies (compensations)
  const compensation = analyzeCompensation(activePlatforms || [], platformAudits);
  if (compensation.compensations.length > 0) {
    lines.push(c('  Active Synergies', 'bold'));
    const shown = compensation.compensations.slice(0, 5);
    for (const comp of shown) {
      lines.push(`  ${c('\u2713', 'green')} ${comp.compensatedBy.platform} covers ${comp.weakness.platform}'s weakness in ${comp.weakness.label} ` +
        `${c(`(+${comp.netBenefit} net benefit)`, 'green')}`);
    }
    if (compensation.compensations.length > 5) {
      lines.push(c(`  ... and ${compensation.compensations.length - 5} more`, 'dim'));
    }
    lines.push('');
  }

  // Untapped synergies
  if (compensation.uncoveredGaps.length > 0 || compensation.recommendedAdditions.length > 0) {
    lines.push(c('  Untapped Synergies', 'bold'));

    for (const gap of compensation.uncoveredGaps.slice(0, 3)) {
      lines.push(`  ${c('\u26A0', 'yellow')} No platform covers: ${gap.label}`);
    }

    for (const rec of compensation.recommendedAdditions.slice(0, 2)) {
      const areas = rec.wouldCover.map(w => w.label).join(', ');
      lines.push(`  ${c('\u2192', 'blue')} Add ${c(rec.platform, 'bold')} to cover: ${areas}`);
    }
    lines.push('');
  }

  // Patterns (if history available)
  if (Array.isArray(harmonyHistory) && harmonyHistory.length > 0) {
    const { patterns } = discoverPatterns(harmonyHistory);
    if (patterns.length > 0) {
      lines.push(c('  Discovered Patterns', 'bold'));
      for (const pattern of patterns.slice(0, 4)) {
        const icon = pattern.type === 'recurring-failure' ? c('\u2717', 'red')
          : pattern.type === 'sequence-effect' ? c('\u2194', 'blue')
          : pattern.type === 'diminishing-returns' ? c('\u2193', 'yellow')
          : c('\u2022', 'dim');
        lines.push(`  ${icon} ${pattern.description}`);
      }
      lines.push('');
    }
  }

  // Top ranked recommendations
  if (Array.isArray(recommendations) && recommendations.length > 0) {
    const ranked = rankRecommendations(recommendations, activePlatforms || []);
    if (ranked.length > 0) {
      lines.push(c('  Top Synergy Recommendations', 'bold'));
      for (const rec of ranked.slice(0, 5)) {
        const platforms = (rec.applicablePlatforms || []).join(', ') || rec.platform || '?';
        lines.push(`  ${c(rec.synergyScore.toFixed(1).padStart(5), 'green')} ${rec.name || rec.description || rec.key} ${c(`[${platforms}]`, 'dim')}`);
      }
      lines.push('');
    }
  }

  // Verdict
  lines.push(c(`  Verdict: ${amplification.verdict.replace(/-/g, ' ')}`, 'bold'));
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate a full synergy report for a project directory.
 * High-level entry point that runs compound audit + compensation + patterns.
 *
 * @param {Object} options - Same as formatSynergyReport options
 * @returns {string} Formatted CLI report string
 */
function generateSynergyReport(options) {
  return formatSynergyReport(options);
}

module.exports = { generateSynergyReport, formatSynergyReport };
