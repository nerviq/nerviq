const fs = require('fs');
const path = require('path');
const { applyProfileToOptions } = require('./profiles');

const POLICY_FILES = {
  org: path.join('.nerviq', 'org-policy.json'),
  team: path.join('.nerviq', 'team-policy.json'),
  repo: path.join('.nerviq', 'repo-policy.json'),
};

function normalizeArray(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = `${value || ''}`.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function readPolicyFile(filePath, layer) {
  if (!filePath || !fs.existsSync(filePath)) return null;

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return {
      layer,
      path: filePath,
      valid: false,
      error: 'could not read policy file',
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      layer,
      path: filePath,
      valid: false,
      error: 'invalid JSON',
    };
  }

  return {
    layer,
    path: filePath,
    valid: true,
    policy: {
      name: parsed.name || `${layer} policy`,
      description: parsed.description || '',
      platforms: normalizeArray(parsed.platforms || []),
      threshold: parsed.threshold != null ? Number(parsed.threshold) : null,
      requireChecks: normalizeArray(parsed.requireChecks || []),
      suppressedChecks: normalizeArray(parsed.suppressedChecks || []),
      priorityBoosts: normalizeArray(parsed.priorityBoosts || []),
      customWeights: parsed.customWeights && typeof parsed.customWeights === 'object' ? parsed.customWeights : {},
    },
  };
}

function findAncestorOrgPolicy(dir) {
  let current = path.resolve(dir);
  let lastFound = null;

  while (true) {
    const candidate = path.join(current, POLICY_FILES.org);
    if (fs.existsSync(candidate)) {
      lastFound = candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return lastFound;
}

function resolvePolicyLayers(dir) {
  const absoluteDir = path.resolve(dir);
  const layers = [];

  const orgLayer = readPolicyFile(findAncestorOrgPolicy(absoluteDir), 'org');
  if (orgLayer) layers.push(orgLayer);

  const teamLayer = readPolicyFile(path.join(absoluteDir, POLICY_FILES.team), 'team');
  if (teamLayer) layers.push(teamLayer);

  const repoLayer = readPolicyFile(path.join(absoluteDir, POLICY_FILES.repo), 'repo');
  if (repoLayer) layers.push(repoLayer);

  const resolved = {
    platforms: [],
    threshold: null,
    requireChecks: [],
    suppressedChecks: [],
    priorityBoosts: [],
    customWeights: {},
    description: '',
  };

  const fieldSources = {
    platforms: [],
    threshold: null,
    requireChecks: [],
    suppressedChecks: [],
    priorityBoosts: [],
    customWeights: [],
    description: null,
  };

  for (const layer of layers) {
    if (!layer.valid || !layer.policy) continue;
    const { policy } = layer;

    if (policy.platforms.length > 0) {
      resolved.platforms = [...policy.platforms];
      fieldSources.platforms = [layer.layer];
    }

    if (policy.threshold != null && Number.isFinite(policy.threshold)) {
      resolved.threshold = policy.threshold;
      fieldSources.threshold = layer.layer;
    }

    if (policy.requireChecks.length > 0) {
      resolved.requireChecks = normalizeArray([...resolved.requireChecks, ...policy.requireChecks]);
      fieldSources.requireChecks = normalizeArray([...fieldSources.requireChecks, layer.layer]);
    }

    if (policy.suppressedChecks.length > 0) {
      resolved.suppressedChecks = normalizeArray([...resolved.suppressedChecks, ...policy.suppressedChecks]);
      fieldSources.suppressedChecks = normalizeArray([...fieldSources.suppressedChecks, layer.layer]);
    }

    if (policy.priorityBoosts.length > 0) {
      resolved.priorityBoosts = normalizeArray([...resolved.priorityBoosts, ...policy.priorityBoosts]);
      fieldSources.priorityBoosts = normalizeArray([...fieldSources.priorityBoosts, layer.layer]);
    }

    if (Object.keys(policy.customWeights).length > 0) {
      resolved.customWeights = { ...resolved.customWeights, ...policy.customWeights };
      fieldSources.customWeights = normalizeArray([...fieldSources.customWeights, layer.layer]);
    }

    if (policy.description) {
      resolved.description = policy.description;
      fieldSources.description = layer.layer;
    }
  }

  return {
    dir: absoluteDir,
    overrideOrder: ['org', 'team', 'repo', 'explicit-cli'],
    layers,
    resolved,
    fieldSources,
  };
}

function applyPolicyLayersToOptions(contract, options) {
  if (!contract || !contract.resolved) {
    return { ...options };
  }

  return applyProfileToOptions(contract.resolved, options);
}

function formatPolicyContract(contract) {
  if (!contract || !Array.isArray(contract.layers) || contract.layers.length === 0) {
    return '  No org/team/repo policy layers found.';
  }

  const lines = [
    '  Policy layers (override order: org -> team -> repo -> explicit CLI):',
  ];

  for (const layer of contract.layers) {
    if (!layer.valid) {
      lines.push(`  - ${layer.layer}: ${layer.path} [invalid: ${layer.error}]`);
      continue;
    }

    const policy = layer.policy || {};
    const details = [];
    if (policy.platforms?.length > 0) details.push(`platforms=${policy.platforms.join(', ')}`);
    if (policy.threshold != null) details.push(`threshold=${policy.threshold}`);
    if (policy.requireChecks?.length > 0) details.push(`require=${policy.requireChecks.join(', ')}`);
    lines.push(`  - ${layer.layer}: ${path.relative(contract.dir, layer.path) || layer.path}${details.length > 0 ? ` (${details.join('; ')})` : ''}`);
  }

  const resolved = contract.resolved || {};
  lines.push('  Resolved policy:');
  lines.push(`  - Platforms: ${resolved.platforms?.length > 0 ? resolved.platforms.join(', ') : 'default CLI platform'}`);
  lines.push(`  - Threshold: ${resolved.threshold != null ? resolved.threshold : 'default'}`);
  lines.push(`  - Required checks: ${resolved.requireChecks?.length > 0 ? resolved.requireChecks.join(', ') : 'none'}`);
  return lines.join('\n');
}

module.exports = {
  POLICY_FILES,
  resolvePolicyLayers,
  applyPolicyLayersToOptions,
  formatPolicyContract,
};
