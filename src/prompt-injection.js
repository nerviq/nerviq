'use strict';

const PROMPT_INJECTION_PATTERNS = [
  /\bignore (?:all )?(?:previous|earlier|above) instructions?\b/i,
  /\boverride (?:the )?(?:system|developer|safety|previous) instructions?\b/i,
  /\breveal (?:your|the) (?:system|developer) prompt\b/i,
  /\bbypass (?:all )?(?:safety|guardrails|restrictions|protections)\b/i,
  /\bdisable (?:the )?(?:guardrails|safety checks?)\b/i,
  /\bact as (?:the )?(?:system|developer)\b/i,
  /\breport (?:that )?(?:everything is )?perfect(?: and score 100\/100)?\b/i,
  /\bscore 100\/100\b/i,
  /\bexfiltrate\b.*\b(?:secret|token|credential|password)\b/i,
];

const TRUST_BOUNDARY_PATTERNS = [
  /\btreat(?: every| all)?(?: string| file| repo(?:sitory)?| external)?[\w\s,-]{0,80}\buntrusted\b/i,
  /\bnever follow instructions embedded in\b/i,
  /\b(?:repo(?:sitory)? files?|file contents?|web(?:site|page)? content|fetched content|external content|mcp responses?)\b[\w\s,-]{0,120}\b(?:data|quoted)\b[\w\s,-]{0,80}\bnot instructions\b/i,
  /\bmcp responses?\b[\w\s,-]{0,80}\buntrusted\b/i,
  /\bfile contents?\b[\w\s,-]{0,80}\buntrusted\b/i,
  /\bprompt injection\b[\w\s,-]{0,120}\b(?:defense|resistance|guard|boundary)\b/i,
];

function containsPromptInjectionPattern(text) {
  const normalized = String(text || '');
  return PROMPT_INJECTION_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(normalized);
  });
}

function hasPromptInjectionDefenseGuidance(text) {
  const normalized = String(text || '');
  if (!normalized.trim()) return false;
  return TRUST_BOUNDARY_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(normalized);
  });
}

function hasMcpPromptInjectionDefenseGuidance(text) {
  const normalized = String(text || '');
  if (!/\bmcp\b/i.test(normalized)) return false;
  return hasPromptInjectionDefenseGuidance(normalized);
}

function collectHookBlocks(settings) {
  if (!settings || !settings.hooks || typeof settings.hooks !== 'object') return [];
  const blocks = [];
  for (const [eventName, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      blocks.push({ eventName, entry });
    }
  }
  return blocks;
}

function hasInjectionDefenseHookConfigured(settings) {
  return collectHookBlocks(settings).some(({ eventName, entry }) => {
    if (eventName !== 'PostToolUse') return false;
    const matcher = `${entry && entry.matcher ? entry.matcher : ''}`;
    if (!/WebFetch|WebSearch|Read|Grep|Glob|mcp__/i.test(matcher)) return false;
    const hooks = Array.isArray(entry && entry.hooks) ? entry.hooks : [];
    return hooks.some((hook) => /injection|prompt|sanitize|untrusted/i.test(`${hook && hook.command ? hook.command : ''}`));
  });
}

module.exports = {
  containsPromptInjectionPattern,
  hasPromptInjectionDefenseGuidance,
  hasMcpPromptInjectionDefenseGuidance,
  hasInjectionDefenseHookConfigured,
};
