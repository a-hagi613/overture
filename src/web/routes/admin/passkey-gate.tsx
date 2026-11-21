import { useEffect, useState } from "react";

import { copy } from "../../../shared/copy.ts";
import { authClient } from "../../lib/auth-client.ts";
import { PageNote } from "./page-note.tsx";

export function PasskeyGate({ onDone }: { onDone: () => void }) {
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const run = async () => {
      const result = await authClient.passkey.listUserPasskeys();

      setHasPasskey((result.data ?? []).length > 0);
    };

    void run();
  }, []);

  const assert = async () => {
    setWorking(true);
    setFailed(false);

    const result = await authClient.signIn.passkey();

    setWorking(false);

    if (result.error !== null) {
      setFailed(true);

      return;
    }

    onDone();
  };

  const add = async () => {
    setWorking(true);
    setFailed(false);

    const registered = await authClient.passkey.addPasskey();

    if (registered.error !== null) {
      setWorking(false);
      setFailed(true);

      return;
    }

    await assert();
  };

  return (
    <section className="mt-10 rounded-lg border border-border bg-card p-6 shadow-sh">
      <h1 className="font-serif text-[26px] leading-[1.1]">{copy.admin.gatePasskeyTitle}</h1>
      <p className="mt-2 max-w-[60ch] text-sm leading-[1.55] text-muted-foreground">
        {copy.admin.gatePasskeyBody}
      </p>
      {hasPasskey === null ? (
        <p className="mt-5 text-sm text-muted-foreground">{copy.admin.gatePasskeyWaiting}</p>
      ) : (
        <button
          className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-[13.5px] font-semibold text-card hover:opacity-90"
          disabled={working}
          onClick={() => {
            void (hasPasskey ? assert() : add());
          }}
          type="button"
        >
          {hasPasskey ? copy.admin.gatePasskeyAssert : copy.admin.gatePasskeyAdd}
        </button>
      )}
      {failed ? (
        <PageNote tone="need">
          <p>{copy.admin.gatePasskeyFailed}</p>
        </PageNote>
      ) : null}
    </section>
  );
}
