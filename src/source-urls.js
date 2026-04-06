/**
 * Official source URL + confidence registry for platform technique catalogs.
 *
 * We attach metadata at export time so the catalogs stay maintainable without
 * hand-editing hundreds of technique literals.
 */

const SOURCE_URLS = {
  claude: {
    defaultUrl: 'https://code.claude.com/docs/en/overview',
    byCategory: {
      memory: 'https://code.claude.com/docs/en/memory',
      quality: 'https://code.claude.com/docs/en/common-workflows',
      git: 'https://code.claude.com/docs/en/settings',
      workflow: 'https://code.claude.com/docs/en/common-workflows',
      security: 'https://code.claude.com/docs/en/permissions',
      automation: 'https://code.claude.com/docs/en/hooks',
      design: 'https://code.claude.com/docs/en/best-practices',
      devops: 'https://code.claude.com/docs/en/common-workflows',
      hygiene: 'https://code.claude.com/docs/en/overview',
      performance: 'https://code.claude.com/docs/en/memory',
      tools: 'https://code.claude.com/docs/en/mcp',
      prompting: 'https://code.claude.com/docs/en/best-practices',
      features: 'https://code.claude.com/docs/en/commands',
      'quality-deep': 'https://code.claude.com/docs/en/best-practices',
      'testing-strategy': 'https://code.claude.com/docs/en/common-workflows',
      'code-quality': 'https://code.claude.com/docs/en/best-practices',
      'api-design': 'https://code.claude.com/docs/en/best-practices',
      database: 'https://code.claude.com/docs/en/common-workflows',
      authentication: 'https://code.claude.com/docs/en/permissions',
      monitoring: 'https://code.claude.com/docs/en/common-workflows',
      'dependency-management': 'https://code.claude.com/docs/en/best-practices',
      'cost-optimization': 'https://code.claude.com/docs/en/memory',
      python: 'https://code.claude.com/docs/en/common-workflows',
      go: 'https://code.claude.com/docs/en/common-workflows',
      rust: 'https://code.claude.com/docs/en/common-workflows',
      java: 'https://code.claude.com/docs/en/common-workflows',
      ruby: 'https://code.claude.com/docs/en/common-workflows',
      dotnet: 'https://code.claude.com/docs/en/common-workflows',
      php: 'https://code.claude.com/docs/en/common-workflows',
      flutter: 'https://code.claude.com/docs/en/common-workflows',
      swift: 'https://code.claude.com/docs/en/common-workflows',
      kotlin: 'https://code.claude.com/docs/en/common-workflows',
    },
    byKey: {
      customCommands: 'https://code.claude.com/docs/en/commands',
      multipleCommands: 'https://code.claude.com/docs/en/commands',
      deployCommand: 'https://code.claude.com/docs/en/commands',
      reviewCommand: 'https://code.claude.com/docs/en/commands',
      agents: 'https://code.claude.com/docs/en/sub-agents',
      multipleAgents: 'https://code.claude.com/docs/en/sub-agents',
      agentsHaveMaxTurns: 'https://code.claude.com/docs/en/sub-agents',
      agentHasAllowedTools: 'https://code.claude.com/docs/en/sub-agents',
      skills: 'https://code.claude.com/docs/en/skills',
      multipleSkills: 'https://code.claude.com/docs/en/skills',
      skillUsesPaths: 'https://code.claude.com/docs/en/skills',
      frontendDesignSkill: 'https://code.claude.com/docs/en/skills',
    },
  },
  codex: {
    defaultUrl: 'https://developers.openai.com/codex/cli',
    byCategory: {
      instructions: 'https://developers.openai.com/codex/guides/agents-md',
      config: 'https://developers.openai.com/codex/config-reference',
      trust: 'https://developers.openai.com/codex/agent-approvals-security',
      rules: 'https://developers.openai.com/codex/rules',
      hooks: 'https://developers.openai.com/codex/hooks',
      mcp: 'https://developers.openai.com/codex/mcp',
      skills: 'https://developers.openai.com/codex/skills',
      agents: 'https://developers.openai.com/codex/subagents',
      automation: 'https://developers.openai.com/codex/app/automations',
      review: 'https://developers.openai.com/codex/cli',
      local: 'https://developers.openai.com/codex/app/local-environments',
      'quality-deep': 'https://developers.openai.com/codex/feature-maturity',
      advisory: 'https://developers.openai.com/codex/cli',
      'pack-posture': 'https://developers.openai.com/codex/mcp',
      'repeat-usage': 'https://developers.openai.com/codex/cli',
      'release-freshness': 'https://developers.openai.com/codex/changelog',
      'testing-strategy': 'https://developers.openai.com/codex/cli',
      'code-quality': 'https://developers.openai.com/codex/rules',
      'api-design': 'https://developers.openai.com/codex/guides/agents-md',
      database: 'https://developers.openai.com/codex/cli',
      authentication: 'https://developers.openai.com/codex/agent-approvals-security',
      monitoring: 'https://developers.openai.com/codex/feature-maturity',
      'dependency-management': 'https://developers.openai.com/codex/config-reference',
      'cost-optimization': 'https://developers.openai.com/codex/guides/agents-md',
      python: 'https://developers.openai.com/codex/cli',
      go: 'https://developers.openai.com/codex/cli',
      rust: 'https://developers.openai.com/codex/cli',
      java: 'https://developers.openai.com/codex/cli',
      ruby: 'https://developers.openai.com/codex/cli',
      dotnet: 'https://developers.openai.com/codex/cli',
      php: 'https://developers.openai.com/codex/cli',
      flutter: 'https://developers.openai.com/codex/cli',
      swift: 'https://developers.openai.com/codex/cli',
      kotlin: 'https://developers.openai.com/codex/cli',
    },
    byKey: {
      codexAutomationManuallyTested: 'https://developers.openai.com/codex/app/automations',
      codexAutomationAppPrereqAcknowledged: 'https://developers.openai.com/codex/app/automations',
      codexGitHubActionSafeStrategy: 'https://developers.openai.com/codex/github-action',
      codexGitHubActionPromptSourceExclusive: 'https://developers.openai.com/codex/github-action',
      codexGitHubActionSinglePromptSource: 'https://developers.openai.com/codex/github-action',
      codexGitHubActionTriggerAllowlistsExplicit: 'https://developers.openai.com/codex/github-action',
      codexCiAuthUsesManagedKey: 'https://developers.openai.com/codex/github-action',
      codexPluginConfigValid: 'https://developers.openai.com/codex/skills',
      codexUndoExplicit: 'https://developers.openai.com/codex/config-reference',
      codexWorktreeLifecycleDocumented: 'https://developers.openai.com/codex/app/local-environments',
    },
  },
  gemini: {
    defaultUrl: 'https://geminicli.com/docs/get-started/',
    byCategory: {
      instructions: 'https://geminicli.com/docs/cli/gemini-md/',
      config: 'https://geminicli.com/docs/reference/configuration/',
      trust: 'https://geminicli.com/docs/cli/trusted-folders/',
      hooks: 'https://geminicli.com/docs/hooks/reference/',
      mcp: 'https://geminicli.com/docs/tools/mcp-server/',
      sandbox: 'https://geminicli.com/docs/cli/sandbox/',
      agents: 'https://geminicli.com/docs/core/subagents/',
      skills: 'https://geminicli.com/docs/cli/skills/',
      automation: 'https://geminicli.com/docs/get-started/',
      extensions: 'https://geminicli.com/docs/extensions/',
      review: 'https://geminicli.com/docs/get-started/',
      'quality-deep': 'https://geminicli.com/docs/get-started/',
      commands: 'https://geminicli.com/docs/cli/custom-commands/',
      advisory: 'https://geminicli.com/docs/get-started/',
      'pack-posture': 'https://geminicli.com/docs/tools/mcp-server/',
      'repeat-usage': 'https://geminicli.com/docs/cli/session-management/',
      'release-freshness': 'https://geminicli.com/docs/changelogs/latest/',
      'testing-strategy': 'https://geminicli.com/docs/get-started/',
      'code-quality': 'https://geminicli.com/docs/cli/gemini-md/',
      'api-design': 'https://geminicli.com/docs/cli/gemini-md/',
      database: 'https://geminicli.com/docs/get-started/',
      authentication: 'https://geminicli.com/docs/cli/trusted-folders/',
      monitoring: 'https://geminicli.com/docs/get-started/',
      'dependency-management': 'https://geminicli.com/docs/reference/configuration/',
      'cost-optimization': 'https://geminicli.com/docs/get-started/',
      python: 'https://geminicli.com/docs/get-started/',
      go: 'https://geminicli.com/docs/get-started/',
      rust: 'https://geminicli.com/docs/get-started/',
      java: 'https://geminicli.com/docs/get-started/',
      ruby: 'https://geminicli.com/docs/get-started/',
      dotnet: 'https://geminicli.com/docs/get-started/',
      php: 'https://geminicli.com/docs/get-started/',
      flutter: 'https://geminicli.com/docs/get-started/',
      swift: 'https://geminicli.com/docs/get-started/',
      kotlin: 'https://geminicli.com/docs/get-started/',
    },
  },
  copilot: {
    defaultUrl: 'https://docs.github.com/en/copilot',
    byCategory: {
      instructions: 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      config: 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      trust: 'https://docs.github.com/en/copilot/responsible-use-of-github-copilot-features/github-copilot-data-handling',
      mcp: 'https://docs.github.com/en/copilot/customizing-copilot/using-model-context-protocol/extending-copilot-chat-with-mcp',
      'cloud-agent': 'https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent',
      organization: 'https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-organization/manage-policies',
      'prompt-files': 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      'skills-agents': 'https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent',
      'ci-automation': 'https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment',
      enterprise: 'https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise',
      extensions: 'https://docs.github.com/en/copilot/building-copilot-extensions/about-building-copilot-extensions',
      'quality-deep': 'https://docs.github.com/en/copilot',
      advisory: 'https://docs.github.com/en/copilot',
      freshness: 'https://docs.github.com/en/copilot',
      'testing-strategy': 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      'code-quality': 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      'api-design': 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      database: 'https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent',
      authentication: 'https://docs.github.com/en/copilot/responsible-use-of-github-copilot-features/github-copilot-data-handling',
      monitoring: 'https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/customize-the-agent-environment',
      'dependency-management': 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      'cost-optimization': 'https://docs.github.com/en/copilot',
      python: 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      go: 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      rust: 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      java: 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      ruby: 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      dotnet: 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      php: 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      flutter: 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      swift: 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
      kotlin: 'https://docs.github.com/en/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot',
    },
  },
  cursor: {
    defaultUrl: 'https://docs.cursor.com/',
    byCategory: {
      rules: 'https://docs.cursor.com/context/rules',
      config: 'https://docs.cursor.com/',
      trust: 'https://docs.cursor.com/enterprise/privacy-and-data-governance',
      'agent-mode': 'https://docs.cursor.com/en/chat/agent',
      mcp: 'https://docs.cursor.com/cli/mcp',
      'instructions-quality': 'https://docs.cursor.com/guides/working-with-context',
      'background-agents': 'https://docs.cursor.com/en/background-agents',
      automations: 'https://docs.cursor.com/en/background-agents/automations',
      enterprise: 'https://docs.cursor.com/enterprise',
      bugbot: 'https://docs.cursor.com/bugbot',
      'cross-surface': 'https://docs.cursor.com/',
      'quality-deep': 'https://docs.cursor.com/guides/working-with-context',
      advisory: 'https://docs.cursor.com/',
      freshness: 'https://docs.cursor.com/',
      'testing-strategy': 'https://docs.cursor.com/guides/working-with-context',
      'code-quality': 'https://docs.cursor.com/context/rules',
      'api-design': 'https://docs.cursor.com/guides/working-with-context',
      database: 'https://docs.cursor.com/guides/working-with-context',
      authentication: 'https://docs.cursor.com/enterprise/privacy-and-data-governance',
      monitoring: 'https://docs.cursor.com/guides/working-with-context',
      'dependency-management': 'https://docs.cursor.com/guides/working-with-context',
      'cost-optimization': 'https://docs.cursor.com/account',
      python: 'https://docs.cursor.com/guides/working-with-context',
      go: 'https://docs.cursor.com/guides/working-with-context',
      rust: 'https://docs.cursor.com/guides/working-with-context',
      java: 'https://docs.cursor.com/guides/working-with-context',
      ruby: 'https://docs.cursor.com/guides/working-with-context',
      dotnet: 'https://docs.cursor.com/guides/working-with-context',
      php: 'https://docs.cursor.com/guides/working-with-context',
      flutter: 'https://docs.cursor.com/guides/working-with-context',
      swift: 'https://docs.cursor.com/guides/working-with-context',
      kotlin: 'https://docs.cursor.com/guides/working-with-context',
    },
  },
  windsurf: {
    defaultUrl: 'https://docs.windsurf.com/windsurf/cascade/cascade',
    byCategory: {
      rules: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      config: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      trust: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      'cascade-agent': 'https://docs.windsurf.com/windsurf/cascade/agents-md',
      mcp: 'https://docs.windsurf.com/windsurf/cascade/mcp',
      'instructions-quality': 'https://docs.windsurf.com/windsurf/cascade/agents-md',
      workflows: 'https://docs.windsurf.com/windsurf/cascade/workflows',
      memories: 'https://docs.windsurf.com/windsurf/cascade/memories',
      enterprise: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      cascadeignore: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      'cross-surface': 'https://docs.windsurf.com/windsurf/cascade/cascade',
      'quality-deep': 'https://docs.windsurf.com/windsurf/cascade/cascade',
      advisory: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      freshness: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      'testing-strategy': 'https://docs.windsurf.com/windsurf/cascade/cascade',
      'code-quality': 'https://docs.windsurf.com/windsurf/cascade/cascade',
      'api-design': 'https://docs.windsurf.com/windsurf/cascade/cascade',
      database: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      authentication: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      monitoring: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      'dependency-management': 'https://docs.windsurf.com/windsurf/cascade/cascade',
      'cost-optimization': 'https://docs.windsurf.com/windsurf/cascade/cascade',
      python: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      go: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      rust: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      java: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      ruby: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      dotnet: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      php: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      flutter: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      swift: 'https://docs.windsurf.com/windsurf/cascade/cascade',
      kotlin: 'https://docs.windsurf.com/windsurf/cascade/cascade',
    },
  },
  aider: {
    defaultUrl: 'https://aider.chat/docs/',
    byCategory: {
      config: 'https://aider.chat/docs/config.html',
      'advanced-config': 'https://aider.chat/docs/config/aider_conf.html',
      'git-safety': 'https://aider.chat/docs/git.html',
      'model-config': 'https://aider.chat/docs/config/adv-model-settings.html',
      conventions: 'https://aider.chat/docs/usage/conventions.html',
      architecture: 'https://aider.chat/docs/usage/modes.html',
      security: 'https://aider.chat/docs/config/dotenv.html',
      ci: 'https://aider.chat/docs/usage/modes.html',
      quality: 'https://aider.chat/docs/usage/modes.html',
      'workflow-patterns': 'https://aider.chat/docs/usage/modes.html',
      'editor-integration': 'https://aider.chat/docs/config.html',
      'release-readiness': 'https://aider.chat/docs/',
      'testing-strategy': 'https://aider.chat/docs/',
      'code-quality': 'https://aider.chat/docs/',
      'api-design': 'https://aider.chat/docs/',
      database: 'https://aider.chat/docs/',
      authentication: 'https://aider.chat/docs/',
      monitoring: 'https://aider.chat/docs/',
      'dependency-management': 'https://aider.chat/docs/',
      'cost-optimization': 'https://aider.chat/docs/',
      python: 'https://aider.chat/docs/',
      go: 'https://aider.chat/docs/',
      rust: 'https://aider.chat/docs/',
      java: 'https://aider.chat/docs/',
      ruby: 'https://aider.chat/docs/',
      dotnet: 'https://aider.chat/docs/',
      php: 'https://aider.chat/docs/',
      flutter: 'https://aider.chat/docs/',
      swift: 'https://aider.chat/docs/',
      kotlin: 'https://aider.chat/docs/',
    },
  },
  opencode: {
    defaultUrl: 'https://github.com/sst/opencode',
    byCategory: {
      instructions: 'https://github.com/sst/opencode/blob/dev/AGENTS.md',
      config: 'https://github.com/sst/opencode/tree/dev/.opencode',
      permissions: 'https://github.com/sst/opencode/tree/dev/.opencode',
      plugins: 'https://github.com/sst/opencode/tree/dev/.opencode',
      security: 'https://github.com/sst/opencode/blob/dev/SECURITY.md',
      mcp: 'https://github.com/sst/opencode/tree/dev/.opencode',
      ci: 'https://github.com/sst/opencode/tree/dev/.github',
      'quality-deep': 'https://github.com/sst/opencode/blob/dev/README.md',
      skills: 'https://github.com/sst/opencode/tree/dev/.opencode',
      agents: 'https://github.com/sst/opencode/blob/dev/AGENTS.md',
      commands: 'https://github.com/sst/opencode/tree/dev/.opencode',
      tui: 'https://github.com/sst/opencode/blob/dev/README.md',
      governance: 'https://github.com/sst/opencode/blob/dev/SECURITY.md',
      'release-freshness': 'https://github.com/sst/opencode/releases',
      'mixed-agent': 'https://github.com/sst/opencode/blob/dev/AGENTS.md',
      propagation: 'https://github.com/sst/opencode/tree/dev/.opencode',
      'testing-strategy': 'https://github.com/sst/opencode',
      'code-quality': 'https://github.com/sst/opencode',
      'api-design': 'https://github.com/sst/opencode',
      database: 'https://github.com/sst/opencode',
      authentication: 'https://github.com/sst/opencode',
      monitoring: 'https://github.com/sst/opencode',
      'dependency-management': 'https://github.com/sst/opencode',
      'cost-optimization': 'https://github.com/sst/opencode',
      python: 'https://github.com/sst/opencode',
      go: 'https://github.com/sst/opencode',
      rust: 'https://github.com/sst/opencode',
      java: 'https://github.com/sst/opencode',
      ruby: 'https://github.com/sst/opencode',
      dotnet: 'https://github.com/sst/opencode',
      php: 'https://github.com/sst/opencode',
      flutter: 'https://github.com/sst/opencode',
      swift: 'https://github.com/sst/opencode',
      kotlin: 'https://github.com/sst/opencode',
    },
  },
};

