'use strict';

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function hasAny(set, values) {
  return values.some((value) => set.has(value));
}

function humanizeMaturity(maturity) {
  const labels = {
    none: 'No governed baseline yet',
    starter: 'Starter baseline',
    developing: 'Developing baseline',
    mature: 'Mature governed baseline',
  };
  return labels[maturity] || maturity;
}

function detectTopology(ctx, pkg) {
  const signals = [];
  const hasPackageWorkspaces = Array.isArray(pkg.workspaces) ||
    Boolean(pkg.workspaces && Array.isArray(pkg.workspaces.packages));

  if (hasPackageWorkspaces) signals.push('package.json workspaces');
  if (ctx.fileContent('pnpm-workspace.yaml')) signals.push('pnpm-workspace.yaml');
  if (ctx.fileContent('nx.json')) signals.push('nx.json');
  if (ctx.fileContent('turbo.json')) signals.push('turbo.json');
  if (ctx.fileContent('lerna.json')) signals.push('lerna.json');
  if (ctx.hasDir('packages')) signals.push('packages/');
  if (ctx.hasDir('apps')) signals.push('apps/');

  if (signals.length > 0) {
    return {
      key: 'monorepo',
      label: 'Monorepo',
      rationale: 'Workspace or multi-package signals indicate a shared-root repo topology.',
      signals,
    };
  }

  const multiSurfaceSignals = [];
  if (ctx.hasDir('app')) multiSurfaceSignals.push('app/');
  if (ctx.hasDir('api')) multiSurfaceSignals.push('api/');
  if (ctx.hasDir('services')) multiSurfaceSignals.push('services/');
  if (ctx.hasDir('workers')) multiSurfaceSignals.push('workers/');

  if (multiSurfaceSignals.length >= 2) {
    return {
      key: 'multi-surface',
      label: 'Multi-surface repo',
      rationale: 'Several product/service surfaces live in one repository even without formal workspace tooling.',
      signals: multiSurfaceSignals,
    };
  }

  return {
    key: 'single-repo',
    label: 'Single-repo',
    rationale: 'No workspace or multi-package signals detected.',
    signals: [],
  };
}

function detectStackFamily(stackKeys, domainKeys, ctx) {
  if (hasAny(stackKeys, ['flutter', 'swift', 'kotlin']) || domainKeys.has('mobile')) {
    return { key: 'mobile', label: 'Mobile', rationale: 'Native or mobile-platform stacks dominate the repo.' };
  }
  if (domainKeys.has('infra-platform') || domainKeys.has('devops-cicd') || hasAny(stackKeys, ['terraform', 'kubernetes', 'docker'])) {
    return { key: 'infra', label: 'Infrastructure / platform', rationale: 'Deployment, infrastructure, or CI surfaces are central.' };
  }
  if (domainKeys.has('ai-ml') || domainKeys.has('data-pipeline') || ctx.hasDir('experiments') || ctx.hasDir('notebooks')) {
    return { key: 'data-ml', label: 'Data / AI / ML', rationale: 'Pipeline, experiment, or model workflow signals are present.' };
  }
  const hasFrontend = hasAny(stackKeys, ['react', 'nextjs', 'vue', 'angular', 'svelte']) || ctx.hasDir('components');
  const hasBackend = hasAny(stackKeys, ['node', 'python', 'django', 'fastapi', 'go', 'rust', 'java', 'ruby', 'php', 'dotnet']) || ctx.hasDir('api') || ctx.hasDir('services');
  if (hasFrontend && hasBackend) {
    return { key: 'fullstack', label: 'Full-stack application', rationale: 'Both UI and service-layer signals are present.' };
  }
  if (hasFrontend) {
    return { key: 'frontend', label: 'Frontend application', rationale: 'UI and component signals dominate the repo.' };
  }
  if (hasBackend) {
    return { key: 'backend', label: 'Backend service', rationale: 'Service, API, or backend stack signals dominate the repo.' };
  }
  if (domainKeys.has('docs-content')) {
    return { key: 'docs', label: 'Docs / content', rationale: 'Documentation and content workflow signals dominate the repo.' };
  }
  return { key: 'general', label: 'General codebase', rationale: 'No strong stack family dominates yet.' };
}

