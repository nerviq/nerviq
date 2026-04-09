# API Reference

This document covers every function export surfaced through `src/index.js`. Constants and classes are intentionally omitted.

Return types are documented at the API boundary level. Most workflows return structured objects; formatter helpers return strings; async workflows return promises.

Known unresolved index aliases: `copilotInteractive`, `cursorInteractive`, and `windsurfInteractive` are present in `src/index.js`, but currently resolve `undefined` at runtime because their source modules export differently named wizard functions.

## Example Recipes

### audit

```js
const { audit } = require('@nerviq/cli');

const result = await audit({
  dir: process.cwd(),
  format: 'json',
});

console.log(result.summary);
```

### setup

```js
const { setup } = require('@nerviq/cli');

await setup({
  dir: process.cwd(),
  template: 'claude-md',
  force: false,
});
```

### buildProposalBundle

```js
const { buildProposalBundle } = require('@nerviq/cli');

const bundle = await buildProposalBundle({
  dir: process.cwd(),
  stacks: ['node', 'react'],
});

console.log(bundle.files);
```

### applyProposalBundle

```js
const { buildProposalBundle, applyProposalBundle } = require('@nerviq/cli');

const bundle = await buildProposalBundle({ dir: process.cwd() });
await applyProposalBundle({ dir: process.cwd(), bundle });
```

### setupCodex

```js
const { setupCodex } = require('@nerviq/cli');

await setupCodex({
  dir: process.cwd(),
  mode: 'guided',
});
```

### setupGemini

```js
const { setupGemini } = require('@nerviq/cli');

await setupGemini({
  dir: process.cwd(),
  mcpPacks: ['filesystem', 'github'],
});
```

### harmonyAudit

```js
const { harmonyAudit } = require('@nerviq/cli');

const report = await harmonyAudit({ dir: process.cwd() });
console.log(report.recommendations);
```

### generateStrategicAdvice

```js
const { buildCanonicalModel, generateStrategicAdvice } = require('@nerviq/cli');

const canon = buildCanonicalModel(process.cwd());
const advice = generateStrategicAdvice(canon, []);
console.log(advice);
```

### synergyReport

```js
const { synergyReport } = require('@nerviq/cli');

const report = await synergyReport(process.cwd());
console.log(report.score);
```

### createServer

```js
const { createServer } = require('@nerviq/cli');

const server = createServer({ baseDir: process.cwd() });
server.listen(4310);

// GET http://127.0.0.1:4310/api/openapi.json
// GET http://127.0.0.1:4310/api/health
// GET http://127.0.0.1:4310/api/catalog
// GET http://127.0.0.1:4310/api/audit?platform=claude&dir=.
// GET http://127.0.0.1:4310/api/harmony?dir=.
```

### buildServeOpenApiSpec

```js
const { buildServeOpenApiSpec } = require('@nerviq/cli');

const spec = buildServeOpenApiSpec({
  serverUrl: 'http://127.0.0.1:4310',
});

console.log(spec.paths['/api/audit'].get.parameters);
```

## Core

Source modules: `src/audit.js`, `src/setup.js`, `src/analyze.js`, `src/plans.js`, `src/governance.js`, `src/benchmark.js`, `src/domain-packs.js`, `src/mcp-packs.js`, `src/activity.js`, `src/public-api.js`, `src/server.js`, `src/formatters/sarif.js`

