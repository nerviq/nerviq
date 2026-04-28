'use strict';

const {
  SHALLOW_RISK_DOC_URL,
  escapeRegExp,
  isClearlyLocalMcpBinary,
} = require('../shared');

function hasBroadOpenPermissions(server) {
  if (!server || typeof server !== 'object') return false;
  if (Array.isArray(server.permissions) && server.permissions.length === 0) return true;
  if (server.allow === '*') return true;
  if (Array.isArray(server.allow) && server.allow.includes('*')) return true;
  if (server.permissions && typeof server.permissions === 'object') {
    if (server.permissions.allow === '*') return true;
    if (Array.isArray(server.permissions.allow) && server.permissions.allow.includes('*')) return true;
  }
  return false;
}

module.exports = {
  key: 'mcp-server-no-allowlist',
  name: 'MCP server has no allowlist',
  severity: 'critical',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  owaspTags: ['mcp-top-10:server-allowlist', 'mcp-top-10:tool-poisoning', 'agentic-top-10:excessive-agency'],
  run(ctx) {
    const findings = [];
    const candidates = ['.claude/settings.json', '.mcp.json'];

    for (const file of candidates) {
      const config = ctx.jsonFile(file);
      const servers = config && config.mcpServers && typeof config.mcpServers === 'object'
        ? config.mcpServers
        : null;
      if (!servers) continue;

      for (const [serverName, server] of Object.entries(servers)) {
        if (!hasBroadOpenPermissions(server)) continue;
        const command = typeof server.command === 'string' ? server.command : '';
        findings.push({
          severity: isClearlyLocalMcpBinary(command) ? 'high' : 'critical',
          file,
          line: ctx.lineNumber(file, new RegExp(`"${escapeRegExp(serverName)}"`)) || 1,
          fix: `MCP server "${serverName}" in ${file} has broad access without an allowlist. Add a narrow allow/permissions list before relying on it in CI or production repos.`,
        });
      }
    }

    return findings;
  },
};
