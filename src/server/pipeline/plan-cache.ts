import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { FormQuestion } from "./send-plan.ts";
import type { FormReadPath } from "./form-read.ts";
import type { QuestionFieldType } from "../../shared/questions.ts";

import { planCache } from "../platform/db/schema.ts";
import { FORM_READ_PATHS } from "./form-read.ts";
import { QUESTION_FIELD_TYPES } from "../../shared/questions.ts";

const cachedQuestionSchema = z.object({
  questionId: z.string().min(1),
  label: z.string(),
  fieldName: z.string(),
  fieldType: z.enum(QUESTION_FIELD_TYPES),
  required: z.boolean(),
  options: z.array(z.string()),
  position: z.number().int().min(0),
});

const cachedPlanSchema = z.object({
  readPath: z.enum(FORM_READ_PATHS),
  questions: z.array(cachedQuestionSchema),
});

export interface CachedPlanQuestion {
  questionId: string;
  label: string;
  fieldName: string;
  fieldType: QuestionFieldType;
  required: boolean;
  options: string[];
  position: number;
}

export interface CachedPlan {
  readPath: FormReadPath;
  questions: CachedPlanQuestion[];
}

export interface PlanCacheEntry {
  id: string;
  plan: CachedPlan;
  hits: number;
  failures: number;
}

function sameQuestion(
  fresh: Pick<FormQuestion, "fieldName" | "label" | "fieldType" | "required" | "options">,
  cached: CachedPlanQuestion,
) {
  return (
    fresh.fieldName === cached.fieldName &&
    fresh.label === cached.label &&
    fresh.fieldType === cached.fieldType &&
    fresh.required === cached.required &&
    fresh.options.length === cached.options.length &&
    fresh.options.every((option, index) => option === cached.options[index])
  );
}

function matchQuestions(fresh: readonly FormQuestion[], cached: readonly CachedPlanQuestion[]) {
  if (fresh.length !== cached.length) {
    return null;
  }

  const pool = [...cached];
  const matched: CachedPlanQuestion[] = [];

  for (const question of fresh) {
    const index = pool.findIndex((candidate) => sameQuestion(question, candidate));

    if (index === -1) {
      return null;
    }

    const [entry] = pool.splice(index, 1);

    if (entry === undefined) {
      return null;
    }

    matched.push({ ...entry, position: matched.length });
  }

  return matched;
}

export function createPlanCache(deps: { db: AppDatabase; clock: Clock }) {
  const { db, clock } = deps;

  function get(ats: "lever" | "ashby" | "workable" | "personio", formSignature: string) {
    const row = db
      .select()
      .from(planCache)
      .where(and(eq(planCache.ats, ats), eq(planCache.formSignature, formSignature)))
      .get();

    if (row === undefined) {
      return null;
    }

    let json: unknown;

    try {
      json = JSON.parse(row.plan);
    } catch {
      return null;
    }

    const parsed = cachedPlanSchema.safeParse(json);

    if (!parsed.success) {
      return null;
    }

    return { failures: row.failures, hits: row.hits, id: row.id, plan: parsed.data };
  }

  function put(
    ats: "lever" | "ashby" | "workable" | "personio",
    formSignature: string,
    plan: CachedPlan,
  ) {
    const now = clock.now();

    db.insert(planCache)
      .values({
        ats,
        formSignature,
        hits: 0,
        failures: 0,
        id: crypto.randomUUID(),
        plan: JSON.stringify(plan),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        set: { failures: 0, hits: 0, plan: JSON.stringify(plan), updatedAt: now },
        target: [planCache.ats, planCache.formSignature],
      })
      .run();
  }

  function recordHit(id: string) {
    const row = db
      .select({ hits: planCache.hits })
      .from(planCache)
      .where(eq(planCache.id, id))
      .get();

    if (row === undefined) {
      return;
    }

    db.update(planCache)
      .set({ hits: row.hits + 1, updatedAt: clock.now() })
      .where(eq(planCache.id, id))
      .run();
  }

  function recordFailure(id: string) {
    const row = db
      .select({ failures: planCache.failures })
      .from(planCache)
      .where(eq(planCache.id, id))
      .get();

    if (row === undefined) {
      return;
    }

    db.update(planCache)
      .set({ failures: row.failures + 1, updatedAt: clock.now() })
      .where(eq(planCache.id, id))
      .run();
  }

  return { get, match: matchQuestions, put, recordFailure, recordHit };
}

export type PlanCache = ReturnType<typeof createPlanCache>;
