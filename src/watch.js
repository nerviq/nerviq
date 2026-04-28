/**
 * Watch mode - monitors project for Claude Code config changes and re-audits.
 * Uses Node.js fs.watch (zero dependencies) with a recursive-directory fallback
 * on platforms where native recursive watch is not reliable.
 */

const fs = require('fs');
const path = require('path');
const { audit } = require('./audit');
const { detectPlatforms } = require('./public-api');
const { buildContinuousStatus, formatContinuousStatus } = require('./continuous-ops');

const COLORS = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[36m',
};
const c = (text, color) => `${COLORS[color] || ''}${text}${COLORS.reset}`;

const FILE_WATCH_PATHS = [
  'CLAUDE.md',
  '.gitignore',
  'package.json',
  'tsconfig.json',
];

const DIRECTORY_WATCH_PATHS = [
  '.claude',
  '.github',
];

function supportsNativeRecursiveWatch(platform = process.platform) {
  return platform === 'win32' || platform === 'darwin';
}

function statIfExists(fullPath) {
  try {
    return fs.statSync(fullPath);
  } catch (e) {
    return null;
  }
}

function listRecursiveDirectories(dir) {
  const directories = [dir];
  let entries = [];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return directories;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      directories.push(...listRecursiveDirectories(path.join(dir, entry.name)));
    }
  }

  return directories;
}

function buildWatchPlan(rootDir, platform = process.platform) {
  const plan = [];
  const seen = new Set();
  const recursiveSupported = supportsNativeRecursiveWatch(platform);

  const addTarget = (fullPath, recursive, source) => {
    const resolved = path.resolve(fullPath);
    const key = `${resolved}|${recursive}`;
    if (seen.has(key)) return;
    seen.add(key);
    plan.push({ path: resolved, recursive, source });
  };

  addTarget(rootDir, false, 'repo-root');

  for (const watchPath of FILE_WATCH_PATHS) {
    const fullPath = path.join(rootDir, watchPath);
    const stat = statIfExists(fullPath);
    if (stat && stat.isFile()) {
      addTarget(fullPath, false, watchPath);
    }
  }

  for (const watchPath of DIRECTORY_WATCH_PATHS) {
    const fullPath = path.join(rootDir, watchPath);
    const stat = statIfExists(fullPath);
    if (!stat || !stat.isDirectory()) continue;

    if (recursiveSupported) {
      addTarget(fullPath, true, watchPath);
      continue;
    }

    for (const dir of listRecursiveDirectories(fullPath)) {
      addTarget(dir, false, watchPath);
    }
  }

  return plan;
}

function registerWatchers(rootDir, watchers, onChange, platform = process.platform) {
  const plan = buildWatchPlan(rootDir, platform);

  for (const item of plan) {
    const key = `${item.path}|${item.recursive}`;
    if (watchers.has(key)) continue;

    try {
      const watcher = fs.watch(item.path, { recursive: item.recursive }, (eventType, filename) => {
        onChange(item, eventType, filename);
      });
      watchers.set(key, watcher);
    } catch (e) {
      // Ignore unsupported or transient watch registration failures.
    }
  }

  return watchers.size;
}

function closeWatchers(watchers) {
  for (const watcher of watchers.values()) {
    try {
      watcher.close();
    } catch (e) {
      // Ignore close errors during shutdown.
    }
  }
  watchers.clear();
}