function detectRepoClass({ ctx, pkg, domainKeys, stackKeys, topology }) {
  const signals = [];
  const hasFrontend = hasAny(stackKeys, ['react', 'nextjs', 'vue', 'angular', 'svelte']) || ctx.hasDir('components') || ctx.hasDir('pages');
  const hasBackend = hasAny(stackKeys, ['node', 'python', 'django', 'fastapi', 'go', 'rust', 'java', 'ruby', 'php', 'dotnet']) || ctx.hasDir('api') || ctx.hasDir('services') || ctx.hasDir('routes');
  const isInfra = domainKeys.has('infra-platform') || domainKeys.has('devops-cicd') || hasAny(stackKeys, ['terraform', 'kubernetes', 'docker']) || ctx.hasDir('infra') || ctx.hasDir('deploy') || ctx.hasDir('helm');
  const isMl = domainKeys.has('ai-ml') || domainKeys.has('data-pipeline') || ctx.hasDir('experiments') || ctx.hasDir('datasets') || ctx.hasDir('notebooks');
  const isMobile = hasAny(stackKeys, ['flutter', 'swift', 'kotlin']) || domainKeys.has('mobile') || ctx.hasDir('ios') || ctx.hasDir('android');
  const isLibrary = domainKeys.has('oss-library') || ((!hasFrontend && !hasBackend) && Boolean(pkg.main || pkg.module || pkg.exports || pkg.types));
  const isCli = domainKeys.has('cli-tool') || Boolean(pkg.bin) || ctx.hasDir('bin');

  if (topology.key === 'monorepo' && isInfra) {
    signals.push('workspace topology', 'infra / deploy signals');
    return {
      key: 'platform-monorepo',
      label: 'Platform monorepo',
      rationale: 'Shared-root workspace plus infrastructure signals indicate a platform-style repo.',
      signals,
    };
  }

  if (topology.key === 'monorepo' && (hasFrontend || hasBackend)) {
    signals.push('workspace topology', hasFrontend ? 'frontend signals' : null, hasBackend ? 'backend signals' : null);
    return {
      key: 'application-monorepo',
      label: 'Application monorepo',
      rationale: 'Multiple app/service surfaces share one governed root.',
      signals: unique(signals),
    };
  }

  if (isInfra) {
    signals.push('infra / deploy signals');
    return {
      key: 'infra-platform',
      label: 'Infrastructure / platform repo',
      rationale: 'Infrastructure or release-engineering surfaces define the repo.',
      signals,
    };
  }

  if (isMobile) {
    signals.push('mobile stack signals');
    return {
      key: 'mobile-app',
      label: 'Mobile application',
      rationale: 'Mobile-native directories or stacks define the repo.',
      signals,
    };
  }

  if (isMl) {
    signals.push('data / ML workflow signals');
    return {
      key: 'data-ml-system',
      label: 'Data / AI system',
      rationale: 'Pipelines, experiments, or model workflows are central.',
      signals,
    };
  }

  if (isCli) {
    signals.push('CLI distribution surface');
    return {
      key: 'developer-tool',
      label: 'Developer tool',
      rationale: 'Command-line packaging or tool UX is part of the product contract.',
      signals,
    };
  }

  if (isLibrary) {
    signals.push('package export surface');
    return {
      key: 'library-sdk',
      label: 'Library / SDK',
      rationale: 'The repo behaves like a reusable package rather than a deployed application.',
      signals,
    };
  }

  if (hasFrontend && hasBackend) {
    signals.push('frontend signals', 'backend signals');
    return {
      key: 'fullstack-product',
      label: 'Full-stack product',
      rationale: 'UI and service layers coexist as one application surface.',
      signals,
    };
  }

  if (hasFrontend) {
    signals.push('frontend signals');
    return {
      key: 'frontend-product',
      label: 'Frontend product',
      rationale: 'UI and component workflows dominate the repo.',
      signals,
    };
  }

  if (hasBackend) {
    signals.push('backend signals');
    return {
      key: 'backend-service',
      label: 'Backend service',
      rationale: 'API or service workflows dominate the repo.',
      signals,
    };
  }

  return {
    key: 'general-codebase',
    label: 'General codebase',
    rationale: 'No stronger repo class dominates yet.',
    signals: [],
  };
}

