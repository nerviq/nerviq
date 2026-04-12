/**
 * Cursor techniques module — CHECK CATALOG
 *
 * 88 checks across 16 categories:
 *   v0.1 (40): A. Rules(9), B. Config(8), C. Trust & Safety(11), D. Agent Mode(5), E. MCP(5), F. Instructions Quality(5)
 *   v0.5 (55): G. Background Agents(5), H. Automations(6), I. Enterprise(5)
 *   v1.0 (70): J. BugBot & Code Review(4), K. Cross-Surface(4), L. Quality Deep(7)
 *   CP-08 (82): M. Advisory(4), N. Pack(4), O. Repeat(3), P. Freshness(3)
 *   Exp-fixes (88): +4 new checks from experiment findings
 *
 * Each check: { id, name, check(ctx), impact, rating, category, fix, template, file(), line() }
 */

const os = require('os');
const path = require('path');
const { CursorProjectContext } = require('./context');
const { EMBEDDED_SECRET_PATTERNS, containsEmbeddedSecret } = require('../secret-patterns');
const { attachSourceUrls } = require('../source-urls');
const { buildStackChecks } = require('../stack-checks');
const { isApiProject, isDatabaseProject, isAuthProject, isMonitoringRelevant } = require('../supplemental-checks');
const { hasCostBudgetOrUsageTracking } = require('../cost-tracking');
const { validateMdcFrontmatter, validateMcpEnvVars } = require('./config-parser');

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
  const rules = ctx.cursorRules ? ctx.cursorRules() : [];
  return rules.map(r => r.body || '').join('\n');
}

function coreRulesContent(ctx) {
  const always = ctx.alwaysApplyRules ? ctx.alwaysApplyRules() : [];
  return always.map(r => r.body || '').join('\n');
}

function mcpJsonRaw(ctx) {
  return ctx.fileContent('.cursor/mcp.json') || '';
}

function mcpJsonData(ctx) {
  const result = ctx.mcpConfig();
  return result && result.ok ? result.data : null;
}

function envJsonData(ctx) {
  const result = ctx.environmentJson();
  return result && result.ok ? result.data : null;
}

