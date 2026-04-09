const path = require('path');
const { hasCostBudgetOrUsageTracking } = require('./cost-tracking');

function normalizeText(value) {
  return String(value || '');
}

function getPackageJson(ctx) {
  return (typeof ctx.jsonFile === 'function' ? ctx.jsonFile('package.json') : null) || {};
}

function getDependencies(ctx) {
  const pkg = getPackageJson(ctx);
  return Object.assign(
    {},
    pkg.dependencies || {},
    pkg.devDependencies || {},
    pkg.peerDependencies || {},
    pkg.optionalDependencies || {}
  );
}

function getScripts(ctx) {
  return getPackageJson(ctx).scripts || {};
}

function hasFile(ctx, filePath) {
  return Boolean(typeof ctx.fileContent === 'function' && ctx.fileContent(filePath));
}

function hasDir(ctx, dirPath) {
  return Boolean(typeof ctx.hasDir === 'function' && ctx.hasDir(dirPath));
}

function dirFiles(ctx, dirPath) {
  return typeof ctx.dirFiles === 'function' ? ctx.dirFiles(dirPath) : [];
}

function workflowPaths(ctx, explicitPaths) {
  if (Array.isArray(explicitPaths) && explicitPaths.length > 0) {
    return explicitPaths;
  }

  if (typeof ctx.workflowFiles === 'function') {
    return ctx.workflowFiles() || [];
  }

  return dirFiles(ctx, '.github/workflows')
    .filter((file) => /\.ya?ml$/i.test(file))
    .map((file) => path.join('.github', 'workflows', file).replace(/\\/g, '/'));
}

function workflowText(ctx, explicitPaths) {
  return workflowPaths(ctx, explicitPaths)
    .map((file) => (typeof ctx.fileContent === 'function' ? ctx.fileContent(file) : null) || '')
    .join('\n');
}

function fileListText(ctx) {
  return Array.isArray(ctx.files) ? ctx.files.join('\n') : '';
}

function combinedText(parts) {
  return parts.filter(Boolean).join('\n');
}

function hasAnyDependency(ctx, patterns) {
  const deps = getDependencies(ctx);
  const names = Object.keys(deps);
  return patterns.some((pattern) => names.some((name) => pattern.test(name)));
}

function scriptMatches(ctx, patterns) {
  const scripts = getScripts(ctx);
  return Object.entries(scripts).some(([name, command]) =>
    patterns.some((pattern) => pattern.test(`${name} ${command}`))
  );
}

function fileMatches(ctx, patterns) {
  const files = fileListText(ctx);
  return patterns.some((pattern) => pattern.test(files));
}

