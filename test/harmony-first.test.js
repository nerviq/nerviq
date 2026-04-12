const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI_PATH = path.resolve(__dirname, '..', 'bin', 'cli.js');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `moat01-${name}-`));
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

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
  });
}

function setupTwoPlatformFixture(dir) {
  writeFile(dir, 'CLAUDE.md', '# Project Instructions\n\n## Role\nYou are a senior engineer.\n\n## Commands\nnpm test\n');
  writeFile(dir, 'AGENTS.md', '# Codex Agent\n\n## Role\nReview code.\n\n## Commands\nnpm test\n');
  writeJson(dir, 'package.json', { name: 'moat01-test', scripts: { test: 'echo ok' } });
}

describe('MOAT-01 — Harmony-first default onboarding', () => {
  test('audit on 2-platform repo prints Harmony Score header before platform results', () => {
    const dir = mkFixture('two-platforms');
    try {
      setupTwoPlatformFixture(dir);
      const result = runCli(['audit'], dir);
      const out = (result.stdout || '') + (result.stderr || '');
      expect(out).toMatch(/Harmony Score:\s*.*\/100/);
      expect(out).toMatch(/across 2 platforms/);
    } finally { cleanFixture(dir); }
  });

  test('--no-harmony-first suppresses the Harmony header', () => {
    const dir = mkFixture('suppress');
    try {
      setupTwoPlatformFixture(dir);
      const result = runCli(['audit', '--no-harmony-first'], dir);
      const out = (result.stdout || '') + (result.stderr || '');
      expect(out).not.toMatch(/Harmony Score:\s*.*\/100/);
    } finally { cleanFixture(dir); }
  });

  test('--platform claude (explicit) skips Harmony-first header', () => {
    const dir = mkFixture('explicit');
    try {
      setupTwoPlatformFixture(dir);
      const result = runCli(['audit', '--platform', 'claude'], dir);
      const out = (result.stdout || '') + (result.stderr || '');
      expect(out).not.toMatch(/Harmony Score:\s*.*\/100/);
    } finally { cleanFixture(dir); }
  });

  test('single-platform repo does NOT show Harmony header', () => {
    const dir = mkFixture('single');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project\n\n## Role\nEngineer.\n');
      writeJson(dir, 'package.json', { name: 'single' });
      const result = runCli(['audit'], dir);
      const out = (result.stdout || '') + (result.stderr || '');
      expect(out).not.toMatch(/Harmony Score:\s*.*\/100/);
    } finally { cleanFixture(dir); }
  });

  test('--json on 2-platform repo includes harmony envelope', () => {
    const dir = mkFixture('json-envelope');
    try {
      setupTwoPlatformFixture(dir);
      const result = runCli(['audit', '--json'], dir);
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty('harmony');
      expect(parsed.harmony).toHaveProperty('score');
      expect(typeof parsed.harmony.score).toBe('number');
      expect(Array.isArray(parsed.harmony.platforms)).toBe(true);
      expect(parsed.harmony.platforms.length).toBeGreaterThanOrEqual(2);
    } finally { cleanFixture(dir); }
  });
});
