/**
 * SILENT-01 — configuration that exists but is never loaded.
 *
 * The failure shape this family exists for: absence of signal read as
 * absence of problem. A rules file the platform ignores, a `paths:` glob
 * matching nothing, a hook under a misspelled event, an AGENTS.md Claude
 * Code never reads, a UTF-16 instruction file — each parses cleanly, runs
 * never, and warns nobody.
 *
 * Half these tests are false-positive guards, because the calibration is
 * the hard part: a deliberate per-platform split is not a silent failure.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectContext } = require('../src/context');
const pattern = require('../src/shallow-risk/patterns/agent-config-silently-ignored');

function withRepo(name, files, assert) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-silent-${name}-`));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      if (Buffer.isBuffer(content)) fs.writeFileSync(full, content);
      else fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
    }
    assert(pattern.run(new ProjectContext(dir)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SUBSTANTIVE_AGENTS = ['# Agent instructions', '', ...Array.from({ length: 12 }, (_, i) => `- rule ${i + 1}: do the thing`)].join('\n');
const SUBSTANTIVE_CLAUDE = ['# Claude', '', ...Array.from({ length: 30 }, (_, i) => `- claude rule ${i + 1}`)].join('\n');

describe('SILENT-01 AGENTS.md that Claude Code never reads', () => {
  test('flags a substantive AGENTS.md that CLAUDE.md never imports', () => {
    withRepo('agents-not-imported', {
      'AGENTS.md': SUBSTANTIVE_AGENTS,
      'CLAUDE.md': SUBSTANTIVE_CLAUDE,
    }, (findings) => {
      const f = findings.find((x) => x.file === 'CLAUDE.md');
      expect(f).toBeTruthy();
      expect(f.severity).toBe('medium');
      expect(f.fix).toContain('@AGENTS.md');
    });
  });

  test('escalates to high when CLAUDE.md is a stub', () => {
    withRepo('agents-claude-stub', {
      'AGENTS.md': SUBSTANTIVE_AGENTS,
      'CLAUDE.md': '# Claude\n',
    }, (findings) => {
      const f = findings.find((x) => x.file === 'CLAUDE.md');
      expect(f.severity).toBe('high');
    });
  });

  test('an @AGENTS.md import silences it', () => {
    withRepo('agents-imported', {
      'AGENTS.md': SUBSTANTIVE_AGENTS,
      'CLAUDE.md': `@AGENTS.md\n\n${SUBSTANTIVE_CLAUDE}`,
    }, (findings) => {
      expect(findings.filter((f) => /AGENTS\.md/.test(f.fix || ''))).toEqual([]);
    });
  });

  test('a backticked mention is not an import (the docs say so explicitly)', () => {
    withRepo('agents-backticked', {
      'AGENTS.md': SUBSTANTIVE_AGENTS,
      'CLAUDE.md': `${SUBSTANTIVE_CLAUDE}\n\nWriting \`@AGENTS.md\` keeps the text literal.\n`,
    }, (findings) => {
      expect(findings.some((f) => f.file === 'CLAUDE.md')).toBe(true);
    });
  });

  test('a declared per-platform companion is a deliberate split, not a failure', () => {
    withRepo('agents-companion', {
      'AGENTS.md': `# Codex instructions\n\n> Companion to \`CLAUDE.md\`. This is the Codex-native view.\n\n${SUBSTANTIVE_AGENTS}`,
      'CLAUDE.md': SUBSTANTIVE_CLAUDE,
    }, (findings) => {
      expect(findings.filter((f) => f.file === 'CLAUDE.md')).toEqual([]);
    });
  });

  test('a marker-only AGENTS.md has nothing to lose', () => {
    withRepo('agents-marker', {
      'AGENTS.md': 'AGENTS_MARKER=true\n\n<!-- nerviq:managed:start -->\nProject: x\n<!-- nerviq:managed:end -->\n',
      'CLAUDE.md': SUBSTANTIVE_CLAUDE,
    }, (findings) => {
      expect(findings.filter((f) => f.file === 'CLAUDE.md')).toEqual([]);
    });
  });

  test('no Claude surface at all means nothing is being ignored', () => {
    withRepo('agents-no-claude', {
      'AGENTS.md': SUBSTANTIVE_AGENTS,
    }, (findings) => {
      expect(findings).toEqual([]);
    });
  });
});

describe('SILENT-01 rule files the platform ignores', () => {
  test('flags a plain .md inside .cursor/rules', () => {
    withRepo('cursor-plain-md', {
      '.cursor/rules/style.md': '# Style\nUse tabs.\n',
    }, (findings) => {
      const f = findings.find((x) => x.file === '.cursor/rules/style.md');
      expect(f).toBeTruthy();
      expect(f.severity).toBe('high');
    });
  });

  test('flags an .mdc without frontmatter', () => {
    withRepo('cursor-mdc-no-fm', {
      '.cursor/rules/style.mdc': '# Style\nUse tabs.\n',
    }, (findings) => {
      expect(findings.some((f) => f.file === '.cursor/rules/style.mdc')).toBe(true);
    });
  });

  test('a proper .mdc with frontmatter is fine', () => {
    withRepo('cursor-mdc-ok', {
      '.cursor/rules/style.mdc': '---\ndescription: Style\nalwaysApply: true\n---\n\nUse tabs.\n',
    }, (findings) => {
      expect(findings).toEqual([]);
    });
  });

  test('flags .cursorrules only once the repo has moved to .cursor/rules', () => {
    withRepo('cursorrules-legacy', {
      '.cursorrules': 'Use tabs.\n',
      '.cursor/rules/style.mdc': '---\ndescription: Style\nalwaysApply: true\n---\n\nUse tabs.\n',
    }, (findings) => {
      expect(findings.some((f) => f.file === '.cursorrules')).toBe(true);
    });
  });

  test('a legacy-only repo using .cursorrules is left alone', () => {
    withRepo('cursorrules-only', {
      '.cursorrules': 'Use tabs.\n',
    }, (findings) => {
      expect(findings).toEqual([]);
    });
  });
});

describe('SILENT-01 path-scoped rules that can never fire', () => {
  test('flags a rule whose globs match no file in the repo', () => {
    withRepo('dead-glob', {
      'src/app.ts': 'export const a = 1;\n',
      '.claude/rules/api.md': '---\npaths:\n  - "server/**/*.go"\n---\n\nAPI rules.\n',
    }, (findings) => {
      const f = findings.find((x) => x.file === '.claude/rules/api.md');
      expect(f).toBeTruthy();
      expect(f.fix).toContain('server/**/*.go');
    });
  });

  test('a rule with a matching glob is fine', () => {
    withRepo('live-glob', {
      'src/app.ts': 'export const a = 1;\n',
      '.claude/rules/ts.md': '---\npaths:\n  - "src/**/*.ts"\n---\n\nTS rules.\n',
    }, (findings) => {
      expect(findings).toEqual([]);
    });
  });

  test('brace expansion is understood', () => {
    withRepo('brace-glob', {
      'src/app.tsx': 'export const a = 1;\n',
      '.claude/rules/ts.md': '---\npaths:\n  - "src/**/*.{ts,tsx}"\n---\n\nTS rules.\n',
    }, (findings) => {
      expect(findings).toEqual([]);
    });
  });

  test('one live glob among dead ones keeps the rule alive', () => {
    withRepo('mixed-glob', {
      'src/app.ts': 'export const a = 1;\n',
      '.claude/rules/mix.md': '---\npaths:\n  - "server/**/*.go"\n  - "src/**/*.ts"\n---\n\nRules.\n',
    }, (findings) => {
      expect(findings).toEqual([]);
    });
  });
});

