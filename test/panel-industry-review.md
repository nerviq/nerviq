# Industry Panel Review: Personas 25-30

**Date**: 2026-03-31
**Tool version**: nerviq-cli v1.6.0
**Methodology**: Created realistic project for each industry, ran audit + setup, read every generated file, evaluated domain understanding.

---

## Summary Table

| # | Persona | Industry | Stack | Pre-Audit | Post-Setup | Industry Understanding | Verdict |
|---|---------|----------|-------|-----------|------------|----------------------|---------|
| 25 | NOAM | Fintech | Node+TS+Stripe+PG | 13/100 | 66/100 | **Partial** - Security yes, PCI-DSS no | Would customize heavily |
| 26 | RUTH | HealthTech | Python+FastAPI+HIPAA | 12/100 | 63/100 | **Minimal** - Zero HIPAA awareness | Would not use as-is |
| 27 | KOBI | Gaming | Node+TS+WebSocket+Redis | 13/100 | 64/100 | **None** - No real-time patterns | Would not use as-is |
| 28 | EFRAT | EdTech | Next.js+Prisma+tRPC+Clerk | 14/100 | 63/100 | **Good** - Best result of the group | Would use + customize |
| 29 | ILAN | IoT/Edge | Python+MQTT+InfluxDB | 12/100 | 63/100 | **None** - Zero IoT awareness | Would not use as-is |
| 30 | HADAS | Data Eng | Python+Airflow+dbt+Spark | 11/100 | 61/100 | **None** - Zero pipeline awareness | Would not use as-is |

---

## Persona 25: NOAM - Fintech CTO

### Project: payment-processor
**Stack detected**: Node.js, TypeScript (correct but incomplete -- missed Stripe, PostgreSQL, Redis, Express)

### What the tool got RIGHT
1. **Security Best Practices section** -- Detected `helmet`, `jsonwebtoken`, `bcrypt` and generated OWASP Top 10 guidance, parameterized queries warning, rate limiting, PII logging prohibition
2. **Stripe webhook verification** -- `stripe.webhooks.constructEvent()` mentioned in Key Dependencies
3. **JWT + bcrypt guidance** -- Correct "never store plaintext passwords", verify tokens with correct algorithm
4. **express-rate-limit + HPP** -- Detected and documented both security middleware
5. **protect-secrets.sh hook** -- Blocks `.env`, `.pem`, `.key` files automatically
6. **Zod validation at boundaries** -- Good advice for payment processing input validation

### What the tool MISSED (Critical for Fintech)
1. **Zero PCI-DSS awareness** -- No mention of PCI compliance, cardholder data environment (CDE), SAQ levels, or card data handling rules. For a payment processor, this is THE number one concern.
2. **No audit trail guidance** -- The project has an AuditLog model in Prisma, but CLAUDE.md says nothing about maintaining audit trails, immutable logs, or regulatory retention requirements.
3. **No encryption-at-rest** -- No guidance on encrypting sensitive fields (card tokens, PII) before database storage. The project has `crypto-js` dep but tool ignores it.
4. **No PAN/card data rules** -- Should explicitly state: never log card numbers, mask PAN to last 4, never store CVV.
5. **No idempotency guidance** -- Payment processing requires idempotency keys. Zero mention.
6. **Webhook signature verification is mentioned but shallow** -- Should warn about replay attacks, timestamp validation, webhook endpoint security.
7. **No transaction isolation level guidance** -- Financial transactions need explicit isolation levels (SERIALIZABLE for balance operations).
8. **Mermaid diagram is generic** -- Shows "Entry Point -> src/ -> Data Layer" instead of the actual payment flow (API -> Validation -> Stripe -> DB -> Audit).
9. **Generated `frontend.md` rule instead of `backend.md`** -- The project is a pure backend Node.js API server, but got a frontend.md rule because it has TypeScript. BUG: the tool classifies TS+Node as frontend.
10. **No Redis caching/queue guidance** -- `ioredis` is in deps but not in Key Dependencies.

### Score Breakdown
- Pre-audit: 13/100 (detected Node.js + TypeScript stacks, .gitignore had .env and node_modules)
- Post-setup: 66/100 (standard scaffolding boosted score)
- Organic value for fintech: ~25/100

