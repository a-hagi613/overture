import type { FormQuestion } from "./send-plan.ts";

import { formSignatureForHtmlQuestions, readHtmlForm } from "./html-form.ts";

/**
 * Personio renders the whole application form on its `/job/{id}/apply` page, so
 * the form is read over plain HTTP from the same markup a browser sees
 * (docs/SPEC.md §8.3, §10.5). Every control is named by its id: the profile
 * fields `first_name`, `last_name`, `email`, `phone`, `available_from`,
 * `salary_expectations`, `gender`, `birthday`, and documents as
 * `documents.<category>`; the employer's own questions are
 * `custom_attribute_<n>`.
 */
export const PERSONIO_STANDARD_LABELS: ReadonlyMap<string, string> = new Map([
  ["first_name", "First name"],
  ["last_name", "Last name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["available_from", "Earliest start date"],
  ["salary_expectations", "Salary expectations"],
  ["salary_expectation", "Salary expectations"],
  ["gender", "Gender"],
  ["birthday", "Birthday"],
  ["location", "Location"],
  ["current_title", "Current job title"],
  ["current_job_title", "Current job title"],
  ["current_employer", "Current employer"],
  ["linkedin", "LinkedIn"],
  ["linkedin_url", "LinkedIn"],
  ["website", "Website"],
  ["years_of_experience", "Years of experience"],
]);

export const PERSONIO_DOCUMENT_LABELS: ReadonlyMap<string, string> = new Map([
  ["documents.cv", "Resume"],
  ["documents.cover-letter", "Cover letter"],
  ["documents.cover_letter", "Cover letter"],
  ["documents.other", "Other document"],
  ["documents.employment-reference", "Employment reference"],
  ["documents.certificate", "Certificate"],
  ["documents.work-sample", "Work sample"],
]);

const PERSONIO_LABELS: ReadonlyMap<string, string> = new Map([
  ...PERSONIO_STANDARD_LABELS,
  ...PERSONIO_DOCUMENT_LABELS,
]);

const PERSONIO_SKIPPED_NAMES: ReadonlySet<string> = new Set(["authenticity_token"]);

/**
 * Parses a Personio application page. The form with a submit control wins; the
 * parser reads the same fields whatever the career site's language is, and
 * returns the employer's custom questions as they are labelled.
 *
 * @param rawHtml the server-rendered application page
 * @returns the form's questions, its signature, and any control it cannot fill
 */
export async function readPersonioFormHtml(rawHtml: string) {
  return readHtmlForm(rawHtml, {
    labels: PERSONIO_LABELS,
    path: "personio_html",
    skipNames: PERSONIO_SKIPPED_NAMES,
  });
}

export function formSignatureForPersonioQuestions(
  questions: readonly Pick<FormQuestion, "fieldName">[],
) {
  return formSignatureForHtmlQuestions("personio_html", questions);
}

/**
 * The apply page for a Personio posting: `/job/{id}` becomes
 * `/job/{id}/apply`, keeping the page's `language`.
 *
 * @param url a posting or apply URL, absolute
 * @returns the apply URL, or null when the URL is not a Personio posting
 */
export function personioApplyUrl(url: string) {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const match = /^\/job\/(?<id>\d+)(?:\/apply)?\/?$/u.exec(parsed.pathname);

  if (match?.groups?.id === undefined) {
    return null;
  }

  const language = parsed.searchParams.get("language");
  const query = language === null ? "" : `?language=${encodeURIComponent(language)}`;

  return `${parsed.origin}/job/${match.groups.id}/apply${query}`;
}
