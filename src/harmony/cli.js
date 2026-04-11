/**
 * H9. Harmony CLI Commands
 *
 * Command handlers for harmony operations, to be called from bin/cli.js.
 * Each function returns a formatted output string (or prints to console).
 *
 * Zero external dependencies - imports from sibling harmony modules and parent platform modules.
 */

const path = require('path');
const { generateStrategicAdvice, PLATFORM_STRENGTHS } = require('./advisor');
const { startHarmonyWatch, buildHarmonyWatchPlan } = require('./watch');
const { saveHarmonyState, loadHarmonyState, getHarmonyHistory, recordPlatformScore, recordDrift } = require('./memory');
const { getHarmonyGovernanceSummary, formatHarmonyGovernanceReport } = require('./governance');

const COLORS = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', blue: '\x1b[36m',
  magenta: '\x1b[35m',
};
const c = (text, color) => `${COLORS[color] || ''}${text}${COLORS.reset}`;

// ─── Shared helpers ───────────────────────────────────────────────────────────

function resolveDir(options) {
  return path.resolve(options.dir || options.d || '.');
}

/**
 * Collect audit results from all detectable platforms.
 * Runs audit() for each platform in sequence (audit is async).
 */
/**
 * Detect which platforms have config files present in the directory.
 * Only these platforms will be audited in harmony commands.
 */
function detectPresentPlatforms(dir) {
  const fs = require('fs');
  const pathMod = require('path');
  const exists = (f) => fs.existsSync(pathMod.join(dir, f));

  const detected = [];
  if (exists('CLAUDE.md') || exists('.claude/settings.json') || exists('.claude/CLAUDE.md')) detected.push('claude');
  if (exists('AGENTS.md') || exists('.codex/config.toml')) detected.push('codex');
  if (exists('GEMINI.md') || exists('.gemini/settings.json')) detected.push('gemini');
  if (exists('.github/copilot-instructions.md')) detected.push('copilot');
  if (exists('.cursorrules') || exists('.cursor/rules')) detected.push('cursor');
  if (exists('.windsurfrules') || exists('.windsurf/rules')) detected.push('windsurf');
  if (exists('.aider.conf.yml') || exists('.aiderignore')) detected.push('aider');
  if (exists('opencode.json') || exists('.opencode')) detected.push('opencode');

  // AGENTS.md is shared by codex, copilot, and opencode — only add if not already detected via platform-specific file
  if (exists('AGENTS.md') && !detected.includes('codex')) detected.push('codex');

  return detected.length > 0 ? detected : ['claude']; // default to claude if nothing found
}

async function collectPlatformAudits(dir) {
  const { audit } = require('../audit');
  const platforms = detectPresentPlatforms(dir);
  const results = [];

  for (const platform of platforms) {
    try {
      const result = await audit({ dir, silent: true, platform });
      if (result && typeof result.score === 'number') {
        results.push({ platform, ...result });
      }
    } catch (_e) { /* platform not available */ }
  }

  return results;
}

// ─── Command: harmony audit ───────────────────────────────────────────────────

/**
 * Run a cross-platform audit and display per-platform scores.
 */
