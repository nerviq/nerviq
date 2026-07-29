/**
 * Harmony Sync — Unified Setup / Sync Engine
 *
 * Generates aligned configs for ALL active platforms from a shared canonical
 * understanding. Ensures instructions, MCP servers, and trust posture are
 * consistent across Claude, Codex, Gemini, Copilot, Cursor, Windsurf,
 * Aider, and OpenCode.
 *
 * Uses managed blocks from each platform's patch module so hand-authored
 * content is always preserved.
 */

const fs = require('fs');
const path = require('path');
const { buildCanonicalModel, PLATFORM_SIGNATURES } = require('./canon');

// ─── Managed block markers (imported from platform patch modules) ───────────

const MANAGED_MARKERS = {
  claude: {
    start: '<!-- nerviq:managed:start -->',
    end: '<!-- nerviq:managed:end -->',
  },
  codex: {
    start: '<!-- nerviq:managed:start -->',
    end: '<!-- nerviq:managed:end -->',
  },
  gemini: {
    start: '<!-- nerviq:managed:start -->',
    end: '<!-- nerviq:managed:end -->',
  },
  copilot: {
    start: '<!-- nerviq:managed:start -->',
    end: '<!-- nerviq:managed:end -->',
  },
  cursor: {
    // Cursor uses MDC format but managed blocks are still HTML-comment-based for .mdc
    start: '<!-- nerviq:managed:start -->',
    end: '<!-- nerviq:managed:end -->',
  },
  windsurf: {
    start: '<!-- nerviq:managed:start -->',
    end: '<!-- nerviq:managed:end -->',
  },
  // aider: uses .aider.conf.yml (YAML) — managed HTML-comment blocks not supported
  // opencode: uses opencode.json (JSON) — managed HTML-comment blocks not supported
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // Already exists or not writable
  }
}

/**
 * Extract managed block from content.
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
 * Upsert a managed block within content.
 */
function upsertManagedBlock(content, newManaged, startMarker, endMarker) {
  const { before, managed, after } = extractManagedBlock(content, startMarker, endMarker);

  if (managed !== null) {
    return `${before}${startMarker}\n${newManaged}\n${endMarker}${after}`;
  }

  const separator = content.endsWith('\n') ? '\n' : '\n\n';
  return `${content}${separator}${startMarker}\n${newManaged}\n${endMarker}\n`;
}

// ─── Instruction content builders ───────────────────────────────────────────

/**
 * Build a shared instruction block that should appear on every platform.
 * Derived from the canonical model's shared understanding.
 */
