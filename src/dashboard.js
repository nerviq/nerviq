/**
 * Dashboard generator — produces a self-contained HTML report from audit snapshots.
 */

const fs = require('fs');
const path = require('path');
const { version } = require('../package.json');
const { readSnapshotIndex, getHistory, loadSnapshotPayload } = require('./activity');

const COLORS = {
  bg: '#0a0a0a',
  surface: '#18181b',
  border: '#27272a',
  text: '#e4e4e7',
  textDim: '#a1a1aa',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#eab308',
  blue: '#3b82f6',
};

function scoreColor(score) {
  if (score >= 70) return COLORS.green;
  if (score >= 40) return COLORS.yellow;
  return COLORS.red;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildScoreOverTimeSvg(history) {
  if (!history || history.length < 2) return '';
  const entries = history.slice().reverse(); // oldest first
  const w = 600, h = 200, pad = 40;
  const plotW = w - pad * 2, plotH = h - pad * 2;
  const n = entries.length;
  const step = n > 1 ? plotW / (n - 1) : 0;

  const points = entries.map((e, i) => {
    const x = pad + i * step;
    const score = e.summary?.score ?? 0;
    const y = pad + plotH - (score / 100) * plotH;
    return { x, y, score, date: (e.createdAt || '').split('T')[0] };
  });

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
  const dots = points.map(p =>
    `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${scoreColor(p.score)}"/>`
    + `<title>${p.date}: ${p.score}/100</title>`
  ).join('\n    ');

  // Y-axis labels
  const yLabels = [0, 25, 50, 75, 100].map(v => {
    const y = pad + plotH - (v / 100) * plotH;
    return `<text x="${pad - 8}" y="${y + 4}" text-anchor="end" fill="${COLORS.textDim}" font-size="11">${v}</text>`
      + `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="${COLORS.border}" stroke-dasharray="4"/>`;
  }).join('\n    ');

  // X-axis: first and last date
  const first = points[0], last = points[points.length - 1];
  const xLabels = `<text x="${first.x}" y="${h - 8}" text-anchor="start" fill="${COLORS.textDim}" font-size="11">${first.date}</text>`
    + `<text x="${last.x}" y="${h - 8}" text-anchor="end" fill="${COLORS.textDim}" font-size="11">${last.date}</text>`;

  return `
  <div class="card">
    <h2>Score Over Time</h2>
    <svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px">
      ${yLabels}
      <polyline points="${polyline}" fill="none" stroke="${COLORS.blue}" stroke-width="2"/>
      ${dots}
      ${xLabels}
    </svg>
  </div>`;
}

function buildCategoryBreakdownSvg(results) {
  if (!results || results.length === 0) return '';
  const cats = {};
  for (const r of results) {
    if (r.passed === null) continue;
    const cat = r.category || 'other';
    if (!cats[cat]) cats[cat] = { pass: 0, total: 0 };
    cats[cat].total++;
    if (r.passed) cats[cat].pass++;
  }
  const sorted = Object.entries(cats).sort((a, b) => {
    const rateA = a[1].total > 0 ? a[1].pass / a[1].total : 0;
    const rateB = b[1].total > 0 ? b[1].pass / b[1].total : 0;
    return rateA - rateB;
  });
  if (sorted.length === 0) return '';

  const barH = 28, gap = 6, labelW = 160, barMaxW = 360, padR = 60;
  const svgH = sorted.length * (barH + gap) + 10;
  const svgW = labelW + barMaxW + padR;

  const bars = sorted.map(([cat, data], i) => {
    const rate = data.total > 0 ? data.pass / data.total : 0;
    const pct = Math.round(rate * 100);
    const barW = Math.max(2, rate * barMaxW);
    const y = i * (barH + gap) + 4;
    const color = pct >= 70 ? COLORS.green : pct >= 40 ? COLORS.yellow : COLORS.red;
    return `<text x="${labelW - 8}" y="${y + barH / 2 + 4}" text-anchor="end" fill="${COLORS.text}" font-size="13">${escapeHtml(cat)}</text>`
      + `<rect x="${labelW}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${color}" opacity="0.85"/>`
      + `<text x="${labelW + barW + 8}" y="${y + barH / 2 + 4}" fill="${COLORS.textDim}" font-size="12">${pct}% (${data.pass}/${data.total})</text>`;
  }).join('\n    ');

  return `
  <div class="card">
    <h2>Category Breakdown</h2>
    <svg viewBox="0 0 ${svgW} ${svgH}" width="100%" style="max-width:${svgW}px">
      ${bars}
    </svg>
  </div>`;
}

function buildHtml(projectName, auditPayload, history) {
  const score = auditPayload.score ?? 0;
  const platform = auditPayload.platform || 'unknown';
  const results = auditPayload.results || [];
  const timestamp = new Date().toISOString();

  // Top 5 failed checks sorted by impact severity
  const impactOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const failed = results
    .filter(r => r.passed === false)
    .sort((a, b) => (impactOrder[a.impact] ?? 9) - (impactOrder[b.impact] ?? 9))
    .slice(0, 5);

  const failedRows = failed.length > 0
    ? failed.map(r =>
      `<tr><td>${escapeHtml(r.name || r.key)}</td><td class="impact-${r.impact || 'medium'}">${escapeHtml(r.impact || '-')}</td><td>${escapeHtml(r.category || '-')}</td></tr>`
    ).join('\n          ')
    : '<tr><td colspan="3" style="text-align:center;color:' + COLORS.green + '">All checks passing!</td></tr>';

  const scoreOverTime = buildScoreOverTimeSvg(history);
  const categoryBreakdown = buildCategoryBreakdownSvg(results);
  const drifts = detectDrifts(history);
  const driftAlerts = buildDriftAlertsHtml(drifts);

  const detectedPlatforms = auditPayload.detectedPlatforms
    || (auditPayload.platform ? [auditPayload.platform] : ['unknown']);
  const platformList = (Array.isArray(detectedPlatforms) ? detectedPlatforms : [detectedPlatforms])
    .map(p => `<span class="badge">${escapeHtml(p)}</span>`).join(' ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Nerviq Dashboard — ${escapeHtml(projectName)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:${COLORS.bg};color:${COLORS.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:2rem;max-width:900px;margin:0 auto}
  h1{font-size:1.6rem;margin-bottom:.3rem}
  h2{font-size:1.1rem;margin-bottom:1rem;color:${COLORS.textDim}}
  .timestamp{color:${COLORS.textDim};font-size:.85rem;margin-bottom:2rem}
  .card{background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:12px;padding:1.5rem;margin-bottom:1.5rem}
  .score-card{text-align:center;padding:2rem}
  .score-number{font-size:4rem;font-weight:800;line-height:1}
  .score-label{color:${COLORS.textDim};font-size:1rem;margin-top:.5rem}
  .badge{display:inline-block;background:${COLORS.border};padding:3px 10px;border-radius:6px;font-size:.85rem;margin:2px}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid ${COLORS.border}}
  th{color:${COLORS.textDim};font-weight:600;font-size:.85rem;text-transform:uppercase;letter-spacing:.03em}
  .impact-critical{color:${COLORS.red};font-weight:700}
  .impact-high{color:${COLORS.red}}
  .impact-medium{color:${COLORS.yellow}}
  .impact-low{color:${COLORS.textDim}}
  .footer{text-align:center;color:${COLORS.textDim};font-size:.8rem;margin-top:2rem;padding-top:1rem;border-top:1px solid ${COLORS.border}}
  .footer a{color:${COLORS.blue};text-decoration:none}
  .footer a:hover{text-decoration:underline}
  svg text{font-family:inherit}
</style>
</head>
<body>
  <h1>Nerviq Dashboard &mdash; ${escapeHtml(projectName)}</h1>
  <div class="timestamp">Generated ${timestamp}</div>

  <div class="card score-card">
    <div class="score-number" style="color:${scoreColor(score)}">${score}</div>
    <div class="score-label">out of 100</div>
  </div>

  <div class="card">
    <h2>Platforms Detected</h2>
    ${platformList}
  </div>

  <div class="card">
    <h2>Top Failed Checks</h2>
    <table>
      <thead><tr><th>Check</th><th>Impact</th><th>Category</th></tr></thead>
      <tbody>
        ${failedRows}
      </tbody>
    </table>
  </div>

  ${scoreOverTime}
  ${driftAlerts}
  ${categoryBreakdown}

  <div class="footer">
    Generated by <a href="https://github.com/nerviq/cli">Nerviq v${version}</a>
  </div>
</body>
</html>`;
}

/**
 * Generate a static HTML dashboard report.
 * @param {string} dir - Project root directory.
 * @param {Object} flags - CLI flags (--out, --open, --json, etc).
 */
async function generateDashboard(dir, flags = {}) {
  const outputFile = flags.out || 'nerviq-dashboard.html';
  const outputPath = path.isAbsolute(outputFile) ? outputFile : path.join(dir, outputFile);
  const projectName = path.basename(dir);

  // Collect audit history from snapshots
  const history = getHistory(dir, 50);
  let auditPayload = null;

  if (history.length > 0) {
    // Load the most recent audit snapshot
    auditPayload = loadSnapshotPayload(dir, history[0]);
  }

  if (!auditPayload) {
    // No snapshots — run a fresh audit
    const { audit } = require('./audit');
    auditPayload = await audit({ dir, silent: true, platform: flags.platform || 'claude' });
  }

  const html = buildHtml(projectName, auditPayload, history);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf8');

  const relPath = path.relative(dir, outputPath);
  if (!flags.json) {
    console.log('');
    console.log('  nerviq dashboard');
    console.log('  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
    console.log(`  Score: ${auditPayload.score ?? '?'}/100`);
    console.log(`  Snapshots: ${history.length}`);
    console.log(`  Output: ${relPath}`);
    console.log('');
  }

  if (flags.open) {
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32' ? `start "" "${outputPath}"`
      : process.platform === 'darwin' ? `open "${outputPath}"`
      : `xdg-open "${outputPath}"`;
    exec(cmd);
  }

  return { outputPath, relativePath: relPath, score: auditPayload.score };
}

/**
 * Detect score drift between recent snapshots.
 * Returns array of { from, to, delta, date } for drifts > threshold.
 */
function detectDrifts(history, threshold = 5) {
  if (!history || history.length < 2) return [];
  const drifts = [];
  for (let i = 0; i < history.length - 1; i++) {
    const current = history[i];
    const previous = history[i + 1];
    if (current.score != null && previous.score != null) {
      const delta = current.score - previous.score;
      if (Math.abs(delta) >= threshold) {
        drifts.push({
          date: current.date || current.timestamp,
          from: previous.score,
          to: current.score,
          delta,
        });
      }
    }
  }
  return drifts;
}

/**
 * Build drift alerts HTML section for the dashboard.
 */
function buildDriftAlertsHtml(drifts) {
  if (!drifts.length) return '';
  const rows = drifts.map(d => {
    const color = d.delta < 0 ? COLORS.red : COLORS.green;
    const arrow = d.delta < 0 ? '▼' : '▲';
    const sign = d.delta > 0 ? '+' : '';
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid ${COLORS.border}">${escapeHtml(d.date)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${COLORS.border}">${d.from} → ${d.to}</td>
      <td style="padding:8px 12px;border-bottom:1px solid ${COLORS.border};color:${color};font-weight:bold">${arrow} ${sign}${d.delta}</td>
    </tr>`;
  }).join('');

  return `
    <div style="margin-top:32px">
      <h2 style="color:${COLORS.text};font-size:18px;margin-bottom:12px">⚠ Score Drift Alerts</h2>
      <p style="color:${COLORS.textDim};font-size:13px;margin-bottom:12px">Changes of 5+ points between consecutive snapshots</p>
      <table style="width:100%;border-collapse:collapse;background:${COLORS.surface};border-radius:8px;overflow:hidden">
        <thead><tr style="background:${COLORS.border}">
          <th style="padding:8px 12px;text-align:left;color:${COLORS.textDim};font-size:12px">Date</th>
          <th style="padding:8px 12px;text-align:left;color:${COLORS.textDim};font-size:12px">Score Change</th>
          <th style="padding:8px 12px;text-align:left;color:${COLORS.textDim};font-size:12px">Delta</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * Build a portfolio HTML page summarizing multiple repos.
 */
function buildPortfolioHtml(repoResults) {
  const timestamp = new Date().toISOString();
  const scores = repoResults.map(r => r.score);
  const avgScore = repoResults.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const weakest = repoResults.reduce((a, b) => a.score <= b.score ? a : b, repoResults[0]);
  const strongest = repoResults.reduce((a, b) => a.score >= b.score ? a : b, repoResults[0]);

  const rows = repoResults.map(r => {
    const indicator = r.score >= 70 ? '\u{1F7E2}' : r.score >= 40 ? '\u{1F7E1}' : '\u{1F534}';
    const platforms = (r.platforms || ['unknown']).map(p => `<span class="badge">${escapeHtml(p)}</span>`).join(' ');
    const isWeak = r.name === weakest.name && repoResults.length > 1;
    const isStrong = r.name === strongest.name && repoResults.length > 1;
    const highlight = isWeak ? ' style="border-left:3px solid ' + COLORS.red + '"'
      : isStrong ? ' style="border-left:3px solid ' + COLORS.green + '"' : '';
    return `<tr${highlight}><td>${escapeHtml(r.name)}</td><td>${platforms}</td><td style="color:${scoreColor(r.score)};font-weight:700">${r.score}</td><td>${r.critical}</td><td>${r.high}</td><td>${indicator}</td></tr>`;
  }).join('\n          ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Nerviq Portfolio Dashboard</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:${COLORS.bg};color:${COLORS.text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:2rem;max-width:1000px;margin:0 auto}
  h1{font-size:1.6rem;margin-bottom:.3rem}
  h2{font-size:1.1rem;margin-bottom:1rem;color:${COLORS.textDim}}
  .timestamp{color:${COLORS.textDim};font-size:.85rem;margin-bottom:2rem}
  .card{background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:12px;padding:1.5rem;margin-bottom:1.5rem}
  .score-card{text-align:center;padding:2rem}
  .score-number{font-size:4rem;font-weight:800;line-height:1}
  .score-label{color:${COLORS.textDim};font-size:1rem;margin-top:.5rem}
  .badge{display:inline-block;background:${COLORS.border};padding:3px 10px;border-radius:6px;font-size:.85rem;margin:2px}
  .highlights{display:flex;gap:1.5rem;margin-bottom:1.5rem}
  .highlights .card{flex:1;text-align:center}
  .highlights .label{color:${COLORS.textDim};font-size:.85rem;margin-bottom:.5rem}
  .highlights .value{font-size:1.3rem;font-weight:700}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid ${COLORS.border}}
  th{color:${COLORS.textDim};font-weight:600;font-size:.85rem;text-transform:uppercase;letter-spacing:.03em}
  .footer{text-align:center;color:${COLORS.textDim};font-size:.8rem;margin-top:2rem;padding-top:1rem;border-top:1px solid ${COLORS.border}}
  .footer a{color:${COLORS.blue};text-decoration:none}
  .footer a:hover{text-decoration:underline}
</style>
</head>
<body>
  <h1>Nerviq Portfolio Dashboard</h1>
  <div class="timestamp">${repoResults.length} repos &mdash; Generated ${timestamp}</div>

  <div class="card score-card">
    <div class="score-number" style="color:${scoreColor(avgScore)}">${avgScore}</div>
    <div class="score-label">average score across ${repoResults.length} repos</div>
  </div>

  <div class="highlights">
    <div class="card">
      <div class="label">Strongest Repo</div>
      <div class="value" style="color:${COLORS.green}">${escapeHtml(strongest.name)} (${strongest.score})</div>
    </div>
    <div class="card">
      <div class="label">Weakest Repo</div>
      <div class="value" style="color:${COLORS.red}">${escapeHtml(weakest.name)} (${weakest.score})</div>
    </div>
  </div>

  <div class="card">
    <h2>Repository Summary</h2>
    <table>
      <thead><tr><th>Repo</th><th>Platform(s)</th><th>Score</th><th>Critical</th><th>High</th><th>Status</th></tr></thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>

  <div class="footer">
    Generated by <a href="https://github.com/nerviq/cli">Nerviq v${version}</a>
  </div>
</body>
</html>`;
}

