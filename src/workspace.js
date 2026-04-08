const fs = require('fs');
const path = require('path');

function normalizePath(value) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function unique(items) {
  return [...new Set(items.filter(Boolean).map(normalizePath))];
}

function hasWorkspaceConfig(dir) {
  return [
    'turbo.json',
    'lerna.json',
    'pnpm-workspace.yaml',
  ].some((file) => fs.existsSync(path.join(dir, file))) ||
    Boolean(readJsonSafe(path.join(dir, 'package.json'))?.workspaces);
}

function packageWorkspacePatterns(dir) {
  const pkg = readJsonSafe(path.join(dir, 'package.json')) || {};
  const workspaces = pkg.workspaces;

  if (Array.isArray(workspaces)) {
    return workspaces;
  }

  if (workspaces && Array.isArray(workspaces.packages)) {
    return workspaces.packages;
  }

  return [];
}

function lernaWorkspacePatterns(dir) {
  const lerna = readJsonSafe(path.join(dir, 'lerna.json')) || {};
  return Array.isArray(lerna.packages) ? lerna.packages : [];
}

function pnpmWorkspacePatterns(dir) {
  const content = readTextSafe(path.join(dir, 'pnpm-workspace.yaml'));
  if (!content) return [];

  const matches = [];
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*["']?([^"']+)["']?\s*$/);
    if (match) {
      matches.push(match[1]);
    }
  }
  return matches;
}

function turboWorkspacePatterns(dir) {
  if (!fs.existsSync(path.join(dir, 'turbo.json'))) {
    return [];
  }

  const commonPatterns = [];
  for (const candidate of ['apps', 'packages', 'services']) {
    if (fs.existsSync(path.join(dir, candidate)) && fs.statSync(path.join(dir, candidate)).isDirectory()) {
      commonPatterns.push(`${candidate}/*`);
    }
  }

  return commonPatterns;
}

function listDirectories(rootDir) {
  const found = [];
  const queue = [''];

  while (queue.length > 0) {
    const relative = queue.shift();
    const full = path.join(rootDir, relative);

    let entries = [];
    try {
      entries = fs.readdirSync(full, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next' || entry.name === 'dist') continue;
      const child = normalizePath(path.join(relative, entry.name));
      found.push(child);
      queue.push(child);
    }
  }

  return found;
}

function globToRegExp(pattern) {
  const normalized = normalizePath(pattern)
    .replace(/\*\*/g, '__DOUBLE_STAR__')
    .replace(/\*/g, '__SINGLE_STAR__')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/__DOUBLE_STAR__/g, '.*')
    .replace(/__SINGLE_STAR__/g, '[^/]+');
  return new RegExp(`^${normalized}$`);
}

function expandWorkspacePatterns(dir, patterns) {
  const normalizedPatterns = unique(Array.isArray(patterns) ? patterns : []);
  if (normalizedPatterns.length === 0) {
    return [];
  }

  const allDirs = listDirectories(dir);
  const matches = [];

  for (const pattern of normalizedPatterns) {
    const fullPath = path.join(dir, pattern);
    if (!pattern.includes('*') && fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      matches.push(normalizePath(pattern));
      continue;
    }

    const matcher = globToRegExp(pattern);
    for (const candidate of allDirs) {
      if (matcher.test(candidate)) {
        matches.push(candidate);
      }
    }
  }

  return unique(matches);
}

function detectWorkspaceGlobs(dir) {
  return unique([
    ...packageWorkspacePatterns(dir),
    ...lernaWorkspacePatterns(dir),
    ...pnpmWorkspacePatterns(dir),
    ...turboWorkspacePatterns(dir),
  ]);
}

function detectWorkspaces(dir) {
  return expandWorkspacePatterns(dir, detectWorkspaceGlobs(dir));
}

function parseWorkspaceSelection(value) {
  if (!value) return [];
  if (Array.isArray(value)) return unique(value);
  return unique(String(value).split(',').map((item) => item.trim()).filter(Boolean));
}

