import { Link } from "react-router";

import type { AdminRefusalCode } from "../../lib/admin-api.ts";

import { copy } from "../../../shared/copy.ts";
import { PasskeyGate } from "./passkey-gate.tsx";

type HardGateCode = Exclude<AdminRefusalCode, "passkey_required">;

const gateCopy: Record<HardGateCode, { heading: string; body: string }> = {
  access_required: {
    heading: copy.admin.gateAccessTitle,
    body: copy.admin.gateAccessBody,
  },
  sign_in_required: {
    heading: copy.admin.gateSignInTitle,
    body: copy.admin.gateSignInBody,
  },
  owner_required: {
    heading: copy.admin.gateOwnerTitle,
    body: copy.admin.gateOwnerBody,
  },
};

export function AdminGateScreen({
  code,
  onPasskeyDone,
}: {
  code: AdminRefusalCode;
  onPasskeyDone: () => void;
}) {
  if (code === "passkey_required") {
    return <PasskeyGate onDone={onPasskeyDone} />;
  }

  const text = gateCopy[code];

  return (
    <section className="mt-10 rounded-lg border border-border bg-card p-6 shadow-sh">
      <h1 className="font-serif text-[26px] leading-[1.1]">{text.heading}</h1>
      <p className="mt-2 max-w-[60ch] text-sm leading-[1.55] text-muted-foreground">{text.body}</p>
      {code === "sign_in_required" ? (
        <Link
          className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-foreground px-4 text-[13.5px] font-semibold text-card hover:opacity-90"
          to="/signin"
        >
          {copy.admin.gateSignIn}
        </Link>
      ) : null}
    </section>
  );
}
