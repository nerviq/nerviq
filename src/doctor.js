/**
 * Nerviq Doctor
 *
 * Self-diagnostics for the nerviq CLI and the current project environment.
 * Checks: Node version, dependencies, platform detection, freshness gates.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { version } = require('../package.json');
const { validateDeclaredMcpServers } = require('./mcp-validation');
const { validateDeclaredHooks } = require('./hook-validation');

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

function c(text, color) {
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

const PLATFORM_SIGNALS = {
  claude:    ['CLAUDE.md', '.claude/CLAUDE.md', '.claude/settings.json', '.mcp.json'],
  codex:     ['AGENTS.md', '.codex/', '.codex/config.toml'],
  cursor:    ['.cursor/rules/', '.cursor/mcp.json', '.cursorrules'],
  copilot:   ['.github/copilot-instructions.md', '.github/', '.vscode/mcp.json'],
  gemini:    ['GEMINI.md', '.gemini/', '.gemini/settings.json'],
  windsurf:  ['.windsurf/', '.windsurfrules', '.windsurf/rules/'],
  aider:     ['.aider.conf.yml', '.aider.model.settings.yml'],
  opencode:  ['opencode.json', '.opencode/'],
};

const FRESHNESS_MODULES = {
  claude:   './freshness',
  codex:    './codex/freshness',
  cursor:   './cursor/freshness',
  copilot:  './copilot/freshness',
  gemini:   './gemini/freshness',
  windsurf: './windsurf/freshness',
  aider:    './aider/freshness',
  opencode: './opencode/freshness',
};

// ─── Individual checks ───────────────────────────────────────────────────────

function checkNodeVersion() {
  const raw = process.version.replace('v', '');
  const [major] = raw.split('.').map(Number);
  const ok = major >= 18;
  return {
    label: 'Node.js version',
    status: ok ? 'pass' : 'fail',
    detail: `${process.version} (${ok ? 'meets' : 'below'} minimum v18)`,
    fix: ok ? null : 'Upgrade Node.js to v18 or later: https://nodejs.org',
  };
}

function checkDeps() {
  const pkgPath = path.join(__dirname, '..', 'node_modules');
  const exists = fs.existsSync(pkgPath);
  return {
    label: 'node_modules installed',
    status: exists ? 'pass' : 'fail',
    detail: exists ? `${pkgPath}` : 'node_modules missing',
    fix: exists ? null : 'Run: npm install',
  };
}

function checkJestInstalled() {
  const jestPath = path.join(__dirname, '..', 'node_modules', 'jest', 'package.json');
  const exists = fs.existsSync(jestPath);
  let jestVersion = null;
  if (exists) {
    try {
      jestVersion = require(jestPath).version;
    } catch {}
  }
  return {
    label: 'Jest test runner',
    status: exists ? 'pass' : 'warn',
    detail: exists ? `jest@${jestVersion}` : 'jest not found in node_modules',
    fix: exists ? null : 'Run: npm install --save-dev jest',
  };
}

function checkPlatformDetection(dir) {
  const detected = [];
  for (const [platform, signals] of Object.entries(PLATFORM_SIGNALS)) {
    for (const signal of signals) {
      const signalPath = path.join(dir, signal);
      if (fs.existsSync(signalPath)) {
        detected.push(platform);
        break;
      }
    }
  }

  return {
    label: 'Platform detection',
    status: detected.length > 0 ? 'pass' : 'warn',
    detail: detected.length > 0
      ? `Detected: ${detected.join(', ')}`
      : 'No platform config files found in current directory',
    detected,
    fix: detected.length === 0
      ? 'Run `nerviq setup` to generate baseline config files for your platform'
      : null,
  };
}

function checkFreshnessGates() {
  const results = [];
  for (const [platform, modulePath] of Object.entries(FRESHNESS_MODULES)) {
    try {
      const freshness = require(modulePath);
      const gate = freshness.checkReleaseGate({});
      const staleCount = (gate.stale || []).length;
      const freshCount = (gate.fresh || []).length;
      const totalCount = (gate.results || []).length;
      results.push({
        platform,
        status: staleCount === 0 ? 'pass' : 'warn',
        fresh: freshCount,
        total: totalCount,
        stale: staleCount,
        detail: staleCount === 0
          ? `All ${totalCount} P0 sources fresh`
          : `${staleCount}/${totalCount} P0 sources unverified/stale`,
      });
    } catch (e) {
      results.push({ platform, status: 'error', detail: e.message });
    }
  }
  return results;
}

function checkCliPermissions() {
  const cliBin = path.join(__dirname, '..', 'bin', 'cli.js');
  const exists = fs.existsSync(cliBin);
  if (!exists) {
    return { label: 'CLI binary (bin/cli.js)', status: 'fail', detail: 'bin/cli.js not found', fix: null };
  }
  return { label: 'CLI binary (bin/cli.js)', status: 'pass', detail: cliBin, fix: null };
}

function checkGitRepo(dir) {
  const gitPath = path.join(dir, '.git');
  const exists = fs.existsSync(gitPath);
  return {
    label: 'Git repository',
    status: exists ? 'pass' : 'warn',
    detail: exists ? '.git/ found' : 'Not a git repository',
    fix: exists ? null : 'Run: git init (recommended for safety)',
  };
}

// ─── Main doctor function ────────────────────────────────────────────────────

async function runDoctor({ dir = process.cwd(), json = false, verbose = false } = {}) {
  const startMs = Date.now();

  const checks = [
    checkNodeVersion(),
    checkDeps(),
    checkJestInstalled(),
    checkCliPermissions(),
    checkGitRepo(dir),
    checkPlatformDetection(dir),
  ];

  const detectedPlatforms = (checks.find(c => c.detected) || {}).detected || [];
  const freshnessChecks = checkFreshnessGates();
  const mcpSummary = await validateDeclaredMcpServers({ dir, detectedPlatforms });
  const hookSummary = validateDeclaredHooks({ dir, detectedPlatforms });

  const totalPass = checks.filter(c => c.status === 'pass').length;
  const totalWarn = checks.filter(c => c.status === 'warn').length;
  const totalFail = checks.filter(c => c.status === 'fail').length;

  const freshPass = freshnessChecks.filter(f => f.status === 'pass').length;
  const freshWarn = freshnessChecks.filter(f => f.status !== 'pass').length;

  const overallOk = totalFail === 0 && mcpSummary.fail === 0 && hookSummary.fail === 0;
  const elapsed = Date.now() - startMs;

  if (json) {
    return JSON.stringify({
      nerviq: version,
      node: process.version,
      dir,
      overallOk,
      checks,
      freshnessChecks,
      mcpChecks: mcpSummary.checks,
      hookChecks: hookSummary.checks,
      totalPass,
      totalWarn,
      totalFail,
      freshPass,
      freshWarn,
      mcpDeclared: mcpSummary.declared,
      mcpPass: mcpSummary.pass,
      mcpWarn: mcpSummary.warn,
      mcpFail: mcpSummary.fail,
      hookDeclared: hookSummary.declared,
      hookPass: hookSummary.pass,
      hookWarn: hookSummary.warn,
      hookFail: hookSummary.fail,
      elapsed,
    }, null, 2);
  }

  const lines = [''];
  lines.push(c(`  nerviq doctor  v${version}`, 'bold'));
  lines.push(c('  ═══════════════════════════════════════', 'dim'));
  lines.push('');

  // Environment checks
  lines.push(c('  Environment', 'bold'));
  for (const chk of checks) {
    const icon = chk.status === 'pass' ? c('✓', 'green') : chk.status === 'warn' ? c('⚠', 'yellow') : c('✗', 'red');
    lines.push(`    ${icon}  ${chk.label.padEnd(32)} ${c(chk.detail, chk.status === 'pass' ? 'dim' : 'reset')}`);
    if (chk.fix && (verbose || chk.status === 'fail')) {
      lines.push(c(`         Fix: ${chk.fix}`, 'yellow'));
    }
  }

  // Platform detection detail
  if (detectedPlatforms.length > 0) {
    lines.push('');
    lines.push(c('  Detected Platforms', 'bold'));
    for (const p of detectedPlatforms) {
      lines.push(`    ${c('✓', 'green')}  ${p}`);
    }
  }

  // Freshness
  lines.push('');
  lines.push(c('  Freshness Gates', 'bold'));
  for (const f of freshnessChecks) {
    const icon = f.status === 'pass' ? c('✓', 'green') : c('⚠', 'yellow');
    const label = f.platform.padEnd(12);
    lines.push(`    ${icon}  ${label}  ${c(f.detail || f.status, f.status === 'pass' ? 'dim' : 'yellow')}`);
  }

  lines.push('');
  lines.push(c('  MCP Servers', 'bold'));
  if (mcpSummary.checks.length === 0) {
    lines.push(c('    No declared MCP servers found in the detected project surfaces.', 'dim'));
  } else {
    for (const item of mcpSummary.checks) {
      const icon = item.status === 'pass'
        ? c('✓', 'green')
        : item.status === 'warn'
          ? c('⚠', 'yellow')
          : c('✗', 'red');
      const label = `${item.platform}/${item.scope}`.padEnd(16);
      lines.push(`    ${icon}  ${label} ${item.serverName}  ${c(item.detail, item.status === 'pass' ? 'dim' : item.status === 'warn' ? 'yellow' : 'red')}`);
      if (verbose && item.source) {
        lines.push(c(`         Source: ${item.source}`, 'dim'));
      }
      if (item.fix && (verbose || item.status === 'fail')) {
        lines.push(c(`         Fix: ${item.fix}`, item.status === 'fail' ? 'yellow' : 'dim'));
      }
    }
  }

  lines.push('');
  lines.push(c('  Hook Runtime', 'bold'));
  if (hookSummary.checks.length === 0) {
    lines.push(c('    No declared hooks found in the detected project surfaces.', 'dim'));
  } else {
    for (const item of hookSummary.checks) {
      const icon = item.status === 'pass'
        ? c('✓', 'green')
        : item.status === 'warn'
          ? c('⚠', 'yellow')
          : c('✗', 'red');
      const label = `${item.platform}/${item.validationMode}`.padEnd(16);
      lines.push(`    ${icon}  ${label} ${item.label}  ${c(item.detail, item.status === 'pass' ? 'dim' : item.status === 'warn' ? 'yellow' : 'red')}`);
      if (verbose && item.script) {
        lines.push(c(`         Script: ${item.script}`, 'dim'));
      }
      if (verbose && item.executable) {
        lines.push(c(`         Runtime: ${item.executable}`, 'dim'));
      }
      if (item.fix && (verbose || item.status === 'fail')) {
        lines.push(c(`         Fix: ${item.fix}`, item.status === 'fail' ? 'yellow' : 'dim'));
      }
    }
  }

  lines.push('');
  lines.push(c('  Summary', 'bold'));
  lines.push(`    Checks:    ${c(String(totalPass), 'green')} pass  ${totalWarn > 0 ? c(String(totalWarn), 'yellow') + ' warn  ' : ''}${totalFail > 0 ? c(String(totalFail), 'red') + ' fail' : ''}`);
  lines.push(`    Freshness: ${c(String(freshPass), 'green')} fresh  ${freshWarn > 0 ? c(String(freshWarn), 'yellow') + ' stale/unverified' : ''}`);
  lines.push(`    MCP:       ${c(String(mcpSummary.pass), 'green')} pass  ${mcpSummary.warn > 0 ? c(String(mcpSummary.warn), 'yellow') + ' warn  ' : ''}${mcpSummary.fail > 0 ? c(String(mcpSummary.fail), 'red') + ' fail' : ''}${c(`(${mcpSummary.declared} declared)`, 'dim')}`);
  lines.push(`    Hooks:     ${c(String(hookSummary.pass), 'green')} pass  ${hookSummary.warn > 0 ? c(String(hookSummary.warn), 'yellow') + ' warn  ' : ''}${hookSummary.fail > 0 ? c(String(hookSummary.fail), 'red') + ' fail' : ''}${c(`(${hookSummary.declared} declared)`, 'dim')}`);
  lines.push(`    Status:    ${overallOk ? c('✓ Healthy', 'green') : c('✗ Issues found', 'red')}`);
  lines.push(`    Duration:  ${elapsed}ms`);
  lines.push('');

  if (!overallOk) {
    lines.push(c('  Run with --verbose for fix suggestions.', 'dim'));
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = { runDoctor };
