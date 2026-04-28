#!/usr/bin/env node
/**
 * AI-10: Governance-as-dependency postinstall hint.
 *
 * Runs once after `npm install @nerviq/cli`. The hint is short, opt-out,
 * and does NOT execute audit / write files / phone home. Just prints a
 * 4-line "next steps" hint so the user knows what to run next without
 * reading the full README.
 *
 * Opt out via NERVIQ_POSTINSTALL_QUIET=1 or CI=true (auto-detected; CI
 * environments shouldn't see human-facing hints during npm install).
 *
 * Per the operational plan AI-10 spec: this is the "governance-as-
 * dependency" pattern — when the package becomes a project dependency,
 * the user gets a low-friction nudge into the first useful command.
 */

'use strict';

// Suppress in CI / non-TTY / explicit opt-out.
if (
  process.env.CI === 'true' ||
  process.env.NERVIQ_POSTINSTALL_QUIET === '1' ||
  process.env.npm_config_loglevel === 'silent' ||
  !process.stdout.isTTY
) {
  process.exit(0);
}

// Suppress when this package is being installed as a transitive dep
// (npm sets npm_package_name to the parent if we're being installed
// as a dependency of something else; only run when we ARE the root).
if (process.env.npm_package_name && process.env.npm_package_name !== '@nerviq/cli') {
  // We're a transitive dep — don't print.
  process.exit(0);
}

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  cyan: '\x1b[36m', green: '\x1b[32m',
};

const lines = [
  '',
  `${c.bold}  Nerviq installed.${c.reset}  Cross-platform configuration governance for AI coding agents.`,
  '',
  `  Quick start:`,
  `    ${c.cyan}npx nerviq audit${c.reset}                  ${c.dim}# score the current repo + headline stale-references${c.reset}`,
  `    ${c.cyan}npx nerviq setup --auto${c.reset}           ${c.dim}# bootstrap a starter agent config (rollback included)${c.reset}`,
  `    ${c.cyan}npx nerviq harmony-audit${c.reset}          ${c.dim}# cross-platform drift check (only relevant if 2+ platforms)${c.reset}`,
  '',
  `  ${c.dim}Docs: https://nerviq.net/docs   ·   For agents: https://nerviq.net/docs/for-agents${c.reset}`,
  `  ${c.dim}Suppress this hint: NERVIQ_POSTINSTALL_QUIET=1${c.reset}`,
  '',
];

for (const line of lines) {
  process.stdout.write(line + '\n');
}
