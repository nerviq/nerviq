# Platform Change Ingestion

How Nerviq stays current across Claude, Codex, Cursor, Copilot, Gemini CLI, Windsurf, Aider, and OpenCode.

## Source of truth

- `src/platform-change-manifest.js`
- `.github/workflows/freshness-check.yml`
- Platform-specific freshness modules under `src/*/freshness.js`

The manifest is the canonical inventory for:
- tracked P0 sources per platform
- review cadence
- daily freshness workflow details
- propagation/update triggers

## What gets tracked

For each supported platform, Nerviq keeps:
- official docs URLs
- changelog / release-note URLs
- freshness thresholds
- propagation triggers that describe what must update when the platform changes

## Cadence

- Automation: daily freshness workflow at `06:00 UTC`
- Manual review: weekly for 14-day sources, monthly for 30-day sources
- Immediate review: any stale source or breaking platform change

## Operational workflow

1. The daily freshness workflow checks each platform's P0 sources.
2. If a source is stale or unverified, the workflow opens or updates a GitHub issue.
3. The maintainer verifies the source, updates the matching `freshness.js` file, and follows the propagation checklist.
4. If config semantics changed, update the relevant checks plus `src/platform-change-manifest.js`.

## Why this matters

This is the layer that lets Nerviq say more than "we have source URLs."
It creates an explicit system for:
- what we watch
- how often we review it
- what code/docs must change when a platform moves

That keeps freshness from becoming tribal knowledge or an ad-hoc chore.
