'use strict';

const {
  SHALLOW_RISK_DOC_URL,
  fileExists,
  getAgentConfigEntries,
  getScannableLines,
} = require('../shared');

/**
 * Non-npm task-runner staleness.
 *
 * The sibling pattern `agent-config-script-not-in-package-json` covers the
 * JS ecosystem only (npm/pnpm/yarn/bun + package.json scripts). Every
 * non-JS repo — Python, Go, Rust, Ruby, PHP, and the large "polyglot repo
 * driven by a Makefile" class — was invisible to the headline wedge.
 *
 * This pattern applies the same contract to declarative task runners:
 * the agent doc names a task, the runner file is the source of truth, and
 * a name that isn't declared there is a lie the agent will act on.
 *
 * Precision rules (same philosophy as the npm pattern — an FP here is a
 * trust-killer):
 *   - A runner is only consulted when its file actually exists in the repo.
 *   - Prose-prone verbs (`make`, `just`, `task`, `rake`, `composer`) are
 *     only counted inside a backtick span, i.e. written as code. Without
 *     this, "make sure the tests pass" reports a missing `sure` target.
 *   - Unambiguous multi-token forms (`bundle exec rake x`, `tox -e x`,
 *     `cargo make x`) are counted anywhere.
 *   - Namespaced Ruby tasks (`rake db:migrate`) are skipped: Rails and
 *     gems inject namespaced tasks that never appear in the Rakefile.
 *   - Corrective disclaimers ("this repo does not define `make lint`")
 *     are never flagged.
 */

// ─── Invocation forms ───────────────────────────────────────────────────────

// Prose-prone: only counted inside backticks.
const BACKTICK_ONLY_FORMS = [
  { runner: 'make', re: /\bmake\s+([A-Za-z][\w.-]*)\b/g },
  { runner: 'just', re: /\bjust\s+([A-Za-z][\w.-]*)\b/g },
  { runner: 'task', re: /\btask\s+([A-Za-z][\w:.-]*)\b/g },
  { runner: 'rake', re: /\brake\s+([A-Za-z][\w:.-]*)\b/g },
  { runner: 'composer', re: /\bcomposer\s+([A-Za-z][\w:.-]*)\b/g },
];

// Unambiguous: counted anywhere in a scannable line.
const ANYWHERE_FORMS = [
  { runner: 'rake', re: /\bbundle\s+exec\s+rake\s+([A-Za-z][\w:.-]*)\b/g },
  { runner: 'tox', re: /\btox\s+-e\s+([A-Za-z][\w.-]*)\b/g },
  { runner: 'cargo-make', re: /\bcargo\s+make\s+([A-Za-z][\w.-]*)\b/g },
  { runner: 'make', re: /\bmake\s+-C\s+\S+\s+([A-Za-z][\w.-]*)\b/g },
];

// Built-in verbs that are the runner's own commands, not repo-declared tasks.
const RUNNER_BUILTINS = {
  make: new Set(['all', 'clean', 'install', 'help', 'sure', 'it', 'the', 'a', 'an', 'use', 'changes', 'sense']),
  just: new Set(['help', 'list', 'choose']),
  task: new Set(['help', 'list', 'init']),
  rake: new Set(['default', 'help', 'test', 'stats', 'notes', 'about', 'routes', 'secret', 'middleware']),
  composer: new Set([
    'install', 'update', 'require', 'remove', 'init', 'create-project', 'dump-autoload',
    'dumpautoload', 'validate', 'show', 'outdated', 'why', 'why-not', 'audit', 'licenses',
    'search', 'self-update', 'clear-cache', 'config', 'exec', 'run-script', 'global',
    'check-platform-reqs', 'bump', 'reinstall', 'status', 'suggests', 'fund', 'archive',
    'diagnose', 'depends', 'prohibits', 'browse', 'home', 'help', 'list', 'about', 'version',
  ]),
  tox: new Set([]),
  'cargo-make': new Set(['default', 'help']),
};

// ─── Runner parsers ─────────────────────────────────────────────────────────

function readFirstExisting(ctx, candidates) {
  for (const rel of candidates) {
    if (!fileExists(ctx, rel)) continue;
    const content = ctx.fileContent(rel);
    if (content && content.trim()) return { path: rel, content };
  }
  return null;
}

// Makefile targets: `target:` / `target: deps` at column 0. Excludes variable
// assignments (`VAR := x`), pattern rules (`%.o:`), and special targets
// (`.PHONY:`), while honouring names listed in a .PHONY declaration.
function parseMakeTargets(content) {
  const names = new Set();
  const lines = String(content).split(/\r?\n/);
  for (const line of lines) {
    const phony = line.match(/^\.PHONY\s*:\s*(.+)$/);
    if (phony) {
      for (const name of phony[1].split(/\s+/)) {
        if (name && !name.startsWith('$')) names.add(name);
      }
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_][\w.-]*)\s*:{1,2}(?!=)\s*(?:[^=]|$)/);
    if (m) names.add(m[1]);
  }
  return names;
}

