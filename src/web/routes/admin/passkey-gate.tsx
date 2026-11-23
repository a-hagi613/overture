import { useEffect, useState } from "react";

import { copy } from "../../../shared/copy.ts";
import { authClient } from "../../lib/auth-client.ts";
import { PageNote } from "./page-note.tsx";
import { Button } from "./ui/button.tsx";

export function PasskeyGate({ onDone }: { onDone: () => void }) {
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;

    const run = async () => {
      try {
        const result = await authClient.passkey.listUserPasskeys();

        if (!alive) {
          return;
        }

        if (result.error !== null) {
          setLoadFailed(true);

          return;
        }

        setLoadFailed(false);
        setHasPasskey(result.data.length > 0);
      } catch {
        if (alive) {
          setLoadFailed(true);
        }
      }
    };

    void run();

    return () => {
      alive = false;
    };
  }, []);

  const retryLoad = async () => {
    setLoadFailed(false);

    try {
      const result = await authClient.passkey.listUserPasskeys();

      if (result.error !== null) {
        setLoadFailed(true);

        return;
      }

      setHasPasskey(result.data.length > 0);
    } catch {
      setLoadFailed(true);
    }
  };

  const assert = async () => {
    setWorking(true);
    setFailed(false);

    let succeeded = false;

    try {
      const result = await authClient.signIn.passkey();

      if (result.error === null) {
        succeeded = true;
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    }

    setWorking(false);

    if (succeeded) {
      onDone();
    }
  };

  const add = async () => {
    setWorking(true);
    setFailed(false);

    let succeeded = false;

    try {
      const registered = await authClient.passkey.addPasskey();

      if (registered.error === null) {
        const asserted = await authClient.signIn.passkey();

        if (asserted.error === null) {
          succeeded = true;
        } else {
          setFailed(true);
        }
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    }

    setWorking(false);

    if (succeeded) {
      onDone();
    }
  };

  let body = <p className="mt-5 text-sm text-muted-foreground">{copy.admin.gatePasskeyWaiting}</p>;

  if (loadFailed) {
    body = (
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold text-need" role="alert">
          {copy.admin.gatePasskeyFailed}
        </p>
        <Button
          onClick={() => {
            void retryLoad();
          }}
          variant="secondary"
        >
          {copy.admin.retry}
        </Button>
      </div>
    );
  } else if (hasPasskey !== null) {
    body = (
      <button
        className="group mt-5 inline-flex h-10 items-center justify-center max-md:h-11 max-md:-my-[2px]"
        disabled={working}
        onClick={() => {
          void (hasPasskey ? assert() : add());
        }}
        type="button"
      >
        <span className="inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-[13.5px] font-semibold text-card group-hover:opacity-90">
          {hasPasskey ? copy.admin.gatePasskeyAssert : copy.admin.gatePasskeyAdd}
        </span>
      </button>
    );
  }

  return (
    <section className="mt-10 rounded-lg border border-border bg-card p-6 shadow-sh">
      <h1 className="font-serif text-[26px] leading-[1.1]">{copy.admin.gatePasskeyTitle}</h1>
      <p className="mt-2 max-w-[60ch] text-sm leading-[1.55] text-muted-foreground">
        {copy.admin.gatePasskeyBody}
      </p>
      {body}
      {failed ? (
        <PageNote tone="need">
          <p role="alert">{copy.admin.gatePasskeyFailed}</p>
        </PageNote>
      ) : null}
    </section>
  );
}