async function runHarmonyAudit(options) {
  const dir = resolveDir(options);
  const platformAudits = await collectPlatformAudits(dir);

  if (options.json) {
    console.log(JSON.stringify({ dir, platforms: platformAudits }, null, 2));
    return { dir, platforms: platformAudits };
  }

  console.log('');
  console.log(c('  Harmony Cross-Platform Audit', 'bold'));
  console.log(c('  ═══════════════════════════════════════', 'dim'));
  console.log(c(`  Directory: ${dir}`, 'dim'));
  console.log('');

  if (platformAudits.length === 0) {
    console.log(c('  No platform configurations detected.', 'yellow'));
    console.log(c('  Run "nerviq setup" to bootstrap a platform.', 'dim'));
    console.log('');
    return { dir, platforms: [] };
  }

  for (const audit of platformAudits) {
    const scoreColor = audit.score >= 70 ? 'green' : audit.score >= 40 ? 'yellow' : 'red';
    console.log(`  ${c(audit.platform.padEnd(12), 'bold')} ${c(`${audit.score}/100`, scoreColor)}  (${audit.passed || 0}/${(audit.passed || 0) + (audit.failed || 0)} checks)`);

    // Record score to memory
    try {
      recordPlatformScore(dir, audit.platform, audit.score, { passed: audit.passed, failed: audit.failed });
    } catch (_e) { /* memory write optional */ }
  }

  // Detect drift: compare current scores to last recorded scores
  try {
    const state = loadHarmonyState(dir);
    const prevScores = state.platformScores || [];
    for (const audit of platformAudits) {
      const prevEntries = (prevScores || []).filter(e => e.platform === audit.platform);
      if (prevEntries.length >= 2) {
        // Compare to the second-to-last entry (last is what we just recorded)
        const prev = prevEntries[prevEntries.length - 2];
        const delta = audit.score - (prev.score || 0);
        if (Math.abs(delta) >= 5) {
          recordDrift(dir, {
            platform: audit.platform,
            driftScore: delta,
            driftedFields: [`score: ${prev.score} → ${audit.score}`],
          });
          const sign = delta > 0 ? '+' : '';
          console.log(c(`  ${audit.platform}: ${sign}${delta} since last audit`, delta > 0 ? 'green' : 'red'));
        }
      }
    }
  } catch (_e) { /* drift recording is optional */ }

  // Average score
  const avgScore = Math.round(platformAudits.reduce((sum, a) => sum + (a.score || 0), 0) / platformAudits.length);
  const avgColor = avgScore >= 70 ? 'green' : avgScore >= 40 ? 'yellow' : 'red';
  console.log('');
  console.log(`  ${c('Average:', 'bold')}      ${c(`${avgScore}/100`, avgColor)}`);
  console.log(`  ${c('Platforms:', 'bold')}    ${platformAudits.length}`);
  console.log('');

  return { dir, platforms: platformAudits, averageScore: avgScore };
}

// ─── Command: harmony sync ────────────────────────────────────────────────────

/**
 * Sync canonical model across platforms (detect drift and suggest fixes).
 */
async function runHarmonySync(options) {
  const dir = resolveDir(options);
  const platformAudits = await collectPlatformAudits(dir);

  // Load or build canonical model from memory
  const state = loadHarmonyState(dir);
  const canonicalModel = state.canon || null;

  const advice = generateStrategicAdvice(canonicalModel, platformAudits);

  if (options.json) {
    console.log(JSON.stringify({ dir, sync: advice.crossPlatformActions }, null, 2));
    return advice.crossPlatformActions;
  }

  console.log('');
  console.log(c('  Harmony Sync', 'bold'));
  console.log(c('  ═══════════════════════════════════════', 'dim'));
  console.log('');

  if (advice.crossPlatformActions.length === 0) {
    console.log(c('  All platforms are in sync. No actions needed.', 'green'));
    console.log('');
    return [];
  }

  for (const action of advice.crossPlatformActions) {
    const prioColor = action.priority === 'high' ? 'red' : action.priority === 'medium' ? 'yellow' : 'dim';
    console.log(`  ${c(`[${action.priority.toUpperCase()}]`, prioColor)} ${action.action}`);
    console.log(`    ${c('Affected:', 'dim')} ${action.affectedPlatforms.join(', ')}`);
    if (action.sourcePlatforms) {
      console.log(`    ${c('Source:', 'dim')} ${action.sourcePlatforms.join(', ')}`);
    }
    console.log('');
  }

  return advice.crossPlatformActions;
}

// ─── Command: harmony drift ──────────────────────────────────────────────────

/**
 * Detect and display drift between platforms.
 */
async function runHarmonyDrift(options) {
  const dir = resolveDir(options);
  const state = loadHarmonyState(dir);
  const history = getHarmonyHistory(dir, options.platform ? { platform: options.platform } : undefined);

  if (options.json) {
    console.log(JSON.stringify({ dir, drift: history.driftHistory }, null, 2));
    return history.driftHistory;
  }

  console.log('');
  console.log(c('  Harmony Drift History', 'bold'));
  console.log(c('  ═══════════════════════════════════════', 'dim'));
  console.log('');

  const driftEntries = history.driftHistory;

  if (driftEntries.length === 0) {
    console.log(c('  No drift history recorded yet.', 'dim'));
    console.log(c('  Run "nerviq harmony audit" to start tracking.', 'dim'));
    console.log('');
    return [];
  }

  // Show recent drift entries (last 20)
  const recent = driftEntries.slice(-20);
  for (const entry of recent) {
    const driftColor = entry.driftScore > 20 ? 'red' : entry.driftScore > 10 ? 'yellow' : 'green';
    console.log(`  ${c(entry.timestamp || 'unknown', 'dim')} ${entry.platform.padEnd(12)} drift: ${c(String(entry.driftScore), driftColor)}`);
    if (entry.driftedFields && entry.driftedFields.length > 0) {
      console.log(`    ${c('Fields:', 'dim')} ${entry.driftedFields.join(', ')}`);
    }
  }
  console.log('');

  return driftEntries;
}

