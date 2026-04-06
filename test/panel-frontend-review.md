# nerviq-cli Panel Review: Personas 7-12 (Frontend/Fullstack Engineers)

**Date**: 2026-03-31
**Tool version**: nerviq-cli v1.6.0
**Reviewers**: 6 veteran engineers (30 years experience each), daily Claude Code users

---

## Summary Table

| Persona | Role | Pre-Score | Post-Score | Organic | Verdict |
|---------|------|-----------|------------|---------|---------|
| Maya | Next.js Enterprise Lead | 8/100 | 57/100 | 28/100 | **Positive with caveats** |
| Amit | Startup CTO (SaaS Monorepo) | 7/100 | 55/100 | 27/100 | **Disappointing** |
| Gal | Platform Engineer (DX) | 10/100 | 58/100 | 29/100 | **Mixed** |
| Rami | Agent Systems Architect | 27/100 | 45/100 | N/A | **Frustrated** |
| Noga | LLMOps Engineer | 8/100 | 58/100 | 29/100 | **Pleasantly surprised** |
| Michal | QA Automation Lead | 10/100 | 61/100 | 31/100 | **Good baseline, needs depth** |

---

## Persona 7: MAYA - Next.js Enterprise Lead

**Project**: Enterprise dashboard (Next.js 16, React 19, TanStack Query, Zustand, Tailwind 4, Zod, Playwright, Vitest)
**Audit**: Detected `React, Next.js, Node.js, TypeScript` -- **correct, full detection**
**Score**: 8 -> 57/100 (Organic: 28)

### What Maya Liked

1. **Stack detection was spot-on**: Detected Next.js, React, TypeScript, and Tailwind. The CLAUDE.md correctly references App Router, Server Components, `'use client'` directive, and loading.tsx/error.tsx patterns.
2. **TanStack Query guidance is real**: "Use React Query (TanStack Query) for all server data fetching -- never raw useEffect + fetch" and "Define query keys as constants. Invalidate related queries after mutations." This is exactly what she tells her juniors.
3. **Zod + Zustand + MSW all recognized**: Each dependency got a targeted bullet point with correct usage patterns. MSW handlers mentioned in `__mocks__/` is correct.
4. **Next.js-specific commands**: `/check-build` command checks for "Dynamic server usage" errors in static pages -- a real Next.js gotcha. The deploy command mentions Vercel auto-deploy.
5. **`<constraints>` and `<verification>` blocks**: Well-structured XML blocks for rules. The verification checklist includes `npx tsc --noEmit` which is exactly right.
6. **TypeScript strict mode detected**: "Strict mode: **enabled**" with "Always fix type errors before committing" and "do not use `@ts-ignore`."

### What Maya Disliked

1. **Mermaid diagram has `undefined`**: The architecture diagram shows `G -.-> undefined` which is a rendering bug. Looks like a missing test framework node name.
2. **No mention of Server Actions**: Next.js 16 Server Actions are THE data mutation pattern. The CLAUDE.md mentions them in the App Router section but doesn't make them prominent enough for an enterprise app.
3. **No RSC boundary guidance**: The biggest pain in Next.js enterprise is knowing what to mark `'use client'`. The generated CLAUDE.md says "Add 'use client' only when needed" but doesn't specify which hooks/features require it.
4. **Missing `next.config.js` awareness**: PPR (Partial Prerendering) and React Compiler are configured but not mentioned.
5. **No middleware.ts guidance beyond one bullet**: Enterprise dashboards live and die by middleware auth. One bullet point is not enough.
6. **Test command is generic**: `/test` says "run `npm test`" but doesn't distinguish between unit (vitest) and E2E (playwright) test runs.
7. **Missing .gitignore generation**: Still flagged as critical after setup. The tool should have created one.

### Maya's Verdict: **7/10 -- Positive with caveats**

> "This is genuinely useful as a starting point. The stack detection and dependency-specific guidance puts me 70% of the way there. But the Mermaid `undefined` bug is embarrassing, and for a Next.js 16 enterprise app, I need more depth on RSC patterns, Server Actions, and middleware. I'd keep 80% of this and rewrite the rest."

---

## Persona 8: AMIT - Startup CTO (SaaS Monorepo)

**Project**: SaaS platform monorepo (Next.js, tRPC, Drizzle, Clerk, Stripe, Resend, Turbo, Vitest)
**Audit**: Detected `Node.js` only -- **MISSED Next.js, TypeScript, React, tRPC, Drizzle**
**Score**: 7 -> 55/100 (Organic: 27)

