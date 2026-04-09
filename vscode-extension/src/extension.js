'use strict';

/**
 * Nerviq VS Code Extension
 *
 * Runs `nerviq audit --json` via child_process and surfaces results
 * in the VS Code status bar, output panel, and diagnostics.
 *
 * All nerviq calls go through the CLI binary (never imported directly)
 * so the extension works regardless of how nerviq is installed.
 */

const vscode = require('vscode');
const { spawnSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { normalizeAuditData, getAuditUrgencySummary, getAuditGrade } = require('./audit-contract');

// ─── State ───────────────────────────────────────────────────────────────────

let statusBarItem;
let outputChannel;
let diagnosticCollection;
let lastAuditResult = null;
let debounceTimer = null;
let isAuditing = false;

// ─── Platform detection ───────────────────────────────────────────────────────

const PLATFORM_SIGNALS = {
  claude:   ['CLAUDE.md', '.claude/CLAUDE.md', '.claude/settings.json'],
  codex:    ['AGENTS.md', '.codex/config.toml'],
  cursor:   ['.cursor/rules', '.cursor/mcp.json', '.cursorrules'],
  copilot:  ['.github/copilot-instructions.md'],
  gemini:   ['GEMINI.md', '.gemini/settings.json'],
  windsurf: ['.windsurf/rules', '.windsurfrules'],
  aider:    ['.aider.conf.yml'],
  opencode: ['opencode.json', '.opencode'],
};

function detectPlatform(workspaceDir) {
  for (const [platform, signals] of Object.entries(PLATFORM_SIGNALS)) {
    for (const signal of signals) {
      if (fs.existsSync(path.join(workspaceDir, signal))) {
        return platform;
      }
    }
  }
  return 'claude'; // default
}

// ─── CLI resolution ───────────────────────────────────────────────────────────

/**
 * Returns the argv to invoke nerviq.
 * Prefers a local installation, then a configured path, then npx.
 */
function getNerviqArgv(workspaceDir, extraArgs = []) {
  const config = vscode.workspace.getConfiguration('nerviq');
  const customPath = config.get('cliPath', '');

  if (customPath && fs.existsSync(customPath)) {
    return { exe: process.execPath, args: [customPath, ...extraArgs] };
  }

  // Try local node_modules
  const localBin = path.join(workspaceDir, 'node_modules', '.bin', 'nerviq');
  const localBinCmd = localBin + (process.platform === 'win32' ? '.cmd' : '');
  if (fs.existsSync(localBinCmd) || fs.existsSync(localBin)) {
    const bin = fs.existsSync(localBinCmd) ? localBinCmd : localBin;
    return { exe: bin, args: extraArgs };
  }

  // Try resolving from parent node_modules (monorepo / dev scenario)
  const parentBin = path.join(workspaceDir, '..', 'node_modules', '.bin', 'nerviq');
  if (fs.existsSync(parentBin)) {
    return { exe: parentBin, args: extraArgs };
  }

  // Fall back to npx
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return { exe: npx, args: ['@nerviq/cli', ...extraArgs] };
}

// ─── Audit runner ─────────────────────────────────────────────────────────────

async function runAudit(workspaceDir, { showProgress = true } = {}) {
  if (isAuditing) return null;
  isAuditing = true;

  const config = vscode.workspace.getConfiguration('nerviq');
  const configPlatform = config.get('platform', 'auto');
  const platform = configPlatform === 'auto' ? detectPlatform(workspaceDir) : configPlatform;

  setStatusBarLoading();

  let progressDisposable;
  if (showProgress) {
    progressDisposable = vscode.window.setStatusBarMessage(`$(loading~spin) Nerviq: auditing ${platform}…`);
  }

  try {
    const { exe, args } = getNerviqArgv(workspaceDir, ['audit', '--platform', platform, '--json']);

    const result = await new Promise((resolve, reject) => {
      const chunks = [];
      const errChunks = [];
      const proc = spawn(exe, args, {
        cwd: workspaceDir,
        env: { ...process.env },
        timeout: 60000,
      });

      proc.stdout.on('data', d => chunks.push(d));
      proc.stderr.on('data', d => errChunks.push(d));

      proc.on('close', (code) => {
        const stdout = Buffer.concat(chunks).toString('utf8');
        const stderr = Buffer.concat(errChunks).toString('utf8');

        // Extract JSON from stdout (may have extra log lines before JSON)
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            resolve({ ok: true, data: parsed, platform, stdout, stderr });
          } catch (e) {
            reject(new Error(`JSON parse failed: ${e.message}\nstdout: ${stdout.slice(0, 500)}`));
          }
        } else if (code !== 0) {
          reject(new Error(`nerviq exited with code ${code}\n${stderr.slice(0, 500)}`));
        } else {
          reject(new Error(`nerviq produced no JSON output\n${stdout.slice(0, 300)}`));
        }
      });

      proc.on('error', reject);
    });

    lastAuditResult = result;
    updateStatusBar(result.data, platform);
    publishDiagnostics(result.data, workspaceDir, platform);
    return result;
  } catch (err) {
    setStatusBarError(err.message);
    return { ok: false, error: err.message };
  } finally {
    isAuditing = false;
    if (progressDisposable) progressDisposable.dispose();
  }
}

