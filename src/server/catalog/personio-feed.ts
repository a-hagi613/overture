import { XML } from "bun";
import { z } from "zod";

import { contentHash } from "./content-hash.ts";
import { isoFromTimestamp, joinDistinctLocations, FeedError } from "./board-feed.ts";
import { htmlToText } from "./html-to-text.ts";
import { limiterFor } from "./rate-limiter.ts";

import type { BoardCondition, BoardFeed, BoardRegion, FeedPosting } from "./board-feed.ts";

export const PERSONIO_DEFAULT_BASE_URL = "https://{token}.jobs.personio.de";

export const PERSONIO_LIMITS = { maxConcurrent: 2, minIntervalMs: 1000 } as const;

const BOARD_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9-]*$/u;

const JOB_PAGE_PATH = "/job";

const GONE_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308, 404]);

const EMPLOYMENT_TYPE_BY_SCHEDULE = new Map<string, string>([
  ["full-time", "full_time"],
  ["part-time", "part_time"],
  ["internship", "internship"],
  ["temporary", "temporary"],
]);

const jobDescriptionSchema = z.object({
  name: z.string().nullish(),
  value: z.string().nullish(),
});

const jobDescriptionsSchema = z
  .object({
    jobDescription: z.union([jobDescriptionSchema, z.array(jobDescriptionSchema)]).nullish(),
  })
  .nullish();

const additionalOfficesSchema = z
  .object({
    office: z.union([z.string(), z.array(z.string())]).nullish(),
  })
  .nullish();

const positionSchema = z.object({
  id: z.coerce.string(),
  office: z.string().nullish(),
  additionalOffices: z.unknown().nullish(),
  department: z.string().nullish(),
  name: z.string().nullish(),
  jobDescriptions: z.unknown().nullish(),
  schedule: z.string().nullish(),
  createdAt: z.string().nullish(),
});

const positionsSchema = z.union([positionSchema, z.array(positionSchema)]);

const rootSchema = z.object({ position: positionsSchema.optional() });

const documentSchema = z.object({ "workzag-jobs": z.unknown() });

type PersonioPosition = z.infer<typeof positionSchema>;

export interface PersonioResponse {
  status: number;
  text: string;
}

export type PersonioFetcher = (url: string) => Promise<PersonioResponse>;

export const PERSONIO_FETCHER: PersonioFetcher = async (url) => {
  const response = await fetch(url, { redirect: "manual" });

  return { status: response.status, text: await response.text() };
};

function assertToken(boardToken: string, origin: string) {
  if (!BOARD_TOKEN_RE.test(boardToken)) {
    throw new FeedError(400, origin);
  }
}

function positionsFromXml(text: string) {
  const document = documentSchema.safeParse(XML.parse(text));

  if (!document.success) {
    return [];
  }

  const root = rootSchema.safeParse(document.data["workzag-jobs"]);

  if (!root.success || root.data.position === undefined) {
    return [];
  }

  return Array.isArray(root.data.position) ? root.data.position : [root.data.position];
}

function descriptionText(position: PersonioPosition) {
  const descriptions = jobDescriptionsSchema.safeParse(position.jobDescriptions);

  if (!descriptions.success) {
    return null;
  }

  const entries = descriptions.data?.jobDescription;

  if (entries === null || entries === undefined) {
    return null;
  }

  const list = Array.isArray(entries) ? entries : [entries];

  const parts = list.flatMap((entry) => {
    const heading = entry.name?.trim() ?? "";
    const body = htmlToText(entry.value ?? null) ?? "";
    const part = `${heading}\n${body}`.trim();

    return part === "" ? [] : [part];
  });

  const text = parts.join("\n\n").trim();

  return text === "" ? null : text;
}

function officesOf(position: PersonioPosition) {
  const additional = additionalOfficesSchema.safeParse(position.additionalOffices);

  if (
    !additional.success ||
    additional.data?.office === null ||
    additional.data?.office === undefined
  ) {
    return [position.office ?? null];
  }

  const list = Array.isArray(additional.data.office)
    ? additional.data.office
    : [additional.data.office];

  return [position.office ?? null, ...list];
}

function postingsFromPositions(
  positions: readonly PersonioPosition[],
  german: ReadonlyMap<string, PersonioPosition>,
  origin: string,
) {
  return positions.map((position) => {
    const fallback = german.get(position.id);
    const englishText = descriptionText(position);
    const germanText = fallback === undefined ? null : descriptionText(fallback);
    const description = englishText ?? germanText;
    const language = englishText === null && germanText !== null ? "de" : "en";

    const schedule = position.schedule?.trim().toLowerCase() ?? "";
    const employmentType = EMPLOYMENT_TYPE_BY_SCHEDULE.get(schedule) ?? null;

    return {
      atsJobId: position.id,
      title: position.name?.trim() ?? "",
      url: `${origin}${JOB_PAGE_PATH}/${position.id}`,
      applyUrl: null,
      locationRaw: joinDistinctLocations(officesOf(position)),
      workplaceType: null,
      employmentType,
      language,
      postedAt: isoFromTimestamp(position.createdAt),
      sourceUpdatedAt: null,
      descriptionPending: false,
      content: {
        descriptionText: description,
        department: position.department?.trim() || null,
        locationRaw: null,
        salary: null,
      },
    } satisfies FeedPosting;
  });
}

export function createPersonioFeed(
  baseUrlTemplate: string = PERSONIO_DEFAULT_BASE_URL,
  fetcher: PersonioFetcher = PERSONIO_FETCHER,
) {
  const limiter = limiterFor("personio", PERSONIO_LIMITS);

  const originFor = (boardToken: string) => baseUrlTemplate.replaceAll("{token}", boardToken);

  const fetchLanguage = async (origin: string, language: "en" | "de") => {
    const url = `${origin}/xml?language=${language}`;
    const response = await limiter.run(async () => fetcher(url));

    if (GONE_STATUSES.has(response.status)) {
      return { status: "gone", text: null } as const;
    }

    if (response.status !== 200) {
      throw new FeedError(response.status, url);
    }

    return { status: "ok", text: response.text } as const;
  };

  const fetchBoard = async (boardToken: string, condition: BoardCondition, region: BoardRegion) => {
    const origin = originFor(boardToken);

    assertToken(boardToken, origin);
    void condition;
    void region;

    const english = await fetchLanguage(origin, "en");

    if (english.status === "gone") {
      return { status: "gone" } as const;
    }

    const positions = positionsFromXml(english.text);

    if (positions.every((position) => descriptionText(position) !== null)) {
      return {
        status: "ok",
        postings: postingsFromPositions(positions, new Map(), origin),
        etag: null,
        bodyHash: contentHash(english.text),
      } as const;
    }

    const german = await fetchLanguage(origin, "de");

    const germanPositions =
      german.status === "ok"
        ? new Map(positionsFromXml(german.text).map((position) => [position.id, position] as const))
        : new Map<string, PersonioPosition>();

    return {
      status: "ok",
      postings: postingsFromPositions(positions, germanPositions, origin),
      etag: null,
      bodyHash: contentHash(`${english.text}\n${german.text ?? ""}`),
    } as const;
  };

  return { fetchBoard } satisfies BoardFeed;
}
