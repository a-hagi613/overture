import { useState } from "react";

import { copy } from "../../../shared/copy.ts";
import { setKillSwitch } from "../../lib/admin-api.ts";

const SWITCH_SCOPES = ["global", "ats", "employer", "provider"] as const;

export function NewSwitchLine({ onChanged }: { onChanged: () => void }) {
  const [scope, setScope] = useState<string>("global");
  const [key, setKey] = useState("");
  const [reason, setReason] = useState("");

  const add = async () => {
    await setKillSwitch(scope, key, true, reason);

    setKey("");
    setReason("");
    onChanged();
  };

  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label
            className="block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            htmlFor="switch-scope"
          >
            {copy.admin.switchScopeLabel}
          </label>
          <select
            className="mt-1 h-9 rounded-md border border-input bg-background px-2 text-[13px]"
            id="switch-scope"
            onChange={(event) => setScope(event.target.value)}
            value={scope}
          >
            {SWITCH_SCOPES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            className="block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            htmlFor="switch-name"
          >
            {copy.admin.switchKeyLabel}
          </label>
          <input
            className="mt-1 h-9 w-[160px] rounded-md border border-input bg-background px-2.5 text-[13px]"
            id="switch-name"
            onChange={(event) => setKey(event.target.value)}
            value={key}
          />
        </div>
        <div>
          <label
            className="block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            htmlFor="switch-reason"
          >
            {copy.admin.switchReasonLabel}
          </label>
          <input
            className="mt-1 h-9 w-[220px] rounded-md border border-input bg-background px-2.5 text-[13px]"
            id="switch-reason"
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
        </div>
      </div>
      <button
        className="inline-flex h-9 items-center justify-center rounded-md bg-foreground px-3.5 text-[13px] font-semibold text-card hover:opacity-90"
        disabled={key.length === 0}
        onClick={() => {
          void add();
        }}
        type="button"
      >
        {copy.admin.switchAdd}
      </button>
    </div>
  );
}
