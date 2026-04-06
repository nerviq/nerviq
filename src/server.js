const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { version } = require('../package.json');
const { audit } = require('./audit');
const { harmonyAudit } = require('./harmony/audit');
const { getCatalog } = require('./public-api');

const SUPPORTED_PLATFORMS = new Set([
  'claude',
  'codex',
  'gemini',
  'copilot',
  'cursor',
  'windsurf',
  'aider',
  'opencode',
]);

function envelope(data) {
  return { data, meta: { version, timestamp: new Date().toISOString() } };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function resolveRequestDir(baseDir, rawDir) {
  const requested = rawDir || '.';
  const resolved = path.isAbsolute(requested)
    ? requested
    : path.resolve(baseDir, requested);

  if (!fs.existsSync(resolved)) {
    const error = new Error(`Directory not found: ${resolved}`);
    error.statusCode = 400;
    throw error;
  }

  return resolved;
}

function normalizePlatform(rawPlatform) {
  const platform = (rawPlatform || 'claude').toLowerCase();
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    const error = new Error(`Unsupported platform '${rawPlatform}'.`);
    error.statusCode = 400;
    throw error;
  }
  return platform;
}

function createServer(options = {}) {
  const baseDir = path.resolve(options.baseDir || process.cwd());

  return http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      if (requestUrl.pathname === '/api/health') {
        sendJson(res, 200, envelope({
          status: 'ok',
          version,
          checks: getCatalog().length,
        }));
        return;
      }

      if (requestUrl.pathname === '/api/catalog') {
        sendJson(res, 200, envelope(getCatalog()));
        return;
      }

      if (requestUrl.pathname === '/api/audit') {
        const dir = resolveRequestDir(baseDir, requestUrl.searchParams.get('dir'));
        const platform = normalizePlatform(requestUrl.searchParams.get('platform'));
        const result = await audit({ dir, platform, silent: true });
        sendJson(res, 200, envelope(result));
        return;
      }

      if (requestUrl.pathname === '/api/harmony') {
        const dir = resolveRequestDir(baseDir, requestUrl.searchParams.get('dir'));
        const result = await harmonyAudit({ dir, silent: true });
        sendJson(res, 200, envelope(result));
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      sendJson(res, error.statusCode || 500, {
        error: error.message,
      });
    }
  });
}

function startServer(options = {}) {
  const port = options.port == null ? 3000 : Number(options.port);
  const host = options.host || '127.0.0.1';
  const server = createServer(options);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

module.exports = {
  createServer,
  startServer,
};