// ─── Command: harmony advise ──────────────────────────────────────────────────

/**
 * Generate and display strategic advice.
 */
async function runHarmonyAdvise(options) {
  const dir = resolveDir(options);
  const platformAudits = await collectPlatformAudits(dir);
  const state = loadHarmonyState(dir);
  const canonicalModel = state.canon || null;

  const advice = generateStrategicAdvice(canonicalModel, platformAudits);

  if (options.json) {
    console.log(JSON.stringify(advice, null, 2));
    return advice;
  }

  console.log('');
  console.log(c('  Harmony Strategic Advisor', 'bold'));
  console.log(c('  ═══════════════════════════════════════', 'dim'));
  console.log('');

  // Task routing
  console.log(c('  Task Routing Recommendations', 'bold'));
  console.log('');
  for (const route of advice.taskRouting) {
    const confColor = route.confidence === 'high' ? 'green' : route.confidence === 'medium' ? 'yellow' : 'dim';
    console.log(`  ${c(route.taskLabel.padEnd(22), 'bold')} → ${c(route.recommendedLabel, 'blue')} ${c(`[${route.confidence}]`, confColor)}`);
    console.log(`    ${c(route.reasoning, 'dim')}`);
    if (route.alternatives.length > 0) {
      const altLabels = route.alternatives.map(a => `${a.label} (${a.score})`).join(', ');
      console.log(`    ${c('Alternatives:', 'dim')} ${altLabels}`);
    }
    console.log('');
  }

  // Config recommendations
  if (advice.configRecommendations.length > 0) {
    console.log(c('  Configuration Recommendations', 'bold'));
    console.log('');
    for (const rec of advice.configRecommendations) {
      const impactColor = rec.impact === 'high' ? 'red' : rec.impact === 'medium' ? 'yellow' : 'dim';
      console.log(`  ${c(`[${rec.impact.toUpperCase()}]`, impactColor)} ${rec.platform}: ${rec.recommendation}`);
    }
    console.log('');
  }

  // Cross-platform actions
  if (advice.crossPlatformActions.length > 0) {
    console.log(c('  Cross-Platform Actions', 'bold'));
    console.log('');
    for (const action of advice.crossPlatformActions) {
      const prioColor = action.priority === 'high' ? 'red' : action.priority === 'medium' ? 'yellow' : 'dim';
      console.log(`  ${c(`[${action.priority.toUpperCase()}]`, prioColor)} ${action.action}`);
      console.log(`    ${c('Platforms:', 'dim')} ${action.affectedPlatforms.join(', ')}`);
    }
    console.log('');
  }

  return advice;
}

// ─── Command: harmony watch ───────────────────────────────────────────────────

/**
 * Start the harmony watch loop.
 */
async function runHarmonyWatch(options) {
  const dir = resolveDir(options);

  await startHarmonyWatch({
    dir,
    autoSync: !!options.autoSync,
    debounceMs: options.debounce || 800,
    onDriftDetected: (platform, details) => {
      console.log(c(`  DRIFT ALERT: ${platform} score dropped by ${Math.abs(details.delta)}`, 'red'));
    },
    onPlatformChange: (platform, file) => {
      // Logged by watch module itself
    },
    runAudit: options.noAudit ? null : async (auditDir) => {
      const audits = await collectPlatformAudits(auditDir);
      const result = {};
      for (const audit of audits) {
        result[audit.platform] = audit;
      }
      return result;
    },
  });
}

// ─── Command: harmony governance ──────────────────────────────────────────────

/**
 * Display the cross-platform governance summary.
 */
async function runHarmonyGovernance(options) {
  const dir = resolveDir(options);
  const platformAudits = await collectPlatformAudits(dir);
  const state = loadHarmonyState(dir);
  const canonicalModel = state.canon || null;

  const summary = getHarmonyGovernanceSummary(canonicalModel, platformAudits);

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return summary;
  }

  const report = formatHarmonyGovernanceReport(summary, options);
  console.log(report);

  return summary;
}

// ─── Command: harmony score ──────────────────────────────────────────────────

/**
 * Output a standalone Harmony Score (0-100) with optional badge and CI threshold.
 *
 * Options:
 *   --json          JSON output
 *   --badge         Print shields.io badge markdown
 *   --threshold N   Exit with code 1 if score < N (for CI gates)
 *   --quiet         Score number only (for piping)
 */
