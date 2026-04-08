/**
 * NERVIQ Technique Database
 * Curated from 1118 verified techniques, filtered to actionable setup recommendations.
 * Each technique includes: what to check, how to fix, impact level.
 */

const fs = require('fs');
const path = require('path');
const {
  getClaudeInstructionBundle,
  hasDocumentedVerificationGuidance,
  hasDocumentedTestCommand,
  hasDocumentedLintCommand,
  hasDocumentedBuildCommand,
} = require('./instruction-surfaces');

function hasFrontendSignals(ctx) {
  const pkg = ctx.fileContent('package.json') || '';
  return /react|vue|angular|next|svelte|tailwind|vite|astro/i.test(pkg) ||
    ctx.files.some(f => /tailwind\.config|vite\.config|next\.config|svelte\.config|nuxt\.config|pages\/|components\/|app\//i.test(f));
}

function getClaudeHookContents(ctx) {
  const hookFiles = ctx.dirFiles('.claude/hooks').filter(f => /\.(js|cjs|mjs|ts|sh|py)$/.test(f));
  return hookFiles.map(f => ctx.fileContent(`.claude/hooks/${f}`) || '');
}

function matchesPattern(value, pattern) {
  if (pattern instanceof RegExp) {
    pattern.lastIndex = 0;
    return pattern.test(value);
  }
  return value === pattern;
}

function getProjectEntries(ctx) {
  if (ctx.__nerviqProjectEntries) return ctx.__nerviqProjectEntries;

  const entries = [];
  const skippedDirs = new Set([
    '.git',
    '.hg',
    '.svn',
    'node_modules',
    '__pycache__',
    '.pytest_cache',
    '.mypy_cache',
    '.ruff_cache',
    '.venv',
    'venv',
    'env',
    '.tox',
    '.nox',
    'vendor',
    'dist',
    'build',
    'coverage',
  ]);

  const walk = (relPath = '') => {
    const fullPath = relPath
      ? path.join(ctx.dir, ...relPath.split('/'))
      : ctx.dir;

    let dirents = [];
    try {
      dirents = fs.readdirSync(fullPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const dirent of dirents) {
      if (dirent.name === '.DS_Store') continue;

      const entryPath = relPath ? `${relPath}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (skippedDirs.has(dirent.name)) continue;
        entries.push(`${entryPath}/`);
        walk(entryPath);
      } else {
        entries.push(entryPath);
      }
    }
  };

  walk();
  ctx.__nerviqProjectEntries = entries;
  return entries;
}

function getProjectFiles(ctx) {
  if (ctx.__nerviqProjectFiles) return ctx.__nerviqProjectFiles;
  ctx.__nerviqProjectFiles = getProjectEntries(ctx).filter(entry => !entry.endsWith('/'));
  return ctx.__nerviqProjectFiles;
}

function findProjectFiles(ctx, pattern) {
  return getProjectFiles(ctx).filter(file => matchesPattern(file, pattern));
}

function hasProjectFile(ctx, pattern) {
  return findProjectFiles(ctx, pattern).length > 0;
}

/**
 * Check if a stack-indicator file exists at a "core" location (root, src/, lib/, app/, packages/)
 * rather than inside examples/, docs/, test/, vendor/, or deeply nested paths.
 * This prevents false stack detection from example/demo code.
 */
const EXCLUDED_STACK_DIRS = /^(examples?|docs?|test|tests|fixtures?|samples?|demo|vendor|third[_-]?party|\.github)\//i;

function hasCoreProjectFile(ctx, pattern) {
  return findProjectFiles(ctx, pattern).some(file => !EXCLUDED_STACK_DIRS.test(file));
}

function hasCoreRootFile(ctx, pattern) {
  // Only match files at project root (no / in path) or one level deep (src/X, lib/X, app/X)
  return findProjectFiles(ctx, pattern).some(file => {
    if (EXCLUDED_STACK_DIRS.test(file)) return false;
    const depth = (file.match(/\//g) || []).length;
    return depth <= 1;
  });
}

function readProjectFiles(ctx, pattern, limit = 60) {
  return findProjectFiles(ctx, pattern)
    .slice(0, limit)
    .map(file => ctx.fileContent(file) || '')
    .filter(Boolean)
    .join('\n');
}

function isPythonProject(ctx) {
  if (ctx.__nerviqIsPython !== undefined) return ctx.__nerviqIsPython;
  // Require a Python config file (pyproject.toml, requirements.txt, setup.py) at a core location.
  // Stray .py files in examples/ or docs/ don't make it a Python project.
  ctx.__nerviqIsPython =
    hasCoreRootFile(ctx, /(^|\/)(pyproject\.toml|setup\.py|Pipfile)$/i) ||
    hasCoreRootFile(ctx, /(^|\/)requirements\.txt$/i);
  return ctx.__nerviqIsPython;
}

function isGoProject(ctx) {
  if (ctx.__nerviqIsGo !== undefined) return ctx.__nerviqIsGo;
  ctx.__nerviqIsGo = hasCoreRootFile(ctx, /(^|\/)go\.mod$/i);
  return ctx.__nerviqIsGo;
}

function isRustProject(ctx) {
  if (ctx.__nerviqIsRust !== undefined) return ctx.__nerviqIsRust;
  ctx.__nerviqIsRust = hasCoreRootFile(ctx, /(^|\/)Cargo\.toml$/i);
  return ctx.__nerviqIsRust;
}

function isJavaProject(ctx) {
  if (ctx.__nerviqIsJava !== undefined) return ctx.__nerviqIsJava;
  ctx.__nerviqIsJava = hasCoreRootFile(ctx, /(^|\/)(pom\.xml|build\.gradle|build\.gradle\.kts)$/i);
  return ctx.__nerviqIsJava;
}

function isFlutterProject(ctx) {
  if (ctx.__nerviqIsFlutter !== undefined) return ctx.__nerviqIsFlutter;
  ctx.__nerviqIsFlutter = hasCoreRootFile(ctx, /(^|\/)pubspec\.yaml$/i);
  return ctx.__nerviqIsFlutter;
}

function isSwiftProject(ctx) {
  if (ctx.__nerviqIsSwift !== undefined) return ctx.__nerviqIsSwift;
  ctx.__nerviqIsSwift = hasCoreRootFile(ctx, /(^|\/)Package\.swift$/i) ||
    hasCoreProjectFile(ctx, /\.xcodeproj/i);
  return ctx.__nerviqIsSwift;
}

function isKotlinProject(ctx) {
  if (ctx.__nerviqIsKotlin !== undefined) return ctx.__nerviqIsKotlin;
  const gradle = (ctx.fileContent('build.gradle.kts') || '') + (ctx.fileContent('build.gradle') || '');
  ctx.__nerviqIsKotlin = /kotlin/i.test(gradle);
  return ctx.__nerviqIsKotlin;
}

function isRubyProject(ctx) {
  if (ctx.__nerviqIsRuby !== undefined) return ctx.__nerviqIsRuby;
  ctx.__nerviqIsRuby = hasCoreRootFile(ctx, /(^|\/)Gemfile$/i);
  return ctx.__nerviqIsRuby;
}

function isPhpProject(ctx) {
  if (ctx.__nerviqIsPhp !== undefined) return ctx.__nerviqIsPhp;
  ctx.__nerviqIsPhp = hasCoreRootFile(ctx, /(^|\/)composer\.json$/i);
  return ctx.__nerviqIsPhp;
}

function isDotnetProject(ctx) {
  if (ctx.__nerviqIsDotnet !== undefined) return ctx.__nerviqIsDotnet;
  ctx.__nerviqIsDotnet = hasCoreProjectFile(ctx, /(^|\/)(.*\.csproj|.*\.sln|global\.json)$/i);
  return ctx.__nerviqIsDotnet;
}

/**
 * Map category names to their project detection function.
 * Used by the audit to skip entire categories when the stack isn't detected.
 */
const STACK_CATEGORY_DETECTORS = {
  python: isPythonProject,
  go: isGoProject,
  rust: isRustProject,
  java: isJavaProject,
  flutter: isFlutterProject,
  swift: isSwiftProject,
  kotlin: isKotlinProject,
  ruby: isRubyProject,
  php: isPhpProject,
  dotnet: isDotnetProject,
};

function getPythonFiles(ctx) {
  if (ctx.__nerviqPythonFiles) return ctx.__nerviqPythonFiles;
  ctx.__nerviqPythonFiles = findProjectFiles(ctx, /\.py$/i);
  return ctx.__nerviqPythonFiles;
}

function getMainPythonFiles(ctx) {
  if (ctx.__nerviqMainPythonFiles) return ctx.__nerviqMainPythonFiles;
  ctx.__nerviqMainPythonFiles = getPythonFiles(ctx)
    .filter(file => !/(^|\/)(tests?|__pycache__|migrations)\//i.test(file))
    .filter(file => !/(^|\/)(test_[^/]+|conftest)\.py$/i.test(file))
    .slice(0, 50);
  return ctx.__nerviqMainPythonFiles;
}

function getPythonProjectText(ctx) {
  if (ctx.__nerviqPythonProjectText) return ctx.__nerviqPythonProjectText;
  ctx.__nerviqPythonProjectText = [
    readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i),
    readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i),
    readProjectFiles(ctx, /(^|\/)setup\.py$/i),
    readProjectFiles(ctx, /(^|\/)setup\.cfg$/i),
    readProjectFiles(ctx, /(^|\/)Pipfile$/i),
  ].filter(Boolean).join('\n');
  return ctx.__nerviqPythonProjectText;
}

function getGoFiles(ctx) {
  if (ctx.__nerviqGoFiles) return ctx.__nerviqGoFiles;
  ctx.__nerviqGoFiles = findProjectFiles(ctx, /\.go$/i);
  return ctx.__nerviqGoFiles;
}

function getRustFiles(ctx) {
  if (ctx.__nerviqRustFiles) return ctx.__nerviqRustFiles;
  ctx.__nerviqRustFiles = findProjectFiles(ctx, /\.rs$/i);
  return ctx.__nerviqRustFiles;
}

function getMainRustFiles(ctx) {
  if (ctx.__nerviqMainRustFiles) return ctx.__nerviqMainRustFiles;
  ctx.__nerviqMainRustFiles = getRustFiles(ctx)
    .filter(file => !/(^|\/)(tests|target)\//i.test(file))
    .slice(0, 60);
  return ctx.__nerviqMainRustFiles;
}

function getJavaFiles(ctx) {
  if (ctx.__nerviqJavaFiles) return ctx.__nerviqJavaFiles;
  ctx.__nerviqJavaFiles = findProjectFiles(ctx, /\.java$/i);
  return ctx.__nerviqJavaFiles;
}

function getMainJavaFiles(ctx) {
  if (ctx.__nerviqMainJavaFiles) return ctx.__nerviqMainJavaFiles;
  ctx.__nerviqMainJavaFiles = getJavaFiles(ctx)
    .filter(file => !/(^|\/)(test|tests|src\/test)\//i.test(file))
    .slice(0, 60);
  return ctx.__nerviqMainJavaFiles;
}

function getMainGoFiles(ctx) {
  if (ctx.__nerviqMainGoFiles) return ctx.__nerviqMainGoFiles;
  ctx.__nerviqMainGoFiles = getGoFiles(ctx).filter(file => !/_test\.go$/i.test(file)).slice(0, 60);
  return ctx.__nerviqMainGoFiles;
}

function getWorkflowContent(ctx) {
  if (ctx.__nerviqWorkflowContent !== undefined) return ctx.__nerviqWorkflowContent;
  ctx.__nerviqWorkflowContent = readProjectFiles(ctx, /^\.github\/workflows\/.*\.ya?ml$/i);
  return ctx.__nerviqWorkflowContent;
}

function getPreCommitContent(ctx) {
  if (ctx.__nerviqPreCommitContent !== undefined) return ctx.__nerviqPreCommitContent;
  ctx.__nerviqPreCommitContent = readProjectFiles(ctx, /(^|\/)\.pre-commit-config\.ya?ml$/i);
  return ctx.__nerviqPreCommitContent;
}

function getGoProjectText(ctx) {
  if (ctx.__nerviqGoProjectText) return ctx.__nerviqGoProjectText;
  ctx.__nerviqGoProjectText = [
    readProjectFiles(ctx, /(^|\/)go\.mod$/i),
    getWorkflowContent(ctx),
    readProjectFiles(ctx, /(^|\/)Makefile$/),
    getPreCommitContent(ctx),
    getMainGoFiles(ctx).slice(0, 25).map(file => ctx.fileContent(file) || '').filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n');
  return ctx.__nerviqGoProjectText;
}

function getRustProjectText(ctx) {
  if (ctx.__nerviqRustProjectText) return ctx.__nerviqRustProjectText;
  ctx.__nerviqRustProjectText = [
    readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i),
    readProjectFiles(ctx, /(^|\/)(clippy\.toml|\.clippy\.toml|rustfmt\.toml|\.rustfmt\.toml|build\.rs)$/i),
    readProjectFiles(ctx, /(^|\/)\.cargo\/config\.toml$/i),
    getWorkflowContent(ctx),
    getMainRustFiles(ctx).slice(0, 30).map(file => ctx.fileContent(file) || '').filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n');
  return ctx.__nerviqRustProjectText;
}

function getJavaBuildText(ctx) {
  if (ctx.__nerviqJavaBuildText) return ctx.__nerviqJavaBuildText;
  ctx.__nerviqJavaBuildText = [
    readProjectFiles(ctx, /(^|\/)pom\.xml$/i),
    readProjectFiles(ctx, /(^|\/)build\.gradle$/i),
    readProjectFiles(ctx, /(^|\/)build\.gradle\.kts$/i),
    readProjectFiles(ctx, /(^|\/)settings\.gradle$/i),
    readProjectFiles(ctx, /(^|\/)settings\.gradle\.kts$/i),
  ].filter(Boolean).join('\n');
  return ctx.__nerviqJavaBuildText;
}

function getJavaProjectText(ctx) {
  if (ctx.__nerviqJavaProjectText) return ctx.__nerviqJavaProjectText;
  ctx.__nerviqJavaProjectText = [
    getJavaBuildText(ctx),
    getWorkflowContent(ctx),
    readProjectFiles(ctx, /(^|\/)\.editorconfig$/i),
    readProjectFiles(ctx, /(^|\/)(application\.properties|application\.ya?ml|logback.*\.xml|log4j2?.*\.xml)$/i),
    getMainJavaFiles(ctx).slice(0, 30).map(file => ctx.fileContent(file) || '').filter(Boolean).join('\n'),
  ].filter(Boolean).join('\n');
  return ctx.__nerviqJavaProjectText;
}

function getGoInterfaceBlocks(ctx) {
  if (ctx.__nerviqGoInterfaces) return ctx.__nerviqGoInterfaces;
  const blocks = [];
  for (const file of getMainGoFiles(ctx)) {
    const content = ctx.fileContent(file) || '';
    for (const match of content.matchAll(/type\s+\w+\s+interface\s*\{([\s\S]*?)\}/g)) {
      blocks.push(match[1]);
    }
  }
  ctx.__nerviqGoInterfaces = blocks;
  return ctx.__nerviqGoInterfaces;
}

function countGoInterfaceMethods(block) {
  return block
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('//') && !line.startsWith('/*'))
    .length;
}

const { containsEmbeddedSecret } = require('./secret-patterns');
const { attachSourceUrls } = require('./source-urls');
const { buildSupplementalChecks } = require('./supplemental-checks');
const { resolveProjectStateReadPath } = require('./state-paths');

const CLAUDE_SUPPLEMENTAL_SOURCE_URLS = {
  'testing-strategy': 'https://code.claude.com/docs/en/common-workflows',
  'code-quality': 'https://code.claude.com/docs/en/best-practices',
  'api-design': 'https://code.claude.com/docs/en/best-practices',
  database: 'https://code.claude.com/docs/en/common-workflows',
  authentication: 'https://code.claude.com/docs/en/permissions',
  monitoring: 'https://code.claude.com/docs/en/common-workflows',
  'dependency-management': 'https://code.claude.com/docs/en/best-practices',
  'cost-optimization': 'https://code.claude.com/docs/en/memory',
};

const TECHNIQUES = {
  // ============================================================
  // === MEMORY & CONTEXT (category: 'memory') ==================
  // ============================================================

  claudeMd: {
    id: 1,
    name: 'CLAUDE.md project instructions',
    check: (ctx) => ctx.files.includes('CLAUDE.md') || ctx.files.includes('.claude/CLAUDE.md'),
    impact: 'critical',
    rating: 5,
    category: 'memory',
    fix: 'Create CLAUDE.md with project-specific instructions, build commands, and coding conventions.',
    template: 'claude-md'
  },

  mermaidArchitecture: {
    id: 51,
    name: 'Mermaid architecture diagram',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return md.includes('mermaid') || md.includes('graph ') || md.includes('flowchart ');
    },
    impact: 'high',
    rating: 5,
    category: 'memory',
    fix: 'Add a Mermaid diagram to CLAUDE.md showing project architecture. Saves 73% tokens vs prose.',
    template: 'mermaid'
  },

  pathRules: {
    id: 3,
    name: 'Path-specific rules',
    check: (ctx) => ctx.hasDir('.claude/rules') && ctx.dirFiles('.claude/rules').length > 0,
    impact: 'medium',
    rating: 4,
    category: 'memory',
    fix: 'Add rules for different file types (frontend vs backend conventions).',
    template: 'rules'
  },

  importSyntax: {
    id: 763,
    name: 'CLAUDE.md uses @path imports for modularity',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      // Current syntax is @path/to/file (no "import" keyword)
      return /@\S+\.(md|txt|json|yml|yaml|toml)/i.test(md) || /@\w+\//.test(md);
    },
    impact: 'medium',
    rating: 4,
    category: 'memory',
    fix: 'Use @path syntax in CLAUDE.md to split instructions into focused modules (e.g. @docs/coding-style.md). You can also use .claude/rules/ for path-specific rules.',
    template: null
  },

  underlines200: {
    id: 681,
    name: 'CLAUDE.md under 200 lines (concise)',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return md.split('\n').length <= 200;
    },
    impact: 'medium',
    rating: 4,
    category: 'memory',
    fix: 'Keep CLAUDE.md under 200 lines. Use @import or .claude/rules/ to split large instructions.',
    template: null
  },

  // ============================================================
  // === QUALITY & TESTING (category: 'quality') ================
  // ============================================================

  verificationLoop: {
    id: 93,
    name: 'Claude instruction surfaces include verification criteria',
    check: (ctx) => {
      const docs = getClaudeInstructionBundle(ctx);
      return hasDocumentedVerificationGuidance(docs);
    },
    impact: 'critical',
    rating: 5,
    category: 'quality',
    fix: 'Add canonical test/lint/build commands to your Claude instruction surfaces (CLAUDE.md, imported docs, or .claude/commands) so Claude can verify its own work.',
    template: null
  },

  testCommand: {
    id: 93001,
    name: 'Claude instruction surfaces include a test command',
    check: (ctx) => {
      return hasDocumentedTestCommand(getClaudeInstructionBundle(ctx));
    },
    impact: 'high',
    rating: 5,
    category: 'quality',
    fix: 'Add an explicit test command to your Claude instruction surfaces (for example "Run `npm test` before committing").',
    template: null
  },

  lintCommand: {
    id: 93002,
    name: 'Claude instruction surfaces include a lint command',
    check: (ctx) => {
      return hasDocumentedLintCommand(getClaudeInstructionBundle(ctx));
    },
    impact: 'high',
    rating: 4,
    category: 'quality',
    fix: 'Add a lint command to your Claude instruction surfaces so Claude can check style and static quality automatically.',
    template: null
  },

  buildCommand: {
    id: 93003,
    name: 'Claude instruction surfaces include a build command',
    check: (ctx) => {
      return hasDocumentedBuildCommand(getClaudeInstructionBundle(ctx));
    },
    impact: 'medium',
    rating: 4,
    category: 'quality',
    fix: 'Add a build command to your Claude instruction surfaces so Claude can verify compilation before committing.',
    template: null
  },

  // ============================================================
  // === GIT SAFETY (category: 'git') ===========================
  // ============================================================

  gitIgnoreClaudeTracked: {
    id: 976,
    name: '.claude/ tracked in git',
    check: (ctx) => {
      if (!ctx.fileContent('.gitignore')) return true; // no gitignore = ok
      const lines = ctx.fileContent('.gitignore')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
      const ignoresClaudeDir = lines.some(line => /^(\/|\*\*\/)?\.claude\/?$/.test(line));
      const unignoresClaudeDir = lines.some(line => /^!(\/)?\.claude(\/|\*\*)?$/.test(line));
      return !ignoresClaudeDir || unignoresClaudeDir;
    },
    impact: 'high',
    rating: 4,
    category: 'git',
    fix: 'Remove .claude/ from .gitignore (keep .claude/settings.local.json ignored).',
    template: null
  },

  gitIgnoreEnv: {
    id: 917,
    name: '.gitignore blocks .env files',
    check: (ctx) => {
      const gitignore = ctx.fileContent('.gitignore') || '';
      return gitignore.includes('.env');
    },
    impact: 'critical',
    rating: 5,
    category: 'git',
    fix: 'Add .env to .gitignore to prevent leaking secrets.',
    template: null
  },

  gitIgnoreNodeModules: {
    id: 91701,
    name: '.gitignore blocks node_modules',
    check: (ctx) => {
      const hasNodeSignals = ctx.files.includes('package.json') ||
        ctx.files.includes('tsconfig.json') ||
        ctx.files.some(f => /package-lock\.json|pnpm-lock\.yaml|yarn\.lock|next\.config|vite\.config/i.test(f));
      if (!hasNodeSignals) return null;
      const gitignore = ctx.fileContent('.gitignore') || '';
      return gitignore.includes('node_modules');
    },
    impact: 'high',
    rating: 4,
    category: 'git',
    fix: 'Add node_modules/ to .gitignore.',
    template: null
  },

  noSecretsInClaude: {
    id: 1039,
    name: 'CLAUDE.md has no embedded secrets',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return !containsEmbeddedSecret(md);
    },
    impact: 'critical',
    rating: 5,
    category: 'git',
    fix: 'Remove hardcoded secrets, tokens, private keys, and connection strings from CLAUDE.md. Use environment variables or external secret stores instead.',
    template: null
  },

  // ============================================================
  // === WORKFLOW (category: 'workflow') =========================
  // ============================================================

  customCommands: {
    id: 20,
    name: 'Custom slash commands',
    check: (ctx) => ctx.hasDir('.claude/commands') && ctx.dirFiles('.claude/commands').length > 0,
    impact: 'high',
    rating: 4,
    category: 'workflow',
    fix: 'Create custom commands for repeated workflows (/test, /deploy, /review).',
    template: 'commands'
  },

  multipleCommands: {
    id: 20001,
    name: '3+ slash commands for rich workflow',
    check: (ctx) => ctx.hasDir('.claude/commands') && ctx.dirFiles('.claude/commands').length >= 3,
    impact: 'medium',
    rating: 4,
    category: 'workflow',
    fix: 'Add at least 3 slash commands to cover your main workflows (test, deploy, review, etc.).',
    template: 'commands'
  },

  deployCommand: {
    id: 20002,
    name: 'Has /deploy or /release command',
    check: (ctx) => {
      if (!ctx.hasDir('.claude/commands')) return false;
      const files = ctx.dirFiles('.claude/commands');
      return files.some(f => /deploy|release/i.test(f));
    },
    impact: 'medium',
    rating: 4,
    category: 'workflow',
    fix: 'Create a /deploy or /release command for one-click deployments.',
    template: null
  },

  reviewCommand: {
    id: 20003,
    name: 'Has /review command',
    check: (ctx) => {
      if (!ctx.hasDir('.claude/commands')) return false;
      const files = ctx.dirFiles('.claude/commands');
      return files.some(f => /review/i.test(f));
    },
    impact: 'medium',
    rating: 4,
    category: 'workflow',
    fix: 'Create a /review command for code review workflows.',
    template: null
  },

  skills: {
    id: 21,
    name: 'Custom skills',
    check: (ctx) => {
      // Skills use directory-per-skill structure: .claude/skills/<name>/SKILL.md
      if (!ctx.hasDir('.claude/skills')) return false;
      const dirs = ctx.dirFiles('.claude/skills');
      // Check for SKILL.md inside skill directories
      for (const d of dirs) {
        if (ctx.fileContent(`.claude/skills/${d}/SKILL.md`)) return true;
      }
      // Fallback: any files in skills dir (legacy .claude/commands/ also works)
      return dirs.length > 0;
    },
    impact: 'medium',
    rating: 4,
    category: 'workflow',
    fix: 'Create skills at .claude/skills/<name>/SKILL.md with YAML frontmatter (name, description). Each skill is a directory with a SKILL.md file.',
    template: 'skills'
  },

  multipleSkills: {
    id: 2101,
    name: '2+ skills for specialization',
    check: (ctx) => {
      if (!ctx.hasDir('.claude/skills')) return false;
      return ctx.dirFiles('.claude/skills').length >= 2;
    },
    impact: 'medium',
    rating: 4,
    category: 'workflow',
    fix: 'Add at least 2 skills covering different workflows (e.g. code-review, test-writer).',
    template: 'skills'
  },

  agents: {
    id: 22,
    name: 'Custom agents',
    check: (ctx) => ctx.hasDir('.claude/agents') && ctx.dirFiles('.claude/agents').length > 0,
    impact: 'medium',
    rating: 4,
    category: 'workflow',
    fix: 'Create specialized agents (security-reviewer, test-writer) in .claude/agents/.',
    template: 'agents'
  },

  multipleAgents: {
    id: 2201,
    name: '2+ agents for delegation',
    check: (ctx) => ctx.hasDir('.claude/agents') && ctx.dirFiles('.claude/agents').length >= 2,
    impact: 'medium',
    rating: 4,
    category: 'workflow',
    fix: 'Add at least 2 agents for specialized tasks (e.g. security-reviewer, test-writer).',
    template: 'agents'
  },

  multipleRules: {
    id: 301,
    name: '2+ rules files for granular control',
    check: (ctx) => ctx.hasDir('.claude/rules') && ctx.dirFiles('.claude/rules').length >= 2,
    impact: 'medium',
    rating: 4,
    category: 'workflow',
    fix: 'Add path-specific rules for different parts of the codebase (frontend, backend, tests).',
    template: 'rules'
  },

  // ============================================================
  // === SECURITY (category: 'security') ========================
  // ============================================================

  settingsPermissions: {
    id: 24,
    name: 'Permission configuration',
    check: (ctx) => {
      // Prefer local (effective config) — any settings file with permissions passes
      const settings = ctx.jsonFile('.claude/settings.local.json') || ctx.jsonFile('.claude/settings.json');
      return !!(settings && settings.permissions);
    },
    impact: 'medium',
    rating: 4,
    category: 'security',
    fix: 'Configure allow/deny permission lists for safe tool usage.',
    template: null
  },

  permissionDeny: {
    id: 2401,
    name: 'Deny rules configured in permissions',
    check: (ctx) => {
      const settings = ctx.jsonFile('.claude/settings.local.json') || ctx.jsonFile('.claude/settings.json');
      if (!settings || !settings.permissions) return false;
      const deny = settings.permissions.deny;
      return Array.isArray(deny) && deny.length > 0;
    },
    impact: 'high',
    rating: 5,
    category: 'security',
    fix: 'Add permissions.deny rules to block dangerous operations (e.g. rm -rf, dropping databases).',
    template: null
  },

  noBypassPermissions: {
    id: 2402,
    name: 'Default mode is not bypassPermissions',
    check: (ctx) => {
      // Check shared settings first (committed to git) — if the shared baseline
      // is safe, a personal settings.local.json override should not fail the audit.
      const shared = ctx.jsonFile('.claude/settings.json');
      if (shared && shared.permissions) {
        return shared.permissions.defaultMode !== 'bypassPermissions';
      }
      const local = ctx.jsonFile('.claude/settings.local.json');
      if (!local || !local.permissions) return null;
      return local.permissions.defaultMode !== 'bypassPermissions';
    },
    impact: 'critical',
    rating: 5,
    category: 'security',
    fix: 'Do not set defaultMode to bypassPermissions. Use explicit allow rules instead.',
    template: null
  },

  secretsProtection: {
    id: 1096,
    name: 'Secrets protection configured',
    check: (ctx) => {
      // Prefer shared settings.json (committed) over local override
      const settings = ctx.jsonFile('.claude/settings.json') || ctx.jsonFile('.claude/settings.local.json');
      if (!settings || !settings.permissions) return false;
      const deny = JSON.stringify(settings.permissions.deny || []);
      const hasDeny = deny.includes('.env') || deny.includes('secrets');
      // Fail if allow includes "*" (overly broad — bypasses deny rules)
      const allow = settings.permissions.allow || [];
      if (Array.isArray(allow) && allow.includes('*')) return false;
      return hasDeny;
    },
    impact: 'critical',
    rating: 5,
    category: 'security',
    fix: 'Add permissions.deny rules to block reading .env files and secrets directories.',
    template: null
  },

  securityReview: {
    id: 1031,
    name: 'Security review command awareness',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return md.includes('security') || md.includes('/security-review');
    },
    impact: 'high',
    rating: 5,
    category: 'security',
    fix: 'Add /security-review to your workflow. Claude Code has built-in OWASP Top 10 scanning.',
    template: null
  },

  // ============================================================
  // === AUTOMATION (category: 'automation') =====================
  // ============================================================

  hooks: {
    id: 19,
    name: 'Hooks for automation',
    check: (ctx) => {
      // Hooks are configured in settings.json (not .claude/hooks/ directory)
      const shared = ctx.jsonFile('.claude/settings.json') || {};
      const local = ctx.jsonFile('.claude/settings.local.json') || {};
      return !!(shared.hooks && Object.keys(shared.hooks).length > 0) || !!(local.hooks && Object.keys(local.hooks).length > 0);
    },
    impact: 'high',
    rating: 4,
    category: 'automation',
    fix: 'Add hooks in .claude/settings.json under the "hooks" key. Supported events: PreToolUse, PostToolUse, Notification, Stop, StopFailure, SubagentStop, and more.',
    template: 'hooks'
  },

  hooksInSettings: {
    id: 8801,
    name: 'Hooks configured in settings',
    check: (ctx) => {
      const shared = ctx.jsonFile('.claude/settings.json');
      const local = ctx.jsonFile('.claude/settings.local.json');
      const hasSharedHooks = shared && shared.hooks && Object.keys(shared.hooks).length > 0;
      const hasLocalHooks = local && local.hooks && Object.keys(local.hooks).length > 0;
      return hasSharedHooks || hasLocalHooks;
    },
    impact: 'high',
    rating: 4,
    category: 'automation',
    fix: 'Add hooks in .claude/settings.json for automated enforcement (lint-on-save, test-on-commit).',
    template: 'hooks'
  },

  preToolUseHook: {
    id: 8802,
    name: 'PreToolUse hook configured',
    check: (ctx) => {
      const shared = ctx.jsonFile('.claude/settings.json');
      const local = ctx.jsonFile('.claude/settings.local.json');
      return !!(shared?.hooks?.PreToolUse || local?.hooks?.PreToolUse);
    },
    impact: 'high',
    rating: 4,
    category: 'automation',
    fix: 'Add PreToolUse hooks for validation before tool calls (e.g. block writes to protected files).',
    template: null
  },

  postToolUseHook: {
    id: 8803,
    name: 'PostToolUse hook configured',
    check: (ctx) => {
      const shared = ctx.jsonFile('.claude/settings.json');
      const local = ctx.jsonFile('.claude/settings.local.json');
      return !!(shared?.hooks?.PostToolUse || local?.hooks?.PostToolUse);
    },
    impact: 'high',
    rating: 4,
    category: 'automation',
    fix: 'Add PostToolUse hooks for auto-lint or auto-format after file writes.',
    template: null
  },

  sessionStartHook: {
    id: 8804,
    name: 'SessionStart hook configured',
    check: (ctx) => {
      const shared = ctx.jsonFile('.claude/settings.json');
      const local = ctx.jsonFile('.claude/settings.local.json');
      if (!(shared?.hooks || local?.hooks)) return false;
      return !!(shared?.hooks?.SessionStart || local?.hooks?.SessionStart);
    },
    impact: 'medium',
    rating: 4,
    category: 'automation',
    fix: 'Add a SessionStart hook for initialization tasks (log rotation, state loading, etc.).',
    template: null
  },

  // ============================================================
  // === DESIGN (category: 'design') ============================
  // ============================================================

  frontendDesignSkill: {
    id: 1025,
    name: 'Frontend design skill for anti-AI-slop',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      const md = ctx.claudeMdContent() || '';
      return md.includes('frontend_aesthetics') || md.includes('anti-AI-slop') || md.includes('frontend-design');
    },
    impact: 'medium',
    rating: 5,
    category: 'design',
    fix: 'Install the official frontend-design skill for better UI output quality.',
    template: null
  },

  tailwindMention: {
    id: 102501,
    name: 'Tailwind CSS configured',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      const pkg = ctx.fileContent('package.json') || '';
      return pkg.includes('tailwind') ||
        ctx.files.some(f => /tailwind\.config/.test(f));
    },
    impact: 'low',
    rating: 3,
    category: 'design',
    fix: 'Consider adding Tailwind CSS for rapid, consistent UI styling with Claude.',
    template: null
  },

  // ============================================================
  // === DEVOPS (category: 'devops') ============================
  // ============================================================

  dockerfile: {
    id: 399,
    name: 'Has Dockerfile',
    check: (ctx) => ctx.files.some(f => /^Dockerfile/i.test(f)),
    impact: 'medium',
    rating: 3,
    category: 'devops',
    fix: 'Add a Dockerfile for containerized builds and deployments.',
    template: null
  },

  dockerCompose: {
    id: 39901,
    name: 'Has docker-compose.yml',
    check: (ctx) => ctx.files.some(f => /^docker-compose\.(yml|yaml)$/i.test(f)),
    impact: 'medium',
    rating: 3,
    category: 'devops',
    fix: 'Add docker-compose.yml for multi-service local development.',
    template: null
  },

  ciPipeline: {
    id: 260,
    name: 'CI pipeline configured',
    check: (ctx) => ctx.hasDir('.github/workflows') || ctx.hasDir('.circleci') ||
      ctx.files.includes('.gitlab-ci.yml') || ctx.files.includes('Jenkinsfile') ||
      ctx.files.includes('.travis.yml') || ctx.files.includes('bitbucket-pipelines.yml'),
    impact: 'high',
    rating: 4,
    category: 'devops',
    fix: 'Add a CI pipeline (GitHub Actions, GitLab CI, CircleCI, etc.) for automated testing and deployment.',
    template: null
  },

  terraformFiles: {
    id: 397,
    name: 'Infrastructure as Code (Terraform)',
    check: (ctx) => ctx.files.some(f => /\.tf$/.test(f)) || ctx.files.includes('main.tf'),
    impact: 'medium',
    rating: 3,
    category: 'devops',
    fix: 'Add Terraform files for infrastructure-as-code management.',
    template: null
  },

  // --- Dockerfile best practices (Issue #8) ---

  dockerMultiStage: {
    id: 39902,
    name: 'Dockerfile uses multi-stage build',
    check: (ctx) => {
      const df = findProjectFiles(ctx, /^Dockerfile$/i);
      if (df.length === 0) return null;
      const content = ctx.fileContent(df[0]) || '';
      return (content.match(/^FROM\s/gim) || []).length >= 2;
    },
    impact: 'medium',
    rating: 3,
    category: 'devops',
    fix: 'Use multi-stage builds in Dockerfile to reduce image size and avoid leaking build tools into production.',
    template: null
  },

  dockerignoreExists: {
    id: 39903,
    name: '.dockerignore includes node_modules and .env',
    check: (ctx) => {
      if (!ctx.files.some(f => /^Dockerfile/i.test(f))) return null;
      const di = ctx.fileContent('.dockerignore') || '';
      return di.includes('node_modules') && /\.env/i.test(di);
    },
    impact: 'high',
    rating: 4,
    category: 'devops',
    fix: 'Add .dockerignore with node_modules, .env, and other sensitive/large files to keep images small and secure.',
    template: null
  },

  dockerNoSecrets: {
    id: 39904,
    name: 'Dockerfile has no secrets in build args',
    check: (ctx) => {
      const df = findProjectFiles(ctx, /^Dockerfile$/i);
      if (df.length === 0) return null;
      const content = ctx.fileContent(df[0]) || '';
      return !/ARG\s+(PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)/i.test(content);
    },
    impact: 'critical',
    rating: 5,
    category: 'devops',
    fix: 'Never pass secrets via ARG in Dockerfile — use runtime environment variables or secret mounts instead.',
    template: null
  },

  // --- Terraform checks (Issue #10) ---

  terraformFmt: {
    id: 39705,
    name: 'Terraform formatting configured',
    check: (ctx) => {
      if (!ctx.files.some(f => /\.tf$/.test(f))) return null;
      const ci = readProjectFiles(ctx, /\.(yml|yaml)$/i, 10);
      const makefileContent = ctx.fileContent('Makefile') || '';
      const preCommit = ctx.fileContent('.pre-commit-config.yaml') || '';
      return /terraform\s+fmt/i.test(ci) || /terraform\s+fmt/i.test(makefileContent) || /terraform_fmt/i.test(preCommit);
    },
    impact: 'medium',
    rating: 3,
    category: 'devops',
    fix: 'Add `terraform fmt` to CI or pre-commit hooks to enforce consistent formatting.',
    template: null
  },

  terraformDirIgnored: {
    id: 39706,
    name: '.terraform directory in .gitignore',
    check: (ctx) => {
      if (!ctx.files.some(f => /\.tf$/.test(f))) return null;
      const gi = ctx.fileContent('.gitignore') || '';
      return /\.terraform/i.test(gi);
    },
    impact: 'high',
    rating: 4,
    category: 'devops',
    fix: 'Add .terraform/ to .gitignore — it contains provider binaries and should not be committed.',
    template: null
  },

  terraformStateNotCommitted: {
    id: 39707,
    name: 'Terraform state file not committed',
    check: (ctx) => {
      if (!ctx.files.some(f => /\.tf$/.test(f))) return null;
      return !ctx.files.some(f => /terraform\.tfstate$/i.test(f));
    },
    impact: 'critical',
    rating: 5,
    category: 'devops',
    fix: 'Never commit terraform.tfstate — it may contain secrets. Use a remote backend (S3, GCS, Terraform Cloud).',
    template: null
  },

  terraformBackendConfigured: {
    id: 39708,
    name: 'Terraform remote backend configured',
    check: (ctx) => {
      const tfFiles = findProjectFiles(ctx, /\.tf$/);
      if (tfFiles.length === 0) return null;
      const allTf = tfFiles.slice(0, 10).map(f => ctx.fileContent(f) || '').join('\n');
      return /backend\s+"(s3|gcs|azurerm|remote|cloud|consul|http)"/i.test(allTf);
    },
    impact: 'high',
    rating: 4,
    category: 'devops',
    fix: 'Configure a remote backend in Terraform (S3, GCS, Terraform Cloud) for team collaboration and state locking.',
    template: null
  },

  // ============================================================
  // === PROJECT HYGIENE (category: 'hygiene') ==================
  // ============================================================

  readme: {
    id: 416,
    name: 'Has README.md',
    check: (ctx) => ctx.files.some(f => /^readme\.md$/i.test(f)),
    impact: 'high',
    rating: 4,
    category: 'hygiene',
    fix: 'Add a README.md with project overview, setup instructions, and usage.',
    template: null
  },

  changelog: {
    id: 417,
    name: 'Has CHANGELOG.md',
    check: (ctx) => ctx.files.some(f => /^changelog\.md$/i.test(f)),
    impact: 'low',
    rating: 3,
    category: 'hygiene',
    fix: 'Add a CHANGELOG.md to track notable changes across versions.',
    template: null
  },

  contributing: {
    id: 418,
    name: 'Has CONTRIBUTING.md',
    check: (ctx) => ctx.files.some(f => /^contributing\.md$/i.test(f)),
    impact: 'low',
    rating: 3,
    category: 'hygiene',
    fix: 'Add a CONTRIBUTING.md with contribution guidelines and code standards.',
    template: null
  },

  license: {
    id: 434,
    name: 'Has LICENSE file',
    check: (ctx) => ctx.files.some(f => /^license/i.test(f)),
    impact: 'low',
    rating: 3,
    category: 'hygiene',
    fix: 'Add a LICENSE file to clarify usage rights.',
    template: null
  },

  editorconfig: {
    id: 5001,
    name: 'Has .editorconfig',
    check: (ctx) => ctx.files.includes('.editorconfig'),
    impact: 'low',
    rating: 3,
    category: 'hygiene',
    fix: 'Add .editorconfig for consistent formatting across editors and Claude.',
    template: null
  },

  nvmrc: {
    id: 5002,
    name: 'Node version pinned',
    check: (ctx) => {
      const hasNodeSignals = ctx.files.includes('package.json') ||
        ctx.files.includes('tsconfig.json') ||
        ctx.files.some(f => /package-lock\.json|pnpm-lock\.yaml|yarn\.lock|next\.config|vite\.config/i.test(f));
      if (!hasNodeSignals) return null;
      if (ctx.files.includes('.nvmrc') || ctx.files.includes('.node-version')) return true;
      const pkg = ctx.jsonFile('package.json');
      return !!(pkg && pkg.engines && pkg.engines.node);
    },
    impact: 'low',
    rating: 3,
    category: 'hygiene',
    fix: 'Add .nvmrc, .node-version, or engines.node in package.json to pin Node version.',
    template: null
  },

  // ============================================================
  // === PERFORMANCE (category: 'performance') ==================
  // ============================================================

  compactionAwareness: {
    id: 568,
    name: 'CLAUDE.md mentions /compact or compaction',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return /\/compact|compaction|context.*(limit|manage|budget)/i.test(md);
    },
    impact: 'medium',
    rating: 4,
    category: 'performance',
    fix: 'Add compaction guidance to CLAUDE.md (e.g. "Run /compact when context is heavy").',
    template: null
  },

  contextManagement: {
    id: 45,
    name: 'Context management awareness',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return /context.*(manage|window|limit|budget|token)/i.test(md);
    },
    impact: 'medium',
    rating: 4,
    category: 'performance',
    fix: 'Add context management tips to CLAUDE.md to help Claude stay within token limits.',
    template: null
  },

  // ============================================================
  // === MCP / TOOLS (category: 'tools') ========================
  // ============================================================

  mcpServers: {
    id: 18,
    name: 'MCP servers configured',
    check: (ctx) => {
      // MCP now lives in .mcp.json (project) and ~/.claude.json (user), NOT settings.json
      const mcpJson = ctx.jsonFile('.mcp.json');
      if (mcpJson && mcpJson.mcpServers && Object.keys(mcpJson.mcpServers).length > 0) return true;
      // Fallback: check settings for legacy format
      const settings = ctx.jsonFile('.claude/settings.local.json') || ctx.jsonFile('.claude/settings.json');
      return !!(settings && settings.mcpServers && Object.keys(settings.mcpServers).length > 0);
    },
    impact: 'medium',
    rating: 3,
    category: 'tools',
    fix: 'Configure MCP servers in .mcp.json at project root. Use `claude mcp add` to add servers. Project-level MCP is committed to git for team sharing.',
    template: null
  },

  multipleMcpServers: {
    id: 1801,
    name: '2+ MCP servers for rich tooling',
    check: (ctx) => {
      let count = 0;
      const mcpJson = ctx.jsonFile('.mcp.json');
      if (mcpJson && mcpJson.mcpServers) count += Object.keys(mcpJson.mcpServers).length;
      const settings = ctx.jsonFile('.claude/settings.local.json') || ctx.jsonFile('.claude/settings.json');
      if (settings && settings.mcpServers) count += Object.keys(settings.mcpServers).length;
      return count >= 2;
    },
    impact: 'medium',
    rating: 4,
    category: 'tools',
    fix: 'Add at least 2 MCP servers for broader tool coverage (e.g. database + search).',
    template: null
  },

  context7Mcp: {
    id: 110,
    name: 'Context7 MCP for real-time docs',
    check: (ctx) => {
      const shared = ctx.jsonFile('.claude/settings.json') || {};
      const local = ctx.jsonFile('.claude/settings.local.json') || {};
      const mcp = ctx.jsonFile('.mcp.json') || {};
      const all = { ...(shared.mcpServers || {}), ...(local.mcpServers || {}), ...(mcp.mcpServers || {}) };
      if (Object.keys(all).length === 0) return false;
      return Object.keys(all).some(k => /context7/i.test(k));
    },
    impact: 'medium',
    rating: 4,
    category: 'tools',
    fix: 'Add Context7 MCP server for real-time documentation lookup (always up-to-date library docs).',
    template: null
  },

  // ============================================================
  // === PROMPTING (category: 'prompting') ======================
  // ============================================================

  xmlTags: {
    id: 96,
    name: 'XML tags for structured prompts',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      // Give credit for XML tags OR well-structured markdown with clear sections
      const hasXml = md.includes('<constraints') || md.includes('<rules') ||
        md.includes('<validation') || md.includes('<instructions');
      const hasStructuredMd = (md.includes('## Rules') || md.includes('## Constraints') ||
        md.includes('## Do not') || md.includes('## Never') || md.includes('## Important')) &&
        md.split('\n').length > 20;
      return hasXml || hasStructuredMd;
    },
    impact: 'medium',
    rating: 4,
    category: 'prompting',
    fix: 'Add clear rules sections to CLAUDE.md. XML tags (<constraints>) are optional but improve clarity.',
    template: null
  },

  fewShotExamples: {
    id: 9,
    name: 'CLAUDE.md contains code examples',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return (md.match(/```/g) || []).length >= 2;
    },
    impact: 'high',
    rating: 5,
    category: 'prompting',
    fix: 'Add code examples (few-shot) in CLAUDE.md to show preferred patterns and conventions.',
    template: null
  },

  roleDefinition: {
    id: 10,
    name: 'CLAUDE.md defines a role or persona',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return /^you are a |^your role is|^act as a |persona:|behave as a /im.test(md);
    },
    impact: 'medium',
    rating: 4,
    category: 'prompting',
    fix: 'Define a role or persona in CLAUDE.md (e.g. "You are a senior backend engineer...").',
    template: null
  },

  constraintBlocks: {
    id: 9601,
    name: 'XML constraint blocks in CLAUDE.md',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return /<constraints|<rules|<requirements|<boundaries/i.test(md);
    },
    impact: 'high',
    rating: 5,
    category: 'prompting',
    fix: 'Wrap critical rules in <constraints> XML blocks for 40% better adherence.',
    template: null
  },

  // ============================================================
  // === FEATURES (category: 'features') ========================
  // ============================================================

  channelsAwareness: {
    id: 1102,
    name: 'Claude Code Channels awareness',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      const settings = ctx.jsonFile('.claude/settings.local.json') || ctx.jsonFile('.claude/settings.json');
      const settingsStr = JSON.stringify(settings || {});
      return /\bchannels?\b.*\b(telegram|discord|imessage|slack|bridge)\b|\b(telegram|discord|imessage|slack|bridge)\b.*\bchannels?\b/i.test(md) || settingsStr.includes('channels');
    },
    impact: 'low',
    rating: 3,
    category: 'features',
    fix: 'Claude Code Channels (v2.1.80+) bridges Telegram/Discord/iMessage to your session.',
    template: null
  },

  // ============================================================
  // === QUALITY CHECKS FOR VETERANS (category: 'quality-deep')
  // These check HOW GOOD your config is, not just IF it exists.
  // ============================================================

  claudeMdFreshness: {
    id: 2001,
    name: 'CLAUDE.md mentions current Claude features',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      if (md.length < 50) return false; // too short to evaluate
      // Check for awareness of features from 2025+
      const modernFeatures = ['hook', 'skill', 'agent', 'subagent', 'mcp', 'compact', '/clear', 'extended thinking', 'tool_use', 'worktree'];
      const found = modernFeatures.filter(f => md.toLowerCase().includes(f));
      return found.length >= 2; // knows at least 2 modern features
    },
    impact: 'medium',
    rating: 4,
    category: 'quality-deep',
    fix: 'Your CLAUDE.md may be outdated. Modern Claude Code supports hooks, skills, agents, MCP, worktrees, and extended thinking. Mention the ones you use.',
    template: null
  },

  // claudeMdNotOverlong removed — duplicate of underlines200 (id 681)

  claudeLocalMd: {
    id: 2002,
    name: 'CLAUDE.local.md for personal overrides',
    check: (ctx) => {
      // CLAUDE.local.md is for personal, non-committed overrides
      return ctx.files.includes('CLAUDE.local.md') || ctx.files.includes('.claude/CLAUDE.local.md');
    },
    impact: 'low',
    rating: 2,
    category: 'memory',
    fix: 'Create CLAUDE.local.md for personal preferences that should not be committed (add to .gitignore).',
    template: null
  },

  claudeMdNoContradictions: {
    id: 2003,
    name: 'CLAUDE.md has no obvious contradictions',
    check: (ctx) => {
      const md = ctx.claudeMdContent();
      if (!md || md.length < 50) return false; // no CLAUDE.md or too short = not passing
      // Check for common contradictions
      // Check for contradictions on the SAME topic (same line or adjacent sentence)
      const lines = md.split('\n');
      let hasContradiction = false;
      for (const line of lines) {
        if (/\balways\b.*\bnever\b|\bnever\b.*\balways\b/i.test(line)) {
          hasContradiction = true;
          break;
        }
      }
      const hasBothStyles = /\buse tabs\b/i.test(md) && /\buse spaces\b/i.test(md);
      return !hasContradiction && !hasBothStyles;
    },
    impact: 'high',
    rating: 4,
    category: 'quality-deep',
    fix: 'CLAUDE.md may contain contradictory instructions. Review for conflicting rules (e.g., "always X" and "never X" about the same topic).',
    template: null
  },

  hooksAreSpecific: {
    id: 2004,
    name: 'Hooks use specific matchers (not catch-all)',
    check: (ctx) => {
      const settings = ctx.jsonFile('.claude/settings.local.json') || ctx.jsonFile('.claude/settings.json');
      if (!settings || !settings.hooks) return null; // no hooks = not applicable
      const hookStr = JSON.stringify(settings.hooks);
      // Check that hooks have matchers, not just catch-all
      return hookStr.includes('matcher');
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Hooks without matchers run on every tool call. Use matchers like "Write|Edit" or "Bash" to target specific tools.',
    template: null
  },

  // permissionsNotBypassed removed - duplicate of noBypassPermissions (#24)

  commandsUseArguments: {
    id: 2006,
    name: 'Commands use $ARGUMENTS for flexibility',
    check: (ctx) => {
      if (!ctx.hasDir('.claude/commands')) return null; // not applicable
      const files = ctx.dirFiles('.claude/commands');
      if (files.length === 0) return null;
      // Check if at least one command uses $ARGUMENTS
      for (const f of files) {
        const content = ctx.fileContent(`.claude/commands/${f}`) || '';
        if (content.includes('$ARGUMENTS') || content.includes('$arguments')) return true;
      }
      return false;
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Commands without $ARGUMENTS are static. Use $ARGUMENTS to make them flexible: "Fix the issue: $ARGUMENTS"',
    template: null
  },

  agentsHaveMaxTurns: {
    id: 2007,
    name: 'Subagents have max-turns limit',
    check: (ctx) => {
      if (!ctx.hasDir('.claude/agents')) return null;
      const files = ctx.dirFiles('.claude/agents');
      if (files.length === 0) return null;
      for (const f of files) {
        const content = ctx.fileContent(`.claude/agents/${f}`) || '';
        // Current frontmatter uses kebab-case: max-turns (also accept legacy maxTurns)
        if (!content.includes('max-turns') && !content.includes('maxTurns')) return false;
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Subagents without max-turns can run indefinitely. Add "max-turns: 50" to subagent YAML frontmatter.',
    template: null
  },

  securityReviewInWorkflow: {
    id: 2008,
    name: '/security-review command or workflow',
    check: (ctx) => {
      const hasCommand = ctx.hasDir('.claude/commands') &&
        (ctx.dirFiles('.claude/commands') || []).some(f => f.includes('security') || f.includes('review'));
      const md = ctx.claudeMdContent() || '';
      const hasExplicitRef = /\/security-review|security review command|security workflow/i.test(md);
      return hasCommand || hasExplicitRef;
    },
    impact: 'medium',
    rating: 4,
    category: 'quality-deep',
    fix: 'Claude Code has built-in /security-review (OWASP Top 10). Add it to your workflow or create a /security command.',
    template: null
  },

  // --- New checks: testing depth ---
  testCoverage: {
    id: 2010,
    name: 'Test coverage or strategy mentioned',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return /coverage|test.*strateg|e2e|integration test|unit test/i.test(md);
    },
    impact: 'medium', rating: 3, category: 'quality',
    fix: 'Mention your testing strategy in CLAUDE.md (unit, integration, E2E, coverage targets).',
    template: null
  },

  // --- New checks: agent depth ---
  agentHasAllowedTools: {
    id: 2011,
    name: 'At least one subagent restricts tools',
    check: (ctx) => {
      if (!ctx.hasDir('.claude/agents')) return null;
      const files = ctx.dirFiles('.claude/agents');
      if (files.length === 0) return null;
      for (const f of files) {
        const content = ctx.fileContent(`.claude/agents/${f}`) || '';
        // Current frontmatter uses allowed-tools (also accept legacy tools:)
        if (/allowed-tools:/i.test(content) || /tools:\s*\[/.test(content)) return true;
      }
      return false;
    },
    impact: 'medium', rating: 3, category: 'workflow',
    fix: 'Add allowed-tools to subagent frontmatter (e.g. allowed-tools: Read Grep Bash) for safer delegation.',
    template: null
  },

  // --- New checks: memory / auto-memory ---
  autoMemoryAwareness: {
    id: 2012,
    name: 'Auto-memory or memory management mentioned',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return /auto.?memory|memory.*manage|remember|persistent.*context/i.test(md);
    },
    impact: 'low', rating: 3, category: 'memory',
    fix: 'Claude Code supports auto-memory for cross-session learning. Mention your memory strategy if relevant.',
    template: null
  },

  // --- New checks: sandbox / security depth ---
  sandboxAwareness: {
    id: 2013,
    name: 'Sandbox or isolation mentioned',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      const settings = ctx.jsonFile('.claude/settings.json') || {};
      return /sandbox|isolat/i.test(md) || !!settings.sandbox;
    },
    impact: 'medium', rating: 3, category: 'security',
    fix: 'Claude Code supports sandboxed command execution. Consider enabling it for untrusted operations.',
    template: null
  },

  denyRulesDepth: {
    id: 2014,
    name: 'Deny rules cover 3+ patterns',
    check: (ctx) => {
      const shared = ctx.jsonFile('.claude/settings.json');
      const local = ctx.jsonFile('.claude/settings.local.json');
      const deny = (shared?.permissions?.deny || []).concat(local?.permissions?.deny || []);
      return deny.length >= 3;
    },
    impact: 'high', rating: 4, category: 'security',
    fix: 'Add at least 3 deny rules: rm -rf, force-push, and .env reads. More patterns = safer Claude.',
    template: null
  },

  // --- New checks: git depth ---
  gitAttributionDecision: {
    id: 2015,
    name: 'Git attribution configured',
    check: (ctx) => {
      const shared = ctx.jsonFile('.claude/settings.json') || {};
      const local = ctx.jsonFile('.claude/settings.local.json') || {};
      return shared.attribution !== undefined || local.attribution !== undefined ||
             shared.includeCoAuthoredBy !== undefined || local.includeCoAuthoredBy !== undefined;
    },
    impact: 'low', rating: 3, category: 'git',
    fix: 'Decide on git attribution: set attribution.commit or includeCoAuthoredBy in settings.',
    template: null
  },

  // --- New checks: performance ---
  effortLevelConfigured: {
    id: 2016,
    name: 'Effort level or thinking configuration',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      const shared = ctx.jsonFile('.claude/settings.json') || {};
      const local = ctx.jsonFile('.claude/settings.local.json') || {};
      return /effort|thinking/i.test(md) || shared.effortLevel || local.effortLevel ||
             shared.alwaysThinkingEnabled !== undefined || local.alwaysThinkingEnabled !== undefined;
    },
    impact: 'low', rating: 3, category: 'performance',
    fix: 'Configure effortLevel or mention thinking strategy in CLAUDE.md for task-appropriate reasoning depth.',
    template: null
  },

  // --- New checks: workflow depth ---
  hasSnapshotHistory: {
    id: 2017,
    name: 'Audit snapshot history exists',
    check: (ctx) => {
      const fs = require('fs');
      return fs.existsSync(resolveProjectStateReadPath(ctx.dir, 'snapshots', 'index.json'));
    },
    impact: 'low', rating: 3, category: 'workflow',
    fix: 'Run `npx nerviq --snapshot` to start tracking your setup score over time.',
    template: null
  },

  worktreeAwareness: {
    id: 2018,
    name: 'Worktree or parallel sessions mentioned',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      const shared = ctx.jsonFile('.claude/settings.json') || {};
      return /worktree|parallel.*session/i.test(md) || !!shared.worktree;
    },
    impact: 'low', rating: 3, category: 'features',
    fix: 'Claude Code supports git worktrees for parallel isolated sessions. Mention if relevant.',
    template: null
  },

  // --- New checks: prompting depth ---
  negativeInstructions: {
    id: 2019,
    name: 'CLAUDE.md includes "do not" instructions',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return /do not|don't|never|avoid|must not/i.test(md);
    },
    impact: 'medium', rating: 4, category: 'prompting',
    fix: 'Add explicit "do not" rules to CLAUDE.md. Negative constraints reduce common mistakes.',
    template: null
  },

  outputStyleGuidance: {
    id: 2020,
    name: 'CLAUDE.md includes output or style guidance',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return /coding style|naming convention|code style|style guide|formatting rules|\bprefer\b.*\b(single|double|tabs|spaces|camel|snake|kebab|named|default|const|let|arrow|function)\b/i.test(md);
    },
    impact: 'medium', rating: 3, category: 'prompting',
    fix: 'Add coding style and naming conventions to CLAUDE.md so Claude matches your project patterns.',
    template: null
  },

  // --- New checks: devops depth ---
  githubActionsOrCI: {
    id: 2021,
    name: 'GitHub Actions or CI configured',
    check: (ctx) => {
      return ctx.hasDir('.github/workflows') || !!ctx.fileContent('.circleci/config.yml') ||
             !!ctx.fileContent('.gitlab-ci.yml') || !!ctx.fileContent('Jenkinsfile') ||
             !!ctx.fileContent('.travis.yml') || !!ctx.fileContent('bitbucket-pipelines.yml');
    },
    impact: 'medium', rating: 3, category: 'devops',
    fix: 'Add CI pipeline for automated testing. Claude Code has a GitHub Action for audit gates.',
    template: null
  },

  // --- New checks: depth round 2 ---
  projectDescriptionInClaudeMd: {
    id: 2022,
    name: 'CLAUDE.md describes what the project does',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return /what.*does|overview|purpose|about|description|project.*is/i.test(md) && md.length > 100;
    },
    impact: 'high', rating: 4, category: 'memory',
    fix: 'Start CLAUDE.md with a clear project description. Claude needs to know what your project does.',
    template: null
  },

  directoryStructureInClaudeMd: {
    id: 2023,
    name: 'CLAUDE.md documents directory structure',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return /src\/|app\/|lib\/|structure|director|folder/i.test(md);
    },
    impact: 'medium', rating: 4, category: 'memory',
    fix: 'Document your directory structure in CLAUDE.md so Claude navigates your codebase efficiently.',
    template: null
  },

  multipleHookTypes: {
    id: 2024,
    name: '2+ hook event types configured',
    check: (ctx) => {
      const shared = ctx.jsonFile('.claude/settings.json') || {};
      const local = ctx.jsonFile('.claude/settings.local.json') || {};
      const hooks = { ...(shared.hooks || {}), ...(local.hooks || {}) };
      return Object.keys(hooks).length >= 2;
    },
    impact: 'medium', rating: 3, category: 'automation',
    fix: 'Add at least 2 hook types (e.g. PostToolUse for linting + SessionStart for initialization).',
    template: null
  },

  stopFailureHook: {
    id: 2025,
    name: 'StopFailure hook for error tracking',
    check: (ctx) => {
      const shared = ctx.jsonFile('.claude/settings.json') || {};
      const local = ctx.jsonFile('.claude/settings.local.json') || {};
      // StopFailure = error stop (API errors), Stop = normal completion — both useful but different
      return !!(shared.hooks?.StopFailure || local.hooks?.StopFailure);
    },
    impact: 'low', rating: 3, category: 'automation',
    fix: 'Add a StopFailure hook to log API errors and unexpected stops. Note: StopFailure (errors) is different from Stop (normal completion).',
    template: null
  },

  skillUsesPaths: {
    id: 2026,
    name: 'At least one skill uses paths for scoping',
    check: (ctx) => {
      if (!ctx.hasDir('.claude/skills')) return null;
      const entries = ctx.dirFiles('.claude/skills');
      if (entries.length === 0) return null;
      for (const entry of entries) {
        // Skills can be files or dirs with SKILL.md inside
        const direct = ctx.fileContent(`.claude/skills/${entry}`) || '';
        if (/paths:/i.test(direct)) return true;
        const nested = ctx.fileContent(`.claude/skills/${entry}/SKILL.md`) || '';
        if (/paths:/i.test(nested)) return true;
      }
      return false;
    },
    impact: 'low', rating: 3, category: 'workflow',
    fix: 'Add paths to skill frontmatter to scope when skills activate (e.g. paths: ["src/**/*.ts"]).',
    template: null
  },

  mcpHasEnvConfig: {
    id: 2027,
    name: 'MCP servers have environment configuration',
    check: (ctx) => {
      const shared = ctx.jsonFile('.claude/settings.json') || {};
      const local = ctx.jsonFile('.claude/settings.local.json') || {};
      const mcp = ctx.jsonFile('.mcp.json') || {};
      const allServers = { ...(shared.mcpServers || {}), ...(local.mcpServers || {}), ...(mcp.mcpServers || {}) };
      if (Object.keys(allServers).length === 0) return null;
      return Object.values(allServers).some(s => s.env && Object.keys(s.env).length > 0);
    },
    impact: 'low', rating: 3, category: 'tools',
    fix: 'Configure environment variables for MCP servers that need authentication (e.g. GITHUB_TOKEN).',
    template: null
  },

  gitIgnoreClaudeLocal: {
    id: 2028,
    name: '.gitignore excludes settings.local.json',
    check: (ctx) => {
      const gitignore = ctx.fileContent('.gitignore') || '';
      return /settings\.local\.json|settings\.local/i.test(gitignore);
    },
    impact: 'medium', rating: 4, category: 'git',
    fix: 'Add .claude/settings.local.json to .gitignore. Personal overrides should not be committed.',
    template: null
  },

  envExampleExists: {
    id: 2029,
    name: '.env.example or .env.template exists',
    check: (ctx) => {
      return !!(ctx.fileContent('.env.example') || ctx.fileContent('.env.template') || ctx.fileContent('.env.sample'));
    },
    impact: 'low', rating: 3, category: 'hygiene',
    fix: 'Add .env.example so new developers know which environment variables are needed.',
    template: null
  },

  packageJsonHasScripts: {
    id: 2030,
    name: 'package.json has dev/test/build scripts',
    check: (ctx) => {
      const pkg = ctx.jsonFile('package.json');
      if (!pkg) return null;
      const scripts = pkg.scripts || {};
      const has = (k) => !!scripts[k];
      return has('test') || has('dev') || has('build') || has('start');
    },
    impact: 'medium', rating: 3, category: 'hygiene',
    fix: 'Add scripts to package.json (test, dev, build). Claude uses these for verification.',
    template: null
  },

  typeCheckingConfigured: {
    id: 2031,
    name: 'Type checking configured (TypeScript or similar)',
    check: (ctx) => {
      return !!(ctx.fileContent('tsconfig.json') || ctx.fileContent('jsconfig.json') ||
        ctx.fileContent('pyrightconfig.json') || ctx.fileContent('mypy.ini'));
    },
    impact: 'medium', rating: 3, category: 'quality',
    fix: 'Add type checking configuration. Type-safe code produces fewer Claude errors.',
    template: null
  },

  noDeprecatedPatterns: {
    id: 2009,
    name: 'No deprecated patterns detected',
    check: (ctx) => {
      const md = ctx.claudeMdContent();
      if (!md) return false;
      // Only flag truly deprecated patterns, not valid aliases
      const deprecatedPatterns = [
        /\bhuman_prompt\b/i, /\bassistant_prompt\b/i, // old completions API format (not Messages API)
        /\buse model claude-3-opus\b/i, // explicit recommendation to use old name as --model
        /\buse model claude-3-sonnet\b/i,
      ];
      return !deprecatedPatterns.some(p => p.test(md));
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'CLAUDE.md references deprecated API patterns (human_prompt/assistant_prompt). Update to current Messages API conventions.',
    template: null
  },

  claudeMdQuality: {
    id: 102502,
    name: 'CLAUDE.md has substantive content',
    check: (ctx) => {
      const md = ctx.claudeMdContent();
      if (!md) return null;
      const lines = md.split('\n').filter(l => l.trim());
      const sections = (md.match(/^##\s/gm) || []).length;
      const hasCommand = /\b(npm|yarn|pnpm|pytest|go |make |ruff |cargo |dotnet )\b/i.test(md);
      return lines.length >= 15 && sections >= 2 && hasCommand;
    },
    impact: 'medium',
    rating: 4,
    category: 'quality-deep',
    fix: 'CLAUDE.md exists but lacks substance. Add at least 2 sections (## headings) and include your test/build/lint commands.',
    template: null
  },

  // ============================================================
  // === NEW CHECKS: Uncovered features (2026-04-05) ============
  // ============================================================

  mcpJsonProject: {
    id: 2032,
    name: 'Project-level .mcp.json exists',
    check: (ctx) => ctx.files.includes('.mcp.json'),
    impact: 'medium',
    rating: 3,
    category: 'tools',
    fix: 'Create .mcp.json at project root for team-shared MCP servers. Use `claude mcp add --project` to add servers.',
    template: null
  },

  hooksNotificationEvent: {
    id: 2033,
    name: 'Notification hook for alerts',
    check: (ctx) => {
      const shared = ctx.jsonFile('.claude/settings.json') || {};
      const local = ctx.jsonFile('.claude/settings.local.json') || {};
      return !!(shared.hooks?.Notification || local.hooks?.Notification);
    },
    impact: 'low',
    rating: 2,
    category: 'automation',
    fix: 'Add a Notification hook to capture alerts and status updates from Claude during long tasks.',
    template: null
  },

  subagentStopHook: {
    id: 2034,
    name: 'SubagentStop hook for delegation tracking',
    check: (ctx) => {
      const shared = ctx.jsonFile('.claude/settings.json') || {};
      const local = ctx.jsonFile('.claude/settings.local.json') || {};
      return !!(shared.hooks?.SubagentStop || local.hooks?.SubagentStop);
    },
    impact: 'low',
    rating: 2,
    category: 'automation',
    fix: 'Add a SubagentStop hook to track when delegated subagent tasks complete.',
    template: null
  },

  rulesDirectory: {
    id: 2035,
    name: 'Path-specific rules in .claude/rules/',
    check: (ctx) => ctx.hasDir('.claude/rules') && ctx.dirFiles('.claude/rules').length > 0,
    impact: 'medium',
    rating: 3,
    category: 'workflow',
    fix: 'Create .claude/rules/ with path-specific rules for different parts of your codebase (e.g. frontend.md, backend.md).',
    template: null
  },

  gitignoreClaudeLocal: {
    id: 2036,
    name: 'CLAUDE.local.md in .gitignore',
    check: (ctx) => {
      const gitignore = ctx.fileContent('.gitignore') || '';
      return /CLAUDE\.local\.md/i.test(gitignore);
    },
    impact: 'medium',
    rating: 3,
    category: 'git',
    fix: 'Add CLAUDE.local.md to .gitignore — it contains personal overrides that should not be committed.',
    template: null
  },


  // ============================================================
  // === PYTHON STACK CHECKS (category: 'python') ===============
  // ============================================================

  pyprojectTomlExists: {
    id: 120001,
    name: 'pyproject.toml exists for Python packaging',
    check: (ctx) => { if (!isPythonProject(ctx)) return null; return hasProjectFile(ctx, /(^|\/)pyproject\.toml$/i); },
    impact: 'high',
    category: 'python',
    fix: 'Add pyproject.toml to declare modern Python packaging, tooling, and metadata.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonTypeHints: {
    id: 120002,
    name: 'Type hints used in Python code',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      if (hasProjectFile(ctx, /(^|\/)(mypy\.ini|py\.typed|pyrightconfig\.json)$/i)) return true;
      const pyproject = readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i);
      if (/\[tool\.(mypy|pyright)\]/i.test(pyproject)) return true;
      const files = getMainPythonFiles(ctx);
      if (files.length === 0) return null;
      return files.some(file => /from typing import|import typing|from __future__ import annotations|->\s*[\w\[\]., ]+|:\s*[\w\[\]., ]+\s*=/.test(ctx.fileContent(file) || ''));
    },
    impact: 'medium',
    category: 'python',
    fix: 'Add type hints in main Python modules or configure mypy/pyright with py.typed support.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonLinter: {
    id: 120003,
    name: 'Python linter configured',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const config = `${getPythonProjectText(ctx)}\n${readProjectFiles(ctx, /(^|\/)(\.flake8|\.pylintrc|pylintrc|ruff\.toml|\.ruff\.toml)$/i)}`;
      return /\[tool\.ruff\]|\[flake8\]|\[tool\.flake8\]|\[tool\.pylint\]|ruff|flake8|pylint/i.test(config);
    },
    impact: 'medium',
    category: 'python',
    fix: 'Configure a Python linter such as ruff, flake8, or pylint in pyproject.toml or a dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonFormatter: {
    id: 120004,
    name: 'Python formatter configured',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const pyproject = getPythonProjectText(ctx);
      const prettier = readProjectFiles(ctx, /(^|\/)\.prettierrc(\.(json|ya?ml|toml))?$/i);
      return /\[tool\.black\]|\[tool\.ruff\.format\]|\[tool\.isort\]/i.test(pyproject) ||
        /python|\.py\b/i.test(prettier);
    },
    impact: 'medium',
    category: 'python',
    fix: 'Configure formatting with black, ruff format, isort, or a Prettier override that explicitly covers Python files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonTestFramework: {
    id: 120005,
    name: 'Python test framework present',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      return /\[tool\.pytest/i.test(getPythonProjectText(ctx)) ||
        hasProjectFile(ctx, /(^|\/)(pytest\.ini|tox\.ini|conftest\.py)$/i);
    },
    impact: 'high',
    category: 'python',
    fix: 'Add pytest.ini, conftest.py, tox.ini, or pyproject.toml pytest configuration so the test framework is explicit.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonVenvIgnored: {
    id: 120006,
    name: 'Virtual environment directories ignored in git',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const gitignore = ctx.fileContent('.gitignore') || '';
      return /(^|\n)\s*\.venv\/?\s*($|\n)|(^|\n)\s*venv\/?\s*($|\n)|(^|\n)\s*env\/?\s*($|\n)/i.test(gitignore);
    },
    impact: 'medium',
    category: 'python',
    fix: 'Ignore `.venv/`, `venv/`, or `env/` in .gitignore so local environments do not get committed.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonRequirementsPinned: {
    id: 120007,
    name: 'Requirements files use pinned versions',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const files = findProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
      if (files.length === 0) return null;
      const lines = files
        .flatMap(file => (ctx.fileContent(file) || '').split(/\r?\n/))
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
      if (lines.length === 0) return null;
      return lines.every(line => /^(-r|-c|--)/.test(line) || /==| @ /.test(line));
    },
    impact: 'high',
    category: 'python',
    fix: 'Pin Python requirements with `==` or direct references so installs stay reproducible.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonSecurityScanner: {
    id: 120008,
    name: 'Python security scanner configured',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const content = `${getPythonProjectText(ctx)}\n${getWorkflowContent(ctx)}\n${getPreCommitContent(ctx)}`;
      return /bandit|pip-audit|safety/i.test(content);
    },
    impact: 'medium',
    category: 'python',
    fix: 'Configure bandit, safety, or pip-audit in dependencies, pre-commit, or CI.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonPreCommitHooks: {
    id: 120009,
    name: 'pre-commit configured with Python hooks',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const preCommit = getPreCommitContent(ctx);
      if (!preCommit) return false;
      return /ruff|black|mypy|pyupgrade|pytest|bandit|isort|flake8|pylint/i.test(preCommit);
    },
    impact: 'medium',
    category: 'python',
    fix: 'Add `.pre-commit-config.yaml` with Python-focused hooks such as ruff, black, mypy, or bandit.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonDocstrings: {
    id: 120010,
    name: 'Docstrings present in main Python files',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const files = getMainPythonFiles(ctx);
      if (files.length === 0) return null;
      return files.some(file => /(^|\n)\s*(def|class)\s+\w+.*:\s*\n\s*("""|''')|^\s*("""|''')/m.test(ctx.fileContent(file) || ''));
    },
    impact: 'low',
    category: 'python',
    fix: 'Add module, class, or function docstrings in the main Python source files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonCIConfigured: {
    id: 120011,
    name: 'CI runs Python tests',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      return /pytest|python -m pytest|python -m unittest|tox\b|nox\b/i.test(getWorkflowContent(ctx));
    },
    impact: 'high',
    category: 'python',
    fix: 'Run Python tests in CI with pytest, unittest, tox, or nox.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonCoverage: {
    id: 120012,
    name: 'Python coverage configured',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const content = `${getPythonProjectText(ctx)}\n${getWorkflowContent(ctx)}\n${readProjectFiles(ctx, /(^|\/)\.coveragerc$/i)}`;
      return /\[tool\.coverage|pytest-cov|coverage\b|--cov\b/i.test(content);
    },
    impact: 'medium',
    category: 'python',
    fix: 'Configure coverage.py or pytest-cov in project config or CI.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonPackageManager: {
    id: 120013,
    name: 'Modern Python package manager lockfile present',
    check: (ctx) => { if (!isPythonProject(ctx)) return null; return hasProjectFile(ctx, /(^|\/)(poetry\.lock|pdm\.lock|uv\.lock|Pipfile\.lock)$/); },
    impact: 'medium',
    category: 'python',
    fix: 'Commit a Poetry, PDM, uv, or Pipenv lockfile for reproducible dependency resolution.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonMinVersionSpecified: {
    id: 120014,
    name: 'Minimum Python version specified',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const content = `${getPythonProjectText(ctx)}\n${readProjectFiles(ctx, /(^|\/)\.python-version$/i)}`;
      return /requires-python|python_requires|(^|\n)\s*python\s*=|^\s*\d+\.\d+(\.\d+)?\s*$/im.test(content);
    },
    impact: 'medium',
    category: 'python',
    fix: 'Specify the supported Python version with `.python-version`, `requires-python`, or `python_requires`.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonAsyncPatterns: {
    id: 120015,
    name: 'Async Python patterns used',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const content = `${getPythonProjectText(ctx)}\n${getMainPythonFiles(ctx).slice(0, 30).map(file => ctx.fileContent(file) || '').join('\n')}`;
      return /asyncio|aiohttp|fastapi|starlette|trio|anyio|async def|await /i.test(content);
    },
    impact: 'low',
    category: 'python',
    fix: 'Adopt explicit async patterns such as asyncio, aiohttp, FastAPI, or `async def` where concurrent workflows matter.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonEnvExample: {
    id: 120016,
    name: 'Python project includes an environment example file',
    check: (ctx) => { if (!isPythonProject(ctx)) return null; return hasProjectFile(ctx, /(^|\/)\.env(\.example|\.sample)$/i); },
    impact: 'medium',
    category: 'python',
    fix: 'Add `.env.example` or `.env.sample` so required Python environment variables are documented.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonMigrations: {
    id: 120017,
    name: 'Python database migration tooling present',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const content = `${getPythonProjectText(ctx)}\n${getMainPythonFiles(ctx).slice(0, 20).map(file => ctx.fileContent(file) || '').join('\n')}`;
      return /alembic|django\.db\.migrations|makemigrations|migrate/i.test(content) ||
        hasProjectFile(ctx, /(^|\/)alembic\.ini$/i) ||
        hasProjectFile(ctx, /(^|\/)(alembic|migrations)\//i);
    },
    impact: 'medium',
    category: 'python',
    fix: 'Use Alembic or Django migrations and keep the migration surface committed in the repo.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonLogging: {
    id: 120018,
    name: 'Python structured logging configured',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const content = `${getPythonProjectText(ctx)}\n${getMainPythonFiles(ctx).slice(0, 30).map(file => ctx.fileContent(file) || '').join('\n')}`;
      return /structlog|loguru|logging\.config|dictConfig|getLogger|basicConfig/i.test(content);
    },
    impact: 'medium',
    category: 'python',
    fix: 'Configure logging with Python logging config, structlog, or loguru for consistent operational signals.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonAPISchema: {
    id: 120019,
    name: 'Python API schema or model definitions present',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const content = `${getPythonProjectText(ctx)}\n${getMainPythonFiles(ctx).slice(0, 30).map(file => ctx.fileContent(file) || '').join('\n')}`;
      return /openapi|swagger|BaseModel|pydantic|Schema\)|marshmallow|TypedDict/i.test(content);
    },
    impact: 'medium',
    category: 'python',
    fix: 'Define API schemas with OpenAPI, Pydantic, Marshmallow, or typed request/response models.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonContainerized: {
    id: 120020,
    name: 'Python container image uses a Python base',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const dockerfile = ctx.fileContent('Dockerfile') || '';
      if (!dockerfile) return null;
      return /FROM\s+python[:\d.-]/i.test(dockerfile);
    },
    impact: 'medium',
    category: 'python',
    fix: 'Use an official Python image such as `python:3.12-slim` when containerizing Python services.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonDependencyGroups: {
    id: 120021,
    name: 'Python dev and test dependency groups separated',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const content = getPythonProjectText(ctx);
      return /\[tool\.poetry\.group\.[^\]]+\]|\[project\.optional-dependencies\]|extras_require|dependency-groups/i.test(content);
    },
    impact: 'medium',
    category: 'python',
    fix: 'Separate Python dev and test dependencies with Poetry groups, optional-dependencies, or extras_require.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonPathConfig: {
    id: 120022,
    name: 'Python tool path configuration present',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      if (hasProjectFile(ctx, /(^|\/)pyrightconfig\.json$/i)) return true;
      const vscodeSettings = findProjectFiles(ctx, /(^|\/)\.vscode\/settings\.json$/i)
        .map(file => ctx.jsonFile(file) || {})
        .find(settings => Object.keys(settings).some(key => key.toLowerCase().includes('python')));
      return !!vscodeSettings;
    },
    impact: 'low',
    category: 'python',
    fix: 'Add `pyrightconfig.json` or VS Code Python settings so tooling resolves imports and environments consistently.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonMonorepo: {
    id: 120023,
    name: 'Python monorepo-friendly package layout present',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const content = getPythonProjectText(ctx);
      return ctx.hasDir('src') ||
        /namespace_packages|find_namespace:|from\s*=\s*["']src["']|package-dir/i.test(content);
    },
    impact: 'low',
    category: 'python',
    fix: 'Use a `src/` layout or namespace package configuration for larger multi-package Python repos.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonErrorHandling: {
    id: 120024,
    name: 'Custom Python exception classes defined',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const files = getMainPythonFiles(ctx);
      if (files.length === 0) return null;
      return files.some(file => /class\s+\w+(Error|Exception)\s*\((?:[\w.]*Exception|[\w.]*Error)\)\s*:/i.test(ctx.fileContent(file) || ''));
    },
    impact: 'low',
    category: 'python',
    fix: 'Define custom exception classes for domain-specific Python error handling instead of only raising generic exceptions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  pythonDataValidation: {
    id: 120025,
    name: 'Python data validation library used',
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      const content = `${getPythonProjectText(ctx)}\n${getMainPythonFiles(ctx).slice(0, 30).map(file => ctx.fileContent(file) || '').join('\n')}`;
      return /pydantic|marshmallow|attrs|attr\.s|BaseModel|Schema\)/i.test(content);
    },
    impact: 'medium',
    category: 'python',
    fix: 'Use Pydantic, Marshmallow, attrs, or similar validation libraries for structured Python inputs and models.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === GO STACK CHECKS (category: 'go') =======================
  // ============================================================

  goModExists: {
    id: 120101,
    name: 'go.mod exists for Go module management',
    check: (ctx) => { if (!isGoProject(ctx)) return null; return true; },
    impact: 'high',
    category: 'go',
    fix: 'Initialize the repository as a Go module with `go mod init` and commit `go.mod`.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goLinter: {
    id: 120102,
    name: 'Go linter configured',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      const content = `${getGoProjectText(ctx)}\n${readProjectFiles(ctx, /(^|\/)\.golangci\.(ya?ml|toml)$/i)}`;
      return /\.golangci\.|golangci-lint/i.test(content);
    },
    impact: 'medium',
    category: 'go',
    fix: 'Configure golangci-lint in the repo or CI for consistent Go lint enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goTestFiles: {
    id: 120103,
    name: 'Go test files present',
    check: (ctx) => { if (!isGoProject(ctx)) return null; return hasProjectFile(ctx, /_test\.go$/i); },
    impact: 'high',
    category: 'go',
    fix: 'Add `_test.go` files so Go packages have executable unit or integration tests.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goVet: {
    id: 120104,
    name: 'go vet runs in automation',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      const content = `${getWorkflowContent(ctx)}\n${ctx.fileContent('Makefile') || ''}`;
      return /go vet/i.test(content);
    },
    impact: 'medium',
    category: 'go',
    fix: 'Run `go vet` in CI or the project Makefile to catch common Go mistakes.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goFmt: {
    id: 120105,
    name: 'gofmt or goimports enforced',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      const content = `${getWorkflowContent(ctx)}\n${ctx.fileContent('Makefile') || ''}\n${getPreCommitContent(ctx)}`;
      return /gofmt|goimports/i.test(content);
    },
    impact: 'medium',
    category: 'go',
    fix: 'Run `gofmt` or `goimports` in CI, pre-commit, or developer tooling.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goModTidy: {
    id: 120106,
    name: 'go mod tidy runs in automation',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      const content = `${getWorkflowContent(ctx)}\n${ctx.fileContent('Makefile') || ''}`;
      return /go mod tidy/i.test(content);
    },
    impact: 'medium',
    category: 'go',
    fix: 'Run `go mod tidy` in CI or the Makefile so module metadata stays clean.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goBuildTags: {
    id: 120107,
    name: 'Go build tags or constraints used',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      const files = getGoFiles(ctx);
      if (files.length === 0) return null;
      return files.some(file => /\/\/go:build|\/\/ \+build/.test(ctx.fileContent(file) || ''));
    },
    impact: 'low',
    category: 'go',
    fix: 'Use `//go:build` constraints when a Go package depends on build tags or platform-specific variants.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goErrorWrapping: {
    id: 120108,
    name: 'Go errors use wrapping patterns',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      const files = getMainGoFiles(ctx);
      if (files.length === 0) return null;
      return files.some(file => /fmt\.Errorf\([^)]*%w|errors\.Join\(/.test(ctx.fileContent(file) || ''));
    },
    impact: 'medium',
    category: 'go',
    fix: 'Wrap Go errors with `fmt.Errorf(... %w ...)` or similar patterns to preserve context.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goInterfaceSegregation: {
    id: 120109,
    name: 'Go interfaces stay small',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      const interfaces = getGoInterfaceBlocks(ctx);
      if (interfaces.length === 0) return null;
      return interfaces.every(block => countGoInterfaceMethods(block) <= 5);
    },
    impact: 'low',
    category: 'go',
    fix: 'Keep Go interfaces small and focused; split interfaces that define more than five methods.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goContextUsage: {
    id: 120110,
    name: 'Go services use context.Context',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      const files = getMainGoFiles(ctx);
      if (files.length === 0) return null;
      return files.some(file => /context\.Context|context\.With(Cancel|Timeout|Deadline)|ctx\s+context\.Context/.test(ctx.fileContent(file) || ''));
    },
    impact: 'medium',
    category: 'go',
    fix: 'Pass `context.Context` through handlers and services so cancellation and deadlines are propagated correctly.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goStructTags: {
    id: 120111,
    name: 'Exported Go structs include tags',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      const structBlocks = [];
      for (const file of getMainGoFiles(ctx)) {
        const content = ctx.fileContent(file) || '';
        for (const match of content.matchAll(/type\s+([A-Z]\w*)\s+struct\s*\{([\s\S]*?)\}/g)) {
          structBlocks.push(match[2]);
        }
      }
      if (structBlocks.length === 0) return null;
      return structBlocks.some(block => /`[^`]*(json|yaml|db):"/.test(block));
    },
    impact: 'low',
    category: 'go',
    fix: 'Add struct tags such as `json`, `yaml`, or `db` on exported Go types that cross boundaries.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goMakefile: {
    id: 120112,
    name: 'Go Makefile includes build, test, and lint targets',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      const makefile = ctx.fileContent('Makefile') || '';
      if (!makefile) return false;
      return /^\s*build:/m.test(makefile) && /^\s*test:/m.test(makefile) && /^\s*lint:/m.test(makefile);
    },
    impact: 'medium',
    category: 'go',
    fix: 'Add a Makefile with `build`, `test`, and `lint` targets for common Go workflows.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goDocComments: {
    id: 120113,
    name: 'Exported Go functions have doc comments',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      const files = getMainGoFiles(ctx);
      if (files.length === 0) return null;
      const documented = files.some(file => /\/\/\s*[A-Z]\w+.*\nfunc\s+(?:\([^)]+\)\s*)?[A-Z]\w+\s*\(/.test(ctx.fileContent(file) || ''));
      const exported = files.some(file => /func\s+(?:\([^)]+\)\s*)?[A-Z]\w+\s*\(/.test(ctx.fileContent(file) || ''));
      if (!exported) return null;
      return documented;
    },
    impact: 'low',
    category: 'go',
    fix: 'Add Go doc comments above exported functions so package APIs remain self-describing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goSecurityScanner: {
    id: 120114,
    name: 'Go security scanner configured',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      return /gosec|staticcheck/i.test(getGoProjectText(ctx));
    },
    impact: 'medium',
    category: 'go',
    fix: 'Configure `gosec` or `staticcheck` in CI or the Makefile for Go security and static analysis checks.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goCIConfigured: {
    id: 120115,
    name: 'CI runs Go tests',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      return /go test(\s|$)|go test \.\/\.\.\./i.test(getWorkflowContent(ctx));
    },
    impact: 'high',
    category: 'go',
    fix: 'Run `go test ./...` in CI so Go packages are verified on every change.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goContainerized: {
    id: 120116,
    name: 'Go Dockerfile uses multi-stage build',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      const dockerfile = ctx.fileContent('Dockerfile') || '';
      if (!dockerfile) return null;
      return /FROM\s+golang[:\d.-].*\bAS\b/i.test(dockerfile) &&
        /FROM\s+(alpine|scratch|distroless|gcr\.io|cgr\.dev)/i.test(dockerfile);
    },
    impact: 'medium',
    category: 'go',
    fix: 'Use a multi-stage Go Dockerfile: compile in a `golang` image and run from a minimal final image.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goCoverageConfigured: {
    id: 120117,
    name: 'Go coverage reporting configured',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      const content = `${getWorkflowContent(ctx)}\n${ctx.fileContent('Makefile') || ''}`;
      return /go test[^\n]*-cover/i.test(content);
    },
    impact: 'medium',
    category: 'go',
    fix: 'Add `go test -cover` to CI or developer commands so Go coverage is tracked explicitly.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goAPIFramework: {
    id: 120118,
    name: 'Go HTTP framework detected',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      return /gin-gonic\/gin|labstack\/echo|gofiber\/fiber|go-chi\/chi|gin\.Default\(|echo\.New\(|fiber\.New\(|chi\.NewRouter\(/i.test(getGoProjectText(ctx));
    },
    impact: 'low',
    category: 'go',
    fix: 'Use a well-supported Go HTTP framework such as Gin, Echo, Fiber, or Chi when building API services.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goMigrationTool: {
    id: 120119,
    name: 'Go database migration tooling present',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      return /golang-migrate|pressly\/goose|atlasgo|atlas\s/i.test(getGoProjectText(ctx)) ||
        hasProjectFile(ctx, /(^|\/)(migrations|db\/migrations)\//i);
    },
    impact: 'medium',
    category: 'go',
    fix: 'Add a Go migration tool such as golang-migrate, goose, or Atlas and keep migration files in the repo.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  goDependencyInjection: {
    id: 120120,
    name: 'Go dependency injection pattern present',
    check: (ctx) => {
      if (!isGoProject(ctx)) return null;
      return /google\/wire|uber-go\/fx|uber-go\/dig|wire\.Build\(|fx\.New\(|dig\.New\(/i.test(getGoProjectText(ctx));
    },
    impact: 'low',
    category: 'go',
    fix: 'Use Wire, Fx, Dig, or an equivalent composition pattern when Go dependency graphs become complex.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },
  // ============================================================
  // === RUST STACK CHECKS (category: 'rust') ===================
  // ============================================================

  cargoTomlExists: {
    id: 120201,
    name: 'Cargo.toml exists',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return true;
    },
    impact: 'high',
    category: 'rust',
    fix: 'Add a `Cargo.toml` manifest so Rust dependencies, metadata, and build settings are tracked explicitly.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustEdition: {
    id: 120202,
    name: 'Rust edition specified in Cargo.toml',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return /edition\s*=\s*"20(18|21|24)"/i.test(readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i));
    },
    impact: 'high',
    category: 'rust',
    fix: 'Specify a Rust edition such as `edition = "2021"` in `Cargo.toml` so tooling and language semantics are pinned.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustClippy: {
    id: 120203,
    name: 'Clippy configured',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return hasProjectFile(ctx, /(^|\/)(clippy\.toml|\.clippy\.toml)$/i) ||
        /clippy/i.test(`${readProjectFiles(ctx, /(^|\/)\.cargo\/config\.toml$/i)}\n${getWorkflowContent(ctx)}\n${getPreCommitContent(ctx)}`);
    },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure `cargo clippy` in CI, pre-commit, or `.cargo/config.toml` so linting is enforced consistently.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustFmt: {
    id: 120204,
    name: 'rustfmt configured',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return hasProjectFile(ctx, /(^|\/)(rustfmt\.toml|\.rustfmt\.toml)$/i);
    },
    impact: 'medium',
    category: 'rust',
    fix: 'Add `rustfmt.toml` or `.rustfmt.toml` to capture Rust formatting expectations in version control.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustTestsExist: {
    id: 120205,
    name: 'Rust tests exist',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      const files = getRustFiles(ctx);
      if (files.length === 0) return null;
      return hasProjectFile(ctx, /(^|\/)tests\//i) ||
        files.some(file => /#\s*\[\s*test\s*\]/.test(ctx.fileContent(file) || ''));
    },
    impact: 'high',
    category: 'rust',
    fix: 'Add Rust unit or integration tests using `#[test]` functions or a `tests/` directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustBenchmarks: {
    id: 120206,
    name: 'Rust benchmarks present',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return hasProjectFile(ctx, /(^|\/)benches\//i) ||
        /#\s*\[\s*bench\s*\]|criterion/i.test(getRustProjectText(ctx));
    },
    impact: 'low',
    category: 'rust',
    fix: 'Add Rust benchmarks through `benches/`, `criterion`, or benchmark annotations when performance-sensitive code matters.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustCIConfigured: {
    id: 120207,
    name: 'CI runs cargo test',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return /cargo test(\s|$)/i.test(getWorkflowContent(ctx));
    },
    impact: 'high',
    category: 'rust',
    fix: 'Run `cargo test` in CI so Rust correctness is verified automatically on every change.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustCargoLock: {
    id: 120208,
    name: 'Cargo.lock handling is appropriate',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      const cargoText = readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i);
      const hasLock = hasProjectFile(ctx, /(^|\/)Cargo\.lock$/i);
      const gitignore = ctx.fileContent('.gitignore') || '';
      const libraryOnly = /\[lib\]/i.test(cargoText) && !/\[\[bin\]\]|src\/main\.rs/i.test(getRustProjectText(ctx));
      if (libraryOnly) return hasLock || /(^|\r?\n)\s*Cargo\.lock\s*$/m.test(gitignore);
      return hasLock;
    },
    impact: 'medium',
    category: 'rust',
    fix: 'Commit `Cargo.lock` for binaries, or explicitly ignore it for library-only crates when that is your chosen policy.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustUnsafeBlocks: {
    id: 120209,
    name: 'Unsafe blocks are documented',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      const files = getRustFiles(ctx);
      const unsafeFiles = files.filter(file => /\bunsafe\b/.test(ctx.fileContent(file) || ''));
      if (unsafeFiles.length === 0) return true;
      return unsafeFiles.every(file => /SAFETY:|\/\/\s*SAFETY|\/\*\s*SAFETY/i.test(ctx.fileContent(file) || ''));
    },
    impact: 'medium',
    category: 'rust',
    fix: 'Document each `unsafe` block with a nearby `SAFETY:` comment explaining the invariants being upheld.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustErrorHandling: {
    id: 120210,
    name: 'Rust error handling strategy present',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return /thiserror|anyhow|eyre|impl\s+std::error::Error|enum\s+\w+Error|struct\s+\w+Error/i.test(getRustProjectText(ctx));
    },
    impact: 'medium',
    category: 'rust',
    fix: 'Use `thiserror`, `anyhow`, or explicit error types so Rust errors remain structured and descriptive.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustAsync: {
    id: 120211,
    name: 'Rust async runtime configured',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return /tokio|async-std|smol/i.test(readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i));
    },
    impact: 'medium',
    category: 'rust',
    fix: 'Declare an async runtime such as Tokio or async-std when the Rust project uses asynchronous workflows.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustSerde: {
    id: 120212,
    name: 'Serde serialization configured',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return /\bserde(_json|_yaml)?\b/i.test(readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i));
    },
    impact: 'low',
    category: 'rust',
    fix: 'Add `serde` and related crates when Rust data crosses process, storage, or network boundaries.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustDocComments: {
    id: 120213,
    name: 'Public Rust items have doc comments',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      const files = getMainRustFiles(ctx);
      const exported = files.some(file => /\bpub\s+(fn|struct|enum|trait|mod|const|type)\b/.test(ctx.fileContent(file) || ''));
      if (!exported) return null;
      return files.some(file => /\/\/\/[^\n]*\n\s*pub\s+(fn|struct|enum|trait|mod|const|type)\b/.test(ctx.fileContent(file) || ''));
    },
    impact: 'low',
    category: 'rust',
    fix: 'Add `///` doc comments above public Rust APIs so crates are easier to consume and maintain.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustSecurityAudit: {
    id: 120214,
    name: 'Rust security audit tooling configured',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return /cargo-audit|cargo deny|cargo-deny/i.test(getRustProjectText(ctx));
    },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure `cargo-audit` or `cargo-deny` in CI or project automation to scan Rust dependencies for risk.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustMSRV: {
    id: 120215,
    name: 'Minimum supported Rust version specified',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return /rust-version\s*=/.test(readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i));
    },
    impact: 'medium',
    category: 'rust',
    fix: 'Set `rust-version` in `Cargo.toml` so the project’s MSRV is explicit for contributors and CI.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustWorkspace: {
    id: 120216,
    name: 'Cargo workspace configured for multi-crate projects',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      const cargoFiles = findProjectFiles(ctx, /(^|\/)Cargo\.toml$/i);
      if (cargoFiles.length <= 1) return null;
      return /\[workspace\]/i.test(readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i));
    },
    impact: 'medium',
    category: 'rust',
    fix: 'Add a root Cargo workspace when the Rust repository contains multiple crates.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustBuildScript: {
    id: 120217,
    name: 'Rust build script present when needed',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return hasProjectFile(ctx, /(^|\/)build\.rs$/i);
    },
    impact: 'low',
    category: 'rust',
    fix: 'Use `build.rs` when the project needs generated bindings, codegen, or compile-time environment setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustFeatureFlags: {
    id: 120218,
    name: 'Rust feature flags defined',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return /\[features\]/i.test(readProjectFiles(ctx, /(^|\/)Cargo\.toml$/i));
    },
    impact: 'low',
    category: 'rust',
    fix: 'Define Cargo feature flags when Rust functionality needs optional capabilities or slimmed dependency sets.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustCrossCompilation: {
    id: 120219,
    name: 'Rust cross-compilation targets configured',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return /--target|rustup target add|target\.[\w.-]+|cross build|cross test|cargo zigbuild/i.test(getRustProjectText(ctx));
    },
    impact: 'low',
    category: 'rust',
    fix: 'Configure Rust cross-compilation targets in CI or `.cargo/config.toml` when builds must run across architectures or platforms.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rustContainerized: {
    id: 120220,
    name: 'Rust Dockerfile present',
    check: (ctx) => {
      if (!isRustProject(ctx)) return null;
      return /FROM\s+rust|cargo\s+(build|chef|install|test)/i.test(ctx.fileContent('Dockerfile') || '');
    },
    impact: 'low',
    category: 'rust',
    fix: 'Use a Dockerfile that references Rust or Cargo when the project’s build and release flow is containerized.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === JAVA/SPRING STACK CHECKS (category: 'java') ============
  // ============================================================

  mavenOrGradle: {
    id: 120301,
    name: 'Maven or Gradle build file exists',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return true;
    },
    impact: 'high',
    category: 'java',
    fix: 'Add `pom.xml`, `build.gradle`, or `build.gradle.kts` so the Java build is defined in version control.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaVersion: {
    id: 120302,
    name: 'Java version specified',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /java\.version|maven\.compiler\.(source|target|release)|sourceCompatibility|targetCompatibility|JavaLanguageVersion|toolchain/i.test(getJavaBuildText(ctx)) ||
        hasProjectFile(ctx, /(^|\/)\.java-version$/i);
    },
    impact: 'high',
    category: 'java',
    fix: 'Specify the Java version in Maven or Gradle so compilation and runtime expectations stay explicit.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  springBootDetected: {
    id: 120303,
    name: 'Spring Boot detected',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /spring-boot/i.test(getJavaBuildText(ctx));
    },
    impact: 'medium',
    category: 'java',
    fix: 'Use Spring Boot dependencies when the Java service relies on Spring auto-configuration and conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaTestFramework: {
    id: 120304,
    name: 'Java test framework configured',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /junit|testng|spring-boot-starter-test/i.test(getJavaBuildText(ctx));
    },
    impact: 'high',
    category: 'java',
    fix: 'Add JUnit, TestNG, or Spring Boot test dependencies so Java tests have a standard runner.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaLinter: {
    id: 120305,
    name: 'Java linter configured',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /checkstyle|spotbugs|pmd/i.test(getJavaProjectText(ctx)) ||
        hasProjectFile(ctx, /(^|\/)(checkstyle\.xml|spotbugs.*\.xml|pmd\.xml)$/i);
    },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Checkstyle, SpotBugs, or PMD so Java code quality rules run consistently.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaFormatter: {
    id: 120306,
    name: 'Java formatter configured',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /google-java-format|spotless/i.test(getJavaBuildText(ctx)) ||
        hasProjectFile(ctx, /(^|\/)\.editorconfig$/i);
    },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Spotless, google-java-format, or an `.editorconfig` so Java formatting stays consistent.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaCIConfigured: {
    id: 120307,
    name: 'CI runs Java tests',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /(?:mvn|mvnw)\s+test|(?:gradle|gradlew)\s+test/i.test(getWorkflowContent(ctx));
    },
    impact: 'high',
    category: 'java',
    fix: 'Run `mvn test`, `mvnw test`, `gradle test`, or `gradlew test` in CI so Java changes are validated automatically.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaSecurityScanner: {
    id: 120308,
    name: 'Java security scanner configured',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /dependency-check|snyk|spotbugs-security|findsecbugs/i.test(getJavaProjectText(ctx));
    },
    impact: 'medium',
    category: 'java',
    fix: 'Configure OWASP Dependency-Check, Snyk, or SpotBugs security rules for Java dependency and code scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaDocumentation: {
    id: 120309,
    name: 'Java documentation configured',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      if (/javadoc/i.test(getJavaBuildText(ctx))) return true;
      const files = getMainJavaFiles(ctx);
      const publicTypes = files.some(file => /\bpublic\s+(class|interface|enum|record)\s+[A-Z]\w*/.test(ctx.fileContent(file) || ''));
      if (!publicTypes) return null;
      return files.some(file => /\/\*\*[\s\S]*?\*\/\s*public\s+(class|interface|enum|record)\s+[A-Z]\w*/.test(ctx.fileContent(file) || ''));
    },
    impact: 'low',
    category: 'java',
    fix: 'Generate Javadocs or add doc comments on public Java types so the API remains understandable to contributors.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaProfiles: {
    id: 120310,
    name: 'Java profiles or build variants configured',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /<profiles>|spring\.profiles|@Profile|profiles\s*\{|buildTypes\s*\{|productFlavors\s*\{/i.test(getJavaProjectText(ctx));
    },
    impact: 'low',
    category: 'java',
    fix: 'Use Maven profiles, Spring profiles, or Gradle build variants when Java environments need explicit separation.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaContainerized: {
    id: 120311,
    name: 'Java Dockerfile references Java build/runtime',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /FROM\s+(?:maven|gradle|openjdk|eclipse-temurin|amazoncorretto)|\bjava\b|\bmvn\b|\bgradle\b/i.test(ctx.fileContent('Dockerfile') || '');
    },
    impact: 'low',
    category: 'java',
    fix: 'Use a Dockerfile or build image that references Java, Maven, or Gradle when the application is containerized.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaAPIFramework: {
    id: 120312,
    name: 'Java API framework detected',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /spring-web|spring-boot-starter-web|@RestController|@Controller|javax\.ws\.rs|jakarta\.ws\.rs|micronaut-http|io\.micronaut/i.test(getJavaProjectText(ctx));
    },
    impact: 'low',
    category: 'java',
    fix: 'Use Spring MVC, JAX-RS, or Micronaut conventions explicitly when the Java project exposes an API.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaMigrations: {
    id: 120313,
    name: 'Java database migration tooling present',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /flyway|liquibase/i.test(getJavaProjectText(ctx)) ||
        hasProjectFile(ctx, /(^|\/)(db\/migration|db\/migrations|migrations)\//i) ||
        hasProjectFile(ctx, /(^|\/)(schema|data)\.sql$/i);
    },
    impact: 'medium',
    category: 'java',
    fix: 'Add Flyway, Liquibase, or repo-managed migration files so Java schema changes are repeatable and reviewable.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaMessageQueue: {
    id: 120314,
    name: 'Java message queue integration detected',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /kafka|rabbitmq|amqp|jms|spring-kafka|spring-rabbit/i.test(getJavaProjectText(ctx));
    },
    impact: 'low',
    category: 'java',
    fix: 'Use explicit Kafka, RabbitMQ, or JMS integrations when the Java service relies on asynchronous messaging.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaCaching: {
    id: 120315,
    name: 'Java caching configured',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /redis|ehcache|spring-cache|@Cacheable|caffeine/i.test(getJavaProjectText(ctx));
    },
    impact: 'low',
    category: 'java',
    fix: 'Configure Redis, Ehcache, Caffeine, or Spring Cache when Java services benefit from explicit caching layers.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaMonitoring: {
    id: 120316,
    name: 'Java monitoring dependencies detected',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /actuator|micrometer|prometheus/i.test(getJavaProjectText(ctx));
    },
    impact: 'medium',
    category: 'java',
    fix: 'Add Actuator, Micrometer, or Prometheus integrations so Java services expose health and metrics data.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaLogging: {
    id: 120317,
    name: 'Java logging configured',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /slf4j|logback|log4j/i.test(getJavaProjectText(ctx)) ||
        hasProjectFile(ctx, /(^|\/)(logback.*\.xml|log4j2?.*\.xml)$/i);
    },
    impact: 'medium',
    category: 'java',
    fix: 'Use SLF4J, Logback, or Log4j so Java application logging is explicit and configurable.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaMultiModule: {
    id: 120318,
    name: 'Java multi-module structure configured',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      const buildFiles = findProjectFiles(ctx, /(^|\/)(pom\.xml|build\.gradle|build\.gradle\.kts)$/i);
      if (buildFiles.length <= 1) return null;
      return /<modules>|include\s*\(|include\s+['":]/i.test(getJavaBuildText(ctx));
    },
    impact: 'medium',
    category: 'java',
    fix: 'Configure a root Maven or Gradle multi-module definition when the Java repository contains multiple modules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaDependencyInjection: {
    id: 120319,
    name: 'Java dependency injection pattern present',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return /spring-context|guice|dagger|@Autowired|@Inject|@Bean|@Component|@Service/i.test(getJavaProjectText(ctx));
    },
    impact: 'medium',
    category: 'java',
    fix: 'Use Spring DI, Guice, or Dagger patterns so Java object graphs stay explicit and testable.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  javaPropertyFiles: {
    id: 120320,
    name: 'Java application property files exist',
    check: (ctx) => {
      if (!isJavaProject(ctx)) return null;
      return hasProjectFile(ctx, /(^|\/)application\.(properties|ya?ml)$/i);
    },
    impact: 'low',
    category: 'java',
    fix: 'Add `application.properties` or `application.yml` when the Java service relies on conventional runtime configuration files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === RUBY/RAILS STACK CHECKS (category: 'ruby') =============
  // ============================================================

  rubyGemfileExists: {
    id: 'CL-RB01',
    name: 'Gemfile exists',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'ruby',
    fix: 'Create a Gemfile to manage Ruby dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rubyGemfileLockCommitted: {
    id: 'CL-RB02',
    name: 'Gemfile.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /Gemfile\.lock$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Commit Gemfile.lock to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rubyVersionSpecified: {
    id: 'CL-RB03',
    name: 'Ruby version specified (.ruby-version)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.ruby-version$/.test(f)) || /ruby ['"]~?\d/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Create .ruby-version or specify ruby version in Gemfile.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rubyRubocopConfigured: {
    id: 'CL-RB04',
    name: 'RuboCop configured (.rubocop.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.rubocop\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add .rubocop.yml to configure Ruby style checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rubyTestFrameworkConfigured: {
    id: 'CL-RB05',
    name: 'RSpec or Minitest configured (spec/ or test/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /^spec\/|^test\/|spec_helper\.rb$|test_helper\.rb$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Configure RSpec (spec/) or Minitest (test/) for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rubyRailsCredentialsDocumented: {
    id: 'CL-RB06',
    name: 'Rails credentials documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /credentials|encrypted|master\.key|secret_key_base/i.test(docs); },
    impact: 'high',
    category: 'ruby',
    fix: 'Document Rails credentials management (rails credentials:edit) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rubyMigrationsDocumented: {
    id: 'CL-RB07',
    name: 'Database migrations documented (db/migrate/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /db\/migrate\//.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /migration|migrate|db:migrate|rails db/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document database migration workflow (rails db:migrate) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rubyBundlerAuditConfigured: {
    id: 'CL-RB08',
    name: 'Bundler audit configured',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; return /bundler-audit|bundle.audit/i.test(gf) || ctx.files.some(f => /\.bundler-audit/i.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add bundler-audit gem for dependency vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rubyTypeCheckingConfigured: {
    id: 'CL-RB09',
    name: 'Sorbet/RBS type checking configured (sorbet/ or sig/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /sorbet\/|sig\/|\.rbs$/.test(f)) || /sorbet|tapioca/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'low',
    category: 'ruby',
    fix: 'Configure Sorbet or RBS for type checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rubyRailsRoutesDocumented: {
    id: 'CL-RB10',
    name: 'Rails routes documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/routes\.rb$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /routes|endpoints|api.*path|REST/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document key routes and API endpoints in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rubyBackgroundJobsDocumented: {
    id: 'CL-RB11',
    name: 'Background jobs documented (Sidekiq/GoodJob)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sidekiq|good_job|delayed_job|resque/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /sidekiq|good_job|delayed_job|resque|background.*job|worker|queue/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document background job framework and worker configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rubyRailsEnvConfigsSeparated: {
    id: 'CL-RB12',
    name: 'Rails environment configs separated (config/environments/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /config\/environments\//.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Ensure config/environments/ has separate files for development, test, and production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rubyAssetPipelineDocumented: {
    id: 'CL-RB13',
    name: 'Asset pipeline documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sprockets|propshaft|webpacker|jsbundling|cssbundling/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /asset|sprockets|propshaft|webpacker|jsbundling|cssbundling|esbuild|vite/i.test(docs); },
    impact: 'low',
    category: 'ruby',
    fix: 'Document asset pipeline configuration (Sprockets, Propshaft, or JS/CSS bundling).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rubyMasterKeyInGitignore: {
    id: 'CL-RB14',
    name: 'Rails master.key in .gitignore',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const gi = ctx.fileContent('.gitignore') || ''; return /master\.key/i.test(gi); },
    impact: 'critical',
    category: 'ruby',
    fix: 'Add config/master.key to .gitignore to prevent secret leakage.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  rubyTestDataFactories: {
    id: 'CL-RB15',
    name: 'Factory Bot/fixtures for test data (spec/factories/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /spec\/factories\/|test\/fixtures\//.test(f)) || /factory_bot|fabrication/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Configure Factory Bot (spec/factories/) or fixtures (test/fixtures/) for test data.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === .NET/C# STACK CHECKS (category: 'dotnet') ==============
  // ============================================================

  dotnetProjectExists: {
    id: 'CL-DN01',
    name: '.csproj or .sln exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'dotnet',
    fix: 'Ensure .csproj or .sln file exists for .NET projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  dotnetVersionSpecified: {
    id: 'CL-DN02',
    name: '.NET version specified (global.json or TargetFramework)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /global\.json$/.test(f)) || ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /TargetFramework/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create global.json or ensure TargetFramework is set in .csproj.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  dotnetPackagesLock: {
    id: 'CL-DN03',
    name: 'NuGet packages lock (packages.lock.json)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /packages\.lock\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Enable NuGet lock file (packages.lock.json) for reproducible restores.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  dotnetTestDocumented: {
    id: 'CL-DN04',
    name: 'dotnet test documented',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /dotnet test|xunit|nunit|mstest/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document how to run tests with dotnet test in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  dotnetEditorConfigExists: {
    id: 'CL-DN05',
    name: 'EditorConfig configured (.editorconfig)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.editorconfig$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add .editorconfig for consistent code style across the team.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  dotnetRoslynAnalyzers: {
    id: 'CL-DN06',
    name: 'Roslyn analyzers configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Analyzer|StyleCop|SonarAnalyzer|Microsoft\.CodeAnalysis/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Roslyn analyzers (StyleCop.Analyzers, Microsoft.CodeAnalysis) to the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  dotnetAppsettingsExists: {
    id: 'CL-DN07',
    name: 'appsettings.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /appsettings\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create appsettings.json for application configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  dotnetUserSecretsDocumented: {
    id: 'CL-DN08',
    name: 'User secrets configured in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /user.?secrets|dotnet secrets|Secret Manager/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document user secrets management (dotnet user-secrets) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  dotnetEfMigrations: {
    id: 'CL-DN09',
    name: 'Entity Framework migrations (Migrations/ directory)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /Migrations\//.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Document Entity Framework migration workflow (dotnet ef migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  dotnetHealthChecks: {
    id: 'CL-DN10',
    name: 'Health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /AddHealthChecks|MapHealthChecks|IHealthCheck/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure health checks with AddHealthChecks() and MapHealthChecks().',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  dotnetSwaggerConfigured: {
    id: 'CL-DN11',
    name: 'Swagger/OpenAPI configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$|.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Swashbuckle|AddSwaggerGen|UseSwagger|NSwag|AddOpenApi/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure Swagger/OpenAPI with Swashbuckle or NSwag.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  dotnetNoConnectionStringsInConfig: {
    id: 'CL-DN12',
    name: 'No connection strings in appsettings.json',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const settings = ctx.fileContent('appsettings.json') || ''; if (!settings) return null; return !/Server=.*Password=|Data Source=.*Password=/i.test(settings); },
    impact: 'critical',
    category: 'dotnet',
    fix: 'Move connection strings with passwords to user secrets or environment variables.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  dotnetDockerSupport: {
    id: 'CL-DN13',
    name: 'Docker support configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; return /dotnet|aspnet|sdk/i.test(df); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Dockerfile with official .NET SDK/ASP.NET base images.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  dotnetTestProjectSeparate: {
    id: 'CL-DN14',
    name: 'Unit test project separate (.Tests.csproj)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.Tests?\.csproj$|Tests?\/.*\.csproj$/.test(f)); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Create separate test project (e.g., MyApp.Tests.csproj) for unit tests.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  dotnetGlobalUsingsDocumented: {
    id: 'CL-DN15',
    name: 'GlobalUsings documented',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /GlobalUsings\.cs$|Usings\.cs$/.test(f)) || ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /ImplicitUsings/i.test(c); }); },
    impact: 'low',
    category: 'dotnet',
    fix: 'Document global using directives in GlobalUsings.cs or enable ImplicitUsings in .csproj.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === PHP/LARAVEL STACK CHECKS (category: 'php') ==============
  // ============================================================

  phpComposerJsonExists: {
    id: 'CL-PHP01',
    name: 'composer.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'php',
    fix: 'Create composer.json to manage PHP dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  phpComposerLockCommitted: {
    id: 'CL-PHP02',
    name: 'composer.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /composer\.lock$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Commit composer.lock to version control for reproducible installs.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  phpVersionSpecified: {
    id: 'CL-PHP03',
    name: 'PHP version specified (composer.json require.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"php"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Specify PHP version requirement in composer.json require section.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  phpStaticAnalysisConfigured: {
    id: 'CL-PHP04',
    name: 'PHPStan/Psalm configured (phpstan.neon)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpstan\.neon$|phpstan\.neon\.dist$|psalm\.xml$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Configure PHPStan (phpstan.neon) or Psalm (psalm.xml) for static analysis.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  phpCsFixerConfigured: {
    id: 'CL-PHP05',
    name: 'PHP CS Fixer configured (.php-cs-fixer.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /\.php-cs-fixer\.php$|\.php-cs-fixer\.dist\.php$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Add .php-cs-fixer.php for consistent code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  phpUnitConfigured: {
    id: 'CL-PHP06',
    name: 'PHPUnit configured (phpunit.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpunit\.xml$|phpunit\.xml\.dist$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Configure PHPUnit with phpunit.xml for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  phpLaravelEnvExample: {
    id: 'CL-PHP07',
    name: 'Laravel .env.example exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /\.env\.example$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Create .env.example with all required environment variables documented.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  phpLaravelAppKeyNotCommitted: {
    id: 'CL-PHP08',
    name: 'Laravel APP_KEY not committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const env = ctx.fileContent('.env') || ''; if (!env) return null; return !/APP_KEY=base64:[A-Za-z0-9+/=]{30,}/i.test(env); },
    impact: 'critical',
    category: 'php',
    fix: 'Ensure .env with APP_KEY is in .gitignore — never commit application keys.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  phpLaravelMigrationsExist: {
    id: 'CL-PHP09',
    name: 'Laravel migrations exist (database/migrations/)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /database\/migrations\//.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Create database migrations in database/migrations/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  phpArtisanCommandsDocumented: {
    id: 'CL-PHP10',
    name: 'Artisan commands documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /artisan|php artisan|make:model|make:controller|migrate/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document key Artisan commands (migrate, seed, make:*) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  phpQueueWorkerDocumented: {
    id: 'CL-PHP11',
    name: 'Queue worker documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; if (!/horizon|queue/i.test(cj) && !ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /queue|horizon|worker|job|dispatch/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document queue worker setup (php artisan queue:work, Horizon).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  phpLaravelPintConfigured: {
    id: 'CL-PHP12',
    name: 'Laravel Pint configured (pint.json)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /pint\.json$/.test(f)) || /laravel\/pint/i.test(ctx.fileContent('composer.json') || ''); },
    impact: 'low',
    category: 'php',
    fix: 'Configure Laravel Pint (pint.json) for code style enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  phpAssetBundlingDocumented: {
    id: 'CL-PHP13',
    name: 'Vite/Mix asset bundling documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /vite\.config\.|webpack\.mix\.js$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /vite|mix|asset|npm run dev|npm run build/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document asset bundling setup (Vite or Mix) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  phpConfigCachingDocumented: {
    id: 'CL-PHP14',
    name: 'Laravel config caching documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /config:cache|config:clear|route:cache|optimize/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document config/route caching strategy (php artisan config:cache) for production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  phpComposerScriptsDefined: {
    id: 'CL-PHP15',
    name: 'Composer scripts defined',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"scripts"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Define composer scripts for common tasks (test, lint, analyze) in composer.json.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // --- ECC-inspired checks ---

  hasLlmsTxt: {
    id: 110001,
    name: 'Has /llms.txt or llms.txt for LLM context',
    check: (ctx) => {
      return ctx.files.some(f => /^(public\/)?llms\.txt$/i.test(f) || /^llms-full\.txt$/i.test(f));
    },
    impact: 'low', rating: 3, category: 'features',
    fix: 'Add llms.txt to provide LLM-friendly project context. See llmstxt.org for the standard.',
    template: null,
    confidence: 0.8,
  },

  mcpBudgetHealthy: {
    id: 110002,
    name: 'MCP budget not over-provisioned (≤10 servers, ≤80 tools)',
    check: (ctx) => {
      const settings = ctx.jsonFile('.claude/settings.json') || {};
      const mcp = ctx.jsonFile('.mcp.json') || {};
      const mcpServers = Object.keys(settings.mcpServers || {}).length + Object.keys(mcp.mcpServers || {}).length;
      if (mcpServers === 0) return null;
      return mcpServers <= 10;
    },
    impact: 'medium', rating: 4, category: 'tools',
    fix: 'Too many MCP servers (>10) degrades performance. Remove unused servers or consolidate.',
    template: null,
    confidence: 0.9,
  },

  hookExitCodesDefined: {
    id: 110003,
    name: 'Hook scripts handle exit codes correctly',
    check: (ctx) => {
      const hookContents = getClaudeHookContents(ctx);
      if (hookContents.length === 0) return null;
      return hookContents.some(content => /process\.exit|exit\s+[012]|sys\.exit|return\s+[012]/i.test(content));
    },
    impact: 'low', rating: 3, category: 'governance',
    fix: 'Hooks should use explicit exit codes: 0=success, 1=warning, 2=block. See Claude Code docs.',
    template: null,
    confidence: 0.7,
  },

  loopSafetyBoundaries: {
    id: 110004,
    name: 'Loop safety boundaries configured',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      const settings = ctx.fileContent('.claude/settings.json') || '';
      const hookContents = getClaudeHookContents(ctx).join('\n');
      const loopSafetyConfig = [md, settings, hookContents].filter(Boolean).join('\n');

      return /max[-_ ]?turns|maxTurns|max[-_ ]?tokens|maxTokens|loop(?:[-_ ]?(?:limit|limits|safety|guard|budget|boundary|boundaries))|iteration(?:[-_ ]?(?:limit|limits|guard|budget|cap|caps|count|max(?:imum)?))/i.test(loopSafetyConfig);
    },
    impact: 'medium', rating: 4, category: 'governance',
    fix: 'Document loop safety limits such as maxTurns, maxTokens, or iteration caps in CLAUDE.md, settings, or hook guards.',
    template: null,
    confidence: 0.8,
  },

  consistencyPassAtK: {
    id: 110005,
    name: 'Consistency/pass@k evaluation mentioned',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      const configPaths = [
        'package.json',
        'jest.config.js',
        'jest.config.cjs',
        'jest.config.mjs',
        'vitest.config.js',
        'vitest.config.ts',
        'playwright.config.js',
        'playwright.config.ts',
        'pytest.ini',
        'pyproject.toml',
        'tox.ini',
        '.github/workflows/ci.yml',
        '.github/workflows/ci.yaml',
        '.github/workflows/test.yml',
        '.github/workflows/test.yaml',
      ];
      const configContent = configPaths
        .map(file => ctx.fileContent(file) || '')
        .filter(Boolean)
        .join('\n');

      return /pass@k|consistency|multiple runs?|reproducib/i.test(`${md}\n${configContent}`);
    },
    impact: 'low', rating: 3, category: 'quality',
    fix: 'Mention pass@k or consistency testing in CLAUDE.md or test configuration so repeated-run quality evaluation is explicit.',
    template: null,
    confidence: 0.7,
  },

  instinctToSkillProgression: {
    id: 110006,
    name: 'Instinct-to-skill progression documented',
    check: (ctx) => {
      const md = ctx.claudeMdContent() || '';
      return /progressive learning|instinct[- ]to[- ]skill|instinct.{0,40}skill|skill.{0,40}instinct|graduated|phased approach/i.test(md);
    },
    impact: 'low', rating: 3, category: 'features',
    fix: 'Document a progressive learning path that turns repeated instincts into reusable skills or phased practices.',
    template: null,
    confidence: 0.7,
  },


  // === FLUTTER STACK CHECKS (category: 'flutter') ===============
  // ============================================================

  pubspecExists: {
    id: 120401,
    name: 'pubspec.yaml exists',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      return true;
    },
    impact: 'high',
    category: 'flutter',
    fix: 'Add a `pubspec.yaml` manifest so Flutter/Dart dependencies and project metadata are tracked.',
    confidence: 0.7,
  },

  flutterAnalysis: {
    id: 120402,
    name: 'Flutter analysis options configured',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      return ctx.files.some(f => /analysis_options\.yaml$/i.test(f));
    },
    impact: 'medium',
    category: 'flutter',
    fix: 'Add analysis_options.yaml for Dart/Flutter linting rules.',
    confidence: 0.8,
  },

  flutterTestDir: {
    id: 120403,
    name: 'Flutter tests exist',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      return hasProjectFile(ctx, /(^|\/)test\/.*_test\.dart$/i);
    },
    impact: 'high',
    category: 'flutter',
    fix: 'Add Flutter widget or unit tests in a `test/` directory with `_test.dart` suffix.',
    confidence: 0.8,
  },

  flutterLintRules: {
    id: 120404,
    name: 'Flutter lint package configured',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
      return /flutter_lints|very_good_analysis/i.test(pubspec);
    },
    impact: 'medium',
    category: 'flutter',
    fix: 'Add `flutter_lints` or `very_good_analysis` to pubspec.yaml dev_dependencies for consistent linting.',
    confidence: 0.8,
  },

  flutterPlatformDirs: {
    id: 120405,
    name: 'Flutter platform directories present',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      return hasProjectFile(ctx, /^android\//i) && hasProjectFile(ctx, /^ios\//i);
    },
    impact: 'medium',
    category: 'flutter',
    fix: 'Run `flutter create .` to generate `android/` and `ios/` platform directories.',
    confidence: 0.7,
  },

  flutterWebSupport: {
    id: 120406,
    name: 'Flutter web support enabled',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      return hasProjectFile(ctx, /^web\//i);
    },
    impact: 'low',
    category: 'flutter',
    fix: 'Run `flutter create --platforms=web .` to add web support.',
    confidence: 0.7,
  },

  flutterL10n: {
    id: 120407,
    name: 'Flutter localization configured',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
      return hasProjectFile(ctx, /(^|\/)l10n\.yaml$/i) || /\bintl\b/i.test(pubspec);
    },
    impact: 'medium',
    category: 'flutter',
    fix: 'Add `l10n.yaml` or the `intl` package to support localization and internationalization.',
    confidence: 0.7,
  },

  flutterStateManagement: {
    id: 120408,
    name: 'Flutter state management configured',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
      return /riverpod|flutter_bloc|\bbloc\b|\bprovider\b/i.test(pubspec);
    },
    impact: 'medium',
    category: 'flutter',
    fix: 'Add a state management solution such as `riverpod`, `bloc`, or `provider` to pubspec.yaml.',
    confidence: 0.7,
  },

  flutterNavigation: {
    id: 120409,
    name: 'Flutter routing configured',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
      return /go_router|auto_route/i.test(pubspec);
    },
    impact: 'medium',
    category: 'flutter',
    fix: 'Add `go_router` or `auto_route` for declarative, type-safe Flutter routing.',
    confidence: 0.7,
  },

  flutterCIConfigured: {
    id: 120410,
    name: 'CI runs flutter test',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      return /flutter test(\s|$)/i.test(getWorkflowContent(ctx));
    },
    impact: 'high',
    category: 'flutter',
    fix: 'Add `flutter test` to your CI workflow so tests run automatically on every change.',
    confidence: 0.8,
  },

  flutterCodeGen: {
    id: 120411,
    name: 'Flutter code generation configured',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
      return /build_runner|freezed/i.test(pubspec);
    },
    impact: 'medium',
    category: 'flutter',
    fix: 'Add `build_runner` and/or `freezed` to pubspec.yaml for code generation support.',
    confidence: 0.7,
  },

  flutterFirebase: {
    id: 120412,
    name: 'Flutter Firebase integration',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
      return /firebase/i.test(pubspec) || hasProjectFile(ctx, /(^|\/)firebase_options\.dart$/i);
    },
    impact: 'medium',
    category: 'flutter',
    fix: 'Add Firebase packages to pubspec.yaml and run `flutterfire configure` to generate firebase_options.dart.',
    confidence: 0.7,
  },

  flutterAssets: {
    id: 120413,
    name: 'Flutter assets configured',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
      return /\bassets\s*:/i.test(pubspec);
    },
    impact: 'low',
    category: 'flutter',
    fix: 'Add an `assets:` section in pubspec.yaml to declare images, fonts, and other bundled resources.',
    confidence: 0.7,
  },

  flutterFlavors: {
    id: 120414,
    name: 'Flutter flavors configured',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      const pubspec = readProjectFiles(ctx, /(^|\/)pubspec\.yaml$/i);
      return /\bflavors?\b/i.test(pubspec) || /--flavor/i.test(getWorkflowContent(ctx));
    },
    impact: 'low',
    category: 'flutter',
    fix: 'Configure Flutter flavors for environment-specific builds (dev, staging, production).',
    confidence: 0.7,
  },

  flutterContainerized: {
    id: 120415,
    name: 'Flutter Dockerfile present',
    check: (ctx) => {
      if (!isFlutterProject(ctx)) return null;
      const dockerfiles = readProjectFiles(ctx, /(^|\/)Dockerfile/i);
      return /flutter|dart/i.test(dockerfiles);
    },
    impact: 'low',
    category: 'flutter',
    fix: 'Add a Dockerfile that includes the Flutter or Dart SDK for containerized builds.',
    confidence: 0.7,
  },

  // === SWIFT STACK CHECKS (category: 'swift') ==================
  // ============================================================

  swiftPackageExists: {
    id: 120501,
    name: 'Swift package or Xcode project exists',
    check: (ctx) => {
      if (!isSwiftProject(ctx)) return null;
      return true;
    },
    impact: 'high',
    category: 'swift',
    fix: 'Add a `Package.swift` or `.xcodeproj` to define your Swift project structure.',
    confidence: 0.7,
  },

  swiftLinter: {
    id: 120502,
    name: 'SwiftLint configured',
    check: (ctx) => {
      if (!isSwiftProject(ctx)) return null;
      return hasProjectFile(ctx, /(^|\/)(\.swiftlint\.yml|\.swiftlint\.yaml)$/i);
    },
    impact: 'medium',
    category: 'swift',
    fix: 'Add `.swiftlint.yml` to enforce Swift coding conventions.',
    confidence: 0.8,
  },

  swiftTests: {
    id: 120503,
    name: 'Swift tests exist',
    check: (ctx) => {
      if (!isSwiftProject(ctx)) return null;
      return hasProjectFile(ctx, /(^|\/)Tests\//i) ||
        findProjectFiles(ctx, /\.swift$/i).some(f => /XCTest/i.test(ctx.fileContent(f) || ''));
    },
    impact: 'high',
    category: 'swift',
    fix: 'Add Swift tests in a `Tests/` directory using XCTest.',
    confidence: 0.8,
  },

  swiftFormatter: {
    id: 120504,
    name: 'SwiftFormat configured',
    check: (ctx) => {
      if (!isSwiftProject(ctx)) return null;
      return hasProjectFile(ctx, /(^|\/)\.swiftformat$/i);
    },
    impact: 'medium',
    category: 'swift',
    fix: 'Add `.swiftformat` to enforce consistent Swift formatting.',
    confidence: 0.7,
  },

  swiftCIConfigured: {
    id: 120505,
    name: 'CI runs swift test or xcodebuild',
    check: (ctx) => {
      if (!isSwiftProject(ctx)) return null;
      return /swift test|xcodebuild(\s|$)/i.test(getWorkflowContent(ctx));
    },
    impact: 'high',
    category: 'swift',
    fix: 'Add `swift test` or `xcodebuild test` to your CI workflow.',
    confidence: 0.8,
  },

  swiftDocComments: {
    id: 120506,
    name: 'Swift doc comments present',
    check: (ctx) => {
      if (!isSwiftProject(ctx)) return null;
      const swiftFiles = findProjectFiles(ctx, /\.swift$/i);
      if (swiftFiles.length === 0) return null;
      return swiftFiles.some(f => /\/\/\//.test(ctx.fileContent(f) || ''));
    },
    impact: 'low',
    category: 'swift',
    fix: 'Add `///` documentation comments to public Swift APIs.',
    confidence: 0.7,
  },

  swiftSPM: {
    id: 120507,
    name: 'Swift Package Manager used',
    check: (ctx) => {
      if (!isSwiftProject(ctx)) return null;
      return hasProjectFile(ctx, /(^|\/)Package\.swift$/i);
    },
    impact: 'medium',
    category: 'swift',
    fix: 'Add `Package.swift` to use Swift Package Manager for dependency management.',
    confidence: 0.7,
  },

  swiftMinVersion: {
    id: 120508,
    name: 'Swift tools version specified',
    check: (ctx) => {
      if (!isSwiftProject(ctx)) return null;
      const pkg = readProjectFiles(ctx, /(^|\/)Package\.swift$/i);
      return /swift-tools-version/i.test(pkg);
    },
    impact: 'medium',
    category: 'swift',
    fix: 'Add `// swift-tools-version:5.9` (or appropriate version) at the top of Package.swift.',
    confidence: 0.8,
  },

  swiftAccessControl: {
    id: 120509,
    name: 'Swift access control used',
    check: (ctx) => {
      if (!isSwiftProject(ctx)) return null;
      const swiftFiles = findProjectFiles(ctx, /\.swift$/i);
      if (swiftFiles.length === 0) return null;
      return swiftFiles.some(f => /\b(public|internal)\b/.test(ctx.fileContent(f) || ''));
    },
    impact: 'low',
    category: 'swift',
    fix: 'Use `public`/`internal` access control in Swift files to define clear API boundaries.',
    confidence: 0.7,
  },

  swiftConcurrency: {
    id: 120510,
    name: 'Swift concurrency used',
    check: (ctx) => {
      if (!isSwiftProject(ctx)) return null;
      const swiftFiles = findProjectFiles(ctx, /\.swift$/i);
      if (swiftFiles.length === 0) return null;
      return swiftFiles.some(f => /\basync\b.*\bawait\b|\bawait\b/s.test(ctx.fileContent(f) || ''));
    },
    impact: 'low',
    category: 'swift',
    fix: 'Adopt Swift structured concurrency with `async`/`await` for modern asynchronous code.',
    confidence: 0.7,
  },

  // === KOTLIN STACK CHECKS (category: 'kotlin') ================
  // ============================================================

  kotlinGradlePlugin: {
    id: 120601,
    name: 'Kotlin Gradle plugin configured',
    check: (ctx) => {
      if (!isKotlinProject(ctx)) return null;
      const gradle = readProjectFiles(ctx, /(^|\/)(build\.gradle\.kts|build\.gradle)$/i);
      return /kotlin\(|org\.jetbrains\.kotlin/i.test(gradle);
    },
    impact: 'high',
    category: 'kotlin',
    fix: 'Apply the Kotlin Gradle plugin in build.gradle.kts to enable Kotlin compilation.',
    confidence: 0.8,
  },

  kotlinVersion: {
    id: 120602,
    name: 'Kotlin version specified',
    check: (ctx) => {
      if (!isKotlinProject(ctx)) return null;
      const gradle = readProjectFiles(ctx, /(^|\/)(build\.gradle\.kts|build\.gradle|gradle\.properties)$/i);
      return /kotlinVersion|kotlin_version|org\.jetbrains\.kotlin.*\d+\.\d+/i.test(gradle);
    },
    impact: 'high',
    category: 'kotlin',
    fix: 'Pin the Kotlin version in gradle.properties or build.gradle.kts for reproducible builds.',
    confidence: 0.8,
  },

  kotlinLinter: {
    id: 120603,
    name: 'Kotlin linter configured',
    check: (ctx) => {
      if (!isKotlinProject(ctx)) return null;
      const gradle = readProjectFiles(ctx, /(^|\/)(build\.gradle\.kts|build\.gradle)$/i);
      return /ktlint|detekt/i.test(gradle) ||
        hasProjectFile(ctx, /(^|\/)(\.editorconfig|detekt\.yml|detekt\.yaml)$/i);
    },
    impact: 'medium',
    category: 'kotlin',
    fix: 'Add `ktlint` or `detekt` to enforce Kotlin code style and static analysis.',
    confidence: 0.8,
  },

  kotlinTests: {
    id: 120604,
    name: 'Kotlin tests exist',
    check: (ctx) => {
      if (!isKotlinProject(ctx)) return null;
      return hasProjectFile(ctx, /(^|\/)src\/test\/.*\.kt$/i) ||
        hasProjectFile(ctx, /(^|\/)test\/.*\.kt$/i);
    },
    impact: 'high',
    category: 'kotlin',
    fix: 'Add Kotlin tests in `src/test/` using JUnit or KotlinTest.',
    confidence: 0.8,
  },

  kotlinCoroutines: {
    id: 120605,
    name: 'Kotlin Coroutines in dependencies',
    check: (ctx) => {
      if (!isKotlinProject(ctx)) return null;
      const gradle = readProjectFiles(ctx, /(^|\/)(build\.gradle\.kts|build\.gradle)$/i);
      return /kotlinx[.-]coroutines/i.test(gradle);
    },
    impact: 'medium',
    category: 'kotlin',
    fix: 'Add `kotlinx-coroutines-core` to dependencies for structured concurrency.',
    confidence: 0.7,
  },

  kotlinSerialization: {
    id: 120606,
    name: 'Kotlin serialization configured',
    check: (ctx) => {
      if (!isKotlinProject(ctx)) return null;
      const gradle = readProjectFiles(ctx, /(^|\/)(build\.gradle\.kts|build\.gradle)$/i);
      return /kotlinx[.-]serialization/i.test(gradle);
    },
    impact: 'medium',
    category: 'kotlin',
    fix: 'Add `kotlinx.serialization` for type-safe, multiplatform serialization.',
    confidence: 0.7,
  },

  kotlinCompose: {
    id: 120607,
    name: 'Jetpack Compose configured',
    check: (ctx) => {
      if (!isKotlinProject(ctx)) return null;
      const gradle = readProjectFiles(ctx, /(^|\/)(build\.gradle\.kts|build\.gradle)$/i);
      return /compose/i.test(gradle);
    },
    impact: 'medium',
    category: 'kotlin',
    fix: 'Enable Jetpack Compose in build.gradle.kts for modern declarative Android UI.',
    confidence: 0.7,
  },

  kotlinCIConfigured: {
    id: 120608,
    name: 'CI runs Kotlin tests',
    check: (ctx) => {
      if (!isKotlinProject(ctx)) return null;
      return /gradle.*test|gradlew.*test/i.test(getWorkflowContent(ctx));
    },
    impact: 'high',
    category: 'kotlin',
    fix: 'Add `./gradlew test` to your CI workflow so Kotlin tests run automatically.',
    confidence: 0.8,
  },

  kotlinMultiplatform: {
    id: 120609,
    name: 'Kotlin Multiplatform configured',
    check: (ctx) => {
      if (!isKotlinProject(ctx)) return null;
      const gradle = readProjectFiles(ctx, /(^|\/)(build\.gradle\.kts|build\.gradle)$/i);
      return /multiplatform/i.test(gradle);
    },
    impact: 'medium',
    category: 'kotlin',
    fix: 'Apply the `kotlin-multiplatform` Gradle plugin to share code across JVM, iOS, JS, and Native targets.',
    confidence: 0.7,
  },

  kotlinDocComments: {
    id: 120610,
    name: 'KDoc comments present',
    check: (ctx) => {
      if (!isKotlinProject(ctx)) return null;
      const ktFiles = findProjectFiles(ctx, /\.kt$/i);
      if (ktFiles.length === 0) return null;
      return ktFiles.some(f => /\/\*\*/.test(ctx.fileContent(f) || ''));
    },
    impact: 'low',
    category: 'kotlin',
    fix: 'Add KDoc comments (`/** ... */`) to public Kotlin APIs for documentation generation.',
    confidence: 0.7,
  },

  // ── MC11: WebSocket / Real-time ──────────────────────────────────────

  websocketLib: {
    id: 130201,
    name: 'WebSocket library configured',
    check: (ctx) => {
      const deps = ctx.fileContent('package.json') || '';
      const pyDeps = ctx.fileContent('requirements.txt') || '';
      const goDeps = ctx.fileContent('go.mod') || '';
      return /socket\.io|"ws"|sockjs|@nestjs\/websockets|phoenix|channels/i.test(deps) ||
             /websockets|channels|tornado/i.test(pyDeps) ||
             /gorilla\/websocket|nhooyr\.io\/websocket/i.test(goDeps) || null;
    },
    impact: 'low',
    category: 'realtime',
    fix: 'Add a WebSocket library for real-time communication if your app needs live updates.',
    confidence: 0.7,
  },

  sseEndpoint: {
    id: 130202,
    name: 'Server-Sent Events patterns detected',
    check: (ctx) => {
      const codeFiles = findProjectFiles(ctx, /\.(js|ts|jsx|tsx|py|go|rb)$/i);
      if (codeFiles.length === 0) return null;
      return codeFiles.some(f => {
        const content = ctx.fileContent(f) || '';
        return /EventSource|text\/event-stream|SSE/i.test(content);
      }) || null;
    },
    impact: 'low',
    category: 'realtime',
    fix: 'Consider Server-Sent Events (SSE) for server-to-client streaming when full duplex is not needed.',
    confidence: 0.7,
  },

  realtimeDatabase: {
    id: 130203,
    name: 'Real-time database configured',
    check: (ctx) => {
      const deps = ctx.fileContent('package.json') || '';
      const pyDeps = ctx.fileContent('requirements.txt') || '';
      return /firebase-admin|supabase|convex|pusher/i.test(deps) ||
             /firebase-admin|supabase|pusher/i.test(pyDeps) || null;
    },
    impact: 'low',
    category: 'realtime',
    fix: 'Add a real-time database (Firebase, Supabase, Convex) for live data synchronization.',
    confidence: 0.7,
  },

  pubsubPattern: {
    id: 130204,
    name: 'Pub/sub messaging configured',
    check: (ctx) => {
      const deps = ctx.fileContent('package.json') || '';
      const pyDeps = ctx.fileContent('requirements.txt') || '';
      const goDeps = ctx.fileContent('go.mod') || '';
      return /ioredis|redis|nats|kafkajs|amqplib|bullmq/i.test(deps) ||
             /redis|nats-py|kafka-python|pika|celery/i.test(pyDeps) ||
             /go-redis|nats\.go|sarama|amqp091-go/i.test(goDeps) || null;
    },
    impact: 'low',
    category: 'realtime',
    fix: 'Add a pub/sub messaging system (Redis, NATS, Kafka, RabbitMQ) for decoupled real-time communication.',
    confidence: 0.7,
  },

  realtimeAuth: {
    id: 130205,
    name: 'WebSocket authentication patterns present',
    check: (ctx) => {
      const codeFiles = findProjectFiles(ctx, /\.(js|ts|jsx|tsx|py|go)$/i);
      if (codeFiles.length === 0) return null;
      return codeFiles.some(f => {
        const content = ctx.fileContent(f) || '';
        return /ws.*auth|socket.*token|connection.*auth|handleConnection.*jwt|on.*connect.*verify/i.test(content);
      }) || null;
    },
    impact: 'low',
    category: 'realtime',
    fix: 'Add authentication to WebSocket connections — validate tokens on connect to prevent unauthorized access.',
    confidence: 0.7,
  },

  // ── MC12: GraphQL ────────────────────────────────────────────────────

  graphqlSchema: {
    id: 130206,
    name: 'GraphQL schema defined',
    check: (ctx) => {
      const deps = ctx.fileContent('package.json') || '';
      const pyDeps = ctx.fileContent('requirements.txt') || '';
      if (!/graphql|apollo|@nestjs\/graphql|type-graphql/i.test(deps) &&
          !/graphene|ariadne|strawberry/i.test(pyDeps) &&
          !hasProjectFile(ctx, /\.graphql$/i)) return null;
      const schemaFiles = findProjectFiles(ctx, /\.(graphql|gql)$/i);
      if (schemaFiles.length > 0) return true;
      const codeFiles = findProjectFiles(ctx, /\.(js|ts|py)$/i);
      return codeFiles.some(f => {
        const content = ctx.fileContent(f) || '';
        return /buildSchema|makeExecutableSchema|typeDefs|@ObjectType|type Query/i.test(content);
      }) || false;
    },
    impact: 'low',
    category: 'graphql',
    fix: 'Define a GraphQL schema using .graphql files or schema-first/code-first approach.',
    confidence: 0.7,
  },

  graphqlResolvers: {
    id: 130207,
    name: 'GraphQL resolvers implemented',
    check: (ctx) => {
      const deps = ctx.fileContent('package.json') || '';
      const pyDeps = ctx.fileContent('requirements.txt') || '';
      if (!/graphql|apollo|@nestjs\/graphql|type-graphql/i.test(deps) &&
          !/graphene|ariadne|strawberry/i.test(pyDeps) &&
          !hasProjectFile(ctx, /\.graphql$/i)) return null;
      const codeFiles = findProjectFiles(ctx, /\.(js|ts|py)$/i);
      return codeFiles.some(f => {
        const content = ctx.fileContent(f) || '';
        return /@Resolver|@Query|@Mutation|resolvers|resolve_/i.test(content) ||
               /resolver/i.test(f);
      }) || false;
    },
    impact: 'low',
    category: 'graphql',
    fix: 'Implement GraphQL resolvers to handle queries, mutations, and field resolution.',
    confidence: 0.7,
  },

  graphqlCodegen: {
    id: 130208,
    name: 'GraphQL code generation configured',
    check: (ctx) => {
      const deps = ctx.fileContent('package.json') || '';
      const pyDeps = ctx.fileContent('requirements.txt') || '';
      if (!/graphql|apollo|@nestjs\/graphql|type-graphql/i.test(deps) &&
          !/graphene|ariadne|strawberry/i.test(pyDeps) &&
          !hasProjectFile(ctx, /\.graphql$/i)) return null;
      return /@graphql-codegen|graphql-let|graphql-code-generator/i.test(deps) || false;
    },
    impact: 'low',
    category: 'graphql',
    fix: 'Add @graphql-codegen for type-safe GraphQL operations and automatic TypeScript type generation.',
    confidence: 0.7,
  },

  graphqlNPlusOne: {
    id: 130209,
    name: 'GraphQL N+1 prevention (DataLoader)',
    check: (ctx) => {
      const deps = ctx.fileContent('package.json') || '';
      const pyDeps = ctx.fileContent('requirements.txt') || '';
      if (!/graphql|apollo|@nestjs\/graphql|type-graphql/i.test(deps) &&
          !/graphene|ariadne|strawberry/i.test(pyDeps) &&
          !hasProjectFile(ctx, /\.graphql$/i)) return null;
      const codeFiles = findProjectFiles(ctx, /\.(js|ts|py)$/i);
      return /dataloader/i.test(deps) ||
             /aiodataloader|promise/i.test(pyDeps) ||
             codeFiles.some(f => /dataloader|batch.*load|DataLoader/i.test(ctx.fileContent(f) || '')) || false;
    },
    impact: 'low',
    category: 'graphql',
    fix: 'Use DataLoader or batch loading patterns to prevent N+1 query problems in GraphQL resolvers.',
    confidence: 0.7,
  },

  graphqlSubscriptions: {
    id: 130210,
    name: 'GraphQL subscriptions configured',
    check: (ctx) => {
      const deps = ctx.fileContent('package.json') || '';
      const pyDeps = ctx.fileContent('requirements.txt') || '';
      if (!/graphql|apollo|@nestjs\/graphql|type-graphql/i.test(deps) &&
          !/graphene|ariadne|strawberry/i.test(pyDeps) &&
          !hasProjectFile(ctx, /\.graphql$/i)) return null;
      return /subscriptions-transport-ws|graphql-ws/i.test(deps) ||
             findProjectFiles(ctx, /\.(js|ts|py)$/i).some(f => {
               const content = ctx.fileContent(f) || '';
               return /@Subscription|PubSub|subscription\s+\w+/i.test(content);
             }) || false;
    },
    impact: 'low',
    category: 'graphql',
    fix: 'Configure GraphQL subscriptions with graphql-ws for real-time data pushed to clients.',
    confidence: 0.7,
  },

  // ============================================================
  // === MC1: OBSERVABILITY (category: 'observability') =========
  // ============================================================

  otelConfigured: {
    id: 130001,
    name: 'OpenTelemetry SDK configured',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const req = readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
      const goMod = ctx.fileContent('go.mod') || '';
      const cargo = ctx.fileContent('Cargo.toml') || '';
      const deps = [pkg, req, goMod, cargo].join('\n');
      return /opentelemetry|@opentelemetry\/sdk|otel/i.test(deps) ||
        ctx.files.some(f => /otel.*config|opentelemetry.*config/i.test(f));
    },
    impact: 'high',
    category: 'observability',
    fix: 'Add OpenTelemetry SDK to your project for unified traces, metrics, and logs collection.',
  },

  prometheusMetrics: {
    id: 130002,
    name: 'Prometheus metrics configured',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const req = readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
      const goMod = ctx.fileContent('go.mod') || '';
      const cargo = ctx.fileContent('Cargo.toml') || '';
      const deps = [pkg, req, goMod, cargo].join('\n');
      if (/prom-client|prometheus_client|prometheus\/client_golang|prometheus/i.test(deps)) return true;
      const code = readProjectFiles(ctx, /\.(js|ts|py|go|rs|java)$/i);
      return /\/metrics\b/.test(code);
    },
    impact: 'high',
    category: 'observability',
    fix: 'Add a Prometheus client library and expose a /metrics endpoint for monitoring.',
  },

  structuredLogging: {
    id: 130003,
    name: 'Structured logging library',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const req = readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
      const goMod = ctx.fileContent('go.mod') || '';
      const cargo = ctx.fileContent('Cargo.toml') || '';
      const deps = [pkg, req, goMod, cargo].join('\n');
      return /winston|pino|bunyan|structlog|python-json-logger|slog|log\/slog|tracing|tracing-subscriber|logback|log4j/i.test(deps);
    },
    impact: 'high',
    category: 'observability',
    fix: 'Use a structured logging library (winston, pino, structlog, slog, tracing) for machine-readable logs.',
  },

  distributedTracing: {
    id: 130004,
    name: 'Distributed tracing configured',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const req = readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
      const goMod = ctx.fileContent('go.mod') || '';
      const cargo = ctx.fileContent('Cargo.toml') || '';
      const deps = [pkg, req, goMod, cargo].join('\n');
      if (/jaeger|zipkin|opentelemetry-api|@opentelemetry\/api|dd-trace|datadog-apm/i.test(deps)) return true;
      return ctx.files.some(f => /jaeger|zipkin|tracing.*config/i.test(f));
    },
    impact: 'high',
    category: 'observability',
    fix: 'Add a distributed tracing library (Jaeger, Zipkin, OpenTelemetry) for cross-service request tracking.',
  },

  healthEndpoint: {
    id: 130005,
    name: 'Health check endpoint',
    check: (ctx) => {
      const code = readProjectFiles(ctx, /\.(js|ts|py|go|rs|java|rb)$/i);
      const configs = readProjectFiles(ctx, /\.(ya?ml|json|toml)$/i);
      return /['"\/]health[z]?['"]\s*[,):]|\/health[z]?\b|healthCheck|health_check|livenessProbe|readinessProbe/i.test(code + configs);
    },
    impact: 'high',
    category: 'observability',
    fix: 'Add a /health or /healthz endpoint for load balancer and orchestrator health checks.',
  },

  alertingConfigured: {
    id: 130006,
    name: 'Alerting system configured',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const deps = [pkg, readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i)].join('\n');
      const configs = readProjectFiles(ctx, /\.(ya?ml|json|toml)$/i);
      return /alertmanager|pagerduty|opsgenie|victorops|alert.*rule/i.test(deps + configs) ||
        ctx.files.some(f => /alert.*rule|alertmanager/i.test(f));
    },
    impact: 'medium',
    category: 'observability',
    fix: 'Configure alerting (Alertmanager, PagerDuty, OpsGenie) to get notified of production issues.',
  },

  dashboardDefined: {
    id: 130007,
    name: 'Monitoring dashboard defined',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      return ctx.files.some(f => /grafana\/.*\.json|\.dashboard\.json/i.test(f)) ||
        /grafana|@grafana/i.test(pkg) ||
        hasProjectFile(ctx, /grafana/i);
    },
    impact: 'medium',
    category: 'observability',
    fix: 'Add Grafana dashboard JSON files or configure dashboard-as-code for production monitoring.',
  },

  logAggregation: {
    id: 130008,
    name: 'Log aggregation configured',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const req = readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
      const configs = readProjectFiles(ctx, /\.(ya?ml|json|toml)$/i);
      const all = [pkg, req, configs].join('\n');
      return /elasticsearch|elastic\.co|logstash|kibana|loki|grafana-loki|cloudwatch.*log|datadog|fluentd|fluent-bit|filebeat/i.test(all);
    },
    impact: 'medium',
    category: 'observability',
    fix: 'Configure log aggregation (ELK, Loki, CloudWatch, Datadog) for centralized log analysis.',
  },

  // ============================================================
  // === MC2: ACCESSIBILITY (category: 'accessibility') =========
  // ============================================================

  a11yTestingTool: {
    id: 130011,
    name: 'Accessibility testing tool',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      const pkg = ctx.fileContent('package.json') || '';
      return /axe-core|pa11y|@testing-library\/jest-dom|jest-axe|cypress-axe|@axe-core/i.test(pkg);
    },
    impact: 'high',
    category: 'accessibility',
    fix: 'Add an accessibility testing tool (axe-core, pa11y, jest-axe) to catch a11y regressions.',
  },

  ariaLabels: {
    id: 130012,
    name: 'ARIA labels in components',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      const components = readProjectFiles(ctx, /\.(jsx|tsx|vue|svelte|html)$/i);
      if (!components) return null;
      return /aria-label|aria-labelledby|aria-describedby/i.test(components);
    },
    impact: 'high',
    category: 'accessibility',
    fix: 'Add aria-label or aria-labelledby attributes to interactive components for screen readers.',
  },

  wcagMentioned: {
    id: 130013,
    name: 'WCAG or accessibility in docs',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      const docs = readProjectFiles(ctx, /\.(md|txt|rst)$/i);
      const configs = readProjectFiles(ctx, /\.(ya?ml|json|toml)$/i);
      return /wcag|accessibility|a11y/i.test(docs + configs);
    },
    impact: 'medium',
    category: 'accessibility',
    fix: 'Document WCAG compliance level and accessibility standards in your project docs.',
  },

  semanticHtml: {
    id: 130014,
    name: 'Semantic HTML elements used',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      const templates = readProjectFiles(ctx, /\.(jsx|tsx|vue|svelte|html)$/i);
      if (!templates) return null;
      return /<(nav|main|article|section|aside|header|footer)\b/i.test(templates);
    },
    impact: 'medium',
    category: 'accessibility',
    fix: 'Use semantic HTML elements (nav, main, article, section, aside) instead of generic div elements.',
  },

  colorContrastTool: {
    id: 130015,
    name: 'Color contrast checking configured',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      const pkg = ctx.fileContent('package.json') || '';
      const configs = readProjectFiles(ctx, /\.(ya?ml|json|toml|js|ts)$/i);
      return /axe-core|lighthouse|contrast-checker|color-contrast|a11y.*color/i.test(pkg + configs);
    },
    impact: 'medium',
    category: 'accessibility',
    fix: 'Configure a color contrast checking tool (axe, Lighthouse CI, contrast-checker) for WCAG AA compliance.',
  },

  keyboardNavigation: {
    id: 130016,
    name: 'Keyboard navigation patterns',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      const components = readProjectFiles(ctx, /\.(jsx|tsx|vue|svelte|html)$/i);
      if (!components) return null;
      return /tabindex|onKeyDown|onKeyUp|onKeyPress|@keydown|@keyup|v-on:keydown|focus-trap|useFocusTrap|FocusTrap/i.test(components);
    },
    impact: 'medium',
    category: 'accessibility',
    fix: 'Implement keyboard navigation with tabindex, key handlers, and focus management for accessible UIs.',
  },

  // ============================================================
  // === MC4: DATA PRIVACY / GDPR (category: 'privacy') ========
  // ============================================================

  privacyPolicy: {
    id: 130021,
    name: 'Privacy policy document exists',
    check: (ctx) => {
      return ctx.files.some(f => /privacy/i.test(f) && /\.(md|txt|html|rst)$/i.test(f)) ||
        hasProjectFile(ctx, /privacy[_-]?policy/i);
    },
    impact: 'high',
    category: 'privacy',
    fix: 'Create a PRIVACY.md or privacy-policy document describing data handling practices.',
  },

  consentManagement: {
    id: 130022,
    name: 'Consent management configured',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const code = readProjectFiles(ctx, /\.(js|ts|jsx|tsx|html)$/i);
      return /cookie-consent|cookieconsent|onetrust|cookiebot|consent-manager|cookie.*banner/i.test(pkg + code);
    },
    impact: 'high',
    category: 'privacy',
    fix: 'Add a consent management solution (CookieConsent, OneTrust, Cookiebot) for GDPR cookie compliance.',
  },

  dataRetentionPolicy: {
    id: 130023,
    name: 'Data retention policy documented',
    check: (ctx) => {
      const docs = readProjectFiles(ctx, /\.(md|txt|rst|ya?ml|json)$/i);
      return /data.retention|retention.polic|ttl.*expir|expir.*polic/i.test(docs);
    },
    impact: 'medium',
    category: 'privacy',
    fix: 'Document your data retention policy specifying how long user data is stored and when it is deleted.',
  },

  piiHandling: {
    id: 130024,
    name: 'PII handling patterns in code',
    check: (ctx) => {
      const code = readProjectFiles(ctx, /\.(js|ts|py|go|rs|java|rb)$/i);
      return /\bredact|anonymize|pseudonymize|mask.*(email|phone|ssn|pii)|pii.*mask|sanitize.*(user|personal)/i.test(code);
    },
    impact: 'high',
    category: 'privacy',
    fix: 'Implement PII handling patterns (redact, anonymize, mask) to protect personal data in logs and storage.',
  },

  gdprCompliance: {
    id: 130025,
    name: 'GDPR/CCPA compliance mentioned',
    check: (ctx) => {
      const docs = readProjectFiles(ctx, /\.(md|txt|rst)$/i);
      const configs = readProjectFiles(ctx, /\.(ya?ml|json|toml)$/i);
      return /\bgdpr\b|\bccpa\b|data.protection|right.to.erasure|data.subject|dpa\b/i.test(docs + configs);
    },
    impact: 'high',
    category: 'privacy',
    fix: 'Document GDPR/CCPA compliance measures and data protection practices in your project.',
  },

  dataEncryption: {
    id: 130026,
    name: 'Data encryption in deps or config',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const req = readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
      const goMod = ctx.fileContent('go.mod') || '';
      const cargo = ctx.fileContent('Cargo.toml') || '';
      const deps = [pkg, req, goMod, cargo].join('\n');
      return /bcrypt|argon2|scrypt|crypto|node:crypto|cryptography|ring\b|rustls|tls.*config|ssl.*config|encryption.at.rest/i.test(deps) ||
        /encrypt|bcrypt|argon2/i.test(readProjectFiles(ctx, /\.(js|ts|py|go|rs|java)$/i));
    },
    impact: 'high',
    category: 'privacy',
    fix: 'Use encryption libraries (bcrypt, argon2, crypto) for data at rest and configure TLS for data in transit.',
  },

  // ============================================================
  // === MC9: ERROR TRACKING (category: 'error-tracking') =======
  // ============================================================

  errorTrackingService: {
    id: 130031,
    name: 'Error tracking service configured',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const req = readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
      const goMod = ctx.fileContent('go.mod') || '';
      const cargo = ctx.fileContent('Cargo.toml') || '';
      const deps = [pkg, req, goMod, cargo].join('\n');
      return /@sentry\/|sentry-sdk|sentry_sdk|bugsnag|rollbar|datadog.*apm|dd-trace|getsentry/i.test(deps);
    },
    impact: 'high',
    category: 'error-tracking',
    fix: 'Add an error tracking service (Sentry, Bugsnag, Rollbar, Datadog APM) to catch production errors.',
  },

  errorBoundaries: {
    id: 130032,
    name: 'Error boundaries in frontend',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      const components = readProjectFiles(ctx, /\.(jsx|tsx|vue|svelte|js|ts)$/i);
      if (!components) return null;
      return /ErrorBoundary|errorHandler|onErrorCaptured|componentDidCatch|getDerivedStateFromError|error\.vue|_error\.(jsx|tsx|js|ts)/i.test(components);
    },
    impact: 'high',
    category: 'error-tracking',
    fix: 'Add error boundaries (React ErrorBoundary, Vue errorHandler) to gracefully handle frontend errors.',
  },

  unhandledRejection: {
    id: 130033,
    name: 'Unhandled rejection/exception handler',
    check: (ctx) => {
      const code = readProjectFiles(ctx, /\.(js|ts|py|go|rs)$/i);
      return /unhandledRejection|uncaughtException|sys\.excepthook|recover\(\)|panic.*handler|set_hook.*panic/i.test(code);
    },
    impact: 'high',
    category: 'error-tracking',
    fix: 'Add handlers for unhandledRejection and uncaughtException to prevent silent failures.',
  },

  errorReporting: {
    id: 130034,
    name: 'Error notification/reporting pattern',
    check: (ctx) => {
      const code = readProjectFiles(ctx, /\.(js|ts|py|go|rs|java|rb)$/i);
      return /error.*webhook|error.*slack|error.*notify|alert.*error|captureException|captureMessage|notify.*error/i.test(code);
    },
    impact: 'medium',
    category: 'error-tracking',
    fix: 'Add error reporting patterns (webhook, Slack alerts, Sentry capture) to get notified of failures.',
  },

  errorBudgetSlo: {
    id: 130035,
    name: 'SLO/SLA or error budget defined',
    check: (ctx) => {
      const docs = readProjectFiles(ctx, /\.(md|txt|rst|ya?ml|json|toml)$/i);
      return /\bslo\b|\bsla\b|error.budget|service.level|uptime.*target|availability.*target/i.test(docs);
    },
    impact: 'medium',
    category: 'error-tracking',
    fix: 'Define SLOs, SLAs, or error budgets in your docs to set clear reliability targets.',
  },

  crashReporting: {
    id: 130036,
    name: 'Crash reporting for mobile',
    check: (ctx) => {
      const hasMobile = isFlutterProject(ctx) || isSwiftProject(ctx) || isKotlinProject(ctx) ||
        /react-native|expo/i.test(ctx.fileContent('package.json') || '');
      if (!hasMobile) return null;
      const deps = [
        ctx.fileContent('package.json') || '',
        ctx.fileContent('pubspec.yaml') || '',
        ctx.fileContent('Podfile') || '',
        readProjectFiles(ctx, /(^|\/)build\.gradle(\.kts)?$/i),
      ].join('\n');
      return /crashlytics|sentry.*native|@sentry\/react-native|bugsnag.*react-native|firebase.*crash/i.test(deps);
    },
    impact: 'high',
    category: 'error-tracking',
    fix: 'Add crash reporting (Crashlytics, Sentry Native) to track mobile app crashes in production.',
  },

  // ============================================================
  // === MC15: SUPPLY CHAIN SECURITY (category: 'supply-chain') =
  // ============================================================

  sbomExists: {
    id: 130041,
    name: 'SBOM file exists',
    check: (ctx) => {
      return ctx.files.some(f => /sbom\.(json|xml|cdx\.json)|bom\.xml|cyclonedx/i.test(f));
    },
    impact: 'medium',
    category: 'supply-chain',
    fix: 'Generate an SBOM (Software Bill of Materials) in CycloneDX or SPDX format for supply chain transparency.',
  },

  dependencyPinning: {
    id: 130042,
    name: 'Lock files committed',
    check: (ctx) => {
      return ctx.files.some(f => /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|Pipfile\.lock|bun\.lockb|composer\.lock|Gemfile\.lock|go\.sum)$/i.test(f));
    },
    impact: 'high',
    category: 'supply-chain',
    fix: 'Commit lock files (package-lock.json, yarn.lock, Cargo.lock, poetry.lock) for reproducible builds.',
  },

  provenanceAttestation: {
    id: 130043,
    name: 'Provenance or sigstore in CI',
    check: (ctx) => {
      const ci = getWorkflowContent(ctx);
      return /provenance|sigstore|cosign|slsa|attestation/i.test(ci);
    },
    impact: 'medium',
    category: 'supply-chain',
    fix: 'Add npm provenance or sigstore attestation in CI to verify package integrity.',
  },

  lockfileIntegrity: {
    id: 130044,
    name: 'CI uses frozen lockfile install',
    check: (ctx) => {
      const ci = getWorkflowContent(ctx);
      return /npm ci\b|--frozen-lockfile|--immutable|cargo.*--locked|pip install.*--require-hashes/i.test(ci);
    },
    impact: 'high',
    category: 'supply-chain',
    fix: 'Use `npm ci` or `--frozen-lockfile` in CI instead of `npm install` for deterministic builds.',
  },

  dependencyScanning: {
    id: 130045,
    name: 'Dependency scanning configured',
    check: (ctx) => {
      const hasConfig = ctx.files.some(f => /dependabot\.yml|renovate\.json|\.snyk/i.test(f));
      if (hasConfig) return true;
      const ci = getWorkflowContent(ctx);
      return /dependabot|renovate|snyk|npm audit|cargo audit|pip-audit|safety check/i.test(ci);
    },
    impact: 'high',
    category: 'supply-chain',
    fix: 'Configure Dependabot, Renovate, or Snyk to automatically scan and update vulnerable dependencies.',
  },

  // ── MC3: Internationalization i18n ──────────────────────────────────

  i18nLibrary: {
    id: 130101,
    name: 'i18n library in dependencies',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      if (/i18next|react-intl|vue-i18n|@angular\/localize/i.test(pkg)) return true;
      const py = readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i) + readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
      if (/gettext|babel|fluent/i.test(py)) return true;
      return false;
    },
    impact: 'medium',
    category: 'i18n',
    fix: 'Add an i18n library (i18next, react-intl, vue-i18n, gettext, fluent) for internationalization support.',
    confidence: 0.7,
  },

  localeFiles: {
    id: 130102,
    name: 'Locale files exist',
    check: (ctx) => {
      return hasProjectFile(ctx, /(^|\/)locales\//i) ||
        hasProjectFile(ctx, /(^|\/)messages\//i) ||
        hasProjectFile(ctx, /(^|\/)translations\//i) ||
        hasProjectFile(ctx, /\.(po|xlf)$/i);
    },
    impact: 'medium',
    category: 'i18n',
    fix: 'Add locale files in a locales/, messages/, or translations/ directory for multi-language support.',
    confidence: 0.7,
  },

  rtlSupport: {
    id: 130103,
    name: 'RTL support configured',
    check: (ctx) => {
      const src = readProjectFiles(ctx, /\.(jsx?|tsx?|vue|html|css|scss)$/i, 30);
      return /dir=["']rtl["']|\brtl\b|\bbidi\b/i.test(src);
    },
    impact: 'low',
    category: 'i18n',
    fix: 'Add RTL (right-to-left) support with dir="rtl" or bidi utilities for languages like Arabic and Hebrew.',
    confidence: 0.7,
  },

  pluralizationRules: {
    id: 130104,
    name: 'ICU message format or pluralization',
    check: (ctx) => {
      const src = readProjectFiles(ctx, /\.(jsx?|tsx?|json|properties)$/i, 30);
      return /\{[^}]*,\s*plural\s*,/i.test(src) || /\bplural\b.*\bone\b|\bICU\b/i.test(src);
    },
    impact: 'low',
    category: 'i18n',
    fix: 'Use ICU message format or pluralization rules for correct multi-language number/gender handling.',
    confidence: 0.7,
  },

  i18nExtraction: {
    id: 130105,
    name: 'i18n extraction tool configured',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      return /babel-plugin-react-intl|i18next-parser|@formatjs\/cli|react-intl-translations-manager/i.test(pkg);
    },
    impact: 'low',
    category: 'i18n',
    fix: 'Add an i18n extraction tool (i18next-parser, @formatjs/cli) to auto-extract translatable strings.',
    confidence: 0.7,
  },

  dateTimeFormatting: {
    id: 130106,
    name: 'Locale-aware date/time formatting',
    check: (ctx) => {
      const src = readProjectFiles(ctx, /\.(jsx?|tsx?|vue)$/i, 30);
      return /Intl\.DateTimeFormat|date-fns\/locale|dayjs\/locale|moment\/locale/i.test(src);
    },
    impact: 'low',
    category: 'i18n',
    fix: 'Use locale-aware date/time formatting (Intl.DateTimeFormat, date-fns/locale, dayjs/locale) instead of hardcoded formats.',
    confidence: 0.7,
  },

  // ── MC5: API Versioning ─────────────────────────────────────────────

  apiVersionHeader: {
    id: 130111,
    name: 'API versioning pattern present',
    check: (ctx) => {
      const src = readProjectFiles(ctx, /\.(jsx?|tsx?|py|go|java|rb)$/i, 30);
      const config = readProjectFiles(ctx, /\.(ya?ml|json)$/i, 20);
      return /\/v[12]\/|api-version|Accept-Version|x-api-version/i.test(src + config);
    },
    impact: 'medium',
    category: 'api-versioning',
    fix: 'Add API versioning (URL prefix /v1/, header Accept-Version) to manage breaking changes safely.',
    confidence: 0.7,
  },

  deprecationNotices: {
    id: 130112,
    name: 'Deprecation notices in API code',
    check: (ctx) => {
      const src = readProjectFiles(ctx, /\.(jsx?|tsx?|py|go|java|rb)$/i, 30);
      return /@deprecated|Deprecation|Sunset|x-deprecated/i.test(src);
    },
    impact: 'low',
    category: 'api-versioning',
    fix: 'Add @deprecated annotations or Deprecation/Sunset headers to signal API endpoint retirement.',
    confidence: 0.7,
  },

  apiChangelog: {
    id: 130113,
    name: 'API changelog exists',
    check: (ctx) => {
      if (hasProjectFile(ctx, /(^|\/)api-changelog/i)) return true;
      const changelog = ctx.fileContent('CHANGELOG.md') || '';
      return /\bAPI\b/i.test(changelog);
    },
    impact: 'low',
    category: 'api-versioning',
    fix: 'Add an API changelog (CHANGELOG.md with API section or api-changelog file) to document breaking changes.',
    confidence: 0.7,
  },

  backwardCompat: {
    id: 130114,
    name: 'Backward compatibility tests or migrations',
    check: (ctx) => {
      return hasProjectFile(ctx, /(^|\/)(migration|migrate)/i) ||
        hasProjectFile(ctx, /(backward|compat).*test/i);
    },
    impact: 'medium',
    category: 'api-versioning',
    fix: 'Add backward compatibility tests or migration scripts to validate API changes don\'t break clients.',
    confidence: 0.7,
  },

  apiDocVersioned: {
    id: 130115,
    name: 'Versioned API documentation',
    check: (ctx) => {
      const docs = readProjectFiles(ctx, /(openapi|swagger)\.(ya?ml|json)$/i);
      return /version/i.test(docs);
    },
    impact: 'low',
    category: 'api-versioning',
    fix: 'Add versioned API documentation (OpenAPI/Swagger spec with version field) for API consumers.',
    confidence: 0.7,
  },

  // ── MC6: Caching Strategy ───────────────────────────────────────────

  cacheLayer: {
    id: 130121,
    name: 'Cache library in dependencies',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      if (/redis|memcached|ioredis|node-cache|lru-cache/i.test(pkg)) return true;
      const py = readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i) + readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
      if (/redis|memcached|django-cache|cachetools/i.test(py)) return true;
      return false;
    },
    impact: 'medium',
    category: 'caching',
    fix: 'Add a caching layer (redis, memcached, ioredis, lru-cache) to reduce latency and database load.',
    confidence: 0.7,
  },

  cdnConfigured: {
    id: 130122,
    name: 'CDN configured',
    check: (ctx) => {
      const config = readProjectFiles(ctx, /\.(json|ya?ml|toml|conf)$/i, 20);
      const src = readProjectFiles(ctx, /\.(jsx?|tsx?)$/i, 20);
      return /cloudfront|cloudflare|fastly|cdn/i.test(config + src) ||
        (ctx.files.includes('vercel.json') && /headers/i.test(ctx.fileContent('vercel.json') || ''));
    },
    impact: 'medium',
    category: 'caching',
    fix: 'Configure a CDN (CloudFront, Cloudflare, Fastly) for static asset delivery and edge caching.',
    confidence: 0.7,
  },

  cacheHeaders: {
    id: 130123,
    name: 'Cache-Control headers configured',
    check: (ctx) => {
      const src = readProjectFiles(ctx, /\.(jsx?|tsx?|py|go|java|rb|conf)$/i, 30);
      return /Cache-Control|max-age|s-maxage|stale-while-revalidate/i.test(src);
    },
    impact: 'medium',
    category: 'caching',
    fix: 'Set Cache-Control headers (max-age, s-maxage, stale-while-revalidate) for HTTP response caching.',
    confidence: 0.7,
  },

  cacheInvalidation: {
    id: 130124,
    name: 'Cache invalidation patterns present',
    check: (ctx) => {
      const src = readProjectFiles(ctx, /\.(jsx?|tsx?|py|go|java|rb)$/i, 30);
      return /cache.*purge|cache.*bust|cache.*invalidat|\.del\(|\.flush\(/i.test(src);
    },
    impact: 'low',
    category: 'caching',
    fix: 'Implement cache invalidation patterns (purge, bust, invalidate) to prevent serving stale data.',
    confidence: 0.7,
  },

  httpCaching: {
    id: 130125,
    name: 'ETag or Last-Modified caching',
    check: (ctx) => {
      const src = readProjectFiles(ctx, /\.(jsx?|tsx?|py|go|java|rb|conf)$/i, 30);
      return /ETag|Last-Modified|If-None-Match|If-Modified-Since/i.test(src);
    },
    impact: 'low',
    category: 'caching',
    fix: 'Implement ETag or Last-Modified headers for conditional HTTP caching and bandwidth savings.',
    confidence: 0.7,
  },

  // ── MC7: Rate Limiting ──────────────────────────────────────────────

  rateLimitMiddleware: {
    id: 130131,
    name: 'Rate limiting middleware configured',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      if (/express-rate-limit|@nestjs\/throttler|rate-limiter-flexible|koa-ratelimit/i.test(pkg)) return true;
      const py = readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i) + readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
      if (/django-ratelimit|slowapi|flask-limiter/i.test(py)) return true;
      return false;
    },
    impact: 'medium',
    category: 'rate-limiting',
    fix: 'Add rate limiting middleware (express-rate-limit, @nestjs/throttler, rate-limiter-flexible) to protect APIs.',
    confidence: 0.7,
  },

  ddosProtection: {
    id: 130132,
    name: 'DDoS protection configured',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const config = readProjectFiles(ctx, /\.(json|ya?ml|toml|conf)$/i, 20);
      return /helmet|cors|cloudflare|waf|ddos/i.test(pkg + config);
    },
    impact: 'medium',
    category: 'rate-limiting',
    fix: 'Add DDoS protection (helmet, CORS, WAF, Cloudflare) to defend against abuse and volumetric attacks.',
    confidence: 0.7,
  },

  backoffStrategy: {
    id: 130133,
    name: 'Retry/backoff strategy in dependencies',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      if (/exponential-backoff|p-retry|async-retry|retry|got.*retry|axios-retry/i.test(pkg)) return true;
      const py = readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i) + readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
      if (/tenacity|backoff|urllib3.*retry/i.test(py)) return true;
      return false;
    },
    impact: 'low',
    category: 'rate-limiting',
    fix: 'Add a retry/backoff library (p-retry, tenacity, exponential-backoff) for resilient external calls.',
    confidence: 0.7,
  },

  requestThrottling: {
    id: 130134,
    name: 'Request throttling in dependencies',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      return /bottleneck|p-throttle|p-limit|throttle/i.test(pkg);
    },
    impact: 'low',
    category: 'rate-limiting',
    fix: 'Add request throttling (bottleneck, p-throttle) to control outbound API call rates.',
    confidence: 0.7,
  },

  rateLimitHeaders: {
    id: 130135,
    name: 'Rate limit headers or 429 responses',
    check: (ctx) => {
      const src = readProjectFiles(ctx, /\.(jsx?|tsx?|py|go|java|rb)$/i, 30);
      return /X-RateLimit|RateLimit-|429|Too Many Requests/i.test(src);
    },
    impact: 'low',
    category: 'rate-limiting',
    fix: 'Return X-RateLimit headers and 429 status codes so clients can handle rate limiting gracefully.',
    confidence: 0.7,
  },

  // ── MC8: Feature Flags ──────────────────────────────────────────────

  featureFlagService: {
    id: 130141,
    name: 'Feature flag service in dependencies',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      if (/launchdarkly|unleash|flagsmith|growthbook|@split/i.test(pkg)) return true;
      const py = readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i) + readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
      if (/launchdarkly|unleash|flagsmith|growthbook/i.test(py)) return true;
      return false;
    },
    impact: 'medium',
    category: 'feature-flags',
    fix: 'Add a feature flag service (LaunchDarkly, Unleash, Flagsmith, GrowthBook) for safe feature rollouts.',
    confidence: 0.7,
  },

  featureFlagConfig: {
    id: 130142,
    name: 'Feature flag config files exist',
    check: (ctx) => {
      return hasProjectFile(ctx, /(^|\/)flags\.json$/i) ||
        hasProjectFile(ctx, /(^|\/)features\.json$/i) ||
        hasProjectFile(ctx, /(^|\/)feature-flags\//i);
    },
    impact: 'low',
    category: 'feature-flags',
    fix: 'Add feature flag configuration files (flags.json, features.json, or feature-flags/ directory).',
    confidence: 0.7,
  },

  featureFlagTests: {
    id: 130143,
    name: 'Feature flag testing present',
    check: (ctx) => {
      const testFiles = readProjectFiles(ctx, /(test|spec)\.(jsx?|tsx?|py|go|java|rb)$/i, 30);
      return /flag|feature.*toggle|variation/i.test(testFiles);
    },
    impact: 'low',
    category: 'feature-flags',
    fix: 'Add tests for feature flag variations to verify behavior under different flag states.',
    confidence: 0.7,
  },

  flagLifecycle: {
    id: 130144,
    name: 'Flag lifecycle management',
    check: (ctx) => {
      return hasProjectFile(ctx, /flag-audit|remove-flag|flag.*cleanup/i) ||
        /flag.*lifecycle|flag.*cleanup|stale.*flag/i.test(readProjectFiles(ctx, /\.(md|txt|json)$/i, 10));
    },
    impact: 'low',
    category: 'feature-flags',
    fix: 'Add flag lifecycle scripts or docs (flag-audit, remove-flag) to prevent stale flag accumulation.',
    confidence: 0.7,
  },

  envBasedFlags: {
    id: 130145,
    name: 'Environment-based feature toggles',
    check: (ctx) => {
      const envFiles = readProjectFiles(ctx, /(^|\/)(\.env|\.env\.\w+)$/i);
      const config = readProjectFiles(ctx, /\.(json|ya?ml|toml)$/i, 15);
      return /FEATURE_|ENABLE_|FF_/i.test(envFiles + config);
    },
    impact: 'low',
    category: 'feature-flags',
    fix: 'Use environment-based feature toggles (FEATURE_, ENABLE_, FF_ prefixes) for deployment-time configuration.',
    confidence: 0.7,
  },

  // ── MC10: Documentation Quality ─────────────────────────────────────

  readmeQuality: {
    id: 130151,
    name: 'README has installation, usage, and contributing sections',
    check: (ctx) => {
      const readme = ctx.fileContent('README.md') || '';
      if (!readme) return false;
      return /install/i.test(readme) && /usage/i.test(readme) && /contribut/i.test(readme);
    },
    impact: 'medium',
    category: 'docs-quality',
    fix: 'Ensure README.md includes installation, usage, and contributing sections for developer onboarding.',
    confidence: 0.7,
  },

  contributingGuide: {
    id: 130152,
    name: 'CONTRIBUTING.md exists',
    check: (ctx) => ctx.files.some(f => /^contributing\.md$/i.test(f)),
    impact: 'low',
    category: 'docs-quality',
    fix: 'Add CONTRIBUTING.md with contribution guidelines, code standards, and PR process.',
    confidence: 0.7,
  },

  apiDocsGenerated: {
    id: 130153,
    name: 'API documentation generator configured',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      if (/typedoc|jsdoc|apidoc|compodoc/i.test(pkg)) return true;
      const py = readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i) + readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
      if (/sphinx|pdoc|mkdocstrings/i.test(py)) return true;
      if (isGoProject(ctx) && hasProjectFile(ctx, /(^|\/)doc\.go$/i)) return true;
      return false;
    },
    impact: 'low',
    category: 'docs-quality',
    fix: 'Add an API documentation generator (typedoc, jsdoc, sphinx, godoc) for auto-generated docs.',
    confidence: 0.7,
  },

  storybookConfigured: {
    id: 130154,
    name: 'Storybook configured for component docs',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      return ctx.hasDir('.storybook') || hasProjectFile(ctx, /(^|\/)\.storybook\//i);
    },
    impact: 'low',
    category: 'docs-quality',
    fix: 'Add Storybook (.storybook/) for interactive component documentation and visual testing.',
    confidence: 0.7,
  },

  codeOfConduct: {
    id: 130155,
    name: 'CODE_OF_CONDUCT.md exists',
    check: (ctx) => ctx.files.some(f => /^code.of.conduct\.md$/i.test(f)),
    impact: 'low',
    category: 'docs-quality',
    fix: 'Add CODE_OF_CONDUCT.md to set community standards and expectations.',
    confidence: 0.7,
  },

  licenseDeclared: {
    id: 130156,
    name: 'LICENSE file exists',
    check: (ctx) => ctx.files.some(f => /^license/i.test(f)),
    impact: 'low',
    category: 'docs-quality',
    fix: 'Add a LICENSE file to clarify usage rights and legal terms.',
    confidence: 0.7,
  },

  // ── MC13: Monorepo Tooling ──────────────────────────────────────────

  monorepoTool: {
    id: 130161,
    name: 'Monorepo tool configured',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const hasMonorepo = /workspaces/i.test(pkg) || ctx.files.includes('lerna.json') ||
        ctx.files.includes('nx.json') || ctx.files.includes('turbo.json') ||
        hasProjectFile(ctx, /(^|\/)pnpm-workspace\.yaml$/i);
      if (!hasMonorepo) return null;
      return /turborepo|turbo|"nx"|lerna|rush|bazel/i.test(pkg) ||
        ctx.files.includes('nx.json') || ctx.files.includes('turbo.json') ||
        ctx.files.includes('lerna.json') || ctx.files.includes('rush.json');
    },
    impact: 'medium',
    category: 'monorepo',
    fix: 'Configure a monorepo orchestration tool (Turborepo, Nx, Lerna, Rush) for efficient multi-package builds.',
    confidence: 0.7,
  },

  workspaceDeps: {
    id: 130162,
    name: 'Workspace dependency management configured',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const hasMonorepo = /workspaces/i.test(pkg) || ctx.files.includes('lerna.json') ||
        ctx.files.includes('nx.json') || ctx.files.includes('turbo.json') ||
        hasProjectFile(ctx, /(^|\/)pnpm-workspace\.yaml$/i);
      if (!hasMonorepo) return null;
      return hasProjectFile(ctx, /(^|\/)pnpm-workspace\.yaml$/i) || /workspaces/i.test(pkg);
    },
    impact: 'medium',
    category: 'monorepo',
    fix: 'Configure workspace dependencies (pnpm-workspace.yaml or workspaces in package.json) for cross-package linking.',
    confidence: 0.7,
  },

  changesetsConfigured: {
    id: 130163,
    name: 'Changesets or conventional commits for versioning',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const hasMonorepo = /workspaces/i.test(pkg) || ctx.files.includes('lerna.json') ||
        ctx.files.includes('nx.json') || ctx.files.includes('turbo.json') ||
        hasProjectFile(ctx, /(^|\/)pnpm-workspace\.yaml$/i);
      if (!hasMonorepo) return null;
      return /@changesets\/cli|changeset/i.test(pkg) || ctx.hasDir('.changeset') ||
        hasProjectFile(ctx, /(^|\/)\.changeset\//i);
    },
    impact: 'low',
    category: 'monorepo',
    fix: 'Add @changesets/cli or conventional commits for coordinated versioning across packages.',
    confidence: 0.7,
  },

  monorepoCI: {
    id: 130164,
    name: 'CI uses affected/changed detection',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const hasMonorepo = /workspaces/i.test(pkg) || ctx.files.includes('lerna.json') ||
        ctx.files.includes('nx.json') || ctx.files.includes('turbo.json') ||
        hasProjectFile(ctx, /(^|\/)pnpm-workspace\.yaml$/i);
      if (!hasMonorepo) return null;
      const ci = getWorkflowContent(ctx);
      return /nx affected|turbo.*--filter|lerna changed|lerna run.*--since/i.test(ci);
    },
    impact: 'medium',
    category: 'monorepo',
    fix: 'Use affected/changed detection in CI (nx affected, turbo --filter) to only build what changed.',
    confidence: 0.7,
  },

  sharedConfigs: {
    id: 130165,
    name: 'Shared configs across packages',
    check: (ctx) => {
      const pkg = ctx.fileContent('package.json') || '';
      const hasMonorepo = /workspaces/i.test(pkg) || ctx.files.includes('lerna.json') ||
        ctx.files.includes('nx.json') || ctx.files.includes('turbo.json') ||
        hasProjectFile(ctx, /(^|\/)pnpm-workspace\.yaml$/i);
      if (!hasMonorepo) return null;
      return hasProjectFile(ctx, /(^|\/)packages\/.*eslint/i) ||
        hasProjectFile(ctx, /(^|\/)packages\/.*tsconfig/i) ||
        hasProjectFile(ctx, /shared.*config/i);
    },
    impact: 'low',
    category: 'monorepo',
    fix: 'Create shared config packages (eslint, tsconfig) referenced across monorepo packages for consistency.',
    confidence: 0.7,
  },

  // ── MC14: Performance Budget ────────────────────────────────────────

  lighthouseCI: {
    id: 130171,
    name: 'Lighthouse CI configured',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      return hasProjectFile(ctx, /(^|\/)\.?lighthouserc\.(js|json|ya?ml)$/i) ||
        /lighthouse/i.test(getWorkflowContent(ctx));
    },
    impact: 'medium',
    category: 'performance-budget',
    fix: 'Add Lighthouse CI (lighthouserc.js) to enforce performance budgets in your CI pipeline.',
    confidence: 0.7,
  },

  bundleSizeLimit: {
    id: 130172,
    name: 'Bundle size check configured',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      const pkg = ctx.fileContent('package.json') || '';
      return /size-limit|bundlewatch|@next\/bundle-analyzer|webpack-bundle-analyzer/i.test(pkg);
    },
    impact: 'medium',
    category: 'performance-budget',
    fix: 'Add bundle size checks (size-limit, bundlewatch, @next/bundle-analyzer) to prevent bundle bloat.',
    confidence: 0.7,
  },

  webVitals: {
    id: 130173,
    name: 'Core Web Vitals tracking configured',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      const pkg = ctx.fileContent('package.json') || '';
      const src = readProjectFiles(ctx, /\.(jsx?|tsx?)$/i, 20);
      return /web-vitals|next\/web-vitals|@vercel\/speed-insights/i.test(pkg + src);
    },
    impact: 'medium',
    category: 'performance-budget',
    fix: 'Add Core Web Vitals tracking (web-vitals, next/web-vitals) for real user performance monitoring.',
    confidence: 0.7,
  },

  performanceRegression: {
    id: 130174,
    name: 'Performance regression testing in CI',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      const ci = getWorkflowContent(ctx);
      const pkg = ctx.fileContent('package.json') || '';
      return /benchmark|bench|perf.*test|lighthouse.*assert/i.test(ci + pkg);
    },
    impact: 'low',
    category: 'performance-budget',
    fix: 'Add performance regression testing in CI (benchmark, lighthouse assert) to catch regressions early.',
    confidence: 0.7,
  },

  imageOptimization: {
    id: 130175,
    name: 'Image optimization configured',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      const pkg = ctx.fileContent('package.json') || '';
      return /sharp|imagemin|next\/image|responsive-loader|@squoosh/i.test(pkg);
    },
    impact: 'low',
    category: 'performance-budget',
    fix: 'Add image optimization (sharp, imagemin, next/image) to reduce page weight and improve loading.',
    confidence: 0.7,
  },

  lazyLoading: {
    id: 130176,
    name: 'Code splitting and lazy loading',
    check: (ctx) => {
      if (!hasFrontendSignals(ctx)) return null;
      const src = readProjectFiles(ctx, /\.(jsx?|tsx?)$/i, 30);
      return /React\.lazy|import\s*\(|loadable|dynamic\s*\(\s*\(\)\s*=>/i.test(src);
    },
    impact: 'low',
    category: 'performance-budget',
    fix: 'Use code splitting and lazy loading (React.lazy, dynamic import, loadable) to reduce initial bundle size.',
    confidence: 0.7,
  },


};

Object.assign(TECHNIQUES, buildSupplementalChecks({
  idPrefix: 'CL-T',
  urlMap: CLAUDE_SUPPLEMENTAL_SOURCE_URLS,
  docs: (ctx) => [
    ctx.claudeMdContent ? ctx.claudeMdContent() : (ctx.fileContent('CLAUDE.md') || ctx.fileContent('.claude/CLAUDE.md') || ''),
    ctx.fileContent('README.md') || '',
  ].filter(Boolean).join('\n'),
}));

// Stack detection
const STACKS = {
  react: { files: ['package.json'], content: { 'package.json': 'react' }, label: 'React' },
  vue: { files: ['package.json'], content: { 'package.json': 'vue' }, label: 'Vue' },
  angular: { files: ['angular.json'], content: {}, label: 'Angular' },
  nextjs: { files: ['next.config'], content: {}, label: 'Next.js' },
  python: { files: ['requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile'], content: {}, label: 'Python' },
  django: { files: ['manage.py'], content: {}, label: 'Django' },
  fastapi: { files: ['requirements.txt'], content: { 'requirements.txt': 'fastapi' }, label: 'FastAPI' },
  node: { files: ['package.json'], content: {}, label: 'Node.js' },
  typescript: { files: ['tsconfig.json'], content: {}, label: 'TypeScript' },
  rust: { files: ['Cargo.toml'], content: {}, label: 'Rust' },
  go: { files: ['go.mod'], content: {}, label: 'Go' },
  docker: { files: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'], content: {}, label: 'Docker' },
  svelte: { files: ['svelte.config.js'], content: {}, label: 'Svelte' },
  flutter: { files: ['pubspec.yaml'], content: {}, label: 'Flutter' },
  ruby: { files: ['Gemfile'], content: {}, label: 'Ruby' },
  java: { files: ['pom.xml'], content: {}, label: 'Java' },
  kotlin: { files: ['build.gradle.kts'], content: {}, label: 'Kotlin' },
  swift: { files: ['Package.swift', '.xcodeproj'], content: {}, label: 'Swift' },
  terraform: { files: ['main.tf', 'terraform'], content: {}, label: 'Terraform' },
  kubernetes: { files: ['k8s', 'kubernetes', 'helm'], content: {}, label: 'Kubernetes' },
  cpp: { files: ['CMakeLists.txt', 'Makefile', '.clang-format'], content: {}, label: 'C++' },
  bazel: { files: ['BUILD', 'WORKSPACE', 'BUILD.bazel', 'WORKSPACE.bazel'], content: {}, label: 'Bazel' },
  deno: { files: ['deno.json', 'deno.jsonc', 'deno.lock'], content: {}, label: 'Deno' },
  bun: { files: ['bun.lockb', 'bunfig.toml'], content: {}, label: 'Bun' },
  elixir: { files: ['mix.exs'], content: {}, label: 'Elixir' },
  astro: { files: ['astro.config.mjs', 'astro.config.ts'], content: {}, label: 'Astro' },
  remix: { files: ['remix.config.js', 'remix.config.ts'], content: {}, label: 'Remix' },
  nestjs: { files: ['nest-cli.json'], content: {}, label: 'NestJS' },
  laravel: { files: ['artisan'], content: {}, label: 'Laravel' },
  dotnet: { files: ['global.json', 'Directory.Build.props'], content: {}, label: '.NET' },
};

attachSourceUrls('claude', TECHNIQUES);

module.exports = { TECHNIQUES, STACKS, STACK_CATEGORY_DETECTORS, containsEmbeddedSecret };
