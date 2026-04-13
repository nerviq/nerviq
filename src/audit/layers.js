/**
 * CTO-08 — 5-layer scope clarity.
 *
 * Every check in the NERVIQ audit is tagged with exactly one layer so
 * customers and evaluators get an explicit map of what NERVIQ covers and
 * what it does not. The 4 positive layers below intentionally exclude any
 * "deep-review" / general-security-scanning lane: NERVIQ is an
 * agent-configuration audit tool, not a code-review tool.
 *
 * Taxonomy (canonical — mirrored in docs/integration-contracts.md §8):
 *
 *   governance   — Agent configuration posture: presence, content, and
 *                  quality of agent-instruction files and platform
 *                  settings. Answers "does my agent know X?".
 *
 *   drift        — Cross-platform consistency: do multiple platform
 *                  configs agree? Does the declared state match the
 *                  repo reality? Answers "do two places agree on X?".
 *
 *   hygiene      — Repo-level cleanliness and operational basics
 *                  adjacent to agents (gitignore, CHANGELOG, SECURITY.md,
 *                  CI, Dependabot, license, editorconfig, Node version
 *                  pinning, etc.). Answers "does the repo have standard
 *                  engineering hygiene that makes the agent's job
 *                  easier?".
 *
 *   shallow-risk — Reserved for CTO-06. No checks currently live in
 *                  this layer; the constant exists so formatters and
 *                  types know about it.
 *
 * Disambiguation rule-of-thumb when a check could plausibly belong to
 * more than one layer: prefer the most specific layer (drift > hygiene
 * > governance). If in doubt, default to hygiene — a mild
 * misclassification is recoverable; a missing tag breaks the coverage
 * test.
 */

'use strict';

const LAYERS = Object.freeze({
  GOVERNANCE: 'governance',
  DRIFT: 'drift',
  HYGIENE: 'hygiene',
  SHALLOW_RISK: 'shallow-risk',
});

const LAYER_DEFINITIONS = Object.freeze({
  [LAYERS.GOVERNANCE]: 'Agent configuration posture: presence, content, and quality of agent-instruction files and platform settings.',
  [LAYERS.DRIFT]: 'Cross-platform consistency: do multiple platform configs agree, and does the declared state match repo reality?',
  [LAYERS.HYGIENE]: 'Repo-level cleanliness and operational basics adjacent to agents (gitignore, CHANGELOG, SECURITY.md, CI, license, etc.).',
  [LAYERS.SHALLOW_RISK]: 'Reserved for shallow-risk boundary checks (CTO-06). No checks currently populate this layer.',
});

const VALID_LAYER_VALUES = new Set(Object.values(LAYERS));

function isValidLayer(value) {
  return typeof value === 'string' && VALID_LAYER_VALUES.has(value);
}

/**
 * Name/id patterns that strongly indicate a drift check. Applied only as
 * a heuristic when tagging existing check bags (see assignLayers).
 */
const DRIFT_PATTERNS = [
  /drift/i,
  /harmony/i,
  /\bpropagation\b/i,
  /consisten(t|cy)/i,
  /cross[- ]?platform/i,
  /across (surfaces|platforms|all .* surfaces)/i,
  /\bpacks are consistent\b/i,
  /propagation (checklist|completeness|delay)/i,
];

/**
 * Hygiene name patterns — used to upgrade a check from a default
 * governance bag into hygiene when the check is clearly about repo
 * engineering hygiene rather than agent config.
 */
const HYGIENE_PATTERNS = [
  /\.gitignore/i,
  /\bCHANGELOG\b/i,
  /\bCONTRIBUTING\b/i,
  /\bLICENSE\b/i,
  /\.editorconfig/i,
  /\bEditorConfig\b/i,
  /\bSECURITY\.md\b/i,
  /\bCODE_OF_CONDUCT\b/i,
  /\bDependabot\b/i,
  /\bNode version pinned\b/i,
  /\bREADME\b.*\b(install|usage|contributing|sections|section)\b/i,
  /\blockfile\b/i,
  /\bcargo-audit\b/i,
  /\bDockerfile\b/i,
  /\bCI (is configured|configured|pipeline|workflow)/i,
  /\bGitHub Actions\b/i,
  /\b\.github\/workflows\b/i,
  /\bpre-commit\b/i,
  /\b(poetry|uv|pipenv|npm|pnpm|yarn|bun)\.lock/i,
  /\brenovate\b/i,
  /\bsemver\b/i,
  /\brelease automation\b/i,
];

/**
 * Check categories that strongly indicate repo-hygiene rather than
 * agent-configuration. These cover the stack-specific engineering
 * baselines (Python lockfile, Rust target/ in .gitignore, etc.) that
 * ship via the stacks checks.
 */
const HYGIENE_CATEGORIES = new Set([
  'dependency-management', 'supply-chain', 'release-freshness',
  'docker', 'ci', 'ci-cd',
  'git', // the cross-platform hygiene.js checks live here
]);

function inferLayerForCheck(check, defaultLayer) {
  const probe = `${check.name || ''} ${check.id || ''} ${check.key || ''}`;
  if (DRIFT_PATTERNS.some((re) => re.test(probe))) return LAYERS.DRIFT;
  if (defaultLayer === LAYERS.GOVERNANCE) {
    if (HYGIENE_PATTERNS.some((re) => re.test(probe))) return LAYERS.HYGIENE;
    if (check.category && HYGIENE_CATEGORIES.has(check.category)) return LAYERS.HYGIENE;
  }
  return defaultLayer;
}

/**
 * Mutates `bag` (a technique dictionary of { key: { name, id, ... } })
 * so every entry has a `layer` field. Existing `layer` values on
 * individual checks are respected.
 *
 * @param {Object} bag            technique dictionary
 * @param {string} defaultLayer   one of LAYERS.*, used when heuristics don't fire
 * @returns {Object} the same bag, for chaining
 */
function assignLayers(bag, defaultLayer = LAYERS.GOVERNANCE) {
  if (!bag || typeof bag !== 'object') return bag;
  if (!isValidLayer(defaultLayer)) {
    throw new Error(`assignLayers: invalid defaultLayer "${defaultLayer}"`);
  }
  for (const [key, check] of Object.entries(bag)) {
    if (!check || typeof check !== 'object') continue;
    if (isValidLayer(check.layer)) continue;
    const withKey = { ...check, key };
    check.layer = inferLayerForCheck(withKey, defaultLayer);
  }
  return bag;
}

/**
 * Summary helper — counts checks per layer in a results array. Used by
 * the audit text renderer and by the coverage test.
 */
function summarizeLayers(results) {
  const summary = {
    [LAYERS.GOVERNANCE]: { total: 0, passed: 0, failed: 0, skipped: 0 },
    [LAYERS.DRIFT]: { total: 0, passed: 0, failed: 0, skipped: 0 },
    [LAYERS.HYGIENE]: { total: 0, passed: 0, failed: 0, skipped: 0 },
    [LAYERS.SHALLOW_RISK]: { total: 0, passed: 0, failed: 0, skipped: 0 },
  };
  for (const r of results || []) {
    const layer = isValidLayer(r.layer) ? r.layer : LAYERS.HYGIENE;
    const bucket = summary[layer];
    bucket.total += 1;
    if (r.passed === true) bucket.passed += 1;
    else if (r.passed === false) bucket.failed += 1;
    else bucket.skipped += 1;
  }
  return summary;
}

module.exports = {
  LAYERS,
  LAYER_DEFINITIONS,
  isValidLayer,
  assignLayers,
  summarizeLayers,
  inferLayerForCheck,
};