async function runHarmonyScore(options) {
  const dir = resolveDir(options);
  const { harmonyAudit } = require('./audit');
  const result = await harmonyAudit({ dir, silent: true });

  const score = result.harmonyScore;
  const threshold = parseInt(options.threshold, 10) || 0;
  const pass = score >= threshold;

  if (options.json) {
    const output = {
      harmonyScore: score,
      platforms: result.platformScores,
      activePlatforms: result.activePlatforms.map(p => p.platform),
      driftCount: result.drift.drifts.length,
      threshold: threshold || null,
      pass,
    };
    if (options.badge) {
      output.badge = getHarmonyBadgeMarkdown(score);
      output.badgeUrl = getHarmonyBadgeUrl(score);
    }
    console.log(JSON.stringify(output, null, 2));
    return output;
  }

  if (options.quiet) {
    console.log(score);
    return { score, pass };
  }

  console.log('');
  console.log(c('  Harmony Score', 'bold'));
  console.log(c('  ═══════════════════════════════════════', 'dim'));
  console.log('');

  // Score with color bar
  const barWidth = 30;
  const filled = Math.round((score / 100) * barWidth);
  const empty = barWidth - filled;
  const scoreColor = score >= 80 ? 'green' : score >= 50 ? 'yellow' : 'red';
  const bar = c('\u2588'.repeat(filled), scoreColor) + c('\u2591'.repeat(empty), 'dim');
  console.log(`  ${bar} ${c(`${score}/100`, scoreColor)}`);
  console.log('');

  // Per-platform breakdown
  for (const ap of result.activePlatforms) {
    const ps = result.platformScores[ap.platform];
    const psColor = ps >= 70 ? 'green' : ps >= 40 ? 'yellow' : 'red';
    console.log(`  ${ap.platform.padEnd(12)} ${ps !== null ? c(`${ps}/100`, psColor) : c('n/a', 'dim')}`);
  }
  console.log('');

  // Drift summary
  const driftCount = result.drift.drifts.length;
  if (driftCount > 0) {
    const critical = result.drift.drifts.filter(d => d.severity === 'critical').length;
    const high = result.drift.drifts.filter(d => d.severity === 'high').length;
    let driftMsg = `  ${driftCount} drift issue${driftCount !== 1 ? 's' : ''}`;
    if (critical > 0) driftMsg += c(` (${critical} critical)`, 'red');
    else if (high > 0) driftMsg += c(` (${high} high)`, 'yellow');
    console.log(driftMsg);
    console.log(c('  Run "nerviq harmony-audit" for details.', 'dim'));
    console.log('');
  }

  // Badge output
  if (options.badge) {
    console.log(c('  Badge:', 'bold'));
    console.log(`  ${getHarmonyBadgeMarkdown(score)}`);
    console.log('');
  }

  // Threshold check
  if (threshold > 0) {
    if (pass) {
      console.log(c(`  Threshold: ${score} >= ${threshold} PASS`, 'green'));
    } else {
      console.log(c(`  Threshold: ${score} < ${threshold} FAIL`, 'red'));
    }
    console.log('');
  }

  return { score, pass, platforms: result.platformScores };
}

// ─── Harmony Badge helpers ───────────────────────────────────────────────────

function getHarmonyBadgeUrl(score) {
  const color = score >= 80 ? 'brightgreen' : score >= 60 ? 'yellow' : score >= 40 ? 'orange' : 'red';
  const label = encodeURIComponent('Harmony Score');
  const message = encodeURIComponent(`${score}/100`);
  return `https://img.shields.io/badge/${label}-${message}-${color}`;
}

function getHarmonyBadgeMarkdown(score) {
  const url = getHarmonyBadgeUrl(score);
  return `[![Harmony Score](${url})](https://github.com/nerviq/nerviq)`;
}

// ─── Command: harmony demo ──────────────────────────────────────────────────

/**
 * Zero-setup demo: creates a temporary multi-platform project, runs harmony
 * audit on it, and shows how Nerviq detects cross-platform drift.
 *
 * This lets new users see Harmony's value instantly without configuring anything.
 */
