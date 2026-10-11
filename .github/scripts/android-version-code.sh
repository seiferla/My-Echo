#!/usr/bin/env bash
# Berechnet den Android-versionCode für ALLE Build-Workflows nach derselben Formel:
# Sekunden seit 2026-01-01 00:00 UTC.
#
# Warum Zeit statt github.run_number: Jeder Workflow hat einen eigenen Lauf-Zähler.
# Mit mehreren Workflows (Release, Merge-Build) laufen die Zähler auseinander, und
# Play lehnt Bundles mit niedrigerem Code ab ("no existing users can upgrade").
# Die Zeit steigt über alle Workflows hinweg monoton.
#
# Limit: Play erlaubt max. 2.100.000.000. Mit dieser Formel reicht das für ~66 Jahre.
set -euo pipefail

EPOCH_START=1767225600   # 2026-01-01T00:00:00Z
echo $(( $(date -u +%s) - EPOCH_START ))
