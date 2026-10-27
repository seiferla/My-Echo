#!/usr/bin/env bash
# Computes the Android versionCode for ALL build workflows with the same formula:
# seconds since 2026-01-01 00:00 UTC.
#
# Why time instead of github.run_number: every workflow has its own run counter.
# With several workflows (release, merge build) the counters drift apart, and
# Play rejects bundles with a lower code ("no existing users can upgrade").
# Time always grows, across all workflows.
#
# Limit: Play allows max. 2,100,000,000. With this formula that lasts ~66 years.
set -euo pipefail

EPOCH_START=1767225600   # 2026-01-01T00:00:00Z
echo $(( $(date -u +%s) - EPOCH_START ))
