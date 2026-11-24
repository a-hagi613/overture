import { z } from "zod";

import type { FormQuestion } from "./send-plan.ts";
import type { QuestionFieldType } from "../../shared/questions.ts";

import { formSignatureForHtmlQuestions } from "./html-form.ts";

const jobviteOptionSchema = z.object({ key: z.string(), value: z.string() });

const jobviteFieldSchema = z.looseObject({
  fieldType: z.string(),
  multiSelect: z.boolean().optional(),
  name: z.string(),
  required: z.boolean().optional(),
  values: z.array(jobviteOptionSchema).optional(),
  viewFieldEId: z.union([z.string(), z.number()]).optional(),
  fieldId: z.union([z.string(), z.number()]).optional(),
});

const jobvitePrescreenFieldSchema = z.looseObject({
  fieldId: z.string(),
  fieldType: z.string(),
  multiSelect: z.boolean().optional(),
  name: z.string(),
  required: z.boolean().optional(),
  values: z.array(jobviteOptionSchema).optional(),
});

const jobvitePrescreenSchema = z.object({
  section: z.array(
    z.object({
      element: z.array(
        z.object({
          fields: z.array(jobvitePrescreenFieldSchema),
          required: z.boolean().optional(),
        }),
      ),
    }),
  ),
});

const formQuestionSchema = z.object({
  fieldName: z.string().min(1),
  fieldType: z.enum([
    "checkbox",
    "date",
    "email",
    "file",
    "multiselect",
    "number",
    "phone",
    "radio",
    "select",
    "text",
    "textarea",
    "url",
  ]),
  label: z.string().min(1),
  options: z.array(z.string()),
  required: z.boolean(),
});

const herpI18nFieldSchema = z.looseObject({
  ariaLabel: z.string().optional(),
  label: z.string().optional(),
});

