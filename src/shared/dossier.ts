import { z } from "zod";

export const TRACE_SOURCES = ["fact", "resume", "typed", "none"] as const;

export const DID_NOT_HAPPEN_KEYS = ["file_not_changed", "nothing_invented"] as const;

export const dossierResumeLineSchema = z.object({ id: z.string(), text: z.string() });

export const traceRowSchema = z.object({
  factKey: z.string().nullable(),
  factRevision: z.number().nullable(),
  label: z.string().nullable(),
  resumeLines: z.array(dossierResumeLineSchema),
  source: z.enum(TRACE_SOURCES),
  text: z.string(),
});

export const dossierSchema = z.object({
  didNotHappen: z.array(z.enum(DID_NOT_HAPPEN_KEYS)),
  factsTrace: z.object({
    answers: z.array(traceRowSchema),
    letter: z.array(traceRowSchema),
  }),
  file: z
    .object({
      bytes: z.number(),
      filename: z.string(),
      sentUnchanged: z.boolean(),
      sha256: z.string(),
    })
    .nullable(),
  sentVia: z.object({
    confirmedBy: z.enum(["page", "email"]),
    provider: z.string(),
    submittedAt: z.number(),
  }),
});

export type Dossier = z.infer<typeof dossierSchema>;

export type TraceRow = z.infer<typeof traceRowSchema>;

export type DidNotHappenKey = (typeof DID_NOT_HAPPEN_KEYS)[number];

export interface DossierAnswer {
  answer: string | null;
  by_user?: boolean | undefined;
  fact_key: string | null;
  fact_revision: number | null;
  kind: string;
  label: string;
  question_id: string;
  resume_line_ids: string[];
}

export interface DossierLetterLine {
  by_user?: boolean | undefined;
  resume_line_ids: string[];
  sentence: string;
}

export type DossierResumeLine = z.infer<typeof dossierResumeLineSchema>;

export interface DossierInput {
  answers: DossierAnswer[];
  coverLetter: DossierLetterLine[] | null;
  confirmedBy: "page" | "email";
  provider: string;
  resumeLines: DossierResumeLine[];
  resume: { bytes: number; filename: string; sha256: string } | null;
  resumeSha256: string;
  submittedAt: number;
}

function pickLines(ids: string[], resumeLines: DossierResumeLine[]) {
  return resumeLines.filter((line) => ids.includes(line.id));
}

function sourceOf(citesResume: boolean, typed: boolean) {
  if (citesResume) {
    return "resume" as const;
  }

  return typed ? ("typed" as const) : ("none" as const);
}

function answerRow(answer: DossierAnswer, resumeLines: DossierResumeLine[]) {
  const lines = pickLines(answer.resume_line_ids, resumeLines);
  const factKey = answer.fact_key;

  if (factKey !== null && !factKey.startsWith("q:")) {
    return {
      factKey,
      factRevision: answer.fact_revision,
      label: answer.label,
      resumeLines: lines,
      source: "fact" as const,
      text: answer.answer ?? "",
    };
  }

  return {
    factKey: null,
    factRevision: null,
    label: answer.label,
    resumeLines: lines,
    source: sourceOf(lines.length > 0, answer.by_user === true || factKey !== null),
    text: answer.answer ?? "",
  };
}

function letterRow(line: DossierLetterLine, resumeLines: DossierResumeLine[]) {
  const lines = pickLines(line.resume_line_ids, resumeLines);

  return {
    factKey: null,
    factRevision: null,
    label: null,
    resumeLines: lines,
    source: sourceOf(lines.length > 0, line.by_user === true),
    text: line.sentence,
  };
}

export function buildDossier(input: DossierInput) {
  const answers = input.answers
    .filter((answer) => answer.kind !== "file")
    .map((answer) => answerRow(answer, input.resumeLines));

  const letter = (input.coverLetter ?? []).map((line) => letterRow(line, input.resumeLines));
  const traced: TraceRow[] = [...answers, ...letter];

  const file =
    input.resume === null
      ? null
      : {
          bytes: input.resume.bytes,
          filename: input.resume.filename,
          sentUnchanged: input.resume.sha256 === input.resumeSha256,
          sha256: input.resume.sha256,
        };

  const didNotHappen: DidNotHappenKey[] = [];

  if (file?.sentUnchanged === true) {
    didNotHappen.push("file_not_changed");
  }

  if (traced.length > 0 && traced.every((row) => row.source !== "none")) {
    didNotHappen.push("nothing_invented");
  }

  return {
    didNotHappen,
    factsTrace: { answers, letter },
    file,
    sentVia: {
      confirmedBy: input.confirmedBy,
      provider: input.provider,
      submittedAt: input.submittedAt,
    },
  };
}
