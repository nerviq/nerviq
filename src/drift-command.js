/**
 * Nerviq Drift — the wedge entrypoint.
 *
 * `nerviq drift` answers exactly one question with zero ceremony:
 * "Do my agent docs lie?"
 *
 * It runs ONLY the two proven high-signal layers:
 *   1. Stale-reference detection (deterministic, near-zero FP):
 *      - agent doc references a package script that doesn't exist
 *      - agent doc claims a framework version package.json contradicts
 *   2. Cross-platform drift (Harmony) — only when 2+ platforms are
 *      configured in the repo.
 *
 * No 0-100 governance score, no banners, no upsell. Exit code 1 when lies
 * or critical/high drift are found (lint semantics for CI), 0 when clean.
 * This module is also the seed of the standalone `npx agent-doc-lint`
 * extraction path (sprint plan, docs/SPRINT_30D_2026-07.md).
 */

'use strict';

const { version } = require('../package.json');
const { ProjectContext } = require('./context');
const { buildFinding } = require('./shallow-risk/shared');
const { buildCanonicalModel, detectActivePlatforms } = require('./harmony/canon');
const { detectDrift } = require('./harmony/drift');

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
};

const STALE_REFERENCE_PATTERNS = [
  require('./shallow-risk/patterns/agent-config-script-not-in-package-json'),
  require('./shallow-risk/patterns/agent-config-framework-version-mismatch'),
];

function collectStaleReferences(dir) {
  const ctx = new ProjectContext(dir);
  const findings = [];
  for (const pattern of STALE_REFERENCE_PATTERNS) {
    let raw = [];
    try { raw = pattern.run(ctx) || []; } catch { raw = []; }
    for (const finding of raw) {
      findings.push(buildFinding(pattern, ctx, finding));
    }
  }
  return findings;
}

function collectHarmonyDrift(dir) {
  const activePlatforms = detectActivePlatforms(dir);
  if (activePlatforms.length < 2) {
    return { applicable: false, platforms: activePlatforms.map(p => p.platform), drift: null };
  }
  const model = buildCanonicalModel(dir);
  const drift = detectDrift(model);
  return { applicable: true, platforms: activePlatforms.map(p => p.platform), drift };
}

/**
 * Run the drift/stale-reference wedge scan.
 *
 * @param {object} options
 * @param {string} [options.dir] - Target directory (default: cwd)
 * @param {boolean} [options.json] - Emit machine-readable JSON only
 * @param {boolean} [options.color] - ANSI colors (default: true for TTY output)
 * @returns {{ output: string, exitCode: number, result: object }}
 */
function runDrift({ dir = process.cwd(), json = false, color = true } = {}) {
  const c = (text, name) => (color && !json ? `${COLORS[name] || ''}${text}${COLORS.reset}` : text);

  const staleFindings = collectStaleReferences(dir);
  const harmony = collectHarmonyDrift(dir);

  const driftIssues = harmony.applicable ? harmony.drift.drifts : [];
  const seriousDrift = driftIssues.filter(d => d.severity === 'critical' || d.severity === 'high');
  const hasFindings = staleFindings.length > 0 || seriousDrift.length > 0;
  const exitCode = hasFindings ? 1 : 0;

  const result = {
    nerviq: version,
    dir,
    staleReferences: {
      count: staleFindings.length,
      findings: staleFindings.map(f => ({
        key: f.key,
        severity: f.severity,
        file: f.file,
        line: f.line,
        snippet: f.snippet,
        fix: f.fix,
        sourceUrl: f.sourceUrl,
      })),
    },
    harmony: harmony.applicable
      ? {
        applicable: true,
        platforms: harmony.platforms,
        harmonyScore: harmony.drift.harmonyScore,
        summary: harmony.drift.summary,
        drifts: harmony.drift.drifts,
      }
      : { applicable: false, platforms: harmony.platforms },
    clean: !hasFindings,
    exitCode,
  };

  if (json) {
    return { output: JSON.stringify(result, null, 2), exitCode, result };
  }

  const lines = [''];
  lines.push(c(`  nerviq drift  v${version}`, 'bold') + c('  — do your agent docs lie?', 'dim'));
  lines.push('');

  // 1. Stale references (the lies)
  if (staleFindings.length === 0) {
    lines.push(c('  ✓ No stale references. Your agent docs match your repo.', 'green'));
  } else {
    const noun = staleFindings.length === 1 ? 'lie' : 'lies';
    lines.push(c(`  ✘ ${staleFindings.length} ${noun} found in your agent docs:`, 'red'));
    lines.push('');
    for (const f of staleFindings) {
      const where = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`    ${c('✘', 'red')} ${c(where, 'bold')}`);
      if (f.snippet) {
        const firstLine = f.snippet.trim().split(/\r?\n/)[0];
        const shown = firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
        lines.push(c(`        "${shown}"`, 'dim'));
      }
      if (f.fix) lines.push(`        ${c('Fix:', 'yellow')} ${f.fix}`);
    }
  }
  lines.push('');

  // 2. Cross-platform drift
  if (!harmony.applicable) {
    const detected = harmony.platforms.length === 1
      ? `only ${harmony.platforms[0]} configured`
      : 'fewer than 2 platforms configured';
    lines.push(c(`  – Cross-platform drift: n/a (${detected}).`, 'dim'));
  } else if (driftIssues.length === 0) {
    lines.push(c(`  ✓ No cross-platform drift across ${harmony.platforms.join(' + ')}.`, 'green'));
  } else {
    lines.push(c(`  Cross-platform drift across ${harmony.platforms.join(' + ')}: ${driftIssues.length} issue(s)`, seriousDrift.length > 0 ? 'red' : 'yellow'));
    for (const d of driftIssues) {
      const sevColor = d.severity === 'critical' ? 'red' : d.severity === 'high' ? 'yellow' : 'dim';
      lines.push(`    ${c(`[${d.severity}]`, sevColor)} ${d.description}`);
      if (d.recommendation) lines.push(c(`        Fix: ${d.recommendation}`, 'dim'));
    }
  }
  lines.push('');

  // Verdict — one line, honest.
  if (hasFindings) {
    lines.push(c(`  Verdict: ${staleFindings.length} stale reference(s), ${seriousDrift.length} serious drift issue(s). Exit 1.`, 'bold'));
    lines.push(c('  Every finding above is verifiable by hand in ~30 seconds.', 'dim'));
  } else {
    lines.push(c('  Verdict: clean. Your agent docs are telling the truth today.', 'bold'));
  }
  lines.push('');

  return { output: lines.join('\n'), exitCode, result };
}

module.exports = { runDrift };
