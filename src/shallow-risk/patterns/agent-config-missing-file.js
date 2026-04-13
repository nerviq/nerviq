'use strict';

const {
  SHALLOW_RISK_DOC_URL,
  escapeRegExp,
  getAgentConfigEntries,
  getScannableLines,
  isKnownConventionPath,
  looksLikeRelativeFileReference,
  normalizeCandidatePath,
  resolveRepoPath,
  toPosix,
} = require('../shared');

const POINTER_RE = /(?:^|[\s([`'"])(@?(?:\.{1,2}\/)?[A-Za-z0-9._/-]+)(?=$|[\s)\]`'",:;!?])/g;

module.exports = {
  key: 'agent-config-missing-file',
  name: 'Agent config references missing file',
  severity: 'high',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  run(ctx) {
    const findings = [];
    const seen = new Set();

    for (const entry of getAgentConfigEntries(ctx)) {
      if (!/\.(?:md|mdc|txt|rst)$/i.test(entry.path) && !/\.cursorrules$|\.windsurfrules$/i.test(entry.path)) {
        continue;
      }
      for (const { lineNumber, text } of getScannableLines(entry.content)) {
        POINTER_RE.lastIndex = 0;
        let match = POINTER_RE.exec(text);
        while (match) {
          const candidate = normalizeCandidatePath(match[1]);
          if (!looksLikeRelativeFileReference(candidate)) {
            match = POINTER_RE.exec(text);
            continue;
          }

          const resolvedPath = resolveRepoPath(ctx, entry.path, candidate, 'relative-to-file');
          if (!resolvedPath || isKnownConventionPath(resolvedPath)) {
            match = POINTER_RE.exec(text);
            continue;
          }

          if (ctx.fileContent(resolvedPath) !== null) {
            match = POINTER_RE.exec(text);
            continue;
          }

          const dedupeKey = `${entry.path}:${toPosix(resolvedPath)}`;
          if (seen.has(dedupeKey)) {
            match = POINTER_RE.exec(text);
            continue;
          }
          seen.add(dedupeKey);

          findings.push({
            file: entry.path,
            line: lineNumber || ctx.lineNumber(entry.path, new RegExp(escapeRegExp(candidate))),
            fix: `${entry.path} references \`${toPosix(resolvedPath)}\`, but the file is missing. Create the file or update the agent guidance to point at a real repo path.`,
          });

          match = POINTER_RE.exec(text);
        }
      }
    }

    return findings;
  },
};
