/**
 * SILENT-01 follow-through — harmony must not write to surfaces the
 * platform has retired.
 *
 * Found by dogfooding on 2026-07-29: the only content in the research
 * repo's `.cursorrules` was a block `nerviq harmony sync` had put there.
 * The tool was manufacturing the exact deprecated surface that
 * `agent-config-silently-ignored` reports.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateHarmonySync } = require('../src/harmony/sync');
const { buildCanonicalModel } = require('../src/harmony/canon');

function withRepo(name, files, assert) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-hsync-${name}-`));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
    }
    const model = buildCanonicalModel(dir);
    assert(generateHarmonySync(model, { syncInstructions: true, syncMcp: false }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function cursorTargets(plan) {
  return (plan.files || []).filter((f) => f.platform === 'cursor').map((f) => f.path);
}

describe('SILENT-01 harmony writes to the current Cursor surface', () => {
  test('targets .cursor/rules/*.mdc when the modern directory exists', () => {
    withRepo('modern', {
      'CLAUDE.md': '# Claude\nRun `npm test`.\n',
      '.cursor/rules/existing.mdc': '---\ndescription: x\nalwaysApply: true\n---\n\nRules.\n',
    }, (plan) => {
      const targets = cursorTargets(plan);
      expect(targets).toContain('.cursor/rules/nerviq-managed.mdc');
      expect(targets).not.toContain('.cursorrules');
    });
  });

  test('a newly created .mdc carries frontmatter, or Cursor ignores it', () => {
    withRepo('frontmatter', {
      'CLAUDE.md': '# Claude\nRun `npm test`.\n',
      '.cursor/rules/existing.mdc': '---\ndescription: x\nalwaysApply: true\n---\n\nRules.\n',
    }, (plan) => {
      const created = (plan.files || []).find((f) => f.path === '.cursor/rules/nerviq-managed.mdc');
      expect(created).toBeTruthy();
      if (created.action === 'create') {
        expect(created.content.startsWith('---\n')).toBe(true);
        expect(created.content).toContain('alwaysApply: true');
      }
    });
  });

  test('falls back to .cursorrules only when there is no .cursor/rules directory', () => {
    withRepo('legacy', {
      'CLAUDE.md': '# Claude\nRun `npm test`.\n',
      '.cursorrules': '# Cursor\nRules.\n',
    }, (plan) => {
      const targets = cursorTargets(plan);
      expect(targets).toContain('.cursorrules');
      expect(targets).not.toContain('.cursor/rules/nerviq-managed.mdc');
    });
  });
});
