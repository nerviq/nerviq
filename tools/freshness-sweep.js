#!/usr/bin/env node
'use strict';

/**
 * FRESH-AUTO — the freshness pass, as a script.
 *
 * On 2026-07-29 this was done by hand and found 29 broken source URLs
 * affecting 344 checks: two vendors had moved their documentation host
 * entirely, one had changed GitHub org, and one page had 404'd. The
 * project's differentiator is "every check carries a source URL and a
 * freshness date" — a claim that decays silently on a 14-to-30-day clock
 * and had gone 23 days unchecked.
 *
 * THE ONE RULE THIS SCRIPT EXISTS TO ENFORCE:
 *
 *   Redirects are FAILURES, not successes.
 *
 * The first manual sweep used `curl -L`, followed every redirect, and
 * reported 86/86 sources healthy. Following redirects made the exact
 * failure mode being hunted — a moved doc — look like a pass. A verifier
 * that accepts a success signal produced by the failure it detects is
 * worse than no verifier: it certifies the lie.
 *
 * Usage:
 *   node tools/freshness-sweep.js            # sweep, print a report
 *   node tools/freshness-sweep.js --check    # CI mode: exit 1 on any move
 *   node tools/freshness-sweep.js --json     # machine-readable
 *   node tools/freshness-sweep.js --fix      # rewrite moved URLs in place
 *   node tools/freshness-sweep.js --p0-only  # release-gate sources only
 *
 * Zero dependencies, like the rest of the package.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const USER_AGENT = 'Mozilla/5.0 (compatible; nerviq-freshness/1.x; +https://github.com/nerviq/nerviq)';
const TIMEOUT_MS = 20000;
const CONCURRENCY = 8;

const FRESHNESS_MODULES = {
  claude: '../src/freshness',
  codex: '../src/codex/freshness',
  cursor: '../src/cursor/freshness',
  copilot: '../src/copilot/freshness',
  gemini: '../src/gemini/freshness',
  windsurf: '../src/windsurf/freshness',
  aider: '../src/aider/freshness',
  opencode: '../src/opencode/freshness',
};

// ─── Collection ─────────────────────────────────────────────────────────────

function collectP0Sources() {
  const out = [];
  for (const [platform, modulePath] of Object.entries(FRESHNESS_MODULES)) {
    let mod;
    try { mod = require(modulePath); } catch { continue; }
    for (const source of mod.P0_SOURCES || []) {
      out.push({ kind: 'p0', platform, key: source.key, url: source.url, weight: 1 });
    }
  }
  return out;
}

function collectCheckSources() {
  let catalog;
  try {
    catalog = require('../src/catalog').generateCatalog();
  } catch {
    return [];
  }
  const byUrl = new Map();
  for (const check of Object.values(catalog)) {
    if (!check || !check.sourceUrl) continue;
    if (!byUrl.has(check.sourceUrl)) byUrl.set(check.sourceUrl, { platforms: new Set(), count: 0 });
    const entry = byUrl.get(check.sourceUrl);
    entry.platforms.add(check.platform);
    entry.count += 1;
  }
  return [...byUrl.entries()].map(([url, e]) => ({
    kind: 'check',
    platform: [...e.platforms].join(','),
    key: `${e.count} check(s)`,
    url,
    weight: e.count,
  }));
}

// ─── Probing ────────────────────────────────────────────────────────────────

/**
 * A single request with NO redirect following. A 3xx is recorded as a move,
 * which is the whole point of the exercise.
 */
function probe(url) {
  return new Promise((resolve) => {
    let client;
    let options;
    try {
      const parsed = new URL(url);
      client = parsed.protocol === 'http:' ? http : https;
      options = {
        method: 'GET',
        headers: { 'user-agent': USER_AGENT, accept: '*/*' },
        timeout: TIMEOUT_MS,
      };
    } catch {
      return resolve({ status: 0, location: null, error: 'invalid URL' });
    }

    const req = client.request(url, options, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers.location || null;
      res.resume(); // drain, we only need the head
      resolve({ status, location: location ? new URL(location, url).toString() : null, error: null });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, location: null, error: 'timeout' }); });
    req.on('error', (err) => resolve({ status: 0, location: null, error: err.code || err.message }));
    req.end();
  });
}

