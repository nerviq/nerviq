const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { version } = require('../package.json');
const { audit } = require('./audit');
const { harmonyAudit } = require('./harmony/audit');
const { getCatalog } = require('./public-api');

const SUPPORTED_PLATFORMS = [
  'claude',
  'codex',
  'gemini',
  'copilot',
  'cursor',
  'windsurf',
  'aider',
  'opencode',
];
const SUPPORTED_PLATFORM_SET = new Set(SUPPORTED_PLATFORMS);

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

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * DNS-rebinding defense. Loopback binding alone does not stop a malicious
 * web page from pointing an attacker-controlled hostname at 127.0.0.1 and
 * reading this API — validating the Host header does.
 */
function isAllowedHostHeader(hostHeader, boundHost) {
  if (!hostHeader) return false;
  const host = String(hostHeader).replace(/:\d+$/, '').toLowerCase();
  return LOOPBACK_HOSTNAMES.has(host) || host === String(boundHost || '').toLowerCase();
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
  if (!SUPPORTED_PLATFORM_SET.has(platform)) {
    const error = new Error(`Unsupported platform '${rawPlatform}'.`);
    error.statusCode = 400;
    throw error;
  }
  return platform;
}

function buildEnvelopeSchema(dataSchema) {
  return {
    type: 'object',
    required: ['data', 'meta'],
    properties: {
      data: dataSchema,
      meta: { $ref: '#/components/schemas/ResponseMeta' },
    },
  };
}

