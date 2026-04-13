/**
 * Plugin system for Nerviq.
 * Allows users to extend audits with custom checks via nerviq.config.js.
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_CHECK_FIELDS = ['id', 'name', 'check', 'impact', 'category', 'fix'];
const VALID_IMPACTS = ['critical', 'high', 'medium', 'low'];

/**
 * Validate a single plugin object.
 * Returns { valid: true } or { valid: false, errors: [...] }.
 */
function validatePlugin(plugin) {
  const errors = [];

  if (!plugin || typeof plugin !== 'object') {
    return { valid: false, errors: ['Plugin must be a non-null object'] };
  }

  if (!plugin.name || typeof plugin.name !== 'string') {
    errors.push('Plugin must have a non-empty string "name" field');
  }

  if (!plugin.checks || typeof plugin.checks !== 'object' || Array.isArray(plugin.checks)) {
    errors.push('Plugin must have a "checks" object');
    return { valid: false, errors };
  }

  for (const [key, check] of Object.entries(plugin.checks)) {
    for (const field of REQUIRED_CHECK_FIELDS) {
      if (check[field] === undefined || check[field] === null) {
        errors.push(`Check "${key}" is missing required field "${field}"`);
      }
    }

    if (typeof check.check !== 'function') {
      errors.push(`Check "${key}" field "check" must be a function`);
    }

    if (check.impact && !VALID_IMPACTS.includes(check.impact)) {
      errors.push(`Check "${key}" has invalid impact "${check.impact}". Must be one of: ${VALID_IMPACTS.join(', ')}`);
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

/**
 * Load plugins from nerviq.config.js in the given directory.
 * Returns an array of plugin objects, or [] if no config file exists.
 */
function loadPlugins(dir) {
  const configPath = path.join(dir, 'nerviq.config.js');

  if (!fs.existsSync(configPath)) {
    return [];
  }

  let config;
  try {
    config = require(configPath);
  } catch (err) {
    console.error(`Failed to load nerviq.config.js: ${err.message}`);
    return [];
  }

  if (!config || !Array.isArray(config.plugins)) {
    return [];
  }

  const validPlugins = [];
  for (const plugin of config.plugins) {
    const result = validatePlugin(plugin);
    if (result.valid) {
      validPlugins.push(plugin);
    } else {
      console.error(`Plugin "${plugin && plugin.name || 'unknown'}" is invalid: ${result.errors.join('; ')}`);
    }
  }

  return validPlugins;
}

/**
 * Merge plugin checks into the existing techniques object.
 * Plugin checks are prefixed with "plugin:" to avoid key collisions.
 * Returns a new merged techniques object (does not mutate the original).
 */
function mergePluginChecks(techniques, plugins) {
  const { LAYERS, assignLayers } = require('./audit/layers');
  const merged = { ...techniques };

  for (const plugin of plugins) {
    for (const [key, check] of Object.entries(plugin.checks)) {
      const prefixedKey = `plugin:${plugin.name}:${key}`;
      merged[prefixedKey] = {
        ...check,
        pluginName: plugin.name,
        sourceUrl: check.sourceUrl || null,
        confidence: check.confidence !== undefined ? check.confidence : 0.5,
      };
    }
  }

  // CTO-08 — plugins may not set a layer. Default their checks to
  // governance (drift/hygiene heuristics still apply via name).
  assignLayers(merged, LAYERS.GOVERNANCE);

  return merged;
}

module.exports = { loadPlugins, mergePluginChecks, validatePlugin };
