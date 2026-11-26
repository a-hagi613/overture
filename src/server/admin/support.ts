import { count, desc, eq } from "drizzle-orm";
import { z } from "zod";

import type { AppDatabase } from "../platform/db/client.ts";
import type { Clock } from "../platform/ports/clock.ts";
import type { MailSender } from "../platform/mail/port.ts";
import { supportReplyEmail } from "../platform/mail/emails.ts";
import type { PersonalCrypto } from "../profile/personal-crypto.ts";
import type {
  SupportCategory,
  SupportStatusFilter,
  SupportTicketStatus,
  SupportTicketUpdate,
} from "../../shared/support.ts";

import { SUPPORT_STATUS_FILTERS } from "../../shared/support.ts";
import { logError } from "../platform/log.ts";
import { insertAdminAudit } from "../platform/audit/insert.ts";
import { shipAdminAudit } from "../platform/audit/index.ts";
import { supportTickets, users } from "../platform/db/schema.ts";

export const SUPPORT_UPDATE_ACTION = "support.update";
export const SUPPORT_REPLY_ACTION = "support.reply";

export const adminSupportQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(SUPPORT_STATUS_FILTERS).default("all"),
});

export interface AdminSupportQuery {
  status: SupportStatusFilter;
  limit: number;
}

export interface AdminSupportTicket {
  adminNotes: string | null;
  category: SupportCategory;
  createdAt: number;
  id: string;
  /** `null` when the ticket's message could not be opened; the row still lists. */
  message: string | null;
  referenceId: string;
  resolvedAt: number | null;
  status: SupportTicketStatus;
  subject: string;
  updatedAt: number;
  userEmail: string;
  userId: string;
  userName: string;
}

export interface AdminSupportQueue {
  items: AdminSupportTicket[];
  now: number;
  /** Tickets still in `open`: the number the Overview alert shows. */
  openCount: number;
  /** Tickets matching the requested status filter, before the list's limit. */
  total: number;
}

export type AdminSupportUpdateOutcome =
  | { outcome: "updated"; ticket: AdminSupportTicket }
  | { outcome: "not_found" };

export type AdminSupportReplyOutcome =
  | { outcome: "sent"; referenceId: string }
  | { outcome: "not_found" }
  | { outcome: "mail_failed"; referenceId: string };

type TicketRow = typeof supportTickets.$inferSelect;

async function messageOf(personal: PersonalCrypto, ticket: TicketRow) {
  try {
    return await personal.openFor(
      ticket.userId,
      { column: "message_enc", rowId: ticket.id, table: "support_tickets" },
      ticket.messageEnc,
    );
  } catch (error) {
    logError("admin.support.open", error);

    return null;
  }
}

function viewOf(
  ticket: TicketRow,
  author: { email: string; name: string },
  message: string | null,
) {
  return {
    adminNotes: ticket.adminNotes,
    category: ticket.category,
    createdAt: ticket.createdAt.getTime(),
    id: ticket.id,
    message,
    referenceId: ticket.referenceId,
    resolvedAt: ticket.resolvedAt === null ? null : ticket.resolvedAt.getTime(),
    status: ticket.status,
    subject: ticket.subject,
    updatedAt: ticket.updatedAt.getTime(),
    userEmail: author.email,
    userId: ticket.userId,
    userName: author.name,
  } satisfies AdminSupportTicket;
}

function filterOf(query: AdminSupportQuery) {
  return query.status === "all" ? undefined : eq(supportTickets.status, query.status);
}

/**
 * Reads the Support Queue newest-first, with the author's address and the
 * ticket's sealed message opened through the person's own key. A message that
 * cannot be opened is marked unreadable instead of failing the whole queue, and
 * the open count is every ticket still in `open`.
 * @param deps The database and personal crypto the queue is read through.
 * @param query The requested status filter and list limit.
 * @returns The queue rows, the open count and the filter's total.
 */
export async function listAdminSupport(
  deps: { db: AppDatabase; clock: Clock; personal: PersonalCrypto },
  query: AdminSupportQuery,
) {
  const filter = filterOf(query);

  const rows = deps.db
    .select({ authorEmail: users.email, authorName: users.name, ticket: supportTickets })
    .from(supportTickets)
    .innerJoin(users, eq(supportTickets.userId, users.id))
    .where(filter)
    .orderBy(desc(supportTickets.createdAt), desc(supportTickets.id))
    .limit(query.limit)
    .all();

  const items = await Promise.all(
    rows.map(async (row) =>
      viewOf(
        row.ticket,
        { email: row.authorEmail, name: row.authorName },
        await messageOf(deps.personal, row.ticket),
      ),
    ),
  );

  const total =
    deps.db.select({ total: count() }).from(supportTickets).where(filter).get()?.total ?? 0;

  return {
    items,
    now: deps.clock.now(),
    openCount: openSupportTicketCount(deps.db),
    total,
  } satisfies AdminSupportQueue;
}

