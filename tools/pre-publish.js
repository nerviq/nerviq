#!/usr/bin/env node
/**
 * pre-publish.js — single-command pre-publish safety check.
 *
 * Runs a red/green checklist BEFORE `npm publish` touches anything:
 *   1. Clean working tree (no uncommitted changes)
 *   2. On main branch
 *   3. Local main matches remote main (no unpushed/unpulled commits)
 *   4. package.json version not already on npm
 *   5. CHANGELOG.md has a dated entry matching package.json version
 *   6. Jest suite passes
 *   7. Release-metadata drift guard passes (delegates to validate-release-metadata.js)
 *
 * Wire in via package.json:
 *   "scripts": {
 *     "prepublishOnly": "node tools/pre-publish.js"
 *   }
 *
 * This would have caught the v1.18.0 -> v1.19.0 publish mishap where
 * the local clone was on a Codex branch with an old package.json.
 *
 * Exit codes:
 *   0 = all checks passed, safe to publish
 *   1 = at least one check failed, publish should be aborted
 *   2 = script itself errored
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const checks = [];
const skipFlag = (name) => process.argv.includes(`--skip-${name}`);

function record(name, ok, detail) {
  checks.push({ name, ok, detail });
}

function sh(cmd, opts = {}) {
  const out = execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  return (out || '').trim();
}

// --- 1. Clean working tree ---
function checkCleanTree() {
  if (skipFlag('clean')) return record('clean working tree', true, 'skipped');
  try {
    const status = sh('git status --porcelain');
    if (status) {
      record('clean working tree', false, `uncommitted changes:\n${status.split('\n').slice(0, 10).map(l => '    ' + l).join('\n')}`);
    } else {
      record('clean working tree', true);
    }
  } catch (e) {
    record('clean working tree', false, e.message);
  }
}

// --- 2. On main branch ---
function checkBranch() {
  if (skipFlag('branch')) return record('branch = main', true, 'skipped');
  try {
    const branch = sh('git branch --show-current');
    if (branch === 'main') {
      record('branch = main', true);
    } else {
      record('branch = main', false, `current branch: ${branch || '(detached)'}`);
    }
  } catch (e) {
    record('branch = main', false, e.message);
  }
}

// --- 3. Local main matches remote ---
function checkRemoteSync() {
  if (skipFlag('remote')) return record('local in sync with remote main', true, 'skipped');
  try {
    const remotes = sh('git remote').split('\n').filter(Boolean);
    const remoteName = remotes.includes('nerviq') ? 'nerviq' : (remotes.includes('origin') ? 'origin' : remotes[0]);
    if (!remoteName) {
      record('local in sync with remote main', false, 'no git remote configured');
      return;
    }
    execSync(`git fetch ${remoteName} main`, { cwd: ROOT, stdio: 'ignore' });
    const local = sh('git rev-parse HEAD');
    const remote = sh(`git rev-parse ${remoteName}/main`);
    if (local === remote) {
      record('local in sync with remote main', true);
    } else {
      record('local in sync with remote main', false, `HEAD=${local.slice(0, 8)} vs ${remoteName}/main=${remote.slice(0, 8)}`);
    }
  } catch (e) {
    record('local in sync with remote main', false, e.message);
  }
}

// --- 4. package.json version not yet on npm ---
function checkNpmNotPublished() {
  if (skipFlag('npm')) return record('version not already on npm', true, 'skipped');
  return new Promise((resolve) => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${pkg.version}`;
    https.get(url, (res) => {
      if (res.statusCode === 404) {
        record('version not already on npm', true, `${pkg.name}@${pkg.version} not published`);
      } else if (res.statusCode === 200) {
        record('version not already on npm', false, `${pkg.name}@${pkg.version} is already published — bump version before publishing`);
      } else {
        record('version not already on npm', false, `unexpected HTTP ${res.statusCode}`);
      }
      res.resume();
      resolve();
    }).on('error', (e) => {
      record('version not already on npm', false, e.message);
      resolve();
    });
  });
}

// --- 5. CHANGELOG has dated entry for this version ---
function checkChangelog() {
  if (skipFlag('changelog')) return record('CHANGELOG entry matches version', true, 'skipped');
  try {
    const text = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
    const pattern = new RegExp(`^## \\[${pkg.version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}`, 'm');
    if (pattern.test(text)) {
      record('CHANGELOG entry matches version', true, `## [${pkg.version}] - <date> present`);
    } else {
      record('CHANGELOG entry matches version', false, `no "## [${pkg.version}] - YYYY-MM-DD" heading in CHANGELOG.md`);
    }
  } catch (e) {
    record('CHANGELOG entry matches version', false, e.message);
  }
}

// --- 6. Jest passes ---
function checkTests() {
  if (skipFlag('tests')) return record('jest suite passes', true, 'skipped');
  try {
    const out = sh('npx jest --silent 2>&1', { stdio: ['ignore', 'pipe', 'pipe'] });
    const match = out.match(/Tests:\s+(\d+) passed, (\d+) total/);
    if (match && match[1] === match[2]) {
      record('jest suite passes', true, `${match[1]}/${match[2]} tests`);
    } else {
      record('jest suite passes', false, out.split('\n').slice(-10).join('\n'));
    }
  } catch (e) {
    record('jest suite passes', false, `jest exited non-zero\n${e.stdout?.toString().slice(-500) || ''}`);
  }
}

// --- 7. release-metadata drift guard ---
function checkReleaseMetadata() {
  if (skipFlag('metadata')) return record('release-metadata drift guard', true, 'skipped');
  try {
    sh('node tools/validate-release-metadata.js');
    record('release-metadata drift guard', true);
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    record('release-metadata drift guard', false, out.slice(-500) || e.message);
  }
}

async function main() {
  console.log(`\nnerviq pre-publish check — ${pkg.name}@${pkg.version}\n`);

  checkCleanTree();
  checkBranch();
  checkRemoteSync();
  await checkNpmNotPublished();
  checkChangelog();
  checkTests();
  checkReleaseMetadata();

  console.log('');
  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? '\x1b[32mOK\x1b[0m ' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  [${mark}] ${c.name}${c.detail ? '  — ' + c.detail : ''}`);
    if (!c.ok) failed += 1;
  }
  console.log('');

  if (failed > 0) {
    console.error(`\x1b[31mpre-publish: ${failed} check(s) failed — aborting publish.\x1b[0m\n`);
    console.error('Use --skip-<name> to bypass a specific check in an emergency (clean, branch, remote, npm, changelog, tests, metadata).\n');
    process.exit(1);
  }

  console.log('\x1b[32mpre-publish: all checks green — safe to publish.\x1b[0m\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(2);
});
