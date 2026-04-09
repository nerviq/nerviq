# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Nerviq, please report it responsibly.

**Email:** [security@nerviq.net](mailto:security@nerviq.net)

Please include:

- Description of the vulnerability
- Steps to reproduce
- Affected version(s)
- Impact assessment (if known)

**Do not** open a public GitHub issue for security vulnerabilities.

## Response SLA

| Severity | Response Time | Fix Timeline |
|----------|--------------|--------------|
| **Critical** (RCE, data exfiltration) | < 24 hours | < 48 hours |
| **High** (privilege escalation, auth bypass) | < 48 hours | < 7 days |
| **Medium** (information disclosure, DoS) | < 7 days | < 30 days |
| **Low** (minor issues, hardening) | < 14 days | Next release |

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.12.x | Yes |
| < 1.12 | No |

Only the latest patch release of each supported major.minor line receives security updates.

## Dependency Policy

- **Zero runtime dependencies.** Nerviq ships with no production `node_modules` — only Node.js (>=18) is required.
- **devDependencies audited monthly** using `npm audit` and reviewed for known CVEs.
- **SBOM published** with every release (`sbom.cdx.json`) in CycloneDX format for full dependency transparency.
- **Lockfile integrity** checked in CI to prevent supply-chain tampering.

## Security Architecture

- All operations run **locally** — no data is sent to external servers by default.
- The `nerviq serve` command binds to **localhost only** (127.0.0.1), never to 0.0.0.0.
- `deep-review` (opt-in) redacts secrets and credentials before sending config snippets to any AI provider.
- No secrets, tokens, or API keys are stored by Nerviq.

## Reporting False Positives in Checks

If a Nerviq audit check produces a false positive (flags something that is not actually a problem):

1. Run `nerviq audit --verbose` to identify the exact check key (e.g., `permissionDeny`).
2. Open a GitHub issue with:
   - The check key
   - Your project structure (relevant files only)
   - Why you believe it is a false positive
3. Alternatively, use `nerviq feedback --key <checkKey> --status rejected --effect neutral --notes "false positive: <reason>"` to record it locally.

False positive reports help us improve check accuracy for all users.

## Acknowledgments

We gratefully acknowledge security researchers who responsibly disclose vulnerabilities. With your permission, we will list you in our security acknowledgments.
