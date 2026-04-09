'use strict';

const TERMINOLOGY = {
  governance: {
    label: 'governance',
    description: 'the rollout safety layer: permissions, hooks, profiles, and policy packs',
  },
  hooks: {
    label: 'hooks',
    description: 'auto-run checks or scripts triggered before or after agent tool actions',
  },
  denyRules: {
    label: 'deny rules',
    description: 'explicit blocks for risky reads or commands like .env access or rm -rf',
  },
  mcp: {
    label: 'MCP',
    description: 'live external tool connectors for docs, APIs, databases, and other systems',
  },
};

const TERM_ORDER = ['governance', 'hooks', 'denyRules', 'mcp'];

function normalizeTermKeys(keys = []) {
  const seen = new Set();
  for (const key of keys) {
    if (!TERMINOLOGY[key]) continue;
    seen.add(key);
  }
  return TERM_ORDER.filter((key) => seen.has(key));
}

function collectAuditTerminology(result = {}) {
  const terms = new Set();
  const texts = [];

  for (const item of result.topNextActions || []) {
    texts.push(item.name || '', item.fix || '', item.why || '', item.module || '', ...(item.signals || []));
  }

  for (const item of result.results || []) {
    if (item.passed === false) {
      texts.push(item.key || '', item.name || '', item.fix || '', item.category || '');
    }
  }

  const blob = texts.join('\n');
  if (/\bhook/i.test(blob)) terms.add('hooks');
  if (/\bdeny rules?\b|permissions?\.deny|bypasspermissions|\.env access|rm -rf/i.test(blob)) terms.add('denyRules');
  if (/\bmcp\b|context7|external tool/i.test(blob)) terms.add('mcp');
  if (/\bgovernance\b|policy pack|permission profile/i.test(blob) || terms.size > 0) terms.add('governance');

  return normalizeTermKeys([...terms]);
}

function formatTerminologyLines(keys, options = {}) {
  const normalized = normalizeTermKeys(keys);
  if (normalized.length === 0) return [];
  const title = options.title || '  Terms used here:';
  const indent = options.indent || '  ';
  const bullet = options.bullet || '-';

  return [
    title,
    ...normalized.map((key) => `${indent}${bullet} ${TERMINOLOGY[key].label}: ${TERMINOLOGY[key].description}`),
  ];
}

module.exports = {
  TERMINOLOGY,
  collectAuditTerminology,
  formatTerminologyLines,
};
