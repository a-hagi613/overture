import { createHash } from "node:crypto";

import { z } from "zod";

import type { FormQuestion } from "./send-plan.ts";
import type { QuestionFieldType } from "../../shared/questions.ts";

const SILENT_FIELDS = new Set(["captcha", "tabular"]);

const bamboohrOptionSchema = z.looseObject({
  id: z.union([z.string(), z.number()]).optional(),
  text: z.string(),
});

const bamboohrFieldSchema = z.looseObject({
  isRequired: z.boolean().optional(),
  label: z.string(),
  options: z.array(bamboohrOptionSchema).optional(),
});

const bamboohrCustomQuestionSchema = z.looseObject({
  id: z.union([z.string(), z.number()]),
  isRequired: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  question: z.string(),
  type: z.string().optional(),
});

const bamboohrDetailSchema = z.looseObject({
  result: z.looseObject({
    formFields: z.record(z.string(), z.unknown()).optional(),
  }),
});

const BAMBOOHR_ADDRESS_FIELDS = new Set(["city", "countryId", "state", "streetAddress", "zip"]);

const BAMBOOHR_FIELD_TYPES = new Map<string, QuestionFieldType>([
  ["coverLetterFileId", "file"],
  ["dateAvailable", "date"],
  ["email", "email"],
  ["linkedinUrl", "url"],
  ["phone", "phone"],
  ["resumeFileId", "file"],
  ["websiteUrl", "url"],
]);

const BAMBOOHR_CUSTOM_FIELD_TYPES = new Map<string, QuestionFieldType>([
  ["checkbox", "checkbox"],
  ["date", "date"],
  ["dropdown", "select"],
  ["file", "file"],
  ["long", "textarea"],
  ["multiselect", "multiselect"],
  ["number", "number"],
  ["short", "text"],
  ["text", "text"],
  ["textarea", "textarea"],
]);

interface JsonFormRead {
  formLoaded: true;
  formSignature: string;
  path: "bamboohr_html" | "zoho_recruit_html" | "manatal_html";
  questions: FormQuestion[];
  unhandled: string[];
}

function jsonRead(path: JsonFormRead["path"], questions: FormQuestion[], unhandled: string[] = []) {
  return {
    formLoaded: true,
    formSignature: createHash("sha256")
      .update(
        `${path}\n${questions
          .map((question) => question.fieldName)
          .toSorted()
          .join("\n")}`,
      )
      .digest("hex")
      .slice(0, 16),
    path,
    questions,
    unhandled,
  } satisfies JsonFormRead;
}

/**
 * The BambooHR careers detail endpoint that carries the job's application fields.
 *
 * @param url A BambooHR posting or detail URL.
 * @returns The detail JSON URL, or null when the URL is not a BambooHR posting.
 */
export function bamboohrDetailUrl(url: string) {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const match = /^\/careers\/(?<id>[^/]+)(?:\/detail)?\/?$/u.exec(parsed.pathname);

  if (match?.groups?.["id"] === undefined) {
    return null;
  }

  return `${parsed.origin}/careers/${match.groups["id"]}/detail`;
}

function bamboohrOptionLabels(options: readonly { text: string }[] | undefined) {
  return (options ?? []).map((option) => option.text.trim()).filter((text) => text !== "");
}

function bamboohrFieldType(name: string, label: string, options: readonly string[]) {
  const byName = BAMBOOHR_FIELD_TYPES.get(name);

  if (byName !== undefined) {
    return byName;
  }

  if (options.length > 0) {
    return "select";
  }

  return /reference/iu.test(label) ? "textarea" : "text";
}

function bamboohrQuestion(name: string, field: z.infer<typeof bamboohrFieldSchema>) {
  const options = bamboohrOptionLabels(field.options);
  const fieldType = bamboohrFieldType(name, field.label, options);

  return {
    fieldName: BAMBOOHR_ADDRESS_FIELDS.has(name) ? `${name}.value` : name,
    fieldType,
    label: field.label.trim(),
    options: fieldType === "select" ? options : [],
    required: field.isRequired === true,
  };
}

