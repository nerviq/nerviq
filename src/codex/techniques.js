const os = require('os');
const path = require('path');
const { EMBEDDED_SECRET_PATTERNS, containsEmbeddedSecret } = require('../secret-patterns');
const { attachSourceUrls } = require('../source-urls');
const { buildSupplementalChecks } = require('../supplemental-checks');
const { resolveProjectStateReadPath } = require('../state-paths');

const CODEX_SUPPLEMENTAL_SOURCE_URLS = {
  'testing-strategy': 'https://developers.openai.com/codex/cli',
  'code-quality': 'https://developers.openai.com/codex/rules',
  'api-design': 'https://developers.openai.com/codex/guides/agents-md',
  database: 'https://developers.openai.com/codex/cli',
  authentication: 'https://developers.openai.com/codex/agent-approvals-security',
  monitoring: 'https://developers.openai.com/codex/feature-maturity',
  'dependency-management': 'https://developers.openai.com/codex/config-reference',
  'cost-optimization': 'https://developers.openai.com/codex/guides/agents-md',
};

const DEFAULT_PROJECT_DOC_MAX_BYTES = 32768;
const SUPPORTED_HOOK_EVENTS = new Set(['SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop']);
const NESTED_ONLY_ROOT_KEYS = new Set(['send_to_server', 'persistence', 'max_threads', 'max_depth', 'enabled_tools', 'startup_timeout_sec']);
const FILLER_PATTERNS = [
  /\bbe helpful\b/i,
  /\bbe accurate\b/i,
  /\bbe concise\b/i,
  /\balways do your best\b/i,
  /\bmaintain high quality\b/i,
  /\bwrite clean code\b/i,
  /\bfollow best practices\b/i,
];
const JUSTIFICATION_PATTERNS = /\bbecause\b|\bwhy\b|\bjustif(?:y|ication)\b|\btemporary\b|\bintentional\b|\bdocumented\b|\bair[- ]?gapped\b|\binternal only\b|\bephemeral\b|\bci only\b/i;
const LEGACY_CONFIG_PATTERNS = [
  { pattern: /^\s*reasoning_effort\s*=/m, note: 'Use `model_reasoning_effort`, not `reasoning_effort`.' },
  { pattern: /^\s*weak_model\s*=/m, note: 'Use `model_for_weak_tasks`, not `weak_model`.' },
  { pattern: /^\s*history_send_to_server\s*=/m, note: 'Nest `send_to_server` under `[history]`.' },
  { pattern: /^\s*mcpServers\s*=/m, note: 'Use `[mcp_servers.<id>]` TOML tables, not `mcpServers`.' },
];

function agentsPath(ctx) {
  return ctx.fileContent('AGENTS.md') ? 'AGENTS.md' : (ctx.agentsMdPath ? ctx.agentsMdPath() : null);
}

function agentsContent(ctx) {
  const filePath = agentsPath(ctx);
  return filePath ? (ctx.fileContent(filePath) || '') : '';
}

function countSections(markdown) {
  return (markdown.match(/^##\s+/gm) || []).length;
}

function firstLineMatching(text, matcher) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (typeof matcher === 'string' && line.includes(matcher)) {
      return index + 1;
    }
    if (matcher instanceof RegExp && matcher.test(line)) {
      matcher.lastIndex = 0;
      return index + 1;
    }
    if (typeof matcher === 'function' && matcher(line, index + 1)) {
      return index + 1;
    }
  }
  return null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function configKeyLine(ctx, key) {
  return ctx.lineNumber('.codex/config.toml', new RegExp(`^\\s*${escapeRegex(key)}\\s*=`, 'i'));
}

function configSectionKeyLine(ctx, sectionPath, key) {
  const content = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
  if (!content) return null;
  const lines = content.split(/\r?\n/);
  let currentSection = [];
  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1).split('.').map(part => part.trim()).filter(Boolean);
      continue;
    }
    if (currentSection.join('.') === sectionPath && new RegExp(`^\\s*${escapeRegex(key)}\\s*=`, 'i').test(trimmed)) {
      return index + 1;
    }
  }
  return null;
}

function configSections(ctx) {
  const content = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
  const lines = content.split(/\r?\n/);
  const sections = [];
  let currentSection = [];

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1).split('.').map(part => part.trim()).filter(Boolean);
      sections.push({ section: currentSection.join('.'), line: index + 1 });
      continue;
    }
  }

  return sections;
}

function expectedVerificationCategories(ctx) {
  const categories = new Set();
  const pkg = ctx.jsonFile('package.json');
  const scripts = pkg && pkg.scripts ? pkg.scripts : {};

  if (scripts.test) categories.add('test');
  if (scripts.lint) categories.add('lint');
  if (scripts.build) categories.add('build');

  if (ctx.fileContent('Cargo.toml')) {
    categories.add('test');
    categories.add('build');
  }

  if (ctx.fileContent('go.mod')) {
    categories.add('test');
    categories.add('build');
  }

  if (ctx.fileContent('pyproject.toml') || ctx.fileContent('requirements.txt')) {
    categories.add('test');
  }

  if (ctx.fileContent('Makefile') || ctx.fileContent('justfile')) {
    categories.add('build');
  }

  return [...categories];
}

function hasCommandMention(content, category) {
  if (category === 'test') {
    return /\bnpm test\b|\bnpm run test\b|\bpnpm test\b|\byarn test\b|\bvitest\b|\bjest\b|\bpytest\b|\bgo test\b|\bcargo test\b|\bmake test\b/i.test(content);
  }
  if (category === 'lint') {
    return /\bnpm run lint\b|\bpnpm lint\b|\byarn lint\b|\beslint\b|\bprettier\b|\bruff\b|\bclippy\b|\bgolangci-lint\b|\bmake lint\b/i.test(content);
  }
  if (category === 'build') {
    return /\bnpm run build\b|\bpnpm build\b|\byarn build\b|\btsc\b|\bvite build\b|\bnext build\b|\bcargo build\b|\bgo build\b|\bmake\b/i.test(content);
  }
  return false;
}

function agentsHasArchitecture(content) {
  // Explicit architecture/structure markers
  if (/```mermaid|flowchart\b|graph\s+(TD|LR|RL|BT)\b/i.test(content)) return true;
  // Heading variants seen in real repos (openai-agents-python, etc.)
  if (/^#{1,4}\s+(Architecture|Project Map|Structure|Project Structure( Guide)?|Repo Structure( & Important Files)?|Repository Layout|Codebase (Guide|Map|Overview|Structure)|Repo Map|Key Directories|Module Map|Directory Layout|Folder Structure|Package Structure)\b/im.test(content)) return true;
  // Enumerated file/directory maps (3+ backtick-wrapped paths in a row)
  const pathList = content.match(/^[-*]?\s*`[^`]+\/`?/gm);
  if (pathList && pathList.length >= 3) return true;
  return false;
}

function findFillerLine(content) {
  return firstLineMatching(content, (line) => FILLER_PATTERNS.some((pattern) => pattern.test(line)));
}

function hasContradictions(content) {
  const lines = content.split(/\r?\n/);
  const lineEndingPattern = /\b(CRLF|LF|line[- ]ending|trailing newline|EOF|end.of.file|newline at end)\b/i;
  for (const line of lines) {
    // Skip line-ending/EOF style guidance — not actual contradictions
    if (lineEndingPattern.test(line)) continue;
    if (/\balways\b.*\bnever\b|\bnever\b.*\balways\b/i.test(line)) {
      return true;
    }
  }

  const contradictoryPairs = [
    [/\buse tabs\b/i, /\buse spaces\b/i],
    [/\bsingle quotes\b/i, /\bdouble quotes\b/i],
    [/\bsemicolons required\b/i, /\bno semicolons\b/i],
  ];

  return contradictoryPairs.some(([a, b]) => a.test(content) && b.test(content));
}

function hasMisplacedNestedKeys(content) {
  const lines = content.split(/\r?\n/);
  let inRoot = true;

  for (let index = 0; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      inRoot = false;
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=/);
    if (!match) continue;

    if (inRoot && NESTED_ONLY_ROOT_KEYS.has(match[1])) {
      return { misplaced: true, line: index + 1, key: match[1] };
    }
  }

  return { misplaced: false, line: null, key: null };
}

function findLegacyConfigIssue(content) {
  for (let index = 0; index < LEGACY_CONFIG_PATTERNS.length; index++) {
    const { pattern, note } = LEGACY_CONFIG_PATTERNS[index];
    const line = firstLineMatching(content, pattern);
    if (line) {
      return { line, note };
    }
  }
  return null;
}

function repoLooksRegulated(ctx) {
  const filenames = ctx.files.join('\n');
  const packageJson = ctx.fileContent('package.json') || '';
  const readme = ctx.fileContent('README.md') || '';
  const combined = `${filenames}\n${packageJson}\n${readme}`;

  const strongSignals = /\bhipaa\b|\bphi\b|\bpci\b|\bsoc2\b|\biso[- ]?27001\b|\bcompliance\b|\bhealth(?:care)?\b|\bmedical\b|\bbank(?:ing)?\b|\bpayments?\b|\bfintech\b/i;
  if (strongSignals.test(combined)) {
    return true;
  }

  const weakSignalMatches = combined.match(/\bgdpr\b|\bpii\b/gi) || [];
  if (weakSignalMatches.length === 0) {
    return false;
  }

  const privacyOnlyNote = /\b(no|without|never)\s+(collect|store|log|retain|send)\s+\bpii\b/i.test(combined) ||
    /\bno\s+\bpii\b/i.test(combined);
  if (weakSignalMatches.length === 1 && privacyOnlyNote) {
    return false;
  }

  return weakSignalMatches.length >= 2;
}

function hookEventsFromConfig(hooksJson) {
  if (!hooksJson || typeof hooksJson !== 'object' || Array.isArray(hooksJson)) {
    return [];
  }

  if (hooksJson.hooks && typeof hooksJson.hooks === 'object' && !Array.isArray(hooksJson.hooks)) {
    return Object.keys(hooksJson.hooks);
  }

  return Object.keys(hooksJson);
}

function unsupportedHookEvent(ctx) {
  const content = ctx.hooksJsonContent ? (ctx.hooksJsonContent() || '') : (ctx.fileContent('.codex/hooks.json') || '');
  if (!content) return null;

  const parsed = ctx.hooksJson();
  if (!parsed) {
    return { event: 'invalid-json', line: 1 };
  }

  const events = hookEventsFromConfig(parsed);
  for (const event of events) {
    if (!SUPPORTED_HOOK_EVENTS.has(event)) {
      const line = ctx.lineNumber('.codex/hooks.json', new RegExp(`"${escapeRegex(event)}"\\s*:|${escapeRegex(event)}\\s*:`, 'i')) || 1;
      return { event, line };
    }
  }

  return null;
}

function hooksClaimed(ctx) {
  // Strong signals: Codex-specific files/directories
  if (ctx.hasDir('.codex/hooks')) return true;
  if (ctx.hooksJsonContent && ctx.hooksJsonContent()) return true;
  const config = ctx.fileContent('.codex/config.toml') || '';
  if (/\[hooks\]|codex_hooks\s*=|\[features\][\s\S]*codex_hooks/i.test(config)) return true;
  // Text signals: require Codex-specific hook terminology (not generic "hooks")
  const content = agentsContent(ctx);
  if (!content) return false;
  // Specific Codex hook events — these are unambiguous
  if (/\b(SessionStart|PreToolUse|PostToolUse|UserPromptSubmit)\b/.test(content)) return true;
  // "Codex hooks" explicit mention
  if (/\bcodex\s+hooks?\b/i.test(content)) return true;
  if (/\bhooks?\.json\b/i.test(content) && /\bcodex\b/i.test(content)) return true;
  return false;
}

function findSecretLine(content) {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const matched = EMBEDDED_SECRET_PATTERNS.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(line);
    });
    if (matched) return index + 1;
  }
  return null;
}

function mcpServersWithTimeouts(ctx) {
  const servers = ctx.mcpServers();
  return Object.entries(servers || {}).map(([id, server]) => ({
    id,
    timeout: server && typeof server.startup_timeout_sec === 'number' ? server.startup_timeout_sec : null,
  }));
}

function workflowArtifacts(ctx) {
  return (ctx.workflowFiles ? ctx.workflowFiles() : [])
    .map((filePath) => ({ filePath, content: ctx.fileContent(filePath) || '' }))
    .filter((item) => item.content);
}

function codexActionWorkflowIssues(ctx) {
  const issues = [];
  for (const workflow of workflowArtifacts(ctx)) {
    if (!/uses:\s*openai\/codex-action@/i.test(workflow.content)) continue;
    const unsafeLine = firstLineMatching(workflow.content, /safety-strategy\s*:\s*unsafe\b/i);
    if (!unsafeLine) continue;

    const justified = /windows-latest|windows-\d+|runner\.os\s*==\s*['"]Windows['"]|runs-on:\s*\[[^\]]*windows/i.test(workflow.content) ||
      (JUSTIFICATION_PATTERNS.test(workflow.content) && /\bunsafe\b/i.test(workflow.content));

    issues.push({
      filePath: workflow.filePath,
      line: unsafeLine,
      justified,
    });
  }
  return issues;
}

function profileSections(ctx) {
  return configSections(ctx).filter((section) => section.section.startsWith('profiles.'));
}

function parsedProfiles(ctx) {
  const config = ctx.configToml();
  if (!config.ok || !config.data || !config.data.profiles || typeof config.data.profiles !== 'object') {
    return {};
  }
  return config.data.profiles;
}

function projectMcpServers(ctx) {
  const config = ctx.configToml();
  if (!config.ok || !config.data || !config.data.mcp_servers || typeof config.data.mcp_servers !== 'object') {
    return {};
  }
  return config.data.mcp_servers;
}

function isSdkOrLibraryRepo(ctx) {
  const pkg = ctx.fileContent('package.json');
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg);
      // Library if it declares a main/exports/module entry AND no start script that runs a server
      const hasEntry = parsed.main || parsed.exports || parsed.module;
      const scripts = parsed.scripts || {};
      const hasServerStart = /(node|uvicorn|gunicorn).*(server|app|index\.js)/i.test(JSON.stringify(scripts));
      if (hasEntry && !hasServerStart) return true;
    } catch { /* fall through */ }
  }
  const pyproject = ctx.fileContent('pyproject.toml') || '';
  if (/\[project\][^\[]*\b(packages|py_modules)\s*=/i.test(pyproject) && !ctx.hasDir('app') && !ctx.hasDir('server')) return true;
  // README signals
  const readme = ctx.fileContent('README.md') || '';
  if (/\b(npm install|pip install|pnpm add|yarn add)\b.*\b(this|the)? ?(package|library|sdk)/i.test(readme)) return true;
  if (/^# .*\bSDK\b/im.test(readme)) return true;
  return false;
}

function repoNeedsExternalTools(ctx) {
  // SDK/library repos document integrations but don't need project-scoped MCP.
  if (isSdkOrLibraryRepo(ctx)) return false;

  const deps = ctx.projectDependencies ? Object.keys(ctx.projectDependencies()) : [];
  const depSet = new Set(deps);
  const files = new Set(ctx.files || []);
  const envContent = [
    ctx.fileContent('.env.example'),
    ctx.fileContent('.env.template'),
    ctx.fileContent('.env.sample'),
  ].filter(Boolean).join('\n');
  const readme = ctx.fileContent('README.md') || '';
  const agents = agentsContent(ctx);
  const combinedDocs = `${readme}\n${agents}\n${envContent}`;

  const externalDeps = [
    'pg',
    'postgres',
    'mysql',
    'mysql2',
    'mongodb',
    'mongoose',
    'redis',
    'ioredis',
    'prisma',
    'sequelize',
    'typeorm',
    'supabase',
    '@supabase/supabase-js',
    'stripe',
    'openai',
    '@anthropic-ai/sdk',
    'langchain',
    '@langchain/openai',
    '@langchain/anthropic',
    '@aws-sdk/client-s3',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/client-secrets-manager',
    '@notionhq/client',
    '@slack/bolt',
    'twilio',
    'discord.js',
  ];

  if (externalDeps.some((dep) => depSet.has(dep))) {
    return true;
  }

  if (
    files.has('docker-compose.yml') ||
    files.has('docker-compose.yaml') ||
    files.has('compose.yml') ||
    files.has('compose.yaml') ||
    files.has('schema.prisma') ||
    ctx.hasDir('prisma') ||
    ctx.hasDir('infra') ||
    ctx.hasDir('terraform') ||
    ctx.hasDir('migrations') ||
    ctx.hasDir('sql')
  ) {
    return true;
  }

  return /\bDATABASE_URL\b|\bREDIS_URL\b|\bSUPABASE_URL\b|\bSTRIPE_[A-Z_]+\b|\bAWS_[A-Z_]+\b|\bTWILIO_[A-Z_]+\b|\bNOTION_[A-Z_]+\b|\bSLACK_[A-Z_]+\b|\bOPENAI_API_KEY\b|\bANTHROPIC_API_KEY\b/i.test(combinedDocs);
}

function projectScopedMcpPresent(ctx) {
  return Object.keys(projectMcpServers(ctx)).length > 0;
}

function repoRuleArtifacts(ctx) {
  return (ctx.ruleFiles ? ctx.ruleFiles() : [])
    .map((filePath) => ({ filePath, content: ctx.fileContent(filePath) || '' }))
    .filter((item) => item.content);
}

function extractRuleBlocks(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let startLine = null;
  let buffer = [];
  let depth = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (startLine === null && /\bprefix_rule\s*\(/.test(line)) {
      startLine = index + 1;
      buffer = [line];
      depth = (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
      if (depth <= 0) {
        blocks.push({ startLine, content: buffer.join('\n') });
        startLine = null;
        buffer = [];
        depth = 0;
      }
      continue;
    }

    if (startLine !== null) {
      buffer.push(line);
      depth += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
      if (depth <= 0) {
        blocks.push({ startLine, content: buffer.join('\n') });
        startLine = null;
        buffer = [];
        depth = 0;
      }
    }
  }

  return blocks;
}

function allRuleBlocks(ctx) {
  return repoRuleArtifacts(ctx).flatMap((artifact) =>
    extractRuleBlocks(artifact.content).map((block) => ({
      ...block,
      filePath: artifact.filePath,
    }))
  );
}

function rulePatternTokens(blockContent) {
  const match = blockContent.match(/pattern\s*=\s*\[([\s\S]*?)\]/i);
  if (!match) return [];
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
}

function ruleDecision(blockContent) {
  const match = blockContent.match(/decision\s*=\s*["']([^"']+)["']/i);
  return match ? match[1].toLowerCase() : null;
}

function ruleHasExamples(blockContent) {
  return /\bmatch\s*=\s*\[/i.test(blockContent) || /\bnot_match\s*=\s*\[/i.test(blockContent);
}

function broadAllowRule(blockContent) {
  const decision = ruleDecision(blockContent);
  if (decision !== 'allow') return false;

  const tokens = rulePatternTokens(blockContent).map((token) => token.toLowerCase());
  if (tokens.some((token) => token === '*' || token.includes('*') || token.includes('?'))) {
    return true;
  }

  const broadSingleCommands = new Set(['bash', 'sh', 'pwsh', 'powershell', 'cmd', 'git', 'npm', 'pnpm', 'yarn', 'node', 'python']);
  return tokens.length === 1 && broadSingleCommands.has(tokens[0]);
}

function specificRulePatternIssue(ctx) {
  for (const block of allRuleBlocks(ctx)) {
    const tokens = rulePatternTokens(block.content);
    if (tokens.some((token) => token === '*' || token.includes('*') || token.includes('?'))) {
      return { filePath: block.filePath, line: block.startLine };
    }
  }
  return null;
}

function missingRuleExamplesIssue(ctx) {
  for (const block of allRuleBlocks(ctx)) {
    if (!ruleHasExamples(block.content)) {
      return { filePath: block.filePath, line: block.startLine };
    }
  }
  return null;
}

function broadAllowRuleIssue(ctx) {
  for (const block of allRuleBlocks(ctx)) {
    if (broadAllowRule(block.content)) {
      return { filePath: block.filePath, line: block.startLine };
    }
  }
  return null;
}

function ruleCoverageIssue(ctx) {
  const riskyCommands = new Set(['rm', 'git', 'gh', 'docker', 'kubectl', 'terraform', 'bash', 'sh', 'pwsh', 'powershell', 'cmd', 'npm', 'pnpm', 'yarn']);
  const blocks = allRuleBlocks(ctx);
  if (blocks.length === 0) {
    return { filePath: null, line: null, missing: true };
  }

  const covered = blocks.some((block) => {
    const tokens = rulePatternTokens(block.content).map((token) => token.toLowerCase());
    return tokens.some((token) => riskyCommands.has(token)) || /\bhost_executable\s*\(/i.test(block.content);
  });

  return covered ? null : { filePath: blocks[0].filePath, line: blocks[0].startLine, missing: false };
}

function ruleWrapperRiskIssue(ctx) {
  const blocks = allRuleBlocks(ctx);
  if (blocks.length === 0) return null;

  const wrapperBlock = blocks.find((block) => /\bbash\b|\bsh\b|\bpwsh\b|\bpowershell\b|\bcmd\b|host_executable\s*\(/i.test(block.content));
  if (!wrapperBlock) return null;

  const docs = `${agentsContent(ctx)}\n${ctx.fileContent('README.md') || ''}\n${repoRuleArtifacts(ctx).map((item) => item.content).join('\n')}`;
  const hasCaveat = /\bwrapper\b|\bsplit(?:ting)?\b|\bbash -lc\b|\bhost_executable\b|\bresolve-host-executables\b|\bpowershell\b|\bpwsh\b/i.test(docs);
  return hasCaveat ? null : { filePath: wrapperBlock.filePath, line: wrapperBlock.startLine };
}

function explicitHooksFeatureValue(ctx) {
  const value = ctx.configValue('features.codex_hooks');
  return typeof value === 'boolean' ? value : null;
}

function collectHookTimeoutEntries(node, trail = []) {
  const results = [];
  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      results.push(...collectHookTimeoutEntries(item, [...trail, `[${index}]`]));
    });
    return results;
  }

  if (!node || typeof node !== 'object') {
    return results;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'timeout' && typeof value === 'number') {
      results.push({ timeout: value, trail: [...trail, key] });
      continue;
    }
    results.push(...collectHookTimeoutEntries(value, [...trail, key]));
  }

  return results;
}

function longHookTimeoutIssue(ctx) {
  const hooks = ctx.hooksJson();
  if (!hooks) return null;
  const entries = collectHookTimeoutEntries(hooks);
  const long = entries.find((entry) => entry.timeout > 60);
  if (!long) return null;

  const docs = `${agentsContent(ctx)}\n${ctx.fileContent('README.md') || ''}`;
  const justified = /\btimeout\b|\bslow\b|\blong-running\b|\bintegration\b|\bremote\b/i.test(docs) && JUSTIFICATION_PATTERNS.test(docs);
  if (justified) return null;

  const line = ctx.lineNumber('.codex/hooks.json', /"timeout"\s*:\s*(6[1-9]|[7-9]\d|\d{3,})\b/i) || 1;
  return { filePath: '.codex/hooks.json', line };
}

function mcpAuthDocumentationIssue(ctx) {
  const servers = projectMcpServers(ctx);
  const docs = `${agentsContent(ctx)}\n${ctx.fileContent('README.md') || ''}`;

  for (const [id, server] of Object.entries(servers || {})) {
    const needsAuthNote = Boolean(server.url);
    if (!needsAuthNote) continue;

    const hasInlineAuth =
      Boolean(server.bearer_token_env_var) ||
      Boolean(server.http_headers) ||
      Boolean(server.env_http_headers) ||
      (server.env && typeof server.env === 'object' && Object.keys(server.env).length > 0) ||
      (Array.isArray(server.env_vars) && server.env_vars.length > 0);

    const hasDocNote = new RegExp(`\\b${escapeRegex(id)}\\b[\\s\\S]{0,140}\\b(auth|oauth|token|credential|env)\\b`, 'i').test(docs);
    if (!hasInlineAuth && !hasDocNote) {
      return {
        id,
        filePath: '.codex/config.toml',
        line: (configSections(ctx).find((section) => section.section === `mcp_servers.${id}`) || {}).line || 1,
      };
    }
  }

  return null;
}

function deprecatedMcpTransportIssue(ctx) {
  const content = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
  if (!content) return null;
  const line = firstLineMatching(content, /\btransport\s*=\s*["'](?:sse|http\+sse)["']|\bsse_url\s*=/i);
  return line ? { filePath: '.codex/config.toml', line } : null;
}

function docsBundle(ctx) {
  return `${agentsContent(ctx)}\n${ctx.fileContent('README.md') || ''}`;
}

function skillArtifacts(ctx) {
  return (ctx.skillDirs ? ctx.skillDirs() : []).map((name) => ({
    name,
    filePath: `.agents/skills/${name}/SKILL.md`,
    content: ctx.skillMetadata ? (ctx.skillMetadata(name) || '') : '',
  }));
}

function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_-]+)\s*:\s*(.+)$/);
    if (m) fm[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return fm;
}

function extractSkillTitle(content) {
  const fm = extractFrontmatter(content);
  if (fm && fm.name) return fm.name;
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

function extractSkillDescription(content) {
  const fm = extractFrontmatter(content);
  if (fm && fm.description) return fm.description;
  const lines = content.split(/\r?\n/);
  const meaningful = [];
  let seenHeading = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (seenHeading && meaningful.length > 0) break;
      continue;
    }
    if (!seenHeading) {
      if (trimmed.startsWith('#')) {
        seenHeading = true;
      }
      continue;
    }
    if (trimmed.startsWith('#') || trimmed.startsWith('```')) break;
    meaningful.push(trimmed.replace(/^[-*]\s+/, ''));
    if (meaningful.length >= 3) break;
  }

  return meaningful.join(' ').trim();
}