// justfile recipes: `name:` or `name arg="default":` at column 0.
function parseJustRecipes(content) {
  const names = new Set();
  for (const line of String(content).split(/\r?\n/)) {
    if (/^\s/.test(line)) continue;
    const m = line.match(/^@?([A-Za-z0-9_][\w-]*)\s*(?:[^:=]*)?:(?!=)/);
    if (m) names.add(m[1]);
  }
  return names;
}

// Taskfile.yml: keys nested exactly one level under a top-level `tasks:`.
function parseTaskfileTasks(content) {
  const names = new Set();
  const lines = String(content).split(/\r?\n/);
  let inTasks = false;
  let indent = null;
  for (const line of lines) {
    if (/^tasks\s*:/.test(line)) { inTasks = true; indent = null; continue; }
    if (!inTasks) continue;
    if (/^\S/.test(line)) { inTasks = false; continue; }
    const m = line.match(/^(\s+)([A-Za-z0-9_][\w:.-]*)\s*:/);
    if (!m) continue;
    if (indent === null) indent = m[1].length;
    if (m[1].length === indent) names.add(m[2]);
  }
  return names;
}

function parseComposerScripts(content) {
  try {
    const json = JSON.parse(content);
    const scripts = json && json.scripts && typeof json.scripts === 'object' ? json.scripts : {};
    return new Set(Object.keys(scripts));
  } catch {
    return null;
  }
}

