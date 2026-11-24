import type { KillSwitchRow } from "../../lib/admin-api.ts";

import { copy } from "../../../shared/copy.ts";
import { setKillSwitch } from "../../lib/admin-api.ts";

export function SwitchLine({ row, onChanged }: { row: KillSwitchRow; onChanged: () => void }) {
  const on = row.enabled === 1;

  const flip = async () => {
    await setKillSwitch(row.scope, row.key, !on, row.reason);

    onChanged();
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="font-mono text-sm font-semibold">{`${row.scope}/${row.key}`}</p>
        <p className="text-xs text-muted-foreground">
          {on ? copy.admin.switchOn : copy.admin.switchOff}
          {row.reason.length > 0 ? ` · ${row.reason}` : ""}
        </p>
      </div>
      <button
        className="inline-flex min-h-11 flex-none items-center justify-center rounded-md border border-input bg-card px-3 text-sm font-semibold hover:bg-muted md:min-h-9"
        onClick={() => {
          void flip();
        }}
        type="button"
      >
        {on ? copy.admin.switchSetOff : copy.admin.switchSetOn}
      </button>
    </div>
  );
}
