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

  test('CTO-08: includes layer column positioned between category and rating', () => {
    expect(CSV_COLUMNS).toContain('layer');
    const idxCategory = CSV_COLUMNS.indexOf('category');
    const idxLayer = CSV_COLUMNS.indexOf('layer');
    const idxRating = CSV_COLUMNS.indexOf('rating');
    expect(idxLayer).toBe(idxCategory + 1);
    expect(idxRating).toBe(idxLayer + 1);
  });

  test('CTO-08: layer values are populated in rows when present on the check', () => {
    const r = {
      results: [
        { key: 'k1', id: 'K1', name: 'n1', category: 'memory', layer: 'governance', rating: 5, impact: 'high', passed: true },
        { key: 'k2', id: 'K2', name: 'n2', category: 'git', layer: 'hygiene', rating: 4, impact: 'medium', passed: false },
      ],
    };
    const out = formatCsv(r);
    const lines = out.split('\n');
    expect(lines[1]).toContain(',memory,governance,');
    expect(lines[2]).toContain(',git,hygiene,');
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

  test('appends shallow-risk rows with layer=shallow-risk (CTO-06)', () => {
    const r = buildResult();
    r.shallowRiskHints = [
      {
        key: 'agent-config-secret-literal',
        id: '',
        name: 'Agent config contains secret literal',
        category: 'shallow-risk',
        layer: 'shallow-risk',
        severity: 'critical',
        passed: false,
        file: 'CLAUDE.md',
        line: 4,
        sourceUrl: 'https://example.com/shallow-risk',
        fix: 'Rotate the token.',
      },
    ];
    const out = formatCsv(r);
    expect(out).toMatch(/agent-config-secret-literal,,Agent config contains secret literal,shallow-risk,shallow-risk,,critical,false,CLAUDE\.md,4,/);
  });
});
