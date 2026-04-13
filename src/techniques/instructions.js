/**
 * Instructions technique fragments.
 * Generated mechanically from the legacy techniques.js monolith during HR-09.
 */

const {
  path,
  getClaudeHookContents,
} = require('./shared');

module.exports = {
  claudeMd: {
      id: 1,
      name: 'CLAUDE.md project instructions',
      check: (ctx) => ctx.files.includes('CLAUDE.md') || ctx.files.includes('.claude/CLAUDE.md'),
      impact: 'critical',
      rating: 5,
      category: 'memory',
      fix: 'Create CLAUDE.md with project-specific instructions, build commands, and coding conventions.',
      template: 'claude-md'
    },

  mermaidArchitecture: {
      id: 51,
      name: 'Mermaid architecture diagram',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return md.includes('mermaid') || md.includes('graph ') || md.includes('flowchart ');
      },
      impact: 'high',
      rating: 5,
      category: 'memory',
      fix: 'Add a Mermaid diagram to CLAUDE.md showing project architecture. Saves 73% tokens vs prose.',
      template: 'mermaid'
    },

  pathRules: {
      id: 3,
      name: 'Path-specific rules',
      check: (ctx) => ctx.hasDir('.claude/rules') && ctx.dirFiles('.claude/rules').length > 0,
      impact: 'medium',
      rating: 4,
      category: 'memory',
      fix: 'Add rules for different file types (frontend vs backend conventions).',
      template: 'rules'
    },

  importSyntax: {
      id: 763,
      name: 'CLAUDE.md uses @path imports for modularity',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        // Positive-signal check (PP-06 recalibration): N/A when no CLAUDE.md
        // surface exists, so we don't fail every repo that happens to have a
        // short CLAUDE.md. Only fire as an advisory on long CLAUDE.md files
        // where modular @-imports would genuinely help.
        if (!md) return null;
        const hasImport = /@\S+\.(md|txt|json|yml|yaml|toml)/i.test(md) || /@\w+\//.test(md);
        if (hasImport) return true;
        // Only advise splitting when the CLAUDE.md is long enough to warrant it.
        const lineCount = md.split('\n').length;
        if (lineCount < 80) return null;
        return false;
      },
      impact: 'medium',
      rating: 4,
      category: 'memory',
      fix: 'Use @path syntax in CLAUDE.md to split instructions into focused modules (e.g. @docs/coding-style.md). You can also use .claude/rules/ for path-specific rules.',
      template: null
    },

  underlines200: {
      id: 681,
      name: 'CLAUDE.md under 200 lines (concise)',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return md.split('\n').length <= 200;
      },
      impact: 'medium',
      rating: 4,
      category: 'memory',
      fix: 'Keep CLAUDE.md under 200 lines. Use @import or .claude/rules/ to split large instructions.',
      template: null
    },

  xmlTags: {
      id: 96,
      name: 'XML tags for structured prompts',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        // Give credit for XML tags OR well-structured markdown with clear sections
        const hasXml = md.includes('<constraints') || md.includes('<rules') ||
          md.includes('<validation') || md.includes('<instructions');
        const hasStructuredMd = (md.includes('## Rules') || md.includes('## Constraints') ||
          md.includes('## Do not') || md.includes('## Never') || md.includes('## Important')) &&
          md.split('\n').length > 20;
        return hasXml || hasStructuredMd;
      },
      impact: 'medium',
      rating: 4,
      category: 'prompting',
      fix: 'Add clear rules sections to CLAUDE.md. XML tags (<constraints>) are optional but improve clarity.',
      template: null
    },

  fewShotExamples: {
      id: 9,
      name: 'CLAUDE.md contains code examples',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return (md.match(/```/g) || []).length >= 2;
      },
      impact: 'high',
      rating: 5,
      category: 'prompting',
      fix: 'Add code examples (few-shot) in CLAUDE.md to show preferred patterns and conventions.',
      template: null
    },

  roleDefinition: {
      id: 10,
      name: 'CLAUDE.md defines a role or persona',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return /^you are a |^your role is|^act as a |persona:|behave as a /im.test(md);
      },
      impact: 'medium',
      rating: 4,
      category: 'prompting',
      fix: 'Define a role or persona in CLAUDE.md (e.g. "You are a senior backend engineer...").',
      template: null
    },

  constraintBlocks: {
      id: 9601,
      name: 'XML constraint blocks in CLAUDE.md',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return /<constraints|<rules|<requirements|<boundaries/i.test(md);
      },
      impact: 'high',
      rating: 5,
      category: 'prompting',
      fix: 'Wrap critical rules in <constraints> XML blocks for 40% better adherence.',
      template: null
    },

  claudeLocalMd: {
      id: 2002,
      name: 'CLAUDE.local.md for personal overrides',
      check: (ctx) => {
        // CLAUDE.local.md is for personal, non-committed overrides.
        const hasLocal = ctx.files.includes('CLAUDE.local.md') || ctx.files.includes('.claude/CLAUDE.local.md');
        if (hasLocal) return true;
        // PP-06 recalibration: N/A when the repo has no personal-overrides
        // convention at all. Only advise creating CLAUDE.local.md when the
        // repo explicitly opts in to that convention (references it in
        // .gitignore or in CLAUDE.md).
        const gitignore = ctx.fileContent('.gitignore') || '';
        const md = ctx.claudeMdContent() || '';
        const mentioned = /CLAUDE\.local\.md/i.test(gitignore) || /CLAUDE\.local\.md/i.test(md);
        return mentioned ? false : null;
      },
      impact: 'low',
      rating: 2,
      category: 'memory',
      fix: 'Create CLAUDE.local.md for personal preferences that should not be committed (add to .gitignore).',
      template: null
    },

  autoMemoryAwareness: {
      id: 2012,
      name: 'Auto-memory or memory management mentioned',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        if (/auto.?memory|memory.*manage|remember|persistent.*context/i.test(md)) return true;
        // PP-06 recalibration: N/A on repos that don't use Claude Code memory
        // at all. Only fire the advisory when the repo opts in (mentions memory
        // or has a memory directory under .claude/).
        const opts_in = /\bmemory\b/i.test(md) || ctx.hasDir('.claude/memory');
        return opts_in ? false : null;
      },
      impact: 'low', rating: 3, category: 'memory',
      fix: 'Claude Code supports auto-memory for cross-session learning. Mention your memory strategy if relevant.',
      template: null
    },

  negativeInstructions: {
      id: 2019,
      name: 'CLAUDE.md includes "do not" instructions',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return /do not|don't|never|avoid|must not/i.test(md);
      },
      impact: 'medium', rating: 4, category: 'prompting',
      fix: 'Add explicit "do not" rules to CLAUDE.md. Negative constraints reduce common mistakes.',
      template: null
    },

  outputStyleGuidance: {
      id: 2020,
      name: 'CLAUDE.md includes output or style guidance',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return /coding style|naming convention|code style|style guide|formatting rules|\bprefer\b.*\b(single|double|tabs|spaces|camel|snake|kebab|named|default|const|let|arrow|function)\b/i.test(md);
      },
      impact: 'medium', rating: 3, category: 'prompting',
      fix: 'Add coding style and naming conventions to CLAUDE.md so Claude matches your project patterns.',
      template: null
    },

  projectDescriptionInClaudeMd: {
      id: 2022,
      name: 'CLAUDE.md describes what the project does',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return /what.*does|overview|purpose|about|description|project.*is/i.test(md) && md.length > 100;
      },
      impact: 'high', rating: 4, category: 'memory',
      fix: 'Start CLAUDE.md with a clear project description. Claude needs to know what your project does.',
      template: null
    },

  directoryStructureInClaudeMd: {
      id: 2023,
      name: 'CLAUDE.md documents directory structure',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return /src\/|app\/|lib\/|structure|director|folder/i.test(md);
      },
      impact: 'medium', rating: 4, category: 'memory',
      fix: 'Document your directory structure in CLAUDE.md so Claude navigates your codebase efficiently.',
      template: null
    },

  hookExitCodesDefined: {
      id: 110003,
      name: 'Hook scripts handle exit codes correctly',
      check: (ctx) => {
        const hookContents = getClaudeHookContents(ctx);
        if (hookContents.length === 0) return null;
        return hookContents.some(content => /process\.exit|exit\s+[012]|sys\.exit|return\s+[012]/i.test(content));
      },
      impact: 'low', rating: 3, category: 'governance',
      fix: 'Hooks should use explicit exit codes: 0=success, 1=warning, 2=block. See Claude Code docs.',
      template: null,
      confidence: 0.7,
    },

  loopSafetyBoundaries: {
      id: 110004,
      name: 'Loop safety boundaries configured',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        const settings = ctx.fileContent('.claude/settings.json') || '';
        const hookContents = getClaudeHookContents(ctx).join('\n');
        const loopSafetyConfig = [md, settings, hookContents].filter(Boolean).join('\n');
  
        return /max[-_ ]?turns|maxTurns|max[-_ ]?tokens|maxTokens|loop(?:[-_ ]?(?:limit|limits|safety|guard|budget|boundary|boundaries))|iteration(?:[-_ ]?(?:limit|limits|guard|budget|cap|caps|count|max(?:imum)?))/i.test(loopSafetyConfig);
      },
      impact: 'medium', rating: 4, category: 'governance',
      fix: 'Document loop safety limits such as maxTurns, maxTokens, or iteration caps in CLAUDE.md, settings, or hook guards.',
      template: null,
      confidence: 0.8,
    },
};