const STALE_CONFIDENCE_IDS = new Set([
  'CX-B04',
  'CX-B09',
  'CX-C05',
  'CX-C06',
]);

const LAST_VERIFIED = {
  default: '2026-04-05',
};

const RUNTIME_CONFIDENCE_IDS = {
  codex: new Set([
    'CX-B01',
    'CX-C01',
    'CX-C02',
    'CX-C03',
    'CX-D01',
    'CX-E02',
    'CX-H02',
    'CX-H03',
    'CX-I01',
  ]),
  gemini: new Set(['GM-Q01', 'GM-Q02', 'GM-Q03', 'GM-Q04', 'GM-Q05']),
  copilot: new Set(['CP-Q01', 'CP-Q02', 'CP-Q03', 'CP-Q04', 'CP-Q05']),
};

function hasRuntimeVerificationSignal(technique) {
  const haystack = `${technique.name || ''}\n${technique.fix || ''}`;
  return /experiment(?:ally)? confirmed|confirmed by (?:live )?experiment|current runtime|runtime evidence|runtime-verified|validated in current runtime|observed in current runtime|measured in live experiment|reproduced in runtime|confirmed by experiment/i.test(haystack);
}

// Stack categories where checks are generated/adapted rather than individually verified
const STACK_CATEGORIES = new Set([
  'python', 'go', 'rust', 'java', 'ruby', 'dotnet', 'php', 'flutter', 'swift', 'kotlin',
]);

