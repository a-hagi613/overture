#!/usr/bin/env python3
"""Browser-driven HiringCafe crawl (fully automatic, polite).

Cloudflare fingerprints the client, not just the IP: plain HTTP clients get 429'd after
a few dozen requests, while the already-verified Orca browser tab can fetch many pages
per second. So the crawl runs *inside* the tab:

    Orca tab (hiringcafe.com)                    devbox
    ┌──────────────────────────┐   no-cors POST  ┌──────────────────────┐
    │ fetch() x N, paced       │ ──────────────▶ │ 127.0.0.1:8765       │
    │ parse #__NEXT_DATA__     │  text/plain     │ ingest → SQLite      │
    └──────────────────────────┘                 └──────────────────────┘

Everything that can go wrong is handled without a human:

  * a challenged response (403 / "Just a moment…") is retried with backoff and never
    counted as an empty page;
  * a background guard watches the tab title, and if Cloudflare shows its
    "Verify you are human" box it clicks the checkbox through Orca, waits for the
    interstitial to clear and lets the crawl continue;
  * pacing is conservative (2 concurrent, ~2 req/s, jittered) so the guard rarely has
    anything to do;
  * progress lives in SQLite (`pages`, `descriptions`), so a kill loses at most one page.

Commands
    probe  --from YYYY-MM-DD --to YYYY-MM-DD   register a window and read its total
    search                                    crawl every pending shard (newest first)
    desc   --limit N                          backfill descriptions, newest first
    sync   --days N [--limit N]               probe+search the newest window, then desc
"""

from __future__ import annotations

import argparse
import json
import random
import re
import subprocess
import sys
import threading
import time
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, __file__.rpartition("/")[0])
import hiringcafe as hc  # noqa: E402

ORCA = hc.ORCA
PORT = 8765
CONC = 1          # parallel fetches inside the tab
GAP_MS = 1500     # pause per item, per worker
CHALLENGE = ("Just a moment", "Performing security verification", "Verify you are human")


