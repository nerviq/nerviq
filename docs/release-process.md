# Release Process

This is the canonical publish path for `@nerviq/cli`.

## Rule

Do not publish from a local workstation.

The supported path is a human-triggered GitHub Actions workflow that publishes
from `main` with npm provenance attestation.

## Canonical flow

1. Make sure `package.json`, `release-metadata.json`, and `CHANGELOG.md` all
   reflect the intended version.
2. Push the release commit to `main`.
3. Trigger the publish workflow manually:

```bash
gh workflow run publish.yml -f version=X.Y.Z
```

4. Approve the `npm-publish` environment when GitHub requests manual approval.
5. Let the workflow run the release gates and publish to npm with provenance.

## What `publish.yml` does

The workflow runs on `workflow_dispatch` only and publishes only from `main`.

Before `npm publish`, it runs:

- `node tools/pre-publish.js --ci --expected-version X.Y.Z --skip-tests --skip-metadata`
- `npx jest`
- `npm run verify:release-metadata -- --site-url https://nerviq.net`

If those pass, it publishes with:

```bash
npm publish --provenance --access public
```

The publish job uses:

- `id-token: write` for npm provenance attestation
- `NODE_AUTH_TOKEN` from the `NPM_TOKEN` repository secret
- the `npm-publish` GitHub environment for manual approval

## Why this replaced local publish

This workflow is the safest publish path because it:

- publishes from the exact commit already on `main`
- uses a clean runner instead of a potentially stale local clone
- enforces version, changelog, and metadata alignment
- produces npm provenance attestation automatically
- keeps approval and publishing in one auditable workflow

## Notes

- `tools/pre-publish.js` still exists for local preflight and CI reuse, but it
  is no longer the canonical way to publish from a laptop.
- `ci.yml` no longer publishes on tags. Publishing is intentionally separated
  into `publish.yml` so the human can choose when a release goes live.
