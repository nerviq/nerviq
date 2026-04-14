const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { audit } = require('../src/audit');

const CLI_PATH = path.resolve(__dirname, '..', 'bin', 'cli.js');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-audit-fix-${name}-`));
}

function cleanFixture(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(dir, relPath, content) {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function writeJson(dir, relPath, value) {
  writeFile(dir, relPath, JSON.stringify(value, null, 2));
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
  });
}

function runGit(args, cwd) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
  });
}

function setupFixableAuditRepo(dir) {
  writeJson(dir, 'package.json', {
    name: 'audit-fix-demo',
    scripts: {
      test: 'jest',
      lint: 'eslint .',
      build: 'tsc --noEmit',
    },
  });
  writeFile(dir, 'src/index.js', 'console.log("audit-fix");\n');
}

function setupProtectedInstructionRepo(dir) {
  setupFixableAuditRepo(dir);
  writeFile(dir, 'CLAUDE.md', [
    '# Protected Instructions',
    '',
    'DO NOT AUTOEDIT',
    '',
    'Keep this file hand-maintained.',
  ].join('\n'));
}

function setupAdvisoryOnlyRepo(dir) {
  setupFixableAuditRepo(dir);
  writeFile(dir, 'CLAUDE.md', [
    '# Repo Instructions',
    '',
    '## Verification',
    '- Test: `npm test`',
    '- Lint: `npm run lint`',
    '- Build: `npm run build`',
  ].join('\n'));
  writeFile(dir, '.gitignore', [
    '.env',
    '.env.*',
    '.claude/settings.local.json',
    'CLAUDE.local.md',
  ].join('\n'));
  writeJson(dir, '.claude/settings.json', {
    permissions: {
      defaultMode: 'bypassPermissions',
      deny: ['Read(.env)', 'Read(.env.*)', 'Read(**/secrets/**)'],
    },
  });
  writeFile(dir, 'LICENSE', 'placeholder\n');
  writeFile(dir, 'CHANGELOG.md', '# Changelog\n');
  writeFile(dir, 'CONTRIBUTING.md', '# Contributing\n');
  writeFile(dir, '.editorconfig', 'root = true\n');
}

function listRollbackFiles(dir) {
  const rollbackDir = path.join(dir, '.nerviq', 'rollbacks');
  if (!fs.existsSync(rollbackDir)) {
    return [];
  }
  return fs.readdirSync(rollbackDir).filter((file) => file.endsWith('.json'));
}

function initGitRepo(dir) {
  expect(runGit(['init'], dir).status).toBe(0);
  expect(runGit(['config', 'user.email', 'fixtures@nerviq.test'], dir).status).toBe(0);
  expect(runGit(['config', 'user.name', 'Nerviq Fixtures'], dir).status).toBe(0);
}

describe('audit --fix autofix workflow', () => {
  test('dry-run is the default and writes audit-fix.patch without mutating tracked files', () => {
    const dir = mkFixture('dry-run-default');
    try {
      setupFixableAuditRepo(dir);
      const beforeSource = fs.readFileSync(path.join(dir, 'src/index.js'), 'utf8');
      const result = runCli(['audit', '--fix'], dir);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Audit autofix plan');
      expect(result.stdout).toContain('Patch: audit-fix.patch');
      expect(result.stdout).toContain('Dry run complete. No files were written.');
      expect(fs.existsSync(path.join(dir, 'audit-fix.patch'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'CLAUDE.md'))).toBe(false);
      expect(fs.readFileSync(path.join(dir, 'src/index.js'), 'utf8')).toBe(beforeSource);
      expect(fs.existsSync(path.join(dir, '.nerviq', 'rollbacks'))).toBe(false);
    } finally {
      cleanFixture(dir);
    }
  });

  test('dry-run patch contains unified diff headers for planned files', () => {
    const dir = mkFixture('patch-shape');
    try {
      setupFixableAuditRepo(dir);
      const result = runCli(['audit', '--fix'], dir);
      const patch = fs.readFileSync(path.join(dir, 'audit-fix.patch'), 'utf8');

      expect(result.status).toBe(0);
      expect(patch).toContain('diff --git a/CLAUDE.md b/CLAUDE.md');
      expect(patch).toContain('--- /dev/null');
      expect(patch).toContain('+++ b/CLAUDE.md');
    } finally {
      cleanFixture(dir);
    }
  });

  test('`--out -` prints the patch to stdout instead of writing audit-fix.patch', () => {
    const dir = mkFixture('stdout');
    try {
      setupFixableAuditRepo(dir);
      const result = runCli(['audit', '--fix', '--out', '-'], dir);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('diff --git a/CLAUDE.md b/CLAUDE.md');
      expect(fs.existsSync(path.join(dir, 'audit-fix.patch'))).toBe(false);
    } finally {
      cleanFixture(dir);
    }
  });

  test('`--auto` without `--apply` still stays in dry-run mode', () => {
    const dir = mkFixture('auto-dry');
    try {
      setupFixableAuditRepo(dir);
      const result = runCli(['audit', '--fix', '--auto'], dir);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Dry run complete. No files were written.');
      expect(fs.existsSync(path.join(dir, 'CLAUDE.md'))).toBe(false);
    } finally {
      cleanFixture(dir);
    }
  });

  test('`--apply` requires `--auto`', () => {
    const dir = mkFixture('apply-needs-auto');
    try {
      setupFixableAuditRepo(dir);
      const result = runCli(['audit', '--fix', '--apply'], dir);
      const combined = `${result.stdout}\n${result.stderr}`;

      expect(result.status).toBe(2);
      expect(combined).toContain('requires `--auto`');
      expect(fs.existsSync(path.join(dir, 'CLAUDE.md'))).toBe(false);
    } finally {
      cleanFixture(dir);
    }
  });

  test('`--apply --auto` creates deterministic governance and hygiene files', async () => {
    const dir = mkFixture('apply-auto');
    try {
      setupFixableAuditRepo(dir);
      const result = runCli(['audit', '--fix', '--apply', '--auto'], dir);

      expect(result.status).toBe(0);
      expect(fs.existsSync(path.join(dir, 'CLAUDE.md'))).toBe(true);
      expect(fs.existsSync(path.join(dir, '.claude', 'settings.json'))).toBe(true);
      expect(fs.existsSync(path.join(dir, '.gitignore'))).toBe(true);
      expect(fs.existsSync(path.join(dir, '.editorconfig'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'LICENSE'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'CHANGELOG.md'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'CONTRIBUTING.md'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'audit-fix.patch'))).toBe(true);

      const auditResult = await audit({ dir, platform: 'claude', silent: true });
      const byKey = new Map(auditResult.results.map((item) => [item.key, item]));
      expect(byKey.get('claudeMd').passed).toBe(true);
      expect(byKey.get('verificationLoop').passed).toBe(true);
      expect(byKey.get('testCommand').passed).toBe(true);
      expect(byKey.get('lintCommand').passed).toBe(true);
      expect(byKey.get('buildCommand').passed).toBe(true);
      expect(byKey.get('gitIgnoreEnv').passed).toBe(true);
      expect(byKey.get('secretsProtection').passed).toBe(true);
      expect(byKey.get('editorconfig').passed).toBe(true);
    } finally {
      cleanFixture(dir);
    }
  });

  test('successful apply writes a rollback manifest', () => {
    const dir = mkFixture('rollback');
    try {
      setupFixableAuditRepo(dir);
      const result = runCli(['audit', '--fix', '--apply', '--auto'], dir);

      expect(result.status).toBe(0);
      const rollbackFiles = listRollbackFiles(dir);
      expect(rollbackFiles.length).toBeGreaterThan(0);

      const rollbackPath = path.join(dir, '.nerviq', 'rollbacks', rollbackFiles[0]);
      const manifest = JSON.parse(fs.readFileSync(rollbackPath, 'utf8'));
      expect(manifest.createdFiles).toContain('CLAUDE.md');
      expect(manifest.createdFiles).toContain('.editorconfig');
    } finally {
      cleanFixture(dir);
    }
  });

  test('files with DO NOT AUTOEDIT are skipped without rewriting protected instructions', () => {
    const dir = mkFixture('protected');
    try {
      setupProtectedInstructionRepo(dir);
      const before = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      const result = runCli(['audit', '--fix', '--apply', '--auto'], dir);
      const combined = `${result.stdout}\n${result.stderr}`;

      expect(result.status).toBe(0);
      expect(combined).toContain('DO NOT AUTOEDIT');
      expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe(before);
    } finally {
      cleanFixture(dir);
    }
  });

  test('manual-only findings are listed as advisory and do not produce file writes', () => {
    const dir = mkFixture('advisory-only');
    try {
      setupAdvisoryOnlyRepo(dir);
      const result = runCli(['audit', '--fix'], dir);

      expect(result.status).toBe(2);
      expect(result.stdout).toContain('Advisory only — manual fix required');
      expect(result.stdout).toContain('noBypassPermissions');
      expect(fs.existsSync(path.join(dir, 'audit-fix.patch'))).toBe(false);
    } finally {
      cleanFixture(dir);
    }
  });

  test('running apply twice is idempotent for the audited allowlist files', () => {
    const dir = mkFixture('idempotent');
    try {
      setupFixableAuditRepo(dir);
      const first = runCli(['audit', '--fix', '--apply', '--auto'], dir);
      const claudeAfterFirst = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      const second = runCli(['audit', '--fix'], dir);

      expect(first.status).toBe(0);
      expect(second.status).toBe(2);
      expect(second.stdout).toContain('No deterministic audit autofixes are available');
      expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe(claudeAfterFirst);
    } finally {
      cleanFixture(dir);
    }
  });

  test('autofix never modifies source files outside the allowlist', () => {
    const dir = mkFixture('allowlist');
    try {
      setupFixableAuditRepo(dir);
      const beforeSource = fs.readFileSync(path.join(dir, 'src/index.js'), 'utf8');
      const result = runCli(['audit', '--fix', '--apply', '--auto'], dir);

      expect(result.status).toBe(0);
      expect(fs.readFileSync(path.join(dir, 'src/index.js'), 'utf8')).toBe(beforeSource);
    } finally {
      cleanFixture(dir);
    }
  });

  test('`--pr` creates a local branch and stages the patch plus planned files', () => {
    const dir = mkFixture('pr');
    try {
      setupFixableAuditRepo(dir);
      initGitRepo(dir);
      const result = runCli(['audit', '--fix', '--pr'], dir);
      const branch = runGit(['branch', '--show-current'], dir);
      const staged = runGit(['diff', '--cached', '--name-only'], dir);

      expect(result.status).toBe(0);
      expect(branch.stdout.trim()).toMatch(/^nerviq\/autofix-/);
      expect(staged.stdout).toContain('CLAUDE.md');
      expect(staged.stdout).toContain('audit-fix.patch');
    } finally {
      cleanFixture(dir);
    }
  });
});
