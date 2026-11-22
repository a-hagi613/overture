import { copy } from "../../../shared/copy.ts";
import type { InviteRow } from "../../lib/admin-api.ts";
import { adminDay } from "../../lib/admin-date.ts";
import { AdminStatusPill } from "./status-pill.tsx";

export type InviteMode = "pending" | "accepted" | "revoked";

const DAY_MS = 24 * 60 * 60 * 1000;

function grantDays(row: InviteRow) {
  const { grant } = row;

  if (grant === null) {
    return null;
  }

  return grant.expiresAt === null
    ? null
    : Math.max(1, Math.round((grant.expiresAt - grant.startsAt) / DAY_MS));
}

function dateText(row: InviteRow, mode: InviteMode) {
  if (mode === "pending") {
    return copy.admin.inviteInvitedAt(adminDay(row.createdAt));
  }

  if (mode === "accepted" && row.acceptedAt !== null) {
    return copy.admin.inviteSignedInAt(adminDay(row.acceptedAt));
  }

  if (mode === "revoked" && row.revokedAt !== null) {
    return copy.admin.inviteRevokedAt(adminDay(row.revokedAt));
  }

  return copy.admin.inviteNone;
}

function fourthLabel(mode: InviteMode) {
  if (mode === "pending") {
    return copy.admin.inviteColumnAction;
  }

  return mode === "accepted" ? copy.admin.inviteColumnGrant : copy.admin.inviteColumnNote;
}

function fourthText(row: InviteRow, mode: InviteMode) {
  if (mode === "accepted") {
    const days = grantDays(row);

    return row.grant === null || days === null
      ? copy.admin.inviteNone
      : copy.admin.inviteGrantLine(row.grant.quantity, days);
  }

  if (mode === "revoked") {
    return copy.admin.inviteRevokedNote;
  }

  return copy.admin.inviteNone;
}

function sectionHeading(mode: InviteMode, count: number) {
  if (mode === "pending") {
    return copy.admin.pendingHeading(count);
  }

  if (mode === "accepted") {
    return copy.admin.acceptedHeading(count);
  }

  return copy.admin.revokedHeading(count);
}

export function InviteSection({
  busyId,
  mode,
  onRevoke,
  rows,
}: {
  busyId: string | null;
  mode: InviteMode;
  onRevoke: (id: string) => void;
  rows: InviteRow[];
}) {
  const heading = sectionHeading(mode, rows.length);

  return (
    <section className="mt-7" aria-label={heading}>
      <h2 className="font-serif text-[24px] leading-[1.1]">{heading}</h2>
      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card shadow-sh">
        <div className="hidden grid-cols-[minmax(0,1.7fr)_110px_1fr_1fr] gap-4 border-b border-border bg-muted px-5 py-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:grid">
          <span>{copy.admin.inviteColumnEmail}</span>
          <span>{copy.admin.inviteColumnState}</span>
          <span>{copy.admin.inviteColumnDate}</span>
          <span>{fourthLabel(mode)}</span>
        </div>
        {rows.map((row) => (
          <div
            className="border-t border-border px-5 py-4 first:border-t-0 md:grid md:grid-cols-[minmax(0,1.7fr)_110px_1fr_1fr] md:items-center md:gap-4 md:py-3.5"
            key={row.id}
          >
            <span className="block text-[13.5px] font-semibold">
              {row.email ?? copy.admin.inviteNone}
            </span>
            <span className="mt-2 block md:mt-0">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:hidden">
                {copy.admin.inviteColumnState}
              </span>
              <AdminStatusPill status={mode} />
            </span>
            <span className="mt-2 block md:mt-0">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:hidden">
                {copy.admin.inviteColumnDate}
              </span>
              <span className="text-[12.5px]">{dateText(row, mode)}</span>
            </span>
            <span className="mt-2 block md:mt-0">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground md:hidden">
                {fourthLabel(mode)}
              </span>
              {mode === "pending" ? (
                <button
                  className="inline-flex h-8 items-center justify-center rounded-md border border-need px-3 max-md:h-11 text-[12.5px] font-semibold text-need hover:bg-need-soft disabled:opacity-60"
                  disabled={busyId === row.id}
                  onClick={() => {
                    onRevoke(row.id);
                  }}
                  type="button"
                >
                  {copy.admin.inviteRevoke}
                </button>
              ) : (
                <span className="text-[12.5px]">{fourthText(row, mode)}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
