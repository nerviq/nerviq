'use strict';

// Flat-config equivalent of .eslintrc.json (kept for older tooling).
// `npx eslint .` resolves ESLint >= 9, which only reads eslint.config.js.

module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**', 'vscode-extension/node_modules/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // env: node
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        AbortController: 'readonly',
        fetch: 'readonly',
        // env: jest
        describe: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'warn',
    },
  },
  {
    // Cloudflare worker — ES module, not CommonJS.
    files: ['tools/insights-worker.js'],
    languageOptions: {
      sourceType: 'module',
    },
  },
];
