/**
 * CSV Formatter (RFC 4180)
 *
 * One row per check in a nerviq audit result.
 * Columns: key,id,name,category,rating,severity,passed,file,line,sourceUrl,fix
 *
 * Quoting rules (RFC 4180):
 *   - Fields containing comma, double-quote, CR, or LF are wrapped in
 *     double-quotes.
 *   - Internal double-quotes are escaped by doubling them.
 *   - Header row is emitted first.
 *   - No UTF-8 BOM (some consumers mishandle it).
 *   - Line separator: LF (consumers accept LF; JUnit/XLSX/csv parsers
 *     normalize both).
 */

'use strict';

const COLUMNS = [
  'key',
  'id',
  'name',
  'category',
  'rating',
  'severity',
  'passed',
  'file',
  'line',
  'sourceUrl',
  'fix',
];

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowFor(r) {
  const severity = r.severity || r.impact || '';
  const cells = [
    r.key ?? '',
    r.id ?? '',
    r.name ?? '',
    r.category ?? '',
    r.rating ?? '',
    severity,
    r.passed === null || r.passed === undefined ? '' : String(r.passed),
    r.file ?? '',
    r.line ?? '',
    r.sourceUrl ?? '',
    r.fix ?? '',
  ];
  return cells.map(csvEscape).join(',');
}

function formatCsv(auditResult) {
  const results = Array.isArray(auditResult.results) ? auditResult.results : [];
  const lines = [COLUMNS.join(',')];
  for (const r of results) {
    lines.push(rowFor(r));
  }
  return lines.join('\n');
}

module.exports = { formatCsv, CSV_COLUMNS: COLUMNS };
