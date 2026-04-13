const ASCII_ENV = 'NERVIQ_ASCII_OUTPUT';

const ASCII_TRUE = new Set(['1', 'true', 'yes', 'on']);
const ASCII_FALSE = new Set(['0', 'false', 'no', 'off']);

const ICONS = {
  ok: { emoji: '✅', ascii: '[OK]' },
  fail: { emoji: '❌', ascii: '[FAIL]' },
  warn: { emoji: '⚠', ascii: '[WARN]' },
  skip: { emoji: '⏭️', ascii: '[SKIP]' },
  delete: { emoji: '🗑️', ascii: '[DEL]' },
};

function parseAsciiOverride(env = process.env) {
  const raw = env && env[ASCII_ENV];
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (ASCII_TRUE.has(normalized)) return true;
  if (ASCII_FALSE.has(normalized)) return false;
  return null;
}

function shouldUseAsciiOutput(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const stream = options.stream || process.stdout;
  const override = parseAsciiOverride(env);
  if (override !== null) return override;
  if (!stream || stream.isTTY === false) return true;
  return platform === 'win32';
}

function icon(name, options = {}) {
  const token = ICONS[name];
  if (!token) {
    throw new Error(`Unknown icon token: ${name}`);
  }
  return shouldUseAsciiOutput(options) ? token.ascii : token.emoji;
}

module.exports = {
  icon,
  shouldUseAsciiOutput,
};
