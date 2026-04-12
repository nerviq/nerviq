const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('../src/public-api');

function mk(name) { return fs.mkdtempSync(path.join(os.tmpdir(), `fb05-${name}-`)); }
function rm(dir) { fs.rmSync(dir, { recursive: true, force: true }); }
function w(dir, rel, content) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('FB-05 — framework-aware fix rewriting', () => {
  test('Python repo does not receive `npm test` recommendations', async () => {
    const dir = mk('python');
    try {
      w(dir, 'CLAUDE.md', '# Project\n\n## Role\nYou are a Python engineer.\n');
      w(dir, 'pyproject.toml', '[project]\nname = "demo"\nversion = "0.1"\n');
      w(dir, 'requirements.txt', 'pytest>=7\n');
      const result = await audit({ dir, platform: 'claude', silent: true });
      for (const r of result.results) {
        if (r.passed !== false || typeof r.fix !== 'string') continue;
        expect(r.fix).not.toMatch(/\bnpm\s+test\b/i);
        expect(r.fix).not.toMatch(/\bnpm\s+ci\b/i);
      }
    } finally { rm(dir); }
  });

  test('Go repo receives go test guidance where Node advice would have appeared', async () => {
    const dir = mk('go');
    try {
      w(dir, 'CLAUDE.md', '# Project\n\n## Role\nEngineer.\n');
      w(dir, 'go.mod', 'module example.com/demo\n\ngo 1.22\n');
      const result = await audit({ dir, platform: 'claude', silent: true });
      const testCommandFix = (result.results.find(r => r.key === 'testCommand') || {}).fix;
      expect(testCommandFix).toBeDefined();
      expect(testCommandFix).not.toMatch(/\bnpm\s+test\b/i);
      expect(testCommandFix).toMatch(/go\s+test/i);
    } finally { rm(dir); }
  });

  test('Node repo still receives npm test guidance (no rewrite)', async () => {
    const dir = mk('node');
    try {
      w(dir, 'CLAUDE.md', '# Project\n\n## Role\nEngineer.\n');
      w(dir, 'package.json', JSON.stringify({ name: 'demo', version: '0.0.1' }, null, 2));
      const result = await audit({ dir, platform: 'claude', silent: true });
      const testCommandFix = (result.results.find(r => r.key === 'testCommand') || {}).fix;
      expect(testCommandFix).toMatch(/npm\s+test/i);
    } finally { rm(dir); }
  });
});
