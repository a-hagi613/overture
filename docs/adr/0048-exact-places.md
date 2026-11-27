---
status: accepted
---

# Exact places: one place id on both sides of a location match

Implements issue #683 under the owner's 2026-11-26 direction (issue #678, SPEC §6.4). It supersedes the free-text
location parsing that fed both the retired catalog and the first freehire pull. Roles and places are the only hard
filters (ADR 0045).

## Decision

1. **One scheme, in `src/shared/places.ts`.** A place id is a physical place from freehire's own lists or an explicit
   remote scope:
   - `country:<iso2>` (`country:ca`), `region:<slug>` (`region:north_america`), `metro:<slug>` (`metro:toronto`),
     `city:<iso2>:<slug>` (`city:ca:toronto`).
   - `remote:country:<iso2>`, `remote:continent:<code>` (AF, AN, AS, EU, NA, OC, SA) and `remote:worldwide`.
   The id is validated by shape, so a target can never store free text. A slug folds case, accents and punctuation to
   one hyphen (`New York City` → `new-york-city`); a region slug keeps freehire's underscores.
2. **A city id is country plus name, not state plus name.** freehire sends city names without a state, so a job cannot
   be more precise than the country. Same-name cities inside one country therefore share an id (Springfield, Missouri
   and Springfield, Massachusetts are both `city:us:springfield`); the picker still shows "Springfield, Missouri,
   United States" and "Springfield, Massachusetts, United States" as two labelled rows. A name shared across countries
   is a different id and needs a qualifier or a dominant city.
3. **A job's places come from its freehire record** (`src/server/places/job-places.ts`). Countries, regions, metros and
   cities become physical ids. A remote posting also carries `remote:country:<code>` for each listed country,
   `remote:continent:<code>` from those countries and regions, and `remote:worldwide`. A posting freehire gives no
   country to carries only `remote:worldwide` when it is remote and no ids at all otherwise, so it cannot match a
   country-scoped user (SPEC §6.4). A posting with a work mode other than `remote`, or none, carries physical ids only.
   A city value that is really a country name ("Canada" in freehire's city facet) never becomes a city id.
4. **Matching is an id intersection** (`src/server/jobs/reader.ts`). The reader returns open jobs whose `job_places`
   rows intersect the user's saved ids. There is no fuzzy geo resolution on this path, so a `Remote · Canada` user
   cannot see a `Remote US only` job, and a posting with no work mode matches only the city or country it lists.
5. **The pull is widened, the match is exact.** Saved ids become freehire facets (`placeSearchFacets`): a country or
   remote country sends its country, a region or remote continent sends its freehire region slug, a city sends its city
   *and* its country, and `remote:worldwide` sends no geography. The wider pull keeps a spelling freehire does not know
   from hiding a country's jobs; the id intersection then drops everything outside the saved places.
6. **Free-text resolution is deterministic and refuses to guess.** `resolvePlaceText` handles remote strings first
   (`Remote Poland`, `Remote US only`, `US: Washington Remote Worker`, `Remote LATAM`, `Remote - Europe`), then physical
   places. An exact city name beats an alternate spelling ("Frisco" is Frisco, Texas, never San Francisco under its old
   nickname), an exact-name city below 10,000 people yields to an unambiguous region's country, and a name shared by
   several countries is resolved only when one city is at least five times the next one and above 100,000 people.
   Otherwise the value stays unresolved. The 340-string acceptance fixture
   (`src/server/places/fixtures/location-strings.json`) covers Frisco, same-name cities, remote phrases, German and
   Swedish spellings and freehire's own values at 100% exact.
7. **The picker only commits suggestions** (`src/web/components/ui/place-picker.tsx`). A 200 ms debounce and an
   `AbortController` cancel a stale request; ArrowUp/ArrowDown/Enter/Escape and the combobox/listbox roles come from
   cmdk. Every row shows its region and country, and the remote scopes are rows of their own. Only `onSelect` calls the
   target with a `{id,label,meta,kind}` suggestion.
8. **Migration of saved targets.** Drizzle migration `0070_exact_places` adds `targets.unresolved_locations` as an
   additive change; the old raw values stay in `locations` until a boot backfill (`promoteStoredTargetPlaces`)
   resolves every unambiguous value with the same function the picker and the pull use, writes the ids to `locations`,
   and leaves only genuinely ambiguous values in `unresolved_locations` for the person to pick or dismiss on Profile.
   The migration never moves user data and the backfill is idempotent, so a failed boot loses nothing and a second
   boot writes nothing. `job_places` is rebuilt because its key changes; it is a cache derived from the `jobs`
   columns, so a boot pass (`rebuildStoredJobPlaces`) refills it for every stored job without a pull, and the store
   replaces a job's places on every upsert.
9. **The retired readers keep working for one wave.** Because the old catalog still serves Home, Matches, onboarding
   counts and the Workable ingest until #706, those readers receive readable text (`locationTextsOfPlaceIds`) instead
   of ids. Remote scopes lose their remote prefix on that path, which the configuration's `workplace` flag already
   expressed. The freehire path is the one that matches on ids.

## Consequences

- A saved target and a pulled job now compare the same strings; the only way a location match can be wrong is a wrong
  pick, and the picker shows region and country on every city so the person can see it.
- A freehire city spelling the dataset does not know still matches through the country facet, but only the same
  country's jobs. A region freehire does not publish can never be matched, because neither side can name it.
- "Remote · Worldwide" matches every remote posting, including country-scoped ones; a country-scoped remote user
  matches only their country and its continent. This is what the SPEC's "a job with no country matches only Remote ·
  Worldwide" requires and it keeps a worldwide user from silently excluding most remote work.
- The acceptance fixture is a unit test, not a live check: no test calls freehire or spends credits (ADR 0013).
- `docs/SPEC.md` is synced at wave end (#707); this ADR records the shape the code implements now.

## Considered Options

- **Keep free-text locations and resolve at match time.** Rejected: two users typing the same city could get different
  answers, and the "Frisco → San Francisco" bug came from exactly that.
- **Store state in the city id.** Rejected: freehire does not send a state with its cities, so the extra precision
  would make a job unmatchable.
- **Let free text become a pill.** Rejected by the issue: only a picked suggestion may be saved.
- **Resolve ambiguous names automatically.** Rejected: a wrong country is worse than a question.
- **Resolve saved values in SQL.** Rejected: the geo catalog lives in code and is 220k cities; duplicating it in a
  migration would drift from the picker immediately.
