/**
 * Gemini Patch Intelligence
 *
 * Safe patching of existing Gemini CLI files using managed blocks.
 * Supports GEMINI.md (HTML comment blocks) and settings.json (JSON merge).
 *
 * Managed blocks are sections that nerviq controls.
 * Hand-authored content outside managed blocks is preserved.
 */

const fs = require('fs');
const path = require('path');
const { writeRollbackArtifact, writeActivityArtifact } = require('../activity');

// Managed block markers
const MANAGED_START_MD = '<!-- nerviq:managed:start -->';
const MANAGED_END_MD = '<!-- nerviq:managed:end -->';
const MANAGED_JSON_KEY = '_nerviq_managed';

/**
 * Extract managed blocks from a file.
 * Returns { before, managed, after } where managed is the content between markers.
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
 * If the file already has managed markers, replace the content between them.
 * If not, append the managed block at the end.
 */
function upsertManagedBlock(content, newManaged, startMarker, endMarker) {
  const { before, managed, after } = extractManagedBlock(content, startMarker, endMarker);

  if (managed !== null) {
    // Replace existing managed block
    return `${before}${startMarker}\n${newManaged}\n${endMarker}${after}`;
  }

  // Append new managed block
  const separator = content.endsWith('\n') ? '\n' : '\n\n';
  return `${content}${separator}${startMarker}\n${newManaged}\n${endMarker}\n`;
}

/**
 * Patch GEMINI.md with managed sections.
 * Preserves all hand-authored content.
 */
function patchGeminiMd(existingContent, managedSections) {
  const newManaged = Object.entries(managedSections)
    .map(([section, content]) => `## ${section}\n${content}`)
    .join('\n\n');

  return upsertManagedBlock(existingContent, newManaged, MANAGED_START_MD, MANAGED_END_MD);
}

/**
 * Patch settings.json by safely merging new keys.
 * Preserves all existing keys. Only adds new keys or updates
 * the _nerviq_managed namespace without breaking existing config.
 */
function patchSettingsJson(existingContent, newKeys) {
  let existing;
  try {
    existing = JSON.parse(existingContent);
  } catch {
    existing = {};
  }

  // Merge new keys without overwriting existing non-managed keys
  const merged = { ...existing };

  for (const [key, value] of Object.entries(newKeys)) {
    if (key === MANAGED_JSON_KEY) {
      // Managed namespace: always overwrite with latest
      merged[MANAGED_JSON_KEY] = {
        ...(existing[MANAGED_JSON_KEY] || {}),
        ...value,
      };
    } else if (!(key in existing)) {
      // Only add keys that don't already exist
      merged[key] = value;
    }
  }

  // Ensure managed key has metadata
  if (!merged[MANAGED_JSON_KEY]) {
    merged[MANAGED_JSON_KEY] = {};
  }
  merged[MANAGED_JSON_KEY]._updatedAt = new Date().toISOString();
  merged[MANAGED_JSON_KEY]._generator = nerviq;

  return JSON.stringify(merged, null, 2) + '\n';
}

/**
 * Detect if a repo has multiple agent surfaces (Gemini + Claude + Codex coexistence).
 */
function detectMixedAgentRepo(dir) {
  const hasClaude = fs.existsSync(path.join(dir, 'CLAUDE.md')) ||
    fs.existsSync(path.join(dir, '.claude'));
  const hasCodex = fs.existsSync(path.join(dir, 'AGENTS.md')) ||
    fs.existsSync(path.join(dir, '.codex'));
  const hasGemini = fs.existsSync(path.join(dir, 'GEMINI.md')) ||
    fs.existsSync(path.join(dir, '.gemini'));

  const platforms = [];
  if (hasClaude) platforms.push('claude');
  if (hasCodex) platforms.push('codex');
  if (hasGemini) platforms.push('gemini');

  return {
    isMixed: platforms.length >= 2,
    hasClaude,
    hasCodex,
    hasGemini,
    platforms,
    guidance: platforms.length >= 2
      ? `This is a mixed-agent repo (${platforms.join(', ')}). Keep each platform's instructions in its own file (CLAUDE.md, AGENTS.md, GEMINI.md). Do not merge them.`
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

  // Simple line-by-line diff showing only changed sections
  let inChange = false;
  for (let i = 0; i < Math.max(origLines.length, patchLines.length); i++) {
    const orig = origLines[i] || '';
    const patched = patchLines[i] || '';
    if (orig !== patched) {
      if (!inChange) {
        lines.push(`@@ line ${i + 1} @@`);
        inChange = true;
      }
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

  // Backup + write
  const backupPath = fullPath + '.nerviq-backup';
  fs.writeFileSync(backupPath, original, 'utf8');
  fs.writeFileSync(fullPath, patched, 'utf8');

  // Rollback artifact
  const rollback = writeRollbackArtifact(dir, {
    sourcePlan: 'gemini-patch',
    patchedFiles: [filePath],
    backupFiles: [{ original: filePath, backup: path.relative(dir, backupPath) }],
    rollbackInstructions: [`Restore ${filePath} from ${path.relative(dir, backupPath)}`],
  });

  const activity = writeActivityArtifact(dir, 'gemini-patch', {
    platform: 'gemini',
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
  patchGeminiMd,
  patchSettingsJson,
  detectMixedAgentRepo,
  generatePatchPreview,
  applyPatch,
};
