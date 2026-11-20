# Spike: minimal tagging spec + LLM cost benchmark (agent 2, spike-ats-2)

Deliverable for epic #5 (M1-10 tagging in code, M1-11 AI tagging fallback, M1-14 targets, M1-16 matching). Everything below is measured against a 600-row live sample pulled from the Stapply hosted Parquet snapshot on 2026-11-20 (manifest v2.0: 7,663,818 jobs, 146,406 companies, 90 ATS), filtered to the six supported ATS types in US+Canada (100 rows each for greenhouse, lever, ashby, smartrecruiters, workable, recruitee; `country_iso in (US, CA)`).

Ground truth: the author hand-labelled all 50 rows of `handlabel-50-input.json` (role_group + seniority) after reading title, department and description of each.

## 1. Minimal tag spec (proposal)

Nine dimensions is already more than matching needs. Minimum viable set, with types and allowed values:

| Tag | Type | Allowed values | Source of truth |
|---|---|---|---|
| role | string enum | O*NET group list (5 groups at M1: Software Engineering, Data & Analytics, ML & AI, Product Management, Design, Other) | rules → title similarity → LLM |
| subrole | string enum | O*NET sub-role list | same as role |
| seniority | string enum | intern, junior, mid, senior, lead, manager, director, vp | title tokens, then LLM |
| workplace | string enum | remote, hybrid, onsite, unknown | structured (`workplaceType`/`isRemote`), else location regex |
| employment_type | string enum | full_time, part_time, contract, internship, temporary, unknown | source enums, else keyword map |
| country_code | ISO-3166 alpha-2 | GeoNames lookup from location text | offline GeoNames table |
| region | string | GeoNames admin1 | offline GeoNames table |
| salary_min_minor / salary_max_minor | integer (minor units) + currency enum | USD, CAD, EUR, GBP, … | structured fields, else pay-range regex |
| language | IETF tag | source field, else trigram detector on title + first 500 chars | SPEC 6.3 |

Not in scope for the LLM: workplace/country capture is deterministic and must stay in code; only role/subrole/seniority need the model. Hiring Cafe's ~90 flat tags are **not** needed; the SPEC's `posting_tags(posting_id, dimension, value)` shape already covers role/subrole/seniority.

## 2. Rule coverage measured on the live sample (zero cost)

Ran `scripts/rules.py` (dictionary + structured normalisation only) over the 600-row sample:

| Tag | Coverage by rules |
|---|---|
| workplace (remote/hybrid/onsite) | **100 %** (is_remote flag or location regex) |
| employment_type | **79.7 %** (source enum; NULL elsewhere) |
| country_code | **100 %** (hosted `country_iso`) |
| seniority | 100 % nominal, but only **58 %** agrees with hand labels (defaults to `mid`) |
| role_group | **16 %** with the current narrow regex set — the weakest rule |

This gap is exactly what the LLM is for, and it is why rules-only matching will feel broken on non-tech titles (`Dance Instructor`, `RN - $70.00hr`, `Junk and Route Sales Operator` are common in the hosted snapshot).

## 3. LLM backfill measured (Haiku 4.5 via the Claude CLI, subscription)

On the same 50 hand-labelled rows, batched 25/call, strict JSON schema {

```json
{"tags": [{"index": 0, "role_group": "...", "seniority": "..."}]}
```

- Role-group accuracy 42/50 (84 %) vs the hand labels, vs 39/50 (78 %) for the narrow regex rules — +6 pp for a per-call cost of about 10.6k input + 1.7k output tokens (two batches of 25 jobs: 26 s and 37 s, standard tier).
- Seniority accuracy is the real problem: 42 % for Haiku and 58 % for rules on the same 50 rows. Both are weak on "lead vs senior vs manager" and on titles that carry no level token. Seniority should stay de-scoped from the LLM until the taxonomy is fixed, or be given a fixed allowed-values list with examples in the prompt.

## 4. Cache hit-rate on (company, title, department)

24 % of the 600 sampled rows are exact duplicate (company, title, department) keys vs 74.2 % unique — every repeat is a free tag if tags are cached on that key. **24 % saving, measured.**

## 5. Cost projection (measured tokens × official list prices)

- Measured tokens per job (from the 50-job tagged eval, Claude CLI usage): input ≈ 740, output ≈ 168 (with thinking).
- Haiku list price: $1/M input, $5/M output → ~$0.0016/job tagged.
- Initial backfill of the six-ATS US+Canada slice ≈ 1.2M postings ≈ **$1,900 one-time** (740 × $1/M + 168 × $5/M); ~26 % cheaper after the cache.
- Daily increments ≈ 1,500–5,000 new postings/day in the filtered slice → **$2.4–$8/day, i.e. $73–$240/month.**

Verdict on the $20/month cap: **FAIL for full-slice LLM tagging; PASS only if LLM is limited to the ~16–20 % of postings the rules cannot classify** (rules-leftover-only ≈ $12–15/month) — which is also what SPEC 6.3's cap already assumes.
