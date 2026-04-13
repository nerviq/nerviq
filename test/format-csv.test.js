const { formatCsv, CSV_COLUMNS } = require('../src/formatters/csv');

function buildResult() {
  return {
    results: [
      {
        key: 'permissionDeny',
        id: 'PERM-001',
        name: 'Comma, inside, name',
        category: 'permissions',
        rating: 5,
        impact: 'critical',
        passed: false,
        file: '.claude/settings.json',
        line: 12,
        sourceUrl: 'https://nerviq.net/c/permissionDeny',
        fix: 'Add deny entry',
      },
      {
        key: 'hooksPresent',
        id: 'HOOKS-001',
        name: 'Enable pre-tool hooks',
        category: 'hooks',
        rating: 4,
        impact: 'high',
        passed: false,
        fix: 'He said "do it" then restart',
      },
      {
        key: 'claudeMdExists',
        id: 'CLAUDEMD-001',
        name: 'CLAUDE.md exists',
        category: 'instruction-surfaces',
        rating: 5,
        impact: 'high',
        passed: true,
        fix: 'line1\nline2',
      },
    ],
  };
}

describe('formatCsv', () => {
  const csv = formatCsv(buildResult());
  const physicalLines = csv.split('\n');
  // A CSV field may legitimately contain an embedded newline (RFC 4180 § 2.6),
  // so "logical rows" are delimited by record-terminating newlines outside
  // any quoted field. For this fixture: header + 3 records = 4 logical rows.

  test('first physical line is the header row', () => {
    expect(physicalLines[0]).toBe(CSV_COLUMNS.join(','));
  });

  test('quotes fields containing commas', () => {
    expect(csv).toMatch(/"Comma, inside, name"/);
  });

  test('escapes internal double quotes by doubling them', () => {
    expect(csv).toMatch(/"He said ""do it"" then restart"/);
  });

  test('fields with newlines are quoted (embedded newline preserved inside quotes)', () => {
    // Embedded \n inside a quoted field is valid RFC 4180. Ensure it is quoted.
    expect(csv).toMatch(/"line1\nline2"/);
    // And no raw newlines leak outside quoted regions by verifying that every
    // physical line either starts a new quoted region or belongs to the
    // continuation of one. Simple heuristic: total quote count is even.
    const quoteCount = (csv.match(/"/g) || []).length;
    expect(quoteCount % 2).toBe(0);
  });

  test('does not emit a UTF-8 BOM', () => {
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });

  test('header row has the correct column count', () => {
    expect(physicalLines[0].split(',').length).toBe(CSV_COLUMNS.length);
  });

  test('includes projectedScoreDelta and projectedScoreAfter columns (CTO-05)', () => {
    expect(CSV_COLUMNS).toContain('projectedScoreDelta');
    expect(CSV_COLUMNS).toContain('projectedScoreAfter');
  });

  test('populates projection columns for rows listed in topNextActions (CTO-05)', () => {
    const r = buildResult();
    r.topNextActions = [
      { key: 'permissionDeny', projectedScoreDelta: 15, projectedScoreAfter: 85 },
    ];
    const out = formatCsv(r);
    expect(out).toMatch(/,15,85$/m);
  });
});