function jsonValueAfter(source: string, marker: string) {
  const index = source.indexOf(marker);

  if (index === -1) {
    return null;
  }

  const startIndex = source.slice(index + marker.length).search(/[[{]/u) + index + marker.length;

  if (startIndex < index) {
    return null;
  }

  const open = source[startIndex];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let cursor = startIndex; cursor < source.length; cursor += 1) {
    const character = source[cursor];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;

      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(source.slice(startIndex, cursor + 1));

          return parsed;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function cleanLabel(raw: string) {
  return raw.replaceAll(/\s+/gu, " ").trim();
}

const JOBVITE_FIELD_TYPES = new Map<string, QuestionFieldType>([
  ["checkbox", "multiselect"],
  ["currency", "number"],
  ["date", "date"],
  ["dropdown", "select"],
  ["email", "email"],
  ["formattednumber", "number"],
  ["name", "text"],
  ["number", "number"],
  ["phone", "phone"],
  ["radio", "radio"],
  ["select", "select"],
  ["textarea", "textarea"],
  ["textbox", "textarea"],
]);

const jobviteFieldType = (raw: string) => JOBVITE_FIELD_TYPES.get(raw.toLowerCase()) ?? "text";

function jobviteQuestion(input: {
  fieldType: string;
  id: string;
  label: string;
  options: readonly string[];
  required: boolean;
}) {
  const fieldType = jobviteFieldType(input.fieldType);
  const label = cleanLabel(input.label);

  if (label === "" || input.id === "") {
    return null;
  }

  const fieldName =
    fieldType === "radio" || fieldType === "multiselect" ? input.id : `input-${input.id}`;

  return {
    fieldName,
    fieldType,
    label,
    options:
      fieldType === "radio" || fieldType === "select" || fieldType === "multiselect"
        ? [...input.options]
        : [],
    required: input.required,
  };
}

function uniqueQuestions(questions: readonly (FormQuestion | null)[]) {
  const seen = new Set<string>();
  const out: FormQuestion[] = [];

  for (const question of questions) {
    if (question === null || seen.has(question.fieldName)) {
      continue;
    }

    seen.add(question.fieldName);
    out.push(question);
  }

  return out;
}

/**
 * Reads a Jobvite apply page's embedded `preloadedData`: the main personal-information
 * fields and, when the employer has them, the pre-screening questions on the next step.
 *
 * @param rawHtml The apply page's first HTML response.
 * @returns The form's questions, its signature, its read path and any unsupported control.
 */
export function readJobviteFormHtml(rawHtml: string) {
  const applyFields = z.array(jobviteFieldSchema).safeParse(jsonValueAfter(rawHtml, "applyFields"));

  const prescreen = jobvitePrescreenSchema.safeParse(
    jsonValueAfter(rawHtml, "preScreeningFormFields"),
  );

  if (!applyFields.success || applyFields.data.length === 0) {
    return {
      questions: [],
      formSignature: "",
      path: "jobvite_html" as const,
      unhandled: [],
    };
  }

  const main = applyFields.data.map((field) => {
    const id = field.viewFieldEId ?? field.fieldId;

    if (id === undefined) {
      return null;
    }

    return jobviteQuestion({
      fieldType: field.fieldType,
      id: String(id),
      label: field.name,
      options: (field.values ?? []).map((option) => option.value),
      required: field.required === true,
    });
  });

  const screening = prescreen.success
    ? prescreen.data.section.flatMap((section) =>
        section.element.flatMap((element) =>
          element.fields.map((field) =>
            jobviteQuestion({
              fieldType: field.fieldType,
              id: field.fieldId,
              label: field.name,
              options: (field.values ?? []).map((option) => option.value),
              required: field.required === true || element.required === true,
            }),
          ),
        ),
      )
    : [];

  const questions = uniqueQuestions([...main, ...screening]);

  return {
    questions,
    formSignature:
      questions.length === 0 ? "" : formSignatureForHtmlQuestions("jobvite_html", questions),
    path: "jobvite_html" as const,
    unhandled: [],
  };
}

const herpPropsSchema = z.looseObject({
  applyForm: z.record(z.string(), z.string()).optional(),
  applyFormPage: z.boolean().optional(),
  i18n: z.object({ default: z.record(z.string(), herpI18nFieldSchema).optional() }).optional(),
});

interface HerpFieldSpec {
  configKey: string;
  fieldName: string;
  fieldType: QuestionFieldType;
  labelKey: string;
  required: boolean;
}

const HERP_FIELDS: readonly HerpFieldSpec[] = [
  { configKey: "name", fieldName: "name", fieldType: "text", labelKey: "name", required: true },
  { configKey: "email", fieldName: "email", fieldType: "email", labelKey: "email", required: true },
  {
    configKey: "telephoneNumber",
    fieldName: "telephoneNumber",
    fieldType: "phone",
    labelKey: "phone",
    required: false,
  },
  {
    configKey: "currentCompany",
    fieldName: "currentCompany",
    fieldType: "text",
    labelKey: "currentCompany",
    required: false,
  },
  { configKey: "age", fieldName: "age", fieldType: "text", labelKey: "age", required: false },
  {
    configKey: "education",
    fieldName: "education",
    fieldType: "text",
    labelKey: "education",
    required: false,
  },
  {
    configKey: "career",
    fieldName: "career",
    fieldType: "textarea",
    labelKey: "workExpirences",
    required: false,
  },
  {
    configKey: "currentAnnualSalary",
    fieldName: "currentAnnualSalary",
    fieldType: "text",
    labelKey: "currentAnnualSalary",
    required: false,
  },
  {
    configKey: "minDesiredSalary",
    fieldName: "minDesiredSalary",
    fieldType: "text",
    labelKey: "minDesiredSalary",
    required: false,
  },
  {
    configKey: "desiredSalary",
    fieldName: "desiredSalary",
    fieldType: "text",
    labelKey: "desiredSalary",
    required: false,
  },
  {
    configKey: "messageToCompany",
    fieldName: "messageToCompany",
    fieldType: "textarea",
    labelKey: "message",
    required: false,
  },
  {
    configKey: "links",
    fieldName: "links",
    fieldType: "url",
    labelKey: "website",
    required: false,
  },
  {
    configKey: "dateOfBirth",
    fieldName: "dateOfBirth",
    fieldType: "date",
    labelKey: "dateOfBirth",
    required: false,
  },
  {
    configKey: "namePronunciation",
    fieldName: "namePronunciation",
    fieldType: "text",
    labelKey: "namePronunciation",
    required: false,
  },
  {
    configKey: "additionalRequirements",
    fieldName: "additionalRequirements",
    fieldType: "textarea",
    labelKey: "additionalRequirements",
    required: false,
  },
];

const HERP_FILE_FIELDS: readonly HerpFieldSpec[] = [
  {
    configKey: "resume",
    fieldName: "resumes",
    fieldType: "file",
    labelKey: "resume",
    required: false,
  },
  {
    configKey: "careerSummaries",
    fieldName: "careerSummaries",
    fieldType: "file",
    labelKey: "cv",
    required: false,
  },
  {
    configKey: "otherFile",
    fieldName: "otherFiles",
    fieldType: "file",
    labelKey: "otherFiles",
    required: false,
  },
];

/**
 * Reads a HERP apply page's embedded React props: the employer's visible fields and
 * the locale's own labels. HERP's privacy consent is always on the form.
 *
 * @param rawHtml The apply page's first HTML response.
 * @returns The form's questions, its signature, its read path and any unsupported control.
 */
export function readHerpFormHtml(rawHtml: string) {
  const parsed = herpPropsSchema.safeParse(jsonValueAfter(rawHtml, 'id="herp-react-props"'));

  if (!parsed.success || parsed.data.applyFormPage !== true) {
    return {
      questions: [],
      formSignature: "",
      path: "herp_html" as const,
      unhandled: [],
    };
  }

  const applyForm = parsed.data.applyForm ?? {};
  const labels = parsed.data.i18n?.default ?? {};

  const labelFor = (key: string) => cleanLabel(labels[key]?.label ?? labels[key]?.ariaLabel ?? "");

  const visible = (configKey: string) =>
    configKey === "name" || configKey === "email" || applyForm[configKey] === "visible";

  const questions: FormQuestion[] = [];

  for (const field of [...HERP_FIELDS, ...HERP_FILE_FIELDS]) {
    if (!visible(field.configKey)) {
      continue;
    }

    const label = labelFor(field.labelKey);

    if (label === "") {
      continue;
    }

    questions.push({
      fieldName: field.fieldName,
      fieldType: field.fieldType,
      label,
      options: [],
      required: field.required,
    });
  }

  const privacyLabel = cleanLabel(labels["privacyPolicy"]?.ariaLabel ?? "");

  if (privacyLabel !== "") {
    questions.push({
      fieldName: "privacyPolicy",
      fieldType: "checkbox",
      label: privacyLabel,
      options: [],
      required: true,
    });
  }

  return {
    questions: z.array(formQuestionSchema).parse(questions),
    formSignature:
      questions.length === 0 ? "" : formSignatureForHtmlQuestions("herp_html", questions),
    path: "herp_html" as const,
    unhandled: [],
  };
}