### Verdict
> "The tool gives me a solid TypeScript boilerplate CLAUDE.md. The security section is a nice touch -- it shows the tool reads package.json deeply. But for a payment processor? I need PCI-DSS rules baked in. I need audit logging requirements. I need idempotency patterns. If I used this, I would immediately rewrite 60% of the CLAUDE.md to add financial compliance rules. The tool saved me maybe 20 minutes of initial setup, but I would spend 2 hours adding what it missed."

### Top 3 Improvements
1. Add fintech/payments domain detection (Stripe, payment keywords) with PCI-DSS compliance rules
2. Detect `AuditLog` / `audit` patterns in code and generate audit trail requirements
3. Add idempotency and transaction isolation guidance when Stripe or payment deps are found

---

## Persona 26: RUTH - HealthTech Lead

### Project: patient-portal
**Stack detected**: Python, FastAPI, Docker (correct)

### What the tool got RIGHT
1. **FastAPI best practices** -- Pydantic models, dependency injection, async endpoints, thin handlers
2. **SQLAlchemy + Alembic** -- Correctly detected both and generated migration guidance
3. **Celery + Redis** -- Detected and documented for background tasks
4. **Python best practices** -- Type hints, PEP 8, pathlib, f-strings
5. **Migrate command** -- Generated `/migrate` slash command with Alembic-specific steps
6. **Backend + Python rules** -- Got both `.claude/rules/backend.md` and `python.md`

### What the tool MISSED (Critical for HealthTech)
1. **ZERO HIPAA awareness** -- The project description says "HIPAA-compliant" in pyproject.toml. The tool completely ignores this. No mention of HIPAA, PHI (Protected Health Information), BAA, or minimum necessary principle.
2. **No PHI data handling rules** -- Should explicitly state: never log patient names/SSN/medical records, encrypt PHI at rest and in transit, access logging for all PHI reads.
3. **No de-identification guidance** -- When working with patient data for analytics, HIPAA requires de-identification (Safe Harbor or Expert Determination). Zero mention.
4. **No encrypted storage rules** -- The project has `cryptography` in requirements.txt but tool does not detect it or generate encryption guidance.
5. **No access control / RBAC** -- Healthcare requires strict role-based access (doctor vs nurse vs admin vs patient). No mention.
6. **No audit trail for PHI access** -- HIPAA requires logging every access to patient records. Different from generic "audit logging."
7. **No data retention rules** -- HIPAA has specific retention requirements. No mention.
8. **No BAA (Business Associate Agreement) awareness** -- When using cloud services (boto3 is in deps), HIPAA requires BAAs.
9. **Mermaid diagram is poor** -- Shows only "FastAPI -> src/ -> Tests" -- does not show routes, middleware, or database layers that ARE in the project structure.
10. **No `boto3` guidance** -- boto3 is in requirements.txt but not detected. Should mention S3 encryption requirements for PHI.

### Score Breakdown
- Pre-audit: 12/100
- Post-setup: 63/100
- Organic value for healthtech: ~15/100

### Verdict
> "This is dangerous for a healthtech company. Someone might think their Claude Code setup is 'good enough' at 63/100 and start coding. But there is literally zero HIPAA guidance. If Claude generates code that logs patient SSNs or stores medical records unencrypted, we have a federal compliance violation. The tool needs a HIPAA detection layer that triggers when it sees healthcare-related deps or keywords."

### Top 3 Improvements
1. Add HIPAA/healthcare domain detection (keywords: patient, medical, health, PHI, HIPAA in project files) with compliance rules
2. Detect `cryptography` / `boto3` deps and generate encryption-at-rest + BAA guidance
3. Add PHI access logging rules and data retention policies

---

## Persona 27: KOBI - Gaming Backend (ex-Playtika)

### Project: game-server
**Stack detected**: Node.js, TypeScript (correct but missed ws, socket.io, Redis pub/sub)

### What the tool got RIGHT
1. **TypeScript strict mode** -- Detected and documented
2. **Zod validation** -- Good for validating game protocol messages
3. **Jest testing** -- Correctly identified
4. **Build/test/lint commands** -- All correctly extracted from package.json
5. **General code quality** -- Constraints and verification steps are solid

