import { useState } from "react";
import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";
import type { AdminSupportTicket } from "../../lib/admin-api.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import { SupportCategoryBadge } from "./support-category-badge.tsx";
import { SupportStatusBadge } from "./support-status-badge.tsx";
import { Button } from "./ui/button.tsx";

const TEXT_INPUT =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

const TEXT_MAX = 5000;

export function SupportTicketDetail({
  busy,
  now,
  onReply,
  onSaveNotes,
  onStatus,
  ticket,
}: {
  busy: boolean;
  now: number;
  onReply: (message: string) => void;
  onSaveNotes: (notes: string) => void;
  onStatus: (status: AdminSupportTicket["status"]) => void;
  ticket: AdminSupportTicket;
}) {
  const [notes, setNotes] = useState(ticket.adminNotes ?? "");
  const [reply, setReply] = useState("");

  const notesChanged = notes.trim() !== (ticket.adminNotes ?? "");
  const canResolve = ticket.status !== "resolved" && ticket.status !== "closed";
  const canClose = ticket.status !== "closed";

  return (
    <section
      aria-labelledby="admin-support-detail"
      className="min-w-0 rounded-lg border border-border bg-card px-6 py-5 shadow-sh"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-eyebrow font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {copy.admin.supportReference(ticket.referenceId)}
          </p>
          <h2
            className="mt-1 break-words font-serif text-card-title leading-[1.1]"
            id="admin-support-detail"
          >
            {ticket.subject}
          </h2>
          <p className="mt-1.5 break-words text-xs text-muted-foreground">
            {copy.admin.supportAuthor(ticket.userName, ticket.userEmail)}
          </p>
          <p className="text-xs text-muted-foreground">
            {copy.admin.supportOpened(adminDayTime(ticket.createdAt, now))}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SupportStatusBadge status={ticket.status} />
          <SupportCategoryBadge category={ticket.category} />
        </div>
      </div>

      <p className="mt-3">
        <Link
          className="inline-flex min-h-11 items-center rounded-sm text-xs font-semibold underline underline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9"
          to={`/admin/users/${encodeURIComponent(ticket.userId)}`}
        >
          {copy.admin.supportOpenUser}
        </Link>
      </p>

      <h3 className="mt-4 text-sm font-semibold">{copy.admin.supportMessageHeading}</h3>
      {ticket.message === null ? (
        <p className="mt-2 rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
          {copy.admin.supportUndecryptable}
        </p>
      ) : (
        <p className="mt-2 whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 text-sm leading-relaxed">
          {ticket.message}
        </p>
      )}

      <h3 className="mt-5 text-sm font-semibold">{copy.admin.supportStatusHeading}</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {copy.admin.supportStatusNow(copy.admin.supportStatus[ticket.status])}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {ticket.status === "open" ? (
          <Button
            disabled={busy}
            onClick={() => {
              onStatus("in_progress");
            }}
          >
            {copy.admin.supportMarkInProgress}
          </Button>
        ) : null}
        {canResolve ? (
          <Button
            disabled={busy}
            onClick={() => {
              onStatus("resolved");
            }}
            variant="primary"
          >
            {copy.admin.supportResolve}
          </Button>
        ) : null}
        {canClose ? (
          <Button
            disabled={busy}
            onClick={() => {
              onStatus("closed");
            }}
          >
            {copy.admin.supportClose}
          </Button>
        ) : null}
      </div>

      <h3 className="mt-5 text-sm font-semibold">{copy.admin.supportNotesHeading}</h3>
      <form
        className="mt-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSaveNotes(notes);
        }}
      >
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-semibold">{copy.admin.supportNotesLabel}</span>
          <textarea
            className={`${TEXT_INPUT} min-h-[92px]`}
            maxLength={TEXT_MAX}
            onChange={(event) => {
              setNotes(event.target.value);
            }}
            placeholder={copy.admin.supportNotesPlaceholder}
            value={notes}
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button disabled={busy || !notesChanged} type="submit">
            {copy.admin.supportNotesSave}
          </Button>
        </div>
      </form>

      <h3 className="mt-5 text-sm font-semibold">{copy.admin.supportReplyHeading}</h3>
      <form
        className="mt-2"
        onSubmit={(event) => {
          event.preventDefault();
          onReply(reply);
        }}
      >
        <label className="block min-w-0">
          <span className="mb-1 block text-xs font-semibold">{copy.admin.supportReplyLabel}</span>
          <textarea
            className={`${TEXT_INPUT} min-h-[110px]`}
            maxLength={TEXT_MAX}
            onChange={(event) => {
              setReply(event.target.value);
            }}
            placeholder={copy.admin.supportReplyPlaceholder}
            value={reply}
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button disabled={busy || reply.trim().length === 0} type="submit" variant="primary">
            {copy.admin.supportReplySend}
          </Button>
        </div>
      </form>
    </section>
  );
}
