'use strict';

const {
  SHALLOW_RISK_DOC_URL,
  fileExists,
  getAgentConfigEntries,
  getScannableLines,
} = require('../shared');

// Match common JS package-manager script invocations. Precision matters
// more than recall here — this is the headline "your docs lie" pattern and
// a false positive is a trust-killer (v1.31.0 FP: the prose "npm package /
// Action" in a table matched as `npm run package`). Rules:
//   - `<mgr> run <name>` is always an invocation (all managers).
//   - `npm test|start|stop|restart` are npm's only script shorthands —
//     bare `npm <word>` is NOT valid script syntax and is usually prose.
//   - `pnpm <name>` / `yarn <name>` / `bun <name>` shorthands are real but
//     prose-prone ("yarn workspace", "bun runtime"), so they only count
//     when they appear inside backticks (i.e. written as code).
const RUN_INVOCATION_RE = /\b(npm|pnpm|yarn|bun)\s+run\s+([A-Za-z][\w:-]*)\b/g;
const NPM_ALIAS_RE = /\bnpm\s+(test|start|stop|restart)\b/g;
const SHORTHAND_RE = /\b(pnpm|yarn|bun)\s+([A-Za-z][\w:-]*)\b/g;

function isInsideBacktickSpan(text, index) {
  let count = 0;
  for (let i = 0; i < index; i++) {
    if (text[i] === '`') count += 1;
  }
  return count % 2 === 1;
}

// Corrective notes ("this repo does NOT define `npm run lint` — don't
// pretend it exists") mention missing scripts on purpose; flagging the
// disclaimer itself as a lie is the worst possible FP. Notes wrap across
// lines in real docs ("...package.json does\nNOT define `npm test`..."),
// so detection runs on a two-line sliding window.
const DISCLAIMER_RE = /\b(?:do(?:es)?\s+not|doesn['’]t|don['’]t)\s+(?:define|have|exist)/i;
const SCRIPT_MENTION_RE = /`(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+([A-Za-z][\w:-]*)`/g;

function collectDisclaimedScripts(content) {
  const lines = String(content || '').split(/\r?\n/);
  const disclaimed = new Set();
  for (let i = 0; i < lines.length; i++) {
    const window = i + 1 < lines.length ? `${lines[i]} ${lines[i + 1]}` : lines[i];
    if (!DISCLAIMER_RE.test(window)) continue;
    let match;
    SCRIPT_MENTION_RE.lastIndex = 0;
    while ((match = SCRIPT_MENTION_RE.exec(window)) !== null) {
      disclaimed.add(match[1]);
    }
  }
  return disclaimed;
}

function collectScriptInvocations(text) {
  const invocations = [];
  let match;
  RUN_INVOCATION_RE.lastIndex = 0;
  while ((match = RUN_INVOCATION_RE.exec(text)) !== null) {
    invocations.push({ manager: match[1], scriptName: match[2], viaRun: true });
  }
  NPM_ALIAS_RE.lastIndex = 0;
  while ((match = NPM_ALIAS_RE.exec(text)) !== null) {
    invocations.push({ manager: 'npm', scriptName: match[1], viaRun: false });
  }
  SHORTHAND_RE.lastIndex = 0;
  while ((match = SHORTHAND_RE.exec(text)) !== null) {
    if (match[2] === 'run') continue; // covered by RUN_INVOCATION_RE
    if (!isInsideBacktickSpan(text, match.index)) continue;
    invocations.push({ manager: match[1], scriptName: match[2], viaRun: false });
  }
  return invocations;
}

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
      const disclaimed = collectDisclaimedScripts(entry.content);
      const lines = getScannableLines(entry.content);
      for (const { lineNumber, text } of lines) {
        for (const { manager, scriptName, viaRun } of collectScriptInvocations(text)) {
          if (!scriptName) continue;
          if (PACKAGE_MANAGER_BUILTINS.has(scriptName.toLowerCase())) continue;
          if (scripts.has(scriptName)) continue;
          // Skip scripts the doc itself discloses as missing (corrective notes).
          if (disclaimed.has(scriptName)) continue;
          if (/\b(?:do(?:es)?\s+not|doesn['’]t|don['’]t)\s+(?:define|have|exist)/i.test(text)) continue;

          const dedupeKey = `${entry.path}|${scriptName}`;
          if (seenPerFile.has(dedupeKey)) continue;
          seenPerFile.set(dedupeKey, true);

          findings.push({
            file: entry.path,
            line: lineNumber,
            fix: `${entry.path} tells the agent to run \`${manager} ${viaRun ? `run ${scriptName}` : scriptName}\`, but \`scripts.${scriptName}\` is not defined in package.json. Either add the script to package.json, or rewrite the agent guidance to reflect what actually exists.`,
          });
        }
      }
    }

    return findings;
  },
};
