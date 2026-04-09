#!/usr/bin/env node
'use strict';

const fs = require('fs');

function parsePayload(raw) {
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON payload: ${error.message}`);
  }
}

function asNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function buildAuditActionOutputs(payload, fallbackPlatform = 'claude') {
  return {
    score: asNumber(payload.score),
    passed: asNumber(payload.passed),
    check_count: asNumber(payload.checkCount),
    platform: payload.platform || fallbackPlatform,
  };
}

function buildHarmonyActionOutputs(payload) {
  const harmonyScore = asNumber(payload.harmonyScore);
  return {
    score: harmonyScore,
    harmony_score: harmonyScore,
    platform: 'harmony',
  };
}

if (require.main === module) {
  const mode = process.argv[2] || 'audit';
  const field = process.argv[3] || '';
  const fallbackPlatform = process.argv[4] || 'claude';
  const payload = parsePayload(fs.readFileSync(0, 'utf8'));
  const outputs = mode === 'harmony'
    ? buildHarmonyActionOutputs(payload)
    : buildAuditActionOutputs(payload, fallbackPlatform);

  if (field) {
    process.stdout.write(String(outputs[field] ?? ''));
  } else {
    process.stdout.write(JSON.stringify(outputs, null, 2));
  }
}

module.exports = {
  parsePayload,
  buildAuditActionOutputs,
  buildHarmonyActionOutputs,
};
