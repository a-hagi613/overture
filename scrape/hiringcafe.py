#!/usr/bin/env python3
"""HiringCafe scraper — a relational dump of one month of job listings.

Data model: see scrape/schema.sql. In short

    companies ──< jobs ──< job_facets
                    │
                    ├──< job_locations / job_commitments / job_tools / job_licenses
                    │    job_languages / job_degree_fields / job_role_activities
                    └──   descriptions            (fetched separately)

Two upstream sources, both plain HTML pages rendered by Next.js:

  * /classic?searchState=…&page=N   → 40 postings, each a full structured record in
    <script id="__NEXT_DATA__">. That is where every column except the description
    comes from.
  * /job/<requisition_id>           → the posting itself, with
    job_information.description (HTML).

`searchState` is the whole filter object serialised into one query param. We shard the
corpus by fetch-date range ({from,to} under `dateFetchedPastNDays`) sorted by date;
deep paging stops at page 250 (10 000 hits) so oversized shards are bisected.

Cloudflare: no auth, but the site challenges datacentre traffic. We reuse the cookies of
a logged-in Orca browser tab (cf_clearance is bound to IP + User-Agent, so we send that
browser's UA) and crawl slowly; on 429 the crawler pauses, slows down and re-pulls the
cookies. If the browser itself shows a "Verify you are human" box, a human has to tick it.

Usage:
    python3 scrape/hiringcafe.py init
    python3 scrape/hiringcafe.py cookies
    python3 scrape/hiringcafe.py enumerate --from 2026-10-20 --to 2026-11-19
    python3 scrape/hiringcafe.py details
    python3 scrape/hiringcafe.py stats
    python3 scrape/hiringcafe.py export
    python3 scrape/hiringcafe.py preview
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import json
import os
import random
import re
import sqlite3
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from collections import deque
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

try:                                    # browser-grade TLS fingerprint: far fewer CF challenges
    from curl_cffi import requests as _crequests
except ImportError:                     # pragma: no cover
    _crequests = None
import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
EXPORT = DATA / "export"
DB_PATH = DATA / "hc.sqlite"
SCHEMA = Path(__file__).resolve().parent / "schema.sql"
COOKIE_JSON = DATA / "cookies.json"
COOKIE_TXT = DATA / "cookies.txt"

BASE = "https://hiringcafe.com"
CLASSIC = BASE + "/classic"
ORCA = os.environ.get("ORCA_CLI_COMMAND") or "orca-ide"
DEFAULT_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/150.0.7871.250 Safari/537.36")

NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', re.S)
CHALLENGE_MARKERS = ("Just a moment...", "Performing security verification", "cf-challenge")

PAGE_SIZE = 40
MAX_PAGES = 250

# the site's own "no information" markers
NO_SIGNAL = {"None", "Not Indicated", "N/A", "n/a", "", None}

COMP_FREQ_COLUMNS = {
    "Yearly": ("yearly_min_compensation", "yearly_max_compensation"),
    "Hourly": ("hourly_min_compensation", "hourly_max_compensation"),
    "Monthly": ("monthly_min_compensation", "monthly_max_compensation"),
    "Weekly": ("weekly_min_compensation", "weekly_max_compensation"),
    "Daily": ("daily_min_compensation", "daily_max_compensation"),
    "Bi-weekly": ("bi-weekly_min_compensation", "bi-weekly_max_compensation"),
    "Biweekly": ("bi-weekly_min_compensation", "bi-weekly_max_compensation"),
}


# ----------------------------------------------------------------------- utils
def log(msg: str) -> None:
    print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def enum(v):
    """Normalise HiringCafe's 'no signal' markers to NULL."""
    if isinstance(v, str):
        v = v.strip()
        if v in NO_SIGNAL:
            return None
    return v


def boolean(v):
    if v is None:
        return None
    return 1 if v else 0


def num(v):
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def clean_text(html: str | None) -> str:
    if not html:
        return ""
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    t = re.sub(r"<br\s*/?>|</p>|</li>|</div>|</tr>|</h\d>", "\n", t, flags=re.I)
    t = re.sub(r"<li[^>]*>", "\n• ", t, flags=re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                 ("&quot;", '"'), ("&#39;", "'"), ("&rsquo;", "’"), ("&ndash;", "–")):
        t = t.replace(a, b)
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    t = re.sub(r"\n\s*\n\s*\n+", "\n\n", t)
    return t.strip()


def parse_next_data(html: str) -> dict | None:
    m = NEXT_DATA_RE.search(html)
    if not m:
        return None
    try:
        return json.loads(m.group(1))["props"]["pageProps"]
    except Exception:  # noqa: BLE001
        return None


# -------------------------------------------------------------------------- db
def connect() -> sqlite3.Connection:
    DATA.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=60)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db() -> None:
    con = connect()
    con.executescript(SCHEMA.read_text())
    cols = {r[1] for r in con.execute("PRAGMA table_info(shards)")}
    if "filters" not in cols:          # pre-filter-enum shards
        con.execute("ALTER TABLE shards ADD COLUMN filters TEXT")
    con.commit()
    log(f"schema applied to {DB_PATH}")


# --------------------------------------------------------------------- cookies
def orca_page_id() -> str | None:
    try:
        out = subprocess.run([ORCA, "tab", "current", "--json"],
                             capture_output=True, text=True, timeout=30).stdout
        return json.loads(out)["result"]["tab"]["browserPageId"]
    except Exception:  # noqa: BLE001
        return None


def pull_cookies(page_id: str | None = None) -> dict:
    page_id = page_id or orca_page_id()
    if not page_id:
        sys.exit("no Orca browser tab found — open https://hiringcafe.com there first")
    out = subprocess.run([ORCA, "cookie", "get", "--page", page_id, "--json"],
                         capture_output=True, text=True, timeout=60).stdout
    cookies = json.loads(out)["result"]["cookies"]
    DATA.mkdir(parents=True, exist_ok=True)
    COOKIE_JSON.write_text(json.dumps(cookies, indent=1))
    lines = ["# Netscape HTTP Cookie File"]
    for c in cookies:
        dom = c["domain"]
        lines.append("\t".join([
            dom, "TRUE" if dom.startswith(".") else "FALSE", c["path"],
            "TRUE" if c.get("secure") else "FALSE",
            str(int(c["expires"]) if c.get("expires") else 0), c["name"], c["value"]]))
    COOKIE_TXT.write_text("\n".join(lines) + "\n")
    return {c["name"]: c["value"] for c in cookies}


