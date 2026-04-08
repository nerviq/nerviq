# Getting Started with Nerviq

The fastest way to understand Nerviq is not to memorize every command. It is to
go through one short loop:

1. detect platforms
2. score the repo
3. show the biggest gaps
4. fix the basics
5. check drift
6. compare the improvement

Install once:

```bash
npm i -g @nerviq/cli
```

For one-off use, `npx @nerviq/cli` works too.

If you want the shortest possible command map inside the terminal, start with:

```bash
npx @nerviq/cli --beginner
```

That view only shows `audit`, `setup`, `fix`, `augment`, and `doctor`.

---

## The 6-Step First-Value Path

### 1. Detect active platforms

```bash
npx @nerviq/cli harmony-audit
```

Use this first so you know which agent surfaces Nerviq actually found in the
repo. If the project uses more than one AI coding tool, this is the first drift
signal that matters.

### 2. Score the current repo

```bash
npx @nerviq/cli audit --snapshot
```

This gives you the live baseline and saves the first audit snapshot. That
snapshot matters because `compare` needs two snapshots later.

### 3. Show the biggest gaps

```bash
npx @nerviq/cli audit --full
```

The short score is useful, but the full audit is where you see critical checks,
top next actions, and weakest categories.

### 4. Fix the basics safely

```bash
npx @nerviq/cli setup --auto
npx @nerviq/cli fix --all-critical --auto
```

This is the fastest way to generate the starter-safe governance layer and then
close the most obvious critical issues.

### 5. Check drift again

```bash
npx @nerviq/cli harmony-audit
```

Re-run Harmony after the baseline changes so you can see whether the active
platform surfaces are becoming more coherent.

### 6. Show the improvement

```bash
npx @nerviq/cli audit --snapshot
npx @nerviq/cli compare
```

This closes the loop: Nerviq should not only recommend changes, it should show
that the repo actually improved.

---

## What You Should Have After Step 6

- one clear baseline score
- two saved audit snapshots
- a concrete before/after comparison
- a stronger starter-safe config layer
- a better sense of whether the repo is drifting across platforms

---

## After First Value

Once the six-step path makes sense, then go deeper:

- `npx @nerviq/cli plan` and `npx @nerviq/cli apply --dry-run` for reviewable rollout
- `npx @nerviq/cli governance --json` for policy and permission posture
- `npx @nerviq/cli benchmark` for isolated projected uplift
- `npx @nerviq/cli dashboard` for snapshot-backed reporting

If you want a public inspectable example, see:

- [DnaFin/nerviq-multi-agent-before-after](https://github.com/DnaFin/nerviq-multi-agent-before-after)

## Need help?

- **Docs:** [nerviq.net/docs/getting-started](https://nerviq.net/docs/getting-started)
- **GitHub:** [github.com/nerviq/nerviq](https://github.com/nerviq/nerviq)
- **Discord:** [Join the community](https://discord.gg/nerviq)
