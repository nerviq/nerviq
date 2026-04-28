'use strict';

const path = require('path');
const {
  SHALLOW_RISK_DOC_URL,
  fileExists,
  getAgentConfigEntries,
  getScannableLines,
} = require('../shared');

// Match common JS package-manager script invocations:
//   npm test
//   npm run <name>
//   pnpm <name>           (pnpm <script> is shorthand for pnpm run <script>)
//   pnpm run <name>
//   yarn <name>           (yarn <script> is shorthand)
//   yarn run <name>
//   bun run <name>
//   bunx <name>           (bunx is similar to npx — out of scope; we don't flag this)
const SCRIPT_INVOCATION_RE = /\b(npm|pnpm|yarn|bun)(?:\s+run)?\s+([A-Za-z][\w:-]*)\b/g;

// Built-in npm/yarn/pnpm/bun lifecycle scripts that don't need to exist in
// `scripts`. `npm test` will run a default echo if no `test` script exists,
// but we still flag missing `test` because agent guidance to "run npm test"
// when no script exists IS actionable repo-guidance drift.
// We exclude only commands that are truly built-in package-manager verbs
// without script-name semantics (install, ci, audit, ls, etc.).
const PACKAGE_MANAGER_BUILTINS = new Set([
  'install', 'i', 'ci', 'add', 'remove', 'rm', 'update', 'up', 'upgrade',
  'audit', 'ls', 'list', 'outdated', 'init', 'pack', 'publish', 'unpublish',
  'view', 'info', 'help', 'version', 'config', 'login', 'logout', 'whoami',
  'link', 'unlink', 'prefix', 'doctor', 'exec', 'create', 'dlx',
  // Common in pnpm/yarn-only:
  'why', 'fund', 'workspace', 'workspaces', 'recursive', 'r',
  // bun-only verbs:
  'add', 'remove', 'install',
]);

function readPackageJsonScripts(ctx) {
  if (ctx.__nerviqPackageJsonScripts !== undefined) {
    return ctx.__nerviqPackageJsonScripts;
  }
  if (!fileExists(ctx, 'package.json')) {
    ctx.__nerviqPackageJsonScripts = null;
    return null;
  }
  const raw = ctx.fileContent('package.json');
  if (!raw) {
    ctx.__nerviqPackageJsonScripts = null;
    return null;
  }
  try {
    const pkg = JSON.parse(raw);
    const scripts = (pkg && pkg.scripts && typeof pkg.scripts === 'object') ? pkg.scripts : {};
    const set = new Set(Object.keys(scripts));
    ctx.__nerviqPackageJsonScripts = set;
    return set;
  } catch {
    ctx.__nerviqPackageJsonScripts = null;
    return null;
  }
}

module.exports = {
  key: 'agent-config-script-not-in-package-json',
  name: 'Agent config references npm script that does not exist',
  severity: 'high',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  owaspTags: ['agentic-top-10:tool-instruction-integrity'],
  run(ctx) {
    const scripts = readPackageJsonScripts(ctx);
    if (!scripts) return [];

    const findings = [];
    const seenPerFile = new Map();

    for (const entry of getAgentConfigEntries(ctx)) {
      const lines = getScannableLines(entry.content);
      for (const { lineNumber, text } of lines) {
        SCRIPT_INVOCATION_RE.lastIndex = 0;
        let match;
        while ((match = SCRIPT_INVOCATION_RE.exec(text)) !== null) {
          const scriptName = match[2];
          if (!scriptName) continue;
          if (PACKAGE_MANAGER_BUILTINS.has(scriptName.toLowerCase())) continue;
          if (scripts.has(scriptName)) continue;
          // Skip if the agent doc explicitly notes the script is missing
          // (e.g., a corrective note like "(does NOT define `npm test`...)")
          if (/\b(?:does\s+not|doesn['’]t|don['’]t)\s+(?:define|have|exist)/i.test(text)) continue;
          if (/\bdo NOT define\b/i.test(text)) continue;

          const dedupeKey = `${entry.path}|${scriptName}`;
          if (seenPerFile.has(dedupeKey)) continue;
          seenPerFile.set(dedupeKey, true);

          findings.push({
            file: entry.path,
            line: lineNumber,
            fix: `${entry.path} tells the agent to run \`${match[1]} ${scriptName === 'test' || scriptName === 'start' ? scriptName : `run ${scriptName}`}\`, but \`scripts.${scriptName}\` is not defined in package.json. Either add the script to package.json, or rewrite the agent guidance to reflect what actually exists.`,
          });
        }
      }
    }

    return findings;
  },
};
