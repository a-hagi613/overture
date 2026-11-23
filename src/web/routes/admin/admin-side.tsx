import { copy } from "../../../shared/copy.ts";
import { passkeyAgeText } from "../../lib/admin-date.ts";
import { loadAdminSession } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { initialsOf } from "../../lib/identity.ts";

export function AdminSideIdentity() {
  const { data } = useAdminResource(loadAdminSession, ["session"]);

  if (data === null) {
    return null;
  }

  const ownerName = data.owner.name.trim() === "" ? data.owner.email : data.owner.name;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-border bg-card px-3.5 py-3 shadow-sh">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {copy.admin.passkeyEyebrow}
        </p>
        <p className="mt-1.5 text-[13.5px] font-semibold">
          {data.passkeyAssertedAt === null
            ? copy.admin.passkeyJustNow
            : passkeyAgeText(data.passkeyAssertedAt, data.now)}
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {copy.admin.passkeyNote}
        </p>
      </section>
      <div className="flex items-center gap-2.5 px-1">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-input bg-muted font-serif text-[15px] italic"
        >
          {initialsOf(ownerName)}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-semibold">{ownerName}</span>
          <span className="block text-[12px] text-muted-foreground">{copy.admin.ownerRole}</span>
        </span>
      </div>
    </div>
  );
}
