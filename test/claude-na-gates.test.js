/**
 * PP-06 Claude recalibration — N/A gating regression tests.
 *
 * For each of the 11 previously-strict-FP keys, verify:
 *   1. Repo that does NOT opt in → check returns null (N/A).
 *   2. Repo that DOES opt in but is misconfigured → check returns false.
 *
 * The advisory semantic is preserved when opt-in is genuine; the hard fail
 * is dropped on repos that don't use the convention at all.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { TECHNIQUES } = require('../src/techniques');
const { ProjectContext } = require('../src/context');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `claude-na-${name}-`));
}

function cleanFixture(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const out = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(full, out, 'utf8');
}

describe('Claude PP-06 N/A gating (11 opt-in checks)', () => {
  // --- claudeLocalMd -------------------------------------------------
  test('claudeLocalMd — N/A when no personal-overrides convention', () => {
    const dir = mkFixture('local-md-na');
    try {
      writeFile(dir, 'package.json', { name: 'x' });
      writeFile(dir, 'CLAUDE.md', '# Project\nNothing about local overrides.\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.claudeLocalMd.check(ctx)).toBeNull();
    } finally { cleanFixture(dir); }
  });

  test('claudeLocalMd — fails when repo opts in (gitignore mentions it) but file missing', () => {
    const dir = mkFixture('local-md-optin');
    try {
      writeFile(dir, 'package.json', { name: 'x' });
      writeFile(dir, '.gitignore', 'CLAUDE.local.md\nnode_modules\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.claudeLocalMd.check(ctx)).toBe(false);
    } finally { cleanFixture(dir); }
  });

  // --- autoMemoryAwareness ------------------------------------------
  test('autoMemoryAwareness — N/A when CLAUDE.md never mentions memory', () => {
    const dir = mkFixture('memory-na');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project\nShort doc without that concept.\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.autoMemoryAwareness.check(ctx)).toBeNull();
    } finally { cleanFixture(dir); }
  });

  test('autoMemoryAwareness — fails when repo opts in (.claude/memory) without proper guidance', () => {
    const dir = mkFixture('memory-optin');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project\n');
      fs.mkdirSync(path.join(dir, '.claude', 'memory'), { recursive: true });
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.autoMemoryAwareness.check(ctx)).toBe(false);
    } finally { cleanFixture(dir); }
  });

  // --- dockerfile ---------------------------------------------------
  test('dockerfile — N/A when repo has no infra signal', () => {
    const dir = mkFixture('docker-na');
    try {
      writeFile(dir, 'package.json', { name: 'x' });
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.dockerfile.check(ctx)).toBeNull();
    } finally { cleanFixture(dir); }
  });

  test('dockerfile — fails when repo opts in to infra (k8s/) but has no Dockerfile', () => {
    const dir = mkFixture('docker-optin');
    try {
      writeFile(dir, 'package.json', { name: 'x' });
      fs.mkdirSync(path.join(dir, 'k8s'), { recursive: true });
      writeFile(dir, 'k8s/deployment.yaml', 'kind: Deployment\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.dockerfile.check(ctx)).toBe(false);
    } finally { cleanFixture(dir); }
  });

  // --- dockerCompose -----------------------------------------------
  test('dockerCompose — N/A when repo has no infra signal', () => {
    const dir = mkFixture('compose-na');
    try {
      writeFile(dir, 'package.json', { name: 'x' });
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.dockerCompose.check(ctx)).toBeNull();
    } finally { cleanFixture(dir); }
  });

  test('dockerCompose — fails when Dockerfile present but no compose file', () => {
    const dir = mkFixture('compose-optin');
    try {
      writeFile(dir, 'Dockerfile', 'FROM node:18\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.dockerCompose.check(ctx)).toBe(false);
    } finally { cleanFixture(dir); }
  });

  // --- terraformFiles ----------------------------------------------
  test('terraformFiles — N/A when repo has no infra signal', () => {
    const dir = mkFixture('tf-na');
    try {
      writeFile(dir, 'package.json', { name: 'x' });
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.terraformFiles.check(ctx)).toBeNull();
    } finally { cleanFixture(dir); }
  });

  test('terraformFiles — fails when repo opts in to infra (Dockerfile) but has no terraform', () => {
    const dir = mkFixture('tf-optin');
    try {
      writeFile(dir, 'Dockerfile', 'FROM alpine\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.terraformFiles.check(ctx)).toBe(false);
    } finally { cleanFixture(dir); }
  });

  // --- mcpServers ---------------------------------------------------
  test('mcpServers — N/A when repo has no MCP reference', () => {
    const dir = mkFixture('mcp-na');
    try {
      writeFile(dir, 'package.json', { name: 'x' });
      writeFile(dir, 'CLAUDE.md', '# Project\nNo tool talk here.\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.mcpServers.check(ctx)).toBeNull();
    } finally { cleanFixture(dir); }
  });

  test('mcpServers — fails when CLAUDE.md mentions MCP but no .mcp.json exists', () => {
    const dir = mkFixture('mcp-optin');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project\nWe plan to use MCP servers for tool access.\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.mcpServers.check(ctx)).toBe(false);
    } finally { cleanFixture(dir); }
  });

  // --- multipleMcpServers ------------------------------------------
  test('multipleMcpServers — N/A when repo has no MCP reference', () => {
    const dir = mkFixture('mcp-multi-na');
    try {
      writeFile(dir, 'package.json', { name: 'x' });
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.multipleMcpServers.check(ctx)).toBeNull();
    } finally { cleanFixture(dir); }
  });

  test('multipleMcpServers — fails when only one MCP server configured', () => {
    const dir = mkFixture('mcp-multi-optin');
    try {
      writeFile(dir, '.mcp.json', { mcpServers: { solo: { command: 'npx', args: ['x'] } } });
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.multipleMcpServers.check(ctx)).toBe(false);
    } finally { cleanFixture(dir); }
  });

  // --- context7Mcp -------------------------------------------------
  test('context7Mcp — N/A when repo has no MCP reference', () => {
    const dir = mkFixture('c7-na');
    try {
      writeFile(dir, 'package.json', { name: 'x' });
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.context7Mcp.check(ctx)).toBeNull();
    } finally { cleanFixture(dir); }
  });

  test('context7Mcp — fails when MCP configured but context7 not included', () => {
    const dir = mkFixture('c7-optin');
    try {
      writeFile(dir, '.mcp.json', { mcpServers: { github: { command: 'npx', args: ['x'] } } });
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.context7Mcp.check(ctx)).toBe(false);
    } finally { cleanFixture(dir); }
  });

  // --- importSyntax -------------------------------------------------
  test('importSyntax — N/A when CLAUDE.md is short and has no @-imports', () => {
    const dir = mkFixture('import-na');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project\nSmall instructions file.\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.importSyntax.check(ctx)).toBeNull();
    } finally { cleanFixture(dir); }
  });

  test('importSyntax — fails when CLAUDE.md is long but has no @-imports', () => {
    const dir = mkFixture('import-optin');
    try {
      const longMd = '# Project\n' + 'Line of instructions.\n'.repeat(100);
      writeFile(dir, 'CLAUDE.md', longMd);
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.importSyntax.check(ctx)).toBe(false);
    } finally { cleanFixture(dir); }
  });

  // --- hooksNotificationEvent --------------------------------------
  test('hooksNotificationEvent — N/A when settings.json has no hooks block', () => {
    const dir = mkFixture('hooks-notif-na');
    try {
      writeFile(dir, '.claude/settings.json', { permissions: { defaultMode: 'acceptEdits' } });
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.hooksNotificationEvent.check(ctx)).toBeNull();
    } finally { cleanFixture(dir); }
  });

  test('hooksNotificationEvent — fails when hooks block exists but no Notification event', () => {
    const dir = mkFixture('hooks-notif-optin');
    try {
      writeFile(dir, '.claude/settings.json', {
        hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo' }] }] },
      });
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.hooksNotificationEvent.check(ctx)).toBe(false);
    } finally { cleanFixture(dir); }
  });

  // --- subagentStopHook --------------------------------------------
  test('subagentStopHook — N/A when settings.json has no hooks block', () => {
    const dir = mkFixture('subagent-na');
    try {
      writeFile(dir, 'package.json', { name: 'x' });
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.subagentStopHook.check(ctx)).toBeNull();
    } finally { cleanFixture(dir); }
  });

  test('subagentStopHook — fails when hooks block exists but no SubagentStop event', () => {
    const dir = mkFixture('subagent-optin');
    try {
      writeFile(dir, '.claude/settings.json', {
        hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'echo' }] }] },
      });
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.subagentStopHook.check(ctx)).toBe(false);
    } finally { cleanFixture(dir); }
  });
});