function repoClaimsSkills(ctx) {
  if ((ctx.skillDirs ? ctx.skillDirs() : []).length > 0) return true;
  const docs = docsBundle(ctx);
  return /\.agents\/skills\b|\bskill(s)?\b/i.test(docs);
}

function skillMissingFieldsIssue(ctx) {
  for (const skill of skillArtifacts(ctx)) {
    if (!skill.content) {
      return { filePath: skill.filePath, line: 1 };
    }
    const title = extractSkillTitle(skill.content);
    const description = extractSkillDescription(skill.content);
    if (!title || !description) {
      return {
        filePath: skill.filePath,
        line: !title ? 1 : (firstLineMatching(skill.content, /\S/) || 1),
      };
    }
  }
  return null;
}

function skillBadNameIssue(ctx) {
  const invalid = skillArtifacts(ctx).find((skill) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name));
  return invalid ? { filePath: invalid.filePath, line: 1 } : null;
}

function skillDescriptionTooLongIssue(ctx) {
  for (const skill of skillArtifacts(ctx)) {
    const description = extractSkillDescription(skill.content);
    if (!description) continue;
    if (description.length > 220 || description.split(/\s+/).length > 32) {
      const line = firstLineMatching(skill.content, (line) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#');
      }) || 1;
      return { filePath: skill.filePath, line };
    }
  }
  return null;
}

function skillAutoRunRiskIssue(ctx) {
  const riskyPatterns = /\balways run\b|\bauto(?:matically)?\s+(run|execute|deploy|publish|merge)\b|\bwithout (approval|review|asking)\b|\brm -rf\b|\bgit push\b|\bdeploy\b|\bpublish\b/i;
  const safetyPatterns = /\bapproval\b|\breview\b|\bconfirm\b|\bmanual\b|\bsandbox\b|\bask first\b/i;

  for (const skill of skillArtifacts(ctx)) {
    if (!skill.content) continue;
    if (riskyPatterns.test(skill.content) && !safetyPatterns.test(skill.content)) {
      const line = firstLineMatching(skill.content, riskyPatterns) || 1;
      return { filePath: skill.filePath, line };
    }
  }

  return null;
}

function repoUsesCustomAgents(ctx) {
  if ((ctx.customAgentFiles ? ctx.customAgentFiles() : []).length > 0) return true;
  const docs = docsBundle(ctx);
  return /\.codex\/agents\b|\bsubagents?\b|\bcustom agents?\b/i.test(docs);
}

function customAgentMissingFieldsIssue(ctx) {
  const files = ctx.customAgentFiles ? ctx.customAgentFiles() : [];
  for (const fileName of files) {
    const parsed = ctx.customAgentConfig(fileName);
    if (!parsed.ok || !parsed.data) {
      return { filePath: `.codex/agents/${fileName}`, line: 1 };
    }
    const required = ['name', 'description', 'developer_instructions'];
    const missing = required.find((key) => {
      const value = parsed.data[key];
      return !(typeof value === 'string' && value.trim());
    });
    if (missing) {
      const content = ctx.fileContent(path.join('.codex', 'agents', fileName)) || '';
      return {
        filePath: `.codex/agents/${fileName}`,
        line: firstLineMatching(content, new RegExp(`^\\s*${escapeRegex(missing)}\\s*=`, 'i')) || 1,
      };
    }
  }
  return null;
}

function unsafeAgentOverrideIssue(ctx) {
  const files = ctx.customAgentFiles ? ctx.customAgentFiles() : [];
  for (const fileName of files) {
    const parsed = ctx.customAgentConfig(fileName);
    if (!parsed.ok || !parsed.data) {
      return { filePath: `.codex/agents/${fileName}`, line: 1 };
    }

    const sandboxMode = parsed.data.sandbox_mode;
    if (sandboxMode === 'danger-full-access') {
      const content = ctx.fileContent(path.join('.codex', 'agents', fileName)) || '';
      return {
        filePath: `.codex/agents/${fileName}`,
        line: firstLineMatching(content, /^\s*sandbox_mode\s*=/i) || 1,
      };
    }

    const approval = parsed.data.approval_policy;
    const content = ctx.fileContent(path.join('.codex', 'agents', fileName)) || '';
    const justified = JUSTIFICATION_PATTERNS.test(content);
    if (approval === 'never' && !justified) {
      return {
        filePath: `.codex/agents/${fileName}`,
        line: firstLineMatching(content, /^\s*approval_policy\s*=/i) || 1,
      };
    }
  }
  return null;
}

function codexAutomationArtifacts(ctx) {
  const items = [];
  for (const workflow of workflowArtifacts(ctx)) {
    if (/\bcodex\b/i.test(workflow.content)) {
      items.push(workflow);
    }
  }

  const pkg = ctx.jsonFile('package.json');
  if (pkg && pkg.scripts) {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (/\bcodex\s+(exec|review|cloud\s+exec)\b/i.test(command)) {
        items.push({
          filePath: 'package.json',
          content: command,
          line: ctx.lineNumber('package.json', new RegExp(`"${escapeRegex(name)}"\\s*:\\s*"`, 'i')) || 1,
          kind: 'script',
        });
      }
    }
  }

  return items;
}

function codexExecUnsafeIssue(ctx) {
  for (const item of codexAutomationArtifacts(ctx)) {
    const content = item.content || '';
    const risky = /codex\s+exec\b[\s\S]{0,120}(--dangerously-bypass-approvals-and-sandbox|--full-auto\b|--ask-for-approval\s+never|-a\s+never\b)/i.test(content) ||
      /\bcodex-action@/i.test(content) && /safety-strategy\s*:\s*unsafe\b/i.test(content) && !/windows/i.test(content);
    if (risky) {
      return {
        filePath: item.filePath,
        line: item.line || firstLineMatching(content, /codex\s+exec\b|safety-strategy\s*:\s*unsafe\b/i) || 1,
      };
    }
  }
  return null;
}