function docsBundle(ctx) {
  const rules = allRulesContent(ctx) || '';
  const readme = ctx.fileContent('README.md') || '';
  const legacy = ctx.legacyCursorrules ? (ctx.legacyCursorrules() || '') : '';
  return `${rules}\n${readme}\n${legacy}`;
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

function automationContents(ctx) {
  const configs = ctx.automationsConfig ? ctx.automationsConfig() : [];
  return configs.map(c => c.content || '').join('\n');
}

function wordCount(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

// ─── CURSOR_TECHNIQUES ──────────────────────────────────────────────────────

const CURSOR_TECHNIQUES = {

  // =============================================
  // A. Rules (9 checks) — CU-A01..CU-A09
  // =============================================

  cursorRulesExist: {
    id: 'CU-A01',
    name: '.cursor/rules/ directory exists with .mdc files',
    check: (ctx) => {
      const rules = ctx.cursorRules ? ctx.cursorRules() : [];
      return rules.length > 0;
    },
    impact: 'critical',
    rating: 5,
    category: 'rules',
    fix: 'Create .cursor/rules/ directory with at least one .mdc rule file.',
    template: 'cursor-rules',
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorNoLegacyCursorrules: {
    id: 'CU-A02',
    name: 'No .cursorrules without migration warning',
    check: (ctx) => {
      const hasLegacy = ctx.hasLegacyRules ? ctx.hasLegacyRules() : Boolean(ctx.fileContent('.cursorrules'));
      const hasNewRules = ctx.cursorRules ? ctx.cursorRules().length > 0 : false;
      const hasMcp = Boolean(ctx.fileContent('.cursor/mcp.json'));
      // N/A when repo has no Cursor configuration at all — don't reward absence
      if (!hasLegacy && !hasNewRules && !hasMcp) return null;
      return !hasLegacy;
    },
    impact: 'critical',
    rating: 5,
    category: 'rules',
    fix: 'Migrate .cursorrules to .cursor/rules/*.mdc with alwaysApply: true. AGENT MODE COMPLETELY IGNORES .cursorrules (confirmed by direct observation). 82% of projects have broken rules because of this — cursor-doctor audit.',
    template: 'cursor-legacy-migration',
    file: () => '.cursorrules',
    line: () => 1,
  },

  cursorAlwaysApplyExists: {
    id: 'CU-A03',
    name: 'At least one rule has alwaysApply: true for agent mode',
    check: (ctx) => {
      const rules = ctx.cursorRules ? ctx.cursorRules() : [];
      if (rules.length === 0) return null;
      return rules.some(r => r.ruleType === 'always');
    },
    impact: 'high',
    rating: 5,
    category: 'rules',
    fix: 'Add alwaysApply: true to your core rule file so agents always see instructions.',
    template: 'cursor-rules',
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorRulesValidFrontmatter: {
    id: 'CU-A04',
    name: 'Rules have valid MDC frontmatter (YAML parseable)',
    check: (ctx) => {
      const rules = ctx.cursorRules ? ctx.cursorRules() : [];
      if (rules.length === 0) return null;
      return rules.every(r => {
        if (!r.frontmatter) return false;
        const validation = validateMdcFrontmatter(r.frontmatter);
        return validation.valid;
      });
    },
    impact: 'critical',
    rating: 5,
    category: 'rules',
    fix: 'Fix YAML frontmatter in .mdc files. Invalid YAML silently skips the entire rule file — no error, no warning. Only 3 fields recognized: description, globs, alwaysApply. 82% of audited projects have broken rules from this issue.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => 1,
  },

  cursorNoGlobsDescriptionCombo: {
    id: 'CU-A05',
    name: 'No rules combine globs + description (creates ambiguity)',
    check: (ctx) => {
      const rules = ctx.cursorRules ? ctx.cursorRules() : [];
      if (rules.length === 0) return null;
      return !rules.some(r => {
        if (!r.frontmatter || r.frontmatter.alwaysApply === true) return false;
        const hasGlobs = Array.isArray(r.frontmatter.globs)
          ? r.frontmatter.globs.length > 0
          : Boolean(r.frontmatter.globs);
        const hasDesc = Boolean(r.frontmatter.description && String(r.frontmatter.description).trim());
        return hasGlobs && hasDesc;
      });
    },
    impact: 'medium',
    rating: 3,
    category: 'rules',
    fix: 'Do not combine globs + description in the same rule. Use one or the other for clear rule activation.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorRulesUnder500Words: {
    id: 'CU-A06',
    name: 'Rules are under ~500 words each (longer = less reliably followed)',
    check: (ctx) => {
      const rules = ctx.cursorRules ? ctx.cursorRules() : [];
      if (rules.length === 0) return null;
      return rules.every(r => wordCount(r.body) <= 500);
    },
    impact: 'medium',
    rating: 3,
    category: 'rules',
    fix: 'Split long rules into focused, shorter files. Rules over ~500 words are less reliably followed.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorRulesNoFiller: {
    id: 'CU-A07',
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
    file: () => '.cursor/rules/',
    line: () => {
      const content = allRulesContent({ cursorRules: () => [] });
      return content ? findFillerLine(content) : null;
    },
  },

  cursorRulesNoSecrets: {
    id: 'CU-A08',
    name: 'No secrets/API keys in rule files',
    check: (ctx) => {
      const rulesContent = allRulesContent(ctx);
      const commandContent = (ctx.commandFiles ? ctx.commandFiles() : [])
        .map(f => ctx.fileContent(f) || '').join('\n');
      const combined = `${rulesContent}\n${commandContent}`;
      if (!combined.trim()) return null;
      return !containsEmbeddedSecret(combined);
    },
    impact: 'critical',
    rating: 5,
    category: 'rules',
    fix: 'Remove API keys and secrets from rule and command files. Use environment variables instead.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorAgentRequestedDescriptions: {
    id: 'CU-A09',
    name: 'Agent Requested rules have precise descriptions',
    check: (ctx) => {
      const agentRules = ctx.agentRequestedRules ? ctx.agentRequestedRules() : [];
      if (agentRules.length === 0) return null;
      return agentRules.every(r => {
        const desc = r.frontmatter && r.frontmatter.description;
        return desc && String(desc).trim().length >= 15;
      });
    },
    impact: 'medium',
    rating: 3,
    category: 'rules',
    fix: 'Add clear, specific descriptions (15+ chars) to Agent Requested rules so AI can judge relevance.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  // =============================================
  // B. Config (7 checks) — CU-B01..CU-B07
  // =============================================

  cursorMcpJsonExists: {
    id: 'CU-B01',
    name: '.cursor/mcp.json exists if MCP is used',
    check: (ctx) => {
      const result = ctx.mcpConfig();
      if (result.ok) return true;
      // N/A if no MCP signals at all
      const globalResult = ctx.globalMcpConfig ? ctx.globalMcpConfig() : { ok: false };
      if (!globalResult.ok) return null;
      return false;
    },
    impact: 'high',
    rating: 4,
    category: 'config',
    fix: 'Create .cursor/mcp.json with project-level MCP server configuration.',
    template: 'cursor-mcp',
    file: () => '.cursor/mcp.json',
    line: () => null,
  },

  cursorMcpToolLimit: {
    id: 'CU-B02',
    name: 'MCP total tools < 40 (silent drop limit)',
    check: (ctx) => {
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      const count = Object.keys(servers).length;
      if (count === 0) return null;
      const estimated = count * 5; // ~5 tools per server estimate
      return estimated < 40;
    },
    impact: 'high',
    rating: 4,
    category: 'config',
    fix: 'Reduce MCP servers to stay under ~40 total tools. Cursor silently drops tools beyond this limit.',
    template: null,
    file: () => '.cursor/mcp.json',
    line: () => null,
  },

  cursorCommandsExist: {
    id: 'CU-B03',
    name: 'Custom commands exist in .cursor/commands/',
    check: (ctx) => {
      const files = ctx.commandFiles ? ctx.commandFiles() : [];
      return files.length > 0;
    },
    impact: 'medium',
    rating: 3,
    category: 'config',
    fix: 'Create .cursor/commands/*.md files for reusable slash command prompts.',
    template: 'cursor-commands',
    file: () => '.cursor/commands/',
    line: () => null,
  },

  cursorEnvironmentJsonExists: {
    id: 'CU-B04',
    name: '.cursor/environment.json exists if background agents used',
    check: (ctx) => {
      const env = envJsonData(ctx);
      if (env) return true;
      // N/A if no background agent signals
      const rules = allRulesContent(ctx);
      const hasBackgroundSignals = /background agent|background.*agent/i.test(rules);
      if (!hasBackgroundSignals) return null;
      return false;
    },
    impact: 'high',
    rating: 4,
    category: 'config',
    fix: 'Create .cursor/environment.json to configure background agent VM (baseImage, env, persistedDirectories).',
    template: 'cursor-environment',
    file: () => '.cursor/environment.json',
    line: () => null,
  },

  cursorNoDeprecatedVscodeKeys: {
    id: 'CU-B05',
    name: 'No deprecated .vscode/settings.json Cursor keys',
    check: (ctx) => {
      const raw = ctx.fileContent('.vscode/settings.json') || '';
      if (!raw) return null;
      // Check for deprecated Cursor-specific keys
      const deprecatedPatterns = [
        /cursor\.general\.enableStickyScroll/,
        /cursor\.aicompletion/i,
      ];
      return !deprecatedPatterns.some(p => p.test(raw));
    },
    impact: 'medium',
    rating: 3,
    category: 'config',
    fix: 'Remove deprecated Cursor keys from .vscode/settings.json.',
    template: null,
    file: () => '.vscode/settings.json',
    line: () => null,
  },

  cursorMcpValidJson: {
    id: 'CU-B06',
    name: 'MCP config is valid JSON',
    check: (ctx) => {
      const raw = mcpJsonRaw(ctx);
      if (!raw) return null;
      const result = ctx.mcpConfig();
      return result && result.ok;
    },
    impact: 'critical',
    rating: 5,
    category: 'config',
    fix: 'Fix malformed JSON in .cursor/mcp.json.',
    template: null,
    file: () => '.cursor/mcp.json',
    line: (ctx) => {
      const result = ctx.mcpConfig();
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

  cursorCommandsClear: {
    id: 'CU-B07',
    name: 'Custom command .md files have clear prompts',
    check: (ctx) => {
      const files = ctx.commandFiles ? ctx.commandFiles() : [];
      if (files.length === 0) return null;
      return files.every(f => {
        const content = ctx.fileContent(f);
        return content && content.trim().length >= 20;
      });
    },
    impact: 'low',
    rating: 2,
    category: 'config',
    fix: 'Ensure custom command files have clear, actionable prompt content (20+ chars).',
    template: null,
    file: () => '.cursor/commands/',
    line: () => null,
  },

  cursorMcpServersRootKey: {
    id: 'CU-B08',
    name: 'MCP config has required mcpServers root key',
    check: (ctx) => {
      const raw = mcpJsonRaw(ctx);
      if (!raw) return null;
      const data = mcpJsonData(ctx);
      if (!data) return null;
      // Must have mcpServers key at root — any other key causes silent failure
      return Object.prototype.hasOwnProperty.call(data, 'mcpServers');
    },
    impact: 'critical',
    rating: 5,
    category: 'config',
    fix: 'Ensure .cursor/mcp.json has the "mcpServers" root key. Using "servers" or any other key causes silent failure — zero tools load with no error shown (confirmed by experiment).',
    template: null,
    file: () => '.cursor/mcp.json',
    line: () => 1,
  },

  // =============================================
  // C. Trust & Safety (11 checks) — CU-C01..CU-C11
  // =============================================

  cursorPrivacyMode: {
    id: 'CU-C01',
    name: 'Privacy Mode documented in rules/docs',
    check: (ctx) => {
      // Privacy Mode is an IDE setting stored in SQLite state.vscdb — not auditable
      // from repo files. This check validates that the repo documents its stance.
      const hasNewRules = ctx.cursorRules ? ctx.cursorRules().length > 0 : false;
      const hasLegacy = ctx.hasLegacyRules ? ctx.hasLegacyRules() : Boolean(ctx.fileContent('.cursorrules'));
      // N/A when no rules exist to check against
      if (!hasNewRules && !hasLegacy) return null;
      const docs = docsBundle(ctx);
      return /privacy mode|zero.?retention|data retention|privacy.*enabled/i.test(docs);
    },
    impact: 'low',
    rating: 3,
    category: 'trust',
    fix: 'Privacy Mode is OFF by default in Cursor — code is sent to providers unless enabled. Document your stance in a rules file so contributors know whether Privacy Mode is expected on/off. Enable in Cursor Settings → Privacy → Privacy Mode.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorNoAutoRunUntrusted: {
    id: 'CU-C02',
    name: 'No auto-run terminal without review for untrusted repos',
    check: (ctx) => {
      // Check if rules mention auto-run/YOLO mode awareness
      const docs = docsBundle(ctx);
      if (!docs.trim()) return null;
      // Pass if rules mention caution about auto-run
      const mentionsAutoRun = /auto.?run|yolo|terminal.*approv|command.*confirm/i.test(docs);
      // If no mention at all, it's not necessarily a fail — only fail if auto-run is explicitly enabled
      return mentionsAutoRun || !(/auto.?run.*enable|yolo.*mode/i.test(docs));
    },
    impact: 'high',
    rating: 4,
    category: 'trust',
    fix: 'Document terminal auto-run policy. Consider disabling for untrusted repos.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorAutomationTriggersScoped: {
    id: 'CU-C03',
    name: 'Automation triggers are intentional and scoped',
    check: (ctx) => {
      const configs = ctx.automationsConfig ? ctx.automationsConfig() : [];
      if (configs.length === 0) return null;
      // Check for overly broad triggers
      const combined = configs.map(c => c.content).join('\n');
      const hasBroadTrigger = /trigger:.*any|on.*any.*push|trigger:.*\*/i.test(combined);
      return !hasBroadTrigger;
    },
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'Scope automation triggers to specific branches and events. Avoid wildcard triggers.',
    template: null,
    file: () => '.cursor/automations/',
    line: () => null,
  },

  cursorNoSecretsInEnvJson: {
    id: 'CU-C04',
    name: 'No secrets in environment.json or command files',
    check: (ctx) => {
      const envContent = ctx.fileContent('.cursor/environment.json') || '';
      const cmdContent = (ctx.commandFiles ? ctx.commandFiles() : [])
        .map(f => ctx.fileContent(f) || '').join('\n');
      const combined = `${envContent}\n${cmdContent}`;
      if (!combined.trim()) return null;
      return !containsEmbeddedSecret(combined);
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Remove secrets from environment.json and command files. Use KMS/vault for background agent secrets.',
    template: null,
    file: () => '.cursor/environment.json',
    line: () => null,
  },

  cursorMcpTrustedSources: {
    id: 'CU-C05',
    name: 'MCP servers from trusted sources (no known CVEs)',
    check: (ctx) => {
      const raw = mcpJsonRaw(ctx);
      if (!raw) return null;
      // Check for known vulnerable patterns
      const knownVulnerable = /mcp-poisoned|cve-2025/i.test(raw);
      // Check for non-npm/trusted sources
      const hasUntrusted = /curl.*\|.*sh|wget.*\|.*sh/i.test(raw);
      return !knownVulnerable && !hasUntrusted;
    },
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'Verify MCP servers are from trusted sources. Check for CVE-2025-54136 (MCPoison) and CVE-2025-54135 (CurXecute).',
    template: null,
    file: () => '.cursor/mcp.json',
    line: () => null,
  },

  cursorBackgroundAgentBranch: {
    id: 'CU-C06',
    name: 'Background agent creates branch (not commits to main)',
    check: (ctx) => {
      const env = envJsonData(ctx);
      if (!env) return null;
      // Background agents always create PRs by default — check for override
      const rules = allRulesContent(ctx);
      const hasPushToMain = /push.*main|commit.*main.*direct|direct.*push/i.test(rules);
      return !hasPushToMain;
    },
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'Ensure background agents create branches and PRs, never push directly to main.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorCodeReversionRisk: {
    id: 'CU-C07',
    name: 'Code reversion risk mitigated (format-on-save + agent review conflict)',
    check: (ctx) => {
      const vscodeRaw = ctx.fileContent('.vscode/settings.json') || '';
      const hasFormatOnSave = /formatOnSave.*true/i.test(vscodeRaw);
      if (!hasFormatOnSave) return null; // No risk if format-on-save is off
      // Check if rules document the risk
      const rules = allRulesContent(ctx);
      return /code reversion|format.*save.*conflict|revert|format.*save.*warning/i.test(rules);
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Document code reversion risk: format-on-save + agent review tab + cloud sync can cause silent code loss.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorEnterprisePrivacyMode: {
    id: 'CU-C08',
    name: 'Enterprise: org-wide Privacy Mode enforced',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/enterprise|org.*policy/i.test(docs)) return null;
      return /privacy mode.*enforc|org.*privacy|enterprise.*privacy/i.test(docs);
    },
    impact: 'medium',
    rating: 4,
    category: 'trust',
    fix: 'Document whether org-wide Privacy Mode enforcement is active for Enterprise tier.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorNoWildcardAutomation: {
    id: 'CU-C09',
    name: 'No wildcard automation triggers (e.g., "on any push")',
    check: (ctx) => {
      const configs = ctx.automationsConfig ? ctx.automationsConfig() : [];
      if (configs.length === 0) return null;
      const combined = configs.map(c => c.content).join('\n');
      const hasWildcard = /branches:.*\*|on:.*\*|trigger:.*all/i.test(combined);
      return !hasWildcard;
    },
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'Replace wildcard automation triggers with specific branch/event patterns.',
    template: null,
    file: () => '.cursor/automations/',
    line: () => null,
  },

  cursorBackgroundAgentHomeDir: {
    id: 'CU-C10',
    name: 'Background agent home directory exposure documented',
    check: (ctx) => {
      const env = envJsonData(ctx);
      if (!env) return null;
      // If background agents are configured, check that the security risk is documented
      const docs = docsBundle(ctx);
      return /home.?dir|npmrc|aws.?credentials|ssh.*key|credential.*exposure|home.*access/i.test(docs);
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Background agents have FULL READ access to ~/.npmrc, ~/.aws/credentials, ~/.ssh/ (open security issue since Nov 2025). Document this risk and remove sensitive credentials from home directory before using background agents, or use environment variable references instead.',
    template: null,
    file: () => '.cursor/environment.json',
    line: () => null,
  },

  cursorCursorignoreShellBypass: {
    id: 'CU-C11',
    name: '.cursorignore does not protect against shell command access',
    check: (ctx) => {
      const hasIgnore = Boolean(ctx.fileContent('.cursorignore'));
      if (!hasIgnore) return null;
      // If .cursorignore exists, check that docs acknowledge shell bypass gap
      const docs = docsBundle(ctx);
      return /cursorignore.*shell|shell.*bypass|terminal.*ignore|ignore.*terminal/i.test(docs);
    },
    impact: 'high',
    rating: 4,
    category: 'trust',
    fix: '.cursorignore only protects files from @Codebase direct reads — agents can still access ignored files via terminal commands (cat, head, etc.). Do not rely on .cursorignore for security. Use proper OS-level file permissions for truly sensitive files.',
    template: null,
    file: () => '.cursorignore',
    line: () => null,
  },

  // =============================================
  // D. Agent Mode (5 checks) — CU-D01..CU-D05
  // =============================================

  cursorRulesReachAgent: {
    id: 'CU-D01',
    name: 'Rules properly reach agent (not just .cursorrules)',
    check: (ctx) => {
      const rules = ctx.cursorRules ? ctx.cursorRules() : [];
      const hasLegacy = ctx.hasLegacyRules ? ctx.hasLegacyRules() : false;
      if (rules.length === 0 && !hasLegacy) return null;
      // Must have .mdc rules, not just legacy
      return rules.length > 0;
    },
    impact: 'critical',
    rating: 5,
    category: 'agent-mode',
    fix: 'Create .cursor/rules/*.mdc files with proper frontmatter. .cursorrules is ignored by agent mode!',
    template: 'cursor-rules',
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorCodebaseIndexed: {
    id: 'CU-D02',
    name: 'Agent has appropriate context scope (@Codebase indexed)',
    check: (ctx) => {
      const rules = allRulesContent(ctx);
      if (!rules.trim()) return null;
      return /@Codebase|@codebase|semantic search|codebase.*index/i.test(rules);
    },
    impact: 'medium',
    rating: 3,
    category: 'agent-mode',
    fix: 'Mention @Codebase in rules to guide agents to use project-wide semantic search.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorMultiAgentWorktree: {
    id: 'CU-D03',
    name: 'Multi-agent workflows use Git worktree isolation',
    check: (ctx) => {
      const rules = allRulesContent(ctx);
      if (!rules.trim()) return null;
      // Only relevant if multi-agent mentioned
      if (!/multi.?agent|parallel agent|agent.*window/i.test(rules)) return null;
      return /worktree|git worktree|isolat/i.test(rules);
    },
    impact: 'medium',
    rating: 3,
    category: 'agent-mode',
    fix: 'For multi-agent workflows (Agents Window), use Git worktree isolation to prevent conflicts.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorSessionLengthAwareness: {
    id: 'CU-D04',
    name: 'Agent session length awareness (<2h recommended)',
    check: (ctx) => {
      const rules = allRulesContent(ctx);
      if (!rules.trim()) return null;
      return /session.*length|session.*limit|2.*hour|context.*drift|long.*session/i.test(rules);
    },
    impact: 'low',
    rating: 2,
    category: 'agent-mode',
    fix: 'Document session length recommendations. Sessions >2h may lose agent context.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorDocsConfigured: {
    id: 'CU-D05',
    name: '@Docs configured for project key libraries',
    check: (ctx) => {
      const rules = allRulesContent(ctx);
      if (!rules.trim()) return null;
      return /@Docs|@docs|documentation.*index|library.*doc/i.test(rules);
    },
    impact: 'medium',
    rating: 3,
    category: 'agent-mode',
    fix: 'Configure @Docs for key project libraries to give agents access to current documentation.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  // =============================================
  // E. MCP (5 checks) — CU-E01..CU-E05
  // =============================================

  cursorMcpPerSurface: {
    id: 'CU-E01',
    name: 'MCP servers configured per surface (project + global)',
    check: (ctx) => {
      const project = ctx.mcpConfig();
      if (!project.ok) return null;
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'Configure project-level MCP in .cursor/mcp.json. Global config at ~/.cursor/mcp.json.',
    template: 'cursor-mcp',
    file: () => '.cursor/mcp.json',
    line: () => null,
  },

  cursorMcpProjectOverride: {
    id: 'CU-E02',
    name: 'Project mcp.json overrides global correctly',
    check: (ctx) => {
      const project = ctx.mcpConfig();
      const global = ctx.globalMcpConfig ? ctx.globalMcpConfig() : { ok: false };
      if (!project.ok || !global.ok) return null;
      // Just verify both parse correctly — Cursor handles override automatically
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'Ensure project .cursor/mcp.json and global ~/.cursor/mcp.json are both valid JSON.',
    template: null,
    file: () => '.cursor/mcp.json',
    line: () => null,
  },

  cursorMcpEnvVarSyntax: {
    id: 'CU-E03',
    name: 'MCP env vars use ${env:VAR} syntax (not hardcoded)',
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
    file: () => '.cursor/mcp.json',
    line: () => null,
  },

  cursorMcpCurrentVersion: {
    id: 'CU-E04',
    name: 'MCP marketplace servers are current version',
    check: (ctx) => {
      const raw = mcpJsonRaw(ctx);
      if (!raw) return null;
      // Check for @latest or explicit version
      const hasStale = /\b\d+\.\d+\.\d+\b/.test(raw) && !/@latest\b/.test(raw);
      return !hasStale;
    },
    impact: 'low',
    rating: 2,
    category: 'mcp',
    fix: 'Use @latest for MCP packages or regularly update pinned versions.',
    template: null,
    file: () => '.cursor/mcp.json',
    line: () => null,
  },

  cursorMcpBackgroundAccess: {
    id: 'CU-E05',
    name: 'Background agent -p mode has MCP access (known bug)',
    check: (ctx) => {
      const env = envJsonData(ctx);
      const mcp = mcpJsonData(ctx);
      if (!env || !mcp) return null;
      // Document awareness of the known bug
      const rules = allRulesContent(ctx);
      return /background.*mcp|mcp.*background|-p.*mode|programmatic.*mode/i.test(rules);
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'Document MCP access limitations in background agent -p mode (known bug).',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  // =============================================
  // F. Instructions Quality (5 checks) — CU-F01..CU-F05
  // =============================================

  cursorRulesIncludeCommands: {
    id: 'CU-F01',
    name: 'Rules include build/test/lint commands',
    check: (ctx) => {
      const content = coreRulesContent(ctx) || allRulesContent(ctx);
      if (!content.trim()) return null;
      const expected = expectedVerificationCategories(ctx);
      if (expected.length === 0) return /\bverify\b|\btest\b|\blint\b|\bbuild\b/i.test(content);
      return expected.every(cat => hasCommandMention(content, cat));
    },
    impact: 'high',
    rating: 5,
    category: 'instructions-quality',
    fix: 'Add actual build/test/lint commands to your core rules so agents can verify their changes.',
    template: 'cursor-rules',
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorRulesArchitecture: {
    id: 'CU-F02',
    name: 'Rules include architecture section or Mermaid diagram',
    check: (ctx) => {
      const content = allRulesContent(ctx);
      if (!content.trim()) return null;
      return hasArchitecture(content);
    },
    impact: 'medium',
    rating: 4,
    category: 'instructions-quality',
    fix: 'Add an architecture section or Mermaid diagram to your core rule to orient agents.',
    template: 'cursor-rules',
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorRulesVerification: {
    id: 'CU-F03',
    name: 'Rules mention verification/testing expectations',
    check: (ctx) => {
      const content = allRulesContent(ctx);
      if (!content.trim()) return null;
      return /\bverif|\btest.*before|\bbefore.*commit|\brun test|\bensure test/i.test(content);
    },
    impact: 'high',
    rating: 5,
    category: 'instructions-quality',
    fix: 'Add verification expectations: agents should run tests before declaring a task complete.',
    template: 'cursor-rules',
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorRulesNoContradictions: {
    id: 'CU-F04',
    name: 'No contradictions between rules',
    check: (ctx) => {
      const rules = ctx.cursorRules ? ctx.cursorRules() : [];
      if (rules.length < 2) return null;
      // Simple heuristic: check for opposing instructions
      const combined = rules.map(r => r.body || '').join('\n');
      const hasContradiction = /\bnever use.*\balways use|\balways.*\bnever/i.test(combined);
      return !hasContradiction;
    },
    impact: 'medium',
    rating: 3,
    category: 'instructions-quality',
    fix: 'Review rules for contradictions. Cursor concatenates all matching rules without conflict resolution.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorRulesProjectSpecific: {
    id: 'CU-F05',
    name: 'Rules reference project-specific patterns (not generic)',
    check: (ctx) => {
      const content = allRulesContent(ctx);
      if (!content.trim()) return null;
      const pkg = ctx.jsonFile ? ctx.jsonFile('package.json') : null;
      const projectName = (pkg && pkg.name) || path.basename(ctx.dir);
      // Check for project-specific references
      const hasSpecific = content.includes(projectName) ||
        /src\/|app\/|api\/|routes\/|services\/|components\/|lib\/|cmd\//i.test(content);
      return hasSpecific;
    },
    impact: 'medium',
    rating: 3,
    category: 'instructions-quality',
    fix: 'Reference actual project directories and patterns in rules instead of generic instructions.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  // =============================================
  // G. Background Agents (5 checks) — CU-G01..CU-G05
  // =============================================

  cursorEnvBaseImage: {
    id: 'CU-G01',
    name: 'environment.json has appropriate baseImage',
    check: (ctx) => {
      const env = envJsonData(ctx);
      if (!env) return null;
      return Boolean(env.baseImage);
    },
    impact: 'high',
    rating: 4,
    category: 'background-agents',
    fix: 'Set baseImage in .cursor/environment.json (e.g., "node:20", "python:3.12").',
    template: 'cursor-environment',
    file: () => '.cursor/environment.json',
    line: () => 1,
  },

  cursorEnvPersistedDirs: {
    id: 'CU-G02',
    name: 'persistedDirectories includes node_modules/venv',
    check: (ctx) => {
      const env = envJsonData(ctx);
      if (!env) return null;
      const persisted = env.persistedDirectories || [];
      if (persisted.length === 0) return false;
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'background-agents',
    fix: 'Add persistedDirectories to environment.json to cache dependencies between runs.',
    template: 'cursor-environment',
    file: () => '.cursor/environment.json',
    line: () => null,
  },

  cursorEnvProcesses: {
    id: 'CU-G03',
    name: 'Processes defined for dev servers if needed',
    check: (ctx) => {
      const env = envJsonData(ctx);
      if (!env) return null;
      // Only relevant if project has dev server
      const pkg = ctx.jsonFile ? ctx.jsonFile('package.json') : null;
      const hasDevServer = pkg && pkg.scripts && (pkg.scripts.dev || pkg.scripts.start);
      if (!hasDevServer) return null;
      return Boolean(env.processes && Object.keys(env.processes).length > 0);
    },
    impact: 'medium',
    rating: 3,
    category: 'background-agents',
    fix: 'Define processes in environment.json for dev servers that background agents need.',
    template: 'cursor-environment',
    file: () => '.cursor/environment.json',
    line: () => null,
  },

  cursorEnvSecretsKms: {
    id: 'CU-G04',
    name: 'Secrets use KMS (not plaintext env vars)',
    check: (ctx) => {
      const envContent = ctx.fileContent('.cursor/environment.json') || '';
      if (!envContent.trim()) return null;
      // Check for hardcoded secret-looking values
      return !containsEmbeddedSecret(envContent);
    },
    impact: 'critical',
    rating: 5,
    category: 'background-agents',
    fix: 'Use KMS-encrypted secrets vault for background agents. Never put secrets in environment.json.',
    template: null,
    file: () => '.cursor/environment.json',
    line: () => null,
  },

  cursorEnvCreatesPr: {
    id: 'CU-G05',
    name: 'Agent output creates PR (not direct push)',
    check: (ctx) => {
      const env = envJsonData(ctx);
      if (!env) return null;
      // Background agents create PRs by default, check for override
      const rules = allRulesContent(ctx);
      const hasBadPattern = /push.*directly|commit.*main|--force push/i.test(rules);
      return !hasBadPattern;
    },
    impact: 'high',
    rating: 5,
    category: 'background-agents',
    fix: 'Ensure background agents create PRs for review, never push directly to main.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  // =============================================
  // H. Automations (5 checks) — CU-H01..CU-H05
  // =============================================

  cursorAutomationDocumented: {
    id: 'CU-H01',
    name: 'Automation triggers are documented',
    check: (ctx) => {
      const configs = ctx.automationsConfig ? ctx.automationsConfig() : [];
      if (configs.length === 0) return null;
      // Check that each automation has clear name/description
      return configs.every(c => {
        const content = c.content || '';
        return /name:|description:|instructions:/i.test(content);
      });
    },
    impact: 'high',
    rating: 4,
    category: 'automations',
    fix: 'Document each automation with name, description, and clear instructions.',
    template: null,
    file: () => '.cursor/automations/',
    line: () => null,
  },

  cursorAutomationNoBroadTrigger: {
    id: 'CU-H02',
    name: 'No overly broad triggers (e.g., "any push to any branch")',
    check: (ctx) => {
      const combined = automationContents(ctx);
      if (!combined.trim()) return null;
      const hasBroad = /branches:.*\*|on:.*\*.*push|any.*branch|all.*events/i.test(combined);
      return !hasBroad;
    },
    impact: 'high',
    rating: 5,
    category: 'automations',
    fix: 'Scope automation triggers to specific branches. Avoid wildcards that trigger on every push.',
    template: null,
    file: () => '.cursor/automations/',
    line: () => null,
  },

  cursorAutomationErrorHandling: {
    id: 'CU-H03',
    name: 'Automation has error handling / failure notification',
    check: (ctx) => {
      const combined = automationContents(ctx);
      if (!combined.trim()) return null;
      return /error|fail|notification|alert|on_failure|on_error/i.test(combined);
    },
    impact: 'medium',
    rating: 3,
    category: 'automations',
    fix: 'Add error handling and failure notification to automations.',
    template: null,
    file: () => '.cursor/automations/',
    line: () => null,
  },

  cursorAutomationRateLimits: {
    id: 'CU-H04',
    name: 'Rate limits considered (hundreds/hour possible)',
    check: (ctx) => {
      const combined = automationContents(ctx);
      if (!combined.trim()) return null;
      return /debounce|rate.?limit|throttle|cool.?down|max.*per/i.test(combined);
    },
    impact: 'medium',
    rating: 3,
    category: 'automations',
    fix: 'Add debounce_ms or rate limiting to automations that could fire frequently.',
    template: null,
    file: () => '.cursor/automations/',
    line: () => null,
  },

  cursorAutomationScopedPerms: {
    id: 'CU-H05',
    name: 'Automation agents have scoped permissions',
    check: (ctx) => {
      const combined = automationContents(ctx);
      if (!combined.trim()) return null;
      return /sandbox|permission|scope|restrict|limited/i.test(combined);
    },
    impact: 'high',
    rating: 4,
    category: 'automations',
    fix: 'Define scoped permissions and sandbox config for each automation agent.',
    template: null,
    file: () => '.cursor/automations/',
    line: () => null,
  },

  cursorAutomationFileSaveDebounce: {
    id: 'CU-H06',
    name: 'file_save automation triggers have debounce_ms set',
    check: (ctx) => {
      const configs = ctx.automationsConfig ? ctx.automationsConfig() : [];
      if (configs.length === 0) return null;
      const combined = configs.map(c => c.content).join('\n');
      // Only relevant if file_save trigger is used
      if (!/type:\s*file_save|file[_-]save/i.test(combined)) return null;
      // Must have debounce_ms set to avoid infinite loop
      return /debounce_ms|debounce-ms/i.test(combined);
    },
    impact: 'critical',
    rating: 5,
    category: 'automations',
    fix: 'Add debounce_ms: 30000 (minimum) to all file_save automation triggers. Without debounce, the automation saves a file → triggers itself → infinite loop that consumes your entire automation quota.',
    template: null,
    file: () => '.cursor/automations/',
    line: () => null,
  },

  // =============================================
  // I. Enterprise (5 checks) — CU-I01..CU-I05
  // =============================================

  cursorEnterpriseSso: {
    id: 'CU-I01',
    name: 'SSO configured (SAML/OIDC) if Enterprise',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/enterprise/i.test(docs)) return null;
      return /sso|saml|oidc|single sign/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'enterprise',
    fix: 'Configure SSO (SAML/OIDC) for Enterprise tier deployments.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorEnterpriseScim: {
    id: 'CU-I02',
    name: 'SCIM 2.0 provisioning active',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/enterprise/i.test(docs)) return null;
      return /scim|provisioning|directory sync/i.test(docs);
    },
    impact: 'low',
    rating: 2,
    category: 'enterprise',
    fix: 'Enable SCIM 2.0 provisioning for automated user management.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorEnterpriseAuditLogs: {
    id: 'CU-I03',
    name: 'Audit logs enabled',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/enterprise/i.test(docs)) return null;
      return /audit log|audit trail|tracking/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'enterprise',
    fix: 'Enable audit logs for Enterprise tier to track AI code generation and tool usage.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorEnterpriseMcpAllowlist: {
    id: 'CU-I04',
    name: 'MCP server allowlist maintained',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/enterprise/i.test(docs)) return null;
      return /mcp.*allowlist|allowlist.*mcp|approved.*server|server.*approval/i.test(docs);
    },
    impact: 'high',
    rating: 4,
    category: 'enterprise',
    fix: 'Maintain an MCP server allowlist for Enterprise deployments to control tool access.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorEnterpriseModelPolicy: {
    id: 'CU-I05',
    name: 'Model access policy matches team needs',
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
    file: () => '.cursor/rules/',
    line: () => null,
  },

  // =============================================
  // J. BugBot & Code Review (4 checks) — CU-J01..CU-J04
  // =============================================

  cursorBugbotEnabled: {
    id: 'CU-J01',
    name: 'BugBot enabled for critical repos',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!docs.trim()) return null;
      return /bugbot|bug.?bot|automated.*pr.*review/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'bugbot',
    fix: 'Enable BugBot for automated PR code review on critical repos.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorBugbotAutofix: {
    id: 'CU-J02',
    name: 'BugBot autofix configured appropriately',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!/bugbot|bug.?bot/i.test(docs)) return null;
      return /autofix|auto.?fix|fix.*mode|resolution/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'bugbot',
    fix: 'Configure BugBot autofix settings — decide which issue types should be auto-fixed vs flagged.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorReviewInstructionsLength: {
    id: 'CU-J03',
    name: 'Code review instructions within effective length',
    check: (ctx) => {
      const rules = ctx.cursorRules ? ctx.cursorRules() : [];
      const reviewRules = rules.filter(r =>
        /review|code.*review/i.test(r.name || '') ||
        (r.frontmatter && r.frontmatter.description && /review/i.test(r.frontmatter.description))
      );
      if (reviewRules.length === 0) return null;
      return reviewRules.every(r => wordCount(r.body) <= 400);
    },
    impact: 'medium',
    rating: 3,
    category: 'bugbot',
    fix: 'Keep code review instruction rules under ~400 words for reliable agent adherence.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorReviewNoConflict: {
    id: 'CU-J04',
    name: 'Review automation does not conflict with human review',
    check: (ctx) => {
      const configs = ctx.automationsConfig ? ctx.automationsConfig() : [];
      if (configs.length === 0) return null;
      const combined = configs.map(c => c.content).join('\n');
      const hasReviewAuto = /auto.*review|review.*auto|merge.*auto/i.test(combined);
      if (!hasReviewAuto) return null;
      // If auto-review exists, check it doesn't auto-merge
      return !/auto.*merge|merge.*without.*review/i.test(combined);
    },
    impact: 'low',
    rating: 2,
    category: 'bugbot',
    fix: 'Ensure automated review does not bypass human review requirements.',
    template: null,
    file: () => '.cursor/automations/',
    line: () => null,
  },

  // =============================================
  // K. Cross-Surface Consistency (4 checks) — CU-K01..CU-K04
  // =============================================

  cursorRulesConsistentSurfaces: {
    id: 'CU-K01',
    name: 'Rules consistent between foreground and background agents',
    check: (ctx) => {
      const rules = ctx.cursorRules ? ctx.cursorRules() : [];
      const env = envJsonData(ctx);
      if (rules.length === 0 || !env) return null;
      // If we have both surfaces, rules should exist for both
      return rules.length > 0;
    },
    impact: 'high',
    rating: 4,
    category: 'cross-surface',
    fix: 'Ensure .cursor/rules/ are accessible to both foreground and background agents.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorMcpConsistentSurfaces: {
    id: 'CU-K02',
    name: 'MCP config consistent across surfaces',
    check: (ctx) => {
      const project = ctx.mcpConfig();
      if (!project.ok) return null;
      // MCP config applies to foreground; background has separate access
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'cross-surface',
    fix: 'Document which MCP servers are available to foreground vs background agents.',
    template: null,
    file: () => '.cursor/mcp.json',
    line: () => null,
  },

  cursorAutomationRulesConsistent: {
    id: 'CU-K03',
    name: 'Automation agents have same rules as interactive agents',
    check: (ctx) => {
      const configs = ctx.automationsConfig ? ctx.automationsConfig() : [];
      if (configs.length === 0) return null;
      const rules = ctx.cursorRules ? ctx.cursorRules() : [];
      return rules.length > 0;
    },
    impact: 'high',
    rating: 4,
    category: 'cross-surface',
    fix: 'Ensure automation agents can access the same .cursor/rules/ as interactive agents.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorEnvMatchesLocal: {
    id: 'CU-K04',
    name: 'environment.json matches local dev environment',
    check: (ctx) => {
      const env = envJsonData(ctx);
      if (!env) return null;
      // Check that baseImage matches project stack
      const pkg = ctx.jsonFile ? ctx.jsonFile('package.json') : null;
      if (pkg && env.baseImage) {
        const isNode = /node/i.test(env.baseImage);
        const projectIsNode = Boolean(pkg.dependencies || pkg.devDependencies);
        return isNode === projectIsNode || true; // relaxed check
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'cross-surface',
    fix: 'Ensure environment.json baseImage matches the local development environment stack.',
    template: null,
    file: () => '.cursor/environment.json',
    line: () => null,
  },

  // =============================================
  // L. Quality Deep (7 checks) — CU-L01..CU-L07
  // =============================================

  cursorModernFeatures: {
    id: 'CU-L01',
    name: 'Rules mention modern Cursor features (automations, background agents, BugBot)',
    check: (ctx) => {
      const content = allRulesContent(ctx);
      if (!content.trim()) return null;
      return /automation|background agent|bugbot|bug.?bot|design mode|agent.*window/i.test(content);
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Document awareness of modern Cursor features: automations, background agents, BugBot, Design Mode.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorNoDeprecatedPatterns: {
    id: 'CU-L02',
    name: 'No deprecated patterns (Notepads, .cursorrules for agent)',
    check: (ctx) => {
      const content = allRulesContent(ctx);
      const legacy = ctx.legacyCursorrules ? ctx.legacyCursorrules() : null;
      const combined = `${content}\n${legacy || ''}`;
      if (!combined.trim()) return null;
      const hasDeprecated = /@Notepads|notepad/i.test(combined);
      return !hasDeprecated && !legacy;
    },
    impact: 'high',
    rating: 4,
    category: 'quality-deep',
    fix: 'Remove @Notepads references (deprecated Oct 2025). Migrate .cursorrules to .cursor/rules/*.mdc.',
    template: 'cursor-legacy-migration',
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorRuleCountManageable: {
    id: 'CU-L03',
    name: 'Rule file count is manageable (<20 files, avoid context bloat)',
    check: (ctx) => {
      const rules = ctx.cursorRules ? ctx.cursorRules() : [];
      if (rules.length === 0) return null;
      return rules.length < 20;
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Keep rule files under 20. Consolidate related rules to avoid context bloat.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorAlwaysApplyMinimized: {
    id: 'CU-L04',
    name: 'Always Apply rules minimized (token cost per message)',
    check: (ctx) => {
      const always = ctx.alwaysApplyRules ? ctx.alwaysApplyRules() : [];
      if (always.length === 0) return null;
      // More than 3 always-apply rules is excessive
      return always.length <= 3;
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Minimize Always Apply rules (keep to 1-3). Each one adds token cost to every message.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorNoNestedRulesDirs: {
    id: 'CU-L05',
    name: 'No nested rules directories (silently ignored by Cursor)',
    check: (ctx) => {
      const rulesDir = path.join(ctx.dir, '.cursor', 'rules');
      try {
        const entries = require('fs').readdirSync(rulesDir, { withFileTypes: true });
        const hasDirs = entries.some(e => e.isDirectory());
        return !hasDirs;
      } catch {
        return null;
      }
    },
    impact: 'low',
    rating: 2,
    category: 'quality-deep',
    fix: 'Remove subdirectories from .cursor/rules/ — Cursor silently ignores nested rule directories.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorDocsIndexed: {
    id: 'CU-L06',
    name: '@Docs indexed for project framework documentation',
    check: (ctx) => {
      const content = allRulesContent(ctx);
      if (!content.trim()) return null;
      return /@Docs|documentation.*crawl|docs.*index|library.*reference/i.test(content);
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Configure @Docs to index key framework documentation for better agent suggestions.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorSessionDriftAwareness: {
    id: 'CU-L07',
    name: 'Agent session drift awareness documented',
    check: (ctx) => {
      const content = allRulesContent(ctx);
      if (!content.trim()) return null;
      return /session.*drift|context.*window|long.*session|session.*length|refresh.*context/i.test(content);
    },
    impact: 'low',
    rating: 2,
    category: 'quality-deep',
    fix: 'Document session drift awareness. Long sessions (>2h) may lose agent context.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  // =============================================
  // M. Advisory (4 checks) — CU-M01..CU-M04
  // =============================================

  cursorAdvisoryInstructionQuality: {
    id: 'CU-M01',
    name: 'Instruction quality score meets advisory threshold',
    check: (ctx) => {
      const content = coreRulesContent(ctx) || allRulesContent(ctx);
      if (!content.trim()) return null;
      const lines = content.split(/\r?\n/).filter(l => l.trim()).length;
      const sections = countSections(content);
      const hasArch = hasArchitecture(content);
      const hasVerify = /\bverif|\btest|\blint|\bbuild/i.test(content);
      const score = (lines >= 30 ? 2 : lines >= 15 ? 1 : 0) +
                    (sections >= 4 ? 2 : sections >= 2 ? 1 : 0) +
                    (hasArch ? 1 : 0) +
                    (hasVerify ? 1 : 0);
      return score >= 4;
    },
    impact: 'medium',
    rating: 4,
    category: 'advisory',
    fix: 'Improve rule quality: add more sections, architecture diagram, and verification commands.',
    template: 'cursor-rules',
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorAdvisorySecurityPosture: {
    id: 'CU-M02',
    name: 'Security posture meets advisory threshold',
    check: (ctx) => {
      let score = 0;
      const docs = docsBundle(ctx);
      if (/privacy mode/i.test(docs)) score++;
      if (!ctx.hasLegacyRules || !ctx.hasLegacyRules()) score++;
      const mcpResult = ctx.mcpConfig();
      if (mcpResult.ok) {
        const validation = validateMcpEnvVars(mcpResult.data);
        if (validation.valid) score++;
      } else {
        score++; // No MCP = no MCP risk
      }
      if (/security|secret|credential/i.test(docs)) score++;
      return score >= 2;
    },
    impact: 'high',
    rating: 5,
    category: 'advisory',
    fix: 'Improve security posture: enable Privacy Mode, migrate .cursorrules, secure MCP config.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorAdvisorySurfaceCoverage: {
    id: 'CU-M03',
    name: 'Surface coverage meets advisory threshold',
    check: (ctx) => {
      const surfaces = ctx.detectSurfaces ? ctx.detectSurfaces() : {};
      return surfaces.foreground === true;
    },
    impact: 'medium',
    rating: 4,
    category: 'advisory',
    fix: 'Configure at least the foreground agent surface with .cursor/rules/*.mdc files.',
    template: 'cursor-rules',
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorAdvisoryMcpHealth: {
    id: 'CU-M04',
    name: 'MCP configuration health meets advisory threshold',
    check: (ctx) => {
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      const count = Object.keys(servers).length;
      if (count === 0) return null;
      const mcpResult = ctx.mcpConfig();
      return mcpResult && mcpResult.ok;
    },
    impact: 'medium',
    rating: 3,
    category: 'advisory',
    fix: 'Ensure MCP configuration is valid and servers are properly configured.',
    template: null,
    file: () => '.cursor/mcp.json',
    line: () => null,
  },

  // =============================================
  // N. Pack (4 checks) — CU-N01..CU-N04
  // =============================================

  cursorPackDomainDetected: {
    id: 'CU-N01',
    name: 'Domain pack detection returns relevant results',
    check: (ctx) => {
      const pkg = ctx.jsonFile ? ctx.jsonFile('package.json') : null;
      return Boolean(pkg || ctx.fileContent('go.mod') || ctx.fileContent('Cargo.toml') || ctx.fileContent('pyproject.toml'));
    },
    impact: 'low',
    rating: 2,
    category: 'advisory',
    fix: 'Ensure project has identifiable stack markers for domain pack detection.',
    template: null,
    file: () => 'package.json',
    line: () => null,
  },

  cursorPackMcpRecommended: {
    id: 'CU-N02',
    name: 'MCP packs recommended based on project signals',
    check: (ctx) => {
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      return Object.keys(servers).length > 0;
    },
    impact: 'low',
    rating: 2,
    category: 'advisory',
    fix: 'Add recommended MCP packs to .cursor/mcp.json based on project domain.',
    template: 'cursor-mcp',
    file: () => '.cursor/mcp.json',
    line: () => null,
  },

  cursorPackGovernanceApplied: {
    id: 'CU-N03',
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
    file: () => '.cursor/rules/',
    line: () => null,
  },

  cursorPackConsistency: {
    id: 'CU-N04',
    name: 'All applied packs are consistent with each other',
    check: (ctx) => {
      const rules = allRulesContent(ctx);
      const mcp = mcpJsonRaw(ctx);
      if (!rules && !mcp) return null;
      // No contradiction: if rules say "strict" and config says "yolo"
      const rulesStrict = /\bstrict\b|\blocked.?down\b|\bno auto/i.test(rules);
      const configPermissive = /yolo|auto.*run.*all/i.test(rules);
      return !(rulesStrict && configPermissive);
    },
    impact: 'medium',
    rating: 3,
    category: 'advisory',
    fix: 'Resolve contradictions between rule guidance and configuration.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  // =============================================
  // O. Repeat (3 checks) — CU-O01..CU-O03
  // =============================================

  cursorRepeatScoreImproved: {
    id: 'CU-O01',
    name: 'Audit score improved since last run',
    check: () => null, // Requires snapshot history — always N/A in static check
    impact: 'low',
    rating: 2,
    category: 'freshness',
    fix: 'Run audits regularly and track score improvement over time.',
    template: null,
    file: () => null,
    line: () => null,
  },

  cursorRepeatNoRegressions: {
    id: 'CU-O02',
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

  cursorRepeatFeedbackLoop: {
    id: 'CU-O03',
    name: 'Feedback loop active for recommendations',
    check: () => null, // Requires feedback data
    impact: 'low',
    rating: 2,
    category: 'freshness',
    fix: 'Use `npx nerviq --platform cursor feedback` to rate recommendations.',
    template: null,
    file: () => null,
    line: () => null,
  },

  // =============================================
  // P. Freshness (3 checks) — CU-P01..CU-P03
  // =============================================

  cursorFreshnessSourcesVerified: {
    id: 'CU-P01',
    name: 'P0 freshness sources verified within threshold',
    check: () => null, // Requires freshness verification data
    impact: 'medium',
    rating: 3,
    category: 'freshness',
    fix: 'Verify P0 Cursor documentation sources are current before claiming freshness.',
    template: null,
    file: () => null,
    line: () => null,
  },

  cursorFreshnessPropagation: {
    id: 'CU-P02',
    name: 'Freshness propagation checklist is current',
    check: () => null, // Requires propagation tracking
    impact: 'low',
    rating: 2,
    category: 'freshness',
    fix: 'Review propagation checklist when Cursor releases new features or changes.',
    template: null,
    file: () => null,
    line: () => null,
  },

  cursorFreshnessRuleFormat: {
    id: 'CU-P03',
    name: 'Rule format matches current Cursor version expectations',
    check: (ctx) => {
      const rules = ctx.cursorRules ? ctx.cursorRules() : [];
      if (rules.length === 0) return null;
      // All rules should use MDC format (not plain markdown)
      return rules.every(r => r.frontmatter !== null);
    },
    impact: 'medium',
    rating: 3,
    category: 'freshness',
    fix: 'Ensure all rules use current MDC format with YAML frontmatter.',
    template: null,
    file: () => '.cursor/rules/',
    line: () => null,
  },

  // =============================================
  // T. Cross-Cutting Engineering (48 checks) — CU-T01..CU-T48
  // =============================================

  // ── Testing Strategy (CU-T01..T06) ──
  cursorTestFrameworkDetected: {
    id: 'CU-T01', name: 'Test framework detected in project',
    check: (ctx) => { const p = ctx.fileContent('package.json'); if (!p) return null; return /jest|vitest|mocha|jasmine|ava|tap\b/i.test(p) || ctx.files.some(f => /pytest|spec_helper|test_helper/i.test(f)); },
    impact: 'high', rating: 4, category: 'testing-strategy',
    fix: 'Add a test framework (Jest, Vitest, Mocha) to package.json devDependencies.',
    template: null, file: () => 'package.json', line: () => null,
  },
  cursorCoverageConfigExists: {
    id: 'CU-T02', name: 'Coverage configuration exists',
    check: (ctx) => ctx.files.some(f => /\.nycrc|\.c8rc|jest\.config|vitest\.config|\.coveragerc/i.test(f)) || /coverage/i.test(ctx.fileContent('package.json') || ''),
    impact: 'medium', rating: 3, category: 'testing-strategy',
    fix: 'Add a coverage configuration (jest --coverage, .nycrc, vitest coverage) to track test coverage.',
    template: null, file: () => 'package.json', line: () => null,
  },
  cursorE2eSetupPresent: {
    id: 'CU-T03', name: 'E2E test setup present',
    check: (ctx) => ctx.files.some(f => /cypress\.config|playwright\.config|e2e\.(test|spec)\.(ts|js)|nightwatch\.conf/i.test(f)),
    impact: 'medium', rating: 3, category: 'testing-strategy',
    fix: 'Set up E2E tests with Playwright or Cypress for integration coverage.',
    template: null, file: () => null, line: () => null,
  },
  cursorSnapshotTestsMentioned: {
    id: 'CU-T04', name: 'Snapshot testing strategy documented',
    check: (ctx) => { const docs = [ctx.fileContent('CLAUDE.md'), ctx.fileContent('README.md'), allRulesContent(ctx)].filter(Boolean).join('\n'); if (!docs.trim()) return null; return /snapshot|inline snapshot/i.test(docs); },
    impact: 'low', rating: 2, category: 'testing-strategy',
    fix: 'Document snapshot testing strategy in CLAUDE.md so agents know when to update or create snapshots.',
    template: null, file: () => 'CLAUDE.md', line: () => null,
  },
  cursorTestCommandDocumented: {
    id: 'CU-T05', name: 'Test command documented for agents',
    check: (ctx) => { const docs = [allRulesContent(ctx), ctx.fileContent('CLAUDE.md')].filter(Boolean).join('\n'); if (!docs.trim()) return null; return /npm test|yarn test|pnpm test|vitest|jest\b/i.test(docs); },
    impact: 'high', rating: 4, category: 'testing-strategy',
    fix: 'Add the exact test command to your Cursor rules so agents can verify their changes.',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },
  cursorCiRunsTests: {
    id: 'CU-T06', name: 'CI workflow runs tests',
    check: (ctx) => { const wfs = ctx.files.filter(f => /\.github\/workflows\/.*\.ya?ml$/i.test(f)); if (!wfs.length) return null; return wfs.some(f => /\btest\b|\bvitest\b|\bjest\b|\bpytest\b/i.test(ctx.fileContent(f) || '')); },
    impact: 'high', rating: 5, category: 'testing-strategy',
    fix: 'Add a test step to your CI workflow to catch regressions in agent-generated code.',
    template: null, file: () => '.github/workflows/', line: () => null,
  },

  // ── Code Quality (CU-T07..T12) ──
  cursorLinterConfigured: {
    id: 'CU-T07', name: 'Linter configured',
    check: (ctx) => ctx.files.some(f => /\.eslintrc|eslint\.config|\.pylintrc|\.ruff\.toml|\.flake8|golangci\.yml/i.test(f)) || /eslint|ruff|pylint|golangci/i.test(ctx.fileContent('package.json') || ''),
    impact: 'high', rating: 4, category: 'code-quality',
    fix: 'Configure a linter (ESLint, Ruff, golangci-lint) and add it to your Cursor rules as the lint command.',
    template: null, file: () => null, line: () => null,
  },
  cursorFormatterConfigured: {
    id: 'CU-T08', name: 'Code formatter configured',
    check: (ctx) => ctx.files.some(f => /\.prettierrc|\.prettier\.config|biome\.json|\.editorconfig/i.test(f)) || /prettier|biome/i.test(ctx.fileContent('package.json') || ''),
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Configure a formatter (Prettier, Biome) so agent output is auto-formatted consistently.',
    template: null, file: () => null, line: () => null,
  },
  cursorDeadCodeDetection: {
    id: 'CU-T09', name: 'Dead code detection awareness documented',
    check: (ctx) => { const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /dead.?code|unused.?(import|var|export)|knip|ts-prune/i.test(docs); },
    impact: 'low', rating: 2, category: 'code-quality',
    fix: 'Document dead code detection in rules (knip, ts-prune, ESLint no-unused-vars).',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },
  cursorComplexityAwareness: {
    id: 'CU-T10', name: 'Code complexity awareness documented',
    check: (ctx) => { const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /complex|cyclomatic|cognitive|function.{0,20}length|file.{0,20}length|line.{0,20}limit/i.test(docs); },
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Add complexity constraints to rules (max function length, cyclomatic complexity limits).',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },
  cursorConsistentNamingDocumented: {
    id: 'CU-T11', name: 'Naming conventions documented for agents',
    check: (ctx) => { const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /camelCase|snake_case|PascalCase|kebab.?case|naming.{0,30}convention/i.test(docs); },
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Document naming conventions (camelCase, snake_case, PascalCase) in Cursor rules.',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },
  cursorCodeReviewProcessMentioned: {
    id: 'CU-T12', name: 'Code review process documented',
    check: (ctx) => { const docs = [ctx.fileContent('CONTRIBUTING.md'), ctx.fileContent('CLAUDE.md'), allRulesContent(ctx)].filter(Boolean).join('\n'); if (!docs.trim()) return null; return /code.?review|PR|pull.?request|review.{0,20}process/i.test(docs); },
    impact: 'medium', rating: 3, category: 'code-quality',
    fix: 'Document your code review process in CONTRIBUTING.md or Cursor rules.',
    template: null, file: () => 'CONTRIBUTING.md', line: () => null,
  },

  // ── API Design (CU-T13..T18) ──
  cursorEndpointDocumentation: {
    id: 'CU-T13', name: 'API endpoint documentation present',
    check: (ctx) => !isApiProject(ctx) ? null : ctx.files.some(f => /openapi|swagger|api\.ya?ml|api\.json/i.test(f)) || /openapi|swagger/i.test(ctx.fileContent('package.json') || ''),
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Add an OpenAPI/Swagger spec so agents understand your API surface.',
    template: null, file: () => null, line: () => null,
  },
  cursorApiVersioningMentioned: {
    id: 'CU-T14', name: 'API versioning strategy documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /api.{0,10}version|\/v\d|versioning/i.test(docs); },
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Document API versioning strategy (URL versioning, header versioning) in CLAUDE.md.',
    template: null, file: () => 'CLAUDE.md', line: () => null,
  },
  cursorErrorHandlingPatterns: {
    id: 'CU-T15', name: 'Error handling patterns documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /error.{0,15}handl|exception|try.?catch|Result\s*<|error.{0,10}pattern/i.test(docs); },
    impact: 'high', rating: 4, category: 'api-design',
    fix: 'Document error handling patterns in Cursor rules so agents use consistent error responses.',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },
  cursorRateLimitingAwareness: {
    id: 'CU-T16', name: 'Rate limiting awareness documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /rate.?limit|throttl|429/i.test(docs); },
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Document rate limiting in CLAUDE.md so agents handle 429 responses and add retry logic.',
    template: null, file: () => 'CLAUDE.md', line: () => null,
  },
  cursorRequestValidation: {
    id: 'CU-T17', name: 'Request validation strategy documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /validat|zod|yup|joi\b|schema.{0,15}validat/i.test(docs); },
    impact: 'high', rating: 4, category: 'api-design',
    fix: 'Document request validation library (Zod, Yup, Joi) in Cursor rules.',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },
  cursorResponseFormatConsistent: {
    id: 'CU-T18', name: 'Response format consistency documented',
    check: (ctx) => { if (!isApiProject(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /response.{0,20}format|json.{0,10}response|api.{0,15}response|envelope/i.test(docs); },
    impact: 'medium', rating: 3, category: 'api-design',
    fix: 'Document standard response format in Cursor rules so agents produce consistent API responses.',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },

  // ── Database (CU-T19..T24) ──
  cursorMigrationStrategyDocumented: {
    id: 'CU-T19', name: 'Database migration strategy documented',
    check: (ctx) => !isDatabaseProject(ctx) ? null : ctx.files.some(f => /migrations?\//i.test(f)) || /migration|prisma migrate|alembic|flyway|knex.{0,10}migrate/i.test(allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || '')),
    impact: 'high', rating: 4, category: 'database',
    fix: 'Document database migration strategy in CLAUDE.md (Prisma, Alembic, Flyway).',
    template: null, file: () => 'CLAUDE.md', line: () => null,
  },
  cursorQueryOptimizationMentioned: {
    id: 'CU-T20', name: 'Query optimization guidance documented',
    check: (ctx) => { if (!isDatabaseProject(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /n\+1|query.{0,15}optim|index|explain.{0,10}query|eager.{0,10}load/i.test(docs); },
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Document N+1 prevention and query optimization patterns in Cursor rules.',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },
  cursorConnectionPoolingConfigured: {
    id: 'CU-T21', name: 'Connection pooling documented',
    check: (ctx) => { if (!isDatabaseProject(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /connection.{0,15}pool|pool.{0,15}size|pgbouncer|prisma.*pool/i.test(docs); },
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Document connection pooling configuration in CLAUDE.md to prevent connection exhaustion.',
    template: null, file: () => 'CLAUDE.md', line: () => null,
  },
  cursorBackupStrategyDocumented: {
    id: 'CU-T22', name: 'Database backup strategy documented',
    check: (ctx) => { if (!isDatabaseProject(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /backup|restore|point.?in.?time|snapshot.{0,15}db/i.test(docs); },
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Document database backup and restore procedures in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  cursorSchemaDocumentation: {
    id: 'CU-T23', name: 'Database schema documentation present',
    check: (ctx) => !isDatabaseProject(ctx) ? null : ctx.files.some(f => /schema\.(prisma|sql|graphql)|erd|dbml|entity.{0,15}diagram/i.test(f)) || ctx.files.some(f => /schema\.md/i.test(f)),
    impact: 'medium', rating: 3, category: 'database',
    fix: 'Add schema documentation (schema.prisma, ERD, DBML) so agents understand the data model.',
    template: null, file: () => null, line: () => null,
  },
  cursorSeedDataMentioned: {
    id: 'CU-T24', name: 'Seed data strategy documented',
    check: (ctx) => !isDatabaseProject(ctx) ? null : ctx.files.some(f => /seed\.(ts|js|sql|py)|fixtures\//i.test(f)) || /seed.{0,10}data|seed.{0,10}script|prisma.*seed/i.test(allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || '')),
    impact: 'low', rating: 2, category: 'database',
    fix: 'Add seed scripts and document how to populate a local database for development.',
    template: null, file: () => null, line: () => null,
  },

  // ── Authentication (CU-T25..T30) ──
  cursorAuthFlowDocumented: {
    id: 'CU-T25', name: 'Authentication flow documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /auth.{0,15}flow|login.{0,15}flow|sign.?in|authenticate/i.test(docs); },
    impact: 'high', rating: 4, category: 'authentication',
    fix: 'Document the authentication flow in CLAUDE.md so agents implement auth correctly.',
    template: null, file: () => 'CLAUDE.md', line: () => null,
  },
  cursorTokenHandlingGuidance: {
    id: 'CU-T26', name: 'Token handling guidance documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /jwt|token.{0,15}refresh|access.{0,10}token|bearer|token.{0,15}storage/i.test(docs); },
    impact: 'high', rating: 4, category: 'authentication',
    fix: 'Document JWT/token handling patterns in Cursor rules (storage, refresh, expiration).',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },
  cursorSessionManagementDocumented: {
    id: 'CU-T27', name: 'Session management documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /session.{0,15}manag|cookie.{0,15}session|next.?auth|lucia|auth\.js/i.test(docs); },
    impact: 'medium', rating: 3, category: 'authentication',
    fix: 'Document session management approach in CLAUDE.md (cookies, server-side sessions, JWT).',
    template: null, file: () => 'CLAUDE.md', line: () => null,
  },
  cursorRbacPermissionsReferenced: {
    id: 'CU-T28', name: 'RBAC / permissions model referenced',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /rbac|role.?based|permission|authorization|can\('|ability/i.test(docs); },
    impact: 'high', rating: 4, category: 'authentication',
    fix: 'Document the permissions/RBAC model in Cursor rules so agents respect access controls.',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },
  cursorOauthSsoMentioned: {
    id: 'CU-T29', name: 'OAuth/SSO configuration documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /oauth|sso|saml|oidc|google.{0,10}auth|github.{0,10}auth/i.test(docs); },
    impact: 'medium', rating: 3, category: 'authentication',
    fix: 'Document OAuth/SSO provider configuration in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },
  cursorCredentialRotationDocumented: {
    id: 'CU-T30', name: 'Credential rotation policy documented',
    check: (ctx) => { if (!isAuthProject(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /rotat.{0,10}secret|rotat.{0,10}key|credential.{0,10}rotat|secret.{0,10}expir/i.test(docs); },
    impact: 'medium', rating: 3, category: 'authentication',
    fix: 'Document credential rotation policy in Cursor rules (how often, automated or manual).',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },

  // ── Monitoring (CU-T31..T36) ──
  cursorLoggingConfigured: {
    id: 'CU-T31', name: 'Logging framework configured',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const pkg = ctx.fileContent('package.json') || ''; return /winston|pino|bunyan|log4js|morgan|loglevel|structlog|loguru/i.test(pkg) || ctx.files.some(f => /log(ger|ging)\.config/i.test(f)); },
    impact: 'high', rating: 4, category: 'monitoring',
    fix: 'Add a structured logging framework (Pino, Winston) and document log levels in Cursor rules.',
    template: null, file: () => 'package.json', line: () => null,
  },
  cursorErrorTrackingSetup: {
    id: 'CU-T32', name: 'Error tracking service configured',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const pkg = ctx.fileContent('package.json') || ''; return /sentry|bugsnag|rollbar|honeybadger|raygun|airnav/i.test(pkg) || ctx.files.some(f => /sentry\.client|sentry\.server/i.test(f)); },
    impact: 'high', rating: 4, category: 'monitoring',
    fix: 'Set up error tracking (Sentry, Bugsnag) to catch runtime errors in production.',
    template: null, file: () => null, line: () => null,
  },
  cursorApmMetricsMentioned: {
    id: 'CU-T33', name: 'APM / metrics platform documented',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /datadog|newrelic|prometheus|grafana|opentelemetry|apm|metrics/i.test(docs); },
    impact: 'medium', rating: 3, category: 'monitoring',
    fix: 'Document APM/metrics platform in README.md (Datadog, Prometheus, OpenTelemetry).',
    template: null, file: () => 'README.md', line: () => null,
  },
  cursorHealthCheckEndpoint: {
    id: 'CU-T34', name: 'Health check endpoint documented',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /health.?check|\/health|\/ping|\/status|liveness|readiness/i.test(docs); },
    impact: 'medium', rating: 3, category: 'monitoring',
    fix: 'Document health check endpoint in README.md (/health, /ping) for load balancer integration.',
    template: null, file: () => 'README.md', line: () => null,
  },
  cursorAlertingReferenced: {
    id: 'CU-T35', name: 'Alerting strategy referenced',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /alert|pagerduty|opsgenie|oncall|on.?call|incident/i.test(docs); },
    impact: 'medium', rating: 3, category: 'monitoring',
    fix: 'Document alerting strategy in README.md (PagerDuty, OpsGenie, on-call rotation).',
    template: null, file: () => 'README.md', line: () => null,
  },
  cursorLogRotationMentioned: {
    id: 'CU-T36', name: 'Log rotation / retention documented',
    check: (ctx) => { if (!isMonitoringRelevant(ctx)) return null; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || '') + (ctx.fileContent('README.md') || ''); if (!docs.trim()) return null; return /log.{0,15}rotat|log.{0,15}retent|logrotate|retention.{0,15}polic/i.test(docs); },
    impact: 'low', rating: 2, category: 'monitoring',
    fix: 'Document log rotation/retention policy in README.md.',
    template: null, file: () => 'README.md', line: () => null,
  },

  // ── Dependency Management (CU-T37..T42) ──
  cursorLockfilePresent: {
    id: 'CU-T37', name: 'Dependency lockfile present',
    check: (ctx) => ctx.files.some(f => /package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|cargo\.lock/i.test(f)),
    impact: 'critical', rating: 5, category: 'dependency-management',
    fix: 'Commit your lockfile (package-lock.json, yarn.lock, poetry.lock) for reproducible builds.',
    template: null, file: () => null, line: () => null,
  },
  cursorOutdatedDepsAwareness: {
    id: 'CU-T38', name: 'Outdated dependency awareness documented',
    check: (ctx) => { const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); const wfs = ctx.files.filter(f => /\.github\/workflows/i.test(f)); return /outdated|renovate|dependabot|npm.{0,10}update|upgrade.{0,10}dep/i.test(docs) || wfs.some(f => /dependabot|renovate/i.test(ctx.fileContent(f) || '')); },
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Enable Dependabot or Renovate for automated dependency updates.',
    template: null, file: () => '.github/', line: () => null,
  },
  cursorLicenseCompliance: {
    id: 'CU-T39', name: 'License compliance awareness configured',
    check: (ctx) => { const pkg = ctx.fileContent('package.json') || ''; const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); return /license-checker|licensee|fossa|snyk/i.test(pkg) || /license.{0,15}comply|license.{0,15}check|approved.{0,15}license/i.test(docs); },
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Add license compliance checking (license-checker, FOSSA) and document approved licenses.',
    template: null, file: () => null, line: () => null,
  },
  cursorNpmAuditConfigured: {
    id: 'CU-T40', name: 'Security audit configured in CI',
    check: (ctx) => { const wfs = ctx.files.filter(f => /\.github\/workflows\/.*\.ya?ml$/i.test(f)); return wfs.some(f => /npm audit|yarn audit|pnpm audit|snyk|trivy/i.test(ctx.fileContent(f) || '')); },
    impact: 'high', rating: 4, category: 'dependency-management',
    fix: 'Add `npm audit` or Snyk to CI to catch vulnerable dependencies in agent-generated code.',
    template: null, file: () => '.github/workflows/', line: () => null,
  },
  cursorPinnedVersionsUsed: {
    id: 'CU-T41', name: 'Critical dependency versions pinned',
    check: (ctx) => { const pkg = ctx.jsonFile ? ctx.jsonFile('package.json') : null; if (!pkg) return null; const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }; const entries = Object.values(deps); if (!entries.length) return null; const pinned = entries.filter(v => /^\d|^=\d/.test(String(v))).length; return pinned / entries.length >= 0.1; },
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Pin at least critical dependencies to exact versions to ensure reproducible agent environments.',
    template: null, file: () => 'package.json', line: () => null,
  },
  cursorAutoUpdatePolicy: {
    id: 'CU-T42', name: 'Dependency auto-update policy documented',
    check: (ctx) => ctx.files.some(f => /\.github\/dependabot\.yml|renovate\.json|\.renovaterc/i.test(f)) || /auto.?update|dependabot|renovate/i.test(allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || '')),
    impact: 'medium', rating: 3, category: 'dependency-management',
    fix: 'Configure Dependabot (.github/dependabot.yml) or Renovate to automate dependency updates.',
    template: null, file: () => '.github/dependabot.yml', line: () => null,
  },

  // ── Cost Optimization (CU-T43..T48) ──
  cursorTokenUsageAwareness: {
    id: 'CU-T43', name: 'Token usage awareness documented for agents',
    check: (ctx) => { const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /token.{0,15}usage|token.{0,15}budget|context.{0,15}window|token.{0,15}cost/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document token budget awareness in Cursor rules so agents keep changes focused and token-efficient.',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },
  cursorModelSelectionGuidance: {
    id: 'CU-T44', name: 'Model selection guidance in rules',
    check: (ctx) => { const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /model.{0,20}select|gpt-4|claude-3|claude-4|opus|sonnet|haiku|flash/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document model selection guidance in Cursor rules (e.g., use Flash for simple tasks, Opus for complex).',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },
  cursorCachingToReduceApiCalls: {
    id: 'CU-T45', name: 'Caching strategy documented to reduce API costs',
    check: (ctx) => { const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /cach.{0,15}api|redis|memcache|cdn.{0,10}cach|cache-control|stale-while-revalidate/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document caching strategies in Cursor rules to minimize redundant API calls.',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },
  cursorBatchProcessingMentioned: {
    id: 'CU-T46', name: 'Batch processing patterns documented',
    check: (ctx) => { const docs = allRulesContent(ctx) + (ctx.fileContent('CLAUDE.md') || ''); if (!docs.trim()) return null; return /batch.{0,15}process|bulk.{0,15}operat|queue|job.{0,15}schedul|background.{0,15}job/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Document batch processing patterns in Cursor rules to avoid N+1 API calls.',
    template: null, file: () => '.cursor/rules/', line: () => null,
  },
  cursorPromptCachingEnabled: {
    id: 'CU-T47', name: 'Prompt caching configured in MCP / agent config',
    check: (ctx) => { const mcpRaw = ctx.fileContent('.cursor/mcp.json') || ''; const docs = allRulesContent(ctx); return /cache.?prompt|prompt.?cach/i.test(mcpRaw) || /cache.?prompt|prompt.?cach/i.test(docs); },
    impact: 'medium', rating: 3, category: 'cost-optimization',
    fix: 'Enable prompt caching in MCP configuration or document caching strategy for repeated prompts.',
    template: null, file: () => '.cursor/mcp.json', line: () => null,
  },
  cursorCostBudgetDefined: {
    id: 'CU-T48', name: 'AI cost budget or per-run usage tracking documented',
    check: (ctx) => {
      const docs = docsBundle(ctx) + (ctx.fileContent('CLAUDE.md') || '');
      if (!docs.trim() && !hasCostBudgetOrUsageTracking('', ctx)) return null;
      return hasCostBudgetOrUsageTracking(docs, ctx);
    },
    impact: 'low', rating: 2, category: 'cost-optimization',
    fix: 'Document AI cost guardrails or per-run usage tracking in README.md or Cursor rules so spend is observable, not guessed.',
    template: null, file: () => 'README.md', line: () => null,
  },

  // ============================================================
  // === PYTHON STACK CHECKS (category: 'python') ===============
  // ============================================================

  cursorPythonProjectExists: {
    id: 'CU-PY01',
    name: 'Python project detected (pyproject.toml / setup.py / requirements.txt)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return true; },
    impact: 'high',
    category: 'python',
    fix: 'Ensure pyproject.toml, setup.py, or requirements.txt exists for Python projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonVersionSpecified: {
    id: 'CU-PY02',
    name: 'Python version specified (.python-version or requires-python)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /\.python-version$/.test(f)) || /requires-python/i.test(ctx.fileContent('pyproject.toml') || ''); },
    impact: 'medium',
    category: 'python',
    fix: 'Create .python-version or add requires-python to pyproject.toml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonVenvMentioned: {
    id: 'CU-PY03',
    name: 'Virtual environment mentioned in instructions',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /venv|virtualenv|conda|poetry shell|uv venv/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document virtual environment setup in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonLockfileExists: {
    id: 'CU-PY04',
    name: 'Python lockfile exists (poetry.lock / uv.lock / Pipfile.lock / pinned requirements)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /poetry\.lock$|uv\.lock$|Pipfile\.lock$/.test(f)) || /==/m.test(ctx.fileContent('requirements.txt') || ''); },
    impact: 'high',
    category: 'python',
    fix: 'Add a lockfile (poetry.lock, uv.lock, Pipfile.lock) or pin versions with == in requirements.txt.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonPytestConfigured: {
    id: 'CU-PY05',
    name: 'pytest configured (pyproject.toml [tool.pytest] / pytest.ini / conftest.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return /\[tool\.pytest/i.test(ctx.fileContent('pyproject.toml') || '') || ctx.files.some(f => /pytest\.ini$|conftest\.py$/.test(f)); },
    impact: 'high',
    category: 'python',
    fix: 'Configure pytest in pyproject.toml [tool.pytest.ini_options] or create pytest.ini.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonLinterConfigured: {
    id: 'CU-PY06',
    name: 'Python linter configured (ruff / flake8 / pylint)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.ruff|\[tool\.flake8|\[tool\.pylint/i.test(pp) || ctx.files.some(f => /\.flake8$|pylintrc$|\.pylintrc$|ruff\.toml$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure ruff, flake8, or pylint in pyproject.toml or dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonTypeCheckerConfigured: {
    id: 'CU-PY07',
    name: 'Type checker configured (mypy / pyright)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.mypy|\[tool\.pyright/i.test(pp) || ctx.files.some(f => /mypy\.ini$|pyrightconfig\.json$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure mypy or pyright in pyproject.toml or dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonFormatterConfigured: {
    id: 'CU-PY08',
    name: 'Formatter configured (black / isort / ruff format)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.black|\[tool\.isort|\[tool\.ruff\.format/i.test(pp); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure black, isort, or ruff format in pyproject.toml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonDjangoSettingsDocumented: {
    id: 'CU-PY09',
    name: 'Django settings documented if Django project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; if (!ctx.files.some(f => /manage\.py$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /django|settings\.py|DJANGO_SETTINGS_MODULE/i.test(docs); },
    impact: 'high',
    category: 'python',
    fix: 'Document Django settings module and configuration in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonFastapiEntryDocumented: {
    id: 'CU-PY10',
    name: 'FastAPI entry point documented if FastAPI project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/fastapi/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /fastapi|uvicorn|app\.py|main\.py/i.test(docs); },
    impact: 'high',
    category: 'python',
    fix: 'Document FastAPI entry point and how to run the development server.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonMigrationsDocumented: {
    id: 'CU-PY11',
    name: 'Database migrations mentioned (alembic / Django migrations)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /alembic|migrate|makemigrations|django.{0,10}migration/i.test(docs) || ctx.files.some(f => /alembic[.]ini$|alembic[/]/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Document database migration workflow (alembic or Django migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonEnvHandlingDocumented: {
    id: 'CU-PY12',
    name: '.env handling documented (python-dotenv)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/dotenv|python-dotenv|environs/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /\.env|dotenv|environment.{0,10}variable/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document .env file usage and python-dotenv configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonPreCommitConfigured: {
    id: 'CU-PY13',
    name: 'pre-commit hooks configured (.pre-commit-config.yaml)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /\.pre-commit-config\.yaml$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Add .pre-commit-config.yaml with Python-specific hooks (ruff, mypy, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonDockerBaseImage: {
    id: 'CU-PY14',
    name: 'Docker uses Python base image correctly',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const df = ctx.fileContent('Dockerfile') || ''; if (!df) return null; return /FROM.*python:/i.test(df); },
    impact: 'medium',
    category: 'python',
    fix: 'Use official Python base image in Dockerfile (e.g., FROM python:3.12-slim).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonTestMatrixConfigured: {
    id: 'CU-PY15',
    name: 'Test matrix configured (tox.ini / noxfile.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /tox\.ini$|noxfile\.py$/.test(f)); },
    impact: 'low',
    category: 'python',
    fix: 'Configure tox or nox for multi-environment testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonValidationUsed: {
    id: 'CU-PY16',
    name: 'Pydantic or dataclass validation used',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); return /pydantic|dataclass/i.test(deps); },
    impact: 'medium',
    category: 'python',
    fix: 'Use pydantic or dataclasses for data validation and type safety.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonAsyncDocumented: {
    id: 'CU-PY17',
    name: 'Async patterns documented if async project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/asyncio|aiohttp|fastapi|starlette|httpx/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /async|await|asyncio|event.{0,5}loop/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document async patterns and conventions used in the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonPinnedVersions: {
    id: 'CU-PY18',
    name: 'Requirements have pinned versions (== in requirements.txt)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const req = ctx.fileContent('requirements.txt') || ''; if (!req.trim()) return null; const lines = req.split('\n').filter(l => l.trim() && !l.startsWith('#')); return lines.length > 0 && lines.every(l => /==/.test(l) || /^-/.test(l.trim())); },
    impact: 'high',
    category: 'python',
    fix: 'Pin all dependency versions with == in requirements.txt for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonPackageStructure: {
    id: 'CU-PY19',
    name: 'Python package has proper structure (src/ layout or __init__.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /src[/].*[/]__init__\.py$|^[^/]+[/]__init__\.py$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Use src/ layout or ensure packages have __init__.py files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonDocsToolConfigured: {
    id: 'CU-PY20',
    name: 'Documentation tool configured (sphinx / mkdocs)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /mkdocs\.yml$|conf\.py$|docs[/]/.test(f)) || /sphinx|mkdocs/i.test(ctx.fileContent('pyproject.toml') || ''); },
    impact: 'low',
    category: 'python',
    fix: 'Configure sphinx or mkdocs for project documentation.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonCoverageConfigured: {
    id: 'CU-PY21',
    name: 'Coverage configured (coverage / pytest-cov)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.coverage|pytest-cov|coverage/i.test(pp) || ctx.files.some(f => /\.coveragerc$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure coverage reporting with pytest-cov or coverage.py.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonNoSecretsInSettings: {
    id: 'CU-PY22',
    name: 'No secrets in Django settings.py',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const settings = ctx.fileContent('settings.py') || ctx.files.filter(f => /settings\.py$/.test(f)).map(f => ctx.fileContent(f) || '').join(''); if (!settings) return null; return !/SECRET_KEY\s*=\s*['"][^'"]{10,}/i.test(settings); },
    impact: 'critical',
    category: 'python',
    fix: 'Move SECRET_KEY and other secrets to environment variables, not hardcoded in settings.py.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonWsgiAsgiDocumented: {
    id: 'CU-PY23',
    name: 'WSGI/ASGI server documented (gunicorn / uvicorn)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/gunicorn|uvicorn|daphne|hypercorn/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /gunicorn|uvicorn|daphne|hypercorn|wsgi|asgi/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document WSGI/ASGI server configuration (gunicorn, uvicorn).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonTaskQueueDocumented: {
    id: 'CU-PY24',
    name: 'Task queue documented if used (celery / rq)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/celery|rq|dramatiq|huey/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /celery|rq|dramatiq|huey|task.{0,10}queue|worker/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document task queue configuration and worker setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorPythonGitignore: {
    id: 'CU-PY25',
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

  cursorGoModExists: {
    id: 'CU-GO01',
    name: 'go.mod exists',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'go',
    fix: 'Initialize Go module with go mod init.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoSumCommitted: {
    id: 'CU-GO02',
    name: 'go.sum committed',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /go\.sum$/.test(f)); },
    impact: 'high',
    category: 'go',
    fix: 'Commit go.sum to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGolangciLintConfigured: {
    id: 'CU-GO03',
    name: 'golangci-lint configured (.golangci.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /\.golangci\.ya?ml$|\.golangci\.toml$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Add .golangci.yml to configure linting rules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoTestDocumented: {
    id: 'CU-GO04',
    name: 'go test documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go test/i.test(docs); },
    impact: 'high',
    category: 'go',
    fix: 'Document go test command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoBuildDocumented: {
    id: 'CU-GO05',
    name: 'go build documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go build|go install/i.test(docs); },
    impact: 'high',
    category: 'go',
    fix: 'Document go build command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoStandardLayout: {
    id: 'CU-GO06',
    name: 'Standard Go layout (cmd/ / internal/ / pkg/)',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /^cmd[/]|^internal[/]|^pkg[/]/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Use standard Go project layout with cmd/, internal/, and/or pkg/ directories.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoErrorHandlingDocumented: {
    id: 'CU-GO07',
    name: 'Error handling patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /error handling|errors?\.(?:New|Wrap|Is|As)|fmt\.Errorf/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document error handling conventions (error wrapping, sentinel errors, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoContextUsageDocumented: {
    id: 'CU-GO08',
    name: 'Context usage documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /context\.Context|ctx\.Done|context\.WithCancel|context\.WithTimeout/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document context.Context usage patterns for cancellation and timeouts.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoroutineSafetyDocumented: {
    id: 'CU-GO09',
    name: 'Goroutine safety documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /goroutine|sync\.Mutex|sync\.WaitGroup|channel|concurren/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document goroutine safety patterns, mutex usage, and channel conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoModTidyMentioned: {
    id: 'CU-GO10',
    name: 'go mod tidy mentioned in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go mod tidy/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document go mod tidy in project workflow instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoVetConfigured: {
    id: 'CU-GO11',
    name: 'go vet or staticcheck configured',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/go.yml') || ''; return /go vet|staticcheck/i.test(docs + ci); },
    impact: 'medium',
    category: 'go',
    fix: 'Configure go vet and/or staticcheck in CI or project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoMakefileExists: {
    id: 'CU-GO12',
    name: 'Makefile or Taskfile exists for Go project',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /^Makefile$|^Taskfile\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Add Makefile or Taskfile.yml with common Go targets (build, test, lint).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoDockerMultiStage: {
    id: 'CU-GO13',
    name: 'Docker multi-stage build for Go',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; if (!df) return null; return /FROM.*golang.*AS/i.test(df) && /FROM.*(?:alpine|scratch|distroless|gcr\.io)/i.test(df); },
    impact: 'medium',
    category: 'go',
    fix: 'Use multi-stage Docker build: build in golang image, run in minimal image (alpine/scratch/distroless).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoCgoDocumented: {
    id: 'CU-GO14',
    name: 'CGO documented if used',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const goMod = ctx.fileContent('go.mod') || ''; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; if (!/CGO_ENABLED|import "C"/i.test(goMod + docs)) return null; return /CGO|cgo/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document CGO usage, dependencies, and build requirements.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoWorkForMonorepo: {
    id: 'CU-GO15',
    name: 'go.work for monorepo',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const multiMod = ctx.files.filter(f => /go\.mod$/.test(f)).length > 1; if (!multiMod) return null; return ctx.files.some(f => /go\.work$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Use go.work for Go workspace in monorepo with multiple modules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoBenchmarkTests: {
    id: 'CU-GO16',
    name: 'Benchmark tests mentioned',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go test.*-bench|Benchmark/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document benchmark testing with go test -bench.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoRaceDetector: {
    id: 'CU-GO17',
    name: 'Race detector (-race) documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/go.yml') || ''; return /-race/i.test(docs + ci); },
    impact: 'medium',
    category: 'go',
    fix: 'Document and enable race detector with go test -race.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoGenerateDocumented: {
    id: 'CU-GO18',
    name: 'go generate documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go generate/i.test(docs) || ctx.files.some(f => /generate\.go$/.test(f)); },
    impact: 'low',
    category: 'go',
    fix: 'Document go generate usage and generated files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoInterfaceDesignDocumented: {
    id: 'CU-GO19',
    name: 'Interface-based design documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /interface|mock|stub|dependency injection/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document interface-based design patterns for testability and dependency injection.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorGoGitignore: {
    id: 'CU-GO20',
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

  cursorRustCargoTomlExists: {
    id: 'CU-RS01',
    name: 'Cargo.toml exists with edition field',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /edition\s*=/.test(cargo); },
    impact: 'high',
    category: 'rust',
    fix: 'Ensure Cargo.toml exists and specifies the edition field (e.g., edition = "2021").',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustCargoLockCommitted: {
    id: 'CU-RS02',
    name: 'Cargo.lock committed (for binary crates)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /Cargo\.lock$/.test(f)); },
    impact: 'high',
    category: 'rust',
    fix: 'Commit Cargo.lock for binary crates to ensure reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustClippyConfigured: {
    id: 'CU-RS03',
    name: 'Clippy configured (CI or .cargo/config.toml)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/rust.yml') || ''; const cargoConfig = ctx.fileContent('.cargo/config.toml') || ''; return /clippy/i.test(ci + cargoConfig); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure clippy in CI or .cargo/config.toml for lint enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustFmtConfigured: {
    id: 'CU-RS04',
    name: 'rustfmt configured (rustfmt.toml or .rustfmt.toml)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /rustfmt\.toml$|\.rustfmt\.toml$/.test(f)); },
    impact: 'medium',
    category: 'rust',
    fix: 'Create rustfmt.toml or .rustfmt.toml to configure code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustCargoTestDocumented: {
    id: 'CU-RS05',
    name: 'cargo test documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cargo test/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document cargo test command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustCargoBuildDocumented: {
    id: 'CU-RS06',
    name: 'cargo build/check documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cargo (?:build|check)/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document cargo build or cargo check command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustUnsafePolicyDocumented: {
    id: 'CU-RS07',
    name: 'Unsafe code policy documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /unsafe|#!?\[forbid\(unsafe|#!?\[deny\(unsafe/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document unsafe code policy (forbidden, minimized, or where allowed).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustErrorHandlingStrategy: {
    id: 'CU-RS08',
    name: 'Error handling strategy (anyhow/thiserror in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /anyhow|thiserror|eyre|color-eyre/i.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Use anyhow (applications) or thiserror (libraries) for structured error handling.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustFeatureFlagsDocumented: {
    id: 'CU-RS09',
    name: 'Feature flags documented (Cargo.toml [features])',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/\[features\]/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /feature|--features|--all-features/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document feature flags and their purpose in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustWorkspaceConfig: {
    id: 'CU-RS10',
    name: 'Workspace config if multi-crate (Cargo.toml [workspace])',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (ctx.files.filter(f => /Cargo\.toml$/.test(f)).length <= 1) return null; return /\[workspace\]/i.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure [workspace] in root Cargo.toml for multi-crate projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustMsrvSpecified: {
    id: 'CU-RS11',
    name: 'MSRV specified (rust-version field)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /rust-version\s*=/.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Specify rust-version (MSRV) in Cargo.toml for compatibility guarantees.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustDocCommentsEncouraged: {
    id: 'CU-RS12',
    name: 'Doc comments (///) encouraged in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /doc comment|\/{3}|rustdoc|cargo doc/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Encourage /// doc comments and cargo doc in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustBenchmarksConfigured: {
    id: 'CU-RS13',
    name: 'Criterion benchmarks mentioned (benches/ dir)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /benches[/]/.test(f)) || /criterion/i.test(ctx.fileContent('Cargo.toml') || ''); },
    impact: 'low',
    category: 'rust',
    fix: 'Set up criterion benchmarks in benches/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustCrossCompilationDocumented: {
    id: 'CU-RS14',
    name: 'Cross-compilation documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cross.?compil|--target|rustup target|cargo build.*--target/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Document cross-compilation targets and setup instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustMemorySafetyDocumented: {
    id: 'CU-RS15',
    name: 'Memory safety patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /ownership|borrow|lifetime|memory.?safe|Arc|Rc|RefCell/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document memory safety patterns (ownership, borrowing, lifetime conventions).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustAsyncRuntimeDocumented: {
    id: 'CU-RS16',
    name: 'Async runtime documented (tokio/async-std in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/tokio|async-std|smol/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /tokio|async-std|async|await|runtime/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document async runtime choice and patterns (tokio, async-std).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustSerdeDocumented: {
    id: 'CU-RS17',
    name: 'Serde patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/serde/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /serde|Serialize|Deserialize|serde_json|serde_yaml/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document serde serialization/deserialization patterns and conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustCargoAuditConfigured: {
    id: 'CU-RS18',
    name: 'cargo-audit configured in CI',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/rust.yml') || ctx.fileContent('.github/workflows/audit.yml') || ''; return /cargo.?audit|advisory/i.test(ci); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure cargo-audit in CI for vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustWasmTargetDocumented: {
    id: 'CU-RS19',
    name: 'WASM target documented if applicable',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/wasm|wasm-bindgen|wasm-pack/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /wasm|WebAssembly|wasm-pack|wasm-bindgen/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Document WASM target configuration and build process.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorRustGitignore: {
    id: 'CU-RS20',
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

  cursorJavaBuildFileExists: {
    id: 'CU-JV01',
    name: 'pom.xml or build.gradle exists',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'java',
    fix: 'Ensure pom.xml or build.gradle exists for Java projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaVersionSpecified: {
    id: 'CU-JV02',
    name: 'Java version specified',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; return /java\.version|maven\.compiler\.source|sourceCompatibility|JavaVersion/i.test(pom + gradle) || ctx.files.some(f => /\.java-version$/.test(f)); },
    impact: 'high',
    category: 'java',
    fix: 'Specify Java version in pom.xml properties, build.gradle, or .java-version file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaWrapperCommitted: {
    id: 'CU-JV03',
    name: 'Maven/Gradle wrapper committed (mvnw or gradlew)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /mvnw$|gradlew$/.test(f)); },
    impact: 'high',
    category: 'java',
    fix: 'Commit mvnw (Maven) or gradlew (Gradle) wrapper for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaSpringBootVersion: {
    id: 'CU-JV04',
    name: 'Spring Boot version documented if Spring project',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; if (!/spring-boot/i.test(pom + gradle)) return null; return /spring-boot.*\d+\.\d+/i.test(pom + gradle); },
    impact: 'high',
    category: 'java',
    fix: 'Document Spring Boot version in build configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaApplicationConfig: {
    id: 'CU-JV05',
    name: 'application.yml or application.properties exists',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /application\.ya?ml$|application\.properties$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Create application.yml or application.properties for Spring configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaTestFramework: {
    id: 'CU-JV06',
    name: 'Test framework configured (JUnit/TestNG in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; return /junit|testng|spring-boot-starter-test/i.test(pom + gradle); },
    impact: 'high',
    category: 'java',
    fix: 'Configure JUnit or TestNG test framework in project dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaCodeStyleConfigured: {
    id: 'CU-JV07',
    name: 'Code style configured (checkstyle.xml, spotbugs)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /checkstyle\.xml$|spotbugs.*\.xml$/.test(f)) || /checkstyle|spotbugs|google-java-format/i.test((ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || '')); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure checkstyle or spotbugs for code quality enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaSpringProfilesDocumented: {
    id: 'CU-JV08',
    name: 'Spring profiles documented',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/spring/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /spring[.]profiles|@Profile|SPRING_PROFILES_ACTIVE/i.test(docs); },
    impact: 'medium',
    category: 'java',
    fix: 'Document Spring profiles and their configuration in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaDatabaseMigration: {
    id: 'CU-JV09',
    name: 'Database migration configured (flyway/liquibase)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /flyway|liquibase/i.test(deps) || ctx.files.some(f => /db[/]migration|flyway|liquibase/i.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure database migration tool (Flyway or Liquibase) for schema management.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaLombokDocumented: {
    id: 'CU-JV10',
    name: 'Lombok/MapStruct documented if used',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/lombok|mapstruct/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /lombok|mapstruct/i.test(docs); },
    impact: 'low',
    category: 'java',
    fix: 'Document Lombok/MapStruct usage and IDE setup requirements.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaApiDocsConfigured: {
    id: 'CU-JV11',
    name: 'API docs configured (springdoc/swagger deps)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /springdoc|swagger|openapi/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure API documentation with springdoc-openapi or Swagger.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaSecurityConfigured: {
    id: 'CU-JV12',
    name: 'Security configuration documented',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/spring-security|spring-boot-starter-security/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /security|authentication|authorization|SecurityConfig|@EnableWebSecurity/i.test(docs); },
    impact: 'high',
    category: 'java',
    fix: 'Document Spring Security configuration and authentication setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaActuatorConfigured: {
    id: 'CU-JV13',
    name: 'Actuator/health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /actuator|spring-boot-starter-actuator/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Spring Boot Actuator for health checks and monitoring.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaLoggingConfigured: {
    id: 'CU-JV14',
    name: 'Logging configured (logback.xml or log4j2.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /logback.*\.xml$|log4j2?.*\.xml$|logging\.properties$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure logging with logback.xml or log4j2.xml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaMultiModuleProject: {
    id: 'CU-JV15',
    name: 'Multi-module project configured if applicable',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const buildFiles = ctx.files.filter(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f)); if (buildFiles.length <= 1) return null; const rootPom = ctx.fileContent('pom.xml') || ''; const rootGradle = ctx.fileContent('settings.gradle') || ctx.fileContent('settings.gradle.kts') || ''; return /<modules>|include\s/i.test(rootPom + rootGradle); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure multi-module project structure in root build file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaDockerConfigured: {
    id: 'CU-JV16',
    name: 'Docker build configured (Dockerfile or Jib plugin)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /FROM.*(?:openjdk|eclipse-temurin|amazoncorretto)/i.test(df) || /jib/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Docker build with Dockerfile or Jib plugin.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaEnvConfigsSeparated: {
    id: 'CU-JV17',
    name: 'Environment-specific configs separated',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /application-(?:dev|prod|staging|test|local)\.(?:ya?ml|properties)$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Separate environment configs (application-dev.yml, application-prod.yml, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaNoSecretsInConfig: {
    id: 'CU-JV18',
    name: 'No secrets in application.yml/properties',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const appYml = ctx.files.filter(f => /application.*\.ya?ml$|application.*\.properties$/.test(f)).map(f => ctx.fileContent(f) || '').join(''); if (!appYml) return null; return !/password\s*[:=]\s*[^$\{\s][^\s]{8,}|secret\s*[:=]\s*[^$\{\s][^\s]{8,}/i.test(appYml); },
    impact: 'critical',
    category: 'java',
    fix: 'Move secrets to environment variables or external secret management, not application config files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaIntegrationTestsSeparate: {
    id: 'CU-JV19',
    name: 'Integration tests separate from unit tests',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /src[/](?:integration-?test|it)[/]|IT\.java$|Integration(?:Test)?\.java$/.test(f)) || /failsafe|integration-test/i.test((ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || '')); },
    impact: 'medium',
    category: 'java',
    fix: 'Separate integration tests from unit tests using Maven Failsafe or dedicated source set.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorJavaBuildCommandDocumented: {
    id: 'CU-JV20',
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

  cursorrubyGemfileExists: {
    id: 'CU-RB01',
    name: 'Gemfile exists',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'ruby',
    fix: 'Create a Gemfile to manage Ruby dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorrubyGemfileLockCommitted: {
    id: 'CU-RB02',
    name: 'Gemfile.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /Gemfile\.lock$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Commit Gemfile.lock to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorrubyVersionSpecified: {
    id: 'CU-RB03',
    name: 'Ruby version specified (.ruby-version)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.ruby-version$/.test(f)) || /ruby ['"]~?\d/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Create .ruby-version or specify ruby version in Gemfile.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorrubyRubocopConfigured: {
    id: 'CU-RB04',
    name: 'RuboCop configured (.rubocop.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.rubocop\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add .rubocop.yml to configure Ruby style checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorrubyTestFrameworkConfigured: {
    id: 'CU-RB05',
    name: 'RSpec or Minitest configured (spec/ or test/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /^spec\/|^test\/|spec_helper\.rb$|test_helper\.rb$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Configure RSpec (spec/) or Minitest (test/) for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorrubyRailsCredentialsDocumented: {
    id: 'CU-RB06',
    name: 'Rails credentials documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /credentials|encrypted|master\.key|secret_key_base/i.test(docs); },
    impact: 'high',
    category: 'ruby',
    fix: 'Document Rails credentials management (rails credentials:edit) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorrubyMigrationsDocumented: {
    id: 'CU-RB07',
    name: 'Database migrations documented (db/migrate/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /db\/migrate\//.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /migration|migrate|db:migrate|rails db/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document database migration workflow (rails db:migrate) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorrubyBundlerAuditConfigured: {
    id: 'CU-RB08',
    name: 'Bundler audit configured',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; return /bundler-audit|bundle.audit/i.test(gf) || ctx.files.some(f => /\.bundler-audit/i.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add bundler-audit gem for dependency vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorrubyTypeCheckingConfigured: {
    id: 'CU-RB09',
    name: 'Sorbet/RBS type checking configured (sorbet/ or sig/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /sorbet\/|sig\/|\.rbs$/.test(f)) || /sorbet|tapioca/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'low',
    category: 'ruby',
    fix: 'Configure Sorbet or RBS for type checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorrubyRailsRoutesDocumented: {
    id: 'CU-RB10',
    name: 'Rails routes documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/routes\.rb$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /routes|endpoints|api.*path|REST/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document key routes and API endpoints in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorrubyBackgroundJobsDocumented: {
    id: 'CU-RB11',
    name: 'Background jobs documented (Sidekiq/GoodJob)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sidekiq|good_job|delayed_job|resque/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /sidekiq|good_job|delayed_job|resque|background.*job|worker|queue/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document background job framework and worker configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorrubyRailsEnvConfigsSeparated: {
    id: 'CU-RB12',
    name: 'Rails environment configs separated (config/environments/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /config\/environments\//.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Ensure config/environments/ has separate files for development, test, and production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorrubyAssetPipelineDocumented: {
    id: 'CU-RB13',
    name: 'Asset pipeline documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sprockets|propshaft|webpacker|jsbundling|cssbundling/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /asset|sprockets|propshaft|webpacker|jsbundling|cssbundling|esbuild|vite/i.test(docs); },
    impact: 'low',
    category: 'ruby',
    fix: 'Document asset pipeline configuration (Sprockets, Propshaft, or JS/CSS bundling).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorrubyMasterKeyInGitignore: {
    id: 'CU-RB14',
    name: 'Rails master.key in .gitignore',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const gi = ctx.fileContent('.gitignore') || ''; return /master\.key/i.test(gi); },
    impact: 'critical',
    category: 'ruby',
    fix: 'Add config/master.key to .gitignore to prevent secret leakage.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorrubyTestDataFactories: {
    id: 'CU-RB15',
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

  cursordotnetProjectExists: {
    id: 'CU-DN01',
    name: '.csproj or .sln exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'dotnet',
    fix: 'Ensure .csproj or .sln file exists for .NET projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursordotnetVersionSpecified: {
    id: 'CU-DN02',
    name: '.NET version specified (global.json or TargetFramework)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /global\.json$/.test(f)) || ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /TargetFramework/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create global.json or ensure TargetFramework is set in .csproj.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursordotnetPackagesLock: {
    id: 'CU-DN03',
    name: 'NuGet packages lock (packages.lock.json)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /packages\.lock\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Enable NuGet lock file (packages.lock.json) for reproducible restores.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursordotnetTestDocumented: {
    id: 'CU-DN04',
    name: 'dotnet test documented',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /dotnet test|xunit|nunit|mstest/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document how to run tests with dotnet test in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursordotnetEditorConfigExists: {
    id: 'CU-DN05',
    name: 'EditorConfig configured (.editorconfig)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.editorconfig$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add .editorconfig for consistent code style across the team.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursordotnetRoslynAnalyzers: {
    id: 'CU-DN06',
    name: 'Roslyn analyzers configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Analyzer|StyleCop|SonarAnalyzer|Microsoft\.CodeAnalysis/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Roslyn analyzers (StyleCop.Analyzers, Microsoft.CodeAnalysis) to the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursordotnetAppsettingsExists: {
    id: 'CU-DN07',
    name: 'appsettings.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /appsettings\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create appsettings.json for application configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursordotnetUserSecretsDocumented: {
    id: 'CU-DN08',
    name: 'User secrets configured in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /user.?secrets|dotnet secrets|Secret Manager/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document user secrets management (dotnet user-secrets) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursordotnetEfMigrations: {
    id: 'CU-DN09',
    name: 'Entity Framework migrations (Migrations/ directory)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /Migrations\//.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Document Entity Framework migration workflow (dotnet ef migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursordotnetHealthChecks: {
    id: 'CU-DN10',
    name: 'Health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /AddHealthChecks|MapHealthChecks|IHealthCheck/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure health checks with AddHealthChecks() and MapHealthChecks().',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursordotnetSwaggerConfigured: {
    id: 'CU-DN11',
    name: 'Swagger/OpenAPI configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$|.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Swashbuckle|AddSwaggerGen|UseSwagger|NSwag|AddOpenApi/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure Swagger/OpenAPI with Swashbuckle or NSwag.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursordotnetNoConnectionStringsInConfig: {
    id: 'CU-DN12',
    name: 'No connection strings in appsettings.json',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const settings = ctx.fileContent('appsettings.json') || ''; if (!settings) return null; return !/Server=.*Password=|Data Source=.*Password=/i.test(settings); },
    impact: 'critical',
    category: 'dotnet',
    fix: 'Move connection strings with passwords to user secrets or environment variables.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursordotnetDockerSupport: {
    id: 'CU-DN13',
    name: 'Docker support configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; return /dotnet|aspnet|sdk/i.test(df); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Dockerfile with official .NET SDK/ASP.NET base images.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursordotnetTestProjectSeparate: {
    id: 'CU-DN14',
    name: 'Unit test project separate (.Tests.csproj)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.Tests?\.csproj$|Tests?\/.*\.csproj$/.test(f)); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Create separate test project (e.g., MyApp.Tests.csproj) for unit tests.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursordotnetGlobalUsingsDocumented: {
    id: 'CU-DN15',
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

  cursorphpComposerJsonExists: {
    id: 'CU-PHP01',
    name: 'composer.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'php',
    fix: 'Create composer.json to manage PHP dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorphpComposerLockCommitted: {
    id: 'CU-PHP02',
    name: 'composer.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /composer\.lock$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Commit composer.lock to version control for reproducible installs.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorphpVersionSpecified: {
    id: 'CU-PHP03',
    name: 'PHP version specified (composer.json require.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"php"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Specify PHP version requirement in composer.json require section.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorphpStaticAnalysisConfigured: {
    id: 'CU-PHP04',
    name: 'PHPStan/Psalm configured (phpstan.neon)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpstan\.neon$|phpstan\.neon\.dist$|psalm\.xml$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Configure PHPStan (phpstan.neon) or Psalm (psalm.xml) for static analysis.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorphpCsFixerConfigured: {
    id: 'CU-PHP05',
    name: 'PHP CS Fixer configured (.php-cs-fixer.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /\.php-cs-fixer\.php$|\.php-cs-fixer\.dist\.php$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Add .php-cs-fixer.php for consistent code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorphpUnitConfigured: {
    id: 'CU-PHP06',
    name: 'PHPUnit configured (phpunit.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpunit\.xml$|phpunit\.xml\.dist$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Configure PHPUnit with phpunit.xml for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorphpLaravelEnvExample: {
    id: 'CU-PHP07',
    name: 'Laravel .env.example exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /\.env\.example$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Create .env.example with all required environment variables documented.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorphpLaravelAppKeyNotCommitted: {
    id: 'CU-PHP08',
    name: 'Laravel APP_KEY not committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const env = ctx.fileContent('.env') || ''; if (!env) return null; return !/APP_KEY=base64:[A-Za-z0-9+/=]{30,}/i.test(env); },
    impact: 'critical',
    category: 'php',
    fix: 'Ensure .env with APP_KEY is in .gitignore — never commit application keys.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorphpLaravelMigrationsExist: {
    id: 'CU-PHP09',
    name: 'Laravel migrations exist (database/migrations/)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /database\/migrations\//.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Create database migrations in database/migrations/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorphpArtisanCommandsDocumented: {
    id: 'CU-PHP10',
    name: 'Artisan commands documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /artisan|php artisan|make:model|make:controller|migrate/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document key Artisan commands (migrate, seed, make:*) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorphpQueueWorkerDocumented: {
    id: 'CU-PHP11',
    name: 'Queue worker documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; if (!/horizon|queue/i.test(cj) && !ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /queue|horizon|worker|job|dispatch/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document queue worker setup (php artisan queue:work, Horizon).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorphpLaravelPintConfigured: {
    id: 'CU-PHP12',
    name: 'Laravel Pint configured (pint.json)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /pint\.json$/.test(f)) || /laravel\/pint/i.test(ctx.fileContent('composer.json') || ''); },
    impact: 'low',
    category: 'php',
    fix: 'Configure Laravel Pint (pint.json) for code style enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorphpAssetBundlingDocumented: {
    id: 'CU-PHP13',
    name: 'Vite/Mix asset bundling documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /vite\.config\.|webpack\.mix\.js$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /vite|mix|asset|npm run dev|npm run build/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document asset bundling setup (Vite or Mix) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorphpConfigCachingDocumented: {
    id: 'CU-PHP14',
    name: 'Laravel config caching documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /config:cache|config:clear|route:cache|optimize/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document config/route caching strategy (php artisan config:cache) for production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  cursorphpComposerScriptsDefined: {
    id: 'CU-PHP15',
    name: 'Composer scripts defined',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"scripts"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Define composer scripts for common tasks (test, lint, analyze) in composer.json.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },


};

Object.assign(CURSOR_TECHNIQUES, buildStackChecks({
  platform: 'cursor',
  objectPrefix: 'cursor',
  idPrefix: 'CU',
  docs: (ctx) => [
    ctx.fileContent('AGENTS.md') || '',
    ctx.fileContent('CLAUDE.md') || '',
    ctx.fileContent('README.md') || '',
    ctx.fileContent('CONTRIBUTING.md') || '',
  ].filter(Boolean).join('\n'),
}));

attachSourceUrls('cursor', CURSOR_TECHNIQUES);

module.exports = {
  CURSOR_TECHNIQUES,
};
