'use strict';

const fs = require('fs');
const path = require('path');
const {
  SHALLOW_RISK_DOC_URL,
  fileExists,
  getRepoFileList,
  globToRegExp,
  parseFrontmatter,
} = require('../shared');

/**
 * SILENT-01 — configuration that exists but is never loaded.
 *
 * The 2026-07-29 session found the same failure shape four times in four
 * different systems: a broken sync script, five hooks pointing at files
 * that do not exist, a hook-event list covering 5 of 30+ events, and a
 * redirect-following sweep that reported 29 dead URLs as healthy. In every
 * case **absence of signal was read as absence of problem**.
 *
 * Agent configuration fails the same way, and worse: it fails *quietly and
 * by design*. A rules file the platform ignores does not warn you. A
 * `paths:` glob that matches nothing does not warn you. An AGENTS.md that
 * Claude Code never reads does not warn you. The repo looks configured,
 * the agent behaves as if it is not, and nothing anywhere disagrees.
 *
 * Every detector below answers one question: *is this file actually
 * loaded by the platform it was written for?* Each is verifiable by hand
 * in under a minute, and each returns nothing rather than guessing when
 * the evidence is ambiguous.
 */

// ─── 1. AGENTS.md that Claude Code never reads ──────────────────────────────
//
// Verified 2026-07-29 at https://code.claude.com/docs/en/memory:
// "Claude Code reads CLAUDE.md, not AGENTS.md." The documented bridges are
// an `@AGENTS.md` import inside CLAUDE.md, or a symlink. With AGENTS.md in
// 60k+ public repos, a repo that has both files and no bridge is telling
// every agent except Claude what to do.

function claudeIsConfigured(ctx) {
  return fileExists(ctx, 'CLAUDE.md')
    || fileExists(ctx, '.claude/CLAUDE.md')
    || ctx.hasDir('.claude');
}

function claudeMdPath(ctx) {
  if (fileExists(ctx, 'CLAUDE.md')) return 'CLAUDE.md';
  if (fileExists(ctx, '.claude/CLAUDE.md')) return '.claude/CLAUDE.md';
  return null;
}

function isSymlinkTo(ctx, relPath, targetBasename) {
  try {
    const full = path.join(ctx.dir, relPath);
    const stat = fs.lstatSync(full);
    if (!stat.isSymbolicLink()) return false;
    return path.basename(fs.readlinkSync(full)).toLowerCase() === targetBasename.toLowerCase();
  } catch {
    return false;
  }
}

