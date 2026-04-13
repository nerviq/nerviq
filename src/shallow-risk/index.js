'use strict';

const { buildFinding, SHALLOW_RISK_BANNER, SHALLOW_RISK_BANNER_LINES } = require('./shared');

const patterns = [
  require('./patterns/agent-config-missing-file'),
  require('./patterns/agent-config-stack-contradiction'),
  require('./patterns/agent-config-cross-platform-drift'),
  require('./patterns/mcp-server-no-allowlist'),
  require('./patterns/hook-script-missing'),
  require('./patterns/agent-config-secret-literal'),
  require('./patterns/agent-config-deprecated-keys'),
  require('./patterns/agent-config-dangerous-autoapprove'),
];

function runShallowRisk(ctx) {
  if (!ctx || process.env.NERVIQ_SHALLOW_RISK === 'off') {
    return [];
  }

  const findings = [];
  const seen = new Set();

  for (const pattern of patterns) {
    let emitted = [];
    try {
      const next = pattern.run(ctx);
      emitted = Array.isArray(next) ? next : [];
    } catch {
      emitted = [];
    }

    for (const finding of emitted) {
      const normalized = buildFinding(pattern, ctx, finding || {});
      const dedupeKey = [
        normalized.key,
        normalized.file || '',
        normalized.line || '',
        normalized.fix || '',
      ].join('|');

      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      findings.push(normalized);
    }
  }

  return findings;
}

module.exports = {
  patterns,
  runShallowRisk,
  SHALLOW_RISK_BANNER,
  SHALLOW_RISK_BANNER_LINES,
};
