const fs = require('fs');
const os = require('os');
const path = require('path');

const { recordPattern } = require('../src/usage-patterns');
const { analyzeSuggestions, formatSuggestions } = require('../src/auto-suggest');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-suggest-${name}-`));
}

describe('Auto-suggest rules', () => {
  test('returns empty suggestions when no data exists', () => {
    const dir = mkFixture('empty');
    try {
      const result = analyzeSuggestions(dir);
      expect(result.totalEvents).toBe(0);
      expect(result.suggestedRules).toEqual([]);
      expect(result.suggestedSuppressions).toEqual([]);
      expect(result.suggestedPriorities).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('suggests rules for always-accepted checks', () => {
    const dir = mkFixture('accepted');
    try {
      recordPattern(dir, 'claudeMd', 'accepted');
      recordPattern(dir, 'claudeMd', 'accepted');
      recordPattern(dir, 'claudeMd', 'accepted');
      recordPattern(dir, 'denyRules', 'accepted');
      recordPattern(dir, 'denyRules', 'accepted');

      const result = analyzeSuggestions(dir);
      expect(result.suggestedRules.length).toBe(2);
      expect(result.suggestedRules[0].key).toBe('claudeMd');
      expect(result.suggestedRules[0].accepted).toBe(3);
      expect(result.suggestedRules[1].key).toBe('denyRules');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('suggests suppressions for always-rejected checks', () => {
    const dir = mkFixture('rejected');
    try {
      recordPattern(dir, 'mermaidDiagram', 'rejected');
      recordPattern(dir, 'mermaidDiagram', 'rejected');
      recordPattern(dir, 'mermaidDiagram', 'rejected');

      const result = analyzeSuggestions(dir);
      expect(result.suggestedSuppressions.length).toBe(1);
      expect(result.suggestedSuppressions[0].key).toBe('mermaidDiagram');
      expect(result.suggestedSuppressions[0].rejected).toBe(3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not suggest suppression for mixed accept/reject', () => {
    const dir = mkFixture('mixed');
    try {
      recordPattern(dir, 'claudeMd', 'accepted');
      recordPattern(dir, 'claudeMd', 'rejected');
      recordPattern(dir, 'claudeMd', 'rejected');
      recordPattern(dir, 'claudeMd', 'rejected');

      const result = analyzeSuggestions(dir);
      expect(result.suggestedRules).toEqual([]);
      expect(result.suggestedSuppressions).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('does not suggest rule when below minimum events', () => {
    const dir = mkFixture('low');
    try {
      recordPattern(dir, 'claudeMd', 'accepted'); // only 1

      const result = analyzeSuggestions(dir);
      expect(result.suggestedRules).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('formatSuggestions shows no-data message when empty', () => {
    const output = formatSuggestions({
      totalEvents: 0,
      auditCount: 0,
      suggestedRules: [],
      suggestedSuppressions: [],
      suggestedPriorities: [],
      bootstrap: {
        ready: false,
        state: 'empty',
        message: 'No local usage or snapshot history exists yet.',
        steps: [
          'Run `nerviq audit --snapshot` to save the baseline.',
          'Use `nerviq fix`, `nerviq fix --all-critical`, or `nerviq feedback` to record recommendation outcomes.',
          'Run `nerviq audit --snapshot` again after a meaningful repo change.',
          'Re-run `nerviq suggest-rules`.',
        ],
      },
    });
    expect(output).toContain('No local usage or snapshot history exists yet.');
    expect(output).toContain('Bootstrap it with:');
  });

  test('formatSuggestions renders all sections', () => {
    const output = formatSuggestions({
      totalEvents: 15,
      auditCount: 5,
      suggestedRules: [{ key: 'claudeMd', accepted: 5, total: 5 }],
      suggestedSuppressions: [{ key: 'mermaidDiagram', rejected: 3, total: 3 }],
      suggestedPriorities: [{ key: 'verifyCommands', failCount: 4, auditCount: 5 }],
    });
    expect(output).toContain('Auto-Suggested Rules');
    expect(output).toContain('15 pattern events');
    expect(output).toContain('5 audit snapshots');
    expect(output).toContain('+ claudeMd');
    expect(output).toContain('accepted 5/5');
    expect(output).toContain('- mermaidDiagram');
    expect(output).toContain('rejected 3/3');
    expect(output).toContain('! verifyCommands');
    expect(output).toContain('failed in 4/5');
  });

  test('formatSuggestions shows no-patterns message when data exists but no suggestions', () => {
    const output = formatSuggestions({
      totalEvents: 3,
      auditCount: 1,
      suggestedRules: [],
      suggestedSuppressions: [],
      suggestedPriorities: [],
      bootstrap: {
        ready: false,
        state: 'warming-up',
        message: 'Nerviq has some local history (3 pattern events, 1 audit snapshots), but not enough repeated signals yet.',
        steps: [
          'Keep saving snapshots with `nerviq audit --snapshot`.',
          'Keep recording outcomes with `nerviq fix` or `nerviq feedback`.',
          'Re-run `nerviq suggest-rules` after another change cycle.',
        ],
      },
    });
    expect(output).toContain('not enough repeated signals yet');
    expect(output).toContain('Bootstrap it with:');
  });
});
