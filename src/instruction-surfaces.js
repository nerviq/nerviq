const path = require('path');

const TEST_COMMAND_PATTERNS = [
  /\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+test\b/i,
  /\b(?:python\s+-m\s+)?pytest\b/i,
  /\bpython\s+manage\.py\s+test\b/i,
  /\bdjango-admin\s+test\b/i,
  /\bpython\s+-m\s+unittest\b/i,
  /\bpoetry\s+run\s+(?:pytest|test)\b/i,
  /\buv\s+run\s+(?:pytest|test)\b/i,
  /\bpdm\s+run\s+(?:pytest|test)\b/i,
  /\bhatch\s+run\s+(?:test|pytest)\b/i,
  /\brye\s+run\s+(?:test|pytest)\b/i,
  /\btox(?:\s|$)/i,
  /\bnox(?:\s|$)/i,
  /\bgo\s+test(?:\s|$)/i,
  /\bcargo\s+test\b/i,
  /\bmake\s+(?:test|check|ci)\b/i,
  /\bjust\s+test\b/i,
  /\bmix\s+test\b/i,
  /\bbundle\s+exec\s+rspec\b/i,
  /\brspec\b/i,
  /\bphpunit\b/i,
  /\bdotnet\s+test(?:\s|$)/i,
  /\bflutter\s+test\b/i,
  /\bfvm\s+flutter\s+test\b/i,
  /\bswift\s+test\b/i,
  /\bxcodebuild\b[^\n\r`]{0,200}\btest\b/i,
  /\bfastlane\s+(?:test|scan)\b/i,
  /\bxctest\b/i,
  /\bgradlew?\s+(?:test|check|connectedAndroidTest)\b/i,
  /\bmvn(?:w)?\s+test\b/i,
  /\bplaywright\s+test\b/i,
  /\bcypress\s+run\b/i,
  // pyproject.toml / setup.cfg tool configuration signals
  /\[tool\.pytest\.ini_options\]/i,
  /\[tool:pytest\]/i,
  // Manifest / config signals that testing is wired up
  /\bpytest\s*[=:]/i,
];

const LINT_COMMAND_PATTERNS = [
  /\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+lint\b/i,
  /\beslint\b/i,
  /\bprettier\b/i,
  /\bruff(?:\s+(?:check|format))?\b/i,
  /\bblack\b/i,
  /\bflake8\b/i,
  /\bpylint\b/i,
  /\bmypy\b/i,
  /\bpyright\b/i,
  /\bpre-commit\s+run\b/i,
  /\bgo\s+vet\b/i,
  /\bgofmt\b/i,
  /\bgofumpt\b/i,
  /\bstaticcheck\b/i,
  /\bgolangci-lint\b/i,
  /\bcargo\s+clippy\b/i,
  /\bflutter\s+analyze\b/i,
  /\bdart\s+analyze\b/i,
  /\bdart\s+format\b/i,
  /\bswiftlint\b/i,
  /\bswift(?:-|\s+)format\b/i,
  /\bdotnet\s+format(?:\s|$)/i,
  /\bgradlew?\s+(?:lint|ktlintCheck|detekt|spotless(?:Check|Apply)?)\b/i,
  /\bmvn(?:w)?\s+(?:checkstyle:check|spotbugs:check|verify)\b/i,
  // pyproject.toml / config signals
  /\[tool\.ruff\]/i,
  /\[tool\.black\]/i,
  /\[tool\.mypy\]/i,
  /\[tool\.pyright\]/i,
  /\[tool\.flake8\]/i,
  /\[tool\.pylint\b/i,
];

const BUILD_COMMAND_PATTERNS = [
  /\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+build\b/i,
  /\btsc(?:\s|$)/i,
  /\bgo\s+build(?:\s|$)/i,
  /\bcargo\s+(?:build|check)\b/i,
  /\bmake\s+(?:build|all)\b/i,
  /\bjust\s+build\b/i,
  /\bdotnet\s+(?:build|publish)(?:\s|$)/i,
  /\bmsbuild\b/i,
  /\bflutter\s+build(?:\s|$)/i,
  /\bswift\s+build\b/i,
  /\bxcodebuild\b/i,
  /\bgradlew?\s+(?:build|assemble|assembleDebug|assembleRelease)\b/i,
  /\bmvn(?:w)?\s+(?:compile|package|verify|install)\b/i,
  /\bpython\s+-m\s+build\b/i,
  /\bpoetry\s+build\b/i,
  /\buv\s+build\b/i,
  /\bhatch\s+build\b/i,
  /\bpdm\s+build\b/i,
];

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function addSurface(ctx, surfaces, seen, filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized || seen.has(normalized)) return;
  const content = typeof ctx.fileContent === 'function' ? (ctx.fileContent(normalized) || '') : '';
  if (!content.trim()) return;
  seen.add(normalized);
  surfaces.push({ path: normalized, content });
}

function addDirSurfaces(ctx, surfaces, seen, dirPath, filter) {
  if (typeof ctx.dirFiles !== 'function') return;
  for (const entry of ctx.dirFiles(dirPath) || []) {
    if (filter && !filter.test(entry)) continue;
    addSurface(ctx, surfaces, seen, path.join(dirPath, entry));
  }
}

function buildSurfaceList(ctx, scope) {
  const surfaces = [];
  const seen = new Set();
  const includeReadme = scope === 'repo';

  addSurface(ctx, surfaces, seen, 'CLAUDE.md');
  addSurface(ctx, surfaces, seen, '.claude/CLAUDE.md');
  addDirSurfaces(ctx, surfaces, seen, '.claude/rules', /\.md$/i);
  addDirSurfaces(ctx, surfaces, seen, '.claude/commands', /\.md$/i);
  addDirSurfaces(ctx, surfaces, seen, '.claude/agents', /\.md$/i);

  if (scope === 'repo') {
    addSurface(ctx, surfaces, seen, 'AGENTS.md');
    addSurface(ctx, surfaces, seen, 'AGENTS.override.md');
    addSurface(ctx, surfaces, seen, '.cursorrules');
    addSurface(ctx, surfaces, seen, '.windsurfrules');
    addSurface(ctx, surfaces, seen, 'GEMINI.md');
    addSurface(ctx, surfaces, seen, '.gemini/GEMINI.md');
    addSurface(ctx, surfaces, seen, '.github/copilot-instructions.md');
    addDirSurfaces(ctx, surfaces, seen, '.cursor/rules', /\.(md|mdc)$/i);
    addDirSurfaces(ctx, surfaces, seen, '.cursor/commands', /\.md$/i);
    addDirSurfaces(ctx, surfaces, seen, '.windsurf/rules', /\.md$/i);
    addDirSurfaces(ctx, surfaces, seen, '.windsurf/workflows', /\.md$/i);
    addDirSurfaces(ctx, surfaces, seen, '.github/instructions', /\.instructions\.md$/i);
    addDirSurfaces(ctx, surfaces, seen, '.github/prompts', /\.prompt\.md$/i);
    addDirSurfaces(ctx, surfaces, seen, '.opencode/commands', /\.(md|markdown|ya?ml)$/i);
    addDirSurfaces(ctx, surfaces, seen, '.gemini/agents', /\.md$/i);
  }

  if (includeReadme) {
    addSurface(ctx, surfaces, seen, 'README.md');
    addSurface(ctx, surfaces, seen, 'CONTRIBUTING.md');
    // CTO-07: framework-native verification surfaces. When a repo has
    // `flutter test` in CONTRIBUTING.md, pytest configured in
    // pyproject.toml, xcodebuild wired in a workflow, or gradle test in
    // build.gradle, that is legitimate evidence of verification — an
    // agent working in this repo can observe these files directly.
    addSurface(ctx, surfaces, seen, 'pyproject.toml');
    addSurface(ctx, surfaces, seen, 'setup.cfg');
    addSurface(ctx, surfaces, seen, 'tox.ini');
    addSurface(ctx, surfaces, seen, 'noxfile.py');
    addSurface(ctx, surfaces, seen, 'Pipfile');
    addSurface(ctx, surfaces, seen, 'Makefile');
    addSurface(ctx, surfaces, seen, 'justfile');
    addSurface(ctx, surfaces, seen, 'Justfile');
    addSurface(ctx, surfaces, seen, 'Rakefile');
    addSurface(ctx, surfaces, seen, 'pubspec.yaml');
    addSurface(ctx, surfaces, seen, 'analysis_options.yaml');
    addSurface(ctx, surfaces, seen, 'Package.swift');
    addSurface(ctx, surfaces, seen, 'Podfile');
    addSurface(ctx, surfaces, seen, 'Cartfile');
    addSurface(ctx, surfaces, seen, 'fastlane/Fastfile');
    addSurface(ctx, surfaces, seen, 'build.gradle');
    addSurface(ctx, surfaces, seen, 'build.gradle.kts');
    addSurface(ctx, surfaces, seen, 'settings.gradle');
    addSurface(ctx, surfaces, seen, 'settings.gradle.kts');
    addSurface(ctx, surfaces, seen, '.pre-commit-config.yaml');
    addSurface(ctx, surfaces, seen, '.pre-commit-config.yml');
    addDirSurfaces(ctx, surfaces, seen, '.github/workflows', /\.ya?ml$/i);
  }

  return surfaces;
}

function getSurfaceBundle(ctx, scope) {
  const cacheKey = scope === 'repo' ? '__nerviqRepoInstructionBundle' : '__nerviqClaudeInstructionBundle';
  if (ctx && ctx[cacheKey] !== undefined) return ctx[cacheKey];
  const bundle = buildSurfaceList(ctx, scope)
    .map((surface) => surface.content)
    .join('\n\n');
  if (ctx) ctx[cacheKey] = bundle;
  return bundle;
}

function matchesAny(text, patterns) {
  const normalized = String(text || '');
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(normalized);
  });
}

function hasDocumentedTestCommand(text) {
  return matchesAny(text, TEST_COMMAND_PATTERNS);
}

function hasDocumentedLintCommand(text) {
  return matchesAny(text, LINT_COMMAND_PATTERNS);
}

function hasDocumentedBuildCommand(text) {
  return matchesAny(text, BUILD_COMMAND_PATTERNS);
}

function hasDocumentedVerificationGuidance(text) {
  const normalized = String(text || '');
  if (!normalized.trim()) return false;
  return hasDocumentedTestCommand(normalized) ||
    hasDocumentedLintCommand(normalized) ||
    hasDocumentedBuildCommand(normalized) ||
    (/\b(?:verification|verify|self-check|quality gate)\b/i.test(normalized) &&
      matchesAny(normalized, [
        ...TEST_COMMAND_PATTERNS,
        ...LINT_COMMAND_PATTERNS,
        ...BUILD_COMMAND_PATTERNS,
      ]));
}

function getClaudeInstructionBundle(ctx) {
  return getSurfaceBundle(ctx, 'claude');
}

function getRepoInstructionBundle(ctx) {
  return getSurfaceBundle(ctx, 'repo');
}

module.exports = {
  getClaudeInstructionBundle,
  getRepoInstructionBundle,
  hasDocumentedVerificationGuidance,
  hasDocumentedTestCommand,
  hasDocumentedLintCommand,
  hasDocumentedBuildCommand,
};
