import { readHtmlForm } from "./html-form.ts";

/**
 * The Wave 1A boards whose application form is in the first HTML response, and the
 * small URL rules that turn a posting URL into its apply URL. Each board keeps its
 * own label dictionary so a control's name never leaks into a user-facing question,
 * and every reader fails closed to an empty form when the markup is not the one it
 * was built for.
 */
export const SOFTGARDEN_LABELS: ReadonlyMap<string, string> = new Map([
  ["first_name", "First name"],
  ["last_name", "Last name"],
  ["email", "Email"],
  ["email_address", "Email"],
  ["phone", "Phone"],
  ["phone_number", "Phone"],
  ["street", "Street"],
  ["city", "City"],
  ["country", "Country"],
  ["message", "Message"],
  ["cover_letter", "Cover letter"],
  ["resume", "Resume"],
  ["cv", "Resume"],
]);

export const CLEARCOMPANY_LABELS: ReadonlyMap<string, string> = new Map([
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["email", "Email"],
  ["emailAddress", "Email"],
  ["phone", "Phone"],
  ["phoneNumber", "Phone"],
  ["address", "Address"],
  ["city", "City"],
  ["state", "State"],
  ["zip", "ZIP code"],
  ["resume", "Resume"],
  ["resumeFile", "Resume"],
  ["coverLetter", "Cover letter"],
]);

