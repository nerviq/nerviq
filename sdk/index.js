const path = require('path');
const fs = require('fs');

const VALID_PLATFORMS = ['claude', 'codex', 'cursor', 'copilot', 'gemini', 'windsurf', 'aider', 'opencode'];

function loadCore() {
  try {
    return require('@nerviq/cli');
  } catch {
    return require('..');
  }
}

function validateDir(dir) {
  if (!dir || typeof dir !== 'string') {
    throw new Error('dir is required and must be a string. Pass a valid directory path.');
  }
  const resolved = path.resolve(dir);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory not found: ${resolved}. Pass an existing directory path.`);
  }
  return resolved;
}

function validatePlatform(platform) {
  if (platform && !VALID_PLATFORMS.includes(platform)) {
    throw new Error(`Unsupported platform '${platform}'. Use one of: ${VALID_PLATFORMS.join(', ')}`);
  }
}

async function audit(dir, platform = 'claude') {
  const resolved = validateDir(dir);
  validatePlatform(platform);
  const core = loadCore();
  const result = await core.audit({
    dir: resolved,
    platform,
    silent: true,
  });
  // Add convenience aliases for SDK consumers
  if (result) {
    result.passing = result.passed;
    result.total = (result.passed || 0) + (result.failed || 0);
  }
  return result;
}

async function harmonyAudit(dir) {
  const resolved = validateDir(dir);
  const core = loadCore();
  const result = await core.harmonyAudit({
    dir: resolved,
    silent: true,
  });
  // Add convenience alias for SDK consumers
  if (result) {
    result.average = result.harmonyScore;
  }
  return result;
}

async function synergyReport(dir) {
  const resolved = validateDir(dir);
  const core = loadCore();
  return core.synergyReport(resolved);
}

function detectPlatforms(dir) {
  const resolved = validateDir(dir);
  const core = loadCore();
  return core.detectPlatforms(resolved);
}

function getCatalog() {
  const core = loadCore();
  return core.getCatalog();
}

function routeTask(description, platforms) {
  if (!description || typeof description !== 'string') {
    throw new Error('description is required and must be a non-empty string.');
  }
  const core = loadCore();
  return core.routeTask(description, platforms || []);
}

module.exports = {
  audit,
  harmonyAudit,
  synergyReport,
  detectPlatforms,
  getCatalog,
  routeTask,
};
