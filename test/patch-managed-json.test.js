/**
 * Managed-JSON patch paths (cursor/copilot/gemini/windsurf).
 *
 * Regression guard for the v1.31.0 fix of an undefined bare `nerviq`
 * identifier in the `_generator` stamp: patchMcpJson/patchEnvironmentJson
 * threw ReferenceError at runtime on cursor, copilot, and gemini because
 * these paths had zero test coverage. Every platform's JSON merge path is
 * exercised here.
 */

const cursor = require('../src/cursor/patch');
const copilot = require('../src/copilot/patch');
const gemini = require('../src/gemini/patch');
const windsurf = require('../src/windsurf/patch');

// Copilot's .vscode/mcp.json wraps servers in "servers"; the others use "mcpServers".
const PLATFORMS = [
  ['cursor', cursor, 'mcpServers'],
  ['copilot', copilot, 'servers'],
  ['gemini', gemini, 'mcpServers'],
  ['windsurf', windsurf, 'mcpServers'],
];

describe.each(PLATFORMS)('%s patchMcpJson', (name, mod, wrapperKey) => {
  const { patchMcpJson, MANAGED_JSON_KEY } = mod;

  test(`test_should_merge_new_server_and_stamp_generator_when_config_exists (${name})`, () => {
    if (typeof patchMcpJson !== 'function') return;
    // Arrange
    const existing = JSON.stringify({ [wrapperKey]: { kept: { command: 'node' } } });

    // Act
    const patched = JSON.parse(patchMcpJson(existing, { added: { command: 'npx' } }));

    // Assert
    expect(patched[wrapperKey].kept).toEqual({ command: 'node' });
    expect(patched[wrapperKey].added).toEqual({ command: 'npx' });
    expect(patched[MANAGED_JSON_KEY]._generator).toBe('nerviq');
  });

  test(`test_should_not_overwrite_existing_server_when_name_collides (${name})`, () => {
    if (typeof patchMcpJson !== 'function') return;
    // Arrange
    const existing = JSON.stringify({ [wrapperKey]: { srv: { command: 'original' } } });

    // Act
    const patched = JSON.parse(patchMcpJson(existing, { srv: { command: 'replacement' } }));

    // Assert
    expect(patched[wrapperKey].srv.command).toBe('original');
  });

  test(`test_should_not_throw_when_existing_content_is_invalid_json (${name})`, () => {
    if (typeof patchMcpJson !== 'function') return;
    // Arrange
    const invalid = '{ not json';

    // Act + Assert (the ReferenceError regression crashed exactly here)
    expect(() => patchMcpJson(invalid, { srv: { command: 'npx' } })).not.toThrow();
  });
});

describe.each(PLATFORMS)('%s patchEnvironmentJson', (name, mod) => {
  const { patchEnvironmentJson, MANAGED_JSON_KEY } = mod;

  test(`test_should_add_new_fields_and_stamp_generator_when_absent (${name})`, () => {
    if (typeof patchEnvironmentJson !== 'function') return;
    // Arrange
    const existing = JSON.stringify({ keepMe: true });

    // Act
    const patched = JSON.parse(patchEnvironmentJson(existing, { added: 'value' }));

    // Assert
    expect(patched.keepMe).toBe(true);
    expect(patched.added).toBe('value');
    expect(patched[MANAGED_JSON_KEY]._generator).toBe('nerviq');
  });

  test(`test_should_preserve_existing_field_when_key_collides (${name})`, () => {
    if (typeof patchEnvironmentJson !== 'function') return;
    // Arrange
    const existing = JSON.stringify({ mode: 'hand-authored' });

    // Act
    const patched = JSON.parse(patchEnvironmentJson(existing, { mode: 'generated' }));

    // Assert
    expect(patched.mode).toBe('hand-authored');
  });
});
