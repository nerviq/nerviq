# GOV-03 — Time-to-First-Value measurement (2026-04-13)

Generated: 2026-04-12T20:13:27Z

## Methodology

- Sample size: 5 runs per scenario x repo combination.
- Wall-clock TTFV = invocation start to the first line that includes a score (`/100`, `Score:`) or equivalent useful audit signal.
- Cognitive TTFV = invocation start to the first actionable recommendation line (`1. ...`, `Next command:`, `Ready? Run:`).
- Scenarios measured: cold `npx`, warm `npx`, isolated global install, and local clone via `node bin/cli.js`.
- Version under test: scenarios 1-3 used the published npm package `@nerviq/cli 1.17.2`; scenario 4 used the local checkout reporting `1.17.3`.
- Target repos: `c:/Users/naorp/nerviq-research`, a fresh package.json-only directory, a shallow clone of `home-assistant/core`, and a minimal Python repo.
- Startup breakdown probes were measured separately with 5 real runs per scenario.

## Verdict

Under 2 min claim: **TRUE**.
- Slowest measured median wall-clock TTFV: **16127.61 ms** in **Scenario 1: npx cold cache / nerviq-research**.

## Raw timing table

| Scenario | Repo | Wall-clock runs (ms) | Cognitive runs (ms) | Total runs (ms) |
|---|---|---|---|---|
| Scenario 1: npx cold cache | nerviq-research | 14541.7, 13822.66, 16323.15, 16127.61, 20556.18 | 16917.11, 16082.12, 18712.5, 19630.56, 23602.72 | 17058.88, 16175.66, 18806.85, 19740.79, 23724.94 |
| Scenario 1: npx cold cache | Fresh empty directory with package.json | 2334.34, 2500.13, 2482.34, 2395.72, 1946.88 | 2335.18, 2501.02, 2484.45, 2397.33, 1949.26 | 2395.94, 2562.3, 2564.52, 2466.45, 2004.48 |
| Scenario 1: npx cold cache | home-assistant/core | 9564.17, 6946.75, 8996.96, 7358.39, 7005.71 | 11055.1, 8410.88, 10398.55, 8798.7, 8395.97 | 11121.6, 8475.81, 10457.15, 8860.17, 8451.8 |
| Scenario 1: npx cold cache | Minimal Python repo | 1316.35, 1204.32, 1274.44, 1286.05, 1345.57 | 1317.14, 1205.42, 1275.67, 1287.3, 1347.14 | 1356.96, 1243.82, 1326.16, 1331.85, 1400.63 |
| Scenario 2: npx warm cache | nerviq-research | 10607.09, 10846.7, 11773.69, 10901.5, 12002.46 | 12445.2, 12889.89, 13666.63, 13019.63, 13891.69 | 12540.96, 12979.19, 13746.5, 13111.18, 13974.71 |
| Scenario 2: npx warm cache | Fresh empty directory with package.json | 1349.17, 1327.97, 1249.13, 1395.16, 1511.39 | 1350.09, 1328.94, 1250.24, 1396.42, 1512.16 | 1392.32, 1367.57, 1296.55, 1439.16, 1553.71 |
| Scenario 2: npx warm cache | home-assistant/core | 7440.17, 5881.85, 6476.95, 6166.42, 6314.45 | 8954.15, 7413.91, 7802.3, 7620.9, 7833.43 | 9008.42, 7476.6, 7888.82, 7691.29, 7885.21 |
| Scenario 2: npx warm cache | Minimal Python repo | 1112.77, 927.67, 1075.2, 957.12, 1143.56 | 1113.99, 928.5, 1076.22, 957.89, 1144.76 | 1149.0, 961.65, 1115.65, 993.26, 1183.31 |
| Scenario 3: isolated global install | nerviq-research | 9563.35, 10664.76, 10423.11, 9805.88, 10099.4 | 11541.57, 12562.75, 12939.84, 12138.49, 12678.01 | 11634.34, 12624.45, 12993.72, 12201.93, 12725.44 |
| Scenario 3: isolated global install | Fresh empty directory with package.json | 235.72, 220.19, 246.4, 214.71, 233.32 | 236.45, 221.1, 247.12, 215.41, 234.07 | 249.91, 234.76, 259.24, 228.84, 248.92 |
| Scenario 3: isolated global install | home-assistant/core | 5451.82, 4980.64, 4705.46, 5180.26, 5937.04 | 6997.7, 6619.33, 6085.55, 6519.41, 7455.72 | 7036.89, 6651.4, 6117.77, 6550.9, 7484.75 |
| Scenario 3: isolated global install | Minimal Python repo | 302.92, 253.86, 268.71, 266.25, 260.38 | 304.51, 255.0, 270.01, 267.7, 261.13 | 324.93, 269.15, 284.04, 289.65, 274.74 |
| Scenario 4: local clone via node bin/cli.js | nerviq-research | 10310.45, 9819.19, 10653.41, 10287.68, 11135.06 | 12765.61, 11743.08, 12832.4, 12093.69, 13074.39 | 12816.89, 11801.08, 12897.05, 12154.42, 13127.69 |
| Scenario 4: local clone via node bin/cli.js | Fresh empty directory with package.json | 423.28, 348.01, 369.17, 430.51, 397.68 | 425.54, 348.75, 370.22, 431.55, 398.58 | 449.31, 367.57, 395.83, 450.84, 417.55 |
| Scenario 4: local clone via node bin/cli.js | home-assistant/core | 6811.79, 7248.57, 6459.77, 6426.1, 7387.36 | 8035.73, 8576.2, 7756.45, 7776.91, 8956.67 | 8069.66, 8609.1, 7786.94, 7805.78, 8992.06 |
| Scenario 4: local clone via node bin/cli.js | Minimal Python repo | 399.9, 338.29, 325.55, 413.56, 338.97 | 400.74, 340.03, 326.46, 414.83, 340.12 | 419.52, 357.21, 344.3, 433.95, 359.97 |

