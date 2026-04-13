/**
 * Aider Technique Database — 71 checks (AD-A01 through AD-P06)
 *
 * Aider is fundamentally different from IDE platforms:
 * - Git-first CLI tool: git is the ONLY safety mechanism
 * - No hooks, no MCP, no skills, no agents
 * - Config: .aider.conf.yml (YAML), .aider.model.settings.yml, .env
 * - 3 model roles: main (coding), editor (applying), weak (commit messages)
 * - Architect mode (2-model workflow, ~1.73x cost vs standard)
 * - Convention files must be EXPLICITLY passed AND referenced in prompts (no auto-discovery)
 * - 4-level config precedence: env vars > CLI args > .aider.conf.yml > defaults
 * - Key gotcha: default auto-commit bypasses pre-commit hooks (use --git-commit-verify)
 * - Key gotcha: exit code 0 returned even on auth failure in headless mode
 * - Key gotcha: Playwright auto-scrapes URLs in messages (unexpected side effect)
 *
 * Categories: Config(8), Git Safety(10), Model Config(8), Conventions(6),
 *   Architecture(4), Security(6), CI(4), Quality(6) + M/N/O/P expansion (19)
 *
 * Check ID prefix: AD-
 */

const { containsEmbeddedSecret } = require('../secret-patterns');
const { attachSourceUrls } = require('../source-urls');
const { buildStackChecks } = require('../stack-checks');
const { isApiProject, isDatabaseProject, isAuthProject, isMonitoringRelevant } = require('../supplemental-checks');
const { hasCostBudgetOrUsageTracking } = require('../cost-tracking');

const FILLER_PATTERNS = [
  /\bbe helpful\b/i,
  /\bbe accurate\b/i,
  /\bbe concise\b/i,
  /\balways do your best\b/i,
  /\bmaintain high quality\b/i,
  /\bwrite clean code\b/i,
  /\bfollow best practices\b/i,
];

function configContent(ctx) {
  return ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.aider.conf.yml') || '');
}

function envContent(ctx) {
  return ctx.envContent ? (ctx.envContent() || '') : (ctx.fileContent('.env') || '');
}

function modelSettingsContent(ctx) {
  return ctx.modelSettingsContent ? (ctx.modelSettingsContent() || '') : (ctx.fileContent('.aider.model.settings.yml') || '');
}

function conventionFiles(ctx) {
  return ctx.conventionFiles ? ctx.conventionFiles() : [];
}

function conventionContent(ctx) {
  const files = conventionFiles(ctx);
  return files.map(f => ctx.fileContent(f) || '').join('\n');
}

function gitignoreContent(ctx) {
  return ctx.gitignoreContent ? (ctx.gitignoreContent() || '') : (ctx.fileContent('.gitignore') || '');
}

function hasGitRepo(ctx) {
  return ctx.hasGitRepo ? ctx.hasGitRepo() : ctx.files.includes('.git/');
}

function modelRoles(ctx) {
  if (ctx.modelRoles) return ctx.modelRoles();
  const config = ctx.parsedConfig ? ctx.parsedConfig() : { ok: false, data: null };
  const data = config.ok ? config.data : {};
  return {
    main: data.model || data['main-model'] || null,
    editor: data['editor-model'] || null,
    weak: data['weak-model'] || null,
    architect: data.architect || false,
  };
}

function firstLineMatching(text, matcher) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (typeof matcher === 'string' && line.includes(matcher)) return index + 1;
    if (matcher instanceof RegExp && matcher.test(line)) { matcher.lastIndex = 0; return index + 1; }
    if (typeof matcher === 'function' && matcher(line, index + 1)) return index + 1;
  }
  return null;
}

function findFillerLine(content) {
  return firstLineMatching(content, (line) => FILLER_PATTERNS.some((pattern) => pattern.test(line)));
}

// PP-04: Helpers for N/A gating and broader instruction surfaces ---------------

function hasAiderConfig(ctx) {
  // .yml is canonical, .yaml is also accepted by Aider itself
  return Boolean(
    (ctx.fileContent && (ctx.fileContent('.aider.conf.yml') || ctx.fileContent('.aider.conf.yaml')))
  );
}

function hasAiderModelSettings(ctx) {
  return Boolean(
    ctx.fileContent && (ctx.fileContent('.aider.model.settings.yml') || ctx.fileContent('.aider.model.settings.yaml'))
  );
}

function hasAiderignore(ctx) {
  return Boolean(ctx.fileContent && ctx.fileContent('.aiderignore'));
}

function readmeContent(ctx) {
  return (
    (ctx.fileContent && (ctx.fileContent('README.md') || ctx.fileContent('readme.md') || ctx.fileContent('README.rst'))) || ''
  );
}

function contributingContent(ctx) {
  return (
    (ctx.fileContent && (ctx.fileContent('CONTRIBUTING.md') || ctx.fileContent('.github/CONTRIBUTING.md'))) || ''
  );
}

function aidermdContent(ctx) {
  return (
    (ctx.fileContent && (ctx.fileContent('AIDER.md') || ctx.fileContent('AGENTS.md') || ctx.fileContent('CLAUDE.md') || ctx.fileContent('.claude/CLAUDE.md'))) || ''
  );
}

// PP-04: Effective Aider docs surface — Aider has no auto-discovered instructions
// surface like CLAUDE.md, but real Aider users document Aider workflow across
// README, CONTRIBUTING, CONVENTIONS, AGENTS.md, CLAUDE.md, .ai/instructions.md.
function docsBundle(ctx) {
  const parts = [];
  parts.push(readmeContent(ctx));
  parts.push(contributingContent(ctx));
  parts.push(conventionContent(ctx));
  parts.push(aidermdContent(ctx));
  if (ctx.fileContent) {
    parts.push(ctx.fileContent('.ai/instructions.md') || '');
    parts.push(ctx.fileContent('docs/AIDER.md') || '');
    parts.push(ctx.fileContent('ARCHITECTURE.md') || '');
  }
  return parts.filter(Boolean).join('\n\n');
}

function hasAnyAiderSurface(ctx) {
  if (hasAiderConfig(ctx)) return true;
  if (hasAiderModelSettings(ctx)) return true;
  if (hasAiderignore(ctx)) return true;
  if (conventionFiles(ctx).length > 0) return true;
  // README/CONTRIBUTING/AGENTS/CLAUDE explicitly mentioning aider counts
  const docs = `${readmeContent(ctx)}\n${contributingContent(ctx)}\n${aidermdContent(ctx)}`;
  return /\baider\b/i.test(docs);
}

function isPythonProject(ctx) {
  if (!ctx.fileContent) return false;
  return Boolean(
    ctx.fileContent('requirements.txt') ||
      ctx.fileContent('Pipfile') ||
      ctx.fileContent('pyproject.toml') ||
      ctx.fileContent('setup.py') ||
      ctx.fileContent('setup.cfg')
  );
}

function hasArchitectMode(ctx) {
  const config = configContent(ctx);
  if (!config) return false;
  return /\barchitect\s*:\s*true\b/i.test(config) || /\barchitect-mode\s*:\s*true\b/i.test(config);
}

function hasEnvExample(ctx) {
  if (!ctx.fileContent) return false;
  return Boolean(
    ctx.fileContent('.env.example') ||
      ctx.fileContent('.env.sample') ||
      ctx.fileContent('.env.template') ||
      ctx.fileContent('.env.dist') ||
      ctx.fileContent('env.example')
  );
}

function repoLooksRegulated(ctx) {
  const filenames = ctx.files.join('\n');
  const packageJson = ctx.fileContent('package.json') || '';
  const readme = ctx.fileContent('README.md') || '';
  const combined = `${filenames}\n${packageJson}\n${readme}`;
  return /\bhipaa\b|\bphi\b|\bpci\b|\bsoc2\b|\biso[- ]?27001\b|\bcompliance\b|\bhealth(?:care)?\b|\bmedical\b|\bbank(?:ing)?\b|\bpayments?\b|\bfintech\b/i.test(combined);
}

// ============================================================================
// 68 AIDER TECHNIQUES
// ============================================================================