async function runHarmonyDemo(options) {
  const fs = require('fs');
  const os = require('os');
  const { harmonyAudit } = require('./audit');

  console.log('');
  console.log(c('  Harmony Demo — Zero-Setup Cross-Platform Drift Detection', 'bold'));
  console.log(c('  ═══════════════════════════════════════════════════════', 'dim'));
  console.log('');
  console.log(c('  Creating a sample multi-platform project...', 'dim'));
  console.log('');

  // Create temp directory with realistic multi-platform configs
  const demoDir = path.join(os.tmpdir(), `nerviq-harmony-demo-${Date.now()}`);
  fs.mkdirSync(demoDir, { recursive: true });
  fs.mkdirSync(path.join(demoDir, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(demoDir, '.cursor'), { recursive: true });
  fs.mkdirSync(path.join(demoDir, '.github'), { recursive: true });

  // Claude config — well-configured
  fs.writeFileSync(path.join(demoDir, 'CLAUDE.md'), [
    '# Project Instructions',
    '',
    '## Architecture',
    'This is a Node.js API with PostgreSQL. Use Express for routing.',
    '',
    '## Testing',
    'Run tests with `npm test`. All PRs require passing tests.',
    '',
    '## Security',
    '- Never commit .env files',
    '- Use parameterized queries for all database access',
    '- Validate all user input',
    '',
    '## Code Style',
    '- Use ESLint with the project config',
    '- Prefer async/await over callbacks',
    '- Add JSDoc comments for public functions',
  ].join('\n'));

  fs.writeFileSync(path.join(demoDir, '.claude', 'settings.json'), JSON.stringify({
    permissions: {
      allow: ['Read', 'Glob', 'Grep'],
      deny: ['Bash(rm -rf *)'],
    },
    model: 'claude-sonnet-4-6',
  }, null, 2));

  // Cursor config — intentionally drifted (different rules, less security)
  fs.writeFileSync(path.join(demoDir, '.cursorrules'), [
    'You are a helpful coding assistant.',
    'This is a Node.js project using Express.',
    'Write clean, readable code.',
    // Missing: security rules, testing rules, architecture details
  ].join('\n'));

  // Copilot config — partial coverage
  fs.writeFileSync(path.join(demoDir, '.github', 'copilot-instructions.md'), [
    '# Copilot Instructions',
    '',
    'This is a Node.js Express API project.',
    'Use TypeScript-style JSDoc annotations.',
    'Follow RESTful conventions for API endpoints.',
    // Missing: security, testing, architecture details
  ].join('\n'));

  // Add a package.json for realism
  fs.writeFileSync(path.join(demoDir, 'package.json'), JSON.stringify({
    name: 'harmony-demo-project',
    version: '1.0.0',
    scripts: { test: 'jest' },
  }, null, 2));

  console.log(c('  Demo project created with 3 platforms:', 'bold'));
  console.log(`    ${c('Claude', 'green')}   — Well-configured (CLAUDE.md + settings.json)`);
  console.log(`    ${c('Cursor', 'yellow')}   — Basic rules only (.cursorrules)`);
  console.log(`    ${c('Copilot', 'yellow')}  — Partial coverage (copilot-instructions.md)`);
  console.log('');
  console.log(c('  Intentional drift injected:', 'bold'));
  console.log(`    ${c('\u2718', 'red')} Security rules only in Claude, missing from Cursor & Copilot`);
  console.log(`    ${c('\u2718', 'red')} Testing instructions only in Claude`);
  console.log(`    ${c('\u2718', 'red')} Architecture details inconsistent across platforms`);
  console.log(`    ${c('\u2718', 'red')} Trust posture differs (Claude has explicit permissions)`);
  console.log('');
  console.log(c('  Running Harmony Audit...', 'dim'));
  console.log('');

  // Run the actual harmony audit on the demo project
  const result = await harmonyAudit({ dir: demoDir, silent: false, verbose: !!options.verbose });

  console.log('');
  console.log(c('  ═══════════════════════════════════════════════════════', 'dim'));
  console.log(c('  What you just saw:', 'bold'));
  console.log('');
  console.log('  Nerviq Harmony detected real configuration drift between');
  console.log('  3 AI coding platforms in your project — differences in');
  console.log('  instructions, security posture, and tool coverage that');
  console.log('  cause inconsistent AI behavior.');
  console.log('');
  console.log(c('  Try it on your own project:', 'bold'));
  console.log(`    ${c('npx @nerviq/cli harmony-audit', 'blue')}`);
  console.log(`    ${c('npx @nerviq/cli harmony-score --threshold 70', 'blue')}`);
  console.log('');

  // Clean up
  try {
    fs.rmSync(demoDir, { recursive: true, force: true });
  } catch (_e) { /* cleanup optional */ }

  return result;
}

module.exports = {
  runHarmonyAudit,
  runHarmonySync,
  runHarmonyDrift,
  runHarmonyAdvise,
  runHarmonyWatch,
  runHarmonyGovernance,
  runHarmonyScore,
  runHarmonyDemo,
  getHarmonyBadgeUrl,
  getHarmonyBadgeMarkdown,
};
