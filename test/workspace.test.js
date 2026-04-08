const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectWorkspaces, auditWorkspaces } = require('../src/workspace');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `workspace-jest-${name}-`));
}

function writeJson(dir, relPath, value) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(value, null, 2), 'utf8');
}

describe('Workspace support', () => {
  test('detectWorkspaces resolves package.json workspaces', () => {
    const dir = mkFixture('detect');
    try {
      writeJson(dir, 'package.json', { name: 'mono', workspaces: ['packages/*'] });
      writeJson(dir, 'packages/web/package.json', { name: '@mono/web' });
      writeJson(dir, 'packages/api/package.json', { name: '@mono/api' });
      expect(detectWorkspaces(dir)).toEqual(['packages/api', 'packages/web']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('auditWorkspaces returns aggregated results per workspace', async () => {
    const dir = mkFixture('audit');
    try {
      writeJson(dir, 'package.json', { name: 'mono', workspaces: ['packages/*'] });
      writeJson(dir, 'packages/web/package.json', { name: '@mono/web' });
      writeJson(dir, 'packages/api/package.json', { name: '@mono/api' });
      const result = await auditWorkspaces(dir, 'packages/*', 'claude');
      expect(result.workspaceCount).toBe(2);
      expect(result.workspaces).toHaveLength(2);
      expect(result.rootGovernance).toMatchObject({
        scope: 'root-governance',
        scoreType: 'root-live-audit',
      });
      expect(result.workspaceAggregate).toMatchObject({
        scope: 'workspace-aggregate',
        scoreType: 'workspace-average-live-audit',
        workspaceCount: 2,
      });
      expect(result.scoreSemantics.workspaceAggregate).toMatch(/package coverage rollup/i);
      expect(result.workspaces.every((item) => item.scope === 'workspace-package')).toBe(true);
      expect(result.workspaces.every((item) => item.scoreType === 'workspace-live-audit')).toBe(true);
      expect(typeof result.averageScore).toBe('number');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
