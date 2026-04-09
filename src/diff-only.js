'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

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

const WEIGHTS = { critical: 15, high: 10, medium: 5, low: 2 };
const IMPACT_ORDER = { critical: 3, high: 2, medium: 1, low: 0 };

const CATEGORY_HINTS = [
  {
    pattern: /^(CLAUDE\.md|\.claude\/)/i,
    categories: ['memory', 'workflow', 'security', 'automation', 'prompting', 'features', 'skills', 'agents', 'review', 'tools', 'git', 'quality'],
  },
  {
    pattern: /^(AGENTS\.md|\.codex\/)/i,
    categories: ['memory', 'workflow', 'security', 'automation', 'prompting', 'features', 'skills', 'agents', 'review', 'tools', 'git', 'local'],
  },
  {
    pattern: /^(GEMINI\.md|\.gemini\/)/i,
    categories: ['memory', 'workflow', 'security', 'automation', 'prompting', 'features', 'skills', 'agents', 'review', 'tools'],
  },
  {
    pattern: /^(\.cursor\/|\.cursorrules$)/i,
    categories: ['workflow', 'security', 'automation', 'prompting', 'features', 'tools', 'review'],
  },
  {
    pattern: /^(\.windsurf\/|\.windsurfrules$|\.cascadeignore$)/i,
    categories: ['workflow', 'security', 'automation', 'prompting', 'features', 'tools', 'review'],
  },
  {
    pattern: /^(\.github\/copilot-instructions\.md|\.github\/instructions\/|\.github\/prompts\/|\.vscode\/mcp\.json$)/i,
    categories: ['workflow', 'prompting', 'tools', 'review', 'devops'],
  },
  {
    pattern: /^(opencode\.jsonc?$|\.opencode\/)/i,
    categories: ['workflow', 'security', 'automation', 'prompting', 'features', 'skills', 'agents', 'tools', 'review'],
  },
  {
    pattern: /^\.mcp\.json$/i,
    categories: ['tools', 'security'],
  },
  {
    pattern: /^(\.gitignore$|package\.json$|pyproject\.toml$|requirements.*\.txt$|\.github\/workflows\/)/i,
    categories: ['hygiene', 'devops', 'security', 'quality', 'tools'],
  },
];

function c(text, color) {
  return `${COLORS[color] || ''}${text}${COLORS.reset}`;
}

function normalizeRelativePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function runGit(dir, args) {
  return spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
  });
}

function collectOutputLines(result) {
  return `${result.stdout || ''}`
    .split(/\r?\n/)
    .map((line) => normalizeRelativePath(line.trim()))
    .filter(Boolean);
}

function uniquePaths(paths) {
  return [...new Set((paths || []).map(normalizeRelativePath).filter(Boolean))].sort();
}

function getRangeOptions(options = {}) {
  const base = options.diffBase ||
    process.env.NERVIQ_DIFF_BASE ||
    process.env.GITHUB_BASE_SHA ||
    process.env.GIT_BASE_SHA ||
    null;
  const head = options.diffHead ||
    process.env.NERVIQ_DIFF_HEAD ||
    process.env.GITHUB_SHA ||
    process.env.GIT_HEAD_SHA ||
    'HEAD';
  return { base, head };
}

function getChangedFiles(dir, options = {}) {
  const repoCheck = runGit(dir, ['rev-parse', '--is-inside-work-tree']);
  if (repoCheck.status !== 0) {
    return {
      mode: 'unavailable',
      changedFiles: [],
      message: 'Diff-only mode requires a git repository.',
    };
  }

  const { base, head } = getRangeOptions(options);
  if (base) {
    const rangeResult = runGit(dir, ['diff', '--name-only', '--diff-filter=ACMRTUXB', `${base}..${head}`]);
    if (rangeResult.status === 0) {
      return {
        mode: 'range',
        base,
        head,
        changedFiles: uniquePaths(collectOutputLines(rangeResult)),
      };
    }
  }

  const unstaged = runGit(dir, ['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD', '--']);
  const staged = runGit(dir, ['diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB', '--']);
  const untracked = runGit(dir, ['ls-files', '--others', '--exclude-standard']);

  return {
    mode: 'working-tree',
    changedFiles: uniquePaths([
      ...collectOutputLines(unstaged),
      ...collectOutputLines(staged),
      ...collectOutputLines(untracked),
    ]),
  };
}

function matchesChangedFile(filePath, changedFiles) {
  if (!filePath) return false;
  const normalized = normalizeRelativePath(filePath).replace(/\/$/, '');

  return changedFiles.some((changed) => {
    const target = changed.replace(/\/$/, '');
    return normalized === target ||
      normalized.startsWith(`${target}/`) ||
      target.startsWith(`${normalized}/`);
  });
}

function inferRelevantCategories(changedFiles) {
  const categories = new Set();

  for (const filePath of changedFiles) {
    for (const hint of CATEGORY_HINTS) {
      if (hint.pattern.test(filePath)) {
        hint.categories.forEach((category) => categories.add(category));
      }
    }
  }

  return categories;
}

