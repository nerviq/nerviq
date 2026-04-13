const assert = require('assert');
const { icon, shouldUseAsciiOutput } = require('../src/output-icons');

test('NERVIQ_ASCII_OUTPUT=1 forces ASCII status tokens', () => {
  const options = {
    env: { NERVIQ_ASCII_OUTPUT: '1' },
    platform: 'linux',
    stream: { isTTY: true },
  };

  assert.equal(shouldUseAsciiOutput(options), true);
  assert.equal(icon('ok', options), '[OK]');
  assert.equal(icon('fail', options), '[FAIL]');
  assert.equal(icon('skip', options), '[SKIP]');
});

test('auto detection falls back to ASCII on win32 TTY and keeps emoji on unix TTY', () => {
  const winOptions = {
    env: {},
    platform: 'win32',
    stream: { isTTY: true },
  };
  const unixOptions = {
    env: {},
    platform: 'linux',
    stream: { isTTY: true },
  };

  assert.equal(shouldUseAsciiOutput(winOptions), true);
  assert.equal(icon('ok', winOptions), '[OK]');
  assert.equal(shouldUseAsciiOutput(unixOptions), false);
  assert.equal(icon('ok', unixOptions), '✅');
});
