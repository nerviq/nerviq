const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { createServer } = require('../src/server');
const { version } = require('../package.json');

function makeTempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nerviq-server-${name}-`));
}

function requestJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: '127.0.0.1',
      port,
      path: pathname,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
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
    expect(response.body.status).toBe('ok');
  });

  test('/api/catalog returns array', async () => {
    const response = await requestJson(port, '/api/catalog');

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
  });

  // ─── Original tests ───────────────────────────────────────────────────

  test('/api/health reports version and full catalog count', async () => {
    const response = await requestJson(port, '/api/health');

    expect(response.statusCode).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.version).toBe(version);
    expect(response.body.checks).toBe(2431);
  });

  test('/api/catalog returns the full catalog payload', async () => {
    const response = await requestJson(port, '/api/catalog');

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(2431);
  });

  test('/api/audit returns structured audit JSON', async () => {
    const dir = makeTempDir('audit');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude\n', 'utf8');
    const encodedDir = encodeURIComponent(dir);

    const response = await requestJson(port, `/api/audit?platform=claude&dir=${encodedDir}`);

    expect(response.statusCode).toBe(200);
    expect(response.body.platform).toBe('claude');
    expect(typeof response.body.score).toBe('number');
    expect(Array.isArray(response.body.results)).toBe(true);
  });
});
