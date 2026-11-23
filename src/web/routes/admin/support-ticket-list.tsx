import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";
import type { AdminSupportTicket } from "../../lib/admin-api.ts";
import { adminDayTime } from "../../lib/admin-date.ts";
import { SupportCategoryBadge } from "./support-category-badge.tsx";
import { SupportStatusBadge } from "./support-status-badge.tsx";

const ROW_BUTTON =
  "min-h-11 w-full min-w-0 rounded-md px-3 py-2.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

export function SupportTicketList({
  items,
  now,
  onSelect,
  selectedId,
}: {
  items: AdminSupportTicket[];
  now: number;
  onSelect: (ticket: AdminSupportTicket) => void;
  selectedId: string;
}) {
  if (items.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground">{copy.admin.supportEmpty}</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {items.map((ticket) => {
        const selected = ticket.id === selectedId;

        return (
          <li
            className={`min-w-0 rounded-md border ${selected ? "border-border bg-background shadow-sh" : "border-transparent"}`}
            key={ticket.id}
          >
            <button
              aria-controls={selected ? "admin-support-detail" : undefined}
              aria-expanded={selected}
              aria-pressed={selected}
              className={ROW_BUTTON}
              onClick={() => {
                onSelect(ticket);
              }}
              type="button"
            >
              <span className="flex flex-wrap items-center gap-2">
                <SupportStatusBadge status={ticket.status} />
                <SupportCategoryBadge category={ticket.category} />
                <span className="ml-auto font-mono text-[11.5px] text-muted-foreground">
                  {ticket.referenceId}
                </span>
              </span>
              <span className="mt-1.5 block truncate text-[13.5px] font-semibold">
                {ticket.subject}
              </span>
              <span className="mt-1 block break-words text-[12px] text-muted-foreground">
                {copy.admin.supportAuthor(ticket.userName, ticket.userEmail)}
              </span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground">
                {copy.admin.supportOpened(adminDayTime(ticket.createdAt, now))}
              </span>
            </button>
            <div className="px-3 pb-2">
              <Link
                className="inline-flex min-h-11 items-center rounded-sm text-[12px] font-semibold underline underline-offset-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground md:min-h-9"
                to={`/admin/users/${encodeURIComponent(ticket.userId)}`}
              >
                {copy.admin.supportOpenUser}
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
