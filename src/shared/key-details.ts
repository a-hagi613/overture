import type { FactKey } from "./facts.ts";

/**
 * The key details one screen asks for after the resume is read (#702, SPEC §7.2).
 * The same keys, in this order, are what Profile → Saved answers lists first.
 */
export const KEY_DETAIL_FACT_KEYS = [
  "legal_name",
  "email",
  "phone",
  "current_city",
  "current_country",
  "work_auth",
  "sponsorship_required",
  "linkedin_url",
  "current_employer",
  "salary_expectation",
  "notice_period",
  "willing_relocate",
  "languages",
] as const satisfies readonly FactKey[];

export type KeyDetailFactKey = (typeof KEY_DETAIL_FACT_KEYS)[number];

export const KEY_DETAIL_FACT_LABELS: Record<KeyDetailFactKey, string> = {
  legal_name: "First and last name",
  email: "Email",
  phone: "Phone",
  current_city: "City",
  current_country: "Country",
  work_auth: "Legally allowed to work in the country",
  sponsorship_required: "Needs sponsorship",
  linkedin_url: "LinkedIn",
  current_employer: "Current employer",
  salary_expectation: "Salary expectation",
  notice_period: "Notice period or earliest start",
  willing_relocate: "Willing to relocate",
  languages: "Languages and proficiency level",
};

export type KeyDetailControl = "text" | "email" | "tel" | "url" | "yes-no";

export interface KeyDetailRow {
  id: string;
  label: string;
  keys: readonly KeyDetailFactKey[];
  control: KeyDetailControl;
  required: boolean;
}

/**
 * One screen, one order. A row may hold two keys (city and country) and the
 * yes/no rows store the form's own answer word, so a later form question can
 * reuse it unchanged.
 */
export const KEY_DETAIL_ROWS = [
  {
    id: "name",
    keys: ["legal_name"],
    label: "First and last name",
    control: "text",
    required: true,
  },
  { id: "email", keys: ["email"], label: "Email", control: "email", required: true },
  { id: "phone", keys: ["phone"], label: "Phone", control: "tel", required: true },
  {
    id: "city-country",
    keys: ["current_city", "current_country"],
    label: "City and country",
    control: "text",
    required: true,
  },
  {
    id: "work-auth",
    keys: ["work_auth"],
    label: KEY_DETAIL_FACT_LABELS.work_auth,
    control: "yes-no",
    required: true,
  },
  {
    id: "sponsorship",
    keys: ["sponsorship_required"],
    label: KEY_DETAIL_FACT_LABELS.sponsorship_required,
    control: "yes-no",
    required: true,
  },
  {
    id: "linkedin",
    keys: ["linkedin_url"],
    label: KEY_DETAIL_FACT_LABELS.linkedin_url,
    control: "url",
    required: false,
  },
  {
    id: "employer",
    keys: ["current_employer"],
    label: KEY_DETAIL_FACT_LABELS.current_employer,
    control: "text",
    required: false,
  },
  {
    id: "salary",
    keys: ["salary_expectation"],
    label: KEY_DETAIL_FACT_LABELS.salary_expectation,
    control: "text",
    required: true,
  },
  {
    id: "notice",
    keys: ["notice_period"],
    label: KEY_DETAIL_FACT_LABELS.notice_period,
    control: "text",
    required: true,
  },
  {
    id: "relocate",
    keys: ["willing_relocate"],
    label: KEY_DETAIL_FACT_LABELS.willing_relocate,
    control: "yes-no",
    required: true,
  },
  {
    id: "languages",
    keys: ["languages"],
    label: KEY_DETAIL_FACT_LABELS.languages,
    control: "text",
    required: true,
  },
] as const satisfies readonly KeyDetailRow[];

export function isKeyDetailFactKey(key: string): key is KeyDetailFactKey {
  return KEY_DETAIL_FACT_KEYS.some((candidate) => candidate === key);
}

/**
 * A stored free-text answer such as "Canadian citizen" becomes the yes/no word a
 * form expects; the screen shows it so the person confirms or corrects it.
 * @param value A saved Fact value or an empty string.
 * @returns Yes, No, or an empty string when there is nothing to show.
 */
export function yesNoFromStatement(value: string) {
  const folded = value.trim().toLocaleLowerCase("en");

  if (folded === "") {
    return "";
  }

  if (folded === "yes" || folded === "no") {
    return folded === "yes" ? "Yes" : "No";
  }

  if (
    /^(?:no|not|false|none)\b/u.test(folded) ||
    /\bnot\s+(?:authori[sz]ed|eligible|able)\b/u.test(folded) ||
    /\b(?:need|needs|require|requires)\s+(?:a\s+)?(?:visa|sponsorship)\b/u.test(folded)
  ) {
    return "No";
  }

  return "Yes";
}
