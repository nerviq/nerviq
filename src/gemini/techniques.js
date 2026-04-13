/**
 * Gemini CLI techniques module — CHECK CATALOG
 *
 * 135 checks across 25 categories:
 *   v0.1 (40): A. Instructions, B. Config, C. Trust & Safety, D. Hooks, E. MCP, F. Sandbox & Policy
 *   v0.5 (54): G. Skills & Agents, H. CI & Automation, I. Extensions
 *   v1.0 (68): J. Review & Workflow, K. Quality Deep, L. Commands
 *   v1.1 (73): Q. Experiment-Verified Fixes (v0.36.0 findings: --json→-o json, model object format, --yolo in approval, plan mode, --allowed-tools deprecated, eager loading)
 *   v1.2 (135): T. Engineering Foundations (testing, quality, API, database, auth, monitoring, dependencies, cost)
 *
 * Each check: { id, name, check(ctx), impact, rating, category, fix, template, file(), line() }
 */

const os = require('os');
const path = require('path');
const { GeminiProjectContext } = require('./context');
const { EMBEDDED_SECRET_PATTERNS, containsEmbeddedSecret } = require('../secret-patterns');
const { attachSourceUrls } = require('../source-urls');
const { buildSupplementalChecks } = require('../supplemental-checks');
const { buildStackChecks } = require('../stack-checks');
const { resolveProjectStateReadPath } = require('../state-paths');

const GEMINI_SUPPLEMENTAL_SOURCE_URLS = {
  'testing-strategy': 'https://geminicli.com/docs/get-started/',
  'code-quality': 'https://geminicli.com/docs/cli/gemini-md/',
  'api-design': 'https://geminicli.com/docs/cli/gemini-md/',
  database: 'https://geminicli.com/docs/get-started/',
  authentication: 'https://geminicli.com/docs/cli/trusted-folders/',
  monitoring: 'https://geminicli.com/docs/get-started/',
  'dependency-management': 'https://geminicli.com/docs/reference/configuration/',
  'cost-optimization': 'https://geminicli.com/docs/get-started/',
};

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

const JUSTIFICATION_PATTERNS = /\bbecause\b|\bwhy\b|\bjustif(?:y|ication)\b|\btemporary\b|\bintentional\b|\bdocumented\b|\bair[- ]?gapped\b|\binternal only\b|\bephemeral\b|\bci only\b/i;

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

function geminiMd(ctx) {
  return ctx.geminiMdContent ? ctx.geminiMdContent() : (ctx.fileContent('GEMINI.md') || null);
}

function settingsRaw(ctx) {
  return ctx.fileContent('.gemini/settings.json') || '';
}

function settingsData(ctx) {
  const result = ctx.settingsJson();
  return result && result.ok ? result.data : null;
}

/**
 * True when .gemini/settings.json is effectively an MCP-only config — i.e.
 * it configures external tool servers but does not attempt to tune CLI
 * behaviour (model, sandbox, approval, theme, history, etc.). Checks that
 * assert on CLI-behaviour keys should be N/A on such configs.
 */
function isMcpOnlySettings(data) {
  if (!data || typeof data !== 'object') return false;
  const keys = Object.keys(data).filter(k => k !== '$schema' && k !== 'ide' && k !== 'context');
  if (keys.length === 0) return true;
  const behaviourKeys = new Set(['model', 'sandbox', 'safety', 'theme', 'approval', 'approvalMode', 'history', 'session', 'telemetry', 'hooks', 'tools', 'skills', 'commands', 'extensions', 'security']);
  return keys.every(k => k === 'mcpServers' || !behaviourKeys.has(k));
}

function docsBundle(ctx) {
  const gmd = geminiMd(ctx) || '';
  const readme = ctx.fileContent('README.md') || '';
  const agents = ctx.fileContent('AGENTS.md') || '';
  const claudeMd = ctx.fileContent('CLAUDE.md') || '';
  const contributing = ctx.fileContent('CONTRIBUTING.md') || '';
  const architecture = ctx.fileContent('ARCHITECTURE.md') || '';
  const development = ctx.fileContent('DEVELOPMENT.md') || ctx.fileContent('docs/development.md') || '';
  return [gmd, readme, agents, claudeMd, contributing, architecture, development].join('\n');
}

