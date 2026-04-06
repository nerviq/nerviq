const fs = require('fs');
const os = require('os');
const path = require('path');

const sdk = require('../sdk');

function makeTempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-sdk-${name}-`));
}

describe('@nerviq/sdk', () => {
  test('getCatalog returns the full 2431-check catalog after adding Python + Go + Rust + Java stack checks', () => {
    const catalog = sdk.getCatalog();
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog).toHaveLength(2431);
  });

  test('detectPlatforms identifies all supported platform markers', () => {
    const dir = makeTempDir('detect');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Codex\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'GEMINI.md'), '# Gemini\n', 'utf8');
    fs.mkdirSync(path.join(dir, '.github'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github', 'copilot-instructions.md'), '# Copilot\n', 'utf8');
    fs.mkdirSync(path.join(dir, '.cursor'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.windsurf'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.aider.conf.yml'), 'model: gpt-4o-mini\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'opencode.json'), '{ "permissions": {} }\n', 'utf8');

    expect(sdk.detectPlatforms(dir)).toEqual([
      'claude',
      'codex',
      'gemini',
      'copilot',
      'cursor',
      'windsurf',
      'aider',
      'opencode',
    ]);
  });

  test('synergyReport returns structured data and a rendered report', async () => {
    const dir = makeTempDir('synergy');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Codex\n', 'utf8');

    const result = await sdk.synergyReport(dir);

    expect(result.activePlatforms).toEqual(['claude', 'codex']);
    expect(result.platformAudits.claude).toBeTruthy();
    expect(result.platformAudits.codex).toBeTruthy();
    expect(typeof result.report).toBe('string');
    expect(result.report).toContain('SYNERGY DASHBOARD');
  });

  // ─── QP-A04: SDK integration tests ──────────────────────────────────────

  test('audit returns valid result with score 0-100', async () => {
    const dir = makeTempDir('audit-score');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude\nTest project.\n', 'utf8');
    const result = await sdk.audit(dir, 'claude');
    expect(result).toHaveProperty('score');
    expect(typeof result.score).toBe('number');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result).toHaveProperty('platform', 'claude');
    expect(Array.isArray(result.results)).toBe(true);
  });

  test('harmonyAudit on temp dir with CLAUDE.md + AGENTS.md detects 2 platforms', async () => {
    const dir = makeTempDir('harmony');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude\nProject instructions\n', 'utf8');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Codex\nAgent instructions\n', 'utf8');
    const result = await sdk.harmonyAudit(dir);
    expect(result).toHaveProperty('harmonyScore');
    expect(typeof result.harmonyScore).toBe('number');
    expect(result).toHaveProperty('activePlatforms');
    expect(result.activePlatforms.length).toBe(2);
    const platformNames = result.activePlatforms.map(p => typeof p === 'string' ? p : p.platform);
    expect(platformNames).toContain('claude');
    expect(platformNames).toContain('codex');
  });

  test('detectPlatforms returns array containing claude for dir with CLAUDE.md', () => {
    const dir = makeTempDir('detect-claude');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude\n', 'utf8');
    const platforms = sdk.detectPlatforms(dir);
    expect(Array.isArray(platforms)).toBe(true);
    expect(platforms).toContain('claude');
  });

  test('getCatalog returns array with 2431 entries', () => {
    const catalog = sdk.getCatalog();
    expect(Array.isArray(catalog)).toBe(true);
    expect(catalog).toHaveLength(2431);
  });

  test('routeTask("fix bug", ["claude","codex"]) returns claude', () => {
    const result = sdk.routeTask('fix bug', ['claude', 'codex']);
    expect(result).toHaveProperty('recommended');
    expect(result.recommended).not.toBeNull();
    expect(result.recommended.platform).toBe('claude');
  });
});
