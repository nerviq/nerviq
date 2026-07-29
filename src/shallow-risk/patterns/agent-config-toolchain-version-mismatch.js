'use strict';

const {
  SHALLOW_RISK_DOC_URL,
  fileExists,
  getAgentConfigEntries,
  getScannableLines,
} = require('../shared');

/**
 * Non-npm toolchain / framework version staleness.
 *
 * The sibling pattern `agent-config-framework-version-mismatch` reads
 * package.json only, so "CLAUDE.md says Django 4, pyproject says 5" —
 * exactly the same lie, in the second-largest agent-config ecosystem —
 * went undetected. This pattern extends the contract to the manifests
 * that actually declare versions outside the JS world:
 *
 *   go.mod          → Go
 *   Cargo.toml      → Rust edition, rust-version
 *   pyproject.toml  → Python, Django, Flask, FastAPI, SQLAlchemy, Pydantic
 *   requirements.txt→ (same Python frameworks, pinned form)
 *   .python-version → Python
 *   composer.json   → PHP, Laravel, Symfony
 *   Gemfile         → Ruby, Rails
 *   .nvmrc / engines→ Node
 *
 * Precision rules mirror the npm pattern: a claimed version is only a lie
 * when the manifest is unambiguous, the line is not a migration note
 * ("we moved from Django 4 to 5"), and the correct number does not also
 * appear on the same line.
 */

// ─── Manifest readers ───────────────────────────────────────────────────────

function read(ctx, rel) {
  if (!fileExists(ctx, rel)) return null;
  const content = ctx.fileContent(rel);
  return content && content.trim() ? content : null;
}

