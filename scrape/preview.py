#!/usr/bin/env python3
"""Render data/hc.sqlite as a self-contained browseable HTML page (data/preview.html)."""

from __future__ import annotations

import html
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "hc.sqlite"
OUT = ROOT / "data" / "preview.html"


def esc(v):
    return html.escape(str(v)) if v not in (None, "", []) else ""


def money(s):
    if not s:
        return ""
    lo, hi = s.get("min"), s.get("max")
    cur = s.get("currency") or ""
    freq = (s.get("frequency") or "").lower()
    def fmt(v):
        if v is None:
            return ""
        return f"{v/1000:.0f}k" if v >= 1000 else f"{v}"
    if lo and hi and lo != hi:
        return f"{cur} {fmt(lo)}–{fmt(hi)}/{freq[:2]}"
    if lo or hi:
        return f"{cur} {fmt(lo or hi)}/{freq[:2]}"
    return ""


def main():
    con = sqlite3.connect(DB)
    rows = con.execute(
        "SELECT data, description, desc_status FROM jobs ORDER BY json_extract(data,'$.published_at') DESC"
    ).fetchall()
    cards = []
    for data, desc, status in rows:
        j = json.loads(data)
        meta = j.get("meta") or {}
        tags = []
        for k in ("workplace_type", "seniority", "role_type", "department"):
            if j.get(k):
                tags.append(esc(j[k]))
        for c in (j.get("commitment") or []):
            tags.append(esc(c))
        if j.get("yoe_min"):
            tags.append(f"{j['yoe_min']}+ yoe")
        if meta.get("visa_sponsorship"):
            tags.append("visa: " + esc(meta["visa_sponsorship"]))
        tools = ", ".join((j.get("technical_tools") or [])[:8])
        comp = j.get("company") or {}
        desc_html = desc or ""
        cards.append(f"""
<article class="card">
  <header>
    <h3>{esc(j.get('title'))}</h3>
    <div class="co">{esc(comp.get('name') or j.get('company'))}
      <span class="dot">·</span> {esc(j.get('location'))}</div>
    <div class="salary">{esc(money(j.get('salary')))}</div>
  </header>
  <div class="tags">{''.join(f'<span>{t}</span>' for t in tags if t)}</div>
  <p class="req">{esc(j.get('requirements_summary'))}</p>
  {f'<p class="tools"><b>Tools:</b> {esc(tools)}</p>' if tools else ''}
  <details>
    <summary>{'Description' if status == 'done' else 'Description not fetched yet'}</summary>
    <div class="desc">{desc_html}</div>
  </details>
  <footer>
    <span>{esc((j.get('published_at') or '')[:10])}</span>
    {f'<a href="{esc(j.get("job_url"))}" target="_blank">HiringCafe</a>' if j.get('job_url') else ''}
    {f'<a href="{esc(j.get("apply_url"))}" target="_blank">Apply</a>' if j.get('apply_url') else ''}
  </footer>
</article>""")

    page = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>HiringCafe seed data — {len(rows):,} jobs</title>
<style>
:root{{color-scheme:light}}
body{{font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f6f6f7;color:#18181b}}
header.top{{position:sticky;top:0;background:#fff;border-bottom:1px solid #e4e4e7;padding:14px 20px;z-index:5}}
h1{{font-size:17px;margin:0 0 8px}}
input{{width:100%;max-width:520px;padding:8px 12px;border:1px solid #d4d4d8;border-radius:8px;font-size:14px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:14px;padding:18px}}
.card{{background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px}}
h3{{margin:0;font-size:15px}}
.co{{color:#52525b;font-size:13px}}
.salary{{color:#047857;font-weight:600;font-size:13px;margin-top:2px}}
.tags{{display:flex;flex-wrap:wrap;gap:6px}}
.tags span{{background:#f4f4f5;border-radius:999px;padding:2px 8px;font-size:11.5px;color:#3f3f46}}
.req{{margin:0;color:#3f3f46;font-size:13px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}}
.tools{{margin:0;font-size:12.5px;color:#52525b}}
details summary{{cursor:pointer;font-size:12.5px;color:#4338ca}}
.desc{{max-height:340px;overflow:auto;font-size:13px;border-top:1px dashed #e4e4e7;margin-top:6px;padding-top:6px}}
.desc img{{max-width:100%}}
footer{{display:flex;gap:12px;font-size:12px;color:#71717a;border-top:1px solid #f4f4f5;padding-top:8px}}
footer a{{color:#4338ca;text-decoration:none}}
</style></head><body>
<header class="top">
  <h1>HiringCafe seed data — {len(rows):,} jobs</h1>
  <input id="q" placeholder="filter by title, company, location, tag…">
</header>
<div class="grid" id="grid">{''.join(cards)}</div>
<script>
const q=document.getElementById('q'), cards=[...document.querySelectorAll('.card')];
q.addEventListener('input',()=>{{const v=q.value.toLowerCase();
  for(const c of cards) c.style.display = c.textContent.toLowerCase().includes(v)?'':'none';}});
</script>
</body></html>"""
    OUT.write_text(page)
    print(f"wrote {OUT} ({OUT.stat().st_size/1e6:.1f} MB, {len(rows):,} jobs)")


if __name__ == "__main__":
    main()
