/**
 * Copilot techniques module — CHECK CATALOG
 *
 * 134 checks across 25 categories:
 *   v0.1 (38): A. Instructions(8), B. Config(6), C. Trust & Safety(9), D. MCP(5), E. Cloud Agent(5), F. Organization(5)
 *   v0.5 (54): G. Prompt Files(4), H. Agents & Skills(4), I. VS Code IDE(4), J. CLI(4)
 *   v1.0 (70): K. Cross-Surface(5), L. Enterprise(5), M. Quality Deep(6)
 *   CP-08 (82): N. Advisory(4), O. Pack(4), P. Repeat(3)
 *   v1.1 (87): Q. Experiment-Verified CLI Fixes (CLI ingests AGENTS.md/CLAUDE.md, mcpServers key, VS Code settings not CLI-relevant, org policy MCP blocks, BYOK MCP caveat)
 *   v1.2 (134): T. Engineering Foundations (testing, quality, API, database, auth, monitoring, dependencies, cost)
 *
 * Each check: { id, name, check(ctx), impact, rating, category, fix, template, file(), line() }
 */

const os = require('os');
const path = require('path');
const { CopilotProjectContext } = require('./context');
const { EMBEDDED_SECRET_PATTERNS, containsEmbeddedSecret } = require('../secret-patterns');
const { attachSourceUrls } = require('../source-urls');
const { buildSupplementalChecks } = require('../supplemental-checks');
const { buildStackChecks } = require('../stack-checks');
const { extractFrontmatter, validateInstructionFrontmatter, validatePromptFrontmatter } = require('./config-parser');

