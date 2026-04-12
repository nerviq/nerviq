/**
 * Copilot project context.
 *
 * Extends the shared ProjectContext with Copilot-specific file lookups,
 * 3-surface detection (VS Code, cloud agent, CLI), instruction parsing,
 * and per-surface config resolution.
 */

const fs = require('fs');
const path = require('path');
const { ProjectContext } = require('../context');
const { tryParseJson, extractFrontmatter, getValueByPath } = require('./config-parser');

function listFiles(fullPath, filter) {
  try {
    const entries = fs.readdirSync(fullPath).filter(f => !f.startsWith('.'));
    return filter ? entries.filter(filter) : entries;
  } catch {
    return [];
  }
}

class CopilotProjectContext extends ProjectContext {

  // ─── Instructions ─────────────────────────────────────────────────────

  /**
   * .github/copilot-instructions.md — repo-wide instructions for all surfaces.
   *
   * Copilot CLI also ingests root-level AGENTS.md and CLAUDE.md automatically
   * (see GitHub Copilot CLI docs — "custom instructions"). When the canonical
   * file is missing, fall back to these alternate cross-platform instruction
   * files so repos that standardize on AGENTS.md/CLAUDE.md (a common pattern
   * in the Rust/Python ecosystems) are not penalized as having no instructions.
   */
  copilotInstructionsContent() {
    return this.fileContent('.github/copilot-instructions.md') ||
      this.fileContent('AGENTS.md') ||
      this.fileContent('CLAUDE.md');
  }

  /**
   * Returns true if the repo has any instruction surface recognised by
   * Copilot (native or cross-platform via CLI auto-ingestion).
   */
  hasAnyInstructionsSurface() {
    return Boolean(
      this.fileContent('.github/copilot-instructions.md') ||
      this.fileContent('AGENTS.md') ||
      this.fileContent('CLAUDE.md')
    );
  }

  /**
   * .github/instructions/*.instructions.md — path-scoped instructions.
   * Returns array of { name, path, frontmatter, body, applyTo }.
   */
  scopedInstructions() {
    const dir = path.join(this.dir, '.github', 'instructions');
    const files = listFiles(dir, f => f.endsWith('.instructions.md'));
    return files.map(f => {
      const relPath = `.github/instructions/${f}`;
      const content = this.fileContent(relPath);
      if (!content) return null;
      const parsed = extractFrontmatter(content);
      return {
        name: f.replace('.instructions.md', ''),
        path: relPath,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        applyTo: parsed.frontmatter ? parsed.frontmatter.applyTo : null,
      };
    }).filter(Boolean);
  }

  /**
   * .github/prompts/*.prompt.md — reusable prompt templates.
   * Returns array of { name, path, frontmatter, body }.
   */
  promptFiles() {
    const dir = path.join(this.dir, '.github', 'prompts');
    const files = listFiles(dir, f => f.endsWith('.prompt.md'));
    return files.map(f => {
      const relPath = `.github/prompts/${f}`;
      const content = this.fileContent(relPath);
      if (!content) return null;
      const parsed = extractFrontmatter(content);
      return {
        name: f.replace('.prompt.md', ''),
        path: relPath,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
      };
    }).filter(Boolean);
  }

  // ─── VS Code settings ─────────────────────────────────────────────────

  /**
   * .vscode/settings.json parsed — full VS Code settings (Copilot-relevant keys).
   */
  vscodeSettings() {
    const content = this.fileContent('.vscode/settings.json');
    if (!content) {
      return { ok: false, data: null, error: 'missing .vscode/settings.json', source: '.vscode/settings.json' };
    }
    const parsed = tryParseJson(content);
    return { ...parsed, source: '.vscode/settings.json' };
  }

  /**
   * Get a specific Copilot-related setting from .vscode/settings.json.
   */
  copilotSetting(dottedKey) {
    const result = this.vscodeSettings();
    if (!result.ok) return undefined;
    return getValueByPath(result.data, dottedKey);
  }

  // ─── Cloud agent config ───────────────────────────────────────────────

  /**
   * copilot-setup-steps.yml — cloud agent environment setup.
   */
  cloudAgentConfig() {
    return this.fileContent('.github/workflows/copilot-setup-steps.yml') ||
           this.fileContent('copilot-setup-steps.yml');
  }

  // ─── MCP config ───────────────────────────────────────────────────────

  /**
   * .vscode/mcp.json — VS Code MCP server configuration.
   * Note: Copilot MCP uses .vscode/mcp.json (separate from settings.json mcpServers).
   */
  mcpConfig() {
    const content = this.fileContent('.vscode/mcp.json');
    if (!content) {
      return { ok: false, data: null, error: 'missing .vscode/mcp.json', source: '.vscode/mcp.json' };
    }
    const parsed = tryParseJson(content);
    return { ...parsed, source: '.vscode/mcp.json' };
  }

  /**
   * MCP servers from .vscode/mcp.json.
   */
  mcpServers() {
    const result = this.mcpConfig();
    if (!result.ok || !result.data) return {};
    return result.data.servers || result.data.mcpServers || {};
  }

  // ─── Content exclusions ───────────────────────────────────────────────

  /**
   * Content exclusion patterns from .vscode/settings.json or org-level markers.
   * Returns array of glob patterns, or null if not configured.
   */
  contentExclusions() {
    const settings = this.vscodeSettings();
    if (!settings.ok) return null;

    // Check multiple possible config keys for content exclusions
    const exclusions = getValueByPath(settings.data, 'github.copilot.advanced.contentExclusion') ||
                       getValueByPath(settings.data, 'github.copilot.contentExclusion') ||
                       null;

    return exclusions;
  }

  // ─── Workflow files ───────────────────────────────────────────────────

  workflowFiles() {
    const dir = path.join(this.dir, '.github', 'workflows');
    return listFiles(dir, f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => `.github/workflows/${f}`);
  }

  // ─── Surface detection ────────────────────────────────────────────────

  /**
   * Detect which Copilot surfaces are configured.
   */
  detectSurfaces() {
    const vscode = Boolean(
      this.fileContent('.vscode/settings.json') ||
      this.fileContent('.vscode/mcp.json')
    );
    const cloudAgent = Boolean(this.cloudAgentConfig());
    const cli = false; // CLI detection is local-only; can't detect from repo files

    return { vscode, cloudAgent, cli };
  }

  // ─── Static detection ─────────────────────────────────────────────────

  static isCopilotRepo(dir) {
    try {
      return fs.existsSync(path.join(dir, '.github', 'copilot-instructions.md')) ||
        fs.existsSync(path.join(dir, '.vscode', 'mcp.json')) ||
        fs.existsSync(path.join(dir, '.github', 'instructions')) ||
        fs.existsSync(path.join(dir, '.github', 'prompts'));
    } catch {
      return false;
    }
  }

  // ─── Stack detection (reuse shared) ───────────────────────────────────

  detectStacks(STACKS) {
    return super.detectStacks(STACKS);
  }
}

module.exports = {
  CopilotProjectContext,
};