def load_cookies() -> dict:
    if COOKIE_JSON.exists():
        return {c["name"]: c["value"] for c in json.loads(COOKIE_JSON.read_text())}
    return pull_cookies()


# --------------------------------------------------------------------- client
class Challenge(Exception):
    pass


class Client:
    """Thread-local HTTP sessions behind one global, adaptive rate limiter."""

    def __init__(self, rps: float, workers: int, window: int = 80, window_s: int = 600):
        self.rps = self.target_rps = rps
        self.workers = workers
        self.lock = threading.Lock()
        self.next_slot = time.monotonic()
        self.paused_until = 0.0
        self._last_ramp = time.monotonic()
        # sliding-window budget: the site tolerates ~1 request per few seconds, but
        # bursts are what trigger Cloudflare, so cap total requests per window too.
        self.window = window
        self.window_s = window_s
        self.hits: deque[float] = deque()
        self.local = threading.local()
        self.stats = {"req": 0, "bytes": 0, "challenges": 0}
        self.cookies = load_cookies()

    def session(self):
        s = getattr(self.local, "s", None)
        if s is None:
            if _crequests is not None:
                s = _crequests.Session(impersonate="chrome")
            else:
                s = requests.Session()
            s.headers.update({
                "user-agent": DEFAULT_UA,
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "accept-language": "en-US,en;q=0.9",
                "referer": CLASSIC,
            })
            s.cookies.update(self.cookies)
            self.local.s = s
        return s

    def _slot(self):
        while True:
            with self.lock:
                now = time.monotonic()
                while self.hits and now - self.hits[0] > self.window_s:
                    self.hits.popleft()
                start = max(now, self.next_slot, self.paused_until)
                if len(self.hits) >= self.window:
                    start = max(start, self.hits[0] + self.window_s + 0.5)
                if start <= now + 0.05:
                    self.next_slot = now + 1.0 / self.rps
                    self.hits.append(now)
                    return
            time.sleep(max(0.05, start - time.monotonic()))

    def pause(self, seconds: float, why: str):
        with self.lock:
            self.paused_until = max(self.paused_until, time.monotonic() + seconds)
            before = self.rps
            self.rps = max(0.5, self.rps * 0.7)
        log(f"!! {why} — waiting {seconds:.0f}s, rate {before:.2f} → {self.rps:.2f}/s")

    def _on_success(self):
        with self.lock:
            if time.monotonic() - self._last_ramp < 300 or self.rps >= self.target_rps:
                return
            self._last_ramp = time.monotonic()
            self.rps = min(self.target_rps, self.rps * 1.2)

    def get(self, url: str, tries: int = 10) -> str:
        backoff = 45.0
        for attempt in range(1, tries + 1):
            self._slot()
            try:
                r = self.session().get(url, timeout=45)
            except Exception as e:  # noqa: BLE001  (requests / curl_cffi share no base class)
                log(f"network error ({e.__class__.__name__}) retry {attempt}/{tries}")
                time.sleep(min(backoff, 120))
                continue
            body = r.text
            self.stats["req"] += 1
            self.stats["bytes"] += len(r.content)
            if r.status_code == 200 and not any(m in body[:4000] for m in CHALLENGE_MARKERS):
                self._on_success()
                return body
            if r.status_code == 404:
                return ""
            self.stats["challenges"] += 1
            self.pause(backoff * random.uniform(0.9, 1.2), f"HTTP {r.status_code} / challenge")
            if attempt in (3, 6):
                try:
                    self.cookies = pull_cookies()
                    self.local = threading.local()   # force new sessions with new cookies
                    log("cookies refreshed from the Orca tab")
                except Exception as e:  # noqa: BLE001
                    log(f"cookie refresh failed: {e}")
                    log(">>> tick the 'Verify you are human' box in the Orca browser if shown")
            backoff = min(backoff * 1.6, 300)
        raise Challenge(f"gave up on {url[:100]}")