async function runHarmonyAudit(workspaceDir) {
  if (isAuditing) return null;
  isAuditing = true;

  setStatusBarLoading();

  try {
    const { exe, args } = getNerviqArgv(workspaceDir, ['harmony-audit', '--json']);

    const result = await new Promise((resolve, reject) => {
      const chunks = [];
      const errChunks = [];
      const proc = spawn(exe, args, {
        cwd: workspaceDir,
        env: { ...process.env },
        timeout: 120000,
      });

      proc.stdout.on('data', d => chunks.push(d));
      proc.stderr.on('data', d => errChunks.push(d));

      proc.on('close', (code) => {
        const stdout = Buffer.concat(chunks).toString('utf8');
        const stderr = Buffer.concat(errChunks).toString('utf8');
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            resolve({ ok: true, data: JSON.parse(jsonMatch[0]), stdout, stderr });
          } catch (e) {
            reject(new Error(`JSON parse failed: ${e.message}`));
          }
        } else {
          reject(new Error(stderr || stdout || `harmony-audit exited ${code}`));
        }
      });

      proc.on('error', reject);
    });

    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    isAuditing = false;
  }
}

// ─── Status bar ───────────────────────────────────────────────────────────────

function setStatusBarLoading() {
  if (!statusBarItem) return;
  statusBarItem.text = '$(loading~spin) Nerviq';
  statusBarItem.tooltip = 'Nerviq audit running…';
  statusBarItem.backgroundColor = undefined;
  statusBarItem.show();
}

function setStatusBarError(msg) {
  if (!statusBarItem) return;
  statusBarItem.text = '$(error) Nerviq';
  statusBarItem.tooltip = `Nerviq error: ${msg}`;
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  statusBarItem.show();
}

let previousScore = null;

function updateStatusBar(auditData, platform) {
  if (!statusBarItem) return;
  if (!vscode.workspace.getConfiguration('nerviq').get('showStatusBar', true)) {
    statusBarItem.hide();
    return;
  }

  const summary = getAuditUrgencySummary(auditData);
  const { score } = summary;
  if (score === null) {
    statusBarItem.hide();
    return;
  }

  // Score delta from previous audit
  let deltaText = '';
  if (previousScore !== null && previousScore !== score) {
    const sign = score > previousScore ? '+' : '';
    deltaText = ` (${sign}${score - previousScore})`;
  }
  previousScore = score;

  const icon = score >= 70 ? '$(shield)' : score >= 40 ? '$(warning)' : '$(error)';
  statusBarItem.text = `${icon} Nerviq ${score}${deltaText}`;

  // Build tooltip with urgency counts
  const { criticalCount, highCount, topAction, passed, failed } = summary;

  const tooltipLines = [
    `Nerviq Audit — ${platform}`,
    `Score: ${score}/100`,
    `Pass: ${passed}  Fail: ${failed}`,
  ];
  if (criticalCount > 0 || highCount > 0) {
    tooltipLines.push(`🔴 ${criticalCount} critical  🟡 ${highCount} high`);
  }
  if (topAction) {
    tooltipLines.push('', `Top fix: ${topAction.name}`);
  }
  tooltipLines.push('', 'Click to view full results');
  statusBarItem.tooltip = tooltipLines.join('\n');

  if (score >= 70) {
    statusBarItem.backgroundColor = undefined;
  } else if (score >= 40) {
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  }

  statusBarItem.show();
}