export const JOIN_COM_LABELS: ReadonlyMap<string, string> = new Map([
  ["firstName", "First name"],
  ["first_name", "First name"],
  ["lastName", "Last name"],
  ["last_name", "Last name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["phoneNumber", "Phone"],
  ["linkedin", "LinkedIn"],
  ["linkedinUrl", "LinkedIn"],
  ["website", "Website"],
  ["message", "Message"],
  ["coverLetter", "Cover letter"],
  ["cover_letter", "Cover letter"],
  ["resume", "Resume"],
  ["cv", "Resume"],
]);

export const PINPOINT_LABELS: ReadonlyMap<string, string> = new Map([
  ["application_form[application][first_name]", "First name"],
  ["application_form[application][last_name]", "Last name"],
  ["application_form[application][email]", "Email"],
  ["application_form[application][phone]", "Phone"],
  ["application_form[application][linkedin_url]", "LinkedIn"],
  ["application_form[application][cv]", "Resume"],
  ["application_form[application][cover_letter]", "Cover letter"],
]);

const CLEARCOMPANY_SKIPPED_NAMES: ReadonlySet<string> = new Set(["siteId", "source", "jobId"]);

const JOIN_SKIPPED_NAMES: ReadonlySet<string> = new Set(["recaptchaToken", "g-recaptcha-response"]);

export async function readSoftgardenFormHtml(rawHtml: string) {
  return readHtmlForm(rawHtml, { labels: SOFTGARDEN_LABELS, path: "softgarden_html" });
}

export async function readClearCompanyFormHtml(rawHtml: string) {
  return readHtmlForm(rawHtml, {
    labels: CLEARCOMPANY_LABELS,
    path: "clearcompany_html",
    skipNames: CLEARCOMPANY_SKIPPED_NAMES,
  });
}

export async function readJoinComFormHtml(rawHtml: string) {
  return readHtmlForm(rawHtml, {
    labels: JOIN_COM_LABELS,
    path: "join_com_html",
    skipNames: JOIN_SKIPPED_NAMES,
  });
}

export async function readPinpointFormHtml(rawHtml: string) {
  return readHtmlForm(rawHtml, { labels: PINPOINT_LABELS, path: "pinpoint_html" });
}

function parsedUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Breezy serves the posting at `/p/{id}-{slug}` and the form at its `/apply` suffix.
 *
 * @param url a posting or apply URL, absolute
 * @returns the apply URL, or null when the URL is not a Breezy posting
 */
export function breezyApplyUrl(url: string) {
  const parsed = parsedUrl(url);

  if (parsed === null) {
    return null;
  }

  const path = parsed.pathname.replace(/\/+$/u, "");

  if (!/^\/p\/[^/]+(?:\/apply)?$/u.test(path)) {
    return null;
  }

  return `${parsed.origin}${path.endsWith("/apply") ? path : `${path}/apply`}${parsed.search}`;
}

/**
 * Softgarden serves the posting at `/job/{id}` and the form at `/job/{id}/apply`,
 * keeping the page's language in the `l` query parameter.
 *
 * @param url a posting or apply URL, absolute
 * @returns the apply URL, or null when the URL is not a Softgarden posting
 */
export function softgardenApplyUrl(url: string) {
  const parsed = parsedUrl(url);

  if (parsed === null) {
    return null;
  }

  const match = /^\/job\/(?<id>[^/]+)(?:\/apply)?\/?$/u.exec(parsed.pathname);

  if (match?.groups?.["id"] === undefined) {
    return null;
  }

  const language = parsed.searchParams.get("l");
  const query = language === null ? "" : `?l=${encodeURIComponent(language)}`;

  return `${parsed.origin}/job/${match.groups["id"]}/apply${query}`;
}

/**
 * JOIN serves the posting at `/companies/{company}/{idParam}` and the form at its
 * `/apply` suffix.
 *
 * @param url a posting or apply URL, absolute
 * @returns the apply URL, or null when the URL is not a JOIN posting
 */
export function joinComApplyUrl(url: string) {
  const parsed = parsedUrl(url);

  if (parsed === null) {
    return null;
  }

  const path = parsed.pathname.replace(/\/+$/u, "");

  if (!/^\/companies\/[^/]+\/[^/]+(?:\/apply)?$/u.test(path)) {
    return null;
  }

  return `${parsed.origin}${path.endsWith("/apply") ? path : `${path}/apply`}${parsed.search}`;
}

/**
 * Pinpoint serves the posting at `/postings/{uuid}` and the form at
 * `/postings/{uuid}/applications/new`, keeping the locale path segment.
 *
 * @param url a posting or apply URL, absolute
 * @returns the apply URL, or null when the URL is not a Pinpoint posting
 */
export function pinpointApplyUrl(url: string) {
  const parsed = parsedUrl(url);

  if (parsed === null) {
    return null;
  }

  const segments = parsed.pathname
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => decodeURIComponent(segment));

  const postingsIndex = segments.indexOf("postings");
  const id = postingsIndex === -1 ? undefined : segments[postingsIndex + 1];

  if (postingsIndex === -1 || id === undefined) {
    return null;
  }

  const prefix = segments
    .slice(0, postingsIndex)
    .map((segment) => `/${encodeURIComponent(segment)}`)
    .join("");

  return `${parsed.origin}${prefix}/postings/${encodeURIComponent(id)}/applications/new`;
}

export const TEAMTAILOR_LABELS: ReadonlyMap<string, string> = new Map([
  ["candidate[first_name]", "First name"],
  ["candidate[last_name]", "Last name"],
  ["candidate[email]", "Email"],
  ["candidate[phone]", "Phone"],
  ["candidate[location]", "Location"],
  ["candidate[linkedin]", "LinkedIn"],
  ["candidate[resume]", "Resume"],
  ["candidate[cover_letter]", "Cover letter"],
  ["candidate[consent]", "Privacy policy"],
]);

