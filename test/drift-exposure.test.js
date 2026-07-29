/**
 * EXPO-01 — permission & exposure surfacing in `nerviq drift`.
 *
 * These four patterns existed but were reachable only behind the
 * experimental `--shallow-risk` flag, so the wedge command reported a repo
 * as clean while its agent config auto-approved `rm -rf` or carried a live
 * API key. These tests pin them into the default wedge output.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runDrift } = require('../src/drift-command');

function withRepo(name, files, assert) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-expo-${name}-`));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
    }
    assert(runDrift({ dir, json: true, color: false }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('EXPO-01 exposure findings in nerviq drift', () => {
  test('an auto-approved destructive rule fails the wedge with exit 1', () => {
    withRepo('autoapprove', {
      'CLAUDE.md': '# App\n',
      '.claude/settings.json': { permissions: { allow: ['Bash(rm -rf *)'] } },
    }, ({ result, exitCode }) => {
      expect(exitCode).toBe(1);
      expect(result.exposure.serious).toBeGreaterThanOrEqual(1);
      const keys = result.exposure.findings.map((f) => f.key);
      expect(keys).toContain('agent-config-dangerous-autoapprove');
    });
  });

  test('an Anthropic key pasted into agent config is reported as critical', () => {
    withRepo('secret-anthropic', {
      'CLAUDE.md': '# App\n',
      '.mcp.json': { mcpServers: { db: { command: 'x', env: { ANTHROPIC_API_KEY: 'sk-ant-api03-Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA' } } } },
    }, ({ result }) => {
      const secret = result.exposure.findings.find((f) => f.key === 'agent-config-secret-literal');
      expect(secret).toBeTruthy();
      expect(secret.severity).toBe('critical');
      expect(secret.owaspTags).toContain('mcp-top-10:credential-leak');
    });
  });

  test('an OpenAI project key is reported', () => {
    withRepo('secret-openai', {
      'CLAUDE.md': '# App\n',
      '.claude/settings.json': { env: { OPENAI_API_KEY: 'sk-proj-abcdef0123456789abcdef0123456789abcdef01' } },
    }, ({ result }) => {
      expect(result.exposure.findings.some((f) => f.key === 'agent-config-secret-literal')).toBe(true);
    });
  });

  test('placeholder values are not reported as secrets', () => {
    withRepo('secret-placeholder', {
      'CLAUDE.md': '# App\n',
      '.claude/settings.json': { env: { ANTHROPIC_API_KEY: 'sk-ant-api03-your-key-here-replace-me-000000' } },
    }, ({ result }) => {
      expect(result.exposure.findings.filter((f) => f.key === 'agent-config-secret-literal')).toEqual([]);
    });
  });

  test('a hook addressed via $CLAUDE_PROJECT_DIR is not reported as missing', () => {
    withRepo('hook-projectdir', {
      'CLAUDE.md': '# App\n',
      'tools/check.py': 'print("ok")\n',
      '.claude/settings.json': {
        hooks: {
          PreToolUse: [{
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'python "$CLAUDE_PROJECT_DIR/tools/check.py"' }],
          }],
        },
      },
    }, ({ result }) => {
      expect(result.exposure.findings.filter((f) => f.key === 'hook-script-missing')).toEqual([]);
    });
  });

  test('a genuinely missing hook script is still reported', () => {
    withRepo('hook-missing', {
      'CLAUDE.md': '# App\n',
      '.claude/settings.json': {
        hooks: {
          SessionStart: [{
            matcher: '*',
            hooks: [{ type: 'command', command: 'node .claude/hooks/session-start.js' }],
          }],
        },
      },
    }, ({ result }) => {
      expect(result.exposure.findings.some((f) => f.key === 'hook-script-missing')).toBe(true);
    });
  });

  test('a clean repo reports zero exposure findings and exits 0', () => {
    withRepo('clean', {
      'CLAUDE.md': '# App\nRun `npm test`.\n',
      'package.json': { name: 'demo', scripts: { test: 'node --test' } },
      '.claude/settings.json': { permissions: { allow: ['Bash(npm test *)'] } },
    }, ({ result, exitCode }) => {
      expect(result.exposure.count).toBe(0);
      expect(exitCode).toBe(0);
      expect(result.clean).toBe(true);
    });
  });
});
