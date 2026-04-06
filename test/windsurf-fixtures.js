const fs = require('fs');
const os = require('os');
const path = require('path');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-windsurf-${name}-`));
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

function windsurfRule(frontmatter, body) {
  const fmLines = Object.entries(frontmatter || {}).flatMap(([key, value]) => {
    if (Array.isArray(value)) {
      return [`${key}:`, ...value.map((item) => `  - ${item}`)];
    }
    return [`${key}: ${value}`];
  });
  return ['---', ...fmLines, '---', '', body].join('\n');
}

function writeRule(base, name, frontmatter, body) {
  writeFile(base, `.windsurf/rules/${name}.md`, windsurfRule(frontmatter, body));
}

function writeWorkflow(base, name, body) {
  writeFile(base, `.windsurf/workflows/${name}.md`, body);
}

function writeMemory(base, name, body) {
  writeFile(base, `.windsurf/memories/${name}.md`, body);
}

function writeGlobalMcp(homeDir, payload) {
  writeJson(homeDir, '.codeium/windsurf/mcp_config.json', payload);
}

function basePackageJson(extra = {}) {
  return {
    name: 'windsurf-fixture',
    private: true,
    scripts: {
      test: 'vitest run',
      lint: 'eslint .',
      build: 'next build',
    },
    dependencies: {
      next: '^16.0.0',
      react: '^19.0.0',
      'react-dom': '^19.0.0',
      express: '^5.1.0',
      prisma: '^6.0.0',
      winston: '^3.17.0',
      pino: '^9.0.0',
      ioredis: '^5.0.0',
      stripe: '^18.0.0',
      passport: '^0.7.0',
    },
    devDependencies: {
      eslint: '^9.0.0',
      prettier: '^3.0.0',
      vitest: '^3.0.0',
      playwright: '^1.55.0',
      '@types/node': '^22.0.0',
      typescript: '^5.0.0',
    },
    ...extra,
  };
}

function buildEmptyRepo() {
  const dir = mkFixture('empty');
  writeJson(dir, 'package.json', { name: 'empty-windsurf' });
  return { dir };
}

function buildRichWindsurfRepo() {
  const dir = mkFixture('rich');
  const homeDir = mkFixture('home');

  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, 'README.md', [
    '# Windsurf Rich Fixture',
    '',
    'This repo uses Windsurf Cascade with approved MCP servers and workspace-local memories.',
    'Enterprise note: approved MCP allowlist, audit trail, and model policy are documented in the rules.',
    '',
    '## Services',
    '- `app/` for frontend routes',
    '- `src/api/` for API handlers',
    '- `prisma/` for database schema',
  ].join('\n'));
  writeFile(dir, '.gitignore', '.env\nnode_modules\nsecrets/\n*.pem\n');
  writeFile(dir, '.cascadeignore', '.env\n.env.*\nsecrets/\n*.pem\n');
  writeJson(dir, '.vscode/settings.json', {
    'editor.formatOnSave': true,
  });
  writeFile(dir, '.env.example', 'GITHUB_TOKEN=\nCONTEXT7_API_KEY=\n');
  writeFile(dir, 'openapi.yaml', 'openapi: 3.1.0\ninfo:\n  title: Windsurf Fixture API\n  version: 1.0.0\n');
  writeFile(dir, '.github/workflows/ci.yml', [
    'name: CI',
    'on: [push, pull_request]',
    'jobs:',
    '  verify:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: npm run lint',
    '      - run: npm test',
    '      - run: npm run build',
  ].join('\n'));
  writeFile(dir, 'prisma/schema.prisma', 'datasource db { provider = "postgresql" url = env("DATABASE_URL") }\n');
  writeFile(dir, 'go.mod', 'module example.com/windsurf\n\ngo 1.24.0\n');
  writeFile(dir, 'Cargo.toml', '[package]\nname = "windsurf-rs"\nversion = "0.1.0"\nedition = "2024"\n');
  writeFile(dir, 'requirements.txt', 'fastapi==0.115.0\npytest==8.0.0\n');
  writeFile(dir, 'src/api/health.ts', 'export const health = () => ({ ok: true });\n');
  writeFile(dir, 'app/page.tsx', 'export default function Page() { return <main>hello</main>; }\n');

  writeRule(dir, 'core', { trigger: 'always_on', name: 'core-policy' }, [
    '# Windsurf Core Policy',
    '',
    '## Project',
    '- This repo is the Windsurf rich fixture and uses app/, src/api/, prisma/, and components/.',
    '- Create feature branches and PRs for every change.',
    '',
    '## Architecture',
    '```mermaid',
    'graph TD',
    '  App --> API',
    '  API --> Prisma',
    '```',
    '',
    '## Verification',
    '- Run `npm test` before completion.',
    '- Run `npm run lint` before completion.',
    '- Run `npm run build` before completion.',
    '',
    '## Cascade Guidance',
    '- Cascade may edit multiple files when a change spans API, UI, and schema layers.',
    '- Use Steps automation and slash command workflows for multi-step tasks.',
    '- Use Cascade skills and tool use deliberately for repo review, docs lookup, and safe terminal work.',
    '- Use @mentions, file references, and codebase context when narrowing a task.',
    '- Long sessions can drift; compact context and restate the goal when sessions get long.',
    '- Warn about code reversion risk when format-on-save conflicts with agent edits.',
    '- Prefer small task chunks and restart with a new session if a long autonomous flow stalls.',
    '',
    '## Memories',
    '- Memories are workspace local only, not cross-project, and not team synced.',
    '- Keep only current-repo context in memories.',
    '',
    '## Enterprise Controls',
    '- Enterprise deployments use hybrid or self-hosted review flows.',
    '- Keep an approved MCP allowlist / whitelist for controlled environments.',
    '- Maintain audit logs and an audit trail for AI-assisted changes.',
    '- Zero data retention affects retention posture, but code is still sent for processing.',
    '- Model access policy restricts allowed models for production work.',
    '- On Windows, prefer native Windows over WSL because Windsurf is less stable under WSL.',
  ].join('\n'));

  writeRule(dir, 'frontend', {
    trigger: 'glob',
    name: 'frontend',
    globs: ['app/**/*.tsx', 'components/**/*.tsx'],
  }, [
    '# Frontend Rule',
    '',
    '- Follow the app/ and components/ directory structure.',
    '- Keep React and Next.js work isolated to frontend files.',
  ].join('\n'));

  writeRule(dir, 'review', {
    trigger: 'model_decision',
    name: 'review-guide',
    description: 'Apply this rule for code review and secure merge decisions.',
  }, [
    '# Review Guide',
    '',
    '- Review correctness, tests, auth boundaries, and migration safety.',
    '- Human review is required before merge.',
  ].join('\n'));

  writeRule(dir, 'manual', { trigger: 'manual', name: 'manual-playbook' }, [
    '# Manual Playbook',
    '',
    '- Use this when asked for a deep architecture review.',
  ].join('\n'));

  writeWorkflow(dir, 'review', [
    'name: Review',
    'description: Review a change with lint, test, and migration checks',
    '',
    '1. Inspect changed files in src/api/ and app/',
    '2. Run npm run lint',
    '3. Run npm test',
    '4. Ask for human review before merge',
  ].join('\n'));

  writeWorkflow(dir, 'release', [
    'name: Release',
    'description: Prepare a release candidate safely',
    '',
    '1. Verify release notes',
    '2. Run npm run build',
    '3. Generate a PR summary',
  ].join('\n'));

  writeMemory(dir, 'repo-context', [
    '# Repo Context',
    '',
    '## Purpose',
    'Workspace-local summary for the current repo only.',
    '',
    '## Context',
    '- Updated: 2026-04-05',
    '- API handlers live in src/api/',
    '- Prisma migrations live under prisma/',
  ].join('\n'));

  writeMemory(dir, 'release-notes', [
    '# Release Notes Memory',
    '',
    '## Purpose',
    'Keep the last reviewed release scope for this workspace.',
    '',
    '## Context',
    '- Updated: 2026-04-05',
    '- No secrets or credentials belong here.',
  ].join('\n'));

  writeGlobalMcp(homeDir, {
    mcpServers: {
      context7: {
        command: 'npx',
        args: ['-y', '@upstash/context7-mcp@latest'],
      },
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github@latest'],
        env: {
          GITHUB_TOKEN: '${env:GITHUB_TOKEN}',
        },
      },
    },
  });

  return { dir, homeDir };
}

