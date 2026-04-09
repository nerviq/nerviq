const fs = require('fs');
const path = require('path');

const PATH_ACTIONS = new Set(['read', 'write', 'edit', 'multiedit']);
const SECRET_PATH_RE = /(^|\/)(\.env(?:[^/]*)?|secrets?)(\/|$)/i;

function normalizeSlash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function stripWrappingQuotes(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function getProjectRoot(rootDir) {
  try {
    return fs.realpathSync.native(rootDir);
  } catch {
    return path.resolve(rootDir);
  }
}

function splitPatternSegments(rawPattern, isAbsolute) {
  const normalized = normalizeSlash(rawPattern);

  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized.slice(3).split('/').filter(Boolean);
  }

  if (isAbsolute && normalized.startsWith('/')) {
    return normalized.slice(1).split('/').filter(Boolean);
  }

  return normalized.split('/').filter((segment) => segment && segment !== '.');
}

function hasGlob(segment) {
  return /[*?[\]{}]/.test(segment);
}

function buildAbsolutePattern(rootDir, rawPattern) {
  const normalized = stripWrappingQuotes(normalizeSlash(rawPattern).replace(/^file:\/\//i, ''));
  if (!normalized) {
    return {
      absolutePattern: null,
      normalizedInput: '',
      isAbsolute: false,
      traversalSegments: false,
    };
  }

  const isAbsolute = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('/');
  const traversalSegments = normalized.split('/').some((segment) => segment === '..');
  const segments = splitPatternSegments(normalized, isAbsolute);
  let current = isAbsolute ? path.parse(path.resolve(normalized)).root : getProjectRoot(rootDir);

  for (const segment of segments) {
    const candidate = path.join(current, segment);
    if (hasGlob(segment)) {
      current = candidate;
      continue;
    }

    try {
      current = fs.realpathSync.native(candidate);
    } catch {
      current = candidate;
    }
  }

  return {
    absolutePattern: current,
    normalizedInput: normalized,
    isAbsolute,
    traversalSegments,
  };
}

function normalizePathPayload(rawPayload, rootDir) {
  const {
    absolutePattern,
    normalizedInput,
    isAbsolute,
    traversalSegments,
  } = buildAbsolutePattern(rootDir, rawPayload);

  if (!absolutePattern) {
    return {
      normalizedPath: '',
      repoRelativePath: '',
      outsideRepo: false,
      invalid: true,
      isAbsolute,
      traversalSegments,
    };
  }

  const projectRoot = getProjectRoot(rootDir);
  const relativePath = normalizeSlash(path.relative(projectRoot, absolutePattern));
  const outsideRepo = relativePath === '..' || relativePath.startsWith('../') || /^[A-Za-z]:\//.test(relativePath);
  const repoRelativePath = outsideRepo ? null : relativePath || '.';
  const normalizedPath = outsideRepo
    ? normalizeSlash(absolutePattern)
    : `./${repoRelativePath}`;

  return {
    normalizedPath,
    repoRelativePath,
    outsideRepo,
    invalid: traversalSegments && outsideRepo && !isAbsolute,
    isAbsolute,
    traversalSegments,
    normalizedInput,
  };
}

function normalizeCommandPayload(rawPayload) {
  return stripWrappingQuotes(rawPayload).replace(/\s+/g, ' ').trim();
}

function normalizePermissionRule(rule, rootDir) {
  if (typeof rule !== 'string' || !rule.trim()) return null;
  const trimmed = rule.trim();
  const match = trimmed.match(/^([A-Za-z]+)\((.*)\)$/);
  if (!match) {
    return {
      raw: trimmed,
      action: null,
      payload: trimmed,
      normalized: trimmed,
      dedupeKey: trimmed.toLowerCase(),
      kind: 'raw',
      invalid: false,
      outsideRepo: false,
      protectsSecrets: false,
    };
  }

  const action = match[1];
  const payload = match[2].trim();
  const actionKey = action.toLowerCase();

  if (PATH_ACTIONS.has(actionKey)) {
    const details = normalizePathPayload(payload, rootDir);
    const dedupeKey = `${actionKey}:${details.normalizedPath.toLowerCase()}`;
    return {
      raw: trimmed,
      action,
      payload,
      normalized: `${action}(${details.normalizedPath})`,
      normalizedPath: details.normalizedPath,
      repoRelativePath: details.repoRelativePath,
      dedupeKey,
      kind: 'path',
      invalid: details.invalid,
      outsideRepo: details.outsideRepo,
      traversalSegments: details.traversalSegments,
      isAbsolute: details.isAbsolute,
      protectsSecrets: !details.outsideRepo && SECRET_PATH_RE.test(details.repoRelativePath || ''),
    };
  }

  const normalizedPayload = normalizeCommandPayload(payload);
  return {
    raw: trimmed,
    action,
    payload,
    normalized: `${action}(${normalizedPayload})`,
    dedupeKey: `${actionKey}:${normalizedPayload.toLowerCase()}`,
    kind: 'command',
    invalid: false,
    outsideRepo: false,
    protectsSecrets: false,
  };
}

function normalizePermissionRules(rules, rootDir) {
  const seen = new Set();
  const normalized = [];

  for (const rule of Array.isArray(rules) ? rules : []) {
    const entry = normalizePermissionRule(rule, rootDir);
    if (!entry || entry.invalid) continue;
    if (seen.has(entry.dedupeKey)) continue;
    seen.add(entry.dedupeKey);
    normalized.push(entry);
  }

  return normalized;
}

function collectClaudeDenyRules(ctx) {
  const shared = ctx.jsonFile('.claude/settings.json');
  const local = ctx.jsonFile('.claude/settings.local.json');
  const denyRules = []
    .concat(shared?.permissions?.deny || [])
    .concat(local?.permissions?.deny || []);

  return normalizePermissionRules(denyRules, ctx.dir);
}

function hasSecretDenyRule(rules) {
  return (Array.isArray(rules) ? rules : []).some((rule) => rule && rule.protectsSecrets);
}

module.exports = {
  collectClaudeDenyRules,
  hasSecretDenyRule,
  normalizePermissionRule,
  normalizePermissionRules,
};
