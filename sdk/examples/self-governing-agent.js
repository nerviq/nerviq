#!/usr/bin/env node
/**
 * Reference: self-governing AI coding agent loop using @nerviq/cli/sdk.
 *
 * This file is the AI-07 reference example for the docs/for-agents page on
 * nerviq.net. It implements the "Self-governing agent pattern" documented
 * there: an agent that audits the repo before acting, runs targeted fixes,
 * makes the actual code change, re-audits to detect regression, and records
 * outcomes back into the local learning loop.
 *
 * Usage (after `npm install @nerviq/cli`):
 *   node node_modules/@nerviq/cli/sdk/examples/self-governing-agent.js [repo-dir]
 *
 * Default repo-dir is process.cwd().
 *
 * NOT autonomous in the dangerous sense:
 *   - This loop NEVER calls --apply --auto silently. Mutations of governance
 *     posture (deny rules, MCP permissions, hooks) require explicit user
 *     consent. The example surfaces a plan and waits for the next human
 *     decision; that's by design and matches the docs/for-agents constraint.
 */

'use strict';

// Resolve the SDK from npm install OR from the in-repo path (for running this
// example directly from a checkout of nerviq/nerviq).
function loadSdk() {
  try {
    return require('@nerviq/cli/sdk');
  } catch {
    return require('../index.js');
  }
}
const { audit, harmonyAudit, detectPlatforms } = loadSdk();
const path = require('path');

async function selfGoverningLoop(repoDir, opts = {}) {
  const dir = path.resolve(repoDir);
  const log = opts.log || console.log;
  const HARMONY_DRIFT_THRESHOLD = 60;

  // ── Step 1. Pre-task audit ──────────────────────────────────────────────
  log('[1/5] pre-task audit…');
  const platforms = detectPlatforms(dir);
  log(`      platforms: ${platforms.join(', ') || '(none detected — single-platform repo)'}`);

  const pre = await audit(dir, opts.platform || (platforms[0] || 'claude'));
  log(`      score: ${pre.score}/100  organic: ${pre.organicScore}/100  failed: ${pre.failed}`);

  // The headline value: stale references. Surface BEFORE doing anything.
  if (pre.staleReferences && pre.staleReferences.count > 0) {
    log(`      📌 ${pre.staleReferences.headline}`);
    for (const sample of pre.staleReferences.topSample) {
      log(`         · ${sample.file}:${sample.line} — ${sample.fix.split('\n')[0].slice(0, 100)}`);
    }
    log('      ↳ recommend: surface to user, ask whether to proceed despite stale refs');
  }

  // ── Step 2. Cross-platform Harmony check (only if multi-platform) ──────
  if (platforms.length >= 2) {
    log('[2/5] harmony check (cross-platform drift)…');
    const harmony = await harmonyAudit(dir);
    log(`      harmonyScore: ${harmony.harmonyScore}/100`);

    if (harmony.harmonyScore < HARMONY_DRIFT_THRESHOLD) {
      log(`      ⚠️  harmony below ${HARMONY_DRIFT_THRESHOLD} — drift between platforms is forming`);
      log('      ↳ recommend: surface drifts to user, decide whether to harmony-sync before proceeding');
      // NOTE: a real agent would surface harmony.drift list here and wait for
      // user approval before running `nerviq harmony-sync --fix`. We do NOT
      // call it silently from the agent loop.
    }
  } else {
    log('[2/5] harmony check skipped (single-platform repo)');
  }

  // ── Step 3. Make the actual code change ─────────────────────────────────
  log('[3/5] doing the actual task… (placeholder — replace with the real agent action)');
  // In a real agent: execute the user's task. Edit files, run tests, etc.
  // For this example, simulate a small change so step 4's diff-only audit has
  // something to compare against.
  if (typeof opts.doWork === 'function') {
    await opts.doWork({ dir, preAuditScore: pre.score });
  } else {
    log('      (no doWork callback provided — skipping)');
  }

  // ── Step 4. Post-task diff-only re-audit ────────────────────────────────
  log('[4/5] post-task diff-only audit…');
  const post = await audit(dir, opts.platform || (platforms[0] || 'claude'));
  const delta = post.score - pre.score;
  const arrow = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '0';
  log(`      score: ${post.score}/100  Δ ${arrow}  failed: ${post.failed}`);

  if (delta < -3) {
    log('      🔴 score dropped materially — recommend: rollback or human review');
  } else if (delta > 0) {
    log('      ✓ score improved');
  }

  // ── Step 5. Record outcome (learning loop) ─────────────────────────────
  log('[5/5] outcome recording — call `nerviq feedback --key <K> --status accepted|rejected|deferred --score-delta <delta>`');
  log('       (the agent should invoke this once per recommendation it acted on, so suggest-rules can learn the team\'s actual preferences)');

  return {
    pre,
    post,
    delta,
    platforms,
    recommendation:
      delta < -3
        ? 'rollback-or-review'
        : pre.staleReferences && pre.staleReferences.count > 0
          ? 'surface-stale-references-to-user'
          : delta > 0
            ? 'continue'
            : 'no-change',
  };
}

if (require.main === module) {
  const dir = process.argv[2] || process.cwd();
  selfGoverningLoop(dir, { log: console.log })
    .then((result) => {
      console.log('\n=== Loop complete ===');
      console.log(`Recommendation: ${result.recommendation}`);
      console.log(`Pre/post score: ${result.pre.score} → ${result.post.score} (Δ ${result.delta})`);
      process.exitCode = result.recommendation === 'rollback-or-review' ? 1 : 0;
    })
    .catch((err) => {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    });
}

module.exports = { selfGoverningLoop };