function detectWorkflowTraits({ ctx, platform, assets, maturity, topology, domainKeys, recommendedMcpPacks = [] }) {
  const traits = [];
  const hasCi = ctx.hasDir('.github/workflows') || ctx.hasDir('.circleci') || Boolean(ctx.fileContent('.gitlab-ci.yml')) || Boolean(ctx.fileContent('Jenkinsfile'));
  const hasMcp = (assets && assets.counts && assets.counts.mcpServers > 0) || (recommendedMcpPacks || []).length > 0;
  const hasGovernanceSignals = domainKeys.has('enterprise-governed') || domainKeys.has('regulated-lite') || domainKeys.has('security-focused');

  if (hasGovernanceSignals && hasCi) {
    traits.push({
      key: 'governed-rollout',
      label: 'Governed rollout',
      rationale: 'CI plus governance/regulatory signals suggest reviewable rollout discipline.',
      signals: unique([
        domainKeys.has('enterprise-governed') ? 'enterprise-governed pack' : null,
        domainKeys.has('regulated-lite') ? 'regulated-lite pack' : null,
        domainKeys.has('security-focused') ? 'security-focused pack' : null,
        hasCi ? 'CI workflows' : null,
      ]),
    });
  }

  if (topology.key === 'monorepo') {
    traits.push({
      key: 'workspace-coordinated',
      label: 'Workspace-coordinated',
      rationale: 'The repo needs path-aware and package-aware workflow coordination.',
      signals: ['workspace topology'],
    });
  }

  if (hasCi) {
    traits.push({
      key: 'ci-driven',
      label: 'CI-driven',
      rationale: 'Automated CI surfaces are part of the normal engineering loop.',
      signals: ['CI workflows'],
    });
  }

  if (hasMcp) {
    traits.push({
      key: 'tool-enriched',
      label: 'Tool-enriched',
      rationale: 'Live MCP or external-context tooling is part of the intended workflow.',
      signals: unique([
        assets && assets.counts && assets.counts.mcpServers > 0 ? 'declared MCP servers' : null,
        recommendedMcpPacks.length > 0 ? 'recommended MCP packs' : null,
      ]),
    });
  }

  if (maturity === 'mature' || maturity === 'developing') {
    traits.push({
      key: 'managed',
      label: 'Managed baseline',
      rationale: 'The repo already has enough governance assets that Nerviq should extend, not replace, the current baseline.',
      signals: [humanizeMaturity(maturity)],
    });
  }

  if (traits.length === 0) {
    traits.push({
      key: 'bootstrap-local',
      label: 'Bootstrap local workflow',
      rationale: 'The repo still looks early-stage and should start from a simple local baseline.',
      signals: [humanizeMaturity(maturity)],
    });
  }

  return traits;
}

