const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ProjectContext } = require('../context');
const { tryParseToml, getValueByPath } = require('./config-parser');

let codexVersionCache = null;

function detectCodexVersion() {
  if (codexVersionCache !== null) {
    return codexVersionCache;
  }

  try {
    const result = spawnSync('codex', ['--version'], { encoding: 'utf8' });
    const output = `${result.stdout || ''} ${result.stderr || ''}`.trim();
    const match = output.match(/codex-cli\s+([^\s]+)/i);
    codexVersionCache = match ? match[1] : (output || null);
    return codexVersionCache;
  } catch {
    codexVersionCache = null;
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

class CodexProjectContext extends ProjectContext {
  configContent() {
    return this.fileContent('.codex/config.toml');
  }

  globalConfigContent() {
    const homeDir = os.homedir();
    const globalPath = path.join(homeDir, '.codex', 'config.toml');
    try {
      return fs.readFileSync(globalPath, 'utf8');
    } catch {
      return null;
    }
  }

  agentsMdContent() {
    const direct = this.fileContent('AGENTS.md');
    if (direct) return direct;

    const fallbackNames = this.projectDocFallbackFilenames();
    for (const fileName of fallbackNames) {
      const content = this.fileContent(fileName);
      if (content) return content;
    }

    return null;
  }

  agentsMdPath() {
    if (this.fileContent('AGENTS.md')) return 'AGENTS.md';
    // .codex/AGENTS.md is an emerging pattern (e.g., jessfraz/dotfiles)
    if (this.fileContent('.codex/AGENTS.md')) return '.codex/AGENTS.md';
    const fallbackNames = this.projectDocFallbackFilenames();
    for (const fileName of fallbackNames) {
      if (this.fileContent(fileName)) return fileName;
    }
    return null;
  }

  agentsOverrideMdContent() {
    return this.fileContent('AGENTS.override.md');
  }

  hasAgentsOverride() {
    return Boolean(this.agentsOverrideMdContent());
  }

  configToml() {
    const content = this.fileContent('.codex/config.toml');
    if (!content) {
      return { ok: false, data: null, error: 'missing project config', source: '.codex/config.toml' };
    }
    const parsed = tryParseToml(content);
    return { ...parsed, source: '.codex/config.toml' };
  }

  globalConfigToml() {
    const homeDir = os.homedir();
    const globalPath = path.join(homeDir, '.codex', 'config.toml');
    try {
      const content = fs.readFileSync(globalPath, 'utf8');
      const parsed = tryParseToml(content);
      return { ...parsed, source: globalPath };
    } catch {
      return { ok: false, data: null, error: 'missing global config', source: globalPath };
    }
  }

  configValue(dottedPath) {
    const project = this.configToml();
    if (project.ok) {
      const projectValue = getValueByPath(project.data, dottedPath);
      if (projectValue !== undefined) return projectValue;
    }

    const globalConfig = this.globalConfigToml();
    if (globalConfig.ok) {
      return getValueByPath(globalConfig.data, dottedPath);
    }

    return undefined;
  }

  projectDocFallbackFilenames() {
    const configured = this.configValue('project_doc_fallback_filenames');
    if (Array.isArray(configured) && configured.length > 0) {
      return configured.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim());
    }
    return [];
  }

  hooksJson() {
    return this.jsonFile('.codex/hooks.json');
  }

  hooksJsonContent() {
    return this.fileContent('.codex/hooks.json');
  }

  hookFiles() {
    const hooksDir = path.join(this.dir, '.codex', 'hooks');
    return listDirs(hooksDir).map(entry => entry.name);
  }

  skillDirs() {
    const skillsDir = path.join(this.dir, '.agents', 'skills');
    return listDirs(skillsDir).map(entry => entry.name);
  }

  skillMetadata(name) {
    return this.fileContent(path.join('.agents', 'skills', name, 'SKILL.md'));
  }

  customAgentFiles() {
    return this.dirFiles('.codex/agents').filter(file => file.endsWith('.toml'));
  }

  customAgentConfig(fileName) {
    const content = this.fileContent(path.join('.codex', 'agents', fileName));
    if (!content) return { ok: false, data: null, error: 'missing agent config' };
    return tryParseToml(content);
  }

  mcpServers() {
    return this.configValue('mcp_servers') || {};
  }

  workflowFiles() {
    return this.dirFiles('.github/workflows')
      .filter(file => /\.ya?ml$/i.test(file))
      .map(file => path.join('.github', 'workflows', file).replace(/\\/g, '/'));
  }

  ruleFiles() {
    const candidateDirs = ['codex/rules', '.codex/rules'];
    const files = [];

    for (const dirPath of candidateDirs) {
      for (const file of this.dirFiles(dirPath)) {
        if (file.startsWith('.')) continue;
        files.push(path.join(dirPath, file).replace(/\\/g, '/'));
      }
    }

    return files;
  }

  isProjectTrusted() {
    const content = this.globalConfigContent();
    if (!content) return false;

    const resolved = path.resolve(this.dir);
    const variants = new Set([
      resolved,
      resolved.replace(/\\/g, '/'),
      resolved.replace(/\//g, '\\'),
      resolved.replace(/\\/g, '\\\\'),
    ]);

    for (const variant of variants) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patterns = [
        new RegExp(`["']${escaped}["'][\\s\\S]{0,220}?trust_level\\s*=\\s*["']trusted["']`, 'i'),
        new RegExp(`trust_level\\s*=\\s*["']trusted["'][\\s\\S]{0,220}?["']${escaped}["']`, 'i'),
        new RegExp(`projects[\\s\\S]{0,1200}?["']${escaped}["'][\\s\\S]{0,220}?trust_level\\s*=\\s*["']trusted["']`, 'i'),
      ];
      if (patterns.some((pattern) => pattern.test(content))) {
        return true;
      }
    }

    return false;
  }

  static isCodexRepo(dir) {
    try {
      return fs.existsSync(path.join(dir, 'AGENTS.md')) ||
        fs.existsSync(path.join(dir, '.codex')) ||
        fs.existsSync(path.join(dir, '.agents'));
    } catch {
      return false;
    }
  }
}

module.exports = {
  CodexProjectContext,
  detectCodexVersion,
};
