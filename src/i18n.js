/**
 * Minimal i18n module for nerviq CLI.
 *
 * Supports locale files in src/locales/<lang>.json.
 * Falls back to English for missing keys.
 */

const path = require('path');
const fs = require('fs');

const SUPPORTED_LOCALES = ['en', 'es'];
const DEFAULT_LOCALE = 'en';

let currentLocale = DEFAULT_LOCALE;
let messages = {};
let fallbackMessages = {};

function loadLocale(locale) {
  const file = path.join(__dirname, 'locales', `${locale}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Initialize i18n with a locale string (e.g. 'en', 'es').
 * Call this once at CLI startup.
 */
function init(locale) {
  const lang = (locale || process.env.NERVIQ_LANG || DEFAULT_LOCALE).toLowerCase().slice(0, 2);
  currentLocale = SUPPORTED_LOCALES.includes(lang) ? lang : DEFAULT_LOCALE;
  fallbackMessages = loadLocale(DEFAULT_LOCALE);
  messages = currentLocale === DEFAULT_LOCALE ? fallbackMessages : loadLocale(currentLocale);
}

/**
 * Translate a key with optional interpolation.
 *
 * Usage:
 *   t('audit.score', { score: 85, passed: 20, total: 25 })
 *   // => "Score: 85/100  (20/25 checks passing)"
 */
function t(key, params = {}) {
  let msg = messages[key] || fallbackMessages[key] || key;
  for (const [k, v] of Object.entries(params)) {
    msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return msg;
}

/**
 * Get current locale.
 */
function getLocale() {
  return currentLocale;
}

// Auto-init with default on first require
init();

module.exports = { init, t, getLocale, SUPPORTED_LOCALES };
