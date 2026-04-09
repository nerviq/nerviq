/**
 * Nerviq Integrations
 *
 * Webhook dispatch and message formatting for Slack, Discord,
 * and generic HTTP endpoints.
 *
 * All functions are synchronous-friendly; sendWebhook is async
 * (uses built-in https module, no external dependencies).
 */

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendWebhookOnce(parsed, body, opts = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const customHeaders = opts.headers || {};
    const headers = {
      'User-Agent': `nerviq/${require('../package.json').version}`,
      ...customHeaders,
      'Content-Length': Buffer.byteLength(body),
    };

    const hasContentTypeHeader = Object.keys(headers).some((name) => name.toLowerCase() === 'content-type');
    if (!hasContentTypeHeader) {
      headers['Content-Type'] = 'application/json';
    }

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: 'POST',
      headers,
    };

    const transport = parsed.protocol === 'https:' ? https : http;

    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const respBody = Buffer.concat(chunks).toString('utf8');
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: respBody });
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Webhook request timed out after ${timeoutMs}ms`));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Webhook delivery ────────────────────────────────────────────────────────

/**
 * POST JSON payload to a webhook URL.
 * @param {string} url  - Destination URL (http or https)
 * @param {object} payload - JSON-serialisable object
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=10000]
 * @param {object} [opts.headers]
 * @param {number} [opts.retries=2]
 * @param {number} [opts.retryDelayMs=400]
 * @returns {Promise<{ ok: boolean, status: number, body: string, attempts: number }>}
 */
async function sendWebhook(url, payload, opts = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid webhook URL: ${url}`);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Unsupported webhook protocol: ${parsed.protocol}`);
  }

  const body = JSON.stringify(payload);
  const retries = Number.isInteger(opts.retries) && opts.retries >= 0 ? opts.retries : 2;
  const retryDelayMs = Number.isFinite(opts.retryDelayMs) && opts.retryDelayMs >= 0 ? opts.retryDelayMs : 400;
  const maxAttempts = retries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await sendWebhookOnce(parsed, body, opts);
      const enriched = { ...response, attempts: attempt };
      const shouldRetry = RETRYABLE_STATUS_CODES.has(response.status) && attempt < maxAttempts;
      if (!shouldRetry) {
        return enriched;
      }
    } catch (error) {
      error.attempts = attempt;
      if (attempt >= maxAttempts) {
        throw error;
      }
    }

    const delayMs = retryDelayMs * attempt;
    if (delayMs > 0) {
      await wait(delayMs);
    }
  }

  return { ok: false, status: 0, body: '', attempts: maxAttempts };
}

// ─── Slack formatting ─────────────────────────────────────────────────────────

/**
 * Format an audit result as a Slack Block Kit message payload.
 * @param {object} auditResult - Result from audit()
 * @returns {object} Slack-compatible message payload (blocks API)
 */
function formatSlackMessage(auditResult) {
  const score = auditResult.score ?? 0;
  const platform = auditResult.platform ?? 'claude';
  const emoji = score >= 70 ? ':white_check_mark:' : score >= 40 ? ':warning:' : ':x:';
  const color = score >= 70 ? 'good' : score >= 40 ? 'warning' : 'danger';

  const criticals = (auditResult.results || [])
    .filter((r) => r.passed === false && r.impact === 'critical')
    .slice(0, 5);

  const sections = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} Nerviq Audit — ${platform}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Score*\n${score}/100` },
        { type: 'mrkdwn', text: `*Checks*\n${auditResult.passed ?? 0} pass / ${auditResult.failed ?? 0} fail` },
      ],
    },
  ];

  if (criticals.length > 0) {
    sections.push({ type: 'divider' });
    sections.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Critical gaps:*\n${criticals.map((r) => `• ${r.name}`).join('\n')}`,
      },
    });
  }

  if (auditResult.suggestedNextCommand) {
    sections.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Next step:* \`${auditResult.suggestedNextCommand}\`` },
    });
  }

  // Also include legacy attachment for clients that don't support blocks
  return {
    blocks: sections,
    attachments: [
      {
        color,
        fallback: `Nerviq audit (${platform}): ${score}/100 — ${auditResult.passed ?? 0} pass, ${auditResult.failed ?? 0} fail`,
      },
    ],
  };
}