# ------------------------------------------------------------------- write side
def company_id(con, name: str, enriched: dict, card: dict, v5: dict) -> int:
    name = (name or "").strip()
    if not name:
        name = "Unknown"
    row = con.execute("SELECT id FROM companies WHERE name=?", (name,)).fetchone()
    con.execute(
        """INSERT INTO companies
           (name, website, tagline, industry, organization_type, org_classification,
            board_classification, employee_count, founded_year, hq_country, parent_company,
            stock_symbol, stock_exchange, funding_type, funding_year, funding_amount,
            org_entity_id, external_id, enriched_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(name) DO UPDATE SET
             website=COALESCE(excluded.website, companies.website),
             tagline=COALESCE(excluded.tagline, companies.tagline),
             industry=COALESCE(excluded.industry, companies.industry),
             organization_type=COALESCE(excluded.organization_type, companies.organization_type),
             employee_count=COALESCE(excluded.employee_count, companies.employee_count),
             founded_year=COALESCE(excluded.founded_year, companies.founded_year),
             hq_country=COALESCE(excluded.hq_country, companies.hq_country),
             parent_company=COALESCE(excluded.parent_company, companies.parent_company),
             stock_symbol=COALESCE(excluded.stock_symbol, companies.stock_symbol),
             stock_exchange=COALESCE(excluded.stock_exchange, companies.stock_exchange),
             funding_type=COALESCE(excluded.funding_type, companies.funding_type),
             funding_year=COALESCE(excluded.funding_year, companies.funding_year),
             funding_amount=COALESCE(excluded.funding_amount, companies.funding_amount),
             org_entity_id=COALESCE(excluded.org_entity_id, companies.org_entity_id),
             external_id=COALESCE(excluded.external_id, companies.external_id),
             enriched_at=COALESCE(excluded.enriched_at, companies.enriched_at),
             updated_at=excluded.updated_at""",
        (name,
         enum(v5.get("company_website")) or enum(enriched.get("homepage_uri")),
         enum(v5.get("company_tagline")) or enum(enriched.get("tagline")) or enum(card.get("tagline")),
         enum(v5.get("company_sector_and_industry")),
         enum(enriched.get("organization_type")) or enum(card.get("organization_type")),
         enum(enriched.get("org_classification")),
         enum(enriched.get("board_classification")),
         num(card.get("nb_employees")) or num(enriched.get("nb_employees")),
         num(card.get("year_founded")) or num(enriched.get("year_founded")),
         enum(card.get("hq_country")) or enum(enriched.get("hq_country")),
         enum(card.get("parent_company")) or enum(enriched.get("parent_company")),
         enum(enriched.get("stock_symbol")) or enum((card.get("stock_info") or {}).get("stock_symbol")),
         enum(enriched.get("stock_exchange")) or enum((card.get("stock_info") or {}).get("stock_exchange")),
         enum(enriched.get("latest_funding_type")) or enum((card.get("latest_fundraising") or {}).get("funding_type")),
         num(enriched.get("latest_funding_year")) or num((card.get("latest_fundraising") or {}).get("year_raised")),
         num(enriched.get("latest_funding_amount")) or num((card.get("latest_fundraising") or {}).get("total_amount_raised")),
         enum(enriched.get("org_entity_id")),
         enum(enriched.get("external_id")),
         enum(enriched.get("enriched_at")),
         utcnow()))
    cid = con.execute("SELECT id FROM companies WHERE name=?", (name,)).fetchone()["id"]

    industries = set(enriched.get("industries") or []) | set(card.get("industries") or [])
    con.executemany("INSERT OR IGNORE INTO company_industries(company_id, industry) VALUES (?,?)",
                    [(cid, i) for i in industries if i])
    acts = set(enriched.get("activities") or []) | set(card.get("activities") or []) | set(v5.get("company_activities") or [])
    con.executemany("INSERT OR IGNORE INTO company_activities(company_id, activity) VALUES (?,?)",
                    [(cid, a) for a in acts if a])
    con.executemany("INSERT OR IGNORE INTO company_aliases(company_id, alias) VALUES (?,?)",
                    [(cid, a) for a in (card.get("aliases") or []) if a])
    con.executemany("INSERT OR IGNORE INTO company_subsidiaries(company_id, name) VALUES (?,?)",
                    [(cid, s) for s in (enriched.get("subsidiaries") or []) if s])
    investors = set(enriched.get("latest_funding_investors") or []) | set(
        (card.get("latest_fundraising") or {}).get("lead_investors") or [])
    con.executemany("INSERT OR IGNORE INTO company_funding_investors(company_id, investor) VALUES (?,?)",
                    [(cid, i) for i in investors if i])
    return cid


def location_rows(job_id: str, v5: dict) -> list[tuple]:
    rows = []
    levels = (("workplace_continents", "continent"), ("workplace_countries", "country"),
              ("workplace_states", "state"), ("workplace_counties", "county"),
              ("workplace_cities", "city"))
    for scope, prefix in (("workplace", ""), ("boundless", "boundless_")):
        for key, level in levels:
            for val in v5.get(prefix + key) or []:
                if not val:
                    continue
                cc = None
                if level != "country" and "," in val:
                    tail = val.rsplit(",", 1)[-1].strip()
                    cc = tail if len(tail) == 2 and tail.isalpha() else None
                elif level == "country":
                    cc = val if len(val) == 2 else None
                rows.append((job_id, scope, level, val, cc))
    return rows


