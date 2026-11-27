import { createHash } from "node:crypto";

import type { FormQuestion } from "./send-plan.ts";
import type { QuestionFieldType } from "../../shared/questions.ts";
import { BATCH_1_ATS } from "../../shared/ats.ts";

import type { ApplySupportedAts } from "../../shared/ats.ts";

/**
 * The Batch 1 boards whose application form is server-rendered, so preparation
 * can read it over plain HTTP the same way it reads Lever or Personio
 * (docs/SPEC.md §8.3).
 */
export type Batch1Ats = (typeof BATCH_1_ATS)[number];

export const HOSTED_FORM_PATHS = BATCH_1_ATS.map((ats) => `${ats}_html` as const);

export type HostedFormPath = (typeof HOSTED_FORM_PATHS)[number];

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
const REQUIRED_MARKER = /(?:\*|\brequired\b)/iu;

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
  ariaLabel: string;
  ariaLabelledBy: string[];
  groupLabel: string;
  id: string;
  name: string;
  required: boolean;
  tag: "input" | "select" | "textarea";
  type: string;
  options: RawOption[];
  ownLabel: string;
}

interface RawForm {
  controls: RawControl[];
  hasSubmit: boolean;
}

function cleanText(value: string) {
  return value.replaceAll(CLEAN_SPACE, " ").trim();
}

function cleanLabel(raw: string) {
  return cleanText(raw.replaceAll("*", "").replaceAll(/\((?:required|optional)\)/giu, ""));
}

function canonicalLabel(control: RawControl, labelled: ReadonlyMap<string, string>) {
  const labelledBy = control.ariaLabelledBy
    .map((id) => labelled.get(id) ?? "")
    .filter((text) => text !== "")
    .join(" ");

  const label = [control.ariaLabel, labelledBy, control.ownLabel, labelled.get(control.id)]
    .map((text) => cleanLabel(text ?? ""))
    .find((text) => text !== "");

  return label ?? control.name;
}

function toQuestion(control: RawControl, labelled: ReadonlyMap<string, string>) {
  const label = canonicalLabel(control, labelled);
  const required = control.required || REQUIRED_MARKER.test(control.ownLabel);

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

      const options = group.map(
        (entry) =>
          cleanLabel(entry.ownLabel) || cleanLabel(labelled.get(entry.id) ?? "") || entry.id,
      );

      questions.push({
        fieldName: first.name,
        fieldType: control.type === "radio" ? "radio" : "multiselect",
        label: cleanLabel(first.groupLabel) || canonicalLabel(first, labelled),
        options,
        required: group.some((entry) => entry.required),
      });

      continue;
    }

    questions.push(toQuestion(control, labelled));
  }

  return questions;
}

export interface HostedFormRead {
  questions: FormQuestion[];
  formSignature: string;
  path: HostedFormPath;
  unhandled: string[];
  /** True when the page carried a recognisable form, even with no questions. */
  formLoaded?: boolean;
}

const pathFor: (ats: Batch1Ats) => HostedFormPath = (ats) => `${ats}_html`;

/**
 * Parses a Batch 1 board's server-rendered application page. The form with a
 * submit control and the most controls wins, so a cookie banner or newsletter
 * form is never mistaken for the application form.
 *
 * @param ats The board the page belongs to.
 * @param rawHtml The server-rendered apply page.
 * @returns the form's questions, its signature, its read path, and any control it cannot fill
 */
