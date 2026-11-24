import { useEffect, useMemo, useState } from "react";

import { copy } from "../../../shared/copy.ts";
import type { AdminRefusalCode, WaitlistResponse } from "../../lib/admin-api.ts";
import { inviteWaitlistEntry, loadWaitlist } from "../../lib/admin-api.ts";
import { adminDay } from "../../lib/admin-date.ts";
import { NavGlyph } from "../../components/nav-glyph.tsx";
import { ThemeToggle } from "../../components/theme-toggle.tsx";
import { AdminStatusCard } from "./admin-status-card.tsx";
import { AdminStatusPill } from "./status-pill.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";

type WaitlistFilter = "all" | "pending" | "invited" | "joined";

type WaitlistOrder = "newest" | "oldest";

const filters = [
  { key: "all", label: copy.admin.waitlistFilterAll },
  { key: "pending", label: copy.admin.waitlistFilterPending },
  { key: "invited", label: copy.admin.waitlistFilterInvited },
  { key: "joined", label: copy.admin.waitlistFilterJoined },
] as const;

const chipClass =
  "inline-flex min-h-8 items-center rounded-full border px-3.5 text-xs font-semibold";

function statusNote(entry: { invitedAt: number | null; status: "pending" | "invited" | "joined" }) {
  if (entry.status === "joined") {
    return copy.admin.waitlistJoinedNote;
  }

  if (entry.invitedAt === null) {
    return copy.admin.waitlistNone;
  }

  return copy.admin.inviteInvitedAt(adminDay(entry.invitedAt));
}

/**
 * The admin waitlist queue (WS-22): counts per status, a filter, a search and the one-click approve action that
 * creates the single-use invite and mails the onboarding link.
 * @returns The `/admin/waitlist` view.
 */
