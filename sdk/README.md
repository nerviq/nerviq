# @nerviq/sdk

Programmatic SDK for Nerviq audit, Harmony, catalog access, and experimental Synergy workflows.

## Install

```bash
npm install @nerviq/sdk
```

## Stability

- Stable for production workflows: `audit`, `harmonyAudit`, `detectPlatforms`, `getCatalog`
- Experimental advisory surfaces: `synergyReport`, `routeTask`
- Local-first: the SDK reads your repo directly and does not require a background service

## Quick Start

```js
const { audit, harmonyAudit, detectPlatforms } = require('@nerviq/sdk');

async function main() {
  const repoDir = process.cwd();

  try {
    const platforms = detectPlatforms(repoDir);
    console.log(`Platforms: ${platforms.join(', ') || 'none detected'}`);

    const auditResult = await audit(repoDir, 'claude');
    console.log(`Claude score: ${auditResult.score}/100`);

    const harmony = await harmonyAudit(repoDir);
    console.log(`Harmony score: ${harmony.harmonyScore}/100`);
  } catch (error) {
    console.error(formatSdkError(error));
    process.exitCode = 1;
  }
}

function formatSdkError(error) {
  if (error instanceof Error) {
    return `Nerviq SDK error: ${error.message}`;
  }
  return 'Nerviq SDK error: unknown failure';
}

main();
```

## Common Patterns

### 1. CI gate for one platform

```js
const { audit } = require('@nerviq/sdk');

async function runGate(dir) {
  const result = await audit(dir, 'codex');

  if (result.score < 70) {
    const reasons = result.topNextActions
      .slice(0, 3)
      .map((item) => `- ${item.name}`)
      .join('\n');

    throw new Error(`Nerviq gate failed (${result.score}/100)\n${reasons}`);
  }

  return result;
}
```

### 2. Cross-platform reporting

```js
const { harmonyAudit } = require('@nerviq/sdk');

async function buildAlignmentDigest(dir) {
  const harmony = await harmonyAudit(dir);

  return {
    harmonyScore: harmony.harmonyScore,
    activePlatforms: harmony.activePlatforms,
    topRecommendation: harmony.recommendations[0] || null,
    driftCount: harmony.drift?.summary?.total || 0,
  };
}
```

### 3. Catalog-backed search or UI helpers

```js
const { getCatalog } = require('@nerviq/sdk');

const catalog = getCatalog();
const criticalSecurityChecks = catalog.filter(
  (check) => check.category === 'security' && check.impact === 'critical'
);

console.log(`Critical security checks: ${criticalSecurityChecks.length}`);
```

## Error Handling

The SDK throws regular `Error` instances with operator-readable messages. The most common cases are:

| Situation | Example message |
| --- | --- |
| `dir` missing or not a string | `dir is required and must be a string. Pass a valid directory path.` |
| Directory does not exist | `Directory not found: /abs/path. Pass an existing directory path.` |
| Unsupported platform | `Unsupported platform 'foo'. Use one of: claude, codex, ...` |
| Empty routing description | `description is required and must be a non-empty string.` |

Recommended pattern:

```js
try {
  const result = await audit('/repo', 'claude');
  console.log(result.score);
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error('Unknown SDK failure');
  }
}
```

## TypeScript

The SDK ships with `index.d.ts`, so you can import both functions and result interfaces directly.

```ts
import {
  audit,
  harmonyAudit,
  routeTask,
  type AuditResult,
  type HarmonyResult,
  type RoutingResult,
} from "@nerviq/sdk";

async function inspectRepo(dir: string): Promise<{
  audit: AuditResult;
  harmony: HarmonyResult;
  routing: RoutingResult;
}> {
  const auditResult = await audit(dir, "claude");
  const harmony = await harmonyAudit(dir);
  const routing = routeTask(
    "Review trust boundaries and MCP posture",
    ["claude", "codex", "cursor"]
  );

  return {
    audit: auditResult,
    harmony,
    routing,
  };
}
```

## API Surface

```js
const {
  audit,
  harmonyAudit,
  synergyReport,
  detectPlatforms,
  getCatalog,
  routeTask,
} = require('@nerviq/sdk');
```

| Export | Stability | What it does |
| --- | --- | --- |
| `audit(dir, platform?)` | Stable | Run a single-platform audit and return score, findings, and next actions. |
| `harmonyAudit(dir)` | Stable | Run cross-platform alignment and drift analysis. |
| `detectPlatforms(dir)` | Stable | Detect which supported agent platforms are active in the repo. |
| `getCatalog()` | Stable | Return the merged Nerviq check catalog. |
| `synergyReport(dir)` | Experimental | Return research-phase multi-platform lift analysis and rendered report text. |
| `routeTask(description, platforms?)` | Experimental | Suggest a platform mix for a task description using the current routing model. |

## Notes

- `audit()` defaults to `claude` when no platform is supplied.
- `audit()` and `harmonyAudit()` are async because they inspect the repository on disk.
- `getCatalog()` and `routeTask()` are synchronous helpers.
- If you need a local HTTP surface instead of direct imports, use `nerviq serve` and pull the live contract from `/api/openapi.json`.
