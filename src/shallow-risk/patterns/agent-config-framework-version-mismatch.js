'use strict';

const {
  SHALLOW_RISK_DOC_URL,
  fileExists,
  getAgentConfigEntries,
  getScannableLines,
} = require('../shared');

// Frameworks we know how to cross-check against package.json. The label is
// what we expect to see in agent docs (case-insensitive); the depKey is the
// npm package name to look up.
//
// Conservative on purpose: we only flag mismatches for frameworks where a
// version bump is meaningful (Next.js / React / Tailwind / Vue / Angular /
// TypeScript / Vite / Express / Fastify / NestJS). Adding noisy frameworks
// here will create FPs.
const FRAMEWORK_DEPS = [
  { label: 'Next.js', altLabels: ['Next', 'NextJS'], depKey: 'next' },
  { label: 'React', altLabels: [], depKey: 'react' },
  { label: 'Tailwind', altLabels: ['Tailwind CSS', 'TailwindCSS'], depKey: 'tailwindcss' },
  { label: 'Vue', altLabels: ['Vue.js', 'VueJS'], depKey: 'vue' },
  { label: 'Angular', altLabels: [], depKey: '@angular/core' },
  { label: 'TypeScript', altLabels: ['TS'], depKey: 'typescript' },
  { label: 'Vite', altLabels: [], depKey: 'vite' },
  { label: 'Express', altLabels: [], depKey: 'express' },
  { label: 'Fastify', altLabels: [], depKey: 'fastify' },
  { label: 'NestJS', altLabels: ['Nest.js', 'Nest'], depKey: '@nestjs/core' },
];

function readPackageDeps(ctx) {
  if (ctx.__nerviqPackageJsonDeps !== undefined) {
    return ctx.__nerviqPackageJsonDeps;
  }
  if (!fileExists(ctx, 'package.json')) {
    ctx.__nerviqPackageJsonDeps = null;
    return null;
  }
  const raw = ctx.fileContent('package.json');
  if (!raw) {
    ctx.__nerviqPackageJsonDeps = null;
    return null;
  }
  try {
    const pkg = JSON.parse(raw);
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
      ...(pkg.optionalDependencies || {}),
    };
    ctx.__nerviqPackageJsonDeps = deps;
    return deps;
  } catch {
    ctx.__nerviqPackageJsonDeps = null;
    return null;
  }
}

function extractMajor(versionRange) {
  if (!versionRange || typeof versionRange !== 'string') return null;
  // Strip leading range operators: ^, ~, >=, >, =, etc.
  const m = versionRange.match(/(\d+)/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

module.exports = {
  key: 'agent-config-framework-version-mismatch',
  name: 'Agent config references stale framework version',
  severity: 'high',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  owaspTags: ['agentic-top-10:tool-instruction-integrity'],
  run(ctx) {
    const deps = readPackageDeps(ctx);
    if (!deps) return [];

    // Build framework lookup with the actual installed major version.
    const installed = [];
    for (const fw of FRAMEWORK_DEPS) {
      const range = deps[fw.depKey];
      if (!range) continue;
      const major = extractMajor(range);
      if (major === null) continue;
      installed.push({ ...fw, range, major });
    }
    if (installed.length === 0) return [];

    const findings = [];
    const seen = new Set();

    for (const entry of getAgentConfigEntries(ctx)) {
      const lines = getScannableLines(entry.content);
      for (const { lineNumber, text } of lines) {
        for (const fw of installed) {
          // Build a regex that matches: "Next.js 15", "Next 16", "next.js v15",
          // "Next.js 15.0.0", "Tailwind 4", etc. We require a version number
          // immediately after the framework label (with optional "v" prefix
          // and optional whitespace).
          const labelAlternatives = [fw.label, ...(fw.altLabels || [])]
            .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');
          const versionRe = new RegExp(`\\b(${labelAlternatives})\\s+v?(\\d+)(?:\\.(\\d+))?(?:\\.(\\d+))?\\b`, 'gi');

          let match;
          while ((match = versionRe.exec(text)) !== null) {
            const claimedMajor = parseInt(match[2], 10);
            if (!Number.isFinite(claimedMajor)) continue;
            if (claimedMajor === fw.major) continue;

            // Skip historical references (e.g., "we migrated from Next 14 to
            // Next 16" — both versions appear, only the lower one is stale,
            // but flagging would cause FPs on legitimate migration notes).
            // Heuristic: if the same line mentions the correct major number,
            // assume migration context and skip.
            if (new RegExp(`\\b${fw.major}\\b`).test(text)) continue;
            // Skip lines explicitly noting the mismatch as a corrective note.
            if (/\b(?:was|previously|used to|formerly|before)\b/i.test(text)) continue;
            if (/\bdoes\s+(?:not|n['’]?t)\b/i.test(text)) continue;

            const dedupeKey = `${entry.path}|${fw.depKey}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            findings.push({
              file: entry.path,
              line: lineNumber,
              fix: `${entry.path} references ${fw.label} ${claimedMajor}, but package.json declares ${fw.depKey}@${fw.range} (major ${fw.major}). Update the agent guidance to match the installed version.`,
            });
          }
        }
      }
    }

    return findings;
  },
};