### What Amit Liked

1. **Turborepo detected**: "Turborepo monorepo -- use `turbo run` for all tasks. Respect package boundaries." Correct and useful.
2. **Build commands correct**: `turbo dev`, `turbo build`, `turbo test` -- pulled from actual package.json scripts.
3. **Security hooks solid**: The protect-secrets.sh hook blocking .env reads is critical for a SaaS with Stripe/Clerk keys.
4. **Generic constraints still apply**: "Never commit secrets" and verification blocks are universally good.

### What Amit Disliked

1. **MASSIVE detection failure**: Only detected "Node.js". Missed Next.js (in apps/web), TypeScript (multiple tsconfig files implied), React, tRPC, Drizzle, Clerk, Stripe, Resend. For a tool that claims 1,107 techniques, this is unacceptable.
2. **No monorepo workspace awareness**: The CLAUDE.md doesn't mention `@saas/web`, `@saas/api`, `@saas/db`, `@saas/email`, `@saas/ui` workspace packages. It doesn't explain how to work across packages.
3. **Mermaid diagram is generic boilerplate**: Shows `Entry Point -> Core Logic -> Data Layer -> Database` which describes nothing about this actual project. Should show apps/web -> apps/api -> packages/db, etc.
4. **Zero tRPC guidance**: tRPC is the backbone of the app. No mention of routers, procedures, type inference, or the tRPC-React Query integration.
5. **Zero Drizzle guidance**: The schema.ts file exists with actual table definitions. No mention of Drizzle migrations, schema changes, or ORM patterns.
6. **Zero Clerk/Stripe/Resend guidance**: No mention of auth middleware, webhook handling, billing flows, or email templates -- the core SaaS concerns.
7. **No `/migrate` command**: For a Drizzle-based project, database migration is the #1 workflow. Got a generic `/deploy` instead.
8. **Missing `check-build` command**: Maya's Next.js project got this but Amit's monorepo with Next.js didn't, because Next.js wasn't detected.
9. **pnpm-workspace.yaml not utilized**: The tool saw turbo.json but didn't leverage the workspace definition to understand the dependency graph.

### Amit's Verdict: **4/10 -- Disappointing**

> "This tool fundamentally fails at monorepo detection. It read the root package.json and stopped there. My apps/web has Next.js, my apps/api has tRPC, my packages/db has Drizzle -- none of that was detected. The generated CLAUDE.md is so generic it's almost harmful -- it gives Claude Code the impression this is a simple Node.js project when it's a complex SaaS platform. I'd delete the generated CLAUDE.md and write my own."

---

## Persona 9: GAL - Platform Engineer (DX)

**Project**: Component library platform (Turborepo, pnpm, Changesets, GitHub Actions, Storybook)
**Audit**: Detected `React, Node.js` -- **MISSED TypeScript, Storybook, Changesets**
**Score**: 10 -> 58/100 (Organic: 29)

### What Gal Liked

1. **Turborepo recognized**: Same as Amit, the turbo.json detection works.
2. **CI pipeline detected**: Found `.github/workflows/release.yml` and gave credit.
3. **Frontend rule is decent**: The `.claude/rules/frontend.md` with "Keep component files under 200 lines" and "Add TypeScript interfaces for all props" aligns with component library standards.
4. **Test rules are solid**: AAA pattern, descriptive names, mock external deps -- all correct for component testing.

### What Gal Disliked

1. **Zero Changesets awareness**: Changesets is THE versioning tool for this project. No mention of `changeset`, version bumping, or publish workflows. No `/version` or `/publish` command generated.
2. **Zero Storybook awareness**: Has `.storybook/main.ts` configured with stories in `packages/ui/stories/**/*.stories.@(ts|tsx)`. No mention anywhere. Should have a `/storybook` command or at least CLAUDE.md guidance.
3. **No design token guidance**: `packages/tokens/` with color definitions exists. No mention of token building, token consumption, or the build pipeline.
4. **Mermaid diagram is generic boilerplate again**: `Entry Point -> Core Logic -> Data Layer -> Database` for a component library platform that has no database. Completely wrong architecture.
5. **No package publishing guidance**: This is a PUBLIC package library (`"access": "public"` in changeset config). The CLAUDE.md should mention npm publishing, semver, and breaking change policies.
6. **Missing `tools/generators` awareness**: Custom code generators exist but aren't mentioned. A `/generate` command would be natural.
7. **`deploy` command doesn't fit**: Component libraries don't "deploy" -- they publish. The generic deploy command is misleading.
8. **No linked packages awareness**: Changesets config has `linked: [["@ds/ui", "@ds/tokens", "@ds/icons"]]` -- these packages version together. Critical for Claude to understand.

