'use strict';

const { getMcpPackPreflight } = require('./mcp-packs');

const DECISION_ORDER = { adopt: 0, defer: 1, ignore: 2 };

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function makeItem(item) {
  return {
    decision: item.decision,
    kind: item.kind,
    key: item.key,
    label: item.label,
    why: item.why,
    evidence: unique(item.evidence),
    prerequisites: unique(item.prerequisites),
    expectedBenefit: item.expectedBenefit,
    rollbackSafety: item.rollbackSafety,
  };
}

function summarize(items = []) {
  const counts = items.reduce((acc, item) => {
    acc[item.decision] = (acc[item.decision] || 0) + 1;
    return acc;
  }, { adopt: 0, defer: 0, ignore: 0 });

  return {
    adopt: counts.adopt || 0,
    defer: counts.defer || 0,
    ignore: counts.ignore || 0,
    label: `${counts.adopt || 0} adopt now / ${counts.defer || 0} defer / ${counts.ignore || 0} ignore`,
  };
}

function inferMcpPackPrerequisites(pack, preflightEntry) {
  const prerequisites = [];
  if (preflightEntry && Array.isArray(preflightEntry.missingEnvVars) && preflightEntry.missingEnvVars.length > 0) {
    prerequisites.push(`Provide required env vars: ${preflightEntry.missingEnvVars.join(', ')}`);
  }

  if (/Pass connection string as CLI argument/i.test(pack.adoption || '')) {
    prerequisites.push('Provide a live connection string or DATABASE_URL before enabling this MCP pack.');
  }

  if (/Docker running locally/i.test(pack.adoption || '')) {
    prerequisites.push('Docker must be running locally before this MCP pack is useful.');
  }

  if (/OAuth/i.test(pack.adoption || '')) {
    prerequisites.push('Complete the OAuth or external auth setup before enabling this MCP pack in shared flows.');
  }

  if (/community-maintained/i.test(pack.adoption || '')) {
    prerequisites.push('Review the package trust/update posture before enabling it in a wider team baseline.');
  }

  return unique(prerequisites);
}

function buildIgnoreItems(repoArchetype, operatingProfile, recommendedDomainPacks = []) {
  const items = [];
  const domainKeys = new Set((recommendedDomainPacks || []).map((pack) => pack.key));

  if (operatingProfile.platformSupport.strategy === 'single-platform-baseline') {
    items.push(makeItem({
      decision: 'ignore',
      kind: 'platform-expansion',
      key: 'broad-platform-expansion',
      label: 'Broad multi-platform expansion',
      why: 'This repo should stabilize one governed primary platform before adding more AI surfaces.',
      evidence: [
        `Platform strategy: ${operatingProfile.platformSupport.strategy}`,
        `Archetype: ${repoArchetype.label}`,
      ],
      prerequisites: [],
      expectedBenefit: 'Prevents governance drift caused by widening the tool surface too early.',
      rollbackSafety: 'Nothing is applied here; this is an intentional skip until the baseline matures.',
    }));
  }

  if (repoArchetype.topology.key !== 'monorepo') {
    items.push(makeItem({
      decision: 'ignore',
      kind: 'ci-shape',
      key: 'workspace-pr-gate',
      label: 'Workspace-aware PR gate',
      why: 'Workspace-specific CI complexity does not match a non-monorepo repo shape.',
      evidence: [
        `Topology: ${repoArchetype.topology.label}`,
        'No monorepo-specific governance surface is required.',
      ],
      prerequisites: [],
      expectedBenefit: 'Keeps the operating model lean and aligned to the real repo topology.',
      rollbackSafety: 'This is a deliberate skip; no cleanup is required.',
    }));
  }

  if (repoArchetype.riskProfile.key !== 'regulated' && !domainKeys.has('regulated-lite') && !domainKeys.has('security-focused')) {
    items.push(makeItem({
      decision: 'ignore',
      kind: 'governance-pack',
      key: 'regulated-lite',
      label: 'Regulated-lite governance overhead',
      why: 'The repo does not show regulated or security-heavy signals strong enough to justify this heavier rollout pack.',
      evidence: [
        `Risk posture: ${repoArchetype.riskProfile.label}`,
      ],
      prerequisites: [],
      expectedBenefit: 'Preserves a lighter rollout model and avoids over-governing normal product repos.',
      rollbackSafety: 'This is a no-op skip; the repo can adopt a heavier pack later if evidence changes.',
    }));
  }

  if (repoArchetype.stackFamily.key !== 'mobile' && !domainKeys.has('mobile')) {
    items.push(makeItem({
      decision: 'ignore',
      kind: 'verification',
      key: 'mobile-release-loop',
      label: 'Mobile release workflow extras',
      why: 'Mobile-only analyze/build workflow overhead should not be forced onto a non-mobile repo.',
      evidence: [
        `Stack family: ${repoArchetype.stackFamily.label}`,
      ],
      prerequisites: [],
      expectedBenefit: 'Avoids irrelevant workflow ceremony and keeps verification recommendations credible.',
      rollbackSafety: 'No rollback is needed because the capability is being intentionally skipped.',
    }));
  }

  return items.slice(0, 3);
}