/** Follow the redirect chain one hop at a time to find the terminal URL. */
async function resolveFinal(url, maxHops = 5) {
  let current = url;
  for (let hop = 0; hop < maxHops; hop++) {
    const res = await probe(current);
    if (res.status >= 300 && res.status < 400 && res.location) {
      current = res.location;
      continue;
    }
    return { final: current, status: res.status, error: res.error };
  }
  return { final: current, status: 0, error: 'redirect loop' };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// ─── Reporting / fixing ─────────────────────────────────────────────────────

function collectSourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(js|json)$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

function applyFixes(moves) {
  const files = collectSourceFiles();
  let replacements = 0;
  const touched = new Set();
  for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    const original = content;
    for (const move of moves.sort((a, b) => b.url.length - a.url.length)) {
      if (!content.includes(move.url)) continue;
      // Only replace complete quoted values, so a URL that is a prefix of
      // another never eats it.
      for (const quote of ["'", '"']) {
        const from = `${quote}${move.url}${quote}`;
        const to = `${quote}${move.final}${quote}`;
        while (content.includes(from)) {
          content = content.replace(from, to);
          replacements += 1;
        }
      }
    }
    if (content !== original) {
      fs.writeFileSync(file, content, 'utf8');
      touched.add(path.relative(ROOT, file));
    }
  }
  return { replacements, files: [...touched] };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = new Set(process.argv.slice(2));
  const checkMode = args.has('--check');
  const jsonMode = args.has('--json');
  const fixMode = args.has('--fix');
  const p0Only = args.has('--p0-only');

  const sources = p0Only ? collectP0Sources() : [...collectP0Sources(), ...collectCheckSources()];
  if (sources.length === 0) {
    console.error('freshness-sweep: no sources found — is this the nerviq repo?');
    process.exit(2);
  }

  if (!jsonMode) {
    console.log(`\n  nerviq freshness sweep — ${sources.length} source(s), redirects treated as failures\n`);
  }

  const probed = await mapLimit(sources, CONCURRENCY, async (source) => {
    const res = await probe(source.url);
    return { ...source, status: res.status, location: res.location, error: res.error };
  });

  const healthy = probed.filter((s) => s.status === 200);
  const moved = probed.filter((s) => s.status >= 300 && s.status < 400);
  const dead = probed.filter((s) => s.status >= 400 || s.status === 0);

  // Resolve terminal targets for everything that moved, so --fix and the
  // report both point at a URL that is actually final.
  await mapLimit(moved, CONCURRENCY, async (source) => {
    const resolved = await resolveFinal(source.location || source.url);
    source.final = resolved.final;
    source.finalStatus = resolved.status;
    return source;
  });

  const affectedChecks = [...moved, ...dead].reduce((sum, s) => sum + (s.kind === 'check' ? s.weight : 0), 0);

  if (jsonMode) {
    console.log(JSON.stringify({
      total: sources.length,
      healthy: healthy.length,
      moved: moved.length,
      dead: dead.length,
      affectedChecks,
      moves: moved.map((s) => ({ platform: s.platform, key: s.key, from: s.url, to: s.final, status: s.status, finalStatus: s.finalStatus })),
      deadSources: dead.map((s) => ({ platform: s.platform, key: s.key, url: s.url, status: s.status, error: s.error })),
    }, null, 2));
  } else {
    console.log(`  healthy: ${healthy.length}    moved: ${moved.length}    dead: ${dead.length}`);
    if (affectedChecks > 0) console.log(`  checks affected: ${affectedChecks}`);
    console.log('');
    for (const s of moved) {
      console.log(`  [${s.status}] ${s.platform} · ${s.key}`);
      console.log(`        ${s.url}`);
      console.log(`     -> ${s.final}${s.finalStatus === 200 ? '' : `  (terminal status ${s.finalStatus})`}`);
    }
    for (const s of dead) {
      console.log(`  [${s.status || 'ERR'}] ${s.platform} · ${s.key}  ${s.error || ''}`);
      console.log(`        ${s.url}`);
      console.log('     -> NO REPLACEMENT — needs a human to find the current page');
    }
    if (moved.length === 0 && dead.length === 0) {
      console.log('  Every source resolves to a terminal 200. Freshness claim holds.\n');
    } else {
      console.log('');
    }
  }

  if (fixMode) {
    const fixable = moved.filter((s) => s.final && s.finalStatus === 200);
    const result = applyFixes(fixable);
    console.log(`  --fix: ${result.replacements} replacement(s) across ${result.files.length} file(s)`);
    for (const f of result.files) console.log(`         ${f}`);
    if (dead.length > 0) {
      console.log(`  ${dead.length} dead source(s) left untouched — a 404 has no mechanical replacement.`);
    }
    console.log('');
  }

  if (checkMode && (moved.length > 0 || dead.length > 0)) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('freshness-sweep failed:', err && err.message ? err.message : err);
  process.exit(2);
});
