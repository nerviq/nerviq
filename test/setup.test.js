const fs = require('fs');
const os = require('os');
const path = require('path');
const { setup } = require('../src/setup');
const { audit } = require('../src/audit');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-jest-setup-${name}-`));
}

function writeJson(dir, file, value) {
  fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
}

describe('Setup', () => {
  test('creates CLAUDE.md on empty project', async () => {
    const dir = mkFixture('create-claude');
    try {
      writeJson(dir, 'package.json', { name: 'test-app', scripts: { test: 'jest' } });
      await setup({ dir, auto: true, silent: true });
      expect(fs.existsSync(path.join(dir, 'CLAUDE.md'))).toBe(true);
      const content = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      expect(content).toContain('mermaid');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('creates hooks as .js files (not .sh)', async () => {
    const dir = mkFixture('hooks-js');
    try {
      writeJson(dir, 'package.json', { name: 'test-app' });
      await setup({ dir, auto: true, silent: true });
      const hooksDir = path.join(dir, '.claude', 'hooks');
      if (fs.existsSync(hooksDir)) {
        const hooks = fs.readdirSync(hooksDir);
        for (const hook of hooks) {
          expect(hook).toMatch(/\.js$/);
          expect(hook).not.toMatch(/\.sh$/);
        }
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('creates settings.json with hooks registered', async () => {
    const dir = mkFixture('settings');
    try {
      writeJson(dir, 'package.json', { name: 'test-app' });
      await setup({ dir, auto: true, silent: true });
      const settingsPath = path.join(dir, '.claude', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(settings.hooks).toBeTruthy();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('does not overwrite existing CLAUDE.md', async () => {
    const dir = mkFixture('preserve');
    try {
      writeJson(dir, 'package.json', { name: 'test-app' });
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# My Custom CLAUDE.md\n');
      await setup({ dir, auto: true, silent: true });
      const content = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      expect(content).toBe('# My Custom CLAUDE.md\n');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('setup improves audit score', async () => {
    const dir = mkFixture('improves');
    try {
      writeJson(dir, 'package.json', { name: 'test-app', scripts: { test: 'jest', lint: 'eslint' } });
      const before = await audit({ dir, silent: true });
      await setup({ dir, auto: true, silent: true });
      const after = await audit({ dir, silent: true });
      expect(after.score).toBeGreaterThan(before.score);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('full audit → setup → audit cycle', async () => {
    const dir = mkFixture('cycle');
    try {
      writeJson(dir, 'package.json', { name: 'cycle-test', scripts: { test: 'jest', build: 'tsc' } });
      const before = await audit({ dir, silent: true });
      await setup({ dir, auto: true, silent: true });
      const after = await audit({ dir, silent: true });
      expect(after.score).toBeGreaterThan(before.score);
      expect(after.passed).toBeGreaterThan(before.passed);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
