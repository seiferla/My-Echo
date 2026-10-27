"""Summarizes the load test runs. Method and limits: docs/goals.md.

    python loadtest/summarize.py loadtest/results/E1-20261022-120000

Per level: median and range (min to max) over the runs. No standard deviation: n = 3 is too small.
"""
import csv
import glob
import json
import os
import statistics
import sys

# Real requests only. The other [..] TTS entries are measured from the same request.
REAL = ["/chats GET", "/chats PUT", "/stream/tts [headers]"]
LIMITS = {"chats_p95_ms": 300, "tts_overhead_p95_ms": 100, "error_rate_pct": 1.0}
MAX_GENERATOR_CPU = 70.0


def read_json(path: str):
    with open(path) as f:
        return json.load(f)


def read_csv(path: str) -> list[dict]:
    with open(path) as f:
        return list(csv.DictReader(f))


def one_run(run_dir: str) -> dict:
    stats = {r["Name"]: r for r in read_csv(os.path.join(run_dir, "locust_stats.csv"))}
    meta = read_json(os.path.join(run_dir, "meta.json"))

    def get(name: str, col: str) -> float:
        return float(stats[name][col]) if name in stats else float("nan")

    requests = sum(get(n, "Request Count") for n in REAL)
    failures = sum(get(n, "Failure Count") for n in REAL)
    resources = read_csv(os.path.join(run_dir, "resources.csv"))
    generator_cpu = max((float(r["locust_cpu_pct"]) for r in resources), default=0.0)
    problems = []
    if meta["locust_exit_code"] != 0:
        problems.append(f"locust exit code {meta['locust_exit_code']}")
    if generator_cpu > MAX_GENERATOR_CPU:
        problems.append(f"load generator CPU {generator_cpu:.0f} % > {MAX_GENERATOR_CPU:.0f} %")
    isolation = read_json(os.path.join(run_dir, "isolation.json"))
    if isolation["users_checked"] != meta["users"]:
        problems.append(f"isolation check ran for {isolation['users_checked']} of {meta['users']} users")
    return {
        "users": meta["users"], "run": meta["run"],
        "chats_p95_ms": get("/chats GET", "95%"),
        "tts_overhead_p95_ms": get("/stream/tts [overhead]", "95%"),
        "tts_first_audio_p95_ms": get("/stream/tts [first audio byte]", "95%"),
        "error_rate_pct": 100 * failures / requests if requests else float("nan"),
        "requests": requests,
        "throughput_rps": sum(get(n, "Requests/s") for n in REAL),
        "isolation_violations": len(isolation["violations"]),
        "isolation_details": "; ".join(isolation["violations"]),
        "backend_cpu_max_pct": max((float(r["backend_cpu_pct"]) for r in resources), default=0.0),
        "backend_rss_max_mb": max((float(r["backend_rss_mb"]) for r in resources), default=0.0),
        "generator_cpu_max_pct": generator_cpu,
        "problems": problems,
    }


def spread(values: list[float], unit: str = "", digits: int = 0) -> str:
    v = [x for x in values if x == x]  # drop NaN
    if not v:
        return "n/a"
    f = f"{{:.{digits}f}}"
    return f"{f.format(statistics.median(v))}{unit} ({f.format(min(v))} to {f.format(max(v))})"


def verdict(level_runs: list[dict]) -> str:
    def median(key: str) -> float:
        return statistics.median([r[key] for r in level_runs])

    bad = [k for k, limit in LIMITS.items() if median(k) >= limit]
    if sum(r["isolation_violations"] for r in level_runs) > 0:
        bad.append("isolation")
    return "PASS" if not bad else "FAIL: " + ", ".join(bad)


def main(result_dir: str) -> int:
    run_dirs = sorted(d for d in glob.glob(os.path.join(result_dir, "u*-run*")) if os.path.isdir(d))
    if not run_dirs:
        print(f"no runs found in {result_dir}")
        return 1
    runs = [one_run(d) for d in run_dirs]
    with open(os.path.join(result_dir, "runs.csv"), "w", newline="") as f:
        cols = [k for k in runs[0] if k != "problems"]
        w = csv.DictWriter(f, fieldnames=cols + ["problems"])
        w.writeheader()
        for r in runs:
            w.writerow({**r, "problems": "; ".join(r["problems"])})

    meta = read_json(os.path.join(run_dirs[0], "meta.json"))
    lines = [
        f"# Load test {meta['tag']}: summary", "",
        f"Commit `{meta['git_commit'][:8]}`{' (uncommitted changes)' if meta['git_dirty'] else ''}, "
        f"{meta['started'][:10]}, {meta['platform']}, {meta['cpu_count']} cores. {meta['setup']}.",
        f"Mock TTS delay {meta['mock_first_audio_ms']} ms, seed {meta['seed']}, "
        f"{meta['ramp_seconds']} s ramp-up (discarded) + {meta['measure_seconds']} s measurement per run.",
        "Values: median over the runs, in brackets min to max.", "",
        "| Users | Runs | p95 `/chats` | p95 TTS overhead | Errors | Throughput | Isolation violations | Backend CPU max | Verdict |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    invalid = []
    for users in sorted({r["users"] for r in runs}):
        level = [r for r in runs if r["users"] == users]
        ok = [r for r in level if not r["problems"]]
        invalid += [f"users={r['users']} run={r['run']}: {'; '.join(r['problems'])}" for r in level if r["problems"]]
        if not ok:
            lines.append(f"| {users} | 0 of {len(level)} valid | | | | | | | INVALID |")
            continue
        lines.append(
            f"| {users} | {len(ok)} of {len(level)} | {spread([r['chats_p95_ms'] for r in ok], ' ms')} "
            f"| {spread([r['tts_overhead_p95_ms'] for r in ok], ' ms')} "
            f"| {spread([r['error_rate_pct'] for r in ok], ' %', 2)} "
            f"| {spread([r['throughput_rps'] for r in ok], ' req/s', 1)} "
            f"| {sum(r['isolation_violations'] for r in ok):.0f} "
            f"| {spread([r['backend_cpu_max_pct'] for r in ok], ' %')} | {verdict(ok)} |")
    lines += ["", f"Limits (goals.md, at 20 users): p95 `/chats` < {LIMITS['chats_p95_ms']} ms, "
              f"p95 TTS overhead < {LIMITS['tts_overhead_p95_ms']} ms, errors < {LIMITS['error_rate_pct']} %, "
              "isolation violations = 0."]
    if invalid:
        lines += ["", "Invalid runs (excluded):"] + [f"- {x}" for x in invalid]
    text = "\n".join(lines) + "\n"
    with open(os.path.join(result_dir, "summary.md"), "w") as f:
        f.write(text)
    print(text)
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(main(sys.argv[1]))
