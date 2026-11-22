import { copy } from "../../shared/copy.ts";
import { NOTIFICATION_KINDS, RECAP_EMAIL_PREFERENCE } from "../../shared/notifications.ts";
import {
  useNotificationPreferences,
  useSetNotificationPreference,
} from "../lib/notification-preferences-api.ts";
import { PreferenceRow } from "./notification-preference-row.tsx";

export function SettingsNotifications() {
  const preferences = useNotificationPreferences();
  const save = useSetNotificationPreference();

  const values = preferences.data;
  const ready = values !== undefined;
  const busy = !ready || save.isPending;

  return (
    <section
      aria-labelledby="settings-notifications"
      className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
      data-testid="settings-notifications"
    >
      <h2 className="font-serif text-[26px] leading-[1.1]" id="settings-notifications">
        {copy.settings.notificationsHeading}
      </h2>
      <p className="mt-1 text-[12.5px] text-muted-foreground">{copy.settings.notificationsIntro}</p>
      <div className="mt-3">
        <PreferenceRow
          checked={values?.[RECAP_EMAIL_PREFERENCE] ?? true}
          detail={copy.settings.recapDetail}
          disabled={busy}
          id={RECAP_EMAIL_PREFERENCE}
          label={copy.settings.recapTitle}
          onToggle={(kind, enabled) => {
            save.mutate({ enabled, kind });
          }}
        />
      </div>
      <div className="mt-3.5 border-t border-border pt-3.5">
        <p className="text-sm font-semibold">{copy.settings.pushTitle}</p>
        <p className="text-[12.5px] text-muted-foreground">{copy.settings.pushIntro}</p>
        {NOTIFICATION_KINDS.map((kind) => (
          <PreferenceRow
            checked={values?.[kind] ?? true}
            detail={copy.settings.pushKinds[kind].detail}
            disabled={busy}
            id={kind}
            key={kind}
            label={copy.settings.pushKinds[kind].label}
            onToggle={(next, enabled) => {
              save.mutate({ enabled, kind: next });
            }}
          />
        ))}
      </div>
      {save.isError || preferences.isError ? (
        <p className="mt-2 text-[12.5px] leading-[1.5] text-need" role="alert">
          {copy.settings.notificationsSaveError}
        </p>
      ) : null}
    </section>
  );
}