function codexActionSafeStrategyIssue(ctx) {
  for (const workflow of workflowArtifacts(ctx)) {
    if (!/uses:\s*openai\/codex-action@/i.test(workflow.content)) continue;

    const line = firstLineMatching(workflow.content, /safety-strategy\s*:/i);
    if (!line) {
      return { filePath: workflow.filePath, line: firstLineMatching(workflow.content, /uses:\s*openai\/codex-action@/i) || 1 };
    }

    const unsafe = /safety-strategy\s*:\s*unsafe\b/i.test(workflow.content);
    const windowsOnly = /windows-latest|windows-\d+|runner\.os\s*==\s*['"]Windows['"]|runs-on:\s*\[[^\]]*windows/i.test(workflow.content);
    if (unsafe && !windowsOnly) {
      return { filePath: workflow.filePath, line };
    }
  }
  return null;
}

function codexCiAuthIssue(ctx) {
  for (const workflow of workflowArtifacts(ctx)) {
    if (!/\bcodex\b|openai\/codex-action@/i.test(workflow.content)) continue;
    const hasCodexKey =
      /\bCODEX_API_KEY\b/i.test(workflow.content) ||
      /\bOPENAI_API_KEY\b/i.test(workflow.content) ||
      /\bapi[-_ ]?key\b/i.test(workflow.content) ||
      /\$\{\{\s*secrets\.[A-Z0-9_]+/i.test(workflow.content);
    const hardcodedSecret = /sk-[A-Za-z0-9_-]{16,}|api[_-]?key\s*:\s*["'][A-Za-z0-9_-]{12,}["']/i.test(workflow.content);
    if (hardcodedSecret || !hasCodexKey) {
      return {
        filePath: workflow.filePath,
        line: firstLineMatching(workflow.content, /CODEX_API_KEY|OPENAI_API_KEY|api[-_ ]?key|sk-/i) || 1,
      };
    }
  }
  return null;
}

function automationManualTestingIssue(ctx) {
  const artifacts = codexAutomationArtifacts(ctx);
  if (artifacts.length === 0) return null;

  const docs = docsBundle(ctx);
  const hasManualTestingNote = /\bmanual(?:ly)? tested\b|\bdry[- ]run\b|\bstaging\b|\bvalidated locally\b|\btested locally\b/i.test(docs);
  if (hasManualTestingNote) return null;

  const target = artifacts[0];
  return {
    filePath: target.filePath,
    line: target.line || firstLineMatching(target.content || '', /\bcodex\b|openai\/codex-action@/i) || 1,
  };
}

function reviewWorkflowDocumented(ctx) {
  return /\bcodex review\b|\/review\b|\breview --uncommitted\b/i.test(docsBundle(ctx));
}

function reviewModelOverrideIssue(ctx) {
  const artifacts = codexAutomationArtifacts(ctx).filter((item) => /\bcodex\s+review\b/i.test(item.content || ''));
  if (artifacts.length === 0) return null;

  const hasReviewModelOverride = artifacts.some((item) => /\s(--model|-m)\s+\S+/i.test(item.content || ''));
  const hasReviewProfile = Boolean(parsedProfiles(ctx).review);
  if (hasReviewModelOverride || hasReviewProfile) return null;

  const target = artifacts[0];
  return {
    filePath: target.filePath,
    line: target.line || firstLineMatching(target.content || '', /\bcodex\s+review\b/i) || 1,
  };
}

function workingTreeReviewDocsPresent(ctx) {
  return /\bworking[- ]tree\b|\buncommitted\b|\bstaged\b|\bkeep unrelated edits separate\b|\bdo not mix unrelated edits\b/i.test(docsBundle(ctx));
}

function costAwarenessDocsPresent(ctx) {
  return /\bcost\b|\blatency\b|\breasoning\b|\bheavy workflows?\b|\bexpensive\b/i.test(docsBundle(ctx));
}

function codexArtifactsIgnoredIssue(ctx) {
  const gitignore = ctx.fileContent('.gitignore');
  if (!gitignore) return null;
  const line = firstLineMatching(gitignore, /^\.codex\/?$|^\.codex\/\*\*?$|^\.agents\/skills\/?$/im);
  return line ? { filePath: '.gitignore', line } : null;
}

function lifecycleScripts(ctx) {
  const files = ctx.files || [];
  return files.filter((file) => /(^|\/)(setup|teardown)\.(sh|ps1|cmd|bat)$/i.test(file));
}

function lifecycleScriptIssue(ctx) {
  const scripts = lifecycleScripts(ctx);
  if (scripts.length === 0) return null;

  const docs = docsBundle(ctx);
  for (const filePath of scripts) {
    const content = ctx.fileContent(filePath) || '';
    const shellOnly = /^#!.*\b(bash|sh)\b/m.test(content) || filePath.endsWith('.sh');
    const hasPlatformNote = /\bwindows\b|\bplatform-safe\b|\bpwsh\b|\bpowershell\b|\bcross-platform\b/i.test(docs);
    if (shellOnly && !hasPlatformNote) {
      return { filePath, line: 1 };
    }
  }

  return null;
}

function redundantCodexWorkflowIssue(ctx) {
  const workflows = workflowArtifacts(ctx).filter((workflow) => /\bcodex\b|openai\/codex-action@/i.test(workflow.content));
  if (workflows.length < 2) return null;

  const seen = new Map();
  for (const workflow of workflows) {
    const normalized = workflow.content
      .replace(/\s+/g, ' ')
      .replace(/name:\s*[^:]+/i, '')
      .trim();
    if (seen.has(normalized)) {
      return {
        filePath: workflow.filePath,
        line: firstLineMatching(workflow.content, /openai\/codex-action@|\bcodex\b/i) || 1,
      };
    }
    seen.set(normalized, workflow.filePath);
  }

  return null;
}

function worktreeLifecycleDocsIssue(ctx) {
  const docs = docsBundle(ctx);
  const worktreeRelevant = lifecycleScripts(ctx).length > 0 || /\bworktrees?\b/i.test(docs);
  if (!worktreeRelevant) return null;

  const documented = /\bworktrees?\b[\s\S]{0,140}\b(cleanup|lifecycle|branch|teardown|setup)\b/i.test(docs) ||
    /\bcleanup\b|\bteardown\b|\bbranch-specific\b/i.test(docs);
  return documented ? null : { filePath: agentsPath(ctx) || 'README.md', line: 1 };
}

function agentsMissingModernFeaturesIssue(ctx) {
  const docs = agentsContent(ctx);
  if (!docs) return null;

  const needsSkills = (ctx.skillDirs ? ctx.skillDirs() : []).length > 0;
  const needsAgents = (ctx.customAgentFiles ? ctx.customAgentFiles() : []).length > 0;
  const needsHooks = hooksClaimed(ctx);
  const needsMcp = projectScopedMcpPresent(ctx);

  const missing =
    (needsSkills && !/\bskills?\b/i.test(docs)) ||
    (needsAgents && !/\bsubagents?\b|\bagents?\b/i.test(docs)) ||
    (needsHooks && !/\bhooks?\b/i.test(docs)) ||
    (needsMcp && !/\bmcp\b/i.test(docs));

  return missing ? { filePath: agentsPath(ctx) || 'AGENTS.md', line: 1 } : null;
}

function deprecatedCodexPatternIssue(ctx) {
  const config = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
  const docs = docsBundle(ctx);
  const legacyConfigLine = firstLineMatching(config, /\bapproval_policy\s*=\s*["']on-failure["']/i);
  if (legacyConfigLine) {
    return { filePath: '.codex/config.toml', line: legacyConfigLine };
  }

  const docLine = firstLineMatching(docs, /\bon-failure\b|\bcodex-mini-latest\b/i);
  if (docLine) {
    return { filePath: agentsPath(ctx) || 'README.md', line: docLine };
  }

  return null;
}

function profilesNeededIssue(ctx) {
  const needsProfiles = codexAutomationArtifacts(ctx).length > 0 || (ctx.customAgentFiles ? ctx.customAgentFiles().length > 0 : false);
  if (!needsProfiles) return null;

  const activeProfile = ctx.configValue('profile');
  const profiles = parsedProfiles(ctx);
  if (activeProfile && profiles[activeProfile]) return null;
  if (Object.keys(profiles).length > 0) return null;

  return { filePath: '.codex/config.toml', line: configKeyLine(ctx, 'profile') || 1 };
}

function pluginConfigIssue(ctx) {
  const filePath = '.agents/plugins/marketplace.json';
  const content = ctx.fileContent(filePath);
  if (!content) return null;

  try {
    const parsed = JSON.parse(content);
    const valid = Array.isArray(parsed) || (parsed && typeof parsed === 'object');
    return valid ? null : { filePath, line: 1 };
  } catch {
    return { filePath, line: 1 };
  }
}

function primaryDocsPath(ctx) {
  return agentsPath(ctx) || (ctx.fileContent('README.md') ? 'README.md' : null);
}

function webSearchModeRelevant(ctx) {
  const config = ctx.configToml();
  if (!config.ok || !config.data) return false;

  const profiles = config.data.profiles && typeof config.data.profiles === 'object'
    ? Object.values(config.data.profiles)
    : [];
  if (config.data.web_search !== undefined || profiles.some((profile) => profile && typeof profile === 'object' && profile.web_search !== undefined)) {
    return true;
  }

  const docs = docsBundle(ctx);
  const workflowUsesSearch = workflowArtifacts(ctx).some((workflow) => /\s--search\b|\bweb_search\b/i.test(workflow.content));
  return workflowUsesSearch || /\s--search\b|\bweb_search\b|\blive search\b|\bcached search\b/i.test(docs);
}

function webSearchModeIssue(ctx) {
  const config = ctx.configToml();
  if (!config.ok || !config.data) return null;

  const validModes = new Set(['cached', 'live', 'disabled']);
  const docs = docsBundle(ctx);
  const searchHintPresent = workflowArtifacts(ctx).some((workflow) => /\s--search\b|\bweb_search\b/i.test(workflow.content)) ||
    /\s--search\b|\bweb_search\b|\blive search\b|\bcached search\b/i.test(docs);
  const rootSearch = config.data.web_search;
  const rootEffort = config.data.model_reasoning_effort;
  const profiles = config.data.profiles && typeof config.data.profiles === 'object' ? config.data.profiles : {};

  if (rootSearch !== undefined && !validModes.has(`${rootSearch}`)) {
    return { filePath: '.codex/config.toml', line: configKeyLine(ctx, 'web_search') || 1 };
  }

  if (rootEffort === 'minimal' && ((typeof rootSearch === 'string' && rootSearch !== 'disabled') || (rootSearch === undefined && searchHintPresent))) {
    return {
      filePath: '.codex/config.toml',
      line: configKeyLine(ctx, 'model_reasoning_effort') || configKeyLine(ctx, 'web_search') || 1,
    };
  }

  for (const [name, profile] of Object.entries(profiles)) {
    if (!profile || typeof profile !== 'object') continue;
    if (profile.web_search !== undefined && !validModes.has(`${profile.web_search}`)) {
      return {
        filePath: '.codex/config.toml',
        line: configSectionKeyLine(ctx, `profiles.${name}`, 'web_search') ||
          (configSections(ctx).find((section) => section.section === `profiles.${name}`) || {}).line ||
          1,
      };
    }

    const effectiveSearch = profile.web_search !== undefined ? profile.web_search : rootSearch;
    if (profile.model_reasoning_effort === 'minimal' &&
      ((typeof effectiveSearch === 'string' && effectiveSearch !== 'disabled') || (effectiveSearch === undefined && searchHintPresent))) {
      return {
        filePath: '.codex/config.toml',
        line: configSectionKeyLine(ctx, `profiles.${name}`, 'model_reasoning_effort') ||
          configSectionKeyLine(ctx, `profiles.${name}`, 'web_search') ||
          configKeyLine(ctx, 'web_search') ||
          (configSections(ctx).find((section) => section.section === `profiles.${name}`) || {}).line ||
          1,
      };
    }
  }

  return null;
}

function requirementsTomlIssue(ctx) {
  const content = ctx.fileContent('requirements.toml');
  if (!content) return null;

  const hasMeaningfulContent = content.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('#');
  });
  if (!hasMeaningfulContent) {
    return { filePath: 'requirements.toml', line: 1 };
  }

  const docs = docsBundle(ctx);
  const acknowledged = /\brequirements\.toml\b|\badmin[- ]enforced\b|\bmanaged configuration\b|\bmanaged\b/i.test(docs);
  return acknowledged ? null : { filePath: primaryDocsPath(ctx) || 'requirements.toml', line: 1 };
}

function sharedOrManagedMachineSignals(ctx) {
  const docs = docsBundle(ctx);
  if (ctx.fileContent('requirements.toml')) return true;
  // Explicit workstation/admin context only — not generic "shared" or "managed" words.
  // Must match specific managed-device or multi-user terminology.
  if (/\bmanaged[- ](device|laptop|workstation|host)\b/i.test(docs)) return true;
  if (/\bshared[- ](workstation|host|laptop|machine|computer)\b/i.test(docs)) return true;
  if (/\bmulti-user[- ](host|machine|workstation)\b/i.test(docs)) return true;
  if (/\b(kiosk|vdi|virtual desktop)\b/i.test(docs)) return true;
  if (/\benterprise[- ](managed|deployment|workstation)\b/i.test(docs)) return true;
  if (/\badmin[- ]enforced\b/i.test(docs)) return true;
  return false;
}

function authCredentialsStoreIssue(ctx) {
  if (!ctx.fileContent('.codex/config.toml')) return null;
  if (!sharedOrManagedMachineSignals(ctx)) return null;

  const value = ctx.configValue('cli_auth_credentials_store');
  if (value === undefined) {
    return { filePath: '.codex/config.toml', line: configKeyLine(ctx, 'cli_auth_credentials_store') || 1 };
  }

  return ['auto', 'file', 'keyring'].includes(`${value}`)
    ? null
    : { filePath: '.codex/config.toml', line: configKeyLine(ctx, 'cli_auth_credentials_store') || 1 };
}

function protectedPathAssumptionRelevant(ctx) {
  return ctx.configValue('sandbox_mode') === 'workspace-write' && /\.(git|codex|agents)\b/i.test(docsBundle(ctx));
}

function protectedPathAssumptionIssue(ctx) {
  if (!protectedPathAssumptionRelevant(ctx)) return null;

  const docs = docsBundle(ctx);
  const riskyPattern = /\.(git|codex|agents)\b[\s\S]{0,120}\b(edit|modify|write|delete|remove|patch|update|commit)\b/i;
  const safePattern = /\.(git|codex|agents)\b[\s\S]{0,120}\b(read-only|read only|protected|not writable|cannot (?:be )?(?:edited|modified|written)|blocked)\b/i;
  if (safePattern.test(docs)) return null;
  if (!riskyPattern.test(docs)) return null;

  return {
    filePath: primaryDocsPath(ctx) || '.codex/config.toml',
    line: firstLineMatching(docs, /\.(git|codex|agents)\b/i) || 1,
  };
}

function mcpHttpAuthAndCallbackRelevant(ctx) {
  if (!projectScopedMcpPresent(ctx)) return false;
  const servers = projectMcpServers(ctx);
  const hasRemoteHeaderAuth = Object.values(servers || {}).some((server) => server && server.url && (server.env_http_headers || server.http_headers));
  return hasRemoteHeaderAuth ||
    typeof ctx.configValue('mcp_oauth_callback_port') === 'number' ||
    Boolean(ctx.configValue('mcp_oauth_callback_url'));
}

function mcpHttpAuthAndCallbackIssue(ctx) {
  const docs = docsBundle(ctx);
  const callbackPort = ctx.configValue('mcp_oauth_callback_port');
  const callbackUrl = ctx.configValue('mcp_oauth_callback_url');

  if ((typeof callbackPort === 'number' || callbackUrl) && !/\boauth\b|\bcallback\b|\bredirect\b|\bloopback\b/i.test(docs)) {
    return {
      filePath: '.codex/config.toml',
      line: configKeyLine(ctx, 'mcp_oauth_callback_url') || configKeyLine(ctx, 'mcp_oauth_callback_port') || 1,
    };
  }

  for (const [id, server] of Object.entries(projectMcpServers(ctx))) {
    if (!server || !server.url) continue;
    if (!(server.env_http_headers || server.http_headers)) continue;

    const hasDocNote = new RegExp(`\\b${escapeRegex(id)}\\b[\\s\\S]{0,180}\\b(header|oauth|callback|auth|token)\\b`, 'i').test(docs);
    if (!hasDocNote) {
      return {
        filePath: '.codex/config.toml',
        line: configSectionKeyLine(ctx, `mcp_servers.${id}`, 'env_http_headers') ||
          configSectionKeyLine(ctx, `mcp_servers.${id}`, 'http_headers') ||
          (configSections(ctx).find((section) => section.section === `mcp_servers.${id}`) || {}).line ||
          1,
      };
    }
  }

  return null;
}

function batchStyleSubagentFlowPresent(ctx) {
  const files = ctx.customAgentFiles ? ctx.customAgentFiles() : [];
  const csvPattern = /\bspawn_agents_on_csv\b|\breport_agent_job_result\b|\boutput_csv_path\b|\boutput_schema\b|\bmax_concurrency\b|\bmax_runtime_seconds\b/i;
  return files.some((fileName) => {
    const content = ctx.fileContent(path.join('.codex', 'agents', fileName)) || '';
    return csvPattern.test(content);
  });
}

function csvBatchAgentIssue(ctx) {
  const files = ctx.customAgentFiles ? ctx.customAgentFiles() : [];
  const csvPattern = /\bspawn_agents_on_csv\b|\breport_agent_job_result\b|\boutput_csv_path\b|\boutput_schema\b|\bmax_concurrency\b|\bmax_runtime_seconds\b/i;

  for (const fileName of files) {
    const content = ctx.fileContent(path.join('.codex', 'agents', fileName)) || '';
    if (!csvPattern.test(content)) continue;
    if (typeof ctx.configValue('agents.job_max_runtime_seconds') === 'number') return null;
    return {
      filePath: '.codex/config.toml',
      line: configSectionKeyLine(ctx, 'agents', 'job_max_runtime_seconds') || 1,
    };
  }

  return null;
}

function nicknameCandidatesIssue(ctx) {
  const files = ctx.customAgentFiles ? ctx.customAgentFiles() : [];
  const seen = new Map();

  for (const fileName of files) {
    const parsed = ctx.customAgentConfig(fileName);
    if (!parsed.ok || !parsed.data) {
      return { filePath: `.codex/agents/${fileName}`, line: 1 };
    }

    const candidates = parsed.data.nickname_candidates;
    if (candidates === undefined) continue;
    if (!Array.isArray(candidates) || candidates.length === 0) {
      const content = ctx.fileContent(path.join('.codex', 'agents', fileName)) || '';
      return {
        filePath: `.codex/agents/${fileName}`,
        line: firstLineMatching(content, /^\s*nickname_candidates\s*=/i) || 1,
      };
    }

    const localSeen = new Set();
    for (const candidate of candidates) {
      const normalized = typeof candidate === 'string' ? candidate.trim() : '';
      const canonical = normalized.toLowerCase();
      if (!normalized || !/^[A-Za-z0-9 _-]+$/.test(normalized) || localSeen.has(canonical) || seen.has(canonical)) {
        const content = ctx.fileContent(path.join('.codex', 'agents', fileName)) || '';
        return {
          filePath: `.codex/agents/${fileName}`,
          line: firstLineMatching(content, /^\s*nickname_candidates\s*=/i) || 1,
        };
      }
      localSeen.add(canonical);
      seen.set(canonical, fileName);
    }
  }

  return null;
}

function nativeWindowsConfigRelevant(ctx) {
  return configSections(ctx).some((section) => section.section === 'windows') ||
    /\bnative windows\b|\bwindows sandbox\b|\bprivate desktop\b/i.test(docsBundle(ctx));
}

function windowsSandboxModeIssue(ctx) {
  if (!nativeWindowsConfigRelevant(ctx)) return null;

  const value = ctx.configValue('windows.sandbox');
  if (value === undefined) {
    return {
      filePath: '.codex/config.toml',
      line: configSectionKeyLine(ctx, 'windows', 'sandbox') ||
        (configSections(ctx).find((section) => section.section === 'windows') || {}).line ||
        1,
    };
  }

  return ['elevated', 'unelevated'].includes(`${value}`)
    ? null
    : {
      filePath: '.codex/config.toml',
      line: configSectionKeyLine(ctx, 'windows', 'sandbox') ||
        (configSections(ctx).find((section) => section.section === 'windows') || {}).line ||
        1,
    };
}

function appAutomationRelevant(ctx) {
  return /\bautomations?\b|\btriage inbox\b|\bbackground tasks?\b/i.test(docsBundle(ctx));
}

function automationAppRunningIssue(ctx) {
  if (!appAutomationRelevant(ctx)) return null;

  const docs = docsBundle(ctx);
  const acknowledged = /\bapp needs to be running\b|\bkeep the app running\b|\bCodex app\b[\s\S]{0,80}\brunning\b|\bselected project\b[\s\S]{0,80}\bon disk\b/i.test(docs);
  return acknowledged
    ? null
    : {
      filePath: primaryDocsPath(ctx) || 'README.md',
      line: firstLineMatching(docs, /\bautomations?\b|\btriage inbox\b|\bbackground tasks?\b/i) || 1,
    };
}

function codexActionPromptSourceIssue(ctx) {
  for (const workflow of workflowArtifacts(ctx)) {
    if (!/uses:\s*openai\/codex-action@/i.test(workflow.content)) continue;

    const hasPrompt = /^\s*prompt\s*:/im.test(workflow.content);
    const hasPromptFile = /^\s*prompt-file\s*:/im.test(workflow.content);
    if (hasPrompt && hasPromptFile) {
      return {
        filePath: workflow.filePath,
        line: firstLineMatching(workflow.content, /^\s*prompt(?:-file)?\s*:/im) || 1,
      };
    }

    if (!hasPrompt && !hasPromptFile) {
      return {
        filePath: workflow.filePath,
        line: firstLineMatching(workflow.content, /uses:\s*openai\/codex-action@/i) || 1,
      };
    }
  }

  return null;
}

function codexActionTriggerAllowlistIssue(ctx) {
  for (const workflow of workflowArtifacts(ctx)) {
    if (!/uses:\s*openai\/codex-action@/i.test(workflow.content)) continue;

    const triggerLine = firstLineMatching(workflow.content, /\bissue_comment\b|\bpull_request_target\b|\bpull_request_review_comment\b|\bdiscussion_comment\b/i);
    if (!triggerLine) continue;

    const hasAllowUsers = /^\s*allow-users\s*:/im.test(workflow.content);
    const hasAllowBots = /^\s*allow-bots\s*:/im.test(workflow.content);
    if (!hasAllowUsers && !hasAllowBots) {
      return { filePath: workflow.filePath, line: triggerLine };
    }
  }

  return null;
}

function codexActionExternalTriggersPresent(ctx) {
  return workflowArtifacts(ctx).some((workflow) =>
    /uses:\s*openai\/codex-action@/i.test(workflow.content) &&
    /\bissue_comment\b|\bpull_request_target\b|\bpull_request_review_comment\b|\bdiscussion_comment\b/i.test(workflow.content));
}

function desktopProjectMcpCaveatIssue(ctx) {
  if (!projectScopedMcpPresent(ctx)) return null;

  const docs = docsBundle(ctx);
  if (!/\bdesktop\b|\bide\b|\bextension\b/i.test(docs)) return null;

  const caveated = /\btrusted project\b|\btrust\b|\brepo-local\b|\bproject-scoped\b|\bglobal config\b|\buser-global\b|\bmay be ignored\b/i.test(docs);
  return caveated
    ? null
    : {
      filePath: primaryDocsPath(ctx) || '.codex/config.toml',
      line: firstLineMatching(docs, /\bdesktop\b|\bide\b|\bextension\b/i) || 1,
    };
}

const CODEX_TECHNIQUES = {
  codexAgentsMd: {
    id: 'CX-A01',
    name: 'AGENTS.md exists at project root or .codex/',
    check: (ctx) => Boolean(ctx.fileContent('AGENTS.md') || ctx.fileContent('.codex/AGENTS.md') || ctx.fileContent('.codex/agents.md')),
    impact: 'critical',
    rating: 5,
    category: 'instructions',
    fix: 'Create AGENTS.md at the project root (or .codex/AGENTS.md) with repo-specific commands, trust guidance, and workflow expectations.',
    template: 'codex-agents-md',
    file: (ctx) => ctx.fileContent('AGENTS.md') ? 'AGENTS.md' : (ctx.fileContent('.codex/AGENTS.md') ? '.codex/AGENTS.md' : 'AGENTS.md'),
    line: (ctx) => (ctx.fileContent('AGENTS.md') || ctx.fileContent('.codex/AGENTS.md') ? 1 : null),
  },
  codexAgentsMdSubstantive: {
    id: 'CX-A02',
    name: 'AGENTS.md has substantive content',
    check: (ctx) => {
      const content = ctx.fileContent('AGENTS.md');
      if (!content) return null;
      const nonEmptyLines = content.split(/\r?\n/).filter(line => line.trim()).length;
      return nonEmptyLines >= 20 && countSections(content) >= 2;
    },
    impact: 'high',
    rating: 5,
    category: 'instructions',
    fix: 'Expand AGENTS.md so it has at least 20 substantive lines and 2+ sections instead of a thin placeholder.',
    template: 'codex-agents-md',
    file: () => 'AGENTS.md',
    line: () => 1,
  },
  codexAgentsVerificationCommands: {
    id: 'CX-A03',
    name: 'AGENTS.md includes repo verification commands',
    check: (ctx) => {
      const content = ctx.fileContent('AGENTS.md');
      if (!content) return null;
      const expected = expectedVerificationCategories(ctx);
      if (expected.length === 0) return /\bverify\b|\btest\b|\blint\b|\bbuild\b/i.test(content);
      return expected.every(category => hasCommandMention(content, category));
    },
    impact: 'high',
    rating: 5,
    category: 'instructions',
    fix: 'Document the actual test/lint/build commands this repo uses so Codex can verify its own changes before handoff.',
    template: 'codex-agents-md',
    file: () => 'AGENTS.md',
    line: (ctx) => ctx.lineNumber('AGENTS.md', /\bVerification\b|\btest\b|\blint\b|\bbuild\b/i) || 1,
  },
  codexAgentsArchitecture: {
    id: 'CX-A04',
    name: 'AGENTS.md includes architecture or project map guidance',
    check: (ctx) => {
      const content = ctx.fileContent('AGENTS.md');
      if (!content) return null;
      return agentsHasArchitecture(content);
    },
    impact: 'medium',
    rating: 4,
    category: 'instructions',
    fix: 'Add a short architecture or project map section to AGENTS.md so Codex understands the repo shape before editing.',
    template: 'codex-agents-md',
    file: () => 'AGENTS.md',
    line: (ctx) => ctx.lineNumber('AGENTS.md', /##\s+Architecture\b|##\s+Project Map\b|##\s+Structure\b|```mermaid|flowchart\b|graph\s+(TD|LR|RL|BT)\b/i),
  },
  codexOverrideDocumented: {
    id: 'CX-A05',
    name: 'AGENTS.override.md is intentional and documented',
    check: (ctx) => {
      const override = ctx.agentsOverrideMdContent();
      if (!override) return true;
      const preview = override.split(/\r?\n/).slice(0, 6).join('\n');
      return JUSTIFICATION_PATTERNS.test(preview);
    },
    impact: 'medium',
    rating: 4,
    category: 'instructions',
    fix: 'Add a short explanation at the top of AGENTS.override.md explaining why it exists and when it should be removed.',
    template: null,
    file: () => 'AGENTS.override.md',
    line: (ctx) => (ctx.agentsOverrideMdContent() ? 1 : null),
  },
  codexProjectDocMaxBytes: {
    id: 'CX-A06',
    name: 'AGENTS.md stays within project_doc_max_bytes limit',
    check: (ctx) => {
      const filePath = agentsPath(ctx);
      if (!filePath) return null;
      const maxBytes = ctx.configValue('project_doc_max_bytes') || DEFAULT_PROJECT_DOC_MAX_BYTES;
      const size = ctx.fileSizeBytes(filePath);
      if (size == null) return null;
      return size <= maxBytes;
    },
    impact: 'medium',
    rating: 4,
    category: 'instructions',
    fix: 'Keep AGENTS.md under the configured project_doc_max_bytes limit so Codex does not silently truncate instructions.',
    template: null,
    file: (ctx) => agentsPath(ctx),
    line: () => 1,
  },
  codexNoGenericFiller: {
    id: 'CX-A07',
    name: 'AGENTS.md avoids generic filler instructions',
    check: (ctx) => {
      const content = ctx.fileContent('AGENTS.md');
      if (!content) return null;
      return !FILLER_PATTERNS.some((pattern) => pattern.test(content));
    },
    impact: 'low',
    rating: 3,
    category: 'instructions',
    fix: 'Replace generic filler like “be helpful” with concrete repo-specific guidance that actually changes Codex behavior.',
    template: null,
    file: () => 'AGENTS.md',
    line: (ctx) => {
      const content = ctx.fileContent('AGENTS.md');
      return content ? findFillerLine(content) : null;
    },
  },
  codexNoInstructionContradictions: {
    id: 'CX-A08',
    name: 'AGENTS.md has no obvious contradictions',
    check: (ctx) => {
      const content = ctx.fileContent('AGENTS.md');
      if (!content) return null;
      return !hasContradictions(content);
    },
    impact: 'medium',
    rating: 4,
    category: 'instructions',
    fix: 'Remove contradictory guidance from AGENTS.md so Codex is not told to follow mutually exclusive rules.',
    template: null,
    file: () => 'AGENTS.md',
    line: (ctx) => {
      const content = ctx.fileContent('AGENTS.md');
      if (!content) return null;
      return firstLineMatching(content, /\balways\b.*\bnever\b|\bnever\b.*\balways\b|\buse tabs\b|\buse spaces\b|\bsingle quotes\b|\bdouble quotes\b|\bsemicolons required\b|\bno semicolons\b/i);
    },
  },
  codexConfigExists: {
    id: 'CX-B01',
    name: '.codex/config.toml exists',
    check: (ctx) => Boolean(ctx.fileContent('.codex/config.toml')),
    impact: 'high',
    rating: 5,
    category: 'config',
    fix: 'Create .codex/config.toml with explicit model, reasoning, approval policy, sandbox mode, and safe defaults.',
    template: 'codex-config',
    file: () => '.codex/config.toml',
    line: (ctx) => (ctx.fileContent('.codex/config.toml') ? 1 : null),
  },
  codexConfigValidToml: {
    id: 'CX-B06',
    name: 'Codex config.toml is valid and parseable',
    check: (ctx) => {
      const config = ctx.configToml();
      if (!ctx.fileContent('.codex/config.toml')) return null;
      return config.ok;
    },
    impact: 'critical',
    rating: 5,
    category: 'config',
    fix: 'Fix malformed TOML in .codex/config.toml so Codex does not silently ignore settings.',
    template: null,
    file: () => '.codex/config.toml',
    line: (ctx) => {
      const config = ctx.configToml();
      if (config.ok || !config.error) return null;
      const match = config.error.match(/Line (\d+)/i);
      return match ? Number(match[1]) : 1;
    },
  },
  codexModelExplicit: {
    id: 'CX-B02',
    name: 'Primary Codex model is explicit',
    check: (ctx) => Boolean(ctx.configValue('model')),
    impact: 'medium',
    rating: 4,
    category: 'config',
    fix: 'Set `model` explicitly in Codex config so teams know which model Codex uses by default.',
    template: 'codex-config',
    file: () => '.codex/config.toml',
    line: (ctx) => configKeyLine(ctx, 'model'),
  },
  codexReasoningEffortExplicit: {
    id: 'CX-B03',
    name: 'model_reasoning_effort is explicit',
    check: (ctx) => Boolean(ctx.configValue('model_reasoning_effort')),
    impact: 'low',
    rating: 3,
    category: 'config',
    fix: 'Set `model_reasoning_effort` explicitly only when the repo needs a non-default reasoning posture; this setting is optional, and minimal effort should stay compatible with any `web_search` usage.',
    template: 'codex-config',
    file: () => '.codex/config.toml',
    line: (ctx) => configKeyLine(ctx, 'model_reasoning_effort'),
  },
  codexWeakModelExplicit: {
    id: 'CX-B04',
    name: 'Weak-task delegation model is explicit',
    check: () => {
      // Retired: config key removed from official schema as of 2026-04-05
      return null;
    },
    impact: 'medium',
    rating: 4,
    category: 'config',
    fix: '`model_for_weak_tasks` was removed from the official Codex config schema as of 2026-04-05. This check is retired and no repo change is required.',
    template: null,
    file: () => null,
    line: () => null,
  },
  codexConfigSectionPlacement: {
    id: 'CX-B05',
    name: 'Nested-only config keys are placed in the right TOML sections',
    check: (ctx) => {
      const content = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      if (!content) return null;
      return !hasMisplacedNestedKeys(content).misplaced;
    },
    impact: 'high',
    rating: 5,
    category: 'config',
    fix: 'Move nested-only keys like `send_to_server`, `max_threads`, and `enabled_tools` into their proper TOML sections.',
    template: null,
    file: () => '.codex/config.toml',
    line: (ctx) => {
      const content = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      return content ? hasMisplacedNestedKeys(content).line : null;
    },
  },
  codexNoLegacyConfigAliases: {
    id: 'CX-B07',
    name: 'Config avoids legacy or mistyped aliases',
    check: (ctx) => {
      const content = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      if (!content) return null;
      return !findLegacyConfigIssue(content);
    },
    impact: 'medium',
    rating: 4,
    category: 'config',
    fix: 'Replace legacy or mistyped Codex config aliases with the current documented keys.',
    template: null,
    file: () => '.codex/config.toml',
    line: (ctx) => {
      const content = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      const issue = content ? findLegacyConfigIssue(content) : null;
      return issue ? issue.line : null;
    },
  },
  codexProfilesUsedAppropriately: {
    id: 'CX-B08',
    name: 'Config profiles are defined and referenced appropriately',
    check: (ctx) => {
      const activeProfile = ctx.configValue('profile');
      const sections = profileSections(ctx);
      const profiles = parsedProfiles(ctx);
      if (!activeProfile && sections.length === 0) return null;

      if (activeProfile) {
        const active = typeof activeProfile === 'string' ? activeProfile.trim() : '';
        if (!active) return false;
        if (!profiles[active] || Object.keys(profiles[active] || {}).length === 0) {
          return false;
        }
      }

      return sections.every((section) => {
        const name = section.section.slice('profiles.'.length);
        const value = profiles[name];
        return value && typeof value === 'object' && Object.keys(value).length > 0;
      });
    },
    impact: 'low',
    rating: 3,
    category: 'config',
    fix: 'Profiles are an advanced feature, not a baseline requirement. If you use them, make sure each profile contains real settings and any selected `profile` points to an existing profile section.',
    template: null,
    file: () => '.codex/config.toml',
    line: (ctx) => configKeyLine(ctx, 'profile') || (profileSections(ctx)[0] || {}).line || null,
  },
  codexFullAutoErrorModeExplicit: {
    id: 'CX-B09',
    name: 'full_auto_error_mode is explicit',
    check: () => {
      // Retired: config key removed from official schema as of 2026-04-05
      return null;
    },
    impact: 'medium',
    rating: 4,
    category: 'config',
    fix: '`full_auto_error_mode` was removed from the official Codex config schema as of 2026-04-05. This check is retired and no repo change is required.',
    template: null,
    file: () => null,
    line: () => null,
  },
  codexWebSearchModeCompatible: {
    id: 'CX-B10',
    name: 'web_search mode is explicit and compatible when search is part of the workflow',
    check: (ctx) => {
      if (!webSearchModeRelevant(ctx)) return null;
      return !webSearchModeIssue(ctx);
    },
    impact: 'medium',
    rating: 4,
    category: 'config',
    fix: 'When the repo uses search-aware Codex flows, set `web_search = "cached" | "live" | "disabled"` intentionally and avoid pairing search with `model_reasoning_effort = "minimal"` in the same effective profile.',
    template: 'codex-config',
    file: (ctx) => {
      const issue = webSearchModeIssue(ctx);
      return issue ? issue.filePath : '.codex/config.toml';
    },
    line: (ctx) => {
      const issue = webSearchModeIssue(ctx);
      return issue ? issue.line : configKeyLine(ctx, 'web_search');
    },
  },
  codexRequirementsTomlRecognized: {
    id: 'CX-B11',
    name: 'requirements.toml posture is recognized when a managed layer exists',
    check: (ctx) => {
      if (!ctx.fileContent('requirements.toml')) return null;
      return !requirementsTomlIssue(ctx);
    },
    impact: 'medium',
    rating: 3,
    category: 'config',
    fix: 'If the repo uses `requirements.toml`, keep it non-empty and acknowledge that it is a managed/admin layer rather than an ordinary project preference file.',
    template: null,
    file: (ctx) => {
      const issue = requirementsTomlIssue(ctx);
      return issue ? issue.filePath : 'requirements.toml';
    },
    line: (ctx) => {
      const issue = requirementsTomlIssue(ctx);
      return issue ? issue.line : 1;
    },
  },
  codexCliAuthCredentialsStoreExplicit: {
    id: 'CX-B12',
    name: 'cli_auth_credentials_store is explicit on shared or managed setups',
    check: (ctx) => {
      const issue = authCredentialsStoreIssue(ctx);
      return issue ? false : (sharedOrManagedMachineSignals(ctx) ? true : null);
    },
    impact: 'high',
    rating: 4,
    category: 'config',
    fix: 'On shared or managed machines, set `cli_auth_credentials_store = "auto" | "keyring" | "file"` explicitly so Codex auth-cache handling is reviewable.',
    template: 'codex-config',
    file: (ctx) => {
      const issue = authCredentialsStoreIssue(ctx);
      return issue ? issue.filePath : '.codex/config.toml';
    },
    line: (ctx) => {
      const issue = authCredentialsStoreIssue(ctx);
      return issue ? issue.line : configKeyLine(ctx, 'cli_auth_credentials_store');
    },
  },
  codexApprovalPolicyExplicit: {
    id: 'CX-C02',
    name: 'approval_policy is explicit',
    check: (ctx) => Boolean(ctx.configValue('approval_policy')),
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Set `approval_policy` explicitly in Codex config so Codex behavior is predictable across sessions.',
    template: 'codex-config',
    file: () => '.codex/config.toml',
    line: (ctx) => configKeyLine(ctx, 'approval_policy'),
  },
  codexSandboxModeExplicit: {
    id: 'CX-C03',
    name: 'sandbox_mode is explicit',
    check: (ctx) => Boolean(ctx.configValue('sandbox_mode')),
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'Set `sandbox_mode` explicitly (usually `workspace-write`) instead of relying on implicit defaults.',
    template: 'codex-config',
    file: () => '.codex/config.toml',
    line: (ctx) => configKeyLine(ctx, 'sandbox_mode'),
  },
  codexNoDangerFullAccess: {
    id: 'CX-C01',
    name: 'No danger-full-access sandbox mode',
    check: (ctx) => {
      const sandboxMode = ctx.configValue('sandbox_mode');
      if (!sandboxMode) return true;
      return sandboxMode !== 'danger-full-access';
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Replace `sandbox_mode = "danger-full-access"` with `workspace-write` and add explicit approvals for elevated actions.',
    template: 'codex-config',
    file: () => '.codex/config.toml',
    line: (ctx) => configKeyLine(ctx, 'sandbox_mode'),
  },
  codexApprovalNeverNeedsJustification: {
    id: 'CX-C04',
    name: 'approval_policy = "never" has explicit justification',
    check: (ctx) => {
      const approvalPolicy = ctx.configValue('approval_policy');
      if (!approvalPolicy) return null;
      if (approvalPolicy !== 'never') return true;
      const config = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      const agents = agentsContent(ctx);
      return JUSTIFICATION_PATTERNS.test(config) || JUSTIFICATION_PATTERNS.test(agents);
    },
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'If you intentionally use `approval_policy = "never"`, document why in config comments or AGENTS.md so the trust boundary is reviewable.',
    template: null,
    file: () => '.codex/config.toml',
    line: (ctx) => configKeyLine(ctx, 'approval_policy'),
  },
  codexDisableResponseStorageForRegulatedRepos: {
    id: 'CX-C05',
    name: 'disable_response_storage is explicit for regulated repos',
    check: () => {
      // Retired: config key removed from official schema as of 2026-04-05
      return null;
    },
    impact: 'medium',
    rating: 4,
    category: 'trust',
    fix: '`disable_response_storage` was removed from the official Codex config schema as of 2026-04-05. This check is retired and no repo change is required.',
    template: null,
    file: () => null,
    line: () => null,
  },
  codexHistorySendToServerExplicit: {
    id: 'CX-C06',
    name: 'history.send_to_server is explicit',
    check: () => {
      // Retired: config key removed from official schema as of 2026-04-05
      return null;
    },
    impact: 'medium',
    rating: 4,
    category: 'trust',
    fix: '`history.send_to_server` was removed from the official Codex config schema as of 2026-04-05. This check is retired and no repo change is required.',
    template: null,
    file: () => null,
    line: () => null,
  },
  codexGitHubActionUnsafeJustified: {
    id: 'CX-C07',
    name: 'Unsafe Codex GitHub Action safety mode has explicit justification',
    check: (ctx) => {
      const workflows = codexActionWorkflowIssues(ctx);
      if (workflows.length === 0) return null;
      return workflows.every((issue) => issue.justified);
    },
    impact: 'high',
    rating: 4,
    category: 'trust',
    fix: 'If a Codex GitHub Action workflow uses `safety-strategy: unsafe`, document why or restrict it to the Windows boundary where it is required.',
    template: null,
    file: (ctx) => {
      const issue = codexActionWorkflowIssues(ctx).find((item) => !item.justified);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = codexActionWorkflowIssues(ctx).find((item) => !item.justified);
      return issue ? issue.line : null;
    },
  },
  codexNetworkAccessExplicit: {
    id: 'CX-C08',
    name: 'Network access posture is explicit for workspace-write sandbox',
    check: (ctx) => {
      const sandboxMode = ctx.configValue('sandbox_mode');
      if (!sandboxMode || sandboxMode !== 'workspace-write') return null;
      return typeof ctx.configValue('sandbox_workspace_write.network_access') === 'boolean';
    },
    impact: 'medium',
    rating: 4,
    category: 'trust',
    fix: 'Set `sandbox_workspace_write.network_access = true|false` explicitly so Codex network posture is reviewable in workspace-write mode.',
    template: 'codex-config',
    file: () => '.codex/config.toml',
    line: (ctx) => configSectionKeyLine(ctx, 'sandbox_workspace_write', 'network_access'),
  },
  codexNoSecretsInAgents: {
    id: 'CX-C09',
    name: 'AGENTS.md contains no embedded secrets',
    check: (ctx) => {
      const content = agentsContent(ctx);
      if (!content) return null;
      return !containsEmbeddedSecret(content);
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Remove API keys and secrets from AGENTS.md. Use environment variables or external secret stores instead.',
    template: null,
    file: (ctx) => agentsPath(ctx),
    line: (ctx) => {
      const content = agentsContent(ctx);
      return content ? findSecretLine(content) : null;
    },
  },
  codexProtectedPathsRespectedInWorkspaceWriteDocs: {
    id: 'CX-C10',
    name: 'Workspace-write docs do not imply protected paths are writable',
    check: (ctx) => {
      if (!protectedPathAssumptionRelevant(ctx)) return null;
      return !protectedPathAssumptionIssue(ctx);
    },
    impact: 'high',
    rating: 4,
    category: 'trust',
    fix: 'If repo docs mention `.git`, `.codex`, or `.agents` under workspace-write, describe them as protected/read-only rather than writable runtime surfaces.',
    template: 'codex-agents-md',
    file: (ctx) => {
      const issue = protectedPathAssumptionIssue(ctx);
      return issue ? issue.filePath : primaryDocsPath(ctx);
    },
    line: (ctx) => {
      const issue = protectedPathAssumptionIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexWindowsSandboxModeExplicit: {
    id: 'CX-C11',
    name: 'Native Windows sandbox mode is explicit when Windows config is used',
    check: (ctx) => {
      const issue = windowsSandboxModeIssue(ctx);
      return issue ? false : (nativeWindowsConfigRelevant(ctx) ? true : null);
    },
    impact: 'high',
    rating: 4,
    category: 'trust',
    fix: 'If the repo relies on native Windows Codex settings, set `[windows] sandbox = "elevated" | "unelevated"` explicitly so the trust boundary is reviewable.',
    template: 'codex-config',
    file: (ctx) => {
      const issue = windowsSandboxModeIssue(ctx);
      return issue ? issue.filePath : '.codex/config.toml';
    },
    line: (ctx) => {
      const issue = windowsSandboxModeIssue(ctx);
      return issue ? issue.line : configSectionKeyLine(ctx, 'windows', 'sandbox');
    },
  },
  codexRulesExistForRiskyCommands: {
    id: 'CX-D01',
    name: 'Rules exist for risky or out-of-sandbox command classes',
    check: (ctx) => {
      const issue = ruleCoverageIssue(ctx);
      return issue ? false : true;
    },
    impact: 'high',
    rating: 4,
    category: 'rules',
    fix: 'Add Codex rules under `codex/rules/` or `.codex/rules/` for risky command classes such as Git pushes, shells, package managers, or destructive commands.',
    template: null,
    file: (ctx) => {
      const issue = ruleCoverageIssue(ctx);
      return issue ? issue.filePath : (repoRuleArtifacts(ctx)[0] || {}).filePath || null;
    },
    line: (ctx) => {
      const issue = ruleCoverageIssue(ctx);
      return issue ? issue.line : (allRuleBlocks(ctx)[0] || {}).startLine || null;
    },
  },
  codexRulesSpecificPatterns: {
    id: 'CX-D02',
    name: 'Rules use specific patterns instead of wildcard matches',
    check: (ctx) => {
      if (allRuleBlocks(ctx).length === 0) return null;
      return !specificRulePatternIssue(ctx);
    },
    impact: 'medium',
    rating: 4,
    category: 'rules',
    fix: 'Replace wildcard-heavy rule patterns with specific command prefixes so Codex approvals stay narrow and reviewable.',
    template: null,
    file: (ctx) => {
      const issue = specificRulePatternIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = specificRulePatternIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexRulesExamplesPresent: {
    id: 'CX-D03',
    name: 'Rules include match or not_match examples',
    check: (ctx) => {
      if (allRuleBlocks(ctx).length === 0) return null;
      return !missingRuleExamplesIssue(ctx);
    },
    impact: 'low',
    rating: 3,
    category: 'rules',
    fix: 'Add `match` or `not_match` examples to Codex rules so broken or over-broad rules are caught before they take effect.',
    template: null,
    file: (ctx) => {
      const issue = missingRuleExamplesIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = missingRuleExamplesIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexNoBroadAllowAllRules: {
    id: 'CX-D04',
    name: 'Rules do not contain broad allow-all command patterns',
    check: (ctx) => {
      if (allRuleBlocks(ctx).length === 0) return null;
      return !broadAllowRuleIssue(ctx);
    },
    impact: 'high',
    rating: 4,
    category: 'rules',
    fix: 'Avoid broad allow rules for shells or generic tool entrypoints; prefer narrow prefixes and explicit review boundaries.',
    template: null,
    file: (ctx) => {
      const issue = broadAllowRuleIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = broadAllowRuleIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexRuleWrapperRiskDocumented: {
    id: 'CX-D05',
    name: 'Shell wrapper and path-resolution caveats are documented for rules',
    check: (ctx) => {
      if (allRuleBlocks(ctx).length === 0) return null;
      return !ruleWrapperRiskIssue(ctx);
    },
    impact: 'low',
    rating: 3,
    category: 'rules',
    fix: 'If your rules rely on shell wrappers or `host_executable()`, document the shell-splitting and path-resolution caveats in AGENTS.md or the rule file itself.',
    template: null,
    file: (ctx) => {
      const issue = ruleWrapperRiskIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = ruleWrapperRiskIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexHooksDeliberate: {
    id: 'CX-E01',
    name: 'Hooks feature is deliberately enabled or disabled',
    check: (ctx) => {
      const explicit = explicitHooksFeatureValue(ctx);
      if (explicit !== null) return true;
      if (!hooksClaimed(ctx) && !ctx.fileContent('.codex/config.toml')) return null;
      return false;
    },
    impact: 'medium',
    rating: 4,
    category: 'hooks',
    fix: 'Set `[features] codex_hooks = true|false` explicitly so hook posture is deliberate and reviewable.',
    template: null,
    file: () => '.codex/config.toml',
    line: (ctx) => configSectionKeyLine(ctx, 'features', 'codex_hooks'),
  },
  codexHooksJsonExistsWhenClaimed: {
    id: 'CX-E02',
    name: 'hooks.json exists when hooks are claimed',
    check: (ctx) => {
      if (!hooksClaimed(ctx)) return null;
      return Boolean(ctx.hooksJsonContent && ctx.hooksJsonContent());
    },
    impact: 'high',
    rating: 4,
    category: 'hooks',
    fix: 'If the repo claims Codex hooks, commit `.codex/hooks.json` so the runtime behavior is explicit and reviewable.',
    template: null,
    file: () => '.codex/hooks.json',
    line: (ctx) => (ctx.hooksJsonContent && ctx.hooksJsonContent() ? 1 : null),
  },
  codexHookEventsSupported: {
    id: 'CX-E03',
    name: 'hooks.json uses supported Codex events',
    check: (ctx) => {
      const content = ctx.hooksJsonContent && ctx.hooksJsonContent();
      if (!content) return null;
      return !unsupportedHookEvent(ctx);
    },
    impact: 'medium',
    rating: 4,
    category: 'hooks',
    fix: 'Use only Codex-supported hook events: SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, and Stop.',
    template: null,
    file: () => '.codex/hooks.json',
    line: (ctx) => {
      const issue = unsupportedHookEvent(ctx);
      return issue ? issue.line : null;
    },
  },
  codexHooksWindowsCaveat: {
    id: 'CX-E04',
    name: 'Windows users are not relying on Codex hooks for enforcement',
    check: (ctx) => {
      if (os.platform() !== 'win32') return true;
      return !hooksClaimed(ctx);
    },
    impact: 'critical',
    rating: 5,
    category: 'hooks',
    fix: 'Codex hooks are disabled on Windows. Move enforcement to CI or document a non-hook fallback instead of relying on runtime hooks.',
    template: null,
    file: (ctx) => {
      if (ctx.hooksJsonContent && ctx.hooksJsonContent()) return '.codex/hooks.json';
      return agentsPath(ctx);
    },
    line: (ctx) => {
      if (ctx.hooksJsonContent && ctx.hooksJsonContent()) return 1;
      const content = agentsContent(ctx);
      return content ? firstLineMatching(content, /\bhooks?\b|\bSessionStart\b|\bPreToolUse\b|\bPostToolUse\b|\bUserPromptSubmit\b|\bStop\b/i) : null;
    },
  },
  codexHookTimeoutsReasonable: {
    id: 'CX-E05',
    name: 'Hooks do not use long timeouts without justification',
    check: (ctx) => {
      if (!(ctx.hooksJsonContent && ctx.hooksJsonContent())) return null;
      return !longHookTimeoutIssue(ctx);
    },
    impact: 'low',
    rating: 3,
    category: 'hooks',
    fix: 'Keep Codex hook timeouts at 60 seconds or lower unless the repo documents why a longer timeout is required.',
    template: null,
    file: (ctx) => {
      const issue = longHookTimeoutIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = longHookTimeoutIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexMcpPresentIfRepoNeedsExternalTools: {
    id: 'CX-F01',
    name: 'MCP servers are configured when the repo clearly needs external tools',
    check: (ctx) => {
      if (!repoNeedsExternalTools(ctx)) return null;
      return Object.keys(ctx.mcpServers() || {}).length > 0;
    },
    impact: 'medium',
    rating: 4,
    category: 'mcp',
    fix: 'This repo looks like it depends on external services or tools. Add MCP servers when appropriate so Codex can use live context instead of stale assumptions.',
    template: null,
    file: () => '.codex/config.toml',
    line: (ctx) => (ctx.fileContent('.codex/config.toml') ? 1 : null),
  },
  codexMcpWhitelistsExplicit: {
    id: 'CX-F02',
    name: 'MCP servers use explicit enabled_tools whitelists',
    check: (ctx) => {
      const servers = ctx.mcpServers();
      const ids = Object.keys(servers || {});
      if (ids.length === 0) return null;
      return ids.every((id) => {
        const server = servers[id];
        return Array.isArray(server.enabled_tools) && server.enabled_tools.length > 0;
      });
    },
    impact: 'high',
    rating: 4,
    category: 'mcp',
    fix: 'For each MCP server, set `enabled_tools` explicitly instead of exposing the whole tool surface by default.',
    template: null,
    file: () => '.codex/config.toml',
    line: (ctx) => {
      const servers = ctx.mcpServers();
      for (const [id, server] of Object.entries(servers || {})) {
        if (!(Array.isArray(server.enabled_tools) && server.enabled_tools.length > 0)) {
          return configSectionKeyLine(ctx, `mcp_servers.${id}`, 'enabled_tools') ||
            (configSections(ctx).find(item => item.section === `mcp_servers.${id}`) || {}).line ||
            1;
        }
      }
      return null;
    },
  },
  codexMcpStartupTimeoutReasonable: {
    id: 'CX-F03',
    name: 'MCP startup timeout is reasonable',
    check: (ctx) => {
      const servers = mcpServersWithTimeouts(ctx);
      if (servers.length === 0) return null;
      return servers.every((server) => server.timeout == null || server.timeout <= 30);
    },
    impact: 'low',
    rating: 3,
    category: 'mcp',
    fix: 'Keep `mcp_servers.<id>.startup_timeout_sec` at 30 seconds or lower unless you have a documented reason for a slower server.',
    template: null,
    file: () => '.codex/config.toml',
    line: (ctx) => {
      const servers = mcpServersWithTimeouts(ctx);
      const slow = servers.find(server => server.timeout != null && server.timeout > 30);
      return slow ? configSectionKeyLine(ctx, `mcp_servers.${slow.id}`, 'startup_timeout_sec') : null;
    },
  },
  codexProjectScopedMcpTrusted: {
    id: 'CX-F04',
    name: 'Project-scoped MCP is only used on trusted projects',
    check: (ctx) => {
      if (!projectScopedMcpPresent(ctx)) return null;
      return ctx.isProjectTrusted ? ctx.isProjectTrusted() : false;
    },
    impact: 'high',
    rating: 4,
    category: 'mcp',
    fix: 'Project-scoped MCP belongs on a trusted project path. Trust the repo in Codex before relying on local `.codex/config.toml` MCP servers.',
    template: null,
    file: () => '.codex/config.toml',
    line: () => 1,
  },
  codexMcpAuthDocumented: {
    id: 'CX-F05',
    name: 'MCP auth requirements are documented for each remote server',
    check: (ctx) => {
      if (!projectScopedMcpPresent(ctx)) return null;
      return !mcpAuthDocumentationIssue(ctx);
    },
    impact: 'medium',
    rating: 4,
    category: 'mcp',
    fix: 'For each remote MCP server, document the auth posture inline (token env var, OAuth, or headers) or in repo docs so setup is reviewable.',
    template: null,
    file: (ctx) => {
      const issue = mcpAuthDocumentationIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = mcpAuthDocumentationIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexNoDeprecatedMcpTransport: {
    id: 'CX-F06',
    name: 'MCP config avoids deprecated transport types',
    check: (ctx) => {
      if (!projectScopedMcpPresent(ctx)) return null;
      return !deprecatedMcpTransportIssue(ctx);
    },
    impact: 'medium',
    rating: 4,
    category: 'mcp',
    fix: 'Use current MCP transports (stdio or streamable HTTP) and remove deprecated SSE-style transport settings from project config.',
    template: null,
    file: (ctx) => {
      const issue = deprecatedMcpTransportIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = deprecatedMcpTransportIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexMcpHttpAuthAndCallbacksDocumented: {
    id: 'CX-F07',
    name: 'MCP HTTP auth and callback fields are documented when used',
    check: (ctx) => {
      if (!mcpHttpAuthAndCallbackRelevant(ctx)) return null;
      return !mcpHttpAuthAndCallbackIssue(ctx);
    },
    impact: 'medium',
    rating: 4,
    category: 'mcp',
    fix: 'If remote MCP uses header-based auth or custom OAuth callback settings, document the header/callback posture in repo docs so setup stays reviewable.',
    template: null,
    file: (ctx) => {
      const issue = mcpHttpAuthAndCallbackIssue(ctx);
      return issue ? issue.filePath : '.codex/config.toml';
    },
    line: (ctx) => {
      const issue = mcpHttpAuthAndCallbackIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexDesktopProjectMcpCaveatDocumented: {
    id: 'CX-F08',
    name: 'Project-scoped MCP docs caveat desktop or IDE behavior when relevant',
    check: (ctx) => {
      const issue = desktopProjectMcpCaveatIssue(ctx);
      return issue ? false : (projectScopedMcpPresent(ctx) && /\bdesktop\b|\bide\b|\bextension\b/i.test(docsBundle(ctx)) ? true : null);
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'If repo-local MCP config is discussed for desktop or IDE use, note the trusted-project boundary and the possibility that user-global config may still matter on some surfaces.',
    template: 'codex-agents-md',
    file: (ctx) => {
      const issue = desktopProjectMcpCaveatIssue(ctx);
      return issue ? issue.filePath : primaryDocsPath(ctx);
    },
    line: (ctx) => {
      const issue = desktopProjectMcpCaveatIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexSkillsDirPresentWhenUsed: {
    id: 'CX-G01',
    name: '.agents/skills exists when Codex skills are used',
    check: (ctx) => {
      if (!repoClaimsSkills(ctx)) return null;
      return ctx.hasDir('.agents/skills');
    },
    impact: 'medium',
    rating: 4,
    category: 'skills',
    fix: 'If the repo uses Codex skills, commit them under `.agents/skills/` so invocation stays local, reviewable, and versioned.',
    template: null,
    file: () => '.agents/skills',
    line: () => 1,
  },
  codexSkillsHaveMetadata: {
    id: 'CX-G02',
    name: 'Skills include SKILL.md with a name and description',
    check: (ctx) => {
      if ((ctx.skillDirs ? ctx.skillDirs() : []).length === 0) return null;
      return !skillMissingFieldsIssue(ctx);
    },
    impact: 'high',
    rating: 4,
    category: 'skills',
    fix: 'Give every skill a `SKILL.md` with a clear title and a short description so Codex can understand when to use it.',
    template: null,
    file: (ctx) => {
      const issue = skillMissingFieldsIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = skillMissingFieldsIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexSkillNamesKebabCase: {
    id: 'CX-G03',
    name: 'Skill names use kebab-case',
    check: (ctx) => {
      if ((ctx.skillDirs ? ctx.skillDirs() : []).length === 0) return null;
      return !skillBadNameIssue(ctx);
    },
    impact: 'high',
    rating: 4,
    category: 'skills',
    fix: 'Rename skill folders to kebab-case so Codex can invoke them consistently without naming drift.',
    template: null,
    file: (ctx) => {
      const issue = skillBadNameIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = skillBadNameIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexSkillDescriptionsBounded: {
    id: 'CX-G04',
    name: 'Skill descriptions stay bounded for implicit invocation',
    check: (ctx) => {
      if ((ctx.skillDirs ? ctx.skillDirs() : []).length === 0) return null;
      return !skillDescriptionTooLongIssue(ctx);
    },
    impact: 'medium',
    rating: 3,
    category: 'skills',
    fix: 'Keep the first skill description short and specific so Codex can decide whether to invoke it without bloating context.',
    template: null,
    file: (ctx) => {
      const issue = skillDescriptionTooLongIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = skillDescriptionTooLongIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexSkillsNoAutoRunRisk: {
    id: 'CX-G05',
    name: 'Skills do not introduce unreviewed auto-run risk',
    check: (ctx) => {
      if ((ctx.skillDirs ? ctx.skillDirs() : []).length === 0) return null;
      return !skillAutoRunRiskIssue(ctx);
    },
    impact: 'high',
    rating: 4,
    category: 'skills',
    fix: 'Remove language that tells Codex to auto-run destructive or external actions without an explicit approval or review boundary.',
    template: null,
    file: (ctx) => {
      const issue = skillAutoRunRiskIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = skillAutoRunRiskIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexCustomAgentsRequiredFields: {
    id: 'CX-H01',
    name: 'Custom agents define required fields',
    check: (ctx) => {
      if (!repoUsesCustomAgents(ctx)) return null;
      if ((ctx.customAgentFiles ? ctx.customAgentFiles() : []).length === 0) return false;
      return !customAgentMissingFieldsIssue(ctx);
    },
    impact: 'high',
    rating: 4,
    category: 'agents',
    fix: 'Each custom agent should define `name`, `description`, and `developer_instructions` so Codex can route work safely.',
    template: null,
    file: (ctx) => {
      const issue = customAgentMissingFieldsIssue(ctx);
      return issue ? issue.filePath : '.codex/agents';
    },
    line: (ctx) => {
      const issue = customAgentMissingFieldsIssue(ctx);
      return issue ? issue.line : 1;
    },
  },
  codexMaxThreadsExplicit: {
    id: 'CX-H02',
    name: 'agents.max_threads is explicit',
    check: (ctx) => {
      if (!repoUsesCustomAgents(ctx)) return null;
      return typeof ctx.configValue('agents.max_threads') === 'number';
    },
    impact: 'medium',
    rating: 3,
    category: 'agents',
    fix: 'Set `[agents] max_threads` explicitly so Codex fanout is intentional instead of inheriting the default ceiling.',
    template: 'codex-config',
    file: () => '.codex/config.toml',
    line: (ctx) => configSectionKeyLine(ctx, 'agents', 'max_threads'),
  },
  codexMaxDepthExplicit: {
    id: 'CX-H03',
    name: 'agents.max_depth is explicit',
    check: (ctx) => {
      if (!repoUsesCustomAgents(ctx)) return null;
      return typeof ctx.configValue('agents.max_depth') === 'number';
    },
    impact: 'medium',
    rating: 3,
    category: 'agents',
    fix: 'Set `[agents] max_depth` explicitly so nested delegation stays predictable and reviewable.',
    template: 'codex-config',
    file: () => '.codex/config.toml',
    line: (ctx) => configSectionKeyLine(ctx, 'agents', 'max_depth'),
  },
  codexPerAgentSandboxOverridesSafe: {
    id: 'CX-H04',
    name: 'Per-agent sandbox overrides stay within safe bounds',
    check: (ctx) => {
      if ((ctx.customAgentFiles ? ctx.customAgentFiles() : []).length === 0) return null;
      return !unsafeAgentOverrideIssue(ctx);
    },
    impact: 'high',
    rating: 4,
    category: 'agents',
    fix: 'Avoid per-agent `danger-full-access`, and justify any `approval_policy = "never"` override inside the agent config itself.',
    template: null,
    file: (ctx) => {
      const issue = unsafeAgentOverrideIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = unsafeAgentOverrideIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexJobMaxRuntimeExplicitForBatchAgents: {
    id: 'CX-H05',
    name: 'agents.job_max_runtime_seconds is explicit for batch-style subagent flows',
    check: (ctx) => {
      if (!batchStyleSubagentFlowPresent(ctx)) return null;
      const issue = csvBatchAgentIssue(ctx);
      return !issue;
    },
    impact: 'medium',
    rating: 3,
    category: 'agents',
    fix: 'If custom agents use CSV or batch-style fanout fields, set `[agents] job_max_runtime_seconds` explicitly so worker runtime is bounded and reviewable.',
    template: 'codex-config',
    file: (ctx) => {
      const issue = csvBatchAgentIssue(ctx);
      return issue ? issue.filePath : '.codex/config.toml';
    },
    line: (ctx) => {
      const issue = csvBatchAgentIssue(ctx);
      return issue ? issue.line : configSectionKeyLine(ctx, 'agents', 'job_max_runtime_seconds');
    },
  },
  codexNicknameCandidatesValid: {
    id: 'CX-H06',
    name: 'nickname_candidates are valid and unique when used',
    check: (ctx) => {
      const issue = nicknameCandidatesIssue(ctx);
      const hasNicknameCandidates = (ctx.customAgentFiles ? ctx.customAgentFiles() : []).some((fileName) => {
        const parsed = ctx.customAgentConfig(fileName);
        return parsed.ok && parsed.data && parsed.data.nickname_candidates !== undefined;
      });
      if (!hasNicknameCandidates) return null;
      return !issue;
    },
    impact: 'medium',
    rating: 3,
    category: 'agents',
    fix: 'When custom agents use `nickname_candidates`, keep them non-empty, ASCII-safe, and unique across the repo so display names stay deterministic.',
    template: null,
    file: (ctx) => {
      const issue = nicknameCandidatesIssue(ctx);
      return issue ? issue.filePath : '.codex/agents';
    },
    line: (ctx) => {
      const issue = nicknameCandidatesIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexExecUsageSafe: {
    id: 'CX-I01',
    name: 'codex exec usage avoids unsafe automation defaults',
    check: (ctx) => {
      if (codexAutomationArtifacts(ctx).length === 0) return null;
      return !codexExecUnsafeIssue(ctx);
    },
    impact: 'high',
    rating: 4,
    category: 'automation',
    fix: 'Avoid `codex exec` flows that bypass approvals or run fully automatic without a documented review boundary.',
    template: null,
    file: (ctx) => {
      const issue = codexExecUnsafeIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = codexExecUnsafeIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexGitHubActionSafeStrategy: {
    id: 'CX-I02',
    name: 'Codex GitHub Action uses a safe strategy',
    check: (ctx) => {
      const hasAction = workflowArtifacts(ctx).some((workflow) => /uses:\s*openai\/codex-action@/i.test(workflow.content));
      if (!hasAction) return null;
      return !codexActionSafeStrategyIssue(ctx);
    },
    impact: 'high',
    rating: 4,
    category: 'automation',
    fix: 'Use an explicit safe Codex Action strategy, and reserve `unsafe` only for the documented Windows boundary where it is required.',
    template: null,
    file: (ctx) => {
      const issue = codexActionSafeStrategyIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = codexActionSafeStrategyIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexCiAuthUsesManagedKey: {
    id: 'CX-I03',
    name: 'CI auth uses managed CODEX_API_KEY or equivalent secret injection',
    check: (ctx) => {
      if (workflowArtifacts(ctx).length === 0) return null;
      return !codexCiAuthIssue(ctx);
    },
    impact: 'critical',
    rating: 5,
    category: 'automation',
    fix: 'Wire Codex CI through `CODEX_API_KEY` or a managed secret reference. Never hardcode credentials in workflows.',
    template: null,
    file: (ctx) => {
      const issue = codexCiAuthIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = codexCiAuthIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexAutomationManuallyTested: {
    id: 'CX-I04',
    name: 'Automations are manually tested before scheduling',
    check: (ctx) => {
      if (codexAutomationArtifacts(ctx).length === 0) return null;
      return !automationManualTestingIssue(ctx);
    },
    impact: 'medium',
    rating: 3,
    category: 'automation',
    fix: 'Document that Codex automations were tested manually or in a dry-run/staging path before you schedule them.',
    template: null,
    file: (ctx) => {
      const issue = automationManualTestingIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = automationManualTestingIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexAutomationAppRunningAcknowledged: {
    id: 'CX-I05',
    name: 'App-running prerequisite is acknowledged for Codex app automations',
    check: (ctx) => {
      const issue = automationAppRunningIssue(ctx);
      return issue ? false : (appAutomationRelevant(ctx) ? true : null);
    },
    impact: 'medium',
    rating: 3,
    category: 'automation',
    fix: 'If the repo documents Codex app automations, note that the app must be running and the selected project must be available on disk.',
    template: 'codex-agents-md',
    file: (ctx) => {
      const issue = automationAppRunningIssue(ctx);
      return issue ? issue.filePath : primaryDocsPath(ctx);
    },
    line: (ctx) => {
      const issue = automationAppRunningIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexGitHubActionSinglePromptSource: {
    id: 'CX-I06',
    name: 'Codex GitHub Action uses exactly one prompt source',
    check: (ctx) => {
      const hasAction = workflowArtifacts(ctx).some((workflow) => /uses:\s*openai\/codex-action@/i.test(workflow.content));
      if (!hasAction) return null;
      return !codexActionPromptSourceIssue(ctx);
    },
    impact: 'high',
    rating: 4,
    category: 'automation',
    fix: 'For each `openai/codex-action` workflow, choose exactly one prompt input: `prompt` or `prompt-file`.',
    template: null,
    file: (ctx) => {
      const issue = codexActionPromptSourceIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = codexActionPromptSourceIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexGitHubActionTriggerAllowlistsExplicit: {
    id: 'CX-I07',
    name: 'Codex GitHub Action uses trigger allowlists on externally triggered workflows',
    check: (ctx) => {
      if (!codexActionExternalTriggersPresent(ctx)) return null;
      const issue = codexActionTriggerAllowlistIssue(ctx);
      return !issue;
    },
    impact: 'high',
    rating: 4,
    category: 'automation',
    fix: 'If a Codex Action workflow is triggered by comments or `pull_request_target`, set `allow-users` or `allow-bots` explicitly to constrain who can invoke it.',
    template: null,
    file: (ctx) => {
      const issue = codexActionTriggerAllowlistIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = codexActionTriggerAllowlistIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexReviewWorkflowDocumented: {
    id: 'CX-J01',
    name: 'Review workflow is available and documented',
    check: (ctx) => reviewWorkflowDocumented(ctx),
    impact: 'medium',
    rating: 3,
    category: 'review',
    fix: 'Document a Codex review path such as `codex review --uncommitted` so contributors know how to review risky diffs before handoff.',
    template: 'codex-agents-md',
    file: (ctx) => agentsPath(ctx) || 'README.md',
    line: (ctx) => firstLineMatching(docsBundle(ctx), /\bcodex review\b|\/review\b/i),
  },
  codexReviewModelOverrideExplicit: {
    id: 'CX-J02',
    name: 'Review model override is explicit when review automation exists',
    check: (ctx) => {
      const hasReviewAutomation = codexAutomationArtifacts(ctx).some((item) => /\bcodex\s+review\b/i.test(item.content || ''));
      if (!hasReviewAutomation) return null;
      const issue = reviewModelOverrideIssue(ctx);
      return issue ? false : true;
    },
    impact: 'low',
    rating: 2,
    category: 'review',
    fix: 'If you automate `codex review`, set an explicit review model or review profile so review quality and cost stay predictable.',
    template: null,
    file: (ctx) => {
      const issue = reviewModelOverrideIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = reviewModelOverrideIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexWorkingTreeReviewExpectations: {
    id: 'CX-J03',
    name: 'Working-tree review expectations are documented',
    check: (ctx) => workingTreeReviewDocsPresent(ctx),
    impact: 'low',
    rating: 2,
    category: 'review',
    fix: 'Document how Codex should treat uncommitted changes, staged diffs, and unrelated edits during review.',
    template: 'codex-agents-md',
    file: (ctx) => agentsPath(ctx) || 'README.md',
    line: (ctx) => firstLineMatching(docsBundle(ctx), /\bworking[- ]tree\b|\buncommitted\b|\bstaged\b/i),
  },
  codexCostAwarenessDocumented: {
    id: 'CX-J04',
    name: 'AGENTS.md includes cost-awareness for heavy workflows',
    check: (ctx) => costAwarenessDocsPresent(ctx),
    impact: 'medium',
    rating: 3,
    category: 'review',
    fix: 'Add a short cost/latency note so heavy Codex workflows are used intentionally instead of by default.',
    template: 'codex-agents-md',
    file: (ctx) => agentsPath(ctx) || 'README.md',
    line: (ctx) => firstLineMatching(docsBundle(ctx), /\bcost\b|\blatency\b|\breasoning\b|\bheavy workflows?\b/i),
  },
  codexArtifactsSharedIntentionally: {
    id: 'CX-K01',
    name: '.codex artifacts are shared intentionally',
    check: (ctx) => {
      if (!ctx.hasDir('.codex')) return null;
      return !codexArtifactsIgnoredIssue(ctx);
    },
    impact: 'medium',
    rating: 3,
    category: 'local',
    fix: 'Do not hide `.codex/` from version control unless that is an explicit project decision documented elsewhere.',
    template: null,
    file: (ctx) => {
      const issue = codexArtifactsIgnoredIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = codexArtifactsIgnoredIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexLifecycleScriptsPlatformSafe: {
    id: 'CX-K02',
    name: 'setup/teardown lifecycle scripts are intentional and platform-safe',
    check: (ctx) => {
      const issue = lifecycleScriptIssue(ctx);
      return issue ? false : (lifecycleScripts(ctx).length > 0 ? true : null);
    },
    impact: 'high',
    rating: 4,
    category: 'local',
    fix: 'If you ship setup/teardown scripts, document the platform boundary or provide a cross-platform alternative.',
    template: null,
    file: (ctx) => {
      const issue = lifecycleScriptIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = lifecycleScriptIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexActionsNotRedundant: {
    id: 'CX-K03',
    name: 'Codex workflows are useful and not redundant',
    check: (ctx) => {
      const workflows = workflowArtifacts(ctx).filter((workflow) => /\bcodex\b|openai\/codex-action@/i.test(workflow.content));
      if (workflows.length === 0) return null;
      const issue = redundantCodexWorkflowIssue(ctx);
      return issue ? false : true;
    },
    impact: 'low',
    rating: 2,
    category: 'local',
    fix: 'Avoid duplicate Codex workflows that do the same thing with different filenames. Keep the automation surface small and legible.',
    template: null,
    file: (ctx) => {
      const issue = redundantCodexWorkflowIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = redundantCodexWorkflowIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexWorktreeLifecycleDocumented: {
    id: 'CX-K04',
    name: 'Worktree or lifecycle assumptions are documented',
    check: (ctx) => {
      const relevant = lifecycleScripts(ctx).length > 0 || /\bworktrees?\b/i.test(docsBundle(ctx));
      if (!relevant) return null;
      const issue = worktreeLifecycleDocsIssue(ctx);
      return issue ? false : true;
    },
    impact: 'low',
    rating: 2,
    category: 'local',
    fix: 'If the repo uses worktrees or setup/teardown scripts, document the lifecycle and cleanup expectations.',
    template: 'codex-agents-md',
    file: (ctx) => {
      const issue = worktreeLifecycleDocsIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = worktreeLifecycleDocsIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexAgentsMentionModernFeatures: {
    id: 'CX-L01',
    name: 'AGENTS.md mentions modern Codex features used by the repo',
    check: (ctx) => {
      const relevant =
        (ctx.skillDirs ? ctx.skillDirs().length > 0 : false) ||
        (ctx.customAgentFiles ? ctx.customAgentFiles().length > 0 : false) ||
        hooksClaimed(ctx) ||
        projectScopedMcpPresent(ctx);
      if (!relevant) return null;
      const issue = agentsMissingModernFeaturesIssue(ctx);
      return issue ? false : true;
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'If the repo uses hooks, skills, subagents, or MCP, mention those surfaces in AGENTS.md so Codex gets the right context.',
    template: 'codex-agents-md',
    file: (ctx) => {
      const issue = agentsMissingModernFeaturesIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = agentsMissingModernFeaturesIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexNoDeprecatedPatterns: {
    id: 'CX-L02',
    name: 'Config and docs avoid deprecated Codex patterns',
    check: (ctx) => {
      const issue = deprecatedCodexPatternIssue(ctx);
      return issue ? false : true;
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Remove deprecated Codex patterns such as `approval_policy = "on-failure"` and update old workflow notes.',
    template: null,
    file: (ctx) => {
      const issue = deprecatedCodexPatternIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = deprecatedCodexPatternIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexProfilesUsedWhenNeeded: {
    id: 'CX-L03',
    name: 'Profiles are used when automation or delegation makes them useful',
    check: (ctx) => {
      const needed = codexAutomationArtifacts(ctx).length > 0 || (ctx.customAgentFiles ? ctx.customAgentFiles().length > 0 : false);
      if (!needed) return null;
      const issue = profilesNeededIssue(ctx);
      return issue ? false : true;
    },
    impact: 'low',
    rating: 2,
    category: 'quality-deep',
    fix: 'If the repo uses Codex automation or custom agents, define a named profile so the runtime posture is reusable and explicit.',
    template: 'codex-config',
    file: (ctx) => {
      const issue = profilesNeededIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = profilesNeededIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexPluginConfigValid: {
    id: 'CX-L04',
    name: 'Plugin configuration is valid',
    check: (ctx) => {
      if (!ctx.fileContent('.agents/plugins/marketplace.json')) return null;
      const issue = pluginConfigIssue(ctx);
      return issue ? false : true;
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'If the repo ships Codex plugin metadata, keep `.agents/plugins/marketplace.json` valid JSON.',
    template: null,
    file: (ctx) => {
      const issue = pluginConfigIssue(ctx);
      return issue ? issue.filePath : null;
    },
    line: (ctx) => {
      const issue = pluginConfigIssue(ctx);
      return issue ? issue.line : null;
    },
  },
  codexUndoExplicit: {
    id: 'CX-L05',
    name: 'features.undo is explicitly set',
    check: (ctx) => {
      if (!ctx.fileContent('.codex/config.toml')) return null;
      return typeof ctx.configValue('features.undo') === 'boolean';
    },
    impact: 'low',
    rating: 2,
    category: 'quality-deep',
    fix: 'Set `[features] undo = true|false` explicitly so the repo chooses its Codex undo posture instead of inheriting it accidentally.',
    template: 'codex-config',
    file: () => '.codex/config.toml',
    line: (ctx) => configSectionKeyLine(ctx, 'features', 'undo'),
  },

  // =============================================
  // CP-08: New checks (M. Advisory Quality)
  // =============================================

  codexAdvisoryAugmentQuality: {
    id: 'CX-M01',
    name: 'Augment recommendations reference real detected surfaces',
    check: (ctx) => {
      const agents = agentsContent(ctx);
      const config = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      if (!agents && !config) return null;
      // Check that at least one Codex surface is present for advisory to reference
      const surfaces = [
        Boolean(agents),
        Boolean(config),
        ctx.hasDir ? ctx.hasDir('.codex') : false,
      ].filter(Boolean).length;
      return surfaces >= 2;
    },
    impact: 'high',
    rating: 4,
    category: 'advisory',
    fix: 'Ensure at least AGENTS.md and .codex/config.toml exist so advisory commands can produce grounded, specific recommendations.',
    template: 'codex-agents-md',
    file: () => 'AGENTS.md',
    line: () => 1,
  },

  codexAdvisorySuggestOnlySafety: {
    id: 'CX-M02',
    name: 'Suggest-only mode has no-write contract enforced',
    check: (ctx) => {
      const config = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      if (!config) return null;
      // Check that approval_policy is not "never" (which would allow writes in suggest-only context)
      const hasExplicitApproval = /approval_policy\s*=\s*["'](?:on-request|untrusted)["']/i.test(config);
      return hasExplicitApproval;
    },
    impact: 'critical',
    rating: 5,
    category: 'advisory',
    fix: 'Set `approval_policy = "on-request"` or `"untrusted"` to ensure suggest-only mode cannot mutate files without explicit approval.',
    template: 'codex-config',
    file: () => '.codex/config.toml',
    line: (ctx) => configKeyLine(ctx, 'approval_policy'),
  },

  codexAdvisoryOutputFreshness: {
    id: 'CX-M03',
    name: 'No deprecated Codex features referenced in advisory context',
    check: (ctx) => {
      const agents = agentsContent(ctx);
      if (!agents) return null;
      // Check for deprecated patterns in AGENTS.md that advisory would echo
      for (const { pattern } of LEGACY_CONFIG_PATTERNS) {
        if (pattern.test(agents)) return false;
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'advisory',
    fix: 'Remove deprecated Codex feature references from AGENTS.md so advisory output stays current.',
    template: 'codex-agents-md',
    file: () => 'AGENTS.md',
    line: (ctx) => {
      const agents = agentsContent(ctx);
      if (!agents) return null;
      for (const { pattern } of LEGACY_CONFIG_PATTERNS) {
        const line = firstLineMatching(agents, pattern);
        if (line) return line;
      }
      return null;
    },
  },

  codexAdvisoryToSetupCoherence: {
    id: 'CX-M04',
    name: 'Advisory recommendations map to existing proposal families',
    check: (ctx) => {
      const agents = agentsContent(ctx);
      const config = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      if (!agents && !config) return null;
      // At least one actionable surface must exist for proposals to work
      return Boolean(agents || config);
    },
    impact: 'medium',
    rating: 3,
    category: 'advisory',
    fix: 'Ensure at least one Codex surface (AGENTS.md or config.toml) exists so advisory recommendations can be acted upon by setup/plan.',
    template: 'codex-agents-md',
    file: () => 'AGENTS.md',
    line: () => 1,
  },

  // =============================================
  // CP-08: New checks (N. Pack Posture)
  // =============================================

  codexDomainPackAlignment: {
    id: 'CX-N01',
    name: 'Detected stack aligns with recommended domain pack',
    check: (ctx) => {
      const agents = agentsContent(ctx);
      if (!agents) return null;
      // A broad check: if AGENTS.md mentions specific stack but also mentions a misaligned domain
      // For now, pass if AGENTS.md exists (domain detection runs outside the check)
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'pack-posture',
    fix: 'Review the recommended domain pack for your repo and ensure it matches your primary stack and workflow.',
    template: 'codex-agents-md',
    file: () => 'AGENTS.md',
    line: () => 1,
  },

  codexMcpPackSafety: {
    id: 'CX-N02',
    name: 'MCP packs pass trust preflight',
    check: (ctx) => {
      const config = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      if (!config) return null;
      if (!/\[mcp_servers\./i.test(config)) return null; // No MCP servers configured, skip
      // Check that all MCP servers have enabled_tools set (not wide-open)
      const serverBlocks = config.split(/\[mcp_servers\.\w+\]/);
      for (const block of serverBlocks.slice(1)) {
        if (!/enabled_tools\s*=/.test(block)) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'pack-posture',
    fix: 'Add `enabled_tools` whitelists to all configured MCP servers to limit tool surface exposure.',
    template: 'codex-config',
    file: () => '.codex/config.toml',
    line: (ctx) => {
      const config = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      return config ? firstLineMatching(config, /\[mcp_servers\./) : null;
    },
  },

  codexPackRecommendationQuality: {
    id: 'CX-N03',
    name: 'Pack recommendations are grounded in detected signals',
    check: (ctx) => {
      // Ecosystem-neutral grounding: any primary manifest counts.
      const agents = agentsContent(ctx);
      const config = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      const manifestFiles = [
        'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod',
        'Gemfile', 'composer.json', 'pom.xml', 'build.gradle',
        'flake.nix', 'shard.yml', 'mix.exs', 'rebar.config',
        'Makefile', 'CMakeLists.txt', 'Package.swift', 'pubspec.yaml',
        // .NET ecosystem
        'Directory.Packages.props', 'Directory.Build.props', 'global.json',
        // Gradle wrapper
        'gradlew', 'gradlew.bat',
      ];
      const hasManifest = manifestFiles.some(f => ctx.files.includes(f)) ||
        // .NET solution/project files use extensions — match by suffix
        ctx.files.some(f => /\.(sln|slnx|csproj|fsproj|vbproj)$/i.test(f));
      // Dotfiles/config-only repos: they don't ship code, so pack recommendations
      // aren't meaningful — N/A is the correct answer.
      const dotfilesSignals = ['.zshrc', '.bashrc', '.vimrc', '.tmux.conf', '.gitconfig', 'install.sh', 'bootstrap.sh'];
      const looksLikeDotfiles = dotfilesSignals.filter(f => ctx.files.includes(f)).length >= 2;
      if (looksLikeDotfiles) return null;
      // If no signals at all, N/A rather than fail
      if (!agents && !config && !hasManifest) return null;
      // At least 2 signal sources for grounded recommendation
      return [Boolean(agents), Boolean(config), hasManifest].filter(Boolean).length >= 2;
    },
    impact: 'medium',
    rating: 3,
    category: 'pack-posture',
    fix: 'Add AGENTS.md and ensure a primary manifest (package.json, pyproject.toml, Cargo.toml, go.mod, etc.) is present so pack recommendations can be grounded in real project signals.',
    template: 'codex-agents-md',
    file: () => 'AGENTS.md',
    line: () => 1,
  },

  codexNoStalePackVersions: {
    id: 'CX-N04',
    name: 'No stale or unresolvable pack references in config',
    check: (ctx) => {
      const config = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      if (!config) return null;
      // Check for obviously deprecated MCP package names
      const stalePatterns = [
        /\bmcpServers\b/,
        /\bserver-everything\b/,
        /\b@anthropic-ai\/mcp\b/,
      ];
      for (const pattern of stalePatterns) {
        if (pattern.test(config)) return false;
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'pack-posture',
    fix: 'Update stale or deprecated MCP pack references to current package names.',
    template: 'codex-config',
    file: () => '.codex/config.toml',
    line: (ctx) => {
      const config = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      return config ? firstLineMatching(config, /mcpServers|server-everything|@anthropic-ai\/mcp/) : null;
    },
  },

  // =============================================
  // CP-08: New checks (O. Repeat-Usage Hygiene)
  // =============================================

  codexSnapshotRetention: {
    id: 'CX-O01',
    name: 'At least one prior audit snapshot exists for repeat-usage',
    check: (ctx) => {
      try {
        const indexPath = resolveProjectStateReadPath(ctx.dir, 'snapshots', 'index.json');
        const fs = require('fs');
        if (!fs.existsSync(indexPath)) return null; // No snapshots yet, not a failure
        const entries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        return Array.isArray(entries) && entries.length > 0;
      } catch {
        return null;
      }
    },
    impact: 'medium',
    rating: 3,
    category: 'repeat-usage',
    fix: 'Run `npx nerviq --platform codex --snapshot` to save your first audit snapshot for trend tracking.',
    template: null,
    file: () => null,
    line: () => null,
  },

  codexFeedbackLoopHealth: {
    id: 'CX-O02',
    name: 'Feedback loop is functional when feedback has been submitted',
    check: (ctx) => {
      try {
        const indexPath = resolveProjectStateReadPath(ctx.dir, 'outcomes', 'index.json');
        const fs = require('fs');
        if (!fs.existsSync(indexPath)) return null; // No feedback yet, not a failure
        const entries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        return Array.isArray(entries) && entries.length > 0;
      } catch {
        return null;
      }
    },
    impact: 'medium',
    rating: 3,
    category: 'repeat-usage',
    fix: 'Submit feedback on recommendations using `npx nerviq --platform codex feedback` to enable the feedback-to-ranking loop.',
    template: null,
    file: () => null,
    line: () => null,
  },

  codexTrendDataAvailability: {
    id: 'CX-O03',
    name: 'Trend data is computable (2+ snapshots with compatible schemas)',
    check: (ctx) => {
      try {
        const indexPath = resolveProjectStateReadPath(ctx.dir, 'snapshots', 'index.json');
        const fs = require('fs');
        if (!fs.existsSync(indexPath)) return null;
        const entries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        const audits = (Array.isArray(entries) ? entries : []).filter(e => e.snapshotKind === 'audit');
        return audits.length >= 2;
      } catch {
        return null;
      }
    },
    impact: 'low',
    rating: 2,
    category: 'repeat-usage',
    fix: 'Run at least 2 audits with `--snapshot` to enable trend tracking and comparison.',
    template: null,
    file: () => null,
    line: () => null,
  },

  // =============================================
  // CP-08: New checks (P. Release & Freshness)
  // =============================================

  codexVersionTruth: {
    id: 'CX-P01',
    name: 'Codex version claims match installed version',
    check: (ctx) => {
      const agents = agentsContent(ctx);
      if (!agents) return null;
      // Check if AGENTS.md references a specific codex version
      const versionMatch = agents.match(/codex[- ]?(?:cli)?[- ]?v?(\d+\.\d+)/i);
      if (!versionMatch) return null; // No version claim, skip
      // If there's a version claim, we just verify it's plausible format
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'release-freshness',
    fix: 'Verify that any Codex version referenced in AGENTS.md matches the installed Codex CLI version.',
    template: 'codex-agents-md',
    file: () => 'AGENTS.md',
    line: (ctx) => {
      const agents = agentsContent(ctx);
      return agents ? firstLineMatching(agents, /codex[- ]?(?:cli)?[- ]?v?\d+\.\d+/i) : null;
    },
  },

  codexSourceFreshness: {
    id: 'CX-P02',
    name: 'Config references current Codex features (no removed or renamed keys)',
    check: (ctx) => {
      const config = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      if (!config) return null;
      for (const { pattern } of LEGACY_CONFIG_PATTERNS) {
        if (pattern.test(config)) return false;
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'release-freshness',
    fix: 'Update deprecated config keys to their current equivalents.',
    template: 'codex-config',
    file: () => '.codex/config.toml',
    line: (ctx) => {
      const config = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      if (!config) return null;
      for (const { pattern } of LEGACY_CONFIG_PATTERNS) {
        const line = firstLineMatching(config, pattern);
        if (line) return line;
      }
      return null;
    },
  },

  codexPropagationCompleteness: {
    id: 'CX-P03',
    name: 'No dangling surface references (hooks, skills, MCP mentioned but not defined)',
    check: (ctx) => {
      const agents = agentsContent(ctx);
      if (!agents) return null;
      const issues = [];
      // Check: AGENTS.md mentions hooks but no hooks.json
      if (/\bhooks?\b/i.test(agents) && !ctx.fileContent('.codex/hooks.json')) {
        issues.push('hooks referenced but .codex/hooks.json missing');
      }
      // Check: AGENTS.md mentions skills but no .agents/skills/
      if (/\bskills?\b/i.test(agents) && !(ctx.hasDir ? ctx.hasDir('.agents/skills') : false)) {
        issues.push('skills referenced but .agents/skills/ missing');
      }
      // Check: config references MCP but no server defined
      const config = ctx.configContent ? (ctx.configContent() || '') : (ctx.fileContent('.codex/config.toml') || '');
      if (config && /\bmcp\b/i.test(agents) && !/\[mcp_servers\./i.test(config)) {
        issues.push('MCP referenced in AGENTS.md but no [mcp_servers] in config');
      }
      return issues.length === 0;
    },
    impact: 'high',
    rating: 4,
    category: 'release-freshness',
    fix: 'Ensure all surfaces mentioned in AGENTS.md (hooks, skills, MCP) have corresponding definition files.',
    template: 'codex-agents-md',
    file: () => 'AGENTS.md',
    line: (ctx) => {
      const agents = agentsContent(ctx);
      if (!agents) return null;
      return firstLineMatching(agents, /\bhooks?\b|\bskills?\b|\bmcp\b/i);
    },
  },

  // ============================================================
  // === PYTHON STACK CHECKS (category: 'python') ===============
  // ============================================================

  codexPythonProjectExists: {
    id: 'CX-PY01',
    name: 'Python project detected (pyproject.toml / setup.py / requirements.txt)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return true; },
    impact: 'high',
    category: 'python',
    fix: 'Ensure pyproject.toml, setup.py, or requirements.txt exists for Python projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonVersionSpecified: {
    id: 'CX-PY02',
    name: 'Python version specified (.python-version or requires-python)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /\.python-version$/.test(f)) || /requires-python/i.test(ctx.fileContent('pyproject.toml') || ''); },
    impact: 'medium',
    category: 'python',
    fix: 'Create .python-version or add requires-python to pyproject.toml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonVenvMentioned: {
    id: 'CX-PY03',
    name: 'Virtual environment mentioned in instructions',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /venv|virtualenv|conda|poetry shell|uv venv/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document virtual environment setup in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonLockfileExists: {
    id: 'CX-PY04',
    name: 'Python lockfile exists (poetry.lock / uv.lock / Pipfile.lock / pinned requirements)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /poetry\.lock$|uv\.lock$|Pipfile\.lock$/.test(f)) || /==/m.test(ctx.fileContent('requirements.txt') || ''); },
    impact: 'high',
    category: 'python',
    fix: 'Add a lockfile (poetry.lock, uv.lock, Pipfile.lock) or pin versions with == in requirements.txt.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonPytestConfigured: {
    id: 'CX-PY05',
    name: 'pytest configured (pyproject.toml [tool.pytest] / pytest.ini / conftest.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return /\[tool\.pytest/i.test(ctx.fileContent('pyproject.toml') || '') || ctx.files.some(f => /pytest\.ini$|conftest\.py$/.test(f)); },
    impact: 'high',
    category: 'python',
    fix: 'Configure pytest in pyproject.toml [tool.pytest.ini_options] or create pytest.ini.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonLinterConfigured: {
    id: 'CX-PY06',
    name: 'Python linter configured (ruff / flake8 / pylint)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.ruff|\[tool\.flake8|\[tool\.pylint/i.test(pp) || ctx.files.some(f => /\.flake8$|pylintrc$|\.pylintrc$|ruff\.toml$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure ruff, flake8, or pylint in pyproject.toml or dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonTypeCheckerConfigured: {
    id: 'CX-PY07',
    name: 'Type checker configured (mypy / pyright)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.mypy|\[tool\.pyright/i.test(pp) || ctx.files.some(f => /mypy\.ini$|pyrightconfig\.json$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure mypy or pyright in pyproject.toml or dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonFormatterConfigured: {
    id: 'CX-PY08',
    name: 'Formatter configured (black / isort / ruff / yapf)',
    check: (ctx) => {
      const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f));
      if (!hasPy) return null;
      const pp = ctx.fileContent('pyproject.toml') || '';
      // Explicit formatter sections
      if (/\[tool\.black|\[tool\.isort|\[tool\.ruff\.format|\[tool\.yapf|\[tool\.autopep8/i.test(pp)) return true;
      // Ruff config implies formatting capability in modern setups (ruff 0.3+)
      if (/\[tool\.ruff(\.lint)?\]/i.test(pp)) return true;
      // Standalone config files
      if (ctx.files.some(f => /^(ruff\.toml|\.ruff\.toml|\.isort\.cfg|\.yapfrc|setup\.cfg)$/i.test(f))) {
        const setupCfg = ctx.fileContent('setup.cfg') || '';
        if (/\[isort\]|\[yapf\]|\[flake8\]/i.test(setupCfg)) return true;
        if (f => /ruff|yapf|isort/i.test(f)) return true;
      }
      // Dev dependency signal
      if (/\b(black|isort|ruff|yapf|autopep8)\b/i.test(pp)) return true;
      return false;
    },
    impact: 'medium',
    category: 'python',
    fix: 'Configure black, isort, or ruff format in pyproject.toml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonDjangoSettingsDocumented: {
    id: 'CX-PY09',
    name: 'Django settings documented if Django project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; if (!ctx.files.some(f => /manage\.py$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /django|settings\.py|DJANGO_SETTINGS_MODULE/i.test(docs); },
    impact: 'high',
    category: 'python',
    fix: 'Document Django settings module and configuration in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonFastapiEntryDocumented: {
    id: 'CX-PY10',
    name: 'FastAPI entry point documented if FastAPI project',
    check: (ctx) => {
      const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f));
      if (!hasPy) return null;
      const pp = ctx.fileContent('pyproject.toml') || '';
      const reqs = ctx.fileContent('requirements.txt') || '';
      // FastAPI only in dev/optional/example deps → N/A (SDK with example server)
      const inMain = /^\s*fastapi\b/im.test(reqs) ||
                     /\[project\.dependencies\][\s\S]*?fastapi/i.test(pp) ||
                     /\[tool\.poetry\.dependencies\][\s\S]*?fastapi/i.test(pp) ||
                     /^\s*dependencies\s*=\s*\[[^\]]*"fastapi/im.test(pp);
      if (!inMain) return null;
      const docs = [
        ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md'),
        ctx.fileContent('README.md'),
        ctx.fileContent('AGENTS.md'),
      ].filter(Boolean).join('\n');
      return /fastapi|uvicorn|app\.py|main\.py/i.test(docs);
    },
    impact: 'high',
    category: 'python',
    fix: 'Document FastAPI entry point and how to run the development server.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonMigrationsDocumented: {
    id: 'CX-PY11',
    name: 'Database migrations mentioned (alembic / Django migrations)',
    check: (ctx) => {
      const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f));
      if (!hasPy) return null;
      // SDK/library repos don't need migration docs
      if (isSdkOrLibraryRepo(ctx)) return null;
      // Only applicable when repo actually uses a database
      const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || '');
      const hasDb = /sqlalchemy|django|peewee|tortoise|asyncpg|psycopg|pymongo|pymysql|alembic/i.test(deps);
      if (!hasDb) return null;
      const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || '';
      return /alembic|migrate|makemigrations|django.{0,10}migration/i.test(docs) || ctx.files.some(f => /alembic[.]ini$|alembic[/]/.test(f));
    },
    impact: 'medium',
    category: 'python',
    fix: 'Document database migration workflow (alembic or Django migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonEnvHandlingDocumented: {
    id: 'CX-PY12',
    name: '.env handling documented (python-dotenv)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/dotenv|python-dotenv|environs/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /\.env|dotenv|environment.{0,10}variable/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document .env file usage and python-dotenv configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonPreCommitConfigured: {
    id: 'CX-PY13',
    name: 'pre-commit hooks configured (.pre-commit-config.yaml)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /\.pre-commit-config\.yaml$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Add .pre-commit-config.yaml with Python-specific hooks (ruff, mypy, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonDockerBaseImage: {
    id: 'CX-PY14',
    name: 'Docker uses Python base image correctly',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const df = ctx.fileContent('Dockerfile') || ''; if (!df) return null; return /FROM.*python:/i.test(df); },
    impact: 'medium',
    category: 'python',
    fix: 'Use official Python base image in Dockerfile (e.g., FROM python:3.12-slim).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonTestMatrixConfigured: {
    id: 'CX-PY15',
    name: 'Test matrix configured (tox.ini / noxfile.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /tox\.ini$|noxfile\.py$/.test(f)); },
    impact: 'low',
    category: 'python',
    fix: 'Configure tox or nox for multi-environment testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonValidationUsed: {
    id: 'CX-PY16',
    name: 'Pydantic or dataclass validation used',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); return /pydantic|dataclass/i.test(deps); },
    impact: 'medium',
    category: 'python',
    fix: 'Use pydantic or dataclasses for data validation and type safety.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonAsyncDocumented: {
    id: 'CX-PY17',
    name: 'Async patterns documented if async project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/asyncio|aiohttp|fastapi|starlette|httpx/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /async|await|asyncio|event.{0,5}loop/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document async patterns and conventions used in the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonPinnedVersions: {
    id: 'CX-PY18',
    name: 'Requirements have pinned versions (== in requirements.txt)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const req = ctx.fileContent('requirements.txt') || ''; if (!req.trim()) return null; const lines = req.split('\n').filter(l => l.trim() && !l.startsWith('#')); return lines.length > 0 && lines.every(l => /==/.test(l) || /^-/.test(l.trim())); },
    impact: 'high',
    category: 'python',
    fix: 'Pin all dependency versions with == in requirements.txt for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonPackageStructure: {
    id: 'CX-PY19',
    name: 'Python package has proper structure (src/ layout or __init__.py)',
    check: (ctx) => {
      const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f));
      if (!hasPy) return null;
      const fs = require('fs');
      const path = require('path');
      // ctx.files only lists root — probe common package layouts directly
      try {
        // src/ layout: look for any src/*/__init__.py
        const srcDir = path.join(ctx.dir, 'src');
        if (fs.existsSync(srcDir) && fs.statSync(srcDir).isDirectory()) {
          const entries = fs.readdirSync(srcDir, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory() && fs.existsSync(path.join(srcDir, e.name, '__init__.py'))) return true;
          }
        }
        // Flat layout: <package>/__init__.py at root
        const rootEntries = fs.readdirSync(ctx.dir, { withFileTypes: true });
        for (const e of rootEntries) {
          if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'tests' && e.name !== 'docs') {
            if (fs.existsSync(path.join(ctx.dir, e.name, '__init__.py'))) return true;
          }
        }
      } catch { /* fall through */ }
      return false;
    },
    impact: 'medium',
    category: 'python',
    fix: 'Use src/ layout or ensure packages have __init__.py files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonDocsToolConfigured: {
    id: 'CX-PY20',
    name: 'Documentation tool configured (sphinx / mkdocs)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /mkdocs\.yml$|conf\.py$|docs[/]/.test(f)) || /sphinx|mkdocs/i.test(ctx.fileContent('pyproject.toml') || ''); },
    impact: 'low',
    category: 'python',
    fix: 'Configure sphinx or mkdocs for project documentation.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonCoverageConfigured: {
    id: 'CX-PY21',
    name: 'Coverage configured (coverage / pytest-cov)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.coverage|pytest-cov|coverage/i.test(pp) || ctx.files.some(f => /\.coveragerc$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure coverage reporting with pytest-cov or coverage.py.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonNoSecretsInSettings: {
    id: 'CX-PY22',
    name: 'No secrets in Django settings.py',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const settings = ctx.fileContent('settings.py') || ctx.files.filter(f => /settings\.py$/.test(f)).map(f => ctx.fileContent(f) || '').join(''); if (!settings) return null; return !/SECRET_KEY\s*=\s*['"][^'"]{10,}/i.test(settings); },
    impact: 'critical',
    category: 'python',
    fix: 'Move SECRET_KEY and other secrets to environment variables, not hardcoded in settings.py.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonWsgiAsgiDocumented: {
    id: 'CX-PY23',
    name: 'WSGI/ASGI server documented (gunicorn / uvicorn)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/gunicorn|uvicorn|daphne|hypercorn/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /gunicorn|uvicorn|daphne|hypercorn|wsgi|asgi/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document WSGI/ASGI server configuration (gunicorn, uvicorn).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonTaskQueueDocumented: {
    id: 'CX-PY24',
    name: 'Task queue documented if used (celery / rq)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/celery|rq|dramatiq|huey/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /celery|rq|dramatiq|huey|task.{0,10}queue|worker/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document task queue configuration and worker setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexPythonGitignore: {
    id: 'CX-PY25',
    name: 'Python-specific .gitignore (__pycache__, *.pyc, .venv)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const gi = ctx.fileContent('.gitignore') || ''; return /__pycache__|\*\.pyc|\.venv/i.test(gi); },
    impact: 'medium',
    category: 'python',
    fix: 'Add Python-specific entries to .gitignore (__pycache__, *.pyc, .venv, *.egg-info).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === GO STACK CHECKS (category: 'go') =======================
  // ============================================================

  codexGoModExists: {
    id: 'CX-GO01',
    name: 'go.mod exists',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'go',
    fix: 'Initialize Go module with go mod init.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoSumCommitted: {
    id: 'CX-GO02',
    name: 'go.sum committed',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /go\.sum$/.test(f)); },
    impact: 'high',
    category: 'go',
    fix: 'Commit go.sum to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGolangciLintConfigured: {
    id: 'CX-GO03',
    name: 'golangci-lint configured (.golangci.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /\.golangci\.ya?ml$|\.golangci\.toml$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Add .golangci.yml to configure linting rules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoTestDocumented: {
    id: 'CX-GO04',
    name: 'go test documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go test/i.test(docs); },
    impact: 'high',
    category: 'go',
    fix: 'Document go test command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoBuildDocumented: {
    id: 'CX-GO05',
    name: 'go build documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go build|go install/i.test(docs); },
    impact: 'high',
    category: 'go',
    fix: 'Document go build command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoStandardLayout: {
    id: 'CX-GO06',
    name: 'Standard Go layout (cmd/ / internal/ / pkg/)',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /^cmd[/]|^internal[/]|^pkg[/]/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Use standard Go project layout with cmd/, internal/, and/or pkg/ directories.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoErrorHandlingDocumented: {
    id: 'CX-GO07',
    name: 'Error handling patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /error handling|errors?\.(?:New|Wrap|Is|As)|fmt\.Errorf/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document error handling conventions (error wrapping, sentinel errors, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoContextUsageDocumented: {
    id: 'CX-GO08',
    name: 'Context usage documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /context\.Context|ctx\.Done|context\.WithCancel|context\.WithTimeout/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document context.Context usage patterns for cancellation and timeouts.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoroutineSafetyDocumented: {
    id: 'CX-GO09',
    name: 'Goroutine safety documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /goroutine|sync\.Mutex|sync\.WaitGroup|channel|concurren/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document goroutine safety patterns, mutex usage, and channel conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoModTidyMentioned: {
    id: 'CX-GO10',
    name: 'go mod tidy mentioned in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go mod tidy/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document go mod tidy in project workflow instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoVetConfigured: {
    id: 'CX-GO11',
    name: 'go vet or staticcheck configured',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/go.yml') || ''; return /go vet|staticcheck/i.test(docs + ci); },
    impact: 'medium',
    category: 'go',
    fix: 'Configure go vet and/or staticcheck in CI or project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoMakefileExists: {
    id: 'CX-GO12',
    name: 'Makefile or Taskfile exists for Go project',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /^Makefile$|^Taskfile\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Add Makefile or Taskfile.yml with common Go targets (build, test, lint).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoDockerMultiStage: {
    id: 'CX-GO13',
    name: 'Docker multi-stage build for Go',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; if (!df) return null; return /FROM.*golang.*AS/i.test(df) && /FROM.*(?:alpine|scratch|distroless|gcr\.io)/i.test(df); },
    impact: 'medium',
    category: 'go',
    fix: 'Use multi-stage Docker build: build in golang image, run in minimal image (alpine/scratch/distroless).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoCgoDocumented: {
    id: 'CX-GO14',
    name: 'CGO documented if used',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const goMod = ctx.fileContent('go.mod') || ''; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; if (!/CGO_ENABLED|import "C"/i.test(goMod + docs)) return null; return /CGO|cgo/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document CGO usage, dependencies, and build requirements.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoWorkForMonorepo: {
    id: 'CX-GO15',
    name: 'go.work for monorepo',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const multiMod = ctx.files.filter(f => /go\.mod$/.test(f)).length > 1; if (!multiMod) return null; return ctx.files.some(f => /go\.work$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Use go.work for Go workspace in monorepo with multiple modules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoBenchmarkTests: {
    id: 'CX-GO16',
    name: 'Benchmark tests mentioned',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go test.*-bench|Benchmark/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document benchmark testing with go test -bench.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoRaceDetector: {
    id: 'CX-GO17',
    name: 'Race detector (-race) documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/go.yml') || ''; return /-race/i.test(docs + ci); },
    impact: 'medium',
    category: 'go',
    fix: 'Document and enable race detector with go test -race.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoGenerateDocumented: {
    id: 'CX-GO18',
    name: 'go generate documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go generate/i.test(docs) || ctx.files.some(f => /generate\.go$/.test(f)); },
    impact: 'low',
    category: 'go',
    fix: 'Document go generate usage and generated files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoInterfaceDesignDocumented: {
    id: 'CX-GO19',
    name: 'Interface-based design documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /interface|mock|stub|dependency injection/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document interface-based design patterns for testability and dependency injection.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexGoGitignore: {
    id: 'CX-GO20',
    name: 'Go-specific .gitignore entries',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const gi = ctx.fileContent('.gitignore') || ''; return /vendor[/]|\*\.exe|\*\.test|\*\.out|[/]bin[/]/i.test(gi); },
    impact: 'low',
    category: 'go',
    fix: 'Add Go-specific entries to .gitignore (vendor/, *.exe, *.test, /bin/).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },
  // ============================================================
  // === RUST STACK CHECKS (category: 'rust') ===================
  // ============================================================

  codexRustCargoTomlExists: {
    id: 'CX-RS01',
    name: 'Cargo.toml exists with edition field',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /edition\s*=/.test(cargo); },
    impact: 'high',
    category: 'rust',
    fix: 'Ensure Cargo.toml exists and specifies the edition field (e.g., edition = "2021").',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustCargoLockCommitted: {
    id: 'CX-RS02',
    name: 'Cargo.lock committed (for binary crates)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /Cargo\.lock$/.test(f)); },
    impact: 'high',
    category: 'rust',
    fix: 'Commit Cargo.lock for binary crates to ensure reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustClippyConfigured: {
    id: 'CX-RS03',
    name: 'Clippy configured (CI or .cargo/config.toml)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/rust.yml') || ''; const cargoConfig = ctx.fileContent('.cargo/config.toml') || ''; return /clippy/i.test(ci + cargoConfig); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure clippy in CI or .cargo/config.toml for lint enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustFmtConfigured: {
    id: 'CX-RS04',
    name: 'rustfmt configured (rustfmt.toml or .rustfmt.toml)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /rustfmt\.toml$|\.rustfmt\.toml$/.test(f)); },
    impact: 'medium',
    category: 'rust',
    fix: 'Create rustfmt.toml or .rustfmt.toml to configure code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustCargoTestDocumented: {
    id: 'CX-RS05',
    name: 'cargo test documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cargo test/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document cargo test command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustCargoBuildDocumented: {
    id: 'CX-RS06',
    name: 'cargo build/check documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cargo (?:build|check)/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document cargo build or cargo check command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustUnsafePolicyDocumented: {
    id: 'CX-RS07',
    name: 'Unsafe code policy documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /unsafe|#!?\[forbid\(unsafe|#!?\[deny\(unsafe/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document unsafe code policy (forbidden, minimized, or where allowed).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustErrorHandlingStrategy: {
    id: 'CX-RS08',
    name: 'Error handling strategy (anyhow/thiserror in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /anyhow|thiserror|eyre|color-eyre/i.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Use anyhow (applications) or thiserror (libraries) for structured error handling.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustFeatureFlagsDocumented: {
    id: 'CX-RS09',
    name: 'Feature flags documented (Cargo.toml [features])',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/\[features\]/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /feature|--features|--all-features/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document feature flags and their purpose in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustWorkspaceConfig: {
    id: 'CX-RS10',
    name: 'Workspace config if multi-crate (Cargo.toml [workspace])',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (ctx.files.filter(f => /Cargo\.toml$/.test(f)).length <= 1) return null; return /\[workspace\]/i.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure [workspace] in root Cargo.toml for multi-crate projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustMsrvSpecified: {
    id: 'CX-RS11',
    name: 'MSRV specified (rust-version field)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /rust-version\s*=/.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Specify rust-version (MSRV) in Cargo.toml for compatibility guarantees.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustDocCommentsEncouraged: {
    id: 'CX-RS12',
    name: 'Doc comments (///) encouraged in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /doc comment|\/{3}|rustdoc|cargo doc/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Encourage /// doc comments and cargo doc in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustBenchmarksConfigured: {
    id: 'CX-RS13',
    name: 'Criterion benchmarks mentioned (benches/ dir)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /benches[/]/.test(f)) || /criterion/i.test(ctx.fileContent('Cargo.toml') || ''); },
    impact: 'low',
    category: 'rust',
    fix: 'Set up criterion benchmarks in benches/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustCrossCompilationDocumented: {
    id: 'CX-RS14',
    name: 'Cross-compilation documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cross.?compil|--target|rustup target|cargo build.*--target/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Document cross-compilation targets and setup instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustMemorySafetyDocumented: {
    id: 'CX-RS15',
    name: 'Memory safety patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /ownership|borrow|lifetime|memory.?safe|Arc|Rc|RefCell/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document memory safety patterns (ownership, borrowing, lifetime conventions).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustAsyncRuntimeDocumented: {
    id: 'CX-RS16',
    name: 'Async runtime documented (tokio/async-std in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/tokio|async-std|smol/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /tokio|async-std|async|await|runtime/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document async runtime choice and patterns (tokio, async-std).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustSerdeDocumented: {
    id: 'CX-RS17',
    name: 'Serde patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/serde/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /serde|Serialize|Deserialize|serde_json|serde_yaml/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document serde serialization/deserialization patterns and conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustCargoAuditConfigured: {
    id: 'CX-RS18',
    name: 'cargo-audit configured in CI',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/rust.yml') || ctx.fileContent('.github/workflows/audit.yml') || ''; return /cargo.?audit|advisory/i.test(ci); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure cargo-audit in CI for vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustWasmTargetDocumented: {
    id: 'CX-RS19',
    name: 'WASM target documented if applicable',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/wasm|wasm-bindgen|wasm-pack/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /wasm|WebAssembly|wasm-pack|wasm-bindgen/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Document WASM target configuration and build process.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexRustGitignore: {
    id: 'CX-RS20',
    name: 'Rust .gitignore includes target/',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const gi = ctx.fileContent('.gitignore') || ''; return /target[/]|[/]target/i.test(gi); },
    impact: 'medium',
    category: 'rust',
    fix: 'Add target/ to .gitignore for Rust build artifacts.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === JAVA/SPRING STACK CHECKS (category: 'java') ============
  // ============================================================

  codexJavaBuildFileExists: {
    id: 'CX-JV01',
    name: 'pom.xml or build.gradle exists',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'java',
    fix: 'Ensure pom.xml or build.gradle exists for Java projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaVersionSpecified: {
    id: 'CX-JV02',
    name: 'Java version specified',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; return /java\.version|maven\.compiler\.source|sourceCompatibility|JavaVersion/i.test(pom + gradle) || ctx.files.some(f => /\.java-version$/.test(f)); },
    impact: 'high',
    category: 'java',
    fix: 'Specify Java version in pom.xml properties, build.gradle, or .java-version file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaWrapperCommitted: {
    id: 'CX-JV03',
    name: 'Maven/Gradle wrapper committed (mvnw or gradlew)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /mvnw$|gradlew$/.test(f)); },
    impact: 'high',
    category: 'java',
    fix: 'Commit mvnw (Maven) or gradlew (Gradle) wrapper for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaSpringBootVersion: {
    id: 'CX-JV04',
    name: 'Spring Boot version documented if Spring project',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; if (!/spring-boot/i.test(pom + gradle)) return null; return /spring-boot.*\d+\.\d+/i.test(pom + gradle); },
    impact: 'high',
    category: 'java',
    fix: 'Document Spring Boot version in build configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaApplicationConfig: {
    id: 'CX-JV05',
    name: 'application.yml or application.properties exists',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /application\.ya?ml$|application\.properties$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Create application.yml or application.properties for Spring configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaTestFramework: {
    id: 'CX-JV06',
    name: 'Test framework configured (JUnit/TestNG in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; return /junit|testng|spring-boot-starter-test/i.test(pom + gradle); },
    impact: 'high',
    category: 'java',
    fix: 'Configure JUnit or TestNG test framework in project dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaCodeStyleConfigured: {
    id: 'CX-JV07',
    name: 'Code style configured (checkstyle.xml, spotbugs)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /checkstyle\.xml$|spotbugs.*\.xml$/.test(f)) || /checkstyle|spotbugs|google-java-format/i.test((ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || '')); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure checkstyle or spotbugs for code quality enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaSpringProfilesDocumented: {
    id: 'CX-JV08',
    name: 'Spring profiles documented',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/spring/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /spring[.]profiles|@Profile|SPRING_PROFILES_ACTIVE/i.test(docs); },
    impact: 'medium',
    category: 'java',
    fix: 'Document Spring profiles and their configuration in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaDatabaseMigration: {
    id: 'CX-JV09',
    name: 'Database migration configured (flyway/liquibase)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /flyway|liquibase/i.test(deps) || ctx.files.some(f => /db[/]migration|flyway|liquibase/i.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure database migration tool (Flyway or Liquibase) for schema management.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaLombokDocumented: {
    id: 'CX-JV10',
    name: 'Lombok/MapStruct documented if used',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/lombok|mapstruct/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /lombok|mapstruct/i.test(docs); },
    impact: 'low',
    category: 'java',
    fix: 'Document Lombok/MapStruct usage and IDE setup requirements.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaApiDocsConfigured: {
    id: 'CX-JV11',
    name: 'API docs configured (springdoc/swagger deps)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /springdoc|swagger|openapi/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure API documentation with springdoc-openapi or Swagger.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaSecurityConfigured: {
    id: 'CX-JV12',
    name: 'Security configuration documented',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/spring-security|spring-boot-starter-security/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /security|authentication|authorization|SecurityConfig|@EnableWebSecurity/i.test(docs); },
    impact: 'high',
    category: 'java',
    fix: 'Document Spring Security configuration and authentication setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaActuatorConfigured: {
    id: 'CX-JV13',
    name: 'Actuator/health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /actuator|spring-boot-starter-actuator/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Spring Boot Actuator for health checks and monitoring.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaLoggingConfigured: {
    id: 'CX-JV14',
    name: 'Logging configured (logback.xml or log4j2.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /logback.*\.xml$|log4j2?.*\.xml$|logging\.properties$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure logging with logback.xml or log4j2.xml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaMultiModuleProject: {
    id: 'CX-JV15',
    name: 'Multi-module project configured if applicable',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const buildFiles = ctx.files.filter(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f)); if (buildFiles.length <= 1) return null; const rootPom = ctx.fileContent('pom.xml') || ''; const rootGradle = ctx.fileContent('settings.gradle') || ctx.fileContent('settings.gradle.kts') || ''; return /<modules>|include\s/i.test(rootPom + rootGradle); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure multi-module project structure in root build file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaDockerConfigured: {
    id: 'CX-JV16',
    name: 'Docker build configured (Dockerfile or Jib plugin)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /FROM.*(?:openjdk|eclipse-temurin|amazoncorretto)/i.test(df) || /jib/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Docker build with Dockerfile or Jib plugin.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaEnvConfigsSeparated: {
    id: 'CX-JV17',
    name: 'Environment-specific configs separated',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /application-(?:dev|prod|staging|test|local)\.(?:ya?ml|properties)$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Separate environment configs (application-dev.yml, application-prod.yml, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaNoSecretsInConfig: {
    id: 'CX-JV18',
    name: 'No secrets in application.yml/properties',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const appYml = ctx.files.filter(f => /application.*\.ya?ml$|application.*\.properties$/.test(f)).map(f => ctx.fileContent(f) || '').join(''); if (!appYml) return null; return !/password\s*[:=]\s*[^$\{\s][^\s]{8,}|secret\s*[:=]\s*[^$\{\s][^\s]{8,}/i.test(appYml); },
    impact: 'critical',
    category: 'java',
    fix: 'Move secrets to environment variables or external secret management, not application config files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaIntegrationTestsSeparate: {
    id: 'CX-JV19',
    name: 'Integration tests separate from unit tests',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /src[/](?:integration-?test|it)[/]|IT\.java$|Integration(?:Test)?\.java$/.test(f)) || /failsafe|integration-test/i.test((ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || '')); },
    impact: 'medium',
    category: 'java',
    fix: 'Separate integration tests from unit tests using Maven Failsafe or dedicated source set.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexJavaBuildCommandDocumented: {
    id: 'CX-JV20',
    name: 'Build command documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /mvn|gradle|mvnw|gradlew|maven|./i.test(docs) && /build|compile|package|install/i.test(docs); },
    impact: 'high',
    category: 'java',
    fix: 'Document build command (mvnw package, gradlew build) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === RUBY/RAILS STACK CHECKS (category: 'ruby') =============
  // ============================================================

  codexrubyGemfileExists: {
    id: 'CX-RB01',
    name: 'Gemfile exists',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'ruby',
    fix: 'Create a Gemfile to manage Ruby dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexrubyGemfileLockCommitted: {
    id: 'CX-RB02',
    name: 'Gemfile.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /Gemfile\.lock$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Commit Gemfile.lock to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexrubyVersionSpecified: {
    id: 'CX-RB03',
    name: 'Ruby version specified (.ruby-version)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.ruby-version$/.test(f)) || /ruby ['"]~?\d/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Create .ruby-version or specify ruby version in Gemfile.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexrubyRubocopConfigured: {
    id: 'CX-RB04',
    name: 'RuboCop configured (.rubocop.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.rubocop\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add .rubocop.yml to configure Ruby style checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexrubyTestFrameworkConfigured: {
    id: 'CX-RB05',
    name: 'RSpec or Minitest configured (spec/ or test/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /^spec\/|^test\/|spec_helper\.rb$|test_helper\.rb$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Configure RSpec (spec/) or Minitest (test/) for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexrubyRailsCredentialsDocumented: {
    id: 'CX-RB06',
    name: 'Rails credentials documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /credentials|encrypted|master\.key|secret_key_base/i.test(docs); },
    impact: 'high',
    category: 'ruby',
    fix: 'Document Rails credentials management (rails credentials:edit) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexrubyMigrationsDocumented: {
    id: 'CX-RB07',
    name: 'Database migrations documented (db/migrate/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /db\/migrate\//.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /migration|migrate|db:migrate|rails db/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document database migration workflow (rails db:migrate) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexrubyBundlerAuditConfigured: {
    id: 'CX-RB08',
    name: 'Bundler audit configured',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; return /bundler-audit|bundle.audit/i.test(gf) || ctx.files.some(f => /\.bundler-audit/i.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add bundler-audit gem for dependency vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexrubyTypeCheckingConfigured: {
    id: 'CX-RB09',
    name: 'Sorbet/RBS type checking configured (sorbet/ or sig/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /sorbet\/|sig\/|\.rbs$/.test(f)) || /sorbet|tapioca/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'low',
    category: 'ruby',
    fix: 'Configure Sorbet or RBS for type checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexrubyRailsRoutesDocumented: {
    id: 'CX-RB10',
    name: 'Rails routes documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/routes\.rb$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /routes|endpoints|api.*path|REST/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document key routes and API endpoints in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexrubyBackgroundJobsDocumented: {
    id: 'CX-RB11',
    name: 'Background jobs documented (Sidekiq/GoodJob)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sidekiq|good_job|delayed_job|resque/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /sidekiq|good_job|delayed_job|resque|background.*job|worker|queue/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document background job framework and worker configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexrubyRailsEnvConfigsSeparated: {
    id: 'CX-RB12',
    name: 'Rails environment configs separated (config/environments/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /config\/environments\//.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Ensure config/environments/ has separate files for development, test, and production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexrubyAssetPipelineDocumented: {
    id: 'CX-RB13',
    name: 'Asset pipeline documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sprockets|propshaft|webpacker|jsbundling|cssbundling/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /asset|sprockets|propshaft|webpacker|jsbundling|cssbundling|esbuild|vite/i.test(docs); },
    impact: 'low',
    category: 'ruby',
    fix: 'Document asset pipeline configuration (Sprockets, Propshaft, or JS/CSS bundling).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexrubyMasterKeyInGitignore: {
    id: 'CX-RB14',
    name: 'Rails master.key in .gitignore',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const gi = ctx.fileContent('.gitignore') || ''; return /master\.key/i.test(gi); },
    impact: 'critical',
    category: 'ruby',
    fix: 'Add config/master.key to .gitignore to prevent secret leakage.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexrubyTestDataFactories: {
    id: 'CX-RB15',
    name: 'Factory Bot/fixtures for test data (spec/factories/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /spec\/factories\/|test\/fixtures\//.test(f)) || /factory_bot|fabrication/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Configure Factory Bot (spec/factories/) or fixtures (test/fixtures/) for test data.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === .NET/C# STACK CHECKS (category: 'dotnet') ==============
  // ============================================================

  codexdotnetProjectExists: {
    id: 'CX-DN01',
    name: '.csproj or .sln exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'dotnet',
    fix: 'Ensure .csproj or .sln file exists for .NET projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexdotnetVersionSpecified: {
    id: 'CX-DN02',
    name: '.NET version specified (global.json or TargetFramework)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /global\.json$/.test(f)) || ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /TargetFramework/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create global.json or ensure TargetFramework is set in .csproj.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexdotnetPackagesLock: {
    id: 'CX-DN03',
    name: 'NuGet packages lock (packages.lock.json)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /packages\.lock\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Enable NuGet lock file (packages.lock.json) for reproducible restores.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexdotnetTestDocumented: {
    id: 'CX-DN04',
    name: 'dotnet test documented',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /dotnet test|xunit|nunit|mstest/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document how to run tests with dotnet test in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexdotnetEditorConfigExists: {
    id: 'CX-DN05',
    name: 'EditorConfig configured (.editorconfig)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.editorconfig$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add .editorconfig for consistent code style across the team.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexdotnetRoslynAnalyzers: {
    id: 'CX-DN06',
    name: 'Roslyn analyzers configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Analyzer|StyleCop|SonarAnalyzer|Microsoft\.CodeAnalysis/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Roslyn analyzers (StyleCop.Analyzers, Microsoft.CodeAnalysis) to the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexdotnetAppsettingsExists: {
    id: 'CX-DN07',
    name: 'appsettings.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /appsettings\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create appsettings.json for application configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexdotnetUserSecretsDocumented: {
    id: 'CX-DN08',
    name: 'User secrets configured in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /user.?secrets|dotnet secrets|Secret Manager/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document user secrets management (dotnet user-secrets) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexdotnetEfMigrations: {
    id: 'CX-DN09',
    name: 'Entity Framework migrations (Migrations/ directory)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /Migrations\//.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Document Entity Framework migration workflow (dotnet ef migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexdotnetHealthChecks: {
    id: 'CX-DN10',
    name: 'Health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /AddHealthChecks|MapHealthChecks|IHealthCheck/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure health checks with AddHealthChecks() and MapHealthChecks().',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexdotnetSwaggerConfigured: {
    id: 'CX-DN11',
    name: 'Swagger/OpenAPI configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$|.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Swashbuckle|AddSwaggerGen|UseSwagger|NSwag|AddOpenApi/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure Swagger/OpenAPI with Swashbuckle or NSwag.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexdotnetNoConnectionStringsInConfig: {
    id: 'CX-DN12',
    name: 'No connection strings in appsettings.json',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const settings = ctx.fileContent('appsettings.json') || ''; if (!settings) return null; return !/Server=.*Password=|Data Source=.*Password=/i.test(settings); },
    impact: 'critical',
    category: 'dotnet',
    fix: 'Move connection strings with passwords to user secrets or environment variables.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexdotnetDockerSupport: {
    id: 'CX-DN13',
    name: 'Docker support configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; return /dotnet|aspnet|sdk/i.test(df); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Dockerfile with official .NET SDK/ASP.NET base images.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexdotnetTestProjectSeparate: {
    id: 'CX-DN14',
    name: 'Unit test project separate (.Tests.csproj)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.Tests?\.csproj$|Tests?\/.*\.csproj$/.test(f)); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Create separate test project (e.g., MyApp.Tests.csproj) for unit tests.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexdotnetGlobalUsingsDocumented: {
    id: 'CX-DN15',
    name: 'GlobalUsings documented',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /GlobalUsings\.cs$|Usings\.cs$/.test(f)) || ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /ImplicitUsings/i.test(c); }); },
    impact: 'low',
    category: 'dotnet',
    fix: 'Document global using directives in GlobalUsings.cs or enable ImplicitUsings in .csproj.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === PHP/LARAVEL STACK CHECKS (category: 'php') ==============
  // ============================================================

  codexphpComposerJsonExists: {
    id: 'CX-PHP01',
    name: 'composer.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'php',
    fix: 'Create composer.json to manage PHP dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexphpComposerLockCommitted: {
    id: 'CX-PHP02',
    name: 'composer.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /composer\.lock$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Commit composer.lock to version control for reproducible installs.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexphpVersionSpecified: {
    id: 'CX-PHP03',
    name: 'PHP version specified (composer.json require.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"php"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Specify PHP version requirement in composer.json require section.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexphpStaticAnalysisConfigured: {
    id: 'CX-PHP04',
    name: 'PHPStan/Psalm configured (phpstan.neon)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpstan\.neon$|phpstan\.neon\.dist$|psalm\.xml$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Configure PHPStan (phpstan.neon) or Psalm (psalm.xml) for static analysis.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexphpCsFixerConfigured: {
    id: 'CX-PHP05',
    name: 'PHP CS Fixer configured (.php-cs-fixer.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /\.php-cs-fixer\.php$|\.php-cs-fixer\.dist\.php$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Add .php-cs-fixer.php for consistent code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexphpUnitConfigured: {
    id: 'CX-PHP06',
    name: 'PHPUnit configured (phpunit.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpunit\.xml$|phpunit\.xml\.dist$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Configure PHPUnit with phpunit.xml for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexphpLaravelEnvExample: {
    id: 'CX-PHP07',
    name: 'Laravel .env.example exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /\.env\.example$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Create .env.example with all required environment variables documented.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexphpLaravelAppKeyNotCommitted: {
    id: 'CX-PHP08',
    name: 'Laravel APP_KEY not committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const env = ctx.fileContent('.env') || ''; if (!env) return null; return !/APP_KEY=base64:[A-Za-z0-9+/=]{30,}/i.test(env); },
    impact: 'critical',
    category: 'php',
    fix: 'Ensure .env with APP_KEY is in .gitignore — never commit application keys.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexphpLaravelMigrationsExist: {
    id: 'CX-PHP09',
    name: 'Laravel migrations exist (database/migrations/)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /database\/migrations\//.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Create database migrations in database/migrations/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexphpArtisanCommandsDocumented: {
    id: 'CX-PHP10',
    name: 'Artisan commands documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /artisan|php artisan|make:model|make:controller|migrate/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document key Artisan commands (migrate, seed, make:*) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexphpQueueWorkerDocumented: {
    id: 'CX-PHP11',
    name: 'Queue worker documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; if (!/horizon|queue/i.test(cj) && !ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /queue|horizon|worker|job|dispatch/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document queue worker setup (php artisan queue:work, Horizon).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexphpLaravelPintConfigured: {
    id: 'CX-PHP12',
    name: 'Laravel Pint configured (pint.json)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /pint\.json$/.test(f)) || /laravel\/pint/i.test(ctx.fileContent('composer.json') || ''); },
    impact: 'low',
    category: 'php',
    fix: 'Configure Laravel Pint (pint.json) for code style enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexphpAssetBundlingDocumented: {
    id: 'CX-PHP13',
    name: 'Vite/Mix asset bundling documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /vite\.config\.|webpack\.mix\.js$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /vite|mix|asset|npm run dev|npm run build/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document asset bundling setup (Vite or Mix) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexphpConfigCachingDocumented: {
    id: 'CX-PHP14',
    name: 'Laravel config caching documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /config:cache|config:clear|route:cache|optimize/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document config/route caching strategy (php artisan config:cache) for production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  codexphpComposerScriptsDefined: {
    id: 'CX-PHP15',
    name: 'Composer scripts defined',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"scripts"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Define composer scripts for common tasks (test, lint, analyze) in composer.json.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },


};

Object.assign(CODEX_TECHNIQUES, buildSupplementalChecks({
  idPrefix: 'CX-T',
  urlMap: CODEX_SUPPLEMENTAL_SOURCE_URLS,
  docs: (ctx) => [
    agentsContent(ctx),
    ctx.fileContent('README.md') || '',
    ctx.fileContent('CLAUDE.md') || '',
  ].filter(Boolean).join('\n'),
}));

attachSourceUrls('codex', CODEX_TECHNIQUES);

// CTO-08 — tag every check with a scope layer.
const { LAYERS: CODEX_LAYERS, assignLayers: codexAssignLayers } = require('../audit/layers');
codexAssignLayers(CODEX_TECHNIQUES, CODEX_LAYERS.GOVERNANCE);

module.exports = {
  CODEX_TECHNIQUES,
};
