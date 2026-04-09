const fs = require('fs');
const path = require('path');

const { version } = require('../package.json');
const { analyzeProject } = require('./analyze');
const { ProjectContext } = require('./context');
const { TECHNIQUES, STACKS } = require('./techniques');
const { TEMPLATES } = require('./setup');
const { buildSettingsForProfile } = require('./governance');
const { getMcpPackPreflight } = require('./mcp-packs');
const { writeActivityArtifact, writeRollbackArtifact } = require('./activity');
const { buildCodexProposalBundle } = require('./codex/plans');

const TEMPLATE_DIR_MAP = {
  hooks: '.claude/hooks',
  commands: '.claude/commands',
  skills: '.claude/skills',
  rules: '.claude/rules',
  agents: '.claude/agents',
};

const TEMPLATE_LABELS = {
  'claude-md': 'CLAUDE.md baseline',
  hooks: 'Hooks bundle',
  commands: 'Slash commands',
  skills: 'Skills pack',
  rules: 'Rules pack',
  agents: 'Specialized agents',
};

const TEMPLATE_MODULES = {
  'claude-md': 'CLAUDE.md',
  hooks: 'hooks',
  commands: 'commands',
  skills: 'skills',
  rules: 'rules',
  agents: 'agents',
};

const IMPACT_ORDER = { critical: 3, high: 2, medium: 1, low: 0 };
const FALLBACK_TEMPLATE_BY_KEY = {
  importSyntax: 'claude-md',
  verificationLoop: 'claude-md',
  testCommand: 'claude-md',
  lintCommand: 'claude-md',
  buildCommand: 'claude-md',
  securityReview: 'claude-md',
  compactionAwareness: 'claude-md',
  contextManagement: 'claude-md',
  xmlTags: 'claude-md',
  roleDefinition: 'claude-md',
  constraintBlocks: 'claude-md',
  claudeMdFreshness: 'claude-md',
  permissionDeny: 'hooks',
  secretsProtection: 'hooks',
  preToolUseHook: 'hooks',
  postToolUseHook: 'hooks',
  sessionStartHook: 'hooks',
  agentsHaveMaxTurns: 'agents',
};

function previewContent(content) {
  return content.split('\n').slice(0, 12).join('\n');
}

function riskFromImpact(impact) {
  if (impact === 'critical') return 'high';
  if (impact === 'high') return 'medium';
  return 'low';
}

function normalizeNewlines(content) {
  return (content || '').replace(/\r\n/g, '\n');
}

