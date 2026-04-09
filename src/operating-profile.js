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

function recommendPlatformSupport(dir, platform, repoArchetype) {
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

  return {
    current,
    primary,
    recommended,
    strategy,
    rationale,
    optionalExpansion,
  };
}

function recommendPermissionProfile(repoArchetype) {
  if (repoArchetype.riskProfile.key === 'elevated') {
    return {
      profile: getProfile('read-only'),
      rationale: 'Permissive runtime posture should be brought back under review before Nerviq writes into the repo.',
    };
  }

  if (repoArchetype.riskProfile.key === 'regulated' || repoArchetype.primaryWorkflow.key === 'governed-rollout') {
    return {
      profile: getProfile('suggest-only'),
      rationale: 'Governed or security-sensitive repos should begin from proposal/export flows instead of direct writes.',
    };
  }

  if (repoArchetype.maturity.key === 'none' || repoArchetype.maturity.key === 'starter') {
    return {
      profile: getProfile('safe-write'),
      rationale: 'Bootstrap repos need a writable baseline, but still with visible rollback and no overwrites.',
    };
  }

  if (repoArchetype.repoClass.key === 'library-sdk' || repoArchetype.stackFamily.key === 'docs') {
    return {
      profile: getProfile('suggest-only'),
      rationale: 'Contributor-sensitive or docs-heavy repos benefit from review-first proposal flows.',
    };
  }

  if (repoArchetype.repoClass.key === 'developer-tool' && repoArchetype.maturity.key === 'mature') {
    return {
      profile: getProfile('power-user'),
      rationale: 'Mature developer tooling repos can tolerate faster iteration once the baseline is already explicit.',
    };
  }

  return {
    profile: getProfile('safe-write'),
    rationale: 'A safe writable baseline is the default operating posture for product repos after first contact.',
  };
}

function recommendGovernancePack(repoArchetype) {
  if (repoArchetype.riskProfile.key === 'regulated') {
    return {
      pack: getPolicyPack('regulated-lite'),
      rationale: 'This repo needs auditable rollout defaults more than raw automation breadth.',
    };
  }

  if (repoArchetype.repoClass.key === 'library-sdk' || repoArchetype.stackFamily.key === 'docs') {
    return {
      pack: getPolicyPack('oss-friendly'),
      rationale: 'Lower-footprint governance keeps contributor workflows reviewable without overfitting the repo.',
    };
  }

  if (repoArchetype.primaryWorkflow.key === 'governed-rollout') {
    return {
      pack: getPolicyPack('security-sensitive'),
      rationale: 'The workflow already points toward approvals, hooks, and reviewable rollout discipline.',
    };
  }

  return {
    pack: getPolicyPack('baseline-engineering'),
    rationale: 'A pragmatic engineering baseline is the best starting point for this repo shape.',
  };
}

function recommendHooks(repoArchetype) {
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
    }));
}

function recommendVerificationProfile(repoArchetype) {
  if (repoArchetype.stackFamily.key === 'mobile') {
    return {
      key: 'mobile-release-loop',
      label: 'Mobile release loop',
      required: ['test', 'lint/analyze', 'build'],
      optional: ['security-review'],
      rationale: 'Mobile repos need correctness, platform analysis, and build verification before rollout.',
    };
  }

  if (repoArchetype.stackFamily.key === 'infra') {
    return {
      key: 'infra-change-loop',
      label: 'Infra change loop',
      required: ['lint', 'validate/plan', 'build'],
      optional: ['security-review'],
      rationale: 'Infrastructure repos need validation and dry-run style checks before operational changes land.',
    };
  }

  if (repoArchetype.stackFamily.key === 'docs') {
    return {
      key: 'content-publish-loop',
      label: 'Content publish loop',
      required: ['build', 'link/content checks'],
      optional: ['lint'],
      rationale: 'Docs/content repos need publish safety more than heavy runtime verification.',
    };
  }

  if (repoArchetype.stackFamily.key === 'data-ml') {
    return {
      key: 'pipeline-verification-loop',
      label: 'Pipeline verification loop',
      required: ['test', 'lint', 'build'],
      optional: ['security-review', 'data/pipeline smoke check'],
      rationale: 'Data and ML repos still need code verification, but often also benefit from pipeline sanity checks.',
    };
  }

  return {
    key: 'application-verification-loop',
    label: 'Application verification loop',
    required: ['test', 'lint', 'build'],
    optional: repoArchetype.riskProfile.key === 'regulated' ? ['security-review'] : [],
    rationale: 'Product repos should default to explicit test, lint, and build loops before completion.',
  };
}

function recommendCiShape(repoArchetype) {
  if (repoArchetype.topology.key === 'monorepo') {
    return {
      key: 'workspace-pr-gate',
      label: 'Workspace-aware PR gate',
      steps: [
        'Run `nerviq audit --diff-only` in PRs for changed-file governance feedback',
        'Run workspace-aware audits for touched packages before merge',
        'Save tagged full snapshots on baseline and release checkpoints',
      ],
      rationale: 'Monorepos need scoped PR checks plus periodic full-root evidence.',
    };
  }

  if (repoArchetype.primaryWorkflow.key === 'governed-rollout' || repoArchetype.riskProfile.key === 'regulated') {
    return {
      key: 'governed-pr-gate',
      label: 'Governed PR gate',
      steps: [
        'Run `nerviq audit --diff-only` on PRs',
        'Run a full `nerviq audit --threshold` check before merge or release',
        'Use tagged snapshots (`baseline`, `post-fix`, `pre-release`) for traceable history',
      ],
      rationale: 'Governed repos need PR feedback plus full-posture evidence before risky changes are accepted.',
    };
  }

  if (repoArchetype.maturity.key === 'none' || repoArchetype.maturity.key === 'starter') {
    return {
      key: 'bootstrap-ci',
      label: 'Bootstrap CI baseline',
      steps: [
        'Start with a full `nerviq audit` on the default branch',
        'Introduce `--diff-only` PR checks once the repo has a stable baseline',
        'Capture a named baseline snapshot before broad apply flows',
      ],
      rationale: 'Early-stage repos need one stable baseline before diff-aware automation becomes meaningful.',
    };
  }

  return {
    key: 'standard-pr-gate',
    label: 'Standard PR gate',
    steps: [
      'Use `nerviq audit --diff-only` for PR-level feedback',
      'Run periodic full audits to keep score semantics grounded in live repo state',
      'Capture tagged snapshots around major fixes or releases',
    ],
    rationale: 'The repo is ready for regular diff-aware checks plus scheduled full-posture verification.',
  };
}

function buildOperatingProfile(options) {
  const {
    dir,
    platform,
    repoArchetype,
    recommendedDomainPacks = [],
    recommendedMcpPacks = [],
  } = options || {};

  const platformSupport = recommendPlatformSupport(dir, platform, repoArchetype);
  const permission = recommendPermissionProfile(repoArchetype);
  const governancePack = recommendGovernancePack(repoArchetype);
  const hooks = recommendHooks(repoArchetype);
  const verification = recommendVerificationProfile(repoArchetype);
  const ciShape = recommendCiShape(repoArchetype);

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
    },
    governancePack: {
      key: governancePack.pack.key,
      label: governancePack.pack.label,
      modules: governancePack.pack.modules,
      rationale: governancePack.rationale,
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
  };
}

module.exports = {
  buildOperatingProfile,
};
