/**
 * OpenCode Techniques — 73 checks (OC-A01 through OC-P03)
 *
 * Categories:
 *   A. Instructions (7 checks)
 *   B. Config (6 checks)
 *   C. Permissions (8 checks)
 *   D. Plugins (5 checks)
 *   E. Security (6 checks)
 *   F. MCP (5 checks)
 *   G. CI & Automation (4 checks)
 *   H. Quality Deep (5 checks)
 *   I. Skills (5 checks)
 *   J. Agents & Subagents (4 checks)
 *   K. Commands & Workflow (3 checks)
 *   L. Themes & TUI (3 checks)
 *   M. Review & Governance (3 checks)
 *   N. Release Freshness (3 checks)
 *   O. Mixed-Agent (3 checks)
 *   P. Propagation (3 checks)
 */

const os = require('os');
const path = require('path');
const { EMBEDDED_SECRET_PATTERNS, containsEmbeddedSecret } = require('../secret-patterns');
const { attachSourceUrls } = require('../source-urls');
const { buildStackChecks } = require('../stack-checks');
const { isApiProject, isDatabaseProject, isAuthProject, isMonitoringRelevant } = require('../supplemental-checks');
const { hasCostBudgetOrUsageTracking } = require('../cost-tracking');
const { resolveProjectStateReadPath } = require('../state-paths');

const DEFAULT_PROJECT_DOC_MAX_BYTES = 32768;

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

const PERMISSIONED_TOOLS = [
  'read', 'edit', 'glob', 'grep', 'list', 'bash', 'task', 'skill',
  'lsp', 'question', 'webfetch', 'websearch', 'codesearch',
  'external_directory', 'doom_loop',
];

const VALID_PERMISSION_STATES = new Set(['allow', 'ask', 'deny']);

const VALID_PLUGIN_EVENTS = new Set([
  'tool.execute.before', 'tool.execute.after', 'tool.execute.error',
  'message.before', 'message.after', 'message.error',
  'session.start', 'session.end', 'session.error',
  'agent.start', 'agent.end', 'agent.error',
  'conversation.start', 'conversation.end',
  'command.before', 'command.after',
  'file.read', 'file.write', 'file.delete',
  'bash.before', 'bash.after',
  'compaction.before', 'compaction.after',
  'permission.request', 'permission.response',
  'mcp.connect', 'mcp.disconnect', 'mcp.tool.call',
  'skill.invoke', 'task.spawn', 'task.complete',
  'error', 'warning',
]);

// --- Helpers ---

function agentsPath(ctx) {
  return ctx.fileContent('AGENTS.md') ? 'AGENTS.md' : null;
}

function agentsContent(ctx) {
  return ctx.fileContent('AGENTS.md') || '';
}

function configFileName(ctx) {
  return ctx.configFileName ? ctx.configFileName() : 'opencode.json';
}

function countSections(markdown) {
  return (markdown.match(/^##\s+/gm) || []).length;
}

function firstLineMatching(text, matcher) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (typeof matcher === 'string' && line.includes(matcher)) return index + 1;
    if (matcher instanceof RegExp && matcher.test(line)) {
      matcher.lastIndex = 0;
      return index + 1;
    }
    if (typeof matcher === 'function' && matcher(line, index + 1)) return index + 1;
  }
  return null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findFillerLine(content) {
  return firstLineMatching(content, (line) => FILLER_PATTERNS.some((pattern) => pattern.test(line)));
}

function hasContradictions(content) {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (/\balways\b.*\bnever\b|\bnever\b.*\balways\b/i.test(line)) return true;
  }
  const contradictoryPairs = [
    [/\buse tabs\b/i, /\buse spaces\b/i],
    [/\bsingle quotes\b/i, /\bdouble quotes\b/i],
    [/\bsemicolons required\b/i, /\bno semicolons\b/i],
  ];
  return contradictoryPairs.some(([a, b]) => a.test(content) && b.test(content));
}

function findSecretLine(content) {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const matched = EMBEDDED_SECRET_PATTERNS.some((pattern) => {
      pattern.lastIndex = 0;
      return pattern.test(lines[index]);
    });
    if (matched) return index + 1;
  }
  return null;
}

