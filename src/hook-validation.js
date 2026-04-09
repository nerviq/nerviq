'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ProjectContext } = require('./context');
const { CodexProjectContext } = require('./codex/context');

function tokenizeCommand(command) {
  const raw = `${command || ''}`.trim();
  if (!raw) return [];
  return raw.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"(.*)"$/, '$1')) || [];
}

function resolveExecutable(command, dir) {
  if (!command) {
    return { found: false, resolved: null };
  }

  const trimmed = `${command}`.trim();
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

function readClaudeHookSettings(dir) {
  const ctx = new ProjectContext(dir);
  const settings = ctx.jsonFile('.claude/settings.json');
  if (!settings || !settings.hooks || typeof settings.hooks !== 'object') {
    return [];
  }

  const declarations = [];
  for (const [eventName, blocks] of Object.entries(settings.hooks)) {
    if (!Array.isArray(blocks)) continue;
    blocks.forEach((block, blockIndex) => {
      const hookEntries = Array.isArray(block && block.hooks) ? block.hooks : [];
      hookEntries.forEach((hook, hookIndex) => {
        declarations.push({
          platform: 'claude',
          scope: 'project',
          source: '.claude/settings.json',
          eventName,
          matcher: block && block.matcher ? block.matcher : null,
          hookIndex: `${blockIndex}:${hookIndex}`,
          type: hook && hook.type ? hook.type : null,
          command: hook && hook.command ? `${hook.command}` : null,
          timeout: hook && typeof hook.timeout === 'number' ? hook.timeout : null,
        });
      });
    });
  }

  return declarations;
}

function readCodexHooks(dir) {
  const ctx = new CodexProjectContext(dir);
  const hooks = ctx.hooksJson();
  if (!hooks || typeof hooks !== 'object') {
    return [];
  }

  const declarations = [];
  for (const [eventName, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    entries.forEach((entry, index) => {
      declarations.push({
        platform: 'codex',
        scope: 'project',
        source: '.codex/hooks.json',
        eventName,
        matcher: null,
        hookIndex: `${index}`,
        type: 'command',
        command: entry && entry.command ? `${entry.command}` : null,
        timeout: entry && typeof entry.timeout === 'number' ? entry.timeout : null,
      });
    });
  }

  return declarations;
}

function collectDeclaredHooks(dir, detectedPlatforms = []) {
  const platformSet = new Set(detectedPlatforms);
  const declarations = [];

  if (platformSet.has('claude')) {
    declarations.push(...readClaudeHookSettings(dir));
  }

  if (platformSet.has('codex')) {
    declarations.push(...readCodexHooks(dir));
  }

  return declarations;
}

function buildHookLabel(declaration) {
  const matcher = declaration.matcher ? ` (${declaration.matcher})` : '';
  return `${declaration.eventName}${matcher}`;
}

function detectLocalScript(tokens, dir) {
  if (tokens.length < 2) return null;
  const runtime = tokens[0].toLowerCase();
  if (runtime !== 'node' && runtime !== 'bash') return null;

  const candidate = tokens[1];
  if (!candidate) return null;
  const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(dir, candidate);
  const relative = path.relative(dir, resolved).replace(/\\/g, '/');
  return { runtime, path: resolved, relativePath: relative };
}

function createSandboxWithScript(sourcePath, relativePath) {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-hook-check-'));
  const targetPath = path.join(sandboxDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return { sandboxDir, targetPath };
}

function spawnHook(runtimeCommand, args, cwd, input = null) {
  return spawnSync(runtimeCommand, args, {
    cwd,
    encoding: 'utf8',
    input,
    timeout: 5000,
  });
}

function simulateStarterHook(scriptInfo) {
  const basename = path.basename(scriptInfo.relativePath).toLowerCase();
  const { sandboxDir } = createSandboxWithScript(scriptInfo.path, scriptInfo.relativePath);

  try {
    if (basename === 'protect-secrets.js') {
      const blocked = spawnHook(process.execPath, [scriptInfo.relativePath], sandboxDir, JSON.stringify({
        tool_input: { file_path: '.env' },
      }));
      if (blocked.status !== 0) {
        return { ok: false, detail: 'starter runtime probe failed on blocked-path scenario' };
      }
      const blockedPayload = JSON.parse(blocked.stdout || '{}');
      if (blockedPayload.decision !== 'block') {
        return { ok: false, detail: 'starter hook did not block secret-path access as expected' };
      }

      const allowed = spawnHook(process.execPath, [scriptInfo.relativePath], sandboxDir, JSON.stringify({
        tool_input: { file_path: 'src/index.js' },
      }));
      if (allowed.status !== 0) {
        return { ok: false, detail: 'starter runtime probe failed on safe-path scenario' };
      }
      const allowedPayload = JSON.parse(allowed.stdout || '{}');
      if (allowedPayload.decision !== 'allow') {
        return { ok: false, detail: 'starter hook did not allow a safe file path as expected' };
      }

      return { ok: true, detail: 'starter runtime probe blocked secrets and allowed safe paths' };
    }

    if (basename === 'log-changes.js') {
      const result = spawnHook(process.execPath, [scriptInfo.relativePath], sandboxDir, JSON.stringify({
        tool_name: 'Write',
        tool_input: { file_path: 'src/app.js' },
      }));
      if (result.status !== 0) {
        return { ok: false, detail: 'starter runtime probe exited non-zero' };
      }
      const logPath = path.join(sandboxDir, '.claude', 'logs', 'file-changes.log');
      const content = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
      if (!/src\/app\.js|src\\app\.js/i.test(content)) {
        return { ok: false, detail: 'starter hook did not write the expected file-change log entry' };
      }
      return { ok: true, detail: 'starter runtime probe appended the file-change log' };
    }

    if (basename === 'session-start.js') {
      const result = spawnHook(process.execPath, [scriptInfo.relativePath], sandboxDir);
      if (result.status !== 0) {
        return { ok: false, detail: 'starter runtime probe exited non-zero' };
      }
      const logPath = path.join(sandboxDir, '.claude', 'logs', 'sessions.log');
      const content = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
      if (!/session started/i.test(content)) {
        return { ok: false, detail: 'starter hook did not append the expected session entry' };
      }
      return { ok: true, detail: 'starter runtime probe created the session log entry' };
    }

    if (basename === 'on-edit-lint.js') {
      fs.writeFileSync(path.join(sandboxDir, 'package.json'), JSON.stringify({
        name: 'nerviq-hook-probe',
        scripts: { lint: 'node -e "process.exit(0)"' },
      }, null, 2));
      const result = spawnHook(process.execPath, [scriptInfo.relativePath], sandboxDir);
      if (result.status !== 0) {
        return { ok: false, detail: 'starter runtime probe exited non-zero' };
      }
      return { ok: true, detail: 'starter runtime probe completed without crashing on a lintable repo' };
    }

    return null;
  } catch (error) {
    return {
      ok: false,
      detail: error && error.message ? error.message : 'starter runtime probe failed',
    };
  } finally {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  }
}

function evaluateHook(declaration, dir) {
  const command = `${declaration.command || ''}`.trim();
  if (!command) {
    return {
      ...declaration,
      label: buildHookLabel(declaration),
      status: 'fail',
      validationMode: 'invalid',
      detail: 'missing hook command',
      fix: 'Define a command for this hook entry or remove the empty registration.',
    };
  }

  const tokens = tokenizeCommand(command);
  const executable = tokens[0] || command;
  const resolution = resolveExecutable(executable, dir);
  const scriptInfo = detectLocalScript(tokens, dir);

  if (scriptInfo && !fs.existsSync(scriptInfo.path)) {
    return {
      ...declaration,
      label: buildHookLabel(declaration),
      status: 'fail',
      validationMode: 'readiness',
      detail: `local hook script missing: ${scriptInfo.relativePath}`,
      fix: `Create ${scriptInfo.relativePath} or update the hook command in ${declaration.source}.`,
    };
  }

  if (!resolution.found) {
    const looksLikeShellExpression = tokens.length > 1;
    return {
      ...declaration,
      label: buildHookLabel(declaration),
      status: looksLikeShellExpression ? 'warn' : 'fail',
      validationMode: 'readiness',
      detail: looksLikeShellExpression
        ? `could not resolve runtime for shell expression: ${executable}`
        : `command not found: ${executable}`,
      fix: looksLikeShellExpression
        ? 'Use an explicit runtime such as `node script.js` or ensure the shell command is available in PATH.'
        : `Install or expose \`${executable}\` on PATH.`,
    };
  }

  if (scriptInfo) {
    const runtimeProbe = simulateStarterHook(scriptInfo);
    if (runtimeProbe) {
      return {
        ...declaration,
        label: buildHookLabel(declaration),
        status: runtimeProbe.ok ? 'pass' : 'fail',
        validationMode: 'runtime',
        detail: runtimeProbe.detail,
        executable: resolution.resolved,
        script: scriptInfo.relativePath,
        fix: runtimeProbe.ok ? null : 'Regenerate the starter hook via `nerviq setup` or inspect the hook script for runtime regressions.',
      };
    }
  }

  return {
    ...declaration,
    label: buildHookLabel(declaration),
    status: 'pass',
    validationMode: 'readiness',
    detail: scriptInfo
      ? `runtime resolved and local hook script is present (${scriptInfo.relativePath}); dynamic execution skipped for custom-hook safety`
      : `runtime resolved (${path.basename(resolution.resolved || executable)}); readiness check passed`,
    executable: resolution.resolved,
    script: scriptInfo ? scriptInfo.relativePath : null,
    fix: null,
  };
}

function validateDeclaredHooks({ dir, detectedPlatforms = [] }) {
  const declarations = collectDeclaredHooks(dir, detectedPlatforms);
  const checks = declarations.map((declaration) => evaluateHook(declaration, dir));

  return {
    checks,
    declared: checks.length,
    pass: checks.filter((item) => item.status === 'pass').length,
    warn: checks.filter((item) => item.status === 'warn').length,
    fail: checks.filter((item) => item.status === 'fail').length,
  };
}

module.exports = {
  validateDeclaredHooks,
};
