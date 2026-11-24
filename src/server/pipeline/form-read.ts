import { createHash } from "node:crypto";

import { z } from "zod";

import type { FormQuestion } from "./send-plan.ts";
import type { QuestionFieldType } from "../../shared/questions.ts";
import type { BatchFourAts, BatchOneAts, BatchThreeAts, BatchTwoAts } from "../../shared/ats.ts";
import { isBatchFourAts } from "../../shared/ats.ts";

import { formSignature, sanitiseFormHtml } from "../fixtures/sanitise.ts";
import { LEVER_FIELD_TYPES, LEVER_SKIP_NAMES } from "../dispatch/ats/lever.ts";
import { assertNoLiveTraffic, LiveServiceRequestError } from "../platform/outbound-guard.ts";
import type { LoginWallFormRead } from "./login-wall.ts";
import { detectLoginWall } from "./login-wall.ts";
import { readBatch4FormHtml } from "./batch4-forms.ts";
import { readBreezyFormHtml } from "./breezy-form.ts";
import { personioApplyUrl, readPersonioFormHtml } from "./personio-form.ts";
import {
  breezyApplyUrl,
  joinComApplyUrl,
  pinpointApplyUrl,
  readClearCompanyFormHtml,
  readJoinComFormHtml,
  readPinpointFormHtml,
  readBambooHRFormHtml,
  readHireologyFormHtml,
  readRecruiteeFormHtml,
  readSoftgardenFormHtml,
  readTeamtailorFormHtml,
  readZohoRecruitFormHtml,
  recruiteeApplyUrl,
  softgardenApplyUrl,
  teamtailorApplyUrl,
} from "./wave1a-forms.ts";
import type { Batch1Ats } from "./hosted-form.ts";
import { isHostedFormAts, readHostedFormHtml } from "./hosted-form.ts";

export const FORM_READ_PATHS = [
  "lever_html",
  "ashby_graphql",
  "workable_form",
  "personio_html",
  "breezy_json",
  "teamtailor_html",
  "zoho_recruit_html",
  "bamboohr_html",
  "recruitee_html",
  "hireology_html",
  "softgarden_html",
  "clearcompany_html",
  "join_com_html",
  "pinpoint_html",
  "smartrecruiters_html",
  "paylocity_html",
  "manatal_html",
  "careerplug_html",
  "jazzhr_html",
  "batch4_html",
  "browser",
] as const;

export type FormReadPath = (typeof FORM_READ_PATHS)[number];

export type PlainFormReadPath = Exclude<FormReadPath, "browser">;

export interface PlainFormReadResult {
  questions: FormQuestion[];
  formSignature: string;
  path: PlainFormReadPath;
  unhandled?: string[];
}

export type FormReadResult = PlainFormReadResult | LoginWallFormRead;

/**
 * Whether a plain form read stopped at a login gate instead of an application
 * form, so callers can tell a wall apart from a page with no form.
 *
 * @param read the read outcome, or null when nothing could be read
 * @returns true when the page was a mandatory login gate
 */
export function isLoginWallRead(read: FormReadResult | null): read is LoginWallFormRead {
  return read !== null && "loginWall" in read;
}

export type FormReadAts =
  | "lever"
  | "ashby"
  | "workable"
  | "personio"
  | BatchOneAts
  | BatchTwoAts
  | BatchThreeAts
  | BatchFourAts;

export interface FormReadTarget {
  ats: FormReadAts;
  region: "us" | "eu";
  boardToken: string;
  atsJobId: string;
  applyUrl: string | null;
  url: string;
}

const LEVER_DEFAULT_JOBS_BASE_URL = "https://jobs.lever.co";

const LEVER_EU_DEFAULT_JOBS_BASE_URL = "https://jobs.eu.lever.co";

const ASHBY_DEFAULT_JOBS_BASE_URL = "https://jobs.ashbyhq.com";

const WORKABLE_DEFAULT_APPLY_BASE_URL = "https://apply.workable.com";

export const WORKABLE_APPLY_ORIGIN = WORKABLE_DEFAULT_APPLY_BASE_URL;

const FETCH_TIMEOUT_MS = 15_000;

const USER_AGENT = "Overture/1.0 (application preparation; read-only form read)";

const GENERIC_LABEL = /^please (?:check|select) all that apply:?$/iu;

const CLEAN_SPACE = /\s+/gu;

