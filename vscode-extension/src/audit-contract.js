'use strict';

function normalizeAuditData(auditData) {
  const source = auditData && typeof auditData === 'object' ? auditData : {};
  const passed = typeof source.passed === 'number' ? source.passed : 0;
  const failed = typeof source.failed === 'number' ? source.failed : 0;
  const skipped = typeof source.skipped === 'number' ? source.skipped : 0;
  const checkCount = typeof source.checkCount === 'number'
    ? source.checkCount
    : typeof source.total === 'number'
      ? source.total
      : passed + failed + skipped;

  return {
    ...source,
    score: typeof source.score === 'number' ? source.score : null,
    passed,
    failed,
    skipped,
    checkCount,
    results: Array.isArray(source.results) ? source.results : [],
    topNextActions: Array.isArray(source.topNextActions) ? source.topNextActions : [],
    suggestedNextCommand: source.suggestedNextCommand || null,
  };
}

function getAuditUrgencySummary(auditData) {
  const data = normalizeAuditData(auditData);
  const criticalCount = data.results.filter((item) => item.passed === false && item.impact === 'critical').length;
  const highCount = data.results.filter((item) => item.passed === false && item.impact === 'high').length;

  return {
    score: data.score,
    passed: data.passed,
    failed: data.failed,
    checkCount: data.checkCount,
    criticalCount,
    highCount,
    topAction: data.topNextActions[0] || null,
  };
}

function getAuditGrade(score) {
  if (typeof score !== 'number') return 'D';
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

module.exports = {
  normalizeAuditData,
  getAuditUrgencySummary,
  getAuditGrade,
};
