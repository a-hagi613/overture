import { useEffect, useState } from "react";

import { copy } from "../../shared/copy.ts";
import {
  currentPushSubscription,
  disablePush,
  enablePush,
  notificationPermission,
  pushSupported,
} from "../lib/push.ts";

function installedNow() {
  return globalThis.matchMedia("(display-mode: standalone)").matches;
}

function permissionView(input: {
  denied: boolean;
  subscribed: boolean | null;
  supported: boolean;
}) {
  if (input.denied) {
    return {
      detail: copy.settings.deviceBlockedDetail,
      pill: copy.settings.deviceBlockedPill,
      title: copy.settings.deviceBlocked,
    };
  }

  if (input.subscribed === true) {
    return {
      detail: copy.settings.deviceAllowedDetail,
      pill: copy.settings.deviceAllowedPill,
      title: copy.settings.deviceAllowed,
    };
  }

  return {
    detail: input.supported ? copy.settings.deviceNotAskedDetail : copy.settings.deviceUnsupported,
    pill: copy.settings.deviceNotAskedPill,
    title: copy.settings.deviceNotAsked,
  };
}

function permissionPillClass(denied: boolean, subscribed: boolean | null) {
  if (denied) {
    return "bg-need-soft text-need";
  }

  return subscribed === true ? "bg-ok-soft text-ok" : "bg-muted text-muted-foreground";
}

/**
 * The board's "On this device" card: whether Overture is installed, whether
 * this browser allows push, and the one action that changes it. A denied
 * permission says what to do instead, because the page cannot ask again.
 * @returns The device card.
 */
export function SettingsDevicePush() {
  const installed = installedNow();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const supported = pushSupported();
  const denied = notificationPermission() === "denied";

  useEffect(() => {
    if (!supported) {
      return;
    }

    void (async () => {
      try {
        setSubscribed((await currentPushSubscription()) !== null);
      } catch {
        setSubscribed(false);
      }
    })();
  }, [supported]);

  const toggle = async () => {
    setBusy(true);
    setError(false);

    try {
      if (subscribed === true) {
        await disablePush();
        setSubscribed(false);
      } else {
        await enablePush();
        setSubscribed(true);
      }
    } catch {
      setError(true);
    }

    setBusy(false);
  };

  const permission = permissionView({ denied, subscribed, supported });

  return (
    <section
      aria-labelledby="settings-device"
      className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
      data-testid="settings-device"
    >
      <h2 className="font-serif text-[26px] leading-[1.1]" id="settings-device">
        {copy.settings.deviceTitle}
      </h2>
      <div className="mt-2">
        <div className="flex items-center justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {installed ? copy.settings.deviceInstalled : copy.settings.deviceNotInstalled}
            </p>
            <p className="text-[12.5px] text-muted-foreground">
              {installed
                ? copy.settings.deviceInstalledDetail
                : copy.settings.deviceNotInstalledDetail}
            </p>
          </div>
          <span
            className={`flex h-6 flex-none items-center rounded-full px-2.5 text-[11.5px] font-semibold ${
              installed ? "bg-ok-soft text-ok" : "bg-muted text-muted-foreground"
            }`}
          >
            {installed ? copy.settings.deviceInstalledPill : copy.settings.deviceNotInstalledPill}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border py-2.5">
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${denied ? "text-need" : ""}`}>
              {permission.title}
            </p>
            <p className="text-[12.5px] text-muted-foreground">{permission.detail}</p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <span
              className={`flex h-6 items-center rounded-full px-2.5 text-[11.5px] font-semibold ${permissionPillClass(
                denied,
                subscribed,
              )}`}
            >
              {permission.pill}
            </span>
            {denied || !supported || subscribed === null ? null : (
              <button
                className="flex h-10 items-center justify-center rounded-md border border-input bg-card px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-60"
                disabled={busy}
                onClick={() => {
                  void toggle();
                }}
                type="button"
              >
                {subscribed ? copy.settings.deviceDisable : copy.settings.deviceEnable}
              </button>
            )}
          </div>
        </div>
      </div>
      {error ? (
        <p className="mt-2 text-[12.5px] leading-[1.5] text-need" role="alert">
          {copy.settings.deviceSaveError}
        </p>
      ) : null}
    </section>
  );
}