## Summary statistics

| Scenario | Repo | Wall-clock median | Wall-clock p90 | Wall-clock p99 | Cognitive median | Cognitive p90 | Cognitive p99 | Total median |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Scenario 1: npx cold cache | nerviq-research | 16127.61 ms | 18862.97 ms | 20386.86 ms | 18712.5 ms | 22013.86 ms | 23443.83 ms | 18806.85 ms |
| Scenario 1: npx cold cache | Fresh empty directory with package.json | 2395.72 ms | 2493.01 ms | 2499.42 ms | 2397.33 ms | 2494.39 ms | 2500.36 ms | 2466.45 ms |
| Scenario 1: npx cold cache | home-assistant/core | 7358.39 ms | 9337.29 ms | 9541.48 ms | 8798.7 ms | 10792.48 ms | 11028.84 ms | 8860.17 ms |
| Scenario 1: npx cold cache | Minimal Python repo | 1286.05 ms | 1333.88 ms | 1344.4 ms | 1287.3 ms | 1335.14 ms | 1345.94 ms | 1331.85 ms |
| Scenario 2: npx warm cache | nerviq-research | 10901.5 ms | 11910.95 ms | 11993.31 ms | 13019.63 ms | 13801.67 ms | 13882.69 ms | 13111.18 ms |
| Scenario 2: npx warm cache | Fresh empty directory with package.json | 1349.17 ms | 1464.9 ms | 1506.74 ms | 1350.09 ms | 1465.86 ms | 1507.53 ms | 1392.32 ms |
| Scenario 2: npx warm cache | home-assistant/core | 6314.45 ms | 7054.88 ms | 7401.64 ms | 7802.3 ms | 8505.86 ms | 8909.32 ms | 7885.21 ms |
| Scenario 2: npx warm cache | Minimal Python repo | 1075.2 ms | 1131.24 ms | 1142.33 ms | 1076.22 ms | 1132.45 ms | 1143.53 ms | 1115.65 ms |
| Scenario 3: isolated global install | nerviq-research | 10099.4 ms | 10568.1 ms | 10655.09 ms | 12562.75 ms | 12835.11 ms | 12929.37 ms | 12624.45 ms |
| Scenario 3: isolated global install | Fresh empty directory with package.json | 233.32 ms | 242.13 ms | 245.97 ms | 234.07 ms | 242.85 ms | 246.69 ms | 248.92 ms |
| Scenario 3: isolated global install | home-assistant/core | 5180.26 ms | 5742.95 ms | 5917.63 ms | 6619.33 ms | 7272.51 ms | 7437.4 ms | 6651.4 ms |
| Scenario 3: isolated global install | Minimal Python repo | 266.25 ms | 289.24 ms | 301.55 ms | 267.7 ms | 290.71 ms | 303.13 ms | 284.04 ms |
| Scenario 4: local clone via node bin/cli.js | nerviq-research | 10310.45 ms | 10942.4 ms | 11115.79 ms | 12765.61 ms | 12977.59 ms | 13064.71 ms | 12816.89 ms |
| Scenario 4: local clone via node bin/cli.js | Fresh empty directory with package.json | 397.68 ms | 427.62 ms | 430.22 ms | 398.58 ms | 429.15 ms | 431.31 ms | 417.55 ms |
| Scenario 4: local clone via node bin/cli.js | home-assistant/core | 6811.79 ms | 7331.84 ms | 7381.81 ms | 8035.73 ms | 8804.48 ms | 8941.45 ms | 8069.66 ms |
| Scenario 4: local clone via node bin/cli.js | Minimal Python repo | 338.97 ms | 408.1 ms | 413.01 ms | 340.12 ms | 409.19 ms | 414.27 ms | 359.97 ms |

## Cold-start breakdown

| Scenario | Node start | npx resolve | CLI load | Audit to first useful line* |
|---|---:|---:|---:|---:|
| Scenario 1: npx cold cache | 81.35 ms | 1323.85 ms | 247.99 ms | 3223.87 ms |
| Scenario 2: npx warm cache | 81.35 ms | 802.54 ms | 307.97 ms | 2639.95 ms |
| Scenario 3: isolated global install | 81.35 ms | N/A | 173.84 ms | 2468.07 ms |
| Scenario 4: local clone via node bin/cli.js | 81.35 ms | N/A | 115.3 ms | 3408.09 ms |

* Audit-to-first-useful-line is derived from measured `version` startup and the audit TTFV median for the same scenario.

## Bottlenecks

- No individual check crossed the 500 ms median threshold in the 5-run local per-check profiling pass.

## Recommendations

1. Reduce package-entry overhead in the slowest path (Scenario 1: npx cold cache), because its worst-case median is 16127.61 ms before users see value.
2. Publish and document a cache-friendly install path (`npm install -g` or local clone) for repeated usage, since both avoid the cold `npx` resolution tax.
3. Keep the default audit output score and first recommendation near the top of the render path, because cognitive TTFV depends on how quickly the first actionable line appears after the score.
4. The current bottleneck is startup + package resolution rather than any single check, so optimization work should start above the per-check layer.
