import { copy } from "../../../shared/copy.ts";
import { Badge } from "../../components/ui/badge.tsx";
import { Button } from "../../components/ui/button.tsx";
import type { AdminAlertNotification } from "../../lib/admin-api.ts";

function formatAlertTime(timestamp: number) {
  return new Date(timestamp).toISOString().replace("T", " ").slice(0, 16);
}

export function AlertNotificationRow({
  busy,
  notification,
  onAck,
}: {
  busy: boolean;
  notification: AdminAlertNotification;
  onAck: (id: string) => void;
}) {
  const unread = notification.readAt === null;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13.5px] font-semibold">{notification.title}</p>
          <Badge tone={unread ? "need" : "neutral"}>
            {unread ? copy.admin.alertsUnread : copy.admin.alertsAcknowledged}
          </Badge>
        </div>
        <p className="mt-0.5 font-mono text-[12px] text-muted-foreground tabular-nums">
          {formatAlertTime(notification.createdAt)}
        </p>
        <p className="mt-1 break-all font-mono text-[12px] text-muted-foreground">
          {notification.body}
        </p>
      </div>
      {unread ? (
        <Button
          disabled={busy}
          onClick={() => {
            onAck(notification.id);
          }}
          variant="secondary"
        >
          {copy.admin.alertsAckOne}
        </Button>
      ) : null}
    </li>
  );
}
