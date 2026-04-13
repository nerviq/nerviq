/**
 * Aider Project Context
 *
 * Aider is a git-first CLI tool. Key surfaces:
 * - .aider.conf.yml (project-level YAML config)
 * - .aider.model.settings.yml (model role configuration)
 * - .env (API keys, model overrides)
 * - Convention files (passed explicitly via --read or --convention)
 * - .gitignore (must include .aider* artifacts)
 * - Git repo (Aider's ONLY safety mechanism — commits before changes)
 *
 * 4-level config precedence: env vars > CLI args > .aider.conf.yml > defaults
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { ProjectContext } = require('../context');
const { tryParseYaml, getValueByKey, parseDotEnv } = require('./config-parser');

let aiderVersionCache = null;

function detectAiderVersion() {
  if (aiderVersionCache !== null) {
    return aiderVersionCache;
  }

  try {
    const result = spawnSync('aider', ['--version'], { encoding: 'utf8' });
    const output = `${result.stdout || ''} ${result.stderr || ''}`.trim();
    const match = output.match(/aider\s+v?([^\s]+)/i);
    aiderVersionCache = match ? match[1] : (output || null);
    return aiderVersionCache;
  } catch {
    aiderVersionCache = null;
    return null;
  }
}

class AiderProjectContext extends ProjectContext {
  configContent() {
    // Aider accepts both .yml and .yaml extensions for the project config
    return this.fileContent('.aider.conf.yml') || this.fileContent('.aider.conf.yaml');
  }

  modelSettingsContent() {
    return this.fileContent('.aider.model.settings.yml');
  }

  envContent() {
    return this.fileContent('.env');
  }

  parsedConfig() {
    const content = this.configContent();
    if (!content) {
      return { ok: false, data: null, error: 'missing .aider.conf.yml', source: '.aider.conf.yml' };
    }
    const parsed = tryParseYaml(content);
    return { ...parsed, source: '.aider.conf.yml' };
  }

  parsedModelSettings() {
    const content = this.modelSettingsContent();
    if (!content) {
      return { ok: false, data: null, error: 'missing .aider.model.settings.yml', source: '.aider.model.settings.yml' };
    }
    const parsed = tryParseYaml(content);
    return { ...parsed, source: '.aider.model.settings.yml' };
  }

  parsedEnv() {
    const content = this.envContent();
    if (!content) return {};
    return parseDotEnv(content);
  }

  configValue(key) {
    const parsed = this.parsedConfig();
    if (parsed.ok) {
      const value = getValueByKey(parsed.data, key);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  conventionFiles() {
    // Aider convention files are explicitly listed in config or CLI
    const readFiles = this.configValue('read') || [];
    const conventionFiles = Array.isArray(readFiles) ? readFiles : [readFiles];

    // Also check for common convention file names
    const commonNames = ['CONVENTIONS.md', 'CODING_CONVENTIONS.md', '.aider.conventions.md', 'STYLE.md'];
    for (const name of commonNames) {
      if (this.fileContent(name) && !conventionFiles.includes(name)) {
        conventionFiles.push(name);
      }
    }

    return conventionFiles.filter(Boolean);
  }

  gitignoreContent() {
    return this.fileContent('.gitignore');
  }

  hasGitRepo() {
    try {
      return fs.existsSync(path.join(this.dir, '.git'));
    } catch {
      return false;
    }
  }

  gitStatus() {
    try {
      const result = spawnSync('git', ['status', '--porcelain'], {
        cwd: this.dir,
        encoding: 'utf8',
      });
      return (result.stdout || '').trim();
    } catch {
      return null;
    }
  }

  workflowFiles() {
    return this.dirFiles('.github/workflows')
      .filter(file => /\.ya?ml$/i.test(file))
      .map(file => path.join('.github', 'workflows', file).replace(/\\/g, '/'));
  }

  /** Aider model roles: main (coding), editor (applying), weak (commit messages) */
  modelRoles() {
    const config = this.parsedConfig();
    const data = config.ok ? config.data : {};
    return {
      main: data.model || data['main-model'] || null,
      editor: data['editor-model'] || null,
      weak: data['weak-model'] || null,
      architect: data.architect || false,
    };
  }

  static isAiderRepo(dir) {
    try {
      return fs.existsSync(path.join(dir, '.aider.conf.yml')) ||
        fs.existsSync(path.join(dir, '.aider.conf.yaml')) ||
        fs.existsSync(path.join(dir, '.aider.model.settings.yml')) ||
        fs.existsSync(path.join(dir, '.aider.model.settings.yaml')) ||
        fs.existsSync(path.join(dir, '.aider.tags.cache.v3')) ||
        fs.existsSync(path.join(dir, '.aiderignore'));
    } catch {
      return false;
    }
  }
}

module.exports = {
  AiderProjectContext,
  detectAiderVersion,
};
