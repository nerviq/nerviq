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

const PLATFORM_URL_RULES = {
  claude: [/^https:\/\/code\.claude\.com\/docs\/en\//],
  codex: [/^https:\/\/developers\.openai\.com\/codex\//],
  gemini: [/^https:\/\/geminicli\.com\/docs\//],
  copilot: [/^https:\/\/docs\.github\.com\/en\/copilot/],
  cursor: [/^https:\/\/docs\.cursor\.com\//],
  windsurf: [/^https:\/\/docs\.windsurf\.com\//, /^https:\/\/docs\.codeium\.com\//],
  aider: [/^https:\/\/aider\.chat\/docs\//],
  opencode: [/^https:\/\/github\.com\/sst\/opencode/],
};

describe('Official source URLs and confidence', () => {
  test('all 2441 checks across 8 platforms expose sourceUrl, confidence, and lastVerified', () => {
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

    expect(total).toBe(2441);
  });
});
