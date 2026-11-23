import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { Auth } from "../auth/index.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { AppDatabase } from "../platform/db/client.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";

import { readSession } from "../auth/session.ts";
import { reviewCategory } from "../catalog/question-normalize.ts";
import { openOrNull } from "../profile/personal-crypto.ts";
import { consumeRateLimit } from "../platform/rate-limit.ts";
import {
  applications,
  applicationSnapshots,
  interviewEvents,
  mailThreads,
  messages,
  reviewApplications,
  reviews,
} from "../platform/db/schema.ts";
import { API_ERRORS } from "../../shared/api-errors.ts";
import { validQuery } from "./validators.ts";

import type { WorkspaceSearchResponse } from "../../shared/workspace-search.ts";

type ApplicationResult = WorkspaceSearchResponse["applications"][number];

type EmailResult = WorkspaceSearchResponse["emails"][number];

type InterviewResult = WorkspaceSearchResponse["interviews"][number];

type ReviewResult = WorkspaceSearchResponse["reviews"][number];

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const MAX_QUERY_LENGTH = 120;
const EMAIL_SCAN_LIMIT = 500;
const REVIEW_SCAN_LIMIT = 200;
const INTERVIEW_SCAN_LIMIT = 200;
const WORKSPACE_SEARCH_LIMIT = 30;
const WORKSPACE_SEARCH_WINDOW_MS = 60_000;

const searchQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  q: z.string().trim().max(MAX_QUERY_LENGTH).default(""),
});

function contains(haystacks: readonly (string | null)[], needle: string) {
  return haystacks.some((value) => (value ?? "").toLowerCase().includes(needle));
}

function emptyResponse(query: string) {
  return {
    applications: [],
    emails: [],
    interviews: [],
    query,
    reviews: [],
  } satisfies WorkspaceSearchResponse;
}

/**
 * Searches the signed-in user's own Applications, Reviews, Inbox mail and interviews by a case-insensitive
 * substring. Every query is scoped by `user.id`, personal fields are opened with that user's key, and no row,
 * count or decrypted value from another account can enter the response. Mail, Review and interview scans stop at a
 * fixed recent-row bound so one request cannot decrypt an entire lifetime inbox.
 * @param deps The database, auth and personal crypto the route reads through.
 * @returns The `GET /api/workspace/search` routes.
 */
