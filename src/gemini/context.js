/**
 * Gemini CLI project context.
 *
 * Extends the shared ProjectContext with Gemini-specific file lookups,
 * settings.json parsing (JSON), and command/policy TOML parsing.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ProjectContext } = require('../context');
const { tryParseJson, tryParseToml, getValueByPath } = require('./config-parser');

let geminiVersionCache = null;

function detectGeminiVersion() {
  if (geminiVersionCache !== null) {
    return geminiVersionCache;
  }

  try {
    const result = spawnSync('gemini', ['--version'], { encoding: 'utf8' });
    const output = `${result.stdout || ''} ${result.stderr || ''}`.trim();
    const match = output.match(/gemini(?:-cli)?\s+([^\s]+)/i);
    geminiVersionCache = match ? match[1] : (output || null);
    return geminiVersionCache;
  } catch {
    geminiVersionCache = null;
    return null;
  }
}

function listDirs(fullPath) {
  try {
    return fs.readdirSync(fullPath, { withFileTypes: true }).filter(entry => entry.isDirectory());
  } catch {
    return [];
  }
}

function listFiles(fullPath, filter) {
  try {
    const entries = fs.readdirSync(fullPath).filter(f => !f.startsWith('.'));
    return filter ? entries.filter(filter) : entries;
  } catch {
    return [];
  }
}

class GeminiProjectContext extends ProjectContext {

  // ─── GEMINI.md content ───────────────────────────────────────────────

  geminiMdContent() {
    const direct = this.fileContent('GEMINI.md');
    if (direct) return this._expandGeminiMdImports(direct);

    // Fallback: use context.fileName from settings if configured.
    // Per Gemini CLI spec, context.fileName may be a string or an array of strings.
    const contextFileName = this.configValue('context.fileName');
    const candidates = Array.isArray(contextFileName)
      ? contextFileName.filter(n => typeof n === 'string' && n.length > 0)
      : (typeof contextFileName === 'string' && contextFileName ? [contextFileName] : []);
    for (const name of candidates) {
      const content = this.fileContent(name);
      if (content) return this._expandGeminiMdImports(content);
    }

    // Further fallback: recognise common alternate instruction surfaces
    // (AGENTS.md, CLAUDE.md) and Gemini Code Assist styleguides
    // (.gemini/styleguide.md) even when not explicitly declared in settings,
    // mirroring how real Gemini-using repos document guidance.
    for (const alt of ['AGENTS.md', 'CLAUDE.md', '.gemini/styleguide.md']) {
      const content = this.fileContent(alt);
      if (content) return this._expandGeminiMdImports(content);
    }

    return null;
  }

  /**
   * Expand Gemini CLI-style imports inside an instructions file. Gemini CLI
   * supports `@path/to/file.md` imports and treats GEMINI.md files that are
   * a single pointer line as an alias for the referenced file. For audit
   * purposes we concatenate the referenced bodies so substance/architecture/
   * command checks see the effective instructions bundle.
   */
  _expandGeminiMdImports(content, depth = 0) {
    if (!content || depth > 3) return content || '';
    let out = content;
    const importRe = /@([^\s@]+\.(?:md|markdown|MD))/g;
    const seen = new Set();
    let m;
    while ((m = importRe.exec(content)) !== null) {
      const ref = m[1].replace(/^\.\//, '');
      if (seen.has(ref)) continue;
      seen.add(ref);
      const body = this.fileContent(ref);
      if (body) out += '\n\n' + this._expandGeminiMdImports(body, depth + 1);
    }
    // "Pointer" GEMINI.md: the whole file is a single relative path to another
    // markdown doc (no @ prefix). Observed in google/dotprompt.
    const trimmed = content.trim();
    if (/^[\w./-]+\.(md|markdown)$/.test(trimmed) && !trimmed.includes('\n')) {
      const body = this.fileContent(trimmed);
      if (body) out += '\n\n' + this._expandGeminiMdImports(body, depth + 1);
    }
    return out;
  }

  /**
   * Returns true when the repo exposes any Gemini-recognisable instruction
   * surface — GEMINI.md (directly or via context.fileName override), an
   * imported pointer, AGENTS.md, or CLAUDE.md. Used to gate checks that
   * would otherwise hard-fail on repos that use alternative conventions.
   */
  hasAnyInstructionsSurface() {
    return Boolean(this.geminiMdContent());
  }

  /**
   * Returns true when the repo exposes any evidence of Gemini CLI usage.
   * This is deliberately narrower than `isGeminiRepo`: it also counts
   * `.idx/airules.md` (Project IDX) and Gemini-specific settings keys.
   */
  hasGeminiCliSurface() {
    if (this.fileContent('.gemini/settings.json')) return true;
    if (this.fileContent('GEMINI.md')) return true;
    const extDirs = this.extensionDirs ? this.extensionDirs() : [];
    if (extDirs.length > 0) return true;
    const cmdFiles = this.commandFiles ? this.commandFiles() : [];
    if (cmdFiles.length > 0) return true;
    if (this.fileContent('.idx/airules.md')) return true;
    return false;
  }

  globalGeminiMdContent() {
    const homeDir = os.homedir();
    const globalPath = path.join(homeDir, '.gemini', 'GEMINI.md');
    try {
      return fs.readFileSync(globalPath, 'utf8');
    } catch {
      return null;
    }
  }

  componentGeminiMd(dirPath) {
    const fullPath = path.join(this.dir, dirPath, 'GEMINI.md');
    try {
      return fs.readFileSync(fullPath, 'utf8');
    } catch {
      return null;
    }
  }

  // ─── settings.json parsing ───────────────────────────────────────────

  settingsJson() {
    const content = this.fileContent('.gemini/settings.json');
    if (!content) {
      return { ok: false, data: null, error: 'missing project settings', source: '.gemini/settings.json' };
    }
    const parsed = tryParseJson(content);
    return { ...parsed, source: '.gemini/settings.json' };
  }

  globalSettingsJson() {
    const homeDir = os.homedir();
    const globalPath = path.join(homeDir, '.gemini', 'settings.json');
    try {
      const content = fs.readFileSync(globalPath, 'utf8');
      const parsed = tryParseJson(content);
      return { ...parsed, source: globalPath };
    } catch {
      return { ok: false, data: null, error: 'missing global settings', source: globalPath };
    }
  }

  // ─── Config value with precedence (project > global) ─────────────────

  configValue(key) {
    const project = this.settingsJson();
    if (project.ok) {
      const projectValue = getValueByPath(project.data, key);
      if (projectValue !== undefined) return projectValue;
    }

    const globalSettings = this.globalSettingsJson();
    if (globalSettings.ok) {
      return getValueByPath(globalSettings.data, key);
    }

    return undefined;
  }

  // ─── Hooks ────────────────────────────────────────────────────────────

  hooksConfig() {
    const hooks = this.configValue('hooks');
    if (!hooks || typeof hooks !== 'object') return null;
    return hooks;
  }

  // ─── MCP servers ──────────────────────────────────────────────────────

  mcpServers() {
    return this.configValue('mcpServers') || {};
  }

  // ─── Command files (.gemini/commands/*.toml) ──────────────────────────

  commandFiles() {
    const commandsDir = path.join(this.dir, '.gemini', 'commands');
    return listFiles(commandsDir, f => f.endsWith('.toml'))
      .map(f => path.join('.gemini', 'commands', f).replace(/\\/g, '/'));
  }

  commandConfig(fileName) {
    const content = this.fileContent(fileName);
    if (!content) return { ok: false, data: null, error: 'missing command file' };
    return tryParseToml(content);
  }

  // ─── Agent files (.gemini/agents/*.md) ────────────────────────────────

  agentFiles() {
    const agentsDir = path.join(this.dir, '.gemini', 'agents');
    return listFiles(agentsDir, f => f.endsWith('.md'))
      .map(f => path.join('.gemini', 'agents', f).replace(/\\/g, '/'));
  }

  // ─── Skill directories (.gemini/skills/*) ─────────────────────────────

  skillDirs() {
    const skillsDir = path.join(this.dir, '.gemini', 'skills');
    return listDirs(skillsDir).map(entry => entry.name);
  }

  // ─── Extension directories ────────────────────────────────────────────

  extensionDirs() {
    const extDir = path.join(this.dir, '.gemini', 'extensions');
    return listDirs(extDir).map(entry => entry.name);
  }

  // ─── Policy files (.gemini/policy/*.toml or .gemini/policies/*.toml) ──

  policyFiles() {
    const candidates = ['.gemini/policy', '.gemini/policies'];
    const files = [];

    for (const dirPath of candidates) {
      const fullPath = path.join(this.dir, dirPath);
      for (const f of listFiles(fullPath, fn => fn.endsWith('.toml'))) {
        files.push(path.join(dirPath, f).replace(/\\/g, '/'));
      }
    }

    return files;
  }

  policyConfig(fileName) {
    const content = this.fileContent(fileName);
    if (!content) return { ok: false, data: null, error: 'missing policy file' };
    return tryParseToml(content);
  }

  // ─── Static detection ─────────────────────────────────────────────────

  static isGeminiRepo(dir) {
    try {
      return fs.existsSync(path.join(dir, 'GEMINI.md')) ||
        fs.existsSync(path.join(dir, '.gemini'));
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
  GeminiProjectContext,
  detectGeminiVersion,
};