| Function | Signature | Returns | Description |
| --- | --- | --- | --- |
| `audit` | `audit(options)` | `Promise<object>` | Run the primary NERVIQ audit pipeline against a project directory. |
| `setup` | `setup(options)` | `Promise<object>` | Apply the primary NERVIQ setup flow and write managed project scaffolding. |
| `analyzeProject` | `analyzeProject(options)` | `Promise<object>` | Inspect a project and return the raw analysis used by higher-level flows, including archetype, operating profile, and adopt/defer/ignore guidance. |
| `buildProposalBundle` | `buildProposalBundle(options)` | `Promise<object>` | Build a file-change proposal bundle without writing it to disk. |
| `applyProposalBundle` | `applyProposalBundle(options)` | `Promise<object>` | Apply a previously generated proposal bundle to a target project. |
| `getGovernanceSummary` | `getGovernanceSummary(platform = 'claude')` | `object` | Return governance guidance for the selected platform family. |
| `runBenchmark` | `runBenchmark(options)` | `Promise<object>` | Execute the benchmark pipeline and collect timing and score output. |
| `detectDomainPacks` | `detectDomainPacks(ctx, stacks, assets = null)` | `array` | Detect domain packs for the current project. |
| `getMcpPack` | `getMcpPack(key)` | `object` | Return mcp pack from the core module. |
| `mergeMcpServers` | `mergeMcpServers(existing = {}, packKeys = [])` | `object` | Merge mcp servers into an existing value. |
| `getMcpPackPreflight` | `getMcpPackPreflight(packKeys = [], env = process.env)` | `object` | Return mcp pack preflight from the core module. |
| `recommendMcpPacks` | `recommendMcpPacks(stacks = [], domainPacks = [], options = {})` | `array` | Recommend mcp packs based on detected project context. |
| `recordRecommendationOutcome` | `recordRecommendationOutcome(dir, payload)` | `object` | Record recommendation outcome in the project activity history. |
| `getRecommendationOutcomeSummary` | `getRecommendationOutcomeSummary(dir)` | `object` | Return recommendation outcome summary from the core module. |
| `formatRecommendationOutcomeSummary` | `formatRecommendationOutcomeSummary(dir)` | `string` | Format recommendation outcome summary for display or export. |
| `detectPlatforms` | `detectPlatforms(dir)` | `array` | Detect which agent platforms are active in the target repository. |
| `getCatalog` | `getCatalog()` | `object` | Return the public catalog of supported platforms, packs, and capabilities. |
| `synergyReport` | `synergyReport(dir)` | `Promise<object>` | Run the public cross-platform synergy report workflow for a repository. |
| `buildServeOpenApiSpec` | `buildServeOpenApiSpec(options = {})` | `object` | Build the OpenAPI 3.1 contract for the local `nerviq serve` HTTP surface. |
| `createServer` | `createServer(options = {})` | `http.Server` | Create the HTTP server used by the package API and local integrations. |
| `startServer` | `startServer(options = {})` | `Promise<http.Server>` | Start the package HTTP server with the supplied runtime options. |
| `getPlatformChangeManifest` | `getPlatformChangeManifest()` | `array` | Return the canonical platform-change watchlist manifest for all supported platforms. |
| `summarizePlatformChangeManifest` | `summarizePlatformChangeManifest()` | `object` | Return a summary of tracked platform sources, cadence, and update-trigger counts. |
| `formatSarif` | `formatSarif(auditResult, options = {})` | `string` | Format an audit result as SARIF output for code scanning tools. |

## Codex

Source modules: `src/codex/*`