function docMatches(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function configMatches(ctx, patterns) {
  return patterns.some((pattern) => pattern.test(getConfigBundle(ctx)));
}

function hasManifest(ctx) {
  return Boolean(
    hasFile(ctx, 'package.json') ||
    hasFile(ctx, 'pyproject.toml') ||
    hasFile(ctx, 'requirements.txt') ||
    hasFile(ctx, 'go.mod') ||
    hasFile(ctx, 'Cargo.toml') ||
    hasFile(ctx, 'Gemfile') ||
    hasFile(ctx, 'composer.json')
  );
}

function getConfigBundle(ctx) {
  return combinedText([
    typeof ctx.fileContent === 'function' ? ctx.fileContent('.claude/settings.json') : null,
    typeof ctx.fileContent === 'function' ? ctx.fileContent('.codex/config.toml') : null,
    typeof ctx.fileContent === 'function' ? ctx.fileContent('.gemini/settings.json') : null,
    typeof ctx.fileContent === 'function' ? ctx.fileContent('.vscode/settings.json') : null,
    typeof ctx.fileContent === 'function' ? ctx.fileContent('.vscode/mcp.json') : null,
    typeof ctx.fileContent === 'function' ? ctx.fileContent('copilot-setup-steps.yml') : null,
  ]);
}

function getProjectSurface(ctx, platformConfig) {
  const docs = normalizeText(platformConfig.docs ? platformConfig.docs(ctx) : '');
  const workflows = workflowText(ctx, platformConfig.workflowPaths ? platformConfig.workflowPaths(ctx) : null);
  const config = getConfigBundle(ctx);
  const files = fileListText(ctx);

  return {
    docs,
    workflows,
    config,
    files,
    dependencies: getDependencies(ctx),
    scripts: getScripts(ctx),
    manifest: hasManifest(ctx),
    project: combinedText([docs, workflows, config, files]),
  };
}

function hasRelevantProject(surface) {
  return surface.manifest || Boolean(surface.docs) || Boolean(surface.workflows);
}

function hasApiSurface(surface) {
  return /api|endpoint|rest|graphql|openapi|swagger|express|fastify|koa|hono|nestjs|router|route/i.test(surface.project);
}

function hasDatabaseSurface(surface) {
  return /database|db|postgres|mysql|sqlite|mongo|redis|prisma|typeorm|drizzle|sequelize|alembic|migration/i.test(surface.project);
}

function hasAuthSurface(surface) {
  return /auth|jwt|token|session|oauth|sso|oidc|saml|rbac|permission/i.test(surface.project);
}

function hasMonitoringSurface(surface) {
  return /logging|logger|sentry|bugsnag|rollbar|otel|opentelemetry|prometheus|health|alert|metric|apm/i.test(surface.project);
}

// --- Relevance skip helpers (prevent false positives on non-applicable projects) ---

/**
 * Returns true if the project looks like an API project.
 * Skip API Design checks when project has no routes/, api/, controllers/, endpoints/.
 */
function isApiProject(ctx) {
  if (!Array.isArray(ctx.files)) return false;
  return ctx.files.some(f => /\b(routes|api|controllers|endpoints)\//i.test(f));
}

/**
 * Returns true if the project looks like it uses a database.
 * Skip Database checks when project has no prisma/, db/, migrations/ and no DB deps.
 */
function isDatabaseProject(ctx) {
  if (!Array.isArray(ctx.files)) return false;
  const hasDbDirs = ctx.files.some(f => /\b(prisma|db|migrations)\//i.test(f));
  if (hasDbDirs) return true;
  return hasAnyDependency(ctx, [/\bpg\b/i, /\bmysql\b/i, /\bmysql2\b/i, /\bmongoose\b/i, /\bprisma\b/i, /\btypeorm\b/i, /\bsequelize\b/i, /\bknex\b/i, /\bdrizzle\b/i, /\bbetter-sqlite3\b/i, /\bsqlite3\b/i]);
}

/**
 * Returns true if the project looks like it uses authentication.
 * Skip Auth checks when project has no auth/, login, no passport/auth0/clerk in deps.
 */
function isAuthProject(ctx) {
  if (!Array.isArray(ctx.files)) return false;
  const hasAuthDirs = ctx.files.some(f => /\b(auth)\//i.test(f) || /login/i.test(f));
  if (hasAuthDirs) return true;
  return hasAnyDependency(ctx, [/\bpassport\b/i, /\bauth0\b/i, /\bclerk\b/i, /\bnext-auth\b/i, /\b@auth\//i, /\bbcrypt\b/i, /\bjsonwebtoken\b/i, /\bjose\b/i]);
}

/**
 * Returns true if the project is large enough or has monitoring deps.
 * Skip Monitoring checks when project has no monitoring deps AND < 10 JS/TS files.
 */
function isMonitoringRelevant(ctx) {
  if (hasAnyDependency(ctx, [/\bsentry\b/i, /\bdatadog\b/i, /\bnewrelic\b/i, /\bpino\b/i, /\bwinston\b/i, /\bbugsnag\b/i, /\brollbar\b/i, /\bopentelemetry\b/i, /\bprom-client\b/i])) {
    return true;
  }
  if (!Array.isArray(ctx.files)) return false;
  const jstsCount = ctx.files.filter(f => /\.(js|ts|jsx|tsx|mjs|cjs)$/i.test(f)).length;
  return jstsCount >= 10;
}

function exactPinnedDependencies(ctx) {
  const deps = getDependencies(ctx);
  const versions = Object.values(deps);
  if (versions.length === 0) return null;
  return versions.every((value) => typeof value === 'string' && !/^[~^><*]/.test(value));
}

function dependencyLockfilePresent(ctx) {
  return [
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lockb',
    'Cargo.lock',
    'Gemfile.lock',
    'composer.lock',
    'poetry.lock',
  ].some((file) => hasFile(ctx, file));
}

const CHECK_DEFS = [
  {
    key: 'testingStrategyFrameworkDetected',
    suffix: '01',
    name: 'Testing strategy: test framework detected',
    category: 'testing-strategy',
    impact: 'high',
    fix: 'Document and install a primary test framework (for example Jest, Vitest, Playwright, pytest, or equivalent) so the repo has an explicit testing baseline.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? hasAnyDependency(ctx, [/\bjest\b/i, /\bvitest\b/i, /\bmocha\b/i, /\bava\b/i, /\bpytest\b/i, /\bplaywright\b/i, /\bcypress\b/i, /\brspec\b/i]) || scriptMatches(ctx, [/\btest\b/i])
      : null,
  },
  {
    key: 'testingStrategyCoverageConfigExists',
    suffix: '02',
    name: 'Testing strategy: coverage configuration exists',
    category: 'testing-strategy',
    impact: 'medium',
    fix: 'Add a coverage configuration or script (`coverage`, `nyc`, `c8`, `coverageThreshold`, or equivalent) so test depth is measurable.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? scriptMatches(ctx, [/\bcoverage\b/i]) ||
        hasAnyDependency(ctx, [/\bnyc\b/i, /\bc8\b/i]) ||
        hasFile(ctx, 'jest.config.js') ||
        hasFile(ctx, 'vitest.config.ts') ||
        /coverageThreshold|collectCoverage|coverage/i.test(JSON.stringify(getPackageJson(ctx)))
      : null,
  },
  {
    key: 'testingStrategyE2ESetupPresent',
    suffix: '03',
    name: 'Testing strategy: E2E setup present',
    category: 'testing-strategy',
    impact: 'medium',
    fix: 'Add an E2E harness such as Playwright or Cypress, or document why the repo intentionally relies on another end-to-end strategy.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? hasAnyDependency(ctx, [/\bplaywright\b/i, /\bcypress\b/i]) ||
        hasDir(ctx, 'e2e') ||
        hasDir(ctx, 'tests/e2e') ||
        fileMatches(ctx, [/playwright\.config|cypress\.config|cypress\/|e2e\//i])
      : null,
  },
  {
    key: 'testingStrategySnapshotTestsMentioned',
    suffix: '04',
    name: 'Testing strategy: snapshot tests mentioned',
    category: 'testing-strategy',
    impact: 'low',
    fix: 'Mention snapshot testing expectations or store snapshots in a conventional location so UI and serializer regressions are reviewable.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? docMatches(surface.project, [/\bsnapshot\b/i, /__snapshots__/i]) || hasDir(ctx, '__snapshots__')
      : null,
  },
  {
    key: 'testingStrategyTestCommandDocumented',
    suffix: '05',
    name: 'Testing strategy: test command documented',
    category: 'testing-strategy',
    impact: 'high',
    fix: 'Document the canonical test command in repo instructions so contributors and agents can verify changes the same way.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? /\bnpm test\b|\bpnpm test\b|\byarn test\b|\bpytest\b|\bgo test\b|\bcargo test\b/i.test(surface.docs) || Boolean(getScripts(ctx).test)
      : null,
  },
  {
    key: 'testingStrategyCiRunsTests',
    suffix: '06',
    name: 'Testing strategy: CI runs tests',
    category: 'testing-strategy',
    impact: 'high',
    fix: 'Make CI run the project test command so regressions are caught automatically rather than only in local sessions.',
    check: (_ctx, surface) => surface.workflows
      ? /\b(test|pytest|vitest|jest|go test|cargo test|playwright test|cypress run)\b/i.test(surface.workflows)
      : null,
  },
  {
    key: 'codeQualityLinterConfigured',
    suffix: '07',
    name: 'Code quality: linter configured',
    category: 'code-quality',
    impact: 'high',
    fix: 'Configure a linter such as ESLint, Ruff, Flake8, or equivalent so code quality rules are enforceable and repeatable.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? hasAnyDependency(ctx, [/\beslint\b/i, /\bruff\b/i, /\bflake8\b/i, /\bpylint\b/i, /\bgolangci-lint\b/i]) ||
        scriptMatches(ctx, [/\blint\b/i]) ||
        fileMatches(ctx, [/eslint|\.ruff|flake8|pylintrc|golangci/i])
      : null,
  },
  {
    key: 'codeQualityFormatterConfigured',
    suffix: '08',
    name: 'Code quality: formatter configured',
    category: 'code-quality',
    impact: 'medium',
    fix: 'Configure a formatter such as Prettier, Black, Ruff format, rustfmt, or equivalent so style drift does not become manual toil.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? hasAnyDependency(ctx, [/\bprettier\b/i, /\bblack\b/i, /\bruff\b/i]) ||
        scriptMatches(ctx, [/\bformat\b/i]) ||
        fileMatches(ctx, [/prettier|\.prettierrc|pyproject\.toml|rustfmt/i])
      : null,
  },
  {
    key: 'codeQualityDeadCodeDetection',
    suffix: '09',
    name: 'Code quality: dead code detection',
    category: 'code-quality',
    impact: 'medium',
    fix: 'Add a dead-code scan (`knip`, `ts-prune`, `depcheck`, `vulture`, or equivalent) or document how the repo handles unused code removal.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? hasAnyDependency(ctx, [/\bknip\b/i, /\bts-prune\b/i, /\bdepcheck\b/i, /\bvulture\b/i]) ||
        scriptMatches(ctx, [/\bknip\b/i, /\bts-prune\b/i, /\bdepcheck\b/i, /\bvulture\b/i]) ||
        docMatches(surface.docs, [/\bdead code\b/i, /\bunused code\b/i])
      : null,
  },
  {
    key: 'codeQualityComplexityAwareness',
    suffix: '10',
    name: 'Code quality: complexity awareness',
    category: 'code-quality',
    impact: 'medium',
    fix: 'Document or configure complexity guardrails (for example cyclomatic complexity or small-function guidance) so growth pressure stays visible.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? docMatches(surface.docs, [/\bcomplexity\b/i, /\bcyclomatic\b/i, /\bsmall functions\b/i, /\bkeep functions\b/i]) ||
        configMatches(ctx, [/\bcomplexity\b/i, /\bmax-len\b/i, /\bmax-depth\b/i])
      : null,
  },
  {
    key: 'codeQualityConsistentNamingDocumented',
    suffix: '11',
    name: 'Code quality: consistent naming documented',
    category: 'code-quality',
    impact: 'medium',
    fix: 'Document naming conventions such as camelCase, PascalCase, kebab-case, or snake_case so generated and hand-written code stay aligned.',
    check: (_ctx, surface) => surface.docs
      ? docMatches(surface.docs, [/\bcamelCase\b/, /\bPascalCase\b/, /\bkebab-case\b/, /\bsnake_case\b/, /\bnaming convention\b/i])
      : null,
  },
  {
    key: 'codeQualityCodeReviewProcessMentioned',
    suffix: '12',
    name: 'Code quality: code review process mentioned',
    category: 'code-quality',
    impact: 'medium',
    fix: 'Mention the code review process in repo guidance or templates so contributors know how changes are checked before merge.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? docMatches(surface.project, [/\bcode review\b/i, /\bpull request\b/i, /\breviewer\b/i, /\bapproval\b/i]) ||
        hasFile(ctx, '.github/pull_request_template.md')
      : null,
  },
  {
    key: 'apiDesignEndpointDocumentation',
    suffix: '13',
    name: 'API design: endpoint documentation present',
    category: 'api-design',
    impact: 'medium',
    fix: 'Document the main API endpoints or ship an OpenAPI/Swagger description so integrations stay reviewable.',
    check: (ctx, surface) => !isApiProject(ctx) ? null : hasApiSurface(surface)
      ? docMatches(surface.project, [/\bendpoint\b/i, /\bopenapi\b/i, /\bswagger\b/i, /\bgraphql\b/i, /\broute\b/i]) ||
        hasFile(ctx, 'openapi.yaml') ||
        hasFile(ctx, 'openapi.json') ||
        hasFile(ctx, 'swagger.json')
      : null,
  },
  {
    key: 'apiDesignVersioningMentioned',
    suffix: '14',
    name: 'API design: versioning mentioned',
    category: 'api-design',
    impact: 'medium',
    fix: 'Document the API versioning strategy (`v1`, header-based, or explicit stability policy) so breaking changes are easier to govern.',
    check: (ctx, surface) => !isApiProject(ctx) ? null : hasApiSurface(surface)
      ? docMatches(surface.project, [/\bapi version\b/i, /\/v[0-9]+\b/i, /\bversioning\b/i])
      : null,
  },
  {
    key: 'apiDesignErrorHandlingPatterns',
    suffix: '15',
    name: 'API design: error handling patterns defined',
    category: 'api-design',
    impact: 'high',
    fix: 'Document the API error handling shape (for example problem+json, error envelopes, or standard status mapping) so clients get predictable failures.',
    check: (ctx, surface) => !isApiProject(ctx) ? null : hasApiSurface(surface)
      ? docMatches(surface.project, [/\berror handling\b/i, /\bproblem\+json\b/i, /\berror envelope\b/i, /\bstatus code\b/i])
      : null,
  },
  {
    key: 'apiDesignRateLimitingAwareness',
    suffix: '16',
    name: 'API design: rate limiting awareness',
    category: 'api-design',
    impact: 'medium',
    fix: 'Mention rate limiting or throttling expectations so public and internal API surfaces have clear abuse boundaries.',
    check: (ctx, surface) => !isApiProject(ctx) ? null : hasApiSurface(surface)
      ? docMatches(surface.project, [/\brate limit\b/i, /\bthrottl/i]) ||
        hasAnyDependency(ctx, [/\bexpress-rate-limit\b/i, /\bbottleneck\b/i, /\bslowapi\b/i])
      : null,
  },
  {
    key: 'apiDesignRequestValidation',
    suffix: '17',
    name: 'API design: request validation present',
    category: 'api-design',
    impact: 'high',
    fix: 'Use and document request validation (Zod, Joi, class-validator, Pydantic, or equivalent) so invalid inputs fail early and consistently.',
    check: (ctx, surface) => !isApiProject(ctx) ? null : hasApiSurface(surface)
      ? docMatches(surface.project, [/\brequest validation\b/i, /\binput validation\b/i, /\bzod\b/i, /\bjoi\b/i, /\bpydantic\b/i]) ||
        hasAnyDependency(ctx, [/\bzod\b/i, /\bjoi\b/i, /\bclass-validator\b/i, /\bpydantic\b/i])
      : null,
  },
  {
    key: 'apiDesignResponseFormatConsistent',
    suffix: '18',
    name: 'API design: response format consistency described',
    category: 'api-design',
    impact: 'medium',
    fix: 'Describe the standard API response shape or schema conventions so consumers know what to expect from every endpoint.',
    check: (ctx, surface) => !isApiProject(ctx) ? null : hasApiSurface(surface)
      ? docMatches(surface.project, [/\bresponse format\b/i, /\bresponse schema\b/i, /\bjson envelope\b/i, /\bconsistent response\b/i])
      : null,
  },
  {
    key: 'databaseMigrationStrategyDocumented',
    suffix: '19',
    name: 'Database: migration strategy documented',
    category: 'database',
    impact: 'high',
    fix: 'Document the migration workflow (`prisma migrate`, `alembic`, SQL migrations, or equivalent) so schema changes are repeatable and reviewable.',
    check: (ctx, surface) => !isDatabaseProject(ctx) ? null : hasDatabaseSurface(surface)
      ? docMatches(surface.project, [/\bmigration\b/i, /\bprisma migrate\b/i, /\balembic\b/i, /\bdbmate\b/i]) ||
        hasDir(ctx, 'prisma/migrations') ||
        hasDir(ctx, 'migrations')
      : null,
  },
  {
    key: 'databaseQueryOptimizationMentioned',
    suffix: '20',
    name: 'Database: query optimization mentioned',
    category: 'database',
    impact: 'medium',
    fix: 'Mention query optimization concerns such as indexes, N+1 prevention, pagination, or query plans so performance work has a shared baseline.',
    check: (ctx, surface) => !isDatabaseProject(ctx) ? null : hasDatabaseSurface(surface)
      ? docMatches(surface.project, [/\bquery optimization\b/i, /\bindex(es)?\b/i, /\bn\+1\b/i, /\bpagination\b/i, /\bquery plan\b/i])
      : null,
  },
  {
    key: 'databaseConnectionPooling',
    suffix: '21',
    name: 'Database: connection pooling addressed',
    category: 'database',
    impact: 'medium',
    fix: 'Document or configure connection pooling so the database layer does not rely on unbounded per-request connections.',
    check: (ctx, surface) => !isDatabaseProject(ctx) ? null : hasDatabaseSurface(surface)
      ? docMatches(surface.project, [/\bconnection pool\b/i, /\bpooling\b/i]) ||
        hasAnyDependency(ctx, [/\bpg\b/i, /\bmysql2\b/i, /\bprisma\b/i])
      : null,
  },
  {
    key: 'databaseBackupStrategy',
    suffix: '22',
    name: 'Database: backup strategy referenced',
    category: 'database',
    impact: 'high',
    fix: 'Reference backup and restore expectations so data durability is not left as tribal knowledge.',
    check: (ctx, surface) => !isDatabaseProject(ctx) ? null : hasDatabaseSurface(surface)
      ? docMatches(surface.project, [/\bbackup\b/i, /\brestore\b/i, /\bpoint-in-time\b/i, /\bsnapshot\b/i])
      : null,
  },
  {
    key: 'databaseSchemaDocumentation',
    suffix: '23',
    name: 'Database: schema documentation present',
    category: 'database',
    impact: 'medium',
    fix: 'Include schema documentation or schema files so contributors can understand the data model without guessing.',
    check: (ctx, surface) => !isDatabaseProject(ctx) ? null : hasDatabaseSurface(surface)
      ? docMatches(surface.project, [/\bschema\b/i, /\berd\b/i, /\bdbml\b/i]) ||
        hasFile(ctx, 'schema.prisma') ||
        hasFile(ctx, 'dbml')
      : null,
  },
  {
    key: 'databaseSeedDataMentioned',
    suffix: '24',
    name: 'Database: seed data mentioned',
    category: 'database',
    impact: 'low',
    fix: 'Document seed data or bootstrap fixtures so contributors can stand up realistic local environments quickly.',
    check: (ctx, surface) => !isDatabaseProject(ctx) ? null : hasDatabaseSurface(surface)
      ? docMatches(surface.project, [/\bseed data\b/i, /\bseeding\b/i, /\bbootstrap data\b/i]) ||
        scriptMatches(ctx, [/\bseed\b/i])
      : null,
  },
  {
    key: 'authenticationAuthFlowDocumented',
    suffix: '25',
    name: 'Authentication: auth flow documented',
    category: 'authentication',
    impact: 'high',
    fix: 'Document the authentication flow so login, signup, and trust boundaries are clear for contributors and agents.',
    check: (ctx, surface) => !isAuthProject(ctx) ? null : hasAuthSurface(surface)
      ? docMatches(surface.project, [/\bauth flow\b/i, /\blogin\b/i, /\bsign[- ]?in\b/i, /\bsign[- ]?up\b/i])
      : null,
  },
  {
    key: 'authenticationTokenHandlingGuidance',
    suffix: '26',
    name: 'Authentication: token handling guidance',
    category: 'authentication',
    impact: 'high',
    fix: 'Describe how tokens are stored, refreshed, and protected so secrets do not leak into client storage or logs.',
    check: (ctx, surface) => !isAuthProject(ctx) ? null : hasAuthSurface(surface)
      ? docMatches(surface.project, [/\btoken\b/i, /\brefresh token\b/i, /\bhttpOnly\b/i, /\bbearer\b/i])
      : null,
  },
  {
    key: 'authenticationSessionManagement',
    suffix: '27',
    name: 'Authentication: session management described',
    category: 'authentication',
    impact: 'medium',
    fix: 'Document session lifetime, revocation, and invalidation rules so auth behavior is predictable under change.',
    check: (ctx, surface) => !isAuthProject(ctx) ? null : hasAuthSurface(surface)
      ? docMatches(surface.project, [/\bsession\b/i, /\bcookie\b/i, /\bexpiration\b/i, /\brevocation\b/i])
      : null,
  },
  {
    key: 'authenticationRbacPermissionsReferenced',
    suffix: '28',
    name: 'Authentication: RBAC or permissions referenced',
    category: 'authentication',
    impact: 'high',
    fix: 'Reference roles and permission boundaries so the repo has a shared model for authorization checks.',
    check: (ctx, surface) => !isAuthProject(ctx) ? null : hasAuthSurface(surface)
      ? docMatches(surface.project, [/\brbac\b/i, /\brole\b/i, /\bpermission\b/i, /\bauthorization\b/i])
      : null,
  },
  {
    key: 'authenticationOauthSsoMentioned',
    suffix: '29',
    name: 'Authentication: OAuth or SSO mentioned',
    category: 'authentication',
    impact: 'medium',
    fix: 'Document OAuth, OIDC, SSO, or SAML expectations if the project uses delegated authentication or enterprise identity.',
    check: (ctx, surface) => !isAuthProject(ctx) ? null : hasAuthSurface(surface)
      ? docMatches(surface.project, [/\boauth\b/i, /\boidc\b/i, /\bsso\b/i, /\bsaml\b/i])
      : null,
  },
  {
    key: 'authenticationCredentialRotation',
    suffix: '30',
    name: 'Authentication: credential rotation mentioned',
    category: 'authentication',
    impact: 'medium',
    fix: 'Mention credential rotation or secret rollover procedures so auth incidents do not require ad-hoc recovery.',
    check: (ctx, surface) => !isAuthProject(ctx) ? null : hasAuthSurface(surface)
      ? docMatches(surface.project, [/\brotate\b/i, /\brotation\b/i, /\bsecret rollover\b/i, /\bkey rollover\b/i])
      : null,
  },
  {
    key: 'monitoringLoggingConfigured',
    suffix: '31',
    name: 'Monitoring: logging configured',
    category: 'monitoring',
    impact: 'medium',
    fix: 'Configure structured logging or document the logging approach so production diagnostics do not depend on ad-hoc console output.',
    check: (ctx, surface) => !isMonitoringRelevant(ctx) ? null : hasRelevantProject(surface)
      ? hasAnyDependency(ctx, [/\bpino\b/i, /\bwinston\b/i, /\bstructured-log\b/i, /\bstructlog\b/i, /\bloguru\b/i]) ||
        docMatches(surface.project, [/\blogging\b/i, /\bstructured logs?\b/i, /\blogger\b/i])
      : null,
  },
  {
    key: 'monitoringErrorTrackingSetup',
    suffix: '32',
    name: 'Monitoring: error tracking setup',
    category: 'monitoring',
    impact: 'medium',
    fix: 'Wire error tracking such as Sentry, Bugsnag, or Rollbar, or document the equivalent crash-reporting path.',
    check: (ctx, surface) => !isMonitoringRelevant(ctx) ? null : hasRelevantProject(surface)
      ? hasAnyDependency(ctx, [/\bsentry\b/i, /\bbugsnag\b/i, /\brollbar\b/i]) ||
        docMatches(surface.project, [/\bsentry\b/i, /\bbugsnag\b/i, /\brollbar\b/i, /\berror tracking\b/i])
      : null,
  },
  {
    key: 'monitoringApmMetricsMentioned',
    suffix: '33',
    name: 'Monitoring: APM or metrics mentioned',
    category: 'monitoring',
    impact: 'medium',
    fix: 'Mention metrics, tracing, or APM so performance and reliability signals are available before incidents escalate.',
    check: (ctx, surface) => !isMonitoringRelevant(ctx) ? null : hasRelevantProject(surface)
      ? hasAnyDependency(ctx, [/\bprom-client\b/i, /\bopentelemetry\b/i, /\bdatadog\b/i, /\bnewrelic\b/i]) ||
        docMatches(surface.project, [/\bmetrics\b/i, /\bprometheus\b/i, /\bapm\b/i, /\bopentelemetry\b/i, /\btrace\b/i])
      : null,
  },
  {
    key: 'monitoringHealthCheckEndpoint',
    suffix: '34',
    name: 'Monitoring: health check endpoint referenced',
    category: 'monitoring',
    impact: 'medium',
    fix: 'Document or implement a health check endpoint (`/health`, `/ready`, `/live`) so uptime checks have a stable target.',
    check: (ctx, surface) => !isMonitoringRelevant(ctx) ? null : hasRelevantProject(surface)
      ? docMatches(surface.project, [/\bhealth check\b/i, /\bhealthz\b/i, /\bliveness\b/i, /\breadiness\b/i, /\/health\b/i])
      : null,
  },
  {
    key: 'monitoringAlertingReferenced',
    suffix: '35',
    name: 'Monitoring: alerting referenced',
    category: 'monitoring',
    impact: 'medium',
    fix: 'Reference alerting or on-call expectations so incidents have an explicit escalation path.',
    check: (ctx, surface) => !isMonitoringRelevant(ctx) ? null : hasRelevantProject(surface)
      ? docMatches(surface.project, [/\balerting\b/i, /\bon-call\b/i, /\bpagerduty\b/i, /\balertmanager\b/i, /\bincident\b/i])
      : null,
  },
  {
    key: 'monitoringLogRotationMentioned',
    suffix: '36',
    name: 'Monitoring: log rotation mentioned',
    category: 'monitoring',
    impact: 'low',
    fix: 'Mention log retention or rotation so long-running services do not silently fill disks with unbounded logs.',
    check: (ctx, surface) => !isMonitoringRelevant(ctx) ? null : hasRelevantProject(surface)
      ? docMatches(surface.project, [/\blog rotation\b/i, /\blogrotate\b/i, /\bretention\b/i, /\bmax size\b/i])
      : null,
  },
  {
    key: 'dependencyManagementLockfilePresent',
    suffix: '37',
    name: 'Dependency management: lockfile present',
    category: 'dependency-management',
    impact: 'high',
    fix: 'Commit a lockfile so installs stay reproducible across contributors, CI, and agent-driven edits.',
    check: (ctx, surface) => hasRelevantProject(surface) ? dependencyLockfilePresent(ctx) : null,
  },
  {
    key: 'dependencyManagementOutdatedDepsAwareness',
    suffix: '38',
    name: 'Dependency management: outdated dependency awareness',
    category: 'dependency-management',
    impact: 'medium',
    fix: 'Document or script dependency update checks (`npm outdated`, Renovate, Dependabot, or equivalent) so stale packages are noticed before they become risk.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? scriptMatches(ctx, [/\boutdated\b/i, /\bdepcheck\b/i]) ||
        docMatches(surface.project, [/\bdependabot\b/i, /\brenovate\b/i, /\boutdated\b/i, /\bdependency update\b/i]) ||
        hasFile(ctx, '.github/dependabot.yml') ||
        hasFile(ctx, 'renovate.json')
      : null,
  },
  {
    key: 'dependencyManagementLicenseCompliance',
    suffix: '39',
    name: 'Dependency management: license compliance referenced',
    category: 'dependency-management',
    impact: 'medium',
    fix: 'Reference license compliance or OSS review so dependency adoption has an explicit governance path.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? hasFile(ctx, 'LICENSE') || hasFile(ctx, 'LICENSE.md') || docMatches(surface.project, [/\blicense\b/i, /\bcompliance\b/i, /\boss review\b/i])
      : null,
  },
  {
    key: 'dependencyManagementNpmAuditConfigured',
    suffix: '40',
    name: 'Dependency management: audit command configured',
    category: 'dependency-management',
    impact: 'medium',
    fix: 'Run `npm audit`, `pnpm audit`, `yarn audit`, `pip-audit`, or an equivalent scanner in scripts or CI so supply-chain issues are visible.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? scriptMatches(ctx, [/\baudit\b/i]) ||
        /\baudit\b/i.test(surface.workflows) ||
        docMatches(surface.project, [/\bnpm audit\b/i, /\bpnpm audit\b/i, /\byarn audit\b/i, /\bpip-audit\b/i, /\bsnyk\b/i])
      : null,
  },
  {
    key: 'dependencyManagementPinnedVersions',
    suffix: '41',
    name: 'Dependency management: versions pinned deliberately',
    category: 'dependency-management',
    impact: 'medium',
    fix: 'Prefer exact version pins or document why floating ranges are acceptable so dependency drift stays intentional.',
    check: (ctx, surface) => hasRelevantProject(surface) ? exactPinnedDependencies(ctx) : null,
  },
  {
    key: 'dependencyManagementAutoUpdatePolicy',
    suffix: '42',
    name: 'Dependency management: auto-update policy present',
    category: 'dependency-management',
    impact: 'low',
    fix: 'Add Dependabot, Renovate, or a documented update policy so dependency maintenance does not depend on memory alone.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? hasFile(ctx, '.github/dependabot.yml') ||
        hasFile(ctx, 'renovate.json') ||
        hasFile(ctx, '.github/renovate.json') ||
        docMatches(surface.project, [/\bdependabot\b/i, /\brenovate\b/i, /\bupdate policy\b/i, /\bdependency policy\b/i])
      : null,
  },
  {
    key: 'costOptimizationTokenUsageAwareness',
    suffix: '43',
    name: 'Cost optimization: token usage awareness',
    category: 'cost-optimization',
    impact: 'medium',
    fix: 'Mention token or context-window costs so AI-heavy workflows do not scale blindly.',
    check: (_ctx, surface) => surface.docs
      ? docMatches(surface.docs, [/\btoken\b/i, /\bcontext window\b/i, /\bcost\b/i, /\bprompt budget\b/i])
      : null,
  },
  {
    key: 'costOptimizationModelSelectionGuidance',
    suffix: '44',
    name: 'Cost optimization: model selection guidance',
    category: 'cost-optimization',
    impact: 'medium',
    fix: 'Document when to use smaller, faster, or cheaper models so the repo does not default every task to the most expensive option.',
    check: (_ctx, surface) => surface.docs
      ? docMatches(surface.docs, [/\bmodel\b/i, /\bmini\b/i, /\bflash\b/i, /\bcheap(er)?\b/i, /\bfast(er)?\b/i])
      : null,
  },
  {
    key: 'costOptimizationCachingGuidance',
    suffix: '45',
    name: 'Cost optimization: caching to reduce API calls mentioned',
    category: 'cost-optimization',
    impact: 'medium',
    fix: 'Mention caching, memoization, or response reuse so repeated requests do not waste tokens or API budget.',
    check: (_ctx, surface) => surface.docs
      ? docMatches(surface.docs, [/\bcach(e|ing)\b/i, /\bmemoiz/i, /\breuse\b/i])
      : null,
  },
  {
    key: 'costOptimizationBatchProcessing',
    suffix: '46',
    name: 'Cost optimization: batch processing mentioned',
    category: 'cost-optimization',
    impact: 'low',
    fix: 'Mention batching or bulk operations where appropriate so repetitive calls can be collapsed into fewer requests.',
    check: (_ctx, surface) => surface.docs
      ? docMatches(surface.docs, [/\bbatch\b/i, /\bbulk\b/i, /\bqueue\b/i, /\bcoalesce\b/i])
      : null,
  },
  {
    key: 'costOptimizationBudgetGuardrails',
    suffix: '47',
    name: 'Cost optimization: budget guardrails or per-run usage tracking',
    category: 'cost-optimization',
    impact: 'low',
    fix: 'Document spend guardrails or per-run usage/cost tracking so agent automation has an explicit budget boundary and observability trail.',
    check: (ctx, surface) => hasRelevantProject(surface)
      ? hasCostBudgetOrUsageTracking(surface.project, ctx)
      : null,
  },
  {
    key: 'costOptimizationContextPruning',
    suffix: '48',
    name: 'Cost optimization: context pruning guidance',
    category: 'cost-optimization',
    impact: 'low',
    fix: 'Mention context pruning, chunking, or summarization so long prompts do not burn unnecessary tokens.',
    check: (_ctx, surface) => surface.docs
      ? docMatches(surface.docs, [/\bprun(e|ing)\b/i, /\btruncate\b/i, /\bchunk(ing)?\b/i, /\bsummariz/i])
      : null,
  },
];

function buildSupplementalChecks(options) {
  const {
    idPrefix,
    urlMap,
    docs,
    workflowPaths,
  } = options;

  const checks = {};

  for (const def of CHECK_DEFS) {
    checks[def.key] = {
      id: `${idPrefix}${def.suffix}`,
      name: def.name,
      check: (ctx) => def.check(ctx, getProjectSurface(ctx, { docs, workflowPaths })),
      impact: def.impact,
      rating: 3,
      category: def.category,
      fix: def.fix,
      sourceUrl: urlMap[def.category],
      confidence: 0.7,
      template: null,
    };
  }

  return checks;
}

module.exports = {
  buildSupplementalChecks,
  isApiProject,
  isDatabaseProject,
  isAuthProject,
  isMonitoringRelevant,
};