def save_hits(con: sqlite3.Connection, hits: list[dict]) -> int:
    now = utcnow()
    n = 0
    for hit in hits:
        oid = hit.get("objectID") or hit.get("id")
        if not oid:
            continue
        v5 = hit.get("v5_processed_job_data") or {}
        ji = hit.get("job_information") or {}
        card = hit.get("attributed_org_card") or {}
        enriched = hit.get("enriched_company_data") or {}

        cid = company_id(con,
                         v5.get("company_name")
                         or (hit.get("attributed_org") or {}).get("name")
                         or card.get("parent_company"),
                         enriched, card, v5)

        freq = enum(v5.get("listed_compensation_frequency"))
        lo_col, hi_col = COMP_FREQ_COLUMNS.get(freq or "Yearly", ("yearly_min_compensation",
                                                                 "yearly_max_compensation"))
        geo = hit.get("_geoloc") or []
        geo0 = geo[0] if isinstance(geo, list) and geo else {}

        con.execute(
            """INSERT INTO jobs (
                 object_id, requisition_id, company_id, title, core_job_title, job_url,
                 apply_url, source, board_token, collapse_key, strict_dedup_cluster_id,
                 liberal_dedup_cluster, original_source_id, attributed_org_name, attributed_org_id, location_raw,
                 workplace_type, latitude, longitude, department, role_type,
                 seniority_level, yoe_min, management_yoe_min, requirements_summary,
                 salary_currency, salary_frequency, salary_min, salary_max,
                 salary_yearly_min, salary_yearly_max, is_compensation_transparent,
                 visa_sponsorship, published_at, first_seen_at, last_seen_at, is_expired)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(object_id) DO UPDATE SET
                 requisition_id=COALESCE(excluded.requisition_id, jobs.requisition_id),
                 company_id=excluded.company_id,
                 title=excluded.title,
                 core_job_title=COALESCE(excluded.core_job_title, jobs.core_job_title),
                 job_url=COALESCE(excluded.job_url, jobs.job_url),
                 apply_url=COALESCE(excluded.apply_url, jobs.apply_url),
                 location_raw=COALESCE(excluded.location_raw, jobs.location_raw),
                 workplace_type=COALESCE(excluded.workplace_type, jobs.workplace_type),
                 department=COALESCE(excluded.department, jobs.department),
                 role_type=COALESCE(excluded.role_type, jobs.role_type),
                 seniority_level=COALESCE(excluded.seniority_level, jobs.seniority_level),
                 yoe_min=COALESCE(excluded.yoe_min, jobs.yoe_min),
                 management_yoe_min=COALESCE(excluded.management_yoe_min, jobs.management_yoe_min),
                 requirements_summary=COALESCE(excluded.requirements_summary, jobs.requirements_summary),
                 salary_currency=COALESCE(excluded.salary_currency, jobs.salary_currency),
                 salary_frequency=COALESCE(excluded.salary_frequency, jobs.salary_frequency),
                 salary_min=COALESCE(excluded.salary_min, jobs.salary_min),
                 salary_max=COALESCE(excluded.salary_max, jobs.salary_max),
                 salary_yearly_min=COALESCE(excluded.salary_yearly_min, jobs.salary_yearly_min),
                 salary_yearly_max=COALESCE(excluded.salary_yearly_max, jobs.salary_yearly_max),
                 published_at=COALESCE(excluded.published_at, jobs.published_at),
                 last_seen_at=excluded.last_seen_at,
                 is_expired=excluded.is_expired""",
            (oid, hit.get("requisition_id"), cid,
             ji.get("title") or v5.get("core_job_title") or "Untitled",
             enum(v5.get("core_job_title")),
             f"{BASE}/job/{hit['requisition_id']}" if hit.get("requisition_id") else None,
             hit.get("apply_url"),
             enum(hit.get("source")), enum(hit.get("board_token")), enum(hit.get("collapse_key")),
             enum(hit.get("strict_dedup_cluster_id")), enum(hit.get("liberal_dedup_cluster")),
             enum(hit.get("original_source_id")),
             enum((hit.get("attributed_org") or {}).get("name")),
             enum((hit.get("attributed_org") or {}).get("org_entity_id")),
             enum(v5.get("formatted_workplace_location")),
             enum(v5.get("workplace_type")),
             num(geo0.get("lat")), num(geo0.get("lon")),
             enum(v5.get("job_category")), enum(v5.get("role_type")),
             enum(v5.get("seniority_level")), num(v5.get("min_industry_and_role_yoe")),
             num(v5.get("min_management_and_leadership_yoe")),
             enum(v5.get("requirements_summary")),
             enum(v5.get("listed_compensation_currency")), freq,
             num(v5.get(lo_col)), num(v5.get(hi_col)),
             num(v5.get("yearly_min_compensation")), num(v5.get("yearly_max_compensation")),
             boolean(v5.get("is_compensation_transparent")),
             boolean(v5.get("visa_sponsorship")),
             enum(v5.get("estimated_publish_date")), now, now,
             boolean(hit.get("is_expired")) or 0))

        # facets
        con.execute(
            """INSERT INTO job_facets (
                 job_id, workplace_physical_environment, physical_labor_intensity,
                 physical_position, computer_usage, cognitive_demand,
                 oral_communication_level, morning_shift_work, evening_shift_work,
                 overnight_work, weekend_availability_required, holiday_availability_required,
                 overtime_required, on_call_requirement, four_day_work_week,
                 air_travel_requirement, land_travel_requirement, security_clearance,
                 is_high_school_required, is_driver_license_required,
                 associates_degree_requirement, bachelors_degree_requirement,
                 masters_degree_requirement, doctorate_degree_requirement,
                 licenses_or_certifications_not_mentioned,
                 is_industry_and_role_yoe_not_mentioned,
                 is_management_yoe_not_mentioned, relocation_assistance,
                 "401k_matching", retirement_plan, tuition_reimbursement,
                 generous_paid_time_off, generous_parental_leave, fair_chance,
                 military_veterans, is_workplace_worldwide_ok, position_employer_type,
                 num_language_requirements)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(job_id) DO UPDATE SET
                 workplace_physical_environment=excluded.workplace_physical_environment,
                 physical_labor_intensity=excluded.physical_labor_intensity,
                 physical_position=excluded.physical_position,
                 computer_usage=excluded.computer_usage,
                 cognitive_demand=excluded.cognitive_demand,
                 oral_communication_level=excluded.oral_communication_level,
                 morning_shift_work=excluded.morning_shift_work,
                 evening_shift_work=excluded.evening_shift_work,
                 overnight_work=excluded.overnight_work,
                 weekend_availability_required=excluded.weekend_availability_required,
                 holiday_availability_required=excluded.holiday_availability_required,
                 overtime_required=excluded.overtime_required,
                 on_call_requirement=excluded.on_call_requirement,
                 four_day_work_week=excluded.four_day_work_week,
                 air_travel_requirement=excluded.air_travel_requirement,
                 land_travel_requirement=excluded.land_travel_requirement,
                 security_clearance=excluded.security_clearance,
                 is_high_school_required=excluded.is_high_school_required,
                 is_driver_license_required=excluded.is_driver_license_required,
                 associates_degree_requirement=excluded.associates_degree_requirement,
                 bachelors_degree_requirement=excluded.bachelors_degree_requirement,
                 masters_degree_requirement=excluded.masters_degree_requirement,
                 doctorate_degree_requirement=excluded.doctorate_degree_requirement,
                 licenses_or_certifications_not_mentioned=excluded.licenses_or_certifications_not_mentioned,
                 is_industry_and_role_yoe_not_mentioned=excluded.is_industry_and_role_yoe_not_mentioned,
                 is_management_yoe_not_mentioned=excluded.is_management_yoe_not_mentioned,
                 relocation_assistance=excluded.relocation_assistance,
                 "401k_matching"=excluded."401k_matching",
                 retirement_plan=excluded.retirement_plan,
                 tuition_reimbursement=excluded.tuition_reimbursement,
                 generous_paid_time_off=excluded.generous_paid_time_off,
                 generous_parental_leave=excluded.generous_parental_leave,
                 fair_chance=excluded.fair_chance,
                 military_veterans=excluded.military_veterans,
                 is_workplace_worldwide_ok=excluded.is_workplace_worldwide_ok,
                 position_employer_type=excluded.position_employer_type,
                 num_language_requirements=excluded.num_language_requirements""",
            (oid,
             enum(v5.get("workplace_physical_environment")),
             enum(v5.get("physical_labor_intensity")),
             enum(v5.get("physical_position")),
             enum(v5.get("computer_usage")),
             enum(v5.get("cognitive_demand")),
             enum(v5.get("oral_communication_level")),
             enum(v5.get("morning_shift_work")),
             enum(v5.get("evening_shift_work")),
             enum(v5.get("overnight_work")),
             boolean(v5.get("weekend_availability_required")),
             boolean(v5.get("holiday_availability_required")),
             boolean(v5.get("overtime_required")),
             enum(v5.get("on_call_requirement")),
             boolean(v5.get("four_day_work_week")),
             enum(v5.get("air_travel_requirement")),
             enum(v5.get("land_travel_requirement")),
             enum(v5.get("security_clearance")),
             boolean(v5.get("is_high_school_required")),
             boolean(v5.get("is_driver_license_required")),
             enum(v5.get("associates_degree_requirement")),
             enum(v5.get("bachelors_degree_requirement")),
             enum(v5.get("masters_degree_requirement")),
             enum(v5.get("doctorate_degree_requirement")),
             boolean(v5.get("licenses_or_certifications_not_mentioned")),
             boolean(v5.get("is_min_industry_and_role_yoe_not_mentioned")),
             boolean(v5.get("is_min_management_and_leadership_yoe_not_mentioned")),
             boolean(v5.get("relocation_assistance")),
             boolean(v5.get("401k_matching")),
             boolean(v5.get("retirement_plan")),
             boolean(v5.get("tuition_reimbursement")),
             boolean(v5.get("generous_paid_time_off")),
             boolean(v5.get("generous_parental_leave")),
             boolean(v5.get("fair_chance")),
             boolean(v5.get("military_veterans")),
             boolean(v5.get("is_workplace_worldwide_ok")),
             enum(v5.get("position_employer_type")),
             num(v5.get("num_language_requirements"))))

        # junctions
        con.executemany(
            "INSERT OR IGNORE INTO job_locations(job_id, scope, level, value, country_code) "
            "VALUES (?,?,?,?,?)", location_rows(oid, v5))
        con.executemany("INSERT OR IGNORE INTO job_commitments(job_id, commitment) VALUES (?,?)",
                        [(oid, c) for c in (v5.get("commitment") or []) if c])
        con.executemany("INSERT OR IGNORE INTO job_tools(job_id, tool) VALUES (?,?)",
                        [(oid, t) for t in (v5.get("technical_tools") or []) if t])
        con.executemany("INSERT OR IGNORE INTO job_licenses(job_id, license) VALUES (?,?)",
                        [(oid, l) for l in (v5.get("licenses_or_certifications") or []) if l])
        con.executemany("INSERT OR IGNORE INTO job_languages(job_id, language) VALUES (?,?)",
                        [(oid, l) for l in (v5.get("language_requirements") or []) if l])
        con.executemany("INSERT OR IGNORE INTO job_role_activities(job_id, activity) VALUES (?,?)",
                        [(oid, a) for a in (v5.get("role_activities") or []) if a])
        for level, key in (("associates", "associates_degree_fields_of_study"),
                           ("bachelors", "bachelors_degree_fields_of_study"),
                           ("masters", "masters_degree_fields_of_study"),
                           ("doctorate", "doctorate_degree_fields_of_study")):
            con.executemany(
                "INSERT OR IGNORE INTO job_degree_fields(job_id, level, field) VALUES (?,?,?)",
                [(oid, level, f) for f in (v5.get(key) or []) if f])
        con.execute("INSERT OR IGNORE INTO descriptions(job_id, status) VALUES (?, 'pending')", (oid,))
        n += 1
    con.commit()
    return n


