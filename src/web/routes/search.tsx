import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { z } from "zod";

import { copy } from "../../shared/copy.ts";

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

async function fetchSearch(q: string) {
  const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=50`);

  if (!response.ok) {
    throw new Error(`search failed: ${String(response.status)}`);
  }

  return searchResponseSchema.parse(await response.json());
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const trimmed = query.trim();
  const enableQuery = trimmed.length > 0;

  const { data, isPending } = useQuery({
    queryKey: ["search", trimmed],
    queryFn: async () => fetchSearch(trimmed),
    enabled: enableQuery,
  });

  return (
    <main>
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
            const value = parsed.data.trim();

            setSearchParams(value.length === 0 ? {} : { q: value });
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
          className="h-10 shrink-0 rounded-[6px] bg-foreground px-4 text-sm font-medium text-card"
        >
          {copy.search.submit}
        </button>
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
    </main>
  );
}
