# Knowledge Maintenance Process

How to keep Nerviq's knowledge base accurate, current, and trustworthy.

## Maintenance Cadences

### Daily: Freshness Daemon

The freshness system runs automatically and flags checks whose source documentation may have changed.

**What to do:**
- Review `nerviq doctor` output for freshness warnings
- If a check's `sourceUrl` returns 404 or has changed significantly, mark for review
- Update `confidence` values for any checks with degraded sources

**Automation:**
```bash
npx @nerviq/cli doctor --verbose    # Shows freshness gate status
```

### Weekly: Platform Changelog Review

Each supported platform publishes updates that may affect Nerviq's checks.

**Process:**
1. Check official changelogs/release notes for all 8 platforms:
   - Claude Code: Anthropic changelog
   - Codex: OpenAI platform updates
   - Gemini CLI: Google AI Studio releases
   - GitHub Copilot: GitHub blog/changelog
   - Cursor: Cursor changelog
   - Windsurf: Codeium/Windsurf releases
   - Aider: GitHub releases
   - OpenCode: GitHub releases

2. For each relevant change:
   - Does it add a new config option? → Candidate for new check
   - Does it deprecate a feature? → Update or retire affected checks
   - Does it change file formats? → Update config-parser.js

3. Log findings in `research/` with date stamp

### Monthly: Cross-Reference Audit

Verify internal consistency across the knowledge base.

**Process:**
1. Run the cross-reference audit:
   ```bash
   # From the NERVIQ research repo
   python tools/check-trust-drift.py
   ```

2. Check for:
   - Duplicate check IDs across platforms
   - Checks with confidence below 0.7 (candidates for re-verification)
   - Techniques referenced in research but missing from code
   - Techniques in code with no corresponding research doc

3. Reconcile any mismatches:
   - Update source URLs that have moved
   - Re-verify claims that have contradicting evidence
   - Remove techniques that are no longer applicable

### Quarterly: Pruning

Remove or archive knowledge that is no longer relevant.

**Process:**
1. Query all checks by `lastVerified` date
2. Identify checks not verified in 90+ days
3. For each stale check:
   - **Re-verify**: Visit sourceUrl, test the check, update confidence
   - **Archive**: If the feature no longer exists, move to `_archived/`
   - **Retire**: If the platform deprecated the feature, remove the check and note in CHANGELOG

4. Review research documents older than 90 days:
   - Still accurate? → Update `lastVerified` date
   - Outdated? → Mark as `status: archived` in frontmatter
   - Contradicted by newer findings? → Create superseding document

5. Audit experiment results:
   - Re-run 5 random experiments to confirm results still hold
   - Update ratings if behavior has changed

## The 90-Day Rule

Every piece of knowledge in Nerviq has a maximum freshness window of 90 days.

**What this means:**
- After 90 days without re-verification, a check's confidence is automatically degraded
- Research documents older than 90 days without updates are flagged in `nerviq doctor`
- Stale checks are not removed automatically but are surfaced in audit output with warnings

**How to handle stale checks:**

1. **Check still valid, source unchanged:**
   Update `lastVerified` timestamp. No code change needed.

2. **Check valid but source URL changed:**
   Update `sourceUrl` in the technique definition. Update `lastVerified`.

3. **Check partially valid — behavior changed:**
   Update the check function, fix text, confidence level. Create a research note documenting the change.

4. **Check no longer valid — feature removed:**
   Remove from `techniques.js`. Add entry to CHANGELOG. If other checks depend on it, update those too.

5. **Check cannot be verified — source unavailable:**
   Lower confidence to 0.5. Add a `TODO` comment. Flag for next weekly review.

## Freshness Tracking Fields

Each technique in Nerviq supports these freshness-related fields:

| Field | Type | Purpose |
|-------|------|---------|
| `sourceUrl` | string | Primary documentation URL |
| `confidence` | number (0.0-1.0) | How confident we are the check is correct |
| `lastVerified` | ISO date string | When the check was last manually verified |
| `addedVersion` | string | Nerviq version when the check was added |

## Emergency Updates

When a platform ships a breaking change:

1. Create a research doc immediately: `research/{platform}-breaking-change-YYYY-MM-DD.md`
2. Update affected techniques in the same session
3. Run full check matrix: `node test/{platform}-check-matrix.js`
4. Run golden matrix to detect output changes: `node test/{platform}-golden-matrix.js`
5. Publish patch release if checks produce incorrect results

## Metrics to Track

- **Freshness coverage**: % of checks verified within 90 days
- **Confidence distribution**: histogram of confidence values across all checks
- **Stale check count**: number of checks past 90-day window
- **Source availability**: % of sourceUrls returning 200
- **Platform coverage**: checks per platform (target: balanced distribution)
