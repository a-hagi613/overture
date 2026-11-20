# Tag rule share over a recorded posting sample

Recorded from real Greenhouse, Lever and Ashby boards by `scripts/pull-tagging-sample.ts`; classified with `tagPosting` in `src/server/catalog/tag-rules.ts`. Phase 1 of issue #17; run `bun run scripts/tag-rule-share.ts` to refresh.

| Dimension | Classified | Share | Notes |
|---|---|---|---|
| role by keyword rules | 576 | 81.2 % |  |
| role by O*NET title similarity | 2 | 0.3 % | threshold 0.85 |
| role unclassified | 131 | 18.5 % | goes to the LLM batch in the full pipeline |
| seniority tagged | 257 | 36.2 % |  |
| seniority not in the title | 452 | 63.8 % |  |
| workplace from field, flag or text | 396 | 55.9 % |  |
| workplace unclassified | 313 | 44.1 % |  |
| employment type | 312 | 44.0 % |  |
| employment type not stated | 397 | 56.0 % |  |
| location to city | 294 | 41.5 % | 307 resolved to country only |
| salary from structured fields | 9 | 1.3 % |  |
| salary from pay-range patterns | 182 | 25.7 % |  |
| salary not found | 518 | 73.1 % |  |
| language from the source field | 469 | 66.1 % |  |
| language detected by trigrams | 0 | 0.0 % | non-English postings |
| language defaulted to English | 240 | 33.9 % |  |

Per ATS:

| Source | Postings | Share | Notes |
|---|---|---|---|
| ashby | 152 | 21.4 % |  |
| greenhouse | 469 | 66.1 % |  |
| lever | 88 | 12.4 % |  |

Top roles:

| Role | Postings | Share | Notes |
|---|---|---|---|
| Sales | 174 | 24.5 % |  |
| unclassified | 131 | 18.5 % |  |
| Software Engineering | 91 | 12.8 % |  |
| Business Development & Partnerships | 40 | 5.6 % |  |
| Legal | 36 | 5.1 % |  |
| Machine Learning & AI | 34 | 4.8 % |  |
| Marketing | 32 | 4.5 % |  |
| Design | 24 | 3.4 % |  |
| Data & Analytics | 21 | 3.0 % |  |
| Security | 18 | 2.5 % |  |
| Customer Success | 14 | 2.0 % |  |
| Finance | 13 | 1.8 % |  |
