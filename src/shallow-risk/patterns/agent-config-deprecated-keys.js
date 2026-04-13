'use strict';

const { AIDER_P0_SOURCES, SHALLOW_RISK_DOC_URL, hasLegacyAiderPin } = require('../shared');

const DEPRECATED_AIDER_KEYS = [
  {
    key: 'auto-commit',
    replacement: 'auto-commits',
    pattern: /^\s*auto-commit\s*:/i,
    note: 'removed in Aider 0.60+',
  },
];

module.exports = {
  key: 'agent-config-deprecated-keys',
  name: 'Agent config uses deprecated keys',
  severity: 'medium',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  run(ctx) {
    if (!Array.isArray(AIDER_P0_SOURCES) || AIDER_P0_SOURCES.length < 2) {
      return [];
    }

    const file = ctx.fileContent('.aider.conf.yml') !== null ? '.aider.conf.yml'
      : (ctx.fileContent('.aider.conf.yaml') !== null ? '.aider.conf.yaml' : null);
    if (!file || hasLegacyAiderPin(ctx)) return [];

    const findings = [];
    const content = ctx.fileContent(file) || '';
    const lines = content.split(/\r?\n/);

    for (const keyDef of DEPRECATED_AIDER_KEYS) {
      const lineIndex = lines.findIndex((line) => keyDef.pattern.test(line));
      if (lineIndex === -1) continue;
      findings.push({
        file,
        line: lineIndex + 1,
        fix: `${file} uses deprecated Aider key \`${keyDef.key}\` (${keyDef.note}). Replace it with \`${keyDef.replacement}\` or remove it if the repo intentionally stays on an older Aider release.`,
        sourceUrl: AIDER_P0_SOURCES.find((source) => source.key === 'aider-config-reference')?.url || SHALLOW_RISK_DOC_URL,
      });
    }

    return findings;
  },
};