### Gal's Verdict: **5/10 -- Mixed**

> "The tool gives me a reasonable generic scaffold, but it completely misses what makes this project special: it's a design system with Changesets versioning, Storybook docs, and design tokens. The Mermaid diagram showing a 'Database' node for a component library is honestly laughable. I'd keep the hooks and rules but rewrite CLAUDE.md from scratch."

---

## Persona 10: RAMI - Agent Systems Architect

**Project**: Agent platform (Anthropic SDK, MCP SDK, LangChain, multi-agent orchestration)
**Audit**: Detected `Node.js` -- **MISSED TypeScript, Anthropic SDK, MCP SDK, LangChain**
**Score**: 27 -> 45/100 (Organic: N/A, had pre-existing config)

### What Rami Liked

1. **Existing CLAUDE.md preserved**: The tool did NOT overwrite his carefully crafted CLAUDE.md with agent patterns, MCP integration docs, and architectural decisions. This is critical -- `"5 existing files preserved (not overwritten)."` **This is the most important thing the tool did right.**
2. **Existing agents preserved**: All 3 agents (researcher, executor, evaluator) survived untouched.
3. **Existing commands preserved**: `/run-agent` and `/evaluate` commands survived.
4. **Added useful scaffolding alongside**: Got new `/test`, `/review`, `/fix`, `/deploy` commands that complement his existing setup. Got hooks (protect-secrets, log-changes, on-edit-lint) that his project was missing.
5. **Score went from 27 to 45**: Meaningful improvement without destroying existing work.

### What Rami Disliked

1. **No security-reviewer agent generated for his project**: Wait -- it WAS supposed to create one but couldn't because agents/ already existed? Actually checking: the tool DID add security-reviewer.md... no, the output shows "10 files created" and didn't list security-reviewer.md. The existing agents directory prevented it.
2. **Didn't detect Anthropic SDK or MCP**: `@anthropic-ai/sdk` and `@modelcontextprotocol/sdk` are in package.json. No specific guidance generated.
3. **Didn't detect existing agent architecture**: The tool should have seen `src/agents/`, `src/tools/`, `src/chains/`, `src/prompts/` and understood this is an agent system. Instead it classified it as generic "Node.js".
4. **Generic JavaScript guidelines instead of TypeScript**: The project uses TypeScript (tsconfig implied by `.ts` files). Got JavaScript guidelines instead.
5. **No MCP-specific rules or commands**: Should have generated a `/run-mcp` or `/test-agent` command that understands MCP protocol testing.
6. **Lower score than projects without existing config**: 45/100 vs 55-61 for greenfield projects. The existing CLAUDE.md format doesn't match the audit's expected patterns (no `<constraints>`, no `<verification>` block), so it actually scores lower in some areas.

### Rami's Verdict: **6/10 -- Respectful but shallow**

> "I'm relieved it didn't destroy my existing config. That alone makes it trustworthy for a first run. But the detection is shallow -- it doesn't understand agent patterns, MCP, or the Anthropic SDK at all. The hooks and generic commands are useful additions, but the tool doesn't understand what my project actually does. The lower score than greenfield projects is a scoring design issue."

---

## Persona 11: NOGA - LLMOps Engineer

**Project**: RAG pipeline (LangChain, Anthropic, OpenAI, ChromaDB, Pinecone, MLflow, W&B, Transformers)
**Audit**: Detected `Python, FastAPI, Node.js, Docker` -- **Good detection but missed ML-specific stack**
**Score**: 8 -> 58/100 (Organic: 29)

### What Noga Liked

1. **Excellent dependency detection**: The CLAUDE.md lists guidance for LangChain, OpenAI, Anthropic, ChromaDB, Pinecone, MLflow, W&B, and HuggingFace Transformers. Each has a targeted bullet: "Use LangChain for chain/agent orchestration. Define chains in chains/ directory", "Use ChromaDB for local vector storage. Persist collections to disk", "Use MLflow for experiment tracking. Log all model parameters and metrics." **This is impressively thorough.**
2. **Python-specific rules**: Got `python.md` rule with type hints, PEP 8, f-strings, pathlib, specific exceptions. Also got `backend.md` with API boundary validation and dependency injection.
3. **FastAPI guidance**: "Use Pydantic models for request/response validation", "Use async def for I/O-bound endpoints" -- correct and useful.
4. **Docker deploy command**: Correctly generates Docker-specific deployment steps (`docker build`, `docker push`, health endpoint verification).
5. **`/migrate` command generated**: For Python/FastAPI, it correctly suggests Alembic migrations.
6. **`ruff check .` in verification**: Detected ruff as the Python linter for the verification block.
7. **Pytest command correct**: `/test` command says `python -m pytest -v`.

