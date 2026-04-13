/**
 * Shared helpers for Claude technique modules.
 * Generated mechanically from the legacy monolith during HR-09.
 */

const fs = require('fs');
const path = require('path');
const { collectClaudeDenyRules } = require('../permission-rules');
const {
  hasPromptInjectionDefenseGuidance,
  hasMcpPromptInjectionDefenseGuidance,
  hasInjectionDefenseHookConfigured,
} = require('../prompt-injection');
const {
  getClaudeInstructionBundle,
  getRepoInstructionBundle,
  hasDocumentedVerificationGuidance,
  hasDocumentedTestCommand,
  hasDocumentedLintCommand,
  hasDocumentedBuildCommand,
} = require('../instruction-surfaces');

function hasFrontendSignals(ctx) {
  const pkg = ctx.fileContent('package.json') || '';
  return /react|vue|angular|next|svelte|tailwind|vite|astro/i.test(pkg) ||
    ctx.files.some(f => /tailwind\.config|vite\.config|next\.config|svelte\.config|nuxt\.config|pages\/|components\/|app\//i.test(f));
}

function getClaudeHookContents(ctx) {
  const hookFiles = ctx.dirFiles('.claude/hooks').filter(f => /\.(js|cjs|mjs|ts|sh|py)$/.test(f));
  return hookFiles.map(f => ctx.fileContent(`.claude/hooks/${f}`) || '');
}

function matchesPattern(value, pattern) {
  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(value);
  }
  return value === pattern;
}