| Function | Signature | Returns | Description |
| --- | --- | --- | --- |
| `detectCodexVersion` | `detectCodexVersion()` | `object` | Detect codex version for the current project. |
| `recommendCodexMcpPacks` | `recommendCodexMcpPacks(stacks = [], domainPacks = [], options = {})` | `array` | Recommend codex mcp packs based on detected project context. |
| `getCodexMcpPreflight` | `getCodexMcpPreflight(packKeys = [], env = process.env)` | `object` | Return codex mcp preflight from the codex module. |
| `mergeCodexMcpToml` | `mergeCodexMcpToml(existingConfigContent = '', packKeys = [])` | `string` | Merge codex mcp toml into an existing value. |
| `buildCodexProposalBundle` | `buildCodexProposalBundle(options)` | `Promise<object>` | Build codex proposal bundle for downstream codex workflows. |
| `setupCodex` | `setupCodex(options)` | `Promise<object>` | Set up codex configuration and managed project files. |
| `getCodexHistory` | `getCodexHistory(dir, limit = 20)` | `array` | Return codex history from the codex module. |
| `formatCodexHistory` | `formatCodexHistory(dir)` | `string` | Format codex history for display or export. |
| `compareCodexLatest` | `compareCodexLatest(dir)` | `object` | Compare codex latest against the latest recorded baseline. |
| `exportCodexTrendReport` | `exportCodexTrendReport(dir)` | `object` | Export codex trend report for reporting or downstream processing. |
| `recordCodexFeedback` | `recordCodexFeedback(dir, payload)` | `object` | Record codex feedback in the project activity history. |
| `formatCodexFeedback` | `formatCodexFeedback(dir)` | `string` | Format codex feedback for display or export. |
| `generateCodexInsights` | `generateCodexInsights(dir)` | `object` | Generate codex insights from codex inputs. |
| `formatCodexInsights` | `formatCodexInsights(dir)` | `string` | Format codex insights for display or export. |
| `patchAgentsMd` | `patchAgentsMd(existingContent, managedSections)` | `string` | Patch agents md with managed sections. |
| `patchConfigToml` | `patchConfigToml(existingContent, newSections)` | `string` | Patch config toml with managed sections. |
| `detectMixedAgentRepo` | `detectMixedAgentRepo(dir)` | `object` | Detect mixed agent repo for the current project. |
| `applyPatch` | `applyPatch(dir, filePath, patchFn, options = {})` | `object` | Apply patch to the target project or model. |
| `getCodexGovernanceSummary` | `getCodexGovernanceSummary()` | `object` | Return codex governance summary from the codex module. |
| `checkReleaseGate` | `checkReleaseGate(sourceVerifications = {})` | `object` | Check release gate and return the evaluation result. |
| `formatReleaseGate` | `formatReleaseGate(gateResult)` | `string` | Format release gate for display or export. |
| `getPropagationTargets` | `getPropagationTargets(triggerKeyword)` | `array` | Return propagation targets from the codex module. |
| `runCodexDeepReview` | `runCodexDeepReview(options)` | `Promise<object>` | Run the codex deep review workflow. |
| `collectCodexConfig` | `collectCodexConfig(ctx, stacks)` | `object` | Collect codex config into a structured object. |
| `buildCodexReviewPayload` | `buildCodexReviewPayload(config)` | `object` | Build codex review payload for downstream codex workflows. |
| `codexInteractive` | `codexInteractive(options = {})` | `Promise<object|null>` | Return the codex interactive capability from the codex module. |
| `composePacks` | `composePacks(domainPackKeys = [], mcpPackKeys = [], options = {})` | `object` | Compose packs into a combined configuration payload. |
| `getCiTemplate` | `getCiTemplate(templateKey)` | `object` | Return ci template from the codex module. |
| `checkAdoptionGate` | `checkAdoptionGate(gateKey, dir)` | `object` | Check adoption gate and return the evaluation result. |

## Gemini

Source modules: `src/gemini/*`

| Function | Signature | Returns | Description |
| --- | --- | --- | --- |
| `detectGeminiVersion` | `detectGeminiVersion()` | `object` | Detect gemini version for the current project. |
| `recommendGeminiMcpPacks` | `recommendGeminiMcpPacks(stacks = [], domainPacks = [], options = {})` | `array` | Recommend gemini mcp packs based on detected project context. |
| `getGeminiMcpPreflight` | `getGeminiMcpPreflight(packKeys = [], env = process.env)` | `object` | Return gemini mcp preflight from the gemini module. |
| `mergeGeminiMcpJson` | `mergeGeminiMcpJson(existingSettings = {}, packKeys = [])` | `object` | Merge gemini mcp json into an existing value. |
| `detectGeminiDomainPacks` | `detectGeminiDomainPacks(ctx, stacks = [], assets = {})` | `object` | Detect gemini domain packs for the current project. |
| `buildGeminiProposalBundle` | `buildGeminiProposalBundle(options)` | `Promise<object>` | Build gemini proposal bundle for downstream gemini workflows. |
| `setupGemini` | `setupGemini(options)` | `Promise<object>` | Set up gemini configuration and managed project files. |
| `getGeminiGovernanceSummary` | `getGeminiGovernanceSummary()` | `object` | Return gemini governance summary from the gemini module. |
| `getGeminiHistory` | `getGeminiHistory(dir, limit = 20)` | `array` | Return gemini history from the gemini module. |
| `formatGeminiHistory` | `formatGeminiHistory(dir)` | `string` | Format gemini history for display or export. |
| `compareGeminiLatest` | `compareGeminiLatest(dir)` | `object` | Compare gemini latest against the latest recorded baseline. |
| `exportGeminiTrendReport` | `exportGeminiTrendReport(dir)` | `object` | Export gemini trend report for reporting or downstream processing. |
| `recordGeminiFeedback` | `recordGeminiFeedback(dir, payload)` | `object` | Record gemini feedback in the project activity history. |
| `formatGeminiFeedback` | `formatGeminiFeedback(dir)` | `string` | Format gemini feedback for display or export. |
| `generateGeminiInsights` | `generateGeminiInsights(dir)` | `object` | Generate gemini insights from gemini inputs. |
| `formatGeminiInsights` | `formatGeminiInsights(dir)` | `string` | Format gemini insights for display or export. |
| `patchGeminiMd` | `patchGeminiMd(existingContent, managedSections)` | `string` | Patch gemini md with managed sections. |
| `patchSettingsJson` | `patchSettingsJson(existingContent, newKeys)` | `object` | Patch settings json with managed sections. |
| `detectMixedAgentRepoGemini` | `detectMixedAgentRepoGemini(dir)` | `object` | Detect mixed agent repo gemini for the current project. |
| `checkGeminiReleaseGate` | `checkGeminiReleaseGate(sourceVerifications = {})` | `object` | Check gemini release gate and return the evaluation result. |
| `formatGeminiReleaseGate` | `formatGeminiReleaseGate(gateResult)` | `string` | Format gemini release gate for display or export. |
| `runGeminiDeepReview` | `runGeminiDeepReview(options)` | `Promise<object>` | Run the gemini deep review workflow. |
| `collectGeminiConfig` | `collectGeminiConfig(ctx, stacks)` | `object` | Collect gemini config into a structured object. |
| `geminiInteractive` | `geminiInteractive(options = {})` | `Promise<object|null>` | Return the gemini interactive capability from the gemini module. |
| `composeGeminiPacks` | `composeGeminiPacks(domainPackKeys = [], mcpPackKeys = [], options = {})` | `object` | Compose gemini packs into a combined configuration payload. |
| `getGeminiCiTemplate` | `getGeminiCiTemplate(templateKey)` | `object` | Return gemini ci template from the gemini module. |
| `checkGeminiAdoptionGate` | `checkGeminiAdoptionGate(gateKey, dir)` | `object` | Check gemini adoption gate and return the evaluation result. |