### What Noga Disliked

1. **No RAG-specific guidance**: The project IS a RAG pipeline. No mention of retrieval patterns, chunking strategies, embedding strategies, or evaluation metrics (faithfulness, relevancy, precision). The `ragas` library is in requirements.txt but not mentioned.
2. **No experiment tracking workflow**: MLflow and W&B are mentioned as deps but there's no `/experiment` command or guidance on how to structure experiments, log results, or compare runs.
3. **Mermaid diagram is minimal**: Shows `FastAPI -> src/ -> Data Layer -> Database` but doesn't show the RAG pipeline: Documents -> Embeddings -> Vector Store -> Retrieval -> LLM -> Response.
4. **"Use const by default; never use var" in constraints**: This is JavaScript advice in a Python project! The `<constraints>` block has JS rules mixed with Python.
5. **Build & Test section only has `npm run dev`**: For a Python project, should show `pip install -r requirements.txt`, `python -m pytest`, `ruff check .`, `uvicorn src.api:app --reload`. The npm command is there because of the package.json stub.
6. **No `.env` handling for ML projects**: ML projects have tons of API keys (Anthropic, OpenAI, Pinecone, W&B). Should have stronger guidance on secrets management beyond the generic hook.
7. **No notebook awareness**: The `notebooks/` directory exists but no guidance on Jupyter notebook usage patterns.
8. **Node.js detected alongside Python**: The package.json has one script. Detecting "Node.js" as a primary stack is misleading.

### Noga's Verdict: **7/10 -- Pleasantly surprised**

> "I came in skeptical but the dependency detection impressed me. Seeing ChromaDB, Pinecone, MLflow, and W&B each get targeted guidance means someone actually mapped Python ML dependencies. But the JS constraints in a Python project, the npm-focused build section, and the lack of RAG-specific patterns are signs that the Python support is good at dependency level but weak at architectural level. For a generic setup tool, this is better than I expected."

---

## Persona 12: MICHAL - QA Automation Lead

**Project**: Testing-focused app (Playwright, Vitest, Testing Library, MSW, Storybook, k6)
**Audit**: Detected `React, Node.js` -- **MISSED TypeScript, Playwright, Vitest, Storybook**
**Score**: 10 -> 61/100 (Organic: 31) -- **Highest score in the panel**

### What Michal Liked

1. **Testing dependencies well-recognized**: MSW ("Use MSW for API mocking in tests. Define handlers in `__mocks__/`"), Testing Library ("Prefer userEvent over fireEvent, query by role/label"), Playwright ("Keep tests in tests/ or e2e/"), Vitest ("Colocate test files with source").
2. **Coverage awareness**: "Coverage configured. Maintain coverage thresholds. Check reports before merging." Detected the coverage config in vitest.config.ts.
3. **Test rules are excellent**: `.claude/rules/tests.md` with AAA pattern, descriptive names, external mocking, happy path + edge cases -- this is textbook QA guidance.
4. **Frontend rules complement testing**: "Keep component files under 200 lines" makes components testable.
5. **Security hook relevant**: For a project that tests auth flows, the protect-secrets hook preventing .env access is practical.
6. **Highest organic score (31)**: The CI pipeline detection helped, plus the strong testing tool recognition.

### What Michal Disliked

1. **No test organization guidance**: The project has `tests/e2e/`, `tests/unit/`, `tests/integration/` -- three distinct testing layers. CLAUDE.md doesn't explain when to write which type or how they relate.
2. **No k6 awareness**: k6 for load testing is in the project. Zero mention. Should have a `/load-test` command.
3. **No Storybook awareness**: Same issue as Gal's project -- `.storybook/main.ts` exists but is completely ignored.
4. **Test command is too simple**: `/test` just says "run the project's test command." Should distinguish between `npm test` (unit), `npm run test:e2e` (E2E), `npm run test:integration`, and `npm run test:coverage`.
5. **No MSW handler management guidance**: The project has `src/__mocks__/handlers.ts` but no guidance on how to add new handlers, reset handlers between tests, or use `server.use()` for per-test overrides.
6. **No Playwright-specific guidance**: No mention of page objects, fixtures, test.describe patterns, trace viewing, or the multi-browser project config that exists in playwright.config.ts.
7. **Missing vitest.integration.config.ts awareness**: There's a separate integration test config in the scripts. Not detected.
8. **No CI test reporting guidance**: The playwright config generates JUnit XML reports (`test-results/e2e.xml`). No mention of CI artifact handling or test report integration.
9. **Coverage thresholds not surfaced**: vitest.config.ts has `thresholds: { lines: 80, branches: 75 }` -- these specific numbers should be in CLAUDE.md.

