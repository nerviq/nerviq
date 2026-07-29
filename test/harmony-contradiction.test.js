/**
 * HARM-01 — cross-platform contradiction detection.
 *
 * Harmony's original instruction check answered "is this topic present in
 * every platform doc?". It could not answer the question that actually
 * changes agent behaviour: "do two platform docs give OPPOSITE orders?".
 * These tests pin the four contradiction probes and their ambiguity guards.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCanonicalModel } = require('../src/harmony/canon');
const { detectInstructionContradiction } = require('../src/harmony/drift');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-harm-${name}-`));
}

function withDocs(name, docs, assert) {
  const dir = mkFixture(name);
  try {
    for (const [rel, content] of Object.entries(docs)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
    }
    assert(detectInstructionContradiction(buildCanonicalModel(dir)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('HARM-01 instruction contradictions', () => {
  test('flags a package-manager contradiction as critical', () => {
    withDocs('pm', {
      'CLAUDE.md': 'Install with `pnpm install`. Run `pnpm test` and `pnpm run build`.\n',
      'AGENTS.md': 'Install with `npm install`. Run `npm test` and `npm run build`.\n',
    }, (drifts) => {
      const found = drifts.filter((d) => /Package manager contradiction/.test(d.description));
      expect(found).toHaveLength(1);
      expect(found[0].severity).toBe('critical');
      expect(found[0].type).toBe('instruction-contradiction');
    });
  });

  test('does not flag a doc that merely lists alternative managers', () => {
    withDocs('pm-alternatives', {
      'CLAUDE.md': 'Use `npm install` (or `pnpm install` if you prefer).\n',
      'AGENTS.md': 'Use `npm install` (or `pnpm install` if you prefer).\n',
    }, (drifts) => {
      expect(drifts.filter((d) => /Package manager/.test(d.description))).toEqual([]);
    });
  });

  test('flags disagreeing framework versions between platforms', () => {
    withDocs('version', {
      'CLAUDE.md': 'This is a Next.js 15 app.\n',
      'AGENTS.md': 'This is a Next.js 16 app.\n',
    }, (drifts) => {
      const found = drifts.filter((d) => /Next\.js version contradiction/.test(d.description));
      expect(found).toHaveLength(1);
      expect(found[0].severity).toBe('high');
    });
  });

  test('treats a migration note (two versions in one doc) as not a pin', () => {
    withDocs('version-migration', {
      'CLAUDE.md': 'We moved from Next.js 15 to Next.js 16 last month.\n',
      'AGENTS.md': 'This is a Next.js 16 app.\n',
    }, (drifts) => {
      expect(drifts.filter((d) => /version contradiction/.test(d.description))).toEqual([]);
    });
  });

  test('flags opposite policies on committing to the default branch', () => {
    withDocs('polarity', {
      'CLAUDE.md': 'NEVER commit directly to main — always open a PR.\n',
      'AGENTS.md': 'Always commit to main for hotfixes.\n',
    }, (drifts) => {
      const found = drifts.filter((d) => /Opposite instructions/.test(d.description));
      expect(found).toHaveLength(1);
      expect(found[0].severity).toBe('critical');
      expect(found[0].description).toContain('claude forbids it');
    });
  });

  test('agreeing policies are not a contradiction', () => {
    withDocs('polarity-agree', {
      'CLAUDE.md': 'Never commit directly to main.\n',
      'AGENTS.md': 'Do not commit to main; open a pull request.\n',
    }, (drifts) => {
      expect(drifts.filter((d) => /Opposite instructions/.test(d.description))).toEqual([]);
    });
  });

  test('flags a response-language contradiction', () => {
    withDocs('language', {
      'CLAUDE.md': 'Respond to the user in Hebrew.\n',
      'AGENTS.md': 'Communicate with the user in English.\n',
    }, (drifts) => {
      const found = drifts.filter((d) => /Response-language contradiction/.test(d.description));
      expect(found).toHaveLength(1);
      expect(found[0].severity).toBe('medium');
    });
  });

  test('a passing mention of a language is not a directive', () => {
    withDocs('language-mention', {
      'CLAUDE.md': 'Respond in English.\nThe i18n bundle also ships Hebrew and French strings.\n',
      'AGENTS.md': 'Respond in English.\n',
    }, (drifts) => {
      expect(drifts.filter((d) => /Response-language/.test(d.description))).toEqual([]);
    });
  });

  test('a single configured platform can never contradict anyone', () => {
    withDocs('single', {
      'CLAUDE.md': 'Install with `pnpm install`. This is a Next.js 15 app.\n',
    }, (drifts) => {
      expect(drifts).toEqual([]);
    });
  });
});
