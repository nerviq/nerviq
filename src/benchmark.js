const fs = require('fs');
const os = require('os');
const path = require('path');

const { version } = require('../package.json');
const { audit } = require('./audit');
const { setup } = require('./setup');
const { analyzeProject } = require('./analyze');
const { getGovernanceSummary } = require('./governance');
const { formatTerminologyLines } = require('./terminology');

function copyProject(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '__pycache__') {
      continue;
    }
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyProject(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    } else if (entry.isSymbolicLink && entry.isSymbolicLink()) {
      // Symlinks are skipped in benchmark sandbox — log for awareness
      process.stderr.write(`  Note: symlink skipped in benchmark: ${entry.name}\n`);
    }
  }
}

function summarizeAudit(result) {
  return {
    score: result.score,
    organicScore: result.organicScore,
    passed: result.passed,
    failed: result.failed,
    checkCount: result.checkCount,
    quickWins: result.quickWins,
  };
}

function buildWorkflowEvidence(before, after, analysisReport, governanceSummary) {
  const tasks = [
    {
      key: 'discover-without-writes',
      label: 'Discover next actions without writing files',
      passed: before.checkCount > 0 && Array.isArray(before.quickWins),
      evidence: `Baseline audit returned ${before.checkCount} applicable checks and ${before.quickWins.length} quick wins.`,
    },
    {
      key: 'starter-safe-improvement',
      label: 'Apply starter-safe improvements in isolation',
      passed: after.score >= before.score && after.failed <= before.failed,
      evidence: `Score moved ${before.score} -> ${after.score}; failed checks moved ${before.failed} -> ${after.failed}.`,
    },
    {
      key: 'governed-rollout-surface',
      label: 'Expose governed rollout controls',
      passed: governanceSummary.permissionProfiles.length >= 3 && governanceSummary.hookRegistry.length >= 1,
      evidence: `${governanceSummary.permissionProfiles.length} profiles and ${governanceSummary.hookRegistry.length} governed hooks available.`,
    },
    {
      key: 'domain-pack-guidance',
      label: 'Recommend a domain pack for the repo',
      passed: analysisReport.recommendedDomainPacks.length > 0,
      evidence: analysisReport.recommendedDomainPacks.map(pack => pack.label).join(', ') || 'No domain pack recommendation generated.',
    },
    {
      key: 'mcp-pack-guidance',
      label: 'Recommend MCP packs when appropriate',
      passed: analysisReport.recommendedMcpPacks.length > 0,
      evidence: analysisReport.recommendedMcpPacks.map(pack => pack.label).join(', ') || 'No MCP pack recommendation generated.',
    },
  ];

  const passed = tasks.filter(task => task.passed).length;
  const total = tasks.length;
  return {
    taskPack: 'maintainer-core',
    tasks,
    summary: {
      passed,
      total,
      coverageScore: total > 0 ? Math.round((passed / total) * 100) : 0,
    },
  };
}

function buildCodexWorkflowEvidence(before, after, applyResult, analysisReport, governanceSummary) {
  const tasks = [
    {
      key: 'discover-without-writes',
      label: 'Discover next actions without writing files',
      passed: before.checkCount > 0 && Array.isArray(before.quickWins),
      evidence: `Baseline audit returned ${before.checkCount} applicable checks and ${before.quickWins.length} quick wins.`,
    },
    {
      key: 'starter-safe-improvement',
      label: 'Apply starter-safe Codex baseline in isolation',
      passed: after.score >= before.score && after.failed <= before.failed,
      evidence: `Score moved ${before.score} -> ${after.score}; failed checks moved ${before.failed} -> ${after.failed}.`,
    },
    {
      key: 'preserve-existing-files',
      label: 'Preserve existing files instead of overwriting them',
      passed: Array.isArray(applyResult.preservedFiles),
      evidence: `${applyResult.preservedFiles ? applyResult.preservedFiles.length : 0} files were preserved instead of overwritten.`,
    },
    {
      key: 'governed-rollout-surface',
      label: 'Expose governed rollout controls',
      passed: governanceSummary.permissionProfiles.length >= 3 && governanceSummary.hookRegistry.length >= 1,
      evidence: `${governanceSummary.permissionProfiles.length} profiles and ${governanceSummary.hookRegistry.length} governance surfaces available.`,
    },
    {
      key: 'domain-pack-guidance',
      label: 'Recommend Codex domain packs for the repo',
      passed: Array.isArray(analysisReport.recommendedDomainPacks) && analysisReport.recommendedDomainPacks.length > 0,
      evidence: (analysisReport.recommendedDomainPacks || []).map((pack) => pack.label).join(', ') || 'No Codex domain pack recommendation generated.',
    },
    {
      key: 'rollback-surface',
      label: 'Emit rollback evidence for writes',
      passed: Boolean(applyResult.rollbackArtifact),
      evidence: applyResult.rollbackArtifact
        ? `Rollback artifact emitted at ${applyResult.rollbackArtifact}.`
        : 'No rollback artifact emitted.',
    },
  ];

  const passed = tasks.filter((task) => task.passed).length;
  const total = tasks.length;
  return {
    taskPack: 'codex-baseline',
    tasks,
    summary: {
      passed,
      total,
      coverageScore: total > 0 ? Math.round((passed / total) * 100) : 0,
    },
  };
}

