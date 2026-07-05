/**
 * Golden Matrix — verified expected results for 10 repo profiles.
 * Each profile is a synthetic repo with known config.
 * Expected results are VERIFIED by running the audit and confirming manually.
 * If a code change breaks an expected result, the test fails.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit } = require('../src/audit');
const { ProjectContext } = require('../src/context');
const { TECHNIQUES, STACKS } = require('../src/techniques');
const { detectDomainPacks, DOMAIN_PACKS } = require('../src/domain-packs');
const { recommendMcpPacks } = require('../src/mcp-packs');

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

function mkDir(base, ...parts) {
  const dir = path.join(base, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(base, filePath, content) {
  const full = path.join(base, filePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

// ============================================================
// Profile builders
// ============================================================

function buildEmptyRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-empty-'));
  writeFile(dir, 'package.json', { name: 'empty' });
  return dir;
}

function buildMinimalClaudeMd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-minimal-'));
  writeFile(dir, 'package.json', { name: 'minimal', scripts: { test: 'jest' } });
  writeFile(dir, 'CLAUDE.md', '# My Project\nThis is a simple project.\nDo not use console.log.\n');
  writeFile(dir, '.gitignore', '.env\nnode_modules\n');
  return dir;
}

function buildFullNextJs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-nextjs-'));
  writeFile(dir, 'package.json', { name: 'next-app', dependencies: { react: '18', next: '14' }, devDependencies: { typescript: '5', eslint: '8' }, scripts: { test: 'jest', lint: 'eslint .', build: 'next build', dev: 'next dev' } });
  writeFile(dir, 'tsconfig.json', { compilerOptions: { strict: true } });
  writeFile(dir, 'next.config.js', 'module.exports = {}');
  writeFile(dir, '.gitignore', '.env\nnode_modules\n.claude/settings.local.json\n');
  writeFile(dir, 'CLAUDE.md', '# Next App\n## Overview\nThis project is a web app.\n## Structure\nFiles in src/app/ are routes.\nDo not modify generated files.\n## Verification\n- Test: `npm test`\n- Lint: `npm run lint`\n- Build: `npm run build`\n\n```mermaid\ngraph TD\n  App --> Pages\n  Pages --> Components\n```\n');
  mkDir(dir, 'src', 'app');
  mkDir(dir, 'src', 'components');
  mkDir(dir, '.claude', 'commands');
  mkDir(dir, '.claude', 'rules');
  mkDir(dir, '.claude', 'agents');
  mkDir(dir, '.claude', 'skills', 'fix-issue');
  writeFile(dir, '.claude/commands/test.md', 'Run tests\n$ARGUMENTS');
  writeFile(dir, '.claude/commands/review.md', 'Review code\n$ARGUMENTS');
  writeFile(dir, '.claude/commands/deploy.md', 'Deploy\n$ARGUMENTS');
  writeFile(dir, '.claude/rules/frontend.md', 'Use TypeScript strict mode');
  writeFile(dir, '.claude/rules/tests.md', 'Write tests for new features');
  writeFile(dir, '.claude/agents/security-reviewer.md', '---\nname: security-reviewer\ntools: [Read, Grep]\nmaxTurns: 10\n---\nReview for security issues');
  writeFile(dir, '.claude/agents/test-writer.md', '---\nname: test-writer\ntools: [Read, Write]\nmaxTurns: 15\n---\nWrite tests');
  writeFile(dir, '.claude/skills/fix-issue/SKILL.md', '---\nname: fix-issue\n---\nFix the issue');
  writeFile(dir, '.claude/settings.json', { "$schema": "https://json.schemastore.org/claude-code-settings.json", permissions: { defaultMode: 'acceptEdits', deny: ['Bash(rm -rf *)', 'Bash(git push --force *)', 'Read(.env)', 'Read(.env.*)'] }, hooks: { PostToolUse: [{ matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'echo {}', timeout: 5 }] }], SessionStart: [{ hooks: [{ type: 'command', command: 'echo {}' }] }] } });
  writeFile(dir, '.mcp.json', { mcpServers: { context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp@latest'] }, thinking: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] } } });
  mkDir(dir, '.github', 'workflows');
  writeFile(dir, '.github/workflows/ci.yml', 'name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest');
  writeFile(dir, 'README.md', '# Next App');
  return dir;
}

function buildPythonBackend() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-python-'));
  writeFile(dir, 'requirements.txt', 'fastapi\nuvicorn\nsqlalchemy\npg8000\n');
  writeFile(dir, 'pyproject.toml', '[project]\nname = "api"\n');
  writeFile(dir, '.gitignore', '.env\n__pycache__\n.claude/settings.local.json\n');
  writeFile(dir, 'CLAUDE.md', '# API Service\n## Overview\nBackend API service.\n## Structure\nsrc/routes/ has API endpoints.\nDo not hardcode secrets.\n## Verification\n- Test: `pytest tests/`\n- Lint: `ruff check .`\n- Security: use /security-review\n');
  mkDir(dir, 'src', 'routes');
  mkDir(dir, 'src', 'models');
  mkDir(dir, 'migrations');
  mkDir(dir, '.claude', 'commands');
  writeFile(dir, '.claude/commands/test.md', 'Run pytest\n$ARGUMENTS');
  writeFile(dir, '.claude/commands/review.md', 'Review\n$ARGUMENTS');
  writeFile(dir, '.claude/settings.json', { permissions: { defaultMode: 'acceptEdits', deny: ['Bash(rm -rf *)', 'Read(.env)', 'Read(.env.*)'] } });
  writeFile(dir, 'Dockerfile', 'FROM python:3.11');
  writeFile(dir, 'docker-compose.yml', 'version: "3"');
  writeFile(dir, 'README.md', '# API');
  return dir;
}

function buildMonorepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-monorepo-'));
  writeFile(dir, 'package.json', { name: 'monorepo', workspaces: ['packages/*'], scripts: { test: 'turbo test' } });
  writeFile(dir, 'turbo.json', { pipeline: { build: {} } });
  writeFile(dir, '.gitignore', '.env\nnode_modules\n');
  writeFile(dir, 'CLAUDE.md', '# Monorepo\n## Overview\nTurborepo workspace.\nAvoid cross-package imports.\n');
  mkDir(dir, 'packages', 'ui');
  mkDir(dir, 'packages', 'api');
  return dir;
}

function buildMobileApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-mobile-'));
  writeFile(dir, 'package.json', { name: 'app', dependencies: { 'react-native': '0.73', expo: '50' }, scripts: { test: 'jest', start: 'expo start' } });
  writeFile(dir, '.gitignore', '.env\nnode_modules\n');
  writeFile(dir, 'CLAUDE.md', '# Mobile App\nReact Native with Expo.\nNever modify native code directly.\n');
  mkDir(dir, 'ios');
  mkDir(dir, 'android');
  mkDir(dir, 'src', 'components');
  return dir;
}

function buildDenoProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-deno-'));
  writeFile(dir, 'deno.json', { tasks: { dev: 'deno run --watch main.ts' } });
  writeFile(dir, 'CLAUDE.md', '# Deno Project\nUse Deno conventions.\nDo not use npm packages directly.\n');
  writeFile(dir, '.gitignore', '.env\n');
  return dir;
}

function buildEcommerce() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-ecom-'));
  writeFile(dir, 'package.json', { name: 'store', dependencies: { react: '18', next: '14', stripe: '14', '@stripe/stripe-js': '2' }, scripts: { test: 'jest', build: 'next build' } });
  writeFile(dir, '.gitignore', '.env\nnode_modules\n');
  writeFile(dir, 'CLAUDE.md', '# E-Commerce\n## Overview\nOnline store with Stripe payments.\nNever log payment data.\n');
  mkDir(dir, 'src', 'checkout');
  mkDir(dir, 'src', 'products');
  return dir;
}

function buildAiMl() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-aiml-'));
  writeFile(dir, 'requirements.txt', 'langchain\nopenai\nchromadb\n');
  writeFile(dir, 'pyproject.toml', '[project]\nname = "agent"\n');
  writeFile(dir, '.gitignore', '.env\n__pycache__\n');
  writeFile(dir, 'CLAUDE.md', '# AI Agent\n## Overview\nLangChain RAG pipeline.\nDo not hardcode API keys.\n');
  mkDir(dir, 'chains');
  mkDir(dir, 'agents');
  return dir;
}

function buildRegulated() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gm-regulated-'));
  writeFile(dir, 'package.json', { name: 'fintech-api', dependencies: { express: '4', jsonwebtoken: '9', bcrypt: '5' }, scripts: { test: 'jest' } });
  writeFile(dir, '.gitignore', '.env\nnode_modules\n');
  writeFile(dir, 'SECURITY.md', '# Security Policy\nReport vulnerabilities to security@example.com');
  writeFile(dir, 'CLAUDE.md', '# Fintech API\n## Overview\nPayment processing service.\nNever log PII. Never store unencrypted tokens.\n');
  mkDir(dir, 'src', 'services');
  return dir;
}

// ============================================================
// Golden Matrix Tests
// ============================================================

async function main() {
  console.log('\n  Golden Matrix — Verified Expected Results\n');

  // 1. Empty repo
  await testAsync('P1: Empty repo scores < 15', async () => {
    const dir = buildEmptyRepo();
    try {
      const r = await audit({ dir, silent: true });
      assert.ok(r.score < 15, `Empty repo score ${r.score} should be < 15`);
      assert.ok(r.passed < 5, `Empty repo passed ${r.passed} should be < 5`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // 2. Minimal CLAUDE.md
  await testAsync('P2: Minimal CLAUDE.md scores 15-35', async () => {
    const dir = buildMinimalClaudeMd();
    try {
      const r = await audit({ dir, silent: true });
      assert.ok(r.score >= 15 && r.score <= 35, `Minimal score ${r.score} should be 15-35`);
      const claudeMd = r.results.find(x => x.key === 'claudeMd');
      assert.ok(claudeMd.passed, 'claudeMd should pass');
      const negInst = r.results.find(x => x.key === 'negativeInstructions');
      assert.ok(negInst.passed, 'negativeInstructions should pass (has "Do not")');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // 3. Full Next.js
  await testAsync('P3: Full Next.js scores 55+ and passes critical checks', async () => {
    const dir = buildFullNextJs();
    try {
      const r = await audit({ dir, silent: true });
      assert.ok(r.score >= 55, `Full Next.js score ${r.score} should be >= 55`);
      // Verify specific checks
      const checks = {};
      r.results.forEach(x => checks[x.key] = x.passed);
      assert.ok(checks.claudeMd, 'claudeMd');
      assert.ok(checks.mermaidArchitecture, 'mermaid');
      assert.ok(checks.testCommand, 'testCommand');
      assert.ok(checks.lintCommand, 'lintCommand');
      assert.ok(checks.buildCommand, 'buildCommand');
      assert.ok(checks.customCommands, 'customCommands');
      assert.ok(checks.multipleCommands, 'multipleCommands');
      assert.ok(checks.agents, 'agents');
      assert.ok(checks.multipleAgents, 'multipleAgents');
      assert.ok(checks.skills, 'skills');
      assert.ok(checks.settingsPermissions, 'settingsPermissions');
      assert.ok(checks.noBypassPermissions, 'noBypassPermissions');
      assert.ok(checks.secretsProtection, 'secretsProtection');
      assert.ok(checks.postToolUseHook, 'postToolUseHook');
      assert.ok(checks.sessionStartHook, 'sessionStartHook');
      assert.ok(checks.multipleMcpServers, 'multipleMcpServers');
      // ciPipeline/githubActionsOrCI live in the 'devops' category, which is
      // N/A (null) on default audits since 4d78644 ("add devops to generic
      // quality categories, skip by default") — they only run with --verbose.
      // Assert them on a verbose audit so the golden expectation matches the
      // shipped applicability model.
      const rv = await audit({ dir, silent: true, verbose: true });
      const verboseChecks = {};
      rv.results.forEach(x => verboseChecks[x.key] = x.passed);
      assert.ok(verboseChecks.ciPipeline || verboseChecks.githubActionsOrCI, 'CI');
      assert.ok(checks.denyRulesDepth, 'denyRulesDepth');
      assert.ok(checks.negativeInstructions, 'negativeInstructions');
      assert.ok(checks.projectDescriptionInClaudeMd, 'projectDescription');
      assert.ok(checks.directoryStructureInClaudeMd, 'directoryStructure');
      assert.ok(checks.gitIgnoreClaudeLocal, 'gitIgnoreClaudeLocal');
      // Verify stacks
      assert.ok(r.stacks.some(s => s.label === 'React'), 'React detected');
      assert.ok(r.stacks.some(s => s.label === 'Next.js'), 'Next.js detected');
      assert.ok(r.stacks.some(s => s.label === 'TypeScript'), 'TypeScript detected');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // 4. Python backend
  await testAsync('P4: Python backend detects correct stacks + domain', async () => {
    const dir = buildPythonBackend();
    try {
      const r = await audit({ dir, silent: true });
      assert.ok(r.score >= 30 && r.score <= 65, `Python score ${r.score} should be 30-65`);
      assert.ok(r.stacks.some(s => s.label === 'Python'), 'Python detected');
      assert.ok(r.stacks.some(s => s.label === 'FastAPI'), 'FastAPI detected');
      assert.ok(r.stacks.some(s => s.label === 'Docker'), 'Docker detected');
      const checks = {};
      r.results.forEach(x => checks[x.key] = x.passed);
      assert.ok(checks.testCommand, 'pytest should be detected');
      assert.ok(checks.lintCommand, 'ruff should be detected');
      // dockerfile is a 'devops' check — N/A on default audits since 4d78644;
      // assert it on a verbose audit (see P3 note).
      const rv = await audit({ dir, silent: true, verbose: true });
      const verboseChecks = {};
      rv.results.forEach(x => verboseChecks[x.key] = x.passed);
      assert.ok(verboseChecks.dockerfile, 'Dockerfile should pass');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // 5. Monorepo
  await testAsync('P5: Monorepo detects monorepo domain pack', async () => {
    const dir = buildMonorepo();
    try {
      const ctx = new ProjectContext(dir);
      const stacks = ctx.detectStacks(STACKS);
      const packs = detectDomainPacks(ctx, stacks);
      assert.ok(packs.some(p => p.key === 'monorepo'), 'monorepo pack should be detected');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // 6. Mobile
  await testAsync('P6: Mobile app detects mobile domain pack', async () => {
    const dir = buildMobileApp();
    try {
      const ctx = new ProjectContext(dir);
      const stacks = ctx.detectStacks(STACKS);
      const packs = detectDomainPacks(ctx, stacks);
      assert.ok(packs.some(p => p.key === 'mobile'), 'mobile pack should be detected');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // 7. Deno
  await testAsync('P7: Deno project detects Deno stack', async () => {
    const dir = buildDenoProject();
    try {
      const r = await audit({ dir, silent: true });
      assert.ok(r.stacks.some(s => s.label === 'Deno'), 'Deno should be detected');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // 8. E-commerce
  await testAsync('P8: E-commerce detects ecommerce domain pack', async () => {
    const dir = buildEcommerce();
    try {
      const ctx = new ProjectContext(dir);
      const stacks = ctx.detectStacks(STACKS);
      const packs = detectDomainPacks(ctx, stacks);
      assert.ok(packs.some(p => p.key === 'ecommerce'), 'ecommerce pack should be detected');
      // Stripe MCP should be recommended for ecommerce
      const mcps = recommendMcpPacks(stacks, packs);
      assert.ok(mcps.some(m => m.key === 'stripe-mcp'), 'stripe-mcp should be recommended');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // 9. AI/ML
  await testAsync('P9: AI/ML detects ai-ml domain pack', async () => {
    const dir = buildAiMl();
    try {
      const ctx = new ProjectContext(dir);
      const stacks = ctx.detectStacks(STACKS);
      const packs = detectDomainPacks(ctx, stacks);
      assert.ok(packs.some(p => p.key === 'ai-ml'), 'ai-ml pack should be detected');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // 10. Regulated
  await testAsync('P10: Regulated repo detects security-focused or regulated-lite', async () => {
    const dir = buildRegulated();
    try {
      const ctx = new ProjectContext(dir);
      const stacks = ctx.detectStacks(STACKS);
      const packs = detectDomainPacks(ctx, stacks);
      const hasSecOrReg = packs.some(p => p.key === 'security-focused' || p.key === 'regulated-lite');
      assert.ok(hasSecOrReg, 'security-focused or regulated-lite pack should be detected');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // 11. False positive check: empty repo should NOT get high-impact checks passing
  await testAsync('P11: Empty repo does not false-positive on security checks', async () => {
    const dir = buildEmptyRepo();
    try {
      const r = await audit({ dir, silent: true });
      const checks = {};
      r.results.forEach(x => checks[x.key] = x.passed);
      assert.ok(!checks.secretsProtection, 'secretsProtection should NOT pass on empty repo');
      assert.ok(!checks.permissionDeny, 'permissionDeny should NOT pass on empty repo');
      assert.ok(!checks.hooks, 'hooks should NOT pass on empty repo');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // 12. Score monotonicity: adding config should never decrease score
  await testAsync('P12: Adding CLAUDE.md to empty repo increases score', async () => {
    const dir = buildEmptyRepo();
    try {
      const before = await audit({ dir, silent: true });
      writeFile(dir, 'CLAUDE.md', '# Project\nOverview of the project.\nDo not delete files without asking.\n');
      const after = await audit({ dir, silent: true });
      assert.ok(after.score > before.score, `Score should increase: ${before.score} → ${after.score}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // Summary
  console.log(`\n  ─────────────────────────────────────`);
  console.log(`  Golden Matrix: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
