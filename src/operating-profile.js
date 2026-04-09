'use strict';

const { detectPlatforms } = require('./public-api');
const { PERMISSION_PROFILES, HOOK_REGISTRY, POLICY_PACKS } = require('./governance');

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function getProfile(key) {
  return PERMISSION_PROFILES.find((profile) => profile.key === key) || PERMISSION_PROFILES[0];
}

function getPolicyPack(key) {
  return POLICY_PACKS.find((pack) => pack.key === key) || POLICY_PACKS[0];
}

function getHook(key) {
  return HOOK_REGISTRY.find((hook) => hook.key === key);
}

function buildEvidence(repoArchetype, recommendedDomainPacks = [], extras = []) {
  const packLabels = (recommendedDomainPacks || []).map((pack) => pack.label).slice(0, 2);
  return unique([
    `Archetype: ${repoArchetype.label}`,
    `Workflow: ${repoArchetype.primaryWorkflow.label}`,
    `Risk: ${repoArchetype.riskProfile.label}`,
    packLabels.length > 0 ? `Domain packs: ${packLabels.join(', ')}` : null,
    ...(repoArchetype.signals || []).slice(0, 2),
    ...extras,
  ]).slice(0, 5);
}

function withExplainability(base, repoArchetype, recommendedDomainPacks, options = {}) {
  const {
    evidence = [],
    prerequisites = [],
    expectedBenefit = '',
    rollbackSafety = '',
  } = options;

  return {
    ...base,
    why: base.rationale,
    evidence: buildEvidence(repoArchetype, recommendedDomainPacks, evidence),
    prerequisites: unique(prerequisites),
    expectedBenefit,
    rollbackSafety,
  };
}

function buildDomainInfluence(repoArchetype, recommendedDomainPacks = [], recommendedMcpPacks = []) {
  const keys = new Set((recommendedDomainPacks || []).map((pack) => pack.key));
  const reasons = [];
  const extraHooks = [];
  let permissionOverride = null;
  let governancePackOverride = null;
  let verificationBias = null;
  let ciShapeOverride = null;

  if (keys.has('security-focused') || keys.has('regulated-lite')) {
    permissionOverride = 'suggest-only';
    governancePackOverride = 'regulated-lite';
    reasons.push('Security-focused or regulated domain signals push the repo toward review-first posture.');
  }

  if (keys.has('enterprise-governed')) {
    permissionOverride = 'suggest-only';
    governancePackOverride = governancePackOverride || 'security-sensitive';
    ciShapeOverride = 'governed-pr-gate';
    extraHooks.push('trust-drift-check');
    reasons.push('Enterprise-governed domain signals favor approvals, traceability, and trust-drift checks.');
  }

  if (keys.has('infra-platform') || keys.has('devops-cicd')) {
    governancePackOverride = governancePackOverride || 'security-sensitive';
    verificationBias = 'infra';
    ciShapeOverride = ciShapeOverride || 'governed-pr-gate';
    extraHooks.push('trust-drift-check');
    reasons.push('Infra / CI domain signals increase the value of plan-first rollout and trust-drift validation.');
  }

  if (keys.has('ai-ml') || keys.has('data-pipeline')) {
    verificationBias = 'pipeline';
    reasons.push('Pipeline-oriented domains need repeatable verification and state-aware review loops.');
  }

  if (keys.has('mobile')) {
    verificationBias = 'mobile';
    reasons.push('Mobile domain signals shift the recommended loop toward analyze + build verification.');
  }

  if (keys.has('oss-library') || keys.has('docs-content')) {
    permissionOverride = permissionOverride || 'suggest-only';
    governancePackOverride = governancePackOverride || 'oss-friendly';
    reasons.push('Contributor-sensitive or docs-heavy repos benefit from lighter review-first governance.');
  }

  if (keys.has('monorepo')) {
    ciShapeOverride = 'workspace-pr-gate';
    extraHooks.push('trust-drift-check');
    reasons.push('Monorepo domain signals reinforce workspace-aware CI and drift checks.');
  }

  if (keys.has('ecommerce')) {
    extraHooks.push('protect-secrets');
    reasons.push('Commerce and payment surfaces justify extra secret-handling discipline.');
  }

  if ((recommendedMcpPacks || []).length >= 3) {
    extraHooks.push('injection-defense');
    reasons.push('Multi-MCP posture increases the value of trust-boundary hooks.');
  }

  if (repoArchetype.repoClass.key === 'mobile-app' && !verificationBias) {
    verificationBias = 'mobile';
  }

  return {
    keys,
    reasons,
    extraHooks: unique(extraHooks),
    permissionOverride,
    governancePackOverride,
    verificationBias,
    ciShapeOverride,
  };
}

