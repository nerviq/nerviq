const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// ─── Helpers ────────────────────────────────────────────────────────────────

const CLI_PATH = path.resolve(__dirname, '..', 'bin', 'cli.js');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `e2e-jest-${name}-`));
}

function cleanFixture(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function writeJson(dir, relPath, value) {
  writeFile(dir, relPath, JSON.stringify(value, null, 2));
}

function setupMixedWorkspaceFixture(dir) {
  writeJson(dir, 'package.json', { name: 'mono', workspaces: ['packages/*'] });
  writeJson(dir, 'packages/web/package.json', {
    name: '@mono/web',
    dependencies: { react: '^19.0.0' },
  });
  writeFile(dir, 'packages/api/go.mod', 'module example.com/api\n\ngo 1.23\n');
  writeFile(dir, 'packages/jobs/pyproject.toml', [
    '[project]',
    'name = "jobs"',
    'version = "0.1.0"',
  ].join('\n'));
}

/**
 * Run the CLI with the given args, using cwd as the project directory.
 */
function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
  });
}

function setupClaudeFixture(dir) {
  writeFile(dir, 'CLAUDE.md', [
    '# Project Instructions',
    '',
    '## Role',
    'You are a senior engineer.',
    '',
    '## Verification',
    'npm test',
    'eslint .',
    '',
    '## Language',
    'English',
  ].join('\n'));
  writeJson(dir, 'package.json', { name: 'e2e-test-project', scripts: { test: 'echo ok' } });
  writeFile(dir, '.gitignore', 'node_modules\n.env\n');
}

function setupCodexFixture(dir) {
  writeFile(dir, 'AGENTS.md', [
    '# Codex Agent Instructions',
    '',
    '## Role',
    'You are a code review agent.',
    '',
    '## Commands',
    'npm test',
  ].join('\n'));
  writeJson(dir, 'package.json', { name: 'e2e-codex-test' });
}

// ─── E2E Tests ──────────────────────────────────────────────────────────────

describe('E2E - CLI audit --json (claude)', () => {
  test('nerviq audit --platform claude --json returns valid JSON with score', () => {
    const dir = mkFixture('e2e-claude');
    try {
      setupClaudeFixture(dir);
      const result = runCli(['audit', '--platform', 'claude', '--json'], dir);
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty('score');
      expect(typeof output.score).toBe('number');
    } finally { cleanFixture(dir); }
  });

  test('score is between 0 and 100', () => {
    const dir = mkFixture('e2e-score-range');
    try {
      setupClaudeFixture(dir);
      const result = runCli(['audit', '--platform', 'claude', '--json'], dir);
      const output = JSON.parse(result.stdout);
      expect(output.score).toBeGreaterThanOrEqual(0);
      expect(output.score).toBeLessThanOrEqual(100);
    } finally { cleanFixture(dir); }
  });

  test('checkCount is within expected range', () => {
    const dir = mkFixture('e2e-check-count');
    try {
      setupClaudeFixture(dir);
      const result = runCli(['audit', '--platform', 'claude', '--json'], dir);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty('results');
      expect(Array.isArray(output.results)).toBe(true);
      expect(output.results.length).toBeGreaterThanOrEqual(5);
      expect(output.results.length).toBeLessThanOrEqual(450);
    } finally { cleanFixture(dir); }
  });

  test('audit result has expected structure', () => {
    const dir = mkFixture('e2e-structure');
    try {
      setupClaudeFixture(dir);
      const result = runCli(['audit', '--platform', 'claude', '--json'], dir);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty('score');
      expect(output).toHaveProperty('results');
      for (const check of output.results.slice(0, 5)) {
        expect(check).toHaveProperty('key');
        expect(check).toHaveProperty('passed');
      }
    } finally { cleanFixture(dir); }
  });
});

describe('E2E - CLI audit --json (codex)', () => {
  test('nerviq audit --platform codex --json returns valid JSON', () => {
    const dir = mkFixture('e2e-codex');
    try {
      setupCodexFixture(dir);
      const result = runCli(['audit', '--platform', 'codex', '--json'], dir);
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty('score');
      expect(typeof output.score).toBe('number');
    } finally { cleanFixture(dir); }
  });

  test('codex audit score is between 0 and 100', () => {
    const dir = mkFixture('e2e-codex-range');
    try {
      setupCodexFixture(dir);
      const result = runCli(['audit', '--platform', 'codex', '--json'], dir);
      const output = JSON.parse(result.stdout);
      expect(output.score).toBeGreaterThanOrEqual(0);
      expect(output.score).toBeLessThanOrEqual(100);
    } finally { cleanFixture(dir); }
  });
});

describe('E2E - CLI audit unsupported platform', () => {
  test('nerviq audit --platform foobar exits with error', () => {
    const dir = mkFixture('e2e-foobar');
    try {
      writeJson(dir, 'package.json', { name: 'test' });
      const result = runCli(['audit', '--platform', 'foobar'], dir);
      expect(result.status).toBe(1);
      const stderr = result.stderr || '';
      expect(stderr).toMatch(/unsupported/i);
    } finally { cleanFixture(dir); }
  });
});