export function WaitlistPage() {
  const [status, setStatus] = useState<WaitlistFilter>("all");
  const [order, setOrder] = useState<WaitlistOrder>("newest");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<WaitlistResponse | null>(null);
  const [refusal, setRefusal] = useState<AdminRefusalCode | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);

  const request = useMemo(() => ({ order, q: query, status }), [order, query, status]);

  const heading = (
    <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="font-serif text-sm italic text-muted-foreground">{copy.admin.waitlistLead}</p>
        <h1 className="mt-0.5 font-serif text-page-title leading-[1.05]">
          {copy.admin.waitlistTitlePlain}
        </h1>
      </div>
      <ThemeToggle
        compact
        className="flex h-10 w-10 flex-none items-center justify-center rounded-md border border-input bg-card hover:bg-muted"
      />
    </div>
  );

  const refresh = async () => {
    setLoadFailed(false);

    try {
      const result = await loadWaitlist(request);

      if (result.ok) {
        setData(result.data);
        setRefusal(null);
      } else {
        setRefusal(result.refusal);
      }
    } catch {
      setLoadFailed(true);
    }
  };

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoadFailed(false);

      try {
        const result = await loadWaitlist(request);

        if (!alive) {
          return;
        }

        if (result.ok) {
          setData(result.data);
          setRefusal(null);
        } else {
          setRefusal(result.refusal);
        }
      } catch {
        if (alive) {
          setLoadFailed(true);
        }
      }
    };

    void load();

    return () => {
      alive = false;
    };
  }, [request]);

  if (refusal !== null) {
    return (
      <AdminGateScreen
        code={refusal}
        onPasskeyDone={() => {
          void refresh();
        }}
      />
    );
  }

  if (data === null) {
    return (
      <>
        {heading}
        <AdminStatusCard
          failed={loadFailed}
          onRetry={() => {
            void refresh();
          }}
        />
      </>
    );
  }

  const { counts } = data;

  const countOf: Record<WaitlistFilter, number> = {
    all: counts.all,
    invited: counts.invited,
    joined: counts.joined,
    pending: counts.pending,
  };

  const invite = async (id: string, email: string) => {
    setBusyId(id);
    setActionFailed(false);
    setNotice(null);

    try {
      const result = await inviteWaitlistEntry(id);

      setNotice(
        result.emailed
          ? copy.admin.waitlistInviteSent(email)
          : copy.admin.waitlistInviteAlreadySent(email),
      );
      await refresh();
    } catch {
      setActionFailed(true);
    }

    setBusyId(null);
  };

  const empty = data.entries.length === 0;

  return (
    <>
      {heading}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2.5">
          {filters.map((filter) => (
            <button
              aria-pressed={status === filter.key}
              className={`${chipClass} ${
                status === filter.key
                  ? "border-foreground bg-foreground text-card"
                  : "border-input bg-card text-foreground hover:bg-muted"
              }`}
              key={filter.key}
              onClick={() => {
                setStatus(filter.key);
              }}
              type="button"
            >
              {filter.label(countOf[filter.key])}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex h-10 min-w-[200px] items-center gap-2.5 rounded-md border border-input bg-card px-3">
            <span className="text-muted-foreground">
              <NavGlyph name="search" size={16} />
            </span>
            <input
              aria-label={copy.admin.waitlistSearch}
              className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-0 placeholder:text-muted-foreground"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder={copy.admin.waitlistSearch}
              type="search"
              value={query}
            />
          </label>
          <label className="flex flex-col gap-1 text-eyebrow font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {copy.admin.waitlistOrderLabel}
            <select
              className="min-h-11 rounded-md border border-input bg-card px-3 text-sm font-normal normal-case tracking-normal text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal md:min-h-9"
              onChange={(event) => {
                setOrder(event.target.value === "oldest" ? "oldest" : "newest");
              }}
              value={order}
            >
              <option value="newest">{copy.admin.waitlistOrderNewest}</option>
              <option value="oldest">{copy.admin.waitlistOrderOldest}</option>
            </select>
          </label>
        </div>
      </div>
      <p aria-live="polite" className="mt-3 min-h-5 text-xs text-muted-foreground">
        {actionFailed ? copy.admin.waitlistInviteFailed : (notice ?? "")}
      </p>
      {loadFailed ? (
        <AdminStatusCard
          className="mt-5"
          failed
          onRetry={() => {
            void refresh();
          }}
        />
      ) : null}
      <section className="mt-4 overflow-hidden rounded-lg border border-border bg-card shadow-sh">
        <div className="hidden grid-cols-[minmax(0,1.6fr)_110px_150px_220px] gap-4 border-b border-border bg-muted px-5 py-3 text-eyebrow font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid">
          <span>{copy.admin.waitlistColumnPerson}</span>
          <span>{copy.admin.waitlistColumnStatus}</span>
          <span>{copy.admin.waitlistColumnRequested}</span>
          <span>{copy.admin.waitlistColumnAction}</span>
        </div>
        {empty ? (
          <p className="px-5 py-8 text-sm text-muted-foreground">
            {status === "all" && query.trim() === ""
              ? copy.admin.waitlistEmpty
              : copy.admin.waitlistEmptyFiltered}
          </p>
        ) : (
          data.entries.map((entry) => {
            const busy = busyId === entry.id;
            const canInvite = entry.status === "pending";

            return (
              <div
                className="border-t border-border px-5 py-4 md:grid md:grid-cols-[minmax(0,1.6fr)_110px_150px_220px] md:items-center md:gap-4 md:py-3.5"
                data-waitlist-row={entry.email}
                key={entry.id}
              >
                <div className="min-w-0">
                  <p className="break-all text-sm font-semibold text-foreground">{entry.email}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {entry.targetRole ?? copy.admin.waitlistNone}
                    <span aria-hidden="true">{" · "}</span>
                    {entry.targetLocation ?? copy.admin.waitlistNone}
                  </p>
                </div>
                <div className="mt-3 md:mt-0">
                  <span className="mb-1 block text-eyebrow font-semibold uppercase tracking-[0.14em] text-muted-foreground md:sr-only">
                    {copy.admin.waitlistColumnStatus}
                  </span>
                  <AdminStatusPill status={entry.status} />
                </div>
                <div className="mt-3 md:mt-0">
                  <span className="mb-1 block text-eyebrow font-semibold uppercase tracking-[0.14em] text-muted-foreground md:sr-only">
                    {copy.admin.waitlistColumnRequested}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {adminDay(entry.createdAt)}
                  </span>
                </div>
                <div className="mt-3 md:mt-0">
                  <span className="mb-1 block text-eyebrow font-semibold uppercase tracking-[0.14em] text-muted-foreground md:sr-only">
                    {copy.admin.waitlistColumnAction}
                  </span>
                  {canInvite ? (
                    <button
                      aria-busy={busy}
                      className="inline-flex min-h-9 items-center justify-center rounded-md border border-foreground bg-foreground px-3.5 text-xs font-semibold text-card transition hover:opacity-90 disabled:opacity-45"
                      disabled={busy}
                      onClick={() => {
                        void invite(entry.id, entry.email);
                      }}
                      type="button"
                    >
                      {busy ? copy.admin.waitlistSending : copy.admin.waitlistApprove}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">{statusNote(entry)}</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </section>
      <p className="mt-4 text-xs text-muted-foreground">{copy.admin.waitlistApproveHint}</p>
    </>
  );
}
