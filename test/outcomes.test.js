const fs = require('fs');
const os = require('os');
const path = require('path');

const { audit, buildTopNextActions } = require('../src/audit');
const { recordRecommendationOutcome } = require('../src/activity');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-outcomes-${name}-`));
}

describe('Recommendation outcome feedback loop', () => {
  test('buildTopNextActions annotates measured feedback when outcomes exist', () => {
    const actions = buildTopNextActions([
      { key: 'permissionDeny', name: 'Add deny rules', impact: 'high', fix: 'Add deny rules', category: 'security' },
      { key: 'testCommand', name: 'Add test command', impact: 'high', fix: 'Add test command', category: 'quality' },
    ], 5, {
      permissionDeny: {
        total: 2,
        accepted: 2,
        rejected: 0,
        deferred: 0,
        positive: 2,
        negative: 0,
        avgScoreDelta: 10,
      },
    });

    expect(actions[0].key).toBe('permissionDeny');
    expect(actions[0].evidenceClass).toBe('measured');
    expect(actions[0].rankingAdjustment).toBeGreaterThan(0);
    expect(actions[0].signals.some(signal => signal.startsWith('feedback:'))).toBe(true);
  });

  test('audit returns measured feedback metadata after local outcomes are recorded', async () => {
    const dir = mkFixture('audit-feedback');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'feedback-app' }, null, 2));
      recordRecommendationOutcome(dir, {
        key: 'claudeMd',
        status: 'accepted',
        effect: 'positive',
        scoreDelta: 18,
      });

      const result = await audit({ dir, silent: true });
      const claudeMdAction = result.topNextActions.find(item => item.key === 'claudeMd');
      expect(claudeMdAction).toBeTruthy();
      expect(claudeMdAction.evidenceClass).toBe('measured');
      expect(claudeMdAction.feedback).toBeTruthy();
      expect(result.recommendationOutcomes.totalEntries).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