function detectAgentsMdNotLoaded(ctx, findings) {
  if (!fileExists(ctx, 'AGENTS.md')) return;
  if (!claudeIsConfigured(ctx)) return; // no Claude surface — nothing is being ignored

  const claudeFile = claudeMdPath(ctx);

  // A repo with a .claude/ directory but no CLAUDE.md at all: Claude Code
  // reads no project instructions even though AGENTS.md is sitting there.
  if (!claudeFile) {
    findings.push({
      file: 'AGENTS.md',
      line: 1,
      severity: 'high',
      fix: 'AGENTS.md exists and this repo is set up for Claude Code (`.claude/`), but there is no CLAUDE.md. Claude Code reads CLAUDE.md, not AGENTS.md, so none of these instructions reach it. Add a CLAUDE.md containing `@AGENTS.md` (one line) so both toolchains read the same file.',
    });
    return;
  }

  if (isSymlinkTo(ctx, claudeFile, 'AGENTS.md')) return;

  const content = ctx.fileContent(claudeFile) || '';
  // The documented import form. Backticked mentions are explicitly NOT
  // imports — the docs call that out — so a doc that merely talks about
  // `@AGENTS.md` still counts as not importing it.
  const withoutCode = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  if (/(^|\s)@\.?\/?AGENTS\.md\b/m.test(withoutCode)) return;

  // Nothing is lost when AGENTS.md carries nothing. Marker files and
  // repos whose AGENTS.md is only a nerviq-managed block have no
  // instructions to lose, and reporting them is noise.
  const agentsRaw = ctx.fileContent('AGENTS.md') || '';
  const agentsOwnContent = agentsRaw
    .replace(/<!--\s*nerviq:managed:start\s*-->[\s\S]*?<!--\s*nerviq:managed:end\s*-->/g, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^<!--/.test(l.trim()));
  if (agentsOwnContent.length < 8) return;

  // A deliberate per-platform split is not a silent failure. When AGENTS.md
  // announces itself as the platform-native counterpart of CLAUDE.md — the
  // shape this very repo uses — nothing is being lost by accident, and the
  // risk of the two drifting apart is Harmony's job, not this pattern's.
  const agentsHead = agentsRaw.split(/\r?\n/).slice(0, 25).join('\n');
  const declaresCompanion = /\b(companion|counterpart|sibling|mirror(s)?|equivalent)\b[^.\n]{0,80}CLAUDE\.md/i.test(agentsHead)
    || /CLAUDE\.md[^.\n]{0,80}\b(companion|counterpart|sibling)\b/i.test(agentsHead);
  const claudeIsSubstantive = content.split(/\r?\n/).filter((l) => l.trim()).length >= 25;

  if (declaresCompanion && claudeIsSubstantive) return;

  findings.push({
    file: claudeFile,
    line: 1,
    // When CLAUDE.md is itself substantive, Claude still has instructions —
    // it just never sees AGENTS.md's. When CLAUDE.md is a stub, Claude is
    // effectively running with no project instructions at all.
    severity: claudeIsSubstantive ? 'medium' : 'high',
    fix: claudeIsSubstantive
      ? `Both AGENTS.md and ${claudeFile} exist, but ${claudeFile} never imports AGENTS.md and AGENTS.md does not declare itself a per-platform companion. Claude Code reads CLAUDE.md and does not read AGENTS.md, so anything that lives only in AGENTS.md never reaches Claude while Codex, Copilot and Cursor all follow it. Add \`@AGENTS.md\` on its own line in ${claudeFile}, or say explicitly in AGENTS.md that it is the Codex-native companion to CLAUDE.md.`
      : `AGENTS.md carries this repo's agent instructions, but ${claudeFile} is a stub and never imports it. Claude Code reads CLAUDE.md and does not read AGENTS.md, so Claude is running with effectively no project instructions. Add \`@AGENTS.md\` on its own line in ${claudeFile} (or symlink the two files).`,
  });
}

// ─── 2. Rule files the platform silently ignores ────────────────────────────
//
// Verified 2026-07-29 at https://cursor.com/docs/rules: rules live in
// `.cursor/rules/*.mdc` and "a plain .md file in .cursor/rules is ignored"
// without frontmatter. `.cursorrules` is no longer documented as a
// supported format at all.

function detectIgnoredCursorRules(ctx, findings) {
  if (!ctx.hasDir('.cursor/rules')) return;

  const walk = (relDir) => {
    for (const entry of ctx.dirFiles(relDir)) {
      const rel = `${relDir}/${entry}`;
      if (ctx.hasDir(rel)) { walk(rel); continue; }
      if (!/\.(md|mdc)$/i.test(entry)) continue;
      const content = ctx.fileContent(rel);
      if (content === null) continue;
      const hasFrontmatter = parseFrontmatter(content) !== null;
      if (/\.mdc$/i.test(entry)) {
        if (hasFrontmatter) continue;
        findings.push({
          file: rel,
          line: 1,
          severity: 'high',
          fix: `${rel} has no YAML frontmatter. Cursor requires \`description\` / \`globs\` / \`alwaysApply\` frontmatter on .mdc rules; without it the rule is loaded by nothing. Add frontmatter, or move the content into AGENTS.md.`,
        });
        continue;
      }
      // Plain .md inside .cursor/rules — ignored outright.
      findings.push({
        file: rel,
        line: 1,
        severity: 'high',
        fix: `${rel} is a plain .md file inside .cursor/rules/. Cursor only loads .mdc rule files with frontmatter, so this file is silently ignored. Rename it to .mdc and add \`description\`/\`globs\`/\`alwaysApply\` frontmatter.`,
      });
    }
  };
  walk('.cursor/rules');
}

function detectLegacyCursorrules(ctx, findings) {
  if (!fileExists(ctx, '.cursorrules')) return;
  // Only worth reporting when the repo has moved on to the documented
  // format — otherwise this is a legacy repo doing legacy things, and
  // telling it the file is dead is a guess we can't support.
  if (!ctx.hasDir('.cursor/rules')) return;
  findings.push({
    file: '.cursorrules',
    line: 1,
    severity: 'medium',
    fix: '.cursorrules is no longer documented as a supported Cursor format (verified 2026-07-29), and this repo already uses the current `.cursor/rules/` directory. Anything that lives only in .cursorrules is likely reaching no agent — fold it into a .mdc rule or AGENTS.md, then delete the file.',
  });
}

