#!/usr/bin/env python3
"""Reopen day×workplace×role shards that hit the ~1,680 page cap.

A split shard whose pages never reached its ssrTotalCount was truncated by the
SSR page cap. Marking it 'split' (and dropping its page bookkeeping) makes the
next `enumerate` run re-process it with the location-splitting cascade:
country → state. Pure status updates — jobs already saved are never touched, so
idempotent and safe to run any time.
"""

from __future__ import annotations

import sys
import sqlite3
from pathlib import Path

sys.path.insert(0, Path(__file__).resolve().parent.as_posix())
import hiringcafe as hc  # noqa: E402

RETRIEVE_CAP = 1600
COVER = 0.9


def reopen(con: sqlite3.Connection) -> list[tuple[int, str, int, int]]:
    rows = con.execute("""
        SELECT s.id, s.dfrom, s.filters, s.total,
               COALESCE(SUM(p.hits), 0) AS walked, COALESCE(MAX(p.page), -1) AS maxpage
        FROM shards s LEFT JOIN pages p ON p.shard_id = s.id
        WHERE s.status='done' AND s.filters IS NOT NULL
          AND s.filters NOT LIKE '%locations%'
          AND s.dfrom = s.dto
        GROUP BY s.id""").fetchall()
    reopened = []
    for sid, dfrom, filters, total, walked, maxpage in rows:
        if not total or total <= RETRIEVE_CAP:
            continue
        if walked >= total * COVER:            # genuinely complete
            continue
        con.execute("UPDATE shards SET status='split' WHERE id=?", (sid,))
        con.execute("DELETE FROM pages WHERE shard_id=?", (sid,))
        reopened.append((sid, dfrom, total, walked))
    con.commit()
    return reopened


def main() -> None:
    con = hc.connect()
    reopened = reopen(con)
    hc.log(f"deepsplit: reopened {len(reopened)} capped shard(s): "
           + ", ".join(f"{dfrom} (walked {walked}/{total})" for _, dfrom, total, walked in reopened)
           if reopened else "deepsplit: nothing to reopen")


if __name__ == "__main__":
    main()
