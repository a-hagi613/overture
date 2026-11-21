import { useEffect, useState } from "react";

import { copy } from "../../shared/copy.ts";
import {
  currentPushSubscription,
  disablePush,
  enablePush,
  notificationPermission,
  pushSupported,
} from "../lib/push.ts";

function detailFor(input: { denied: boolean; error: boolean; subscribed: boolean | null }) {
  if (input.denied) {
    return copy.notifications.push.denied;
  }

  if (input.error) {
    return copy.notifications.push.failed;
  }

  if (input.subscribed === true) {
    return copy.notifications.push.enabledDetail;
  }

  return copy.notifications.push.enableDetail;
}

export function PushOptIn() {
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const supported = pushSupported();
  const denied = notificationPermission() === "denied";

  useEffect(() => {
    void (async () => {
      if (!supported) {
        return;
      }

      try {
        const subscription = await currentPushSubscription();

        setSubscribed(subscription !== null);
      } catch {
        setSubscribed(false);
      }
    })();
  }, [supported]);

  if (!supported) {
    return null;
  }

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

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-[22px] py-4 shadow-sh">
      <div>
        <p className="text-[13.5px] font-semibold">
          {subscribed === true
            ? copy.notifications.push.enabled
            : copy.notifications.push.thisDevice}
        </p>
        <p className="text-[12.5px] text-muted-foreground">
          {detailFor({ denied, error, subscribed })}
        </p>
      </div>
      {denied || subscribed === null ? null : (
        <button
          className="flex h-10 items-center justify-center rounded-md border border-input bg-card px-4 text-[13px] font-semibold hover:bg-muted disabled:opacity-60"
          disabled={busy}
          onClick={() => {
            void toggle();
          }}
          type="button"
        >
          {subscribed ? copy.notifications.push.disable : copy.notifications.push.enable}
        </button>
      )}
    </div>
  );
}
