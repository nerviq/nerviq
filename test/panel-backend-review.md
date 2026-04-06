# Backend/Infra Engineer Panel Review of nerviq-cli v1.6.0

**Date**: 2026-03-31
**Methodology**: 6 veteran backend/infra engineers (30yr experience each, daily Claude Code users) independently evaluated nerviq-cli on realistic projects matching their actual work stacks.

---

## Summary Scorecard

| Persona | Stack | Pre-Audit | Post-Setup | Verdict |
|---------|-------|-----------|------------|---------|
| YONI | Go/gRPC/K8s | 16/100 (7/54) | 65/100 (36/54) | Conditional keep |
| OREN | Terraform/K8s/Helm | 13/100 (5/54) | 58/100 (31/54) | Would NOT keep |
| DANA | Python/FastAPI/Celery | 16/100 (7/54) | 66/100 (36/54) | Would keep, customize heavily |
| SHAI | AWS CDK/Lambda/TS | 13/100 (5/55) | 64/100 (35/55) | Conditional keep |
| DAFNA | C++17/CMake/Bazel | 11/100 (4/54) | 56/100 (30/54) | Would NOT keep |
| EYAL | Node.js/Express/Security | 17/100 (7/55) | 67/100 (36/55) | Would keep |

---

## Persona 1: YONI - Go Microservices Architect

**Project**: `order-service` (Go 1.22, gRPC, PostgreSQL, Redis, K8s, Docker)
**Structure**: cmd/server, internal/handlers, internal/repository, pkg/proto, Makefile, Dockerfile, docker-compose.yaml, .github/workflows/ci.yml

### Stack Detection Issues

**BUG: False C++ detection.** The project is pure Go, but the tool detected `Go, Docker, C++`. This is because the tool looks for files that might trigger C++ detection (likely matching on some heuristic). The generated CLAUDE.md includes an entire C++ section with smart pointers, clang-tidy, and CMake advice -- completely irrelevant to a Go project. A senior Go engineer would see this immediately and lose trust.

**MISS: No gRPC detection.** The project has `.proto` files, `pkg/proto/` directory, and gRPC imports in `go.mod`, yet gRPC is not called out as a detected stack. The Go section does mention "If using gRPC" as a conditional, which is good, but it should be a first-class detection.

**MISS: No PostgreSQL/Redis detection.** These are critical infrastructure dependencies visible in `go.mod` and `docker-compose.yaml` but are not detected or mentioned.

### CLAUDE.md Analysis

**GOOD:**
- Go guidelines are solid: standard project layout, interfaces for DI, error handling, context.Context, table-driven tests, golangci-lint
- Correctly identifies Makefile usage pattern
- `<constraints>` and `<verification>` blocks are well-structured
- Context management section is genuinely useful

**BAD:**
- Build & Test section says `# Add your build command` instead of using the Makefile. The Makefile has `make build`, `make test`, `make lint` -- these should have been detected.
- Architecture diagram is the generic fallback (`Entry Point -> Core Logic -> Data Layer`). It should have detected cmd/server, internal/handlers, internal/repository, pkg/proto and built a proper Go microservice diagram.
- Directory structure section is completely empty -- the tool didn't detect cmd/, internal/, pkg/ directories (only checks a hardcoded list of web-app dirs like `src`, `lib`, `app`, `pages`, `components`).
- C++ section is noise that will confuse Claude in every session.
- No mention of `protoc` code generation workflow as a build step.
- No mention of Docker multi-stage build pattern (which the project uses).

### Generated Files Analysis

- **commands/test.md**: Generic "Run the project's test command." Should say `make test` or `go test -race -cover ./...`
- **commands/deploy.md**: Uses Docker deploy template which is reasonable, but doesn't mention K8s deployment which is the actual target.
- **hooks/on-edit-lint.sh**: Checks for `npx` and `ruff` but NOT for `golangci-lint` or `gofmt`. Useless for a Go project.
- **rules/backend.md**: Generic backend rules. Good but should mention Go-specific patterns (error wrapping with `%w`, context propagation).
- **settings.json**: Hook timeouts of 10 seconds are too short for `golangci-lint` on a real Go project (typically 30-60s).