function recommendPlatformSupport(dir, platform, repoArchetype, recommendedDomainPacks = []) {
  const current = detectPlatforms(dir);
  const primary = current.length > 0 ? current[0] : platform;
  const recommended = current.length > 0 ? current : [platform];
  let strategy = 'single-platform-baseline';
  let rationale = 'Start from one governed primary platform before widening the surface area.';
  let optionalExpansion = null;

  if (recommended.length >= 2) {
    strategy = 'harmonize-current-platforms';
    rationale = 'Multiple AI platforms are already active, so the main priority is keeping them aligned instead of adding more.';
  } else if (repoArchetype.topology.key === 'monorepo' || repoArchetype.primaryWorkflow.key === 'governed-rollout' || repoArchetype.riskProfile.key === 'regulated') {
    strategy = 'primary-plus-review-surface';
    rationale = 'This repo benefits from one primary surface plus one secondary advisory/review surface once the baseline is stable.';
    optionalExpansion = primary === 'codex' ? 'claude' : 'codex';
  }

  const base = {
    current,
    primary,
    recommended,
    strategy,
    rationale,
    optionalExpansion,
  };

  return withExplainability(base, repoArchetype, recommendedDomainPacks, {
    evidence: [
      current.length > 0 ? `Detected platforms: ${current.join(', ')}` : `No existing platform config found; defaulting to ${platform}`,
    ],
    prerequisites: current.length >= 2
      ? ['Keep Harmony aligned before adding another platform surface.']
      : ['Stabilize the primary platform baseline before widening the tool surface.'],
    expectedBenefit: current.length >= 2
      ? 'Keeps active AI surfaces aligned so governance and review flows do not drift apart.'
      : 'Reduces setup sprawl by making one platform posture explicit before adding more.',
    rollbackSafety: 'Platform strategy is advisory only. You can stay on the current primary surface or revert secondary additions without touching source code.',
  });
}

