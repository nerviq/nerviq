/**
 * Windsurf Patch Intelligence
 *
 * Safe patching of existing Windsurf files using managed blocks.
 * Supports .windsurf/rules/*.md (HTML comment blocks) and
 * .windsurf/mcp.json (JSON merge).
 *
 * Managed blocks are sections that nerviq controls.
 * Hand-authored content outside managed blocks is preserved.
 */

const fs = require('fs');
const path = require('path');
const { writeRollbackArtifact, writeActivityArtifact } = require('../activity');

// Managed block markers for Markdown rule files (HTML comments work in Markdown body)
const MANAGED_START_MD = '<!-- nerviq:managed:start -->';
const MANAGED_END_MD = '<!-- nerviq:managed:end -->';
const MANAGED_JSON_KEY = '_nerviq_managed';

/**
 * Extract managed blocks from a file.
 */
function extractManagedBlock(content, startMarker, endMarker) {
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { before: content, managed: null, after: '' };
  }

  return {
    before: content.substring(0, startIdx),
    managed: content.substring(startIdx + startMarker.length, endIdx).trim(),
    after: content.substring(endIdx + endMarker.length),
  };
}

/**
 * Replace or insert a managed block in a file.
 */
function upsertManagedBlock(content, newManaged, startMarker, endMarker) {
  const { before, managed, after } = extractManagedBlock(content, startMarker, endMarker);

  if (managed !== null) {
    return `${before}${startMarker}\n${newManaged}\n${endMarker}${after}`;
  }

  const separator = content.endsWith('\n') ? '\n' : '\n\n';
  return `${content}${separator}${startMarker}\n${newManaged}\n${endMarker}\n`;
}

/**
 * Patch .windsurf/rules/*.md with managed sections.
 * Preserves YAML frontmatter and hand-authored content.
 */
function patchWindsurfRuleMd(existingContent, managedSections) {
  const newManaged = Object.entries(managedSections)
    .map(([section, content]) => `## ${section}\n${content}`)
    .join('\n\n');

  return upsertManagedBlock(existingContent, newManaged, MANAGED_START_MD, MANAGED_END_MD);
}

/**
 * Patch .windsurf/mcp.json by safely merging new servers.
 */
function patchMcpJson(existingContent, newServers) {
  let existing;
  try {
    existing = JSON.parse(existingContent);
  } catch {
    existing = {};
  }

  if (!existing.mcpServers) existing.mcpServers = {};

  const merged = { ...existing };
  for (const [serverName, config] of Object.entries(newServers)) {
    if (!(serverName in merged.mcpServers)) {
      merged.mcpServers[serverName] = config;
    }
  }

  if (!merged[MANAGED_JSON_KEY]) merged[MANAGED_JSON_KEY] = {};
  merged[MANAGED_JSON_KEY]._updatedAt = new Date().toISOString();
  merged[MANAGED_JSON_KEY]._generator = 'nerviq';
  merged[MANAGED_JSON_KEY]._platform = 'windsurf';

  return JSON.stringify(merged, null, 2) + '\n';
}

/**
 * Patch .cascadeignore by appending new patterns.
 */
