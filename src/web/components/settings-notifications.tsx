import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import { NOTIFICATION_KINDS } from "../../shared/notifications.ts";
import {
  useNotificationPreferences,
  useSetNotificationPreference,
} from "../lib/notification-preferences-api.ts";
import { PreferenceRow } from "./notification-preference-row.tsx";
import { Card } from "./ui/card.tsx";
import { dsBody, dsCardTitle, dsEyebrow } from "./ui/ds.ts";
import { SectionSkeleton } from "./section-skeleton.tsx";

export function SettingsNotifications() {
  const preferences = useNotificationPreferences();
  const save = useSetNotificationPreference();

  const values = preferences.data;
  const ready = values !== undefined;
  const busy = !ready || save.isPending;

  const toggle = (kind: (typeof NOTIFICATION_KINDS)[number], enabled: boolean) => {
    save.mutate(
      { enabled, kind },
      {
        onSuccess: () => {
          toast.success(copy.settings.notificationsSavedToast);
        },
      },
    );
  };

  if (preferences.isPending) {
    return <SectionSkeleton />;
  }

  return (
    <Card
      ariaLabelledBy="settings-notifications"
      className="p-5 md:p-6"
      dataTestId="settings-notifications"
    >
      <h2 className={dsCardTitle} id="settings-notifications">
        {copy.settings.notificationsHeading}
      </h2>
      <p className={`${dsBody} mt-1 text-xs`}>{copy.settings.notificationsIntro}</p>

      <div className="mt-4">
        <p className={dsEyebrow}>{copy.settings.pushTitle}</p>
        <p className="mt-1 text-xs text-muted-foreground">{copy.settings.pushIntro}</p>
        <div className="mt-2">
          {NOTIFICATION_KINDS.map((kind) => (
            <PreferenceRow
              checked={values?.[kind] ?? true}
              detail={copy.settings.pushKinds[kind].detail}
              disabled={busy}
              id={kind}
              key={kind}
              label={copy.settings.pushKinds[kind].label}
              onToggle={toggle}
            />
          ))}
        </div>
      </div>

      {save.isError || preferences.isError ? (
        <p className="mt-3 text-xs font-medium text-need" role="alert">
          {copy.settings.notificationsSaveError}
        </p>
      ) : null}
    </Card>
  );
}
