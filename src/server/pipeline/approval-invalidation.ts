import { and, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";

import { applicationEvents, applications } from "../platform/db/schema.ts";
import { publishEvent } from "../platform/sse/stream.ts";
import { approvalProblem, openApprovedPlan } from "./approved-plan.ts";
import { enqueueApplicationPrepare } from "./prepare-jobs.ts";
import { stageForStatus } from "./stage.ts";

const UNSENT_STATUSES = ["preparing", "needs_review", "ready"] as const;

export async function returnStaleApprovals(input: {
  clock: Clock;
  db: AppDatabase;
  personal: PersonalCrypto;
  userId: string;
}) {
  const rows = input.db
    .select({ id: applications.id })
    .from(applications)
    .where(and(eq(applications.userId, input.userId), eq(applications.status, "approved")))
    .all();

  return Promise.all(
    rows.map(async (row) => {
      const approved = await openApprovedPlan({
        applicationId: row.id,
        db: input.db,
        personal: input.personal,
        userId: input.userId,
      }).catch(() => null);

      const problem =
        approved === null
          ? "The plan could not be read"
          : approvalProblem(input.db, input.userId, approved.plan);

      if (
        problem === null ||
        !returnToReady(input.db, input.clock, input.userId, row.id, problem)
      ) {
        return null;
      }

      return { applicationId: row.id, changes: problem };
    }),
  ).then((settled) => settled.filter((stale) => stale !== null));
}

export function returnToReady(
  db: AppDatabase,
  clock: Clock,
  userId: string,
  applicationId: string,
  problem: string,
) {
  const now = clock.now();

  const claim = db.transaction((tx) => {
    const updated = tx
      .update(applications)
      .set({
        approvedAt: null,
        approvedPlanEnc: null,
        approvedPlanSha256: null,
        changes: JSON.stringify([problem]),
        scheduledFor: null,
        stage: stageForStatus("ready"),
        status: "ready",
        statusReason: null,
        updatedAt: now,
      })
      .where(and(eq(applications.id, applicationId), eq(applications.status, "approved")))
      .returning({ id: applications.id })
      .all()
      .at(0);

    if (updated === undefined) {
      return false;
    }

    tx.insert(applicationEvents)
      .values({
        applicationId,
        at: now,
        detail: JSON.stringify({ changes: [problem] }),
        fromValue: "approved",
        id: crypto.randomUUID(),
        kind: "status",
        source: "system",
        toValue: "ready",
        userId,
      })
      .run();

    return true;
  });

  if (!claim) {
    return false;
  }

  enqueueApplicationPrepare(db, clock, applicationId);
  publishEvent(
    db,
    clock,
    "application.updated",
    JSON.stringify({ applicationId, status: "ready" }),
    userId,
  );
  publishEvent(db, clock, "home.updated", JSON.stringify({ approved: false }), userId);

  return true;
}

export async function prepareUsersOfFacts(input: {
  answersFor: (applicationId: string) => Promise<
    readonly {
      factKey: string | null;
      scope: string;
    }[]
  >;
  clock: Clock;
  db: AppDatabase;
  facts: readonly { key: string; scope: string }[];
  skip?: readonly string[];
  userId: string;
}) {
  if (input.facts.length === 0) {
    return [];
  }

  const wanted = new Set(input.facts.map((fact) => `${fact.key}\u0000${fact.scope}`));
  const skipped = new Set<string>(input.skip);

  const rows = input.db
    .select({ id: applications.id })
    .from(applications)
    .where(
      and(eq(applications.userId, input.userId), inArray(applications.status, UNSENT_STATUSES)),
    )
    .all();

  const usage = await Promise.all(
    rows.map(async (row) => {
      const answers = await input.answersFor(row.id);

      return {
        id: row.id,
        uses: answers.some(
          (answer) =>
            answer.factKey !== null && wanted.has(`${answer.factKey}\u0000${answer.scope}`),
        ),
      };
    }),
  );

  const prepared = usage
    .filter((entry) => entry.uses && !skipped.has(entry.id))
    .map((entry) => entry.id);

  for (const applicationId of prepared) {
    enqueueApplicationPrepare(input.db, input.clock, applicationId);
  }

  return prepared;
}
