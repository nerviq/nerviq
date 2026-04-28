#!/usr/bin/env node
/**
 * REL-01: Release announcement automation.
 *
 * Generates the markdown body for a GitHub Release announcement from the
 * CHANGELOG entry of the given version. Honors the TRUTH-03 evidence-tier
 * tags ([Tested] / [Measured] / [Reported] / [Aspirational]) so the
 * announcement matches the public-truth surface.
 *
 * Usage:
 *   node tools/announce-release.js [version]
 *
 * Default version: package.json's `version` field.
 *
 * Output: prints the markdown body to stdout. Pipe into:
 *   gh release create v1.30.0 --notes "$(node tools/announce-release.js 1.30.0)"
 *
 * Exit codes:
 *   0 — success
 *   1 — version not found in CHANGELOG.md
 *   2 — CHANGELOG.md unreadable
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CHANGELOG_PATH = path.join(REPO_ROOT, 'CHANGELOG.md');
const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json');

function readVersion() {
  return JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8')).version;
}

function extractChangelogEntry(version) {
  const text = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  // Match `## [VERSION]` (Keep-a-Changelog style)
  const re = new RegExp(
    `^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|^# Changelog|\\Z)`,
    'm',
  );
  const m = text.match(re);
  if (!m) return null;
  return m[1].trim();
}

function countEvidenceTiers(body) {
  const counts = { Tested: 0, Measured: 0, Reported: 0, Aspirational: 0 };
  const re = /`\[(Tested|Measured|Reported|Aspirational)\]`/g;
  let match;
  while ((match = re.exec(body)) !== null) {
    counts[match[1]] = (counts[match[1]] || 0) + 1;
  }
  return counts;
}

function buildAnnouncement(version, body) {
  const tiers = countEvidenceTiers(body);
  const total = tiers.Tested + tiers.Measured + tiers.Reported + tiers.Aspirational;
  const date = new Date().toISOString().split('T')[0];

  const tierLine =
    total > 0
      ? `**Evidence tiers in this release:** ${tiers.Tested} \`[Tested]\` · ${tiers.Measured} \`[Measured]\` · ${tiers.Reported} \`[Reported]\` · ${tiers.Aspirational} \`[Aspirational]\``
      : '_(No evidence-tier tags in this release. Untagged entries are treated as [Tested] per CHANGELOG header policy.)_';

  return `# @nerviq/cli v${version}

Released ${date}.

${tierLine}

---

${body}

---

**Install:** \`npm install @nerviq/cli@${version}\` or \`npx @nerviq/cli@${version} audit\`

**Full CHANGELOG:** [\`CHANGELOG.md\`](https://github.com/nerviq/nerviq/blob/main/CHANGELOG.md)

**Diff vs previous:** [compare on GitHub](https://github.com/nerviq/nerviq/compare/v${version})

---

_Per [TRUTH-03](https://github.com/DnaFin/nerviq-research/blob/main/research/nerviq-operational-plan-2026-Q2.md) (Continuous Governance positioning, POS-05): every entry is tagged with explicit evidence tier so the buyer knows how strongly we stand behind each claim. Untagged historical entries are [Tested] by default._`;
}

function main() {
  const version = process.argv[2] || readVersion();
  let body;
  try {
    body = extractChangelogEntry(version);
  } catch (e) {
    process.stderr.write(`error: cannot read CHANGELOG.md: ${e.message}\n`);
    process.exit(2);
  }
  if (!body) {
    process.stderr.write(`error: no CHANGELOG entry for v${version}\n`);
    process.stderr.write(`hint: header must be exactly "## [${version}] - YYYY-MM-DD"\n`);
    process.exit(1);
  }
  process.stdout.write(buildAnnouncement(version, body) + '\n');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { extractChangelogEntry, countEvidenceTiers, buildAnnouncement };