// ─── Discord formatting ───────────────────────────────────────────────────────

/**
 * Format an audit result as a Discord webhook embed payload.
 * @param {object} auditResult - Result from audit()
 * @returns {object} Discord-compatible webhook payload (embeds)
 */
function formatDiscordMessage(auditResult) {
  const score = auditResult.score ?? 0;
  const platform = auditResult.platform ?? 'claude';
  const color = score >= 70 ? 0x2ecc71 : score >= 40 ? 0xf39c12 : 0xe74c3c; // green / yellow / red
  const icon = score >= 70 ? '✅' : score >= 40 ? '⚠️' : '❌';

  const criticals = (auditResult.results || [])
    .filter((r) => r.passed === false && r.impact === 'critical')
    .slice(0, 5);

  const highs = (auditResult.results || [])
    .filter((r) => r.passed === false && r.impact === 'high')
    .slice(0, 3);

  const fields = [
    { name: 'Score', value: `**${score}/100**`, inline: true },
    { name: 'Pass / Fail', value: `${auditResult.passed ?? 0} / ${auditResult.failed ?? 0}`, inline: true },
    { name: 'Platform', value: platform, inline: true },
  ];

  if (criticals.length > 0) {
    fields.push({
      name: '🚨 Critical',
      value: criticals.map((r) => `• ${r.name}`).join('\n'),
      inline: false,
    });
  }

  if (highs.length > 0) {
    fields.push({
      name: '⚠️ High',
      value: highs.map((r) => `• ${r.name}`).join('\n'),
      inline: false,
    });
  }

  if (auditResult.suggestedNextCommand) {
    fields.push({ name: '▶️ Next step', value: `\`${auditResult.suggestedNextCommand}\``, inline: false });
  }

  return {
    embeds: [
      {
        title: `${icon} Nerviq Audit — ${platform}`,
        color,
        fields,
        footer: { text: `nerviq v${require('../package.json').version} • ${new Date().toISOString()}` },
      },
    ],
  };
}

function formatGenericAuditWebhookEvent(auditResult, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const packageVersion = require('../package.json').version;

  return {
    event: 'nerviq.audit.completed',
    schemaVersion: '1.0',
    generatedAt,
    // Keep legacy summary fields at top-level for backward compatibility.
    platform: auditResult.platform ?? 'claude',
    score: auditResult.score ?? 0,
    passed: auditResult.passed ?? 0,
    failed: auditResult.failed ?? 0,
    results: Array.isArray(auditResult.results) ? auditResult.results : [],
    data: {
      platform: auditResult.platform ?? 'claude',
      platformLabel: auditResult.platformLabel ?? null,
      score: auditResult.score ?? 0,
      scoreType: auditResult.scoreType || 'live-audit-score',
      organicScore: auditResult.organicScore ?? null,
      passed: auditResult.passed ?? 0,
      failed: auditResult.failed ?? 0,
      skipped: auditResult.skipped ?? null,
      checkCount: auditResult.checkCount ?? 0,
      topNextActions: Array.isArray(auditResult.topNextActions) ? auditResult.topNextActions : [],
      quickWins: Array.isArray(auditResult.quickWins) ? auditResult.quickWins : [],
      scoreCoaching: auditResult.scoreCoaching || null,
      suggestedNextCommand: auditResult.suggestedNextCommand || null,
    },
    meta: {
      cliVersion: packageVersion,
      source: 'nerviq-cli',
      webhookFormat: 'generic-audit-event',
    },
  };
}

module.exports = { sendWebhook, formatSlackMessage, formatDiscordMessage, formatGenericAuditWebhookEvent };
