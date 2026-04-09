/**
 * Tools technique fragments.
 * Generated mechanically from the legacy techniques.js monolith during HR-09.
 */

const {
} = require('./shared');

module.exports = {
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
};
