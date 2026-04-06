/**
 * Harmony Audit — Cross-Platform DX Audit
 *
 * Runs AFTER per-platform audits and evaluates how well the project's
 * AI coding platforms are aligned with each other.
 *
 * Produces a harmony score (0-100), per-platform scores, drift analysis,
 * and cross-platform recommendations.
 */

const { buildCanonicalModel, detectActivePlatforms } = require('./canon');
const { detectDrift, formatDriftReport } = require('./drift');
const { audit: platformAudit } = require('../audit');

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  magenta: '\x1b[35m',
};

function colorize(text, color) {
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

function progressBar(score, max = 100, width = 20) {
  const filled = Math.round((score / max) * width);
  const empty = width - filled;
  const color = score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'red';
  return colorize('\u2588'.repeat(filled), color) + colorize('\u2591'.repeat(empty), 'dim');
}

// ─── Platform key to audit platform name mapping ────────────────────────────

const PLATFORM_AUDIT_MAP = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  copilot: 'copilot',
  cursor: 'cursor',
  windsurf: 'windsurf',
  aider: 'aider',
  opencode: 'opencode',
};

// ─── Cross-platform recommendations ────────────────────────────────────────

function generateRecommendations(model, drift, platformScores) {
  const recommendations = [];
  const platforms = model.activePlatforms.map(p => p.platform);

  // 1. If only one platform detected, recommend adding another
  if (platforms.length === 1) {
    recommendations.push({
      priority: 'medium',
      category: 'expansion',
      message: `Only ${platforms[0]} is configured. Consider adding a second platform for redundancy and team flexibility.`,
    });
  }

  // 2. If any platform scores below 40, flag it
  for (const [platform, score] of Object.entries(platformScores)) {
    if (score !== null && score < 40) {
      recommendations.push({
        priority: 'high',
        category: 'quality',
        message: `${platform} scores ${score}/100. Run \`nerviq audit --platform ${platform}\` and address critical gaps.`,
      });
    }
  }

  // 3. If trust drift is critical, recommend alignment
  const trustDrifts = drift.drifts.filter(d => d.type === 'trust-drift' && d.severity === 'critical');
  if (trustDrifts.length > 0) {
    recommendations.push({
      priority: 'critical',
      category: 'security',
      message: 'Critical trust posture mismatch. One platform has full autonomy while another is restricted. Align before production use.',
    });
  }

  // 4. Recommend shared MCP servers
  const mcpDrifts = drift.drifts.filter(d => d.type === 'mcp-drift');
  if (mcpDrifts.length > 2) {
    recommendations.push({
      priority: 'medium',
      category: 'tooling',
      message: `${mcpDrifts.length} MCP alignment issues. Use \`nerviq harmony sync\` to propagate MCP servers across platforms.`,
    });
  }

  // 5. Coverage gap recommendations
  const coverageGaps = drift.drifts.filter(d => d.type === 'coverage-gap' && d.severity === 'high');
  for (const gap of coverageGaps) {
    recommendations.push({
      priority: 'high',
      category: 'coverage',
      message: gap.description + '. ' + gap.recommendation,
    });
  }

  // 6. If harmony score is high and all platforms score well, celebrate
  if (drift.harmonyScore >= 90 && Object.values(platformScores).every(s => s === null || s >= 70)) {
    recommendations.push({
      priority: 'low',
      category: 'status',
      message: 'Excellent cross-platform alignment. All platforms are well-configured and consistent.',
    });
  }

  // Sort: critical > high > medium > low
  const priorityOrder = { critical: 3, high: 2, medium: 1, low: 0 };
  recommendations.sort((a, b) => (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0));

  return recommendations;
}

// ─── Main audit function ────────────────────────────────────────────────────

/**
 * Run a cross-platform harmony audit.
 *
 * Builds a canonical model, runs per-platform audits, detects drift,
 * and generates cross-platform recommendations.
 *
 * @param {object} options - { dir: string, silent?: boolean, verbose?: boolean }
 * @returns {object} Harmony audit result
 */
