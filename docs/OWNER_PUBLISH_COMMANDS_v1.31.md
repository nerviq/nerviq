# v1.31.0 — Owner publish commands (2026-07-06)

Everything else is done: all 3 repos merged to main/master and pushed,
tags `v1.31.0` + floating `v1` pushed, pre-publish gate fully green.
Run these in order; each block is copy-paste ready.

## 1. npm publish (the one step only you can do)

```powershell
cd C:\Users\naorp\nerviq
npm run prepublish:check
npm publish --access public
```

## 2. Vercel production deploy (token expired — needs your login)

```powershell
cd C:\Users\naorp\nerviq-site
npx vercel login
npx vercel --prod --yes
```

## 3. GitHub Release (blocked for the agent by permission policy)

Release notes are already written to the scratchpad; simplest is to
generate from the tag:

```powershell
cd C:\Users\naorp\nerviq
gh release create v1.31.0 --repo nerviq/nerviq --title "v1.31.0 - Your agent docs lie: drift wedge, MIT relicense, July 2026 platform refresh" --notes-from-tag --verify-tag
```

(Or paste the `[1.31.0]` CHANGELOG section as the body via the web UI —
that's the fuller version.)

## 4. Close the 4 freshness issues (drafts from PLATFORM_REFRESH §5)

```powershell
gh issue close 42 --repo nerviq/nerviq --comment "All 13 P0 sources re-verified live 2026-07-06 (hooks/permissions/changelog included); stamps updated in v1.31. Closing."
gh issue close 45 --repo nerviq/nerviq --comment "All 12 P0 sources re-verified 2026-07-06. Note: docs.cursor.com host retired - 3 P0 URLs + 33 source-url entries migrated to cursor.com/docs equivalents. Closing."
gh issue close 39 --repo nerviq/nerviq --comment "All 10 P0 sources re-verified 2026-07-06; latest stable 0.142.5 noted. Closing."
gh issue close 41 --repo nerviq/nerviq --comment "All 13 P0 sources re-verified 2026-07-06; 7 moved URLs + 1 dead anchor migrated to final paths. Closing."
```

## 5. Post-publish verification (after 1+2)

```powershell
cd C:\Users\naorp\nerviq
node tools/validate-release-metadata.js --site-url https://nerviq.net
npx -y @nerviq/cli@1.31.0 drift
npx -y @nerviq/cli@1.31.0 audit
```

## 6. Optional, recommended while you're in the GitHub UI

- Repo About: description → "Your agent docs lie. Nerviq finds the lies in
  30 seconds — stale references + cross-platform drift across 8 AI coding
  agents." Topics: `agents-md`, `claude-md`, `drift-detection`, `ai-agents`,
  `linter`.
- GitHub Action Marketplace listing (first time): on the release page,
  check "Publish this Action to the GitHub Marketplace".
- Check `npm run leads:list` in nerviq-site (needs LEAD_ENCRYPTION_KEY) —
  the Day-30 gate counts inbound leads.
