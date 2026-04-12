/**
 * Copilot config parser.
 *
 * Copilot uses JSON for .vscode/settings.json and .vscode/mcp.json,
 * plus YAML frontmatter in *.instructions.md and *.prompt.md files.
 * This module handles both formats with unified value extraction.
 */

// ─── JSON parsing ────────────────────────────────────────────────────────────

function tryParseJson(content) {
  try {
    const data = JSON.parse(content);
    return { ok: true, data, error: null };
  } catch (error) {
    // VS Code settings.json and mcp.json are JSONC: they officially permit
    // // and /* */ comments plus trailing commas. Re-try after stripping
    // these before reporting the file as invalid JSON.
    try {
      const stripped = stripJsonc(content);
      const data = JSON.parse(stripped);
      return { ok: true, data, error: null, jsonc: true };
    } catch (_jsoncError) {
      return { ok: false, data: null, error: error.message };
    }
  }
}

function stripJsonc(input) {
  if (typeof input !== 'string') return input;
  let out = '';
  let i = 0;
  let inString = false;
  let stringChar = '';
  while (i < input.length) {
    const ch = input[i];
    const next = input[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < input.length) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === stringChar) inString = false;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      // Line comment
      const end = input.indexOf('\n', i);
      i = end === -1 ? input.length : end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = input.indexOf('*/', i + 2);
      i = end === -1 ? input.length : end + 2;
      continue;
    }
    out += ch;
    i++;
  }
  // Remove trailing commas before } or ]
  return out.replace(/,(\s*[}\]])/g, '$1');
}

// ─── YAML frontmatter parsing ────────────────────────────────────────────────

/**
 * Extract YAML frontmatter from a markdown file.
 * Frontmatter is delimited by --- at the start of the file.
 * Returns { frontmatter: object|null, body: string, raw: string|null }
 */
function extractFrontmatter(content) {
  if (!content || typeof content !== 'string') {
    return { frontmatter: null, body: content || '', raw: null };
  }

  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: null, body: content, raw: null };
  }

  const endIdx = trimmed.indexOf('---', 3);
  if (endIdx === -1) {
    return { frontmatter: null, body: content, raw: null };
  }

  const raw = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 3).trim();
  const frontmatter = parseSimpleYaml(raw);

  return { frontmatter, body, raw };
}

/**
 * Minimal YAML parser for frontmatter fields.
 * Handles: key: value, key: [item1, item2], key: "quoted", booleans, numbers.
 * Does NOT handle nested objects or multi-line values (use a full YAML parser for those).
 */
function parseSimpleYaml(yamlStr) {
  if (!yamlStr || typeof yamlStr !== 'string') return {};

  const result = {};
  const lines = yamlStr.split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) continue;

    const colonIdx = trimmedLine.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmedLine.slice(0, colonIdx).trim();
    let value = trimmedLine.slice(colonIdx + 1).trim();

    if (!key) continue;

    // Parse value
    if (value === '') {
      result[key] = null;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      // Inline array: [item1, item2]
      const inner = value.slice(1, -1).trim();
      if (!inner) {
        result[key] = [];
      } else {
        result[key] = inner.split(',').map(item => {
          const t = item.trim();
          return stripQuotes(t);
        });
      }
    } else if ((value.startsWith('"') && value.endsWith('"')) ||
               (value.startsWith("'") && value.endsWith("'"))) {
      result[key] = value.slice(1, -1);
    } else if (value === 'true') {
      result[key] = true;
    } else if (value === 'false') {
      result[key] = false;
    } else if (/^-?\d+$/.test(value)) {
      result[key] = parseInt(value, 10);
    } else if (/^-?\d+\.\d+$/.test(value)) {
      result[key] = parseFloat(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function stripQuotes(str) {
  if ((str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  return str;
}

// ─── Value extraction ────────────────────────────────────────────────────────

function getValueByPath(obj, dottedPath) {
  if (!obj) return undefined;
  const parts = dottedPath.split('.').filter(Boolean);
  let cursor = obj;
  for (const part of parts) {
    if (cursor == null || typeof cursor !== 'object' || !(part in cursor)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

// ─── Validation ──────────────────────────────────────────────────────────────

const KNOWN_COPILOT_SETTINGS_KEYS = new Set([
  'github.copilot.chat.agent.enabled',
  'github.copilot.chat.codeGeneration.instructions',
  'github.copilot.chat.reviewSelection.instructions',
  'github.copilot.chat.commitMessageGeneration.instructions',
  'github.copilot.chat.pullRequestDescriptionGeneration.instructions',
  'chat.instructionsFilesLocations',
  'chat.tools.terminal.sandbox.enabled',
  'chat.agent.autoApproval.terminalCommands',
  'chat.agent.autoApproval.tools',
  'github.copilot.enable',
  'github.copilot.advanced',
]);

const DEPRECATED_COPILOT_KEYS = new Map([
  ['github.copilot.chat.codeGeneration.instructions', 'Deprecated since VS Code 1.102. Use .github/instructions/*.instructions.md instead.'],
]);

/**
 * Validate VS Code settings.json keys for Copilot-specific settings.
 * @param {object} data - Parsed settings object.
 * @returns {{ unknown: string[], deprecated: Array<{key: string, message: string}>, copilotKeys: string[] }}
 */
function validateCopilotSettingsKeys(data) {
  if (!data || typeof data !== 'object') {
    return { unknown: [], deprecated: [], copilotKeys: [] };
  }

  const copilotKeys = [];
  const deprecated = [];

  function walk(obj, prefix) {
    for (const key of Object.keys(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;

      // Only track copilot-related keys
      if (fullKey.startsWith('github.copilot') || fullKey.startsWith('chat.')) {
        copilotKeys.push(fullKey);
      }

      if (DEPRECATED_COPILOT_KEYS.has(fullKey)) {
        deprecated.push({ key: fullKey, message: DEPRECATED_COPILOT_KEYS.get(fullKey) });
      }

      if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        walk(obj[key], fullKey);
      }
    }
  }

  walk(data, '');
  return { unknown: [], deprecated, copilotKeys };
}

/**
 * Validate .prompt.md frontmatter for required fields.
 * Valid fields: description, agent, model, tools, mode.
 */
function validatePromptFrontmatter(frontmatter) {
  if (!frontmatter) return { valid: false, errors: ['No frontmatter found'] };

  const errors = [];
  const VALID_PROMPT_FIELDS = new Set(['description', 'agent', 'model', 'tools', 'mode']);

  for (const key of Object.keys(frontmatter)) {
    if (!VALID_PROMPT_FIELDS.has(key)) {
      errors.push(`Unknown prompt frontmatter field: "${key}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate .instructions.md frontmatter for required applyTo field.
 */
function validateInstructionFrontmatter(frontmatter) {
  if (!frontmatter) return { valid: false, errors: ['No frontmatter found'] };

  const errors = [];

  if (!frontmatter.applyTo) {
    errors.push('Missing required "applyTo" glob pattern in frontmatter');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  tryParseJson,
  extractFrontmatter,
  parseSimpleYaml,
  getValueByPath,
  validateCopilotSettingsKeys,
  validatePromptFrontmatter,
  validateInstructionFrontmatter,
};