// ─── 3. Path-scoped rules whose globs match nothing ─────────────────────────
//
// A `paths:` rule only enters context when Claude reads a matching file.
// A glob that matches no file in the repo is a rule that will never fire —
// and, being scoped, it never appears in `/context` either.

function detectDeadRuleGlobs(ctx, findings) {
  const ruleDirs = ['.claude/rules', '.cursor/rules'];
  const repoFiles = getRepoFileList(ctx);
  if (repoFiles.length === 0) return;

  for (const dir of ruleDirs) {
    if (!ctx.hasDir(dir)) continue;
    const walk = (relDir) => {
      for (const entry of ctx.dirFiles(relDir)) {
        const rel = `${relDir}/${entry}`;
        if (ctx.hasDir(rel)) { walk(rel); continue; }
        if (!/\.(md|mdc)$/i.test(entry)) continue;
        const fm = parseFrontmatter(ctx.fileContent(rel) || '');
        if (!fm) continue;
        const raw = fm.paths || fm.globs;
        if (!raw) continue;
        const globs = (Array.isArray(raw) ? raw : String(raw).split(',')).map((g) => g.trim()).filter(Boolean);
        if (globs.length === 0) continue;

        const dead = [];
        for (const glob of globs) {
          const re = globToRegExp(glob);
          if (!re) continue; // cannot evaluate — stay silent rather than guess
          if (!repoFiles.some((f) => re.test(f))) dead.push(glob);
        }
        // Only report when EVERY evaluable glob is dead. A rule with one
        // live pattern still fires, and reporting it would be noise.
        if (dead.length > 0 && dead.length === globs.filter((g) => globToRegExp(g)).length) {
          findings.push({
            file: rel,
            line: 1,
            severity: 'medium',
            fix: `${rel} is scoped to ${dead.map((g) => `\`${g}\``).join(', ')}, and no file in this repo matches. A path-scoped rule only loads when the agent opens a matching file, so this rule can never fire — and being scoped, it never shows up in \`/context\` either. Fix the glob or delete the rule.`,
          });
        }
      }
    };
    walk(dir);
  }
}

// ─── 4. Hooks declared under an event the platform does not define ──────────
//
// Verified 2026-07-29 at https://code.claude.com/docs/en/hooks. A typo or a
// retired event name produces a config that parses cleanly and runs never.

const KNOWN_HOOK_EVENTS = new Set([
  'SessionStart', 'Setup', 'SessionEnd',
  'UserPromptSubmit', 'UserPromptExpansion', 'Stop', 'StopFailure',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch',
  'PermissionRequest', 'PermissionDenied',
  'SubagentStart', 'SubagentStop', 'TeammateIdle',
  'TaskCreated', 'TaskCompleted',
  'CwdChanged', 'DirectoryAdded', 'FileChanged', 'InstructionsLoaded',
  'ConfigChange', 'WorktreeCreate', 'WorktreeRemove',
  'Elicitation', 'ElicitationResult',
  'PreCompact', 'PostCompact',
  'Notification', 'MessageDisplay',
]);

