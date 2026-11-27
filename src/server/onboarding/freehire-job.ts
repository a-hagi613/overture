import type { JobPosting } from "../jobs/job-posting.ts";
import type { PostingDisplay } from "../matching/applications.ts";

/**
 * The immutable display copy an Application or an onboarding pick keeps of a posting. It reads the shared
 * freehire-first lookup (`jobs/job-posting.ts`), so a freehire job and a legacy catalog posting carry the same fields.
 * @param posting The resolved posting.
 * @returns The display fields every pick and Application row stores.
 */
export function displayFromJobPosting(posting: JobPosting) {
  return {
    applyUrl: posting.applyUrl,
    ats: posting.ats,
    companyDomain: posting.companyDomain,
    companyId: posting.companyId,
    companyName: posting.companyName,
    companyNameNorm: posting.companyNameNorm,
    locationRaw: posting.locationRaw,
    postingTitle: posting.title,
    postingUrl: posting.url ?? posting.applyUrl ?? "",
    salaryCurrency: posting.salaryCurrency,
    salaryMaxMinor: posting.salaryMaxMinor,
    salaryMinMinor: posting.salaryMinMinor,
    salaryPeriod:
      posting.salaryPeriod === "year" ||
      posting.salaryPeriod === "month" ||
      posting.salaryPeriod === "hour"
        ? posting.salaryPeriod
        : null,
  } satisfies PostingDisplay;
}
