'use strict';

const {
  SHALLOW_RISK_DOC_URL,
  collectStackClaims,
} = require('../shared');

module.exports = {
  key: 'agent-config-cross-platform-drift',
  name: 'Cross-platform stack drift detected',
  severity: 'high',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  owaspTags: ['agentic-top-10:cross-agent-inconsistency'],
  run(ctx) {
    const claims = collectStackClaims(ctx).filter((claim) => claim.platform !== 'agent');
    if (claims.length < 2) return [];

    const byPlatform = new Map();
    for (const claim of claims) {
      const bucket = byPlatform.get(claim.platform) || [];
      bucket.push(claim);
      byPlatform.set(claim.platform, bucket);
    }

    const representatives = [];
    for (const bucket of byPlatform.values()) {
      const uniqueKeys = [...new Set(bucket.map((claim) => claim.key))];
      if (uniqueKeys.length !== 1) continue;
      representatives.push(bucket[0]);
    }

    representatives.sort((left, right) => left.file.localeCompare(right.file));

    for (let index = 0; index < representatives.length; index++) {
      for (let inner = index + 1; inner < representatives.length; inner++) {
        const first = representatives[index];
        const second = representatives[inner];
        if (first.key === second.key) continue;

        return [{
          file: first.file,
          line: first.line,
          fix: `Drift detected: ${first.file} declares "${first.label}" while ${second.file} declares "${second.label}". Align the shared primary-language guidance or document an intentional platform-specific override.`,
        }];
      }
    }

    return [];
  },
};
