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

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
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
      expect(result.workspaces.every((item) => !Object.prototype.hasOwnProperty.call(item, 'result'))).toBe(true);
      expect(typeof result.averageScore).toBe('number');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('auditWorkspaces labels stack-specific workspace profiles and profile breakdown', async () => {
    const dir = mkFixture('profiles');
    try {
      writeJson(dir, 'package.json', { name: 'mono', workspaces: ['packages/*'] });
      writeJson(dir, 'packages/web/package.json', {
        name: '@mono/web',
        dependencies: { react: '^19.0.0' },
      });
      writeFile(dir, 'packages/api/go.mod', 'module example.com/api\n\ngo 1.23\n');
      writeFile(dir, 'packages/jobs/pyproject.toml', [
        '[project]',
        'name = "jobs"',
        'version = "0.1.0"',
      ].join('\n'));

      const result = await auditWorkspaces(dir, 'packages/*', 'claude');

      expect(result.workspaces).toHaveLength(3);
      expect(result.scoreSemantics.workspaceProfiles).toMatch(/stack-specific check profile/i);
      expect(result.workspaces.map((item) => item.workspaceProfile.label)).toEqual(expect.arrayContaining([
        'Go workspace',
        'Python workspace',
        'Node / JS workspace',
      ]));

      const byWorkspace = Object.fromEntries(result.workspaces.map((item) => [item.workspace, item]));
      expect(byWorkspace['packages/api'].stackLabels).toEqual(expect.arrayContaining(['Go']));
      expect(byWorkspace['packages/jobs'].stackLabels).toEqual(expect.arrayContaining(['Python']));
      expect(byWorkspace['packages/web'].stackLabels).toEqual(expect.arrayContaining(['Node.js', 'React']));

      expect(result.profileBreakdown).toEqual(expect.arrayContaining([
        expect.objectContaining({
          profileKey: 'go-workspace',
          profileLabel: 'Go workspace',
          workspaceCount: 1,
          workspaces: ['packages/api'],
          stackLabels: ['Go'],
        }),
        expect.objectContaining({
          profileKey: 'python-workspace',
          profileLabel: 'Python workspace',
          workspaceCount: 1,
          workspaces: ['packages/jobs'],
          stackLabels: ['Python'],
        }),
        expect.objectContaining({
          profileKey: 'node-workspace',
          profileLabel: 'Node / JS workspace',
          workspaceCount: 1,
          workspaces: ['packages/web'],
          stackLabels: expect.arrayContaining(['Node.js', 'React']),
        }),
      ]));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
