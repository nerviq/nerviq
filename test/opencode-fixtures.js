const fs = require('fs');
const os = require('os');
const path = require('path');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-opencode-${name}-`));
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

function basePackageJson(extra = {}) {
  return {
    name: 'opencode-fixture',
    private: true,
    scripts: {
      test: 'vitest run',
      lint: 'eslint .',
      build: 'vite build',
      format: 'prettier --check .',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      prisma: '^6.0.0',
      passport: '^0.7.0',
      stripe: '^18.0.0',
    },
    devDependencies: {
      eslint: '^9.0.0',
      prettier: '^3.0.0',
      vitest: '^3.0.0',
      playwright: '^1.55.0',
    },
    ...extra,
  };
}

function writeGlobalConfig(homeDir) {
  writeJson(homeDir, '.config/opencode/opencode.json', {
    model: 'gpt-5-mini',
    disabled_providers: ['legacy'],
  });
}

function buildEmptyRepo() {
  const dir = mkFixture('empty');
  writeJson(dir, 'package.json', { name: 'empty-opencode' });
  return { dir };
}

function buildRichOpenCodeRepo() {
  const dir = mkFixture('rich');
  const homeDir = mkFixture('home');

  writeGlobalConfig(homeDir);
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'README.md', [
    '# OpenCode Rich Fixture',
    '',
    'This repo documents plugins, MCP auth, and the current permission posture.',
    'Use opencode serve only with OPENCODE_SERVER_PASSWORD.',
  ].join('\n'));
  writeFile(dir, 'CLAUDE.md', '# Claude Code Surface\nKeep Claude-specific instructions here.\n');
  writeFile(dir, 'AGENTS.md', [
    '# OpenCode Project Instructions',
    '',
    '## Overview',
    '- This repo uses OpenCode with plugins, custom agents, and skills.',
    '- Permission posture is explicit: bash is constrained, destructive commands are denied, and external directories require ask.',
    '',
    '## Architecture',
    '```mermaid',
    'graph TD',
    '  Web --> API',
    '  API --> Prisma',
    '```',
    '',
    '## Verification',
    '- Run `npm test`',
    '- Run `npm run lint`',
    '- Run `npm run build`',
    '',
    '## Plugins and MCP',
    '- Plugins are reviewed in-process extensions.',
    '- MCP auth for github requires GITHUB_TOKEN in environment setup.',
    '- Skills live in .opencode/commands/ and may also reuse .claude/skills/.',
    '',
    '## Automation',
    '- Heavy workflows and scheduled automation must track cost and token usage.',
    '- opencode serve requires OPENCODE_SERVER_PASSWORD because the HTTP server must stay protected.',
    '- Build agent override is intentional for our review workflow.',
    '',
    '## Permissions',
    '- Document why allow/ask/deny is set for bash, read, edit, task, doom_loop, and external_directory.',
    '',
    '## Notes',
    '- Keep project-critical guidance in repo files.',
  ].join('\n'));
  writeFile(dir, 'docs/opencode-extra.md', '# Extra Instructions\n\nUse the repo workflow docs.\n');
  writeJson(dir, 'opencode.json', {
    $schema: 'https://opencode.ai/config.json',
    model: 'gpt-5.4',
    small_model: 'gpt-5-mini',
    formatter: 'prettier',
    compaction: {
      enabled: true,
    },
    enabled_providers: ['openai'],
    instructions: ['docs/opencode-extra.md'],
    plugins: ['@company/audit-plugin@1.2.3'],
    permissions: {
      tools: {
        read: {
          '.env': 'deny',
          '.env.*': 'deny',
          '**/secrets/**': 'deny',
        },
        edit: 'allow',
        task: 'allow',
        skill: 'allow',
        bash: {
          'npm *': 'allow',
          'git status': 'allow',
          'git diff': 'allow',
          'rm *': 'deny',
          'rm -rf *': 'deny',
          'git push --force*': 'deny',
          'git reset --hard*': 'deny',
        },
        doom_loop: 'ask',
        external_directory: 'ask',
      },
    },
    mcp: {
      github: {
        command: ['npx', '-y', '@modelcontextprotocol/server-github@latest'],
        environment: {
          GITHUB_TOKEN: '{env:GITHUB_TOKEN}',
        },
        tools: {
          'github*': true,
        },
        timeout: 15000,
      },
    },
    agents: {
      build: {
        description: 'Intentional build override for release reviews',
        model: 'gpt-5.4',
        mode: 'subagent',
        steps: 40,
        permissions: {
          tools: {
            bash: 'ask',
          },
        },
      },
    },
  });
  writeFile(dir, '.opencode/plugins/audit.ts', [
    'import { definePlugin } from "@opencode-ai/plugin";',
    '',
    'export default definePlugin({',
    '  name: "audit-plugin",',
    '});',
  ].join('\n'));
  writeFile(dir, '.opencode/commands/review.md', [
    '---',
    'description: Review a change safely',
    'template: default',
    '---',
    '',
    'Review the current diff and summarize risks.',
  ].join('\n'));
  writeFile(dir, '.opencode/commands/react-audit/SKILL.md', [
    '---',
    'name: react-audit',
    'description: Review React changes.',
    '---',
    '',
    '# React Audit',
    '',
    'Inspect React and Next.js changes for regressions.',
  ].join('\n'));
  writeFile(dir, '.claude/skills/shared/SKILL.md', [
    '---',
    'name: shared',
    'description: Shared Claude skill.',
    '---',
    '',
    'Reusable shared skill.',
  ].join('\n'));
  writeJson(dir, '.opencode/themes/midnight.json', {
    name: 'midnight',
    colors: {
      background: '#111827',
      foreground: '#f9fafb',
    },
  });
  writeJson(dir, 'tui.json', {
    theme: 'midnight',
  });
  writeFile(dir, '.github/workflows/opencode.yml', [
    'name: OpenCode CI',
    'on: [push]',
    'jobs:',
    '  run-opencode:',
    '    runs-on: ubuntu-latest',
    '    env:',
    '      OPENCODE_DISABLE_AUTOUPDATE: "1"',
    '    steps:',
    '      - run: opencode run --format json --yes "review changes"',
    '      - run: echo permissions allow',
  ].join('\n'));
  writeFile(dir, '.prettierrc', '{}\n');
  writeFile(dir, '.nerviq/activity/index.json', '[]\n');
  return { dir, homeDir };
}

