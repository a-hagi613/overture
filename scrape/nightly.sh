#!/usr/bin/env bash
# Overnight seed crawl, phase 1.
#
# Chain:
#   1. wait for the running 10k description backfill (mcp_desc.py) to exit
#   2. enumerate the full month (auto-bisect date → workplace×role) at the safe rate
#   3. backfill descriptions for everything the enumeration added
#   4. install + enable the hourly systemd sync timer so the pipeline self-runs
#
# Everything resumes on rerun: shards/pages track progress, jobs dedupe on object_id.
set -u
cd "$(dirname "$0")/.."
PY=.venv/bin/python

echo "[chain $(date +%H:%M:%S)] waiting for the running mcp_desc backfill to finish"
while pgrep -f "mcp_desc[.]py" >/dev/null; do sleep 60; done

echo "[chain $(date +%H:%M:%S)] refreshing cookies from the Orca browser"
$PY scrape/hiringcafe.py cookies >/dev/null 2>&1 \
  || echo "[chain] WARNING: cookie refresh failed (browser tab unavailable) — using data/cookies.txt as-is"

echo "[chain $(date +%H:%M:%S)] full-month enumeration"
$PY -u scrape/hiringcafe.py enumerate --from 2026-10-20 --to 2026-11-20 \
    --rps 0.8 --window 80 --window-s 600 >> data/enumerate.log 2>&1

echo "[chain $(date +%H:%M:%S)] description mop-up (newly enumerated jobs)"
$PY -u scrape/mcp_desc.py --all --rps 1.5 --workers 4 >> data/mcp_desc.log 2>&1

echo "[chain $(date +%H:%M:%S)] installing hourly sync timer"
mkdir -p ~/.config/systemd/user
cp scrape/hiringcafe-sync.service scrape/hiringcafe-sync.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now hiringcafe-sync.timer

echo "[chain $(date +%H:%M:%S)] export"
$PY -u scrape/hiringcafe.py export >> data/enumerate.log 2>&1
echo "[chain $(date +%H:%M:%S)] done — see data/enumerate.log, data/mcp_desc.log, data/export/"
