# Filter proof on a recorded freehire pull (issue #685)

Generated 2026-11-26 by `bun run scripts/filter-proof.ts`. The input is a recorded freehire
pull committed at `src/server/jobs/fixtures/filter-proof/freehire-pull-2026-11-26.json.gz` (28 sendable
sources, open jobs only, descriptions trimmed to 4,000 characters). No test, CI job or scheduled job calls
freehire or any other paid service.

- recorded jobs: **8083**
- jobs stored by the production store: **8021** (deduplicated by employer, title and places)
- non-job titles the store kept for audit but every pool hides: **19**
- detected posting languages: en 6439, fr 853, de 386, nl 159, ja 120, undetected 37, es 20, ar 4, it 1, zh 1, ru 1
- people measured: **16** (12 graded fields, King Kong, 3 walk users)
- overall wrong-field rate: **0.0 %** (0 of 1047 pooled rows; target ≤ 3 %)
- acceptance: wrong-field ≤ 3 % — **pass**

Wrong-field means the pooled row is outside the person's field: its freehire category is not in the field and
its title does not name the field. It is graded independently of the filter's own category and title-word
choices. Missed-right means a job that is in the field, in the person's places, in a language they read and is
a real job, but the production matching pool did not return it.

| Person | Group | Pool | Wrong field | Wrong-field rate | Wrong place | Right jobs | Missed right | Missed-right rate | Title-only matches | Title-only, no category | Title-only, other |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Nurse | graded | 31 | 0 | 0.0 % | 0 | 31 | 0 | 0.0 % | 0 | 0 | 0 |
| Backend engineer | graded | 108 | 0 | 0.0 % | 0 | 108 | 0 | 0.0 % | 12 | 0 | 2 |
| Retail | graded | 11 | 0 | 0.0 % | 0 | 11 | 0 | 0.0 % | 0 | 0 | 0 |
| Customer service | graded | 15 | 0 | 0.0 % | 0 | 17 | 2 | 11.8 % | 0 | 0 | 0 |
| Accountant | graded | 18 | 0 | 0.0 % | 0 | 20 | 2 | 10.0 % | 0 | 0 | 0 |
| Truck driver | graded | 134 | 0 | 0.0 % | 0 | 146 | 12 | 8.2 % | 0 | 0 | 0 |
| Teaching assistant | graded | 27 | 0 | 0.0 % | 0 | 27 | 0 | 0.0 % | 0 | 0 | 0 |
| Marketing manager | graded | 24 | 0 | 0.0 % | 0 | 24 | 0 | 0.0 % | 1 | 0 | 0 |
| Data engineer | graded | 58 | 0 | 0.0 % | 0 | 59 | 1 | 1.7 % | 0 | 0 | 0 |
| Caregiver | graded | 61 | 0 | 0.0 % | 0 | 61 | 0 | 0.0 % | 0 | 0 | 0 |
| Electrician | graded | 148 | 0 | 0.0 % | 0 | 148 | 0 | 0.0 % | 5 | 0 | 1 |
| Account executive | graded | 19 | 0 | 0.0 % | 0 | 20 | 1 | 5.0 % | 1 | 0 | 0 |
| King Kong | owner | 106 | 0 | 0.0 % | 0 | 106 | 0 | 0.0 % | 34 | 0 | 2 |
| Maya Chen | walk | 69 | 0 | 0.0 % | 0 | 70 | 1 | 1.4 % | 7 | 0 | 1 |
| Amina Yusuf | walk | 186 | 0 | 0.0 % | 0 | 186 | 0 | 0.0 % | 3 | 0 | 3 |
| Daniel Okafor | walk | 32 | 0 | 0.0 % | 0 | 44 | 12 | 27.3 % | 10 | 0 | 7 |

- Title-only matches with no freehire category: **0**;
  with freehire's fallback category `other`: **16**.

## What the numbers show

- The wrong-field rate is the share of the pooled rows that the independent field grade rejects.
- A title-only match is a pooled row whose freehire category was not among the person's picked categories, so
  only a picked title word let it in. `no category` is the subset where freehire sent no category at all; in
  this pull freehire sent `other` rather than null, so the null count is near zero and `other` is the real
  bucket to read.
- Missed-right is the recall cost of the code filter. The AI never sees these jobs; if the number is high for a
  field, that field's title words or categories need widening.

### Method

- The pull was recorded once on 2026-11-26 with the 28 freehire sources Overture can send to, open jobs only,
  sort `created_at` descending, and descriptions trimmed to 4,000 characters. It contains no live request.
- Every row is written through the production store (so dedupe, category, place facets and language detection
  are the runtime code) and read through the production matching pool (`matching/jobs-pool.ts`, the code the
  scorer and Matches page use) with each persona's categories, title words, place ids and spoken languages.
- Grading is independent on the title side: a row is in the person's field when its freehire category is one
  they picked or its title matches the field's role titles. The filter's own title words are never used to
  grade a pool.
- A right job must be in the person's places, in a language they read, and not a talent pool, open
  application or test row. Non-English rows are therefore not counted as missed for an English-only person.

### Limits

- freehire filled `enrichment.category` on every recorded row, so the `category: null` column is 0; freehire's
  fallback `other` is the meaningful bucket for a title-only match. The pool and its unit tests cover the
  null case even though this pull did not contain one.
- Language detection needs 200 Latin characters for a Latin language, so a short non-English row can stay
  `undetected` and pass; that is deliberate, because a wrong guess is worse than showing the row to the AI.
- The place proof is the exact place-id intersection from #683; a remote country matches only a posting
  freehire marks remote. The wrong-place column is therefore an end-to-end check, not a separate metric.

## How to re-run

```sh
bun run scripts/filter-proof.ts
```

The command reads the committed pull, runs the production store and matching pool in an in-memory database, prints the
table above and rewrites this file. It makes no network request.
