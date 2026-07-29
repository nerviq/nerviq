// Canonical check count from release-metadata.json (see test/server.test.js note).
const { checks: CANONICAL_CHECK_COUNT } = require('../release-metadata.json');
const { TECHNIQUES } = require('../src/techniques');
const { CODEX_TECHNIQUES } = require('../src/codex/techniques');
const { GEMINI_TECHNIQUES } = require('../src/gemini/techniques');
const { COPILOT_TECHNIQUES } = require('../src/copilot/techniques');
const { CURSOR_TECHNIQUES } = require('../src/cursor/techniques');
const { WINDSURF_TECHNIQUES } = require('../src/windsurf/techniques');
const { AIDER_TECHNIQUES } = require('../src/aider/techniques');
const { OPENCODE_TECHNIQUES } = require('../src/opencode/techniques');

const PLATFORM_TECHNIQUES = {
  claude: TECHNIQUES,
  codex: CODEX_TECHNIQUES,
  gemini: GEMINI_TECHNIQUES,
  copilot: COPILOT_TECHNIQUES,
  cursor: CURSOR_TECHNIQUES,
  windsurf: WINDSURF_TECHNIQUES,
  aider: AIDER_TECHNIQUES,
  opencode: OPENCODE_TECHNIQUES,
};

// FRESH-2026-07-29: two vendors moved their documentation host entirely and a
// third moved GitHub org. Verified live during the freshness pass — every old
// host 308/301-redirects to the new one. Legacy patterns are kept so a
// deliberate rollback to an archived URL still passes review rather than
// failing the whole suite.
const PLATFORM_URL_RULES = {
  claude: [/^https:\/\/code\.claude\.com\/docs\/en\//],
  // developers.openai.com/codex/* -> learn.chatgpt.com/docs/*
  codex: [/^https:\/\/learn\.chatgpt\.com\/docs\//, /^https:\/\/developers\.openai\.com\/codex\//],
  gemini: [/^https:\/\/geminicli\.com\/docs\//],
  copilot: [/^https:\/\/docs\.github\.com\/en\/copilot/],
  // cursor.com/docs/ 308-redirects to cursor.com/docs — the canonical form has
  // no trailing slash, so the rule must accept both.
  cursor: [/^https:\/\/cursor\.com\/docs(\/|$)/],
  // docs.windsurf.com -> docs.devin.ai (Windsurf folded into Devin Desktop)
  windsurf: [/^https:\/\/docs\.devin\.ai\//, /^https:\/\/docs\.windsurf\.com\//, /^https:\/\/docs\.codeium\.com\//],
  aider: [/^https:\/\/aider\.chat\/docs\//],
  // github.com/sst/opencode -> github.com/anomalyco/opencode
  opencode: [/^https:\/\/github\.com\/anomalyco\/opencode/, /^https:\/\/github\.com\/sst\/opencode/],
};

function findCategoryUrl(techniques, category) {
  const match = Object.values(techniques).find((technique) => technique.category === category);
  expect(match).toBeTruthy();
  return match.sourceUrl;
}

describe('Official source URLs and confidence', () => {
  test('all canonical checks across 8 platforms expose sourceUrl, confidence, and lastVerified', () => {
    let total = 0;

    for (const [platform, techniques] of Object.entries(PLATFORM_TECHNIQUES)) {
      for (const [key, technique] of Object.entries(techniques)) {
        total += 1;
        expect(technique.sourceUrl).toBeTruthy();
        expect(
          PLATFORM_URL_RULES[platform].some((pattern) => pattern.test(technique.sourceUrl))
        ).toBe(true);
        expect(technique.confidence).toBeTruthy();
        expect([0.3, 0.6, 0.7, 0.8, 0.9]).toContain(technique.confidence);
        expect(technique.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }

    expect(total).toBe(CANONICAL_CHECK_COUNT);
  });

  test('high-volume categories point to more specific platform docs instead of generic roots', () => {
    expect(findCategoryUrl(TECHNIQUES, 'python')).toBe('https://code.claude.com/docs/en/best-practices');
    expect(findCategoryUrl(CODEX_TECHNIQUES, 'python')).toBe('https://learn.chatgpt.com/docs/agent-configuration/rules');
    expect(findCategoryUrl(GEMINI_TECHNIQUES, 'python')).toBe('https://geminicli.com/docs/cli/gemini-md/');
    expect(findCategoryUrl(COPILOT_TECHNIQUES, 'python')).toBe('https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent');
    expect(findCategoryUrl(CURSOR_TECHNIQUES, 'python')).toBe('https://cursor.com/docs/rules');
    expect(findCategoryUrl(WINDSURF_TECHNIQUES, 'python')).toBe('https://docs.devin.ai/desktop/cascade/workflows');
    expect(findCategoryUrl(AIDER_TECHNIQUES, 'python')).toBe('https://aider.chat/docs/usage/conventions.html');
    expect(findCategoryUrl(OPENCODE_TECHNIQUES, 'python')).toBe('https://github.com/anomalyco/opencode/blob/dev/AGENTS.md');
  });
});