export function createWorkspaceSearchRoutes(deps: {
  auth: Auth;
  clock: Clock;
  db: AppDatabase;
  personal: PersonalCrypto;
}) {
  const { auth, clock, db, personal } = deps;
  const routes = new Hono();

  function applicationResults(userId: string, needle: string, limit: number) {
    const rows = db
      .select({
        company: applications.companyName,
        id: applications.id,
        location: applications.locationRaw,
        score: applications.scoreAtQueue,
        snapshotTitle: applicationSnapshots.postingTitle,
        stage: applications.stage,
        status: applications.status,
        title: applications.postingTitle,
      })
      .from(applications)
      .leftJoin(applicationSnapshots, eq(applicationSnapshots.applicationId, applications.id))
      .where(
        and(
          eq(applications.userId, userId),
          or(
            sql`instr(lower(${applications.companyName}), ${needle}) > 0`,
            sql`instr(lower(${applications.postingTitle}), ${needle}) > 0`,
            sql`instr(lower(coalesce(${applicationSnapshots.postingTitle}, '')), ${needle}) > 0`,
            sql`instr(lower(coalesce(${applications.locationRaw}, '')), ${needle}) > 0`,
            sql`instr(lower(coalesce(${applications.stage}, '')), ${needle}) > 0`,
            sql`instr(lower(${applications.status}), ${needle}) > 0`,
          ),
        ),
      )
      .orderBy(desc(applications.updatedAt), applications.id)
      .limit(limit)
      .all();

    return rows.map(
      (row) =>
        ({
          company: row.company,
          id: row.id,
          location: row.location,
          score: row.score,
          stage: row.stage,
          status: row.status,
          title: row.snapshotTitle ?? row.title,
        }) satisfies ApplicationResult,
    );
  }

  function reviewResults(userId: string, needle: string, limit: number) {
    const rows = db
      .select({
        createdAt: reviews.createdAt,
        factKey: reviews.factKey,
        id: reviews.id,
        prompt: reviews.prompt,
      })
      .from(reviews)
      .where(and(eq(reviews.userId, userId), eq(reviews.status, "open")))
      .orderBy(desc(reviews.createdAt), reviews.id)
      .limit(REVIEW_SCAN_LIMIT)
      .all();

    const matched = rows
      .filter((row) => contains([row.prompt, reviewCategory(row.prompt, row.factKey)], needle))
      .slice(0, limit);

    if (matched.length === 0) {
      return [];
    }

    const counts = db
      .select({
        reviewId: reviewApplications.reviewId,
        total: sql<number>`count(*)`,
      })
      .from(reviewApplications)
      .innerJoin(applications, eq(applications.id, reviewApplications.applicationId))
      .where(
        and(
          eq(applications.userId, userId),
          inArray(
            reviewApplications.reviewId,
            matched.map((row) => row.id),
          ),
        ),
      )
      .groupBy(reviewApplications.reviewId)
      .all();

    const unlocked = new Map(counts.map((row) => [row.reviewId, row.total]));

    return matched.map(
      (row) =>
        ({
          category: reviewCategory(row.prompt, row.factKey),
          id: row.id,
          prompt: row.prompt,
          unlockedCount: unlocked.get(row.id) ?? 0,
        }) satisfies ReviewResult,
    );
  }

  async function emailResults(userId: string, needle: string, limit: number) {
    const rows = db
      .select({
        company: applications.companyName,
        createdAt: messages.createdAt,
        fromEnc: messages.fromEnc,
        id: messages.id,
        snippetEnc: messages.snippetEnc,
        subjectEnc: messages.subjectEnc,
        threadId: messages.threadId,
      })
      .from(messages)
      .leftJoin(mailThreads, eq(mailThreads.id, messages.threadId))
      .leftJoin(
        applications,
        and(eq(applications.id, mailThreads.applicationId), eq(applications.userId, userId)),
      )
      .where(
        and(
          eq(messages.userId, userId),
          eq(messages.direction, "in"),
          eq(messages.auth, "pass"),
          or(sql`${messages.classification} IS NULL`, sql`${messages.classification} <> 'code'`),
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(EMAIL_SCAN_LIMIT)
      .all();

    const opened = await Promise.all(
      rows.map(async (row) => {
        const [from, subject, snippet] = await Promise.all([
          openOrNull({
            personal,
            scope: { column: "from_enc", rowId: row.id, table: "messages" },
            sealed: row.fromEnc,
            userId,
          }),
          openOrNull({
            personal,
            scope: { column: "subject_enc", rowId: row.id, table: "messages" },
            sealed: row.subjectEnc,
            userId,
          }),
          openOrNull({
            personal,
            scope: { column: "snippet_enc", rowId: row.id, table: "messages" },
            sealed: row.snippetEnc,
            userId,
          }),
        ]);

        return from === null || subject === null || snippet === null
          ? null
          : { from, row, snippet, subject };
      }),
    );

    const results: EmailResult[] = [];

    for (const entry of opened) {
      if (entry === null) {
        continue;
      }

      if (!contains([entry.from, entry.subject, entry.snippet, entry.row.company], needle)) {
        continue;
      }

      results.push({
        company: entry.row.company,
        id: entry.row.id,
        receivedAt: entry.row.createdAt.getTime(),
        snippet: entry.snippet,
        subject: entry.subject,
        threadId: entry.row.threadId,
      });

      if (results.length === limit) {
        break;
      }
    }

    return results;
  }

  function interviewResults(userId: string, needle: string, limit: number) {
    const rows = db
      .select({
        applicationId: applications.id,
        company: applications.companyName,
        endsAt: interviewEvents.endsAt,
        id: interviewEvents.id,
        location: applications.locationRaw,
        snapshotTitle: applicationSnapshots.postingTitle,
        startsAt: interviewEvents.startsAt,
        title: applications.postingTitle,
      })
      .from(interviewEvents)
      .innerJoin(
        applications,
        and(eq(applications.id, interviewEvents.applicationId), eq(applications.userId, userId)),
      )
      .leftJoin(applicationSnapshots, eq(applicationSnapshots.applicationId, applications.id))
      .where(eq(interviewEvents.userId, userId))
      .orderBy(desc(interviewEvents.startsAt), interviewEvents.id)
      .limit(INTERVIEW_SCAN_LIMIT)
      .all();

    const results: InterviewResult[] = [];

    for (const row of rows) {
      const title = row.snapshotTitle ?? row.title;
      const summary = `${row.company} — ${title}`;

      if (!contains([summary, row.company, title, row.location], needle)) {
        continue;
      }

      results.push({
        applicationId: row.applicationId,
        company: row.company,
        endsAt: row.endsAt,
        id: row.id,
        location: row.location,
        startsAt: row.startsAt,
        summary,
        title,
      });

      if (results.length === limit) {
        break;
      }
    }

    return results;
  }

  routes.get("/workspace/search", validQuery(searchQuery), async (context) => {
    const session = await readSession(auth, context.req.raw.headers);

    if (session === null) {
      return context.json({ error: API_ERRORS.signInRequired }, 401);
    }

    context.header("Cache-Control", "no-store");

    const userId = session.user.id;

    const allowed = consumeRateLimit(db, `api.workspace-search:${userId}`, clock.now(), {
      max: WORKSPACE_SEARCH_LIMIT,
      windowMs: WORKSPACE_SEARCH_WINDOW_MS,
    });

    if (!allowed) {
      return context.json({ error: API_ERRORS.rateLimited }, 429);
    }

    const { limit, q } = context.req.valid("query");

    if (q === "") {
      return context.json(emptyResponse(q));
    }

    const needle = q.toLowerCase();

    const emails = await emailResults(userId, needle, limit);

    return context.json({
      applications: applicationResults(userId, needle, limit),
      emails,
      interviews: interviewResults(userId, needle, limit),
      query: q,
      reviews: reviewResults(userId, needle, limit),
    } satisfies WorkspaceSearchResponse);
  });

  return routes;
}