const AIDER_TECHNIQUES = {

  // =========================================================================
  // A — Config (8 checks: AD-A01 .. AD-A08)
  // =========================================================================

  aiderConfYmlExists: {
    id: 'AD-A01',
    name: '.aider.conf.yml config file exists',
    // PP-04: Both .yml and .yaml are accepted by Aider. The config file is
    // recommended but optional — many real Aider repos drive Aider entirely
    // via CONVENTIONS.md + CLI flags. N/A when no Aider surface at all so
    // arbitrary repos do not surface this as a top finding.
    check: (ctx) => {
      if (!hasAnyAiderSurface(ctx)) return null;
      return hasAiderConfig(ctx);
    },
    impact: 'critical',
    rating: 5,
    category: 'config',
    fix: 'Create .aider.conf.yml with project-specific Aider settings.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: () => null,
  },

  aiderConfYmlValid: {
    id: 'AD-A02',
    name: '.aider.conf.yml is valid YAML',
    check: (ctx) => {
      const content = configContent(ctx);
      if (!content) return null;
      const parsed = ctx.parsedConfig ? ctx.parsedConfig() : require('./config-parser').tryParseYaml(content);
      return parsed.ok;
    },
    impact: 'critical',
    rating: 5,
    category: 'config',
    fix: 'Fix YAML syntax errors in .aider.conf.yml.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: () => null,
  },

  aiderModelSpecified: {
    id: 'AD-A03',
    name: 'Main model explicitly configured',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      return /\bmodel\s*:/i.test(config) || /\bmain-model\s*:/i.test(config);
    },
    impact: 'high',
    rating: 4,
    category: 'config',
    fix: 'Set `model:` in .aider.conf.yml to pin the main coding model.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /\bmodel\s*:|main-model\s*:/i),
  },

  aiderAutoCommitsConfigured: {
    id: 'AD-A04',
    name: 'Auto-commits setting is explicit',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      return /\bauto-commits\s*:/i.test(config);
    },
    impact: 'high',
    rating: 4,
    category: 'config',
    fix: 'Set `auto-commits: true` in .aider.conf.yml to ensure git safety.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /auto-commits\s*:/i),
  },

  aiderMapTokensConfigured: {
    id: 'AD-A05',
    name: 'Map tokens setting is configured',
    // PP-04: Repo-map sizing is opt-in tuning — the default works for most
    // repos. N/A when not explicitly set; only fail if explicitly set to a
    // non-numeric or out-of-range value (caught by other checks).
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      if (/\bmap-tokens\s*:/i.test(config)) return true;
      return null;
    },
    impact: 'medium',
    rating: 3,
    category: 'config',
    fix: 'Set `map-tokens:` in .aider.conf.yml to control repo map size.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /map-tokens\s*:/i),
  },

  aiderLintCmdConfigured: {
    id: 'AD-A06',
    name: 'Lint command configured for auto-fix',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      return /\blint-cmd\s*:/i.test(config);
    },
    impact: 'high',
    rating: 4,
    category: 'config',
    fix: 'Set `lint-cmd:` in .aider.conf.yml so Aider can auto-fix lint errors.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /lint-cmd\s*:/i),
  },

  aiderTestCmdConfigured: {
    id: 'AD-A07',
    name: 'Test command configured for auto-fix',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      return /\btest-cmd\s*:/i.test(config);
    },
    impact: 'high',
    rating: 4,
    category: 'config',
    fix: 'Set `test-cmd:` in .aider.conf.yml so Aider can run and auto-fix tests.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /test-cmd\s*:/i),
  },

  aiderEditFormatConfigured: {
    id: 'AD-A08',
    name: 'Edit format explicitly set',
    // PP-04: Aider auto-selects edit-format per model; explicit override is
    // only needed for unusual setups. Pass when set, N/A when relying on the
    // sensible default.
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      if (/\bedit-format\s*:/i.test(config)) return true;
      return null;
    },
    impact: 'medium',
    rating: 3,
    category: 'config',
    fix: 'Set `edit-format:` (diff, whole, udiff, diff-fenced) in .aider.conf.yml for predictable edits.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /edit-format\s*:/i),
  },

  // =========================================================================
  // B — Git Safety (8 checks: AD-B01 .. AD-B08)
  // =========================================================================

  aiderGitRepoExists: {
    id: 'AD-B01',
    name: 'Project is a git repository',
    check: (ctx) => hasGitRepo(ctx),
    impact: 'critical',
    rating: 5,
    category: 'git-safety',
    fix: 'Initialize a git repo with `git init`. Aider requires git as its ONLY safety mechanism.',
    template: null,
    file: () => '.git',
    line: () => null,
  },

  aiderAutoCommitsEnabled: {
    id: 'AD-B02',
    name: 'Auto-commits not disabled (git safety)',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      // Failing = auto-commits explicitly set to false
      if (/\bauto-commits\s*:\s*false\b/i.test(config)) return false;
      return true;
    },
    impact: 'critical',
    rating: 5,
    category: 'git-safety',
    fix: 'Do not set `auto-commits: false` — git commits are Aider\'s primary safety mechanism.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /auto-commits\s*:\s*false/i),
  },

  aiderGitignoreCoversArtifacts: {
    id: 'AD-B03',
    name: '.gitignore includes .aider* artifacts',
    check: (ctx) => {
      const gi = gitignoreContent(ctx);
      if (!gi) return false;
      return /\.aider/i.test(gi);
    },
    impact: 'high',
    rating: 4,
    category: 'git-safety',
    fix: 'Add `.aider*` to .gitignore to exclude chat history and cache files.',
    template: 'gitignore',
    file: () => '.gitignore',
    line: (ctx) => firstLineMatching(gitignoreContent(ctx), /\.aider/i),
  },

  aiderDirtyTreeCheck: {
    id: 'AD-B04',
    name: 'No uncommitted changes when starting Aider (advisory)',
    check: (ctx) => {
      const status = ctx.gitStatus ? ctx.gitStatus() : null;
      if (status === null) return null; // Can't check
      return status === '';
    },
    impact: 'medium',
    rating: 3,
    category: 'git-safety',
    fix: 'Commit or stash changes before running Aider so its auto-commits stay clean.',
    template: null,
    file: () => null,
    line: () => null,
  },

  aiderDirtyCommitsNotDisabled: {
    id: 'AD-B05',
    name: 'Dirty-commits not disabled',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      if (/\bdirty-commits\s*:\s*false\b/i.test(config)) return false;
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'git-safety',
    fix: 'Keep `dirty-commits` enabled (default) so Aider can commit even with dirty working tree.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /dirty-commits\s*:\s*false/i),
  },

  aiderAttributeAuthorConfigured: {
    id: 'AD-B06',
    name: 'Attribute author/committer set for traceability',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      return /\battribute-author\s*:/i.test(config) || /\battribute-committer\s*:/i.test(config);
    },
    impact: 'medium',
    rating: 3,
    category: 'git-safety',
    fix: 'Set `attribute-author: true` or `attribute-committer: true` for AI-change traceability.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /attribute-(?:author|committer)\s*:/i),
  },

  aiderCommitPrefixConfigured: {
    id: 'AD-B07',
    name: 'Commit prefix set for AI-authored commits',
    // PP-04: Optional traceability nicety. Pass when set, N/A when not —
    // attribute-author/committer (AD-B06) covers the same intent at higher
    // confidence.
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      if (/\baider-commit-prefix\s*:/i.test(config) || /\bcommit-prefix\s*:/i.test(config)) return true;
      return null;
    },
    impact: 'low',
    rating: 2,
    category: 'git-safety',
    fix: 'Set `aider-commit-prefix:` to tag AI-authored commits (e.g., "aider: ").',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /commit-prefix\s*:/i),
  },

  aiderUndoSafetyAware: {
    id: 'AD-B08',
    name: '/undo command awareness documented',
    check: (ctx) => {
      // PP-04: Awareness check. N/A unless the repo has an .aider.conf.yml —
      // /undo is an Aider-specific concept and only meaningful for users who
      // have actually configured Aider.
      if (!hasAiderConfig(ctx)) return null;
      const docs = docsBundle(ctx);
      const config = configContent(ctx);
      if (!docs && !config) return null;
      return /\bundo\b/i.test(docs) || /\bundo\b/i.test(config);
    },
    impact: 'low',
    rating: 2,
    category: 'git-safety',
    fix: 'Document the /undo command in conventions for reverting Aider changes.',
    template: 'aider-conventions',
    file: () => null,
    line: () => null,
  },

  // =========================================================================
  // C — Model Config (8 checks: AD-C01 .. AD-C08)
  // =========================================================================

  aiderEditorModelConfigured: {
    id: 'AD-C01',
    name: 'Editor model explicitly configured',
    check: (ctx) => {
      // PP-04: editor-model is an architect-mode optimisation. N/A when not opted in.
      if (!hasAiderConfig(ctx)) return null;
      if (!hasArchitectMode(ctx)) return null;
      const roles = modelRoles(ctx);
      return roles.editor !== null;
    },
    impact: 'high',
    rating: 4,
    category: 'model-config',
    fix: 'Set `editor-model:` in .aider.conf.yml for the model that applies edits.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /editor-model\s*:/i),
  },

  aiderWeakModelConfigured: {
    id: 'AD-C02',
    name: 'Weak model configured for commit messages',
    check: (ctx) => {
      // PP-04: weak-model is a cost optimisation. N/A when no .aider.conf.yml.
      if (!hasAiderConfig(ctx)) return null;
      const roles = modelRoles(ctx);
      return roles.weak !== null;
    },
    impact: 'medium',
    rating: 3,
    category: 'model-config',
    fix: 'Set `weak-model:` in .aider.conf.yml for cheap commit message generation.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /weak-model\s*:/i),
  },

  aiderArchitectModeAvailable: {
    id: 'AD-C03',
    name: 'Architect mode configured (2-model workflow)',
    // PP-04: Architect mode is opt-in (~1.73x cost). Pass when on, N/A when
    // not set — most teams correctly stick with the cheaper standard mode.
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      if (/\barchitect\s*:\s*true\b/i.test(config)) return true;
      return null;
    },
    impact: 'high',
    rating: 4,
    category: 'model-config',
    fix: 'Set `architect: true` to use a 2-model workflow (architect plans, editor applies). NOTE: architect mode costs ~1.73x standard mode per edit ($0.00026 vs $0.00015 measured in live experiment). auto_accept_architect is on by default — no confirmation between steps.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /architect\s*:/i),
  },

  aiderModelSettingsFileExists: {
    id: 'AD-C04',
    name: '.aider.model.settings.yml exists for model customization',
    // PP-04: model settings file is opt-in advanced customization. N/A when no
    // .aider.conf.yml — there's no signal the team is using Aider intentionally.
    check: (ctx) => {
      if (!hasAiderConfig(ctx)) return null;
      return hasAiderModelSettings(ctx);
    },
    impact: 'medium',
    rating: 3,
    category: 'model-config',
    fix: 'Create .aider.model.settings.yml for custom model definitions and aliases.',
    template: 'aider-model-settings',
    file: () => '.aider.model.settings.yml',
    line: () => null,
  },

  aiderApiKeyInEnvNotConfig: {
    id: 'AD-C05',
    name: 'API keys in .env, not in .aider.conf.yml',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      // Fail if API keys are in the YAML config instead of .env
      return !/\b(?:api[_-]?key|openai[_-]?api[_-]?key|anthropic[_-]?api[_-]?key)\s*:/i.test(config);
    },
    impact: 'critical',
    rating: 5,
    category: 'model-config',
    fix: 'Move API keys to .env file, not .aider.conf.yml which may be committed.',
    template: 'aider-env',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /api[_-]?key\s*:/i),
  },

  aiderCachePromptsEnabled: {
    id: 'AD-C06',
    name: 'Prompt caching enabled for cost savings',
    // PP-04: Cost optimisation. Pass when explicitly on, N/A when not — only
    // some providers/models support prompt caching, so absence is not a defect.
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      if (/\bcache-prompts\s*:\s*true\b/i.test(config)) return true;
      return null;
    },
    impact: 'medium',
    rating: 3,
    category: 'model-config',
    fix: 'Set `cache-prompts: true` in .aider.conf.yml to reduce API costs.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /cache-prompts\s*:/i),
  },

  aiderMaxChatHistoryReasonable: {
    id: 'AD-C07',
    name: 'Max chat history tokens is bounded',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      const match = config.match(/\bmax-chat-history-tokens\s*:\s*(\d+)/i);
      if (!match) return null; // Not set, using default
      return Number.parseInt(match[1], 10) <= 32768;
    },
    impact: 'low',
    rating: 2,
    category: 'model-config',
    fix: 'Set `max-chat-history-tokens` to a reasonable limit (e.g., 16384) to control costs.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /max-chat-history-tokens\s*:/i),
  },

  aiderStreamEnabled: {
    id: 'AD-C08',
    name: 'Streaming not disabled',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      if (/\bno-stream\s*:\s*true\b/i.test(config) || /\bstream\s*:\s*false\b/i.test(config)) return false;
      return true;
    },
    impact: 'low',
    rating: 2,
    category: 'model-config',
    fix: 'Keep streaming enabled for better developer experience.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /no-stream\s*:\s*true|stream\s*:\s*false/i),
  },

  // =========================================================================
  // D — Conventions (6 checks: AD-D01 .. AD-D06)
  // =========================================================================

  aiderConventionFileExists: {
    id: 'AD-D01',
    name: 'Convention file exists for Aider context',
    check: (ctx) => {
      // PP-04: AGENTS.md / CLAUDE.md / .ai/instructions.md / AIDER.md count as
      // effective convention surfaces in real Aider repos — Aider users
      // routinely use these files as their context bundle even though Aider
      // itself does not auto-discover them. N/A when no Aider surface at all.
      if (!hasAnyAiderSurface(ctx)) return null;
      if (conventionFiles(ctx).length > 0) return true;
      if (ctx.fileContent && (ctx.fileContent('AGENTS.md') || ctx.fileContent('CLAUDE.md') || ctx.fileContent('.claude/CLAUDE.md') || ctx.fileContent('AIDER.md') || ctx.fileContent('.ai/instructions.md'))) return true;
      return false;
    },
    impact: 'high',
    rating: 4,
    category: 'conventions',
    fix: 'Create CONVENTIONS.md with project coding standards and pass via `read:` in .aider.conf.yml.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  aiderConventionLinkedInConfig: {
    id: 'AD-D02',
    name: 'Convention file referenced in .aider.conf.yml read list',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      return /\bread\s*:/i.test(config);
    },
    impact: 'high',
    rating: 4,
    category: 'conventions',
    fix: 'Add `read: [CONVENTIONS.md]` to .aider.conf.yml — Aider has NO auto-discovery. Additionally, convention files are only followed when EXPLICITLY referenced in the prompt itself (confirmed by live experiment with gpt-4o-mini). Just loading them via --read is not enough; your prompts must say "follow the conventions in CONVENTIONS.md".',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /read\s*:/i),
  },

  aiderConventionHasArchitecture: {
    id: 'AD-D03',
    name: 'Convention file includes architecture/structure section',
    // PP-04: Architecture content commonly lives in ARCHITECTURE.md, README,
    // AGENTS.md, or CLAUDE.md — not just CONVENTIONS.md. Widen source.
    check: (ctx) => {
      if (!hasAnyAiderSurface(ctx)) return null;
      const content = docsBundle(ctx);
      if (!content) return null;
      return /##\s+(?:Architecture|Structure|Project Map|Project Snapshot|Project Layout|Directory|Layout|Modules|Module Tiers|Components|Stack|Tech Stack|Overview|Tour)/i.test(content) ||
        /```mermaid/i.test(content) ||
        /\bproject\s+(?:layout|structure|snapshot)\b/i.test(content);
    },
    impact: 'high',
    rating: 4,
    category: 'conventions',
    fix: 'Add a ## Architecture section with project structure to your convention file.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  aiderConventionHasVerification: {
    id: 'AD-D04',
    name: 'Convention file includes verification commands',
    // PP-04: Test/lint commands frequently live in README, CONTRIBUTING.md,
    // AGENTS.md, or CLAUDE.md, not just CONVENTIONS.md. Widen source.
    check: (ctx) => {
      if (!hasAnyAiderSurface(ctx)) return null;
      const content = docsBundle(ctx);
      if (!content) return null;
      return /\bnpm (?:run )?test\b|\bpnpm test\b|\byarn test\b|\bpytest\b|\bgo test\b|\bcargo test\b|\bmake test\b|\bmvn test\b|\bgradle (?:test|check)\b|\brake test\b|\bdotnet test\b|\bswift test\b|\btox\b/i.test(content);
    },
    impact: 'high',
    rating: 4,
    category: 'conventions',
    fix: 'Add test/lint/build commands to your convention file for Aider to use.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  aiderConventionNoFiller: {
    id: 'AD-D05',
    name: 'Convention file has no filler/platitude lines',
    check: (ctx) => {
      const content = conventionContent(ctx);
      if (!content) return null;
      return !findFillerLine(content);
    },
    impact: 'medium',
    rating: 3,
    category: 'conventions',
    fix: 'Remove generic filler like "be helpful" — use specific, actionable instructions.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: (ctx) => findFillerLine(conventionContent(ctx)),
  },

  aiderConventionReasonableSize: {
    id: 'AD-D06',
    name: 'Convention file not excessively large',
    check: (ctx) => {
      const content = conventionContent(ctx);
      if (!content) return null;
      return content.length < 32768;
    },
    impact: 'medium',
    rating: 3,
    category: 'conventions',
    fix: 'Keep convention files under 32KB — large files consume context tokens.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  // =========================================================================
  // E — Architecture (4 checks: AD-E01 .. AD-E04)
  // =========================================================================

  aiderRepoMapEnabled: {
    id: 'AD-E01',
    name: 'Repo map not disabled',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      if (/\bmap-tokens\s*:\s*0\b/i.test(config) || /\bno-repo-map\s*:\s*true\b/i.test(config)) return false;
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'architecture',
    fix: 'Do not disable repo map — it gives Aider critical project structure awareness.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /map-tokens\s*:\s*0|no-repo-map\s*:\s*true/i),
  },

  aiderSubtreeUsedForLargeRepos: {
    id: 'AD-E02',
    name: 'Subtree-only or file filtering for large repos',
    check: (ctx) => {
      // Only relevant for large repos
      if (ctx.files.length < 100) return null;
      const config = configContent(ctx);
      if (!config) return null;
      return /\bsubtree-only\s*:\s*true\b/i.test(config) || /\bmap-tokens\s*:/i.test(config);
    },
    impact: 'medium',
    rating: 3,
    category: 'architecture',
    fix: 'Use `subtree-only: true` or limit `map-tokens` for large repositories.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /subtree-only\s*:|map-tokens\s*:/i),
  },

  aiderAiderignoreExists: {
    id: 'AD-E03',
    name: '.aiderignore file exists for file filtering',
    // PP-04: .aiderignore is a fully optional advanced filter. N/A unless the
    // repo has an .aider.conf.yml (the strongest "we use Aider intentionally"
    // signal). Most real Aider repos rely on .gitignore + repo-map and do not
    // ship an .aiderignore.
    check: (ctx) => {
      if (!hasAiderConfig(ctx)) return null;
      return hasAiderignore(ctx);
    },
    impact: 'medium',
    rating: 3,
    category: 'architecture',
    fix: 'Create .aiderignore to exclude files Aider should not edit (similar to .gitignore syntax).',
    template: 'aiderignore',
    file: () => '.aiderignore',
    line: () => null,
  },

  aiderAutoTestEnabled: {
    id: 'AD-E04',
    name: 'Auto-test enabled for verification loop',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      return /\bauto-test\s*:\s*true\b/i.test(config);
    },
    impact: 'high',
    rating: 4,
    category: 'architecture',
    fix: 'Set `auto-test: true` with `test-cmd` to enable automatic test verification.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /auto-test\s*:/i),
  },

  // =========================================================================
  // F — Security (6 checks: AD-F01 .. AD-F06)
  // =========================================================================

  aiderEnvInGitignore: {
    id: 'AD-F01',
    name: '.env file excluded from git',
    // PP-04: Only meaningful when the team uses Aider (or any tool that loads
    // .env). N/A when no Aider surface and no .env in the repo at all.
    check: (ctx) => {
      const gi = gitignoreContent(ctx);
      if (!hasAnyAiderSurface(ctx) && !(ctx.fileContent && ctx.fileContent('.env'))) return null;
      if (!gi) return false;
      return /^\.env$/m.test(gi) || /^\.env\b/m.test(gi) || /^\*\.env$/m.test(gi);
    },
    impact: 'critical',
    rating: 5,
    category: 'security',
    fix: 'Add `.env` to .gitignore to prevent API key leaks.',
    template: 'gitignore',
    file: () => '.gitignore',
    line: (ctx) => firstLineMatching(gitignoreContent(ctx), /^\.env/m),
  },

  aiderNoSecretsInConfig: {
    id: 'AD-F02',
    name: 'No embedded secrets in .aider.conf.yml',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      return !containsEmbeddedSecret(config);
    },
    impact: 'critical',
    rating: 5,
    category: 'security',
    fix: 'Remove secrets from .aider.conf.yml — use .env or environment variables instead.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: () => null,
  },

  aiderNoSecretsInConventions: {
    id: 'AD-F03',
    name: 'No embedded secrets in convention files',
    check: (ctx) => {
      const content = conventionContent(ctx);
      if (!content) return null;
      return !containsEmbeddedSecret(content);
    },
    impact: 'critical',
    rating: 5,
    category: 'security',
    fix: 'Remove secrets from convention files.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  aiderChatHistoryExcluded: {
    id: 'AD-F04',
    name: 'Chat history files excluded from git',
    check: (ctx) => {
      const gi = gitignoreContent(ctx);
      if (!gi) return false;
      return /\.aider\.chat\.history/i.test(gi) || /\.aider\*/i.test(gi) || /\.aider/i.test(gi);
    },
    impact: 'high',
    rating: 4,
    category: 'security',
    fix: 'Ensure .aider.chat.history.md is gitignored — it may contain sensitive context.',
    template: 'gitignore',
    file: () => '.gitignore',
    line: (ctx) => firstLineMatching(gitignoreContent(ctx), /\.aider/i),
  },

  aiderRegulatedRepoHasGuardrails: {
    id: 'AD-F05',
    name: 'Regulated repo has explicit guardrails in conventions',
    check: (ctx) => {
      if (!repoLooksRegulated(ctx)) return null;
      const content = conventionContent(ctx);
      if (!content) return false;
      return /\bsecurity\b|\bcompliance\b|\breview\b|\bapproval\b/i.test(content);
    },
    impact: 'high',
    rating: 4,
    category: 'security',
    fix: 'Add security and compliance guardrails to convention files for regulated repos.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  aiderNoAutoRunInUntrusted: {
    id: 'AD-F06',
    name: 'Auto-run commands not enabled in untrusted context',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      // suggest-shell-commands with auto-run is risky
      if (/\bauto-lint\s*:\s*true\b/i.test(config) && /\bauto-test\s*:\s*true\b/i.test(config)) {
        // Both auto-lint and auto-test — check if commands are explicit
        return /\blint-cmd\s*:/i.test(config) && /\btest-cmd\s*:/i.test(config);
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'security',
    fix: 'When using auto-lint/auto-test, always specify explicit commands.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: () => null,
  },

  // =========================================================================
  // G — CI (4 checks: AD-G01 .. AD-G04)
  // =========================================================================

  aiderCiWorkflowExists: {
    id: 'AD-G01',
    name: 'CI workflow exists',
    check: (ctx) => {
      const workflows = ctx.workflowFiles ? ctx.workflowFiles() : [];
      return workflows.length > 0;
    },
    impact: 'high',
    rating: 4,
    category: 'ci',
    fix: 'Add a CI workflow (.github/workflows/) to verify Aider-generated changes.',
    template: 'aider-ci',
    file: () => '.github/workflows/',
    line: () => null,
  },

  aiderCiRunsTests: {
    id: 'AD-G02',
    name: 'CI runs tests on Aider PRs',
    check: (ctx) => {
      const workflows = ctx.workflowFiles ? ctx.workflowFiles() : [];
      for (const wf of workflows) {
        const content = ctx.fileContent(wf) || '';
        if (/\btest\b/i.test(content) && /\bpull_request\b/i.test(content)) return true;
      }
      return workflows.length > 0 ? false : null;
    },
    impact: 'high',
    rating: 4,
    category: 'ci',
    fix: 'Ensure CI runs tests on pull requests — Aider changes should be verified.',
    template: 'aider-ci',
    file: () => '.github/workflows/',
    line: () => null,
  },

  aiderCiRunsLint: {
    id: 'AD-G03',
    name: 'CI runs linting',
    check: (ctx) => {
      const workflows = ctx.workflowFiles ? ctx.workflowFiles() : [];
      for (const wf of workflows) {
        const content = ctx.fileContent(wf) || '';
        if (/\blint\b/i.test(content)) return true;
      }
      return workflows.length > 0 ? false : null;
    },
    impact: 'medium',
    rating: 3,
    category: 'ci',
    fix: 'Add linting to CI to catch style issues in Aider-generated code.',
    template: 'aider-ci',
    file: () => '.github/workflows/',
    line: () => null,
  },

  aiderGitHooksForPreCommit: {
    id: 'AD-G04',
    name: 'Git pre-commit hooks or CI gates for quality',
    // PP-04: pre-commit hooks are opt-in. N/A when no Aider surface — and accept
    // CI-as-quality-gate (a workflow that runs lint/test on PR) as a valid
    // alternative to local pre-commit hooks.
    check: (ctx) => {
      if (!hasAnyAiderSurface(ctx)) return null;
      if (
        Boolean(ctx.fileContent('.pre-commit-config.yaml')) ||
        Boolean(ctx.fileContent('.pre-commit-config.yml')) ||
        Boolean(ctx.fileContent('.husky/pre-commit')) ||
        Boolean(ctx.fileContent('.lefthook.yml')) ||
        Boolean(ctx.fileContent('lefthook.yml'))
      ) return true;
      // Accept CI-side quality gate as equivalent
      const workflows = ctx.workflowFiles ? ctx.workflowFiles() : [];
      for (const wf of workflows) {
        const content = ctx.fileContent(wf) || '';
        if (/\b(lint|test|check|format)\b/i.test(content) && /\bpull_request\b|\bon:\s*\[/i.test(content)) return true;
      }
      return false;
    },
    impact: 'high',
    rating: 4,
    category: 'ci',
    fix: 'Add pre-commit hooks (pre-commit, husky, lefthook). IMPORTANT: Aider default auto-commit BYPASSES pre-commit hooks (confirmed by live experiment). If hooks are critical, pass --git-commit-verify to Aider to restore hook enforcement.',
    template: null,
    file: () => null,
    line: () => null,
  },

  aiderGitCommitVerify: {
    id: 'AD-G05',
    name: '--git-commit-verify recommended when pre-commit hooks exist',
    check: (ctx) => {
      // Only relevant if pre-commit hooks exist
      const hasHooks = Boolean(ctx.fileContent('.pre-commit-config.yaml')) ||
        Boolean(ctx.fileContent('.husky/pre-commit')) ||
        Boolean(ctx.fileContent('.lefthook.yml'));
      if (!hasHooks) return null;
      const config = configContent(ctx);
      if (!config) return false;
      // Check if git-commit-verify is set in config or documented in conventions
      return /git-commit-verify/i.test(config) ||
        /git-commit-verify/i.test(conventionContent(ctx));
    },
    impact: 'high',
    rating: 4,
    category: 'ci',
    fix: 'When pre-commit hooks exist, add --git-commit-verify to Aider invocations. Default Aider auto-commits SKIP pre-commit hooks entirely (experimentally confirmed). Without this flag, hooks that enforce security or quality checks are silently bypassed.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /git-commit-verify/i),
  },

  aiderCiExitCodeUnreliable: {
    id: 'AD-G06',
    name: 'CI scripts handle exit code 0 on auth failure (unreliable exit code)',
    check: (ctx) => {
      const workflows = ctx.workflowFiles ? ctx.workflowFiles() : [];
      if (workflows.length === 0) return null;
      // Check if any workflow mentions aider and has output checking
      for (const wf of workflows) {
        const content = ctx.fileContent(wf) || '';
        if (/aider/i.test(content)) {
          // Good if it checks output, not just exit code
          return /grep|check.*output|--json|error.*detect/i.test(content);
        }
      }
      return null;
    },
    impact: 'high',
    rating: 4,
    category: 'ci',
    fix: 'Aider returns exit code 0 even on auth failure (experimentally confirmed). CI scripts that use Aider MUST NOT rely solely on exit codes to detect failure. Check Aider output for error strings or use output parsing to detect real failures.',
    template: null,
    file: () => '.github/workflows/',
    line: () => null,
  },

  // =========================================================================
  // H — Quality (6 checks: AD-H01 .. AD-H06)
  // =========================================================================

  aiderConventionHasCodingStandards: {
    id: 'AD-H01',
    name: 'Convention file has coding standards section',
    // PP-04: Widen source to docsBundle (AGENTS.md / CLAUDE.md / CONTRIBUTING
    // commonly host the coding-standards section).
    check: (ctx) => {
      if (!hasAnyAiderSurface(ctx)) return null;
      const content = docsBundle(ctx);
      if (!content) return null;
      return /##\s+(?:Coding|Style|Standards|Formatting|Conventions|Guidelines|Code\s+Style|Hard constraints|Constraints|Platform conventions|Rules|Quick commands)/i.test(content) ||
        /\b(?:swift|rust|python|java|kotlin|go|typescript)\s+(?:and|\&)?\s*(?:platform\s+)?conventions?\b/i.test(content);
    },
    impact: 'high',
    rating: 4,
    category: 'quality',
    fix: 'Add a ## Coding Standards section to your convention file.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  aiderConventionHasErrorHandling: {
    id: 'AD-H02',
    name: 'Convention file covers error handling',
    check: (ctx) => {
      if (!hasAnyAiderSurface(ctx)) return null;
      const content = docsBundle(ctx);
      if (!content) return null;
      return /\berror\s+handling\b|\bexception\b|\btry[- ]catch\b|\bResult\s*<\b|\bpanic\b|\b\?\?\s+/i.test(content);
    },
    impact: 'medium',
    rating: 3,
    category: 'quality',
    fix: 'Document error handling patterns in your convention file.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  aiderConventionHasTestingGuidelines: {
    id: 'AD-H03',
    name: 'Convention file covers testing guidelines',
    check: (ctx) => {
      if (!hasAnyAiderSurface(ctx)) return null;
      const content = docsBundle(ctx);
      if (!content) return null;
      return /##\s+(?:Test|Testing|Tests)/i.test(content) ||
        /\bunit test\b|\bintegration test\b|\btest coverage\b|\bend[- ]to[- ]end\b/i.test(content);
    },
    impact: 'high',
    rating: 4,
    category: 'quality',
    fix: 'Add testing guidelines to your convention file.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  aiderAutoLintEnabled: {
    id: 'AD-H04',
    name: 'Auto-lint enabled for code quality',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      return /\bauto-lint\s*:\s*true\b/i.test(config);
    },
    impact: 'high',
    rating: 4,
    category: 'quality',
    fix: 'Set `auto-lint: true` with `lint-cmd` to auto-fix lint errors after edits.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /auto-lint\s*:/i),
  },

  aiderShowDiffsEnabled: {
    id: 'AD-H05',
    name: 'Show-diffs enabled for review',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      if (/\bshow-diffs\s*:\s*false\b/i.test(config)) return false;
      return true; // Default is true
    },
    impact: 'medium',
    rating: 3,
    category: 'quality',
    fix: 'Keep `show-diffs` enabled so you can review changes before accepting.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /show-diffs\s*:\s*false/i),
  },

  aiderPrettyOutput: {
    id: 'AD-H06',
    name: 'Pretty output not disabled',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      if (/\bno-pretty\s*:\s*true\b/i.test(config) || /\bpretty\s*:\s*false\b/i.test(config)) return false;
      return true;
    },
    impact: 'low',
    rating: 2,
    category: 'quality',
    fix: 'Keep pretty output enabled for better readability.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /no-pretty\s*:\s*true|pretty\s*:\s*false/i),
  },

  // =========================================================================
  // M — Advanced Config (4 checks: AD-M01 .. AD-M04)
  // =========================================================================

  aiderEnvFileExists: {
    id: 'AD-M01',
    name: '.env file exists with API configuration',
    // PP-04: .env is conventionally gitignored — its absence in a public repo
    // is the secure default, not a finding. Accept .env.example/.sample/.template
    // as valid evidence the team documents their env-var contract. N/A unless
    // there is an actual .aider.conf.yml — without one we have no signal the
    // team is on Aider rather than just mentioning it in docs.
    check: (ctx) => {
      if (!hasAiderConfig(ctx)) return null;
      if (ctx.fileContent && ctx.fileContent('.env')) return true;
      return hasEnvExample(ctx);
    },
    impact: 'high',
    rating: 4,
    category: 'advanced-config',
    fix: 'Create .env with OPENAI_API_KEY or ANTHROPIC_API_KEY for Aider.',
    template: 'aider-env',
    file: () => '.env',
    line: () => null,
  },

  aiderEnvHasApiKey: {
    id: 'AD-M02',
    name: '.env contains at least one API key',
    // PP-04: Already correctly N/A when no .env (committed). Also accept
    // .env.example/sample with placeholder keys as evidence the env contract
    // is documented (real .env is gitignored and won't be in the audit tree).
    check: (ctx) => {
      const env = envContent(ctx);
      if (env) {
        return /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENROUTER_API_KEY|DEEPSEEK_API_KEY|GEMINI_API_KEY|GROQ_API_KEY)\s*=/i.test(env);
      }
      // Fall back to an example file if no committed .env
      const example = (ctx.fileContent && (
        ctx.fileContent('.env.example') || ctx.fileContent('.env.sample') || ctx.fileContent('.env.template')
      )) || '';
      if (!example) return null;
      return /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|OPENROUTER_API_KEY|DEEPSEEK_API_KEY|GEMINI_API_KEY|GROQ_API_KEY)\s*=/i.test(example);
    },
    impact: 'high',
    rating: 4,
    category: 'advanced-config',
    fix: 'Add an API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.) to .env.',
    template: 'aider-env',
    file: () => '.env',
    line: () => null,
  },

  aiderYesAlwaysNotSet: {
    id: 'AD-M03',
    name: '--yes-always not set as default (safety)',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      return !/\byes-always\s*:\s*true\b/i.test(config);
    },
    impact: 'high',
    rating: 4,
    category: 'advanced-config',
    fix: 'Do not set `yes-always: true` in config — it bypasses all confirmation prompts.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /yes-always\s*:\s*true/i),
  },

  aiderVerboseNotDefault: {
    id: 'AD-M04',
    name: 'Verbose mode not enabled by default',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      return !/\bverbose\s*:\s*true\b/i.test(config);
    },
    impact: 'low',
    rating: 2,
    category: 'advanced-config',
    fix: 'Do not default `verbose: true` in config — use --verbose as a CLI flag when needed.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /verbose\s*:\s*true/i),
  },

  // =========================================================================
  // N — Workflow Patterns (4 checks: AD-N01 .. AD-N04)
  // =========================================================================

  aiderLintAndTestLoop: {
    id: 'AD-N01',
    name: 'Lint-and-test loop configured (lint-cmd + test-cmd + auto-lint + auto-test)',
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      const hasLint = /\blint-cmd\s*:/i.test(config) && /\bauto-lint\s*:\s*true\b/i.test(config);
      const hasTest = /\btest-cmd\s*:/i.test(config) && /\bauto-test\s*:\s*true\b/i.test(config);
      return hasLint && hasTest;
    },
    impact: 'high',
    rating: 4,
    category: 'workflow-patterns',
    fix: 'Configure the full lint-and-test loop: lint-cmd + auto-lint + test-cmd + auto-test.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: () => null,
  },

  aiderBrowserModeForDocs: {
    id: 'AD-N02',
    name: 'Browser integration known (/web command)',
    // PP-04: low-impact awareness. N/A unless an .aider.conf.yml exists —
    // /web is an Aider-specific in-chat command, not a generic concern.
    check: (ctx) => {
      if (!hasAiderConfig(ctx)) return null;
      const docs = docsBundle(ctx);
      if (!docs) return null;
      return /\b\/web\b|\bbrowser\s+(?:mode|docs)\b|\bbrowser\b.*\b\/web\b/i.test(docs);
    },
    impact: 'low',
    rating: 2,
    category: 'workflow-patterns',
    fix: 'Document the /web command in conventions for pulling in documentation.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  aiderInChatCommandsDocumented: {
    id: 'AD-N03',
    name: 'Key in-chat commands documented in conventions',
    // PP-04: Aider-specific in-chat commands. N/A unless an .aider.conf.yml
    // exists. Widen content source to docsBundle.
    check: (ctx) => {
      if (!hasAiderConfig(ctx)) return null;
      const content = docsBundle(ctx);
      if (!content) return null;
      const commands = ['/add', '/drop', '/run', '/test', '/undo', '/web', '/ask', '/code'];
      const found = commands.filter(cmd => content.includes(cmd));
      return found.length >= 2;
    },
    impact: 'medium',
    rating: 3,
    category: 'workflow-patterns',
    fix: 'Document key Aider commands (/add, /drop, /run, /test, /undo) in conventions.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  aiderVoiceModeAware: {
    id: 'AD-N04',
    name: 'Voice mode configuration known',
    // PP-04: Voice coding is a niche developer preference, not a project
    // requirement. Pass when documented, N/A otherwise (no team should be
    // penalised for not using voice coding).
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      if (/\bvoice-language\s*:/i.test(config) || /\bvoice\b/i.test(docsBundle(ctx))) return true;
      return null;
    },
    impact: 'low',
    rating: 2,
    category: 'workflow-patterns',
    fix: 'Optionally configure `voice-language:` for voice coding sessions.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /voice-language\s*:/i),
  },

  aiderPlaywrightUrlScraping: {
    id: 'AD-N05',
    name: 'Playwright URL auto-scraping side effect is expected',
    // PP-04: Niche awareness advisory. N/A unless an .aider.conf.yml exists.
    check: (ctx) => {
      if (!hasAiderConfig(ctx)) return null;
      const docs = docsBundle(ctx);
      const config = configContent(ctx);
      if (!docs && !config) return null;
      return /playwright|url.*scrap|scrape.*url|auto.*fetch|web.*fetch/i.test(docs) ||
        /playwright|url.*scrap/i.test(config);
    },
    impact: 'medium',
    rating: 3,
    category: 'workflow-patterns',
    fix: 'Aider automatically scrapes URLs found in messages using Playwright (experimentally confirmed side effect). This causes unexpected network requests and delays. Document this in conventions, and avoid putting real URLs in messages unless scraping is intentional.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  // =========================================================================
  // O — Editor Integration (4 checks: AD-O01 .. AD-O04)
  // =========================================================================

  aiderEditorIntegrationDocumented: {
    id: 'AD-O01',
    name: 'Editor integration documented (VS Code, NeoVim, etc.)',
    // PP-04: Editor integration is a developer-local concern, not a project
    // requirement — it tells team members which editor plugins exist for
    // Aider, but absence is not a real defect. N/A unless the repo has a
    // .aider.conf.yml AND the docs already discuss tooling/setup.
    check: (ctx) => {
      if (!hasAiderConfig(ctx)) return null;
      const content = docsBundle(ctx);
      if (!content) return null;
      return /\bvs\s*code\b|\bneovim\b|\bvim\b|\bemacs\b|\bjetbrains\b|\bintellij\b|\bsublime\b|\beditor[- ]integration\b/i.test(content);
    },
    impact: 'low',
    rating: 2,
    category: 'editor-integration',
    fix: 'Document editor integration (VS Code extension, NeoVim plugin) in conventions.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  aiderWatchModeKnown: {
    id: 'AD-O02',
    name: 'Watch mode (--watch-files) documented or configured',
    // PP-04: Niche feature awareness. N/A when no Aider config — without
    // .aider.conf.yml there's no place watch-files would meaningfully live.
    check: (ctx) => {
      if (!hasAiderConfig(ctx)) return null;
      const config = configContent(ctx);
      if (/\bwatch-files\s*:/i.test(config)) return true;
      const docs = docsBundle(ctx);
      return /\bwatch[- ]files\b|\b--watch\b/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'editor-integration',
    fix: 'Consider `watch-files: true` for automatic file change detection.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /watch-files\s*:/i),
  },

  aiderDarkModeConfigured: {
    id: 'AD-O03',
    name: 'Theme/dark mode configured for terminal',
    // PP-04: Cosmetic preference; not meaningful as a project-level requirement.
    // Downgrade to N/A across the board (kept as a check so the catalog still
    // surfaces it, but it should not be a "fail" advisory on real repos —
    // theme is a developer-local preference, not a project artifact).
    check: () => null,
    impact: 'low',
    rating: 1,
    category: 'editor-integration',
    fix: 'Set `dark-mode: true` or `light-mode: true` for terminal readability.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /dark-mode\s*:|light-mode\s*:/i),
  },

  aiderInputHistoryExcluded: {
    id: 'AD-O04',
    name: 'Input history file excluded from git',
    check: (ctx) => {
      const gi = gitignoreContent(ctx);
      if (!gi) return false;
      return /\.aider\.input\.history/i.test(gi) || /\.aider\*/i.test(gi) || /\.aider/i.test(gi);
    },
    impact: 'medium',
    rating: 3,
    category: 'editor-integration',
    fix: 'Ensure .aider.input.history is gitignored.',
    template: 'gitignore',
    file: () => '.gitignore',
    line: (ctx) => firstLineMatching(gitignoreContent(ctx), /\.aider/i),
  },

  // =========================================================================
  // P — Release Readiness (3 checks: AD-P01 .. AD-P03)
  // =========================================================================

  aiderVersionPinned: {
    id: 'AD-P01',
    name: 'Aider version pinned in requirements or package manager',
    // PP-04: Aider is a Python package — pinning is only meaningful for Python
    // projects. Non-Python repos use Aider via a separate venv, not via their
    // own dependency manifest. N/A when the project isn't Python.
    check: (ctx) => {
      if (!isPythonProject(ctx)) return null;
      if (!hasAnyAiderSurface(ctx)) return null;
      const req = ctx.fileContent('requirements.txt') || '';
      const pipfile = ctx.fileContent('Pipfile') || '';
      const pyproject = ctx.fileContent('pyproject.toml') || '';
      const setupPy = ctx.fileContent('setup.py') || '';
      return /\baider-chat\b/i.test(req) || /\baider-chat\b/i.test(pipfile) ||
        /\baider-chat\b/i.test(pyproject) || /\baider-chat\b/i.test(setupPy);
    },
    impact: 'medium',
    rating: 3,
    category: 'release-readiness',
    fix: 'Pin `aider-chat` version in requirements.txt or pyproject.toml.',
    template: null,
    file: () => null,
    line: () => null,
  },

  aiderAllConfigSurfacesPresent: {
    id: 'AD-P02',
    name: 'All essential Aider config surfaces present',
    // PP-04: .env is gitignored by convention; accept .env.example/sample as
    // evidence the env contract is documented. N/A unless an .aider.conf.yml
    // exists — otherwise this fails on every repo that mentions Aider in docs
    // but doesn't ship the full config triple.
    check: (ctx) => {
      if (!hasAiderConfig(ctx)) return null;
      const envFile = ctx.fileContent && ctx.fileContent('.env');
      const hasEnvSurface = Boolean(envFile) || hasEnvExample(ctx);
      const hasGitignore = Boolean(ctx.fileContent && ctx.fileContent('.gitignore'));
      return hasEnvSurface && hasGitignore;
    },
    impact: 'high',
    rating: 4,
    category: 'release-readiness',
    fix: 'Ensure .aider.conf.yml, .env, and .gitignore all exist.',
    template: null,
    file: () => null,
    line: () => null,
  },

  aiderDocumentedWorkflow: {
    id: 'AD-P03',
    name: 'Aider workflow documented in README or conventions',
    // PP-04: Widen to the full docsBundle (README/CONTRIBUTING/CONVENTIONS/
    // AGENTS/CLAUDE/.ai/instructions). N/A when no Aider surface at all.
    check: (ctx) => {
      if (!hasAnyAiderSurface(ctx)) return null;
      const docs = docsBundle(ctx);
      if (!docs) return null;
      return /\baider\b/i.test(docs) || /\baider[- ]chat\b/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'release-readiness',
    fix: 'Document Aider workflow in README.md or convention files.',
    template: 'aider-conventions',
    file: () => 'README.md',
    line: () => null,
  },

  aiderNoConflictingPlatformConfigs: {
    id: 'AD-P04',
    name: 'No conflicting platform configs (CLAUDE.md, AGENTS.md) without awareness',
    check: (ctx) => {
      // PP-04: Multi-platform is the norm in 2026, not a defect. Widen the
      // awareness source to the full docsBundle (CLAUDE.md often mentions
      // Aider, AGENTS.md often mentions Claude, README often does both).
      const hasAider = hasAiderConfig(ctx);
      const hasClaude = Boolean(ctx.fileContent('CLAUDE.md')) || Boolean(ctx.fileContent('.claude/CLAUDE.md'));
      const hasCodex = Boolean(ctx.fileContent('AGENTS.md'));
      if (!hasAider) return null;
      if (!hasClaude && !hasCodex) return true;
      const content = docsBundle(ctx);
      return /\bmulti[- ]?platform\b|\bclaude\b|\bcodex\b|\bagents?\.md\b|\baider\b/i.test(content);
    },
    impact: 'medium',
    rating: 3,
    category: 'release-readiness',
    fix: 'If using multiple AI platforms, document the multi-platform strategy in conventions.',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  aiderModelCostAwareness: {
    id: 'AD-P05',
    name: 'Model cost awareness configured (cache-prompts or explicit model selection)',
    // PP-04: Cost optimisation. Pass when any cost-aware knob is set; N/A
    // when none are — the default is sensible for most teams.
    check: (ctx) => {
      const config = configContent(ctx);
      if (!config) return null;
      if (/\bcache-prompts\s*:\s*true\b/i.test(config) ||
        /\bweak-model\s*:/i.test(config) ||
        /\beditor-model\s*:/i.test(config) ||
        /\bmodel\s*:/i.test(config)) return true;
      return null;
    },
    impact: 'medium',
    rating: 3,
    category: 'release-readiness',
    fix: 'Enable prompt caching or configure separate weak/editor models for cost optimization. Cost reference (measured): standard edit ~$0.00015, architect mode edit ~$0.00026 (~1.73x). Set cache-prompts: true for repeated context, and weak-model for commit messages to reduce costs.',
    template: 'aider-conf-yml',
    file: () => '.aider.conf.yml',
    line: (ctx) => firstLineMatching(configContent(ctx), /cache-prompts\s*:|weak-model\s*:|editor-model\s*:/i),
  },

  aiderGitBranchStrategy: {
    id: 'AD-P06',
    name: 'Git branch strategy for Aider work',
    // PP-04: Branch strategy lives in CONTRIBUTING / README more often than
    // CONVENTIONS. Widen source. N/A unless any Aider surface exists — we
    // don't expect arbitrary repos to document Aider-specific branching.
    check: (ctx) => {
      if (!hasAnyAiderSurface(ctx)) return null;
      const content = docsBundle(ctx);
      if (!content) return null;
      // Either explicit aider+branch combo, or a documented branching workflow
      // (feature-branch / git-flow / trunk-based) is enough.
      if (/\baider\b/i.test(content) && /\bbranch\b/i.test(content)) return true;
      return /\bfeature[- ]branch\b|\bgit[- ]flow\b|\btrunk[- ]based\b|\bpull request\b.*\bbranch\b/i.test(content);
    },
    impact: 'medium',
    rating: 3,
    category: 'release-readiness',
    fix: 'Document a branch strategy for Aider work (e.g., feature branches, PR workflow).',
    template: 'aider-conventions',
    file: () => 'CONVENTIONS.md',
    line: () => null,
  },

  // =============================================
  // T. Cross-Cutting Engineering (48 checks) — AD-T01..AD-T48
  // =============================================

  aiderTestFrameworkDetected: {
    id: 'AD-T01', name: 'Test framework detected in project',
    check: (ctx) => { const p = ctx.fileContent('package.json'); if (!p) return null; return /jest|vitest|mocha|jasmine|pytest/i.test(p) || ctx.files.some(f => /pytest|spec_helper|test_helper/i.test(f)); },
    impact: 'high', rating: 4, category: 'testing-strategy',
    fix: 'Add a test framework and document the test command in .aider.conf.yml `test-cmd:`.',
    template: null, file: () => 'package.json', line: () => null,
  },
  aiderCoverageConfigExists: {
    id: 'AD-T02', name: 'Coverage configuration exists',
    check: (ctx) => ctx.files.some(f => /\.nycrc|\.c8rc|jest\.config|vitest\.config|\.coveragerc/i.test(f)) || /coverage/i.test(ctx.fileContent('package.json') || ''),
    impact: 'medium', rating: 3, category: 'testing-strategy',
    fix: 'Add coverage configuration and set coverage thresholds in your test-cmd.',
    template: null, file: () => null, line: () => null,
  },
  aiderE2eSetupPresent: {
    id: 'AD-T03', name: 'E2E test setup present',
    check: (ctx) => ctx.files.some(f => /cypress\.config|playwright\.config|e2e\.(test|spec)\.(ts|js)/i.test(f)),
    impact: 'medium', rating: 3, category: 'testing-strategy',
    fix: 'Set up E2E tests (Playwright/Cypress) for integration-level coverage.',
    template: null, file: () => null, line: () => null,
  },
  aiderSnapshotTestsMentioned: {
    id: 'AD-T04', name: 'Snapshot testing strategy documented in conventions',
    check: (ctx) => { const conv = conventionContent(ctx); if (!conv.trim()) return null; return /snapshot/i.test(conv); },
    impact: 'low', rating: 2, category: 'testing-strategy',
    fix: 'Document snapshot testing strategy in CONVENTIONS.md for Aider.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderTestCommandDocumented: {
    id: 'AD-T05', name: 'Test command configured in .aider.conf.yml',
    check: (ctx) => { const config = configContent(ctx); if (!config) return null; return /\btest-cmd\s*:/i.test(config); },
    impact: 'high', rating: 4, category: 'testing-strategy',
    fix: 'Set `test-cmd:` in .aider.conf.yml so Aider can auto-verify changes.',
    template: 'aider-conf-yml', file: () => '.aider.conf.yml', line: () => null,
  },
  aiderCiRunsTests: {
    id: 'AD-T06', name: 'CI workflow runs tests',
    check: (ctx) => { const wfs = ctx.files.filter(f => /\.github\/workflows\/.*\.ya?ml$/i.test(f)); if (!wfs.length) return null; return wfs.some(f => /\btest\b|\bpytest\b|\bvitest\b|\bjest\b/i.test(ctx.fileContent(f) || '')); },
    impact: 'high', rating: 5, category: 'testing-strategy',
    fix: 'Add a test step to CI to verify Aider-generated changes.',
    template: null, file: () => '.github/workflows/', line: () => null,
  },
  aiderLinterConfigured: {
    id: 'AD-T07', name: 'Linter configured',
    check: (ctx) => ctx.files.some(f => /\.eslintrc|eslint\.config|\.pylintrc|\.ruff\.toml|\.flake8/i.test(f)) || /eslint|ruff|pylint/i.test(ctx.fileContent('package.json') || '') || /\blint-cmd\s*:/i.test(configContent(ctx)),
    impact: 'high', rating: 4, category: 'code-quality',
    fix: 'Configure a linter and set `lint-cmd:` in .aider.conf.yml for auto-linting.',
    template: 'aider-conf-yml', file: () => '.aider.conf.yml', line: () => null,
  },
  aiderFormatterConfigured: {
    id: 'AD-T08', name: 'Code formatter configured',
    check: (ctx) => ctx.files.some(f => /\.prettierrc|biome\.json|\.editorconfig/i.test(f)) || /prettier|biome/i.test(ctx.fileContent('package.json') || ''),
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Configure Prettier/Biome and add formatting to your lint-cmd chain.',
    template: null, file: () => null, line: () => null,
  },
  aiderDeadCodeDetection: {
    id: 'AD-T09', name: 'Dead code detection documented in conventions',
    check: (ctx) => { const conv = conventionContent(ctx); if (!conv.trim()) return null; return /dead.?code|unused.?(import|var)|knip|ts-prune/i.test(conv); },
    impact: 'low', rating: 2, category: 'code-quality',
    fix: 'Document dead code detection in CONVENTIONS.md (knip, ts-prune).',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderComplexityAwareness: {
    id: 'AD-T10', name: 'Code complexity constraints in conventions',
    check: (ctx) => { const conv = conventionContent(ctx); if (!conv.trim()) return null; return /complex|cyclomatic|function.{0,20}length|line.{0,20}limit/i.test(conv); },
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Add complexity constraints to CONVENTIONS.md for Aider to follow.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderConsistentNamingDocumented: {
    id: 'AD-T11', name: 'Naming conventions documented for Aider',
    check: (ctx) => { const conv = conventionContent(ctx); if (!conv.trim()) return null; return /camelCase|snake_case|PascalCase|naming.{0,30}convention/i.test(conv); },
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Add naming convention rules to CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderCodeReviewProcessMentioned: {
    id: 'AD-T12', name: 'Code review process documented',
    check: (ctx) => { const docs = conventionContent(ctx) + (ctx.fileContent('CONTRIBUTING.md') || ''); if (!docs.trim()) return null; return /code.?review|PR|pull.?request/i.test(docs); },
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Document code review process in CONTRIBUTING.md.',
    template: null, file: () => 'CONTRIBUTING.md', line: () => null,
  },
  aiderEndpointDocumentation: {
    id: 'AD-T13', name: 'API endpoint documentation present',
    check: (ctx) => !isApiProject(ctx) ? null : ctx.files.some(f => /openapi|swagger|api\.ya?ml|api\.json/i.test(f)),
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Add an OpenAPI/Swagger spec for Aider to understand the API surface.',
    template: null, file: () => null, line: () => null,
  },
  aiderApiVersioningMentioned: {
    id: 'AD-T14', name: 'API versioning strategy documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const conv = conventionContent(ctx); if (!conv.trim()) return null; return /api.{0,10}version|\/v\d|versioning/i.test(conv); },
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Document API versioning in CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderErrorHandlingPatterns: {
    id: 'AD-T15', name: 'Error handling patterns in conventions',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const conv = conventionContent(ctx); if (!conv.trim()) return null; return /error.{0,15}handl|exception|try.?catch|Result\s*</i.test(conv); },
    impact: 'high', rating: 4, category: 'api-design',
    fix: 'Add error handling patterns to CONVENTIONS.md for Aider.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderRateLimitingAwareness: {
    id: 'AD-T16', name: 'Rate limiting awareness documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = conventionContent(ctx) + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /rate.?limit|throttl|429/i.test(docs); },
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Document rate limiting in CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderRequestValidation: {
    id: 'AD-T17', name: 'Request validation strategy documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const conv = conventionContent(ctx); if (!conv.trim()) return null; return /validat|zod|yup|joi\b/i.test(conv); },
    impact: 'high', rating: 4, category: 'api-design',
    fix: 'Document request validation (Zod, Yup) in CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderResponseFormatConsistent: {
    id: 'AD-T18', name: 'Response format consistency documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const conv = conventionContent(ctx); if (!conv.trim()) return null; return /response.{0,20}format|json.{0,10}response|envelope/i.test(conv); },
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Document standard response format in CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderMigrationStrategyDocumented: {
    id: 'AD-T19', name: 'Database migration strategy documented',
    check: (ctx) => !isDatabaseProject(ctx) ? null : ctx.files.some(f => /migrations?\//i.test(f)) || /migration|alembic|flyway/i.test(conventionContent(ctx)),
    impact: 'high', rating: 4, category: 'database',
    fix: 'Document migration strategy in CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderQueryOptimizationMentioned: {
    id: 'AD-T20', name: 'Query optimization guidance documented',
    check: (ctx) => { if (!isDatabaseProject(ctx)) return null; const conv = conventionContent(ctx); if (!conv.trim()) return null; return /n\+1|query.{0,15}optim|index|eager.{0,10}load/i.test(conv); },
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Add N+1 prevention patterns to CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderConnectionPoolingConfigured: {
    id: 'AD-T21', name: 'Connection pooling documented',
    check: (ctx) => { if (!isDatabaseProject(ctx)) return null; const docs = conventionContent(ctx) + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /connection.{0,15}pool|pool.{0,15}size/i.test(docs); },
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Document connection pooling in CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderBackupStrategyDocumented: {
    id: 'AD-T22', name: 'Database backup strategy documented',
    check: (ctx) => { if (!isDatabaseProject(ctx)) return null; const docs = conventionContent(ctx) + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /backup|restore|point.?in.?time/i.test(docs); },
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Document database backup strategy in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  aiderSchemaDocumentation: {
    id: 'AD-T23', name: 'Database schema documentation present',
    check: (ctx) => !isDatabaseProject(ctx) ? null : ctx.files.some(f => /schema\.(prisma|sql|graphql)|erd|dbml/i.test(f)),
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Add schema documentation so Aider understands the data model.',
    template: null, file: () => null, line: () => null,
  },
  aiderSeedDataMentioned: {
    id: 'AD-T24', name: 'Seed data strategy documented',
    check: (ctx) => !isDatabaseProject(ctx) ? null : ctx.files.some(f => /seed\.(ts|js|sql|py)|fixtures\//i.test(f)) || /seed.{0,10}data/i.test(conventionContent(ctx)),
    impact: 'low', rating: 2, category: 'database',
    fix: 'Add seed scripts and document local database setup.',
    template: null, file: () => null, line: () => null,
  },
  aiderAuthFlowDocumented: {
    id: 'AD-T25', name: 'Authentication flow documented in conventions',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const conv = conventionContent(ctx); if (!conv.trim()) return null; return /auth.{0,15}flow|login.{0,15}flow|authenticate/i.test(conv); },
    impact: 'high', rating: 4, category: 'authentication',
    fix: 'Document authentication flow in CONVENTIONS.md for Aider.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderTokenHandlingGuidance: {
    id: 'AD-T26', name: 'Token handling guidance in conventions',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const conv = conventionContent(ctx); if (!conv.trim()) return null; return /jwt|token.{0,15}refresh|access.{0,10}token|bearer/i.test(conv); },
    impact: 'high', rating: 4, category: 'authentication',
    fix: 'Document JWT/token patterns in CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderSessionManagementDocumented: {
    id: 'AD-T27', name: 'Session management documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const conv = conventionContent(ctx); if (!conv.trim()) return null; return /session.{0,15}manag|cookie|next.?auth/i.test(conv); },
    impact: 'medium', rating: 3, category: 'authentication',
    fix: 'Document session management approach in CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderRbacPermissionsReferenced: {
    id: 'AD-T28', name: 'RBAC / permissions model referenced',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const conv = conventionContent(ctx); if (!conv.trim()) return null; return /rbac|role.?based|permission|authorization/i.test(conv); },
    impact: 'high', rating: 4, category: 'authentication',
    fix: 'Document RBAC/permissions model in CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderOauthSsoMentioned: {
    id: 'AD-T29', name: 'OAuth/SSO configuration documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = conventionContent(ctx) + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /oauth|sso|saml|oidc/i.test(docs); },
    impact: 'medium', rating: 3, category: 'authentication',
    fix: 'Document OAuth/SSO provider in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  aiderCredentialRotationDocumented: {
    id: 'AD-T30', name: 'Credential rotation policy documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const conv = conventionContent(ctx); if (!conv.trim()) return null; return /rotat.{0,10}secret|rotat.{0,10}key|credential.{0,10}rotat/i.test(conv); },
    impact: 'medium', rating: 3, category: 'authentication',
    fix: 'Document credential rotation in CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderLoggingConfigured: {
    id: 'AD-T31', name: 'Logging framework configured',
    check: (ctx) => !isMonitoringRelevant(ctx) ? null : /winston|pino|bunyan|morgan|loguru/i.test(ctx.fileContent('package.json') || '') || ctx.files.some(f => /log(ger|ging)\.config/i.test(f)),
    impact: 'high', rating: 4, category: 'monitoring',
    fix: 'Add a logging framework and document log levels in CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderErrorTrackingSetup: {
    id: 'AD-T32', name: 'Error tracking service configured',
    check: (ctx) => !isMonitoringRelevant(ctx) ? null : /sentry|bugsnag|rollbar/i.test(ctx.fileContent('package.json') || ''),
    impact: 'high', rating: 4, category: 'monitoring',
    fix: 'Set up error tracking (Sentry) to catch production errors.',
    template: null, file: () => null, line: () => null,
  },
  aiderApmMetricsMentioned: {
    id: 'AD-T33', name: 'APM / metrics platform documented',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = conventionContent(ctx) + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /datadog|newrelic|prometheus|grafana|apm|opentelemetry/i.test(docs); },
    impact: 'medium', rating: 3, category: 'monitoring',
    fix: 'Document APM platform in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  aiderHealthCheckEndpoint: {
    id: 'AD-T34', name: 'Health check endpoint documented',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = conventionContent(ctx) + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /health.?check|\/health|\/ping|\/status/i.test(docs); },
    impact: 'medium', rating: 3, category: 'monitoring',
    fix: 'Document health check endpoint in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  aiderAlertingReferenced: {
    id: 'AD-T35', name: 'Alerting strategy referenced',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = conventionContent(ctx) + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /alert|pagerduty|opsgenie|oncall|incident/i.test(docs); },
    impact: 'medium', rating: 3, category: 'monitoring',
    fix: 'Document alerting strategy in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  aiderLogRotationMentioned: {
    id: 'AD-T36', name: 'Log rotation / retention documented',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = conventionContent(ctx) + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /log.{0,15}rotat|log.{0,15}retent/i.test(docs); },
    impact: 'low', rating: 2, category: 'monitoring',
    fix: 'Document log rotation policy in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  aiderLockfilePresent: {
    id: 'AD-T37', name: 'Dependency lockfile present',
    check: (ctx) => ctx.files.some(f => /package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|cargo\.lock/i.test(f)),
    impact: 'critical', rating: 5, category: 'dependency-management',
    fix: 'Commit your lockfile for reproducible Aider environments.',
    template: null, file: () => null, line: () => null,
  },
  aiderOutdatedDepsAwareness: {
    id: 'AD-T38', name: 'Outdated dependency awareness configured',
    check: (ctx) => ctx.files.some(f => /\.github\/dependabot\.yml|renovate\.json/i.test(f)),
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Enable Dependabot for automated dependency updates.',
    template: null, file: () => '.github/dependabot.yml', line: () => null,
  },
  aiderLicenseCompliance: {
    id: 'AD-T39', name: 'License compliance awareness configured',
    check: (ctx) => /license-checker|licensee|fossa/i.test(ctx.fileContent('package.json') || ''),
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Add license compliance checking (license-checker).',
    template: null, file: () => null, line: () => null,
  },
  aiderNpmAuditConfigured: {
    id: 'AD-T40', name: 'Security audit in CI',
    check: (ctx) => { const wfs = ctx.files.filter(f => /\.github\/workflows\/.*\.ya?ml$/i.test(f)); return wfs.some(f => /npm audit|yarn audit|snyk/i.test(ctx.fileContent(f) || '')); },
    impact: 'high', rating: 4, category: 'dependency-management',
    fix: 'Add `npm audit` to CI to catch vulnerable dependencies.',
    template: null, file: () => '.github/workflows/', line: () => null,
  },
  aiderPinnedVersionsUsed: {
    id: 'AD-T41', name: 'Critical dependency versions pinned',
    check: (ctx) => { const p = ctx.fileContent('package.json'); if (!p) return null; try { const pkg = JSON.parse(p); const vals = Object.values({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }); if (!vals.length) return null; return vals.filter(v => /^\d/.test(String(v))).length / vals.length >= 0.1; } catch { return null; } },
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Pin critical dependencies to exact versions.',
    template: null, file: () => 'package.json', line: () => null,
  },
  aiderAutoUpdatePolicy: {
    id: 'AD-T42', name: 'Dependency auto-update policy',
    check: (ctx) => ctx.files.some(f => /\.github\/dependabot\.yml|renovate\.json|\.renovaterc/i.test(f)),
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Configure Dependabot for automated dependency updates.',
    template: null, file: () => '.github/dependabot.yml', line: () => null,
  },
  aiderTokenUsageAwareness: {
    id: 'AD-T43', name: 'Token usage awareness in conventions',
    check: (ctx) => { const conv = conventionContent(ctx); if (!conv.trim()) return null; return /token.{0,15}usage|token.{0,15}budget|context.{0,15}window/i.test(conv); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document token budget awareness in CONVENTIONS.md for Aider.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderModelSelectionGuidance: {
    id: 'AD-T44', name: 'Model selection guidance in config',
    check: (ctx) => { const config = configContent(ctx); if (!config) return null; return /\bmodel\s*:|gpt-4|claude-3|claude-4|opus|sonnet|flash/i.test(config); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Configure model selection in .aider.conf.yml for cost/quality balance.',
    template: 'aider-conf-yml', file: () => '.aider.conf.yml', line: () => null,
  },
  aiderCachingToReduceApiCalls: {
    id: 'AD-T45', name: 'Caching strategy documented',
    check: (ctx) => { const conv = conventionContent(ctx); if (!conv.trim()) return null; return /cach.{0,15}api|redis|memcache|cache-control/i.test(conv); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document caching strategies in CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderBatchProcessingMentioned: {
    id: 'AD-T46', name: 'Batch processing patterns documented',
    check: (ctx) => { const conv = conventionContent(ctx); if (!conv.trim()) return null; return /batch.{0,15}process|bulk.{0,15}operat|queue|background.{0,15}job/i.test(conv); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document batch processing patterns in CONVENTIONS.md.',
    template: 'aider-conventions', file: () => 'CONVENTIONS.md', line: () => null,
  },
  aiderPromptCachingEnabled: {
    id: 'AD-T47', name: 'Prompt caching configured',
    check: (ctx) => { const config = configContent(ctx); if (!config) return null; return /\bcache-prompts\s*:\s*true\b/i.test(config); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Set `cache-prompts: true` in .aider.conf.yml to reduce API costs.',
    template: 'aider-conf-yml', file: () => '.aider.conf.yml', line: () => null,
  },
  aiderCostBudgetDefined: {
    id: 'AD-T48', name: 'AI cost budget or per-run usage tracking documented',
    check: (ctx) => {
      const docs = conventionContent(ctx) + (ctx.fileContent('README.md') || '');
      if (!docs.trim() && !hasCostBudgetOrUsageTracking('', ctx)) return null;
      return hasCostBudgetOrUsageTracking(docs, ctx);
    },
    impact: 'low', rating: 2, category: 'cost-optimization',
    fix: 'Document AI cost guardrails or per-run usage tracking so Aider usage is visible run by run.',
    template: null, file: () => 'README.md', line: () => null,
  },

  // ============================================================
  // === PYTHON STACK CHECKS (category: 'python') ===============
  // ============================================================

  aiderPythonProjectExists: {
    id: 'AD-PY01',
    name: 'Python project detected (pyproject.toml / setup.py / requirements.txt)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return true; },
    impact: 'high',
    category: 'python',
    fix: 'Ensure pyproject.toml, setup.py, or requirements.txt exists for Python projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonVersionSpecified: {
    id: 'AD-PY02',
    name: 'Python version specified (.python-version or requires-python)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /\.python-version$/.test(f)) || /requires-python/i.test(ctx.fileContent('pyproject.toml') || ''); },
    impact: 'medium',
    category: 'python',
    fix: 'Create .python-version or add requires-python to pyproject.toml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonVenvMentioned: {
    id: 'AD-PY03',
    name: 'Virtual environment mentioned in instructions',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /venv|virtualenv|conda|poetry shell|uv venv/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document virtual environment setup in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonLockfileExists: {
    id: 'AD-PY04',
    name: 'Python lockfile exists (poetry.lock / uv.lock / Pipfile.lock / pinned requirements)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /poetry\.lock$|uv\.lock$|Pipfile\.lock$/.test(f)) || /==/m.test(ctx.fileContent('requirements.txt') || ''); },
    impact: 'high',
    category: 'python',
    fix: 'Add a lockfile (poetry.lock, uv.lock, Pipfile.lock) or pin versions with == in requirements.txt.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonPytestConfigured: {
    id: 'AD-PY05',
    name: 'pytest configured (pyproject.toml [tool.pytest] / pytest.ini / conftest.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return /\[tool\.pytest/i.test(ctx.fileContent('pyproject.toml') || '') || ctx.files.some(f => /pytest\.ini$|conftest\.py$/.test(f)); },
    impact: 'high',
    category: 'python',
    fix: 'Configure pytest in pyproject.toml [tool.pytest.ini_options] or create pytest.ini.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonLinterConfigured: {
    id: 'AD-PY06',
    name: 'Python linter configured (ruff / flake8 / pylint)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.ruff|\[tool\.flake8|\[tool\.pylint/i.test(pp) || ctx.files.some(f => /\.flake8$|pylintrc$|\.pylintrc$|ruff\.toml$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure ruff, flake8, or pylint in pyproject.toml or dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonTypeCheckerConfigured: {
    id: 'AD-PY07',
    name: 'Type checker configured (mypy / pyright)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.mypy|\[tool\.pyright/i.test(pp) || ctx.files.some(f => /mypy\.ini$|pyrightconfig\.json$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure mypy or pyright in pyproject.toml or dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonFormatterConfigured: {
    id: 'AD-PY08',
    name: 'Formatter configured (black / isort / ruff format)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.black|\[tool\.isort|\[tool\.ruff\.format/i.test(pp); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure black, isort, or ruff format in pyproject.toml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonDjangoSettingsDocumented: {
    id: 'AD-PY09',
    name: 'Django settings documented if Django project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; if (!ctx.files.some(f => /manage\.py$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /django|settings\.py|DJANGO_SETTINGS_MODULE/i.test(docs); },
    impact: 'high',
    category: 'python',
    fix: 'Document Django settings module and configuration in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonFastapiEntryDocumented: {
    id: 'AD-PY10',
    name: 'FastAPI entry point documented if FastAPI project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/fastapi/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /fastapi|uvicorn|app\.py|main\.py/i.test(docs); },
    impact: 'high',
    category: 'python',
    fix: 'Document FastAPI entry point and how to run the development server.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonMigrationsDocumented: {
    id: 'AD-PY11',
    name: 'Database migrations mentioned (alembic / Django migrations)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /alembic|migrate|makemigrations|django.{0,10}migration/i.test(docs) || ctx.files.some(f => /alembic[.]ini$|alembic[/]/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Document database migration workflow (alembic or Django migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonEnvHandlingDocumented: {
    id: 'AD-PY12',
    name: '.env handling documented (python-dotenv)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/dotenv|python-dotenv|environs/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /\.env|dotenv|environment.{0,10}variable/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document .env file usage and python-dotenv configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonPreCommitConfigured: {
    id: 'AD-PY13',
    name: 'pre-commit hooks configured (.pre-commit-config.yaml)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /\.pre-commit-config\.yaml$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Add .pre-commit-config.yaml with Python-specific hooks (ruff, mypy, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonDockerBaseImage: {
    id: 'AD-PY14',
    name: 'Docker uses Python base image correctly',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const df = ctx.fileContent('Dockerfile') || ''; if (!df) return null; return /FROM.*python:/i.test(df); },
    impact: 'medium',
    category: 'python',
    fix: 'Use official Python base image in Dockerfile (e.g., FROM python:3.12-slim).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonTestMatrixConfigured: {
    id: 'AD-PY15',
    name: 'Test matrix configured (tox.ini / noxfile.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /tox\.ini$|noxfile\.py$/.test(f)); },
    impact: 'low',
    category: 'python',
    fix: 'Configure tox or nox for multi-environment testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonValidationUsed: {
    id: 'AD-PY16',
    name: 'Pydantic or dataclass validation used',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); return /pydantic|dataclass/i.test(deps); },
    impact: 'medium',
    category: 'python',
    fix: 'Use pydantic or dataclasses for data validation and type safety.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonAsyncDocumented: {
    id: 'AD-PY17',
    name: 'Async patterns documented if async project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/asyncio|aiohttp|fastapi|starlette|httpx/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /async|await|asyncio|event.{0,5}loop/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document async patterns and conventions used in the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonPinnedVersions: {
    id: 'AD-PY18',
    name: 'Requirements have pinned versions (== in requirements.txt)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const req = ctx.fileContent('requirements.txt') || ''; if (!req.trim()) return null; const lines = req.split('\n').filter(l => l.trim() && !l.startsWith('#')); return lines.length > 0 && lines.every(l => /==/.test(l) || /^-/.test(l.trim())); },
    impact: 'high',
    category: 'python',
    fix: 'Pin all dependency versions with == in requirements.txt for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonPackageStructure: {
    id: 'AD-PY19',
    name: 'Python package has proper structure (src/ layout or __init__.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /src[/].*[/]__init__\.py$|^[^/]+[/]__init__\.py$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Use src/ layout or ensure packages have __init__.py files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonDocsToolConfigured: {
    id: 'AD-PY20',
    name: 'Documentation tool configured (sphinx / mkdocs)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /mkdocs\.yml$|conf\.py$|docs[/]/.test(f)) || /sphinx|mkdocs/i.test(ctx.fileContent('pyproject.toml') || ''); },
    impact: 'low',
    category: 'python',
    fix: 'Configure sphinx or mkdocs for project documentation.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonCoverageConfigured: {
    id: 'AD-PY21',
    name: 'Coverage configured (coverage / pytest-cov)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.coverage|pytest-cov|coverage/i.test(pp) || ctx.files.some(f => /\.coveragerc$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure coverage reporting with pytest-cov or coverage.py.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonNoSecretsInSettings: {
    id: 'AD-PY22',
    name: 'No secrets in Django settings.py',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const settings = ctx.fileContent('settings.py') || ctx.files.filter(f => /settings\.py$/.test(f)).map(f => ctx.fileContent(f) || '').join(''); if (!settings) return null; return !/SECRET_KEY\s*=\s*['"][^'"]{10,}/i.test(settings); },
    impact: 'critical',
    category: 'python',
    fix: 'Move SECRET_KEY and other secrets to environment variables, not hardcoded in settings.py.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonWsgiAsgiDocumented: {
    id: 'AD-PY23',
    name: 'WSGI/ASGI server documented (gunicorn / uvicorn)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/gunicorn|uvicorn|daphne|hypercorn/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /gunicorn|uvicorn|daphne|hypercorn|wsgi|asgi/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document WSGI/ASGI server configuration (gunicorn, uvicorn).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonTaskQueueDocumented: {
    id: 'AD-PY24',
    name: 'Task queue documented if used (celery / rq)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/celery|rq|dramatiq|huey/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /celery|rq|dramatiq|huey|task.{0,10}queue|worker/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document task queue configuration and worker setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderPythonGitignore: {
    id: 'AD-PY25',
    name: 'Python-specific .gitignore (__pycache__, *.pyc, .venv)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const gi = ctx.fileContent('.gitignore') || ''; return /__pycache__|\*\.pyc|\.venv/i.test(gi); },
    impact: 'medium',
    category: 'python',
    fix: 'Add Python-specific entries to .gitignore (__pycache__, *.pyc, .venv, *.egg-info).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === GO STACK CHECKS (category: 'go') =======================
  // ============================================================

  aiderGoModExists: {
    id: 'AD-GO01',
    name: 'go.mod exists',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'go',
    fix: 'Initialize Go module with go mod init.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoSumCommitted: {
    id: 'AD-GO02',
    name: 'go.sum committed',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /go\.sum$/.test(f)); },
    impact: 'high',
    category: 'go',
    fix: 'Commit go.sum to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGolangciLintConfigured: {
    id: 'AD-GO03',
    name: 'golangci-lint configured (.golangci.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /\.golangci\.ya?ml$|\.golangci\.toml$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Add .golangci.yml to configure linting rules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoTestDocumented: {
    id: 'AD-GO04',
    name: 'go test documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go test/i.test(docs); },
    impact: 'high',
    category: 'go',
    fix: 'Document go test command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoBuildDocumented: {
    id: 'AD-GO05',
    name: 'go build documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go build|go install/i.test(docs); },
    impact: 'high',
    category: 'go',
    fix: 'Document go build command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoStandardLayout: {
    id: 'AD-GO06',
    name: 'Standard Go layout (cmd/ / internal/ / pkg/)',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /^cmd[/]|^internal[/]|^pkg[/]/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Use standard Go project layout with cmd/, internal/, and/or pkg/ directories.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoErrorHandlingDocumented: {
    id: 'AD-GO07',
    name: 'Error handling patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /error handling|errors?\.(?:New|Wrap|Is|As)|fmt\.Errorf/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document error handling conventions (error wrapping, sentinel errors, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoContextUsageDocumented: {
    id: 'AD-GO08',
    name: 'Context usage documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /context\.Context|ctx\.Done|context\.WithCancel|context\.WithTimeout/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document context.Context usage patterns for cancellation and timeouts.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoroutineSafetyDocumented: {
    id: 'AD-GO09',
    name: 'Goroutine safety documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /goroutine|sync\.Mutex|sync\.WaitGroup|channel|concurren/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document goroutine safety patterns, mutex usage, and channel conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoModTidyMentioned: {
    id: 'AD-GO10',
    name: 'go mod tidy mentioned in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go mod tidy/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document go mod tidy in project workflow instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoVetConfigured: {
    id: 'AD-GO11',
    name: 'go vet or staticcheck configured',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/go.yml') || ''; return /go vet|staticcheck/i.test(docs + ci); },
    impact: 'medium',
    category: 'go',
    fix: 'Configure go vet and/or staticcheck in CI or project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoMakefileExists: {
    id: 'AD-GO12',
    name: 'Makefile or Taskfile exists for Go project',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /^Makefile$|^Taskfile\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Add Makefile or Taskfile.yml with common Go targets (build, test, lint).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoDockerMultiStage: {
    id: 'AD-GO13',
    name: 'Docker multi-stage build for Go',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; if (!df) return null; return /FROM.*golang.*AS/i.test(df) && /FROM.*(?:alpine|scratch|distroless|gcr\.io)/i.test(df); },
    impact: 'medium',
    category: 'go',
    fix: 'Use multi-stage Docker build: build in golang image, run in minimal image (alpine/scratch/distroless).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoCgoDocumented: {
    id: 'AD-GO14',
    name: 'CGO documented if used',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const goMod = ctx.fileContent('go.mod') || ''; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; if (!/CGO_ENABLED|import "C"/i.test(goMod + docs)) return null; return /CGO|cgo/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document CGO usage, dependencies, and build requirements.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoWorkForMonorepo: {
    id: 'AD-GO15',
    name: 'go.work for monorepo',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const multiMod = ctx.files.filter(f => /go\.mod$/.test(f)).length > 1; if (!multiMod) return null; return ctx.files.some(f => /go\.work$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Use go.work for Go workspace in monorepo with multiple modules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoBenchmarkTests: {
    id: 'AD-GO16',
    name: 'Benchmark tests mentioned',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go test.*-bench|Benchmark/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document benchmark testing with go test -bench.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoRaceDetector: {
    id: 'AD-GO17',
    name: 'Race detector (-race) documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/go.yml') || ''; return /-race/i.test(docs + ci); },
    impact: 'medium',
    category: 'go',
    fix: 'Document and enable race detector with go test -race.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoGenerateDocumented: {
    id: 'AD-GO18',
    name: 'go generate documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go generate/i.test(docs) || ctx.files.some(f => /generate\.go$/.test(f)); },
    impact: 'low',
    category: 'go',
    fix: 'Document go generate usage and generated files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoInterfaceDesignDocumented: {
    id: 'AD-GO19',
    name: 'Interface-based design documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /interface|mock|stub|dependency injection/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document interface-based design patterns for testability and dependency injection.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderGoGitignore: {
    id: 'AD-GO20',
    name: 'Go-specific .gitignore entries',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const gi = ctx.fileContent('.gitignore') || ''; return /vendor[/]|\*\.exe|\*\.test|\*\.out|[/]bin[/]/i.test(gi); },
    impact: 'low',
    category: 'go',
    fix: 'Add Go-specific entries to .gitignore (vendor/, *.exe, *.test, /bin/).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },
  // ============================================================
  // === RUST STACK CHECKS (category: 'rust') ===================
  // ============================================================

  aiderRustCargoTomlExists: {
    id: 'AD-RS01',
    name: 'Cargo.toml exists with edition field',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /edition\s*=/.test(cargo); },
    impact: 'high',
    category: 'rust',
    fix: 'Ensure Cargo.toml exists and specifies the edition field (e.g., edition = "2021").',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustCargoLockCommitted: {
    id: 'AD-RS02',
    name: 'Cargo.lock committed (for binary crates)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /Cargo\.lock$/.test(f)); },
    impact: 'high',
    category: 'rust',
    fix: 'Commit Cargo.lock for binary crates to ensure reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustClippyConfigured: {
    id: 'AD-RS03',
    name: 'Clippy configured (CI or .cargo/config.toml)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/rust.yml') || ''; const cargoConfig = ctx.fileContent('.cargo/config.toml') || ''; return /clippy/i.test(ci + cargoConfig); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure clippy in CI or .cargo/config.toml for lint enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustFmtConfigured: {
    id: 'AD-RS04',
    name: 'rustfmt configured (rustfmt.toml or .rustfmt.toml)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /rustfmt\.toml$|\.rustfmt\.toml$/.test(f)); },
    impact: 'medium',
    category: 'rust',
    fix: 'Create rustfmt.toml or .rustfmt.toml to configure code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustCargoTestDocumented: {
    id: 'AD-RS05',
    name: 'cargo test documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cargo test/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document cargo test command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustCargoBuildDocumented: {
    id: 'AD-RS06',
    name: 'cargo build/check documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cargo (?:build|check)/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document cargo build or cargo check command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustUnsafePolicyDocumented: {
    id: 'AD-RS07',
    name: 'Unsafe code policy documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /unsafe|#!?\[forbid\(unsafe|#!?\[deny\(unsafe/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document unsafe code policy (forbidden, minimized, or where allowed).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustErrorHandlingStrategy: {
    id: 'AD-RS08',
    name: 'Error handling strategy (anyhow/thiserror in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /anyhow|thiserror|eyre|color-eyre/i.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Use anyhow (applications) or thiserror (libraries) for structured error handling.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustFeatureFlagsDocumented: {
    id: 'AD-RS09',
    name: 'Feature flags documented (Cargo.toml [features])',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/\[features\]/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /feature|--features|--all-features/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document feature flags and their purpose in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustWorkspaceConfig: {
    id: 'AD-RS10',
    name: 'Workspace config if multi-crate (Cargo.toml [workspace])',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (ctx.files.filter(f => /Cargo\.toml$/.test(f)).length <= 1) return null; return /\[workspace\]/i.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure [workspace] in root Cargo.toml for multi-crate projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustMsrvSpecified: {
    id: 'AD-RS11',
    name: 'MSRV specified (rust-version field)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /rust-version\s*=/.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Specify rust-version (MSRV) in Cargo.toml for compatibility guarantees.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustDocCommentsEncouraged: {
    id: 'AD-RS12',
    name: 'Doc comments (///) encouraged in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /doc comment|\/{3}|rustdoc|cargo doc/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Encourage /// doc comments and cargo doc in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustBenchmarksConfigured: {
    id: 'AD-RS13',
    name: 'Criterion benchmarks mentioned (benches/ dir)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /benches[/]/.test(f)) || /criterion/i.test(ctx.fileContent('Cargo.toml') || ''); },
    impact: 'low',
    category: 'rust',
    fix: 'Set up criterion benchmarks in benches/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustCrossCompilationDocumented: {
    id: 'AD-RS14',
    name: 'Cross-compilation documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cross.?compil|--target|rustup target|cargo build.*--target/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Document cross-compilation targets and setup instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustMemorySafetyDocumented: {
    id: 'AD-RS15',
    name: 'Memory safety patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /ownership|borrow|lifetime|memory.?safe|Arc|Rc|RefCell/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document memory safety patterns (ownership, borrowing, lifetime conventions).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustAsyncRuntimeDocumented: {
    id: 'AD-RS16',
    name: 'Async runtime documented (tokio/async-std in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/tokio|async-std|smol/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /tokio|async-std|async|await|runtime/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document async runtime choice and patterns (tokio, async-std).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustSerdeDocumented: {
    id: 'AD-RS17',
    name: 'Serde patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/serde/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /serde|Serialize|Deserialize|serde_json|serde_yaml/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document serde serialization/deserialization patterns and conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustCargoAuditConfigured: {
    id: 'AD-RS18',
    name: 'cargo-audit configured in CI',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/rust.yml') || ctx.fileContent('.github/workflows/audit.yml') || ''; return /cargo.?audit|advisory/i.test(ci); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure cargo-audit in CI for vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustWasmTargetDocumented: {
    id: 'AD-RS19',
    name: 'WASM target documented if applicable',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/wasm|wasm-bindgen|wasm-pack/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /wasm|WebAssembly|wasm-pack|wasm-bindgen/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Document WASM target configuration and build process.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderRustGitignore: {
    id: 'AD-RS20',
    name: 'Rust .gitignore includes target/',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const gi = ctx.fileContent('.gitignore') || ''; return /target[/]|[/]target/i.test(gi); },
    impact: 'medium',
    category: 'rust',
    fix: 'Add target/ to .gitignore for Rust build artifacts.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === JAVA/SPRING STACK CHECKS (category: 'java') ============
  // ============================================================

  aiderJavaBuildFileExists: {
    id: 'AD-JV01',
    name: 'pom.xml or build.gradle exists',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'java',
    fix: 'Ensure pom.xml or build.gradle exists for Java projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaVersionSpecified: {
    id: 'AD-JV02',
    name: 'Java version specified',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; return /java\.version|maven\.compiler\.source|sourceCompatibility|JavaVersion/i.test(pom + gradle) || ctx.files.some(f => /\.java-version$/.test(f)); },
    impact: 'high',
    category: 'java',
    fix: 'Specify Java version in pom.xml properties, build.gradle, or .java-version file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaWrapperCommitted: {
    id: 'AD-JV03',
    name: 'Maven/Gradle wrapper committed (mvnw or gradlew)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /mvnw$|gradlew$/.test(f)); },
    impact: 'high',
    category: 'java',
    fix: 'Commit mvnw (Maven) or gradlew (Gradle) wrapper for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaSpringBootVersion: {
    id: 'AD-JV04',
    name: 'Spring Boot version documented if Spring project',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; if (!/spring-boot/i.test(pom + gradle)) return null; return /spring-boot.*\d+\.\d+/i.test(pom + gradle); },
    impact: 'high',
    category: 'java',
    fix: 'Document Spring Boot version in build configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaApplicationConfig: {
    id: 'AD-JV05',
    name: 'application.yml or application.properties exists',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /application\.ya?ml$|application\.properties$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Create application.yml or application.properties for Spring configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaTestFramework: {
    id: 'AD-JV06',
    name: 'Test framework configured (JUnit/TestNG in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; return /junit|testng|spring-boot-starter-test/i.test(pom + gradle); },
    impact: 'high',
    category: 'java',
    fix: 'Configure JUnit or TestNG test framework in project dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaCodeStyleConfigured: {
    id: 'AD-JV07',
    name: 'Code style configured (checkstyle.xml, spotbugs)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /checkstyle\.xml$|spotbugs.*\.xml$/.test(f)) || /checkstyle|spotbugs|google-java-format/i.test((ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || '')); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure checkstyle or spotbugs for code quality enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaSpringProfilesDocumented: {
    id: 'AD-JV08',
    name: 'Spring profiles documented',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/spring/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /spring[.]profiles|@Profile|SPRING_PROFILES_ACTIVE/i.test(docs); },
    impact: 'medium',
    category: 'java',
    fix: 'Document Spring profiles and their configuration in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaDatabaseMigration: {
    id: 'AD-JV09',
    name: 'Database migration configured (flyway/liquibase)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /flyway|liquibase/i.test(deps) || ctx.files.some(f => /db[/]migration|flyway|liquibase/i.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure database migration tool (Flyway or Liquibase) for schema management.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaLombokDocumented: {
    id: 'AD-JV10',
    name: 'Lombok/MapStruct documented if used',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/lombok|mapstruct/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /lombok|mapstruct/i.test(docs); },
    impact: 'low',
    category: 'java',
    fix: 'Document Lombok/MapStruct usage and IDE setup requirements.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaApiDocsConfigured: {
    id: 'AD-JV11',
    name: 'API docs configured (springdoc/swagger deps)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /springdoc|swagger|openapi/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure API documentation with springdoc-openapi or Swagger.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaSecurityConfigured: {
    id: 'AD-JV12',
    name: 'Security configuration documented',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/spring-security|spring-boot-starter-security/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /security|authentication|authorization|SecurityConfig|@EnableWebSecurity/i.test(docs); },
    impact: 'high',
    category: 'java',
    fix: 'Document Spring Security configuration and authentication setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaActuatorConfigured: {
    id: 'AD-JV13',
    name: 'Actuator/health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /actuator|spring-boot-starter-actuator/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Spring Boot Actuator for health checks and monitoring.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaLoggingConfigured: {
    id: 'AD-JV14',
    name: 'Logging configured (logback.xml or log4j2.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /logback.*\.xml$|log4j2?.*\.xml$|logging\.properties$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure logging with logback.xml or log4j2.xml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaMultiModuleProject: {
    id: 'AD-JV15',
    name: 'Multi-module project configured if applicable',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const buildFiles = ctx.files.filter(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f)); if (buildFiles.length <= 1) return null; const rootPom = ctx.fileContent('pom.xml') || ''; const rootGradle = ctx.fileContent('settings.gradle') || ctx.fileContent('settings.gradle.kts') || ''; return /<modules>|include\s/i.test(rootPom + rootGradle); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure multi-module project structure in root build file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaDockerConfigured: {
    id: 'AD-JV16',
    name: 'Docker build configured (Dockerfile or Jib plugin)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /FROM.*(?:openjdk|eclipse-temurin|amazoncorretto)/i.test(df) || /jib/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Docker build with Dockerfile or Jib plugin.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaEnvConfigsSeparated: {
    id: 'AD-JV17',
    name: 'Environment-specific configs separated',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /application-(?:dev|prod|staging|test|local)\.(?:ya?ml|properties)$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Separate environment configs (application-dev.yml, application-prod.yml, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaNoSecretsInConfig: {
    id: 'AD-JV18',
    name: 'No secrets in application.yml/properties',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const appYml = ctx.files.filter(f => /application.*\.ya?ml$|application.*\.properties$/.test(f)).map(f => ctx.fileContent(f) || '').join(''); if (!appYml) return null; return !/password\s*[:=]\s*[^$\{\s][^\s]{8,}|secret\s*[:=]\s*[^$\{\s][^\s]{8,}/i.test(appYml); },
    impact: 'critical',
    category: 'java',
    fix: 'Move secrets to environment variables or external secret management, not application config files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaIntegrationTestsSeparate: {
    id: 'AD-JV19',
    name: 'Integration tests separate from unit tests',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /src[/](?:integration-?test|it)[/]|IT\.java$|Integration(?:Test)?\.java$/.test(f)) || /failsafe|integration-test/i.test((ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || '')); },
    impact: 'medium',
    category: 'java',
    fix: 'Separate integration tests from unit tests using Maven Failsafe or dedicated source set.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderJavaBuildCommandDocumented: {
    id: 'AD-JV20',
    name: 'Build command documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /mvn|gradle|mvnw|gradlew|maven|./i.test(docs) && /build|compile|package|install/i.test(docs); },
    impact: 'high',
    category: 'java',
    fix: 'Document build command (mvnw package, gradlew build) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === RUBY/RAILS STACK CHECKS (category: 'ruby') =============
  // ============================================================

  aiderrubyGemfileExists: {
    id: 'AD-RB01',
    name: 'Gemfile exists',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'ruby',
    fix: 'Create a Gemfile to manage Ruby dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderrubyGemfileLockCommitted: {
    id: 'AD-RB02',
    name: 'Gemfile.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /Gemfile\.lock$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Commit Gemfile.lock to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderrubyVersionSpecified: {
    id: 'AD-RB03',
    name: 'Ruby version specified (.ruby-version)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.ruby-version$/.test(f)) || /ruby ['"]~?\d/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Create .ruby-version or specify ruby version in Gemfile.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderrubyRubocopConfigured: {
    id: 'AD-RB04',
    name: 'RuboCop configured (.rubocop.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.rubocop\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add .rubocop.yml to configure Ruby style checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderrubyTestFrameworkConfigured: {
    id: 'AD-RB05',
    name: 'RSpec or Minitest configured (spec/ or test/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /^spec\/|^test\/|spec_helper\.rb$|test_helper\.rb$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Configure RSpec (spec/) or Minitest (test/) for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderrubyRailsCredentialsDocumented: {
    id: 'AD-RB06',
    name: 'Rails credentials documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /credentials|encrypted|master\.key|secret_key_base/i.test(docs); },
    impact: 'high',
    category: 'ruby',
    fix: 'Document Rails credentials management (rails credentials:edit) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderrubyMigrationsDocumented: {
    id: 'AD-RB07',
    name: 'Database migrations documented (db/migrate/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /db\/migrate\//.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /migration|migrate|db:migrate|rails db/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document database migration workflow (rails db:migrate) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderrubyBundlerAuditConfigured: {
    id: 'AD-RB08',
    name: 'Bundler audit configured',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; return /bundler-audit|bundle.audit/i.test(gf) || ctx.files.some(f => /\.bundler-audit/i.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add bundler-audit gem for dependency vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderrubyTypeCheckingConfigured: {
    id: 'AD-RB09',
    name: 'Sorbet/RBS type checking configured (sorbet/ or sig/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /sorbet\/|sig\/|\.rbs$/.test(f)) || /sorbet|tapioca/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'low',
    category: 'ruby',
    fix: 'Configure Sorbet or RBS for type checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderrubyRailsRoutesDocumented: {
    id: 'AD-RB10',
    name: 'Rails routes documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/routes\.rb$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /routes|endpoints|api.*path|REST/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document key routes and API endpoints in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderrubyBackgroundJobsDocumented: {
    id: 'AD-RB11',
    name: 'Background jobs documented (Sidekiq/GoodJob)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sidekiq|good_job|delayed_job|resque/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /sidekiq|good_job|delayed_job|resque|background.*job|worker|queue/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document background job framework and worker configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderrubyRailsEnvConfigsSeparated: {
    id: 'AD-RB12',
    name: 'Rails environment configs separated (config/environments/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /config\/environments\//.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Ensure config/environments/ has separate files for development, test, and production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderrubyAssetPipelineDocumented: {
    id: 'AD-RB13',
    name: 'Asset pipeline documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sprockets|propshaft|webpacker|jsbundling|cssbundling/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /asset|sprockets|propshaft|webpacker|jsbundling|cssbundling|esbuild|vite/i.test(docs); },
    impact: 'low',
    category: 'ruby',
    fix: 'Document asset pipeline configuration (Sprockets, Propshaft, or JS/CSS bundling).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderrubyMasterKeyInGitignore: {
    id: 'AD-RB14',
    name: 'Rails master.key in .gitignore',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const gi = ctx.fileContent('.gitignore') || ''; return /master\.key/i.test(gi); },
    impact: 'critical',
    category: 'ruby',
    fix: 'Add config/master.key to .gitignore to prevent secret leakage.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderrubyTestDataFactories: {
    id: 'AD-RB15',
    name: 'Factory Bot/fixtures for test data (spec/factories/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /spec\/factories\/|test\/fixtures\//.test(f)) || /factory_bot|fabrication/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Configure Factory Bot (spec/factories/) or fixtures (test/fixtures/) for test data.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === .NET/C# STACK CHECKS (category: 'dotnet') ==============
  // ============================================================

  aiderdotnetProjectExists: {
    id: 'AD-DN01',
    name: '.csproj or .sln exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'dotnet',
    fix: 'Ensure .csproj or .sln file exists for .NET projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderdotnetVersionSpecified: {
    id: 'AD-DN02',
    name: '.NET version specified (global.json or TargetFramework)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /global\.json$/.test(f)) || ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /TargetFramework/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create global.json or ensure TargetFramework is set in .csproj.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderdotnetPackagesLock: {
    id: 'AD-DN03',
    name: 'NuGet packages lock (packages.lock.json)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /packages\.lock\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Enable NuGet lock file (packages.lock.json) for reproducible restores.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderdotnetTestDocumented: {
    id: 'AD-DN04',
    name: 'dotnet test documented',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /dotnet test|xunit|nunit|mstest/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document how to run tests with dotnet test in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderdotnetEditorConfigExists: {
    id: 'AD-DN05',
    name: 'EditorConfig configured (.editorconfig)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.editorconfig$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add .editorconfig for consistent code style across the team.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderdotnetRoslynAnalyzers: {
    id: 'AD-DN06',
    name: 'Roslyn analyzers configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Analyzer|StyleCop|SonarAnalyzer|Microsoft\.CodeAnalysis/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Roslyn analyzers (StyleCop.Analyzers, Microsoft.CodeAnalysis) to the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderdotnetAppsettingsExists: {
    id: 'AD-DN07',
    name: 'appsettings.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /appsettings\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create appsettings.json for application configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderdotnetUserSecretsDocumented: {
    id: 'AD-DN08',
    name: 'User secrets configured in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /user.?secrets|dotnet secrets|Secret Manager/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document user secrets management (dotnet user-secrets) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderdotnetEfMigrations: {
    id: 'AD-DN09',
    name: 'Entity Framework migrations (Migrations/ directory)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /Migrations\//.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Document Entity Framework migration workflow (dotnet ef migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderdotnetHealthChecks: {
    id: 'AD-DN10',
    name: 'Health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /AddHealthChecks|MapHealthChecks|IHealthCheck/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure health checks with AddHealthChecks() and MapHealthChecks().',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderdotnetSwaggerConfigured: {
    id: 'AD-DN11',
    name: 'Swagger/OpenAPI configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$|.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Swashbuckle|AddSwaggerGen|UseSwagger|NSwag|AddOpenApi/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure Swagger/OpenAPI with Swashbuckle or NSwag.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderdotnetNoConnectionStringsInConfig: {
    id: 'AD-DN12',
    name: 'No connection strings in appsettings.json',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const settings = ctx.fileContent('appsettings.json') || ''; if (!settings) return null; return !/Server=.*Password=|Data Source=.*Password=/i.test(settings); },
    impact: 'critical',
    category: 'dotnet',
    fix: 'Move connection strings with passwords to user secrets or environment variables.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderdotnetDockerSupport: {
    id: 'AD-DN13',
    name: 'Docker support configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; return /dotnet|aspnet|sdk/i.test(df); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Dockerfile with official .NET SDK/ASP.NET base images.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderdotnetTestProjectSeparate: {
    id: 'AD-DN14',
    name: 'Unit test project separate (.Tests.csproj)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.Tests?\.csproj$|Tests?\/.*\.csproj$/.test(f)); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Create separate test project (e.g., MyApp.Tests.csproj) for unit tests.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderdotnetGlobalUsingsDocumented: {
    id: 'AD-DN15',
    name: 'GlobalUsings documented',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /GlobalUsings\.cs$|Usings\.cs$/.test(f)) || ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /ImplicitUsings/i.test(c); }); },
    impact: 'low',
    category: 'dotnet',
    fix: 'Document global using directives in GlobalUsings.cs or enable ImplicitUsings in .csproj.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === PHP/LARAVEL STACK CHECKS (category: 'php') ==============
  // ============================================================

  aiderphpComposerJsonExists: {
    id: 'AD-PHP01',
    name: 'composer.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'php',
    fix: 'Create composer.json to manage PHP dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderphpComposerLockCommitted: {
    id: 'AD-PHP02',
    name: 'composer.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /composer\.lock$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Commit composer.lock to version control for reproducible installs.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderphpVersionSpecified: {
    id: 'AD-PHP03',
    name: 'PHP version specified (composer.json require.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"php"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Specify PHP version requirement in composer.json require section.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderphpStaticAnalysisConfigured: {
    id: 'AD-PHP04',
    name: 'PHPStan/Psalm configured (phpstan.neon)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpstan\.neon$|phpstan\.neon\.dist$|psalm\.xml$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Configure PHPStan (phpstan.neon) or Psalm (psalm.xml) for static analysis.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderphpCsFixerConfigured: {
    id: 'AD-PHP05',
    name: 'PHP CS Fixer configured (.php-cs-fixer.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /\.php-cs-fixer\.php$|\.php-cs-fixer\.dist\.php$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Add .php-cs-fixer.php for consistent code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderphpUnitConfigured: {
    id: 'AD-PHP06',
    name: 'PHPUnit configured (phpunit.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpunit\.xml$|phpunit\.xml\.dist$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Configure PHPUnit with phpunit.xml for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderphpLaravelEnvExample: {
    id: 'AD-PHP07',
    name: 'Laravel .env.example exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /\.env\.example$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Create .env.example with all required environment variables documented.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderphpLaravelAppKeyNotCommitted: {
    id: 'AD-PHP08',
    name: 'Laravel APP_KEY not committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const env = ctx.fileContent('.env') || ''; if (!env) return null; return !/APP_KEY=base64:[A-Za-z0-9+/=]{30,}/i.test(env); },
    impact: 'critical',
    category: 'php',
    fix: 'Ensure .env with APP_KEY is in .gitignore — never commit application keys.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderphpLaravelMigrationsExist: {
    id: 'AD-PHP09',
    name: 'Laravel migrations exist (database/migrations/)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /database\/migrations\//.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Create database migrations in database/migrations/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderphpArtisanCommandsDocumented: {
    id: 'AD-PHP10',
    name: 'Artisan commands documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /artisan|php artisan|make:model|make:controller|migrate/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document key Artisan commands (migrate, seed, make:*) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderphpQueueWorkerDocumented: {
    id: 'AD-PHP11',
    name: 'Queue worker documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; if (!/horizon|queue/i.test(cj) && !ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /queue|horizon|worker|job|dispatch/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document queue worker setup (php artisan queue:work, Horizon).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderphpLaravelPintConfigured: {
    id: 'AD-PHP12',
    name: 'Laravel Pint configured (pint.json)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /pint\.json$/.test(f)) || /laravel\/pint/i.test(ctx.fileContent('composer.json') || ''); },
    impact: 'low',
    category: 'php',
    fix: 'Configure Laravel Pint (pint.json) for code style enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderphpAssetBundlingDocumented: {
    id: 'AD-PHP13',
    name: 'Vite/Mix asset bundling documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /vite\.config\.|webpack\.mix\.js$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /vite|mix|asset|npm run dev|npm run build/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document asset bundling setup (Vite or Mix) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderphpConfigCachingDocumented: {
    id: 'AD-PHP14',
    name: 'Laravel config caching documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /config:cache|config:clear|route:cache|optimize/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document config/route caching strategy (php artisan config:cache) for production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  aiderphpComposerScriptsDefined: {
    id: 'AD-PHP15',
    name: 'Composer scripts defined',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"scripts"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Define composer scripts for common tasks (test, lint, analyze) in composer.json.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },


};

Object.assign(AIDER_TECHNIQUES, buildStackChecks({
  platform: 'aider',
  objectPrefix: 'aider',
  idPrefix: 'AD',
  docs: (ctx) => [
    ctx.fileContent('README.md') || '',
    ctx.fileContent('CONTRIBUTING.md') || '',
    ctx.fileContent('AGENTS.md') || '',
    ctx.fileContent('CLAUDE.md') || '',
  ].filter(Boolean).join('\n'),
}));

attachSourceUrls('aider', AIDER_TECHNIQUES);

module.exports = {
  AIDER_TECHNIQUES,
};