function recommendPermissionProfile(repoArchetype, recommendedDomainPacks, domainInfluence) {
  if (repoArchetype.riskProfile.key === 'elevated') {
    return withExplainability({
      profile: getProfile('read-only'),
      rationale: 'Permissive runtime posture should be brought back under review before Nerviq writes into the repo.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: ['Elevated-risk posture detected from repo signals.'].concat(domainInfluence.reasons),
      prerequisites: ['Confirm discovery-only mode is acceptable for the next improvement pass.'],
      expectedBenefit: 'Prevents Nerviq from modifying the repo while the trust boundary is still unclear.',
      rollbackSafety: 'Switching back to a writable profile is a config-only change once the repo posture is explicit.',
    });
  }

  if (domainInfluence.permissionOverride) {
    const profile = getProfile(domainInfluence.permissionOverride);
    return withExplainability({
      profile,
      rationale: `Domain signals make ${profile.label.toLowerCase()} the safest recommended baseline for this repo.`,
    }, repoArchetype, recommendedDomainPacks, {
      evidence: domainInfluence.reasons,
      prerequisites: ['Keep proposal/export flows reviewable while adopting the recommended posture.'],
      expectedBenefit: 'Aligns repo writes and review expectations to the domain risk and contributor model.',
      rollbackSafety: 'Permission profiles are declarative. Move back to another profile once the repo proves it can support faster writes safely.',
    });
  }

  if (repoArchetype.riskProfile.key === 'regulated' || repoArchetype.primaryWorkflow.key === 'governed-rollout') {
    return withExplainability({
      profile: getProfile('suggest-only'),
      rationale: 'Governed or security-sensitive repos should begin from proposal/export flows instead of direct writes.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: ['Governed rollout or regulated posture detected.'],
      prerequisites: ['Use plan/export artifacts for any write-bearing rollout.'],
      expectedBenefit: 'Creates a reviewable path to adoption without blocking analysis and planning.',
      rollbackSafety: 'Profiles can be relaxed later without changing repo files.',
    });
  }

  if (repoArchetype.maturity.key === 'none' || repoArchetype.maturity.key === 'starter') {
    return withExplainability({
      profile: getProfile('safe-write'),
      rationale: 'Bootstrap repos need a writable baseline, but still with visible rollback and no overwrites.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: ['Repo maturity is starter-level or missing governed assets.'],
      prerequisites: ['Keep rollback artifacts enabled before broader apply flows.'],
      expectedBenefit: 'Lets Nerviq establish a baseline quickly without flattening existing work.',
      rollbackSafety: 'Safe-write preserves existing files and keeps rollback artifacts for removals.',
    });
  }

  if (repoArchetype.repoClass.key === 'library-sdk' || repoArchetype.stackFamily.key === 'docs') {
    return withExplainability({
      profile: getProfile('suggest-only'),
      rationale: 'Contributor-sensitive or docs-heavy repos benefit from review-first proposal flows.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: ['Library or docs-oriented repo class detected.'],
      prerequisites: ['Use human review as the merge gate for generated changes.'],
      expectedBenefit: 'Protects external contributors from unexpected automation while keeping Nerviq useful.',
      rollbackSafety: 'No direct writes are implied, so there is nothing operational to roll back.',
    });
  }

  if (repoArchetype.repoClass.key === 'developer-tool' && repoArchetype.maturity.key === 'mature') {
    return withExplainability({
      profile: getProfile('power-user'),
      rationale: 'Mature developer tooling repos can tolerate faster iteration once the baseline is already explicit.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: ['Mature developer-tool repo detected.'],
      prerequisites: ['Keep trust settings, hooks, and rollback flows explicit before widening autonomy.'],
      expectedBenefit: 'Speeds iteration for maintainers who already have a stable governed baseline.',
      rollbackSafety: 'Move back to safe-write or suggest-only if the broader autonomy level proves noisy.',
    });
  }

  return withExplainability({
    profile: getProfile('safe-write'),
    rationale: 'A safe writable baseline is the default operating posture for product repos after first contact.',
  }, repoArchetype, recommendedDomainPacks, {
    evidence: domainInfluence.reasons,
    prerequisites: ['Keep visible rollback and plan export available for non-trivial changes.'],
    expectedBenefit: 'Lets the repo move from advisory mode into real guided setup work without bypassing guardrails.',
    rollbackSafety: 'Safe-write avoids overwriting existing assets and keeps rollback visible.',
  });
}

function recommendGovernancePack(repoArchetype, recommendedDomainPacks, domainInfluence) {
  if (domainInfluence.governancePackOverride) {
    const pack = getPolicyPack(domainInfluence.governancePackOverride);
    return withExplainability({
      pack,
      rationale: `Domain signals make ${pack.label.toLowerCase()} the best governance baseline for this repo.`,
    }, repoArchetype, recommendedDomainPacks, {
      evidence: domainInfluence.reasons,
      prerequisites: ['Apply the pack after confirming the repo owner agrees with the rollout style.'],
      expectedBenefit: 'Narrows Nerviq to the modules and rollout posture that fit this repo instead of generic defaults.',
      rollbackSafety: 'Policy packs are compositional. You can step back to a lighter pack without rewriting application code.',
    });
  }

  if (repoArchetype.riskProfile.key === 'regulated') {
    return withExplainability({
      pack: getPolicyPack('regulated-lite'),
      rationale: 'This repo needs auditable rollout defaults more than raw automation breadth.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: ['Regulated risk posture detected.'],
      prerequisites: ['Keep activity artifacts and rollback manifests in the rollout path.'],
      expectedBenefit: 'Adds auditability without requiring a full enterprise control plane from day one.',
      rollbackSafety: 'The pack changes the recommended rollout modules, not the application architecture.',
    });
  }

  if (repoArchetype.repoClass.key === 'library-sdk' || repoArchetype.stackFamily.key === 'docs') {
    return withExplainability({
      pack: getPolicyPack('oss-friendly'),
      rationale: 'Lower-footprint governance keeps contributor workflows reviewable without overfitting the repo.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: ['Contributor-sensitive or docs-oriented repo detected.'],
      prerequisites: ['Keep merge review human-owned for external-facing changes.'],
      expectedBenefit: 'Preserves contributor friendliness while still making AI posture explicit.',
      rollbackSafety: 'Reverting to baseline-engineering is a pack-level config change.',
    });
  }

  if (repoArchetype.primaryWorkflow.key === 'governed-rollout') {
    return withExplainability({
      pack: getPolicyPack('security-sensitive'),
      rationale: 'The workflow already points toward approvals, hooks, and reviewable rollout discipline.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: ['Governed rollout workflow detected.'],
      prerequisites: ['Confirm approvals and pre-merge review are real team behaviors, not just intent.'],
      expectedBenefit: 'Matches governance modules to the way the repo is already being operated.',
      rollbackSafety: 'You can drop back to baseline-engineering if the workflow proves lighter in practice.',
    });
  }

  return withExplainability({
    pack: getPolicyPack('baseline-engineering'),
    rationale: 'A pragmatic engineering baseline is the best starting point for this repo shape.',
  }, repoArchetype, recommendedDomainPacks, {
    evidence: domainInfluence.reasons,
    prerequisites: ['Confirm the repo wants a practical default before enabling domain-specific packs.'],
    expectedBenefit: 'Provides a stable baseline without forcing heavier governance where it is not justified.',
    rollbackSafety: 'Baseline packs are additive and can be swapped without touching product code.',
  });
}

