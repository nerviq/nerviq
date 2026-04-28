const fs = require('fs');
const path = require('path');
const { ProjectContext } = require('./context');
const {
  readSnapshotIndex,
  loadSnapshotPayload,
  writeSnapshotArtifact,
  formatSnapshotTags,
  formatSnapshotMilestone,
} = require('./activity');

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  magenta: '\x1b[35m',
};

const c = (text, color) => `${COLORS[color] || ''}${text}${COLORS.reset}`;

const BEHAVIORAL_SNAPSHOT_KIND = 'behavioral-drift';
const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.go', '.java', '.kt', '.kts', '.cs',
  '.php', '.rb', '.rs', '.swift', '.dart',
  '.scala', '.lua', '.sh', '.bash',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp',
]);
const IGNORED_DIRS = new Set([
  '.git', '.nerviq', '.next', '.nuxt', '.vercel', '.turbo',
  'node_modules', 'dist', 'build', 'coverage', 'vendor',
  '__pycache__', '.venv', 'venv', 'Pods', 'DerivedData',
  'target', 'bin', 'obj',
]);

const SCOPE_CONTRACT = {
  mode: 'behavioral-drift',
  optIn: true,
  evidenceBased: true,
  inScope: [
    'Module size distribution',
    'Utility-vs-service balance',
    'Dependency fan-out hotspots',
    'Responsibility concentration',
    'Lightweight layering-break heuristics',
    'Intent-vs-outcome mismatch against repo instruction surfaces',
  ],
  outOfScope: [
    'Full semantic architecture review',
    'Agent attribution without explicit evidence',
    'Runtime performance analysis',
    'Security vulnerability scanning or SAST claims',
    'Business-logic correctness',
  ],
  disclaimers: [
    'Behavioral drift mode is heuristic and repository-level. It highlights suspicious patterns, not absolute truth.',
    'Confidence increases when instruction surfaces explicitly state architectural intent.',
    'Large generated files, vendored code, and framework conventions can skew the signals.',
  ],
  confidenceGuide: {
    low: 'Weak signal or sparse evidence. Treat as a prompt to inspect.',
    medium: 'Multiple supporting indicators, but still heuristic.',
    high: 'Clear instruction intent plus strong repository evidence.',
  },
};

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function normalizeSlashes(value) {
  return `${value || ''}`.replace(/\\/g, '/');
}

function lineCount(content) {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}

function buildFileKind(relativePath) {
  const normalized = normalizeSlashes(relativePath).toLowerCase();
  if (/(^|\/)(utils?|helpers?|common|shared|lib)(\/|\.|$)/.test(normalized)) return 'utility';
  if (/(^|\/)(services?|controllers?|handlers?|routes?|resolvers?|repositories?|repos?)(\/|\.|$)/.test(normalized)) return 'service';
  if (/(^|\/)(components?|ui|views?|screens?|pages?)(\/|\.|$)/.test(normalized)) return 'ui';
  if (/(^|\/)(infra|db|database|storage|adapters?|prisma|sql|orm)(\/|\.|$)/.test(normalized)) return 'infra';
  if (/(^|\/)(domain|entities?|models?)(\/|\.|$)/.test(normalized)) return 'domain';
  return 'general';
}

function walkSourceFiles(rootDir, options = {}) {
  const maxFiles = options.maxFiles || 400;
  const maxFileBytes = options.maxFileBytes || 200 * 1024;
  const files = [];
  const meta = {
    visitedFiles: 0,
    skippedLargeFiles: 0,
    skippedUnsupportedFiles: 0,
    truncatedByLimit: false,
  };

  function visit(currentDir) {
    if (files.length >= maxFiles) {
      meta.truncatedByLimit = true;
      return;
    }

    for (const entry of safeReadDir(currentDir)) {
      if (files.length >= maxFiles) {
        meta.truncatedByLimit = true;
        return;
      }

      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);

      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.claude' && entry.name !== '.codex') continue;
        visit(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      meta.visitedFiles += 1;

      const extension = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(extension)) {
        meta.skippedUnsupportedFiles += 1;
        continue;
      }

      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.size > maxFileBytes) {
        meta.skippedLargeFiles += 1;
        continue;
      }

      let content;
      try {
        content = fs.readFileSync(fullPath, 'utf8');
      } catch {
        continue;
      }

      const lines = lineCount(content);
      files.push({
        path: normalizeSlashes(relativePath),
        extension,
        lines,
        sizeBytes: stat.size,
        kind: buildFileKind(relativePath),
        content,
      });
    }
  }

  visit(rootDir);
  return { files, meta };
}