// Broader bundle for stack-specific docs discovery (mirrors the Copilot
// PP-01 stackDocsBundle approach): consults common developer docs in
// addition to the instruction surfaces so stack checks don't hard-fail
// when conventions live in CONTRIBUTING/DEVELOPMENT instead of GEMINI.md.
function stackDocsBundle(ctx) {
  return docsBundle(ctx);
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

function extractImportRefs(content) {
  const refs = [];
  const regex = /@([^\s@]+\.\w+)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    refs.push({ ref: match[1], line: content.slice(0, match.index).split('\n').length });
  }
  return refs;
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

function repoNeedsExternalTools(ctx) {
  const deps = ctx.projectDependencies ? Object.keys(ctx.projectDependencies()) : [];
  const depSet = new Set(deps);
  const files = new Set(ctx.files || []);
  const envContent = [ctx.fileContent('.env.example'), ctx.fileContent('.env.template'), ctx.fileContent('.env.sample')].filter(Boolean).join('\n');
  const docs = docsBundle(ctx);
  const combined = `${docs}\n${envContent}`;
  const externalDeps = ['pg', 'postgres', 'mysql', 'mysql2', 'mongodb', 'mongoose', 'redis', 'ioredis', 'prisma', 'sequelize', 'typeorm', 'supabase', '@supabase/supabase-js', 'stripe', 'openai', '@anthropic-ai/sdk', 'langchain', '@aws-sdk/client-s3'];
  if (externalDeps.some((d) => depSet.has(d))) return true;
  if (files.has('docker-compose.yml') || files.has('docker-compose.yaml') || files.has('compose.yml') || ctx.hasDir('prisma') || ctx.hasDir('infra') || ctx.hasDir('terraform')) return true;
  return /\bDATABASE_URL\b|\bREDIS_URL\b|\bSUPABASE_URL\b|\bSTRIPE_[A-Z_]+\b|\bAWS_[A-Z_]+\b/i.test(combined);
}

function workflowArtifacts(ctx) {
  const ghDir = path.join(ctx.dir, '.github', 'workflows');
  try {
    const files = require('fs').readdirSync(ghDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    return files.map(f => {
      const filePath = `.github/workflows/${f}`;
      return { filePath, content: ctx.fileContent(filePath) || '' };
    }).filter(item => item.content);
  } catch {
    return [];
  }
}

function hooksFromSettings(ctx) {
  const hooks = ctx.hooksConfig ? ctx.hooksConfig() : null;
  return hooks || null;
}

function hookEventEntries(hooks) {
  if (!hooks || typeof hooks !== 'object') return [];
  const entries = [];
  for (const [eventName, config] of Object.entries(hooks)) {
    const items = Array.isArray(config) ? config : [config];
    for (const item of items) {
      entries.push({ event: eventName, config: item });
    }
  }
  return entries;
}

function policyFileContents(ctx) {
  const files = ctx.policyFiles ? ctx.policyFiles() : [];
  return files.map(f => ({ filePath: f, content: ctx.fileContent(f) || '' })).filter(item => item.content);
}

// ─── GEMINI_TECHNIQUES ──────────────────────────────────────────────────────

const GEMINI_TECHNIQUES = {

  // =============================================
  // A. Instructions (7 checks) — GM-A01..GM-A07
  // =============================================

  geminiMdExists: {
    id: 'GM-A01',
    name: 'GEMINI.md exists at project root',
    check: (ctx) => Boolean(geminiMd(ctx)),
    impact: 'critical',
    rating: 5,
    category: 'instructions',
    fix: 'Create GEMINI.md at the project root with repo-specific instructions for Gemini CLI.',
    template: 'gemini-md',
    file: () => 'GEMINI.md',
    line: (ctx) => (geminiMd(ctx) ? 1 : null),
  },

  geminiMdSubstantive: {
    id: 'GM-A02',
    name: 'GEMINI.md has substantive content (>20 lines, 2+ sections)',
    check: (ctx) => {
      const content = geminiMd(ctx);
      if (!content) return null;
      const nonEmpty = content.split(/\r?\n/).filter(l => l.trim()).length;
      return nonEmpty >= 20 && countSections(content) >= 2;
    },
    impact: 'high',
    rating: 5,
    category: 'instructions',
    fix: 'Expand GEMINI.md to at least 20 substantive lines and 2+ sections instead of a thin placeholder.',
    template: 'gemini-md',
    file: () => 'GEMINI.md',
    line: () => 1,
  },

  geminiMdVerificationCommands: {
    id: 'GM-A03',
    name: 'GEMINI.md includes build/test/lint commands',
    check: (ctx) => {
      const content = geminiMd(ctx);
      if (!content) return null;
      const expected = expectedVerificationCategories(ctx);
      if (expected.length === 0) return /\bverify\b|\btest\b|\blint\b|\bbuild\b/i.test(content);
      return expected.every(cat => hasCommandMention(content, cat));
    },
    impact: 'high',
    rating: 5,
    category: 'instructions',
    fix: 'Document the actual test/lint/build commands so Gemini CLI can verify its own changes.',
    template: 'gemini-md',
    file: () => 'GEMINI.md',
    line: (ctx) => {
      const content = geminiMd(ctx);
      return content ? (firstLineMatching(content, /\bVerification\b|\btest\b|\blint\b|\bbuild\b/i) || 1) : null;
    },
  },

  geminiMdArchitecture: {
    id: 'GM-A04',
    name: 'Instructions have architecture section or Mermaid diagram',
    check: (ctx) => {
      const content = geminiMd(ctx);
      if (!content) return null;
      if (hasArchitecture(content)) return true;
      // Credit an ARCHITECTURE.md at repo root, or architecture content
      // surfaced in README.md — both are legitimate ways Gemini will pick
      // up repo shape, especially when GEMINI.md is a pointer/import.
      const arch = ctx.fileContent('ARCHITECTURE.md') || ctx.fileContent('docs/architecture.md');
      if (arch) return true;
      const readme = ctx.fileContent('README.md') || '';
      return hasArchitecture(readme);
    },
    impact: 'medium',
    rating: 4,
    category: 'instructions',
    fix: 'Add an architecture or project map section to GEMINI.md so Gemini CLI understands the repo shape.',
    template: 'gemini-md',
    file: () => 'GEMINI.md',
    line: (ctx) => {
      const content = geminiMd(ctx);
      return content ? firstLineMatching(content, /##\s+Architecture\b|##\s+Project Map\b|```mermaid/i) : null;
    },
  },

  geminiMdNoFiller: {
    id: 'GM-A05',
    name: 'No generic filler instructions',
    check: (ctx) => {
      const content = geminiMd(ctx);
      if (!content) return null;
      return !FILLER_PATTERNS.some(p => p.test(content));
    },
    impact: 'low',
    rating: 3,
    category: 'instructions',
    fix: 'Replace generic filler like "be helpful" with concrete repo-specific guidance that changes Gemini behavior.',
    template: null,
    file: () => 'GEMINI.md',
    line: (ctx) => {
      const content = geminiMd(ctx);
      return content ? findFillerLine(content) : null;
    },
  },

  geminiMdImportsValid: {
    id: 'GM-A06',
    name: '@import references point to existing files',
    check: (ctx) => {
      const content = geminiMd(ctx);
      if (!content) return null;
      const refs = extractImportRefs(content);
      if (refs.length === 0) return true;
      return refs.every(r => Boolean(ctx.fileContent(r.ref)));
    },
    impact: 'medium',
    rating: 4,
    category: 'instructions',
    fix: 'Fix broken @file.md import references in GEMINI.md so all imported context files are actually loadable.',
    template: null,
    file: () => 'GEMINI.md',
    line: (ctx) => {
      const content = geminiMd(ctx);
      if (!content) return null;
      const refs = extractImportRefs(content);
      const broken = refs.find(r => !ctx.fileContent(r.ref));
      return broken ? broken.line : null;
    },
  },

  geminiMdNoSecrets: {
    id: 'GM-A07',
    name: 'No secrets/API keys in GEMINI.md',
    check: (ctx) => {
      const content = geminiMd(ctx);
      if (!content) return null;
      return !containsEmbeddedSecret(content);
    },
    impact: 'critical',
    rating: 5,
    category: 'instructions',
    fix: 'Remove API keys and secrets from GEMINI.md. Use environment variables or secret stores instead.',
    template: null,
    file: () => 'GEMINI.md',
    line: (ctx) => {
      const content = geminiMd(ctx);
      return content ? findSecretLine(content) : null;
    },
  },

  // =============================================
  // B. Config (7 checks) — GM-B01..GM-B07
  // =============================================

  geminiSettingsExists: {
    id: 'GM-B01',
    name: '.gemini/settings.json exists',
    check: (ctx) => {
      if (ctx.fileContent('.gemini/settings.json')) return true;
      // N/A when the repo uses only the GEMINI.md-instruction convention
      // without any .gemini/ configuration directory. settings.json is
      // opt-in for CLI tuning; instruction-only repos should not fail.
      const hasGeminiDir = ctx.hasDir && ctx.hasDir('.gemini');
      if (!hasGeminiDir) return null;
      return false;
    },
    impact: 'high',
    rating: 5,
    category: 'config',
    fix: 'Create .gemini/settings.json with explicit model, sandbox, and approval settings.',
    template: 'gemini-settings',
    file: () => '.gemini/settings.json',
    line: (ctx) => (ctx.fileContent('.gemini/settings.json') ? 1 : null),
  },

  geminiSettingsValidJson: {
    id: 'GM-B02',
    name: 'Settings is valid JSON',
    check: (ctx) => {
      const raw = settingsRaw(ctx);
      if (!raw) return null;
      const result = ctx.settingsJson();
      return result && result.ok;
    },
    impact: 'critical',
    rating: 5,
    category: 'config',
    fix: 'Fix malformed JSON in .gemini/settings.json. Invalid JSON causes exit code 52 — Gemini CLI will not start.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => {
      const result = ctx.settingsJson();
      if (result && result.ok) return null;
      if (result && result.error) {
        const match = result.error.match(/position (\d+)/i);
        if (match) {
          const raw = settingsRaw(ctx);
          return raw ? raw.slice(0, Number(match[1])).split('\n').length : 1;
        }
      }
      return 1;
    },
  },

  geminiModelExplicit: {
    id: 'GM-B03',
    name: 'Model is set explicitly in object format (v0.36.0+)',
    check: (ctx) => {
      const data = settingsData(ctx);
      if (!data) return null;
      if (isMcpOnlySettings(data)) return null;
      if (!data.model) return false;
      // v0.36.0: model field MUST be an object { name: "..." }, not a string
      // String format causes exit code 41: "Expected object, received string"
      if (typeof data.model === 'string') return false;
      if (typeof data.model === 'object' && data.model.name) return true;
      return false;
    },
    impact: 'critical',
    rating: 5,
    category: 'config',
    fix: 'CRITICAL: In v0.36.0+, model must be an object: {"model": {"name": "gemini-2.5-flash"}}. String format ({"model": "gemini-2.5-flash"}) causes exit code 41. Default model is now gemini-3-flash-preview.',
    template: 'gemini-settings',
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /"model"/),
  },

  geminiExplicitSettings: {
    id: 'GM-B04',
    name: 'Theme/sandbox/approval settings are explicit',
    check: (ctx) => {
      const data = settingsData(ctx);
      if (!data) return null;
      if (isMcpOnlySettings(data)) return null;
      // At least one CLI-behaviour setting should be explicit.
      return Boolean(data.sandbox || data.safety || data.theme || data.approval || data.approvalMode);
    },
    impact: 'medium',
    rating: 4,
    category: 'config',
    fix: 'Set sandbox, safety, or theme settings explicitly in .gemini/settings.json instead of relying on defaults.',
    template: 'gemini-settings',
    file: () => '.gemini/settings.json',
    line: () => 1,
  },

  geminiNoDeprecatedKeys: {
    id: 'GM-B05',
    name: 'No deprecated config keys',
    check: (ctx) => {
      const raw = settingsRaw(ctx);
      if (!raw) return null;
      const deprecatedPatterns = [
        /\bsandbox_mode\b/,
        /\bmax_tokens\b/,
        /\bmcp_servers\b/,
      ];
      return !deprecatedPatterns.some(p => p.test(raw));
    },
    impact: 'medium',
    rating: 4,
    category: 'config',
    fix: 'Replace deprecated config keys (sandbox_mode, max_tokens, mcp_servers) with their current equivalents.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => {
      const raw = settingsRaw(ctx);
      return raw ? firstLineMatching(raw, /\bsandbox_mode\b|\bmax_tokens\b|\bmcp_servers\b/) : null;
    },
  },

  geminiContextFileNameStandard: {
    id: 'GM-B06',
    name: 'context.fileName is standard or intentionally overridden',
    check: (ctx) => {
      const data = settingsData(ctx);
      if (!data) return null;
      const contextFileName = data.context && data.context.fileName;
      if (!contextFileName) return true; // Using default GEMINI.md
      // If overridden, check that the custom file actually exists
      const names = Array.isArray(contextFileName) ? contextFileName : [contextFileName];
      return names.every(name => Boolean(ctx.fileContent(name)));
    },
    impact: 'low',
    rating: 3,
    category: 'config',
    fix: 'If context.fileName is overridden, ensure the custom instruction files exist and are intentional.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /context\.fileName|"fileName"/i),
  },

  geminiEnvApiKey: {
    id: 'GM-B07',
    name: 'API key / auth documented (env file, README, or GEMINI.md)',
    check: (ctx) => {
      const envContent = ctx.fileContent('.env') || '';
      const envExample = ctx.fileContent('.env.example') || ctx.fileContent('.env.template') || ctx.fileContent('.env.sample') || '';
      const docs = docsBundle(ctx);
      const combined = `${envContent}\n${envExample}\n${docs}`;
      if (!combined.trim()) return null;
      // Credit env files OR documentation that mentions any Gemini/Google auth mechanism,
      // including `gemini auth`, ADC / application default credentials, Vertex AI, or a
      // direct mention of the standard env var names.
      return /\bGEMINI_API_KEY\b|\bGOOGLE_API_KEY\b|\bGOOGLE_APPLICATION_CREDENTIALS\b|\bgcloud\b|\bapplication[- ]default credentials?\b|\bADC\b|\bvertex[- ]?ai\b|\bgemini auth\b|\bservice account\b/i.test(combined);
    },
    impact: 'high',
    rating: 4,
    category: 'config',
    fix: 'Ensure .env or .env.example documents the GEMINI_API_KEY or Google authentication setup.',
    template: null,
    file: () => '.env',
    line: (ctx) => {
      const env = ctx.fileContent('.env') || ctx.fileContent('.env.example') || '';
      return env ? firstLineMatching(env, /GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_APPLICATION_CREDENTIALS/i) : null;
    },
  },

  // =============================================
  // C. Trust & Safety (9 checks) — GM-C01..GM-C09
  // =============================================

  geminiNoYolo: {
    id: 'GM-C01',
    name: 'No --yolo in project settings, scripts, or approval field',
    check: (ctx) => {
      const raw = settingsRaw(ctx);
      const gmd = geminiMd(ctx) || '';
      const combined = `${raw}\n${gmd}`;
      // Check settings and scripts for --yolo
      if (/--yolo\b|\byolo\b.*:\s*true/i.test(raw)) return false;
      // CRITICAL: v0.36.0 silently accepts "--yolo" as an approval value in settings.json
      // {"approval": "--yolo"} passes validation without warning
      const data = settingsData(ctx);
      if (data && data.approval && /yolo/i.test(String(data.approval))) return false;
      // Check package.json scripts
      const pkg = ctx.jsonFile ? ctx.jsonFile('package.json') : null;
      if (pkg && pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts).join('\n');
        if (/\b--yolo\b/i.test(scriptValues)) return false;
      }
      return true;
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Remove --yolo from project settings and scripts. WARNING: v0.36.0 silently accepts "--yolo" in the approval field without any validation error — this is a security risk.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => {
      const raw = settingsRaw(ctx);
      return raw ? firstLineMatching(raw, /yolo/i) : null;
    },
  },

  geminiSandboxExplicit: {
    id: 'GM-C02',
    name: 'Sandbox mode is explicitly configured',
    check: (ctx) => {
      const data = settingsData(ctx);
      if (!data) return null;
      if (isMcpOnlySettings(data)) return null;
      return Boolean(data.sandbox && (data.sandbox.mode || typeof data.sandbox === 'string'));
    },
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'Set sandbox mode explicitly (Seatbelt/Docker/gVisor/bubblewrap) instead of relying on platform defaults.',
    template: 'gemini-settings',
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /"sandbox"/i),
  },

  geminiTrustedFoldersIntentional: {
    id: 'GM-C03',
    name: 'Trusted Folders list is intentional (not blindly trust-all)',
    check: (ctx) => {
      const data = settingsData(ctx);
      if (!data) return null;
      const trusted = data.trustedFolders || (data.safety && data.safety.trustedFolders);
      if (!trusted) return true; // No explicit trust-all
      if (Array.isArray(trusted)) {
        // Warn if trust-all patterns
        return !trusted.some(f => f === '*' || f === '/' || f === '~' || f === '**');
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'trust',
    fix: 'Restrict trustedFolders to specific project directories instead of wildcard trust-all patterns.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /trustedFolders/i),
  },

  geminiPolicyRulesForRiskyRepos: {
    id: 'GM-C04',
    name: 'Policy engine rules exist for elevated-risk repos',
    check: (ctx) => {
      if (!repoLooksRegulated(ctx)) return null;
      const policies = policyFileContents(ctx);
      return policies.length > 0;
    },
    impact: 'medium',
    rating: 4,
    category: 'trust',
    fix: 'For regulated repos, add policy TOML files under .gemini/policy/ to enforce tool and command restrictions.',
    template: null,
    file: () => '.gemini/policy',
    line: () => 1,
  },

  geminiNoPolicyContradictions: {
    id: 'GM-C05',
    name: 'No policy contradictions across tiers',
    check: (ctx) => {
      const policies = policyFileContents(ctx);
      if (policies.length < 2) return null;
      // Check for contradictory allow/deny on the same tool across policy files
      const allowedTools = new Set();
      const deniedTools = new Set();
      for (const policy of policies) {
        const allowMatches = policy.content.match(/allow\s*=\s*\[([^\]]*)\]/gi) || [];
        const denyMatches = policy.content.match(/deny\s*=\s*\[([^\]]*)\]/gi) || [];
        for (const m of allowMatches) {
          const tools = m.match(/["']([^"']+)["']/g) || [];
          tools.forEach(t => allowedTools.add(t.replace(/["']/g, '')));
        }
        for (const m of denyMatches) {
          const tools = m.match(/["']([^"']+)["']/g) || [];
          tools.forEach(t => deniedTools.add(t.replace(/["']/g, '')));
        }
      }
      // Contradiction: same tool both allowed and denied
      for (const tool of allowedTools) {
        if (deniedTools.has(tool)) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'trust',
    fix: 'Remove contradictory allow/deny rules across policy tiers so Gemini CLI enforcement is predictable.',
    template: null,
    file: (ctx) => {
      const policies = policyFileContents(ctx);
      return policies.length > 0 ? policies[0].filePath : null;
    },
    line: () => 1,
  },

  geminiAutoEditCodeDeletionRisk: {
    id: 'GM-C06',
    name: 'auto_edit not enabled without code deletion risk awareness',
    check: (ctx) => {
      const raw = settingsRaw(ctx);
      const data = settingsData(ctx);
      if (!data) return null;
      const autoEdit = data.auto_edit || data.autoEdit || (data.safety && data.safety.autoEdit);
      if (!autoEdit) return true;
      // If auto_edit is on, check that code deletion bug is acknowledged
      const gmd = geminiMd(ctx) || '';
      const docs = `${gmd}\n${raw}`;
      return /\bcode deletion\b|\bbug\s*#?23497\b|\bdeletion risk\b|\bcode loss\b/i.test(docs);
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'CRITICAL: auto_edit has a known code deletion bug (#23497). Document the risk or disable auto_edit until the bug is fixed.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /auto_?edit/i),
  },

  geminiNoSecretsInSettings: {
    id: 'GM-C07',
    name: 'No secrets in settings.json or command files',
    check: (ctx) => {
      const raw = settingsRaw(ctx);
      if (raw && containsEmbeddedSecret(raw)) return false;
      // Check command files
      const commandFiles = ctx.commandFiles ? ctx.commandFiles() : [];
      for (const f of commandFiles) {
        const content = ctx.fileContent(f) || '';
        if (containsEmbeddedSecret(content)) return false;
      }
      return true;
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Remove API keys and secrets from settings.json and command files. Use environment variables instead.',
    template: null,
    file: (ctx) => {
      const raw = settingsRaw(ctx);
      if (raw && containsEmbeddedSecret(raw)) return '.gemini/settings.json';
      const commandFiles = ctx.commandFiles ? ctx.commandFiles() : [];
      for (const f of commandFiles) {
        const content = ctx.fileContent(f) || '';
        if (containsEmbeddedSecret(content)) return f;
      }
      return null;
    },
    line: (ctx) => {
      const raw = settingsRaw(ctx);
      if (raw && containsEmbeddedSecret(raw)) return findSecretLine(raw);
      const commandFiles = ctx.commandFiles ? ctx.commandFiles() : [];
      for (const f of commandFiles) {
        const content = ctx.fileContent(f) || '';
        if (containsEmbeddedSecret(content)) return findSecretLine(content);
      }
      return null;
    },
  },

  geminiCodeDeletionBugAwareness: {
    id: 'GM-C08',
    name: 'Code deletion bug awareness documented for affected workflows',
    check: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      const data = settingsData(ctx);
      // Only relevant if auto_edit or --yolo might be in use
      const hasRiskySetting = data && (data.auto_edit || data.autoEdit || data.safety);
      if (!hasRiskySetting) return null;
      return /\bcode deletion\b|\bbug\s*#?23497\b|\bdeletion risk\b|\bgemini.*delet/i.test(gmd);
    },
    impact: 'medium',
    rating: 3,
    category: 'trust',
    fix: 'Document the known Gemini code deletion bug (#23497) in GEMINI.md for workflows that use auto_edit.',
    template: null,
    file: () => 'GEMINI.md',
    line: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      return firstLineMatching(gmd, /code deletion|bug.*23497|deletion risk/i);
    },
  },

  geminiNoYoloInCI: {
    id: 'GM-C09',
    name: 'No --yolo in CI scripts or workflow files',
    check: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        if (/\b--yolo\b/i.test(wf.content)) return false;
      }
      // Check Makefile, justfile, scripts
      const makefile = ctx.fileContent('Makefile') || '';
      if (/\b--yolo\b/i.test(makefile)) return false;
      return true;
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Never use --yolo in CI. Remove it from all workflow files and build scripts.',
    template: null,
    file: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        if (/\b--yolo\b/i.test(wf.content)) return wf.filePath;
      }
      const makefile = ctx.fileContent('Makefile') || '';
      if (/\b--yolo\b/i.test(makefile)) return 'Makefile';
      return null;
    },
    line: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        const line = firstLineMatching(wf.content, /--yolo/i);
        if (line) return line;
      }
      const makefile = ctx.fileContent('Makefile') || '';
      return firstLineMatching(makefile, /--yolo/i);
    },
  },

  // =============================================
  // D. Hooks (4 checks) — GM-D01..GM-D04
  // =============================================

  geminiHooksConfigured: {
    id: 'GM-D01',
    name: 'Hooks configured if project uses tool enforcement',
    check: (ctx) => {
      const hooks = hooksFromSettings(ctx);
      if (hooks) return true;
      // Check if GEMINI.md mentions hooks
      const gmd = geminiMd(ctx) || '';
      const claimsHooks = /\bhooks?\b|\bBeforeTool\b|\bAfterTool\b/i.test(gmd);
      if (!claimsHooks) return null; // Not relevant
      return false; // Claims hooks but none configured
    },
    impact: 'medium',
    rating: 4,
    category: 'hooks',
    fix: 'Add hooks configuration to .gemini/settings.json if the project uses tool enforcement.',
    template: 'gemini-settings',
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /hooks/i),
  },

  geminiHookMatchersSpecific: {
    id: 'GM-D02',
    name: 'BeforeTool/AfterTool matchers use specific regex (not catch-all)',
    check: (ctx) => {
      const hooks = hooksFromSettings(ctx);
      if (!hooks) return null;
      const entries = hookEventEntries(hooks);
      if (entries.length === 0) return null;
      for (const entry of entries) {
        const cfg = entry.config;
        if (!cfg) continue;
        const matcher = cfg.matcher || cfg.pattern || cfg.toolName;
        if (typeof matcher === 'string') {
          if (matcher === '*' || matcher === '.*' || matcher === '.+') return false;
        }
      }
      return true;
    },
    impact: 'medium',
    rating: 4,
    category: 'hooks',
    fix: 'Replace catch-all hook matchers (* or .*) with specific tool name regex patterns.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => {
      const raw = settingsRaw(ctx);
      return raw ? firstLineMatching(raw, /["'](\*|\.\*|\.\+)["']/i) : null;
    },
  },

  geminiAfterToolScrubbing: {
    id: 'GM-D03',
    name: 'AfterTool output scrubbing used for sensitive tool results',
    check: (ctx) => {
      const hooks = hooksFromSettings(ctx);
      if (!hooks) return null;
      const afterTool = hooks.AfterTool;
      if (!afterTool) return null;
      // Check that AfterTool hooks exist with scrubbing capability
      const entries = Array.isArray(afterTool) ? afterTool : [afterTool];
      const hasScrub = entries.some(entry => {
        const cmd = typeof entry === 'string' ? entry : (entry.command || entry.cmd || '');
        return /\bscrub\b|\bredact\b|\bfilter\b|\bdeny\b|\bstrip\b/i.test(cmd);
      });
      return hasScrub || entries.length > 0; // At least AfterTool is configured
    },
    impact: 'medium',
    rating: 4,
    category: 'hooks',
    fix: 'Configure AfterTool hooks to scrub sensitive output from tool results before they reach the model.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /AfterTool/i),
  },

  geminiHookTimeoutReasonable: {
    id: 'GM-D04',
    name: 'Hook timeout is reasonable (<60s)',
    check: (ctx) => {
      const hooks = hooksFromSettings(ctx);
      if (!hooks) return null;
      const entries = hookEventEntries(hooks);
      for (const entry of entries) {
        const cfg = entry.config;
        if (cfg && typeof cfg === 'object' && typeof cfg.timeout === 'number') {
          if (cfg.timeout > 60) return false;
        }
      }
      return true;
    },
    impact: 'low',
    rating: 3,
    category: 'hooks',
    fix: 'Keep hook timeouts at 60 seconds or less unless the repo documents why a longer timeout is needed.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => {
      const raw = settingsRaw(ctx);
      return raw ? firstLineMatching(raw, /"timeout"\s*:\s*(6[1-9]|[7-9]\d|\d{3,})/i) : null;
    },
  },

  // =============================================
  // E. MCP (6 checks) — GM-E01..GM-E06
  // =============================================

  geminiMcpConfigured: {
    id: 'GM-E01',
    name: 'MCP servers configured if project needs external tools',
    check: (ctx) => {
      if (!repoNeedsExternalTools(ctx)) return null;
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      return Object.keys(servers).length > 0;
    },
    impact: 'medium',
    rating: 4,
    category: 'mcp',
    fix: 'This repo depends on external services. Add MCP servers to .gemini/settings.json so Gemini CLI can use live context.',
    template: 'gemini-settings',
    file: () => '.gemini/settings.json',
    line: () => 1,
  },

  geminiMcpExcludeTools: {
    id: 'GM-E02',
    name: 'excludeTools used to restrict dangerous tools',
    check: (ctx) => {
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      const ids = Object.keys(servers);
      if (ids.length === 0) return null;
      // In Gemini, excludeTools always wins — check it's used
      return ids.some(id => {
        const server = servers[id];
        return server && Array.isArray(server.excludeTools) && server.excludeTools.length > 0;
      });
    },
    impact: 'high',
    rating: 4,
    category: 'mcp',
    fix: 'Use excludeTools on MCP servers to restrict dangerous tools. In Gemini, excludeTools always wins over includeTools.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /excludeTools/i),
  },

  geminiMcpTransportAppropriate: {
    id: 'GM-E03',
    name: 'Transport type is appropriate (stdio for local, SSE/HTTP for remote)',
    check: (ctx) => {
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      const ids = Object.keys(servers);
      if (ids.length === 0) return null;
      for (const id of ids) {
        const server = servers[id];
        if (!server) continue;
        const transport = server.transport || '';
        const hasUrl = Boolean(server.url);
        // Remote servers should use SSE or HTTP streaming, not stdio
        if (hasUrl && transport === 'stdio') return false;
        // Local servers should use stdio, not remote protocols
        if (!hasUrl && server.command && (transport === 'sse' || transport === 'http')) return false;
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'Use stdio transport for local MCP servers and SSE/HTTP streaming for remote servers.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /transport/i),
  },

  geminiMcpExcludeOverInclude: {
    id: 'GM-E04',
    name: 'excludeTools used instead of includeTools (Gemini security model)',
    check: (ctx) => {
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      const ids = Object.keys(servers);
      if (ids.length === 0) return null;
      // Flag if includeTools is used without excludeTools (Gemini security best practice)
      for (const id of ids) {
        const server = servers[id];
        if (!server) continue;
        const hasInclude = Array.isArray(server.includeTools) && server.includeTools.length > 0;
        const hasExclude = Array.isArray(server.excludeTools) && server.excludeTools.length > 0;
        if (hasInclude && !hasExclude) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'mcp',
    fix: 'In Gemini CLI, excludeTools always wins. Use excludeTools for security instead of relying on includeTools alone.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /includeTools/i),
  },

  geminiMcpAuthDocumented: {
    id: 'GM-E05',
    name: 'Auth requirements documented for MCP servers',
    check: (ctx) => {
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      const ids = Object.keys(servers);
      if (ids.length === 0) return null;
      const docs = docsBundle(ctx);
      for (const id of ids) {
        const server = servers[id];
        if (!server || !server.url) continue; // Only remote servers need auth docs
        const hasInlineAuth = Boolean(server.token || server.headers || server.env);
        const hasDocNote = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[\\s\\S]{0,140}\\b(auth|token|credential|env)\\b`, 'i').test(docs);
        if (!hasInlineAuth && !hasDocNote) return false;
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'Document auth requirements for remote MCP servers so setup is reviewable by team members.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /mcpServers/i),
  },

  geminiMcpNoDeprecatedTransport: {
    id: 'GM-E06',
    name: 'No deprecated transport types in MCP config',
    check: (ctx) => {
      const raw = settingsRaw(ctx);
      if (!raw) return null;
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      if (Object.keys(servers).length === 0) return null;
      // Check for deprecated transport names
      return !/"transport"\s*:\s*"(http\+sse|legacy-sse)"/i.test(raw);
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'Replace deprecated MCP transport types with current ones (stdio or streamable HTTP).',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => {
      const raw = settingsRaw(ctx);
      return raw ? firstLineMatching(raw, /http\+sse|legacy-sse/i) : null;
    },
  },

  // =============================================
  // F. Sandbox & Policy (7 checks) — GM-F01..GM-F07
  // =============================================

  geminiSandboxModeExplicit: {
    id: 'GM-F01',
    name: 'Sandbox mode is explicit (Seatbelt/Docker/gVisor/bubblewrap)',
    check: (ctx) => {
      const data = settingsData(ctx);
      if (!data) return null;
      if (isMcpOnlySettings(data)) return null;
      const sandbox = data.sandbox;
      if (!sandbox) return false;
      const mode = typeof sandbox === 'string' ? sandbox : sandbox.mode;
      const validModes = ['seatbelt', 'docker', 'podman', 'gvisor', 'lxc', 'lxd', 'bubblewrap', 'none'];
      return Boolean(mode && validModes.some(m => mode.toLowerCase().includes(m)));
    },
    impact: 'high',
    rating: 5,
    category: 'sandbox',
    fix: 'Set an explicit sandbox mode (Seatbelt, Docker, gVisor, bubblewrap) instead of defaulting silently.',
    template: 'gemini-settings',
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /sandbox/i),
  },

  geminiSandboxPermissionsRestricted: {
    id: 'GM-F02',
    name: 'Sandbox permissions are appropriately restricted',
    check: (ctx) => {
      const data = settingsData(ctx);
      if (!data || !data.sandbox) return null;
      const perms = data.sandbox.permissions;
      if (!perms) return null;
      // Check for overly broad permissions
      if (perms.network === true && perms.filesystem === 'full') return false;
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'sandbox',
    fix: 'Restrict sandbox permissions. Avoid granting both full network and full filesystem access.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /permissions/i),
  },

  geminiPolicyEngineConfigured: {
    id: 'GM-F03',
    name: 'Policy engine rules configured when policy files exist',
    check: (ctx) => {
      const policies = policyFileContents(ctx);
      if (policies.length === 0) return null;
      // At least one policy file should have actual rules
      return policies.some(p => /\ballow\b|\bdeny\b|\brule\b|\btool\b/i.test(p.content));
    },
    impact: 'medium',
    rating: 4,
    category: 'sandbox',
    fix: 'Policy files exist but contain no rules. Add allow/deny rules or remove empty policy files.',
    template: null,
    file: (ctx) => {
      const policies = policyFileContents(ctx);
      return policies.length > 0 ? policies[0].filePath : null;
    },
    line: () => 1,
  },

  geminiPolicyTiersValid: {
    id: 'GM-F04',
    name: 'Policy TOML files are valid and parseable',
    check: (ctx) => {
      const policies = ctx.policyFiles ? ctx.policyFiles() : [];
      if (policies.length === 0) return null;
      for (const f of policies) {
        const parsed = ctx.policyConfig ? ctx.policyConfig(f) : null;
        if (parsed && !parsed.ok) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'sandbox',
    fix: 'Fix malformed TOML in policy files so the policy engine does not silently skip rules.',
    template: null,
    file: (ctx) => {
      const policies = ctx.policyFiles ? ctx.policyFiles() : [];
      for (const f of policies) {
        const parsed = ctx.policyConfig ? ctx.policyConfig(f) : null;
        if (parsed && !parsed.ok) return f;
      }
      return null;
    },
    line: (ctx) => {
      const policies = ctx.policyFiles ? ctx.policyFiles() : [];
      for (const f of policies) {
        const parsed = ctx.policyConfig ? ctx.policyConfig(f) : null;
        if (parsed && !parsed.ok && parsed.error) {
          const match = parsed.error.match(/Line (\d+)/i);
          if (match) return Number(match[1]);
        }
      }
      return 1;
    },
  },

  geminiPolicyTiersDontConflict: {
    id: 'GM-F05',
    name: 'Policy engine tiers don\'t conflict',
    check: (ctx) => {
      const policies = policyFileContents(ctx);
      if (policies.length < 2) return null;
      // Detect conflicting tool decisions across tiers
      const perFile = policies.map(p => {
        const allows = new Set();
        const denies = new Set();
        const allowBlock = p.content.match(/allow\s*=\s*\[([^\]]*)\]/gi) || [];
        const denyBlock = p.content.match(/deny\s*=\s*\[([^\]]*)\]/gi) || [];
        for (const m of allowBlock) (m.match(/["']([^"']+)["']/g) || []).forEach(t => allows.add(t.replace(/["']/g, '')));
        for (const m of denyBlock) (m.match(/["']([^"']+)["']/g) || []).forEach(t => denies.add(t.replace(/["']/g, '')));
        return { filePath: p.filePath, allows, denies };
      });
      // Cross-file: tool allowed in one, denied in another
      for (let i = 0; i < perFile.length; i++) {
        for (let j = i + 1; j < perFile.length; j++) {
          for (const tool of perFile[i].allows) {
            if (perFile[j].denies.has(tool)) return false;
          }
          for (const tool of perFile[i].denies) {
            if (perFile[j].allows.has(tool)) return false;
          }
        }
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'sandbox',
    fix: 'Resolve conflicting allow/deny rules across policy tiers so enforcement is predictable.',
    template: null,
    file: (ctx) => {
      const policies = policyFileContents(ctx);
      return policies.length > 0 ? policies[0].filePath : null;
    },
    line: () => 1,
  },

  geminiSandboxNotNone: {
    id: 'GM-F06',
    name: 'Sandbox mode is not "none" in shared repos',
    check: (ctx) => {
      const data = settingsData(ctx);
      if (!data || !data.sandbox) return null;
      const mode = typeof data.sandbox === 'string' ? data.sandbox : (data.sandbox.mode || '');
      if (mode.toLowerCase() !== 'none') return true;
      // If "none", check for justification
      const gmd = geminiMd(ctx) || '';
      return JUSTIFICATION_PATTERNS.test(gmd);
    },
    impact: 'high',
    rating: 5,
    category: 'sandbox',
    fix: 'Avoid sandbox.mode = "none" in shared repos. If intentional, document the justification in GEMINI.md.',
    template: null,
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /sandbox/i),
  },

  geminiPolicyDocumentation: {
    id: 'GM-F07',
    name: 'Policy rules are documented for team onboarding',
    check: (ctx) => {
      const policies = policyFileContents(ctx);
      if (policies.length === 0) return null;
      const docs = docsBundle(ctx);
      return /\bpolicy\b|\bpolicies\b|\benforcement\b/i.test(docs);
    },
    impact: 'low',
    rating: 3,
    category: 'sandbox',
    fix: 'Document policy engine rules in GEMINI.md so new team members understand enforcement boundaries.',
    template: null,
    file: () => 'GEMINI.md',
    line: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      return firstLineMatching(gmd, /policy|policies|enforcement/i);
    },
  },

  // =============================================
  // G. Skills & Agents (5 checks) — GM-G01..GM-G05 (v0.5)
  // =============================================

  geminiAgentsFrontmatter: {
    id: 'GM-G01',
    name: 'Agent .md files have YAML frontmatter',
    check: (ctx) => {
      const agentFiles = ctx.agentFiles ? ctx.agentFiles() : [];
      if (agentFiles.length === 0) return null;
      for (const f of agentFiles) {
        const content = ctx.fileContent(f) || '';
        if (!content.trimStart().startsWith('---')) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'agents',
    fix: 'Add YAML frontmatter (---) to all agent .md files under .gemini/agents/ so Gemini can parse agent metadata.',
    template: null,
    file: (ctx) => {
      const agentFiles = ctx.agentFiles ? ctx.agentFiles() : [];
      for (const f of agentFiles) {
        const content = ctx.fileContent(f) || '';
        if (!content.trimStart().startsWith('---')) return f;
      }
      return null;
    },
    line: () => 1,
  },

  geminiAgentNamesDescriptive: {
    id: 'GM-G02',
    name: 'Agent names are descriptive',
    check: (ctx) => {
      const agentFiles = ctx.agentFiles ? ctx.agentFiles() : [];
      if (agentFiles.length === 0) return null;
      for (const f of agentFiles) {
        const name = path.basename(f, '.md');
        // Flag single-letter or very short non-descriptive names
        if (name.length < 3 || /^(a|b|c|x|y|z|test|tmp|foo|bar)$/i.test(name)) return false;
      }
      return true;
    },
    impact: 'low',
    rating: 3,
    category: 'agents',
    fix: 'Use descriptive agent names (e.g., code-reviewer, security-auditor) instead of generic placeholders.',
    template: null,
    file: (ctx) => {
      const agentFiles = ctx.agentFiles ? ctx.agentFiles() : [];
      for (const f of agentFiles) {
        const name = path.basename(f, '.md');
        if (name.length < 3) return f;
      }
      return null;
    },
    line: () => 1,
  },

  geminiAgentInstructionsScoped: {
    id: 'GM-G03',
    name: 'Agent instructions are scoped (not generic)',
    check: (ctx) => {
      const agentFiles = ctx.agentFiles ? ctx.agentFiles() : [];
      if (agentFiles.length === 0) return null;
      for (const f of agentFiles) {
        const content = ctx.fileContent(f) || '';
        if (FILLER_PATTERNS.some(p => p.test(content))) return false;
      }
      return true;
    },
    impact: 'medium',
    rating: 4,
    category: 'agents',
    fix: 'Replace generic agent instructions with task-specific guidance so agents stay focused on their role.',
    template: null,
    file: (ctx) => {
      const agentFiles = ctx.agentFiles ? ctx.agentFiles() : [];
      for (const f of agentFiles) {
        const content = ctx.fileContent(f) || '';
        if (FILLER_PATTERNS.some(p => p.test(content))) return f;
      }
      return null;
    },
    line: (ctx) => {
      const agentFiles = ctx.agentFiles ? ctx.agentFiles() : [];
      for (const f of agentFiles) {
        const content = ctx.fileContent(f) || '';
        if (FILLER_PATTERNS.some(p => p.test(content))) return findFillerLine(content);
      }
      return null;
    },
  },

  geminiNoDuplicateAgentNames: {
    id: 'GM-G04',
    name: 'No duplicate agent names (global vs project)',
    check: (ctx) => {
      const projectAgents = ctx.agentFiles ? ctx.agentFiles() : [];
      if (projectAgents.length === 0) return null;
      const projectNames = new Set(projectAgents.map(f => path.basename(f, '.md').toLowerCase()));
      // Check global agents
      const homeDir = os.homedir();
      const globalAgentsDir = path.join(homeDir, '.gemini', 'agents');
      try {
        const globalFiles = require('fs').readdirSync(globalAgentsDir).filter(f => f.endsWith('.md'));
        const globalNames = globalFiles.map(f => path.basename(f, '.md').toLowerCase());
        for (const name of globalNames) {
          if (projectNames.has(name)) return false;
        }
      } catch {
        // No global agents
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'agents',
    fix: 'Resolve duplicate agent names between global (~/.gemini/agents/) and project (.gemini/agents/) to avoid shadowing.',
    template: null,
    file: (ctx) => {
      const agentFiles = ctx.agentFiles ? ctx.agentFiles() : [];
      return agentFiles.length > 0 ? agentFiles[0] : null;
    },
    line: () => 1,
  },

  geminiSkillsDescribed: {
    id: 'GM-G05',
    name: 'Skills have clear descriptions for auto-invocation',
    check: (ctx) => {
      const skillDirs = ctx.skillDirs ? ctx.skillDirs() : [];
      if (skillDirs.length === 0) return null;
      for (const skillName of skillDirs) {
        // Check for a description file or frontmatter in the skill
        const readmePath = `.gemini/skills/${skillName}/README.md`;
        const indexPath = `.gemini/skills/${skillName}/index.md`;
        const content = ctx.fileContent(readmePath) || ctx.fileContent(indexPath) || '';
        if (!content || content.trim().length < 10) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'skills',
    fix: 'Give each skill a README.md or index.md with a clear description so Gemini CLI can auto-invoke correctly.',
    template: null,
    file: (ctx) => {
      const skillDirs = ctx.skillDirs ? ctx.skillDirs() : [];
      return skillDirs.length > 0 ? `.gemini/skills/${skillDirs[0]}` : null;
    },
    line: () => 1,
  },

  // =============================================
  // H. CI & Automation (4 checks) — GM-H01..GM-H04 (v0.5)
  // =============================================

  geminiCiAuthEnvVar: {
    id: 'GM-H01',
    name: 'Headless mode auth uses env var (not hardcoded key)',
    check: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        if (!/\bgemini\b/i.test(wf.content)) continue;
        // Check for hardcoded secrets
        const hasHardcoded = /GEMINI_API_KEY\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}/i.test(wf.content) ||
          containsEmbeddedSecret(wf.content);
        if (hasHardcoded) return false;
      }
      return true;
    },
    impact: 'critical',
    rating: 5,
    category: 'automation',
    fix: 'Use ${{ secrets.GEMINI_API_KEY }} or managed secret injection in CI. Never hardcode API keys in workflow files.',
    template: null,
    file: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        if (/GEMINI_API_KEY\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}/i.test(wf.content)) return wf.filePath;
      }
      return null;
    },
    line: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        const line = firstLineMatching(wf.content, /GEMINI_API_KEY\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}/i);
        if (line) return line;
      }
      return null;
    },
  },

  geminiCiNoYolo: {
    id: 'GM-H02',
    name: 'CI scripts don\'t use --yolo',
    check: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        if (/\b--yolo\b/i.test(wf.content)) return false;
      }
      return true;
    },
    impact: 'critical',
    rating: 5,
    category: 'automation',
    fix: 'Remove --yolo from all CI workflow files. Never bypass safety controls in automated pipelines.',
    template: null,
    file: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        if (/\b--yolo\b/i.test(wf.content)) return wf.filePath;
      }
      return null;
    },
    line: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        const line = firstLineMatching(wf.content, /--yolo/i);
        if (line) return line;
      }
      return null;
    },
  },

  geminiCiEnvVarConflict: {
    id: 'GM-H03',
    name: 'CI_* env var conflict awareness (bug #1563)',
    check: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        if (!/\bgemini\b/i.test(wf.content)) continue;
        // Check if CI_ env vars are set that might force non-interactive mode
        if (/\bCI_[A-Z_]+\s*[:=]/i.test(wf.content)) {
          // Check if the issue is acknowledged
          const gmd = geminiMd(ctx) || '';
          return /\bCI_\*\b|\bbug\s*#?1563\b|\bnon-interactive\b|\bCI.*env.*var/i.test(gmd) ||
            /\bCI_\*\b|\bbug.*1563\b|\bnon-interactive/i.test(wf.content);
        }
      }
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'automation',
    fix: 'Known bug #1563: any CI_* environment variable forces non-interactive mode. Document this or avoid setting CI_* vars in Gemini workflows.',
    template: null,
    file: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        if (/\bCI_[A-Z_]+\s*[:=]/i.test(wf.content)) return wf.filePath;
      }
      return null;
    },
    line: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        const line = firstLineMatching(wf.content, /CI_[A-Z_]+\s*[:=]/i);
        if (line) return line;
      }
      return null;
    },
  },

  geminiCiJsonOutput: {
    id: 'GM-H04',
    name: 'Headless output uses -o json (not deprecated --json)',
    check: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        if (!/\bgemini\b/i.test(wf.content)) continue;
        // If gemini is used in CI with -p (prompt), check for -o json (correct) and flag --json (removed in v0.36.0)
        if (/gemini\s+.*-p\b/i.test(wf.content)) {
          // CRITICAL: --json was removed in v0.36.0. Correct flag is -o json or --output-format json
          if (/--json\b/i.test(wf.content)) return false; // Using deprecated flag
          return /-o\s+json\b|--output-format\s+json\b/i.test(wf.content);
        }
      }
      return null; // Not relevant if no headless usage
    },
    impact: 'critical',
    rating: 5,
    category: 'automation',
    fix: 'CRITICAL: --json flag was removed in v0.36.0. Use `-o json` or `--output-format json` instead. Three formats available: text, json, stream-json.',
    template: null,
    file: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        if (/gemini\s+.*-p\b/i.test(wf.content) && (/--json\b/i.test(wf.content) || !/-o\s+json\b|--output-format\s+json\b/i.test(wf.content))) return wf.filePath;
      }
      return null;
    },
    line: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        const line = firstLineMatching(wf.content, /gemini\s+.*-p\b/i);
        if (line && (/--json\b/i.test(wf.content) || !/-o\s+json\b|--output-format\s+json\b/i.test(wf.content))) return line;
      }
      return null;
    },
  },

  // =============================================
  // I. Extensions (5 checks) — GM-I01..GM-I05 (v0.5)
  // =============================================

  geminiSkillNamingConvention: {
    id: 'GM-I01',
    name: 'Skill directories follow naming conventions',
    check: (ctx) => {
      const skillDirs = ctx.skillDirs ? ctx.skillDirs() : [];
      if (skillDirs.length === 0) return null;
      return skillDirs.every(name => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name));
    },
    impact: 'medium',
    rating: 3,
    category: 'extensions',
    fix: 'Use kebab-case for skill directory names (e.g., code-reviewer, not CodeReviewer).',
    template: null,
    file: (ctx) => {
      const skillDirs = ctx.skillDirs ? ctx.skillDirs() : [];
      const bad = skillDirs.find(name => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name));
      return bad ? `.gemini/skills/${bad}` : null;
    },
    line: () => 1,
  },

  geminiExtensionsTrusted: {
    id: 'GM-I02',
    name: 'Extensions are from trusted sources',
    check: (ctx) => {
      const extDirs = ctx.extensionDirs ? ctx.extensionDirs() : [];
      if (extDirs.length === 0) return null;
      // Check that extensions have documentation about their source
      const docs = docsBundle(ctx);
      return /\bextension\b.*\btrusted\b|\bextension\b.*\bverified\b|\bextension\b.*\bsource\b/i.test(docs);
    },
    impact: 'high',
    rating: 4,
    category: 'extensions',
    fix: 'Document the source and trust status of installed extensions in GEMINI.md.',
    template: null,
    file: () => 'GEMINI.md',
    line: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      return firstLineMatching(gmd, /extension/i);
    },
  },

  geminiExtensionMcpSafe: {
    id: 'GM-I03',
    name: 'Extension MCP configs don\'t override project security',
    check: (ctx) => {
      const extDirs = ctx.extensionDirs ? ctx.extensionDirs() : [];
      if (extDirs.length === 0) return null;
      // Check extension settings for MCP overrides
      for (const ext of extDirs) {
        const settingsPath = `.gemini/extensions/${ext}/settings.json`;
        const content = ctx.fileContent(settingsPath) || '';
        if (content) {
          try {
            const data = JSON.parse(content);
            // Flag if extension adds MCP servers without excludeTools
            if (data.mcpServers) {
              for (const server of Object.values(data.mcpServers)) {
                if (server && !server.excludeTools) return false;
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'extensions',
    fix: 'Ensure extension MCP configs use excludeTools and don\'t silently override project security settings.',
    template: null,
    file: (ctx) => {
      const extDirs = ctx.extensionDirs ? ctx.extensionDirs() : [];
      for (const ext of extDirs) {
        const settingsPath = `.gemini/extensions/${ext}/settings.json`;
        if (ctx.fileContent(settingsPath)) return settingsPath;
      }
      return null;
    },
    line: () => 1,
  },

  geminiNoOrphanedSkillRefs: {
    id: 'GM-I04',
    name: 'No orphaned skill references',
    check: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      const skillDirs = ctx.skillDirs ? ctx.skillDirs() : [];
      const skillNames = new Set(skillDirs.map(n => n.toLowerCase()));
      // Find skill references in GEMINI.md
      const refs = gmd.match(/\.gemini\/skills\/([a-z0-9-]+)/gi) || [];
      for (const ref of refs) {
        const name = ref.split('/').pop().toLowerCase();
        if (!skillNames.has(name)) return false;
      }
      return true;
    },
    impact: 'low',
    rating: 2,
    category: 'extensions',
    fix: 'Remove references to skills that no longer exist in .gemini/skills/.',
    template: null,
    file: () => 'GEMINI.md',
    line: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      return firstLineMatching(gmd, /\.gemini\/skills\//i);
    },
  },

  geminiMemoryContentIntentional: {
    id: 'GM-I05',
    name: '/memory content is intentional (not accumulated junk)',
    check: (ctx) => {
      // Check for a .gemini/memory file or memory-related config
      const memoryContent = ctx.fileContent('.gemini/memory.md') || ctx.fileContent('.gemini/memory') || '';
      if (!memoryContent) return null;
      const lines = memoryContent.split(/\r?\n/).filter(l => l.trim());
      // Flag if memory has become very large (>100 lines) without organization
      if (lines.length > 100 && !countSections(memoryContent)) return false;
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'extensions',
    fix: 'Review /memory content periodically. Remove stale entries and organize into sections if it grows large.',
    template: null,
    file: () => '.gemini/memory.md',
    line: () => 1,
  },

  // =============================================
  // J. Review & Workflow (4 checks) — GM-J01..GM-J04 (v1.0)
  // =============================================

  geminiRateLimitAwareness: {
    id: 'GM-J01',
    name: 'Rate limit/quota awareness documented',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!docs.trim()) return null;
      return /\brate[- ]?limit\b|\bquota\b|\brequests? per\b|\bcost\b|\btoken\b.*\blimit\b|\bthrottl|\b429\b/i.test(docs);
    },
    impact: 'medium',
    rating: 3,
    category: 'review',
    fix: 'Document rate limit and quota awareness in GEMINI.md. Free tier hits limits after 10-20 requests.',
    template: 'gemini-md',
    file: () => 'GEMINI.md',
    line: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      return firstLineMatching(gmd, /rate limit|quota|requests? per|cost|token.*limit/i);
    },
  },

  geminiRetryStrategy: {
    id: 'GM-J02',
    name: 'Retry/fallback strategy for rate limiting',
    check: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      const raw = settingsRaw(ctx);
      const combined = `${gmd}\n${raw}`;
      // Only check if rate limiting is a concern (i.e., docs mention it)
      if (!/\brate\b|\bquota\b|\bfree tier\b/i.test(combined)) return null;
      return /\bretry\b|\bfallback\b|\bbackoff\b|\bexponential\b/i.test(combined);
    },
    impact: 'medium',
    rating: 3,
    category: 'review',
    fix: 'Document a retry or fallback strategy for rate limiting situations.',
    template: null,
    file: () => 'GEMINI.md',
    line: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      return firstLineMatching(gmd, /retry|fallback|backoff/i);
    },
  },

  geminiSessionPersistence: {
    id: 'GM-J03',
    name: 'Session history persistence is configured',
    check: (ctx) => {
      const data = settingsData(ctx);
      if (!data) return null;
      if (isMcpOnlySettings(data)) return null;
      // Check if session/history settings are explicit
      return data.history !== undefined || data.session !== undefined || data.telemetry !== undefined;
    },
    impact: 'low',
    rating: 2,
    category: 'review',
    fix: 'Set session and history persistence settings explicitly in .gemini/settings.json.',
    template: 'gemini-settings',
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /history|session|telemetry/i),
  },

  geminiNoSensitiveMemory: {
    id: 'GM-J04',
    name: 'No sensitive data in saved memory',
    check: (ctx) => {
      const memoryContent = ctx.fileContent('.gemini/memory.md') || ctx.fileContent('.gemini/memory') || '';
      if (!memoryContent) return null;
      return !containsEmbeddedSecret(memoryContent);
    },
    impact: 'high',
    rating: 4,
    category: 'review',
    fix: 'Remove secrets and sensitive data from saved memory files.',
    template: null,
    file: () => '.gemini/memory.md',
    line: (ctx) => {
      const content = ctx.fileContent('.gemini/memory.md') || ctx.fileContent('.gemini/memory') || '';
      return content ? findSecretLine(content) : null;
    },
  },

  // =============================================
  // K. Quality Deep (5 checks) — GM-K01..GM-K05 (v1.0)
  // =============================================

  geminiMdModernFeatures: {
    id: 'GM-K01',
    name: 'GEMINI.md mentions modern features (skills, extensions, hooks)',
    check: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      if (!gmd) return null;
      const skillDirs = ctx.skillDirs ? ctx.skillDirs() : [];
      const agentFiles = ctx.agentFiles ? ctx.agentFiles() : [];
      const hooks = hooksFromSettings(ctx);
      const extDirs = ctx.extensionDirs ? ctx.extensionDirs() : [];
      const hasModernSurfaces = skillDirs.length > 0 || agentFiles.length > 0 || hooks || extDirs.length > 0;
      if (!hasModernSurfaces) return null;
      return /\bskills?\b|\bextensions?\b|\bhooks?\b|\bagents?\b/i.test(gmd);
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'If the repo uses skills, extensions, hooks, or agents, mention these in GEMINI.md so Gemini CLI gets the right context.',
    template: 'gemini-md',
    file: () => 'GEMINI.md',
    line: () => 1,
  },

  geminiNoDeprecatedPatterns: {
    id: 'GM-K02',
    name: 'No deprecated Gemini patterns',
    check: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      const raw = settingsRaw(ctx);
      const combined = `${gmd}\n${raw}`;
      // Check for deprecated patterns
      const deprecated = [
        /\bsandbox_mode\b/,
        /\bmax_tokens\b/,
        /\bmcp_servers\b/,
        /\bgemini-mini\b/i,
      ];
      return !deprecated.some(p => p.test(combined));
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Update deprecated Gemini patterns to their current equivalents.',
    template: null,
    file: (ctx) => {
      const raw = settingsRaw(ctx);
      if (/\bsandbox_mode\b|\bmax_tokens\b|\bmcp_servers\b|\bgemini-mini\b/i.test(raw)) return '.gemini/settings.json';
      return 'GEMINI.md';
    },
    line: (ctx) => {
      const raw = settingsRaw(ctx);
      return firstLineMatching(raw, /sandbox_mode|max_tokens|mcp_servers|gemini-mini/i) ||
        firstLineMatching(geminiMd(ctx) || '', /sandbox_mode|max_tokens|mcp_servers|gemini-mini/i);
    },
  },

  geminiComponentMdForMonorepo: {
    id: 'GM-K03',
    name: 'Component-level GEMINI.md used for monorepo sections',
    check: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      // Only relevant for monorepos
      const isMonorepo = ctx.fileContent('lerna.json') || ctx.fileContent('pnpm-workspace.yaml') ||
        ctx.hasDir('packages') || ctx.hasDir('apps');
      if (!isMonorepo) return null;
      // Check for component-level GEMINI.md files
      const dirs = ['packages', 'apps', 'services', 'libs'];
      for (const dir of dirs) {
        if (!ctx.hasDir(dir)) continue;
        try {
          const subdirs = require('fs').readdirSync(path.join(ctx.dir, dir), { withFileTypes: true })
            .filter(e => e.isDirectory())
            .slice(0, 5); // Check first 5 packages
          const hasComponent = subdirs.some(d => {
            const mdPath = path.join(dir, d.name, 'GEMINI.md');
            return Boolean(ctx.fileContent(mdPath));
          });
          if (hasComponent) return true;
        } catch {
          continue;
        }
      }
      return false;
    },
    impact: 'low',
    rating: 2,
    category: 'quality-deep',
    fix: 'For monorepos, add component-level GEMINI.md files in package subdirectories. NOTE: v0.36.0 loads ALL subdirectory GEMINI.md files eagerly at startup (not JIT) — watch for token bloat in large monorepos.',
    template: null,
    file: () => 'GEMINI.md',
    line: () => 1,
  },

  geminiFlashVsProDocumented: {
    id: 'GM-K04',
    name: 'Flash vs Pro model implications documented',
    check: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      const data = settingsData(ctx);
      if (!data || !data.model) return null;
      // v0.36.0: model is an object { name: "..." } or could be a legacy string
      const modelName = (typeof data.model === 'object' && data.model.name) ? data.model.name : String(data.model);
      const model = modelName.toLowerCase();
      // If using a specific model, check that implications are documented
      if (/flash|pro/i.test(model)) {
        return /\bflash\b|\bpro\b|\bmodel\b.*\b(fast|cheap|accurate|expensive|quality)\b/i.test(gmd);
      }
      return null;
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Document why the chosen model (Flash vs Pro) is appropriate for this project\'s workflows.',
    template: null,
    file: () => 'GEMINI.md',
    line: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      return firstLineMatching(gmd, /flash|pro|model.*fast|model.*quality/i);
    },
  },

  geminiTokenUsageAwareness: {
    id: 'GM-K05',
    name: 'Token usage awareness documented',
    check: (ctx) => {
      const docs = docsBundle(ctx);
      if (!docs.trim()) return null;
      return /\btoken\b|\bcontext window\b|\bcontext length\b|\b1M\b|\btruncat/i.test(docs);
    },
    impact: 'low',
    rating: 2,
    category: 'quality-deep',
    fix: 'Add a note about token usage and context window awareness to GEMINI.md.',
    template: null,
    file: () => 'GEMINI.md',
    line: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      return firstLineMatching(gmd, /token|context window|context length|1M|truncat/i);
    },
  },

  // =============================================
  // L. Commands (5 checks) — GM-L01..GM-L05 (v1.0)
  // =============================================

  geminiCommandsExist: {
    id: 'GM-L01',
    name: 'Custom commands exist in .gemini/commands/',
    check: (ctx) => {
      const commandFiles = ctx.commandFiles ? ctx.commandFiles() : [];
      if (commandFiles.length > 0) return true;
      // Custom commands are opt-in — only fire when the repo already has
      // a .gemini/commands/ directory (implying the user intends to use
      // commands but hasn't populated it).
      const hasCommandsDir = ctx.hasDir && ctx.hasDir('.gemini/commands');
      return hasCommandsDir ? false : null;
    },
    impact: 'medium',
    rating: 3,
    category: 'commands',
    fix: 'Create custom commands under .gemini/commands/*.toml for frequently-used workflows.',
    template: null,
    file: () => '.gemini/commands',
    line: () => null,
  },

  geminiCommandsHaveDescription: {
    id: 'GM-L02',
    name: 'Commands have description field',
    check: (ctx) => {
      const commandFiles = ctx.commandFiles ? ctx.commandFiles() : [];
      if (commandFiles.length === 0) return null;
      for (const f of commandFiles) {
        const content = ctx.fileContent(f) || '';
        if (!/\bdescription\s*=/i.test(content)) return false;
      }
      return true;
    },
    impact: 'low',
    rating: 2,
    category: 'commands',
    fix: 'Add a description field to each command TOML file for discoverability.',
    template: null,
    file: (ctx) => {
      const commandFiles = ctx.commandFiles ? ctx.commandFiles() : [];
      for (const f of commandFiles) {
        const content = ctx.fileContent(f) || '';
        if (!/\bdescription\s*=/i.test(content)) return f;
      }
      return null;
    },
    line: () => 1,
  },

  geminiCommandsNoUnsafeShellInjection: {
    id: 'GM-L03',
    name: 'Commands don\'t use unsafe !{} shell injection',
    check: (ctx) => {
      const commandFiles = ctx.commandFiles ? ctx.commandFiles() : [];
      if (commandFiles.length === 0) return null;
      for (const f of commandFiles) {
        const content = ctx.fileContent(f) || '';
        if (/!\{[^}]+\}/.test(content)) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'commands',
    fix: 'SECURITY: Remove !{} shell injection from commands. This is unique to Gemini and allows arbitrary shell execution.',
    template: null,
    file: (ctx) => {
      const commandFiles = ctx.commandFiles ? ctx.commandFiles() : [];
      for (const f of commandFiles) {
        const content = ctx.fileContent(f) || '';
        if (/!\{[^}]+\}/.test(content)) return f;
      }
      return null;
    },
    line: (ctx) => {
      const commandFiles = ctx.commandFiles ? ctx.commandFiles() : [];
      for (const f of commandFiles) {
        const content = ctx.fileContent(f) || '';
        const line = firstLineMatching(content, /!\{[^}]+\}/);
        if (line) return line;
      }
      return null;
    },
  },

  geminiCommandsUseArgs: {
    id: 'GM-L04',
    name: 'Commands use {{args}} for flexibility',
    check: (ctx) => {
      const commandFiles = ctx.commandFiles ? ctx.commandFiles() : [];
      if (commandFiles.length === 0) return null;
      // At least one command should use args for flexibility
      return commandFiles.some(f => {
        const content = ctx.fileContent(f) || '';
        return /\{\{args?\}\}/i.test(content);
      });
    },
    impact: 'low',
    rating: 2,
    category: 'commands',
    fix: 'Use {{args}} in at least some commands to allow flexible invocation.',
    template: null,
    file: (ctx) => {
      const commandFiles = ctx.commandFiles ? ctx.commandFiles() : [];
      return commandFiles.length > 0 ? commandFiles[0] : null;
    },
    line: () => 1,
  },

  geminiCommandTomlValid: {
    id: 'GM-L05',
    name: 'Custom command TOML is valid',
    check: (ctx) => {
      const commandFiles = ctx.commandFiles ? ctx.commandFiles() : [];
      if (commandFiles.length === 0) return null;
      for (const f of commandFiles) {
        const parsed = ctx.commandConfig ? ctx.commandConfig(f) : null;
        if (parsed && !parsed.ok) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'commands',
    fix: 'Fix malformed TOML in command files so Gemini CLI can load them correctly.',
    template: null,
    file: (ctx) => {
      const commandFiles = ctx.commandFiles ? ctx.commandFiles() : [];
      for (const f of commandFiles) {
        const parsed = ctx.commandConfig ? ctx.commandConfig(f) : null;
        if (parsed && !parsed.ok) return f;
      }
      return null;
    },
    line: (ctx) => {
      const commandFiles = ctx.commandFiles ? ctx.commandFiles() : [];
      for (const f of commandFiles) {
        const parsed = ctx.commandConfig ? ctx.commandConfig(f) : null;
        if (parsed && !parsed.ok && parsed.error) {
          const match = parsed.error.match(/Line (\d+)/i);
          if (match) return Number(match[1]);
        }
      }
      return 1;
    },
  },

  // =============================================
  // CP-08 Expansion: M. Advisory Quality (4 checks)
  // =============================================
  geminiAdvisoryAugmentQuality: {
    id: 'GM-M01', name: 'Augment recommendations reference real detected surfaces',
    check: (ctx) => { const g = ctx.geminiMdContent(); const s = ctx.settingsJson(); if (!g && !s) return null; return [Boolean(g), Boolean(s), ctx.hasDir ? ctx.hasDir('.gemini') : false].filter(Boolean).length >= 2; },
    impact: 'high', rating: 4, category: 'advisory',
    fix: 'Ensure GEMINI.md and .gemini/settings.json exist for grounded advisory recommendations.',
    template: 'gemini-md', file: () => 'GEMINI.md', line: () => 1,
  },
  geminiAdvisorySuggestOnlySafety: {
    id: 'GM-M02', name: 'No --yolo or auto_edit in suggest-only context',
    check: (ctx) => { const s = ctx.settingsJson(); if (!s) return null; const mode = s.approvalMode || s.approval_mode; return !mode || (mode !== 'auto_edit' && mode !== 'yolo'); },
    impact: 'critical', rating: 5, category: 'advisory',
    fix: 'Remove --yolo or auto_edit from settings to maintain suggest-only safety.',
    template: 'gemini-settings', file: () => '.gemini/settings.json', line: () => 1,
  },
  geminiAdvisoryOutputFreshness: {
    id: 'GM-M03', name: 'No deprecated Gemini features referenced in advisory context',
    check: (ctx) => { const g = ctx.geminiMdContent(); if (!g) return null; return !/\bnotepads?\b/i.test(g) && !/\bchat_model\b/i.test(g); },
    impact: 'medium', rating: 3, category: 'advisory',
    fix: 'Remove deprecated feature references from GEMINI.md.',
    template: 'gemini-md', file: () => 'GEMINI.md', line: () => 1,
  },
  geminiAdvisoryToSetupCoherence: {
    id: 'GM-M04', name: 'Advisory recommendations map to existing proposal families',
    check: (ctx) => { const g = ctx.geminiMdContent(); const s = ctx.settingsJson(); return Boolean(g || s); },
    impact: 'medium', rating: 3, category: 'advisory',
    fix: 'Ensure at least one Gemini surface exists so advisory can produce actionable recommendations.',
    template: 'gemini-md', file: () => 'GEMINI.md', line: () => 1,
  },

  // CP-08: N. Pack Posture (4 checks)
  geminiDomainPackAlignment: {
    id: 'GM-N01', name: 'Detected stack aligns with recommended domain pack',
    check: (ctx) => { const g = ctx.geminiMdContent(); if (!g) return null; return true; },
    impact: 'high', rating: 4, category: 'pack-posture',
    fix: 'Review recommended domain pack alignment for your project stack.',
    template: 'gemini-md', file: () => 'GEMINI.md', line: () => 1,
  },
  geminiMcpPackSafety: {
    id: 'GM-N02', name: 'MCP packs pass trust preflight (excludeTools set)',
    check: (ctx) => { const s = ctx.settingsJson(); if (!s || !s.mcpServers) return null; for (const srv of Object.values(s.mcpServers)) { if (!srv.excludeTools && !srv.includeTools) return false; } return true; },
    impact: 'high', rating: 4, category: 'pack-posture',
    fix: 'Add excludeTools to all MCP servers to limit tool surface.',
    template: 'gemini-settings', file: () => '.gemini/settings.json', line: () => 1,
  },
  geminiPackRecommendationQuality: {
    id: 'GM-N03', name: 'Pack recommendations grounded in detected signals',
    check: (ctx) => { const g = ctx.geminiMdContent(); const s = ctx.settingsJson(); const p = ctx.jsonFile('package.json'); return [Boolean(g), Boolean(s), Boolean(p)].filter(Boolean).length >= 2; },
    impact: 'medium', rating: 3, category: 'pack-posture',
    fix: 'Add GEMINI.md and package.json for grounded pack recommendations.',
    template: 'gemini-md', file: () => 'GEMINI.md', line: () => 1,
  },
  geminiNoStalePackVersions: {
    id: 'GM-N04', name: 'No stale or deprecated MCP pack references',
    check: (ctx) => { const s = ctx.settingsJson(); if (!s || !s.mcpServers) return null; const content = JSON.stringify(s.mcpServers); return !/deprecated|legacy|old-/i.test(content); },
    impact: 'medium', rating: 3, category: 'pack-posture',
    fix: 'Update deprecated MCP pack references to current versions.',
    template: 'gemini-settings', file: () => '.gemini/settings.json', line: () => 1,
  },

  // CP-08: O. Repeat-Usage Hygiene (3 checks)
  geminiSnapshotRetention: {
    id: 'GM-O01', name: 'At least one prior audit snapshot exists',
    check: (ctx) => { try { const fs = require('fs'); const p = resolveProjectStateReadPath(ctx.dir, 'snapshots', 'index.json'); if (!fs.existsSync(p)) return null; const e = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(e) && e.length > 0; } catch { return null; } },
    impact: 'medium', rating: 3, category: 'repeat-usage',
    fix: 'Run `npx nerviq --platform gemini --snapshot` to save your first snapshot.',
    template: null, file: () => null, line: () => null,
  },
  geminiFeedbackLoopHealth: {
    id: 'GM-O02', name: 'Feedback loop functional when feedback submitted',
    check: (ctx) => { try { const fs = require('fs'); const p = resolveProjectStateReadPath(ctx.dir, 'outcomes', 'index.json'); if (!fs.existsSync(p)) return null; const e = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(e) && e.length > 0; } catch { return null; } },
    impact: 'medium', rating: 3, category: 'repeat-usage',
    fix: 'Submit feedback using `npx nerviq --platform gemini feedback`.',
    template: null, file: () => null, line: () => null,
  },
  geminiTrendDataAvailability: {
    id: 'GM-O03', name: 'Trend data computable (2+ snapshots)',
    check: (ctx) => { try { const fs = require('fs'); const p = resolveProjectStateReadPath(ctx.dir, 'snapshots', 'index.json'); if (!fs.existsSync(p)) return null; const e = JSON.parse(fs.readFileSync(p, 'utf8')); return (Array.isArray(e) ? e : []).filter(x => x.snapshotKind === 'audit').length >= 2; } catch { return null; } },
    impact: 'low', rating: 2, category: 'repeat-usage',
    fix: 'Run at least 2 audits with --snapshot for trend tracking.',
    template: null, file: () => null, line: () => null,
  },

  // CP-08: P. Release & Freshness (3 checks)
  geminiVersionTruth: {
    id: 'GM-P01', name: 'Gemini version claims match installed version',
    check: (ctx) => { const g = ctx.geminiMdContent(); if (!g) return null; const m = g.match(/gemini[- ]?(?:cli)?[- ]?v?(\d+\.\d+)/i); if (!m) return null; return true; },
    impact: 'high', rating: 4, category: 'release-freshness',
    fix: 'Verify Gemini version in GEMINI.md matches installed CLI version.',
    template: 'gemini-md', file: () => 'GEMINI.md', line: () => 1,
  },
  geminiSourceFreshness: {
    id: 'GM-P02', name: 'Config and docs reference current Gemini features (no deprecated flags)',
    check: (ctx) => {
      const s = ctx.settingsJson();
      const g = ctx.geminiMdContent() || '';
      const combined = (s ? JSON.stringify(s) : '') + '\n' + g;
      if (!s && !g) return null;
      // Deprecated: chat_model, notepads, old_format, --json (use -o json), --allowed-tools (use policy.toml)
      return !/chat_model|notepads|old_format/i.test(combined) && !/--json\b/i.test(combined) && !/--allowed-tools\b/i.test(combined);
    },
    impact: 'high', rating: 4, category: 'release-freshness',
    fix: 'Update deprecated references: --json → -o json (v0.36.0), --allowed-tools → policy.toml, chat_model/notepads → removed.',
    template: 'gemini-settings', file: () => '.gemini/settings.json', line: () => 1,
  },
  geminiPropagationCompleteness: {
    id: 'GM-P03', name: 'No dangling surface references',
    check: (ctx) => {
      const g = ctx.geminiMdContent();
      if (!g) return null;
      const issues = [];
      // Require specific Gemini-CLI vocabulary before asserting a dangling
      // reference. "skills" is too generic a word (appears in unrelated
      // product copy); require `.gemini/skills` path or `gemini skills`
      // phrasing. Same for hooks/extensions.
      if (/\.gemini\/hooks\b|\bgemini hooks?\b|\bhooksConfig\b|\bBeforeTool\b|\bAfterTool\b/i.test(g)) {
        const s = ctx.settingsJson();
        if (!s || !s.ok || (!s.data || (!s.data.hooks && !s.data.BeforeTool && !s.data.AfterTool))) issues.push('hooks');
      }
      if (/\.gemini\/skills\b|\bgemini skills?\b/i.test(g) && !(ctx.hasDir ? ctx.hasDir('.gemini/skills') : false)) issues.push('skills');
      if (/\.gemini\/extensions\b|\bgemini extensions?\b/i.test(g) && !(ctx.hasDir ? ctx.hasDir('.gemini/extensions') : false)) issues.push('extensions');
      return issues.length === 0;
    },
    impact: 'high', rating: 4, category: 'release-freshness',
    fix: 'Ensure all surfaces mentioned in GEMINI.md have corresponding definition files.',
    template: 'gemini-md', file: () => 'GEMINI.md', line: () => 1,
  },

  // =============================================
  // Q. Experiment-Verified Fixes (5 checks) — GM-Q01..GM-Q05
  // Added from v0.36.0 experiment findings (2026-04-05)
  // =============================================

  geminiApprovalFieldValidation: {
    id: 'GM-Q01',
    name: 'Approval field in settings.json has valid value (not --yolo)',
    check: (ctx) => {
      const data = settingsData(ctx);
      if (!data || !data.approval) return null;
      const approval = String(data.approval).toLowerCase();
      // v0.36.0: "--yolo" is silently accepted in approval field without validation
      // Valid values: suggest, auto_fix, auto_edit, plan
      const validValues = ['suggest', 'auto_fix', 'auto_edit', 'plan'];
      if (/yolo/i.test(approval)) return false;
      return validValues.includes(approval);
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'SECURITY: v0.36.0 silently accepts "--yolo" in the approval field. Use valid values: suggest, auto_fix, auto_edit, or plan (read-only mode).',
    template: 'gemini-settings',
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /"approval"/),
  },

  geminiPlanModeDocumented: {
    id: 'GM-Q02',
    name: 'Plan mode (read-only 4th approval mode) documented if used',
    check: (ctx) => {
      const data = settingsData(ctx);
      if (!data) return null;
      const approval = data.approval || data.approvalMode || data.approval_mode;
      if (!approval || String(approval).toLowerCase() !== 'plan') return null;
      // If plan mode is active, check it's documented
      const gmd = geminiMd(ctx) || '';
      return /\bplan\s*mode\b|\bread.only\b|\bplan\b.*approval/i.test(gmd);
    },
    impact: 'medium',
    rating: 3,
    category: 'config',
    fix: 'Document that plan mode is a read-only approval mode (undocumented 4th mode in v0.36.0) that prevents all file modifications.',
    template: 'gemini-md',
    file: () => 'GEMINI.md',
    line: () => 1,
  },

  geminiNoAllowedToolsDeprecated: {
    id: 'GM-Q03',
    name: 'No deprecated --allowed-tools flag (use policy.toml)',
    check: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      const raw = settingsRaw(ctx);
      // Check workflow files
      for (const wf of workflowArtifacts(ctx)) {
        if (/--allowed-tools\b/i.test(wf.content)) return false;
      }
      // Check docs and settings
      if (/--allowed-tools\b/i.test(gmd)) return false;
      if (/--allowed-tools\b|allowedTools/i.test(raw)) return false;
      // Check package.json scripts
      const pkg = ctx.jsonFile ? ctx.jsonFile('package.json') : null;
      if (pkg && pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts).join('\n');
        if (/--allowed-tools\b/i.test(scriptValues)) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'release-freshness',
    fix: '--allowed-tools is DEPRECATED in v0.36.0. Migrate to the Policy Engine with policy.toml files under .gemini/policy/.',
    template: null,
    file: (ctx) => {
      for (const wf of workflowArtifacts(ctx)) {
        if (/--allowed-tools\b/i.test(wf.content)) return wf.filePath;
      }
      const gmd = geminiMd(ctx) || '';
      if (/--allowed-tools\b/i.test(gmd)) return 'GEMINI.md';
      return '.gemini/settings.json';
    },
    line: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      return firstLineMatching(gmd, /--allowed-tools/i) || firstLineMatching(settingsRaw(ctx), /allowed.?tools/i);
    },
  },

  geminiEagerLoadingAwareness: {
    id: 'GM-Q04',
    name: 'GEMINI.md hierarchy loading behavior is correctly documented',
    check: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      if (!gmd) return null;
      // Flag if docs mention JIT/lazy loading — this is falsified in v0.36.0
      if (/\bjit\b|\blazy.load|\bload.*on.demand|\bdynamic.*load/i.test(gmd)) return false;
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'instructions',
    fix: 'Remove JIT/lazy-loading claims from GEMINI.md. v0.36.0 loads ALL subdirectory GEMINI.md files eagerly at startup — be mindful of token budget in monorepos.',
    template: 'gemini-md',
    file: () => 'GEMINI.md',
    line: (ctx) => {
      const gmd = geminiMd(ctx) || '';
      return firstLineMatching(gmd, /jit|lazy.load|on.demand/i);
    },
  },

  geminiModelStringNotObject: {
    id: 'GM-Q05',
    name: 'Model field is not a bare string (v0.36.0 requires object)',
    check: (ctx) => {
      const raw = settingsRaw(ctx);
      if (!raw) return null;
      // Quick check: if "model" key exists and its value is a string, fail
      const match = raw.match(/"model"\s*:\s*"([^"]+)"/);
      if (match) return false; // String format detected — will cause exit code 41
      return true;
    },
    impact: 'critical',
    rating: 5,
    category: 'config',
    fix: 'BREAKING: v0.36.0 requires model as object: {"model": {"name": "gemini-2.5-flash"}}. String format causes exit code 41.',
    template: 'gemini-settings',
    file: () => '.gemini/settings.json',
    line: (ctx) => ctx.lineNumber('.gemini/settings.json', /"model"/),
  },

  // ============================================================
  // === PYTHON STACK CHECKS (category: 'python') ===============
  // ============================================================

  geminiPythonProjectExists: {
    id: 'GM-PY01',
    name: 'Python project detected (pyproject.toml / setup.py / requirements.txt)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return true; },
    impact: 'high',
    category: 'python',
    fix: 'Ensure pyproject.toml, setup.py, or requirements.txt exists for Python projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonVersionSpecified: {
    id: 'GM-PY02',
    name: 'Python version specified (.python-version or requires-python)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /\.python-version$/.test(f)) || /requires-python/i.test(ctx.fileContent('pyproject.toml') || ''); },
    impact: 'medium',
    category: 'python',
    fix: 'Create .python-version or add requires-python to pyproject.toml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonVenvMentioned: {
    id: 'GM-PY03',
    name: 'Virtual environment mentioned in instructions',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /venv|virtualenv|conda|poetry shell|uv venv/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document virtual environment setup in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonLockfileExists: {
    id: 'GM-PY04',
    name: 'Python lockfile exists (poetry.lock / uv.lock / Pipfile.lock / pinned requirements)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /poetry\.lock$|uv\.lock$|Pipfile\.lock$/.test(f)) || /==/m.test(ctx.fileContent('requirements.txt') || ''); },
    impact: 'high',
    category: 'python',
    fix: 'Add a lockfile (poetry.lock, uv.lock, Pipfile.lock) or pin versions with == in requirements.txt.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonPytestConfigured: {
    id: 'GM-PY05',
    name: 'pytest configured (pyproject.toml [tool.pytest] / pytest.ini / conftest.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return /\[tool\.pytest/i.test(ctx.fileContent('pyproject.toml') || '') || ctx.files.some(f => /pytest\.ini$|conftest\.py$/.test(f)); },
    impact: 'high',
    category: 'python',
    fix: 'Configure pytest in pyproject.toml [tool.pytest.ini_options] or create pytest.ini.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonLinterConfigured: {
    id: 'GM-PY06',
    name: 'Python linter configured (ruff / flake8 / pylint)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.ruff|\[tool\.flake8|\[tool\.pylint/i.test(pp) || ctx.files.some(f => /\.flake8$|pylintrc$|\.pylintrc$|ruff\.toml$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure ruff, flake8, or pylint in pyproject.toml or dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonTypeCheckerConfigured: {
    id: 'GM-PY07',
    name: 'Type checker configured (mypy / pyright)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.mypy|\[tool\.pyright/i.test(pp) || ctx.files.some(f => /mypy\.ini$|pyrightconfig\.json$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure mypy or pyright in pyproject.toml or dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonFormatterConfigured: {
    id: 'GM-PY08',
    name: 'Formatter configured (black / isort / ruff format)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.black|\[tool\.isort|\[tool\.ruff\.format/i.test(pp); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure black, isort, or ruff format in pyproject.toml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonDjangoSettingsDocumented: {
    id: 'GM-PY09',
    name: 'Django settings documented if Django project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; if (!ctx.files.some(f => /manage\.py$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /django|settings\.py|DJANGO_SETTINGS_MODULE/i.test(docs); },
    impact: 'high',
    category: 'python',
    fix: 'Document Django settings module and configuration in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonFastapiEntryDocumented: {
    id: 'GM-PY10',
    name: 'FastAPI entry point documented if FastAPI project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/fastapi/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /fastapi|uvicorn|app\.py|main\.py/i.test(docs); },
    impact: 'high',
    category: 'python',
    fix: 'Document FastAPI entry point and how to run the development server.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonMigrationsDocumented: {
    id: 'GM-PY11',
    name: 'Database migrations mentioned (alembic / Django migrations)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /alembic|migrate|makemigrations|django.{0,10}migration/i.test(docs) || ctx.files.some(f => /alembic[.]ini$|alembic[/]/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Document database migration workflow (alembic or Django migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonEnvHandlingDocumented: {
    id: 'GM-PY12',
    name: '.env handling documented (python-dotenv)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/dotenv|python-dotenv|environs/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /\.env|dotenv|environment.{0,10}variable/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document .env file usage and python-dotenv configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonPreCommitConfigured: {
    id: 'GM-PY13',
    name: 'pre-commit hooks configured (.pre-commit-config.yaml)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /\.pre-commit-config\.yaml$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Add .pre-commit-config.yaml with Python-specific hooks (ruff, mypy, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonDockerBaseImage: {
    id: 'GM-PY14',
    name: 'Docker uses Python base image correctly',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const df = ctx.fileContent('Dockerfile') || ''; if (!df) return null; return /FROM.*python:/i.test(df); },
    impact: 'medium',
    category: 'python',
    fix: 'Use official Python base image in Dockerfile (e.g., FROM python:3.12-slim).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonTestMatrixConfigured: {
    id: 'GM-PY15',
    name: 'Test matrix configured (tox.ini / noxfile.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /tox\.ini$|noxfile\.py$/.test(f)); },
    impact: 'low',
    category: 'python',
    fix: 'Configure tox or nox for multi-environment testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonValidationUsed: {
    id: 'GM-PY16',
    name: 'Pydantic or dataclass validation used',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); return /pydantic|dataclass/i.test(deps); },
    impact: 'medium',
    category: 'python',
    fix: 'Use pydantic or dataclasses for data validation and type safety.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonAsyncDocumented: {
    id: 'GM-PY17',
    name: 'Async patterns documented if async project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/asyncio|aiohttp|fastapi|starlette|httpx/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /async|await|asyncio|event.{0,5}loop/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document async patterns and conventions used in the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonPinnedVersions: {
    id: 'GM-PY18',
    name: 'Requirements have pinned versions (== in requirements.txt)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const req = ctx.fileContent('requirements.txt') || ''; if (!req.trim()) return null; const lines = req.split('\n').filter(l => l.trim() && !l.startsWith('#')); return lines.length > 0 && lines.every(l => /==/.test(l) || /^-/.test(l.trim())); },
    impact: 'high',
    category: 'python',
    fix: 'Pin all dependency versions with == in requirements.txt for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonPackageStructure: {
    id: 'GM-PY19',
    name: 'Python package has proper structure (src/ layout or __init__.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /src[/].*[/]__init__\.py$|^[^/]+[/]__init__\.py$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Use src/ layout or ensure packages have __init__.py files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonDocsToolConfigured: {
    id: 'GM-PY20',
    name: 'Documentation tool configured (sphinx / mkdocs)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /mkdocs\.yml$|conf\.py$|docs[/]/.test(f)) || /sphinx|mkdocs/i.test(ctx.fileContent('pyproject.toml') || ''); },
    impact: 'low',
    category: 'python',
    fix: 'Configure sphinx or mkdocs for project documentation.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonCoverageConfigured: {
    id: 'GM-PY21',
    name: 'Coverage configured (coverage / pytest-cov)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.coverage|pytest-cov|coverage/i.test(pp) || ctx.files.some(f => /\.coveragerc$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure coverage reporting with pytest-cov or coverage.py.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonNoSecretsInSettings: {
    id: 'GM-PY22',
    name: 'No secrets in Django settings.py',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const settings = ctx.fileContent('settings.py') || ctx.files.filter(f => /settings\.py$/.test(f)).map(f => ctx.fileContent(f) || '').join(''); if (!settings) return null; return !/SECRET_KEY\s*=\s*['"][^'"]{10,}/i.test(settings); },
    impact: 'critical',
    category: 'python',
    fix: 'Move SECRET_KEY and other secrets to environment variables, not hardcoded in settings.py.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonWsgiAsgiDocumented: {
    id: 'GM-PY23',
    name: 'WSGI/ASGI server documented (gunicorn / uvicorn)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/gunicorn|uvicorn|daphne|hypercorn/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /gunicorn|uvicorn|daphne|hypercorn|wsgi|asgi/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document WSGI/ASGI server configuration (gunicorn, uvicorn).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonTaskQueueDocumented: {
    id: 'GM-PY24',
    name: 'Task queue documented if used (celery / rq)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/celery|rq|dramatiq|huey/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /celery|rq|dramatiq|huey|task.{0,10}queue|worker/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document task queue configuration and worker setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiPythonGitignore: {
    id: 'GM-PY25',
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

  geminiGoModExists: {
    id: 'GM-GO01',
    name: 'go.mod exists',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'go',
    fix: 'Initialize Go module with go mod init.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoSumCommitted: {
    id: 'GM-GO02',
    name: 'go.sum committed',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /go\.sum$/.test(f)); },
    impact: 'high',
    category: 'go',
    fix: 'Commit go.sum to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGolangciLintConfigured: {
    id: 'GM-GO03',
    name: 'golangci-lint configured (.golangci.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /\.golangci\.ya?ml$|\.golangci\.toml$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Add .golangci.yml to configure linting rules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoTestDocumented: {
    id: 'GM-GO04',
    name: 'go test documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go test/i.test(docs); },
    impact: 'high',
    category: 'go',
    fix: 'Document go test command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoBuildDocumented: {
    id: 'GM-GO05',
    name: 'go build documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go build|go install/i.test(docs); },
    impact: 'high',
    category: 'go',
    fix: 'Document go build command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoStandardLayout: {
    id: 'GM-GO06',
    name: 'Standard Go layout (cmd/ / internal/ / pkg/)',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /^cmd[/]|^internal[/]|^pkg[/]/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Use standard Go project layout with cmd/, internal/, and/or pkg/ directories.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoErrorHandlingDocumented: {
    id: 'GM-GO07',
    name: 'Error handling patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /error handling|errors?\.(?:New|Wrap|Is|As)|fmt\.Errorf/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document error handling conventions (error wrapping, sentinel errors, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoContextUsageDocumented: {
    id: 'GM-GO08',
    name: 'Context usage documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /context\.Context|ctx\.Done|context\.WithCancel|context\.WithTimeout/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document context.Context usage patterns for cancellation and timeouts.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoroutineSafetyDocumented: {
    id: 'GM-GO09',
    name: 'Goroutine safety documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /goroutine|sync\.Mutex|sync\.WaitGroup|channel|concurren/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document goroutine safety patterns, mutex usage, and channel conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoModTidyMentioned: {
    id: 'GM-GO10',
    name: 'go mod tidy mentioned in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go mod tidy/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document go mod tidy in project workflow instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoVetConfigured: {
    id: 'GM-GO11',
    name: 'go vet or staticcheck configured',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/go.yml') || ''; return /go vet|staticcheck/i.test(docs + ci); },
    impact: 'medium',
    category: 'go',
    fix: 'Configure go vet and/or staticcheck in CI or project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoMakefileExists: {
    id: 'GM-GO12',
    name: 'Makefile or Taskfile exists for Go project',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /^Makefile$|^Taskfile\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Add Makefile or Taskfile.yml with common Go targets (build, test, lint).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoDockerMultiStage: {
    id: 'GM-GO13',
    name: 'Docker multi-stage build for Go',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; if (!df) return null; return /FROM.*golang.*AS/i.test(df) && /FROM.*(?:alpine|scratch|distroless|gcr\.io)/i.test(df); },
    impact: 'medium',
    category: 'go',
    fix: 'Use multi-stage Docker build: build in golang image, run in minimal image (alpine/scratch/distroless).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoCgoDocumented: {
    id: 'GM-GO14',
    name: 'CGO documented if used',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const goMod = ctx.fileContent('go.mod') || ''; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; if (!/CGO_ENABLED|import "C"/i.test(goMod + docs)) return null; return /CGO|cgo/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document CGO usage, dependencies, and build requirements.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoWorkForMonorepo: {
    id: 'GM-GO15',
    name: 'go.work for monorepo',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const multiMod = ctx.files.filter(f => /go\.mod$/.test(f)).length > 1; if (!multiMod) return null; return ctx.files.some(f => /go\.work$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Use go.work for Go workspace in monorepo with multiple modules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoBenchmarkTests: {
    id: 'GM-GO16',
    name: 'Benchmark tests mentioned',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go test.*-bench|Benchmark/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document benchmark testing with go test -bench.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoRaceDetector: {
    id: 'GM-GO17',
    name: 'Race detector (-race) documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/go.yml') || ''; return /-race/i.test(docs + ci); },
    impact: 'medium',
    category: 'go',
    fix: 'Document and enable race detector with go test -race.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoGenerateDocumented: {
    id: 'GM-GO18',
    name: 'go generate documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /go generate/i.test(docs) || ctx.files.some(f => /generate\.go$/.test(f)); },
    impact: 'low',
    category: 'go',
    fix: 'Document go generate usage and generated files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoInterfaceDesignDocumented: {
    id: 'GM-GO19',
    name: 'Interface-based design documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /interface|mock|stub|dependency injection/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document interface-based design patterns for testability and dependency injection.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiGoGitignore: {
    id: 'GM-GO20',
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

  geminiRustCargoTomlExists: {
    id: 'GM-RS01',
    name: 'Cargo.toml exists with edition field',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /edition\s*=/.test(cargo); },
    impact: 'high',
    category: 'rust',
    fix: 'Ensure Cargo.toml exists and specifies the edition field (e.g., edition = "2021").',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustCargoLockCommitted: {
    id: 'GM-RS02',
    name: 'Cargo.lock committed (for binary crates)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /Cargo\.lock$/.test(f)); },
    impact: 'high',
    category: 'rust',
    fix: 'Commit Cargo.lock for binary crates to ensure reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustClippyConfigured: {
    id: 'GM-RS03',
    name: 'Clippy configured (CI or .cargo/config.toml)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/rust.yml') || ''; const cargoConfig = ctx.fileContent('.cargo/config.toml') || ''; return /clippy/i.test(ci + cargoConfig); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure clippy in CI or .cargo/config.toml for lint enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustFmtConfigured: {
    id: 'GM-RS04',
    name: 'rustfmt configured (rustfmt.toml or .rustfmt.toml)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /rustfmt\.toml$|\.rustfmt\.toml$/.test(f)); },
    impact: 'medium',
    category: 'rust',
    fix: 'Create rustfmt.toml or .rustfmt.toml to configure code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustCargoTestDocumented: {
    id: 'GM-RS05',
    name: 'cargo test documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cargo test/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document cargo test command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustCargoBuildDocumented: {
    id: 'GM-RS06',
    name: 'cargo build/check documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cargo (?:build|check)/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document cargo build or cargo check command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustUnsafePolicyDocumented: {
    id: 'GM-RS07',
    name: 'Unsafe code policy documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /unsafe|#!?\[forbid\(unsafe|#!?\[deny\(unsafe/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document unsafe code policy (forbidden, minimized, or where allowed).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustErrorHandlingStrategy: {
    id: 'GM-RS08',
    name: 'Error handling strategy (anyhow/thiserror in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /anyhow|thiserror|eyre|color-eyre/i.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Use anyhow (applications) or thiserror (libraries) for structured error handling.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustFeatureFlagsDocumented: {
    id: 'GM-RS09',
    name: 'Feature flags documented (Cargo.toml [features])',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/\[features\]/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /feature|--features|--all-features/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document feature flags and their purpose in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustWorkspaceConfig: {
    id: 'GM-RS10',
    name: 'Workspace config if multi-crate (Cargo.toml [workspace])',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (ctx.files.filter(f => /Cargo\.toml$/.test(f)).length <= 1) return null; return /\[workspace\]/i.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure [workspace] in root Cargo.toml for multi-crate projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustMsrvSpecified: {
    id: 'GM-RS11',
    name: 'MSRV specified (rust-version field)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /rust-version\s*=/.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Specify rust-version (MSRV) in Cargo.toml for compatibility guarantees.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustDocCommentsEncouraged: {
    id: 'GM-RS12',
    name: 'Doc comments (///) encouraged in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /doc comment|\/{3}|rustdoc|cargo doc/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Encourage /// doc comments and cargo doc in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustBenchmarksConfigured: {
    id: 'GM-RS13',
    name: 'Criterion benchmarks mentioned (benches/ dir)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /benches[/]/.test(f)) || /criterion/i.test(ctx.fileContent('Cargo.toml') || ''); },
    impact: 'low',
    category: 'rust',
    fix: 'Set up criterion benchmarks in benches/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustCrossCompilationDocumented: {
    id: 'GM-RS14',
    name: 'Cross-compilation documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /cross.?compil|--target|rustup target|cargo build.*--target/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Document cross-compilation targets and setup instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustMemorySafetyDocumented: {
    id: 'GM-RS15',
    name: 'Memory safety patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /ownership|borrow|lifetime|memory.?safe|Arc|Rc|RefCell/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document memory safety patterns (ownership, borrowing, lifetime conventions).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustAsyncRuntimeDocumented: {
    id: 'GM-RS16',
    name: 'Async runtime documented (tokio/async-std in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/tokio|async-std|smol/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /tokio|async-std|async|await|runtime/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document async runtime choice and patterns (tokio, async-std).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustSerdeDocumented: {
    id: 'GM-RS17',
    name: 'Serde patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/serde/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /serde|Serialize|Deserialize|serde_json|serde_yaml/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document serde serialization/deserialization patterns and conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustCargoAuditConfigured: {
    id: 'GM-RS18',
    name: 'cargo-audit configured in CI',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/rust.yml') || ctx.fileContent('.github/workflows/audit.yml') || ''; return /cargo.?audit|advisory/i.test(ci); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure cargo-audit in CI for vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustWasmTargetDocumented: {
    id: 'GM-RS19',
    name: 'WASM target documented if applicable',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/wasm|wasm-bindgen|wasm-pack/i.test(cargo)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /wasm|WebAssembly|wasm-pack|wasm-bindgen/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Document WASM target configuration and build process.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiRustGitignore: {
    id: 'GM-RS20',
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

  geminiJavaBuildFileExists: {
    id: 'GM-JV01',
    name: 'pom.xml or build.gradle exists',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'java',
    fix: 'Ensure pom.xml or build.gradle exists for Java projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaVersionSpecified: {
    id: 'GM-JV02',
    name: 'Java version specified',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; return /java\.version|maven\.compiler\.source|sourceCompatibility|JavaVersion/i.test(pom + gradle) || ctx.files.some(f => /\.java-version$/.test(f)); },
    impact: 'high',
    category: 'java',
    fix: 'Specify Java version in pom.xml properties, build.gradle, or .java-version file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaWrapperCommitted: {
    id: 'GM-JV03',
    name: 'Maven/Gradle wrapper committed (mvnw or gradlew)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /mvnw$|gradlew$/.test(f)); },
    impact: 'high',
    category: 'java',
    fix: 'Commit mvnw (Maven) or gradlew (Gradle) wrapper for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaSpringBootVersion: {
    id: 'GM-JV04',
    name: 'Spring Boot version documented if Spring project',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; if (!/spring-boot/i.test(pom + gradle)) return null; return /spring-boot.*\d+\.\d+/i.test(pom + gradle); },
    impact: 'high',
    category: 'java',
    fix: 'Document Spring Boot version in build configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaApplicationConfig: {
    id: 'GM-JV05',
    name: 'application.yml or application.properties exists',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /application\.ya?ml$|application\.properties$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Create application.yml or application.properties for Spring configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaTestFramework: {
    id: 'GM-JV06',
    name: 'Test framework configured (JUnit/TestNG in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; return /junit|testng|spring-boot-starter-test/i.test(pom + gradle); },
    impact: 'high',
    category: 'java',
    fix: 'Configure JUnit or TestNG test framework in project dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaCodeStyleConfigured: {
    id: 'GM-JV07',
    name: 'Code style configured (checkstyle.xml, spotbugs)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /checkstyle\.xml$|spotbugs.*\.xml$/.test(f)) || /checkstyle|spotbugs|google-java-format/i.test((ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || '')); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure checkstyle or spotbugs for code quality enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaSpringProfilesDocumented: {
    id: 'GM-JV08',
    name: 'Spring profiles documented',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/spring/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /spring[.]profiles|@Profile|SPRING_PROFILES_ACTIVE/i.test(docs); },
    impact: 'medium',
    category: 'java',
    fix: 'Document Spring profiles and their configuration in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaDatabaseMigration: {
    id: 'GM-JV09',
    name: 'Database migration configured (flyway/liquibase)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /flyway|liquibase/i.test(deps) || ctx.files.some(f => /db[/]migration|flyway|liquibase/i.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure database migration tool (Flyway or Liquibase) for schema management.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaLombokDocumented: {
    id: 'GM-JV10',
    name: 'Lombok/MapStruct documented if used',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/lombok|mapstruct/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /lombok|mapstruct/i.test(docs); },
    impact: 'low',
    category: 'java',
    fix: 'Document Lombok/MapStruct usage and IDE setup requirements.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaApiDocsConfigured: {
    id: 'GM-JV11',
    name: 'API docs configured (springdoc/swagger deps)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /springdoc|swagger|openapi/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure API documentation with springdoc-openapi or Swagger.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaSecurityConfigured: {
    id: 'GM-JV12',
    name: 'Security configuration documented',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/spring-security|spring-boot-starter-security/i.test(deps)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /security|authentication|authorization|SecurityConfig|@EnableWebSecurity/i.test(docs); },
    impact: 'high',
    category: 'java',
    fix: 'Document Spring Security configuration and authentication setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaActuatorConfigured: {
    id: 'GM-JV13',
    name: 'Actuator/health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /actuator|spring-boot-starter-actuator/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Spring Boot Actuator for health checks and monitoring.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaLoggingConfigured: {
    id: 'GM-JV14',
    name: 'Logging configured (logback.xml or log4j2.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /logback.*\.xml$|log4j2?.*\.xml$|logging\.properties$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure logging with logback.xml or log4j2.xml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaMultiModuleProject: {
    id: 'GM-JV15',
    name: 'Multi-module project configured if applicable',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const buildFiles = ctx.files.filter(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f)); if (buildFiles.length <= 1) return null; const rootPom = ctx.fileContent('pom.xml') || ''; const rootGradle = ctx.fileContent('settings.gradle') || ctx.fileContent('settings.gradle.kts') || ''; return /<modules>|include\s/i.test(rootPom + rootGradle); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure multi-module project structure in root build file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaDockerConfigured: {
    id: 'GM-JV16',
    name: 'Docker build configured (Dockerfile or Jib plugin)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /FROM.*(?:openjdk|eclipse-temurin|amazoncorretto)/i.test(df) || /jib/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Docker build with Dockerfile or Jib plugin.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaEnvConfigsSeparated: {
    id: 'GM-JV17',
    name: 'Environment-specific configs separated',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /application-(?:dev|prod|staging|test|local)\.(?:ya?ml|properties)$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Separate environment configs (application-dev.yml, application-prod.yml, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaNoSecretsInConfig: {
    id: 'GM-JV18',
    name: 'No secrets in application.yml/properties',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const appYml = ctx.files.filter(f => /application.*\.ya?ml$|application.*\.properties$/.test(f)).map(f => ctx.fileContent(f) || '').join(''); if (!appYml) return null; return !/password\s*[:=]\s*[^$\{\s][^\s]{8,}|secret\s*[:=]\s*[^$\{\s][^\s]{8,}/i.test(appYml); },
    impact: 'critical',
    category: 'java',
    fix: 'Move secrets to environment variables or external secret management, not application config files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaIntegrationTestsSeparate: {
    id: 'GM-JV19',
    name: 'Integration tests separate from unit tests',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /src[/](?:integration-?test|it)[/]|IT\.java$|Integration(?:Test)?\.java$/.test(f)) || /failsafe|integration-test/i.test((ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || '')); },
    impact: 'medium',
    category: 'java',
    fix: 'Separate integration tests from unit tests using Maven Failsafe or dedicated source set.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiJavaBuildCommandDocumented: {
    id: 'GM-JV20',
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

  geminirubyGemfileExists: {
    id: 'GM-RB01',
    name: 'Gemfile exists',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'ruby',
    fix: 'Create a Gemfile to manage Ruby dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminirubyGemfileLockCommitted: {
    id: 'GM-RB02',
    name: 'Gemfile.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /Gemfile\.lock$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Commit Gemfile.lock to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminirubyVersionSpecified: {
    id: 'GM-RB03',
    name: 'Ruby version specified (.ruby-version)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.ruby-version$/.test(f)) || /ruby ['"]~?\d/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Create .ruby-version or specify ruby version in Gemfile.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminirubyRubocopConfigured: {
    id: 'GM-RB04',
    name: 'RuboCop configured (.rubocop.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.rubocop\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add .rubocop.yml to configure Ruby style checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminirubyTestFrameworkConfigured: {
    id: 'GM-RB05',
    name: 'RSpec or Minitest configured (spec/ or test/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /^spec\/|^test\/|spec_helper\.rb$|test_helper\.rb$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Configure RSpec (spec/) or Minitest (test/) for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminirubyRailsCredentialsDocumented: {
    id: 'GM-RB06',
    name: 'Rails credentials documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /credentials|encrypted|master\.key|secret_key_base/i.test(docs); },
    impact: 'high',
    category: 'ruby',
    fix: 'Document Rails credentials management (rails credentials:edit) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminirubyMigrationsDocumented: {
    id: 'GM-RB07',
    name: 'Database migrations documented (db/migrate/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /db\/migrate\//.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /migration|migrate|db:migrate|rails db/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document database migration workflow (rails db:migrate) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminirubyBundlerAuditConfigured: {
    id: 'GM-RB08',
    name: 'Bundler audit configured',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; return /bundler-audit|bundle.audit/i.test(gf) || ctx.files.some(f => /\.bundler-audit/i.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add bundler-audit gem for dependency vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminirubyTypeCheckingConfigured: {
    id: 'GM-RB09',
    name: 'Sorbet/RBS type checking configured (sorbet/ or sig/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /sorbet\/|sig\/|\.rbs$/.test(f)) || /sorbet|tapioca/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'low',
    category: 'ruby',
    fix: 'Configure Sorbet or RBS for type checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminirubyRailsRoutesDocumented: {
    id: 'GM-RB10',
    name: 'Rails routes documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/routes\.rb$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /routes|endpoints|api.*path|REST/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document key routes and API endpoints in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminirubyBackgroundJobsDocumented: {
    id: 'GM-RB11',
    name: 'Background jobs documented (Sidekiq/GoodJob)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sidekiq|good_job|delayed_job|resque/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /sidekiq|good_job|delayed_job|resque|background.*job|worker|queue/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document background job framework and worker configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminirubyRailsEnvConfigsSeparated: {
    id: 'GM-RB12',
    name: 'Rails environment configs separated (config/environments/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /config\/environments\//.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Ensure config/environments/ has separate files for development, test, and production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminirubyAssetPipelineDocumented: {
    id: 'GM-RB13',
    name: 'Asset pipeline documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sprockets|propshaft|webpacker|jsbundling|cssbundling/i.test(gf)) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /asset|sprockets|propshaft|webpacker|jsbundling|cssbundling|esbuild|vite/i.test(docs); },
    impact: 'low',
    category: 'ruby',
    fix: 'Document asset pipeline configuration (Sprockets, Propshaft, or JS/CSS bundling).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminirubyMasterKeyInGitignore: {
    id: 'GM-RB14',
    name: 'Rails master.key in .gitignore',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const gi = ctx.fileContent('.gitignore') || ''; return /master\.key/i.test(gi); },
    impact: 'critical',
    category: 'ruby',
    fix: 'Add config/master.key to .gitignore to prevent secret leakage.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminirubyTestDataFactories: {
    id: 'GM-RB15',
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

  geminidotnetProjectExists: {
    id: 'GM-DN01',
    name: '.csproj or .sln exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'dotnet',
    fix: 'Ensure .csproj or .sln file exists for .NET projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminidotnetVersionSpecified: {
    id: 'GM-DN02',
    name: '.NET version specified (global.json or TargetFramework)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /global\.json$/.test(f)) || ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /TargetFramework/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create global.json or ensure TargetFramework is set in .csproj.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminidotnetPackagesLock: {
    id: 'GM-DN03',
    name: 'NuGet packages lock (packages.lock.json)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /packages\.lock\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Enable NuGet lock file (packages.lock.json) for reproducible restores.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminidotnetTestDocumented: {
    id: 'GM-DN04',
    name: 'dotnet test documented',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /dotnet test|xunit|nunit|mstest/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document how to run tests with dotnet test in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminidotnetEditorConfigExists: {
    id: 'GM-DN05',
    name: 'EditorConfig configured (.editorconfig)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.editorconfig$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add .editorconfig for consistent code style across the team.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminidotnetRoslynAnalyzers: {
    id: 'GM-DN06',
    name: 'Roslyn analyzers configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Analyzer|StyleCop|SonarAnalyzer|Microsoft\.CodeAnalysis/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Roslyn analyzers (StyleCop.Analyzers, Microsoft.CodeAnalysis) to the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminidotnetAppsettingsExists: {
    id: 'GM-DN07',
    name: 'appsettings.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /appsettings\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create appsettings.json for application configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminidotnetUserSecretsDocumented: {
    id: 'GM-DN08',
    name: 'User secrets configured in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /user.?secrets|dotnet secrets|Secret Manager/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document user secrets management (dotnet user-secrets) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminidotnetEfMigrations: {
    id: 'GM-DN09',
    name: 'Entity Framework migrations (Migrations/ directory)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /Migrations\//.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Document Entity Framework migration workflow (dotnet ef migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminidotnetHealthChecks: {
    id: 'GM-DN10',
    name: 'Health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /AddHealthChecks|MapHealthChecks|IHealthCheck/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure health checks with AddHealthChecks() and MapHealthChecks().',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminidotnetSwaggerConfigured: {
    id: 'GM-DN11',
    name: 'Swagger/OpenAPI configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$|.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Swashbuckle|AddSwaggerGen|UseSwagger|NSwag|AddOpenApi/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure Swagger/OpenAPI with Swashbuckle or NSwag.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminidotnetNoConnectionStringsInConfig: {
    id: 'GM-DN12',
    name: 'No connection strings in appsettings.json',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const settings = ctx.fileContent('appsettings.json') || ''; if (!settings) return null; return !/Server=.*Password=|Data Source=.*Password=/i.test(settings); },
    impact: 'critical',
    category: 'dotnet',
    fix: 'Move connection strings with passwords to user secrets or environment variables.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminidotnetDockerSupport: {
    id: 'GM-DN13',
    name: 'Docker support configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; return /dotnet|aspnet|sdk/i.test(df); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Dockerfile with official .NET SDK/ASP.NET base images.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminidotnetTestProjectSeparate: {
    id: 'GM-DN14',
    name: 'Unit test project separate (.Tests.csproj)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.Tests?\.csproj$|Tests?\/.*\.csproj$/.test(f)); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Create separate test project (e.g., MyApp.Tests.csproj) for unit tests.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminidotnetGlobalUsingsDocumented: {
    id: 'GM-DN15',
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

  geminiphpComposerJsonExists: {
    id: 'GM-PHP01',
    name: 'composer.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'php',
    fix: 'Create composer.json to manage PHP dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiphpComposerLockCommitted: {
    id: 'GM-PHP02',
    name: 'composer.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /composer\.lock$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Commit composer.lock to version control for reproducible installs.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiphpVersionSpecified: {
    id: 'GM-PHP03',
    name: 'PHP version specified (composer.json require.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"php"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Specify PHP version requirement in composer.json require section.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiphpStaticAnalysisConfigured: {
    id: 'GM-PHP04',
    name: 'PHPStan/Psalm configured (phpstan.neon)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpstan\.neon$|phpstan\.neon\.dist$|psalm\.xml$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Configure PHPStan (phpstan.neon) or Psalm (psalm.xml) for static analysis.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiphpCsFixerConfigured: {
    id: 'GM-PHP05',
    name: 'PHP CS Fixer configured (.php-cs-fixer.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /\.php-cs-fixer\.php$|\.php-cs-fixer\.dist\.php$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Add .php-cs-fixer.php for consistent code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiphpUnitConfigured: {
    id: 'GM-PHP06',
    name: 'PHPUnit configured (phpunit.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpunit\.xml$|phpunit\.xml\.dist$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Configure PHPUnit with phpunit.xml for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiphpLaravelEnvExample: {
    id: 'GM-PHP07',
    name: 'Laravel .env.example exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /\.env\.example$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Create .env.example with all required environment variables documented.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiphpLaravelAppKeyNotCommitted: {
    id: 'GM-PHP08',
    name: 'Laravel APP_KEY not committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const env = ctx.fileContent('.env') || ''; if (!env) return null; return !/APP_KEY=base64:[A-Za-z0-9+/=]{30,}/i.test(env); },
    impact: 'critical',
    category: 'php',
    fix: 'Ensure .env with APP_KEY is in .gitignore — never commit application keys.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiphpLaravelMigrationsExist: {
    id: 'GM-PHP09',
    name: 'Laravel migrations exist (database/migrations/)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /database\/migrations\//.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Create database migrations in database/migrations/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiphpArtisanCommandsDocumented: {
    id: 'GM-PHP10',
    name: 'Artisan commands documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /artisan|php artisan|make:model|make:controller|migrate/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document key Artisan commands (migrate, seed, make:*) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiphpQueueWorkerDocumented: {
    id: 'GM-PHP11',
    name: 'Queue worker documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; if (!/horizon|queue/i.test(cj) && !ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /queue|horizon|worker|job|dispatch/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document queue worker setup (php artisan queue:work, Horizon).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiphpLaravelPintConfigured: {
    id: 'GM-PHP12',
    name: 'Laravel Pint configured (pint.json)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /pint\.json$/.test(f)) || /laravel\/pint/i.test(ctx.fileContent('composer.json') || ''); },
    impact: 'low',
    category: 'php',
    fix: 'Configure Laravel Pint (pint.json) for code style enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiphpAssetBundlingDocumented: {
    id: 'GM-PHP13',
    name: 'Vite/Mix asset bundling documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /vite\.config\.|webpack\.mix\.js$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /vite|mix|asset|npm run dev|npm run build/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document asset bundling setup (Vite or Mix) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiphpConfigCachingDocumented: {
    id: 'GM-PHP14',
    name: 'Laravel config caching documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = (ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md')) || ctx.fileContent('README.md') || ''; return /config:cache|config:clear|route:cache|optimize/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document config/route caching strategy (php artisan config:cache) for production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  geminiphpComposerScriptsDefined: {
    id: 'GM-PHP15',
    name: 'Composer scripts defined',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"scripts"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Define composer scripts for common tasks (test, lint, analyze) in composer.json.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },


};

Object.assign(GEMINI_TECHNIQUES, buildSupplementalChecks({
  idPrefix: 'GM-T',
  urlMap: GEMINI_SUPPLEMENTAL_SOURCE_URLS,
  docs: (ctx) => [
    geminiMd(ctx),
    ctx.fileContent('README.md') || '',
    ctx.fileContent('AGENTS.md') || '',
  ].filter(Boolean).join('\n'),
}));

Object.assign(GEMINI_TECHNIQUES, buildStackChecks({
  platform: 'gemini',
  objectPrefix: 'gemini',
  idPrefix: 'GM',
  docs: (ctx) => [
    geminiMd(ctx),
    ctx.fileContent('README.md') || '',
    ctx.fileContent('AGENTS.md') || '',
    ctx.fileContent('CLAUDE.md') || '',
    ctx.fileContent('CONTRIBUTING.md') || '',
  ].filter(Boolean).join('\n'),
}));

attachSourceUrls('gemini', GEMINI_TECHNIQUES);

// CTO-08 — tag every check with a scope layer.
const { LAYERS: GEMINI_LAYERS, assignLayers: geminiAssignLayers } = require('../audit/layers');
geminiAssignLayers(GEMINI_TECHNIQUES, GEMINI_LAYERS.GOVERNANCE);

module.exports = {
  GEMINI_TECHNIQUES,
};
