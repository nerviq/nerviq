/**
 * Setup engine - applies recommended Claude Code configuration to a project.
 * v1.8.0 - Starter-safe setup engine with reusable planning primitives.
 */

const fs = require('fs');
const path = require('path');
const { TECHNIQUES, STACKS } = require('./techniques');
const { ProjectContext } = require('./context');
const { audit } = require('./audit');
const { buildSettingsForProfile } = require('./governance');
const { getMcpPackPreflight } = require('./mcp-packs');
const { writeRollbackArtifact } = require('./activity');
const { setupCodex } = require('./codex/setup');

// ============================================================
// Helper: detect project scripts from package.json
// ============================================================
function detectScripts(ctx) {
  const pkg = ctx.jsonFile('package.json');
  if (!pkg || !pkg.scripts) return {};
  const relevant = ['test', 'build', 'lint', 'dev', 'start', 'format', 'typecheck', 'check'];
  const found = {};
  for (const key of relevant) {
    if (pkg.scripts[key]) {
      found[key] = pkg.scripts[key];
    }
  }
  return found;
}

// ============================================================
// Helper: detect key dependencies and generate guidelines
// ============================================================
function detectDependencies(ctx) {
  const pkg = ctx.jsonFile('package.json') || {};
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const guidelines = [];

  // Data fetching
  if (allDeps['@tanstack/react-query']) {
    guidelines.push('- Use React Query (TanStack Query) for all server data fetching — never raw useEffect + fetch');
    guidelines.push('- Define query keys as constants. Invalidate related queries after mutations');
  }
  if (allDeps['swr']) {
    guidelines.push('- Use SWR for data fetching with automatic revalidation');
  }

  // Validation
  if (allDeps['zod']) {
    guidelines.push('- Use Zod for all input validation and type inference (z.infer<typeof schema>)');
    guidelines.push('- Define schemas in a shared location. Use .parse() at API boundaries');
  }

  // ORM / Database
  if (allDeps['prisma'] || allDeps['@prisma/client']) {
    guidelines.push('- Use Prisma for all database operations. Run `npx prisma generate` after schema changes');
    guidelines.push('- Never write raw SQL unless Prisma cannot express the query');
  }
  if (allDeps['drizzle-orm']) {
    guidelines.push('- Use Drizzle ORM for database operations. Schema-first approach');
  }
  if (allDeps['mongoose']) {
    guidelines.push('- Use Mongoose for MongoDB operations. Define schemas with validation');
  }

  // Auth
  if (allDeps['next-auth'] || allDeps['@auth/core']) {
    guidelines.push('- Use NextAuth.js for authentication. Access session via auth() in Server Components');
  }
  if (allDeps['clerk'] || allDeps['@clerk/nextjs']) {
    guidelines.push('- Use Clerk for authentication. Protect routes with middleware');
  }

  // State management
  if (allDeps['zustand']) {
    guidelines.push('- Use Zustand for client state. Keep stores small and focused');
  }
  if (allDeps['@reduxjs/toolkit']) {
    guidelines.push('- Use Redux Toolkit for state management. Use createSlice and RTK Query');
  }

  // Styling
  if (allDeps['tailwindcss']) {
    guidelines.push('- Use Tailwind CSS for all styling. Avoid inline styles and CSS modules');
  }
  if (allDeps['styled-components'] || allDeps['@emotion/react']) {
    guidelines.push('- Use CSS-in-JS for component styling. Colocate styles with components');
  }

  // Testing
  if (allDeps['vitest']) {
    guidelines.push('- Use Vitest for testing. Colocate test files with source (*.test.ts)');
  }
  if (allDeps['jest']) {
    guidelines.push('- Use Jest for testing. Follow existing test patterns in the codebase');
  }
  if (allDeps['playwright'] || allDeps['@playwright/test']) {
    guidelines.push('- Use Playwright for E2E tests. Keep tests in tests/ or e2e/');
  }

  // Testing tools
  if (allDeps['msw']) {
    guidelines.push('- Use MSW (Mock Service Worker) for API mocking in tests. Define handlers in __mocks__/');
  }
  if (allDeps['@testing-library/react']) {
    guidelines.push('- Use Testing Library for component tests. Prefer userEvent over fireEvent, query by role/label');
  }
  if (allDeps['@vitest/coverage-v8'] || allDeps['@vitest/coverage-istanbul']) {
    guidelines.push('- Coverage configured. Maintain coverage thresholds. Check reports before merging');
  }

  // tRPC
  if (allDeps['@trpc/server'] || allDeps['@trpc/client']) {
    guidelines.push('- Use tRPC for type-safe API calls. Define routers in server, use client hooks in components');
  }

  // Stripe
  if (allDeps['stripe']) {
    guidelines.push('- Use Stripe SDK for payments. Always verify webhooks with stripe.webhooks.constructEvent()');
  }

  // Resend
  if (allDeps['resend']) {
    guidelines.push('- Use Resend for transactional email. Define templates as React components');
  }

  // Express security
  if (allDeps['helmet']) {
    guidelines.push('- Helmet is configured — ensure all middleware is applied before routes');
  }
  if (allDeps['jsonwebtoken']) {
    guidelines.push('- Use JWT for authentication. Always verify tokens with the correct secret/algorithm');
  }
  if (allDeps['bcrypt']) {
    guidelines.push('- Use bcrypt for password hashing. Never store plaintext passwords');
  }
  if (allDeps['cors']) {
    guidelines.push('- CORS is configured — restrict origins to known domains in production');
  }

  // Monorepo
  if (allDeps['turbo'] || allDeps['turborepo']) {
    guidelines.push('- Turborepo monorepo — use `turbo run` for all tasks. Respect package boundaries');
  }
  if (allDeps['nx']) {
    guidelines.push('- Nx monorepo — use `nx affected` for incremental builds and tests');
  }

  // Python
  const reqTxt = ctx.fileContent('requirements.txt') || '';
  if (reqTxt.includes('sqlalchemy')) {
    guidelines.push('- Use SQLAlchemy for database operations. Define models in models/');
  }
  if (reqTxt.includes('pydantic')) {
    guidelines.push('- Use Pydantic for data validation and serialization');
  }
  if (reqTxt.includes('pytest')) {
    guidelines.push('- Use pytest for testing. Run with `python -m pytest`');
  }
  if (reqTxt.includes('alembic')) {
    guidelines.push('- Use Alembic for database migrations. Run `alembic upgrade head` after model changes');
  }
  if (reqTxt.includes('celery')) {
    guidelines.push('- Use Celery for background tasks. Define tasks in tasks/ or services/');
  }
  if (reqTxt.includes('redis')) {
    guidelines.push('- Redis is available for caching and task queues');
  }
  if (reqTxt.includes('langchain')) {
    guidelines.push('- Use LangChain for chain/agent orchestration. Define chains in chains/ directory');
  }
  if (reqTxt.includes('openai')) {
    guidelines.push('- OpenAI SDK available. Use structured outputs where possible');
  }
  if (reqTxt.includes('anthropic')) {
    guidelines.push('- Anthropic SDK available. Prefer Claude for complex reasoning tasks');
  }
  if (reqTxt.includes('chromadb')) {
    guidelines.push('- Use ChromaDB for local vector storage. Persist collections to disk');
  }
  if (reqTxt.includes('pinecone')) {
    guidelines.push('- Use Pinecone for production vector search. Define index schemas upfront');
  }
  if (reqTxt.includes('mlflow')) {
    guidelines.push('- Use MLflow for experiment tracking. Log all model parameters and metrics');
  }
  if (reqTxt.includes('wandb')) {
    guidelines.push('- Use Weights & Biases for experiment tracking and visualization');
  }
  if (reqTxt.includes('transformers')) {
    guidelines.push('- HuggingFace Transformers available. Use AutoModel/AutoTokenizer for loading');
  }

  // JS AI/ML/Cloud deps
  if (allDeps['@anthropic-ai/sdk']) {
    guidelines.push('- Anthropic SDK configured. Use Messages API with structured tool_use for agents');
  }
  if (allDeps['openai']) {
    guidelines.push('- OpenAI SDK available. Use structured outputs and function calling');
  }
  if (allDeps['@modelcontextprotocol/sdk']) {
    guidelines.push('- MCP SDK available. Build MCP servers with stdio transport');
  }
  if (allDeps['langchain'] || allDeps['@langchain/core']) {
    guidelines.push('- LangChain available. Use LCEL for chain composition');
  }
  if (allDeps['@aws-sdk/client-s3'] || allDeps['@aws-sdk/client-dynamodb']) {
    guidelines.push('- AWS SDK v3 configured. Use modular imports, not aws-sdk v2');
  }
  if (allDeps['@aws-cdk/aws-lambda'] || allDeps['aws-cdk-lib']) {
    guidelines.push('- AWS CDK available. Define stacks in lib/, constructs as separate classes');
  }

  // Security middleware
  if (allDeps['express-rate-limit']) {
    guidelines.push('- Rate limiting configured. Apply to auth endpoints. Set appropriate windowMs and max values');
  }
  if (allDeps['hpp']) {
    guidelines.push('- HPP (HTTP Parameter Pollution) protection enabled');
  }
  if (allDeps['csurf']) {
    guidelines.push('- CSRF protection enabled. Ensure tokens are included in all state-changing requests');
  }

  // AWS Lambda
  if (allDeps['@aws-sdk/client-lambda'] || allDeps['@aws-cdk/aws-lambda'] || allDeps['aws-cdk-lib']) {
    guidelines.push('- Lambda handlers: keep cold start fast, use layers for deps, set appropriate memory/timeout');
  }

  // Deprecated dependency warnings
  if (allDeps['moment']) {
    guidelines.push('- ⚠️ moment.js is deprecated and heavy (330KB). Migrate to date-fns or dayjs');
  }
  if (allDeps['request']) {
    guidelines.push('- ⚠️ request is deprecated. Use fetch (native) or axios instead');
  }
  if (allDeps['lodash'] && !allDeps['lodash-es']) {
    guidelines.push('- Consider replacing lodash with native JS methods or lodash-es for tree-shaking');
  }
  if (allDeps['node-sass']) {
    guidelines.push('- ⚠️ node-sass is deprecated. Migrate to sass (dart-sass)');
  }
  if (allDeps['tslint']) {
    guidelines.push('- ⚠️ TSLint is deprecated. Migrate to ESLint with @typescript-eslint');
  }

  return guidelines;
}

