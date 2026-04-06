const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadPatterns, recordPattern, getPriorityAdjustment, getUsageSummary, formatUsageSummary } = require('../src/usage-patterns');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-patterns-${name}-`));
}

describe('Usage patterns', () => {
  test('loadPatterns returns empty object when no file exists', () => {
    const dir = mkFixture('empty');
    try {
      expect(loadPatterns(dir)).toEqual({});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('recordPattern creates and updates pattern entries', () => {
    const dir = mkFixture('record');
    try {
      recordPattern(dir, 'claudeMd', 'accepted');
      recordPattern(dir, 'claudeMd', 'accepted');
      recordPattern(dir, 'claudeMd', 'rejected');
      recordPattern(dir, 'denyRules', 'accepted');

      const patterns = loadPatterns(dir);
      expect(patterns.claudeMd.accepted).toBe(2);
      expect(patterns.claudeMd.rejected).toBe(1);
      expect(patterns.claudeMd.lastAction).toBe('rejected');
      expect(patterns.denyRules.accepted).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('recordPattern ignores invalid actions', () => {
    const dir = mkFixture('invalid');
    try {
      recordPattern(dir, 'claudeMd', 'invalid');
      expect(loadPatterns(dir)).toEqual({});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('getPriorityAdjustment returns boost when all accepted', () => {
    const dir = mkFixture('boost');
    try {
      recordPattern(dir, 'claudeMd', 'accepted');
      recordPattern(dir, 'claudeMd', 'accepted');
      expect(getPriorityAdjustment(dir, 'claudeMd')).toBe('boost');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('getPriorityAdjustment returns suppress when rejected 3+ times with no accepts', () => {
    const dir = mkFixture('suppress');
    try {
      recordPattern(dir, 'mermaidDiagram', 'rejected');
      recordPattern(dir, 'mermaidDiagram', 'rejected');
      expect(getPriorityAdjustment(dir, 'mermaidDiagram')).toBe(null); // only 2
      recordPattern(dir, 'mermaidDiagram', 'rejected');
      expect(getPriorityAdjustment(dir, 'mermaidDiagram')).toBe('suppress');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('getPriorityAdjustment returns null for unknown keys', () => {
    const dir = mkFixture('unknown');
    try {
      expect(getPriorityAdjustment(dir, 'nonexistent')).toBe(null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('getPriorityAdjustment returns null for mixed accept/reject', () => {
    const dir = mkFixture('mixed');
    try {
      recordPattern(dir, 'claudeMd', 'accepted');
      recordPattern(dir, 'claudeMd', 'rejected');
      recordPattern(dir, 'claudeMd', 'rejected');
      recordPattern(dir, 'claudeMd', 'rejected');
      expect(getPriorityAdjustment(dir, 'claudeMd')).toBe(null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('getUsageSummary aggregates events correctly', () => {
    const dir = mkFixture('summary');
    try {
      recordPattern(dir, 'claudeMd', 'accepted');
      recordPattern(dir, 'claudeMd', 'accepted');
      recordPattern(dir, 'denyRules', 'rejected');
      recordPattern(dir, 'denyRules', 'skipped');

      const summary = getUsageSummary(dir);
      expect(summary.totalEvents).toBe(4);
      expect(summary.topAccepted.length).toBe(1);
      expect(summary.topAccepted[0].key).toBe('claudeMd');
      expect(summary.topAccepted[0].rate).toBe(1);
      expect(summary.topRejected.length).toBe(1);
      expect(summary.topRejected[0].key).toBe('denyRules');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('formatUsageSummary returns message when no patterns exist', () => {
    const dir = mkFixture('format-empty');
    try {
      const output = formatUsageSummary(dir);
      expect(output).toContain('No usage patterns recorded');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('formatUsageSummary includes consider suppressing hint', () => {
    const dir = mkFixture('format-suppress');
    try {
      recordPattern(dir, 'mermaidDiagram', 'rejected');
      recordPattern(dir, 'mermaidDiagram', 'rejected');
      recordPattern(dir, 'mermaidDiagram', 'rejected');

      const output = formatUsageSummary(dir);
      expect(output).toContain('Usage Patterns (3 events recorded)');
      expect(output).toContain('mermaidDiagram');
      expect(output).toContain('consider suppressing');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
