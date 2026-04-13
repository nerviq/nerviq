/**
 * Windsurf project context.
 *
 * Extends the shared ProjectContext with Windsurf-specific file lookups:
 * - .windsurf/rules/*.md (Markdown + YAML frontmatter, NOT MDC)
 * - .windsurfrules (legacy, flat file)
 * - .windsurf/mcp.json (MCP server config with team whitelist)
 * - .windsurf/workflows/*.md (slash commands / workflows)
 * - .windsurf/memories/ (team-syncable memories)
 * - .cascadeignore (gitignore-like for Cascade agent)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectContext } = require('../context');
const { tryParseJson, parseWindsurfRule, detectRuleType, getValueByPath } = require('./config-parser');

function listFiles(fullPath, filter) {
  try {
    const entries = fs.readdirSync(fullPath).filter(f => !f.startsWith('.'));
    return filter ? entries.filter(filter) : entries;
  } catch {
    return [];
  }
}

class WindsurfProjectContext extends ProjectContext {

  // ─── Rules (.windsurf/rules/*.md) ──────────────────────────────────────

  /**
   * List all .md rule files in .windsurf/rules/.
   * Returns array of { name, path, frontmatter, body, ruleType }.
   *
   * Windsurf uses Markdown + YAML frontmatter (NOT MDC like Cursor).
   * 4 activation modes: Always, Auto, Agent-Requested, Manual.
   * 10K char limit per rule file.
   *
   * PP-03: also recognises the `.windsurfrules/` *directory* convention
   * (observed in rudrankriyam/Ichi) where the rule files sit in
   * `.windsurfrules/*.md` or `*.mdc` instead of `.windsurf/rules/`.
   */
  windsurfRules() {
    const collected = [];

    // Primary: .windsurf/rules/*.md
    const primaryDir = path.join(this.dir, '.windsurf', 'rules');
    const primaryFiles = listFiles(primaryDir, f => f.endsWith('.md'));
    for (const f of primaryFiles) {
      const relPath = `.windsurf/rules/${f}`;
      const content = this.fileContent(relPath);
      if (!content) continue;
      const parsed = parseWindsurfRule(content);
      const ruleType = detectRuleType(parsed.frontmatter);
      collected.push({
        name: f.replace('.md', ''),
        path: relPath,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        ruleType,
        charCount: content.length,
        overLimit: content.length > 10000,
      });
    }

    // PP-03: fallback — `.windsurfrules/` as a directory.
    const altDir = path.join(this.dir, '.windsurfrules');
    try {
      if (fs.statSync(altDir).isDirectory()) {
        const altFiles = listFiles(altDir, f => f.endsWith('.md') || f.endsWith('.mdc'));
        for (const f of altFiles) {
          const relPath = `.windsurfrules/${f}`;
          const content = this.fileContent(relPath);
          if (!content) continue;
          const parsed = parseWindsurfRule(content);
          const ruleType = detectRuleType(parsed.frontmatter);
          collected.push({
            name: f.replace(/\.(md|mdc)$/, ''),
            path: relPath,
            frontmatter: parsed.frontmatter,
            body: parsed.body,
            ruleType,
            charCount: content.length,
            overLimit: content.length > 10000,
          });
        }
      }
    } catch { /* not a directory */ }

    return collected;
  }

  /**
   * Get rules filtered by type.
   */
  alwaysRules() {
    return this.windsurfRules().filter(r => r.ruleType === 'always');
  }

  autoRules() {
    return this.windsurfRules().filter(r => r.ruleType === 'auto');
  }

  agentRequestedRules() {
    return this.windsurfRules().filter(r => r.ruleType === 'agent-requested');
  }

  manualRules() {
    return this.windsurfRules().filter(r => r.ruleType === 'manual');
  }

  // ─── Legacy .windsurfrules ────────────────────────────────────────────

  /**
   * .windsurfrules content (deprecated).
   *
   * PP-03: handles three real-world shapes:
   *  1. Classic file with rule text.
   *  2. Pointer file — a single short line referencing another markdown
   *     file (e.g. `.ai/instructions.md`, `.llmrules`,
   *     `.ai/tech-stack.md`). Observed in ShareX/XerahS,
   *     Brawl345/Image-Reverse-Search-WebExtension, wepublish/wepublish.
   *  3. Directory convention — `.windsurfrules/` is itself a directory
   *     of rule files. Observed in rudrankriyam/Ichi. In that case this
   *     method returns the concatenated body of all contained rule files
   *     so consumer checks (architecture / verification / etc.) see the
   *     effective instruction bundle.
   */
  legacyWindsurfrules() {
    // Directory form first — `.windsurfrules/` as a directory.
    const altDir = path.join(this.dir, '.windsurfrules');
    try {
      if (fs.statSync(altDir).isDirectory()) {
        const files = listFiles(altDir, f => f.endsWith('.md') || f.endsWith('.mdc'));
        const bodies = files
          .map(f => this.fileContent(`.windsurfrules/${f}`) || '')
          .filter(Boolean);
        return bodies.length > 0 ? bodies.join('\n') : '';
      }
    } catch { /* not a directory */ }

    const raw = this.fileContent('.windsurfrules');
    if (!raw) return null;

    // Pointer form — one short line that looks like a relative path.
    const trimmed = raw.trim();
    if (trimmed.length < 200) {
      const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length <= 3 && lines.every(l => /^[a-zA-Z0-9_./-]+(\.(md|mdc|txt|rst))?$/.test(l))) {
        let combined = raw;
        for (const line of lines) {
          const referenced = this.fileContent(line);
          if (referenced) combined += '\n' + referenced;
        }
        return combined;
      }
    }
    return raw;
  }

  hasLegacyRules() {
    return Boolean(this.legacyWindsurfrules());
  }

  /**
   * PP-03: True only when `.windsurfrules` exists as a regular file
   * containing legacy rule text (not a pointer and not a directory).
   * Used by checks that warn about the deprecated single-file format.
   */
  hasRawLegacyWindsurfrules() {
    const altDir = path.join(this.dir, '.windsurfrules');
    try {
      if (fs.statSync(altDir).isDirectory()) return false;
    } catch { /* not a dir */ }
    const raw = this.fileContent('.windsurfrules');
    if (!raw) return false;
    const trimmed = raw.trim();
    if (trimmed.length < 200) {
      const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length <= 3 && lines.every(l => /^[a-zA-Z0-9_./-]+(\.(md|mdc|txt|rst))?$/.test(l))) {
        // It's a pointer — not a raw legacy file.
        return false;
      }
    }
    return true;
  }

  /**
   * PP-03: surface detection helper — any instruction surface that
   * Cascade/Windsurf can pick up.
   */
  hasAnyInstructionsSurface() {
    return (
      this.windsurfRules().length > 0 ||
      Boolean(this.legacyWindsurfrules()) ||
      Boolean(this.fileContent('AGENTS.md')) ||
      Boolean(this.fileContent('CLAUDE.md')) ||
      Boolean(this.fileContent('.ai/instructions.md'))
    );
  }

  // ─── MCP config (.windsurf/mcp.json) ──────────────────────────────────

  /**
   * .windsurf/mcp.json parsed.
   * Windsurf MCP format: { mcpServers: { name: { command, args, env } } }
   * Supports team-level whitelist.
   */
  mcpConfig() {
    const content = this.fileContent('.windsurf/mcp.json');
    if (!content) {
      return { ok: false, data: null, error: 'missing .windsurf/mcp.json', source: '.windsurf/mcp.json' };
    }
    const parsed = tryParseJson(content);
    return { ...parsed, source: '.windsurf/mcp.json' };
  }

  /**
   * Global MCP config (~/.windsurf/mcp.json).
   */
  globalMcpConfig() {
    const homeDir = os.homedir();
    const globalPath = path.join(homeDir, '.windsurf', 'mcp.json');
    try {
      const content = fs.readFileSync(globalPath, 'utf8');
      const parsed = tryParseJson(content);
      return { ...parsed, source: globalPath };
    } catch {
      return { ok: false, data: null, error: 'missing global mcp.json', source: globalPath };
    }
  }

  /**
   * MCP servers from .windsurf/mcp.json.
   */
  mcpServers() {
    const result = this.mcpConfig();
    if (!result.ok || !result.data) return {};
    return result.data.mcpServers || {};
  }

  /**
   * Count total MCP tools across all servers.
   */
  totalMcpTools() {
    const servers = this.mcpServers();
    let total = 0;
    for (const server of Object.values(servers)) {
      const toolCount = server.tools ? Object.keys(server.tools).length : 5;
      total += toolCount;
    }
    return total;
  }

  // ─── Workflows (.windsurf/workflows/*.md) ─────────────────────────────

  /**
   * Workflow files (slash commands).
   * Windsurf workflows are Markdown files that define slash commands.
   */
  workflowFiles() {
    const dir = path.join(this.dir, '.windsurf', 'workflows');
    return listFiles(dir, f => f.endsWith('.md'))
      .map(f => `.windsurf/workflows/${f}`);
  }

  // ─── Memories (.windsurf/memories/) ───────────────────────────────────

  /**
   * Memory files (team-syncable persistent context).
   */
  memoryFiles() {
    const dir = path.join(this.dir, '.windsurf', 'memories');
    return listFiles(dir, f => f.endsWith('.md') || f.endsWith('.json'));
  }

  memoryContents() {
    const dir = path.join(this.dir, '.windsurf', 'memories');
    const files = this.memoryFiles();
    return files.map(f => {
      const relPath = `.windsurf/memories/${f}`;
      const content = this.fileContent(relPath);
      return { name: f, path: relPath, content };
    }).filter(item => item.content);
  }

  // ─── Cascadeignore (.cascadeignore) ───────────────────────────────────

  /**
   * .cascadeignore content (gitignore-like for Cascade agent).
   */
  cascadeignoreContent() {
    return this.fileContent('.cascadeignore');
  }

  hasCascadeignore() {
    return Boolean(this.cascadeignoreContent());
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

  // ─── CI Workflow files ────────────────────────────────────────────────

  ciWorkflowFiles() {
    const dir = path.join(this.dir, '.github', 'workflows');
    return listFiles(dir, f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => `.github/workflows/${f}`);
  }

  // ─── Surface detection ────────────────────────────────────────────────

  /**
   * Detect which Windsurf surfaces are configured.
   * Windsurf has NO background agents (unlike Cursor).
   */
  detectSurfaces() {
    const foreground = Boolean(
      this.windsurfRules().length > 0 ||
      this.legacyWindsurfrules() ||
      this.mcpConfig().ok
    );
    const workflows = this.workflowFiles().length > 0;
    const memories = this.memoryFiles().length > 0;
    const cascadeignore = this.hasCascadeignore();

    return { foreground, workflows, memories, cascadeignore };
  }

  // ─── Static detection ─────────────────────────────────────────────────

  static isWindsurfRepo(dir) {
    try {
      return fs.existsSync(path.join(dir, '.windsurf')) ||
        fs.existsSync(path.join(dir, '.windsurfrules'));
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
  WindsurfProjectContext,
};
