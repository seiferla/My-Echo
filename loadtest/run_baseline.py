"""Runs the load test levels as described in docs/goals.md.

    python loadtest/run_baseline.py                      # levels 5, 10, 20, 3 runs each, 1 min ramp-up + 5 min measurement
    python loadtest/run_baseline.py --quick              # short run to test the setup (not committed)
    python loadtest/run_baseline.py --users 40 80 160    # stress test

Per run: start a fresh backend in mock mode, prepare users and tokens, run Locust, stop the
backend. CPU and memory of backend and Locust are logged; a run is invalid if Locust uses
more than 70 % CPU. Needs a running Supabase stack (`npx supabase start`) or SUPABASE_* and
DATABASE_URL in the environment.
"""
import argparse
import datetime
import json
import os
import platform
import subprocess
import sys
import threading
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import prepare  # noqa: E402


def read_json(path: str):
    with open(path) as f:
        return json.load(f)


def write_json(path: str, data) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def sh(*cmd) -> str:
    try:
        return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True).stdout.strip()
    except OSError:
        return ""


def wait_for(url: str, seconds: int = 30) -> None:
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=2).read()
            return
        except OSError:
            time.sleep(0.5)
    raise SystemExit(f"backend did not become ready at {url}")


def ps(pid: int) -> tuple[float, float]:
    out = sh("ps", "-o", "%cpu=,rss=", "-p", str(pid)).split()
    return (float(out[0]), float(out[1]) / 1024) if len(out) == 2 else (0.0, 0.0)


class ResourceLog(threading.Thread):
    """Writes CPU (% of one core) and memory (MB) of backend and Locust every 5 s."""

    def __init__(self, path: str, backend_pid: int):
        super().__init__(daemon=True)
        self.path, self.backend_pid, self.locust_pid, self.stop = path, backend_pid, None, threading.Event()

    def run(self):
        start = time.time()
        with open(self.path, "w") as f:
            f.write("seconds,backend_cpu_pct,backend_rss_mb,locust_cpu_pct,locust_rss_mb\n")
            while not self.stop.wait(5):
                b_cpu, b_mem = ps(self.backend_pid)
                l_cpu, l_mem = ps(self.locust_pid) if self.locust_pid else (0.0, 0.0)
                f.write(f"{time.time() - start:.0f},{b_cpu},{b_mem:.1f},{l_cpu},{l_mem:.1f}\n")
                f.flush()


def verify_isolation(run_dir: str, tokens_path: str, port: int) -> dict:
    """Each user reads their chats. They must see only their own chat, only messages with
    their own marker, and exactly as many as they saved (nothing lost, nothing foreign)."""
    violations = []
    tokens = read_json(tokens_path)
    for user in tokens:
        index = user["index"]
        state_path = os.path.join(run_dir, "state", f"user-{index:03d}.json")
        saved = read_json(state_path)["saved_messages"] if os.path.exists(state_path) else None
        request = urllib.request.Request(f"http://127.0.0.1:{port}/chats",
                                         headers={"Authorization": f"Bearer {user['token']}"})
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                chats = json.loads(response.read())
        except OSError as e:
            violations.append(f"user {index}: could not read chats ({e})")
            continue
        marker = f"LT{index:03d}-"
        if any(c["id"] != f"lt-{index:03d}" for c in chats):
            violations.append(f"user {index}: sees a chat that is not their own")
        if any(not m["content"].startswith(marker) for c in chats for m in c["messages"]):
            violations.append(f"user {index}: sees a message with a foreign marker")
        stored = sum(len(c["messages"]) for c in chats)
        if saved is None:
            violations.append(f"user {index}: no saved state from Locust")
        elif stored != saved:
            violations.append(f"user {index}: {stored} messages stored, {saved} saved")
    result = {"users_checked": len(tokens), "violations": violations}
    write_json(os.path.join(run_dir, "isolation.json"), result)
    return result


