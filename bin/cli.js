#!/usr/bin/env node

// macOS pipe-flush guard: console.log(...) + process.exit(N) can drop the
// trailing write when stdout is a pipe (observed on macOS Node 18 and 20;
// truncation at the 8192-byte pipe buffer, or empty on Node 18). Force a
// synchronous flush on fd 1 + fd 2 before actually terminating. Any code
// after process.exit() is still skipped (same semantics as a bare exit),
// we just wait for the kernel to have absorbed the buffered bytes first.
(function installPipeSafeExit() {
  const realExit = process.exit.bind(process);
  process.exit = function safeExit(code) {
    try {
      if (process.stdout && process.stdout.writable && typeof process.stdout._handle?.setBlocking === 'function') {
        process.stdout._handle.setBlocking(true);
      }
      if (process.stderr && process.stderr.writable && typeof process.stderr._handle?.setBlocking === 'function') {
        process.stderr._handle.setBlocking(true);
      }
    } catch {}
    realExit(code);
  };
})();

const { audit, detectPlatforms, getCatalog } = require('../src/public-api');
const { setup } = require('../src/setup');
const { analyzeProject, printAnalysis, exportMarkdown } = require('../src/analyze');
const { buildProposalBundle, printProposalBundle, writePlanFile, applyProposalBundle, printApplyResult } = require('../src/plans');
const { getGovernanceSummary, printGovernanceSummary, ensureWritableProfile, renderGovernanceMarkdown } = require('../src/governance');
const { runBenchmark, printBenchmark, writeBenchmarkReport } = require('../src/benchmark');
const { writeSnapshotArtifact, writeRollbackArtifact, recordRecommendationOutcome, formatRecommendationOutcomeSummary, getRecommendationOutcomeSummary } = require('../src/activity');
const { collectFeedback } = require('../src/feedback');
const { collectAnonymousEvent } = require('../src/telemetry');
const { recordPattern, getPriorityAdjustment, formatUsageSummary } = require('../src/usage-patterns');
const { startServer } = require('../src/server');
const { auditWorkspaces } = require('../src/workspace');
const { scanOrg } = require('../src/org');
const { detectAntiPatterns, printAntiPatterns, printAntiPatternCatalog } = require('../src/anti-patterns');
const { VERIFICATION_DATES, getVerificationDate, getVerificationStats } = require('../src/verification-metadata');
const { init: initI18n, t } = require('../src/i18n');
const { version } = require('../package.json');
const { SNAPSHOT_MILESTONES } = require('../src/activity');