// ============================================================
// Helper: detect main directories
// ============================================================
function detectMainDirs(ctx) {
  const candidates = ['src', 'lib', 'app', 'pages', 'components', 'api', 'routes', 'utils', 'helpers', 'services', 'models', 'controllers', 'views', 'public', 'assets', 'config', 'tests', 'test', '__tests__', 'spec', 'scripts', 'prisma', 'db', 'middleware', 'hooks', 'agents', 'chains', 'workers', 'jobs', 'dags', 'macros', 'migrations'];
  // Also check inside src/ for nested structure (common in Next.js, React)
  const srcNested = ['src/components', 'src/app', 'src/pages', 'src/api', 'src/lib', 'src/hooks', 'src/utils', 'src/services', 'src/models', 'src/middleware', 'src/app/api', 'app/api', 'src/agents', 'src/chains', 'src/workers', 'src/jobs', 'models/staging', 'models/marts'];
  const found = [];
  const seenNames = new Set();

  for (const dir of [...candidates, ...srcNested]) {
    if (ctx.hasDir(dir)) {
      const files = ctx.dirFiles(dir);
      const displayName = dir.includes('/') ? dir : dir;
      if (!seenNames.has(displayName)) {
        found.push({ name: displayName, fileCount: files.length, files: files.slice(0, 10) });
        seenNames.add(displayName);
      }
    }
  }
  return found;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractTomlSection(content, sectionName) {
  const pattern = new RegExp(`\\[${escapeRegex(sectionName)}\\]([\\s\\S]*?)(?:\\n\\s*\\[|$)`);
  const match = content.match(pattern);
  return match ? match[1] : null;
}

function extractTomlValue(sectionContent, key) {
  if (!sectionContent) return null;
  const pattern = new RegExp(`^\\s*${escapeRegex(key)}\\s*=\\s*["']([^"']+)["']`, 'm');
  const match = sectionContent.match(pattern);
  return match ? match[1].trim() : null;
}

function detectProjectMetadata(ctx) {
  const pkg = ctx.jsonFile('package.json');
  if (pkg && (pkg.name || pkg.description)) {
    return {
      name: pkg.name || path.basename(ctx.dir),
      description: pkg.description || '',
    };
  }

  const pyproject = ctx.fileContent('pyproject.toml') || '';
  if (pyproject) {
    const projectSection = extractTomlSection(pyproject, 'project');
    const poetrySection = extractTomlSection(pyproject, 'tool.poetry');
    const name = extractTomlValue(projectSection, 'name') ||
      extractTomlValue(poetrySection, 'name');
    const description = extractTomlValue(projectSection, 'description') ||
      extractTomlValue(poetrySection, 'description');

    if (name || description) {
      return {
        name: name || path.basename(ctx.dir),
        description: description || '',
      };
    }
  }

  return {
    name: path.basename(ctx.dir),
    description: '',
  };
}

// ============================================================
// Helper: generate Mermaid diagram from directory structure
// ============================================================
function generateMermaid(dirs, stacks) {
  const stackKeys = stacks.map(s => s.key);
  const dirNames = dirs.map(d => d.name);

  // Build nodes based on what exists
  const nodes = [];
  const edges = [];
  let nodeId = 0;
  const ids = {};

  function addNode(label, shape) {
    const id = String.fromCharCode(65 + nodeId++); // A, B, C...
    ids[label] = id;
    if (shape === 'db') return `    ${id}[(${label})]`;
    if (shape === 'round') return `    ${id}(${label})`;
    return `    ${id}[${label}]`;
  }

  // Detect Next.js App Router specifically
  const hasAppRouter = dirNames.includes('app') || dirNames.includes('src/app');
  const hasPages = dirNames.includes('pages') || dirNames.includes('src/pages');
  const hasAppApi = dirNames.includes('app/api') || dirNames.includes('src/app/api');
  const hasSrcComponents = dirNames.includes('src/components') || dirNames.includes('components');
  const hasSrcHooks = dirNames.includes('src/hooks') || dirNames.includes('hooks');
  const hasSrcLib = dirNames.includes('src/lib') || dirNames.includes('lib');
  const hasSrcNode = dirNames.includes('src');
  const hasAgents = dirNames.includes('src/agents') || dirNames.includes('agents');
  const hasChains = dirNames.includes('src/chains') || dirNames.includes('chains');
  const hasWorkers = dirNames.includes('src/workers') || dirNames.includes('workers') || dirNames.includes('jobs');
  const hasPipelines = dirNames.includes('dags') || dirNames.includes('macros');

  // Smart entry point based on framework
  const isNextJs = stackKeys.includes('nextjs');
  const isDjango = stackKeys.includes('django');
  const isFastApi = stackKeys.includes('fastapi');

  if (isNextJs) {
    nodes.push(addNode('Next.js', 'round'));
  } else if (isDjango) {
    nodes.push(addNode('Django', 'round'));
  } else if (isFastApi) {
    nodes.push(addNode('FastAPI', 'round'));
  } else {
    nodes.push(addNode('Entry Point', 'round'));
  }

  const root = ids['Next.js'] || ids['Django'] || ids['FastAPI'] || ids['Entry Point'] || 'A';
  const pickNodeId = (...labels) => labels.map(label => ids[label]).find(Boolean) || root;

  // Detect layers
  if (hasAppRouter || hasPages) {
    const label = hasAppRouter ? 'App Router' : 'Pages';
    nodes.push(addNode(label, 'default'));
    edges.push(`    ${root} --> ${ids[label]}`);
  }

  if (hasAppApi) {
    nodes.push(addNode('API Routes', 'default'));
    const parent = ids['App Router'] || ids['Pages'] || root;
    edges.push(`    ${parent} --> ${ids['API Routes']}`);
  }

  if (hasSrcComponents) {
    nodes.push(addNode('Components', 'default'));
    const parent = ids['App Router'] || ids['Pages'] || root;
    edges.push(`    ${parent} --> ${ids['Components']}`);
  }

  if (hasSrcHooks) {
    nodes.push(addNode('Hooks', 'default'));
    const parent = ids['Components'] || root;
    edges.push(`    ${parent} --> ${ids['Hooks']}`);
  }

  if (hasSrcLib) {
    nodes.push(addNode('lib/', 'default'));
    const parent = pickNodeId('API Routes', 'Hooks', 'Components');
    edges.push(`    ${parent} --> ${ids['lib/']}`);
  } else if (hasSrcNode && !hasAppRouter && !hasPages) {
    nodes.push(addNode('src/', 'default'));
    edges.push(`    ${root} --> ${ids['src/']}`);
  }

  if (dirNames.includes('api') || dirNames.includes('routes') || dirNames.includes('controllers')) {
    const label = dirNames.includes('api') ? 'API Layer' : 'Routes';
    nodes.push(addNode(label, 'default'));
    const parent = pickNodeId('src/', 'App Router', 'Pages');
    edges.push(`    ${parent} --> ${ids[label]}`);
  }

  if (dirNames.includes('services')) {
    nodes.push(addNode('Services', 'default'));
    const parent = pickNodeId('API Layer', 'Routes', 'src/', 'App Router', 'Pages');
    edges.push(`    ${parent} --> ${ids['Services']}`);
  }

  if (dirNames.includes('models') || dirNames.includes('prisma') || dirNames.includes('db')) {
    nodes.push(addNode('Data Layer', 'default'));
    const parent = pickNodeId('Services', 'API Layer', 'Routes', 'src/', 'App Router', 'Pages');
    edges.push(`    ${parent} --> ${ids['Data Layer']}`);
    nodes.push(addNode('Database', 'db'));
    edges.push(`    ${ids['Data Layer']} --> ${ids['Database']}`);
  }

  if (dirNames.includes('utils') || dirNames.includes('helpers')) {
    nodes.push(addNode('Utils', 'default'));
    const parent = pickNodeId('src/', 'Services', 'lib/', 'Components');
    edges.push(`    ${parent} --> ${ids['Utils']}`);
  }

  if (dirNames.includes('middleware')) {
    nodes.push(addNode('Middleware', 'default'));
    const parent = pickNodeId('API Layer', 'Routes', 'App Router', 'Pages');
    edges.push(`    ${parent} --> ${ids['Middleware']}`);
  }

  if (hasChains) {
    nodes.push(addNode('Chains', 'default'));
    const parent = pickNodeId('Services', 'src/', 'lib/', 'API Layer');
    edges.push(`    ${parent} --> ${ids['Chains']}`);
  }

  if (hasAgents) {
    nodes.push(addNode('Agents', 'default'));
    const parent = pickNodeId('Chains', 'Services', 'src/', 'lib/');
    edges.push(`    ${parent} --> ${ids['Agents']}`);
  }

  if (hasWorkers) {
    nodes.push(addNode('Workers', 'default'));
    const parent = pickNodeId('Services', 'API Layer', 'src/');
    edges.push(`    ${parent} --> ${ids['Workers']}`);
  }

  if (hasPipelines) {
    nodes.push(addNode('Pipelines', 'default'));
    const parent = pickNodeId('Services', 'Data Layer', 'src/');
    edges.push(`    ${parent} --> ${ids['Pipelines']}`);
  }

  if (dirNames.includes('tests') || dirNames.includes('test') || dirNames.includes('__tests__') || dirNames.includes('spec')) {
    nodes.push(addNode('Tests', 'round'));
    const parent = pickNodeId('src/', 'App Router', 'Pages', 'Services', 'Components');
    edges.push(`    ${ids['Tests']} -.-> ${parent}`);
  }

  // Fallback: if we only have Entry Point, make a generic diagram
  if (nodes.length <= 1) {
    return `\`\`\`mermaid
graph TD
    A[Entry Point] --> B[Core Logic]
    B --> C[Data Layer]
    B --> D[API / Routes]
    C --> E[(Database)]
    D --> F[External Services]
\`\`\`
<!-- Update this diagram to match your actual architecture -->`;
  }

  return '```mermaid\ngraph TD\n' + nodes.join('\n') + '\n' + edges.join('\n') + '\n```';
}

// ============================================================
// Helper: framework-specific instructions
// ============================================================
function getFrameworkInstructions(stacks) {
  const stackKeys = stacks.map(s => s.key);
  const sections = [];

  if (stackKeys.includes('nextjs')) {
    sections.push(`### Next.js
- Use App Router conventions (app/ directory) when applicable
- Prefer Server Components by default; add 'use client' only when needed
- Use next/image for images, next/link for navigation
- API routes go in app/api/ (App Router) or pages/api/ (Pages Router)
- Use loading.tsx, error.tsx, and not-found.tsx for route-level UX
- If app/ exists, use Server Actions for mutations, validate with Zod, and call revalidatePath after writes
- Route handlers in app/api/ should export named functions: GET, POST, PUT, DELETE
- Middleware in middleware.ts should handle auth checks, redirects, and headers`);
  } else if (stackKeys.includes('react')) {
    sections.push(`### React
- Use functional components with hooks exclusively
- Prefer named exports over default exports
- Keep components under 150 lines; extract sub-components
- Use custom hooks to share stateful logic
- Colocate styles, tests, and types with components`);
  }

  if (stackKeys.includes('vue')) {
    sections.push(`### Vue
- Use Composition API with \`<script setup>\` syntax
- Prefer defineProps/defineEmits macros
- Keep components under 200 lines
- Use composables for shared logic`);
  }

  if (stackKeys.includes('angular')) {
    sections.push(`### Angular
- Use standalone components when possible
- Follow Angular style guide naming conventions
- Use reactive forms over template-driven forms
- Keep services focused on a single responsibility`);
  }

  if (stackKeys.includes('typescript')) {
    sections.push(`### TypeScript
- Use \`interface\` for object shapes, \`type\` for unions/intersections
- Enable strict mode in tsconfig.json
- Avoid \`any\` — use \`unknown\` and narrow with type guards
- Prefer \`as const\` assertions over enum when practical
- Export types alongside their implementations`);
  }

  if (stackKeys.includes('django')) {
    sections.push(`### Django
- Follow fat models, thin views pattern
- Use class-based views for complex logic, function views for simple
- Always use Django ORM; avoid raw SQL unless necessary
- Keep business logic in models or services, not views`);
  } else if (stackKeys.includes('fastapi')) {
    sections.push(`### FastAPI
- Use Pydantic models for request/response validation
- Use dependency injection for shared logic
- Keep route handlers thin; delegate to service functions
- Use async def for I/O-bound endpoints`);
  }

  if (stackKeys.includes('python') || stackKeys.includes('django') || stackKeys.includes('fastapi')) {
    sections.push(`### Python
- Use type hints on all function signatures and return types
- Follow PEP 8; use f-strings for formatting
- Prefer pathlib over os.path
- Use dataclasses or pydantic for structured data
- Raise specific exceptions; never bare \`except:\``);
  }

  if (stackKeys.includes('rust')) {
    sections.push(`### Rust
- Use Result<T, E> for error handling, avoid unwrap() in production code
- Prefer &str over String for function parameters
- Use clippy: \`cargo clippy -- -D warnings\`
- Structure: src/lib.rs for library, src/main.rs for binary`);
  }

  if (stackKeys.includes('go')) {
    sections.push(`### Go
- Follow standard Go project layout (cmd/, internal/, pkg/)
- Use interfaces for dependency injection and testability
- Handle all errors explicitly — never ignore err returns
- Use context.Context for cancellation and timeouts
- Prefer table-driven tests
- Run \`go vet\` and \`golangci-lint\` before committing
- If using gRPC: define .proto files in proto/ or pkg/proto, generate with protoc
- If Makefile exists: use make targets for build/test/lint
- Organize: cmd/ for entry points, internal/ for private packages, pkg/ for public`);
  }

  if (stackKeys.includes('cpp')) {
    sections.push(`### C++
- Follow project coding standards (check .clang-format if present)
- Use smart pointers (unique_ptr, shared_ptr) over raw pointers
- Run clang-tidy for static analysis
- Prefer const references for function parameters
- Use CMake targets, not raw compiler flags`);
  }

  if (stackKeys.includes('bazel')) {
    sections.push(`### Bazel
- Define BUILD files per package. Keep targets focused
- Use visibility carefully — prefer package-private
- Run buildifier for formatting`);
  }

  if (stackKeys.includes('terraform')) {
    sections.push(`### Terraform
- Use modules for reusable infrastructure components
- Always run \`terraform plan\` before \`terraform apply\`
- Store state remotely (S3 + DynamoDB, or Terraform Cloud)
- Use variables.tf for all configurable values
- Tag all resources consistently
- If using Helm: define charts in charts/ or helm/, use values.yaml for config
- Lock providers: always commit .terraform.lock.hcl
- Use terraform fmt before committing`);
  }

  const hasJS = stackKeys.some(k => ['react', 'vue', 'angular', 'nextjs', 'node', 'svelte'].includes(k));
  if (hasJS && !stackKeys.includes('typescript')) {
    sections.push(`### JavaScript
- Use \`const\` by default, \`let\` when reassignment needed; never \`var\`
- Use \`async/await\` over raw Promises
- Use named exports over default exports
- Import order: stdlib > external > internal > relative`);
  }

  return sections.join('\n\n');
}

// ============================================================
// TEMPLATES
// ============================================================

const TEMPLATES = {
  'claude-md': (stacks, ctx) => {
    const stackNames = stacks.map(s => s.label).join(', ') || 'General';
    const stackKeys = stacks.map(s => s.key);

    // --- Detect project details ---
    const scripts = detectScripts(ctx);
    const mainDirs = detectMainDirs(ctx);
    const hasTS = stackKeys.includes('typescript') || ctx.files.includes('tsconfig.json');
    const hasPython = stackKeys.includes('python') || stackKeys.includes('django') || stackKeys.includes('fastapi');
    const hasJS = stackKeys.some(k => ['react', 'vue', 'angular', 'nextjs', 'node', 'svelte'].includes(k));

    // --- Build commands section ---
    let buildSection = '';
    if (Object.keys(scripts).length > 0) {
      const lines = [];
      if (scripts.dev) lines.push(`npm run dev          # ${scripts.dev}`);
      if (scripts.start) lines.push(`npm start            # ${scripts.start}`);
      if (scripts.build) lines.push(`npm run build        # ${scripts.build}`);
      if (scripts.test) lines.push(`npm test             # ${scripts.test}`);
      if (scripts.lint) lines.push(`npm run lint         # ${scripts.lint}`);
      if (scripts.format) lines.push(`npm run format       # ${scripts.format}`);
      if (scripts.typecheck) lines.push(`npm run typecheck    # ${scripts.typecheck}`);
      if (scripts.check) lines.push(`npm run check        # ${scripts.check}`);
      buildSection = lines.join('\n');
    } else if (hasPython) {
      buildSection = `python -m pytest     # run tests
python -m mypy .     # type checking
ruff check .         # lint`;
    } else if (hasJS) {
      buildSection = `npm run build        # or: npx tsc --noEmit
npm test             # or: npx jest / npx vitest
npm run lint         # or: npx eslint .`;
    } else {
      buildSection = '# Add your build command\n# Add your test command\n# Add your lint command';
    }

    // --- Architecture description ---
    const mermaid = generateMermaid(mainDirs, stacks);

    let dirDescription = '';
    if (mainDirs.length > 0) {
      dirDescription = '\n### Directory Structure\n';
      for (const dir of mainDirs) {
        const suffix = dir.fileCount > 0 ? ` (${dir.fileCount} files)` : '';
        dirDescription += `- \`${dir.name}/\`${suffix}\n`;
      }
    }

    // --- Framework-specific instructions ---
    const frameworkInstructions = getFrameworkInstructions(stacks);
    let stackSection = frameworkInstructions
      ? `\n## Stack-Specific Guidelines\n\n${frameworkInstructions}\n`
      : '';

    // Check for security-focused project
    const pkg2 = ctx.jsonFile('package.json') || {};
    const allDeps2 = { ...(pkg2.dependencies || {}), ...(pkg2.devDependencies || {}) };
    const hasSecurityDeps = allDeps2['helmet'] || allDeps2['jsonwebtoken'] || allDeps2['bcrypt'] || allDeps2['passport'];
    if (hasSecurityDeps) {
      stackSection += '\n### Security Best Practices\n';
      stackSection += '- Follow OWASP Top 10 — run /security-review regularly\n';
      stackSection += '- Never log sensitive data (passwords, tokens, PII)\n';
      stackSection += '- Use parameterized queries — never string concatenation for SQL\n';
      stackSection += '- Set security headers via Helmet. Review CSP policy for your frontend\n';
      stackSection += '- Rate limit all authentication endpoints\n';
      stackSection += '- Validate and sanitize all user input at API boundaries\n';
    }

    // --- TypeScript-specific additions ---
    let tsSection = '';
    if (hasTS) {
      const tsconfig = ctx.jsonFile('tsconfig.json');
      if (tsconfig) {
        const strict = tsconfig.compilerOptions && tsconfig.compilerOptions.strict;
        tsSection = `
## TypeScript Configuration
- Strict mode: ${strict ? '**enabled**' : '**disabled** (consider enabling)'}
- Always fix type errors before committing — do not use \`@ts-ignore\`
- Run type checking: \`${scripts.typecheck ? 'npm run typecheck' : 'npx tsc --noEmit'}\`
`;
      }
    }

    // --- Dependency-specific guidelines ---
    const depGuidelines = detectDependencies(ctx);
    const depSection = depGuidelines.length > 0 ? `
## Key Dependencies
${depGuidelines.join('\n')}
` : '';

    // --- Verification criteria based on detected commands ---
    const verificationSteps = [];
    verificationSteps.push('1. All existing tests still pass');
    verificationSteps.push('2. New code has test coverage');
    if (scripts.lint || hasPython) {
      verificationSteps.push(`3. No linting errors (\`${scripts.lint ? 'npm run lint' : 'ruff check .'}\`)`);
    } else if (hasJS) {
      verificationSteps.push('3. No linting errors (`npx eslint .`)');
    } else {
      verificationSteps.push('3. No linting errors introduced');
    }
    if (scripts.build) {
      verificationSteps.push(`4. Build succeeds (\`npm run build\`)`);
    }
    if (hasTS) {
      verificationSteps.push(`${verificationSteps.length + 1}. No TypeScript errors (\`${scripts.typecheck ? 'npm run typecheck' : 'npx tsc --noEmit'}\`)`);
    }
    verificationSteps.push(`${verificationSteps.length + 1}. Changes match the requested scope (no gold-plating)`);

    // --- Read project metadata from package.json or pyproject.toml ---
    const projectMeta = detectProjectMetadata(ctx);
    const projectName = projectMeta.name;
    const projectDesc = projectMeta.description ? ` — ${projectMeta.description}` : '';

    // --- Assemble the final CLAUDE.md ---
    return `# ${projectName}${projectDesc}

## Architecture
${mermaid}
${dirDescription}
## Stack
${stackNames}
${stackSection}${tsSection}${depSection}
## Build & Test
\`\`\`bash
${buildSection}
\`\`\`

## Working Notes
- You are a careful engineer working inside this repository. Preserve its existing architecture and naming patterns unless the task requires a change
- Prefer extending existing modules over creating parallel abstractions
- Keep changes scoped to the requested task and verify them before marking work complete

<constraints>
- Never commit secrets, API keys, or .env files
- Always run tests before marking work complete
- Prefer editing existing files over creating new ones
- When uncertain about architecture, ask before implementing
${hasTS ? '- Do not use @ts-ignore or @ts-expect-error without a tracking issue\n' : ''}\
${hasJS ? '- Use const by default; never use var\n' : ''}\
</constraints>

<verification>
Before completing any task, confirm:
${verificationSteps.join('\n')}
</verification>

## Context Management
- Use /compact when context gets large (above 50% capacity)
- Prefer focused sessions — one task per conversation
- If a session gets too long, start fresh with /clear
- Use subagents for research tasks to keep main context clean

---
*Generated by [nerviq](https://github.com/nerviq/nerviq) v${require('../package.json').version} on ${new Date().toISOString().split('T')[0]}. Customize this file for your project — a hand-crafted CLAUDE.md will always be better than a generated one.*
`;
  },

  'hooks': () => ({
    'on-edit-lint.js': `#!/usr/bin/env node
// PostToolUse hook - runs linter after file edits
const { execSync } = require('child_process');
const fs = require('fs');
try {
  if (fs.existsSync('package.json')) {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    if (pkg.scripts && pkg.scripts.lint) {
      execSync('npm run lint --silent', { stdio: 'ignore', timeout: 30000 });
    }
  }
} catch (e) { /* linter not available or failed - non-blocking */ }
`,
    'protect-secrets.js': `#!/usr/bin/env node
// PreToolUse hook - blocks reads of secret files (Read/Write/Edit AND Bash)
let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    // Check file_path (for Read/Write/Edit)
    const fp = (data.tool_input && data.tool_input.file_path) || '';
    // Check command (for Bash)
    const cmd = (data.tool_input && data.tool_input.command) || '';

    const secretPattern = /\\.env($|\\.)|secrets[\\/\\\\]|credentials|\\.pem$|\\.key$/i;
    const bashSecretPattern = /\\bcat\\s+\\.env|\\bless\\s+\\.env|\\bhead\\s+\\.env|\\btail\\s+\\.env|\\bgrep\\b.*\\.env|\\bcp\\s+\\.env|\\bmv\\s+\\.env|\\bbase64\\s+\\.env|\\bxxd\\s+\\.env|secrets\\/|credentials|\\.pem\\b|\\.key\\b/i;

    if (secretPattern.test(fp) || bashSecretPattern.test(cmd)) {
      console.log(JSON.stringify({ decision: 'block', reason: 'Blocked: accessing secret/credential files is not allowed.' }));
    } else {
      console.log(JSON.stringify({ decision: 'allow' }));
    }
  } catch (e) {
    console.log(JSON.stringify({ decision: 'block', reason: 'Hook error - blocking for safety' }));
  }
});
`,
    'log-changes.js': `#!/usr/bin/env node
// PostToolUse hook - logs all file changes with timestamps
const fs = require('fs');
const path = require('path');
let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const fp = (data.tool_input && data.tool_input.file_path) || '';
    if (!fp) process.exit(0);
    const toolName = data.tool_name || 'unknown';
    const logDir = path.join('.claude', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const ts = new Date().toISOString().replace('T', ' ').split('.')[0];
    fs.appendFileSync(path.join(logDir, 'file-changes.log'), \`[\${ts}] \${toolName}: \${fp}\\n\`);
  } catch (e) { /* non-blocking */ }
});
`,
    'session-start.js': `#!/usr/bin/env node
// SessionStart hook - prepares logs and records session entry
const fs = require('fs');
const path = require('path');
const logDir = path.join('.claude', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const ts = new Date().toISOString().replace('T', ' ').split('.')[0];
fs.appendFileSync(path.join(logDir, 'sessions.log'), \`[\${ts}] session started\\n\`);
`,
  }),

  'commands': (stacks) => {
    const stackKeys = stacks.map(s => s.key);
    const isNext = stackKeys.includes('nextjs');
    const isDjango = stackKeys.includes('django');
    const isFastApi = stackKeys.includes('fastapi');
    const isPython = stackKeys.includes('python') || isDjango || isFastApi;
    const hasDocker = stackKeys.includes('docker');

    const cmds = {};

    // Test command - stack-specific
    if (isNext) {
      cmds['test.md'] = `Run the test suite for this Next.js project.

## Steps:
1. Run \`npm test\` (or \`npx vitest run\`)
2. If tests fail, check for missing mocks or async issues
3. For component tests, ensure React Testing Library patterns are used
4. For API route tests, check request/response handling
5. Report: total, passed, failed, coverage if available
`;
    } else if (isPython) {
      cmds['test.md'] = `Run the test suite for this Python project.

## Steps:
1. Run \`python -m pytest -v\` (or the project's test command)
2. Check for fixture issues, missing test database, or import errors
3. If using Django: \`python manage.py test\`
4. Report: total, passed, failed, and any tracebacks
`;
    } else {
      cmds['test.md'] = `Run the test suite and report results.

## Steps:
1. Run the project's test command
2. If tests fail, analyze the failures
3. Report: total, passed, failed, and any error details
`;
    }

    // Review - always generic (works well as-is)
    cmds['review.md'] = `Review the current changes for quality and correctness.

## Steps:
1. Run \`git diff\` to see all changes
2. Check for: bugs, security issues, missing tests, code style
3. Provide actionable feedback
`;

    cmds['security-review.md'] = `Run a focused security review using Claude Code's built-in security workflow.

## Steps:
1. Review auth, permissions, secrets handling, and data access paths
2. Run \`/security-review\` for OWASP-focused analysis
3. Check for unsafe shell commands, token leakage, and risky file access
4. Report findings ordered by severity with concrete fixes
`;

    // Deploy - stack-specific
    if (isNext) {
      cmds['deploy.md'] = `Pre-deployment checklist for Next.js.

## Pre-deploy:
1. Run \`git status\` — working tree must be clean
2. Run \`npm run build\` — must succeed with no errors
3. Run \`npm test\` — all tests pass
4. Run \`npm run lint\` — no lint errors
5. Check for \`console.log\` in production code
6. Verify environment variables are set in deployment platform

## Deploy:
1. If Vercel: \`git push\` triggers auto-deploy
2. If self-hosted: \`npm run build && npm start\`
3. Verify: check /api/health or main page loads
4. Tag: \`git tag -a vX.Y.Z -m "Release vX.Y.Z"\`
`;
    } else if (hasDocker) {
      cmds['deploy.md'] = `Pre-deployment checklist with Docker.

## Pre-deploy:
1. Run \`git status\` — working tree must be clean
2. Run full test suite — all tests pass
3. Run \`docker build -t app .\` — must succeed
4. Run \`docker run app\` locally — smoke test

## Deploy:
1. Build: \`docker build -t registry/app:latest .\`
2. Push: \`docker push registry/app:latest\`
3. Deploy to target environment
4. Verify health endpoint responds
5. Tag: \`git tag -a vX.Y.Z -m "Release vX.Y.Z"\`
`;
    } else {
      cmds['deploy.md'] = `Pre-deployment checklist.

## Pre-deploy:
1. Run \`git status\` — working tree must be clean
2. Run full test suite — all tests must pass
3. Run linter — no errors
4. Verify no secrets in staged changes
5. Review diff since last deploy

## Deploy:
1. Confirm target environment
2. Run deployment command
3. Verify deployment (health check)
4. Tag: \`git tag -a vX.Y.Z -m "Release vX.Y.Z"\`
`;
    }

    // Fix - always generic with $ARGUMENTS
    cmds['fix.md'] = `Fix the issue described: $ARGUMENTS

## Steps:
1. Understand the issue — read relevant code and error messages
2. Identify the root cause (not just the symptom)
3. Implement the minimal fix
4. Write or update tests to cover the fix
5. Run the full test suite to verify no regressions
6. Summarize what was wrong and how the fix addresses it
`;

    // Stack-specific bonus commands
    if (isNext) {
      cmds['check-build.md'] = `Run Next.js build check without deploying.

1. Run \`npx next build\`
2. Check for: TypeScript errors, missing pages, broken imports
3. Verify no "Dynamic server usage" errors in static pages
4. Report build output size and any warnings
`;
    }

    if (isPython && (isDjango || isFastApi)) {
      cmds['migrate.md'] = `Run database migrations safely.

1. Check current migration status${isDjango ? ': `python manage.py showmigrations`' : ''}
2. Create new migration if schema changed${isDjango ? ': `python manage.py makemigrations`' : ''}
3. Review the generated migration file
4. Apply: ${isDjango ? '`python manage.py migrate`' : '`alembic upgrade head`'}
5. Verify: check that the app starts and queries work
`;
    }

    return cmds;
  },

  'skills': () => ({
    'fix-issue/SKILL.md': `---
name: fix-issue
description: Fix a GitHub issue by number
---
Fix the GitHub issue: $ARGUMENTS

1. Read the issue details
2. Search the codebase for relevant files
3. Implement the fix
4. Write tests
5. Create a descriptive commit
`,
    'release-check/SKILL.md': `---
name: release-check
description: Prepare a release candidate and verify publish readiness
---
Prepare a release candidate for: $ARGUMENTS

1. Read CHANGELOG.md and package.json version
2. Run the test suite and packaging checks
3. Verify docs, tags, and release notes are aligned
4. Flag anything that would make the release unsafe or misleading
`,
  }),

  'rules': (stacks) => {
    const rules = {};
    const hasTS = stacks.some(s => s.key === 'typescript');
    const hasPython = stacks.some(s => s.key === 'python');
    const hasFrontend = stacks.some(s => ['react', 'vue', 'angular', 'svelte', 'nextjs'].includes(s.key));
    const hasBackend = stacks.some(s => ['go', 'python', 'django', 'fastapi', 'rust', 'java', 'node', 'nestjs'].includes(s.key));

    if (hasFrontend || (hasTS && !hasBackend)) {
      rules['frontend.md'] = `When editing JavaScript/TypeScript files (*.ts, *.tsx, *.js, *.jsx, *.vue):
- Use functional components with hooks (React/Vue 3)
- Add TypeScript interfaces for all props and function params
- Prefer \`const\` over \`let\`; never use \`var\`
- Use named exports over default exports
- Handle errors explicitly — no empty catch blocks
- Keep component files under 200 lines; extract sub-components
`;
    }
    if (hasBackend) {
      rules['backend.md'] = `When editing backend code:
- Handle all errors explicitly — never swallow exceptions silently
- Validate all external input at API boundaries
- Use dependency injection for testability
- Keep route handlers thin — delegate to service/business logic layers
- Log errors with sufficient context for debugging
- Never hardcode secrets or credentials
`;
    }
    if (hasPython) {
      rules['python.md'] = `When editing Python files (*.py):
- Use type hints for all function signatures and return types
- Follow PEP 8 conventions; max line length 88 (black default)
- Use f-strings for string formatting
- Prefer pathlib.Path over os.path
- Use \`if __name__ == "__main__":\` guard in scripts
- Raise specific exceptions, never bare \`except:\`
`;
    }
    rules['tests.md'] = `When writing or editing test files:
- Each test must have a clear, descriptive name (test_should_X_when_Y)
- Follow Arrange-Act-Assert (AAA) pattern
- One assertion per test when practical
- Never skip or disable tests without a tracking issue
- Mock external dependencies, not internal logic
- Include both happy path and edge case tests
`;
    rules['repository.md'] = hasPython
      ? `When changing release, packaging, or workflow files:
- Keep pyproject.toml (or requirements.txt), CHANGELOG.md, README.md, and docs in sync
- Prefer tagged release references over floating branch references in public docs
- Preserve backward compatibility in CLI flags where practical
- Any automation that writes files must document rollback expectations
`
      : `When changing release, packaging, or workflow files:
- Keep package.json, CHANGELOG.md, README.md, and docs in sync
- Prefer tagged release references over floating branch references in public docs
- Preserve backward compatibility in CLI flags where practical
- Any automation that writes files must document rollback expectations
`;
    return rules;
  },

  'agents': () => ({
    'security-reviewer.md': `---
name: security-reviewer
description: Reviews code for security vulnerabilities
tools: [Read, Grep, Glob]
model: sonnet
maxTurns: 50
---
Review code for security issues:
- Injection vulnerabilities (SQL, XSS, command injection)
- Authentication and authorization flaws
- Secrets or credentials in code
- Insecure data handling
`,
    'release-manager.md': `---
name: release-manager
description: Checks release readiness and packaging consistency
tools: [Read, Grep, Glob]
model: sonnet
maxTurns: 50
---
Review release readiness:
- version alignment across package.json, changelog, and docs
- publish safety and packaging scope
- missing rollback or migration notes
- documentation drift that would confuse adopters
`,
  }),

  'mermaid': () => `\`\`\`mermaid
graph TD
    A[Entry Point] --> B[Core Logic]
    B --> C[Data Layer]
    B --> D[API / Routes]
    C --> E[(Database)]
    D --> F[External Services]
\`\`\`
`,
};

async function setup(options) {
  if (options.platform === 'codex') {
    return setupCodex(options);
  }
  if (options.platform === 'windsurf') {
    const { setupWindsurf } = require('./windsurf/setup');
    return setupWindsurf(options);
  }
  if (options.platform === 'aider') {
    const { setupAider } = require('./aider/setup');
    return setupAider(options);
  }
  if (options.platform === 'cursor') {
    const { setupCursor } = require('./cursor/setup');
    return setupCursor(options);
  }

  const ctx = new ProjectContext(options.dir);
  const stacks = ctx.detectStacks(STACKS);
  const silent = options.silent === true;
  const writtenFiles = [];
  const preservedFiles = [];
  const mcpPreflightWarnings = getMcpPackPreflight(options.mcpPacks || [])
    .filter(item => item.missingEnvVars.length > 0);

  // Snapshot settings.json before any changes for rollback support
  const settingsPathForSnapshot = path.join(options.dir, '.claude/settings.json');
  let settingsSnapshotBefore = null;
  if (fs.existsSync(settingsPathForSnapshot)) {
    try {
      settingsSnapshotBefore = fs.readFileSync(settingsPathForSnapshot, 'utf8');
    } catch (_) {
      // Ignore read errors
    }
  }

  function log(message = '') {
    if (!silent) {
      console.log(message);
    }
  }

  log('');
  log('\x1b[1m  nerviq\x1b[0m');
  log('\x1b[2m  ═══════════════════════════════════════\x1b[0m');

  if (stacks.length > 0) {
    log(`\x1b[36m  Detected: ${stacks.map(s => s.label).join(', ')}\x1b[0m`);
  }
  log('');

  let created = 0;
  let skipped = 0;

  let failedWithTemplates = [];
  for (const [key, technique] of Object.entries(TECHNIQUES)) {
    if (technique.passed || technique.check(ctx)) continue;
    if (!technique.template) continue;
    failedWithTemplates.push({ key, technique });
  }

  // Filter by 'only' list if provided (interactive wizard selections)
  if (options.only && options.only.length > 0) {
    failedWithTemplates = failedWithTemplates.filter(r => options.only.includes(r.key));
  }

  for (const { key, technique } of failedWithTemplates) {

    const template = TEMPLATES[technique.template];
    if (!template) continue;

    // Pass ctx as second argument — only claude-md uses it
    const result = template(stacks, ctx);

    if (typeof result === 'string') {
      // Single file template (like CLAUDE.md)
      // Map technique keys to actual file paths
      const filePathMap = {
        'claudeMd': 'CLAUDE.md',
        'mermaidArchitecture': 'CLAUDE.md', // mermaid is part of CLAUDE.md, skip separate file
      };
      if (key === 'mermaidArchitecture') continue; // Mermaid is generated inside CLAUDE.md template
      const filePath = filePathMap[key] || key;
      const fullPath = path.join(options.dir, filePath);

      if (!fs.existsSync(fullPath)) {
        fs.writeFileSync(fullPath, result, 'utf8');
        writtenFiles.push(filePath);
        log(`  \x1b[32m✅\x1b[0m Created ${filePath}`);
        created++;
      } else {
        preservedFiles.push(filePath);
        log(`  \x1b[2m⏭️  Skipped ${filePath} (already exists — your version is kept)\x1b[0m`);
        skipped++;
      }
    } else if (typeof result === 'object') {
      // Multiple files template (hooks, commands, etc)
      const dirMap = {
        'hooks': '.claude/hooks',
        'commands': '.claude/commands',
        'skills': '.claude/skills',
        'rules': '.claude/rules',
        'agents': '.claude/agents',
      };
      const targetDir = dirMap[technique.template] || `.claude/${technique.template}`;
      const fullDir = path.join(options.dir, targetDir);

      if (!fs.existsSync(fullDir)) {
        fs.mkdirSync(fullDir, { recursive: true });
      }

      for (const [fileName, content] of Object.entries(result)) {
        const filePath = path.join(fullDir, fileName);
        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, content, 'utf8');
          writtenFiles.push(path.relative(options.dir, filePath));
          log(`  \x1b[32m✅\x1b[0m Created ${path.relative(options.dir, filePath)}`);
          created++;
        } else {
          preservedFiles.push(path.relative(options.dir, filePath));
          skipped++;
        }
      }
    }
  }

  // Auto-register hooks in settings — always merge hooks into settings.json
  const hooksDir = path.join(options.dir, '.claude/hooks');
  const settingsPath = path.join(options.dir, '.claude/settings.json');
  if (fs.existsSync(hooksDir)) {
    const hookFiles = fs.readdirSync(hooksDir).filter(f => f.endsWith('.sh') || f.endsWith('.js'));
    if (hookFiles.length > 0) {
      const newSettings = buildSettingsForProfile({
        profileKey: options.profile || 'safe-write',
        hookFiles,
        mcpPackKeys: options.mcpPacks || [],
      });
      // Merge new settings into existing settings.json, preserving all fields
      let existingSettings = {};
      if (fs.existsSync(settingsPath)) {
        try {
          existingSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        } catch (_) {
          // If settings.json is malformed, start fresh
          existingSettings = {};
        }
      }
      // Merge all fields from newSettings into existing, preserving existing values
      if (newSettings.hooks) existingSettings.hooks = newSettings.hooks;
      if (newSettings.permissions) {
        existingSettings.permissions = existingSettings.permissions || {};
        // MERGE deny rules: keep existing + add new (deduplicate)
        const existingDeny = existingSettings.permissions.deny || [];
        const newDeny = newSettings.permissions.deny || [];
        existingSettings.permissions.deny = [...new Set([...existingDeny, ...newDeny])];
        // Only set defaultMode if not already set
        if (!existingSettings.permissions.defaultMode && newSettings.permissions.defaultMode) {
          existingSettings.permissions.defaultMode = newSettings.permissions.defaultMode;
        }
      }
      if (newSettings.mcpServers) existingSettings.mcpServers = { ...existingSettings.mcpServers, ...newSettings.mcpServers };
      if (newSettings.nerviqSetup) existingSettings.nerviqSetup = { ...existingSettings.nerviqSetup, ...newSettings.nerviqSetup };
      fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2), 'utf8');
      if (!writtenFiles.includes('.claude/settings.json') && !preservedFiles.includes('.claude/settings.json')) {
        writtenFiles.push('.claude/settings.json');
        log(`  \x1b[32m✅\x1b[0m Updated .claude/settings.json (hooks registered)`);
        created++;
      } else {
        log(`  \x1b[32m✅\x1b[0m Merged hooks into existing .claude/settings.json`);
      }
    }
  }

  log('');
  if (created === 0 && skipped > 0) {
    log('  \x1b[32m✅\x1b[0m Your project is already well configured!');
    log(`  \x1b[2m  ${skipped} files already exist and were preserved.\x1b[0m`);
    log('  \x1b[2m  We never overwrite your existing config — your setup is kept.\x1b[0m');
  } else if (created > 0) {
    log(`  \x1b[1m${created} files created:\x1b[0m`);
    for (const f of writtenFiles) {
      log(`  \x1b[32m  + ${f}\x1b[0m`);
    }
    if (skipped > 0) {
      log(`  \x1b[2m${skipped} existing files preserved (not overwritten).\x1b[0m`);
    }
  }

  log('');
  if (mcpPreflightWarnings.length > 0) {
    log('\x1b[33m  MCP Preflight Warnings\x1b[0m');
    for (const warning of mcpPreflightWarnings) {
      log(`  - ${warning.label}: missing ${warning.missingEnvVars.join(', ')}`);
      log('  \x1b[2m  Settings were generated with placeholders, but this MCP server will not start until those env vars are set.\x1b[0m');
    }
    log('');
  }

  log('  Run \x1b[1mnpx nerviq audit\x1b[0m to check your score.');
  log('');

  // Write rollback artifact so setup can be undone
  let rollbackId = null;
  if (writtenFiles.length > 0) {
    const patchedFiles = [];
    // If settings.json was modified (not newly created), record the before-snapshot
    if (settingsSnapshotBefore !== null && writtenFiles.includes('.claude/settings.json')) {
      patchedFiles.push({
        file: '.claude/settings.json',
        before: settingsSnapshotBefore,
      });
    }
    const rollbackArtifact = writeRollbackArtifact(options.dir, {
      sourcePlan: 'setup',
      createdFiles: writtenFiles.filter(f => {
        // Exclude patched files from createdFiles list
        return !patchedFiles.some(p => p.file === f);
      }),
      patchedFiles,
      rollbackInstructions: ['Use nerviq rollback to undo this setup'],
    });
    rollbackId = rollbackArtifact.id;
  }

  return {
    created,
    skipped,
    writtenFiles,
    preservedFiles,
    stacks,
    mcpPreflightWarnings,
    rollbackId,
  };
}

module.exports = { setup, TEMPLATES };
