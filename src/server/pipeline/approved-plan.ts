import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";

import { applications, facts, resumes } from "../platform/db/schema.ts";
import { logError } from "../platform/log.ts";
import { sendPlanSchema } from "./send-plan.ts";

import type { PlannedSentence, SendPlan, SendPlanField } from "./send-plan.ts";

export interface ApprovedPlan {
  approvedAt: number;
  plan: SendPlan;
  sha256: string;
}

function sentenceJson(sentence: PlannedSentence) {
  return sentence.byUser === true
    ? { byUser: true, resumeLineIds: sentence.resumeLineIds, sentence: sentence.sentence }
    : { resumeLineIds: sentence.resumeLineIds, sentence: sentence.sentence };
}

function fieldJson(field: SendPlanField) {
  return {
    answer: field.answer,
    answerKind: field.answerKind,
    block: field.block,
    factKey: field.factKey,
    factRevision: field.factRevision,
    fieldName: field.fieldName,
    fieldType: field.fieldType,
    file: field.file,
    label: field.label,
    options: field.options,
    questionId: field.questionId,
    required: field.required,
    scope: field.scope,
    sentences: field.sentences.map((sentence) => sentenceJson(sentence)),
    source: field.source,
    unit:
      field.unit === null
        ? null
        : {
            currency: field.unit.currency,
            period: field.unit.period,
          },
  };
}

export function canonicalPlanJson(plan: SendPlan) {
  return JSON.stringify({
    applicationId: plan.applicationId,
    ats: plan.ats,
    atsJobId: plan.atsJobId,
    boardToken: plan.boardToken,
    companyName: plan.companyName,
    consentVersion: plan.consentVersion,
    coverLetter:
      plan.coverLetter === null ? null : plan.coverLetter.map((sentence) => sentenceJson(sentence)),
    descriptionHash: plan.descriptionHash,
    fields: plan.fields.map((field) => fieldJson(field)),
    postingTitle: plan.postingTitle,
    postingUrl: plan.postingUrl,
    resume:
      plan.resume === null
        ? null
        : {
            filename: plan.resume.filename,
            id: plan.resume.id,
            sha256: plan.resume.sha256,
          },
    userId: plan.userId,
  });
}

export function sendPlanSha256(plan: SendPlan) {
  return createHash("sha256").update(canonicalPlanJson(plan)).digest("hex");
}

export function approvedPlanScope(applicationId: string) {
  return { column: "approved_plan_enc", rowId: applicationId, table: "applications" } as const;
}

export async function sealApprovedPlan(input: {
  applicationId: string;
  personal: PersonalCrypto;
  plan: SendPlan;
}) {
  const sha256 = sendPlanSha256(input.plan);

  const enc = await input.personal.sealFor(
    input.plan.userId,
    approvedPlanScope(input.applicationId),
    canonicalPlanJson(input.plan),
  );

  return { enc, sha256 };
}

export async function openApprovedPlan(input: {
  applicationId: string;
  db: AppDatabase;
  personal: PersonalCrypto;
  userId: string;
}) {
  const opened = await openApprovedPlans({
    applicationIds: [input.applicationId],
    db: input.db,
    personal: input.personal,
    userId: input.userId,
  });

  return opened.get(input.applicationId) ?? null;
}

/**
 * Opens the approved plans of several Applications in one read, so a list of
 * approved cards costs one query rather than one per card. A plan that fails
 * to open or verify is left out, exactly as the single-plan read returns null.
 * @param input The Applications, the database and the user's crypto.
 * @returns The opened plans by Application id.
 */
export async function openApprovedPlans(input: {
  applicationIds: readonly string[];
  db: AppDatabase;
  personal: PersonalCrypto;
  userId: string;
}) {
  const opened = new Map<string, ApprovedPlan>();

  if (input.applicationIds.length === 0) {
    return opened;
  }

  const rows = input.db
    .select({
      approvedAt: applications.approvedAt,
      approvedPlanEnc: applications.approvedPlanEnc,
      approvedPlanSha256: applications.approvedPlanSha256,
      id: applications.id,
    })
    .from(applications)
    .where(
      and(
        eq(applications.userId, input.userId),
        inArray(applications.id, [...input.applicationIds]),
      ),
    )
    .all();

  const results = await Promise.all(
    rows.map(async (row) => {
      const approvedAt = row.approvedAt ?? null;
      const approvedPlanEnc = row.approvedPlanEnc ?? null;
      const approvedPlanSha256 = row.approvedPlanSha256 ?? null;

      if (approvedAt === null || approvedPlanEnc === null) {
        return null;
      }

      try {
        const plaintext = await input.personal.openFor(
          input.userId,
          approvedPlanScope(row.id),
          approvedPlanEnc,
        );

        const plan = sendPlanSchema.parse(JSON.parse(plaintext)) satisfies SendPlan;
        const sha256 = sendPlanSha256(plan);

        if (sha256 !== approvedPlanSha256) {
          throw new Error("the stored approved plan hash does not match its contents");
        }

        return [row.id, { approvedAt, plan, sha256 } satisfies ApprovedPlan] as const;
      } catch (error) {
        logError(`approved-plan.open ${row.id}`, error);

        return null;
      }
    }),
  );

  for (const result of results) {
    if (result !== null) {
      opened.set(result[0], result[1]);
    }
  }

  return opened;
}

export function approvalProblem(db: AppDatabase, userId: string, plan: SendPlan) {
  const resume = db
    .select({ id: resumes.id, sha256: resumes.sha256 })
    .from(resumes)
    .where(and(eq(resumes.userId, userId), eq(resumes.isCurrent, true)))
    .get();

  if (
    plan.resume !== null &&
    (resume === undefined || resume.id !== plan.resume.id || resume.sha256 !== plan.resume.sha256)
  ) {
    return "Your resume changed";
  }

  for (const field of plan.fields) {
    if (field.factKey === null || field.factRevision === null) {
      continue;
    }

    const fact = db
      .select({ revision: facts.revision })
      .from(facts)
      .where(
        and(eq(facts.userId, userId), eq(facts.key, field.factKey), eq(facts.scope, field.scope)),
      )
      .get();

    if (fact === undefined || fact.revision !== field.factRevision) {
      return "An answer changed";
    }
  }

  return null;
}