function cleanText(value: string) {
  return value
    .replaceAll(/[✱*]/gu, "")
    .replaceAll(CLEAN_SPACE, " ")
    .trim();
}

interface RawControl {
  name: string;
  type: string;
  value: string;
  required: boolean;
  tag: "input" | "select" | "textarea";
  options: { label: string; value: string }[];
  checkIndex: number;
}

interface RawBox {
  label: string;
  labelInner: string;
  required: boolean;
  heading: string;
  optionTexts: string[];
  controls: RawControl[];
}

function pushOption(box: RawBox | undefined, text: string) {
  box?.optionTexts.push(cleanText(text));
}

function rawControlsToQuestions(boxes: readonly RawBox[]) {
  const questions: FormQuestion[] = [];

  for (const box of boxes) {
    const inner = cleanText(box.labelInner);
    const full = cleanText(box.label);
    let label = inner === "" ? full : inner;

    if (GENERIC_LABEL.test(inner)) {
      label = box.heading === "" ? inner : box.heading;
    }

    if (label === "" || box.controls.length === 0) {
      continue;
    }

    const groups = new Map<string, RawControl[]>();

    for (const control of box.controls) {
      groups.set(control.name, [...(groups.get(control.name) ?? []), control]);
    }

    for (const [fieldName, controls] of groups) {
      const [first] = controls;

      if (
        first === undefined ||
        fieldName === "" ||
        LEVER_SKIP_NAMES.includes(fieldName) ||
        (first.tag === "input" &&
          ["hidden", "submit", "button", "file", "reset", "image"].includes(first.type))
      ) {
        continue;
      }

      const required = box.required || controls.some((control) => control.required);

      if (first.tag === "select") {
        questions.push({
          fieldName,
          fieldType: "select",
          label,
          options: first.options.flatMap((option) => (option.value === "" ? [] : [option.label])),
          required,
        });

        continue;
      }

      if (first.tag === "textarea") {
        questions.push({ fieldName, fieldType: "textarea", label, options: [], required });

        continue;
      }

      if (first.type === "checkbox" || first.type === "radio") {
        const checks = controls.filter(
          (control) => control.type === "checkbox" || control.type === "radio",
        );

        questions.push({
          fieldName,
          fieldType: first.type === "radio" ? "radio" : "multiselect",
          label,
          options: checks.map((control) => {
            const text = box.optionTexts[control.checkIndex] ?? "";

            return text === "" ? control.value : text;
          }),
          required,
        });

        continue;
      }

      questions.push({
        fieldName,
        fieldType: LEVER_FIELD_TYPES.get(first.type) ?? "text",
        label,
        options: [],
        required,
      });
    }
  }

  return questions;
}

