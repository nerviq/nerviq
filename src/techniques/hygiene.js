/**
 * Hygiene technique fragments.
 * Generated mechanically from the legacy techniques.js monolith during HR-09.
 */

const {
  hasFrontendSignals,
  hasProjectFile,
  readProjectFiles,
  isGoProject,
  containsEmbeddedSecret,
} = require('./shared');

module.exports = {
  gitIgnoreClaudeTracked: {
      id: 976,
      name: '.claude/ tracked in git',
      check: (ctx) => {
        if (!ctx.fileContent('.gitignore')) return true; // no gitignore = ok
        const lines = ctx.fileContent('.gitignore')
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        const ignoresClaudeDir = lines.some(line => /^(\/|\*\*\/)?\.claude\/?$/.test(line));
        const unignoresClaudeDir = lines.some(line => /^!(\/)?\.claude(\/|\*\*)?$/.test(line));
        return !ignoresClaudeDir || unignoresClaudeDir;
      },
      impact: 'high',
      rating: 4,
      category: 'git',
      fix: 'Remove .claude/ from .gitignore (keep .claude/settings.local.json ignored).',
      template: null
    },

  gitIgnoreEnv: {
      id: 917,
      name: '.gitignore blocks .env files',
      check: (ctx) => {
        const gitignore = ctx.fileContent('.gitignore') || '';
        return gitignore.includes('.env');
      },
      impact: 'critical',
      rating: 5,
      category: 'git',
      fix: 'Add .env to .gitignore to prevent leaking secrets.',
      template: null
    },

  gitIgnoreNodeModules: {
      id: 91701,
      name: '.gitignore blocks node_modules',
      check: (ctx) => {
        const hasNodeSignals = ctx.files.includes('package.json') ||
          ctx.files.includes('tsconfig.json') ||
          ctx.files.some(f => /package-lock\.json|pnpm-lock\.yaml|yarn\.lock|next\.config|vite\.config/i.test(f));
        if (!hasNodeSignals) return null;
        const gitignore = ctx.fileContent('.gitignore') || '';
        return gitignore.includes('node_modules');
      },
      impact: 'high',
      rating: 4,
      category: 'git',
      fix: 'Add node_modules/ to .gitignore.',
      template: null
    },

  noSecretsInClaude: {
      id: 1039,
      name: 'CLAUDE.md has no embedded secrets',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return !containsEmbeddedSecret(md);
      },
      impact: 'critical',
      rating: 5,
      category: 'git',
      fix: 'Remove hardcoded secrets, tokens, private keys, and connection strings from CLAUDE.md. Use environment variables or external secret stores instead.',
      template: null
    },

  readme: {
      id: 416,
      name: 'Has README.md',
      check: (ctx) => ctx.files.some(f => /^readme\.md$/i.test(f)),
      impact: 'high',
      rating: 4,
      category: 'hygiene',
      fix: 'Add a README.md with project overview, setup instructions, and usage.',
      template: null
    },

  changelog: {
      id: 417,
      name: 'Has CHANGELOG.md',
      check: (ctx) => ctx.files.some(f => /^changelog\.md$/i.test(f)),
      impact: 'low',
      rating: 3,
      category: 'hygiene',
      fix: 'Add a CHANGELOG.md to track notable changes across versions.',
      template: null
    },

  contributing: {
      id: 418,
      name: 'Has CONTRIBUTING.md',
      check: (ctx) => ctx.files.some(f => /^contributing\.md$/i.test(f)),
      impact: 'low',
      rating: 3,
      category: 'hygiene',
      fix: 'Add a CONTRIBUTING.md with contribution guidelines and code standards.',
      template: null
    },

  license: {
      id: 434,
      name: 'Has LICENSE file',
      check: (ctx) => ctx.files.some(f => /^license/i.test(f)),
      impact: 'low',
      rating: 3,
      category: 'hygiene',
      fix: 'Add a LICENSE file to clarify usage rights.',
      template: null
    },

  editorconfig: {
      id: 5001,
      name: 'Has .editorconfig',
      check: (ctx) => ctx.files.includes('.editorconfig'),
      impact: 'low',
      rating: 3,
      category: 'hygiene',
      fix: 'Add .editorconfig for consistent formatting across editors and Claude.',
      template: null
    },

  nvmrc: {
      id: 5002,
      name: 'Node version pinned',
      check: (ctx) => {
        const hasNodeSignals = ctx.files.includes('package.json') ||
          ctx.files.includes('tsconfig.json') ||
          ctx.files.some(f => /package-lock\.json|pnpm-lock\.yaml|yarn\.lock|next\.config|vite\.config/i.test(f));
        if (!hasNodeSignals) return null;
        if (ctx.files.includes('.nvmrc') || ctx.files.includes('.node-version')) return true;
        const pkg = ctx.jsonFile('package.json');
        return !!(pkg && pkg.engines && pkg.engines.node);
      },
      impact: 'low',
      rating: 3,
      category: 'hygiene',
      fix: 'Add .nvmrc, .node-version, or engines.node in package.json to pin Node version.',
      template: null
    },

  gitAttributionDecision: {
      id: 2015,
      name: 'Git attribution configured',
      check: (ctx) => {
        const shared = ctx.jsonFile('.claude/settings.json') || {};
        const local = ctx.jsonFile('.claude/settings.local.json') || {};
        return shared.attribution !== undefined || local.attribution !== undefined ||
               shared.includeCoAuthoredBy !== undefined || local.includeCoAuthoredBy !== undefined;
      },
      impact: 'low', rating: 3, category: 'git',
      fix: 'Decide on git attribution: set attribution.commit or includeCoAuthoredBy in settings.',
      template: null
    },

  gitIgnoreClaudeLocal: {
      id: 2028,
      name: '.gitignore excludes settings.local.json',
      check: (ctx) => {
        const gitignore = ctx.fileContent('.gitignore') || '';
        return /settings\.local\.json|settings\.local/i.test(gitignore);
      },
      impact: 'medium', rating: 4, category: 'git',
      fix: 'Add .claude/settings.local.json to .gitignore. Personal overrides should not be committed.',
      template: null
    },

  envExampleExists: {
      id: 2029,
      name: '.env.example or .env.template exists',
      check: (ctx) => {
        return !!(ctx.fileContent('.env.example') || ctx.fileContent('.env.template') || ctx.fileContent('.env.sample'));
      },
      impact: 'low', rating: 3, category: 'hygiene',
      fix: 'Add .env.example so new developers know which environment variables are needed.',
      template: null
    },

  packageJsonHasScripts: {
      id: 2030,
      name: 'package.json has dev/test/build scripts',
      check: (ctx) => {
        const pkg = ctx.jsonFile('package.json');
        if (!pkg) return null;
        const scripts = pkg.scripts || {};
        const has = (k) => !!scripts[k];
        return has('test') || has('dev') || has('build') || has('start');
      },
      impact: 'medium', rating: 3, category: 'hygiene',
      fix: 'Add scripts to package.json (test, dev, build). Claude uses these for verification.',
      template: null
    },

  gitignoreClaudeLocal: {
      id: 2036,
      name: 'CLAUDE.local.md in .gitignore',
      check: (ctx) => {
        const gitignore = ctx.fileContent('.gitignore') || '';
        return /CLAUDE\.local\.md/i.test(gitignore);
      },
      impact: 'medium',
      rating: 3,
      category: 'git',
      fix: 'Add CLAUDE.local.md to .gitignore — it contains personal overrides that should not be committed.',
      template: null
    },

  readmeQuality: {
      id: 130151,
      name: 'README has installation, usage, and contributing sections',
      check: (ctx) => {
        const readme = ctx.fileContent('README.md') || '';
        if (!readme) return false;
        return /install/i.test(readme) && /usage/i.test(readme) && /contribut/i.test(readme);
      },
      impact: 'medium',
      category: 'docs-quality',
      fix: 'Ensure README.md includes installation, usage, and contributing sections for developer onboarding.',
      confidence: 0.7,
    },

  contributingGuide: {
      id: 130152,
      name: 'CONTRIBUTING.md exists',
      check: (ctx) => ctx.files.some(f => /^contributing\.md$/i.test(f)),
      impact: 'low',
      category: 'docs-quality',
      fix: 'Add CONTRIBUTING.md with contribution guidelines, code standards, and PR process.',
      confidence: 0.7,
    },

  apiDocsGenerated: {
      id: 130153,
      name: 'API documentation generator configured',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        if (/typedoc|jsdoc|apidoc|compodoc/i.test(pkg)) return true;
        const py = readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i) + readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
        if (/sphinx|pdoc|mkdocstrings/i.test(py)) return true;
        if (isGoProject(ctx) && hasProjectFile(ctx, /(^|\/)doc\.go$/i)) return true;
        return false;
      },
      impact: 'low',
      category: 'docs-quality',
      fix: 'Add an API documentation generator (typedoc, jsdoc, sphinx, godoc) for auto-generated docs.',
      confidence: 0.7,
    },

  storybookConfigured: {
      id: 130154,
      name: 'Storybook configured for component docs',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        return ctx.hasDir('.storybook') || hasProjectFile(ctx, /(^|\/)\.storybook\//i);
      },
      impact: 'low',
      category: 'docs-quality',
      fix: 'Add Storybook (.storybook/) for interactive component documentation and visual testing.',
      confidence: 0.7,
    },

  codeOfConduct: {
      id: 130155,
      name: 'CODE_OF_CONDUCT.md exists',
      check: (ctx) => ctx.files.some(f => /^code.of.conduct\.md$/i.test(f)),
      impact: 'low',
      category: 'docs-quality',
      fix: 'Add CODE_OF_CONDUCT.md to set community standards and expectations.',
      confidence: 0.7,
    },

  licenseDeclared: {
      id: 130156,
      name: 'LICENSE file exists',
      check: (ctx) => ctx.files.some(f => /^license/i.test(f)),
      impact: 'low',
      category: 'docs-quality',
      fix: 'Add a LICENSE file to clarify usage rights and legal terms.',
      confidence: 0.7,
    },
};