function patchCascadeignore(existingContent, newPatterns) {
  const existing = existingContent || '';
  const existingLines = new Set(existing.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')));

  const toAdd = newPatterns.filter(p => !existingLines.has(p.trim()));
  if (toAdd.length === 0) return existing;

  const separator = existing.endsWith('\n') ? '' : '\n';
  return `${existing}${separator}\n# Added by nerviq\n${toAdd.join('\n')}\n`;
}

/**
 * Detect if a repo has multiple agent surfaces (Windsurf + Claude + Cursor + Codex + Copilot coexistence).
 */
function detectMixedAgentRepo(dir) {
  const hasClaude = fs.existsSync(path.join(dir, 'CLAUDE.md')) || fs.existsSync(path.join(dir, '.claude'));
  const hasCodex = fs.existsSync(path.join(dir, 'AGENTS.md')) || fs.existsSync(path.join(dir, '.codex'));
  const hasGemini = fs.existsSync(path.join(dir, 'GEMINI.md')) || fs.existsSync(path.join(dir, '.gemini'));
  const hasCopilot = fs.existsSync(path.join(dir, '.github', 'copilot-instructions.md')) ||
                     fs.existsSync(path.join(dir, '.vscode', 'mcp.json'));
  const hasCursor = fs.existsSync(path.join(dir, '.cursor')) ||
                    fs.existsSync(path.join(dir, '.cursorrules'));
  const hasWindsurf = fs.existsSync(path.join(dir, '.windsurf')) ||
                      fs.existsSync(path.join(dir, '.windsurfrules'));

  const platforms = [];
  if (hasClaude) platforms.push('claude');
  if (hasCodex) platforms.push('codex');
  if (hasGemini) platforms.push('gemini');
  if (hasCopilot) platforms.push('copilot');
  if (hasCursor) platforms.push('cursor');
  if (hasWindsurf) platforms.push('windsurf');

  return {
    isMixed: platforms.length >= 2,
    hasClaude,
    hasCodex,
    hasGemini,
    hasCopilot,
    hasCursor,
    hasWindsurf,
    platforms,
    guidance: platforms.length >= 2
      ? `This is a mixed-agent repo (${platforms.join(', ')}). Keep each platform's config in its own directory (.claude/, .cursor/, .windsurf/, .gemini/, .github/). Do not merge them.`
      : null,
  };
}

/**
 * Generate a diff preview for a patch operation.
 */
function generatePatchPreview(originalContent, patchedContent, filePath) {
  const origLines = originalContent.split('\n');
  const patchLines = patchedContent.split('\n');
  const lines = [`--- ${filePath} (original)`, `+++ ${filePath} (patched)`];

  let inChange = false;
  for (let i = 0; i < Math.max(origLines.length, patchLines.length); i++) {
    const orig = origLines[i] || '';
    const patched = patchLines[i] || '';
    if (orig !== patched) {
      if (!inChange) { lines.push(`@@ line ${i + 1} @@`); inChange = true; }
      if (i < origLines.length) lines.push(`-${orig}`);
      if (i < patchLines.length) lines.push(`+${patched}`);
    } else {
      inChange = false;
    }
  }

  return lines.join('\n');
}

/**
 * Apply a patch to a file with backup and rollback support.
 */
function applyPatch(dir, filePath, patchFn, options = {}) {
  const fullPath = path.join(dir, filePath);
  const dryRun = options.dryRun === true;

  if (!fs.existsSync(fullPath)) {
    return { success: false, reason: `${filePath} does not exist`, preview: null };
  }

  const original = fs.readFileSync(fullPath, 'utf8');
  const patched = patchFn(original);

  if (patched === original) {
    return { success: true, reason: 'no changes needed', preview: null, unchanged: true };
  }

  const preview = generatePatchPreview(original, patched, filePath);

  if (dryRun) {
    return { success: true, reason: 'dry run', preview, unchanged: false };
  }

  const backupPath = fullPath + '.nerviq-backup';
  fs.writeFileSync(backupPath, original, 'utf8');
  fs.writeFileSync(fullPath, patched, 'utf8');

  const rollback = writeRollbackArtifact(dir, {
    sourcePlan: 'windsurf-patch',
    patchedFiles: [filePath],
    backupFiles: [{ original: filePath, backup: path.relative(dir, backupPath) }],
    rollbackInstructions: [`Restore ${filePath} from ${path.relative(dir, backupPath)}`],
  });

  const activity = writeActivityArtifact(dir, 'windsurf-patch', {
    platform: 'windsurf',
    patchedFiles: [filePath],
    rollbackArtifact: rollback.relativePath,
  });

  return {
    success: true,
    reason: 'patched',
    preview,
    unchanged: false,
    rollbackArtifact: rollback.relativePath,
    activityArtifact: activity.relativePath,
  };
}

module.exports = {
  MANAGED_START_MD,
  MANAGED_END_MD,
  MANAGED_JSON_KEY,
  extractManagedBlock,
  upsertManagedBlock,
  patchWindsurfRuleMd,
  patchMcpJson,
  patchCascadeignore,
  detectMixedAgentRepo,
  generatePatchPreview,
  applyPatch,
};
