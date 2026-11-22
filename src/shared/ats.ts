/** The applicant tracking systems Overture ingests. Shared by the catalog and application schemas. */
export const ATS_VALUES = ["greenhouse", "lever", "ashby", "workable", "personio"] as const;

export type Ats = (typeof ATS_VALUES)[number];
