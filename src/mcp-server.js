#!/usr/bin/env node
/**
 * Nerviq MCP Server
 *
 * Exposes Nerviq capabilities as an MCP (Model Context Protocol) server
 * using stdio transport (stdin/stdout JSON-RPC 2.0).
 *
 * Tools:
 *   nerviq_audit   — run audit for any platform, return JSON results
 *   nerviq_harmony — run harmony-audit, return cross-platform scores
 *   nerviq_setup   — run setup for a platform, return written files list
 *   nerviq_drift   — detect configuration drift between platforms
 *
 * Usage:
 *   node src/mcp-server.js
 *   (or via nerviq-mcp binary)
 *
 * Register in an MCP host config:
 *   {
 *     "mcpServers": {
 *       "nerviq": {
 *         "command": "npx",
 *         "args": ["nerviq-mcp"],
 *         "env": {}
 *       }
 *     }
 *   }
 */

'use strict';

const { version } = require('../package.json');

function buildMcpAuditPayload(result, options = {}) {
  const verbose = Boolean(options.verbose);
  const normalizedCheckCount = typeof result.checkCount === 'number'
    ? result.checkCount
    : typeof result.total === 'number'
      ? result.total
      : 0;

  const payload = {
    platform: result.platform,
    score: result.score,
    passed: result.passed,
    failed: result.failed,
    total: normalizedCheckCount,
    checkCount: normalizedCheckCount,
    scoreType: result.scoreType || 'live-audit-score',
    grade: result.score >= 80 ? 'A' : result.score >= 60 ? 'B' : result.score >= 40 ? 'C' : 'D',
    criticalFailures: (result.results || [])
      .filter(r => r.passed === false && r.impact === 'critical')
      .map(r => ({ key: r.key, id: r.id, name: r.name, fix: r.fix })),
    highFailures: (result.results || [])
      .filter(r => r.passed === false && r.impact === 'high')
      .map(r => ({ key: r.key, id: r.id, name: r.name, fix: r.fix })),
    topNextActions: (result.topNextActions || []).slice(0, 3).map((item) => ({
      key: item.key,
      name: item.name,
      impact: item.impact,
      fix: item.fix,
    })),
    suggestedNextCommand: result.suggestedNextCommand || null,
  };

  if (verbose) {
    payload.results = (result.results || []).map(r => ({
      key: r.key,
      id: r.id,
      name: r.name,
      passed: r.passed,
      impact: r.impact,
      fix: r.passed === false ? r.fix : undefined,
    }));
  }

  return payload;
}

function buildMcpHarmonyPayload(result, options = {}) {
  const verbose = Boolean(options.verbose);
  const payload = {
    harmonyScore: result.harmonyScore,
    activePlatforms: result.activePlatforms || [],
    platformScores: result.platformScores || {},
    driftCount: result.driftCount || (result.drifts || []).length || 0,
    criticalDrifts: (result.drifts || [])
      .filter(d => d.severity === 'critical')
      .map(d => ({ type: d.type, description: d.description, recommendation: d.recommendation })),
    recommendations: (result.recommendations || []).slice(0, 5),
  };

  if (verbose) {
    payload.allDrifts = (result.drifts || []).map(d => ({
      type: d.type,
      severity: d.severity,
      description: d.description,
      recommendation: d.recommendation,
    }));
  }

  return payload;
}

// ─── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'nerviq_audit',
    description: 'Run a Nerviq audit on a project directory for a given platform. Returns JSON with score, passed/failed checks, and recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory to audit. Defaults to current working directory.',
        },
        platform: {
          type: 'string',
          description: 'Platform to audit. One of: claude, codex, cursor, copilot, gemini, windsurf, aider, opencode.',
          enum: ['claude', 'codex', 'cursor', 'copilot', 'gemini', 'windsurf', 'aider', 'opencode'],
          default: 'claude',
        },
        verbose: {
          type: 'boolean',
          description: 'Include all checks in output, not just failures.',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'nerviq_harmony',
    description: 'Run a harmony audit across all detected AI platforms in a project. Returns cross-platform alignment scores, drift analysis, and recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to current working directory.',
        },
        verbose: {
          type: 'boolean',
          description: 'Include detailed per-platform results.',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'nerviq_setup',
    description: 'Generate and write baseline configuration files for a platform in a project directory. Returns the list of files written.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to current working directory.',
        },
        platform: {
          type: 'string',
          description: 'Platform to set up. One of: claude, codex, cursor, copilot, gemini, windsurf, aider, opencode.',
          enum: ['claude', 'codex', 'cursor', 'copilot', 'gemini', 'windsurf', 'aider', 'opencode'],
          default: 'claude',
        },
        dryRun: {
          type: 'boolean',
          description: 'Preview files that would be written without actually writing them.',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'nerviq_drift',
    description: 'Detect configuration drift between AI platforms in a project. Returns drift items with severity, type, and recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Absolute path to the project directory. Defaults to current working directory.',
        },
        platforms: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific platforms to compare. Defaults to all detected platforms.',
        },
        minSeverity: {
          type: 'string',
          description: 'Minimum severity to include. One of: critical, high, medium, low.',
          enum: ['critical', 'high', 'medium', 'low'],
          default: 'low',
        },
      },
      required: [],
    },
  },
];

// ─── Tool handlers ───────────────────────────────────────────────────────────

