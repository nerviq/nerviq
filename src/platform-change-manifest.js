'use strict';

const claudeFreshness = require('./freshness');
const codexFreshness = require('./codex/freshness');
const cursorFreshness = require('./cursor/freshness');
const copilotFreshness = require('./copilot/freshness');
const geminiFreshness = require('./gemini/freshness');
const windsurfFreshness = require('./windsurf/freshness');
const aiderFreshness = require('./aider/freshness');
const opencodeFreshness = require('./opencode/freshness');

const DAILY_FRESHNESS_WORKFLOW = {
  workflow: '.github/workflows/freshness-check.yml',
  cadence: 'Daily at 06:00 UTC plus manual dispatch',
  issuePolicy: 'Open or refresh GitHub issues for stale P0 sources without failing the main CI pipeline.',
};

const PLATFORM_CHANGE_MANIFEST = [
  { key: 'claude', label: 'Claude Code', modulePath: 'src/freshness.js', freshness: claudeFreshness },
  { key: 'codex', label: 'Codex', modulePath: 'src/codex/freshness.js', freshness: codexFreshness },
  { key: 'cursor', label: 'Cursor', modulePath: 'src/cursor/freshness.js', freshness: cursorFreshness },
  { key: 'copilot', label: 'Copilot', modulePath: 'src/copilot/freshness.js', freshness: copilotFreshness },
  { key: 'gemini', label: 'Gemini CLI', modulePath: 'src/gemini/freshness.js', freshness: geminiFreshness },
  { key: 'windsurf', label: 'Windsurf', modulePath: 'src/windsurf/freshness.js', freshness: windsurfFreshness },
  { key: 'aider', label: 'Aider', modulePath: 'src/aider/freshness.js', freshness: aiderFreshness },
  { key: 'opencode', label: 'OpenCode', modulePath: 'src/opencode/freshness.js', freshness: opencodeFreshness },
].map((entry) => {
  const sources = (entry.freshness.P0_SOURCES || []).map((source) => ({
    key: source.key,
    label: source.label,
    url: source.url,
    stalenessThresholdDays: source.stalenessThresholdDays,
    verifiedAt: source.verifiedAt || null,
  }));
  const thresholds = [...new Set(sources.map((source) => source.stalenessThresholdDays))].sort((a, b) => a - b);

  return {
    key: entry.key,
    label: entry.label,
    modulePath: entry.modulePath,
    trackedSources: sources,
    trackedSourceCount: sources.length,
    reviewCadence: {
      automation: DAILY_FRESHNESS_WORKFLOW.cadence,
      thresholdsDays: thresholds,
      manualExpectation: thresholds.includes(14)
        ? 'Review high-volatility sources weekly and verify any stale source immediately.'
        : 'Review sources at least monthly and verify any stale source immediately.',
    },
    freshnessWorkflow: {
      ...DAILY_FRESHNESS_WORKFLOW,
      manualTrigger: true,
    },
    updateTriggers: (entry.freshness.PROPAGATION_CHECKLIST || []).map((item) => ({
      trigger: item.trigger,
      targets: item.targets || [],
    })),
  };
});

function getPlatformChangeManifest() {
  return JSON.parse(JSON.stringify(PLATFORM_CHANGE_MANIFEST));
}

function summarizePlatformChangeManifest() {
  const manifest = getPlatformChangeManifest();
  return {
    platformCount: manifest.length,
    trackedSourceCount: manifest.reduce((sum, entry) => sum + entry.trackedSourceCount, 0),
    workflow: DAILY_FRESHNESS_WORKFLOW,
    platforms: manifest.map((entry) => ({
      key: entry.key,
      label: entry.label,
      trackedSourceCount: entry.trackedSourceCount,
      thresholdDays: entry.reviewCadence.thresholdsDays,
      updateTriggerCount: entry.updateTriggers.length,
    })),
  };
}

module.exports = {
  DAILY_FRESHNESS_WORKFLOW,
  PLATFORM_CHANGE_MANIFEST,
  getPlatformChangeManifest,
  summarizePlatformChangeManifest,
};