export const readHostedFormHtml: (
  ats: Batch1Ats,
  rawHtml: string,
) => Promise<HostedFormRead> = async (ats, rawHtml) => {
  const forms: RawForm[] = [];
  const formStack: RawForm[] = [];
  const selectStack: RawControl[] = [];
  const labelled = new Map<string, string>();
  const labelStack: { controls: RawControl[]; forId: string; text: string }[] = [];
  const idStack: { id: string; text: string }[] = [];
  const fieldsetStack: { legend: string }[] = [];
  const legendStack: { text: string }[] = [];
  const unhandled: string[] = [];

  const currentForm = () => formStack.at(-1);

  const currentGroupLabel = () => fieldsetStack.at(-1)?.legend ?? "";

  const pushControl = (control: RawControl) => {
    const form = currentForm();

    if (form === undefined) {
      return false;
    }

    form.controls.push(control);

    const wrapping = labelStack.at(-1);

    if (wrapping !== undefined) {
      wrapping.controls.push(control);
    }

    return true;
  };

  const currentWrappingLabel = () => {
    const entry = labelStack.at(-1);

    return entry?.forId === "" ? entry.text : "";
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
        labelStack.push({ controls: [], forId: element.getAttribute("for") ?? "", text: "" });

        element.onEndTag(() => {
          const entry = labelStack.pop();

          if (entry === undefined) {
            return;
          }

          for (const control of entry.controls) {
            if (control.ownLabel === "") {
              control.ownLabel = cleanText(entry.text);
            }
          }

          if (entry.forId !== "") {
            labelled.set(entry.forId, cleanText(entry.text));
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
    .on("fieldset", {
      element(element) {
        const group = { legend: "" };

        fieldsetStack.push(group);

        element.onEndTag(() => {
          fieldsetStack.pop();
        });
      },
    })
    .on("legend", {
      element(element) {
        legendStack.push({ text: "" });

        element.onEndTag(() => {
          const entry = legendStack.pop();
          const group = fieldsetStack.at(-1);

          if (entry !== undefined && group !== undefined) {
            group.legend = cleanText(entry.text);
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
    .on("select", {
      element(element) {
        const control: RawControl = {
          ariaLabel: element.getAttribute("aria-label") ?? "",
          ariaLabelledBy: (element.getAttribute("aria-labelledby") ?? "")
            .split(CLEAN_SPACE)
            .filter((id) => id !== ""),
          groupLabel: currentGroupLabel(),
          id: element.getAttribute("id") ?? "",
          name: element.getAttribute("name") ?? "",
          options: [],
          ownLabel: currentWrappingLabel(),
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
          ariaLabelledBy: (element.getAttribute("aria-labelledby") ?? "")
            .split(CLEAN_SPACE)
            .filter((id) => id !== ""),
          groupLabel: currentGroupLabel(),
          id: element.getAttribute("id") ?? "",
          name: element.getAttribute("name") ?? "",
          options: [],
          ownLabel: currentWrappingLabel(),
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

        if (name === "" || SILENT_INPUT_TYPES.has(type)) {
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
          ariaLabelledBy: (element.getAttribute("aria-labelledby") ?? "")
            .split(CLEAN_SPACE)
            .filter((id) => id !== ""),
          groupLabel: currentGroupLabel(),
          id: element.getAttribute("id") ?? "",
          name,
          options: [],
          ownLabel: currentWrappingLabel(),
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
      formLoaded: false,
      questions: [],
      formSignature: "",
      path: pathFor(ats),
      unhandled,
    } satisfies HostedFormRead;
  }

  const questions = groupedQuestions(
    chosen.controls.filter((control) => control.name !== ""),
    labelled,
  );

  return {
    formLoaded: true,
    questions,
    formSignature: questions.length === 0 ? "" : formSignatureForHostedQuestions(ats, questions),
    path: pathFor(ats),
    unhandled,
  } satisfies HostedFormRead;
};

export function formSignatureForHostedQuestions(
  ats: Batch1Ats,
  questions: readonly Pick<FormQuestion, "fieldName">[],
) {
  return createHash("sha256")
    .update(
      `${ats}_html\n${questions
        .map((question) => question.fieldName)
        .toSorted()
        .join("\n")}`,
    )
    .digest("hex")
    .slice(0, 16);
}

/**
 * The board a hosted read belongs to.
 *
 * @param ats The ATS value from the posting.
 * @returns whether the plain HTTP reader can read the board's form.
 */
export function isHostedFormAts(ats: ApplySupportedAts): ats is Batch1Ats {
  return BATCH_1_ATS.some((candidate) => candidate === ats);
}
