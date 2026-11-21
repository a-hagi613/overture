import { createHash } from "node:crypto";

import type { FormQuestion } from "./send-plan.ts";
import type { QuestionFieldType } from "../../shared/questions.ts";

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

const SKIPPED_NAMES: ReadonlySet<string> = new Set([
  "_token",
  "authenticity_token",
  "csrf_token",
  "csrfmiddlewaretoken",
  "utf8",
  "g-recaptcha-response",
  "cf-turnstile-response",
  "h-captcha-response",
]);

const SILENT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "button",
  "hidden",
  "image",
  "reset",
  "submit",
]);

const UNSUPPORTED_INPUT_TYPES: ReadonlySet<string> = new Set([
  "color",
  "password",
  "range",
  "search",
  "time",
  "week",
]);

const VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);

const CLEAN_SPACE = /\s+/gu;
const REQUIRED_MARKER = /(?:\*|\b(?:erforderlich|required)\b)/iu;

const INPUT_TYPES = new Map<string, QuestionFieldType>([
  ["date", "date"],
  ["email", "email"],
  ["number", "number"],
  ["tel", "phone"],
  ["text", "text"],
  ["url", "url"],
]);

interface RawOption {
  label: string;
  value: string;
}

interface RawControl {
  name: string;
  id: string;
  type: string;
  tag: "input" | "select" | "textarea";
  required: boolean;
  multiple: boolean;
  options: RawOption[];
  groupLabelIds: string[];
  ownLabel: string;
}

interface RawForm {
  controls: RawControl[];
  hasSubmit: boolean;
}

interface OpenGroup {
  labelIds: string[];
}

function cleanText(value: string) {
  return value.replaceAll(CLEAN_SPACE, " ").trim();
}

function cleanLabel(raw: string) {
  return cleanText(
    raw.replaceAll("*", "").replaceAll(/\((?:erforderlich|required|optional)\)/giu, ""),
  );
}

function canonicalLabel(name: string, ownLabel: string, groupLabel: string) {
  const standard = PERSONIO_STANDARD_LABELS.get(name) ?? PERSONIO_DOCUMENT_LABELS.get(name);

  if (standard !== undefined) {
    return standard;
  }

  const cleaned = cleanLabel(ownLabel === "" ? groupLabel : ownLabel);

  return cleaned === "" ? name : cleaned;
}

function starred(texts: readonly string[]) {
  return texts.some((text) => REQUIRED_MARKER.test(text));
}

function toQuestion(control: RawControl, labelled: ReadonlyMap<string, string>) {
  const groupLabel = control.groupLabelIds
    .map((id) => labelled.get(id) ?? "")
    .filter((text) => text !== "")
    .join(" ");

  const label = canonicalLabel(control.name, control.ownLabel, groupLabel);
  const required = control.required || starred([control.ownLabel, groupLabel]);

  if (control.tag === "select") {
    return {
      fieldName: control.name,
      fieldType: "select",
      label,
      options: control.options.flatMap((option) =>
        option.value === "" ? [] : [cleanText(option.label)],
      ),
      required,
    } satisfies FormQuestion;
  }

  if (control.tag === "textarea") {
    return {
      fieldName: control.name,
      fieldType: "textarea",
      label,
      options: [],
      required,
    } satisfies FormQuestion;
  }

  if (control.type === "file") {
    return {
      fieldName: control.name,
      fieldType: "file",
      label,
      options: [],
      required,
    } satisfies FormQuestion;
  }

  if (control.type === "checkbox") {
    return {
      fieldName: control.name,
      fieldType: "checkbox",
      label,
      options: [],
      required,
    } satisfies FormQuestion;
  }

  if (control.type === "radio") {
    return {
      fieldName: control.name,
      fieldType: "radio",
      label,
      options: [],
      required,
    } satisfies FormQuestion;
  }

  return {
    fieldName: control.name,
    fieldType: INPUT_TYPES.get(control.type) ?? "text",
    label,
    options: [],
    required,
  } satisfies FormQuestion;
}

function groupedQuestions(controls: readonly RawControl[], labelled: ReadonlyMap<string, string>) {
  const questions: FormQuestion[] = [];
  const seen = new Set<string>();

  for (const control of controls) {
    if (seen.has(control.name)) {
      continue;
    }

    seen.add(control.name);

    const group = controls.filter((candidate) => candidate.name === control.name);

    if (control.type === "radio" || (control.type === "checkbox" && group.length > 1)) {
      const [first] = group;

      if (first === undefined) {
        continue;
      }

      const groupLabel = first.groupLabelIds
        .map((id) => labelled.get(id) ?? "")
        .filter((text) => text !== "")
        .join(" ");

      questions.push({
        fieldName: first.name,
        fieldType: control.type === "radio" ? "radio" : "multiselect",
        label: canonicalLabel(first.name, first.ownLabel, groupLabel),
        options: group.map((entry) => cleanLabel(entry.ownLabel) || entry.id),
        required:
          group.some((entry) => entry.required) ||
          starred(group.flatMap((entry) => [entry.ownLabel, groupLabel])),
      });

      continue;
    }

    questions.push(toQuestion(control, labelled));
  }

  return questions;
}

export interface PersonioFormRead {
  questions: FormQuestion[];
  formSignature: string;
  path: "personio_html";
  unhandled: string[];
}

/**
 * Parses a Personio application page. The form with a submit control wins; the
 * parser reads the same fields whatever the career site's language is, and
 * returns the employer's custom questions as they are labelled.
 *
 * @param rawHtml the server-rendered application page
 * @returns the form's questions, its signature, and any control it cannot fill
 */
