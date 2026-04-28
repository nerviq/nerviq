'use strict';

const {
  SHALLOW_RISK_DOC_URL,
  collectStackClaims,
  findFirstStackEvidence,
  getDetectedStackEvidence,
} = require('../shared');

module.exports = {
  key: 'agent-config-stack-contradiction',
  name: 'Agent config contradicts actual stack',
  severity: 'high',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  owaspTags: ['agentic-top-10:tool-instruction-integrity'],
  run(ctx) {
    const claims = collectStackClaims(ctx);
    const distinctClaims = [...new Set(claims.map((claim) => claim.key))];
    if (distinctClaims.length !== 1) return [];

    const declared = claims[0];
    const hasDeclaredEvidence = declared.stackKeys.some((stackKey) => Boolean(findFirstStackEvidence(ctx, stackKey)));
    if (hasDeclaredEvidence) return [];

    const actual = getDetectedStackEvidence(ctx).find((item) => !declared.stackKeys.includes(item.key));
    if (!actual) return [];

    return [{
      file: declared.file,
      line: declared.line,
      fix: `${declared.file} declares the primary stack as "${declared.label}", but the repo shows ${actual.label} signals (${actual.file}) and no ${declared.label} evidence. Align the agent guidance with the actual stack or document a real migration plan.`,
    }];
  },
};
