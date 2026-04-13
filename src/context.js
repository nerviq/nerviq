/**
 * Project context scanner - reads project files to evaluate against techniques.
 */

const fs = require('fs');
const path = require('path');

/**
 * Scans and caches project files to provide fast lookups for technique checks.
 * Reads the project directory on construction and exposes helpers for file content, JSON, and stack detection.
 */
class ProjectContext {
  constructor(dir) {
    this.dir = dir;
    this.files = [];
    this._cache = {};
    this._dependencyCache = null;
    this._scan();
  }

  _scan() {
    try {
      const entries = fs.readdirSync(this.dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          if (entry.name === '.DS_Store') continue;
          this.files.push(entry.name);
        } else if (entry.isDirectory()) {
          if (entry.name.startsWith('.') && entry.name !== '.claude') continue;
          if (entry.name === 'node_modules' || entry.name === '__pycache__') continue;
          this.files.push(entry.name + '/');
          // Scan .claude/ subdirectories
          if (entry.name === '.claude') {
            this._scanSubdir('.claude');
          }
        }
      }
    } catch (err) {
      // Directory might not be readable
    }
  }

  _scanSubdir(subdir) {
    try {
      const fullPath = path.join(this.dir, subdir);
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          this._scanSubdir(path.join(subdir, entry.name));
        }
      }
    } catch (err) {
      // Subdirectory might not exist
    }
  }

  hasDir(dirPath) {
    const fullPath = path.join(this.dir, dirPath);
    try {
      return fs.statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  }

  dirFiles(dirPath) {
    const fullPath = path.join(this.dir, dirPath);
    try {
      return fs.readdirSync(fullPath).filter(f => !f.startsWith('.'));
    } catch {
      return [];
    }
  }

  /**
   * Return the contents of the project's CLAUDE.md (root or .claude/ location).
   * If CLAUDE.md contains only a reference to another file (e.g., "AGENTS.md"),
   * follows that reference and returns the referenced file's content appended.
   * @returns {string|null} File content or null if not found.
   */
  claudeMdContent() {
    const raw = this.fileContent('CLAUDE.md') || this.fileContent('.claude/CLAUDE.md');
    if (!raw) return null;

    // If the file is very short and looks like a file reference, follow it.
    // Recognised pointer shapes on each line:
    //   AGENTS.md
    //   docs/CODING.md
    //   @AGENTS.md            (Claude Code @import syntax)
    //   @./docs/CODING.md     (Claude Code @import with relative prefix)
    const trimmed = raw.trim();
    const pointerLine = /^@?\.?\/?[a-zA-Z0-9_./-]+\.(md|txt|rst)$/;
    if (trimmed.length < 200 && pointerLine.test(trimmed.split(/\r?\n/)[0].trim())) {
      const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      let combined = raw;
      for (const line of lines) {
        if (pointerLine.test(line)) {
          const ref = line.replace(/^@/, '').replace(/^\.\//, '');
          const referenced = this.fileContent(ref);
          if (referenced) {
            combined += '\n' + referenced;
          }
        }
      }
      return combined;
    }

    return raw;
  }

  /**
   * Read and cache the content of a file relative to the project root.
   * @param {string} filePath - Relative path from the project root.
   * @returns {string|null} File content or null if not readable.
   */
  fileContent(filePath) {
    if (this._cache[filePath] !== undefined) return this._cache[filePath];
    const fullPath = path.join(this.dir, filePath);
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      this._cache[filePath] = content;
      return content;
    } catch {
      this._cache[filePath] = null;
      return null;
    }
  }

  fileSizeBytes(filePath) {
    const fullPath = path.join(this.dir, filePath);
    try {
      return fs.statSync(fullPath).size;
    } catch {
      return null;
    }
  }

  lineNumber(filePath, matcher) {
    const content = this.fileContent(filePath);
    if (!content) return null;

    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (typeof matcher === 'string' && line.includes(matcher)) {
        return index + 1;
      }
      if (matcher instanceof RegExp && matcher.test(line)) {
        matcher.lastIndex = 0;
        return index + 1;
      }
      if (typeof matcher === 'function' && matcher(line, index + 1)) {
        return index + 1;
      }
    }

    return null;
  }

  jsonFile(filePath) {
    const content = this.fileContent(filePath);
    if (!content) return null;
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  projectDependencies() {
    if (this._dependencyCache) return this._dependencyCache;

    const deps = {};
    const addDependency = (name, source) => {
      if (!name) return;
      const normalized = `${name}`.trim().toLowerCase().replace(/\[.*\]$/, '');
      if (!normalized || normalized === 'python') return;
      if (!deps[normalized]) {
        deps[normalized] = source || true;
      }
    };

    const pkg = this.jsonFile('package.json') || {};
    for (const source of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const name of Object.keys(pkg[source] || {})) {
        addDependency(name, 'package.json');
      }
    }

    const pyproject = this.fileContent('pyproject.toml') || '';
    for (const name of extractPyprojectDependencies(pyproject)) {
      addDependency(name, 'pyproject.toml');
    }

    const requirementFiles = [
      'requirements.txt',
      'requirements-dev.txt',
      'requirements-dev.in',
      'requirements-prod.txt',
      'requirements/base.txt',
      'requirements/dev.txt',
      'requirements/test.txt',
    ];
    for (const filePath of requirementFiles) {
      const content = this.fileContent(filePath);
      if (!content) continue;
      for (const name of extractRequirementsDependencies(content)) {
        addDependency(name, filePath);
      }
    }

    this._dependencyCache = deps;
    return deps;
  }

  /**
   * Recursively check if a file or directory name exists anywhere under a given base directory.
   * Searches up to maxDepth levels deep.
   */
  _findInSubdirs(name, baseDir, maxDepth = 3) {
    if (maxDepth <= 0) return false;
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '__pycache__' || entry.name === '.git') continue;
        if (entry.name === name || entry.name.endsWith(name)) return true;
        if (entry.isDirectory()) {
          if (this._findInSubdirs(name, path.join(baseDir, entry.name), maxDepth - 1)) return true;
        }
      }
    } catch {
      // directory not readable
    }
    return false;
  }

  detectStacks(STACKS) {
    const detected = [];
    for (const [key, stack] of Object.entries(STACKS)) {
      // Check root-level files first (fast path)
      let hasFile = stack.files.some(f => {
        return this.files.some(pf => pf.startsWith(f));
      });
      // If not found at root, search subdirectories (up to 3 levels deep)
      if (!hasFile) {
        hasFile = stack.files.some(f => this._findInSubdirs(f, this.dir));
      }
      if (!hasFile) continue;

      let contentMatch = true;
      for (const [file, needle] of Object.entries(stack.content)) {
        const content = this.fileContent(file);
        if (!content || !content.includes(needle)) {
          contentMatch = false;
          break;
        }
      }

      if (hasFile && contentMatch) {
        detected.push({ key, label: stack.label });
      }
    }
    return detected;
  }
}