export const ZOHO_RECRUIT_LABELS: ReadonlyMap<string, string> = new Map([
  ["first_name", "First name"],
  ["firstname", "First name"],
  ["last_name", "Last name"],
  ["lastname", "Last name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["mobile", "Phone"],
  ["current_employer", "Current employer"],
  ["current_job_title", "Current job title"],
  ["linkedin", "LinkedIn"],
  ["website", "Website"],
  ["city", "City"],
  ["resume", "Resume"],
]);

export const BAMBOOHR_LABELS: ReadonlyMap<string, string> = new Map([
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["email", "Email"],
  ["phoneNumber", "Phone"],
  ["city", "City"],
  ["country", "Country"],
  ["linkedinUrl", "LinkedIn"],
  ["websiteUrl", "Website"],
  ["resume", "Resume"],
  ["coverLetter", "Cover letter"],
]);

export const RECRUITEE_LABELS: ReadonlyMap<string, string> = new Map([
  ["candidate[name]", "Full name"],
  ["candidate[email]", "Email"],
  ["candidate[phone]", "Phone"],
  ["candidate[location]", "Location"],
  ["candidate[linkedin]", "LinkedIn"],
  ["candidate[cv]", "Resume"],
  ["candidate[cover_letter]", "Cover letter"],
]);

export const HIREOLOGY_LABELS: ReadonlyMap<string, string> = new Map([
  ["first_name", "First name"],
  ["last_name", "Last name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["city", "City"],
  ["state", "State"],
  ["resume", "Resume"],
]);

const TEAMTAILOR_SKIPPED_NAMES: ReadonlySet<string> = new Set([
  "candidate[utm_source]",
  "candidate[website_url]",
]);

const ZOHO_RECRUIT_SKIPPED_NAMES: ReadonlySet<string> = new Set(["jobId", "recruiterId", "source"]);

const BAMBOOHR_SKIPPED_NAMES: ReadonlySet<string> = new Set(["jobId", "source"]);

const RECRUITEE_SKIPPED_NAMES: ReadonlySet<string> = new Set(["candidate[utm_source]"]);

const HIREOLOGY_SKIPPED_NAMES: ReadonlySet<string> = new Set(["job_id", "source"]);

export async function readTeamtailorFormHtml(rawHtml: string) {
  return readHtmlForm(rawHtml, {
    labels: TEAMTAILOR_LABELS,
    path: "teamtailor_html",
    skipNames: TEAMTAILOR_SKIPPED_NAMES,
  });
}

export async function readZohoRecruitFormHtml(rawHtml: string) {
  return readHtmlForm(rawHtml, {
    labels: ZOHO_RECRUIT_LABELS,
    path: "zoho_recruit_html",
    skipNames: ZOHO_RECRUIT_SKIPPED_NAMES,
  });
}

export async function readBambooHRFormHtml(rawHtml: string) {
  return readHtmlForm(rawHtml, {
    labels: BAMBOOHR_LABELS,
    path: "bamboohr_html",
    skipNames: BAMBOOHR_SKIPPED_NAMES,
  });
}

export async function readRecruiteeFormHtml(rawHtml: string) {
  return readHtmlForm(rawHtml, {
    labels: RECRUITEE_LABELS,
    path: "recruitee_html",
    skipNames: RECRUITEE_SKIPPED_NAMES,
  });
}

export async function readHireologyFormHtml(rawHtml: string) {
  return readHtmlForm(rawHtml, {
    labels: HIREOLOGY_LABELS,
    path: "hireology_html",
    skipNames: HIREOLOGY_SKIPPED_NAMES,
  });
}

function withApplySuffix(url: string, posting: RegExp, suffix: string) {
  const parsed = parsedUrl(url);

  if (parsed === null) {
    return null;
  }

  const path = parsed.pathname.replace(/\/+$/u, "");

  if (path.endsWith(suffix)) {
    return `${parsed.origin}${path}${parsed.search}`;
  }

  if (!posting.test(path)) {
    return null;
  }

  return `${parsed.origin}${path}${suffix}${parsed.search}`;
}

/**
 * Teamtailor serves the posting at `/jobs/{id}` and the form at its
 * `/applications/new` suffix.
 *
 * @param url a posting or apply URL, absolute
 * @returns the apply URL, or null when the URL is not a Teamtailor posting
 */
export function teamtailorApplyUrl(url: string) {
  return withApplySuffix(url, /\/jobs\/[^/]+$/u, "/applications/new");
}

/**
 * Recruitee serves the posting at `/o/{slug}` and the form at its `/c/new` suffix.
 *
 * @param url a posting or apply URL, absolute
 * @returns the apply URL, or null when the URL is not a Recruitee posting
 */
export function recruiteeApplyUrl(url: string) {
  return withApplySuffix(url, /\/o\/[^/]+$/u, "/c/new");
}
