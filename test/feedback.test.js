const fs = require('fs');
const os = require('os');
const path = require('path');

const { collectFeedback, saveFeedback, getFeedbackSummary } = require('../src/feedback');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-feedback-${name}-`));
}

describe('Feedback artifacts', () => {
  test('saveFeedback writes a local artifact and summary aggregates by key', () => {
    const dir = mkFixture('save');
    try {
      const first = saveFeedback(dir, {
        key: 'claudeMd',
        name: 'CLAUDE.md project instructions',
        helpful: true,
        platform: 'claude',
        sourceCommand: 'audit',
      });
      const second = saveFeedback(dir, {
        key: 'claudeMd',
        name: 'CLAUDE.md project instructions',
        helpful: false,
        platform: 'claude',
        sourceCommand: 'audit',
      });

      expect(fs.existsSync(path.join(dir, first.relativePath))).toBe(true);
      expect(fs.existsSync(path.join(dir, second.relativePath))).toBe(true);

      const summary = getFeedbackSummary(dir);
      expect(summary.totalEntries).toBe(2);
      expect(summary.helpful).toBe(1);
      expect(summary.unhelpful).toBe(1);
      expect(summary.byKey.claudeMd).toEqual({ total: 2, helpful: 1, unhelpful: 1 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('collectFeedback skips prompting on non-interactive streams', async () => {
    const dir = mkFixture('collect');
    try {
      const result = await collectFeedback(dir, {
        findings: [{ key: 'claudeMd', name: 'CLAUDE.md project instructions' }],
        stdin: { isTTY: false },
        stdout: { isTTY: false },
      });

      expect(result.mode).toBe('skipped-noninteractive');
      expect(result.saved).toBe(0);
      expect(result.skipped).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('getFeedbackSummary falls back to legacy feedback path when .nerviq is absent', () => {
    const dir = mkFixture('legacy-feedback');
    try {
      const legacyDir = path.join(dir, '.claude', 'nerviq-cli', 'feedback');
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(path.join(legacyDir, 'legacy.json'), JSON.stringify({
        key: 'claudeMd',
        helpful: true,
      }), 'utf8');

      const summary = getFeedbackSummary(dir);
      expect(summary.totalEntries).toBe(1);
      expect(summary.helpful).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
