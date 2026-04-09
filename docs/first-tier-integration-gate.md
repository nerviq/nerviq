# First-Tier Integration Gate

Nerviq ships first-tier integrations only when the product is ready to be judged by them.

This gate exists to stop distribution-by-eagerness. A marketplace listing, IDE plugin, or prominent CI surface should amplify a trustworthy product, not expose unfinished semantics.

## Gate dimensions

### 1. Contract stability

- machine-readable contracts exist where relevant
- score semantics are explicit and documented
- the integration does not depend on scraping unstable CLI text

### 2. Public proof density

- public before/after proof exists
- benchmarkable public evidence exists across more than one repo shape
- the product boundary is stated clearly, including what Nerviq is not

### 3. Operational reliability

- canonical test/build paths are green
- no known release-blocking CI failures exist
- setup, docs, and support paths are reproducible for external users

### 4. Ownership and support

- one repo clearly owns the surface
- release/update flow is defined
- incoming user issues can be triaged without ambiguity

### 5. Category fit

- the surface reinforces Nerviq as agent governance / AI development control plane
- the integration does not blur Nerviq into a different category by accident
- marketing copy and product behavior tell the same story

## Surface posture

| Surface | Posture | What this means |
|---|---|---|
| GitHub Action marketplace | Gated | The action can exist before the marketplace listing; broader distribution waits for the full first-tier bar. |
| JetBrains plugin | Gated | IDE distribution waits until the plugin contract, install path, and support posture reinforce the core category instead of distracting from it. |
| Shared/team dashboard | Gated | Monetization-facing surfaces stay behind trustworthy fleet semantics and control-plane clarity. |
| Community seeding | Deferred until story is strong | Community distribution follows public proof plus category clarity, not the other way around. |

## Unfreeze rule

A first-tier surface can move forward only when:

- the relevant gate dimensions are green
- the owning repo is updated
- public messaging is synchronized if the surface is public
- the move strengthens Nerviq's standard story instead of fragmenting it

## Why this matters

Without this gate, new surfaces can create false momentum while weakening trust. With it, each external integration becomes proof that the product is stabilizing into a standard, not just expanding its footprint.