function recommendHooks(repoArchetype, recommendedDomainPacks, domainInfluence) {
  const keys = ['protect-secrets', 'log-changes', 'session-init'];

  if (repoArchetype.stackFamily.key !== 'docs') {
    keys.push('on-edit-lint');
  }
  if (repoArchetype.workflowTraits.some((trait) => trait.key === 'tool-enriched')) {
    keys.push('injection-defense');
  }
  if (repoArchetype.primaryWorkflow.key === 'governed-rollout' || repoArchetype.topology.key === 'monorepo') {
    keys.push('trust-drift-check');
  }
  keys.push(...domainInfluence.extraHooks);

  return unique(keys)
    .map((key) => getHook(key))
    .filter(Boolean)
    .map((hook) => ({
      key: hook.key,
      label: hook.file,
      triggerPoint: hook.triggerPoint,
      matcher: hook.matcher || null,
      risk: hook.risk,
      rationale: hook.purpose,
      why: hook.purpose,
      evidence: buildEvidence(repoArchetype, recommendedDomainPacks, [
        hook.matcher ? `Trigger matcher: ${hook.matcher}` : `Trigger point: ${hook.triggerPoint}`,
      ].concat(domainInfluence.reasons)),
      prerequisites: unique([
        hook.triggerPoint === 'PostToolUse' ? 'Confirm the repo has the runtime/tooling needed for the hook script.' : null,
        hook.triggerPoint === 'PreToolUse' ? 'Review the block rules before enabling the hook in a shared repo.' : null,
        'Validate hook runtime health with `nerviq doctor` after registration.',
      ]),
      expectedBenefit: hook.purpose,
      rollbackSafety: hook.rollbackPath,
    }));
}

