'use strict';

const { SHALLOW_RISK_DOC_URL, escapeRegExp } = require('../shared');

const DANGEROUS_ALLOW_PATTERNS = [
  /\brm\b[\s\S]{0,40}-r/i,
  /\bgit\s+push\s+--force\b/i,
  /\bdrop\s+(?:database|table)\b/i,
  /\btruncate\s+table\b/i,
  /\bdelete\s+from\b/i,
];

function isDangerousAllowRule(rule) {
  if (typeof rule !== 'string') return false;
  if (/\bdelete\s+from\b/i.test(rule)) {
    return !/\bwhere\b/i.test(rule) || /\bwhere\s*1\s*=\s*1\b/i.test(rule);
  }
  return DANGEROUS_ALLOW_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(rule);
  });
}

module.exports = {
  key: 'agent-config-dangerous-autoapprove',
  name: 'Agent config auto-approves destructive commands',
  severity: 'critical',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  owaspTags: ['agentic-top-10:insecure-agent-instructions', 'agentic-top-10:excessive-agency'],
  run(ctx) {
    const file = '.claude/settings.json';
    const config = ctx.jsonFile(file);
    const allowRules = config && config.permissions && Array.isArray(config.permissions.allow)
      ? config.permissions.allow
      : [];
    if (allowRules.length === 0) return [];

    return allowRules
      .filter(isDangerousAllowRule)
      .map((rule) => ({
        file,
        line: ctx.lineNumber(file, new RegExp(escapeRegExp(rule))) || 1,
        fix: `${file} pre-approves the destructive rule \`${rule}\`. Remove it from the allow-list so destructive commands always require explicit review.`,
      }));
  },
};
