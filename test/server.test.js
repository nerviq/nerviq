const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { createServer } = require('../src/server');
const { version } = require('../package.json');
// Canonical check count lives in release-metadata.json (guarded by
// verify:release-metadata) so a catalog change is exactly one edit,
// not a hunt for stale literals across test files.
const { checks: CANONICAL_CHECK_COUNT } = require('../release-metadata.json');

function makeTempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-server-${name}-`));
}

function requestJson(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: JSON.parse(data),
        });
      });
    });

    req.on('error', reject);
  });
}

describe('HTTP server', () => {
  let server;
  let port;

  beforeEach(async () => {
    server = createServer({ baseDir: process.cwd() });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
  });

  // ─── QP-A05: Server integration tests ─────────────────────────────────

  test('createServer returns object with listen method', () => {
    const srv = createServer({ baseDir: process.cwd() });
    expect(srv).toBeDefined();
    expect(typeof srv.listen).toBe('function');
  });

  test('/api/health returns { status: "ok" }', async () => {
    const response = await requestJson(port, '/api/health');

    expect(response.statusCode).toBe(200);
    expect(response.body.data.status).toBe('ok');
  });

  test('test_should_reject_request_when_host_header_is_not_loopback (DNS-rebinding guard)', async () => {
    const response = await requestJson(port, '/api/health', { Host: 'evil.example.com' });

    expect(response.statusCode).toBe(403);
    expect(response.body.error).toMatch(/Host header/);
  });

  test('test_should_not_emit_cors_headers_when_responding (local-first API, no browser exposure)', async () => {
    const response = await requestJson(port, '/api/health');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('/api/catalog returns array', async () => {
    const response = await requestJson(port, '/api/catalog');

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThan(0);
  });

  // ─── Original tests ───────────────────────────────────────────────────

  test('/api/health reports version and full catalog count', async () => {
    const response = await requestJson(port, '/api/health');

    expect(response.statusCode).toBe(200);
    expect(response.body.data.status).toBe('ok');
    expect(response.body.data.version).toBe(version);
    expect(response.body.data.checks).toBe(CANONICAL_CHECK_COUNT);
    expect(response.body.meta.version).toBe(version);
  });

  test('/api/catalog returns the full catalog payload', async () => {
    const response = await requestJson(port, '/api/catalog');

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(CANONICAL_CHECK_COUNT);
  });

  test('/api/audit returns structured audit JSON', async () => {
    const dir = makeTempDir('audit');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude\n', 'utf8');
    const encodedDir = encodeURIComponent(dir);

    const response = await requestJson(port, `/api/audit?platform=claude&dir=${encodedDir}`);

    expect(response.statusCode).toBe(200);
    expect(response.body.data.platform).toBe('claude');
    expect(typeof response.body.data.score).toBe('number');
    expect(Array.isArray(response.body.data.results)).toBe(true);
  });
});