function recommendVerificationProfile(repoArchetype, recommendedDomainPacks, domainInfluence) {
  const bias = domainInfluence.verificationBias || repoArchetype.stackFamily.key;

  if (bias === 'mobile') {
    return withExplainability({
      key: 'mobile-release-loop',
      label: 'Mobile release loop',
      required: ['test', 'lint/analyze', 'build'],
      optional: ['security-review'],
      rationale: 'Mobile repos need correctness, platform analysis, and build verification before rollout.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: domainInfluence.reasons,
      prerequisites: ['Document the concrete mobile test/analyze/build commands in repo instructions.'],
      expectedBenefit: 'Catches platform-specific regressions before they turn into emulator or release surprises.',
      rollbackSafety: 'Verification guidance is advisory and can be narrowed if the repo later proves lighter-weight.',
    });
  }

  if (bias === 'infra') {
    return withExplainability({
      key: 'infra-change-loop',
      label: 'Infra change loop',
      required: ['lint', 'validate/plan', 'build'],
      optional: ['security-review'],
      rationale: 'Infrastructure repos need validation and dry-run style checks before operational changes land.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: domainInfluence.reasons,
      prerequisites: ['Document validate/plan commands before enabling wider apply flows.'],
      expectedBenefit: 'Shifts repo changes toward plan-first rollout and catches operational blast radius earlier.',
      rollbackSafety: 'Verification loops can be narrowed later without undoing generated config.',
    });
  }

  if (repoArchetype.stackFamily.key === 'docs') {
    return withExplainability({
      key: 'content-publish-loop',
      label: 'Content publish loop',
      required: ['build', 'link/content checks'],
      optional: ['lint'],
      rationale: 'Docs/content repos need publish safety more than heavy runtime verification.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: ['Docs / content stack family detected.'],
      prerequisites: ['Make the publish/build command explicit in repo instructions.'],
      expectedBenefit: 'Keeps content repos fast while still protecting against broken docs deploys.',
      rollbackSafety: 'This is guidance only; adding or removing checks does not mutate the repo automatically.',
    });
  }

  if (bias === 'pipeline' || repoArchetype.stackFamily.key === 'data-ml') {
    return withExplainability({
      key: 'pipeline-verification-loop',
      label: 'Pipeline verification loop',
      required: ['test', 'lint', 'build'],
      optional: ['security-review', 'data/pipeline smoke check'],
      rationale: 'Data and ML repos still need code verification, but often also benefit from pipeline sanity checks.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: domainInfluence.reasons,
      prerequisites: ['Define at least one lightweight pipeline smoke check if the repo owns jobs or model flows.'],
      expectedBenefit: 'Protects repo correctness and catches broken pipeline assumptions before rollout.',
      rollbackSafety: 'Pipeline smoke checks are additive and can be disabled without impacting baseline code generation.',
    });
  }

  return withExplainability({
    key: 'application-verification-loop',
    label: 'Application verification loop',
    required: ['test', 'lint', 'build'],
    optional: repoArchetype.riskProfile.key === 'regulated' ? ['security-review'] : [],
    rationale: 'Product repos should default to explicit test, lint, and build loops before completion.',
  }, repoArchetype, recommendedDomainPacks, {
    evidence: domainInfluence.reasons,
    prerequisites: ['Document repo-specific test/lint/build commands if they are not already explicit.'],
    expectedBenefit: 'Creates a predictable verification floor for day-to-day AI-assisted edits.',
    rollbackSafety: 'Verification recommendations can be tuned over time without reworking repo structure.',
  });
}

function recommendCiShape(repoArchetype, recommendedDomainPacks, domainInfluence) {
  const ciBias = domainInfluence.ciShapeOverride;

  if (repoArchetype.topology.key === 'monorepo' || ciBias === 'workspace-pr-gate') {
    return withExplainability({
      key: 'workspace-pr-gate',
      label: 'Workspace-aware PR gate',
      steps: [
        'Run `nerviq audit --diff-only` in PRs for changed-file governance feedback',
        'Run workspace-aware audits for touched packages before merge',
        'Save tagged full snapshots on baseline and release checkpoints',
      ],
      rationale: 'Monorepos need scoped PR checks plus periodic full-root evidence.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: ['Monorepo or workspace-oriented domain signals detected.'].concat(domainInfluence.reasons),
      prerequisites: ['Adopt workspace-aware audit coverage before relying on per-package score semantics.'],
      expectedBenefit: 'Keeps package-local drift visible without losing root governance posture.',
      rollbackSafety: 'CI shape is an operating recommendation; you can revert to a simpler gate without touching product code.',
    });
  }

  if (repoArchetype.primaryWorkflow.key === 'governed-rollout' || repoArchetype.riskProfile.key === 'regulated' || ciBias === 'governed-pr-gate') {
    return withExplainability({
      key: 'governed-pr-gate',
      label: 'Governed PR gate',
      steps: [
        'Run `nerviq audit --diff-only` on PRs',
        'Run a full `nerviq audit --threshold` check before merge or release',
        'Use tagged snapshots (`baseline`, `post-fix`, `pre-release`) for traceable history',
      ],
      rationale: 'Governed repos need PR feedback plus full-posture evidence before risky changes are accepted.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: domainInfluence.reasons,
      prerequisites: ['Make baseline and release snapshot milestones part of the merge process.'],
      expectedBenefit: 'Turns Nerviq into a repeatable part of repo governance instead of a one-off setup step.',
      rollbackSafety: 'CI shape is policy-level guidance and can be dialed back if the repo does not need full governed gates.',
    });
  }

  if (repoArchetype.maturity.key === 'none' || repoArchetype.maturity.key === 'starter') {
    return withExplainability({
      key: 'bootstrap-ci',
      label: 'Bootstrap CI baseline',
      steps: [
        'Start with a full `nerviq audit` on the default branch',
        'Introduce `--diff-only` PR checks once the repo has a stable baseline',
        'Capture a named baseline snapshot before broad apply flows',
      ],
      rationale: 'Early-stage repos need one stable baseline before diff-aware automation becomes meaningful.',
    }, repoArchetype, recommendedDomainPacks, {
      evidence: ['Starter or missing managed baseline detected.'],
      prerequisites: ['Capture the first clean baseline snapshot before diff-only enforcement.'],
      expectedBenefit: 'Avoids noisy CI by introducing governance incrementally instead of all at once.',
      rollbackSafety: 'Bootstrap CI is intentionally minimal and can graduate into stronger gates later.',
    });
  }

  return withExplainability({
    key: 'standard-pr-gate',
    label: 'Standard PR gate',
    steps: [
      'Use `nerviq audit --diff-only` for PR-level feedback',
      'Run periodic full audits to keep score semantics grounded in live repo state',
      'Capture tagged snapshots around major fixes or releases',
    ],
    rationale: 'The repo is ready for regular diff-aware checks plus scheduled full-posture verification.',
  }, repoArchetype, recommendedDomainPacks, {
    evidence: domainInfluence.reasons,
    prerequisites: ['Keep periodic full audits scheduled so diff-only checks stay grounded.'],
    expectedBenefit: 'Makes Nerviq part of the normal PR loop without requiring heavy governed rollout overhead.',
    rollbackSafety: 'This operating mode can be tightened or relaxed as team habits change.',
  });
}

