/**
 * Optimization technique fragments.
 * Generated mechanically from the legacy techniques.js monolith during HR-09.
 */

const {
  hasFrontendSignals,
  hasProjectFile,
  readProjectFiles,
  getWorkflowContent,
} = require('./shared');

module.exports = {
  compactionAwareness: {
      id: 568,
      name: 'CLAUDE.md mentions /compact or compaction',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return /\/compact|compaction|context.*(limit|manage|budget)/i.test(md);
      },
      impact: 'medium',
      rating: 4,
      category: 'performance',
      fix: 'Add compaction guidance to CLAUDE.md (e.g. "Run /compact when context is heavy").',
      template: null
    },

  contextManagement: {
      id: 45,
      name: 'Context management awareness',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return /context.*(manage|window|limit|budget|token)/i.test(md);
      },
      impact: 'medium',
      rating: 4,
      category: 'performance',
      fix: 'Add context management tips to CLAUDE.md to help Claude stay within token limits.',
      template: null
    },

  effortLevelConfigured: {
      id: 2016,
      name: 'Effort level or thinking configuration',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        const shared = ctx.jsonFile('.claude/settings.json') || {};
        const local = ctx.jsonFile('.claude/settings.local.json') || {};
        return /effort|thinking/i.test(md) || shared.effortLevel || local.effortLevel ||
               shared.alwaysThinkingEnabled !== undefined || local.alwaysThinkingEnabled !== undefined;
      },
      impact: 'low', rating: 3, category: 'performance',
      fix: 'Configure effortLevel or mention thinking strategy in CLAUDE.md for task-appropriate reasoning depth.',
      template: null
    },

  lighthouseCI: {
      id: 130171,
      name: 'Lighthouse CI configured',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        return hasProjectFile(ctx, /(^|\/)\.?lighthouserc\.(js|json|ya?ml)$/i) ||
          /lighthouse/i.test(getWorkflowContent(ctx));
      },
      impact: 'medium',
      category: 'performance-budget',
      fix: 'Add Lighthouse CI (lighthouserc.js) to enforce performance budgets in your CI pipeline.',
      confidence: 0.7,
    },

  bundleSizeLimit: {
      id: 130172,
      name: 'Bundle size check configured',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        const pkg = ctx.fileContent('package.json') || '';
        return /size-limit|bundlewatch|@next\/bundle-analyzer|webpack-bundle-analyzer/i.test(pkg);
      },
      impact: 'medium',
      category: 'performance-budget',
      fix: 'Add bundle size checks (size-limit, bundlewatch, @next/bundle-analyzer) to prevent bundle bloat.',
      confidence: 0.7,
    },

  webVitals: {
      id: 130173,
      name: 'Core Web Vitals tracking configured',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        const pkg = ctx.fileContent('package.json') || '';
        const src = readProjectFiles(ctx, /\.(jsx?|tsx?)$/i, 20);
        return /web-vitals|next\/web-vitals|@vercel\/speed-insights/i.test(pkg + src);
      },
      impact: 'medium',
      category: 'performance-budget',
      fix: 'Add Core Web Vitals tracking (web-vitals, next/web-vitals) for real user performance monitoring.',
      confidence: 0.7,
    },

  performanceRegression: {
      id: 130174,
      name: 'Performance regression testing in CI',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        const ci = getWorkflowContent(ctx);
        const pkg = ctx.fileContent('package.json') || '';
        return /benchmark|bench|perf.*test|lighthouse.*assert/i.test(ci + pkg);
      },
      impact: 'low',
      category: 'performance-budget',
      fix: 'Add performance regression testing in CI (benchmark, lighthouse assert) to catch regressions early.',
      confidence: 0.7,
    },

  imageOptimization: {
      id: 130175,
      name: 'Image optimization configured',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        const pkg = ctx.fileContent('package.json') || '';
        return /sharp|imagemin|next\/image|responsive-loader|@squoosh/i.test(pkg);
      },
      impact: 'low',
      category: 'performance-budget',
      fix: 'Add image optimization (sharp, imagemin, next/image) to reduce page weight and improve loading.',
      confidence: 0.7,
    },

  lazyLoading: {
      id: 130176,
      name: 'Code splitting and lazy loading',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        const src = readProjectFiles(ctx, /\.(jsx?|tsx?)$/i, 30);
        return /React\.lazy|import\s*\(|loadable|dynamic\s*\(\s*\(\)\s*=>/i.test(src);
      },
      impact: 'low',
      category: 'performance-budget',
      fix: 'Use code splitting and lazy loading (React.lazy, dynamic import, loadable) to reduce initial bundle size.',
      confidence: 0.7,
    },
};