### Verdict
> "The Go guidelines in CLAUDE.md are better than what most people would write from scratch. But the false C++ detection, missing Makefile commands, and generic architecture diagram hurt credibility. I'd use it as a starting point but would need to delete the C++ section, add my Makefile commands, and rewrite the architecture diagram. The hooks are JS/Python-centric and useless for Go. **Conditional keep -- only because manually fixing 5-6 things is faster than writing from scratch.**"

---

## Persona 2: OREN - DevOps/SRE Lead

**Project**: `infra` monorepo (Terraform, Kubernetes, Helm, AWS, GitHub Actions, Ansible)
**Structure**: terraform/modules/*, k8s/*, helm/*, scripts/*, Makefile

### Stack Detection Issues

**BUG: False C++ detection again.** Detected `Terraform, Kubernetes, C++`. There is no C++ in this project. Same false positive as Yoni.

**MISS: No Helm detection.** The project has `helm/charts/` with Chart.yaml and values.yaml, but Helm is not detected as a stack. The Terraform section does mention Helm conditionally.

**MISS: No AWS detection.** Terraform files reference AWS provider, S3 backend, RDS, VPC -- but AWS is not called out.

### CLAUDE.md Analysis

**GOOD:**
- Terraform guidelines are genuinely good: modules, plan before apply, remote state, variables.tf, tagging, provider locks, terraform fmt
- Mentions Helm chart conventions
- Constraint blocks prevent secrets commits

**BAD:**
- Architecture diagram is the generic fallback again. An infra monorepo should show: Terraform modules -> Environments (dev/staging/prod), K8s manifests -> Overlays, Helm charts -> Templates. None of this was detected.
- Directory structure only shows `scripts/ (1 files)`. Completely missed `terraform/`, `k8s/`, `helm/` because `detectMainDirs()` only checks a web-app-centric list (`src`, `lib`, `app`, `pages`, `components`, etc.).
- Build & Test is empty: `# Add your build command`. Should have detected the Makefile and shown `make plan ENV=dev`, `make lint`, `make validate`.
- C++ section is pure noise.
- No mention of state locking, drift detection, or plan/apply safety workflow.
- No mention of K8s kustomize overlays pattern (which the project uses).
- No mention of secret management (the project has `sensitive = true` variables).
- Verification section talks about "tests" and "linting" generically. For infra, verification means `terraform plan` shows expected changes, `helm lint` passes, `kubectl apply --dry-run` succeeds.

### Generated Files Analysis

- **commands/test.md**: Generic "Run the project's test command." Infra projects don't have traditional tests -- they have `terraform validate`, `terraform plan`, `helm lint`, `kubectl apply --dry-run`. This is useless as-is.
- **commands/deploy.md**: Generic deploy checklist with `git tag`. For infra, deploy means `terraform apply` with a plan review. Missing entirely.
- **hooks/on-edit-lint.sh**: Checks for npx/eslint/ruff. Should check for `terraform fmt`, `tflint`, `helm lint`. Completely wrong toolchain.
- **rules/tests.md**: "Follow Arrange-Act-Assert pattern." This is for application code, not Terraform modules. Infra testing means terratest, checkov, tfsec, or policy-as-code.
- **No rules/terraform.md created.** Despite detecting Terraform, no Terraform-specific rule file was generated (only tests.md was created).
- **settings.json**: protect-secrets.sh blocks `.env` files but doesn't block `.tfvars` files, which is where Terraform secrets live.

### Verdict
> "This tool was clearly built for web application projects. It has no understanding of infrastructure-as-code workflows. The Terraform guidelines in CLAUDE.md are decent boilerplate, but everything else -- the architecture diagram, the build commands, the hooks, the rules, the commands -- is web-app oriented and wrong for my use case. The protect-secrets hook doesn't block .tfvars. The lint hook doesn't know about terraform fmt. **Would NOT keep.** I would write a 30-line CLAUDE.md by hand in 10 minutes that would be 5x more useful than this."

---

## Persona 3: DANA - ML Engineer

**Project**: `ml-api` (Python, FastAPI, SQLAlchemy, Alembic, Celery, Redis, Docker, pytest)
**Structure**: src/api, src/models, src/services, src/tasks, migrations, requirements.txt, pyproject.toml

### Stack Detection

**GOOD: Correct detection.** `Python, FastAPI, Docker` -- all accurate, no false positives.

### CLAUDE.md Analysis

**GOOD:**
- FastAPI guidelines are appropriate: Pydantic models, dependency injection, thin handlers, async
- Python guidelines are solid: type hints, PEP 8, pathlib, dataclasses, specific exceptions
- Key Dependencies section correctly identified SQLAlchemy, Pydantic, pytest, Alembic, Celery, Redis from requirements.txt
- Build commands are correct: `python -m pytest`, `python -m mypy`, `ruff check`
- Verification section uses the right tools (`ruff check .`)
- Architecture diagram detected src/, tests/, src/api/, src/services/, src/models/

**BAD:**
- Architecture diagram is simplistic: `FastAPI -> src/ <- Tests`. Doesn't show the Celery worker, Redis queue, database layer, or the actual service architecture (API -> Services -> Repository -> DB, Tasks -> Celery -> Redis).
- No mention of async SQLAlchemy patterns (the project uses `postgresql+asyncpg`).
- No mention of Celery worker management or task monitoring.
- No mention of Alembic migration workflow in the build commands (should have `alembic upgrade head` as a setup step).
- No mention of `uvicorn` for running the dev server.
- Missing: model training/inference pipeline awareness (this is an ML project with scikit-learn, numpy, pandas, joblib -- none detected).
- The `src/tasks/` directory for Celery tasks is not reflected in the architecture.

### Generated Files Analysis

- **commands/migrate.md**: Correctly generated with Alembic commands. This is one of the best stack-specific detections in the tool.
- **commands/test.md**: Python-specific with `python -m pytest -v`. Good. Django fallback instruction is unnecessary noise for FastAPI.
- **rules/python.md**: Good Python-specific rules (type hints, PEP 8, f-strings, pathlib, `__main__` guard).
- **rules/backend.md**: Generic but applicable.
- **hooks/on-edit-lint.sh**: Checks for `ruff` as fallback after npx. Should check ruff FIRST for a Python project (npx check is irrelevant noise).

### Verdict
> "Best result of the panel so far. The Python/FastAPI detection is solid, the dependency scanning from requirements.txt actually works well, and the migrate command shows real awareness of the stack. But the architecture diagram undersells the project, and it completely missed the ML aspect -- no mention of model artifacts, training pipelines, or inference patterns. **Would keep and customize.** The baseline is 70% useful; I'd add the ML-specific sections, fix the architecture diagram, and adjust the lint hook order."

---

## Persona 4: SHAI - Cloud Architect (AWS CDK)

**Project**: `serverless-platform` (AWS CDK, Lambda, DynamoDB, S3, SQS, API Gateway, TypeScript)
**Structure**: lib/stacks, lib/constructs, lambda/handlers, cdk.json, tsconfig.json

### Stack Detection

**Detected: `Node.js, TypeScript`.** Misses the most important thing: this is an AWS CDK project. CDK is in the dependencies, cdk.json exists, but it's not called out as a detected stack. The CDK-specific guidelines DO appear in the Key Dependencies section, which partially redeems this.

### CLAUDE.md Analysis

**GOOD:**
- TypeScript guidelines are solid: interface vs type, strict mode, no any, as const
- TypeScript Configuration section correctly reads tsconfig.json and reports strict mode enabled
- Key Dependencies correctly detected AWS SDK v3, CDK, Lambda, Jest
- Build commands are correct from package.json: `npm run build`, `npm test`, `npm run lint`
- Verification section includes TypeScript check and build check
- Constraints include `@ts-ignore` and `var` rules

**BAD:**
- Architecture diagram: `Entry Point -> lib/ <- Tests`. This is absurdly simplistic for a CDK project. Should show: CDK App -> Stacks (ApiStack) -> Constructs (DynamoTable) -> Lambda handlers, with API Gateway, DynamoDB, S3, SQS as service nodes.
- Directory structure only shows `lib/ (2 files)` and `tests/`. Misses `lambda/` directory entirely because `lambda` is not in the hardcoded list of candidate directories.
- No mention of CDK-specific commands: `cdk synth`, `cdk diff`, `cdk deploy`, `cdk destroy`.
- No mention of Lambda cold start optimization, despite the Key Dependencies section mentioning it.
- No mention of IAM least privilege patterns.
- No mention of CDK snapshot testing (the standard testing pattern for CDK).
- Commands are generic, not CDK-aware. Deploy command should use `cdk deploy`, not generic Docker or git tag workflow.
- Missing `cdk diff` as a pre-deploy safety check.

### Generated Files Analysis

- **commands/deploy.md**: Generic deploy checklist. Should be `cdk diff`, review changes, `cdk deploy --all`. Currently suggests git-based deployment which is wrong for CDK.
- **commands/test.md**: Generic. Should mention `cdk synth` as a validation step and snapshot tests.
- **rules/frontend.md**: Created a FRONTEND rule file for a serverless backend project. This is because the tool sees Node.js/TypeScript and assumes frontend. Wrong.
- **hooks/on-edit-lint.sh**: Will try to run eslint, which is correct for TypeScript.
- **agents/security-reviewer.md**: Generic. Should include IAM policy review, Lambda execution role audit, API Gateway authorization checks.

### Verdict
> "The TypeScript fundamentals are correct and the dependency detection from package.json is genuinely useful. But this tool thinks my CDK project is a frontend web app. It created a frontend.md rule file, gave me a generic deploy command instead of `cdk deploy`, and the architecture diagram doesn't show a single AWS service. For a cloud architect, the architecture diagram is THE most important thing and it's completely wrong. **Conditional keep -- but only because the TS config and dependency sections save time. I'd need to rewrite the architecture, commands, and delete the frontend rule.**"

---

## Persona 5: DAFNA - Embedded/C++ Engineer

**Project**: `perception` (C++17, CMake, GTest, Bazel, Docker)
**Structure**: src/perception, src/planning, src/control, tests, CMakeLists.txt, .clang-format, .clang-tidy, conanfile.txt

### Stack Detection

**Detected: `C++` only.** Misses CMake (not a detected stack), Conan package manager, GTest, and the Bazel mention in the prompt (though no WORKSPACE file was created).

### CLAUDE.md Analysis

**GOOD:**
- C++ guidelines mention: clang-format, smart pointers, clang-tidy, const references, CMake targets
- Basic structure is clean and not overly long

**BAD:**
- Architecture diagram: `Entry Point -> src/ <- Tests`. For a perception system with three subsystems (perception, planning, control) that form a clear pipeline, this is meaningless. Should show: Camera Input -> Perception (detector, tracker) -> Planning (planner) -> Control (controller) -> Actuator Output.
- Directory structure shows `src/ (3 files)` and `tests/ (2 files)` but doesn't show the subsystem directories (src/perception, src/planning, src/control).
- Build & Test section is EMPTY: `# Add your build command`. There is a CMakeLists.txt with explicit build targets, test configuration, and library definitions. Should show `cmake -B build && cmake --build build` and `ctest --test-dir build`.
- No mention of Conan package manager (conanfile.txt exists).
- No mention of compile_commands.json for IDE/tool integration.
- No mention of .clang-format and .clang-tidy integration (these files exist!).
- No mention of Eigen or OpenCV (found in CMakeLists.txt).
- "Keep functions small and focused (< 50 lines)" -- in C++ embedded/perception code, this is not always practical for tight inner loops. Generic advice.
- The C++ guidelines say "check .clang-format if present" -- it IS present. Should say "Follow .clang-format (Google style, IndentWidth: 2, ColumnLimit: 100)".

### Generated Files Analysis

- **commands/test.md**: Generic "Run the project's test command." Should say `ctest --test-dir build` or `cmake --build build --target perception_tests && ./build/perception_tests`.
- **commands/deploy.md**: Generic deploy checklist. C++ embedded systems don't deploy like web apps. Should be a build-and-flash or package command.
- **hooks/on-edit-lint.sh**: Checks for npx and ruff. Should run `clang-format` and `clang-tidy`. Completely wrong toolchain.
- **rules/tests.md**: "Follow Arrange-Act-Assert pattern." GTest uses EXPECT/ASSERT macros with TEST() fixtures. The naming convention suggestion `test_should_X_when_Y` is Python-style, not GTest style (which uses `TEST(SuiteName, TestName)`).
- **No CMake-specific rules or commands generated.**
- **settings.json**: lint hook timeout of 10 seconds is too short for clang-tidy on a real C++ project (can take minutes).

### Verdict
> "This tool has zero understanding of C++ build systems. It can't read CMakeLists.txt, doesn't know about Conan, doesn't detect .clang-format/.clang-tidy, and the hooks try to run JavaScript linters on C++ code. The C++ section in CLAUDE.md has correct but surface-level advice that any LLM would know already. The architecture diagram for a perception pipeline should be the most informative part and it shows nothing. **Would NOT keep.** Writing a proper CLAUDE.md with CMake commands and clang-format references would take 15 minutes and be vastly superior."

---

## Persona 6: EYAL - Security Engineer

**Project**: `auth-service` (Node.js, Express, Helmet, JWT, bcrypt, CORS, rate-limit, PostgreSQL)
**Structure**: src/middleware, src/auth, src/validators, src/routes, package.json with 10+ security deps

### Stack Detection

**Detected: `Node.js, Docker`.** Doesn't explicitly call out Express, but the dependency scanning catches all the security middleware.

### CLAUDE.md Analysis

**GOOD:**
- **Security Best Practices section is generated.** This is the standout feature for this project. It includes OWASP Top 10, no logging sensitive data, parameterized queries, Helmet headers, rate limiting, input validation.
- Key Dependencies section is excellent: correctly detected and documented Helmet, JWT, bcrypt, CORS, rate-limit, HPP -- all with actionable guidance.
- Build commands correctly extracted from package.json.
- JavaScript guidelines are appropriate.
- The Security section recommends `/security-review` which is genuinely useful.

**BAD:**
- Architecture diagram: `Entry Point -> src/ <- Tests`. Should show: Request -> Rate Limiter -> Helmet -> CORS -> HPP -> Auth Middleware (JWT verify) -> Routes -> Validators -> Handlers -> PostgreSQL. The middleware chain is THE architecture for this project.
- Directory structure shows `src/ (5 files)` and `src/middleware/ (1 files)` but misses src/auth, src/validators, src/routes.
- No mention of `express-validator` specifically (it's in the deps but not in the Key Dependencies output).
- No mention of token refresh flow, session management, or password reset patterns.
- No mention of CORS origin whitelist configuration (just generic "restrict origins").
- The protect-secrets.sh hook blocks `.env` files but doesn't block `*.key` or JWT secret files specifically -- wait, it does block `.pem` and `.key` files. Good.
- Missing: no mention of SQL injection prevention for the `pg` library specifically (parameterized queries).
- The constraints section doesn't mention security-specific rules like "always use prepared statements" or "never trust client input."

### Generated Files Analysis

- **commands/deploy.md**: Docker-based deploy checklist. Reasonable but should include security-specific pre-deploy checks (dependency audit, `npm audit`, secret rotation check).
- **agents/security-reviewer.md**: Generic security review. Should be tailored to this project's security stack (Helmet config, JWT algorithm verification, bcrypt rounds, rate limit thresholds, CORS origins).
- **rules/tests.md**: No rules/security.md was created despite detecting a security-heavy project. Should have rules for auth endpoints, input validation testing, and security header testing.
- **No backend.md rule was created** despite this being a pure backend project. The tool only creates backend.md when... it's unclear why it was created for Yoni/Dana but not Eyal.

### Verdict
> "Best result overall. The Security Best Practices section and the dependency-aware Key Dependencies section are genuinely more useful than what I'd write in a first pass. The protect-secrets.sh hook is actually valuable for an auth service. But the architecture diagram is useless -- for a security engineer, seeing the middleware chain is critical for understanding the security posture. I'd also want a security.md rule file. **Would keep.** The security awareness alone justifies it. I'd add 20 lines of customization and it would be production-ready."

---

## Cross-Cutting Issues Found by All 6 Panelists

### 1. Architecture Diagram Generator is Web-App Biased (All 6 affected)

The `detectMainDirs()` function only checks a hardcoded list: `src, lib, app, pages, components, api, routes, utils, helpers, services, models, controllers, views, public, assets, config, tests, test, __tests__, spec, scripts, prisma, db, middleware, hooks`. This misses:

- `cmd/`, `internal/`, `pkg/` (Go projects)
- `terraform/`, `k8s/`, `helm/` (IaC projects)
- `lambda/`, `stacks/`, `constructs/` (CDK projects)
- Subdirectories of `src/` beyond the web-app ones (e.g., `src/perception`, `src/planning`)

The Mermaid diagram falls back to a generic 5-node diagram for 4 of 6 projects.

### 2. Build Command Detection Misses Non-JS Build Systems (3 of 6 affected)

`detectScripts()` only reads `package.json`. Projects using Makefile, CMakeLists.txt, or pyproject.toml for build configuration get empty build sections. Yoni's Makefile, Dafna's CMakeLists.txt, and Oren's Makefile were all ignored.

### 3. Lint Hook is JS/Python Only (4 of 6 affected)

`on-edit-lint.sh` checks for `npx`/eslint then `ruff`. Missing: `golangci-lint`/`gofmt` (Go), `clang-format`/`clang-tidy` (C++), `terraform fmt`/`tflint` (Terraform), `helm lint` (Helm).

### 4. False C++ Detection (2 of 6 affected)

Yoni's pure Go project and Oren's pure Terraform project both got C++ detected. The C++ guidelines section was injected into their CLAUDE.md files as noise.

**Root cause found**: In `techniques.js` line 958, the C++ stack detection is:
```js
cpp: { files: ['CMakeLists.txt', 'Makefile', '.clang-format'], content: {}, label: 'C++' }
```
Any project with a `Makefile` triggers C++ detection. This is wrong -- Makefiles are used by Go, Python, Terraform, Ruby, and many other ecosystems. The fix should require `CMakeLists.txt` OR (`.clang-format` AND at least one `.cpp`/`.h` file), and remove `Makefile` from the C++ detection list.

### 5. protect-secrets.sh Misses IaC Secrets (1 of 6 affected)

The hook blocks `.env`, `.pem`, `.key`, `secrets/`, `credentials` -- but not `.tfvars` files (where Terraform secrets live) or `values-secret.yaml` (Helm secret values).

### 6. Generic Commands for Specialized Workflows (All 6 affected)

The `/deploy` command should use stack-specific deployment:
- Go/K8s: `kubectl apply` or `helm upgrade`
- Terraform: `terraform apply`
- CDK: `cdk deploy`
- C++: build/package command
Instead, 4 of 6 got a generic "Run deployment command" template.

### 7. rules/ Files Inconsistency

- Yoni (Go) got backend.md + tests.md
- Oren (Terraform) got only tests.md (no terraform.md)
- Dana (Python/FastAPI) got backend.md + python.md + tests.md (best)
- Shai (CDK/TS) got frontend.md + tests.md (frontend.md is WRONG)
- Dafna (C++) got only tests.md (no cpp.md or cmake.md)
- Eyal (Security/Node) got only tests.md (no backend.md, no security.md)

### 8. Identical Boilerplate Across All Projects

These files are byte-for-byte identical across all 6 projects:
- `agents/security-reviewer.md`
- `commands/fix.md`
- `commands/review.md`
- `skills/fix-issue/SKILL.md`
- `hooks/log-changes.sh`
- `hooks/protect-secrets.sh`

While some standardization is fine, the security reviewer agent should differ for a Terraform project vs an auth service.

---

## Recommendations (Priority Order)

### P0 - Fix Before Next Release
1. **Fix false C++ detection** -- investigate what triggers it for Go/Terraform projects
2. **Add Makefile/CMake build command detection** -- parse Makefile targets and CMakeLists.txt
3. **Stack-specific lint hooks** -- generate the right linter for the detected stack

### P1 - High Impact
4. **Expand `detectMainDirs()` list** -- add `cmd/`, `internal/`, `pkg/`, `terraform/`, `k8s/`, `helm/`, `lambda/`, `stacks/`, `constructs/`
5. **Stack-specific deploy commands** -- CDK deploy, terraform apply, helm upgrade, kubectl apply
6. **Stack-specific rules files** -- terraform.md, cpp.md, security.md based on detected stack
7. **Don't create frontend.md for non-frontend projects** -- CDK/Lambda is not frontend

### P2 - Would Differentiate
8. **Read CMakeLists.txt** -- extract targets, dependencies, C++ standard version
9. **Read Makefile** -- extract targets for build/test/lint
10. **Read .clang-format/.clang-tidy** -- reference actual config in CLAUDE.md
11. **Detect security-heavy projects** -- create security.md rule and enhanced security-reviewer agent
12. **Add .tfvars to protect-secrets.sh** when Terraform is detected
13. **ML project awareness** -- detect scikit-learn, torch, tensorflow and add model lifecycle guidelines

---

## Final Panel Score

| Aspect | Score (1-10) | Notes |
|--------|-------------|-------|
| Stack detection accuracy | 5/10 | Good for JS/Python, false positives for C++, misses infrastructure stacks |
| CLAUDE.md quality | 6/10 | Good framework guidelines, weak architecture diagrams and build commands |
| Commands usefulness | 4/10 | Too generic for non-JS stacks; /migrate (Python) is a bright spot |
| Rules relevance | 5/10 | Backend/tests/python rules good; frontend.md for CDK is wrong; missing stack-specific rules |
| Hooks effectiveness | 3/10 | JS/Python lint only; protect-secrets is universally good; wrong toolchain for Go/C++/Terraform |
| Agents quality | 3/10 | Identical across all projects; should be specialized |
| Settings.json | 6/10 | Hook registration works; missing permissions.deny rules |
| Overall value-add | 5.5/10 | Genuine time-saver for JS/Python web apps; counterproductive for infra/C++/specialized backends |

**Bottom line**: nerviq-cli is a solid tool for **JavaScript/TypeScript and Python web application projects**. For backend infrastructure (Terraform, K8s, Helm), systems programming (C++, Go with complex build systems), and specialized domains (ML pipelines, security services), it produces generic or incorrect output that experienced engineers would need to substantially rewrite. The dependency scanning from package.json and requirements.txt is the strongest feature. The architecture diagram generator and hook system are the weakest, being almost entirely web-app-centric.

---

*Review conducted 2026-03-31 using nerviq-cli v1.6.0 against 6 realistic project directories.*