const COPILOT_SUPPLEMENTAL_SOURCE_URLS = {
  'testing-strategy': 'https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions',
  'code-quality': 'https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions',
  'api-design': 'https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions',
  database: 'https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent',
  authentication: 'https://docs.github.com/en/copilot/responsible-use-of-github-copilot-features/github-copilot-data-handling',
  monitoring: 'https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment',
  'dependency-management': 'https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions',
  'cost-optimization': 'https://docs.github.com/en/copilot',
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

function countSections(markdown) {
  // Count H1 (#) and H2 (##) as sections. Many real repos mix level-1 and
  // level-2 headings (e.g. home-assistant/core) and penalising them for using
  // `#` is a false positive.
  const headingSections = (markdown.match(/^#{1,2}\s+/gm) || []).length;
  if (headingSections >= 2) return headingSections;
  // Fallback: some repos structure their instructions as a dense bullet list
  // rather than a nested document (e.g. astral-sh/uv AGENTS.md is 20 bullets
  // with no headings). Treat a substantial bullet list as "sectioned".
  const bullets = (markdown.match(/^\s*[-*]\s+/gm) || []).length;
  if (bullets >= 6) return Math.max(headingSections, 2);
  return headingSections;
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

function copilotInstructions(ctx) {
  return ctx.copilotInstructionsContent ? ctx.copilotInstructionsContent() : (ctx.fileContent('.github/copilot-instructions.md') || null);
}

function vscodeSettingsRaw(ctx) {
  return ctx.fileContent('.vscode/settings.json') || '';
}

function vscodeSettingsData(ctx) {
  const result = ctx.vscodeSettings();
  return result && result.ok ? result.data : null;
}

function mcpJsonRaw(ctx) {
  return ctx.fileContent('.vscode/mcp.json') || '';
}

function mcpJsonData(ctx) {
  const result = ctx.mcpConfig();
  return result && result.ok ? result.data : null;
}

function cloudAgentContent(ctx) {
  return ctx.cloudAgentConfig ? ctx.cloudAgentConfig() : null;
}

function docsBundle(ctx) {
  const instr = copilotInstructions(ctx) || '';
  const readme = ctx.fileContent('README.md') || '';
  return `${instr}\n${readme}`;
}

/**
 * Bundle of docs that stack-specific checks (CP-PY*, CP-RS*, CP-JV*, etc.)
 * consult when deciding whether a convention is "documented". Real projects
 * spread guidance across README / CONTRIBUTING / AGENTS.md / CLAUDE.md /
 * copilot-instructions / docs/ — limiting the search to CLAUDE.md + README.md
 * alone produces systematic false positives on mature codebases.
 */
function stackDocsBundle(ctx) {
  const parts = [
    ctx.claudeMdContent ? ctx.claudeMdContent() : ctx.fileContent('CLAUDE.md'),
    ctx.fileContent('README.md'),
    ctx.fileContent('README.rst'),
    ctx.fileContent('README.MD'),
    ctx.fileContent('CONTRIBUTING.md'),
    ctx.fileContent('.github/CONTRIBUTING.md'),
    ctx.fileContent('.github/copilot-instructions.md'),
    ctx.fileContent('AGENTS.md'),
    ctx.fileContent('DEVELOPMENT.md'),
    ctx.fileContent('docs/development.md'),
    ctx.fileContent('STYLE.md'),
  ].filter(Boolean);
  return parts.join('\n');
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
  // Broader patterns: real-world instruction files often just mention the tool
  // ("run tests with pytest", "use cargo check", "mypy is enforced") rather
  // than the full command form. Missing these is the #1 CP-A03 FP source.
  if (category === 'test') {
    return /\bnpm test\b|\bnpm run test\b|\bpnpm test\b|\byarn test\b|\bvitest\b|\bjest\b|\bpytest\b|\bgo test\b|\bcargo test\b|\bcargo nextest\b|\bmake test\b|\bdotnet test\b|\bmvn test\b|\bgradle test\b|\btox\b|\bnox\b|\bphpunit\b|\btest:\s|tests? (?:can be )?run|run (?:the )?tests?|^#{1,3}\s*Testing\b|^#{1,3}\s*Tests\b|writing.*tests?|modifying.*tests?/im.test(content);
  }
  if (category === 'lint') {
    return /\bnpm run lint\b|\bpnpm lint\b|\byarn lint\b|\beslint\b|\bprettier\b|\bruff\b|\bclippy\b|\bgolangci-lint\b|\bmake lint\b|\bmypy\b|\bpyright\b|\bblack\b|\bisort\b|\bflake8\b|\bpylint\b|\brubocop\b|\bbiome\b|\bpre-commit\b|\blint\b/i.test(content);
  }
  if (category === 'build') {
    return /\bnpm run build\b|\bpnpm build\b|\byarn build\b|\btsc\b|\bvite build\b|\bnext build\b|\bcargo build\b|\bcargo check\b|\bgo build\b|\bmake\b|\bdotnet build\b|\bmvn (?:package|install|compile)\b|\bgradle build\b|\buv build\b|\bpython -m build\b|\bbuild:\s|\bbuild\b/i.test(content);
  }
  return false;
}

function hasArchitecture(content) {
  return /```mermaid|flowchart\b|graph\s+(TD|LR|RL|BT)\b|##\s+Architecture\b|##\s+Project Map\b|##\s+Structure\b/i.test(content);
}

function getCopilotSetting(ctx, key) {
  const data = vscodeSettingsData(ctx);
  if (!data) return undefined;
  // Support dotted key navigation through nested objects
  const parts = key.split('.');
  let cursor = data;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

// ─── COPILOT_TECHNIQUES ──────────────────────────────────────────────────────

const COPILOT_TECHNIQUES = {

  // =============================================
  // A. Instructions (8 checks) — CP-A01..CP-A08
  // =============================================

  copilotInstructionsExists: {
    id: 'CP-A01',
    name: '.github/copilot-instructions.md exists',
    check: (ctx) => Boolean(copilotInstructions(ctx)),
    impact: 'critical',
    rating: 5,
    category: 'instructions',
    fix: 'Create .github/copilot-instructions.md with repo-specific instructions for Copilot.',
    template: 'copilot-instructions',
    file: () => '.github/copilot-instructions.md',
    line: (ctx) => (copilotInstructions(ctx) ? 1 : null),
  },

  copilotInstructionsSubstantive: {
    id: 'CP-A02',
    name: 'Instructions have substantive content (>20 lines, 2+ sections)',
    check: (ctx) => {
      const content = copilotInstructions(ctx);
      if (!content) return null;
      const nonEmpty = content.split(/\r?\n/).filter(l => l.trim()).length;
      // Lowered from 20 → 15 to align with CP-N01 advisory tier. Pinning at 20
      // flagged borderline but substantive files (19 non-empty lines) as FPs.
      return nonEmpty >= 15 && countSections(content) >= 2;
    },
    impact: 'high',
    rating: 5,
    category: 'instructions',
    fix: 'Expand copilot-instructions.md to at least 20 substantive lines and 2+ sections.',
    template: 'copilot-instructions',
    file: () => '.github/copilot-instructions.md',
    line: () => 1,
  },

  copilotInstructionsCommands: {
    id: 'CP-A03',
    name: 'Instructions include build/test/lint commands',
    check: (ctx) => {
      const content = copilotInstructions(ctx);
      if (!content) return null;
      const expected = expectedVerificationCategories(ctx);
      // Consider CONTRIBUTING.md / README / AGENTS.md alongside copilot-
      // instructions. Large projects routinely document verification commands
      // in CONTRIBUTING or a dev guide and cross-reference from copilot-
      // instructions — the Copilot agent sees all of it.
      const combined = `${content}\n${stackDocsBundle(ctx)}`;
      if (expected.length === 0) return /\bverify\b|\btest\b|\blint\b|\bbuild\b/i.test(combined);
      return expected.every(cat => hasCommandMention(combined, cat));
    },
    impact: 'high',
    rating: 5,
    category: 'instructions',
    fix: 'Document the actual test/lint/build commands so Copilot agent can verify its changes.',
    template: 'copilot-instructions',
    file: () => '.github/copilot-instructions.md',
    line: (ctx) => {
      const content = copilotInstructions(ctx);
      return content ? (firstLineMatching(content, /\bVerification\b|\btest\b|\blint\b|\bbuild\b/i) || 1) : null;
    },
  },

  copilotInstructionsNoFiller: {
    id: 'CP-A04',
    name: 'No generic filler instructions',
    check: (ctx) => {
      const content = copilotInstructions(ctx);
      if (!content) return null;
      return !FILLER_PATTERNS.some(p => p.test(content));
    },
    impact: 'low',
    rating: 3,
    category: 'instructions',
    fix: 'Replace generic filler like "be helpful" with concrete repo-specific guidance.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: (ctx) => {
      const content = copilotInstructions(ctx);
      return content ? findFillerLine(content) : null;
    },
  },

  copilotInstructionsNoSecrets: {
    id: 'CP-A05',
    name: 'No secrets/API keys in instruction files',
    check: (ctx) => {
      const content = copilotInstructions(ctx) || '';
      const scoped = (ctx.scopedInstructions ? ctx.scopedInstructions() : []).map(s => s.body || '').join('\n');
      const prompts = (ctx.promptFiles ? ctx.promptFiles() : []).map(p => p.body || '').join('\n');
      const combined = `${content}\n${scoped}\n${prompts}`;
      if (!combined.trim()) return null;
      return !containsEmbeddedSecret(combined);
    },
    impact: 'critical',
    rating: 5,
    category: 'instructions',
    fix: 'Remove API keys and secrets from instruction and prompt files. Use environment variables instead.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: (ctx) => {
      const content = copilotInstructions(ctx);
      return content ? findSecretLine(content) : null;
    },
  },

  copilotScopedInstructionsFrontmatter: {
    id: 'CP-A06',
    name: 'Scoped instruction files have valid applyTo glob in frontmatter',
    check: (ctx) => {
      const scoped = ctx.scopedInstructions ? ctx.scopedInstructions() : [];
      if (scoped.length === 0) return null; // No scoped instructions = N/A
      return scoped.every(s => {
        if (!s.frontmatter) return false;
        const validation = validateInstructionFrontmatter(s.frontmatter);
        return validation.valid;
      });
    },
    impact: 'high',
    rating: 4,
    category: 'instructions',
    fix: 'Add valid applyTo glob pattern in YAML frontmatter of each .github/instructions/*.instructions.md file.',
    template: null,
    file: () => '.github/instructions/',
    line: () => 1,
  },

  copilotNoOrgContradiction: {
    id: 'CP-A07',
    name: 'No contradictions between repo and org instructions',
    check: (ctx) => {
      // Can't detect org instructions from files alone; check for explicit org markers
      const content = copilotInstructions(ctx);
      if (!content) return null;
      // Check if instructions reference overriding org-level rules
      const hasOrgOverride = /\boverride org\b|\bignore org\b|\bdisable org\b/i.test(content);
      return !hasOrgOverride;
    },
    impact: 'medium',
    rating: 3,
    category: 'instructions',
    fix: 'Ensure repo instructions complement (not contradict) org-level instructions.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: (ctx) => {
      const content = copilotInstructions(ctx);
      return content ? firstLineMatching(content, /\boverride org\b|\bignore org\b|\bdisable org\b/i) : null;
    },
  },

  copilotNoDeprecatedCodeGenInstructions: {
    id: 'CP-A08',
    name: 'Deprecated codeGeneration.instructions not used in VS Code settings',
    check: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      if (!raw) return null;
      return !raw.includes('codeGeneration.instructions');
    },
    impact: 'medium',
    rating: 4,
    category: 'instructions',
    fix: 'Remove github.copilot.chat.codeGeneration.instructions from settings.json (deprecated since VS Code 1.102). Use .github/instructions/*.instructions.md instead.',
    template: null,
    file: () => '.vscode/settings.json',
    line: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      return raw ? firstLineMatching(raw, /codeGeneration\.instructions/) : null;
    },
  },

  // =============================================
  // B. Config (6 checks) — CP-B01..CP-B06
  // =============================================

  copilotVscodeSettingsExists: {
    id: 'CP-B01',
    name: '.vscode/settings.json has Copilot agent settings (VS Code-only)',
    check: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      // No .vscode/settings.json at all → not applicable (repo isn't VS Code-configured).
      if (!raw) return null;
      const data = vscodeSettingsData(ctx);
      if (!data) return false;
      if (/github\.copilot|chat\./.test(raw)) return true;
      // Copilot settings in .vscode/settings.json are optional for repos that
      // deliver Copilot configuration through copilot-instructions.md, prompt
      // files, or MCP config. Don't flag the absence if any of these exist.
      const hasOtherSurface = Boolean(
        ctx.fileContent('.github/copilot-instructions.md') ||
        ctx.hasDir('.github/prompts') ||
        ctx.hasDir('.github/instructions') ||
        ctx.fileContent('.vscode/mcp.json')
      );
      if (hasOtherSurface) return null;
      return false;
    },
    impact: 'medium',
    rating: 4,
    category: 'config',
    fix: 'Add Copilot agent settings to .vscode/settings.json. NOTE: These are VS Code-only — Copilot CLI has its own configuration surface.',
    template: 'copilot-vscode-settings',
    file: () => '.vscode/settings.json',
    line: () => 1,
  },

  copilotCloudAgentSetup: {
    id: 'CP-B02',
    name: 'Cloud agent setup workflow exists if cloud agent is used',
    check: (ctx) => {
      const content = cloudAgentContent(ctx);
      // If no cloud agent signals, N/A
      const hasCloudSignals = ctx.fileContent('.github/copilot-instructions.md') &&
        (ctx.workflowFiles ? ctx.workflowFiles() : []).some(f => f.includes('copilot'));
      if (!hasCloudSignals && !content) return null;
      return Boolean(content);
    },
    impact: 'high',
    rating: 5,
    category: 'config',
    fix: 'Create .github/workflows/copilot-setup-steps.yml to configure the cloud agent environment.',
    template: 'copilot-cloud-setup',
    file: () => '.github/workflows/copilot-setup-steps.yml',
    line: () => 1,
  },

  copilotModelExplicit: {
    id: 'CP-B03',
    name: 'Model preference is explicit (not silently defaulting)',
    check: (ctx) => {
      // Check prompt files for explicit model setting
      const prompts = ctx.promptFiles ? ctx.promptFiles() : [];
      const hasModelInPrompt = prompts.some(p => p.frontmatter && p.frontmatter.model);
      // Check instructions for model guidance
      const instr = copilotInstructions(ctx) || '';
      // Only evaluate if the repo uses prompt files (where model is a
      // meaningful frontmatter field) or already references models —
      // otherwise defaulting to the account-default model is fine.
      if (prompts.length === 0 && !/\bmodel\b|\bgpt\b|\bclaude\b|\bsonnet\b|\bopus\b/i.test(instr)) {
        return null;
      }
      const hasModelMention = /\bmodel\b.*\b(gpt|claude|o[134]|sonnet|opus)\b/i.test(instr);
      return hasModelInPrompt || hasModelMention;
    },
    impact: 'medium',
    rating: 3,
    category: 'config',
    fix: 'Set model preference explicitly in prompt files or instructions to avoid silent downgrades.',
    template: null,
    file: () => '.github/prompts/',
    line: () => 1,
  },

  copilotNoDeprecatedSettings: {
    id: 'CP-B04',
    name: 'No deprecated VS Code Copilot settings',
    check: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      if (!raw) return null;
      const deprecatedPatterns = [
        /github\.copilot\.chat\.codeGeneration\.instructions/,
        /github\.copilot\.inlineSuggest\.enable/,
      ];
      return !deprecatedPatterns.some(p => p.test(raw));
    },
    impact: 'medium',
    rating: 4,
    category: 'config',
    fix: 'Replace deprecated Copilot settings with current equivalents.',
    template: null,
    file: () => '.vscode/settings.json',
    line: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      return raw ? firstLineMatching(raw, /codeGeneration\.instructions|inlineSuggest\.enable/) : null;
    },
  },

  copilotPromptFilesValid: {
    id: 'CP-B05',
    name: 'Prompt files (.github/prompts/) use valid frontmatter',
    check: (ctx) => {
      const prompts = ctx.promptFiles ? ctx.promptFiles() : [];
      if (prompts.length === 0) return null;
      return prompts.every(p => {
        if (!p.frontmatter) return false;
        const validation = validatePromptFrontmatter(p.frontmatter);
        return validation.valid;
      });
    },
    impact: 'medium',
    rating: 4,
    category: 'config',
    fix: 'Ensure all .github/prompts/*.prompt.md files have valid YAML frontmatter with description, agent, model, or tools fields.',
    template: null,
    file: () => '.github/prompts/',
    line: () => 1,
  },

  copilotVscodeSettingsValidJson: {
    id: 'CP-B06',
    name: 'VS Code settings.json is valid JSON',
    check: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      if (!raw) return null;
      const result = ctx.vscodeSettings();
      return result && result.ok;
    },
    impact: 'critical',
    rating: 5,
    category: 'config',
    fix: 'Fix malformed JSON in .vscode/settings.json.',
    template: null,
    file: () => '.vscode/settings.json',
    line: (ctx) => {
      const result = ctx.vscodeSettings();
      if (result && result.ok) return null;
      if (result && result.error) {
        const match = result.error.match(/position (\d+)/i);
        if (match) {
          const raw = vscodeSettingsRaw(ctx);
          return raw ? raw.slice(0, Number(match[1])).split('\n').length : 1;
        }
      }
      return 1;
    },
  },

  // =============================================
  // C. Trust & Safety (9 checks) — CP-C01..CP-C09
  // =============================================

  copilotContentExclusions: {
    id: 'CP-C01',
    name: 'Content exclusions configured for sensitive files',
    check: (ctx) => {
      const exclusions = ctx.contentExclusions ? ctx.contentExclusions() : null;
      if (exclusions) return true;
      // Also check for .gitignore patterns that suggest awareness
      const gitignore = ctx.fileContent('.gitignore') || '';
      return /\.env\b|secrets\/|credentials|\.pem\b|\.key\b/i.test(gitignore);
    },
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'Configure content exclusions for .env, secrets/, credentials, and *.pem files in org settings or repo config.',
    template: null,
    file: () => '.vscode/settings.json',
    line: () => null,
  },

  copilotCloudContentExclusionGap: {
    id: 'CP-C02',
    name: 'Cloud agent content exclusion gap documented',
    check: (ctx) => {
      const cloud = cloudAgentContent(ctx);
      if (!cloud) return null; // N/A if no cloud agent
      // Check if the gap is documented
      const instr = copilotInstructions(ctx) || '';
      return /content exclu.*cloud|cloud.*content exclu|cloud agent.*sensitive|exclusion.*not enforced/i.test(instr) ||
             /content exclu.*cloud|cloud.*content exclu/i.test(cloud);
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Document that content exclusions are NOT enforced on the cloud agent. Review cloud agent PRs carefully for sensitive file access.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotTerminalSandboxEnabled: {
    id: 'CP-C03',
    name: 'Terminal sandbox enabled (VS Code-only — does NOT affect CLI)',
    check: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      // N/A when the repo has no VS Code settings at all — sandbox setting is
      // VS Code-only and simply doesn't apply.
      if (!raw) return null;
      // N/A when the repo's .vscode/settings.json has no Copilot / chat keys
      // (e.g. it's using settings only for editor preferences). Sandbox is a
      // Copilot-specific setting; absence in a non-Copilot settings file is
      // not a finding.
      if (!/github\.copilot|chat\./.test(raw)) return null;
      const data = vscodeSettingsData(ctx);
      if (!data) return false;
      // Check for chat.tools.terminal.sandbox.enabled = true
      // NOTE: This setting is VS Code-specific. Copilot CLI ignores it entirely.
      if (raw.includes('terminal.sandbox') && raw.includes('true')) return true;
      return getCopilotSetting(ctx, 'chat.tools.terminal.sandbox.enabled') === true;
    },
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'Add "chat.tools.terminal.sandbox.enabled": true to .vscode/settings.json. NOTE: This is VS Code-only — Copilot CLI uses its own permission flags, not VS Code settings.',
    template: 'copilot-vscode-settings',
    file: () => '.vscode/settings.json',
    line: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      return raw ? firstLineMatching(raw, /terminal\.sandbox/) : null;
    },
  },

  copilotNoWindowsSandbox: {
    id: 'CP-C04',
    name: 'No terminal sandbox on Windows — documented',
    check: (ctx) => {
      if (os.platform() !== 'win32') return null; // N/A on non-Windows
      // Only relevant if the repo actually configures VS Code — otherwise the
      // Windows sandbox gap does not apply to this repo's Copilot surface.
      if (!vscodeSettingsRaw(ctx)) return null;
      const instr = copilotInstructions(ctx) || '';
      const readme = ctx.fileContent('README.md') || '';
      const combined = `${instr}\n${readme}`;
      return /\bwindows\b.*sandbox|sandbox.*\bwindows\b|terminal sandbox.*unavailable|no sandbox.*windows/i.test(combined);
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Document that terminal sandbox is unavailable on native Windows. Use WSL2 or Docker for sandboxed execution.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotAutoApprovalSpecific: {
    id: 'CP-C05',
    name: 'Auto-approval rules are specific (VS Code-only — CLI uses permission flags)',
    check: (ctx) => {
      const data = vscodeSettingsData(ctx);
      if (!data) return null;
      const raw = vscodeSettingsRaw(ctx);
      // Check for auto-approval patterns
      // NOTE: autoApproval.terminalCommands is VS Code-specific.
      // Copilot CLI uses its own --permission flags, not this setting.
      const autoApproval = getCopilotSetting(ctx, 'chat.agent.autoApproval.terminalCommands');
      if (!autoApproval || !Array.isArray(autoApproval)) return null;
      // Fail if any wildcard patterns
      return !autoApproval.some(pattern => pattern === '*' || pattern === '**' || pattern === '.*');
    },
    impact: 'high',
    rating: 5,
    category: 'trust',
    fix: 'Replace wildcard auto-approval patterns with specific command patterns (e.g., "npm test", "npm run lint"). NOTE: This setting only affects VS Code — Copilot CLI approval is controlled by CLI permission flags.',
    template: null,
    file: () => '.vscode/settings.json',
    line: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      return raw ? firstLineMatching(raw, /autoApproval/) : null;
    },
  },

  copilotCloudAgentPRReview: {
    id: 'CP-C06',
    name: 'Cloud agent PRs require review before CI runs',
    check: (ctx) => {
      const cloud = cloudAgentContent(ctx);
      if (!cloud) return null;
      // Check workflows for branch protection or review requirements
      const workflows = ctx.workflowFiles ? ctx.workflowFiles() : [];
      const hasReviewGate = workflows.some(f => {
        const content = ctx.fileContent(f) || '';
        return /pull_request_review|required_status_checks|require.*approval/i.test(content);
      });
      // Also check instructions for review guidance
      const instr = copilotInstructions(ctx) || '';
      return hasReviewGate || /\breview before merge\b|\breview required\b|\bPR review\b/i.test(instr);
    },
    impact: 'high',
    rating: 4,
    category: 'trust',
    fix: 'Ensure cloud agent PRs require human review before CI/CD runs.',
    template: null,
    file: () => '.github/workflows/',
    line: () => null,
  },

  copilotDataUsageOptOut: {
    id: 'CP-C07',
    name: 'Data usage opt-out configured for training-sensitive repos',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      const readme = ctx.fileContent('README.md') || '';
      const combined = `${instr}\n${readme}`;
      // Check if there's awareness of data training policy
      if (/\bopt.?out\b.*training|\bdata.*training.*opt|\binteraction data\b/i.test(combined)) return true;
      // If repo looks regulated, it should document this
      const filenames = (ctx.files || []).join('\n');
      const isRegulated = /\bhipaa\b|\bpci\b|\bsoc2\b|\bgdpr\b|\bcompliance\b/i.test(`${filenames}\n${combined}`);
      if (isRegulated) return false;
      return null; // N/A for non-regulated repos
    },
    impact: 'medium',
    rating: 3,
    category: 'trust',
    fix: 'Document data usage training opt-out if required. Since April 24, 2026, interaction data may be used for training on Free/Pro/Pro+ plans.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotNoSecretsInCloudSetup: {
    id: 'CP-C08',
    name: 'No secrets in copilot-setup-steps.yml',
    check: (ctx) => {
      const cloud = cloudAgentContent(ctx);
      if (!cloud) return null;
      return !containsEmbeddedSecret(cloud);
    },
    impact: 'critical',
    rating: 5,
    category: 'trust',
    fix: 'Remove hardcoded secrets from copilot-setup-steps.yml. Use GitHub Actions secrets instead (${{ secrets.* }}).',
    template: null,
    file: () => '.github/workflows/copilot-setup-steps.yml',
    line: (ctx) => {
      const cloud = cloudAgentContent(ctx);
      return cloud ? findSecretLine(cloud) : null;
    },
  },

  copilotMcpOrgAllowlist: {
    id: 'CP-C09',
    name: 'MCP servers restricted by org allowlist (if Enterprise/Business)',
    check: (ctx) => {
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      if (Object.keys(servers).length === 0) return null;
      // Check instructions for MCP governance mention
      const instr = copilotInstructions(ctx) || '';
      return /\bmcp.*allowlist\b|\bmcp.*registry\b|\bmcp.*approved\b|\borg.*mcp/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'trust',
    fix: 'If using Business/Enterprise plan, configure MCP server allowlist in org admin settings.',
    template: null,
    file: () => '.vscode/mcp.json',
    line: () => null,
  },

  // =============================================
  // D. MCP (5 checks) — CP-D01..CP-D05
  // =============================================

  copilotMcpConfigured: {
    id: 'CP-D01',
    name: 'MCP servers configured per surface (.vscode/mcp.json)',
    check: (ctx) => {
      // MCP is an opt-in capability. If the repo doesn't have a .vscode/mcp.json,
      // and the instructions don't mention MCP, treat as N/A rather than fail —
      // many repos don't use MCP at all and shouldn't be penalised.
      const raw = mcpJsonRaw(ctx);
      const instr = copilotInstructions(ctx) || '';
      if (!raw && !/\bmcp\b|model context protocol/i.test(instr)) return null;
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      return Object.keys(servers).length > 0;
    },
    impact: 'medium',
    rating: 4,
    category: 'mcp',
    fix: 'Configure MCP servers in .vscode/mcp.json for VS Code agent mode.',
    template: 'copilot-mcp',
    file: () => '.vscode/mcp.json',
    line: () => 1,
  },

  copilotMcpCloudNoOAuth: {
    id: 'CP-D02',
    name: 'Cloud agent MCP avoids OAuth-required servers (known gap)',
    check: (ctx) => {
      const cloud = cloudAgentContent(ctx);
      if (!cloud) return null;
      const mcpData = mcpJsonData(ctx);
      if (!mcpData) return null;
      const servers = mcpData.servers || mcpData.mcpServers || {};
      // Check if any server has OAuth requirements and cloud references them
      for (const [name, config] of Object.entries(servers)) {
        const configStr = JSON.stringify(config);
        if (/oauth|auth_url|authorization_url/i.test(configStr) && cloud.includes(name)) {
          return false;
        }
      }
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'mcp',
    fix: 'Remove OAuth-dependent MCP servers from cloud agent config. OAuth is not supported on cloud agent.',
    template: null,
    file: () => '.vscode/mcp.json',
    line: () => null,
  },

  copilotMcpToolRestrictions: {
    id: 'CP-D03',
    name: 'MCP tool restrictions configured',
    check: (ctx) => {
      const mcpData = mcpJsonData(ctx);
      if (!mcpData) return null;
      const servers = mcpData.servers || mcpData.mcpServers || {};
      if (Object.keys(servers).length === 0) return null;
      // Check if any server has tool restrictions
      return Object.values(servers).some(config =>
        config.tools || config.excludeTools || config.allowedTools
      );
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'Add tool restrictions to MCP server configs to limit which tools can be invoked.',
    template: null,
    file: () => '.vscode/mcp.json',
    line: () => null,
  },

  copilotMcpConsistentAcrossSurfaces: {
    id: 'CP-D04',
    name: 'MCP config consistent across surfaces',
    check: (ctx) => {
      const mcpData = mcpJsonData(ctx);
      if (!mcpData) return null;
      const cloud = cloudAgentContent(ctx);
      if (!cloud) return null;
      // If both VS Code MCP and cloud config exist, check for alignment
      const vsCodeServers = Object.keys(mcpData.servers || mcpData.mcpServers || {});
      if (vsCodeServers.length === 0) return null;
      // Check if cloud setup mentions MCP or server names
      const cloudMentionsMcp = /mcp|server/i.test(cloud);
      return cloudMentionsMcp;
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'Ensure MCP server configuration is consistent across VS Code and cloud agent surfaces.',
    template: null,
    file: () => '.vscode/mcp.json',
    line: () => null,
  },

  copilotMcpAuthDocumented: {
    id: 'CP-D05',
    name: 'MCP auth requirements documented',
    check: (ctx) => {
      const mcpData = mcpJsonData(ctx);
      if (!mcpData) return null;
      const servers = mcpData.servers || mcpData.mcpServers || {};
      if (Object.keys(servers).length === 0) return null;
      // Check if any server has env vars that need to be set
      const hasEnvVars = Object.values(servers).some(config => {
        const configStr = JSON.stringify(config);
        return /\$\{|\benv\b|API_KEY|TOKEN|SECRET/i.test(configStr);
      });
      if (!hasEnvVars) return true;
      // Check if auth is documented
      const instr = copilotInstructions(ctx) || '';
      const readme = ctx.fileContent('README.md') || '';
      return /mcp.*auth|mcp.*key|mcp.*token|mcp.*secret/i.test(`${instr}\n${readme}`);
    },
    impact: 'medium',
    rating: 3,
    category: 'mcp',
    fix: 'Document MCP server authentication requirements (API keys, tokens) in instructions or README.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  // =============================================
  // E. Cloud Agent (5 checks) — CP-E01..CP-E05
  // =============================================

  copilotCloudDependencyInstall: {
    id: 'CP-E01',
    name: 'copilot-setup-steps.yml has dependency installation',
    check: (ctx) => {
      const cloud = cloudAgentContent(ctx);
      if (!cloud) return null;
      return /npm install|yarn install|pnpm install|pip install|apt-get|brew install|go mod download|cargo build/i.test(cloud);
    },
    impact: 'high',
    rating: 5,
    category: 'cloud-agent',
    fix: 'Add dependency installation steps to copilot-setup-steps.yml.',
    template: 'copilot-cloud-setup',
    file: () => '.github/workflows/copilot-setup-steps.yml',
    line: (ctx) => {
      const cloud = cloudAgentContent(ctx);
      return cloud ? firstLineMatching(cloud, /install/) : null;
    },
  },

  copilotCloudTestConfigured: {
    id: 'CP-E02',
    name: 'copilot-setup-steps.yml has test command configured',
    check: (ctx) => {
      const cloud = cloudAgentContent(ctx);
      if (!cloud) return null;
      return /npm test|yarn test|pnpm test|pytest|go test|cargo test|make test/i.test(cloud);
    },
    impact: 'high',
    rating: 4,
    category: 'cloud-agent',
    fix: 'Add test command to copilot-setup-steps.yml so cloud agent can verify changes.',
    template: 'copilot-cloud-setup',
    file: () => '.github/workflows/copilot-setup-steps.yml',
    line: (ctx) => {
      const cloud = cloudAgentContent(ctx);
      return cloud ? firstLineMatching(cloud, /test/) : null;
    },
  },

  copilotCloudSignedCommits: {
    id: 'CP-E03',
    name: 'Cloud agent commits are signed (verified GA April 3, 2026)',
    check: (ctx) => {
      const cloud = cloudAgentContent(ctx);
      if (!cloud) return null;
      // Signed commits are now GA — check if documented
      const instr = copilotInstructions(ctx) || '';
      return /signed commit|commit.*sign|gpg.*sign|verified.*commit/i.test(`${instr}\n${cloud}`);
    },
    impact: 'medium',
    rating: 3,
    category: 'cloud-agent',
    fix: 'Document that cloud agent commits are signed (GA since April 3, 2026).',
    template: null,
    file: () => '.github/workflows/copilot-setup-steps.yml',
    line: () => null,
  },

  copilotCloudNoUnsafeEnvVars: {
    id: 'CP-E04',
    name: 'No unsafe env vars exposed in setup workflow',
    check: (ctx) => {
      const cloud = cloudAgentContent(ctx);
      if (!cloud) return null;
      // Check for hardcoded secrets or dangerous env patterns
      if (containsEmbeddedSecret(cloud)) return false;
      // Check for env vars that expose secrets without using GitHub secrets syntax
      const lines = cloud.split(/\r?\n/);
      for (const line of lines) {
        if (/^\s*(export\s+)?[A-Z_]+=\S/.test(line) && !/\$\{\{/.test(line)) {
          if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(line)) return false;
        }
      }
      return true;
    },
    impact: 'critical',
    rating: 5,
    category: 'cloud-agent',
    fix: 'Use ${{ secrets.* }} for all sensitive env vars in copilot-setup-steps.yml instead of hardcoded values.',
    template: null,
    file: () => '.github/workflows/copilot-setup-steps.yml',
    line: (ctx) => {
      const cloud = cloudAgentContent(ctx);
      return cloud ? findSecretLine(cloud) : null;
    },
  },

  copilotCloudImplementationPlan: {
    id: 'CP-E05',
    name: 'Implementation plan mode enabled for complex tasks',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      if (!instr) return null;
      // Plan mode is an advisory feature. Only evaluate if the repo has a cloud
      // agent surface (where plan mode actually kicks in), otherwise N/A.
      if (!cloudAgentContent(ctx)) return null;
      return /implementation plan|plan mode|step.?by.?step plan|break.*into.*steps/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'cloud-agent',
    fix: 'Document implementation plan mode in instructions for complex cloud agent tasks.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: (ctx) => {
      const instr = copilotInstructions(ctx);
      return instr ? firstLineMatching(instr, /implementation plan|plan mode/i) : null;
    },
  },

  // =============================================
  // F. Organization (5 checks) — CP-F01..CP-F05
  // =============================================

  copilotOrgPoliciesConfigured: {
    id: 'CP-F01',
    name: 'Org policies are configured (if Business/Enterprise)',
    check: (ctx) => {
      // Can't detect org policies from files; check for awareness
      const instr = copilotInstructions(ctx) || '';
      const readme = ctx.fileContent('README.md') || '';
      const hasOrgMention = /\borg.*polic|\borg.*admin|\bbusiness plan|\benterprise/i.test(`${instr}\n${readme}`);
      if (hasOrgMention) return true;
      return null; // N/A if no org signals
    },
    impact: 'medium',
    rating: 3,
    category: 'organization',
    fix: 'If using Business/Enterprise plan, document org-level policies that affect Copilot behavior.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotThirdPartyAgentPolicy: {
    id: 'CP-F02',
    name: 'Third-party agent policy is explicit',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      const readme = ctx.fileContent('README.md') || '';
      const combined = `${instr}\n${readme}`;
      // Only evaluate if the repo already surfaces third-party agent usage
      // alongside Copilot (i.e. two or more distinct agents). The presence of
      // the word "agent" alone (which every Copilot instruction file uses)
      // isn't enough to demand a policy statement.
      const agents = ['claude', 'codex', 'cursor', 'aider', 'continue', 'windsurf', 'cline'];
      const hits = agents.filter(a => new RegExp('\\b' + a + '\\b', 'i').test(combined));
      if (hits.length === 0 && !/\bthird.?party\s+agent/i.test(combined)) return null;
      return /third.?party.*agent|agent.*policy|agent.*allowed|agent.*governed|claude.*copilot|codex.*copilot|multi[- ]agent|agents?[^.]*policy/i.test(combined);
    },
    impact: 'medium',
    rating: 3,
    category: 'organization',
    fix: 'Document third-party agent policy (whether Claude, Codex, etc. are allowed within Copilot).',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotAuditLogsEnabled: {
    id: 'CP-F03',
    name: 'Audit logs enabled (Enterprise)',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      const readme = ctx.fileContent('README.md') || '';
      const combined = `${instr}\n${readme}`;
      if (!/enterprise/i.test(combined)) return null;
      return /\baudit log|\baudit trail/i.test(combined);
    },
    impact: 'medium',
    rating: 3,
    category: 'organization',
    fix: 'Enable and document audit log configuration for Enterprise Copilot usage.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotModelAccessPolicy: {
    id: 'CP-F04',
    name: 'Model access policy matches team needs',
    check: (ctx) => {
      // N/A unless we detect team/org signals
      const instr = copilotInstructions(ctx) || '';
      if (!/\bteam\b|\borg\b|\benterprise\b/i.test(instr)) return null;
      return /model.*access|model.*policy|allowed model/i.test(instr);
    },
    impact: 'low',
    rating: 2,
    category: 'organization',
    fix: 'Document model access policy if specific models need to be enabled or restricted for the team.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotContentExclusionPropagation: {
    id: 'CP-F05',
    name: 'Content exclusion propagation delay documented',
    check: (ctx) => {
      const exclusions = ctx.contentExclusions ? ctx.contentExclusions() : null;
      if (!exclusions) return null;
      const instr = copilotInstructions(ctx) || '';
      return /propagation.*delay|30 minute|exclusion.*delay/i.test(instr);
    },
    impact: 'low',
    rating: 2,
    category: 'organization',
    fix: 'Document that content exclusion changes have up to 30-minute propagation delay.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  // =============================================
  // G. Prompt Files & Templates (4 checks) — CP-G01..CP-G04
  // =============================================

  copilotPromptDirExists: {
    id: 'CP-G01',
    name: '.github/prompts/ directory exists with reusable templates',
    check: (ctx) => {
      // Prompt files are an opt-in feature. If the repo has a
      // .github/prompts/ directory, verify it's populated; otherwise N/A —
      // most repos don't (and shouldn't have to) maintain prompt templates.
      if (ctx.hasDir('.github/prompts')) return true;
      return null;
    },
    impact: 'medium',
    rating: 4,
    category: 'prompt-files',
    fix: 'Create .github/prompts/ directory with reusable prompt templates.',
    template: 'copilot-prompts',
    file: () => '.github/prompts/',
    line: () => null,
  },

  copilotPromptFilesValidFrontmatter: {
    id: 'CP-G02',
    name: 'Prompt files have valid frontmatter (agent, model, tools)',
    check: (ctx) => {
      const prompts = ctx.promptFiles ? ctx.promptFiles() : [];
      if (prompts.length === 0) return null;
      return prompts.every(p => p.frontmatter !== null);
    },
    impact: 'high',
    rating: 4,
    category: 'prompt-files',
    fix: 'Add YAML frontmatter to all .prompt.md files with at least a description field.',
    template: null,
    file: () => '.github/prompts/',
    line: () => 1,
  },

  copilotPromptParameterization: {
    id: 'CP-G03',
    name: 'Prompt files use ${input:var} for parameterization',
    check: (ctx) => {
      const prompts = ctx.promptFiles ? ctx.promptFiles() : [];
      if (prompts.length === 0) return null;
      // Not all prompts need params, but check if any use them
      return prompts.some(p => /\$\{input:/.test(p.body || ''));
    },
    impact: 'low',
    rating: 2,
    category: 'prompt-files',
    fix: 'Consider using ${input:variable} in prompt files for dynamic parameterization.',
    template: null,
    file: () => '.github/prompts/',
    line: () => null,
  },

  copilotNoDuplicatePromptNames: {
    id: 'CP-G04',
    name: 'No duplicate prompt names (avoid /name conflicts)',
    check: (ctx) => {
      const prompts = ctx.promptFiles ? ctx.promptFiles() : [];
      if (prompts.length <= 1) return null;
      const names = prompts.map(p => p.name);
      return new Set(names).size === names.length;
    },
    impact: 'medium',
    rating: 3,
    category: 'prompt-files',
    fix: 'Rename duplicate prompt files to avoid /name conflicts in Copilot Chat.',
    template: null,
    file: () => '.github/prompts/',
    line: () => null,
  },

  // =============================================
  // H. Agents & Skills (4 checks) — CP-H01..CP-H04
  // =============================================

  copilotAgentsMdEnabled: {
    id: 'CP-H01',
    name: 'If AGENTS.md exists, verify it is enabled in VS Code (CLI reads it automatically)',
    check: (ctx) => {
      const agentsMd = ctx.fileContent('AGENTS.md');
      if (!agentsMd) return null; // N/A
      // AGENTS.md support needs explicit enabling in VS Code.
      // N/A if the repo doesn't configure VS Code for Copilot — then there's
      // no setting to toggle. (Copilot CLI reads AGENTS.md automatically.)
      const raw = vscodeSettingsRaw(ctx);
      if (!raw) return null;
      if (!/github\.copilot|chat\./.test(raw)) return null;
      const data = vscodeSettingsData(ctx);
      if (!data) return false;
      return /chat\.agent\.enabled.*true|agent\.enabled.*true/i.test(raw);
    },
    impact: 'critical',
    rating: 5,
    category: 'skills-agents',
    fix: 'Enable AGENTS.md in VS Code settings (off by default). WARNING: Copilot CLI reads AGENTS.md and CLAUDE.md automatically — use --no-custom-instructions to prevent cross-platform instruction leakage.',
    template: 'copilot-vscode-settings',
    file: () => '.vscode/settings.json',
    line: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      return raw ? firstLineMatching(raw, /agent\.enabled/) : null;
    },
  },

  copilotExtensionsMode: {
    id: 'CP-H02',
    name: 'Extensions are compatible with intended mode (Ask vs Agent)',
    check: (ctx) => {
      // Check if instructions mention extensions and clarify mode compatibility
      const instr = copilotInstructions(ctx) || '';
      if (!/extension/i.test(instr)) return null;
      return /extension.*ask mode|extension.*agent mode|ask mode.*extension|agent mode.*extension/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'skills-agents',
    fix: 'Document that Copilot Extensions only work in Ask mode, not Agent mode.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotSpacesIndexed: {
    id: 'CP-H03',
    name: 'Spaces/knowledge bases are indexed for relevant repos',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      // "space" matches "namespace", "workspace", "whitespace", etc. Tighten
      // to the Copilot-specific usage of "Copilot Spaces" or "knowledge base".
      if (!/copilot spaces?|\bspace\s+indexed|knowledge base/i.test(instr)) return null;
      return /space.*index|index.*space|knowledge.*base.*configured|knowledge.*base.*indexed/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'skills-agents',
    fix: 'Configure Copilot Spaces/knowledge bases for relevant repos.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotWorkingSetAppropriate: {
    id: 'CP-H04',
    name: 'VS Code agent working set is appropriate for project size',
    check: (ctx) => {
      // Advisory — only evaluate if the repo uses VS Code and mentions it.
      if (!vscodeSettingsRaw(ctx)) return null;
      const instr = copilotInstructions(ctx) || '';
      if (!/working set|context.*window|file.*limit|token.*limit/i.test(instr)) return null;
      return true;
    },
    impact: 'low',
    rating: 2,
    category: 'skills-agents',
    fix: 'Document working set and context management guidance for large projects.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  // =============================================
  // I. VS Code IDE (4 checks) — CP-I01..CP-I04
  // =============================================

  copilotAgentModeEnabled: {
    id: 'CP-I01',
    name: 'Agent mode enabled in VS Code',
    check: (ctx) => {
      const data = vscodeSettingsData(ctx);
      if (!data) return null;
      const raw = vscodeSettingsRaw(ctx);
      return /agent\.enabled.*true|github\.copilot\.chat\.agent\.enabled.*true/i.test(raw);
    },
    impact: 'medium',
    rating: 4,
    category: 'extensions',
    fix: 'Enable agent mode in .vscode/settings.json: "github.copilot.chat.agent.enabled": true',
    template: 'copilot-vscode-settings',
    file: () => '.vscode/settings.json',
    line: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      return raw ? firstLineMatching(raw, /agent\.enabled/) : null;
    },
  },

  copilotChatParticipants: {
    id: 'CP-I02',
    name: 'Chat participants (@workspace, @terminal) configured',
    check: (ctx) => {
      // Advisory — only flag if the repo uses VS Code and already mentions
      // chat participants; otherwise N/A.
      if (!vscodeSettingsRaw(ctx)) return null;
      const instr = copilotInstructions(ctx) || '';
      if (!/@workspace|@terminal|@vscode|chat participant/i.test(instr)) return null;
      return true;
    },
    impact: 'low',
    rating: 2,
    category: 'extensions',
    fix: 'Document available chat participants (@workspace, @terminal) in instructions.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotActiveInstructions: {
    id: 'CP-I03',
    name: 'Review, commit, PR instructions are active (not deprecated)',
    check: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      if (!raw) return null;
      // Check if any active instruction keys are used
      return /reviewSelection\.instructions|commitMessageGeneration\.instructions|pullRequestDescriptionGeneration\.instructions/i.test(raw);
    },
    impact: 'medium',
    rating: 3,
    category: 'extensions',
    fix: 'Use active instruction keys (reviewSelection, commitMessageGeneration, pullRequestDescriptionGeneration) instead of deprecated codeGeneration.',
    template: null,
    file: () => '.vscode/settings.json',
    line: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      return raw ? firstLineMatching(raw, /reviewSelection|commitMessage|pullRequestDescription/) : null;
    },
  },

  copilotDevContainerSupport: {
    id: 'CP-I04',
    name: 'DevContainer support documented if used',
    check: (ctx) => {
      const hasDevContainer = ctx.fileContent('.devcontainer/devcontainer.json') || ctx.hasDir('.devcontainer');
      if (!hasDevContainer) return null;
      const instr = copilotInstructions(ctx) || '';
      return /devcontainer|dev container|codespace/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'extensions',
    fix: 'Document DevContainer / Codespaces configuration for Copilot usage.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  // =============================================
  // J. CLI (4 checks) — CP-J01..CP-J04
  // =============================================

  copilotCliInstalled: {
    id: 'CP-J01',
    name: 'gh copilot installed and authenticated',
    check: (ctx) => {
      // N/A unless the repo actually references gh copilot or Copilot CLI —
      // most repos aren't CLI-centric and shouldn't be penalised.
      const instr = copilotInstructions(ctx) || '';
      const readme = ctx.fileContent('README.md') || '';
      const combined = `${instr}\n${readme}`;
      if (!/gh copilot|github copilot cli|copilot cli/i.test(combined)) return null;
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'ci-automation',
    fix: 'Document gh copilot CLI setup instructions.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotCliMcp: {
    id: 'CP-J02',
    name: 'CLI MCP servers configured',
    check: (ctx) => {
      // CLI MCP is local-only; check for documentation
      const instr = copilotInstructions(ctx) || '';
      const readme = ctx.fileContent('README.md') || '';
      if (!/cli.*mcp|mcp.*cli/i.test(`${instr}\n${readme}`)) return null;
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'ci-automation',
    fix: 'Document CLI MCP server configuration.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotCliAliases: {
    id: 'CP-J03',
    name: 'CLI aliases (ghcs/ghce) set up',
    check: (ctx) => {
      // Advisory — only relevant if the repo documents Copilot CLI usage.
      const instr = copilotInstructions(ctx) || '';
      const readme = ctx.fileContent('README.md') || '';
      const combined = `${instr}\n${readme}`;
      if (!/gh copilot|copilot cli/i.test(combined)) return null;
      return /ghcs|ghce|copilot suggest|copilot explain/i.test(combined);
    },
    impact: 'low',
    rating: 2,
    category: 'ci-automation',
    fix: 'Document CLI aliases (ghcs for suggest, ghce for explain).',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotCliAuthToken: {
    id: 'CP-J04',
    name: 'CLI auth uses token, not hardcoded credentials',
    check: (ctx) => {
      // Check if any file has hardcoded gh auth tokens
      const files = ['.env', '.env.example', 'copilot-setup-steps.yml'];
      for (const f of files) {
        const content = ctx.fileContent(f) || ctx.fileContent(`.github/workflows/${f}`) || '';
        if (/gh[ps]_[A-Za-z0-9_]{36,}/.test(content)) return false;
      }
      return true;
    },
    impact: 'high',
    rating: 5,
    category: 'ci-automation',
    fix: 'Use gh auth login or token-based auth instead of hardcoded credentials.',
    template: null,
    file: () => '.env',
    line: () => null,
  },

  // =============================================
  // K. Cross-Surface Consistency (5 checks) — CP-K01..CP-K05
  // =============================================

  copilotCrossSurfaceInstructions: {
    id: 'CP-K01',
    name: 'Instructions are consistent across VS Code, cloud, and CLI surfaces',
    check: (ctx) => {
      const instr = copilotInstructions(ctx);
      const cloud = cloudAgentContent(ctx);
      if (!instr) return null;
      if (!cloud) return null;
      // Check that cloud setup references the instructions
      return /copilot-instructions|instructions/i.test(cloud);
    },
    impact: 'high',
    rating: 4,
    category: 'quality-deep',
    fix: 'Ensure instructions are referenced consistently across all Copilot surfaces.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotCrossSurfaceMcp: {
    id: 'CP-K02',
    name: 'MCP config is consistent across surfaces',
    check: (ctx) => {
      const mcpData = mcpJsonData(ctx);
      const cloud = cloudAgentContent(ctx);
      if (!mcpData || !cloud) return null;
      return /mcp/i.test(cloud);
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Align MCP server configuration across VS Code and cloud agent surfaces.',
    template: null,
    file: () => '.vscode/mcp.json',
    line: () => null,
  },

  copilotCrossSurfaceModel: {
    id: 'CP-K03',
    name: 'Model preferences are aligned across surfaces',
    check: (ctx) => {
      const prompts = ctx.promptFiles ? ctx.promptFiles() : [];
      const models = new Set();
      for (const p of prompts) {
        if (p.frontmatter && p.frontmatter.model) {
          models.add(p.frontmatter.model);
        }
      }
      if (models.size <= 1) return null;
      // Multiple different models in prompt files — flag for review
      return models.size <= 2; // Allow up to 2 different models
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Align model preferences across prompt files and surfaces for consistent behavior.',
    template: null,
    file: () => '.github/prompts/',
    line: () => null,
  },

  copilotCrossSurfaceSecurity: {
    id: 'CP-K04',
    name: 'Security posture is consistent (no surface has weaker controls)',
    check: (ctx) => {
      const hasSandbox = getCopilotSetting(ctx, 'chat.tools.terminal.sandbox.enabled') === true;
      const cloud = cloudAgentContent(ctx);
      const instr = copilotInstructions(ctx) || '';
      // If VS Code is sandboxed, check cloud and CLI awareness
      if (hasSandbox && cloud) {
        return /security|review.*required|PR.*gate/i.test(cloud);
      }
      return null;
    },
    impact: 'high',
    rating: 4,
    category: 'quality-deep',
    fix: 'Ensure no Copilot surface has weaker security controls than others.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotCrossSurfaceExclusions: {
    id: 'CP-K05',
    name: 'Content exclusions applied at org level (not just repo)',
    check: (ctx) => {
      const exclusions = ctx.contentExclusions ? ctx.contentExclusions() : null;
      if (!exclusions) return null;
      const instr = copilotInstructions(ctx) || '';
      return /org.*exclu|exclu.*org|organization.*content/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Apply content exclusions at org level for consistent enforcement across repos.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  // =============================================
  // L. Enterprise & Governance (5 checks) — CP-L01..CP-L05
  // =============================================

  copilotBYOKConfigured: {
    id: 'CP-L01',
    name: 'BYOK (custom model provider) is configured correctly',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      if (!/byok|bring your own|custom model|custom provider/i.test(instr)) return null;
      return /byok.*configured|custom.*model.*set/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'enterprise',
    fix: 'Document BYOK (custom model provider) configuration if used.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotFineTunedModelScoped: {
    id: 'CP-L02',
    name: 'Fine-tuned model access is scoped to appropriate repos',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      if (!/fine.?tune|custom.*model/i.test(instr)) return null;
      return /scope|restrict|appropriate.*repo/i.test(instr);
    },
    impact: 'high',
    rating: 4,
    category: 'enterprise',
    fix: 'Scope fine-tuned model access to appropriate repos only.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotAuditRetention: {
    id: 'CP-L03',
    name: 'Audit log retention meets compliance requirements',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      if (!/audit.*log|audit.*trail/i.test(instr)) return null;
      return /retention|compliance|retention.*day|retention.*month/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'enterprise',
    fix: 'Document audit log retention policy for compliance.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotMcpRegistryAllowlist: {
    id: 'CP-L04',
    name: 'MCP registry allowlist is maintained',
    check: (ctx) => {
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      if (Object.keys(servers).length === 0) return null;
      const instr = copilotInstructions(ctx) || '';
      return /mcp.*allowlist|mcp.*registry|approved.*mcp/i.test(instr);
    },
    impact: 'high',
    rating: 4,
    category: 'enterprise',
    fix: 'Maintain an MCP registry allowlist for governance.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotThirdPartyAgentGoverned: {
    id: 'CP-L05',
    name: 'Third-party agent usage is explicitly governed',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      // Only evaluate if the instructions already mention third-party agents
      // or an enterprise/governance context; otherwise N/A.
      if (!/third.?party|agent|enterprise|governance|policy/i.test(instr)) return null;
      return /third.?party.*agent.*governed|agent.*governance|governed.*agent|agent.*policy|agent.*allowed|agent.*restrict/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'enterprise',
    fix: 'Document governance rules for third-party agent usage within Copilot.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  // =============================================
  // M. Quality Deep (6 checks) — CP-M01..CP-M06
  // =============================================

  copilotModernFeatures: {
    id: 'CP-M01',
    name: 'Instructions mention modern Copilot features (prompt files, Spaces, agent mode)',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      if (!instr) return null;
      // Only evaluate if the instructions already reference Copilot features
      // or modes; mandating these mentions globally produces FPs on repos
      // whose instructions focus on project-specific guidance.
      if (!/\bcopilot\b|\bagent\b|\bprompt\b|\bchat\b/i.test(instr)) return null;
      return /\bprompt file|\bspace|\bagent mode|\b\.prompt\.md|\bcopilot\b/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Reference modern Copilot features (prompt files, Spaces, agent mode) in instructions.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotNoDeprecatedReferences: {
    id: 'CP-M02',
    name: 'No references to deprecated features (knowledge bases, codeGeneration.instructions)',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      if (!instr) return null;
      return !/codeGeneration\.instructions|knowledge base.*deprecated/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Remove references to deprecated features from instructions.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: (ctx) => {
      const instr = copilotInstructions(ctx);
      return instr ? firstLineMatching(instr, /codeGeneration\.instructions/) : null;
    },
  },

  copilotColdBootAwareness: {
    id: 'CP-M03',
    name: 'Cloud agent cold-boot awareness documented',
    check: (ctx) => {
      const cloud = cloudAgentContent(ctx);
      if (!cloud) return null;
      const instr = copilotInstructions(ctx) || '';
      return /cold.?boot|90 second|startup.*delay|initialization.*time/i.test(`${instr}\n${cloud}`);
    },
    impact: 'low',
    rating: 2,
    category: 'quality-deep',
    fix: 'Document cloud agent cold-boot time (~90 seconds) and mitigation strategies.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotBillingAwareness: {
    id: 'CP-M04',
    name: 'Rate limit / premium billing awareness documented',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      if (!instr) return null;
      // Billing awareness is only relevant for repos whose instructions
      // actually reference plans, billing, premium usage, or rate limits. The
      // predicate has to be specific; generic words like "limit" or "usage"
      // fire on unrelated content (e.g. "limit noise in comments").
      if (!/rate limit|\bbilling\b|\bpremium\b|\bquota\b|\bsubscription\b|token limit|usage limit/i.test(instr)) return null;
      return /rate limit|billing|premium|usage limit|token limit|quota/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Document rate limits, premium billing, and usage awareness.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotReviewCharLimit: {
    id: 'CP-M05',
    name: 'Instructions tailored for code review (within 4,000 char limit)',
    check: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      if (!raw) return null;
      if (!raw.includes('reviewSelection')) return null;
      // Check if review instructions exist and are within char limit
      const reviewInstr = getCopilotSetting(ctx, 'github.copilot.chat.reviewSelection.instructions');
      if (!reviewInstr) return null;
      const content = Array.isArray(reviewInstr)
        ? reviewInstr.map(i => typeof i === 'string' ? i : (i.text || '')).join('\n')
        : String(reviewInstr);
      return content.length <= 4000;
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Keep code review instructions within the 4,000 character limit.',
    template: null,
    file: () => '.vscode/settings.json',
    line: (ctx) => {
      const raw = vscodeSettingsRaw(ctx);
      return raw ? firstLineMatching(raw, /reviewSelection/) : null;
    },
  },

  copilotInstructionDuplication: {
    id: 'CP-M06',
    name: 'Cross-surface instruction duplication minimized',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      const cloud = cloudAgentContent(ctx) || '';
      if (!instr || !cloud) return null;
      // Simple check: count common substantial lines
      const instrLines = instr.split(/\r?\n/).filter(l => l.trim().length > 30);
      const cloudLines = new Set(cloud.split(/\r?\n/).filter(l => l.trim().length > 30));
      let dupes = 0;
      for (const line of instrLines) {
        if (cloudLines.has(line.trim())) dupes++;
      }
      return dupes < 5;
    },
    impact: 'low',
    rating: 2,
    category: 'quality-deep',
    fix: 'Minimize instruction duplication across surfaces. Use copilot-instructions.md as single source of truth.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  // =============================================
  // N. Advisory (4 checks) — CP-N01..CP-N04
  // =============================================

  copilotAdvisoryInstructionQuality: {
    id: 'CP-N01',
    name: 'Instruction quality score meets advisory threshold',
    check: (ctx) => {
      const content = copilotInstructions(ctx);
      if (!content) return null;
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
    fix: 'Improve instruction quality: add more sections, architecture diagram, and verification commands.',
    template: 'copilot-instructions',
    file: () => '.github/copilot-instructions.md',
    line: () => 1,
  },

  copilotAdvisorySecurityPosture: {
    id: 'CP-N02',
    name: 'Security posture meets advisory threshold',
    check: (ctx) => {
      let score = 0;
      if (getCopilotSetting(ctx, 'chat.tools.terminal.sandbox.enabled') === true) score++;
      if (ctx.contentExclusions && ctx.contentExclusions()) score++;
      const autoApproval = getCopilotSetting(ctx, 'chat.agent.autoApproval.terminalCommands');
      if (!autoApproval || (Array.isArray(autoApproval) && !autoApproval.includes('*'))) score++;
      const instr = copilotInstructions(ctx) || '';
      if (/security|secret|credential/i.test(instr)) score++;
      // Credit repos that ship a SECURITY.md or equivalent policy file.
      if (ctx.fileContent('SECURITY.md') || ctx.fileContent('.github/SECURITY.md')) score++;
      // Credit gitignore awareness of sensitive patterns (checked by CP-C01).
      const gitignore = ctx.fileContent('.gitignore') || '';
      if (/\.env\b|secrets\/|credentials|\.pem\b|\.key\b/i.test(gitignore)) score++;
      return score >= 2;
    },
    impact: 'high',
    rating: 5,
    category: 'advisory',
    fix: 'Improve security posture: enable sandbox, configure exclusions, restrict auto-approval.',
    template: null,
    file: () => '.vscode/settings.json',
    line: () => null,
  },

  copilotAdvisorySurfaceCoverage: {
    id: 'CP-N03',
    name: 'Multi-surface coverage meets advisory threshold',
    check: (ctx) => {
      const surfaces = ctx.detectSurfaces ? ctx.detectSurfaces() : {};
      let configured = 0;
      if (surfaces.vscode) configured++;
      if (surfaces.cloudAgent) configured++;
      // CLI surface: Copilot CLI reads copilot-instructions.md / AGENTS.md /
      // CLAUDE.md automatically. Count any of these as the CLI surface.
      if (ctx.fileContent('.github/copilot-instructions.md') ||
          ctx.fileContent('AGENTS.md') ||
          ctx.fileContent('CLAUDE.md')) {
        configured++;
      }
      return configured >= 1;
    },
    impact: 'medium',
    rating: 4,
    category: 'advisory',
    fix: 'Configure at least VS Code surface. Add cloud agent setup for full coverage.',
    template: null,
    file: () => '.vscode/settings.json',
    line: () => null,
  },

  copilotAdvisoryMcpHealth: {
    id: 'CP-N04',
    name: 'MCP configuration health meets advisory threshold',
    check: (ctx) => {
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      const count = Object.keys(servers).length;
      if (count === 0) return null;
      // Check that MCP config is valid JSON and servers have required fields
      const mcpResult = ctx.mcpConfig();
      return mcpResult && mcpResult.ok;
    },
    impact: 'medium',
    rating: 3,
    category: 'advisory',
    fix: 'Ensure MCP configuration is valid and servers are properly configured.',
    template: null,
    file: () => '.vscode/mcp.json',
    line: () => null,
  },

  // =============================================
  // O. Pack (4 checks) — CP-O01..CP-O04
  // =============================================

  copilotPackDomainDetected: {
    id: 'CP-O01',
    name: 'Domain pack detection returns relevant results',
    check: (ctx) => {
      // Always passes if we can detect stacks
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

  copilotPackMcpRecommended: {
    id: 'CP-O02',
    name: 'MCP packs recommended based on project signals',
    check: (ctx) => {
      // Only relevant if the repo uses MCP at all.
      const raw = mcpJsonRaw(ctx);
      const instr = copilotInstructions(ctx) || '';
      if (!raw && !/\bmcp\b|model context protocol/i.test(instr)) return null;
      const servers = ctx.mcpServers ? ctx.mcpServers() : {};
      return Object.keys(servers).length > 0;
    },
    impact: 'low',
    rating: 2,
    category: 'advisory',
    fix: 'Add recommended MCP packs to .vscode/mcp.json based on project domain.',
    template: 'copilot-mcp',
    file: () => '.vscode/mcp.json',
    line: () => null,
  },

  copilotPackGovernanceApplied: {
    id: 'CP-O03',
    name: 'Governance pack applied if enterprise signals detected',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      if (!/enterprise|business/i.test(instr)) return null;
      return /governance|policy|audit/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'advisory',
    fix: 'Apply governance pack for enterprise repos.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotPackConsistency: {
    id: 'CP-O04',
    name: 'All applied packs are consistent with each other',
    check: (ctx) => {
      // Check that instructions and settings don't contradict
      const instr = copilotInstructions(ctx) || '';
      const raw = vscodeSettingsRaw(ctx);
      if (!instr || !raw) return null;
      // No contradiction: if instructions say "strict" and settings say "yolo"
      const instrStrict = /\bstrict\b|\blocked.?down\b|\bno auto/i.test(instr);
      const settingsPermissive = /autoApproval.*\*|yolo/i.test(raw);
      return !(instrStrict && settingsPermissive);
    },
    impact: 'medium',
    rating: 3,
    category: 'advisory',
    fix: 'Resolve contradictions between instruction guidance and settings configuration.',
    template: null,
    file: () => '.vscode/settings.json',
    line: () => null,
  },

  // =============================================
  // P. Repeat (3 checks) — CP-P01..CP-P03
  // =============================================

  copilotRepeatScoreImproved: {
    id: 'CP-P01',
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

  copilotRepeatNoRegressions: {
    id: 'CP-P02',
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

  copilotRepeatFeedbackLoop: {
    id: 'CP-P03',
    name: 'Feedback loop active for recommendations',
    check: () => null, // Requires feedback data
    impact: 'low',
    rating: 2,
    category: 'freshness',
    fix: 'Use `npx nerviq --platform copilot feedback` to rate recommendations.',
    template: null,
    file: () => null,
    line: () => null,
  },

  // =============================================
  // Q. Experiment-Verified CLI Fixes (5 checks) — CP-Q01..CP-Q05
  // Added from runtime experiment findings (2026-04-05)
  // =============================================

  copilotCliIngestsNonCopilotFiles: {
    id: 'CP-Q01',
    name: 'Aware that Copilot CLI ingests AGENTS.md and CLAUDE.md',
    check: (ctx) => {
      const agentsMd = ctx.fileContent('AGENTS.md');
      const claudeMd = ctx.fileContent('CLAUDE.md');
      if (!agentsMd && !claudeMd) return null; // No cross-platform files
      // If the repo has AGENTS.md or CLAUDE.md AND a dedicated copilot-
      // instructions.md, the cross-platform awareness needs to be explicit
      // (the files diverge in practice). If the repo has ONLY AGENTS.md /
      // CLAUDE.md (no dedicated Copilot file), the convergence is de facto
      // by design — Copilot CLI reads these automatically. Pass.
      const dedicatedCopilot = ctx.fileContent('.github/copilot-instructions.md');
      if (!dedicatedCopilot) return true;
      return /copilot cli|--no-custom-instructions|cross.platform|AGENTS\.md|CLAUDE\.md|claude code|codex|cursor/i.test(dedicatedCopilot);
    },
    impact: 'high',
    rating: 4,
    category: 'quality-deep',
    fix: 'WARNING: Copilot CLI ingests AGENTS.md and CLAUDE.md alongside copilot-instructions.md. Document this or use --no-custom-instructions for clean runs.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotCliMcpUsesServerKey: {
    id: 'CP-Q02',
    name: 'CLI MCP config uses mcpServers key (not servers)',
    check: (ctx) => {
      const mcpData = mcpJsonData(ctx);
      if (!mcpData) return null;
      // CLI expects mcpServers, not servers
      if (mcpData.servers && !mcpData.mcpServers) return false;
      return true;
    },
    impact: 'high',
    rating: 4,
    category: 'ci-automation',
    fix: 'Copilot CLI MCP config expects the "mcpServers" key. "servers" alone may not work in CLI context.',
    template: null,
    file: () => '.vscode/mcp.json',
    line: () => 1,
  },

  copilotVscodeSettingsNotCliRelevant: {
    id: 'CP-Q03',
    name: 'VS Code-specific settings not assumed to affect CLI',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      if (!instr) return null;
      // If instructions reference VS Code settings as if they affect CLI, flag it
      const mentionsCli = /copilot cli|gh copilot/i.test(instr);
      const mentionsVscodeForCli = /chat\.tools.*cli|terminal\.sandbox.*cli|autoApproval.*cli/i.test(instr);
      if (mentionsCli && mentionsVscodeForCli) return false;
      return true;
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'VS Code settings (sandbox, autoApproval, instructionsFilesLocations) do not affect Copilot CLI. Document CLI-specific configuration separately.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotOrgPolicyBlocksMcp: {
    id: 'CP-Q04',
    name: 'Org policy MCP restrictions documented if applicable',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      const mcpData = mcpJsonData(ctx);
      if (!mcpData) return null;
      const servers = mcpData.servers || mcpData.mcpServers || {};
      if (Object.keys(servers).length === 0) return null;
      // If MCP servers are configured, check that org policy restrictions are documented
      return /org.policy|policy.block|third.party.*mcp|mcp.*restrict|Access denied/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Document that org policies can block third-party MCP servers even in local CLI sessions. Error: "Access denied by policy settings".',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  copilotByokMcpCaveat: {
    id: 'CP-Q05',
    name: 'BYOK mode MCP limitations documented',
    check: (ctx) => {
      const instr = copilotInstructions(ctx) || '';
      // Only relevant if BYOK is mentioned
      if (!/byok|bring your own key|openai.*key|COPILOT_.*KEY/i.test(instr)) return null;
      return /byok.*mcp|mcp.*byok|oauth.*broken|built.in.*github.*mcp/i.test(instr);
    },
    impact: 'medium',
    rating: 3,
    category: 'quality-deep',
    fix: 'Document that BYOK mode breaks built-in GitHub MCP server (OAuth auth unavailable). Third-party MCP may also be restricted by org policy.',
    template: null,
    file: () => '.github/copilot-instructions.md',
    line: () => null,
  },

  // ============================================================
  // === PYTHON STACK CHECKS (category: 'python') ===============
  // ============================================================

  copilotPythonProjectExists: {
    id: 'CP-PY01',
    name: 'Python project detected (pyproject.toml / setup.py / requirements.txt)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return true; },
    impact: 'high',
    category: 'python',
    fix: 'Ensure pyproject.toml, setup.py, or requirements.txt exists for Python projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonVersionSpecified: {
    id: 'CP-PY02',
    name: 'Python version specified (.python-version or requires-python)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /\.python-version$/.test(f)) || /requires-python/i.test(ctx.fileContent('pyproject.toml') || ''); },
    impact: 'medium',
    category: 'python',
    fix: 'Create .python-version or add requires-python to pyproject.toml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonVenvMentioned: {
    id: 'CP-PY03',
    name: 'Virtual environment mentioned in instructions',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const docs = stackDocsBundle(ctx); return /venv|virtualenv|conda|poetry shell|uv venv/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document virtual environment setup in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonLockfileExists: {
    id: 'CP-PY04',
    name: 'Python lockfile exists (poetry.lock / uv.lock / Pipfile.lock / pinned requirements)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /poetry\.lock$|uv\.lock$|Pipfile\.lock$/.test(f)) || /==/m.test(ctx.fileContent('requirements.txt') || ''); },
    impact: 'high',
    category: 'python',
    fix: 'Add a lockfile (poetry.lock, uv.lock, Pipfile.lock) or pin versions with == in requirements.txt.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonPytestConfigured: {
    id: 'CP-PY05',
    name: 'pytest configured (pyproject.toml [tool.pytest] / pytest.ini / conftest.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return /\[tool\.pytest/i.test(ctx.fileContent('pyproject.toml') || '') || ctx.files.some(f => /pytest\.ini$|conftest\.py$/.test(f)); },
    impact: 'high',
    category: 'python',
    fix: 'Configure pytest in pyproject.toml [tool.pytest.ini_options] or create pytest.ini.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonLinterConfigured: {
    id: 'CP-PY06',
    name: 'Python linter configured (ruff / flake8 / pylint)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.ruff|\[tool\.flake8|\[tool\.pylint/i.test(pp) || ctx.files.some(f => /\.flake8$|pylintrc$|\.pylintrc$|ruff\.toml$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure ruff, flake8, or pylint in pyproject.toml or dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonTypeCheckerConfigured: {
    id: 'CP-PY07',
    name: 'Type checker configured (mypy / pyright)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.mypy|\[tool\.pyright/i.test(pp) || ctx.files.some(f => /mypy\.ini$|pyrightconfig\.json$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure mypy or pyright in pyproject.toml or dedicated config file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonFormatterConfigured: {
    id: 'CP-PY08',
    name: 'Formatter configured (black / isort / ruff format)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.black|\[tool\.isort|\[tool\.ruff\.format/i.test(pp); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure black, isort, or ruff format in pyproject.toml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonDjangoSettingsDocumented: {
    id: 'CP-PY09',
    name: 'Django settings documented if Django project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; if (!ctx.files.some(f => /manage\.py$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /django|settings\.py|DJANGO_SETTINGS_MODULE/i.test(docs); },
    impact: 'high',
    category: 'python',
    fix: 'Document Django settings module and configuration in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonFastapiEntryDocumented: {
    id: 'CP-PY10',
    name: 'FastAPI entry point documented if FastAPI project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/fastapi/i.test(deps)) return null; const docs = stackDocsBundle(ctx); return /fastapi|uvicorn|app\.py|main\.py/i.test(docs); },
    impact: 'high',
    category: 'python',
    fix: 'Document FastAPI entry point and how to run the development server.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonMigrationsDocumented: {
    id: 'CP-PY11',
    name: 'Database migrations mentioned (alembic / Django migrations)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const docs = stackDocsBundle(ctx); return /alembic|migrate|makemigrations|django.{0,10}migration/i.test(docs) || ctx.files.some(f => /alembic[.]ini$|alembic[/]/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Document database migration workflow (alembic or Django migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonEnvHandlingDocumented: {
    id: 'CP-PY12',
    name: '.env handling documented (python-dotenv)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/dotenv|python-dotenv|environs/i.test(deps)) return null; const docs = stackDocsBundle(ctx); return /\.env|dotenv|environment.{0,10}variable/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document .env file usage and python-dotenv configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonPreCommitConfigured: {
    id: 'CP-PY13',
    name: 'pre-commit hooks configured (.pre-commit-config.yaml)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /\.pre-commit-config\.yaml$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Add .pre-commit-config.yaml with Python-specific hooks (ruff, mypy, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonDockerBaseImage: {
    id: 'CP-PY14',
    name: 'Docker uses Python base image correctly',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const df = ctx.fileContent('Dockerfile') || ''; if (!df) return null; return /FROM.*python:/i.test(df); },
    impact: 'medium',
    category: 'python',
    fix: 'Use official Python base image in Dockerfile (e.g., FROM python:3.12-slim).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonTestMatrixConfigured: {
    id: 'CP-PY15',
    name: 'Test matrix configured (tox.ini / noxfile.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /tox\.ini$|noxfile\.py$/.test(f)); },
    impact: 'low',
    category: 'python',
    fix: 'Configure tox or nox for multi-environment testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonValidationUsed: {
    id: 'CP-PY16',
    name: 'Pydantic or dataclass validation used',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); return /pydantic|dataclass/i.test(deps); },
    impact: 'medium',
    category: 'python',
    fix: 'Use pydantic or dataclasses for data validation and type safety.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonAsyncDocumented: {
    id: 'CP-PY17',
    name: 'Async patterns documented if async project',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/asyncio|aiohttp|fastapi|starlette|httpx/i.test(deps)) return null; const docs = stackDocsBundle(ctx); return /async|await|asyncio|event.{0,5}loop/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document async patterns and conventions used in the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonPinnedVersions: {
    id: 'CP-PY18',
    name: 'Requirements have pinned versions (== in requirements.txt)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const req = ctx.fileContent('requirements.txt') || ''; if (!req.trim()) return null; const lines = req.split('\n').filter(l => l.trim() && !l.startsWith('#')); return lines.length > 0 && lines.every(l => /==/.test(l) || /^-/.test(l.trim())); },
    impact: 'high',
    category: 'python',
    fix: 'Pin all dependency versions with == in requirements.txt for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonPackageStructure: {
    id: 'CP-PY19',
    name: 'Python package has proper structure (src/ layout or __init__.py)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /src[/].*[/]__init__\.py$|^[^/]+[/]__init__\.py$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Use src/ layout or ensure packages have __init__.py files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonDocsToolConfigured: {
    id: 'CP-PY20',
    name: 'Documentation tool configured (sphinx / mkdocs)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; return ctx.files.some(f => /mkdocs\.yml$|conf\.py$|docs[/]/.test(f)) || /sphinx|mkdocs/i.test(ctx.fileContent('pyproject.toml') || ''); },
    impact: 'low',
    category: 'python',
    fix: 'Configure sphinx or mkdocs for project documentation.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonCoverageConfigured: {
    id: 'CP-PY21',
    name: 'Coverage configured (coverage / pytest-cov)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const pp = ctx.fileContent('pyproject.toml') || ''; return /\[tool\.coverage|pytest-cov|coverage/i.test(pp) || ctx.files.some(f => /\.coveragerc$/.test(f)); },
    impact: 'medium',
    category: 'python',
    fix: 'Configure coverage reporting with pytest-cov or coverage.py.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonNoSecretsInSettings: {
    id: 'CP-PY22',
    name: 'No secrets in Django settings.py',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const settings = ctx.fileContent('settings.py') || ctx.files.filter(f => /settings\.py$/.test(f)).map(f => ctx.fileContent(f) || '').join(''); if (!settings) return null; return !/SECRET_KEY\s*=\s*['"][^'"]{10,}/i.test(settings); },
    impact: 'critical',
    category: 'python',
    fix: 'Move SECRET_KEY and other secrets to environment variables, not hardcoded in settings.py.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonWsgiAsgiDocumented: {
    id: 'CP-PY23',
    name: 'WSGI/ASGI server documented (gunicorn / uvicorn)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/gunicorn|uvicorn|daphne|hypercorn/i.test(deps)) return null; const docs = stackDocsBundle(ctx); return /gunicorn|uvicorn|daphne|hypercorn|wsgi|asgi/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document WSGI/ASGI server configuration (gunicorn, uvicorn).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonTaskQueueDocumented: {
    id: 'CP-PY24',
    name: 'Task queue documented if used (celery / rq)',
    check: (ctx) => { const hasPy = ctx.files.some(f => /pyproject\.toml$|requirements\.txt$|setup\.py$|manage\.py$/.test(f)); if (!hasPy) return null; const deps = (ctx.fileContent('pyproject.toml') || '') + (ctx.fileContent('requirements.txt') || ''); if (!/celery|rq|dramatiq|huey/i.test(deps)) return null; const docs = stackDocsBundle(ctx); return /celery|rq|dramatiq|huey|task.{0,10}queue|worker/i.test(docs); },
    impact: 'medium',
    category: 'python',
    fix: 'Document task queue configuration and worker setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotPythonGitignore: {
    id: 'CP-PY25',
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

  copilotGoModExists: {
    id: 'CP-GO01',
    name: 'go.mod exists',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'go',
    fix: 'Initialize Go module with go mod init.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoSumCommitted: {
    id: 'CP-GO02',
    name: 'go.sum committed',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /go\.sum$/.test(f)); },
    impact: 'high',
    category: 'go',
    fix: 'Commit go.sum to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGolangciLintConfigured: {
    id: 'CP-GO03',
    name: 'golangci-lint configured (.golangci.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /\.golangci\.ya?ml$|\.golangci\.toml$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Add .golangci.yml to configure linting rules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoTestDocumented: {
    id: 'CP-GO04',
    name: 'go test documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /go test/i.test(docs); },
    impact: 'high',
    category: 'go',
    fix: 'Document go test command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoBuildDocumented: {
    id: 'CP-GO05',
    name: 'go build documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /go build|go install/i.test(docs); },
    impact: 'high',
    category: 'go',
    fix: 'Document go build command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoStandardLayout: {
    id: 'CP-GO06',
    name: 'Standard Go layout (cmd/ / internal/ / pkg/)',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /^cmd[/]|^internal[/]|^pkg[/]/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Use standard Go project layout with cmd/, internal/, and/or pkg/ directories.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoErrorHandlingDocumented: {
    id: 'CP-GO07',
    name: 'Error handling patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /error handling|errors?\.(?:New|Wrap|Is|As)|fmt\.Errorf/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document error handling conventions (error wrapping, sentinel errors, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoContextUsageDocumented: {
    id: 'CP-GO08',
    name: 'Context usage documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /context\.Context|ctx\.Done|context\.WithCancel|context\.WithTimeout/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document context.Context usage patterns for cancellation and timeouts.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoroutineSafetyDocumented: {
    id: 'CP-GO09',
    name: 'Goroutine safety documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /goroutine|sync\.Mutex|sync\.WaitGroup|channel|concurren/i.test(docs); },
    impact: 'medium',
    category: 'go',
    fix: 'Document goroutine safety patterns, mutex usage, and channel conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoModTidyMentioned: {
    id: 'CP-GO10',
    name: 'go mod tidy mentioned in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /go mod tidy/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document go mod tidy in project workflow instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoVetConfigured: {
    id: 'CP-GO11',
    name: 'go vet or staticcheck configured',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = stackDocsBundle(ctx); const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/go.yml') || ''; return /go vet|staticcheck/i.test(docs + ci); },
    impact: 'medium',
    category: 'go',
    fix: 'Configure go vet and/or staticcheck in CI or project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoMakefileExists: {
    id: 'CP-GO12',
    name: 'Makefile or Taskfile exists for Go project',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; return ctx.files.some(f => /^Makefile$|^Taskfile\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Add Makefile or Taskfile.yml with common Go targets (build, test, lint).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoDockerMultiStage: {
    id: 'CP-GO13',
    name: 'Docker multi-stage build for Go',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; if (!df) return null; return /FROM.*golang.*AS/i.test(df) && /FROM.*(?:alpine|scratch|distroless|gcr\.io)/i.test(df); },
    impact: 'medium',
    category: 'go',
    fix: 'Use multi-stage Docker build: build in golang image, run in minimal image (alpine/scratch/distroless).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoCgoDocumented: {
    id: 'CP-GO14',
    name: 'CGO documented if used',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const goMod = ctx.fileContent('go.mod') || ''; const docs = stackDocsBundle(ctx); if (!/CGO_ENABLED|import "C"/i.test(goMod + docs)) return null; return /CGO|cgo/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document CGO usage, dependencies, and build requirements.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoWorkForMonorepo: {
    id: 'CP-GO15',
    name: 'go.work for monorepo',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const multiMod = ctx.files.filter(f => /go\.mod$/.test(f)).length > 1; if (!multiMod) return null; return ctx.files.some(f => /go\.work$/.test(f)); },
    impact: 'medium',
    category: 'go',
    fix: 'Use go.work for Go workspace in monorepo with multiple modules.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoBenchmarkTests: {
    id: 'CP-GO16',
    name: 'Benchmark tests mentioned',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /go test.*-bench|Benchmark/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document benchmark testing with go test -bench.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoRaceDetector: {
    id: 'CP-GO17',
    name: 'Race detector (-race) documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = stackDocsBundle(ctx); const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/go.yml') || ''; return /-race/i.test(docs + ci); },
    impact: 'medium',
    category: 'go',
    fix: 'Document and enable race detector with go test -race.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoGenerateDocumented: {
    id: 'CP-GO18',
    name: 'go generate documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /go generate/i.test(docs) || ctx.files.some(f => /generate\.go$/.test(f)); },
    impact: 'low',
    category: 'go',
    fix: 'Document go generate usage and generated files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoInterfaceDesignDocumented: {
    id: 'CP-GO19',
    name: 'Interface-based design documented',
    check: (ctx) => { if (!ctx.files.some(f => /go\.mod$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /interface|mock|stub|dependency injection/i.test(docs); },
    impact: 'low',
    category: 'go',
    fix: 'Document interface-based design patterns for testability and dependency injection.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotGoGitignore: {
    id: 'CP-GO20',
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

  copilotRustCargoTomlExists: {
    id: 'CP-RS01',
    name: 'Cargo.toml exists with edition field',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /edition\s*=/.test(cargo); },
    impact: 'high',
    category: 'rust',
    fix: 'Ensure Cargo.toml exists and specifies the edition field (e.g., edition = "2021").',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustCargoLockCommitted: {
    id: 'CP-RS02',
    name: 'Cargo.lock committed (for binary crates)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /Cargo\.lock$/.test(f)); },
    impact: 'high',
    category: 'rust',
    fix: 'Commit Cargo.lock for binary crates to ensure reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustClippyConfigured: {
    id: 'CP-RS03',
    name: 'Clippy configured (CI or .cargo/config.toml)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/rust.yml') || ''; const cargoConfig = ctx.fileContent('.cargo/config.toml') || ''; return /clippy/i.test(ci + cargoConfig); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure clippy in CI or .cargo/config.toml for lint enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustFmtConfigured: {
    id: 'CP-RS04',
    name: 'rustfmt configured (rustfmt.toml or .rustfmt.toml)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /rustfmt\.toml$|\.rustfmt\.toml$/.test(f)); },
    impact: 'medium',
    category: 'rust',
    fix: 'Create rustfmt.toml or .rustfmt.toml to configure code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustCargoTestDocumented: {
    id: 'CP-RS05',
    name: 'cargo test documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /cargo test/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document cargo test command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustCargoBuildDocumented: {
    id: 'CP-RS06',
    name: 'cargo build/check documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /cargo (?:build|check)/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document cargo build or cargo check command in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustUnsafePolicyDocumented: {
    id: 'CP-RS07',
    name: 'Unsafe code policy documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /unsafe|#!?\[forbid\(unsafe|#!?\[deny\(unsafe/i.test(docs); },
    impact: 'high',
    category: 'rust',
    fix: 'Document unsafe code policy (forbidden, minimized, or where allowed).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustErrorHandlingStrategy: {
    id: 'CP-RS08',
    name: 'Error handling strategy (anyhow/thiserror in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /anyhow|thiserror|eyre|color-eyre/i.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Use anyhow (applications) or thiserror (libraries) for structured error handling.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustFeatureFlagsDocumented: {
    id: 'CP-RS09',
    name: 'Feature flags documented (Cargo.toml [features])',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/\[features\]/i.test(cargo)) return null; const docs = stackDocsBundle(ctx); return /feature|--features|--all-features/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document feature flags and their purpose in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustWorkspaceConfig: {
    id: 'CP-RS10',
    name: 'Workspace config if multi-crate (Cargo.toml [workspace])',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (ctx.files.filter(f => /Cargo\.toml$/.test(f)).length <= 1) return null; return /\[workspace\]/i.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure [workspace] in root Cargo.toml for multi-crate projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustMsrvSpecified: {
    id: 'CP-RS11',
    name: 'MSRV specified (rust-version field)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; return /rust-version\s*=/.test(cargo); },
    impact: 'medium',
    category: 'rust',
    fix: 'Specify rust-version (MSRV) in Cargo.toml for compatibility guarantees.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustDocCommentsEncouraged: {
    id: 'CP-RS12',
    name: 'Doc comments (///) encouraged in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /doc comment|\/{3}|rustdoc|cargo doc/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Encourage /// doc comments and cargo doc in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustBenchmarksConfigured: {
    id: 'CP-RS13',
    name: 'Criterion benchmarks mentioned (benches/ dir)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; return ctx.files.some(f => /benches[/]/.test(f)) || /criterion/i.test(ctx.fileContent('Cargo.toml') || ''); },
    impact: 'low',
    category: 'rust',
    fix: 'Set up criterion benchmarks in benches/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustCrossCompilationDocumented: {
    id: 'CP-RS14',
    name: 'Cross-compilation documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /cross.?compil|--target|rustup target|cargo build.*--target/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Document cross-compilation targets and setup instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustMemorySafetyDocumented: {
    id: 'CP-RS15',
    name: 'Memory safety patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /ownership|borrow|lifetime|memory.?safe|Arc|Rc|RefCell/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document memory safety patterns (ownership, borrowing, lifetime conventions).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustAsyncRuntimeDocumented: {
    id: 'CP-RS16',
    name: 'Async runtime documented (tokio/async-std in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/tokio|async-std|smol/i.test(cargo)) return null; const docs = stackDocsBundle(ctx); return /tokio|async-std|async|await|runtime/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document async runtime choice and patterns (tokio, async-std).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustSerdeDocumented: {
    id: 'CP-RS17',
    name: 'Serde patterns documented',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/serde/i.test(cargo)) return null; const docs = stackDocsBundle(ctx); return /serde|Serialize|Deserialize|serde_json|serde_yaml/i.test(docs); },
    impact: 'medium',
    category: 'rust',
    fix: 'Document serde serialization/deserialization patterns and conventions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustCargoAuditConfigured: {
    id: 'CP-RS18',
    name: 'cargo-audit configured in CI',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const ci = ctx.fileContent('.github/workflows/ci.yml') || ctx.fileContent('.github/workflows/rust.yml') || ctx.fileContent('.github/workflows/audit.yml') || ''; return /cargo.?audit|advisory/i.test(ci); },
    impact: 'medium',
    category: 'rust',
    fix: 'Configure cargo-audit in CI for vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustWasmTargetDocumented: {
    id: 'CP-RS19',
    name: 'WASM target documented if applicable',
    check: (ctx) => { if (!ctx.files.some(f => /Cargo\.toml$/.test(f))) return null; const cargo = ctx.fileContent('Cargo.toml') || ''; if (!/wasm|wasm-bindgen|wasm-pack/i.test(cargo)) return null; const docs = stackDocsBundle(ctx); return /wasm|WebAssembly|wasm-pack|wasm-bindgen/i.test(docs); },
    impact: 'low',
    category: 'rust',
    fix: 'Document WASM target configuration and build process.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotRustGitignore: {
    id: 'CP-RS20',
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

  copilotJavaBuildFileExists: {
    id: 'CP-JV01',
    name: 'pom.xml or build.gradle exists',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'java',
    fix: 'Ensure pom.xml or build.gradle exists for Java projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaVersionSpecified: {
    id: 'CP-JV02',
    name: 'Java version specified',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; return /java\.version|maven\.compiler\.source|sourceCompatibility|JavaVersion/i.test(pom + gradle) || ctx.files.some(f => /\.java-version$/.test(f)); },
    impact: 'high',
    category: 'java',
    fix: 'Specify Java version in pom.xml properties, build.gradle, or .java-version file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaWrapperCommitted: {
    id: 'CP-JV03',
    name: 'Maven/Gradle wrapper committed (mvnw or gradlew)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /mvnw$|gradlew$/.test(f)); },
    impact: 'high',
    category: 'java',
    fix: 'Commit mvnw (Maven) or gradlew (Gradle) wrapper for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaSpringBootVersion: {
    id: 'CP-JV04',
    name: 'Spring Boot version documented if Spring project',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; if (!/spring-boot/i.test(pom + gradle)) return null; return /spring-boot.*\d+\.\d+/i.test(pom + gradle); },
    impact: 'high',
    category: 'java',
    fix: 'Document Spring Boot version in build configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaApplicationConfig: {
    id: 'CP-JV05',
    name: 'application.yml or application.properties exists',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /application\.ya?ml$|application\.properties$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Create application.yml or application.properties for Spring configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaTestFramework: {
    id: 'CP-JV06',
    name: 'Test framework configured (JUnit/TestNG in deps)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const pom = ctx.fileContent('pom.xml') || ''; const gradle = ctx.fileContent('build.gradle') || ctx.fileContent('build.gradle.kts') || ''; return /junit|testng|spring-boot-starter-test/i.test(pom + gradle); },
    impact: 'high',
    category: 'java',
    fix: 'Configure JUnit or TestNG test framework in project dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaCodeStyleConfigured: {
    id: 'CP-JV07',
    name: 'Code style configured (checkstyle.xml, spotbugs)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /checkstyle\.xml$|spotbugs.*\.xml$/.test(f)) || /checkstyle|spotbugs|google-java-format/i.test((ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || '')); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure checkstyle or spotbugs for code quality enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaSpringProfilesDocumented: {
    id: 'CP-JV08',
    name: 'Spring profiles documented',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/spring/i.test(deps)) return null; const docs = stackDocsBundle(ctx); return /spring[.]profiles|@Profile|SPRING_PROFILES_ACTIVE/i.test(docs); },
    impact: 'medium',
    category: 'java',
    fix: 'Document Spring profiles and their configuration in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaDatabaseMigration: {
    id: 'CP-JV09',
    name: 'Database migration configured (flyway/liquibase)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /flyway|liquibase/i.test(deps) || ctx.files.some(f => /db[/]migration|flyway|liquibase/i.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure database migration tool (Flyway or Liquibase) for schema management.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaLombokDocumented: {
    id: 'CP-JV10',
    name: 'Lombok/MapStruct documented if used',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/lombok|mapstruct/i.test(deps)) return null; const docs = stackDocsBundle(ctx); return /lombok|mapstruct/i.test(docs); },
    impact: 'low',
    category: 'java',
    fix: 'Document Lombok/MapStruct usage and IDE setup requirements.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaApiDocsConfigured: {
    id: 'CP-JV11',
    name: 'API docs configured (springdoc/swagger deps)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /springdoc|swagger|openapi/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure API documentation with springdoc-openapi or Swagger.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaSecurityConfigured: {
    id: 'CP-JV12',
    name: 'Security configuration documented',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); if (!/spring-security|spring-boot-starter-security/i.test(deps)) return null; const docs = stackDocsBundle(ctx); return /security|authentication|authorization|SecurityConfig|@EnableWebSecurity/i.test(docs); },
    impact: 'high',
    category: 'java',
    fix: 'Document Spring Security configuration and authentication setup.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaActuatorConfigured: {
    id: 'CP-JV13',
    name: 'Actuator/health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /actuator|spring-boot-starter-actuator/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Spring Boot Actuator for health checks and monitoring.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaLoggingConfigured: {
    id: 'CP-JV14',
    name: 'Logging configured (logback.xml or log4j2.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /logback.*\.xml$|log4j2?.*\.xml$|logging\.properties$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure logging with logback.xml or log4j2.xml.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaMultiModuleProject: {
    id: 'CP-JV15',
    name: 'Multi-module project configured if applicable',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const buildFiles = ctx.files.filter(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f)); if (buildFiles.length <= 1) return null; const rootPom = ctx.fileContent('pom.xml') || ''; const rootGradle = ctx.fileContent('settings.gradle') || ctx.fileContent('settings.gradle.kts') || ''; return /<modules>|include\s/i.test(rootPom + rootGradle); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure multi-module project structure in root build file.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaDockerConfigured: {
    id: 'CP-JV16',
    name: 'Docker build configured (Dockerfile or Jib plugin)',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; const deps = (ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || ''); return /FROM.*(?:openjdk|eclipse-temurin|amazoncorretto)/i.test(df) || /jib/i.test(deps); },
    impact: 'medium',
    category: 'java',
    fix: 'Configure Docker build with Dockerfile or Jib plugin.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaEnvConfigsSeparated: {
    id: 'CP-JV17',
    name: 'Environment-specific configs separated',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /application-(?:dev|prod|staging|test|local)\.(?:ya?ml|properties)$/.test(f)); },
    impact: 'medium',
    category: 'java',
    fix: 'Separate environment configs (application-dev.yml, application-prod.yml, etc.).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaNoSecretsInConfig: {
    id: 'CP-JV18',
    name: 'No secrets in application.yml/properties',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const appYml = ctx.files.filter(f => /application.*\.ya?ml$|application.*\.properties$/.test(f)).map(f => ctx.fileContent(f) || '').join(''); if (!appYml) return null; return !/password\s*[:=]\s*[^$\{\s][^\s]{8,}|secret\s*[:=]\s*[^$\{\s][^\s]{8,}/i.test(appYml); },
    impact: 'critical',
    category: 'java',
    fix: 'Move secrets to environment variables or external secret management, not application config files.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaIntegrationTestsSeparate: {
    id: 'CP-JV19',
    name: 'Integration tests separate from unit tests',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; return ctx.files.some(f => /src[/](?:integration-?test|it)[/]|IT\.java$|Integration(?:Test)?\.java$/.test(f)) || /failsafe|integration-test/i.test((ctx.fileContent('pom.xml') || '') + (ctx.fileContent('build.gradle') || '') + (ctx.fileContent('build.gradle.kts') || '')); },
    impact: 'medium',
    category: 'java',
    fix: 'Separate integration tests from unit tests using Maven Failsafe or dedicated source set.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotJavaBuildCommandDocumented: {
    id: 'CP-JV20',
    name: 'Build command documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /pom\.xml$|build\.gradle$|build\.gradle\.kts$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /mvn|gradle|mvnw|gradlew|maven|./i.test(docs) && /build|compile|package|install/i.test(docs); },
    impact: 'high',
    category: 'java',
    fix: 'Document build command (mvnw package, gradlew build) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  // ============================================================
  // === RUBY/RAILS STACK CHECKS (category: 'ruby') =============
  // ============================================================

  copilotrubyGemfileExists: {
    id: 'CP-RB01',
    name: 'Gemfile exists',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'ruby',
    fix: 'Create a Gemfile to manage Ruby dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotrubyGemfileLockCommitted: {
    id: 'CP-RB02',
    name: 'Gemfile.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /Gemfile\.lock$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Commit Gemfile.lock to version control for reproducible builds.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotrubyVersionSpecified: {
    id: 'CP-RB03',
    name: 'Ruby version specified (.ruby-version)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.ruby-version$/.test(f)) || /ruby ['"]~?\d/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Create .ruby-version or specify ruby version in Gemfile.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotrubyRubocopConfigured: {
    id: 'CP-RB04',
    name: 'RuboCop configured (.rubocop.yml)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /\.rubocop\.ya?ml$/.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add .rubocop.yml to configure Ruby style checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotrubyTestFrameworkConfigured: {
    id: 'CP-RB05',
    name: 'RSpec or Minitest configured (spec/ or test/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /^spec\/|^test\/|spec_helper\.rb$|test_helper\.rb$/.test(f)); },
    impact: 'high',
    category: 'ruby',
    fix: 'Configure RSpec (spec/) or Minitest (test/) for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotrubyRailsCredentialsDocumented: {
    id: 'CP-RB06',
    name: 'Rails credentials documented in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const docs = stackDocsBundle(ctx); return /credentials|encrypted|master\.key|secret_key_base/i.test(docs); },
    impact: 'high',
    category: 'ruby',
    fix: 'Document Rails credentials management (rails credentials:edit) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotrubyMigrationsDocumented: {
    id: 'CP-RB07',
    name: 'Database migrations documented (db/migrate/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /db\/migrate\//.test(f))) return null; const docs = stackDocsBundle(ctx); return /migration|migrate|db:migrate|rails db/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document database migration workflow (rails db:migrate) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotrubyBundlerAuditConfigured: {
    id: 'CP-RB08',
    name: 'Bundler audit configured',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; return /bundler-audit|bundle.audit/i.test(gf) || ctx.files.some(f => /\.bundler-audit/i.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Add bundler-audit gem for dependency vulnerability scanning.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotrubyTypeCheckingConfigured: {
    id: 'CP-RB09',
    name: 'Sorbet/RBS type checking configured (sorbet/ or sig/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /sorbet\/|sig\/|\.rbs$/.test(f)) || /sorbet|tapioca/i.test(ctx.fileContent('Gemfile') || ''); },
    impact: 'low',
    category: 'ruby',
    fix: 'Configure Sorbet or RBS for type checking.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotrubyRailsRoutesDocumented: {
    id: 'CP-RB10',
    name: 'Rails routes documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/routes\.rb$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /routes|endpoints|api.*path|REST/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document key routes and API endpoints in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotrubyBackgroundJobsDocumented: {
    id: 'CP-RB11',
    name: 'Background jobs documented (Sidekiq/GoodJob)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sidekiq|good_job|delayed_job|resque/i.test(gf)) return null; const docs = stackDocsBundle(ctx); return /sidekiq|good_job|delayed_job|resque|background.*job|worker|queue/i.test(docs); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Document background job framework and worker configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotrubyRailsEnvConfigsSeparated: {
    id: 'CP-RB12',
    name: 'Rails environment configs separated (config/environments/)',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; return ctx.files.some(f => /config\/environments\//.test(f)); },
    impact: 'medium',
    category: 'ruby',
    fix: 'Ensure config/environments/ has separate files for development, test, and production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotrubyAssetPipelineDocumented: {
    id: 'CP-RB13',
    name: 'Asset pipeline documented',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; const gf = ctx.fileContent('Gemfile') || ''; if (!/sprockets|propshaft|webpacker|jsbundling|cssbundling/i.test(gf)) return null; const docs = stackDocsBundle(ctx); return /asset|sprockets|propshaft|webpacker|jsbundling|cssbundling|esbuild|vite/i.test(docs); },
    impact: 'low',
    category: 'ruby',
    fix: 'Document asset pipeline configuration (Sprockets, Propshaft, or JS/CSS bundling).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotrubyMasterKeyInGitignore: {
    id: 'CP-RB14',
    name: 'Rails master.key in .gitignore',
    check: (ctx) => { if (!ctx.files.some(f => /Gemfile$/.test(f))) return null; if (!ctx.files.some(f => /config\/credentials/.test(f))) return null; const gi = ctx.fileContent('.gitignore') || ''; return /master\.key/i.test(gi); },
    impact: 'critical',
    category: 'ruby',
    fix: 'Add config/master.key to .gitignore to prevent secret leakage.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotrubyTestDataFactories: {
    id: 'CP-RB15',
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

  copilotdotnetProjectExists: {
    id: 'CP-DN01',
    name: '.csproj or .sln exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'dotnet',
    fix: 'Ensure .csproj or .sln file exists for .NET projects.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotdotnetVersionSpecified: {
    id: 'CP-DN02',
    name: '.NET version specified (global.json or TargetFramework)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /global\.json$/.test(f)) || ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /TargetFramework/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create global.json or ensure TargetFramework is set in .csproj.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotdotnetPackagesLock: {
    id: 'CP-DN03',
    name: 'NuGet packages lock (packages.lock.json)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /packages\.lock\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Enable NuGet lock file (packages.lock.json) for reproducible restores.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotdotnetTestDocumented: {
    id: 'CP-DN04',
    name: 'dotnet test documented',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /dotnet test|xunit|nunit|mstest/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document how to run tests with dotnet test in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotdotnetEditorConfigExists: {
    id: 'CP-DN05',
    name: 'EditorConfig configured (.editorconfig)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.editorconfig$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add .editorconfig for consistent code style across the team.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotdotnetRoslynAnalyzers: {
    id: 'CP-DN06',
    name: 'Roslyn analyzers configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Analyzer|StyleCop|SonarAnalyzer|Microsoft\.CodeAnalysis/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Roslyn analyzers (StyleCop.Analyzers, Microsoft.CodeAnalysis) to the project.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotdotnetAppsettingsExists: {
    id: 'CP-DN07',
    name: 'appsettings.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /appsettings\.json$/.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Create appsettings.json for application configuration.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotdotnetUserSecretsDocumented: {
    id: 'CP-DN08',
    name: 'User secrets configured in instructions',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /user.?secrets|dotnet secrets|Secret Manager/i.test(docs); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Document user secrets management (dotnet user-secrets) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotdotnetEfMigrations: {
    id: 'CP-DN09',
    name: 'Entity Framework migrations (Migrations/ directory)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /Migrations\//.test(f)); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Document Entity Framework migration workflow (dotnet ef migrations).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotdotnetHealthChecks: {
    id: 'CP-DN10',
    name: 'Health checks configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /AddHealthChecks|MapHealthChecks|IHealthCheck/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure health checks with AddHealthChecks() and MapHealthChecks().',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotdotnetSwaggerConfigured: {
    id: 'CP-DN11',
    name: 'Swagger/OpenAPI configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => { if (!/\.cs$|.csproj$/.test(f)) return false; const c = ctx.fileContent(f) || ''; return /Swashbuckle|AddSwaggerGen|UseSwagger|NSwag|AddOpenApi/i.test(c); }); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Configure Swagger/OpenAPI with Swashbuckle or NSwag.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotdotnetNoConnectionStringsInConfig: {
    id: 'CP-DN12',
    name: 'No connection strings in appsettings.json',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const settings = ctx.fileContent('appsettings.json') || ''; if (!settings) return null; return !/Server=.*Password=|Data Source=.*Password=/i.test(settings); },
    impact: 'critical',
    category: 'dotnet',
    fix: 'Move connection strings with passwords to user secrets or environment variables.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotdotnetDockerSupport: {
    id: 'CP-DN13',
    name: 'Docker support configured',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; const df = ctx.fileContent('Dockerfile') || ''; return /dotnet|aspnet|sdk/i.test(df); },
    impact: 'medium',
    category: 'dotnet',
    fix: 'Add Dockerfile with official .NET SDK/ASP.NET base images.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotdotnetTestProjectSeparate: {
    id: 'CP-DN14',
    name: 'Unit test project separate (.Tests.csproj)',
    check: (ctx) => { if (!ctx.files.some(f => /\.csproj$|\.sln$/.test(f))) return null; return ctx.files.some(f => /\.Tests?\.csproj$|Tests?\/.*\.csproj$/.test(f)); },
    impact: 'high',
    category: 'dotnet',
    fix: 'Create separate test project (e.g., MyApp.Tests.csproj) for unit tests.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotdotnetGlobalUsingsDocumented: {
    id: 'CP-DN15',
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

  copilotphpComposerJsonExists: {
    id: 'CP-PHP01',
    name: 'composer.json exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return true; },
    impact: 'high',
    category: 'php',
    fix: 'Create composer.json to manage PHP dependencies.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotphpComposerLockCommitted: {
    id: 'CP-PHP02',
    name: 'composer.lock committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /composer\.lock$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Commit composer.lock to version control for reproducible installs.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotphpVersionSpecified: {
    id: 'CP-PHP03',
    name: 'PHP version specified (composer.json require.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"php"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Specify PHP version requirement in composer.json require section.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotphpStaticAnalysisConfigured: {
    id: 'CP-PHP04',
    name: 'PHPStan/Psalm configured (phpstan.neon)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpstan\.neon$|phpstan\.neon\.dist$|psalm\.xml$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Configure PHPStan (phpstan.neon) or Psalm (psalm.xml) for static analysis.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotphpCsFixerConfigured: {
    id: 'CP-PHP05',
    name: 'PHP CS Fixer configured (.php-cs-fixer.php)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /\.php-cs-fixer\.php$|\.php-cs-fixer\.dist\.php$/.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Add .php-cs-fixer.php for consistent code formatting.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotphpUnitConfigured: {
    id: 'CP-PHP06',
    name: 'PHPUnit configured (phpunit.xml)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /phpunit\.xml$|phpunit\.xml\.dist$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Configure PHPUnit with phpunit.xml for testing.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotphpLaravelEnvExample: {
    id: 'CP-PHP07',
    name: 'Laravel .env.example exists',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /\.env\.example$/.test(f)); },
    impact: 'high',
    category: 'php',
    fix: 'Create .env.example with all required environment variables documented.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotphpLaravelAppKeyNotCommitted: {
    id: 'CP-PHP08',
    name: 'Laravel APP_KEY not committed',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const env = ctx.fileContent('.env') || ''; if (!env) return null; return !/APP_KEY=base64:[A-Za-z0-9+/=]{30,}/i.test(env); },
    impact: 'critical',
    category: 'php',
    fix: 'Ensure .env with APP_KEY is in .gitignore — never commit application keys.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotphpLaravelMigrationsExist: {
    id: 'CP-PHP09',
    name: 'Laravel migrations exist (database/migrations/)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; return ctx.files.some(f => /database\/migrations\//.test(f)); },
    impact: 'medium',
    category: 'php',
    fix: 'Create database migrations in database/migrations/ directory.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotphpArtisanCommandsDocumented: {
    id: 'CP-PHP10',
    name: 'Artisan commands documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /artisan|php artisan|make:model|make:controller|migrate/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document key Artisan commands (migrate, seed, make:*) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotphpQueueWorkerDocumented: {
    id: 'CP-PHP11',
    name: 'Queue worker documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; if (!/horizon|queue/i.test(cj) && !ctx.files.some(f => /artisan$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /queue|horizon|worker|job|dispatch/i.test(docs); },
    impact: 'medium',
    category: 'php',
    fix: 'Document queue worker setup (php artisan queue:work, Horizon).',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotphpLaravelPintConfigured: {
    id: 'CP-PHP12',
    name: 'Laravel Pint configured (pint.json)',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; return ctx.files.some(f => /pint\.json$/.test(f)) || /laravel\/pint/i.test(ctx.fileContent('composer.json') || ''); },
    impact: 'low',
    category: 'php',
    fix: 'Configure Laravel Pint (pint.json) for code style enforcement.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotphpAssetBundlingDocumented: {
    id: 'CP-PHP13',
    name: 'Vite/Mix asset bundling documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /vite\.config\.|webpack\.mix\.js$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /vite|mix|asset|npm run dev|npm run build/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document asset bundling setup (Vite or Mix) in project instructions.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotphpConfigCachingDocumented: {
    id: 'CP-PHP14',
    name: 'Laravel config caching documented',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; if (!ctx.files.some(f => /artisan$/.test(f))) return null; const docs = stackDocsBundle(ctx); return /config:cache|config:clear|route:cache|optimize/i.test(docs); },
    impact: 'low',
    category: 'php',
    fix: 'Document config/route caching strategy (php artisan config:cache) for production.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },

  copilotphpComposerScriptsDefined: {
    id: 'CP-PHP15',
    name: 'Composer scripts defined',
    check: (ctx) => { if (!ctx.files.some(f => /composer\.json$/.test(f))) return null; const cj = ctx.fileContent('composer.json') || ''; return /"scripts"s*:/i.test(cj); },
    impact: 'medium',
    category: 'php',
    fix: 'Define composer scripts for common tasks (test, lint, analyze) in composer.json.',
    // sourceUrl assigned by attachSourceUrls via category mapping
    confidence: 0.7,
  },


};

Object.assign(COPILOT_TECHNIQUES, buildSupplementalChecks({
  idPrefix: 'CP-T',
  urlMap: COPILOT_SUPPLEMENTAL_SOURCE_URLS,
  docs: (ctx) => [
    copilotInstructions(ctx),
    ctx.fileContent('AGENTS.md') || '',
    ctx.fileContent('CLAUDE.md') || '',
    ctx.fileContent('README.md') || '',
  ].filter(Boolean).join('\n'),
}));

Object.assign(COPILOT_TECHNIQUES, buildStackChecks({
  platform: 'copilot',
  objectPrefix: 'copilot',
  idPrefix: 'CP',
  docs: (ctx) => [
    copilotInstructions(ctx),
    ctx.fileContent('AGENTS.md') || '',
    ctx.fileContent('CLAUDE.md') || '',
    ctx.fileContent('README.md') || '',
    ctx.fileContent('CONTRIBUTING.md') || '',
  ].filter(Boolean).join('\n'),
}));

attachSourceUrls('copilot', COPILOT_TECHNIQUES);

// CTO-08 — tag every check with a scope layer.
const { LAYERS: COPILOT_LAYERS, assignLayers: copilotAssignLayers } = require('../audit/layers');
copilotAssignLayers(COPILOT_TECHNIQUES, COPILOT_LAYERS.GOVERNANCE);

module.exports = {
  COPILOT_TECHNIQUES,
};
