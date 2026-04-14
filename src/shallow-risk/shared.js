'use strict';

const fs = require('fs');
const path = require('path');
const { resolveEvidence } = require('../audit/evidence');
const { LAYERS } = require('../audit/layers');
const { STACKS } = require('../techniques');
const { P0_SOURCES: AIDER_P0_SOURCES } = require('../aider/freshness');

const SHALLOW_RISK_DOC_URL = 'https://github.com/nerviq/nerviq/blob/main/docs/shallow-risk.md';
const SHALLOW_RISK_BANNER_LINES = [
  'Shallow Risk mode (experimental, opt-in). NERVIQ checks 8 patterns',
  'that sit at the intersection of your AI agent configuration and',
  'your codebase - the kind of issues no generic scanner can find',
  'because they require understanding CLAUDE.md, .claude/settings.json,',
  'and similar files. For broader code-level security coverage, pair',
  'this with Semgrep, CodeQL, or a dedicated secret scanner.',
];
const SHALLOW_RISK_BANNER = SHALLOW_RISK_BANNER_LINES.join('\n');

const ROOT_AGENT_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  '.cursorrules',
  '.windsurfrules',
  '.aider.conf.yml',
  '.aider.conf.yaml',
  '.mcp.json',
  '.claude/settings.json',
  '.claude/CLAUDE.md',
  '.gemini/settings.json',
  '.github/copilot-instructions.md',
  '.vscode/mcp.json',
  '.vscode/settings.json',
  '.codex/config.toml',
  'opencode.json',
];

const ROOT_AGENT_DIRS = [
  '.claude/agents',
  '.claude/commands',
  '.claude/hooks',
  '.claude/rules',
  '.claude/skills',
  '.cursor/rules',
  '.windsurf/rules',
  '.codex/agents',
  '.codex/hooks',
  '.codex/skills',
  '.github/instructions',
];

const EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'coverage',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  '__pycache__',
]);

const SPECIAL_FILE_BASENAMES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'SECURITY.md',
  'README.md',
  'CONTRIBUTING.md',
  'CODEOWNERS',
  'Dockerfile',
  'Makefile',
  'justfile',
  'manifest.json',
  'package.json',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
]);

const COMMON_DOTFILE_BASENAMES = new Set([
  '.editorconfig',
  '.env',
  '.env.example',
  '.env.sample',
  '.env.template',
  '.gitattributes',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  '.prettierrc',
  '.python-version',
  '.tool-versions',
]);

const KNOWN_CONVENTION_PATHS = new Set([
  'CODEOWNERS',
  '.github/CODEOWNERS',
]);

const FILE_REFERENCE_EXTENSION_RE = /\.(?:md|mdc|txt|rst|json|jsonc|ya?ml|toml|conf|sh|ps1|js|cjs|mjs|ts|tsx|jsx|cts|mts|py|go|rs|java|kt|kts|gradle|cs|rb|php|swift|pbxproj|xcconfig|xcworkspace|xcodeproj|h|hpp|c|cc|cpp|m|mm|sql|ini|cfg|properties|xml|html|css|scss|sass|lock)$/i;
const KNOWN_DOMAIN_TLDS = new Set([
  'ai',
  'app',
  'co',
  'com',
  'dev',
  'io',
  'net',
  'org',
  'sh',
]);
const KNOWN_HIDDEN_PATH_SEGMENTS = new Set([
  '.claude',
  '.codex',
  '.cursor',
  '.gemini',
  '.github',
  '.opencode',
  '.vscode',
  '.windsurf',
]);
const FRAMEWORK_LABEL_TOKENS = new Set([
  'd3.js',
  'go',
  'golang',
  'javascript',
  'kotlin',
  'next',
  'next.js',
  'node',
  'node.js',
  'python',
  'rust',
  'swift',
  'typescript',
]);

const LOCAL_MCP_BINARIES = new Set([
  'context7-mcp',
  'nerviq-mcp',
]);