function buildSharedInstructionBlock(model) {
  const lines = [];

  lines.push(`## Harmony-Managed Instructions`);
  lines.push(`<!-- Synced by nerviq harmony. Do not edit this block manually. -->`);
  lines.push('');

  // Project identity
  lines.push(`Project: ${model.projectName}`);
  if (model.stacks.length > 0) {
    lines.push(`Stacks: ${model.stacks.join(', ')}`);
  }
  lines.push('');

  // Shared instructions (if any were found across platforms)
  if (model.sharedInstructions.length > 0) {
    lines.push('### Shared Guidelines');
    for (const instruction of model.sharedInstructions.slice(0, 20)) {
      lines.push(instruction);
    }
    lines.push('');
  }

  // MCP servers (unified list)
  const mcpNames = Object.keys(model.mcpServers);
  if (mcpNames.length > 0) {
    lines.push('### Available MCP Servers');
    for (const name of mcpNames) {
      const server = model.mcpServers[name];
      lines.push(`- ${name} (on: ${server.platforms.join(', ')})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Platform-specific file generators ──────────────────────────────────────

function dirExists(dir, relPath) {
  try {
    return fs.statSync(path.join(dir, relPath)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Generate the instruction file path for a platform.
 *
 * SILENT-01 (2026-07-29): Cursor moved on from `.cursorrules` and harmony
 * was still writing to it — so `nerviq harmony sync` was itself creating the
 * deprecated surface that `agent-config-silently-ignored` now reports. Found
 * by dogfooding this project's own research repo, where the only content in
 * `.cursorrules` was a block harmony had put there.
 *
 * Resolution is now directory-first when the modern surface exists:
 *   cursor   → .cursor/rules/nerviq-managed.mdc   (falls back to .cursorrules)
 *   windsurf → .windsurf/rules/nerviq-managed.md  (falls back to .windsurfrules)
 *
 * @param {string} platform
 * @param {string} [dir] - repo root; when omitted, the legacy path is returned
 */
function getInstructionPath(platform, dir) {
  switch (platform) {
    case 'claude': return 'CLAUDE.md';
    case 'codex': return 'AGENTS.md';
    case 'gemini': return 'GEMINI.md';
    case 'copilot': return '.github/copilot-instructions.md';
    case 'cursor':
      return dir && dirExists(dir, '.cursor/rules')
        ? '.cursor/rules/nerviq-managed.mdc'
        : '.cursorrules';
    case 'windsurf':
      return dir && dirExists(dir, '.windsurf/rules')
        ? '.windsurf/rules/nerviq-managed.md'
        : '.windsurfrules';
    // aider: .aider.conf.yml is YAML config — no managed block support, skip instruction sync
    // opencode: opencode.json is JSON config — no managed block support, skip instruction sync
    default: return null;
  }
}

/**
 * Cursor ignores a rule file without frontmatter (verified 2026-07-29), so a
 * managed block written into `.cursor/rules/` must carry one — otherwise the
 * sync lands in exactly the silent-failure state this change exists to avoid.
 */
const MANAGED_MDC_FRONTMATTER = [
  '---',
  'description: "Nerviq-managed cross-platform instructions"',
  'alwaysApply: true',
  '---',
  '',
  '',
].join('\n');

/**
 * Generate MCP config content for a platform based on the unified MCP server list.
 */
function buildMcpConfig(platform, mcpServers) {
  // Filter to servers that should be on this platform
  const servers = {};
  for (const [name, server] of Object.entries(mcpServers)) {
    servers[name] = {
      command: server.command || 'npx',
      args: server.args || [],
    };
  }

  if (Object.keys(servers).length === 0) return null;

  if (platform === 'claude') {
    // Claude settings.json format
    return { mcpServers: servers };
  }

  if (platform === 'cursor' || platform === 'copilot') {
    // mcp.json format
    return { mcpServers: servers };
  }

  if (platform === 'gemini') {
    // Gemini settings.json format
    return { mcpServers: servers };
  }

  if (platform === 'windsurf') {
    // Windsurf mcp.json format
    return { mcpServers: servers };
  }

  return null;
}

/**
 * Get the MCP config file path for a platform.
 */
function getMcpConfigPath(platform) {
  switch (platform) {
    case 'claude': return '.claude/settings.json';
    case 'gemini': return '.gemini/settings.json';
    case 'copilot': return '.vscode/mcp.json';
    case 'cursor': return '.cursor/mcp.json';
    case 'windsurf': return '.windsurf/mcp.json';
    // aider & opencode: no MCP config support
    default: return null;
  }
}

// ─── Trust alignment recommendations ────────────────────────────────────────

/**
 * Recommend a unified trust posture across all platforms.
 * Strategy: use the most restrictive trust level present.
 */
function recommendTrustPosture(model) {
  const TRUST_LEVELS = {
    'locked-down': 0,
    'default': 1,
    'unknown': 1,
    'safe-write': 2,
    'standard': 2,
    'no-sandbox': 3,
    'full-auto': 4,
    'bypass': 4,
    'unrestricted': 5,
  };

  const postures = Object.values(model.trustPosture);
  if (postures.length === 0) return 'safe-write';

  // Find the most restrictive (lowest) trust level
  let minLevel = Infinity;
  let minPosture = 'default';
  for (const posture of postures) {
    const level = TRUST_LEVELS[posture] ?? 1;
    if (level < minLevel) {
      minLevel = level;
      minPosture = posture;
    }
  }

  return minPosture;
}

// ─── Main sync functions ────────────────────────────────────────────────────

/**
 * Generate harmony sync operations from a canonical model.
 *
 * For each active platform:
 *   - Generate/update instruction file with shared managed block
 *   - Ensure shared MCP servers exist on all platforms that support MCP
 *   - Report trust posture alignment recommendations
 *
 * @param {object} canonicalModel - Output of buildCanonicalModel()
 * @param {object} [options] - { syncMcp: true, syncInstructions: true, dryRun: false }
 * @returns {object} { files, summary, warnings }
 */
function generateHarmonySync(canonicalModel, options = {}) {
  const {
    syncMcp = true,
    syncInstructions = true,
  } = options;

  const model = canonicalModel;
  const files = [];
  const warnings = [];

  const sharedBlock = buildSharedInstructionBlock(model);
  const recommendedTrust = recommendTrustPosture(model);

  for (const ap of model.activePlatforms) {
    const platform = ap.platform;

    // ── Instruction file sync ──
    if (syncInstructions) {
      const instrPath = getInstructionPath(platform, model.dir);
      if (instrPath) {
        const fullPath = path.join(model.dir, instrPath);
        const existingContent = safeReadFile(fullPath);
        const markers = MANAGED_MARKERS[platform];

        if (existingContent) {
          // Patch existing file with managed block
          const updated = upsertManagedBlock(
            existingContent,
            sharedBlock,
            markers.start,
            markers.end,
          );

          if (updated !== existingContent) {
            files.push({
              platform,
              path: instrPath,
              action: 'patch',
              content: updated,
              preview: `Update managed block in ${instrPath}`,
            });
          }
        } else {
          // Create new instruction file with managed block. A file written
          // into .cursor/rules/ must carry frontmatter or Cursor ignores it
          // outright — writing a rule the platform never loads would be the
          // exact silent failure SILENT-01 reports.
          const frontmatter = instrPath.endsWith('.mdc') ? MANAGED_MDC_FRONTMATTER : '';
          const newContent = frontmatter +
            `# ${platform === 'codex' ? 'AGENTS' : platform.charAt(0).toUpperCase() + platform.slice(1)} Instructions\n\n` +
            `${markers.start}\n${sharedBlock}\n${markers.end}\n`;

          files.push({
            platform,
            path: instrPath,
            action: 'create',
            content: newContent,
            preview: `Create ${instrPath} with harmony-managed content`,
          });
        }
      }
    }

    // ── MCP server sync ──
    if (syncMcp && Object.keys(model.mcpServers).length > 0) {
      const mcpPath = getMcpConfigPath(platform);
      if (!mcpPath) continue;  // Codex doesn't support MCP config

      const fullMcpPath = path.join(model.dir, mcpPath);
      const existingMcp = safeReadFile(fullMcpPath);
      const mcpConfig = buildMcpConfig(platform, model.mcpServers);

      if (!mcpConfig) continue;

      if (existingMcp) {
        // Merge: add missing servers, don't overwrite existing
        let existingJson;
        try {
          existingJson = JSON.parse(existingMcp);
        } catch {
          warnings.push(`Cannot parse ${mcpPath} — skipping MCP sync for ${platform}`);
          continue;
        }

        const existingServers = existingJson.mcpServers || existingJson.servers || {};
        const newServers = mcpConfig.mcpServers || {};
        let added = 0;

        for (const [name, config] of Object.entries(newServers)) {
          if (!existingServers[name]) {
            existingServers[name] = config;
            added++;
          }
        }

        if (added > 0) {
          // Preserve the original key name (mcpServers or servers)
          const serverKey = existingJson.servers ? 'servers' : 'mcpServers';
          existingJson[serverKey] = existingServers;

          files.push({
            platform,
            path: mcpPath,
            action: 'patch',
            content: JSON.stringify(existingJson, null, 2) + '\n',
            preview: `Add ${added} MCP server(s) to ${mcpPath}`,
          });
        }
      } else {
        // Create new MCP config
        files.push({
          platform,
          path: mcpPath,
          action: 'create',
          content: JSON.stringify(mcpConfig, null, 2) + '\n',
          preview: `Create ${mcpPath} with ${Object.keys(mcpConfig.mcpServers || {}).length} MCP server(s)`,
        });
      }
    }
  }

  // Trust posture warnings
  const trustValues = Object.values(model.trustPosture);
  const uniqueTrust = new Set(trustValues);
  if (uniqueTrust.size > 1) {
    warnings.push(
      `Trust posture varies across platforms. Recommended baseline: "${recommendedTrust}". ` +
      `Current: ${Object.entries(model.trustPosture).map(([p, t]) => `${p}=${t}`).join(', ')}. ` +
      `Trust alignment must be applied manually per platform.`
    );
  }

  // Summary
  const creates = files.filter(f => f.action === 'create').length;
  const patches = files.filter(f => f.action === 'patch').length;
  const summary = {
    totalFiles: files.length,
    creates,
    patches,
    platforms: [...new Set(files.map(f => f.platform))],
    recommendedTrust,
  };

  return { files, summary, warnings };
}