# ------------------------------------------------------------------ enumerate
def search_state(dfrom: str, dto: str, filters: str | None = None) -> str:
    st: dict = {"dateFetchedPastNDays": {"from": dfrom, "to": dto},
                "sortBy": "date"}
    if filters:
        st.update(json.loads(filters))
    return json.dumps(st, separators=(",", ":"))


def classic_url(state: str, page: int) -> str:
    return f"{CLASSIC}?searchState={quote(state)}&page={page}"


# The SSR search serves at most ~42 pages (1,680 hits) per query regardless of
# ssrTotalCount, so any query with more hits than RETRIEVE_CAP cannot be read in
# full on its own — it must be split.  Confirmed split axes (2026-11): searchState
# accepts camelCase `workplaceTypes` (Remote/Hybrid/Onsite) and `roleTypes`
# ("Individual Contributor"/"People Manager"); per day their counts sum to the
# unfiltered total exactly, so the combination has no coverage gap.
RETRIEVE_CAP = 1600
SPLIT_AXES = [{"workplaceTypes": [w], "roleTypes": [r]}
              for w in ("Remote", "Hybrid", "Onsite")
              for r in ("Individual Contributor", "People Manager")]

# Even a workplace×role day-slice can exceed the page cap (Onsite×IC runs ~4.4k/day).
# Third axis: `locations` (verified filter key). Country names for the ISO codes the
# site's job records use; if a country slice is still over the cap, fall back to that
# country's states (from job_locations), else accept partial coverage and say so.
SPLIT_COUNTRIES = ("Canada", "United States", "United Kingdom", "Germany", "Mexico",
                   "Brazil", "Spain", "Ireland", "Australia", "Netherlands",
                   "Italy", "India")
COUNTRY_CODE = {"Canada": "CA", "United States": "US", "United Kingdom": "GB",
                "Germany": "DE", "Mexico": "MX", "Brazil": "BR", "Spain": "ES",
                "Ireland": "IE", "Australia": "AU", "Netherlands": "NL",
                "Italy": "IT", "India": "IN"}


def _location_filter(name: str, types: list[str]) -> dict:
    return {"locations": [{"formatted_address": name, "types": types}]}


def _split_locations(con, dfrom: str, dto: str, sid: int, filters: str, total: int) -> None:
    """Split an over-cap filtered day-shard by country (then state)."""
    cur = json.loads(filters) if filters else {}
    locs = (cur.get("locations") or [])
    inserts: list[tuple[str, str]] = []
    if not locs:                                    # level 1: by country
        for name in SPLIT_COUNTRIES:
            nxt = dict(cur, **{"locations": [{"formatted_address": name, "types": ["country"]}]})
            inserts.append((dfrom, json.dumps(nxt, separators=(",", ":"))))
    else:
        addr = locs[0]
        code = COUNTRY_CODE.get(addr.get("formatted_address"))
        if addr.get("types") == ["country"] and code:
            states = [r[0] for r in con.execute(
                "SELECT value FROM job_locations WHERE level='state' AND country_code=? "
                "GROUP BY value ORDER BY COUNT(*) DESC LIMIT 40", (code,))]
            for st in states:
                nxt = dict(cur, **{"locations": [{
                    "formatted_address": st,
                    "types": ["administrative_area_level_1"]}]})
                inserts.append((dfrom, json.dumps(nxt, separators=(",", ":"))))
        else:
            log(f"WARNING {dfrom} {filters or ''}: {total} hits over cap and no finer "
                f"location split available — coverage partial")
            return
    con.execute("UPDATE shards SET status='split' WHERE id=?", (sid,))
    for d, f in inserts:
        con.execute("INSERT INTO shards(dfrom, dto, filters) VALUES (?,?,?)", (d, d, f))
    con.commit()
    log(f"shard {dfrom} {filters or ''}: {total} hits > {RETRIEVE_CAP} → "
        f"{len(inserts)} location shards")