function buildExecutiveSummary(before, after, workflowEvidence) {
  const scoreDelta = after.score - before.score;
  const organicDelta = after.organicScore - before.organicScore;
  const workflowCoverage = workflowEvidence.summary.coverageScore;
  let headline = before.score >= 60
    ? 'Setup is already applied — benchmark shows no additional improvement. Run benchmark on a project before running setup to see the full delta.'
    : 'Benchmark did not improve the score in this run.';

  if (scoreDelta < 0) {
    headline = `Warning: score decreased by ${Math.abs(scoreDelta)} points. Setup may have introduced a regression.`;
  } else if (scoreDelta > 0) {
    headline = `Benchmark improved readiness by ${scoreDelta} points without touching the original repo.`;
  } else if (before.score >= 85 && after.score >= before.score && workflowCoverage >= 80) {
    headline = 'Benchmark confirmed the repo already meets the starter-safe baseline without regression.';
  }

  return {
    headline,
    scoreDelta,
    organicDelta,
    decisionGuidance: scoreDelta >= 20
      ? 'Strong pilot candidate'
      : scoreDelta >= 10
        ? 'Promising but needs manual review'
        : (before.score >= 85 && workflowCoverage >= 80
          ? 'Use suggest-only mode, domain packs, or task-level benchmarks next'
          : 'Use suggest-only mode before rollout'),
  };
}

function buildPracticalValue(before, after, applyResult) {
  const written = applyResult.writtenFiles || [];
  return {
    denyRulesAdded: written.includes('.claude/settings.json') ? 'yes' : 'no',
    hooksCreated: written.filter(f => f.includes('hooks/')).length,
    commandsCreated: written.filter(f => f.includes('commands/')).length,
    agentsCreated: written.filter(f => f.includes('agents/')).length,
    skillsCreated: written.filter(f => f.includes('skills/')).length,
    rulesCreated: written.filter(f => f.includes('rules/')).length,
    claudeMdCreated: written.includes('CLAUDE.md') ? 'yes' : 'no',
    totalFilesCreated: written.length,
    totalFilesPreserved: (applyResult.preservedFiles || []).length,
  };
}

function buildCaseStudy(before, after, applyResult) {
  return {
    initialState: `Baseline score ${before.score}/100, organic ${before.organicScore}/100.`,
    chosenMode: 'benchmark-on-isolated-copy',
    whatChanged: applyResult.writtenFiles,
    whatWasPreserved: applyResult.preservedFiles,
    measuredResults: {
      scoreDelta: after.score - before.score,
      organicDelta: after.organicScore - before.organicScore,
      passedDelta: after.passed - before.passed,
    },
    practicalValue: buildPracticalValue(before, after, applyResult),
  };
}

function renderBenchmarkMarkdown(report) {
  return [
    '# NERVIQ CLI Benchmark Report',
    '',
    `- Generated by: ${report.generatedBy}`,
    `- Created at: ${report.createdAt}`,
    `- Source repo: ${report.directory}`,
    '',
    '## Score Semantics',
    `- Baseline live audit score: ${report.scoreSemantics.baseline}`,
    `- Projected benchmark score: ${report.scoreSemantics.projected}`,
    `- Organic score: ${report.scoreSemantics.organic}`,
    '',
    '## Methodology',
    ...report.methodology.map(item => `- ${item}`),
    '',
    '## Baseline (Live Repo)',
    `- Live audit score: ${report.before.score}/100`,
    `- Organic live score: ${report.before.organicScore}/100`,
    `- Passing checks: ${report.before.passed}/${report.before.checkCount}`,
    '',
    '## Projected (Isolated Benchmark Copy)',
    `- Projected benchmark score: ${report.after.score}/100`,
    `- Projected organic score: ${report.after.organicScore}/100`,
    `- Passing checks: ${report.after.passed}/${report.after.checkCount}`,
    '',
    '## Delta',
    `- Projected score delta: ${report.delta.score}`,
    `- Projected organic score delta: ${report.delta.organicScore}`,
    `- Passed checks delta: ${report.delta.passed}`,
    '',
    '## Executive Summary',
    `- ${report.executiveSummary.headline}`,
    `- Recommendation: ${report.executiveSummary.decisionGuidance}`,
    '',
    '## Workflow Evidence',
    `- Task pack: ${report.workflowEvidence.taskPack}`,
    `- Coverage: ${report.workflowEvidence.summary.passed}/${report.workflowEvidence.summary.total} (${report.workflowEvidence.summary.coverageScore}%)`,
    ...report.workflowEvidence.tasks.map(task => `- ${task.label}: ${task.passed ? 'pass' : 'not yet'} — ${task.evidence}`),
    '',
    '## Case Study',
    `- Initial state: ${report.caseStudy.initialState}`,
    `- Chosen mode: ${report.caseStudy.chosenMode}`,
    `- What changed: ${report.caseStudy.whatChanged.join(', ') || 'none'}`,
    `- What was preserved: ${report.caseStudy.whatWasPreserved.join(', ') || 'none'}`,
    '',
  ].join('\n');
}

