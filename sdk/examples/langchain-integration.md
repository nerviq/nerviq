# LangChain integration — using Nerviq as a tool

> Reference example for AI-09. Wires `@nerviq/cli/sdk` into a LangChain
> agent as a callable tool, so an autonomous LangChain agent can audit
> its own repo, check Harmony Score, and surface stale references mid-task.
>
> Pairs with: [`self-governing-agent.js`](./self-governing-agent.js) +
> [/docs/for-agents](https://nerviq.net/docs/for-agents) on the site.

## Why an agent should call Nerviq

A LangChain agent operating inside a developer's repo benefits from knowing whether the agent-config files it's reading are coherent across platforms. Without that awareness, the agent can confidently follow instructions in `CLAUDE.md` that contradict instructions in `AGENTS.md` — and produce code that breaks in someone else's tooling.

Wiring Nerviq as a LangChain tool exposes three primitives:

- `nerviq_audit` — score the repo on a specific platform
- `nerviq_harmony` — measure cross-platform drift
- `nerviq_stale_references` — surface the headline stale-reference findings

## JavaScript / Node example

```js
const { audit, harmonyAudit } = require('@nerviq/cli/sdk');
const { DynamicTool } = require('@langchain/core/tools');

const nerviqAuditTool = new DynamicTool({
  name: 'nerviq_audit',
  description:
    'Audit the AI coding agent configuration of the given repo directory. ' +
    'Returns score (0-100), passed/failed counts, top stale-reference findings, ' +
    'and topNextActions. Call this before substantive code changes when the ' +
    'task touches CLAUDE.md, AGENTS.md, .cursor/rules, .mcp.json, or hooks.',
  func: async (dir) => {
    const result = await audit(dir || process.cwd(), 'claude');
    return JSON.stringify({
      score: result.score,
      organicScore: result.organicScore,
      passed: result.passed,
      failed: result.failed,
      staleReferences: result.staleReferences || null,
      topNextActions: (result.liteSummary && result.liteSummary.topNextActions) || [],
    }, null, 2);
  },
});

const nerviqHarmonyTool = new DynamicTool({
  name: 'nerviq_harmony',
  description:
    'Measure cross-platform configuration drift between AI coding agents in ' +
    'the given repo. Returns harmonyScore (0-100) plus a list of named ' +
    'drifts. Only meaningful when 2+ platforms are detected.',
  func: async (dir) => {
    const result = await harmonyAudit(dir || process.cwd());
    return JSON.stringify({
      harmonyScore: result.harmonyScore,
      activePlatforms: result.activePlatforms,
      drifts: (result.drift && result.drift.drifts) || [],
    }, null, 2);
  },
});

// Add to your agent's tool list:
const tools = [nerviqAuditTool, nerviqHarmonyTool /*, ...your other tools */];
```

## Python via subprocess

LangChain agents in Python can shell out to the CLI's `--agent-mode --json` surface:

```python
from langchain_core.tools import tool
import json
import subprocess

@tool
def nerviq_audit(dir: str = ".") -> str:
    """Audit AI coding agent configuration. Returns score, stale references,
    top next actions. Call before substantive code changes."""
    result = subprocess.run(
        ["npx", "@nerviq/cli", "audit", "--json", "--agent-mode", "--dir", dir],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode not in (0, 1, 2):
        return json.dumps({"error": result.stderr})
    return result.stdout  # Already JSON
```

## CrewAI / AutoGen / generic orchestrators

Same pattern: any orchestrator that supports tool definitions can wrap the SDK or shell out to `npx @nerviq/cli audit --json`. The JSON envelope is documented at [/docs/for-agents](https://nerviq.net/docs/for-agents) and stable per CTO-01..05 + BUG-01 (machine-output contract).

For CrewAI specifically:

```python
from crewai.tools import tool
import subprocess

@tool("Nerviq audit tool")
def nerviq_audit(dir: str = "."):
    """Audit cross-platform AI coding agent configuration."""
    out = subprocess.run(
        ["npx", "@nerviq/cli", "audit", "--json", "--dir", dir],
        capture_output=True, text=True, timeout=60,
    ).stdout
    return out
```

## Don't bypass user consent

Per the [/docs/for-agents](https://nerviq.net/docs/for-agents) trust-boundary policy: the agent should NOT silently apply `--apply --auto` on critical fixes that materially modify governance posture (deny rules, MCP permissions, hooks). Surface the plan via the audit/harmony tool, let the user approve, then apply. The CLI gates `--apply` on `--auto` for exactly this reason — single-flag bypass is intentionally blocked.

## When to call which tool

| Situation | Call |
|---|---|
| Task start | `nerviq_audit` (always) |
| Task touches multiple agents' config | `nerviq_harmony` (drift check) |
| Stale-reference count > 0 in audit result | Surface to user via the audit response, ask whether to proceed |
| Task complete | `nerviq_audit` again, compare scores, surface delta to user |
| User accepts a recommendation | (Optionally) record via `npx @nerviq/cli feedback --key <K> --status accepted` so the local learning loop benefits |

## Reference repo

The full self-governing loop reference (5-step pre/harmony/task/post/feedback pattern) lives at [`sdk/examples/self-governing-agent.js`](./self-governing-agent.js). Read that first if you're implementing the orchestration manually rather than letting LangChain/CrewAI drive the loop.

## License

CC0 — copy, modify, integrate freely.
