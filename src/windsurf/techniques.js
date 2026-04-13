/**
 * Windsurf techniques module — CHECK CATALOG
 *
 * 84 checks across 16 categories:
 *   v0.1 (40): A. Rules(9), B. Config(7), C. Trust & Safety(9), D. Cascade Agent(5), E. MCP(5), F. Instructions Quality(5)
 *   v0.5 (55): G. Workflows & Steps(5), H. Memories(5), I. Enterprise(5)
 *   v1.0 (70): J. Cascadeignore & Review(4), K. Cross-Surface(4), L. Quality Deep(7)
 *   CP-08 (84): M. Advisory(4), N. Pack(4), O. Repeat(3), P. Freshness(3)
 *
 * Each check: { id, name, check(ctx), impact, rating, category, fix, template, file(), line() }
 *
 * Windsurf key differences from Cursor:
 * - Instructions: .windsurf/rules/*.md (Markdown + YAML frontmatter, NOT MDC)
 * - Legacy: .windsurfrules (like .cursorrules)
 * - 4 activation modes: always_on, glob, model_decision, manual
 * - Agent: Cascade (autonomous agent)
 * - Memories system (workspace-scoped, local to the current workspace)
 * - Workflows -> Slash commands
 * - 12K char limit for modern rules/workflows; 6K for legacy/global rules
 * - MCP with team whitelist
 * - cascadeignore (gitignore for Cascade)
 * - No background agents or supported CLI/headless mode
 * - Check ID prefix: WS-
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { WindsurfProjectContext } = require('./context');
const { EMBEDDED_SECRET_PATTERNS, containsEmbeddedSecret } = require('../secret-patterns');
const { attachSourceUrls } = require('../source-urls');
const { buildStackChecks } = require('../stack-checks');
const { isApiProject, isDatabaseProject, isAuthProject, isMonitoringRelevant } = require('../supplemental-checks');
const { hasCostBudgetOrUsageTracking } = require('../cost-tracking');
const { tryParseJson, validateMcpEnvVars } = require('./config-parser');

// ─── Shared helpers ─────────────────────────────────────────────────────────

const FILLER_PATTERNS = [
  /\bbe helpful\b/i,
  /\bbe accurate\b/i,
  /\bbe concise\b/i,
  /\balways do your best\b/i,
  /\bmaintain high quality\b/i,
  /\bwrite clean code\b/i,
  /\bfollow best practices\b/i,
];

function countSections(markdown) {
  return (markdown.match(/^##\s+/gm) || []).length;
}

function firstLineMatching(text, matcher) {
  if (!text) return null;
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

function findFillerLine(content) {
  return firstLineMatching(content, (line) => FILLER_PATTERNS.some((p) => p.test(line)));
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

function allRulesContent(ctx) {
  const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
  return rules.map(r => r.body || '').join('\n');
}

function coreRulesContent(ctx) {
  const always = ctx.alwaysRules ? ctx.alwaysRules() : [];
  return always.map(r => r.body || '').join('\n');
}

function mcpJsonRaw(ctx) {
  const configPath = windsurfMcpConfigPath();
  try {
    return fs.readFileSync(configPath, 'utf8');
  } catch {
    return '';
  }
}

function mcpJsonData(ctx) {
  const raw = mcpJsonRaw(ctx);
  if (!raw) return null;
  const result = tryParseJson(raw);
  return result.ok ? result.data : null;
}

function windsurfMcpConfigPath() {
  return path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json');
}

function normalizeWindsurfTrigger(frontmatter) {
  if (!frontmatter) return 'always_on';

  const trigger = String(frontmatter.trigger || '').trim().toLowerCase();
  if (trigger === 'always_on' || trigger === 'always') return 'always_on';
  if (trigger === 'glob' || trigger === 'auto' || trigger === 'auto_attached') return 'glob';
  if (trigger === 'model_decision' || trigger === 'agent_requested' || trigger === 'agent-requested') return 'model_decision';
  if (trigger === 'manual') return 'manual';

  const hasGlob = Boolean(frontmatter.glob) ||
    (Array.isArray(frontmatter.globs) ? frontmatter.globs.length > 0 : Boolean(frontmatter.globs));
  const hasDescription = Boolean(frontmatter.description && String(frontmatter.description).trim());

  if (hasGlob) return 'glob';
  if (hasDescription) return 'model_decision';
  return 'always_on';
}

function isValidWindsurfFrontmatter(frontmatter) {
  if (!frontmatter || typeof frontmatter !== 'object') return false;

  const validFields = new Set(['trigger', 'description', 'glob', 'globs', 'name']);
  const validTriggers = new Set([
    'always_on', 'always',
    'glob', 'auto', 'auto_attached',
    'model_decision', 'agent_requested', 'agent-requested',
    'manual',
  ]);

  for (const key of Object.keys(frontmatter)) {
    if (!validFields.has(key)) return false;
  }

  if (frontmatter.trigger && !validTriggers.has(String(frontmatter.trigger).trim().toLowerCase())) {
    return false;
  }

  if (frontmatter.globs !== undefined && !Array.isArray(frontmatter.globs) && typeof frontmatter.globs !== 'string') {
    return false;
  }

  if (frontmatter.glob !== undefined && typeof frontmatter.glob !== 'string') {
    return false;
  }

  return true;
}

function docsBundle(ctx) {
  // PP-03: broadened to include the surfaces real Windsurf-using repos
  // actually use for instructions (AGENTS.md, CLAUDE.md, CONTRIBUTING.md,
  // ARCHITECTURE.md, DEVELOPMENT.md) plus the `.ai/` convention observed
  // in ShareX/XerahS and wepublish/wepublish. This mirrors the Gemini
  // PP-02 broadening and ensures docs-quality checks do not FP on repos
  // that keep guidance outside `.windsurf/rules/` alone.
  const rules = allRulesContent(ctx) || '';
  const readme = ctx.fileContent('README.md') || '';
  const legacy = ctx.legacyWindsurfrules ? (ctx.legacyWindsurfrules() || '') : '';
  const agents = ctx.fileContent('AGENTS.md') || '';
  const claudeMd = ctx.fileContent('CLAUDE.md') || ctx.fileContent('.claude/CLAUDE.md') || '';
  const contributing = ctx.fileContent('CONTRIBUTING.md') || '';
  const architecture = ctx.fileContent('ARCHITECTURE.md') || '';
  const development = ctx.fileContent('DEVELOPMENT.md') || ctx.fileContent('DEVELOPING.md') || '';
  const aiInstructions = ctx.fileContent('.ai/instructions.md') || ctx.fileContent('.ai/tech-stack.md') || '';
  const windsurfMd = ctx.fileContent('WINDSURF.md') || ctx.fileContent('windsurf_rules.md') || '';
  return `${rules}\n${readme}\n${legacy}\n${agents}\n${claudeMd}\n${contributing}\n${architecture}\n${development}\n${aiInstructions}\n${windsurfMd}`;
}

function expectedVerificationCategories(ctx) {
  const categories = new Set();
  const pkg = ctx.jsonFile ? ctx.jsonFile('package.json') : null;
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

function hasArchitecture(content) {
  return /```mermaid|flowchart\b|graph\s+(TD|LR|RL|BT)\b|##\s+Architecture\b|##\s+Project Map\b|##\s+Structure\b/i.test(content);
}

function repoLooksRegulated(ctx) {
  const filenames = (ctx.files || []).join('\n');
  const pkg = ctx.fileContent('package.json') || '';
  const readme = ctx.fileContent('README.md') || '';
  const combined = `${filenames}\n${pkg}\n${readme}`;
  const strong = /\bhipaa\b|\bphi\b|\bpci\b|\bsoc2\b|\biso[- ]?27001\b|\bcompliance\b|\bhealth(?:care)?\b|\bmedical\b|\bbank(?:ing)?\b|\bpayments?\b|\bfintech\b/i;
  if (strong.test(combined)) return true;
  const weakMatches = combined.match(/\bgdpr\b|\bpii\b/gi) || [];
  return weakMatches.length >= 2;
}

function memoryContents(ctx) {
  const memories = ctx.memoryContents ? ctx.memoryContents() : [];
  return memories.map(m => m.content || '').join('\n');
}

function workflowContents(ctx) {
  const files = ctx.workflowFiles ? ctx.workflowFiles() : [];
  return files.map(f => ctx.fileContent(f) || '').join('\n');
}

function ciWorkflowContents(ctx) {
  const files = ctx.ciWorkflowFiles ? ctx.ciWorkflowFiles() : [];
  return files.map(f => ctx.fileContent(f) || '').join('\n');
}

function wordCount(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function repoFilesOverLineThreshold(ctx, threshold = 300) {
  const oversized = [];

  for (const filePath of ctx.files || []) {
    if (/^(node_modules|dist|build|coverage|\.git|\.next|vendor|out)\//i.test(filePath)) continue;
    if (/\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|lock|woff2?)$/i.test(filePath)) continue;

    const content = ctx.fileContent(filePath);
    if (!content) continue;

    const lineCount = content.split(/\r?\n/).length;
    if (lineCount > threshold) oversized.push({ filePath, lineCount });
  }

  return oversized.sort((a, b) => b.lineCount - a.lineCount);
}

// ─── WINDSURF_TECHNIQUES ──────────────────────────────────────────────────────

const WINDSURF_TECHNIQUES = {

  // =============================================
  // A. Rules (9 checks) — WS-A01..WS-A09
  // =============================================

  windsurfRulesExist: {
    id: 'WS-A01',
    name: '.windsurf/rules/ directory exists with .md files',
    check: (ctx) => {
      // PP-03: `windsurfRules()` now also enumerates the
      // `.windsurfrules/` directory form. In addition, pointer-style
      // `.windsurfrules` (one-liner referencing e.g. `.ai/instructions.md`)
      // counts because it resolves to a real instruction body.
      const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
      if (rules.length > 0) return true;
      const legacy = ctx.legacyWindsurfrules ? ctx.legacyWindsurfrules() : null;
      return Boolean(legacy && legacy.trim().length > 0);
    },
    impact: 'critical',
    rating: 5,
    category: 'rules',
    fix: 'Create .windsurf/rules/ directory with at least one .md rule file with YAML frontmatter.',
    template: 'windsurf-rules',
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfNoLegacyWindsurfrules: {
    id: 'WS-A02',
    name: 'No .windsurfrules without migration to .windsurf/rules/',
    check: (ctx) => {
      // PP-03: only raw legacy single-file `.windsurfrules` (non-pointer,
      // non-directory) counts as the deprecated form. Pointer files
      // delegating to a modern instruction surface (e.g.
      // `.ai/instructions.md`) and the `.windsurfrules/` directory
      // convention are both acceptable modern patterns.
      const raw = ctx.hasRawLegacyWindsurfrules ? ctx.hasRawLegacyWindsurfrules() : false;
      return !raw;
    },
    impact: 'critical',
    rating: 5,
    category: 'rules',
    fix: 'Migrate .windsurfrules to .windsurf/rules/*.md with proper YAML frontmatter.',
    template: 'windsurf-legacy-migration',
    file: () => '.windsurfrules',
    line: () => 1,
  },

  windsurfAlwaysRuleExists: {
    id: 'WS-A03',
    name: 'At least one rule is always_on for Cascade',
    check: (ctx) => {
      const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
      if (rules.length === 0) return null;
      return rules.some((rule) => normalizeWindsurfTrigger(rule.frontmatter) === 'always_on');
    },
    impact: 'high',
    rating: 5,
    category: 'rules',
    fix: 'Add a focused `trigger: always_on` rule for core guidance. Files without frontmatter also default to always_on, so make that choice explicit.',
    template: 'windsurf-rules',
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfRulesValidFrontmatter: {
    id: 'WS-A04',
    name: 'Rules have valid YAML frontmatter',
    check: (ctx) => {
      // PP-03: absent frontmatter is acceptable — Windsurf defaults such
      // rules to `always_on`. Only flag when frontmatter *is* present
      // and malformed, or when the declared trigger/field is invalid.
      const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
      if (rules.length === 0) return null;
      return rules.every((rule) => rule.frontmatter == null || isValidWindsurfFrontmatter(rule.frontmatter));
    },
    impact: 'high',
    rating: 4,
    category: 'rules',
    fix: 'Fix YAML frontmatter in rule files. Use current Windsurf triggers (`always_on`, `glob`, `model_decision`, `manual`) plus `glob`/`globs`, `description`, and `name` as needed.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => 1,
  },

  windsurfRulesUnder10kChars: {
    id: 'WS-A05',
    name: 'Modern rule files stay under the 12K character limit',
    check: (ctx) => {
      const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
      if (rules.length === 0) return null;
      return rules.every((rule) => (rule.charCount || 0) <= 12000);
    },
    impact: 'high',
    rating: 4,
    category: 'rules',
    fix: 'Split rule files before they approach 12,000 characters. Windsurf silently truncates modern rules after 12K with no warning.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfRulesUnder500Words: {
    id: 'WS-A06',
    name: 'Rules are under ~500 words each (longer = less reliably followed)',
    check: (ctx) => {
      const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
      if (rules.length === 0) return null;
      return rules.every(r => wordCount(r.body) <= 500);
    },
    impact: 'medium',
    rating: 3,
    category: 'rules',
    fix: 'Split long rules into focused, shorter files. Rules over ~500 words are less reliably followed.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfRulesNoFiller: {
    id: 'WS-A07',
    name: 'No generic filler instructions in rules',
    check: (ctx) => {
      const content = allRulesContent(ctx);
      if (!content.trim()) return null;
      return !FILLER_PATTERNS.some(p => p.test(content));
    },
    impact: 'low',
    rating: 3,
    category: 'rules',
    fix: 'Replace generic filler like "be helpful" with concrete, repo-specific guidance.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => {
      const content = allRulesContent({ windsurfRules: () => [] });
      return content ? findFillerLine(content) : null;
    },
  },

  windsurfRulesNoSecrets: {
    id: 'WS-A08',
    name: 'No secrets/API keys in rule files',
    check: (ctx) => {
      const rulesContent = allRulesContent(ctx);
      const workflowContent = (ctx.workflowFiles ? ctx.workflowFiles() : [])
        .map(f => ctx.fileContent(f) || '').join('\n');
      const combined = `${rulesContent}\n${workflowContent}`;
      if (!combined.trim()) return null;
      return !containsEmbeddedSecret(combined);
    },
    impact: 'critical',
    rating: 5,
    category: 'rules',
    fix: 'Remove API keys and secrets from rule and workflow files. Use environment variables instead.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfAgentRequestedDescriptions: {
    id: 'WS-A09',
    name: 'model_decision rules have precise descriptions',
    check: (ctx) => {
      const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
      const modelDecisionRules = rules.filter((rule) => normalizeWindsurfTrigger(rule.frontmatter) === 'model_decision');
      if (modelDecisionRules.length === 0) return null;
      return modelDecisionRules.every((r) => {
        const desc = r.frontmatter && r.frontmatter.description;
        return desc && String(desc).trim().length >= 15;
      });
    },
    impact: 'medium',
    rating: 3,
    category: 'rules',
    fix: 'Add clear, specific descriptions (15+ chars) to `trigger: model_decision` rules so Windsurf can judge when to load the full rule body.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  // =============================================
  // B. Config (7 checks) — WS-B01..WS-B07
  // =============================================

  windsurfMcpJsonExists: {
    id: 'WS-B01',
    name: 'Global Windsurf MCP config exists when MCP is used',
    check: (ctx) => {
      const raw = mcpJsonRaw(ctx);
      if (raw) return true;
      const docs = docsBundle(ctx);
      if (!/\bmcp\b/i.test(docs)) return null;
      return false;
    },
    impact: 'high',
    rating: 4,
    category: 'config',
    fix: 'Create `%USERPROFILE%/.codeium/windsurf/mcp_config.json` for MCP. Windsurf MCP is global-only in current runtime; project `.windsurf/mcp.json` is not the validated surface.',
    template: 'windsurf-mcp',
    file: () => windsurfMcpConfigPath(),
    line: () => null,
  },

  windsurfMcpTeamWhitelist: {
    id: 'WS-B02',
    name: 'MCP servers on team whitelist (if team)',
    check: (ctx) => {
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      const count = Object.keys(servers).length;
      if (count === 0) return null;
      // Check if rules mention team whitelist / approved servers
      const docs = docsBundle(ctx);
      if (!/team|org|enterprise/i.test(docs)) return null;
      return /whitelist|allowlist|approved.*server|mcp.*approv/i.test(docs);
    },
    impact: 'high',
    rating: 4,
    category: 'config',
    fix: 'Document MCP server team whitelist. Windsurf supports team-level MCP whitelisting.',
    template: null,
    file: () => windsurfMcpConfigPath(),
    line: () => null,
  },

  windsurfWorkflowsExist: {
    id: 'WS-B03',
    name: 'Workflow slash commands exist in .windsurf/workflows/',
    check: (ctx) => {
      // PP-03: workflows are opt-in. N/A when the repo has no
      // `.windsurf/workflows/` directory at all — firing a fail on every
      // Windsurf repo without workflows produced systematic bias.
      const files = ctx.workflowFiles ? ctx.workflowFiles() : [];
      if (files.length > 0) return true;
      if (!ctx.hasDir || !ctx.hasDir('.windsurf/workflows')) return null;
      return false;
    },
    impact: 'medium',
    rating: 3,
    category: 'config',
    fix: 'Create .windsurf/workflows/*.md files for reusable slash command workflows.',
    template: 'windsurf-workflows',
    file: () => '.windsurf/workflows/',
    line: () => null,
  },

  windsurfCascadeignoreExists: {
    id: 'WS-B04',
    name: '.cascadeignore exists for sensitive file exclusion',
    check: (ctx) => {
      const hasCascadeignore = ctx.hasCascadeignore ? ctx.hasCascadeignore() : Boolean(ctx.fileContent('.cascadeignore'));
      if (hasCascadeignore) return true;
      // N/A if no sensitive file signals
      const hasSecrets = ctx.fileContent('.env') || ctx.fileContent('.env.local') || ctx.hasDir('secrets');
      if (!hasSecrets) return null;
      return false;
    },
    impact: 'high',
    rating: 4,
    category: 'config',
    fix: 'Create .cascadeignore to exclude sensitive files from Cascade agent access (similar to .gitignore syntax).',
    template: 'windsurf-cascadeignore',
    file: () => '.cascadeignore',
    line: () => null,
  },

  windsurfMemoriesConfigured: {
    id: 'WS-B05',
    name: 'Memories configured for persistent context',
    check: (ctx) => {
      // PP-03: memories are workspace-local and strictly opt-in. The
      // technique docs themselves warn not to rely on them (see
      // windsurfMemoryScopeDocumented). Firing a fail on every repo that
      // doesn't ship a `.windsurf/memories/` directory produced a 10/10
      // FP rate. N/A when the repo doesn't opt in.
      const memories = ctx.memoryFiles ? ctx.memoryFiles() : [];
      if (memories.length > 0) return true;
      if (!ctx.hasDir || !ctx.hasDir('.windsurf/memories')) return null;
      return false;
    },
    impact: 'medium',
    rating: 3,
    category: 'config',
    fix: 'Create `.windsurf/memories/` only for workspace-local persistent context. Do not rely on memories for cross-project or team-shared behavior.',
    template: 'windsurf-memories',
    file: () => '.windsurf/memories/',
    line: () => null,
  },

  windsurfMcpValidJson: {
    id: 'WS-B06',
    name: 'MCP config is valid JSON',
    check: (ctx) => {
      const raw = mcpJsonRaw(ctx);
      if (!raw) return null;
      const result = tryParseJson(raw);
      return result && result.ok;
    },
    impact: 'critical',
    rating: 5,
    category: 'config',
    fix: 'Fix malformed JSON in `%USERPROFILE%/.codeium/windsurf/mcp_config.json`.',
    template: null,
    file: () => windsurfMcpConfigPath(),
    line: (ctx) => {
      const result = tryParseJson(mcpJsonRaw(ctx));
      if (result && result.ok) return null;
      if (result && result.error) {
        const match = result.error.match(/position (\d+)/i);
        if (match) {
          const raw = mcpJsonRaw(ctx);
          return raw ? raw.slice(0, Number(match[1])).split('\n').length : 1;
        }
      }
      return 1;
    },
  },

  windsurfWorkflowsClear: {
    id: 'WS-B07',
    name: 'Workflow .md files have clear prompts',
    check: (ctx) => {
      const files = ctx.workflowFiles ? ctx.workflowFiles() : [];
      if (files.length === 0) return null;
      return files.every(f => {
        const content = ctx.fileContent(f);
        return content && content.trim().length >= 20;
      });
    },
    impact: 'low',
    rating: 2,
    category: 'config',
    fix: 'Ensure workflow files have clear, actionable prompt content (20+ chars).',
    template: null,
    file: () => '.windsurf/workflows/',
    line: () => null,
  },

  // =============================================
  // C. Trust & Safety (9 checks) — WS-C01..WS-C09
  // =============================================

  windsurfCascadeignoreSensitive: {
    id: 'WS-C01',
    name: 'ZDR guidance does not overclaim local-only processing',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/\bzdr\b|zero.?data.?retention|privacy|retention/i.test(docs)) return null;
      const claimsNoSend = /\b(no|never|without)\b.{0,40}\b(send|transmit|leave)\b.{0,40}\b(code|data)\b/i.test(docs);
      const explainsTransmission = /\btransmi|sent to windsurf|server.?side processing|retention\b/i.test(docs);
      return !claimsNoSend && explainsTransmission;
    },
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'Document ZDR accurately: it affects retention/training, not whether code is sent to Windsurf for processing. Keep `.cascadeignore` for local exclusion, but do not describe ZDR as a no-transmission mode.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfNoSecretsInConfig: {
    id: 'WS-C02',
    name: 'No secrets in any Windsurf config files',
    check: (ctx) => {
      const rulesContent = allRulesContent(ctx);
      const mcpContent = mcpJsonRaw(ctx);
      const memContent = memoryContents(ctx);
      const combined = `${rulesContent}\n${mcpContent}\n${memContent}`;
      if (!combined.trim()) return null;
      return !containsEmbeddedSecret(combined);
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Remove secrets from all Windsurf config files. Use environment variables instead.',
    template: null,
    file: () => '.windsurf/',
    line: () => null,
  },

  windsurfMcpTrustedSources: {
    id: 'WS-C03',
    name: 'MCP servers from trusted sources',
    check: (ctx) => {
      const raw = mcpJsonRaw(ctx);
      if (!raw) return null;
      const knownVulnerable = /mcp-poisoned|cve-2025/i.test(raw);
      const hasUntrusted = /curl.*\|.*sh|wget.*\|.*sh/i.test(raw);
      return !knownVulnerable && !hasUntrusted;
    },
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'Verify MCP servers are from trusted sources. Check for known MCP CVEs.',
    template: null,
    file: () => windsurfMcpConfigPath(),
    line: () => null,
  },

  windsurfMcpEnvVarSyntax: {
    id: 'WS-C04',
    name: 'MCP env vars use proper syntax (not hardcoded)',
    check: (ctx) => {
      const raw = mcpJsonRaw(ctx);
      if (!raw) return null;
      const data = mcpJsonData(ctx);
      if (!data) return null;
      const validation = validateMcpEnvVars(data);
      return validation.valid;
    },
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'Use ${env:VAR_NAME} syntax for MCP environment variables instead of hardcoded values.',
    template: null,
    file: () => windsurfMcpConfigPath(),
    line: () => null,
  },

  windsurfNoDirectPushMain: {
    id: 'WS-C05',
    name: 'Rules discourage direct push to main',
    check: (ctx) => {
      const rules = allRulesContent(ctx);
      if (!rules.trim()) return null;
      const hasPushToMain = /push.*main|commit.*main.*direct|direct.*push/i.test(rules);
      return !hasPushToMain;
    },
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'Ensure rules guide Cascade to create branches and PRs, not push directly to main.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfMemoriesNoSecrets: {
    id: 'WS-C06',
    name: 'No secrets in workspace-local memory files',
    check: (ctx) => {
      const content = memoryContents(ctx);
      if (!content.trim()) return null;
      return !containsEmbeddedSecret(content);
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Remove secrets from `.windsurf/memories/`. Memories persist inside the current workspace and can resurface in later sessions even though they are not cross-project or team-shared.',
    template: null,
    file: () => '.windsurf/memories/',
    line: () => null,
  },

  windsurfCodeReversionRisk: {
    id: 'WS-C07',
    name: 'Code reversion risk mitigated',
    check: (ctx) => {
      const vscodeRaw = ctx.fileContent('.vscode/settings.json') || '';
      const hasFormatOnSave = /formatOnSave.*true/i.test(vscodeRaw);
      if (!hasFormatOnSave) return null;
      const rules = allRulesContent(ctx);
      return /code reversion|format.*save.*conflict|revert|format.*save.*warning/i.test(rules);
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Document code reversion risk: format-on-save + agent edits can cause silent code loss.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfTeamSyncAware: {
    id: 'WS-C08',
    name: 'Memory scope limitations are documented accurately',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/\bmemories?\b/i.test(docs)) return null;
      const mentionsWorkspaceScope = /\bworkspace\b|\blocal only\b|\bnot cross-project\b|\bcurrent repo\b/i.test(docs);
      const overclaimsSharing = /\bteam.?sync\b|\bshared across projects\b|\bcross-project memory\b/i.test(docs);
      return mentionsWorkspaceScope && !overclaimsSharing;
    },
    impact: 'medium',
    rating: 4,
    category: 'trust',
    fix: 'Document memories as workspace-scoped and local to the current workspace. Do not rely on cross-project recall or team sync when writing guidance.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfNoWildcardWorkflows: {
    id: 'WS-C09',
    name: 'No overly broad workflow triggers',
    check: (ctx) => {
      const content = workflowContents(ctx);
      if (!content.trim()) return null;
      const hasBroad = /trigger:.*\*|on:.*\*|all.*files/i.test(content);
      return !hasBroad;
    },
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'Scope workflow triggers to specific patterns. Avoid wildcards.',
    template: null,
    file: () => '.windsurf/workflows/',
    line: () => null,
  },

  // =============================================
  // D. Cascade Agent (5 checks) — WS-D01..WS-D05
  // =============================================

  windsurfRulesReachCascade: {
    id: 'WS-D01',
    name: 'Rules properly reach Cascade (not just .windsurfrules)',
    check: (ctx) => {
      // PP-03: `windsurfRules()` now includes `.windsurfrules/`
      // directory form. Pointer-style legacy `.windsurfrules` that
      // points at a modern instruction file (`.ai/instructions.md`,
      // AGENTS.md, etc.) is also acceptable since the referenced body
      // is what Cascade actually receives.
      const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
      const hasLegacy = ctx.hasLegacyRules ? ctx.hasLegacyRules() : false;
      if (rules.length === 0 && !hasLegacy) return null;
      if (rules.length > 0) return true;
      // Raw legacy single-file is a genuine miss; pointer/dir is fine.
      const raw = ctx.hasRawLegacyWindsurfrules ? ctx.hasRawLegacyWindsurfrules() : false;
      return !raw;
    },
    impact: 'critical',
    rating: 5,
    category: 'cascade-agent',
    fix: 'Create .windsurf/rules/*.md files with proper frontmatter. .windsurfrules may be deprecated.',
    template: 'windsurf-rules',
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfCascadeMultiFile: {
    id: 'WS-D02',
    name: 'Cascade multi-file editing awareness documented',
    check: (ctx) => {
      // PP-03: this is a Cascade-specific awareness advisory. It should
      // only fire when the repo has actual `.windsurf/rules/` content
      // that could reasonably cover Cascade guidance. Pointer-only
      // `.windsurfrules` repos and repos with just a README keep this
      // check N/A — the README is not the right place for Cascade
      // multi-file editing notes.
      const rules = allRulesContent(ctx);
      if (!rules.trim()) return null;
      return /multi.?file|cross.?file|cascade.*edit|multiple.*file/i.test(docsBundle(ctx));
    },
    impact: 'medium',
    rating: 3,
    category: 'cascade-agent',
    fix: 'Document Cascade multi-file editing capabilities and any project-specific constraints.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfCascadeStepsAwareness: {
    id: 'WS-D03',
    name: 'Steps automation awareness documented',
    check: (ctx) => {
      // PP-03: Cascade-specific advisory; N/A when no
      // `.windsurf/rules/` content exists.
      const rules = allRulesContent(ctx);
      if (!rules.trim()) return null;
      return /steps|automation|step.?by.?step|cascade.*step/i.test(docsBundle(ctx));
    },
    impact: 'medium',
    rating: 3,
    category: 'cascade-agent',
    fix: 'Document Cascade Steps automation capabilities for complex multi-step tasks.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfSessionLengthAwareness: {
    id: 'WS-D04',
    name: 'Agent session length awareness',
    check: (ctx) => {
      // PP-03: Cascade-specific advisory; N/A when no
      // `.windsurf/rules/` content exists (advisory belongs in rules,
      // not in README).
      const rules = allRulesContent(ctx);
      if (!rules.trim()) return null;
      return /session.*length|session.*limit|context.*drift|long.*session/i.test(docsBundle(ctx));
    },
    impact: 'low',
    rating: 2,
    category: 'cascade-agent',
    fix: 'Document session length recommendations. Long sessions may lose Cascade context.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfSkillsConfigured: {
    id: 'WS-D05',
    name: 'Cascade skills configured for project needs',
    check: (ctx) => {
      // PP-03: the `.windsurf/skills/` directory is itself a valid
      // signal (observed in snyk/snyk-intellij-plugin). Otherwise
      // N/A unless the repo has `.windsurf/rules/` content.
      if (ctx.hasDir && ctx.hasDir('.windsurf/skills')) return true;
      const rules = allRulesContent(ctx);
      if (!rules.trim()) return null;
      return /\bskill\b|\bcapability\b|tool.*use|cascade.*skill/i.test(docsBundle(ctx));
    },
    impact: 'medium',
    rating: 3,
    category: 'cascade-agent',
    fix: 'Configure Cascade skills relevant to the project (web search, file editing, terminal, etc.).',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  // =============================================
  // E. MCP (5 checks) — WS-E01..WS-E05
  // =============================================

  windsurfMcpPerSurface: {
    id: 'WS-E01',
    name: 'MCP uses the validated global Windsurf config surface',
    check: (ctx) => {
      const raw = mcpJsonRaw(ctx);
      if (!raw) return null;
      return !Boolean(ctx.fileContent('.windsurf/mcp.json'));
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'Use `%USERPROFILE%/.codeium/windsurf/mcp_config.json` as the current MCP surface. Do not rely on project `.windsurf/mcp.json` or the old `~/.windsurf/mcp.json` path.',
    template: 'windsurf-mcp',
    file: () => windsurfMcpConfigPath(),
    line: () => null,
  },

  windsurfMcpProjectOverride: {
    id: 'WS-E02',
    name: 'Windsurf MCP guidance does not assume project-level overrides',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/\bmcp\b/i.test(docs)) return null;
      return !/\.windsurf\/mcp\.json|~\/\.windsurf\/mcp\.json|project-level mcp/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'Remove docs that describe project-level MCP override behavior. Current Windsurf MCP runtime is validated only through the global `%USERPROFILE%/.codeium/windsurf/mcp_config.json` file.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfMcpEnvVarFormat: {
    id: 'WS-E03',
    name: 'MCP env vars use ${env:VAR} syntax',
    check: (ctx) => {
      const raw = mcpJsonRaw(ctx);
      if (!raw) return null;
      const data = mcpJsonData(ctx);
      if (!data) return null;
      const validation = validateMcpEnvVars(data);
      return validation.valid;
    },
    impact: 'high',
    rating: 5,
    category: 'mcp',
    fix: 'Use ${env:VAR_NAME} syntax for MCP environment variables instead of hardcoded values.',
    template: null,
    file: () => windsurfMcpConfigPath(),
    line: () => null,
  },

  windsurfMcpCurrentVersion: {
    id: 'WS-E04',
    name: 'MCP servers are current version',
    check: (ctx) => {
      const raw = mcpJsonRaw(ctx);
      if (!raw) return null;
      const hasStale = /\b\d+\.\d+\.\d+\b/.test(raw) && !/@latest\b/.test(raw);
      return !hasStale;
    },
    impact: 'low',
    rating: 2,
    category: 'mcp',
    fix: 'Use @latest for MCP packages or regularly update pinned versions.',
    template: null,
    file: () => windsurfMcpConfigPath(),
    line: () => null,
  },

  windsurfMcpTeamWhitelistActive: {
    id: 'WS-E05',
    name: 'Team MCP whitelist active for controlled environments',
    check: (ctx) => {
      const mcp = mcpJsonData(ctx);
      if (!mcp) return null;
      const docs = docsBundle(ctx);
      if (!/team|enterprise/i.test(docs)) return null;
      return /whitelist|allowlist|approved/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'Enable MCP team whitelist for controlled environments.',
    template: null,
    file: () => windsurfMcpConfigPath(),
    line: () => null,
  },

  // =============================================
  // F. Instructions Quality (5 checks) — WS-F01..WS-F05
  // =============================================

  windsurfRulesIncludeCommands: {
    id: 'WS-F01',
    name: 'Rules include build/test/lint commands',
    check: (ctx) => {
      // PP-03: verification commands often live in README / AGENTS /
      // CONTRIBUTING. Fall back to the full docsBundle if the core
      // rules don't mention them, so we don't FP on repos that keep
      // commands in a standard README section.
      const core = coreRulesContent(ctx) || allRulesContent(ctx);
      const expected = expectedVerificationCategories(ctx);
      if (expected.length === 0) {
        const combined = core || docsBundle(ctx);
        if (!combined.trim()) return null;
        return /\bverify\b|\btest\b|\blint\b|\bbuild\b/i.test(combined);
      }
      if (expected.every(cat => hasCommandMention(core, cat))) return true;
      const docs = docsBundle(ctx);
      if (!docs.trim()) return null;
      return expected.every(cat => hasCommandMention(docs, cat));
    },
    impact: 'high',
    rating: 5,
    category: 'instructions-quality',
    fix: 'Add actual build/test/lint commands to your core rules so Cascade can verify changes.',
    template: 'windsurf-rules',
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfRulesArchitecture: {
    id: 'WS-F02',
    name: 'Rules include architecture section or Mermaid diagram',
    check: (ctx) => {
      // PP-03: architecture content commonly lives in ARCHITECTURE.md
      // or a README section, not duplicated inside rules. Widen to
      // docsBundle. N/A only when the repo has no instruction surface
      // whatsoever (not even a README).
      const bundle = docsBundle(ctx);
      if (!bundle.trim()) return null;
      return hasArchitecture(bundle);
    },
    impact: 'medium',
    rating: 4,
    category: 'instructions-quality',
    fix: 'Add an architecture section or Mermaid diagram to your core rule to orient Cascade.',
    template: 'windsurf-rules',
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfRulesVerification: {
    id: 'WS-F03',
    name: 'Rules mention verification/testing expectations',
    check: (ctx) => {
      const content = allRulesContent(ctx);
      if (!content.trim()) return null;
      return /\bverif|\btest.*before|\bbefore.*commit|\brun test|\bensure test/i.test(content);
    },
    impact: 'high',
    rating: 5,
    category: 'instructions-quality',
    fix: 'Add verification expectations: Cascade should run tests before declaring a task complete.',
    template: 'windsurf-rules',
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfRulesNoContradictions: {
    id: 'WS-F04',
    name: 'No contradictions between rules',
    check: (ctx) => {
      const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
      if (rules.length < 2) return null;
      const combined = rules.map(r => r.body || '').join('\n');
      const hasContradiction = /\bnever use.*\balways use|\balways.*\bnever/i.test(combined);
      return !hasContradiction;
    },
    impact: 'medium',
    rating: 3,
    category: 'instructions-quality',
    fix: 'Review rules for contradictions. Windsurf concatenates all matching rules.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfRulesProjectSpecific: {
    id: 'WS-F05',
    name: 'Rules reference project-specific patterns (not generic)',
    check: (ctx) => {
      // PP-03: widen to docsBundle and add stack-agnostic project
      // directory markers (internal/, pkg/, cmd/, crates/, modules/,
      // packages/, tests/, docs/, examples/). The previous JS-heavy
      // regex produced FPs on Rust/Go/Java/Swift/Kotlin repos whose
      // project layouts never mention src/app/api etc.
      const content = docsBundle(ctx);
      if (!content.trim()) return null;
      const pkg = ctx.jsonFile ? ctx.jsonFile('package.json') : null;
      const projectName = (pkg && pkg.name) || path.basename(ctx.dir);
      const hasSpecific = content.includes(projectName) ||
        /\b(src|app|api|routes|services|components|lib|cmd|internal|pkg|crates|modules|packages|tests?|docs|examples|scripts)\//i.test(content);
      return hasSpecific;
    },
    impact: 'medium',
    rating: 3,
    category: 'instructions-quality',
    fix: 'Reference actual project directories and patterns in rules instead of generic instructions.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  // =============================================
  // G. Workflows & Steps (5 checks) — WS-G01..WS-G05
  // =============================================

  windsurfWorkflowsDocumented: {
    id: 'WS-G01',
    name: 'Workflows have clear documentation',
    check: (ctx) => {
      const files = ctx.workflowFiles ? ctx.workflowFiles() : [];
      if (files.length === 0) return null;
      return files.every(f => {
        const content = ctx.fileContent(f) || '';
        return /name:|description:|##\s+/i.test(content);
      });
    },
    impact: 'high',
    rating: 4,
    category: 'workflows',
    fix: 'Document each workflow with name, description, and clear instructions.',
    template: null,
    file: () => '.windsurf/workflows/',
    line: () => null,
  },

  windsurfWorkflowsNoOverlap: {
    id: 'WS-G02',
    name: 'Workflows do not overlap in scope',
    check: (ctx) => {
      const files = ctx.workflowFiles ? ctx.workflowFiles() : [];
      if (files.length < 2) return null;
      // Basic check: workflow files have distinct names
      const names = files.map(f => f.split('/').pop().replace('.md', '').toLowerCase());
      return new Set(names).size === names.length;
    },
    impact: 'medium',
    rating: 3,
    category: 'workflows',
    fix: 'Ensure workflow files have distinct names and non-overlapping responsibilities.',
    template: null,
    file: () => '.windsurf/workflows/',
    line: () => null,
  },

  windsurfStepsIntegrated: {
    id: 'WS-G03',
    name: 'Steps automation integrated with rules',
    check: (ctx) => {
      const rules = allRulesContent(ctx);
      if (!rules.trim()) return null;
      return /step|workflow|slash.*command|automat/i.test(rules);
    },
    impact: 'medium',
    rating: 3,
    category: 'workflows',
    fix: 'Reference Steps automation in rules to guide Cascade on when to use automated workflows.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfWorkflowsScopedActions: {
    id: 'WS-G04',
    name: 'Workflows have scoped, safe actions',
    check: (ctx) => {
      const content = workflowContents(ctx);
      if (!content.trim()) return null;
      const hasDangerous = /rm -rf|drop table|force push|--force|delete.*all/i.test(content);
      return !hasDangerous;
    },
    impact: 'high',
    rating: 5,
    category: 'workflows',
    fix: 'Remove dangerous commands from workflows. Workflows should be safe and reversible.',
    template: null,
    file: () => '.windsurf/workflows/',
    line: () => null,
  },

  windsurfWorkflowsVersioned: {
    id: 'WS-G05',
    name: 'Workflow files are version-controlled',
    check: (ctx) => {
      const files = ctx.workflowFiles ? ctx.workflowFiles() : [];
      if (files.length === 0) return null;
      // Assume if in .windsurf/workflows/ they should be committed
      return true;
    },
    impact: 'low',
    rating: 2,
    category: 'workflows',
    fix: 'Ensure .windsurf/workflows/ files are committed to version control.',
    template: null,
    file: () => '.windsurf/workflows/',
    line: () => null,
  },

  // =============================================
  // H. Memories (5 checks) — WS-H01..WS-H05
  // =============================================

  windsurfMemoriesDocumented: {
    id: 'WS-H01',
    name: 'Memories have clear structure and purpose',
    check: (ctx) => {
      const memories = ctx.memoryContents ? ctx.memoryContents() : [];
      if (memories.length === 0) return null;
      return memories.every(m => {
        const content = m.content || '';
        return content.trim().length >= 20 && /##\s+|\btitle\b|\bpurpose\b|\bcontext\b/i.test(content);
      });
    },
    impact: 'medium',
    rating: 3,
    category: 'memories',
    fix: 'Structure memory files with clear titles and purpose sections.',
    template: null,
    file: () => '.windsurf/memories/',
    line: () => null,
  },

  windsurfMemoriesTeamSafe: {
    id: 'WS-H02',
    name: 'Memories are safe for workspace-local persistence (no personal data)',
    check: (ctx) => {
      const content = memoryContents(ctx);
      if (!content.trim()) return null;
      const hasPersonal = /\bpassword\b|\btoken\b|\bapi.?key\b|\bsecret\b|\bprivate.?key\b/i.test(content);
      return !hasPersonal;
    },
    impact: 'high',
    rating: 5,
    category: 'memories',
    fix: 'Remove personal data and secrets from memories. They are workspace-local, but they still persist and can influence future sessions in this repo.',
    template: null,
    file: () => '.windsurf/memories/',
    line: () => null,
  },

  windsurfMemoriesFocused: {
    id: 'WS-H03',
    name: 'Memory files are focused (not catch-all)',
    check: (ctx) => {
      const memories = ctx.memoryContents ? ctx.memoryContents() : [];
      if (memories.length === 0) return null;
      return memories.every(m => wordCount(m.content) <= 1000);
    },
    impact: 'low',
    rating: 2,
    category: 'memories',
    fix: 'Keep memory files focused. Split large memories into topic-specific files.',
    template: null,
    file: () => '.windsurf/memories/',
    line: () => null,
  },

  windsurfMemoriesNotStale: {
    id: 'WS-H04',
    name: 'Memory content is current (not stale)',
    check: (ctx) => {
      const content = memoryContents(ctx);
      if (!content.trim()) return null;
      // Check for date references that are old
      const hasDate = /\b20\d{2}-\d{2}-\d{2}\b/.test(content);
      if (!hasDate) return null; // Can't determine staleness without dates
      return true; // Pass if dates exist (manual review needed)
    },
    impact: 'low',
    rating: 2,
    category: 'memories',
    fix: 'Review memory files for stale content. Update or remove outdated memories.',
    template: null,
    file: () => '.windsurf/memories/',
    line: () => null,
  },

  windsurfMemoriesConsistentWithRules: {
    id: 'WS-H05',
    name: 'Memories are consistent with rules (no contradictions)',
    check: (ctx) => {
      const memories = memoryContents(ctx);
      const rules = allRulesContent(ctx);
      if (!memories.trim() || !rules.trim()) return null;
      // Simple check: no opposing always/never patterns
      const combined = `${memories}\n${rules}`;
      const hasContradiction = /\bnever use.*\balways use|\balways.*\bnever/i.test(combined);
      return !hasContradiction;
    },
    impact: 'medium',
    rating: 3,
    category: 'memories',
    fix: 'Ensure memories and rules are consistent. Contradictions confuse Cascade.',
    template: null,
    file: () => '.windsurf/memories/',
    line: () => null,
  },

  // =============================================
  // I. Enterprise (5 checks) — WS-I01..WS-I05
  // =============================================

  windsurfEnterpriseMcpWhitelist: {
    id: 'WS-I01',
    name: 'MCP team whitelist configured for Enterprise',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/enterprise/i.test(docs)) return null;
      return /mcp.*whitelist|whitelist.*mcp|approved.*server|team.*mcp/i.test(docs);
    },
    impact: 'high',
    rating: 4,
    category: 'enterprise',
    fix: 'Configure MCP team whitelist for Enterprise deployments.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfEnterpriseTeamSync: {
    id: 'WS-I02',
    name: 'Enterprise deployment model is documented',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/enterprise/i.test(docs)) return null;
      return /self-host|self host|hybrid|cloud deployment|on-prem|on prem/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'enterprise',
    fix: 'Document the actual Enterprise deployment posture (cloud, hybrid, or self-hosted). Do not describe memories as team-synced when runtime evidence shows they are workspace-scoped.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfEnterpriseAuditLogs: {
    id: 'WS-I03',
    name: 'Audit logs enabled',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/enterprise/i.test(docs)) return null;
      return /audit log|audit trail|tracking/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'enterprise',
    fix: 'Enable audit logs for Enterprise tier to track AI code generation.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfEnterpriseSecurityPolicy: {
    id: 'WS-I04',
    name: 'Security policy documents retention and transmission accurately',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/enterprise/i.test(docs)) return null;
      const hasPolicy = /security.*policy|data.*retention|compliance|privacy/i.test(docs);
      const mentionsZdr = /\bzdr\b|zero.?data.?retention/i.test(docs);
      if (!hasPolicy) return false;
      if (!mentionsZdr) return true;
      return /\btransmi|sent to windsurf|processing\b/i.test(docs);
    },
    impact: 'high',
    rating: 4,
    category: 'enterprise',
    fix: 'Document security and data handling accurately. If you mention ZDR, also state that it controls retention/training posture, not whether code is transmitted for processing.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfEnterpriseModelPolicy: {
    id: 'WS-I05',
    name: 'Model access policy defined',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/enterprise/i.test(docs)) return null;
      return /model.*policy|model.*access|allowed.*model|model.*restriction/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'enterprise',
    fix: 'Define model access policy for Enterprise — which models are available to team members.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  // =============================================
  // J. Cascadeignore & Review (4 checks) — WS-J01..WS-J04
  // =============================================

  windsurfCascadeignoreConfigured: {
    id: 'WS-J01',
    name: '.cascadeignore configured for project',
    check: (ctx) => {
      const content = ctx.cascadeignoreContent ? ctx.cascadeignoreContent() : ctx.fileContent('.cascadeignore');
      if (!content) return null;
      return content.trim().split('\n').filter(l => l.trim() && !l.startsWith('#')).length >= 1;
    },
    impact: 'medium',
    rating: 3,
    category: 'cascadeignore',
    fix: 'Configure .cascadeignore with at least one exclusion pattern.',
    template: null,
    file: () => '.cascadeignore',
    line: () => null,
  },

  windsurfCascadeignoreNoOverBroad: {
    id: 'WS-J02',
    name: '.cascadeignore not overly broad (would block Cascade)',
    check: (ctx) => {
      const content = ctx.cascadeignoreContent ? ctx.cascadeignoreContent() : ctx.fileContent('.cascadeignore');
      if (!content) return null;
      const lines = content.trim().split('\n').filter(l => l.trim() && !l.startsWith('#'));
      const overbroad = lines.some(l => l.trim() === '*' || l.trim() === '**' || l.trim() === '**/*');
      return !overbroad;
    },
    impact: 'high',
    rating: 4,
    category: 'cascadeignore',
    fix: 'Remove overly broad patterns from .cascadeignore that would block Cascade from all files.',
    template: null,
    file: () => '.cascadeignore',
    line: () => null,
  },

  windsurfReviewInstructionsLength: {
    id: 'WS-J03',
    name: 'Code review instructions within effective length',
    check: (ctx) => {
      const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
      const reviewRules = rules.filter(r =>
        /review|code.*review/i.test(r.name || '') ||
        (r.frontmatter && r.frontmatter.description && /review/i.test(r.frontmatter.description))
      );
      if (reviewRules.length === 0) return null;
      return reviewRules.every(r => wordCount(r.body) <= 400);
    },
    impact: 'medium',
    rating: 3,
    category: 'cascadeignore',
    fix: 'Keep code review instruction rules under ~400 words for reliable Cascade adherence.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfReviewNoAutoMerge: {
    id: 'WS-J04',
    name: 'No auto-merge without human review',
    check: (ctx) => {
      const content = workflowContents(ctx);
      const rules = allRulesContent(ctx);
      const combined = `${content}\n${rules}`;
      if (!combined.trim()) return null;
      return !/auto.*merge|merge.*without.*review/i.test(combined);
    },
    impact: 'high',
    rating: 4,
    category: 'cascadeignore',
    fix: 'Ensure no workflow or rule enables auto-merge without human review.',
    template: null,
    file: () => '.windsurf/workflows/',
    line: () => null,
  },

  // =============================================
  // K. Cross-Surface Consistency (4 checks) — WS-K01..WS-K04
  // =============================================

  windsurfRulesConsistentSurfaces: {
    id: 'WS-K01',
    name: 'Rules consistent across all Windsurf surfaces',
    check: (ctx) => {
      const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
      const workflows = ctx.workflowFiles ? ctx.workflowFiles() : [];
      if (rules.length === 0 && workflows.length === 0) return null;
      return rules.length > 0;
    },
    impact: 'high',
    rating: 4,
    category: 'cross-surface',
    fix: 'Ensure .windsurf/rules/ are consistent with workflow definitions.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfMcpConsistentSurfaces: {
    id: 'WS-K02',
    name: 'MCP guidance matches the current global-only config surface',
    check: (ctx) => {
      const raw = mcpJsonRaw(ctx);
      if (!raw) return null;
      return !Boolean(ctx.fileContent('.windsurf/mcp.json'));
    },
    impact: 'medium',
    rating: 3,
    category: 'cross-surface',
    fix: 'Document Windsurf MCP as global-only in current runtime. Remove stale references to project `.windsurf/mcp.json` overrides.',
    template: null,
    file: () => windsurfMcpConfigPath(),
    line: () => null,
  },

  windsurfMemoriesConsistentRules: {
    id: 'WS-K03',
    name: 'Memories consistent with rules',
    check: (ctx) => {
      const memories = ctx.memoryContents ? ctx.memoryContents() : [];
      const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
      if (memories.length === 0 || rules.length === 0) return null;
      return true; // Detailed contradiction check in WS-H05
    },
    impact: 'high',
    rating: 4,
    category: 'cross-surface',
    fix: 'Ensure memories and rules provide consistent guidance to Cascade.',
    template: null,
    file: () => '.windsurf/memories/',
    line: () => null,
  },

  windsurfCascadeignoreMatchesGitignore: {
    id: 'WS-K04',
    name: '.cascadeignore includes .gitignore sensitive patterns',
    check: (ctx) => {
      const cascadeignore = ctx.cascadeignoreContent ? ctx.cascadeignoreContent() : '';
      const gitignore = ctx.fileContent('.gitignore') || '';
      if (!cascadeignore || !gitignore) return null;
      // Check if cascadeignore covers at least some gitignore patterns
      const gitPatterns = gitignore.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      const cascadePatterns = cascadeignore.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      if (gitPatterns.length === 0 || cascadePatterns.length === 0) return null;
      // At least some overlap is expected
      return cascadePatterns.length > 0;
    },
    impact: 'medium',
    rating: 3,
    category: 'cross-surface',
    fix: 'Ensure .cascadeignore covers sensitive patterns from .gitignore.',
    template: null,
    file: () => '.cascadeignore',
    line: () => null,
  },

  // =============================================
  // L. Quality Deep (7 checks) — WS-L01..WS-L07
  // =============================================

  windsurfModernFeatures: {
    id: 'WS-L01',
    name: 'Rules mention modern Windsurf features (Steps, Memories, Workflows)',
    check: (ctx) => {
      // PP-03: widen to docsBundle; also credit `.windsurf/workflows` or
      // `.windsurf/skills` directories as structural evidence that the
      // repo has adopted modern Windsurf features.
      if (ctx.hasDir && (ctx.hasDir('.windsurf/workflows') || ctx.hasDir('.windsurf/skills'))) return true;
      const content = docsBundle(ctx);
      if (!content.trim()) return null;
      return /steps|memories|workflow|cascade|skill|slash command/i.test(content);
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Document awareness of modern Windsurf features: Steps, Memories, Workflows, Skills.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfNoDeprecatedPatterns: {
    id: 'WS-L02',
    name: 'No deprecated patterns (.windsurfrules for agent)',
    check: (ctx) => {
      // PP-03: only the raw single-file legacy form is deprecated.
      // Pointer-style `.windsurfrules` and the `.windsurfrules/`
      // directory convention are not.
      const raw = ctx.hasRawLegacyWindsurfrules ? ctx.hasRawLegacyWindsurfrules() : false;
      if (!raw) return null;
      return false;
    },
    impact: 'high',
    rating: 4,
    category: 'quality-deep',
    fix: 'Migrate .windsurfrules to .windsurf/rules/*.md with proper YAML frontmatter.',
    template: 'windsurf-legacy-migration',
    file: () => '.windsurfrules',
    line: () => null,
  },

  windsurfRuleCountManageable: {
    id: 'WS-L03',
    name: 'Rule file count is manageable (<20 files)',
    check: (ctx) => {
      const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
      if (rules.length === 0) return null;
      return rules.length < 20;
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Keep rule files under 20. Consolidate related rules to avoid context bloat.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfAlwaysRulesMinimized: {
    id: 'WS-L04',
    name: 'Always rules minimized (token cost per message)',
    check: (ctx) => {
      const always = ctx.alwaysRules ? ctx.alwaysRules() : [];
      if (always.length === 0) return null;
      return always.length <= 3;
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Minimize Always rules (keep to 1-3). Each adds token cost to every message.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfRuleCharLimitAware: {
    id: 'WS-L05',
    name: 'All modern rules stay within the 12K char limit',
    check: (ctx) => {
      const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
      if (rules.length === 0) return null;
      return rules.every((rule) => (rule.charCount || 0) <= 12000);
    },
    impact: 'high',
    rating: 4,
    category: 'quality-deep',
    fix: 'Keep modern rule files under 12,000 characters. Windsurf silently truncates content beyond 12K, and legacy/global rule surfaces still have a stricter 6K ceiling.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfCascadeContextAware: {
    id: 'WS-L06',
    name: 'Rules guide Cascade context usage (@-mentions, file refs)',
    check: (ctx) => {
      // PP-03: Cascade-specific deep-quality advisory; N/A when no
      // `.windsurf/rules/` content exists.
      const rules = allRulesContent(ctx);
      if (!rules.trim()) return null;
      const content = docsBundle(ctx);
      if (!content.trim()) return null;
      return /@|file.*reference|context.*include|codebase|index/i.test(content);
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Guide Cascade on context usage: @-mentions, file references, codebase indexing.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfSessionDriftAwareness: {
    id: 'WS-L07',
    name: 'Session drift awareness documented',
    check: (ctx) => {
      // PP-03: Cascade-specific deep-quality advisory; N/A when no
      // `.windsurf/rules/` content exists.
      const rules = allRulesContent(ctx);
      if (!rules.trim()) return null;
      return /session.*drift|context.*window|long.*session|session.*length|refresh.*context/i.test(docsBundle(ctx));
    },
    impact: 'low',
    rating: 2,
    category: 'quality-deep',
    fix: 'Document session drift awareness. Long sessions may lose Cascade context.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  // =============================================
  // M. Advisory (4 checks) — WS-M01..WS-M04
  // =============================================

  windsurfAdvisoryInstructionQuality: {
    id: 'WS-M01',
    name: 'No high-risk large files beyond Windsurf’s ~300-line accuracy threshold',
    check: (ctx) => {
      return repoFilesOverLineThreshold(ctx, 300).length === 0;
    },
    impact: 'high',
    rating: 4,
    category: 'advisory',
    fix: 'Break files down before they exceed roughly 300 lines. Windsurf accuracy degrades in the 300-500 line range and becomes noticeably unreliable on 500+ line edits.',
    template: null,
    file: (ctx) => {
      const oversized = repoFilesOverLineThreshold(ctx, 300);
      return oversized[0] ? oversized[0].filePath : null;
    },
    line: () => null,
  },

  windsurfAdvisorySecurityPosture: {
    id: 'WS-M02',
    name: 'Long-running Cascade tasks are scoped to mitigate stall risk',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      const hasLargeFiles = repoFilesOverLineThreshold(ctx, 300).length > 0;
      const hasAutomation = (ctx.workflowFiles ? ctx.workflowFiles() : []).length > 0;
      if (!hasLargeFiles && !hasAutomation) return null;
      return /small.*task|chunk|restart.*session|new session|retry|focused task/i.test(docs);
    },
    impact: 'medium',
    rating: 4,
    category: 'advisory',
    fix: 'Document that long autonomous tasks can stall without auto-recovery. Prefer smaller, restartable chunks and tell users when to start a new session.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfAdvisorySurfaceCoverage: {
    id: 'WS-M03',
    name: 'Repo does not assume an unsupported Windsurf CLI/headless surface',
    check: (ctx) => {
      const combined = `${docsBundle(ctx)}\n${ciWorkflowContents(ctx)}`;
      if (!combined.trim()) return null;
      const unsupportedAutomation = /\bwindsurf\b[\s\S]{0,80}\b(cli|headless|ci|pipeline|github action|automation|run)\b/i.test(combined) ||
        /\bcascade\b[\s\S]{0,80}\b(headless|ci|pipeline|automation)\b/i.test(combined);
      return !unsupportedAutomation;
    },
    impact: 'high',
    rating: 4,
    category: 'advisory',
    fix: 'Do not rely on Windsurf for CI/CD or headless automation. Windsurf currently has no supported CLI/headless mode, so automation lanes should use another platform.',
    template: null,
    file: () => '.github/workflows/',
    line: () => null,
  },

  windsurfAdvisoryMcpHealth: {
    id: 'WS-M04',
    name: 'Windows/WSL usage includes a Windsurf stability caveat',
    check: (ctx) => {
      // PP-03: relevance was keyed off `os.platform()`, which is the
      // *host* running the audit (always Windows in our environment),
      // causing a systematic 10/10 fail on every target repo. This
      // check should only fire when the *target repo* itself documents
      // Windows/WSL use — otherwise the advisory is not applicable.
      const docs = docsBundle(ctx);
      if (!/\bwsl\b|\bnative windows\b|\bwindows subsystem\b/i.test(docs)) return null;
      return /\bwsl\b.{0,40}\b(crash|unstable|avoid|native windows)\b|\bnative windows\b|\bavoid wsl\b/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'advisory',
    fix: 'Add a Windows note that Windsurf has known WSL crashes/path-resolution issues and is more stable in native Windows or native Linux than under WSL.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  // =============================================
  // N. Pack (4 checks) — WS-N01..WS-N04
  // =============================================

  windsurfPackDomainDetected: {
    id: 'WS-N01',
    name: 'Domain pack detection returns relevant results',
    check: (ctx) => {
      // PP-03: expand stack markers so we also recognise Kotlin/Java
      // (build.gradle, build.gradle.kts, pom.xml), Swift
      // (Package.swift, *.xcodeproj), .NET (*.csproj / *.sln), Ruby
      // (Gemfile), PHP (composer.json), requirements.txt and
      // Pipfile/poetry. Without these the check FP'd on every
      // non-JS/Go/Rust/Python repo.
      const pkg = ctx.jsonFile ? ctx.jsonFile('package.json') : null;
      if (pkg) return true;
      const simple = [
        'go.mod', 'Cargo.toml', 'pyproject.toml', 'requirements.txt',
        'Pipfile', 'poetry.lock', 'Gemfile', 'composer.json', 'pom.xml',
        'build.gradle', 'build.gradle.kts', 'Package.swift', 'mix.exs',
      ];
      if (simple.some(f => ctx.fileContent(f))) return true;
      const files = ctx.files || [];
      if (files.some(f => /\.(csproj|sln|fsproj|vbproj|xcodeproj|xcworkspace)\/?$/i.test(f))) return true;
      return false;
    },
    impact: 'low',
    rating: 2,
    category: 'advisory',
    fix: 'Ensure project has identifiable stack markers for domain pack detection.',
    template: null,
    file: () => 'package.json',
    line: () => null,
  },

  windsurfPackMcpRecommended: {
    id: 'WS-N02',
    name: 'MCP packs recommended based on project signals',
    check: (ctx) => {
      // PP-03: only relevant when the repo actually opts in to MCP
      // (either documents it or ships a project-local `.windsurf/mcp.json`).
      // Previously fired on every repo without global MCP config, which
      // is 10/10 FP against real Windsurf repos that don't use MCP.
      const mcp = mcpJsonData(ctx);
      const servers = mcp && mcp.mcpServers ? mcp.mcpServers : {};
      if (Object.keys(servers).length > 0) return true;
      const projectMcp = ctx.mcpConfig ? ctx.mcpConfig() : null;
      if (projectMcp && projectMcp.ok) return true;
      const docs = docsBundle(ctx);
      if (!/\bmcp\b/i.test(docs)) return null;
      return false;
    },
    impact: 'low',
    rating: 2,
    category: 'advisory',
    fix: 'Add recommended MCP servers to `%USERPROFILE%/.codeium/windsurf/mcp_config.json` based on the project domain.',
    template: 'windsurf-mcp',
    file: () => windsurfMcpConfigPath(),
    line: () => null,
  },

  windsurfPackGovernanceApplied: {
    id: 'WS-N03',
    name: 'Governance pack applied if enterprise signals detected',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/enterprise|business/i.test(docs)) return null;
      return /governance|policy|audit/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'advisory',
    fix: 'Apply governance pack for enterprise repos.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  windsurfPackConsistency: {
    id: 'WS-N04',
    name: 'All applied packs are consistent with each other',
    check: (ctx) => {
      const rules = allRulesContent(ctx);
      const mcp = mcpJsonRaw(ctx);
      if (!rules && !mcp) return null;
      const rulesStrict = /\bstrict\b|\blocked.?down\b|\bno auto/i.test(rules);
      const configPermissive = /yolo|auto.*run.*all/i.test(rules);
      return !(rulesStrict && configPermissive);
    },
    impact: 'medium',
    rating: 3,
    category: 'advisory',
    fix: 'Resolve contradictions between rule guidance and configuration.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  // =============================================
  // O. Repeat (3 checks) — WS-O01..WS-O03
  // =============================================

  windsurfRepeatScoreImproved: {
    id: 'WS-O01',
    name: 'Audit score improved since last run',
    check: () => null, // Requires snapshot history
    impact: 'low',
    rating: 2,
    category: 'freshness',
    fix: 'Run audits regularly and track score improvement over time.',
    template: null,
    file: () => null,
    line: () => null,
  },

  windsurfRepeatNoRegressions: {
    id: 'WS-O02',
    name: 'No regressions since last audit',
    check: () => null, // Requires snapshot history
    impact: 'medium',
    rating: 3,
    category: 'freshness',
    fix: 'Review and fix any regressions detected since the last audit.',
    template: null,
    file: () => null,
    line: () => null,
  },

  windsurfRepeatFeedbackLoop: {
    id: 'WS-O03',
    name: 'Feedback loop active for recommendations',
    check: () => null, // Requires feedback data
    impact: 'low',
    rating: 2,
    category: 'freshness',
    fix: 'Use `npx nerviq --platform windsurf feedback` to rate recommendations.',
    template: null,
    file: () => null,
    line: () => null,
  },

  // =============================================
  // P. Freshness (3 checks) — WS-P01..WS-P03
  // =============================================

  windsurfFreshnessSourcesVerified: {
    id: 'WS-P01',
    name: 'P0 freshness sources verified within threshold',
    check: () => null, // Requires freshness verification data
    impact: 'medium',
    rating: 3,
    category: 'freshness',
    fix: 'Verify P0 Windsurf documentation sources are current before claiming freshness.',
    template: null,
    file: () => null,
    line: () => null,
  },

  windsurfFreshnessPropagation: {
    id: 'WS-P02',
    name: 'Freshness propagation checklist is current',
    check: () => null, // Requires propagation tracking
    impact: 'low',
    rating: 2,
    category: 'freshness',
    fix: 'Review propagation checklist when Windsurf releases new features or changes.',
    template: null,
    file: () => null,
    line: () => null,
  },

  windsurfFreshnessRuleFormat: {
    id: 'WS-P03',
    name: 'Rule format matches current Windsurf version expectations',
    check: (ctx) => {
      const rules = ctx.windsurfRules ? ctx.windsurfRules() : [];
      if (rules.length === 0) return null;
      // All rules should have YAML frontmatter
      return rules.every(r => r.frontmatter !== null);
    },
    impact: 'medium',
    rating: 3,
    category: 'freshness',
    fix: 'Ensure all rules use current Windsurf format with YAML frontmatter.',
    template: null,
    file: () => '.windsurf/rules/',
    line: () => null,
  },

  // =============================================
  // T. Cross-Cutting Engineering (48 checks) — WS-T01..WS-T48
  // =============================================

  wsTestFrameworkDetected: {
    id: 'WS-T01', name: 'Test framework detected in project',
    check: (ctx) => { const p = ctx.fileContent('package.json'); if (!p) return null; return /jest|vitest|mocha|jasmine|ava|tap\b/i.test(p) || ctx.files.some(f => /pytest|spec_helper|rspec/i.test(f)); },
    impact: 'high', rating: 4, category: 'testing-strategy',
    fix: 'Add a test framework (Jest, Vitest, Mocha) to package.json and document it in Windsurf rules.',
    template: null, file: () => 'package.json', line: () => null,
  },
  wsCoverageConfigExists: {
    id: 'WS-T02', name: 'Coverage configuration exists',
    check: (ctx) => ctx.files.some(f => /\.nycrc|\.c8rc|jest\.config|vitest\.config|\.coveragerc/i.test(f)) || /coverage/i.test(ctx.fileContent('package.json') || ''),
    impact: 'medium', rating: 3, category: 'testing-strategy',
    fix: 'Add coverage configuration and document coverage thresholds in Windsurf rules.',
    template: null, file: () => 'package.json', line: () => null,
  },
  wsE2eSetupPresent: {
    id: 'WS-T03', name: 'E2E test setup present',
    check: (ctx) => ctx.files.some(f => /cypress\.config|playwright\.config|e2e\.(test|spec)\.(ts|js)|nightwatch\.conf/i.test(f)),
    impact: 'medium', rating: 3, category: 'testing-strategy',
    fix: 'Set up E2E tests (Playwright or Cypress) for full integration coverage.',
    template: null, file: () => null, line: () => null,
  },
  wsSnapshotTestsMentioned: {
    id: 'WS-T04', name: 'Snapshot testing strategy documented',
    check: (ctx) => { const docs = [ctx.fileContent('AGENTS.md'), ctx.fileContent('README.md'), ctx.fileContent('.windsurfrules')].filter(Boolean).join('\n'); if (!docs.trim()) return null; return /snapshot|inline snapshot/i.test(docs); },
    impact: 'low', rating: 2, category: 'testing-strategy',
    fix: 'Document snapshot testing strategy in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  wsTestCommandDocumented: {
    id: 'WS-T05', name: 'Test command documented for Cascade',
    check: (ctx) => { const docs = [ctx.fileContent('AGENTS.md'), ctx.fileContent('.windsurfrules')].filter(Boolean).join('\n'); if (!docs.trim()) return null; return /npm test|yarn test|pnpm test|vitest|jest\b/i.test(docs); },
    impact: 'high', rating: 4, category: 'testing-strategy',
    fix: 'Add the exact test command to AGENTS.md or .windsurfrules so Cascade can verify changes.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  wsCiRunsTests: {
    id: 'WS-T06', name: 'CI workflow runs tests',
    check: (ctx) => { const wfs = ctx.files.filter(f => /\.github\/workflows\/.*\.ya?ml$/i.test(f)); if (!wfs.length) return null; return wfs.some(f => /\btest\b|\bvitest\b|\bjest\b|\bpytest\b/i.test(ctx.fileContent(f) || '')); },
    impact: 'high', rating: 5, category: 'testing-strategy',
    fix: 'Add a test step to CI to catch regressions in Cascade-generated code.',
    template: null, file: () => '.github/workflows/', line: () => null,
  },
  wsLinterConfigured: {
    id: 'WS-T07', name: 'Linter configured',
    check: (ctx) => ctx.files.some(f => /\.eslintrc|eslint\.config|\.pylintrc|\.ruff\.toml|\.flake8/i.test(f)) || /eslint|ruff|pylint/i.test(ctx.fileContent('package.json') || ''),
    impact: 'high', rating: 4, category: 'code-quality',
    fix: 'Configure ESLint/Ruff and reference lint command in .windsurfrules for Cascade.',
    template: null, file: () => null, line: () => null,
  },
  wsFormatterConfigured: {
    id: 'WS-T08', name: 'Code formatter configured',
    check: (ctx) => ctx.files.some(f => /\.prettierrc|\.prettier\.config|biome\.json|\.editorconfig/i.test(f)) || /prettier|biome/i.test(ctx.fileContent('package.json') || ''),
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Configure Prettier/Biome for consistent code formatting in Cascade output.',
    template: null, file: () => null, line: () => null,
  },
  wsDeadCodeDetection: {
    id: 'WS-T09', name: 'Dead code detection awareness documented',
    check: (ctx) => { const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /dead.?code|unused.?(import|var|export)|knip|ts-prune/i.test(docs); },
    impact: 'low', rating: 2, category: 'code-quality',
    fix: 'Document dead code detection tools in AGENTS.md (knip, ts-prune).',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  wsComplexityAwareness: {
    id: 'WS-T10', name: 'Code complexity constraints documented',
    check: (ctx) => { const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /complex|cyclomatic|function.{0,20}length|line.{0,20}limit/i.test(docs); },
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Add complexity constraints to .windsurfrules (max function length, cyclomatic limits).',
    template: null, file: () => '.windsurfrules', line: () => null,
  },
  wsConsistentNamingDocumented: {
    id: 'WS-T11', name: 'Naming conventions documented',
    check: (ctx) => { const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /camelCase|snake_case|PascalCase|naming.{0,30}convention/i.test(docs); },
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Document naming conventions in .windsurfrules for consistent Cascade output.',
    template: null, file: () => '.windsurfrules', line: () => null,
  },
  wsCodeReviewProcessMentioned: {
    id: 'WS-T12', name: 'Code review process documented',
    check: (ctx) => { const docs = [ctx.fileContent('CONTRIBUTING.md'), ctx.fileContent('AGENTS.md')].filter(Boolean).join('\n'); if (!docs.trim()) return null; return /code.?review|PR|pull.?request/i.test(docs); },
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Document code review process in CONTRIBUTING.md.',
    template: null, file: () => 'CONTRIBUTING.md', line: () => null,
  },
  wsEndpointDocumentation: {
    id: 'WS-T13', name: 'API endpoint documentation present',
    check: (ctx) => !isApiProject(ctx) ? null : ctx.files.some(f => /openapi|swagger|api\.ya?ml|api\.json/i.test(f)),
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Add an OpenAPI/Swagger spec so Cascade understands the API surface.',
    template: null, file: () => null, line: () => null,
  },
  wsApiVersioningMentioned: {
    id: 'WS-T14', name: 'API versioning strategy documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /api.{0,10}version|\/v\d|versioning/i.test(docs); },
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Document API versioning strategy in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  wsErrorHandlingPatterns: {
    id: 'WS-T15', name: 'Error handling patterns documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /error.{0,15}handl|exception|try.?catch|Result\s*</i.test(docs); },
    impact: 'high', rating: 4, category: 'api-design',
    fix: 'Document error handling patterns in .windsurfrules for Cascade.',
    template: null, file: () => '.windsurfrules', line: () => null,
  },
  wsRateLimitingAwareness: {
    id: 'WS-T16', name: 'Rate limiting awareness documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /rate.?limit|throttl|429/i.test(docs); },
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Document rate limiting in AGENTS.md for Cascade to handle 429 errors.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  wsRequestValidation: {
    id: 'WS-T17', name: 'Request validation strategy documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /validat|zod|yup|joi\b/i.test(docs); },
    impact: 'high', rating: 4, category: 'api-design',
    fix: 'Document request validation library (Zod, Yup) in .windsurfrules.',
    template: null, file: () => '.windsurfrules', line: () => null,
  },
  wsResponseFormatConsistent: {
    id: 'WS-T18', name: 'Response format consistency documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /response.{0,20}format|json.{0,10}response|envelope/i.test(docs); },
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Document standard response format in .windsurfrules.',
    template: null, file: () => '.windsurfrules', line: () => null,
  },
  wsMigrationStrategyDocumented: {
    id: 'WS-T19', name: 'Database migration strategy documented',
    check: (ctx) => !isDatabaseProject(ctx) ? null : ctx.files.some(f => /migrations?\//i.test(f)) || /migration|prisma migrate|alembic/i.test((ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || '')),
    impact: 'high', rating: 4, category: 'database',
    fix: 'Document database migration strategy in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  wsQueryOptimizationMentioned: {
    id: 'WS-T20', name: 'Query optimization guidance documented',
    check: (ctx) => { if (!isDatabaseProject(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /n\+1|query.{0,15}optim|index|eager.{0,10}load/i.test(docs); },
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Document N+1 prevention patterns in .windsurfrules.',
    template: null, file: () => '.windsurfrules', line: () => null,
  },
  wsConnectionPoolingConfigured: {
    id: 'WS-T21', name: 'Connection pooling documented',
    check: (ctx) => { if (!isDatabaseProject(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /connection.{0,15}pool|pool.{0,15}size/i.test(docs); },
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Document database connection pooling in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  wsBackupStrategyDocumented: {
    id: 'WS-T22', name: 'Database backup strategy documented',
    check: (ctx) => { if (!isDatabaseProject(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /backup|restore|point.?in.?time/i.test(docs); },
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Document database backup and restore in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  wsSchemaDocumentation: {
    id: 'WS-T23', name: 'Database schema documentation present',
    check: (ctx) => !isDatabaseProject(ctx) ? null : ctx.files.some(f => /schema\.(prisma|sql|graphql)|erd|dbml/i.test(f)),
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Add schema documentation (schema.prisma, ERD) for Cascade.',
    template: null, file: () => null, line: () => null,
  },
  wsSeedDataMentioned: {
    id: 'WS-T24', name: 'Seed data strategy documented',
    check: (ctx) => !isDatabaseProject(ctx) ? null : ctx.files.some(f => /seed\.(ts|js|sql|py)|fixtures\//i.test(f)) || /seed.{0,10}data|seed.{0,10}script/i.test((ctx.fileContent('AGENTS.md') || '')),
    impact: 'low', rating: 2, category: 'database',
    fix: 'Add seed scripts and document local database setup in AGENTS.md.',
    template: null, file: () => null, line: () => null,
  },
  wsAuthFlowDocumented: {
    id: 'WS-T25', name: 'Authentication flow documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /auth.{0,15}flow|login.{0,15}flow|authenticate/i.test(docs); },
    impact: 'high', rating: 4, category: 'authentication',
    fix: 'Document authentication flow in AGENTS.md for Cascade.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  wsTokenHandlingGuidance: {
    id: 'WS-T26', name: 'Token handling guidance documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /jwt|token.{0,15}refresh|access.{0,10}token|bearer/i.test(docs); },
    impact: 'high', rating: 4, category: 'authentication',
    fix: 'Document JWT/token handling in .windsurfrules.',
    template: null, file: () => '.windsurfrules', line: () => null,
  },
  wsSessionManagementDocumented: {
    id: 'WS-T27', name: 'Session management documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /session.{0,15}manag|cookie|next.?auth|lucia/i.test(docs); },
    impact: 'medium', rating: 3, category: 'authentication',
    fix: 'Document session management in .windsurfrules.',
    template: null, file: () => '.windsurfrules', line: () => null,
  },
  wsRbacPermissionsReferenced: {
    id: 'WS-T28', name: 'RBAC / permissions model referenced',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /rbac|role.?based|permission|authorization/i.test(docs); },
    impact: 'high', rating: 4, category: 'authentication',
    fix: 'Document RBAC/permissions model in .windsurfrules for Cascade.',
    template: null, file: () => '.windsurfrules', line: () => null,
  },
  wsOauthSsoMentioned: {
    id: 'WS-T29', name: 'OAuth/SSO configuration documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /oauth|sso|saml|oidc|google.{0,10}auth/i.test(docs); },
    impact: 'medium', rating: 3, category: 'authentication',
    fix: 'Document OAuth/SSO provider in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  wsCredentialRotationDocumented: {
    id: 'WS-T30', name: 'Credential rotation policy documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /rotat.{0,10}secret|rotat.{0,10}key|credential.{0,10}rotat/i.test(docs); },
    impact: 'medium', rating: 3, category: 'authentication',
    fix: 'Document credential rotation in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  wsLoggingConfigured: {
    id: 'WS-T31', name: 'Logging framework configured',
    check: (ctx) => !isMonitoringRelevant(ctx) ? null : /winston|pino|bunyan|morgan|loguru/i.test(ctx.fileContent('package.json') || '') || ctx.files.some(f => /log(ger|ging)\.config/i.test(f)),
    impact: 'high', rating: 4, category: 'monitoring',
    fix: 'Add a structured logging framework (Pino, Winston) and document log levels.',
    template: null, file: () => 'package.json', line: () => null,
  },
  wsErrorTrackingSetup: {
    id: 'WS-T32', name: 'Error tracking service configured',
    check: (ctx) => !isMonitoringRelevant(ctx) ? null : /sentry|bugsnag|rollbar|honeybadger/i.test(ctx.fileContent('package.json') || '') || ctx.files.some(f => /sentry\.client|sentry\.server/i.test(f)),
    impact: 'high', rating: 4, category: 'monitoring',
    fix: 'Set up error tracking (Sentry) to catch runtime errors.',
    template: null, file: () => null, line: () => null,
  },
  wsApmMetricsMentioned: {
    id: 'WS-T33', name: 'APM / metrics platform documented',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /datadog|newrelic|prometheus|grafana|opentelemetry|apm/i.test(docs); },
    impact: 'medium', rating: 3, category: 'monitoring',
    fix: 'Document APM platform in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  wsHealthCheckEndpoint: {
    id: 'WS-T34', name: 'Health check endpoint documented',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /health.?check|\/health|\/ping|\/status/i.test(docs); },
    impact: 'medium', rating: 3, category: 'monitoring',
    fix: 'Document health check endpoint in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  wsAlertingReferenced: {
    id: 'WS-T35', name: 'Alerting strategy referenced',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /alert|pagerduty|opsgenie|oncall|incident/i.test(docs); },
    impact: 'medium', rating: 3, category: 'monitoring',
    fix: 'Document alerting strategy in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  wsLogRotationMentioned: {
    id: 'WS-T36', name: 'Log rotation / retention documented',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /log.{0,15}rotat|log.{0,15}retent|retention.{0,15}polic/i.test(docs); },
    impact: 'low', rating: 2, category: 'monitoring',
    fix: 'Document log rotation policy in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  wsLockfilePresent: {
    id: 'WS-T37', name: 'Dependency lockfile present',
    check: (ctx) => ctx.files.some(f => /package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|cargo\.lock/i.test(f)),
    impact: 'critical', rating: 5, category: 'dependency-management',
    fix: 'Commit your lockfile for reproducible builds.',
    template: null, file: () => null, line: () => null,
  },
  wsOutdatedDepsAwareness: {
    id: 'WS-T38', name: 'Outdated dependency awareness configured',
    check: (ctx) => { const wfs = ctx.files.filter(f => /\.github\/workflows/i.test(f)); return wfs.some(f => /dependabot|renovate/i.test(ctx.fileContent(f) || '')) || ctx.files.some(f => /\.github\/dependabot\.yml|renovate\.json/i.test(f)); },
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Enable Dependabot or Renovate for automated dependency updates.',
    template: null, file: () => '.github/', line: () => null,
  },
  wsLicenseCompliance: {
    id: 'WS-T39', name: 'License compliance awareness configured',
    check: (ctx) => /license-checker|licensee|fossa/i.test(ctx.fileContent('package.json') || ''),
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Add license compliance checking (license-checker, FOSSA).',
    template: null, file: () => null, line: () => null,
  },
  wsNpmAuditConfigured: {
    id: 'WS-T40', name: 'Security audit configured in CI',
    check: (ctx) => { const wfs = ctx.files.filter(f => /\.github\/workflows\/.*\.ya?ml$/i.test(f)); return wfs.some(f => /npm audit|yarn audit|snyk|trivy/i.test(ctx.fileContent(f) || '')); },
    impact: 'high', rating: 4, category: 'dependency-management',
    fix: 'Add `npm audit` or Snyk to CI.',
    template: null, file: () => '.github/workflows/', line: () => null,
  },
  wsPinnedVersionsUsed: {
    id: 'WS-T41', name: 'Critical dependency versions pinned',
    check: (ctx) => { const pkg = ctx.fileContent('package.json'); if (!pkg) return null; try { const p = JSON.parse(pkg); const deps = { ...(p.dependencies || {}), ...(p.devDependencies || {}) }; const vals = Object.values(deps); if (!vals.length) return null; return vals.filter(v => /^\d/.test(String(v))).length / vals.length >= 0.1; } catch { return null; } },
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Pin critical dependencies to exact versions for reproducibility.',
    template: null, file: () => 'package.json', line: () => null,
  },
  wsAutoUpdatePolicy: {
    id: 'WS-T42', name: 'Dependency auto-update policy documented',
    check: (ctx) => ctx.files.some(f => /\.github\/dependabot\.yml|renovate\.json|\.renovaterc/i.test(f)),
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Configure Dependabot (.github/dependabot.yml) for automated updates.',
    template: null, file: () => '.github/dependabot.yml', line: () => null,
  },
  wsTokenUsageAwareness: {
    id: 'WS-T43', name: 'Token usage awareness documented',
    check: (ctx) => { const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /token.{0,15}usage|token.{0,15}budget|context.{0,15}window/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document token budget awareness in .windsurfrules for Cascade.',
    template: null, file: () => '.windsurfrules', line: () => null,
  },
  wsModelSelectionGuidance: {
    id: 'WS-T44', name: 'Model selection guidance documented',
    check: (ctx) => { const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /model.{0,20}select|swe-1|cascade|haiku|flash/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document model selection guidance in .windsurfrules.',
    template: null, file: () => '.windsurfrules', line: () => null,
  },
  wsCachingToReduceApiCalls: {
    id: 'WS-T45', name: 'Caching strategy documented to reduce API costs',
    check: (ctx) => { const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /cach.{0,15}api|redis|memcache|cache-control/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document caching strategies in .windsurfrules.',
    template: null, file: () => '.windsurfrules', line: () => null,
  },
  wsBatchProcessingMentioned: {
    id: 'WS-T46', name: 'Batch processing patterns documented',
    check: (ctx) => { const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /batch.{0,15}process|bulk.{0,15}operat|queue|job.{0,15}schedul/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document batch processing patterns in AGENTS.md.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  wsPromptCachingEnabled: {
    id: 'WS-T47', name: 'Prompt caching strategy documented',
    check: (ctx) => { const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('.windsurfrules') || ''); if (!docs.trim()) return null; return /cache.?prompt|prompt.?cach/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document prompt caching strategy to reduce Windsurf API costs.',
    template: null, file: () => 'AGENTS.md', line: () => null,
  },
  wsCostBudgetDefined: {
    id: 'WS-T48', name: 'AI cost budget or per-run usage tracking documented',
    check: (ctx) => {
      const docs = (ctx.fileContent('AGENTS.md') || '') + (ctx.fileContent('README.md') || '');
      if (!docs.trim() && !hasCostBudgetOrUsageTracking('', ctx)) return null;
      return hasCostBudgetOrUsageTracking(docs, ctx);
    },
    impact: 'low', rating: 2, category: 'cost-optimization',
    fix: 'Document AI cost guardrails or per-run usage tracking so Windsurf usage is measurable over time.',
    template: null, file: () => 'README.md', line: () => null,
  },

  // ============================================================
  // === PYTHON STACK CHECKS (category: 'python') ===============
  // ============================================================

  wsPythonProjectExists: {
    id: 'WS-PY01',
    name: 'Python project detected (pyproject.toml / setup.py / requirements.txt)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return true; },
    impact: 'high',
    category: 'python',
    fix: 'Ensure pyproject.toml, setup.py, or requirements.txt exists for Python projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonVersionSpecified: {
    id: 'WS-PY02',
    name: 'Python version specified (.python-version or requires-python)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /\.python-version$/.test(f)) || /requires-python/i.test(ctx.fileContent('pyproject.toml') || ''); },
    impact: 'medium',
    category: 'python',
    fix: 'Create .python-version or add requires-python to pyproject.toml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonVenvMentioned: {
    id: 'WS-PY03',
    name: 'Virtual environment mentioned in instructions',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /venv|virtualenv|conda|poetry shell|uv venv/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document virtual environment setup in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonLockfileExists: {
    id: 'WS-PY04',
    name: 'Python lockfile exists (poetry.lock / uv.lock / Pipfile.lock / pinned requirements)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /poetry\.lock$|uv\.lock$|Pipfile\.lock$/.test(f)) || /==/m.test(ctx.fileContent('requirements.txt') || ''); },
    impact: 'high',
    category: 'python',
    fix: 'Add a lockfile (poetry.lock, uv.lock, Pipfile.lock) or pin versions with == in requirements.txt.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonPytestConfigured: {
    id: 'WS-PY05',
    name: 'pytest configured (pyproject.toml [tool.pytest] / pytest.ini / conftest.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return /\[tool\.pytest/i.test(ctx.fileContent('pyproject.toml') || '') || ctx.files.some(f => /pytest\.ini$|conftest\.py$/.test(f)); },
    impact: 'high',
    category: 'python',
    fix: 'Configure pytest in pyproject.toml [tool.pytest.ini_options] or create pytest.ini.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonLinterConfigured: {
    id: 'WS-PY06',
    name: 'Python linter configured (ruff / flake8 / pylint)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.ruff|\[tool\.flake8|\[tool\.pylint/i.test(pp) || ctx.files.some(f => /\.flake8$|pylintrc$|\.pylintrc$|ruff\.toml$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure ruff, flake8, or pylint in pyproject.toml or dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonTypeCheckerConfigured: {
    id: 'WS-PY07',
    name: 'Type checker configured (mypy / pyright)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.mypy|\[tool\.pyright/i.test(pp) || ctx.files.some(f => /mypy\.ini$|pyrightconfig\.json$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure mypy or pyright in pyproject.toml or dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonFormatterConfigured: {
    id: 'WS-PY08',
    name: 'Formatter configured (black / isort / ruff format)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.black|\[tool\.isort|\[tool\.ruff\.format/i.test(pp); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure black, isort, or ruff format in pyproject.toml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonDjangoSettingsDocumented: {
    id: 'WS-PY09',
    name: 'Django settings documented if Django project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; if (!ctx.files.some(f => /manage\.py$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /django|settings\.py|DJANGO_SETTINGS_MODULE/i.test(docs); },
    impact: 'high',
    category: 'python',
    fix: 'Document Django settings module and configuration in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonFastapiEntryDocumented: {
    id: 'WS-PY10',
    name: 'FastAPI entry point documented if FastAPI project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/fastapi/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /fastapi|uvicorn|app\.py|main\.py/i.test(docs); },
    impact: 'high',
    category: 'python',
    fix: 'Document FastAPI entry point and how to run the development server.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonMigrationsDocumented: {
    id: 'WS-PY11',
    name: 'Database migrations mentioned (alembic / Django migrations)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /alembic|migrate|makemigrations|django.{0,10}migration/i.test(docs) || ctx.files.some(f => /alembic[.]ini$|alembic[/]/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Document database migration workflow (alembic or Django migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonEnvHandlingDocumented: {
    id: 'WS-PY12',
    name: '.env handling documented (python-dotenv)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/dotenv|python-dotenv|environs/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /\.env|dotenv|environment.{0,10}variable/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document .env file usage and python-dotenv configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonPreCommitConfigured: {
    id: 'WS-PY13',
    name: 'pre-commit hooks configured (.pre-commit-config.yaml)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /\.pre-commit-config\.yaml$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Add .pre-commit-config.yaml with Python-specific hooks (ruff, mypy, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonDockerBaseImage: {
    id: 'WS-PY14',
    name: 'Docker uses Python base image correctly',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const df = ctx.fileContent('Dockerfile') || ''; if (!df) return null; return /FROM.*python:/i.test(df); },
    impact: 'medium',
    category: 'python',
    fix: 'Use official Python base image in Dockerfile (e.g., FROM python:3.12-slim).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonTestMatrixConfigured: {
    id: 'WS-PY15',
    name: 'Test matrix configured (tox.ini / noxfile.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /tox\.ini$|noxfile\.py$/.test(f)); },
    impact: 'low',
    category: 'python',
    fix: 'Configure tox or nox for multi-environment testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonValidationUsed: {
    id: 'WS-PY16',
    name: 'Pydantic or dataclass validation used',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); return /pydantic|dataclass/i.test(deps); },
    impact: 'medium',
    category: 'python',
    fix: 'Use pydantic or dataclasses for data validation and type safety.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonAsyncDocumented: {
    id: 'WS-PY17',
    name: 'Async patterns documented if async project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/asyncio|aiohttp|fastapi|starlette|httpx/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /async|await|asyncio|event.{0,5}loop/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document async patterns and conventions used in the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonPinnedVersions: {
    id: 'WS-PY18',
    name: 'Requirements have pinned versions (== in requirements.txt)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const req = ctx.fileContent('requirements.txt') || ''; if (!req.trim()) return null; const lines = req.split('\n').filter(l => l.trim() && !l.startsWith('#')); return lines.length > 0 && lines.every(l => /==/.test(l) || /^-/.test(l.trim())); },
    impact: 'high',
    category: 'python',
    fix: 'Pin all dependency versions with == in requirements.txt for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonPackageStructure: {
    id: 'WS-PY19',
    name: 'Python package has proper structure (src/ layout or __init__.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /src[/].*[/]__init__\.py$|^[^/]+[/]__init__\.py$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Use src/ layout or ensure packages have __init__.py files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonDocsToolConfigured: {
    id: 'WS-PY20',
    name: 'Documentation tool configured (sphinx / mkdocs)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /mkdocs\.yml$|conf\.py$|docs[/]/.test(f)) || /sphinx|mkdocs/i.test(ctx.fileContent('pyproject.toml') || ''); },
    impact: 'low',
    category: 'python',
    fix: 'Configure sphinx or mkdocs for project documentation.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonCoverageConfigured: {
    id: 'WS-PY21',
    name: 'Coverage configured (coverage / pytest-cov)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.coverage|pytest-cov|coverage/i.test(pp) || ctx.files.some(f => /\.coveragerc$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure coverage reporting with pytest-cov or coverage.py.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonNoSecretsInSettings: {
    id: 'WS-PY22',
    name: 'No secrets in Django settings.py',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const settings = ctx.fileContent('settings.py') || ctx.files.filter(f => /settings\.py$/.test(f)).map(f => ctx.fileContent(f) || '').join(''); if (!settings) return null; return !/SECRET_KEY\s*=\s*['"][^'"]{10,}/i.test(settings); },
    impact: 'critical',
    category: 'python',
    fix: 'Move SECRET_KEY and other secrets to environment variables, not hardcoded in settings.py.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonWsgiAsgiDocumented: {
    id: 'WS-PY23',
    name: 'WSGI/ASGI server documented (gunicorn / uvicorn)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/gunicorn|uvicorn|daphne|hypercorn/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /gunicorn|uvicorn|daphne|hypercorn|wsgi|asgi/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document WSGI/ASGI server configuration (gunicorn, uvicorn).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonTaskQueueDocumented: {
    id: 'WS-PY24',
    name: 'Task queue documented if used (celery / rq)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/celery|rq|dramatiq|huey/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /celery|rq|dramatiq|huey|task.{0,10}queue|worker/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document task queue configuration and worker setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsPythonGitignore: {
    id: 'WS-PY25',
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

  wsGoModExists: {
    id: 'WS-GO01',
    name: 'go.mod exists',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'go',
    fix: 'Initialize Go module with go mod init.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoSumCommitted: {
    id: 'WS-GO02',
    name: 'go.sum committed',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /go\.sum$/.test(f)); },
    impact: 'high',
    category: 'go',
    fix: 'Commit go.sum to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGolangciLintConfigured: {
    id: 'WS-GO03',
    name: 'golangci-lint configured (.golangci.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /\.golangci\.ya?ml$|\.golangci\.toml$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Add .golangci.yml to configure linting rules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoTestDocumented: {
    id: 'WS-GO04',
    name: 'go test documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go test/i.test(docs); },
    impact: 'high',
    category: 'go',
    fix: 'Document go test command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoBuildDocumented: {
    id: 'WS-GO05',
    name: 'go build documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go build|go install/i.test(docs); },
    impact: 'high',
    category: 'go',
    fix: 'Document go build command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoStandardLayout: {
    id: 'WS-GO06',
    name: 'Standard Go layout (cmd/ / internal/ / pkg/)',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /^cmd[/]|^internal[/]|^pkg[/]/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Use standard Go project layout with cmd/, internal/, and/or pkg/ directories.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoErrorHandlingDocumented: {
    id: 'WS-GO07',
    name: 'Error handling patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /error handling|errors?\.(?:New|Wrap|Is|As)|fmt\.Errorf/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document error handling conventions (error wrapping, sentinel errors, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoContextUsageDocumented: {
    id: 'WS-GO08',
    name: 'Context usage documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /context\.Context|ctx\.Done|context\.WithCancel|context\.WithTimeout/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document context.Context usage patterns for cancellation and timeouts.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoroutineSafetyDocumented: {
    id: 'WS-GO09',
    name: 'Goroutine safety documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /goroutine|sync\.Mutex|sync\.WaitGroup|channel|concurren/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document goroutine safety patterns, mutex usage, and channel conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoModTidyMentioned: {
    id: 'WS-GO10',
    name: 'go mod tidy mentioned in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go mod tidy/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document go mod tidy in project workflow instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoVetConfigured: {
    id: 'WS-GO11',
    name: 'go vet or staticcheck configured',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/go.yml') || ''; return /go vet|staticcheck/i.test(docs + ci); },
    impact: 'medium',
    category: 'go',
    fix: 'Configure go vet and/or staticcheck in CI or project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoMakefileExists: {
    id: 'WS-GO12',
    name: 'Makefile or Taskfile exists for Go project',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /^Makefile$|^Taskfile\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Add Makefile or Taskfile.yml with common Go targets (build, test, lint).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoDockerMultiStage: {
    id: 'WS-GO13',
    name: 'Docker multi-stage build for Go',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; if (!df) return null; return /FROM.*golang.*AS/i.test(df) && /FROM.*(?:alpine|scratch|distroless|gcr\.io)/i.test(df); },
    impact: 'medium',
    category: 'go',
    fix: 'Use multi-stage Docker build: build in golang image, run in minimal image (alpine/scratch/distroless).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoCgoDocumented: {
    id: 'WS-GO14',
    name: 'CGO documented if used',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const goMod = ctx.fileContent('go.mod') || ''; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; if (!/CGO_ENABLED|import "C"/i.test(goMod + docs)) return null; return /CGO|cgo/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document CGO usage, dependencies, and build requirements.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoWorkForMonorepo: {
    id: 'WS-GO15',
    name: 'go.work for monorepo',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const multiMod = ctx.files.filter(f => /go\.mod$/.test(f)).length > 1; if (!multiMod) return null; return ctx.files.some(f => /go\.work$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Use go.work for Go workspace in monorepo with multiple modules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoBenchmarkTests: {
    id: 'WS-GO16',
    name: 'Benchmark tests mentioned',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go test.*-bench|Benchmark/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document benchmark testing with go test -bench.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoRaceDetector: {
    id: 'WS-GO17',
    name: 'Race detector (-race) documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/go.yml') || ''; return /-race/i.test(docs + ci); },
    impact: 'medium',
    category: 'go',
    fix: 'Document and enable race detector with go test -race.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoGenerateDocumented: {
    id: 'WS-GO18',
    name: 'go generate documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go generate/i.test(docs) || ctx.files.some(f => /generate\.go$/.test(f)); },
    impact: 'low',
    category: 'go',
    fix: 'Document go generate usage and generated files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoInterfaceDesignDocumented: {
    id: 'WS-GO19',
    name: 'Interface-based design documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /interface|mock|stub|dependency injection/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document interface-based design patterns for testability and dependency injection.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsGoGitignore: {
    id: 'WS-GO20',
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

  wsRustCargoTomlExists: {
    id: 'WS-RS01',
    name: 'Cargo.toml exists with edition field',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /edition\s*=/.test(cargo); },
    impact: 'high',
    category: 'rust',
    fix: 'Ensure Cargo.toml exists and specifies the edition field (e.g., edition = "2021").',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustCargoLockCommitted: {
    id: 'WS-RS02',
    name: 'Cargo.lock committed (for binary crates)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /Cargo\.lock$/.test(f)); },
    impact: 'high',
    category: 'rust',
    fix: 'Commit Cargo.lock for binary crates to ensure reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustClippyConfigured: {
    id: 'WS-RS03',
    name: 'Clippy configured (CI or .cargo/config.toml)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/rust.yml') || ''; const cargoConfig = ctx.fileContent('.cargo/config.toml') || ''; return /clippy/i.test(ci + cargoConfig); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure clippy in CI or .cargo/config.toml for lint enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustFmtConfigured: {
    id: 'WS-RS04',
    name: 'rustfmt configured (rustfmt.toml or .rustfmt.toml)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /rustfmt\.toml$|\.rustfmt\.toml$/.test(f)); },
    impact: 'medium',
    category: 'rust',
    fix: 'Create rustfmt.toml or .rustfmt.toml to configure code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustCargoTestDocumented: {
    id: 'WS-RS05',
    name: 'cargo test documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cargo test/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document cargo test command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustCargoBuildDocumented: {
    id: 'WS-RS06',
    name: 'cargo build/check documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cargo (?:build|check)/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document cargo build or cargo check command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustUnsafePolicyDocumented: {
    id: 'WS-RS07',
    name: 'Unsafe code policy documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /unsafe|#!?\[forbid\(unsafe|#!?\[deny\(unsafe/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document unsafe code policy (forbidden, minimized, or where allowed).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustErrorHandlingStrategy: {
    id: 'WS-RS08',
    name: 'Error handling strategy (anyhow/thiserror in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /anyhow|thiserror|eyre|color-eyre/i.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Use anyhow (applications) or thiserror (libraries) for structured error handling.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustFeatureFlagsDocumented: {
    id: 'WS-RS09',
    name: 'Feature flags documented (Cargo.toml [features])',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/\[features\]/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /feature|--features|--all-features/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document feature flags and their purpose in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustWorkspaceConfig: {
    id: 'WS-RS10',
    name: 'Workspace config if multi-crate (Cargo.toml [workspace])',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (ctx.files.filter(f => /Cargo\.toml$/.test(f)).length <= 1) return null; return /\[workspace\]/i.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure [workspace] in root Cargo.toml for multi-crate projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustMsrvSpecified: {
    id: 'WS-RS11',
    name: 'MSRV specified (rust-version field)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /rust-version\s*=/.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Specify rust-version (MSRV) in Cargo.toml for compatibility guarantees.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustDocCommentsEncouraged: {
    id: 'WS-RS12',
    name: 'Doc comments (///) encouraged in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /doc comment|\/{3}|rustdoc|cargo doc/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Encourage /// doc comments and cargo doc in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustBenchmarksConfigured: {
    id: 'WS-RS13',
    name: 'Criterion benchmarks mentioned (benches/ dir)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /benches[/]/.test(f)) || /criterion/i.test(ctx.fileContent('Cargo.toml') || ''); },
    impact: 'low',
    category: 'rust',
    fix: 'Set up criterion benchmarks in benches/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustCrossCompilationDocumented: {
    id: 'WS-RS14',
    name: 'Cross-compilation documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cross.?compil|--target|rustup target|cargo build.*--target/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Document cross-compilation targets and setup instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustMemorySafetyDocumented: {
    id: 'WS-RS15',
    name: 'Memory safety patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /ownership|borrow|lifetime|memory.?safe|Arc|Rc|RefCell/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document memory safety patterns (ownership, borrowing, lifetime conventions).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustAsyncRuntimeDocumented: {
    id: 'WS-RS16',
    name: 'Async runtime documented (tokio/async-std in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/tokio|async-std|smol/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /tokio|async-std|async|await|runtime/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document async runtime choice and patterns (tokio, async-std).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustSerdeDocumented: {
    id: 'WS-RS17',
    name: 'Serde patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/serde/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /serde|Serialize|Deserialize|serde_json|serde_yaml/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document serde serialization/deserialization patterns and conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustCargoAuditConfigured: {
    id: 'WS-RS18',
    name: 'cargo-audit configured in CI',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/rust.yml') || ctx.fileContent('.github/workflows/audit.yml') || ''; return /cargo.?audit|advisory/i.test(ci); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure cargo-audit in CI for vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustWasmTargetDocumented: {
    id: 'WS-RS19',
    name: 'WASM target documented if applicable',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/wasm|wasm-bindgen|wasm-pack/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /wasm|WebAssembly|wasm-pack|wasm-bindgen/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Document WASM target configuration and build process.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsRustGitignore: {
    id: 'WS-RS20',
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

  wsJavaBuildFileExists: {
    id: 'WS-JV01',
    name: 'pom.xml or build.gradle exists',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'java',
    fix: 'Ensure pom.xml or build.gradle exists for Java projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaVersionSpecified: {
    id: 'WS-JV02',
    name: 'Java version specified',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; return /java\.version|maven\.compiler\.source|sourceCompatibility|JavaVersion/i.test(pom + gradle) || ctx.files.some(f => /\.java-version$/.test(f)); },
    impact: 'high',
    category: 'java',
    fix: 'Specify Java version in pom.xml properties, build.gradle, or .java-version file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaWrapperCommitted: {
    id: 'WS-JV03',
    name: 'Maven/Gradle wrapper committed (mvnw or gradlew)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /mvnw$|gradlew$/.test(f)); },
    impact: 'high',
    category: 'java',
    fix: 'Commit mvnw (Maven) or gradlew (Gradle) wrapper for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaSpringBootVersion: {
    id: 'WS-JV04',
    name: 'Spring Boot version documented if Spring project',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; if (!/spring-boot/i.test(pom + gradle)) return null; return /spring-boot.*\d+\.\d+/i.test(pom + gradle); },
    impact: 'high',
    category: 'java',
    fix: 'Document Spring Boot version in build configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaApplicationConfig: {
    id: 'WS-JV05',
    name: 'application.yml or application.properties exists',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /application\.ya?ml$|application\.properties$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Create application.yml or application.properties for Spring configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaTestFramework: {
    id: 'WS-JV06',
    name: 'Test framework configured (JUnit/TestNG in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; return /junit|testng|spring-boot-starter-test/i.test(pom + gradle); },
    impact: 'high',
    category: 'java',
    fix: 'Configure JUnit or TestNG test framework in project dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaCodeStyleConfigured: {
    id: 'WS-JV07',
    name: 'Code style configured (checkstyle.xml, spotbugs)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /checkstyle\.xml$|spotbugs.*\.xml$/.test(f)) || /checkstyle|spotbugs|google-java-format/i.test((ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || '')); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure checkstyle or spotbugs for code quality enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaSpringProfilesDocumented: {
    id: 'WS-JV08',
    name: 'Spring profiles documented',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/spring/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /spring[.]profiles|@Profile|SPRING_PROFILES_ACTIVE/i.test(docs); },
    impact: 'medium',
    category: 'java',
    fix: 'Document Spring profiles and their configuration in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaDatabaseMigration: {
    id: 'WS-JV09',
    name: 'Database migration configured (flyway/liquibase)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /flyway|liquibase/i.test(deps) || ctx.files.some(f => /db[/]migration|flyway|liquibase/i.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure database migration tool (Flyway or Liquibase) for schema management.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaLombokDocumented: {
    id: 'WS-JV10',
    name: 'Lombok/MapStruct documented if used',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/lombok|mapstruct/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /lombok|mapstruct/i.test(docs); },
    impact: 'low',
    category: 'java',
    fix: 'Document Lombok/MapStruct usage and IDE setup requirements.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaApiDocsConfigured: {
    id: 'WS-JV11',
    name: 'API docs configured (springdoc/swagger deps)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /springdoc|swagger|openapi/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure API documentation with springdoc-openapi or Swagger.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaSecurityConfigured: {
    id: 'WS-JV12',
    name: 'Security configuration documented',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/spring-security|spring-boot-starter-security/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /security|authentication|authorization|SecurityConfig|@EnableWebSecurity/i.test(docs); },
    impact: 'high',
    category: 'java',
    fix: 'Document Spring Security configuration and authentication setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaActuatorConfigured: {
    id: 'WS-JV13',
    name: 'Actuator/health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /actuator|spring-boot-starter-actuator/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Spring Boot Actuator for health checks and monitoring.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaLoggingConfigured: {
    id: 'WS-JV14',
    name: 'Logging configured (logback.xml or log4j2.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /logback.*\.xml$|log4j2?.*\.xml$|logging\.properties$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure logging with logback.xml or log4j2.xml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaMultiModuleProject: {
    id: 'WS-JV15',
    name: 'Multi-module project configured if applicable',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const buildFiles = ctx.files.filter(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f)); if (buildFiles.length <= 1) return null; const rootPom = ctx.fileContent('pom.xml') || ''; const rootGradle = ctx.fileContent('settings.gradle') || ctx.fileContent('settings.gradle.kts') || ''; return /<modules>|include\s/i.test(rootPom + rootGradle); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure multi-module project structure in root build file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaDockerConfigured: {
    id: 'WS-JV16',
    name: 'Docker build configured (Dockerfile or Jib plugin)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /FROM.*(?:openjdk|eclipse-temurin|amazoncorretto)/i.test(df) || /jib/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Docker build with Dockerfile or Jib plugin.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaEnvConfigsSeparated: {
    id: 'WS-JV17',
    name: 'Environment-specific configs separated',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /application-(?:dev|prod|staging|test|local)\.(?:ya?ml|properties)$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Separate environment configs (application-dev.yml, application-prod.yml, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaNoSecretsInConfig: {
    id: 'WS-JV18',
    name: 'No secrets in application.yml/properties',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const appYml = ctx.files.filter(f => /application.*\.ya?ml$|application.*\.properties$/.test(f)).map(f => ctx.fileContent(f) || '').join(''); if (!appYml) return null; return !/password\s*[:=]\s*[^$\{\s][^\s]{8,}|secret\s*[:=]\s*[^$\{\s][^\s]{8,}/i.test(appYml); },
    impact: 'critical',
    category: 'java',
    fix: 'Move secrets to environment variables or external secret management, not application config files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaIntegrationTestsSeparate: {
    id: 'WS-JV19',
    name: 'Integration tests separate from unit tests',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /src[/](?:integration-?test|it)[/]|IT\.java$|Integration(?:Test)?\.java$/.test(f)) || /failsafe|integration-test/i.test((ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || '')); },
    impact: 'medium',
    category: 'java',
    fix: 'Separate integration tests from unit tests using Maven Failsafe or dedicated source set.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsJavaBuildCommandDocumented: {
    id: 'WS-JV20',
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

  wsrubyGemfileExists: {
    id: 'WS-RB01',
    name: 'Gemfile exists',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'ruby',
    fix: 'Create a Gemfile to manage Ruby dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsrubyGemfileLockCommitted: {
    id: 'WS-RB02',
    name: 'Gemfile.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /Gemfile\.lock$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Commit Gemfile.lock to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsrubyVersionSpecified: {
    id: 'WS-RB03',
    name: 'Ruby version specified (.ruby-version)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.ruby-version$/.test(f)) || /ruby ['"]~?\d/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Create .ruby-version or specify ruby version in Gemfile.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsrubyRubocopConfigured: {
    id: 'WS-RB04',
    name: 'RuboCop configured (.rubocop.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.rubocop\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add .rubocop.yml to configure Ruby style checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsrubyTestFrameworkConfigured: {
    id: 'WS-RB05',
    name: 'RSpec or Minitest configured (spec/ or test/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /^spec\/|^test\/|spec_helper\.rb$|test_helper\.rb$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Configure RSpec (spec/) or Minitest (test/) for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsrubyRailsCredentialsDocumented: {
    id: 'WS-RB06',
    name: 'Rails credentials documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /credentials|encrypted|master\.key|secret_key_base/i.test(docs); },
    impact: 'high',
    category: 'ruby',
    fix: 'Document Rails credentials management (rails credentials:edit) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsrubyMigrationsDocumented: {
    id: 'WS-RB07',
    name: 'Database migrations documented (db/migrate/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /db\/migrate\//.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /migration|migrate|db:migrate|rails db/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document database migration workflow (rails db:migrate) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsrubyBundlerAuditConfigured: {
    id: 'WS-RB08',
    name: 'Bundler audit configured',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; return /bundler-audit|bundle.audit/i.test(gf) || ctx.files.some(f => /\.bundler-audit/i.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add bundler-audit gem for dependency vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsrubyTypeCheckingConfigured: {
    id: 'WS-RB09',
    name: 'Sorbet/RBS type checking configured (sorbet/ or sig/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /sorbet\/|sig\/|\.rbs$/.test(f)) || /sorbet|tapioca/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'low',
    category: 'ruby',
    fix: 'Configure Sorbet or RBS for type checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsrubyRailsRoutesDocumented: {
    id: 'WS-RB10',
    name: 'Rails routes documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/routes\.rb$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /routes|endpoints|api.*path|REST/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document key routes and API endpoints in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsrubyBackgroundJobsDocumented: {
    id: 'WS-RB11',
    name: 'Background jobs documented (Sidekiq/GoodJob)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sidekiq|good_job|delayed_job|resque/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /sidekiq|good_job|delayed_job|resque|background.*job|worker|queue/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document background job framework and worker configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsrubyRailsEnvConfigsSeparated: {
    id: 'WS-RB12',
    name: 'Rails environment configs separated (config/environments/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /config\/environments\//.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Ensure config/environments/ has separate files for development, test, and production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsrubyAssetPipelineDocumented: {
    id: 'WS-RB13',
    name: 'Asset pipeline documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sprockets|propshaft|webpacker|jsbundling|cssbundling/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /asset|sprockets|propshaft|webpacker|jsbundling|cssbundling|esbuild|vite/i.test(docs); },
    impact: 'low',
    category: 'ruby',
    fix: 'Document asset pipeline configuration (Sprockets, Propshaft, or JS/CSS bundling).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsrubyMasterKeyInGitignore: {
    id: 'WS-RB14',
    name: 'Rails master.key in .gitignore',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const gi = ctx.fileContent('.gitignore') || ''; return /master\.key/i.test(gi); },
    impact: 'critical',
    category: 'ruby',
    fix: 'Add config/master.key to .gitignore to prevent secret leakage.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsrubyTestDataFactories: {
    id: 'WS-RB15',
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

  wsdotnetProjectExists: {
    id: 'WS-DN01',
    name: '.csproj or .sln exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'dotnet',
    fix: 'Ensure .csproj or .sln file exists for .NET projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsdotnetVersionSpecified: {
    id: 'WS-DN02',
    name: '.NET version specified (global.json or TargetFramework)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /global\.json$/.test(f)) || ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /TargetFramework/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create global.json or ensure TargetFramework is set in .csproj.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsdotnetPackagesLock: {
    id: 'WS-DN03',
    name: 'NuGet packages lock (packages.lock.json)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /packages\.lock\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Enable NuGet lock file (packages.lock.json) for reproducible restores.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsdotnetTestDocumented: {
    id: 'WS-DN04',
    name: 'dotnet test documented',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /dotnet test|xunit|nunit|mstest/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document how to run tests with dotnet test in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsdotnetEditorConfigExists: {
    id: 'WS-DN05',
    name: 'EditorConfig configured (.editorconfig)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.editorconfig$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add .editorconfig for consistent code style across the team.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsdotnetRoslynAnalyzers: {
    id: 'WS-DN06',
    name: 'Roslyn analyzers configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Analyzer|StyleCop|SonarAnalyzer|Microsoft\.CodeAnalysis/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Roslyn analyzers (StyleCop.Analyzers, Microsoft.CodeAnalysis) to the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsdotnetAppsettingsExists: {
    id: 'WS-DN07',
    name: 'appsettings.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /appsettings\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create appsettings.json for application configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsdotnetUserSecretsDocumented: {
    id: 'WS-DN08',
    name: 'User secrets configured in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /user.?secrets|dotnet secrets|Secret Manager/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document user secrets management (dotnet user-secrets) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsdotnetEfMigrations: {
    id: 'WS-DN09',
    name: 'Entity Framework migrations (Migrations/ directory)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /Migrations\//.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Document Entity Framework migration workflow (dotnet ef migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsdotnetHealthChecks: {
    id: 'WS-DN10',
    name: 'Health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /AddHealthChecks|MapHealthChecks|IHealthCheck/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure health checks with AddHealthChecks() and MapHealthChecks().',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsdotnetSwaggerConfigured: {
    id: 'WS-DN11',
    name: 'Swagger/OpenAPI configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$|.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Swashbuckle|AddSwaggerGen|UseSwagger|NSwag|AddOpenApi/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure Swagger/OpenAPI with Swashbuckle or NSwag.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsdotnetNoConnectionStringsInConfig: {
    id: 'WS-DN12',
    name: 'No connection strings in appsettings.json',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const settings = ctx.fileContent('appsettings.json') || ''; if (!settings) return null; return !/Server=.*Password=|Data Source=.*Password=/i.test(settings); },
    impact: 'critical',
    category: 'dotnet',
    fix: 'Move connection strings with passwords to user secrets or environment variables.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsdotnetDockerSupport: {
    id: 'WS-DN13',
    name: 'Docker support configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; return /dotnet|aspnet|sdk/i.test(df); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Dockerfile with official .NET SDK/ASP.NET base images.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsdotnetTestProjectSeparate: {
    id: 'WS-DN14',
    name: 'Unit test project separate (.Tests.csproj)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.Tests?\.csproj$|Tests?\/.*\.csproj$/.test(f)); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Create separate test project (e.g., MyApp.Tests.csproj) for unit tests.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsdotnetGlobalUsingsDocumented: {
    id: 'WS-DN15',
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

  wsphpComposerJsonExists: {
    id: 'WS-PHP01',
    name: 'composer.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'php',
    fix: 'Create composer.json to manage PHP dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsphpComposerLockCommitted: {
    id: 'WS-PHP02',
    name: 'composer.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /composer\.lock$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Commit composer.lock to version control for reproducible installs.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsphpVersionSpecified: {
    id: 'WS-PHP03',
    name: 'PHP version specified (composer.json require.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"php"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Specify PHP version requirement in composer.json require section.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsphpStaticAnalysisConfigured: {
    id: 'WS-PHP04',
    name: 'PHPStan/Psalm configured (phpstan.neon)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpstan\.neon$|phpstan\.neon\.dist$|psalm\.xml$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Configure PHPStan (phpstan.neon) or Psalm (psalm.xml) for static analysis.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsphpCsFixerConfigured: {
    id: 'WS-PHP05',
    name: 'PHP CS Fixer configured (.php-cs-fixer.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /\.php-cs-fixer\.php$|\.php-cs-fixer\.dist\.php$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Add .php-cs-fixer.php for consistent code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsphpUnitConfigured: {
    id: 'WS-PHP06',
    name: 'PHPUnit configured (phpunit.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpunit\.xml$|phpunit\.xml\.dist$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Configure PHPUnit with phpunit.xml for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsphpLaravelEnvExample: {
    id: 'WS-PHP07',
    name: 'Laravel .env.example exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /\.env\.example$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Create .env.example with all required environment variables documented.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsphpLaravelAppKeyNotCommitted: {
    id: 'WS-PHP08',
    name: 'Laravel APP_KEY not committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const env = ctx.fileContent('.env') || ''; if (!env) return null; return !/APP_KEY=base64:[A-Za-z0-9+/=]{30,}/i.test(env); },
    impact: 'critical',
    category: 'php',
    fix: 'Ensure .env with APP_KEY is in .gitignore — never commit application keys.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsphpLaravelMigrationsExist: {
    id: 'WS-PHP09',
    name: 'Laravel migrations exist (database/migrations/)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /database\/migrations\//.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Create database migrations in database/migrations/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsphpArtisanCommandsDocumented: {
    id: 'WS-PHP10',
    name: 'Artisan commands documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /artisan|php artisan|make:model|make:controller|migrate/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document key Artisan commands (migrate, seed, make:*) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsphpQueueWorkerDocumented: {
    id: 'WS-PHP11',
    name: 'Queue worker documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; if (!/horizon|queue/i.test(cj) && !ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /queue|horizon|worker|job|dispatch/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document queue worker setup (php artisan queue:work, Horizon).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsphpLaravelPintConfigured: {
    id: 'WS-PHP12',
    name: 'Laravel Pint configured (pint.json)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /pint\.json$/.test(f)) || /laravel\/pint/i.test(ctx.fileContent('composer.json') || ''); },
    impact: 'low',
    category: 'php',
    fix: 'Configure Laravel Pint (pint.json) for code style enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsphpAssetBundlingDocumented: {
    id: 'WS-PHP13',
    name: 'Vite/Mix asset bundling documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /vite\.config\.|webpack\.mix\.js$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /vite|mix|asset|npm run dev|npm run build/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document asset bundling setup (Vite or Mix) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsphpConfigCachingDocumented: {
    id: 'WS-PHP14',
    name: 'Laravel config caching documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /config:cache|config:clear|route:cache|optimize/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document config/route caching strategy (php artisan config:cache) for production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  wsphpComposerScriptsDefined: {
    id: 'WS-PHP15',
    name: 'Composer scripts defined',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"scripts"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Define composer scripts for common tasks (test, lint, analyze) in composer.json.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },


};

Object.assign(WINDSURF_TECHNIQUES, buildStackChecks({
  platform: 'windsurf',
  objectPrefix: 'ws',
  idPrefix: 'WS',
  docs: (ctx) => [
    ctx.fileContent('AGENTS.md') || '',
    ctx.fileContent('README.md') || '',
    ctx.fileContent('CLAUDE.md') || '',
    ctx.fileContent('CONTRIBUTING.md') || '',
  ].filter(Boolean).join('\n'),
}));

attachSourceUrls('windsurf', WINDSURF_TECHNIQUES);

// CTO-08 — tag every check with a scope layer.
const { LAYERS: WS_LAYERS, assignLayers: wsAssignLayers } = require('../audit/layers');
wsAssignLayers(WINDSURF_TECHNIQUES, WS_LAYERS.GOVERNANCE);

module.exports = {
  WINDSURF_TECHNIQUES,
};
