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
  FeedContent,
  FeedPosting,
  UnconditionalFetcher,
} from "./board-feed.ts";

const stringField = z
  .string()
  .nullish()
  .transform((value) => value ?? "");

export const LEVER_DEFAULT_BASE_URL = "https://api.lever.co";

export const LEVER_LIMITS = { maxConcurrent: 4, minIntervalMs: 500 } as const;

const BOARD_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;

const jobSchema = z.object({
  id: z.string(),
  text: stringField,
  hostedUrl: stringField,
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
  const intro = job.descriptionPlain?.trim() ?? htmlToText(job.description ?? null) ?? "";

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
) {
  const limiter = limiterFor("lever", LEVER_LIMITS);

  const assertToken = (boardToken: string) => {
    if (!BOARD_TOKEN_RE.test(boardToken)) {
      throw new FeedError(400, `${baseUrl}/v0/postings/${boardToken}`);
    }
  };

  const fetchBoard = async (boardToken: string, condition: BoardCondition) => {
    assertToken(boardToken);
    void condition;

    const url = `${baseUrl}/v0/postings/${boardToken}?mode=json`;
    const response = await limiter.run(async () => fetcher(url));

    if (response.status === 404) {
      return { status: "gone" } as const;
    }

    const parsed = listSchema.parse(response.json);

    const postings: FeedPosting[] = parsed
      .filter((job) => job.hostedUrl !== "")
      .map((job) => {
        const content: FeedContent = {
          descriptionText: descriptionText(job),
          department: job.categories?.department?.trim() || null,
          locationRaw: null,
        };

        return {
          atsJobId: job.id,
          title: job.text,
          url: job.hostedUrl,
          locationRaw: joinDistinctLocations([
            job.categories?.location ?? null,
            ...(job.categories?.allLocations ?? []),
          ]),
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
      bodyHash: contentHash(JSON.stringify(response.json)),
    } as const;
  };

  return { fetchBoard } satisfies BoardFeed;
}
