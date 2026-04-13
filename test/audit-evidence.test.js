/**
 * CTO-04 — File-level evidence reinforcement tests.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveEvidence, sliceSnippet } = require('../src/audit/evidence');
const { ProjectContext } = require('../src/context');

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-evidence-'));
}

describe('resolveEvidence (CTO-04)', () => {
  test('resolves CLAUDE.md file and includes snippet for importSyntax', () => {
    const dir = mktmp();
    fs.writeFileSync(
      path.join(dir, 'CLAUDE.md'),
      'line1\nline2\nline3\nline4\nline5\n',
    );
    const ctx = new ProjectContext(dir);
    const ev = resolveEvidence('importSyntax', ctx);
    expect(ev).toBeTruthy();
    expect(ev.file).toBe('CLAUDE.md');
    expect(ev.line).toBe(1);
    expect(typeof ev.snippet).toBe('string');
    expect(ev.snippet.length).toBeGreaterThan(0);
  });

  test('returns null for checks about genuinely absent files', () => {
    const dir = mktmp();
    const ctx = new ProjectContext(dir);
    // No CLAUDE.md in this dir → category (c).
    const ev = resolveEvidence('importSyntax', ctx);
    expect(ev).toBeNull();
  });

  test('resolves .claude/settings.json with line for permissionDeny', () => {
    const dir = mktmp();
    fs.mkdirSync(path.join(dir, '.claude'));
    fs.writeFileSync(
      path.join(dir, '.claude', 'settings.json'),
      JSON.stringify({ permissions: { deny: [] } }, null, 2),
    );
    const ctx = new ProjectContext(dir);
    const ev = resolveEvidence('permissionDeny', ctx);
    expect(ev).toBeTruthy();
    expect(ev.file).toBe('.claude/settings.json');
    expect(ev.line).toBeGreaterThanOrEqual(1);
  });

  test('returns null for unknown check keys', () => {
    const dir = mktmp();
    const ctx = new ProjectContext(dir);
    expect(resolveEvidence('doesNotExistKey', ctx)).toBeNull();
  });

  test('enriches existing file with snippet', () => {
    const dir = mktmp();
    fs.writeFileSync(
      path.join(dir, 'README.md'),
      'alpha\nbeta\ngamma\ndelta\nepsilon\n',
    );
    const ctx = new ProjectContext(dir);
    const ev = resolveEvidence('anyKey', ctx, { file: 'README.md', line: 3 });
    expect(ev).toBeTruthy();
    expect(ev.file).toBe('README.md');
    expect(ev.line).toBe(3);
    expect(ev.snippet).toContain('gamma');
  });

  test('sliceSnippet caps to 300 chars', () => {
    const content = 'x'.repeat(1000);
    const snippet = sliceSnippet(content, 1);
    expect(snippet.length).toBeLessThanOrEqual(300);
  });
});