const STACK_CLAIMS = [
  { key: 'go', label: 'Go', stackKeys: ['go'], patterns: [/\bprimary (?:language|stack)\s*:\s*(?:go|golang)\b/i, /\bthis (?:repo|project|service|codebase|app|microservice)\b[\s\S]{0,40}\b(?:go|golang)\b/i, /\bwritten in\s+(?:go|golang)\b/i] },
  { key: 'python', label: 'Python', stackKeys: ['python', 'django', 'fastapi'], patterns: [/\bprimary (?:language|stack)\s*:\s*python\b/i, /\bthis (?:repo|project|service|codebase|app|microservice)\b[\s\S]{0,40}\bpython\b/i, /\bwritten in\s+python\b/i] },
  { key: 'node', label: 'Node.js', stackKeys: ['node'], patterns: [/\bprimary (?:language|stack)\s*:\s*(?:node|node\.js)\b/i, /\bthis (?:repo|project|service|codebase|app|microservice)\b[\s\S]{0,40}\bnode(?:\.js)?\b/i] },
  { key: 'javascript', label: 'JavaScript', stackKeys: ['node'], patterns: [/\bprimary (?:language|stack)\s*:\s*javascript\b/i, /\bpure javascript project\b/i, /\bthis (?:repo|project|codebase|app)\b[\s\S]{0,40}\bjavascript\b/i] },
  { key: 'typescript', label: 'TypeScript', stackKeys: ['typescript', 'node'], patterns: [/\bprimary (?:language|stack)\s*:\s*typescript\b/i, /\buse\s+typescript\b/i, /\btypescript strict mode\b/i, /\bthis (?:repo|project|codebase|app)\b[\s\S]{0,40}\btypescript\b/i] },
  { key: 'rust', label: 'Rust', stackKeys: ['rust'], patterns: [/\bprimary (?:language|stack)\s*:\s*rust\b/i, /\bthis (?:repo|project|service|codebase|app)\b[\s\S]{0,40}\brust\b/i] },
  { key: 'java', label: 'Java', stackKeys: ['java'], patterns: [/\bprimary (?:language|stack)\s*:\s*java\b/i, /\bthis (?:repo|project|service|codebase|app)\b[\s\S]{0,40}\bjava\b/i] },
  { key: 'kotlin', label: 'Kotlin', stackKeys: ['kotlin'], patterns: [/\bprimary (?:language|stack)\s*:\s*kotlin\b/i, /\bthis (?:repo|project|service|codebase|app)\b[\s\S]{0,40}\bkotlin\b/i] },
  { key: 'ruby', label: 'Ruby', stackKeys: ['ruby'], patterns: [/\bprimary (?:language|stack)\s*:\s*ruby\b/i, /\bthis (?:repo|project|service|codebase|app)\b[\s\S]{0,40}\bruby\b/i] },
  { key: 'php', label: 'PHP', stackKeys: ['php', 'laravel'], patterns: [/\bprimary (?:language|stack)\s*:\s*php\b/i, /\bthis (?:repo|project|service|codebase|app)\b[\s\S]{0,40}\bphp\b/i] },
  { key: 'dotnet', label: '.NET', stackKeys: ['dotnet'], patterns: [/\bprimary (?:language|stack)\s*:\s*(?:\.net|dotnet|c#)\b/i, /\bthis (?:repo|project|service|codebase|app)\b[\s\S]{0,40}\b(?:\.net|dotnet|c#)\b/i] },
  { key: 'swift', label: 'Swift', stackKeys: ['swift'], patterns: [/\bprimary (?:language|stack)\s*:\s*swift\b/i, /\bthis (?:repo|project|service|codebase|app)\b[\s\S]{0,40}\bswift\b/i] },
  { key: 'flutter', label: 'Flutter', stackKeys: ['flutter'], patterns: [/\bprimary (?:language|stack)\s*:\s*flutter\b/i, /\bthis (?:repo|project|service|codebase|app)\b[\s\S]{0,40}\bflutter\b/i] },
];

const STACK_CLAIM_BY_KEY = new Map(STACK_CLAIMS.map((claim) => [claim.key, claim]));

function toPosix(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function existsSyncSafe(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

function isLikelyTextFile(relPath) {
  const base = path.posix.basename(toPosix(relPath));
  if (SPECIAL_FILE_BASENAMES.has(base)) return true;
  if (COMMON_DOTFILE_BASENAMES.has(base)) return true;
  if (base === '.cursorrules' || base === '.windsurfrules') return true;
  return hasKnownFileExtension(base);
}

function fileExists(ctx, relPath) {
  return existsSyncSafe(path.join(ctx.dir, relPath));
}

function listFilesRecursive(rootDir, relDir = '', output = []) {
  const absDir = path.join(rootDir, relDir);
  let entries = [];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return output;
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const nextRel = toPosix(path.join(relDir, entry.name));
    if (entry.isDirectory()) {
      listFilesRecursive(rootDir, nextRel, output);
      continue;
    }
    if (entry.isFile() && isLikelyTextFile(nextRel)) {
      output.push(nextRel);
    }
  }
  return output;
}

function getAgentConfigFiles(ctx) {
  if (Array.isArray(ctx.__nerviqShallowRiskFiles)) {
    return ctx.__nerviqShallowRiskFiles;
  }

  const files = new Set();

  for (const relPath of ROOT_AGENT_FILES) {
    if (fileExists(ctx, relPath)) {
      files.add(toPosix(relPath));
    }
  }

  for (const relDir of ROOT_AGENT_DIRS) {
    if (!existsSyncSafe(path.join(ctx.dir, relDir))) continue;
    for (const relPath of listFilesRecursive(ctx.dir, relDir)) {
      files.add(toPosix(relPath));
    }
  }

  ctx.__nerviqShallowRiskFiles = [...files]
    .filter((relPath) => {
      try {
        const size = fs.statSync(path.join(ctx.dir, relPath)).size;
        return Number.isFinite(size) && size <= 512 * 1024;
      } catch {
        return false;
      }
    })
    .sort();

  return ctx.__nerviqShallowRiskFiles;
}

function platformForFile(relPath) {
  const normalized = toPosix(relPath);
  if (normalized === 'CLAUDE.md' || normalized.startsWith('.claude/')) return 'claude';
  if (normalized === 'AGENTS.md' || normalized.startsWith('.codex/')) return 'codex';
  if (normalized === 'GEMINI.md' || normalized.startsWith('.gemini/')) return 'gemini';
  if (normalized === '.cursorrules' || normalized.startsWith('.cursor/')) return 'cursor';
  if (normalized === '.windsurfrules' || normalized.startsWith('.windsurf/')) return 'windsurf';
  if (normalized.startsWith('.aider.')) return 'aider';
  if (normalized.startsWith('.github/') || normalized.startsWith('.vscode/')) return 'copilot';
  if (normalized === 'opencode.json' || normalized.startsWith('.opencode/')) return 'opencode';
  if (normalized === '.mcp.json') return 'claude';
  return 'agent';
}

function getAgentConfigEntries(ctx) {
  if (Array.isArray(ctx.__nerviqShallowRiskEntries)) {
    return ctx.__nerviqShallowRiskEntries;
  }

  ctx.__nerviqShallowRiskEntries = getAgentConfigFiles(ctx)
    .map((file) => {
      const content = ctx.fileContent(file);
      if (!content || !content.trim()) return null;
      return {
        path: file,
        platform: platformForFile(file),
        content,
      };
    })
    .filter(Boolean);

  return ctx.__nerviqShallowRiskEntries;
}

function stripWrapperChars(value) {
  return String(value || '')
    .replace(/^[`"'(<\[]+/, '')
    .replace(/[`"')>\].,:;!?]+$/, '');
}

function normalizeCandidatePath(rawValue) {
  let value = stripWrapperChars(rawValue);
  if (value.startsWith('@')) value = value.slice(1);
  if (/^mdc:/i.test(value)) value = value.slice(4);
  return value;
}

function hasKnownFileExtension(baseName) {
  return FILE_REFERENCE_EXTENSION_RE.test(baseName || '');
}

function isVersionLikeToken(candidate) {
  return /^v?\d+(?:\.\d+)+(?:[a-z]+\d*|\.[xX*])?$/i.test(candidate || '');
}

function isFrameworkLabelToken(candidate) {
  return FRAMEWORK_LABEL_TOKENS.has(String(candidate || '').toLowerCase());
}

function isDomainLikeToken(candidate) {
  if (!candidate || candidate.includes('/')) return false;
  const parts = String(candidate).split('.');
  if (parts.length < 2) return false;
  const tld = parts[parts.length - 1].toLowerCase();
  if (!KNOWN_DOMAIN_TLDS.has(tld)) return false;
  return parts.slice(0, -1).every((part) => /^[A-Za-z0-9-]+$/.test(part));
}

function lineHasExampleContext(line) {
  const text = String(line || '');
  if (/^\s*\|/.test(text)) return true;
  if (/^\s*#{1,6}\s+/.test(text)) return true;
  return /\b(?:e\.g\.?|for example|examples?|sample|placeholder|template|snippet|user request|problem|solution)\b/i.test(text);
}

function looksLikeRelativeFileReference(candidate) {
  if (!candidate) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate)) return false;
  if (candidate.startsWith('#')) return false;
  if (/[<>{}|]/.test(candidate)) return false;

  const normalized = candidate.replace(/^\.\//, '');
  const base = path.posix.basename(normalized);
  const lowered = normalized.toLowerCase();

  if (isDomainLikeToken(normalized)) return false;
  if (isVersionLikeToken(normalized)) return false;
  if (isFrameworkLabelToken(normalized)) return false;
  if (base.startsWith('.') && !COMMON_DOTFILE_BASENAMES.has(base) && !COMMON_DOTFILE_BASENAMES.has(lowered)) {
    return false;
  }
  if (normalized.split('/').some((segment) => /^\.[A-Za-z0-9_-]+$/.test(segment) && !COMMON_DOTFILE_BASENAMES.has(segment.toLowerCase()) && !KNOWN_HIDDEN_PATH_SEGMENTS.has(segment.toLowerCase()))) {
    return false;
  }
  if (/^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*){2,}$/i.test(normalized) && !hasKnownFileExtension(base)) {
    return false;
  }
  if (/^\.[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+$/.test(base) && !COMMON_DOTFILE_BASENAMES.has(base) && !COMMON_DOTFILE_BASENAMES.has(lowered)) {
    return false;
  }

  if (KNOWN_CONVENTION_PATHS.has(normalized) || SPECIAL_FILE_BASENAMES.has(base) || COMMON_DOTFILE_BASENAMES.has(base) || COMMON_DOTFILE_BASENAMES.has(lowered)) {
    return true;
  }

  return hasKnownFileExtension(base);
}

function resolveRepoPath(ctx, fromFile, candidate, mode = 'relative-to-file') {
  const normalized = toPosix(candidate.replace(/^\.\//, ''));
  const baseDir = mode === 'repo-root'
    ? ctx.dir
    : path.join(ctx.dir, path.posix.dirname(toPosix(fromFile)));
  const absolute = path.resolve(baseDir, normalized);
  const root = path.resolve(ctx.dir);

  if (!(absolute === root || absolute.startsWith(`${root}${path.sep}`))) {
    return null;
  }

  return toPosix(path.relative(root, absolute));
}

function getScannableLines(content) {
  const lines = String(content || '').split(/\r?\n/);
  const output = [];
  let fence = null;
  let htmlComment = false;
  let frontmatter = false;
  let frontmatterConsumed = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!frontmatterConsumed && index === 0 && /^(---|\+\+\+)$/.test(trimmed)) {
      frontmatter = true;
      frontmatterConsumed = true;
      continue;
    }

    if (frontmatter) {
      if (/^(---|\+\+\+)$/.test(trimmed)) {
        frontmatter = false;
      }
      continue;
    }

    if (!fence && htmlComment) {
      if (trimmed.includes('-->')) {
        htmlComment = false;
      }
      continue;
    }

    if (!fence && /^(```|~~~)/.test(trimmed)) {
      fence = trimmed.slice(0, 3);
      continue;
    }

    if (fence) {
      if (trimmed.startsWith(fence)) {
        fence = null;
      }
      continue;
    }

    if (/^<!--/.test(trimmed)) {
      if (!trimmed.includes('-->')) {
        htmlComment = true;
      }
      continue;
    }

    output.push({ lineNumber: index + 1, text: line });
  }

  return output;
}

function buildFinding(pattern, ctx, finding) {
  const evidence = resolveEvidence(pattern.key, ctx, {
    file: finding.file,
    line: finding.line,
  });

  return {
    key: pattern.key,
    id: null,
    name: pattern.name,
    category: 'shallow-risk',
    layer: LAYERS.SHALLOW_RISK,
    severity: finding.severity || pattern.severity,
    impact: finding.severity || pattern.severity,
    rating: null,
    passed: false,
    file: evidence ? evidence.file : (finding.file || null),
    line: evidence ? evidence.line : (finding.line || null),
    snippet: evidence ? evidence.snippet : (finding.snippet || null),
    fix: finding.fix || null,
    sourceUrl: finding.sourceUrl || pattern.sourceUrl || SHALLOW_RISK_DOC_URL,
  };
}

function isKnownConventionPath(relPath) {
  const normalized = toPosix(relPath).replace(/^\.\//, '');
  return KNOWN_CONVENTION_PATHS.has(normalized);
}

function findFirstRepoPath(ctx, matcher, options = {}) {
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 4;
  const queue = [{ absDir: ctx.dir, relDir: '', depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current.absDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const relPath = toPosix(path.join(current.relDir, entry.name));
      const absPath = path.join(current.absDir, entry.name);

      if (entry.isFile()) {
        if (typeof matcher === 'function' ? matcher(relPath, entry.name) : matcher === relPath) {
          return relPath;
        }
        continue;
      }

      if (entry.isDirectory() && current.depth < maxDepth) {
        queue.push({ absDir: absPath, relDir: relPath, depth: current.depth + 1 });
      }
    }
  }

  return null;
}

function findFirstStackEvidence(ctx, stackKey) {
  const stack = STACKS[stackKey];
  if (!stack) return null;

  for (const probe of stack.files || []) {
    if (fileExists(ctx, probe)) return probe;
  }

  return findFirstRepoPath(ctx, (_relPath, baseName) => (stack.files || []).includes(baseName));
}

function getDetectedStackEvidence(ctx) {
  if (Array.isArray(ctx.__nerviqShallowRiskStackEvidence)) {
    return ctx.__nerviqShallowRiskStackEvidence;
  }

  const seen = new Set();
  const evidence = [];

  for (const stack of ctx.detectStacks(STACKS)) {
    if (seen.has(stack.key)) continue;
    seen.add(stack.key);
    const file = findFirstStackEvidence(ctx, stack.key);
    if (!file) continue;
    evidence.push({
      key: stack.key,
      label: stack.label,
      file,
    });
  }

  ctx.__nerviqShallowRiskStackEvidence = evidence;
  return evidence;
}

function detectClaimOnLine(line) {
  for (const claim of STACK_CLAIMS) {
    for (const pattern of claim.patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        return claim;
      }
    }
  }
  return null;
}

function collectStackClaims(ctx) {
  if (Array.isArray(ctx.__nerviqShallowRiskClaims)) {
    return ctx.__nerviqShallowRiskClaims;
  }

  const claims = [];

  for (const entry of getAgentConfigEntries(ctx)) {
    for (const { lineNumber, text } of getScannableLines(entry.content)) {
      const claim = detectClaimOnLine(text);
      if (!claim) continue;
      claims.push({
        key: claim.key,
        label: claim.label,
        stackKeys: claim.stackKeys,
        file: entry.path,
        line: lineNumber,
        platform: entry.platform,
        text,
      });
    }
  }

  ctx.__nerviqShallowRiskClaims = claims;
  return claims;
}

function getClaimByKey(key) {
  return STACK_CLAIM_BY_KEY.get(key) || null;
}

function isClearlyLocalMcpBinary(command) {
  if (!command) return false;
  const base = path.posix.basename(toPosix(command)).toLowerCase();
  if (LOCAL_MCP_BINARIES.has(base)) return true;
  if (/^(node|npx|python|python3|bash|sh|pwsh|powershell)$/i.test(base)) return false;
  return /(?:^|[-_.])mcp$/i.test(base) || /-mcp\b/i.test(base);
}

function getHookCommandPath(command) {
  if (typeof command !== 'string' || !command.trim()) return null;
  const tokens = command.match(/"[^"]+"|'[^']+'|\S+/g) || [];
  const cleaned = tokens.map((token) => token.replace(/^['"]|['"]$/g, ''));
  if (cleaned.length === 0) return null;

  const first = cleaned[0];
  if (looksLikeRelativeFileReference(first)) return first;

  if (/^(node|python|python3|bash|sh|pwsh|powershell)$/i.test(first)) {
    const second = cleaned[1];
    if (!second || /^-(?:e|c|Command|EncodedCommand)$/.test(second)) return null;
    if (looksLikeRelativeFileReference(second)) return second;
  }

  return null;
}

function hasLegacyAiderPin(ctx) {
  const files = [
    'requirements.txt',
    'requirements-dev.txt',
    'requirements-dev.in',
    'pyproject.toml',
  ];

  const legacyVersion = /(?:aider|aider-chat)\s*(?:==|~=|<=|<)\s*0\.(\d+)/ig;
  for (const file of files) {
    const content = ctx.fileContent(file) || '';
    legacyVersion.lastIndex = 0;
    let match = legacyVersion.exec(content);
    while (match) {
      const minor = Number(match[1]);
      if (Number.isFinite(minor) && minor < 60) {
        return true;
      }
      match = legacyVersion.exec(content);
    }
  }

  return false;
}

module.exports = {
  AIDER_P0_SOURCES,
  SHALLOW_RISK_BANNER,
  SHALLOW_RISK_BANNER_LINES,
  SHALLOW_RISK_DOC_URL,
  buildFinding,
  collectStackClaims,
  escapeRegExp,
  fileExists,
  findFirstRepoPath,
  findFirstStackEvidence,
  getAgentConfigEntries,
  getAgentConfigFiles,
  getClaimByKey,
  getDetectedStackEvidence,
  getHookCommandPath,
  getScannableLines,
  hasLegacyAiderPin,
  isClearlyLocalMcpBinary,
  isKnownConventionPath,
  lineHasExampleContext,
  looksLikeRelativeFileReference,
  normalizeCandidatePath,
  platformForFile,
  resolveRepoPath,
  toPosix,
};