## Copilot

Source modules: `src/copilot/*`

| Function | Signature | Returns | Description |
| --- | --- | --- | --- |
| `recommendCopilotMcpPacks` | `recommendCopilotMcpPacks(stacks = [], domainPacks = [], options = {})` | `array` | Recommend copilot mcp packs based on detected project context. |
| `getCopilotMcpPreflight` | `getCopilotMcpPreflight(packKeys = [], env = process.env)` | `object` | Return copilot mcp preflight from the copilot module. |
| `detectCopilotDomainPacks` | `detectCopilotDomainPacks(ctx, stacks = [], assets = {})` | `object` | Detect copilot domain packs for the current project. |
| `buildCopilotProposalBundle` | `buildCopilotProposalBundle(options)` | `Promise<object>` | Build copilot proposal bundle for downstream copilot workflows. |
| `setupCopilot` | `setupCopilot(options)` | `Promise<object>` | Set up copilot configuration and managed project files. |
| `getCopilotGovernanceSummary` | `getCopilotGovernanceSummary()` | `object` | Return copilot governance summary from the copilot module. |
| `getCopilotHistory` | `getCopilotHistory(dir, limit = 20)` | `array` | Return copilot history from the copilot module. |
| `formatCopilotHistory` | `formatCopilotHistory(dir)` | `string` | Format copilot history for display or export. |
| `compareCopilotLatest` | `compareCopilotLatest(dir)` | `object` | Compare copilot latest against the latest recorded baseline. |
| `exportCopilotTrendReport` | `exportCopilotTrendReport(dir)` | `object` | Export copilot trend report for reporting or downstream processing. |
| `generateCopilotInsights` | `generateCopilotInsights(dir)` | `object` | Generate copilot insights from copilot inputs. |
| `runCopilotDeepReview` | `runCopilotDeepReview(options)` | `Promise<object>` | Run the copilot deep review workflow. |
| `copilotInteractive` | `copilotInteractive(...)` | `undefined` | Reserved index export for the Copilot interactive wizard; currently unresolved at runtime. The index exports `copilotInteractive`, but `src/copilot/interactive.js` currently exports `runCopilotWizard` and `runProjectDetection`. |
| `composeCopilotPacks` | `composeCopilotPacks(domainPackKeys = [], mcpPackKeys = [], options = {})` | `object` | Compose copilot packs into a combined configuration payload. |
| `getCopilotCiTemplate` | `getCopilotCiTemplate(templateKey)` | `object` | Return copilot ci template from the copilot module. |
| `checkCopilotAdoptionGate` | `checkCopilotAdoptionGate(gateKey, dir)` | `object` | Check copilot adoption gate and return the evaluation result. |

## Cursor

Source modules: `src/cursor/*`

