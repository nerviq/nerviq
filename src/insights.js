/**
 * Anonymous insights collection - opt-in, privacy-first.
 *
 * What we collect (anonymously, no PII):
 * - Score distribution (10/100, 45/100, etc.)
 * - Stack detection (React+TS, Python+Docker, etc.)
 * - Which checks fail most
 * - Which checks pass most
 * - OS + Node version
 *
 * What we NEVER collect:
 * - File contents, paths, or project names
 * - IP addresses or user identity
 * - API keys, tokens, or credentials
 * - Any data if user opts out
 *
 * Users can opt out with: npx nerviq --no-insights
 * Or set env: NERVIQ_NO_INSIGHTS=1
 */

const https = require('https');
const os = require('os');

const INSIGHTS_ENDPOINT = 'https://insights.nerviq.net/v1/report';
const TIMEOUT_MS = 3000;

function shouldCollect() {
  // Opt-IN: only collect if user explicitly enables
  if (process.env.NERVIQ_INSIGHTS === '1') return true;
  if (process.argv.includes('--insights')) return true;
  return false;
}

function buildPayload(auditResult) {
  // Only anonymous aggregate data - no PII, no file contents, no paths
  const failedChecks = auditResult.results
    .filter(r => !r.passed)
    .map(r => r.key);

  const passedChecks = auditResult.results
    .filter(r => r.passed)
    .map(r => r.key);

  return {
    v: 1,
    score: auditResult.score,
    passed: auditResult.passed,
    failed: auditResult.failed,
    stacks: (auditResult.stacks || []).map(s => s.label),
    failedChecks,
    passedChecks,
    platform: os.platform(),
    nodeVersion: process.version,
    toolVersion: require('../package.json').version,
    timestamp: new Date().toISOString(),
  };
}

function sendInsights(auditResult) {
  if (!shouldCollect()) return;

  try {
    const payload = JSON.stringify(buildPayload(auditResult));
    const url = new URL(INSIGHTS_ENDPOINT);

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: TIMEOUT_MS,
    });

    // Fire and forget - never block the CLI
    req.on('error', () => {}); // silently ignore
    req.on('timeout', () => req.destroy());
    req.write(payload);
    req.end();
  } catch (e) {
    // Never let insights crash the CLI
  }
}

/**
 * Generate insights summary from local audit history.
 * This runs locally - no network needed.
 */
function getLocalInsights(auditResult) {
  const { results } = auditResult;
  const applicable = results.filter(r => r.passed !== null);
  const failed = applicable.filter(r => r.passed === false);

  // Top 3 most impactful fixes
  const impactOrder = { critical: 3, high: 2, medium: 1 };
  const topFixes = [...failed]
    .sort((a, b) => (impactOrder[b.impact] || 0) - (impactOrder[a.impact] || 0))
    .slice(0, 3)
    .map(r => ({ name: r.name, impact: r.impact, fix: r.fix }));

  // Score breakdown by category
  const categories = {};
  for (const r of applicable) {
    const cat = r.category || 'other';
    if (!categories[cat]) categories[cat] = { passed: 0, total: 0 };
    categories[cat].total++;
    if (r.passed) categories[cat].passed++;
  }

  // Weakest categories
  const weakest = Object.entries(categories)
    .map(([name, data]) => ({ name, score: Math.round((data.passed / data.total) * 100), ...data }))
    .filter(c => c.score < 100)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  return { topFixes, categories, weakest, totalScore: auditResult.score };
}

module.exports = { sendInsights, getLocalInsights, shouldCollect };
