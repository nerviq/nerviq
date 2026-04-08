const path = require('path');

const TEST_COMMAND_PATTERNS = [
  /\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+test\b/i,
  /\b(?:python\s+-m\s+)?pytest\b/i,
  /\bgo\s+test(?:\s|$)/i,
  /\bcargo\s+test\b/i,
  /\bmake\s+test\b/i,
  /\bmix\s+test\b/i,
  /\bbundle\s+exec\s+rspec\b/i,
  /\brspec\b/i,
  /\bphpunit\b/i,
  /\bdotnet\s+test\b/i,
  /\bflutter\s+test\b/i,
  /\bswift\s+test\b/i,
  /\bxcodebuild\s+test\b/i,
  /\bgradlew?\s+test\b/i,
  /\bmvn(?:w)?\s+test\b/i,
  /\bplaywright\s+test\b/i,
  /\bcypress\s+run\b/i,
];

const LINT_COMMAND_PATTERNS = [
  /\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+lint\b/i,
  /\beslint\b/i,
  /\bprettier\b/i,
  /\bruff(?:\s+(?:check|format))?\b/i,
  /\bblack\b/i,
  /\bflake8\b/i,
  /\bpylint\b/i,
  /\bgo\s+vet\b/i,
  /\bstaticcheck\b/i,
  /\bgolangci-lint\b/i,
  /\bcargo\s+clippy\b/i,
  /\bflutter\s+analyze\b/i,
  /\bswiftlint\b/i,
  /\bdotnet\s+format\b/i,
  /\bgradlew?\s+lint\b/i,
  /\bmvn(?:w)?\s+(?:checkstyle:check|spotbugs:check|verify)\b/i,
];

const BUILD_COMMAND_PATTERNS = [
  /\b(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+build\b/i,
  /\btsc(?:\s|$)/i,
  /\bgo\s+build(?:\s|$)/i,
  /\bcargo\s+(?:build|check)\b/i,
  /\bmake\s+build\b/i,
  /\bdotnet\s+build\b/i,
  /\bflutter\s+build(?:\s|$)/i,
  /\bswift\s+build\b/i,
  /\bxcodebuild\b/i,
  /\bgradlew?\s+(?:build|assemble)\b/i,
  /\bmvn(?:w)?\s+(?:compile|package|verify|install)\b/i,
  /\bpython\s+-m\s+build\b/i,
  /\bpoetry\s+build\b/i,
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