function extractImportTargets(file) {
  const targets = new Set();
  const content = file.content || '';
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\busing\s+([A-Za-z0-9_.]+)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const target = (match[1] || '').trim();
      if (!target) continue;
      targets.add(target);
    }
  }

  return [...targets];
}

function extractIntentEvidence(text, pattern) {
  const lines = `${text || ''}`.split(/\r?\n/);
  const evidence = [];
  for (const line of lines) {
    if (pattern.test(line)) {
      evidence.push(line.trim().slice(0, 180));
      if (evidence.length >= 4) break;
    }
    pattern.lastIndex = 0;
  }
  return evidence;
}

function collectIntentSignals(dir) {
  const ctx = new ProjectContext(dir);
  const surfaces = [];

  const directFiles = ['CLAUDE.md', '.claude/CLAUDE.md', 'AGENTS.md'];
  for (const filePath of directFiles) {
    const content = ctx.fileContent(filePath);
    if (content) surfaces.push({ filePath, content });
  }

  for (const folder of ['.claude/rules', '.claude/commands']) {
    if (!ctx.hasDir(folder)) continue;
    for (const fileName of ctx.dirFiles(folder)) {
      const relativePath = normalizeSlashes(path.join(folder, fileName));
      const content = ctx.fileContent(relativePath);
      if (content) surfaces.push({ filePath: relativePath, content });
    }
  }

  const joined = surfaces.map((item) => item.content).join('\n');
  const intentDefinitions = [
    {
      key: 'small-modules',
      label: 'small modules',
      pattern: /(small modules?|small files?|small functions?|keep (modules?|files?) small|avoid giant files?|avoid large modules?|under \d+\s+lines?)/i,
    },
    {
      key: 'thin-services',
      label: 'thin services',
      pattern: /(thin services?|service layer thin|lightweight services?|keep services? thin)/i,
    },
    {
      key: 'avoid-utility-accretion',
      label: 'avoid utility accretion',
      pattern: /(avoid (fat|giant) utils?|avoid utility accretion|avoid helper dumping|don't dump .*utils?|no utility dumping)/i,
    },
    {
      key: 'layered-architecture',
      label: 'layered architecture',
      pattern: /(layered architecture|controller[- /]service[- /]repository|service[- /]repository|separation of concerns|domain layer|infrastructure layer)/i,
    },
    {
      key: 'composition-over-inheritance',
      label: 'composition over inheritance',
      pattern: /(composition over inheritance|prefer composition|avoid inheritance)/i,
    },
  ];

  const detected = {};
  for (const intent of intentDefinitions) {
    const present = intent.pattern.test(joined);
    intent.pattern.lastIndex = 0;
    if (!present) continue;
    const evidence = [];
    for (const surface of surfaces) {
      evidence.push(...extractIntentEvidence(surface.content, intent.pattern).map((line) => `${surface.filePath}: ${line}`));
      intent.pattern.lastIndex = 0;
      if (evidence.length >= 4) break;
    }
    detected[intent.key] = {
      key: intent.key,
      label: intent.label,
      evidence: evidence.slice(0, 4),
    };
  }

  return {
    surfaces: surfaces.map((item) => item.filePath),
    detected,
  };
}

function calculateLayerBreaks(fileEntries) {
  const examples = [];
  let count = 0;

  for (const file of fileEntries) {
    const fileKind = file.kind;
    if (!['ui', 'service', 'general'].includes(fileKind)) continue;
    const imports = extractImportTargets(file);
    for (const target of imports) {
      const normalized = normalizeSlashes(target).toLowerCase();
      const sourcePath = file.path.toLowerCase();
      const suspiciousTarget = /(db|database|sql|prisma|repository|repos?|infra|storage)/.test(normalized);
      const uiIntoInfra = fileKind === 'ui' && suspiciousTarget;
      const routeIntoInfra = /(routes?|controllers?|pages?)/.test(sourcePath) && suspiciousTarget;
      if (!uiIntoInfra && !routeIntoInfra) continue;
      count += 1;
      if (examples.length < 5) {
        examples.push({
          source: file.path,
          target,
        });
      }
    }
  }

  return { count, examples };
}

function buildStructuralSignals(dir, options = {}) {
  const { files, meta } = walkSourceFiles(dir, options);
  const totalLines = files.reduce((sum, file) => sum + file.lines, 0);
  const utilityFiles = files.filter((file) => file.kind === 'utility');
  const serviceFiles = files.filter((file) => file.kind === 'service');
  const veryLargeFiles = files.filter((file) => file.lines >= 500).sort((a, b) => b.lines - a.lines);
  const largeFiles = files.filter((file) => file.lines >= 250).sort((a, b) => b.lines - a.lines);
  const importCounts = files.map((file) => ({
    path: file.path,
    importCount: new Set(extractImportTargets(file)).size,
    kind: file.kind,
  })).sort((a, b) => b.importCount - a.importCount);

  const byDirectory = new Map();
  for (const file of files) {
    const dirKey = normalizeSlashes(path.dirname(file.path));
    byDirectory.set(dirKey, (byDirectory.get(dirKey) || 0) + file.lines);
  }
  const directoryHotspots = [...byDirectory.entries()]
    .map(([directory, lines]) => ({ directory: directory === '.' ? '(root)' : directory, lines }))
    .sort((a, b) => b.lines - a.lines);
  const largestDirectoryShare = totalLines > 0 && directoryHotspots[0]
    ? Math.round((directoryHotspots[0].lines / totalLines) * 100)
    : 0;

  const utilityLines = utilityFiles.reduce((sum, file) => sum + file.lines, 0);
  const serviceLines = serviceFiles.reduce((sum, file) => sum + file.lines, 0);
  const layerBreaks = calculateLayerBreaks(files);

  const inheritanceHits = files
    .map((file) => ({
      path: file.path,
      count: (file.content.match(/\bextends\s+[A-Z][A-Za-z0-9_]*/g) || []).length,
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    sourceFiles: files.length,
    totalLines,
    scanMeta: meta,
    moduleSize: {
      small: files.filter((file) => file.lines < 120).length,
      medium: files.filter((file) => file.lines >= 120 && file.lines < 250).length,
      large: files.filter((file) => file.lines >= 250 && file.lines < 500).length,
      veryLarge: veryLargeFiles.length,
      largestFiles: largeFiles.slice(0, 5).map((file) => ({
        path: file.path,
        lines: file.lines,
        kind: file.kind,
      })),
    },
    utilityBalance: {
      utilityFiles: utilityFiles.length,
      utilityLines,
      utilityShare: totalLines > 0 ? Math.round((utilityLines / totalLines) * 100) : 0,
      serviceFiles: serviceFiles.length,
      serviceLines,
      serviceShare: totalLines > 0 ? Math.round((serviceLines / totalLines) * 100) : 0,
    },
    dependencyFanOut: {
      averageImportsPerFile: files.length > 0
        ? Number((importCounts.reduce((sum, file) => sum + file.importCount, 0) / files.length).toFixed(1))
        : 0,
      hotspots: importCounts.filter((item) => item.importCount >= 6).slice(0, 5),
    },
    responsibilityConcentration: {
      largestDirectoryShare,
      hotspotDirectories: directoryHotspots.slice(0, 5),
    },
    layering: layerBreaks,
    inheritance: {
      count: inheritanceHits.reduce((sum, item) => sum + item.count, 0),
      hotspots: inheritanceHits.slice(0, 5),
    },
  };
}

function buildFinding({
  key,
  severity,
  title,
  summary,
  evidence = [],
  whyItMatters,
  suggestedNextStep,
  confidence,
  category,
}) {
  return {
    key,
    severity,
    title,
    summary,
    evidence,
    whyItMatters,
    suggestedNextStep,
    confidence,
    category,
  };
}

function deriveBehavioralFindings(structuralSignals, intentSignals) {
  const findings = [];
  const labels = [];
  const intents = intentSignals.detected || {};
  const largestFile = structuralSignals.moduleSize.largestFiles[0] || null;

  if (structuralSignals.moduleSize.veryLarge > 0) {
    labels.push('large-module-drift');
    findings.push(buildFinding({
      key: 'large-module-drift',
      severity: structuralSignals.moduleSize.veryLarge >= 2 ? 'high' : 'medium',
      title: 'Very large modules are carrying too much responsibility',
      summary: structuralSignals.moduleSize.veryLarge >= 2
        ? `${structuralSignals.moduleSize.veryLarge} files are above 500 lines.`
        : `${largestFile ? largestFile.path : 'A module'} is above 500 lines.`,
      evidence: structuralSignals.moduleSize.largestFiles.slice(0, 3).map((file) => `${file.path} (${file.lines} lines, ${file.kind})`),
      whyItMatters: 'Large modules make agent output locally coherent but globally unstable. They attract unrelated changes and hide responsibility drift.',
      suggestedNextStep: 'Split the largest file by responsibility boundary and move the first extraction behind a named module boundary rather than another shared util.',
      confidence: intents['small-modules'] ? 'high' : 'medium',
      category: intents['small-modules'] ? 'intent-outcome-mismatch' : 'structural-signal',
    }));
  }

  const utilityShare = structuralSignals.utilityBalance.utilityShare;
  const serviceShare = structuralSignals.utilityBalance.serviceShare;
  if (utilityShare >= 30 || (utilityShare >= 20 && utilityShare > serviceShare + 8)) {
    labels.push('utility-gravity');
    findings.push(buildFinding({
      key: 'utility-gravity',
      severity: utilityShare >= 35 ? 'high' : 'medium',
      title: 'Utility modules are absorbing too much of the codebase',
      summary: `Utility-coded files account for ${utilityShare}% of analyzed source lines while service-oriented files account for ${serviceShare}%.`,
      evidence: structuralSignals.moduleSize.largestFiles
        .filter((file) => file.kind === 'utility')
        .slice(0, 3)
        .map((file) => `${file.path} (${file.lines} lines)`),
      whyItMatters: 'This is a common outcome-layer failure mode: agents keep making individually sensible helper additions until shared utility modules become the system.',
      suggestedNextStep: 'Move one oversized utility cluster into a service/domain module with an explicit owner and review the import paths that currently pull it everywhere.',
      confidence: intents['thin-services'] || intents['avoid-utility-accretion'] ? 'high' : 'medium',
      category: (intents['thin-services'] || intents['avoid-utility-accretion']) ? 'intent-outcome-mismatch' : 'structural-signal',
    }));
  }

  if (structuralSignals.layering.count > 0) {
    labels.push('layering-erosion');
    findings.push(buildFinding({
      key: 'layering-erosion',
      severity: structuralSignals.layering.count >= 3 ? 'high' : 'medium',
      title: 'Layer boundaries show direct reach-through imports',
      summary: `${structuralSignals.layering.count} imports cross directly into infra/data paths from UI or route/controller surfaces.`,
      evidence: structuralSignals.layering.examples.map((item) => `${item.source} -> ${item.target}`),
      whyItMatters: 'Even when configs align, architecture can still drift if top-layer files start reaching into storage or infra directly.',
      suggestedNextStep: 'Insert a service/domain seam for the first direct infra import and make routes or UI files depend on that seam instead of database/storage modules.',
      confidence: intents['layered-architecture'] ? 'high' : 'medium',
      category: intents['layered-architecture'] ? 'intent-outcome-mismatch' : 'structural-signal',
    }));
  }

  if (structuralSignals.responsibilityConcentration.largestDirectoryShare >= 60) {
    labels.push('responsibility-concentration');
    findings.push(buildFinding({
      key: 'responsibility-concentration',
      severity: structuralSignals.responsibilityConcentration.largestDirectoryShare >= 75 ? 'high' : 'medium',
      title: 'One directory is carrying most of the code volume',
      summary: `${structuralSignals.responsibilityConcentration.hotspotDirectories[0]?.directory || '(root)'} holds ${structuralSignals.responsibilityConcentration.largestDirectoryShare}% of analyzed source lines.`,
      evidence: structuralSignals.responsibilityConcentration.hotspotDirectories.slice(0, 3).map((item) => `${item.directory} (${item.lines} lines)`),
      whyItMatters: 'Responsibility concentration is often an early sign that new work is being absorbed into the easiest existing location instead of the right boundary.',
      suggestedNextStep: 'Pick one hotspot directory and document the modules that should no longer accept unrelated changes before the next agent-heavy batch lands.',
      confidence: 'medium',
      category: 'structural-signal',
    }));
  }

  if (intents['composition-over-inheritance'] && structuralSignals.inheritance.count >= 3) {
    labels.push('inheritance-drift');
    findings.push(buildFinding({
      key: 'inheritance-drift',
      severity: structuralSignals.inheritance.count >= 6 ? 'medium' : 'low',
      title: 'Inheritance usage is drifting against the stated composition preference',
      summary: `${structuralSignals.inheritance.count} inheritance markers were found in analyzed files.`,
      evidence: structuralSignals.inheritance.hotspots.map((item) => `${item.path} (${item.count} extends)`),
      whyItMatters: 'This is a classic intent-vs-outcome mismatch: the repo says one thing, but incremental agent edits normalize another pattern.',
      suggestedNextStep: 'Review the hottest inheritance chain and convert the next new behavior to composition before the pattern spreads further.',
      confidence: 'high',
      category: 'intent-outcome-mismatch',
    }));
  }

  return {
    findings,
    labels: [...new Set(labels)],
  };
}

function buildBehavioralScore(structuralSignals, findings) {
  let score = 100;

  const largePenalty = Math.min(22, structuralSignals.moduleSize.veryLarge * 8);
  const utilityPenalty = structuralSignals.utilityBalance.utilityShare >= 35
    ? 16
    : structuralSignals.utilityBalance.utilityShare >= 25
      ? 8
      : 0;
  const layeringPenalty = Math.min(18, structuralSignals.layering.count * 5);
  const concentrationPenalty = structuralSignals.responsibilityConcentration.largestDirectoryShare >= 70
    ? 12
    : structuralSignals.responsibilityConcentration.largestDirectoryShare >= 60
      ? 6
      : 0;

  score -= largePenalty + utilityPenalty + layeringPenalty + concentrationPenalty;

  for (const finding of findings) {
    if (finding.severity === 'high') score -= 10;
    else if (finding.severity === 'medium') score -= 6;
    else if (finding.severity === 'low') score -= 3;
  }

  return Math.max(0, Math.min(100, score));
}

function buildBehavioralNextSteps(findings) {
  return findings.slice(0, 3).map((finding) => ({
    key: finding.key,
    title: finding.title,
    action: finding.suggestedNextStep,
    confidence: finding.confidence,
  }));
}

function getBehavioralHistory(dir, limit = 10) {
  return readSnapshotIndex(dir)
    .filter((entry) => entry.snapshotKind === BEHAVIORAL_SNAPSHOT_KIND)
    .sort((a, b) => {
      const dateDiff = new Date(b.createdAt) - new Date(a.createdAt);
      if (dateDiff !== 0) return dateDiff;
      return (b.id || '').localeCompare(a.id || '');
    })
    .slice(0, limit);
}

function loadBehavioralSnapshotPayload(dir, entry) {
  const payload = loadSnapshotPayload(dir, entry);
  return payload && payload.mode === 'behavioral-drift' ? payload : null;
}

function compareBehavioralLatest(dir) {
  const history = getBehavioralHistory(dir, 2);
  if (history.length < 2) return null;

  const current = history[0];
  const previous = history[1];
  const currentPayload = loadBehavioralSnapshotPayload(dir, current);
  const previousPayload = loadBehavioralSnapshotPayload(dir, previous);
  if (!currentPayload || !previousPayload) return null;

  const currentKeys = new Set((currentPayload.findings || []).map((item) => item.key));
  const previousKeys = new Set((previousPayload.findings || []).map((item) => item.key));

  return {
    scoreType: 'behavioral-alignment-score',
    current: {
      date: current.createdAt,
      score: current.summary?.score ?? currentPayload.score,
      findingCount: current.summary?.findingCount ?? currentPayload.findings.length,
      tags: current.tags || [],
      milestone: current.milestone || null,
    },
    previous: {
      date: previous.createdAt,
      score: previous.summary?.score ?? previousPayload.score,
      findingCount: previous.summary?.findingCount ?? previousPayload.findings.length,
      tags: previous.tags || [],
      milestone: previous.milestone || null,
    },
    delta: {
      score: (current.summary?.score ?? currentPayload.score ?? 0) - (previous.summary?.score ?? previousPayload.score ?? 0),
      findings: (current.summary?.findingCount ?? currentPayload.findings.length) - (previous.summary?.findingCount ?? previousPayload.findings.length),
    },
    regressions: [...currentKeys].filter((key) => !previousKeys.has(key)),
    resolved: [...previousKeys].filter((key) => !currentKeys.has(key)),
    trend: (current.summary?.score ?? currentPayload.score ?? 0) > (previous.summary?.score ?? previousPayload.score ?? 0)
      ? 'improving'
      : (current.summary?.score ?? currentPayload.score ?? 0) < (previous.summary?.score ?? previousPayload.score ?? 0)
        ? 'regressing'
        : 'stable',
  };
}

function formatBehavioralBootstrap(dir, goal = 'report') {
  const historyCount = getBehavioralHistory(dir, 20).length;
  const lines = [];

  if (goal === 'history') {
    lines.push(historyCount === 0
      ? 'No behavioral drift snapshots found yet.'
      : 'Behavioral drift history exists, but compare still needs one more snapshot.');
  } else {
    lines.push(historyCount === 0
      ? 'Behavioral compare needs 2 behavioral snapshots.'
      : 'Behavioral compare needs one more behavioral snapshot.');
  }

  lines.push(`  Current state: ${historyCount} behavioral snapshot(s).`);
  lines.push('  Bootstrap it with:');
  lines.push('  1. Run `nerviq deep-review --behavioral --snapshot --milestone baseline --tag "behavioral-baseline"`.');
  lines.push('  2. Make a meaningful architectural or workflow change.');
  lines.push('  3. Run `nerviq deep-review --behavioral --snapshot --milestone release --tag "after-change"`.');
  lines.push(goal === 'history'
    ? '  Then rerun `nerviq deep-review --behavioral --history`.'
    : '  Then rerun `nerviq deep-review --behavioral --compare`.');
  return lines.join('\n');
}

function formatBehavioralHistory(dir) {
  const history = getBehavioralHistory(dir, 10);
  if (history.length === 0) return formatBehavioralBootstrap(dir, 'history');

  const lines = [
    'Behavioral drift snapshot history (most recent first):',
    '  Score type: behavioral alignment snapshots only.',
    '',
  ];

  for (const entry of history) {
    const date = entry.createdAt?.split('T')[0] || '?';
    const score = entry.summary?.score ?? '?';
    const findingCount = entry.summary?.findingCount ?? '?';
    lines.push(`  ${date}  snapshot${formatSnapshotMilestone(entry.milestone)}${formatSnapshotTags(entry.tags)} ${score}/100  (${findingCount} findings)`);
  }

  const comparison = compareBehavioralLatest(dir);
  if (comparison) {
    lines.push('');
    lines.push(`  Latest snapshot trend: ${comparison.trend} (${comparison.delta.score >= 0 ? '+' : ''}${comparison.delta.score} since previous snapshot)`);
    if (comparison.resolved.length > 0) {
      lines.push(`  Resolved drift labels: ${comparison.resolved.join(', ')}`);
    }
    if (comparison.regressions.length > 0) {
      lines.push(`  New drift labels: ${comparison.regressions.join(', ')}`);
    }
  }

  if (history.length === 1) {
    lines.push('');
    lines.push(formatBehavioralBootstrap(dir, 'history'));
  }

  return lines.join('\n');
}

function formatBehavioralCompare(dir) {
  const comparison = compareBehavioralLatest(dir);
  if (!comparison) return formatBehavioralBootstrap(dir, 'compare');

  const lines = [
    'Behavioral drift comparison:',
    `  Previous snapshot: ${comparison.previous.score}/100 (${comparison.previous.date?.split('T')[0]})${formatSnapshotMilestone(comparison.previous.milestone)}${formatSnapshotTags(comparison.previous.tags)}`,
    `  Current snapshot:  ${comparison.current.score}/100 (${comparison.current.date?.split('T')[0]})${formatSnapshotMilestone(comparison.current.milestone)}${formatSnapshotTags(comparison.current.tags)}`,
    `  Alignment delta:   ${comparison.delta.score >= 0 ? '+' : ''}${comparison.delta.score} points`,
    `  Finding delta:     ${comparison.delta.findings >= 0 ? '+' : ''}${comparison.delta.findings} findings`,
    `  Trend:             ${comparison.trend}`,
  ];

  if (comparison.resolved.length > 0) {
    lines.push(`  Resolved drift labels: ${comparison.resolved.join(', ')}`);
  }
  if (comparison.regressions.length > 0) {
    lines.push(`  New drift labels: ${comparison.regressions.join(', ')}`);
  }

  return lines.join('\n');
}

function analyzeBehavioralDrift(dir, options = {}) {
  const structuralSignals = buildStructuralSignals(dir, options);
  const intentSignals = collectIntentSignals(dir);
  const { findings, labels } = deriveBehavioralFindings(structuralSignals, intentSignals);

  // BUG-05 fix: a perfect 100 alignment score on a repo with no source files
  // is misleading — the buildBehavioralScore math starts at 100 and subtracts
  // penalties; with zero structural signal there's nothing to subtract, so
  // empty repos look "perfectly aligned." Surface insufficient-signal status
  // explicitly instead of returning the bogus 100. Threshold: <5 source files
  // is treated as insufficient signal (calibrated from the user-lab fixture
  // where 0 source files returned 100).
  const SUFFICIENT_SIGNAL_FLOOR = 5;
  const insufficientSignal = structuralSignals.sourceFiles < SUFFICIENT_SIGNAL_FLOOR;

  const score = insufficientSignal
    ? null
    : buildBehavioralScore(structuralSignals, findings);

  return {
    mode: 'behavioral-drift',
    scoreType: 'behavioral-alignment-score',
    score,
    status: insufficientSignal ? 'insufficient-signal' : 'ok',
    insufficientSignalReason: insufficientSignal
      ? `Need ≥${SUFFICIENT_SIGNAL_FLOOR} source files to compute a meaningful alignment score; found ${structuralSignals.sourceFiles}.`
      : null,
    scope: SCOPE_CONTRACT,
    repoSummary: {
      project: path.basename(dir),
      sourceFiles: structuralSignals.sourceFiles,
      totalLines: structuralSignals.totalLines,
      instructionSurfaces: intentSignals.surfaces,
      scanMeta: structuralSignals.scanMeta,
    },
    structuralSignals,
    intentSignals,
    driftLabels: labels,
    findings,
    nextSteps: insufficientSignal
      ? [{
          key: 'add-source-code',
          title: `Add at least ${SUFFICIENT_SIGNAL_FLOOR} source files before re-running behavioral review.`,
          severity: 'low',
        }]
      : buildBehavioralNextSteps(findings),
  };
}

function writeBehavioralSnapshot(dir, report, meta = {}) {
  return writeSnapshotArtifact(dir, BEHAVIORAL_SNAPSHOT_KIND, report, meta);
}

function formatBehavioralReport(report, options = {}) {
  const lines = [];
  // BUG-05 fix: handle insufficient-signal status — the score is null and a
  // human-friendly explanation replaces the colored gauge.
  if (report.status === 'insufficient-signal') {
    lines.push('');
    lines.push(c('  nerviq behavioral drift review', 'bold'));
    lines.push(c('  ═══════════════════════════════════════', 'dim'));
    lines.push(c('  Alignment score: insufficient signal', 'yellow'));
    lines.push(c(`  ${report.insufficientSignalReason || 'Not enough source files to compute a meaningful score.'}`, 'dim'));
    lines.push(c('  No score returned to avoid a misleading 100 on empty repos.', 'dim'));
    lines.push('');
    return lines.join('\n');
  }
  const scoreColor = report.score >= 75 ? 'green' : report.score >= 55 ? 'yellow' : 'red';

  lines.push('');
  lines.push(c('  nerviq behavioral drift review', 'bold'));
  lines.push(c('  ═══════════════════════════════════════', 'dim'));
  lines.push(c(`  Alignment score: ${report.score}/100`, scoreColor));
  lines.push(c('  Opt-in local heuristics only. No source code leaves the machine.', 'dim'));
  lines.push('');

  lines.push(c('  Scope', 'bold'));
  lines.push(`  In scope: ${report.scope.inScope.slice(0, 3).join('; ')}.`);
  lines.push(`  Out of scope: ${report.scope.outOfScope.slice(0, 3).join('; ')}.`);
  lines.push('');

  lines.push(c('  Structural Signals', 'bold'));
  lines.push(`  Source files analyzed: ${report.repoSummary.sourceFiles}`);
  lines.push(`  Very large files (500+ lines): ${report.structuralSignals.moduleSize.veryLarge}`);
  lines.push(`  Utility share: ${report.structuralSignals.utilityBalance.utilityShare}% | Service share: ${report.structuralSignals.utilityBalance.serviceShare}%`);
  lines.push(`  Layer-break imports: ${report.structuralSignals.layering.count}`);
  lines.push(`  Largest directory share: ${report.structuralSignals.responsibilityConcentration.largestDirectoryShare}%`);
  if (report.structuralSignals.moduleSize.largestFiles.length > 0) {
    lines.push(`  Largest file: ${report.structuralSignals.moduleSize.largestFiles[0].path} (${report.structuralSignals.moduleSize.largestFiles[0].lines} lines)`);
  }
  lines.push('');

  lines.push(c('  Intent Signals', 'bold'));
  if (Object.keys(report.intentSignals.detected).length === 0) {
    lines.push('  No explicit architectural intent was detected in instruction surfaces.');
  } else {
    for (const signal of Object.values(report.intentSignals.detected)) {
      lines.push(`  - ${signal.label}`);
      for (const evidence of signal.evidence.slice(0, 2)) {
        lines.push(`    Evidence: ${evidence}`);
      }
    }
  }
  lines.push('');

  lines.push(c('  Findings', 'bold'));
  if (report.findings.length === 0) {
    lines.push(c('  ✅ No clear behavioral drift signals found in the sampled source set.', 'green'));
  } else {
    for (const finding of report.findings) {
      const severityColor = finding.severity === 'high' ? 'red' : finding.severity === 'medium' ? 'yellow' : 'blue';
      lines.push(c(`  [${finding.severity.toUpperCase()}] ${finding.title}`, severityColor));
      lines.push(`    ${finding.summary}`);
      lines.push(`    Why: ${finding.whyItMatters}`);
      lines.push(`    Confidence: ${finding.confidence}`);
      if (finding.evidence.length > 0) {
        lines.push(`    Evidence: ${finding.evidence[0]}`);
      }
      lines.push(`    Next: ${finding.suggestedNextStep}`);
    }
  }
  lines.push('');

  lines.push(c('  Guardrails', 'bold'));
  for (const disclaimer of report.scope.disclaimers) {
    lines.push(`  - ${disclaimer}`);
  }

  if (options.snapshotArtifact) {
    lines.push('');
    lines.push(`  Snapshot saved: ${options.snapshotArtifact.relativePath}`);
    lines.push(`  Snapshot index: ${options.snapshotArtifact.indexPath}`);
  }

  lines.push('');
  return lines.join('\n');
}

module.exports = {
  BEHAVIORAL_SNAPSHOT_KIND,
  SCOPE_CONTRACT,
  analyzeBehavioralDrift,
  buildStructuralSignals,
  collectIntentSignals,
  deriveBehavioralFindings,
  getBehavioralHistory,
  compareBehavioralLatest,
  formatBehavioralBootstrap,
  formatBehavioralHistory,
  formatBehavioralCompare,
  formatBehavioralReport,
  writeBehavioralSnapshot,
};
