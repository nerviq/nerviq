/**
 * Api technique fragments.
 * Generated mechanically from the legacy techniques.js monolith during HR-09.
 */

const {
  findProjectFiles,
  hasProjectFile,
  readProjectFiles,
} = require('./shared');

module.exports = {
  websocketLib: {
      id: 130201,
      name: 'WebSocket library configured',
      check: (ctx) => {
        const deps = ctx.fileContent('package.json') || '';
        const pyDeps = ctx.fileContent('requirements.txt') || '';
        const goDeps = ctx.fileContent('go.mod') || '';
        return /socket\.io|"ws"|sockjs|@nestjs\/websockets|phoenix|channels/i.test(deps) ||
               /websockets|channels|tornado/i.test(pyDeps) ||
               /gorilla\/websocket|nhooyr\.io\/websocket/i.test(goDeps) || null;
      },
      impact: 'low',
      category: 'realtime',
      fix: 'Add a WebSocket library for real-time communication if your app needs live updates.',
      confidence: 0.7,
    },

  sseEndpoint: {
      id: 130202,
      name: 'Server-Sent Events patterns detected',
      check: (ctx) => {
        const codeFiles = findProjectFiles(ctx, /\.(js|ts|jsx|tsx|py|go|rb)$/i);
        if (codeFiles.length === 0) return null;
        return codeFiles.some(f => {
          const content = ctx.fileContent(f) || '';
          return /EventSource|text\/event-stream|SSE/i.test(content);
        }) || null;
      },
      impact: 'low',
      category: 'realtime',
      fix: 'Consider Server-Sent Events (SSE) for server-to-client streaming when full duplex is not needed.',
      confidence: 0.7,
    },

  realtimeDatabase: {
      id: 130203,
      name: 'Real-time database configured',
      check: (ctx) => {
        const deps = ctx.fileContent('package.json') || '';
        const pyDeps = ctx.fileContent('requirements.txt') || '';
        return /firebase-admin|supabase|convex|pusher/i.test(deps) ||
               /firebase-admin|supabase|pusher/i.test(pyDeps) || null;
      },
      impact: 'low',
      category: 'realtime',
      fix: 'Add a real-time database (Firebase, Supabase, Convex) for live data synchronization.',
      confidence: 0.7,
    },

  pubsubPattern: {
      id: 130204,
      name: 'Pub/sub messaging configured',
      check: (ctx) => {
        const deps = ctx.fileContent('package.json') || '';
        const pyDeps = ctx.fileContent('requirements.txt') || '';
        const goDeps = ctx.fileContent('go.mod') || '';
        return /ioredis|redis|nats|kafkajs|amqplib|bullmq/i.test(deps) ||
               /redis|nats-py|kafka-python|pika|celery/i.test(pyDeps) ||
               /go-redis|nats\.go|sarama|amqp091-go/i.test(goDeps) || null;
      },
      impact: 'low',
      category: 'realtime',
      fix: 'Add a pub/sub messaging system (Redis, NATS, Kafka, RabbitMQ) for decoupled real-time communication.',
      confidence: 0.7,
    },

  realtimeAuth: {
      id: 130205,
      name: 'WebSocket authentication patterns present',
      check: (ctx) => {
        const codeFiles = findProjectFiles(ctx, /\.(js|ts|jsx|tsx|py|go)$/i);
        if (codeFiles.length === 0) return null;
        return codeFiles.some(f => {
          const content = ctx.fileContent(f) || '';
          return /ws.*auth|socket.*token|connection.*auth|handleConnection.*jwt|on.*connect.*verify/i.test(content);
        }) || null;
      },
      impact: 'low',
      category: 'realtime',
      fix: 'Add authentication to WebSocket connections — validate tokens on connect to prevent unauthorized access.',
      confidence: 0.7,
    },

  graphqlSchema: {
      id: 130206,
      name: 'GraphQL schema defined',
      check: (ctx) => {
        const deps = ctx.fileContent('package.json') || '';
        const pyDeps = ctx.fileContent('requirements.txt') || '';
        if (!/graphql|apollo|@nestjs\/graphql|type-graphql/i.test(deps) &&
            !/graphene|ariadne|strawberry/i.test(pyDeps) &&
            !hasProjectFile(ctx, /\.graphql$/i)) return null;
        const schemaFiles = findProjectFiles(ctx, /\.(graphql|gql)$/i);
        if (schemaFiles.length > 0) return true;
        const codeFiles = findProjectFiles(ctx, /\.(js|ts|py)$/i);
        return codeFiles.some(f => {
          const content = ctx.fileContent(f) || '';
          return /buildSchema|makeExecutableSchema|typeDefs|@ObjectType|type Query/i.test(content);
        }) || false;
      },
      impact: 'low',
      category: 'graphql',
      fix: 'Define a GraphQL schema using .graphql files or schema-first/code-first approach.',
      confidence: 0.7,
    },

  graphqlResolvers: {
      id: 130207,
      name: 'GraphQL resolvers implemented',
      check: (ctx) => {
        const deps = ctx.fileContent('package.json') || '';
        const pyDeps = ctx.fileContent('requirements.txt') || '';
        if (!/graphql|apollo|@nestjs\/graphql|type-graphql/i.test(deps) &&
            !/graphene|ariadne|strawberry/i.test(pyDeps) &&
            !hasProjectFile(ctx, /\.graphql$/i)) return null;
        const codeFiles = findProjectFiles(ctx, /\.(js|ts|py)$/i);
        return codeFiles.some(f => {
          const content = ctx.fileContent(f) || '';
          return /@Resolver|@Query|@Mutation|resolvers|resolve_/i.test(content) ||
                 /resolver/i.test(f);
        }) || false;
      },
      impact: 'low',
      category: 'graphql',
      fix: 'Implement GraphQL resolvers to handle queries, mutations, and field resolution.',
      confidence: 0.7,
    },

  graphqlCodegen: {
      id: 130208,
      name: 'GraphQL code generation configured',
      check: (ctx) => {
        const deps = ctx.fileContent('package.json') || '';
        const pyDeps = ctx.fileContent('requirements.txt') || '';
        if (!/graphql|apollo|@nestjs\/graphql|type-graphql/i.test(deps) &&
            !/graphene|ariadne|strawberry/i.test(pyDeps) &&
            !hasProjectFile(ctx, /\.graphql$/i)) return null;
        return /@graphql-codegen|graphql-let|graphql-code-generator/i.test(deps) || false;
      },
      impact: 'low',
      category: 'graphql',
      fix: 'Add @graphql-codegen for type-safe GraphQL operations and automatic TypeScript type generation.',
      confidence: 0.7,
    },

  graphqlNPlusOne: {
      id: 130209,
      name: 'GraphQL N+1 prevention (DataLoader)',
      check: (ctx) => {
        const deps = ctx.fileContent('package.json') || '';
        const pyDeps = ctx.fileContent('requirements.txt') || '';
        if (!/graphql|apollo|@nestjs\/graphql|type-graphql/i.test(deps) &&
            !/graphene|ariadne|strawberry/i.test(pyDeps) &&
            !hasProjectFile(ctx, /\.graphql$/i)) return null;
        const codeFiles = findProjectFiles(ctx, /\.(js|ts|py)$/i);
        return /dataloader/i.test(deps) ||
               /aiodataloader|promise/i.test(pyDeps) ||
               codeFiles.some(f => /dataloader|batch.*load|DataLoader/i.test(ctx.fileContent(f) || '')) || false;
      },
      impact: 'low',
      category: 'graphql',
      fix: 'Use DataLoader or batch loading patterns to prevent N+1 query problems in GraphQL resolvers.',
      confidence: 0.7,
    },

  graphqlSubscriptions: {
      id: 130210,
      name: 'GraphQL subscriptions configured',
      check: (ctx) => {
        const deps = ctx.fileContent('package.json') || '';
        const pyDeps = ctx.fileContent('requirements.txt') || '';
        if (!/graphql|apollo|@nestjs\/graphql|type-graphql/i.test(deps) &&
            !/graphene|ariadne|strawberry/i.test(pyDeps) &&
            !hasProjectFile(ctx, /\.graphql$/i)) return null;
        return /subscriptions-transport-ws|graphql-ws/i.test(deps) ||
               findProjectFiles(ctx, /\.(js|ts|py)$/i).some(f => {
                 const content = ctx.fileContent(f) || '';
                 return /@Subscription|PubSub|subscription\s+\w+/i.test(content);
               }) || false;
      },
      impact: 'low',
      category: 'graphql',
      fix: 'Configure GraphQL subscriptions with graphql-ws for real-time data pushed to clients.',
      confidence: 0.7,
    },

  apiVersionHeader: {
      id: 130111,
      name: 'API versioning pattern present',
      check: (ctx) => {
        const src = readProjectFiles(ctx, /\.(jsx?|tsx?|py|go|java|rb)$/i, 30);
        const config = readProjectFiles(ctx, /\.(ya?ml|json)$/i, 20);
        return /\/v[12]\/|api-version|Accept-Version|x-api-version/i.test(src + config);
      },
      impact: 'medium',
      category: 'api-versioning',
      fix: 'Add API versioning (URL prefix /v1/, header Accept-Version) to manage breaking changes safely.',
      confidence: 0.7,
    },

  deprecationNotices: {
      id: 130112,
      name: 'Deprecation notices in API code',
      check: (ctx) => {
        const src = readProjectFiles(ctx, /\.(jsx?|tsx?|py|go|java|rb)$/i, 30);
        return /@deprecated|Deprecation|Sunset|x-deprecated/i.test(src);
      },
      impact: 'low',
      category: 'api-versioning',
      fix: 'Add @deprecated annotations or Deprecation/Sunset headers to signal API endpoint retirement.',
      confidence: 0.7,
    },

  apiChangelog: {
      id: 130113,
      name: 'API changelog exists',
      check: (ctx) => {
        if (hasProjectFile(ctx, /(^|\/)api-changelog/i)) return true;
        const changelog = ctx.fileContent('CHANGELOG.md') || '';
        return /\bAPI\b/i.test(changelog);
      },
      impact: 'low',
      category: 'api-versioning',
      fix: 'Add an API changelog (CHANGELOG.md with API section or api-changelog file) to document breaking changes.',
      confidence: 0.7,
    },

  backwardCompat: {
      id: 130114,
      name: 'Backward compatibility tests or migrations',
      check: (ctx) => {
        return hasProjectFile(ctx, /(^|\/)(migration|migrate)/i) ||
          hasProjectFile(ctx, /(backward|compat).*test/i);
      },
      impact: 'medium',
      category: 'api-versioning',
      fix: 'Add backward compatibility tests or migration scripts to validate API changes don\'t break clients.',
      confidence: 0.7,
    },

  apiDocVersioned: {
      id: 130115,
      name: 'Versioned API documentation',
      check: (ctx) => {
        const docs = readProjectFiles(ctx, /(openapi|swagger)\.(ya?ml|json)$/i);
        return /version/i.test(docs);
      },
      impact: 'low',
      category: 'api-versioning',
      fix: 'Add versioned API documentation (OpenAPI/Swagger spec with version field) for API consumers.',
      confidence: 0.7,
    },

  cacheLayer: {
      id: 130121,
      name: 'Cache library in dependencies',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        if (/redis|memcached|ioredis|node-cache|lru-cache/i.test(pkg)) return true;
        const py = readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i) + readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
        if (/redis|memcached|django-cache|cachetools/i.test(py)) return true;
        return false;
      },
      impact: 'medium',
      category: 'caching',
      fix: 'Add a caching layer (redis, memcached, ioredis, lru-cache) to reduce latency and database load.',
      confidence: 0.7,
    },

  cdnConfigured: {
      id: 130122,
      name: 'CDN configured',
      check: (ctx) => {
        const config = readProjectFiles(ctx, /\.(json|ya?ml|toml|conf)$/i, 20);
        const src = readProjectFiles(ctx, /\.(jsx?|tsx?)$/i, 20);
        return /cloudfront|cloudflare|fastly|cdn/i.test(config + src) ||
          (ctx.files.includes('vercel.json') && /headers/i.test(ctx.fileContent('vercel.json') || ''));
      },
      impact: 'medium',
      category: 'caching',
      fix: 'Configure a CDN (CloudFront, Cloudflare, Fastly) for static asset delivery and edge caching.',
      confidence: 0.7,
    },

  cacheHeaders: {
      id: 130123,
      name: 'Cache-Control headers configured',
      check: (ctx) => {
        const src = readProjectFiles(ctx, /\.(jsx?|tsx?|py|go|java|rb|conf)$/i, 30);
        return /Cache-Control|max-age|s-maxage|stale-while-revalidate/i.test(src);
      },
      impact: 'medium',
      category: 'caching',
      fix: 'Set Cache-Control headers (max-age, s-maxage, stale-while-revalidate) for HTTP response caching.',
      confidence: 0.7,
    },

  cacheInvalidation: {
      id: 130124,
      name: 'Cache invalidation patterns present',
      check: (ctx) => {
        const src = readProjectFiles(ctx, /\.(jsx?|tsx?|py|go|java|rb)$/i, 30);
        return /cache.*purge|cache.*bust|cache.*invalidat|\.del\(|\.flush\(/i.test(src);
      },
      impact: 'low',
      category: 'caching',
      fix: 'Implement cache invalidation patterns (purge, bust, invalidate) to prevent serving stale data.',
      confidence: 0.7,
    },

  httpCaching: {
      id: 130125,
      name: 'ETag or Last-Modified caching',
      check: (ctx) => {
        const src = readProjectFiles(ctx, /\.(jsx?|tsx?|py|go|java|rb|conf)$/i, 30);
        return /ETag|Last-Modified|If-None-Match|If-Modified-Since/i.test(src);
      },
      impact: 'low',
      category: 'caching',
      fix: 'Implement ETag or Last-Modified headers for conditional HTTP caching and bandwidth savings.',
      confidence: 0.7,
    },

  rateLimitMiddleware: {
      id: 130131,
      name: 'Rate limiting middleware configured',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        if (/express-rate-limit|@nestjs\/throttler|rate-limiter-flexible|koa-ratelimit/i.test(pkg)) return true;
        const py = readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i) + readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
        if (/django-ratelimit|slowapi|flask-limiter/i.test(py)) return true;
        return false;
      },
      impact: 'medium',
      category: 'rate-limiting',
      fix: 'Add rate limiting middleware (express-rate-limit, @nestjs/throttler, rate-limiter-flexible) to protect APIs.',
      confidence: 0.7,
    },

  ddosProtection: {
      id: 130132,
      name: 'DDoS protection configured',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        const config = readProjectFiles(ctx, /\.(json|ya?ml|toml|conf)$/i, 20);
        return /helmet|cors|cloudflare|waf|ddos/i.test(pkg + config);
      },
      impact: 'medium',
      category: 'rate-limiting',
      fix: 'Add DDoS protection (helmet, CORS, WAF, Cloudflare) to defend against abuse and volumetric attacks.',
      confidence: 0.7,
    },

  backoffStrategy: {
      id: 130133,
      name: 'Retry/backoff strategy in dependencies',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        if (/exponential-backoff|p-retry|async-retry|retry|got.*retry|axios-retry/i.test(pkg)) return true;
        const py = readProjectFiles(ctx, /(^|\/)pyproject\.toml$/i) + readProjectFiles(ctx, /(^|\/)requirements[^/]*\.txt$/i);
        if (/tenacity|backoff|urllib3.*retry/i.test(py)) return true;
        return false;
      },
      impact: 'low',
      category: 'rate-limiting',
      fix: 'Add a retry/backoff library (p-retry, tenacity, exponential-backoff) for resilient external calls.',
      confidence: 0.7,
    },

  requestThrottling: {
      id: 130134,
      name: 'Request throttling in dependencies',
      check: (ctx) => {
        const pkg = ctx.fileContent('package.json') || '';
        return /bottleneck|p-throttle|p-limit|throttle/i.test(pkg);
      },
      impact: 'low',
      category: 'rate-limiting',
      fix: 'Add request throttling (bottleneck, p-throttle) to control outbound API call rates.',
      confidence: 0.7,
    },

  rateLimitHeaders: {
      id: 130135,
      name: 'Rate limit headers or 429 responses',
      check: (ctx) => {
        const src = readProjectFiles(ctx, /\.(jsx?|tsx?|py|go|java|rb)$/i, 30);
        return /X-RateLimit|RateLimit-|429|Too Many Requests/i.test(src);
      },
      impact: 'low',
      category: 'rate-limiting',
      fix: 'Return X-RateLimit headers and 429 status codes so clients can handle rate limiting gracefully.',
      confidence: 0.7,
    },
};
