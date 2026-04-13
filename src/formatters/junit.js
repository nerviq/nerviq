/**
 * JUnit XML Formatter
 *
 * Converts a nerviq audit result into Jenkins-compatible JUnit XML.
 * Schema: <testsuites><testsuite><testcase><failure/></testcase></testsuite></testsuites>
 *
 *   - One <testsuite> per check category.
 *   - Each check becomes a <testcase> (classname = category, name = key).
 *   - Failed checks emit a <failure message="..." type="..."/> where:
 *       - message = check.fix || check.name
 *       - type    = severity (check.severity || check.impact)
 *   - Skipped checks emit <skipped/>.
 *
 * Parses with any standard JUnit XML consumer (GitHub Actions test
 * reporter, Jenkins, GitLab CI, CircleCI).
 */

'use strict';

const { version: nerviqVersion } = require('../../package.json');

function escapeXml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function severityFor(r) {
  return r.severity || r.impact || 'medium';
}

function groupByCategory(results) {
  const map = new Map();
  for (const r of results) {
    const cat = r.category || 'uncategorized';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(r);
  }
  return map;
}

function formatJUnit(auditResult) {
  const allResults = Array.isArray(auditResult.results) ? auditResult.results : [];
  const shallowRiskHints = Array.isArray(auditResult.shallowRiskHints) ? auditResult.shallowRiskHints : [];
  const timestamp = auditResult.timestamp || new Date().toISOString();
  const platform = auditResult.platform || 'claude';

  const totalTests = allResults.length + shallowRiskHints.length;
  const totalFailures = allResults.filter((r) => r.passed === false).length + shallowRiskHints.length;
  const totalSkipped = allResults.filter((r) => r.passed === null || r.skipped === true).length;

  const byCategory = groupByCategory(allResults);

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites name="nerviq" tests="${totalTests}" failures="${totalFailures}" skipped="${totalSkipped}" time="0">`,
  );

  for (const [category, checks] of byCategory) {
    const suiteFailures = checks.filter((r) => r.passed === false).length;
    const suiteSkipped = checks.filter((r) => r.passed === null || r.skipped === true).length;
    lines.push(
      `  <testsuite name="${escapeXml(category)}" tests="${checks.length}" failures="${suiteFailures}" skipped="${suiteSkipped}" time="0" timestamp="${escapeXml(timestamp)}" package="nerviq.${escapeXml(platform)}">`,
    );

    for (const r of checks) {
      const classname = escapeXml(r.category || 'uncategorized');
      const name = escapeXml(r.key || r.id || r.name || 'unknown');
      // CTO-08: surface scope layer as a testcase attribute so JUnit
      // consumers (GitHub Actions, Jenkins, GitLab) can filter/group.
      const layerAttr = r.layer ? ` layer="${escapeXml(r.layer)}"` : '';
      if (r.passed === false) {
        const msg = escapeXml(r.fix || r.name || r.key || 'check failed');
        const type = escapeXml(severityFor(r));
        let body = `${r.name || ''}`;
        if (r.file) body += ` at ${r.file}${r.line ? ':' + r.line : ''}`;
        if (r.sourceUrl) body += ` (${r.sourceUrl})`;
        if (r.snippet) body += `\n---\n${r.snippet}`;
        lines.push(`    <testcase classname="${classname}" name="${name}"${layerAttr} time="0">`);
        lines.push(`      <failure message="${msg}" type="${type}">${escapeXml(body)}</failure>`);
        lines.push(`    </testcase>`);
      } else if (r.passed === null || r.skipped === true) {
        lines.push(`    <testcase classname="${classname}" name="${name}"${layerAttr} time="0">`);
        lines.push(`      <skipped/>`);
        lines.push(`    </testcase>`);
      } else {
        lines.push(`    <testcase classname="${classname}" name="${name}"${layerAttr} time="0"/>`);
      }
    }

    lines.push('  </testsuite>');
  }

  if (Array.isArray(auditResult.shallowRiskHints)) {
    lines.push(
      `  <testsuite name="shallow-risk" tests="${shallowRiskHints.length}" failures="${shallowRiskHints.length}" skipped="0" time="0" timestamp="${escapeXml(timestamp)}" package="nerviq.${escapeXml(platform)}.shallow-risk">`,
    );
    for (const hint of shallowRiskHints) {
      const name = escapeXml(hint.key || hint.name || 'shallow-risk');
      const msg = escapeXml(hint.fix || hint.name || hint.key || 'shallow risk hint');
      const type = escapeXml(severityFor(hint));
      let body = `${hint.name || hint.key || ''}`;
      if (hint.file) body += ` at ${hint.file}${hint.line ? ':' + hint.line : ''}`;
      if (hint.sourceUrl) body += ` (${hint.sourceUrl})`;
      if (hint.snippet) body += `\n---\n${hint.snippet}`;
      lines.push(`    <testcase classname="shallow-risk" name="${name}" layer="shallow-risk" time="0">`);
      lines.push(`      <failure message="${msg}" type="${type}">${escapeXml(body)}</failure>`);
      lines.push('    </testcase>');
    }
    lines.push('  </testsuite>');
  }

  lines.push('</testsuites>');
  lines.push(`<!-- nerviq v${escapeXml(auditResult.version || nerviqVersion)} -->`);
  return lines.join('\n');
}

module.exports = { formatJUnit };