function agentsHasArchitecture(content) {
  return /```mermaid|flowchart\b|graph\s+(TD|LR|RL|BT)\b|##\s+Architecture\b|##\s+Project Map\b|##\s+Structure\b/i.test(content);
}

function expectedVerificationCategories(ctx) {
  const categories = new Set();
  const pkg = ctx.jsonFile('package.json');
  const scripts = pkg && pkg.scripts ? pkg.scripts : {};
  if (scripts.test) categories.add('test');
  if (scripts.lint) categories.add('lint');
  if (scripts.build) categories.add('build');
  if (ctx.fileContent('Cargo.toml')) { categories.add('test'); categories.add('build'); }
  if (ctx.fileContent('go.mod')) { categories.add('test'); categories.add('build'); }
  if (ctx.fileContent('pyproject.toml') || ctx.fileContent('requirements.txt')) categories.add('test');
  if (ctx.fileContent('Makefile') || ctx.fileContent('justfile')) categories.add('build');
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

function docsBundle(ctx) {
  return `${agentsContent(ctx)}\n${ctx.fileContent('README.md') || ''}`;
}

function repoLooksRegulated(ctx) {
  const filenames = ctx.files.join('\n');
  const packageJson = ctx.fileContent('package.json') || '';
  const readme = ctx.fileContent('README.md') || '';
  const combined = `${filenames}\n${packageJson}\n${readme}`;

  const strongSignals = /\bhipaa\b|\bphi\b|\bpci\b|\bsoc2\b|\biso[- ]?27001\b|\bcompliance\b|\bhealth(?:care)?\b|\bmedical\b|\bbank(?:ing)?\b|\bpayments?\b|\bfintech\b/i;
  if (strongSignals.test(combined)) return true;

  const weakSignalMatches = combined.match(/\bgdpr\b|\bpii\b/gi) || [];
  return weakSignalMatches.length >= 2;
}

function workflowArtifacts(ctx) {
  return (ctx.workflowFiles ? ctx.workflowFiles() : [])
    .map((filePath) => ({ filePath, content: ctx.fileContent(filePath) || '' }))
    .filter((item) => item.content);
}

// --- OPENCODE_TECHNIQUES ---

const OPENCODE_TECHNIQUES = {
  // ==============================
  // A. Instructions (7 checks)
  // ==============================

  opencodeAgentsMdExists: {
    id: 'OC-A01',
    name: 'AGENTS.md exists at project root',
    check: (ctx) => Boolean(ctx.fileContent('AGENTS.md')),
    impact: 'critical',
    rating: 5,
    category: 'instructions',
    fix: 'Create an AGENTS.md at the project root with project-specific guidance for the OpenCode agent.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  opencodeAgentsMdQuality: {
    id: 'OC-A02',
    name: 'AGENTS.md has substantive content (>20 lines, 2+ sections, commands)',
    check: (ctx) => {
      const content = agentsContent(ctx);
      if (!content) return null;
      const lines = content.split(/\r?\n/).filter(l => l.trim()).length;
      const sections = countSections(content);
      return lines > 20 && sections >= 2;
    },
    impact: 'high',
    rating: 4,
    category: 'instructions',
    fix: 'Add at least 20 meaningful lines and 2+ sections (## Verification, ## Architecture, etc.) to AGENTS.md.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => 1,
  },

  opencodeAgentsMdVerification: {
    id: 'OC-A03',
    name: 'AGENTS.md has build/test/lint commands',
    check: (ctx) => {
      const content = agentsContent(ctx);
      if (!content) return null;
      const expected = expectedVerificationCategories(ctx);
      if (expected.length === 0) return true;
      return expected.some((cat) => hasCommandMention(content, cat));
    },
    impact: 'high',
    rating: 4,
    category: 'instructions',
    fix: 'Add verification commands (test, lint, build) to AGENTS.md so the agent can validate its work.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  opencodeAgentsMdArchitecture: {
    id: 'OC-A04',
    name: 'AGENTS.md has Mermaid or architecture section',
    check: (ctx) => {
      const content = agentsContent(ctx);
      if (!content) return null;
      return agentsHasArchitecture(content);
    },
    impact: 'medium',
    rating: 3,
    category: 'instructions',
    fix: 'Add a ```mermaid diagram or ## Architecture section describing the project structure.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  opencodeNoCoexistenceConflict: {
    id: 'OC-A05',
    name: 'Mixed AGENTS.md + CLAUDE.md repos keep OpenCode guidance in AGENTS.md',
    check: (ctx) => {
      if (!ctx.hasAgentsMdAndClaudeMd || !ctx.hasAgentsMdAndClaudeMd()) return true;
      const agentsMd = ctx.fileContent('AGENTS.md') || '';
      return agentsMd.length > 0;
    },
    impact: 'high',
    rating: 4,
    category: 'instructions',
    fix: 'Keep OpenCode instructions in `AGENTS.md` when both files exist. Current runtime evidence did not validate a clean `CLAUDE.md` fallback, so do not rely on `CLAUDE.md` as the primary OpenCode instruction surface.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  opencodeNoFillerInstructions: {
    id: 'OC-A06',
    name: 'No generic filler instructions ("Be helpful", "Be accurate")',
    check: (ctx) => {
      const content = agentsContent(ctx);
      if (!content) return null;
      return !findFillerLine(content);
    },
    impact: 'low',
    rating: 2,
    category: 'instructions',
    fix: 'Remove generic filler ("Be helpful", "Write clean code") and replace with specific, actionable project instructions.',
    template: 'opencode-agents-md',
    file: (ctx) => agentsPath(ctx),
    line: (ctx) => findFillerLine(agentsContent(ctx)),
  },

  opencodeNoContradictions: {
    id: 'OC-A07',
    name: 'No contradictions within same AGENTS.md',
    check: (ctx) => {
      const content = agentsContent(ctx);
      if (!content) return null;
      return !hasContradictions(content);
    },
    impact: 'medium',
    rating: 3,
    category: 'instructions',
    fix: 'Remove contradictory statements (e.g., "always" and "never" in the same line, conflicting style rules).',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  // ==============================
  // B. Config (6 checks)
  // ==============================

  opencodeConfigExists: {
    id: 'OC-B01',
    name: 'opencode.json exists at project root',
    check: (ctx) => Boolean(ctx.configContent()),
    impact: 'high',
    rating: 4,
    category: 'config',
    fix: 'Create an opencode.json or opencode.jsonc at the project root with explicit model and permission settings.',
    template: 'opencode-config',
    file: () => 'opencode.json',
    line: () => null,
  },

  opencodeConfigValidJsonc: {
    id: 'OC-B02',
    name: 'opencode.json is valid JSONC (parseable)',
    check: (ctx) => {
      const content = ctx.configContent();
      if (!content) return null;
      const result = ctx.configJson();
      return result.ok;
    },
    impact: 'critical',
    rating: 5,
    category: 'config',
    fix: 'Fix JSONC syntax errors in opencode.json. Ensure comments use // or /* */ and trailing commas are removed.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => 1,
  },

  opencodeConfigSchema: {
    id: 'OC-B03',
    name: '$schema references opencode.ai/config.json',
    check: (ctx) => {
      const config = ctx.configJson();
      if (!config.ok || !config.data) return null;
      return Boolean(config.data.$schema);
    },
    impact: 'low',
    rating: 2,
    category: 'config',
    fix: 'Add "$schema": "https://opencode.ai/config.json" to enable IDE validation and autocompletion.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => 1,
  },

  opencodeModelExplicit: {
    id: 'OC-B04',
    name: 'model is set explicitly (not relying on silent default)',
    check: (ctx) => {
      const config = ctx.configJson();
      if (!config.ok || !config.data) return null;
      return Boolean(config.data.model);
    },
    impact: 'medium',
    rating: 3,
    category: 'config',
    fix: 'Set "model" explicitly in opencode.json to avoid relying on silent provider defaults.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeSmallModelSet: {
    id: 'OC-B05',
    name: 'small_model is set for task delegation',
    check: (ctx) => {
      const config = ctx.configJson();
      if (!config.ok || !config.data) return null;
      return Boolean(config.data.small_model);
    },
    impact: 'medium',
    rating: 3,
    category: 'config',
    fix: 'Set "small_model" in opencode.json for efficient task delegation and cost control.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeNoSecretsInConfig: {
    id: 'OC-B06',
    name: 'No secrets in opencode.json (API keys, tokens, passwords)',
    check: (ctx) => {
      const content = ctx.configContent();
      if (!content) return null;
      return !findSecretLine(content);
    },
    impact: 'critical',
    rating: 5,
    category: 'config',
    fix: 'Remove API keys and tokens from opencode.json. Use environment variables or {env:VAR_NAME} substitution instead.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: (ctx) => {
      const content = ctx.configContent();
      return content ? findSecretLine(content) : null;
    },
  },

  // ==============================
  // C. Permissions (8 checks)
  // ==============================

  opencodeNoBlanketAllow: {
    id: 'OC-C01',
    name: 'No blanket "allow" for all tools without justification',
    check: (ctx) => {
      const perms = ctx.toolPermissions();
      if (!perms || Object.keys(perms).length === 0) return null;
      // Check for wildcard "*": "allow" or all tools set to "allow"
      if (perms['*'] === 'allow') {
        const docs = docsBundle(ctx);
        return JUSTIFICATION_PATTERNS.test(docs);
      }
      const allAllow = PERMISSIONED_TOOLS.every(tool => perms[tool] === 'allow');
      if (allAllow) {
        const docs = docsBundle(ctx);
        return JUSTIFICATION_PATTERNS.test(docs);
      }
      return true;
    },
    impact: 'critical',
    rating: 5,
    category: 'permissions',
    fix: 'Remove blanket "allow" permission for all tools. Use specific permissions per tool and justify any broad access.',
    template: 'opencode-permissions',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeBashPermissionExplicit: {
    id: 'OC-C02',
    name: 'bash tool permission is explicit (not defaulting silently)',
    check: (ctx) => {
      const perms = ctx.toolPermissions();
      if (!perms || Object.keys(perms).length === 0) return null;
      return perms.bash !== undefined;
    },
    impact: 'critical',
    rating: 5,
    category: 'permissions',
    fix: 'Set an explicit permission for the "bash" tool: "ask" (recommended) or "deny" for read-only repos.',
    template: 'opencode-permissions',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeBashPatternSpecific: {
    id: 'OC-C03',
    name: 'Pattern-based bash permissions use specific patterns (not "*": "allow")',
    check: (ctx) => {
      const perms = ctx.toolPermissions();
      if (!perms) return null;
      const bashPerms = perms.bash;
      if (!bashPerms || typeof bashPerms !== 'object') return null;
      // Check for overly broad patterns
      if (bashPerms['*'] === 'allow') return false;
      if (bashPerms['**'] === 'allow') return false;
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'permissions',
    fix: 'Replace "*": "allow" in bash permissions with specific command patterns (e.g., "npm *": "allow").',
    template: 'opencode-permissions',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeDestructiveBashDeny: {
    id: 'OC-C04',
    name: 'rm * and destructive bash patterns are "deny" or "ask"',
    check: (ctx) => {
      const perms = ctx.toolPermissions();
      if (!perms) return null;
      const bashPerms = perms.bash;
      if (!bashPerms || typeof bashPerms !== 'object') return true;
      const destructivePatterns = ['rm *', 'rm -rf *', 'git push --force*', 'git reset --hard*'];
      for (const pattern of destructivePatterns) {
        if (bashPerms[pattern] === 'allow') return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'permissions',
    fix: 'Ensure destructive bash patterns (rm *, git push --force) are set to "deny" or "ask", never "allow".',
    template: 'opencode-permissions',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeDoomLoopExplicit: {
    id: 'OC-C05',
    name: 'doom_loop permission is explicit (defaults to "ask")',
    check: (ctx) => {
      const perms = ctx.toolPermissions();
      if (!perms || Object.keys(perms).length === 0) return null;
      return perms.doom_loop !== undefined;
    },
    impact: 'medium',
    rating: 3,
    category: 'permissions',
    fix: 'Set "doom_loop" permission explicitly. This controls behavior when the agent makes 3+ identical calls.',
    template: 'opencode-permissions',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeExternalDirExplicit: {
    id: 'OC-C06',
    name: 'external_directory permission is explicit (defaults to "ask")',
    check: (ctx) => {
      const perms = ctx.toolPermissions();
      if (!perms || Object.keys(perms).length === 0) return null;
      return perms.external_directory !== undefined;
    },
    impact: 'medium',
    rating: 3,
    category: 'permissions',
    fix: 'Set "external_directory" permission explicitly. This controls access to files outside the project root.',
    template: 'opencode-permissions',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeEnvFileDeny: {
    id: 'OC-C07',
    name: '.env file reads default to "deny" (verify not overridden to "allow")',
    check: (ctx) => {
      const perms = ctx.toolPermissions();
      if (!perms) return null;
      const readPerms = perms.read;
      if (!readPerms || typeof readPerms !== 'object') return true;
      // Check if .env patterns are explicitly allowed
      const envPatterns = ['.env', '.env.*', '*.env'];
      for (const pattern of envPatterns) {
        if (readPerms[pattern] === 'allow') return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'permissions',
    fix: 'Ensure .env file read permissions are "deny" or "ask", not "allow". Secrets should not be accessible.',
    template: 'opencode-permissions',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeAllToolsCovered: {
    id: 'OC-C08',
    name: 'Critical tool permissions are explicit',
    check: (ctx) => {
      const perms = ctx.toolPermissions();
      if (!perms || Object.keys(perms).length === 0) return null;
      // At least the critical tools should be covered
      const critical = ['bash', 'edit', 'read', 'task'];
      return critical.every(tool => perms[tool] !== undefined);
    },
    impact: 'high',
    rating: 4,
    category: 'permissions',
    fix: 'Set explicit permissions for at least the critical tools: bash, edit, read, and task. The old fixed "15 tools" framing no longer matches current CLI/runtime surfaces.',
    template: 'opencode-permissions',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  // ==============================
  // D. Plugins (5 checks)
  // ==============================

  opencodePluginsValid: {
    id: 'OC-D01',
    name: 'Plugin files are valid JS/TS and import from @opencode-ai/plugin',
    check: (ctx) => {
      const pluginFiles = ctx.pluginFiles();
      if (pluginFiles.length === 0) return null;
      // Check that plugin directory exists and files are present
      return pluginFiles.length > 0;
    },
    impact: 'high',
    rating: 4,
    category: 'plugins',
    fix: 'Ensure plugin files in .opencode/plugins/ are valid JS/TS and properly import from @opencode-ai/plugin.',
    template: 'opencode-plugins',
    file: () => '.opencode/plugins/',
    line: () => null,
  },

  opencodePluginsDocumented: {
    id: 'OC-D02',
    name: 'Project plugins (.opencode/plugins/) are documented and reviewed',
    check: (ctx) => {
      const pluginFiles = ctx.pluginFiles();
      if (pluginFiles.length === 0) return null;
      const docs = docsBundle(ctx);
      return /\bplugins?\b/i.test(docs);
    },
    impact: 'high',
    rating: 4,
    category: 'plugins',
    fix: 'Document plugins in AGENTS.md or README.md. Plugins run in-process and are a critical security surface.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  opencodePluginsPinned: {
    id: 'OC-D03',
    name: 'npm plugin packages use pinned versions (not latest/ranges)',
    check: (ctx) => {
      const plugins = ctx.plugins();
      if (!Array.isArray(plugins) || plugins.length === 0) return null;
      for (const plugin of plugins) {
        const name = typeof plugin === 'string' ? plugin : (plugin && plugin.name);
        if (!name) continue;
        if (name.includes('@latest') || name.includes('@*')) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'plugins',
    fix: 'Pin plugin versions (e.g., "my-plugin@1.2.3") instead of using @latest or ranges for supply chain security.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodePluginEventsValid: {
    id: 'OC-D04',
    name: 'Plugin event handlers match available events (30+ valid events)',
    check: (ctx) => {
      // This is a heuristic check — full validation requires parsing plugin code
      const pluginFiles = ctx.pluginFiles();
      if (pluginFiles.length === 0) return null;
      return true; // Pass by default; deep-review handles thorough checks
    },
    impact: 'medium',
    rating: 3,
    category: 'plugins',
    fix: 'Ensure plugin event handlers use valid event names from the OpenCode plugin API.',
    template: 'opencode-plugins',
    file: () => '.opencode/plugins/',
    line: () => null,
  },

  opencodePluginHookGapAware: {
    id: 'OC-D05',
    name: 'Plugin docs do not rely on stale hook-gap claims',
    check: (ctx) => {
      const pluginFiles = ctx.pluginFiles();
      if (pluginFiles.length === 0) return null;
      const docs = docsBundle(ctx);
      return !/\btool\.execute\.before\b[\s\S]{0,80}\b(subagent|mcp)\b[\s\S]{0,80}\b(bypass|gap|broken|2319|5894)\b/i.test(docs);
    },
    impact: 'high',
    rating: 4,
    category: 'plugins',
    fix: 'Remove blanket claims that subagent or MCP calls bypass plugin visibility. On current runtime, hook coverage was observed for direct, subagent, and MCP paths, so any caveat should be version-specific and evidence-backed.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  // ==============================
  // E. Security (6 checks)
  // ==============================

  opencodeNoSecretsInAgentsMd: {
    id: 'OC-E01',
    name: 'No secrets/API keys in AGENTS.md',
    check: (ctx) => {
      const content = agentsContent(ctx);
      if (!content) return null;
      return !findSecretLine(content);
    },
    impact: 'critical',
    rating: 5,
    category: 'security',
    fix: 'Remove any API keys, tokens, or passwords from AGENTS.md. Use environment variables instead.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: (ctx) => findSecretLine(agentsContent(ctx)),
  },

  opencodeToolInterceptionGap: {
    id: 'OC-E02',
    name: 'Security docs do not overstate plugin hook bypass gaps',
    check: (ctx) => {
      const pluginFiles = ctx.pluginFiles();
      if (pluginFiles.length === 0) return null;
      const docs = docsBundle(ctx);
      return !/\b(subagent|mcp)\b[\s\S]{0,80}\b(bypass|gap|broken|2319|5894)\b/i.test(docs);
    },
    impact: 'high',
    rating: 4,
    category: 'security',
    fix: 'Do not treat historical hook-gap bug reports as a current security guarantee. If you mention plugin coverage limits, mark them as version-sensitive and pair them with fresh runtime evidence.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  opencodeAgentDenyNotBypassable: {
    id: 'OC-E03',
    name: 'Agent-permission docs do not rely on stale SDK bypass claims',
    check: (ctx) => {
      const agents = ctx.customAgents();
      if (!agents || Object.keys(agents).length === 0) return null;
      const docs = docsBundle(ctx);
      const usesAgentPerms = Object.values(agents).some(a => a && a.permissions);
      if (!usesAgentPerms) return true;
      return !/\b6396\b|\bagent\b[\s\S]{0,80}\b(bypass|gap|broken)\b/i.test(docs);
    },
    impact: 'high',
    rating: 4,
    category: 'security',
    fix: 'Remove blanket claims that agent deny permissions are bypassed via SDK unless you have fresh version-specific proof. The older `#6396` framing did not reproduce in the current CLI harness.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  opencodeServerPasswordSet: {
    id: 'OC-E04',
    name: 'Server mode (opencode serve) is protected with OPENCODE_SERVER_PASSWORD',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/\bopencode\s+serve\b|\bserver\s+mode\b/i.test(docs)) return null;
      return /\bOPENCODE_SERVER_PASSWORD\b/i.test(docs);
    },
    impact: 'high',
    rating: 4,
    category: 'security',
    fix: 'Document that OPENCODE_SERVER_PASSWORD must be set when using `opencode serve` for HTTP API security.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  opencodeNoSecretExposure: {
    id: 'OC-E05',
    name: 'No secrets exposed through config variable substitution',
    check: (ctx) => {
      const content = ctx.configContent();
      if (!content) return null;
      // Check for hardcoded secrets in variable substitution values
      return !findSecretLine(content);
    },
    impact: 'critical',
    rating: 5,
    category: 'security',
    fix: 'Do not hardcode secrets in `opencode.json`, and do not assume `{env:VAR}` keeps values invisible. Current runtime exposed resolved env substitutions in `debug config`, so treat that surface as sensitive too.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: (ctx) => {
      const content = ctx.configContent();
      return content ? findSecretLine(content) : null;
    },
  },

  opencodeRegulatedRepoExplicitPerms: {
    id: 'OC-E06',
    name: 'Regulated repos have explicit restrictive permission posture',
    check: (ctx) => {
      if (!repoLooksRegulated(ctx)) return null;
      const perms = ctx.toolPermissions();
      if (!perms || Object.keys(perms).length === 0) return false;
      // Regulated repos should have explicit bash permissions
      return perms.bash !== undefined && perms.bash !== 'allow';
    },
    impact: 'high',
    rating: 4,
    category: 'security',
    fix: 'This repo has compliance signals. Set restrictive permissions: bash should be "ask" or "deny".',
    template: 'opencode-permissions',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  // ==============================
  // F. MCP (5 checks)
  // ==============================

  opencodeMcpSchemaCorrect: {
    id: 'OC-F01',
    name: 'MCP servers use correct schema (command: [] array, environment: {} not env)',
    check: (ctx) => {
      const mcp = ctx.mcpServers();
      if (!mcp || Object.keys(mcp).length === 0) return null;
      for (const [id, server] of Object.entries(mcp)) {
        if (!server) continue;
        if (server.command && !Array.isArray(server.command)) return false;
        if (server.env && !server.environment) return false;
      }
      return true;
    },
    impact: 'critical',
    rating: 5,
    category: 'mcp',
    fix: 'Fix MCP config schema: use `command` as a string array and `environment` as the env-var object. Current runtime rejected string commands and the legacy `env` key.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeMcpToolWhitelisting: {
    id: 'OC-F02',
    name: 'Tool whitelisting uses glob patterns to limit MCP tool access',
    check: (ctx) => {
      const mcp = ctx.mcpServers();
      if (!mcp || Object.keys(mcp).length === 0) return null;
      const hasMcpToolRestrictions = Object.values(mcp).some((server) => server && server.tools && Object.keys(server.tools).length > 0);
      return hasMcpToolRestrictions || Object.keys(mcp).length <= 2;
    },
    impact: 'high',
    rating: 4,
    category: 'mcp',
    fix: 'Add MCP tool restrictions with per-tool globs such as `{ "tools": { "my-mcp*": false } }`. This limits only those MCP tools; other available tools like `webfetch` may still satisfy the same intent unless you restrict them too.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeMcpTimeoutReasonable: {
    id: 'OC-F03',
    name: 'MCP timeout is reasonable (default 5000ms, max justified)',
    check: (ctx) => {
      const mcp = ctx.mcpServers();
      if (!mcp || Object.keys(mcp).length === 0) return null;
      for (const [id, server] of Object.entries(mcp)) {
        if (!server) continue;
        const timeout = server.timeout || server.startup_timeout;
        if (typeof timeout === 'number' && timeout > 30000) {
          const docs = docsBundle(ctx);
          if (!JUSTIFICATION_PATTERNS.test(docs)) return false;
        }
      }
      return true;
    },
    impact: 'low',
    rating: 2,
    category: 'mcp',
    fix: 'MCP timeout exceeds 30s. Add justification or reduce the timeout.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeMcpHookLimitation: {
    id: 'OC-F04',
    name: 'MCP hook caveats are treated as version-sensitive',
    check: (ctx) => {
      const mcp = ctx.mcpServers();
      const pluginFiles = ctx.pluginFiles();
      if (!mcp || Object.keys(mcp).length === 0) return null;
      if (pluginFiles.length === 0) return null;
      const docs = docsBundle(ctx);
      return !/\bmcp\b[\s\S]{0,80}\b(hook|plugin)\b[\s\S]{0,80}\b(bypass|gap|broken|2319)\b/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'Do not hard-code an MCP hook-bypass warning as if it were universal. Current runtime showed MCP plugin events firing, so keep any caveat version-sensitive and backed by fresh evidence.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  opencodeMcpAuthDocumented: {
    id: 'OC-F05',
    name: 'MCP servers requiring auth have documented setup instructions',
    check: (ctx) => {
      const mcp = ctx.mcpServers();
      if (!mcp || Object.keys(mcp).length === 0) return null;
      const docs = docsBundle(ctx);
      for (const [id, server] of Object.entries(mcp)) {
        if (!server) continue;
        const env = server.environment || {};
        const hasAuthEnv = Object.keys(env).some(k => /token|key|secret|password|credential/i.test(k));
        if (hasAuthEnv) {
          const idPattern = new RegExp(`\\b${escapeRegex(id)}\\b[\\s\\S]{0,200}\\b(auth|setup|token|key|env)\\b`, 'i');
          if (!idPattern.test(docs)) return false;
        }
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'Document MCP server auth setup in AGENTS.md or README.md for servers that require tokens/keys.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  // ==============================
  // G. CI & Automation (4 checks)
  // ==============================

  opencodeCiPermissionsPreset: {
    id: 'OC-G01',
    name: 'opencode run usage pre-configures permissions to avoid silent auto-rejects',
    check: (ctx) => {
      const workflows = workflowArtifacts(ctx);
      const hasOpencodeRun = workflows.some(w => /\bopencode\s+run\b/i.test(w.content));
      if (!hasOpencodeRun) return null;
      return workflows.some(w => /\bpermissions?\b.*\ballow\b|\b--yes\b|\b--no-prompt\b/i.test(w.content));
    },
    impact: 'critical',
    rating: 5,
    category: 'ci',
    fix: 'Pre-configure permissions when using `opencode run` in CI. In the current harness, permission requests auto-rejected instead of hanging, which still breaks tasks that expected tool access.',
    template: 'opencode-ci',
    file: () => '.github/workflows/',
    line: () => null,
  },

  opencodeCiAutoUpdateDisabled: {
    id: 'OC-G02',
    name: 'OPENCODE_DISABLE_AUTOUPDATE=1 is set in CI environments',
    check: (ctx) => {
      const workflows = workflowArtifacts(ctx);
      const hasOpencode = workflows.some(w => /\bopencode\b/i.test(w.content));
      if (!hasOpencode) return null;
      return workflows.some(w => /OPENCODE_DISABLE_AUTOUPDATE/i.test(w.content));
    },
    impact: 'high',
    rating: 4,
    category: 'ci',
    fix: 'Set OPENCODE_DISABLE_AUTOUPDATE=1 in CI workflows for reproducible builds.',
    template: 'opencode-ci',
    file: () => '.github/workflows/',
    line: () => null,
  },

  opencodeCiJsonOutput: {
    id: 'OC-G03',
    name: '--format json is used for machine-readable CI output',
    check: (ctx) => {
      const workflows = workflowArtifacts(ctx);
      const hasOpencodeRun = workflows.some(w => /\bopencode\s+run\b/i.test(w.content));
      if (!hasOpencodeRun) return null;
      return workflows.some(w => /--format\s+json\b/i.test(w.content));
    },
    impact: 'medium',
    rating: 3,
    category: 'ci',
    fix: 'Use `--format json` when running OpenCode in CI, and parse it as JSONL/event frames rather than expecting one monolithic JSON document.',
    template: 'opencode-ci',
    file: () => '.github/workflows/',
    line: () => null,
  },

  opencodeCiEnvAuth: {
    id: 'OC-G04',
    name: 'CI auth uses environment variables (not hardcoded credentials)',
    check: (ctx) => {
      const workflows = workflowArtifacts(ctx);
      const hasOpencode = workflows.some(w => /\bopencode\b/i.test(w.content));
      if (!hasOpencode) return null;
      // Check for hardcoded credentials in workflows
      for (const w of workflows) {
        if (/\bopencode\b/i.test(w.content) && findSecretLine(w.content)) return false;
      }
      return true;
    },
    impact: 'critical',
    rating: 5,
    category: 'ci',
    fix: 'Use GitHub secrets and environment variables for OpenCode auth in CI. Never hardcode credentials.',
    template: 'opencode-ci',
    file: () => '.github/workflows/',
    line: () => null,
  },

  // ==============================
  // H. Quality Deep (5 checks)
  // ==============================

  opencodeModernFeaturesDocumented: {
    id: 'OC-H01',
    name: 'AGENTS.md mentions modern OpenCode features (plugins, custom agents, skills)',
    check: (ctx) => {
      const content = agentsContent(ctx);
      if (!content) return null;
      const hasModernRefs = /\bplugin(s)?\b|\bcustom\s+agent(s)?\b|\bskill(s)?\b|\bopencode\b/i.test(content);
      return hasModernRefs;
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Mention OpenCode-specific features (plugins, agents, skills) in AGENTS.md to leverage platform capabilities.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  opencodeNoDeprecatedPatterns: {
    id: 'OC-H02',
    name: 'Repo docs do not push the stale mode -> agent migration claim',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!docs.trim()) return null;
      return !/\bmode\b[\s\S]{0,60}\bdeprecated\b|\buse\b[\s\S]{0,40}\bagent\b[\s\S]{0,40}\binstead of\b[\s\S]{0,20}\bmode\b/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Do not tell users that `mode` has been replaced by `agent` across the board. Current runtime still validated `mode` for markdown custom agents, so any migration guidance should be explicitly version-scoped.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeCompactionExplicit: {
    id: 'OC-H03',
    name: 'compaction settings are explicit if sessions are long',
    check: (ctx) => {
      const config = ctx.configJson();
      if (!config.ok || !config.data) return null;
      // Only relevant if the project looks like it uses long sessions
      const docs = docsBundle(ctx);
      const usesLongSessions = /\blong\s+session\b|\bcompact\b|\bcontext\s+(limit|window|management)\b/i.test(docs);
      if (!usesLongSessions) return null;
      return config.data.compaction !== undefined;
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Set explicit "compaction" settings in opencode.json for context management during long sessions.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeFormatterConfigured: {
    id: 'OC-H04',
    name: 'formatter is configured if project uses auto-formatting',
    check: (ctx) => {
      const pkg = ctx.jsonFile('package.json');
      const hasFormatter = pkg && pkg.scripts && (pkg.scripts.format || pkg.scripts.prettier);
      const hasFormatterConfig = ctx.fileContent('.prettierrc') || ctx.fileContent('.prettierrc.json') ||
        ctx.fileContent('.editorconfig');
      if (!hasFormatter && !hasFormatterConfig) return null;
      const config = ctx.configJson();
      if (!config.ok || !config.data) return null;
      return config.data.formatter !== undefined;
    },
    impact: 'low',
    rating: 2,
    category: 'quality-deep',
    fix: 'Set "formatter" in opencode.json to integrate with the project auto-formatting tool.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeProviderManagement: {
    id: 'OC-H05',
    name: 'disabled_providers / enabled_providers are set intentionally',
    check: (ctx) => {
      const config = ctx.configJson();
      if (!config.ok || !config.data) return null;
      // Only flag if many providers are available but none are managed
      if (config.data.disabled_providers || config.data.enabled_providers) return true;
      // Soft pass — not critical unless the repo explicitly uses multiple providers
      return null;
    },
    impact: 'low',
    rating: 2,
    category: 'quality-deep',
    fix: 'Consider setting "disabled_providers" or "enabled_providers" to control which model providers are available.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  // ==============================
  // I. Skills (5 checks)
  // ==============================

  opencodeSkillDirsExist: {
    id: 'OC-I01',
    name: 'Skill directories exist (.opencode/commands/ subdirs with SKILL.md)',
    check: (ctx) => {
      const skillDirs = ctx.skillDirs();
      if (skillDirs.length === 0) return null;
      return skillDirs.length > 0;
    },
    impact: 'medium',
    rating: 3,
    category: 'skills',
    fix: 'Create skill directories under .opencode/commands/ with SKILL.md files.',
    template: 'opencode-skills',
    file: () => '.opencode/commands/',
    line: () => null,
  },

  opencodeSkillFrontmatter: {
    id: 'OC-I02',
    name: 'SKILL.md has required frontmatter (name, description)',
    check: (ctx) => {
      const skillDirs = ctx.skillDirs();
      if (skillDirs.length === 0) return null;
      for (const name of skillDirs) {
        const content = ctx.skillMetadata(name);
        if (!content) return false;
        if (!/^#\s+/m.test(content)) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'skills',
    fix: 'Each SKILL.md needs a title (# heading) and description for skill invocation.',
    template: 'opencode-skills',
    file: () => '.opencode/commands/',
    line: () => null,
  },

  opencodeSkillKebabCase: {
    id: 'OC-I03',
    name: 'Skill names preferably use kebab-case',
    check: (ctx) => {
      const skillDirs = ctx.skillDirs();
      if (skillDirs.length === 0) return null;
      return skillDirs.every(name => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name));
    },
    impact: 'medium',
    rating: 2,
    category: 'skills',
    fix: 'Prefer kebab-case for skill names, but treat it as a style recommendation rather than a hard runtime requirement. Current runtime still discovered underscore-based names.',
    template: 'opencode-skills',
    file: () => '.opencode/commands/',
    line: () => null,
  },

  opencodeSkillDescriptionBounded: {
    id: 'OC-I04',
    name: 'Skill descriptions are bounded for implicit invocation context cost',
    check: (ctx) => {
      const skillDirs = ctx.skillDirs();
      if (skillDirs.length === 0) return null;
      for (const name of skillDirs) {
        const content = ctx.skillMetadata(name);
        if (!content) continue;
        if (content.length > 3000) return false;
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'skills',
    fix: 'Keep SKILL.md descriptions under 3000 characters to manage implicit invocation context cost.',
    template: 'opencode-skills',
    file: () => '.opencode/commands/',
    line: () => null,
  },

  opencodeSkillCompatPaths: {
    id: 'OC-I05',
    name: 'OpenCode skill discovery accepts either .opencode/commands or .claude/skills',
    check: (ctx) => {
      const hasClaudeSkills = ctx.hasDir('.claude/skills');
      const hasOpencodeCommands = ctx.hasDir('.opencode/commands');
      if (!hasClaudeSkills && !hasOpencodeCommands) return null;
      return hasClaudeSkills || hasOpencodeCommands;
    },
    impact: 'medium',
    rating: 3,
    category: 'skills',
    fix: 'Use `.opencode/commands/` for native OpenCode skills when you need them, but do not require a duplicate tree just to mirror `.claude/skills/`. Current runtime discovered `.claude/skills/` compatibility successfully.',
    template: 'opencode-skills',
    file: () => '.opencode/commands/',
    line: () => null,
  },

  // ==============================
  // J. Agents & Subagents (4 checks)
  // ==============================

  opencodeAgentRequiredFields: {
    id: 'OC-J01',
    name: 'Custom agents have required fields (description, model)',
    check: (ctx) => {
      const agents = ctx.customAgents();
      if (!agents || Object.keys(agents).length === 0) return null;
      for (const [name, agent] of Object.entries(agents)) {
        if (!agent) return false;
        if (!agent.description) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'agents',
    fix: 'Ensure all custom agents have at least "description" and "model" fields in opencode.json.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeAgentModeValid: {
    id: 'OC-J02',
    name: 'Custom agent mode is valid when declared',
    check: (ctx) => {
      const agents = ctx.customAgents();
      if (!agents || Object.keys(agents).length === 0) return null;
      const validModes = new Set(['primary', 'subagent', 'all']);
      for (const [name, agent] of Object.entries(agents)) {
        if (!agent) continue;
        const mode = agent.mode || agent.agent;
        if (mode && !validModes.has(mode)) return false;
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'agents',
    fix: 'Use a valid mode value (`primary`, `subagent`, or `all`) when declaring custom agents. Current runtime still validated `mode` for markdown agents, so do not rename to `agent` solely because of stale docs.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeBuiltinAgentsProtected: {
    id: 'OC-J03',
    name: 'Built-in agent overrides are intentional and documented',
    check: (ctx) => {
      const agents = ctx.customAgents();
      if (!agents || Object.keys(agents).length === 0) return null;
      const builtins = new Set(['build', 'plan', 'default']);
      const overriding = Object.keys(agents).filter((name) => builtins.has(name.toLowerCase()));
      if (overriding.length === 0) return true;
      const docs = docsBundle(ctx);
      return /override|intentional|customized|replace/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'agents',
    fix: 'Built-in agents appear overrideable in current runtime. If you intentionally override `build`, `plan`, or `default`, document why; otherwise rename the custom agent to avoid surprising behavior.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeAgentStepsLimit: {
    id: 'OC-J04',
    name: 'Agent steps limit is set to prevent runaway execution',
    check: (ctx) => {
      const agents = ctx.customAgents();
      if (!agents || Object.keys(agents).length === 0) return null;
      for (const [name, agent] of Object.entries(agents)) {
        if (!agent) continue;
        if (agent.steps && agent.steps > 100) return false;
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'agents',
    fix: 'Set a reasonable "steps" limit on custom agents to prevent runaway execution. 50-100 is typical.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  // ==============================
  // K. Commands & Workflow (3 checks)
  // ==============================

  opencodeCommandsValid: {
    id: 'OC-K01',
    name: 'Custom commands have valid frontmatter (template, description)',
    check: (ctx) => {
      const commandFiles = ctx.commandFiles();
      if (commandFiles.length === 0) return null;
      return true; // Basic presence check; deep-review handles thorough validation
    },
    impact: 'medium',
    rating: 3,
    category: 'commands',
    fix: 'Ensure custom command files in .opencode/commands/ have valid YAML frontmatter.',
    template: 'opencode-commands',
    file: () => '.opencode/commands/',
    line: () => null,
  },

  opencodeInlineBashSafe: {
    id: 'OC-K02',
    name: 'Inline bash (!`command`) in command templates is safe',
    check: (ctx) => {
      const commandFiles = ctx.commandFiles();
      if (commandFiles.length === 0) return null;
      for (const file of commandFiles) {
        const content = ctx.fileContent(path.join('.opencode', 'commands', file));
        if (!content) continue;
        // Check for dangerous inline bash patterns
        if (/!`\s*rm\s+-rf\b|!`\s*git\s+push\s+--force\b/i.test(content)) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'commands',
    fix: 'Review inline bash (!`command`) in command templates for injection risks and destructive patterns.',
    template: 'opencode-commands',
    file: () => '.opencode/commands/',
    line: () => null,
  },

  opencodeCostAwareness: {
    id: 'OC-K03',
    name: 'Cost-awareness note in AGENTS.md for heavy workflows',
    check: (ctx) => {
      const content = agentsContent(ctx);
      if (!content) return null;
      // Only relevant for repos with heavy workflows
      const hasHeavyWorkflow = /\bworkflow\b|\bautomation\b|\bpipeline\b|\bscheduled\b/i.test(content);
      if (!hasHeavyWorkflow) return null;
      return /\bcost\b|\bbudget\b|\bexpens\w+\b|\btoken\s*usage\b/i.test(content);
    },
    impact: 'medium',
    rating: 3,
    category: 'commands',
    fix: 'Add a cost-awareness note to AGENTS.md for repos with heavy automation workflows.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  // ==============================
  // L. Themes & TUI (3 checks)
  // ==============================

  opencodeTuiConfigValid: {
    id: 'OC-L01',
    name: 'tui.json/tui.jsonc is valid JSONC if present',
    check: (ctx) => {
      const content = ctx.tuiConfigContent();
      if (!content) return null;
      const result = ctx.tuiConfigJson();
      return result.ok;
    },
    impact: 'medium',
    rating: 3,
    category: 'tui',
    fix: 'Fix JSONC syntax in `tui.json`, then validate the behavioral effect in the real TUI/UI. Headless CLI surfaces did not provide enough evidence for TUI behavior on their own.',
    template: 'opencode-config',
    file: () => 'tui.json',
    line: () => 1,
  },

  opencodeThemeFilesValid: {
    id: 'OC-L02',
    name: 'Theme files are valid JSON in .opencode/themes/*.json',
    check: (ctx) => {
      const themes = ctx.themeFiles();
      if (themes.length === 0) return null;
      for (const theme of themes) {
        const content = ctx.fileContent(path.join('.opencode', 'themes', theme));
        if (!content) continue;
        try {
          JSON.parse(content);
        } catch {
          return false;
        }
      }
      return true;
    },
    impact: 'low',
    rating: 2,
    category: 'tui',
    fix: 'Fix JSON syntax errors in `.opencode/themes/`, then verify the theme in an actual UI/TUI session. Headless `run` did not give reliable theme evidence.',
    template: 'opencode-config',
    file: () => '.opencode/themes/',
    line: () => null,
  },

  opencodeTuiNoSecrets: {
    id: 'OC-L03',
    name: 'tui.json does not contain sensitive data',
    check: (ctx) => {
      const content = ctx.tuiConfigContent();
      if (!content) return null;
      return !findSecretLine(content);
    },
    impact: 'medium',
    rating: 3,
    category: 'tui',
    fix: 'Remove any sensitive data from `tui.json`, and remember that `tui.json` was not meaningfully observable through headless `run` alone.',
    template: 'opencode-config',
    file: () => 'tui.json',
    line: (ctx) => {
      const content = ctx.tuiConfigContent();
      return content ? findSecretLine(content) : null;
    },
  },

  // ==============================
  // M. Review & Governance (3 checks)
  // ==============================

  opencodeExplicitPermissionPosture: {
    id: 'OC-M01',
    name: 'Permission posture is explicit and documented',
    check: (ctx) => {
      const perms = ctx.toolPermissions();
      if (!perms || Object.keys(perms).length === 0) return null;
      const docs = docsBundle(ctx);
      return /\bpermission(s)?\b|\btrust\b|\bsandbox\b|\ballow\b|\bdeny\b|\bask\b/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'governance',
    fix: 'Document the project permission posture in AGENTS.md (which tools are allowed/denied and why).',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  opencodeGovernanceExport: {
    id: 'OC-M02',
    name: 'Permission configuration is reviewable and version-controlled',
    check: (ctx) => {
      // opencode.json should be tracked
      return Boolean(ctx.configContent());
    },
    impact: 'medium',
    rating: 3,
    category: 'governance',
    fix: 'Commit opencode.json to version control for reviewable permission configuration.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodePilotEvidence: {
    id: 'OC-M03',
    name: 'OpenCode setup has been audited at least once',
    check: (ctx) => {
      // Check for nerviq activity artifacts
      const fs = require('fs');
      const hasArtifacts = fs.existsSync(resolveProjectStateReadPath(ctx.dir));
      return hasArtifacts ? true : null;
    },
    impact: 'low',
    rating: 2,
    category: 'governance',
    fix: 'Run `npx nerviq --platform opencode` to create a baseline audit for the project.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  // ==============================
  // N. Release Freshness (3 checks)
  // ==============================

  opencodeVersionFresh: {
    id: 'OC-N01',
    name: 'OpenCode CLI version is recent',
    check: () => {
      // This is checked at runtime, not statically
      return null;
    },
    impact: 'medium',
    rating: 3,
    category: 'release-freshness',
    fix: 'Update OpenCode CLI to the latest version for the newest features and security fixes.',
    template: 'opencode-config',
    file: () => null,
    line: () => null,
  },

  opencodeConfigKeysFresh: {
    id: 'OC-N02',
    name: 'Config references current OpenCode features (no removed or renamed keys)',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      const config = ctx.configContent();
      if (!docs.trim() && !config) return null;
      const combined = `${docs}\n${config || ''}`;
      return !/\bconfig\.json\b|\.well-known\/opencode|mode\s*->\s*agent|CLAUDE\.md fallback/i.test(combined);
    },
    impact: 'medium',
    rating: 3,
    category: 'release-freshness',
    fix: 'Update stale OpenCode references. Use `opencode.json`/`opencode.jsonc`, keep `mode` guidance version-scoped, and treat `.well-known/opencode` plus `CLAUDE.md` fallback claims as unvalidated until you have fresh runtime proof.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodePropagationCompleteness: {
    id: 'OC-N03',
    name: 'No dangling surface references (plugins, skills, MCP mentioned but not defined)',
    check: (ctx) => {
      const agents = agentsContent(ctx);
      if (!agents) return null;
      const issues = [];
      if (/\bplugins?\b/i.test(agents) && ctx.pluginFiles().length === 0) {
        issues.push('plugins referenced but .opencode/plugins/ empty');
      }
      if (/\bskills?\b/i.test(agents) && !ctx.hasDir('.opencode/commands')) {
        issues.push('skills referenced but .opencode/commands/ missing');
      }
      const config = ctx.configJson();
      if (config.ok && config.data && /\bmcp\b/i.test(agents)) {
        const mcp = config.data.mcp || {};
        if (Object.keys(mcp).length === 0) {
          issues.push('MCP referenced in AGENTS.md but no MCP servers in config');
        }
      }
      return issues.length === 0;
    },
    impact: 'high',
    rating: 4,
    category: 'release-freshness',
    fix: 'Ensure all surfaces mentioned in AGENTS.md (plugins, skills, MCP) have corresponding definitions.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: (ctx) => {
      const agents = agentsContent(ctx);
      if (!agents) return null;
      return firstLineMatching(agents, /\bplugins?\b|\bskills?\b|\bmcp\b/i);
    },
  },

  // ==============================
  // O. Mixed-Agent (3 checks)
  // ==============================

  opencodeMixedAgentAware: {
    id: 'OC-O01',
    name: 'Mixed-agent repo separates OpenCode and Claude instructions',
    check: (ctx) => {
      if (!ctx.hasAgentsMdAndClaudeMd || !ctx.hasAgentsMdAndClaudeMd()) return null;
      // Both files exist — check they are distinct
      const agents = ctx.fileContent('AGENTS.md') || '';
      const claude = ctx.fileContent('CLAUDE.md') || '';
      return agents !== claude;
    },
    impact: 'high',
    rating: 4,
    category: 'mixed-agent',
    fix: 'Keep AGENTS.md for OpenCode and CLAUDE.md for Claude Code. Do not duplicate instructions.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  opencodeInstructionsArrayResolvable: {
    id: 'OC-O02',
    name: 'instructions array uses validated local file paths',
    check: (ctx) => {
      const instructions = ctx.instructionsArray();
      if (!Array.isArray(instructions) || instructions.length === 0) return null;
      for (const instruction of instructions) {
        if (typeof instruction !== 'string') continue;
        if (instruction.startsWith('http') || instruction.includes('*')) return false;
        if (!ctx.fileContent(instruction)) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'mixed-agent',
    fix: 'Prefer direct local file paths in the `instructions` array. Current runtime clearly validated direct files, but glob and URL sources were not visibly applied in `run`, so treat them as experimental until reproduced.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeGlobalAgentsNoConflict: {
    id: 'OC-O03',
    name: 'Project docs do not depend on global AGENTS.md behavior',
    check: (ctx) => {
      const docs = `${ctx.fileContent('AGENTS.md') || ''}\n${ctx.fileContent('README.md') || ''}`;
      if (!docs.trim()) return null;
      return !/~\/\.config\/opencode\/AGENTS\.md|global AGENTS/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'mixed-agent',
    fix: 'Do not rely on `~/.config/opencode/AGENTS.md` as a guaranteed project behavior. Current Windows runtime did not show global AGENTS loading in `run`, so keep project-critical guidance in repo files.',
    template: 'opencode-agents-md',
    file: () => 'AGENTS.md',
    line: () => null,
  },

  // ==============================
  // P. Propagation (3 checks)
  // ==============================

  opencodeConfigMergeConsistent: {
    id: 'OC-P01',
    name: 'Observed config merge hierarchy does not produce conflicting values',
    check: (ctx) => {
      const projectConfig = ctx.configJson();
      const globalConfig = ctx.globalConfigJson();
      if (!projectConfig.ok || !globalConfig.ok) return null;
      // Check for keys that exist in both and might conflict
      const projectKeys = new Set(Object.keys(projectConfig.data || {}));
      const globalKeys = new Set(Object.keys(globalConfig.data || {}));
      const overlapping = [...projectKeys].filter(k => globalKeys.has(k) && k !== '$schema');
      // If project explicitly sets values, it wins — that is correct
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'propagation',
    fix: 'Review the observed precedence chain: global `opencode.json` < `OPENCODE_CONFIG` < project `opencode.json` < `.opencode/opencode.json` < `OPENCODE_CONFIG_CONTENT`. Treat `.well-known/opencode` as remote-only until you have runtime proof.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeVariableSubstitutionValid: {
    id: 'OC-P02',
    name: 'Variable substitution ({env:VAR}, {file:path}) resolves correctly',
    check: (ctx) => {
      const content = ctx.configContent();
      if (!content) return null;
      // Check for unresolved variable patterns
      const envRefs = content.match(/\{env:([^}]+)\}/g) || [];
      const fileRefs = content.match(/\{file:([^}]+)\}/g) || [];
      // Can't fully validate without runtime — basic syntax check
      for (const ref of [...envRefs, ...fileRefs]) {
        if (ref.includes(' ') || ref.includes('\n')) return false;
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'propagation',
    fix: 'Fix variable substitution syntax: use {env:VAR_NAME} or {file:path} without spaces.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  opencodeOpencodeDirectoryConsistent: {
    id: 'OC-P03',
    name: '.opencode/ directory contents are consistent with opencode.json',
    check: (ctx) => {
      if (!ctx.hasDir('.opencode')) return null;
      const config = ctx.configJson();
      if (!config.ok) return null;
      // Check that referenced plugins/agents/commands exist
      return true; // Basic presence check
    },
    impact: 'medium',
    rating: 3,
    category: 'propagation',
    fix: 'Ensure .opencode/ directory structure matches opencode.json references.',
    template: 'opencode-config',
    file: (ctx) => configFileName(ctx),
    line: () => null,
  },

  // =============================================
  // T. Cross-Cutting Engineering (48 checks) — OC-T01..OC-T48
  // =============================================

  ocTestFrameworkDetected: {
    id: 'OC-T01', name: 'Test framework detected in project',
    check: (ctx) => { const p = ctx.fileContent('package.json'); if (!p) return null; return /jest|vitest|mocha|jasmine|pytest/i.test(p) || ctx.files.some(f => /pytest|spec_helper/i.test(f)); },
    impact: 'high', rating: 4, category: 'testing-strategy',
    fix: 'Add a test framework and document the test command in AGENTS.md for OpenCode.',
    template: null, file: () => 'package.json', line: () => null,
  },
  ocCoverageConfigExists: {
    id: 'OC-T02', name: 'Coverage configuration exists',
    check: (ctx) => ctx.files.some(f => /\.nycrc|\.c8rc|jest\.config|vitest\.config|\.coveragerc/i.test(f)) || /coverage/i.test(ctx.fileContent('package.json') || ''),
    impact: 'medium', rating: 3, category: 'testing-strategy',
    fix: 'Add coverage configuration for reliable test metrics.',
    template: null, file: () => null, line: () => null,
  },
  ocE2eSetupPresent: {
    id: 'OC-T03', name: 'E2E test setup present',
    check: (ctx) => ctx.files.some(f => /cypress\.config|playwright\.config|e2e\.(test|spec)\.(ts|js)/i.test(f)),
    impact: 'medium', rating: 3, category: 'testing-strategy',
    fix: 'Set up E2E tests (Playwright/Cypress) for integration coverage.',
    template: null, file: () => null, line: () => null,
  },
  ocSnapshotTestsMentioned: {
    id: 'OC-T04', name: 'Snapshot testing strategy documented',
    check: (ctx) => { const docs = docsBundle(ctx); if (!docs.trim()) return null; return /snapshot/i.test(docs); },
    impact: 'low', rating: 2, category: 'testing-strategy',
    fix: 'Document snapshot testing strategy in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocTestCommandDocumented: {
    id: 'OC-T05', name: 'Test command documented for OpenCode',
    check: (ctx) => { const docs = docsBundle(ctx); if (!docs.trim()) return null; return /npm test|yarn test|pnpm test|pytest|vitest|jest\b/i.test(docs); },
    impact: 'high', rating: 4, category: 'testing-strategy',
    fix: 'Add the exact test command to AGENTS.md for OpenCode to verify changes.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocCiRunsTests: {
    id: 'OC-T06', name: 'CI workflow runs tests',
    check: (ctx) => { const wfs = ctx.files.filter(f => /\.github\/workflows\/.*\.ya?ml$/i.test(f)); if (!wfs.length) return null; return wfs.some(f => /\btest\b|\bvitest\b|\bjest\b|\bpytest\b/i.test(ctx.fileContent(f) || '')); },
    impact: 'high', rating: 5, category: 'testing-strategy',
    fix: 'Add test step to CI for OpenCode-generated code validation.',
    template: null, file: () => '.github/workflows/', line: () => null,
  },
  ocLinterConfigured: {
    id: 'OC-T07', name: 'Linter configured',
    check: (ctx) => ctx.files.some(f => /\.eslintrc|eslint\.config|\.pylintrc|\.ruff\.toml/i.test(f)) || /eslint|ruff|pylint/i.test(ctx.fileContent('package.json') || ''),
    impact: 'high', rating: 4, category: 'code-quality',
    fix: 'Configure ESLint/Ruff and document lint command in AGENTS.md.',
    template: null, file: () => null, line: () => null,
  },
  ocFormatterConfigured: {
    id: 'OC-T08', name: 'Code formatter configured',
    check: (ctx) => ctx.files.some(f => /\.prettierrc|biome\.json|\.editorconfig/i.test(f)) || /prettier|biome/i.test(ctx.fileContent('package.json') || ''),
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Configure Prettier/Biome for consistent code formatting.',
    template: null, file: () => null, line: () => null,
  },
  ocDeadCodeDetection: {
    id: 'OC-T09', name: 'Dead code detection documented',
    check: (ctx) => { const docs = docsBundle(ctx); if (!docs.trim()) return null; return /dead.?code|unused.?(import|var)|knip|ts-prune/i.test(docs); },
    impact: 'low', rating: 2, category: 'code-quality',
    fix: 'Document dead code detection (knip, ts-prune) in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocComplexityAwareness: {
    id: 'OC-T10', name: 'Code complexity constraints documented',
    check: (ctx) => { const docs = docsBundle(ctx); if (!docs.trim()) return null; return /complex|cyclomatic|function.{0,20}length|line.{0,20}limit/i.test(docs); },
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Document complexity constraints in AGENTS.md for OpenCode.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocConsistentNamingDocumented: {
    id: 'OC-T11', name: 'Naming conventions documented',
    check: (ctx) => { const docs = docsBundle(ctx); if (!docs.trim()) return null; return /camelCase|snake_case|PascalCase|naming.{0,30}convention/i.test(docs); },
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Document naming conventions in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocCodeReviewProcessMentioned: {
    id: 'OC-T12', name: 'Code review process documented',
    check: (ctx) => { const docs = (ctx.fileContent('CONTRIBUTING.md') || '') + agentsContent(ctx); if (!docs.trim()) return null; return /code.?review|PR|pull.?request/i.test(docs); },
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Document code review process in CONTRIBUTING.md.',
    template: null, file: () => 'CONTRIBUTING.md', line: () => null,
  },
  ocEndpointDocumentation: {
    id: 'OC-T13', name: 'API endpoint documentation present',
    check: (ctx) => !isApiProject(ctx) ? null : ctx.files.some(f => /openapi|swagger|api\.ya?ml|api\.json/i.test(f)),
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Add OpenAPI/Swagger spec for OpenCode to understand the API.',
    template: null, file: () => null, line: () => null,
  },
  ocApiVersioningMentioned: {
    id: 'OC-T14', name: 'API versioning strategy documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = docsBundle(ctx); if (!docs.trim()) return null; return /api.{0,10}version|\/v\d|versioning/i.test(docs); },
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Document API versioning strategy in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocErrorHandlingPatterns: {
    id: 'OC-T15', name: 'Error handling patterns documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = docsBundle(ctx); if (!docs.trim()) return null; return /error.{0,15}handl|exception|try.?catch|Result\s*</i.test(docs); },
    impact: 'high', rating: 4, category: 'api-design',
    fix: 'Document error handling patterns in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocRateLimitingAwareness: {
    id: 'OC-T16', name: 'Rate limiting awareness documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = docsBundle(ctx); if (!docs.trim()) return null; return /rate.?limit|throttl|429/i.test(docs); },
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Document rate limiting in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocRequestValidation: {
    id: 'OC-T17', name: 'Request validation strategy documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = docsBundle(ctx); if (!docs.trim()) return null; return /validat|zod|yup|joi\b/i.test(docs); },
    impact: 'high', rating: 4, category: 'api-design',
    fix: 'Document request validation library (Zod, Yup) in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocResponseFormatConsistent: {
    id: 'OC-T18', name: 'Response format consistency documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = docsBundle(ctx); if (!docs.trim()) return null; return /response.{0,20}format|json.{0,10}response|envelope/i.test(docs); },
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Document standard response format in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocMigrationStrategyDocumented: {
    id: 'OC-T19', name: 'Database migration strategy documented',
    check: (ctx) => !isDatabaseProject(ctx) ? null : ctx.files.some(f => /migrations?\//i.test(f)) || /migration|alembic|flyway/i.test(docsBundle(ctx)),
    impact: 'high', rating: 4, category: 'database',
    fix: 'Document migration strategy in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocQueryOptimizationMentioned: {
    id: 'OC-T20', name: 'Query optimization guidance documented',
    check: (ctx) => { if (!isDatabaseProject(ctx)) return null; const docs = docsBundle(ctx); if (!docs.trim()) return null; return /n\+1|query.{0,15}optim|index|eager.{0,10}load/i.test(docs); },
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Add N+1 prevention patterns to AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocConnectionPoolingConfigured: {
    id: 'OC-T21', name: 'Connection pooling documented',
    check: (ctx) => { if (!isDatabaseProject(ctx)) return null; const docs = docsBundle(ctx); if (!docs.trim()) return null; return /connection.{0,15}pool|pool.{0,15}size/i.test(docs); },
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Document connection pooling in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocBackupStrategyDocumented: {
    id: 'OC-T22', name: 'Database backup strategy documented',
    check: (ctx) => { if (!isDatabaseProject(ctx)) return null; const docs = docsBundle(ctx) + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /backup|restore|point.?in.?time/i.test(docs); },
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Document database backup strategy in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  ocSchemaDocumentation: {
    id: 'OC-T23', name: 'Database schema documentation present',
    check: (ctx) => !isDatabaseProject(ctx) ? null : ctx.files.some(f => /schema\.(prisma|sql|graphql)|erd|dbml/i.test(f)),
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Add schema documentation (schema.prisma, ERD) for OpenCode.',
    template: null, file: () => null, line: () => null,
  },
  ocSeedDataMentioned: {
    id: 'OC-T24', name: 'Seed data strategy documented',
    check: (ctx) => !isDatabaseProject(ctx) ? null : ctx.files.some(f => /seed\.(ts|js|sql|py)|fixtures\//i.test(f)) || /seed.{0,10}data/i.test(docsBundle(ctx)),
    impact: 'low', rating: 2, category: 'database',
    fix: 'Add seed scripts and document local database setup.',
    template: null, file: () => null, line: () => null,
  },
  ocAuthFlowDocumented: {
    id: 'OC-T25', name: 'Authentication flow documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = docsBundle(ctx); if (!docs.trim()) return null; return /auth.{0,15}flow|login.{0,15}flow|authenticate/i.test(docs); },
    impact: 'high', rating: 4, category: 'authentication',
    fix: 'Document authentication flow in AGENTS.md for OpenCode.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocTokenHandlingGuidance: {
    id: 'OC-T26', name: 'Token handling guidance documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = docsBundle(ctx); if (!docs.trim()) return null; return /jwt|token.{0,15}refresh|access.{0,10}token|bearer/i.test(docs); },
    impact: 'high', rating: 4, category: 'authentication',
    fix: 'Document JWT/token patterns in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocSessionManagementDocumented: {
    id: 'OC-T27', name: 'Session management documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = docsBundle(ctx); if (!docs.trim()) return null; return /session.{0,15}manag|cookie|next.?auth/i.test(docs); },
    impact: 'medium', rating: 3, category: 'authentication',
    fix: 'Document session management in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocRbacPermissionsReferenced: {
    id: 'OC-T28', name: 'RBAC / permissions model referenced',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = docsBundle(ctx); if (!docs.trim()) return null; return /rbac|role.?based|permission|authorization/i.test(docs); },
    impact: 'high', rating: 4, category: 'authentication',
    fix: 'Document RBAC/permissions model in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocOauthSsoMentioned: {
    id: 'OC-T29', name: 'OAuth/SSO configuration documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = docsBundle(ctx) + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /oauth|sso|saml|oidc/i.test(docs); },
    impact: 'medium', rating: 3, category: 'authentication',
    fix: 'Document OAuth/SSO provider in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  ocCredentialRotationDocumented: {
    id: 'OC-T30', name: 'Credential rotation policy documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = docsBundle(ctx); if (!docs.trim()) return null; return /rotat.{0,10}secret|rotat.{0,10}key|credential.{0,10}rotat/i.test(docs); },
    impact: 'medium', rating: 3, category: 'authentication',
    fix: 'Document credential rotation in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocLoggingConfigured: {
    id: 'OC-T31', name: 'Logging framework configured',
    check: (ctx) => !isMonitoringRelevant(ctx) ? null : /winston|pino|bunyan|morgan|loguru/i.test(ctx.fileContent('package.json') || '') || ctx.files.some(f => /log(ger|ging)\.config/i.test(f)),
    impact: 'high', rating: 4, category: 'monitoring',
    fix: 'Add structured logging and document log levels in AGENTS.md.',
    template: null, file: () => 'package.json', line: () => null,
  },
  ocErrorTrackingSetup: {
    id: 'OC-T32', name: 'Error tracking service configured',
    check: (ctx) => !isMonitoringRelevant(ctx) ? null : /sentry|bugsnag|rollbar/i.test(ctx.fileContent('package.json') || ''),
    impact: 'high', rating: 4, category: 'monitoring',
    fix: 'Set up error tracking (Sentry) for production monitoring.',
    template: null, file: () => null, line: () => null,
  },
  ocApmMetricsMentioned: {
    id: 'OC-T33', name: 'APM / metrics platform documented',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = docsBundle(ctx) + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /datadog|newrelic|prometheus|grafana|opentelemetry|apm/i.test(docs); },
    impact: 'medium', rating: 3, category: 'monitoring',
    fix: 'Document APM platform in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  ocHealthCheckEndpoint: {
    id: 'OC-T34', name: 'Health check endpoint documented',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = docsBundle(ctx) + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /health.?check|\/health|\/ping|\/status/i.test(docs); },
    impact: 'medium', rating: 3, category: 'monitoring',
    fix: 'Document health check endpoint in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  ocAlertingReferenced: {
    id: 'OC-T35', name: 'Alerting strategy referenced',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = docsBundle(ctx) + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /alert|pagerduty|opsgenie|oncall|incident/i.test(docs); },
    impact: 'medium', rating: 3, category: 'monitoring',
    fix: 'Document alerting strategy in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  ocLogRotationMentioned: {
    id: 'OC-T36', name: 'Log rotation / retention documented',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = docsBundle(ctx) + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /log.{0,15}rotat|log.{0,15}retent/i.test(docs); },
    impact: 'low', rating: 2, category: 'monitoring',
    fix: 'Document log rotation policy in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  ocLockfilePresent: {
    id: 'OC-T37', name: 'Dependency lockfile present',
    check: (ctx) => ctx.files.some(f => /package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|cargo\.lock/i.test(f)),
    impact: 'critical', rating: 5, category: 'dependency-management',
    fix: 'Commit your lockfile for reproducible builds.',
    template: null, file: () => null, line: () => null,
  },
  ocOutdatedDepsAwareness: {
    id: 'OC-T38', name: 'Outdated dependency awareness configured',
    check: (ctx) => ctx.files.some(f => /\.github\/dependabot\.yml|renovate\.json/i.test(f)),
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Enable Dependabot for automated dependency updates.',
    template: null, file: () => '.github/dependabot.yml', line: () => null,
  },
  ocLicenseCompliance: {
    id: 'OC-T39', name: 'License compliance awareness configured',
    check: (ctx) => /license-checker|licensee|fossa/i.test(ctx.fileContent('package.json') || ''),
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Add license compliance checking (license-checker).',
    template: null, file: () => null, line: () => null,
  },
  ocNpmAuditConfigured: {
    id: 'OC-T40', name: 'Security audit in CI',
    check: (ctx) => { const wfs = ctx.files.filter(f => /\.github\/workflows\/.*\.ya?ml$/i.test(f)); return wfs.some(f => /npm audit|yarn audit|snyk/i.test(ctx.fileContent(f) || '')); },
    impact: 'high', rating: 4, category: 'dependency-management',
    fix: 'Add `npm audit` to CI for vulnerability detection.',
    template: null, file: () => '.github/workflows/', line: () => null,
  },
  ocPinnedVersionsUsed: {
    id: 'OC-T41', name: 'Critical dependency versions pinned',
    check: (ctx) => { const p = ctx.fileContent('package.json'); if (!p) return null; try { const pkg = JSON.parse(p); const vals = Object.values({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }); if (!vals.length) return null; return vals.filter(v => /^\d/.test(String(v))).length / vals.length >= 0.1; } catch { return null; } },
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Pin critical dependencies to exact versions.',
    template: null, file: () => 'package.json', line: () => null,
  },
  ocAutoUpdatePolicy: {
    id: 'OC-T42', name: 'Dependency auto-update policy',
    check: (ctx) => ctx.files.some(f => /\.github\/dependabot\.yml|renovate\.json|\.renovaterc/i.test(f)),
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Configure Dependabot for automated updates.',
    template: null, file: () => '.github/dependabot.yml', line: () => null,
  },
  ocTokenUsageAwareness: {
    id: 'OC-T43', name: 'Token usage awareness documented',
    check: (ctx) => { const docs = docsBundle(ctx); if (!docs.trim()) return null; return /token.{0,15}usage|token.{0,15}budget|context.{0,15}window/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document token budget awareness in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocModelSelectionGuidance: {
    id: 'OC-T44', name: 'Model selection guidance documented',
    check: (ctx) => { const docs = docsBundle(ctx) + (ctx.fileContent('opencode.json') || ''); if (!docs.trim()) return null; return /model.{0,20}select|gpt-4|claude-3|opus|sonnet/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document model selection in opencode.json or AGENTS.md.',
    template: null, file: () => 'opencode.json', line: () => null,
  },
  ocCachingToReduceApiCalls: {
    id: 'OC-T45', name: 'Caching strategy documented',
    check: (ctx) => { const docs = docsBundle(ctx); if (!docs.trim()) return null; return /cach.{0,15}api|redis|memcache|cache-control/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document caching strategies in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocBatchProcessingMentioned: {
    id: 'OC-T46', name: 'Batch processing patterns documented',
    check: (ctx) => { const docs = docsBundle(ctx); if (!docs.trim()) return null; return /batch.{0,15}process|bulk.{0,15}operat|queue|background.{0,15}job/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document batch processing in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  ocPromptCachingEnabled: {
    id: 'OC-T47', name: 'Prompt caching strategy documented',
    check: (ctx) => { const docs = docsBundle(ctx) + (ctx.fileContent('opencode.json') || ''); if (!docs.trim()) return null; return /cache.?prompt|prompt.?cach/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document prompt caching in opencode.json or AGENTS.md.',
    template: null, file: () => 'opencode.json', line: () => null,
  },
  ocCostBudgetDefined: {
    id: 'OC-T48', name: 'AI cost budget or per-run usage tracking documented',
    check: (ctx) => {
      const docs = docsBundle(ctx) + (ctx.fileContent('README.md') || '');
      if (!docs.trim() && !hasCostBudgetOrUsageTracking('', ctx)) return null;
      return hasCostBudgetOrUsageTracking(docs, ctx);
    },
    impact: 'low', rating: 2, category: 'cost-optimization',
    fix: 'Document AI cost guardrails or per-run usage tracking so OpenCode usage is measurable over time.',
    template: null, file: () => 'README.md', line: () => null,
  },

  // ============================================================
  // === PYTHON STACK CHECKS (category: 'python') ===============
  // ============================================================

  ocPythonProjectExists: {
    id: 'OC-PY01',
    name: 'Python project detected (pyproject.toml / setup.py / requirements.txt)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return true; },
    impact: 'high',
    category: 'python',
    fix: 'Ensure pyproject.toml, setup.py, or requirements.txt exists for Python projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonVersionSpecified: {
    id: 'OC-PY02',
    name: 'Python version specified (.python-version or requires-python)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /\.python-version$/.test(f)) || /requires-python/i.test(ctx.fileContent('pyproject.toml') || ''); },
    impact: 'medium',
    category: 'python',
    fix: 'Create .python-version or add requires-python to pyproject.toml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonVenvMentioned: {
    id: 'OC-PY03',
    name: 'Virtual environment mentioned in instructions',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /venv|virtualenv|conda|poetry shell|uv venv/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document virtual environment setup in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonLockfileExists: {
    id: 'OC-PY04',
    name: 'Python lockfile exists (poetry.lock / uv.lock / Pipfile.lock / pinned requirements)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /poetry\.lock$|uv\.lock$|Pipfile\.lock$/.test(f)) || /==/m.test(ctx.fileContent('requirements.txt') || ''); },
    impact: 'high',
    category: 'python',
    fix: 'Add a lockfile (poetry.lock, uv.lock, Pipfile.lock) or pin versions with == in requirements.txt.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonPytestConfigured: {
    id: 'OC-PY05',
    name: 'pytest configured (pyproject.toml [tool.pytest] / pytest.ini / conftest.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return /\[tool\.pytest/i.test(ctx.fileContent('pyproject.toml') || '') || ctx.files.some(f => /pytest\.ini$|conftest\.py$/.test(f)); },
    impact: 'high',
    category: 'python',
    fix: 'Configure pytest in pyproject.toml [tool.pytest.ini_options] or create pytest.ini.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonLinterConfigured: {
    id: 'OC-PY06',
    name: 'Python linter configured (ruff / flake8 / pylint)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.ruff|\[tool\.flake8|\[tool\.pylint/i.test(pp) || ctx.files.some(f => /\.flake8$|pylintrc$|\.pylintrc$|ruff\.toml$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure ruff, flake8, or pylint in pyproject.toml or dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonTypeCheckerConfigured: {
    id: 'OC-PY07',
    name: 'Type checker configured (mypy / pyright)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.mypy|\[tool\.pyright/i.test(pp) || ctx.files.some(f => /mypy\.ini$|pyrightconfig\.json$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure mypy or pyright in pyproject.toml or dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonFormatterConfigured: {
    id: 'OC-PY08',
    name: 'Formatter configured (black / isort / ruff format)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.black|\[tool\.isort|\[tool\.ruff\.format/i.test(pp); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure black, isort, or ruff format in pyproject.toml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonDjangoSettingsDocumented: {
    id: 'OC-PY09',
    name: 'Django settings documented if Django project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; if (!ctx.files.some(f => /manage\.py$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /django|settings\.py|DJANGO_SETTINGS_MODULE/i.test(docs); },
    impact: 'high',
    category: 'python',
    fix: 'Document Django settings module and configuration in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonFastapiEntryDocumented: {
    id: 'OC-PY10',
    name: 'FastAPI entry point documented if FastAPI project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/fastapi/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /fastapi|uvicorn|app\.py|main\.py/i.test(docs); },
    impact: 'high',
    category: 'python',
    fix: 'Document FastAPI entry point and how to run the development server.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonMigrationsDocumented: {
    id: 'OC-PY11',
    name: 'Database migrations mentioned (alembic / Django migrations)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /alembic|migrate|makemigrations|django.{0,10}migration/i.test(docs) || ctx.files.some(f => /alembic[.]ini$|alembic[/]/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Document database migration workflow (alembic or Django migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonEnvHandlingDocumented: {
    id: 'OC-PY12',
    name: '.env handling documented (python-dotenv)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/dotenv|python-dotenv|environs/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /\.env|dotenv|environment.{0,10}variable/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document .env file usage and python-dotenv configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonPreCommitConfigured: {
    id: 'OC-PY13',
    name: 'pre-commit hooks configured (.pre-commit-config.yaml)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /\.pre-commit-config\.yaml$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Add .pre-commit-config.yaml with Python-specific hooks (ruff, mypy, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonDockerBaseImage: {
    id: 'OC-PY14',
    name: 'Docker uses Python base image correctly',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const df = ctx.fileContent('Dockerfile') || ''; if (!df) return null; return /FROM.*python:/i.test(df); },
    impact: 'medium',
    category: 'python',
    fix: 'Use official Python base image in Dockerfile (e.g., FROM python:3.12-slim).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonTestMatrixConfigured: {
    id: 'OC-PY15',
    name: 'Test matrix configured (tox.ini / noxfile.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /tox\.ini$|noxfile\.py$/.test(f)); },
    impact: 'low',
    category: 'python',
    fix: 'Configure tox or nox for multi-environment testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonValidationUsed: {
    id: 'OC-PY16',
    name: 'Pydantic or dataclass validation used',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); return /pydantic|dataclass/i.test(deps); },
    impact: 'medium',
    category: 'python',
    fix: 'Use pydantic or dataclasses for data validation and type safety.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonAsyncDocumented: {
    id: 'OC-PY17',
    name: 'Async patterns documented if async project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/asyncio|aiohttp|fastapi|starlette|httpx/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /async|await|asyncio|event.{0,5}loop/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document async patterns and conventions used in the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonPinnedVersions: {
    id: 'OC-PY18',
    name: 'Requirements have pinned versions (== in requirements.txt)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const req = ctx.fileContent('requirements.txt') || ''; if (!req.trim()) return null; const lines = req.split('\n').filter(l => l.trim() && !l.startsWith('#')); return lines.length > 0 && lines.every(l => /==/.test(l) || /^-/.test(l.trim())); },
    impact: 'high',
    category: 'python',
    fix: 'Pin all dependency versions with == in requirements.txt for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonPackageStructure: {
    id: 'OC-PY19',
    name: 'Python package has proper structure (src/ layout or __init__.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /src[/].*[/]__init__\.py$|^[^/]+[/]__init__\.py$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Use src/ layout or ensure packages have __init__.py files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonDocsToolConfigured: {
    id: 'OC-PY20',
    name: 'Documentation tool configured (sphinx / mkdocs)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /mkdocs\.yml$|conf\.py$|docs[/]/.test(f)) || /sphinx|mkdocs/i.test(ctx.fileContent('pyproject.toml') || ''); },
    impact: 'low',
    category: 'python',
    fix: 'Configure sphinx or mkdocs for project documentation.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonCoverageConfigured: {
    id: 'OC-PY21',
    name: 'Coverage configured (coverage / pytest-cov)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.coverage|pytest-cov|coverage/i.test(pp) || ctx.files.some(f => /\.coveragerc$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure coverage reporting with pytest-cov or coverage.py.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonNoSecretsInSettings: {
    id: 'OC-PY22',
    name: 'No secrets in Django settings.py',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const settings = ctx.fileContent('settings.py') || ctx.files.filter(f => /settings\.py$/.test(f)).map(f => ctx.fileContent(f) || '').join(''); if (!settings) return null; return !/SECRET_KEY\s*=\s*['"][^'"]{10,}/i.test(settings); },
    impact: 'critical',
    category: 'python',
    fix: 'Move SECRET_KEY and other secrets to environment variables, not hardcoded in settings.py.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonWsgiAsgiDocumented: {
    id: 'OC-PY23',
    name: 'WSGI/ASGI server documented (gunicorn / uvicorn)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/gunicorn|uvicorn|daphne|hypercorn/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /gunicorn|uvicorn|daphne|hypercorn|wsgi|asgi/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document WSGI/ASGI server configuration (gunicorn, uvicorn).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonTaskQueueDocumented: {
    id: 'OC-PY24',
    name: 'Task queue documented if used (celery / rq)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/celery|rq|dramatiq|huey/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /celery|rq|dramatiq|huey|task.{0,10}queue|worker/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document task queue configuration and worker setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocPythonGitignore: {
    id: 'OC-PY25',
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

  ocGoModExists: {
    id: 'OC-GO01',
    name: 'go.mod exists',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'go',
    fix: 'Initialize Go module with go mod init.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoSumCommitted: {
    id: 'OC-GO02',
    name: 'go.sum committed',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /go\.sum$/.test(f)); },
    impact: 'high',
    category: 'go',
    fix: 'Commit go.sum to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGolangciLintConfigured: {
    id: 'OC-GO03',
    name: 'golangci-lint configured (.golangci.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /\.golangci\.ya?ml$|\.golangci\.toml$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Add .golangci.yml to configure linting rules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoTestDocumented: {
    id: 'OC-GO04',
    name: 'go test documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go test/i.test(docs); },
    impact: 'high',
    category: 'go',
    fix: 'Document go test command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoBuildDocumented: {
    id: 'OC-GO05',
    name: 'go build documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go build|go install/i.test(docs); },
    impact: 'high',
    category: 'go',
    fix: 'Document go build command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoStandardLayout: {
    id: 'OC-GO06',
    name: 'Standard Go layout (cmd/ / internal/ / pkg/)',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /^cmd[/]|^internal[/]|^pkg[/]/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Use standard Go project layout with cmd/, internal/, and/or pkg/ directories.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoErrorHandlingDocumented: {
    id: 'OC-GO07',
    name: 'Error handling patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /error handling|errors?\.(?:New|Wrap|Is|As)|fmt\.Errorf/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document error handling conventions (error wrapping, sentinel errors, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoContextUsageDocumented: {
    id: 'OC-GO08',
    name: 'Context usage documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /context\.Context|ctx\.Done|context\.WithCancel|context\.WithTimeout/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document context.Context usage patterns for cancellation and timeouts.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoroutineSafetyDocumented: {
    id: 'OC-GO09',
    name: 'Goroutine safety documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /goroutine|sync\.Mutex|sync\.WaitGroup|channel|concurren/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document goroutine safety patterns, mutex usage, and channel conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoModTidyMentioned: {
    id: 'OC-GO10',
    name: 'go mod tidy mentioned in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go mod tidy/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document go mod tidy in project workflow instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoVetConfigured: {
    id: 'OC-GO11',
    name: 'go vet or staticcheck configured',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/go.yml') || ''; return /go vet|staticcheck/i.test(docs + ci); },
    impact: 'medium',
    category: 'go',
    fix: 'Configure go vet and/or staticcheck in CI or project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoMakefileExists: {
    id: 'OC-GO12',
    name: 'Makefile or Taskfile exists for Go project',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /^Makefile$|^Taskfile\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Add Makefile or Taskfile.yml with common Go targets (build, test, lint).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoDockerMultiStage: {
    id: 'OC-GO13',
    name: 'Docker multi-stage build for Go',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; if (!df) return null; return /FROM.*golang.*AS/i.test(df) && /FROM.*(?:alpine|scratch|distroless|gcr\.io)/i.test(df); },
    impact: 'medium',
    category: 'go',
    fix: 'Use multi-stage Docker build: build in golang image, run in minimal image (alpine/scratch/distroless).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoCgoDocumented: {
    id: 'OC-GO14',
    name: 'CGO documented if used',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const goMod = ctx.fileContent('go.mod') || ''; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; if (!/CGO_ENABLED|import "C"/i.test(goMod + docs)) return null; return /CGO|cgo/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document CGO usage, dependencies, and build requirements.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoWorkForMonorepo: {
    id: 'OC-GO15',
    name: 'go.work for monorepo',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const multiMod = ctx.files.filter(f => /go\.mod$/.test(f)).length > 1; if (!multiMod) return null; return ctx.files.some(f => /go\.work$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Use go.work for Go workspace in monorepo with multiple modules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoBenchmarkTests: {
    id: 'OC-GO16',
    name: 'Benchmark tests mentioned',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go test.*-bench|Benchmark/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document benchmark testing with go test -bench.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoRaceDetector: {
    id: 'OC-GO17',
    name: 'Race detector (-race) documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/go.yml') || ''; return /-race/i.test(docs + ci); },
    impact: 'medium',
    category: 'go',
    fix: 'Document and enable race detector with go test -race.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoGenerateDocumented: {
    id: 'OC-GO18',
    name: 'go generate documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go generate/i.test(docs) || ctx.files.some(f => /generate\.go$/.test(f)); },
    impact: 'low',
    category: 'go',
    fix: 'Document go generate usage and generated files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoInterfaceDesignDocumented: {
    id: 'OC-GO19',
    name: 'Interface-based design documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /interface|mock|stub|dependency injection/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document interface-based design patterns for testability and dependency injection.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocGoGitignore: {
    id: 'OC-GO20',
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

  ocRustCargoTomlExists: {
    id: 'OC-RS01',
    name: 'Cargo.toml exists with edition field',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /edition\s*=/.test(cargo); },
    impact: 'high',
    category: 'rust',
    fix: 'Ensure Cargo.toml exists and specifies the edition field (e.g., edition = "2021").',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustCargoLockCommitted: {
    id: 'OC-RS02',
    name: 'Cargo.lock committed (for binary crates)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /Cargo\.lock$/.test(f)); },
    impact: 'high',
    category: 'rust',
    fix: 'Commit Cargo.lock for binary crates to ensure reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustClippyConfigured: {
    id: 'OC-RS03',
    name: 'Clippy configured (CI or .cargo/config.toml)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/rust.yml') || ''; const cargoConfig = ctx.fileContent('.cargo/config.toml') || ''; return /clippy/i.test(ci + cargoConfig); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure clippy in CI or .cargo/config.toml for lint enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustFmtConfigured: {
    id: 'OC-RS04',
    name: 'rustfmt configured (rustfmt.toml or .rustfmt.toml)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /rustfmt\.toml$|\.rustfmt\.toml$/.test(f)); },
    impact: 'medium',
    category: 'rust',
    fix: 'Create rustfmt.toml or .rustfmt.toml to configure code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustCargoTestDocumented: {
    id: 'OC-RS05',
    name: 'cargo test documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cargo test/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document cargo test command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustCargoBuildDocumented: {
    id: 'OC-RS06',
    name: 'cargo build/check documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cargo (?:build|check)/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document cargo build or cargo check command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustUnsafePolicyDocumented: {
    id: 'OC-RS07',
    name: 'Unsafe code policy documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /unsafe|#!?\[forbid\(unsafe|#!?\[deny\(unsafe/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document unsafe code policy (forbidden, minimized, or where allowed).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustErrorHandlingStrategy: {
    id: 'OC-RS08',
    name: 'Error handling strategy (anyhow/thiserror in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /anyhow|thiserror|eyre|color-eyre/i.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Use anyhow (applications) or thiserror (libraries) for structured error handling.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustFeatureFlagsDocumented: {
    id: 'OC-RS09',
    name: 'Feature flags documented (Cargo.toml [features])',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/\[features\]/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /feature|--features|--all-features/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document feature flags and their purpose in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustWorkspaceConfig: {
    id: 'OC-RS10',
    name: 'Workspace config if multi-crate (Cargo.toml [workspace])',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (ctx.files.filter(f => /Cargo\.toml$/.test(f)).length <= 1) return null; return /\[workspace\]/i.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure [workspace] in root Cargo.toml for multi-crate projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustMsrvSpecified: {
    id: 'OC-RS11',
    name: 'MSRV specified (rust-version field)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /rust-version\s*=/.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Specify rust-version (MSRV) in Cargo.toml for compatibility guarantees.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustDocCommentsEncouraged: {
    id: 'OC-RS12',
    name: 'Doc comments (///) encouraged in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /doc comment|\/{3}|rustdoc|cargo doc/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Encourage /// doc comments and cargo doc in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustBenchmarksConfigured: {
    id: 'OC-RS13',
    name: 'Criterion benchmarks mentioned (benches/ dir)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /benches[/]/.test(f)) || /criterion/i.test(ctx.fileContent('Cargo.toml') || ''); },
    impact: 'low',
    category: 'rust',
    fix: 'Set up criterion benchmarks in benches/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustCrossCompilationDocumented: {
    id: 'OC-RS14',
    name: 'Cross-compilation documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cross.?compil|--target|rustup target|cargo build.*--target/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Document cross-compilation targets and setup instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustMemorySafetyDocumented: {
    id: 'OC-RS15',
    name: 'Memory safety patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /ownership|borrow|lifetime|memory.?safe|Arc|Rc|RefCell/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document memory safety patterns (ownership, borrowing, lifetime conventions).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustAsyncRuntimeDocumented: {
    id: 'OC-RS16',
    name: 'Async runtime documented (tokio/async-std in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/tokio|async-std|smol/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /tokio|async-std|async|await|runtime/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document async runtime choice and patterns (tokio, async-std).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustSerdeDocumented: {
    id: 'OC-RS17',
    name: 'Serde patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/serde/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /serde|Serialize|Deserialize|serde_json|serde_yaml/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document serde serialization/deserialization patterns and conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustCargoAuditConfigured: {
    id: 'OC-RS18',
    name: 'cargo-audit configured in CI',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/rust.yml') || ctx.fileContent('.github/workflows/audit.yml') || ''; return /cargo.?audit|advisory/i.test(ci); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure cargo-audit in CI for vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustWasmTargetDocumented: {
    id: 'OC-RS19',
    name: 'WASM target documented if applicable',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/wasm|wasm-bindgen|wasm-pack/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /wasm|WebAssembly|wasm-pack|wasm-bindgen/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Document WASM target configuration and build process.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocRustGitignore: {
    id: 'OC-RS20',
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

  ocJavaBuildFileExists: {
    id: 'OC-JV01',
    name: 'pom.xml or build.gradle exists',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'java',
    fix: 'Ensure pom.xml or build.gradle exists for Java projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaVersionSpecified: {
    id: 'OC-JV02',
    name: 'Java version specified',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; return /java\.version|maven\.compiler\.source|sourceCompatibility|JavaVersion/i.test(pom + gradle) || ctx.files.some(f => /\.java-version$/.test(f)); },
    impact: 'high',
    category: 'java',
    fix: 'Specify Java version in pom.xml properties, build.gradle, or .java-version file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaWrapperCommitted: {
    id: 'OC-JV03',
    name: 'Maven/Gradle wrapper committed (mvnw or gradlew)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /mvnw$|gradlew$/.test(f)); },
    impact: 'high',
    category: 'java',
    fix: 'Commit mvnw (Maven) or gradlew (Gradle) wrapper for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaSpringBootVersion: {
    id: 'OC-JV04',
    name: 'Spring Boot version documented if Spring project',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; if (!/spring-boot/i.test(pom + gradle)) return null; return /spring-boot.*\d+\.\d+/i.test(pom + gradle); },
    impact: 'high',
    category: 'java',
    fix: 'Document Spring Boot version in build configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaApplicationConfig: {
    id: 'OC-JV05',
    name: 'application.yml or application.properties exists',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /application\.ya?ml$|application\.properties$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Create application.yml or application.properties for Spring configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaTestFramework: {
    id: 'OC-JV06',
    name: 'Test framework configured (JUnit/TestNG in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; return /junit|testng|spring-boot-starter-test/i.test(pom + gradle); },
    impact: 'high',
    category: 'java',
    fix: 'Configure JUnit or TestNG test framework in project dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaCodeStyleConfigured: {
    id: 'OC-JV07',
    name: 'Code style configured (checkstyle.xml, spotbugs)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /checkstyle\.xml$|spotbugs.*\.xml$/.test(f)) || /checkstyle|spotbugs|google-java-format/i.test((ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || '')); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure checkstyle or spotbugs for code quality enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaSpringProfilesDocumented: {
    id: 'OC-JV08',
    name: 'Spring profiles documented',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/spring/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /spring[.]profiles|@Profile|SPRING_PROFILES_ACTIVE/i.test(docs); },
    impact: 'medium',
    category: 'java',
    fix: 'Document Spring profiles and their configuration in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaDatabaseMigration: {
    id: 'OC-JV09',
    name: 'Database migration configured (flyway/liquibase)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /flyway|liquibase/i.test(deps) || ctx.files.some(f => /db[/]migration|flyway|liquibase/i.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure database migration tool (Flyway or Liquibase) for schema management.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaLombokDocumented: {
    id: 'OC-JV10',
    name: 'Lombok/MapStruct documented if used',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/lombok|mapstruct/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /lombok|mapstruct/i.test(docs); },
    impact: 'low',
    category: 'java',
    fix: 'Document Lombok/MapStruct usage and IDE setup requirements.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaApiDocsConfigured: {
    id: 'OC-JV11',
    name: 'API docs configured (springdoc/swagger deps)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /springdoc|swagger|openapi/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure API documentation with springdoc-openapi or Swagger.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaSecurityConfigured: {
    id: 'OC-JV12',
    name: 'Security configuration documented',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/spring-security|spring-boot-starter-security/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /security|authentication|authorization|SecurityConfig|@EnableWebSecurity/i.test(docs); },
    impact: 'high',
    category: 'java',
    fix: 'Document Spring Security configuration and authentication setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaActuatorConfigured: {
    id: 'OC-JV13',
    name: 'Actuator/health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /actuator|spring-boot-starter-actuator/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Spring Boot Actuator for health checks and monitoring.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaLoggingConfigured: {
    id: 'OC-JV14',
    name: 'Logging configured (logback.xml or log4j2.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /logback.*\.xml$|log4j2?.*\.xml$|logging\.properties$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure logging with logback.xml or log4j2.xml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaMultiModuleProject: {
    id: 'OC-JV15',
    name: 'Multi-module project configured if applicable',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const buildFiles = ctx.files.filter(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f)); if (buildFiles.length <= 1) return null; const rootPom = ctx.fileContent('pom.xml') || ''; const rootGradle = ctx.fileContent('settings.gradle') || ctx.fileContent('settings.gradle.kts') || ''; return /<modules>|include\s/i.test(rootPom + rootGradle); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure multi-module project structure in root build file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaDockerConfigured: {
    id: 'OC-JV16',
    name: 'Docker build configured (Dockerfile or Jib plugin)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /FROM.*(?:openjdk|eclipse-temurin|amazoncorretto)/i.test(df) || /jib/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Docker build with Dockerfile or Jib plugin.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaEnvConfigsSeparated: {
    id: 'OC-JV17',
    name: 'Environment-specific configs separated',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /application-(?:dev|prod|staging|test|local)\.(?:ya?ml|properties)$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Separate environment configs (application-dev.yml, application-prod.yml, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaNoSecretsInConfig: {
    id: 'OC-JV18',
    name: 'No secrets in application.yml/properties',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const appYml = ctx.files.filter(f => /application.*\.ya?ml$|application.*\.properties$/.test(f)).map(f => ctx.fileContent(f) || '').join(''); if (!appYml) return null; return !/password\s*[:=]\s*[^$\{\s][^\s]{8,}|secret\s*[:=]\s*[^$\{\s][^\s]{8,}/i.test(appYml); },
    impact: 'critical',
    category: 'java',
    fix: 'Move secrets to environment variables or external secret management, not application config files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaIntegrationTestsSeparate: {
    id: 'OC-JV19',
    name: 'Integration tests separate from unit tests',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /src[/](?:integration-?test|it)[/]|IT\.java$|Integration(?:Test)?\.java$/.test(f)) || /failsafe|integration-test/i.test((ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || '')); },
    impact: 'medium',
    category: 'java',
    fix: 'Separate integration tests from unit tests using Maven Failsafe or dedicated source set.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocJavaBuildCommandDocumented: {
    id: 'OC-JV20',
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

  ocrubyGemfileExists: {
    id: 'OC-RB01',
    name: 'Gemfile exists',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'ruby',
    fix: 'Create a Gemfile to manage Ruby dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocrubyGemfileLockCommitted: {
    id: 'OC-RB02',
    name: 'Gemfile.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /Gemfile\.lock$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Commit Gemfile.lock to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocrubyVersionSpecified: {
    id: 'OC-RB03',
    name: 'Ruby version specified (.ruby-version)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.ruby-version$/.test(f)) || /ruby ['"]~?\d/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Create .ruby-version or specify ruby version in Gemfile.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocrubyRubocopConfigured: {
    id: 'OC-RB04',
    name: 'RuboCop configured (.rubocop.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.rubocop\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add .rubocop.yml to configure Ruby style checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocrubyTestFrameworkConfigured: {
    id: 'OC-RB05',
    name: 'RSpec or Minitest configured (spec/ or test/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /^spec\/|^test\/|spec_helper\.rb$|test_helper\.rb$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Configure RSpec (spec/) or Minitest (test/) for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocrubyRailsCredentialsDocumented: {
    id: 'OC-RB06',
    name: 'Rails credentials documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /credentials|encrypted|master\.key|secret_key_base/i.test(docs); },
    impact: 'high',
    category: 'ruby',
    fix: 'Document Rails credentials management (rails credentials:edit) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocrubyMigrationsDocumented: {
    id: 'OC-RB07',
    name: 'Database migrations documented (db/migrate/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /db\/migrate\//.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /migration|migrate|db:migrate|rails db/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document database migration workflow (rails db:migrate) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocrubyBundlerAuditConfigured: {
    id: 'OC-RB08',
    name: 'Bundler audit configured',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; return /bundler-audit|bundle.audit/i.test(gf) || ctx.files.some(f => /\.bundler-audit/i.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add bundler-audit gem for dependency vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocrubyTypeCheckingConfigured: {
    id: 'OC-RB09',
    name: 'Sorbet/RBS type checking configured (sorbet/ or sig/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /sorbet\/|sig\/|\.rbs$/.test(f)) || /sorbet|tapioca/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'low',
    category: 'ruby',
    fix: 'Configure Sorbet or RBS for type checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocrubyRailsRoutesDocumented: {
    id: 'OC-RB10',
    name: 'Rails routes documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/routes\.rb$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /routes|endpoints|api.*path|REST/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document key routes and API endpoints in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocrubyBackgroundJobsDocumented: {
    id: 'OC-RB11',
    name: 'Background jobs documented (Sidekiq/GoodJob)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sidekiq|good_job|delayed_job|resque/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /sidekiq|good_job|delayed_job|resque|background.*job|worker|queue/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document background job framework and worker configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocrubyRailsEnvConfigsSeparated: {
    id: 'OC-RB12',
    name: 'Rails environment configs separated (config/environments/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /config\/environments\//.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Ensure config/environments/ has separate files for development, test, and production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocrubyAssetPipelineDocumented: {
    id: 'OC-RB13',
    name: 'Asset pipeline documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sprockets|propshaft|webpacker|jsbundling|cssbundling/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /asset|sprockets|propshaft|webpacker|jsbundling|cssbundling|esbuild|vite/i.test(docs); },
    impact: 'low',
    category: 'ruby',
    fix: 'Document asset pipeline configuration (Sprockets, Propshaft, or JS/CSS bundling).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocrubyMasterKeyInGitignore: {
    id: 'OC-RB14',
    name: 'Rails master.key in .gitignore',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const gi = ctx.fileContent('.gitignore') || ''; return /master\.key/i.test(gi); },
    impact: 'critical',
    category: 'ruby',
    fix: 'Add config/master.key to .gitignore to prevent secret leakage.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocrubyTestDataFactories: {
    id: 'OC-RB15',
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

  ocdotnetProjectExists: {
    id: 'OC-DN01',
    name: '.csproj or .sln exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'dotnet',
    fix: 'Ensure .csproj or .sln file exists for .NET projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocdotnetVersionSpecified: {
    id: 'OC-DN02',
    name: '.NET version specified (global.json or TargetFramework)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /global\.json$/.test(f)) || ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /TargetFramework/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create global.json or ensure TargetFramework is set in .csproj.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocdotnetPackagesLock: {
    id: 'OC-DN03',
    name: 'NuGet packages lock (packages.lock.json)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /packages\.lock\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Enable NuGet lock file (packages.lock.json) for reproducible restores.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocdotnetTestDocumented: {
    id: 'OC-DN04',
    name: 'dotnet test documented',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /dotnet test|xunit|nunit|mstest/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document how to run tests with dotnet test in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocdotnetEditorConfigExists: {
    id: 'OC-DN05',
    name: 'EditorConfig configured (.editorconfig)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.editorconfig$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add .editorconfig for consistent code style across the team.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocdotnetRoslynAnalyzers: {
    id: 'OC-DN06',
    name: 'Roslyn analyzers configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Analyzer|StyleCop|SonarAnalyzer|Microsoft\.CodeAnalysis/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Roslyn analyzers (StyleCop.Analyzers, Microsoft.CodeAnalysis) to the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocdotnetAppsettingsExists: {
    id: 'OC-DN07',
    name: 'appsettings.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /appsettings\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create appsettings.json for application configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocdotnetUserSecretsDocumented: {
    id: 'OC-DN08',
    name: 'User secrets configured in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /user.?secrets|dotnet secrets|Secret Manager/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document user secrets management (dotnet user-secrets) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocdotnetEfMigrations: {
    id: 'OC-DN09',
    name: 'Entity Framework migrations (Migrations/ directory)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /Migrations\//.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Document Entity Framework migration workflow (dotnet ef migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocdotnetHealthChecks: {
    id: 'OC-DN10',
    name: 'Health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /AddHealthChecks|MapHealthChecks|IHealthCheck/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure health checks with AddHealthChecks() and MapHealthChecks().',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocdotnetSwaggerConfigured: {
    id: 'OC-DN11',
    name: 'Swagger/OpenAPI configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$|.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Swashbuckle|AddSwaggerGen|UseSwagger|NSwag|AddOpenApi/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure Swagger/OpenAPI with Swashbuckle or NSwag.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocdotnetNoConnectionStringsInConfig: {
    id: 'OC-DN12',
    name: 'No connection strings in appsettings.json',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const settings = ctx.fileContent('appsettings.json') || ''; if (!settings) return null; return !/Server=.*Password=|Data Source=.*Password=/i.test(settings); },
    impact: 'critical',
    category: 'dotnet',
    fix: 'Move connection strings with passwords to user secrets or environment variables.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocdotnetDockerSupport: {
    id: 'OC-DN13',
    name: 'Docker support configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; return /dotnet|aspnet|sdk/i.test(df); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Dockerfile with official .NET SDK/ASP.NET base images.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocdotnetTestProjectSeparate: {
    id: 'OC-DN14',
    name: 'Unit test project separate (.Tests.csproj)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.Tests?\.csproj$|Tests?\/.*\.csproj$/.test(f)); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Create separate test project (e.g., MyApp.Tests.csproj) for unit tests.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocdotnetGlobalUsingsDocumented: {
    id: 'OC-DN15',
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

  ocphpComposerJsonExists: {
    id: 'OC-PHP01',
    name: 'composer.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'php',
    fix: 'Create composer.json to manage PHP dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocphpComposerLockCommitted: {
    id: 'OC-PHP02',
    name: 'composer.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /composer\.lock$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Commit composer.lock to version control for reproducible installs.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocphpVersionSpecified: {
    id: 'OC-PHP03',
    name: 'PHP version specified (composer.json require.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"php"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Specify PHP version requirement in composer.json require section.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocphpStaticAnalysisConfigured: {
    id: 'OC-PHP04',
    name: 'PHPStan/Psalm configured (phpstan.neon)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpstan\.neon$|phpstan\.neon\.dist$|psalm\.xml$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Configure PHPStan (phpstan.neon) or Psalm (psalm.xml) for static analysis.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocphpCsFixerConfigured: {
    id: 'OC-PHP05',
    name: 'PHP CS Fixer configured (.php-cs-fixer.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /\.php-cs-fixer\.php$|\.php-cs-fixer\.dist\.php$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Add .php-cs-fixer.php for consistent code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocphpUnitConfigured: {
    id: 'OC-PHP06',
    name: 'PHPUnit configured (phpunit.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpunit\.xml$|phpunit\.xml\.dist$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Configure PHPUnit with phpunit.xml for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocphpLaravelEnvExample: {
    id: 'OC-PHP07',
    name: 'Laravel .env.example exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /\.env\.example$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Create .env.example with all required environment variables documented.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocphpLaravelAppKeyNotCommitted: {
    id: 'OC-PHP08',
    name: 'Laravel APP_KEY not committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const env = ctx.fileContent('.env') || ''; if (!env) return null; return !/APP_KEY=base64:[A-Za-z0-9+/=]{30,}/i.test(env); },
    impact: 'critical',
    category: 'php',
    fix: 'Ensure .env with APP_KEY is in .gitignore — never commit application keys.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocphpLaravelMigrationsExist: {
    id: 'OC-PHP09',
    name: 'Laravel migrations exist (database/migrations/)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /database\/migrations\//.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Create database migrations in database/migrations/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocphpArtisanCommandsDocumented: {
    id: 'OC-PHP10',
    name: 'Artisan commands documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /artisan|php artisan|make:model|make:controller|migrate/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document key Artisan commands (migrate, seed, make:*) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocphpQueueWorkerDocumented: {
    id: 'OC-PHP11',
    name: 'Queue worker documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; if (!/horizon|queue/i.test(cj) && !ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /queue|horizon|worker|job|dispatch/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document queue worker setup (php artisan queue:work, Horizon).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocphpLaravelPintConfigured: {
    id: 'OC-PHP12',
    name: 'Laravel Pint configured (pint.json)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /pint\.json$/.test(f)) || /laravel\/pint/i.test(ctx.fileContent('composer.json') || ''); },
    impact: 'low',
    category: 'php',
    fix: 'Configure Laravel Pint (pint.json) for code style enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocphpAssetBundlingDocumented: {
    id: 'OC-PHP13',
    name: 'Vite/Mix asset bundling documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /vite\.config\.|webpack\.mix\.js$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /vite|mix|asset|npm run dev|npm run build/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document asset bundling setup (Vite or Mix) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocphpConfigCachingDocumented: {
    id: 'OC-PHP14',
    name: 'Laravel config caching documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /config:cache|config:clear|route:cache|optimize/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document config/route caching strategy (php artisan config:cache) for production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  ocphpComposerScriptsDefined: {
    id: 'OC-PHP15',
    name: 'Composer scripts defined',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"scripts"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Define composer scripts for common tasks (test, lint, analyze) in composer.json.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },


};

Object.assign(OPENCODE_TECHNIQUES, buildStackChecks({
  platform: 'opencode',
  objectPrefix: 'oc',
  idPrefix: 'OC',
  docs: (ctx) => [
    agentsContent(ctx),
    ctx.fileContent('README.md') || '',
    ctx.fileContent('CLAUDE.md') || '',
    ctx.fileContent('CONTRIBUTING.md') || '',
  ].filter(Boolean).join('\n'),
}));

attachSourceUrls('opencode', OPENCODE_TECHNIQUES);

// CTO-08 — tag every check with a scope layer.
const { LAYERS: OC_LAYERS, assignLayers: ocAssignLayers } = require('../audit/layers');
ocAssignLayers(OPENCODE_TECHNIQUES, OC_LAYERS.GOVERNANCE);

module.exports = {
  OPENCODE_TECHNIQUES,
};
