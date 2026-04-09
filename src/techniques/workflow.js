/**
 * Workflow technique fragments.
 * Generated mechanically from the legacy techniques.js monolith during HR-09.
 */

const {
  fs,
  path,
  hasProjectFile,
  readProjectFiles,
  getWorkflowContent,
  resolveProjectStateReadPath,
} = require('./shared');

module.exports = {
  customCommands: {
      id: 20,
      name: 'Custom slash commands',
      check: (ctx) => ctx.hasDir('.claude/commands') && ctx.dirFiles('.claude/commands').length > 0,
      impact: 'high',
      rating: 4,
      category: 'workflow',
      fix: 'Create custom commands for repeated workflows (/test, /deploy, /review).',
      template: 'commands'
    },

  multipleCommands: {
      id: 20001,
      name: '3+ slash commands for rich workflow',
      check: (ctx) => ctx.hasDir('.claude/commands') && ctx.dirFiles('.claude/commands').length >= 3,
      impact: 'medium',
      rating: 4,
      category: 'workflow',
      fix: 'Add at least 3 slash commands to cover your main workflows (test, deploy, review, etc.).',
      template: 'commands'
    },

  deployCommand: {
      id: 20002,
      name: 'Has /deploy or /release command',
      check: (ctx) => {
        if (!ctx.hasDir('.claude/commands')) return false;
        const files = ctx.dirFiles('.claude/commands');
        return files.some(f => /deploy|release/i.test(f));
      },
      impact: 'medium',
      rating: 4,
      category: 'workflow',
      fix: 'Create a /deploy or /release command for one-click deployments.',
      template: null
    },

  reviewCommand: {
      id: 20003,
      name: 'Has /review command',
      check: (ctx) => {
        if (!ctx.hasDir('.claude/commands')) return false;
        const files = ctx.dirFiles('.claude/commands');
        return files.some(f => /review/i.test(f));
      },
      impact: 'medium',
      rating: 4,
      category: 'workflow',
      fix: 'Create a /review command for code review workflows.',
      template: null
    },

  skills: {
      id: 21,
      name: 'Custom skills',
      check: (ctx) => {
        // Skills use directory-per-skill structure: .claude/skills/<name>/SKILL.md
        if (!ctx.hasDir('.claude/skills')) return false;
        const dirs = ctx.dirFiles('.claude/skills');
        // Check for SKILL.md inside skill directories
        for (const d of dirs) {
          if (ctx.fileContent(`.claude/skills/${d}/SKILL.md`)) return true;
        }
        // Fallback: any files in skills dir (legacy .claude/commands/ also works)
        return dirs.length > 0;
      },
      impact: 'medium',
      rating: 4,
      category: 'workflow',
      fix: 'Create skills at .claude/skills/<name>/SKILL.md with YAML frontmatter (name, description). Each skill is a directory with a SKILL.md file.',
      template: 'skills'
    },

  multipleSkills: {
      id: 2101,
      name: '2+ skills for specialization',
      check: (ctx) => {
        if (!ctx.hasDir('.claude/skills')) return false;
        return ctx.dirFiles('.claude/skills').length >= 2;
      },
      impact: 'medium',
      rating: 4,
      category: 'workflow',
      fix: 'Add at least 2 skills covering different workflows (e.g. code-review, test-writer).',
      template: 'skills'
    },

  agents: {
      id: 22,
      name: 'Custom agents',
      check: (ctx) => ctx.hasDir('.claude/agents') && ctx.dirFiles('.claude/agents').length > 0,
      impact: 'medium',
      rating: 4,
      category: 'workflow',
      fix: 'Create specialized agents (security-reviewer, test-writer) in .claude/agents/.',
      template: 'agents'
    },

  multipleAgents: {
      id: 2201,
      name: '2+ agents for delegation',
      check: (ctx) => ctx.hasDir('.claude/agents') && ctx.dirFiles('.claude/agents').length >= 2,
      impact: 'medium',
      rating: 4,
      category: 'workflow',
      fix: 'Add at least 2 agents for specialized tasks (e.g. security-reviewer, test-writer).',
      template: 'agents'
    },

  multipleRules: {
      id: 301,
      name: '2+ rules files for granular control',
      check: (ctx) => ctx.hasDir('.claude/rules') && ctx.dirFiles('.claude/rules').length >= 2,
      impact: 'medium',
      rating: 4,
      category: 'workflow',
      fix: 'Add path-specific rules for different parts of the codebase (frontend, backend, tests).',
      template: 'rules'
    },

  channelsAwareness: {
      id: 1102,
      name: 'Claude Code Channels awareness',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        const settings = ctx.jsonFile('.claude/settings.local.json') || ctx.jsonFile('.claude/settings.json');
        const settingsStr = JSON.stringify(settings || {});
        return /\bchannels?\b.*\b(telegram|discord|imessage|slack|bridge)\b|\b(telegram|discord|imessage|slack|bridge)\b.*\bchannels?\b/i.test(md) || settingsStr.includes('channels');
      },
      impact: 'low',
      rating: 3,
      category: 'features',
      fix: 'Claude Code Channels (v2.1.80+) bridges Telegram/Discord/iMessage to your session.',
      template: null
    },

  agentHasAllowedTools: {
      id: 2011,
      name: 'At least one subagent restricts tools',
      check: (ctx) => {
        if (!ctx.hasDir('.claude/agents')) return null;
        const files = ctx.dirFiles('.claude/agents');
        if (files.length === 0) return null;
        for (const f of files) {
          const content = ctx.fileContent(`.claude/agents/${f}`) || '';
          // Current frontmatter uses allowed-tools (also accept legacy tools:)
          if (/allowed-tools:/i.test(content) || /tools:\s*\[/.test(content)) return true;
        }
        return false;
      },
      impact: 'medium', rating: 3, category: 'workflow',
      fix: 'Add allowed-tools to subagent frontmatter (e.g. allowed-tools: Read Grep Bash) for safer delegation.',
      template: null
    },

  hasSnapshotHistory: {
      id: 2017,
      name: 'Audit snapshot history exists',
      check: (ctx) => {
        const fs = require('fs');
        return fs.existsSync(resolveProjectStateReadPath(ctx.dir, 'snapshots', 'index.json'));
      },
      impact: 'low', rating: 3, category: 'workflow',
      fix: 'Run `npx nerviq --snapshot` to start tracking your setup score over time.',
      template: null
    },

  worktreeAwareness: {
      id: 2018,
      name: 'Worktree or parallel sessions mentioned',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        const shared = ctx.jsonFile('.claude/settings.json') || {};
        return /worktree|parallel.*session/i.test(md) || !!shared.worktree;
      },
      impact: 'low', rating: 3, category: 'features',
      fix: 'Claude Code supports git worktrees for parallel isolated sessions. Mention if relevant.',
      template: null
    },

  skillUsesPaths: {
      id: 2026,
      name: 'At least one skill uses paths for scoping',
      check: (ctx) => {
        if (!ctx.hasDir('.claude/skills')) return null;
        const entries = ctx.dirFiles('.claude/skills');
        if (entries.length === 0) return null;
        for (const entry of entries) {
          // Skills can be files or dirs with SKILL.md inside
          const direct = ctx.fileContent(`.claude/skills/${entry}`) || '';
          if (/paths:/i.test(direct)) return true;
          const nested = ctx.fileContent(`.claude/skills/${entry}/SKILL.md`) || '';
          if (/paths:/i.test(nested)) return true;
        }
        return false;
      },
      impact: 'low', rating: 3, category: 'workflow',
      fix: 'Add paths to skill frontmatter to scope when skills activate (e.g. paths: ["src/**/*.ts"]).',
      template: null
    },

  rulesDirectory: {
      id: 2035,
      name: 'Path-specific rules in .claude/rules/',
      check: (ctx) => ctx.hasDir('.claude/rules') && ctx.dirFiles('.claude/rules').length > 0,
      impact: 'medium',
      rating: 3,
      category: 'workflow',
      fix: 'Create .claude/rules/ with path-specific rules for different parts of your codebase (e.g. frontend.md, backend.md).',
      template: null
    },

  hasLlmsTxt: {
      id: 110001,
      name: 'Has /llms.txt or llms.txt for LLM context',
      check: (ctx) => {
        return ctx.files.some(f => /^(public\/)?llms\.txt$/i.test(f) || /^llms-full\.txt$/i.test(f));
      },
      impact: 'low', rating: 3, category: 'features',
      fix: 'Add llms.txt to provide LLM-friendly project context. See llmstxt.org for the standard.',
      template: null,
      confidence: 0.8,
    },

  instinctToSkillProgression: {
      id: 110006,
      name: 'Instinct-to-skill progression documented',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return /progressive learning|instinct[- ]to[- ]skill|instinct.{0,40}skill|skill.{0,40}instinct|graduated|phased approach/i.test(md);
      },
      impact: 'low', rating: 3, category: 'features',
      fix: 'Document a progressive learning path that turns repeated instincts into reusable skills or phased practices.',
      template: null,
      confidence: 0.7,
    },

  featureFlagService: {
      id: 130141,
      name: 'Feature flag service in dependencies',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        if (/launchdarkly|unleash|flagsmith|growthbook|@split/i.test(pkg)) return true;
        const py = readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i) + readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
        if (/launchdarkly|unleash|flagsmith|growthbook/i.test(py)) return true;
        return false;
      },
      impact: 'medium',
      category: 'feature-flags',
      fix: 'Add a feature flag service (LaunchDarkly, Unleash, Flagsmith, GrowthBook) for safe feature rollouts.',
      confidence: 0.7,
    },

  featureFlagConfig: {
      id: 130142,
      name: 'Feature flag config files exist',
      check: (ctx) => {
        return hasProjectFile(ctx, /(^|\/)flags\.json$/i) ||
          hasProjectFile(ctx, /(^|\/)features\.json$/i) ||
          hasProjectFile(ctx, /(^|\/)feature-flags\//i);
      },
      impact: 'low',
      category: 'feature-flags',
      fix: 'Add feature flag configuration files (flags.json, features.json, or feature-flags/ directory).',
      confidence: 0.7,
    },

  featureFlagTests: {
      id: 130143,
      name: 'Feature flag testing present',
      check: (ctx) => {
        const testFiles = readProjectFiles(ctx, /(test|spec)\.(jsx?|tsx?|py|go|java|rb)$/i, 30);
        return /flag|feature.*toggle|variation/i.test(testFiles);
      },
      impact: 'low',
      category: 'feature-flags',
      fix: 'Add tests for feature flag variations to verify behavior under different flag states.',
      confidence: 0.7,
    },

  flagLifecycle: {
      id: 130144,
      name: 'Flag lifecycle management',
      check: (ctx) => {
        return hasProjectFile(ctx, /flag-audit|remove-flag|flag.*cleanup/i) ||
          /flag.*lifecycle|flag.*cleanup|stale.*flag/i.test(readProjectFiles(ctx, /\.(md|txt|json)$/i, 10));
      },
      impact: 'low',
      category: 'feature-flags',
      fix: 'Add flag lifecycle scripts or docs (flag-audit, remove-flag) to prevent stale flag accumulation.',
      confidence: 0.7,
    },

  envBasedFlags: {
      id: 130145,
      name: 'Environment-based feature toggles',
      check: (ctx) => {
        const envFiles = readProjectFiles(ctx, /(^|\/)(\.env|\.env\.\w+)$/i);
        const config = readProjectFiles(ctx, /\.(json|ya?ml|toml)$/i, 15);
        return /FEATURE_|ENABLE_|FF_/i.test(envFiles + config);
      },
      impact: 'low',
      category: 'feature-flags',
      fix: 'Use environment-based feature toggles (FEATURE_, ENABLE_, FF_ prefixes) for deployment-time configuration.',
      confidence: 0.7,
    },

  monorepoTool: {
      id: 130161,
      name: 'Monorepo tool configured',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const hasMonorepo = /workspaces/i.test(pkg) || ctx.files.includes('lerna.json') ||
          ctx.files.includes('nx.json') || ctx.files.includes('turbo.json') ||
          hasProjectFile(ctx, /(^|\/)pnpm-workspace\.yaml$/i);
        if (!hasMonorepo) return null;
        return /turborepo|turbo|"nx"|lerna|rush|bazel/i.test(pkg) ||
          ctx.files.includes('nx.json') || ctx.files.includes('turbo.json') ||
          ctx.files.includes('lerna.json') || ctx.files.includes('rush.json');
      },
      impact: 'medium',
      category: 'monorepo',
      fix: 'Configure a monorepo orchestration tool (Turborepo, Nx, Lerna, Rush) for efficient multi-package builds.',
      confidence: 0.7,
    },

  workspaceDeps: {
      id: 130162,
      name: 'Workspace dependency management configured',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const hasMonorepo = /workspaces/i.test(pkg) || ctx.files.includes('lerna.json') ||
          ctx.files.includes('nx.json') || ctx.files.includes('turbo.json') ||
          hasProjectFile(ctx, /(^|\/)pnpm-workspace\.yaml$/i);
        if (!hasMonorepo) return null;
        return hasProjectFile(ctx, /(^|\/)pnpm-workspace\.yaml$/i) || /workspaces/i.test(pkg);
      },
      impact: 'medium',
      category: 'monorepo',
      fix: 'Configure workspace dependencies (pnpm-workspace.yaml or workspaces in package.json) for cross-package linking.',
      confidence: 0.7,
    },

  changesetsConfigured: {
      id: 130163,
      name: 'Changesets or conventional commits for versioning',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const hasMonorepo = /workspaces/i.test(pkg) || ctx.files.includes('lerna.json') ||
          ctx.files.includes('nx.json') || ctx.files.includes('turbo.json') ||
          hasProjectFile(ctx, /(^|\/)pnpm-workspace\.yaml$/i);
        if (!hasMonorepo) return null;
        return /@changesets\/cli|changeset/i.test(pkg) || ctx.hasDir('.changeset') ||
          hasProjectFile(ctx, /(^|\/)\.changeset\//i);
      },
      impact: 'low',
      category: 'monorepo',
      fix: 'Add @changesets/cli or conventional commits for coordinated versioning across packages.',
      confidence: 0.7,
    },

  monorepoCI: {
      id: 130164,
      name: 'CI uses affected/changed detection',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const hasMonorepo = /workspaces/i.test(pkg) || ctx.files.includes('lerna.json') ||
          ctx.files.includes('nx.json') || ctx.files.includes('turbo.json') ||
          hasProjectFile(ctx, /(^|\/)pnpm-workspace\.yaml$/i);
        if (!hasMonorepo) return null;
        const ci = getWorkflowContent(ctx);
        return /nx affected|turbo.*--filter|lerna changed|lerna run.*--since/i.test(ci);
      },
      impact: 'medium',
      category: 'monorepo',
      fix: 'Use affected/changed detection in CI (nx affected, turbo --filter) to only build what changed.',
      confidence: 0.7,
    },

  sharedConfigs: {
      id: 130165,
      name: 'Shared configs across packages',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const hasMonorepo = /workspaces/i.test(pkg) || ctx.files.includes('lerna.json') ||
          ctx.files.includes('nx.json') || ctx.files.includes('turbo.json') ||
          hasProjectFile(ctx, /(^|\/)pnpm-workspace\.yaml$/i);
        if (!hasMonorepo) return null;
        return hasProjectFile(ctx, /(^|\/)packages\/.*eslint/i) ||
          hasProjectFile(ctx, /(^|\/)packages\/.*tsconfig/i) ||
          hasProjectFile(ctx, /shared.*config/i);
      },
      impact: 'low',
      category: 'monorepo',
      fix: 'Create shared config packages (eslint, tsconfig) referenced across monorepo packages for consistency.',
      confidence: 0.7,
    },
};
