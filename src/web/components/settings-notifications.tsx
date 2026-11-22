import { copy } from "../../shared/copy.ts";
import {
  NOTIFICATION_KINDS,
  RECAP_EMAIL_PREFERENCE,
  RECAP_INCLUDE_YESTERDAY_PREFERENCE,
} from "../../shared/notifications.ts";
import {
  useNotificationPreferences,
  useSetNotificationPreference,
} from "../lib/notification-preferences-api.ts";
import { PreferenceRow } from "./notification-preference-row.tsx";
import { SettingsDevicePush } from "./settings-device-push.tsx";

export function SettingsNotifications() {
  const preferences = useNotificationPreferences();
  const save = useSetNotificationPreference();

  const values = preferences.data;
  const ready = values !== undefined;
  const busy = !ready || save.isPending;

  return (
    <>
      <section
        aria-labelledby="settings-notifications"
        className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
        data-testid="settings-notifications"
      >
        <h2 className="font-serif text-[26px] leading-[1.1]" id="settings-notifications">
          {copy.settings.notificationsHeading}
        </h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {copy.settings.notificationsIntro}
        </p>
        <h3 className="mt-4 font-serif text-[20px] leading-[1.15]">{copy.settings.recapTitle}</h3>
        <div className="mt-1">
          <PreferenceRow
            checked={values?.[RECAP_EMAIL_PREFERENCE] ?? true}
            detail={copy.settings.recapDetail}
            disabled={busy}
            id={RECAP_EMAIL_PREFERENCE}
            label={copy.settings.recapSwitchLabel}
            onToggle={(kind, enabled) => {
              save.mutate({ enabled, kind });
            }}
          />
          <PreferenceRow
            checked={values?.[RECAP_INCLUDE_YESTERDAY_PREFERENCE] ?? true}
            detail={copy.settings.recapYesterdayDetail}
            disabled={busy}
            id={RECAP_INCLUDE_YESTERDAY_PREFERENCE}
            label={copy.settings.recapYesterdayTitle}
            onToggle={(kind, enabled) => {
              save.mutate({ enabled, kind });
            }}
          />
        </div>
        {save.isError || preferences.isError ? (
          <p className="mt-2 text-[12.5px] leading-[1.5] text-need" role="alert">
            {copy.settings.notificationsSaveError}
          </p>
        ) : null}
      </section>
      <SettingsDevicePush />
      <section
        aria-labelledby="settings-push"
        className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
        data-testid="settings-push"
      >
        <h2 className="font-serif text-[26px] leading-[1.1]" id="settings-push">
          {copy.settings.pushTitle}
        </h2>
        <p className="mt-1 text-[12.5px] text-muted-foreground">{copy.settings.pushIntro}</p>
        <div className="mt-2">
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
    </>
  );
}
