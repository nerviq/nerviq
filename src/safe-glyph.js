'use strict';

// MEMO-16: Windows output mojibake fix.
//
// Codex audit (project-domain-audit-2026-04-28.md §Memo §Gap: Windows output)
// flagged that emoji/Unicode glyphs (✅ ❌ 🔴 🟡 🔵 📌 🔔) can render as
// mojibake (`?` or garbled multi-byte sequences) on Windows consoles that
// are not running with UTF-8 codepage 65001. This module returns either
// the original Unicode glyph or an ASCII-safe fallback depending on the
// detected runtime.
//
// Detection (conservative — when uncertain, prefer Unicode since modern
// terminals handle it):
//   - Windows + cmd.exe / older PowerShell often default to cp437/cp1252
//   - Windows Terminal / VS Code terminal / Cygwin / WSL all handle UTF-8
//   - macOS / Linux terminals default to UTF-8
//
// We treat as "unsafe" only when:
//   1. process.platform === 'win32' AND
//   2. NERVIQ_FORCE_UNICODE env is not set AND
//   3. PSModulePath / WT_SESSION absent (the Windows-Terminal markers)
//
// Override: NERVIQ_GLYPH=ascii forces ASCII; NERVIQ_GLYPH=unicode forces
// Unicode. Otherwise fall back to detection.

const FALLBACKS = {
  '✅': '[OK]',
  '❌': '[X]',
  '✓': '[ok]',
  '✗': '[x]',
  '🔴': '[!]',
  '🟡': '[*]',
  '🔵': '[i]',
  '🟢': '[+]',
  '📌': '[*]',
  '🔔': '[!]',
  '⚠️': '[!]',
  '⚙️': '[~]',
  '📏': '[m]',
  '📄': '[d]',
  '📢': '[r]',
  '🔧': '[s]',
  '🔑': '[k]',
  '═': '=',
  '─': '-',
  '│': '|',
  '└': '+',
  '├': '+',
  '─': '-',
  '→': '->',
  '←': '<-',
};

function detectUnicodeSafe() {
  const env = process.env || {};
  if (env.NERVIQ_GLYPH === 'ascii') return false;
  if (env.NERVIQ_GLYPH === 'unicode') return true;

  if (process.platform !== 'win32') return true;

  // Modern Windows terminals set these markers; cmd.exe / older PS do not.
  if (env.WT_SESSION) return true;            // Windows Terminal
  if (env.TERM_PROGRAM === 'vscode') return true; // VS Code integrated terminal
  if (env.TERM && /xterm|cygwin|wsl/i.test(env.TERM)) return true;
  if (env.SHELL && /bash|zsh/i.test(env.SHELL)) return true; // Git Bash / WSL

  // Heuristic for chcp 65001: many CI runners on Windows already set
  // PYTHONIOENCODING to utf-8; treat that as a UTF-8 signal.
  if (env.PYTHONIOENCODING && /utf-?8/i.test(env.PYTHONIOENCODING)) return true;

  // Default for Windows without those markers: assume legacy console.
  return false;
}

const _UNICODE_SAFE = detectUnicodeSafe();

function glyph(symbol) {
  if (_UNICODE_SAFE) return symbol;
  return FALLBACKS[symbol] !== undefined ? FALLBACKS[symbol] : symbol;
}

function safeText(text) {
  if (_UNICODE_SAFE) return text;
  let out = String(text);
  for (const [unicode, ascii] of Object.entries(FALLBACKS)) {
    if (out.includes(unicode)) {
      out = out.split(unicode).join(ascii);
    }
  }
  return out;
}

module.exports = {
  glyph,
  safeText,
  isUnicodeSafe: () => _UNICODE_SAFE,
};
