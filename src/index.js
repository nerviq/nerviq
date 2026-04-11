const { audit } = require('./audit');
const { setup } = require('./setup');
const { analyzeProject } = require('./analyze');
const { buildProposalBundle, applyProposalBundle } = require('./plans');
const { getGovernanceSummary } = require('./governance');
const { runBenchmark } = require('./benchmark');
const { DOMAIN_PACKS, detectDomainPacks } = require('./domain-packs');
const { MCP_PACKS, getMcpPack, mergeMcpServers, getMcpPackPreflight, recommendMcpPacks } = require('./mcp-packs');
const { recordRecommendationOutcome, getRecommendationOutcomeSummary, formatRecommendationOutcomeSummary } = require('./activity');
const { CodexProjectContext, detectCodexVersion } = require('./codex/context');
const { formatSarif } = require('./formatters/sarif');
const { CODEX_MCP_PACKS, recommendCodexMcpPacks, getCodexMcpPreflight, mergeCodexMcpToml } = require('./codex/mcp-packs');
const { buildCodexProposalBundle } = require('./codex/plans');
const { setupCodex } = require('./codex/setup');
const {
  getCodexHistory, formatCodexHistory, compareCodexLatest,
  exportCodexTrendReport, recordCodexFeedback, formatCodexFeedback,
  generateCodexInsights, formatCodexInsights,
} = require('./codex/activity');
const { getCodexGovernanceSummary } = require('./codex/governance');
const {
  patchAgentsMd, patchConfigToml, detectMixedAgentRepo, applyPatch,
} = require('./codex/patch');
const { checkReleaseGate, formatReleaseGate, getPropagationTargets } = require('./codex/freshness');
const { runCodexDeepReview, collectCodexConfig, buildCodexReviewPayload } = require('./codex/deep-review');
const { codexInteractive } = require('./codex/interactive');
const { composePacks, getCiTemplate, CI_TEMPLATES, checkAdoptionGate } = require('./codex/premium');
// Gemini CLI modules
const { GeminiProjectContext, detectGeminiVersion } = require('./gemini/context');
const { GEMINI_MCP_PACKS, recommendGeminiMcpPacks, getGeminiMcpPreflight, mergeGeminiMcpJson } = require('./gemini/mcp-packs');
const { GEMINI_DOMAIN_PACKS, detectGeminiDomainPacks } = require('./gemini/domain-packs');
const { buildGeminiProposalBundle } = require('./gemini/plans');
const { setupGemini } = require('./gemini/setup');
const { getGeminiGovernanceSummary } = require('./gemini/governance');
const {
  getGeminiHistory, formatGeminiHistory, compareGeminiLatest,
  exportGeminiTrendReport, recordGeminiFeedback, formatGeminiFeedback,
  generateGeminiInsights, formatGeminiInsights,
} = require('./gemini/activity');
const { patchGeminiMd, patchSettingsJson, detectMixedAgentRepo: detectMixedAgentRepoGemini } = require('./gemini/patch');
const { checkReleaseGate: checkGeminiReleaseGate, formatReleaseGate: formatGeminiReleaseGate } = require('./gemini/freshness');
const { runGeminiDeepReview, collectGeminiConfig } = require('./gemini/deep-review');
const { geminiInteractive } = require('./gemini/interactive');
const { composePacks: composeGeminiPacks, getCiTemplate: getGeminiCiTemplate, CI_TEMPLATES: GEMINI_CI_TEMPLATES, checkAdoptionGate: checkGeminiAdoptionGate } = require('./gemini/premium');
// Copilot modules
const { CopilotProjectContext } = require('./copilot/context');
const { COPILOT_MCP_PACKS, recommendCopilotMcpPacks, getCopilotMcpPreflight } = require('./copilot/mcp-packs');
const { COPILOT_DOMAIN_PACKS, detectCopilotDomainPacks } = require('./copilot/domain-packs');
const { buildCopilotProposalBundle } = require('./copilot/plans');
const { setupCopilot } = require('./copilot/setup');
const { getCopilotGovernanceSummary } = require('./copilot/governance');
const { getCopilotHistory, formatCopilotHistory, compareCopilotLatest, exportCopilotTrendReport, generateCopilotInsights } = require('./copilot/activity');
const { runCopilotDeepReview } = require('./copilot/deep-review');
const { copilotInteractive } = require('./copilot/interactive');
const { composePacks: composeCopilotPacks, getCiTemplate: getCopilotCiTemplate, CI_TEMPLATES: COPILOT_CI_TEMPLATES, checkAdoptionGate: checkCopilotAdoptionGate } = require('./copilot/premium');
// Cursor modules
const { CursorProjectContext } = require('./cursor/context');
const { CURSOR_MCP_PACKS, recommendCursorMcpPacks } = require('./cursor/mcp-packs');
const { CURSOR_DOMAIN_PACKS, detectCursorDomainPacks } = require('./cursor/domain-packs');
const { buildCursorProposalBundle } = require('./cursor/plans');
const { setupCursor } = require('./cursor/setup');
const { getCursorGovernanceSummary } = require('./cursor/governance');
const { getCursorHistory, compareCursorLatest, generateCursorInsights } = require('./cursor/activity');
const { runCursorDeepReview } = require('./cursor/deep-review');
const { cursorInteractive } = require('./cursor/interactive');
const { composePacks: composeCursorPacks, CI_TEMPLATES: CURSOR_CI_TEMPLATES, checkAdoptionGate: checkCursorAdoptionGate } = require('./cursor/premium');
// Windsurf
const { WindsurfProjectContext } = require('./windsurf/context');
const { WINDSURF_DOMAIN_PACKS, detectWindsurfDomainPacks } = require('./windsurf/domain-packs');
const { WINDSURF_MCP_PACKS } = require('./windsurf/mcp-packs');
const { setupWindsurf } = require('./windsurf/setup');
const { getWindsurfGovernanceSummary } = require('./windsurf/governance');
const { runWindsurfDeepReview } = require('./windsurf/deep-review');
const { windsurfInteractive } = require('./windsurf/interactive');
// Aider
const { AiderProjectContext } = require('./aider/context');
const { AIDER_DOMAIN_PACKS, detectAiderDomainPacks } = require('./aider/domain-packs');
const { setupAider } = require('./aider/setup');
const { getAiderGovernanceSummary } = require('./aider/governance');
const { runAiderDeepReview } = require('./aider/deep-review');
const { aiderInteractive } = require('./aider/interactive');
// OpenCode
const { OpenCodeProjectContext } = require('./opencode/context');
const { OPENCODE_DOMAIN_PACKS, detectOpenCodeDomainPacks } = require('./opencode/domain-packs');
const { OPENCODE_MCP_PACKS } = require('./opencode/mcp-packs');
const { setupOpenCode } = require('./opencode/setup');
const { getOpenCodeGovernanceSummary } = require('./opencode/governance');
const { runOpenCodeDeepReview } = require('./opencode/deep-review');
const { opencodeInteractive } = require('./opencode/interactive');
const { detectPlatforms, getCatalog, synergyReport } = require('./public-api');
const { buildServeOpenApiSpec, createServer, startServer } = require('./server');
const { DAILY_FRESHNESS_WORKFLOW, PLATFORM_CHANGE_MANIFEST, getPlatformChangeManifest, summarizePlatformChangeManifest } = require('./platform-change-manifest');

