---
status: accepted
---

# Matching score and sort

The 2026-11-26 rebuild (Epic #678, written down by #679; implemented by #686 on the #685 proof set). It amends ADR
0043 (whose role taxonomy and labels are retired) and ADR 0011 (lazy two-stage matching, whose threshold and score
bound are gone).

## Context

The match list is the product: a person picks jobs from it, so its order and its stability matter more than any single
number. The 2026-11-25/26 measurements on a local copy of the production catalog (137,723 jobs) found three problems
worth designing around:

- **Scoring jobs in groups changes the answer.** A job scored in a group of ten differed by 10–12 points on average
  (up to 62) from the same job scored alone.
- **The same job scored twice differs.** Re-running the model on one job differed by 6.5 points on average and up to
  29. A sort by raw score therefore wobbled between page loads, and a ±7 point wobble could push a weak job above a
  strong one.
- **A code rank is not a score.** The onboarding run showed "85" on every pick because AI scoring had not run and the
  page fell back to `codeRank` (`src/server/matching/score.ts:710`). A made-up number is worse than no number.

The owner's rules: role and location are the only hard filters; a false positive is worse than a miss; one job per
call; store a score once; never show ranking points as a match score.

## Decision

### 1. Pool (code, no AI)

```
pool   = open, apply-supported Postings
       ∩ role      (a freehire category matches every job in it; a title word matches a title containing it)
       ∩ place ids (posting place ids overlap the user's place ids; `Remote · X` only for a remote job scoped to X)
       ∩ language  (posting language ∈ the user's languages, or undetected)
       − excluded employers − non-jobs − companies in cooldown − already applied
```

Code rank decides **which jobs are scored first**, never the order the user sees: exact category or title word before
category-only, then newest posting, then posting id.

### 2. Score (Claude Haiku 5.5, one job per call, structured output)

The prompt (`src/server/matching/prompts/score-v1.ts`, version in the cache key) puts the resume and the rubric first so
implicit caching covers them, and asks for four anchored sub-scores, a fixed blocker list and two or three short
reasons:

| Field | Allowed values |
|---|---|
| `role_fit` | 0, 15, 30, 40 (same role and domain → different field) |
| `skills` | 0, 10, 20, 30 (how many MUST-HAVE requirements the resume shows; no requirements → 20) |
| `level` | 0, 4, 12, 20 (years and scope match → three or more levels off) |
| `logistics` | 0, 5, 10 (location, language and work authorisation fit → a stated requirement the candidate misses) |
| `blockers` | `license_required`, `language_required`, `level_far_off`, `wrong_field`, `location_incompatible`, `not_a_job` |
| `reasons` | 2–3 strings, each at most 110 characters, each naming one concrete fact |

A missing skill or technology is never a blocker; it lowers `skills`. The reply is validated by the same zod schema
(ADR 0044): invalid → one retry → rejected, and the job stays unscored. Anthropic structured outputs accept only
`minItems` 0 or 1, so the 2–3 reason count is enforced by the zod schema and the prompt, not by the wire schema.

### 3. Store once

`matches(user_id, posting_id, scorer_version, resume_id, targets_version, role_fit, skills, level, logistics, blockers,
reasons, score, scored_at)`. A score is computed once and reused while `resume_id`, `targets_version` and
`scorer_version` match the user's current ones; it is **never re-rolled on page load**, so the order a person sees is
stable. A posting whose description changed is rescored once.

### 4. Sort (code; this is the whole rule)

1. `score = role_fit + skills + level + logistics` (0–100), computed in code.
2. **Hidden** if any blocker, or score < 50.
3. **Band**: Strong 85–100, Good 70–84, Possible 50–69.
4. Order: band (Strong first) → exact target category or title word before category-only → score → newest posting →
   posting id. Banding first keeps a ±5–7 point wobble inside a band, so it cannot reorder across bands.
5. Onboarding's picks: walk the ordered list and take the first job from each new employer, up to the plan's limit (3 on
the free trial, 10 on Weekly or Monthly).
6. The Matches page: the same order, server-paged with the posting id as the final tie-break, so pages never repeat or
   skip.
7. **Never show ranking points as a match score.** A card with no stored score reads "Scoring…".

### 5. When scoring runs

- **Preferences saved** (onboarding or Profile): score the pool in code-rank order, up to 1,000 jobs, live; the
  onboarding budget is $0.50.
- **Paid users**: new jobs from each 3-hourly pull, up to 50 new jobs per user per day (top by code rank), through the
  Message Batches API. **Free-trial users get no repeating scoring.**
- **A filter change** (a role or place added): score only the newly included jobs; removed jobs drop out.
- **A resume or scorer version change**: rescore, the top 100 by the previous order live and the rest in Batch.
- **A changed description**: rescore that job.

### 6. Cost and gate

About $0.00027 per job scored live and $0.00014 with Batch; 500 jobs at onboarding is about $0.14–0.20 and 50 a day
about $0.007. Before shipping, #686 runs the eval gate on the #685 set by hand (never in CI): repeat-run score
difference average ≤ 5 and maximum ≤ 15; wrong-field jobs in the visible list ≤ 2 %; the owner rates the top three
"would apply" for King Kong and three test people. If Haiku 5.5 misses it, Sonnet 5.5 is measured on the same set and
the numbers are reported before the model changes.

### 7. Implementation notes (2026-11-26)

The score, the store and the sort live in `src/server/matching/`: `prompts/score-v1.ts` (the exact system prompt, the
two worked examples and the JSON schema), `score-schema.ts` (the zod reply), `jobs-pool.ts` (the code pool over
`jobs`/`job_places`), `match-store.ts` (the stored row), `match-sort.ts` (the order and banding), `match-scoring.ts`
(live and Batch runs) and `match-jobs.ts` (the preference-save, fresh-pull, resume-change and description-change
triggers). The candidate resume and targets travel in `LlmRequest.cachePrefix`, a cached block before the per-job text,
so one person's pool shares the cache prefix across every call.

The gate is `scripts/eval-match-scoring.ts`. It refuses to run unless `OVERTURE_MATCH_EVAL=1`, is never imported by CI,
and prints the repeat-run average and maximum, the visible wrong-field rate and the ordered top three for the owner to
rate by hand against the #685 set.

## Consequences

- The Matches page and the Tracker can disagree about a card's band only if the card's `posting_id` or version changed;
  the stored score is the one source.
- A score is a stored row, so a rescore is a deliberate job, not a page visit; the `match.score_bound` alert and the
  old 3 × daily-cap search bound are deleted with ADR 0011's lazy threshold.
- Blockers are the only "never show" rule besides the score floor, so a licence or language mismatch never reaches the
  list even with a high arithmetic score.
- Two scores for the same job and person are one row; `scorer_version` makes a prompt change a migration, not an
  ambiguity.

## Considered Options

- **Sort by raw score.** Rejected: the measured wobble reorders jobs between loads.
- **Cache a page of scores.** Rejected: the same instability, hidden behind a cache that expires.
- **Score in groups of ten.** Rejected: it changed a job's score by 10–12 points on average.
- **Show code rank until AI scores exist.** Rejected: it showed "85" on every pick in the live run.
- **Rank by salary or recency.** Rejected: those are not fit, and the owner's rule is that role and location are the
  only filters and the score is the fit.
