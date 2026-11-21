import { copy } from "../../../shared/copy.ts";
import type { KillSwitchRow } from "../../lib/admin-api.ts";
import { loadKillSwitches, loadSettings } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AdminPageHeading } from "./page-heading.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";
import { NewSwitchLine } from "./new-switch-line.tsx";
import { SettingLine } from "./setting-line.tsx";
import { SwitchLine } from "./switch-line.tsx";

export function AdminSettingsPage() {
  const settings = useAdminResource(loadSettings);
  const switches = useAdminResource(loadKillSwitches);

  if (settings.refusal !== null) {
    return (
      <AdminGateScreen
        code={settings.refusal}
        onPasskeyDone={() => {
          settings.refresh();
          switches.refresh();
        }}
      />
    );
  }

  if (switches.refusal !== null) {
    return (
      <AdminGateScreen
        code={switches.refusal}
        onPasskeyDone={() => {
          switches.refresh();
        }}
      />
    );
  }

  if (settings.data === null || switches.data === null) {
    return null;
  }

  const settingsView = settings.data.settings;
  const switchRows: KillSwitchRow[] = switches.data.switches;

  const refreshBoth = () => {
    settings.refresh();
    switches.refresh();
  };

  return (
    <>
      <AdminPageHeading
        italic={copy.admin.switchesTitleItalic}
        lead={copy.admin.switchesLead}
        plain={copy.admin.switchesTitlePlain}
      />
      <div className="mt-7 flex flex-col gap-5">
        <section
          aria-labelledby="admin-settings-limits"
          className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
        >
          <h2 id="admin-settings-limits" className="font-serif text-[26px] leading-[1.1]">
            {copy.admin.settingsHeading}
          </h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{copy.admin.settingsIntro}</p>
          <div className="mt-4">
            {Object.entries(settingsView).map(([settingKey, value]) => (
              <SettingLine
                key={settingKey}
                onSaved={refreshBoth}
                settingKey={settingKey}
                value={value}
              />
            ))}
          </div>
        </section>
        <section
          aria-labelledby="admin-kill-switches"
          className="rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh"
        >
          <h2 id="admin-kill-switches" className="font-serif text-[26px] leading-[1.1]">
            {copy.admin.switchesHeading}
          </h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{copy.admin.switchesIntro}</p>
          <div className="mt-4">
            {switchRows.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">{copy.admin.switchEmpty}</p>
            ) : (
              switchRows.map((row) => (
                <SwitchLine
                  key={`${row.scope}/${row.key}`}
                  onChanged={() => {
                    switches.refresh();
                  }}
                  row={row}
                />
              ))
            )}
          </div>
          <NewSwitchLine
            onChanged={() => {
              switches.refresh();
            }}
          />
        </section>
      </div>
    </>
  );
}
