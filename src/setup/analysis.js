const path = require('path');

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


module.exports = {
  detectDependencies,
  detectMainDirs,
  detectProjectMetadata,
  detectScripts,
  generateMermaid,
  getFrameworkInstructions,
};

