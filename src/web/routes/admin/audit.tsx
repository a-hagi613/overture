import { useCallback, useState } from "react";

import { copy } from "../../../shared/copy.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { loadAdminAudit } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AuditEntryRow } from "./audit-entry-row.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";
import { AdminPageHeading } from "./page-heading.tsx";

const AUDIT_PAGE_SIZE = 50;

const KNOWN_ACTIONS = [
  "settings.update",
  "kill_switch.update",
  "alerts.ack",
  "job.retry",
  "job.cancel",
  "system.wal_checkpoint",
  "grants.create",
  "invites.create",
  "invites.revoke",
  "users.suspend",
  "users.reinstate",
  "billing.refund",
  "reveal.open",
  "tag_imports.create",
  "probes.personio",
  "live-checks.run",
  "lab.run",
  "fixtures.capture",
] as const;

export function AuditLogPage() {
  const [action, setAction] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [queryText, setQueryText] = useState("");
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const currentCursor = cursorStack[pageIndex] ?? null;

  const load = useCallback(
    async () =>
      loadAdminAudit({
        action,
        before: currentCursor,
        limit: AUDIT_PAGE_SIZE,
        q: queryText,
        targetUserId,
      }),
    [action, currentCursor, queryText, targetUserId],
  );

  const { data, refusal, refresh } = useAdminResource(load, [
    "audit",
    action,
    targetUserId,
    queryText,
    currentCursor,
  ]);

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

  const hasFilters =
    action.length > 0 || targetUserId.trim().length > 0 || queryText.trim().length > 0;

  const resetPagination = () => {
    setCursorStack([null]);
    setPageIndex(0);
    setExpandedId(null);
  };

  const goNext = () => {
    const { nextCursor } = data;

    if (nextCursor === null) {
      return;
    }

    const nextIndex = pageIndex + 1;

    setCursorStack((current) => [...current.slice(0, nextIndex), nextCursor]);
    setPageIndex(nextIndex);
    setExpandedId(null);
  };

  const goPrevious = () => {
    if (pageIndex === 0) {
      return;
    }

    setPageIndex((current) => Math.max(0, current - 1));
    setExpandedId(null);
  };

  return (
    <>
      <AdminPageHeading
        italic={copy.admin.auditTitleItalic}
        lead={copy.admin.auditLead}
        plain={copy.admin.auditTitlePlain}
      />
      <Card className="mt-6">
        <div className="grid gap-3 md:grid-cols-[1fr_200px_200px_auto] md:items-end">
          <label className="block min-w-0">
            <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {copy.admin.auditSearchLabel}
            </span>
            <input
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-[13.5px] md:h-10"
              onChange={(event) => {
                setQueryText(event.target.value);
                resetPagination();
              }}
              placeholder={copy.admin.auditSearchPlaceholder}
              type="search"
              value={queryText}
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {copy.admin.auditActionLabel}
            </span>
            <select
              className="h-11 w-full rounded-md border border-input bg-background px-2.5 text-[13px] md:h-10"
              onChange={(event) => {
                setAction(event.target.value);
                resetPagination();
              }}
              value={action}
            >
              <option value="">{copy.admin.auditActionAll}</option>
              {KNOWN_ACTIONS.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {copy.admin.auditTargetUserLabel}
            </span>
            <input
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-[13px] md:h-10"
              onChange={(event) => {
                setTargetUserId(event.target.value);
                resetPagination();
              }}
              placeholder={copy.admin.auditTargetUserPlaceholder}
              type="text"
              value={targetUserId}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {hasFilters ? (
              <Button
                onClick={() => {
                  setAction("");
                  setTargetUserId("");
                  setQueryText("");
                  resetPagination();
                }}
                variant="ghost"
              >
                {copy.admin.auditClearFilters}
              </Button>
            ) : null}
            <Button onClick={refresh} variant="secondary">
              {copy.admin.auditRefresh}
            </Button>
          </div>
        </div>
      </Card>
      <section
        aria-label={copy.admin.navAudit}
        className="mt-5 overflow-hidden rounded-lg border border-border bg-card shadow-sh"
      >
        {data.entries.length === 0 ? (
          <p className="px-5 py-8 text-[13px] text-muted-foreground">{copy.admin.auditEmpty}</p>
        ) : (
          <ul>
            {data.entries.map((row) => (
              <AuditEntryRow
                expanded={expandedId === row.id}
                key={row.id}
                onToggle={() => {
                  setExpandedId((current) => (current === row.id ? null : row.id));
                }}
                row={row}
              />
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-3.5 md:px-5">
          <p className="font-mono text-[12.5px] text-muted-foreground tabular-nums">
            {copy.admin.auditCount(data.entries.length, pageIndex + 1)}
          </p>
          <div className="flex gap-2">
            <Button disabled={pageIndex === 0} onClick={goPrevious} variant="secondary">
              {copy.admin.auditPrevious}
            </Button>
            <Button disabled={data.nextCursor === null} onClick={goNext} variant="secondary">
              {copy.admin.auditNext}
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