# ------------------------------------------------------------------ collector
class Collector:
    def __init__(self):
        import sqlite3
        self.con = sqlite3.connect(hc.DB_PATH, timeout=60, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        self.con.execute("PRAGMA journal_mode=WAL")
        self.con.execute("PRAGMA busy_timeout=30000")
        self.con.execute("PRAGMA foreign_keys=ON")
        self.lock = threading.Lock()
        self.totals: dict[int, int] = {}
        self.failed: list[dict] = []
        self.saved_ids: list[str] = []

    def handle(self, msg: dict) -> None:
        kind = msg.get("kind")
        with self.lock:
            if kind == "search":
                hits, seen, uniq = msg.get("hits") or [], set(), []
                for h in hits:
                    k = h.get("collapse_key") or h.get("objectID")
                    if k in seen:
                        continue
                    seen.add(k)
                    uniq.append(h)
                hc.save_hits(self.con, uniq)
                self.saved_ids.extend(h.get("objectID") for h in uniq if h.get("objectID"))
                if msg.get("shard"):
                    self.con.execute("INSERT OR REPLACE INTO pages(shard_id, page, hits) VALUES (?,?,?)",
                                     (msg["shard"], msg["page"], len(uniq)))
                self.con.commit()
            elif kind == "probe":
                self.totals[msg["shard"]] = int(msg.get("total") or 0)
                self.con.execute("UPDATE shards SET total=? WHERE id=?", (msg.get("total"), msg["shard"]))
                self.con.commit()
            elif kind == "job":
                text = hc.clean_text(msg.get("html"))
                self.con.execute(
                    """UPDATE descriptions SET html=?, text=?, word_count=?, status=?,
                       http_status=?, fetched_at=? WHERE job_id=?""",
                    (msg.get("html") or "", text, len(text.split()),
                     msg.get("status") or "done", msg.get("http") or 200, hc.utcnow(),
                     msg["job_id"]))
                self.con.commit()
            elif kind == "fail":
                self.failed.append(msg)

    def serve(self) -> ThreadingHTTPServer:
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                n = int(self.headers.get("content-length") or 0)
                try:
                    outer.handle(json.loads(self.rfile.read(n)))
                except Exception as e:  # noqa: BLE001
                    print(f"ingest error: {e}", flush=True)
                self.send_response(204)
                self.end_headers()

            def log_message(self, *a):
                pass

        srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return srv


# ------------------------------------------------------------- challenge guard
ORCA_LOCK = threading.Lock()


def orca(*args: str, timeout: int = 60) -> str:
    with ORCA_LOCK:
        return subprocess.run([ORCA, *args], capture_output=True, text=True,
                              timeout=timeout).stdout


def tab_title(pid: str) -> str:
    try:
        out = orca("tab", "current", "--json", timeout=30)
        return json.loads(out)["result"]["tab"]["title"] or ""
    except Exception:  # noqa: BLE001
        return ""


def png_size(path: str) -> tuple[int, int]:
    import struct
    with open(path, "rb") as f:
        head = f.read(24)
    return struct.unpack(">II", head[16:24])


def click_turnstile(pid: str) -> bool:
    """Click Cloudflare's Turnstile widget inside the 'Quick security check' dialog."""
    out = orca("screenshot", "--page", pid, timeout=60)
    m = re.search(r"Screenshot saved to (.+?\.png)", out)
    if not m:
        return False
    try:
        w, h = png_size(m.group(1).strip())
    except Exception:  # noqa: BLE001
        return False
    cx, cy = w // 2, h // 2
    for dx, dy in ((-185, 101), (-185, 118), (-160, 101), (-205, 101)):
        print(f"   clicking turnstile at {cx + dx},{cy + dy}", flush=True)
        for cmd in (["mouse", "move", "--x", str(cx + dx), "--y", str(cy + dy)],
                    ["mouse", "down"], ["mouse", "up"]):
            orca(*cmd, "--page", pid, "--json", timeout=30)
        time.sleep(8)
        ok = page_eval(pid, """(async()=>{try{
            const r = await fetch('/classic?page=0',{credentials:'same-origin'});
            return r.status === 200 ? 'ok' : 'bad';} catch(e){ return 'bad';}})()""")
        if "ok" in ok:
            print("   security check passed", flush=True)
            return True
    return False


def solve_challenge(pid: str) -> bool:
    """Click Cloudflare's 'Verify you are human' checkbox if it is showing."""
    snap = orca("snapshot", "--page", pid, "--interactive", timeout=60)
    m = re.search(r'checkbox "Verify you are human".*?ref=(@?e\d+)', snap)
    if not m:
        m = re.search(r'ref=(@?e\d+).*?checkbox "Verify you are human"', snap)
    if not m:
        print("!! challenge page but no checkbox found — stopping", flush=True)
        return False
    ref = m.group(1)
    if not ref.startswith("@"):
        ref = "@" + ref
    print(f"!! Cloudflare challenge — clicking {ref}", flush=True)
    orca("click", "--page", pid, "--element", ref, "--json", timeout=60)
    for _ in range(20):
        time.sleep(3)
        if not any(c in tab_title(pid) for c in CHALLENGE):
            print("   challenge cleared", flush=True)
            return True
    print("!! challenge did not clear", flush=True)
    return False


class Guard(threading.Thread):
    """Watches the tab and clears Cloudflare checks automatically.

    Two shapes are possible:
      * full interstitial  → <title>Just a moment…</title> + 'Verify you are human' checkbox
      * in-page banner      → 'Security check needed' with a 'Run security check' button,
                              which opens Cloudflare's 'Quick security check' dialog.
    """

    def __init__(self, pid: str):
        super().__init__(daemon=True)
        self.pid = pid
        self.stop_flag = threading.Event()
        self.paused_until = 0.0
        self.solved = 0
        self._last_click = 0.0

    def check_once(self) -> bool:
        state = page_eval(self.pid, """JSON.stringify({
            banner: document.body.innerText.includes('Security check needed'),
            dialog: !!document.querySelector('iframe[src*="challenges.cloudflare.com"]')})""")
        try:
            st = json.loads(state)
        except Exception:  # noqa: BLE001
            return False
        if not st.get("banner") and not st.get("dialog"):
            return False
        if time.monotonic() - self._last_click < 45:
            return True
        self._last_click = time.monotonic()
        print("!! security check detected — handling", flush=True)
        if st.get("banner") and not st.get("dialog"):
            page_eval(self.pid, """(() => {
                const b = [...document.querySelectorAll('button')]
                  .find(x => x.textContent.includes('Run security check'));
                if (b) { b.click(); return 'clicked'; }
                return 'notfound'; })()""")
            time.sleep(8)
        click_turnstile(self.pid)
        return True

    def run(self):
        while not self.stop_flag.is_set():
            time.sleep(10)
            try:
                if self.check_once():
                    self.solved += 1
                    time.sleep(5)
            except Exception as e:  # noqa: BLE001
                print(f"guard error: {e}", flush=True)

    def wait_clear(self):
        while time.monotonic() < self.paused_until:
            time.sleep(5)


# --------------------------------------------------------------- page driver
JS = r"""
(() => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const st = window.__porgy = {done: 0, total: ITEMS.length, err: 0, running: true, kind: KIND};
  const post = (o) => fetch('http://127.0.0.1:8765/ingest', {
      method: 'POST', mode: 'no-cors', headers: {'content-type': 'text/plain'},
      body: JSON.stringify(o)}).catch(() => {});
  const parse = (html) => {
    const d = new DOMParser().parseFromString(html, 'text/html');
    const el = d.getElementById('__NEXT_DATA__');
    return el ? JSON.parse(el.textContent).props.pageProps : null;
  };
  const challenged = (t) => t.length < 60000 && t.includes('Just a moment');
  const grab = async (u, tries) => {
    for (let k = 0; k < tries; k++) {
      try {
        const r = await fetch(u, {credentials: 'same-origin'});
        const t = await r.text();
        if (r.status === 200 && !challenged(t)) return t;
        st.err++;
        await sleep(20000 + k * 60000);
      } catch (e) { st.err++; await sleep(10000); }
    }
    return null;
  };
  let i = 0;
  const worker = async () => {
    while (i < ITEMS.length) {
      const it = ITEMS[i++];
      const html = await grab(it.u, 5);
      if (!html) { await post({kind: 'fail', shard: it.s, page: it.p, job: it.j}); st.done++; continue; }
      const pp = parse(html);
      if (!pp) { await post({kind: 'fail', shard: it.s, page: it.p, job: it.j}); st.done++; continue; }
      if (KIND === 'probe') {
        await post({kind: 'probe', shard: it.s, total: pp.ssrTotalCount || 0});
      } else if (KIND === 'search') {
        const seen = new Set(), hits = [];
        for (const h of (pp.ssrHits || [])) {
          const k = h.collapse_key || h.objectID;
          if (seen.has(k)) continue;
          seen.add(k); hits.push(h);
        }
        await post({kind: 'search', shard: it.s, page: it.p, hits});
      } else {
        const d = (pp.job && pp.job.job_information) || {};
        await post({kind: 'job', job_id: it.j, status: pp.job ? 'done' : 'gone',
                    html: d.description || ''});
      }
      st.done++;
      await sleep(GAP + Math.floor(Math.random() * 250));
    }
  };
  Promise.all(Array.from({length: CONC}, worker)).then(() => { st.running = false; });
  return 'started';
})()
"""


def page_id() -> str:
    return json.loads(orca("tab", "current", "--json", timeout=30))["result"]["tab"]["browserPageId"]


def page_eval(pid: str, expr: str) -> str:
    out = orca("eval", "--page", pid, "--expression", expr, "--json", timeout=120)
    try:
        return json.loads(out)["result"].get("result", "")
    except Exception:  # noqa: BLE001
        return ""


def page_status(pid: str) -> dict:
    try:
        return json.loads(page_eval(pid, "JSON.stringify(window.__porgy || {})"))
    except Exception:  # noqa: BLE001
        return {}


def run_batch(pid: str, collector: Collector, kind: str, items: list[dict],
              label: str = "") -> list[dict]:
    js = (JS.replace("ITEMS", json.dumps(items, separators=(",", ":")))
          .replace("KIND", json.dumps(kind)).replace("GAP", str(GAP_MS))
          .replace("CONC", str(CONC)))
    if page_eval(pid, js) != "started":
        time.sleep(20)
        if page_eval(pid, js) != "started":
            raise RuntimeError("tab refused to start the batch")
    t0, last = time.time(), 0
    while True:
        time.sleep(5)
        st = page_status(pid)
        done, total, err, running = st.get("done", 0), st.get("total", 0), st.get("err", 0), st.get("running")
        if done != last:
            print(f"  {label}{done}/{total}  {done/max(time.time()-t0,1e-6):.1f}/s  err={err}",
                  flush=True)
            last = done
        if not running:
            print(f"  {label}done {done}/{total} err={err} in {time.time()-t0:.0f}s", flush=True)
            return list(collector.failed)


# ------------------------------------------------------------------ commands
def ensure_page(pid: str) -> None:
    if "hiringcafe.com" not in page_eval(pid, "location.href"):
        raise SystemExit("the pinned Orca tab is not on hiringcafe.com")


def probe(con, pid, collector, dfrom: str, dto: str) -> int:
    con.execute("INSERT INTO shards(dfrom, dto) VALUES (?,?)", (dfrom, dto))
    con.commit()
    sid = con.execute("SELECT MAX(id) FROM shards").fetchone()[0]
    state = hc.search_state(dfrom, dto)
    print(f"probe {dfrom}..{dto} (shard {sid})", flush=True)
    fails = run_batch(pid, collector, "probe", [{"u": hc.classic_url(state, 0), "s": sid}], "probe ")
    if fails:
        time.sleep(60)
        run_batch(pid, collector, "probe", [{"u": hc.classic_url(state, 0), "s": sid}], "probe ")
    return collector.totals.get(sid) or con.execute(
        "SELECT total FROM shards WHERE id=?", (sid,)).fetchone()[0] or 0


def crawl_pending(con, pid, collector, max_shards: int | None = None) -> None:
    done_shards = 0
    while max_shards is None or done_shards < max_shards:
        shard = con.execute("SELECT id,dfrom,dto,total FROM shards WHERE status='pending' "
                            "ORDER BY dto DESC, dfrom DESC LIMIT 1").fetchone()
        if not shard:
            return
        sid, dfrom, dto, total = shard
        if total is None:
            total = probe(con, pid, collector, dfrom, dto)
            sid = con.execute("SELECT MAX(id) FROM shards").fetchone()[0]
        if total > hc.SHARD_CAP and dfrom != dto:
            d1, d2 = date.fromisoformat(dfrom), date.fromisoformat(dto)
            mid = d1 + timedelta(days=max(1, (d2 - d1).days // 2))
            con.execute("UPDATE shards SET status='split' WHERE id=?", (sid,))
            con.execute("DELETE FROM pages WHERE shard_id=?", (sid,))
            con.execute("INSERT INTO shards(dfrom,dto,total) VALUES (?,?,NULL)", (dfrom, mid.isoformat()))
            con.execute("INSERT INTO shards(dfrom,dto,total) VALUES (?,?,NULL)",
                        (min(mid + timedelta(days=1), d2).isoformat(), dto))
            con.commit()
            print(f"split {dfrom}..{dto} ({total}) at {mid}", flush=True)
            continue
        if total > hc.SHARD_CAP:
            print(f"WARNING {dfrom}: {total} > cap, truncating", flush=True)

        last_page = min(hc.MAX_PAGES - 1, max(0, (total - 1) // hc.PAGE_SIZE))
        done = {r[0] for r in con.execute("SELECT page FROM pages WHERE shard_id=?", (sid,))}
        todo = [p for p in range(last_page + 1) if p not in done]
        print(f"shard {dfrom}..{dto}: {total} hits, {len(todo)} pages", flush=True)
        state = hc.search_state(dfrom, dto)
        for round_no in range(3):
            if not todo:
                break
            for i in range(0, len(todo), 150):
                batch = todo[i:i + 150]
                items = [{"u": hc.classic_url(state, p), "s": sid, "p": p} for p in batch]
                fails = run_batch(pid, collector, "search", items, f"[{dfrom}] ")  # noqa: F841
                if fails:
                    time.sleep(60)
            done = {r[0] for r in con.execute("SELECT page FROM pages WHERE shard_id=?", (sid,))}
            todo = [p for p in range(last_page + 1) if p not in done]
            if todo:
                print(f"  {len(todo)} pages failed, round {round_no+2}/3", flush=True)
                time.sleep(120)
        if not todo:
            con.execute("UPDATE shards SET status='done' WHERE id=?", (sid,))
            con.commit()
            done_shards += 1
        else:
            print(f"!! {len(todo)} pages still failing; shard left pending", flush=True)
            return


def crawl_descriptions(con, pid, collector, limit: int | None) -> None:
    q = """SELECT d.job_id id, j.requisition_id req FROM descriptions d
           JOIN jobs j ON j.object_id=d.job_id
           WHERE d.status='pending' AND j.requisition_id IS NOT NULL
           ORDER BY j.published_at DESC"""
    if limit:
        q += f" LIMIT {int(limit)}"
    rows = con.execute(q).fetchall()
    print(f"{len(rows):,} descriptions queued", flush=True)
    for round_no in range(3):
        batch = [r for r in rows if con.execute(
            "SELECT status FROM descriptions WHERE job_id=?", (r[0],)).fetchone()[0] == "pending"]
        if not batch:
            break
        for i in range(0, len(batch), 200):
            chunk = batch[i:i + 200]
            items = [{"u": f"{hc.BASE}/job/{r[1]}", "j": r[0]} for r in chunk]
            fails = run_batch(pid, collector, "job", items, "desc ")
            if fails:
                time.sleep(60)
        if round_no < 2:
            time.sleep(30)
    left = con.execute("SELECT COUNT(*) FROM descriptions WHERE status='pending'").fetchone()[0]
    print(f"descriptions done, {left:,} still pending", flush=True)


def run_items(pid, collector, kind, items, label, rounds=3, pause=180):
    """Run a batch, retrying only the items that failed."""
    remaining = items
    for r in range(rounds):
        collector.failed.clear()
        run_batch(pid, collector, kind, remaining, label)
        if not collector.failed:
            return
        bad = {(f.get("page"), f.get("job")) for f in collector.failed}
        if kind == "search":
            remaining = [it for it in remaining if it.get("p") in {b[0] for b in bad}]
        elif kind == "job":
            remaining = [it for it in remaining if it.get("j") in {b[1] for b in bad}]
        else:
            return
        print(f"  retrying {len(remaining)} failed items (round {r+2}/{rounds})", flush=True)
        time.sleep(pause)


def sample(con, pid, collector, query: str | None, depts: list[str] | None, want: int) -> None:
    """Fetch `want` postings for one filter, then their descriptions."""
    state_obj = {"sortBy": "date"}
    if query:
        state_obj["searchQuery"] = query
    if depts:
        state_obj["departments"] = depts
    state = json.dumps(state_obj, separators=(",", ":"))
    run_batch(pid, collector, "probe", [{"u": hc.classic_url(state, 0), "s": 0}], "probe ")
    total = int(collector.totals.get(0) or 0)
    print(f"sample: query={query!r} depts={depts} → {total or '?'} matches", flush=True)
    pages = max(1, (want + hc.PAGE_SIZE - 1) // hc.PAGE_SIZE)
    items = [{"u": hc.classic_url(state, p), "s": 0, "p": p} for p in range(pages)]
    run_items(pid, collector, "search", items, "sample ")
    ids = list(dict.fromkeys(collector.saved_ids))[:want]
    print(f"sample: {len(ids)} postings stored, fetching descriptions", flush=True)
    for i in range(0, len(ids), 100):
        chunk = ids[i:i + 100]
        rows = con.execute(
            f"SELECT object_id id, requisition_id req FROM jobs WHERE object_id IN ({','.join('?'*len(chunk))})",
            chunk).fetchall()
        items = [{"u": f"{hc.BASE}/job/{r[1]}", "j": r[0]} for r in rows if r[1]]
        run_items(pid, collector, "job", items, "desc ")


def daemon(con, pid, collector, desc_limit: int | None) -> None:
    """Slow forever-crawl: descriptions newest-first, interleaved with month metadata."""
    rounds = 0
    while True:
        rounds += 1
        print(f"daemon round {rounds}: descriptions", flush=True)
        try:
            crawl_descriptions(con, pid, collector, desc_limit or 250)
        except Exception as e:  # noqa: BLE001
            print(f"desc pass failed: {e}", flush=True)
        print(f"daemon round {rounds}: one metadata shard", flush=True)
        try:
            crawl_pending(con, pid, collector, max_shards=1)
        except Exception as e:  # noqa: BLE001
            print(f"metadata pass failed: {e}", flush=True)
        left = con.execute("SELECT COUNT(*) FROM shards WHERE status!='done'").fetchone()[0]
        pending_desc = con.execute("SELECT COUNT(*) FROM descriptions WHERE status='pending'").fetchone()[0]
        print(f"daemon: {left} shards left, {pending_desc:,} descriptions pending", flush=True)
        if left == 0 and pending_desc == 0:
            print("daemon: nothing left to fetch", flush=True)
            time.sleep(1800)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["probe", "search", "desc", "sync", "sample", "daemon", "stats"])
    ap.add_argument("--query", default=None, help="free-text search for `sample`")
    ap.add_argument("--dept", action="append", default=None, help="department filter for `sample`")
    ap.add_argument("--max", type=int, default=1000, help="how many postings `sample` wants")
    ap.add_argument("--gap", type=int, default=None, help="ms between requests (pacing)")
    ap.add_argument("--conc", type=int, default=None, help="parallel fetches in the tab")
    ap.add_argument("--from", dest="dfrom")
    ap.add_argument("--to", dest="dto")
    ap.add_argument("--days", type=int, default=1)
    ap.add_argument("--limit", type=int, default=None)
    a = ap.parse_args()

    global GAP_MS, CONC
    if a.gap is not None:
        GAP_MS = a.gap
    if a.conc is not None:
        CONC = a.conc

    if a.cmd == "stats":
        hc.stats()
        return

    pid = page_id()
    ensure_page(pid)
    con = hc.connect()
    collector = Collector()
    srv = collector.serve()
    Guard(pid).start()
    print(f"collector :{PORT} · page {pid}", flush=True)
    try:
        if a.cmd == "probe":
            probe(con, pid, collector, a.dfrom, a.dto)
        elif a.cmd == "search":
            crawl_pending(con, pid, collector)
        elif a.cmd == "desc":
            crawl_descriptions(con, pid, collector, a.limit)
        elif a.cmd == "sample":
            sample(con, pid, collector, a.query, a.dept, a.max)
        elif a.cmd == "daemon":
            daemon(con, pid, collector, a.limit)
        elif a.cmd == "sync":
            dto = date.today().isoformat()
            dfrom = (date.today() - timedelta(days=a.days)).isoformat()
            if not con.execute("SELECT 1 FROM shards WHERE dfrom=? AND dto=? AND status='pending'",
                               (dfrom, dto)).fetchone():
                probe(con, pid, collector, dfrom, dto)
            crawl_pending(con, pid, collector)
            crawl_descriptions(con, pid, collector, a.limit)
    except KeyboardInterrupt:
        print("interrupted — rerun to resume", flush=True)
    finally:
        srv.shutdown()
        hc.stats()


if __name__ == "__main__":
    main()
