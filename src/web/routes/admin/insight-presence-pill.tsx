import { copy } from "../../../shared/copy.ts";

export function PresencePill({ online }: { online: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-eyebrow font-semibold ${
        online ? "bg-ok-soft text-ok" : "bg-muted text-muted-foreground"
      }`}
      data-testid="admin-user-presence"
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${online ? "bg-ok" : "bg-muted-foreground"}`}
      />
      {online ? copy.admin.insightOnline : copy.admin.insightOffline}
    </span>
  );
}
