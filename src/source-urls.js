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
      monitoring: 'https://code.claude.com/docs/en/best-practices',
      'dependency-management': 'https://code.claude.com/docs/en/best-practices',
      'cost-optimization': 'https://code.claude.com/docs/en/memory',
      python: 'https://code.claude.com/docs/en/best-practices',
      go: 'https://code.claude.com/docs/en/best-practices',
      rust: 'https://code.claude.com/docs/en/best-practices',
      java: 'https://code.claude.com/docs/en/best-practices',
      ruby: 'https://code.claude.com/docs/en/best-practices',
      dotnet: 'https://code.claude.com/docs/en/best-practices',
      php: 'https://code.claude.com/docs/en/best-practices',
      flutter: 'https://code.claude.com/docs/en/best-practices',
      swift: 'https://code.claude.com/docs/en/best-practices',
      kotlin: 'https://code.claude.com/docs/en/best-practices',
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
    defaultUrl: 'https://learn.chatgpt.com/docs/codex/cli',
    byCategory: {
      instructions: 'https://learn.chatgpt.com/docs/agent-configuration/agents-md',
      config: 'https://learn.chatgpt.com/docs/config-file/config-reference',
      trust: 'https://learn.chatgpt.com/docs/agent-approvals-security',
      rules: 'https://learn.chatgpt.com/docs/agent-configuration/rules',
      hooks: 'https://learn.chatgpt.com/docs/hooks',
      mcp: 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
      skills: 'https://learn.chatgpt.com/docs/build-skills',
      agents: 'https://learn.chatgpt.com/docs/agent-configuration/subagents',
      automation: 'https://learn.chatgpt.com/docs/automations?surface=app',
      review: 'https://learn.chatgpt.com/docs/agent-configuration/agents-md',
      local: 'https://learn.chatgpt.com/docs/environments/local-environment',
      'quality-deep': 'https://learn.chatgpt.com/docs/feature-maturity',
      advisory: 'https://learn.chatgpt.com/docs/feature-maturity',
      'pack-posture': 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli',
      'repeat-usage': 'https://learn.chatgpt.com/docs/environments/local-environment',
      'release-freshness': 'https://learn.chatgpt.com/docs/changelog',
      'testing-strategy': 'https://learn.chatgpt.com/docs/agent-configuration/agents-md',
      'code-quality': 'https://learn.chatgpt.com/docs/agent-configuration/rules',
      'api-design': 'https://learn.chatgpt.com/docs/agent-configuration/agents-md',
      database: 'https://learn.chatgpt.com/docs/environments/local-environment',
      authentication: 'https://learn.chatgpt.com/docs/agent-approvals-security',
      monitoring: 'https://learn.chatgpt.com/docs/feature-maturity',
      'dependency-management': 'https://learn.chatgpt.com/docs/config-file/config-reference',
      'cost-optimization': 'https://learn.chatgpt.com/docs/agent-configuration/agents-md',
      python: 'https://learn.chatgpt.com/docs/agent-configuration/rules',
      go: 'https://learn.chatgpt.com/docs/agent-configuration/rules',
      rust: 'https://learn.chatgpt.com/docs/agent-configuration/rules',
      java: 'https://learn.chatgpt.com/docs/agent-configuration/rules',
      ruby: 'https://learn.chatgpt.com/docs/agent-configuration/rules',
      dotnet: 'https://learn.chatgpt.com/docs/agent-configuration/rules',
      php: 'https://learn.chatgpt.com/docs/agent-configuration/rules',
      flutter: 'https://learn.chatgpt.com/docs/agent-configuration/agents-md',
      swift: 'https://learn.chatgpt.com/docs/agent-configuration/agents-md',
      kotlin: 'https://learn.chatgpt.com/docs/agent-configuration/agents-md',
    },
    byKey: {
      codexAutomationManuallyTested: 'https://learn.chatgpt.com/docs/automations?surface=app',
      codexAutomationAppPrereqAcknowledged: 'https://learn.chatgpt.com/docs/automations?surface=app',
      codexGitHubActionSafeStrategy: 'https://learn.chatgpt.com/docs/github-action',
      codexGitHubActionPromptSourceExclusive: 'https://learn.chatgpt.com/docs/github-action',
      codexGitHubActionSinglePromptSource: 'https://learn.chatgpt.com/docs/github-action',
      codexGitHubActionTriggerAllowlistsExplicit: 'https://learn.chatgpt.com/docs/github-action',
      codexCiAuthUsesManagedKey: 'https://learn.chatgpt.com/docs/github-action',
      codexPluginConfigValid: 'https://learn.chatgpt.com/docs/build-skills',
      codexUndoExplicit: 'https://learn.chatgpt.com/docs/config-file/config-reference',
      codexWorktreeLifecycleDocumented: 'https://learn.chatgpt.com/docs/environments/local-environment',
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
      automation: 'https://geminicli.com/docs/cli/session-management/',
      extensions: 'https://geminicli.com/docs/extensions/',
      review: 'https://geminicli.com/docs/cli/session-management/',
      'quality-deep': 'https://geminicli.com/docs/cli/gemini-md/',
      commands: 'https://geminicli.com/docs/cli/custom-commands/',
      advisory: 'https://geminicli.com/docs/cli/session-management/',
      'pack-posture': 'https://geminicli.com/docs/tools/mcp-server/',
      'repeat-usage': 'https://geminicli.com/docs/cli/session-management/',
      'release-freshness': 'https://geminicli.com/docs/changelogs/latest/',
      'testing-strategy': 'https://geminicli.com/docs/cli/gemini-md/',
      'code-quality': 'https://geminicli.com/docs/cli/gemini-md/',
      'api-design': 'https://geminicli.com/docs/cli/gemini-md/',
      database: 'https://geminicli.com/docs/reference/configuration/',
      authentication: 'https://geminicli.com/docs/cli/trusted-folders/',
      monitoring: 'https://geminicli.com/docs/reference/configuration/',
      'dependency-management': 'https://geminicli.com/docs/reference/configuration/',
      'cost-optimization': 'https://geminicli.com/docs/cli/session-management/',
      python: 'https://geminicli.com/docs/cli/gemini-md/',
      go: 'https://geminicli.com/docs/cli/gemini-md/',
      rust: 'https://geminicli.com/docs/cli/gemini-md/',
      java: 'https://geminicli.com/docs/cli/gemini-md/',
      ruby: 'https://geminicli.com/docs/cli/gemini-md/',
      dotnet: 'https://geminicli.com/docs/cli/gemini-md/',
      php: 'https://geminicli.com/docs/cli/gemini-md/',
      flutter: 'https://geminicli.com/docs/cli/gemini-md/',
      swift: 'https://geminicli.com/docs/cli/gemini-md/',
      kotlin: 'https://geminicli.com/docs/cli/gemini-md/',
    },
  },
  copilot: {
    defaultUrl: 'https://docs.github.com/en/copilot',
    byCategory: {
      instructions: 'https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions',
      config: 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      trust: 'https://docs.github.com/en/copilot/responsible-use',
      mcp: 'https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide',
      'cloud-agent': 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      organization: 'https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-organization/manage-policies',
      'prompt-files': 'https://docs.github.com/en/copilot/tutorials/customization-library/prompt-files',
      'skills-agents': 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      'ci-automation': 'https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment',
      enterprise: 'https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise',
      extensions: 'https://docs.github.com/en/copilot/concepts/context/mcp',
      'quality-deep': 'https://docs.github.com/en/copilot',
      advisory: 'https://docs.github.com/en/copilot',
      freshness: 'https://docs.github.com/en/copilot',
      'testing-strategy': 'https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment',
      'code-quality': 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      'api-design': 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      database: 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      authentication: 'https://docs.github.com/en/copilot/responsible-use',
      monitoring: 'https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment',
      'dependency-management': 'https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/customize-the-agent-environment',
      'cost-optimization': 'https://docs.github.com/en/copilot',
      python: 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      go: 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      rust: 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      java: 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      ruby: 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      dotnet: 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      php: 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      flutter: 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      swift: 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
      kotlin: 'https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent',
    },
  },
  cursor: {
    defaultUrl: 'https://cursor.com/docs',
    byCategory: {
      rules: 'https://cursor.com/docs/rules',
      config: 'https://cursor.com/docs',
      trust: 'https://cursor.com/docs/enterprise/privacy-and-data-governance',
      'agent-mode': 'https://cursor.com/docs/agent/plan-mode',
      mcp: 'https://cursor.com/docs/mcp',
      'instructions-quality': 'https://cursor.com/docs/rules',
      'background-agents': 'https://cursor.com/docs/cloud-agent',
      automations: 'https://cursor.com/docs/cloud-agent/automations',
      enterprise: 'https://cursor.com/docs/enterprise',
      bugbot: 'https://cursor.com/docs/bugbot',
      'cross-surface': 'https://cursor.com/docs',
      'quality-deep': 'https://cursor.com/docs/rules',
      advisory: 'https://cursor.com/docs',
      freshness: 'https://cursor.com/docs',
      'testing-strategy': 'https://cursor.com/docs/rules',
      'code-quality': 'https://cursor.com/docs/rules',
      'api-design': 'https://cursor.com/docs/rules',
      database: 'https://cursor.com/docs/rules',
      authentication: 'https://cursor.com/docs/enterprise/privacy-and-data-governance',
      monitoring: 'https://cursor.com/docs/rules',
      'dependency-management': 'https://cursor.com/docs/rules',
      'cost-optimization': 'https://cursor.com/docs/models-and-pricing',
      python: 'https://cursor.com/docs/rules',
      go: 'https://cursor.com/docs/rules',
      rust: 'https://cursor.com/docs/rules',
      java: 'https://cursor.com/docs/rules',
      ruby: 'https://cursor.com/docs/rules',
      dotnet: 'https://cursor.com/docs/rules',
      php: 'https://cursor.com/docs/rules',
      flutter: 'https://cursor.com/docs/rules',
      swift: 'https://cursor.com/docs/rules',
      kotlin: 'https://cursor.com/docs/rules',
    },
  },
  windsurf: {
    defaultUrl: 'https://docs.devin.ai/desktop/cascade/cascade',
    byCategory: {
      rules: 'https://docs.devin.ai/desktop/cascade/agents-md',
      config: 'https://docs.devin.ai/desktop/cascade/cascade',
      trust: 'https://docs.devin.ai/desktop/cascade/cascade',
      'cascade-agent': 'https://docs.devin.ai/desktop/cascade/agents-md',
      mcp: 'https://docs.devin.ai/desktop/cascade/mcp',
      'instructions-quality': 'https://docs.devin.ai/desktop/cascade/agents-md',
      workflows: 'https://docs.devin.ai/desktop/cascade/workflows',
      memories: 'https://docs.devin.ai/desktop/cascade/memories',
      enterprise: 'https://docs.devin.ai/desktop/cascade/cascade',
      cascadeignore: 'https://docs.devin.ai/desktop/cascade/cascade',
      'cross-surface': 'https://docs.devin.ai/desktop/cascade/cascade',
      'quality-deep': 'https://docs.devin.ai/desktop/cascade/agents-md',
      advisory: 'https://docs.devin.ai/desktop/cascade/cascade',
      freshness: 'https://docs.devin.ai/desktop/cascade/cascade',
      'testing-strategy': 'https://docs.devin.ai/desktop/cascade/workflows',
      'code-quality': 'https://docs.devin.ai/desktop/cascade/agents-md',
      'api-design': 'https://docs.devin.ai/desktop/cascade/agents-md',
      database: 'https://docs.devin.ai/desktop/cascade/workflows',
      authentication: 'https://docs.devin.ai/desktop/cascade/cascade',
      monitoring: 'https://docs.devin.ai/desktop/cascade/workflows',
      'dependency-management': 'https://docs.devin.ai/desktop/cascade/workflows',
      'cost-optimization': 'https://docs.devin.ai/desktop/cascade/cascade',
      python: 'https://docs.devin.ai/desktop/cascade/workflows',
      go: 'https://docs.devin.ai/desktop/cascade/workflows',
      rust: 'https://docs.devin.ai/desktop/cascade/workflows',
      java: 'https://docs.devin.ai/desktop/cascade/workflows',
      ruby: 'https://docs.devin.ai/desktop/cascade/workflows',
      dotnet: 'https://docs.devin.ai/desktop/cascade/workflows',
      php: 'https://docs.devin.ai/desktop/cascade/workflows',
      flutter: 'https://docs.devin.ai/desktop/cascade/workflows',
      swift: 'https://docs.devin.ai/desktop/cascade/workflows',
      kotlin: 'https://docs.devin.ai/desktop/cascade/workflows',
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
      quality: 'https://aider.chat/docs/usage/conventions.html',
      'workflow-patterns': 'https://aider.chat/docs/usage/modes.html',
      'editor-integration': 'https://aider.chat/docs/config.html',
      'release-readiness': 'https://aider.chat/docs/config.html',
      'testing-strategy': 'https://aider.chat/docs/usage/conventions.html',
      'code-quality': 'https://aider.chat/docs/usage/conventions.html',
      'api-design': 'https://aider.chat/docs/usage/conventions.html',
      database: 'https://aider.chat/docs/usage/modes.html',
      authentication: 'https://aider.chat/docs/config/dotenv.html',
      monitoring: 'https://aider.chat/docs/usage/modes.html',
      'dependency-management': 'https://aider.chat/docs/config.html',
      'cost-optimization': 'https://aider.chat/docs/usage/modes.html',
      python: 'https://aider.chat/docs/usage/conventions.html',
      go: 'https://aider.chat/docs/usage/conventions.html',
      rust: 'https://aider.chat/docs/usage/conventions.html',
      java: 'https://aider.chat/docs/usage/conventions.html',
      ruby: 'https://aider.chat/docs/usage/conventions.html',
      dotnet: 'https://aider.chat/docs/usage/conventions.html',
      php: 'https://aider.chat/docs/usage/conventions.html',
      flutter: 'https://aider.chat/docs/usage/conventions.html',
      swift: 'https://aider.chat/docs/usage/conventions.html',
      kotlin: 'https://aider.chat/docs/usage/conventions.html',
    },
  },
  opencode: {
    defaultUrl: 'https://github.com/anomalyco/opencode',
    byCategory: {
      instructions: 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
      config: 'https://github.com/anomalyco/opencode/tree/dev/.opencode',
      permissions: 'https://github.com/anomalyco/opencode/tree/dev/.opencode',
      plugins: 'https://github.com/anomalyco/opencode/tree/dev/.opencode',
      security: 'https://github.com/anomalyco/opencode/blob/dev/SECURITY.md',
      mcp: 'https://github.com/anomalyco/opencode/tree/dev/.opencode',
      ci: 'https://github.com/anomalyco/opencode/tree/dev/.github',
      'quality-deep': 'https://github.com/anomalyco/opencode/blob/dev/README.md',
      skills: 'https://github.com/anomalyco/opencode/tree/dev/.opencode',
      agents: 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
      commands: 'https://github.com/anomalyco/opencode/tree/dev/.opencode',
      tui: 'https://github.com/anomalyco/opencode/blob/dev/README.md',
      governance: 'https://github.com/anomalyco/opencode/blob/dev/SECURITY.md',
      'release-freshness': 'https://github.com/anomalyco/opencode/releases',
      'mixed-agent': 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
      propagation: 'https://github.com/anomalyco/opencode/tree/dev/.opencode',
      'testing-strategy': 'https://github.com/anomalyco/opencode/tree/dev/.github',
      'code-quality': 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
      'api-design': 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
      database: 'https://github.com/anomalyco/opencode/blob/dev/README.md',
      authentication: 'https://github.com/anomalyco/opencode/blob/dev/SECURITY.md',
      monitoring: 'https://github.com/anomalyco/opencode/blob/dev/README.md',
      'dependency-management': 'https://github.com/anomalyco/opencode/blob/dev/README.md',
      'cost-optimization': 'https://github.com/anomalyco/opencode/blob/dev/README.md',
      python: 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
      go: 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
      rust: 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
      java: 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
      ruby: 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
      dotnet: 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
      php: 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
      flutter: 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
      swift: 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
      kotlin: 'https://github.com/anomalyco/opencode/blob/dev/AGENTS.md',
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
