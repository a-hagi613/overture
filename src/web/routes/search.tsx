import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { z } from "zod";

import { copy } from "../../shared/copy.ts";
import {
  EMPLOYMENT_TYPES,
  ROLE_GROUPS,
  SENIORITIES,
  WORKPLACES,
} from "../../shared/tag-taxonomy.ts";

const searchResponseSchema = z.object({
  hits: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      company: z.string(),
      location: z.string().nullable(),
      department: z.string().nullable(),
      url: z.string(),
      ats: z.string(),
      postedAt: z.number().nullable(),
    }),
  ),
  durationMs: z.number(),
});

const filterSelectClass =
  "h-10 rounded-[6px] border border-input bg-card px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-foreground";

interface SearchFilterValues {
  q: string;
  role: string;
  seniority: string;
  workplace: string;
  location: string;
  employmentType: string;
}

async function fetchSearch(values: SearchFilterValues) {
  const query = new URLSearchParams({ q: values.q, limit: "50" });

  if (values.role !== "") {
    query.set("role", values.role);
  }

  if (values.seniority !== "") {
    query.set("seniority", values.seniority);
  }

  if (values.workplace !== "") {
    query.set("workplace", values.workplace);
  }

  if (values.location !== "") {
    query.set("location", values.location);
  }

  if (values.employmentType !== "") {
    query.set("employmentType", values.employmentType);
  }

  const response = await fetch(`/api/search?${query.toString()}`);

  if (!response.ok) {
    throw new Error(`search failed: ${String(response.status)}`);
  }

  return searchResponseSchema.parse(await response.json());
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const trimmed = query.trim();
  const role = searchParams.get("role") ?? "";
  const seniority = searchParams.get("seniority") ?? "";
  const workplace = searchParams.get("workplace") ?? "";
  const location = searchParams.get("location") ?? "";
  const employmentType = searchParams.get("employmentType") ?? "";
  const enableQuery = trimmed.length > 0;

  const values = { q: trimmed, role, seniority, workplace, location, employmentType };

  const { data, isPending } = useQuery({
    queryKey: ["search", trimmed, role, seniority, workplace, location, employmentType],
    queryFn: async () => fetchSearch(values),
    enabled: enableQuery,
  });

  function updateParam(key: string, value: string) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);

      if (value === "") {
        next.delete(key);
      } else {
        next.set(key, value);
      }

      return next;
    });
  }

  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {copy.search.eyebrow}
      </p>
      <h1 className="mt-2 font-display text-[32px] leading-[1.05] tracking-tight md:text-[42px]">
        {copy.search.title}
      </h1>
      <form
        className="mt-6 flex max-w-[560px] gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = z.string().safeParse(new FormData(event.currentTarget).get("q"));

          if (parsed.success) {
            updateParam("q", parsed.data.trim());
          }
        }}
      >
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder={copy.search.placeholder}
          aria-label={copy.search.placeholder}
          className="h-10 w-full rounded-[6px] border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-foreground"
        />
        <button
          type="submit"
          className="h-10 shrink-0 rounded-[6px] bg-foreground px-4 text-sm font-medium text-card hover:opacity-90"
        >
          {copy.search.submit}
        </button>
      </form>
      <form
        aria-label={copy.search.filters.heading}
        className="mt-3 flex max-w-[560px] flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = z.string().safeParse(new FormData(event.currentTarget).get("location"));

          if (parsed.success) {
            updateParam("location", parsed.data.trim());
          }
        }}
      >
        <select
          aria-label={copy.search.filters.role}
          value={role}
          className={filterSelectClass}
          onChange={(event) => updateParam("role", event.currentTarget.value)}
        >
          <option value="">{copy.search.filters.allRoles}</option>
          {ROLE_GROUPS.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </select>
        <select
          aria-label={copy.search.filters.seniority}
          value={seniority}
          className={filterSelectClass}
          onChange={(event) => updateParam("seniority", event.currentTarget.value)}
        >
          <option value="">{copy.search.filters.allSeniorities}</option>
          {SENIORITIES.map((level) => (
            <option key={level} value={level}>
              {copy.search.filters.seniorities[level]}
            </option>
          ))}
        </select>
        <select
          aria-label={copy.search.filters.workplace}
          value={workplace}
          className={filterSelectClass}
          onChange={(event) => updateParam("workplace", event.currentTarget.value)}
        >
          <option value="">{copy.search.filters.allWorkplaces}</option>
          {WORKPLACES.map((mode) => (
            <option key={mode} value={mode}>
              {copy.search.filters.workplaces[mode]}
            </option>
          ))}
        </select>
        <input
          type="search"
          name="location"
          defaultValue={location}
          placeholder={copy.search.filters.allLocations}
          aria-label={copy.search.filters.location}
          className="h-10 w-40 rounded-[6px] border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-foreground"
        />
        <select
          aria-label={copy.search.filters.employmentType}
          value={employmentType}
          className={filterSelectClass}
          onChange={(event) => updateParam("employmentType", event.currentTarget.value)}
        >
          <option value="">{copy.search.filters.allEmploymentTypes}</option>
          {EMPLOYMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {copy.search.filters.employmentTypes[type]}
            </option>
          ))}
        </select>
      </form>
      <section aria-label={copy.search.resultsHeading} className="mt-8">
        <h2 className="font-display text-[22px] leading-[1.15] md:text-[26px]">
          {copy.search.resultsHeading}
        </h2>
        {data === undefined && isPending && enableQuery ? (
          <p className="mt-4 text-sm text-muted-foreground">{copy.search.pending}</p>
        ) : null}
        {data !== undefined && data.hits.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{copy.search.empty}</p>
        ) : null}
        <ul className="mt-4 flex flex-col gap-3">
          {(data?.hits ?? []).map((hit) => (
            <li key={hit.id} className="rounded-[12px] border border-border bg-card p-4">
              <a
                href={hit.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline"
              >
                {hit.title}
              </a>
              <p className="mt-1 text-sm text-muted-foreground">
                {hit.company}
                {hit.location === null ? "" : ` · ${hit.location}`}
                {hit.department === null ? "" : ` · ${hit.department}`}
              </p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {`${copy.search.via} ${hit.ats}`}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