// ─── Inline diagnostics ──────────────────────────────────────────────────────

/**
 * Map a check ID to the workspace-relative file it belongs to.
 */
const CHECK_FILE_MAP = {
  claudeMd:             'CLAUDE.md',
  architectureDiagram:  'CLAUDE.md',
  verifyCommands:       'CLAUDE.md',
  cursorrules:          '.cursorrules',
  cursorRulesFormat:    '.cursorrules',
  agentsMd:             'AGENTS.md',
  geminiMd:             'GEMINI.md',
  gitIgnoreEnv:         '.gitignore',
  secretsProtection:    '.gitignore',
  hooksRegistered:      '.claude/settings.json',
};

/**
 * Convert impact string to VS Code DiagnosticSeverity.
 */
function impactToSeverity(impact) {
  if (impact === 'critical' || impact === 'high') {
    return vscode.DiagnosticSeverity.Warning;
  }
  return vscode.DiagnosticSeverity.Information;
}

/**
 * Publish diagnostics from audit results into the Problems panel.
 */
function publishDiagnostics(auditData, workspaceDir, platform) {
  if (!diagnosticCollection) return;
  diagnosticCollection.clear();

  const normalized = normalizeAuditData(auditData);
  const failed = normalized.results.filter(r => r.passed === false);
  if (failed.length === 0) return;

  // Determine the default instructions file for unmapped checks
  const defaultFileMap = {
    claude: 'CLAUDE.md', codex: 'AGENTS.md', cursor: '.cursorrules',
    copilot: '.github/copilot-instructions.md', gemini: 'GEMINI.md',
    windsurf: '.windsurfrules', aider: '.aider.conf.yml', opencode: 'opencode.json',
  };
  const defaultFile = defaultFileMap[platform] || 'CLAUDE.md';

  // Group diagnostics by file
  const byFile = new Map();
  for (const r of failed) {
    const relFile = r.file || CHECK_FILE_MAP[r.id] || defaultFile;
    if (!byFile.has(relFile)) byFile.set(relFile, []);

    const message = r.fix ? `${r.name}: ${r.fix}` : r.name;
    const diag = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 0), // line 1 of the file
      message,
      impactToSeverity(r.impact)
    );
    diag.source = 'nerviq';
    diag.code = r.id;
    byFile.get(relFile).push(diag);
  }

  for (const [relFile, diags] of byFile) {
    const absPath = path.join(workspaceDir, relFile);
    diagnosticCollection.set(vscode.Uri.file(absPath), diags);
  }
}

// ─── Output panel ─────────────────────────────────────────────────────────────

