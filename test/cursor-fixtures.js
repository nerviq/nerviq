const fs = require('fs');
const os = require('os');
const path = require('path');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-cursor-${name}-`));
}

function writeFile(base, filePath, content) {
  const fullPath = path.join(base, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

function writeJson(base, filePath, payload) {
  writeFile(base, filePath, JSON.stringify(payload, null, 2));
}

function withTempHome(homeDir, fn) {
  const previous = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    HOMEDRIVE: process.env.HOMEDRIVE,
    HOMEPATH: process.env.HOMEPATH,
  };

  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  const parsed = path.parse(homeDir);
  process.env.HOMEDRIVE = parsed.root.replace(/[\\/]+$/, '');
  process.env.HOMEPATH = homeDir.slice(parsed.root.length - (parsed.root.endsWith('\\') || parsed.root.endsWith('/') ? 1 : 0));

  const restore = () => {
    process.env.HOME = previous.HOME;
    process.env.USERPROFILE = previous.USERPROFILE;
    process.env.HOMEDRIVE = previous.HOMEDRIVE;
    process.env.HOMEPATH = previous.HOMEPATH;
  };

  try {
    return fn();
  } finally {
    restore();
  }
}

// ─── MDC helpers ────────────────────────────────────────────────────────────

function mdcRule(frontmatter, body) {
  const fmLines = Object.entries(frontmatter).map(([k, v]) => {
    if (typeof v === 'boolean') return `${k}: ${v}`;
    if (Array.isArray(v)) return `${k}:\n${v.map(i => `  - ${i}`).join('\n')}`;
    return `${k}: ${v}`;
  });
  return ['---', ...fmLines, '---', '', body].join('\n');
}

function writeRule(base, name, frontmatter, body) {
  writeFile(base, `.cursor/rules/${name}.mdc`, mdcRule(frontmatter, body));
}

// ─── Shared content builders ─────────────────────────────────────────────────

function baseCoreRuleBody() {
  return [
    '# Project Instructions',
    '',
    '## Overview',
    '- This repo uses Cursor as the primary coding agent.',
    '- Keep changes small, explicit, and reviewable.',
    '- Prefer focused edits over broad rewrites.',
    '',
    '## Verification',
    '- Test: `npm test`',
    '- Lint: `npm run lint`',
    '- Build: `npm run build`',
    '- Re-run the narrowest relevant command after edits.',
    '',
    '## Architecture',
    '- src/ contains product code.',
    '- .cursor/rules/ contains MDC rule files.',
    '- .cursor/mcp.json contains MCP server configuration.',
    '- .github/workflows/ contains CI and automation.',
    '',
    '## Safety',
    '- Never commit secrets.',
    '- Review diffs before confirming code deletions.',
    '- MCP auth uses documented environment variables only.',
    '- Privacy Mode should be enabled for sensitive repos.',
    '',
    '## Modern Features',
    '- Background agents run on ephemeral VMs for async tasks.',
    '- Automations trigger cloud agents on events (push, PR, timer).',
    '- BugBot provides automated PR code review.',
    '- Design Mode enables rapid prototyping with AI.',
  ].join('\n');
}

function basePackageJson(extra = {}) {
  return {
    name: 'cursor-fixture',
    scripts: {
      test: 'vitest',
      lint: 'eslint .',
      build: 'vite build',
    },
    dependencies: {
      pg: '^8.0.0',
    },
    ...extra,
  };
}

// ─── Scenario builders ──────────────────────────────────────────────────────

function buildEmptyRepo() {
  const dir = mkFixture('empty');
  writeJson(dir, 'package.json', { name: 'empty-cursor' });
  return { dir };
}

function buildRichCursorRepo() {
  const dir = mkFixture('rich');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'README.md', 'MCP auth uses GITHUB_TOKEN for the GitHub MCP server.');
  writeFile(dir, '.env.example', 'GITHUB_TOKEN=your-token-here\n');

  // Core rule (alwaysApply)
  writeRule(dir, 'core', { alwaysApply: true }, baseCoreRuleBody());

  // Stack-specific auto-attached rule
  writeRule(dir, 'typescript', {
    description: 'TypeScript conventions',
    globs: ['**/*.ts', '**/*.tsx'],
  }, [
    '# TypeScript Conventions',
    '',
    '- Use strict TypeScript with explicit return types.',
    '- Prefer interfaces over type aliases for object shapes.',
    '- Use zod for runtime validation.',
  ].join('\n'));

  // Agent-requested rule
  writeRule(dir, 'review-guide', {
    description: 'Code review checklist',
  }, [
    '# Code Review Guide',
    '',
    'Check for security, performance, and correctness.',
    'Verify test coverage for changed code.',
  ].join('\n'));

  // MCP configuration
  writeJson(dir, '.cursor/mcp.json', {
    mcpServers: {
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp@latest'],
      },
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: '${env:GITHUB_TOKEN}' },
      },
    },
  });

  // Environment config (background agents)
  writeJson(dir, '.cursor/environment.json', {
    baseImage: 'node:20',
    persistedDirectories: ['node_modules', '.next'],
    env: {
      NODE_ENV: 'development',
    },
    setupScript: 'npm ci',
  });

  // Automations
  writeFile(dir, '.cursor/automations/on-pr.yaml', [
    'name: PR Review',
    'trigger:',
    '  event: pull_request',
    '  branches: [main]',
    'action:',
    '  prompt: "Review this PR for correctness and security."',
    '  max_duration: 30m',
  ].join('\n'));

  // BugBot config (in rules)
  writeRule(dir, 'bugbot-guide', {
    description: 'BugBot configuration',
  }, [
    '# BugBot Configuration',
    '',
    'BugBot is enabled for automated PR review.',
    'Auto-fix is disabled by default for safety.',
  ].join('\n'));

  return { dir };
}

function buildLegacyCursorrules() {
  const dir = mkFixture('legacy');
  writeJson(dir, 'package.json', basePackageJson());
  // Only .cursorrules, no .cursor/rules/
  writeFile(dir, '.cursorrules', [
    'You are a helpful coding assistant.',
    'Always use TypeScript.',
    'Follow the project conventions.',
  ].join('\n'));
  return { dir };
}

function buildMdcBadFrontmatter() {
  const dir = mkFixture('mdc-bad');
  writeJson(dir, 'package.json', basePackageJson());
  // Rule with both alwaysApply and globs (invalid combo)
  writeFile(dir, '.cursor/rules/broken.mdc', [
    '---',
    'alwaysApply: true',
    'globs:',
    '  - "**/*.ts"',
    'description: This has both alwaysApply and globs which is contradictory',
    '---',
    '',
    '# Broken Rule',
    '',
    'This rule has conflicting frontmatter.',
  ].join('\n'));
  return { dir };
}

function buildMcpTooManyTools() {
  const dir = mkFixture('mcp-many');
  writeJson(dir, 'package.json', basePackageJson());
  writeRule(dir, 'core', { alwaysApply: true }, baseCoreRuleBody());

  // Create MCP config with many servers (simulating >40 tools)
  const servers = {};
  for (let i = 1; i <= 15; i++) {
    servers[`server-${i}`] = {
      command: 'npx',
      args: ['-y', `@example/mcp-server-${i}`],
    };
  }
  writeJson(dir, '.cursor/mcp.json', { mcpServers: servers });
  return { dir };
}

function buildBackgroundAgentRepo() {
  const dir = mkFixture('bg-agent');
  writeJson(dir, 'package.json', basePackageJson());
  writeRule(dir, 'core', { alwaysApply: true }, baseCoreRuleBody());

  writeJson(dir, '.cursor/mcp.json', {
    mcpServers: {
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp@latest'],
      },
    },
  });

  writeJson(dir, '.cursor/environment.json', {
    baseImage: 'node:20',
    persistedDirectories: ['node_modules'],
    env: { CI: 'true' },
    processes: [
      { name: 'dev', command: 'npm run dev', waitOn: 'http://localhost:3000' },
    ],
    setupScript: 'npm ci',
  });

  // Automation config
  writeFile(dir, '.cursor/automations/on-push.yaml', [
    'name: On Push',
    'trigger:',
    '  event: push',
    '  branches: [main, develop]',
    'action:',
    '  prompt: "Run tests and report results."',
    '  max_duration: 15m',
  ].join('\n'));

  return { dir };
}

function buildMultiPlatformRepo() {
  const base = buildRichCursorRepo();
  writeFile(base.dir, 'CLAUDE.md', '# Claude surface\n');
  writeFile(base.dir, '.claude/settings.json', JSON.stringify({ permissions: { defaultMode: 'acceptEdits' } }, null, 2));
  writeFile(base.dir, 'GEMINI.md', '# Gemini surface\n');
  writeFile(base.dir, '.gemini/settings.json', JSON.stringify({ model: 'gemini-2.5-pro' }, null, 2));
  writeFile(base.dir, '.github/copilot-instructions.md', '# Copilot instructions\n');
  return base;
}

module.exports = {
  mkFixture,
  writeFile,
  writeJson,
  withTempHome,
  buildEmptyRepo,
  buildRichCursorRepo,
  buildLegacyCursorrules,
  buildMdcBadFrontmatter,
  buildMcpTooManyTools,
  buildBackgroundAgentRepo,
  buildMultiPlatformRepo,
};
