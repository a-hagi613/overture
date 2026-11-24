import type { AdminRefusalCode } from "../../lib/admin-api.ts";

import { copy } from "../../../shared/copy.ts";

const gateCopy: Record<AdminRefusalCode, { heading: string; body: string }> = {
  access_required: {
    heading: copy.admin.gateAccessTitle,
    body: copy.admin.gateAccessBody,
  },
  owner_required: {
    heading: copy.admin.gateOwnerTitle,
    body: copy.admin.gateOwnerBody,
  },
};

export function AdminGateScreen({ code }: { code: AdminRefusalCode }) {
  const text = gateCopy[code];

  return (
    <section className="mt-10 rounded-lg border border-border bg-card p-6 shadow-sh">
      <h1 className="font-serif text-card-title leading-[1.1]">{text.heading}</h1>
      <p className="mt-2 max-w-[60ch] text-sm leading-[1.55] text-muted-foreground">{text.body}</p>
    </section>
  );
}
