const fs = require('fs');
const os = require('os');
const path = require('path');

const { TECHNIQUES, STACKS, containsEmbeddedSecret } = require('../src/techniques');
const { redactEmbeddedSecrets } = require('../src/secret-patterns');
const { ProjectContext } = require('../src/context');

function mkFixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `techniques-jest-${name}-`));
}

function cleanFixture(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('Techniques', () => {
  test('all techniques have required fields', () => {
    for (const [key, t] of Object.entries(TECHNIQUES)) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(typeof t.check).toBe('function');
      expect(['critical', 'high', 'medium', 'low']).toContain(t.impact);
      expect(t.category).toBeTruthy();
    }
  });

  test('no duplicate technique IDs', () => {
    const ids = Object.values(TECHNIQUES).map(t => t.id);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  test('no duplicate technique names', () => {
    const names = Object.values(TECHNIQUES).map(t => t.name);
    const unique = new Set(names);
    expect(names.length).toBe(unique.size);
  });

  test('technique count is 403 after the latest check expansion', () => {
    expect(Object.keys(TECHNIQUES).length).toBe(403);
  });

  test('technique barrel preserves all split module keys', () => {
    const moduleNames = [
      'instructions',
      'quality',
      'api',
      'automation',
      'hygiene',
      'observability',
      'workflow',
      'tools',
      'security',
      'compliance',
      'optimization',
      'stacks',
    ];

    const splitKeys = new Set();
    for (const moduleName of moduleNames) {
      const fragment = require(`../src/techniques/${moduleName}`);
      expect(Object.keys(fragment).length).toBeGreaterThan(0);

      for (const key of Object.keys(fragment)) {
        expect(splitKeys.has(key)).toBe(false);
        splitKeys.add(key);
      }
    }

    expect(splitKeys.size).toBeLessThan(Object.keys(TECHNIQUES).length);
    for (const key of splitKeys) {
      expect(TECHNIQUES[key]).toBeTruthy();
    }
  });

  test('embedded secret detector catches Anthropic-style keys with dashes', () => {
    expect(containsEmbeddedSecret('ANTHROPIC_API_KEY=sk-ant-api03-fakekeyfakekey1234567890abcdef')).toBe(true);
  });

  test('embedded secret detector catches AWS access key ids', () => {
    expect(containsEmbeddedSecret('AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF')).toBe(true);
  });

  test('embedded secret detector catches Azure connection strings', () => {
    expect(containsEmbeddedSecret('AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=nerviqdemo;AccountKey=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHijklmnopQRSTUV==;EndpointSuffix=core.windows.net')).toBe(true);
  });

  test('embedded secret detector catches GCP service account private keys', () => {
    const gcpJson = JSON.stringify({
      type: 'service_account',
      client_email: 'nerviq-demo@nerviq-prod.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC1234567890abcdefghijklmnopqrstuv==\\n-----END PRIVATE KEY-----\\n',
    }, null, 2);
    expect(containsEmbeddedSecret(gcpJson)).toBe(true);
  });

  test('embedded secret detector catches SSH private keys', () => {
    const key = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAlwAAAAdzc2gtcnNhAAAAAwEAAQAAAIEA1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890==\n-----END OPENSSH PRIVATE KEY-----';
    expect(containsEmbeddedSecret(key)).toBe(true);
  });

  test('embedded secret detector catches JWTs and database connection strings', () => {
    expect(containsEmbeddedSecret('AUTH_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJuZXJ2aXEtYXBwIiwicm9sZSI6ImFkbWluIn0.c2lnbmF0dXJlMTIzNDU2Nzg5MGFiY2RlZg')).toBe(true);
    expect(containsEmbeddedSecret('DATABASE_URL=postgres://nerviq:supersecret123@db.internal:5432/nerviq')).toBe(true);
  });

  test('embedded secret redaction scrubs expanded secret formats', () => {
    const mixed = [
      'Server=db.internal;Database=nerviq;User Id=sa;Password=UltraSecret123!;',
      'JWT=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJuZXJ2aXEifQ.c2lnbmF0dXJlMTIz',
    ].join('\n');
    const redacted = redactEmbeddedSecrets(mixed);
    expect(redacted).toContain('[REDACTED_SECRET]');
    expect(redacted).not.toContain('UltraSecret123');
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  test('embedded secret detector ignores placeholder guidance text', () => {
    expect(containsEmbeddedSecret('Set ANTHROPIC_API_KEY in your environment before running the review.')).toBe(false);
  });

  test('loop safety technique detects configured boundaries', () => {
    const dir = mkFixture('loop-safety');
    try {
      writeFile(dir, 'CLAUDE.md', '# Project\nUse maxTurns: 50 and maxTokens: 20000 for bounded review loops.\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.loopSafetyBoundaries.check(ctx)).toBe(true);
    } finally {
      cleanFixture(dir);
    }
  });

  test('consistency/pass@k technique detects repeated-run guidance', () => {
    const dir = mkFixture('pass-at-k');
    try {
      writeFile(dir, 'CLAUDE.md', '# Evaluation\nRun pass@k consistency checks with multiple runs for reproducibility.\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.consistencyPassAtK.check(ctx)).toBe(true);
    } finally {
      cleanFixture(dir);
    }
  });

  test('instinct-to-skill technique detects phased learning guidance', () => {
    const dir = mkFixture('instinct-skill');
    try {
      writeFile(dir, 'CLAUDE.md', '# Learning\nUse a progressive learning path with an instinct-to-skill phased approach.\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.instinctToSkillProgression.check(ctx)).toBe(true);
    } finally {
      cleanFixture(dir);
    }
  });

  test('python stack checks return null for non-python projects', () => {
    const dir = mkFixture('non-python');
    try {
      writeFile(dir, 'package.json', '{"name":"js-only"}');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.pyprojectTomlExists.check(ctx)).toBe(null);
      expect(TECHNIQUES.pythonTypeHints.check(ctx)).toBe(null);
    } finally {
      cleanFixture(dir);
    }
  });

  test('python stack checks detect nested source files', () => {
    const dir = mkFixture('python-nested');
    try {
      writeFile(dir, 'src/app.py', 'from typing import Optional\n\ndef run(value: str) -> Optional[str]:\n    return value\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.pythonTypeHints.check(ctx)).toBe(null);
    } finally {
      cleanFixture(dir);
    }
  });

  test('go stack checks return null for non-go projects', () => {
    const dir = mkFixture('non-go');
    try {
      writeFile(dir, 'README.md', '# No Go here\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.goModExists.check(ctx)).toBe(null);
      expect(TECHNIQUES.goLinter.check(ctx)).toBe(null);
    } finally {
      cleanFixture(dir);
    }
  });

  test('rust stack checks return null for non-rust projects', () => {
    const dir = mkFixture('non-rust');
    try {
      writeFile(dir, 'README.md', '# No Rust here\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.cargoTomlExists.check(ctx)).toBe(null);
      expect(TECHNIQUES.rustEdition.check(ctx)).toBe(null);
    } finally {
      cleanFixture(dir);
    }
  });

  test('rust stack checks detect nested Cargo manifests', () => {
    const dir = mkFixture('rust-nested');
    try {
      writeFile(dir, 'services/api/Cargo.toml', '[package]\nname = "api"\nversion = "0.1.0"\nedition = "2021"\nrust-version = "1.78"\n');
      writeFile(dir, 'services/api/src/lib.rs', '/// Greets callers.\npub fn greet() -> &\'static str { "hi" }\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.cargoTomlExists.check(ctx)).toBe(null);
      expect(TECHNIQUES.rustEdition.check(ctx)).toBe(null);
      expect(TECHNIQUES.rustMSRV.check(ctx)).toBe(null);
    } finally {
      cleanFixture(dir);
    }
  });

  test('java stack checks return null for non-java projects', () => {
    const dir = mkFixture('non-java');
    try {
      writeFile(dir, 'README.md', '# No Java here\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.mavenOrGradle.check(ctx)).toBe(null);
      expect(TECHNIQUES.javaVersion.check(ctx)).toBe(null);
    } finally {
      cleanFixture(dir);
    }
  });

  test('java stack checks detect nested build files', () => {
    const dir = mkFixture('java-nested');
    try {
      writeFile(dir, 'backend/pom.xml', '<project><properties><java.version>21</java.version></properties><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>');
      writeFile(dir, 'backend/src/main/resources/application.yml', 'spring:\n  application:\n    name: demo\n');
      const ctx = new ProjectContext(dir);
      expect(TECHNIQUES.mavenOrGradle.check(ctx)).toBe(true);
      expect(TECHNIQUES.javaVersion.check(ctx)).toBe(true);
      expect(TECHNIQUES.springBootDetected.check(ctx)).toBe(true);
      expect(TECHNIQUES.javaPropertyFiles.check(ctx)).toBe(true);
    } finally {
      cleanFixture(dir);
    }
  });
});

describe('Stacks', () => {
  test('all stacks have required fields', () => {
    for (const [key, s] of Object.entries(STACKS)) {
      expect(s.label).toBeTruthy();
      expect(Array.isArray(s.files)).toBe(true);
      expect(s.files.length).toBeGreaterThan(0);
    }
  });

  test('stack count is 30', () => {
    expect(Object.keys(STACKS).length).toBe(30);
  });
});