// Rake tasks declared in the Rakefile and any lib/tasks/*.rake file.
function parseRakeTasks(content) {
  const names = new Set();
  const re = /\btask\s+:?["']?([A-Za-z0-9_][\w-]*)["']?/g;
  let m;
  while ((m = re.exec(String(content))) !== null) names.add(m[1]);
  return names;
}

// tox environments: `[testenv:NAME]`, plus envlist entries.
function parseToxEnvs(content) {
  const names = new Set();
  const text = String(content);
  let m;
  const sectionRe = /^\[testenv:([^\]]+)\]/gm;
  while ((m = sectionRe.exec(text)) !== null) names.add(m[1].trim());
  const envlist = text.match(/^envlist\s*=\s*([\s\S]*?)(?=^\S|\Z)/m);
  if (envlist) {
    for (const raw of envlist[1].split(/[,\n]/)) {
      const name = raw.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

// cargo-make tasks: `[tasks.NAME]`.
function parseCargoMakeTasks(content) {
  const names = new Set();
  const re = /^\[tasks\.([A-Za-z0-9_][\w-]*)\]/gm;
  let m;
  while ((m = re.exec(String(content))) !== null) names.add(m[1]);
  return names;
}

const RUNNERS = {
  make: {
    label: 'Makefile',
    files: ['Makefile', 'makefile', 'GNUmakefile'],
    parse: parseMakeTargets,
    describe: (name, file) => `\`make ${name}\` is not a target in ${file}`,
  },
  just: {
    label: 'justfile',
    files: ['justfile', 'Justfile', '.justfile'],
    parse: parseJustRecipes,
    describe: (name, file) => `\`just ${name}\` is not a recipe in ${file}`,
  },
  task: {
    label: 'Taskfile',
    files: ['Taskfile.yml', 'Taskfile.yaml', 'taskfile.yml', 'taskfile.yaml'],
    parse: parseTaskfileTasks,
    describe: (name, file) => `\`task ${name}\` is not declared under \`tasks:\` in ${file}`,
  },
  composer: {
    label: 'composer.json',
    files: ['composer.json'],
    parse: parseComposerScripts,
    describe: (name, file) => `\`composer ${name}\` is not defined in \`scripts\` in ${file}`,
  },
  rake: {
    label: 'Rakefile',
    files: ['Rakefile', 'rakefile', 'Rakefile.rb'],
    parse: parseRakeTasks,
    extraGlobDir: 'lib/tasks',
    describe: (name, file) => `\`rake ${name}\` is not declared in ${file} (or lib/tasks/*.rake)`,
  },
  tox: {
    label: 'tox.ini',
    files: ['tox.ini'],
    parse: parseToxEnvs,
    describe: (name, file) => `\`tox -e ${name}\` is not a \`[testenv:${name}]\` section in ${file}`,
  },
  'cargo-make': {
    label: 'Makefile.toml',
    files: ['Makefile.toml'],
    parse: parseCargoMakeTasks,
    describe: (name, file) => `\`cargo make ${name}\` is not a \`[tasks.${name}]\` entry in ${file}`,
  },
};

function loadRunners(ctx) {
  if (ctx.__nerviqTaskRunners !== undefined) return ctx.__nerviqTaskRunners;

  const loaded = {};
  for (const [runner, spec] of Object.entries(RUNNERS)) {
    const found = readFirstExisting(ctx, spec.files);
    if (!found) continue;
    let names = spec.parse(found.content);
    if (names === null) continue; // unparseable (e.g. malformed JSON) — stay silent
    if (spec.extraGlobDir && typeof ctx.dirFiles === 'function') {
      let extra = [];
      try { extra = ctx.dirFiles(spec.extraGlobDir) || []; } catch { extra = []; }
      for (const rel of extra) {
        if (!/\.rake$/i.test(rel)) continue;
        const full = rel.includes('/') ? rel : `${spec.extraGlobDir}/${rel}`;
        const body = ctx.fileContent(full);
        if (!body) continue;
        for (const name of spec.parse(body)) names.add(name);
      }
    }
    loaded[runner] = { names, file: found.path, describe: spec.describe };
  }

  ctx.__nerviqTaskRunners = loaded;
  return loaded;
}

// ─── Scanning ───────────────────────────────────────────────────────────────

function isInsideBacktickSpan(text, index) {
  let count = 0;
  for (let i = 0; i < index; i++) {
    if (text[i] === '`') count += 1;
  }
  return count % 2 === 1;
}

const DISCLAIMER_RE = /\b(?:do(?:es)?\s+not|doesn['’]t|don['’]t)\s+(?:define|have|exist)/i;
const TASK_MENTION_RE = /`(?:make|just|task|rake|composer|tox\s+-e|cargo\s+make|bundle\s+exec\s+rake)\s+([A-Za-z][\w:.-]*)`/g;

function collectDisclaimedTasks(content) {
  const lines = String(content || '').split(/\r?\n/);
  const disclaimed = new Set();
  for (let i = 0; i < lines.length; i++) {
    // The disclaimer must START on this line (it may wrap onto the next:
    // "...the Makefile does\nNOT define `make bench`..."). Accepting a
    // disclaimer that starts on line i+1 would let it silently swallow a
    // genuine finding on line i — a false negative in the one pattern whose
    // entire value is not missing things.
    const window = i + 1 < lines.length ? `${lines[i]} ${lines[i + 1]}` : lines[i];
    const disclaimerAt = window.search(DISCLAIMER_RE);
    if (disclaimerAt === -1 || disclaimerAt > lines[i].length) continue;
    let match;
    TASK_MENTION_RE.lastIndex = 0;
    while ((match = TASK_MENTION_RE.exec(window)) !== null) disclaimed.add(match[1]);
  }
  return disclaimed;
}

function collectInvocations(text) {
  const found = [];
  for (const { runner, re } of ANYWHERE_FORMS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) found.push({ runner, name: m[1], index: m.index });
  }
  for (const { runner, re } of BACKTICK_ONLY_FORMS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!isInsideBacktickSpan(text, m.index)) continue;
      // `bundle exec rake x` already captured by the anywhere form.
      if (runner === 'rake' && /bundle\s+exec\s+$/.test(text.slice(0, m.index))) continue;
      found.push({ runner, name: m[1], index: m.index });
    }
  }
  return found;
}

module.exports = {
  key: 'agent-config-task-not-in-runner',
  name: 'Agent config references a task that the repo runner does not define',
  severity: 'high',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  owaspTags: ['agentic-top-10:tool-instruction-integrity'],
  run(ctx) {
    const runners = loadRunners(ctx);
    if (Object.keys(runners).length === 0) return [];

    const findings = [];
    const seen = new Set();

    for (const entry of getAgentConfigEntries(ctx)) {
      const disclaimed = collectDisclaimedTasks(entry.content);
      for (const { lineNumber, text } of getScannableLines(entry.content)) {
        if (DISCLAIMER_RE.test(text)) continue;
        for (const { runner, name } of collectInvocations(text)) {
          const loaded = runners[runner];
          if (!loaded) continue;
          if (!name) continue;
          // Namespaced Ruby/Taskfile names come from gems and includes that
          // never appear in the repo's own runner file.
          if (name.includes(':')) continue;
          const builtins = RUNNER_BUILTINS[runner];
          if (builtins && builtins.has(name.toLowerCase())) continue;
          if (loaded.names.has(name)) continue;
          if (disclaimed.has(name)) continue;

          const dedupeKey = `${entry.path}|${runner}|${name}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          findings.push({
            file: entry.path,
            line: lineNumber,
            fix: `${entry.path} tells the agent to run a task that does not exist: ${loaded.describe(name, loaded.file)}. Either declare the task in ${loaded.file}, or rewrite the agent guidance to match what the repo actually provides.`,
          });
        }
      }
    }

    return findings;
  },
};
