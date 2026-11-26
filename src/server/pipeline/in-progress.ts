import { and, eq, inArray } from "drizzle-orm";

import type { AppDatabase } from "../platform/db/client.ts";

import { applications } from "../platform/db/schema.ts";

export type InProgressStatus = "preparing" | "approved" | "sending" | "confirming";

/** One application on its way, as Home's In progress section shows it. */
export interface InProgressRow {
  company: string;
  id: string;
  sendsAt: number | null;
  status: InProgressStatus;
  title: string;
}

/** The rows to render and the honest total behind the section count. */
export interface InProgressView {
  items: InProgressRow[];
  total: number;
}

const STATUS_ORDER = {
  sending: 0,
  confirming: 1,
  preparing: 2,
  approved: 3,
} satisfies Record<InProgressStatus, number>;

function isInProgress(status: string): status is InProgressStatus {
  return status in STATUS_ORDER;
}

/**
 * Reads what is actively happening: sending and confirming first, then preparing, then the
 * approved queue by its next slot. A slot the planner has already passed reads "next in line"
 * rather than a time that has gone.
 *
 * @param db The app database.
 * @param userId The signed-in user.
 * @param now The clock reading that decides whether a slot is still ahead.
 * @param limit How many rows the caller renders.
 * @returns The newest rows and how many applications are in progress in total.
 */
export function inProgressOf(db: AppDatabase, userId: string, now: number, limit: number) {
  const rows = db
    .select({
      company: applications.companyName,
      id: applications.id,
      scheduledFor: applications.scheduledFor,
      status: applications.status,
      title: applications.postingTitle,
      updatedAt: applications.updatedAt,
    })
    .from(applications)
    .where(
      and(
        eq(applications.userId, userId),
        inArray(applications.status, ["preparing", "approved", "sending", "confirming"]),
      ),
    )
    .all()
    .flatMap((row) =>
      isInProgress(row.status)
        ? [
            {
              company: row.company,
              id: row.id,
              scheduledFor: row.scheduledFor,
              status: row.status,
              title: row.title,
              updatedAt: row.updatedAt,
            },
          ]
        : [],
    );

  const ordered = rows.toSorted((left, right) => {
    const byStatus = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];

    if (byStatus !== 0) {
      return byStatus;
    }

    const bySend =
      (left.scheduledFor ?? Number.MAX_SAFE_INTEGER) -
      (right.scheduledFor ?? Number.MAX_SAFE_INTEGER);

    return bySend === 0 ? right.updatedAt - left.updatedAt : bySend;
  });

  return {
    items: ordered.slice(0, limit).map(
      (row) =>
        ({
          company: row.company,
          id: row.id,
          sendsAt:
            row.status === "approved" && row.scheduledFor !== null && row.scheduledFor >= now
              ? row.scheduledFor
              : null,
          status: row.status,
          title: row.title,
        }) satisfies InProgressRow,
    ),
    total: ordered.length,
  } satisfies InProgressView;
}
