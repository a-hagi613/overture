import type { Page } from "playwright-core";

import type { ApplySupportedAts } from "../../shared/ats.ts";
import { BATCH_4_ATS, isBatchFourAts } from "../../shared/ats.ts";
import { isSameHostOrSubdomain } from "../../shared/host-match.ts";
import { isFixtureHost } from "../../shared/live-service-hosts.ts";

export interface PostingIdentity {
  ats: ApplySupportedAts;
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

const SMART_RECRUITERS_BOARD_HOSTS: ReadonlySet<string> = new Set([
  "jobs.smartrecruiters.com",
  "careers.smartrecruiters.com",
]);

const PAYLOCITY_BOARD_HOSTS: ReadonlySet<string> = new Set(["recruiting.paylocity.com"]);

const CAREERPLUG_BOARD_HOSTS: ReadonlySet<string> = new Set(["careers.careerplug.com"]);

const JAZZHR_BOARD_HOSTS: ReadonlySet<string> = new Set(["jobs.jazzhr.com", "app.jazz.co"]);

const MANATAL_HOST = /^(?<token>[a-z0-9-]+)\.manatal\.com$/iu;

const BREEZY_HOST = /^(?<token>[a-z0-9-]+)\.breezy\.hr$/iu;

const SOFTGARDEN_HOST = /^(?<token>[a-z0-9-]+)\.softgarden\.io$/iu;

const PINPOINT_HOST = /^(?<token>[a-z0-9-]+)\.pinpointhq\.com$/iu;

const TEAMTAILOR_HOST = /^(?<token>[a-z0-9-]+)\.teamtailor\.com$/iu;

const ZOHO_RECRUIT_HOST = /^(?<token>[a-z0-9-]+)\.zohorecruit\.com$/iu;

const BAMBOOHR_HOST = /^(?<token>[a-z0-9-]+)\.bamboohr\.com$/iu;

const RECRUITEE_HOST = /^(?<token>[a-z0-9-]+)\.recruitee\.com$/iu;

const HIREOLOGY_HOST = /^(?:(?<token>[a-z0-9-]+)\.)?hireology\.com$/iu;

const BOARD_HOST_PATTERNS = {
  breezy: BREEZY_HOST,
  pinpoint: PINPOINT_HOST,
  softgarden: SOFTGARDEN_HOST,
  teamtailor: TEAMTAILOR_HOST,
  zoho_recruit: ZOHO_RECRUIT_HOST,
  bamboohr: BAMBOOHR_HOST,
  recruitee: RECRUITEE_HOST,
  hireology: HIREOLOGY_HOST,
} as const;

const APPLY_HOST_TOKENS: ReadonlySet<string> = new Set(["app", "apply", "careers", "jobs", "www"]);

const JOIN_HOST = /^(?:[a-z0-9-]+\.)?join\.com$/iu;

const CLEARCOMPANY_HOST = /^(?:(?<token>[a-z0-9-]+)\.)?clearcompany\.com$/iu;

const BATCH_4_DOMAINS: Partial<Record<ApplySupportedAts, string>> = {
  applicantpro: "applicantpro.com",
  catsone: "catsone.com",
  gem: "gem.com",
  hiringthing: "hiringthing.com",
  isolved_hire: "isolvedhire.com",
  onlyfy: "onlyfy.com",
  rippling: "rippling.com",
  varbi: "varbi.com",
};

const HOSTED_PATH_SUFFIXES: ReadonlySet<string> = new Set([
  "apply",
  "application",
  "apply-now",
  "apply_now",
]);

const batchFourDomain = (host: string) => {
  for (const ats of BATCH_4_ATS) {
    const domain = BATCH_4_DOMAINS[ats];

    if (domain !== undefined && isSameHostOrSubdomain(host, domain)) {
      return domain;
    }
  }

  return null;
};

const personioToken = (host: string) =>
  PERSONIO_HOST.exec(host)?.groups?.["token"]?.toLowerCase() ?? null;

const manatalToken = (host: string) =>
  MANATAL_HOST.exec(host)?.groups?.["token"]?.toLowerCase() ?? null;

const tokenFromHost = (pattern: RegExp, host: string) =>
  pattern.exec(host)?.groups?.["token"]?.toLowerCase() ?? null;

const hostnameOf = (host: string) => {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return host;
  }
};

