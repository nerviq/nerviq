/**
 * Evidence resolver — CTO-04 trust-recovery depth.
 *
 * Given a failed check key and a ProjectContext, returns
 * `{ file, line, snippet }` when the finding lives at a specific
 * file location in the repo, or `null` when the check is genuinely
 * not file-level (e.g. "absence of a file" or meta-property).
 *
 * This is a post-hoc resolver: many technique definitions do not
 * declare `file`/`line` themselves, so we fill evidence in from here
 * using the cached file content already loaded by ProjectContext.
 * No extra filesystem scans are performed.
 *
 * Snippet is a 2-5 line excerpt centered on `line`, length-capped
 * at 300 chars, using `\n` as line separator.
 */

'use strict';

const SNIPPET_RADIUS = 2; // 2 lines before + match + 2 lines after = up to 5 lines
const SNIPPET_MAX_CHARS = 300;

function sliceSnippet(content, line) {
  if (!content || !Number.isFinite(line) || line < 1) return null;
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, line - 1 - SNIPPET_RADIUS);
  const end = Math.min(lines.length, line + SNIPPET_RADIUS);
  let snippet = lines.slice(start, end).join('\n');
  if (snippet.length > SNIPPET_MAX_CHARS) {
    snippet = snippet.slice(0, SNIPPET_MAX_CHARS - 3) + '...';
  }
  return snippet || null;
}

function buildEvidence(ctx, file, line) {
  if (!file) return null;
  const content = typeof ctx.fileContent === 'function' ? ctx.fileContent(file) : null;
  if (!content) return { file, line: line || null, snippet: null };
  const resolvedLine = Number.isFinite(line) && line >= 1 ? line : 1;
  const snippet = sliceSnippet(content, resolvedLine);
  return { file, line: resolvedLine, snippet };
}

// Locate the best-match CLAUDE.md file (root or .claude/).
function claudeMdPath(ctx) {
  if (typeof ctx.fileContent !== 'function') return null;
  if (ctx.fileContent('CLAUDE.md') !== null) return 'CLAUDE.md';
  if (ctx.fileContent('.claude/CLAUDE.md') !== null) return '.claude/CLAUDE.md';
  return null;
}

function agentsMdPath(ctx) {
  if (typeof ctx.fileContent !== 'function') return null;
  if (ctx.fileContent('AGENTS.md') !== null) return 'AGENTS.md';
  return null;
}

