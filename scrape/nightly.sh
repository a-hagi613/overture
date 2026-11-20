#!/usr/bin/env bash
# Overnight seed crawl — one-week scope (owner decision: Nov 13 → Nov 20, 2026).
#
# Chain:
#   1. wait for the running week description backfill (mcp_desc.py) to exit
#   2. enumerate 2026-11-13..2026-11-20 (auto-bisect date → workplace×role) at the safe rate
#   3. backfill descriptions for the week's jobs from no-sign-in ATS sources
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

sleep 1200   # CF cool-down: a 403 means the IP budget is exhausted; silence refills it

echo "[chain $(date +%H:%M:%S)] week enumeration (2026-11-13 .. 2026-11-20)"
$PY -u scrape/hiringcafe.py enumerate --from 2026-11-13 --to 2026-11-20 \
    --rps 0.2 --window 20 --window-s 600 >> data/enumerate.log 2>&1

echo "[chain $(date +%H:%M:%S)] description mop-up: no-sign-in ATS sources, this week only"
$PY -u scrape/mcp_desc.py --all --rps 0.7 --workers 4 --since 2026-11-13 --sources \
	grnhse,lever,eu_lever,ashby,bamboohr,smartrecruiters,workable,recruitee,jazzhr,rippling,teamtailor,breezy,jobvite,pinpoint \
	>> data/mcp_desc.log 2>&1

echo "[chain $(date +%H:%M:%S)] installing hourly sync timer"
mkdir -p ~/.config/systemd/user
cp scrape/hiringcafe-sync.service scrape/hiringcafe-sync.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now hiringcafe-sync.timer

echo "[chain $(date +%H:%M:%S)] export"
$PY -u scrape/hiringcafe.py export >> data/enumerate.log 2>&1
echo "[chain $(date +%H:%M:%S)] done — see data/enumerate.log, data/mcp_desc.log, data/export/"
