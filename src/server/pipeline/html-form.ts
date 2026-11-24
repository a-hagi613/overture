import { createHash } from "node:crypto";

import type { FormQuestion } from "./send-plan.ts";
import type { QuestionFieldType } from "../../shared/questions.ts";

/**
 * Reads a server-rendered application form over plain HTTP from the same markup a
 * browser sees (docs/SPEC.md §8.3, §10.5). The parser is shared by every Wave 1A
 * board whose apply page carries the form in its first HTML response: Personio,
 * Softgarden, ClearCompany, JOIN and Pinpoint. A board supplies its own label
 * dictionary and, when it has one, its own skipped-control list; everything else
 * (radio/multiselect grouping, required markers, fail-closed form choice) is the
 * same contract for each board.
 */
export type HtmlFormPath =
  | "personio_html"
  | "teamtailor_html"
  | "zoho_recruit_html"
  | "bamboohr_html"
  | "recruitee_html"
  | "hireology_html"
  | "softgarden_html"
  | "clearcompany_html"
  | "join_com_html"
  | "pinpoint_html"
  | "batch4_html"
  | "jobvite_html"
  | "herp_html";

export interface HtmlFormReadOptions<P extends HtmlFormPath = HtmlFormPath> {
  /** The path recorded beside the questions, and the prefix of the form signature. */
  path: P;
  /** Canonical labels for the board's standard controls, keyed by their name. */
  labels?: ReadonlyMap<string, string>;
  /** Controls that are never application questions, in addition to the shared list. */
  skipNames?: ReadonlySet<string>;
}

export interface HtmlFormRead<P extends HtmlFormPath = HtmlFormPath> {
  questions: FormQuestion[];
  formSignature: string;
  path: P;
  unhandled: string[];
}

const DEFAULT_SKIPPED_NAMES: ReadonlySet<string> = new Set([
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

const NO_LABELS: ReadonlyMap<string, string> = new Map();

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
  placeholder: string;
  ariaLabel: string;
}

interface RawForm {
  controls: RawControl[];
  hasSubmit: boolean;
}

interface OpenGroup {
  labelIds: string[];
  legendId: string | null;
}

function cleanText(value: string) {
  return value.replaceAll(CLEAN_SPACE, " ").trim();
}

function cleanLabel(raw: string) {
  return cleanText(
    raw.replaceAll("*", "").replaceAll(/\((?:erforderlich|required|optional)\)/giu, ""),
  );
}

function canonicalLabel(
  labels: ReadonlyMap<string, string>,
  name: string,
  ownLabel: string,
  groupLabel: string,
  placeholder: string,
  ariaLabel: string,
) {
  const standard = labels.get(name);

  if (standard !== undefined) {
    return standard;
  }

  const cleaned = cleanLabel(ownLabel === "" ? groupLabel : ownLabel);

  if (cleaned !== "") {
    return cleaned;
  }

  const fromPlaceholder = cleanLabel(placeholder);
  const fromAria = cleanLabel(ariaLabel);

  if (fromPlaceholder !== "") {
    return fromPlaceholder;
  }

  return fromAria === "" ? name : fromAria;
}

function canonicalGroupLabel(
  labels: ReadonlyMap<string, string>,
  name: string,
  groupLabel: string,
) {
  const standard = labels.get(name);

  if (standard !== undefined) {
    return standard;
  }

  const cleaned = cleanLabel(groupLabel);

  return cleaned === "" ? name : cleaned;
}

function starred(texts: readonly string[]) {
  return texts.some((text) => REQUIRED_MARKER.test(text));
}

function toQuestion(
  control: RawControl,
  labelled: ReadonlyMap<string, string>,
  labels: ReadonlyMap<string, string>,
) {
  const groupLabel = control.groupLabelIds
    .map((id) => labelled.get(id) ?? "")
    .filter((text) => text !== "")
    .join(" ");

  const label = canonicalLabel(
    labels,
    control.name,
    control.ownLabel,
    groupLabel,
    control.placeholder,
    control.ariaLabel,
  );

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

function groupedQuestions(
  controls: readonly RawControl[],
  labelled: ReadonlyMap<string, string>,
  labels: ReadonlyMap<string, string>,
) {
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
        label: canonicalGroupLabel(labels, first.name, groupLabel),
        options: group.map((entry) => cleanLabel(entry.ownLabel) || entry.id),
        required:
          group.some((entry) => entry.required) ||
          starred(group.flatMap((entry) => [entry.ownLabel, groupLabel])),
      });

      continue;
    }

    questions.push(toQuestion(control, labelled, labels));
  }

  return questions;
}

/**
 * Parses a server-rendered application page. The form with a submit control wins;
 * the parser reads the same fields whatever the career site's language is, and
 * returns the employer's custom questions as they are labelled.
 *
 * @param rawHtml the server-rendered application page
 * @param options the board's path, label dictionary and extra skipped control names
 * @returns the form's questions, its signature, and any control it cannot fill
 */
