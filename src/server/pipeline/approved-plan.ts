import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";

import { applications, facts, resumes } from "../platform/db/schema.ts";
import { sendPlanSchema } from "./send-plan.ts";

import type { SendPlan, SendPlanField } from "./send-plan.ts";

export interface ApprovedPlan {
  approvedAt: number;
  plan: SendPlan;
  sha256: string;
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
    sentences: field.sentences.map((sentence) => ({
      resumeLineIds: sentence.resumeLineIds,
      sentence: sentence.sentence,
    })),
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
      plan.coverLetter === null
        ? null
        : plan.coverLetter.map((sentence) => ({
            resumeLineIds: sentence.resumeLineIds,
            sentence: sentence.sentence,
          })),
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
  const row = input.db
    .select({
      approvedAt: applications.approvedAt,
      approvedPlanEnc: applications.approvedPlanEnc,
      approvedPlanSha256: applications.approvedPlanSha256,
    })
    .from(applications)
    .where(and(eq(applications.id, input.applicationId), eq(applications.userId, input.userId)))
    .get();

  const approvedAt = row?.approvedAt ?? null;
  const approvedPlanEnc = row?.approvedPlanEnc ?? null;
  const approvedPlanSha256 = row?.approvedPlanSha256 ?? null;

  if (approvedAt === null || approvedPlanEnc === null) {
    return null;
  }

  const plaintext = await input.personal.openFor(
    input.userId,
    approvedPlanScope(input.applicationId),
    approvedPlanEnc,
  );

  const plan = sendPlanSchema.parse(JSON.parse(plaintext)) satisfies SendPlan;
  const sha256 = sendPlanSha256(plan);

  if (sha256 !== approvedPlanSha256) {
    throw new Error("the stored approved plan hash does not match its contents");
  }

  return { approvedAt, plan, sha256 } satisfies ApprovedPlan;
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