| Function | Signature | Returns | Description |
| --- | --- | --- | --- |
| `recommendCursorMcpPacks` | `recommendCursorMcpPacks(stacks = [], domainPacks = [], options = {})` | `array` | Recommend cursor mcp packs based on detected project context. |
| `detectCursorDomainPacks` | `detectCursorDomainPacks(ctx, stacks = [], assets = {})` | `object` | Detect cursor domain packs for the current project. |
| `buildCursorProposalBundle` | `buildCursorProposalBundle(options)` | `Promise<object>` | Build cursor proposal bundle for downstream cursor workflows. |
| `setupCursor` | `setupCursor(options)` | `Promise<object>` | Set up cursor configuration and managed project files. |
| `getCursorGovernanceSummary` | `getCursorGovernanceSummary()` | `object` | Return cursor governance summary from the cursor module. |
| `getCursorHistory` | `getCursorHistory(dir, limit = 20)` | `array` | Return cursor history from the cursor module. |
| `compareCursorLatest` | `compareCursorLatest(dir)` | `object` | Compare cursor latest against the latest recorded baseline. |
| `generateCursorInsights` | `generateCursorInsights(dir)` | `object` | Generate cursor insights from cursor inputs. |
| `runCursorDeepReview` | `runCursorDeepReview(options)` | `Promise<object>` | Run the cursor deep review workflow. |
| `cursorInteractive` | `cursorInteractive(...)` | `undefined` | Reserved index export for the Cursor interactive wizard; currently unresolved at runtime. The index exports `cursorInteractive`, but `src/cursor/interactive.js` currently exports `runCursorWizard` and `runProjectDetection`. |
| `composeCursorPacks` | `composeCursorPacks(domainPackKeys = [], mcpPackKeys = [], options = {})` | `object` | Compose cursor packs into a combined configuration payload. |
| `checkCursorAdoptionGate` | `checkCursorAdoptionGate(gateKey, dir)` | `object` | Check cursor adoption gate and return the evaluation result. |

## Windsurf

Source modules: `src/windsurf/*`

| Function | Signature | Returns | Description |
| --- | --- | --- | --- |
| `detectWindsurfDomainPacks` | `detectWindsurfDomainPacks(ctx, stacks = [], assets = {})` | `object` | Detect windsurf domain packs for the current project. |
| `setupWindsurf` | `setupWindsurf(options)` | `Promise<object>` | Set up windsurf configuration and managed project files. |
| `getWindsurfGovernanceSummary` | `getWindsurfGovernanceSummary()` | `object` | Return windsurf governance summary from the windsurf module. |
| `runWindsurfDeepReview` | `runWindsurfDeepReview(options)` | `Promise<object>` | Run the windsurf deep review workflow. |
| `windsurfInteractive` | `windsurfInteractive(...)` | `undefined` | Reserved index export for the Windsurf interactive wizard; currently unresolved at runtime. The index exports `windsurfInteractive`, but `src/windsurf/interactive.js` currently exports `runWindsurfWizard` and `runProjectDetection`. |

## Aider

Source modules: `src/aider/*`

| Function | Signature | Returns | Description |
| --- | --- | --- | --- |
| `detectAiderDomainPacks` | `detectAiderDomainPacks(ctx)` | `object` | Detect aider domain packs for the current project. |
| `setupAider` | `setupAider(options = {})` | `Promise<object>` | Set up aider configuration and managed project files. |
| `getAiderGovernanceSummary` | `getAiderGovernanceSummary()` | `object` | Return aider governance summary from the aider module. |
| `runAiderDeepReview` | `runAiderDeepReview(dir)` | `Promise<object>` | Run the aider deep review workflow. |
| `aiderInteractive` | `aiderInteractive(dir)` | `Promise<object|null>` | Return the aider interactive capability from the aider module. |

## OpenCode

Source modules: `src/opencode/*`

| Function | Signature | Returns | Description |
| --- | --- | --- | --- |
| `detectOpenCodeDomainPacks` | `detectOpenCodeDomainPacks(ctx, stacks = [])` | `object` | Detect open code domain packs for the current project. |
| `setupOpenCode` | `setupOpenCode(options)` | `Promise<object>` | Set up opencode configuration and managed project files. |
| `getOpenCodeGovernanceSummary` | `getOpenCodeGovernanceSummary()` | `object` | Return open code governance summary from the opencode module. |
| `runOpenCodeDeepReview` | `runOpenCodeDeepReview(options)` | `Promise<object>` | Run the open code deep review workflow. |
| `opencodeInteractive` | `opencodeInteractive(options = {})` | `Promise<object|null>` | Return the opencode interactive capability from the opencode module. |