function buildOperatingProfile(options) {
  const {
    dir,
    platform,
    repoArchetype,
    recommendedDomainPacks = [],
    recommendedMcpPacks = [],
  } = options || {};

  const domainInfluence = buildDomainInfluence(repoArchetype, recommendedDomainPacks, recommendedMcpPacks);
  const platformSupport = recommendPlatformSupport(dir, platform, repoArchetype, recommendedDomainPacks);
  const permission = recommendPermissionProfile(repoArchetype, recommendedDomainPacks, domainInfluence);
  const governancePack = recommendGovernancePack(repoArchetype, recommendedDomainPacks, domainInfluence);
  const hooks = recommendHooks(repoArchetype, recommendedDomainPacks, domainInfluence);
  const verification = recommendVerificationProfile(repoArchetype, recommendedDomainPacks, domainInfluence);
  const ciShape = recommendCiShape(repoArchetype, recommendedDomainPacks, domainInfluence);

  const snapshotTags = repoArchetype.primaryWorkflow.key === 'governed-rollout'
    ? ['baseline', 'post-fix', 'pre-release']
    : ['baseline', 'post-fix'];

  return {
    key: `${repoArchetype.key}:${permission.profile.key}`,
    label: `${repoArchetype.label} operating profile`,
    summary: `Recommended posture: ${permission.profile.label}, ${ciShape.label.toLowerCase()}, and ${hooks.length} starter hooks for a ${repoArchetype.label.toLowerCase()}.`,
    platformSupport,
    permissionProfile: {
      key: permission.profile.key,
      label: permission.profile.label,
      risk: permission.profile.risk,
      rationale: permission.rationale,
      why: permission.why,
      evidence: permission.evidence,
      prerequisites: permission.prerequisites,
      expectedBenefit: permission.expectedBenefit,
      rollbackSafety: permission.rollbackSafety,
    },
    governancePack: {
      key: governancePack.pack.key,
      label: governancePack.pack.label,
      modules: governancePack.pack.modules,
      rationale: governancePack.rationale,
      why: governancePack.why,
      evidence: governancePack.evidence,
      prerequisites: governancePack.prerequisites,
      expectedBenefit: governancePack.expectedBenefit,
      rollbackSafety: governancePack.rollbackSafety,
    },
    hooks,
    verification,
    ciShape,
    governanceDefaults: {
      benchmarkBeforeApply: repoArchetype.riskProfile.key === 'regulated' || repoArchetype.maturity.key === 'mature',
      exportPlanBeforeWrites: permission.profile.key !== 'safe-write' || repoArchetype.maturity.key !== 'none',
      useDiffOnlyInPrs: ciShape.key !== 'bootstrap-ci',
      harmonizePlatforms: platformSupport.current.length >= 2,
      snapshotTags,
      recommendedDomainPacks: recommendedDomainPacks.map((pack) => pack.key),
      recommendedMcpPacks: recommendedMcpPacks.map((pack) => pack.key),
    },
    domainInfluence: {
      keys: [...domainInfluence.keys],
      reasons: domainInfluence.reasons,
    },
  };
}

module.exports = {
  buildOperatingProfile,
};