function bamboohrCustomQuestion(field: z.infer<typeof bamboohrCustomQuestionSchema>) {
  const type = field.type ?? "short";
  const fieldType = BAMBOOHR_CUSTOM_FIELD_TYPES.get(type) ?? "text";

  return {
    fieldName: `customQuestionAnswers.${type}_${String(field.id)}`,
    fieldType,
    label: field.question.trim(),
    options: fieldType === "select" ? (field.options ?? []).map((option) => option.trim()) : [],
    required: field.isRequired === true,
  };
}

/**
 * Reads a BambooHR posting's application fields from its careers detail JSON.
 *
 * @param rawJson The `/careers/{id}/detail` response body.
 * @returns The form's questions, or null when the body is not a BambooHR detail.
 */
export function readBambooHRFormJson(rawJson: string) {
  let payload: unknown;

  try {
    payload = JSON.parse(rawJson);
  } catch {
    return null;
  }

  const parsed = bamboohrDetailSchema.safeParse(payload);

  if (!parsed.success || parsed.data.result.formFields === undefined) {
    return null;
  }

  const questions: FormQuestion[] = [];
  const unhandled: string[] = [];

  for (const [name, value] of Object.entries(parsed.data.result.formFields)) {
    if (name === "customQuestions") {
      const custom = z.array(bamboohrCustomQuestionSchema).safeParse(value);

      if (custom.success) {
        questions.push(
          ...custom.data
            .filter((field) => field.question.trim() !== "")
            .map((field) => bamboohrCustomQuestion(field)),
        );
      } else {
        unhandled.push(`${name}: custom questions`);
      }

      continue;
    }

    const field = bamboohrFieldSchema.safeParse(value);

    if (!field.success) {
      if (Array.isArray(value) && value.length > 0) {
        unhandled.push(`${name}: multiple values`);
      }

      continue;
    }

    if (field.data.label.trim() === "") {
      continue;
    }

    questions.push(bamboohrQuestion(name, field.data));
  }

  return jsonRead("bamboohr_html", questions, unhandled);
}

/**
 * The public Zoho Recruit webform endpoint behind a posting page.
 *
 * @param pageHtml The posting's HTML, which carries `meta.webform_id`.
 * @param postingUrl The posting URL, whose `/Careers/{id}` segment is the job id.
 * @returns The job id and apply-form URL, or null when the page has no webform.
 */