function buildAdoptionAdvisor(options) {
  const {
    platform,
    repoArchetype,
    recommendedOperatingProfile,
    recommendedDomainPacks = [],
    recommendedMcpPacks = [],
    env = {},
  } = options || {};

  const items = [];
  const mcpPreflightByKey = new Map(
    getMcpPackPreflight((recommendedMcpPacks || []).map((pack) => pack.key), env).map((entry) => [entry.key, entry])
  );

  items.push(makeItem({
    decision: 'adopt',
    kind: 'platform-strategy',
    key: recommendedOperatingProfile.platformSupport.strategy,
    label: `Platform strategy: ${recommendedOperatingProfile.platformSupport.strategy}`,
    why: recommendedOperatingProfile.platformSupport.why,
    evidence: recommendedOperatingProfile.platformSupport.evidence,
    prerequisites: recommendedOperatingProfile.platformSupport.prerequisites,
    expectedBenefit: recommendedOperatingProfile.platformSupport.expectedBenefit,
    rollbackSafety: recommendedOperatingProfile.platformSupport.rollbackSafety,
  }));

  if (recommendedOperatingProfile.platformSupport.optionalExpansion) {
    items.push(makeItem({
      decision: 'defer',
      kind: 'platform-expansion',
      key: `secondary-${recommendedOperatingProfile.platformSupport.optionalExpansion}`,
      label: `Add ${recommendedOperatingProfile.platformSupport.optionalExpansion} as a secondary review surface`,
      why: 'A secondary platform could help later, but the repo should stabilize its primary governed posture first.',
      evidence: recommendedOperatingProfile.platformSupport.evidence,
      prerequisites: [
        'Capture tagged baseline and post-fix snapshots first.',
        'Keep Harmony stable across the currently active platform surface.',
      ],
      expectedBenefit: 'Adds a complementary advisory surface only after the core posture is already reliable.',
      rollbackSafety: 'Secondary platform expansion is optional and can be removed without changing the app codebase.',
    }));
  }

  items.push(makeItem({
    decision: 'adopt',
    kind: 'permission-profile',
    key: recommendedOperatingProfile.permissionProfile.key,
    label: `Permission profile: ${recommendedOperatingProfile.permissionProfile.label}`,
    why: recommendedOperatingProfile.permissionProfile.why,
    evidence: recommendedOperatingProfile.permissionProfile.evidence,
    prerequisites: recommendedOperatingProfile.permissionProfile.prerequisites,
    expectedBenefit: recommendedOperatingProfile.permissionProfile.expectedBenefit,
    rollbackSafety: recommendedOperatingProfile.permissionProfile.rollbackSafety,
  }));

  items.push(makeItem({
    decision: 'adopt',
    kind: 'governance-pack',
    key: recommendedOperatingProfile.governancePack.key,
    label: `Governance pack: ${recommendedOperatingProfile.governancePack.label}`,
    why: recommendedOperatingProfile.governancePack.why,
    evidence: recommendedOperatingProfile.governancePack.evidence,
    prerequisites: recommendedOperatingProfile.governancePack.prerequisites,
    expectedBenefit: recommendedOperatingProfile.governancePack.expectedBenefit,
    rollbackSafety: recommendedOperatingProfile.governancePack.rollbackSafety,
  }));

  items.push(makeItem({
    decision: 'adopt',
    kind: 'hook-set',
    key: 'starter-hooks',
    label: `Starter hook set: ${recommendedOperatingProfile.hooks.map((hook) => hook.key).join(', ')}`,
    why: 'These hooks are the lowest-friction set that matches the repo trust boundary, logging needs, and review posture.',
    evidence: unique(recommendedOperatingProfile.hooks.flatMap((hook) => hook.evidence || []).slice(0, 5)),
    prerequisites: unique(recommendedOperatingProfile.hooks.flatMap((hook) => hook.prerequisites || [])),
    expectedBenefit: 'Adds secret protection, trust-boundary checks, and durable change evidence without widening the product surface.',
    rollbackSafety: 'Each hook can be removed independently from repo settings if it proves noisy.',
  }));

  items.push(makeItem({
    decision: 'adopt',
    kind: 'verification-loop',
    key: recommendedOperatingProfile.verification.key,
    label: `Verification loop: ${recommendedOperatingProfile.verification.label}`,
    why: recommendedOperatingProfile.verification.why,
    evidence: recommendedOperatingProfile.verification.evidence,
    prerequisites: recommendedOperatingProfile.verification.prerequisites,
    expectedBenefit: recommendedOperatingProfile.verification.expectedBenefit,
    rollbackSafety: recommendedOperatingProfile.verification.rollbackSafety,
  }));

  items.push(makeItem({
    decision: 'adopt',
    kind: 'ci-shape',
    key: recommendedOperatingProfile.ciShape.key,
    label: `CI shape: ${recommendedOperatingProfile.ciShape.label}`,
    why: recommendedOperatingProfile.ciShape.why,
    evidence: recommendedOperatingProfile.ciShape.evidence,
    prerequisites: recommendedOperatingProfile.ciShape.prerequisites,
    expectedBenefit: recommendedOperatingProfile.ciShape.expectedBenefit,
    rollbackSafety: recommendedOperatingProfile.ciShape.rollbackSafety,
  }));

  for (const pack of recommendedDomainPacks) {
    items.push(makeItem({
      decision: 'adopt',
      kind: 'domain-pack',
      key: pack.key,
      label: `Domain pack: ${pack.label}`,
      why: pack.useWhen,
      evidence: unique([...(pack.matchReasons || []), `Archetype: ${repoArchetype.label}`]).slice(0, 5),
      prerequisites: [
        `Review the pack modules before applying them: ${(pack.recommendedModules || []).slice(0, 4).join(', ') || 'no starter modules listed'}`,
      ],
      expectedBenefit: (pack.benchmarkFocus || []).length > 0
        ? `Improves Nerviq's relevance around ${pack.benchmarkFocus.slice(0, 3).join(', ')}.`
        : 'Makes Nerviq recommendations more domain-aware for this repo.',
      rollbackSafety: 'Domain packs are additive guidance. You can remove a pack from the recommended stack without rewriting the repo.',
    }));
  }

  if (platform === 'claude') {
    for (const pack of recommendedMcpPacks) {
      const preflight = mcpPreflightByKey.get(pack.key);
      const prerequisites = inferMcpPackPrerequisites(pack, preflight);
      const decision = prerequisites.length > 0 ? 'defer' : 'adopt';
      items.push(makeItem({
        decision,
        kind: 'mcp-pack',
        key: pack.key,
        label: `MCP pack: ${pack.label}`,
        why: pack.useWhen,
        evidence: unique([pack.adoption, `Repo archetype: ${repoArchetype.label}`]).slice(0, 4),
        prerequisites,
        expectedBenefit: pack.adoption,
        rollbackSafety: 'MCP packs are optional integrations; they can be added or removed from settings without changing application source code.',
      }));
    }
  }

  items.push(...buildIgnoreItems(repoArchetype, recommendedOperatingProfile, recommendedDomainPacks));

  const sorted = items
    .sort((a, b) => {
      const decisionDiff = (DECISION_ORDER[a.decision] || 99) - (DECISION_ORDER[b.decision] || 99);
      if (decisionDiff !== 0) return decisionDiff;
      return a.label.localeCompare(b.label);
    })
    .map((item, index) => ({
      priority: index + 1,
      ...item,
    }));

  return {
    summary: summarize(sorted),
    items: sorted,
  };
}

module.exports = {
  buildAdoptionAdvisor,
};