function showAuditResults(result, platform) {
  outputChannel.clear();
  outputChannel.show(true); // preserve focus

  if (!result) {
    outputChannel.appendLine('No audit results available. Run "Nerviq: Audit" to generate.');
    return;
  }

  if (!result.ok) {
    outputChannel.appendLine(`❌ Audit failed: ${result.error}`);
    return;
  }

  const data = normalizeAuditData(result.data);
  const score = data.score || 0;
  const grade = getAuditGrade(score);
  const icon = score >= 70 ? '✓' : score >= 40 ? '⚠' : '✗';

  outputChannel.appendLine('');
  outputChannel.appendLine(`  Nerviq Audit — ${platform || result.platform || 'unknown'}`);
  outputChannel.appendLine('  ═══════════════════════════════════════');
  outputChannel.appendLine('');
  outputChannel.appendLine(`  ${icon} Score: ${score}/100  (Grade: ${grade})`);
  outputChannel.appendLine(`  Pass:  ${data.passed}   Fail: ${data.failed}   N/A: ${Math.max(0, data.checkCount - data.passed - data.failed)}`);
  outputChannel.appendLine('');

  // Critical failures
  const criticals = (data.results || []).filter(r => r.passed === false && r.impact === 'critical');
  if (criticals.length > 0) {
    outputChannel.appendLine('  ── CRITICAL ──────────────────────────');
    for (const r of criticals) {
      outputChannel.appendLine(`  ✗ [${r.id}] ${r.name}`);
      if (r.fix) outputChannel.appendLine(`      Fix: ${r.fix}`);
      if (r.file) outputChannel.appendLine(`      File: ${r.file}`);
    }
    outputChannel.appendLine('');
  }

  // High failures
  const highs = (data.results || []).filter(r => r.passed === false && r.impact === 'high');
  if (highs.length > 0) {
    outputChannel.appendLine('  ── HIGH ──────────────────────────────');
    for (const r of highs) {
      outputChannel.appendLine(`  ✗ [${r.id}] ${r.name}`);
      if (r.fix) outputChannel.appendLine(`      Fix: ${r.fix}`);
    }
    outputChannel.appendLine('');
  }

  // Medium/low failures (collapsed)
  const medLow = (data.results || []).filter(r => r.passed === false && (r.impact === 'medium' || r.impact === 'low'));
  if (medLow.length > 0) {
    outputChannel.appendLine('  ── MEDIUM / LOW ──────────────────────');
    for (const r of medLow) {
      outputChannel.appendLine(`  ✗ [${r.id}] ${r.name}`);
    }
    outputChannel.appendLine('');
  }

  if (data.suggestedNextCommand) {
    outputChannel.appendLine(`  Suggested next step: ${data.suggestedNextCommand}`);
    outputChannel.appendLine('');
  }

  outputChannel.appendLine('  ───────────────────────────────────────');
  outputChannel.appendLine('  Run "Nerviq: Harmony Audit" to compare across platforms.');
  outputChannel.appendLine('');
}

function showHarmonyResults(result) {
  outputChannel.clear();
  outputChannel.show(true);

  if (!result || !result.ok) {
    outputChannel.appendLine(`❌ Harmony audit failed: ${result ? result.error : 'no result'}`);
    return;
  }

  const data = result.data;
  outputChannel.appendLine('');
  outputChannel.appendLine('  Nerviq Harmony Audit — Cross-Platform');
  outputChannel.appendLine('  ═══════════════════════════════════════');
  outputChannel.appendLine('');
  outputChannel.appendLine(`  Harmony Score: ${data.harmonyScore || 0}/100`);
  outputChannel.appendLine(`  Active Platforms: ${(data.activePlatforms || []).join(', ') || 'none detected'}`);
  outputChannel.appendLine('');

  if (data.platformScores) {
    outputChannel.appendLine('  ── Platform Scores ───────────────────');
    for (const [plat, score] of Object.entries(data.platformScores)) {
      const icon = score >= 70 ? '✓' : score >= 40 ? '⚠' : '✗';
      outputChannel.appendLine(`  ${icon} ${plat.padEnd(12)} ${score}/100`);
    }
    outputChannel.appendLine('');
  }

  const drifts = data.drifts || [];
  if (drifts.length > 0) {
    const critical = drifts.filter(d => d.severity === 'critical');
    const high = drifts.filter(d => d.severity === 'high');
    outputChannel.appendLine(`  ── Drift (${drifts.length} items) ──────────────────`);
    for (const d of [...critical, ...high].slice(0, 10)) {
      outputChannel.appendLine(`  [${d.severity.toUpperCase()}] ${d.type}: ${d.description}`);
      if (d.recommendation) outputChannel.appendLine(`    → ${d.recommendation}`);
    }
    if (drifts.length > 10) outputChannel.appendLine(`  … and ${drifts.length - 10} more`);
    outputChannel.appendLine('');
  } else {
    outputChannel.appendLine('  ✓ No drift detected across platforms');
    outputChannel.appendLine('');
  }
}

