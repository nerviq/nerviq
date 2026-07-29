'use strict';

const { AIDER_P0_SOURCES, SHALLOW_RISK_DOC_URL, hasLegacyAiderPin } = require('../shared');

// Every entry below was re-read from the vendor's own configuration reference
// during the 2026-07-29 freshness pass. Adding a key here without that step is
// how a governance tool starts shipping folklore.
const DEPRECATED_AIDER_KEYS = [
  {
    key: 'auto-commit',
    replacement: 'auto-commits',
    pattern: /^\s*auto-commit\s*:/i,
    note: 'removed in Aider 0.60+',
  },
  {
    key: 'openai-api-type',
    replacement: '--set-env / the matching environment variable',
    pattern: /^\s*openai-api-type\s*:/i,
    note: 'deprecated in the Aider config reference, verified 2026-07-29',
  },
  {
    key: 'openai-api-version',
    replacement: '--set-env / the matching environment variable',
    pattern: /^\s*openai-api-version\s*:/i,
    note: 'deprecated in the Aider config reference, verified 2026-07-29',
  },
  {
    key: 'openai-api-deployment-id',
    replacement: '--set-env / the matching environment variable',
    pattern: /^\s*openai-api-deployment-id\s*:/i,
    note: 'deprecated in the Aider config reference, verified 2026-07-29',
  },
  {
    key: 'openai-organization-id',
    replacement: '--set-env / the matching environment variable',
    pattern: /^\s*openai-organization-id\s*:/i,
    note: 'deprecated in the Aider config reference, verified 2026-07-29',
  },
];

// FRESH-2026-07-29: Codex config reference (learn.chatgpt.com, migrated from
// developers.openai.com) marks these superseded.
const DEPRECATED_CODEX_KEYS = [
  {
    key: 'features.web_search',
    replacement: 'the top-level `web_search` key',
    pattern: /^\s*web_search\s*=/i,
    section: 'features',
    note: 'superseded by top-level `web_search`, verified 2026-07-29',
  },
  {
    key: 'agents.max_threads',
    replacement: '`agents.max_concurrent_threads_per_session`',
    pattern: /^\s*max_threads\s*=/i,
    section: 'agents',
    note: 'renamed to `max_concurrent_threads_per_session`, verified 2026-07-29',
  },
];

// FRESH-2026-07-29: OpenCode moved presentation settings out of opencode.json
// into tui.json. The old keys are auto-migrated, so nothing breaks loudly —
// which is exactly why an agent doc that still teaches them goes unnoticed.
const DEPRECATED_OPENCODE_KEYS = [
  { key: 'theme', pattern: /^\s*"theme"\s*:/ },
  { key: 'keybinds', pattern: /^\s*"keybinds"\s*:/ },
  { key: 'tui', pattern: /^\s*"tui"\s*:/ },
];

function findLine(lines, pattern) {
  return lines.findIndex((line) => pattern.test(line));
}

// Minimal TOML section tracker: returns the [section] a line sits under.
function sectionAt(lines, index) {
  for (let i = index; i >= 0; i--) {
    const m = lines[i].match(/^\s*\[([^\]]+)\]/);
    if (m) return m[1].trim();
  }
  return null;
}

function runAider(ctx, findings) {
  if (!Array.isArray(AIDER_P0_SOURCES) || AIDER_P0_SOURCES.length < 2) return;

  const file = ctx.fileContent('.aider.conf.yml') !== null ? '.aider.conf.yml'
    : (ctx.fileContent('.aider.conf.yaml') !== null ? '.aider.conf.yaml' : null);
  if (!file || hasLegacyAiderPin(ctx)) return;

  const lines = (ctx.fileContent(file) || '').split(/\r?\n/);
  const sourceUrl = AIDER_P0_SOURCES.find((s) => s.key === 'aider-config-reference')?.url || SHALLOW_RISK_DOC_URL;

  for (const keyDef of DEPRECATED_AIDER_KEYS) {
    const lineIndex = findLine(lines, keyDef.pattern);
    if (lineIndex === -1) continue;
    findings.push({
      file,
      line: lineIndex + 1,
      fix: `${file} uses deprecated Aider key \`${keyDef.key}\` (${keyDef.note}). Replace it with \`${keyDef.replacement}\` or remove it if the repo intentionally stays on an older Aider release.`,
      sourceUrl,
    });
  }
}

function runCodex(ctx, findings) {
  const file = '.codex/config.toml';
  const content = ctx.fileContent(file);
  if (content === null) return;
  const lines = content.split(/\r?\n/);

  for (const keyDef of DEPRECATED_CODEX_KEYS) {
    for (let i = 0; i < lines.length; i++) {
      if (!keyDef.pattern.test(lines[i])) continue;
      if (sectionAt(lines, i) !== keyDef.section) continue;
      findings.push({
        file,
        line: i + 1,
        fix: `${file} uses deprecated Codex key \`${keyDef.key}\` (${keyDef.note}). Replace it with ${keyDef.replacement}.`,
        sourceUrl: 'https://learn.chatgpt.com/docs/config-file/config-reference',
      });
      break;
    }
  }
}

function runOpenCode(ctx, findings) {
  const file = ctx.fileContent('opencode.json') !== null ? 'opencode.json'
    : (ctx.fileContent('opencode.jsonc') !== null ? 'opencode.jsonc' : null);
  if (!file) return;
  const lines = (ctx.fileContent(file) || '').split(/\r?\n/);

  for (const keyDef of DEPRECATED_OPENCODE_KEYS) {
    const lineIndex = findLine(lines, keyDef.pattern);
    if (lineIndex === -1) continue;
    findings.push({
      file,
      line: lineIndex + 1,
      fix: `${file} still declares \`${keyDef.key}\`. OpenCode moved presentation settings to \`tui.json\` and auto-migrates this key, so it works today but is no longer the documented home — move it to \`tui.json\` (verified 2026-07-29).`,
      sourceUrl: 'https://opencode.ai/docs/config/',
    });
  }
}

module.exports = {
  key: 'agent-config-deprecated-keys',
  name: 'Agent config uses deprecated keys',
  severity: 'medium',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  owaspTags: ['agentic-top-10:insecure-agent-instructions'],
  run(ctx) {
    const findings = [];
    runAider(ctx, findings);
    runCodex(ctx, findings);
    runOpenCode(ctx, findings);
    return findings;
  },
};