function detectUnknownHookEvents(ctx, findings) {
  for (const file of ['.claude/settings.json', '.claude/settings.local.json']) {
    const config = ctx.jsonFile(file);
    if (!config || !config.hooks || typeof config.hooks !== 'object') continue;
    for (const eventName of Object.keys(config.hooks)) {
      if (KNOWN_HOOK_EVENTS.has(eventName)) continue;
      // Case-only mistakes are the common shape and worth naming precisely.
      const nearest = [...KNOWN_HOOK_EVENTS].find((e) => e.toLowerCase() === eventName.toLowerCase());
      const hint = nearest ? ` Did you mean \`${nearest}\`?` : '';
      findings.push({
        file,
        line: ctx.lineNumber(file, new RegExp(`"${eventName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)) || 1,
        severity: 'high',
        fix: `${file} declares hooks under \`${eventName}\`, which is not a Claude Code hook event (verified 2026-07-29).${hint} The config parses cleanly and the hooks never run.`,
      });
    }
  }
}

// ─── 5. Config files the platform cannot read correctly ─────────────────────
//
// Found by dogfooding on 2026-07-29 against nerviq-research's own AGENTS.md.
// Two shapes, both silent:
//   - the file is UTF-16, and agent toolchains read instruction files as
//     UTF-8, so it arrives as mojibake or as one unreadable line;
//   - the file is already UTF-8 but riddled with U+FFFD replacement
//     characters, meaning a lossy conversion happened earlier and the
//     original bytes are gone.
// Neither raises an error anywhere. The instructions simply have no effect.
//
// This is not an exotic edge case on Windows — it is the DEFAULT outcome of
// the most natural way to create an agent config file from a terminal.
// Reproduced 2026-07-29 on PowerShell 5.1.26100.8972 (the `powershell.exe`
// shipped with Windows 11):
//
//     PS> echo "AGENTS_MARKER=true" > AGENTS.md
//     → 42 bytes, first bytes FF FE (UTF-16LE BOM), 20 NUL bytes
//
// A 19-character instruction becomes a 42-byte file that every agent reads
// as garbage. PowerShell 7+ defaults to UTF-8, but 5.1 is still what
// `powershell.exe` resolves to. The corrupted file that prompted this
// detector had exactly that byte signature, created by exactly that command
// in an April 2026 experiment script.

const ENCODING_CANDIDATES = [
  'AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', 'GEMINI.md',
  '.cursorrules', '.windsurfrules', '.github/copilot-instructions.md',
];

function detectUnparseableEncoding(ctx, findings) {
  for (const rel of ENCODING_CANDIDATES) {
    let buf;
    try {
      const full = path.join(ctx.dir, rel);
      if (!fs.existsSync(full)) continue;
      buf = fs.readFileSync(full);
    } catch {
      continue;
    }
    if (buf.length < 2) continue;

    // A NUL byte anywhere is the decisive signal: UTF-8 text never contains
    // one, and UTF-16 is half NULs. Checking the BOM alone is not enough —
    // the file that prompted this check is UTF-16LE whose BOM had itself
    // been mangled into replacement characters, so it looked like UTF-8
    // from the first two bytes and was still unreadable from the third.
    let nulCount = 0;
    for (const byte of buf) if (byte === 0x00) nulCount += 1;

    let encoding = null;
    if (buf[0] === 0xFF && buf[1] === 0xFE) encoding = 'UTF-16LE';
    else if (buf[0] === 0xFE && buf[1] === 0xFF) encoding = 'UTF-16BE';
    else if (nulCount > 0) encoding = `UTF-16 or binary (${nulCount} NUL bytes)`;

    if (encoding) {
      findings.push({
        file: rel,
        line: 1,
        severity: 'high',
        fix: `${rel} is encoded as ${encoding}. Agent toolchains read instruction files as UTF-8, so this file arrives as mojibake or as one unreadable line — with no error anywhere. Re-save it as UTF-8 (no BOM). Common cause on Windows: \`echo "..." > ${rel}\` in PowerShell 5.1 writes UTF-16LE by default — use \`Set-Content -Encoding utf8\` or PowerShell 7+.`,
      });
      continue;
    }

    // Already-lossy UTF-8: U+FFFD is EF BF BD. A handful can be legitimate
    // (someone documenting the character); a file that is peppered with
    // them has been through a bad conversion and its content is gone.
    const text = buf.toString('utf8');
    const replacements = (text.match(/�/g) || []).length;
    if (replacements === 0) continue;
    const density = replacements / Math.max(1, text.length);
    if (replacements < 3 || density < 0.002) continue;

    findings.push({
      file: rel,
      line: 1,
      severity: 'high',
      fix: `${rel} contains ${replacements} Unicode replacement characters (U+FFFD). That means the file was converted from another encoding lossily — the original bytes are gone, and agents read the damaged text without any error being raised. Restore the file from history and re-save it as UTF-8.`,
    });
  }
}

module.exports = {
  key: 'agent-config-silently-ignored',
  name: 'Agent config is declared but never loaded',
  severity: 'high',
  layer: 'shallow-risk',
  sourceUrl: SHALLOW_RISK_DOC_URL,
  owaspTags: ['agentic-top-10:tool-instruction-integrity'],
  run(ctx) {
    const findings = [];
    detectAgentsMdNotLoaded(ctx, findings);
    detectIgnoredCursorRules(ctx, findings);
    detectLegacyCursorrules(ctx, findings);
    detectDeadRuleGlobs(ctx, findings);
    detectUnknownHookEvents(ctx, findings);
    detectUnparseableEncoding(ctx, findings);
    return findings;
  },
};
