export type Ats = "greenhouse" | "lever" | "ashby";

export interface BoardCondition {
  etag: string | null;
  bodyHash: string | null;
}

export interface FeedContent {
  descriptionText: string | null;
  department: string | null;
  locationRaw: string | null;
}

export interface FeedPosting {
  atsJobId: string;
  title: string;
  url: string;
  locationRaw: string | null;
  language: string | null;
  postedAt: string | null;
  sourceUpdatedAt: string | null;
  descriptionPending: boolean;
  content: FeedContent | null;
}

export type BoardFetchResult =
  | { status: "not_modified" }
  | { status: "gone" }
  | { status: "ok"; postings: FeedPosting[]; etag: string | null; bodyHash: string };

export interface BoardFeed {
  fetchBoard: (boardToken: string, condition: BoardCondition) => Promise<BoardFetchResult>;
  fetchPostingDetail?: (boardToken: string, atsJobId: string) => Promise<FeedContent>;
}

export type BoardFeeds = Record<Ats, BoardFeed>;

export interface FeedResponse {
  status: number;
  etag: string | null;
  json: unknown;
}

export class FeedError extends Error {
  readonly status: number;

  constructor(status: number, url: string) {
    super(`GET ${url} failed: ${String(status)}`);
    this.name = "FeedError";
    this.status = status;
  }
}

export type UnconditionalFetcher = (url: string) => Promise<FeedResponse>;

export const UNCONDITIONAL_FETCHER: UnconditionalFetcher = async (url) => {
  const response = await fetch(url);

  if (response.status === 404) {
    return { status: 404, etag: null, json: null };
  }

  if (!response.ok) {
    throw new FeedError(response.status, url);
  }

  return { status: response.status, etag: null, json: await response.json() };
};

export function isoFromTimestamp(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function joinDistinctLocations(parts: (string | null | undefined)[]) {
  const out: string[] = [];

  for (const part of parts) {
    const value = part?.trim();

    if (value !== undefined && value !== "" && !out.includes(value.toLowerCase())) {
      out.push(value);
    }
  }

  return out.length === 0 ? null : out.join("; ");
}
