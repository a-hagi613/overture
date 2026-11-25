import { Link } from "react-router";

import { copy } from "../../../shared/copy.ts";
import { NavGlyph } from "../../components/nav-glyph.tsx";
import type { AdminPersonRow } from "../../lib/admin-api.ts";
import { adminDay, adminDayTime } from "../../lib/admin-date.ts";
import { AdminCellLabel } from "./cell-label.tsx";
import { AdminStatusPill } from "./status-pill.tsx";
import { UserPresenceBadge } from "./user-presence-badge.tsx";

function grantDetail(row: AdminPersonRow, now: number) {
  if (row.status === "invited") {
    return copy.admin.grantsStarts;
  }

  if (row.grant === null) {
    return copy.admin.inviteNone;
  }

  if (row.grant.expiresAt === null) {
    return copy.admin.grantAdminOpen;
  }

  return row.grant.expiresAt < now
    ? copy.admin.grantAdminEnded(adminDay(row.grant.expiresAt))
    : copy.admin.grantAdminEnds(adminDay(row.grant.expiresAt));
}

function inviteText(row: AdminPersonRow) {
  if (row.status === "invited") {
    return row.inviteAt === null
      ? copy.admin.inviteNone
      : copy.admin.inviteInvitedAt(adminDay(row.inviteAt));
  }

  return row.acceptedAt === null
    ? copy.admin.inviteNone
    : copy.admin.inviteAcceptedAt(adminDay(row.acceptedAt));
}

export function UserRow({ now, row }: { now: number; row: AdminPersonRow }) {
  const hasName = row.name !== null && row.name.trim() !== "";
  const name = hasName ? row.name : (row.email ?? copy.admin.inviteNone);
  const email = hasName ? row.email : null;
  const to = row.kind === "invite" ? "/admin/invites" : `/admin/users/${row.id}`;

  return (
    <Link
      className="block border-t border-border px-5 py-4 transition-colors hover:bg-muted/50 md:grid md:grid-cols-[minmax(0,1.6fr)_110px_1fr_1.05fr_1.1fr_24px] md:items-center md:gap-4 md:py-3.5"
      to={to}
    >
      <span className="block min-w-0">
        <span className="block truncate text-sm font-semibold">{name}</span>
        {email === null ? null : (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{email}</span>
        )}
      </span>
      <span className="mt-3 block md:mt-0">
        <AdminCellLabel label={copy.admin.usersColumnStatus} />
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <AdminStatusPill status={row.status} />
          <UserPresenceBadge online={row.online} signedIn={row.signedIn} />
        </span>
      </span>
      <span className="mt-3 block md:mt-0">
        <AdminCellLabel label={copy.admin.usersColumnInvite} />
        <span className="text-xs">{inviteText(row)}</span>
      </span>
      <span className="mt-3 block md:mt-0">
        <AdminCellLabel label={copy.admin.usersColumnGrants} />
        <span className="block text-xs">
          {row.grantsLeft === null ? copy.admin.grantsNone : copy.admin.grantsLeft(row.grantsLeft)}
        </span>
        <span className="mt-0.5 block text-eyebrow text-muted-foreground">
          {grantDetail(row, now)}
        </span>
      </span>
      <span className="mt-3 block md:mt-0">
        <AdminCellLabel label={copy.admin.usersColumnLastActivity} />
        <span className="text-xs">
          {row.lastActiveAt === null
            ? copy.admin.lastActivityNever
            : adminDayTime(row.lastActiveAt, now)}
        </span>
      </span>
      <span className="mt-3 flex text-muted-foreground md:mt-0 md:justify-end">
        <span className="-rotate-90">
          <NavGlyph name="chevron" size={16} />
        </span>
      </span>
    </Link>
  );
}
