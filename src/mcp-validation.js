'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ProjectContext } = require('./context');
const { CodexProjectContext } = require('./codex/context');
const { GeminiProjectContext } = require('./gemini/context');
const { CopilotProjectContext } = require('./copilot/context');
const { CursorProjectContext } = require('./cursor/context');
const { WindsurfProjectContext } = require('./windsurf/context');
const { OpenCodeProjectContext } = require('./opencode/context');

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeSourcePath(filePath) {
  if (!filePath) return null;
  const homeDir = os.homedir();
  if (filePath.startsWith(homeDir)) {
    return filePath.replace(homeDir, '~');
  }
  return filePath;
}

function normalizeServerConfig(rawConfig) {
  const raw = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  let command = raw.command || null;
  let args = Array.isArray(raw.args) ? raw.args.map((item) => `${item}`) : [];

  if (Array.isArray(command)) {
    const commandParts = command.map((item) => `${item}`);
    command = commandParts[0] || null;
    args = [...commandParts.slice(1), ...args];
  } else if (typeof command !== 'string') {
    command = null;
  }

  const env = raw.env && typeof raw.env === 'object'
    ? raw.env
    : raw.environment && typeof raw.environment === 'object'
      ? raw.environment
      : {};

  const urlCandidates = [raw.url, raw.endpoint, raw.serverUrl, raw.sseUrl, raw.httpUrl];
  const url = urlCandidates.find((value) => typeof value === 'string' && value.trim()) || null;
  const transport = typeof raw.transport === 'string'
    ? raw.transport.toLowerCase()
    : (url ? 'remote' : 'stdio');

  return {
    command: typeof command === 'string' ? command.trim() : null,
    args,
    env,
    url: typeof url === 'string' ? url.trim() : null,
    transport,
  };
}

function extractEnvReferences(config) {
  const references = new Set();
  const pattern = /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/g;

  const scan = (value) => {
    if (typeof value !== 'string') return;
    for (const match of value.matchAll(pattern)) {
      references.add(match[1]);
    }
  };

  scan(config.command);
  scan(config.url);
  for (const arg of config.args || []) scan(arg);
  for (const value of Object.values(config.env || {})) scan(value);

  return [...references];
}

function resolveExecutable(command, dir) {
  if (!command) {
    return { found: false, resolved: null };
  }

  const trimmed = command.trim();
  const isPathLike = /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith('.') ||
    trimmed.includes('/') ||
    trimmed.includes('\\');

  if (isPathLike) {
    const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(dir, trimmed);
    return { found: fs.existsSync(resolved), resolved };
  }

  const lookup = process.platform === 'win32'
    ? spawnSync('where.exe', [trimmed], { encoding: 'utf8' })
    : spawnSync('which', [trimmed], { encoding: 'utf8' });
  const output = `${lookup.stdout || ''}`.trim().split(/\r?\n/).filter(Boolean)[0] || null;

  return {
    found: lookup.status === 0 && Boolean(output),
    resolved: output,
  };
}

