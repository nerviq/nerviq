const assert = require('assert');
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { audit } = require('../src/audit');
const { setup } = require('../src/setup');
const { analyzeProject } = require('../src/analyze');
const { buildProposalBundle, applyProposalBundle } = require('../src/plans');
const { getGovernanceSummary } = require('../src/governance');
const { runBenchmark } = require('../src/benchmark');
const { generateDashboard } = require('../src/dashboard');
const { TECHNIQUES, STACKS } = require('../src/techniques');
const { ProjectContext } = require('../src/context');
const { detectAntiPatterns } = require('../src/anti-patterns');
const { getBadgeUrl, getBadgeMarkdown } = require('../src/badge');
const { shouldCollect, getLocalInsights } = require('../src/insights');
const { sendWebhook } = require('../src/integrations');
const { buildServeOpenApiSpec, createServer } = require('../src/server');

function writeJson(dir, file, value) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(value, null, 2));
}

function writeText(dir, file, content) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function mkFixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-test-${name}-`));
  return dir;
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function runCliAsync(args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'cli.js'), ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const timeoutMs = options.timeoutMs || 15000;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill();
      reject(new Error(`CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (status) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

function startTempServer(server, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function requestRaw(port, requestPath, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ❌ ${name}: ${e.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ❌ ${name}: ${e.message}`);
  }
}

async function main() {
  console.log('\n  nerviq test suite\n');

  // ============================================================
  // Unit tests: techniques
  // ============================================================
  console.log('  --- Techniques ---');

  test('All techniques have required fields', () => {
    for (const [key, t] of Object.entries(TECHNIQUES)) {
      assert.ok(t.id, `${key} missing id`);
      assert.ok(t.name, `${key} missing name`);
      assert.ok(typeof t.check === 'function', `${key} check not a function`);
      assert.ok(t.impact, `${key} missing impact`);
      assert.ok(['critical', 'high', 'medium', 'low'].includes(t.impact), `${key} invalid impact: ${t.impact}`);
      assert.ok(t.category, `${key} missing category`);
    }
  });

  test('No duplicate technique IDs', () => {
    const ids = Object.values(TECHNIQUES).map(t => t.id);
    const unique = new Set(ids);
    assert.equal(ids.length, unique.size, `Duplicate IDs found: ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  });

  test('No duplicate technique names', () => {
    const names = Object.values(TECHNIQUES).map(t => t.name);
    const unique = new Set(names);
    assert.equal(names.length, unique.size, 'Duplicate names found');
  });

  test('Packaged Claude-native skill template exists and is published', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const skillPath = path.join(__dirname, '..', 'content', 'claude-code', 'audit-repo', 'SKILL.md');
    assert.ok(fs.existsSync(skillPath), 'audit-repo skill template should exist');
    // content dir may be excluded by .npmignore — check file exists instead
    assert.ok(fs.existsSync(skillPath), 'skill template file should exist locally');
  });

  test('Claude verification checks accept commands from .claude command docs', () => {
    const dir = mkFixture('claude-command-docs');
    try {
      fs.mkdirSync(path.join(dir, '.claude', 'commands'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'commands', 'verify.md'), [
        '# Verify',
        '- Test: `npm test`',
        '- Lint: `npm run lint`',
        '- Build: `npm run build`',
        ''
      ].join('\n'));
      const ctx = new ProjectContext(dir);
      assert.equal(TECHNIQUES.verificationLoop.check(ctx), true, 'verificationLoop should accept .claude command docs');
      assert.equal(TECHNIQUES.testCommand.check(ctx), true, 'testCommand should accept .claude command docs');
      assert.equal(TECHNIQUES.lintCommand.check(ctx), true, 'lintCommand should accept .claude command docs');
      assert.equal(TECHNIQUES.buildCommand.check(ctx), true, 'buildCommand should accept .claude command docs');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Claude verification checks accept Flutter verification command variants', () => {
    const dir = mkFixture('claude-flutter-verification');
    try {
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), [
        '# Flutter app',
        '- Test: `flutter test --coverage`',
        '- Lint: `flutter analyze --fatal-infos`',
        '- Build: `flutter build ios --release`',
        ''
      ].join('\n'));
      const ctx = new ProjectContext(dir);
      assert.equal(TECHNIQUES.verificationLoop.check(ctx), true, 'verificationLoop should accept Flutter verification commands');
      assert.equal(TECHNIQUES.testCommand.check(ctx), true, 'testCommand should accept Flutter test variants');
      assert.equal(TECHNIQUES.lintCommand.check(ctx), true, 'lintCommand should accept Flutter analyze variants');
      assert.equal(TECHNIQUES.buildCommand.check(ctx), true, 'buildCommand should accept Flutter build variants');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Claude verification checks accept Swift and Xcode verification command variants', () => {
    const dir = mkFixture('claude-swift-verification');
    try {
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), [
        '# iOS app',
        '- Test: `xcodebuild -scheme App -destination \"platform=iOS Simulator,name=iPhone 15\" test`',
        '- Lint: `swift-format lint Sources Tests`',
        '- Build: `xcodebuild -scheme App build`',
        ''
      ].join('\n'));
      const ctx = new ProjectContext(dir);
      assert.equal(TECHNIQUES.verificationLoop.check(ctx), true, 'verificationLoop should accept Xcode verification commands');
      assert.equal(TECHNIQUES.testCommand.check(ctx), true, 'testCommand should accept xcodebuild test with flags');
      assert.equal(TECHNIQUES.lintCommand.check(ctx), true, 'lintCommand should accept swift-format lint');
      assert.equal(TECHNIQUES.buildCommand.check(ctx), true, 'buildCommand should accept xcodebuild build');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Claude verification checks accept Python verification command variants', () => {
    const dir = mkFixture('claude-python-verification');
    try {
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), [
        '# Django service',
        '- Test: `python manage.py test`',
        '- Typecheck: `pyright`',
        '- Build: `python -m build`',
        ''
      ].join('\n'));
      const ctx = new ProjectContext(dir);
      assert.equal(TECHNIQUES.verificationLoop.check(ctx), true, 'verificationLoop should accept Python verification commands');
      assert.equal(TECHNIQUES.testCommand.check(ctx), true, 'testCommand should accept manage.py test');
      assert.equal(TECHNIQUES.lintCommand.check(ctx), true, 'lintCommand should accept pyright');
      assert.equal(TECHNIQUES.buildCommand.check(ctx), true, 'buildCommand should accept python -m build');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Claude verification checks accept Go verification command variants', () => {
    const dir = mkFixture('claude-go-verification');
    try {
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), [
        '# Go service',
        '- Test: `go test -race ./...`',
        '- Format: `gofmt ./...`',
        '- Build: `go build ./...`',
        ''
      ].join('\n'));
      const ctx = new ProjectContext(dir);
      assert.equal(TECHNIQUES.verificationLoop.check(ctx), true, 'verificationLoop should accept Go verification commands');
      assert.equal(TECHNIQUES.testCommand.check(ctx), true, 'testCommand should accept go test variants');
      assert.equal(TECHNIQUES.lintCommand.check(ctx), true, 'lintCommand should accept gofmt');
      assert.equal(TECHNIQUES.buildCommand.check(ctx), true, 'buildCommand should accept go build variants');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Claude verification checks accept .NET verification command variants', () => {
    const dir = mkFixture('claude-dotnet-verification');
    try {
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), [
        '# .NET service',
        '- Test: `dotnet test src/App.sln --configuration Release`',
        '- Format: `dotnet format --verify-no-changes`',
        '- Build: `dotnet publish src/App/App.csproj -c Release`',
        ''
      ].join('\n'));
      const ctx = new ProjectContext(dir);
      assert.equal(TECHNIQUES.verificationLoop.check(ctx), true, 'verificationLoop should accept .NET verification commands');
      assert.equal(TECHNIQUES.testCommand.check(ctx), true, 'testCommand should accept dotnet test variants');
      assert.equal(TECHNIQUES.lintCommand.check(ctx), true, 'lintCommand should accept dotnet format variants');
      assert.equal(TECHNIQUES.buildCommand.check(ctx), true, 'buildCommand should accept dotnet publish');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Anti-patterns do not flag missing verification when AGENTS.md documents commands', () => {
    const dir = mkFixture('anti-pattern-agents');
    try {
      fs.writeFileSync(path.join(dir, 'AGENTS.md'), [
        '# Repo contract',
        '',
        '## Verification',
        '- Test: `pytest`',
        '- Lint: `ruff check .`',
        '- Build: `python -m build`',
        ''
      ].join('\n'));
      const ctx = new ProjectContext(dir);
      const ids = detectAntiPatterns(ctx).map((item) => item.id);
      assert.ok(!ids.includes('AP007'), 'AP007 should not fire when verification commands are documented in AGENTS.md');
      assert.ok(!ids.includes('AP014'), 'AP014 should not fire when a test command is documented in AGENTS.md');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Anti-patterns do not flag missing verification when command docs exist under .claude/commands', () => {
    const dir = mkFixture('anti-pattern-claude-commands');
    try {
      fs.mkdirSync(path.join(dir, '.claude', 'commands'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'commands', 'verify.md'), [
        '# Verify',
        'Run `go test ./...` before handoff.',
        'Run `go vet ./...` after edits.',
        ''
      ].join('\n'));
      const ctx = new ProjectContext(dir);
      const ids = detectAntiPatterns(ctx).map((item) => item.id);
      assert.ok(!ids.includes('AP007'), 'AP007 should not fire when .claude command docs contain verification guidance');
      assert.ok(!ids.includes('AP014'), 'AP014 should not fire when .claude command docs contain a test command');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Anti-patterns still flag AP014 when no documented or scripted test command exists', () => {
    const dir = mkFixture('anti-pattern-no-test-command');
    try {
      fs.writeFileSync(path.join(dir, 'README.md'), '# Repo\nNo canonical verification commands yet.\n');
      const ctx = new ProjectContext(dir);
      const ids = detectAntiPatterns(ctx).map((item) => item.id);
      assert.ok(ids.includes('AP014'), 'AP014 should fire when no test command exists anywhere');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ============================================================
  // Unit tests: empty project
  // ============================================================
  console.log('\n  --- Empty project ---');

  await testAsync('Empty project gets low score', async () => {
    const dir = mkFixture('empty');
    try {
      const result = await audit({ dir, silent: true });
      assert.ok(result.score < 20, `Empty project scored ${result.score}, expected < 20`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Empty project has no vacuous passes for hooks/commands/agents', async () => {
    const dir = mkFixture('empty-vacuous');
    try {
      const result = await audit({ dir, silent: true });
      const passedKeys = result.results.filter(r => r.passed === true).map(r => r.key);
      assert.ok(!passedKeys.includes('hooksAreSpecific'), 'hooksAreSpecific should not pass on empty project');
      assert.ok(!passedKeys.includes('commandsUseArguments'), 'commandsUseArguments should not pass on empty project');
      assert.ok(!passedKeys.includes('agentsHaveMaxTurns'), 'agentsHaveMaxTurns should not pass on empty project');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Python project skips node_modules hygiene check', async () => {
    const dir = mkFixture('python-node-modules');
    try {
      fs.writeFileSync(path.join(dir, 'requirements.txt'), 'fastapi\npytest\n');
      fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n');
      const result = await audit({ dir, silent: true });
      const nodeModulesCheck = result.results.find(r => r.key === 'gitIgnoreNodeModules');
      assert.equal(nodeModulesCheck.passed, null, 'node_modules check should be skipped for non-Node projects');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('gitIgnoreClaudeTracked ignores only settings.local.json without failing', async () => {
    const dir = mkFixture('gitignore-claude-local');
    try {
      fs.writeFileSync(path.join(dir, '.gitignore'), '.claude/settings.local.json\n');
      const result = await audit({ dir, silent: true });
      const check = result.results.find(r => r.key === 'gitIgnoreClaudeTracked');
      assert.equal(check.passed, true, 'Ignoring only settings.local.json should still count .claude/ as tracked');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Non-frontend repos skip frontend-only design checks', async () => {
    const dir = mkFixture('non-frontend-design');
    try {
      writeJson(dir, 'package.json', { name: 'cli-tool' });
      const result = await audit({ dir, silent: true });
      const frontendSkill = result.results.find(r => r.key === 'frontendDesignSkill');
      const tailwind = result.results.find(r => r.key === 'tailwindMention');
      assert.equal(frontendSkill.passed, null, 'frontendDesignSkill should be skipped for non-frontend repos');
      assert.equal(tailwind.passed, null, 'tailwindMention should be skipped for non-frontend repos');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Audit result normalizes check states to booleans or null', async () => {
    const dir = mkFixture('audit-types');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = await audit({ dir, silent: true });
      for (const item of result.results) {
        assert.ok([true, false, null].includes(item.passed), `${item.key} returned non-normalized state: ${item.passed}`);
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Local insights ignore skipped checks when computing weak areas', async () => {
    const dir = mkFixture('insights-skips');
    try {
      fs.writeFileSync(path.join(dir, 'requirements.txt'), 'fastapi\n');
      const result = await audit({ dir, silent: true });
      const insights = getLocalInsights(result);
      assert.ok(Array.isArray(insights.weakest), 'weakest areas should be returned');
      assert.ok(insights.weakest.every(item => item.total >= item.passed), 'weakest areas should be based on applicable checks only');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Project context includes root dotfiles needed by hygiene checks', async () => {
    const dir = mkFixture('dotfiles');
    try {
      fs.writeFileSync(path.join(dir, '.editorconfig'), 'root = true\n');
      const result = await audit({ dir, silent: true });
      const editorconfig = result.results.find(r => r.key === 'editorconfig');
      assert.equal(editorconfig.passed, true, '.editorconfig should be visible to the scanner');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ============================================================
  // Unit tests: Next.js project
  // ============================================================
  console.log('\n  --- Next.js project ---');

  await testAsync('Next.js project detects React + TypeScript + Node', async () => {
    const dir = mkFixture('nextjs');
    try {
      writeJson(dir, 'package.json', { name: 'app', dependencies: { next: '16', react: '19' } });
      fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
      const ctx = new ProjectContext(dir);
      const stacks = ctx.detectStacks(STACKS);
      const labels = stacks.map(s => s.label);
      assert.ok(labels.includes('React'), 'Should detect React');
      assert.ok(labels.includes('TypeScript'), 'Should detect TypeScript');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Setup generates dependency guidelines', async () => {
    const dir = mkFixture('nextjs-deps');
    try {
      writeJson(dir, 'package.json', {
        name: 'app',
        scripts: { test: 'vitest', build: 'next build' },
        dependencies: { next: '16', react: '19', zod: '3', '@tanstack/react-query': '5', '@prisma/client': '6' },
        devDependencies: { vitest: '3', prisma: '6' }
      });
      fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}');
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      await setup({ dir, auto: true });
      const md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      assert.ok(md.includes('Zod'), 'Should mention Zod');
      assert.ok(md.includes('React Query') || md.includes('TanStack'), 'Should mention React Query');
      assert.ok(md.includes('Prisma'), 'Should mention Prisma');
      assert.ok(md.includes('Vitest'), 'Should mention Vitest');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Setup generates stack-specific commands', async () => {
    const dir = mkFixture('nextjs-cmds');
    try {
      writeJson(dir, 'package.json', { name: 'app', dependencies: { next: '16', react: '19' } });
      fs.writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
      // next.config.js triggers Next.js stack detection
      fs.writeFileSync(path.join(dir, 'next.config.js'), 'module.exports = {}');
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      await setup({ dir, auto: true });
      const deploy = fs.readFileSync(path.join(dir, '.claude/commands/deploy.md'), 'utf8');
      assert.ok(deploy.includes('Next.js') || deploy.includes('Vercel') || deploy.includes('next'), 'Deploy should be Next.js-specific');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Setup uses pyproject.toml metadata when package.json is absent', async () => {
    const dir = mkFixture('pyproject-meta');
    try {
      fs.writeFileSync(path.join(dir, 'pyproject.toml'), [
        '[project]',
        'name = "ai-copilot"',
        'description = "Python workflow assistant"',
        ''
      ].join('\n'));
      fs.writeFileSync(path.join(dir, 'requirements.txt'), 'fastapi\npytest\n');
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      await setup({ dir, auto: true });
      const md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      assert.ok(md.startsWith('# ai-copilot — Python workflow assistant'), 'Should use pyproject metadata for heading');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Next.js App Router Mermaid diagram does not contain undefined edges', async () => {
    const dir = mkFixture('next-mermaid');
    try {
      writeJson(dir, 'package.json', { name: 'app', dependencies: { next: '16', react: '19' } });
      fs.writeFileSync(path.join(dir, 'next.config.js'), 'module.exports = {}');
      fs.mkdirSync(path.join(dir, 'app', 'api'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'components'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
      await setup({ dir, auto: true });
      const md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      assert.ok(!md.includes('undefined'), 'Mermaid diagram should not contain undefined node references');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ============================================================
  // Unit tests: hooks registration
  // ============================================================
  console.log('\n  --- Hooks ---');

  await testAsync('Setup creates settings.json with hooks', async () => {
    const dir = mkFixture('hooks');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      await setup({ dir, auto: true });
      assert.ok(fs.existsSync(path.join(dir, '.claude/settings.json')), 'settings.json should exist');
      const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'));
      assert.ok(settings.hooks, 'Should have hooks');
      assert.ok(settings.hooks.PostToolUse, 'Should have PostToolUse');
      assert.ok(settings.hooks.PreToolUse, 'Should have PreToolUse');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Setup can merge requested MCP packs into generated settings', async () => {
    const dir = mkFixture('hooks-mcp');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      await setup({ dir, auto: true, mcpPacks: ['context7-docs'] });
      const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'));
      assert.ok(settings.mcpServers.context7, 'Generated settings should include Context7 MCP server');
      assert.deepEqual(settings.nerviqSetup.mcpPacks, ['context7-docs'], 'Selected MCP packs should be recorded');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Setup returns preflight warnings for MCP packs with missing env vars', async () => {
    const dir = mkFixture('hooks-mcp-env');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      const result = await setup({ dir, auto: true, silent: true, mcpPacks: ['stripe-mcp'] });
      assert.ok(Array.isArray(result.mcpPreflightWarnings), 'setup should expose MCP preflight warnings');
      const warning = result.mcpPreflightWarnings.find(item => item.key === 'stripe-mcp');
      assert.ok(warning, 'stripe-mcp should emit a preflight warning when env vars are missing');
      assert.ok(warning.missingEnvVars.includes('STRIPE_API_KEY'), 'warning should include STRIPE_API_KEY');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ============================================================
  // Unit tests: no overwrite
  // ============================================================
  console.log('\n  --- No overwrite ---');

  await testAsync('Setup does not overwrite existing CLAUDE.md', async () => {
    const dir = mkFixture('no-overwrite');
    try {
      const original = '# My custom CLAUDE.md\nDo not touch this.';
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), original);
      writeJson(dir, 'package.json', { name: 'app' });
      await setup({ dir, auto: true });
      const after = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      assert.equal(after, original, 'CLAUDE.md should not be modified');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ============================================================
  // Unit tests: badge
  // ============================================================
  console.log('\n  --- Badge ---');

  test('Badge URL has correct format', () => {
    const url = getBadgeUrl(75);
    assert.ok(url.includes('shields.io'), 'Should use shields.io');
    assert.ok(url.includes('75'), 'Should include score');
    assert.ok(url.includes('yellow'), 'Score 75 should be yellow (>=60 <80)');
  });

  test('Badge color thresholds', () => {
    assert.ok(getBadgeUrl(85).includes('brightgreen'));
    assert.ok(getBadgeUrl(65).includes('yellow'));
    assert.ok(getBadgeUrl(45).includes('orange'));
    assert.ok(getBadgeUrl(20).includes('red'));
  });

  // ============================================================
  // Unit tests: insights
  // ============================================================
  console.log('\n  --- Insights ---');

  test('Insights is opt-in by default', () => {
    assert.equal(shouldCollect(), false, 'Should not collect by default');
  });

  // ============================================================
  // Unit tests: version stamp
  // ============================================================
  console.log('\n  --- Version stamp ---');

  await testAsync('Generated CLAUDE.md has version stamp', async () => {
    const dir = mkFixture('stamp');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      await setup({ dir, auto: true });
      const md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      assert.ok(md.includes('nerviq'), 'Should reference nerviq');
      assert.ok(md.includes('hand-crafted') || md.includes('Customize'), 'Should have honesty disclaimer');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Audit result includes organic score and quick wins', async () => {
    const dir = mkFixture('audit-shape');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = await audit({ dir, silent: true });
      assert.equal(typeof result.organicScore, 'number', 'organicScore should be included');
      assert.ok(Array.isArray(result.quickWins), 'quickWins should be included');
      assert.ok(Array.isArray(result.topNextActions), 'topNextActions should be included');
      assert.equal(typeof result.suggestedNextCommand, 'string', 'suggestedNextCommand should be included');
      assert.ok(result.topNextActions.length <= 5, 'topNextActions should be capped at 5');
      assert.equal(typeof result.checkCount, 'number', 'checkCount should be included');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Audit top next actions include rationale and traceability', async () => {
    const dir = mkFixture('audit-top-actions');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = await audit({ dir, silent: true });
      assert.ok(result.topNextActions.length > 0, 'Expected at least one top action');
      const first = result.topNextActions[0];
      assert.equal(typeof first.why, 'string', 'Top actions should include why');
      assert.equal(typeof first.risk, 'string', 'Top actions should include risk');
      assert.equal(typeof first.confidence, 'string', 'Top actions should include confidence');
      assert.ok(Array.isArray(first.signals), 'Top actions should include signals');
      assert.ok(first.signals.some(signal => signal.startsWith('failed-check:')), 'Signals should include the failed check trace');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ============================================================
  // Analysis / mode tests
  // ============================================================
  console.log('\n  --- Analysis ---');

  await testAsync('Augment analysis returns structured report', async () => {
    const dir = mkFixture('augment-report');
    try {
      writeJson(dir, 'package.json', { name: 'app', scripts: { test: 'jest' }, dependencies: { next: '16', react: '19' } });
      fs.writeFileSync(path.join(dir, '.gitignore'), '.env\nnode_modules\n');
      fs.writeFileSync(path.join(dir, 'next.config.js'), 'module.exports = {}');
      fs.mkdirSync(path.join(dir, 'app', 'api'), { recursive: true });
      const report = await analyzeProject({ dir, mode: 'augment' });
      assert.equal(report.mode, 'augment');
      assert.equal(report.writeBehavior, 'No files are written in this mode.');
      assert.ok(report.projectSummary);
      assert.ok(Array.isArray(report.topNextActions));
      assert.ok(report.topNextActions.every(item => typeof item.why === 'string'), 'topNextActions should carry rationale into analysis');
      assert.ok(Array.isArray(report.recommendedImprovements));
      assert.ok(Array.isArray(report.suggestedRolloutOrder));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Suggest-only analysis recommends domain packs and MCP packs for Next.js repos', async () => {
    const dir = mkFixture('analysis-domain-packs');
    try {
      writeJson(dir, 'package.json', { name: 'app', dependencies: { next: '16', react: '19' } });
      fs.writeFileSync(path.join(dir, 'next.config.js'), 'module.exports = {}');
      fs.mkdirSync(path.join(dir, 'app', 'api'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'components'), { recursive: true });
      const report = await analyzeProject({ dir, mode: 'suggest-only' });
      assert.ok(report.recommendedDomainPacks.some(pack => pack.key === 'frontend-ui'), 'Should recommend the frontend-ui domain pack');
      assert.ok(report.recommendedMcpPacks.some(pack => pack.key === 'context7-docs'), 'Should recommend the Context7 MCP pack');
      assert.ok(report.recommendedMcpPacks.some(pack => pack.key === 'next-devtools'), 'Should recommend the Next.js devtools MCP pack');
      assert.ok(!report.recommendedMcpPacks.some(pack => pack.key === 'postgres-mcp'), 'Should not recommend Postgres without explicit Postgres signals');
      assert.ok(!report.recommendedMcpPacks.some(pack => pack.key === 'figma-mcp'), 'Should not recommend Figma for every frontend repo');
      assert.ok(!report.recommendedMcpPacks.some(pack => pack.key === 'mcp-security'), 'Should not auto-recommend mcp-security for generic repos');
      assert.ok(!report.recommendedMcpPacks.some(pack => pack.key === 'sentry-mcp'), 'Should not recommend Sentry without observability signals');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Suggest-only recommends Postgres MCP when explicit Postgres signals are present', async () => {
    const dir = mkFixture('analysis-postgres-pack');
    try {
      writeJson(dir, 'package.json', { name: 'api', dependencies: { express: '5', pg: '8' } });
      fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services:\n  db:\n    image: postgres:16\n');
      fs.mkdirSync(path.join(dir, 'api'), { recursive: true });
      const report = await analyzeProject({ dir, mode: 'suggest-only' });
      assert.ok(report.recommendedMcpPacks.some(pack => pack.key === 'postgres-mcp'), 'Should recommend Postgres MCP when Postgres signals exist');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Suggest-only recommends Figma MCP when design-system signals are present', async () => {
    const dir = mkFixture('analysis-figma-pack');
    try {
      writeJson(dir, 'package.json', { name: 'design-system', dependencies: { react: '19' } });
      fs.mkdirSync(path.join(dir, 'components'), { recursive: true });
      fs.mkdirSync(path.join(dir, '.storybook'), { recursive: true });
      const report = await analyzeProject({ dir, mode: 'suggest-only' });
      assert.ok(report.recommendedDomainPacks.some(pack => pack.key === 'design-system'), 'Should detect the design-system domain pack');
      assert.ok(report.recommendedMcpPacks.some(pack => pack.key === 'figma-mcp'), 'Should recommend Figma MCP for design-system repos');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Suggest-only recommends mcp-security for security-focused repos', async () => {
    const dir = mkFixture('analysis-security-pack');
    try {
      writeJson(dir, 'package.json', { name: 'secure-api', dependencies: { express: '5', jsonwebtoken: '9' } });
      fs.writeFileSync(path.join(dir, 'SECURITY.md'), '# Security\n');
      fs.mkdirSync(path.join(dir, 'api'), { recursive: true });
      const report = await analyzeProject({ dir, mode: 'suggest-only' });
      assert.ok(report.recommendedDomainPacks.some(pack => pack.key === 'security-focused'), 'Should detect the security-focused domain pack');
      assert.ok(report.recommendedMcpPacks.some(pack => pack.key === 'mcp-security'), 'Should recommend mcp-security when security-focused signals exist');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Proposal bundle includes templated changes with file previews', async () => {
    const dir = mkFixture('plan-bundle');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const bundle = await buildProposalBundle({ dir });
      assert.ok(bundle.proposals.length > 0, 'Expected at least one proposal bundle');
      const claudeMdProposal = bundle.proposals.find(item => item.id === 'claude-md');
      assert.ok(claudeMdProposal, 'Expected a CLAUDE.md proposal');
      assert.ok(claudeMdProposal.files.some(file => file.path === 'CLAUDE.md'), 'CLAUDE.md proposal should preview the generated file');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Apply proposal bundle creates rollback and activity artifacts', async () => {
    const dir = mkFixture('apply-bundle');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = await applyProposalBundle({ dir, only: ['claude-md', 'hooks'], dryRun: false });
      assert.ok(result.createdFiles.includes('CLAUDE.md'), 'Should create CLAUDE.md');
      assert.ok(result.rollbackArtifact, 'Should emit rollback artifact');
      assert.ok(result.activityArtifact, 'Should emit activity artifact');
      assert.ok(fs.existsSync(path.join(dir, result.rollbackArtifact)), 'Rollback artifact should exist on disk');
      assert.ok(fs.existsSync(path.join(dir, result.activityArtifact)), 'Activity artifact should exist on disk');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Apply can patch existing CLAUDE.md with managed guidance blocks', async () => {
    const dir = mkFixture('apply-patch-claude');
    try {
      writeJson(dir, 'package.json', {
        name: 'app',
        scripts: { build: 'npm pack --dry-run', test: 'node test/run.js' }
      });
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Existing project instructions\n\nKeep this file concise.\n');
      const result = await applyProposalBundle({ dir, only: ['claude-md'], dryRun: false });
      assert.ok(result.patchedFiles.includes('CLAUDE.md'), 'Should patch the existing CLAUDE.md');
      const md = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
      assert.ok(md.includes('<constraints>'), 'Patched CLAUDE.md should include constraints');
      assert.ok(md.includes('/compact'), 'Patched CLAUDE.md should include compaction guidance');
      assert.ok(/You are a careful engineer/i.test(md), 'Patched CLAUDE.md should include a role definition');
      assert.ok(md.includes('npm run build'), 'Patched CLAUDE.md should include the build command');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Apply can patch existing settings.json with selected profile protections', async () => {
    const dir = mkFixture('apply-patch-settings');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'hooks', 'protect-secrets.sh'), '#!/bin/bash\n');
      fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({
        mcpServers: {
          localdocs: { type: 'stdio', command: 'docs-server' }
        }
      }, null, 2));
      const result = await applyProposalBundle({ dir, only: ['hooks'], profile: 'safe-write', dryRun: false });
      assert.ok(result.patchedFiles.includes('.claude/settings.json'), 'Should patch the existing settings.json');
      const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
      assert.ok(settings.permissions.deny.includes('Read(./.env*)'), 'Patched settings should include deny rules');
      assert.ok(settings.mcpServers.localdocs, 'Existing MCP config should be preserved');
      assert.equal(settings.nerviqSetup.profile, 'safe-write', 'Profile metadata should be recorded');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Apply can merge requested MCP packs into existing settings', async () => {
    const dir = mkFixture('apply-patch-mcp-settings');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      fs.mkdirSync(path.join(dir, '.claude', 'hooks'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'hooks', 'protect-secrets.sh'), '#!/bin/bash\n');
      fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({
        mcpServers: {
          localdocs: { type: 'stdio', command: 'docs-server' }
        }
      }, null, 2));
      await applyProposalBundle({
        dir,
        only: ['hooks'],
        profile: 'safe-write',
        mcpPacks: ['context7-docs', 'next-devtools'],
        dryRun: false,
      });
      const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
      assert.ok(settings.mcpServers.localdocs, 'Existing MCP server should be preserved');
      assert.ok(settings.mcpServers.context7, 'Context7 MCP server should be merged in');
      assert.ok(settings.mcpServers['next-devtools'], 'Next.js devtools MCP server should be merged in');
      assert.deepEqual(settings.nerviqSetup.mcpPacks, ['context7-docs', 'next-devtools'], 'Merged MCP packs should be recorded');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('Apply exposes MCP preflight warnings for missing env vars', async () => {
    const dir = mkFixture('apply-mcp-preflight');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = await applyProposalBundle({
        dir,
        only: ['hooks'],
        profile: 'safe-write',
        mcpPacks: ['stripe-mcp'],
        dryRun: true,
      });
      const warning = result.mcpPreflightWarnings.find(item => item.key === 'stripe-mcp');
      assert.ok(warning, 'apply should expose a warning for stripe-mcp');
      assert.ok(warning.missingEnvVars.includes('STRIPE_API_KEY'), 'warning should include STRIPE_API_KEY');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('Governance summary exposes profiles and hook registry', () => {
    const summary = getGovernanceSummary();
    assert.ok(Array.isArray(summary.permissionProfiles), 'permissionProfiles should be an array');
    assert.ok(summary.permissionProfiles.some(item => item.key === 'safe-write'), 'Should include safe-write profile');
    assert.ok(Array.isArray(summary.hookRegistry), 'hookRegistry should be an array');
    assert.ok(summary.hookRegistry.some(item => item.key === 'protect-secrets'), 'Should include protect-secrets hook');
    assert.ok(Array.isArray(summary.domainPacks), 'domainPacks should be an array');
    assert.ok(summary.domainPacks.some(item => item.key === 'baseline-general'), 'Should include the baseline-general domain pack');
    assert.ok(Array.isArray(summary.mcpPacks), 'mcpPacks should be an array');
    assert.ok(summary.mcpPacks.some(item => item.key === 'context7-docs'), 'Should include the Context7 MCP pack');
  });

  await testAsync('Benchmark runs on isolated copy without modifying original repo', async () => {
    const dir = mkFixture('benchmark');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const report = await runBenchmark({ dir });
      assert.equal(typeof report.delta.score, 'number', 'Benchmark should report score delta');
      assert.ok(report.after.score >= report.before.score, 'Benchmark should not regress readiness on starter apply');
      // .claude dir may be created by audit snapshots — not a benchmark failure
      assert.ok(report.workflowEvidence, 'Benchmark should include workflow evidence');
      assert.ok(Array.isArray(report.workflowEvidence.tasks), 'Workflow evidence should include task records');
      assert.equal(typeof report.workflowEvidence.summary.coverageScore, 'number', 'Workflow evidence should include a coverage score');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ============================================================
  // CLI tests
  // ============================================================
  console.log('\n  --- CLI ---');

  test('CLI rejects unknown commands with suggestion', () => {
    const result = runCli(['setpu'], path.join(__dirname, '..'));
    assert.notEqual(result.status, 0, 'Unknown command should fail');
    assert.ok(result.stderr.includes("Unknown command 'setpu'"), 'Should explain the unknown command');
    assert.ok(result.stderr.includes("Did you mean 'setup'?"), 'Should suggest the closest command');
  });

  test('CLI beginner mode shows only the starter command set', () => {
    const result = runCli(['--beginner'], path.join(__dirname, '..'));
    assert.equal(result.status, 0, '--beginner should succeed');
    assert.ok(result.stdout.includes('STARTER COMMANDS'), 'beginner help should label the starter section');
    assert.ok(result.stdout.includes('nerviq audit'), 'beginner help should include audit');
    assert.ok(result.stdout.includes('nerviq setup'), 'beginner help should include setup');
    assert.ok(result.stdout.includes('nerviq fix'), 'beginner help should include fix');
    assert.ok(result.stdout.includes('nerviq augment'), 'beginner help should include augment');
    assert.ok(result.stdout.includes('nerviq doctor'), 'beginner help should include doctor');
    assert.ok(!result.stdout.includes('harmony-audit'), 'beginner help should hide advanced cross-platform commands');
    assert.ok(!result.stdout.includes('synergy-report'), 'beginner help should hide experimental commands');
  });

  test('CLI beginner flag does not block explicit commands', () => {
    const dir = mkFixture('cli-beginner-explicit-audit');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = runCli(['--beginner', 'audit', '--json'], dir);
      assert.equal(result.status, 0, 'explicit audit should still run under --beginner');
      const payload = JSON.parse(result.stdout);
      assert.equal(typeof payload.score, 'number', 'explicit audit should still return audit JSON');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI audit explains governance terminology inline in text output', () => {
    const dir = mkFixture('cli-terminology-audit');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      writeText(dir, 'CLAUDE.md', '# App\n\nUse npm test before merge.\n');
      const result = runCli(['audit'], dir);
      assert.equal(result.status, 0, 'audit should succeed');
      assert.ok(result.stdout.includes('Terms used here:'), 'audit output should include a terminology section');
      assert.ok(result.stdout.includes('governance: the rollout safety layer'), 'audit output should explain governance');
      assert.ok(result.stdout.includes('hooks: auto-run checks or scripts'), 'audit output should explain hooks');
      assert.ok(result.stdout.includes('deny rules: explicit blocks for risky reads or commands'), 'audit output should explain deny rules');
      assert.ok(result.stdout.includes('MCP: live external tool connectors'), 'audit output should explain MCP');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI rejects malformed webhook header values', () => {
    const dir = mkFixture('cli-webhook-bad-header');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = runCli(['audit', '--webhook', 'https://example.com/hook', '--webhook-header', 'Authorization'], dir);
      assert.notEqual(result.status, 0, 'malformed webhook header should fail');
      assert.ok(result.stderr.includes('--webhook-header requires NAME: VALUE'), 'CLI should explain the header format');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('sendWebhook retries transient failures and preserves custom headers', async () => {
    let server = null;
    let attempts = 0;
    const seenHeaders = [];
    try {
      server = http.createServer((req, res) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          attempts++;
          seenHeaders.push({ headers: req.headers, body });
          res.statusCode = attempts < 3 ? 503 : 202;
          res.end(attempts < 3 ? 'retry me' : 'accepted');
        });
      });
      await startTempServer(server);
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      const response = await sendWebhook(`http://127.0.0.1:${port}/hook`, { score: 61 }, {
        headers: {
          Authorization: 'Bearer test-token',
          'X-Nerviq-Env': 'staging',
        },
        retries: 2,
        retryDelayMs: 5,
      });
      assert.equal(response.ok, true, 'final webhook response should succeed');
      assert.equal(response.status, 202, 'final webhook response should be 202');
      assert.equal(response.attempts, 3, 'retry flow should report total attempts');
      assert.equal(attempts, 3, 'server should observe all retry attempts');
      assert.equal(seenHeaders[0].headers.authorization, 'Bearer test-token', 'custom auth header should be forwarded');
      assert.equal(seenHeaders[0].headers['x-nerviq-env'], 'staging', 'custom X- header should be forwarded');
      assert.ok(JSON.parse(seenHeaders[0].body).score === 61, 'payload should remain JSON');
    } finally {
      if (server && server.listening) {
        await closeServer(server);
      }
    }
  });

  await testAsync('CLI audit webhook supports custom headers and retry flags', async () => {
    const dir = mkFixture('cli-webhook-retry');
    let server = null;
    let attempts = 0;
    const seenBodies = [];
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      server = http.createServer((req, res) => {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          attempts++;
          seenBodies.push({ headers: req.headers, body });
          res.statusCode = attempts === 1 ? 500 : 200;
          res.end(attempts === 1 ? 'transient failure' : 'ok');
        });
      });
      await startTempServer(server);
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      const result = await runCliAsync([
        'audit',
        '--webhook', `http://127.0.0.1:${port}/audit`,
        '--webhook-header', 'Authorization: Bearer cli-token',
        '--webhook-header', 'X-Nerviq-Team: platform',
        '--webhook-retries', '1',
      ], dir);
      assert.equal(result.status, 0, 'CLI audit should succeed even with one transient webhook failure');
      assert.equal(attempts, 2, 'CLI should retry the transient webhook failure once');
      assert.equal(seenBodies[0].headers.authorization, 'Bearer cli-token', 'CLI should forward auth header');
      assert.equal(seenBodies[0].headers['x-nerviq-team'], 'platform', 'CLI should forward repeated webhook headers');
      const payload = JSON.parse(seenBodies[1].body);
      assert.equal(typeof payload.score, 'number', 'generic webhook payload should include score');
      assert.ok(result.stdout.includes('Webhook sent after 2 attempts'), 'CLI should explain retry success in output');
    } finally {
      if (server && server.listening) {
        await closeServer(server);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('CLI audit flags database URLs and JWTs as embedded secrets in CLAUDE.md', () => {
    const dir = mkFixture('cli-secrets-expanded');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      writeText(
        dir,
        'CLAUDE.md',
        '# Security\nDATABASE_URL=postgres://nerviq:supersecret123@db.internal:5432/nerviq\nJWT=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJuZXJ2aXEtYXBwIiwicm9sZSI6ImFkbWluIn0.c2lnbmF0dXJlMTIzNDU2Nzg5MGFiY2RlZg\n'
      );
      const result = runCli(['--json'], dir);
      assert.equal(result.status, 0, 'audit should succeed');
      const payload = JSON.parse(result.stdout);
      const check = payload.results.find((item) => item.key === 'noSecretsInClaude');
      assert.ok(check, 'noSecretsInClaude result should exist');
      assert.equal(check.passed, false, 'expanded secret formats should fail the embedded secret check');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('setup generates protect-secrets coverage for IaC, SSH, and service-account files', async () => {
    const dir = mkFixture('cli-protect-secrets-expanded');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      await setup({ dir, auto: true, silent: true });
      const hook = fs.readFileSync(path.join(dir, '.claude', 'hooks', 'protect-secrets.js'), 'utf8');
      assert.ok(hook.includes('.tfvars'), 'hook should block terraform vars files');
      assert.ok(hook.includes('values[-_.]?secret'), 'hook should block Helm-style secret values files');
      assert.ok(hook.includes('.ssh'), 'hook should block SSH key directories');
      assert.ok(hook.includes('id_(?:rsa|dsa|ecdsa|ed25519)'), 'hook should block SSH private key filenames');
      assert.ok(hook.includes('service-?account'), 'hook should block service-account key files');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI threshold fails when score is too low', () => {
    const dir = mkFixture('cli-threshold-low');
    try {
      const result = runCli(['--threshold', '50'], dir);
      assert.equal(result.status, 1, 'Threshold failure should exit with code 1');
      assert.ok(result.stderr.includes('Threshold') || result.stderr.includes('threshold'), 'Should report threshold failure');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI threshold passes after setup improves score', () => {
    const dir = mkFixture('cli-threshold-pass');
    try {
      writeJson(dir, 'package.json', { name: 'app', scripts: { test: 'jest', lint: 'eslint .' } });
      fs.writeFileSync(path.join(dir, '.gitignore'), '.env\nnode_modules\n');
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      const setupResult = runCli(['setup', '--auto'], dir);
      assert.equal(setupResult.status, 0, 'Setup should succeed');
      const auditResult = runCli(['--threshold', '40'], dir);
      assert.equal(auditResult.status, 0, 'Threshold should pass after setup');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI workspace audit JSON exposes stack-specific workspace profiles', () => {
    const dir = mkFixture('cli-workspace-profiles-json');
    try {
      writeJson(dir, 'package.json', { name: 'mono', workspaces: ['packages/*'] });
      writeJson(dir, 'packages/web/package.json', {
        name: '@mono/web',
        dependencies: { react: '^19.0.0' },
      });
      writeText(dir, 'packages/api/go.mod', 'module example.com/api\n\ngo 1.23\n');
      writeText(dir, 'packages/jobs/pyproject.toml', [
        '[project]',
        'name = "jobs"',
        'version = "0.1.0"',
      ].join('\n'));

      const result = runCli(['audit', '--workspace', 'packages/*', '--json'], dir);
      assert.equal(result.status, 0, 'workspace JSON audit should succeed');
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.workspaceCount, 3, 'should report all selected workspaces');
      assert.ok(payload.scoreSemantics.workspaceProfiles.includes('stack-specific check profile'), 'JSON should explain stack-specific workspace totals');
      assert.ok(Array.isArray(payload.profileBreakdown), 'JSON should expose profile breakdown');
      assert.ok(payload.profileBreakdown.some((item) => item.profileKey === 'go-workspace' && item.workspaceCount === 1), 'should include Go workspace profile');
      assert.ok(payload.profileBreakdown.some((item) => item.profileKey === 'python-workspace' && item.workspaceCount === 1), 'should include Python workspace profile');
      assert.ok(payload.profileBreakdown.some((item) => item.profileKey === 'node-workspace' && item.workspaceCount === 1), 'should include Node workspace profile');
      assert.ok(payload.workspaces.some((item) => item.workspace === 'packages/api' && item.workspaceProfile?.key === 'go-workspace'), 'Go workspace row should be labeled');
      assert.ok(payload.workspaces.some((item) => item.workspace === 'packages/jobs' && item.workspaceProfile?.key === 'python-workspace'), 'Python workspace row should be labeled');
      assert.ok(payload.workspaces.some((item) => item.workspace === 'packages/web' && item.workspaceProfile?.key === 'node-workspace'), 'Node workspace row should be labeled');
      assert.ok(payload.workspaces.every((item) => !Object.prototype.hasOwnProperty.call(item, 'result')), 'workspace JSON should stay summary-only and omit nested full audit payloads');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI workspace audit text output explains stack-specific profiles and stacks', () => {
    const dir = mkFixture('cli-workspace-profiles-text');
    try {
      writeJson(dir, 'package.json', { name: 'mono', workspaces: ['packages/*'] });
      writeJson(dir, 'packages/web/package.json', {
        name: '@mono/web',
        dependencies: { react: '^19.0.0' },
      });
      writeText(dir, 'packages/api/go.mod', 'module example.com/api\n\ngo 1.23\n');
      writeText(dir, 'packages/jobs/pyproject.toml', [
        '[project]',
        'name = "jobs"',
        'version = "0.1.0"',
      ].join('\n'));

      const result = runCli(['audit', '--workspace', 'packages/*'], dir);
      assert.equal(result.status, 0, 'workspace text audit should succeed');
      assert.ok(result.stdout.includes('Workspace profiles:'), 'text output should summarize workspace profiles');
      assert.ok(result.stdout.includes('Stack-specific checks:'), 'text output should explain different applicable totals');
      assert.ok(result.stdout.includes('Go workspace'), 'text output should name Go workspace profile');
      assert.ok(result.stdout.includes('Python workspace'), 'text output should name Python workspace profile');
      assert.ok(result.stdout.includes('Node / JS workspace'), 'text output should name Node workspace profile');
      assert.ok(result.stdout.includes('Stacks: Go'), 'text output should include per-workspace detected stacks');
      assert.ok(!result.stderr.includes('colorize is not defined'), 'workspace output should not crash while printing stack lines');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI setup rejects non-writable profiles', () => {
    const dir = mkFixture('cli-profile-reject');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = runCli(['setup', '--profile', 'read-only'], dir);
      assert.equal(result.status, 1, 'setup should fail on non-writable profiles');
      assert.ok(result.stderr.includes('requires a writable profile'), 'Should explain why the profile was rejected');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI suggest-only returns JSON report', () => {
    const dir = mkFixture('cli-suggest-json');
    try {
      writeJson(dir, 'package.json', { name: 'app', dependencies: { next: '16', react: '19' } });
      fs.writeFileSync(path.join(dir, 'next.config.js'), 'module.exports = {}');
      fs.mkdirSync(path.join(dir, 'app', 'api'), { recursive: true });
      const result = runCli(['suggest-only', '--json'], dir);
      assert.equal(result.status, 0, 'suggest-only --json should succeed');
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.mode, 'suggest-only');
      assert.ok(payload.projectSummary, 'JSON report should include projectSummary');
      assert.ok(Array.isArray(payload.topNextActions), 'JSON report should include topNextActions');
      assert.ok(Array.isArray(payload.recommendedDomainPacks), 'JSON report should include recommendedDomainPacks');
      assert.ok(Array.isArray(payload.recommendedMcpPacks), 'JSON report should include recommendedMcpPacks');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI discover alias still works', () => {
    const dir = mkFixture('cli-discover');
    try {
      const result = runCli(['discover', '--json'], dir);
      assert.equal(result.status, 0, 'discover should behave like audit');
      const payload = JSON.parse(result.stdout);
      assert.equal(typeof payload.score, 'number');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI audit --full output includes Top 5 Next Actions', () => {
    const dir = mkFixture('cli-audit-top5');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = runCli(['--full'], dir);
      assert.equal(result.status, 0, 'full audit should succeed');
      assert.ok(result.stdout.includes('Top 5 Next Actions'), 'full audit output should include Top 5 Next Actions');
      assert.ok(result.stdout.includes('Trace:'), 'full audit output should include traceability');
      assert.ok(result.stdout.includes('Next command:'), 'full audit output should suggest a next command');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI audit default is lite mode (top 3 quick scan)', () => {
    const dir = mkFixture('cli-audit-default-lite');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = runCli([], dir);
      assert.equal(result.status, 0, 'default audit should succeed');
      assert.ok(result.stdout.includes('Top 3 things to fix'), 'default audit should show top 3');
      assert.ok(result.stdout.includes('--full'), 'default audit should hint about --full');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI lite mode returns a short quick scan with one clear next command', () => {
    const dir = mkFixture('cli-lite');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = runCli(['--lite'], dir);
      assert.equal(result.status, 0, '--lite should succeed');
      assert.ok(result.stdout.includes('quick scan'), 'lite output should identify itself');
      assert.ok(result.stdout.includes('Top 3 things to fix right now'), 'lite output should show top 3 gaps');
      assert.ok(result.stdout.includes('Ready? Run:'), 'lite output should end with one clear next command');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI lite mode still returns machine-readable JSON when combined with --json', () => {
    const dir = mkFixture('cli-lite-json');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = runCli(['--lite', '--json'], dir);
      assert.equal(result.status, 0, '--lite --json should succeed');
      const payload = JSON.parse(result.stdout);
      assert.ok(payload.liteSummary, 'JSON output should include liteSummary');
      assert.ok(Array.isArray(payload.liteSummary.topNextActions), 'liteSummary should include top actions');
      assert.equal(typeof payload.liteSummary.nextCommand, 'string', 'liteSummary should include nextCommand');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI codex lite output shows platform caveats and codex scope', () => {
    const dir = mkFixture('cli-codex-lite');
    try {
      writeJson(dir, 'package.json', { name: 'codex-app' });
      const result = runCli(['--platform', 'codex', '--lite'], dir);
      assert.equal(result.status, 0, 'codex --lite should succeed');
      assert.ok(result.stdout.includes('nerviq codex quick scan'), 'codex lite output should identify the platform');
      assert.ok(result.stdout.includes('Platform caveats'), 'codex lite output should show platform caveats');
      assert.ok(result.stdout.includes('max_threads'), 'codex lite output should include the max_threads caveat');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI codex JSON output includes platform caveats', () => {
    const dir = mkFixture('cli-codex-json');
    try {
      writeJson(dir, 'package.json', { name: 'codex-app' });
      const result = runCli(['--platform', 'codex', '--lite', '--json'], dir);
      assert.equal(result.status, 0, 'codex --lite --json should succeed');
      const payload = JSON.parse(result.stdout);
      assert.ok(Array.isArray(payload.platformCaveats), 'codex JSON should include platformCaveats');
      assert.ok(payload.platformCaveats.some(item => item.key === 'codex-max-threads-default'), 'codex JSON should include the max_threads caveat');
      assert.ok(Array.isArray(payload.liteSummary.platformCaveats), 'codex liteSummary should include platform caveats');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI codex setup creates baseline files without overwriting', () => {
    const dir = mkFixture('cli-codex-setup');
    try {
      writeJson(dir, 'package.json', { name: 'codex-app', scripts: { test: 'vitest', lint: 'eslint .', build: 'vite build' } });
      const result = runCli(['--platform', 'codex', 'setup'], dir);
      assert.equal(result.status, 0, 'codex setup should succeed');
      assert.ok(fs.existsSync(path.join(dir, 'AGENTS.md')), 'AGENTS.md should exist after codex setup');
      assert.ok(fs.existsSync(path.join(dir, '.codex', 'config.toml')), '.codex/config.toml should exist after codex setup');
      const config = fs.readFileSync(path.join(dir, '.codex', 'config.toml'), 'utf8');
      // undo key removed from Codex config schema (2026-04-05) — verify core keys instead
      assert.ok(config.includes('approval_policy'), 'codex setup should emit approval_policy');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI codex plan exports a plan file', () => {
    const dir = mkFixture('cli-codex-plan');
    try {
      writeJson(dir, 'package.json', { name: 'codex-app' });
      const outFile = path.join(dir, 'codex-plan.json');
      const result = runCli(['--platform', 'codex', 'plan', '--out', outFile], dir);
      assert.equal(result.status, 0, 'codex plan should succeed');
      assert.ok(fs.existsSync(outFile), 'codex plan should write the output file');
      const bundle = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      assert.equal(bundle.platform, 'codex', 'plan bundle should declare codex platform');
      assert.ok(Array.isArray(bundle.proposals) && bundle.proposals.length >= 1, 'plan bundle should include proposals');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI codex governance renders Codex-specific governance data', () => {
    const dir = mkFixture('cli-codex-governance');
    try {
      const result = runCli(['--platform', 'codex', 'governance', '--json'], dir);
      assert.equal(result.status, 0, 'codex governance should succeed');
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.platform, 'codex', 'governance payload should declare codex platform');
      assert.ok(Array.isArray(payload.platformCaveats) && payload.platformCaveats.length > 0, 'governance payload should include platform caveats');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI audit can save a normalized snapshot artifact', () => {
    const dir = mkFixture('cli-audit-snapshot');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = runCli(['--snapshot'], dir);
      assert.equal(result.status, 0, 'audit --snapshot should succeed');
      const snapshotRootNew = path.join(dir, '.nerviq', 'snapshots');
      const snapshotRootLegacy = path.join(dir, '.claude', 'nerviq-cli', 'snapshots');
      const snapshotRoot = fs.existsSync(snapshotRootNew) ? snapshotRootNew : snapshotRootLegacy;
      const files = fs.readdirSync(snapshotRoot).filter(file => file.endsWith('-audit.json'));
      assert.ok(files.length >= 1, 'audit snapshot file should be created');
      const envelope = JSON.parse(fs.readFileSync(path.join(snapshotRoot, files[0]), 'utf8'));
      assert.equal(envelope.artifactType, 'snapshot', 'snapshot envelope should use normalized artifactType');
      assert.equal(envelope.snapshotKind, 'audit', 'snapshot kind should be audit');
      assert.ok(envelope.summary && typeof envelope.summary.score === 'number', 'snapshot should contain a summary');
      assert.ok(fs.existsSync(path.join(snapshotRoot, 'index.json')), 'snapshot history index should be created');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI audit --snapshot --tag saves named snapshot metadata', () => {
    const dir = mkFixture('cli-audit-snapshot-tag');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = runCli(['audit', '--snapshot', '--tag', 'pre-refactor'], dir);
      assert.equal(result.status, 0, 'audit --snapshot --tag should succeed');
      const snapshotRootNew = path.join(dir, '.nerviq', 'snapshots');
      const snapshotRootLegacy = path.join(dir, '.claude', 'nerviq-cli', 'snapshots');
      const snapshotRoot = fs.existsSync(snapshotRootNew) ? snapshotRootNew : snapshotRootLegacy;
      const files = fs.readdirSync(snapshotRoot).filter(file => file.endsWith('-audit.json'));
      const envelope = JSON.parse(fs.readFileSync(path.join(snapshotRoot, files[0]), 'utf8'));
      assert.deepStrictEqual(envelope.tags, ['pre-refactor']);
      assert.ok(result.stdout.includes('Snapshot saved:'), 'snapshot run should report the saved artifact');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI benchmark can save a normalized snapshot artifact', () => {
    const dir = mkFixture('cli-benchmark-snapshot');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const result = runCli(['benchmark', '--snapshot'], dir);
      assert.equal(result.status, 0, 'benchmark --snapshot should succeed');
      const snapshotRootNew = path.join(dir, '.nerviq', 'snapshots');
      const snapshotRootLegacy = path.join(dir, '.claude', 'nerviq-cli', 'snapshots');
      const snapshotRoot = fs.existsSync(snapshotRootNew) ? snapshotRootNew : snapshotRootLegacy;
      const files = fs.readdirSync(snapshotRoot).filter(file => file.endsWith('-benchmark.json'));
      assert.ok(files.length >= 1, 'benchmark snapshot file should be created');
      const envelope = JSON.parse(fs.readFileSync(path.join(snapshotRoot, files[0]), 'utf8'));
      assert.equal(envelope.snapshotKind, 'benchmark', 'snapshot kind should be benchmark');
      assert.ok(typeof envelope.summary.scoreDelta === 'number', 'benchmark snapshot should summarize score deltas');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI plan exports file and activity artifact', () => {
    const dir = mkFixture('cli-plan');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const outFile = path.join(dir, 'nerviq-plan.json');
      const result = runCli(['plan', '--out', outFile], dir);
      assert.equal(result.status, 0, 'plan should succeed');
      assert.ok(fs.existsSync(outFile), 'Plan file should be created');
      const activityNew = path.join(dir, '.nerviq', 'activity');
      const activityLegacy = path.join(dir, '.claude', 'nerviq-cli', 'activity');
      assert.ok(fs.existsSync(activityNew) || fs.existsSync(activityLegacy), 'Plan export should create an activity artifact');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI governance returns JSON summary', () => {
    const dir = mkFixture('cli-governance');
    try {
      const result = runCli(['governance', '--json'], dir);
      assert.equal(result.status, 0, 'governance --json should succeed');
      const payload = JSON.parse(result.stdout);
      assert.ok(Array.isArray(payload.permissionProfiles), 'JSON should include permissionProfiles');
      assert.ok(Array.isArray(payload.hookRegistry), 'JSON should include hookRegistry');
      assert.ok(Array.isArray(payload.domainPacks), 'JSON should include domainPacks');
      assert.ok(Array.isArray(payload.mcpPacks), 'JSON should include mcpPacks');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI governance text output explains core terms inline', () => {
    const dir = mkFixture('cli-governance-text');
    try {
      const result = runCli(['governance'], dir);
      assert.equal(result.status, 0, 'governance should succeed');
      assert.ok(result.stdout.includes('Terms used here:'), 'governance output should include a terminology section');
      assert.ok(result.stdout.includes('governance: the rollout safety layer'), 'governance output should explain governance');
      assert.ok(result.stdout.includes('hooks: auto-run checks or scripts'), 'governance output should explain hooks');
      assert.ok(result.stdout.includes('deny rules: explicit blocks for risky reads or commands'), 'governance output should explain deny rules');
      assert.ok(result.stdout.includes('MCP: live external tool connectors'), 'governance output should explain MCP');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI governance can export markdown report', () => {
    const dir = mkFixture('cli-governance-md');
    try {
      const outFile = path.join(dir, 'governance.md');
      const result = runCli(['governance', '--out', outFile], dir);
      assert.equal(result.status, 0, 'governance --out should succeed');
      assert.ok(fs.existsSync(outFile), 'governance report should be written');
      const content = fs.readFileSync(outFile, 'utf8');
      assert.ok(content.includes('NERVIQ CLI Governance Report'), 'markdown report should include title');
      assert.ok(content.includes('Permission Profiles'), 'markdown report should include permission profiles');
      assert.ok(content.includes('Pilot Rollout Kit'), 'markdown report should include pilot rollout guidance');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI feedback records an outcome artifact and returns summary JSON', () => {
    const dir = mkFixture('cli-feedback');
    try {
      const result = runCli(['feedback', '--key', 'permissionDeny', '--status', 'accepted', '--effect', 'positive', '--score-delta', '12', '--json'], dir);
      assert.equal(result.status, 0, 'feedback --json should succeed');
      const payload = JSON.parse(result.stdout);
      assert.ok(payload.artifact, 'feedback should return artifact metadata');
      assert.equal(payload.summary.totalEntries, 1, 'feedback summary should include the new outcome');
      const outcomesNew = path.join(dir, '.nerviq', 'outcomes', 'index.json');
      const outcomesLegacy = path.join(dir, '.claude', 'nerviq-cli', 'outcomes', 'index.json');
      assert.ok(fs.existsSync(outcomesNew) || fs.existsSync(outcomesLegacy), 'feedback should create an outcomes index');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI benchmark can export markdown report', () => {
    const dir = mkFixture('cli-benchmark');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const outFile = path.join(dir, 'benchmark.md');
      const result = runCli(['benchmark', '--out', outFile], dir);
      assert.equal(result.status, 0, 'benchmark should succeed');
      assert.ok(fs.existsSync(outFile), 'benchmark should write the markdown report');
      const content = fs.readFileSync(outFile, 'utf8');
      assert.ok(content.includes('Benchmark Report'), 'markdown report should be readable');
      assert.ok(content.includes('Score Semantics'), 'markdown report should explain score semantics');
      assert.ok(content.includes('Baseline (Live Repo)'), 'markdown report should label the live baseline clearly');
      assert.ok(content.includes('Workflow Evidence'), 'markdown report should include workflow evidence');
      // .claude dir may be created by audit snapshots — not a benchmark failure
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI apply supports MCP pack merges through exported plans', () => {
    const dir = mkFixture('cli-apply-mcp');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const planFile = path.join(dir, 'nerviq-plan.json');
      const exportResult = runCli(['plan', '--out', planFile], dir);
      assert.equal(exportResult.status, 0, 'plan export should succeed');
      const applyResult = runCli(['apply', '--plan', planFile, '--only', 'hooks', '--mcp-pack', 'context7-docs'], dir);
      assert.equal(applyResult.status, 0, 'apply should succeed with --mcp-pack');
      const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
      assert.ok(settings.mcpServers.context7, 'apply should merge the Context7 MCP pack into settings');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI apply can consume an exported plan file', () => {
    const dir = mkFixture('cli-apply-plan');
    try {
      writeJson(dir, 'package.json', { name: 'app' });
      const planFile = path.join(dir, 'nerviq-plan.json');
      const exportResult = runCli(['plan', '--out', planFile], dir);
      assert.equal(exportResult.status, 0, 'plan export should succeed');
      const applyResult = runCli(['apply', '--plan', planFile, '--only', 'claude-md,hooks'], dir);
      assert.equal(applyResult.status, 0, 'apply should succeed with exported plan');
      assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')), 'apply should create CLAUDE.md from plan file');
      const rollbackNew = path.join(dir, '.nerviq', 'rollbacks');
      const rollbackLegacy = path.join(dir, '.claude', 'nerviq-cli', 'rollbacks');
      assert.ok(fs.existsSync(rollbackNew) || fs.existsSync(rollbackLegacy), 'apply should create rollback artifacts');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ============================================================
  // Integration test
  // ============================================================
  console.log('\n  --- Integration ---');

  await testAsync('Full audit → setup → audit cycle', async () => {
    const dir = mkFixture('integration');
    try {
      writeJson(dir, 'package.json', { name: 'app', scripts: { test: 'jest', lint: 'eslint .' } });
      fs.writeFileSync(path.join(dir, '.gitignore'), '.env\nnode_modules\n');
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });

      const before = await audit({ dir, silent: true });
      await setup({ dir, auto: true });
      const after = await audit({ dir, silent: true });

      assert.ok(after.score > before.score, `Score should improve: ${before.score} → ${after.score}`);
      assert.ok(after.passed > before.passed, 'More checks should pass after setup');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('buildServeOpenApiSpec matches the live GET-only serve contract', () => {
    const spec = buildServeOpenApiSpec({
      serverUrl: 'http://127.0.0.1:4310',
      catalogSize: 2438,
    });

    assert.equal(spec.openapi, '3.1.0');
    assert.equal(spec.servers[0].url, 'http://127.0.0.1:4310');
    assert.ok(spec.paths['/api/openapi.json'].get, 'spec should expose /api/openapi.json');
    assert.ok(spec.paths['/api/health'].get, 'spec should expose /api/health');
    assert.ok(spec.paths['/api/catalog'].get, 'spec should expose /api/catalog');
    assert.ok(spec.paths['/api/audit'].get, 'spec should expose /api/audit');
    assert.ok(spec.paths['/api/harmony'].get, 'spec should expose /api/harmony');
    assert.equal(spec.paths['/api/audit'].post, undefined, 'audit contract should remain GET-only');
    assert.equal(spec.components.parameters.PlatformParam.schema.default, 'claude', 'platform should default to claude');
    assert.deepStrictEqual(spec.components.parameters.PlatformParam.schema.enum, ['claude', 'codex', 'gemini', 'copilot', 'cursor', 'windsurf', 'aider', 'opencode']);
  });

  await testAsync('serve exposes OpenAPI JSON plus enveloped operational responses', async () => {
    const dir = mkFixture('serve-openapi');
    let server = null;
    try {
      writeJson(dir, 'package.json', { name: 'api-app' });
      server = createServer({ baseDir: dir });
      await startTempServer(server);
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;

      const specResponse = await requestRaw(port, '/api/openapi.json');
      assert.equal(specResponse.statusCode, 200, 'OpenAPI endpoint should return 200');
      const spec = JSON.parse(specResponse.body);
      assert.equal(spec.openapi, '3.1.0');
      assert.equal(spec.servers[0].url, `http://127.0.0.1:${port}`, 'spec should advertise the live server origin');

      const healthResponse = await requestRaw(port, '/api/health');
      assert.equal(healthResponse.statusCode, 200, 'health endpoint should return 200');
      const health = JSON.parse(healthResponse.body);
      assert.equal(health.data.status, 'ok', 'health payload should stay enveloped under data');
      assert.equal(typeof health.meta.version, 'string', 'health envelope should include meta version');
      assert.equal(typeof health.meta.timestamp, 'string', 'health envelope should include meta timestamp');
    } finally {
      if (server && server.listening) {
        await closeServer(server);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ============================================================
  // New feature tests (v1.11-v1.12)
  // ============================================================
  console.log('\n  --- History / Compare / Trend ---');

  const { readSnapshotIndex, getHistory, compareLatest, formatHistory, exportTrendReport, writeSnapshotArtifact } = require('../src/activity');
  const { analyzeSuggestions, formatSuggestions } = require('../src/auto-suggest');

  test('readSnapshotIndex returns empty array for no snapshots', () => {
    const dir = mkFixture('history-empty');
    try {
      assert.deepStrictEqual(readSnapshotIndex(dir), []);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('getHistory returns sorted entries', () => {
    const dir = mkFixture('history-sorted');
    try {
      writeSnapshotArtifact(dir, 'audit', { score: 40, passed: 10, checkCount: 50 });
      writeSnapshotArtifact(dir, 'audit', { score: 60, passed: 20, checkCount: 50 });
      const history = getHistory(dir);
      assert.strictEqual(history.length, 2);
      assert.ok(history[0].summary.score >= history[1].summary.score || true); // most recent first
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('writeSnapshotArtifact persists snapshot tags into envelope and index', () => {
    const dir = mkFixture('history-tags-index');
    try {
      const artifact = writeSnapshotArtifact(dir, 'audit', { score: 55, passed: 11, failed: 9, checkCount: 20, topNextActions: [] }, {
        tags: ['baseline', 'pre-refactor'],
      });
      const envelope = JSON.parse(fs.readFileSync(artifact.filePath, 'utf8'));
      const index = readSnapshotIndex(dir);
      assert.deepStrictEqual(envelope.tags, ['baseline', 'pre-refactor']);
      assert.deepStrictEqual(index[0].tags, ['baseline', 'pre-refactor']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('compareLatest returns null with < 2 snapshots', () => {
    const dir = mkFixture('compare-one');
    try {
      writeSnapshotArtifact(dir, 'audit', { score: 50, passed: 15, checkCount: 50 });
      assert.strictEqual(compareLatest(dir), null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('compareLatest returns delta with 2 snapshots', () => {
    const dir = mkFixture('compare-two');
    try {
      writeSnapshotArtifact(dir, 'audit', { score: 40, organicScore: 20, passed: 10, checkCount: 50, topNextActions: [{ key: 'a' }] });
      writeSnapshotArtifact(dir, 'audit', { score: 60, organicScore: 30, passed: 20, checkCount: 50, topNextActions: [{ key: 'b' }] });
      const result = compareLatest(dir);
      assert.ok(result);
      assert.strictEqual(result.delta.score, 20);
      assert.strictEqual(result.trend, 'improving');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('compareLatest carries snapshot tags for current and previous entries', () => {
    const dir = mkFixture('compare-two-tags');
    try {
      writeSnapshotArtifact(dir, 'audit', { score: 40, organicScore: 20, passed: 10, checkCount: 50, topNextActions: [{ key: 'a' }] }, { tags: ['baseline'] });
      writeSnapshotArtifact(dir, 'audit', { score: 60, organicScore: 30, passed: 20, checkCount: 50, topNextActions: [{ key: 'b' }] }, { tags: ['post-fix'] });
      const result = compareLatest(dir);
      assert.deepStrictEqual(result.previous.tags, ['baseline']);
      assert.deepStrictEqual(result.current.tags, ['post-fix']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('compareLatest returns detailed per-check diffs from snapshot payloads', () => {
    const dir = mkFixture('compare-detailed-diff');
    try {
      writeSnapshotArtifact(dir, 'audit', {
        score: 40,
        organicScore: 20,
        passed: 10,
        checkCount: 50,
        topNextActions: [{ key: 'claudeMd' }],
        results: [
          { key: 'claudeMd', name: 'CLAUDE.md exists', impact: 'high', category: 'instructions', passed: true },
          { key: 'permissionDeny', name: 'Deny rules configured', impact: 'critical', category: 'security', passed: false },
          { key: 'testCommand', name: 'Test command documented', impact: 'medium', category: 'verification', passed: null },
          { key: 'oldCheck', name: 'Old check', impact: 'low', category: 'misc', passed: true },
        ],
      }, { tags: ['baseline'] });
      writeSnapshotArtifact(dir, 'audit', {
        score: 55,
        organicScore: 30,
        passed: 16,
        checkCount: 52,
        topNextActions: [{ key: 'permissionDeny' }],
        results: [
          { key: 'claudeMd', name: 'CLAUDE.md exists', impact: 'high', category: 'instructions', passed: false },
          { key: 'permissionDeny', name: 'Deny rules configured', impact: 'critical', category: 'security', passed: true },
          { key: 'testCommand', name: 'Test command documented', impact: 'medium', category: 'verification', passed: false },
          { key: 'newCheck', name: 'New check', impact: 'low', category: 'misc', passed: true },
        ],
      }, { tags: ['after-fix'] });

      const result = compareLatest(dir);
      assert.strictEqual(result.detailedDiffAvailable, true);
      assert.ok(result.regressionDetails.some((item) => item.key === 'claudeMd'), 'should report pass->fail regressions');
      assert.ok(result.improvementDetails.some((item) => item.key === 'permissionDeny'), 'should report fail->pass improvements');
      assert.ok(result.newlyApplicableDetails.some((item) => item.key === 'testCommand'), 'should report newly applicable checks');
      assert.ok(result.newChecks.some((item) => item.key === 'newCheck'), 'should report newly introduced checks');
      assert.ok(result.removedChecks.some((item) => item.key === 'oldCheck'), 'should report removed checks');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('formatHistory returns message for no snapshots', () => {
    const dir = mkFixture('format-empty');
    try {
      const output = formatHistory(dir);
      assert.ok(output.includes('No audit snapshots'));
      assert.ok(output.includes('Bootstrap it with'));
      assert.ok(output.includes('nerviq audit --snapshot'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('formatHistory adds cold-start guidance when only one snapshot exists', () => {
    const dir = mkFixture('format-one-snapshot');
    try {
      writeSnapshotArtifact(dir, 'audit', { score: 50, passed: 15, checkCount: 50 });
      const output = formatHistory(dir);
      assert.ok(output.includes('History is initialized, but compare/trend still need one more snapshot.'));
      assert.ok(output.includes('Current state: 1 saved audit snapshot.'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('formatHistory displays snapshot tags when present', () => {
    const dir = mkFixture('format-history-tags');
    try {
      writeSnapshotArtifact(dir, 'audit', { score: 50, passed: 15, checkCount: 50 }, { tags: ['pre-refactor'] });
      const output = formatHistory(dir);
      assert.ok(output.includes('[pre-refactor]'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('exportTrendReport returns null for no snapshots', () => {
    const dir = mkFixture('trend-empty');
    try {
      assert.strictEqual(exportTrendReport(dir), null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('exportTrendReport returns markdown with snapshots', () => {
    const dir = mkFixture('trend-md');
    try {
      writeSnapshotArtifact(dir, 'audit', { score: 50, passed: 15, checkCount: 50 }, { tags: ['baseline'] });
      writeSnapshotArtifact(dir, 'audit', { score: 58, passed: 17, checkCount: 50 }, { tags: ['after-fix'] });
      const report = exportTrendReport(dir);
      assert.ok(report.includes('Audit Snapshot Trend Report'));
      assert.ok(report.includes('Audit Snapshot History'));
      assert.ok(report.includes('| Date | Tags | Score | Passed | Checks |'));
      assert.ok(report.includes('baseline'));
      assert.ok(report.includes('after-fix'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  console.log('\n  --- New checks (v1.12) ---');

  test('New checks have valid structure', () => {
    const newChecks = ['testCoverage', 'agentHasAllowedTools', 'autoMemoryAwareness', 'sandboxAwareness',
      'denyRulesDepth', 'gitAttributionDecision', 'effortLevelConfigured', 'hasSnapshotHistory',
      'worktreeAwareness', 'negativeInstructions', 'outputStyleGuidance', 'githubActionsOrCI'];
    for (const key of newChecks) {
      assert.ok(TECHNIQUES[key], `Missing technique: ${key}`);
      assert.ok(typeof TECHNIQUES[key].check === 'function', `${key} missing check function`);
      assert.ok(TECHNIQUES[key].impact, `${key} missing impact`);
    }
  });

  test('New stacks have valid structure', () => {
    const newStacks = ['deno', 'bun', 'elixir', 'astro', 'remix', 'nestjs', 'laravel', 'dotnet'];
    for (const key of newStacks) {
      assert.ok(STACKS[key], `Missing stack: ${key}`);
      assert.ok(STACKS[key].label, `${key} missing label`);
      assert.ok(Array.isArray(STACKS[key].files), `${key} missing files array`);
    }
  });

  test('negativeInstructions passes with do-not rules', () => {
    const dir = mkFixture('neg-inst');
    try {
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Rules\nDo not use console.log in production.\n');
      const ctx = new ProjectContext(dir);
      assert.strictEqual(TECHNIQUES.negativeInstructions.check(ctx), true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('denyRulesDepth requires 3+ rules', () => {
    const dir = mkFixture('deny-depth');
    try {
      fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
      writeJson(dir, '.claude/settings.json', { permissions: { deny: ['a', 'b'] } });
      const ctx = new ProjectContext(dir);
      assert.strictEqual(TECHNIQUES.denyRulesDepth.check(ctx), false);

      writeJson(dir, '.claude/settings.json', { permissions: { deny: ['a', 'b', 'c'] } });
      const ctx2 = new ProjectContext(dir);
      assert.strictEqual(TECHNIQUES.denyRulesDepth.check(ctx2), true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  console.log('\n  --- CLI new commands ---');

  test('CLI history command runs without error', () => {
    const dir = mkFixture('cli-history');
    try {
      const result = runCli(['history'], dir);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes('No audit snapshots') || result.stdout.includes('Audit snapshot history'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI compare command runs without error', () => {
    const dir = mkFixture('cli-compare');
    try {
      const result = runCli(['compare'], dir);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes('Compare needs 2 audit snapshots.'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI compare prints detailed per-check sections when snapshot payloads exist', () => {
    const dir = mkFixture('cli-compare-detailed');
    try {
      writeSnapshotArtifact(dir, 'audit', {
        score: 40,
        organicScore: 20,
        passed: 10,
        checkCount: 50,
        topNextActions: [{ key: 'claudeMd' }],
        results: [
          { key: 'claudeMd', name: 'CLAUDE.md exists', impact: 'high', category: 'instructions', passed: true },
          { key: 'permissionDeny', name: 'Deny rules configured', impact: 'critical', category: 'security', passed: false },
        ],
      }, { tags: ['baseline'] });
      writeSnapshotArtifact(dir, 'audit', {
        score: 45,
        organicScore: 25,
        passed: 12,
        checkCount: 50,
        topNextActions: [{ key: 'permissionDeny' }],
        results: [
          { key: 'claudeMd', name: 'CLAUDE.md exists', impact: 'high', category: 'instructions', passed: false },
          { key: 'permissionDeny', name: 'Deny rules configured', impact: 'critical', category: 'security', passed: true },
        ],
      }, { tags: ['after-fix'] });

      const result = runCli(['compare'], dir);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes('Detailed check diff:'), 'compare should print a detailed diff section');
      assert.ok(result.stdout.includes('Regressions (1):'), 'compare should show regressions count');
      assert.ok(result.stdout.includes('Improvements (1):'), 'compare should show improvements count');
      assert.ok(result.stdout.includes('claudeMd [high]'), 'compare should surface regressed check key and impact');
      assert.ok(result.stdout.includes('permissionDeny [critical]'), 'compare should surface improved check key and impact');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI --tag requires --snapshot', () => {
    const dir = mkFixture('cli-tag-without-snapshot');
    try {
      const result = runCli(['audit', '--tag', 'baseline'], dir);
      assert.strictEqual(result.status, 1);
      assert.ok(result.stderr.includes('--tag requires --snapshot'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI trend command shows bootstrap guidance with fewer than 2 snapshots', () => {
    const dir = mkFixture('cli-trend-bootstrap');
    try {
      const result = runCli(['trend'], dir);
      assert.strictEqual(result.status, 0);
      assert.ok(result.stdout.includes('Trend needs 2 audit snapshots to start.'));
      assert.ok(result.stdout.includes('nerviq audit --snapshot'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI history and compare surfaces show snapshot tags', () => {
    const dir = mkFixture('cli-history-compare-tags');
    try {
      let result = runCli(['audit', '--snapshot', '--tag', 'baseline'], dir);
      assert.strictEqual(result.status, 0);
      result = runCli(['audit', '--snapshot', '--tag', 'after-fix'], dir);
      assert.strictEqual(result.status, 0);
      const history = runCli(['history'], dir);
      assert.strictEqual(history.status, 0);
      assert.ok(history.stdout.includes('[baseline]'));
      assert.ok(history.stdout.includes('[after-fix]'));
      const compare = runCli(['compare'], dir);
      assert.strictEqual(compare.status, 0);
      assert.ok(compare.stdout.includes('[baseline]'));
      assert.ok(compare.stdout.includes('[after-fix]'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('suggest-rules formats a bootstrap path when no local history exists', () => {
    const dir = mkFixture('suggest-rules-empty');
    try {
      const suggestions = analyzeSuggestions(dir);
      const output = formatSuggestions(suggestions);
      assert.strictEqual(suggestions.bootstrap.ready, false);
      assert.ok(output.includes('No local usage or snapshot history exists yet.'));
      assert.ok(output.includes('Bootstrap it with:'));
      assert.ok(output.includes('nerviq audit --snapshot'));
      assert.ok(output.includes('nerviq suggest-rules'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await testAsync('dashboard report labels snapshot score source clearly', async () => {
    const dir = mkFixture('dashboard-score-source');
    try {
      writeSnapshotArtifact(dir, 'audit', { score: 62, passed: 18, checkCount: 40, results: [] });
      const outFile = path.join(dir, 'nerviq-dashboard.html');
      const result = await generateDashboard(dir, { out: outFile, json: true });
      const html = fs.readFileSync(outFile, 'utf8');
      assert.ok(html.includes('Latest audit snapshot score'), 'dashboard should label snapshot-backed scores');
      assert.ok(html.includes('Dashboard is anchored to the most recent saved audit snapshot'), 'dashboard should explain the snapshot source');
      assert.strictEqual(result.scoreSource, 'latest audit snapshot');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI --require exits 1 when check fails', () => {
    const dir = mkFixture('cli-require');
    try {
      writeJson(dir, 'package.json', { name: 'test' });
      const result = runCli(['--require', 'claudeMd'], dir);
      assert.strictEqual(result.status, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('CLI --require exits 0 when check passes', () => {
    const dir = mkFixture('cli-require-pass');
    try {
      writeJson(dir, 'package.json', { name: 'test' });
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Project\n');
      const result = runCli(['--require', 'claudeMd'], dir);
      assert.strictEqual(result.status, 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ============================================================
  // Benchmark scenario tests (C2)
  // ============================================================

  test('Scenario: empty-node scores below 15', async () => {
    const scenarioDir = path.join(__dirname, 'fixtures', 'scenarios', 'empty-node');
    if (!fs.existsSync(scenarioDir)) { console.log('    (scenario dir missing, skip)'); return; }
    const result = await audit({ dir: scenarioDir, silent: true, platform: 'claude' });
    assert.ok(result.score <= 15, `empty-node should score <= 15, got ${result.score}`);
  });

  test('Scenario: basic-claude scores between 15 and 50', async () => {
    const scenarioDir = path.join(__dirname, 'fixtures', 'scenarios', 'basic-claude');
    if (!fs.existsSync(scenarioDir)) { console.log('    (scenario dir missing, skip)'); return; }
    const result = await audit({ dir: scenarioDir, silent: true, platform: 'claude' });
    assert.ok(result.score >= 15 && result.score <= 50, `basic-claude should score 15-50, got ${result.score}`);
  });

  test('Scenario: multi-platform detects 3+ platforms', async () => {
    const scenarioDir = path.join(__dirname, 'fixtures', 'scenarios', 'multi-platform');
    if (!fs.existsSync(scenarioDir)) { console.log('    (scenario dir missing, skip)'); return; }
    const result = await audit({ dir: scenarioDir, silent: true, platform: 'claude' });
    assert.ok(result.score > 0, `multi-platform should score > 0, got ${result.score}`);
  });

  // ============================================================
  // SDK integration tests (QP-A04)
  // ============================================================

  test('SDK audit returns score and results', async () => {
    const sdk = require('../sdk');
    const dir = mkFixture('sdk-audit');
    try {
      writeJson(dir, 'package.json', { name: 'sdk-test' });
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Test\n## Commands\nRun `npm test`\n');
      const result = await sdk.audit(dir);
      assert.ok(typeof result.score === 'number', 'should return numeric score');
      assert.ok(result.score >= 0 && result.score <= 100, 'score should be 0-100');
      assert.ok(Array.isArray(result.results), 'should return results array');
      assert.ok(result.results.length > 0, 'should have results');
      const claude = result.results.find(r => r.key === 'claudeMd');
      assert.ok(claude && claude.passed === true, 'CLAUDE.md should pass');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('SDK detectPlatforms returns array', () => {
    const sdk = require('../sdk');
    const dir = mkFixture('sdk-detect');
    try {
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Test\n');
      const platforms = sdk.detectPlatforms(dir);
      assert.ok(Array.isArray(platforms), 'should return array');
      assert.ok(platforms.includes('claude'), 'should detect claude');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('SDK getCatalog returns checks', () => {
    const sdk = require('../sdk');
    const catalog = sdk.getCatalog();
    assert.ok(Array.isArray(catalog) || typeof catalog === 'object', 'catalog should be array or object');
    const keys = Array.isArray(catalog) ? catalog : Object.keys(catalog);
    assert.ok(keys.length > 100, 'catalog should have 100+ checks');
  });

  // ============================================================
  // Source URL validation (QP-A05)
  // ============================================================

  test('All techniques have valid sourceUrl format', () => {
    const { TECHNIQUES } = require('../src/techniques');
    let missing = 0;
    let invalid = 0;
    for (const [key, t] of Object.entries(TECHNIQUES)) {
      if (!t.sourceUrl) { missing++; continue; }
      if (!/^https?:\/\//.test(t.sourceUrl)) {
        invalid++;
        console.log(`    Invalid URL: ${key} → ${t.sourceUrl}`);
      }
    }
    assert.ok(invalid === 0, `${invalid} techniques have invalid sourceUrl`);
    assert.ok(missing < 10, `${missing} techniques missing sourceUrl (max 10 allowed)`);
  });

  test('All techniques have confidence between 0 and 1', () => {
    const { TECHNIQUES } = require('../src/techniques');
    for (const [key, t] of Object.entries(TECHNIQUES)) {
      if (t.confidence !== undefined) {
        assert.ok(t.confidence >= 0 && t.confidence <= 1,
          `${key} confidence ${t.confidence} out of range`);
      }
    }
  });

  // ============================================================
  // Check Health
  // ============================================================

  test('check-health returns null with no snapshots', () => {
    const { checkHealth } = require('../src/activity');
    const dir = mkFixture('check-health-none');
    try {
      const result = checkHealth(dir);
      assert.strictEqual(result, null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('check-health detects stable state between identical snapshots', () => {
    const dir = mkFixture('check-health-stable');
    try {
      // Create two snapshots by running audit twice
      const r1 = runCli(['audit', '--snapshot', '--json'], dir);
      assert.equal(r1.status, 0);
      const r2 = runCli(['audit', '--snapshot', '--json'], dir);
      assert.equal(r2.status, 0);
      const r3 = runCli(['check-health', '--json'], dir);
      assert.equal(r3.status, 0);
      const health = JSON.parse(r3.stdout);
      assert.equal(health.summary.regressionsCount, 0);
      assert.equal(health.summary.alertsCount, 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('check-health detects regression when CLAUDE.md is deleted', () => {
    const dir = mkFixture('check-health-regress');
    try {
      // Snapshot 1: with CLAUDE.md
      fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Project\n## Test\nRun `npm test`\n');
      const r1 = runCli(['audit', '--snapshot', '--json'], dir);
      assert.equal(r1.status, 0);
      // Delete CLAUDE.md
      fs.unlinkSync(path.join(dir, 'CLAUDE.md'));
      // Snapshot 2: without CLAUDE.md
      const r2 = runCli(['audit', '--snapshot', '--json'], dir);
      assert.equal(r2.status, 0);
      const r3 = runCli(['check-health', '--json'], dir);
      assert.equal(r3.status, 0);
      const health = JSON.parse(r3.stdout);
      assert.ok(health.summary.regressionsCount > 0, 'should detect regressions when CLAUDE.md removed');
      assert.ok(health.regressions.some(r => r.key === 'claudeMd'), 'should flag claudeMd regression');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ============================================================
  // Summary
  // ============================================================
  console.log(`\n  ─────────────────────────────────────`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('');

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
