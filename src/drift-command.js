/**
 * Nerviq Drift — the wedge entrypoint.
 *
 * `nerviq drift` answers exactly one question with zero ceremony:
 * "Do my agent docs lie?"
 *
 * It runs ONLY the proven high-signal layers:
 *   1. Stale-reference detection (deterministic, near-zero FP):
 *      - agent doc references a package script or task that doesn't exist
 *        (npm/pnpm/yarn/bun + Makefile/justfile/Taskfile/composer/rake/tox)
 *      - agent doc claims a framework or toolchain version the manifest
 *        contradicts (package.json, go.mod, Cargo.toml, pyproject,
 *        composer.json, Gemfile, .nvmrc)
 *   2. Permission & exposure (EXPO-01) — secrets pasted into agent config,
 *      auto-approved destructive commands, MCP servers with no allowlist,
 *      hooks pointing at scripts that no longer exist.
 *   3. Cross-platform drift (Harmony) — only when 2+ platforms are
 *      configured in the repo, including outright contradictions.
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
  // WEDGE-01: non-npm ecosystems. The wedge is only credible if it works on
  // the repo in front of the user, not only on JS repos.
  require('./shallow-risk/patterns/agent-config-task-not-in-runner'),
  require('./shallow-risk/patterns/agent-config-toolchain-version-mismatch'),
];

/**
 * EXPO-01 — permission & exposure patterns.
 *
 * These four are as deterministic and as verifiable-by-hand as the stale
 * reference patterns, but they were reachable only behind the experimental
 * `--shallow-risk` flag. A secret pasted into `.claude/settings.json`, an
 * auto-approved `rm -rf`, an MCP server with no allowlist, and a hook
 * pointing at a script that no longer exists are all facts about what the
 * agent is permitted to do — the highest-stakes half of "your agent config
 * is lying to you", and the half no single-file linter can see.
 */
const EXPOSURE_PATTERNS = [
  require('./shallow-risk/patterns/agent-config-secret-literal'),
  require('./shallow-risk/patterns/agent-config-dangerous-autoapprove'),
  require('./shallow-risk/patterns/mcp-server-no-allowlist'),
  require('./shallow-risk/patterns/hook-script-missing'),
];

function collectPatternFindings(ctx, patterns) {
  const findings = [];
  for (const pattern of patterns) {
    let raw = [];
    try { raw = pattern.run(ctx) || []; } catch { raw = []; }
    for (const finding of raw) {
      const built = buildFinding(pattern, ctx, finding);
      // Evidence snippets are a ±2-line window; the renderer must quote the
      // exact matched line (the window's first line used to be shown, which
      // misquoted every finding by 1-2 lines — fatal for a tool whose pitch
      // is "verifiable by hand in 30 seconds").
      if (built.file && Number.isFinite(built.line)) {
        const content = ctx.fileContent(built.file);
        const exact = content ? String(content).split(/\r?\n/)[built.line - 1] : undefined;
        if (exact !== undefined) built.matchedLine = exact.trim();
      }
      findings.push(built);
    }
  }
  return findings;
}

const SEVERITY_RANK = { critical: 3, high: 2, medium: 1, low: 0 };

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

  const ctx = new ProjectContext(dir);
  const staleFindings = collectPatternFindings(ctx, STALE_REFERENCE_PATTERNS);
  const exposureFindings = collectPatternFindings(ctx, EXPOSURE_PATTERNS)
    .sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
  const harmony = collectHarmonyDrift(dir);

  const driftIssues = harmony.applicable ? harmony.drift.drifts : [];
  const seriousDrift = driftIssues.filter(d => d.severity === 'critical' || d.severity === 'high');
  const seriousExposure = exposureFindings.filter(f => f.severity === 'critical' || f.severity === 'high');
  const hasFindings = staleFindings.length > 0 || seriousDrift.length > 0 || seriousExposure.length > 0;
  const exitCode = hasFindings ? 1 : 0;

  const serializeFinding = (f) => ({
    key: f.key,
    severity: f.severity,
    file: f.file,
    line: f.line,
    snippet: f.snippet,
    fix: f.fix,
    sourceUrl: f.sourceUrl,
    owaspTags: f.owaspTags || [],
  });

  const result = {
    nerviq: version,
    dir,
    staleReferences: {
      count: staleFindings.length,
      findings: staleFindings.map(serializeFinding),
    },
    exposure: {
      count: exposureFindings.length,
      serious: seriousExposure.length,
      findings: exposureFindings.map(serializeFinding),
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
      const quotedLine = f.matchedLine || (f.snippet ? f.snippet.trim().split(/\r?\n/)[0] : null);
      if (quotedLine) {
        const shown = quotedLine.length > 120 ? `${quotedLine.slice(0, 117)}...` : quotedLine;
        lines.push(c(`        "${shown}"`, 'dim'));
      }
      if (f.fix) lines.push(`        ${c('Fix:', 'yellow')} ${f.fix}`);
    }
  }
  lines.push('');

  // 2. Permission & exposure — what the agent is allowed to do
  if (exposureFindings.length === 0) {
    lines.push(c('  ✓ No permission or exposure problems in your agent config.', 'green'));
  } else {
    const headlineColor = seriousExposure.length > 0 ? 'red' : 'yellow';
    lines.push(c(`  Permission & exposure: ${exposureFindings.length} finding(s)`, headlineColor));
    for (const f of exposureFindings) {
      const sevColor = f.severity === 'critical' ? 'red' : f.severity === 'high' ? 'yellow' : 'dim';
      const where = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`    ${c(`[${f.severity}]`, sevColor)} ${c(where, 'bold')} — ${f.name}`);
      const quoted = f.matchedLine || (f.snippet ? f.snippet.trim().split(/\r?\n/)[0] : null);
      if (quoted) {
        const shown = quoted.length > 120 ? `${quoted.slice(0, 117)}...` : quoted;
        lines.push(c(`        "${shown}"`, 'dim'));
      }
      if (f.fix) lines.push(c(`        Fix: ${f.fix}`, 'dim'));
    }
  }
  lines.push('');

  // 3. Cross-platform drift
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
    lines.push(c(`  Verdict: ${staleFindings.length} stale reference(s), ${seriousExposure.length} permission issue(s), ${seriousDrift.length} serious drift issue(s). Exit 1.`, 'bold'));
    lines.push(c('  Every finding above is verifiable by hand in ~30 seconds.', 'dim'));
  } else {
    lines.push(c('  Verdict: clean. Your agent docs are telling the truth today.', 'bold'));
  }
  lines.push('');

  return { output: lines.join('\n'), exitCode, result };
}

module.exports = { runDrift };