async function harmonyAudit(options) {
  const { dir, silent = false, verbose = false } = options;

  // 1. Build canonical model
  const model = buildCanonicalModel(dir);
  const platformKeys = model.activePlatforms.map(p => p.platform);

  if (platformKeys.length === 0) {
    return {
      harmonyScore: 0,
      platformScores: {},
      drift: { drifts: [], summary: { total: 0, critical: 0, high: 0, medium: 0, low: 0 }, harmonyScore: 0 },
      recommendations: [{
        priority: 'high',
        category: 'coverage',
        message: 'No AI coding platforms detected. Run `nerviq init` to set up Claude, or add another platform.',
      }],
      activePlatforms: [],
      model,
    };
  }

  // 2. Run per-platform audits (silent mode to avoid console noise)
  const platformScores = {};
  const platformResults = {};
  for (const key of platformKeys) {
    const auditPlatform = PLATFORM_AUDIT_MAP[key];
    if (auditPlatform) {
      try {
        const result = await platformAudit({ dir, platform: auditPlatform, silent: true });
        platformScores[key] = result.score;
        platformResults[key] = result;
      } catch {
        platformScores[key] = null;
        platformResults[key] = null;
      }
    } else {
      platformScores[key] = null;
    }
  }

  // 3. Detect drift
  const drift = detectDrift(model);

  // 4. Calculate overall harmony score
  // Blend of drift harmony score and average platform scores
  const validScores = Object.values(platformScores).filter(s => s !== null);
  const avgPlatformScore = validScores.length > 0
    ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length)
    : 0;

  // Harmony = 60% drift alignment + 40% average platform quality
  const harmonyScore = Math.round(drift.harmonyScore * 0.6 + avgPlatformScore * 0.4);

  // 5. Generate recommendations
  const recommendations = generateRecommendations(model, drift, platformScores);

  const result = {
    harmonyScore,
    platformScores,
    platformResults,
    drift,
    recommendations,
    activePlatforms: model.activePlatforms,
    model,
  };

  // 6. Print report if not silent
  if (!silent) {
    printHarmonyReport(result, { verbose });
  }

  return result;
}

// ─── Report printer ─────────────────────────────────────────────────────────

function printHarmonyReport(result, options = {}) {
  const { verbose = false } = options;
  const c = colorize;

  console.log('');
  console.log(c('  ══════════════════════════════════════════════════════', 'dim'));
  console.log(c('  HARMONY AUDIT — Cross-Platform DX Report', 'bold'));
  console.log(c('  ══════════════════════════════════════════════════════', 'dim'));
  console.log('');

  // Active platforms
  console.log(c('  Active platforms:', 'bold'));
  for (const ap of result.activePlatforms) {
    const score = result.platformScores[ap.platform];
    const scoreStr = score !== null ? `${score}/100` : 'n/a';
    const scoreColor = score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'red';
    console.log(`    ${ap.label}: ${c(scoreStr, score !== null ? scoreColor : 'dim')}`);
  }
  console.log('');

  // Harmony score
  const hs = result.harmonyScore;
  const hsColor = hs >= 80 ? 'green' : hs >= 50 ? 'yellow' : 'red';
  console.log(`  Harmony Score: ${progressBar(hs)} ${c(hs + '/100', hsColor)}`);
  console.log('');

  // Drift summary
  if (result.drift.drifts.length > 0) {
    console.log(formatDriftReport(result.drift, { color: true, verbose }));
  } else {
    console.log(c('  No cross-platform drift detected.', 'green'));
    console.log('');
  }

  // Recommendations
  if (result.recommendations.length > 0) {
    console.log(c('  Recommendations:', 'bold'));
    const priorityIcons = { critical: '\u2718', high: '!', medium: '~', low: '\u2713' };
    const priorityColors = { critical: 'red', high: 'yellow', medium: 'blue', low: 'green' };

    for (const rec of result.recommendations) {
      const icon = priorityIcons[rec.priority] || '-';
      const pColor = priorityColors[rec.priority] || 'dim';
      console.log(`  ${c(icon, pColor)} [${rec.category}] ${rec.message}`);
    }
    console.log('');
  }

  console.log(c('  Powered by NERVIQ cross-platform intelligence', 'dim'));
  console.log(c('  https://github.com/nerviq/nerviq', 'dim'));
  console.log('');
}

/**
 * Format the harmony audit result as a structured report string (no ANSI colors).
 *
 * @param {object} result - Output of harmonyAudit()
 * @returns {string} Plain-text report
 */
function formatHarmonyAuditReport(result) {
  const lines = [];

  lines.push('HARMONY AUDIT — Cross-Platform DX Report');
  lines.push('========================================');
  lines.push('');

  lines.push('Active platforms:');
  for (const ap of result.activePlatforms) {
    const score = result.platformScores[ap.platform];
    lines.push(`  ${ap.label}: ${score !== null ? score + '/100' : 'n/a'}`);
  }
  lines.push('');

  lines.push(`Harmony Score: ${result.harmonyScore}/100`);
  lines.push('');

  if (result.drift.drifts.length > 0) {
    lines.push(formatDriftReport(result.drift, { color: false, verbose: true }));
  } else {
    lines.push('No cross-platform drift detected.');
  }
  lines.push('');

  if (result.recommendations.length > 0) {
    lines.push('Recommendations:');
    for (const rec of result.recommendations) {
      lines.push(`  [${rec.priority.toUpperCase()}] [${rec.category}] ${rec.message}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  harmonyAudit,
  formatHarmonyAuditReport,
};