// ─── File watcher ─────────────────────────────────────────────────────────────

const WATCH_PATTERNS = [
  '**/CLAUDE.md',
  '**/AGENTS.md',
  '**/GEMINI.md',
  '**/.cursor/rules/**/*.mdc',
  '**/.gemini/settings.json',
  '**/.windsurf/rules/**/*.md',
  '**/.aider.conf.yml',
  '**/.codex/config.toml',
  '**/opencode.json',
];

function setupFileWatchers(context, workspaceDir) {
  const watchers = [];

  for (const pattern of WATCH_PATTERNS) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceDir, pattern)
    );

    const onChange = (uri) => {
      const config = vscode.workspace.getConfiguration('nerviq');
      if (!config.get('autoAudit', true)) return;

      const debounceMs = config.get('autoAuditDebounceMs', 2000);
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(async () => {
        const result = await runAudit(workspaceDir, { showProgress: false });
        if (result && result.ok) {
          updateStatusBar(result.data, result.platform);
        }
      }, debounceMs);
    };

    watcher.onDidChange(onChange);
    watcher.onDidCreate(onChange);
    watcher.onDidDelete(onChange);
    watchers.push(watcher);
    context.subscriptions.push(watcher);
  }

  return watchers;
}

// ─── Extension activation ─────────────────────────────────────────────────────

async function activate(context) {
  // Create diagnostics collection
  diagnosticCollection = vscode.languages.createDiagnosticCollection('nerviq');
  context.subscriptions.push(diagnosticCollection);

  // Create output channel
  outputChannel = vscode.window.createOutputChannel('Nerviq');
  context.subscriptions.push(outputChannel);

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100);
  statusBarItem.command = 'nerviq.showResults';
  statusBarItem.name = 'Nerviq Score';
  context.subscriptions.push(statusBarItem);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('nerviq.audit', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!folder) {
        vscode.window.showWarningMessage('Nerviq: No workspace folder open.');
        return;
      }
      const result = await runAudit(folder);
      if (result && result.ok) {
        showAuditResults(result, result.platform);
      } else if (result) {
        vscode.window.showErrorMessage(`Nerviq audit failed: ${result.error}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('nerviq.harmony', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!folder) {
        vscode.window.showWarningMessage('Nerviq: No workspace folder open.');
        return;
      }
      const result = await runHarmonyAudit(folder);
      showHarmonyResults(result);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('nerviq.showResults', () => {
      if (lastAuditResult) {
        showAuditResults(lastAuditResult, lastAuditResult.platform);
      } else {
        outputChannel.show(true);
        outputChannel.appendLine('No audit results yet. Run "Nerviq: Audit" (Ctrl+Shift+P → Nerviq: Audit).');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('nerviq.openDocs', () => {
      vscode.env.openExternal(vscode.Uri.parse('https://nerviq.net/docs'));
    })
  );

  // Initial audit on activation
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (folder) {
    setupFileWatchers(context, folder);

    // Run initial audit after a short delay (let VS Code finish loading)
    setTimeout(async () => {
      const result = await runAudit(folder, { showProgress: true });
      if (result && result.ok) {
        updateStatusBar(result.data, result.platform);
      }
    }, 1500);
  }
}

function deactivate() {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (diagnosticCollection) diagnosticCollection.dispose();
  if (statusBarItem) statusBarItem.dispose();
  if (outputChannel) outputChannel.dispose();
}

module.exports = { activate, deactivate };
