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

function setupFixableAuditRepo(dir) {
  writeJson(dir, 'package.json', {
    name: 'audit-fix-demo',
    scripts: {
      test: 'jest',
      lint: 'eslint .',
      build: 'tsc --noEmit',
    },
  });
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

function setupNoFixableCriticalRepo(dir) {
  setupFixableAuditRepo(dir);
  writeFile(dir, 'CLAUDE.md', [
    '# Repo',
    '',
    '## Verification',
    '- Test: `npm test`',
    '- Lint: `npm run lint`',
    '- Build: `npm run build`',
    '',
    'sk-ant-123456789012345678901234',
  ].join('\n'));
}

function listRollbackFiles(dir) {
  const rollbackDir = path.join(dir, '.nerviq', 'rollbacks');
  if (!fs.existsSync(rollbackDir)) {
    return [];
  }
  return fs.readdirSync(rollbackDir).filter((file) => file.endsWith('.json'));
}

describe('audit --fix', () => {
  test('audit --fix --dry-run shows proposed changes and writes nothing', () => {
    const dir = mkFixture('dry-run');
    try {
      setupFixableAuditRepo(dir);
      const result = runCli(['audit', '--fix', '--dry-run', '--auto'], dir);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('תוכנית autofix');
      expect(result.stdout).toContain('שינוי מוצע: CLAUDE.md');
      expect(result.stdout).toContain('+++ CLAUDE.md');
      expect(result.stdout).toContain('Dry-run הושלם. לא נכתבו קבצים.');
      expect(fs.existsSync(path.join(dir, 'CLAUDE.md'))).toBe(false);
      expect(fs.existsSync(path.join(dir, '.nerviq', 'rollbacks'))).toBe(false);
    } finally {
      cleanFixture(dir);
    }
  });

  test('audit --fix --auto applies changes', async () => {
    const dir = mkFixture('auto');
    try {
      setupFixableAuditRepo(dir);
      const result = runCli(['audit', '--fix', '--auto'], dir);

      expect(result.status).toBe(0);
      expect(fs.existsSync(path.join(dir, 'CLAUDE.md'))).toBe(true);

      const auditResult = await audit({ dir, platform: 'claude', silent: true });
      expect(auditResult.results.find((item) => item.key === 'claudeMd').passed).toBe(true);
      expect(auditResult.results.find((item) => item.key === 'verificationLoop').passed).toBe(true);
    } finally {
      cleanFixture(dir);
    }
  });

  test('rollback snapshot exists after successful fix', () => {
    const dir = mkFixture('rollback');
    try {
      setupFixableAuditRepo(dir);
      const result = runCli(['audit', '--fix', '--auto'], dir);

      expect(result.status).toBe(0);

      const rollbackFiles = listRollbackFiles(dir);
      expect(rollbackFiles.length).toBeGreaterThan(0);

      const rollbackPath = path.join(dir, '.nerviq', 'rollbacks', rollbackFiles[0]);
      const manifest = JSON.parse(fs.readFileSync(rollbackPath, 'utf8'));
      expect(manifest.createdFiles).toContain('CLAUDE.md');
    } finally {
      cleanFixture(dir);
    }
  });

  test('file with DO NOT AUTOEDIT marker is skipped with a warning', () => {
    const dir = mkFixture('marker');
    try {
      setupProtectedInstructionRepo(dir);
      const before = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      const result = runCli(['audit', '--fix', '--auto'], dir);
      const combinedOutput = `${result.stdout}\n${result.stderr}`;

      expect(combinedOutput).toContain('DO NOT AUTOEDIT');
      expect(combinedOutput).toContain('Skipped CLAUDE.md');
      expect(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8')).toBe(before);
    } finally {
      cleanFixture(dir);
    }
  });

  test('exit code 1 when re-audit still flags a targeted check', () => {
    const dir = mkFixture('exit-one');
    try {
      setupProtectedInstructionRepo(dir);
      const result = runCli(['audit', '--fix', '--auto'], dir);
      const combinedOutput = `${result.stdout}\n${result.stderr}`;

      expect(result.status).toBe(1);
      expect(combinedOutput).toContain('בדיקות שלא נפתרו: verificationLoop');
    } finally {
      cleanFixture(dir);
    }
  });

  test('exit code 2 when no fixable critical issues exist', () => {
    const dir = mkFixture('exit-two');
    try {
      setupNoFixableCriticalRepo(dir);
      const result = runCli(['audit', '--fix', '--auto'], dir);

      expect(result.status).toBe(2);
      expect(result.stdout).toContain('אין תיקוני critical אוטומטיים זמינים');
    } finally {
      cleanFixture(dir);
    }
  });

  test('hygiene fix can create CHANGELOG.md with rollback support', () => {
    const dir = mkFixture('hygiene');
    try {
      writeJson(dir, 'package.json', { name: 'hygiene-demo' });
      const result = runCli(['fix', 'changelog', '--auto'], dir);

      expect(result.status).toBe(0);
      expect(fs.existsSync(path.join(dir, 'CHANGELOG.md'))).toBe(true);

      const rollbackFiles = listRollbackFiles(dir);
      expect(rollbackFiles.length).toBeGreaterThan(0);

      const rollbackPath = path.join(dir, '.nerviq', 'rollbacks', rollbackFiles[0]);
      const manifest = JSON.parse(fs.readFileSync(rollbackPath, 'utf8'));
      expect(manifest.createdFiles).toContain('CHANGELOG.md');
    } finally {
      cleanFixture(dir);
    }
  });
});
