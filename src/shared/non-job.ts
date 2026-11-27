/**
 * Title phrases that name something other than a job: talent pools, open or speculative applications, recruiting
 * adverts and test/placeholder rows. These are matched against a normalized title, so a phrase only counts as whole
 * words and a real role title such as "Test Engineer" is not caught by the word "test" alone. The same list backs the
 * freehire reader and the retired catalog counts, so every surface hides the same rows.
 */
export const NON_JOB_TITLE_PHRASES: readonly string[] = [
  "talent pool",
  "talent pools",
  "talent pipeline",
  "talent bank",
  "talent community",
  "talent network",
  "talent register",
  "open application",
  "open applications",
  "general application",
  "general applications",
  "general interest",
  "expression of interest",
  "expressions of interest",
  "speculative application",
  "speculative applications",
  "spontaneous application",
  "spontaneous applications",
  "unsolicited application",
  "unsolicited applications",
  "join our talent",
  "no current openings",
  "no open positions",
  "do not apply",
  "internal use only",
  "test job",
  "test jobs",
  "test posting",
  "test position",
  "test listing",
  "dummy job",
  "placeholder",
  "placeholder job",
  "placeholder posting",
  "sample job",
  "example job",
  "initiativbewerbung",
  "initiativbewerbungen",
  "talentpool",
  "talentpools",
  "candidature spontanee",
  "candidature spontanée",
  "candidatures spontanees",
  "candidatures spontanées",
  "candidatura espontanea",
  "candidatura espontánea",
  "candidaturas espontaneas",
  "candidaturas espontáneas",
  "candidatura spontanea",
  "banque de candidatures",
  "candidatheque",
  "open sollicitatie",
];

/**
 * Folds a title the same way on every surface: compatibility-decomposed, lower case, diacritics removed, punctuation
 * to spaces, single spaces. The fold lets a German "Initiativbewerbung" list match the same phrase as its accented
 * French and Spanish neighbours.
 * @param title A job title.
 * @returns The folded title.
 */
export function normalizeJobTitle(title: string) {
  return title
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether a title names a non-job rather than a role.
 * @param title A job title.
 * @returns True for a talent pool, an open application, a recruiting advert or a test/placeholder row.
 */
export function isNonJobTitle(title: string) {
  const normalized = ` ${normalizeJobTitle(title)} `;

  return NON_JOB_TITLE_PHRASES.some((phrase) => normalized.includes(` ${phrase} `));
}