// Resolvers return { file, line } or null (category c).
// `file` MUST be a real path that exists; otherwise return null so we do not
// produce misleading evidence.
const RESOLVERS = {
  // --- CLAUDE.md content checks (backport: file=CLAUDE.md, line=1) ---
  claudeMd: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null; // absent → null (category c)
  },
  importSyntax: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  roleDefinition: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  mermaidArchitecture: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  underlines200: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  xmlTags: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  fewShotExamples: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  outputStyleGuidance: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  constraintBlocks: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },

  // CLAUDE.local.md — genuinely absent → null
  claudeLocalMd: (ctx) => {
    if (typeof ctx.fileContent !== 'function') return null;
    return ctx.fileContent('CLAUDE.local.md') !== null
      ? { file: 'CLAUDE.local.md', line: 1 }
      : null;
  },

  // --- .claude/settings.json shape checks ---
  settingsPermissions: (ctx) => {
    if (typeof ctx.fileContent !== 'function') return null;
    if (ctx.fileContent('.claude/settings.json') === null) return null;
    const line = typeof ctx.lineNumber === 'function'
      ? (ctx.lineNumber('.claude/settings.json', /"permissions"/) || 1)
      : 1;
    return { file: '.claude/settings.json', line };
  },
  permissionDeny: (ctx) => {
    if (typeof ctx.fileContent !== 'function') return null;
    if (ctx.fileContent('.claude/settings.json') === null) return null;
    const line = typeof ctx.lineNumber === 'function'
      ? (ctx.lineNumber('.claude/settings.json', /"deny"/) || 1)
      : 1;
    return { file: '.claude/settings.json', line };
  },
  noBypassPermissions: (ctx) => {
    if (typeof ctx.fileContent !== 'function') return null;
    if (ctx.fileContent('.claude/settings.json') === null) return null;
    const line = typeof ctx.lineNumber === 'function'
      ? (ctx.lineNumber('.claude/settings.json', /bypassPermissions|permissionMode/) || 1)
      : 1;
    return { file: '.claude/settings.json', line };
  },
  secretsProtection: (ctx) => {
    if (typeof ctx.fileContent !== 'function') return null;
    if (ctx.fileContent('.claude/settings.json') === null) return null;
    return { file: '.claude/settings.json', line: 1 };
  },

  // --- Hooks files ---
  hooks: (ctx) => {
    if (typeof ctx.fileContent !== 'function') return null;
    if (ctx.fileContent('.claude/settings.json') === null) return null;
    const line = typeof ctx.lineNumber === 'function'
      ? (ctx.lineNumber('.claude/settings.json', /"hooks"/) || 1)
      : 1;
    return { file: '.claude/settings.json', line };
  },
  stopFailureHook: (ctx) => {
    if (typeof ctx.fileContent !== 'function') return null;
    if (ctx.fileContent('.claude/settings.json') === null) return null;
    return { file: '.claude/settings.json', line: 1 };
  },
  hooksNotificationEvent: (ctx) => {
    if (typeof ctx.fileContent !== 'function') return null;
    if (ctx.fileContent('.claude/settings.json') === null) return null;
    return { file: '.claude/settings.json', line: 1 };
  },
  subagentStopHook: (ctx) => {
    if (typeof ctx.fileContent !== 'function') return null;
    if (ctx.fileContent('.claude/settings.json') === null) return null;
    return { file: '.claude/settings.json', line: 1 };
  },

  // --- AGENTS.md (Codex surface) ---
  codexAgentsMd: (ctx) => {
    const p = agentsMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  codexAgentsMdSubstantive: (ctx) => {
    const p = agentsMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  codexAgentsVerificationCommands: (ctx) => {
    const p = agentsMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  codexAgentsArchitecture: (ctx) => {
    const p = agentsMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },

  // --- Auto-memory / governance ---
  autoMemoryAwareness: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  loopSafetyBoundaries: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },

  // --- CLAUDE.md content-awareness checks (backport ~10 more keys) ---
  compactionAwareness: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  contextManagement: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  effortLevelConfigured: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  channelsAwareness: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  worktreeAwareness: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  instinctToSkillProgression: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  sandboxAwareness: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },
  gitAttributionDecision: (ctx) => {
    const p = claudeMdPath(ctx);
    return p ? { file: p, line: 1 } : null;
  },

  // --- MCP ---
  mcpHasEnvConfig: (ctx) => {
    if (typeof ctx.fileContent !== 'function') return null;
    if (ctx.fileContent('.mcp.json') !== null) return { file: '.mcp.json', line: 1 };
    if (ctx.fileContent('.claude/settings.json') !== null) {
      const line = typeof ctx.lineNumber === 'function'
        ? (ctx.lineNumber('.claude/settings.json', /"mcpServers"|"mcp"/) || 1)
        : 1;
      return { file: '.claude/settings.json', line };
    }
    return null;
  },
};

/**
 * Resolve file/line/snippet evidence for a failed check.
 *
 * @param {string} key  Check key (e.g. 'importSyntax').
 * @param {Object} ctx  ProjectContext instance.
 * @param {Object} [existing]  Pre-existing { file, line } from the check itself.
 * @returns {{file:string, line:number|null, snippet:string|null}|null}
 */
function resolveEvidence(key, ctx, existing = null) {
  // If the check already emitted a real file, enrich with snippet only.
  if (existing && existing.file) {
    return buildEvidence(ctx, existing.file, existing.line);
  }
  const resolver = RESOLVERS[key];
  if (!resolver) return null;
  let guess = null;
  try {
    guess = resolver(ctx);
  } catch {
    return null;
  }
  if (!guess || !guess.file) return null;
  return buildEvidence(ctx, guess.file, guess.line);
}

module.exports = {
  resolveEvidence,
  sliceSnippet,
  SNIPPET_MAX_CHARS,
  EVIDENCE_RESOLVER_KEYS: Object.keys(RESOLVERS),
};
