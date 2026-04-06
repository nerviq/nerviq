/**
 * Team profiles — save and share org-specific check weights and preferences.
 */

const fs = require('fs');
const path = require('path');

const PROFILES_DIR = 'profiles';

function profilesDir(dir) {
  return path.join(dir, '.nerviq', PROFILES_DIR);
}

function profilePath(dir, name) {
  return path.join(profilesDir(dir), `${name}.json`);
}

function validateProfileName(name) {
  if (!name || typeof name !== 'string') throw new Error('Profile name is required.');
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid profile name '${name}'. Use only letters, numbers, hyphens, and underscores.`);
  }
  if (name.length > 64) throw new Error('Profile name must be 64 characters or fewer.');
}

function saveProfile(dir, profileName, options = {}) {
  validateProfileName(profileName);
  const profileDir = profilesDir(dir);
  fs.mkdirSync(profileDir, { recursive: true });

  const profile = {
    name: profileName,
    created: new Date().toISOString().split('T')[0],
    platforms: options.platforms || ['claude'],
    threshold: options.threshold != null ? Number(options.threshold) : 70,
    suppressedChecks: options.suppressedChecks || [],
    priorityBoosts: options.priorityBoosts || [],
    customWeights: options.customWeights || {},
    description: options.description || '',
  };

  const filePath = profilePath(dir, profileName);
  fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8');
  return { saved: true, path: filePath, profile };
}

function loadProfile(dir, profileName) {
  validateProfileName(profileName);
  const filePath = profilePath(dir, profileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Profile '${profileName}' not found. Run 'nerviq profile list' to see available profiles.`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  let profile;
  try {
    profile = JSON.parse(raw);
  } catch {
    throw new Error(`Profile '${profileName}' contains invalid JSON.`);
  }
  return profile;
}

function listProfiles(dir) {
  const profDir = profilesDir(dir);
  if (!fs.existsSync(profDir)) return [];
  return fs.readdirSync(profDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const name = f.replace(/\.json$/, '');
      try {
        const data = JSON.parse(fs.readFileSync(path.join(profDir, f), 'utf8'));
        return { name, description: data.description || '', platforms: data.platforms || [], threshold: data.threshold };
      } catch {
        return { name, description: '(invalid)', platforms: [], threshold: null };
      }
    });
}

function exportProfile(dir, profileName) {
  const profile = loadProfile(dir, profileName);
  return JSON.stringify(profile, null, 2);
}

function applyProfileToOptions(profile, options) {
  const merged = { ...options };
  if (profile.threshold != null && merged.threshold == null) {
    merged.threshold = profile.threshold;
  }
  if (profile.platforms && profile.platforms.length > 0 && !options.platform) {
    merged.platform = profile.platforms[0];
  }
  merged.suppressedChecks = profile.suppressedChecks || [];
  merged.priorityBoosts = profile.priorityBoosts || [];
  merged.customWeights = profile.customWeights || {};
  return merged;
}

function formatProfileList(profiles) {
  if (profiles.length === 0) return '  No profiles found. Create one with: nerviq profile save <name>';
  const lines = profiles.map(p => {
    const desc = p.description ? ` — ${p.description}` : '';
    const plats = p.platforms.length > 0 ? ` [${p.platforms.join(', ')}]` : '';
    return `  ${p.name}${plats}${desc}`;
  });
  return lines.join('\n');
}

function formatProfile(profile) {
  const lines = [
    `  Name:        ${profile.name}`,
    `  Created:     ${profile.created || 'unknown'}`,
    `  Platforms:   ${(profile.platforms || []).join(', ') || 'any'}`,
    `  Threshold:   ${profile.threshold != null ? profile.threshold : 'default'}`,
    `  Suppressed:  ${(profile.suppressedChecks || []).join(', ') || 'none'}`,
    `  Boosted:     ${(profile.priorityBoosts || []).join(', ') || 'none'}`,
    `  Description: ${profile.description || '(none)'}`,
  ];
  return lines.join('\n');
}

module.exports = { saveProfile, loadProfile, listProfiles, exportProfile, applyProfileToOptions, formatProfileList, formatProfile, validateProfileName };