/**
 * Moves a ticket to its next state inside one transaction, recording the
 * owner's note, the resolution time and an audit row together. `resolvedAt`
 * keeps the moment the ticket first left the open queue, so saving a note on a
 * resolved ticket does not rewrite it.
 * @param deps The database, clock and personal crypto the write reads through.
 * @param input The ticket id, the owner's change and the owner's id.
 * @returns The updated ticket, or `not_found` when the id is unknown.
 */
export async function updateAdminSupportTicket(
  deps: { db: AppDatabase; clock: Clock; personal: PersonalCrypto },
  input: { id: string; actorId: string; update: SupportTicketUpdate },
) {
  const current = deps.db
    .select({ authorEmail: users.email, authorName: users.name, ticket: supportTickets })
    .from(supportTickets)
    .innerJoin(users, eq(supportTickets.userId, users.id))
    .where(eq(supportTickets.id, input.id))
    .get();

  if (current === undefined) {
    return { outcome: "not_found" } satisfies AdminSupportUpdateOutcome;
  }

  const now = new Date(deps.clock.now());
  const settled = input.update.status === "resolved" || input.update.status === "closed";
  const trimmedNotes = input.update.adminNotes?.trim();
  const keptNotes = current.ticket.adminNotes;
  let adminNotes = keptNotes;

  if (trimmedNotes !== undefined) {
    adminNotes = trimmedNotes.length === 0 ? null : trimmedNotes;
  }

  const resolvedAt = settled ? (current.ticket.resolvedAt ?? now) : null;

  const auditRow = deps.db.transaction((tx) => {
    tx.update(supportTickets)
      .set({ adminNotes, resolvedAt, status: input.update.status, updatedAt: now })
      .where(eq(supportTickets.id, input.id))
      .run();

    return insertAdminAudit(tx, deps.clock, {
      actorId: input.actorId,
      action: SUPPORT_UPDATE_ACTION,
      detail: {
        from: current.ticket.status,
        notesChanged: adminNotes !== current.ticket.adminNotes,
        referenceId: current.ticket.referenceId,
        to: input.update.status,
      },
      reason: `Support ticket ${current.ticket.referenceId} moved to ${input.update.status}`,
      targetUserId: current.ticket.userId,
    });
  });

  await shipAdminAudit(auditRow);

  const message = await messageOf(deps.personal, current.ticket);

  return {
    outcome: "updated",
    ticket: viewOf(
      { ...current.ticket, adminNotes, resolvedAt, status: input.update.status, updatedAt: now },
      { email: current.authorEmail, name: current.authorName },
      message,
    ),
  } satisfies AdminSupportUpdateOutcome;
}

/**
 * Mails the ticket's author a reply that quotes their reference and subject,
 * then records the reply in the admin audit. A mail failure leaves the ticket
 * untouched and answers `mail_failed`, so the queue never claims a reply that
 * did not leave the machine. Every call sends one email, so a reply is not
 * safe to retry blindly; the admin page disables the button while one is in
 * flight and shows the send's outcome.
 * @param deps The database, clock, mail sender and personal crypto the reply reads through.
 * @param input The ticket id, the message and the owner's id.
 * @returns The ticket's reference on success, or why no reply was sent.
 */
export async function replyToSupportTicket(
  deps: { db: AppDatabase; clock: Clock; mail: MailSender; personal: PersonalCrypto },
  input: { id: string; actorId: string; message: string },
) {
  const row = deps.db
    .select({ authorEmail: users.email, ticket: supportTickets })
    .from(supportTickets)
    .innerJoin(users, eq(supportTickets.userId, users.id))
    .where(eq(supportTickets.id, input.id))
    .get();

  if (row === undefined) {
    return { outcome: "not_found" } satisfies AdminSupportReplyOutcome;
  }

  try {
    await deps.mail.sendSupportReply({
      to: row.authorEmail,
      ...supportReplyEmail({
        message: input.message,
        referenceId: row.ticket.referenceId,
        subject: row.ticket.subject,
      }),
    });
  } catch (error) {
    logError("admin.support.reply", error);

    return {
      outcome: "mail_failed",
      referenceId: row.ticket.referenceId,
    } satisfies AdminSupportReplyOutcome;
  }

  const auditRow = insertAdminAudit(deps.db, deps.clock, {
    actorId: input.actorId,
    action: SUPPORT_REPLY_ACTION,
    detail: { referenceId: row.ticket.referenceId },
    reason: `Replied to support ticket ${row.ticket.referenceId}`,
    targetUserId: row.ticket.userId,
  });

  await shipAdminAudit(auditRow);

  return {
    outcome: "sent",
    referenceId: row.ticket.referenceId,
  } satisfies AdminSupportReplyOutcome;
}

/**
 * Counts the tickets still waiting in `open`, for the Overview badge.
 * @param db The application database.
 * @returns The number of tickets in `open`.
 */
export function openSupportTicketCount(db: AppDatabase) {
  return (
    db
      .select({ total: count() })
      .from(supportTickets)
      .where(eq(supportTickets.status, "open"))
      .get()?.total ?? 0
  );
}