### What the tool MISSED (Critical for Gaming)
1. **Zero WebSocket/real-time awareness** -- `ws` and `socket.io` are in deps but completely ignored. No guidance on connection lifecycle, reconnection handling, heartbeats, or binary protocols.
2. **No room/state management patterns** -- The project has a `rooms/` directory with room-manager. The tool should detect this and add state synchronization guidance.
3. **No Redis pub/sub guidance** -- `ioredis` is detected for nothing. In a game server, Redis pub/sub is the backbone for cross-instance communication. Zero mention.
4. **No game loop / tick rate guidance** -- Real-time games need consistent update cycles. No mention.
5. **No msgpack/binary protocol** -- `msgpack-lite` is in deps but ignored. Should generate guidance about binary serialization vs JSON for performance.
6. **No matchmaking patterns** -- The project has a `matchmaking/` directory. No guidance on ELO, MMR, queue management.
7. **No concurrency/race condition warnings** -- Game servers have heavy concurrency. Should warn about race conditions in room state.
8. **No connection pooling guidance** -- Multiple socket connections need careful management.
9. **Mermaid diagram generic** -- Should show: Client -> WebSocket -> Room Manager -> Game State -> Redis Pub/Sub flow.
10. **Generated `frontend.md` rule for a BACKEND game server** -- Same bug as Noam. TypeScript = frontend rule. Wrong.
11. **No latency/performance guidance** -- Game servers are latency-sensitive. Should mention avoiding synchronous operations, using binary protocols, connection pooling.
12. **`eventemitter3` ignored** -- Event-driven architecture pattern not recognized.

### Score Breakdown
- Pre-audit: 13/100
- Post-setup: 64/100
- Organic value for gaming: ~10/100

### Verdict
> "The tool thinks my game server is a generic TypeScript CRUD app. It has zero understanding of real-time systems. WebSocket is the core of my entire architecture and it is not mentioned once. If I showed this CLAUDE.md to my team, they would laugh. The Mermaid diagram is 'Entry Point -> src/' -- that tells Claude nothing about how our game server actually works. Redis pub/sub, rooms, matchmaking, tick rates -- all invisible. I would throw away the generated CLAUDE.md and write my own."

### Top 3 Improvements
1. Detect `ws`/`socket.io`/WebSocket deps and generate real-time system guidelines (connection lifecycle, heartbeats, reconnection, binary protocols)
2. Detect `ioredis`/Redis deps and generate pub/sub + caching patterns (not just "Redis is available")
3. Detect game-specific directories (rooms/, matchmaking/, events/) and generate state management + concurrency guidance

---

## Persona 28: EFRAT - EdTech Engineer

### Project: learning-platform
**Stack detected**: React, Next.js, Node.js, TypeScript (correct and comprehensive)

### What the tool got RIGHT
1. **Excellent Next.js App Router guidance** -- Server Components default, `use client` only when needed, Server Actions, route handlers, middleware
2. **Complete dependency detection** -- TanStack Query, Zod, Prisma, Clerk, Zustand, Tailwind, Vitest, Testing Library, tRPC, Stripe, Resend -- ALL detected and documented correctly
3. **Practical guidelines** -- "Define query keys as constants", "Use .parse() at API boundaries", "Define templates as React components" (for Resend)
4. **Stack-specific commands** -- `/check-build` for Next.js build verification, `/deploy` with Vercel awareness
5. **TypeScript strict mode** -- Detected and documented
6. **Good directory structure detection** -- src/app, src/components, src/lib, src/hooks, src/utils all mapped

### What the tool MISSED (Important for EdTech)
1. **BUG: `undefined` in Mermaid diagram** -- The generated diagram contains literal `undefined` nodes:
   ```
   undefined --> F
   H -.-> undefined
   ```
   This is a code bug in `generateMermaid()` where `ids['src/']` or `ids['Entry Point']` resolves to undefined when a different entry point (Next.js) is used.
2. **No EdTech domain awareness** -- No mention of courses, quizzes, student progress, learning paths, content management, or educational patterns.
3. **No multi-tenant / organization guidance** -- EdTech SaaS typically has organizations (schools/districts). No mention.
4. **No content versioning guidance** -- Course content needs version control. No mention.
5. **No accessibility (a11y) guidance** -- EdTech platforms must be accessible (WCAG compliance, especially for educational institutions receiving federal funding). Zero mention.
6. **No `uploadthing` guidance** -- In deps but not detected. File upload for course materials is critical.
7. **No `@mux/mux-player-react` guidance** -- Video streaming for courses not detected.
8. **No ISR/SSG guidance for course pages** -- EdTech benefits heavily from static generation for course content.

