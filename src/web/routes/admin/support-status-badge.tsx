import { copy } from "../../../shared/copy.ts";
import type { AdminSupportTicket } from "../../lib/admin-api.ts";
import { Badge } from "./ui/badge.tsx";
import type { BadgeTone } from "./ui/badge.tsx";

const STATUS_TONES: Record<AdminSupportTicket["status"], BadgeTone> = {
  closed: "neutral",
  in_progress: "signal",
  open: "need",
  resolved: "ok",
};

export function SupportStatusBadge({ status }: { status: AdminSupportTicket["status"] }) {
  return <Badge tone={STATUS_TONES[status]}>{copy.admin.supportStatus[status]}</Badge>;
}