async function handleAudit(input) {
  const { audit } = require('./audit');
  const dir = input.dir || process.cwd();
  const platform = input.platform || 'claude';
  const verbose = Boolean(input.verbose);

  const result = await audit({ dir, platform, silent: true, verbose });
  const clean = buildMcpAuditPayload(result, { verbose });
  return { content: [{ type: 'text', text: JSON.stringify(clean, null, 2) }] };
}

async function handleHarmony(input) {
  const { harmonyAudit } = require('./harmony/audit');
  const dir = input.dir || process.cwd();
  const verbose = Boolean(input.verbose);

  const result = await harmonyAudit({ dir, silent: true });
  const clean = buildMcpHarmonyPayload(result, { verbose });
  return { content: [{ type: 'text', text: JSON.stringify(clean, null, 2) }] };
}

async function handleSetup(input) {
  const { setup } = require('./setup');
  const dir = input.dir || process.cwd();
  const platform = input.platform || 'claude';
  const dryRun = Boolean(input.dryRun);

  const result = await setup({ dir, platform, silent: true, dryRun });

  const clean = {
    platform,
    dryRun,
    writtenFiles: result.writtenFiles || [],
    skippedFiles: result.skippedFiles || [],
    message: dryRun
      ? `Dry run: would write ${(result.writtenFiles || []).length} file(s)`
      : `Setup complete: wrote ${(result.writtenFiles || []).length} file(s)`,
  };

  return { content: [{ type: 'text', text: JSON.stringify(clean, null, 2) }] };
}

async function handleDrift(input) {
  const { detectDrift } = require('./harmony/drift');
  const { buildCanonicalModel, detectActivePlatforms } = require('./harmony/canon');
  const dir = input.dir || process.cwd();
  const minSeverity = input.minSeverity || 'low';

  const SEVERITY_ORDER = { critical: 3, high: 2, medium: 1, low: 0 };
  const minLevel = SEVERITY_ORDER[minSeverity] || 0;

  const canonModel = buildCanonicalModel(dir);
  const activePlatforms = input.platforms && input.platforms.length > 0
    ? input.platforms
    : detectActivePlatforms(canonModel);

  const driftResult = detectDrift(canonModel, activePlatforms, { verbose: true });

  const filteredDrifts = (driftResult.drifts || [])
    .filter(d => (SEVERITY_ORDER[d.severity] || 0) >= minLevel);

  const clean = {
    dir,
    activePlatforms,
    totalDrifts: driftResult.drifts ? driftResult.drifts.length : 0,
    filteredDrifts: filteredDrifts.length,
    minSeverity,
    drifts: filteredDrifts.map(d => ({
      type: d.type,
      severity: d.severity,
      description: d.description,
      recommendation: d.recommendation || null,
      platforms: d.platforms || null,
    })),
    summary: driftResult.summary || null,
  };

  return { content: [{ type: 'text', text: JSON.stringify(clean, null, 2) }] };
}

// ─── JSON-RPC 2.0 / MCP stdio transport ─────────────────────────────────────

function sendResponse(id, result) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(msg + '\n');
}

function sendError(id, code, message, data) {
  const msg = JSON.stringify({
    jsonrpc: '2.0',
    id: id !== undefined ? id : null,
    error: { code, message, ...(data ? { data } : {}) },
  });
  process.stdout.write(msg + '\n');
}

async function handleRequest(req) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    return sendResponse(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'nerviq', version },
    });
  }

  if (method === 'tools/list') {
    return sendResponse(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    const toolName = params && params.name;
    const toolInput = (params && params.arguments) || {};

    try {
      let result;
      if (toolName === 'nerviq_audit') {
        result = await handleAudit(toolInput);
      } else if (toolName === 'nerviq_harmony') {
        result = await handleHarmony(toolInput);
      } else if (toolName === 'nerviq_setup') {
        result = await handleSetup(toolInput);
      } else if (toolName === 'nerviq_drift') {
        result = await handleDrift(toolInput);
      } else {
        return sendError(id, -32601, `Unknown tool: ${toolName}`);
      }
      return sendResponse(id, result);
    } catch (err) {
      return sendError(id, -32000, err.message, { stack: err.stack });
    }
  }

  if (method === 'notifications/initialized' || method === 'ping') {
    // No response needed for notifications; ack ping
    if (method === 'ping') sendResponse(id, {});
    return;
  }

  sendError(id, -32601, `Method not found: ${method}`);
}

// ─── Main loop ───────────────────────────────────────────────────────────────

function main() {
  let buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let req;
      try {
        req = JSON.parse(trimmed);
      } catch {
        sendError(null, -32700, 'Parse error', { raw: trimmed.slice(0, 200) });
        continue;
      }

      handleRequest(req).catch((err) => {
        sendError(req.id, -32000, 'Internal error', { message: err.message });
      });
    }
  });

  process.stdin.on('end', () => {
    // Flush remaining buffer
    if (buffer.trim()) {
      let req;
      try {
        req = JSON.parse(buffer.trim());
        handleRequest(req).catch(() => {});
      } catch {}
    }
    process.exit(0);
  });

  // Suppress unhandled rejection crashes in MCP server context
  process.on('unhandledRejection', (err) => {
    process.stderr.write(`[nerviq-mcp] Unhandled rejection: ${err && err.message}\n`);
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  TOOLS,
  buildMcpAuditPayload,
  buildMcpHarmonyPayload,
  handleAudit,
  handleHarmony,
  handleSetup,
  handleDrift,
  main,
};
