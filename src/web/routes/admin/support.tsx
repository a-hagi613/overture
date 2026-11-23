import { useCallback, useState } from "react";
import { useSearchParams } from "react-router";

import { copy } from "../../../shared/copy.ts";
import type { AdminSupportTicket, SupportStatusFilter } from "../../lib/admin-api.ts";
import {
  loadAdminSupport,
  replyToSupportTicket,
  supportStatusFilterSchema,
  updateSupportTicket,
} from "../../lib/admin-api.ts";
import { useAdminResource, useInvalidateAdminQueries } from "../../lib/admin-resource.ts";
import { AdminGateScreen } from "./gate-screen.tsx";
import { AdminPageHeading } from "./page-heading.tsx";
import { SupportTicketDetail } from "./support-ticket-detail.tsx";
import { SupportTicketList } from "./support-ticket-list.tsx";

const FILTER_ORDER = ["open", "in_progress", "resolved", "closed", "all"] as const;

const LIST_LIMIT = 50;

const FILTER_BUTTON =
  "inline-flex min-h-11 items-center rounded-md px-3.5 text-[13px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9";

const CARD = "rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh";

const RETRY_BUTTON =
  "mt-4 min-h-11 rounded-md border border-input bg-card px-4 text-[13px] font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9";

export function AdminSupportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = supportStatusFilterSchema.safeParse(searchParams.get("status"));
  const status: SupportStatusFilter = requested.success ? requested.data : "open";
  const selectedId = searchParams.get("ticket") ?? "";
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const [replySent, setReplySent] = useState(0);
  const [pinned, setPinned] = useState<AdminSupportTicket | null>(null);
  const invalidateAdmin = useInvalidateAdminQueries();

  const load = useCallback(async () => loadAdminSupport({ limit: LIST_LIMIT, status }), [status]);

  const {
    data,
    failed: loadFailed,
    refusal,
    refresh,
  } = useAdminResource(load, ["support", status]);

  const resetFeedback = () => {
    setNotice(null);
    setActionFailed(false);
    setReplySent(0);
    setPinned(null);
  };

  const updateParams = (nextStatus: SupportStatusFilter, ticketId: string) => {
    const params = new URLSearchParams(searchParams);

    if (nextStatus === "open") {
      params.delete("status");
    } else {
      params.set("status", nextStatus);
    }

    if (ticketId.length === 0) {
      params.delete("ticket");
    } else {
      params.set("ticket", ticketId);
    }

    setSearchParams(params, { replace: true });
  };

  const setStatus = (nextStatus: SupportStatusFilter) => {
    resetFeedback();
    updateParams(nextStatus, "");
  };

  const toggleTicket = (ticket: AdminSupportTicket) => {
    resetFeedback();
    updateParams(status, ticket.id === selectedId ? "" : ticket.id);
  };

  const applyChange = async (
    change: () => Promise<void>,
    success: string,
    clearsReply: boolean,
  ) => {
    setBusy(true);
    setActionFailed(false);

    try {
      await change();
      setNotice(success);

      if (clearsReply) {
        setReplySent((count) => count + 1);
      }
    } catch {
      setNotice(null);
      setActionFailed(true);
    }

    setBusy(false);
    invalidateAdmin();
  };

  if (refusal !== null) {
    return (
      <AdminGateScreen
        code={refusal}
        onPasskeyDone={() => {
          refresh();
        }}
      />
    );
  }

  if (data === null) {
    return null;
  }

  const heading = (
    <AdminPageHeading
      italic={copy.admin.supportTitleItalic}
      lead={copy.admin.supportLead}
      plain={copy.admin.supportTitlePlain}
    />
  );

  if (loadFailed) {
    return (
      <>
        {heading}
        <section aria-labelledby="admin-support-failed" className={`mt-7 ${CARD}`}>
          <h2 className="font-serif text-[26px] leading-[1.1]" id="admin-support-failed">
            {copy.admin.supportLoadFailed}
          </h2>
          <button
            className={RETRY_BUTTON}
            onClick={() => {
              refresh();
            }}
            type="button"
          >
            {copy.admin.supportTryAgain}
          </button>
        </section>
      </>
    );
  }

  const listed = data.items.find((ticket) => ticket.id === selectedId);
  const selected = pinned?.id === selectedId ? pinned : listed;

  return (
    <>
      {heading}
      <p className="mt-2 max-w-[62ch] text-[13px] text-muted-foreground">
        {copy.admin.supportIntro}
      </p>

      <div className="mt-5">
        <fieldset className="min-w-0">
          <legend className="sr-only">{copy.admin.supportFilterLabel}</legend>
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
            {FILTER_ORDER.map((filter) => {
              const active = filter === status;

              return (
                <button
                  aria-pressed={active}
                  className={`${FILTER_BUTTON} ${active ? "bg-background font-semibold shadow-sh" : "text-muted-foreground"}`}
                  key={filter}
                  onClick={() => {
                    setStatus(filter);
                  }}
                  type="button"
                >
                  {copy.admin.supportFilters[filter]}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>

      <output aria-live="polite" className="mt-3 block min-h-5 text-[12.5px] text-muted-foreground">
        {actionFailed ? copy.admin.supportActionFailed : (notice ?? "")}
      </output>

      <div className="mt-3 grid gap-5 lg:grid-cols-2 lg:items-start">
        <section aria-labelledby="admin-support-list" className={`min-w-0 ${CARD}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="font-serif text-[26px] leading-[1.1]" id="admin-support-list">
              {copy.admin.supportListHeading}
            </h2>
            <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {copy.admin.supportOpenCount(data.openCount)}
            </span>
          </div>
          <div className="mt-4">
            <SupportTicketList
              items={data.items}
              now={data.now}
              onSelect={toggleTicket}
              selectedId={selectedId}
            />
          </div>
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            {copy.admin.supportShowing(data.items.length, data.total)}
          </p>
        </section>

        {selected === undefined ? (
          <section aria-labelledby="admin-support-none" className={`min-w-0 ${CARD}`}>
            <h2 className="font-serif text-[26px] leading-[1.1]" id="admin-support-none">
              {copy.admin.supportNoSelectionHeading}
            </h2>
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              {copy.admin.supportSelectPrompt}
            </p>
          </section>
        ) : (
          <SupportTicketDetail
            busy={busy}
            key={`${selected.id}:${String(selected.updatedAt)}:${String(replySent)}`}
            now={data.now}
            onReply={(message) => {
              void applyChange(
                async () => {
                  await replyToSupportTicket(selected.id, message);
                },
                copy.admin.supportReplySent,
                true,
              );
            }}
            onSaveNotes={(notes) => {
              void applyChange(
                async () => {
                  const result = await updateSupportTicket(selected.id, {
                    adminNotes: notes,
                    status: selected.status,
                  });

                  setPinned(result.ticket);
                },
                copy.admin.supportUpdateSaved,
                false,
              );
            }}
            onStatus={(nextStatus) => {
              void applyChange(
                async () => {
                  const result = await updateSupportTicket(selected.id, { status: nextStatus });

                  setPinned(result.ticket);
                },
                copy.admin.supportUpdateSaved,
                false,
              );
            }}
            ticket={selected}
          />
        )}
      </div>
    </>
  );
}
