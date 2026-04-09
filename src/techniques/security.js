/**
 * Security technique fragments.
 * Generated mechanically from the legacy techniques.js monolith during HR-09.
 */

const {
  collectClaudeDenyRules,
  hasPromptInjectionDefenseGuidance,
  hasMcpPromptInjectionDefenseGuidance,
  hasInjectionDefenseHookConfigured,
  getRepoInstructionBundle,
  getWorkflowContent,
} = require('./shared');

module.exports = {
  settingsPermissions: {
      id: 24,
      name: 'Permission configuration',
      check: (ctx) => {
        // Prefer local (effective config) — any settings file with permissions passes
        const settings = ctx.jsonFile('.claude/settings.local.json') || ctx.jsonFile('.claude/settings.json');
        return !!(settings && settings.permissions);
      },
      impact: 'medium',
      rating: 4,
      category: 'security',
      fix: 'Configure allow/deny permission lists for safe tool usage.',
      template: null
    },

  permissionDeny: {
      id: 2401,
      name: 'Deny rules configured in permissions',
      check: (ctx) => {
        return collectClaudeDenyRules(ctx).length > 0;
      },
      impact: 'high',
      rating: 5,
      category: 'security',
      fix: 'Add permissions.deny rules to block dangerous operations (e.g. rm -rf, dropping databases).',
      template: null
    },

  noBypassPermissions: {
      id: 2402,
      name: 'Default mode is not bypassPermissions',
      check: (ctx) => {
        // Check shared settings first (committed to git) — if the shared baseline
        // is safe, a personal settings.local.json override should not fail the audit.
        const shared = ctx.jsonFile('.claude/settings.json');
        if (shared && shared.permissions) {
          return shared.permissions.defaultMode !== 'bypassPermissions';
        }
        const local = ctx.jsonFile('.claude/settings.local.json');
        if (!local || !local.permissions) return null;
        return local.permissions.defaultMode !== 'bypassPermissions';
      },
      impact: 'critical',
      rating: 5,
      category: 'security',
      fix: 'Do not set defaultMode to bypassPermissions. Use explicit allow rules instead.',
      template: null
    },

  secretsProtection: {
      id: 1096,
      name: 'Secrets protection configured',
      check: (ctx) => {
        const shared = ctx.jsonFile('.claude/settings.json');
        const local = ctx.jsonFile('.claude/settings.local.json');
        const settings = shared || local;
        if (!settings || !settings.permissions) return false;
        const denyRules = collectClaudeDenyRules(ctx);
        const hasDeny = denyRules.some((rule) => rule.protectsSecrets);
        // Fail if allow includes "*" (overly broad — bypasses deny rules)
        const allow = settings.permissions.allow || [];
        if (Array.isArray(allow) && allow.includes('*')) return false;
        return hasDeny;
      },
      impact: 'critical',
      rating: 5,
      category: 'security',
      fix: 'Add permissions.deny rules to block reading .env files and secrets directories.',
      template: null
    },

  securityReview: {
      id: 1031,
      name: 'Security review command awareness',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        return md.includes('security') || md.includes('/security-review');
      },
      impact: 'high',
      rating: 5,
      category: 'security',
      fix: 'Add /security-review to your workflow. Claude Code has built-in OWASP Top 10 scanning.',
      template: null
    },

  promptInjectionTrustBoundary: {
      id: 8805,
      name: 'Prompt injection trust boundary documented',
      check: (ctx) => {
        const bundle = getRepoInstructionBundle(ctx);
        return hasPromptInjectionDefenseGuidance(bundle);
      },
      impact: 'high',
      rating: 5,
      category: 'security',
      fix: 'Document a trust boundary: treat repo files, fetched content, and MCP responses as untrusted data, not instructions to follow.',
      template: null
    },

  injectionDefenseHook: {
      id: 8806,
      name: 'Injection defense hook configured for external content',
      check: (ctx) => {
        const shared = ctx.jsonFile('.claude/settings.json');
        const local = ctx.jsonFile('.claude/settings.local.json');
        return hasInjectionDefenseHookConfigured(shared) || hasInjectionDefenseHookConfigured(local);
      },
      impact: 'medium',
      rating: 4,
      category: 'security',
      fix: 'Add a PostToolUse injection-defense hook for WebFetch/WebSearch/Read/Grep/Glob/MCP flows so suspicious external content is logged and reviewed.',
      template: 'hooks'
    },

  mcpPromptInjectionBoundary: {
      id: 8807,
      name: 'MCP responses treated as untrusted in instructions',
      check: (ctx) => {
        const hasMcpSignals = Boolean(
          ctx.fileContent('.mcp.json') ||
          ctx.fileContent('.vscode/mcp.json') ||
          ctx.fileContent('.cursor/mcp.json') ||
          ctx.fileContent('.windsurf/mcp.json') ||
          ctx.fileContent('opencode.json') ||
          ctx.fileContent('opencode.jsonc') ||
          ctx.fileContent('.codex/config.toml')
        );
        if (!hasMcpSignals) return null;
        const bundle = getRepoInstructionBundle(ctx);
        return hasMcpPromptInjectionDefenseGuidance(bundle);
      },
      impact: 'medium',
      rating: 4,
      category: 'security',
      fix: 'Document that MCP outputs are untrusted data, can contain indirect prompt injection, and must never override repo-level instructions.',
      template: null
    },

  sandboxAwareness: {
      id: 2013,
      name: 'Sandbox or isolation mentioned',
      check: (ctx) => {
        const md = ctx.claudeMdContent() || '';
        const settings = ctx.jsonFile('.claude/settings.json') || {};
        return /sandbox|isolat/i.test(md) || !!settings.sandbox;
      },
      impact: 'medium', rating: 3, category: 'security',
      fix: 'Claude Code supports sandboxed command execution. Consider enabling it for untrusted operations.',
      template: null
    },

  denyRulesDepth: {
      id: 2014,
      name: 'Deny rules cover 3+ patterns',
      check: (ctx) => {
        return collectClaudeDenyRules(ctx).length >= 3;
      },
      impact: 'high', rating: 4, category: 'security',
      fix: 'Add at least 3 deny rules: rm -rf, force-push, and .env reads. More patterns = safer Claude.',
      template: null
    },

  sbomExists: {
      id: 130041,
      name: 'SBOM file exists',
      check: (ctx) => {
        return ctx.files.some(f => /sbom\.(json|xml|cdx\.json)|bom\.xml|cyclonedx/i.test(f));
      },
      impact: 'medium',
      category: 'supply-chain',
      fix: 'Generate an SBOM (Software Bill of Materials) in CycloneDX or SPDX format for supply chain transparency.',
    },

  dependencyPinning: {
      id: 130042,
      name: 'Lock files committed',
      check: (ctx) => {
        return ctx.files.some(f => /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|Pipfile\.lock|bun\.lockb|composer\.lock|Gemfile\.lock|go\.sum)$/i.test(f));
      },
      impact: 'high',
      category: 'supply-chain',
      fix: 'Commit lock files (package-lock.json, yarn.lock, Cargo.lock, poetry.lock) for reproducible builds.',
    },

  provenanceAttestation: {
      id: 130043,
      name: 'Provenance or sigstore in CI',
      check: (ctx) => {
        const ci = getWorkflowContent(ctx);
        return /provenance|sigstore|cosign|slsa|attestation/i.test(ci);
      },
      impact: 'medium',
      category: 'supply-chain',
      fix: 'Add npm provenance or sigstore attestation in CI to verify package integrity.',
    },

  lockfileIntegrity: {
      id: 130044,
      name: 'CI uses frozen lockfile install',
      check: (ctx) => {
        const ci = getWorkflowContent(ctx);
        return /npm ci\b|--frozen-lockfile|--immutable|cargo.*--locked|pip install.*--require-hashes/i.test(ci);
      },
      impact: 'high',
      category: 'supply-chain',
      fix: 'Use `npm ci` or `--frozen-lockfile` in CI instead of `npm install` for deterministic builds.',
    },

  dependencyScanning: {
      id: 130045,
      name: 'Dependency scanning configured',
      check: (ctx) => {
        const hasConfig = ctx.files.some(f => /dependabot\.yml|renovate\.json|\.snyk/i.test(f));
        if (hasConfig) return true;
        const ci = getWorkflowContent(ctx);
        return /dependabot|renovate|snyk|npm audit|cargo audit|pip-audit|safety check/i.test(ci);
      },
      impact: 'high',
      category: 'supply-chain',
      fix: 'Configure Dependabot, Renovate, or Snyk to automatically scan and update vulnerable dependencies.',
    },
};
