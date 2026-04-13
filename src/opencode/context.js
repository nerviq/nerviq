/**
 * OpenCode Project Context
 *
 * Reads and caches OpenCode-specific project surfaces:
 * - opencode.json / opencode.jsonc (JSONC config)
 * - AGENTS.md (shared with Codex/Copilot)
 * - Permission configuration
 * - Plugin system
 * - 6-level config merge hierarchy
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ProjectContext } = require('../context');
const { tryParseJsonc, getValueByPath } = require('./config-parser');

let opencodeVersionCache = null;

function detectOpencodeVersion() {
  if (opencodeVersionCache !== null) {
    return opencodeVersionCache;
  }

  try {
    const result = spawnSync('opencode', ['--version'], { encoding: 'utf8' });
    const output = `${result.stdout || ''} ${result.stderr || ''}`.trim();
    const match = output.match(/opencode\s+v?([^\s]+)/i);
    opencodeVersionCache = match ? match[1] : (output || null);
    return opencodeVersionCache;
  } catch {
    opencodeVersionCache = null;
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

class OpenCodeProjectContext extends ProjectContext {
  configContent() {
    return this.fileContent('opencode.json') || this.fileContent('opencode.jsonc');
  }

  configFileName() {
    if (this.fileContent('opencode.json')) return 'opencode.json';
    if (this.fileContent('opencode.jsonc')) return 'opencode.jsonc';
    return null;
  }

  globalConfigContent() {
    const homeDir = os.homedir();
    const globalPaths = [
      path.join(homeDir, '.config', 'opencode', 'opencode.json'),
      path.join(homeDir, '.config', 'opencode', 'opencode.jsonc'),
    ];
    for (const globalPath of globalPaths) {
      try {
        return fs.readFileSync(globalPath, 'utf8');
      } catch {
        // continue
      }
    }
    return null;
  }

  agentsMdContent() {
    const direct = this.fileContent('AGENTS.md');
    if (direct) return direct;

    // OpenCode fallback: CLAUDE.md if no AGENTS.md
    const claudeMd = this.fileContent('CLAUDE.md');
    if (claudeMd) return claudeMd;

    return null;
  }

  agentsMdPath() {
    if (this.fileContent('AGENTS.md')) return 'AGENTS.md';
    if (this.fileContent('CLAUDE.md')) return 'CLAUDE.md';
    return null;
  }

  hasAgentsMdAndClaudeMd() {
    return Boolean(this.fileContent('AGENTS.md')) && Boolean(this.fileContent('CLAUDE.md'));
  }

  globalAgentsMdContent() {
    const homeDir = os.homedir();
    const paths = [
      path.join(homeDir, '.config', 'opencode', 'AGENTS.md'),
      path.join(homeDir, '.claude', 'CLAUDE.md'),
    ];
    for (const p of paths) {
      try {
        return fs.readFileSync(p, 'utf8');
      } catch {
        // continue
      }
    }
    return null;
  }

  configJson() {
    const content = this.configContent();
    if (!content) {
      return { ok: false, data: null, error: 'missing project config', source: this.configFileName() || 'opencode.json' };
    }
    const parsed = tryParseJsonc(content);
    return { ...parsed, source: this.configFileName() };
  }

  globalConfigJson() {
    const content = this.globalConfigContent();
    if (!content) {
      return { ok: false, data: null, error: 'missing global config', source: '~/.config/opencode/opencode.json' };
    }
    const parsed = tryParseJsonc(content);
    return { ...parsed, source: '~/.config/opencode/opencode.json' };
  }

  configValue(dottedPath) {
    // 6-level merge: project wins over global
    const project = this.configJson();
    if (project.ok) {
      const projectValue = getValueByPath(project.data, dottedPath);
      if (projectValue !== undefined) return projectValue;
    }

    const globalConfig = this.globalConfigJson();
    if (globalConfig.ok) {
      return getValueByPath(globalConfig.data, dottedPath);
    }

    return undefined;
  }

  permissions() {
    const config = this.configJson();
    if (!config.ok || !config.data) return {};
    return config.data.permissions || {};
  }

  toolPermissions() {
    const perms = this.permissions();
    return perms.tools || {};
  }

  plugins() {
    const config = this.configJson();
    if (!config.ok || !config.data) return [];
    return config.data.plugins || [];
  }

  pluginFiles() {
    const pluginsDir = path.join(this.dir, '.opencode', 'plugins');
    try {
      return fs.readdirSync(pluginsDir).filter(f => /\.(js|ts|mjs)$/.test(f));
    } catch {
      return [];
    }
  }

  tuiConfigContent() {
    return this.fileContent('tui.json') || this.fileContent('tui.jsonc') ||
      this.fileContent('.opencode/tui.json') || this.fileContent('.opencode/tui.jsonc');
  }

  tuiConfigJson() {
    const content = this.tuiConfigContent();
    if (!content) return { ok: false, data: null, error: 'missing tui config' };
    return tryParseJsonc(content);
  }

  mcpServers() {
    return this.configValue('mcp') || {};
  }

  customAgents() {
    const config = this.configJson();
    if (!config.ok || !config.data) return {};
    return config.data.agents || {};
  }

  commandDirs() {
    const commandsDir = path.join(this.dir, '.opencode', 'commands');
    return listDirs(commandsDir).map(entry => entry.name);
  }

  commandFiles() {
    const commandsDir = path.join(this.dir, '.opencode', 'commands');
    try {
      return fs.readdirSync(commandsDir).filter(f => /\.(md|yaml|yml)$/.test(f));
    } catch {
      return [];
    }
  }

  skillDirs() {
    const names = new Set();
    const roots = [
      path.join('.opencode', 'skills'),
      path.join('.opencode', 'skill'),
      path.join('.claude', 'skills'),
      path.join('.agents', 'skills'),
    ];

    for (const root of roots) {
      const fullRoot = path.join(this.dir, root);
      for (const entry of listDirs(fullRoot)) {
        if (this.fileContent(path.join(root, entry.name, 'SKILL.md'))) {
          names.add(entry.name);
        }
      }
    }

    // Legacy NERVIQ compatibility: older generated fixtures placed skills
    // under .opencode/commands/<name>/SKILL.md before OpenCode's native
    // .opencode/skills/ path was verified.
    const legacyCommandsRoot = path.join(this.dir, '.opencode', 'commands');
    for (const entry of listDirs(legacyCommandsRoot)) {
      if (this.fileContent(path.join('.opencode', 'commands', entry.name, 'SKILL.md'))) {
        names.add(entry.name);
      }
    }

    return [...names];
  }

  skillMetadata(name) {
    const candidates = [
      path.join('.opencode', 'skills', name, 'SKILL.md'),
      path.join('.opencode', 'skill', name, 'SKILL.md'),
      path.join('.claude', 'skills', name, 'SKILL.md'),
      path.join('.agents', 'skills', name, 'SKILL.md'),
      path.join('.opencode', 'commands', name, 'SKILL.md'),
    ];

    for (const candidate of candidates) {
      const content = this.fileContent(candidate);
      if (content) return content;
    }

    return null;
  }

  themeFiles() {
    const themesDir = path.join(this.dir, '.opencode', 'themes');
    try {
      return fs.readdirSync(themesDir).filter(f => f.endsWith('.json'));
    } catch {
      return [];
    }
  }

  instructionsArray() {
    return this.configValue('instructions') || [];
  }

  workflowFiles() {
    return this.dirFiles('.github/workflows')
      .filter(file => /\.ya?ml$/i.test(file))
      .map(file => path.join('.github', 'workflows', file).replace(/\\/g, '/'));
  }

  static isOpenCodeRepo(dir) {
    try {
      return fs.existsSync(path.join(dir, 'opencode.json')) ||
        fs.existsSync(path.join(dir, 'opencode.jsonc')) ||
        fs.existsSync(path.join(dir, '.opencode'));
    } catch {
      return false;
    }
  }
}

module.exports = {
  OpenCodeProjectContext,
  detectOpencodeVersion,
};
