import { useState } from "react";

import { copy } from "../../../shared/copy.ts";
import { saveSetting } from "../../lib/admin-api.ts";

export function SettingLine({
  settingKey,
  value,
  onSaved,
}: {
  settingKey: string;
  value: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(value);

  const save = async () => {
    await saveSetting(settingKey, draft);

    onSaved();
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3 first:border-t-0">
      <p className="break-all font-mono text-sm font-semibold">{settingKey}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`setting-${settingKey}`}>
          {copy.admin.settingsValueAria(settingKey)}
        </label>
        <input
          className="h-9 w-[130px] rounded-md border border-input bg-background px-2.5 text-sm"
          id={`setting-${settingKey}`}
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        />
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-input bg-card px-3 text-sm font-semibold hover:bg-muted md:min-h-9"
          onClick={() => {
            void save();
          }}
          type="button"
        >
          {copy.admin.settingsSave}
        </button>
      </div>
    </div>
  );
}
