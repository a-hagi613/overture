#!/usr/bin/env bash
# Phase 2 of the week seed crawl — coverage repair + final backfill + export.
#
# The main chain (nightly.sh) finishes first; this pass then:
#   1. reopens day×workplace×role shards truncated by the ~1,680 page cap
#   2. re-enumerates the week (resume-safe: shards/pages progress is kept,
#      postings dedupe on object_id; only the over-cap slices re-crawl)
#   3. mops up descriptions for every pending job in the week from the
#      no-sign-in ATS sources (including jobs the re-enumeration found)
#   4. re-exports
# Owner goal: close the coverage gap without wasting effort or tripping CF.
set -u
cd "$(dirname "$0")/.."
PY=.venv/bin/python
SOURCES=grnhse,lever,eu_lever,ashby,bamboohr,smartrecruiters,workable,recruitee,jazzhr,rippling,teamtailor,breezy,jobvite,pinpoint

echo "[phase2 $(date +%H:%M:%S)] reopening capped shards"
$PY -u scrape/deepsplit.py >> data/enumerate.log 2>&1

echo "[phase2 $(date +%H:%M:%S)] re-enumeration (location splits + leftovers)"
$PY -u scrape/hiringcafe.py enumerate --from 2026-11-13 --to 2026-11-20 \
    --rps 0.8 --window 80 --window-s 600 >> data/enumerate.log 2>&1 || true

echo "[phase2 $(date +%H:%M:%S)] description mop-up (week, no-sign-in sources)"
$PY -u scrape/mcp_desc.py --all --since 2026-11-13 --sources "$SOURCES" \
    --rps 1.5 --workers 4 >> data/mcp_desc.log 2>&1 || true

# if the mop-up surfaced stragglers, give them one more pass, then export
left=$($PY - <<'EOF'
import sys, sqlite3
sys.path.insert(0, "scrape")
import hiringcafe as hc
con = sqlite3.connect(hc.DB_PATH)
print(con.execute("SELECT COUNT(*) FROM descriptions WHERE status='pending'").fetchone()[0])
EOF
)
if [ "${left%%[!0-9]*}" != "0" ] && [ "$left" -gt 0 ]; then
  echo "[phase2 $(date +%H:%M:%S)] $left still pending — second mop-up pass"
  $PY -u scrape/mcp_desc.py --all --since 2026-11-13 --sources "$SOURCES" \
      --rps 1.5 --workers 4 >> data/mcp_desc.log 2>&1 || true
fi

echo "[phase2 $(date +%H:%M:%S)] export"
$PY -u scrape/hiringcafe.py export >> data/enumerate.log 2>&1
touch data/.phase2-done
echo "[phase2 $(date +%H:%M:%S)] done"