/**
 * Generate a portfolio dashboard across multiple repos.
 * @param {string[]} repoPaths - Array of repo directory paths.
 * @param {Object} flags - CLI flags (--out, --open, --json, --platform).
 */
async function generatePortfolioDashboard(repoPaths, flags = {}) {
  const { audit } = require('./audit');
  const repoResults = [];

  for (const repoPath of repoPaths) {
    const absPath = path.isAbsolute(repoPath) ? repoPath : path.resolve(repoPath);
    if (!fs.existsSync(absPath)) {
      console.error(`  Warning: skipping ${repoPath} (not found)`);
      continue;
    }
    const name = path.basename(absPath);
    try {
      const result = await audit({ dir: absPath, silent: true, platform: flags.platform || 'claude' });
      const results = result.results || [];
      const critical = results.filter(r => !r.passed && r.impact === 'critical').length;
      const high = results.filter(r => !r.passed && r.impact === 'high').length;
      const platforms = result.detectedPlatforms || (result.platform ? [result.platform] : ['unknown']);
      repoResults.push({ name, score: result.score ?? 0, platforms, critical, high });
    } catch (err) {
      console.error(`  Warning: audit failed for ${name}: ${err.message}`);
      repoResults.push({ name, score: 0, platforms: ['error'], critical: 0, high: 0 });
    }
  }

  if (repoResults.length === 0) {
    console.error('\n  Error: no valid repos found.\n');
    process.exit(1);
  }

  const outputFile = flags.out || 'nerviq-portfolio.html';
  const outputPath = path.isAbsolute(outputFile) ? outputFile : path.resolve(outputFile);
  const html = buildPortfolioHtml(repoResults);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf8');

  const avgScore = Math.round(repoResults.reduce((s, r) => s + r.score, 0) / repoResults.length);
  if (!flags.json) {
    console.log('');
    console.log('  nerviq portfolio dashboard');
    console.log('  \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
    console.log(`  Repos: ${repoResults.length}`);
    console.log(`  Average score: ${avgScore}/100`);
    console.log(`  Output: ${outputPath}`);
    console.log('');
  }

  if (flags.open) {
    const { exec } = require('child_process');
    const cmd = process.platform === 'win32' ? `start "" "${outputPath}"`
      : process.platform === 'darwin' ? `open "${outputPath}"`
      : `xdg-open "${outputPath}"`;
    exec(cmd);
  }

  return { outputPath, repoCount: repoResults.length, avgScore, repos: repoResults };
}

module.exports = { generateDashboard, generatePortfolioDashboard, detectDrifts, buildDriftAlertsHtml };
