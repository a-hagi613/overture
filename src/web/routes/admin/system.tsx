import { copy } from "../../../shared/copy.ts";
import { loadSystem } from "../../lib/admin-api.ts";
import { useAdminResource } from "../../lib/admin-resource.ts";
import { AdminGateScreen } from "./gate-screen.tsx";
import { AdminPageHeading } from "./page-heading.tsx";
import { systemButtonClass } from "./system-classes.ts";
import { SystemDatabasesCard } from "./system-databases-card.tsx";
import { SystemLiveChecksCard } from "./system-live-checks-card.tsx";
import { SystemRuntimeCard } from "./system-runtime-card.tsx";

export function SystemPage() {
  const { data, failed, refusal, refresh } = useAdminResource(loadSystem);

  if (refusal !== null) {
    return (
      <AdminGateScreen
        code={refusal}
        onPasskeyDone={() => {
          refresh();
        }}
      />
    );
  }

  if (data === null) {
    return (
      <>
        <AdminPageHeading
          italic={copy.admin.systemTitleItalic}
          lead={copy.admin.systemLead}
          plain={copy.admin.systemTitlePlain}
        />
        <section className="mt-7 rounded-lg border border-border bg-card p-[22px_24px_18px] shadow-sh">
          <output aria-live="polite" className="block text-[13px] text-muted-foreground">
            {failed ? copy.admin.systemLoadFailed : copy.admin.systemLoading}
          </output>
          {failed ? (
            <button className={`${systemButtonClass} mt-3`} onClick={refresh} type="button">
              {copy.admin.systemRetry}
            </button>
          ) : null}
        </section>
      </>
    );
  }

  return (
    <>
      <AdminPageHeading
        italic={copy.admin.systemTitleItalic}
        lead={copy.admin.systemLead}
        plain={copy.admin.systemTitlePlain}
      />
      <div className="mt-7 flex flex-col gap-5">
        <SystemRuntimeCard view={data} />
        <SystemDatabasesCard refresh={refresh} view={data} />
        <SystemLiveChecksCard refresh={refresh} view={data} />
      </div>
    </>
  );
}
