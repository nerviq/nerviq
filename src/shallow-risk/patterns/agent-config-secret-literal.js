'use strict';

const { SHALLOW_RISK_DOC_URL, getAgentConfigEntries } = require('../shared');

// Every shape here is prefix-anchored, so precision stays high. EXPO-01
// (2026-07-29) added the model-provider keys: an agent config is precisely
// where an LLM API key gets pasted (`.mcp.json` env blocks, settings.json
// `env`), and the original four shapes could not see any of them.
const SECRET_PATTERNS = [
  { label: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'Stripe live key', pattern: /\bsk_live_[A-Za-z0-9]{24,}\b/g },
  { label: 'GitHub personal access token', pattern: /\bghp_[A-Za-z0-9]{36}\b/g },
  { label: 'GitHub fine-grained token', pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { label: 'GitHub OAuth/app token', pattern: /\bgh[ousr]_[A-Za-z0-9]{36}\b/g },
  { label: 'Anthropic API key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'OpenAI project key', pattern: /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'OpenAI legacy key', pattern: /\bsk-[A-Za-z0-9]{48}\b/g },
  { label: 'Google API key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: 'Slack token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { label: 'Hugging Face token', pattern: /\bhf_[A-Za-z0-9]{34}\b/g },
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
  // POS-01a: machine-readable OWASP cross-walk tags. See
  // research/pos-01-owasp-vocabulary-mapping-2026-04-28.md.
  owaspTags: ['agentic-top-10:insecure-agent-instructions', 'mcp-top-10:credential-leak'],
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
