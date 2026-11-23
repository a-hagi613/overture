import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { copy } from "../../shared/copy.ts";
import {
  currentPushSubscription,
  disablePush,
  enablePush,
  notificationPermission,
  pushSupported,
} from "../lib/push.ts";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";

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

  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;

    void (async () => {
      if (!supported) {
        return;
      }

      try {
        const subscription = await currentPushSubscription();

        if (alive.current) {
          setSubscribed(subscription !== null);
        }
      } catch {
        if (alive.current) {
          setSubscribed(false);
        }
      }
    })();

    return () => {
      alive.current = false;
    };
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
        toast.success("Push notifications disabled.");
      } else {
        await enablePush();
        setSubscribed(true);
        toast.success("Push notifications enabled.");
      }
    } catch {
      setError(true);
    }

    setBusy(false);
  };

  return (
    <Card className="mt-5 flex flex-wrap items-center justify-between gap-3 p-5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          {subscribed === true
            ? copy.notifications.push.enabled
            : copy.notifications.push.thisDevice}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {detailFor({ denied, error, subscribed })}
        </p>
      </div>
      {denied || subscribed === null ? null : (
        <Button
          disabled={busy}
          onClick={() => {
            void toggle();
          }}
          size="sm"
          variant="secondary"
        >
          {subscribed ? copy.notifications.push.disable : copy.notifications.push.enable}
        </Button>
      )}
    </Card>
  );
}
