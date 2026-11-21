import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { NavGlyph } from "../../components/nav-glyph.tsx";
import { ThemeToggle } from "../../components/theme-toggle.tsx";
import type { AdminRefusalCode, AdminStatus, AdminUsersResponse } from "../../lib/admin-api.ts";
import { loadUsers } from "../../lib/admin-api.ts";
import { AdminGateScreen } from "./gate-screen.tsx";
import { UserRow } from "./user-row.tsx";

const filters = [
  { key: "all", label: copy.admin.usersFilterAll },
  { key: "active", label: copy.admin.usersFilterActive },
  { key: "suspended", label: copy.admin.usersFilterSuspended },
  { key: "invited", label: copy.admin.usersFilterInvited },
] as const;

const buttonClass =
  "inline-flex h-10 flex-none items-center justify-center rounded-md border border-foreground bg-foreground px-4 text-[13.5px] font-semibold text-card hover:opacity-90";

const chipClass =
  "inline-flex min-h-8 items-center rounded-full border px-3.5 text-[12.5px] font-semibold";

const pageButtonClass =
  "inline-flex h-9 min-w-[92px] items-center justify-center rounded-md border border-input bg-card px-3 text-[12.5px] font-semibold disabled:opacity-50";

export function UsersPage() {
  const [status, setStatus] = useState<AdminStatus>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [refusal, setRefusal] = useState<AdminRefusalCode | null>(null);

  const request = useMemo(() => ({ page, q: query, status }), [page, query, status]);

  const refresh = async () => {
    const result = await loadUsers(request);

    if (result.ok) {
      setData(result.data);
      setRefusal(null);
    } else {
      setRefusal(result.refusal);
    }
  };

  useEffect(() => {
    let alive = true;

    const load = async () => {
      const result = await loadUsers({
        page: request.page,
        q: request.q,
        status: request.status,
      });

      if (!alive) {
        return;
      }

      if (result.ok) {
        setData(result.data);
        setRefusal(null);
      } else {
        setRefusal(result.refusal);
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
    return null;
  }

  const { counts } = data;

  const countOf = {
    active: counts.active,
    all: counts.all,
    invited: counts.invited,
    suspended: counts.suspended,
  } as const;

  const firstRow = data.rows.length === 0 ? 0 : (data.page - 1) * data.pageSize + 1;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="font-serif text-[15px] italic text-muted-foreground">
            {copy.admin.usersLead}
          </p>
          <h1 className="mt-0.5 font-serif text-[32px] leading-[1.05] md:text-[42px]">
            {copy.admin.usersTitlePlain}{" "}
            <span className="italic">{copy.admin.usersTitleItalic}</span>
          </h1>
        </div>
        <div className="flex min-w-0 flex-[1_1_420px] flex-wrap items-center justify-end gap-2.5">
          <label className="flex h-10 min-w-[200px] flex-[1_1_260px] items-center gap-2.5 rounded-md border border-input bg-card px-3">
            <span className="text-muted-foreground">
              <NavGlyph name="search" size={16} />
            </span>
            <input
              aria-label={copy.admin.usersSearch}
              className="min-w-0 flex-1 bg-transparent py-1 text-[13.5px] outline-0 placeholder:text-muted-foreground"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder={copy.admin.usersSearch}
              type="search"
              value={query}
            />
          </label>
          <Link className={buttonClass} to="/admin/invites">
            {copy.admin.usersInvite}
          </Link>
          <ThemeToggle className="flex h-10 w-10 flex-none items-center justify-center rounded-md border border-input bg-card hover:bg-muted" />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2.5">
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
              setPage(1);
            }}
            type="button"
          >
            {filter.label(countOf[filter.key])}
          </button>
        ))}
      </div>
      <section className="mt-6 overflow-hidden rounded-lg border border-border bg-card shadow-sh">
        <div className="hidden grid-cols-[minmax(0,1.6fr)_110px_1fr_1.05fr_1.1fr_24px] gap-4 border-b border-border bg-muted px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid">
          <span>{copy.admin.usersColumnUser}</span>
          <span>{copy.admin.usersColumnStatus}</span>
          <span>{copy.admin.usersColumnInvite}</span>
          <span>{copy.admin.usersColumnGrants}</span>
          <span>{copy.admin.usersColumnLastActivity}</span>
          <span />
        </div>
        {data.rows.length === 0 ? (
          <p className="px-5 py-8 text-[12.5px] text-muted-foreground">
            {copy.admin.usersShowing(0, data.total)}
          </p>
        ) : (
          data.rows.map((row) => <UserRow key={row.id} now={data.now} row={row} />)
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-5 py-4">
          <p className="text-[12.5px] text-muted-foreground">
            {copy.admin.usersShowing(firstRow, data.total)}
          </p>
          <div className="flex gap-2.5">
            <button
              className={pageButtonClass}
              disabled={data.page <= 1}
              onClick={() => {
                setPage((current) => Math.max(1, current - 1));
              }}
              type="button"
            >
              {copy.admin.usersPrevious}
            </button>
            <button
              className={pageButtonClass}
              disabled={data.page * data.pageSize >= data.total}
              onClick={() => {
                setPage((current) => current + 1);
              }}
              type="button"
            >
              {copy.admin.usersNext}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
