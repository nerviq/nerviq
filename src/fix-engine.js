const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const { ProjectContext } = require('./context');
const { TECHNIQUES, STACKS } = require('./techniques');
const { TEMPLATES, setup } = require('./setup');
const { detectProjectMetadata, detectScripts } = require('./setup/analysis');
const { writeRollbackArtifact } = require('./activity');
const { recordPattern } = require('./usage-patterns');
const { audit } = require('./audit');
const {
  hasDocumentedVerificationGuidance,
  hasDocumentedTestCommand,
  hasDocumentedLintCommand,
  hasDocumentedBuildCommand,
} = require('./instruction-surfaces');

const IMPACT_ORDER = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

const CUSTOM_FIXER_KEYS = new Set([
  'claudeMd',
  'verificationLoop',
  'testCommand',
  'lintCommand',
  'buildCommand',
  'license',
  'changelog',
  'contributing',
  'gitIgnoreEnv',
  'gitIgnoreClaudeLocal',
  'gitignoreClaudeLocal',
  'secretsProtection',
  'editorconfig',
]);

const AUDIT_FIX_KEYS = new Set([
  'claudeMd',
  'verificationLoop',
  'testCommand',
  'lintCommand',
  'buildCommand',
  'license',
  'changelog',
  'contributing',
  'gitIgnoreEnv',
  'gitIgnoreClaudeLocal',
  'gitignoreClaudeLocal',
  'secretsProtection',
  'editorconfig',
]);

const INSTRUCTION_KEYS = new Set([
  'claudeMd',
  'verificationLoop',
  'testCommand',
  'lintCommand',
  'buildCommand',
]);

const QUALITY_COMMAND_KEYS = new Set([
  'verificationLoop',
  'testCommand',
  'lintCommand',
  'buildCommand',
]);

const AUDIT_FIX_ALLOWED_PATHS = new Set([
  '.claude/CLAUDE.md',
  '.claude/settings.json',
  '.editorconfig',
  '.gitignore',
  '.codex/AGENTS.md',
  'AGENTS.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'LICENSE',
]);

const GITIGNORE_ENTRIES_BY_KEY = {
  gitIgnoreEnv: ['.env', '.env.*'],
  gitIgnoreClaudeLocal: ['.claude/settings.local.json'],
  gitignoreClaudeLocal: ['CLAUDE.local.md'],
};

function normalizeNewlines(content) {
  return String(content || '').replace(/\r\n/g, '\n');
}