function extractPyprojectDependencies(content) {
  if (!content) return [];

  const deps = new Set();
  const add = (value) => {
    if (!value) return;
    deps.add(value.trim().toLowerCase().replace(/\[.*\]$/, ''));
  };

  const extractSection = (sectionName) => {
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\[${escaped}\\]([\\s\\S]*?)(?:\\n\\s*\\[|$)`);
    const match = content.match(pattern);
    return match ? match[1] : '';
  };

  const poetryDeps = extractSection('tool.poetry.dependencies');
  for (const match of poetryDeps.matchAll(/^\s*([A-Za-z0-9_.-]+)\s*=/gm)) {
    add(match[1]);
  }

  const projectDeps = extractSection('project');
  const projectDepsArrayMatch = projectDeps.match(/dependencies\s*=\s*\[([\s\S]*?)\]/m);
  if (projectDepsArrayMatch) {
    for (const item of projectDepsArrayMatch[1].matchAll(/["']([^"']+)["']/g)) {
      const name = item[1].split(/[<>=!~ ]/)[0];
      add(name);
    }
  }

  const optionalDepsSection = extractSection('project.optional-dependencies');
  for (const item of optionalDepsSection.matchAll(/["']([^"']+)["']/g)) {
    const name = item[1].split(/[<>=!~ ]/)[0];
    add(name);
  }

  const dependencyGroupsSection = extractSection('dependency-groups');
  for (const item of dependencyGroupsSection.matchAll(/["']([^"']+)["']/g)) {
    const name = item[1].split(/[<>=!~ ]/)[0];
    add(name);
  }

  return [...deps].filter(Boolean);
}

function extractRequirementsDependencies(content) {
  if (!content) return [];

  const deps = new Set();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line || line.startsWith('-')) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)/);
    if (!match) continue;
    deps.add(match[1].toLowerCase().replace(/\[.*\]$/, ''));
  }
  return [...deps];
}

module.exports = { ProjectContext };
