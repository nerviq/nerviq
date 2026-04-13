const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectContext } = require('../src/context');
const { runShallowRisk } = require('../src/shallow-risk');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-shallow-risk-${name}-`));
}

function writeFile(dir, relPath, content) {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const output = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(fullPath, output, 'utf8');
}

function runFixture(dir, key) {
  const findings = runShallowRisk(new ProjectContext(dir)).filter((item) => item.key === key);
  return findings;
}

describe('CTO-06 shallow-risk patterns', () => {
  test('agent-config-missing-file emits a high-severity hint with file evidence', () => {
    const dir = mkFixture('missing-file-positive');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project\nSee docs/SECURITY.md for the security model.\n');
      const [finding] = runFixture(dir, 'agent-config-missing-file');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('high');
      expect(finding.file).toBe('CLAUDE.md');
      expect(finding.line).toBe(2);
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain('docs/SECURITY.md');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-missing-file skips well-known convention references', () => {
    const dir = mkFixture('missing-file-negative');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project\nSee .github/CODEOWNERS before requesting review.\n');
      expect(runFixture(dir, 'agent-config-missing-file')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-stack-contradiction fires only when the declared stack has zero evidence', () => {
    const dir = mkFixture('stack-contradiction-positive');
    try {
      writeFile(dir, 'CLAUDE.md', 'Primary language: Go\n');
      writeFile(dir, 'pyproject.toml', '[project]\nname = "demo"\n');
      const [finding] = runFixture(dir, 'agent-config-stack-contradiction');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('high');
      expect(finding.file).toBe('CLAUDE.md');
      expect(finding.line).toBe(1);
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain('Primary language: Go');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-stack-contradiction skips repos where the declared stack actually exists', () => {
    const dir = mkFixture('stack-contradiction-negative');
    try {
      writeFile(dir, 'CLAUDE.md', 'Primary language: Go\n');
      writeFile(dir, 'go.mod', 'module example.com/demo\n');
      writeFile(dir, 'pyproject.toml', '[project]\nname = "demo"\n');
      expect(runFixture(dir, 'agent-config-stack-contradiction')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-cross-platform-drift reports contradictory platform claims', () => {
    const dir = mkFixture('cross-platform-drift-positive');
    try {
      writeFile(dir, 'CLAUDE.md', 'This is a pure JavaScript project.\n');
      writeFile(dir, '.cursor/rules/main.mdc', 'Use TypeScript strict mode.\n');
      const [finding] = runFixture(dir, 'agent-config-cross-platform-drift');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('high');
      expect(finding.file).toBe('.cursor/rules/main.mdc');
      expect(finding.line).toBe(1);
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain('TypeScript');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-cross-platform-drift skips when the second platform file is empty', () => {
    const dir = mkFixture('cross-platform-drift-negative');
    try {
      writeFile(dir, 'CLAUDE.md', 'This is a pure JavaScript project.\n');
      writeFile(dir, '.cursor/rules/main.mdc', '\n');
      expect(runFixture(dir, 'agent-config-cross-platform-drift')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('mcp-server-no-allowlist flags empty permissions as critical', () => {
    const dir = mkFixture('mcp-positive');
    try {
      writeFile(dir, '.claude/settings.json', {
        mcpServers: {
          shell: {
            command: 'node',
            args: ['./scripts/shell-mcp.js'],
            permissions: [],
          },
        },
      });
      const [finding] = runFixture(dir, 'mcp-server-no-allowlist');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('critical');
      expect(finding.file).toBe('.claude/settings.json');
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain('"shell"');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('mcp-server-no-allowlist skips servers that already have an allowlist', () => {
    const dir = mkFixture('mcp-negative');
    try {
      writeFile(dir, '.claude/settings.json', {
        mcpServers: {
          shell: {
            command: 'node',
            args: ['./scripts/shell-mcp.js'],
            permissions: { allow: ['read:docs/**'] },
          },
        },
      });
      expect(runFixture(dir, 'mcp-server-no-allowlist')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('hook-script-missing reports missing hook files with line evidence', () => {
    const dir = mkFixture('hook-positive');
    try {
      writeFile(dir, '.claude/settings.json', {
        hooks: {
          PreToolUse: [{
            hooks: [{
              type: 'command',
              command: '.claude/hooks/pre-commit.sh',
            }],
          }],
        },
      });
      const [finding] = runFixture(dir, 'hook-script-missing');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('high');
      expect(finding.file).toBe('.claude/settings.json');
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain('.claude/hooks/pre-commit.sh');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('hook-script-missing skips inline command hooks', () => {
    const dir = mkFixture('hook-negative');
    try {
      writeFile(dir, '.claude/settings.json', {
        hooks: {
          PreToolUse: [{
            hooks: [{
              type: 'command',
              command: 'node -e "console.log(\'ok\')"',
            }],
          }],
        },
      });
      expect(runFixture(dir, 'hook-script-missing')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-secret-literal catches narrow secret shapes in agent config files', () => {
    const dir = mkFixture('secret-positive');
    try {
      const githubPat = `ghp_${'123456789012345678901234567890123456'}`;
      writeFile(dir, 'CLAUDE.md', `Use this token for the demo: ${githubPat}\n`);
      const [finding] = runFixture(dir, 'agent-config-secret-literal');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('critical');
      expect(finding.file).toBe('CLAUDE.md');
      expect(finding.line).toBe(1);
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain(githubPat);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-secret-literal skips obvious placeholders', () => {
    const dir = mkFixture('secret-negative');
    try {
      writeFile(dir, 'CLAUDE.md', 'Example AWS key: AKIAIOSFODNN7EXAMPLE\n');
      expect(runFixture(dir, 'agent-config-secret-literal')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-deprecated-keys flags deprecated Aider keys at medium severity', () => {
    const dir = mkFixture('deprecated-keys-positive');
    try {
      writeFile(dir, '.aider.conf.yml', 'auto-commit: true\n');
      const [finding] = runFixture(dir, 'agent-config-deprecated-keys');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('medium');
      expect(finding.file).toBe('.aider.conf.yml');
      expect(finding.line).toBe(1);
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain('auto-commit');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-deprecated-keys skips repos pinned to legacy Aider versions', () => {
    const dir = mkFixture('deprecated-keys-negative');
    try {
      writeFile(dir, '.aider.conf.yml', 'auto-commit: true\n');
      writeFile(dir, 'requirements.txt', 'aider-chat==0.59.0\n');
      expect(runFixture(dir, 'agent-config-deprecated-keys')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-dangerous-autoapprove always flags destructive allow rules', () => {
    const dir = mkFixture('autoapprove-positive');
    try {
      writeFile(dir, '.claude/settings.json', {
        permissions: {
          allow: ['Bash(rm -rf *)'],
        },
      });
      const [finding] = runFixture(dir, 'agent-config-dangerous-autoapprove');
      expect(finding).toBeTruthy();
      expect(finding.severity).toBe('critical');
      expect(finding.file).toBe('.claude/settings.json');
      expect(finding.layer).toBe('shallow-risk');
      expect(finding.snippet).toContain('Bash(rm -rf *)');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('agent-config-dangerous-autoapprove skips safe allow rules', () => {
    const dir = mkFixture('autoapprove-negative');
    try {
      writeFile(dir, '.claude/settings.json', {
        permissions: {
          allow: ['Bash(npm test *)'],
        },
      });
      expect(runFixture(dir, 'agent-config-dangerous-autoapprove')).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