/**
 * Run a before/after benchmark on an isolated copy of the project.
 * @param {Object} options - Benchmark options.
 * @param {string} options.dir - Project directory to benchmark.
 * @param {string} [options.external] - External repo path to benchmark instead of cwd.
 * @param {string} [options.profile] - Permission profile to use during setup.
 * @param {string[]} [options.mcpPacks] - MCP pack keys to include in setup.
 * @returns {Promise<Object>} Benchmark report with before/after scores, delta, and workflow evidence.
 */
async function runBenchmark(options) {
  const platform = options.platform || 'claude';
  const sourceDir = options.external || options.dir;
  if (options.external && !fs.existsSync(options.external)) {
    throw new Error(`External repo path not found: ${options.external}`);
  }
  const before = await audit({ dir: sourceDir, silent: true, platform });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nerviq-benchmark-'));
  const sandboxDir = path.join(tempRoot, 'repo');

  try {
    copyProject(sourceDir, sandboxDir);
    const applyResult = await setup({
      dir: sandboxDir,
      auto: true,
      silent: true,
      profile: options.profile,
      mcpPacks: options.mcpPacks || [],
      platform,
    });
    const after = await audit({ dir: sandboxDir, silent: true, platform });
    const analysisReport = await analyzeProject({ dir: sandboxDir, mode: 'suggest-only', platform });
    const governanceSummary = getGovernanceSummary(platform);
    const workflowEvidence = platform === 'codex'
      ? buildCodexWorkflowEvidence(before, after, applyResult, analysisReport, governanceSummary)
      : buildWorkflowEvidence(before, after, analysisReport, governanceSummary);

    return {
      schemaVersion: 1,
      generatedBy: `nerviq@${version}`,
      createdAt: new Date().toISOString(),
      directory: sourceDir,
      platform,
      scoreSemantics: {
        baseline: 'current repo state before benchmark runs',
        projected: 'starter-safe post-setup score measured on an isolated temp copy',
        organic: 'repo-owned config quality excluding starter-generated Nerviq assets',
      },
      methodology: [
        'Run a baseline audit on the source repo.',
        'Copy the repo into a temporary isolated workspace.',
        `Apply starter-safe ${platform === 'codex' ? 'Codex' : 'Claude'} artifacts only on the isolated copy.`,
        'Re-run the audit and compare the results.',
      ],
      before: summarizeAudit(before),
      after: summarizeAudit(after),
      delta: {
        score: after.score - before.score,
        organicScore: after.organicScore - before.organicScore,
        passed: after.passed - before.passed,
        failed: after.failed - before.failed,
      },
      workflowEvidence,
      executiveSummary: buildExecutiveSummary(before, after, workflowEvidence),
      caseStudy: buildCaseStudy(before, after, applyResult),
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function printBenchmark(report, options = {}) {
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('');
  console.log('  nerviq benchmark');
  console.log('  ═══════════════════════════════════════');
  console.log('  Runs in an isolated temp copy. Your current repo is not modified.');
  console.log('  Score type: baseline = live repo audit, projected = isolated post-setup benchmark.');
  console.log('');
  const orgDeltaSign = report.delta.organicScore >= 0 ? '+' : '';
  const totalDeltaSign = report.delta.score >= 0 ? '+' : '';
  console.log(`  Projected organic delta: \x1b[1m${orgDeltaSign}${report.delta.organicScore} points\x1b[0m (repo-owned config quality)`);
  console.log(`  Projected total delta with nerviq setup: ${totalDeltaSign}${report.delta.score} points`);
  console.log('');
  console.log(`  Baseline live audit:      organic ${report.before.organicScore}/100, total ${report.before.score}/100`);
  console.log(`  Projected after setup:    organic ${report.after.organicScore}/100, total ${report.after.score}/100`);
  console.log('');
  console.log(`  ${report.executiveSummary.headline}`);
  console.log(`  Recommendation: ${report.executiveSummary.decisionGuidance}`);
  console.log(`  Workflow evidence: ${report.workflowEvidence.summary.passed}/${report.workflowEvidence.summary.total} tasks (${report.workflowEvidence.summary.coverageScore}%)`);
  console.log('');
  for (const line of formatTerminologyLines(['governance', 'hooks', 'mcp'])) {
    console.log(line);
  }
  console.log('');
}

function writeBenchmarkReport(report, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const content = path.extname(outFile).toLowerCase() === '.md'
    ? renderBenchmarkMarkdown(report)
    : JSON.stringify(report, null, 2);
  fs.writeFileSync(outFile, content, 'utf8');
}

module.exports = {
  runBenchmark,
  printBenchmark,
  writeBenchmarkReport,
};
