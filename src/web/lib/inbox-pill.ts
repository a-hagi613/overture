import type { InboxThreadRow } from "./inbox-api.ts";

import { copy } from "../../shared/copy.ts";

export function pillOf(row: InboxThreadRow) {
  if (row.needsChecking) {
    return { label: copy.inbox.unverifiedLabel, tone: "bg-need-soft text-need" };
  }

  if (row.classification === "code") {
    return { label: copy.inbox.codeUsed, tone: "bg-muted text-foreground" };
  }

  return null;
}
