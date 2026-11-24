import { useState } from "react";

import { copy } from "../../../shared/copy.ts";
import { createGrant } from "../../lib/admin-api.ts";

export function NewGrantLine({ onChanged }: { onChanged: () => void }) {
  const [email, setEmail] = useState("");
  const [quantity, setQuantity] = useState("");
  const [days, setDays] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());

  const grant = async () => {
    await createGrant(email, Number(quantity), days === "" ? null : Number(days), key);

    setEmail("");
    setQuantity("");
    setDays("");
    setKey(crypto.randomUUID());
    onChanged();
  };

  const ready = email.includes("@") && quantity !== "" && Number.isFinite(Number(quantity));

  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label
            className="block text-eyebrow font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            htmlFor="grant-email"
          >
            {copy.admin.grantEmailLabel}
          </label>
          <input
            className="mt-1 h-9 w-[220px] rounded-md border border-input bg-background px-2.5 text-sm"
            id="grant-email"
            onChange={(event) => setEmail(event.target.value)}
            value={email}
          />
        </div>
        <div>
          <label
            className="block text-eyebrow font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            htmlFor="grant-quantity"
          >
            {copy.admin.grantQuantityLabel}
          </label>
          <input
            className="mt-1 h-9 w-[110px] rounded-md border border-input bg-background px-2.5 text-sm"
            id="grant-quantity"
            inputMode="numeric"
            onChange={(event) => setQuantity(event.target.value)}
            value={quantity}
          />
        </div>
        <div>
          <label
            className="block text-eyebrow font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            htmlFor="grant-days"
          >
            {copy.admin.grantDaysLabel}
          </label>
          <input
            className="mt-1 h-9 w-[110px] rounded-md border border-input bg-background px-2.5 text-sm"
            id="grant-days"
            inputMode="numeric"
            onChange={(event) => setDays(event.target.value)}
            value={days}
          />
        </div>
      </div>
      <button
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-foreground px-3.5 text-sm font-semibold text-card hover:opacity-90 md:min-h-9"
        disabled={!ready}
        onClick={() => {
          void grant();
        }}
        type="button"
      >
        {copy.admin.grantAdd}
      </button>
    </div>
  );
}