const args = process.argv.slice(2);
const COMMAND_ALIASES = {
  review: 'deep-review',
  wizard: 'interactive',
  learn: 'insights',
  discover: 'audit',
  starter: 'setup',
  suggest: 'suggest-only',
  gov: 'governance',
  outcome: 'feedback',
};
const KNOWN_COMMANDS = ['audit', 'org', 'setup', 'init', 'augment', 'suggest-only', 'plan', 'apply', 'fix', 'rollback', 'governance', 'benchmark', 'deep-review', 'interactive', 'watch', 'badge', 'insights', 'history', 'compare', 'trend', 'scan', 'feedback', 'doctor', 'convert', 'migrate', 'catalog', 'certify', 'serve', 'check-health', 'dashboard', 'harmony-audit', 'harmony-sync', 'harmony-drift', 'harmony-advise', 'harmony-watch', 'harmony-governance', 'harmony-score', 'harmony-demo', 'harmony-add', 'synergy-report', 'anti-patterns', 'rules-export', 'freshness', 'suggest-rules', 'profile', 'baseline', 'exception', 'help', 'version'];

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function suggestCommand(input) {
  const candidates = [...KNOWN_COMMANDS, ...Object.keys(COMMAND_ALIASES)];
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = levenshtein(input, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= 3 ? best : null;
}

function parseNonNegativeIntegerFlag(value, flagName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flagName} requires a non-negative integer`);
  }
  return parsed;
}

function parseWebhookHeader(rawValue) {
  const separator = rawValue.indexOf(':');
  if (separator <= 0) {
    throw new Error('--webhook-header requires NAME: VALUE');
  }
  const name = rawValue.slice(0, separator).trim();
  const value = rawValue.slice(separator + 1).trim();
  if (!name || !value) {
    throw new Error('--webhook-header requires NAME: VALUE');
  }
  return { name, value };
}

function parseArgs(rawArgs) {
  const flags = [];
  let command = 'audit';
  let threshold = null;
  let out = null;
  let planFile = null;
  let only = [];
  let profile = 'safe-write';
  let mcpPacks = [];
  let requireChecks = [];
  let feedbackKey = null;
  let feedbackStatus = null;
  let feedbackEffect = null;
  let feedbackNotes = null;
  let feedbackSource = null;
  let feedbackScoreDelta = null;
  let platform = 'claude';
  let platformExplicit = false;
  let format = null;
  let port = null;
  let workspace = null;
  let targetDir = null;
  let webhookUrl = null;
  let webhookHeaders = [];
  let webhookRetries = null;
  let snapshotTags = [];
  let snapshotMilestone = null;
  let campaigns = [];
  let diffBase = null;
  let diffHead = null;
  let driftMode = null;
  let exceptionOwner = null;
  let exceptionReason = null;
  let exceptionExpires = null;
  let exceptionScope = null;
  let exceptionClass = null;
  let commandSet = false;
  let extraArgs = [];
  let convertFrom = null;
  let convertTo = null;
  let migrateFrom = null;
  let migrateTo = null;
  let checkVersion = null;
  let external = null;
  let repos = [];
  let teamProfile = null;
  let lang = null;
  let commandExplicit = false;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    if (arg === '--threshold' || arg === '--out' || arg === '--plan' || arg === '--only' || arg === '--profile' || arg === '--mcp-pack' || arg === '--require' || arg === '--key' || arg === '--status' || arg === '--effect' || arg === '--notes' || arg === '--source' || arg === '--score-delta' || arg === '--platform' || arg === '--dir' || arg === '--format' || arg === '--from' || arg === '--to' || arg === '--port' || arg === '--workspace' || arg === '--check-version' || arg === '--webhook' || arg === '--webhook-header' || arg === '--webhook-retries' || arg === '--external' || arg === '--team-profile' || arg === '--lang' || arg === '--tag' || arg === '--milestone' || arg === '--campaign' || arg === '--diff-base' || arg === '--diff-head' || arg === '--drift-mode' || arg === '--owner' || arg === '--reason' || arg === '--expires' || arg === '--scope' || arg === '--class') {
      const value = rawArgs[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === '--threshold') threshold = value;
      if (arg === '--out') out = value;
      if (arg === '--plan') planFile = value;
      if (arg === '--only') only = value.split(',').map(item => item.trim()).filter(Boolean);
      if (arg === '--profile') profile = value.trim();
      if (arg === '--mcp-pack') mcpPacks = value.split(',').map(item => item.trim()).filter(Boolean);
      if (arg === '--require') requireChecks = value.split(',').map(item => item.trim()).filter(Boolean);
      if (arg === '--key') feedbackKey = value.trim();
      if (arg === '--status') feedbackStatus = value.trim();
      if (arg === '--effect') feedbackEffect = value.trim();
      if (arg === '--notes') feedbackNotes = value;
      if (arg === '--source') feedbackSource = value.trim();
      if (arg === '--score-delta') feedbackScoreDelta = value.trim();
      if (arg === '--platform') { platform = value.trim().toLowerCase(); platformExplicit = true; }
      if (arg === '--dir') targetDir = require('path').resolve(value.trim());
      if (arg === '--format') format = value.trim().toLowerCase();
      if (arg === '--from') { convertFrom = value.trim(); migrateFrom = value.trim(); }
      if (arg === '--to') { convertTo = value.trim(); migrateTo = value.trim(); }
      if (arg === '--port') port = value.trim();
      if (arg === '--workspace') workspace = value.trim();
      if (arg === '--check-version') checkVersion = value.trim();
      if (arg === '--webhook') webhookUrl = value.trim();
      if (arg === '--webhook-header') webhookHeaders.push(parseWebhookHeader(value));
      if (arg === '--webhook-retries') webhookRetries = parseNonNegativeIntegerFlag(value.trim(), '--webhook-retries');
      if (arg === '--external') external = value.trim();
      if (arg === '--team-profile') teamProfile = value.trim();
      if (arg === '--lang') lang = value.trim().toLowerCase();
      if (arg === '--tag') snapshotTags.push(value.trim());
      if (arg === '--milestone') snapshotMilestone = value.trim().toLowerCase();
      if (arg === '--campaign') campaigns = value.split(',').map(item => item.trim()).filter(Boolean);
      if (arg === '--diff-base') diffBase = value.trim();
      if (arg === '--diff-head') diffHead = value.trim();
      if (arg === '--drift-mode') driftMode = value.trim().toLowerCase();
      if (arg === '--owner') exceptionOwner = value.trim();
      if (arg === '--reason') exceptionReason = value;
      if (arg === '--expires') exceptionExpires = value.trim();
      if (arg === '--scope') exceptionScope = value.trim().toLowerCase();
      if (arg === '--class') exceptionClass = value.trim().toLowerCase();
      i++;
      continue;
    }

    if (arg.startsWith('--lang=')) {
      lang = arg.split('=').slice(1).join('=').trim().toLowerCase();
      continue;
    }

    if (arg.startsWith('--team-profile=')) {
      teamProfile = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--external=')) {
      external = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--tag=')) {
      snapshotTags.push(arg.split('=').slice(1).join('=').trim());
      continue;
    }

    if (arg.startsWith('--milestone=')) {
      snapshotMilestone = arg.split('=').slice(1).join('=').trim().toLowerCase();
      continue;
    }

    if (arg.startsWith('--campaign=')) {
      campaigns = arg.split('=').slice(1).join('=').split(',').map(item => item.trim()).filter(Boolean);
      continue;
    }

    if (arg.startsWith('--diff-base=')) {
      diffBase = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--diff-head=')) {
      diffHead = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--drift-mode=')) {
      driftMode = arg.split('=').slice(1).join('=').trim().toLowerCase();
      continue;
    }

    if (arg.startsWith('--owner=')) {
      exceptionOwner = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--reason=')) {
      exceptionReason = arg.split('=').slice(1).join('=');
      continue;
    }

    if (arg.startsWith('--expires=')) {
      exceptionExpires = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--scope=')) {
      exceptionScope = arg.split('=').slice(1).join('=').trim().toLowerCase();
      continue;
    }

    if (arg.startsWith('--class=')) {
      exceptionClass = arg.split('=').slice(1).join('=').trim().toLowerCase();
      continue;
    }

    if (arg === '--repos') {
      // Collect all following non-flag args as repo paths (supports comma-separated too)
      while (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('--')) {
        i++;
        repos.push(...rawArgs[i].split(',').map(s => s.trim()).filter(Boolean));
      }
      if (repos.length === 0) throw new Error('--repos requires at least one path');
      continue;
    }

    if (arg.startsWith('--repos=')) {
      repos = arg.split('=').slice(1).join('=').split(',').map(s => s.trim()).filter(Boolean);
      if (repos.length === 0) throw new Error('--repos requires at least one path');
      continue;
    }

    if (arg.startsWith('--require=')) {
      requireChecks = arg.split('=').slice(1).join('=').split(',').map(item => item.trim()).filter(Boolean);
      continue;
    }

    if (arg.startsWith('--threshold=')) {
      threshold = arg.split('=')[1];
      continue;
    }

    if (arg.startsWith('--out=')) {
      out = arg.split('=').slice(1).join('=');
      continue;
    }

    if (arg.startsWith('--plan=')) {
      planFile = arg.split('=').slice(1).join('=');
      continue;
    }

    if (arg.startsWith('--only=')) {
      only = arg.split('=').slice(1).join('=').split(',').map(item => item.trim()).filter(Boolean);
      continue;
    }

    if (arg.startsWith('--profile=')) {
      profile = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--mcp-pack=')) {
      mcpPacks = arg.split('=').slice(1).join('=').split(',').map(item => item.trim()).filter(Boolean);
      continue;
    }

    if (arg.startsWith('--key=')) {
      feedbackKey = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--status=')) {
      feedbackStatus = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--effect=')) {
      feedbackEffect = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--notes=')) {
      feedbackNotes = arg.split('=').slice(1).join('=');
      continue;
    }

    if (arg.startsWith('--source=')) {
      feedbackSource = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--score-delta=')) {
      feedbackScoreDelta = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--platform=')) {
      platform = arg.split('=').slice(1).join('=').trim().toLowerCase();
      platformExplicit = true;
      continue;
    }

    if (arg.startsWith('--dir=')) {
      targetDir = require('path').resolve(arg.split('=').slice(1).join('=').trim());
      continue;
    }

    if (arg.startsWith('--format=')) {
      format = arg.split('=').slice(1).join('=').trim().toLowerCase();
      continue;
    }

    if (arg.startsWith('--port=')) {
      port = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--workspace=')) {
      workspace = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--check-version=')) {
      checkVersion = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--webhook=')) {
      webhookUrl = arg.split('=').slice(1).join('=').trim();
      continue;
    }

    if (arg.startsWith('--webhook-header=')) {
      webhookHeaders.push(parseWebhookHeader(arg.split('=').slice(1).join('=')));
      continue;
    }

    if (arg.startsWith('--webhook-retries=')) {
      webhookRetries = parseNonNegativeIntegerFlag(arg.split('=').slice(1).join('=').trim(), '--webhook-retries');
      continue;
    }

    if (arg.startsWith('--')) {
      flags.push(arg);
      continue;
    }

    if (!commandSet) {
      command = arg;
      commandSet = true;
      commandExplicit = true;
    } else {
      extraArgs.push(arg);
    }
  }

  const normalizedCommand = COMMAND_ALIASES[command] || command;

  return { flags, command, commandExplicit, normalizedCommand, threshold, out, planFile, only, profile, mcpPacks, requireChecks, feedbackKey, feedbackStatus, feedbackEffect, feedbackNotes, feedbackSource, feedbackScoreDelta, platform, platformExplicit, format, port, workspace, targetDir, extraArgs, convertFrom, convertTo, migrateFrom, migrateTo, checkVersion, webhookUrl, webhookHeaders, webhookRetries, external, repos, teamProfile, lang, snapshotTags, snapshotMilestone, campaigns, diffBase, diffHead, driftMode, exceptionOwner, exceptionReason, exceptionExpires, exceptionScope, exceptionClass };
}

function printWorkspaceSummary(summary, options) {
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const rootScore = summary.rootGovernance?.score === null ? 'ERR' : `${summary.rootGovernance?.score ?? 0}/100`;
  const workspaceAverage = summary.workspaceAggregate?.score ?? summary.averageScore;

  console.log('');
  console.log('\x1b[1m  nerviq workspace audit\x1b[0m');
  console.log('\x1b[2m  ═══════════════════════════════════════\x1b[0m');
  console.log(`  Root: ${summary.rootDir}`);
  console.log(`  Platform: ${summary.platform}`);
  console.log(`  Workspaces: ${summary.workspaceCount}`);
  if (summary.patterns?.length > 0) {
    console.log(`  Selection: ${summary.patterns.join(', ')}`);
  }
  console.log(`  Root governance audit: \x1b[1m${rootScore}\x1b[0m`);
  console.log(`  Workspace audit average: \x1b[1m${workspaceAverage}/100\x1b[0m`);
  if (summary.profileBreakdown?.length > 0) {
    const profileLine = summary.profileBreakdown
      .map((item) => `${item.profileLabel} (${item.workspaceCount})`)
      .join(', ');
    console.log(`  Workspace profiles: ${profileLine}`);
  }
  console.log('  Score semantics: root governance shows shared repo policy health; workspace average shows package-level coverage across the selected workspaces.');
  console.log('  Aggregate vs package: per-workspace scores can legitimately trail the root repo score in a monorepo.');
  console.log('  Stack-specific checks: Go, Python, Node, and other workspace types can have different applicable totals.');
  console.log('');
  console.log('\x1b[1m  Workspace                  Profile              Audit  Pass  Total  Top action\x1b[0m');
  console.log('  ' + '─'.repeat(96));
  for (const item of summary.workspaces) {
    const score = item.score === null ? 'ERR' : String(item.score);
    const topAction = item.error || item.topAction || '-';
    const profile = (item.workspaceProfile?.label || 'General workspace').slice(0, 20);
    console.log(`  ${item.workspace.padEnd(26)} ${profile.padEnd(20)} ${score.padStart(5)} ${String(item.passed).padStart(5)} ${String(item.total).padStart(6)}  ${topAction}`);
    if (item.stackLabels?.length > 0) {
      console.log(`\x1b[2m     Stacks: ${item.stackLabels.join(', ')}\x1b[0m`);
    }
  }
  console.log('');
}

function printCompareCheckSection(title, items, prefix) {
  if (!Array.isArray(items) || items.length === 0) return;
  console.log(`  ${title} (${items.length}):`);
  for (const item of items) {
    const impact = item.impact ? ` [${item.impact}]` : '';
    const category = item.category ? ` — ${item.category}` : '';
    console.log(`    ${prefix} ${item.key}${impact}: ${item.name}${category}`);
  }
}

function printScanDetail(summary, options) {
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('');
  console.log('\x1b[1m  nerviq scan — per-repo comparison\x1b[0m');
  console.log('\x1b[2m  ═══════════════════════════════════════\x1b[0m');
  console.log(`  Platform: ${summary.platform}  |  Repos: ${summary.repoCount}  |  Average: \x1b[1m${summary.averageScore}/100\x1b[0m`);
  if (summary.scoreSemantics?.note) {
    console.log(`  Score semantics: ${summary.scoreSemantics.note}`);
  }
  console.log('');

  for (const item of summary.repos) {
    if (item.error) {
      console.log(`  \x1b[31m✗ ${item.name}\x1b[0m — ${item.error}`);
      console.log('');
      continue;
    }
    const scoreColor = item.score >= 80 ? '\x1b[32m' : item.score >= 50 ? '\x1b[33m' : '\x1b[31m';
    console.log(`  \x1b[1m${item.name}\x1b[0m  ${scoreColor}${item.score}/100\x1b[0m  (${item.passed}/${item.total} checks passed)`);
    if (item.policyCoverage?.layerKeys?.length > 0) {
      console.log(`    \x1b[2mPolicy layers: ${item.policyCoverage.layerKeys.join(' -> ')}\x1b[0m`);
    }

    // Show per-category breakdown if result is available
    if (item.result && item.result.results) {
      const STACK_LANGUAGES = new Set(['python', 'go', 'rust', 'java', 'ruby', 'dotnet', 'php', 'flutter', 'swift', 'kotlin']);
      const categories = {};
      for (const r of item.result.results) {
        const cat = r.category || 'other';
        if (!categories[cat]) categories[cat] = { passed: 0, total: 0 };
        categories[cat].total++;
        if (r.passed) categories[cat].passed++;
      }
      const catEntries = Object.entries(categories)
        .filter(([cat, v]) => v.passed > 0 || !STACK_LANGUAGES.has(cat))
        .sort((a, b) => (a[1].passed / a[1].total) - (b[1].passed / b[1].total));
      const catLine = catEntries.map(([cat, v]) => `${cat}: ${v.passed}/${v.total}`).join('  ');
      console.log(`    \x1b[2m${catLine}\x1b[0m`);
    }

    // Show top 3 gaps
    if (item.result && item.result.topNextActions && item.result.topNextActions.length > 0) {
      const gaps = item.result.topNextActions.slice(0, 3);
      console.log('    Top gaps:');
      for (const gap of gaps) {
        console.log(`      \x1b[33m→\x1b[0m ${gap.name || gap.key}${gap.impact ? ` \x1b[2m(+${gap.impact})\x1b[0m` : ''}`);
      }
    }
    console.log('');
  }
}

function printOrgSummary(summary, options) {
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log('');
  console.log('\x1b[1m  nerviq org scan\x1b[0m');
  console.log('\x1b[2m  ═══════════════════════════════════════\x1b[0m');
  console.log(`  Platform: ${summary.platform}`);
  console.log(`  Repos: ${summary.repoCount}`);
  console.log(`  Average score: \x1b[1m${summary.averageScore}/100\x1b[0m`);
  if (summary.scoreSemantics?.note) {
    console.log(`  Score semantics: ${summary.scoreSemantics.note}`);
  }
  if (summary.policyCoverage) {
    console.log(`  Policy coverage: org=${summary.policyCoverage.orgPolicyRepos} team=${summary.policyCoverage.teamPolicyRepos} repo=${summary.policyCoverage.repoPolicyRepos}`);
  }
  if (summary.scoreBands) {
    console.log(`  Bands: strong=${summary.scoreBands.strong} developing=${summary.scoreBands.developing} bootstrap=${summary.scoreBands.bootstrap} unknown=${summary.scoreBands.unknown}`);
  }
  console.log('');
  console.log('\x1b[1m  Repo              Platform  Score  Policy        Top action\x1b[0m');
  console.log('  ' + '─'.repeat(72));
  for (const item of summary.repos) {
    const score = item.score === null ? 'ERR' : String(item.score);
    const topAction = item.error || item.topAction || '-';
    const policy = item.policyCoverage?.layerKeys?.length > 0 ? item.policyCoverage.layerKeys.join('/') : '-';
    console.log(`  ${item.name.padEnd(18)} ${item.platform.padEnd(8)} ${score.padStart(5)}  ${policy.padEnd(12)} ${topAction}`);
  }
  if (Array.isArray(summary.topEvidence) && summary.topEvidence.length > 0) {
    console.log('');
    console.log('  Common top evidence:');
    for (const item of summary.topEvidence) {
      console.log(`    - ${item.key} (${item.repoCount} repos)`);
    }
  }
  console.log('');
}

function writeStdout(text) {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

const HELP = `
  nerviq v${version}
  The intelligent nervous system for AI coding agents.
  Audit, align, and amplify every platform on every project.
  New here? Run: nerviq --beginner

  DISCOVER
    nerviq audit                  Quick scan: score + top 3 gaps (Harmony-first when 2+ platforms detected)
    nerviq audit --no-harmony-first   Skip the cross-platform Harmony header
    nerviq audit --full           Full audit with all checks, weakest areas, badge
    nerviq audit --platform X     Audit specific platform (claude|codex|cursor|copilot|gemini|windsurf|aider|opencode)
    nerviq audit --json           Machine-readable JSON output (for CI)
    nerviq audit --workspace packages/*     Audit monorepo workspaces with stack-specific package profiles
    nerviq scan dir1 dir2         Compare multiple repos side-by-side
    nerviq org scan dir1 dir2     Aggregate multiple repos into one score table
    nerviq org policy [dir]       Inspect resolved org/team/repo policy layers
    nerviq catalog                Full check catalog (all 8 platforms)
    nerviq catalog --json         Export full check catalog as JSON
    nerviq anti-patterns          Detect anti-patterns in current project
    nerviq anti-patterns --all    Show full anti-pattern catalog

  SETUP
    nerviq setup                  Generate starter-safe baseline config files
    nerviq setup --auto           Apply all generated files without prompts
    nerviq interactive            Step-by-step guided wizard
    nerviq baseline init          Lock the first managed Nerviq baseline for continuous ops
    nerviq baseline status        Show the current managed baseline contract
    nerviq check-health           Detect regressions + platform format changes between snapshots
    nerviq doctor                 Self-diagnostics: Node, deps, freshness, MCP, hook runtime

  FIX
    nerviq fix                    Show fixable checks and manual-fix guidance
    nerviq fix <key>              Auto-fix a specific check (with score impact)
    nerviq fix <key> --prompt     Show AI agent prompt for a check (no auto-fix)
    nerviq fix --all-critical     Fix all critical issues at once
    nerviq fix --dry-run          Preview fixes without writing
    nerviq fix --auto             Apply fixes without confirmation prompt
    nerviq rollback               Undo the most recent apply (delete created files)
    nerviq rollback --list        Show available rollback points
    nerviq rollback --dry-run     Preview what would be deleted

  IMPROVE
    nerviq augment                Improvement plan (no writes)
    nerviq suggest-only           Structured report for sharing (no writes)
    nerviq plan                   Export proposal bundles with diffs
    nerviq plan --campaign X      Export a named upgrade campaign slice
    nerviq plan --out plan.json   Save plan to file
    nerviq apply                  Apply proposals selectively with rollback
    nerviq apply --campaign X     Apply a named upgrade campaign
    nerviq apply --dry-run        Preview changes without writing

  GOVERN
    nerviq governance             Permission profiles + hooks + policy packs (the rollout safety layer)
    nerviq governance --json      Machine-readable governance summary
    nerviq benchmark              Baseline vs projected score in isolated temp copy
    nerviq benchmark --external /path  Benchmark an external repo
    nerviq freshness              Show verification freshness for all checks
    nerviq certify                Generate certification badge for your project

  CROSS-PLATFORM
    nerviq harmony-audit          Drift detection across all active platforms (GA)
    nerviq harmony-sync           Preview cross-platform sync (dry run, GA)
    nerviq harmony-sync --fix     Apply cross-platform sync (write files, GA)
    nerviq harmony-sync --json    JSON output for CI/automation
    nerviq harmony-score           Standalone Harmony Score (0-100) with badge + CI gate
    nerviq harmony-score --badge   Include shields.io badge markdown
    nerviq harmony-score --threshold 70  CI gate: exit 1 if score < threshold
    nerviq harmony-score --quiet   Score number only (for piping)
    nerviq harmony-demo           Zero-setup demo — see Harmony in action instantly
    nerviq harmony-add <platform>  Add a new platform to the project
    nerviq synergy-report         [EXPERIMENTAL] Static-rule multi-agent amplification report
    nerviq convert --from X --to Y   Convert configs between platforms
    nerviq migrate --platform X   Platform version migration helper
    nerviq migrate --platform cursor --from v2 --to v3

  MONITOR
    nerviq dashboard              Generate static dashboard from latest audit snapshot (or live audit if none)
    nerviq dashboard --out F      Save dashboard to custom file
    nerviq dashboard --open       Open dashboard in browser after generating
    nerviq watch                  Live config monitoring (re-audits on file change)
    nerviq audit --diff-only --drift-mode ci   PR / CI drift review against the managed baseline
    nerviq history                Audit snapshot history from saved snapshots
    nerviq compare                Detailed per-check diff between latest two audit snapshots
    nerviq trend                  Audit snapshot trend over time
    nerviq trend --out report.md  Export trend report as markdown
    nerviq audit --snapshot --milestone baseline --tag "baseline"  Save a lifecycle checkpoint
    nerviq feedback               Record recommendation outcomes

  EXCEPTIONS
    nerviq exception add --key permissionDeny --owner team --reason "migration in progress" --expires 2026-05-01
    nerviq exception add --class policy-drift --scope ci --owner team --reason "temporary rollout" --expires 2026-05-01
    nerviq exception list         Show active and expired exceptions
    nerviq exception prune        Remove expired exceptions

  TEAM PROFILES
    nerviq profile save <name>    Save current preferences as a named profile
    nerviq profile load <name>    Load and display a saved profile
    nerviq profile list           List available profiles
    nerviq profile export <name>  Export profile JSON for sharing

  ADVANCED
    nerviq deep-review            AI-powered config review (opt-in, uses API key)
    nerviq deep-review --behavioral  Local behavioral drift review (opt-in, no API)
    nerviq serve --port 3000      Start local Nerviq HTTP API server + OpenAPI contract
    nerviq badge                  Generate shields.io badge markdown
    nerviq rules-export           Export recommendation rules as JSON
    nerviq rules-export --out F   Save rules to file
    nerviq suggest-rules          Auto-suggest rules based on usage patterns

  OPTIONS
    --platform NAME   Platform: claude (default), codex, cursor, copilot, gemini, windsurf, aider, opencode
    --dir PATH        Target directory to audit (default: current directory)
    --threshold N     Exit code 1 if score < N  (CI gate)
    --require A,B     Exit code 1 if named checks fail
    --out FILE        Write output to file (JSON or markdown)
    --plan FILE       Load previously exported plan file
    --only A,B        Limit plan/apply to selected proposal IDs
    --profile NAME    Permission profile: read-only | suggest-only | safe-write | power-user
    --team-profile N  Load a saved team profile for audit (overrides threshold/platform)
    --mcp-pack A,B    Merge MCP packs into setup (live tool connectors; e.g. context7-docs,next-devtools)
    --check-version V Pin catalog to a specific version (warn on mismatch)
    --format NAME     Output format: json | sarif | otel
    --webhook URL     Send audit results to a webhook (Slack/Discord/generic JSON)
    --webhook-header H Add a custom webhook header (repeat; format: Name: Value)
    --webhook-retries N Retry transient webhook failures N times (default: 2)
    --external PATH   Benchmark an external repo instead of cwd
    --port N          Port for \`serve\` (default: 3000)
    --workspace GLOBS Audit workspaces separately with root/package score semantics and stack-specific profiles
    --diff-only       Audit only changed files / linked config surfaces from git diff
    --drift-mode M    Continuous posture mode: ci | pr | watch
    --diff-base SHA   Base SHA for diff-only mode (defaults to PR env vars when present)
    --diff-head SHA   Head SHA for diff-only mode (defaults to GITHUB_SHA or HEAD)
    --snapshot        Save snapshot artifact under .claude/nerviq/snapshots/
    --tag LABEL       Tag the saved snapshot (use with --snapshot; repeat or comma-separate for more)
    --milestone NAME  Snapshot lifecycle milestone: baseline | post-fix | pre-upgrade | release
    --campaign A,B    Limit plan/apply to named upgrade campaigns
    --full            Show full audit output (all checks, weakest areas, badge)
    --lite            Short top-3 scan (default behavior since v1.5.2)
    --dry-run         Preview changes without writing files
    --config-only     Only write config files (.claude/, rules, hooks) — never source code
    --verbose         Full audit + medium-priority recommendations
    --show-deprecated Show deprecated checks (excluded from scoring)
    --json            Output as JSON
    --agent-mode      Non-interactive JSON output for AI agents (setup/audit)
    --auto            Apply all generated files without prompting
    --beginner        Show only the 5 starter commands for first-time users
    --key NAME        Feedback: recommendation key (e.g. permissionDeny)
    --status VALUE    Feedback: accepted | rejected | deferred
    --effect VALUE    Feedback: positive | neutral | negative
    --score-delta N   Feedback: observed score delta
    --owner NAME      Exception owner
    --reason TEXT     Exception reason
    --expires DATE    Exception expiry (ISO date or date-time)
    --scope NAME      Exception scope: all | ci | watch | pr
    --class NAME      Exception target class: policy-drift | config-drift | platform-drift | maturity-opportunity
    --behavioral      Run the opt-in local behavioral drift / outcome-layer review
    --history         With deep-review --behavioral, show behavioral snapshot history
    --compare         With deep-review --behavioral, compare the latest two behavioral snapshots
    --help            Show this help
    --version         Show version

  EXAMPLES
    npx nerviq --beginner
    npx nerviq
    npx nerviq --lite
    npx nerviq --platform cursor
    npx nerviq audit --workspace packages/*
    npx nerviq baseline init
    npx nerviq audit --diff-only --drift-mode ci
    npx nerviq --platform codex augment
    npx nerviq org scan ./app ./api ./infra
    npx nerviq org policy
    npx nerviq scan ./app ./api ./infra
    npx nerviq harmony-audit
    npx nerviq convert --from claude --to codex
    npx nerviq migrate --platform cursor --from v2 --to v3
    npx nerviq setup --mcp-pack context7-docs
    npx nerviq plan --campaign governance-hardening
    npx nerviq apply --plan plan.json --only hooks,commands
    npx nerviq serve --port 4000
    npx nerviq --json --threshold 70
    npx nerviq catalog --json --out catalog.json
    npx nerviq feedback --key permissionDeny --status accepted --effect positive

  EXIT CODES
    0  Success (score meets threshold, or no threshold set)
    1  Threshold not met (score below --threshold)
    2  Runtime error (unknown command, missing files, crash)
`;

const BEGINNER_HELP = `
  nerviq v${version}
  Start here.

  If this is your first time, learn just these 5 commands:

  STARTER COMMANDS
    nerviq audit      Score the repo and show the top gaps
    nerviq setup      Generate a starter-safe baseline
    nerviq fix        Fix what can be fixed or show manual fix guidance
    nerviq augment    Show an improvement plan without writing
    nerviq doctor     Check install health, freshness, platform detection, MCP, and hook runtime

  SIMPLE PATH
    1. nerviq audit
    2. nerviq setup --auto
    3. nerviq fix --all-critical --auto
    4. nerviq augment
    5. nerviq doctor

  WHEN YOU ARE READY
    nerviq --help     Show the full command set
    Docs: https://nerviq.net/docs/getting-started
`;

async function main() {
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    console.error(`\n  Error: ${err.message}\n`);
    process.exit(2);
  }

  const { flags, command, commandExplicit, normalizedCommand } = parsed;

  // Initialize i18n with --lang flag or NERVIQ_LANG env var
  if (parsed.lang) {
    initI18n(parsed.lang);
  }

  if (flags.includes('--version') || command === 'version') {
    console.log(version);
    process.exit(0);
  }

  if (flags.includes('--beginner') && (!commandExplicit || flags.includes('--help') || command === 'help')) {
    console.log(BEGINNER_HELP);
    process.exit(0);
  }

  if (flags.includes('--help') || command === 'help') {
    console.log(HELP);
    process.exit(0);
  }

  const options = {
    verbose: flags.includes('--verbose'),
    json: flags.includes('--json'),
    auto: flags.includes('--auto'),
    lite: flags.includes('--full') || flags.includes('--verbose') ? false : true,
    full: flags.includes('--full'),
    showDeprecated: flags.includes('--show-deprecated'),
    snapshot: flags.includes('--snapshot'),
    feedback: flags.includes('--feedback'),
    fix: flags.includes('--fix'),
    badge: flags.includes('--badge'),
    quiet: flags.includes('--quiet'),
    agentMode: flags.includes('--agent-mode'),
    autoSync: flags.includes('--auto-sync'),
    dryRun: flags.includes('--dry-run'),
    configOnly: flags.includes('--config-only'),
    threshold: parsed.threshold !== null ? Number(parsed.threshold) : null,
    out: parsed.out,
    planFile: parsed.planFile,
    only: parsed.only,
    profile: parsed.profile,
    mcpPacks: parsed.mcpPacks,
    require: parsed.requireChecks,
    platform: parsed.platform || 'claude',
    platformExplicit: Boolean(parsed.platformExplicit),
    format: parsed.format || null,
    port: parsed.port !== null ? Number(parsed.port) : null,
    workspace: parsed.workspace || null,
    webhookUrl: parsed.webhookUrl || null,
    webhookHeaders: Object.fromEntries((parsed.webhookHeaders || []).map((entry) => [entry.name, entry.value])),
    webhookRetries: parsed.webhookRetries ?? 2,
    lang: parsed.lang || null,
    external: parsed.external || null,
    snapshotTags: parsed.snapshotTags || [],
    snapshotMilestone: parsed.snapshotMilestone || null,
    campaigns: parsed.campaigns || [],
    behavioral: flags.includes('--behavioral'),
    historyView: flags.includes('--history'),
    compareView: flags.includes('--compare'),
    diffOnly: flags.includes('--diff-only'),
    noHarmonyFirst: flags.includes('--no-harmony-first'),
    diffBase: parsed.diffBase || null,
    diffHead: parsed.diffHead || null,
    driftMode: parsed.driftMode || null,
    exceptionOwner: parsed.exceptionOwner || null,
    exceptionReason: parsed.exceptionReason || null,
    exceptionExpires: parsed.exceptionExpires || null,
    exceptionScope: parsed.exceptionScope || null,
    exceptionClass: parsed.exceptionClass || null,
    dir: parsed.targetDir || process.cwd()
  };

  if (options.snapshotTags.length > 0 && !options.snapshot) {
    console.error('\n  Error: --tag requires --snapshot.\n');
    process.exit(2);
  }

  if (options.snapshotMilestone && !options.snapshot) {
    console.error('\n  Error: --milestone requires --snapshot.\n');
    process.exit(2);
  }

  if (options.snapshotMilestone && !SNAPSHOT_MILESTONES.includes(options.snapshotMilestone)) {
    console.error(`\n  Error: Unsupported milestone '${options.snapshotMilestone}'. Use one of: ${SNAPSHOT_MILESTONES.join(', ')}.\n`);
    process.exit(2);
  }

  if (options.diffOnly && options.snapshot) {
    console.error('\n  Error: --diff-only cannot be combined with --snapshot because diff-only scores are not comparable to full audit snapshots.\n');
    process.exit(2);
  }

  if (options.driftMode && !['ci', 'pr', 'watch'].includes(options.driftMode)) {
    console.error(`\n  Error: Unsupported drift mode '${options.driftMode}'. Use ci, pr, or watch.\n`);
    process.exit(2);
  }

  if (parsed.checkVersion) {
    if (parsed.checkVersion !== version) {
      console.error(`\n  Warning: --check-version ${parsed.checkVersion} does not match installed nerviq version ${version}.`);
      console.error(`  Check catalog may differ between versions. To align, run: npm install @nerviq/cli@${parsed.checkVersion}`);
      console.error('');
    }
    options.checkVersion = parsed.checkVersion;
  }

  const {
    resolvePolicyLayers,
    applyPolicyLayersToOptions,
    formatPolicyContract,
  } = require('../src/policy-layers');
  const inheritedPolicyContract = resolvePolicyLayers(options.dir);
  if (inheritedPolicyContract.layers.some((layer) => layer.valid)) {
    Object.assign(options, applyPolicyLayersToOptions(inheritedPolicyContract, options));
    options.policyContract = inheritedPolicyContract;
  }

  if (parsed.teamProfile) {
    const { loadProfile, applyProfileToOptions } = require('../src/profiles');
    try {
      const teamProf = loadProfile(options.dir, parsed.teamProfile);
      const merged = applyProfileToOptions(teamProf, options);
      Object.assign(options, merged);
      if (!options.json) {
        console.log(`  Using team profile: ${parsed.teamProfile}`);
      }
    } catch (err) {
      console.error(`\n  Error: ${err.message}\n`);
      process.exit(1);
    }
  }

  // Apply built-in governance profile (--profile flag) to audit options
  if (parsed.profile && parsed.profile !== 'safe-write') {
    const { getPermissionProfile } = require('../src/governance');
    const govProfile = getPermissionProfile(parsed.profile);
    if (govProfile) {
      options.governanceProfile = govProfile;
      if (govProfile.deny && govProfile.deny.length > 0) {
        options.suppressedChecks = options.suppressedChecks || [];
      }
      if (!options.json) {
        console.log(`  Using governance profile: ${govProfile.label} (${govProfile.risk} risk)`);
      }
    }
  }

  const SUPPORTED_PLATFORMS = ['claude', 'codex', 'gemini', 'copilot', 'cursor', 'windsurf', 'aider', 'opencode'];
  if (!SUPPORTED_PLATFORMS.includes(options.platform)) {
    console.error(`\n  Error: Unsupported platform '${options.platform}'.`);
    console.error(`  Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}.`);
    console.error(`  To get started: npx nerviq setup`);
    console.error(`  To diagnose issues: npx nerviq doctor`);
    console.error('  Docs: https://github.com/nerviq/nerviq#cross-platform\n');
    process.exit(1);
  }

  if (options.format !== null && !['json', 'sarif', 'otel'].includes(options.format)) {
    console.error(`\n  Error: Unsupported format '${options.format}'. Use 'json', 'sarif', or 'otel'.\n`);
    process.exit(1);
  }

  if (options.driftMode && options.format !== null) {
    console.error('\n  Error: --drift-mode is only supported with normal text output or --json.\n');
    process.exit(1);
  }

  if (options.port !== null && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) {
    console.error('\n  Error: --port must be an integer between 0 and 65535.\n');
    process.exit(1);
  }

  if (options.threshold !== null && (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 100)) {
    console.error(`\n  Error: Invalid threshold value '${parsed.threshold}'.`);
    console.error('  Why: --threshold must be a number between 0 and 100 representing the minimum passing score.');
    console.error('  Fix: Use a valid number, e.g.: npx nerviq --threshold 70');
    console.error('  Docs: https://github.com/nerviq/nerviq#ci-integration\n');
    process.exit(1);
  }

  if (options.require && options.require.length > 0 && normalizedCommand !== 'audit' && !['audit', 'discover'].includes(command)) {
    console.error(`\n  Warning: --require is only supported with the audit command. Ignoring for '${normalizedCommand}'.\n`);
  }

  if (!KNOWN_COMMANDS.includes(normalizedCommand)) {
    const suggestion = suggestCommand(command);
    console.error(`\n  Error: Unknown command '${command}'.`);
    console.error(`  Why: '${command}' is not a recognized nerviq command or alias.`);
    if (suggestion) {
      console.error(`  Fix: Did you mean '${suggestion}'? Run: npx nerviq ${suggestion}`);
    } else {
      console.error('  Fix: Run nerviq --help to see all available commands.');
    }
    console.error('  Docs: https://github.com/nerviq/nerviq#readme\n');
    process.exit(2);
  }

  if (!require('fs').existsSync(options.dir)) {
    console.error(`\n  Error: Directory not found: ${options.dir}`);
    console.error('  Why: The current working directory does not exist or is not accessible.');
    console.error('  Fix: cd into your project directory first, then run nerviq.');
    console.error('  Docs: https://github.com/nerviq/nerviq#getting-started\n');
    process.exit(2);
  }

  if (['setup', 'apply', 'benchmark'].includes(normalizedCommand)) {
    try {
      ensureWritableProfile(options.profile, normalizedCommand, options.dryRun);
    } catch (err) {
      console.error(`\n  Error: ${err.message}\n`);
      process.exit(1);
    }
  }

  try {
    const FULL_COMMAND_SET = new Set([
      'audit', 'org', 'scan', 'badge', 'augment', 'suggest-only', 'setup', 'plan', 'apply',
      'governance', 'benchmark', 'deep-review', 'interactive', 'watch', 'insights',
      'history', 'compare', 'trend', 'feedback', 'catalog', 'certify', 'serve', 'baseline', 'exception', 'help', 'version',
      // Harmony + Synergy (cross-platform)
      'harmony-audit', 'harmony-sync', 'harmony-drift', 'harmony-advise',
      'harmony-watch', 'harmony-governance', 'harmony-score', 'harmony-demo', 'harmony-add', 'synergy-report', 'anti-patterns', 'rules-export',
      'freshness', 'profile', 'migrate',
    ]);

    if (options.platform === 'codex') {
      if (!FULL_COMMAND_SET.has(normalizedCommand)) {
        console.error(`\n  Error: '${normalizedCommand}' is not supported for --platform codex.`);
        console.error('  Available: ' + [...FULL_COMMAND_SET].filter(c => c !== 'help' && c !== 'version').join(', ') + '.');
        process.exit(2);
      }
    }

    if (options.platform === 'gemini') {
      if (!FULL_COMMAND_SET.has(normalizedCommand)) {
        console.error(`\n  Error: '${normalizedCommand}' is not supported for --platform gemini.`);
        console.error('  Available: ' + [...FULL_COMMAND_SET].filter(c => c !== 'help' && c !== 'version').join(', ') + '.');
        process.exit(2);
      }
    }

    if (options.platform === 'copilot') {
      if (!FULL_COMMAND_SET.has(normalizedCommand)) {
        console.error(`\n  Error: '${normalizedCommand}' is not supported for --platform copilot.`);
        console.error('  Available: ' + [...FULL_COMMAND_SET].filter(c => c !== 'help' && c !== 'version').join(', ') + '.');
        process.exit(2);
      }
    }

    if (options.platform === 'cursor') {
      if (!FULL_COMMAND_SET.has(normalizedCommand)) {
        console.error(`\n  Error: '${normalizedCommand}' is not supported for --platform cursor.`);
        console.error('  Available: ' + [...FULL_COMMAND_SET].filter(c => c !== 'help' && c !== 'version').join(', ') + '.');
        process.exit(2);
      }
    }

    for (const plat of ['windsurf', 'aider', 'opencode']) {
      if (options.platform === plat) {
        if (!FULL_COMMAND_SET.has(normalizedCommand)) {
          console.error(`\n  Error: '${normalizedCommand}' is not supported for --platform ${plat}.`);
          console.error('  Available: ' + [...FULL_COMMAND_SET].filter(c => c !== 'help' && c !== 'version').join(', ') + '.');
          process.exit(2);
        }
      }
    }

    if (normalizedCommand === 'scan') {
      const scanDirs = parsed.extraArgs;
      if (scanDirs.length === 0) {
        console.error('\n  Error: scan requires at least one directory argument.');
        console.error('  Usage: npx nerviq scan dir1 dir2 dir3\n');
        process.exit(2);
      }
      const summary = await scanOrg(scanDirs, options);
      printScanDetail(summary, options);
      if (options.threshold !== null && summary.averageScore < options.threshold) {
        process.exit(1);
      }
      process.exit(0);
    } else if (normalizedCommand === 'org') {
      const subcommand = parsed.extraArgs[0];
      if (subcommand === 'policy') {
        const targetDir = parsed.extraArgs[1] ? require('path').resolve(parsed.extraArgs[1]) : options.dir;
        const contract = resolvePolicyLayers(targetDir);
        if (options.json) {
          await writeStdout(JSON.stringify(contract, null, 2) + '\n');
        } else {
          console.log('');
          console.log(formatPolicyContract(contract));
          console.log('');
        }
        process.exit(0);
      }

      const scanDirs = parsed.extraArgs.slice(1);
      if (subcommand !== 'scan' || scanDirs.length === 0) {
        console.error('\n  Error: org requires `scan` or `policy`.');
        console.error('  Usage: npx nerviq org scan dir1 dir2 dir3');
        console.error('         npx nerviq org policy [dir]\n');
        process.exit(2);
      }
      const summary = await scanOrg(scanDirs, options);
      if (options.json) {
        await writeStdout(JSON.stringify(summary, null, 2) + '\n');
      } else {
        printOrgSummary(summary, options);
      }
      if (options.threshold !== null && summary.averageScore < options.threshold) {
        process.exit(1);
      }
      process.exit(0);
    } else if (normalizedCommand === 'history') {
      const { formatHistory, readSnapshotIndex } = require('../src/activity');
      // Handle --prune N
      const pruneIdx = flags.indexOf('--prune');
      if (pruneIdx >= 0) {
        const keepCount = parseInt(flags[pruneIdx + 1] || parsed.extraArgs[0], 10) || 10;
        const fsMod = require('fs');
        const pathMod = require('path');
        const entries = readSnapshotIndex(options.dir);
        if (entries.length <= keepCount) {
          console.log(`\n  Nothing to prune (${entries.length} audit snapshots, keeping ${keepCount}).\n`);
        } else {
          const toRemove = entries.slice(0, entries.length - keepCount);
          let removed = 0;
          for (const entry of toRemove) {
            const fp = pathMod.join(options.dir, entry.relativePath);
            try { fsMod.unlinkSync(fp); removed++; } catch {}
          }
          const kept = entries.slice(entries.length - keepCount);
          const indexPath = pathMod.join(options.dir, '.nerviq', 'snapshots', 'index.json');
          try { fsMod.writeFileSync(indexPath, JSON.stringify(kept, null, 2), 'utf8'); } catch {}
          console.log(`\n  Pruned ${removed} audit snapshots, kept ${kept.length}.\n`);
        }
        process.exit(0);
      }
      console.log('');
      console.log(formatHistory(options.dir));
      console.log('');
      process.exit(0);
    } else if (normalizedCommand === 'compare') {
      const { compareLatest, formatSnapshotBootstrap, formatSnapshotTags, formatSnapshotMilestone } = require('../src/activity');
      const result = compareLatest(options.dir);
      if (!result) {
        console.log('');
        console.log(formatSnapshotBootstrap(options.dir, 'compare'));
        console.log('');
        process.exit(0);
      }
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        const sign = result.delta.score >= 0 ? '+' : '';
        console.log('');
        console.log(`  Previous snapshot: ${result.previous.score}/100 (${result.previous.date?.split('T')[0]})${formatSnapshotMilestone(result.previous.milestone)}${formatSnapshotTags(result.previous.tags)}`);
        console.log(`  Current snapshot:  ${result.current.score}/100 (${result.current.date?.split('T')[0]})${formatSnapshotMilestone(result.current.milestone)}${formatSnapshotTags(result.current.tags)}`);
        console.log(`  Snapshot delta:    ${sign}${result.delta.score} points`);
        console.log(`  Trend:    ${result.trend}`);
        if (result.detailedDiffAvailable) {
          console.log('');
          console.log('  Detailed check diff:');
          printCompareCheckSection('Regressions', result.regressionDetails, '🔴');
          printCompareCheckSection('Improvements', result.improvementDetails, '✅');
          printCompareCheckSection('Newly applicable', result.newlyApplicableDetails, '🆕');
          printCompareCheckSection('No longer applicable', result.noLongerApplicableDetails, '↩');
          if (Array.isArray(result.newChecks) && result.newChecks.length > 0) {
            printCompareCheckSection('New checks', result.newChecks, '➕');
          }
          if (Array.isArray(result.removedChecks) && result.removedChecks.length > 0) {
            printCompareCheckSection('Removed checks', result.removedChecks, '➖');
          }
          if (
            result.regressionDetails.length === 0 &&
            result.improvementDetails.length === 0 &&
            result.newlyApplicableDetails.length === 0 &&
            result.noLongerApplicableDetails.length === 0 &&
            result.newChecks.length === 0 &&
            result.removedChecks.length === 0
          ) {
            console.log('  No per-check state changes detected.');
          }
        } else {
          if (result.improvements.length > 0) console.log(`  Fixed:    ${result.improvements.join(', ')}`);
          if (result.regressions.length > 0) console.log(`  New gaps: ${result.regressions.join(', ')}`);
        }
        console.log('');
      }
      process.exit(0);
    } else if (normalizedCommand === 'trend') {
      const { exportTrendReport, getHistory, formatSnapshotBootstrap } = require('../src/activity');
      const auditHistory = getHistory(options.dir, 2);
      if (auditHistory.length < 2) {
        console.log('');
        console.log(formatSnapshotBootstrap(options.dir, 'trend'));
        console.log('');
        process.exit(0);
      }
      const report = exportTrendReport(options.dir);
      if (!report) {
        console.log('');
        console.log(formatSnapshotBootstrap(options.dir, 'trend'));
        console.log('');
        process.exit(0);
      }
      if (options.out) {
        require('fs').writeFileSync(options.out, report, 'utf8');
        console.log(`\n  Trend report exported to ${options.out}\n`);
      } else {
        console.log(report);
      }
      process.exit(0);
    } else if (normalizedCommand === 'badge') {
      const { getBadgeMarkdown } = require('../src/badge');
      const result = await audit({ ...options, silent: true });
      console.log(getBadgeMarkdown(result.score));
      console.log('');
      console.log('Add this to your README.md');
      process.exit(0);
    } else if (normalizedCommand === 'insights') {
      const https = require('https');
      const url = 'https://nerviq-insights.nerviq.workers.dev/v1/stats';
      const req = https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const stats = JSON.parse(data);
            console.log('');
            console.log('\x1b[1m  NERVIQ Community Insights\x1b[0m');
            console.log('\x1b[2m  ═══════════════════════════════════════\x1b[0m');
            console.log(`  Total audits run: \x1b[1m${stats.totalRuns}\x1b[0m`);
            console.log(`  Average score: \x1b[1m${stats.averageScore}/100\x1b[0m`);
            console.log('');
            if (stats.topFailedChecks && stats.topFailedChecks.length > 0) {
              console.log('\x1b[33m  Most common gaps:\x1b[0m');
              for (const f of stats.topFailedChecks.slice(0, 5)) {
                console.log(`     ${f.pct}% miss: \x1b[1m${f.check}\x1b[0m`);
              }
              console.log('');
            }
            if (stats.topStacks && stats.topStacks.length > 0) {
              console.log('\x1b[36m  Popular stacks:\x1b[0m');
              console.log(`     ${stats.topStacks.map(s => s.stack).join(', ')}`);
            }
            console.log('');
          } catch (e) {
            console.log('  No community data available yet. Be the first to run: npx nerviq');
          }
        });
      }).on('error', () => {
        console.log('  Could not reach insights server. Run locally: npx nerviq');
      });
      req.setTimeout(10000, () => {
        req.destroy();
        console.log('  Insights request timed out. Run locally: npx nerviq');
      });
      return; // keep process alive for http
    } else if (normalizedCommand === 'feedback') {
      if (flags.includes('--patterns')) {
        if (options.json) {
          const { getUsageSummary } = require('../src/usage-patterns');
          console.log(JSON.stringify(getUsageSummary(options.dir), null, 2));
        } else {
          console.log('');
          console.log(formatUsageSummary(options.dir));
          console.log('');
        }
        process.exit(0);
      }
      if (parsed.feedbackKey) {
        if (!parsed.feedbackStatus) {
          console.error('\n  Error: feedback logging requires --status when --key is provided.\n');
          process.exit(1);
        }
        const artifact = recordRecommendationOutcome(options.dir, {
          key: parsed.feedbackKey,
          status: parsed.feedbackStatus,
          effect: parsed.feedbackEffect || 'neutral',
          notes: parsed.feedbackNotes || '',
          source: parsed.feedbackSource || 'manual-cli',
          scoreDelta: parsed.feedbackScoreDelta !== null ? Number(parsed.feedbackScoreDelta) : null,
        });
        const summary = getRecommendationOutcomeSummary(options.dir);
        if (options.json) {
          console.log(JSON.stringify({ artifact, summary }, null, 2));
        } else {
          console.log('');
          console.log(`  Feedback recorded for ${parsed.feedbackKey}`);
          console.log(`  Artifact: ${artifact.relativePath}`);
          console.log('');
          console.log(formatRecommendationOutcomeSummary(options.dir));
          console.log('');
        }
      } else {
        if (options.json) {
          console.log(JSON.stringify(getRecommendationOutcomeSummary(options.dir), null, 2));
        } else {
          console.log('');
          console.log(formatRecommendationOutcomeSummary(options.dir));
          console.log('');
        }
      }
      process.exit(0);
    } else if (normalizedCommand === 'augment' || normalizedCommand === 'suggest-only') {
      const report = await analyzeProject({ ...options, mode: normalizedCommand });
      const snapshot = options.snapshot ? writeSnapshotArtifact(options.dir, normalizedCommand, report, {
        tags: options.snapshotTags,
        milestone: options.snapshotMilestone,
        sourceCommand: normalizedCommand,
      }) : null;
      if (options.out && !options.json) {
        const fs = require('fs');
        const md = exportMarkdown(report);
        fs.writeFileSync(options.out, md, 'utf8');
        console.log(`\n  Report exported to ${options.out}\n`);
      }
      printAnalysis(report, options);
      if (snapshot && !options.json) {
        console.log(`  Snapshot saved: ${snapshot.relativePath}`);
        console.log(`  Snapshot index: ${snapshot.indexPath}`);
        console.log('');
      }
    } else if (normalizedCommand === 'plan') {
      const bundle = await buildProposalBundle(options);
      let artifact = null;
      if (options.out) {
        artifact = writePlanFile(bundle, options.out);
      }
      printProposalBundle(bundle, options);
      if (options.out && !options.json) {
        console.log(`  Plan written to ${options.out}`);
        if (artifact) {
          console.log(`  Activity log: ${artifact.relativePath}`);
        }
        console.log('');
      }
    } else if (normalizedCommand === 'rollback') {
      const fsMod = require('fs');
      const pathMod = require('path');
      const rollbackDir = pathMod.join(options.dir, '.nerviq', 'rollbacks');

      if (!fsMod.existsSync(rollbackDir)) {
        console.log('\n  No rollback artifacts found. Run `nerviq apply` first to create rollback data.\n');
        process.exit(0);
      }

      const rollbackFiles = fsMod.readdirSync(rollbackDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();

      if (rollbackFiles.length === 0) {
        console.log('\n  No rollback artifacts found.\n');
        process.exit(0);
      }

      // --list mode
      if (flags.includes('--list')) {
        console.log(`\n  Rollback points (${rollbackFiles.length}):\n`);
        for (const f of rollbackFiles) {
          try {
            const data = JSON.parse(fsMod.readFileSync(pathMod.join(rollbackDir, f), 'utf8'));
            const created = (data.createdFiles || []).length;
            const patched = (data.patchedFiles || []).length;
            console.log(`  ${f.replace('.json', '')}  (${created} created, ${patched} patched)`);
          } catch {
            console.log(`  ${f}  (unreadable)`);
          }
        }
        console.log(`\n  Run \`nerviq rollback\` to undo the most recent.\n`);
        process.exit(0);
      }

      // Execute rollback of most recent
      const latestFile = rollbackFiles[0];
      const latestPath = pathMod.join(rollbackDir, latestFile);
      let rollbackData;
      try {
        rollbackData = JSON.parse(fsMod.readFileSync(latestPath, 'utf8'));
      } catch (e) {
        console.error(`\n  Error: Cannot parse rollback file: ${e.message}\n`);
        process.exit(1);
      }

      const createdFiles = rollbackData.createdFiles || [];
      if (createdFiles.length === 0) {
        console.log('\n  Rollback artifact has no files to remove.\n');
        process.exit(0);
      }

      if (options.dryRun) {
        console.log(`\n  [dry-run] Would delete ${createdFiles.length} files:\n`);
        for (const f of createdFiles) {
          console.log(`    - ${f}`);
        }
        console.log('');
        process.exit(0);
      }

      let deleted = 0;
      let missing = 0;
      console.log('');
      for (const relPath of createdFiles) {
        const fullPath = pathMod.join(options.dir, relPath);
        if (fsMod.existsSync(fullPath)) {
          fsMod.unlinkSync(fullPath);
          console.log(`  🗑️  Deleted: ${relPath}`);
          deleted++;
        } else {
          missing++;
        }
      }

      // Remove rollback artifact after use
      fsMod.unlinkSync(latestPath);

      console.log(`\n  Rollback complete: ${deleted} files deleted${missing > 0 ? `, ${missing} already missing` : ''}.\n`);

    } else if (normalizedCommand === 'apply') {
      if (flags.includes('--rollback')) {
        console.error('\n  Error: --rollback is not yet supported as a flag.');
        console.error('  Why: Rollback artifacts are saved in .nerviq/rollbacks/ but automatic rollback is not implemented yet.');
        console.error('  Fix: Manually delete the files listed in .nerviq/rollbacks/<latest>.json, or use `nerviq apply --dry-run` to preview before applying.');
        console.error('  Docs: https://github.com/nerviq/nerviq#rollback\n');
        process.exit(1);
      }
      const result = await applyProposalBundle(options);
      printApplyResult(result, options);
    } else if (normalizedCommand === 'governance') {
      const fs = require('fs');
      const path = require('path');
      const summary = getGovernanceSummary(options.platform);
      if (options.out) {
        fs.mkdirSync(path.dirname(options.out), { recursive: true });
        const content = path.extname(options.out).toLowerCase() === '.md'
          ? renderGovernanceMarkdown(summary)
          : JSON.stringify(summary, null, 2);
        fs.writeFileSync(options.out, content, 'utf8');
      }
      printGovernanceSummary(summary, options);
      const snapshot = options.snapshot ? writeSnapshotArtifact(options.dir, 'governance', summary, {
        tags: options.snapshotTags,
        milestone: options.snapshotMilestone,
        sourceCommand: normalizedCommand,
      }) : null;
      if (options.out && !options.json) {
        console.log(`  Governance report written to ${options.out}`);
        console.log('');
      }
      if (snapshot && !options.json) {
        console.log(`  Snapshot saved: ${snapshot.relativePath}`);
        console.log(`  Snapshot index: ${snapshot.indexPath}`);
        console.log('');
      }
    } else if (normalizedCommand === 'benchmark') {
      const report = await runBenchmark(options);
      const snapshot = options.snapshot ? writeSnapshotArtifact(options.dir, 'benchmark', report, {
        tags: options.snapshotTags,
        milestone: options.snapshotMilestone,
        sourceCommand: normalizedCommand,
      }) : null;
      if (options.out) {
        writeBenchmarkReport(report, options.out);
      }
      printBenchmark(report, options);
      if (options.out && !options.json) {
        console.log(`  Benchmark report written to ${options.out}`);
        console.log('');
      }
      if (snapshot && !options.json) {
        console.log(`  Snapshot saved: ${snapshot.relativePath}`);
        console.log(`  Snapshot index: ${snapshot.indexPath}`);
        console.log('');
      }
    } else if (normalizedCommand === 'deep-review') {
      const { deepReview } = require('../src/deep-review');
      await deepReview(options);
    } else if (normalizedCommand === 'interactive') {
      const { interactive } = require('../src/interactive');
      await interactive(options);
    } else if (normalizedCommand === 'baseline') {
      const {
        readManagedBaseline,
        writeManagedBaseline,
        buildManagedBaselineRecord,
        formatManagedBaselineStatus,
      } = require('../src/continuous-ops');
      const subcommand = parsed.extraArgs[0] || 'status';

      if (subcommand === 'status') {
        const baseline = readManagedBaseline(options.dir);
        if (options.json) {
          console.log(JSON.stringify(baseline, null, 2));
        } else {
          console.log('');
          console.log(formatManagedBaselineStatus(options.dir, baseline));
          console.log('');
        }
        process.exit(0);
      }

      if (subcommand === 'init') {
        const existingBaseline = readManagedBaseline(options.dir);
        if (existingBaseline && !flags.includes('--force')) {
          console.error('\n  Error: Managed baseline already exists. Use `nerviq baseline status` to inspect it, or rerun with --force to replace it.\n');
          process.exit(1);
        }

        const auditResult = await audit({ ...options, silent: true });
        const analysisReport = await analyzeProject({ ...options, mode: 'augment' });
        const detectedPlatforms = detectPlatforms(options.dir);
        const snapshot = writeSnapshotArtifact(options.dir, 'audit', auditResult, {
          tags: [...options.snapshotTags, 'baseline'],
          milestone: 'baseline',
          sourceCommand: 'baseline init',
          managedBaseline: true,
        });
        const baselineRecord = buildManagedBaselineRecord({
          dir: options.dir,
          platform: options.platform,
          auditResult,
          analysisReport,
          snapshotArtifact: snapshot,
          currentPlatforms: detectedPlatforms,
        });
        const saved = writeManagedBaseline(options.dir, baselineRecord);

        if (options.json) {
          console.log(JSON.stringify({
            ...baselineRecord,
            baselinePath: saved.relativePath,
          }, null, 2));
        } else {
          console.log('');
          console.log('  nerviq baseline init');
          console.log('  ═══════════════════════════════════════');
          console.log(`  Managed baseline written: ${saved.relativePath}`);
          console.log(`  Snapshot: ${snapshot.relativePath}`);
          console.log(`  Score: ${baselineRecord.baselineAudit.score}/100`);
          console.log(`  Operating profile: ${baselineRecord.operatingProfile.label || 'n/a'}`);
          console.log(`  Adoption plan: ${baselineRecord.adoptionPlan || 'n/a'}`);
          console.log(`  Active platforms: ${(baselineRecord.detectedPlatforms || []).join(', ') || 'none detected'}`);
          console.log('');
          console.log('  Next:');
          console.log('    - nerviq audit --diff-only --drift-mode ci');
          console.log('    - nerviq watch');
          console.log('    - nerviq plan --campaign governance-hardening');
          console.log('');
        }
        process.exit(0);
      }

      console.error('\n  Error: baseline supports `init` and `status`.\n');
      process.exit(1);
    } else if (normalizedCommand === 'watch') {
      const { watch } = require('../src/watch');
      await watch(options);
    } else if (normalizedCommand === 'catalog') {
      const { generateCatalogWithVersion, writeCatalogJson } = require('../src/catalog');
      if (options.out) {
        const result = writeCatalogJson(options.out);
        if (options.json) {
          console.log(JSON.stringify({ path: result.path, count: result.count }));
        } else {
          console.log(`\n  Catalog written to ${result.path} (${result.count} checks)\n`);
        }
      } else {
        const catalog = getCatalog(); // dogfood: use SDK instead of internal import
        if (options.json) {
          const envelope = generateCatalogWithVersion();
          if (options.checkVersion) envelope.requestedVersion = options.checkVersion;
          console.log(JSON.stringify(envelope, null, 2));
        } else {
          // Print summary table
          const platforms = {};
          for (const entry of catalog) {
            platforms[entry.platform] = (platforms[entry.platform] || 0) + 1;
          }
          console.log('');
          console.log('\x1b[1m  nerviq check catalog\x1b[0m');
          console.log('\x1b[2m  ═══════════════════════════════════════\x1b[0m');
          console.log(`  Total checks: \x1b[1m${catalog.length}\x1b[0m`);
          console.log('');
          for (const [plat, count] of Object.entries(platforms)) {
            console.log(`    ${plat.padEnd(12)} ${count} checks`);
          }
          console.log('');
          console.log('  Use --json for full output or --out catalog.json to write file.');
          console.log('');
        }
      }
      process.exit(0);
    } else if (normalizedCommand === 'certify') {
      const { certifyProject, generateCertBadge } = require('../src/certification');
      const certResult = await certifyProject(options.dir);
      if (options.json) {
        console.log(JSON.stringify(certResult, null, 2));
      } else {
        console.log('');
        console.log('\x1b[1m  nerviq certification\x1b[0m');
        console.log('\x1b[2m  ═══════════════════════════════════════\x1b[0m');
        console.log('');
        console.log(`  Level: \x1b[1m${certResult.level}\x1b[0m`);
        console.log(`  Harmony Score: ${certResult.harmonyScore}/100`);
        console.log('');
        if (Object.keys(certResult.platformScores).length > 0) {
          console.log('  Platform Scores:');
          for (const [plat, score] of Object.entries(certResult.platformScores)) {
            const scoreColor = score >= 70 ? '\x1b[32m' : score >= 40 ? '\x1b[33m' : '\x1b[31m';
            console.log(`    ${plat.padEnd(12)} ${scoreColor}${score}/100\x1b[0m`);
          }
          console.log('');
        }
        console.log('  Badge:');
        console.log(`  ${certResult.badge}`);
        console.log('');
        console.log('  Add the badge to your README.md');
        console.log('');
      }
      process.exit(0);
    } else if (normalizedCommand === 'serve') {
      const server = await startServer({
        port: options.port == null ? 3000 : options.port,
        baseDir: options.dir,
      });
      const address = server.address();
      const resolvedPort = address && typeof address === 'object' ? address.port : options.port;
      console.log('');
      console.log(`  nerviq API listening on http://127.0.0.1:${resolvedPort}`);
      console.log('  Endpoints: /api/openapi.json, /api/health, /api/catalog, /api/audit, /api/harmony');
      console.log(`  Contract: http://127.0.0.1:${resolvedPort}/api/openapi.json`);
      console.log('  MCP hosts should use nerviq-mcp (stdio JSON-RPC 2.0), not this HTTP server.');
      console.log('');

      const closeServer = () => {
        server.close(() => process.exit(0));
      };

      process.on('SIGINT', closeServer);
      process.on('SIGTERM', closeServer);
      return;
    } else if (normalizedCommand === 'harmony-audit') {
      const { runHarmonyAudit } = require('../src/harmony/cli');
      collectAnonymousEvent('harmony-audit', { dir: options.dir });
      await runHarmonyAudit(options);
      process.exit(0);
    } else if (normalizedCommand === 'harmony-sync') {
      const { previewHarmonySync, applyHarmonySync } = require('../src/harmony/sync');
      const dir = options.dir || process.cwd();

      if (options.fix) {
        // Apply mode: write files
        const result = applyHarmonySync(dir);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('');
          console.log('\x1b[1m  Harmony Sync — Apply\x1b[0m');
          console.log('\x1b[2m  ═══════════════════════════════════════\x1b[0m');
          console.log('');
          if (result.applied.length === 0 && result.skipped.length === 0) {
            console.log('  \x1b[32mAll platforms are already in sync. Nothing to apply.\x1b[0m');
          } else {
            for (const item of result.applied) {
              console.log(`  \x1b[32m✓\x1b[0m ${item.action.padEnd(8)} ${item.platform.padEnd(12)} ${item.path}`);
            }
            for (const item of result.skipped) {
              const reason = typeof item === 'string' ? item : (item.reason || item.path);
              console.log(`  \x1b[33m⚠\x1b[0m skipped  ${reason}`);
            }
            console.log('');
            if (result.summary) {
              console.log(`  Files: ${result.summary.totalFiles} (${result.summary.creates} created, ${result.summary.patches} patched)`);
              console.log(`  Platforms: ${result.summary.platforms.join(', ')}`);
            }
          }
          if (result.warnings && result.warnings.length > 0) {
            console.log('');
            for (const w of result.warnings) {
              console.log(`  \x1b[33m⚠\x1b[0m ${w}`);
            }
          }
          console.log('');
        }
      } else {
        // Preview mode (dry run)
        const plan = previewHarmonySync(dir);
        if (options.json) {
          console.log(JSON.stringify(plan, null, 2));
        } else {
          console.log('');
          console.log('\x1b[1m  Harmony Sync — Preview\x1b[0m');
          console.log('\x1b[2m  ═══════════════════════════════════════\x1b[0m');
          console.log('');
          if (plan.files.length === 0) {
            console.log('  \x1b[32mAll platforms are already in sync. No changes needed.\x1b[0m');
          } else {
            for (const file of plan.files) {
              const actionColor = file.action === 'create' ? '\x1b[32m' : '\x1b[36m';
              console.log(`  ${actionColor}${file.action.padEnd(8)}\x1b[0m ${file.platform.padEnd(12)} ${file.path}`);
              if (file.preview) {
                console.log(`           \x1b[2m${file.preview}\x1b[0m`);
              }
            }
            console.log('');
            console.log(`  Total: ${plan.summary.totalFiles} file(s) — ${plan.summary.creates} create, ${plan.summary.patches} patch`);
            console.log(`  Platforms: ${plan.summary.platforms.join(', ')}`);
            if (plan.summary.recommendedTrust) {
              console.log(`  Recommended trust: ${plan.summary.recommendedTrust}`);
            }
            console.log('');
            console.log('  Run \x1b[1mnerviq harmony-sync --fix\x1b[0m to apply these changes.');
          }
          if (plan.warnings && plan.warnings.length > 0) {
            console.log('');
            for (const w of plan.warnings) {
              console.log(`  \x1b[33m⚠\x1b[0m ${w}`);
            }
          }
          console.log('');
        }
      }
      process.exit(0);
    } else if (normalizedCommand === 'harmony-drift') {
      const { runHarmonyDrift } = require('../src/harmony/cli');
      await runHarmonyDrift(options);
      process.exit(0);
    } else if (normalizedCommand === 'harmony-advise') {
      const { runHarmonyAdvise } = require('../src/harmony/cli');
      await runHarmonyAdvise(options);
      process.exit(0);
    } else if (normalizedCommand === 'harmony-watch') {
      const { runHarmonyWatch } = require('../src/harmony/cli');
      await runHarmonyWatch(options);
    } else if (normalizedCommand === 'harmony-governance') {
      const { runHarmonyGovernance } = require('../src/harmony/cli');
      await runHarmonyGovernance(options);
      process.exit(0);
    } else if (normalizedCommand === 'harmony-score') {
      const { runHarmonyScore } = require('../src/harmony/cli');
      const result = await runHarmonyScore(options);
      const threshold = parseInt(options.threshold, 10) || 0;
      process.exit(threshold > 0 && !result.pass ? 1 : 0);
    } else if (normalizedCommand === 'harmony-demo') {
      const { runHarmonyDemo } = require('../src/harmony/cli');
      await runHarmonyDemo(options);
      process.exit(0);
    } else if (normalizedCommand === 'harmony-add') {
      const { addPlatform } = require('../src/harmony/add');
      const platformArg = parsed.extraArgs[0];
      if (!platformArg) {
        console.log('\n  Usage: nerviq harmony-add <platform>');
        console.log('  Available: claude, codex, gemini, copilot, cursor, windsurf, aider, opencode\n');
        process.exit(1);
      }
      const dir = options.dir || process.cwd();
      const result = addPlatform(dir, platformArg.toLowerCase());
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.success) {
        console.log(`\n  \x1b[32m\u2713\x1b[0m Added ${result.platform} to project`);
        result.created.forEach(f => console.log(`     Created: ${f}`));
        console.log(`     Platforms: ${result.beforeCount} \u2192 ${result.afterCount}`);
        if (result.syncApplied > 0) console.log(`     Harmony sync: ${result.syncApplied} file(s) updated`);
        console.log('');
      } else {
        console.log(`\n  \x1b[31m\u2717\x1b[0m ${result.error}\n`);
        process.exit(1);
      }
      process.exit(0);
    } else if (normalizedCommand === 'anti-patterns') {
      const showAll = flags.includes('--all');
      if (showAll) {
        printAntiPatternCatalog(options);
      } else {
        const { ProjectContext } = require('../src/context');
        const ctx = new ProjectContext(options.dir);
        const detected = detectAntiPatterns(ctx);
        printAntiPatterns(detected, options);
      }
      process.exit(0);
    } else if (normalizedCommand === 'rules-export') {
      const { generateRecommendationRules } = require('../src/recommendation-rules');
      const rules = generateRecommendationRules();
      if (options.json) {
        console.log(JSON.stringify(rules, null, 2));
      } else if (options.out) {
        require('fs').writeFileSync(options.out, JSON.stringify(rules, null, 2), 'utf8');
        console.log(`\n  Rules exported to ${options.out} (${rules.totalRules} rules)\n`);
      } else {
        // Human-readable summary
        console.log(`\n  Nerviq Recommendation Rules (${rules.totalRules} rules)\n`);
        const byCategory = {};
        for (const rule of (rules.rules || [])) {
          const cat = rule.category || 'other';
          if (!byCategory[cat]) byCategory[cat] = 0;
          byCategory[cat]++;
        }
        for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
          console.log(`  ${cat.padEnd(20)} ${count} rules`);
        }
        console.log(`\n  Use --json for full output or --out <file> to save.\n`);
      }
      process.exit(0);
    } else if (normalizedCommand === 'dashboard') {
      const dashFlags = {
        out: options.out,
        open: flags.includes('--open'),
        json: options.json,
        platform: options.platform,
      };
      if (parsed.repos && parsed.repos.length > 0) {
        const { generatePortfolioDashboard } = require('../src/dashboard');
        await generatePortfolioDashboard(parsed.repos, dashFlags);
      } else {
        const { generateDashboard } = require('../src/dashboard');
        await generateDashboard(options.dir, dashFlags);
      }
      process.exit(0);
    } else if (normalizedCommand === 'check-health') {
      const { checkHealth, formatCheckHealth } = require('../src/activity');
      const report = checkHealth(options.dir);
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log('');
        console.log(formatCheckHealth(report));
      }
      process.exit(0);
    } else if (normalizedCommand === 'freshness') {
      const { TECHNIQUES } = require('../src/techniques');
      const stats = getVerificationStats();
      const allKeys = Object.keys(TECHNIQUES);
      const verifiedKeys = Object.keys(VERIFICATION_DATES);
      const neverVerified = allKeys.filter(k => !VERIFICATION_DATES[k]);

      if (options.json) {
        console.log(JSON.stringify({
          totalChecks: allKeys.length,
          verifiedChecks: verifiedKeys.length,
          neverVerifiedCount: neverVerified.length,
          newestVerification: stats.newest,
          oldestVerification: stats.oldest,
          neverVerified,
        }, null, 2));
      } else {
        console.log('');
        console.log('  nerviq freshness');
        console.log('  ═══════════════════════════════════════');
        console.log(`  Total checks:            ${allKeys.length}`);
        console.log(`  With verification date:  ${verifiedKeys.length}`);
        console.log(`  Never verified:          ${neverVerified.length}`);
        console.log(`  Newest verification:     ${stats.newest}`);
        console.log(`  Oldest verification:     ${stats.oldest}`);
        console.log('');
        if (neverVerified.length > 0 && options.verbose) {
          console.log('  Never verified:');
          for (const key of neverVerified) {
            console.log(`    - ${key}`);
          }
          console.log('');
        } else if (neverVerified.length > 0) {
          console.log(`  Use --verbose to list all ${neverVerified.length} never-verified checks.`);
          console.log('');
        }
      }
      process.exit(0);
    } else if (normalizedCommand === 'suggest-rules') {
      const { analyzeSuggestions, formatSuggestions } = require('../src/auto-suggest');
      const suggestions = analyzeSuggestions(options.dir);
      if (options.json) {
        console.log(JSON.stringify(suggestions, null, 2));
      } else {
        console.log('');
        console.log(formatSuggestions(suggestions));
        console.log('');
      }
      process.exit(0);
    } else if (normalizedCommand === 'exception') {
      const {
        listExceptions,
        addException,
        pruneExpiredExceptions,
        formatExceptionsList,
      } = require('../src/continuous-ops');
      const subcommand = parsed.extraArgs[0] || 'list';

      if (subcommand === 'list') {
        const records = listExceptions(options.dir);
        if (options.json) {
          console.log(JSON.stringify(records, null, 2));
        } else {
          console.log('');
          console.log(formatExceptionsList(records));
          console.log('');
        }
        process.exit(0);
      }

      if (subcommand === 'add') {
        const result = addException(options.dir, {
          key: parsed.feedbackKey || null,
          watchClass: options.exceptionClass,
          owner: options.exceptionOwner,
          reason: options.exceptionReason,
          expiresAt: options.exceptionExpires,
          scope: options.exceptionScope || 'all',
        });
        if (options.json) {
          console.log(JSON.stringify(result.record, null, 2));
        } else {
          console.log('');
          console.log(`  Exception added: ${result.record.id}`);
          console.log(`  Target: ${result.record.key || result.record.watchClass}`);
          console.log(`  Owner: ${result.record.owner}`);
          console.log(`  Scope: ${result.record.scope}`);
          console.log(`  Expires: ${result.record.expiresAt}`);
          console.log('');
        }
        process.exit(0);
      }

      if (subcommand === 'prune') {
        const result = pruneExpiredExceptions(options.dir);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`\n  Pruned ${result.removedCount} expired exception(s). Kept ${result.keptCount} active record(s).\n`);
        }
        process.exit(0);
      }

      console.error('\n  Error: exception supports `add`, `list`, and `prune`.\n');
      process.exit(1);
    } else if (normalizedCommand === 'profile') {
      const { saveProfile, loadProfile, listProfiles, exportProfile, formatProfileList, formatProfile } = require('../src/profiles');
      const subcommand = parsed.extraArgs[0];
      const profileArg = parsed.extraArgs[1];

      if (!subcommand || subcommand === 'list') {
        const profiles = listProfiles(options.dir);
        console.log('');
        console.log(formatProfileList(profiles));
        console.log('');
        process.exit(0);
      } else if (subcommand === 'save') {
        if (!profileArg) {
          console.error('\n  Error: Profile name required. Usage: nerviq profile save <name>\n');
          process.exit(1);
        }
        const result = saveProfile(options.dir, profileArg, {
          platforms: [options.platform],
          threshold: options.threshold,
          suppressedChecks: [],
          priorityBoosts: [],
          description: '',
        });
        if (options.json) {
          console.log(JSON.stringify(result.profile, null, 2));
        } else {
          console.log(`\n  Profile '${profileArg}' saved to ${result.path}\n`);
        }
        process.exit(0);
      } else if (subcommand === 'load') {
        if (!profileArg) {
          console.error('\n  Error: Profile name required. Usage: nerviq profile load <name>\n');
          process.exit(1);
        }
        let profile;
        try {
          profile = loadProfile(options.dir, profileArg);
        } catch {
          // Not found as a user-saved profile — try built-in governance profiles
          const { getPermissionProfile } = require('../src/governance');
          const builtIn = getPermissionProfile(profileArg);
          if (builtIn && builtIn.key === profileArg) {
            profile = { name: builtIn.label, platforms: ['claude'], threshold: builtIn.threshold || 0, ...builtIn };
          }
        }
        if (!profile) {
          console.error(`\n  Error: Profile '${profileArg}' not found. Run 'nerviq profile list' to see available profiles.\n`);
          process.exit(1);
        }

        // Apply profile settings to .claude/settings.json
        const fs = require('fs');
        const settingsPath = require('path').join(options.dir, '.claude', 'settings.json');
        let settings = {};
        if (fs.existsSync(settingsPath)) {
          try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
        }
        // Apply deny rules from governance profile if platforms include claude
        if (profile.platforms && profile.platforms.includes('claude')) {
          const { getPermissionProfile } = require('../src/governance');
          const govProfile = getPermissionProfile(profileArg);
          if (govProfile && govProfile.deny && govProfile.deny.length > 0) {
            settings.deny = govProfile.deny;
          }
        }
        // Apply threshold and suppressed checks
        if (profile.threshold != null) {
          settings.threshold = profile.threshold;
        }
        if (profile.suppressedChecks && profile.suppressedChecks.length > 0) {
          settings.suppressedChecks = profile.suppressedChecks;
        }
        const settingsDir = require('path').dirname(settingsPath);
        fs.mkdirSync(settingsDir, { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

        if (options.json) {
          console.log(JSON.stringify(profile, null, 2));
        } else {
          console.log('');
          console.log(formatProfile(profile));
          console.log(`\n  Settings applied to ${settingsPath}`);
          console.log('');
        }
        process.exit(0);
      } else if (subcommand === 'export') {
        if (!profileArg) {
          console.error('\n  Error: Profile name required. Usage: nerviq profile export <name>\n');
          process.exit(1);
        }
        const json = exportProfile(options.dir, profileArg);
        if (options.out) {
          require('fs').writeFileSync(options.out, json, 'utf8');
          console.log(`\n  Profile exported to ${options.out}\n`);
        } else {
          console.log(json);
        }
        process.exit(0);
      } else {
        console.error(`\n  Error: Unknown profile subcommand '${subcommand}'.`);
        console.error('  Usage: nerviq profile save|load|list|export <name>\n');
        process.exit(1);
      }
    } else if (normalizedCommand === 'synergy-report') {
      const { formatSynergyReport } = require('../src/synergy/report');
      const { detectActivePlatforms: detectSynergyPlatforms } = require('../src/harmony/canon');
      const presentPlatforms = detectSynergyPlatforms(options.dir).map(p => p.platform);
      if (presentPlatforms.length === 0) {
        console.log('\n  No platform configurations detected.');
        console.log('  Run "nerviq harmony-audit" first, or "nerviq setup" to bootstrap a platform.\n');
        process.exit(0);
      }
      const platformAudits = {};
      const activePlatforms = [];
      for (const plat of presentPlatforms) {
        try {
          const result = await audit({ dir: options.dir, silent: true, platform: plat });
          if (result && typeof result.score === 'number') {
            platformAudits[plat] = result;
            activePlatforms.push(plat);
          }
        } catch (_e) { /* platform not available */ }
      }
      if (activePlatforms.length === 0) {
        console.log('\n  No auditable platforms found. Run "nerviq harmony-audit" first.\n');
        process.exit(0);
      }
      const report = formatSynergyReport({ platformAudits, activePlatforms });
      if (options.json) {
        console.log(JSON.stringify({ activePlatforms, platformAudits }, null, 2));
      } else {
        console.log(report);
      }
      process.exit(0);
    } else if (normalizedCommand === 'doctor') {
      const { runDoctor } = require('../src/doctor');
      const output = await runDoctor({ dir: options.dir, json: options.json, verbose: options.verbose });
      console.log(output);
      process.exit(0);
    } else if (normalizedCommand === 'convert') {
      const { runConvert } = require('../src/convert');
      const output = await runConvert({
        dir: options.dir,
        from: parsed.convertFrom,
        to: parsed.convertTo,
        dryRun: options.dryRun,
        json: options.json,
      });
      console.log(output);
      process.exit(0);
    } else if (normalizedCommand === 'migrate') {
      const { runMigrate } = require('../src/migrate');
      const output = await runMigrate({
        dir: options.dir,
        platform: options.platform || parsed.platform || 'claude',
        from: parsed.migrateFrom,
        to: parsed.migrateTo,
        dryRun: options.dryRun,
        json: options.json,
      });
      console.log(output);
      process.exit(0);
    } else if (normalizedCommand === 'fix') {
      // nerviq fix [key] [--all-critical] [--dry-run] [--auto] [--prompt]
      const fixKey = parsed.extraArgs[0] || null;
      const allCritical = flags.includes('--all-critical');
      const promptOnly = flags.includes('--prompt');
      const autoApply = options.auto;
      const isDryRun = options.dryRun;

      // Step 1: Run silent audit to find failed checks (only actual failures, not skipped/null)
      const auditResult = await audit({ dir: options.dir, silent: true, platform: options.platform });
      const failedResults = (auditResult.results || []).filter(r => r.passed === false);

      if (failedResults.length === 0) {
        console.log('\n  ✅ All checks passing — nothing to fix.\n');
        process.exit(0);
      }

      // Step 2: Determine which checks to fix
      const { TECHNIQUES } = require('../src/techniques');
      const { FIX_PROMPTS, formatFixPrompt } = require('../src/fix-prompts');
      const fs = require('fs');
      const pathMod = require('path');

      // Inline fixers for checks without templates but with trivial auto-fixes
      const INLINE_FIXERS = {
        gitIgnoreEnv: (dir) => {
          const gitignorePath = pathMod.join(dir, '.gitignore');
          const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
          if (!existing.includes('.env')) {
            const lines = existing.endsWith('\n') || existing === '' ? '' : '\n';
            fs.appendFileSync(gitignorePath, `${lines}.env\n.env.*\n`, 'utf8');
            return true;
          }
          return false;
        },
        secretsProtection: (dir) => {
          const settingsPath = pathMod.join(dir, '.claude', 'settings.json');
          const settingsDir = pathMod.join(dir, '.claude');
          if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });
          let settings = {};
          if (fs.existsSync(settingsPath)) {
            try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { settings = {}; }
          }
          if (!settings.permissions) settings.permissions = {};
          if (!settings.permissions.deny) settings.permissions.deny = [];
          const denyEntries = ['.env', '.env.*', '**/.env', '**/*.pem', '**/secrets/**'];
          for (const entry of denyEntries) {
            if (!settings.permissions.deny.includes(entry)) settings.permissions.deny.push(entry);
          }
          // Remove overly broad allow:["*"] if present
          if (Array.isArray(settings.permissions.allow) && settings.permissions.allow.includes('*')) {
            settings.permissions.allow = settings.permissions.allow.filter(a => a !== '*');
            if (settings.permissions.allow.length === 0) {
              delete settings.permissions.allow;
            }
          }
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
          return true;
        },
      };

      let targetKeys = [];

      if (fixKey) {
        // Fix a specific check
        if (!failedResults.find(r => r.key === fixKey)) {
          const passed = (auditResult.results || []).find(r => r.key === fixKey && r.passed);
          if (passed) {
            console.log(`\n  ✅ '${fixKey}' is already passing.\n`);
          } else {
            console.log(`\n  Error: Unknown check key '${fixKey}'.`);
            console.log(`  Fix: Run 'nerviq audit --full' to see all check keys.\n`);
          }
          process.exit(1);
        }
        // --prompt flag: show AI prompt and exit without attempting fix
        if (promptOnly) {
          const prompt = FIX_PROMPTS[fixKey];
          if (prompt) {
            console.log(formatFixPrompt(fixKey, prompt));
          } else {
            const failedCheck = failedResults.find(r => r.key === fixKey);
            console.log(`\n  No AI prompt available for '${fixKey}'.`);
            console.log(`  Manual fix: ${failedCheck ? failedCheck.fix : 'See nerviq audit --full.'}\n`);
          }
          process.exit(0);
        }
        targetKeys = [fixKey];
      } else if (allCritical) {
        targetKeys = failedResults.filter(r => r.impact === 'critical').map(r => r.key);
        if (targetKeys.length === 0) {
          console.log('\n  ✅ No critical issues found.\n');
          process.exit(0);
        }
      } else {
        // No key specified — show fixable checks and exit
        const INLINE_FIX_KEYS = new Set(Object.keys(INLINE_FIXERS));
        const fixable = failedResults.filter(r => (TECHNIQUES[r.key] && TECHNIQUES[r.key].template) || INLINE_FIX_KEYS.has(r.key));
        const nonFixable = failedResults.filter(r => !(TECHNIQUES[r.key] && TECHNIQUES[r.key].template) && !INLINE_FIX_KEYS.has(r.key));
        console.log('');
        console.log(`  nerviq fix — ${failedResults.length} failed checks\n`);
        if (fixable.length > 0) {
          console.log(`  Auto-fixable (${fixable.length}):`);
          for (const r of fixable) {
            const tier = r.impact === 'critical' ? '🔴' : r.impact === 'high' ? '🟡' : '🔵';
            console.log(`    ${tier} nerviq fix ${r.key}`);
          }
          console.log('');
        }
        if (nonFixable.length > 0) {
          const withPrompt = nonFixable.filter(r => FIX_PROMPTS[r.key]);
          const withoutPrompt = nonFixable.filter(r => !FIX_PROMPTS[r.key]);
          if (withPrompt.length > 0) {
            console.log(`  AI prompt available (${withPrompt.length}):`);
            for (const r of withPrompt.slice(0, 5)) {
              const tier = r.impact === 'critical' ? '🔴' : r.impact === 'high' ? '🟡' : '🔵';
              console.log(`    ${tier} nerviq fix ${r.key} --prompt`);
            }
            if (withPrompt.length > 5) {
              console.log(`    ... and ${withPrompt.length - 5} more`);
            }
            console.log('');
          }
          if (withoutPrompt.length > 0) {
            console.log(`  Manual fix needed (${withoutPrompt.length}):`);
            for (const r of withoutPrompt.slice(0, 5)) {
              const tier = r.impact === 'critical' ? '🔴' : r.impact === 'high' ? '🟡' : '🔵';
              console.log(`    ${tier} ${r.key}: ${r.fix}`);
            }
            if (withoutPrompt.length > 5) {
              console.log(`    ... and ${withoutPrompt.length - 5} more (use --full to see all)`);
            }
            console.log('');
          }
        }
        if (fixable.length > 0) {
          console.log(`  Quick actions:`);
          console.log(`    nerviq fix ${fixable[0].key}        Fix the first auto-fixable check`);
          console.log(`    nerviq fix --all-critical    Fix all critical issues at once`);
        }
        console.log('');
        process.exit(0);
      }

      // Step 2.5: Predict impact and show preview before applying
      const IMPACT_WEIGHTS = { critical: 15, high: 10, medium: 5, low: 2 };
      const preScore = auditResult.score;
      const applicableResults = (auditResult.results || []).filter(r => r.passed !== null);
      const maxScore = applicableResults.reduce((sum, r) => sum + (IMPACT_WEIGHTS[r.impact] || 5), 0);

      // Compute predicted score by simulating target fixes as passing
      const targetKeySet = new Set(targetKeys);
      const INLINE_FIX_KEYS = new Set(Object.keys(INLINE_FIXERS));
      const fixableTargets = targetKeys.filter(k => {
        const tech = TECHNIQUES[k];
        return (tech && tech.template) || INLINE_FIX_KEYS.has(k);
      });
      const fixableTargetSet = new Set(fixableTargets);
      const simulatedEarned = applicableResults.reduce((sum, r) => {
        const w = IMPACT_WEIGHTS[r.impact] || 5;
        if (r.passed) return sum + w;
        if (fixableTargetSet.has(r.key)) return sum + w;
        return sum;
      }, 0);
      const predictedScore = maxScore > 0 ? Math.round((simulatedEarned / maxScore) * 100) : 0;
      const predictedDelta = predictedScore - preScore;

      if (!autoApply && !isDryRun) {
        console.log('');
        if (allCritical && fixableTargets.length > 1) {
          // Multi-fix summary
          console.log(`  ${fixableTargets.length} critical fixes available:`);
          let runningEarned = applicableResults.reduce((s, r) => s + (r.passed ? (IMPACT_WEIGHTS[r.impact] || 5) : 0), 0);
          let runningScore = maxScore > 0 ? Math.round((runningEarned / maxScore) * 100) : 0;
          fixableTargets.forEach((k, idx) => {
            const r = failedResults.find(fr => fr.key === k);
            const w = IMPACT_WEIGHTS[r.impact] || 5;
            const nextEarned = runningEarned + w;
            const nextScore = maxScore > 0 ? Math.round((nextEarned / maxScore) * 100) : 0;
            const d = nextScore - runningScore;
            console.log(`  ${idx + 1}. ${(r.key).padEnd(18)} ${runningScore} → ${nextScore} (+${d})`);
            runningEarned = nextEarned;
            runningScore = nextScore;
          });
          console.log('');
          console.log(`  Total: ${preScore} → ${predictedScore} (+${predictedDelta})`);
        } else {
          // Single fix preview
          const targetCheck = failedResults.find(r => r.key === fixableTargets[0]) || failedResults.find(r => r.key === targetKeys[0]);
          if (targetCheck) {
            console.log(`  Predicted impact: ${preScore} → ${predictedScore} (+${predictedDelta})`);
          }
        }

        // Prompt for confirmation
        const readline = require('readline');
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await new Promise(resolve => {
          rl.question('  Apply? (Y/n) ', resolve);
        });
        rl.close();
        if (answer && answer.trim().toLowerCase() === 'n') {
          for (const key of targetKeys) {
            recordPattern(options.dir, key, 'rejected');
          }
          console.log('\n  Aborted.\n');
          process.exit(0);
        }
      }

      // Step 3: Create rollback snapshot before applying fixes
      const isBatch = allCritical && targetKeys.length > 1;
      let rollbackId = null;
      const allCreatedFiles = [];
      const fixResults = []; // { key, name, status, delta }

      const snapshotFiles = {};
      if (!isDryRun && targetKeys.length > 0) {
        // Snapshot existing files for rollback (before applying fixes)
        for (const key of targetKeys) {
          const technique = TECHNIQUES[key];
          if (technique && technique.template && technique.template.path) {
            const tplPath = pathMod.join(options.dir, technique.template.path);
            if (fs.existsSync(tplPath)) {
              snapshotFiles[technique.template.path] = fs.readFileSync(tplPath, 'utf8');
            }
          }
        }
      }

      // Step 3b: Apply fixes sequentially with progress
      let fixed = 0;
      let manual = 0;
      let runningScore = preScore;

      for (let i = 0; i < targetKeys.length; i++) {
        const key = targetKeys[i];
        const technique = TECHNIQUES[key];
        const failedCheck = failedResults.find(r => r.key === key);
        const progress = isBatch ? `${i + 1}/${targetKeys.length}: ` : '';

        if (technique && technique.template) {
          if (isDryRun) {
            console.log(`  [dry-run] Would fix: ${progress}${failedCheck.name} (${key})`);
            fixResults.push({ key, name: failedCheck.name, status: 'dry-run', delta: 0 });
            fixed++;
          } else {
            try {
              if (isBatch) console.log(`  Fixing ${progress}${key}...`);
              const setupResult = await setup({ ...options, only: [key], silent: true });
              if (setupResult && setupResult.writtenFiles) {
                allCreatedFiles.push(...setupResult.writtenFiles);
              }
              const midResult = await audit({ dir: options.dir, silent: true, platform: options.platform });
              const delta = midResult.score - runningScore;
              fixResults.push({ key, name: failedCheck.name, status: 'fixed', delta });
              runningScore = midResult.score;
              if (!isBatch) console.log(`  ✅ Fixed: ${failedCheck.name}`);
              fixed++;
            } catch (err) {
              fixResults.push({ key, name: failedCheck.name, status: 'failed', delta: 0 });
              if (isBatch) {
                console.log(`  ❌ Failed: ${key} — ${err.message}`);
                console.log(`  Stopping batch. ${fixed} fixes applied so far.`);
                console.log(`  Rollback: nerviq rollback --id ${rollbackId}`);
                break;
              } else {
                console.log(`  ❌ Failed: ${failedCheck.name} — ${err.message}`);
              }
            }
          }
        } else if (INLINE_FIXERS[key]) {
          if (isDryRun) {
            console.log(`  [dry-run] Would fix: ${progress}${failedCheck.name} (${key})`);
            fixResults.push({ key, name: failedCheck.name, status: 'dry-run', delta: 0 });
            fixed++;
          } else {
            try {
              if (isBatch) console.log(`  Fixing ${progress}${key}...`);
              const didFix = INLINE_FIXERS[key](options.dir);
              if (didFix) {
                const midResult = await audit({ dir: options.dir, silent: true, platform: options.platform });
                const delta = midResult.score - runningScore;
                fixResults.push({ key, name: failedCheck.name, status: 'fixed', delta });
                runningScore = midResult.score;
                if (!isBatch) console.log(`  ✅ Fixed: ${failedCheck.name}`);
                fixed++;
              } else {
                fixResults.push({ key, name: failedCheck.name, status: 'skipped', delta: 0 });
                if (!isBatch) console.log(`  ⏭️  Already fixed: ${failedCheck.name}`);
              }
            } catch (err) {
              fixResults.push({ key, name: failedCheck.name, status: 'failed', delta: 0 });
              if (isBatch) {
                console.log(`  ❌ Failed: ${key} — ${err.message}`);
                console.log(`  Stopping batch. ${fixed} fixes applied so far.`);
                console.log(`  Rollback: nerviq rollback --id ${rollbackId}`);
                break;
              }
            }
          }
        } else {
          if (!isBatch) {
            const aiPrompt = FIX_PROMPTS[key];
            if (aiPrompt) {
              console.log(formatFixPrompt(key, aiPrompt));
            } else {
              console.log(`  📋 ${failedCheck.name} (manual fix needed)`);
              console.log(`     ${failedCheck.fix}`);
            }
          }
          fixResults.push({ key, name: failedCheck.name, status: 'skipped', delta: 0 });
          manual++;
        }
      }

      // Record accepted patterns for successfully fixed checks
      if (!isDryRun) {
        for (const key of targetKeys) {
          const fr = fixResults.find(r => r.key === key);
          recordPattern(options.dir, key, fr && fr.status === 'fixed' ? 'accepted' : 'rejected');
        }
      }

      // Write rollback artifact AFTER fixes are applied (with actual file lists)
      if (!isDryRun && targetKeys.length > 0 && fixed > 0) {
        const allPatchedFiles = Object.keys(snapshotFiles);
        // Also track inline-fixer patched files
        for (const fr of fixResults) {
          if (fr.status === 'fixed' && INLINE_FIXERS[fr.key]) {
            const inlinePath = fr.key === 'gitIgnoreEnv' ? '.gitignore' : fr.key === 'secretsProtection' ? '.claude/settings.json' : null;
            if (inlinePath && !allPatchedFiles.includes(inlinePath)) {
              allPatchedFiles.push(inlinePath);
            }
          }
        }
        const rollbackArtifact = writeRollbackArtifact(options.dir, {
          sourcePlan: 'fix-batch',
          preSnapshot: snapshotFiles,
          createdFiles: allCreatedFiles,
          patchedFiles: allPatchedFiles,
          rollbackInstructions: ['Use nerviq rollback to undo these fixes'],
        });
        rollbackId = rollbackArtifact.id;
      }

      // Step 4: Show batch summary or simple score impact
      if (isBatch && fixResults.length > 0) {
        console.log('');
        console.log('  Batch fix complete:');
        for (let i = 0; i < fixResults.length; i++) {
          const r = fixResults[i];
          const icon = r.status === 'fixed' ? '✅' : r.status === 'failed' ? '❌' : '⚠ ';
          const deltaStr = r.status === 'fixed' ? ` (+${r.delta})` : r.status === 'skipped' ? ' (skipped — no auto-fix)' : r.status === 'failed' ? ' (failed)' : ' (dry-run)';
          console.log(`  ${icon} ${i + 1}. ${r.key.padEnd(20)}${deltaStr}`);
        }
        const totalDelta = runningScore - preScore;
        console.log('');
        console.log(`  Score: ${preScore} → ${runningScore} (${totalDelta >= 0 ? '+' : ''}${totalDelta})`);
        if (rollbackId && !isDryRun) {
          console.log(`  Rollback available: nerviq rollback --id ${rollbackId}`);
        }
      } else if (fixed > 0 && !isDryRun) {
        const postResult = await audit({ dir: options.dir, silent: true, platform: options.platform });
        const delta = postResult.score - preScore;
        console.log('');
        console.log(`  Score: ${preScore} → ${postResult.score} (${delta >= 0 ? '+' : ''}${delta})`);
        if (rollbackId) {
          console.log(`  Rollback available: nerviq rollback --id ${rollbackId}`);
        }
      }

      console.log(`\n  ${fixed} fixed, ${manual} need manual action.\n`);

    } else if (normalizedCommand === 'init') {
      const { runInit } = require('../src/init');
      await runInit(options.dir, flags);
      process.exit(0);
    } else if (normalizedCommand === 'setup') {
      collectAnonymousEvent('setup', { platform: options.platform, dir: options.dir });
      const setupResult = await setup({ ...options, silent: options.agentMode || options.json });
      if (options.agentMode) {
        // Agent-mode: structured JSON output with next steps
        const postAudit = await audit({ dir: options.dir, silent: true, platform: options.platform });
        const agentOutput = {
          status: setupResult.created > 0 ? 'files_created' : 'already_configured',
          created: setupResult.created,
          skipped: setupResult.skipped,
          written_files: setupResult.writtenFiles,
          preserved_files: setupResult.preservedFiles,
          detected_stacks: setupResult.stacks.map(s => s.key),
          rollback_id: setupResult.rollbackId,
          post_setup_score: postAudit.score,
          next_commands: [
            'npx @nerviq/cli audit --json',
            setupResult.created > 0 ? `npx @nerviq/cli augment --platform ${options.platform}` : null,
            postAudit.score < 70 ? 'npx @nerviq/cli plan' : null,
          ].filter(Boolean),
        };
        console.log(JSON.stringify(agentOutput, null, 2));
        process.exit(0);
      }
      if (options.snapshot) {
        const postSetupResult = await audit({ dir: options.dir, silent: true, platform: options.platform });
        const snapshot = writeSnapshotArtifact(options.dir, 'audit', postSetupResult, {
          tags: options.snapshotTags,
          milestone: options.snapshotMilestone,
          sourceCommand: 'setup',
        });
        if (!options.json) {
          console.log(`  Snapshot saved: ${snapshot.relativePath}`);
        }
      }
    } else {
      if (options.workspace) {
        const summary = await auditWorkspaces(options.dir, options.workspace, options.platform);
        printWorkspaceSummary(summary, options);
        if (options.threshold !== null && summary.averageScore < options.threshold) {
          process.exit(1);
        }
        process.exit(0);
      }
      // MOAT-01: Harmony-first default — when 2+ platforms and platform not explicit
      let harmonyFirstResult = null;
      if (!options.platformExplicit && !options.noHarmonyFirst && !options.diffOnly && !options.driftMode && !options.workspace) {
        const detected = detectPlatforms(options.dir) || [];
        if (detected.length >= 2) {
          try {
            const { harmonyAudit } = require('../src/harmony/audit');
            harmonyFirstResult = await harmonyAudit({ dir: options.dir, silent: true });
            if (!options.json && harmonyFirstResult) {
              const hs = harmonyFirstResult.harmonyScore;
              const driftCount = (harmonyFirstResult.drift && harmonyFirstResult.drift.drifts) ? harmonyFirstResult.drift.drifts.length : 0;
              const platformLabels = (harmonyFirstResult.activePlatforms || []).map(p => p.label || p.platform).join(' + ');
              const color = hs >= 70 ? '\x1b[32m' : hs >= 40 ? '\x1b[33m' : '\x1b[31m';
              const issueWord = driftCount === 1 ? 'issue' : 'issues';
              console.log('');
              console.log(`\x1b[1m  Harmony Score: ${color}${hs}/100\x1b[0m — ${driftCount} drift ${issueWord} across ${detected.length} platforms (${platformLabels})`);
              console.log('\x1b[2m  Run `nerviq harmony-audit` for the full cross-platform report. Use --no-harmony-first to hide.\x1b[0m');
            }
          } catch {
            harmonyFirstResult = null;
          }
        }
      }

      let result;
      const renderAuditJsonLocally = options.json && (Boolean(options.driftMode) || Boolean(harmonyFirstResult));
      if (options.diffOnly) {
        const { getChangedFiles, buildDiffOnlyAuditView, printDiffOnlyAudit } = require('../src/diff-only');
        const fullResult = await audit({ ...options, silent: true });
        const diffInfo = getChangedFiles(options.dir, {
          diffBase: options.diffBase,
          diffHead: options.diffHead,
        });
        result = buildDiffOnlyAuditView(fullResult, diffInfo);
      } else {
        result = renderAuditJsonLocally
          ? await audit({ ...options, silent: true })
          : await audit(options);
      }

      // ── Telemetry (opt-in, local only) ──
      collectAnonymousEvent('audit', {
        platform: result.platform || options.platform,
        score: result.score,
        checkCount: Array.isArray(result.results) ? result.results.length : null,
        dir: options.dir,
      });

      if (options.driftMode) {
        const { buildContinuousStatus, formatContinuousStatus } = require('../src/continuous-ops');
        let campaigns = [];
        try {
          const planBundle = await buildProposalBundle({
            dir: options.dir,
            platform: options.platform,
            profile: options.profile,
            mcpPacks: options.mcpPacks,
            campaigns: [],
          });
          campaigns = planBundle.campaigns || [];
        } catch {
          campaigns = [];
        }

        result = {
          ...result,
          continuousStatus: buildContinuousStatus({
            dir: options.dir,
            auditResult: result,
            mode: options.driftMode,
            currentPlatforms: detectPlatforms(options.dir),
            campaigns,
          }),
        };
      }

      if (options.policyContract && options.policyContract.layers.some((layer) => layer.valid)) {
        result = {
          ...result,
          policyLayers: options.policyContract,
        };
      }

      if (options.diffOnly) {
        const { printDiffOnlyAudit } = require('../src/diff-only');
        if (options.json) {
          console.log(JSON.stringify({
            version,
            timestamp: new Date().toISOString(),
            ...result,
          }, null, 2));
        } else {
          console.log(printDiffOnlyAudit(result));
          if (result.continuousStatus) {
            const { formatContinuousStatus } = require('../src/continuous-ops');
            console.log(formatContinuousStatus(result.continuousStatus));
            console.log('');
          }
        }
      } else if (renderAuditJsonLocally) {
        const harmonyEnvelope = harmonyFirstResult ? {
          harmony: {
            score: harmonyFirstResult.harmonyScore,
            driftCount: (harmonyFirstResult.drift && harmonyFirstResult.drift.drifts) ? harmonyFirstResult.drift.drifts.length : 0,
            platforms: (harmonyFirstResult.activePlatforms || []).map(p => p.platform),
          },
        } : {};
        console.log(JSON.stringify({
          version,
          timestamp: new Date().toISOString(),
          ...harmonyEnvelope,
          ...result,
        }, null, 2));
      } else {
        if (!options.json && options.policyContract && options.policyContract.layers.some((layer) => layer.valid)) {
          console.log('');
          console.log(formatPolicyContract(options.policyContract));
          console.log('');
        }
        if (!options.json && result.continuousStatus) {
          const { formatContinuousStatus } = require('../src/continuous-ops');
          console.log('');
          console.log(formatContinuousStatus(result.continuousStatus));
          console.log('');
        }
      }
      if (options.out) {
        const fs = require('fs');
        const path = require('path');
        const outPath = path.resolve(options.out);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
        if (!options.json) {
          console.log(`\n  Audit report written to ${options.out}\n`);
        }
      }
      if (options.webhookUrl) {
        try {
          const { sendWebhook, formatSlackMessage, formatGenericAuditWebhookEvent } = require('../src/integrations');
          // Auto-detect Slack vs generic by URL pattern
          const isSlack = options.webhookUrl.includes('hooks.slack.com');
          const isDiscord = options.webhookUrl.includes('discord.com/api/webhooks');
          let payload;
          if (isSlack) {
            payload = formatSlackMessage(result);
          } else if (isDiscord) {
            const { formatDiscordMessage } = require('../src/integrations');
            payload = formatDiscordMessage(result);
          } else {
            payload = formatGenericAuditWebhookEvent(result);
          }
          const webhookResp = await sendWebhook(options.webhookUrl, payload, {
            headers: options.webhookHeaders,
            retries: options.webhookRetries,
          });
          if (!options.json) {
            if (webhookResp.ok) {
              const retryNote = webhookResp.attempts > 1 ? ` after ${webhookResp.attempts} attempts` : '';
              console.log(`  Webhook sent${retryNote}: ${options.webhookUrl} (${webhookResp.status})`);
            } else {
              const retryNote = webhookResp.attempts > 1 ? ` after ${webhookResp.attempts} attempts` : '';
              console.error(`  Webhook failed${retryNote}: ${webhookResp.status} — ${webhookResp.body.slice(0, 200)}`);
            }
          }
        } catch (webhookErr) {
          if (!options.json) {
            const retryNote = webhookErr.attempts > 1 ? ` after ${webhookErr.attempts} attempts` : '';
            console.error(`  Webhook error${retryNote}: ${webhookErr.message}`);
          }
        }
      }
      if (options.feedback && !options.json && options.format === null) {
        const feedbackTargets = options.lite
          ? (result.liteSummary?.topNextActions || [])
          : (result.topNextActions || []);
        const feedbackResult = await collectFeedback(options.dir, {
          findings: feedbackTargets,
          platform: result.platform,
          sourceCommand: normalizedCommand,
          score: result.score,
        });
        if (feedbackResult.mode === 'skipped-noninteractive') {
          console.log('  Feedback prompt skipped: interactive terminal required.');
          console.log('');
        } else if (feedbackResult.saved > 0) {
          console.log(`  Feedback saved: ${feedbackResult.relativeDir}`);
          console.log(`  Helpful: ${feedbackResult.helpful} | Not helpful: ${feedbackResult.unhelpful}`);
          console.log('');
        }
      }
      const snapshot = options.snapshot ? writeSnapshotArtifact(options.dir, 'audit', result, {
        tags: options.snapshotTags,
        milestone: options.snapshotMilestone,
        sourceCommand: normalizedCommand,
      }) : null;
      if (snapshot && !options.json) {
        console.log(`  Snapshot saved: ${snapshot.relativePath}`);
        console.log(`  Snapshot index: ${snapshot.indexPath}`);
        console.log('');
      }
      if (options.threshold !== null && result.score < options.threshold) {
        if (!options.json) {
          console.error(`\n  Error: Threshold not met — score ${result.score}/100 is below required ${options.threshold}/100.`);
          console.error('  Why: Your project audit score is lower than the minimum threshold set via --threshold.');
          console.error('  Fix: Run `npx nerviq augment` to see improvement suggestions, then re-audit.');
          console.error('  Docs: https://github.com/nerviq/nerviq#ci-integration\n');
        }
        process.exit(1);
      }
      if (result.continuousStatus && result.continuousStatus.gate === 'fail') {
        if (!options.json) {
          console.error('\n  Error: Continuous drift gate failed.');
          console.error(`  Why: ${result.continuousStatus.gateLabel}.`);
          console.error('  Fix: review the blocking drift items or add a temporary exception with owner/reason/expiry.');
          console.error('  Docs: https://github.com/nerviq/nerviq#readme\n');
        }
        process.exit(1);
      }
      if (options.require && options.require.length > 0) {
        const failedRequired = options.require.filter(key => {
          const check = result.results.find(r => r.key === key);
          return !check || check.passed !== true;
        });
        if (failedRequired.length > 0) {
          if (!options.json) {
            console.error(`\n  Required checks failed: ${failedRequired.join(', ')}`);
            console.error('  These must pass for CI to succeed.\n');
          }
          process.exit(1);
        }
      }
    }
  } catch (err) {
    console.error(`\n  Error: ${err.message}`);
    console.error('  Fix: Run `npx nerviq doctor` to diagnose common issues, or check https://github.com/nerviq/nerviq#troubleshooting');
    process.exit(2);
  }
}

main();
