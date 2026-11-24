import { copy } from "../../../shared/copy.ts";
import { CardTitle } from "./ui/card-title.tsx";
import { Card } from "./ui/card.tsx";
import type { KillSwitchRow } from "../../lib/admin-api.ts";
import { loadAdminAlerts, loadKillSwitches, loadSettings } from "../../lib/admin-api.ts";
import { useAdminResource, useInvalidateAdminQueries } from "../../lib/admin-resource.ts";
import { ActiveAlertsCard } from "./active-alerts-card.tsx";
import { AdminStatusCard } from "./admin-status-card.tsx";
import { AdminGateScreen } from "./gate-screen.tsx";
import { LaunchReadinessCard } from "./launch-readiness-card.tsx";
import { NewSwitchLine } from "./new-switch-line.tsx";
import { AdminPageHeading } from "./page-heading.tsx";
import { SettingLine } from "./setting-line.tsx";
import { SwitchLine } from "./switch-line.tsx";

export function AdminSettingsPage() {
  const invalidateAdmin = useInvalidateAdminQueries();
  const settings = useAdminResource(loadSettings, ["settings"]);
  const switches = useAdminResource(loadKillSwitches, ["kill-switches"]);
  const alerts = useAdminResource(loadAdminAlerts, ["alerts"]);

  const refusal = settings.refusal ?? switches.refusal ?? alerts.refusal;

  if (refusal !== null) {
    return <AdminGateScreen code={refusal} />;
  }

  const heading = (
    <AdminPageHeading
      italic={copy.admin.switchesTitleItalic}
      lead={copy.admin.switchesLead}
      plain={copy.admin.switchesTitlePlain}
    />
  );

  const loadFailed = settings.failed || switches.failed;

  if (loadFailed || settings.data === null || switches.data === null) {
    return (
      <>
        {heading}
        <AdminStatusCard failed={loadFailed} onRetry={invalidateAdmin} />
      </>
    );
  }

  const settingsView = settings.data.settings;
  const switchRows: KillSwitchRow[] = switches.data.switches;

  return (
    <>
      {heading}
      <div className="mt-7 flex flex-col gap-5">
        {alerts.data === null ? null : (
          <div className="grid gap-5 lg:grid-cols-2">
            <LaunchReadinessCard allowQuickActions readiness={alerts.data.readiness} />
            <ActiveAlertsCard alerts={alerts.data} />
          </div>
        )}
        <Card ariaLabelledBy="admin-settings-limits">
          <CardTitle id="admin-settings-limits">{copy.admin.settingsHeading}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{copy.admin.settingsIntro}</p>
          <div className="mt-4">
            {Object.entries(settingsView).map(([settingKey, value]) => (
              <SettingLine
                key={`${settingKey}:${value}`}
                onSaved={invalidateAdmin}
                settingKey={settingKey}
                value={value}
              />
            ))}
          </div>
        </Card>
        <Card ariaLabelledBy="admin-kill-switches">
          <CardTitle id="admin-kill-switches">{copy.admin.switchesHeading}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{copy.admin.switchesIntro}</p>
          <div className="mt-4">
            {switchRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">{copy.admin.switchEmpty}</p>
            ) : (
              switchRows.map((row) => (
                <SwitchLine key={`${row.scope}/${row.key}`} onChanged={invalidateAdmin} row={row} />
              ))
            )}
          </div>
          <NewSwitchLine onChanged={invalidateAdmin} />
        </Card>
      </div>
    </>
  );
}