function resolveConfidence(platform, technique) {
  if (STALE_CONFIDENCE_IDS.has(technique.id)) {
    return 0.3;
  }

  // Runtime-verified: highest confidence
  if (RUNTIME_CONFIDENCE_IDS[platform]?.has(technique.id) || hasRuntimeVerificationSignal(technique)) {
    return 0.9;
  }

  // Has fix template: author wrote specific remediation → higher confidence
  if (technique.template) {
    return 0.8;
  }

  // Stack-specific checks: generated per-language, less individually verified
  if (STACK_CATEGORIES.has(technique.category)) {
    return 0.6;
  }

  // Default: documented but not individually experiment-verified
  return 0.7;
}

function attachSourceUrls(platform, techniques) {
  const mapping = SOURCE_URLS[platform];
  if (!mapping) {
    throw new Error(`Unknown source-url platform '${platform}'`);
  }

  for (const [key, technique] of Object.entries(techniques)) {
    const resolved =
      mapping.byKey?.[key] ||
      mapping.byCategory?.[technique.category] ||
      mapping.defaultUrl;

    if (!resolved) {
      throw new Error(`No sourceUrl mapping found for ${platform}:${key}`);
    }

    technique.sourceUrl = technique.sourceUrl || resolved;
    technique.confidence = resolveConfidence(platform, technique);
    technique.lastVerified = technique.lastVerified || LAST_VERIFIED[platform] || LAST_VERIFIED.default;
  }

  return techniques;
}

module.exports = {
  SOURCE_URLS,
  LAST_VERIFIED,
  attachSourceUrls,
};
