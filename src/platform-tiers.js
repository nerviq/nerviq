/**
 * Platform support tiers — verified vs community-maintained.
 *
 * Decision (revival sprint, 2026-07 — FABLE_AUDIT_2026-07-05 move #1 /
 * docs/SPRINT_30D_2026-07.md week 1): weekly changelog review across all
 * 8 platforms is not sustainable for a solo maintainer, and the top-4
 * platforms cover the overwhelming share of the ICP. The remaining four
 * are demoted to a community-maintained tier.
 *
 *   - verified:  Claude Code, Codex, Copilot, Cursor. P0 doc sources are
 *     actively re-verified on the freshness cycle (last full pass
 *     2026-07-06); the freshness promise ("every check has a source URL
 *     and a freshness date") is actively maintained.
 *   - community: Gemini CLI, Windsurf, Aider, OpenCode. ALL checks still
 *     ship and run exactly as before — nothing is deleted or disabled —
 *     but check freshness is NOT guaranteed: sources are re-verified
 *     opportunistically or via community contribution, and `verifiedAt`
 *     stamps may be stale.
 *
 * This is intentionally REVERSIBLE: promoting a platform back to the
 * verified tier is a one-line change here plus a fresh P0 source
 * re-verification pass for that platform (see docs/PLATFORM_REFRESH_2026-07.md
 * for the procedure).
 */

'use strict';

const TIER_VERIFIED = 'verified';
const TIER_COMMUNITY = 'community';

const PLATFORM_TIERS = {
  claude: TIER_VERIFIED,
  codex: TIER_VERIFIED,
  copilot: TIER_VERIFIED,
  cursor: TIER_VERIFIED,
  gemini: TIER_COMMUNITY,
  windsurf: TIER_COMMUNITY,
  aider: TIER_COMMUNITY,
  opencode: TIER_COMMUNITY,
};

const TIER_LABELS = {
  [TIER_VERIFIED]: 'Verified',
  [TIER_COMMUNITY]: 'Community',
};

/**
 * Tier for a platform key. Unknown platforms (e.g. plugin-added) default to
 * community — the honest default, since nobody on the core team verifies them.
 * @param {string} platform - Platform key (claude, codex, gemini, ...)
 * @returns {string} 'verified' | 'community'
 */
function platformTier(platform) {
  return PLATFORM_TIERS[platform] || TIER_COMMUNITY;
}

/**
 * Human-readable tier label.
 * @param {string} platform - Platform key
 * @returns {string} 'Verified' | 'Community'
 */
function platformTierLabel(platform) {
  return TIER_LABELS[platformTier(platform)];
}

/**
 * One-line honesty note for community-tier platforms (shown in audit output).
 * @param {string} platform - Platform key
 * @returns {string|null} Note for community platforms, null for verified ones.
 */
function communityTierNote(platform) {
  if (platformTier(platform) !== TIER_COMMUNITY) return null;
  return 'Community-maintained tier: checks run as usual, but source freshness is not guaranteed current. Verified tier: Claude Code, Codex, Copilot, Cursor.';
}

module.exports = {
  PLATFORM_TIERS,
  TIER_VERIFIED,
  TIER_COMMUNITY,
  platformTier,
  platformTierLabel,
  communityTierNote,
};