export async function readHtmlForm<P extends HtmlFormPath>(
  rawHtml: string,
  options: HtmlFormReadOptions<P>,
) {
  const skipNames =
    options.skipNames === undefined
      ? DEFAULT_SKIPPED_NAMES
      : new Set([...DEFAULT_SKIPPED_NAMES, ...options.skipNames]);

  const labels = options.labels ?? NO_LABELS;
  const forms: RawForm[] = [];
  const formStack: RawForm[] = [];
  const groupStack: OpenGroup[] = [];
  const selectStack: RawControl[] = [];
  const labelled = new Map<string, string>();
  const labelStack: { controls: RawControl[]; id: string; text: string }[] = [];
  const idStack: { id: string; text: string }[] = [];
  const legendStack: { group: OpenGroup; text: string }[] = [];
  const unhandled: string[] = [];
  let legendCounter = 0;

  const currentForm = () => formStack.at(-1);

  const currentGroupLabelIds = () => [...(groupStack.at(-1)?.labelIds ?? [])];

  const pushControl = (control: RawControl) => {
    const form = currentForm();

    if (form === undefined) {
      return false;
    }

    form.controls.push(control);

    const label = labelStack.at(-1);

    if (label !== undefined) {
      label.controls.push(control);
    }

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
    .on("[role='group'], fieldset", {
      element(element) {
        legendCounter += 1;

        const legendId =
          element.tagName === "fieldset" ? `html-form-legend-${String(legendCounter)}` : null;

        const group: OpenGroup = {
          labelIds: (element.getAttribute("aria-labelledby") ?? "")
            .split(CLEAN_SPACE)
            .filter((id) => id !== ""),
          legendId,
        };

        if (legendId !== null) {
          group.labelIds.push(legendId);
          legendStack.push({ group, text: "" });
        }

        groupStack.push(group);

        element.onEndTag(() => {
          if (legendId !== null) {
            legendStack.pop();
          }

          groupStack.pop();
        });
      },
    })
    .on("legend", {
      element(element) {
        element.onEndTag(() => {
          const entry = legendStack.at(-1);

          if (entry !== undefined && entry.group.legendId !== null) {
            labelled.set(entry.group.legendId, cleanText(entry.text));
          }
        });
      },
      text(text) {
        const entry = legendStack.at(-1);

        if (entry !== undefined) {
          entry.text += text.text;
        }
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
        labelStack.push({ controls: [], id: element.getAttribute("for") ?? "", text: "" });

        element.onEndTag(() => {
          const entry = labelStack.pop();

          if (entry === undefined) {
            return;
          }

          const text = cleanText(entry.text);

          if (entry.id !== "") {
            labelled.set(entry.id, text);
          }

          for (const control of entry.controls) {
            if (control.ownLabel === "") {
              control.ownLabel = text;
            }
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
          ariaLabel: element.getAttribute("aria-label") ?? "",
          groupLabelIds: currentGroupLabelIds(),
          id: element.getAttribute("id") ?? "",
          multiple: element.hasAttribute("multiple"),
          name: element.getAttribute("name") ?? "",
          options: [],
          ownLabel: "",
          placeholder: "",
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
          ariaLabel: element.getAttribute("aria-label") ?? "",
          groupLabelIds: currentGroupLabelIds(),
          id: element.getAttribute("id") ?? "",
          multiple: false,
          name: element.getAttribute("name") ?? "",
          options: [],
          ownLabel: "",
          placeholder: element.getAttribute("placeholder") ?? "",
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

        if (name === "" || skipNames.has(name) || SILENT_INPUT_TYPES.has(type)) {
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
          ariaLabel: element.getAttribute("aria-label") ?? "",
          groupLabelIds: currentGroupLabelIds(),
          id: element.getAttribute("id") ?? "",
          multiple: element.hasAttribute("multiple"),
          name,
          options: [],
          ownLabel: "",
          placeholder: element.getAttribute("placeholder") ?? "",
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
      path: options.path,
      unhandled,
    } satisfies HtmlFormRead<P>;
  }

  const controls = chosen.controls.flatMap((control) => {
    if (control.name === "") {
      return [];
    }

    return [
      {
        ...control,
        ownLabel: control.ownLabel === "" ? (labelled.get(control.id) ?? "") : control.ownLabel,
      },
    ];
  });

  const questions = groupedQuestions(controls, labelled, labels).filter(
    (question) => question.fieldName !== "",
  );

  return {
    questions,
    formSignature:
      questions.length === 0 ? "" : formSignatureForHtmlQuestions(options.path, questions),
    path: options.path,
    unhandled,
  } satisfies HtmlFormRead<P>;
}

/**
 * A stable signature of one form's control names, namespaced by the read path so
 * two boards that reuse a field name never share a cached plan.
 *
 * @param path the form read path
 * @param questions the questions read from the form
 * @returns a short SHA-256 over the sorted field names
 */
export function formSignatureForHtmlQuestions(
  path: HtmlFormPath,
  questions: readonly Pick<FormQuestion, "fieldName">[],
) {
  return createHash("sha256")
    .update(
      `${path}\n${questions
        .map((question) => question.fieldName)
        .toSorted()
        .join("\n")}`,
    )
    .digest("hex")
    .slice(0, 16);
}
