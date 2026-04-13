'use strict';

const { SHALLOW_RISK_DOC_URL, getAgentConfigEntries } = require('../shared');

const SECRET_PATTERNS = [
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'Stripe live key', pattern: /\bsk_live_[A-Za-z0-9]{24,}\b/g },
  { label: 'GitHub personal access token', pattern: /\bghp_[A-Za-z0-9]{36}\b/g },
  { label: 'SSH private key header', pattern: /-----BEGIN (?:OPENSSH|RSA|DSA|EC) PRIVATE KEY-----/g },
];

function looksLikePlaceholder(line, matchText) {
  return /\b(example|sample|placeholder|replace[-_ ]?me|your[_-]?key|fake|dummy)\b/i.test(line) ||
    /\bEXAMPLE\b/.test(matchText);
}

module.exports = {
  key: 'agent-config-secret-literal',
  name: 'Agent config contains secret literal',
  severity: 'critical',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  run(ctx) {
    const findings = [];

    for (const entry of getAgentConfigEntries(ctx)) {
      const lines = entry.content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        for (const secret of SECRET_PATTERNS) {
          secret.pattern.lastIndex = 0;
          let match = secret.pattern.exec(line);
          while (match) {
            if (!looksLikePlaceholder(line, match[0])) {
              findings.push({
                file: entry.path,
                line: index + 1,
                fix: `${entry.path} contains a ${secret.label} shape. Rotate the secret, remove it from the agent config, and scrub it from git history if it was real.`,
              });
            }
            match = secret.pattern.exec(line);
          }
        }
      }
    }

    return findings;
  },
};
