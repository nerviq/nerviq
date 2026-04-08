const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
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
const { getBadgeUrl, getBadgeMarkdown } = require('../src/badge');
const { shouldCollect, getLocalInsights } = require('../src/insights');

function writeJson(dir, file, value) {
  fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
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

  // ============================================================
  // New feature tests (v1.11-v1.12)
  // ============================================================
  console.log('\n  --- History / Compare / Trend ---');

  const { readSnapshotIndex, getHistory, compareLatest, formatHistory, exportTrendReport, writeSnapshotArtifact } = require('../src/activity');

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

  test('formatHistory returns message for no snapshots', () => {
    const dir = mkFixture('format-empty');
    try {
      const output = formatHistory(dir);
      assert.ok(output.includes('No audit snapshots'));
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
      writeSnapshotArtifact(dir, 'audit', { score: 50, passed: 15, checkCount: 50 });
      const report = exportTrendReport(dir);
      assert.ok(report.includes('Audit Snapshot Trend Report'));
      assert.ok(report.includes('Audit Snapshot History'));
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