def run_once(args, settings, users: int, run_no: int, run_dir: str) -> None:
    os.makedirs(run_dir, exist_ok=True)
    tokens_path = os.path.join(run_dir, ".tokens.json")
    prepare.prepare(settings, users, tokens_path)

    backend_env = {
        **os.environ,
        "TTS_PROVIDER": "mock",
        "MOCK_TTS_FIRST_AUDIO_MS": str(args.mock_delay_ms),
        "MOCK_TTS_CHUNK_MS": str(args.mock_chunk_ms),
        "RATE_LIMIT_TTS": args.rate_limit,
        "DATABASE_URL": settings["DATABASE_URL"],
        "SUPABASE_URL": settings["SUPABASE_URL"],
    }
    backend_env.pop("TTS_API_KEY", None)  # proves that the mock needs no Fish key
    with open(os.path.join(run_dir, "backend.log"), "w") as backend_log, \
         open(os.path.join(run_dir, "locust.log"), "w") as locust_log:
        backend = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "main:app", "--port", str(args.port)],
            cwd=os.path.join(ROOT, "backend"), env=backend_env, stdout=backend_log, stderr=subprocess.STDOUT)
        resources = ResourceLog(os.path.join(run_dir, "resources.csv"), backend.pid)
        try:
            wait_for(f"http://127.0.0.1:{args.port}/health")
            resources.start()
            spawn_rate = users / args.ramp
            locust = subprocess.Popen(
                [sys.executable, "-m", "locust", "-f", os.path.join(ROOT, "loadtest", "locustfile.py"),
                 "--headless", "-u", str(users), "-r", f"{spawn_rate:.4f}",
                 "--run-time", f"{args.ramp + args.measure}s", "--reset-stats", "--stop-timeout", "30",
                 "--csv", os.path.join(run_dir, "locust"), "--csv-full-history",
                 "--host", f"http://127.0.0.1:{args.port}", "--loglevel", "WARNING"],
                cwd=ROOT, env={**os.environ, "LOADTEST_TOKENS": tokens_path, "LOADTEST_SEED": str(args.seed),
                               "LOADTEST_STATE_DIR": os.path.join(run_dir, "state")},
                stdout=locust_log, stderr=subprocess.STDOUT)
            resources.locust_pid = locust.pid
            code = locust.wait()
            isolation = verify_isolation(run_dir, tokens_path, args.port)
        finally:
            resources.stop.set()
            backend.terminate()
            try:
                backend.wait(timeout=10)
            except subprocess.TimeoutExpired:
                backend.kill()
            if os.path.exists(tokens_path):
                os.remove(tokens_path)

    meta = {
        "tag": args.tag, "users": users, "run": run_no,
        "ramp_seconds": args.ramp, "measure_seconds": args.measure, "seed": args.seed,
        "mock_first_audio_ms": args.mock_delay_ms, "mock_chunk_ms": args.mock_chunk_ms,
        "rate_limit_tts": args.rate_limit, "locust_exit_code": code,
        "started": datetime.datetime.now().isoformat(timespec="seconds"),
        "git_commit": sh("git", "rev-parse", "HEAD"),
        "git_dirty": bool(sh("git", "status", "--porcelain", "--", "backend", "loadtest")),
        "python": sys.version.split()[0], "platform": platform.platform(), "cpu_count": os.cpu_count(),
        "setup": "backend (1 uvicorn worker) + local Supabase Postgres container + load generator on the SAME machine",
    }
    write_json(os.path.join(run_dir, "meta.json"), meta)
    print(f"  users={users} run={run_no}: locust exit code {code}, "
          f"isolation violations {len(isolation['violations'])}", flush=True)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--users", type=int, nargs="+", default=[5, 10, 20])
    p.add_argument("--runs", type=int, default=3)
    p.add_argument("--ramp", type=int, default=60, help="seconds of ramp-up (values are discarded)")
    p.add_argument("--measure", type=int, default=300, help="seconds of measurement")
    p.add_argument("--mock-delay-ms", type=int, default=1500)
    p.add_argument("--mock-chunk-ms", type=int, default=20)
    p.add_argument("--rate-limit", default="100000/minute", help="RATE_LIMIT_TTS during the test")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--port", type=int, default=4455)
    p.add_argument("--tag", default="E1", help="E1 = backend + Postgres container, E2 = Supabase cloud")
    p.add_argument("--out", help="result folder (default: loadtest/results/<tag>-<time>)")
    p.add_argument("--quick", action="store_true", help="short test run, 1 run per level, 10 s ramp, 30 s measurement")
    args = p.parse_args()
    if args.quick:
        args.runs, args.ramp, args.measure, args.tag = 1, 10, 30, "quick"

    out = args.out or os.path.join(ROOT, "loadtest", "results",
                                   f"{args.tag}-{datetime.datetime.now():%Y%m%d-%H%M%S}")
    settings = prepare.load_settings(ROOT)
    total = len(args.users) * args.runs * (args.ramp + args.measure + 45) / 60
    print(f"results: {out}\nlevels {args.users}, {args.runs} run(s) each, about {total:.0f} minutes", flush=True)
    for users in args.users:
        for run_no in range(1, args.runs + 1):
            run_once(args, settings, users, run_no, os.path.join(out, f"u{users:03d}-run{run_no}"))
    print(f"done. Summary: python loadtest/summarize.py {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
