'use strict';

const path = require('path');

const {
  SHALLOW_RISK_DOC_URL,
  escapeRegExp,
  findFirstRepoPath,
  getAgentConfigEntries,
  getScannableLines,
  isKnownConventionPath,
  lineHasExampleContext,
  looksLikeRelativeFileReference,
  normalizeCandidatePath,
  resolveRepoPath,
  toPosix,
} = require('../shared');

const POINTER_RE = /(?:^|[\s([`'"])(@?(?:\.{1,2}\/)?[A-Za-z0-9._/-]+)(?=$|[\s)\]`'",:;!?])/g;
const MARKDOWN_LINK_RE = /\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const BACKTICK_TOKEN_RE = /`([^`]+)`/g;
const PLACEHOLDER_PATH_RE = /(?:^|\/)(?:path(?:_to)?|to)(?:\/|$)|(?:^|\/)test_file\.py$|(?:^|\/)path_to_test\.py$|(?:^|\/)module_name\.[A-Za-z0-9._-]+$/i;
const ENV_POLICY_RE = /\b(?:dotenv|environment variables?|api keys?|secrets?|credential|gitignore|removed\s+\.env|look for\s+\.env|via\s+`?\.env|defaults?\s+to|do not commit)\b/i;
const OWNERSHIP_CONTEXT_RE = /\b(?:subdirectory|integration|folder|workspace|extension|module|package|component|app|generated file|composition root|entrypoint|directory structure|utility functions|updated in|register feature|build from)s?(?:['’]s)?\b/i;
const SOFT_REFERENCE_CONTEXT_RE = /\b(?:can be deleted afterwards|quality scale|search result|scrape the web page content)\b/i;
const ALWAYS_AMBIGUOUS_BASENAMES = new Set([
  'findings.md',
  'manifest.json',
  'progress.md',
  'quality_scale.yaml',
  'task_plan.md',
  'todo.md',
]);

function repoHasBasename(ctx, basename, state) {
  if (!basename) {
    return false;
  }
  if (state.basenameCache.has(basename)) {
    return state.basenameCache.get(basename);
  }

  const match = findFirstRepoPath(ctx, (_relPath, entryName) => entryName === basename, { maxDepth: 10 });
  const exists = Boolean(match);
  state.basenameCache.set(basename, exists);
  return exists;
}

function repoHasPathSuffix(ctx, candidate, state) {
  const normalized = toPosix(candidate || '').replace(/^\.?\//, '');
  if (!normalized) {
    return false;
  }
  if (state.suffixCache.has(normalized)) {
    return state.suffixCache.get(normalized);
  }

  const match = findFirstRepoPath(
    ctx,
    (relPath) => {
      const normalizedPath = toPosix(relPath);
      return normalizedPath === normalized || normalizedPath.endsWith(`/${normalized}`);
    },
    { maxDepth: 10 },
  );
  const exists = Boolean(match);
  state.suffixCache.set(normalized, exists);
  return exists;
}

function lineHasEnvPolicyContext(line) {
  return ENV_POLICY_RE.test(String(line || ''));
}

function lineHasScopedOwnershipContext(line) {
  const text = String(line || '');
  return OWNERSHIP_CONTEXT_RE.test(text) || SOFT_REFERENCE_CONTEXT_RE.test(text) || /<[^>]+>/.test(text);
}

function extractLineAnchors(line) {
  const anchors = new Set();
  const text = String(line || '');

  BACKTICK_TOKEN_RE.lastIndex = 0;
  let match = BACKTICK_TOKEN_RE.exec(text);
  while (match) {
    const rawToken = String(match[1] || '');
    const token = normalizeCandidatePath(rawToken)
      .replace(/<[^>]+>/g, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    if (!token || !rawToken.includes('/')) {
      match = BACKTICK_TOKEN_RE.exec(text);
      continue;
    }
    anchors.add(token);
    match = BACKTICK_TOKEN_RE.exec(text);
  }

  MARKDOWN_LINK_RE.lastIndex = 0;
  match = MARKDOWN_LINK_RE.exec(text);
  while (match) {
    const rawToken = String(match[1] || '');
    const token = normalizeCandidatePath(rawToken)
      .replace(/<[^>]+>/g, '')
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
    if (!token || !rawToken.includes('/')) {
      match = MARKDOWN_LINK_RE.exec(text);
      continue;
    }
    anchors.add(token);
    match = MARKDOWN_LINK_RE.exec(text);
  }

  return [...anchors];
}

function anchorDirsForToken(token) {
  if (!token) {
    return [];
  }

  const normalized = normalizeCandidatePath(token)
    .replace(/<[^>]+>/g, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  if (!normalized) {
    return [];
  }

  const dirs = new Set();
  const looksFileLike = looksLikeRelativeFileReference(normalized);
  const direct = normalized.includes('/')
    ? (looksFileLike ? path.posix.dirname(normalized) : normalized)
    : normalized;
  if (direct && direct !== '.') {
    dirs.add(direct);
  }

  const parent = path.posix.dirname(direct || normalized);
  if (parent && parent !== '.' && parent !== direct) {
    dirs.add(parent);
  }

  return [...dirs];
}

function lineResolvesBareCandidate(ctx, line, candidate, state) {
  const base = path.posix.basename(candidate);
  const anchors = extractLineAnchors(line);

  for (const anchor of anchors) {
    const normalizedAnchor = normalizeCandidatePath(anchor);
    if (path.posix.basename(normalizedAnchor) === base && (ctx.fileContent(normalizedAnchor) !== null || repoHasPathSuffix(ctx, normalizedAnchor, state))) {
      return true;
    }

    for (const dir of anchorDirsForToken(anchor)) {
      const match = findFirstRepoPath(
        ctx,
        (relPath, entryName) => entryName === base && toPosix(relPath).startsWith(`${dir}/`),
        { maxDepth: 10 },
      );
      if (match) {
        return true;
      }
    }
  }

  if (anchors.length > 0 && repoHasBasename(ctx, base, state)) {
    return true;
  }

  if (lineHasScopedOwnershipContext(line) && repoHasBasename(ctx, base, state)) {
    return true;
  }

  return false;
}

function lineHasAnchorContext(line) {
  return extractLineAnchors(line).length > 0;
}

function lineResolvesPathSuffix(ctx, line, candidate, state) {
  if (!candidate || !candidate.includes('/')) {
    return false;
  }
  if (!lineHasAnchorContext(line) && !lineHasScopedOwnershipContext(line)) {
    return false;
  }
  return repoHasPathSuffix(ctx, candidate, state);
}

function shouldIgnoreCandidate(ctx, line, candidate, state) {
  const normalized = String(candidate || '');
  const base = path.posix.basename(normalized);
  if (!normalized) {
    return true;
  }
  if (PLACEHOLDER_PATH_RE.test(normalized)) {
    return true;
  }
  if (ALWAYS_AMBIGUOUS_BASENAMES.has(base) && repoHasBasename(ctx, base, state)) {
    return true;
  }
  if (SOFT_REFERENCE_CONTEXT_RE.test(String(line || '')) && (base === 'PLAN.md' || base === 'web_scraper.py')) {
    return true;
  }
  if (normalized === '.env' && lineHasEnvPolicyContext(line)) {
    return true;
  }
  if (lineResolvesPathSuffix(ctx, line, normalized, state)) {
    return true;
  }
  if (!normalized.includes('/') && lineResolvesBareCandidate(ctx, line, normalized, state)) {
    return true;
  }
  return false;
}

function resolveMissingCandidate(ctx, fromFile, candidate) {
  const isNestedAgentDoc = toPosix(fromFile).includes('/');
  const prefersRepoRoot = isNestedAgentDoc && !candidate.startsWith('../');
  const modes = prefersRepoRoot
    ? ['repo-root', 'relative-to-file']
    : ['relative-to-file', 'repo-root'];

  let firstMissing = null;
  for (const mode of modes) {
    const resolvedPath = resolveRepoPath(ctx, fromFile, candidate, mode);
    if (!resolvedPath || isKnownConventionPath(resolvedPath)) {
      continue;
    }
    if (!firstMissing) {
      firstMissing = resolvedPath;
    }
    if (ctx.fileContent(resolvedPath) !== null) {
      return { exists: true, resolvedPath };
    }
  }

  return { exists: false, resolvedPath: firstMissing };
}

function rewriteMarkdownLinksForScanning(text) {
  return String(text || '').replace(MARKDOWN_LINK_RE, (_match, target) => ` ${target} `);
}

module.exports = {
  key: 'agent-config-missing-file',
  name: 'Agent config references missing file',
  severity: 'high',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  owaspTags: ['agentic-top-10:tool-instruction-integrity'],
  run(ctx) {
    const findings = [];
    const seen = new Set();
    const state = {
      basenameCache: new Map(),
      suffixCache: new Map(),
    };

    for (const entry of getAgentConfigEntries(ctx)) {
      if (!/\.(?:md|mdc|txt|rst)$/i.test(entry.path) && !/\.cursorrules$|\.windsurfrules$/i.test(entry.path)) {
        continue;
      }
      for (const { lineNumber, text } of getScannableLines(entry.content)) {
        const scanText = rewriteMarkdownLinksForScanning(text);
        POINTER_RE.lastIndex = 0;
        let match = POINTER_RE.exec(scanText);
        while (match) {
          const candidate = normalizeCandidatePath(match[1]);
          if (!looksLikeRelativeFileReference(candidate)) {
            match = POINTER_RE.exec(scanText);
            continue;
          }

          if (lineHasExampleContext(text)) {
            match = POINTER_RE.exec(scanText);
            continue;
          }

          if (shouldIgnoreCandidate(ctx, text, candidate, state)) {
            match = POINTER_RE.exec(scanText);
            continue;
          }

          const resolution = resolveMissingCandidate(ctx, entry.path, candidate);
          if (!resolution.resolvedPath || resolution.exists) {
            match = POINTER_RE.exec(scanText);
            continue;
          }
          const resolvedPath = resolution.resolvedPath;

          const dedupeKey = `${entry.path}:${toPosix(resolvedPath)}`;
          if (seen.has(dedupeKey)) {
            match = POINTER_RE.exec(scanText);
            continue;
          }
          seen.add(dedupeKey);

          findings.push({
            file: entry.path,
            line: lineNumber || ctx.lineNumber(entry.path, new RegExp(escapeRegExp(candidate))),
            fix: `${entry.path} references \`${toPosix(resolvedPath)}\`, but the file is missing. Create the file or update the agent guidance to point at a real repo path.`,
          });

          match = POINTER_RE.exec(scanText);
        }
      }
    }

    return findings;
  },
};
