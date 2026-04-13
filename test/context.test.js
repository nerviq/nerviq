const fs = require('fs');
const os = require('os');
const path = require('path');

const { ProjectContext } = require('../src/context');

function mkFixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'context-jest-'));
}

function cleanFixture(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('ProjectContext.claudeMdContent pointer expansion', () => {
  let dir;
  beforeEach(() => { dir = mkFixture(); });
  afterEach(() => { cleanFixture(dir); });

  test('returns raw content when CLAUDE.md is substantive', () => {
    const body = '# Heading\n\n## Section\nSubstantive body lorem ipsum dolor sit amet consectetur.'.repeat(5);
    writeFile(dir, 'CLAUDE.md', body);
    const ctx = new ProjectContext(dir);
    expect(ctx.claudeMdContent()).toContain('Substantive body');
  });

  test('expands bare filename pointer (AGENTS.md)', () => {
    writeFile(dir, 'CLAUDE.md', 'AGENTS.md\n');
    writeFile(dir, 'AGENTS.md', '# Agents\nExpanded body content.');
    const ctx = new ProjectContext(dir);
    expect(ctx.claudeMdContent()).toContain('Expanded body content');
  });

  test('expands @-prefixed pointer (Claude Code @import syntax)', () => {
    // Root cause of site self-dogfood score 25: @AGENTS.md was not recognised.
    writeFile(dir, 'CLAUDE.md', '@AGENTS.md\n');
    writeFile(dir, 'AGENTS.md', '# Agents\nImported via @ syntax.');
    const ctx = new ProjectContext(dir);
    const out = ctx.claudeMdContent();
    expect(out).toContain('Imported via @ syntax');
  });

  test('expands @ with ./ prefix (@./docs/CODING.md)', () => {
    writeFile(dir, 'CLAUDE.md', '@./docs/CODING.md\n');
    writeFile(dir, 'docs/CODING.md', '# Coding\nRelative import target.');
    const ctx = new ProjectContext(dir);
    expect(ctx.claudeMdContent()).toContain('Relative import target');
  });

  test('expands nested subdirectory pointer (docs/CODING.md)', () => {
    writeFile(dir, 'CLAUDE.md', 'docs/CODING.md\n');
    writeFile(dir, 'docs/CODING.md', '# Coding\nNested pointer target.');
    const ctx = new ProjectContext(dir);
    expect(ctx.claudeMdContent()).toContain('Nested pointer target');
  });

  test('returns null when no CLAUDE.md exists', () => {
    const ctx = new ProjectContext(dir);
    expect(ctx.claudeMdContent()).toBeNull();
  });
});
