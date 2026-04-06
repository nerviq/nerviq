const fs = require('fs');
const path = require('path');

const PROJECT_STATE_ROOT = ['.nerviq'];
const LEGACY_PROJECT_STATE_ROOT = ['.claude', 'nerviq-cli'];
const HARMONY_STATE_ROOT = ['.nerviq', 'harmony'];
const LEGACY_HARMONY_STATE_ROOT = ['.nerviq', 'harmony'];
const GEMINI_STATE_ROOT = ['.gemini', '.nerviq'];
const LEGACY_GEMINI_STATE_ROOT = ['.gemini', '.nerviq'];

function buildPath(dir, rootSegments, segments) {
  return path.join(dir, ...rootSegments, ...segments);
}

function resolveReadablePath(dir, preferredRoot, legacyRoot, ...segments) {
  const preferredPath = buildPath(dir, preferredRoot, segments);
  if (fs.existsSync(preferredPath)) return preferredPath;

  const legacyPath = buildPath(dir, legacyRoot, segments);
  if (fs.existsSync(legacyPath)) return legacyPath;

  return preferredPath;
}

function ensureWritableDir(dir, rootSegments, ...segments) {
  const targetPath = buildPath(dir, rootSegments, segments);
  fs.mkdirSync(targetPath, { recursive: true });
  return targetPath;
}

function resolveProjectStatePath(dir, ...segments) {
  return buildPath(dir, PROJECT_STATE_ROOT, segments);
}

function resolveProjectStateReadPath(dir, ...segments) {
  return resolveReadablePath(dir, PROJECT_STATE_ROOT, LEGACY_PROJECT_STATE_ROOT, ...segments);
}

function ensureProjectStateDir(dir, ...segments) {
  return ensureWritableDir(dir, PROJECT_STATE_ROOT, ...segments);
}

function resolveHarmonyStatePath(dir, ...segments) {
  return buildPath(dir, HARMONY_STATE_ROOT, segments);
}

function resolveHarmonyStateReadPath(dir, ...segments) {
  return resolveReadablePath(dir, HARMONY_STATE_ROOT, LEGACY_HARMONY_STATE_ROOT, ...segments);
}

function ensureHarmonyStateDir(dir, ...segments) {
  return ensureWritableDir(dir, HARMONY_STATE_ROOT, ...segments);
}

function resolveGeminiStatePath(dir, ...segments) {
  return buildPath(dir, GEMINI_STATE_ROOT, segments);
}

function resolveGeminiStateReadPath(dir, ...segments) {
  return resolveReadablePath(dir, GEMINI_STATE_ROOT, LEGACY_GEMINI_STATE_ROOT, ...segments);
}

function ensureGeminiStateDir(dir, ...segments) {
  return ensureWritableDir(dir, GEMINI_STATE_ROOT, ...segments);
}

module.exports = {
  PROJECT_STATE_ROOT,
  LEGACY_PROJECT_STATE_ROOT,
  HARMONY_STATE_ROOT,
  LEGACY_HARMONY_STATE_ROOT,
  GEMINI_STATE_ROOT,
  LEGACY_GEMINI_STATE_ROOT,
  resolveReadablePath,
  ensureWritableDir,
  resolveProjectStatePath,
  resolveProjectStateReadPath,
  ensureProjectStateDir,
  resolveHarmonyStatePath,
  resolveHarmonyStateReadPath,
  ensureHarmonyStateDir,
  resolveGeminiStatePath,
  resolveGeminiStateReadPath,
  ensureGeminiStateDir,
};
