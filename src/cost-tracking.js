const BUDGET_PATTERNS = [
  /\bcost.{0,15}budget\b/i,
  /\bmonthly.{0,15}budget\b/i,
  /\bspending.{0,15}limit\b/i,
  /\busage.{0,15}limit\b/i,
  /\bbudget guardrails?\b/i,
  /\bspend cap\b/i,
  /\bquota\b/i,
];

const USAGE_TRACKING_PATTERNS = [
  /\b(per[- ]run|per agent run|per session|per request)\b.{0,40}\b(cost|usage|token|spend|billing)\b/i,
  /\b(cost|usage|token|spend|billing)\b.{0,40}\b(per[- ]run|per agent run|per session|per request)\b/i,
  /\b(track|tracking|monitor|monitoring|log|logging|meter|metering|report|reporting)\b.{0,40}\b(cost|usage|token|spend|billing)\b/i,
  /\b(cost|usage|token|spend|billing)\b.{0,40}\b(track|tracking|monitor|monitoring|log|logging|meter|metering|report|reporting)\b/i,
  /\btoken metrics?\b/i,
  /\busage dashboard\b/i,
  /\bcost dashboard\b/i,
  /\b(prompt|completion|input|output)\s+tokens?\b.{0,20}\b(log|track|monitor|report)\b/i,
  /\b(langfuse|langsmith|helicone|openlit|lunary|braintrust|phoenix)\b/i,
];

const USAGE_TRACKING_FILE_PATTERNS = [
  /\blangfuse\b/i,
  /\blangsmith\b/i,
  /\bhelicone\b/i,
  /\bopenlit\b/i,
  /\blunary\b/i,
  /\bbraintrust\b/i,
  /\bphoenix\b/i,
];

function matchesAny(text, patterns) {
  const normalized = String(text || '');
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(normalized);
  });
}

function hasUsageTrackingDependency(ctx) {
  if (!ctx || typeof ctx.projectDependencies !== 'function') return false;
  const deps = Object.keys(ctx.projectDependencies() || {});
  return deps.some((name) => USAGE_TRACKING_FILE_PATTERNS.some((pattern) => pattern.test(name)));
}

function hasUsageTrackingArtifacts(ctx) {
  if (!ctx || !Array.isArray(ctx.files)) return false;
  return ctx.files.some((filePath) => USAGE_TRACKING_FILE_PATTERNS.some((pattern) => pattern.test(String(filePath || ''))));
}

function hasCostBudgetOrUsageTracking(text, ctx = null) {
  return matchesAny(text, BUDGET_PATTERNS) ||
    matchesAny(text, USAGE_TRACKING_PATTERNS) ||
    hasUsageTrackingDependency(ctx) ||
    hasUsageTrackingArtifacts(ctx);
}

module.exports = {
  hasCostBudgetOrUsageTracking,
};
