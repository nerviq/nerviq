const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildWatchPlan, supportsNativeRecursiveWatch } = require('../src/watch');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-watch-${name}-`));
}

function rel(root, fullPath) {
  const relative = path.relative(root, fullPath).replace(/\\/g, '/');
  return relative || '.';
}

describe('watch planning', () => {
  test('supports native recursive watch only on win32 and darwin', () => {
    expect(supportsNativeRecursiveWatch('win32')).toBe(true);
    expect(supportsNativeRecursiveWatch('darwin')).toBe(true);
    expect(supportsNativeRecursiveWatch('linux')).toBe(false);
  });

  test('buildWatchPlan uses native recursive directory watches where supported', () => {
    const dir = mkFixture('native');
    try {
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Test');
      fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
      fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });

      const plan = buildWatchPlan(dir, 'win32')
        .map(item => `${rel(dir, item.path)}|${item.recursive}`);

      expect(plan).toEqual(expect.arrayContaining([
        '.|false',
        'CLAUDE.md|false',
        '.claude|true',
        '.github|true',
      ]));
      expect(plan).not.toContain('.claude/hooks|false');
      expect(plan).not.toContain('.github/workflows|false');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('buildWatchPlan expands nested directories when native recursive watch is unavailable', () => {
    const dir = mkFixture('fallback');
    try {
      fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
      fs.mkdirSync(path.join(dir, '.claude', 'agents', 'nested'), { recursive: true });
      fs.mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });

      const plan = buildWatchPlan(dir, 'linux')
        .map(item => `${rel(dir, item.path)}|${item.recursive}`);

      expect(plan).toEqual(expect.arrayContaining([
        '.|false',
        '.claude|false',
        '.claude/hooks|false',
        '.claude/agents|false',
        '.claude/agents/nested|false',
        '.github|false',
        '.github/workflows|false',
      ]));
      expect(plan).not.toContain('.claude|true');
      expect(plan).not.toContain('.github|true');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('buildWatchPlan keeps repo-root watch even when optional targets do not exist yet', () => {
    const dir = mkFixture('root-only');
    try {
      const plan = buildWatchPlan(dir, 'linux')
        .map(item => `${rel(dir, item.path)}|${item.recursive}`);

      expect(plan).toEqual(['.|false']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
