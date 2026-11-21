import type { Page } from "playwright-core";

export interface PostingIdentity {
  url: string;
  boardToken: string;
  jobId: string;
  companyName: string;
}

export type PostingIdentityMismatch = "unreadable" | "host" | "board_token" | "job_id" | "company";

export type PostingIdentityCheck = { ok: true } | { ok: false; reason: PostingIdentityMismatch };

const GREENHOUSE_BOARD_HOSTS: ReadonlySet<string> = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "job-boards.eu.greenhouse.io",
]);

const sameHost = (expected: string, live: string) =>
  expected === live || (GREENHOUSE_BOARD_HOSTS.has(expected) && GREENHOUSE_BOARD_HOSTS.has(live));

const postingPath = (pathname: string) => {
  const segments = pathname
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => decodeURIComponent(segment));

  const jobsIndex = segments.indexOf("jobs");
  const boardToken = segments[jobsIndex - 1];
  const jobId = segments[jobsIndex + 1];

  if (jobsIndex < 1 || boardToken === undefined || jobId === undefined) {
    return null;
  }

  return { boardToken, jobId };
};

const normalizedCompany = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "");

const companyFromTitle = (title: string) => {
  const index = title.toLowerCase().lastIndexOf(" at ");
  const company = index === -1 ? "" : title.slice(index + 4).trim();

  return company === "" ? null : company;
};

const mismatch: (reason: PostingIdentityMismatch) => PostingIdentityCheck = (reason) => ({
  ok: false,
  reason,
});

const matched: PostingIdentityCheck = { ok: true };

export async function checkPostingIdentity(page: Page, expected: PostingIdentity) {
  let live: URL;
  let posting: URL;

  try {
    live = new URL(page.url());
    posting = new URL(expected.url);
  } catch {
    return mismatch("unreadable");
  }

  if (!sameHost(posting.host.toLowerCase(), live.host.toLowerCase())) {
    return mismatch("host");
  }

  const livePosting = postingPath(live.pathname);

  if (livePosting === null) {
    return mismatch("unreadable");
  }

  if (livePosting.boardToken.toLowerCase() !== expected.boardToken.toLowerCase()) {
    return mismatch("board_token");
  }

  if (livePosting.jobId !== expected.jobId) {
    return mismatch("job_id");
  }

  const liveCompany = companyFromTitle(await page.title());

  if (
    liveCompany === null ||
    normalizedCompany(liveCompany) !== normalizedCompany(expected.companyName)
  ) {
    return mismatch("company");
  }

  return matched;
}
