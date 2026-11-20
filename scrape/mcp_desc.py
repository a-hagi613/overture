#!/usr/bin/env python3
"""Backfill job descriptions through HiringCafe's official MCP endpoint.

`POST https://hiringcafe.com/api/mcp` with JSON-RPC `tools/call` /
`get_job_details` returns the full posting as Markdown: description, requirements,
compensation, location, category, apply link. It is an official, anonymous,
read-only endpoint built for AI clients, so it is not behind the Cloudflare
challenge that throttles the HTML pages, and a request costs ~8 KB instead of
~1 MB.

It is, however, rate limited per IP (429s and, when hammered, Cloudflare
challenges on the interactive site), so a global `--rps` pacing cap keeps every
worker inside a conservative budget. Defaults to 1.5 requests/second.

    .venv/bin/python scrape/mcp_desc.py --priority se --limit 1000
    .venv/bin/python scrape/mcp_desc.py --all

Writes `descriptions.markdown` (raw), `.text` (plain) and `.word_count`, and
leaves `.html` NULL for these rows.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, __file__.rpartition("/")[0])
import hiringcafe as hc  # noqa: E402

MCP = "https://hiringcafe.com/api/mcp"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/150.0.7871.250 Safari/537.36")

SE_DEPTS = ("Software Development", "Engineering")
SE_TITLE = ("software", "developer", "engineer", "full stack", "fullstack",
            "frontend", "front end", "backend", "back end", "devops", "sre",
            "platform", "sde", "programmer")

PRINT_LOCK = threading.Lock()


class RateLimiter:
    """Global min-interval pacing shared by all worker threads."""

    def __init__(self, rps: float):
        self.min_interval = 1.0 / rps if rps > 0 else 0.0
        self.lock = threading.Lock()
        self.next_at = 0.0

    def wait(self) -> None:
        if self.min_interval <= 0:
            return
        while True:
            with self.lock:
                now = time.monotonic()
                if now >= self.next_at:
                    self.next_at = now + self.min_interval
                    return
                delay = self.next_at - now
            time.sleep(delay)


def log(msg: str) -> None:
    with PRINT_LOCK:
        print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


RATE: RateLimiter | None = None


def call(job_id: str, tries: int = 5) -> tuple[int, str]:
    """One `get_job_details` call. Returns (http_status, markdown)."""
    body = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "get_job_details", "arguments": {"job_id": job_id}},
    }).encode()
    delay = 2.0
    for k in range(tries):
        if RATE is not None:
            RATE.wait()
        req = urllib.request.Request(MCP, data=body, headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "User-Agent": UA,
        })
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                raw = r.read()
            if r.status == 429:
                time.sleep(int(r.headers.get("retry-after") or delay))
                delay *= 2
                continue
            msg = json.loads(raw)
            if "error" in msg:
                return r.status, ""
            txt = (msg.get("result") or {}).get("content") or [{}]
            return r.status, txt[0].get("text") or ""
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                ra = e.headers.get("retry-after") if e.headers else None
                time.sleep(float(ra) if ra else delay)
                delay = min(delay * 2, 120)
                continue
            return e.code, ""
        except Exception:  # noqa: BLE001 — network blip
            time.sleep(delay)
            delay = min(delay * 2, 60)
    return 0, ""


def md_to_text(md: str) -> str:
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", md)          # images
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)        # links
    t = re.sub(r"^#{1,6}\s*", "", t, flags=re.M)          # headings
    t = re.sub(r"[*_`>]+", "", t)                          # emphasis / quotes
    t = re.sub(r"^\s*[-•]\s+", "• ", t, flags=re.M)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def queue(con: sqlite3.Connection, priority: str, limit: int | None) -> list[tuple[str, str]]:
    where = "d.status='pending' AND j.requisition_id IS NOT NULL"
    if priority == "se":
        like = " OR ".join("lower(j.title) LIKE ?" for _ in SE_TITLE)
        depts = ",".join("?" * len(SE_DEPTS))
        sql = (f"""SELECT d.job_id, j.requisition_id FROM descriptions d
                   JOIN jobs j ON j.object_id=d.job_id
                   WHERE {where} AND (j.department IN ({depts}) OR {like})
                   ORDER BY j.published_at DESC""")
        args: list = [*SE_DEPTS, *[f"%{w}%" for w in SE_TITLE]]
    else:
        sql = (f"""SELECT d.job_id, j.requisition_id FROM descriptions d
                   JOIN jobs j ON j.object_id=d.job_id
                   WHERE {where} ORDER BY j.published_at DESC""")
        args = []
    if limit:
        sql += f" LIMIT {int(limit)}"
    return con.execute(sql, args).fetchall()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--rps", type=float, default=1.5,
                    help="global request rate cap (default 1.5/s)")
    ap.add_argument("--priority", choices=["se", "recent"], default="recent")
    ap.add_argument("--all", action="store_true", help="every pending description")
    a = ap.parse_args()

    global RATE
    RATE = RateLimiter(a.rps)

    con = sqlite3.connect(hc.DB_PATH, timeout=120)
    con.execute("PRAGMA busy_timeout=60000")
    cols = {r[1] for r in con.execute("PRAGMA table_info(descriptions)")}
    if "markdown" not in cols:
        con.execute("ALTER TABLE descriptions ADD COLUMN markdown TEXT")
        con.commit()

    rows = queue(con, a.priority, None if a.all else a.limit)
    log(f"{len(rows):,} descriptions queued (priority={a.priority}, workers={a.workers})")
    if not rows:
        return

    t0 = time.time()
    done = [0]
    counts: dict[int, int] = {}
    lock = threading.Lock()

    def work(pair: tuple[str, str]) -> tuple[str, int, str]:
        job_id, req = pair
        st, md = call(req)
        return job_id, (st if md else (st or 0)), md

    def flush(batch: list[tuple[str, int, str]]) -> None:
        now = hc.utcnow()
        for job_id, st, md in batch:
            if md:
                text = md_to_text(md)
                con.execute(
                    """UPDATE descriptions SET markdown=?, text=?, word_count=?,
                         status='done', http_status=?, fetched_at=? WHERE job_id=?""",
                    (md, text, len(text.split()), st or 200, now, job_id))
            else:
                status = "gone" if st in (200, 404) else "pending"
                con.execute(
                    "UPDATE descriptions SET status=?, http_status=?, fetched_at=? WHERE job_id=?",
                    (status, st, now, job_id))
            counts[st] = counts.get(st, 0) + 1
        con.commit()

    batch: list[tuple[str, int, str]] = []
    with ThreadPoolExecutor(a.workers) as ex:
        for res in ex.map(work, rows):
            batch.append(res)
            done[0] += 1
            if len(batch) >= 50:
                flush(batch)
                batch = []
            if done[0] % 100 == 0:
                el = time.time() - t0
                log(f"{done[0]:,}/{len(rows):,}  {done[0]/el:.1f}/s  "
                    f"eta {(len(rows)-done[0])/max(done[0]/el,1e-9)/60:.1f} min  "
                    f"status={dict(sorted(counts.items()))}")
    if batch:
        flush(batch)

    left = con.execute("SELECT COUNT(*) FROM descriptions WHERE status='pending'").fetchone()[0]
    ok = con.execute("SELECT COUNT(*) FROM descriptions WHERE status='done'").fetchone()[0]
    log(f"finished in {(time.time()-t0)/60:.1f} min — {ok:,} described, {left:,} pending")
    log(f"statuses {dict(sorted(counts.items()))}")


if __name__ == "__main__":
    main()
