import type { FactRecord } from "../profile/facts.ts";
import type { Targets } from "../../shared/targets.ts";
import type { DerivationFact, PostingPlace } from "../catalog/answer-derivations.ts";
import type { AnswerKind, QuestionFieldType } from "../../shared/questions.ts";
import type { AnswerUnit, FileFact } from "./answer-value.ts";

import { isCountryScopedFactKey } from "../../shared/facts.ts";
import { resolveLocation } from "../catalog/geo.ts";
import {
  countriesNamedIn,
  normalizeQuestionText,
  referencesUserCountry,
} from "../catalog/question-normalize.ts";
import {
  deriveAnswer,
  isDerivationKey,
  isTargetDerivationKey,
} from "../catalog/answer-derivations.ts";
import { acknowledgementOption, answerIsValid, formatFactValue } from "./answer-value.ts";

export type BlockReason =
  | "missing_fact"
  | "option_mismatch"
  | "type_mismatch"
  | "non_standard_consent"
  | "file_unavailable"
  | "unsupported_field"
  | "optional_unfilled"
  | "marketing_opt_in"
  | "open_text_ungrounded";

export type AnswerSource = "fact" | "consent" | "file" | "open_text" | "target" | "derived";

export interface PlanAnswer {
  kind: "answer";
  value: string | null;
  source: AnswerSource;
  file: FileFact | null;
  unit: AnswerUnit | null;
  scope: string;
  factRevision: number | null;
}

export interface PlanBlank {
  kind: "blank";
  reason: BlockReason;
  file: FileFact | null;
}

export interface PlanBlocked {
  kind: "blocked";
  reason: BlockReason;
  scope: string;
  file: FileFact | null;
}

export type PlanResolution = PlanAnswer | PlanBlank | PlanBlocked;

interface ScopedFactEntry {
  scope: string;
  value: string;
  revision: number;
}

export interface FactIndex {
  unscoped: ReadonlyMap<string, string>;
  scoped: ReadonlyMap<string, ReadonlyMap<string, string>>;
  all: ReadonlyMap<string, readonly ScopedFactEntry[]>;
  revisions: ReadonlyMap<string, number>;
  details: ReadonlyMap<string, DerivationFact>;
}

function revisionKey(key: string, scope: string) {
  return `${key}\u0000${scope}`;
}

export function indexFacts(records: readonly FactRecord[]) {
  const unscoped = new Map<string, string>();
  const scoped = new Map<string, Map<string, string>>();
  const all = new Map<string, ScopedFactEntry[]>();
  const revisions = new Map<string, number>();
  const details = new Map<string, DerivationFact>();

  for (const record of records) {
    if (record.scope === "") {
      unscoped.set(record.key, record.value);
      details.set(record.key, { value: record.value, confirmed: record.confirmed });
    } else {
      const byScope = scoped.get(record.key) ?? new Map<string, string>();

      byScope.set(record.scope, record.value);
      scoped.set(record.key, byScope);
    }

    const entries = all.get(record.key) ?? [];

    entries.push({ scope: record.scope, value: record.value, revision: record.revision });
    all.set(record.key, entries);
    revisions.set(revisionKey(record.key, record.scope), record.revision);
  }

  return { unscoped, scoped, all, revisions, details } satisfies FactIndex;
}

function revisionFor(facts: FactIndex, key: string, scope: string) {
  return facts.revisions.get(revisionKey(key, scope)) ?? null;
}

type QuestionScope = { kind: "country"; code: string } | { kind: "multiple" } | { kind: "generic" };

type ScopedLookup =
  | { kind: "answer"; value: string; scope: string; revision: number | null }
  | { kind: "review"; scope: string };

function questionScope(questionText: string, facts: FactIndex) {
  const named = countriesNamedIn(questionText);

  if (named.length > 1) {
    return { kind: "multiple" } satisfies QuestionScope;
  }

  const [code] = named;

  if (code !== undefined) {
    return { kind: "country", code } satisfies QuestionScope;
  }

  if (referencesUserCountry(questionText)) {
    const resident = facts.unscoped.get("current_country");
    const countryCode = resident === undefined ? null : resolveLocation(resident).countryCode;

    if (countryCode !== null) {
      return { kind: "country", code: countryCode } satisfies QuestionScope;
    }
  }

  return { kind: "generic" } satisfies QuestionScope;
}