function getProjectEntries(ctx) {
  if (ctx.__nerviqProjectEntries) return ctx.__nerviqProjectEntries;

  const entries = [];
  const skippedDirs = new Set([
    '.git',
    '.hg',
    '.svn',
    'node_modules',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache',
    '.venv',
    'venv',
    'env',
    '.tox',
    '.nox',
    'vendor',
    'dist',
    'build',
    'coverage',
  ]);

  const walk = (relPath = '') => {
    const fullPath = relPath
      ? path.join(ctx.dir, ...relPath.split('/'))
      : ctx.dir;

    let dirents = [];
    try {
      dirents = fs.readdirSync(fullPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of dirents) {
      if (dirent.name === '.DS_Store') continue;

      const entryPath = relPath ? `${relPath}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (skippedDirs.has(dirent.name)) continue;
        entries.push(`${entryPath}/`);
        walk(entryPath);
      } else {
        entries.push(entryPath);
      }
    }
  };

  walk();
  ctx.__nerviqProjectEntries = entries;
  return entries;
}

function getProjectFiles(ctx) {
  if (ctx.__nerviqProjectFiles) return ctx.__nerviqProjectFiles;
  ctx.__nerviqProjectFiles = getProjectEntries(ctx).filter(entry => !entry.endsWith('/'));
  return ctx.__nerviqProjectFiles;
}

function findProjectFiles(ctx, pattern) {
  return getProjectFiles(ctx).filter(file => matchesPattern(file, pattern));
}

function hasProjectFile(ctx, pattern) {
  return findProjectFiles(ctx, pattern).length > 0;
}

/**
 * Check if a stack-indicator file exists at a "core" location (root, src/, lib/, app/, packages/)
 * rather than inside examples/, docs/, test/, vendor/, or deeply nested paths.
 * This prevents false stack detection from example/demo code.
 */
const EXCLUDED_STACK_DIRS = /^(examples?|docs?|test|tests|fixtures?|samples?|demo|vendor|third[_-]?party|\.github)\//i;

function hasCoreProjectFile(ctx, pattern) {
  return findProjectFiles(ctx, pattern).some(file => !EXCLUDED_STACK_DIRS.test(file));
}

function hasCoreRootFile(ctx, pattern) {
  // Only match files at project root (no / in path) or one level deep (src/X, lib/X, app/X)
  return findProjectFiles(ctx, pattern).some(file => {
    if (EXCLUDED_STACK_DIRS.test(file)) return false;
    const depth = (file.match(/\//g) || []).length;
    return depth <= 1;
  });
}

function readProjectFiles(ctx, pattern, limit = 60) {
  return findProjectFiles(ctx, pattern)
    .slice(0, limit)
    .map(file => ctx.fileContent(file) || '')
    .filter(Boolean)
    .join('\n');
}

function isPythonProject(ctx) {
  if (ctx.__nerviqIsPython !== undefined) return ctx.__nerviqIsPython;
  // Require a Python config file (pyproject.toml, requirements.txt, setup.py) at a core location.
  // Stray .py files in examples/ or docs/ don't make it a Python project.
  ctx.__nerviqIsPython =
    hasCoreRootFile(ctx, /(^|\/)(pyproject\.toml|setup\.py|Pipfile)$/i) ||
    hasCoreRootFile(ctx, /(^|\/)requirements\.txt$/i);
  return ctx.__nerviqIsPython;
}

function isGoProject(ctx) {
  if (ctx.__nerviqIsGo !== undefined) return ctx.__nerviqIsGo;
  ctx.__nerviqIsGo = hasCoreRootFile(ctx, /(^|\/)go\.mod$/i);
  return ctx.__nerviqIsGo;
}

function isRustProject(ctx) {
  if (ctx.__nerviqIsRust !== undefined) return ctx.__nerviqIsRust;
  ctx.__nerviqIsRust = hasCoreRootFile(ctx, /(^|\/)Cargo\.toml$/i);
  return ctx.__nerviqIsRust;
}

function isJavaProject(ctx) {
  if (ctx.__nerviqIsJava !== undefined) return ctx.__nerviqIsJava;
  ctx.__nerviqIsJava = hasCoreRootFile(ctx, /(^|\/)(pom\.xml|build\.gradle|build\.gradle\.kts)$/i);
  return ctx.__nerviqIsJava;
}

function isFlutterProject(ctx) {
  if (ctx.__nerviqIsFlutter !== undefined) return ctx.__nerviqIsFlutter;
  ctx.__nerviqIsFlutter = hasCoreRootFile(ctx, /(^|\/)pubspec\.yaml$/i);
  return ctx.__nerviqIsFlutter;
}

function isSwiftProject(ctx) {
  if (ctx.__nerviqIsSwift !== undefined) return ctx.__nerviqIsSwift;
  ctx.__nerviqIsSwift = hasCoreRootFile(ctx, /(^|\/)Package\.swift$/i) ||
    hasCoreProjectFile(ctx, /\.xcodeproj/i);
  return ctx.__nerviqIsSwift;
}

function isKotlinProject(ctx) {
  if (ctx.__nerviqIsKotlin !== undefined) return ctx.__nerviqIsKotlin;
  const gradle = (ctx.fileContent('build.gradle.kts') || '') + (ctx.fileContent('build.gradle') || '');
  ctx.__nerviqIsKotlin = /kotlin/i.test(gradle);
  return ctx.__nerviqIsKotlin;
}

function isRubyProject(ctx) {
  if (ctx.__nerviqIsRuby !== undefined) return ctx.__nerviqIsRuby;
  ctx.__nerviqIsRuby = hasCoreRootFile(ctx, /(^|\/)Gemfile$/i);
  return ctx.__nerviqIsRuby;
}

function isPhpProject(ctx) {
  if (ctx.__nerviqIsPhp !== undefined) return ctx.__nerviqIsPhp;
  ctx.__nerviqIsPhp = hasCoreRootFile(ctx, /(^|\/)composer\.json$/i);
  return ctx.__nerviqIsPhp;
}

function isDotnetProject(ctx) {
  if (ctx.__nerviqIsDotnet !== undefined) return ctx.__nerviqIsDotnet;
  ctx.__nerviqIsDotnet = hasCoreProjectFile(ctx, /(^|\/)(.*\.csproj|.*\.sln|global\.json)$/i);
  return ctx.__nerviqIsDotnet;
}

// ─── CTO-07 Framework-native verification signals ───────────────────────
// Memoized on ctx. These are "this stack has verification wired up"
// signals that augment documentation-surface detection.

function hasIosXcodeProject(ctx) {
  if (ctx.__nerviqHasIosXcode !== undefined) return ctx.__nerviqHasIosXcode;
  ctx.__nerviqHasIosXcode =
    hasCoreProjectFile(ctx, /\.xcodeproj\//i) ||
    hasCoreProjectFile(ctx, /\.xcworkspace\//i) ||
    hasCoreRootFile(ctx, /(^|\/)Package\.swift$/i);
  return ctx.__nerviqHasIosXcode;
}

function hasAndroidGradle(ctx) {
  if (ctx.__nerviqHasAndroidGradle !== undefined) return ctx.__nerviqHasAndroidGradle;
  ctx.__nerviqHasAndroidGradle =
    hasCoreRootFile(ctx, /(^|\/)build\.gradle(\.kts)?$/i) ||
    hasCoreRootFile(ctx, /(^|\/)settings\.gradle(\.kts)?$/i);
  return ctx.__nerviqHasAndroidGradle;
}

function hasFlutterProject(ctx) {
  if (ctx.__nerviqHasFlutter !== undefined) return ctx.__nerviqHasFlutter;
  const pubspec = ctx.fileContent('pubspec.yaml') || '';
  ctx.__nerviqHasFlutter = /\bflutter:\s*\n/i.test(pubspec) || /\bsdk:\s*flutter\b/i.test(pubspec);
  return ctx.__nerviqHasFlutter;
}

function _pyProjectText(ctx) {
  return getPythonProjectText(ctx);
}

function hasPythonPoetry(ctx) {
  if (ctx.__nerviqHasPoetry !== undefined) return ctx.__nerviqHasPoetry;
  const text = _pyProjectText(ctx);
  ctx.__nerviqHasPoetry = /\[tool\.poetry\]/i.test(text) || !!ctx.fileContent('poetry.lock');
  return ctx.__nerviqHasPoetry;
}

function hasPythonUv(ctx) {
  if (ctx.__nerviqHasUv !== undefined) return ctx.__nerviqHasUv;
  const text = _pyProjectText(ctx);
  ctx.__nerviqHasUv = /\[tool\.uv\]/i.test(text) || !!ctx.fileContent('uv.lock');
  return ctx.__nerviqHasUv;
}

function hasPythonPdm(ctx) {
  if (ctx.__nerviqHasPdm !== undefined) return ctx.__nerviqHasPdm;
  const text = _pyProjectText(ctx);
  ctx.__nerviqHasPdm = /\[tool\.pdm\b/i.test(text) || !!ctx.fileContent('pdm.lock');
  return ctx.__nerviqHasPdm;
}

function hasPythonHatch(ctx) {
  if (ctx.__nerviqHasHatch !== undefined) return ctx.__nerviqHasHatch;
  const text = _pyProjectText(ctx);
  ctx.__nerviqHasHatch = /\[tool\.hatch\b/i.test(text);
  return ctx.__nerviqHasHatch;
}

function hasFastApiProject(ctx) {
  if (ctx.__nerviqHasFastApi !== undefined) return ctx.__nerviqHasFastApi;
  const text = _pyProjectText(ctx);
  ctx.__nerviqHasFastApi = /\bfastapi\b/i.test(text);
  return ctx.__nerviqHasFastApi;
}

const ML_DEP_PATTERN = /\b(pytorch|torch|tensorflow|keras|scikit-learn|sklearn|jax|transformers|datasets|huggingface|accelerate|xgboost|lightgbm)\b/i;

function hasMlScaffolding(ctx) {
  if (ctx.__nerviqHasMl !== undefined) return ctx.__nerviqHasMl;
  const text = _pyProjectText(ctx);
  if (ML_DEP_PATTERN.test(text)) {
    ctx.__nerviqHasMl = true;
    return true;
  }
  // Heuristic: notebooks/ or experiments/ dir with actual .ipynb files
  const hasNotebooks = findProjectFiles(ctx, /\.ipynb$/i).length > 0;
  ctx.__nerviqHasMl = hasNotebooks;
  return ctx.__nerviqHasMl;
}

/**
 * Checks whether a Python tool is actively configured in pyproject.toml /
 * setup.cfg (e.g., `[tool.ruff]`, `[tool.pytest.ini_options]`,
 * `[tool.mypy]`). When configured, any verification-surface check for that
 * tool should pass: an agent working in this repo can run the tool.
 */
function hasConfiguredTooling(ctx, toolName) {
  const text = _pyProjectText(ctx);
  if (!text) return false;
  const name = String(toolName || '').toLowerCase();
  const sectionRe = new RegExp(`\\[tool\\.${name.replace(/[-_.]/g, '[-_.]')}(?:[.\\]]|\\s|$)`, 'i');
  if (sectionRe.test(text)) return true;
  if (name === 'pytest') {
    return /\[tool\.pytest\.ini_options\]/i.test(text) || /\[tool:pytest\]/i.test(text);
  }
  return false;
}

/**
 * Map category names to their project detection function.
 * Used by the audit to skip entire categories when the stack isn't detected.
 */
const STACK_CATEGORY_DETECTORS = {
  python: isPythonProject,
  go: isGoProject,
  rust: isRustProject,
  java: isJavaProject,
  flutter: isFlutterProject,
  swift: isSwiftProject,
  kotlin: isKotlinProject,
  ruby: isRubyProject,
  php: isPhpProject,
  dotnet: isDotnetProject,
};

function getPythonFiles(ctx) {
  if (ctx.__nerviqPythonFiles) return ctx.__nerviqPythonFiles;
  ctx.__nerviqPythonFiles = findProjectFiles(ctx, /\.py$/i);
  return ctx.__nerviqPythonFiles;
}

function getMainPythonFiles(ctx) {
  if (ctx.__nerviqMainPythonFiles) return ctx.__nerviqMainPythonFiles;
  ctx.__nerviqMainPythonFiles = getPythonFiles(ctx)
    .filter(file => !/(^|\/)(tests?|__pycache__|migrations)\//i.test(file))
    .filter(file => !/(^|\/)(test_[^/]+|conftest)\.py$/i.test(file))
    .slice(0, 50);
  return ctx.__nerviqMainPythonFiles;
}

function getPythonProjectText(ctx) {
  if (ctx.__nerviqPythonProjectText) return ctx.__nerviqPythonProjectText;
  ctx.__nerviqPythonProjectText = [
    readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i),
    readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i),
    readProjectFiles(ctx, /(^|\/)setup\.py$/i),
    readProjectFiles(ctx, /(^|\/)setup\.cfg$/i),
    readProjectFiles(ctx, /(^|\/)Pipfile$/i),
  ].filter(Boolean).join('\n');
  return ctx.__nerviqPythonProjectText;
}

function getGoFiles(ctx) {
  if (ctx.__nerviqGoFiles) return ctx.__nerviqGoFiles;
  ctx.__nerviqGoFiles = findProjectFiles(ctx, /\.go$/i);
  return ctx.__nerviqGoFiles;
}

function getRustFiles(ctx) {
  if (ctx.__nerviqRustFiles) return ctx.__nerviqRustFiles;
  ctx.__nerviqRustFiles = findProjectFiles(ctx, /\.rs$/i);
  return ctx.__nerviqRustFiles;
}

function getMainRustFiles(ctx) {
  if (ctx.__nerviqMainRustFiles) return ctx.__nerviqMainRustFiles;
  ctx.__nerviqMainRustFiles = getRustFiles(ctx)
    .filter(file => !/(^|\/)(tests|target)\//i.test(file))
    .slice(0, 60);
  return ctx.__nerviqMainRustFiles;
}

function getJavaFiles(ctx) {
  if (ctx.__nerviqJavaFiles) return ctx.__nerviqJavaFiles;
  ctx.__nerviqJavaFiles = findProjectFiles(ctx, /\.java$/i);
  return ctx.__nerviqJavaFiles;
}

function getMainJavaFiles(ctx) {
  if (ctx.__nerviqMainJavaFiles) return ctx.__nerviqMainJavaFiles;
  ctx.__nerviqMainJavaFiles = getJavaFiles(ctx)
    .filter(file => !/(^|\/)(test|tests|src\/test)\//i.test(file))
    .slice(0, 60);
  return ctx.__nerviqMainJavaFiles;
}

function getMainGoFiles(ctx) {
  if (ctx.__nerviqMainGoFiles) return ctx.__nerviqMainGoFiles;
  ctx.__nerviqMainGoFiles = getGoFiles(ctx).filter(file => !/_test\.go$/i.test(file)).slice(0, 60);
  return ctx.__nerviqMainGoFiles;
}

function getWorkflowContent(ctx) {
  if (ctx.__nerviqWorkflowContent !== undefined) return ctx.__nerviqWorkflowContent;
  ctx.__nerviqWorkflowContent = readProjectFiles(ctx, /^\.github\/workflows\/.*\.ya?ml$/i);
  return ctx.__nerviqWorkflowContent;
}

function getPreCommitContent(ctx) {
  if (ctx.__nerviqPreCommitContent !== undefined) return ctx.__nerviqPreCommitContent;
  ctx.__nerviqPreCommitContent = readProjectFiles(ctx, /(^|\/)\.pre-commit-config\.ya?ml$/i);
  return ctx.__nerviqPreCommitContent;
}

function getGoProjectText(ctx) {
  if (ctx.__nerviqGoProjectText) return ctx.__nerviqGoProjectText;
  ctx.__nerviqGoProjectText = [
    readProjectFiles(ctx, /(^|\/)go\.mod$/i),
    getWorkflowContent(ctx),
    readProjectFiles(ctx, /(^|\/)Makefile$/),
    getPreCommitContent(ctx),
    getMainGoFiles(ctx).slice(0, 25).map(file => ctx.fileContent(file) || '').filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n');
  return ctx.__nerviqGoProjectText;
}

function getRustProjectText(ctx) {
  if (ctx.__nerviqRustProjectText) return ctx.__nerviqRustProjectText;
  ctx.__nerviqRustProjectText = [
    readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i),
    readProjectFiles(ctx, /(^|\/)(clippy\.toml|\.clippy\.toml|rustfmt\.toml|\.rustfmt\.toml|build\.rs)$/i),
    readProjectFiles(ctx, /(^|\/)\.cargo\/config\.toml$/i),
    getWorkflowContent(ctx),
    getMainRustFiles(ctx).slice(0, 30).map(file => ctx.fileContent(file) || '').filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n');
  return ctx.__nerviqRustProjectText;
}

function getJavaBuildText(ctx) {
  if (ctx.__nerviqJavaBuildText) return ctx.__nerviqJavaBuildText;
  ctx.__nerviqJavaBuildText = [
    readProjectFiles(ctx, /(^|\/)pom\.xml$/i),
    readProjectFiles(ctx, /(^|\/)build\.gradle$/i),
    readProjectFiles(ctx, /(^|\/)build\.gradle\.kts$/i),
    readProjectFiles(ctx, /(^|\/)settings\.gradle$/i),
    readProjectFiles(ctx, /(^|\/)settings\.gradle\.kts$/i),
  ].filter(Boolean).join('\n');
  return ctx.__nerviqJavaBuildText;
}

function getJavaProjectText(ctx) {
  if (ctx.__nerviqJavaProjectText) return ctx.__nerviqJavaProjectText;
  ctx.__nerviqJavaProjectText = [
    getJavaBuildText(ctx),
    getWorkflowContent(ctx),
    readProjectFiles(ctx, /(^|\/)\.editorconfig$/i),
    readProjectFiles(ctx, /(^|\/)(application\.properties|application\.ya?ml|logback.*\.xml|log4j2?.*\.xml)$/i),
    getMainJavaFiles(ctx).slice(0, 30).map(file => ctx.fileContent(file) || '').filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n');
  return ctx.__nerviqJavaProjectText;
}

function getGoInterfaceBlocks(ctx) {
  if (ctx.__nerviqGoInterfaces) return ctx.__nerviqGoInterfaces;
  const blocks = [];
  for (const file of getMainGoFiles(ctx)) {
    const content = ctx.fileContent(file) || '';
    for (const match of content.matchAll(/type\s+\w+\s+interface\s*\{([\s\S]*?)\}/g)) {
      blocks.push(match[1]);
    }
  }
  ctx.__nerviqGoInterfaces = blocks;
  return ctx.__nerviqGoInterfaces;
}

function countGoInterfaceMethods(block) {
  return block
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('//') && !line.startsWith('/*'))
    .length;
}

const { containsEmbeddedSecret } = require('../secret-patterns');
const { attachSourceUrls } = require('../source-urls');
const { buildSupplementalChecks } = require('../supplemental-checks');
const { resolveProjectStateReadPath } = require('../state-paths');

const CLAUDE_SUPPLEMENTAL_SOURCE_URLS = {
  'testing-strategy': 'https://code.claude.com/docs/en/common-workflows',
  'code-quality': 'https://code.claude.com/docs/en/best-practices',
  'api-design': 'https://code.claude.com/docs/en/best-practices',
  database: 'https://code.claude.com/docs/en/common-workflows',
  authentication: 'https://code.claude.com/docs/en/permissions',
  monitoring: 'https://code.claude.com/docs/en/common-workflows',
  'dependency-management': 'https://code.claude.com/docs/en/best-practices',
  'cost-optimization': 'https://code.claude.com/docs/en/memory',
};

module.exports = {
  fs,
  path,
  collectClaudeDenyRules,
  hasPromptInjectionDefenseGuidance,
  hasMcpPromptInjectionDefenseGuidance,
  hasInjectionDefenseHookConfigured,
  getClaudeInstructionBundle,
  getRepoInstructionBundle,
  hasDocumentedVerificationGuidance,
  hasDocumentedTestCommand,
  hasDocumentedLintCommand,
  hasDocumentedBuildCommand,
  hasFrontendSignals,
  getClaudeHookContents,
  matchesPattern,
  getProjectEntries,
  getProjectFiles,
  findProjectFiles,
  hasProjectFile,
  EXCLUDED_STACK_DIRS,
  hasCoreProjectFile,
  hasCoreRootFile,
  readProjectFiles,
  isPythonProject,
  isGoProject,
  isRustProject,
  isJavaProject,
  isFlutterProject,
  isSwiftProject,
  isKotlinProject,
  isRubyProject,
  isPhpProject,
  isDotnetProject,
  STACK_CATEGORY_DETECTORS,
  hasIosXcodeProject,
  hasAndroidGradle,
  hasFlutterProject,
  hasPythonPoetry,
  hasPythonUv,
  hasPythonPdm,
  hasPythonHatch,
  hasFastApiProject,
  hasMlScaffolding,
  hasConfiguredTooling,
  getPythonFiles,
  getMainPythonFiles,
  getPythonProjectText,
  getGoFiles,
  getRustFiles,
  getMainRustFiles,
  getJavaFiles,
  getMainJavaFiles,
  getMainGoFiles,
  getWorkflowContent,
  getPreCommitContent,
  getGoProjectText,
  getRustProjectText,
  getJavaBuildText,
  getJavaProjectText,
  getGoInterfaceBlocks,
  countGoInterfaceMethods,
  containsEmbeddedSecret,
  attachSourceUrls,
  buildSupplementalChecks,
  resolveProjectStateReadPath,
  CLAUDE_SUPPLEMENTAL_SOURCE_URLS,
};