/**
 * Preview sync operations without writing.
 *
 * @param {string} dir - Project root directory
 * @param {object} [options] - Same as generateHarmonySync options
 * @returns {object} Sync plan (files, summary, warnings)
 */
function previewHarmonySync(dir, options = {}) {
  const model = buildCanonicalModel(dir);
  return generateHarmonySync(model, options);
}

/**
 * Apply harmony sync — write all generated files to disk.
 *
 * @param {string} dir - Project root directory
 * @param {object} [options] - { syncMcp, syncInstructions, dryRun }
 * @returns {object} { applied, skipped, warnings }
 */
function applyHarmonySync(dir, options = {}) {
  const { dryRun = false } = options;
  const model = buildCanonicalModel(dir);
  const sync = generateHarmonySync(model, options);

  if (dryRun) {
    return {
      applied: [],
      skipped: sync.files.map(f => f.path),
      warnings: sync.warnings,
      plan: sync,
    };
  }

  const applied = [];
  const skipped = [];

  for (const file of sync.files) {
    const fullPath = path.join(dir, file.path);

    try {
      // Ensure parent directory exists
      ensureDir(path.dirname(fullPath));

      fs.writeFileSync(fullPath, file.content, 'utf8');
      applied.push({
        platform: file.platform,
        path: file.path,
        action: file.action,
      });
    } catch (err) {
      skipped.push({
        platform: file.platform,
        path: file.path,
        reason: err.message,
      });
    }
  }

  return {
    applied,
    skipped,
    warnings: sync.warnings,
    summary: sync.summary,
  };
}

module.exports = {
  generateHarmonySync,
  applyHarmonySync,
  previewHarmonySync,
};
