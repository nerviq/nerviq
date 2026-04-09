/**
 * Compliance technique fragments.
 * Generated mechanically from the legacy techniques.js monolith during HR-09.
 */

const {
  hasFrontendSignals,
  hasProjectFile,
  readProjectFiles,
} = require('./shared');

module.exports = {
  a11yTestingTool: {
      id: 130011,
      name: 'Accessibility testing tool',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        const pkg = ctx.fileContent('package.json') || '';
        return /axe-core|pa11y|@testing-library\/jest-dom|jest-axe|cypress-axe|@axe-core/i.test(pkg);
      },
      impact: 'high',
      category: 'accessibility',
      fix: 'Add an accessibility testing tool (axe-core, pa11y, jest-axe) to catch a11y regressions.',
    },

  ariaLabels: {
      id: 130012,
      name: 'ARIA labels in components',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        const components = readProjectFiles(ctx, /\.(jsx|tsx|vue|svelte|html)$/i);
        if (!components) return null;
        return /aria-label|aria-labelledby|aria-describedby/i.test(components);
      },
      impact: 'high',
      category: 'accessibility',
      fix: 'Add aria-label or aria-labelledby attributes to interactive components for screen readers.',
    },

  wcagMentioned: {
      id: 130013,
      name: 'WCAG or accessibility in docs',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        const docs = readProjectFiles(ctx, /\.(md|txt|rst)$/i);
        const configs = readProjectFiles(ctx, /\.(ya?ml|json|toml)$/i);
        return /wcag|accessibility|a11y/i.test(docs + configs);
      },
      impact: 'medium',
      category: 'accessibility',
      fix: 'Document WCAG compliance level and accessibility standards in your project docs.',
    },

  semanticHtml: {
      id: 130014,
      name: 'Semantic HTML elements used',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        const templates = readProjectFiles(ctx, /\.(jsx|tsx|vue|svelte|html)$/i);
        if (!templates) return null;
        return /<(nav|main|article|section|aside|header|footer)\b/i.test(templates);
      },
      impact: 'medium',
      category: 'accessibility',
      fix: 'Use semantic HTML elements (nav, main, article, section, aside) instead of generic div elements.',
    },

  colorContrastTool: {
      id: 130015,
      name: 'Color contrast checking configured',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        const pkg = ctx.fileContent('package.json') || '';
        const configs = readProjectFiles(ctx, /\.(ya?ml|json|toml|js|ts)$/i);
        return /axe-core|lighthouse|contrast-checker|color-contrast|a11y.*color/i.test(pkg + configs);
      },
      impact: 'medium',
      category: 'accessibility',
      fix: 'Configure a color contrast checking tool (axe, Lighthouse CI, contrast-checker) for WCAG AA compliance.',
    },

  keyboardNavigation: {
      id: 130016,
      name: 'Keyboard navigation patterns',
      check: (ctx) => {
        if (!hasFrontendSignals(ctx)) return null;
        const components = readProjectFiles(ctx, /\.(jsx|tsx|vue|svelte|html)$/i);
        if (!components) return null;
        return /tabindex|onKeyDown|onKeyUp|onKeyPress|@keydown|@keyup|v-on:keydown|focus-trap|useFocusTrap|FocusTrap/i.test(components);
      },
      impact: 'medium',
      category: 'accessibility',
      fix: 'Implement keyboard navigation with tabindex, key handlers, and focus management for accessible UIs.',
    },

  privacyPolicy: {
      id: 130021,
      name: 'Privacy policy document exists',
      check: (ctx) => {
        return ctx.files.some(f => /privacy/i.test(f) && /\.(md|txt|html|rst)$/i.test(f)) ||
          hasProjectFile(ctx, /privacy[_-]?policy/i);
      },
      impact: 'high',
      category: 'privacy',
      fix: 'Create a PRIVACY.md or privacy-policy document describing data handling practices.',
    },

  consentManagement: {
      id: 130022,
      name: 'Consent management configured',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const code = readProjectFiles(ctx, /\.(js|ts|jsx|tsx|html)$/i);
        return /cookie-consent|cookieconsent|onetrust|cookiebot|consent-manager|cookie.*banner/i.test(pkg + code);
      },
      impact: 'high',
      category: 'privacy',
      fix: 'Add a consent management solution (CookieConsent, OneTrust, Cookiebot) for GDPR cookie compliance.',
    },

  dataRetentionPolicy: {
      id: 130023,
      name: 'Data retention policy documented',
      check: (ctx) => {
        const docs = readProjectFiles(ctx, /\.(md|txt|rst|ya?ml|json)$/i);
        return /data.retention|retention.polic|ttl.*expir|expir.*polic/i.test(docs);
      },
      impact: 'medium',
      category: 'privacy',
      fix: 'Document your data retention policy specifying how long user data is stored and when it is deleted.',
    },

  piiHandling: {
      id: 130024,
      name: 'PII handling patterns in code',
      check: (ctx) => {
        const code = readProjectFiles(ctx, /\.(js|ts|py|go|rs|java|rb)$/i);
        return /\bredact|anonymize|pseudonymize|mask.*(email|phone|ssn|pii)|pii.*mask|sanitize.*(user|personal)/i.test(code);
      },
      impact: 'high',
      category: 'privacy',
      fix: 'Implement PII handling patterns (redact, anonymize, mask) to protect personal data in logs and storage.',
    },

  gdprCompliance: {
      id: 130025,
      name: 'GDPR/CCPA compliance mentioned',
      check: (ctx) => {
        const docs = readProjectFiles(ctx, /\.(md|txt|rst)$/i);
        const configs = readProjectFiles(ctx, /\.(ya?ml|json|toml)$/i);
        return /\bgdpr\b|\bccpa\b|data.protection|right.to.erasure|data.subject|dpa\b/i.test(docs + configs);
      },
      impact: 'high',
      category: 'privacy',
      fix: 'Document GDPR/CCPA compliance measures and data protection practices in your project.',
    },

  dataEncryption: {
      id: 130026,
      name: 'Data encryption in deps or config',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const req = readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
        const goMod = ctx.fileContent('go.mod') || '';
        const cargo = ctx.fileContent('Cargo.toml') || '';
        const deps = [pkg, req, goMod, cargo].join('\n');
        return /bcrypt|argon2|scrypt|crypto|node:crypto|cryptography|ring\b|rustls|tls.*config|ssl.*config|encryption.at.rest/i.test(deps) ||
          /encrypt|bcrypt|argon2/i.test(readProjectFiles(ctx, /\.(js|ts|py|go|rs|java)$/i));
      },
      impact: 'high',
      category: 'privacy',
      fix: 'Use encryption libraries (bcrypt, argon2, crypto) for data at rest and configure TLS for data in transit.',
    },

  i18nLibrary: {
      id: 130101,
      name: 'i18n library in dependencies',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        if (/i18next|react-intl|vue-i18n|@angular\/localize/i.test(pkg)) return true;
        const py = readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i) + readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
        if (/gettext|babel|fluent/i.test(py)) return true;
        return false;
      },
      impact: 'medium',
      category: 'i18n',
      fix: 'Add an i18n library (i18next, react-intl, vue-i18n, gettext, fluent) for internationalization support.',
      confidence: 0.7,
    },

  localeFiles: {
      id: 130102,
      name: 'Locale files exist',
      check: (ctx) => {
        return hasProjectFile(ctx, /(^|\/)locales\//i) ||
          hasProjectFile(ctx, /(^|\/)messages\//i) ||
          hasProjectFile(ctx, /(^|\/)translations\//i) ||
          hasProjectFile(ctx, /\.(po|xlf)$/i);
      },
      impact: 'medium',
      category: 'i18n',
      fix: 'Add locale files in a locales/, messages/, or translations/ directory for multi-language support.',
      confidence: 0.7,
    },

  rtlSupport: {
      id: 130103,
      name: 'RTL support configured',
      check: (ctx) => {
        const src = readProjectFiles(ctx, /\.(jsx?|tsx?|vue|html|css|scss)$/i, 30);
        return /dir=["']rtl["']|\brtl\b|\bbidi\b/i.test(src);
      },
      impact: 'low',
      category: 'i18n',
      fix: 'Add RTL (right-to-left) support with dir="rtl" or bidi utilities for languages like Arabic and Hebrew.',
      confidence: 0.7,
    },

  pluralizationRules: {
      id: 130104,
      name: 'ICU message format or pluralization',
      check: (ctx) => {
        const src = readProjectFiles(ctx, /\.(jsx?|tsx?|json|properties)$/i, 30);
        return /\{[^}]*,\s*plural\s*,/i.test(src) || /\bplural\b.*\bone\b|\bICU\b/i.test(src);
      },
      impact: 'low',
      category: 'i18n',
      fix: 'Use ICU message format or pluralization rules for correct multi-language number/gender handling.',
      confidence: 0.7,
    },

  i18nExtraction: {
      id: 130105,
      name: 'i18n extraction tool configured',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        return /babel-plugin-react-intl|i18next-parser|@formatjs\/cli|react-intl-translations-manager/i.test(pkg);
      },
      impact: 'low',
      category: 'i18n',
      fix: 'Add an i18n extraction tool (i18next-parser, @formatjs/cli) to auto-extract translatable strings.',
      confidence: 0.7,
    },

  dateTimeFormatting: {
      id: 130106,
      name: 'Locale-aware date/time formatting',
      check: (ctx) => {
        const src = readProjectFiles(ctx, /\.(jsx?|tsx?|vue)$/i, 30);
        return /Intl\.DateTimeFormat|date-fns\/locale|dayjs\/locale|moment\/locale/i.test(src);
      },
      impact: 'low',
      category: 'i18n',
      fix: 'Use locale-aware date/time formatting (Intl.DateTimeFormat, date-fns/locale, dayjs/locale) instead of hardcoded formats.',
      confidence: 0.7,
    },
};
