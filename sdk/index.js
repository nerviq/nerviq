const path = require('path');

function loadCore() {
  try {
    return require('@nerviq/cli');
  } catch {
    return require('..');
  }
}

function resolveDir(dir) {
  return path.resolve(dir || '.');
}

async function audit(dir, platform = 'claude') {
  const core = loadCore();
  const result = await core.audit({
    dir: resolveDir(dir),
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
  const core = loadCore();
  const result = await core.harmonyAudit({
    dir: resolveDir(dir),
    silent: true,
  });
  // Add convenience alias for SDK consumers
  if (result) {
    result.average = result.harmonyScore;
  }
  return result;
}

async function synergyReport(dir) {
  const core = loadCore();
  return core.synergyReport(resolveDir(dir));
}

function detectPlatforms(dir) {
  const core = loadCore();
  return core.detectPlatforms(resolveDir(dir));
}

function getCatalog() {
  const core = loadCore();
  return core.getCatalog();
}

function routeTask(description, platforms) {
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