export async function readLeverFormHtml(rawHtml: string) {
  const html = sanitiseFormHtml(rawHtml);
  const boxes: RawBox[] = [];
  const boxStack: RawBox[] = [];
  const optionStack: string[] = [];
  const selectStack: RawControl[] = [];

  let headingText = "";
  let lastHeading = "";
  let checksInBox = 0;

  const currentBox = () => boxStack.at(-1);

  const rewriter = new HTMLRewriter()
    .on("h1, h2, h3, h4", {
      element(element) {
        headingText = "";

        element.onEndTag(() => {
          lastHeading = cleanText(headingText);
        });
      },
      text(text) {
        headingText += text.text;
      },
    })
    .on(".application-question", {
      element(element) {
        const box: RawBox = {
          controls: [],
          heading: cleanText(lastHeading),
          label: "",
          labelInner: "",
          optionTexts: [],
          required: false,
        };

        boxes.push(box);
        boxStack.push(box);
        checksInBox = 0;

        element.onEndTag(() => {
          boxStack.pop();
        });
      },
    })
    .on(".application-label", {
      element() {
        const box = currentBox();

        if (box !== undefined) {
          box.label = "";
        }
      },
      text(text) {
        const box = currentBox();

        if (box !== undefined) {
          box.label += text.text;
        }
      },
    })
    .on(".application-label .text", {
      element() {
        const box = currentBox();

        if (box !== undefined) {
          box.labelInner = "";
        }
      },
      text(text) {
        const box = currentBox();

        if (box !== undefined) {
          box.labelInner += text.text;
        }
      },
    })
    .on(".application-question .required", {
      element() {
        const box = currentBox();

        if (box !== undefined) {
          box.required = true;
        }
      },
    })
    .on(".application-answer-alternative", {
      element(element) {
        optionStack.push("");

        element.onEndTag(() => {
          pushOption(currentBox(), optionStack.pop() ?? "");
        });
      },
      text(text) {
        optionStack[optionStack.length - 1] = (optionStack.at(-1) ?? "") + text.text;
      },
    })
    .on(".eeo-option-text", {
      element(element) {
        optionStack.push("");

        element.onEndTag(() => {
          pushOption(currentBox(), optionStack.pop() ?? "");
        });
      },
      text(text) {
        optionStack[optionStack.length - 1] = (optionStack.at(-1) ?? "") + text.text;
      },
    })
    .on("select", {
      element(element) {
        const box = currentBox();

        if (box === undefined) {
          return;
        }

        const control: RawControl = {
          checkIndex: 0,
          name: element.getAttribute("name") ?? "",
          options: [],
          required: element.getAttribute("required") !== null,
          tag: "select",
          type: "select",
          value: "",
        };

        box.controls.push(control);
        selectStack.push(control);
        element.onEndTag(() => {
          selectStack.pop();
        });
      },
    })
    .on("option", {
      element(element) {
        const select = selectStack.at(-1);

        if (select === undefined) {
          return;
        }

        select.options.push({ label: "", value: element.getAttribute("value") ?? "" });

        element.onEndTag(() => {
          const option = select.options.at(-1);

          if (option !== undefined) {
            option.label = cleanText(option.label);
          }
        });
      },
      text(text) {
        const option = selectStack.at(-1)?.options.at(-1);

        if (option !== undefined) {
          option.label += text.text;
        }
      },
    })
    .on("textarea", {
      element(element) {
        const box = currentBox();

        if (box === undefined) {
          return;
        }

        box.controls.push({
          checkIndex: 0,
          name: element.getAttribute("name") ?? "",
          options: [],
          required: element.getAttribute("required") !== null,
          tag: "textarea",
          type: "textarea",
          value: "",
        });
      },
    })
    .on("input", {
      element(element) {
        const box = currentBox();

        if (box === undefined) {
          return;
        }

        const type = (element.getAttribute("type") ?? "text").toLowerCase();
        let checkIndex = 0;

        if (type === "checkbox" || type === "radio") {
          checkIndex = checksInBox;
          checksInBox += 1;
        }

        const control: RawControl = {
          checkIndex,
          name: element.getAttribute("name") ?? "",
          options: [],
          required: element.getAttribute("required") !== null,
          tag: "input",
          type,
          value: element.getAttribute("value") ?? "",
        };

        box.controls.push(control);
      },
    });

  await rewriter.transform(new Response(html)).text();

  return {
    questions: rawControlsToQuestions(boxes),
    formSignature: formSignature(html),
    path: "lever_html" as const,
  } satisfies PlainFormReadResult;
}

const ashbySelectableValueSchema = z.union([
  z
    .object({ label: z.string(), value: z.string().nullish() })
    .loose()
    .transform((value) => value.label),
  z.string(),
]);

const ashbyFieldSchema = z
  .object({
    path: z.string().nullish(),
    title: z.string().nullish(),
    type: z.string().nullish(),
    selectableValues: z.array(ashbySelectableValueSchema).nullish(),
  })
  .loose();

const ashbyFieldEntrySchema = z
  .object({
    field: ashbyFieldSchema,
    isRequired: z.boolean().nullish(),
    isHidden: z.boolean().nullish(),
  })
  .loose();

const ashbySectionSchema = z
  .object({
    fieldEntries: z.array(ashbyFieldEntrySchema).nullish(),
  })
  .loose();

const ashbyFormSchema = z
  .object({
    sections: z.array(ashbySectionSchema).nullish(),
  })
  .loose();

const ashbyResponseSchema = z
  .object({
    data: z
      .object({
        jobPosting: z
          .object({
            applicationForm: ashbyFormSchema.nullish(),
            surveyForms: z.array(ashbyFormSchema).nullish(),
          })
          .loose()
          .nullish(),
      })
      .loose()
      .nullish(),
    errors: z.array(z.object({ message: z.string().nullish() }).loose()).nullish(),
  })
  .loose();

