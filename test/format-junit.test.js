const { formatJUnit } = require('../src/formatters/junit');

function buildResult() {
  return {
    version: '1.22.0',
    timestamp: '2026-04-14T00:00:00.000Z',
    platform: 'claude',
    platformLabel: 'Claude Code',
    results: [
      {
        key: 'permissionDeny',
        id: 'PERM-001',
        name: 'Permission denylist <missing>',
        category: 'permissions',
        rating: 5,
        impact: 'critical',
        passed: false,
        file: '.claude/settings.json',
        line: 12,
        fix: 'Add deny entry for "shell.exec" & run',
      },
      {
        key: 'hooksPresent',
        id: 'HOOKS-001',
        name: 'Enable pre-tool hooks',
        category: 'hooks',
        rating: 4,
        impact: 'high',
        passed: false,
        fix: 'Create hook file',
      },
      {
        key: 'claudeMdExists',
        id: 'CLAUDEMD-001',
        name: 'CLAUDE.md exists',
        category: 'instruction-surfaces',
        rating: 5,
        impact: 'high',
        passed: true,
      },
    ],
  };
}

describe('formatJUnit', () => {
  const xml = formatJUnit(buildResult());

  test('starts with XML declaration', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  test('root element is <testsuites> with correct failures count', () => {
    expect(xml).toMatch(/<testsuites [^>]*tests="3"[^>]*failures="2"/);
  });

  test('has at least one <testsuite>', () => {
    expect(xml).toMatch(/<testsuite /);
  });

  test('emits a <failure> with a non-empty message for each failed check', () => {
    const failures = xml.match(/<failure message="[^"]+" type="[^"]+">/g) || [];
    expect(failures.length).toBe(2);
    for (const f of failures) {
      expect(f).not.toMatch(/message=""/);
    }
  });

  test('properly escapes XML special characters', () => {
    // < > " & should all be escaped inside attribute values / text.
    expect(xml).toMatch(/&lt;missing&gt;/);
    expect(xml).toMatch(/&quot;shell\.exec&quot;/);
    expect(xml).toMatch(/&amp;/);
  });

  test('has one testcase per check', () => {
    const cases = xml.match(/<testcase /g) || [];
    expect(cases.length).toBe(3);
  });

  test('appends snippet to failure body when present (CTO-04)', () => {
    const { formatJUnit } = require('../src/formatters/junit');
    const base = {
      platform: 'claude',
      results: [
        {
          key: 'k1', id: 'K1', name: 'Check 1', category: 'memory',
          impact: 'high', passed: false, file: 'CLAUDE.md', line: 3,
          fix: 'fix it', snippet: 'alpha\nbeta',
        },
      ],
    };
    const out = formatJUnit(base);
    expect(out).toContain('alpha');
    expect(out).toContain('---');
  });
});