function buildServeOpenApiSpec(options = {}) {
  const serverUrl = options.serverUrl || 'http://127.0.0.1:3000';
  const catalogSize = options.catalogSize == null ? getCatalog().length : options.catalogSize;

  return {
    openapi: '3.1.0',
    info: {
      title: 'Nerviq Local API',
      version,
      summary: 'Zero-dependency local REST surface for audit, harmony, catalog, and health data.',
      description: [
        'Nerviq exposes a local-first HTTP API through `nerviq serve`.',
        'Operational endpoints are GET-only, return JSON, and wrap successful payloads in `{ data, meta }` envelopes.',
        'The OpenAPI document itself is available at `/api/openapi.json`.',
      ].join(' '),
    },
    servers: [
      {
        url: serverUrl,
        description: 'Current Nerviq serve instance',
      },
    ],
    tags: [
      { name: 'system', description: 'Server health and contract discovery.' },
      { name: 'audit', description: 'Repository audit and governance scoring.' },
      { name: 'harmony', description: 'Cross-platform alignment and drift analysis.' },
      { name: 'catalog', description: 'Unified public check catalog.' },
    ],
    paths: {
      '/api/openapi.json': {
        get: {
          tags: ['system'],
          operationId: 'getOpenApiSpec',
          summary: 'Return the live OpenAPI contract for this Nerviq serve instance.',
          responses: {
            200: {
              description: 'OpenAPI 3.1 document for the active server surface.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['openapi', 'info', 'paths'],
                    properties: {
                      openapi: { type: 'string', example: '3.1.0' },
                      info: { type: 'object' },
                      servers: { type: 'array', items: { type: 'object' } },
                      paths: { type: 'object' },
                    },
                  },
                },
              },
            },
            405: {
              $ref: '#/components/responses/MethodNotAllowed',
            },
          },
        },
      },
      '/api/health': {
        get: {
          tags: ['system'],
          operationId: 'getHealth',
          summary: 'Check local server readiness and catalog size.',
          responses: {
            200: {
              description: 'Current server health envelope.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthEnvelope' },
                },
              },
            },
            405: {
              $ref: '#/components/responses/MethodNotAllowed',
            },
            500: {
              $ref: '#/components/responses/InternalError',
            },
          },
        },
      },
      '/api/catalog': {
        get: {
          tags: ['catalog'],
          operationId: 'getCatalog',
          summary: 'Return the merged public check catalog.',
          responses: {
            200: {
              description: 'Full catalog envelope.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/CatalogEnvelope' },
                },
              },
            },
            405: {
              $ref: '#/components/responses/MethodNotAllowed',
            },
            500: {
              $ref: '#/components/responses/InternalError',
            },
          },
        },
      },
      '/api/audit': {
        get: {
          tags: ['audit'],
          operationId: 'runAudit',
          summary: 'Run a Nerviq audit for one directory and one platform.',
          parameters: [
            { $ref: '#/components/parameters/DirParam' },
            { $ref: '#/components/parameters/PlatformParam' },
          ],
          responses: {
            200: {
              description: 'Audit result envelope.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AuditEnvelope' },
                },
              },
            },
            400: {
              $ref: '#/components/responses/BadRequest',
            },
            405: {
              $ref: '#/components/responses/MethodNotAllowed',
            },
            500: {
              $ref: '#/components/responses/InternalError',
            },
          },
        },
      },
      '/api/harmony': {
        get: {
          tags: ['harmony'],
          operationId: 'runHarmonyAudit',
          summary: 'Run cross-platform harmony audit and drift analysis.',
          parameters: [
            { $ref: '#/components/parameters/DirParam' },
          ],
          responses: {
            200: {
              description: 'Harmony result envelope.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HarmonyEnvelope' },
                },
              },
            },
            400: {
              $ref: '#/components/responses/BadRequest',
            },
            405: {
              $ref: '#/components/responses/MethodNotAllowed',
            },
            500: {
              $ref: '#/components/responses/InternalError',
            },
          },
        },
      },
    },
    components: {
      parameters: {
        DirParam: {
          name: 'dir',
          in: 'query',
          required: false,
          description: 'Directory to audit. Relative paths resolve from the server base directory. Defaults to `.`.',
          schema: {
            type: 'string',
            default: '.',
          },
        },
        PlatformParam: {
          name: 'platform',
          in: 'query',
          required: false,
          description: 'Target platform to audit. Defaults to `claude` when omitted.',
          schema: {
            type: 'string',
            enum: SUPPORTED_PLATFORMS,
            default: 'claude',
          },
        },
      },
      responses: {
        BadRequest: {
          description: 'Validation error such as unsupported platform or missing directory.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        MethodNotAllowed: {
          description: 'Only GET and OPTIONS are supported on this local API.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        InternalError: {
          description: 'Unexpected server-side failure while building the response.',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string' },
          },
        },
        ResponseMeta: {
          type: 'object',
          required: ['version', 'timestamp'],
          properties: {
            version: {
              type: 'string',
              example: version,
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        HealthPayload: {
          type: 'object',
          required: ['status', 'version', 'checks'],
          properties: {
            status: { type: 'string', example: 'ok' },
            version: { type: 'string', example: version },
            checks: { type: 'integer', example: catalogSize },
          },
        },
        CatalogEntry: {
          type: 'object',
          properties: {
            platform: { type: 'string', example: 'claude' },
            id: { type: 'string', example: 'CL-A01' },
            key: { type: 'string', example: 'claudeMd' },
            name: { type: 'string', example: 'CLAUDE.md project instructions' },
            category: { type: 'string', example: 'memory' },
            impact: { type: 'string', example: 'critical' },
            fix: { type: 'string' },
            sourceUrl: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
          additionalProperties: true,
        },
        AuditStack: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            label: { type: 'string' },
          },
          additionalProperties: true,
        },
        AuditAction: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            name: { type: 'string' },
            impact: { type: 'string' },
            fix: { type: 'string' },
          },
          additionalProperties: true,
        },
        AuditCheck: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            name: { type: 'string' },
            impact: { type: 'string' },
            category: { type: 'string' },
            passed: {
              oneOf: [
                { type: 'boolean' },
                { type: 'null' },
              ],
            },
          },
          additionalProperties: true,
        },
        AuditPayload: {
          type: 'object',
          properties: {
            platform: { type: 'string', example: 'claude' },
            platformLabel: { type: 'string', example: 'Claude Code' },
            score: { type: 'integer', minimum: 0, maximum: 100 },
            organicScore: { type: 'integer', minimum: 0, maximum: 100 },
            earnedPoints: { type: 'integer' },
            maxPoints: { type: 'integer' },
            isScaffolded: { type: 'boolean' },
            passed: { type: 'integer' },
            failed: { type: 'integer' },
            skipped: { type: 'integer' },
            checkCount: { type: 'integer' },
            stacks: {
              type: 'array',
              items: { $ref: '#/components/schemas/AuditStack' },
            },
            topNextActions: {
              type: 'array',
              items: { $ref: '#/components/schemas/AuditAction' },
            },
            results: {
              type: 'array',
              items: { $ref: '#/components/schemas/AuditCheck' },
            },
          },
          additionalProperties: true,
        },
        HarmonyRecommendation: {
          type: 'object',
          properties: {
            priority: { type: 'string' },
            category: { type: 'string' },
            message: { type: 'string' },
          },
          additionalProperties: true,
        },
        ActivePlatform: {
          type: 'object',
          properties: {
            platform: { type: 'string' },
            label: { type: 'string' },
          },
          additionalProperties: true,
        },
        HarmonyPayload: {
          type: 'object',
          properties: {
            harmonyScore: { type: 'integer', minimum: 0, maximum: 100 },
            platformScores: {
              type: 'object',
              additionalProperties: { type: 'integer' },
            },
            drift: {
              type: 'object',
              additionalProperties: true,
            },
            recommendations: {
              type: 'array',
              items: { $ref: '#/components/schemas/HarmonyRecommendation' },
            },
            activePlatforms: {
              type: 'array',
              items: { $ref: '#/components/schemas/ActivePlatform' },
            },
          },
          additionalProperties: true,
        },
        HealthEnvelope: buildEnvelopeSchema({ $ref: '#/components/schemas/HealthPayload' }),
        CatalogEnvelope: buildEnvelopeSchema({
          type: 'array',
          items: { $ref: '#/components/schemas/CatalogEntry' },
        }),
        AuditEnvelope: buildEnvelopeSchema({ $ref: '#/components/schemas/AuditPayload' }),
        HarmonyEnvelope: buildEnvelopeSchema({ $ref: '#/components/schemas/HarmonyPayload' }),
      },
    },
  };
}

function createServer(options = {}) {
  const baseDir = path.resolve(options.baseDir || process.cwd());
  const boundHost = options.host || '127.0.0.1';

  return http.createServer(async (req, res) => {
    // No CORS headers on purpose: this is a local-first API for CLI/CI
    // tooling, not for browser pages. A wildcard here let any web page
    // read audit results (and repo paths) off the developer's machine.
    if (!isAllowedHostHeader(req.headers.host, boundHost)) {
      sendJson(res, 403, { error: 'Forbidden: unrecognized Host header (DNS-rebinding guard)' });
      return;
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    try {
      if (requestUrl.pathname === '/api/openapi.json') {
        sendJson(res, 200, buildServeOpenApiSpec({
          serverUrl: `http://${req.headers.host || '127.0.0.1:3000'}`,
        }));
        return;
      }

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
  buildServeOpenApiSpec,
  createServer,
  startServer,
};
