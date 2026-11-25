---
status: accepted
---

# Role labels from one AI pass, matching on taxonomy ids, and a scorer that reads the job

Issue #660 replaces the 28 tech-leaning role groups and the word-overlap role match with the 29-category role
taxonomy (`src/shared/role-taxonomy.ts`, #661). This records how Postings get their role, how a person's targets meet
it, and what the scorer reads, and the measurements that chose each part.

## Context

About 4.5% of the catalog passed the old match filters, and the role match was a word overlap (`Backend` matched any
tag with that word), so reach was low and wrong matches were common. The owner's rules: category and location are hard
filters; seniority, salary and remote only rank (seniority blocks at three or more levels apart); remote-only people
never see unknown-workplace jobs; a false positive is worse than a miss; no AI spend in production until a backfill
has template dedupe and a hard dollar cap; no hand-written rules for the 272 roles.

We measured candidate designs offline on 12 test people (nurse, backend engineer, retail, customer service, accountant,
truck driver, teaching assistant, marketing manager, data engineer, caregiver, electrician, account executive) against
hand-graded jobs drawn from one week of the Stapply feed (about 150,000 dated jobs, 105,000 distinct title templates):

| Layer | Right jobs kept | Wrong among passed |
|---|---|---|
| AI role labels (Claude Haiku, 272 roles), high and medium confidence | 85% | 2.6% |
| Category gate from those labels | drops 4% of right jobs | removes 84% of wrong ones |
| Scorer as shipped (no description, no targets), score ≥ 60 | — | 10.4% |
| Scorer with the description and the targets, score ≥ 60 | — | 5.9% |
| Labels, then the improved scorer, score ≥ 60 | — | 2.1% |
| multilingual-e5-small embeddings, title + keyword hybrid | R-precision 78% | weaker than labels |

Most jobs the improved scorer rejected were right rejections for the person (a required language, a level gap, a
different stack), not label errors. Labelling the week cost $6.59 with the Batch API.

## Decision

- **Labels.** One Haiku pass labels each title template (title + department, `classificationKey`) with a role id, a
  confidence and a seniority, committed as `src/server/catalog/tag-data/role-labels.json` (version `roles-272-v1`).
  The daily build reads the seed, so labelling costs nothing per run. High and medium confidence write category,
  subcategory and role ids; low confidence writes only the category, so a shaky label never claims an exact role;
  `JUNK` (talent pools, open applications, tests) clears the role. The pass read one sample job's description per
  template, so a common title sometimes took the sample's role (`Software Engineer` labelled Data Engineer, `Project
  Manager` labelled Product Manager). A title that names one exact taxonomy role (its name, with level words such as
  `Senior`, `Sr`, `Lead` or `II` set aside) therefore takes that role, unless the label names another role in the same
  subcategory, which is a refinement (`Senior Software Engineer` labelled Backend Engineer keeps the label). On the
  week this rule names 2,751 templates; 2,136 agree with the label and 1,152 jobs (0.8%) change, mostly to the right
  role. A Posting carries one role: of its retired tags the heaviest is read first. A title with no label goes through
  the retired-tag bridge, which keeps only what the old tags say safely and keeps the source that wrote them. An
  operator's tag import outranks the label, as it outranks every source in `TAG_SOURCE_PRECEDENCE`: its tags are
  bridged as `import` and its seniority stays. `taxonomy-tags.ts` is the one rewrite every writer ends in (the daily
  build, the tag store behind the board poll and imports, the test routes), so a title the rules could not place still
  gets its label before the paid fallback sees it, and a second pass changes nothing.
- **Matching.** A saved target is read as taxonomy ids: an id, a current name, a retired category or ESCO name, or one
  clear part of a combined name (`Nurse Practitioner` of `Nurse Practitioner / Anesthetist / Midwife`). A role target
  matches only that role; a neighbour in the same subcategory is not admitted, because it often needs another licence
  or level, and that widening was never measured. A subcategory or category target reaches every role inside it. Other
  text is free text and matches a title holding every one of its words. Role depth ranks: exact role 40, subcategory
  30, free text 30, category 20.
- **Scorer.** The Haiku scorer now reads the first 200 words of the description (the build stores 2,000 characters
  of plain text) and a `targets:` line (role names, levels, places, workplaces, pay floor), in the format measured
  above. The auto threshold stays 60.
- **Counts and search.** `/api/supply` and catalog search read a role filter the same way (ids, names or retired
  names). They also accept the value as given, so a catalog built before this change still answers while it is
  rebuilt. Role conditions read `posting_tags` through one indexed lookup per tag clause, joined by `union` (on
  150,000 Postings a live count fell from about 420 ms to 1–26 ms, a role-target pool from 100–260 ms to 1–2 ms).
- **Window.** The daily build keeps jobs posted in the last 7 days (`freshness_days`); undated jobs (Manatal, Personio,
  Pinpoint, ClearCompany feeds carry no `posted_at`) are left out unless `include_undated` is set, because their
  freshness cannot be shown and most of their titles have no label yet.
- **Spend.** The classifier's Haiku tier runs only when the repository variable `CATALOG_LLM_MAX_ITEMS` is a positive
  cap and `ANTHROPIC_API_KEY` is set; both are unset by default, so no daily AI spend happens until the owner opts in.

## Consequences

- New titles that appear after the seed was built get bridged tags until the next labelling pass; the seed is
  regenerated by rerunning the labelling scripts and committing the new file under a new version.
- Production publishes through the relay, which never downloads the last catalog, so every daily build starts empty:
  the 7-day window rolls forward and every row carries its description. If the build moves to R2 delta runs, the
  window applies only to the first run and the description only to new or changed rows (it is not in
  `content_hash`), so that move needs a rebuild path first.
- The seed is about 100,000 labels and takes about 60 MB at its peak to read. A process reads it once; the off-box
  Workable pass reads it with its targets, before it measures the feed's memory, so its budget still measures the
  streaming parse (ADR 0032).
- Embeddings are not used. They stay a candidate for ranking inside a role, not for filtering.
- The pickers (onboarding, profile targets, the landing count) offer the 29 categories and each category's specific
  roles from `role-taxonomy.ts` and save role names, which resolve to exactly that role. A catch-all role (`Other
  Health Practitioner`) is never offered; it is reached by choosing its category. Targets saved before the move keep
  their retired names, which still resolve to taxonomy ids, coarser than a direct choice (`Software Engineering`
  reaches all of Software & IT).