function isRelevantResult(result, changedFiles, changedCategories) {
  if (!result || result.deprecated) return false;
  if (matchesChangedFile(result.file, changedFiles)) return true;
  if (!result.file && result.category && changedCategories.has(result.category)) return true;
  return false;
}

function buildFallbackActions(failed) {
  return failed
    .slice()
    .sort((a, b) => (IMPACT_ORDER[b.impact] || 0) - (IMPACT_ORDER[a.impact] || 0) || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map((item) => ({
      key: item.key,
      name: item.name,
      impact: item.impact,
      category: item.category,
      fix: item.fix,
      file: item.file || null,
    }));
}

function buildDiffOnlyAuditView(auditResult, diffInfo) {
  const changedFiles = uniquePaths(diffInfo.changedFiles || []);
  const changedCategories = inferRelevantCategories(changedFiles);
  const relevantResults = (auditResult.results || []).filter((item) => isRelevantResult(item, changedFiles, changedCategories));
  const applicable = relevantResults.filter((item) => item.passed !== null && item.deprecated !== true);
  const skipped = relevantResults.filter((item) => item.passed === null && item.deprecated !== true);
  const passed = applicable.filter((item) => item.passed === true);
  const failed = applicable.filter((item) => item.passed === false);
  const maxScore = applicable.reduce((sum, item) => sum + (WEIGHTS[item.impact] || 5), 0);
  const earnedScore = passed.reduce((sum, item) => sum + (WEIGHTS[item.impact] || 5), 0);
  const score = applicable.length > 0 && maxScore > 0 ? Math.round((earnedScore / maxScore) * 100) : null;
  const relevantKeys = new Set(relevantResults.map((item) => item.key));
  const topNextActions = (auditResult.topNextActions || []).filter((item) => relevantKeys.has(item.key)).slice(0, 5);
  const fallbackActions = buildFallbackActions(failed);

  const message = changedFiles.length === 0
    ? (diffInfo.message || 'No changed files detected for diff-only mode.')
    : 'Diff-only mode filters to changed files plus linked governance/config surfaces. Run `nerviq audit` for complete repo posture.';

  return {
    platform: auditResult.platform,
    platformLabel: auditResult.platformLabel,
    diffOnly: true,
    score,
    scoreType: 'diff-only changed-file audit',
    passed: passed.length,
    failed: failed.length,
    skipped: skipped.length,
    checkCount: applicable.length,
    changedFiles,
    changedFilesCount: changedFiles.length,
    diffMode: diffInfo.mode,
    diffBase: diffInfo.base || null,
    diffHead: diffInfo.head || null,
    fullAuditScore: auditResult.score,
    message,
    results: relevantResults,
    topNextActions: topNextActions.length > 0 ? topNextActions : fallbackActions,
    suggestedNextCommand: 'nerviq audit',
  };
}

function printDiffOnlyAudit(result) {
  const lines = [''];
  lines.push(c('  nerviq diff-only audit', 'bold'));
  lines.push(c('  ═══════════════════════════════════════', 'dim'));
  lines.push('');

  if (result.diffMode === 'range' && result.diffBase) {
    lines.push(c(`  Diff range: ${result.diffBase}..${result.diffHead}`, 'dim'));
  } else {
    lines.push(c('  Diff source: working tree vs HEAD', 'dim'));
  }

  if (result.changedFilesCount === 0) {
    lines.push(c(`  ${result.message}`, 'yellow'));
    lines.push(c('  Tip: commit or stage a change first, or provide a PR base SHA via --diff-base.', 'dim'));
    lines.push('');
    return lines.join('\n');
  }

  lines.push(c(`  Changed files (${result.changedFilesCount}):`, 'bold'));
  result.changedFiles.slice(0, 8).forEach((filePath) => {
    lines.push(`    ${c('•', 'blue')} ${filePath}`);
  });
  if (result.changedFilesCount > 8) {
    lines.push(c(`    ...and ${result.changedFilesCount - 8} more`, 'dim'));
  }

  lines.push('');
  lines.push(`  Score: ${result.score === null ? c('n/a', 'yellow') : c(`${result.score}/100`, 'bold')}`);
  lines.push(c(`  Score type: ${result.scoreType} (not the full repo score of ${result.fullAuditScore}/100).`, 'dim'));
  lines.push(c(`  ${result.message}`, 'dim'));
  lines.push('');

  if (result.topNextActions && result.topNextActions.length > 0) {
    lines.push(c('  Top diff-relevant actions:', 'magenta'));
    result.topNextActions.slice(0, 5).forEach((item, index) => {
      lines.push(`  ${index + 1}. ${c(item.name, 'bold')} ${c(`[${item.impact}]`, 'dim')}`);
      if (item.fix) {
        lines.push(c(`     ${item.fix}`, 'dim'));
      }
    });
    lines.push('');
  }

  lines.push(`  Relevant checks: ${result.checkCount}  |  Failed: ${result.failed}  |  Passed: ${result.passed}  |  Skipped: ${result.skipped}`);
  lines.push(c('  Run `nerviq audit` for the complete repo posture.', 'dim'));
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  getChangedFiles,
  buildDiffOnlyAuditView,
  printDiffOnlyAudit,
};