def enumerate_all(client: Client, start: str, end: str) -> None:
    con = connect()
    # Reuse an unfinished shard for this range; otherwise queue a fresh scan of it, so
    # each sync pass re-reads its window and picks up postings that appeared since.
    if not con.execute("SELECT 1 FROM shards WHERE dfrom=? AND dto=? AND status='pending'",
                       (start, end)).fetchone():
        con.execute("INSERT INTO shards(dfrom, dto) VALUES (?,?)", (start, end))
        con.commit()

    while True:
        row = con.execute("SELECT id, dfrom, dto, filters FROM shards WHERE status='pending' "
                          "ORDER BY dfrom LIMIT 1").fetchone()
        if not row:
            break
        sid, dfrom, dto, filters = row["id"], row["dfrom"], row["dto"], row["filters"]
        state = search_state(dfrom, dto, filters)
        pp = parse_next_data(client.get(classic_url(state, 0))) or {}
        total = pp.get("ssrTotalCount") or 0
        con.execute("UPDATE shards SET total=? WHERE id=?", (total, sid))
        con.commit()

        if total > RETRIEVE_CAP and dfrom != dto:
            # multi-day window still too big → bisect by date first (children strictly
            # smaller: a 2-day range becomes two 1-day shards)
            d1, d2 = date.fromisoformat(dfrom), date.fromisoformat(dto)
            days = (d2 - d1).days + 1
            half = max(1, days // 2)
            mid = d1 + timedelta(days=half - 1)
            mid2 = mid + timedelta(days=1)
            con.execute("UPDATE shards SET status='split' WHERE id=?", (sid,))
            for f in (filters,):
                con.execute("INSERT INTO shards(dfrom, dto, filters) VALUES (?,?,?)",
                            (dfrom, mid.isoformat(), f))
                con.execute("INSERT INTO shards(dfrom, dto, filters) VALUES (?,?,?)",
                            (mid2.isoformat(), dto, f))
            con.commit()
            log(f"shard {dfrom}..{dto}: {total} hits > {RETRIEVE_CAP} → split at {mid}")
            continue

        if total > RETRIEVE_CAP and not filters:
            # single day too big → split across workplace × roleType (sums match the
            # unfiltered total exactly, so no coverage gap)
            con.execute("UPDATE shards SET status='split' WHERE id=?", (sid,))
            for axis in SPLIT_AXES:
                con.execute("INSERT INTO shards(dfrom, dto, filters) VALUES (?,?,?)",
                            (dfrom, dto, json.dumps(axis, separators=(",", ":"))))
            con.commit()
            log(f"shard {dfrom}..{dto}: {total} hits > {RETRIEVE_CAP} → "
                f"{len(SPLIT_AXES)} workplace×role shards")
            continue

        if total > RETRIEVE_CAP and filters:
            # single day + workplace/role split still over cap → split by location
            _split_locations(con, dfrom, dto, sid, filters, total)
            continue

        label = f"{dfrom}..{dto}" + (f" {filters}" if filters else "")
        log(f"shard {label}: {total} hits")
        if total == 0:
            con.execute("UPDATE shards SET status='done' WHERE id=?", (sid,))
            con.commit()
            continue

        done = {r["page"] for r in con.execute("SELECT page FROM pages WHERE shard_id=?", (sid,))}
        last_page = min(MAX_PAGES - 1, (total - 1) // PAGE_SIZE)
        got = 0
        for page in range(last_page + 1):
            if page in done:
                continue
            pp_page = pp if page == 0 else (parse_next_data(client.get(classic_url(state, page))) or {})
            hits = pp_page.get("ssrHits") or []
            got += save_hits(con, hits)
            con.execute("INSERT OR REPLACE INTO pages(shard_id, page, hits) VALUES (?,?,?)",
                        (sid, page, len(hits)))
            con.commit()
            if page % 25 == 0:
                log(f"  page {page}/{last_page}  +{got} jobs  ({client.stats['req']} req)")
            if page and not hits:
                break   # the site's ssrIsLastPage flag is unreliable; an empty page is the end
        con.execute("UPDATE shards SET status='done' WHERE id=?", (sid,))
        con.commit()
        note = "" if got * 0.9 < total <= got * 1.1 or last_page <= 41 else \
               "  (WARNING: page cap likely hit — coverage incomplete)"
        log(f"shard {label} done (+{got} of {total}){note}")


# -------------------------------------------------------------------- details
def fetch_description(client: Client, requisition_id: str) -> tuple[str, str, int]:
    html = client.get(f"{BASE}/job/{requisition_id}")
    if not html:
        return "gone", "", 404
    pp = parse_next_data(html)
    if not pp or not pp.get("job"):
        return "gone", "", 200
    info = pp["job"].get("job_information") or {}
    return "done", info.get("description") or "", 200


def details(client: Client, limit: int | None = None) -> None:
    con = connect()
    q = """SELECT d.job_id, j.requisition_id FROM descriptions d
           JOIN jobs j ON j.object_id = d.job_id
           WHERE d.status='pending' AND j.requisition_id IS NOT NULL
           ORDER BY j.published_at DESC"""
    if limit:
        q += f" LIMIT {int(limit)}"
    rows = con.execute(q).fetchall()
    log(f"{len(rows):,} descriptions to fetch")
    if not rows:
        return
    t0, done, lock = time.time(), 0, threading.Lock()

    def work(row):
        nonlocal done
        jid, req = row["job_id"], row["requisition_id"]
        try:
            status, html, code = fetch_description(client, req)
        except Challenge as e:
            log(str(e))
            status, html, code = "error", "", 0
        text = clean_text(html)
        c = connect()
        c.execute("""UPDATE descriptions SET html=?, text=?, word_count=?, status=?,
                     http_status=?, fetched_at=? WHERE job_id=?""",
                  (html, text, len(text.split()), status, code, utcnow(), jid))
        c.commit()
        c.close()
        with lock:
            done += 1
            if done % 25 == 0:
                rate = done / max(time.time() - t0, 1e-6)
                log(f"{done}/{len(rows)} descriptions  {rate:.2f}/s  "
                    f"eta {(len(rows)-done)/max(rate, 1e-6)/3600:.1f}h")

    with ThreadPoolExecutor(client.workers) as ex:
        list(ex.map(work, rows))


# ---------------------------------------------------------------------- stats
def stats() -> None:
    con = connect()
    q = lambda sql: con.execute(sql).fetchone()[0]  # noqa: E731
    print(f"jobs             {q('SELECT COUNT(*) FROM jobs'):,}")
    print(f"companies        {q('SELECT COUNT(*) FROM companies'):,}")
    print(f"descriptions     {q('SELECT COUNT(*) FROM descriptions'):,}")
    for status, n in con.execute("SELECT status, COUNT(*) FROM descriptions GROUP BY status"):
        print(f"  {status:8s}      {n:,}")
    print(f"pages read       {q('SELECT COUNT(*) FROM pages'):,}")
    print(f"shards           {dict((r[0], r[1]) for r in con.execute('SELECT status, COUNT(*) FROM shards GROUP BY status'))}")
    print(f"locations        {q('SELECT COUNT(*) FROM job_locations'):,}")
    print(f"tools            {q('SELECT COUNT(*) FROM job_tools'):,}")
    top = con.execute("""SELECT c.name, COUNT(*) n FROM jobs j JOIN companies c ON c.id=j.company_id
                         GROUP BY c.id ORDER BY n DESC LIMIT 8""").fetchall()
    if top:
        print("top companies   " + ", ".join(f"{r[0]} ({r[1]})" for r in top))
    dep = con.execute("""SELECT department, COUNT(*) n FROM jobs WHERE department IS NOT NULL
                         GROUP BY department ORDER BY n DESC LIMIT 8""").fetchall()
    if dep:
        print("top departments " + ", ".join(f"{r[0]} ({r[1]})" for r in dep))
    print("by ATS source   (total / described / pending)")
    for src, tot, dsc, pen in con.execute("""
            SELECT COALESCE(j.source,'?'),
                   COUNT(*),
                   SUM(d.status='done'),
                   SUM(d.status='pending')
            FROM jobs j JOIN descriptions d ON d.job_id=j.object_id
            GROUP BY j.source ORDER BY COUNT(*) DESC"""):
        print(f"  {src:18s} {tot:6,d}  {dsc or 0:6,d}  {pen or 0:6,d}")


# --------------------------------------------------------------------- export
def dump_csv(con, name: str, sql: str) -> None:
    cur = con.execute(sql)
    path = EXPORT / f"{name}.csv"
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([d[0] for d in cur.description])
        w.writerows(cur.fetchall())
    log(f"  {path.name:28s} {path.stat().st_size/1e6:7.1f} MB")


def export() -> None:
    EXPORT.mkdir(parents=True, exist_ok=True)
    con = connect()
    log(f"exporting to {EXPORT}")
    dump_csv(con, "jobs", "SELECT * FROM v_jobs ORDER BY published_at DESC")
    dump_csv(con, "companies", "SELECT * FROM companies ORDER BY name")
    dump_csv(con, "job_facets", "SELECT * FROM job_facets")
    for t in ("job_locations", "job_commitments", "job_tools", "job_licenses",
              "job_languages", "job_degree_fields", "job_role_activities",
              "company_industries", "company_activities", "company_aliases",
              "company_subsidiaries", "company_funding_investors"):
        dump_csv(con, t, f"SELECT * FROM {t}")

    # nested JSONL for app import
    path = EXPORT / "jobs.jsonl.gz"
    cols = {r[0] for r in con.execute("PRAGMA table_info(jobs)")}
    nested = {}
    for t, key in (("job_locations", "locations"), ("job_commitments", "commitments"),
                   ("job_tools", "tools"), ("job_licenses", "licenses"),
                   ("job_languages", "languages"), ("job_role_activities", "role_activities")):
        nested[t] = {}
        for r in con.execute(f"SELECT job_id, * FROM {t}"):
            nested[t].setdefault(r["job_id"], []).append(
                r[2] if t != "job_locations" else {"scope": r["scope"], "level": r["level"],
                                                   "value": r["value"], "country_code": r["country_code"]})
    degrees = {}
    for r in con.execute("SELECT job_id, level, field FROM job_degree_fields"):
        degrees.setdefault(r["job_id"], {}).setdefault(r["level"], []).append(r["field"])

    n = 0
    with gzip.open(path, "wt", encoding="utf-8") as f:
        for job in con.execute("""SELECT j.*, c.name company_name, c.website company_website,
                                         c.industry company_industry, c.employee_count company_size,
                                         c.founded_year company_founded, c.organization_type,
                                         c.stock_symbol, c.stock_exchange, c.parent_company,
                                         f.* , d.text description_text, d.html description_html,
                                         d.status description_status
                                  FROM jobs j
                                  LEFT JOIN companies c ON c.id=j.company_id
                                  LEFT JOIN job_facets f ON f.job_id=j.object_id
                                  LEFT JOIN descriptions d ON d.job_id=j.object_id"""):
            rec = {k: job[k] for k in job.keys()}
            oid = rec["object_id"]
            rec["locations"] = nested["job_locations"].get(oid, [])
            rec["commitments"] = nested["job_commitments"].get(oid, [])
            rec["tools"] = nested["job_tools"].get(oid, [])
            rec["licenses"] = nested["job_licenses"].get(oid, [])
            rec["languages"] = nested["job_languages"].get(oid, [])
            rec["role_activities"] = nested["job_role_activities"].get(oid, [])
            rec["degree_fields"] = degrees.get(oid, {})
            f.write(json.dumps(rec, ensure_ascii=False, default=str) + "\n")
            n += 1
    log(f"  {path.name:28s} {path.stat().st_size/1e6:7.1f} MB  ({n:,} jobs)")


# -------------------------------------------------------------------- preview
def preview() -> None:
    import html as H
    con = connect()
    rows = con.execute("""SELECT v.*, d.html description_html FROM v_jobs v
                          LEFT JOIN descriptions d ON d.job_id = v.object_id
                          ORDER BY v.published_at DESC""").fetchall()

    def money(r):
        lo, hi, cur = r["salary_yearly_min"], r["salary_yearly_max"], r["salary_currency"] or ""
        if not lo and not hi:
            return ""
        f = lambda v: f"{v/1000:.0f}k" if v else ""  # noqa: E731
        return f"{cur} {f(lo)}–{f(hi)}/yr" if lo and hi and lo != hi else f"{cur} {f(lo or hi)}/yr"

    cards = []
    for r in rows:
        tags = "".join(f"<span>{H.escape(str(r[k]))}</span>" for k in
                       ("workplace_type", "seniority_level", "role_type", "department",
                        "security_clearance") if r[k])
        if r["yoe_min"]:
            tags += f"<span>{int(r['yoe_min'])}+ yoe</span>"
        cards.append(f"""<article class="card">
  <h3>{H.escape(r['title'] or '')}</h3>
  <div class="co">{H.escape(r['company'] or '')} · {H.escape(r['location'] or '')}</div>
  <div class="sal">{H.escape(money(r))}</div>
  <div class="tags">{tags}</div>
  <details{' open' if r['description_status']=='done' else ''}><summary>Description</summary>
    <div class="desc">{r['description_html'] or '<i>not fetched yet</i>'}</div></details>
  <div class="foot"><span>{(r['published_at'] or '')[:10]}</span>
    <a href="{H.escape(r['job_url'] or '#')}" target="_blank">HiringCafe</a>
    <a href="{H.escape(r['apply_url'] or '#')}" target="_blank">Apply</a></div>
</article>""")

    out = DATA / "preview.html"
    out.write_text(f"""<!doctype html><meta charset="utf-8">
<title>HiringCafe seed data — {len(rows):,} jobs</title>
<style>
body{{font:15px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f6f6f8;color:#18181b}}
header{{position:sticky;top:0;background:#fff;border-bottom:1px solid #e4e4e7;padding:12px 20px;z-index:9}}
h1{{font-size:16px;margin:0 0 8px}} input{{width:100%;max-width:520px;padding:8px 12px;border:1px solid #d4d4d8;border-radius:8px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(390px,1fr));gap:14px;padding:18px}}
.card{{background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:14px}}
.card h3{{margin:0 0 4px;font-size:15px}} .co{{font-size:13px;color:#52525b}}
.sal{{color:#047857;font-weight:600;font-size:13px;margin:4px 0}}
.tags{{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}}
.tags span{{background:#f4f4f5;border-radius:999px;padding:2px 8px;font-size:11.5px;color:#3f3f46}}
details summary{{cursor:pointer;font-size:13px;color:#4338ca}}
.desc{{max-height:320px;overflow:auto;font-size:13px;border-top:1px dashed #e4e4e7;margin-top:6px}}
.desc img{{max-width:100%}} .foot{{display:flex;gap:12px;font-size:12px;color:#71717a;border-top:1px solid #f4f4f5;padding-top:8px;margin-top:8px}}
.foot a{{color:#4338ca;text-decoration:none}} footer{{padding:0 20px 30px;color:#71717a;font-size:12px}}
</style>
<header><h1>HiringCafe seed data — {len(rows):,} jobs</h1>
<input id="q" placeholder="filter title, company, location, tag, description…"></header>
<div class="grid" id="g">{''.join(cards)}</div>
<footer>generated {utcnow()} · scrape/hiringcafe.py preview</footer>
<script>
const q=document.getElementById('q'),c=[...document.querySelectorAll('.card')];
q.addEventListener('input',()=>{{const v=q.value.toLowerCase();for(const e of c)
 e.style.display=e.textContent.toLowerCase().includes(v)?'':'none';}});
</script>""")
    log(f"wrote {out} ({out.stat().st_size/1e6:.1f} MB, {len(rows):,} jobs)")


# ----------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["init", "cookies", "enumerate", "details", "sync",
                                    "stats", "export", "preview"])
    ap.add_argument("--from", dest="dfrom", default=None)
    ap.add_argument("--to", dest="dto", default=None)
    ap.add_argument("--rps", type=float, default=0.8)
    ap.add_argument("--window", type=int, default=80, help="max requests per window")
    ap.add_argument("--window-s", type=int, default=600, help="window length, seconds")
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--days", type=int, default=2, help="sync window, days back")
    ap.add_argument("--page-id", default=None)
    a = ap.parse_args()

    if a.cmd == "init":
        init_db()
        return
    if a.cmd == "cookies":
        c = pull_cookies(a.page_id)
        log(f"pulled {len(c)} cookies (cf_clearance: {'yes' if 'cf_clearance' in c else 'NO'})")
        return
    if a.cmd == "stats":
        stats()
        return
    if a.cmd == "export":
        export()
        return
    if a.cmd == "preview":
        preview()
        return

    if a.cmd == "sync":
        a.dto = date.today().isoformat()
        a.dfrom = (date.today() - timedelta(days=a.days)).isoformat()
    if a.cmd in ("enumerate", "sync") and not (a.dfrom and a.dto):
        sys.exit("enumerate needs --from YYYY-MM-DD --to YYYY-MM-DD")
    client = Client(a.rps, a.workers, a.window, a.window_s)
    try:
        if a.cmd in ("enumerate", "sync"):
            enumerate_all(client, a.dfrom, a.dto)
        if a.cmd in ("details", "sync"):
            details(client, a.limit)
    except KeyboardInterrupt:
        log("interrupted — progress saved, rerun to resume")
    finally:
        log(f"requests={client.stats['req']} transferred={client.stats['bytes']/1e6:.0f} MB "
            f"challenges={client.stats['challenges']}")
        stats()


if __name__ == "__main__":
    main()
