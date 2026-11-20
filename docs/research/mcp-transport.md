# MCP transport: verified findings and implementation brief

Researched 2026-11-20 from live probes against `https://hiringcafe.com/api/mcp`
(all claims below were executed, not assumed). Companion to `docs/research/hiring-cafe.md`.

## What was verified live

1. `POST https://hiringcafe.com/api/mcp` (JSON-RPC) answers anonymously: **no cookies,
   no `cf_clearance`, no challenge**, from a datacenter IP that gets 403-challenged on
   every HTML page route.
2. `tools/list` exposes exactly two tools:
   - `search_jobs` — { search, location, workplace_types (Remote/Hybrid/Onsite),
     radius_miles, employment_types, seniority_levels, role_type, company filters
     (headcount, funding stage, investors, industry), page }. Returns 10 results/call,
     newest-first, each with title, company, location, workplace, salary, Job ID.
   - `get_job_details` — { job_id } (the final URL segment of a `/job/...` link).
     Returns the **full posting** as markdown: description, requirements, compensation,
     apply link.
3. Pagination works: `page: 0, 1, 2, …` was accepted.

## Why this beats the current HTML route

| | HTML `/classic?searchState=…` | MCP `/api/mcp` |
|---|---|---|
| Payload per hit | ~1 MB page / 40 hits | ~8 KB / 10 hits |
| Cloudflare | 403 challenges datacenter IPs; needs `cf_clearance` farmed from the Orca tab; cookie expires mid-run | none observed |
| Robots/Terms | robots.txt disallows `/*?searchState=*` and `/*&page=*` — the exact URLs the HTML route fetches | official anonymous machine interface, purpose-built for AI clients |
| Reliability | 429 treadmill, adaptive backoff, human "Verify you are human" duty | plain JSON-RPC |

The HTML route is also the one robots.txt disallows; the MCP route is the one the
operator publishes. This is the single biggest reliability upgrade available.

## Remaining unknowns (probe before relying on them)

- Does `search_jobs` page past a cap for huge queries (190k+ matches for a broad term)?
  Enumerate with **date-sharded or location-sharded** calls and 10 hits/page and verify
  the union总产值 matches `ssrTotalCount`-style totals; if a page cap appears, shard
  by day × location exactly as the HTML shard splitter does today.
- Per-IP rate threshold on `/api/mcp` is unpublished: keep the existing 0.5–1.5 rps
  pacing and back off on any 429 as the current client does.
- MCP output is markdown, not the raw `__NEXT_DATA__` JSON; field coverage should be
  parsed from the markdown headings (title, company, location, workplace, salary,
  seniority, role type, category, tools, posted date, Job ID).

## Implementation plan for `scrape/hiringcafe.py`

1. Add an MCP client (`tools/call` JSON-RPC, no session state) next to the HTML client.
2. Make enumeration delta-based: only request postings whose `objectID` is not yet in
   `hc.sqlite`; track per-shard high-water `published_at`.
3. Descriptions: `get_job_details` per Job ID (already mirrored by `scrape/mcp_desc.py`)
   — HTML `/job/<id>` fetches become the fallback only.
4. Keep the HTML client for fallback, but never as the first choice.