function parseVersionParts(raw) {
  if (raw === null || raw === undefined) return null;
  const m = String(raw).match(/(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: m[2] === undefined ? null : parseInt(m[2], 10),
  };
}

function pushEntry(list, entry) {
  if (!entry || !entry.expected || !Number.isFinite(entry.expected.major)) return;
  list.push(entry);
}

// TOML-ish scalar lookup: `key = "value"` inside an optional [section].
function tomlValue(content, section, key) {
  const text = String(content);
  const lines = text.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    const sec = line.match(/^\s*\[([^\]]+)\]/);
    if (sec) { current = sec[1].trim(); continue; }
    if (section !== null && current !== section) continue;
    const re = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*=\\s*["']?([^"'\\n#]+)["']?`);
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

const PY_FRAMEWORKS = [
  { label: 'Django', altLabels: [], dep: 'django' },
  { label: 'Flask', altLabels: [], dep: 'flask' },
  { label: 'FastAPI', altLabels: ['Fast API'], dep: 'fastapi' },
  { label: 'SQLAlchemy', altLabels: [], dep: 'sqlalchemy' },
  { label: 'Pydantic', altLabels: [], dep: 'pydantic' },
];

function pythonDepVersion(content, dep) {
  // Matches the dependency in every shape these manifests use:
  //   requirements.txt : django==5.0.1  /  Django~=5.0
  //   pyproject (PEP621): dependencies = ["django>=5.1", ...]
  //   pyproject (poetry): django = "^5.0"
  // The leading boundary accepts line start, quote, bracket or comma so
  // inline arrays are covered, while `django-extensions>=1.0` and
  // `djangorestframework==3.15` still fail (no digits follow the name).
  const re = new RegExp(`(?:^|["'\\[,\\s])${dep}\\s*["']?\\s*(?:=\\s*["'])?\\s*[~^>=<]*\\s*(\\d+(?:\\.\\d+)?)`, 'im');
  const m = String(content).match(re);
  return m ? m[1] : null;
}

function collectExpectedVersions(ctx) {
  if (ctx.__nerviqToolchainVersions !== undefined) return ctx.__nerviqToolchainVersions;

  const out = [];

  // ── Go ────────────────────────────────────────────────────────────────
  const goMod = read(ctx, 'go.mod');
  if (goMod) {
    const m = goMod.match(/^go\s+(\d+)\.(\d+)/m);
    if (m) {
      pushEntry(out, {
        label: 'Go',
        altLabels: ['Golang'],
        caseSensitive: true,
        precision: 'minor',
        expected: { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) },
        sourceFile: 'go.mod',
        sourceValue: `go ${m[1]}.${m[2]}`,
      });
    }
  }

  // ── Rust ──────────────────────────────────────────────────────────────
  const cargo = read(ctx, 'Cargo.toml');
  if (cargo) {
    const edition = tomlValue(cargo, 'package', 'edition');
    if (edition && /^\d{4}$/.test(edition)) {
      pushEntry(out, {
        label: 'Rust edition',
        altLabels: ['edition'],
        precision: 'major',
        expected: { major: parseInt(edition, 10), minor: null },
        sourceFile: 'Cargo.toml',
        sourceValue: `edition = "${edition}"`,
      });
    }
    const rustVersion = tomlValue(cargo, 'package', 'rust-version');
    const parsedRust = parseVersionParts(rustVersion);
    if (parsedRust && parsedRust.minor !== null) {
      pushEntry(out, {
        label: 'Rust',
        altLabels: [],
        caseSensitive: true,
        precision: 'minor',
        expected: parsedRust,
        sourceFile: 'Cargo.toml',
        sourceValue: `rust-version = "${rustVersion}"`,
      });
    }
  }

  // ── Python runtime ────────────────────────────────────────────────────
  const pyproject = read(ctx, 'pyproject.toml');
  const pythonVersionFile = read(ctx, '.python-version');
  let pythonRaw = null;
  let pythonSource = null;
  if (pyproject) {
    const requires = tomlValue(pyproject, 'project', 'requires-python')
      || tomlValue(pyproject, 'tool.poetry.dependencies', 'python');
    if (requires) { pythonRaw = requires; pythonSource = 'pyproject.toml'; }
  }
  if (!pythonRaw && pythonVersionFile) {
    pythonRaw = pythonVersionFile.trim().split(/\r?\n/)[0];
    pythonSource = '.python-version';
  }
  const parsedPython = parseVersionParts(pythonRaw);
  if (parsedPython && parsedPython.minor !== null) {
    pushEntry(out, {
      label: 'Python',
      altLabels: ['py'],
      precision: 'minor',
      expected: parsedPython,
      sourceFile: pythonSource,
      sourceValue: String(pythonRaw).trim(),
    });
  }

  // ── Python frameworks ─────────────────────────────────────────────────
  const requirements = read(ctx, 'requirements.txt');
  const pySources = [
    pyproject ? { name: 'pyproject.toml', content: pyproject } : null,
    requirements ? { name: 'requirements.txt', content: requirements } : null,
  ].filter(Boolean);
  for (const fw of PY_FRAMEWORKS) {
    for (const src of pySources) {
      const raw = pythonDepVersion(src.content, fw.dep);
      const parsed = parseVersionParts(raw);
      if (!parsed) continue;
      pushEntry(out, {
        label: fw.label,
        altLabels: fw.altLabels,
        precision: 'major',
        expected: parsed,
        sourceFile: src.name,
        sourceValue: `${fw.dep} ${raw}`,
      });
      break; // first manifest that declares it wins
    }
  }

  // ── PHP ───────────────────────────────────────────────────────────────
  const composer = read(ctx, 'composer.json');
  if (composer) {
    try {
      const json = JSON.parse(composer);
      const deps = { ...(json.require || {}), ...(json['require-dev'] || {}) };
      const php = parseVersionParts(deps.php);
      if (php && php.minor !== null) {
        pushEntry(out, {
          label: 'PHP',
          altLabels: [],
          precision: 'minor',
          expected: php,
          sourceFile: 'composer.json',
          sourceValue: `php ${deps.php}`,
        });
      }
      const phpFrameworks = [
        { label: 'Laravel', altLabels: [], dep: 'laravel/framework' },
        { label: 'Symfony', altLabels: [], dep: 'symfony/framework-bundle' },
      ];
      for (const fw of phpFrameworks) {
        const parsed = parseVersionParts(deps[fw.dep]);
        if (!parsed) continue;
        pushEntry(out, {
          label: fw.label,
          altLabels: fw.altLabels,
          precision: 'major',
          expected: parsed,
          sourceFile: 'composer.json',
          sourceValue: `${fw.dep} ${deps[fw.dep]}`,
        });
      }
    } catch { /* malformed composer.json — stay silent */ }
  }

  // ── Ruby ──────────────────────────────────────────────────────────────
  const gemfile = read(ctx, 'Gemfile');
  if (gemfile) {
    const rubyDecl = gemfile.match(/^\s*ruby\s+["']([^"']+)["']/m);
    const parsedRuby = parseVersionParts(rubyDecl ? rubyDecl[1] : null);
    if (parsedRuby && parsedRuby.minor !== null) {
      pushEntry(out, {
        label: 'Ruby',
        altLabels: [],
        caseSensitive: true,
        precision: 'minor',
        expected: parsedRuby,
        sourceFile: 'Gemfile',
        sourceValue: `ruby "${rubyDecl[1]}"`,
      });
    }
    const rails = gemfile.match(/^\s*gem\s+["']rails["']\s*,\s*["'][~^>=<\s]*(\d+(?:\.\d+)?)/m);
    const parsedRails = parseVersionParts(rails ? rails[1] : null);
    if (parsedRails) {
      pushEntry(out, {
        label: 'Rails',
        altLabels: ['Ruby on Rails'],
        precision: 'major',
        expected: parsedRails,
        sourceFile: 'Gemfile',
        sourceValue: `gem "rails", "${rails[1]}"`,
      });
    }
  }

  // ── Node runtime ──────────────────────────────────────────────────────
  const nvmrc = read(ctx, '.nvmrc');
  let nodeRaw = nvmrc ? nvmrc.trim().split(/\r?\n/)[0] : null;
  let nodeSource = nvmrc ? '.nvmrc' : null;
  if (!nodeRaw) {
    const pkg = read(ctx, 'package.json');
    if (pkg) {
      try {
        const json = JSON.parse(pkg);
        if (json.engines && json.engines.node) {
          nodeRaw = json.engines.node;
          nodeSource = 'package.json (engines.node)';
        }
      } catch { /* handled by the npm pattern */ }
    }
  }
  const parsedNode = parseVersionParts(nodeRaw);
  if (parsedNode) {
    pushEntry(out, {
      label: 'Node',
      altLabels: ['Node.js', 'NodeJS'],
      precision: 'major',
      expected: parsedNode,
      sourceFile: nodeSource,
      sourceValue: String(nodeRaw).trim(),
    });
  }

  ctx.__nerviqToolchainVersions = out;
  return out;
}

// ─── Scanning ───────────────────────────────────────────────────────────────

// Migration / historical wording is only a reason to stay quiet when it sits
// immediately before the version claim ("we upgraded from Django 4"). Testing
// the whole line kills true positives: "Go 1.21 service. Make sure tests pass
// before you commit." contains `before` and would silently pass.
const MIGRATION_RE = /\b(?:was|were|previously|used to|formerly|prior to|migrat\w*|upgrad\w*|moved|bumped|from)\b/i;
const MIGRATION_LOOKBEHIND_CHARS = 40;
const NEGATION_RE = /\bdoes\s+(?:not|n['’]?t)\b/i;

function buildLabelRegex(entry) {
  const alternatives = [entry.label, ...(entry.altLabels || [])]
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const flags = entry.caseSensitive ? 'g' : 'gi';
  return new RegExp(`\\b(${alternatives})\\s+v?(\\d+)(?:\\.(\\d+))?(?:\\.\\d+)?\\b`, flags);
}

function isMismatch(entry, claimedMajor, claimedMinor) {
  const { major, minor } = entry.expected;
  if (claimedMajor !== major) return true;
  if (entry.precision !== 'minor') return false;
  if (minor === null || claimedMinor === null || claimedMinor === undefined) return false;
  return claimedMinor !== minor;
}

function expectedLabel(entry) {
  const { major, minor } = entry.expected;
  return entry.precision === 'minor' && minor !== null ? `${major}.${minor}` : String(major);
}

module.exports = {
  key: 'agent-config-toolchain-version-mismatch',
  name: 'Agent config references a stale toolchain or framework version',
  severity: 'high',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  owaspTags: ['agentic-top-10:tool-instruction-integrity'],
  run(ctx) {
    const expected = collectExpectedVersions(ctx);
    if (expected.length === 0) return [];

    const findings = [];
    const seen = new Set();

    for (const entry of getAgentConfigEntries(ctx)) {
      for (const { lineNumber, text } of getScannableLines(entry.content)) {
        if (NEGATION_RE.test(text)) continue;
        for (const spec of expected) {
          const re = buildLabelRegex(spec);
          let match;
          while ((match = re.exec(text)) !== null) {
            const claimedMajor = parseInt(match[2], 10);
            const claimedMinor = match[3] === undefined ? null : parseInt(match[3], 10);
            if (!Number.isFinite(claimedMajor)) continue;
            if (!isMismatch(spec, claimedMajor, claimedMinor)) continue;
            const lookbehind = text.slice(Math.max(0, match.index - MIGRATION_LOOKBEHIND_CHARS), match.index);
            if (MIGRATION_RE.test(lookbehind)) continue;
            // The correct version also appears on this line — treat as
            // context ("supports Python 3.9 through 3.12"), not a lie.
            const correct = expectedLabel(spec).replace('.', '\\.');
            if (new RegExp(`\\b${correct}\\b`).test(text)) continue;

            const dedupeKey = `${entry.path}|${spec.label}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            const claimed = claimedMinor === null ? `${claimedMajor}` : `${claimedMajor}.${claimedMinor}`;
            findings.push({
              file: entry.path,
              line: lineNumber,
              fix: `${entry.path} references ${spec.label} ${claimed}, but ${spec.sourceFile} declares ${spec.sourceValue} (${expectedLabel(spec)}). Update the agent guidance to match the version the repo actually uses.`,
            });
          }
        }
      }
    }

    return findings;
  },
};