function buildJsoncOnlyRepo() {
  const dir = mkFixture('jsonc-only');
  const homeDir = mkFixture('home');
  writeGlobalConfig(homeDir);
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', '# JSONC Only\n\n## Verification\n- npm test\n');
  writeFile(dir, 'opencode.jsonc', [
    '{',
    '  // JSONC config surface',
    '  "$schema": "https://opencode.ai/config.json",',
    '  "model": "gpt-5.4"',
    '}',
  ].join('\n'));
  return { dir, homeDir };
}

function buildMixedAgentRepo() {
  const base = buildRichOpenCodeRepo();
  writeFile(base.dir, 'AGENTS.md', fs.readFileSync(path.join(base.dir, 'AGENTS.md'), 'utf8') + '\n\nThis repo also uses Claude, but instructions stay separate.\n');
  return base;
}

function buildPermissiveRepo() {
  const dir = mkFixture('permissive');
  const homeDir = mkFixture('home');
  writeGlobalConfig(homeDir);
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'AGENTS.md', '# Permissive Repo\n');
  writeJson(dir, 'opencode.json', {
    model: 'gpt-5.4',
    permissions: {
      tools: {
        '*': 'allow',
      },
    },
  });
  return { dir, homeDir };
}

module.exports = {
  mkFixture,
  writeFile,
  writeJson,
  withTempHome,
  buildEmptyRepo,
  buildRichOpenCodeRepo,
  buildJsoncOnlyRepo,
  buildMixedAgentRepo,
  buildPermissiveRepo,
};