describe('E2E - CLI additional platform and aggregation flows', () => {
  test('nerviq audit --platform gemini returns valid JSON', () => {
    const dir = mkFixture('e2e-gemini');
    try {
      writeFile(dir, 'GEMINI.md', '# Gemini\nInstructions');
      writeJson(dir, 'package.json', { name: 'test' });
      const result = runCli(['audit', '--platform', 'gemini', '--json'], dir);
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.platform).toBe('gemini');
      expect(typeof output.score).toBe('number');
    } finally { cleanFixture(dir); }
  });

  test('audit --workspace returns aggregated workspace JSON', () => {
    const dir = mkFixture('e2e-workspace');
    try {
      setupMixedWorkspaceFixture(dir);
      const result = runCli(['audit', '--platform', 'claude', '--workspace', 'packages/*', '--json'], dir);
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.workspaceCount).toBe(3);
      expect(output.summaryType).toBe('monorepo-workspace-audit');
      expect(output.selectionMode).toBe('explicit-patterns');
      expect(output.rootGovernance.scoreType).toBe('root-live-audit');
      expect(output.workspaceAggregate.scoreType).toBe('workspace-average-live-audit');
      expect(output.scoreSemantics.workspaceProfiles).toMatch(/stack-specific check profile/i);
      expect(output.workspaces).toHaveLength(3);
      expect(output.workspaces.every((item) => item.scoreType === 'workspace-live-audit')).toBe(true);
      expect(output.workspaces.map((item) => item.workspaceProfile.label)).toEqual(expect.arrayContaining([
        'Go workspace',
        'Python workspace',
        'Node / JS workspace',
      ]));
      expect(output.profileBreakdown).toEqual(expect.arrayContaining([
        expect.objectContaining({ profileKey: 'go-workspace', workspaceCount: 1 }),
        expect.objectContaining({ profileKey: 'python-workspace', workspaceCount: 1 }),
        expect.objectContaining({ profileKey: 'node-workspace', workspaceCount: 1 }),
      ]));
    } finally { cleanFixture(dir); }
  });

  test('audit --workspace text output explains root, package, and stack-specific profile semantics', () => {
    const dir = mkFixture('e2e-workspace-text');
    try {
      setupMixedWorkspaceFixture(dir);
      const result = runCli(['audit', '--platform', 'claude', '--workspace', 'packages/*'], dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/Root governance audit:/);
      expect(result.stdout).toMatch(/Workspace audit average:/);
      expect(result.stdout).toMatch(/Workspace profiles:/);
      expect(result.stdout).toMatch(/Aggregate vs package:/);
      expect(result.stdout).toMatch(/Stack-specific checks:/);
      expect(result.stdout).toMatch(/Go workspace/);
      expect(result.stdout).toMatch(/Python workspace/);
      expect(result.stdout).toMatch(/Node \/ JS workspace/);
      expect(result.stdout).toMatch(/Stacks: Go/);
    } finally { cleanFixture(dir); }
  });

  test('org scan --json aggregates multiple repos', () => {
    const dir = mkFixture('e2e-org');
    try {
      writeFile(dir, 'repo-a/CLAUDE.md', '# Repo A\n');
      writeJson(dir, 'repo-a/package.json', { name: 'repo-a' });
      writeFile(dir, 'repo-b/CLAUDE.md', '# Repo B\n');
      writeJson(dir, 'repo-b/package.json', { name: 'repo-b' });
      const result = runCli(['org', 'scan', 'repo-a', 'repo-b', '--json'], dir);
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output.repoCount).toBe(2);
      expect(output.repos).toHaveLength(2);
    } finally { cleanFixture(dir); }
  });
});

describe('E2E - CLI flags', () => {
  test('--lite flag produces shorter or equal output', () => {
    const dir = mkFixture('e2e-lite');
    try {
      setupClaudeFixture(dir);
      const full = runCli(['audit', '--platform', 'claude', '--json'], dir);
      const lite = runCli(['audit', '--platform', 'claude', '--json', '--lite'], dir);
      expect(full.status).toBe(0);
      expect(lite.status).toBe(0);
      const fullOutput = JSON.parse(full.stdout);
      const liteOutput = JSON.parse(lite.stdout);
      expect(liteOutput.results.length).toBeLessThanOrEqual(fullOutput.results.length);
    } finally { cleanFixture(dir); }
  });

  test('--threshold 0 exits 0', () => {
    const dir = mkFixture('e2e-threshold-low');
    try {
      setupClaudeFixture(dir);
      const result = runCli(['audit', '--platform', 'claude', '--threshold', '0'], dir);
      expect(result.status).toBe(0);
    } finally { cleanFixture(dir); }
  });

  test('--threshold 999 exits 1', () => {
    const dir = mkFixture('e2e-threshold-high');
    try {
      setupClaudeFixture(dir);
      const result = runCli(['audit', '--platform', 'claude', '--threshold', '100'], dir);
      // With threshold=100 and no project being perfect, expect exit 1
      expect(result.status).toBe(1);
    } finally { cleanFixture(dir); }
  });

  test('audit without platform defaults to claude', () => {
    const dir = mkFixture('e2e-default-platform');
    try {
      setupClaudeFixture(dir);
      const result = runCli(['audit', '--json'], dir);
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toHaveProperty('score');
    } finally { cleanFixture(dir); }
  });
});

describe('E2E - CLI version and help', () => {
  test('version command prints version number', () => {
    const result = runCli(['version'], os.tmpdir());
    const combined = (result.stdout || '') + (result.stderr || '');
    expect(combined).toMatch(/\d+\.\d+/);
  });

  test('help command exits 0', () => {
    const result = runCli(['help'], os.tmpdir());
    expect(result.status).toBe(0);
  });
});
