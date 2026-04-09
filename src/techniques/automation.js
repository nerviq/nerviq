/**
 * Automation technique fragments.
 * Generated mechanically from the legacy techniques.js monolith during HR-09.
 */

const {
  findProjectFiles,
  readProjectFiles,
} = require('./shared');

module.exports = {
  hooks: {
      id: 19,
      name: 'Hooks for automation',
      check: (ctx) => {
        // Hooks are configured in settings.json (not .claude/hooks/ directory)
        const shared = ctx.jsonFile('.claude/settings.json') || {};
        const local = ctx.jsonFile('.claude/settings.local.json') || {};
        return !!(shared.hooks && Object.keys(shared.hooks).length > 0) || !!(local.hooks && Object.keys(local.hooks).length > 0);
      },
      impact: 'high',
      rating: 4,
      category: 'automation',
      fix: 'Add hooks in .claude/settings.json under the "hooks" key. Supported events: PreToolUse, PostToolUse, Notification, Stop, StopFailure, SubagentStop, and more.',
      template: 'hooks'
    },

  hooksInSettings: {
      id: 8801,
      name: 'Hooks configured in settings',
      check: (ctx) => {
        const shared = ctx.jsonFile('.claude/settings.json');
        const local = ctx.jsonFile('.claude/settings.local.json');
        const hasSharedHooks = shared && shared.hooks && Object.keys(shared.hooks).length > 0;
        const hasLocalHooks = local && local.hooks && Object.keys(local.hooks).length > 0;
        return hasSharedHooks || hasLocalHooks;
      },
      impact: 'high',
      rating: 4,
      category: 'automation',
      fix: 'Add hooks in .claude/settings.json for automated enforcement (lint-on-save, test-on-commit).',
      template: 'hooks'
    },

  preToolUseHook: {
      id: 8802,
      name: 'PreToolUse hook configured',
      check: (ctx) => {
        const shared = ctx.jsonFile('.claude/settings.json');
        const local = ctx.jsonFile('.claude/settings.local.json');
        return !!(shared?.hooks?.PreToolUse || local?.hooks?.PreToolUse);
      },
      impact: 'high',
      rating: 4,
      category: 'automation',
      fix: 'Add PreToolUse hooks for validation before tool calls (e.g. block writes to protected files).',
      template: null
    },

  postToolUseHook: {
      id: 8803,
      name: 'PostToolUse hook configured',
      check: (ctx) => {
        const shared = ctx.jsonFile('.claude/settings.json');
        const local = ctx.jsonFile('.claude/settings.local.json');
        return !!(shared?.hooks?.PostToolUse || local?.hooks?.PostToolUse);
      },
      impact: 'high',
      rating: 4,
      category: 'automation',
      fix: 'Add PostToolUse hooks for auto-lint or auto-format after file writes.',
      template: null
    },

  sessionStartHook: {
      id: 8804,
      name: 'SessionStart hook configured',
      check: (ctx) => {
        const shared = ctx.jsonFile('.claude/settings.json');
        const local = ctx.jsonFile('.claude/settings.local.json');
        if (!(shared?.hooks || local?.hooks)) return false;
        return !!(shared?.hooks?.SessionStart || local?.hooks?.SessionStart);
      },
      impact: 'medium',
      rating: 4,
      category: 'automation',
      fix: 'Add a SessionStart hook for initialization tasks (log rotation, state loading, etc.).',
      template: null
    },

  dockerfile: {
      id: 399,
      name: 'Has Dockerfile',
      check: (ctx) => ctx.files.some(f => /^Dockerfile/i.test(f)),
      impact: 'medium',
      rating: 3,
      category: 'devops',
      fix: 'Add a Dockerfile for containerized builds and deployments.',
      template: null
    },

  dockerCompose: {
      id: 39901,
      name: 'Has docker-compose.yml',
      check: (ctx) => ctx.files.some(f => /^docker-compose\.(yml|yaml)$/i.test(f)),
      impact: 'medium',
      rating: 3,
      category: 'devops',
      fix: 'Add docker-compose.yml for multi-service local development.',
      template: null
    },

  ciPipeline: {
      id: 260,
      name: 'CI pipeline configured',
      check: (ctx) => ctx.hasDir('.github/workflows') || ctx.hasDir('.circleci') ||
        ctx.files.includes('.gitlab-ci.yml') || ctx.files.includes('Jenkinsfile') ||
        ctx.files.includes('.travis.yml') || ctx.files.includes('bitbucket-pipelines.yml'),
      impact: 'high',
      rating: 4,
      category: 'devops',
      fix: 'Add a CI pipeline (GitHub Actions, GitLab CI, CircleCI, etc.) for automated testing and deployment.',
      template: null
    },

  terraformFiles: {
      id: 397,
      name: 'Infrastructure as Code (Terraform)',
      check: (ctx) => ctx.files.some(f => /\.tf$/.test(f)) || ctx.files.includes('main.tf'),
      impact: 'medium',
      rating: 3,
      category: 'devops',
      fix: 'Add Terraform files for infrastructure-as-code management.',
      template: null
    },

  dockerMultiStage: {
      id: 39902,
      name: 'Dockerfile uses multi-stage build',
      check: (ctx) => {
        const df = findProjectFiles(ctx, /^Dockerfile$/i);
        if (df.length === 0) return null;
        const content = ctx.fileContent(df[0]) || '';
        return (content.match(/^FROM\s/gim) || []).length >= 2;
      },
      impact: 'medium',
      rating: 3,
      category: 'devops',
      fix: 'Use multi-stage builds in Dockerfile to reduce image size and avoid leaking build tools into production.',
      template: null
    },

  dockerignoreExists: {
      id: 39903,
      name: '.dockerignore includes node_modules and .env',
      check: (ctx) => {
        if (!ctx.files.some(f => /^Dockerfile/i.test(f))) return null;
        const di = ctx.fileContent('.dockerignore') || '';
        return di.includes('node_modules') && /\.env/i.test(di);
      },
      impact: 'high',
      rating: 4,
      category: 'devops',
      fix: 'Add .dockerignore with node_modules, .env, and other sensitive/large files to keep images small and secure.',
      template: null
    },

  dockerNoSecrets: {
      id: 39904,
      name: 'Dockerfile has no secrets in build args',
      check: (ctx) => {
        const df = findProjectFiles(ctx, /^Dockerfile$/i);
        if (df.length === 0) return null;
        const content = ctx.fileContent(df[0]) || '';
        return !/ARG\s+(PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)/i.test(content);
      },
      impact: 'critical',
      rating: 5,
      category: 'devops',
      fix: 'Never pass secrets via ARG in Dockerfile — use runtime environment variables or secret mounts instead.',
      template: null
    },

  terraformFmt: {
      id: 39705,
      name: 'Terraform formatting configured',
      check: (ctx) => {
        if (!ctx.files.some(f => /\.tf$/.test(f))) return null;
        const ci = readProjectFiles(ctx, /\.(yml|yaml)$/i, 10);
        const makefileContent = ctx.fileContent('Makefile') || '';
        const preCommit = ctx.fileContent('.pre-commit-config.yaml') || '';
        return /terraform\s+fmt/i.test(ci) || /terraform\s+fmt/i.test(makefileContent) || /terraform_fmt/i.test(preCommit);
      },
      impact: 'medium',
      rating: 3,
      category: 'devops',
      fix: 'Add `terraform fmt` to CI or pre-commit hooks to enforce consistent formatting.',
      template: null
    },

  terraformDirIgnored: {
      id: 39706,
      name: '.terraform directory in .gitignore',
      check: (ctx) => {
        if (!ctx.files.some(f => /\.tf$/.test(f))) return null;
        const gi = ctx.fileContent('.gitignore') || '';
        return /\.terraform/i.test(gi);
      },
      impact: 'high',
      rating: 4,
      category: 'devops',
      fix: 'Add .terraform/ to .gitignore — it contains provider binaries and should not be committed.',
      template: null
    },

  terraformStateNotCommitted: {
      id: 39707,
      name: 'Terraform state file not committed',
      check: (ctx) => {
        if (!ctx.files.some(f => /\.tf$/.test(f))) return null;
        return !ctx.files.some(f => /terraform\.tfstate$/i.test(f));
      },
      impact: 'critical',
      rating: 5,
      category: 'devops',
      fix: 'Never commit terraform.tfstate — it may contain secrets. Use a remote backend (S3, GCS, Terraform Cloud).',
      template: null
    },

  terraformBackendConfigured: {
      id: 39708,
      name: 'Terraform remote backend configured',
      check: (ctx) => {
        const tfFiles = findProjectFiles(ctx, /\.tf$/);
        if (tfFiles.length === 0) return null;
        const allTf = tfFiles.slice(0, 10).map(f => ctx.fileContent(f) || '').join('\n');
        return /backend\s+"(s3|gcs|azurerm|remote|cloud|consul|http)"/i.test(allTf);
      },
      impact: 'high',
      rating: 4,
      category: 'devops',
      fix: 'Configure a remote backend in Terraform (S3, GCS, Terraform Cloud) for team collaboration and state locking.',
      template: null
    },

  githubActionsOrCI: {
      id: 2021,
      name: 'GitHub Actions or CI configured',
      check: (ctx) => {
        return ctx.hasDir('.github/workflows') || !!ctx.fileContent('.circleci/config.yml') ||
               !!ctx.fileContent('.gitlab-ci.yml') || !!ctx.fileContent('Jenkinsfile') ||
               !!ctx.fileContent('.travis.yml') || !!ctx.fileContent('bitbucket-pipelines.yml');
      },
      impact: 'medium', rating: 3, category: 'devops',
      fix: 'Add CI pipeline for automated testing. Claude Code has a GitHub Action for audit gates.',
      template: null
    },

  multipleHookTypes: {
      id: 2024,
      name: '2+ hook event types configured',
      check: (ctx) => {
        const shared = ctx.jsonFile('.claude/settings.json') || {};
        const local = ctx.jsonFile('.claude/settings.local.json') || {};
        const hooks = { ...(shared.hooks || {}), ...(local.hooks || {}) };
        return Object.keys(hooks).length >= 2;
      },
      impact: 'medium', rating: 3, category: 'automation',
      fix: 'Add at least 2 hook types (e.g. PostToolUse for linting + SessionStart for initialization).',
      template: null
    },

  stopFailureHook: {
      id: 2025,
      name: 'StopFailure hook for error tracking',
      check: (ctx) => {
        const shared = ctx.jsonFile('.claude/settings.json') || {};
        const local = ctx.jsonFile('.claude/settings.local.json') || {};
        // StopFailure = error stop (API errors), Stop = normal completion — both useful but different
        return !!(shared.hooks?.StopFailure || local.hooks?.StopFailure);
      },
      impact: 'low', rating: 3, category: 'automation',
      fix: 'Add a StopFailure hook to log API errors and unexpected stops. Note: StopFailure (errors) is different from Stop (normal completion).',
      template: null
    },

  hooksNotificationEvent: {
      id: 2033,
      name: 'Notification hook for alerts',
      check: (ctx) => {
        const shared = ctx.jsonFile('.claude/settings.json') || {};
        const local = ctx.jsonFile('.claude/settings.local.json') || {};
        return !!(shared.hooks?.Notification || local.hooks?.Notification);
      },
      impact: 'low',
      rating: 2,
      category: 'automation',
      fix: 'Add a Notification hook to capture alerts and status updates from Claude during long tasks.',
      template: null
    },

  subagentStopHook: {
      id: 2034,
      name: 'SubagentStop hook for delegation tracking',
      check: (ctx) => {
        const shared = ctx.jsonFile('.claude/settings.json') || {};
        const local = ctx.jsonFile('.claude/settings.local.json') || {};
        return !!(shared.hooks?.SubagentStop || local.hooks?.SubagentStop);
      },
      impact: 'low',
      rating: 2,
      category: 'automation',
      fix: 'Add a SubagentStop hook to track when delegated subagent tasks complete.',
      template: null
    },
};
