import { copy } from "../../../shared/copy.ts";

export type AdminStatusKey =
  | "active"
  | "suspended"
  | "invited"
  | "pending"
  | "accepted"
  | "revoked";

const tones: Record<AdminStatusKey, string> = {
  accepted: "bg-ok-soft text-ok",
  active: "bg-ok-soft text-ok",
  invited: "bg-muted text-muted-foreground",
  pending: "bg-muted text-muted-foreground",
  revoked: "bg-muted text-muted-foreground",
  suspended: "bg-need-soft text-need",
};

const labels: Record<AdminStatusKey, string> = {
  accepted: copy.admin.statusAccepted,
  active: copy.admin.statusActive,
  invited: copy.admin.statusInvited,
  pending: copy.admin.statusPending,
  revoked: copy.admin.statusRevoked,
  suspended: copy.admin.statusSuspended,
};

export function AdminStatusPill({ status }: { status: AdminStatusKey }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${tones[status]}`}
    >
      {labels[status]}
    </span>
  );
}
