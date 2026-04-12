#!/usr/bin/env python3
"""GOV-03 Time-to-First-Value benchmark harness.

Measures:
- Wall-clock TTFV: invocation -> first useful output line
- Cognitive TTFV: invocation -> first actionable recommendation line
- Scenario-level startup breakdown probes
- Per-check profiling for bottleneck detection (local clone only)
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional
import re


ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")

USEFUL_LINE_PATTERNS = [
    re.compile(r"\b\d+/100\b"),
    re.compile(r"^\s*Score:", re.IGNORECASE),
    re.compile(r"^\s*Live audit score:", re.IGNORECASE),
    re.compile(r"^\s*Harmony Score:", re.IGNORECASE),
]

ACTION_LINE_PATTERNS = [
    re.compile(r"^\s*1\.\s"),
    re.compile(r"^\s*Next command:", re.IGNORECASE),
    re.compile(r"^\s*Next:", re.IGNORECASE),
    re.compile(r"^\s*Ready\? Run:", re.IGNORECASE),
]

PLAIN_TEXT_ENV = {
    "NO_COLOR": "1",
    "FORCE_COLOR": "0",
    "npm_config_loglevel": "error",
    "npm_config_update_notifier": "false",
    "npm_config_fund": "false",
    "npm_config_audit": "false",
}

TEXT_SUBPROCESS_KWARGS = {
    "text": True,
    "encoding": "utf-8",
    "errors": "replace",
}


def percentile(values: List[float], pct: float) -> Optional[float]:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = pct * (len(ordered) - 1)
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    fraction = rank - low
    return ordered[low] + ((ordered[high] - ordered[low]) * fraction)


def safe_round(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    return round(value, 2)


def summarize(values: Iterable[Optional[float]]) -> Dict[str, Optional[float]]:
    numeric = [float(value) for value in values if value is not None]
    if not numeric:
        return {"median_ms": None, "p90_ms": None, "p99_ms": None}
    return {
        "median_ms": safe_round(statistics.median(numeric)),
        "p90_ms": safe_round(percentile(numeric, 0.90)),
        "p99_ms": safe_round(percentile(numeric, 0.99)),
    }


def normalize_output_line(line: str) -> str:
    return ANSI_ESCAPE_RE.sub("", line)


def is_useful_line(line: str) -> bool:
    normalized = normalize_output_line(line)
    return any(pattern.search(normalized) for pattern in USEFUL_LINE_PATTERNS)


def is_action_line(line: str) -> bool:
    normalized = normalize_output_line(line)
    return any(pattern.search(normalized) for pattern in ACTION_LINE_PATTERNS)


def merged_env(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    env = os.environ.copy()
    env.update(PLAIN_TEXT_ENV)
    if extra:
        env.update({key: str(value) for key, value in extra.items()})
    return env


def spawnable_command(command: List[str]) -> List[str]:
    if os.name == "nt" and command and command[0] in {"npm", "npx"}:
        escaped = subprocess.list2cmdline(command)
        return ["cmd", "/d", "/s", "/c", escaped]
    return command


def run_streaming_command(
    command: List[str],
    cwd: Path,
    env: Optional[Dict[str, str]] = None,
    timeout_sec: int = 1800,
    useful_matcher: Callable[[str], bool] = is_useful_line,
    action_matcher: Callable[[str], bool] = is_action_line,
) -> Dict[str, object]:
    start = time.perf_counter()
    process = subprocess.Popen(
        spawnable_command(command),
        cwd=str(cwd),
        env=merged_env(env),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1,
        universal_newlines=True,
        encoding="utf-8",
        errors="replace",
    )

    useful_ms = None
    action_ms = None
    useful_line = None
    action_line = None
    lines: List[str] = []

    try:
        assert process.stdout is not None
        while True:
            line = process.stdout.readline()
            if not line:
                if process.poll() is not None:
                    break
                continue

            stripped = line.rstrip("\r\n")
            lines.append(stripped)
            elapsed_ms = (time.perf_counter() - start) * 1000.0

            if useful_ms is None and useful_matcher(stripped):
                useful_ms = elapsed_ms
                useful_line = stripped

            if action_ms is None and action_matcher(stripped):
                action_ms = elapsed_ms
                action_line = stripped

        return_code = process.wait(timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        process.kill()
        return_code = -1

    total_ms = (time.perf_counter() - start) * 1000.0
    return {
        "command": command,
        "cwd": str(cwd),
        "returncode": return_code,
        "useful_ms": safe_round(useful_ms),
        "action_ms": safe_round(action_ms),
        "total_ms": safe_round(total_ms),
        "useful_line": useful_line,
        "action_line": action_line,
        "output_lines": lines,
    }


@dataclass
class TargetRepo:
    key: str
    label: str
    path: Path
    origin: str


class Scenario:
    def __init__(
        self,
        key: str,
        label: str,
        audit_command: Callable[[TargetRepo, int], List[str]],
        version_command: Callable[[int], List[str]],
        node_ready_command: Optional[Callable[[int], List[str]]],
    ) -> None:
        self.key = key
        self.label = label
        self.audit_command = audit_command
        self.version_command = version_command
        self.node_ready_command = node_ready_command

    def env_for_run(self, run_index: int) -> Dict[str, str]:
        return {}

    def prepare(self) -> None:
        return None

    def cleanup(self) -> None:
        return None


class ColdNpxScenario(Scenario):
    def __init__(self, cache_root: Path) -> None:
        self.cache_root = cache_root
        self.cache_root.mkdir(parents=True, exist_ok=True)

        def audit_command(target: TargetRepo, run_index: int) -> List[str]:
            return ["npx", "--yes", "@nerviq/cli", "audit", "--dir", str(target.path)]

        def version_command(run_index: int) -> List[str]:
            return ["npx", "--yes", "@nerviq/cli", "version"]

        def node_ready_command(run_index: int) -> List[str]:
            return [
                "npx",
                "--yes",
                "--package",
                "@nerviq/cli",
                "node",
                "-e",
                "console.log('NPX_READY')",
            ]

        super().__init__("npx-cold", "Scenario 1: npx cold cache", audit_command, version_command, node_ready_command)

    def env_for_run(self, run_index: int) -> Dict[str, str]:
        cache_dir = self.cache_root / f"cold-{run_index}-{uuid.uuid4().hex}"
        cache_dir.mkdir(parents=True, exist_ok=True)
        return {"npm_config_cache": str(cache_dir)}


class WarmNpxScenario(Scenario):
    def __init__(self, cache_root: Path) -> None:
        self.cache_root = cache_root
        self.cache_root.mkdir(parents=True, exist_ok=True)
        self.cache_dir = self.cache_root / "warm"

        def audit_command(target: TargetRepo, run_index: int) -> List[str]:
            return ["npx", "--yes", "@nerviq/cli", "audit", "--dir", str(target.path)]

        def version_command(run_index: int) -> List[str]:
            return ["npx", "--yes", "@nerviq/cli", "version"]

        def node_ready_command(run_index: int) -> List[str]:
            return [
                "npx",
                "--yes",
                "--package",
                "@nerviq/cli",
                "node",
                "-e",
                "console.log('NPX_READY')",
            ]

        super().__init__("npx-warm", "Scenario 2: npx warm cache", audit_command, version_command, node_ready_command)

    def prepare(self) -> None:
        if self.cache_dir.exists():
            shutil.rmtree(self.cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            spawnable_command(["npx", "--yes", "@nerviq/cli", "version"]),
            check=True,
            cwd=str(REPO_ROOT),
            env=merged_env({"npm_config_cache": str(self.cache_dir)}),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def env_for_run(self, run_index: int) -> Dict[str, str]:
        return {"npm_config_cache": str(self.cache_dir)}


class GlobalInstallScenario(Scenario):
    def __init__(self, global_root: Path) -> None:
        self.global_root = global_root
        self.global_root.mkdir(parents=True, exist_ok=True)
        self.prefix = self.global_root / "prefix"
        self.bin_path = self.prefix / "node_modules" / "@nerviq" / "cli" / "bin" / "cli.js"

        def audit_command(target: TargetRepo, run_index: int) -> List[str]:
            return ["node", str(self.bin_path), "audit", "--dir", str(target.path)]

        def version_command(run_index: int) -> List[str]:
            return ["node", str(self.bin_path), "version"]

        super().__init__("global-install", "Scenario 3: isolated global install", audit_command, version_command, None)

    def prepare(self) -> None:
        if self.prefix.exists():
            shutil.rmtree(self.prefix)
        self.prefix.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            spawnable_command(["npm", "install", "-g", "@nerviq/cli"]),
            check=True,
            cwd=str(REPO_ROOT),
            env=merged_env({"npm_config_prefix": str(self.prefix)}),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


class LocalCloneScenario(Scenario):
    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root

        def audit_command(target: TargetRepo, run_index: int) -> List[str]:
            return ["node", str(self.repo_root / "bin" / "cli.js"), "audit", "--dir", str(target.path)]

        def version_command(run_index: int) -> List[str]:
            return ["node", str(self.repo_root / "bin" / "cli.js"), "version"]

        super().__init__("local-clone", "Scenario 4: local clone via node bin/cli.js", audit_command, version_command, None)


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def ensure_home_assistant_clone(target_root: Path) -> Path:
    repo_dir = target_root / "home-assistant-core"
    if (repo_dir / ".git").exists():
        return repo_dir

    subprocess.run(
        ["git", "clone", "--depth", "1", "https://github.com/home-assistant/core.git", str(repo_dir)],
        check=True,
        cwd=str(target_root),
    )
    return repo_dir


def prepare_synthetic_targets(target_root: Path) -> Dict[str, TargetRepo]:
    fresh_empty = target_root / "fresh-empty-node"
    fresh_empty.mkdir(parents=True, exist_ok=True)
    write_json(
        fresh_empty / "package.json",
        {
            "name": "ttfv-empty-node",
            "version": "0.0.1",
        },
    )

    python_min = target_root / "minimal-python"
    python_min.mkdir(parents=True, exist_ok=True)
    write_text(
        python_min / "pyproject.toml",
        "\n".join(
            [
                "[project]",
                'name = "ttfv-python"',
                'version = "0.1.0"',
            ]
        )
        + "\n",
    )
    write_text(python_min / "requirements.txt", "pytest>=8.0.0\nruff>=0.5.0\n")
    write_text(python_min / "src" / "main.py", "def main():\n    return 'ok'\n")

    return {
        "fresh-empty-node": TargetRepo(
            key="fresh-empty-node",
            label="Fresh empty directory with package.json",
            path=fresh_empty,
            origin="synthetic",
        ),
        "minimal-python": TargetRepo(
            key="minimal-python",
            label="Minimal Python repo",
            path=python_min,
            origin="synthetic",
        ),
    }


def prepare_targets(target_root: Path) -> List[TargetRepo]:
    synthetic = prepare_synthetic_targets(target_root)
    home_assistant_path = ensure_home_assistant_clone(target_root)
    targets = [
        TargetRepo(
            key="nerviq-research",
            label="nerviq-research",
            path=Path(r"c:\Users\naorp\nerviq-research"),
            origin="existing-local",
        ),
        synthetic["fresh-empty-node"],
        TargetRepo(
            key="home-assistant-core",
            label="home-assistant/core",
            path=home_assistant_path,
            origin="git-clone-depth-1",
        ),
        synthetic["minimal-python"],
    ]
    return targets


def run_node_probe(samples: int) -> List[Dict[str, object]]:
    results = []
    for index in range(samples):
        result = run_streaming_command(
            ["node", "-e", "console.log('NODE_READY')"],
            cwd=REPO_ROOT,
            useful_matcher=lambda line: "NODE_READY" in line,
            action_matcher=lambda line: False,
        )
        result["sample"] = index + 1
        results.append(result)
    return results


def benchmark_breakdown(scenario: Scenario, samples: int, node_probe: List[Dict[str, object]]) -> Dict[str, object]:
    resolve_runs = []
    if scenario.node_ready_command is not None:
        for index in range(samples):
            resolve = run_streaming_command(
                scenario.node_ready_command(index),
                cwd=REPO_ROOT,
                env=scenario.env_for_run(index),
                useful_matcher=lambda line: "NPX_READY" in line,
                action_matcher=lambda line: False,
            )
            resolve["sample"] = index + 1
            resolve_runs.append(resolve)

    version_runs = []
    for index in range(samples):
        version = run_streaming_command(
            scenario.version_command(index),
            cwd=REPO_ROOT,
            env=scenario.env_for_run(index),
            useful_matcher=lambda line: bool(line.strip()),
            action_matcher=lambda line: False,
        )
        version["sample"] = index + 1
        version_runs.append(version)

    node_summary = summarize(run["useful_ms"] for run in node_probe)
    resolve_summary = summarize(run["useful_ms"] for run in resolve_runs) if resolve_runs else {"median_ms": None, "p90_ms": None, "p99_ms": None}
    version_summary = summarize(run["useful_ms"] for run in version_runs)

    node_median = node_summary["median_ms"]
    resolve_median = resolve_summary["median_ms"]
    version_median = version_summary["median_ms"]

    npx_resolve_ms = None
    cli_load_ms = None
    if resolve_median is not None and node_median is not None:
        npx_resolve_ms = safe_round(max(0.0, resolve_median - node_median))
    if version_median is not None:
        if resolve_median is not None:
            cli_load_ms = safe_round(max(0.0, version_median - resolve_median))
        elif node_median is not None:
            cli_load_ms = safe_round(max(0.0, version_median - node_median))

    return {
        "node_probe_runs": node_probe,
        "resolve_probe_runs": resolve_runs,
        "version_probe_runs": version_runs,
        "node_probe_summary": node_summary,
        "resolve_probe_summary": resolve_summary,
        "version_probe_summary": version_summary,
        "breakdown_median_ms": {
            "node_start_ms": node_median,
            "npx_resolve_ms": npx_resolve_ms,
            "cli_load_ms": cli_load_ms,
        },
    }


def benchmark_scenario_repo(scenario: Scenario, target: TargetRepo, samples: int) -> Dict[str, object]:
    runs = []
    for index in range(samples):
        result = run_streaming_command(
            scenario.audit_command(target, index),
            cwd=REPO_ROOT,
            env=scenario.env_for_run(index),
        )
        result["sample"] = index + 1
        runs.append(result)

    useful_summary = summarize(run["useful_ms"] for run in runs)
    action_summary = summarize(run["action_ms"] for run in runs)
    total_summary = summarize(run["total_ms"] for run in runs)

    return {
        "scenario": scenario.key,
        "scenario_label": scenario.label,
        "target": target.key,
        "target_label": target.label,
        "target_path": str(target.path),
        "runs": runs,
        "wall_clock_ttfv_ms": useful_summary,
        "cognitive_ttfv_ms": action_summary,
        "process_total_ms": total_summary,
    }


def profile_checks(targets: List[TargetRepo], samples: int) -> Dict[str, object]:
    script = r"""
