import { z } from "zod";

import { FeedError } from "./board-feed.ts";
import { GREENHOUSE_DEFAULT_BASE_URL, GREENHOUSE_LIMITS } from "./greenhouse-feed.ts";
import { limiterFor } from "./rate-limiter.ts";

export interface AtsQuestionValue {
  label: string;
}

export interface AtsQuestionField {
  name: string;
  type: string;
  values: AtsQuestionValue[];
}

export interface AtsQuestion {
  label: string;
  required: boolean;
  fields: AtsQuestionField[];
}

export interface QuestionSource {
  fetchQuestions: (boardToken: string, atsJobId: string) => Promise<AtsQuestion[]>;
}

const questionValueSchema = z.object({
  label: z.string().nullish().default(""),
});

const questionFieldSchema = z.object({
  name: z.string().nullish().default(""),
  type: z.string().nullish().default(""),
  values: z.array(questionValueSchema).nullish().default([]),
});

const questionSchema = z.object({
  label: z.string().nullish().default(""),
  required: z.boolean().nullish().default(false),
  fields: z.array(questionFieldSchema).nullish().default([]),
});

const questionsResponseSchema = z.object({
  id: z.union([z.number(), z.string()]),
  questions: z.array(questionSchema).nullish().default([]),
});

type QuestionsFetcher = (url: string) => Promise<{ status: number; json: unknown }>;

const DEFAULT_FETCHER: QuestionsFetcher = async (url) => {
  const response = await fetch(url);

  if (response.status === 404) {
    return { status: 404, json: null };
  }

  if (!response.ok) {
    throw new FeedError(response.status, url);
  }

  return { status: response.status, json: await response.json() };
};

export function createGreenhouseQuestionSource(
  baseUrl: string = GREENHOUSE_DEFAULT_BASE_URL,
  fetcher: QuestionsFetcher = DEFAULT_FETCHER,
) {
  const limiter = limiterFor("greenhouse", GREENHOUSE_LIMITS);

  const fetchQuestions = async (boardToken: string, atsJobId: string) => {
    const url = `${baseUrl}/v1/boards/${boardToken}/jobs/${atsJobId}?questions=true`;

    const response = await limiter.run(async () => fetcher(url));

    if (response.status === 404) {
      return [];
    }

    const parsed = questionsResponseSchema.parse(response.json);

    return (parsed.questions ?? [])
      .map((question) => ({
        label: (question.label ?? "").trim(),
        required: question.required ?? false,
        fields: (question.fields ?? []).map((field) => ({
          name: field.name ?? "",
          type: field.type ?? "",
          values: (field.values ?? []).map((value) => ({ label: value.label ?? "" })),
        })),
      }))
      .filter((question) => question.label !== "");
  };

  return { fetchQuestions } satisfies QuestionSource;
}
