---
name: audit-repo
description: Run nerviq on the current repo and summarize the score, top gaps, and next command
---

Run `npx @nerviq/cli --json` in the current project directory and summarize the result.

Your output should include:

1. The overall score and organic score
2. The top 3 next actions from `topNextActions`
3. The suggested next command from `suggestedNextCommand`
4. A short explanation of what the repo already does well if there are notable strengths

Behavior rules:

- If the user asks for the shortest version, run `npx @nerviq/cli --lite`
- If the user wants deeper no-write analysis, run `npx @nerviq/cli augment --json`
- If the score is below 50, explicitly recommend `npx @nerviq/cli setup`
- Never apply changes automatically from this skill