const firstSegment = (segments: readonly string[]) => segments[0] ?? "";

const sameHost = (ats: ApplySupportedAts, expected: string, live: string) => {
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

  if (
    ats === "breezy" ||
    ats === "softgarden" ||
    ats === "pinpoint" ||
    ats === "teamtailor" ||
    ats === "zoho_recruit" ||
    ats === "bamboohr" ||
    ats === "recruitee" ||
    ats === "hireology"
  ) {
    const pattern = BOARD_HOST_PATTERNS[ats];
    const expectedToken = tokenFromHost(pattern, expected);
    const liveToken = tokenFromHost(pattern, live);

    if (expectedToken === null || liveToken === null) {
      return false;
    }

    return (
      expectedToken === liveToken ||
      APPLY_HOST_TOKENS.has(expectedToken) ||
      APPLY_HOST_TOKENS.has(liveToken)
    );
  }

  if (ats === "join_com") {
    return JOIN_HOST.test(expected) && JOIN_HOST.test(live);
  }

  if (ats === "clearcompany") {
    return CLEARCOMPANY_HOST.test(expected) && CLEARCOMPANY_HOST.test(live);
  }

  if (ats === "smartrecruiters") {
    return SMART_RECRUITERS_BOARD_HOSTS.has(expected) && SMART_RECRUITERS_BOARD_HOSTS.has(live);
  }

  if (ats === "paylocity") {
    return PAYLOCITY_BOARD_HOSTS.has(expected) && PAYLOCITY_BOARD_HOSTS.has(live);
  }

  if (ats === "careerplug") {
    return CAREERPLUG_BOARD_HOSTS.has(expected) && CAREERPLUG_BOARD_HOSTS.has(live);
  }

  if (ats === "jazzhr") {
    return JAZZHR_BOARD_HOSTS.has(expected) && JAZZHR_BOARD_HOSTS.has(live);
  }

  if (ats === "manatal") {
    const expectedToken = manatalToken(expected);
    const liveToken = manatalToken(live);

    return expectedToken !== null && liveToken !== null && expectedToken === liveToken;
  }

  if (isBatchFourAts(ats)) {
    if (isFixtureHost(hostnameOf(expected)) && isFixtureHost(hostnameOf(live))) {
      return true;
    }

    const expectedBoard = batchFourDomain(hostnameOf(expected));
    const liveBoard = batchFourDomain(hostnameOf(live));

    return expectedBoard !== null && liveBoard !== null && expectedBoard === liveBoard;
  }

  return ASHBY_BOARD_HOSTS.has(expected) && ASHBY_BOARD_HOSTS.has(live);
};

const jobIdSegment = (slug: string) => slug.split("-")[0] ?? slug;

const pathSegments = (pathname: string) =>
  pathname
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => decodeURIComponent(segment));

