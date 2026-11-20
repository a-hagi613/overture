import { z } from "zod";

import { contentHash } from "./content-hash.ts";
import {
  isoFromTimestamp,
  joinDistinctLocations,
  FeedError,
  UNCONDITIONAL_FETCHER,
} from "./board-feed.ts";
import { htmlToText } from "./html-to-text.ts";
import { limiterFor } from "./rate-limiter.ts";

import type {
  BoardCondition,
  BoardFeed,
  BoardRegion,
  FeedContent,
  FeedPosting,
  UnconditionalFetcher,
} from "./board-feed.ts";

const stringField = z
  .string()
  .nullish()
  .transform((value) => value ?? "");

export const LEVER_DEFAULT_BASE_URL = "https://api.lever.co";

export const LEVER_EU_DEFAULT_BASE_URL = "https://api.eu.lever.co";

export const LEVER_LIMITS = { maxConcurrent: 4, minIntervalMs: 500 } as const;

export const LEVER_PAGE_SIZE = 100;

const BOARD_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

const jobSchema = z.object({
  id: z.string(),
  text: stringField,
  hostedUrl: stringField,
  applyUrl: stringField,
  workplaceType: z.string().nullish(),
  createdAt: z.union([z.number(), z.string()]).nullish(),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string().nullish()).nullish(),
      department: z.string().nullish(),
      team: z.string().nullish(),
    })
    .nullish(),
  description: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
  additionalPlain: z.string().nullish(),
});

const listSchema = z.array(jobSchema);

function descriptionText(job: z.infer<typeof jobSchema>) {
  const intro = job.descriptionPlain?.trim() || htmlToText(job.description ?? null) || "";

  const lists = (job.lists ?? []).map((list) =>
    [list.text?.trim() ?? "", htmlToText(list.content ?? null) ?? ""]
      .filter((part) => part !== "")
      .join("\n"),
  );

  return [intro, ...lists, job.additionalPlain?.trim() ?? ""]
    .filter((part) => part !== "")
    .join("\n\n");
}

export function createLeverFeed(
  baseUrl: string = LEVER_DEFAULT_BASE_URL,
  fetcher: UnconditionalFetcher = UNCONDITIONAL_FETCHER,
  euBaseUrl: string = LEVER_EU_DEFAULT_BASE_URL,
) {
  const limiter = limiterFor("lever", LEVER_LIMITS);

  const assertToken = (boardToken: string, region: BoardRegion) => {
    if (!BOARD_TOKEN_RE.test(boardToken)) {
      throw new FeedError(400, `${baseUrlFor(region)}/v0/postings/${boardToken}`);
    }
  };

  const baseUrlFor = (region: BoardRegion) => (region === "eu" ? euBaseUrl : baseUrl);

  const fetchPage = async (boardToken: string, region: BoardRegion, skip: number) => {
    const url = `${baseUrlFor(region)}/v0/postings/${boardToken}?mode=json&limit=${String(LEVER_PAGE_SIZE)}&skip=${String(skip)}`;

    return limiter.run(async () => fetcher(url));
  };

  const fetchBoard = async (boardToken: string, condition: BoardCondition, region: BoardRegion) => {
    assertToken(boardToken, region);
    void condition;

    const pages: z.infer<typeof listSchema>[] = [];

    const fetchFrom: (skip: number) => Promise<"gone" | null> = async (skip) => {
      const response = await fetchPage(boardToken, region, skip);

      if (response.status === 404) {
        return "gone";
      }

      const page = listSchema.parse(response.json);

      pages.push(page);

      return page.length < LEVER_PAGE_SIZE ? null : fetchFrom(skip + LEVER_PAGE_SIZE);
    };

    if ((await fetchFrom(0)) === "gone") {
      return { status: "gone" } as const;
    }

    const parsed = pages.flat();

    const postings: FeedPosting[] = parsed
      .filter((job) => job.hostedUrl !== "")
      .map((job) => {
        const content: FeedContent = {
          descriptionText: descriptionText(job),
          department: job.categories?.department?.trim() || null,
          locationRaw: null,
          salary: null,
        };

        return {
          atsJobId: job.id,
          title: job.text,
          url: job.hostedUrl,
          applyUrl: job.applyUrl === "" ? null : job.applyUrl,
          locationRaw: joinDistinctLocations([
            job.categories?.location ?? null,
            ...(job.categories?.allLocations ?? []),
          ]),
          workplaceType: job.workplaceType ?? null,
          language: null,
          postedAt: isoFromTimestamp(job.createdAt),
          sourceUpdatedAt: null,
          descriptionPending: false,
          content,
        };
      });

    return {
      status: "ok",
      postings,
      etag: null,
      bodyHash: contentHash(JSON.stringify(pages)),
    } as const;
  };

  return { fetchBoard } satisfies BoardFeed;
}
