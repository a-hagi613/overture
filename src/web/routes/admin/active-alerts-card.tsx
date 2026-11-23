import { useState } from "react";

import { copy } from "../../../shared/copy.ts";
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { CardHeader } from "./ui/card-header.tsx";
import { CardTitle } from "./ui/card-title.tsx";
import { Card } from "./ui/card.tsx";
import type { AdminAlertsResponse } from "../../lib/admin-api.ts";
import { ackAdminAlerts } from "../../lib/admin-api.ts";
import { useInvalidateAdminQueries } from "../../lib/admin-resource.ts";
import { AlertNotificationRow } from "./alert-notification-row.tsx";
import { AlertProblemRow } from "./alert-problem-row.tsx";

export function ActiveAlertsCard({ alerts }: { alerts: AdminAlertsResponse }) {
  const invalidateAdmin = useInvalidateAdminQueries();
  const [busy, setBusy] = useState(false);
  const [ackError, setAckError] = useState(false);

  const acknowledge = async (id?: string) => {
    setBusy(true);
    setAckError(false);

    try {
      await ackAdminAlerts(id);
      invalidateAdmin();
    } catch {
      setAckError(true);
    }

    setBusy(false);
  };

  return (
    <Card ariaLabelledBy="admin-active-alerts">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2.5">
          <CardTitle id="admin-active-alerts">{copy.admin.alertsHeading}</CardTitle>
          {alerts.unreadCount > 0 ? (
            <Badge tone="need">{copy.admin.alertsUnreadBadge(alerts.unreadCount)}</Badge>
          ) : null}
        </div>
        {alerts.unreadCount > 0 ? (
          <Button
            disabled={busy}
            onClick={() => {
              void acknowledge();
            }}
            variant="secondary"
          >
            {copy.admin.alertsAckAll}
          </Button>
        ) : null}
      </CardHeader>
      <p className="mt-1.5 text-xs text-muted-foreground">{copy.admin.alertsLead}</p>
      {ackError ? (
        <p className="mt-3 text-xs font-semibold text-need" role="alert">
          {copy.admin.alertsAckError}
        </p>
      ) : null}
      <div className="mt-4">
        {alerts.problems.length === 0 ? (
          <div className="flex items-center gap-2.5 rounded-md border border-border bg-background px-3.5 py-2.5">
            <Badge tone="ok">{copy.admin.alertsAllClear}</Badge>
            <p className="text-xs text-muted-foreground">{copy.admin.alertsNoProblems}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {alerts.problems.map((problem) => (
              <AlertProblemRow key={problem.id} problem={problem} />
            ))}
          </ul>
        )}
      </div>
      <div className="mt-5">
        {alerts.notifications.length === 0 ? (
          <p className="text-xs text-muted-foreground">{copy.admin.alertsEmptyNotifications}</p>
        ) : (
          <ul>
            {alerts.notifications.map((notification) => (
              <AlertNotificationRow
                busy={busy}
                key={notification.id}
                notification={notification}
                onAck={(id) => {
                  void acknowledge(id);
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