async function watch(options) {
  const recursiveSupported = supportsNativeRecursiveWatch();
  const watchMode = options.driftMode || 'watch';

  console.log('');
  console.log(c('  nerviq watch mode', 'bold'));
  console.log(c('  ═══════════════════════════════════════', 'dim'));
  console.log(c(`  Watching: ${options.dir}`, 'dim'));
  console.log(c(`  Mode: ${recursiveSupported ? 'native recursive directories' : 'expanded directory fallback (cross-platform safe)'}`, 'dim'));
  console.log(c(`  Continuous mode: ${watchMode}`, 'dim'));
  console.log(c('  Press Ctrl+C to stop', 'dim'));
  console.log('');

  // LOOP-01: alert state — track which named alerts fired last cycle so we
  // can emit "new alert / cleared alert" lines per change rather than the
  // full list every save. The user-lab's "spellcheck for prompts" framing
  // wants action-on-change, not score-deltas alone.
  const alertsEnabled = options.alerts !== false; // default-on; pass --no-alerts to disable
  const lastAlerts = new Set();
  function buildAlertSet(result) {
    const set = new Set();
    if (result && result.staleReferences && result.staleReferences.byKey) {
      for (const [key, count] of Object.entries(result.staleReferences.byKey)) {
        set.add(`stale:${key}:${count}`);
      }
    }
    if (Array.isArray(result && result.shallowRiskHints)) {
      for (const h of result.shallowRiskHints) {
        if (h && h.key && h.severity === 'critical') {
          set.add(`critical:${h.key}:${h.file || ''}`);
        }
      }
    }
    return set;
  }
  function emitAlertDiff(prev, curr) {
    if (!alertsEnabled) return;
    const newAlerts = [...curr].filter((a) => !prev.has(a));
    const cleared = [...prev].filter((a) => !curr.has(a));
    for (const a of newAlerts) {
      console.log(c(`  🔔 NEW: ${a}`, 'yellow'));
    }
    for (const a of cleared) {
      console.log(c(`  ✓ CLEARED: ${a}`, 'green'));
    }
  }

  // Initial audit
  let lastScore = null;
  try {
    const result = await audit({ ...options, silent: true });
    lastScore = result.score;
    console.log(`  ${c('Initial score:', 'bold')} ${scoreColor(result.score)}`);
    console.log(`  ${result.passed} / ${result.passed + result.failed} checks passing`);
    if (alertsEnabled && result.staleReferences && result.staleReferences.count > 0) {
      console.log(c(`  📌 Initial alerts: ${result.staleReferences.count} stale reference(s)`, 'yellow'));
    }
    const continuousStatus = buildContinuousStatus({
      dir: options.dir,
      auditResult: result,
      mode: watchMode,
      currentPlatforms: detectPlatforms(options.dir),
    });
    console.log(formatContinuousStatus(continuousStatus, { compact: true }));
    console.log('');
    const initialAlerts = buildAlertSet(result);
    for (const a of initialAlerts) lastAlerts.add(a);
  } catch (e) {
    console.log(c(`  Initial audit failed: ${e.message}`, 'dim'));
  }

  // Watch relevant paths
  const watchers = new Map();
  let debounceTimer = null;
  let shuttingDown = false;

  const cleanupAndExit = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearTimeout(debounceTimer);
    closeWatchers(watchers);
    console.log('');
    console.log(c('  Watch mode stopped.', 'dim'));
    process.exit(0);
  };

  const handleChange = (item, eventType, filename) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const changedLabel = filename
        ? String(filename)
        : path.relative(options.dir, item.path) || path.basename(item.path);
      const timestamp = new Date().toLocaleTimeString();

      // Pick up newly created directories or newly materialized watch paths.
      registerWatchers(options.dir, watchers, handleChange);

      console.log(c(`  [${timestamp}] Change detected: ${changedLabel}`, 'dim'));

      try {
        const result = await audit({ ...options, silent: true });
        const delta = lastScore !== null ? result.score - lastScore : 0;
        const arrow = delta > 0 ? c(`+${delta}`, 'green') : delta < 0 ? c(String(delta), 'yellow') : '';
        const continuousStatus = buildContinuousStatus({
          dir: options.dir,
          auditResult: result,
          mode: watchMode,
          currentPlatforms: detectPlatforms(options.dir),
        });

        console.log(`  Score: ${scoreColor(result.score)} ${arrow}  (${result.passed}/${result.passed + result.failed} passing)`);
        console.log(formatContinuousStatus(continuousStatus, { compact: true }));

        // LOOP-01: emit named alert diff (NEW / CLEARED) per change, so the
        // developer gets action-on-change feedback, not just score deltas.
        const currentAlerts = buildAlertSet(result);
        emitAlertDiff(lastAlerts, currentAlerts);
        lastAlerts.clear();
        for (const a of currentAlerts) lastAlerts.add(a);

        if (lastScore !== null && result.score > lastScore) {
          console.log(c('  Nice improvement!', 'green'));
        } else if (lastScore !== null && result.score < lastScore) {
          console.log(c('  Score dropped - check what changed.', 'yellow'));
        }
        lastScore = result.score;
        console.log('');
      } catch (e) {
        // Ignore transient errors during file saves.
      }
    }, 500);
  };

  registerWatchers(options.dir, watchers, handleChange);

  if (watchers.size === 0) {
    console.log(c('  Could not register any filesystem watchers in this environment.', 'yellow'));
    return;
  }

  process.once('SIGINT', cleanupAndExit);
  process.once('SIGTERM', cleanupAndExit);

  console.log(c(`  Watching ${watchers.size} targets for changes...`, 'dim'));
  console.log('');

  // Keep alive
  await new Promise(() => {});
}

function scoreColor(score) {
  const color = score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'dim';
  return c(`${score}/100`, color);
}

module.exports = {
  watch,
  buildWatchPlan,
  supportsNativeRecursiveWatch,
};