const ASHBY_FIELD_TYPES = new Map<string, QuestionFieldType>([
  ["String", "text"],
  ["LongText", "textarea"],
  ["RichText", "textarea"],
  ["Email", "email"],
  ["Phone", "phone"],
  ["Url", "url"],
  ["Date", "date"],
  ["Number", "number"],
  ["Currency", "number"],
  ["Boolean", "radio"],
  ["ValueSelect", "radio"],
  ["MultiValueSelect", "multiselect"],
  ["DimensionSelect", "select"],
  ["Location", "text"],
  ["SocialLink", "url"],
  ["Score", "text"],
  ["LinearRating", "number"],
  ["NPSRating", "number"],
  ["EducationHistory", "text"],
]);

const ASHBY_GRAPHQL_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    id
    title
    applicationForm {
      sections {
        fieldEntries {
          field {
            path
            title
            type
            isNullable
            selectableValues { label value }
          }
          isRequired
          isHidden
        }
      }
    }
    surveyForms {
      sections {
        fieldEntries {
          field {
            path
            title
            type
            isNullable
            selectableValues { label value }
          }
          isRequired
          isHidden
        }
      }
    }
  }
}`;

export function readAshbyGraphqlResponse(body: string) {
  let json: unknown;

  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }

  const parsed = ashbyResponseSchema.safeParse(json);

  if (!parsed.success || (parsed.data.errors?.length ?? 0) > 0) {
    return null;
  }

  const posting = parsed.data.data?.jobPosting;

  if (posting === null || posting === undefined) {
    return null;
  }

  const forms = [posting.applicationForm, ...(posting.surveyForms ?? [])];
  const questions: FormQuestion[] = [];

  for (const form of forms) {
    for (const section of form?.sections ?? []) {
      for (const entry of section.fieldEntries ?? []) {
        if (entry.isHidden === true) {
          continue;
        }

        const { field } = entry;
        const type = field.type ?? "";
        const label = cleanText(field.title ?? "");
        const fieldName = field.path ?? "";

        if (
          label === "" ||
          fieldName === "" ||
          type === "File" ||
          ASHBY_FIELD_TYPES.get(type) === undefined
        ) {
          continue;
        }

        const options = (field.selectableValues ?? [])
          .map((value) => cleanText(value))
          .filter((option) => option !== "");

        questions.push({
          fieldName,
          fieldType: ASHBY_FIELD_TYPES.get(type) ?? "text",
          label,
          options: type === "Boolean" && options.length === 0 ? ["Yes", "No"] : options,
          required: entry.isRequired === true,
        });
      }
    }
  }

  if (questions.length === 0) {
    return null;
  }

  return {
    questions,
    formSignature: formSignatureForQuestions("ashby_graphql", questions),
    path: "ashby_graphql" as const,
  } satisfies PlainFormReadResult;
}

const WORKABLE_STRUCTURAL_TYPES = new Set(["group", "hidden", "info"]);

const WORKABLE_FIELD_TYPES = new Map<string, QuestionFieldType>([
  ["text", "text"],
  ["string", "text"],
  ["email", "email"],
  ["phone", "phone"],
  ["paragraph", "textarea"],
  ["free_text", "textarea"],
  ["date", "date"],
  ["number", "number"],
  ["numeric", "number"],
  ["boolean", "radio"],
  ["dropdown", "select"],
  ["multiple", "multiselect"],
  ["multiple_choice", "multiselect"],
  ["file", "file"],
]);

const workableOptionSchema = z
  .object({ name: z.string(), value: z.string() })
  .loose()
  .transform((option) => cleanText(option.value));

const workableFieldSchema = z
  .object({
    id: z.string().nullish(),
    label: z.string().nullish(),
    type: z.string().nullish(),
    required: z.boolean().nullish(),
    options: z.array(workableOptionSchema).nullish(),
  })
  .loose();

const workableSectionSchema = z
  .object({
    name: z.string().nullish(),
    fields: z.array(workableFieldSchema).nullish(),
  })
  .loose();

const workableFormSchema = z.union([
  z.array(workableSectionSchema),
  z.object({ sections: z.array(workableSectionSchema).nullish() }).loose(),
]);

export function readWorkableFormResponse(body: string) {
  let json: unknown;

  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }

  const parsed = workableFormSchema.safeParse(json);

  if (!parsed.success) {
    return null;
  }

  const sections = Array.isArray(parsed.data) ? parsed.data : (parsed.data.sections ?? []);
  const questions: FormQuestion[] = [];

  for (const section of sections) {
    for (const field of section.fields ?? []) {
      const fieldName = (field.id ?? "").trim();
      const label = cleanText(field.label ?? "");
      const rawType = (field.type ?? "").trim().toLowerCase();
      const fieldType = WORKABLE_FIELD_TYPES.get(rawType);

      if (
        fieldName === "" ||
        label === "" ||
        WORKABLE_STRUCTURAL_TYPES.has(rawType) ||
        fieldType === undefined
      ) {
        continue;
      }

      const options = (field.options ?? []).filter((option) => option !== "");

      questions.push({
        fieldName,
        fieldType,
        label,
        options: fieldType === "radio" && options.length === 0 ? ["Yes", "No"] : options,
        required: field.required === true,
      });
    }
  }

  if (questions.length === 0) {
    return null;
  }

  return {
    questions,
    formSignature: formSignatureForQuestions("workable_form", questions),
    path: "workable_form" as const,
  } satisfies PlainFormReadResult;
}

export function formSignatureForQuestions(
  action: string,
  questions: readonly Pick<FormQuestion, "fieldName">[],
) {
  return createHash("sha256")
    .update(
      `${action}\n${questions
        .map((question) => question.fieldName)
        .toSorted()
        .join("\n")}`,
    )
    .digest("hex")
    .slice(0, 16);
}

function ashbyGraphqlUrl(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    url.pathname = "/api/non-user-graphql";
    url.search = "?op=ApiJobPosting";

    return url.toString();
  } catch {
    return null;
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function htmlPageRead(
  requestedUrl: string,
  response: Response,
  parse: (html: string) => PlainFormReadResult | Promise<PlainFormReadResult>,
) {
  const finalUrl = response.url === "" ? requestedUrl : response.url;
  const html = response.ok ? await response.text() : null;
  const verdict = detectLoginWall({ finalUrl, html, requestedUrl });

  if (verdict.wall) {
    return { evidence: verdict.evidence, loginWall: true } satisfies LoginWallFormRead;
  }

  return html === null ? null : await parse(html);
}

export function createPlainFormReader(
  options: {
    ashbyBaseUrl?: string | undefined;
    environment?: string | undefined;
    fetcher?: Fetcher;
    leverBaseUrl?: string | undefined;
    leverEuBaseUrl?: string | undefined;
    timeoutMs?: number;
    workableBaseUrl?: string | undefined;
  } = {},
) {
  const fetcher: Fetcher =
    options.fetcher ?? (async (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  const { environment } = options;

  async function guardedFetch(input: string, init: RequestInit) {
    if (environment !== undefined) {
      assertNoLiveTraffic(input, init.method ?? "GET", environment);
    }

    return fetcher(input, init);
  }

  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const leverBase = (options.leverBaseUrl ?? LEVER_DEFAULT_JOBS_BASE_URL).replace(/\/+$/u, "");

  const leverEuBase = (options.leverEuBaseUrl ?? LEVER_EU_DEFAULT_JOBS_BASE_URL).replace(
    /\/+$/u,
    "",
  );

  const ashbyBase = (options.ashbyBaseUrl ?? ASHBY_DEFAULT_JOBS_BASE_URL).replace(/\/+$/u, "");

  const workableBase = (options.workableBaseUrl ?? WORKABLE_DEFAULT_APPLY_BASE_URL).replace(
    /\/+$/u,
    "",
  );

  async function fetchFormPage(
    url: string,
    parse: (html: string) => PlainFormReadResult | Promise<PlainFormReadResult>,
  ) {
    const response = await guardedFetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });

    return htmlPageRead(url, response, parse);
  }

  async function lever(input: FormReadTarget) {
    const base = input.region === "eu" ? leverEuBase : leverBase;
    const url = `${base}/${encodeURIComponent(input.boardToken)}/${encodeURIComponent(input.atsJobId)}/apply`;

    const response = await guardedFetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });

    return htmlPageRead(url, response, readLeverFormHtml);
  }

  async function ashby(input: FormReadTarget) {
    const url = ashbyGraphqlUrl(ashbyBase);

    if (url === null) {
      return null;
    }

    const response = await guardedFetch(url, {
      body: JSON.stringify({
        operationName: "ApiJobPosting",
        query: ASHBY_GRAPHQL_QUERY,
        variables: {
          jobPostingId: input.atsJobId,
          organizationHostedJobsPageName: input.boardToken,
        },
      }),
      headers: { "content-type": "application/json", "user-agent": USER_AGENT },
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return null;
    }

    return readAshbyGraphqlResponse(await response.text());
  }

  async function workable(input: FormReadTarget) {
    const url = `${workableBase}/api/v1/jobs/${encodeURIComponent(input.atsJobId)}/form`;

    const response = await guardedFetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return null;
    }

    return readWorkableFormResponse(await response.text());
  }

  async function personio(input: FormReadTarget) {
    const url = personioApplyUrl(input.applyUrl ?? input.url);

    return url === null ? null : await fetchFormPage(url, readPersonioFormHtml);
  }

  async function breezy(input: FormReadTarget) {
    const url = breezyApplyUrl(input.applyUrl ?? input.url) ?? input.applyUrl ?? input.url;

    return await fetchFormPage(url, (html) => {
      const read = readBreezyFormHtml(html);

      return (
        read ?? {
          questions: [],
          formSignature: "",
          path: "breezy_json" as const,
        }
      );
    });
  }

  async function teamtailor(input: FormReadTarget) {
    const url = teamtailorApplyUrl(input.applyUrl ?? input.url) ?? input.applyUrl ?? input.url;

    return await fetchFormPage(url, readTeamtailorFormHtml);
  }

  async function zohoRecruit(input: FormReadTarget) {
    return await fetchFormPage(input.applyUrl ?? input.url, readZohoRecruitFormHtml);
  }

  async function bambooHr(input: FormReadTarget) {
    return await fetchFormPage(input.applyUrl ?? input.url, readBambooHRFormHtml);
  }

  async function recruitee(input: FormReadTarget) {
    const url = recruiteeApplyUrl(input.applyUrl ?? input.url) ?? input.applyUrl ?? input.url;

    return await fetchFormPage(url, readRecruiteeFormHtml);
  }

  async function hireology(input: FormReadTarget) {
    return await fetchFormPage(input.applyUrl ?? input.url, readHireologyFormHtml);
  }

  async function softgarden(input: FormReadTarget) {
    const url = softgardenApplyUrl(input.applyUrl ?? input.url) ?? input.applyUrl ?? input.url;

    return await fetchFormPage(url, readSoftgardenFormHtml);
  }

  async function clearcompany(input: FormReadTarget) {
    return await fetchFormPage(input.applyUrl ?? input.url, readClearCompanyFormHtml);
  }

  async function joinCom(input: FormReadTarget) {
    const url = joinComApplyUrl(input.applyUrl ?? input.url) ?? input.applyUrl ?? input.url;

    return await fetchFormPage(url, readJoinComFormHtml);
  }

  async function pinpoint(input: FormReadTarget) {
    const url = pinpointApplyUrl(input.applyUrl ?? input.url) ?? input.applyUrl ?? input.url;

    return await fetchFormPage(url, readPinpointFormHtml);
  }

  async function hosted(input: FormReadTarget, ats: Batch1Ats) {
    const url = input.applyUrl ?? input.url;

    const response = await guardedFetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });

    return htmlPageRead(url, response, async (html) => readHostedFormHtml(ats, html));
  }

  async function batch4(input: FormReadTarget) {
    return await fetchFormPage(input.applyUrl ?? input.url, readBatch4FormHtml);
  }

  return {
    async read(input: FormReadTarget) {
      try {
        if (input.ats === "lever") {
          return await lever(input);
        }

        if (input.ats === "ashby") {
          return await ashby(input);
        }

        if (input.ats === "workable") {
          return await workable(input);
        }

        if (input.ats === "personio") {
          return await personio(input);
        }

        if (isHostedFormAts(input.ats)) {
          return await hosted(input, input.ats);
        }

        if (input.ats === "breezy") {
          return await breezy(input);
        }

        if (input.ats === "teamtailor") {
          return await teamtailor(input);
        }

        if (input.ats === "zoho_recruit") {
          return await zohoRecruit(input);
        }

        if (input.ats === "bamboohr") {
          return await bambooHr(input);
        }

        if (input.ats === "recruitee") {
          return await recruitee(input);
        }

        if (input.ats === "hireology") {
          return await hireology(input);
        }

        if (input.ats === "softgarden") {
          return await softgarden(input);
        }

        if (input.ats === "clearcompany") {
          return await clearcompany(input);
        }

        if (input.ats === "join_com") {
          return await joinCom(input);
        }

        if (isBatchFourAts(input.ats)) {
          return await batch4(input);
        }

        return await pinpoint(input);
      } catch (error) {
        if (error instanceof LiveServiceRequestError) {
          throw error;
        }

        return null;
      }
    },
  };
}

export type PlainFormReader = ReturnType<typeof createPlainFormReader>;