const { ProjectContext } = require(process.argv[1] + '/src/context');
const { TECHNIQUES } = require(process.argv[1] + '/src/techniques');
const targetDir = process.argv[2];
const ctx = new ProjectContext(targetDir);
const rows = [];
for (const [key, technique] of Object.entries(TECHNIQUES)) {
  const started = process.hrtime.bigint();
  try {
    technique.check(ctx);
  } catch (error) {
    // Profiling should observe the cost even if the check throws.
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  rows.push({ key, name: technique.name, elapsedMs });
}
console.log(JSON.stringify(rows));
"""

    repo_results: Dict[str, object] = {}
    aggregate: Dict[str, List[float]] = {}
    name_lookup: Dict[str, str] = {}

    for target in targets:
        runs = []
        for _ in range(samples):
            completed = subprocess.run(
                ["node", "-e", script, str(REPO_ROOT), str(target.path)],
                check=True,
                cwd=str(REPO_ROOT),
                capture_output=True,
                env=merged_env(),
                **TEXT_SUBPROCESS_KWARGS,
            )
            rows = json.loads(completed.stdout)
            runs.append(rows)

        per_key: Dict[str, List[float]] = {}
        for rows in runs:
            for row in rows:
                key = row["key"]
                elapsed = float(row["elapsedMs"])
                per_key.setdefault(key, []).append(elapsed)
                aggregate.setdefault(key, []).append(elapsed)
                name_lookup[key] = row["name"]

        slow_checks = []
        for key, values in per_key.items():
            stats = summarize(values)
            if stats["median_ms"] is not None and stats["median_ms"] > 500:
                slow_checks.append(
                    {
                        "key": key,
                        "name": name_lookup.get(key, key),
                        **stats,
                    }
                )
        slow_checks.sort(key=lambda item: item["median_ms"], reverse=True)

        repo_results[target.key] = {
            "target_label": target.label,
            "slow_checks_over_500ms": slow_checks,
        }

    aggregate_slow = []
    for key, values in aggregate.items():
        stats = summarize(values)
        if stats["median_ms"] is not None and stats["median_ms"] > 500:
            aggregate_slow.append(
                {
                    "key": key,
                    "name": name_lookup.get(key, key),
                    **stats,
                }
            )
    aggregate_slow.sort(key=lambda item: item["median_ms"], reverse=True)

    return {
        "per_repo": repo_results,
        "aggregate_slow_checks_over_500ms": aggregate_slow,
    }


def format_ms(value: Optional[float]) -> str:
    return "N/A" if value is None else f"{value} ms"


def format_run_series(runs: List[Dict[str, object]], key: str) -> str:
    values = []
    for run in runs:
        value = run.get(key)
        values.append("N/A" if value is None else str(value))
    return ", ".join(values)


def build_markdown_report(payload: Dict[str, object]) -> str:
    generated_at = payload["generated_at"]
    samples = payload["samples"]
    scenarios = payload["scenario_results"]
    breakdowns = payload["scenario_breakdowns"]
    slow_checks = payload["slow_check_profile"]

    all_useful = []
    verdict = "TRUE"
    for scenario in scenarios:
        for repo in scenario["repos"]:
            median = repo["wall_clock_ttfv_ms"]["median_ms"]
            if median is not None:
                all_useful.append(
                    {
                        "scenario": scenario["scenario_label"],
                        "target": repo["target_label"],
                        "median_ms": median,
                    }
                )
                if median > 120000:
                    verdict = "FALSE"

    if verdict != "FALSE" and any(item["median_ms"] > 60000 for item in all_useful):
        verdict = "depends on scenario"

    max_case = max(all_useful, key=lambda item: item["median_ms"]) if all_useful else None

    lines = [
        "# GOV-03 — Time-to-First-Value measurement (2026-04-13)",
        "",
        f"Generated: {generated_at}",
        "",
        "## Methodology",
        "",
        f"- Sample size: {samples} runs per scenario x repo combination.",
        "- Wall-clock TTFV = invocation start to the first line that includes a score (`/100`, `Score:`) or equivalent useful audit signal.",
        "- Cognitive TTFV = invocation start to the first actionable recommendation line (`1. ...`, `Next command:`, `Ready? Run:`).",
        "- Scenarios measured: cold `npx`, warm `npx`, isolated global install, and local clone via `node bin/cli.js`.",
        "- Target repos: `c:/Users/naorp/nerviq-research`, a fresh package.json-only directory, a shallow clone of `home-assistant/core`, and a minimal Python repo.",
        f"- Startup breakdown probes were measured separately with {samples} real runs per scenario.",
        "",
        "## Verdict",
        "",
        f"Under 2 min claim: **{verdict}**.",
    ]

    if max_case:
        lines.append(
            f"- Slowest measured median wall-clock TTFV: **{max_case['median_ms']} ms** in **{max_case['scenario']} / {max_case['target']}**."
        )
    lines.extend([
        "",
        "## Raw timing table",
        "",
        "| Scenario | Repo | Wall-clock runs (ms) | Cognitive runs (ms) | Total runs (ms) |",
        "|---|---|---|---|---|",
    ])

    for scenario in scenarios:
        for repo in scenario["repos"]:
            lines.append(
                f"| {scenario['scenario_label']} | {repo['target_label']} | "
                f"{format_run_series(repo['runs'], 'useful_ms')} | "
                f"{format_run_series(repo['runs'], 'action_ms')} | "
                f"{format_run_series(repo['runs'], 'total_ms')} |"
            )

    lines.extend([
        "",
        "## Summary statistics",
        "",
        "| Scenario | Repo | Wall-clock median | Wall-clock p90 | Wall-clock p99 | Cognitive median | Cognitive p90 | Cognitive p99 | Total median |",
        "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ])

    for scenario in scenarios:
        for repo in scenario["repos"]:
            lines.append(
                f"| {scenario['scenario_label']} | {repo['target_label']} | "
                f"{format_ms(repo['wall_clock_ttfv_ms']['median_ms'])} | {format_ms(repo['wall_clock_ttfv_ms']['p90_ms'])} | {format_ms(repo['wall_clock_ttfv_ms']['p99_ms'])} | "
                f"{format_ms(repo['cognitive_ttfv_ms']['median_ms'])} | {format_ms(repo['cognitive_ttfv_ms']['p90_ms'])} | {format_ms(repo['cognitive_ttfv_ms']['p99_ms'])} | "
                f"{format_ms(repo['process_total_ms']['median_ms'])} |"
            )

    lines.extend([
        "",
        "## Cold-start breakdown",
        "",
        "| Scenario | Node start | npx resolve | CLI load | Audit to first useful line* |",
        "|---|---:|---:|---:|---:|",
    ])

    for scenario in scenarios:
        breakdown = breakdowns[scenario["scenario_key"]]
        node_start = breakdown["breakdown_median_ms"]["node_start_ms"]
        npx_resolve = breakdown["breakdown_median_ms"]["npx_resolve_ms"]
        cli_load = breakdown["breakdown_median_ms"]["cli_load_ms"]
        repo_medians = [
            repo["wall_clock_ttfv_ms"]["median_ms"]
            for repo in scenario["repos"]
            if repo["wall_clock_ttfv_ms"]["median_ms"] is not None
        ]
        audit_median = safe_round(statistics.median(repo_medians)) if repo_medians else None
        if breakdown["version_probe_summary"]["median_ms"] is not None and audit_median is not None:
            audit_median = safe_round(max(0.0, audit_median - breakdown["version_probe_summary"]["median_ms"]))
        lines.append(
            f"| {scenario['scenario_label']} | {node_start} ms | "
            f"{'N/A' if npx_resolve is None else f'{npx_resolve} ms'} | "
            f"{'N/A' if cli_load is None else f'{cli_load} ms'} | "
            f"{'N/A' if audit_median is None else f'{audit_median} ms'} |"
        )

    lines.extend([
        "",
        "* Audit-to-first-useful-line is derived from measured `version` startup and the audit TTFV median for the same scenario.",
        "",
        "## Bottlenecks",
        "",
    ])

    aggregate_slow = slow_checks["aggregate_slow_checks_over_500ms"]
    if not aggregate_slow:
        lines.append(f"- No individual check crossed the 500 ms median threshold in the {samples}-run local per-check profiling pass.")
    else:
        for item in aggregate_slow:
            lines.append(
                f"- `{item['key']}` ({item['name']}) median {item['median_ms']} ms, p90 {item['p90_ms']} ms, p99 {item['p99_ms']} ms."
            )

    lines.extend([
        "",
        "## Recommendations",
        "",
    ])

    recommendations = []
    scenario_peaks = []
    for scenario in scenarios:
        repo_medians = [
            repo["wall_clock_ttfv_ms"]["median_ms"]
            for repo in scenario["repos"]
            if repo["wall_clock_ttfv_ms"]["median_ms"] is not None
        ]
        if repo_medians:
            scenario_peaks.append(
                {
                    "scenario": scenario["scenario_label"],
                    "median_ms": max(repo_medians),
                }
            )

    if scenario_peaks:
        slowest_scenario = max(scenario_peaks, key=lambda item: item["median_ms"])
        recommendations.append(
            f"1. Reduce package-entry overhead in the slowest path ({slowest_scenario['scenario']}), because its worst-case median is {slowest_scenario['median_ms']} ms before users see value."
        )
    else:
        recommendations.append(
            "1. Re-run the benchmark after confirming that each scenario emits a score line, because at least one scenario did not produce enough timing data for comparison."
        )
    recommendations.append(
        "2. Publish and document a cache-friendly install path (`npm install -g` or local clone) for repeated usage, since both avoid the cold `npx` resolution tax."
    )
    recommendations.append(
        "3. Keep the default audit output score and first recommendation near the top of the render path, because cognitive TTFV depends on how quickly the first actionable line appears after the score."
    )
    if aggregate_slow:
        slowest_check = aggregate_slow[0]
        recommendations.append(
            f"4. Investigate `{slowest_check['key']}` first; it is the only measured check above the 500 ms threshold."
        )
    else:
        recommendations.append(
            "4. The current bottleneck is startup + package resolution rather than any single check, so optimization work should start above the per-check layer."
        )

    lines.extend(recommendations)
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark nerviq TTFV across delivery scenarios.")
    parser.add_argument("--samples", type=int, default=5, help="Number of runs per scenario x repo combination (default: 5).")
    parser.add_argument(
        "--json-out",
        type=Path,
        default=REPO_ROOT / "research" / "gov-03-ttfv-measurement-2026-04-13.json",
        help="Where to write the raw JSON benchmark output.",
    )
    parser.add_argument(
        "--markdown-out",
        type=Path,
        default=REPO_ROOT / "research" / "gov-03-ttfv-measurement-2026-04-13.md",
        help="Where to write the markdown report.",
    )
    parser.add_argument(
        "--workspace-root",
        type=Path,
        default=Path.home() / "nerviq-ttfv-bench",
        help="Directory for caches, synthetic repos, and shallow clones.",
    )
    args = parser.parse_args()

    workspace_root = ensure_dir(args.workspace_root)
    target_root = ensure_dir(workspace_root / "targets")
    cache_root = ensure_dir(workspace_root / "cache")

    targets = prepare_targets(target_root)
    scenarios: List[Scenario] = [
        ColdNpxScenario(cache_root / "npx-cold"),
        WarmNpxScenario(cache_root / "npx-warm"),
        GlobalInstallScenario(cache_root / "global"),
        LocalCloneScenario(REPO_ROOT),
    ]

    node_probe = run_node_probe(args.samples)
    scenario_results = []
    scenario_breakdowns = {}

    for scenario in scenarios:
        scenario.prepare()
        breakdown = benchmark_breakdown(scenario, args.samples, node_probe)
        scenario_breakdowns[scenario.key] = breakdown

        repo_results = []
        for target in targets:
            repo_results.append(benchmark_scenario_repo(scenario, target, args.samples))

        scenario_results.append(
            {
                "scenario_key": scenario.key,
                "scenario_label": scenario.label,
                "repos": repo_results,
            }
        )

    slow_check_profile = profile_checks(targets, args.samples)

    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "samples": args.samples,
        "repo_root": str(REPO_ROOT),
        "workspace_root": str(workspace_root),
        "targets": [
            {
                "key": target.key,
                "label": target.label,
                "path": str(target.path),
                "origin": target.origin,
            }
            for target in targets
        ],
        "scenario_results": scenario_results,
        "scenario_breakdowns": scenario_breakdowns,
        "slow_check_profile": slow_check_profile,
    }

    write_json(args.json_out, payload)
    write_text(args.markdown_out, build_markdown_report(payload))
    print(json.dumps({"json_out": str(args.json_out), "markdown_out": str(args.markdown_out)}, indent=2))
    return 0


REPO_ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    sys.exit(main())
