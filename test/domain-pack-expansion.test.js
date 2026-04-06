const { PACK_BLUEPRINTS } = require('../src/domain-pack-expansion');
const { DOMAIN_PACKS } = require('../src/domain-packs');
const { CODEX_DOMAIN_PACKS } = require('../src/codex/domain-packs');
const { GEMINI_DOMAIN_PACKS } = require('../src/gemini/domain-packs');
const { COPILOT_DOMAIN_PACKS } = require('../src/copilot/domain-packs');
const { CURSOR_DOMAIN_PACKS } = require('../src/cursor/domain-packs');
const { WINDSURF_DOMAIN_PACKS } = require('../src/windsurf/domain-packs');
const { AIDER_DOMAIN_PACKS } = require('../src/aider/domain-packs');
const { OPENCODE_DOMAIN_PACKS } = require('../src/opencode/domain-packs');

const REGISTRIES = {
  claude: DOMAIN_PACKS,
  codex: CODEX_DOMAIN_PACKS,
  gemini: GEMINI_DOMAIN_PACKS,
  copilot: COPILOT_DOMAIN_PACKS,
  cursor: CURSOR_DOMAIN_PACKS,
  windsurf: WINDSURF_DOMAIN_PACKS,
  aider: AIDER_DOMAIN_PACKS,
  opencode: OPENCODE_DOMAIN_PACKS,
};

describe('Domain pack expansion', () => {
  test('requested expansion keys are available across all platform registries', () => {
    const expectedKeys = PACK_BLUEPRINTS.map((pack) => pack.key);

    for (const [platform, packs] of Object.entries(REGISTRIES)) {
      const keys = packs.map((pack) => pack.key);
      for (const key of expectedKeys) {
        expect(keys).toContain(key);
      }
      if (platform === 'aider') {
        expect(packs).toHaveLength(60);
      } else {
        expect(packs).toHaveLength(62);
      }
    }
  });
});