function jobIdFromPath(ats: ApplySupportedAts, segments: readonly string[]) {
  if (ats === "greenhouse") {
    const jobsIndex = segments.indexOf("jobs");

    return jobsIndex < 1 ? null : (segments[jobsIndex + 1] ?? null);
  }

  if (ats === "workable") {
    const jobsIndex = segments.indexOf("j");

    return jobsIndex === -1 ? null : (segments[jobsIndex + 1] ?? null);
  }

  if (ats === "breezy") {
    const pIndex = segments.indexOf("p");
    const friendly = pIndex === -1 ? undefined : segments[pIndex + 1];

    return friendly === undefined ? null : (friendly.split("-")[0] ?? null);
  }

  if (ats === "softgarden") {
    const jobIndex = segments.indexOf("job");

    return jobIndex === -1 ? null : (segments[jobIndex + 1] ?? null);
  }

  if (ats === "join_com") {
    const companiesIndex = segments.indexOf("companies");

    return companiesIndex === -1 ? null : (segments[companiesIndex + 2] ?? null);
  }

  if (ats === "pinpoint") {
    const postingIndex = segments.indexOf("postings");

    return postingIndex === -1 ? null : (segments[postingIndex + 1] ?? null);
  }

  if (ats === "clearcompany") {
    return segments[1] ?? null;
  }

  if (ats === "smartrecruiters") {
    const [, slug] = segments;

    return slug === undefined ? null : jobIdSegment(slug);
  }

  if (ats === "careerplug") {
    const jobsIndex = segments.indexOf("jobs");
    const [, second] = segments;
    const slug = segments[jobsIndex + 1] ?? second;

    return slug === undefined ? null : jobIdSegment(slug);
  }

  if (ats === "jazzhr") {
    const applyIndex = segments.indexOf("apply");
    const [, second] = segments;
    const slug = segments[applyIndex + 1] ?? second;

    return slug === undefined ? null : jobIdSegment(slug);
  }

  if (ats === "paylocity") {
    return (
      /^\/Recruiting\/Jobs\/(?:Details|Apply)\/(?<id>\d+)\/?$/iu.exec(`/${segments.join("/")}`)
        ?.groups?.["id"] ?? null
    );
  }

  if (ats === "manatal") {
    const jobsIndex = segments.indexOf("jobs");

    return jobsIndex === -1 ? null : (segments[jobsIndex + 1] ?? null);
  }

  if (ats === "teamtailor" || ats === "hireology") {
    const jobsIndex = segments.indexOf("jobs");

    return jobsIndex === -1 ? null : (segments[jobsIndex + 1] ?? null);
  }

  if (ats === "zoho_recruit") {
    const careersIndex = segments.findIndex((segment) => segment.toLowerCase() === "careers");

    return careersIndex === -1 ? null : (segments[careersIndex + 1] ?? null);
  }

  if (ats === "bamboohr") {
    const index = segments.findIndex((segment) =>
      ["careers", "jobs"].includes(segment.toLowerCase()),
    );

    return index === -1 ? null : (segments[index + 1] ?? null);
  }

  if (ats === "recruitee") {
    const oIndex = segments.indexOf("o");

    return oIndex === -1 ? null : (segments[oIndex + 1] ?? null);
  }

  const [boardToken, jobId] = segments;

  return boardToken === undefined || jobId === undefined ? null : jobId;
}

function boardTokenFrom(ats: ApplySupportedAts, url: URL, segments: readonly string[]) {
  const host = url.host.toLowerCase();

  if (ats === "breezy") {
    return tokenFromHost(BREEZY_HOST, host) ?? firstSegment(segments);
  }

  if (ats === "softgarden") {
    return tokenFromHost(SOFTGARDEN_HOST, host) ?? firstSegment(segments);
  }

  if (ats === "pinpoint") {
    const hostToken = tokenFromHost(PINPOINT_HOST, host);

    if (hostToken !== null) {
      return hostToken;
    }

    const postingIndex = segments.indexOf("postings");
    const prefix = postingIndex === -1 ? [] : segments.slice(0, postingIndex);
    const last = prefix.at(-1);

    if (last !== undefined && /^[a-z]{2}(?:-[a-z]{2})?$/iu.test(last)) {
      return prefix.at(-2) ?? "";
    }

    return last ?? firstSegment(segments);
  }

  if (ats === "join_com") {
    const companiesIndex = segments.indexOf("companies");

    return companiesIndex === -1 ? firstSegment(segments) : (segments[companiesIndex + 1] ?? "");
  }

  if (ats === "clearcompany") {
    return (
      tokenFromHost(CLEARCOMPANY_HOST, host.replace(/^apply\./u, "")) ?? firstSegment(segments)
    );
  }

  if (ats === "paylocity") {
    return "";
  }

  if (ats === "manatal") {
    const hostToken = manatalToken(host);

    if (hostToken !== null) {
      return hostToken;
    }

    const jobsIndex = segments.indexOf("jobs");

    return jobsIndex > 0 ? (segments[jobsIndex - 1] ?? "") : "";
  }

  if (ats === "careerplug") {
    const jobsIndex = segments.indexOf("jobs");

    return jobsIndex === 0 ? "" : (segments[0] ?? "");
  }

  if (ats === "jazzhr") {
    const applyIndex = segments.indexOf("apply");

    return applyIndex === 0 ? "" : firstSegment(segments);
  }

  if (
    ats === "teamtailor" ||
    ats === "zoho_recruit" ||
    ats === "bamboohr" ||
    ats === "recruitee" ||
    ats === "hireology"
  ) {
    return tokenFromHost(BOARD_HOST_PATTERNS[ats], host) ?? firstSegment(segments);
  }

  return firstSegment(segments);
}

