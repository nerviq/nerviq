'use strict';

const {
  SHALLOW_RISK_DOC_URL,
  escapeRegExp,
  getHookCommandPath,
  resolveRepoPath,
} = require('../shared');

const HOOK_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'UserPromptSubmit',
  'SessionStart',
]);

function collectHookCommands(node, output = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectHookCommands(item, output);
    return output;
  }

  if (!node || typeof node !== 'object') {
    return output;
  }

  if (node.type === 'command' && typeof node.command === 'string') {
    output.push(node.command);
  }

  for (const value of Object.values(node)) {
    collectHookCommands(value, output);
  }

  return output;
}

module.exports = {
  key: 'hook-script-missing',
  name: 'Configured hook script is missing',
  severity: 'high',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  run(ctx) {
    const file = '.claude/settings.json';
    const config = ctx.jsonFile(file);
    if (!config || !config.hooks || typeof config.hooks !== 'object') {
      return [];
    }

    const findings = [];
    for (const [eventName, entries] of Object.entries(config.hooks)) {
      if (!HOOK_EVENTS.has(eventName)) continue;
      for (const command of collectHookCommands(entries)) {
        const scriptPath = getHookCommandPath(command);
        if (!scriptPath) continue;
        const resolvedPath = resolveRepoPath(ctx, file, scriptPath, 'repo-root');
        if (!resolvedPath || ctx.fileContent(resolvedPath) !== null) continue;
        findings.push({
          file,
          line: ctx.lineNumber(file, new RegExp(escapeRegExp(command))) || ctx.lineNumber(file, new RegExp(`"${escapeRegExp(eventName)}"`)) || 1,
          fix: `${file} declares a ${eventName} hook at \`${resolvedPath}\`, but the script is missing. Create the hook file or remove the dead hook reference.`,
        });
      }
    }

    return findings;
  },
};