function detectRiskProfile({ ctx, platform, assets, domainKeys, maturity }) {
  const reasons = [];

  if (domainKeys.has('regulated-lite')) reasons.push('regulated-lite pack');
  if (domainKeys.has('security-focused')) reasons.push('security-focused pack');
  if (ctx.files.includes('SECURITY.md')) reasons.push('SECURITY.md');
  if (ctx.files.includes('COMPLIANCE.md') || ctx.hasDir('compliance') || ctx.hasDir('policies')) reasons.push('compliance surface');

  if (platform === 'codex' && assets && assets.trust) {
    if (assets.trust.approvalPolicy === 'never') reasons.push('approval_policy=never');
    if (assets.trust.sandboxMode === 'danger-full-access') reasons.push('sandbox_mode=danger-full-access');
  }

  if (platform !== 'codex' && assets && assets.permissions) {
    if (assets.permissions.defaultMode === 'bypassPermissions') reasons.push('bypassPermissions');
    if (!assets.permissions.hasDenyRules) reasons.push('missing deny rules');
  }

  if (domainKeys.has('enterprise-governed')) reasons.push('enterprise-governed pack');

  let key = 'standard';
  let label = 'Standard';
  let level = 'medium';
  let rationale = 'No strong regulatory or unusually permissive-risk posture dominates the repo.';

  if (reasons.some((reason) => /regulated|compliance|SECURITY|security-focused/i.test(reason))) {
    key = 'regulated';
    label = 'Regulated / security-sensitive';
    level = 'high';
    rationale = 'Compliance or security-sensitive signals mean recommendations should skew toward traceability and review.';
  } else if (reasons.some((reason) => /bypassPermissions|danger-full-access|approval_policy=never/i.test(reason))) {
    key = 'elevated';
    label = 'Elevated operational risk';
    level = 'high';
    rationale = 'The repo is configured with permissive runtime posture that increases blast radius.';
  } else if (maturity === 'none' || maturity === 'starter') {
    key = 'bootstrap';
    label = 'Bootstrap risk';
    level = 'medium';
    rationale = 'The main risk is missing baseline governance, not over-permissive automation.';
  }

  return {
    key,
    label,
    level,
    rationale,
    reasons: unique(reasons),
  };
}

function buildRepoArchetypeProfile(options) {
  const {
    ctx,
    platform,
    stacks = [],
    assets,
    recommendedDomainPacks = [],
    recommendedMcpPacks = [],
    maturity = 'none',
  } = options || {};

  const pkg = ctx && typeof ctx.jsonFile === 'function' ? (ctx.jsonFile('package.json') || {}) : {};
  const stackKeys = new Set((stacks || []).map((stack) => stack.key));
  const domainKeys = new Set((recommendedDomainPacks || []).map((pack) => pack.key));

  const topology = detectTopology(ctx, pkg);
  const stackFamily = detectStackFamily(stackKeys, domainKeys, ctx);
  const repoClass = detectRepoClass({ ctx, pkg, domainKeys, stackKeys, topology });
  const workflowTraits = detectWorkflowTraits({ ctx, platform, assets, maturity, topology, domainKeys, recommendedMcpPacks });
  const primaryWorkflow = workflowTraits[0];
  const riskProfile = detectRiskProfile({ ctx, platform, assets, domainKeys, maturity });
  const signals = unique([
    stackFamily.label,
    ...topology.signals,
    ...repoClass.signals,
    ...workflowTraits.flatMap((trait) => trait.signals || []),
    ...riskProfile.reasons,
    ...recommendedDomainPacks.slice(0, 3).map((pack) => pack.key),
  ]);

  const confidence = signals.length >= 6 ? 'high' : signals.length >= 3 ? 'medium' : 'low';

  return {
    key: `${topology.key}:${repoClass.key}`,
    label: repoClass.label,
    summary: `${repoClass.label} with ${topology.label.toLowerCase()} topology, ${primaryWorkflow.label.toLowerCase()} workflow, and ${riskProfile.label.toLowerCase()} posture.`,
    confidence,
    stackFamily,
    topology,
    maturity: {
      key: maturity,
      label: humanizeMaturity(maturity),
    },
    repoClass,
    primaryWorkflow,
    workflowTraits,
    riskProfile,
    signals: signals.slice(0, 8),
  };
}

module.exports = {
  buildRepoArchetypeProfile,
};