module.exports = {
  audit,
  setup,
  analyzeProject,
  buildProposalBundle,
  applyProposalBundle,
  getGovernanceSummary,
  runBenchmark,
  detectPlatforms,
  getCatalog,
  synergyReport,
  buildServeOpenApiSpec,
  createServer,
  startServer,
  DAILY_FRESHNESS_WORKFLOW,
  PLATFORM_CHANGE_MANIFEST,
  getPlatformChangeManifest,
  summarizePlatformChangeManifest,
  DOMAIN_PACKS,
  detectDomainPacks,
  MCP_PACKS,
  getMcpPack,
  mergeMcpServers,
  getMcpPackPreflight,
  recommendMcpPacks,
  recordRecommendationOutcome,
  getRecommendationOutcomeSummary,
  formatRecommendationOutcomeSummary,
  CodexProjectContext,
  detectCodexVersion,
  formatSarif,
  // Codex CP-03: MCP Packs
  CODEX_MCP_PACKS,
  recommendCodexMcpPacks,
  getCodexMcpPreflight,
  mergeCodexMcpToml,
  // Codex CP-05: Proposal Families
  buildCodexProposalBundle,
  // Codex CP-04: Setup Breadth
  setupCodex,
  // Codex CP-06: Repeat-Usage
  getCodexHistory,
  formatCodexHistory,
  compareCodexLatest,
  exportCodexTrendReport,
  recordCodexFeedback,
  formatCodexFeedback,
  generateCodexInsights,
  formatCodexInsights,
  // Codex CP-09: Patch Intelligence
  patchAgentsMd,
  patchConfigToml,
  detectMixedAgentRepo,
  applyPatch,
  // Codex CP-10: Governance
  getCodexGovernanceSummary,
  // Codex CP-12: Freshness
  checkReleaseGate,
  formatReleaseGate,
  getPropagationTargets,
  // Codex CP-13: Deep Review
  runCodexDeepReview,
  collectCodexConfig,
  buildCodexReviewPayload,
  // Codex CP-14: Interactive
  codexInteractive,
  // Codex CP-15: Premium
  composePacks,
  getCiTemplate,
  CI_TEMPLATES,
  checkAdoptionGate,
  // Gemini CLI
  GeminiProjectContext,
  detectGeminiVersion,
  GEMINI_MCP_PACKS,
  recommendGeminiMcpPacks,
  getGeminiMcpPreflight,
  mergeGeminiMcpJson,
  GEMINI_DOMAIN_PACKS,
  detectGeminiDomainPacks,
  buildGeminiProposalBundle,
  setupGemini,
  getGeminiGovernanceSummary,
  getGeminiHistory,
  formatGeminiHistory,
  compareGeminiLatest,
  exportGeminiTrendReport,
  recordGeminiFeedback,
  formatGeminiFeedback,
  generateGeminiInsights,
  formatGeminiInsights,
  patchGeminiMd,
  patchSettingsJson,
  detectMixedAgentRepoGemini,
  checkGeminiReleaseGate,
  formatGeminiReleaseGate,
  runGeminiDeepReview,
  collectGeminiConfig,
  geminiInteractive,
  composeGeminiPacks,
  getGeminiCiTemplate,
  GEMINI_CI_TEMPLATES,
  checkGeminiAdoptionGate,
  // Copilot
  CopilotProjectContext,
  COPILOT_MCP_PACKS,
  recommendCopilotMcpPacks,
  getCopilotMcpPreflight,
  COPILOT_DOMAIN_PACKS,
  detectCopilotDomainPacks,
  buildCopilotProposalBundle,
  setupCopilot,
  getCopilotGovernanceSummary,
  getCopilotHistory,
  formatCopilotHistory,
  compareCopilotLatest,
  exportCopilotTrendReport,
  generateCopilotInsights,
  runCopilotDeepReview,
  copilotInteractive,
  composeCopilotPacks,
  getCopilotCiTemplate,
  COPILOT_CI_TEMPLATES,
  checkCopilotAdoptionGate,
  // Cursor
  CursorProjectContext, CURSOR_MCP_PACKS, recommendCursorMcpPacks,
  CURSOR_DOMAIN_PACKS, detectCursorDomainPacks, buildCursorProposalBundle,
  setupCursor, getCursorGovernanceSummary, getCursorHistory,
  compareCursorLatest, generateCursorInsights, runCursorDeepReview,
  cursorInteractive, composeCursorPacks, CURSOR_CI_TEMPLATES, checkCursorAdoptionGate,
  // Windsurf
  WindsurfProjectContext, WINDSURF_DOMAIN_PACKS, detectWindsurfDomainPacks, WINDSURF_MCP_PACKS,
  setupWindsurf, getWindsurfGovernanceSummary, runWindsurfDeepReview, windsurfInteractive,
  // Aider
  AiderProjectContext, AIDER_DOMAIN_PACKS, detectAiderDomainPacks,
  setupAider, getAiderGovernanceSummary, runAiderDeepReview, aiderInteractive,
  // OpenCode
  OpenCodeProjectContext, OPENCODE_DOMAIN_PACKS, detectOpenCodeDomainPacks, OPENCODE_MCP_PACKS,
  setupOpenCode, getOpenCodeGovernanceSummary, runOpenCodeDeepReview, opencodeInteractive,
  // Harmony (cross-platform)
  ...(() => {
    const { buildCanonicalModel, detectActivePlatforms } = require('./harmony/canon');
    const { detectDrift, formatDriftReport } = require('./harmony/drift');
    const { harmonyAudit, formatHarmonyAuditReport } = require('./harmony/audit');
    const { generateHarmonySync, applyHarmonySync, previewHarmonySync } = require('./harmony/sync');
    const { generateStrategicAdvice, PLATFORM_STRENGTHS } = require('./harmony/advisor');
    const { startHarmonyWatch } = require('./harmony/watch');
    const { saveHarmonyState, loadHarmonyState, getHarmonyHistory } = require('./harmony/memory');
    const { getHarmonyGovernanceSummary, formatHarmonyGovernanceReport } = require('./harmony/governance');
    const { getHarmonyBadgeUrl, getHarmonyBadgeMarkdown } = require('./harmony/cli');
    return {
      buildCanonicalModel, detectActivePlatforms, detectDrift, formatDriftReport,
      harmonyAudit, formatHarmonyAuditReport,
      generateHarmonySync, applyHarmonySync, previewHarmonySync,
      generateStrategicAdvice, PLATFORM_STRENGTHS,
      startHarmonyWatch, saveHarmonyState, loadHarmonyState, getHarmonyHistory,
      getHarmonyGovernanceSummary, formatHarmonyGovernanceReport,
      getHarmonyBadgeUrl, getHarmonyBadgeMarkdown,
    };
  })(),
  // Synergy (cross-platform amplification)
  ...(() => {
    const { propagateInsight, getCrossLearnings } = require('./synergy/learning');
    const { routeTask, classifyTaskType, PLATFORM_CAPABILITIES } = require('./synergy/routing');
    const { compoundAudit, calculateAmplification } = require('./synergy/evidence');
    const { analyzeCompensation, getUncoveredGaps } = require('./synergy/compensation');
    const { discoverPatterns } = require('./synergy/patterns');
    const { rankRecommendations, calculateSynergyScore } = require('./synergy/ranking');
    const { generateSynergyReport } = require('./synergy/report');
    const { detectProjectChanges, generateAdaptiveUpdates } = require('./synergy/adaptive');
    return {
      propagateInsight, getCrossLearnings, routeTask, classifyTaskType, PLATFORM_CAPABILITIES,
      compoundAudit, calculateAmplification, analyzeCompensation, getUncoveredGaps,
      discoverPatterns, rankRecommendations, calculateSynergyScore,
      generateSynergyReport, detectProjectChanges, generateAdaptiveUpdates,
    };
  })(),
};
