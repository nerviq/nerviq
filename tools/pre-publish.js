#!/usr/bin/env node
/**
 * pre-publish.js — pre-publish safety check for local and CI workflows.
 *
 * Runs a red/green checklist BEFORE `npm publish` touches anything:
 *   1. Clean working tree (no uncommitted changes)
 *   2. On main branch
 *   3. Local main matches remote main (no unpushed/unpulled commits)
 *   4. Expected version matches package.json (optional, CI-friendly)
 *   5. package.json version not already on npm
 *   6. CHANGELOG.md has a dated entry matching package.json version
 *   7. Jest suite passes
 *   8. Release-metadata drift guard passes (delegates to validate-release-metadata.js)
 *
 * Wire in via package.json:
 *   "scripts": {
 *     "prepublishOnly": "node tools/pre-publish.js"
 *   }
 *
 * CI mode:
 *   node tools/pre-publish.js --ci --expected-version 1.29.0
 *
 * In CI mode the local-only git checks (clean tree / branch / remote sync)
 * are skipped automatically because GitHub Actions checks out a detached
 * worktree. Changelog, npm-registry, version, tests, and release-metadata
 * checks stay active unless explicitly skipped.
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
const ciMode = process.argv.includes('--ci');

function flagValue(name) {
  const direct = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) {
    return direct.slice(name.length + 1).trim() || null;
  }
  const index = process.argv.indexOf(name);
  if (index === -1 || index === process.argv.length - 1) {
    return null;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    return null;
  }
  return value.trim();
}

const expectedVersion = flagValue('--expected-version');
const CI_SKIP_FLAGS = new Set(['clean', 'branch', 'remote']);
const skipFlag = (name) => process.argv.includes(`--skip-${name}`) || (ciMode && CI_SKIP_FLAGS.has(name));

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

// --- 4. Expected version matches package.json (optional) ---
function checkExpectedVersion() {
  if (!expectedVersion) return record('expected version matches package.json', true, 'not requested');
  const releaseMetadataPath = path.join(ROOT, 'release-metadata.json');
  let metadataVersion = null;
  try {
    metadataVersion = JSON.parse(fs.readFileSync(releaseMetadataPath, 'utf8')).version || null;
  } catch {
    metadataVersion = null;
  }

  if (pkg.version !== expectedVersion) {
    record('expected version matches package.json', false, `package.json=${pkg.version}, expected=${expectedVersion}`);
    return;
  }

  if (metadataVersion && metadataVersion !== expectedVersion) {
    record('expected version matches package.json', false, `release-metadata.json=${metadataVersion}, expected=${expectedVersion}`);
    return;
  }

  record('expected version matches package.json', true, expectedVersion);
}

// --- 5. package.json version not yet on npm ---
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

// --- 6. CHANGELOG has dated entry for this version ---
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

// --- 7. Jest passes ---
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

// --- 8. release-metadata drift guard ---
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
  console.log(`\nnerviq pre-publish check — ${pkg.name}@${pkg.version}${ciMode ? ' (ci mode)' : ''}\n`);

  checkCleanTree();
  checkBranch();
  checkRemoteSync();
  checkExpectedVersion();
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
    console.error('Use --skip-<name> to bypass a specific check in an emergency (clean, branch, remote, npm, changelog, tests, metadata). Use --expected-version X.Y.Z in CI to pin the intended release version.\n');
    process.exit(1);
  }

  console.log('\x1b[32mpre-publish: all checks green — safe to publish.\x1b[0m\n');
  process.exit(0);
}

main().catch((e) => {
  console.error(e.stack || String(e));
  process.exit(2);
});
