"""Tests for the load test logic (texts, summary). No server needed: pytest loadtest"""
import csv
import json
import os
import random
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import locustfile  # noqa: E402
import summarize  # noqa: E402


class TestMessageTexts(unittest.TestCase):
    def texts(self, seed=1, n=2000):
        rng = random.Random(seed)
        return [locustfile.make_text(rng) for _ in range(n)]

    def test_texts_are_never_empty_and_never_longer_than_200(self):
        for t in self.texts():
            self.assertTrue(0 < len(t) <= 200)

    def test_length_mix_matches_goals_md(self):
        t = self.texts()
        short = sum(len(x) <= 20 for x in t) / len(t)
        long = sum(len(x) > 80 for x in t) / len(t)
        self.assertAlmostEqual(short, 0.50, delta=0.06)
        self.assertAlmostEqual(long, 0.15, delta=0.05)

    def test_same_seed_gives_the_same_texts(self):
        self.assertEqual(self.texts(seed=7, n=50), self.texts(seed=7, n=50))
        self.assertNotEqual(self.texts(seed=7, n=50), self.texts(seed=8, n=50))


class TestSummary(unittest.TestCase):
    def make_run(self, root, users, run, *, chats_p95=20, overhead_p95=6, failures=0,
                 generator_cpu=5.0, exit_code=0, violations=(), checked=None):
        d = os.path.join(root, f"u{users:03d}-run{run}")
        os.makedirs(d)
        cols = ["Type", "Name", "Request Count", "Failure Count", "Requests/s", "95%"]
        with open(os.path.join(d, "locust_stats.csv"), "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            for name, n, fail, p95 in [("/chats GET", 100, failures, chats_p95), ("/chats PUT", 100, 0, 30),
                                       ("/stream/tts [headers]", 100, 0, 5),
                                       ("/stream/tts [overhead]", 100, 0, overhead_p95),
                                       ("/stream/tts [first audio byte]", 100, 0, 1500)]:
                w.writerow({"Type": "X", "Name": name, "Request Count": n, "Failure Count": fail,
                            "Requests/s": 1.0, "95%": p95})
        with open(os.path.join(d, "resources.csv"), "w") as f:
            f.write("seconds,backend_cpu_pct,backend_rss_mb,locust_cpu_pct,locust_rss_mb\n")
            f.write(f"5,10,90,{generator_cpu},70\n")
        with open(os.path.join(d, "meta.json"), "w") as f:
            json.dump({"users": users, "run": run, "locust_exit_code": exit_code}, f)
        with open(os.path.join(d, "isolation.json"), "w") as f:
            json.dump({"users_checked": users if checked is None else checked, "violations": list(violations)}, f)
        return d

    def test_a_clean_run_has_no_problems(self):
        with tempfile.TemporaryDirectory() as root:
            r = summarize.one_run(self.make_run(root, 5, 1))
        self.assertEqual(r["problems"], [])
        self.assertEqual(r["chats_p95_ms"], 20)
        self.assertEqual(r["tts_overhead_p95_ms"], 6)
        self.assertEqual(r["error_rate_pct"], 0)

    def test_error_rate_counts_only_real_requests(self):
        with tempfile.TemporaryDirectory() as root:
            r = summarize.one_run(self.make_run(root, 5, 1, failures=3))
        self.assertAlmostEqual(r["error_rate_pct"], 100 * 3 / 300)  # 3 of 300 real requests

    def test_busy_load_generator_makes_the_run_invalid(self):
        with tempfile.TemporaryDirectory() as root:
            r = summarize.one_run(self.make_run(root, 5, 1, generator_cpu=85))
        self.assertTrue(any("load generator" in p for p in r["problems"]))

    def test_locust_failure_and_missing_isolation_check_make_it_invalid(self):
        with tempfile.TemporaryDirectory() as root:
            r = summarize.one_run(self.make_run(root, 5, 1, exit_code=1, checked=3))
        self.assertEqual(len(r["problems"]), 2)

    def test_verdict_uses_the_median_and_the_limits(self):
        good = {"chats_p95_ms": 50, "tts_overhead_p95_ms": 10, "error_rate_pct": 0.0, "isolation_violations": 0}
        self.assertEqual(summarize.verdict([good] * 3), "PASS")
        slow = {**good, "chats_p95_ms": 400}
        self.assertIn("chats_p95_ms", summarize.verdict([slow] * 3))
        # one outlier in three runs does not change the verdict (median)
        self.assertEqual(summarize.verdict([good, good, slow]), "PASS")
        self.assertIn("isolation", summarize.verdict([good, good, {**good, "isolation_violations": 1}]))

    def test_spread_shows_median_and_range(self):
        self.assertEqual(summarize.spread([10, 30, 20], " ms"), "20 ms (10 to 30)")
        self.assertEqual(summarize.spread([float("nan")]), "n/a")


if __name__ == "__main__":
    unittest.main()