export function zohoRecruitApplyFormUrl(pageHtml: string, postingUrl: string) {
  let parsed: URL;

  try {
    parsed = new URL(postingUrl);
  } catch {
    return null;
  }

  const job = /\/Careers\/(?<id>\d+)/iu.exec(parsed.pathname);
  const webform = /["']?webform_id["']?\s*:\s*["']?(?<id>\d+)["']?/u.exec(pageHtml);

  if (job?.groups?.["id"] === undefined || webform?.groups?.["id"] === undefined) {
    return null;
  }

  const pageName =
    /["']?page_name["']?\s*:\s*["'](?<name>[^"']+)["']/u.exec(pageHtml)?.groups?.["name"] ??
    "Careers";

  return {
    jobId: job.groups["id"],
    url: `${parsed.origin}/recruit/v2/public/Job_Openings/${job.groups["id"]}/apply/${webform.groups["id"]}?pagename=${encodeURIComponent(pageName)}&source=CareerSite`,
  };
}

const zohoPicklistValueSchema = z.looseObject({
  actual_value: z.string(),
  display_value: z.string(),
});

const zohoFieldSchema = z.looseObject({
  api_name: z.string().optional(),
  data_type: z.string().optional(),
  field_label: z.string(),
  id: z.union([z.string(), z.number()]),
  pick_list_values: z.array(zohoPicklistValueSchema).optional(),
  required: z.boolean().nullish(),
  visible: z.boolean().optional(),
});

const zohoAttachmentSchema = z.looseObject({
  field_label: z.string(),
  id: z.union([z.string(), z.number()]),
  required: z.boolean().optional(),
});

const zohoSectionSchema = z.looseObject({
  attachmenttypes: z.array(zohoAttachmentSchema).optional(),
  fields: z.array(zohoFieldSchema).optional(),
  isattachment: z.boolean().optional(),
});

const zohoResponseSchema = z.looseObject({
  code: z.string().optional(),
  webforms: z
    .array(
      z.looseObject({
        sections: z.array(zohoSectionSchema),
      }),
    )
    .optional(),
});

const ZOHO_FIELD_TYPES = new Map<string, QuestionFieldType>([
  ["email", "email"],
  ["monthrange", "date"],
  ["phone", "phone"],
  ["picklist", "select"],
  ["text", "text"],
  ["textarea", "textarea"],
  ["website", "url"],
]);

function zohoFieldType(dataType: string | undefined, apiName: string | undefined) {
  if (dataType === "boolean") {
    return "checkbox" satisfies QuestionFieldType;
  }

  if (apiName === "RESUME") {
    return "file" satisfies QuestionFieldType;
  }

  return ZOHO_FIELD_TYPES.get(dataType ?? "") ?? "text";
}

function zohoOptions(field: z.infer<typeof zohoFieldSchema>) {
  return (field.pick_list_values ?? [])
    .filter((option) => option.actual_value !== "" && option.actual_value !== "-None-")
    .map((option) => option.display_value.trim())
    .filter((text) => text !== "");
}

/**
 * Reads a Zoho Recruit public webform response.
 *
 * @param rawJson The `Job_Openings/{id}/apply/{webformId}` response body.
 * @returns The form's questions, or null when the body is not a webform.
 */
export function readZohoRecruitFormJson(rawJson: string) {
  let payload: unknown;

  try {
    payload = JSON.parse(rawJson);
  } catch {
    return null;
  }

  const parsed = zohoResponseSchema.safeParse(payload);
  const webform = parsed.success ? parsed.data.webforms?.[0] : undefined;

  if (webform === undefined) {
    return null;
  }

  const questions: FormQuestion[] = [];
  const unhandled: string[] = [];

  for (const section of webform.sections) {
    const fields = section.fields ?? [];

    if (fields.some((field) => SILENT_FIELDS.has(field.data_type ?? ""))) {
      continue;
    }

    for (const field of fields) {
      if (
        field.visible === false ||
        SILENT_FIELDS.has(field.data_type ?? "") ||
        field.field_label.trim() === ""
      ) {
        continue;
      }

      const fieldType = zohoFieldType(field.data_type, field.api_name);
      const options = fieldType === "select" ? zohoOptions(field) : [];

      if (field.data_type === "picklist" && options.length === 0) {
        unhandled.push(`${String(field.id)}: empty picklist`);
      }

      questions.push({
        fieldName: `rec-form_${String(field.id)}`,
        fieldType,
        label: field.field_label.trim(),
        options,
        required: field.required === true,
      });
    }

    for (const attachment of section.attachmenttypes ?? []) {
      if (attachment.field_label.trim() === "") {
        continue;
      }

      questions.push({
        fieldName: `rec-form_${String(attachment.id)}_file`,
        fieldType: "file",
        label: attachment.field_label.trim(),
        options: [],
        required: attachment.required === true,
      });
    }
  }

  return jsonRead("zoho_recruit_html", questions, unhandled);
}

/**
 * Manatal serves the posting at `/…/job/{id}` and the form at its `/apply` suffix.
 *
 * @param url A Manatal posting or apply URL.
 * @returns The apply URL, or null when the URL is not a Manatal posting.
 */
export function manatalApplyUrl(url: string) {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const path = parsed.pathname.replace(/\/+$/u, "");

  if (path.endsWith("/apply")) {
    return `${parsed.origin}${path}${parsed.search}`;
  }

  if (!/\/(?:job|jobs)\/[^/]+$/u.test(path)) {
    return null;
  }

  return `${parsed.origin}${path}/apply${parsed.search}`;
}

/**
 * The numeric job id Manatal's apply page hands to its form API.
 *
 * @param pageHtml The `/apply` page HTML.
 * @returns The job id, or null when the page is not a Manatal apply page.
 */
export function manatalJobIdFromPage(pageHtml: string) {
  return /selectedJobId\s*=\s*["']?(?<id>\d+)["']?/u.exec(pageHtml)?.groups?.["id"] ?? null;
}

const manatalFieldSchema = z.looseObject({
  client_field_answer_choices: z.array(z.string()).optional(),
  client_field_field_type: z.string().optional(),
  client_field_slug: z.string().optional(),
  field_type: z.string().optional(),
  id: z.union([z.string(), z.number()]),
  is_required: z.boolean().optional(),
  label: z.string(),
  response_type: z.string().optional(),
});

const MANATAL_SELECT_SLUGS = new Map<string, readonly string[]>([
  ["current_notice_period", []],
  ["gender", ["Male", "Female", "Other"]],
  ["years_of_experience", []],
]);

const MANATAL_FILE_TYPES = new Set(["attachment", "resume"]);

const MANATAL_COMPLEX_TYPES = new Set(["educations", "experiences"]);

const MANATAL_MULTISELECT_SLUGS = new Set(["industries", "languages", "nationalities"]);

function manatalFieldType(field: z.infer<typeof manatalFieldSchema>) {
  if (MANATAL_FILE_TYPES.has(field.field_type ?? "")) {
    return "file" satisfies QuestionFieldType;
  }

  if (MANATAL_MULTISELECT_SLUGS.has(field.client_field_slug ?? "")) {
    return "multiselect" satisfies QuestionFieldType;
  }

  if (MANATAL_SELECT_SLUGS.has(field.client_field_slug ?? "")) {
    return "select" satisfies QuestionFieldType;
  }

  if (
    field.client_field_field_type === "checkbox" ||
    field.client_field_field_type === "multiple_select_dropdown"
  ) {
    return "multiselect" satisfies QuestionFieldType;
  }

  if (field.client_field_field_type === "multiple_choice") {
    return "radio" satisfies QuestionFieldType;
  }

  if (field.client_field_field_type === "dropdown") {
    return "select" satisfies QuestionFieldType;
  }

  switch (field.response_type) {
    case "boolean": {
      return "checkbox" satisfies QuestionFieldType;
    }

    case "datetime": {
      return "date" satisfies QuestionFieldType;
    }

    case "integer": {
      return "number" satisfies QuestionFieldType;
    }

    case "longtext": {
      return "textarea" satisfies QuestionFieldType;
    }

    default: {
      break;
    }
  }

  switch (field.client_field_slug) {
    case "email": {
      return "email" satisfies QuestionFieldType;
    }

    case "phone_number": {
      return "phone" satisfies QuestionFieldType;
    }

    default: {
      return "text" satisfies QuestionFieldType;
    }
  }
}

function manatalOptions(field: z.infer<typeof manatalFieldSchema>) {
  const chosen = MANATAL_SELECT_SLUGS.get(field.client_field_slug ?? "");

  if (chosen !== undefined && chosen.length > 0) {
    return [...chosen];
  }

  return (field.client_field_answer_choices ?? []).map((option) => option.trim());
}

/**
 * Reads Manatal's application-form API response.
 *
 * @param rawJson The `jobs/{id}/application-form/` response body.
 * @returns The form's questions, or null when the body is not a Manatal form.
 */
export function readManatalFormJson(rawJson: string) {
  let payload: unknown;

  try {
    payload = JSON.parse(rawJson);
  } catch {
    return null;
  }

  const parsed = z.array(manatalFieldSchema).safeParse(payload);

  if (!parsed.success) {
    return null;
  }

  const questions: FormQuestion[] = [];
  const unhandled: string[] = [];

  for (const field of parsed.data) {
    if (field.label.trim() === "" || MANATAL_COMPLEX_TYPES.has(field.field_type ?? "")) {
      if (MANATAL_COMPLEX_TYPES.has(field.field_type ?? "")) {
        unhandled.push(`${String(field.id)}: ${field.field_type ?? "complex"}`);
      }

      continue;
    }

    const fieldType = manatalFieldType(field);

    questions.push({
      fieldName: String(field.id),
      fieldType,
      label: field.label.trim(),
      options:
        fieldType === "select" || fieldType === "radio" || fieldType === "multiselect"
          ? manatalOptions(field)
          : [],
      required: field.is_required === true,
    });
  }

  return jsonRead("manatal_html", questions, unhandled);
}
