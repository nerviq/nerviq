'use strict';

const { buildFinding, SHALLOW_RISK_BANNER, SHALLOW_RISK_BANNER_LINES } = require('./shared');

const patterns = [
  require('./patterns/agent-config-missing-file'),
  require('./patterns/agent-config-stack-contradiction'),
  require('./patterns/agent-config-cross-platform-drift'),
  require('./patterns/mcp-server-no-allowlist'),
  require('./patterns/hook-script-missing'),
  require('./patterns/agent-config-secret-literal'),
  require('./patterns/agent-config-deprecated-keys'),
  require('./patterns/agent-config-dangerous-autoapprove'),
  // BUG-04: stale-doc detection (added 2026-04-29)
  require('./patterns/agent-config-script-not-in-package-json'),
  require('./patterns/agent-config-framework-version-mismatch'),
];

// BUG-03: extract the path that a finding "points at" so we can collapse
// multiple findings that reference the same target across different source
// files. The user-lab found 17 hints on the site repo where most were
// duplicate missing-file findings pointing to the same target path through
// different agent docs.
function extractTargetPathFromFix(fixText) {
  if (!fixText) return null;
  // Most patterns include the target path inside backticks: `path/to/file`.
  // Take the first backticked token that looks like a relative path.
  const m = fixText.match(/`([^`\s]+)`/);
  if (!m) return null;
  const candidate = m[1];
  // Filter out obvious non-paths (commands, package names, version strings).
  if (/^npm\b|^pnpm\b|^yarn\b|^bun\b/.test(candidate)) return null;
  if (/^scripts\./.test(candidate)) return null;
  if (!/[\/.]/.test(candidate)) return null; // need at least a / or .
  return candidate;
}

function runShallowRisk(ctx) {
  if (!ctx || process.env.NERVIQ_SHALLOW_RISK === 'off') {
    return [];
  }

  const findings = [];
  const seen = new Set();
  // BUG-03: per-target dedupe map. When multiple findings of the same key
  // point at the same canonical target, collapse them into one and record
  // the list of source files in `sources`.
  const byTarget = new Map();

  for (const pattern of patterns) {
    let emitted = [];
    try {
      const next = pattern.run(ctx);
      emitted = Array.isArray(next) ? next : [];
    } catch {
      emitted = [];
    }

    for (const finding of emitted) {
      const normalized = buildFinding(pattern, ctx, finding || {});
      const exactDedupeKey = [
        normalized.key,
        normalized.file || '',
        normalized.line || '',
        normalized.fix || '',
      ].join('|');

      if (seen.has(exactDedupeKey)) continue;
      seen.add(exactDedupeKey);

      // BUG-03: target-aware dedupe — collapse same-target findings.
      // Only applies to keys that frequently fire on the same target through
      // multiple agent docs (missing-file is the dominant offender per the
      // user-lab study). For other patterns, target-dedupe would mask real
      // distinct findings, so we keep them at exact-dedupe granularity.
      const eligibleForTargetDedupe = new Set([
        'agent-config-missing-file',
        'hook-script-missing',
        'agent-config-script-not-in-package-json',
      ]).has(normalized.key);

      if (eligibleForTargetDedupe) {
        const target = extractTargetPathFromFix(normalized.fix);
        if (target) {
          const targetKey = `${normalized.key}|target:${target}`;
          if (byTarget.has(targetKey)) {
            const existing = byTarget.get(targetKey);
            existing.sources = existing.sources || [{ file: existing.file, line: existing.line }];
            const sourcePresent = existing.sources.some(
              (s) => s.file === normalized.file && s.line === normalized.line,
            );
            if (!sourcePresent) {
              existing.sources.push({ file: normalized.file, line: normalized.line });
            }
            continue;
          }
          byTarget.set(targetKey, normalized);
        }
      }

      findings.push(normalized);
    }
  }

  return findings;
}

module.exports = {
  patterns,
  runShallowRisk,
  SHALLOW_RISK_BANNER,
  SHALLOW_RISK_BANNER_LINES,
};
