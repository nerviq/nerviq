const fs = require('fs');
const path = require('path');
const { resolvePolicyLayers, applyPolicyLayersToOptions } = require('./policy-layers');

function summarizePolicyCoverage(contract) {
  const validLayers = (contract?.layers || []).filter((layer) => layer.valid);
  return {
    layerCount: validLayers.length,
    layerKeys: validLayers.map((layer) => layer.layer),
    org: validLayers.some((layer) => layer.layer === 'org'),
    team: validLayers.some((layer) => layer.layer === 'team'),
    repo: validLayers.some((layer) => layer.layer === 'repo'),
  };
}

function buildScoreBands(repos) {
  const bands = {
    strong: 0,
    developing: 0,
    bootstrap: 0,
    unknown: 0,
  };

  for (const repo of repos) {
    if (typeof repo.score !== 'number') {
      bands.unknown += 1;
    } else if (repo.score >= 70) {
      bands.strong += 1;
    } else if (repo.score >= 40) {
      bands.developing += 1;
    } else {
      bands.bootstrap += 1;
    }
  }

  return bands;
}

function buildTopEvidence(repos) {
  const counts = new Map();
  for (const repo of repos) {
    const key = repo.topActionKey;
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, repoCount]) => ({ key, repoCount }))
    .sort((a, b) => b.repoCount - a.repoCount)
    .slice(0, 5);
}

async function scanOrg(dirs, options = {}) {
  const { audit } = require('./audit');
  const targets = Array.isArray(dirs) ? dirs : [];
  const repos = [];
  const fallbackPlatform = options.platform || 'claude';

  for (const dir of targets) {
    const resolvedDir = path.resolve(dir);
    const policyContract = resolvePolicyLayers(resolvedDir);
    const policyCoverage = summarizePolicyCoverage(policyContract);

    if (!fs.existsSync(resolvedDir)) {
      repos.push({
        name: path.basename(dir),
        dir: resolvedDir,
        platform: fallbackPlatform,
        scoreType: 'live-repo-audit-score',
        score: null,
        passed: 0,
        total: 0,
        topAction: null,
        topActionKey: null,
        policyCoverage,
        policyLayers: policyContract,
        error: 'directory not found',
      });
      continue;
    }

    const repoOptions = applyPolicyLayersToOptions(policyContract, {
      ...options,
      dir: resolvedDir,
      silent: true,
    });

    try {
      const result = await audit(repoOptions);
      repos.push({
        name: path.basename(resolvedDir),
        dir: resolvedDir,
        platform: repoOptions.platform || fallbackPlatform,
        scoreType: 'live-repo-audit-score',
        score: result.score,
        passed: result.passed,
        total: result.checkCount,
        topAction: result.topNextActions?.[0]?.name || null,
        topActionKey: result.topNextActions?.[0]?.key || null,
        policyCoverage,
        policyLayers: policyContract,
        result,
      });
    } catch (error) {
      repos.push({
        name: path.basename(resolvedDir),
        dir: resolvedDir,
        platform: repoOptions.platform || fallbackPlatform,
        scoreType: 'live-repo-audit-score',
        score: null,
        passed: 0,
        total: 0,
        topAction: null,
        topActionKey: null,
        policyCoverage,
        policyLayers: policyContract,
        error: error.message,
      });
    }
  }

  const validScores = repos.filter((item) => typeof item.score === 'number').map((item) => item.score);
  const averageScore = validScores.length > 0
    ? Math.round(validScores.reduce((sum, value) => sum + value, 0) / validScores.length)
    : 0;

  return {
    platform: fallbackPlatform,
    repoCount: repos.length,
    averageScore,
    scoreType: 'org-live-average-score',
    scoreSemantics: {
      repoScoreType: 'live-repo-audit-score',
      rollupScoreType: 'org-live-average-score',
      note: 'Repo rows are live per-repo audits. The org average is a rollup across those live repo scores, not a snapshot score or benchmark projection.',
    },
    maxScore: validScores.length > 0 ? Math.max(...validScores) : 0,
    minScore: validScores.length > 0 ? Math.min(...validScores) : 0,
    scoreBands: buildScoreBands(repos),
    policyCoverage: {
      orgPolicyRepos: repos.filter((repo) => repo.policyCoverage.org).length,
      teamPolicyRepos: repos.filter((repo) => repo.policyCoverage.team).length,
      repoPolicyRepos: repos.filter((repo) => repo.policyCoverage.repo).length,
    },
    topEvidence: buildTopEvidence(repos),
    repos,
  };
}

module.exports = {
  scanOrg,
};
