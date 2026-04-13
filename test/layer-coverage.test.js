/**
 * CTO-08 — layer coverage test.
 *
 * Asserts that every check in every technique bag carries a valid
 * `layer` tag. Also logs the layer distribution for visibility in CI.
 */

const { LAYERS, isValidLayer, assignLayers, summarizeLayers, LAYER_DEFINITIONS } = require('../src/audit/layers');
const { TECHNIQUES } = require('../src/techniques');
const { CODEX_TECHNIQUES } = require('../src/codex/techniques');
const { GEMINI_TECHNIQUES } = require('../src/gemini/techniques');
const { COPILOT_TECHNIQUES } = require('../src/copilot/techniques');
const { CURSOR_TECHNIQUES } = require('../src/cursor/techniques');
const { WINDSURF_TECHNIQUES } = require('../src/windsurf/techniques');
const { AIDER_TECHNIQUES } = require('../src/aider/techniques');
const { OPENCODE_TECHNIQUES } = require('../src/opencode/techniques');

const BAGS = {
  claude: TECHNIQUES,
  codex: CODEX_TECHNIQUES,
  gemini: GEMINI_TECHNIQUES,
  copilot: COPILOT_TECHNIQUES,
  cursor: CURSOR_TECHNIQUES,
  windsurf: WINDSURF_TECHNIQUES,
  aider: AIDER_TECHNIQUES,
  opencode: OPENCODE_TECHNIQUES,
};

describe('CTO-08 layer coverage', () => {
  test('LAYERS constants expose the 4 canonical layer values', () => {
    expect(LAYERS.GOVERNANCE).toBe('governance');
    expect(LAYERS.DRIFT).toBe('drift');
    expect(LAYERS.HYGIENE).toBe('hygiene');
    expect(LAYERS.SHALLOW_RISK).toBe('shallow-risk');
  });

  test('LAYER_DEFINITIONS provides a short definition for every layer', () => {
    for (const value of Object.values(LAYERS)) {
      expect(typeof LAYER_DEFINITIONS[value]).toBe('string');
      expect(LAYER_DEFINITIONS[value].length).toBeGreaterThan(20);
    }
  });

  test('isValidLayer accepts only the 4 canonical values', () => {
    expect(isValidLayer('governance')).toBe(true);
    expect(isValidLayer('drift')).toBe(true);
    expect(isValidLayer('hygiene')).toBe(true);
    expect(isValidLayer('shallow-risk')).toBe(true);
    expect(isValidLayer('deep-review')).toBe(false);
    expect(isValidLayer('')).toBe(false);
    expect(isValidLayer(undefined)).toBe(false);
    expect(isValidLayer(null)).toBe(false);
  });

  test('every check in every technique bag carries a valid layer', () => {
    const missing = [];
    const invalid = [];
    for (const [platform, bag] of Object.entries(BAGS)) {
      for (const [key, check] of Object.entries(bag)) {
        if (!check || typeof check !== 'object') continue;
        if (check.layer === undefined || check.layer === null) {
          missing.push(`${platform}/${key}`);
          continue;
        }
        if (!isValidLayer(check.layer)) {
          invalid.push(`${platform}/${key}=${check.layer}`);
        }
      }
    }
    if (missing.length > 0 || invalid.length > 0) {
      // Surface a useful message for CI failures.
      // eslint-disable-next-line no-console
      console.error('Missing layers:', missing.slice(0, 20));
      // eslint-disable-next-line no-console
      console.error('Invalid layers:', invalid.slice(0, 20));
    }
    expect(missing).toEqual([]);
    expect(invalid).toEqual([]);
  });

  test('layer distribution is well-formed and prints for CI visibility', () => {
    const totals = { governance: 0, drift: 0, hygiene: 0, 'shallow-risk': 0 };
    let grandTotal = 0;
    for (const bag of Object.values(BAGS)) {
      for (const check of Object.values(bag)) {
        if (!check || typeof check !== 'object' || !isValidLayer(check.layer)) continue;
        totals[check.layer] += 1;
        grandTotal += 1;
      }
    }
    // eslint-disable-next-line no-console
    console.log('[CTO-08 layer distribution]', totals, 'total=', grandTotal);
    // Governance should be the dominant layer (agent config is our core
    // surface). Drift + hygiene are always non-empty because Harmony-style
    // checks + cross-platform hygiene.js exist. shallow-risk is reserved.
    expect(grandTotal).toBeGreaterThan(2000);
    expect(totals.governance).toBeGreaterThan(0);
    expect(totals.drift).toBeGreaterThan(0);
    expect(totals.hygiene).toBeGreaterThan(0);
    expect(totals['shallow-risk']).toBe(0);
  });

  test('assignLayers is idempotent: existing layer values are preserved', () => {
    const bag = {
      already: { name: 'pre-tagged', layer: 'drift' },
      needs: { name: 'untagged check' },
    };
    assignLayers(bag, LAYERS.GOVERNANCE);
    expect(bag.already.layer).toBe('drift');
    expect(bag.needs.layer).toBe('governance');
    // calling again does not mutate
    assignLayers(bag, LAYERS.HYGIENE);
    expect(bag.already.layer).toBe('drift');
    expect(bag.needs.layer).toBe('governance');
  });

  test('summarizeLayers produces one bucket per canonical layer', () => {
    const out = summarizeLayers([
      { layer: 'governance', passed: true },
      { layer: 'governance', passed: false },
      { layer: 'drift', passed: null },
      { layer: 'hygiene', passed: true },
    ]);
    expect(out.governance.total).toBe(2);
    expect(out.governance.passed).toBe(1);
    expect(out.governance.failed).toBe(1);
    expect(out.drift.skipped).toBe(1);
    expect(out.hygiene.passed).toBe(1);
    expect(out['shallow-risk'].total).toBe(0);
  });
});
