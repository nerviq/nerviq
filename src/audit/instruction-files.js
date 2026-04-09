const path = require('path');

const { hasWorkspaceConfig, detectWorkspaceGlobs, detectWorkspaces } = require('../workspace');
const { estimateTokenCount } = require('../token-estimate');

const LARGE_INSTRUCTION_WARN_TOKENS = 12000;
const LARGE_INSTRUCTION_SKIP_TOKENS = 240000;

function normalizeRelativePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function addPath(target, filePath) {
  if (!filePath || typeof filePath !== 'string') return;
  target.add(normalizeRelativePath(filePath));
}

function addDirFiles(ctx, target, dirPath, filter) {
  if (typeof ctx.dirFiles !== 'function') return;
  for (const file of ctx.dirFiles(dirPath)) {
    if (filter && !filter.test(file)) continue;
    addPath(target, path.join(dirPath, file));
  }
}

function instructionFileCandidates(spec, ctx) {
  const candidates = new Set();

  if (spec.platform === 'claude') {
    addPath(candidates, 'CLAUDE.md');
    addPath(candidates, '.claude/CLAUDE.md');
    addDirFiles(ctx, candidates, '.claude/rules', /\.md$/i);
    addDirFiles(ctx, candidates, '.claude/commands', /\.md$/i);
    addDirFiles(ctx, candidates, '.claude/agents', /\.md$/i);
    if (typeof ctx.dirFiles === 'function') {
      for (const skillDir of ctx.dirFiles('.claude/skills')) {
        addPath(candidates, path.join('.claude', 'skills', skillDir, 'SKILL.md'));
      }
    }
  }

  if (spec.platform === 'codex') {
    addPath(candidates, 'AGENTS.md');
    addPath(candidates, 'AGENTS.override.md');
    addPath(candidates, typeof ctx.agentsMdPath === 'function' ? ctx.agentsMdPath() : null);
    addDirFiles(ctx, candidates, 'codex/rules');
    addDirFiles(ctx, candidates, '.codex/rules');
    if (typeof ctx.skillDirs === 'function') {
      for (const skillDir of ctx.skillDirs()) {
        addPath(candidates, path.join('.agents', 'skills', skillDir, 'SKILL.md'));
      }
    }
  }

  if (spec.platform === 'gemini') {
    addPath(candidates, 'GEMINI.md');
    addPath(candidates, '.gemini/GEMINI.md');
    addDirFiles(ctx, candidates, '.gemini/agents', /\.md$/i);
    if (typeof ctx.skillDirs === 'function') {
      for (const skillDir of ctx.skillDirs()) {
        addPath(candidates, path.join('.gemini', 'skills', skillDir, 'SKILL.md'));
      }
    }
  }

  if (spec.platform === 'copilot') {
    addPath(candidates, '.github/copilot-instructions.md');
    addDirFiles(ctx, candidates, '.github/instructions', /\.instructions\.md$/i);
    addDirFiles(ctx, candidates, '.github/prompts', /\.prompt\.md$/i);
  }

  if (spec.platform === 'cursor') {
    addPath(candidates, '.cursorrules');
    addDirFiles(ctx, candidates, '.cursor/rules', /\.mdc$/i);
    addDirFiles(ctx, candidates, '.cursor/commands', /\.md$/i);
  }

  if (spec.platform === 'windsurf') {
    addPath(candidates, '.windsurfrules');
    addDirFiles(ctx, candidates, '.windsurf/rules', /\.md$/i);
    addDirFiles(ctx, candidates, '.windsurf/workflows', /\.md$/i);
    addDirFiles(ctx, candidates, '.windsurf/memories', /\.(md|json)$/i);
  }

  if (spec.platform === 'aider' && typeof ctx.conventionFiles === 'function') {
    for (const file of ctx.conventionFiles()) {
      addPath(candidates, file);
    }
  }

  if (spec.platform === 'opencode') {
    addPath(candidates, 'AGENTS.md');
    addPath(candidates, 'CLAUDE.md');
    addDirFiles(ctx, candidates, '.opencode/commands', /\.(md|markdown|ya?ml)$/i);
    if (typeof ctx.skillDirs === 'function') {
      for (const skillDir of ctx.skillDirs()) {
        addPath(candidates, path.join('.opencode', 'commands', skillDir, 'SKILL.md'));
      }
    }
  }

  return [...candidates];
}

function inspectInstructionFiles(spec, ctx) {
  const warnings = [];

  for (const filePath of instructionFileCandidates(spec, ctx)) {
    const content = typeof ctx.fileContent === 'function' ? ctx.fileContent(filePath) : null;
    const byteCount = typeof ctx.fileSizeBytes === 'function' ? ctx.fileSizeBytes(filePath) : null;
    const tokenCount = typeof content === 'string' ? estimateTokenCount(content) : null;
    if (!Number.isFinite(tokenCount) || tokenCount <= LARGE_INSTRUCTION_WARN_TOKENS) continue;

    warnings.push({
      file: normalizeRelativePath(filePath),
      byteCount,
      tokenCount,
      lineCount: typeof content === 'string' ? content.split(/\r?\n/).length : null,
      skipped: tokenCount > LARGE_INSTRUCTION_SKIP_TOKENS,
      severity: tokenCount > LARGE_INSTRUCTION_SKIP_TOKENS ? 'critical' : 'warning',
      message: tokenCount > LARGE_INSTRUCTION_SKIP_TOKENS
        ? 'Instruction file exceeds ~240,000 tokens and will be skipped during audit.'
        : 'Instruction file exceeds ~12,000 tokens. Audit will continue, but this file may reduce runtime clarity.',
    });
  }

  return warnings;
}

function guardSkippedInstructionFiles(ctx, warnings) {
  const skippedFiles = new Set(
    warnings.filter((item) => item.skipped).map((item) => normalizeRelativePath(item.file))
  );
  if (skippedFiles.size === 0) return;

  const originalFileContent = typeof ctx.fileContent === 'function' ? ctx.fileContent.bind(ctx) : null;
  const originalLineNumber = typeof ctx.lineNumber === 'function' ? ctx.lineNumber.bind(ctx) : null;

  if (originalFileContent) {
    ctx.fileContent = (filePath) => {
      if (skippedFiles.has(normalizeRelativePath(filePath))) return null;
      return originalFileContent(filePath);
    };
  }

  if (originalLineNumber) {
    ctx.lineNumber = (filePath, matcher) => {
      if (skippedFiles.has(normalizeRelativePath(filePath))) return null;
      return originalLineNumber(filePath, matcher);
    };
  }
}

function buildWorkspaceHint(dir) {
  if (!hasWorkspaceConfig(dir)) return null;

  const patterns = detectWorkspaceGlobs(dir);
  const workspaces = detectWorkspaces(dir);
  if (patterns.length === 0 && workspaces.length === 0) return null;

  return {
    detected: true,
    patterns,
    workspaces,
    suggestedCommand: patterns.length > 0
      ? `npx nerviq audit --workspace ${patterns.join(',')}`
      : `npx nerviq audit --workspace ${workspaces.join(',')}`,
  };
}

module.exports = {
  buildWorkspaceHint,
  formatCount,
  guardSkippedInstructionFiles,
  inspectInstructionFiles,
};
