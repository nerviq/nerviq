# v1.31.0 Release Checklist — owner-executed steps

Everything below is prepared on branch `fable/revival-sprint-w1` (in this
repo, in `nerviq-site`, and in `nerviq-research` — all three carry the
coordinated v1.31.0 / 509-tests / 2,441-checks strings that
`verify:release-metadata` pins). Nothing has been pushed, published, deployed,
or posted. These are the exact commands for the owner.

**What's in v1.31.0:** July 2026 platform refresh (top-4), doctor scoping fix,
`nerviq drift` wedge command, drift-first repositioning, AGPL→MIT relicense,
verified/community platform tiers, matrix-suite fixes, coordinated number
fixes (475→509 tests). See the `[1.31.0]` CHANGELOG entry.

> Note: `release-metadata.json` sets `releaseDate: 2026-07-06`. If you publish
> on a later day, update that date AND the `## [1.31.0] - 2026-07-06` heading
> in CHANGELOG.md (they must match — the validator checks), commit, and re-run
> `npm run verify:release-metadata`.

## 0. Pre-flight (local, no side effects)

```bash
cd C:\Users\naorp\nerviq
git checkout fable/revival-sprint-w1
npm test                # canonical suite — expect 168/168
npx jest                # expect 509/509
npm run test:all        # full matrix — expect all suites green
npm run verify:release-metadata   # expect: passed for v1.31.0
npm pack --dry-run      # sanity: tarball contents, no stray files
```

## 1. Push branches + merge (all three repos)

```bash
# CLI repo
cd C:\Users\naorp\nerviq
git push nerviq fable/revival-sprint-w1
git checkout main
git merge --no-ff fable/revival-sprint-w1 -m "Release v1.31.0 — July 2026 revival: drift wedge, MIT, tiers"
git push nerviq main

# Site repo (needed for the validator's cross-repo check + the deploy below)
cd C:\Users\naorp\nerviq-site
git push origin fable/revival-sprint-w1
git checkout master
git merge --no-ff fable/revival-sprint-w1 -m "Site: v1.31.0 sync + drift-wedge hero + $19 pricing + MIT"
git push origin master

# Research repo (validator pins nerviq-state.json + CLAUDE.md strings)
cd C:\Users\naorp\nerviq-research
git push origin fable/revival-sprint-w1
git checkout main
git merge --no-ff fable/revival-sprint-w1 -m "Sync product-state strings to v1.31.0"
git push origin main
```

## 2. npm publish (CLI repo, from main)

```bash
cd C:\Users\naorp\nerviq
git checkout main
npm run prepublish:check   # red/green gate: clean tree, main, remote sync, changelog, jest, metadata
npm publish --access public   # prepublishOnly re-runs the gate automatically
```

After publish, verify: `npm view @nerviq/cli version` → `1.31.0`, and
`npm view @nerviq/cli license` → `MIT`.

## 3. Tag + GitHub release

```bash
cd C:\Users\naorp\nerviq
git tag v1.31.0
git push nerviq v1.31.0
# Move the floating major tag the Action consumers use (uses: nerviq/nerviq@v1)
git tag -f v1 v1.31.0
git push -f nerviq v1
```

## 4. GitHub release + Marketplace listing (UI steps)

The Action metadata is complete (`action.yml` at repo root: unique name
"Nerviq Audit", author, description with the 2,441-checks line, branding
`shield`/`green`, 5 inputs, 7 outputs). The audit found the Action was likely
never actually listed — this step is what puts it on the Marketplace.

1. Go to https://github.com/nerviq/nerviq/releases → **Draft a new release**.
2. Tag: choose the existing `v1.31.0` tag.
3. Title: `v1.31.0 — Your agent docs lie (July 2026 revival)`.
4. Body: paste the `[1.31.0]` section from CHANGELOG.md (lead with drift +
   MIT relicense; keep the evidence tiers).
5. **Check the box "Publish this Action to the GitHub Marketplace".**
   - First time only: GitHub will prompt you to accept the **GitHub
     Marketplace Developer Agreement** and may ask you to confirm the
     action name is unique and two-factor auth is enabled — accept/confirm.
   - If the checkbox doesn't appear: confirm `action.yml` is at the repo
     root on the default branch and the repo is public.
6. Categories: **Primary: Continuous integration**. **Secondary: Code
   quality** (both exist in the Marketplace category list and match the
   gate/lint use case).
7. Publish the release.
8. Verify the listing at `https://github.com/marketplace/actions/nerviq-audit`
   and that the README usage snippet (`uses: nerviq/nerviq@v1` with
   `threshold: 60`) works in a scratch repo.

## 5. Site deploy (after npm publish, so `npx @nerviq/cli drift` works for visitors)

```bash
cd C:\Users\naorp\nerviq-site
# deploy master via the usual Vercel flow (git push already triggers it if
# the Vercel project tracks master; otherwise: npx vercel --prod)
```

Post-deploy spot-checks: home hero shows "Your agent docs lie…", 509 tests,
table sums 2,441 (Claude Code 403), /pricing Team = $19, /research shows
1,010/1,193, no Discord link, footer says MIT.

## 6. Post-release verifications

```bash
cd C:\Users\naorp\nerviq
node tools/validate-release-metadata.js --site-url https://nerviq.net   # live-site drift guard
npx -y @nerviq/cli@1.31.0 drift      # the wedge works from the registry
npx -y @nerviq/cli@1.31.0 audit      # score path intact
```

- npm page shows the new drift-first description + MIT license.
- GitHub repo "About" sidebar: consider updating the description to the new
  one-liner and adding topics (`agents-md`, `claude-md`, `drift-detection`).

## 7. NOT in this release (deliberate)

- No launch posts / Show HN / Reddit — sprint weeks 3–4, after the three
  user-lab trust-killers are fixed (invalid `--fix --json`, Harmony banner in
  machine formats, 100/100 on empty repo → these are Days 2–3 scope).
- VS Code extension stays at 0.9.5 (separate publish pipeline, not gated).
- The 4 freshness-issue close-comments (#39/#41/#42/#45) are drafted in the
  sprint plan and go out with owner approval.
