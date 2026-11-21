import type { Page } from "playwright-core";

import { isFixtureHost } from "../../shared/live-service-hosts.ts";

export interface PostingIdentity {
  ats: "greenhouse" | "lever" | "ashby" | "workable" | "personio";
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

const LEVER_BOARD_HOSTS: ReadonlySet<string> = new Set(["jobs.lever.co", "jobs.eu.lever.co"]);

const ASHBY_BOARD_HOSTS: ReadonlySet<string> = new Set(["jobs.ashbyhq.com"]);

const WORKABLE_BOARD_HOSTS: ReadonlySet<string> = new Set(["apply.workable.com"]);

const PERSONIO_HOST = /^(?<token>[a-z0-9-]+)\.jobs\.personio\.(?:com|de)$/iu;

const personioToken = (host: string) =>
  PERSONIO_HOST.exec(host)?.groups?.["token"]?.toLowerCase() ?? null;

const hostnameOf = (host: string) => {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return host;
  }
};

const sameHost = (ats: PostingIdentity["ats"], expected: string, live: string) => {
  if (ats === "personio") {
    if (expected === live && isFixtureHost(hostnameOf(expected))) {
      return true;
    }

    const expectedToken = personioToken(expected);
    const liveToken = personioToken(live);

    return expectedToken !== null && liveToken !== null && expectedToken === liveToken;
  }

  if (expected === live) {
    return true;
  }

  if (ats === "greenhouse") {
    return GREENHOUSE_BOARD_HOSTS.has(expected) && GREENHOUSE_BOARD_HOSTS.has(live);
  }

  if (ats === "lever") {
    return LEVER_BOARD_HOSTS.has(expected) && LEVER_BOARD_HOSTS.has(live);
  }

  if (ats === "workable") {
    return WORKABLE_BOARD_HOSTS.has(expected) && WORKABLE_BOARD_HOSTS.has(live);
  }

  return ASHBY_BOARD_HOSTS.has(expected) && ASHBY_BOARD_HOSTS.has(live);
};

const pathSegments = (pathname: string) =>
  pathname
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => decodeURIComponent(segment));

function postingPath(ats: PostingIdentity["ats"], url: URL) {
  if (ats === "personio") {
    const boardToken = personioToken(url.host.toLowerCase()) ?? "";
    const jobId = /^\/job\/(?<id>\d+)(?:\/apply)?\/?$/u.exec(url.pathname)?.groups?.["id"];

    return jobId === undefined ? null : { boardToken, jobId };
  }

  if (ats === "greenhouse" && url.pathname === "/embed/job_app") {
    const boardToken = url.searchParams.get("for");
    const jobId = url.searchParams.get("token");

    return boardToken === null || jobId === null ? null : { boardToken, jobId };
  }

  const segments = pathSegments(url.pathname);

  if (ats === "greenhouse") {
    const jobsIndex = segments.indexOf("jobs");
    const boardToken = segments[jobsIndex - 1];
    const jobId = segments[jobsIndex + 1];

    return jobsIndex < 1 || boardToken === undefined || jobId === undefined
      ? null
      : { boardToken, jobId };
  }

  if (ats === "workable") {
    const jobsIndex = segments.indexOf("j");
    const jobId = segments[jobsIndex + 1];

    return jobsIndex === -1 || jobId === undefined
      ? null
      : { boardToken: segments[jobsIndex - 1] ?? "", jobId };
  }

  const [boardToken, jobId] = segments;

  return boardToken === undefined || jobId === undefined ? null : { boardToken, jobId };
}

const normalizedCompany = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "");

const companyFromTitle = (ats: PostingIdentity["ats"], title: string) => {
  if (ats === "lever") {
    const index = title.lastIndexOf(" - ");
    const company = index === -1 ? "" : title.slice(0, index).trim();

    return company === "" ? null : company;
  }

  if (ats === "ashby") {
    const index = title.lastIndexOf(" @ ");
    const company = index === -1 ? "" : title.slice(index + 3).trim();

    if (company !== "") {
      return company;
    }
  }

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

  if (!sameHost(expected.ats, posting.host.toLowerCase(), live.host.toLowerCase())) {
    return mismatch("host");
  }

  const livePosting = postingPath(expected.ats, live);

  if (livePosting === null) {
    return mismatch("unreadable");
  }

  if (expected.ats === "workable") {
    return livePosting.jobId === expected.jobId ? matched : mismatch("job_id");
  }

  if (
    livePosting.boardToken !== "" &&
    livePosting.boardToken.toLowerCase() !== expected.boardToken.toLowerCase()
  ) {
    return mismatch("board_token");
  }

  if (livePosting.jobId !== expected.jobId) {
    return mismatch("job_id");
  }

  if (expected.ats === "personio") {
    return matched;
  }

  const liveCompany = companyFromTitle(expected.ats, await page.title());

  if (
    liveCompany === null ||
    normalizedCompany(liveCompany) !== normalizedCompany(expected.companyName)
  ) {
    return mismatch("company");
  }

  return matched;
}