### Michal's Verdict: **6.5/10 -- Good baseline, needs depth**

> "For a generic tool, the testing dependency recognition is solid. I'm happy it knows about MSW handlers, Testing Library best practices, and coverage. But it treats testing as one monolithic thing when my whole project is about testing strategy -- multiple layers, specific thresholds, CI reporting, load testing. The `/test` command should be 4 separate commands. I'd keep the generated scaffold and add 50% more testing-specific content."

---

## Cross-Panel Analysis

### Systemic Issues Found Across All 6 Personas

1. **Monorepo detection is broken** (Amit, Gal): Only reads root package.json. Misses sub-package dependencies entirely. This is a critical gap since monorepos are the standard architecture now.

2. **Mermaid diagrams are unreliable** (Maya: `undefined` bug, Amit/Gal: generic boilerplate, Noga: oversimplified, Michal: oversimplified): The auto-generated diagrams are the weakest feature. They range from buggy to wrong to generic.

3. **Stack detection reads package.json shallowly** (Amit, Gal, Rami): Only detects what's in the ROOT package.json `dependencies`/`devDependencies`. Doesn't traverse workspace packages, doesn't parse import statements, doesn't check tsconfig.json for TypeScript.

4. **No .gitignore generation**: Every single persona still has "missing .gitignore" as a critical issue after setup. The tool should create a basic .gitignore.

5. **Generic commands for specialized projects** (Gal: `/deploy` instead of `/publish`, all: single `/test` instead of typed test commands): Commands should be tailored to what the project actually does.

6. **JavaScript constraints leak into non-JS projects** (Noga): `"Use const by default; never use var"` appears in a Python project's constraints block.

### Universally Good Across All Personas

1. **Hooks are universally useful**: protect-secrets.sh, log-changes.sh, and on-edit-lint.sh are practical for every project type.

2. **Existing config is preserved**: Rami's existing CLAUDE.md, agents, and commands were all respected. This is critical for adoption.

3. **`<constraints>` and `<verification>` XML blocks**: Well-structured and genuinely useful for Claude Code adherence.

4. **Dependency-specific guidance works well**: When deps are detected, the guidance is accurate and practical (TanStack Query, Zod, Zustand, MLflow, ChromaDB, etc.).

5. **Settings.json hook registration is correct**: The hooks are properly registered with appropriate matchers and timeouts.

### Score Distribution

| Metric | Min | Max | Average |
|--------|-----|-----|---------|
| Pre-setup | 7 | 27 | 11.7 |
| Post-setup | 45 | 61 | 55.7 |
| Organic | 27 | 31 | 28.8 |
| Improvement | +18 | +50 | +44.0 |
| Reviewer rating | 4/10 | 7/10 | 5.9/10 |

### Priority Fix Recommendations

1. **P0 - Monorepo workspace traversal**: Read pnpm-workspace.yaml/turbo.json, scan all workspace package.json files, merge detected stacks.
2. **P0 - Fix Mermaid `undefined` bug**: The graph node reference is broken in Next.js detection.
3. **P1 - Generate .gitignore**: Most basic scaffolding gap.
4. **P1 - TypeScript detection**: Check for tsconfig.json, .ts/.tsx files, not just package.json deps.
5. **P1 - Language-specific constraint blocks**: Don't put JS rules in Python projects.
6. **P2 - Specialized command generation**: `/publish` for libraries, `/test:e2e` + `/test:unit` for multi-layer test setups, `/experiment` for ML projects.
7. **P2 - Storybook and Changesets detection**: Both are major tools completely ignored.
8. **P2 - Better Mermaid architecture**: Use actual directory names and detected workspace packages instead of generic boilerplate.
9. **P3 - Agent/MCP pattern detection**: Recognize `src/agents/`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk` as an agent architecture.

---

*Review conducted 2026-03-31 by 6 simulated veteran engineers. All tests run against actual nerviq-cli v1.6.0 output.*