function summarizeAuditResult(result, scoreType, scope) {
  return {
    scope,
    scoreType,
    score: typeof result?.score === 'number' ? result.score : null,
    passed: typeof result?.passed === 'number' ? result.passed : 0,
    total: typeof result?.checkCount === 'number' ? result.checkCount : 0,
    topAction: result?.topNextActions?.[0]?.name || null,
  };
}

async function auditWorkspaces(dir, workspaceGlobs, platform = 'claude') {
  const { audit } = require('./audit');
  const rootDir = path.resolve(dir);
  const selectedPatterns = parseWorkspaceSelection(workspaceGlobs);
  const sourcePatterns = selectedPatterns.length > 0 ? selectedPatterns : detectWorkspaceGlobs(rootDir);
  const workspacePaths = selectedPatterns.length > 0
    ? expandWorkspacePatterns(rootDir, selectedPatterns)
    : detectWorkspaces(rootDir);
  const results = [];
  let rootGovernance;

  try {
    const rootResult = await audit({ dir: rootDir, platform, silent: true });
    rootGovernance = summarizeAuditResult(rootResult, 'root-live-audit', 'root-governance');
  } catch (error) {
    rootGovernance = {
      scope: 'root-governance',
      scoreType: 'root-live-audit',
      score: null,
      passed: 0,
      total: 0,
      topAction: null,
      error: error.message,
    };
  }

  for (const workspacePath of workspacePaths) {
    const absPath = path.join(rootDir, workspacePath);
    try {
      const result = await audit({ dir: absPath, platform, silent: true });
      results.push({
        name: path.basename(workspacePath),
        workspace: workspacePath,
        dir: absPath,
        platform,
        ...summarizeAuditResult(result, 'workspace-live-audit', 'workspace-package'),
        result,
      });
    } catch (error) {
      results.push({
        name: path.basename(workspacePath),
        workspace: workspacePath,
        dir: absPath,
        platform,
        scope: 'workspace-package',
        scoreType: 'workspace-live-audit',
        score: null,
        passed: 0,
        total: 0,
        topAction: null,
        error: error.message,
      });
    }
  }

  const validScores = results.filter((item) => typeof item.score === 'number').map((item) => item.score);
  const averageScore = validScores.length > 0
    ? Math.round(validScores.reduce((sum, value) => sum + value, 0) / validScores.length)
    : 0;
  const maxScore = validScores.length > 0 ? Math.max(...validScores) : 0;
  const minScore = validScores.length > 0 ? Math.min(...validScores) : 0;

  return {
    summaryType: 'monorepo-workspace-audit',
    rootDir,
    platform,
    selectionMode: selectedPatterns.length > 0 ? 'explicit-patterns' : 'detected-workspaces',
    patterns: sourcePatterns,
    rootGovernance,
    workspaceAggregate: {
      scope: 'workspace-aggregate',
      scoreType: 'workspace-average-live-audit',
      score: averageScore,
      workspaceCount: workspacePaths.length,
      maxScore,
      minScore,
    },
    scoreSemantics: {
      rootGovernance: 'Root repo live audit for shared instructions, hooks, permissions, and top-level governance files.',
      workspaceAggregate: 'Average of the selected workspace live audit scores. This is a package coverage rollup, not the root repo score.',
      workspaceEntries: 'Each workspace row is a package-level live audit. Package scores can differ from the root governance score for legitimate reasons.',
    },
    workspaces: results,
    detectedWorkspaces: workspacePaths,
    workspaceCount: workspacePaths.length,
    averageScoreType: 'workspace-average-live-audit',
    averageScore,
    maxScore,
    minScore,
  };
}

module.exports = {
  hasWorkspaceConfig,
  detectWorkspaceGlobs,
  detectWorkspaces,
  parseWorkspaceSelection,
  auditWorkspaces,
};
