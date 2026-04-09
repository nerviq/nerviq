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

function summarizeWorkspaceEntry(result, workspacePath, absPath, platform) {
  const stackKeys = (result.stacks || []).map((item) => item.key);
  const stackLabels = (result.stacks || []).map((item) => item.label);
  return {
    name: path.basename(workspacePath),
    workspace: workspacePath,
    dir: absPath,
    platform,
    stackKeys,
    stackLabels,
    workspaceProfile: classifyWorkspaceProfile(stackKeys),
    ...summarizeAuditResult(result, 'workspace-live-audit', 'workspace-package'),
  };
}

function classifyWorkspaceProfile(stackKeys) {
  const keys = new Set(Array.isArray(stackKeys) ? stackKeys : []);
  const matchAny = (candidates) => candidates.some((candidate) => keys.has(candidate));

  if (matchAny(['go'])) {
    return { key: 'go-workspace', label: 'Go workspace' };
  }
  if (matchAny(['python', 'django', 'fastapi'])) {
    return { key: 'python-workspace', label: 'Python workspace' };
  }
  if (matchAny(['dotnet'])) {
    return { key: 'dotnet-workspace', label: '.NET workspace' };
  }
  if (matchAny(['java', 'spring'])) {
    return { key: 'java-workspace', label: 'Java workspace' };
  }
  if (matchAny(['flutter', 'dart'])) {
    return { key: 'flutter-workspace', label: 'Flutter workspace' };
  }
  if (matchAny(['swift'])) {
    return { key: 'swift-workspace', label: 'Swift workspace' };
  }
  if (matchAny(['kotlin'])) {
    return { key: 'kotlin-workspace', label: 'Kotlin workspace' };
  }
  if (matchAny(['react', 'nextjs', 'node', 'typescript', 'javascript', 'nestjs', 'vue', 'angular', 'svelte'])) {
    return { key: 'node-workspace', label: 'Node / JS workspace' };
  }

  return { key: 'general-workspace', label: 'General workspace' };
}

function buildProfileBreakdown(results) {
  const grouped = new Map();

  for (const item of results) {
    const profileKey = item.workspaceProfile?.key || 'general-workspace';
    const profileLabel = item.workspaceProfile?.label || 'General workspace';
    if (!grouped.has(profileKey)) {
      grouped.set(profileKey, {
        profileKey,
        profileLabel,
        scoreType: 'workspace-live-audit',
        workspaceCount: 0,
        workspaces: [],
        stackLabels: new Set(),
        scores: [],
        totals: [],
      });
    }

    const entry = grouped.get(profileKey);
    entry.workspaceCount += 1;
    entry.workspaces.push(item.workspace);
    for (const label of item.stackLabels || []) {
      entry.stackLabels.add(label);
    }
    if (typeof item.score === 'number') {
      entry.scores.push(item.score);
    }
    if (typeof item.total === 'number') {
      entry.totals.push(item.total);
    }
  }

  return [...grouped.values()]
    .map((entry) => ({
      profileKey: entry.profileKey,
      profileLabel: entry.profileLabel,
      scoreType: 'workspace-live-audit',
      workspaceCount: entry.workspaceCount,
      averageScore: entry.scores.length > 0
        ? Math.round(entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length)
        : 0,
      averageTotal: entry.totals.length > 0
        ? Math.round(entry.totals.reduce((sum, value) => sum + value, 0) / entry.totals.length)
        : 0,
      stackLabels: [...entry.stackLabels].sort(),
      workspaces: entry.workspaces.sort(),
    }))
    .sort((left, right) => left.profileLabel.localeCompare(right.profileLabel));
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
      results.push(summarizeWorkspaceEntry(result, workspacePath, absPath, platform));
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
        stackKeys: [],
        stackLabels: [],
        workspaceProfile: { key: 'general-workspace', label: 'General workspace' },
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
  const profileBreakdown = buildProfileBreakdown(results);

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
    profileBreakdown,
    scoreSemantics: {
      rootGovernance: 'Root repo live audit for shared instructions, hooks, permissions, and top-level governance files.',
      workspaceAggregate: 'Average of the selected workspace live audit scores. This is a package coverage rollup, not the root repo score.',
      workspaceEntries: 'Each workspace row is a package-level live audit. Package scores can differ from the root governance score for legitimate reasons.',
      workspaceProfiles: 'Workspace totals can differ because each package uses a stack-specific check profile based on detected languages and frameworks.',
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
