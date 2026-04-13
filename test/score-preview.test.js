/**
 * CTO-05 — Score-impact projection tests.
 *
 * Runs the full audit on a synthetic tmp dir and verifies that each
 * topNextActions item carries a sensible projectedScoreDelta /
 * projectedScoreAfter.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('../src/audit');

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-score-preview-'));
}

describe('projected score delta (CTO-05)', () => {
  test('each topNextAction exposes projectedScoreDelta and projectedScoreAfter', async () => {
    const dir = mktmp();
    // Minimal CLAUDE.md so some checks pass, many fail.
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Project\nNotes.\n');
    const result = await audit({ dir, platform: 'claude', silent: true });
    expect(Array.isArray(result.topNextActions)).toBe(true);
    expect(result.topNextActions.length).toBeGreaterThan(0);
    for (const item of result.topNextActions) {
      expect(Number.isFinite(item.projectedScoreDelta)).toBe(true);
      expect(Number.isFinite(item.projectedScoreAfter)).toBe(true);
      expect(item.projectedScoreDelta).toBeGreaterThanOrEqual(0);
      expect(item.projectedScoreAfter).toBeLessThanOrEqual(100);
    }
  });

  test('higher-impact items project larger deltas than lower-impact ones', async () => {
    const dir = mktmp();
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Project\nNotes.\n');
    const result = await audit({ dir, platform: 'claude', silent: true });
    const critical = result.topNextActions.find((a) => a.impact === 'critical');
    const low = result.topNextActions.find((a) => a.impact === 'low');
    if (critical && low) {
      expect(critical.projectedScoreDelta).toBeGreaterThanOrEqual(low.projectedScoreDelta);
    }
  });

  test('projectedScoreAfter = score + projectedScoreDelta', async () => {
    const dir = mktmp();
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Project\nNotes.\n');
    const result = await audit({ dir, platform: 'claude', silent: true });
    for (const item of result.topNextActions) {
      expect(item.projectedScoreAfter).toBe(result.score + item.projectedScoreDelta);
    }
  });
});