function lookupScopedFact(key: string, questionText: string, facts: FactIndex) {
  const scope = questionScope(questionText, facts);

  if (scope.kind === "country") {
    const value = facts.scoped.get(key)?.get(scope.code);
    const revision = revisionFor(facts, key, scope.code);

    return value === undefined || revision === null
      ? ({ kind: "review", scope: scope.code } satisfies ScopedLookup)
      : ({ kind: "answer", value, scope: scope.code, revision } satisfies ScopedLookup);
  }

  const unscoped = facts.unscoped.get(key);
  const unscopedRevision = revisionFor(facts, key, "");

  if (unscoped !== undefined && unscopedRevision !== null) {
    return {
      kind: "answer",
      value: unscoped,
      scope: "",
      revision: unscopedRevision,
    } satisfies ScopedLookup;
  }

  if (scope.kind === "multiple") {
    return { kind: "review", scope: "" } satisfies ScopedLookup;
  }

  const values = new Set((facts.all.get(key) ?? []).map((entry) => entry.value));
  const [only] = [...values];

  if (values.size === 1 && only !== undefined) {
    return { kind: "answer", value: only, scope: "", revision: null } satisfies ScopedLookup;
  }

  return { kind: "review", scope: "" } satisfies ScopedLookup;
}

const MARKETING_CONSENT =
  /\b(?:marketing|newsletter|promotions?|job alerts|talent pool|future opportunities|whatsapp|sms|text messages|opt[- ]?in)\b/u;

const STANDARD_CONSENTS: readonly RegExp[] = [
  /\b(?:candidate|job applicant|applicant|employee)?\s*privacy (?:notice|policy|statement)\b/u,
  /\bdata processing (?:notice|agreement|acknowledg(?:e)?ment|consent)\b/u,
  /\b(?:personal )?data (?:processing|protection)\b/u,
  /\bterms (?:of (?:use|service)|and conditions)\b/u,
  /\bdouble[- ]?check (?:all )?the information\b/u,
  /\b(?:all )?(?:the )?information (?:provided )?(?:above )?(?:is|was) (?:accurate|complete|true)\b/u,
];

const RESUME_QUESTION = /\b(?:resume|cv|curriculum vitae)\b/u;

const COVER_LETTER_QUESTION = /\bcover letter\b/u;

export function classifyConsent(questionText: string) {
  const normalized = normalizeQuestionText(questionText);

  if (MARKETING_CONSENT.test(normalized)) {
    return "marketing";
  }

  return STANDARD_CONSENTS.some((pattern) => pattern.test(normalized))
    ? "standard"
    : "non_standard";
}

const SKIP_BLOCKS: ReadonlySet<BlockReason> = new Set([
  "non_standard_consent",
  "file_unavailable",
  "unsupported_field",
]);

export function isUnsupportedBlock(reason: BlockReason) {
  return SKIP_BLOCKS.has(reason);
}

function answer(
  value: string | null,
  source: AnswerSource,
  input: {
    file?: FileFact | null;
    unit?: AnswerUnit | null;
    scope?: string;
    factRevision?: number | null;
  } = {},
) {
  return {
    kind: "answer",
    value,
    source,
    file: input.file ?? null,
    unit: input.unit ?? null,
    scope: input.scope ?? "",
    factRevision: input.factRevision ?? null,
  } satisfies PlanAnswer;
}

function blank(reason: BlockReason, file: FileFact | null = null) {
  return { kind: "blank", reason, file } satisfies PlanBlank;
}

function blocked(reason: BlockReason, scope = "", file: FileFact | null = null) {
  return { kind: "blocked", reason, scope, file } satisfies PlanBlocked;
}

export interface ResolveInput {
  questionText: string;
  required: boolean;
  fieldType: QuestionFieldType;
  options: readonly string[];
  answerKind: AnswerKind;
  factKey: string | null;
  facts: FactIndex;
  targets: Targets;
  posting: PostingPlace;
  hasResume: boolean;
  hasCoverLetter: boolean;
}

