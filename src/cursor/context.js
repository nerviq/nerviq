/**
 * Cursor project context.
 *
 * Extends the shared ProjectContext with Cursor-specific file lookups:
 * - .cursor/rules/*.mdc (MDC format: YAML frontmatter + Markdown body)
 * - .cursorrules (legacy, ignored by agent mode)
 * - .cursor/mcp.json (MCP server config)
 * - .cursor/environment.json (background agent VM config)
 * - .cursor/commands/*.md (custom slash commands)
 * - .cursor/automations/ (event-driven triggers)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectContext } = require('../context');
const { tryParseJson, parseMdc, detectRuleType, getValueByPath } = require('./config-parser');

function listFiles(fullPath, filter) {
  try {
    const entries = fs.readdirSync(fullPath).filter(f => !f.startsWith('.'));
    return filter ? entries.filter(filter) : entries;
  } catch {
    return [];
  }
}

class CursorProjectContext extends ProjectContext {

  // ─── Rules (.cursor/rules/*.mdc) ──────────────────────────────────────

  /**
   * List all .mdc rule files in .cursor/rules/.
   * Returns array of { name, path, frontmatter, body, ruleType }.
   *
   * NOTE: Subdirectories inside .cursor/rules/ are silently ignored by Cursor.
   */
  cursorRules() {
    const fs = require('fs');
    const rulesPath = path.join(this.dir, '.cursor', 'rules');
    let dir = rulesPath;
    let basePath = '.cursor/rules';

    // File-redirect pattern: .cursor/rules is a file pointing to another path
    // (e.g., cal.com uses agents/rules/ with .cursor/rules as a text pointer).
    try {
      const stat = fs.statSync(rulesPath);
      if (stat.isFile()) {
        const redirect = fs.readFileSync(rulesPath, 'utf8').trim();
        if (redirect && redirect.length < 500) {
          const resolved = path.resolve(path.dirname(rulesPath), redirect);
          if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
            dir = resolved;
            basePath = path.relative(this.dir, resolved).replace(/\\/g, '/');
          }
        }
      }
    } catch { /* .cursor/rules may not exist — fall through to empty list */ }

    const files = listFiles(dir, f => f.endsWith('.mdc') || f.endsWith('.md'));
    return files.map(f => {
      const relPath = `${basePath}/${f}`;
      const content = this.fileContent(relPath);
      if (!content) return null;
      const parsed = parseMdc(content);
      const ruleType = detectRuleType(parsed.frontmatter);
      return {
        name: f.replace(/\.(mdc|md)$/, ''),
        path: relPath,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        ruleType,
      };
    }).filter(Boolean);
  }

  /**
   * Get rules filtered by type.
   */
  alwaysApplyRules() {
    return this.cursorRules().filter(r => r.ruleType === 'always');
  }

  autoAttachedRules() {
    return this.cursorRules().filter(r => r.ruleType === 'auto-attached');
  }

  agentRequestedRules() {
    return this.cursorRules().filter(r => r.ruleType === 'agent-requested');
  }

  manualRules() {
    return this.cursorRules().filter(r => r.ruleType === 'manual');
  }

  // ─── Legacy .cursorrules ──────────────────────────────────────────────

  /**
   * .cursorrules content (deprecated — AGENT MODE IGNORES THIS).
   */
  legacyCursorrules() {
    return this.fileContent('.cursorrules');
  }

  hasLegacyRules() {
    return Boolean(this.legacyCursorrules());
  }

  // ─── MCP config (.cursor/mcp.json) ────────────────────────────────────

  /**
   * .cursor/mcp.json parsed.
   * Cursor MCP format: { mcpServers: { name: { command, args, env } } }
   */
  mcpConfig() {
    const content = this.fileContent('.cursor/mcp.json');
    if (!content) {
      return { ok: false, data: null, error: 'missing .cursor/mcp.json', source: '.cursor/mcp.json' };
    }
    const parsed = tryParseJson(content);
    return { ...parsed, source: '.cursor/mcp.json' };
  }

  /**
   * Global MCP config (~/.cursor/mcp.json).
   */
  globalMcpConfig() {
    const homeDir = os.homedir();
    const globalPath = path.join(homeDir, '.cursor', 'mcp.json');
    try {
      const content = fs.readFileSync(globalPath, 'utf8');
      const parsed = tryParseJson(content);
      return { ...parsed, source: globalPath };
    } catch {
      return { ok: false, data: null, error: 'missing global mcp.json', source: globalPath };
    }
  }

  /**
   * MCP servers from .cursor/mcp.json.
   */
  mcpServers() {
    const result = this.mcpConfig();
    if (!result.ok || !result.data) return {};
    return result.data.mcpServers || {};
  }

  /**
   * Count total MCP tools across all servers.
   * Cursor has a hard limit of ~40 tools.
   */
  totalMcpTools() {
    const servers = this.mcpServers();
    let total = 0;
    for (const server of Object.values(servers)) {
      // Each server exposes tools; estimate ~5 per server if no explicit count
      const toolCount = server.tools ? Object.keys(server.tools).length : 5;
      total += toolCount;
    }
    return total;
  }

  // ─── Environment config (.cursor/environment.json) ────────────────────

  /**
   * .cursor/environment.json parsed (background agent VM config).
   */
  environmentJson() {
    const content = this.fileContent('.cursor/environment.json');
    if (!content) {
      return { ok: false, data: null, error: 'missing .cursor/environment.json', source: '.cursor/environment.json' };
    }
    const parsed = tryParseJson(content);
    return { ...parsed, source: '.cursor/environment.json' };
  }

  // ─── Custom commands (.cursor/commands/*.md) ──────────────────────────

  commandFiles() {
    const commandsDir = path.join(this.dir, '.cursor', 'commands');
    return listFiles(commandsDir, f => f.endsWith('.md'))
      .map(f => `.cursor/commands/${f}`);
  }

  // ─── Automations (.cursor/automations/) ───────────────────────────────

  /**
   * Automation config files (.cursor/automations/*.yaml).
   */
  automationsConfig() {
    const dir = path.join(this.dir, '.cursor', 'automations');
    const files = listFiles(dir, f => f.endsWith('.yaml') || f.endsWith('.yml'));
    return files.map(f => {
      const relPath = `.cursor/automations/${f}`;
      const content = this.fileContent(relPath);
      return { name: f, path: relPath, content };
    }).filter(item => item.content);
  }

  // ─── VS Code compat (.vscode/settings.json) ──────────────────────────

  vscodeSettings() {
    const content = this.fileContent('.vscode/settings.json');
    if (!content) {
      return { ok: false, data: null, error: 'missing .vscode/settings.json', source: '.vscode/settings.json' };
    }
    const parsed = tryParseJson(content);
    return { ...parsed, source: '.vscode/settings.json' };
  }

  // ─── Workflow files ───────────────────────────────────────────────────

  workflowFiles() {
    const dir = path.join(this.dir, '.github', 'workflows');
    return listFiles(dir, f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => `.github/workflows/${f}`);
  }

  // ─── Surface detection ────────────────────────────────────────────────

  /**
   * Detect which Cursor surfaces are configured.
   */
  detectSurfaces() {
    const foreground = Boolean(
      this.cursorRules().length > 0 ||
      this.legacyCursorrules() ||
      this.mcpConfig().ok
    );
    const background = Boolean(this.environmentJson().ok);
    const automations = this.automationsConfig().length > 0;

    return { foreground, background, automations };
  }

  // ─── Static detection ─────────────────────────────────────────────────

  static isCursorRepo(dir) {
    try {
      return fs.existsSync(path.join(dir, '.cursor')) ||
        fs.existsSync(path.join(dir, '.cursorrules'));
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
  CursorProjectContext,
};
