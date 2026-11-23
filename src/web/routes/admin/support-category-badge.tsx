import { copy } from "../../../shared/copy.ts";
import type { AdminSupportTicket } from "../../lib/admin-api.ts";
import { Badge } from "./ui/badge.tsx";
import type { BadgeTone } from "./ui/badge.tsx";

const CATEGORY_TONES: Record<AdminSupportTicket["category"], BadgeTone> = {
  account: "neutral",
  billing: "signal",
  bug: "need",
  other: "neutral",
};

export function SupportCategoryBadge({ category }: { category: AdminSupportTicket["category"] }) {
  return <Badge tone={CATEGORY_TONES[category]}>{copy.admin.supportCategories[category]}</Badge>;
}