function ensureTrailingNewline(content) {
  const normalized = normalizeNewlines(content);
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
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

function extractGeneratedBuildSection(content) {
  const match = content.match(/## Build & Test\n([\s\S]*?)\n\n## Working Notes/);
  return match ? `## Build & Test\n${match[1].trim()}` : null;
}

function extractGeneratedVerificationBlock(content) {
  const match = content.match(/<verification>\n([\s\S]*?)\n<\/verification>/);
  return match ? `<verification>\n${match[1].trim()}\n</verification>` : null;
}

function extractGeneratedWorkingNotes(content) {
  const match = content.match(/## Working Notes\n([\s\S]*?)\n\n<constraints>/);
  return match ? `## Working Notes\n${match[1].trim()}` : null;
}

function extractGeneratedConstraintsBlock(content) {
  const match = content.match(/<constraints>\n([\s\S]*?)\n<\/constraints>/);
  return match ? `<constraints>\n${match[1].trim()}\n</constraints>` : null;
}

function extractGeneratedContextSection(content) {
  const match = content.match(/## Context Management\n([\s\S]*?)\n\n---/);
  return match ? `## Context Management\n${match[1].trim()}` : null;
}

function getFailedTemplateGroups(ctx, only = []) {
  const groups = new Map();
  for (const [key, technique] of Object.entries(TECHNIQUES)) {
    const passed = technique.check(ctx);
    const templateKey = technique.template || FALLBACK_TEMPLATE_BY_KEY[key];
    if (passed !== false || !templateKey) continue;
    if (templateKey === 'mermaid') continue;
    if (only.length > 0 && !only.includes(key) && !only.includes(templateKey)) continue;
    if (!groups.has(templateKey)) {
      groups.set(templateKey, []);
    }
    groups.get(templateKey).push({ key, ...technique });
  }
  return groups;
}

function buildClaudeMdPatchFile(ctx, stacks) {
  const claudePath = ctx.fileContent('CLAUDE.md') !== null
    ? 'CLAUDE.md'
    : (ctx.fileContent('.claude/CLAUDE.md') !== null ? '.claude/CLAUDE.md' : null);
  if (!claudePath) return null;

  const existing = normalizeNewlines(ctx.fileContent(claudePath));
  const generated = TEMPLATES['claude-md'](stacks, ctx);
  const buildSection = extractGeneratedBuildSection(generated);
  const verificationBlock = extractGeneratedVerificationBlock(generated);
  const workingNotes = extractGeneratedWorkingNotes(generated);
  const constraintsBlock = extractGeneratedConstraintsBlock(generated);
  const contextSection = extractGeneratedContextSection(generated);
  let merged = existing;
  let changed = false;

  const hasTest = /npm test|pytest|jest|vitest|cargo test|go test|mix test|rspec/.test(merged);
  const hasLint = /eslint|prettier|ruff|black|clippy|golangci-lint|rubocop/.test(merged);
  const hasBuild = /npm run build|cargo build|go build|make|tsc|gradle build|mvn compile/.test(merged);
  const hasVerification = merged.includes('<verification>');
  const hasSecurityWorkflow = merged.toLowerCase().includes('security') || merged.includes('/security-review');
  const hasImportGuidance = merged.includes('@import');
  const hasRoleDefinition = /you are|your role|act as|persona|behave as/i.test(merged);
  const hasConstraintBlock = /<constraints|<rules|<requirements|<boundaries/i.test(merged);
  const hasCompaction = /\/compact|compaction/i.test(merged);
  const hasContextManagement = /context.*(manage|window|limit|budget|token)/i.test(merged);
  const modernFeatures = ['hook', 'skill', 'agent', 'subagent', 'mcp', 'worktree'];
  const hasFreshness = modernFeatures.filter(feature => merged.toLowerCase().includes(feature)).length >= 2;

  if ((!hasTest || !hasLint || !hasBuild) && buildSection) {
    const result = upsertManagedBlock(merged, 'build-test', buildSection);
    merged = result.content;
    changed = true;
  }

  if (!hasRoleDefinition && workingNotes) {
    const result = upsertManagedBlock(merged, 'working-style', workingNotes);
    merged = result.content;
    changed = true;
  }

  if (!hasConstraintBlock && constraintsBlock) {
    const result = upsertManagedBlock(merged, 'constraints', constraintsBlock);
    merged = result.content;
    changed = true;
  }

  if (!hasVerification && verificationBlock) {
    const result = upsertManagedBlock(merged, 'verification', verificationBlock);
    merged = result.content;
    changed = true;
  }

  if (!hasSecurityWorkflow) {
    const result = upsertManagedBlock(merged, 'security-workflow', [
      '## Security Workflow',
      '- Run `/security-review` when touching authentication, permissions, secrets, or customer data.',
      '- Treat secret access, shell commands, and risky file operations as review-worthy changes.',
    ].join('\n'));
    merged = result.content;
    changed = true;
  }

  if (!hasImportGuidance) {
    const result = upsertManagedBlock(merged, 'modularity', [
      '## Modularity',
      '- If this file grows, split it with `@import ./docs/...` so the base instructions stay concise.',
    ].join('\n'));
    merged = result.content;
    changed = true;
  }

  if ((!hasCompaction || !hasContextManagement || !hasFreshness) && contextSection) {
    const result = upsertManagedBlock(merged, 'context-management', contextSection);
    merged = result.content;
    changed = true;
  }

  if (!changed) {
    return null;
  }

  return {
    path: claudePath,
    action: 'patch',
    currentState: 'existing CLAUDE.md is missing recommended verification or security sections',
    proposedState: 'append managed sections for verification, security workflow, and modularity',
    content: ensureTrailingNewline(merged),
  };
}

function buildAgentPatchFiles(ctx) {
  if (!ctx.hasDir('.claude/agents')) {
    return [];
  }

  return ctx.dirFiles('.claude/agents')
    .filter(file => file.endsWith('.md'))
    .map((file) => {
      const relativePath = `.claude/agents/${file}`;
      const content = normalizeNewlines(ctx.fileContent(relativePath) || '');
      if (!content.startsWith('---\n') || content.includes('\nmaxTurns:')) {
        return null;
      }

      const updated = content.replace(/^---\n([\s\S]*?)\n---/, (match, frontmatter) => `---\n${frontmatter}\nmaxTurns: 50\n---`);
      if (updated === content) {
        return null;
      }

      return {
        path: relativePath,
        action: 'patch',
        currentState: 'existing agent is missing a maxTurns safety limit',
        proposedState: 'add maxTurns: 50 to the agent frontmatter',
        content: ensureTrailingNewline(updated),
      };
    })
    .filter(Boolean);
}

function buildHookSettings(ctx, plannedHookFiles, options = {}) {
  const existing = ctx.hasDir('.claude/hooks')
    ? ctx.dirFiles('.claude/hooks').filter(file => file.endsWith('.sh') || file.endsWith('.js'))
    : [];
  const hookFiles = [...new Set([...existing, ...plannedHookFiles])].sort();
  if (hookFiles.length === 0) {
    return null;
  }
  const settingsPath = '.claude/settings.json';
  const existingSettings = ctx.jsonFile(settingsPath);
  const settings = buildSettingsForProfile({
    profileKey: options.profile || 'safe-write',
    hookFiles,
    existingSettings,
    mcpPackKeys: options.mcpPacks || [],
  });
  const content = `${JSON.stringify(settings, null, 2)}\n`;
  const existingContent = existingSettings ? `${JSON.stringify(existingSettings, null, 2)}\n` : null;

  if (existingContent === content) {
    return null;
  }

  return {
    path: settingsPath,
    action: existingSettings ? 'patch' : 'create',
    currentState: existingSettings
      ? 'existing settings are missing selected profile protections or hook registrations'
      : 'settings file is missing',
    proposedState: existingSettings
      ? `merge ${options.profile || 'safe-write'} profile protections into existing settings`
      : `create settings for ${options.profile || 'safe-write'} profile and register hooks`,
    content,
  };
}

function buildTemplateFiles(templateKey, stacks, ctx, triggers, options = {}) {
  const patchFiles = templateKey === 'agents' ? buildAgentPatchFiles(ctx) : [];

  if (templateKey === 'claude-md') {
    const patchFile = buildClaudeMdPatchFile(ctx, stacks);
    if (patchFile) {
      return [patchFile];
    }
  }

  const template = TEMPLATES[templateKey];
  if (!template) return [];

  const result = template(stacks, ctx);
  if (typeof result === 'string') {
    return [{ path: 'CLAUDE.md', content: result }];
  }

  const targetDir = TEMPLATE_DIR_MAP[templateKey];
  if (!targetDir) return [];

  const generatedFiles = Object.entries(result).map(([fileName, content]) => ({
    path: path.posix.join(targetDir.replace(/\\/g, '/'), fileName),
    content,
  }));

  const patchedPaths = new Set(patchFiles.map(file => file.path));
  return [...patchFiles, ...generatedFiles.filter(file => !patchedPaths.has(file.path))];
}

function toProposal(templateKey, triggers, templateFiles, ctx) {
  const sortedTriggers = [...triggers].sort((a, b) => {
    const impactA = IMPACT_ORDER[a.impact] ?? 0;
    const impactB = IMPACT_ORDER[b.impact] ?? 0;
    return impactB - impactA;
  });
  const highestImpact = sortedTriggers[0]?.impact || 'medium';
  const files = templateFiles.map(file => {
    const exists = ctx.fileContent(file.path) !== null || ctx.hasDir(file.path);
    const action = file.action || (exists ? 'manual-review' : 'create');
    const currentState = file.currentState || (exists ? 'file already exists and will be preserved' : 'missing');
    const proposedState = file.proposedState || (exists ? 'generated baseline available for manual merge' : 'create new file');
    const diffPreview = [
      `--- ${exists ? file.path : 'missing'}`,
      `+++ ${file.path}`,
      ...previewContent(file.content).split('\n').map(line => `+${line}`),
    ].join('\n');
    return {
      path: file.path,
      action,
      currentState,
      proposedState,
      bytes: Buffer.byteLength(file.content, 'utf8'),
      content: file.content,
      preview: previewContent(file.content),
      diffPreview,
    };
  });

  return {
    id: templateKey,
    title: TEMPLATE_LABELS[templateKey] || templateKey,
    module: TEMPLATE_MODULES[templateKey] || templateKey,
    risk: riskFromImpact(highestImpact),
    confidence: sortedTriggers.length >= 2 ? 'high' : 'medium',
    triggers: sortedTriggers.map(trigger => ({
      key: trigger.key,
      name: trigger.name,
      impact: trigger.impact,
      fix: trigger.fix,
    })),
    rationale: sortedTriggers.map(trigger => trigger.fix),
    files,
    readyToApply: files.some(file => ['create', 'patch'].includes(file.action)),
  };
}

async function buildProposalBundle(options) {
  if (options.platform === 'codex') {
    return buildCodexProposalBundle(options);
  }

  const ctx = new ProjectContext(options.dir);
  const stacks = ctx.detectStacks(STACKS);
  const report = await analyzeProject({ ...options, mode: 'augment' });
  const mcpPreflightWarnings = getMcpPackPreflight(options.mcpPacks || [])
    .filter(item => item.missingEnvVars.length > 0);
  const groups = getFailedTemplateGroups(ctx, options.only || []);
  const proposals = [];

  for (const [templateKey, triggers] of groups.entries()) {
    const templateFiles = buildTemplateFiles(templateKey, stacks, ctx, triggers, options);
    if (templateKey === 'hooks') {
      const plannedHookFiles = templateFiles
        .map(file => path.basename(file.path))
        .filter(file => file.endsWith('.sh') || file.endsWith('.js'));
      const settingsFile = buildHookSettings(ctx, plannedHookFiles, options);
      if (settingsFile) {
        templateFiles.push(settingsFile);
      }
    }
    proposals.push(toProposal(templateKey, triggers, templateFiles, ctx));
  }

  proposals.sort((a, b) => {
    const impactA = IMPACT_ORDER[a.triggers[0]?.impact] ?? 0;
    const impactB = IMPACT_ORDER[b.triggers[0]?.impact] ?? 0;
    return impactB - impactA;
  });

  return {
    schemaVersion: 1,
    generatedBy: `nerviq@${version}`,
    createdAt: new Date().toISOString(),
    directory: options.dir,
    projectSummary: report.projectSummary,
    strengthsPreserved: report.strengthsPreserved,
    topNextActions: report.topNextActions,
    riskNotes: report.riskNotes,
    mcpPreflightWarnings,
    proposals,
  };
}

function printProposalBundle(bundle, options = {}) {
  if (options.json) {
    console.log(JSON.stringify(bundle, null, 2));
    return;
  }

  console.log('');
  console.log('  nerviq plan');
  console.log('  ═══════════════════════════════════════');
  console.log(`  ${bundle.projectSummary.name} | maturity=${bundle.projectSummary.maturity} | score=${bundle.projectSummary.score}/100`);
  if (bundle.projectSummary.archetype) {
    console.log(`  archetype=${bundle.projectSummary.archetype} | workflow=${bundle.projectSummary.workflow || 'unknown'} | risk=${bundle.projectSummary.riskLevel || 'unknown'}`);
  }
  console.log('');

  if (bundle.mcpPreflightWarnings && bundle.mcpPreflightWarnings.length > 0) {
    console.log('  MCP Preflight Warnings');
    for (const warning of bundle.mcpPreflightWarnings) {
      console.log(`  - ${warning.label}: missing ${warning.missingEnvVars.join(', ')}`);
    }
    console.log('');
  }

  if (bundle.proposals.length === 0) {
    console.log('  No templated proposals are needed right now.');
    console.log('');
    return;
  }

  console.log('  Proposal Bundles');
  for (const proposal of bundle.proposals) {
    const applyState = proposal.readyToApply ? 'ready' : 'manual-review';
    console.log(`  - ${proposal.id} [${applyState}]`);
    console.log(`    ${proposal.title} | risk=${proposal.risk} | confidence=${proposal.confidence}`);
    console.log(`    triggers: ${proposal.triggers.map(item => item.name).join(', ')}`);
    console.log(`    files: ${proposal.files.map(file => `${file.path} (${file.action})`).join(', ')}`);
  }
  console.log('');
}

function writePlanFile(bundle, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(bundle, null, 2), 'utf8');
  return writeActivityArtifact(bundle.directory, 'plan-export', {
    exportedPlan: outFile,
    proposalIds: bundle.proposals.map(proposal => proposal.id),
    proposalCount: bundle.proposals.length,
  });
}

function tryParseJson(content) {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function applyRuntimeSettingsOverlays(bundle, options) {
  if (options.platform === 'codex') {
    return bundle;
  }

  if (!bundle || !Array.isArray(bundle.proposals)) {
    return bundle;
  }

  const ctx = new ProjectContext(options.dir);
  const existingHooks = ctx.hasDir('.claude/hooks')
    ? ctx.dirFiles('.claude/hooks').filter(file => file.endsWith('.sh') || file.endsWith('.js'))
    : [];

  const proposals = bundle.proposals.map((proposal) => {
    const settingsIndex = proposal.files.findIndex(file => file.path === '.claude/settings.json');
    if (settingsIndex === -1) {
      return proposal;
    }

    const plannedHookFiles = proposal.files
      .filter(file => file.path.startsWith('.claude/hooks/') && file.path.endsWith('.sh'))
      .map(file => path.basename(file.path));
    const hookFiles = [...new Set([...existingHooks, ...plannedHookFiles])].sort();
    const currentSettings = tryParseJson(proposal.files[settingsIndex].content) || ctx.jsonFile('.claude/settings.json') || null;
    const mergedSettings = buildSettingsForProfile({
      profileKey: options.profile || 'safe-write',
      hookFiles,
      existingSettings: currentSettings,
      mcpPackKeys: options.mcpPacks || [],
    });
    const updatedContent = `${JSON.stringify(mergedSettings, null, 2)}\n`;
    const currentFile = proposal.files[settingsIndex];

    const files = [...proposal.files];
    files[settingsIndex] = {
      ...currentFile,
      content: updatedContent,
      preview: previewContent(updatedContent),
      diffPreview: [
        `--- ${ctx.fileContent(currentFile.path) !== null ? currentFile.path : 'missing'}`,
        `+++ ${currentFile.path}`,
        ...previewContent(updatedContent).split('\n').map(line => `+${line}`),
      ].join('\n'),
      currentState: currentFile.currentState || 'existing settings are missing runtime-selected protections or MCP packs',
      proposedState: `merge ${options.profile || 'safe-write'} profile protections and requested MCP packs into settings`,
    };

    return {
      ...proposal,
      files,
    };
  });

  return {
    ...bundle,
    proposals,
  };
}

function resolvePlan(bundle, options) {
  if (options.planFile) {
    return applyRuntimeSettingsOverlays(JSON.parse(fs.readFileSync(options.planFile, 'utf8')), options);
  }
  return applyRuntimeSettingsOverlays(bundle, options);
}

async function applyProposalBundle(options) {
  const liveBundle = options.planFile ? null : await buildProposalBundle(options);
  const bundle = resolvePlan(liveBundle, options);
  const mcpPreflightWarnings = getMcpPackPreflight(options.mcpPacks || [])
    .filter(item => item.missingEnvVars.length > 0);
  const selectedIds = options.only && options.only.length > 0
    ? new Set(options.only)
    : null;
  const selected = bundle.proposals.filter(proposal => {
    if (selectedIds && !selectedIds.has(proposal.id)) return false;
    return proposal.readyToApply;
  });

  const createdFiles = [];
  const patchedFiles = [];
  const skippedFiles = [];
  for (const proposal of selected) {
    for (const file of proposal.files) {
      if (!['create', 'patch'].includes(file.action)) {
        skippedFiles.push(file.path);
        continue;
      }
      const fullPath = path.join(options.dir, file.path);
      if (file.action === 'create' && fs.existsSync(fullPath)) {
        skippedFiles.push(file.path);
        continue;
      }
      const previousContent = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : null;
      if (!options.dryRun) {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, file.content, 'utf8');
      }
      if (file.action === 'create') {
        createdFiles.push(file.path);
      } else {
        patchedFiles.push({ path: file.path, previousContent });
      }
    }
  }

  let rollback = null;
  let activity = null;
  if (!options.dryRun && (createdFiles.length > 0 || patchedFiles.length > 0)) {
    rollback = writeRollbackArtifact(options.dir, {
      sourcePlan: options.planFile ? path.basename(options.planFile) : 'live-plan',
      createdFiles,
      patchedFiles,
      rollbackInstructions: [
        ...createdFiles.map(file => `Delete ${file}`),
        ...patchedFiles.map(file => `Restore previous content for ${file.path} from this manifest`),
      ],
    });
    activity = writeActivityArtifact(options.dir, 'apply', {
      sourcePlan: options.planFile ? path.basename(options.planFile) : 'live-plan',
      appliedProposalIds: selected.map(item => item.id),
      createdFiles,
      patchedFiles: patchedFiles.map(file => file.path),
      skippedFiles,
      rollbackArtifact: rollback.relativePath,
    });
  }

  return {
    proposalCount: bundle.proposals.length,
    appliedProposalIds: selected.map(item => item.id),
    createdFiles,
    patchedFiles: patchedFiles.map(file => file.path),
    skippedFiles,
    dryRun: options.dryRun === true,
    rollbackArtifact: rollback ? rollback.relativePath : null,
    activityArtifact: activity ? activity.relativePath : null,
    mcpPreflightWarnings,
  };
}

function printApplyResult(result, options = {}) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('');
  console.log('  nerviq apply');
  console.log('  ═══════════════════════════════════════');
  if (result.dryRun) {
    console.log('  Dry-run only. No files were written.');
  }
  console.log(`  Applied proposal bundles: ${result.appliedProposalIds.join(', ') || 'none'}`);
  console.log(`  Created files: ${result.createdFiles.join(', ') || 'none'}`);
  console.log(`  Patched files: ${result.patchedFiles.join(', ') || 'none'}`);
  if (result.mcpPreflightWarnings && result.mcpPreflightWarnings.length > 0) {
    console.log('  MCP preflight warnings:');
    for (const warning of result.mcpPreflightWarnings) {
      console.log(`  - ${warning.label}: missing ${warning.missingEnvVars.join(', ')}`);
    }
  }
  if (result.rollbackArtifact) {
    console.log(`  Rollback: ${result.rollbackArtifact}`);
  }
  if (result.activityArtifact) {
    console.log(`  Activity log: ${result.activityArtifact}`);
  }
  console.log('');
}

module.exports = {
  buildProposalBundle,
  printProposalBundle,
  writePlanFile,
  applyProposalBundle,
  printApplyResult,
};