async function probeRemoteUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (!/^https?:$/.test(parsed.protocol)) {
      return { status: 'fail', detail: `unsupported protocol ${parsed.protocol}` };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    let response;
    try {
      response = await fetch(targetUrl, { method: 'GET', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 500) {
      return { status: 'warn', detail: `HTTP ${response.status} ${response.statusText}` };
    }

    return { status: 'pass', detail: `HTTP ${response.status} ${response.statusText}` };
  } catch (error) {
    if (error && error.name === 'AbortError') {
      return { status: 'warn', detail: 'timed out after 2000ms' };
    }
    return { status: 'warn', detail: error && error.message ? error.message : 'request failed' };
  }
}

function pushDeclarations(target, platform, scope, source, servers, note = null) {
  if (!servers || typeof servers !== 'object') return;

  for (const [serverName, rawConfig] of Object.entries(servers)) {
    target.push({
      platform,
      scope,
      source: normalizeSourcePath(source),
      serverName,
      note,
      config: normalizeServerConfig(rawConfig),
    });
  }
}

function shouldIncludeGlobalScope(dir, includeGlobal) {
  if (typeof includeGlobal === 'boolean') return includeGlobal;
  // Default: only merge user-level (global) MCP config when doctor is examining
  // the environment it is running in (target dir === process cwd). Scanning any
  // other directory (fixtures, CI checkouts, `--dir` targets) must stay
  // project-scoped so results are reproducible across machines.
  try {
    return path.resolve(dir) === path.resolve(process.cwd());
  } catch {
    return false;
  }
}

function collectDeclaredMcpServers(dir, detectedPlatforms = [], { includeGlobal } = {}) {
  const declarations = [];
  const platformSet = new Set(detectedPlatforms);
  const withGlobal = shouldIncludeGlobalScope(dir, includeGlobal);

  if (platformSet.has('claude')) {
    const claudeCtx = new ProjectContext(dir);
    const projectConfig = claudeCtx.jsonFile('.mcp.json');
    if (projectConfig && projectConfig.mcpServers) {
      pushDeclarations(declarations, 'claude', 'project', '.mcp.json', projectConfig.mcpServers);
    }

    if (withGlobal) {
      const globalConfigPath = path.join(os.homedir(), '.claude.json');
      const globalConfig = readJsonFile(globalConfigPath);
      if (globalConfig && globalConfig.mcpServers) {
        pushDeclarations(declarations, 'claude', 'global', globalConfigPath, globalConfig.mcpServers);
      }
    }
  }

  if (platformSet.has('codex')) {
    const ctx = new CodexProjectContext(dir);
    const projectConfig = ctx.configToml();
    if (projectConfig.ok && projectConfig.data && projectConfig.data.mcp_servers) {
      pushDeclarations(declarations, 'codex', 'project', projectConfig.source, projectConfig.data.mcp_servers);
    }
    if (withGlobal) {
      const globalConfig = ctx.globalConfigToml();
      if (globalConfig.ok && globalConfig.data && globalConfig.data.mcp_servers) {
        pushDeclarations(declarations, 'codex', 'global', globalConfig.source, globalConfig.data.mcp_servers);
      }
    }
  }

  if (platformSet.has('gemini')) {
    const ctx = new GeminiProjectContext(dir);
    const projectConfig = ctx.settingsJson();
    if (projectConfig.ok && projectConfig.data && projectConfig.data.mcpServers) {
      pushDeclarations(declarations, 'gemini', 'project', projectConfig.source, projectConfig.data.mcpServers);
    }
    if (withGlobal) {
      const globalConfig = ctx.globalSettingsJson();
      if (globalConfig.ok && globalConfig.data && globalConfig.data.mcpServers) {
        pushDeclarations(declarations, 'gemini', 'global', globalConfig.source, globalConfig.data.mcpServers);
      }
    }
  }

  if (platformSet.has('copilot')) {
    const ctx = new CopilotProjectContext(dir);
    const projectConfig = ctx.mcpConfig();
    if (projectConfig.ok && projectConfig.data) {
      pushDeclarations(
        declarations,
        'copilot',
        'project',
        projectConfig.source,
        projectConfig.data.servers || projectConfig.data.mcpServers || {}
      );
    }
  }

  if (platformSet.has('cursor')) {
    const ctx = new CursorProjectContext(dir);
    const projectConfig = ctx.mcpConfig();
    if (projectConfig.ok && projectConfig.data) {
      pushDeclarations(declarations, 'cursor', 'project', projectConfig.source, projectConfig.data.mcpServers || {});
    }
    if (withGlobal) {
      const globalConfig = ctx.globalMcpConfig();
      if (globalConfig.ok && globalConfig.data) {
        pushDeclarations(declarations, 'cursor', 'global', globalConfig.source, globalConfig.data.mcpServers || {});
      }
    }
  }

  if (platformSet.has('windsurf')) {
    const ctx = new WindsurfProjectContext(dir);
    const projectConfig = ctx.mcpConfig();
    if (projectConfig.ok && projectConfig.data) {
      pushDeclarations(
        declarations,
        'windsurf',
        'project',
        projectConfig.source,
        projectConfig.data.mcpServers || {},
        'Current Windsurf runtime may still rely on global MCP config.'
      );
    }
    if (withGlobal) {
      const globalConfig = ctx.globalMcpConfig();
      if (globalConfig.ok && globalConfig.data) {
        pushDeclarations(declarations, 'windsurf', 'global', globalConfig.source, globalConfig.data.mcpServers || {});
      }
    }
  }

  if (platformSet.has('opencode')) {
    const ctx = new OpenCodeProjectContext(dir);
    const projectConfig = ctx.configJson();
    if (projectConfig.ok && projectConfig.data && projectConfig.data.mcp) {
      pushDeclarations(declarations, 'opencode', 'project', projectConfig.source, projectConfig.data.mcp);
    }
    if (withGlobal) {
      const globalConfig = ctx.globalConfigJson();
      if (globalConfig.ok && globalConfig.data && globalConfig.data.mcp) {
        pushDeclarations(declarations, 'opencode', 'global', globalConfig.source, globalConfig.data.mcp);
      }
    }
  }

  return declarations;
}

async function validateDeclaredMcpServers({ dir, detectedPlatforms = [], includeGlobal } = {}) {
  const declarations = collectDeclaredMcpServers(dir, detectedPlatforms, { includeGlobal });
  const checks = [];

  for (const declaration of declarations) {
    const missingEnv = extractEnvReferences(declaration.config)
      .filter((name) => !Object.prototype.hasOwnProperty.call(process.env, name));
    const entry = {
      platform: declaration.platform,
      scope: declaration.scope,
      source: declaration.source,
      serverName: declaration.serverName,
      transport: declaration.config.transport,
      command: declaration.config.command,
      args: declaration.config.args,
      url: declaration.config.url,
      missingEnv,
      status: 'fail',
      mode: 'unknown',
      detail: '',
      fix: null,
    };

    if (declaration.config.command) {
      entry.mode = 'command';
      const resolution = resolveExecutable(declaration.config.command, dir);
      if (!resolution.found) {
        entry.status = 'fail';
        entry.detail = `Command '${declaration.config.command}' was not found in PATH or at the declared path.`;
        entry.fix = 'Install the MCP server command or correct the configured command path.';
      } else if (missingEnv.length > 0) {
        entry.status = 'warn';
        entry.detail = `Command '${declaration.config.command}' resolves to ${resolution.resolved}, but referenced env vars are missing: ${missingEnv.join(', ')}.`;
        entry.fix = `Set the missing env vars before starting this MCP server: ${missingEnv.join(', ')}.`;
      } else {
        entry.status = 'pass';
        entry.detail = `Command '${declaration.config.command}' resolves to ${resolution.resolved}.`;
      }
    } else if (declaration.config.url) {
      entry.mode = 'remote';
      const probe = await probeRemoteUrl(declaration.config.url);
      entry.status = probe.status;
      entry.detail = `URL ${declaration.config.url} ${probe.status === 'pass' ? 'responded' : 'was not confirmed'} (${probe.detail}).`;
      entry.fix = probe.status === 'pass'
        ? null
        : 'Start the remote MCP endpoint locally or update the configured URL.';
      if (missingEnv.length > 0) {
        entry.status = entry.status === 'fail' ? 'fail' : 'warn';
        entry.detail += ` Missing env vars: ${missingEnv.join(', ')}.`;
        if (!entry.fix) {
          entry.fix = `Set the missing env vars before starting this MCP server: ${missingEnv.join(', ')}.`;
        }
      }
    } else {
      entry.mode = 'unknown';
      entry.status = 'fail';
      entry.detail = 'Declared MCP server has neither a command nor a URL to validate.';
      entry.fix = 'Add a valid command/args pair or a reachable URL-based transport definition.';
    }

    if (declaration.note) {
      entry.detail += ` ${declaration.note}`;
    }

    checks.push(entry);
  }

  return {
    checks,
    declared: checks.length,
    pass: checks.filter((item) => item.status === 'pass').length,
    warn: checks.filter((item) => item.status === 'warn').length,
    fail: checks.filter((item) => item.status === 'fail').length,
  };
}

module.exports = {
  collectDeclaredMcpServers,
  validateDeclaredMcpServers,
};