export async function readPersonioFormHtml(rawHtml: string) {
  const forms: RawForm[] = [];
  const formStack: RawForm[] = [];
  const groupStack: OpenGroup[] = [];
  const selectStack: RawControl[] = [];
  const labelled = new Map<string, string>();
  const labelStack: { id: string; text: string }[] = [];
  const idStack: { id: string; text: string }[] = [];
  const unhandled: string[] = [];

  const currentForm = () => formStack.at(-1);

  const currentGroupLabelIds = () => [...(groupStack.at(-1)?.labelIds ?? [])];

  const pushControl = (control: RawControl) => {
    const form = currentForm();

    if (form === undefined) {
      return false;
    }

    form.controls.push(control);

    return true;
  };

  const rewriter = new HTMLRewriter()
    .on("form", {
      element(element) {
        const form: RawForm = { controls: [], hasSubmit: false };

        forms.push(form);
        formStack.push(form);

        element.onEndTag(() => {
          formStack.pop();
        });
      },
    })
    .on("button, input[type='submit']", {
      element(element) {
        const form = currentForm();

        if (form === undefined) {
          return;
        }

        const tagged = element.tagName === "button" ? "button" : element.getAttribute("type");

        if (tagged === "button" || tagged === "submit") {
          form.hasSubmit = true;
        }
      },
    })
    .on("[role='group']", {
      element(element) {
        const group: OpenGroup = {
          labelIds: (element.getAttribute("aria-labelledby") ?? "")
            .split(CLEAN_SPACE)
            .filter((id) => id !== ""),
        };

        groupStack.push(group);

        element.onEndTag(() => {
          groupStack.pop();
        });
      },
    })
    .on("[id]", {
      element(element) {
        if (VOID_ELEMENTS.has(element.tagName)) {
          return;
        }

        idStack.push({ id: element.getAttribute("id") ?? "", text: "" });

        element.onEndTag(() => {
          const entry = idStack.pop();

          if (entry !== undefined && entry.id !== "" && !labelled.has(entry.id)) {
            labelled.set(entry.id, cleanText(entry.text));
          }
        });
      },
      text(text) {
        const entry = idStack.at(-1);

        if (entry !== undefined) {
          entry.text += text.text;
        }
      },
    })
    .on("label", {
      element(element) {
        labelStack.push({ id: element.getAttribute("for") ?? "", text: "" });

        element.onEndTag(() => {
          const entry = labelStack.pop();

          if (entry !== undefined && entry.id !== "") {
            labelled.set(entry.id, cleanText(entry.text));
          }
        });
      },
      text(text) {
        const entry = labelStack.at(-1);

        if (entry !== undefined) {
          entry.text += text.text;
        }
      },
    })
    .on("select", {
      element(element) {
        const control: RawControl = {
          groupLabelIds: currentGroupLabelIds(),
          id: element.getAttribute("id") ?? "",
          multiple: element.hasAttribute("multiple"),
          name: element.getAttribute("name") ?? "",
          options: [],
          ownLabel: "",
          required:
            element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
          tag: "select",
          type: "select",
        };

        if (pushControl(control)) {
          selectStack.push(control);

          element.onEndTag(() => {
            selectStack.pop();
          });
        }
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
        pushControl({
          groupLabelIds: currentGroupLabelIds(),
          id: element.getAttribute("id") ?? "",
          multiple: false,
          name: element.getAttribute("name") ?? "",
          options: [],
          ownLabel: "",
          required:
            element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
          tag: "textarea",
          type: "textarea",
        });
      },
    })
    .on("input", {
      element(element) {
        const type = (element.getAttribute("type") ?? "text").toLowerCase();
        const name = element.getAttribute("name") ?? "";

        if (name === "" || SKIPPED_NAMES.has(name) || SILENT_INPUT_TYPES.has(type)) {
          return;
        }

        if (UNSUPPORTED_INPUT_TYPES.has(type)) {
          unhandled.push(`${name}: ${type}`);

          return;
        }

        if (type !== "file" && !INPUT_TYPES.has(type) && type !== "radio" && type !== "checkbox") {
          unhandled.push(`${name}: ${type}`);

          return;
        }

        pushControl({
          groupLabelIds: currentGroupLabelIds(),
          id: element.getAttribute("id") ?? "",
          multiple: element.hasAttribute("multiple"),
          name,
          options: [],
          ownLabel: "",
          required:
            element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
          tag: "input",
          type,
        });
      },
    });

  await rewriter.transform(new Response(rawHtml)).text();

  const chosen =
    forms
      .filter((form) => form.controls.length > 0)
      .toSorted((left, right) => {
        if (left.hasSubmit !== right.hasSubmit) {
          return left.hasSubmit ? -1 : 1;
        }

        return right.controls.length - left.controls.length;
      })
      .at(0) ?? null;

  if (chosen === null) {
    return {
      questions: [],
      formSignature: "",
      path: "personio_html",
      unhandled,
    } satisfies PersonioFormRead;
  }

  const controls = chosen.controls.flatMap((control) => {
    if (control.name === "") {
      return [];
    }

    return [{ ...control, ownLabel: labelled.get(control.id) ?? "" }];
  });

  const questions = groupedQuestions(controls, labelled).filter(
    (question) => question.fieldName !== "",
  );

  return {
    questions,
    formSignature: questions.length === 0 ? "" : formSignatureForPersonioQuestions(questions),
    path: "personio_html",
    unhandled,
  } satisfies PersonioFormRead;
}

export function formSignatureForPersonioQuestions(
  questions: readonly Pick<FormQuestion, "fieldName">[],
) {
  return createHash("sha256")
    .update(
      `personio_html\n${questions
        .map((question) => question.fieldName)
        .toSorted()
        .join("\n")}`,
    )
    .digest("hex")
    .slice(0, 16);
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
