import { copy } from "../../../shared/copy.ts";

export function UserPresenceBadge({ online, signedIn }: { online: boolean; signedIn: boolean }) {
  if (online) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-eyebrow font-semibold text-ok"
        data-testid="admin-user-online"
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ok" />
        {copy.admin.usersOnline}
      </span>
    );
  }

  if (!signedIn) {
    return null;
  }

  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-eyebrow font-semibold text-muted-foreground">
      {copy.admin.usersSignedIn}
    </span>
  );
}
