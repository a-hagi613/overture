# Tag rule share over a recorded posting sample

Recorded from real Greenhouse, Lever and Ashby boards by `scripts/pull-tagging-sample.ts`; classified with `tagPosting` in `src/server/catalog/tag-rules.ts`. Phase 1 of issue #17; run `bun run scripts/tag-rule-share.ts` to refresh.

| Dimension | Classified | Share | Notes |
|---|---|---|---|
| role by keyword rules | 557 | 78.6 % |  |
| role by O*NET title similarity | 2 | 0.3 % | threshold 0.85 |
| role unclassified | 150 | 21.2 % | goes to the LLM batch in the full pipeline |
| seniority | 204 | 28.8 % |  |
| workplace (non-unknown) | 294 | 41.5 % |  |
| employment type (non-unknown) | 263 | 37.1 % |  |
| location to city | 300 | 42.3 % | 301 resolved to country only |
| salary from structured fields | 9 | 1.3 % |  |
| salary from pay-range patterns | 182 | 25.7 % |  |
| salary not found | 518 | 73.1 % |  |
| language from the source field | 469 | 66.1 % |  |
| language detected by trigrams | 0 | 0.0 % | non-English postings |
| language defaulted to English | 703 | 99.2 % |  |

Per ATS:

| ashby | 152 | 21.4 % |  |
| greenhouse | 469 | 66.1 % |  |
| lever | 88 | 12.4 % |  |

Top roles:

| Sales | 174 | 24.5 % |  |
| unclassified | 150 | 21.2 % |  |
| Software Engineering | 72 | 10.2 % |  |
| Business Development & Partnerships | 40 | 5.6 % |  |
| Legal | 36 | 5.1 % |  |
| Machine Learning & AI | 34 | 4.8 % |  |
| Marketing | 32 | 4.5 % |  |
| Design | 24 | 3.4 % |  |
| Data & Analytics | 21 | 3.0 % |  |
| Security | 18 | 2.5 % |  |
| Customer Success | 14 | 2.0 % |  |
| Finance | 13 | 1.8 % |  |