### Score Breakdown
- Pre-audit: 14/100 (highest pre-audit -- Next.js has extra detection: next.config.js, tailwind.config.js)
- Post-setup: 63/100
- Organic value for EdTech: ~40/100 (best of the group because of strong Next.js + dependency detection)

### Verdict
> "This is the closest to something I would actually keep. The dependency detection is impressive -- it found all 14 of my main dependencies and gave practical guidance for each. The Next.js App Router section is genuinely useful. BUT: the Mermaid diagram has a literal `undefined` bug which is embarrassing. And there is zero awareness that this is an educational platform. If I were building a generic Next.js SaaS, this would be 7/10. For EdTech specifically, 5/10."

### Top 3 Improvements
1. **FIX BUG**: `undefined` nodes in Mermaid diagram when framework entry point does not match fallback variable names
2. Add domain detection for EdTech (courses, quizzes, learning, student, progress keywords) with accessibility and content management guidance
3. Detect video/upload deps (`uploadthing`, `mux`, `cloudinary`) and generate media handling guidelines

---

## Persona 29: ILAN - IoT/Edge Engineer

### Project: iot-gateway
**Stack detected**: Python, Docker (correct but missed MQTT, InfluxDB, sensor stack)

### What the tool got RIGHT
1. **Python best practices** -- Type hints, PEP 8, pathlib
2. **Pydantic detection** -- Good for sensor data validation
3. **pytest detection** -- Correct
4. **Docker detection** -- Saw the Dockerfile
5. **Backend rule** -- Appropriate for an IoT gateway

### What the tool MISSED (Critical for IoT)
1. **Zero MQTT awareness** -- `paho-mqtt` is the core dependency. Not detected, not mentioned. No guidance on topics, QoS levels, retained messages, last will and testament, or broker connection management.
2. **Zero InfluxDB/time-series awareness** -- `influxdb-client` is in requirements.txt but not detected. No guidance on time-series data modeling, retention policies, continuous queries, or Flux query language.
3. **No sensor data pipeline patterns** -- The project has `collectors/`, `processors/`, `publishers/` directories. This is a classic ETL pipeline for sensor data. The tool maps it as generic "src/".
4. **No edge computing guidance** -- No mention of resource constraints, memory management, offline operation, or data buffering for intermittent connectivity.
5. **No prometheus-client guidance** -- In requirements.txt but ignored. Should mention metrics collection and Grafana dashboards.
6. **No docker-compose detection inside subdirectory** -- The docker-compose.yml is in `docker/` directory, not root. Tool only checks root level.
7. **Mermaid diagram useless** -- Shows "Entry Point -> src/ -> Tests". Should show: Sensors -> MQTT Broker -> Collector -> Processor -> InfluxDB -> Grafana.
8. **No GPIO/hardware interaction warnings** -- `RPi.GPIO` was in the original requirements (I simplified it). Should warn about hardware access patterns, mock GPIO for testing.
9. **No data buffering/offline patterns** -- Edge devices lose connectivity. Need local buffering guidance.
10. **`redis` detected but guidance is generic** -- "Redis is available for caching and task queues." In IoT, Redis is used for real-time data caching, device state, and pub/sub for live dashboards.

### Score Breakdown
- Pre-audit: 12/100
- Post-setup: 63/100
- Organic value for IoT: ~8/100

### Verdict
> "The tool has absolutely no idea what an IoT gateway is. It treated my project as a generic Python web application. MQTT is the backbone of IoT -- it is like having a web framework that does not know what HTTP is. The Mermaid diagram tells Claude nothing about sensor -> broker -> processor -> storage flow. The directory structure (collectors/processors/publishers) screams 'data pipeline' and the tool did not notice. I would write my own CLAUDE.md from scratch."

### Top 3 Improvements
1. Detect MQTT/IoT deps (`paho-mqtt`, `influxdb`, `grafana`, `prometheus`) and generate IoT-specific guidelines (QoS, topics, retention, buffering)
2. Detect pipeline directory patterns (collectors/, processors/, publishers/, ingest/) and generate data flow architecture in Mermaid
3. Add edge computing guidance when Docker + sensor/MQTT deps detected (resource constraints, offline operation, data buffering)

---

## Persona 30: HADAS - Data Engineer