function postingPath(ats: ApplySupportedAts, url: URL) {
  if (isBatchFourAts(ats)) {
    const segments = pathSegments(url.pathname);

    while (HOSTED_PATH_SUFFIXES.has((segments.at(-1) ?? "").toLowerCase())) {
      segments.pop();
    }

    const jobId = segments.at(-1);
    const [boardToken] = segments;

    return jobId === undefined || boardToken === undefined ? null : { boardToken, jobId };
  }

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
  const boardToken = boardTokenFrom(ats, url, segments);

  if (ats === "clearcompany") {
    const jobId = url.searchParams.get("jobId") ?? jobIdFromPath(ats, segments);

    return jobId === null || boardToken === "" ? null : { boardToken, jobId };
  }

  if (ats === "bamboohr" && url.searchParams.get("id") !== null) {
    return { boardToken, jobId: url.searchParams.get("id") ?? "" };
  }

  const jobId = jobIdFromPath(ats, segments);
  const allowsEmptyBoard = ats === "paylocity" || ats === "careerplug" || ats === "jazzhr";

  return jobId === null || (boardToken === "" && !allowsEmptyBoard) ? null : { boardToken, jobId };
}

const normalizedCompany = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "");

const companyFromTitle = (ats: ApplySupportedAts, title: string) => {
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

const TITLE_HAS_COMPANY: ReadonlySet<ApplySupportedAts> = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "workable",
]);

const mismatch: (reason: PostingIdentityMismatch) => PostingIdentityCheck = (reason) => ({
  ok: false,
  reason,
});

const matched: PostingIdentityCheck = { ok: true };

/**
 * Compares a Batch 4 board's expected posting with the URL the page settled on. The board's host and the
 * job id are required; a fixture host is exempt from the board-slug check, and the page title is never
 * treated as the company because these boards do not print one in a fixed shape.
 *
 * @param expected The posting the approved plan was made for.
 * @param liveUrl The URL the browser page is on.
 * @returns The mismatch reason, or null when the page is the expected posting.
 */
export function batchFourIdentityProblem(expected: PostingIdentity, liveUrl: string) {
  let live: URL;
  let posting: URL;

  try {
    live = new URL(liveUrl);
    posting = new URL(expected.url);
  } catch {
    return "unreadable" as const;
  }

  if (!sameHost(expected.ats, posting.host.toLowerCase(), live.host.toLowerCase())) {
    return "host" as const;
  }

  const livePosting = postingPath(expected.ats, live);

  if (livePosting === null) {
    return "unreadable" as const;
  }

  if (livePosting.jobId !== expected.jobId) {
    return "job_id" as const;
  }

  const expectedHost = hostnameOf(posting.host.toLowerCase());
  const liveHost = hostnameOf(live.host.toLowerCase());

  if (isFixtureHost(expectedHost) || isFixtureHost(liveHost)) {
    return null;
  }

  const boardToken = normalizedCompany(expected.boardToken);

  if (boardToken !== "" && !normalizedCompany(`${liveHost}${live.pathname}`).includes(boardToken)) {
    return "board_token" as const;
  }

  return null;
}

export async function checkPostingIdentity(page: Page, expected: PostingIdentity) {
  let live: URL;
  let posting: URL;

  try {
    live = new URL(page.url());
    posting = new URL(expected.url);
  } catch {
    return mismatch("unreadable");
  }

  if (isBatchFourAts(expected.ats)) {
    const reason = batchFourIdentityProblem(expected, live.toString());

    return reason === null ? matched : mismatch(reason);
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

  const skipEmptyBoardToken =
    (expected.ats === "personio" ||
      expected.ats === "paylocity" ||
      expected.ats === "careerplug" ||
      expected.ats === "jazzhr") &&
    livePosting.boardToken === "";

  const liveBoardToken = livePosting.boardToken.toLowerCase();

  const appliesWithoutToken = expected.ats === "hireology" && APPLY_HOST_TOKENS.has(liveBoardToken);

  if (
    !skipEmptyBoardToken &&
    !appliesWithoutToken &&
    liveBoardToken !== expected.boardToken.toLowerCase()
  ) {
    return mismatch("board_token");
  }

  if (livePosting.jobId !== expected.jobId) {
    return mismatch("job_id");
  }

  if (expected.ats === "personio") {
    return matched;
  }

  if (!TITLE_HAS_COMPANY.has(expected.ats)) {
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
