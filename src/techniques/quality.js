/**
 * Quality technique fragments.
 * Generated mechanically from the legacy techniques.js monolith during HR-09.
 */

const {
  getClaudeInstructionBundle,
  hasDocumentedVerificationGuidance,
  hasDocumentedTestCommand,
  hasDocumentedLintCommand,
  hasDocumentedBuildCommand,
  hasFrontendSignals,
} = require('./shared');

module.exports = {
  verificationLoop: {
      id: 93,
      name: 'Claude instruction surfaces include verification criteria',
      check: (ctx) => {
        const docs = getClaudeInstructionBundle(ctx);
        return hasDocumentedVerificationGuidance(docs);
      },
      impact: 'critical',
      rating: 5,
      category: 'quality',
      fix: 'Add canonical test/lint/build commands to your Claude instruction surfaces (CLAUDE.md, imported docs, or .claude/commands) so Claude can verify its own work.',
      template: null
    },

  testCommand: {
      id: 93001,
      name: 'Claude instruction surfaces include a test command',
      check: (ctx) => {
        return hasDocumentedTestCommand(getClaudeInstructionBundle(ctx));
      },
      impact: 'high',
      rating: 5,
      category: 'quality',
      fix: 'Add an explicit test command to your Claude instruction surfaces (for example "Run `npm test` before committing").',
      template: null
    },

  lintCommand: {
      id: 93002,
      name: 'Claude instruction surfaces include a lint command',
      check: (ctx) => {
        return hasDocumentedLintCommand(getClaudeInstructionBundle(ctx));
      },
      impact: 'high',
      rating: 4,
      category: 'quality',
      fix: 'Add a lint command to your Claude instruction surfaces so Claude can check style and static quality automatically.',
      template: null
    },

  buildCommand: {
      id: 93003,
      name: 'Claude instruction surfaces include a build command',
      check: (ctx) => {
        return hasDocumentedBuildCommand(getClaudeInstructionBundle(ctx));
      },
      impact: 'medium',
      rating: 4,
      category: 'quality',
      fix: 'Add a build command to your Claude instruction surfaces so Claude can verify compilation before committing.',
      template: null
    },

  frontendDesignSkill: {
      id: 1025,
      name: 'Frontend design skill for anti-AI-slop',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        const md = ctx.claudeMdContent() || '';
        return md.includes('frontend_aesthetics') || md.includes('anti-AI-slop') || md.includes('frontend-design');
      },
      impact: 'medium',
      rating: 5,
      category: 'design',
      fix: 'Install the official frontend-design skill for better UI output quality.',
      template: null
    },

  tailwindMention: {
      id: 102501,
      name: 'Tailwind CSS configured',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        const pkg = ctx.fileContent('package.json') || '';
        return pkg.includes('tailwind') ||
          ctx.files.some(f => /tailwind\.config/.test(f));
      },
      impact: 'low',
      rating: 3,
      category: 'design',
      fix: 'Consider adding Tailwind CSS for rapid, consistent UI styling with Claude.',
      template: null
    },

  claudeMdFreshness: {
      id: 2001,
      name: 'CLAUDE.md mentions current Claude features',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        if (md.length < 50) return false; // too short to evaluate
        // Check for awareness of features from 2025+
        const modernFeatures = ['hook', 'skill', 'agent', 'subagent', 'mcp', 'compact', '/clear', 'extended thinking', 'tool_use', 'worktree'];
        const found = modernFeatures.filter(f => md.toLowerCase().includes(f));
        return found.length >= 2; // knows at least 2 modern features
      },
      impact: 'medium',
      rating: 4,
      category: 'quality-deep',
      fix: 'Your CLAUDE.md may be outdated. Modern Claude Code supports hooks, skills, agents, MCP, worktrees, and extended thinking. Mention the ones you use.',
      template: null
    },

  claudeMdNoContradictions: {
      id: 2003,
      name: 'CLAUDE.md has no obvious contradictions',
      check: (ctx) => {
        const md = ctx.claudeMdContent();
        if (!md || md.length < 50) return false; // no CLAUDE.md or too short = not passing
        // Check for common contradictions
        // Check for contradictions on the SAME topic (same line or adjacent sentence)
        const lines = md.split('\n');
        let hasContradiction = false;
        for (const line of lines) {
          if (/\balways\b.*\bnever\b|\bnever\b.*\balways\b/i.test(line)) {
            hasContradiction = true;
            break;
          }
        }
        const hasBothStyles = /\buse tabs\b/i.test(md) && /\buse spaces\b/i.test(md);
        return !hasContradiction && !hasBothStyles;
      },
      impact: 'high',
      rating: 4,
      category: 'quality-deep',
      fix: 'CLAUDE.md may contain contradictory instructions. Review for conflicting rules (e.g., "always X" and "never X" about the same topic).',
      template: null
    },

  hooksAreSpecific: {
      id: 2004,
      name: 'Hooks use specific matchers (not catch-all)',
      check: (ctx) => {
        const settings = ctx.jsonFile('.claude/settings.local.json') || ctx.jsonFile('.claude/settings.json');
        if (!settings || !settings.hooks) return null; // no hooks = not applicable
        const hookStr = JSON.stringify(settings.hooks);
        // Check that hooks have matchers, not just catch-all
        return hookStr.includes('matcher');
      },
      impact: 'medium',
      rating: 3,
      category: 'quality-deep',
      fix: 'Hooks without matchers run on every tool call. Use matchers like "Write|Edit" or "Bash" to target specific tools.',
      template: null
    },

  commandsUseArguments: {
      id: 2006,
      name: 'Commands use $ARGUMENTS for flexibility',
      check: (ctx) => {
        if (!ctx.hasDir('.claude/commands')) return null; // not applicable
        const files = ctx.dirFiles('.claude/commands');
        if (files.length === 0) return null;
        // Check if at least one command uses $ARGUMENTS
        for (const f of files) {
          const content = ctx.fileContent(`.claude/commands/${f}`) || '';
          if (content.includes('$ARGUMENTS') || content.includes('$arguments')) return true;
        }
        return false;
      },
      impact: 'medium',
      rating: 3,
      category: 'quality-deep',
      fix: 'Commands without $ARGUMENTS are static. Use $ARGUMENTS to make them flexible: "Fix the issue: $ARGUMENTS"',
      template: null
    },

  agentsHaveMaxTurns: {
      id: 2007,
      name: 'Subagents have max-turns limit',
      check: (ctx) => {
        if (!ctx.hasDir('.claude/agents')) return null;
        const files = ctx.dirFiles('.claude/agents');
        if (files.length === 0) return null;
        for (const f of files) {
          const content = ctx.fileContent(`.claude/agents/${f}`) || '';
          // Current frontmatter uses kebab-case: max-turns (also accept legacy maxTurns)
          if (!content.includes('max-turns') && !content.includes('maxTurns')) return false;
        }
        return true;
      },
      impact: 'medium',
      rating: 3,
      category: 'quality-deep',
      fix: 'Subagents without max-turns can run indefinitely. Add "max-turns: 50" to subagent YAML frontmatter.',
      template: null
    },

  securityReviewInWorkflow: {
      id: 2008,
      name: '/security-review command or workflow',
      check: (ctx) => {
        const hasCommand = ctx.hasDir('.claude/commands') &&
          (ctx.dirFiles('.claude/commands') || []).some(f => f.includes('security') || f.includes('review'));
        const md = ctx.claudeMdContent() || '';
        const hasExplicitRef = /\/security-review|security review command|security workflow/i.test(md);
        return hasCommand || hasExplicitRef;
      },
      impact: 'medium',
      rating: 4,
      category: 'quality-deep',
      fix: 'Claude Code has built-in /security-review (OWASP Top 10). Add it to your workflow or create a /security command.',
      template: null
    },

  testCoverage: {
      id: 2010,
      name: 'Test coverage or strategy mentioned',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return /coverage|test.*strateg|e2e|integration test|unit test/i.test(md);
      },
      impact: 'medium', rating: 3, category: 'quality',
      fix: 'Mention your testing strategy in CLAUDE.md (unit, integration, E2E, coverage targets).',
      template: null
    },

  typeCheckingConfigured: {
      id: 2031,
      name: 'Type checking configured (TypeScript or similar)',
      check: (ctx) => {
        return !!(ctx.fileContent('tsconfig.json') || ctx.fileContent('jsconfig.json') ||
          ctx.fileContent('pyrightconfig.json') || ctx.fileContent('mypy.ini'));
      },
      impact: 'medium', rating: 3, category: 'quality',
      fix: 'Add type checking configuration. Type-safe code produces fewer Claude errors.',
      template: null
    },

  noDeprecatedPatterns: {
      id: 2009,
      name: 'No deprecated patterns detected',
      check: (ctx) => {
        const md = ctx.claudeMdContent();
        if (!md) return false;
        // Only flag truly deprecated patterns, not valid aliases
        const deprecatedPatterns = [
          /\bhuman_prompt\b/i, /\bassistant_prompt\b/i, // old completions API format (not Messages API)
          /\buse model claude-3-opus\b/i, // explicit recommendation to use old name as --model
          /\buse model claude-3-sonnet\b/i,
        ];
        return !deprecatedPatterns.some(p => p.test(md));
      },
      impact: 'medium',
      rating: 3,
      category: 'quality-deep',
      fix: 'CLAUDE.md references deprecated API patterns (human_prompt/assistant_prompt). Update to current Messages API conventions.',
      template: null
    },

  claudeMdQuality: {
      id: 102502,
      name: 'CLAUDE.md has substantive content',
      check: (ctx) => {
        const md = ctx.claudeMdContent();
        if (!md) return null;
        const lines = md.split('\n').filter(l => l.trim());
        const sections = (md.match(/^##\s/gm) || []).length;
        const hasCommand = /\b(npm|yarn|pnpm|pytest|go |make |ruff |cargo |dotnet )\b/i.test(md);
        return lines.length >= 15 && sections >= 2 && hasCommand;
      },
      impact: 'medium',
      rating: 4,
      category: 'quality-deep',
      fix: 'CLAUDE.md exists but lacks substance. Add at least 2 sections (## headings) and include your test/build/lint commands.',
      template: null
    },

  consistencyPassAtK: {
      id: 110005,
      name: 'Consistency/pass@k evaluation mentioned',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        const configPaths = [
          'package.json',
          'jest.config.js',
          'jest.config.cjs',
          'jest.config.mjs',
          'vitest.config.js',
          'vitest.config.ts',
          'playwright.config.js',
          'playwright.config.ts',
          'pytest.ini',
          'pyproject.toml',
          'tox.ini',
          '.github/workflows/ci.yml',
          '.github/workflows/ci.yaml',
          '.github/workflows/test.yml',
          '.github/workflows/test.yaml',
        ];
        const configContent = configPaths
          .map(file => ctx.fileContent(file) || '')
          .filter(Boolean)
          .join('\n');
  
        return /pass@k|consistency|multiple runs?|reproducib/i.test(`${md}\n${configContent}`);
      },
      impact: 'low', rating: 3, category: 'quality',
      fix: 'Mention pass@k or consistency testing in CLAUDE.md or test configuration so repeated-run quality evaluation is explicit.',
      template: null,
      confidence: 0.7,
    },
};
