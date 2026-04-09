function splitIdentifierSegments(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_./:-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function estimateSegmentTokens(segment) {
  const charCount = [...String(segment || '')].length;
  return Math.max(1, Math.ceil(charCount / 4));
}

function estimateTokenCount(text) {
  if (typeof text !== 'string' || !text) return 0;

  const parts = text.match(/[\p{L}\p{N}_]+|[^\s]/gu) || [];
  let total = 0;

  for (const part of parts) {
    if (/^[\p{L}\p{N}_]+$/u.test(part)) {
      const segments = splitIdentifierSegments(part);
      total += segments.reduce((sum, segment) => sum + estimateSegmentTokens(segment), 0);
      continue;
    }

    total += 1;
  }

  return total;
}

module.exports = {
  estimateTokenCount,
};