function resolveFile(input: ResolveInput) {
  const normalized = normalizeQuestionText(input.questionText);

  let file: FileFact | null = null;

  if (RESUME_QUESTION.test(normalized)) {
    file = "resume";
  } else if (COVER_LETTER_QUESTION.test(normalized)) {
    file = "cover_letter";
  }

  if (file === null) {
    return input.required ? blocked("unsupported_field") : blank("unsupported_field");
  }

  const available = file === "resume" ? input.hasResume : input.hasCoverLetter;

  if (available) {
    return answer(null, "file", { file });
  }

  return input.required ? blocked("file_unavailable", "", file) : blank("file_unavailable", file);
}

function resolveConsent(input: ResolveInput) {
  const verdict = classifyConsent(input.questionText);

  if (verdict === "marketing") {
    return input.required ? blocked("non_standard_consent") : blank("marketing_opt_in");
  }

  if (verdict === "non_standard") {
    return input.required ? blocked("non_standard_consent") : blank("non_standard_consent");
  }

  const option =
    acknowledgementOption(input.questionText, input.options) ??
    (input.fieldType === "checkbox" && input.options.length === 0 ? "Yes" : null);

  if (option !== null) {
    return answer(option, "consent");
  }

  return input.required ? blocked("unsupported_field") : blank("optional_unfilled");
}

function resolveDerivation(input: ResolveInput) {
  const key = input.factKey;

  if (
    key === null ||
    !isDerivationKey(key) ||
    (input.answerKind === "target") !== isTargetDerivationKey(key)
  ) {
    return input.required ? blocked("missing_fact") : blank("optional_unfilled");
  }

  const derived = deriveAnswer(key, {
    questionText: input.questionText,
    fieldType: input.fieldType,
    options: input.options,
    targets: input.targets,
    posting: input.posting,
    facts: input.facts.details,
  });

  if (derived !== null && answerIsValid(input.fieldType, input.options, derived)) {
    return answer(derived, input.answerKind === "target" ? "target" : "derived");
  }

  return input.required
    ? blocked(formatBlockReason(input.fieldType), "")
    : blank("optional_unfilled");
}

function resolveFact(input: ResolveInput) {
  if (input.factKey === null) {
    return input.required ? blocked("missing_fact") : blank("optional_unfilled");
  }

  const scoped = isCountryScopedFactKey(input.factKey)
    ? lookupScopedFact(input.factKey, input.questionText, input.facts)
    : null;

  if (scoped?.kind === "review") {
    return input.required ? blocked("missing_fact", scoped.scope) : blank("optional_unfilled");
  }

  const value = scoped?.kind === "answer" ? scoped.value : input.facts.unscoped.get(input.factKey);

  if (value === undefined) {
    return input.required ? blocked("missing_fact") : blank("optional_unfilled");
  }

  const scope = scoped?.kind === "answer" ? scoped.scope : "";

  const factRevision =
    scoped?.kind === "answer" ? scoped.revision : revisionFor(input.facts, input.factKey, "");

  const formatted = formatFactValue({
    questionText: input.questionText,
    factKey: input.factKey,
    fieldType: input.fieldType,
    options: input.options,
    value,
  });

  if (formatted === null || !answerIsValid(input.fieldType, input.options, formatted.value)) {
    return input.required
      ? blocked(formatBlockReason(input.fieldType), scope)
      : blank("optional_unfilled");
  }

  return answer(formatted.value, "fact", {
    unit: formatted.unit,
    scope,
    factRevision,
  });
}

function formatBlockReason(fieldType: QuestionFieldType) {
  return fieldType === "select" ||
    fieldType === "radio" ||
    fieldType === "checkbox" ||
    fieldType === "multiselect"
    ? "option_mismatch"
    : "type_mismatch";
}

export function resolveQuestion(input: ResolveInput) {
  if (input.fieldType === "file") {
    return resolveFile(input);
  }

  if (input.answerKind === "consent") {
    return resolveConsent(input);
  }

  if (input.answerKind === "skip") {
    return input.required ? blocked("unsupported_field") : blank("marketing_opt_in");
  }

  if (input.answerKind === "target" || input.answerKind === "derived") {
    return resolveDerivation(input);
  }

  if (input.answerKind !== "fact") {
    return input.required ? blocked("missing_fact") : blank("optional_unfilled");
  }

  return resolveFact(input);
}