### Project: data-pipeline
**Stack detected**: Python (correct but catastrophically incomplete -- missed Airflow, dbt, Spark, Snowflake, Great Expectations)

### What the tool got RIGHT
1. **Python best practices** -- Type hints, PEP 8
2. **pytest detection** -- Correct
3. **models/ directory detected** -- Listed in directory structure
4. **Backend rule** -- Appropriate

### What the tool MISSED (Critical for Data Engineering)
1. **Zero Airflow awareness** -- `apache-airflow` is in requirements.txt but not detected. No DAG authoring guidance, no Airflow best practices, no task dependency patterns, no XCom usage, no connection management.
2. **Zero dbt awareness** -- `dbt-core` and `dbt-snowflake` are in requirements.txt but ignored. No model naming conventions (stg_, fct_, dim_), no ref() usage, no source() patterns, no test patterns (unique, not_null, relationships).
3. **Zero PySpark awareness** -- `pyspark` ignored. No DataFrame API guidance, no UDF warnings, no partitioning advice.
4. **Zero Snowflake awareness** -- `snowflake-connector-python` ignored. No warehouse management, no query optimization, no COPY INTO patterns.
5. **Zero Great Expectations awareness** -- `great-expectations` ignored. No data quality testing guidance.
6. **dags/ directory not recognized** -- The tool scans for `src/`, `lib/`, `app/` etc. but `dags/` is THE standard Airflow directory. Not detected.
7. **macros/ directory not recognized** -- Standard dbt directory. Ignored.
8. **models/ misinterpreted** -- The tool detected `models/` and created a generic "Data Layer" in Mermaid. In reality, these are dbt SQL models (staging + marts), not Python ORM models.
9. **No SQL style guidance** -- `sqlfluff` is in requirements.txt but not detected. Should generate SQL formatting rules (Snowflake dialect, CTEs, naming).
10. **No data quality / testing guidance specific to pipelines** -- Generic "write tests" is meaningless for data engineering. Should say: test row counts, check for nulls in required fields, validate referential integrity, use Great Expectations suites.
11. **Mermaid diagram misleading** -- Shows "Entry Point -> Data Layer -> Database". Should show: Airflow DAG -> Extract -> dbt Transform -> Great Expectations Validate -> Snowflake Load.
12. **Build commands are wrong** -- Generated `python -m mypy .` and `ruff check .` which are fine but missed the REAL commands: `dbt run`, `dbt test`, `airflow dags test`, `sqlfluff lint`.

### Score Breakdown
- Pre-audit: 11/100 (lowest -- only detected Python stack)
- Post-setup: 61/100 (lowest post-setup too)
- Organic value for data engineering: ~5/100

### Verdict
> "This is the worst result of all six reviews. My entire stack is invisible to the tool. Airflow, dbt, PySpark, Snowflake, Great Expectations -- FIVE major frameworks, all undetected. The generated CLAUDE.md tells Claude to use 'pathlib over os.path' and 'f-strings for formatting' -- these are Python 101 tips that are irrelevant to a data engineer writing SQL models and DAG definitions. The Mermaid diagram says 'Data Layer -> Database' when my actual architecture is a sophisticated ETL pipeline with orchestration, transformation, validation, and loading stages. I would never use this output."

### Top 3 Improvements
1. Add data engineering stack detection (airflow, dbt, spark, snowflake, great-expectations, sqlfluff) with pipeline-specific guidance
2. Detect `dags/`, `models/staging/`, `models/marts/`, `macros/` directories and generate dbt/Airflow architecture diagram
3. Add SQL style + data quality testing guidance when sqlfluff/great-expectations detected

---

## Cross-Persona Analysis

### BUG REPORT: Mermaid `undefined` Nodes
In Efrat's learning-platform, the generated Mermaid diagram contains:
```
undefined --> F
H -.-> undefined
```
**Root cause**: In `setup.js:generateMermaid()`, lines like `const parent = ids['src/'] || ids['Entry Point'];` resolve to `undefined` when the entry point is "Next.js" (not "Entry Point") and `src/` node was never created (because App Router was detected instead).

**Fix needed**: Add fallback to use the root variable (`root`) instead of hardcoded keys.