describe('SILENT-01 hooks under events that do not exist', () => {
  test('flags an unknown event name', () => {
    withRepo('hook-unknown', {
      '.claude/settings.json': { hooks: { OnFileSave: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } },
    }, (findings) => {
      const f = findings.find((x) => /OnFileSave/.test(x.fix || ''));
      expect(f).toBeTruthy();
      expect(f.severity).toBe('high');
    });
  });

  test('suggests the correct casing for a case-only mistake', () => {
    withRepo('hook-case', {
      '.claude/settings.json': { hooks: { pretooluse: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] } },
    }, (findings) => {
      expect(findings.some((f) => /Did you mean `PreToolUse`/.test(f.fix || ''))).toBe(true);
    });
  });

  test('the documented lifecycle is accepted, including the newer events', () => {
    withRepo('hook-known', {
      '.claude/settings.json': {
        hooks: {
          PreToolUse: [{ hooks: [{ type: 'command', command: 'echo a' }] }],
          SessionEnd: [{ hooks: [{ type: 'command', command: 'echo b' }] }],
          PostCompact: [{ hooks: [{ type: 'command', command: 'echo c' }] }],
          DirectoryAdded: [{ hooks: [{ type: 'command', command: 'echo d' }] }],
        },
      },
    }, (findings) => {
      expect(findings.filter((f) => /hook event/.test(f.fix || ''))).toEqual([]);
    });
  });
});

describe('SILENT-01 instruction files the platform cannot read', () => {
  test('flags a UTF-16 instruction file', () => {
    withRepo('utf16', {
      'AGENTS.md': Buffer.from('﻿# Agent rules\nUse tabs.\n', 'utf16le'),
    }, (findings) => {
      const f = findings.find((x) => x.file === 'AGENTS.md' && /encoded as/.test(x.fix || ''));
      expect(f).toBeTruthy();
      expect(f.severity).toBe('high');
    });
  });

  test('flags a file whose UTF-16 prefix had its BOM mangled (the real-world shape)', () => {
    // A UTF-16LE body whose BOM was already lossily converted to U+FFFD, with
    // a UTF-8 block appended later by a different tool. Found in this
    // project's own repo on 2026-07-29.
    const mangled = Buffer.concat([
      Buffer.from([0xEF, 0xBF, 0xBD, 0xEF, 0xBF, 0xBD]),
      Buffer.from('MARKER=true\n', 'utf16le'),
      Buffer.from('\n<!-- managed -->\nplain utf-8 tail\n', 'utf8'),
    ]);
    withRepo('utf16-mangled', { 'GEMINI.md': mangled }, (findings) => {
      expect(findings.some((f) => f.file === 'GEMINI.md' && /NUL bytes/.test(f.fix || ''))).toBe(true);
    });
  });

  test('a normal UTF-8 file with accents is not flagged', () => {
    withRepo('utf8-ok', {
      'CLAUDE.md': '# Instrucciones\nUsa español y açentos — sin problema.\n',
    }, (findings) => {
      expect(findings.filter((f) => /encoded as|NUL bytes|replacement characters/.test(f.fix || ''))).toEqual([]);
    });
  });
});