function buildLegacyWindsurfrules() {
  const dir = mkFixture('legacy');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, '.windsurfrules', [
    'You are Cascade.',
    'Always use the repository conventions.',
    'Push fixes directly when done.',
  ].join('\n'));
  return { dir };
}

function buildCascadeFocusedRepo() {
  const base = buildRichWindsurfRepo();
  writeFile(base.dir, '.windsurf/workflows/debug.md', [
    'name: Debug',
    'description: Step-by-step debugging workflow',
    '',
    '1. Inspect app/, src/api/, and prisma/ together',
    '2. Run npm test',
    '3. Summarize the root cause',
  ].join('\n'));
  return base;
}

function buildMultiPlatformRepo() {
  const base = buildRichWindsurfRepo();
  writeFile(base.dir, 'CLAUDE.md', '# Claude surface\nKeep Claude-specific hooks here.\n');
  writeFile(base.dir, 'AGENTS.md', '# OpenCode/Codex surface\n');
  writeFile(base.dir, 'GEMINI.md', '# Gemini surface\n');
  writeFile(base.dir, '.github/copilot-instructions.md', '# Copilot surface\n');
  return base;
}

module.exports = {
  mkFixture,
  writeFile,
  writeJson,
  withTempHome,
  buildEmptyRepo,
  buildRichWindsurfRepo,
  buildLegacyWindsurfrules,
  buildCascadeFocusedRepo,
  buildMultiPlatformRepo,
};
