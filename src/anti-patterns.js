/**
 * Anti-Pattern Catalog — things NOT to do when configuring AI coding agents.
 * Provides a static catalog and a runtime detector that checks a project context.
 */

const {
  getRepoInstructionBundle,
  hasDocumentedVerificationGuidance,
  hasDocumentedTestCommand,
} = require('./instruction-surfaces');
const { collectClaudeDenyRules } = require('./permission-rules');
const { containsEmbeddedSecret } = require('./secret-patterns');

const ANTI_PATTERNS = [
  {
    id: 'AP001',
    name: 'bypassPermissions as default',
    severity: 'critical',
    description: 'Setting defaultMode to bypassPermissions removes all safety guardrails.',
    platforms: ['claude'],
    fix: 'Use "default" or "safe-write" mode. Add specific allow rules for trusted operations.',
    detect: (ctx) => {
      const settings = ctx.jsonFile('.claude/settings.json') || ctx.jsonFile('.claude/settings.local.json');
      return settings && settings.permissions && settings.permissions.defaultMode === 'bypassPermissions';
    },
  },
  {
    id: 'AP002',
    name: 'No deny rules configured',
    severity: 'high',
    description: 'Without deny rules, the agent can execute any operation it decides to, including destructive ones.',
    platforms: ['claude'],
    fix: 'Add deny rules in settings.json for dangerous operations like rm -rf, git reset --hard, and reading .env files.',
    detect: (ctx) => {
      const settings = ctx.jsonFile('.claude/settings.json') || ctx.jsonFile('.claude/settings.local.json');
      if (!settings || !settings.permissions) return true;
      return collectClaudeDenyRules(ctx).length === 0;
    },
  },
  {
    id: 'AP003',
    name: 'Secrets in CLAUDE.md',
    severity: 'critical',
    description: 'API keys, tokens, or passwords hardcoded in CLAUDE.md are visible to every session and may leak in outputs.',
    platforms: ['claude', 'codex', 'cursor', 'windsurf', 'copilot', 'gemini', 'aider', 'opencode'],
    fix: 'Move secrets to .env files and reference them via environment variables. Add .env to .gitignore.',
    detect: (ctx) => {
      const content = ctx.fileContent('CLAUDE.md') || ctx.fileContent('.claude/CLAUDE.md') || '';
      const patterns = [
        /(?:api[_-]?key|api[_-]?secret|token|password|secret[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}/i,
        /sk-[A-Za-z0-9]{20,}/,
        /ghp_[A-Za-z0-9]{36,}/,
        /AKIA[A-Z0-9]{16}/,
      ];
      return patterns.some(p => p.test(content));
    },
  },
  {
    id: 'AP004',
    name: 'Empty CLAUDE.md',
    severity: 'medium',
    description: 'An empty or near-empty instruction file provides no guidance, making the agent guess at project conventions.',
    platforms: ['claude'],
    fix: 'Add project description, architecture overview, verification commands, and coding conventions to CLAUDE.md.',
    detect: (ctx) => {
      const content = ctx.fileContent('CLAUDE.md') || ctx.fileContent('.claude/CLAUDE.md') || '';
      return content.trim().length > 0 && content.trim().length < 50;
    },
  },
  {
    id: 'AP005',
    name: 'Too many MCP servers (>10)',
    severity: 'medium',
    description: 'More than 10 MCP servers increases startup latency, context overhead, and potential for tool conflicts.',
    platforms: ['claude'],
    fix: 'Limit MCP servers to essential ones. Remove rarely-used servers and consolidate overlapping functionality.',
    detect: (ctx) => {
      const settings = ctx.jsonFile('.claude/settings.json') || ctx.jsonFile('.claude/settings.local.json');
      if (!settings || !settings.mcpServers) return false;
      return Object.keys(settings.mcpServers).length > 10;
    },
  },
  {
    id: 'AP006',
    name: 'Overly broad allow rules',
    severity: 'high',
    description: 'Allow rules like "Bash(*)" or "Write(**)" grant blanket permission, defeating the purpose of permission controls.',
    platforms: ['claude'],
    fix: 'Scope allow rules to specific commands and paths. Use "Bash(npm test)" instead of "Bash(*)".',
    detect: (ctx) => {
      const settings = ctx.jsonFile('.claude/settings.json') || ctx.jsonFile('.claude/settings.local.json');
      if (!settings || !settings.permissions) return false;
      const allow = settings.permissions.allow || [];
      const broadPatterns = ['Bash(*)', 'Write(**)', 'Edit(**)', 'Read(**)', 'Bash(**)', 'Write(*)', 'Edit(*)', 'Read(*)'];
      return allow.some(rule => broadPatterns.includes(rule));
    },
  },
  {
    id: 'AP007',
    name: 'No verification commands',
    severity: 'medium',
    description: 'Without test, lint, or build commands across the repo instruction surfaces, agents cannot self-verify changes consistently.',
    platforms: ['claude', 'codex', 'cursor', 'windsurf', 'copilot', 'gemini', 'aider', 'opencode'],
    fix: 'Add a canonical verification section or command doc in your repo instruction surfaces (for example CLAUDE.md, AGENTS.md, README, or platform rules).',
    detect: (ctx) => {
      const content = getRepoInstructionBundle(ctx);
      if (!content) return false;
      return !hasDocumentedVerificationGuidance(content);
    },
  },
  {
    id: 'AP008',
    name: 'Ignoring .gitignore for sensitive files',
    severity: 'high',
    description: 'Not gitignoring .env, credentials, and key files means they can be committed and pushed to remote repos.',
    platforms: ['claude', 'codex', 'cursor', 'windsurf', 'copilot', 'gemini', 'aider', 'opencode'],
    fix: 'Add .env, .env.*, credentials.json, *.pem, and *.key to .gitignore.',
    detect: (ctx) => {
      const gitignore = ctx.fileContent('.gitignore') || '';
      return !gitignore.includes('.env');
    },
  },
  {
    id: 'AP009',
    name: 'No hooks configured',
    severity: 'medium',
    description: 'Without hooks, there is no automated enforcement — all safety depends on instructions alone (80% compliance vs 100%).',
    platforms: ['claude'],
    fix: 'Add at least a protect-secrets PreToolUse hook and a post-edit lint hook in settings.json.',
    detect: (ctx) => {
      const settings = ctx.jsonFile('.claude/settings.json') || ctx.jsonFile('.claude/settings.local.json');
      if (!settings || !settings.hooks) return true;
      const hookEntries = Object.values(settings.hooks).flat();
      return hookEntries.length === 0;
    },
  },
  {
    id: 'AP010',
    name: 'Duplicated instructions across platforms',
    severity: 'medium',
    description: 'Copy-pasting the same instructions into CLAUDE.md, .cursorrules, and AGENTS.md creates drift when one is updated.',
    platforms: ['claude', 'codex', 'cursor', 'windsurf', 'copilot', 'gemini', 'aider', 'opencode'],
    fix: 'Create a shared source of truth (e.g., docs/ai-instructions.md) and reference it from each platform config.',
    detect: (ctx) => {
      const claudeMd = ctx.fileContent('CLAUDE.md') || '';
      const cursorrules = ctx.fileContent('.cursorrules') || '';
      const agentsMd = ctx.fileContent('AGENTS.md') || '';
      if (!claudeMd || claudeMd.length < 100) return false;
      const files = [cursorrules, agentsMd].filter(f => f.length > 100);
      if (files.length === 0) return false;
      // Simple heuristic: check if any significant chunk (100+ chars) appears in both
      const chunk = claudeMd.slice(0, 200).trim();
      return files.some(f => f.includes(chunk));
    },
  },
  {
    id: 'AP011',
    name: 'Conflicting trust postures across platforms',
    severity: 'high',
    description: 'One platform in bypassPermissions while another is read-only creates inconsistent security boundaries.',
    platforms: ['claude', 'codex'],
    fix: 'Align permission profiles across platforms. Use Harmony audit to detect and resolve trust drift.',
    detect: (ctx) => {
      const claudeSettings = ctx.jsonFile('.claude/settings.json') || ctx.jsonFile('.claude/settings.local.json');
      const codexConfig = ctx.fileContent('.codex/config.toml') || '';
      if (!claudeSettings || !codexConfig) return false;
      const claudeMode = claudeSettings.permissions && claudeSettings.permissions.defaultMode;
      const isBypass = claudeMode === 'bypassPermissions';
      const codexHasAutoApprove = /approval_policy\s*=\s*["']auto-edit["']/i.test(codexConfig);
      // Conflict: one is very permissive while the other is restrictive, or vice versa
      return (isBypass && !codexHasAutoApprove) || (!isBypass && codexHasAutoApprove);
    },
  },
  {
    id: 'AP012',
    name: 'No error handling in hooks',
    severity: 'medium',
    description: 'Hook scripts without error handling can silently fail, giving a false sense of security.',
    platforms: ['claude'],
    fix: 'Add "set -e" to shell hooks and wrap commands in try/catch for JS hooks. Log failures to a known location.',
    detect: (ctx) => {
      if (!ctx.hasDir('.claude/hooks')) return false;
      const hookFiles = ctx.dirFiles('.claude/hooks');
      for (const file of hookFiles) {
        const content = ctx.fileContent(`.claude/hooks/${file}`) || '';
        if (file.endsWith('.sh') && content.length > 0 && !content.includes('set -e')) {
          return true;
        }
      }
      return false;
    },
  },
  {
    id: 'AP013',
    name: 'Hardcoded paths in CLAUDE.md',
    severity: 'medium',
    description: 'Absolute paths like /Users/alice/project or C:\\Users break when other developers clone the repo.',
    platforms: ['claude', 'codex', 'cursor', 'windsurf', 'copilot', 'gemini', 'aider', 'opencode'],
    fix: 'Use relative paths or environment variables. Replace absolute paths with project-relative references.',
    detect: (ctx) => {
      const content = ctx.fileContent('CLAUDE.md') || ctx.fileContent('.claude/CLAUDE.md') || '';
      if (!content) return false;
      return /(?:\/Users\/[a-zA-Z]|\/home\/[a-zA-Z]|C:\\Users\\[a-zA-Z])/.test(content);
    },
  },
  {
    id: 'AP014',
    name: 'No test command defined',
    severity: 'medium',
    description: 'Without a canonical test command in repo instructions or scripts, agents cannot verify changes reliably before handoff.',
    platforms: ['claude', 'codex', 'cursor', 'windsurf', 'copilot', 'gemini', 'aider', 'opencode'],
    fix: 'Add a canonical test command in repo instructions or package scripts, e.g. "Test: npm test" or "Test: pytest".',
    detect: (ctx) => {
      const content = getRepoInstructionBundle(ctx);
      const pkg = ctx.jsonFile('package.json');
      const hasTestInMd = hasDocumentedTestCommand(content);
      const hasTestScript = pkg && pkg.scripts && pkg.scripts.test;
      return !hasTestInMd && !hasTestScript;
    },
  },
  {
    id: 'AP015',
    name: 'All permissions allowed',
    severity: 'high',
    description: 'Allowing all tool permissions without any deny rules gives the agent unrestricted system access.',
    platforms: ['claude'],
    fix: 'Define deny rules for destructive operations. At minimum deny rm -rf, git reset --hard, and .env reads.',
    detect: (ctx) => {
      const settings = ctx.jsonFile('.claude/settings.json') || ctx.jsonFile('.claude/settings.local.json');
      if (!settings || !settings.permissions) return false;
      const allow = settings.permissions.allow || [];
      const deny = settings.permissions.deny || [];
      return allow.length > 5 && deny.length === 0;
    },
  },
  {
    id: 'AP016',
    name: 'Missing architecture diagram',
    severity: 'low',
    description: 'Without an architecture diagram, the agent has to infer project structure from file exploration, wasting tokens.',
    platforms: ['claude', 'codex', 'cursor', 'windsurf', 'copilot', 'gemini', 'aider', 'opencode'],
    fix: 'Add a Mermaid diagram in CLAUDE.md showing the main components and data flow.',
    detect: (ctx) => {
      const content = ctx.fileContent('CLAUDE.md') || ctx.fileContent('.claude/CLAUDE.md') || '';
      if (!content) return false;
      return !content.includes('mermaid') && !content.includes('```') && content.length > 200;
    },
  },
  {
    id: 'AP017',
    name: 'Using deprecated features',
    severity: 'medium',
    description: 'Relying on deprecated features risks breakage when they are removed in future versions.',
    platforms: ['claude'],
    fix: 'Check the platform changelog for deprecated features and migrate to recommended alternatives.',
    detect: (ctx) => {
      const content = ctx.fileContent('CLAUDE.md') || ctx.fileContent('.claude/CLAUDE.md') || '';
      const settings = ctx.jsonFile('.claude/settings.json') || ctx.jsonFile('.claude/settings.local.json');
      // Check for known deprecated patterns
      const deprecatedPatterns = [
        /allowedTools/i,
        /blockedTools/i,
      ];
      const hasDeprecatedInMd = deprecatedPatterns.some(p => p.test(content));
      const hasDeprecatedInSettings = settings && deprecatedPatterns.some(p => p.test(JSON.stringify(settings)));
      return hasDeprecatedInMd || hasDeprecatedInSettings;
    },
  },
  {
    id: 'AP018',
    name: 'No rules files',
    severity: 'low',
    description: 'Without .claude/rules/ files, all instructions live in one place, making it harder to scope guidance by file type.',
    platforms: ['claude'],
    fix: 'Create .claude/rules/ with scoped rules for different areas (e.g., tests.md, api.md, frontend.md).',
    detect: (ctx) => {
      return !ctx.hasDir('.claude/rules') || (ctx.dirFiles('.claude/rules') || []).length === 0;
    },
  },
  {
    id: 'AP019',
    name: 'Overly long CLAUDE.md (>500 lines)',
    severity: 'medium',
    description: 'Instruction files over 500 lines consume excessive context tokens and reduce adherence to individual rules.',
    platforms: ['claude'],
    fix: 'Split into CLAUDE.md (core) + .claude/rules/ (scoped). Use @import for focused modules.',
    detect: (ctx) => {
      const content = ctx.fileContent('CLAUDE.md') || ctx.fileContent('.claude/CLAUDE.md') || '';
      if (!content) return false;
      const lineCount = content.split('\n').length;
      return lineCount > 500;
    },
  },
  {
    id: 'AP020',
    name: 'No security review command',
    severity: 'medium',
    description: 'Without a security review command, OWASP Top 10 vulnerabilities go undetected during agent-assisted development.',
    platforms: ['claude', 'codex', 'cursor', 'windsurf', 'copilot', 'gemini', 'aider', 'opencode'],
    fix: 'Add a /security-review command or include security scanning in your CI pipeline.',
    detect: (ctx) => {
      const content = ctx.fileContent('CLAUDE.md') || ctx.fileContent('.claude/CLAUDE.md') || '';
      const hasSecurityReview = /security[- ]?review/i.test(content);
      const hasSecurityCommand = ctx.hasDir('.claude/commands') &&
        (ctx.dirFiles('.claude/commands') || []).some(f => /security/i.test(f));
      return !hasSecurityReview && !hasSecurityCommand;
    },
  },
  {
    id: 'AP021',
    name: 'Inline secrets in hook scripts',
    severity: 'critical',
    description: 'Hardcoded API keys or tokens in hook scripts are executed every session and easily leaked.',
    platforms: ['claude'],
    fix: 'Use environment variables in hooks. Reference secrets via $ENV_VAR instead of hardcoding values.',
    detect: (ctx) => {
      if (!ctx.hasDir('.claude/hooks')) return false;
      const hookFiles = ctx.dirFiles('.claude/hooks');
      const secretPatterns = [
        /(?:api[_-]?key|token|password|secret)\s*=\s*['"][A-Za-z0-9_\-]{16,}['"]/i,
        /sk-[A-Za-z0-9]{20,}/,
        /ghp_[A-Za-z0-9]{36,}/,
        /AKIA[A-Z0-9]{16}/,
      ];
      for (const file of hookFiles) {
        const content = ctx.fileContent(`.claude/hooks/${file}`) || '';
        if (secretPatterns.some(p => p.test(content)) || containsEmbeddedSecret(content)) {
          return true;
        }
      }
      return false;
    },
  },
  {
    id: 'AP022',
    name: 'Missing .env protection in .gitignore',
    severity: 'high',
    description: 'Without .env in .gitignore, environment files with secrets can be accidentally committed and pushed.',
    platforms: ['claude', 'codex', 'cursor', 'windsurf', 'copilot', 'gemini', 'aider', 'opencode'],
    fix: 'Add .env, .env.*, and .env.local to .gitignore. Verify with "git check-ignore .env".',
    detect: (ctx) => {
      const gitignore = ctx.fileContent('.gitignore') || '';
      if (!gitignore) return true;
      return !gitignore.includes('.env');
    },
  },
];

/**
 * Return the full anti-pattern catalog.
 * @returns {Array<Object>} All registered anti-patterns.
 */
function getAntiPatterns() {
  return ANTI_PATTERNS.map(({ detect, ...rest }) => rest);
}

/**
 * Detect anti-patterns present in a project context.
 * @param {Object} ctx - A ProjectContext instance (from src/context.js).
 * @returns {Array<Object>} Detected anti-patterns with id, name, severity, description, and fix.
 */
function detectAntiPatterns(ctx) {
  const detected = [];
  for (const pattern of ANTI_PATTERNS) {
    try {
      if (pattern.detect(ctx)) {
        const { detect, ...rest } = pattern;
        detected.push(rest);
      }
    } catch (_err) {
      // Skip patterns that fail to detect (missing files, etc.)
    }
  }
  return detected;
}

/**
 * Print detected anti-patterns to the console.
 * @param {Array<Object>} patterns - Detected anti-patterns.
 * @param {Object} [options] - Display options.
 * @param {boolean} [options.json] - Output as JSON.
 */
function printAntiPatterns(patterns, options = {}) {
  if (options.json) {
    console.log(JSON.stringify(patterns, null, 2));
    return;
  }

  const SEVERITY_COLORS = {
    critical: '\x1b[31m',
    high: '\x1b[33m',
    medium: '\x1b[36m',
    low: '\x1b[2m',
  };
  const RESET = '\x1b[0m';
  const BOLD = '\x1b[1m';
  const DIM = '\x1b[2m';

  console.log('');
  console.log(`${BOLD}  nerviq anti-patterns${RESET}`);
  console.log(`${DIM}  ${'═'.repeat(39)}${RESET}`);

  if (patterns.length === 0) {
    console.log(`  ${'\\x1b[32m'}No anti-patterns detected. Good job!${RESET}`);
    console.log('');
    return;
  }

  console.log(`  ${patterns.length} anti-pattern${patterns.length === 1 ? '' : 's'} detected`);
  console.log('');

  // Sort by severity: critical > high > medium > low
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...patterns].sort((a, b) => (severityOrder[a.severity] || 9) - (severityOrder[b.severity] || 9));

  for (const p of sorted) {
    const color = SEVERITY_COLORS[p.severity] || '';
    console.log(`  ${color}[${p.severity}]${RESET} ${p.name} (${p.id})`);
    console.log(`${DIM}    ${p.description}${RESET}`);
    console.log(`${DIM}    Fix: ${p.fix}${RESET}`);
    console.log('');
  }
}

/**
 * Print the full anti-pattern catalog.
 * @param {Object} [options] - Display options.
 * @param {boolean} [options.json] - Output as JSON.
 */
function printAntiPatternCatalog(options = {}) {
  const all = getAntiPatterns();
  if (options.json) {
    console.log(JSON.stringify(all, null, 2));
    return;
  }

  const SEVERITY_COLORS = {
    critical: '\x1b[31m',
    high: '\x1b[33m',
    medium: '\x1b[36m',
    low: '\x1b[2m',
  };
  const RESET = '\x1b[0m';
  const BOLD = '\x1b[1m';
  const DIM = '\x1b[2m';

  console.log('');
  console.log(`${BOLD}  nerviq anti-pattern catalog${RESET}`);
  console.log(`${DIM}  ${'═'.repeat(39)}${RESET}`);
  console.log(`  ${all.length} anti-patterns registered`);
  console.log('');

  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...all].sort((a, b) => (severityOrder[a.severity] || 9) - (severityOrder[b.severity] || 9));

  for (const p of sorted) {
    const color = SEVERITY_COLORS[p.severity] || '';
    console.log(`  ${color}[${p.severity}]${RESET} ${p.name} (${p.id})`);
    console.log(`${DIM}    ${p.description}${RESET}`);
    console.log(`${DIM}    Platforms: ${p.platforms.join(', ')}${RESET}`);
    console.log(`${DIM}    Fix: ${p.fix}${RESET}`);
    console.log('');
  }
}

module.exports = {
  ANTI_PATTERNS,
  getAntiPatterns,
  detectAntiPatterns,
  printAntiPatterns,
  printAntiPatternCatalog,
};