## Harmony

Source modules: `src/harmony/*`

| Function | Signature | Returns | Description |
| --- | --- | --- | --- |
| `buildCanonicalModel` | `buildCanonicalModel(dir)` | `object` | Build the Harmony canonical model from the current repository state. |
| `detectActivePlatforms` | `detectActivePlatforms(dir)` | `array` | Detect active platforms for the current project. |
| `detectDrift` | `detectDrift(canonicalModel)` | `object` | Detect drift for the current project. |
| `formatDriftReport` | `formatDriftReport(driftResult, options = {})` | `string` | Format drift report for display or export. |
| `harmonyAudit` | `harmonyAudit(options)` | `Promise<object>` | Run the Harmony audit across detected platform configurations. |
| `formatHarmonyAuditReport` | `formatHarmonyAuditReport(result)` | `string` | Format harmony audit report for display or export. |
| `generateHarmonySync` | `generateHarmonySync(canonicalModel, options = {})` | `object` | Generate harmony sync from harmony inputs. |
| `applyHarmonySync` | `applyHarmonySync(dir, options = {})` | `object` | Apply harmony sync to the target project or model. |
| `previewHarmonySync` | `previewHarmonySync(dir, options = {})` | `object` | Return the preview harmony sync capability from the harmony module. |
| `generateStrategicAdvice` | `generateStrategicAdvice(canonicalModel, platformAudits)` | `object` | Generate cross-platform platform advice from the canonical model and audits. |
| `startHarmonyWatch` | `startHarmonyWatch(options)` | `Promise<object>` | Start harmony watch and return the running handle. |
| `saveHarmonyState` | `saveHarmonyState(dir, state)` | `object` | Save harmony state to persistent storage. |
| `loadHarmonyState` | `loadHarmonyState(dir)` | `object` | Load harmony state from persistent storage. |
| `getHarmonyHistory` | `getHarmonyHistory(dir, filter)` | `array` | Return harmony history from the harmony module. |
| `getHarmonyGovernanceSummary` | `getHarmonyGovernanceSummary(canonicalModel, platformAudits)` | `object` | Return harmony governance summary from the harmony module. |
| `formatHarmonyGovernanceReport` | `formatHarmonyGovernanceReport(summary, options)` | `string` | Format harmony governance report for display or export. |

## Synergy

Source modules: `src/synergy/*`

| Function | Signature | Returns | Description |
| --- | --- | --- | --- |
| `propagateInsight` | `propagateInsight(insight, sourcePlatform, targetPlatforms)` | `object` | Propagate insight across selected platforms. |
| `getCrossLearnings` | `getCrossLearnings(dir)` | `array` | Return cross learnings from the synergy module. |
| `routeTask` | `routeTask(taskDescription, activePlatforms, projectHistory)` | `object` | Route a task description to the most suitable active platforms. |
| `classifyTaskType` | `classifyTaskType(taskDescription)` | `string` | Classify task type into a known synergy category. |
| `compoundAudit` | `compoundAudit(platformAudits)` | `object` | Combine audit into a single evidence view. |
| `calculateAmplification` | `calculateAmplification(platformAudits)` | `number` | Calculate amplification for the current inputs. |
| `analyzeCompensation` | `analyzeCompensation(activePlatforms, platformAudits)` | `object` | Analyze compensation and return structured findings. |
| `getUncoveredGaps` | `getUncoveredGaps(activePlatforms)` | `array` | Return uncovered gaps from the synergy module. |
| `discoverPatterns` | `discoverPatterns(harmonyHistory)` | `object` | Discover patterns from accumulated history. |
| `rankRecommendations` | `rankRecommendations(recommendations, activePlatforms, context)` | `array` | Return the rank recommendations capability from the synergy module. |
| `calculateSynergyScore` | `calculateSynergyScore(recommendation, activePlatforms, context)` | `number` | Calculate synergy score for the current inputs. |
| `generateSynergyReport` | `generateSynergyReport(options)` | `Promise<object>` | Build the full Synergy report structure from routing and amplification inputs. |
| `detectProjectChanges` | `detectProjectChanges(dir, previousCanon)` | `object` | Detect project changes for the current project. |
| `generateAdaptiveUpdates` | `generateAdaptiveUpdates(changes)` | `object` | Generate adaptive updates from synergy inputs. |
