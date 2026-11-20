# ATS spike — Go/No-Go memo

From spike reports 1–3 (`docs/research/ats-spike/1…3-*.md`), measured 2026-11-20; reviewed and corrected by the orchestrator against the raw reports.

## 1. Scorecard

| Metric | Measured | Threshold | Score |
|---|---|---|---|
| Freshness | 29.5 h | < 48 h | PASS |
| Form-fillable URL rate | 85 % headless (55 % static) | ≥ 90 % | FAIL |
| Coverage | 88.6 % (39/44) | ≥ 80 % | PASS |
| Monthly LLM cost | $73–$240 full-slice; $12–$15 rules-leftover-only | ≤ $20/month | PASS only rules-leftover |

Caveats:

- **URL rate**: the failure is snapshot staleness, not form shape — 3/20 sampled URLs are API-closed but still listed (evicted rows linger ≥ 4 weeks), so even a perfect client tops out < 90 % (R1 §Verdict, §5).
- **URL fields**: Greenhouse `apply_url` is 0 % non-null while `url` is 100 % — key forms on `url` + per-ATS rewrite rules, never `apply_url` (R1 §Risks 2).
- **Ashby** renders 0/6 forms server-side; it needs a browser either way (R1 §Risks 4).
- **Coverage**: the denominator is small (39/44 hc top-500 companies on supported ATS); it does not prove US mid-market coverage (R3 §5.5, §Risks 2).
- **Costs**: report 2's figures (~$0.0016/job, $1,900 full backfill, $2.4–$8/day) use **Haiku 4.5 at list price**, not Haiku 5.5 Batch; Batch halves them (rules-leftover ≈ $6–8/month). Gemini and GPT were not benchmarked (R2 §3, §5).
- **Rule coverage**: R2's 16 % role_group comes from the spike's throwaway regex. Our real #17 tag module classifies **81.2 %** of 709 live postings by rules (PR #53), leaving 18.5 % for the LLM — consistent with the 16–20 % leftover used for cost. R2's 100 % workplace relies on the snapshot's `is_remote`; direct Greenhouse feeds lack it (#17 measures 55.9 %).

## 2. Recommendation: **(B) hybrid** — ats-scrapers as seed and discovery source feeding our own direct feed clients; LLM only for what rules leave unfilled.

1. Option (A) fails the URL bar (85 % < 90 %, R1) and gives no per-row expiry signal; one wasted-dispatch liveness re-check would carry the whole catalog (R3 §4.2, §8).
2. `companies.parquet` alone replaces the lost v1 seed: ~39k supported-ATS tenants vs ~22,800 v1 boards, for ~8 MB of inputs (R3 §7.1–7.2).
3. Our own clients give minutes-level freshness and clean provenance; hosted slices arrive L+1…2 days late and contradict SPEC §3 (R3 §7.2).
4. LLM on rules leftovers only ≈ $12–15/month at list price, ≈ $6–8 with Batch. Our #17 rules already tag 81 % of roles; on hand labels the LLM lifts role accuracy 78 % → 84 % (R2 §3, §5; PR #53).

**Hiring Cafe**: drop `/api/mcp` as a runtime source (429s under load, robots-hostile, redundant — feeds already carry descriptions); keep only the one-time tag-import seam (R3 §6).

## 3. Phase 1 checklist

1. **#16**: seed pipeline from `companies.parquet` into `company_boards` (source='discovered') — exact-slug match, human review, verify board URLs; Workable's 13.1 % slug match needs rework.
2. **#16**: sha256-pin the manifest; monthly refresh with schema-drift alerts.
3. **#14**: key Greenhouse forms on `url` + rewrite rules; add the SPEC §9.3 pre-send liveness re-check.
4. **#15**: same `url` keying for Lever; plan Ashby as browser-required (0/6 static).
5. **#17/#18**: LLM only for the ~16–20 % rules-leftover; keep seniority LLM-out until the taxonomy is fixed (42 % model vs 58 % rules, R2 §3).

## 4. Risks

- **Uncontracted single-vendor hosting**: Stapply is one person's R2 bucket; if it dies the seed-refresh path dies, so the catalog must tolerate a frozen seed (R3 §Risks 1).
- **Coverage PASS rests on a small, biased base**: one hc week, 99.2 % Canada; US Greenhouse demand unmeasured (R3 §5.3, §Risks 2).
- **Salary is out from any snapshot**: `salary_summary` 100 % null across 1.93 M rows, `salary_min/max` ≤ 40 % — the salary floor needs live parsing or ships without salary (R1 §3).
