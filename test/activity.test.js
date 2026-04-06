const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  readSnapshotIndex,
  getHistory,
  compareLatest,
  formatHistory,
  exportTrendReport,
  recordRecommendationOutcome,
  getRecommendationOutcomeSummary,
  getRecommendationAdjustment,
} = require('../src/activity');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-jest-activity-${name}-`));
}

describe('Activity - Snapshots', () => {
  test('readSnapshotIndex returns empty array for no snapshots', () => {
    const dir = mkFixture('no-snapshots');
    try {
      expect(readSnapshotIndex(dir)).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('getHistory returns sorted entries', () => {
    const dir = mkFixture('sorted');
    try {
      const snapshotDir = path.join(dir, '.nerviq', 'snapshots');
      fs.mkdirSync(snapshotDir, { recursive: true });
      fs.writeFileSync(path.join(snapshotDir, 'index.json'), JSON.stringify([
        { snapshotKind: 'audit', createdAt: '2026-01-01T00:00:00Z', summary: { score: 50 } },
        { snapshotKind: 'audit', createdAt: '2026-02-01T00:00:00Z', summary: { score: 70 } },
      ]));
      const history = getHistory(dir);
      expect(history[0].summary.score).toBe(70);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('readSnapshotIndex falls back to legacy snapshot path when .nerviq is absent', () => {
    const dir = mkFixture('legacy-snapshots');
    try {
      const snapshotDir = path.join(dir, '.claude', 'nerviq-cli', 'snapshots');
      fs.mkdirSync(snapshotDir, { recursive: true });
      fs.writeFileSync(path.join(snapshotDir, 'index.json'), JSON.stringify([
        { snapshotKind: 'audit', createdAt: '2026-03-01T00:00:00Z', summary: { score: 65 } },
      ]));

      const entries = readSnapshotIndex(dir);
      expect(entries).toHaveLength(1);
      expect(entries[0].summary.score).toBe(65);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('compareLatest returns null with < 2 snapshots', () => {
    const dir = mkFixture('one-snap');
    try {
      expect(compareLatest(dir)).toBeNull();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('formatHistory returns message for no snapshots', () => {
    const dir = mkFixture('no-history');
    try {
      expect(formatHistory(dir)).toContain('No snapshots');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('exportTrendReport returns null for no snapshots', () => {
    const dir = mkFixture('no-trend');
    try {
      expect(exportTrendReport(dir)).toBeNull();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('Activity - Recommendation outcomes', () => {
  test('recordRecommendationOutcome writes artifacts and aggregates summary', () => {
    const dir = mkFixture('outcomes');
    try {
      recordRecommendationOutcome(dir, {
        key: 'permissionDeny',
        status: 'accepted',
        effect: 'positive',
        scoreDelta: 12,
      });
      recordRecommendationOutcome(dir, {
        key: 'permissionDeny',
        status: 'rejected',
        effect: 'negative',
      });

      const summary = getRecommendationOutcomeSummary(dir);
      expect(summary.totalEntries).toBe(2);
      expect(summary.byKey.permissionDeny.accepted).toBe(1);
      expect(summary.byKey.permissionDeny.rejected).toBe(1);
      expect(summary.byKey.permissionDeny.avgScoreDelta).toBe(12);
      expect(typeof getRecommendationAdjustment(summary.byKey, 'permissionDeny')).toBe('number');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