function ensureTrailingNewline(content) {
  const normalized = normalizeNewlines(content);
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

function normalizeForCompare(content) {
  return ensureTrailingNewline(content || '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sortFailedResults(a, b) {
  const impactDiff = (IMPACT_ORDER[b.impact] || 0) - (IMPACT_ORDER[a.impact] || 0);
  if (impactDiff !== 0) return impactDiff;
  return String(a.key || '').localeCompare(String(b.key || ''));
}

function highestImpact(keys, failedByKey) {
  const impacts = keys.map((key) => (failedByKey.get(key) || TECHNIQUES[key] || {}).impact);
  return impacts.sort((a, b) => (IMPACT_ORDER[b] || 0) - (IMPACT_ORDER[a] || 0))[0] || 'medium';
}

function isFixableKey(key, { mode = 'fix' } = {}) {
  if (mode === 'audit') {
    return AUDIT_FIX_KEYS.has(key);
  }
  return Boolean(TECHNIQUES[key] && TECHNIQUES[key].template) || CUSTOM_FIXER_KEYS.has(key);
}

function getFixableFailedResults(failedResults, { mode = 'fix', criticalOnly = false } = {}) {
  return [...(failedResults || [])]
    .filter((item) => item && item.passed === false)
    .filter((item) => isFixableKey(item.key, { mode }))
    .filter((item) => !criticalOnly || item.impact === 'critical')
    .sort(sortFailedResults);
}

function resolveInstructionPath(ctx, platform = 'claude') {
  if (platform === 'codex') {
    if (ctx.fileContent('AGENTS.md') !== null) return 'AGENTS.md';
    if (ctx.fileContent('.codex/AGENTS.md') !== null) return '.codex/AGENTS.md';
    return 'AGENTS.md';
  }

  if (ctx.fileContent('CLAUDE.md') !== null) return 'CLAUDE.md';
  if (ctx.fileContent('.claude/CLAUDE.md') !== null) return '.claude/CLAUDE.md';
  if (ctx.fileContent('AGENTS.md') !== null) return 'AGENTS.md';
  return 'CLAUDE.md';
}

function stackKeys(stacks) {
  return new Set((stacks || []).map((item) => item.key));
}

function getVerificationCommands(ctx, stacks) {
  const scripts = detectScripts(ctx);
  const detected = stackKeys(stacks);

  if (scripts.test || scripts.lint || scripts.build) {
    return {
      test: scripts.test ? 'npm test' : 'npm test',
      lint: scripts.lint ? 'npm run lint' : 'npm run lint',
      build: scripts.build ? 'npm run build' : 'npm run build',
    };
  }

  if (detected.has('python') || detected.has('django') || detected.has('fastapi')) {
    return {
      test: 'python -m pytest',
      lint: 'ruff check .',
      build: 'python -m build',
    };
  }

  if (detected.has('go')) {
    return {
      test: 'go test ./...',
      lint: 'go vet ./...',
      build: 'go build ./...',
    };
  }

  if (detected.has('rust')) {
    return {
      test: 'cargo test',
      lint: 'cargo clippy --all-targets --all-features',
      build: 'cargo build',
    };
  }

  if (detected.has('dotnet')) {
    return {
      test: 'dotnet test',
      lint: 'dotnet format --verify-no-changes',
      build: 'dotnet build',
    };
  }

  if (detected.has('java') || detected.has('kotlin')) {
    return {
      test: './gradlew test',
      lint: './gradlew check',
      build: './gradlew build',
    };
  }

  if (detected.has('flutter')) {
    return {
      test: 'flutter test',
      lint: 'flutter analyze',
      build: 'flutter build apk',
    };
  }

  if (detected.has('swift')) {
    return {
      test: 'swift test',
      lint: 'swiftlint',
      build: 'swift build',
    };
  }

  return {
    test: 'npm test',
    lint: 'npm run lint',
    build: 'npm run build',
  };
}

function buildVerificationBlock(commands) {
  return [
    '## Verification',
    '- Run the repository checks before handoff:',
    `- Test: \`${commands.test}\``,
    `- Lint: \`${commands.lint}\``,
    `- Build: \`${commands.build}\``,
  ].join('\n');
}

function upsertManagedBlock(content, id, block) {
  const start = `<!-- nerviq:${id}:start -->`;
  const end = `<!-- nerviq:${id}:end -->`;
  const wrapped = `${start}\n${block.trim()}\n${end}`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (pattern.test(content)) {
    return {
      changed: true,
      content: content.replace(pattern, wrapped),
    };
  }

  return {
    changed: true,
    content: `${content.trimEnd()}\n\n${wrapped}\n`,
  };
}

function buildAgentsTemplate(ctx, commands) {
  const meta = detectProjectMetadata(ctx);
  const title = meta.name || path.basename(ctx.dir);

  return [
    `# ${title}`,
    '',
    '## Scope',
    '- Work inside the existing project boundaries and preserve established patterns.',
    '- Keep changes scoped to the requested task unless the repo clearly requires more.',
    '',
    buildVerificationBlock(commands),
    '',
    '## Working Agreement',
    '- Prefer editing existing files over introducing parallel abstractions.',
    '- Call out assumptions before taking repo-wide actions.',
  ].join('\n');
}

function buildLicenseTemplate(ctx) {
  const meta = detectProjectMetadata(ctx);
  const pkg = ctx.jsonFile('package.json') || {};
  const year = new Date().getFullYear();
  const name = meta.name || path.basename(ctx.dir);
  const declaredLicense = pkg.license ? `Declared license: ${pkg.license}` : 'Declared license: choose the approved license for this repository.';

  return [
    `${name} License Placeholder`,
    '',
    `Copyright (c) ${year} ${name}`,
    '',
    declaredLicense,
    'Replace this placeholder with the full, approved license text before publishing or distribution.',
  ].join('\n');
}

function buildChangelogTemplate() {
  return [
    '# Changelog',
    '',
    'All notable changes to this project will be documented in this file.',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '### Changed',
    '',
    '### Fixed',
    '',
    '### Security',
  ].join('\n');
}

function buildContributingTemplate(ctx, commands) {
  const meta = detectProjectMetadata(ctx);
  return [
    '# Contributing',
    '',
    `Thanks for contributing to ${meta.name || path.basename(ctx.dir)}.`,
    '',
    '## Local Setup',
    '- Install dependencies with the project-standard package manager.',
    '- Read the repository instructions before making changes.',
    '',
    '## Verification',
    `- Test: \`${commands.test}\``,
    `- Lint: \`${commands.lint}\``,
    `- Build: \`${commands.build}\``,
    '',
    '## Pull Requests',
    '- Keep changes focused and explain the user-facing impact.',
    '- Update docs and tests when behavior changes.',
  ].join('\n');
}

function buildEditorConfigTemplate() {
  return [
    'root = true',
    '',
    '[*]',
    'charset = utf-8',
    'end_of_line = lf',
    'indent_style = space',
    'indent_size = 2',
    'insert_final_newline = true',
    'trim_trailing_whitespace = true',
    '',
    '[*.md]',
    'trim_trailing_whitespace = false',
  ].join('\n');
}

function buildInstructionOperation({ ctx, stacks, failedByKey, platform, targetKeys }) {
  const keys = targetKeys.filter((key) => INSTRUCTION_KEYS.has(key));
  if (keys.length === 0) return null;

  const targetPath = resolveInstructionPath(ctx, platform);
  const existing = ctx.fileContent(targetPath);
  const commands = getVerificationCommands(ctx, stacks);
  let content = existing === null
    ? (
      targetPath.toLowerCase().includes('agents')
        ? buildAgentsTemplate(ctx, commands)
        : TEMPLATES['claude-md'](stacks, ctx)
    )
    : normalizeNewlines(existing);

  if (keys.some((key) => QUALITY_COMMAND_KEYS.has(key))) {
    const needsVerification = !hasDocumentedVerificationGuidance(content);
    const needsTest = !hasDocumentedTestCommand(content);
    const needsLint = !hasDocumentedLintCommand(content);
    const needsBuild = !hasDocumentedBuildCommand(content);

    if (needsVerification || needsTest || needsLint || needsBuild) {
      const merged = upsertManagedBlock(content, 'audit-fix-verification', buildVerificationBlock(commands));
      content = merged.content;
    }
  }

  const after = ensureTrailingNewline(content);
  if (existing !== null && normalizeForCompare(existing) === normalizeForCompare(after)) {
    return null;
  }

  return {
    type: 'file',
    path: targetPath,
    action: existing === null ? 'create' : 'patch',
    before: existing,
    after,
    keys,
    impact: highestImpact(keys, failedByKey),
  };
}

function buildSimpleCreateOperation(filePath, content, keys, failedByKey) {
  return {
    type: 'file',
    path: filePath,
    action: 'create',
    before: null,
    after: ensureTrailingNewline(content),
    keys,
    impact: highestImpact(keys, failedByKey),
  };
}

function buildGitIgnoreOperation(ctx, failedByKey, keys = ['gitIgnoreEnv']) {
  const existing = ctx.fileContent('.gitignore');
  const normalized = normalizeNewlines(existing || '');
  const normalizedKeys = unique(keys);
  const entries = unique(normalizedKeys.flatMap((key) => GITIGNORE_ENTRIES_BY_KEY[key] || []));
  const existingEntries = new Set(
    normalized
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#')),
  );
  const missingEntries = entries.filter((entry) => !existingEntries.has(entry));

  if (missingEntries.length === 0) {
    return null;
  }

  const prefix = normalized && !normalized.endsWith('\n') ? '\n' : '';
  return {
    type: 'file',
    path: '.gitignore',
    action: existing === null ? 'create' : 'patch',
    before: existing,
    after: ensureTrailingNewline(`${normalized}${prefix}${missingEntries.join('\n')}\n`),
    keys: normalizedKeys,
    impact: highestImpact(normalizedKeys, failedByKey),
  };
}

function buildSecretsProtectionOperation(ctx, failedByKey) {
  const settingsPath = '.claude/settings.json';
  const existing = ctx.fileContent(settingsPath);
  let settings = {};
  if (existing) {
    try {
      settings = JSON.parse(existing);
    } catch {
      settings = {};
    }
  }

  settings.permissions = settings.permissions || {};
  settings.permissions.deny = Array.isArray(settings.permissions.deny) ? settings.permissions.deny : [];
  const denyEntries = [
    'Read(.env)',
    'Read(.env.*)',
    'Read(**/.env)',
    'Read(**/.env.*)',
    'Read(**/*.pem)',
    'Read(**/secrets/**)',
  ];
  for (const entry of denyEntries) {
    if (!settings.permissions.deny.includes(entry)) {
      settings.permissions.deny.push(entry);
    }
  }
  if (Array.isArray(settings.permissions.allow) && settings.permissions.allow.includes('*')) {
    settings.permissions.allow = settings.permissions.allow.filter((item) => item !== '*');
    if (settings.permissions.allow.length === 0) {
      delete settings.permissions.allow;
    }
  }

  const after = `${JSON.stringify(settings, null, 2)}\n`;
  if (existing !== null && normalizeForCompare(existing) === normalizeForCompare(after)) {
    return null;
  }

  return {
    type: 'file',
    path: settingsPath,
    action: existing === null ? 'create' : 'patch',
    before: existing,
    after,
    keys: ['secretsProtection'],
    impact: highestImpact(['secretsProtection'], failedByKey),
  };
}

function buildEditorConfigOperation(ctx, failedByKey) {
  if (ctx.fileContent('.editorconfig') !== null) {
    return null;
  }

  return buildSimpleCreateOperation('.editorconfig', buildEditorConfigTemplate(), ['editorconfig'], failedByKey);
}

function buildFixPlan({ dir, platform, auditResult, targetKeys }) {
  const ctx = new ProjectContext(dir);
  const stacks = ctx.detectStacks(STACKS);
  const failedByKey = new Map(
    ((auditResult && auditResult.results) || [])
      .filter((item) => item && item.passed === false)
      .map((item) => [item.key, item]),
  );

  const normalizedKeys = unique(targetKeys);
  const customKeys = normalizedKeys.filter((key) => CUSTOM_FIXER_KEYS.has(key));
  const templateKeys = normalizedKeys.filter((key) => !CUSTOM_FIXER_KEYS.has(key) && TECHNIQUES[key] && TECHNIQUES[key].template);
  const operations = [];

  const instructionOperation = buildInstructionOperation({
    ctx,
    stacks,
    failedByKey,
    platform,
    targetKeys: customKeys,
  });
  if (instructionOperation) {
    operations.push(instructionOperation);
  }

  if (customKeys.includes('license') && ctx.fileContent('LICENSE') === null) {
    operations.push(buildSimpleCreateOperation('LICENSE', buildLicenseTemplate(ctx), ['license'], failedByKey));
  }
  if (customKeys.includes('changelog') && ctx.fileContent('CHANGELOG.md') === null) {
    operations.push(buildSimpleCreateOperation('CHANGELOG.md', buildChangelogTemplate(), ['changelog'], failedByKey));
  }
  if (customKeys.includes('contributing') && ctx.fileContent('CONTRIBUTING.md') === null) {
    operations.push(buildSimpleCreateOperation(
      'CONTRIBUTING.md',
      buildContributingTemplate(ctx, getVerificationCommands(ctx, stacks)),
      ['contributing'],
      failedByKey,
    ));
  }
  const gitIgnoreKeys = ['gitIgnoreEnv', 'gitIgnoreClaudeLocal', 'gitignoreClaudeLocal']
    .filter((key) => customKeys.includes(key));
  if (gitIgnoreKeys.length > 0) {
    const gitIgnoreOperation = buildGitIgnoreOperation(ctx, failedByKey, gitIgnoreKeys);
    if (gitIgnoreOperation) {
      operations.push(gitIgnoreOperation);
    }
  }
  if (customKeys.includes('secretsProtection')) {
    const secretsOperation = buildSecretsProtectionOperation(ctx, failedByKey);
    if (secretsOperation) {
      operations.push(secretsOperation);
    }
  }
  if (customKeys.includes('editorconfig')) {
    const editorconfigOperation = buildEditorConfigOperation(ctx, failedByKey);
    if (editorconfigOperation) {
      operations.push(editorconfigOperation);
    }
  }

  for (const key of templateKeys) {
    operations.push({
      type: 'template',
      key,
      keys: [key],
      impact: highestImpact([key], failedByKey),
    });
  }

  return operations.sort((a, b) => {
    const impactDiff = (IMPACT_ORDER[b.impact] || 0) - (IMPACT_ORDER[a.impact] || 0);
    if (impactDiff !== 0) return impactDiff;
    return String(a.path || a.key).localeCompare(String(b.path || b.key));
  });
}

function isAuditAllowedPath(filePath) {
  return AUDIT_FIX_ALLOWED_PATHS.has(String(filePath || '').replace(/\\/g, '/'));
}

function normalizeOperationForAudit(operation, failedByKey) {
  if (!operation || operation.type !== 'file' || !isAuditAllowedPath(operation.path)) {
    return null;
  }

  const evidence = unique((operation.keys || []).map((key) => {
    const failed = failedByKey.get(key);
    const file = failed?.file || operation.path;
    const line = Number.isFinite(failed?.line) ? failed.line : 1;
    return `${key}|${file}|${line}`;
  })).map((entry) => {
    const [key, file, rawLine] = entry.split('|');
    const failed = failedByKey.get(key) || {};
    return {
      key,
      name: failed.name || key,
      fix: failed.fix || null,
      file: file || operation.path,
      line: Number.isFinite(Number(rawLine)) ? Number(rawLine) : 1,
    };
  });

  const summaryLocation = evidence[0]
    ? `${evidence[0].file}:${evidence[0].line}`
    : `${operation.path}:1`;

  return {
    ...operation,
    evidence,
    summaryLocation,
  };
}

function buildAuditFixPlan({ dir, platform, auditResult, targetKeys }) {
  const failedResults = ((auditResult && auditResult.results) || []).filter((item) => item && item.passed === false);
  const failedByKey = new Map(failedResults.map((item) => [item.key, item]));
  const requestedKeys = unique(targetKeys).filter((key) => AUDIT_FIX_KEYS.has(key));
  const filePlan = buildFixPlan({
    dir,
    platform,
    auditResult,
    targetKeys: requestedKeys,
  })
    .map((operation) => normalizeOperationForAudit(operation, failedByKey))
    .filter(Boolean);

  const plannedKeySet = new Set(filePlan.flatMap((operation) => operation.keys || []));
  const advisoryOnly = failedResults
    .filter((item) => !plannedKeySet.has(item.key))
    .map((item) => ({
      key: item.key,
      name: item.name || item.key,
      impact: item.impact || 'medium',
      fix: item.fix || 'Manual fix required.',
      file: item.file || null,
      line: Number.isFinite(item.line) ? item.line : null,
    }))
    .sort(sortFailedResults);

  return {
    requestedKeys,
    plan: filePlan,
    advisoryOnly,
    failedByKey,
  };
}

function trimTrailingEmptyLine(lines) {
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    return lines.slice(0, -1);
  }
  return lines;
}

function formatUnifiedDiff(operation) {
  const beforeLines = trimTrailingEmptyLine(
    operation.before === null ? [] : normalizeNewlines(operation.before).split('\n'),
  );
  const afterLines = trimTrailingEmptyLine(normalizeNewlines(operation.after).split('\n'));

  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }

  let endBefore = beforeLines.length - 1;
  let endAfter = afterLines.length - 1;
  while (
    endBefore >= start &&
    endAfter >= start &&
    beforeLines[endBefore] === afterLines[endAfter]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const removed = beforeLines.slice(start, endBefore + 1);
  const added = afterLines.slice(start, endAfter + 1);
  const oldStart = operation.before === null ? 0 : start + 1;
  const oldCount = operation.before === null ? 0 : removed.length;
  const newStart = start + 1;
  const newCount = added.length;

  return [
    `diff --git a/${operation.path} b/${operation.path}`,
    operation.action === 'create' ? 'new file mode 100644' : null,
    `--- ${operation.before === null ? '/dev/null' : `a/${operation.path}`}`,
    `+++ b/${operation.path}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].filter(Boolean).join('\n');
}

function renderAuditFixPatch(plan) {
  if (!Array.isArray(plan) || plan.length === 0) {
    return '';
  }
  return `${plan.map((operation) => formatUnifiedDiff(operation)).join('\n\n')}\n`;
}

function resolvePatchOutputPath(dir, outputPath) {
  if (outputPath === '-') {
    return '-';
  }
  if (outputPath) {
    return path.isAbsolute(outputPath) ? outputPath : path.join(dir, outputPath);
  }
  return path.join(dir, 'audit-fix.patch');
}

function writeAuditFixPatch({ dir, outputPath, patch, logger }) {
  const targetPath = resolvePatchOutputPath(dir, outputPath);
  if (targetPath === '-') {
    logger.log('');
    logger.log(patch.trimEnd());
    logger.log('');
    return {
      filePath: null,
      relativePath: 'stdout',
    };
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, patch, 'utf8');
  return {
    filePath: targetPath,
    relativePath: path.relative(dir, targetPath),
  };
}

function formatAuditFixSummary(plan) {
  return plan.map((operation) => {
    const status = operation.action === 'create' ? 'A ' : 'M ';
    const keys = (operation.keys || []).join(', ');
    return `  ${status} ${operation.path}  (${operation.summaryLocation})  [${keys}]`;
  });
}

function formatAdvisoryItem(item) {
  const where = item.file ? `${item.file}${item.line ? `:${item.line}` : ''}` : 'repo-level';
  return `  - ${item.key} (${item.impact}) at ${where}: ${item.fix}`;
}

function runGit(args, dir) {
  return spawnSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30000,
  });
}

function createAuditFixBranch(dir) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').toLowerCase();
  const branchName = `nerviq/autofix-${stamp}`;
  let result = runGit(['switch', '-c', branchName], dir);
  if (result.status !== 0) {
    result = runGit(['checkout', '-b', branchName], dir);
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to create autofix branch.');
  }
  return branchName;
}

function stageAuditFixFiles(dir, plan, patchPath) {
  const paths = unique([
    ...plan.map((operation) => operation.path),
    patchPath && patchPath !== 'stdout' ? patchPath : null,
  ]);
  if (paths.length === 0) return;
  const result = runGit(['add', '--', ...paths], dir);
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to stage autofix files.');
  }
}

function formatDiff(filePath, before, after) {
  const beforeLines = before === null ? [] : normalizeNewlines(before).split('\n');
  const afterLines = normalizeNewlines(after).split('\n');

  if (before === null) {
    return [
      '--- /dev/null',
      `+++ ${filePath}`,
      '@@',
      ...afterLines.map((line) => `+${line}`),
    ].join('\n');
  }

  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }

  let endBefore = beforeLines.length - 1;
  let endAfter = afterLines.length - 1;
  while (
    endBefore >= start &&
    endAfter >= start &&
    beforeLines[endBefore] === afterLines[endAfter]
  ) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const removed = beforeLines.slice(start, endBefore + 1);
  const added = afterLines.slice(start, endAfter + 1);

  return [
    `--- ${filePath}`,
    `+++ ${filePath}`,
    '@@',
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join('\n');
}

function hasDoNotAutoEditMarker(content) {
  return typeof content === 'string' && content.includes('DO NOT AUTOEDIT');
}

async function confirmOperation(operation, logger) {
  logger.log('');
  logger.log(`  קובץ: ${operation.path}`);
  logger.log(formatDiff(operation.path, operation.before, operation.after));
  logger.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((resolve) => {
    rl.question('  להחיל את השינוי הזה? (Y/n) ', resolve);
  });
  rl.close();

  const normalized = String(answer || '').trim().toLowerCase();
  return normalized === '' || normalized === 'y' || normalized === 'yes';
}

function createRollbackArtifact(dir, createdFiles, patchedFiles, sourceLabel) {
  if (createdFiles.length === 0 && patchedFiles.length === 0) {
    return null;
  }

  return writeRollbackArtifact(dir, {
    sourcePlan: sourceLabel,
    createdFiles,
    patchedFiles,
    rollbackInstructions: [
      ...createdFiles.map((file) => `Delete ${file}`),
      ...patchedFiles.map((file) => `Restore previous content for ${file.path} from this manifest`),
    ],
  });
}

function describeTemplateOperation(operation) {
  const technique = TECHNIQUES[operation.key] || {};
  return `${operation.key} (${technique.name || 'template fix'})`;
}

async function applyFixes({
  dir,
  platform,
  auditResult,
  targetKeys,
  auto = false,
  dryRun = false,
  mode = 'fix',
  logger = console,
  recordOutcomes = false,
}) {
  const plan = buildFixPlan({ dir, platform, auditResult, targetKeys });
  const createdFiles = [];
  const patchedFiles = [];
  const keyStatus = new Map();
  const warnings = [];
  let rollbackArtifact = null;

  if (plan.length === 0) {
    return {
      exitCode: 2,
      plan,
      warnings,
      rollbackArtifact: null,
      keyStatus,
      reAudit: auditResult,
      targetedKeys: unique(targetKeys),
    };
  }

  if (!dryRun && !auto && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    logger.error('\n  שגיאה: `audit --fix` בלי `--auto` דורש טרמינל אינטראקטיבי.\n');
    return {
      exitCode: 2,
      plan,
      warnings,
      rollbackArtifact: null,
      keyStatus,
      reAudit: auditResult,
      targetedKeys: unique(targetKeys),
    };
  }

  logger.log('');
  logger.log(`  תוכנית autofix: ${plan.length} פריט(ים), ${unique(targetKeys).length} בדיקות יעד`);

  if (dryRun) {
    for (const operation of plan) {
      logger.log('');
      if (operation.type === 'file') {
        logger.log(`  שינוי מוצע: ${operation.path}`);
        logger.log(formatDiff(operation.path, operation.before, operation.after));
      } else {
        logger.log(`  תיקון תבנית מוצע: ${describeTemplateOperation(operation)}`);
      }
      for (const key of operation.keys) {
        keyStatus.set(key, 'dry-run');
      }
    }
    logger.log('\n  Dry-run הושלם. לא נכתבו קבצים.\n');
    return {
      exitCode: 0,
      plan,
      warnings,
      rollbackArtifact: null,
      keyStatus,
      reAudit: auditResult,
      targetedKeys: unique(targetKeys),
    };
  }

  try {
    for (const operation of plan) {
      if (operation.type === 'file' && hasDoNotAutoEditMarker(operation.before)) {
        const warning = `Skipped ${operation.path}: DO NOT AUTOEDIT marker found.`;
        warnings.push(warning);
        logger.warn(`  Warning: ${warning}`);
        for (const key of operation.keys) {
          keyStatus.set(key, 'skipped-do-not-autoedit');
        }
        continue;
      }

      if (!auto) {
        const confirmed = await confirmOperation(operation, logger);
        if (!confirmed) {
          logger.log(`  דולג: ${operation.path}`);
          for (const key of operation.keys) {
            keyStatus.set(key, 'skipped');
          }
          continue;
        }
      }

      if (operation.type === 'template') {
        const result = await setup({
          dir,
          platform,
          only: [operation.key],
          silent: true,
        });
        const didWrite = Array.isArray(result.writtenFiles) && result.writtenFiles.length > 0;
        for (const key of operation.keys) {
          keyStatus.set(key, didWrite ? 'applied' : 'skipped');
        }
        logger.log(`  ${didWrite ? 'הוחל' : 'דולג'} תיקון תבנית: ${describeTemplateOperation(operation)}`);
        continue;
      }

      const fullPath = path.join(dir, operation.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, operation.after, 'utf8');
      if (operation.action === 'create') {
        createdFiles.push(operation.path);
      } else {
        patchedFiles.push({ path: operation.path, previousContent: operation.before });
      }
      for (const key of operation.keys) {
        keyStatus.set(key, 'applied');
      }
      logger.log(`  הוחל: ${operation.path}`);
    }
  } catch (error) {
    rollbackArtifact = createRollbackArtifact(dir, createdFiles, patchedFiles, mode === 'audit' ? 'audit-fix' : 'fix-command');
    logger.error(`\n  Error: ${error.message}`);
    if (rollbackArtifact) {
      logger.error(`  נשמר rollback: ${rollbackArtifact.relativePath}`);
    }
    return {
      exitCode: 1,
      plan,
      warnings,
      rollbackArtifact,
      keyStatus,
      reAudit: auditResult,
      targetedKeys: unique(targetKeys),
      error,
    };
  }

  rollbackArtifact = createRollbackArtifact(dir, createdFiles, patchedFiles, mode === 'audit' ? 'audit-fix' : 'fix-command');
  const reAudit = await audit({ dir, platform, silent: true });
  const targetedKeys = unique(targetKeys);
  const unresolvedKeys = targetedKeys.filter((key) => {
    const check = (reAudit.results || []).find((item) => item.key === key);
    return !check || check.passed !== true;
  });

  for (const key of targetedKeys) {
    const previous = keyStatus.get(key);
    if (!previous || previous.startsWith('skipped') || previous === 'failed') {
      continue;
    }
    keyStatus.set(key, unresolvedKeys.includes(key) ? 'failed-verification' : 'verified');
  }

  if (recordOutcomes) {
    for (const key of targetedKeys) {
      const status = keyStatus.get(key);
      recordPattern(dir, key, status === 'verified' ? 'accepted' : 'rejected');
    }
  }

  logger.log('');
  logger.log(`  ציון לאחר audit חוזר: ${auditResult.score} -> ${reAudit.score}`);
  if (rollbackArtifact) {
    logger.log(`  נשמר rollback: ${rollbackArtifact.relativePath}`);
  }
  if (unresolvedKeys.length > 0) {
    logger.log(`  בדיקות שלא נפתרו: ${unresolvedKeys.join(', ')}`);
    logger.log('');
    return {
      exitCode: 1,
      plan,
      warnings,
      rollbackArtifact,
      keyStatus,
      reAudit,
      targetedKeys,
      unresolvedKeys,
    };
  }

  logger.log('  התיקון האוטומטי הושלם בהצלחה.');
  logger.log('');
  return {
    exitCode: 0,
    plan,
    warnings,
    rollbackArtifact,
    keyStatus,
    reAudit,
    targetedKeys,
    unresolvedKeys: [],
  };
}

async function runAuditFixWorkflow({
  dir,
  platform,
  auditResult,
  targetKeys,
  auto = false,
  apply = false,
  pr = false,
  outputPath = null,
  logger = console,
}) {
  const { requestedKeys, plan, advisoryOnly, failedByKey } = buildAuditFixPlan({
    dir,
    platform,
    auditResult,
    targetKeys,
  });

  if (requestedKeys.length === 0 || plan.length === 0) {
    logger.log('');
    logger.log('  No deterministic audit autofixes are available for this repo.');
    if (advisoryOnly.length > 0) {
      logger.log('  Advisory only — manual fix required:');
      for (const item of advisoryOnly.slice(0, 12)) {
        logger.log(formatAdvisoryItem(item));
      }
      if (advisoryOnly.length > 12) {
        logger.log(`  ... and ${advisoryOnly.length - 12} more advisory findings.`);
      }
    }
    logger.log('');
    return {
      exitCode: 2,
      requestedKeys,
      plan,
      advisoryOnly,
      patchArtifact: null,
      rollbackArtifact: null,
      reAudit: auditResult,
      unresolvedKeys: [],
      branchName: null,
    };
  }

  if (apply && !auto && !pr) {
    logger.error('\n  Error: `nerviq audit --fix --apply` requires `--auto`.\n');
    return {
      exitCode: 2,
      requestedKeys,
      plan,
      advisoryOnly,
      patchArtifact: null,
      rollbackArtifact: null,
      reAudit: auditResult,
      unresolvedKeys: [],
      branchName: null,
    };
  }

  const patch = renderAuditFixPatch(plan);
  const patchArtifact = writeAuditFixPatch({
    dir,
    outputPath,
    patch,
    logger,
  });

  logger.log('');
  logger.log('  Audit autofix plan');
  logger.log('  ═══════════════════════════════════════');
  for (const line of formatAuditFixSummary(plan)) {
    logger.log(line);
  }
  logger.log('');
  logger.log(`  Patch: ${patchArtifact.relativePath}`);
  if (advisoryOnly.length > 0) {
    logger.log('');
    logger.log('  Advisory only — manual fix required:');
    for (const item of advisoryOnly.slice(0, 12)) {
      logger.log(formatAdvisoryItem(item));
    }
    if (advisoryOnly.length > 12) {
      logger.log(`  ... and ${advisoryOnly.length - 12} more advisory findings.`);
    }
  }

  if (!apply && !pr) {
    logger.log('');
    logger.log('  Dry run complete. No files were written.');
    logger.log('  Run `nerviq audit --fix --apply --auto` to apply these changes.');
    logger.log('  Run `nerviq audit --fix --pr` to create a local autofix branch and stage the files.');
    logger.log('');
    return {
      exitCode: 0,
      requestedKeys,
      plan,
      advisoryOnly,
      patchArtifact,
      rollbackArtifact: null,
      reAudit: auditResult,
      unresolvedKeys: [],
      branchName: null,
    };
  }

  let branchName = null;
  const createdFiles = [];
  const patchedFiles = [];
  const warnings = [];

  try {
    if (pr) {
      const repoCheck = runGit(['rev-parse', '--is-inside-work-tree'], dir);
      if (repoCheck.status !== 0) {
        throw new Error('`--pr` requires a git repository.');
      }
      branchName = createAuditFixBranch(dir);
    }

    for (const operation of plan) {
      if (hasDoNotAutoEditMarker(operation.before)) {
        const warning = `Skipped ${operation.path}: DO NOT AUTOEDIT marker found.`;
        warnings.push(warning);
        logger.warn(`  Warning: ${warning}`);
        continue;
      }

      if (!isAuditAllowedPath(operation.path)) {
        const warning = `Skipped ${operation.path}: outside audit autofix allowlist.`;
        warnings.push(warning);
        logger.warn(`  Warning: ${warning}`);
        continue;
      }

      const fullPath = path.join(dir, operation.path);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, operation.after, 'utf8');
      if (operation.action === 'create') {
        createdFiles.push(operation.path);
      } else {
        patchedFiles.push({ path: operation.path, previousContent: operation.before });
      }
      logger.log(`  Applied ${operation.action === 'create' ? 'create' : 'patch'}: ${operation.path}`);
    }
  } catch (error) {
    const rollbackArtifact = createRollbackArtifact(dir, createdFiles, patchedFiles, 'audit-fix');
    logger.error(`\n  Error: ${error.message}\n`);
    return {
      exitCode: 1,
      requestedKeys,
      plan,
      advisoryOnly,
      patchArtifact,
      rollbackArtifact,
      reAudit: auditResult,
      unresolvedKeys: requestedKeys,
      branchName,
      warnings,
    };
  }

  const rollbackArtifact = createRollbackArtifact(dir, createdFiles, patchedFiles, 'audit-fix');
  const reAudit = await audit({ dir, platform, silent: true });
  const unresolvedKeys = requestedKeys.filter((key) => {
    const planned = plan.some((operation) => (operation.keys || []).includes(key));
    if (!planned) return false;
    const failed = failedByKey.get(key);
    if (!failed) return false;
    const check = (reAudit.results || []).find((item) => item.key === key);
    return !check || check.passed !== true;
  });

  if (pr) {
    stageAuditFixFiles(dir, plan, patchArtifact.relativePath);
  }

  logger.log('');
  logger.log(`  Re-audit score: ${auditResult.score} -> ${reAudit.score}`);
  if (rollbackArtifact) {
    logger.log(`  Rollback: ${rollbackArtifact.relativePath}`);
  }
  if (branchName) {
    logger.log(`  Branch: ${branchName}`);
    logger.log('  Files are staged for review.');
  }
  if (unresolvedKeys.length > 0) {
    logger.log(`  Unresolved targeted checks: ${unresolvedKeys.join(', ')}`);
    logger.log('');
    return {
      exitCode: 1,
      requestedKeys,
      plan,
      advisoryOnly,
      patchArtifact,
      rollbackArtifact,
      reAudit,
      unresolvedKeys,
      branchName,
      warnings,
    };
  }

  logger.log('  Audit autofix completed successfully.');
  logger.log('');
  return {
    exitCode: 0,
    requestedKeys,
    plan,
    advisoryOnly,
    patchArtifact,
    rollbackArtifact,
    reAudit,
    unresolvedKeys,
    branchName,
    warnings,
  };
}

module.exports = {
  AUDIT_FIX_KEYS,
  CUSTOM_FIXER_KEYS,
  applyFixes,
  buildFixPlan,
  buildAuditFixPlan,
  getFixableFailedResults,
  isFixableKey,
  runAuditFixWorkflow,
};
