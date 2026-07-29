'use strict';

const {
  SHALLOW_RISK_DOC_URL,
  escapeRegExp,
  getHookCommandPath,
  resolveRepoPath,
} = require('../shared');

// FRESH-2026-07-29: re-read from https://code.claude.com/docs/en/hooks during
// the freshness pass. The list had five entries and the docs now define 30+
// events, so every hook declared under SessionEnd, PreCompact, SubagentStop,
// Notification, FileChanged, ConfigChange, … was silently skipped by a pattern
// whose whole job is finding hooks that silently skip.
const HOOK_EVENTS = new Set([
  // session lifecycle
  'SessionStart', 'Setup', 'SessionEnd',
  // per-turn
  'UserPromptSubmit', 'UserPromptExpansion', 'Stop', 'StopFailure',
  // agentic loop
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch',
  'PermissionRequest', 'PermissionDenied',
  // subagents and teams
  'SubagentStart', 'SubagentStop', 'TeammateIdle',
  // tasks
  'TaskCreated', 'TaskCompleted',
  // environment and files
  'CwdChanged', 'DirectoryAdded', 'FileChanged', 'InstructionsLoaded',
  'ConfigChange', 'WorktreeCreate', 'WorktreeRemove',
  // MCP elicitation
  'Elicitation', 'ElicitationResult',
  // compaction
  'PreCompact', 'PostCompact',
  // display
  'Notification', 'MessageDisplay',
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
  owaspTags: ['agentic-skills-top-10:skill-supply-chain', 'agentic-top-10:tool-instruction-integrity'],
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
