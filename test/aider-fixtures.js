const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-aider-${name}-`));
}

function writeFile(base, filePath, content) {
  const fullPath = path.join(base, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

function writeJson(base, filePath, payload) {
  writeFile(base, filePath, JSON.stringify(payload, null, 2));
}

function initGitRepo(dir, commitAll = true) {
  spawnSync('git', ['init'], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.email', 'fixtures@nerviq.test'], { cwd: dir, encoding: 'utf8' });
  spawnSync('git', ['config', 'user.name', 'Nerviq Fixtures'], { cwd: dir, encoding: 'utf8' });
  if (commitAll) {
    spawnSync('git', ['add', '.'], { cwd: dir, encoding: 'utf8' });
    spawnSync('git', ['commit', '-m', 'Initial fixture'], { cwd: dir, encoding: 'utf8' });
  }
}

function basePackageJson(extra = {}) {
  return {
    name: 'aider-fixture',
    private: true,
    scripts: {
      test: 'pytest -q',
      lint: 'ruff check .',
      build: 'python -m compileall .',
      format: 'prettier --check .',
    },
    dependencies: {
      express: '^5.1.0',
    },
    devDependencies: {
      prettier: '^3.0.0',
      vitest: '^3.0.0',
    },
    ...extra,
  };
}

function buildEmptyRepo() {
  const dir = mkFixture('empty');
  writeJson(dir, 'package.json', { name: 'empty-aider' });
  return { dir };
}

function buildRichAiderRepo() {
  const dir = mkFixture('rich');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, '.gitignore', '.env\n.aider*\nnode_modules\n');
  writeFile(dir, '.env', 'OPENAI_API_KEY=test-openai-key\n');
  writeFile(dir, '.aiderignore', '.env\ncoverage/\ndist/\n');
  writeFile(dir, 'requirements.txt', 'aider-chat==0.82.0\nfastapi==0.115.0\npytest==8.0.0\n');
  writeFile(dir, '.aider.model.settings.yml', [
    'models:',
    '  gpt-5-mini:',
    '    edit_format: diff',
    '  gpt-5.4:',
    '    edit_format: whole',
  ].join('\n'));
  writeFile(dir, '.aider.conf.yml', [
    'model: gpt-5.4',
    'editor-model: gpt-5-mini',
    'weak-model: gpt-5-mini',
    'architect: true',
    'auto-commits: true',
    'dirty-commits: true',
    'attribute-author: true',
    'aider-commit-prefix: "aider: "',
    'map-tokens: 2048',
    'lint-cmd: "ruff check ."',
    'test-cmd: "pytest -q"',
    'edit-format: diff',
    'cache-prompts: true',
    'max-chat-history-tokens: 16000',
    'stream: true',
    'read:',
    '  - CONVENTIONS.md',
    'auto-lint: true',
    'auto-test: true',
    'show-diffs: true',
    'pretty: true',
    'git-commit-verify: true',
    'watch-files: true',
    'dark-mode: true',
    'voice-language: en',
  ].join('\n'));
  writeFile(dir, 'README.md', [
    '# Aider Rich Fixture',
    '',
    'This repository documents the Aider workflow for contributors.',
    'Use Aider on feature branches and keep the lint/test loop enabled.',
  ].join('\n'));
  writeFile(dir, 'CONTRIBUTING.md', [
    '# Contributing',
    '',
    'All Aider-generated changes require code review through a pull request.',
  ].join('\n'));
  writeFile(dir, 'CONVENTIONS.md', [
    '# Aider Conventions',
    '',
    '## Architecture',
    '- src/api/ contains HTTP handlers.',
    '- src/services/ contains business logic.',
    '- prisma/ stores schema and migrations.',
    '',
    '## Verification',
    '- Run pytest -q',
    '- Run ruff check .',
    '- Run python -m compileall .',
    '- Add unit test coverage and integration test coverage for changed paths.',
    '',
    '## Coding Standards',
    '- Use camelCase in TypeScript and snake_case in Python where idiomatic.',
    '- Keep functions under a reasonable complexity threshold.',
    '- Remove dead code with knip or equivalent checks.',
    '- Use explicit naming conventions for DTOs and services.',
    '',
    '## Error Handling',
    '- Use structured exceptions and consistent API error envelopes.',
    '- Validate requests before touching the database.',
    '- Document response format consistency and API versioning.',
    '- Enforce rate limiting on public endpoints.',
    '',
    '## Database',
    '- Record migration strategy for schema changes.',
    '- Prevent N+1 queries and document connection pooling.',
    '- Maintain schema documentation and seed data notes.',
    '',
    '## Auth',
    '- Document authentication flow, token handling, session management, RBAC, and OAuth/SSO.',
    '- Rotate credentials regularly.',
    '',
    '## Monitoring',
    '- Use logging, error tracking, metrics, health checks, alerting, and log retention policies.',
    '',
    '## Workflow',
    '- Document /add, /drop, /run, /test, and /undo usage.',
    '- Mention /web browser docs lookup and note Playwright URL scraping side effects.',
    '- Watch mode is available for local editing loops.',
    '- Voice mode is optional for hands-free sessions.',
    '- VS Code and Neovim integrations are both supported by the team.',
    '',
    '## Branching',
    '- Run Aider only on feature branches and open a PR for review.',
    '- Every aider change starts on an aider feature branch.',
    '- This repo follows a multi-platform strategy with Aider and Claude-specific docs kept separate.',
    '',
    '## Cost',
    '- Use prompt caching, the weak model, and the editor model to control cost.',
    '- Keep token usage and caching strategy visible for repetitive tasks.',
  ].join('\n'));
  writeFile(dir, '.pre-commit-config.yaml', [
    'repos:',
    '  - repo: https://github.com/astral-sh/ruff-pre-commit',
    '    rev: v0.11.0',
    '    hooks:',
    '      - id: ruff',
  ].join('\n'));
  writeFile(dir, '.ruff.toml', 'line-length = 100\n');
  writeFile(dir, '.editorconfig', 'root = true\n[*]\nend_of_line = lf\n');
  writeFile(dir, '.nycrc', '{ "branches": 80 }\n');
  writeFile(dir, '.github/workflows/ci.yml', [
    'name: CI',
    'on: [push, pull_request]',
    'jobs:',
    '  verify:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo lint step',
    '      - run: ruff check .',
    '      - run: pytest -q',
  ].join('\n'));
  writeFile(dir, 'openapi.yaml', 'openapi: 3.1.0\ninfo:\n  title: Aider Fixture API\n  version: 1.0.0\n');
  writeFile(dir, 'src/api/health.py', 'def health():\n    return {"ok": True}\n');
  writeFile(dir, 'src/services/users.py', 'def list_users():\n    return []\n');
  writeFile(dir, 'tests/test_health.py', 'def test_health():\n    assert True\n');
  initGitRepo(dir, true);
  return { dir };
}

function buildNoConfigRepo() {
  const dir = mkFixture('no-config');
  writeJson(dir, 'package.json', basePackageJson());
  writeFile(dir, '.gitignore', '.env\n.aider*\n');
  writeFile(dir, 'CONVENTIONS.md', '# Conventions\n\nDocument branch strategy and workflow.\n');
  initGitRepo(dir, true);
  return { dir };
}

function buildGitOnlyRepo() {
  const dir = mkFixture('git-only');
  writeJson(dir, 'package.json', { name: 'git-only-aider' });
  initGitRepo(dir, true);
  return { dir };
}

function buildDirtyAiderRepo() {
  const base = buildRichAiderRepo();
  writeFile(base.dir, 'src/services/dirty.py', 'DIRTY = True\n');
  return base;
}

function buildMultiPlatformAiderRepo() {
  const base = buildRichAiderRepo();
  writeFile(base.dir, 'CLAUDE.md', '# Claude surface\n');
  writeFile(base.dir, 'AGENTS.md', '# Shared agent surface\n');
  return base;
}

module.exports = {
  mkFixture,
  writeFile,
  writeJson,
  initGitRepo,
  buildEmptyRepo,
  buildRichAiderRepo,
  buildNoConfigRepo,
  buildGitOnlyRepo,
  buildDirtyAiderRepo,
  buildMultiPlatformAiderRepo,
};
