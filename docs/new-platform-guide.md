# New Platform Onboarding Guide

How to add a new AI coding platform to Nerviq.

## Overview

Each platform in Nerviq follows a standardized structure with 14 source modules, dedicated tests, research documentation, and integration points. This guide walks through every step required to bring a new platform from zero to full parity.

## Prerequisites

- Access to the platform's official documentation
- A test project configured for the platform
- Familiarity with Nerviq's audit engine (`src/audit.js`)

## Step 1: Research Phase

Before writing code, produce the research deliverables:

1. **Platform Research Doc** — `research/{platform}-platform-research-v1-YYYY-MM-DD.md`
   - Architecture, config file formats, CLI commands, extension points
   - Minimum 5 queries from different angles (Anthropic research protocol)
   - Confidence levels for every claim

2. **Gap Matrix** — `research/nerviq-{platform}-full-gap-matrix-YYYY-MM-DD.md`
   - Compare platform capabilities against Claude Code baseline
   - Identify all gaps and parity opportunities

3. **Build Plan** — `research/nerviq-for-{platform}-build-plan-v3-final-YYYY-MM-DD.md`
   - Phased implementation plan with deliverables per phase
   - Dependencies and risk assessment

4. **Parity Closure Plan** — `research/nerviq-{platform}-parity-closure-plan-v1-YYYY-MM-DD.md`
   - Specific steps to close each identified gap

## Step 2: Create Platform Source Modules

Create the directory `src/{platform}/` with these 14 required modules:

| # | File | Purpose |
|---|------|---------|
| 1 | `techniques.js` | Check definitions (id, name, check function, impact, category, fix) |
| 2 | `config-parser.js` | Parse platform-specific config files |
| 3 | `context.js` | `{Platform}ProjectContext` class with `is{Platform}Repo(dir)` detection |
| 4 | `setup.js` | Generate starter config files for the platform |
| 5 | `plans.js` | Proposal generation and application logic |
| 6 | `governance.js` | Permission profiles, policy packs, governance rules |
| 7 | `interactive.js` | Step-by-step guided wizard for the platform |
| 8 | `deep-review.js` | AI-powered config review (opt-in) |
| 9 | `freshness.js` | Freshness checks for platform-specific configs |
| 10 | `domain-packs.js` | Domain-specific check packs (React, Python, etc.) |
| 11 | `mcp-packs.js` | MCP server integration packs |
| 12 | `activity.js` | Snapshot and activity tracking |
| 13 | `patch.js` | Config patching and migration helpers |
| 14 | `premium.js` | Premium/advanced checks |

### Module template

Each `techniques.js` must export an array of check objects:

```js
module.exports = [
  {
    key: '{platform}ConfigExists',
    name: '{Platform} config file exists',
    category: 'Memory & Context',
    impact: 'critical',
    check: (dir) => {
      const fs = require('fs');
      return fs.existsSync(`${dir}/.{platform}-config`);
    },
    fix: 'Create a .{platform}-config file in the project root.',
    sourceUrl: 'https://docs.{platform}.dev/config',
    confidence: 0.9,
  },
  // ... more checks
];
```

Each `context.js` must export a class with static detection:

```js
class {Platform}ProjectContext {
  static is{Platform}Repo(dir) {
    const fs = require('fs');
    return fs.existsSync(`${dir}/.{platform}-config`);
  }
}
module.exports = { {Platform}ProjectContext };
```

## Step 3: Create Test Files

| File | Purpose |
|------|---------|
| `test/{platform}.test.js` | Unit tests for all 14 modules |
| `test/{platform}-check-matrix.js` | Matrix test: every check runs against fixtures |
| `test/{platform}-golden-matrix.js` | Golden file test: audit output matches expected |
| `test/{platform}-fixtures.js` | Test fixture generator |

### Check matrix template

The check matrix ensures every technique key in `techniques.js` is exercised:

```js
const techniques = require('../src/{platform}/techniques');
const allKeys = techniques.map(t => t.key);

for (const key of allKeys) {
  // Verify check function exists and returns boolean
  const technique = techniques.find(t => t.key === key);
  const result = technique.check(fixtureDir);
  assert(typeof result === 'boolean', `${key} must return boolean`);
}
```

## Step 4: Integration Points

### 4a. Register in `src/audit.js`

Add platform detection and technique loading:

```js
// In the platform resolution logic
if (platform === '{platform}') {
  techniques = require('./{platform}/techniques');
}
```

### 4b. Register in `src/public-api.js`

Add to `PLATFORM_ORDER` and `PLATFORM_DETECTORS`:

```js
const { {Platform}ProjectContext } = require('./{platform}/context');

// In PLATFORM_ORDER array:
'{platform}',

// In PLATFORM_DETECTORS object:
{platform}: (dir) => {Platform}ProjectContext.is{Platform}Repo(dir),
```

### 4c. Register in `src/catalog.js`

Ensure `generateCatalog()` includes the new platform's techniques.

### 4d. Register in `bin/cli.js`

Add platform validation in the CLI argument parser (the platform check near line 363).

### 4e. Register in Harmony

Add to `PLATFORM_AUDIT_MAP` in `src/harmony/audit.js`:

```js
{platform}: '{platform}',
```

### 4f. Update `action.yml`

Add platform to the GitHub Action inputs if needed.

## Step 5: Documentation

- Update `README.md` platform table
- Update `CHANGELOG.md` with the new platform entry
- Add platform to `package.json` keywords
- Update `docs/ARCHITECTURE.md` if it references platform list

## 17-Point Deliverables Checklist

Use this checklist to track completion. All items must be done before the platform is considered fully supported.

- [ ] 1. Platform research document
- [ ] 2. Gap matrix vs Claude Code baseline
- [ ] 3. Build plan (v3 final)
- [ ] 4. Parity closure plan
- [ ] 5. `src/{platform}/techniques.js` — all checks with sourceUrl + confidence
- [ ] 6. `src/{platform}/config-parser.js`
- [ ] 7. `src/{platform}/context.js` — with `is{Platform}Repo()` detection
- [ ] 8. `src/{platform}/setup.js`
- [ ] 9. `src/{platform}/plans.js`
- [ ] 10. `src/{platform}/governance.js`
- [ ] 11. Remaining 8 modules (interactive, deep-review, freshness, domain-packs, mcp-packs, activity, patch, premium)
- [ ] 12. `test/{platform}.test.js`
- [ ] 13. `test/{platform}-check-matrix.js`
- [ ] 14. `test/{platform}-golden-matrix.js`
- [ ] 15. Integration in audit.js, public-api.js, catalog.js, cli.js
- [ ] 16. Harmony integration
- [ ] 17. README, CHANGELOG, and documentation updates

## Quality Gates

Before merging a new platform:

1. All check-matrix tests pass: `node test/{platform}-check-matrix.js`
2. All golden-matrix tests pass: `node test/{platform}-golden-matrix.js`
3. Jest tests pass: `npx jest test/{platform}.test.js`
4. Platform appears in `nerviq catalog` output
5. `nerviq audit --platform {platform}` runs successfully on a real project
6. Harmony audit includes the new platform
7. Every technique has `sourceUrl` and `confidence >= 0.7`
