/**
 * Cloudflare Worker for NERVIQ insights collection.
 * Deploy: wrangler deploy tools/insights-worker.js
 *
 * Stores anonymous audit data in Cloudflare KV.
 * No PII, no file contents, no IP logging.
 *
 * KV Namespace: NERVIQ_INSIGHTS
 *
 * Endpoints:
 *   POST /v1/report - receive audit insight
 *   GET  /v1/stats  - public aggregate stats
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: { ...headers, 'Access-Control-Allow-Methods': 'POST, GET', 'Access-Control-Allow-Headers': 'Content-Type' } });
    }

    // POST /v1/report - receive insight
    if (request.method === 'POST' && url.pathname === '/v1/report') {
      try {
        const data = await request.json();

        // Validate shape (reject anything unexpected)
        if (!data.v || !data.score || !data.toolVersion) {
          return new Response(JSON.stringify({ error: 'invalid payload' }), { status: 400, headers });
        }

        // Store with timestamp key (no IP, no identity)
        const key = `report:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        await env.NERVIQ_INSIGHTS.put(key, JSON.stringify({
          score: data.score,
          passed: data.passed,
          failed: data.failed,
          stacks: data.stacks,
          failedChecks: data.failedChecks,
          platform: data.platform,
          nodeVersion: data.nodeVersion,
          toolVersion: data.toolVersion,
          timestamp: data.timestamp,
        }), { expirationTtl: 60 * 60 * 24 * 90 }); // 90 days retention

        // Update aggregate counters
        const stats = JSON.parse(await env.NERVIQ_INSIGHTS.get('aggregate') || '{"totalRuns":0,"scoreSum":0,"stackCounts":{},"failCounts":{}}');
        stats.totalRuns++;
        stats.scoreSum += data.score;
        for (const stack of (data.stacks || [])) {
          stats.stackCounts[stack] = (stats.stackCounts[stack] || 0) + 1;
        }
        for (const check of (data.failedChecks || [])) {
          stats.failCounts[check] = (stats.failCounts[check] || 0) + 1;
        }
        await env.NERVIQ_INSIGHTS.put('aggregate', JSON.stringify(stats));

        return new Response(JSON.stringify({ ok: true }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: 'internal' }), { status: 500, headers });
      }
    }

    // GET /v1/stats - public aggregate stats
    if (request.method === 'GET' && url.pathname === '/v1/stats') {
      const stats = JSON.parse(await env.NERVIQ_INSIGHTS.get('aggregate') || '{"totalRuns":0}');
      const avgScore = stats.totalRuns > 0 ? Math.round(stats.scoreSum / stats.totalRuns) : 0;

      // Top 5 most-failed checks
      const topFails = Object.entries(stats.failCounts || {})
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([check, count]) => ({ check, count, pct: Math.round((count / stats.totalRuns) * 100) }));

      // Top stacks
      const topStacks = Object.entries(stats.stackCounts || {})
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([stack, count]) => ({ stack, count }));

      return new Response(JSON.stringify({
        totalRuns: stats.totalRuns,
        averageScore: avgScore,
        topFailedChecks: topFails,
        topStacks: topStacks,
      }, null, 2), { headers });
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
  },
};