### BUG REPORT: Frontend Rule for Backend Projects
Both Noam (payment-processor) and Kobi (game-server) received `.claude/rules/frontend.md` despite being pure backend Node.js + TypeScript projects. The rule generation logic at line 925 of setup.js:
```js
if (hasFrontend || (hasTS && !hasBackend)) {
```
The `!hasBackend` check fails because Node.js is not in the backend list (`['go', 'python', 'django', 'fastapi', 'rust', 'java']`). Node.js backend projects with TypeScript incorrectly get frontend rules.

**Fix needed**: Add `'node'` to the backend detection list, or check for Express/Fastify/Koa deps.

### Pattern: Generic Output Regardless of Industry
All six projects received virtually identical scaffolding:
- Same hooks (on-edit-lint.sh, protect-secrets.sh, log-changes.sh)
- Same agent (security-reviewer.md)
- Same skill (fix-issue)
- Same commands (test, review, deploy, fix) with minor stack variations
- Same CLAUDE.md structure

The only meaningful variations came from:
1. Detected dependencies (Noam's security deps, Efrat's 14 deps)
2. Stack-specific framework sections (Next.js App Router, FastAPI, TypeScript)
3. Commands: Ruth got `/migrate`, Efrat got `/check-build`

### Dependency Detection Quality
| Persona | Deps in project | Deps detected | Detection rate |
|---------|----------------|---------------|----------------|
| NOAM | 14 | 10 | 71% |
| RUTH | 10 | 6 | 60% |
| KOBI | 10 | 3 | 30% |
| EFRAT | 14 | 14 | 100% |
| ILAN | 7 | 3 | 43% |
| HADAS | 8 | 1 | 13% |

Efrat's project had the best detection because it uses mainstream web deps that the tool was designed for. Niche industry deps (MQTT, InfluxDB, Airflow, dbt, PySpark, socket.io, ws) are completely invisible.

### The Fundamental Gap: Domain vs. Stack
The tool understands STACKS (React, Next.js, Python, TypeScript) well. It does NOT understand DOMAINS (fintech, healthtech, gaming, IoT, data engineering). This means:
- A payment processor gets the same output as a blog
- A HIPAA-compliant patient portal gets the same output as a TODO app
- A real-time game server gets the same output as a REST API
- An IoT gateway gets the same output as a Flask web app
- A data pipeline gets the same output as a Python script

---

## Overall Scores

| Metric | NOAM | RUTH | KOBI | EFRAT | ILAN | HADAS |
|--------|------|------|------|-------|------|-------|
| Pre-audit | 13 | 12 | 13 | 14 | 12 | 11 |
| Post-setup | 66 | 63 | 64 | 63 | 63 | 61 |
| Domain understanding | 3/10 | 1/10 | 1/10 | 6/10 | 1/10 | 0/10 |
| Would use permanently? | Customize heavily | No | No | Yes, customize | No | No |
| Time saved estimate | 20 min | 10 min | 5 min | 30 min | 5 min | 0 min |

## Top 10 Improvements (Prioritized)

1. **FIX BUG: Mermaid `undefined` nodes** -- Broken diagram in Next.js projects
2. **FIX BUG: Frontend rule for backend Node.js** -- TS+Node incorrectly classified
3. **Add domain detection layer** -- Scan project description, deps, and directory names for industry keywords (payments, health/patient, game/multiplayer, IoT/sensor, data/pipeline/dbt/airflow)
4. **Expand requirements.txt scanning** -- Currently detects ~15 Python deps. Should detect: paho-mqtt, influxdb, airflow, dbt-core, pyspark, great-expectations, snowflake, cryptography, boto3
5. **Expand package.json scanning** -- Should detect: ws, socket.io, ioredis (for pub/sub context), eventemitter3, msgpack, uploadthing, mux
6. **Add compliance detection** -- When HIPAA/PCI/SOC2/GDPR keywords found in project files, generate compliance-specific rules
7. **Improve Mermaid generation for non-standard directories** -- Detect dags/, collectors/, processors/, rooms/, matchmaking/ and generate meaningful architecture
8. **Add industry-specific agents** -- Compliance reviewer for fintech/healthtech, performance reviewer for gaming, data quality reviewer for data engineering
9. **Add industry-specific commands** -- `/compliance-check`, `/data-quality`, `/load-test`, `/security-audit`
10. **Generate meaningful deploy commands per industry** -- Airflow deploy != Next.js deploy != Docker deploy != Edge device deploy
